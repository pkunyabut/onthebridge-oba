import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratesFor, estimateCost, COST_RATES, ANTHROPIC_MODEL_USD, CURRENCY } from '../src/skills/costTracker.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('Anthropic rates are per model, converted from USD per million tokens to USD per 1K tokens', () => {
  assert.equal(CURRENCY, 'USD');
  const s = ratesFor('anthropic', 'claude-sonnet-5-5');
  close(s.input, 2 / 1000);
  close(s.output, 10 / 1000);
  const h5 = ratesFor('anthropic', 'claude-haiku-5-5', 20000);
  close(h5.input, 0.10 / 1000);
  close(h5.output, 0.50 / 1000);
  const h4 = ratesFor('anthropic', 'claude-haiku-4-5');
  close(h4.input, 1 / 1000);
  close(h4.output, 5 / 1000);
  const o = ratesFor('anthropic', 'claude-opus-5-5');
  close(o.output, 20 / 1000);
});

test('dated model ids map to the same rate, Haiku 5.5 switches to the higher tier above 100K prompt tokens per call, unknown models and other providers keep the provider rate', () => {
  assert.deepEqual(ratesFor('anthropic', 'claude-haiku-4-5-20251001'), ratesFor('anthropic', 'claude-haiku-4-5'));
  const low = ratesFor('anthropic', 'claude-haiku-5-5', 100000), high = ratesFor('anthropic', 'claude-haiku-5-5', 100001);
  assert.ok(high.input > low.input * 4);
  close(high.input, ANTHROPIC_MODEL_USD['claude-haiku-5-5'].over100k.input / 1000);
  const perK = r => ({ input: r.input / 1000, output: r.output / 1000, name: r.name });
  assert.deepEqual(ratesFor('anthropic', 'claude-something-new'), perK(COST_RATES.anthropic));
  assert.deepEqual(ratesFor('anthropic', ''), perK(COST_RATES.anthropic));
  assert.deepEqual(ratesFor('deepseek', 'deepseek-flash'), perK(COST_RATES.deepseek));
  assert.deepEqual(ratesFor('unknown-provider', 'x'), perK(COST_RATES.deepseek));
});

test('estimateCost uses the chosen model: Haiku 5.5 is far cheaper than Sonnet 5.5, and the model is echoed back', () => {
  const sonnet = estimateCost('anthropic', 10, 4000, 'claude-sonnet-5-5');
  const haiku = estimateCost('anthropic', 10, 4000, 'claude-haiku-5-5');
  assert.equal(haiku.model, 'claude-haiku-5-5');
  assert.ok(haiku.total < sonnet.total / 10);
  assert.equal(estimateCost('deepseek', 5).model, undefined);
  assert.equal(estimateCost('deepseek', 5).currency, 'USD');
});
