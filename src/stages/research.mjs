// ─── Research: real search, real page fetches, quotes checked against the real source ───
// Central rule: "Verified" is used only after the source was opened and its text weighed.
// If it cannot be opened it becomes "Needs verification" and is kept out of the article — never made up to look finished.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jobDir } from '../paths.mjs';
import { searchTavily, searchSerper, searchBrave, searchSerperNews, searchWikipedia, searchDuckDuckGo } from '../adapters/webSearch.mjs';
import { fetchPage, tavilyExtract } from '../adapters/webFetch.mjs';

// Ceilings per article, to control cost and time
const MAX_QUERIES = 4;
const RESULTS_PER_PROVIDER = 5;
const MAX_SOURCES = 8;          // most readable sources used
const MAX_FETCH_ATTEMPTS = 16;  // most URLs tried
const MIN_CANDIDATES = 6;       // fewer links than this → add the free sources
const FETCH_CONCURRENCY = 4;
const EXCERPT_CHARS = 6000;     // text per source sent to the evidence stage

// Social and video pages cannot be read as text (login / scripts) and are not primary evidence.
// They are skipped so they do not eat the fetch quota — unless the user supplied the link.
const SKIP_DOMAINS = [
  'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com', 'youtu.be',
  'reddit.com', 'linkedin.com', 'threads.net', 'threads.com', 'pinterest.com', 'lemon8-app.com'
];

export function isSkippedDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SKIP_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch {
    return true;
  }
}

function searchKeys(job) {
  return {
    tavily: process.env.TAVILY_API_KEY || '',
    serper: job.searchKey || process.env.SERPER_API_KEY || '',
    brave: process.env.BRAVE_API_KEY || ''
  };
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$)/i.test(p)) u.searchParams.delete(p);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function pickQueries(job) {
  const fromBrief = job.stages.brief?.result?.searchQueries;
  const list = Array.isArray(fromBrief) && fromBrief.length ? fromBrief : [job.topic];
  return [...new Set(list.map(q => String(q).trim()).filter(Boolean))].slice(0, MAX_QUERIES);
}

// Queries aimed at the primary source (agency documents, statements, court rulings) — proposed by the brief; at most MAX_PRIMARY_QUERIES are added
const MAX_PRIMARY_QUERIES = 1;
export function pickPrimaryQueries(job, general = []) {
  const list = job.stages.brief?.result?.primarySourceQueries;
  const have = new Set(general.map(q => q.toLowerCase()));
  return (Array.isArray(list) ? list : []).map(q => String(q).trim())
    .filter(q => q && !have.has(q.toLowerCase())).slice(0, MAX_PRIMARY_QUERIES);
}

// The news search is used only for the news_analysis format (the first 1–2 queries) to control cost
const NEWS_QUERIES = 2;
export function wantsNewsSearch(job) {
  return (job.stages.brief?.result?.template || job.template) === 'news_analysis';
}

// Primary source = a government / court / university site, or the subject's own press page — ranked ahead of re-written articles.
// The Thai entries (.go.th, .ac.th and the Thai press-release path words) are examples; add your own country's domains and words.
const PRIMARY_HOST = /(^|\.)(gov|edu|mil|int)(\.[a-z]{2})?$|(^|\.)(go|ac)\.th$|(^|\.)(europa\.eu|un\.org|sec\.gov|courtlistener\.com|supremecourt\.gov|justice\.gov)$/i;
const PRIMARY_PATH = /\/(press[-_ ]?releases?|newsroom|media[-_ ]?center|investor[-_ ]?relations|ir|announcements?|statements?|filings?|opinions?|ข่าวประชาสัมพันธ์|แถลงข่าว)(\/|$|\?)/i;
export function isPrimarySource(url) {
  try {
    const u = new URL(url);
    return PRIMARY_HOST.test(u.hostname) || PRIMARY_PATH.test(u.pathname + '/');
  } catch { return false; }
}

async function runLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ─── 1. Collect links ────────────────────────────────────────────────────────

