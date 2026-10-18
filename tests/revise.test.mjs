import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRevision, locate } from '../src/stages/revise.mjs';

const draft = {
  title: 'Amazon blocks Muse',
  deck: 'The standfirst',
  hook: 'Imagine you order something and then see a warning message. This is a hypothetical situation many users really face.\n\nThe second paragraph of the hook',
  why: 'Amazon sued Perplexity in November\n\nThe second reason',
  step: 'Step 1 explained',
  actionable: 'The closing summary'
};

test('replaces only the flagged sentence and keeps the rest untouched', () => {
  const { draft: out, log } = applyRevision(draft, {
    patches: [{ issue: 1, section: 'why', original: 'Amazon sued Perplexity in November', replacement: 'Amazon sued Perplexity in November 2025' }]
  });
  assert.equal(out.why, 'Amazon sued Perplexity in November 2025\n\nThe second reason');
  assert.equal(out.hook, draft.hook);
  assert.equal(out.step, draft.step);
  assert.equal(log[0].applied, true);
});

test('empty replacement removes the sentence cleanly', () => {
  const { draft: out } = applyRevision(draft, {
    patches: [{ section: 'hook', original: 'This is a hypothetical situation many users really face.', replacement: '' }]
  });
  assert.equal(out.hook, 'Imagine you order something and then see a warning message.\n\nThe second paragraph of the hook');
});

test('patch whose original text is not in the draft is skipped, not guessed', () => {
  const { draft: out, log } = applyRevision(draft, {
    patches: [{ section: 'why', original: 'A sentence that is not there', replacement: 'x' }]
  });
  assert.deepEqual(out, draft);
  assert.equal(log[0].applied, false);
});

test('patch with the wrong section is found in another section', () => {
  const { draft: out, log } = applyRevision(draft, {
    patches: [{ section: 'step', original: 'The closing summary', replacement: 'A new summary' }]
  });
  assert.equal(out.actionable, 'A new summary');
  assert.equal(log[0].section, 'actionable');
});

test('locate tolerates different whitespace and line breaks', () => {
  const text = 'First paragraph\n\nAmazon  sued\nPerplexity already';
  const at = locate(text, 'Amazon sued Perplexity');
  assert.equal(text.slice(at.start, at.end), 'Amazon  sued\nPerplexity');
});

test('locate works on Thai text too', () => {
  const text = 'ย่อหน้าแรก\n\nAmazon  ฟ้อง\nPerplexity แล้ว';
  const at = locate(text, 'Amazon ฟ้อง Perplexity');
  assert.equal(text.slice(at.start, at.end), 'Amazon  ฟ้อง\nPerplexity');
});

test('addition is inserted after the anchor paragraph', () => {
  const { draft: out } = applyRevision(draft, {
    additions: [{ section: 'why', after: 'Amazon sued Perplexity in November', text: 'A new paragraph' }]
  });
  assert.equal(out.why, 'Amazon sued Perplexity in November\n\nA new paragraph\n\nThe second reason');
});

test('addition without anchor goes to the end of the section', () => {
  const { draft: out } = applyRevision(draft, { additions: [{ section: 'step', after: '', text: 'Step 2' }] });
  assert.equal(out.step, 'Step 1 explained\n\nStep 2');
});

test('additions cannot target title/deck or be empty', () => {
  const { draft: out, log } = applyRevision(draft, {
    additions: [{ section: 'title', text: 'x' }, { section: 'why', text: '  ' }]
  });
  assert.deepEqual(out, draft);
  assert.equal(log.filter(l => l.applied).length, 0);
});

test('malformed AI output does not crash', () => {
  assert.deepEqual(applyRevision(draft, { raw: 'not json' }).draft, draft);
  assert.deepEqual(applyRevision(draft, { patches: 'x', additions: null }).draft, draft);
});

import { usedClaimIds } from '../src/stages/revise.mjs';

test('usedClaimIds finds every claim already cited in the draft', () => {
  const ids = usedClaimIds({ title: 'x', hook: 'a (clm1, clm3)', why: 'b [CLM2]', step: 'none', actionable: '' });
  assert.deepEqual([...ids].sort(), ['clm1', 'clm2', 'clm3']);
});

// ─── Duplicate paragraphs ────────────────────────────────────────────────────

import { findDuplicateParagraphs } from '../src/stages/checks.mjs';
import { dropDuplicateParagraphs } from '../src/stages/channels.mjs';

const P1 = 'Amazon previously sued Perplexity over its Comet browser and moved to block shopping agents from Google and OpenAI earlier than this (clm10)';
const P2 = 'Amazon has a similar product called Alexa for Shopping, launched in May, with a Buy for Me feature that searches products on outside brand websites (clm13)';

test('verbatim duplicate paragraphs across sections are detected', () => {
  const d = findDuplicateParagraphs({ hook: P1, why: 'An unrelated paragraph that is long enough to count as a paragraph, with plenty of different words in it for the test', step: P1 });
  assert.equal(d.length, 1);
  assert.equal(d[0].duplicate.section, 'step');
});

test('different paragraphs are not flagged as duplicates', () => {
  assert.equal(findDuplicateParagraphs({ hook: P1, why: P2 }).length, 0);
});

test('channels drops exact duplicate paragraphs and keeps the first', () => {
  const { write, removed } = dropDuplicateParagraphs({ hook: P1, why: `${P2}\n\n${P1}`, step: P2, actionable: '' });
  assert.equal(removed.length, 2);
  assert.equal(write.hook, P1);
  assert.equal(write.why, P2);
  assert.equal(write.step, '');
});

test('revision refuses an addition that copies an existing paragraph', () => {
  const { draft, log } = applyRevision({ hook: P1, why: 'x', step: 'y', actionable: 'z' }, { additions: [{ section: 'step', text: P1 }] });
  assert.equal(draft.step, 'y');
  assert.match(log[0].reason, /duplicates an existing paragraph/);
});

test('revision refuses an addition that only re-cites facts already used', () => {
  const { draft, log } = applyRevision({ hook: P1, why: 'x', step: 'y', actionable: 'z' },
    { additions: [{ section: 'why', text: 'Told again in other words: Amazon had already taken AI companies to court (clm10)' }] });
  assert.equal(draft.why, 'x');
  assert.match(log[0].reason, /only repeats facts/);
});
