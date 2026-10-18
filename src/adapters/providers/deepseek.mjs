import { parseModelJson } from "../parseJson.mjs";
import { SYSTEM_PROMPT } from "../systemPrompt.mjs";
const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';

// Model names: on 15 Oct 2026 GET /models of DeepSeek listed "deepseek-flash" and "deepseek-v4-pro" (deepseek-chat / deepseek-reasoner no longer appear).
// Old names that remain in old jobs / values saved in the browser are mapped to the new names · override with DEEPSEEK_MODEL in .env
// (used for requests that name no model or use an old name).
// If DeepSeek answers 400/404 (name not recognised), one fallback name (the old name) is tried.
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-flash';
const LEGACY_TO_NEW = { 'deepseek-chat': 'deepseek-flash', 'deepseek-reasoner': 'deepseek-v4-pro' };
const NEW_TO_LEGACY = { 'deepseek-flash': 'deepseek-chat', 'deepseek-v4-pro': 'deepseek-reasoner' };

const THINKING_MODELS = new Set(['deepseek-flash', 'deepseek-v4-pro']);

export function deepSeekModelsToTry(requested, env = process.env) {
  const asked = String(requested || '').trim();
  const override = String(env.DEEPSEEK_MODEL || '').trim();
  const primary = (!asked || LEGACY_TO_NEW[asked]) && override ? override : (LEGACY_TO_NEW[asked] || asked || DEEPSEEK_DEFAULT_MODEL);
  const fallback = NEW_TO_LEGACY[primary];
  return fallback ? [primary, fallback] : [primary];
}

export async function callDeepSeek(prompt, options = {}) {
  const key = options.key || '';
  if (!key) throw new Error('DeepSeek API key not set');

  // There used to be no timeout: when DeepSeek had a long queue or an outage, the request hung and the job looked like "cannot connect"
  // (Apr–Oct 2026: it answered 200 and then sent no content).
  const timeoutMs = options.timeoutMs || 240000;
  const models = deepSeekModelsToTry(options.model);
  try {
    let lastError;
    for (const [i, model] of models.entries()) {
      const thinking = options.thinking === true || String(options.model || '').trim() === 'deepseek-reasoner';   // thinking mode only when asked explicitly (the old reasoner)
      const response = await fetchDeepSeek(key, prompt, { ...options, model, thinking }, timeoutMs);
      if (!response.ok) {
        const err = new Error(`DeepSeek API error: ${response.status}${STATUS_HINT[response.status] ? ` (${STATUS_HINT[response.status]})` : ''} [model ${model}]`);
        if ([400, 404].includes(response.status) && i < models.length - 1) { lastError = err; continue; }   // model name not recognised → try the fallback name
        throw err;
      }
      const out = await readDeepSeek(response);   // must be inside the same try: a timeout while reading the body must also become an understandable message
      if (out && typeof out === 'object' && out._usage) out._usage.model = model;
      return out;
    }
    throw lastError;
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new Error(`DeepSeek did not answer within ${Math.round(timeoutMs / 1000)} seconds — probably a long queue or an outage on DeepSeek's side. Check https://status.deepseek.com and wait a while before running again (your key and network are fine).`);
    if (/^DeepSeek API error/.test(e?.message || '')) throw e;
    throw new Error(`Cannot connect to DeepSeek: ${e?.cause?.code || e?.message || e}`);
  }
}

const STATUS_HINT = { 401: 'the key is invalid or revoked', 402: 'insufficient balance', 429: 'too many requests, wait a moment', 500: 'DeepSeek is having a problem', 502: 'DeepSeek is having a problem', 503: 'DeepSeek is overloaded or down' };

function fetchDeepSeek(key, prompt, options, timeoutMs) {
  return fetch(DEEPSEEK_API, {
    signal: AbortSignal.timeout(timeoutMs),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4000,
      // deepseek-flash / deepseek-v4-pro think (reason) by default: in the evidence stage 8,000 tokens all went on thinking, content was empty,
      // finish_reason=length → "extracted 0 items" (OBA-8e68a09e, 15 Oct 2026) · turn it off with thinking disabled so it behaves like the older
      // deepseek-chat that had always met the standard · the old name deepseek-chat does not think, so nothing is sent for it
      ...(THINKING_MODELS.has(options.model) && options.thinking !== true && { thinking: { type: 'disabled' } })
    })
  });
}

async function readDeepSeek(response) {
  const data = await response.json();
  const content = data.choices[0].message.content;
  const usage = data.usage || {};
  const _usage = {
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0
  };
  const parsed = parseModelJson(content);
  return parsed ? { ...parsed, _usage } : { raw: content, _usage };
}
