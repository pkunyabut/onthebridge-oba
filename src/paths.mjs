// ─── Project Paths ───────────────────────────────────────────────────────────
// Every path is anchored to this project's location, whichever folder the command is run from.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(ROOT_DIR, 'data');
export const JOBS_DIR = join(DATA_DIR, 'jobs');
export const RULES_DIR = join(ROOT_DIR, 'rules');

const JOB_ID_PATTERN = /^OBA-[0-9a-f]{8}$/;

export function isValidJobId(id) {
  return typeof id === 'string' && JOB_ID_PATTERN.test(id);
}

export function jobDir(id) {
  if (!isValidJobId(id)) throw new Error(`Invalid job id: ${id}`);
  return join(JOBS_DIR, id);
}
