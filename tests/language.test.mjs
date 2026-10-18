import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, DEFAULT_LANGUAGE, languageProfile, normalizeLanguage } from '../src/language.mjs';

test('English is the default and unknown or missing languages fall back to it', () => {
  assert.equal(DEFAULT_LANGUAGE, 'en');
  for (const v of [undefined, null, '', 'xx', 'EN-us', 42]) assert.equal(normalizeLanguage(v), 'en', String(v));
  assert.equal(normalizeLanguage('th'), 'th');
  assert.equal(normalizeLanguage(' TH '), 'th');
  assert.equal(languageProfile('nope').code, 'en');
});

test('every profile is complete and consistent', () => {
  for (const [code, p] of Object.entries(LANGUAGES)) {
    assert.equal(p.code, code);
    assert.ok(p.name && p.wordRange.min < p.wordRange.max, code);
    assert.deepEqual(Object.keys(p.sectionTargets), ['hook', 'why', 'step', 'actionable'], code);
    for (const [lo, hi] of Object.values(p.sectionTargets)) assert.ok(lo > 0 && lo < hi, code);
    assert.ok(p.hypotheticalOpenings.length > 0 && p.hypotheticalOpenings.every(o => o.re instanceof RegExp && o.label), code);
    assert.ok(p.selfCleared instanceof RegExp && p.misattribution instanceof RegExp, code);
  }
});

test('the reviewer-remark patterns recognise English and Thai wording', () => {
  assert.ok(LANGUAGES.en.selfCleared.test('This is correct, no problem here'));
  assert.ok(!LANGUAGES.en.selfCleared.test('The number is not in any source'));
  assert.ok(LANGUAGES.en.misattribution.test('The quote is wrongly attributed to the CEO'));
  assert.ok(LANGUAGES.th.selfCleared.test('ไม่มีปัญหา'));
  assert.ok(LANGUAGES.th.misattribution.test('อ้างผิดคน'));
});
