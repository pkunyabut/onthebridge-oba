// ─── Web Search Providers ────────────────────────────────────────────────────
// Every provider returns the same shape: [{ title, url, snippet, publishedDate, provider }]
// A search result is only a "link that is probably relevant" — the real page must be opened with webFetch before it is used as evidence.

const TIMEOUT_MS = 20000;
// A Thai query gets Thai locale hints from the providers that support them; other queries use the provider defaults
const HAS_THAI = /[฀-๿]/;

function result(provider, { title, url, snippet, publishedDate }) {
  return { title: (title || '').trim(), url: url || '', snippet: (snippet || '').trim(), publishedDate: publishedDate || '', provider };
}

// ─── Tavily (1 credit per basic search) ──────────────────────────────────────

export async function searchTavily(query, key, { maxResults = 5 } = {}) {
  if (!key) return [];
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: maxResults })
  });
  if (!res.ok) throw new Error(`Tavily search error: ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(r => result('tavily', { title: r.title, url: r.url, snippet: r.content, publishedDate: r.published_date }));
}

// ─── Serper (Google results, 1 query at a time) ──────────────────────────────

export async function searchSerper(query, key, { maxResults = 5 } = {}) {
  if (!key) return [];
  const locale = HAS_THAI.test(query) ? { gl: 'th', hl: 'th' } : {};
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: maxResults, ...locale })
  });
  if (!res.ok) throw new Error(`Serper search error: ${res.status}`);
  const data = await res.json();
  return (data.organic || []).slice(0, maxResults).map(r => result('serper', { title: r.title, url: r.link, snippet: r.snippet, publishedDate: r.date }));
}

// ─── Brave Search (Brave's own index, not taken from Google) ─────────────────
// Thai uses search_lang=th (the country parameter does not support TH) · the key is sent in a header

export async function searchBrave(query, key, { maxResults = 5 } = {}) {
  if (!key) return [];
  const params = new URLSearchParams({ q: String(query).slice(0, 400), count: String(maxResults) });
  if (HAS_THAI.test(query)) params.set('search_lang', 'th');
  const res = await fetch('https://api.search.brave.com/res/v1/web/search?' + params, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'X-Subscription-Token': key, 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error('Brave search error: ' + res.status);
  const data = await res.json();
  return (data.web?.results || []).slice(0, maxResults).map(r => result('brave', { title: r.title, url: r.url, snippet: r.description, publishedDate: r.page_age || r.age }));
}

// ─── Serper News (Google's news tab — uses the same key as Serper) ───────────

export async function searchSerperNews(query, key, { maxResults = 5 } = {}) {
  if (!key) return [];
  const locale = HAS_THAI.test(query) ? { gl: 'th', hl: 'th' } : {};
  const res = await fetch('https://google.serper.dev/news', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: maxResults, ...locale })
  });
  if (!res.ok) throw new Error(`Serper news error: ${res.status}`);
  const data = await res.json();
  return (data.news || []).slice(0, maxResults).map(r => result('serper_news', { title: r.title, url: r.link, snippet: r.snippet, publishedDate: r.date }));
}

// ─── Wikipedia (free, no key needed) ─────────────────────────────────────────

export async function searchWikipedia(query, { maxResults = 3 } = {}) {
  const lang = HAS_THAI.test(query) ? 'th' : 'en';
  const api = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${maxResults}&srsearch=${encodeURIComponent(query)}`;
  const res = await fetch(api, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'OnTheBridge-OBA/1.0' } });
  if (!res.ok) throw new Error(`Wikipedia search error: ${res.status}`);
  const data = await res.json();
  return (data.query?.search || []).map(r => result('wikipedia', {
    title: r.title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: r.snippet.replace(/<[^>]+>/g, '')
  }));
}

// ─── DuckDuckGo HTML (free but fragile — the last-resort fallback) ───────────

export async function searchDuckDuckGo(query, { maxResults = 5 } = {}) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  if (!res.ok) throw new Error(`DuckDuckGo error: ${res.status}`);
  const html = await res.text();

  const strip = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').trim();
  const results = [];
  // Each result starts at a result__a link — cut into pieces and look for the snippet inside its own piece
  const blocks = html.split(/(?=<a[^>]*class="result__a")/).slice(1);
  for (const block of blocks) {
    if (results.length >= maxResults) break;
    const link = block.match(/^<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const m = [null, link[1], link[2], snippet?.[1]];
    let url = m[1].replace(/&amp;/g, '&');
    // DDG links are redirect links — take the target URL from the uddg parameter
    const target = url.match(/[?&]uddg=([^&]+)/);
    if (target) url = decodeURIComponent(target[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    results.push(result('duckduckgo', { title: strip(m[2]), url, snippet: strip(m[3] || '') }));
  }
  return results;
}

// Used by the "Search" page in the UI (free, no key needed)
export async function searchWeb(query) {
  try {
    return await searchDuckDuckGo(query);
  } catch {
    return [];
  }
}
