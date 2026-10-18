// ─── Deep check (the user clicks it; a small search cost) ────────────────────
// 1) High-risk facts that have a single source → search for a second independent source and really open it to see whether it states the same number / name
// 2) Allegations / quotes → look up results in the Google Fact Check Tools (no result ≠ correct)
// No AI call · the number of rows per run is capped to control cost

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jobDir } from './paths.mjs';
import { runFactAudit, renderFactCheck, numberTokens, numberInSource, normalize } from './factAudit.mjs';
import { properNames } from './stages/checks.mjs';
import { searchTavily, searchSerper } from './adapters/webSearch.mjs';
import { fetchPage } from './adapters/webFetch.mjs';
import { searchFactChecks, relevantFactChecks } from './adapters/factCheck.mjs';
import { isSkippedDomain } from './stages/research.mjs';

const MAX_SECOND_SOURCE_ROWS = 3;
const MAX_FACTCHECK_ROWS = 4;
const MAX_FETCH_PER_ROW = 4;

function host(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

const LATIN = /[A-Za-z]/g;
function mostlyLatin(text) {
  const letters = String(text).replace(/[\s\d\W]/g, '');
  return letters.length > 0 && (String(text).match(LATIN) || []).length / letters.length > 0.6;
}

// Search query from a row: use the supporting quote from the source (original language) if there is one,
// otherwise the proper names + the numbers of the sentence
export function buildQuery(row) {
  if (row.evidence && mostlyLatin(row.evidence)) return row.evidence.slice(0, 160);
  const names = properNames(row.sentence);
  const nums = [...numberTokens(row.sentence)].filter(n => n.length >= 2);
  return [...names, ...nums].join(' ').slice(0, 160);
}

// Does this page confirm the sentence: every number and proper name in the sentence must be on that page, and there must be at least 2 facts
export function confirmsSentence(sentence, pageText) {
  const nums = [...numberTokens(sentence)];
  const names = properNames(sentence);
  if (nums.length + names.length < 2) return false;
  const tokens = numberTokens(pageText, { scaled: true });
  const norm = normalize(pageText);
  return nums.every(n => numberInSource(n, tokens)) && names.every(n => norm.includes(normalize(n)));
}

async function findSecondSource(row, citedHosts, keys) {
  const query = buildQuery(row);
  if (!query) return { status: 'skipped', reason: 'could not build a query (the sentence has too few names or numbers)' };
  const found = [];
  const [t, s] = await Promise.allSettled([
    keys.tavily ? searchTavily(query, keys.tavily, { maxResults: 5 }) : Promise.resolve([]),
    keys.serper ? searchSerper(query, keys.serper, { maxResults: 5 }) : Promise.resolve([])
  ]);
  for (const r of [t, s]) if (r.status === 'fulfilled') found.push(...r.value);
  const seen = new Set();
  const candidates = found.filter(c => {
    const h = host(c.url);
    if (!h || citedHosts.has(h) || seen.has(h) || isSkippedDomain(c.url)) return false;
    seen.add(h);
    return true;
  }).slice(0, MAX_FETCH_PER_ROW);
  for (const c of candidates) {
    const page = await fetchPage(c.url);
    if (page.ok && confirmsSentence(row.sentence, page.text)) {
      return { status: 'confirmed', url: page.finalUrl || c.url, title: page.title || c.title, query };
    }
  }
  return { status: 'not_found', tried: candidates.length, query };
}

export async function runDeepFactAudit(job, text, { edited = false } = {}) {
  const report = await runFactAudit(job, text, { edited });
  const keys = { tavily: process.env.TAVILY_API_KEY || '', serper: process.env.SERPER_API_KEY || '' };
  const fcKey = process.env.GOOGLE_FACTCHECK_API_KEY || '';
  const notes = [];

  // Layer 3: a second source
  if (!keys.tavily && !keys.serper) {
    notes.push('Skipped the second-source search: neither TAVILY_API_KEY nor SERPER_API_KEY is set');
  } else {
    const targets = report.rows.filter(r => r.singleSource && (r.risks.includes('allegation') || r.risks.includes('number'))).slice(0, MAX_SECOND_SOURCE_ROWS);
    for (const row of targets) {
      const citedHosts = new Set(row.cited.map(n => host((report.sources.find(s => s.n === n) || {}).url)).filter(Boolean));
      try { row.secondSource = await findSecondSource(row, citedHosts, keys); }
      catch (e) { row.secondSource = { status: 'error', reason: e.message }; }
    }
  }

  // Google Fact Check Tools
  if (!fcKey) {
    notes.push('Skipped Fact Check Tools: GOOGLE_FACTCHECK_API_KEY is not set');
  } else {
    const targets = report.rows.filter(r => r.risks.includes('allegation') || r.risks.includes('quote')).slice(0, MAX_FACTCHECK_ROWS);
    for (const row of targets) {
      const query = buildQuery(row);
      if (!query) continue;
      try { row.factChecks = relevantFactChecks(query, await searchFactChecks(query, fcKey, { pageSize: 5 })); }
      catch (e) { row.factChecks = []; notes.push(`Fact Check Tools error: ${e.message}`); }
    }
  }

  const markdown = renderFactCheck(job, report, report.sources, { edited, deepNotes: notes });
  await writeFile(join(jobDir(job.id), 'fact_check.md'), markdown, 'utf-8');
  return { ...report, deep: true, notes };
}
