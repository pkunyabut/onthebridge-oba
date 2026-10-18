import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA_DIR } from '../paths.mjs';
import { languageProfile } from '../language.mjs';
const KNOWLEDGE_DIR = join(DATA_DIR, 'knowledge');
const ANALYTICS_FILE = join(DATA_DIR, 'analytics.json');

// ─── Knowledge Store ─────────────────────────────────────────────────────────

export async function initKnowledge() {
  await mkdir(KNOWLEDGE_DIR, { recursive: true });
  try { await readFile(join(KNOWLEDGE_DIR, 'index.json'), 'utf-8'); }
  catch { await writeFile(join(KNOWLEDGE_DIR, 'index.json'), JSON.stringify({ entries: [], stats: { total: 0, verified: 0 } }, null, 2)); }
}

export async function getIndex() {
  await initKnowledge();
  try { return JSON.parse(await readFile(join(KNOWLEDGE_DIR, 'index.json'), 'utf-8')); }
  catch { return { entries: [], stats: { total: 0, verified: 0 } }; }
}

export async function saveIndex(index) {
  await initKnowledge();
  index.stats.total = index.entries.length;
  index.stats.verified = index.entries.filter(e => e.status === 'verified').length;
  await writeFile(join(KNOWLEDGE_DIR, 'index.json'), JSON.stringify(index, null, 2));
}

