// ─── AI Provider Router ──────────────────────────────────────────────────────
// Supports several providers: DeepSeek, OpenAI, Claude, Gemini, OpenRouter
// Usage: import { callAI } from './index.mjs'
// callAI(prompt, { provider: 'deepseek', key: '...', model: 'deepseek-flash' })

import { callDeepSeek } from './providers/deepseek.mjs';
import { callOpenAI } from './providers/openai.mjs';
import { callAnthropic } from './providers/anthropic.mjs';
import { callGemini } from './providers/gemini.mjs';
import { callOpenRouter } from './providers/openrouter.mjs';

// Provider Registry
const providers = {
  deepseek: {
    name: 'DeepSeek',
    call: callDeepSeek,
    defaultModel: 'deepseek-flash',      // shown in the list only · on a real call providers/deepseek.mjs chooses by itself (it honours DEEPSEEK_MODEL in .env and the fallback names)
    leaveModelToProvider: true,
    envKey: 'DEEPSEEK_API_KEY',
    description: 'DeepSeek API (deepseek-flash, deepseek-v4-pro · the old names deepseek-chat / deepseek-reasoner are mapped automatically)'
  },
  openai: {
    name: 'OpenAI',
    call: callOpenAI,
    defaultModel: 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY',
    description: 'OpenAI (gpt-4o, gpt-4o-mini, gpt-4-turbo) — not exercised on a whole article job'
  },
  anthropic: {
    name: 'Anthropic Claude',
    call: callAnthropic,
    defaultModel: 'claude-sonnet-5-5',
    envKey: 'ANTHROPIC_API_KEY',
    description: 'Anthropic Claude (Haiku 5.5, Haiku 4.5, Sonnet 5.5, Opus 5.5)'
  },
  gemini: {
    name: 'Google Gemini',
    call: callGemini,
    defaultModel: 'gemini-2.0-flash',
    envKey: 'GEMINI_API_KEY',
    description: 'Google Gemini (2.0 Flash, 1.5 Pro) — not exercised on a whole article job'
  },
  openrouter: {
    name: 'OpenRouter',
    call: callOpenRouter,
    defaultModel: 'auto',
    envKey: 'OPENROUTER_API_KEY',
    description: 'OpenRouter (auto-select best model) — not exercised on a whole article job'
  }
};

// ─── Unified AI Call Function ────────────────────────────────────────────────

export async function callAI(prompt, options = {}) {
  const providerName = options.provider || 'deepseek';
  const provider = providers[providerName];

  if (!provider) {
    throw new Error(`Unknown provider: ${providerName}. Available: ${Object.keys(providers).join(', ')}`);
  }

  const key = options.key || process.env[provider.envKey] || '';
  if (!key && !options.skipKeyCheck) {
    throw new Error(`API key for ${provider.name} not set (${provider.envKey})`);
  }

  return await provider.call(prompt, {
    ...options,
    key,
    model: options.model || (provider.leaveModelToProvider ? '' : provider.defaultModel)
  });
}

// ─── Provider Info ───────────────────────────────────────────────────────────

export function getProviders() {
  return Object.entries(providers).map(([id, p]) => ({
    id,
    name: p.name,
    defaultModel: p.defaultModel,
    envKey: p.envKey,
    description: p.description,
    hasKey: !!process.env[p.envKey]
  }));
}

export function getProvider(name) {
  return providers[name] || null;
}

export const availableProviders = Object.keys(providers);
