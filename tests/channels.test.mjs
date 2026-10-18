import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberCitations, buildBlockdit, buildImagePlan } from '../src/stages/channels.mjs';
import { briefRules, evidenceRules, writeRules, reviewRules, avoidWords, slotGuide, TEMPLATE_IDS } from '../src/rules.mjs';
import { countSections } from '../src/stages/checks.mjs';

const sources = [
  { id: 'src1', title: 'Amazon blocks Muse', url: 'https://www.theverge.com/a', finalUrl: 'https://www.theverge.com/a', publishedDate: '2026-09-21T10:00:00Z', accessedAt: '2026-09-26T12:00:00Z' },
  { id: 'src2', title: 'CNBC report', url: 'https://cnbc.com/b', accessedAt: '2026-09-26T12:05:00Z' },
  { id: 'src3', title: 'Unused', url: 'https://x.com/c', accessedAt: '2026-09-26T12:00:00Z' }
];
const claims = [
  { id: 'clm1', status: 'verified', source_ids: ['src2'] },
  { id: 'clm2', status: 'verified', source_ids: ['src1', 'src2'] }
];
const write = {
  title: 'The title (clm1)', deck: 'The standfirst',
  headings: { hook: 'What happened', why: 'Why it matters', step: 'Background', actionable: 'What you can do' },
  hook: 'Amazon blocked Muse (clm2) already', why: 'Shares rose (clm1)', step: 'A claim that does not exist (clm9) here', actionable: 'The close',
  coverImagePrompt: 'Cover picture', stepImagePrompt: 'Middle picture'
};

test('claim markers become source numbers in order of first citation', () => {
  const { text, cited } = numberCitations(write, claims, sources);
  assert.equal(text.hook, 'Amazon blocked Muse [1][2] already'); // clm2 → src1, src2
  assert.equal(text.why, 'Shares rose [2]');                       // clm1 → src2 (already #2)
  assert.equal(text.step, 'A claim that does not exist here');     // unknown claim → marker removed
  assert.equal(text.title, 'The title');                            // no numbers in the title
  assert.deepEqual(cited.map(c => [c.n, c.source.id]), [[1, 'src1'], [2, 'src2']]);
});

test('Blockdit body has the adapted headings, numbered sources, no image links', () => {
  const b = buildBlockdit({ topic: 't' }, write, claims, sources);
  assert.ok(b.body.includes('## What happened'));
  assert.ok(!b.body.includes('## Hook'));
  assert.ok(!/!\[[^\]]*\]\(/.test(b.body), 'no markdown image links');
  assert.ok(!b.body.includes('AI-generated'));
  assert.ok(b.body.includes('1. [Amazon blocks Muse](https://www.theverge.com/a) — theverge.com · published 2026-09-21 · accessed 2026-09-26'));
  assert.ok(b.body.includes('2. [CNBC report](https://cnbc.com/b) — cnbc.com · accessed 2026-09-26'));
  assert.ok(!b.body.includes('Unused'));
  assert.ok(b.body.includes('checked against its sources as of 2026-09-26'));
  assert.ok(!/clm\d/.test(b.body));
});

test('the fixed words the system adds follow the article language', () => {
  const th = buildBlockdit({ topic: 't', language: 'th' }, write, claims, sources);
  assert.ok(th.body.includes('ตรวจสอบกับแหล่งที่มา ณ วันที่ 2026-09-26'));
  assert.ok(th.body.includes('เผยแพร่ 2026-09-21'));
  const plan = buildImagePlan({ topic: 't', language: 'th' }, write, write.headings);
  assert.ok(plan.includes('ร่างรอภาพ'));
});

test('image plan lists only proposed images and marks draft as awaiting images', () => {
  const plan = buildImagePlan({ topic: 't' }, write, write.headings);
  assert.ok(plan.includes('draft awaiting images'));
  assert.ok(plan.includes('Cover image'));
  assert.ok(plan.includes('Within the section "Background"'));
  assert.equal((plan.match(/^## /gm) || []).length, 2);
});

test('claim markers are not counted as words', () => {
  assert.equal(countSections({ hook: 'Hello (clm1, clm2)', why: '', step: '', actionable: '' }).total, 1);
});

test('rule loader gives each stage its sections from the rule files', () => {
  assert.match(briefRules(), /## Goal/);
  assert.match(evidenceRules(), /## Evidence/);
  assert.match(reviewRules(), /## Review and delivery/);
  for (const id of TEMPLATE_IDS) {
    const w = writeRules(id);
    assert.match(w, /## Principles/, 'voice library');
    assert.match(w, /## Writing instructions/, 'blockdit article template');
    assert.match(w, new RegExp(`template_id: ${id}`), 'selected template yaml');
    assert.ok(slotGuide(id).split('\n').length === 4);
  }
  assert.ok(avoidWords().includes('shocking'));
});

test('a transcript source is listed without a link', () => {
  const tr = { id: 'src1', title: 'Interview with Ms. A', url: '', retrieval_method: 'user_transcript', accessedAt: '2026-09-26T12:00:00Z' };
  const b = buildBlockdit({ topic: 't' }, write, [{ id: 'clm1', status: 'verified', source_ids: ['src1'] }, { id: 'clm2', status: 'verified', source_ids: ['src1'] }], [tr]);
  assert.ok(b.body.includes('1. Interview with Ms. A — interview / original text supplied by the team (no link)'));
});

import { SLOT_MAP } from '../src/rules.mjs';

test('every template has a slot map whose stage names exist in its yaml', () => {
  for (const id of TEMPLATE_IDS) {
    assert.ok(SLOT_MAP[id], `${id} has slot map`);
    const rules = writeRules(id);
    for (const stages of Object.values(SLOT_MAP[id])) {
      for (const name of stages) assert.ok(rules.includes(`name: ${name}`), `${id}: stage "${name}" in yaml`);
    }
  }
  assert.ok(TEMPLATE_IDS.includes('news_analysis'));
});

import { PILLARS } from '../src/rules.mjs';
import { readFileSync } from 'node:fs';

test('PILLARS are the five fixed names and match rules/AUTOMATION_RULES.md and the UI select', () => {
  assert.deepEqual(PILLARS, ['Human+AI', 'Life Skills', 'Documentary', 'Questions', 'Legacy']);
  const rules = readFileSync(new URL('../rules/AUTOMATION_RULES.md', import.meta.url), 'utf8');
  assert.ok(rules.includes(PILLARS.join(' / ')));
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const p of PILLARS) assert.ok(html.includes('<option value="' + p + '">'), p + ' in UI');
});
