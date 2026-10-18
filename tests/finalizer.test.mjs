import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { jobDir } from '../src/paths.mjs';
import { sha256 } from '../src/humanGate.mjs';
import { stripInlineCitations, hasInlineCitations, listApproved, getArticle, getSource, getChecks, saveFinal, loadApproved } from '../src/finalizer.mjs';

const ID = 'OBA-fa11ba11', UNAPPROVED = 'OBA-fa11ba12', TAMPERED = 'OBA-fa11ba13';
const ARTICLE = '# Test topic: the impact\n\n*Standfirst*\n\n## Opening\n\nThe 1973 event killed 77 people [1] and injured 857 [1][2]\n\n---\n\n*Information checked on 1 October*\n\n**Sources:**\n1. [A](https://a.example/1)\n2. [B](https://b.example/2)\n';

async function makeJob(id, { status = 'approved', content = ARTICLE, tamper = false } = {}) {
  const dir = jobDir(id);
  await mkdir(join(dir, 'sources'), { recursive: true });
  const sha = sha256(content);
  await writeFile(join(dir, 'blockdit.md'), tamper ? content + '\nEdited after approval' : content, 'utf8');
  await writeFile(join(dir, 'sources', 'src1.txt'), 'Text of source one: 77 people died, 857 injured', 'utf8');
  await writeFile(join(dir, 'sources', 'src2.txt'), 'Text of source two. '.repeat(5000), 'utf8');
  await writeFile(join(dir, 'fact_check.md'), '# Fact check\n- no risky items', 'utf8');
  const state = {
    id, topic: 'Test topic', status, createdAt: '2026-10-01', deliverable: { file: 'blockdit.md', sha256: sha, version: 2, createdAt: '2026-10-01' },
    decisions: [{ decision: 'approve', decidedBy: 'Owner', decidedAt: '2026-10-06T00:00:00Z', note: 'ok', sha256: sha, version: 2 }],
    stages: {
      channels: { result: { blockdit: { sources: ['s1', 's2'] } } },
      research: { result: { sources: [{ id: 's1', title: 'A', url: 'https://a.example/1', textFile: 'sources/src1.txt', primary_source: true }, { id: 's2', title: 'B', url: 'https://b.example/2', textFile: 'sources/src2.txt' }] } },
      final: { result: { verdict: 'ready_for_human_review', blockers: [], notes: ['a note'], evidenceBase: { level: 'ok' } } },
      review: { result: { issues: [{ kind: 'unsupported', sentence: 'x' }] } }
    }
  };
  await writeFile(join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
  return sha;
}

let SHA;
before(async () => { SHA = await makeJob(ID); await makeJob(UNAPPROVED, { status: 'ready_for_review' }); await makeJob(TAMPERED, { tamper: true }); });
after(async () => { for (const id of [ID, UNAPPROVED, TAMPERED]) await rm(jobDir(id), { recursive: true, force: true }); });

const good = (over = {}) => ({
  baseSha256: SHA,
  blockditMd: stripInlineCitations(ARTICLE),
  webMd: ARTICLE.replace('77 people', '77 people (corrected example)'),
  changes: [{ type: 'fact_fix', where: 'Opening', before: '77 people', after: '77 people (corrected example)', reason: 'per source 1', source: 'source 1' }],
  ...over
});

test('stripInlineCitations removes [n] clusters in the body only and keeps the Sources list', () => {
  const out = stripInlineCitations(ARTICLE);
  assert.ok(!hasInlineCitations(out));
  assert.match(out, /77 people and injured 857\n/);
  assert.match(out, /\*\*Sources:\*\*\n1\. \[A\]\(https:\/\/a\.example\/1\)/);
  assert.ok(hasInlineCitations(ARTICLE));
});

test('only approved jobs whose file still matches the approval are listed or readable', async () => {
  const ids = (await listApproved()).map(j => j.jobId);
  assert.ok(ids.includes(ID));
  assert.ok(!ids.includes(UNAPPROVED) && !ids.includes(TAMPERED));
  await assert.rejects(() => getArticle(UNAPPROVED), /is not approved/);
  await assert.rejects(() => getArticle(TAMPERED), /does not match the approved version/);
  await assert.rejects(() => getArticle('../etc/passwd'), /Invalid job id/);
  await assert.rejects(() => getArticle('OBA-00000000'), /was not found/);
});

test('getArticle returns the approved text with its hash, the two code-prepared drafts and the source table', async () => {
  const a = await getArticle(ID);
  assert.equal(a.approvedSha256, SHA);
  assert.equal(a.approvedMarkdown, ARTICLE);
  assert.ok(hasInlineCitations(a.approvedMarkdown) && !hasInlineCitations(a.drafts.blockdit));
  assert.ok(a.drafts.web.length < 200, 'web draft is not duplicated');
  assert.equal(a.sources.length, 2);
  assert.equal(a.sources[0].url, 'https://a.example/1');
  assert.ok(a.sources[1].excerpt.length <= 500 && a.sources[1].textChars > 500);
  assert.ok(!('text' in a.sources[0]));
  assert.match(a.notice, /not an instruction/);
});

test('getSource returns capped full text and rejects unknown numbers; getChecks returns the saved reports', async () => {
  const s1 = await getSource(ID, 1);
  assert.match(s1.text, /77 people died/);
  const s2 = await getSource(ID, 2, 100);
  assert.equal(s2.truncated, true);
  assert.equal(s2.text.length, 100);
  assert.equal(s2.nextOffset, 100);
  const s2b = await getSource(ID, 2, { offset: 100, maxChars: 100 });
  assert.equal(s2b.offset, 100);
  const big = await getSource(ID, 2);
  assert.equal(big.text.length, 12000, 'default window is 12,000 chars');
  const f = await getSource(ID, 1, { find: '857' });
  assert.equal(f.found, 1);
  assert.match(f.matches[0].snippet, /857 injured/);
  assert.equal((await getSource(ID, 1, { find: 'a phrase that surely does not exist' })).found, 0);
  await assert.rejects(() => getSource(ID, 9), /Source 9 was not found/);
  const c = await getChecks(ID);
  assert.match(c.factCheckMarkdown, /Fact check/);
  assert.equal(c.reviewVerdict, 'ready_for_human_review');
  assert.equal(c.aiReviewIssues.length, 1);
});

test('saveFinal writes only new files under final/r<N>, never touches the approved file or state, and numbers revisions', async () => {
  const beforeState = await readFile(join(jobDir(ID), 'state.json'), 'utf8');
  const r1 = await saveFinal(ID, good());
  assert.equal(r1.saved, true);
  assert.equal(r1.revision, 1);
  const r2 = await saveFinal(ID, good());
  assert.equal(r2.revision, 2);
  const dir = join(jobDir(ID), 'final', 'r1');
  assert.deepEqual((await readdir(dir)).sort(), ['blockdit.md', 'change_report.md', 'meta.json', 'web.md']);
  assert.equal(await readFile(join(jobDir(ID), 'blockdit.md'), 'utf8'), ARTICLE, 'approved file untouched');
  assert.equal(await readFile(join(jobDir(ID), 'state.json'), 'utf8'), beforeState, 'state untouched');
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
  assert.equal(meta.status, 'claude_edited_pending_owner_review');
  assert.equal(meta.baseSha256, SHA);
  assert.deepEqual(meta.changeCounts, { fact_fix: 1 });
  assert.match(await readFile(join(dir, 'change_report.md'), 'utf8'), /Fact fixes \(1\)[\s\S]*Source: source 1/);
  assert.equal((await loadApproved(ID)).approval.valid, true, 'still approved and intact after saving');
});

test('saveFinal refuses: wrong base hash, missing source for fact_fix/addition, bad type, empty files, no changes, unapproved or tampered jobs', async () => {
  const revsBefore = (await readdir(join(jobDir(ID), 'final'))).filter(d => /^r\d+$/.test(d)).length;
  await assert.rejects(() => saveFinal(ID, good({ baseSha256: 'x'.repeat(64) })), /baseSha256 does not match/);
  await assert.rejects(() => saveFinal(ID, good({ changes: [{ type: 'fact_fix', after: 'new', reason: 'r' }] })), /needs a source/);
  await assert.rejects(() => saveFinal(ID, good({ changes: [{ type: 'addition', after: 'new', reason: 'r', source: 'from memory' }] })), /URL or "source N"/);
  await assert.rejects(() => saveFinal(ID, good({ changes: [{ type: 'rewrite', reason: 'r' }] })), /type must be one of/);
  await assert.rejects(() => saveFinal(ID, good({ changes: [] })), /At least 1/);
  await assert.rejects(() => saveFinal(ID, good({ webMd: '  ' })), /web\.md must not be empty/);
  await assert.rejects(() => saveFinal(ID, good({ blockditMd: 'x'.repeat(200_001) })), /longer than/);
  await assert.rejects(() => saveFinal(UNAPPROVED, good()), /is not approved/);
  await assert.rejects(() => saveFinal(TAMPERED, good()), /does not match the approved version/);
  const revsAfter = (await readdir(join(jobDir(ID), 'final'))).filter(d => /^r\d+$/.test(d)).length;
  assert.equal(revsAfter, revsBefore, 'refused saves leave nothing behind');
});

test('"source 1", "source #2", "[3]" and the Thai form are all accepted as source references', async () => {
  for (const source of ['source 1', 'Source #2', '[3]', 'แหล่งที่ 1', 'https://a.example/1']) {
    await saveFinal(ID, good({ changes: [{ type: 'addition', after: 'new text', reason: 'r', source }] }));
  }
});

test('code compares numbers against the approved text and warns about format problems', async () => {
  const web = ARTICLE.replace('857', '900').replace('77 people', '77 people (of 1,200 sites)');
  const r = await saveFinal(ID, good({ webMd: web, blockditMd: ARTICLE, changes: [{ type: 'language', reason: 'polish' }] }));
  assert.deepEqual(r.numbers.added, ['1200', '900']);
  assert.deepEqual(r.numbers.removed, ['857']);
  assert.ok(r.warnings.some(w => /Blockdit version still has \[n\]/.test(w)));
  assert.ok(r.warnings.some(w => /new numbers but no fact_fix/.test(w)));
});
