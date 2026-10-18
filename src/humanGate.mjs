// ─── Human Gate ──────────────────────────────────────────────────────────────
// Central rules:
// - Approval applies only to the version and file a person read. Praise, silence and a passed check are not approval.
// - Record the actual command text, the decider, the time and the file hash. An edit after approval must be sent for review again.
// - This first version has no publisher and no permission to send content to any platform.
// - A decision must come through the owner's channel. An AI connector must not be able to edit state or call a decision command.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jobDir } from './paths.mjs';
import { snapshotVersion } from './versions.mjs';

export const DELIVERABLE_FILE = 'blockdit.md';
export const DECISIONS = ['approve', 'revise', 'cancel'];

// States a person can decide on (a job the system finished, or one approved before whose file was later edited)
const DECIDABLE = ['ready_for_review', 'needs_revision', 'approved'];

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function composeDeliverable(job) {
  const b = job.stages.channels?.result?.blockdit || {};
  return `# ${b.title || job.topic}\n\n*${b.deck || ''}*\n\n${b.body || ''}\n`;
}

// Write the file handed to the person to read and record its hash in the job — every time the system makes a new version, the version number goes up
export async function writeDeliverable(job) {
  const content = composeDeliverable(job);
  await writeFile(join(jobDir(job.id), DELIVERABLE_FILE), content, 'utf-8');
  job.deliverable = {
    file: DELIVERABLE_FILE,
    sha256: sha256(content),
    version: (job.deliverable?.version || 0) + 1,
    createdAt: new Date().toISOString()
  };
  // Keep a copy of every version to look back at / compare later (if saving the copy fails, making the version does not fail)
  try { await snapshotVersion(job, content); } catch (e) { console.error('Version snapshot failed:', e.message); }
  return job.deliverable;
}

// Read the real file from disk and compare its hash with the recorded one — a mismatch means someone edited the file after the system made it
export async function readDeliverable(job) {
  if (!job.deliverable) return null;
  let content;
  try {
    content = await readFile(join(jobDir(job.id), job.deliverable.file), 'utf-8');
  } catch {
    return { ...job.deliverable, content: null, currentSha256: null, intact: false, missing: true };
  }
  const currentSha256 = sha256(content);
  return { ...job.deliverable, content, currentSha256, intact: currentSha256 === job.deliverable.sha256 };
}

// Is the approval still valid: it must be the same file the person approved (the hashes match)
export function approvalStatus(job, deliverable) {
  const last = [...(job.decisions || [])].reverse().find(d => d.decision === 'approve');
  if (job.status !== 'approved' || !last) return null;
  const valid = !!deliverable?.intact && deliverable.currentSha256 === last.sha256;
  return { valid, approvedSha256: last.sha256, currentSha256: deliverable?.currentSha256 || null };
}

// The owner's channel = the OBA web page in a browser only (a browser always sends Origin and Sec-Fetch-Site).
// Calls through curl / scripts / an AI agent that do not send these headers are refused.
// Note: the headers can be forged on purpose — this prevents accidental / automatic calls; it is not authentication.
export function isOwnerChannel(req) {
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  return !!origin && origin === `http://${req.headers.host}` && site === 'same-origin';
}

export function validateDecision(job, deliverable, body) {
  const decision = body.decision;
  const decidedBy = String(body.decidedBy || '').trim();
  const note = String(body.note || '').trim();

  if (!DECISIONS.includes(decision)) return 'decision must be approve, revise or cancel';
  if (!decidedBy) return 'The name of the person deciding is required';
  if (!DECIDABLE.includes(job.status)) return `A job in status ${job.status} cannot be decided yet`;
  // File missing / edited outside the system → cancel only (approval is impossible because it is not the file the system checked)
  if (decision === 'cancel' && (!deliverable || deliverable.missing || !deliverable.intact)) return null;
  if (!deliverable || deliverable.missing) return 'The review file was not found';
  if (!deliverable.intact) return 'The review file was edited after the system made it — it cannot be approved or sent back for edits, only cancelled';
  // The decision must be about the version actually seen: the hash the web page received must match the current file
  if (body.sha256 !== deliverable.currentSha256) return 'The version you opened is not the latest — reload the page and read it again';
  if (decision === 'revise' && !note) return 'Sending back for edits requires saying what to change';
  if (decision === 'approve' && job.status === 'needs_revision' && body.acknowledgeBlockers !== true) {
    return 'This job still has items to fix — you must confirm you are aware of them before approving';
  }
  if (decision === 'approve' && job.status === 'approved') return 'This version is already approved';
  return null;
}

export function recordDecision(job, deliverable, body, req) {
  const entry = {
    decision: body.decision,
    decidedBy: String(body.decidedBy).trim(),
    note: String(body.note || '').trim(),       // the actual command text
    decidedAt: new Date().toISOString(),
    file: deliverable.file,
    sha256: deliverable.currentSha256,
    version: deliverable.version,
    statusAtDecision: job.status,
    blockersAtDecision: (job.stages.final?.result?.blockers || []).length,
    channel: 'web-ui',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200)
  };
  job.decisions = [...(job.decisions || []), entry];
  return entry;
}
