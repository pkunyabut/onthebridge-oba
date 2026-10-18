// ─── Google Fact Check Tools: look up fact-check results already published by fact-checking organisations ───
// It covers only issues that someone has already checked — no result ≠ the fact is correct.
// The key is sent in a header (not in the link) · Google's search is loose, so relevance is filtered with relevantFactChecks

const TIMEOUT_MS = 15000;

export async function searchFactChecks(query, key, { pageSize = 5, languageCode = '' } = {}) {
  if (!key) return [];
  const params = new URLSearchParams({ query: String(query).slice(0, 300), pageSize: String(pageSize) });
  if (languageCode) params.set('languageCode', languageCode);
  const res = await fetch(`https://factchecktools.googleapis.com/v1alpha1/claims:search?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'X-Goog-Api-Key': key }
  });
  if (!res.ok) throw new Error(`Fact Check API error: ${res.status}`);
  const data = await res.json();
  return data.claims || [];
}

// Key terms used for matching: numbers + Latin words (≥4 characters, common words excluded)
const STOP = new Set(['that', 'this', 'with', 'from', 'have', 'were', 'will', 'would', 'about', 'which', 'their', 'there', 'been', 'into', 'than', 'also', 'said', 'says']);
export function keyTerms(text) {
  const out = new Set();
  for (const w of String(text).toLowerCase().match(/[a-z][a-z0-9'’-]{3,}|\d[\d,.]*/g) || []) {
    const t = w.replace(/,/g, '');
    if (!STOP.has(t)) out.add(t);
  }
  return out;
}

// Keep only results that share ≥ minShared key terms with the checked text (and ≥ 40% of the checked text's key terms)
export function relevantFactChecks(query, claims, { minShared = 3, max = 2 } = {}) {
  const q = keyTerms(query);
  if (q.size < minShared) return [];
  const out = [];
  for (const c of claims || []) {
    const review = (c.claimReview || [])[0];
    if (!review?.url) continue;
    const hay = keyTerms(`${c.text || ''} ${review.title || ''}`);
    const shared = [...q].filter(t => hay.has(t)).length;
    if (shared >= minShared && shared / q.size >= 0.4) {
      out.push({
        claim: String(c.text || '').slice(0, 200),
        publisher: review.publisher?.name || '',
        rating: review.textualRating || '',
        title: review.title || '',
        url: review.url,
        reviewDate: review.reviewDate || '',
        shared
      });
    }
  }
  return out.sort((a, b) => b.shared - a.shared).slice(0, max);
}
