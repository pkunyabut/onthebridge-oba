import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { handleAPI } from '../src/core.mjs';
import { jobDir } from '../src/paths.mjs';
import { getArticle } from '../src/finalizer.mjs';

// An end-to-end run of the whole pipeline with the network replaced by a stub: no AI key, no web access, no cost.
// It proves that the prompts, the checks, the Human Gate and the channel output work together in English.

const PAGE = 'Riverside City opened a flood relief fund on 3 March 2026 and said it would pay 250 households up to 400 dollars each. '
  + 'The mayor, Dana Whitfield, told reporters that applications close on 30 April. '.repeat(3)
  + 'Officials said the fund is paid for by a one-time reserve transfer and will not raise local taxes. '.repeat(3);
const QUOTE_1 = 'opened a flood relief fund on 3 March 2026';
const QUOTE_2 = 'will not raise local taxes';

const prompts = [];
const jobs = [];

function fakeFetch(url, init = {}) {
  const u = String(url);
  if (u.includes('api.deepseek.com')) {
    const prompt = JSON.parse(init.body).messages[1].content;
    prompts.push(prompt);
    const reply = answerFor(prompt);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }) });
  }
  if (u.includes('wikipedia.org')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ query: { search: [] } }) });
  if (u.includes('duckduckgo.com')) return Promise.resolve({ ok: true, status: 200, text: async () => '' });
  return Promise.resolve({ ok: true, status: 200, url: u, headers: new Headers({ 'content-type': 'text/html' }), text: async () => `<html><head><title>City fund report</title></head><body><article><p>${PAGE}</p></article></body></html>` });
}

function answerFor(prompt) {
  if (prompt.includes('"searchQueries"')) {
    return { summary: 'A city relief fund', template: 'news_analysis', reason: 'a real event', pillar: 'Questions', ownerStance: '', keyPoints: ['fund', 'eligibility'], searchQueries: ['Riverside flood relief fund'], relevanceTerms: ['relief fund'], primarySourceQueries: [], imageIdeas: { cover: 'A river at dawn' } };
  }
  if (prompt.includes('You are the evidence checker')) {
    return { claims: [
      { id: 'clm1', claim: 'Riverside City opened a flood relief fund on 3 March 2026', type: 'primary_text', status: 'verified', source_ids: ['src1'], quotes: [{ source_id: 'src1', text: QUOTE_1 }], rationale: 'stated in the report' },
      { id: 'clm2', claim: 'The fund will not raise local taxes', type: 'attributed_testimony', status: 'verified', source_ids: ['src1'], quotes: [{ source_id: 'src1', text: QUOTE_2 }], rationale: 'officials said so' },
      { id: 'clm3', claim: 'A made-up claim the page never states', type: 'fact', status: 'verified', source_ids: ['src1'], quotes: [{ source_id: 'src1', text: 'the page never says anything like this' }], rationale: 'invented' }
    ] };
  }
  if (prompt.includes('Create an outline')) {
    return { title: 'Riverside opens a flood relief fund', deck: 'What the city announced', headings: { hook: 'The announcement', why: 'Why it matters', step: 'How it is paid for', actionable: 'What to watch' }, sections: { hook: { points: 'the opening', claim_ids: ['clm1'] }, why: { points: 'context', claim_ids: [] }, step: { points: 'funding', claim_ids: ['clm2'] }, actionable: { points: 'next steps', claim_ids: [] } } };
  }
  if (prompt.includes('this round you write only the')) {
    const slot = ['opening slot', 'second slot', 'main content slot', 'closing slot'].find(s => prompt.includes(`write only the **${s}**`));
    const text = {
      'opening slot': 'Riverside City opened a flood relief fund on 3 March 2026 (clm1). That is the fact this piece starts from, and everything else follows from it.\n\nThe writer sees this as a modest but real step for the residents involved.',
      'second slot': 'Flood recovery is slow and expensive for ordinary households, which is why a direct payment matters more than another announcement about future plans.',
      'main content slot': 'Officials said the money comes from a one-time reserve transfer, so the fund will not raise local taxes (clm2). That detail answers the first question most residents ask.',
      'closing slot': 'Readers may want to check the application deadline themselves and ask the city what happens to households that apply after the money runs out.'
    }[slot];
    return { text, imagePrompt: 'An illustration' };
  }
  if (prompt.includes('You are the fact-checking editor')) return { issues: [] };
  return { raw: 'unexpected prompt' };
}

