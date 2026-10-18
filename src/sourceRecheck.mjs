// ─── Re-check the sources after publication (the user clicks it) ──────────────
// Opens the article's source links again and compares them with the copy kept at writing time:
// can't be opened / a quote that confirmed a fact is gone / the content changed a lot → warn the owner to consider a correction.
// Web pages change their ads and other parts on their own, so "the confirming quote is gone" is the main signal
// and "the content changed" is only an observation.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jobDir } from './paths.mjs';
import { fetchPage } from './adapters/webFetch.mjs';
import { quoteFound, normalizeForMatch } from './stages/research.mjs';
import { similarity } from './stages/checks.mjs';

const CHANGED_BELOW = 0.6;

export function classifyRecheck({ ok, error = '', oldText = '', newText = '', quotes = [] }) {
  if (!ok) return { status: 'unreachable', detail: error || 'could not be opened' };
  const norm = normalizeForMatch(newText);
  const missing = quotes.filter(q => !quoteFound(q, norm));
  const sim = Math.round(similarity(oldText, newText) * 100) / 100;
  if (missing.length) return { status: 'quote_missing', detail: `${missing.length} of ${quotes.length} confirming quote(s) are gone`, missing: missing.slice(0, 3), similarity: sim };
  if (sim < CHANGED_BELOW) return { status: 'changed', detail: `The page content changed a lot (${Math.round(sim * 100)}% like before) but the quotes that were used are still there`, similarity: sim };
  return { status: 'same', detail: 'All the confirming quotes are still there', similarity: sim };
}

export async function recheckSources(job) {
  const ids = job.stages.channels?.result?.blockdit?.sources || [];
  const all = job.stages.research?.result?.sources || [];
  const claims = (job.stages.evidence?.result?.claims || []).filter(c => c.status === 'verified');
  const results = [];
  for (const [i, id] of ids.entries()) {
    const s = all.find(x => x.id === id);
    if (!s) continue;
    if (!s.url) { results.push({ n: i + 1, id, title: s.title, url: '', status: 'skipped', detail: 'An interview supplied by the team — there is no link to check' }); continue; }
    let oldText = '';
    try { oldText = await readFile(join(jobDir(job.id), s.textFile), 'utf-8'); } catch { oldText = s.excerpt || ''; }
    const quotes = claims.flatMap(c => (c.quotes || []).filter(q => q.source_id === id).map(q => q.text));
    const page = await fetchPage(s.finalUrl || s.url);
    results.push({ n: i + 1, id, title: s.title, url: s.finalUrl || s.url, ...classifyRecheck({ ok: page.ok, error: page.error, oldText, newText: page.text || '', quotes }) });
  }
  const entry = { checkedAt: new Date().toISOString(), results };
  job.sourceRechecks = [...(job.sourceRechecks || []), entry].slice(-10);
  return entry;
}
