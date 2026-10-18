// ─── Robust reading of a model's JSON answer ──────────────────────────────────
// A real problem (seen in OBA-8fa049fc): the model put real line breaks inside the text values of the JSON (which is not valid JSON).
// JSON.parse failed → the system used to return { raw } and use the whole blob, including the ```json marks, as the article text.
// Here: try reading it directly → repair control characters in strings → repair an answer cut off part-way → otherwise return null for the caller to handle.

// Escape newlines / tabs / control characters that are "inside a string" of the JSON only
export function escapeControlCharsInStrings(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of String(text)) {
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      if (ch.charCodeAt(0) < 0x20) { out += ' '; continue; }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

// Close the string / brackets left open by an answer that was cut off (max_tokens)
function closeTruncated(text) {
  let inString = false, escaped = false;
  const stack = [];
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = text;
  if (escaped) out += '\\';
  if (inString) out += '"';
  // Cut a separator / key left hanging half-way
  out = out.replace(/,\s*$/, '').replace(/,\s*"[^"]*"\s*:?\s*$/, '');
  return out + stack.reverse().join('');
}

export function parseModelJson(content) {
  const text = String(content ?? '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  const end = text.lastIndexOf('}');
  const candidates = [];
  if (end > start) candidates.push(text.slice(start, end + 1));
  candidates.push(text.slice(start).replace(/```\s*$/, ''));
  for (const cand of candidates) {
    for (const attempt of [cand, escapeControlCharsInStrings(cand), closeTruncated(escapeControlCharsInStrings(cand))]) {
      try {
        const parsed = JSON.parse(attempt);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch { /* try the next way */ }
    }
  }
  return null;
}

// Text that looks like the model's JSON / code block (not article text)
export function looksLikeModelJson(text) {
  return /^\s*(```|\{\s*"|\[\s*\{)/.test(String(text ?? '')) || /"imagePrompt"\s*:/.test(String(text ?? ''));
}
