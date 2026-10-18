// ─── Deterministic Checks ────────────────────────────────────────────────────
// Checks done in code, not by AI: word count, CJK characters, and leaked reference markers.

import { languageProfile, DEFAULT_LANGUAGE } from '../language.mjs';

// Central rule: Blockdit length range per language (see src/language.mjs and rules/BLOCKDIT_FORMAT.md)
export const BLOCKDIT_WORD_RANGE = languageProfile(DEFAULT_LANGUAGE).wordRange;
export const wordRangeFor = language => languageProfile(language).wordRange;
export const SECTIONS = ['hook', 'why', 'step', 'actionable'];

// One segmenter serves English and Thai: ICU splits Latin text on spaces/punctuation and segments
// Thai with its dictionary whatever locale is passed.
const segmenter = new Intl.Segmenter('en', { granularity: 'word' });

export const COUNTER_INFO = {
  method: "Intl.Segmenter(word) · isWordLike",
  node: process.versions.node,
  icu: process.versions.icu
};

// Destination URLs and Markdown marks are not counted
function stripMarkdown(text) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>#|~]+/g, ' ');
}

export function countWords(text) {
  let n = 0;
  for (const s of segmenter.segment(stripMarkdown(text))) if (s.isWordLike) n++;
  return n;
}

export function countSections(write) {
  const breakdown = {};
  let total = 0;
  for (const s of SECTIONS) {
    // The (clmN) markers become source numbers in the published version, so they are not counted
    breakdown[s] = countWords(stripClaimMarkers(write?.[s]));
    total += breakdown[s];
  }
  return { total, breakdown, ...COUNTER_INFO };
}

// Rule: no Chinese, Japanese or Korean characters
const CJK = /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿가-힯ᄀ-ᇿ㄰-㆏ｦ-ﾟ]+/g;

export function findCJK(text) {
  const found = [];
  const s = String(text || '');
  for (const m of s.matchAll(CJK)) {
    // raw = the exact text around the hit, used as the locator for sentence-level revision
    const raw = s.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    found.push({ chars: m[0], raw, context: raw.replace(/\s+/g, ' ') });
  }
  return found;
}

// Internal reference markers such as (clm1, clm2) or [clm3] must never reach the reader
const CLAIM_MARKER = /\s*[(\[]\s*clm\d+(?:\s*[,،、]\s*clm\d+)*\s*[)\]]/gi;

export function stripClaimMarkers(text) {
  return String(text || '').replace(CLAIM_MARKER, '');
}

// ─── Duplicate paragraphs (checked in code, not by AI) ───────────────────────
// Seen in practice: in a lengthening pass the AI copied an earlier paragraph word for word

function wordSet(text) {
  const set = new Set();
  for (const s of segmenter.segment(stripClaimMarkers(stripMarkdown(text)).toLowerCase())) {
    if (s.isWordLike) set.add(s.segment);
  }
  return set;
}

// Word overlap (Jaccard), 0–1
export function similarity(a, b) {
  const A = wordSet(a), B = wordSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export function paragraphs(write) {
  const out = [];
  for (const section of SECTIONS) {
    String(write?.[section] || '').split(/\n\s*\n/).map(p => p.trim()).filter(p => wordSet(p).size >= 12)
      .forEach(text => out.push({ section, text }));
  }
  return out;
}

// Pairs of paragraphs more alike than the threshold — returns the later one (the one to delete)
export function findDuplicateParagraphs(write, threshold = 0.8) {
  const paras = paragraphs(write);
  const dups = [];
  for (let j = 1; j < paras.length; j++) {
    for (let i = 0; i < j; i++) {
      const score = similarity(paras[i].text, paras[j].text);
      if (score >= threshold) {
        dups.push({ first: paras[i], duplicate: paras[j], score: Math.round(score * 100) / 100 });
        break;
      }
    }
  }
  return dups;
}

// ─── Checking "misattributed" accusations against the real source text ───────
// Seen in practice: the AI reviewer compared against a translation of a claim instead of the source,
// and reported a misattribution although the source says exactly that.
// If every proper name in the sentence (person, company, outlet) appears near each other in one
// source text, the source supports the sentence.

const NOT_NAMES = new Set(['AI', 'API', 'App', 'Store', 'The', 'A', 'An', 'Of', 'In', 'CEO', 'US']);

export function properNames(sentence) {
  const names = String(sentence || '').match(/[A-Z][A-Za-z0-9.&'’-]+(?:\s+[A-Z][A-Za-z0-9.&'’-]+)*/g) || [];
  return [...new Set(names.map(n => n.trim()).filter(n => n.length > 2 && !NOT_NAMES.has(n)))];
}

export function namesTogetherInSource(sentence, sourceTexts, window = 400) {
  const names = properNames(sentence);
  if (names.length < 2) return false; // too few names to confirm anything — do not lift the block
  for (const text of sourceTexts) {
    const lower = String(text).toLowerCase();
    const first = names[0].toLowerCase();
    let at = lower.indexOf(first);
    while (at >= 0) {
      const slice = lower.slice(Math.max(0, at - window), at + window);
      if (names.every(n => slice.includes(n.toLowerCase()))) return true;
      at = lower.indexOf(first, at + 1);
    }
  }
  return false;
}

// ─── Hook that opens with a hypothetical scene ───────────────────────────────
// Seen in practice (OBA-67b67cd6): "Have you ever felt that family life...? In the morning you wake the kids..." —
// it assumes the reader's life without evidence.
// Only the first sentence of the opening slot is checked. The patterns live in src/language.mjs.

// The exact text from the draft (sentence-level revision must be able to locate it).
// Thai has no full stop, so cut at ? ! . or after 300 characters.
export function firstSentence(text) {
  const para = String(text || '').trim().split(/\n/)[0].trim();
  const end = para.search(/[?？!.](\s|$)/);
  return (end >= 0 ? para.slice(0, end + 1) : para.slice(0, 300)).trim();
}

export function findHypotheticalOpening(write, language = DEFAULT_LANGUAGE) {
  const sentence = firstSentence(write?.hook);
  const bare = stripClaimMarkers(stripMarkdown(sentence)).replace(/^[\s"“'‘(]+/, '');
  const hit = languageProfile(language).hypotheticalOpenings.find(p => p.re.test(bare));
  return hit ? { sentence, label: hit.label } : null;
}

export function writeFields(write) {
  return ['title', 'deck', ...SECTIONS].map(k => write?.[k] || '');
}
