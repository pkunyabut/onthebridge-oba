import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestWebCode, validateWebCode, WEB_CODES, DEFAULT_CODE } from '../src/webCategory.mjs';
import { PILLARS } from '../src/rules.mjs';

test('default codes follow the mapping sheet (draft 2)', () => {
  assert.equal(suggestWebCode('Human+AI').code, 'T');
  assert.equal(suggestWebCode('Legacy').code, 'L');
  assert.equal(suggestWebCode('Documentary').code, 'D');
  assert.equal(suggestWebCode('Questions').code, 'D');
  assert.deepEqual(Object.keys(DEFAULT_CODE).sort(), [...PILLARS].sort(), 'every pillar has an entry');
});

test('Life Skills has no default and must be chosen from H/E/S', () => {
  const s = suggestWebCode('Life Skills');
  assert.equal(s.code, '');
  assert.equal(s.needsChoice, true);
  assert.deepEqual(s.choices, ['H', 'E', 'S']);
});

test('unknown pillar gets no suggestion and never invents a pillar name', () => {
  const s = suggestWebCode('Film');
  assert.equal(s.code, '');
  assert.deepEqual(Object.keys(WEB_CODES), ['T', 'L', 'D', 'S', 'E', 'H', 'F']);
  assert.ok(!PILLARS.includes('Film'));
});

test('validateWebCode accepts table codes, F with empty pillar, rejects the rest', () => {
  assert.equal(validateWebCode('T', 'Human+AI'), null);
  assert.equal(validateWebCode('E', 'Human+AI'), null, 'editor may change T to E');
  assert.equal(validateWebCode('F', ''), null, 'F needs no pillar');
  assert.ok(validateWebCode('X', 'Human+AI'));
  assert.ok(validateWebCode('T', 'Invented'));
});
