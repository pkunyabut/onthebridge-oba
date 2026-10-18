import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orgKey, summarizeEvidence, evidenceNote } from '../src/evidenceBase.mjs';

test('orgKey groups pages of one site and handles second-level country domains', () => {
  assert.equal(orgKey('https://www.dit.go.th/th/news/press-releases/1'), 'dit.go.th');
  assert.equal(orgKey('https://lopburi.moc.go.th/x'), 'moc.go.th');
  assert.equal(orgKey('https://www.thaipbs.or.th/news/1'), 'thaipbs.or.th');
  assert.equal(orgKey('https://www.nytimes.com/a'), 'nytimes.com');
  assert.equal(orgKey('https://news.bbc.co.uk/a'), 'bbc.co.uk');
  assert.equal(orgKey('https://docs.python.org/3/'), 'python.org');
  assert.equal(orgKey('not a url'), 'unknown');
});

const claim = (id, text, ...src) => ({ id, status: 'verified', claim: text, source_ids: src });
const src = (id, url, extra = {}) => ({ id, url, ...extra });

// 16 facts that share almost no words, so they are never counted as duplicates of each other
const FACTS = [
  'Rice prices in the northern markets rose by four baht per kilogram',
  'The Meteorological Department warned of heavy rain across central provinces for two days',
  'Shelters opened to receive three hundred displaced households',
  'Banks offered six months of debt relief to affected customers',
  'The Red Cross distributed five thousand survival kits',
  'Field hospitals handled a surge of skin infections',
  'Electricity was cut in risk zones for safety reasons',
  'Metro trains extended late night service temporarily',
  'Schools closed for three days in the eastern districts',
  'Farmers lost over ten thousand rai of paddy in Pathum Thani',
  'Insurers opened a special online claims channel',
  'A complaint hotline for price gouging runs around the clock',
  'Retail associations confirmed essentials are not running short',
  'The governor of Nonthaburi declared a disaster zone',
  'Some fresh markets closed after water blocked their entrances',
  'Canal pumping through Lat Phrao was increased'
];

test('thin: one agency across many pages, few organizations', () => {
  const sources = [src('s1', 'https://dit.go.th/a'), src('s2', 'https://dit.go.th/b'), src('s3', 'https://thaipbs.or.th/c')];
  const claims = [];
  for (let i = 0; i < 9; i++) claims.push(claim('c' + i, FACTS[i], i % 2 ? 's1' : 's2'));
  claims.push(claim('c9', 'Thai PBS reported welcome packs for evacuees at the temporary shelter', 's3'));
  const e = summarizeEvidence(claims, sources);
  assert.equal(e.level, 'thin');
  assert.equal(e.organizations[0].name, 'dit.go.th');
  assert.equal(e.organizations[0].pages, 2);
  assert.ok(e.reasons.some(r => r.includes('dit.go.th')), e.reasons.join('|'));
  assert.ok(evidenceNote(e).includes('Thin evidence base'));
});

test('enough: many distinct claims from several organizations', () => {
  const sources = ['a.com', 'b.com', 'c.go.th', 'd.org'].map((h, i) => src('s' + i, `https://${h}/x`, i === 2 ? { primary_source: true } : {}));
  const claims = [];
  for (let i = 0; i < 16; i++) claims.push(claim('c' + i, FACTS[i], 's' + (i % 4)));
  const e = summarizeEvidence(claims, sources);
  assert.equal(e.level, 'enough', e.reasons.join('|'));
  assert.equal(evidenceNote(e), '');
  assert.equal(e.primaryPages, 1);
});

test('near-duplicate claims are counted once; unverified claims and transcripts handled', () => {
  const sources = [src('s1', 'https://a.com/x'), src('s2', '', { retrieval_method: 'user_transcript' })];
  const claims = [
    claim('c1', 'The trade department opened a hotline for price complaints during the floods', 's1'),
    claim('c2', 'The trade department opened a hotline for price complaints during the floods', 's1'),
    { id: 'c3', status: 'needs_verification', claim: 'did not pass', source_ids: ['s1'] },
    claim('c4', 'The interviewee said the price of rice did not change at all', 's2')
  ];
  const e = summarizeEvidence(claims, sources);
  assert.equal(e.verifiedClaims, 3);
  assert.equal(e.uniqueClaims, 2);
  assert.equal(e.duplicateClaims, 1);
  assert.ok(e.organizations.some(o => o.name === 'interview supplied by the team'));
});

test('empty input does not crash and is thin', () => {
  const e = summarizeEvidence([], []);
  assert.equal(e.level, 'thin');
  assert.equal(e.uniqueClaims, 0);
});
