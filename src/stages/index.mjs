import { callAI } from '../adapters/index.mjs';
import { join } from 'node:path';
import { jobDir } from '../paths.mjs';
import { gatherSources, verifyClaims } from './research.mjs';
import { runRevision, usedClaimIds } from './revise.mjs';
import { buildBlockdit, buildImagePlan } from './channels.mjs';
import { writeFile } from 'node:fs/promises';
import { PILLARS, TEMPLATE_IDS, SLOT_MAP, briefRules, evidenceRules, writeRules, reviewRules, avoidWords, slotGuide } from '../rules.mjs';
import { BLOCKDIT_WORD_RANGE, SECTIONS, countWords, countSections, findCJK, stripClaimMarkers, writeFields, findDuplicateParagraphs, namesTogetherInSource, properNames, findHypotheticalOpening } from './checks.mjs';
import { languageProfile, DEFAULT_LANGUAGE } from '../language.mjs';
import { readFileSync } from 'node:fs';
import { looksLikeModelJson, parseModelJson } from '../adapters/parseJson.mjs';
import { summarizeEvidence, evidenceNote } from '../evidenceBase.mjs';

const MAX_REVISIONS = 3; // Central rule: at most three internal revision rounds per job
const MAX_CLAIMS = 25;   // Keeps the evidence-stage answer under the token ceiling (a truncated answer can still be rescued by salvageClaims)

// The language the article is written in (job.language, default English)
const articleLanguage = job => languageProfile(job?.language);

async function call(prompt, options = {}) {
  return await callAI(prompt, { ...options, provider: options.provider || 'deepseek', model: options.model || '' });
}

// Corrections belong to this job only (job.reviewFeedback from the previous review round);
// they are not pulled from skill memory, which mixes in corrections from other jobs.
export async function runStage(stage, job) {
  const correction = job.reviewFeedback || null;
  const deepseekKey = job.deepseekKey || '';
  const model = job.model || '';
  const provider = job.provider || 'deepseek';

  switch (stage) {
    case 'brief': return await runBrief(job, null, deepseekKey, model, provider);
    case 'research': return await runResearch(job);
    case 'evidence': return await runEvidence(job, null, deepseekKey, model, provider);
    case 'outline': return await runOutline(job, null, deepseekKey, model, provider);
    case 'write': return await runWrite(job, correction, deepseekKey, model, provider);
    case 'review': return await runReview(job, deepseekKey, model, provider);
    case 'channels': return await runChannels(job);
    case 'final': return await runFinal(job);
    default: throw new Error(`Unknown stage: ${stage}`);
  }
}

async function runBrief(job, correction, key, model, provider) {
  const lang = articleLanguage(job);
  const ext = (job.external?.length ? `\nExternal information:\n${job.external.map(e => `- ${e.url} (${e.note || ''})`).join('\n')}` : '')
    + (job.transcripts?.length ? `\nInterviews / original texts supplied by the owner (use as evidence sources):\n${job.transcripts.map(t => `- ${t.label} (${t.text.length} characters)`).join('\n')}` : '');
  const template = job.template && job.template !== 'auto' ? job.template : '';

  const prompt = `You are the editor of the publication.

## Central rules (from rules/AUTOMATION_RULES.md — these outrank any other instruction at this stage)
${briefRules()}

---

Topic: ${job.topic}
Audience: ${job.audience}
Article language: ${lang.name}
${template ? `Article format chosen by the owner (must be used): ${template}` : ''}
${job.instructions ? `Guidance from the owner: ${job.instructions}` : ''}
${PILLARS.includes(job.pillar) ? `Content Pillar chosen by the owner (must be used): ${job.pillar}` : ''}
${ext}

${template ? '' : `Choose a Template by the intent of the topic (reflective / explainer_howto / opinion_column / feature_narrative / news_analysis) following the rules above
- opinion_column may be used only when the owner gave a clear stance in the guidance. Never infer a stance from the topic.
- feature_narrative needs real data behind every character, scene and quote.
- news_analysis is for topics that are real news or events that need their context explained (a court case, an agreement, a policy), not a how-to.`}
Keep the meaning of the topic. Do not widen the assignment or turn a question into a conclusion.

${correction ? `Corrections from the previous version: ${correction.summary}` : ''}

Answer in JSON:
{
  "summary": "a short summary (in ${lang.name})",
  "template": "reflective|opinion_column|feature_narrative|explainer_howto|news_analysis",
  "reason": "why this template was chosen",
  "pillar": "Human+AI|Life Skills|Documentary|Questions|Legacy",
  "ownerStance": "the stance the owner gave in the guidance (leave empty if none)",
  "keyPoints": ["key point 1", "key point 2", "key point 3"],
  "searchQueries": ["3-4 web search queries, in ${lang.name} and in the original language of the likely sources; specific names / events / organisations in the topic; do not go beyond the assignment"],
  "relevanceTerms": ["2-4 words or phrases that must appear on a web page that is really about the main event/issue of the topic, e.g. an event name or a specific person or organisation (such as \\"flood\\" for a flood topic). Never use generic words that pages about other subjects also contain, such as \\"price\\" or \\"product\\". Include both languages if sources may be in either. The system uses these to filter out irrelevant pages."],
  "primarySourceQueries": ["1 query aimed at the primary source of the story, e.g. a company statement or press release, an agency document, a court ruling / official announcement (in the language of the source). Use [] if the topic has no primary source."],
  "imageIdeas": {
    "cover": "description of the cover image",
    "hook": "description of the Hook image",
    "why": "description of the Why It Matters image",
    "step": "description of the Step-by-Step image",
    "actionable": "description of the Actionable Takeaway image",
    "closing": "description of the closing image"
  }
}`;
  const result = await call(prompt, { key, model, provider });

  // Rules enforced in code, not left to the AI
  const chosen = result.template;
  if (template) {
    result.template = template; // chosen by the owner → always used
  } else if (!TEMPLATE_IDS.includes(chosen)) {
    result.template = 'explainer_howto';
  } else if (chosen === 'opinion_column' && !String(job.instructions || '').trim()) {
    // Central rule: opinion_column only when the user gave a clear stance; otherwise reflective
    result.template = 'reflective';
  }
  // Pillar: chosen by the owner → always used. The AI may choose only from the 5 fixed names; anything else is invalid.
  const chosenPillar = result.pillar;
  if (PILLARS.includes(job.pillar)) result.pillar = job.pillar;
  else if (!PILLARS.includes(chosenPillar)) result.pillar = '';
  if (result.pillar !== chosenPillar) {
    result.pillarOverride = { suggested: chosenPillar || '', used: result.pillar, reason: PILLARS.includes(job.pillar) ? 'The owner chose the Pillar' : 'The AI answered a Pillar outside the 5 categories' };
  }
  if (result.template !== chosen) {
    result.templateOverride = { suggested: chosen, used: result.template, reason: template ? 'The owner chose the Template' : 'No stance from the owner, or the Template was invalid' };
  }
  return result;
}

