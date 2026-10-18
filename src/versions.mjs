// ─── Keep a copy of every review version ──────────────────────────────────────
// Each time the system makes a new version (the first round, or after being sent back for edits), a copy is kept at versions/v<N>/ —
// never overwritten, never deleted.
// Used to look back and compare what each round changed — it does not replace the hash tied to the approval (kept in job.decisions).

import { mkdir, writeFile, readFile, readdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jobDir } from './paths.mjs';

const VERSIONS_DIR = 'versions';

function versionDir(job, n) {
  return join(jobDir(job.id), VERSIONS_DIR, `v${n}`);
}

export async function snapshotVersion(job, content) {
  const d = job.deliverable;
  if (!d?.version) return null;
  const dir = versionDir(job, d.version);
  await mkdir(dir, { recursive: true });
  const final = job.stages.final?.result || {};
  const meta = {
    version: d.version,
    sha256: d.sha256,
    createdAt: d.createdAt,
    wordCount: final.wordCount || job.stages.channels?.result?.blockdit?.wordCount || 0,
    verdict: final.verdict || '',
    blockers: (final.blockers || []).length,
    revisions: job.revision || 1,
    ownerRevisions: job.ownerRevisions || 0,
    note: ''
  };
  // wx = never overwrite a copy that already exists
  try { await writeFile(join(dir, 'blockdit.md'), content, { encoding: 'utf-8', flag: 'wx' }); }
  catch (e) { if (e.code === 'EEXIST') return meta; throw e; }
  try { await copyFile(join(jobDir(job.id), 'image_plan.md'), join(dir, 'image_plan.md')); } catch { /* no image plan yet */ }
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  return meta;
}

export async function listVersions(job) {
  let names = [];
  try { names = await readdir(join(jobDir(job.id), VERSIONS_DIR)); } catch { return []; }
  const out = [];
  for (const name of names) {
    const m = /^v(\d+)$/.exec(name);
    if (!m) continue;
    try { out.push(JSON.parse(await readFile(join(versionDir(job, m[1]), 'meta.json'), 'utf-8'))); }
    catch { out.push({ version: Number(m[1]) }); }
  }
  return out.sort((a, b) => a.version - b.version);
}

export async function readVersion(job, n) {
  if (!Number.isInteger(n) || n < 1) return null;
  try { return await readFile(join(versionDir(job, n), 'blockdit.md'), 'utf-8'); } catch { return null; }
}

// Compare paragraph by paragraph (LCS) — returns a list of { type: 'same' | 'del' | 'add', text }
export function diffParagraphs(oldText, newText) {
  const split = t => String(t || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const a = split(oldText), b = split(newText);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ type: 'del', text: a[i++] });
    else ops.push({ type: 'add', text: b[j++] });
  }
  while (i < a.length) ops.push({ type: 'del', text: a[i++] });
  while (j < b.length) ops.push({ type: 'add', text: b[j++] });
  return ops;
}

export function diffSummary(ops) {
  return {
    same: ops.filter(o => o.type === 'same').length,
    removed: ops.filter(o => o.type === 'del').length,
    added: ops.filter(o => o.type === 'add').length
  };
}
