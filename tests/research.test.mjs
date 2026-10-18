import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyClaims } from '../src/stages/research.mjs';
import { htmlToText } from '../src/adapters/webFetch.mjs';

// There is no real textFile → verifyClaims falls back to the excerpt
const job = { id: 'OBA-00000000' };
const sources = [
  { id: 'src1', textFile: 'sources/none.txt', excerpt: 'Google said on Tuesday that hackers used its Gemini model to target three companies.\nThe “investigation” is ongoing.' },
  { id: 'src2', textFile: 'sources/none.txt', excerpt: 'กระทรวงดิจิทัลฯ ระบุว่า มีผู้ใช้บริการ   ภาครัฐออนไลน์เพิ่มขึ้นร้อยละ 20 ในปี 2568' }
];

const claim = (quotes, status = 'verified') => ({ id: 'c', claim: 'x', status, source_ids: quotes.map(q => q.source_id), quotes });

test('exact quote in fetched text is verified', async () => {
  const [c] = await verifyClaims(job, [claim([{ source_id: 'src1', text: 'hackers used its Gemini model to target three companies' }])], sources);
  assert.equal(c.status, 'verified');
});

test('fabricated quote is downgraded to needs_verification', async () => {
  const [c] = await verifyClaims(job, [claim([{ source_id: 'src1', text: 'Google confirmed at least five companies were breached' }])], sources);
  assert.equal(c.status, 'needs_verification');
  assert.equal(c.model_status, 'verified');
  assert.equal(c.verification_note, 'quote not found in fetched source text');
});

test('quote attributed to the wrong source is not verified', async () => {
  const [c] = await verifyClaims(job, [claim([{ source_id: 'src2', text: 'hackers used its Gemini model to target three companies' }])], sources);
  assert.equal(c.status, 'needs_verification');
});

test('unknown source id is not verified', async () => {
  const [c] = await verifyClaims(job, [claim([{ source_id: 'src9', text: 'hackers used its Gemini model' }])], sources);
  assert.equal(c.status, 'needs_verification');
});

test('claim without quotes is not verified', async () => {
  const [c] = await verifyClaims(job, [claim([])], sources);
  assert.equal(c.status, 'needs_verification');
  assert.equal(c.verification_note, 'no quote provided');
});

test('whitespace, case and curly quotes do not break a real match', async () => {
  const [c] = await verifyClaims(job, [claim([{ source_id: 'src1', text: 'The  "INVESTIGATION"\n is ongoing' }])], sources);
  assert.equal(c.status, 'verified');
});

test('Thai quote with collapsed spaces matches', async () => {
  const [c] = await verifyClaims(job, [claim([{ source_id: 'src2', text: 'มีผู้ใช้บริการ ภาครัฐออนไลน์เพิ่มขึ้นร้อยละ 20' }])], sources);
  assert.equal(c.status, 'verified');
});

test('ellipsis quote needs every fragment to match', async () => {
  const ok = await verifyClaims(job, [claim([{ source_id: 'src1', text: 'Google said on Tuesday ... to target three companies' }])], sources);
  assert.equal(ok[0].status, 'verified');
  const bad = await verifyClaims(job, [claim([{ source_id: 'src1', text: 'Google said on Tuesday ... to target nine hundred companies' }])], sources);
  assert.equal(bad[0].status, 'needs_verification');
});

test('matched quote stays unverified if the reviewer marked it unverified', async () => {
  const [c] = await verifyClaims(job, [claim([{ source_id: 'src1', text: 'hackers used its Gemini model to target three companies' }], 'unverified')], sources);
  assert.equal(c.status, 'needs_verification');
});

test('htmlToText drops scripts and keeps readable text', () => {
  const text = htmlToText('<html><head><style>p{}</style><script>alert(1)</script></head><body><p>Hello&nbsp;<b>world</b> &amp; friends</p><p>สวัสดี&#3585;</p></body></html>');
  assert.equal(text, 'Hello world & friends\nสวัสดีก');
});

import { cleanTranscripts, transcriptSource } from '../src/stages/research.mjs';

test('cleanTranscripts drops too-short text, trims, names unlabeled items and caps the count', () => {
  const long = 'Ms. A: ' + 'Interview text goes here. '.repeat(10);
  const out = cleanTranscripts([{ label: '  Interview with Ms. A  ', text: long }, { label: 'Short', text: 'too short' }, { text: long }, null, 'x']);
  assert.equal(out.length, 2);
  assert.equal(out[0].label, 'Interview with Ms. A');
  assert.equal(out[1].label, 'Interview 2');
  assert.equal(cleanTranscripts('not an array').length, 0);
  assert.equal(cleanTranscripts(Array(9).fill({ text: long })).length, 5);
});

test('a transcript source is verified like a page: quotes must appear in its text', async () => {
  const text = 'Ms. A: At that point we had no money left, but we decided to keep the shop open because our regular customers were still waiting at the door every morning';
  const src = transcriptSource({ label: 'Interview with Ms. A', text }, 0, '2026-10-01T00:00:00Z');
  assert.equal(src.id, 'src1');
  assert.equal(src.retrieval_method, 'user_transcript');
  const mk = (id, q) => ({ id, claim: 'x', status: 'verified', source_ids: ['src1'], quotes: [{ source_id: 'src1', text: q }] });
  const claims = [
    mk('clm1', 'we decided to keep the shop open because our regular customers were still waiting'),
    mk('clm2', 'sales tripled within a single month')
  ];
  const out = await verifyClaims({ id: 'OBA-00000000' }, claims, [src]);
  assert.equal(out.find(c => c.id === 'clm1').status, 'verified');
  assert.notEqual(out.find(c => c.id === 'clm2').status, 'verified');
});

