// ─── Fact check after approval (code only — no AI call) ──────────────────────
// Compares the "numbers, proper names and quotes" in the version about to be posted with the text of the source each sentence cites ([n]).
// It can only certify that "the text matches the cited source" — not that the source itself is correct.
// Limits: numbers written as words in the article (three companies) are not checked · currencies are not checked (only the digits).

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jobDir } from './paths.mjs';
import { properNames, similarity } from './stages/checks.mjs';

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const MIN_QUOTE_CHARS = 8;
// Only sentences that cite a source, with a quote long enough to be the source's words, become "check yourself" —
// shorter ones are usually words the writer put in quote marks, so they only get a risk label.
const FLAG_QUOTE_CHARS = 20;
// Opinion markers: a sentence with these and no citation is the writer's view, not a fact to compare with a source.
// English and Thai markers are both recognised.
const OPINION = /(in the writer'?s (view|opinion)|the writer (thinks|believes|sees|feels)|one could say|it could be argued|ผู้เขียนมองว่า|ผู้เขียนเห็นว่า|ผู้เขียนคิดว่า|อาจกล่าวได้ว่า|ในมุมของ|ผู้เขียนเชื่อว่า)/i;
// Words that signal an allegation / a legal matter — high risk, so a person should always open the source
const ALLEGATION = /(alleg|lawsuit|sued|fine[sd]?|settle|fraud|illegal|violat|court|ruling|underage|juvenile|ถูกฟ้อง|ฟ้องร้อง|กล่าวหา|ละเมิด|ฉ้อโกง|ทุจริต|ผิดกฎหมาย|ค่าปรับ|ยอมจ่าย|ยุติคดี|ศาล|คำพิพากษา|ผู้เยาว์)/i;

function toAsciiDigits(text) {
  return String(text).replace(/[๐-๙]/g, d => String(THAI_DIGITS.indexOf(d)));
}

export function normalize(text) {
  return toAsciiDigits(text).normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

// All the numbers in a text (commas removed) — scaled=true is used for the source text: it adds the values divided by Thai / English units
// so that "100,000,000" in the source matches "100 million" in the article.
export function numberTokens(text, { scaled = false } = {}) {
  const out = new Set();
  if (scaled) for (const d of wordNumbers(text)) out.add(d);
  for (const m of toAsciiDigits(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,+$/, '').replace(/,/g, '').replace(/^0+(?=\d)/, '');
    if (!raw) continue;
    out.add(raw);
    if (scaled) for (const v of scaledValues(raw)) out.add(v);
  }
  return out;
}

// Numbers the source writes as words (three seconds) — used on the source text so "3 seconds" in the article can match
const EN_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const TH_WORDS = ['หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ'];
function wordNumbers(text) {
  const out = [];
  const lower = String(text).toLowerCase();
  EN_WORDS.forEach((w, i) => { if (new RegExp('\\b' + w + '\\b').test(lower)) out.push(String(i + 1)); });
  TH_WORDS.forEach((w, i) => { if (lower.includes(w)) out.push(String(i + 1)); });
  return out;
}

function scaledValues(raw) {
  const value = Number(raw);
  const out = [];
  if (Number.isFinite(value) && value >= 1000) {
    for (const div of [1e3, 1e4, 1e5, 1e6, 1e9]) {
      const v = value / div;
      if (v >= 1 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6) out.push(String(Math.round(v * 100) / 100));
    }
  }
  return out;
}

export function numberInSource(token, sourceTokens) {
  if (sourceTokens.has(token)) return true;
  // The article writes 100,000,000 but the source writes "100 million"
  if (scaledValues(token).some(v => sourceTokens.has(v))) return true;
  const n = Number(token);
  // Buddhist Era ↔ Common Era years (Thai sources and articles often use the Buddhist Era)
  if (Number.isInteger(n) && n >= 2500 && n <= 2700) return sourceTokens.has(String(n - 543));
  if (Number.isInteger(n) && n >= 1957 && n <= 2157) return sourceTokens.has(String(n + 543));
  return false;
}

// A unit of text = a span that ends with a [n] marker (as numberCitations makes them) · a tail with no [n] = no source cited
export function claimUnits(body) {
  const units = [];
  const main = String(body || '').split('**Sources:**')[0];
  for (const para of main.split(/\n\s*\n/)) {
    const text = para.trim();
    if (!text || /^#{1,6}\s/.test(text) || /^---$/.test(text) || /^\*[^*]/.test(text)) continue;
    let last = 0;
    for (const m of text.matchAll(/(?:\[\d+\])+/g)) {
      const end = m.index + m[0].length;
      const sentence = text.slice(last, end).trim();
      const cited = [...m[0].matchAll(/\[(\d+)\]/g)].map(x => Number(x[1]));
      if (sentence) units.push({ sentence, cited });
      last = end;
    }
    const rest = text.slice(last).trim();
    if (rest) units.push({ sentence: rest, cited: [] });
  }
  return units;
}

function quotedStrings(sentence) {
  const out = [];
  for (const m of sentence.matchAll(/[“"「]([^”"」]{2,300})[”"」]/g)) {
    if (m[1].trim().length >= MIN_QUOTE_CHARS) out.push(m[1].trim());
  }
  return out;
}

function stripMarkers(sentence) {
  return sentence.replace(/\[\d+\]/g, '');
}

// sources: [{ n, id, title, url, primary_source, text }] numbered as the [n] markers in the article
export function auditText(body, sources, claims = []) {
  const byN = new Map(sources.map(s => [s.n, { ...s, norm: normalize(s.text), tokens: numberTokens(s.text, { scaled: true }) }]));
  const all = [...byN.values()];
  const flags = [];
  const rows = [];
  let id = 0;

  for (const unit of claimUnits(body)) {
    const clean = stripMarkers(unit.sentence);
    const cited = unit.cited.map(n => byN.get(n)).filter(Boolean);
    const pool = cited.length ? cited : all;
    const poolNorm = pool.map(s => s.norm);
    const risks = new Set();
    const note = (kind, token, reason) => flags.push({ id: ++id, kind, token, sentence: clean, cited: unit.cited, reason });

    const missingCite = unit.cited.filter(n => !byN.has(n));
    if (missingCite.length) note('citation', missingCite.map(n => `[${n}]`).join(''), 'This reference number is not in the list of sources');
    if (!unit.cited.length && /\d|[A-Z][a-z]{2,}/.test(clean)) risks.add('uncited');

    // Numbers
    for (const n of numberTokens(clean)) {
      risks.add('number');
      if (!pool.some(s => numberInSource(n, s.tokens))) {
        note('number', n, cited.length ? 'This number was not found in the source this sentence cites' : 'This sentence has no reference number, and the number was not found in any source');
      }
    }
    // Proper names (Latin script)
    for (const name of properNames(clean)) {
      risks.add('name');
      if (!poolNorm.some(t => t.includes(normalize(name)))) {
        note('name', name, cited.length ? 'This name was not found in the source this sentence cites' : 'This sentence has no reference number, and the name was not found in any source');
      }
    }
    // Words inside quotation marks
    for (const q of quotedStrings(clean)) {
      if (q.length < FLAG_QUOTE_CHARS) continue; // short words in quote marks are usually emphasis by the writer, not the source's words
      risks.add('quote');
      if (cited.length && !poolNorm.some(t => t.includes(normalize(q)))) {
        note('quote', q, 'This quote cannot be matched to the original directly (translated or reworded) — open the source and compare the meaning');
      }
    }
    if (ALLEGATION.test(clean)) risks.add('allegation');
    // The writer's own opinion / interpretation with no citation is not a fact to compare with a source — it does not enter the risk list
    // (numbers / names found in no source at all are still flagged as usual)
    if (!unit.cited.length && OPINION.test(clean)) risks.clear();

    if (cited.length) {
      const sourceIds = new Set(cited.map(s => s.id));
      const best = claims
        .filter(c => c.status === 'verified' && (c.source_ids || []).some(sid => sourceIds.has(sid)))
        .map(c => ({ c, score: similarity(c.claim || '', clean) }))
        .sort((a, b) => b.score - a.score)[0];
      const quote = best && best.score > 0 ? (best.c.quotes || []).find(q => sourceIds.has(q.source_id)) : null;
      rows.push({
        sentence: clean,
        cited: unit.cited,
        risks: [...risks],
        singleSource: new Set(cited.map(s => s.id)).size === 1,
        primary: cited.some(s => s.primary_source),
        evidence: quote ? quote.text : '',
        flagged: false
      });
    } else if (risks.size) {
      rows.push({ sentence: clean, cited: [], risks: [...risks], singleSource: false, primary: false, evidence: '', flagged: false });
    }
  }

  // Mark the rows that have a "check yourself" item
  for (const f of flags) {
    const row = rows.find(r => r.sentence === f.sentence);
    if (row) row.flagged = true;
  }
  const weight = r => (r.flagged ? 100 : 0) + (r.risks.includes('allegation') ? 10 : 0) + (r.risks.includes('quote') ? 6 : 0)
    + (r.risks.includes('number') ? 4 : 0) + (r.risks.includes('name') ? 2 : 0) + (r.singleSource ? 1 : 0);
  rows.sort((a, b) => weight(b) - weight(a));

  return { flags, rows, summary: { units: rows.length, flagged: flags.length } };
}

const RISK_LABEL = { number: 'number', name: 'name', quote: 'quote', allegation: 'allegation / legal', uncited: 'no reference number' };

export function secondSourceText(s) {
  if (s.status === 'confirmed') return `Confirmed by a second source — ${s.title || ''} ${s.url}`.trim();
  if (s.status === 'not_found') return `Still a single source (searched and opened ${s.tried || 0} page(s); found no independent page confirming the same number / name — this does not mean it is wrong)`;
  if (s.status === 'skipped') return `Skipped — ${s.reason}`;
  return `Check failed — ${s.reason || ''}`;
}

export function renderFactCheck(job, report, sources, { edited = false, deepNotes = [] } = {}) {
  const lines = [];
  lines.push(`# Fact-check table — ${job.topic}`);
  lines.push('');
  lines.push(`Checked at ${new Date().toISOString()} · Version checked: ${edited ? 'text the owner pasted' : 'the approved blockdit.md file'}`);
  lines.push('The system compares the text with the cited sources in code, with no AI — it certifies only that the text matches the source, not that the source is correct · numbers written as words and currencies are not checked');
  lines.push('');
  lines.push('## Sources');
  for (const s of sources) lines.push(`- [${s.n}] ${s.title || '(untitled)'}${s.url ? ` — ${s.url}` : ' — (interview supplied by the team)'}${s.primary_source ? ' · primary source' : ''}`);
  lines.push('');
  lines.push(`## Check yourself (${report.flags.length} item(s))`);
  if (!report.flags.length) lines.push('No items that were not found in the sources');
  for (const f of report.flags) {
    lines.push(`- **${RISK_LABEL[f.kind] || f.kind}** "${f.token}" — ${f.reason}`);
    lines.push(`  Sentence: ${f.sentence}${f.cited.length ? ` [${f.cited.join('][')}]` : ''}`);
  }
  lines.push('');
  lines.push('## High-risk items (open these first)');
  const risky = report.rows.filter(r => r.risks.length);
  if (!risky.length) lines.push('None');
  for (const r of risky) {
    const tags = r.risks.map(k => RISK_LABEL[k] || k);
    if (r.singleSource) tags.push('single source');
    if (r.primary) tags.push('has a primary source');
    lines.push(`- ${r.flagged ? '⚠ ' : ''}[${tags.join(', ')}] ${r.sentence}${r.cited.length ? ` [${r.cited.join('][')}]` : ''}`);
    if (r.evidence) lines.push(`  Supporting quote from the source: "${r.evidence}"`);
    if (r.secondSource) lines.push(`  Second source: ${secondSourceText(r.secondSource)}`);
    for (const f of r.factChecks || []) lines.push(`  Fact Check Tools result: ${f.publisher} rated it "${f.rating}" — ${f.title || f.claim} — ${f.url}`);
  }
  if (deepNotes.length) {
    lines.push('', '## Notes on the deep check');
    for (const n of deepNotes) lines.push(`- ${n}`);
  }
  lines.push('');
  return lines.join('\n');
}

// Read the source texts numbered as [n] in the review version
export async function loadAuditSources(job) {
  const ids = job.stages.channels?.result?.blockdit?.sources || [];
  const all = job.stages.research?.result?.sources || [];
  const out = [];
  for (const [i, sid] of ids.entries()) {
    const s = all.find(x => x.id === sid);
    if (!s) continue;
    let text = '';
    try { text = await readFile(join(jobDir(job.id), s.textFile), 'utf-8'); } catch { text = s.excerpt || ''; }
    out.push({ n: i + 1, id: s.id, title: s.title, url: s.finalUrl || s.url || '', primary_source: !!s.primary_source, text });
  }
  return out;
}

export async function runFactAudit(job, text, { edited = false } = {}) {
  const sources = await loadAuditSources(job);
  const claims = job.stages.evidence?.result?.claims || [];
  const report = auditText(text, sources, claims);
  const markdown = renderFactCheck(job, report, sources, { edited });
  await writeFile(join(jobDir(job.id), 'fact_check.md'), markdown, 'utf-8');
  return { ...report, edited, file: 'fact_check.md', sources: sources.map(({ text: _t, ...s }) => s) };
}
