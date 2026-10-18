import { parseModelJson } from "../parseJson.mjs";
import { SYSTEM_PROMPT } from "../systemPrompt.mjs";
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

export async function callOpenRouter(prompt, options = {}) {
  const key = options.key || '';
  if (!key) throw new Error('OpenRouter API key not set');

  const response = await fetch(OPENROUTER_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'http://localhost:8080',
      'X-Title': 'OnTheBridge OBA'
    },
    body: JSON.stringify({
      model: options.model || 'auto',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4000
    })
  });

  if (!response.ok) throw new Error(`OpenRouter API error: ${response.status}`);

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
