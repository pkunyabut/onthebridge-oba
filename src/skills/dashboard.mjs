import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA_DIR } from '../paths.mjs';

// ─── Dashboard Data ──────────────────────────────────────────────────────────

// How many articles you aim to publish (for the progress bar) — set TARGET_ARTICLES in .env
const TARGET_ARTICLES = Number(process.env.TARGET_ARTICLES) || 30;

export async function getDashboardData() {
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);

  // Load all data sources
  const jobsDir = join(DATA_DIR, 'jobs');
  const analytics = await loadJSON(join(DATA_DIR, 'analytics.json'));
  const costs = await loadJSON(join(DATA_DIR, 'costs.json'));
  const knowledge = await loadJSON(join(DATA_DIR, 'knowledge', 'index.json'));

  // Calculate stats
  const jobs = await loadJobs(jobsDir);
  const totalJobs = jobs.length;
  // 'complete' = the status of jobs from an older version
  const completedJobs = jobs.filter(j => ['ready_for_review', 'needs_revision', 'approved', 'complete'].includes(j.status)).length;
  const draftJobs = totalJobs - completedJobs;

  const thisMonthJobs = jobs.filter(j => j.createdAt?.startsWith(thisMonth)).length;

  const wordCountTotal = jobs.reduce((acc, j) => {
    return acc + (j.stages?.channels?.result?.blockdit?.wordCount || 0);
  }, 0);

  const wordCountAvg = completedJobs > 0 ? Math.round(wordCountTotal / completedJobs) : 0;

  const totalCost = costs.totals?.allTime || 0;
  const thisMonthCost = costs.byMonth?.[thisMonth] || 0;

  // Category distribution
  const categories = {};
  for (const job of jobs) {
    const cat = job.stages?.channels?.result?.website?.category || 'T';
    categories[cat] = (categories[cat] || 0) + 1;
  }

  // Template distribution
  const templates = {};
  for (const job of jobs) {
    const tpl = job.template || 'auto';
    templates[tpl] = (templates[tpl] || 0) + 1;
  }

  return {
    summary: {
      totalArticles: totalJobs,
      completedArticles: completedJobs,
      draftArticles: draftJobs,
      thisMonthArticles: thisMonthJobs,
      totalWordCount: wordCountTotal,
      averageWordCount: wordCountAvg,
      totalCost,
      thisMonthCost,
      currency: costs.currency || 'USD',
      knowledgeEntries: knowledge.entries?.length || 0,
      publishedArticles: analytics.publishedArticles || 0
    },
    distribution: {
      categories,
      templates
    },
    progress: {
      target: TARGET_ARTICLES,
      completed: analytics.publishedArticles || 0,
      percentage: Math.round(((analytics.publishedArticles || 0) / TARGET_ARTICLES) * 100)
    },
    recentJobs: jobs.slice(-5).reverse().map(j => ({
      id: j.id,
      topic: j.topic,
      status: j.status,
      createdAt: j.createdAt,
      wordCount: j.stages?.channels?.result?.blockdit?.wordCount || 0
    }))
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf-8')); }
  catch { return {}; }
}

async function loadJobs(jobsDir) {
  try {
    const dirs = await readdir(jobsDir);
    const jobs = [];
    for (const d of dirs) {
      try {
        const state = JSON.parse(await readFile(join(jobsDir, d, 'state.json'), 'utf-8'));
        jobs.push(state);
      } catch {}
    }
    return jobs;
  } catch { return []; }
}