import { isPrimarySource, pickPrimaryQueries, wantsNewsSearch } from '../src/stages/research.mjs';
import { searchSerperNews } from '../src/adapters/webSearch.mjs';

test('isPrimarySource recognises government, court and press-release pages only', () => {
  assert.equal(isPrimarySource('https://www.sec.gov/litigation/x'), true);
  assert.equal(isPrimarySource('https://www.mdes.go.th/news/1'), true);
  assert.equal(isPrimarySource('https://www.alabamaag.gov/release'), true);
  assert.equal(isPrimarySource('https://newsroom.example.com/x'), false);
  assert.equal(isPrimarySource('https://example.com/newsroom/tiktok-statement'), true);
  assert.equal(isPrimarySource('https://www.theverge.com/2026/a'), false);
  assert.equal(isPrimarySource('not a url'), false);
});

test('pickPrimaryQueries adds at most one query and skips duplicates of the general ones', () => {
  const job = { stages: { brief: { result: { primarySourceQueries: ['TikTok Alabama settlement press release', 'another query'] } } } };
  assert.deepEqual(pickPrimaryQueries(job, []), ['TikTok Alabama settlement press release']);
  assert.deepEqual(pickPrimaryQueries(job, ['tiktok alabama settlement press release']), ['another query']);
  assert.deepEqual(pickPrimaryQueries({ stages: {} }, []), []);
});

test('news search is used only for the news_analysis template', () => {
  assert.equal(wantsNewsSearch({ template: 'auto', stages: { brief: { result: { template: 'news_analysis' } } } }), true);
  assert.equal(wantsNewsSearch({ template: 'reflective', stages: {} }), false);
});

test('searchSerperNews maps the news endpoint and returns [] without a key', async () => {
  assert.deepEqual(await searchSerperNews('q', ''), []);
  const real = globalThis.fetch;
  let calledUrl = '';
  globalThis.fetch = async (url) => { calledUrl = url; return { ok: true, json: async () => ({ news: [{ title: 'T', link: 'https://a.com/x', snippet: 's', date: '1 hour ago' }] }) }; };
  try {
    const out = await searchSerperNews('ติ๊กต็อก', 'k');
    assert.equal(calledUrl, 'https://google.serper.dev/news');
    assert.equal(out[0].provider, 'serper_news');
    assert.equal(out[0].url, 'https://a.com/x');
  } finally { globalThis.fetch = real; }
});

import { searchBrave } from '../src/adapters/webSearch.mjs';

test('searchBrave sends the key in a header, adds search_lang=th only for Thai, maps results', async () => {
  assert.deepEqual(await searchBrave('q', ''), []);
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), headers: init.headers }); return { ok: true, json: async () => ({ web: { results: [{ title: 'T', url: 'https://a.com/x', description: 'd', page_age: '2026-09-25' }] } }) }; };
  try {
    const en = await searchBrave('TikTok Alabama', 'SECRET');
    const th = await searchBrave('ติ๊กต็อก ยุติคดี', 'SECRET');
    assert.equal(en[0].provider, 'brave');
    assert.equal(en[0].snippet, 'd');
    assert.ok(!calls[0].url.includes('search_lang'));
    assert.ok(calls[1].url.includes('search_lang=th'));
    assert.ok(!calls[0].url.includes('country='), 'country TH is rejected by Brave');
    assert.ok(!calls[0].url.includes('SECRET'));
    assert.equal(calls[0].headers['X-Subscription-Token'], 'SECRET');
  } finally { globalThis.fetch = real; }
});

import { pickRelevanceTerms, isRelevantText } from '../src/stages/research.mjs';

test('relevance gate: a page must mention at least one brief-chosen term, no terms means no filter', () => {
  const flood = 'The trade department checked goods prices after the Bangkok flood; some vegetables rose';
  const middleEast = 'The trade department is monitoring consumer goods prices because of the Middle East situation; 59 controlled items';
  assert.equal(isRelevantText(flood, ['flood']), true);
  assert.equal(isRelevantText(middleEast, ['น้ำท่วม', 'flood']), false);
  assert.equal(isRelevantText('Bangkok FLOOD prices', ['น้ำท่วม', 'flood']), true, 'case-insensitive, any term');
  assert.equal(isRelevantText('กรมการค้าภายในตรวจสอบราคาสินค้าหลังเหตุน้ำท่วม', ['น้ำท่วม']), true, 'Thai terms work too');
  assert.equal(isRelevantText(middleEast, []), true);
  assert.deepEqual(pickRelevanceTerms({ stages: { brief: { result: { relevanceTerms: [' flood ', 'x', '', 5] } } } }), ['flood']);
  assert.deepEqual(pickRelevanceTerms({ stages: {} }), []);
});

import { blockedReason, isPrivateAddress, fetchPage } from '../src/adapters/webFetch.mjs';

test('the page fetcher refuses loopback, private, link-local and local-name targets (SSRF guard)', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.5', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  for (const url of ['http://127.0.0.1:8080/api/jobs', 'http://localhost/x', 'http://[::1]/x', 'http://169.254.169.254/latest/meta-data/', 'http://printer.local/', 'http://db.internal/', 'ftp://example.com/x', 'file:///etc/passwd']) {
    assert.ok(await blockedReason(url), url);
  }
  const page = await fetchPage('http://127.0.0.1:8080/api/jobs');
  assert.equal(page.ok, false);
  assert.match(page.error, /Refused/);
});

test('a redirect to a private address is refused at the second hop', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 302, ok: false, headers: new Headers({ location: 'http://127.0.0.1:8080/api/jobs' }) });
  try {
    const page = await fetchPage('http://8.8.8.8/start');
    assert.equal(page.ok, false);
    assert.match(page.error, /Refused/);
  } finally { globalThis.fetch = real; }
});
