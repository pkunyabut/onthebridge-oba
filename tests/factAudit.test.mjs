import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberTokens, claimUnits, auditText, renderFactCheck } from '../src/factAudit.mjs';

const sourceText = 'TikTok agreed to pay at least $100 million to settle the lawsuit filed by Alabama Attorney General Steve Marshall on September 22, 2026. The company said it would add protections for minors. The settlement was announced in Montgomery.';
const sources = [
  { n: 1, id: 'src1', title: 'Settlement report', url: 'https://example.com/a', primary_source: false, text: sourceText },
  { n: 2, id: 'src2', title: 'Press release', url: 'https://example.gov/b', primary_source: true, text: 'The office said the agreement covers 100,000,000 dollars in total.' }
];

test('numberTokens strips commas and adds scaled values so 100,000,000 matches "100 million"', () => {
  const t = numberTokens('paid 100,000,000 dollars on 09/2026', { scaled: true });
  assert.ok(t.has('100000000'));
  assert.ok(t.has('100'));
  assert.ok(!numberTokens('paid 100,000,000').has('100'), 'article side is not scaled');
  assert.ok(t.has('9'));
  assert.ok(t.has('2026'));
  assert.ok(numberTokens('๑๐๐ ล้าน').has('100'), 'Thai digits are read as numbers');
});

test('claimUnits splits at citation markers and keeps uncited tails', () => {
  const body = '## Heading\n\nTikTok agreed to pay 100 million dollars [1] The state sued in 2026 [1][2] A trailing sentence with no reference\n\n---\n\n*Checked on*\n\n**Sources:**\n1. x';
  const units = claimUnits(body);
  assert.equal(units.length, 3);
  assert.deepEqual(units[0].cited, [1]);
  assert.deepEqual(units[1].cited, [1, 2]);
  assert.deepEqual(units[2].cited, []);
});

test('a correct sentence passes: number, year and names all found in the cited sources', () => {
  const body = 'TikTok agreed to pay at least 100 million dollars [1] Attorney General Steve Marshall of Alabama filed the suit on 22 September 2026 [1]';
  const r = auditText(body, sources);
  assert.equal(r.flags.length, 0, JSON.stringify(r.flags));
});

test('Buddhist-era years in a Thai article match the Common-Era year in the source', () => {
  const body = 'ติ๊กต็อกยอมจ่ายอย่างน้อย 100 ล้านดอลลาร์ [1] อัยการสูงสุดรัฐแอละแบมา Steve Marshall ยื่นฟ้องเมื่อ 22 กันยายน 2569 [1]';
  const r = auditText(body, sources);
  assert.equal(r.flags.length, 0, JSON.stringify(r.flags));
});

test('a changed number and an invented name are flagged', () => {
  const body = 'TikTok agreed to pay at least 150 million dollars [1] The case was filed by John Smith [1]';
  const r = auditText(body, sources);
  const kinds = r.flags.map(f => `${f.kind}:${f.token}`);
  assert.ok(kinds.includes('number:150'), kinds.join());
  assert.ok(kinds.includes('name:John Smith'), kinds.join());
});

test('a number supported only by another source is flagged when the sentence cites the wrong one', () => {
  const body = 'The agreement covers 100,000,000 dollars [1]';
  assert.equal(auditText(body, sources).flags.length, 0, 'scaled match makes 100,000,000 ok via source 1 ($100 million)');
  const wrong = 'The agreement covers 777 dollars [2]';
  assert.equal(auditText(wrong, sources).flags[0].token, '777');
});

test('uncited sentence with a fact not in any source is flagged; unknown citation number is flagged', () => {
  const r1 = auditText('The company has 4321 employees', sources);
  assert.equal(r1.flags[0].token, '4321');
  const r2 = auditText('A note about TikTok [9]', sources);
  assert.ok(r2.flags.some(f => f.kind === 'citation'));
});

test('untranslatable quotes are flagged for a human check and allegations rank first', () => {
  const body = 'The executive said “we will protect every child completely” [1] The company is in Montgomery [1] The state sued the company in court [1]';
  const r = auditText(body, sources);
  assert.ok(r.flags.some(f => f.kind === 'quote'));
  assert.ok(r.rows[0].flagged, 'flagged row first');
  assert.ok(r.rows.some(x => x.risks.includes('allegation')));
});

test('renderFactCheck lists flags, sources and risk rows', () => {
  const r = auditText('TikTok agreed to pay 150 million dollars [1]', sources);
  const md = renderFactCheck({ topic: 'Test' }, r, sources);
  assert.match(md, /Check yourself \(1 item\(s\)\)/);
  assert.match(md, /\[2\] Press release — https:\/\/example\.gov\/b · primary source/);
  assert.match(md, /with no AI/);
});

test('spelled-out numbers in the source match digits in the article', () => {
  const src = [{ n: 1, id: 's', title: 't', url: 'https://x.com', text: 'The model can clone a voice from three seconds of audio, and สอง companies agreed.' }];
  assert.equal(auditText('The model clones a voice from a 3 second sample [1] and 2 companies agreed [1]', src).flags.length, 0);
  assert.equal(auditText('The model clones a voice from an 8 second sample [1]', src).flags[0].token, '8');
});

test('short quoted phrases are only tagged risky, long cited quotes are flagged', () => {
  const src = [{ n: 1, id: 's', title: 't', url: 'https://x.com', text: 'nothing relevant here' }];
  const short = auditText('The answer is “do not use it” as the writer sees it [1]', src);
  assert.equal(short.flags.length, 0);
  assert.ok(!short.rows.some(r => r.risks.includes('quote')), 'short quotes are not even tagged');
  const long = auditText('The executive said “we will protect every child at every moment” [1]', src);
  assert.ok(long.flags.some(f => f.kind === 'quote'));
});

test('author opinion without a citation is not listed as risky, and "agreement" alone is not an allegation', () => {
  const src = [{ n: 1, id: 's', title: 't', url: 'https://x.com', text: 'The bank lost 95 million euros.' }];
  const r = auditText('In the writer\'s view this shakes belief more than the figure of 95 million euros, a matter of “hearing the voice of someone you know” that the bank long relied on', src);
  assert.equal(r.rows.length, 0);
  assert.equal(r.flags.length, 0);
  const agreement = auditText('A confidentiality agreement is attached [1]', src);
  assert.ok(!agreement.rows.some(x => x.risks.includes('allegation')));
  const fraud = auditText('The bank was sued over the violation [1]', src);
  assert.ok(fraud.rows[0].risks.includes('allegation'));
});
