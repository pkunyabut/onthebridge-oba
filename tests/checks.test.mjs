import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords, countSections, findCJK, stripClaimMarkers } from '../src/stages/checks.mjs';
import { runStage } from '../src/stages/index.mjs';

test('countWords uses Intl.Segmenter and ignores markdown and URLs', () => {
  assert.equal(countWords('Hello brave new world'), 4);
  assert.equal(countWords('สวัสดีครับ'), 2, 'Thai text is segmented with the dictionary');
  assert.equal(countWords('**Hello** [link](https://example.com/a/b/c) ![image](images/x.png)'), 2);
  assert.equal(countWords('## Hook\nAmazon blocks Muse 2026'), 5);
});

test('countSections reports counter method and runtime versions', () => {
  const r = countSections({ hook: 'Hello', why: 'world', step: '', actionable: '' });
  assert.equal(r.total, 2);
  assert.ok(r.method.includes('Intl.Segmenter'));
  assert.ok(r.icu);
});

test('findCJK catches Chinese, Japanese and Korean but not Thai or Latin text', () => {
  assert.equal(findCJK('Earlier 他们 also blocked ChatGPT').length, 1);
  assert.equal(findCJK('ひらがな').length, 1);
  assert.equal(findCJK('한국어').length, 1);
  assert.equal(findCJK('ภาษาไทยล้วน and English 123 “quotes” — dash').length, 0);
});

test('stripClaimMarkers removes internal claim codes only', () => {
  assert.equal(stripClaimMarkers('Amazon blocked Muse (clm1, clm2) already'), 'Amazon blocked Muse already');
  assert.equal(stripClaimMarkers('A fact [clm3] continues'), 'A fact continues');
  assert.equal(stripClaimMarkers('In (2026) and (a note)'), 'In (2026) and (a note)');
});

// ─── Final gate (no AI call) ─────────────────────────────────────────────────

function jobWith({ reviewVerdict = 'pass', issues = [], body = 'Article text', sources = ['src1'], wordCount = 1500 } = {}) {
  return {
    id: 'OBA-00000000',
    revision: 3,
    stages: {
      research: { result: { sources: [], unreadable: [{ url: 'x' }] } },
      evidence: { result: { claims: [{ status: 'verified' }, { status: 'needs_verification' }] } },
      review: { result: { verdict: reviewVerdict, issues, discardedIssues: [], wordCount, wordRange: { min: 1200, max: 1800 } } },
      channels: { result: { blockdit: { title: 'Title', deck: 'Standfirst', body, sources, wordCount: 1500 } } }
    }
  };
}

test('final gate passes a clean article to human review', async () => {
  const r = await runStage('final', jobWith());
  assert.equal(r.verdict, 'ready_for_human_review');
  assert.deepEqual(r.blockers, []);
  // 1 claim kept out + 1 source that could not be opened (+ a "thin evidence base" note if any, since the fixture has few claims)
  assert.equal(r.notes.filter(n => !n.startsWith('Thin evidence base')).length, 2);
  assert.ok(r.evidenceBase, 'final result carries the evidence base summary');
});

test('final gate blocks when review did not pass', async () => {
  const r = await runStage('final', jobWith({ reviewVerdict: 'repair', issues: [{ kind: 'misattributed', blocking: true, problem: 'wrong speaker', sentence: 'A sentence' }] }));
  assert.equal(r.verdict, 'needs_revision');
  assert.equal(r.blockers[0].kind, 'misattributed');
});

test('advisory issues and short length are reported but do not block', async () => {
  const r = await runStage('final', jobWith({
    reviewVerdict: 'advisory', wordCount: 900,
    issues: [{ kind: 'word_count', blocking: false, problem: 'short' }, { kind: 'repetition', blocking: false, problem: 'repeated' }]
  }));
  assert.equal(r.verdict, 'ready_for_human_review');
  assert.ok(r.notes.some(n => n.includes('900 words')));
  assert.ok(r.notes.some(n => n.includes('observation')));
});