export async function addKnowledge(entry) {
  const index = await getIndex();
  const id = `kw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const knowledge = { id, ...entry, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), usageCount: 0 };
  
  await writeFile(join(KNOWLEDGE_DIR, `${id}.json`), JSON.stringify(knowledge, null, 2));
  index.entries.unshift({ id, topic: entry.topic || '', summary: entry.summary || entry.claim?.slice(0, 100) || '', status: entry.status || 'unverified', sourceCount: entry.sources?.length || 0, createdAt: knowledge.createdAt });
  await saveIndex(index);
  
  return knowledge;
}

export async function searchKnowledge(query, topic = '') {
  const index = await getIndex();
  const q = query.toLowerCase();
  return index.entries.filter(entry => {
    const mq = !query || entry.topic.toLowerCase().includes(q) || entry.summary.toLowerCase().includes(q);
    const mt = !topic || entry.topic.toLowerCase().includes(topic.toLowerCase());
    return mq && mt;
  }).slice(0, 10);
}

export async function getKnowledge(id) {
  try { return JSON.parse(await readFile(join(KNOWLEDGE_DIR, `${id}.json`), 'utf-8')); }
  catch { return null; }
}

// ─── Import from Job ─────────────────────────────────────────────────────────

export async function importFromJob(job) {
  const imported = [];
  const sources = job.stages?.research?.result?.sources || [];
  const claims = job.stages?.evidence?.result?.claims || [];
  
  for (const source of sources) {
    const existing = await searchKnowledge('', source.title);
    if (existing.length === 0) {
      imported.push(await addKnowledge({
        topic: source.title, type: 'source', summary: source.excerpt || source.content?.slice(0, 200) || '',
        url: source.url || '', sourceType: source.retrieval_method || 'web_search', jobId: job.id
      }));
    }
  }
  
  for (const claim of claims) {
    if (claim.status === 'verified') {
      const existing = await searchKnowledge('', claim.claim);
      if (existing.length === 0) {
        imported.push(await addKnowledge({
          topic: job.topic, type: 'claim', claim: claim.claim, status: 'verified',
          sources: claim.source_ids, rationale: claim.rationale, claimType: claim.type, jobId: job.id
        }));
      }
    }
  }
  
  return imported;
}

// ─── Analytics / KPI ─────────────────────────────────────────────────────────

// The word-count range that counts as "on target" depends on the job's article language (see src/language.mjs)

export async function getAnalytics() {
  try {
    return JSON.parse(await readFile(ANALYTICS_FILE, 'utf-8'));
  } catch {
    return {
      // Output
      totalArticles: 0, publishedArticles: 0, draftArticles: 0,
      totalWordCount: 0, totalSources: 0, totalClaims: 0, verifiedClaims: 0,
      
      // Quality
      articlesPassWordCount: 0, articlesFailWordCount: 0,
      averageWordCount: 0, wordCountPassRate: 0,
      averageSourcesPerArticle: 0, averageClaimsPerArticle: 0,
      
      // Consistency
      articlesByMonth: {}, articlesByWeek: {},
      
      // Diversity
      articlesByTemplate: {}, articlesByCategory: {},
      templatesUsed: 0, categoriesUsed: 0,
      
      // Growth
      totalKnowledgeEntries: 0, totalUniqueSources: 0,
      topTopics: [], sourcesByDomain: {},
      
      // Milestones
      milestones: [],
      
      createdAt: new Date().toISOString()
    };
  }
}

export async function saveAnalytics(analytics) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(ANALYTICS_FILE, JSON.stringify(analytics, null, 2));
}

export async function recordArticle(job) {
  const a = await getAnalytics();
  const channels = job.stages?.channels?.result;
  const blockdit = channels?.blockdit;
  const sources = job.stages?.research?.result?.sources || [];
  const claims = job.stages?.evidence?.result?.claims || [];
  const wordCount = blockdit?.wordCount || 0;
  
  // Output
  a.totalArticles++;
  a.totalWordCount += wordCount;
  a.totalSources += sources.length;
  a.totalClaims += claims.length;
  a.verifiedClaims += claims.filter(c => c.status === 'verified').length;
  
  // Quality: Word Count Pass/Fail
  const { min: WORD_COUNT_MIN, max: WORD_COUNT_MAX } = languageProfile(job.language).wordRange;
  if (wordCount >= WORD_COUNT_MIN && wordCount <= WORD_COUNT_MAX) {
    a.articlesPassWordCount++;
  } else {
    a.articlesFailWordCount++;
  }
  a.averageWordCount = Math.round(a.totalWordCount / a.totalArticles);
  a.wordCountPassRate = Math.round((a.articlesPassWordCount / a.totalArticles) * 100);
  a.averageSourcesPerArticle = Math.round(a.totalSources / a.totalArticles);
  a.averageClaimsPerArticle = Math.round(a.totalClaims / a.totalArticles);
  
  // Consistency
  const month = new Date().toISOString().slice(0, 7);
  a.articlesByMonth[month] = (a.articlesByMonth[month] || 0) + 1;
  const week = getWeekNumber(new Date());
  a.articlesByWeek[week] = (a.articlesByWeek[week] || 0) + 1;
  
  // Diversity
  const template = job.template || 'auto';
  a.articlesByTemplate[template] = (a.articlesByTemplate[template] || 0) + 1;
  a.templatesUsed = Object.keys(a.articlesByTemplate).length;
  
  const category = channels?.website?.category || 'T';
  a.articlesByCategory[category] = (a.articlesByCategory[category] || 0) + 1;
  a.categoriesUsed = Object.keys(a.articlesByCategory).length;
  
  // Growth
  for (const source of sources) {
    try {
      const domain = new URL(source.url).hostname;
      a.sourcesByDomain[domain] = (a.sourcesByDomain[domain] || 0) + 1;
    } catch {}
  }
  a.totalUniqueSources = Object.keys(a.sourcesByDomain).length;
  
  a.topTopics = [...new Set([job.topic, ...a.topTopics])].slice(0, 10);
  
  // Check milestones
  checkMilestones(a);
  
  a.lastUpdated = new Date().toISOString();
  
  await saveAnalytics(a);
  return a;
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

function checkMilestones(a) {
  const milestones = [5, 10, 15, 20, 25, 30, 50, 100];
  for (const m of milestones) {
    if (a.totalArticles >= m && !a.milestones.find(ms => ms.count === m)) {
      a.milestones.push({ count: m, date: new Date().toISOString(), type: 'article_count' });
    }
  }
  
  const pubMilestones = [5, 10, 15, 20, 25, 30];
  for (const m of pubMilestones) {
    if (a.publishedArticles >= m && !a.milestones.find(ms => ms.count === m && ms.type === 'published_count')) {
      a.milestones.push({ count: m, date: new Date().toISOString(), type: 'published_count' });
    }
  }
}

export async function markPublished(jobId) {
  const a = await getAnalytics();
  a.publishedArticles++;
  a.draftArticles = a.totalArticles - a.publishedArticles;
  checkMilestones(a);
  a.lastUpdated = new Date().toISOString();
  await saveAnalytics(a);
  return a;
}

// ─── KPI Summary ─────────────────────────────────────────────────────────────

export async function getKPIs() {
  const a = await getAnalytics();
  const k = await getIndex();
  
  return {
    // Output
    totalArticles: a.totalArticles,
    publishedArticles: a.publishedArticles,
    draftArticles: a.draftArticles || a.totalArticles - a.publishedArticles,
    totalWordCount: a.totalWordCount,
    
    // Quality
    quality: {
      wordCountPassRate: a.wordCountPassRate || 0,
      averageWordCount: a.averageWordCount || 0,
      averageSourcesPerArticle: a.averageSourcesPerArticle || 0,
      averageClaimsPerArticle: a.averageClaimsPerArticle || 0,
      claimVerificationRate: a.totalClaims > 0 ? Math.round((a.verifiedClaims / a.totalClaims) * 100) : 0,
    },
    
    // Consistency
    consistency: {
      articlesThisMonth: a.articlesByMonth[new Date().toISOString().slice(0, 7)] || 0,
      articlesLastMonth: a.articlesByMonth[getPreviousMonth()] || 0,
      peakMonth: Object.entries(a.articlesByMonth).sort((a, b) => b[1] - a[1])[0] || ['-', 0],
      monthsActive: Object.keys(a.articlesByMonth).length,
    },
    
    // Diversity
    diversity: {
      templatesUsed: a.templatesUsed || 0,
      categoriesUsed: a.categoriesUsed || 0,
      articlesByTemplate: a.articlesByTemplate || {},
      articlesByCategory: a.articlesByCategory || {},
    },
    
    // Growth
    growth: {
      totalKnowledgeEntries: k.entries.length || 0,
      totalUniqueSources: a.totalUniqueSources || 0,
      topDomains: Object.entries(a.sourcesByDomain || {}).sort((a, b) => b[1] - a[1]).slice(0, 5),
      topTopics: a.topTopics || [],
    },
    
    // Milestones
    milestones: a.milestones || [],
    nextMilestone: [5, 10, 15, 20, 25, 30, 50, 100].find(m => m > a.totalArticles) || 'MAX',
  };
}

function getPreviousMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

// ─── Export ──────────────────────────────────────────────────────────────────

// A CSV cell: quote it, double inner quotes, and defuse spreadsheet formulas (a cell that starts with = + - @ would be
// run as a formula when opened in Excel; topics and domains come from web pages, so they are not trusted)
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportToCSV() {
  const index = await getIndex();
  const analytics = await getAnalytics();

  const knowledgeCSV = [
    'ID,Topic,Type,Status,Source Count,Created At',
    ...index.entries.map(e => [csvCell(e.id), csvCell(e.topic), csvCell(e.type), csvCell(e.status), e.sourceCount, csvCell(e.createdAt)].join(','))
  ].join('\n');
  
  const analyticsCSV = [
    'Metric,Value',
    `Total Articles,${analytics.totalArticles}`,
    `Published Articles,${analytics.publishedArticles}`,
    `Draft Articles,${analytics.totalArticles - analytics.publishedArticles}`,
    `Total Word Count,${analytics.totalWordCount}`,
    `Average Word Count,${analytics.averageWordCount}`,
    `Word Count Pass Rate,${analytics.wordCountPassRate}%`,
    `Articles Pass Word Count,${analytics.articlesPassWordCount}`,
    `Articles Fail Word Count,${analytics.articlesFailWordCount}`,
    `Average Sources/Article,${analytics.averageSourcesPerArticle}`,
    `Average Claims/Article,${analytics.averageClaimsPerArticle}`,
    `Claim Verification Rate,${analytics.totalClaims > 0 ? Math.round((analytics.verifiedClaims / analytics.totalClaims) * 100) : 0}%`,
    `Total Sources,${analytics.totalSources}`,
    `Total Claims,${analytics.totalClaims}`,
    `Verified Claims,${analytics.verifiedClaims}`,
    `Templates Used,${analytics.templatesUsed}`,
    `Categories Used,${analytics.categoriesUsed}`,
    '',
    'Month,Articles',
    ...Object.entries(analytics.articlesByMonth || {}).map(([m, c]) => `${m},${c}`),
    '',
    'Template,Articles',
    ...Object.entries(analytics.articlesByTemplate || {}).map(([t, c]) => `${t},${c}`),
    '',
    'Category,Articles',
    ...Object.entries(analytics.articlesByCategory || {}).map(([t, c]) => `${t},${c}`),
    '',
    'Domain,Sources',
    ...Object.entries(analytics.sourcesByDomain || {}).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d, c]) => `${csvCell(d)},${c}`),
    '',
    'Milestone,Date,Type',
    ...(analytics.milestones || []).map(m => `${m.count},${m.date},${m.type}`)
  ].join('\n');
  
  return { knowledgeCSV, analyticsCSV };
}

export async function getStats() {
  const index = await getIndex();
  const analytics = await getAnalytics();
  return {
    knowledge: { totalEntries: index.entries.length, verifiedEntries: index.entries.filter(e => e.status === 'verified').length },
    analytics
  };
}