// Search the web and open the real pages — the AI is never allowed to supply URLs itself (see research.mjs)
async function runResearch(job) {
  return await gatherSources(job);
}

async function runEvidence(job, correction, key, model, provider) {
  const lang = articleLanguage(job);
  const research = job.stages.research?.result || {};
  const brief = job.stages.brief?.result || {};
  const sources = research.sources || [];
  const sourceBlock = sources.map(s => s.retrieval_method === 'user_transcript'
    ? `[${s.id}] ${s.title}\nType: interview / original text supplied by the owner (no URL) — name the speaker only as it appears in the text\nText:\n${s.excerpt}`
    : `[${s.id}] ${s.title}\nURL: ${s.finalUrl || s.url}\nPublished: ${s.publishedDate || 'unknown'}\nText from the page:\n${s.excerpt}`
  ).join('\n\n---\n\n');

  const prompt = `You are the evidence checker.

## Central rules on evidence (from rules/AUTOMATION_RULES.md)
${evidenceRules()}

---

Topic: ${job.topic}
Template: ${brief.template || 'auto'}
${correction ? `Corrections: ${correction.summary}` : ''}

Below is text the system actually opened from real web pages. Use only this text.

${sourceBlock}

Rules:
- Extract facts relevant to the topic, only those the text above directly supports. Never use prior knowledge or guess.
- Pick only the important ones, at most ${MAX_CLAIMS}, most important first. Give each at most 2 quotes.
- quotes.text must be copied character for character from the text above, in the original language. Do not translate or paraphrase. At most 200 characters.
- Keep each rationale to one short sentence.
- The system checks that each quote is on the real page; if it is not found the claim becomes needs_verification.
- Numbers / statistics must state context, year, unit and limitations in the rationale.
- Allegations and disputed matters need at least two independent sources; otherwise set the status to unverified.
- A person's opinion has type attributed_testimony and confirms only that the person said it.

Answer in JSON:
{
  "claims": [
    {
      "id": "clm1",
      "claim": "the fact, written in ${lang.name}",
      "type": "primary_text|study|corroborated|attributed_testimony|fact|statistic",
      "status": "verified|unverified",
      "source_ids": ["src1"],
      "quotes": [{"source_id": "src1", "text": "text copied exactly from the source"}],
      "rationale": "why this text supports the fact"
    }
  ]
}`;
  const result = await call(prompt, { key, model, provider, maxTokens: 8000, temperature: 0.1 });

  // A long answer cut off → broken JSON: rescue only the complete items instead of silently getting 0
  let rawClaims = Array.isArray(result.claims) ? result.claims : [];
  const truncated = !Array.isArray(result.claims) && typeof result.raw === 'string';
  if (truncated) rawClaims = salvageClaims(result.raw);

  const claims = await verifyClaims(job, rawClaims, sources);
  const verifiedCount = claims.filter(c => c.status === 'verified').length;

  // Central rule: with no necessary evidence, say what is missing — do not make it up
  if (verifiedCount === 0) {
    throw new Error(
      `Evidence: no fact passed the check against the original text (${claims.length} extracted` +
      `${truncated ? ', the AI answer was cut off' : ''}) — stopped before writing so the article never lacks evidence`
    );
  }

  const { raw, ...rest } = result;
  return {
    ...rest,
    claims,
    truncated,
    verifiedCount,
    needsVerificationCount: claims.length - verifiedCount
  };
}

