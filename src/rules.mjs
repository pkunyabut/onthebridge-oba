// ─── Rule Files Loader ───────────────────────────────────────────────────────
// Reads the rule files from rules/ on every call, so editing a rule file affects the next job
// immediately, with no restart. Each stage gets only the sections relevant to it, not whole files.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES_DIR } from './paths.mjs';

// The five fixed content Pillars (see rules/AUTOMATION_RULES.md). To use your own categories,
// change this list, the matching line in AUTOMATION_RULES.md, and the <select> in public/index.html.
export const PILLARS = ['Human+AI', 'Life Skills', 'Documentary', 'Questions', 'Legacy'];
export const TEMPLATE_IDS = ['reflective', 'explainer_howto', 'opinion_column', 'feature_narrative', 'news_analysis'];

// The system always has four content slots (review / revision / word count / UI share them).
// Each template maps its own stages onto these slots and may name its sections however it likes.
export const SLOT_MAP = {
  explainer_howto: { hook: ['Problem / Question'], why: ['Why It Matters'], step: ['Step-by-Step Explanation'], actionable: ['Actionable Takeaway'] },
  reflective: { hook: ['Hook'], why: ['Context'], step: ['Story', 'Insight'], actionable: ['Takeaway', 'Reflection'] },
  opinion_column: { hook: ['Thesis'], why: ['Supporting Reasons'], step: ['Steelman'], actionable: ['Reaffirm'] },
  feature_narrative: { hook: ['Opening Scene'], why: ['Theme Statement', 'Background / Evidence'], step: ['Rising Detail'], actionable: ['Closing Scene (Bookend)'] },
  news_analysis: { hook: ['Lead'], why: ['Key Facts'], step: ['Background and Perspectives'], actionable: ['Implications and What to Watch'] }
};

function read(relPath) {
  try {
    return readFileSync(join(RULES_DIR, relPath), 'utf-8');
  } catch {
    return '';
  }
}

// Pull "## Name" sections out of a Markdown file (each runs to the next "## " heading)
function sections(text, names) {
  const parts = text.split(/^(?=## )/m);
  return names
    .map(name => parts.find(p => p.startsWith(`## ${name}`)))
    .filter(Boolean)
    .map(p => p.trim())
    .join('\n\n');
}

const RULES = 'AUTOMATION_RULES.md';
const VOICE = 'OntheBridge_Voice_Library_v1.0.md';
const BLOCKDIT = 'BLOCKDIT_FORMAT.md';
const BLOCKDIT_TEMPLATE = 'Template/blockdit_article.md';

export function templateYaml(id) {
  return TEMPLATE_IDS.includes(id) ? read(`Template/${id}.yaml`) : '';
}

// brief stage: goal, sequence, and how to choose a Template
export function briefRules() {
  return sections(read(RULES), ['Goal', 'Sequence', 'Templates and voice']);
}

// evidence stage: evidence types and prohibitions
export function evidenceRules() {
  return sections(read(RULES), ['Evidence']);
}

// write / revision stage: goal, evidence, voice, Blockdit format, and the chosen Template
export function writeRules(templateId) {
  return [
    sections(read(RULES), ['Goal', 'Evidence', 'Templates and voice']),
    sections(read(VOICE), ['Principles', 'Words to avoid in the narrator\'s voice', 'Voice examples (3 pairs)']),
    sections(read(BLOCKDIT_TEMPLATE), ['Writing instructions']),
    sections(read(BLOCKDIT), ['Format adopted']),
    templateYaml(templateId) && `## Selected template (${templateId})\n${templateYaml(templateId)}`
  ].filter(Boolean).join('\n\n---\n\n');
}

// review stage: evidence, checks, and words to avoid
export function reviewRules() {
  return [
    sections(read(RULES), ['Evidence', 'Review and delivery']),
    sections(read(VOICE), ['Principles', 'Words to avoid in the narrator\'s voice'])
  ].filter(Boolean).join('\n\n---\n\n');
}

// Words to avoid in the narrator's voice — checked in code (advisory, not blocking:
// a direct quote from a source is exempt)
export function avoidWords() {
  const block = sections(read(VOICE), ['Words to avoid in the narrator\'s voice']);
  const firstLine = block.split('\n').find(l => l.trim() && !l.startsWith('##')) || '';
  return firstLine.split(/[,，]/).map(w => w.trim()).filter(w => w && w.length <= 20);
}

export function slotGuide(templateId) {
  const map = SLOT_MAP[templateId] || SLOT_MAP.explainer_howto;
  return Object.entries(map).map(([slot, stages]) => `- ${slot}: ${stages.join(' + ')}`).join('\n');
}
