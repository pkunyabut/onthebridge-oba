import { parseModelJson } from "../parseJson.mjs";
import { SYSTEM_PROMPT } from "../systemPrompt.mjs";
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function callGemini(prompt, options = {}) {
  const key = options.key || '';
  if (!key) throw new Error('Gemini API key not set');

  const model = options.model || 'gemini-2.0-flash';
  const url = `${GEMINI_API}/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    // The key goes in a header, never in the URL (URLs end up in logs and error messages)
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens || 4000
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Gemini returned no text (the answer may have been blocked or cut off)');
  const usage = data.usageMetadata || {};
  const _usage = {
    promptTokens: usage.promptTokenCount || usage.tokenCount?.input || usage.inputTokenCount || 0,
    completionTokens: usage.candidatesTokenCount || usage.tokenCount?.output || usage.outputTokenCount || 0,
    totalTokens: usage.totalTokenCount || usage.tokenCount?.total || 0
  };
  const parsed = parseModelJson(content);
  return parsed ? { ...parsed, _usage } : { raw: content, _usage };
}
