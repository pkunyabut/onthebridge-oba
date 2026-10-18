import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA_DIR } from '../paths.mjs';
const COSTS_FILE = join(DATA_DIR, 'costs.json');

// ─── Cost Rates (USD per 1M tokens) ─────────────────────────────────────────
// ESTIMATES ONLY. Provider prices change — check your provider's pricing page and edit the numbers below.
// The tracker multiplies the token counts the provider reports by these rates; it is not an invoice.

export const CURRENCY = 'USD';

export const COST_RATES = {
  deepseek: { input: 0.27, output: 1.10, name: 'DeepSeek' },        // approximate — see platform.deepseek.com/pricing (cache hits are cheaper)
  openai: { input: 0.15, output: 0.60, name: 'OpenAI' },            // gpt-4o-mini; larger models cost more
  anthropic: { input: 2, output: 10, name: 'Anthropic' },           // default = Sonnet 5.5 rates, see ANTHROPIC_MODEL_USD
  gemini: { input: 0.10, output: 0.40, name: 'Gemini' },            // 2.0 Flash
  openrouter: { input: 1, output: 3, name: 'OpenRouter' }           // depends entirely on the routed model — a rough guess
};

// Per-model rates for Anthropic (USD per 1M tokens) — from the official pricing page, platform.claude.com/docs/en/about-claude/pricing, checked 15 Oct 2026.
// Check again when Anthropic changes its prices · Haiku 5.5 is charged at a higher rate when the prompt of a request exceeds 100,000 tokens
export const ANTHROPIC_MODEL_USD = {
  'claude-haiku-5-5': { input: 0.10, output: 0.50, over100k: { input: 0.50, output: 2.50 } },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 }
};

// Rates (USD per 1K tokens) for a provider + model · an unknown model → the provider's default rate
export function ratesFor(provider, model = '', avgPromptTokens = 0) {
  const base = COST_RATES[provider] || COST_RATES.deepseek;
  const perK = r => ({ input: r.input / 1000, output: r.output / 1000, name: base.name });
  if (provider !== 'anthropic') return perK(base);
  const m = ANTHROPIC_MODEL_USD[String(model || '').replace(/-\d{8}$/, '')];
  if (!m) return perK(base);
  const r = m.over100k && avgPromptTokens > 100000 ? m.over100k : m;
  return perK(r);
}

const round = n => Math.round(n * 10000) / 10000;

// ─── Cost Tracking ───────────────────────────────────────────────────────────

const emptyCosts = () => ({ currency: CURRENCY, jobs: [], totals: { allTime: 0, thisMonth: 0, lastMonth: 0 }, byMonth: {}, byProvider: {} });

export async function initCosts() {
  try { await readFile(COSTS_FILE, 'utf-8'); }
  catch {
    await mkdir(DATA_DIR, { recursive: true });   // the data folder may not exist yet (fresh install) or may have been deleted
    await writeFile(COSTS_FILE, JSON.stringify(emptyCosts(), null, 2));
  }
}

export async function getCosts() {
  await initCosts();
  try { return JSON.parse(await readFile(COSTS_FILE, 'utf-8')); }
  catch { return emptyCosts(); }
}

export async function saveCosts(costs) {
  await initCosts();
  await writeFile(COSTS_FILE, JSON.stringify(costs, null, 2));
}

export async function recordJobCost(jobId, provider, apiCalls, inputTokens, outputTokens, model = '') {
  const costs = await getCosts();
  const rates = ratesFor(provider, model, apiCalls ? inputTokens / apiCalls : inputTokens);

  const inputCost = (inputTokens / 1000) * rates.input;
  const outputCost = (outputTokens / 1000) * rates.output;
  const totalCost = inputCost + outputCost;

  const entry = {
    jobId,
    provider,
    ...(model ? { model } : {}),
    apiCalls,
    inputTokens,
    outputTokens,
    inputCost: round(inputCost),
    outputCost: round(outputCost),
    totalCost: round(totalCost),
    date: new Date().toISOString()
  };

  costs.jobs.push(entry);

  // Update totals
  costs.totals.allTime = round(costs.totals.allTime + totalCost);

  const month = new Date().toISOString().slice(0, 7);
  costs.byMonth[month] = round((costs.byMonth[month] || 0) + totalCost);

  costs.byProvider[provider] = round((costs.byProvider[provider] || 0) + totalCost);

  // Update this/last month
  updateMonthTotals(costs);

  await saveCosts(costs);
  return entry;
}

function updateMonthTotals(costs) {
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(now);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);

  costs.totals.thisMonth = round(costs.byMonth[thisMonth] || 0);
  costs.totals.lastMonth = round(costs.byMonth[lastMonth] || 0);
}

// ─── Estimate Cost ────────────────────────────────────────────────────────────
// A rough guess before running. A real job makes about 12-30 calls and some are much larger than 4,000 tokens
// (the evidence stage sends the source text), so treat the result as a floor.

export function estimateCost(provider, apiCalls, avgTokensPerCall = 4000, model = '') {
  const rates = ratesFor(provider, model, avgTokensPerCall * 0.6);
  const avgInput = avgTokensPerCall * 0.6;
  const avgOutput = avgTokensPerCall * 0.4;

  const inputCost = (avgInput / 1000) * rates.input;
  const outputCost = (avgOutput / 1000) * rates.output;
  const totalPerCall = inputCost + outputCost;

  return {
    provider,
    ...(model ? { model } : {}),
    apiCalls,
    perCall: round(totalPerCall),
    total: round(totalPerCall * apiCalls),
    currency: CURRENCY
  };
}

// ─── Cost Summary ────────────────────────────────────────────────────────────

export async function getCostSummary() {
  const costs = await getCosts();
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(now);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);

  return {
    currency: CURRENCY,
    thisMonth: costs.byMonth[thisMonth] || 0,
    lastMonth: costs.byMonth[lastMonth] || 0,
    allTime: costs.totals.allTime,
    byProvider: costs.byProvider,
    byMonth: costs.byMonth,
    totalJobs: costs.jobs.length,
    averagePerJob: costs.jobs.length > 0 ? round(costs.totals.allTime / costs.jobs.length) : 0,
    monthlyAverage: Object.keys(costs.byMonth).length > 0 ? round(Object.values(costs.byMonth).reduce((a, b) => a + b, 0) / Object.keys(costs.byMonth).length) : 0
  };
}
