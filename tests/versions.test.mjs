import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { snapshotVersion, listVersions, readVersion, diffParagraphs, diffSummary } from '../src/versions.mjs';
import { jobDir } from '../src/paths.mjs';

const ID = 'OBA-deadbeef';

function job(version, extra = {}) {
  return {
    id: ID, revision: 2, ownerRevisions: 1,
    deliverable: { version, sha256: 'abc' + version, createdAt: '2026-10-01T10:00:00Z' },
    stages: { final: { result: { verdict: 'ready_for_human_review', blockers: [], wordCount: 1500 } } },
    ...extra
  };
}

test('snapshotVersion keeps every version, never overwrites, and lists them in order', async () => {
  await rm(jobDir(ID), { recursive: true, force: true });
  await mkdir(jobDir(ID), { recursive: true });
  await writeFile(join(jobDir(ID), 'image_plan.md'), '# Image plan', 'utf-8');
  try {
    await snapshotVersion(job(1), 'First version');
    await snapshotVersion(job(2), 'Second version');
    await snapshotVersion(job(1), 'An attempt to overwrite');
    assert.equal(await readVersion(job(1), 1), 'First version');
    assert.equal(await readVersion(job(1), 2), 'Second version');
    assert.equal(await readVersion(job(1), 3), null);
    assert.equal(await readVersion(job(1), 0), null);
    const list = await listVersions(job(2));
    assert.deepEqual(list.map(v => v.version), [1, 2]);
    assert.equal(list[0].wordCount, 1500);
    assert.equal(list[0].sha256, 'abc1');
    assert.equal(await readFile(join(jobDir(ID), 'versions', 'v1', 'image_plan.md'), 'utf-8'), '# Image plan');
  } finally {
    await rm(jobDir(ID), { recursive: true, force: true });
  }
});

test('snapshotVersion does nothing without a deliverable version', async () => {
  assert.equal(await snapshotVersion({ id: ID, stages: {} }, 'x'), null);
});

test('diffParagraphs shows removed, added and unchanged paragraphs', () => {
  const a = 'Paragraph one\n\nThe figure rose by 3,000%\n\nParagraph three';
  const b = 'Paragraph one\n\nParagraph three\n\nA new paragraph';
  const ops = diffParagraphs(a, b);
  assert.deepEqual(ops.map(o => o.type), ['same', 'del', 'same', 'add']);
  assert.deepEqual(diffSummary(ops), { same: 2, removed: 1, added: 1 });
  assert.deepEqual(diffSummary(diffParagraphs(a, a)), { same: 3, removed: 0, added: 0 });
});