test('final gate blocks CJK and leftover claim codes in the publish copy', async () => {
  const r = await runStage('final', jobWith({ body: 'Text 他们 more (clm4)' }));
  assert.equal(r.verdict, 'needs_revision');
  assert.deepEqual(r.blockers.map(b => b.kind).sort(), ['cjk', 'claim_marker']);
});

test('final gate blocks an article with no readable sources', async () => {
  const r = await runStage('final', jobWith({ sources: [] }));
  assert.equal(r.verdict, 'needs_revision');
  assert.equal(r.blockers[0].kind, 'no_sources');
});

// ─── Evidence: rescue claims from truncated JSON ─────────────────────────────

import { salvageClaims } from '../src/stages/index.mjs';

test('salvageClaims keeps complete claims from a truncated reply', () => {
  const raw = '```json\n{\n  "claims": [\n    {"id": "clm1", "claim": "a {not a bracket}", "quotes": [{"source_id": "src1", "text": "say \\"hi\\" }"}]},\n    {"id": "clm2", "claim": "b"},\n    {"id": "clm3", "claim": "cut off in the mid';
  assert.deepEqual(salvageClaims(raw).map(c => c.id), ['clm1', 'clm2']);
});

test('salvageClaims returns nothing when there is no claims array', () => {
  assert.deepEqual(salvageClaims('Sorry, I cannot answer that.'), []);
});

// ─── Write slot by slot: allocating claims to slots ──────────────────────────

import { allocateClaims } from '../src/stages/index.mjs';

test('allocateClaims gives every claim to exactly one section', () => {
  const claims = ['clm1', 'clm2', 'clm3', 'clm4'].map(id => ({ id, claim: id }));
  const outline = { sections: {
    hook: { claim_ids: ['clm1'] },
    why: { claim_ids: ['CLM2', 'clm1'] },        // clm1 repeated → stays in the first slot that got it
    step: { claim_ids: ['clm99'] },              // does not exist → ignored
    actionable: { claim_ids: [] }
  } };
  const a = allocateClaims(claims, outline);
  assert.deepEqual(a.hook.map(c => c.id), ['clm1']);
  assert.deepEqual(a.why.map(c => c.id), ['clm2']);
  assert.deepEqual(a.step.map(c => c.id), ['clm3', 'clm4']); // not placed by the outline → the main content slot
  assert.equal(Object.values(a).flat().length, 4);
});

// ─── "Misattributed" must be checked against the real source ─────────────────

import { namesTogetherInSource } from '../src/stages/checks.mjs';

const HEISE = 'Third-party apps should be transparent", explained Amazon spokeswoman Lara Hendrickson in a statement to Bloomberg. An opt-in requirement is common.';

test('attribution that matches the source text is recognised', () => {
  assert.equal(namesTogetherInSource('Lara Hendrickson, a spokeswoman for Amazon, told Bloomberg in a statement that', [HEISE]), true);
});

test('attribution to a different outlet is not treated as supported', () => {
  assert.equal(namesTogetherInSource('Lara Hendrickson, a spokeswoman for Amazon, told Reuters that', [HEISE]), false);
});

test('sentence without enough names cannot clear a misattribution flag', () => {
  assert.equal(namesTogetherInSource('The spokeswoman added that AI agents may skip tuning', [HEISE]), false);
});

// ─── A hook must not open with a hypothetical scene ──────────────────────────

import { findHypotheticalOpening, firstSentence } from '../src/stages/checks.mjs';

test('hypothetical openings that presume the reader are caught (English)', () => {
  const cases = [
    // seen in practice in OBA-67b67cd6 (translated)
    'Have you ever felt that family life is so hectic you have no time left for yourself? In the morning you wake the kids for school',
    'You just woke up and picked up your phone',
    "You've just opened an email from your bank",
    'Imagine a morning when an AI books the ticket for you',
    'Picture a meeting room where nobody takes notes',
    'Suppose you had to choose between work and family',
    'If you were a Muse user, what would you do?',
    '**You are** scrolling through products (clm1)',
    '“You might never have noticed” which permissions the app asks for'
  ];
  for (const hook of cases) assert.ok(findHypotheticalOpening({ hook }), hook);
});

