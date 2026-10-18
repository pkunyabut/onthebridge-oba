import { parseModelJson } from "../parseJson.mjs";
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// Some models (e.g. Haiku 5.5) reject the temperature parameter ("`temperature` is deprecated for this model" → HTTP 400).
// Remember which models reject it and do not send temperature to them again · if unknown, try sending it first and retry once without it.
const REJECTS_TEMPERATURE = new Set(['claude-haiku-5-5']);   // known to reject — do not waste the first request failing

// Haiku 5.5 turns thinking on by default: it spent the whole answer budget on thinking and sent no text (stop_reason max_tokens, empty text)
// → the evidence stage got 0 items (seen on 15 Oct 2026, OBA-0512c64c) · it must be turned off with thinking: {type:'disabled'}.
// Other models tested: Haiku 4.5 does not think by default · Sonnet 5.5 / Opus 5.5 reject 'disabled' (they need between_tools / adaptive)
// and answer with text normally, so nothing is sent for the older ones.
// Every 5.5 model thinks by itself on a long / complex prompt (Sonnet 5.5 used 7,999 of 8,000 tokens thinking in the evidence stage and did not answer),
// but how to switch it off or limit it differs by model (tested against the real API):
//   Haiku 5.5: thinking disabled · Sonnet 5.5: thinking between_tools (does not accept disabled) · Opus 5.5: thinking adaptive + output_config.effort low (does not accept disabled / between_tools)
const THINKING_PARAMS = {
  'claude-haiku-5-5': { thinking: { type: 'disabled' } },
  'claude-sonnet-5-5': { thinking: { type: 'between_tools' } },
  'claude-opus-5-5': { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }
};

async function postMessage(key, model, prompt, options, withTemperature) {
  return fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens || 4000,
      ...(withTemperature && options.temperature !== undefined && { temperature: options.temperature }),
      ...(THINKING_PARAMS[model.replace(/-\d{8}$/, '')] || {}),
      messages: [
        { role: 'user', content: prompt }
      ]
    })
  });
}

export async function callAnthropic(prompt, options = {}) {
  const key = options.key || '';
  if (!key) throw new Error('Anthropic API key not set');

  const model = options.model || 'claude-sonnet-5-5';
  let response = await postMessage(key, model, prompt, options, !REJECTS_TEMPERATURE.has(model));

  if (!response.ok) {
    let errText = await response.text();
    if (response.status === 400 && options.temperature !== undefined && /temperature/i.test(errText) && !REJECTS_TEMPERATURE.has(model)) {
      REJECTS_TEMPERATURE.add(model);
      response = await postMessage(key, model, prompt, options, false);
      if (response.ok) errText = '';
      else errText = await response.text();
    }
    if (!response.ok) throw new Error(`Anthropic API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  // Take only the text blocks (a thinking model puts a thinking block first, so content[0] cannot be read directly)
  const content = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  if (!content) {
    const thinking = data.usage?.output_tokens_details?.thinking_tokens || 0;
    throw new Error(`Anthropic returned no text (stop_reason: ${data.stop_reason || '?'}${thinking ? `, ${thinking} tokens went on thinking` : ''}) — model ${model} may have used up its tokens thinking before answering; try a larger max_tokens or another model`);
  }
  const usage = data.usage || {};
  const _usage = {
    promptTokens: usage.input_tokens || 0,
    completionTokens: usage.output_tokens || 0,
    totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
  };
  const parsed = parseModelJson(content);
  return parsed ? { ...parsed, _usage } : { raw: content, _usage };
}
