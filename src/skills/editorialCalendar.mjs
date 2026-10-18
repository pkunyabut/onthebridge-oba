import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA_DIR } from '../paths.mjs';
const CALENDAR_FILE = join(DATA_DIR, 'editorial-calendar.json');

// ─── Editorial Calendar ──────────────────────────────────────────────────────

export async function initCalendar() {
  try { await readFile(CALENDAR_FILE, 'utf-8'); }
  catch { await mkdir(DATA_DIR, { recursive: true }); await writeFile(CALENDAR_FILE, JSON.stringify({ entries: [], stats: { total: 0, planned: 0, inProgress: 0, completed: 0, published: 0 } }, null, 2)); }
}

export async function getCalendar() {
  await initCalendar();
  try { return JSON.parse(await readFile(CALENDAR_FILE, 'utf-8')); }
  catch { return { entries: [], stats: { total: 0, planned: 0, inProgress: 0, completed: 0, published: 0 } }; }
}

export async function saveCalendar(calendar) {
  await initCalendar();
  calendar.stats.total = calendar.entries.length;
  calendar.stats.planned = calendar.entries.filter(e => e.status === 'planned').length;
  calendar.stats.inProgress = calendar.entries.filter(e => e.status === 'in_progress').length;
  calendar.stats.completed = calendar.entries.filter(e => e.status === 'completed').length;
  calendar.stats.published = calendar.entries.filter(e => e.status === 'published').length;
  await writeFile(CALENDAR_FILE, JSON.stringify(calendar, null, 2));
}

export async function addCalendarEntry(entry) {
  const calendar = await getCalendar();
  const id = `cal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newEntry = {
    id,
    title: entry.title || '',
    topic: entry.topic || entry.title || '',
    category: entry.category || 'T',
    template: entry.template || 'auto',
    status: 'planned',
    angle: entry.angle || '',
    targetDate: entry.targetDate || '',
    jobId: entry.jobId || '',
    notes: entry.notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  calendar.entries.unshift(newEntry);
  await saveCalendar(calendar);
  return newEntry;
}

export async function updateCalendarEntry(id, updates) {
  const calendar = await getCalendar();
  const entry = calendar.entries.find(e => e.id === id);
  if (!entry) return null;
  Object.assign(entry, updates, { updatedAt: new Date().toISOString() });
  await saveCalendar(calendar);
  return entry;
}

export async function deleteCalendarEntry(id) {
  const calendar = await getCalendar();
  calendar.entries = calendar.entries.filter(e => e.id !== id);
  await saveCalendar(calendar);
  return true;
}

export async function getCalendarByStatus(status) {
  const calendar = await getCalendar();
  if (!status) return calendar.entries;
  return calendar.entries.filter(e => e.status === status);
}

export async function getCalendarByMonth(year, month) {
  const calendar = await getCalendar();
  const prefix = `${year}-${month.toString().padStart(2, '0')}`;
  return calendar.entries.filter(e => e.targetDate?.startsWith(prefix));
}

// ─── Duplicate Detector ──────────────────────────────────────────────────────

export async function checkDuplicate(topic, threshold = 0.6) {
  const calendar = await getCalendar();
  const jobsDir = join(DATA_DIR, 'jobs');
  
  let existingJobs = [];
  try {
    const { readdir } = await import('node:fs/promises');
    const dirs = await readdir(jobsDir);
    for (const d of dirs) {
      try {
        const state = JSON.parse(await readFile(join(jobsDir, d, 'state.json'), 'utf-8'));
        existingJobs.push({ id: state.id, topic: state.topic, status: state.status });
      } catch {}
    }
  } catch {}
  
  const allEntries = [
    ...calendar.entries.map(e => ({ id: e.id, topic: e.topic, status: e.status, source: 'calendar' })),
    ...existingJobs.map(e => ({ id: e.id, topic: e.topic, status: e.status, source: 'job' }))
  ];
  
  const duplicates = [];
  const topicWords = tokenize(topic);
  
  for (const entry of allEntries) {
    const entryWords = tokenize(entry.topic);
    const similarity = calculateSimilarity(topicWords, entryWords);
    
    if (similarity >= threshold) {
      duplicates.push({
        id: entry.id,
        topic: entry.topic,
        status: entry.status,
        source: entry.source,
        similarity: Math.round(similarity * 100)
      });
    }
  }
  
  return {
    isDuplicate: duplicates.length > 0,
    duplicates: duplicates.sort((a, b) => b.similarity - a.similarity),
    suggestion: duplicates.length > 0 
      ? `Found ${duplicates.length} similar topic(s) — check them before writing`
      : 'No duplicate topic found — you can write it'
  };
}

// Words are split on whitespace, which suits English; Thai has no spaces between words, so a Thai topic is compared
// as whole phrases (a rough check — good enough to catch an identical or near-identical title)
function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\u0e00-\u0e7fa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
}

function calculateSimilarity(words1, words2) {
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  
  let intersection = 0;
  for (const w of set1) {
    if (set2.has(w)) intersection++;
  }
  
  const union = new Set([...set1, ...set2]).size;
  return union > 0 ? intersection / union : 0;
}

// ─── Calendar Stats ──────────────────────────────────────────────────────────

export async function getCalendarStats() {
  const calendar = await getCalendar();
  const byCategory = {};
  const byTemplate = {};
  const byMonth = {};
  
  for (const entry of calendar.entries) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
    byTemplate[entry.template] = (byTemplate[entry.template] || 0) + 1;
    const month = entry.targetDate?.slice(0, 7) || 'undated';
    byMonth[month] = (byMonth[month] || 0) + 1;
  }
  
  return {
    total: calendar.entries.length,
    byStatus: {
      planned: calendar.entries.filter(e => e.status === 'planned').length,
      inProgress: calendar.entries.filter(e => e.status === 'in_progress').length,
      completed: calendar.entries.filter(e => e.status === 'completed').length,
      published: calendar.entries.filter(e => e.status === 'published').length
    },
    byCategory,
    byTemplate,
    byMonth
  };
}
