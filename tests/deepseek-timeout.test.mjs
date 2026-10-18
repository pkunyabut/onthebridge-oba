import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { callDeepSeek } from '../src/adapters/providers/deepseek.mjs';

// AbortSignal.timeout does not keep the event loop alive (it is unref'd) — a real server has other things keeping it alive, but a test must do it itself
const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

async function withFetch(stub, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = orig; }
}

test('a DeepSeek call that never answers is cut off by the timeout with a clear message (no endless hang)', async () => {
  const hang = (_url, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
  await withFetch(hang, async () => {
    const t0 = Date.now();
    await assert.rejects(() => callDeepSeek('x', { key: 'k', timeoutMs: 150 }), /did not answer within \d+ seconds[\s\S]*status\.deepseek\.com/);
    assert.ok(Date.now() - t0 < 3000);
  });
});

test('headers sent but body never arrives (DeepSeek queueing) is also cut off', async () => {
  const stuckBody = (_url, init) => Promise.resolve({ ok: true, status: 200, json: () => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))) });
  await withFetch(stuckBody, async () => {
    await assert.rejects(() => callDeepSeek('x', { key: 'k', timeoutMs: 150 }), /did not answer within/);
  });
});

test('HTTP errors get a readable hint; network failures say the connection failed; success still returns parsed JSON with usage', async () => {
  await withFetch(async () => ({ ok: false, status: 401 }), () => assert.rejects(() => callDeepSeek('x', { key: 'k' }), /DeepSeek API error: 401 \(the key is invalid/));
  await withFetch(async () => ({ ok: false, status: 402 }), () => assert.rejects(() => callDeepSeek('x', { key: 'k' }), /402 \(insufficient balance\)/));
  await withFetch(async () => { const e = new Error('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; }, () => assert.rejects(() => callDeepSeek('x', { key: 'k' }), /Cannot connect to DeepSeek: ENOTFOUND/));
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }) });
  const r = await withFetch(ok, () => callDeepSeek('x', { key: 'k' }));
  assert.equal(r.a, 1);
  assert.equal(r._usage.totalTokens, 5);
  await assert.rejects(() => callDeepSeek('x', {}), /key not set/);
});

import { deepSeekModelsToTry, DEEPSEEK_DEFAULT_MODEL } from '../src/adapters/providers/deepseek.mjs';

test('model names: default is deepseek-flash, old names map to the new ones, DEEPSEEK_MODEL overrides only default/legacy requests, each new name has its old name as fallback', () => {
  assert.equal(DEEPSEEK_DEFAULT_MODEL, 'deepseek-flash');
  assert.deepEqual(deepSeekModelsToTry('', {}), ['deepseek-flash', 'deepseek-chat']);
  assert.deepEqual(deepSeekModelsToTry('deepseek-chat', {}), ['deepseek-flash', 'deepseek-chat']);
  assert.deepEqual(deepSeekModelsToTry('deepseek-reasoner', {}), ['deepseek-v4-pro', 'deepseek-reasoner']);
  assert.deepEqual(deepSeekModelsToTry('deepseek-v4-pro', {}), ['deepseek-v4-pro', 'deepseek-reasoner']);
  assert.deepEqual(deepSeekModelsToTry('', { DEEPSEEK_MODEL: 'my-model' }), ['my-model']);
  assert.deepEqual(deepSeekModelsToTry('deepseek-chat', { DEEPSEEK_MODEL: 'my-model' }), ['my-model']);
  assert.deepEqual(deepSeekModelsToTry('deepseek-v4-pro', { DEEPSEEK_MODEL: 'my-model' }), ['deepseek-v4-pro', 'deepseek-reasoner'], 'an explicit new name is respected');
});

test('the request uses the new model name, falls back to the old name only when DeepSeek answers 400/404, and records the model used', async () => {
  const seen = [];
  const stub = async (_url, init) => {
    const model = JSON.parse(init.body).model;
    seen.push(model);
    if (model === 'deepseek-flash') return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: { total_tokens: 1 } }) };
  };
  const r = await withFetch(stub, () => callDeepSeek('x', { key: 'k', model: 'deepseek-chat' }));
  assert.deepEqual(seen, ['deepseek-flash', 'deepseek-chat']);
  assert.equal(r._usage.model, 'deepseek-chat');
  const seen2 = [];
  const okStub = async (_u, init) => { seen2.push(JSON.parse(init.body).model); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }) }; };
  const r2 = await withFetch(okStub, () => callDeepSeek('x', { key: 'k' }));
  assert.deepEqual(seen2, ['deepseek-flash'], 'no fallback call when the first succeeds');
  assert.equal(r2._usage.model, 'deepseek-flash');
  const seen3 = [];
  await withFetch(async (_u, init) => { seen3.push(JSON.parse(init.body).model); return { ok: false, status: 401 }; }, () => assert.rejects(() => callDeepSeek('x', { key: 'k' }), /401/));
  assert.deepEqual(seen3, ['deepseek-flash'], '401 does not trigger a second call');
});

test('deepseek-flash / v4-pro are sent thinking disabled (they reason by default and can return empty content); legacy deepseek-chat is not; reasoner or thinking:true keeps thinking on', async () => {
  const bodies = [];
  const ok = async (_u, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }) }; };
  await withFetch(ok, () => callDeepSeek('x', { key: 'k' }));
  assert.equal(bodies.at(-1).model, 'deepseek-flash');
  assert.deepEqual(bodies.at(-1).thinking, { type: 'disabled' });
  await withFetch(ok, () => callDeepSeek('x', { key: 'k', model: 'deepseek-chat' }));
  assert.equal(bodies.at(-1).model, 'deepseek-flash');
  assert.deepEqual(bodies.at(-1).thinking, { type: 'disabled' }, 'old name maps to flash, still non-thinking like before');
  await withFetch(ok, () => callDeepSeek('x', { key: 'k', model: 'deepseek-v4-pro' }));
  assert.deepEqual(bodies.at(-1).thinking, { type: 'disabled' });
  await withFetch(ok, () => callDeepSeek('x', { key: 'k', model: 'deepseek-reasoner' }));
  assert.equal(bodies.at(-1).model, 'deepseek-v4-pro');
  assert.ok(!('thinking' in bodies.at(-1)), 'reasoner keeps thinking on');
  await withFetch(ok, () => callDeepSeek('x', { key: 'k', thinking: true }));
  assert.ok(!('thinking' in bodies.at(-1)));
  // fallback to the legacy name (after a 400/404) must not carry a thinking parameter
  const seq = [];
  await withFetch(async (_u, init) => { const b = JSON.parse(init.body); seq.push(b); return b.model === 'deepseek-flash' ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }) }; }, () => callDeepSeek('x', { key: 'k' }));
  assert.equal(seq.at(-1).model, 'deepseek-chat');
  assert.ok(!('thinking' in seq.at(-1)));
});