// Pull the claim objects that are fully closed out of truncated JSON text
export function salvageClaims(raw) {
  const start = raw.indexOf('[', raw.indexOf('"claims"'));
  if (start < 0) return [];
  const out = [];
  let depth = 0, objStart = -1, inString = false, escaped = false;
  for (let i = start + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') { if (depth++ === 0) objStart = i; }
    else if (ch === '}' && --depth === 0) {
      try { out.push(JSON.parse(raw.slice(objStart, i + 1))); } catch {}
    } else if (ch === ']' && depth === 0) break;
  }
  return out;
}

function verifiedClaims(job) {
  return (job.stages.evidence?.result?.claims || []).filter(c => c.status === 'verified');
}

// Send outline/write only the fields they need (no quotes or check results)
function claimsForWriter(job) {
  return verifiedClaims(job).map(({ id, claim, type, source_ids, rationale }) => ({ id, claim, type, source_ids, rationale }));
}

async function runOutline(job, correction, key, model, provider) {
  const lang = articleLanguage(job);
  const brief = job.stages.brief?.result || {};
  const template = brief.template || 'explainer_howto';
  const structure = getTemplateStructure(template);

  const prompt = `You are the editor.
Topic: ${job.topic}
Template: ${template}
Summary: ${brief.summary || ''}
Evidence (only what was checked against the originals): ${JSON.stringify(claimsForWriter(job))}
${correction ? `Corrections: ${correction.summary}` : ''}

Create an outline for a Blockdit-format article following the Template ${template}:

Structure to use:
${structure}

Divide the facts among the slots — **each claim goes in exactly one slot** (no two slots may tell the same fact) — and use every claim.
Headings are written in ${lang.name} to suit the content; do not use the words Hook / Step-by-Step.
For news topics the hook slot opens with a real event, not an imagined scene.

Answer in JSON:
{
  "title": "the title (in ${lang.name})",
  "deck": "a short standfirst",
  "headings": { "hook": "heading of the opening slot", "why": "heading of the second slot", "step": "heading of the main slot", "actionable": "heading of the closing slot" },
  "sections": {
    "hook": { "points": "the points this slot will tell", "claim_ids": ["clm1"] },
    "why": { "points": "...", "claim_ids": ["clm2", "clm3"] },
    "step": { "points": "...", "claim_ids": ["clm4", "clm5"] },
    "actionable": { "points": "...", "claim_ids": [] }
  }
}`;
  return await call(prompt, { key, model, provider });
}

// The structure comes from the Template YAML files (rules/Template/*.yaml) through rules.mjs.
// There are always 4 internal slots — each Template maps its own stages onto them and names its own headings.
function getTemplateStructure(template) {
  return `4 content slots, mapped to the stages of Template ${template} as follows (the detail of each stage is in the template):
${slotGuide(template)}

Approximate share of the total length: hook ~20% · why ~25% · step ~35% · actionable ~20%
If the Template is not explainer_howto, never invent practical steps in the step slot; make it the main content according to the Template's stages.`;
}

async function runWrite(job, correction, key, model, provider) {
  const outline = job.stages.outline?.result || {};
  const brief = job.stages.brief?.result || {};
  const template = brief.template || 'explainer_howto';
  const structure = getTemplateStructure(template);
  const previous = job.stages.write?.result;

  // Revision round: fix sentence by sentence in the existing draft (revise.mjs), do not rewrite the whole piece
  if (correction?.items?.length && previous) {
    return await runRevision(job, correction, previous, { key, model, provider, claims: claimsForWriter(job) });
  }

  return await writeBySection(job, { key, model, provider, template, structure, outline, brief });
}

// ─── Write slot by slot ──────────────────────────────────────────────────────
// Written in one go, the whole article comes out around 1,000 words whatever the model (even with 25 facts),
// so it is written slot by slot. Each slot has its own length target, gets only its own facts, and sees the
// slots already written (so it does not retell them).
// The minimum targets must add up to at least the lower end of the language's word range (a test checks this).

export const SECTION_TARGETS = languageProfile(DEFAULT_LANGUAGE).sectionTargets;
const SLOT_ROLE = { hook: 'opening slot', why: 'second slot', step: 'main content slot', actionable: 'closing slot' };

const TRIM_OVER_RATIO = 1.2;

export function trimPrompt(text, claims, words, hi, language = DEFAULT_LANGUAGE) {
  return `This slot of the article is ${words} words, over the target of ${hi} words — tighten it to at most ${hi} words.

- Keep every fact and keep the (clmN) marker at the end of the original sentence for every id: ${claims.map(c => c.id).join(', ')}
- Cut repetition, over-explanation and repeated examples. Do not add new facts.
- Keep the voice and the order of the story. Write in ${languageProfile(language).name} only.

Original text:
${text}

Answer in JSON: { "text": "the tightened text, paragraphs separated by a blank line" }`;
}

// Accept the tightened version when it is shorter, not empty, and every claim cited before is still cited
export function acceptTrim(original, trimmed) {
  if (!trimmed || countWords(trimmed) >= countWords(original)) return false;
  const marks = t => new Set([...String(t).matchAll(/clm\d+/gi)].map(m => m[0].toLowerCase()));
  const before = marks(original), after = marks(trimmed);
  return [...before].every(id => after.has(id));
}