test('hypothetical openings that presume the reader are caught (Thai profile)', () => {
  const cases = [
    'คุณเคยรู้สึกไหมว่าชีวิตครอบครัวมันยุ่งเหยิงจนแทบไม่มีเวลาเหลือให้ตัวเอง?',
    'คุณเพิ่งตื่นนอนแล้วหยิบโทรศัพท์ขึ้นมาดู',
    'ลองจินตนาการว่าเช้าวันหนึ่ง AI จองตั๋วให้คุณ',
    'สมมติว่าคุณต้องเลือกระหว่างงานกับครอบครัว',
    'ถ้าคุณเป็นผู้ใช้ Muse คุณจะทำอย่างไร?'
  ];
  for (const hook of cases) assert.ok(findHypotheticalOpening({ hook }, 'th'), hook);
});

test('openings built on real events, names or real questions pass', () => {
  const cases = [
    "Recently, a user of Meta's AI assistant Muse tried to get it to help buy goods on Amazon (clm1)",
    'On 25 September 2026 Bangkok declared all 50 districts disaster areas after the floods (clm2)',
    'Mr. Somchai Jaidee, 62, opened a coffee shop after retirement (clm3)',
    "Why did Amazon block other companies' AI assistants?",
    'Your phone buzzed twice during the hearing, the court record shows (clm4)',
    'Loneliness in retirement is not only a problem for people who live alone',
    ''
  ];
  for (const hook of cases) assert.equal(findHypotheticalOpening({ hook }), null, hook);
  assert.equal(findHypotheticalOpening({ hook: 'คุณสมชาย ใจดี อายุ 62 ปี เปิดร้านกาแฟหลังเกษียณ (clm3)' }, 'th'), null, 'a Thai personal name is not the reader');
});

test('only the first sentence of the hook is judged', () => {
  const hook = 'Amazon announced a block on Muse last week (clm1). Imagine if you were using it';
  assert.equal(findHypotheticalOpening({ hook }), null);
});

test('flagged sentence is verbatim from the draft so revision can find it', async () => {
  const { locate } = await import('../src/stages/revise.mjs');
  const hook = '**You just** received a warning email (clm2) and wondered?\n\nNext paragraph';
  const hit = findHypotheticalOpening({ hook });
  assert.equal(hit.sentence, firstSentence(hook));
  assert.ok(locate(hook, hit.sentence));
  assert.ok(hit.sentence.includes('(clm2)'));
});

// ─── Write in 4 slots ────────────────────────────────────────────────────────

import { SECTION_TARGETS, sectionPrompt } from '../src/stages/index.mjs';
import { SECTIONS, BLOCKDIT_WORD_RANGE } from '../src/stages/checks.mjs';
import { LANGUAGES } from '../src/language.mjs';

test('section targets add up to the Blockdit length range, in every language', () => {
  assert.deepEqual(Object.keys(SECTION_TARGETS), SECTIONS);
  for (const lang of Object.values(LANGUAGES)) {
    const lo = SECTIONS.reduce((n, s) => n + lang.sectionTargets[s][0], 0);
    const hi = SECTIONS.reduce((n, s) => n + lang.sectionTargets[s][1], 0);
    assert.ok(lo >= lang.wordRange.min, `${lang.code}: minimum total ${lo}`);
    assert.ok(hi <= lang.wordRange.max, `${lang.code}: maximum total ${hi}`);
  }
  assert.deepEqual(BLOCKDIT_WORD_RANGE, LANGUAGES.en.wordRange);
});

