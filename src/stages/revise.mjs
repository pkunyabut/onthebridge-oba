// ─── Sentence-level Revision ─────────────────────────────────────────────────
// A revision round does not rewrite the whole article: the AI returns only "original sentence → new sentence"
// and the code substitutes it into the existing draft. Parts that passed review are never touched,
// and the article does not shrink.

import { callAI } from '../adapters/index.mjs';
import { SECTIONS, paragraphs, similarity } from './checks.mjs';
import { languageProfile } from '../language.mjs';

const EDITABLE = ['title', 'deck', ...SECTIONS];
const DUPLICATE_ADDITION = 0.6; // a new paragraph more alike than this to an existing one is not added
const LABELS = { title: 'Title', deck: 'Standfirst', hook: 'Hook', why: 'Why It Matters', step: 'Step-by-Step', actionable: 'Actionable Takeaway' };

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Find the original text: exact first; if not found, tolerate different spaces / line breaks
export function locate(text, original) {
  const needle = String(original || '').trim();
  if (!needle) return null;
  const exact = text.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length };
  const words = needle.split(/\s+/).filter(Boolean).map(escapeRegex);
  if (!words.length) return null;
  const m = new RegExp(words.join('\\s+')).exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

// Apply patches to the existing draft — returns the new draft and logs whether each item could be applied
export function applyRevision(draft, { patches = [], additions = [] } = {}) {
  const out = { ...draft };
  const log = [];

  for (const p of Array.isArray(patches) ? patches : []) {
    const section = EDITABLE.includes(p.section) ? p.section : null;
    // If the section is wrong, look in every section
    const candidates = section ? [section, ...EDITABLE.filter(s => s !== section)] : EDITABLE;
    const target = candidates.find(s => locate(out[s] || '', p.original));
    if (!target) {
      log.push({ type: 'patch', issue: p.issue, section: p.section, applied: false, reason: 'original text not found in draft' });
      continue;
    }
    const text = out[target] || '';
    const { start, end } = locate(text, p.original);
    const replacement = String(p.replacement ?? '').trim();
    let next = text.slice(0, start) + replacement + text.slice(end);
    // A sentence deleted → tidy the whitespace left behind
    if (!replacement) next = next.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    out[target] = next;
    log.push({ type: 'patch', issue: p.issue, section: target, applied: true, removed: !replacement });
  }

  // Facts the draft already cites before adding — a new paragraph citing only old facts is a retelling
  const usedBefore = usedClaimIds(out);

  for (const a of Array.isArray(additions) ? additions : []) {
    if (!SECTIONS.includes(a.section) || !String(a.text || '').trim()) {
      log.push({ type: 'addition', section: a.section, applied: false, reason: 'invalid section or empty text' });
      continue;
    }
    const newText = String(a.text).trim();
    const closest = Math.max(0, ...paragraphs(out).map(p => similarity(p.text, newText)));
    if (closest >= DUPLICATE_ADDITION) {
      log.push({ type: 'addition', section: a.section, applied: false, reason: `duplicates an existing paragraph (${Math.round(closest * 100)}% same words)` });
      continue;
    }
    const cites = [...newText.matchAll(/clm\d+/gi)].map(m => m[0].toLowerCase());
    if (cites.length && cites.every(id => usedBefore.has(id))) {
      log.push({ type: 'addition', section: a.section, applied: false, reason: `only repeats facts already in the draft (${[...new Set(cites)].join(', ')})` });
      continue;
    }
    const text = out[a.section] || '';
    const anchor = a.after ? locate(text, a.after) : null;
    // Insert after the paragraph holding the anchor sentence, or at the end of the slot if none is given / found
    const at = anchor ? (text.indexOf('\n', anchor.end) >= 0 ? text.indexOf('\n', anchor.end) : text.length) : text.length;
    out[a.section] = `${text.slice(0, at).trimEnd()}\n\n${String(a.text).trim()}\n\n${text.slice(at).trimStart()}`.trim();
    log.push({ type: 'addition', section: a.section, applied: true, anchored: !!anchor });
  }

  return { draft: out, log };
}

