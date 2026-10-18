// ─── Blockdit Channel Output ─────────────────────────────────────────────────
// Per rules/BLOCKDIT_FORMAT.md and rules/Template/blockdit_article.md:
// - No real image files → no image links / credits in the body; kept as a separate image plan (image_plan.md) = "draft awaiting images"
// - Important claims link to the Sources list at the end by number
// - Headings may be adapted to the content (in the article's language)
// The fixed words the system itself adds to the published text (footer, source labels, plan labels)
// come from STRINGS below, per article language.

import { SECTIONS, similarity } from './checks.mjs';
import { DEFAULT_LANGUAGE, normalizeLanguage } from '../language.mjs';

const FALLBACK_HEADINGS = { hook: 'Hook', why: 'Why It Matters', step: 'Step-by-Step', actionable: 'Actionable Takeaway' };
const MARKER_GROUP = /\s*[(\[]\s*(clm\d+(?:\s*[,،、]\s*clm\d+)*)\s*[)\]]/gi;

export const STRINGS = {
  en: {
    transcript: 'Interview',
    transcriptLine: 'interview / original text supplied by the team (no link)',
    published: 'published',
    accessed: 'accessed',
    footer: date => `*The information in this article was checked against its sources as of ${date}*`,
    planTitle: 'Image plan',
    planStatus: 'Status: draft awaiting images — there are no real image files yet, so the version sent for review has no image links',
    planAdvice: 'When images are made: give the real credit. An AI image must say it is an AI image, and a mock-up is not an image proving an event.',
    planCount: 'The number of images follows the content; not every point is required',
    cover: 'Cover image (before the content)',
    after: h => `After the section "${h}"`,
    within: h => `Within the section "${h}"`,
    closing: 'Closing image (before Sources)'
  },
  th: {
    transcript: 'บทสัมภาษณ์',
    transcriptLine: 'บทสัมภาษณ์/ข้อความต้นฉบับที่ทีมงานให้ (ไม่มีลิงก์)',
    published: 'เผยแพร่',
    accessed: 'เข้าถึง',
    footer: date => `*ข้อมูลในบทความตรวจสอบกับแหล่งที่มา ณ วันที่ ${date}*`,
    planTitle: 'แผนภาพ',
    planStatus: 'สถานะ: ร่างรอภาพ — ยังไม่มีไฟล์ภาพจริง บทความฉบับส่งตรวจจึงไม่มีลิงก์ภาพ',
    planAdvice: 'เมื่อสร้างภาพแล้ว: ระบุเครดิตตามจริง ภาพ AI ต้องเขียนว่าเป็นภาพ AI และภาพจำลองไม่ใช่ภาพหลักฐานเหตุการณ์',
    planCount: 'จำนวนภาพปรับตามเนื้อหา ไม่บังคับครบทุกจุด',
    cover: 'ภาพปก (ก่อนเนื้อหา)',
    after: h => `หลังช่วง "${h}"`,
    within: h => `ในช่วง "${h}"`,
    closing: 'ภาพปิดเรื่อง (ก่อน Sources)'
  }
};
const strings = job => STRINGS[normalizeLanguage(job?.language)] || STRINGS[DEFAULT_LANGUAGE];

