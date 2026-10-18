import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callAnthropic } from '../src/adapters/providers/anthropic.mjs';

async function withFetch(stub, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}
const okBody = { content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 3, output_tokens: 2 } };
const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });

test('a model that rejects `temperature` (HTTP 400) is retried once without it, remembered, and later calls skip temperature', async () => {
  const bodies = [];
  const stub = async (_u, init) => {
    const b = JSON.parse(init.body);
    bodies.push(b);
    if ('temperature' in b) return reply(400, { type: 'error', error: { type: 'invalid_request_error', message: '`temperature` is deprecated for this model.' } });
    return reply(200, okBody);
  };
  const r = await withFetch(stub, () => callAnthropic('x', { key: 'k', model: 'test-model-rejects-temp', temperature: 0 }));
  assert.equal(r.a, 1);
  assert.equal(r._usage.totalTokens, 5);
  assert.equal(bodies.length, 2);
  assert.ok('temperature' in bodies[0] && !('temperature' in bodies[1]));
  bodies.length = 0;
  await withFetch(stub, () => callAnthropic('x', { key: 'k', model: 'test-model-rejects-temp', temperature: 0 }));
  assert.equal(bodies.length, 1, 'remembered: one call only');
  assert.ok(!('temperature' in bodies[0]));
});

test('models that accept temperature still get it; other 400 errors are not retried and keep the API message', async () => {
  const bodies = [];
  await withFetch(async (_u, init) => { bodies.push(JSON.parse(init.body)); return reply(200, okBody); }, () => callAnthropic('x', { key: 'k', model: 'test-model-ok', temperature: 0.3 }));
  assert.equal(bodies[0].temperature, 0.3);
  let calls = 0;
  const bad = async () => { calls++; return reply(400, { type: 'error', error: { message: 'max_tokens too large' } }); };
  await withFetch(bad, () => assert.rejects(() => callAnthropic('x', { key: 'k', model: 'test-model-other', temperature: 0 }), /400[\s\S]*max_tokens too large/));
  assert.equal(calls, 1);
  await assert.rejects(() => callAnthropic('x', {}), /key not set/);
});

test('without a temperature option nothing extra is sent', async () => {
  const bodies = [];
  await withFetch(async (_u, init) => { bodies.push(JSON.parse(init.body)); return reply(200, okBody); }, () => callAnthropic('x', { key: 'k', model: 'test-model-plain' }));
  assert.ok(!('temperature' in bodies[0]));
  assert.equal(bodies[0].model, 'test-model-plain');
});

test('Haiku 5.5 is called with thinking disabled (it thinks by default and can return no text); other models are not sent a thinking parameter', async () => {
  const bodies = [];
  const ok = async (_u, init) => { bodies.push(JSON.parse(init.body)); return reply(200, okBody); };
  await withFetch(ok, () => callAnthropic('x', { key: 'k', model: 'claude-haiku-5-5' }));
  assert.deepEqual(bodies[0].thinking, { type: 'disabled' });
  // Sonnet 5.5 does not accept disabled (it needs between_tools) · Opus 5.5 needs adaptive + effort low · Haiku 4.5 does not think by default, so nothing is sent
  bodies.length = 0;
  await withFetch(ok, () => callAnthropic('x', { key: 'k', model: 'claude-sonnet-5-5' }));
  assert.deepEqual(bodies[0].thinking, { type: 'between_tools' });
  bodies.length = 0;
  await withFetch(ok, () => callAnthropic('x', { key: 'k', model: 'claude-opus-5-5' }));
  assert.deepEqual(bodies[0].thinking, { type: 'adaptive' });
  assert.deepEqual(bodies[0].output_config, { effort: 'low' });
  bodies.length = 0;
  await withFetch(ok, () => callAnthropic('x', { key: 'k', model: 'claude-haiku-4-5-20251001' }));
  assert.ok(!('thinking' in bodies[0]) && !('output_config' in bodies[0]));
});

test('the answer is read from the text blocks (a thinking block may come first) and an answer without any text gives a clear error', async () => {
  const withThinking = { content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '{"b":2}' }], usage: { input_tokens: 1, output_tokens: 1 } };
  const r = await withFetch(async () => reply(200, withThinking), () => callAnthropic('x', { key: 'k', model: 'test-model-thinking-first' }));
  assert.equal(r.b, 2);
  const onlyThinking = { content: [{ type: 'thinking', thinking: '...' }], stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 8000, output_tokens_details: { thinking_tokens: 8000 } } };
  await withFetch(async () => reply(200, onlyThinking), () => assert.rejects(() => callAnthropic('x', { key: 'k', model: 'test-model-no-text' }), /returned no text[\s\S]*max_tokens[\s\S]*8000/));
});
