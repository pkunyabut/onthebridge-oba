// ─── Language Profiles ───────────────────────────────────────────────────────
// Everything that depends on the language the ARTICLE is written in lives here:
// target length, per-section length targets, and the patterns the code uses to
// recognise hypothetical openings and self-cleared reviewer remarks.
//
// The prompts themselves are written in English and tell the model which language to write in.
// Add a language by adding a profile below (English and Thai are the two that have been exercised).
//
// Word counting needs no profile: Intl.Segmenter splits Latin text on spaces and Thai text with
// its dictionary whatever locale is passed, so one segmenter serves both (see checks.mjs).

export const DEFAULT_LANGUAGE = 'en';

const READER_VERBS_EN = 'just|have|had|were|are|ve|re|ll|d|might|may|must|wake|sit|walk|stand|open|pick|hold|look|press|type|received|get|got|feel|felt|try|tried|need|want|know|ever|probably|never|always';

export const LANGUAGES = {
  en: {
    code: 'en',
    name: 'English',
    wordRange: { min: 1200, max: 1800 },
    // [min, max] words for each of the four slots; the minimums add up to the lower end of wordRange
    sectionTargets: { hook: [280, 360], why: [280, 360], step: [440, 600], actionable: [200, 280] },
    // First sentence of the hook must not invent a scene or assume the reader
    hypotheticalOpenings: [
      { re: /^(just\s+)?(imagine|picture|suppose|pretend|close your eyes)\b/i, label: 'an invitation to imagine' },
      { re: /^(let'?s\s+)?(say|assume)\b/i, label: 'a hypothetical situation' },
      { re: /^(what\s+if|if|when|once|as|while|the moment)\s+you\b/i, label: 'an assumption about the reader' },
      { re: new RegExp(`^you(?:['’]|\\s+)(?:${READER_VERBS_EN})\\b`, 'i'), label: 'an assumption about the reader' },
      { re: /^(have|did|do|ever)\s+you\b/i, label: 'an assumption about the reader' }
    ],
    // Reviewer remarks that clear the sentence they were attached to
    selfCleared: /no (real )?(problem|issue)|not (a|an) (problem|issue)|is correct|is accurate|this is fine|no action (is )?needed/i,
    // Hidden misattribution inside another kind of issue
    misattribution: /misattribut|wrongly (attributed|credited)|attributed to the wrong|not (said|stated) by|did not say|incorrectly (states|says|attributes)/i
  },
  th: {
    code: 'th',
    name: 'Thai',
    wordRange: { min: 1500, max: 2200 },
    sectionTargets: { hook: [350, 450], why: [350, 450], step: [550, 750], actionable: [250, 350] },
    hypotheticalOpenings: [
      { re: /^(ลอง)?(จินตนาการ|นึกภาพ|นึกดู|หลับตา)/, label: 'an invitation to imagine' },
      { re: /^สม(มติ|มุติ)/, label: 'a hypothetical situation' },
      { re: /^(ถ้า|หาก|สมมติว่า|ทันทีที่|ขณะที่|ตอนที่|เมื่อ)\s*คุณ/, label: 'an assumption about the reader' },
      { re: /^คุณ\s*(เพิ่ง|เคย|กำลัง|อาจจะ|อาจ|คง|ตื่น|นั่ง|เดิน|ยืน|นอน|เปิด|หยิบ|ถือ|มอง|กด|พิมพ์|ได้รับ|รู้สึก|ลอง|ต้อง)/, label: 'an assumption about the reader' }
    ],
    selfCleared: /ไม่มีปัญหา|ไม่นับเป็นปัญหา|ไม่ถือเป็นปัญหา|ไม่ใช่ปัญหา|ถูกต้องแล้ว/,
    misattribution: /ระบุผิดว่า|อ้างผิด|ผิดคน|ไม่ใช่คำกล่าวของ|ไม่ได้ระบุว่า.{0,20}(โฆษก|เป็นผู้กล่าว|พูด)|misattribut/i
  }
};

export function languageProfile(code) {
  return LANGUAGES[code] || LANGUAGES[DEFAULT_LANGUAGE];
}

export function normalizeLanguage(code) {
  const c = String(code || '').trim().toLowerCase();
  return LANGUAGES[c] ? c : DEFAULT_LANGUAGE;
}