function shortDate(value) {
  const s = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Turn (clm1, clm2) → [1][2] in the order sources are first cited in the article.
// A claim that failed the check or does not exist → the marker is dropped (never point to a source that does not support it)
export function numberCitations(write, verifiedClaims, sources) {
  const claimSources = new Map(verifiedClaims.map(c => [c.id, (c.source_ids || []).filter(id => sources.some(s => s.id === id))]));
  const numberOf = new Map();
  const nextNumber = id => {
    if (!numberOf.has(id)) numberOf.set(id, numberOf.size + 1);
    return numberOf.get(id);
  };

  const out = {};
  for (const key of ['title', 'deck', ...SECTIONS]) {
    const text = String(write[key] || '');
    // Title / standfirst get no numbers, only the markers removed
    out[key] = key === 'title' || key === 'deck'
      ? text.replace(MARKER_GROUP, '')
      : text.replace(MARKER_GROUP, (_, group) => {
          const numbers = [...new Set(group.split(/\s*[,،、]\s*/).flatMap(id => (claimSources.get(id.toLowerCase()) || []).map(nextNumber)))];
          return numbers.length ? ' ' + numbers.sort((a, b) => a - b).map(n => `[${n}]`).join('') : '';
        });
  }

  // If nothing is cited at all, use every source that supports a verified fact
  if (numberOf.size === 0) {
    for (const c of verifiedClaims) for (const id of claimSources.get(c.id) || []) nextNumber(id);
  }
  const cited = [...numberOf.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id, n]) => ({ n, source: sources.find(s => s.id === id) }))
    .filter(x => x.source);

  return { text: out, cited };
}

// Drop paragraphs that are almost word for word the same (≥95%), keeping the first — the last guard against a repeated paragraph reaching the reader
export function dropDuplicateParagraphs(write) {
  const out = { ...write };
  const kept = [];
  const removed = [];
  for (const section of SECTIONS) {
    const paras = String(write[section] || '').split(/\n\s*\n/);
    out[section] = paras.filter(p => {
      const words = p.trim();
      if (!words) return false;
      if (kept.some(k => similarity(k, words) >= 0.95)) {
        removed.push({ section, text: words.slice(0, 80) });
        return false;
      }
      kept.push(words);
      return true;
    }).join('\n\n');
  }
  return { write: out, removed };
}

export function buildBlockdit(job, rawWrite, verifiedClaims, sources) {
  const t = strings(job);
  const { write, removed } = dropDuplicateParagraphs(rawWrite);
  const { text, cited } = numberCitations(write, verifiedClaims, sources);
  const headings = { ...FALLBACK_HEADINGS, ...(write.headings || {}) };
  const checkedOn = shortDate(sources.map(s => s.accessedAt).filter(Boolean).sort().at(-1) || new Date().toISOString());

  const sections = SECTIONS
    .filter(k => text[k].trim())
    .map(k => `## ${String(headings[k]).replace(/^#+\s*/, '').trim()}\n\n${text[k].trim()}`)
    .join('\n\n');

  const sourceLines = cited.map(({ n, source: s }) => {
    if (s.retrieval_method === 'user_transcript') return `${n}. ${s.title || t.transcript} — ${t.transcriptLine}`;
    const meta = [host(s.finalUrl || s.url), s.publishedDate && `${t.published} ${shortDate(s.publishedDate)}`, s.accessedAt && `${t.accessed} ${shortDate(s.accessedAt)}`]
      .filter(Boolean).join(' · ');
    return `${n}. [${s.title || 'Source'}](${s.finalUrl || s.url}) — ${meta}`;
  });

  const body = `${sections}

---

${t.footer(checkedOn)}

**Sources:**
${sourceLines.join('\n')}`;

  return { title: text.title || job.topic, deck: text.deck, body, cited, removedDuplicates: removed };
}

// Image plan: no image files yet → the article is a "draft awaiting images" and the image proposals are kept apart from the body
export function buildImagePlan(job, write, headings) {
  const t = strings(job);
  const h = { ...FALLBACK_HEADINGS, ...(headings || {}) };
  const rows = [
    [t.cover, write.coverImagePrompt],
    [t.after(h.hook), write.hookImagePrompt],
    [t.after(h.why), write.whyImagePrompt],
    [t.within(h.step), write.stepImagePrompt],
    [t.after(h.actionable), write.actionableImagePrompt],
    [t.closing, write.closingImagePrompt]
  ].filter(([, prompt]) => String(prompt || '').trim());

  return `# ${t.planTitle} — ${write.title || job.topic}

${t.planStatus}
${t.planAdvice}
${t.planCount}

${rows.map(([where, prompt], i) => `## ${i + 1}. ${where}\n${String(prompt).trim()}`).join('\n\n')}
`;
}