test('each section prompt carries only its own claims plus the sections already written', () => {
  const claims = ['clm1', 'clm2', 'clm3'].map(id => ({ id, claim: `Checked fact ${id}` }));
  const outline = { headings: { hook: 'How it began', why: 'Why it matters' }, sections: { hook: { claim_ids: ['clm1'] }, why: { claim_ids: ['clm2'] } } };
  const job = { topic: 'Test topic', audience: '25-65+' };
  const base = { template: 'reflective', structure: '-', outline };

  const hook = sectionPrompt(job, { ...base, slot: 'hook', mine: [claims[0]], others: claims.slice(1), written: {} });
  assert.ok(hook.includes('"id": "clm1"'));
  assert.ok(!hook.includes('"id": "clm2"'));             // another slot's claim is not sent in full
  assert.ok(hook.includes('Have you ever felt'));        // the rule against presuming the reader
  assert.ok(!hook.includes('Already written'));

  const why = sectionPrompt(job, { ...base, slot: 'why', mine: [claims[1]], others: [claims[0], claims[2]], written: { hook: 'The opening paragraph already written (clm1)' } });
  assert.ok(why.includes('Already written'));
  assert.ok(why.includes('### How it began\nThe opening paragraph already written (clm1)'));
  assert.ok(why.includes('do not retell'));
  assert.ok(why.includes(`Length ${SECTION_TARGETS.why[0]}–${SECTION_TARGETS.why[1]} words`));
  assert.ok(!why.includes('## Opening'));                // the hook rules are added to the opening slot only
});

test('the prompt asks for the article language chosen for the job', () => {
  const outline = { headings: {}, sections: {} };
  const base = { template: 'reflective', structure: '-', outline, slot: 'hook', mine: [], others: [], written: {} };
  assert.ok(sectionPrompt({ topic: 't', audience: 'a' }, base).includes('writing in English'));
  assert.ok(sectionPrompt({ topic: 't', audience: 'a', language: 'th' }, base).includes('writing in Thai'));
});

test('review treats a hypothetical hook as a must-fix issue', async () => {
  const { mechanicalIssues } = await import('../src/stages/index.mjs');
  const write = { title: 'Title', deck: 'Standfirst', hook: 'You just opened the app and found it blocked', why: '', step: '', actionable: '' };
  const hit = mechanicalIssues(write, countSections(write)).find(i => i.kind === 'hypothetical_opening');
  assert.ok(hit);
  assert.equal(hit.blocking, true);
  assert.equal(hit.section, 'hook');
  const clean = { ...write, hook: 'Amazon announced a block on Muse (clm1)' };
  assert.ok(!mechanicalIssues(clean, countSections(clean)).some(i => i.kind === 'hypothetical_opening'));
});

test('the word range a review checks depends on the job language', async () => {
  const { mechanicalIssues } = await import('../src/stages/index.mjs');
  const write = { title: 't', deck: 'd', hook: '', why: '', step: '', actionable: '' };
  const inEnglish = mechanicalIssues(write, { total: 1300 }, 'en').some(i => i.kind === 'word_count');
  const inThai = mechanicalIssues(write, { total: 1300 }, 'th').some(i => i.kind === 'word_count');
  assert.equal(inEnglish, false, '1,300 words is inside the English range 1,200–1,800');
  assert.equal(inThai, true, '1,300 is below the Thai range 1,500–2,200');
});

import { acceptTrim, trimPrompt } from '../src/stages/index.mjs';

test('acceptTrim accepts a shorter text that keeps every claim marker', () => {
  const original = 'The first sentence is very very very very very long (clm1) The second sentence is very very very very very long (clm2)';
  assert.equal(acceptTrim(original, 'The first sentence (clm1) The second sentence (clm2)'), true);
});

test('acceptTrim rejects trimmed text that drops a claim, is empty, or is not shorter', () => {
  const original = 'The first sentence is very very very long (clm1) The second sentence is very very very long (clm2)';
  assert.equal(acceptTrim(original, 'The first sentence (clm1)'), false);
  assert.equal(acceptTrim(original, ''), false);
  assert.equal(acceptTrim(original, original + ' and more'), false);
});

test('trimPrompt lists the claim ids and the word ceiling', () => {
  const p = trimPrompt('Some text', [{ id: 'clm1' }, { id: 'clm2' }], 900, 750);
  assert.match(p, /clm1, clm2/);
  assert.match(p, /750/);
});