// Ids of the facts the draft already cites (from (clmN) / [clmN] markers)
export function usedClaimIds(draft) {
  const ids = new Set();
  for (const text of Object.values(draft)) {
    for (const m of String(text || '').matchAll(/clm\d+/gi)) ids.add(m[0].toLowerCase());
  }
  return ids;
}

export async function runRevision(job, feedback, previous, { key, model, provider, claims }) {
  const lang = languageProfile(job?.language);
  const items = feedback.items || [];
  const { min, max } = feedback.wordRange || lang.wordRange;
  const draft = Object.fromEntries(EDITABLE.map(k => [k, previous[k] || '']));

  // Length may be added only from facts the draft has not cited yet — if all are used, add nothing (no retelling to be long)
  const used = usedClaimIds(draft);
  const unusedClaims = claims.filter(c => !used.has(c.id));
  const shortBy = Math.max(0, min - (feedback.wordCount || 0));
  const canAdd = shortBy > 0 && unusedClaims.length > 0;

  const issueList = items.map((i, n) =>
    `${n + 1}. [${LABELS[i.section] || i.section || 'whole article'}] ${i.kind}${i.blocking ? ' (must fix)' : ''}: ${i.problem}` +
    (i.sentence ? `\n   Flagged sentence: "${i.sentence}"` : '') +
    (i.fix ? `\n   Suggested approach: ${i.fix}` : '')
  ).join('\n');

  const prompt = `You are the editor of the publication, fixing an article draft at specific points. The article is written in ${lang.name}.

## Problems to fix
${issueList}

## Facts checked against the originals (use only information in here)
${JSON.stringify(claims, null, 2)}

## Current draft
${JSON.stringify(draft, null, 2)}

## How to fix
- Never rewrite the whole article. Return only the parts that change.
- patches: for each item, "original" must be copied exactly from the current draft (the whole sentence or phrase) and "replacement" is the new text
  - If it cannot be fixed so that evidence supports it, make replacement "" to cut it.
  - If the problem is a hypothetical scene mixed in with real events, replace the whole scene with a real event from the verified facts.
  - Repetition problems: cut or shorten the repeated part.
  - If the same wrong fact appears elsewhere in the draft (title, standfirst, other slots), fix every place, not only the flagged sentence.
  - Never add the name of a news source or outlet (e.g. "Bloomberg reported") unless a verified fact states it clearly. If unsure, write "it was reported that".
  - Never add numbers, dates or periods that are not in the verified facts.
  - A hypothetical scene, or a scene that speaks to the reader as "You just...", is replaced with a real event. Never fix it by adding "Imagine".
- additions: ${canAdd
    ? `The article is about ${shortBy} words under the ${min}-word minimum. Add 1-3 new paragraphs **using only these facts that the draft has not yet cited:** ${unusedClaims.map(c => c.id).join(', ')}
  Explain context and terms for a general reader. Never repeat facts already in the draft (${[...used].join(', ') || '-'}). Never add facts outside the list.
  "after" is the exact sentence in the draft after which the new paragraph is inserted (may be empty = end of the slot)`
    : 'Add nothing — make it [] (the verified facts have all been used — do not retell to make it longer)'}
- Write in ${lang.name} only.
- New text that uses a fact gets (clmN) at the end as listed above (the system turns it into a Sources number); keep the existing markers in the parts you do not change.
- Voice follows the Voice Library: invite thought, do not preach, no sensational words such as "shocking", "exposed", "must read", "don't miss".
- The total length must not exceed ${max} words.

Answer in JSON:
{
  "patches": [{ "issue": 1, "section": "hook|why|step|actionable|title|deck", "original": "text exactly from the draft", "replacement": "new text, or \\"\\" to cut it" }],
  "additions": [{ "section": "hook|why|step|actionable", "after": "a sentence exactly from the draft, or \\"\\"", "text": "the new paragraph" }]
}`;

  const result = await callAI(prompt, { key, model, provider: provider || 'deepseek', maxTokens: 6000, temperature: 0.2 });
  const { draft: revised, log } = applyRevision(draft, result);

  return {
    ...previous,
    ...revised,
    revisionLog: [...(previous.revisionLog || []), { round: job.revision, applied: log.filter(l => l.applied).length, skipped: log.filter(l => !l.applied).length, log }],
    _usage: result._usage
  };
}
