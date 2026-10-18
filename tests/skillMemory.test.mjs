import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueKindCounts } from '../src/skills/skillMemory.mjs';

test('recurring issues are counted by kind, because the problem text is different every time', () => {
  const rounds = [
    { issues: ['unsupported: the number 40 is not in any source', 'repetition: paragraph 2 repeats paragraph 1'] },
    { issues: ['unsupported: the date is not in any source'] },
    { issues: ['unsupported: a name was invented', 'misattributed: wrong speaker'] },
    { summary: 'a round with no issue list' }
  ];
  assert.deepEqual(issueKindCounts(rounds), { unsupported: 3, repetition: 1, misattributed: 1 });
  assert.deepEqual(issueKindCounts(undefined), {});
});