// Each claim lives in one slot only — claims the outline did not place go to the main content slot
export function allocateClaims(claims, outline) {
  const valid = new Set(claims.map(c => c.id));
  const owner = new Map();
  for (const slot of SECTIONS) {
    for (const raw of outline?.sections?.[slot]?.claim_ids || []) {
      const id = String(raw).toLowerCase();
      if (valid.has(id) && !owner.has(id)) owner.set(id, slot);
    }
  }
  for (const c of claims) if (!owner.has(c.id)) owner.set(c.id, 'step');
  return Object.fromEntries(SECTIONS.map(slot => [slot, claims.filter(c => owner.get(c.id) === slot)]));
}

export function sectionPrompt(job, { template, structure, outline, slot, mine, others, written }) {
  const lang = articleLanguage(job);
  const [lo, hi] = lang.sectionTargets[slot];
  const heading = outline.headings?.[slot] || SECTION_LABELS[slot];
  const stages = (SLOT_MAP[template] || SLOT_MAP.explainer_howto)[slot].join(' + ');
  const before = SECTIONS.slice(0, SECTIONS.indexOf(slot)).filter(s => written[s])
    .map(s => `### ${outline.headings?.[s] || SECTION_LABELS[s]}\n${written[s]}`).join('\n\n');

  return `You are an article writer for the publication, writing in ${lang.name} — this round you write only the **${SLOT_ROLE[slot]}** of the article.

# Rules from the owner's files (rules/) — these outrank any other instruction in this message
${writeRules(template)}

---

# Additional requirements of the automated system

## Evidence
- Facts, numbers, dates, names of people / organisations and events may come only from the Claims below. Never add from prior knowledge.
- Never add detail the Claims do not give, such as a country, a period, a rank or a type.
- For quotes or opinions, name the speaker exactly as the Claims do — "Company X said" is not "a spokesperson / executive said". Never invent a quote.
- If a story has several stages or several sides, tell every stage according to the Claims.
- Put (clmN) at the end of every sentence that uses that fact. The system turns it into a Sources number.
- Quotes in another language are translated into ${lang.name}, with the original in brief brackets when needed · write in ${lang.name} only.
- Never put in image links or image credits.
${slot === 'hook' ? `
## Opening
- For a news topic or a real event, open with the real event from the Claims.
- Never open with "Imagine", "Suppose" or a scene that assumes the reader, such as "You just..." "Have you ever felt..." "If you..." — the system checks the first sentence in code and sends it back for correction.
- The first sentence is a real event or fact from the Claims, or a real question readers have that the Claims answer.
- Never inflate numbers, such as "many users", unless the Claims say so.
` : ''}
---

# The article

**Topic:** ${job.topic} · **Template:** ${template} · **Audience:** ${job.audience}
${job.instructions ? `**Guidance / stance from the owner:** ${job.instructions}\n` : ''}**Structure of the whole piece:**
${structure}

${before ? `**Already written (continue smoothly; never retell what is in here):**\n${before}\n` : ''}
---

# This round's task: ${SLOT_ROLE[slot]} — heading "${heading}"

- Role according to the Template: ${stages}
- Points from the outline: ${outline.sections?.[slot]?.points || '-'}
- **Length ${lo}–${hi} words** — build the length from the context of the facts (who did what, when, why), from explaining terms to a general reader, and from the writer's view clearly marked as opinion ("the writer sees", "may") — never retell in order to be long.
- **Claims for this slot (use every one):**
${JSON.stringify(mine, null, 2)}
- Claims already told or still to be told in other slots (**do not retell** — a brief reference is allowed if needed to understand): ${others.map(c => `${c.id}: ${c.claim.slice(0, 60)}`).join(' | ') || '-'}
${slot === 'actionable' ? '- Closing slot: what the reader can really do, or a question to think about. Do not recap the whole article and do not close with a sales pitch.\n' : ''}
Answer in JSON:
{ "text": "the content of this slot, paragraphs separated by a blank line (no heading)", "imagePrompt": "a description of an illustration for this slot" }`;
}

