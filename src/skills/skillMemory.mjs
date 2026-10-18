import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA_DIR } from '../paths.mjs';
const MEMORY_DIR = join(DATA_DIR, 'skills');
const MEMORY_FILE = join(MEMORY_DIR, 'memory.json');

// ─── Skill Memory ────────────────────────────────────────────────────────────
// A small log of review feedback. It is shown on the dashboard; it is NOT fed back into prompts
// (corrections belong to the job that produced them).

export async function loadSkillMemory() {
  try {
    const data = await readFile(MEMORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      corrections: [],
      patterns: {},
      quality: {
        totalJobs: 0,
        passedFirstReview: 0,
        commonIssues: []
      }
    };
  }
}

export function issueKindCounts(corrections) {
  const counts = {};
  for (const c of corrections || []) {
    for (const issue of c.issues || []) {
      const kind = String(issue).split(':')[0].trim().slice(0, 50);
      if (kind) counts[kind] = (counts[kind] || 0) + 1;
    }
  }
  return counts;
}

export async function saveSkillMemory(corrections) {
  const memory = await loadSkillMemory();

  // Add correction
  memory.corrections.push({
    ...corrections,
    timestamp: new Date().toISOString()
  });

  // Keep only the last 50 corrections
  if (memory.corrections.length > 50) {
    memory.corrections = memory.corrections.slice(-50);
  }

  // Count how often each KIND of issue came up in the last 50 review rounds. Issues are stored as "kind: problem text";
  // the problem text differs every time, so only the kind (unsupported, misattributed, duplicate_paragraph…) can repeat.
  memory.patterns = issueKindCounts(memory.corrections);
  memory.quality.commonIssues = Object.entries(memory.patterns)
    .filter(([_, count]) => count >= 3)        // "recurring" = seen at least 3 times
    .sort((a, b) => b[1] - a[1])
    .map(([issue, count]) => ({ issue, count }));

  await mkdir(MEMORY_DIR, { recursive: true });
  await writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2));
  return memory;
}

export async function recordJobResult(job) {
  const memory = await loadSkillMemory();
  memory.quality.totalJobs++;

  const review = job.stages.review?.result;
  if (review?.verdict === 'pass') {
    memory.quality.passedFirstReview++;
  }

  await writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2));
}