async function collectCandidates(job, queries, keys, log) {
  const byUrl = new Map();
  let order = 0;
  const add = (item, query) => {
    if (!/^https?:\/\//i.test(item.url || '')) return;
    if (item.provider !== 'user_provided' && isSkippedDomain(item.url)) return;
    const key = normalizeUrl(item.url);
    const existing = byUrl.get(key);
    if (existing) {
      if (!existing.providers.includes(item.provider)) existing.providers.push(item.provider);
      existing.hits++;
      return;
    }
    byUrl.set(key, { ...item, providers: [item.provider], hits: 1, query, order: order++ });
  };

  // Links the user supplied always come first
  for (const e of job.external || []) {
    add({ url: e.url, title: e.note || '', snippet: e.note || '', provider: 'user_provided' }, '');
  }

  const record = (provider, query, settled) => {
    if (settled.status === 'fulfilled') {
      log.push({ provider, query, results: settled.value.length });
      settled.value.forEach(r => add(r, query));
    } else {
      log.push({ provider, query, error: settled.reason?.message || String(settled.reason) });
    }
  };

  const primaryQueries = pickPrimaryQueries(job, queries);
  for (const q of [...queries, ...primaryQueries]) {
    const [t, s, b] = await Promise.allSettled([
      keys.tavily ? searchTavily(q, keys.tavily, { maxResults: RESULTS_PER_PROVIDER }) : Promise.resolve(null),
      keys.serper ? searchSerper(q, keys.serper, { maxResults: RESULTS_PER_PROVIDER }) : Promise.resolve(null),
      keys.brave ? searchBrave(q, keys.brave, { maxResults: RESULTS_PER_PROVIDER }) : Promise.resolve(null)
    ]);
    if (keys.tavily) record('tavily', q, t);
    if (keys.serper) record('serper', q, s);
    if (keys.brave) record('brave', q, b);
  }

  if (keys.serper && wantsNewsSearch(job)) {
    for (const q of queries.slice(0, NEWS_QUERIES)) {
      const [n] = await Promise.allSettled([searchSerperNews(q, keys.serper, { maxResults: RESULTS_PER_PROVIDER })]);
      record('serper_news', q, n);
    }
  }

  // Free sources supplement when there are not enough links (or no key at all)
  if (byUrl.size < MIN_CANDIDATES) {
    for (const q of queries) {
      const [w, d] = await Promise.allSettled([searchWikipedia(q), searchDuckDuckGo(q, { maxResults: RESULTS_PER_PROVIDER })]);
      record('wikipedia', q, w);
      record('duckduckgo', q, d);
      if (byUrl.size >= MIN_CANDIDATES * 2) break;
    }
  }

  // User-supplied first → found by several providers / queries → order found
  return [...byUrl.values()].sort((a, b) =>
    (b.provider === 'user_provided') - (a.provider === 'user_provided')
    // A primary source counts as half a relevance point (found by several providers); it does not outrank a page several searches agree on
    || (b.hits + (isPrimarySource(b.url) ? 0.5 : 0)) - (a.hits + (isPrimarySource(a.url) ? 0.5 : 0))
    || a.order - b.order
  );
}

// ─── 2. Open the real pages ──────────────────────────────────────────────────

// Terms the brief says must appear on a page about the main event / issue of the topic (an event name, a person or
// a specific organisation — never a generic word).
// Seen in practice in OBA-69572ffc: a domestic-trade-department news item about the Middle East got in as a source for
// a flood article, because it was a .go.th page and ranked first.
export function pickRelevanceTerms(job) {
  const t = job.stages?.brief?.result?.relevanceTerms;
  return (Array.isArray(t) ? t : []).map(x => String(x).trim()).filter(x => x.length >= 2).slice(0, 5);
}

export function isRelevantText(text, terms) {
  if (!terms.length) return true;
  const hay = normalizeForMatch(text);
  return terms.some(t => hay.includes(normalizeForMatch(t)));
}

async function fetchCandidates(candidates, keys, usage, terms = []) {
  const fetched = [];
  const failed = [];
  const offTopic = [];
  const queue = candidates.slice(0, MAX_FETCH_ATTEMPTS);

  for (let i = 0; i < queue.length && fetched.length < MAX_SOURCES; i += FETCH_CONCURRENCY) {
    const batch = queue.slice(i, i + FETCH_CONCURRENCY);
    const pages = await runLimited(batch, FETCH_CONCURRENCY, c => fetchPage(c.url));
    batch.forEach((c, j) => {
      const entry = { candidate: c, page: pages[j] };
      if (!pages[j].ok) failed.push(entry);
      // Links the user supplied are never screened out
      else if (c.provider !== 'user_provided' && !isRelevantText(pages[j].text, terms)) offTopic.push(entry);
      else fetched.push(entry);
    });
  }

  // Pages that could not be opened directly (bot blocking / scripts) get one more try through Tavily Extract
  const retry = failed.filter(f => f.page.status !== 404 && f.page.status !== 410).slice(0, 5);
  if (keys.tavily && retry.length && fetched.length < MAX_SOURCES) {
    try {
      const extracted = await tavilyExtract(retry.map(f => f.candidate.url), keys.tavily);
      usage.tavilyExtractUrls += extracted.length;
      for (const page of extracted) {
        const idx = failed.findIndex(f => normalizeUrl(f.candidate.url) === normalizeUrl(page.url));
        if (idx >= 0 && fetched.length < MAX_SOURCES) {
          const entry = { candidate: failed[idx].candidate, page };
          failed.splice(idx, 1);
          (isRelevantText(page.text, terms) ? fetched : offTopic).push(entry);
        }
      }
    } catch (err) {
      console.error('[research] Tavily extract failed:', err.message);
    }
  }

  // Guard against a filter so strict that no source is left (e.g. the brief picked terms that are too specific):
  // with fewer than 2 sources, put the screened-out pages back
  let relaxed = false;
  if (fetched.length < 2 && offTopic.length) {
    fetched.push(...offTopic.splice(0, MAX_SOURCES - fetched.length));
    relaxed = true;
  }

  return { fetched: fetched.slice(0, MAX_SOURCES), failed, offTopic, relaxed };
}

// ─── Stage: research ─────────────────────────────────────────────────────────

// Interviews / original texts the owner pastes in — an evidence source that needs no web fetch.
// The code checks quotes against this text just like a web page (a wrong transcription lets a wrong quote through,
// so the owner must proofread before pasting).
export const TRANSCRIPT_EXCERPT_CHARS = 20000;
export const MAX_TRANSCRIPTS = 5;
export const MAX_TRANSCRIPT_CHARS = 200000;

export function cleanTranscripts(input) {
  return (Array.isArray(input) ? input : [])
    .map(t => ({ label: String(t?.label || '').trim().slice(0, 100), text: String(t?.text || '').trim() }))
    .filter(t => t.text.length >= 50)
    .slice(0, MAX_TRANSCRIPTS)
    .map((t, i) => ({ label: t.label || `Interview ${i + 1}`, text: t.text.slice(0, MAX_TRANSCRIPT_CHARS) }));
}

export function transcriptSource(t, index, accessedAt) {
  return {
    id: `src${index + 1}`,
    url: '',
    finalUrl: '',
    title: t.label,
    publishedDate: '',
    accessedAt,
    retrieval_method: 'user_transcript',
    query: '',
    fetch_status: 'fetched',
    fetched_via: 'user_transcript',
    textFile: `sources/src${index + 1}.txt`,
    textLength: t.text.length,
    excerpt: t.text.slice(0, TRANSCRIPT_EXCERPT_CHARS)
  };
}

export async function gatherSources(job) {
  const keys = searchKeys(job);
  const queries = pickQueries(job);
  const searchLog = [];

  const candidates = await collectCandidates(job, queries, keys, searchLog);
  const usage = {
    tavilySearches: searchLog.filter(l => l.provider === 'tavily').length,
    serperQueries: searchLog.filter(l => l.provider === 'serper' || l.provider === 'serper_news').length,
    braveQueries: searchLog.filter(l => l.provider === 'brave').length,
    tavilyExtractUrls: 0
  };
  const relevanceTerms = pickRelevanceTerms(job);
  const { fetched, failed, offTopic, relaxed } = await fetchCandidates(candidates, keys, usage, relevanceTerms);

  const dir = join(jobDir(job.id), 'sources');
  await mkdir(dir, { recursive: true });

  const sources = [];
  const transcripts = cleanTranscripts(job.transcripts);
  for (const [i, t] of transcripts.entries()) {
    const src = transcriptSource(t, i, new Date().toISOString());
    await writeFile(join(jobDir(job.id), src.textFile), t.text, 'utf-8');
    sources.push(src);
  }
  for (const [n, { candidate, page }] of fetched.entries()) {
    const i = transcripts.length + n;
    const id = `src${i + 1}`;
    const textFile = `sources/${id}.txt`;
    await writeFile(join(jobDir(job.id), textFile), page.text, 'utf-8');
    sources.push({
      id,
      url: candidate.url,
      finalUrl: page.finalUrl || candidate.url,
      title: page.title || candidate.title,
      publishedDate: page.publishedDate || candidate.publishedDate || '',
      accessedAt: page.fetchedAt,
      retrieval_method: candidate.providers.join('+'),
      query: candidate.query,
      primary_source: isPrimarySource(candidate.url),
      fetch_status: 'fetched',
      fetched_via: page.via || 'direct',
      textFile,
      textLength: page.text.length,
      excerpt: page.text.slice(0, EXCERPT_CHARS)
    });
  }

  const unreadable = failed.map(({ candidate, page }) => ({
    url: candidate.url,
    title: candidate.title,
    retrieval_method: candidate.providers.join('+'),
    fetch_status: 'needs_verification',
    error: page.error || `HTTP ${page.status}`,
    accessedAt: page.fetchedAt
  }));

  if (sources.length === 0) {
    const reasons = searchLog.filter(l => l.error).map(l => `${l.provider}: ${l.error}`);
    throw new Error(
      `Research found no readable sources (queries: ${queries.join(' | ')}; candidates: ${candidates.length}` +
      `${reasons.length ? `; errors: ${reasons.join('; ')}` : ''}${!keys.tavily && !keys.serper && !keys.brave ? '; no TAVILY_API_KEY, SERPER_API_KEY or BRAVE_API_KEY set' : ''})`
    );
  }

  const offTopicList = offTopic.map(({ candidate, page }) => ({ url: candidate.url, title: page.title || candidate.title, fetch_status: 'off_topic' }));
  return { queries, sources, unreadable, offTopic: offTopicList, relevanceTerms, relevanceRelaxed: relaxed, searchLog, searchUsage: usage };
}

// ─── Stage: evidence — check quotes against the source text ──────────────────

export function normalizeForMatch(text) {
  return String(text || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[​-‍﻿]/g, '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// A quote the AI cut with "..." is checked piece by piece: every piece that is long enough must be found in the source
export function quoteFound(quote, sourceText) {
  const fragments = normalizeForMatch(quote)
    .replace(/^["']|["']$/g, '')
    .split(/\.\.\.|…/)
    .map(f => f.trim())
    .filter(f => f.length >= 12);
  return fragments.length > 0 && fragments.every(f => sourceText.includes(f));
}

export async function verifyClaims(job, claims, sources) {
  const texts = new Map();
  for (const s of sources) {
    try {
      texts.set(s.id, normalizeForMatch(await readFile(join(jobDir(job.id), s.textFile), 'utf-8')));
    } catch {
      texts.set(s.id, normalizeForMatch(s.excerpt));
    }
  }

  return claims.map(claim => {
    const checks = (claim.quotes || []).map(q => ({
      source_id: q.source_id,
      found: texts.has(q.source_id) && quoteFound(q.text, texts.get(q.source_id))
    }));
    const supported = checks.some(c => c.found);
    const verified = supported && claim.status === 'verified';

    let note = 'quote matched in fetched source text';
    if (!checks.length) note = 'no quote provided';
    else if (!supported) note = 'quote not found in fetched source text';
    else if (!verified) note = 'quote found, but reviewer did not mark claim verified';

    return {
      ...claim,
      model_status: claim.status,
      status: verified ? 'verified' : 'needs_verification',
      quote_checks: checks,
      verification_note: note
    };
  });
}
