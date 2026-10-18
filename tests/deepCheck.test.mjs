import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, confirmsSentence } from '../src/deepCheck.mjs';
import { keyTerms, relevantFactChecks, searchFactChecks } from '../src/adapters/factCheck.mjs';
import { classifyRecheck } from '../src/sourceRecheck.mjs';
import { secondSourceText } from '../src/factAudit.mjs';

test('confirmsSentence needs at least two facts and every number and name present on the page', () => {
  const page = 'TikTok agreed to pay $100 million to settle the suit by Alabama on September 22, 2026, officials said in a statement released today.';
  assert.equal(confirmsSentence('TikTok agreed to pay 100 million dollars to settle with the state of Alabama', page), true);
  assert.equal(confirmsSentence('TikTok agreed to pay 150 million dollars', page), false, 'wrong number');
  assert.equal(confirmsSentence('The company TikTok agreed to pay', page), false, 'only one fact');
  assert.equal(confirmsSentence('The case was filed by Alabama and Texas', page), false, 'name missing from page');
});

test('buildQuery prefers a Latin-script evidence quote, else names plus numbers', () => {
  assert.equal(buildQuery({ sentence: 'A sentence', evidence: 'TikTok agreed to pay at least $100 million' }), 'TikTok agreed to pay at least $100 million');
  const q = buildQuery({ sentence: 'TikTok paid 100 million to Alabama in 2026', evidence: 'ข้อความไทยล้วน' });
  assert.match(q, /TikTok/);
  assert.match(q, /Alabama/);
  assert.match(q, /100/);
});

test('relevantFactChecks keeps only reviews sharing enough key terms with the query', () => {
  const query = 'COVID-19 vaccines have a microchip that tracks the location of the patient';
  const claims = [
    { text: 'COVID-19 vaccines have a microchip that "tracks the location of the patient."', claimReview: [{ url: 'https://fc.org/a', title: 'No microchip in vaccines', publisher: { name: 'FactCheck.org' }, textualRating: 'False' }] },
    { text: 'A real video shows the eye of hurricane Polo from a plane window', claimReview: [{ url: 'https://ls.com/b', title: 'Hurricane video', publisher: { name: 'Lead Stories' }, textualRating: 'Made With AI' }] }
  ];
  const out = relevantFactChecks(query, claims);
  assert.equal(out.length, 1);
  assert.equal(out[0].publisher, 'FactCheck.org');
  assert.deepEqual(relevantFactChecks('short', claims), []);
  assert.ok(keyTerms('Alabama paid 100,000 dollars').has('100000'));
});

test('searchFactChecks sends the key in a header, not in the URL, and returns [] without a key', async () => {
  assert.deepEqual(await searchFactChecks('q', ''), []);
  const real = globalThis.fetch;
  let seen = {};
  globalThis.fetch = async (url, init) => { seen = { url: String(url), headers: init.headers }; return { ok: true, json: async () => ({ claims: [{ text: 'x' }] }) }; };
  try {
    const out = await searchFactChecks('some claim', 'SECRET-KEY');
    assert.equal(out.length, 1);
    assert.ok(!seen.url.includes('SECRET-KEY'));
    assert.equal(seen.headers['X-Goog-Api-Key'], 'SECRET-KEY');
  } finally { globalThis.fetch = real; }
});

test('classifyRecheck distinguishes unreachable, missing quote, changed page and unchanged page', () => {
  const oldText = 'The company confirmed that it will pay a fine of one hundred million dollars within this year under the agreement signed with the state. ' + 'supporting detail '.repeat(30);
  const quote = 'will pay a fine of one hundred million dollars within this year';
  assert.equal(classifyRecheck({ ok: false, error: 'HTTP 404' }).status, 'unreachable');
  assert.equal(classifyRecheck({ ok: true, oldText, newText: oldText, quotes: [quote] }).status, 'same');
  assert.equal(classifyRecheck({ ok: true, oldText, newText: oldText.replace('one hundred million', 'fifty million'), quotes: [quote] }).status, 'quote_missing');
  assert.equal(classifyRecheck({ ok: true, oldText, newText: 'Entirely new page content unrelated to the old one '.repeat(20), quotes: [] }).status, 'changed');
});

test('secondSourceText describes each status honestly', () => {
  assert.match(secondSourceText({ status: 'confirmed', url: 'https://a.com', title: 'T' }), /Confirmed by a second source/);
  assert.match(secondSourceText({ status: 'not_found', tried: 3 }), /does not mean it is wrong/);
});
