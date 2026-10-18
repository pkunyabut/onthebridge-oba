// ─── Summary of an article's evidence base (code only — no AI call, no numeric score) ───
// Why: a news feature that was revised 12 times (OBA-69572ffc) rested mainly on evidence from a single agency —
// editing the text cannot create more evidence.
// This summary shows the owner "how much evidence this article stands on" before reading it and before ordering another revision.
// Level: 'enough' or 'thin' with the reasons as text — the thresholds are adjustable defaults, not a guarantee of correctness.

import { similarity } from './stages/checks.mjs';

export const THRESHOLDS = {
  minUniqueClaims: 12,       // usable non-duplicate facts
  minOrganizations: 3,       // distinct source organisations among the sources actually used
  maxTopOrgShare: 0.6,       // share of facts that may come from a single organisation
  duplicateSimilarity: 0.5   // two facts this alike count as duplicates
};

// The source organisation is estimated from the domain (co.th/go.th/or.th/ac.th style second-level domains count as 3 labels) —
// several pages of one site = one organisation
export function orgKey(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'unknown'; }
  const labels = host.split('.');
  if (labels.length >= 3 && labels.at(-1).length === 2 && /^(co|go|or|ac|in|net|mi|gov|org|edu|com)$/.test(labels.at(-2))) return labels.slice(-3).join('.');
  return labels.slice(-2).join('.');
}

function dedupeClaims(claims) {
  const kept = [];
  let duplicates = 0;
  for (const c of claims) {
    if (kept.some(k => similarity(k.claim || '', c.claim || '') >= THRESHOLDS.duplicateSimilarity)) duplicates++;
    else kept.push(c);
  }
  return { kept, duplicates };
}

// sources: [{ id, url, retrieval_method, primary_source }] the article really cites · claims: facts that have passed the check
export function summarizeEvidence(claims, sources) {
  const verified = (claims || []).filter(c => c.status === 'verified');
  const { kept, duplicates } = dedupeClaims(verified);

  const srcById = new Map((sources || []).map(s => [s.id, s]));
  const org = s => (s.retrieval_method === 'user_transcript' ? 'interview supplied by the team' : orgKey(s.finalUrl || s.url));
  const claimsByOrg = new Map();
  for (const c of kept) {
    const orgs = new Set((c.source_ids || []).map(id => srcById.get(id)).filter(Boolean).map(org));
    for (const o of orgs) claimsByOrg.set(o, (claimsByOrg.get(o) || 0) + 1);
  }
  const usedSources = (sources || []).filter(s => kept.some(c => (c.source_ids || []).includes(s.id)));
  const pagesByOrg = new Map();
  for (const s of usedSources) pagesByOrg.set(org(s), (pagesByOrg.get(org(s)) || 0) + 1);

  const ranked = [...claimsByOrg.entries()].sort((a, b) => b[1] - a[1]);
  const [topOrg, topCount] = ranked[0] || ['', 0];
  const topShare = kept.length ? topCount / kept.length : 0;
  const primaryPages = usedSources.filter(s => s.primary_source).length;

  const reasons = [];
  if (kept.length < THRESHOLDS.minUniqueClaims) reasons.push(`only ${kept.length} non-duplicate fact(s) (should be ${THRESHOLDS.minUniqueClaims} or more)`);
  if (claimsByOrg.size < THRESHOLDS.minOrganizations) reasons.push(`from only ${claimsByOrg.size} source organisation(s) (should be ${THRESHOLDS.minOrganizations} or more)`);
  if (kept.length >= 4 && topShare > THRESHOLDS.maxTopOrgShare) reasons.push(`${Math.round(topShare * 100)}% of the facts come from one organisation, ${topOrg}`);

  return {
    level: reasons.length ? 'thin' : 'enough',
    reasons,
    verifiedClaims: verified.length,
    uniqueClaims: kept.length,
    duplicateClaims: duplicates,
    organizations: ranked.map(([name, n]) => ({ name, claims: n, pages: pagesByOrg.get(name) || 0 })),
    primaryPages,
    usedPages: usedSources.length
  };
}

export function evidenceNote(e) {
  if (!e || e.level === 'enough') return '';
  return `Thin evidence base: ${e.reasons.join(' · ')} — revising the text again does not add evidence; add independent source links or accept a shorter article`;
}