function fakeReq(method, body, headers = { host: '127.0.0.1:8080' }) {
  const r = Readable.from([JSON.stringify(body || {})]);
  r.method = method;
  r.headers = headers;
  return r;
}
const ownerHeaders = { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:8080', 'sec-fetch-site': 'same-origin', 'user-agent': 'test' };
const call = (method, path, body, headers) => handleAPI(fakeReq(method, body, headers), new URL(path, 'http://127.0.0.1:8080'));

async function waitFor(jobId) {
  for (let i = 0; i < 200; i++) {
    const { body } = await call('GET', '/api/jobs/' + jobId);
    if (!['created', 'processing'].includes(body.job.status)) return body.job;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('the job did not finish');
}

after(async () => { for (const id of jobs) await rm(jobDir(id), { recursive: true, force: true }); });

test('a whole English job runs through every stage, stops at the Human Gate, and only a person can approve it', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    const created = await call('POST', '/api/jobs', {
      topic: 'Riverside flood relief fund', audience: 'general', provider: 'deepseek', deepseekKey: 'test-key', language: 'en',
      external: [{ url: 'http://93.184.216.34/city-report', note: 'city report' }]
    });
    assert.equal(created.status, 201);
    const id = created.body.job.id;
    jobs.push(id);
    assert.equal(created.body.job.language, 'en');

    const job = await waitFor(id);
    assert.equal(job.error, undefined, job.error);
    assert.equal(job.status, 'ready_for_review', JSON.stringify(job.stages.final?.result?.blockers));
    for (const stage of ['brief', 'research', 'evidence', 'outline', 'write', 'review', 'channels', 'final']) {
      assert.equal(job.stages[stage]?.status, 'complete', stage);
    }

    // The made-up claim failed the quote check and was kept out; the two real ones passed
    const claims = job.stages.evidence.result.claims;
    assert.deepEqual(claims.filter(c => c.status === 'verified').map(c => c.id), ['clm1', 'clm2']);
    assert.equal(claims.find(c => c.id === 'clm3').status, 'needs_verification');

    // The prompts are English and carry the chosen article language
    assert.ok(prompts.every(p => !/[฀-๿]/.test(p)), 'no Thai in any prompt of an English job');
    assert.ok(prompts.some(p => p.includes('Article language: English')));

    // The review file exists, has the adapted headings, numbered sources and the English footer, and no internal markers
    const file = await readFile(join(jobDir(id), 'blockdit.md'), 'utf8');
    assert.match(file, /^# Riverside opens a flood relief fund/);
    assert.ok(file.includes('## The announcement'));
    assert.match(file, /3 March 2026 \[1\]/);
    assert.match(file, /\*\*Sources:\*\*\n1\. \[City fund report\]\(http:\/\/93\.184\.216\.34\/city-report\)/);
    assert.ok(file.includes('checked against its sources as of'));
    assert.ok(!/clm\d/.test(file));

    // The API key typed for this job is never written anywhere in the job folder
    const state = await readFile(join(jobDir(id), 'state.json'), 'utf8');
    assert.ok(!state.includes('test-key'), 'the key must not be in state.json');
    assert.ok(!file.includes('test-key'));

    // Nothing can reach other channels or the MCP tools before approval
    assert.equal((await call('POST', '/api/export-formats', { jobId: id, formats: ['social'] })).status, 409);
    await assert.rejects(() => getArticle(id), /is not approved/);

    // A script (no browser headers) cannot decide; the owner's page can
    const view = await call('GET', `/api/jobs/${id}/deliverable`);
    const sha = view.body.deliverable.currentSha256;
    const denied = await call('POST', `/api/jobs/${id}/decision`, { decision: 'approve', decidedBy: 'Owner', sha256: sha, acknowledgeBlockers: true });
    assert.equal(denied.status, 403);
    const approved = await call('POST', `/api/jobs/${id}/decision`, { decision: 'approve', decidedBy: 'Owner', sha256: sha, acknowledgeBlockers: true }, ownerHeaders);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.status, 'approved');

    // After approval: the final-check tools can read it, and drafts for other channels can be made
    const article = await getArticle(id);
    assert.equal(article.approvedSha256, sha);
    const drafts = await call('POST', '/api/export-formats', { jobId: id, formats: ['website-html'] });
    assert.equal(drafts.status, 200);
    assert.ok(drafts.body.results['website-html'].includes('<h3>The announcement</h3>'));
  } finally {
    globalThis.fetch = real;
  }
});

test('a Thai job asks the model for Thai and uses the Thai range and labels', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  prompts.length = 0;
  try {
    const created = await call('POST', '/api/jobs', { topic: 'กองทุนช่วยเหลือน้ำท่วม', provider: 'deepseek', deepseekKey: 'test-key', language: 'th', external: [{ url: 'http://93.184.216.34/city-report', note: '' }] });
    const id = created.body.job.id;
    jobs.push(id);
    assert.equal(created.body.job.language, 'th');
    const job = await waitFor(id);
    assert.equal(job.stages.review?.result?.wordRange.min, 1500);
    assert.ok(prompts.some(p => p.includes('Article language: Thai')));
    const file = await readFile(join(jobDir(id), 'blockdit.md'), 'utf8');
    assert.ok(file.includes('ตรวจสอบกับแหล่งที่มา ณ วันที่'));
  } finally {
    globalThis.fetch = real;
  }
});

test('an unknown language falls back to English', async () => {
  const created = await call('POST', '/api/jobs', { topic: 'x', language: 'xx', provider: 'deepseek', deepseekKey: '' });
  jobs.push(created.body.job.id);
  assert.equal(created.body.job.language, 'en');
  await waitFor(created.body.job.id).catch(() => {});
});
