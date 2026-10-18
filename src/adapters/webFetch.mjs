// ─── Web Page Fetcher ────────────────────────────────────────────────────────
// Opens a real web page and extracts its text, to confirm that a source exists and really contains the text that is cited.
//
// Security: the URLs come from search results, from the AI and from the user, so a page could be made to point at an
// address on your own machine or network (SSRF) and pull its content into an article. Every hop (including redirects)
// is therefore refused when its host is a loopback, private, link-local or otherwise non-public address.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { pdfToText, MAX_PDF_BYTES } from './pdfText.mjs';

const FETCH_TIMEOUT_MS = 20000;
const MAX_HTML_BYTES = 3_000_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|blockquote)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// Choose the main content part (article > main > body) to cut out menus and footers
function mainContent(html) {
  for (const tag of ['article', 'main']) {
    const matches = html.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi'));
    if (matches) {
      const longest = matches.reduce((a, b) => (b.length > a.length ? b : a));
      if (htmlToText(longest).length > 500) return longest;
    }
  }
  const body = html.match(/<body[\s\S]*<\/body>/i);
  return body ? body[0] : html;
}

function metaContent(html, names) {
  for (const name of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
    const reversed = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i');
    const m = html.match(re) || html.match(reversed);
    if (m) return decodeEntities(m[1]).trim();
  }
  return '';
}

// ─── SSRF guard ──────────────────────────────────────────────────────────────

// True for addresses that are not on the public internet
export function isPrivateAddress(address) {
  const ip = String(address || '').toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(ip) === 6) {
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || /^fe[89ab]/.test(ip);
  }
  return true; // not an IP at all → treat as unsafe
}

// Resolves the host and refuses non-public targets. Returns null when the URL is fine, or a reason string.
export async function blockedReason(url) {
  let u;
  try { u = new URL(url); } catch { return 'Invalid URL'; }
  if (!/^https?:$/.test(u.protocol)) return 'URL must start with http:// or https://';
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'Refused: local address';
  if (isIP(host)) return isPrivateAddress(host) ? 'Refused: private or loopback address' : null;
  try {
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) return 'Refused: the host resolves to a private or loopback address';
  } catch {
    return null; // cannot resolve → let fetch report the real network error
  }
  return null;
}

// fetch with manual redirects so that every hop is checked
async function safeFetch(url, init) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const reason = await blockedReason(current);
    if (reason) return { blocked: reason, url: current };
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    return { res, url: current };
  }
  return { blocked: 'Too many redirects', url: current };
}

export async function fetchPage(url) {
  const fetchedAt = new Date().toISOString();
  try {
    if (!/^https?:\/\//i.test(url || '')) {
      return { ok: false, url, fetchedAt, error: 'URL must start with http:// or https://' };
    }
    const hop = await safeFetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9', 'Accept-Language': 'en,th;q=0.8' }
    });
    if (hop.blocked) return { ok: false, url, finalUrl: hop.url, fetchedAt, error: hop.blocked };
    const res = hop.res;
    const finalUrl = hop.url;
    if (!res.ok) return { ok: false, url, finalUrl, status: res.status, fetchedAt, error: `HTTP ${res.status}` };

    const type = res.headers.get('content-type') || '';
    if (/application\/pdf/i.test(type) || (/octet-stream/i.test(type) && /\.pdf($|\?)/i.test(finalUrl))) {
      if (Number(res.headers.get('content-length') || 0) > MAX_PDF_BYTES) {
        return { ok: false, url, finalUrl, status: res.status, fetchedAt, error: 'PDF too large' };
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_PDF_BYTES) return { ok: false, url, finalUrl, status: res.status, fetchedAt, error: 'PDF too large' };
      const pdf = await pdfToText(bytes);
      if (pdf.text.length < 200) {
        return { ok: false, url, finalUrl, status: res.status, fetchedAt, error: 'PDF has too little readable text (scanned image or protected)' };
      }
      return { ok: true, url, finalUrl, status: res.status, fetchedAt, title: pdf.title, publishedDate: '', text: pdf.text, via: 'pdf' };
    }
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
      return { ok: false, url, finalUrl, status: res.status, fetchedAt, error: `Unsupported content type: ${type}` };
    }

    const raw = (await res.text()).slice(0, MAX_HTML_BYTES);
    const isHtml = !/text\/plain/i.test(type);
    const text = isHtml ? htmlToText(mainContent(raw)) : raw.trim();
    if (text.length < 200) {
      return { ok: false, url, finalUrl, status: res.status, fetchedAt, error: 'Page has too little readable text (blocked, paywalled or script-rendered)' };
    }

    return {
      ok: true,
      url,
      finalUrl,
      status: res.status,
      fetchedAt,
      title: isHtml ? (metaContent(raw, ['og:title']) || decodeEntities(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim()) : '',
      publishedDate: isHtml ? metaContent(raw, ['article:published_time', 'datePublished', 'date', 'pubdate']) : '',
      text
    };
  } catch (err) {
    return { ok: false, url, fetchedAt, error: err.name === 'TimeoutError' ? 'Timed out' : err.message };
  }
}

// ─── Tavily Extract (used when a page cannot be opened directly) ─────────────
// basic extract: 1 credit per 5 URLs fetched successfully

export async function tavilyExtract(urls, key) {
  if (!key || urls.length === 0) return [];
  const res = await fetch('https://api.tavily.com/extract', {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ urls, extract_depth: 'basic', format: 'text' })
  });
  if (!res.ok) throw new Error(`Tavily extract error: ${res.status}`);
  const data = await res.json();
  const fetchedAt = new Date().toISOString();
  return (data.results || [])
    .filter(r => (r.raw_content || '').trim().length >= 200)
    .map(r => ({ ok: true, url: r.url, finalUrl: r.url, fetchedAt, title: '', publishedDate: '', text: r.raw_content.trim(), via: 'tavily_extract' }));
}
