import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelJson, escapeControlCharsInStrings, looksLikeModelJson } from '../src/adapters/parseJson.mjs';
import { modelText, leakedModelOutput } from '../src/stages/index.mjs';

const REAL_SHAPE = '```json\n{\n "text": "First paragraph [1][2]\n\nSecond paragraph, the writer sees \\"an example\\" here",\n "imagePrompt": "An illustration"\n}\n```';

test('valid JSON still parses', () => {
  assert.deepEqual(parseModelJson('{"text":"a","imagePrompt":"b"}'), { text: 'a', imagePrompt: 'b' });
  assert.deepEqual(parseModelJson('```json\n{"text":"a"}\n```'), { text: 'a' });
});

test('real failure: raw newlines inside a JSON string are repaired instead of leaking the fence', () => {
  const r = parseModelJson(REAL_SHAPE);
  assert.ok(r, 'parsed');
  assert.equal(r.imagePrompt, 'An illustration');
  assert.match(r.text, /^First paragraph \[1\]\[2\]\n\nSecond paragraph/);
  assert.match(r.text, /"an example"/);
});

test('a response truncated mid-string is closed and the text so far is kept', () => {
  const r = parseModelJson('{\n "text": "A paragraph that was cut off\n\nand kept on writing');
  assert.ok(r);
  assert.match(r.text, /A paragraph that was cut off/);
});

test('garbage returns null, never a half-object', () => {
  assert.equal(parseModelJson('there is no json at all'), null);
  assert.equal(parseModelJson(''), null);
  assert.equal(parseModelJson(null), null);
});

test('escapeControlCharsInStrings only touches characters inside strings', () => {
  assert.equal(escapeControlCharsInStrings('{\n"a": "x\ny"\n}'), '{\n"a": "x\\ny"\n}');
});

test('modelText never returns raw JSON or code fences as article text', () => {
  assert.equal(modelText({ text: 'Ordinary content' }), 'Ordinary content');
  assert.equal(modelText({ text: 'เนื้อหาภาษาไทยปกติ' }), 'เนื้อหาภาษาไทยปกติ');
  assert.ok(modelText({ raw: REAL_SHAPE }).startsWith('First paragraph [1][2]'), 'repairable raw block is unwrapped, fence removed');
  assert.ok(!leakedModelOutput(modelText({ text: REAL_SHAPE })));
  assert.equal(modelText({ raw: 'Plain text that is not json' }), 'Plain text that is not json');
  assert.equal(modelText({}), '');
  assert.ok(looksLikeModelJson(REAL_SHAPE));
});

test('real failure: JSON nested inside JSON (outer text is a fenced json block) is unwrapped to the inner text', () => {
  const fence = '`'.repeat(3);
  const inner = [fence + 'json', '{', ' "text": "The real paragraph [1] the writer finds it important",', ' "imagePrompt": "A picture"', '}', fence].join('\n');
  const outer = { text: inner, imagePrompt: 'An outer picture' };
  assert.equal(modelText(outer), 'The real paragraph [1] the writer finds it important');
  assert.equal(modelText({ raw: inner }), 'The real paragraph [1] the writer finds it important');
  const noText = [fence + 'json', '{ "imagePrompt": "x" }', fence].join('\n');
  assert.equal(modelText({ text: noText }), '', 'no inner text -> empty, never the raw block');
});

test('leakedModelOutput detects fences and system JSON keys in finished text', () => {
  assert.equal(leakedModelOutput('Ordinary text'), false);
  assert.equal(leakedModelOutput(REAL_SHAPE), true);
  assert.equal(leakedModelOutput('An article "imagePrompt": "x"'), true);
});
