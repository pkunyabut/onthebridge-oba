import { parseModelJson } from "../parseJson.mjs";
import { SYSTEM_PROMPT } from "../systemPrompt.mjs";
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

export async function callOpenAI(prompt, options = {}) {
  const key = options.key || '';
  if (!key) throw new Error('OpenAI API key not set');

  const response = await fetch(OPENAI_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: options.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4000
    })
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

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