// Traces of the model's raw answer inside article text: a ``` code block or the system's JSON keys
export function leakedModelOutput(text) {
  const t = String(text ?? '');
  return t.includes('```') || /"imagePrompt"\s*:/.test(t) || /^\s*\{\s*"text"\s*:/m.test(t);
}

// Article text from the model's answer: it must be the text field only — a raw blob that looks like
// JSON or a code block is not article text.
// Seen in practice in OBA-8fa049fc: the model sent JSON inside JSON — the outer text field was a ```json { "text": ... } block.
// If the inner text still cannot be extracted, return empty (the caller retries / stops the job)
// rather than use the raw blob as article text.
export function modelText(result) {
  let t = typeof result?.text === 'string' ? result.text
    : (typeof result?.raw === 'string' ? result.raw : '');
  for (let depth = 0; depth < 3 && looksLikeModelJson(t); depth++) {
    const inner = parseModelJson(t);
    t = typeof inner?.text === 'string' ? inner.text : '';
  }
  if (looksLikeModelJson(t)) return '';
  return t.replace(/^#+\s.*\n+/, '').trim();
}

async function writeBySection(job, { key, model, provider, template, structure, outline, brief }) {
  const lang = articleLanguage(job);
  const claims = claimsForWriter(job);
  const allocation = allocateClaims(claims, outline);
  const written = {};
  const imagePrompts = {};
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (const slot of SECTIONS) {
    const mine = allocation[slot];
    const others = claims.filter(c => !mine.includes(c));
    const prompt = sectionPrompt(job, { template, structure, outline, slot, mine, others, written });
    let result = await call(prompt, { key, model, provider, maxTokens: 4000 });
    let text = modelText(result);
    for (const k of Object.keys(usage)) usage[k] += result._usage?.[k] || 0;
    // The answer cannot be read as JSON (e.g. cut off) → retry once; never use the raw blob as article text
    if (!text) {
      result = await call(prompt, { key, model, provider, maxTokens: 4000 });
      text = modelText(result);
      for (const k of Object.keys(usage)) usage[k] += result._usage?.[k] || 0;
    }
    if (!text) throw new Error(`Write: slot ${slot} came back empty or the model's answer could not be read`);
    let finalText = text;

    // A slot far over target (seen: the step slot of opinion/reflective at 934–1,202 words) → ask for one tightening.
    // Accept the tightened version only if it is really shorter and still cites every claim of this slot.
    const [, hi] = lang.sectionTargets[slot];
    if (countWords(text) > hi * TRIM_OVER_RATIO) {
      const trimmed = await call(trimPrompt(text, mine, countWords(text), hi, job.language), { key, model, provider, maxTokens: 4000 });
      const trimmedText = modelText(trimmed);
      for (const k of Object.keys(usage)) usage[k] += trimmed._usage?.[k] || 0;
      if (acceptTrim(text, trimmedText)) finalText = trimmedText;
    }
    written[slot] = finalText;
    imagePrompts[slot] = result.imagePrompt || '';
  }

  const ideas = brief.imageIdeas || {};
  return {
    title: outline.title || job.topic,
    deck: outline.deck || '',
    headings: { ...Object.fromEntries(SECTIONS.map(s => [s, SECTION_LABELS[s]])), ...(outline.headings || {}) },
    ...written,
    coverImagePrompt: ideas.cover || '',
    hookImagePrompt: imagePrompts.hook,
    whyImagePrompt: imagePrompts.why,
    stepImagePrompt: imagePrompts.step,
    actionableImagePrompt: imagePrompts.actionable,
    closingImagePrompt: ideas.closing || '',
    claimAllocation: Object.fromEntries(SECTIONS.map(s => [s, allocation[s].map(c => c.id)])),
    writeMode: 'by_section',
    _usage: usage
  };
}

const SECTION_LABELS = { title: 'Title', deck: 'Standfirst', hook: 'Hook', why: 'Why It Matters', step: 'Step-by-Step', actionable: 'Actionable Takeaway' };

// Checks done in code: word count, CJK characters, leaked reference markers
export function mechanicalIssues(write, words, language = DEFAULT_LANGUAGE) {
  const issues = [];
  const { min, max } = languageProfile(language).wordRange;
  if (words.total < min || words.total > max) {
    issues.push({
      kind: 'word_count',
      blocking: false,
      problem: `Length is ${words.total} words, outside the range ${min}–${max}`,
      fix: words.total < min
        ? 'Add content from evidence not yet used. Never repeat what is already there. If the evidence is not enough, keep the length and say so.'
        : 'Cut the repetitive or unnecessary parts'
    });
  }
  for (const key of ['title', 'deck', ...SECTIONS]) {
    for (const hit of findCJK(write[key])) {
      issues.push({ kind: 'cjk', blocking: true, section: key, sentence: hit.raw, problem: `Chinese/Japanese/Korean characters found in ${SECTION_LABELS[key]}: "...${hit.context}..."`, fix: 'Replace the characters with words in the article language that mean the same' });
    }
  }
  // The model's raw answer (JSON / code block) leaked into the article text (seen in OBA-8fa049fc) = must fix
  for (const key of ['title', 'deck', ...SECTIONS]) {
    if (leakedModelOutput(write[key])) {
      issues.push({ kind: 'leaked_json', blocking: true, section: key, sentence: String(write[key]).trim().slice(0, 120), problem: `${SECTION_LABELS[key]} contains raw model output (JSON / code block) that leaked into the article text`, fix: 'Rewrite this slot as pure article text with no JSON or ``` marks' });
    }
  }
  // Hook opens with a hypothetical scene / assumes the reader (e.g. "Have you ever felt...") = must fix (seen in OBA-67b67cd6)
  const hypothetical = findHypotheticalOpening(write, language);
  if (hypothetical) {
    issues.push({
      kind: 'hypothetical_opening', blocking: true, section: 'hook',
      sentence: hypothetical.sentence,
      problem: `The Hook opens with ${hypothetical.label} ("${hypothetical.sentence}") — a news topic must open with a real event from the evidence; never create a hypothetical scene or assume the reader`,
      fix: 'Replace the opening sentence with a real event / fact from the Claims allocated to this slot'
    });
  }

  // Near word-for-word duplicate paragraphs = must fix (the AI reviewer once treated them as only an observation, and they reached the approved version)
  for (const d of findDuplicateParagraphs(write)) {
    issues.push({
      kind: 'duplicate_paragraph', blocking: true, section: d.duplicate.section,
      sentence: d.duplicate.text,
      problem: `This paragraph repeats an earlier paragraph in ${SECTION_LABELS[d.first.section]} (${Math.round(d.score * 100)}% of the same words)`,
      fix: 'Delete the whole repeated paragraph (replacement is "")'
    });
  }

  // (clmN) in the draft is a deliberate reference marker — the channels stage turns it into a Sources number.
  // Words to avoid per the Voice Library → observation (a direct quote from a source is exempt, so it does not block)
  for (const key of ['title', 'deck', ...SECTIONS]) {
    for (const word of avoidWords()) {
      const text = stripClaimMarkers(write[key] || '');
      const at = text.toLowerCase().indexOf(word.toLowerCase());
      if (at >= 0) {
        issues.push({
          kind: 'voice', blocking: false, section: key,
          sentence: text.slice(Math.max(0, at - 30), at + word.length + 30),
          problem: `Uses the word "${word}", which the Voice Library says to avoid in the narrator's voice`,
          fix: 'Change to a plain word, unless it is a direct quote from the source'
        });
      }
    }
  }
  return issues;
}

async function runReview(job, key, model, provider) {
  const lang = articleLanguage(job);
  const range = lang.wordRange;
  const write = job.stages.write?.result || {};
  const sources = job.stages.research?.result?.sources || [];
  const words = countSections(write);
  const mechanical = mechanicalIssues(write, words, job.language);

  const article = ['title', 'deck', ...SECTIONS]
    .map(k => `### ${SECTION_LABELS[k]}\n${write[k] || ''}`).join('\n\n');
  const claims = verifiedClaims(job).map(({ id, claim, type, source_ids, quotes }) => ({ id, claim, type, source_ids, quotes }));
  const sourceBlock = sources.map(s => `[${s.id}] ${s.title}\n${s.excerpt}`).join('\n\n---\n\n');

  const prompt = `You are the fact-checking editor of the publication.

## Rules from the owner's files (rules/)
${reviewRules()}

---

Topic: ${job.topic}

Check the whole article below sentence by sentence against the "verified facts" and the "text from the original sources".
A (clmN) marker in the article refers to the fact with that id — use it to help check. If a sentence cites a clm that does not support the sentence, count it as unsupported.

## Verified facts
${JSON.stringify(claims, null, 2)}

## Text from the original sources (web pages the system actually opened)
${sourceBlock}

## The article to check
${article}

## What to look for
- unsupported: a sentence with a fact, number, date, name or event that is neither in the verified facts nor in the original sources
- embellished: detail added beyond the original, such as a country, a period, a rank, or a meaning made stronger than the original
- misattributed: a quote or opinion credited to the wrong person, several sources merged into one person's words, or a news outlet called a person
- incomplete: a story the original tells in several stages or from several sides told from one side only, so the reader is misled
- fabricated_experience: a user experience or scene written as if it really happened but with no evidence (including scenes that speak to the reader as "You just..." "You have ever...") — the fix is to replace it with a real event from the verified facts; never suggest adding "Imagine" or "Suppose", because a news topic must open with a real event
- repetition: paragraphs or items that repeat each other to add length

Rules:
- Check every part in order: title, standfirst, Hook, Why, Step, Actionable — every sentence containing a number, date, period, name of a person / organisation / outlet, or a quote must be compared with the evidence one by one.
- If the same error appears in several places (e.g. both the standfirst and the Hook), list each as a separate item, every place.
- If one sentence has several problems (e.g. both repetition and a wrong speaker), split them into several items by kind — never fold a factual problem into a repetition item.
- Always check the speaker: if the original says "Company X said" but the article says "a spokesperson / executive / CEO said" = misattributed.
- "sentence" must be copied exactly from the article so the system can locate it.
- List only sentences with a real problem. Never list a correct sentence.
- Analysis, observations or advice from the writer that use opinion or possibility words (e.g. "may", "probably", "in the writer's view") and claim no new facts are not a problem.
- blocking = true only when the reader would receive a wrong fact: a fact without evidence, detail added beyond the original, a quote credited to the wrong person, an incomplete telling that misleads, a hypothetical experience not labelled as hypothetical.
- blocking = false for style, repetition, or an opinion that should be made clearer as opinion.
- If you find no problem, make issues [] — never invent problems.
- Do not give a numeric score.

Answer in JSON:
{
  "issues": [
    {
      "kind": "unsupported|embellished|misattributed|incomplete|fabricated_experience|repetition",
      "section": "title|deck|hook|why|step|actionable",
      "sentence": "the sentence exactly as in the article",
      "problem": "what is wrong, compared with the original",
      "evidence": "the clm id or src id and the relevant original text (if any)",
      "blocking": true,
      "fix": "how to fix it, or cut it"
    }
  ]
}`;

  const result = await call(prompt, { key, model, provider, maxTokens: 4000, temperature: 0 }); // keep the review consistent across rounds

  // Keep only issues that (1) point to a sentence that really is in the article and (2) the reviewer did not itself say are not problems
  const fullText = writeFields(write).join('\n').replace(/\s+/g, ' ');
  const SELF_CLEARED = lang.selfCleared;
  // The reviewer sometimes puts a "wrong speaker" remark inside another kind (e.g. repetition) — check the description again
  const MISATTRIBUTION = lang.misattribution;
  const aiIssues = (Array.isArray(result.issues) ? result.issues : []).map(i => {
    const hiddenMisattribution = i.kind !== 'misattributed' && MISATTRIBUTION.test(i.problem || '');
    return {
      ...i,
      ...(hiddenMisattribution && { kind: 'misattributed', originalKind: i.kind }),
      // Wrong speaker / unlabelled hypothetical experience → always fix, even when the reviewer did not set blocking
      blocking: i.blocking === true || hiddenMisattribution || i.kind === 'misattributed' || i.kind === 'fabricated_experience',
      located: !!i.sentence && fullText.includes(String(i.sentence).replace(/\s+/g, ' ').trim().slice(0, 60))
    };
  });
  const factIssues = aiIssues.filter(i =>
    !SELF_CLEARED.test(i.problem || '') && (i.located || i.kind === 'repetition' || i.kind === 'incomplete')
  );

  // A "wrong speaker" the original really supports (every name in the sentence appears together in one source)
  // is lowered to an observation for the owner to look at
  const sourceTexts = sources.map(s => {
    try { return readFileSync(join(jobDir(job.id), s.textFile), 'utf-8'); } catch { return s.excerpt || ''; }
  });
  for (const i of factIssues) {
    if (i.kind === 'misattributed' && i.blocking && namesTogetherInSource(i.sentence, sourceTexts)) {
      i.blocking = false;
      i.sourceCheck = 'names_found_together_in_source';
      i.problem = `${i.problem} — [the system checked the original: the names ${properNames(i.sentence).join(', ')} appear together in the source text, so this may not be a misattribution; owner please check]`;
    }
  }
  const issues = [...mechanical, ...factIssues];

  // Must-fix before publishing = blocking; the rest (word count, style, repetition) can go to the writer but does not block the job
  const blockingIssues = issues.filter(i => i.blocking);
  const verdict = issues.length === 0 ? 'pass' : blockingIssues.length ? 'repair' : 'advisory';
  const revision = job.revision || 1;
  // Revise again only when there is a must-fix item or the length is out of range — style observations alone do not trigger it,
  // because every AI revision risks new errors (seen in test jobs: fixing repetition produced a claim with no evidence).
  // A too-short piece can be revised again only if verified facts remain that the draft has not cited — otherwise it only adds repetition.
  const unusedClaims = claimsForWriter(job).filter(c => !usedClaimIds(write).has(c.id));
  const lengthFixable = issues.some(i => i.kind === 'word_count') && (words.total > range.max || unusedClaims.length > 0);
  const canRetry = (blockingIssues.length > 0 || lengthFixable) && revision < MAX_REVISIONS;

  const review = {
    _usage: result._usage,
    verdict,
    revision,
    wordCount: words.total,
    wordRange: range,
    breakdown: words.breakdown,
    counter: { method: words.method, node: words.node, icu: words.icu },
    issues,
    discardedIssues: aiIssues.filter(i => !factIssues.includes(i)),
    retry: canRetry
  };

  if (canRetry) {
    // Give the reviser only the must-fix items + length problems — observations (style / analysis) are the owner's call
    // (seen in practice: with observations included, the reviser deleted the analysis and the article shrank from 1,087 to 772 words)
    const toFix = issues.filter(i => i.blocking || i.kind === 'word_count');
    review.feedback = {
      summary: toFix.map((i, n) => {
        const where = i.section ? `[${SECTION_LABELS[i.section] || i.section}] ` : '';
        const quote = i.sentence ? `\n   Sentence: "${i.sentence}"` : '';
        return `${n + 1}. ${where}${i.kind}: ${i.problem}${quote}\n   Fix: ${i.fix || 'Correct it to match the evidence, or cut it'}`;
      }).join('\n'),
      issues: toFix.map(i => `${i.kind}: ${i.problem}`),
      // Structured list for the sentence-by-sentence revision stage
      items: toFix.map(({ kind, section, sentence, problem, fix, blocking }) => ({ kind, section, sentence, problem, fix, blocking })),
      wordCount: words.total,
      wordRange: range
    };
  }
  return review;
}

async function runChannels(job) {
  const write = job.stages.write?.result || {};
  const research = job.stages.research?.result || {};
  const { total, breakdown } = countSections(write);

  const blockdit = buildBlockdit(job, write, verifiedClaims(job), research.sources || []);

  // No real image files yet → keep the image plan separate; no image links in the body
  const imagePlanFile = 'image_plan.md';
  await writeFile(join(jobDir(job.id), imagePlanFile), buildImagePlan(job, write, write.headings), 'utf-8');

  return {
    status: 'complete',
    blockdit: {
      title: blockdit.title,
      deck: blockdit.deck,
      body: blockdit.body,
      headings: write.headings || null,
      sources: blockdit.cited.map(c => c.source.id),
      removedDuplicates: blockdit.removedDuplicates,
      wordCount: total,
      breakdown,
      imageStatus: 'awaiting_images',
      imagePlanFile
    },
    website: {
      title: blockdit.title,
      description: blockdit.deck,
      category: 'T',
      body: blockdit.body
    },
    imagePrompts: {
      cover: write.coverImagePrompt || '',
      hook: write.hookImagePrompt || '',
      why: write.whyImagePrompt || '',
      step: write.stepImagePrompt || '',
      actionable: write.actionableImagePrompt || '',
      closing: write.closingImagePrompt || ''
    }
  };
}

// The last gate: checks the version that goes to a person to read. It is not an approval (the Human Gate belongs to the owner).
async function runFinal(job) {
  const channels = job.stages.channels?.result || {};
  const review = job.stages.review?.result || {};
  const evidence = job.stages.evidence?.result || {};
  const research = job.stages.research?.result || {};
  const body = channels.blockdit?.body || '';
  const publishText = [channels.blockdit?.title, channels.blockdit?.deck, body].join('\n');

  const blockers = [];
  if (review.verdict === 'repair') {
    blockers.push(...(review.issues || []).filter(i => i.blocking).map(i => ({
      kind: i.kind, section: i.section || '', problem: i.problem, sentence: i.sentence || '', fix: i.fix || ''
    })));
  }
  for (const hit of findCJK(publishText)) {
    blockers.push({ kind: 'cjk', problem: `Chinese/Japanese/Korean characters found in the publishable version: "...${hit.context}..."` });
  }
  if (stripClaimMarkers(publishText) !== publishText) {
    blockers.push({ kind: 'claim_marker', problem: 'Reference codes (clmN) are still in the publishable version' });
  }
  if (leakedModelOutput(publishText)) {
    blockers.push({ kind: 'leaked_json', problem: 'The publishable version contains raw model output (JSON / ``` code block) that leaked in' });
  }
  // Paragraphs that are still very alike (≥80%) after exact duplicates were removed
  const bodyParas = body.split('**Sources:**')[0];
  for (const d of findDuplicateParagraphs({ hook: bodyParas })) {
    blockers.push({ kind: 'duplicate_paragraph', problem: `Paragraphs are ${Math.round(d.score * 100)}% alike`, sentence: d.duplicate.text.slice(0, 200), fix: 'Delete the repeated paragraph' });
  }
  if (!(channels.blockdit?.sources || []).length) {
    blockers.push({ kind: 'no_sources', problem: 'There are no sources that could be opened' });
  }

  // Do not block, but must be reported so the person reviewing sees them
  const notes = [];
  const range = review.wordRange || articleLanguage(job).wordRange;
  if (review.wordCount < range.min || review.wordCount > range.max) {
    notes.push(`Length is ${review.wordCount} words, outside the Blockdit range ${range.min}–${range.max} (counted with Intl.Segmenter) — the owner decides whether to add content or publish as is`);
  }
  const advisories = (review.issues || []).filter(i => !i.blocking && i.kind !== 'word_count');
  if (advisories.length) notes.push(`${advisories.length} style / repetition observation(s) that do not block the job (see the list below)`);
  const unverified = (evidence.claims || []).filter(c => c.status !== 'verified');
  if (unverified.length) notes.push(`${unverified.length} fact(s) failed the check against the original, so they were kept out of the article`);
  // The article's evidence base: count only the facts and sources the article really cites
  const citedIds = new Set(channels.blockdit?.sources || []);
  const evidenceBase = summarizeEvidence(
    (evidence.claims || []).filter(c => (c.source_ids || []).some(id => citedIds.has(id))),
    (research.sources || []).filter(s => citedIds.has(s.id))
  );
  if (evidenceNote(evidenceBase)) notes.push(evidenceNote(evidenceBase));
  if ((research.offTopic || []).length) notes.push(`${research.offTopic.length} source(s) could be opened but do not mention the main point of the topic (no occurrence of ${(research.relevanceTerms || []).join(' / ')}), so they were not used`);
  if (research.relevanceRelaxed) notes.push('The source relevance filter was relaxed because fewer than 2 sources remained — check that the sources match the topic');
  if ((research.unreadable || []).length) notes.push(`${research.unreadable.length} source(s) could not be opened, so they were not used`);
  if ((channels.blockdit?.removedDuplicates || []).length) notes.push(`The system automatically removed ${channels.blockdit.removedDuplicates.length} paragraph(s) that repeated word for word`);
  if ((review.discardedIssues || []).length) notes.push(`The AI reviewer reported ${review.discardedIssues.length} issue(s) whose sentence could not be found in the article (see review.discardedIssues)`);

  return {
    verdict: blockers.length ? 'needs_revision' : 'ready_for_human_review',
    blockers,
    notes,
    advisories: advisories.map(i => ({ kind: i.kind, section: i.section || '', problem: i.problem, sentence: i.sentence || '', fix: i.fix || '' })),
    revisions: job.revision || 1,
    evidenceBase,
    wordCount: channels.blockdit?.wordCount || 0,
    disclaimer: 'Ready for Human Review means it passed the internal checks the system reports. It does not certify that every fact is correct.',
    completedAt: new Date().toISOString()
  };
}
