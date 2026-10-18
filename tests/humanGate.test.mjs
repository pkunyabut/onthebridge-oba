import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, validateDecision, recordDecision, approvalStatus, isOwnerChannel } from '../src/humanGate.mjs';

const content = '# Title\n\nBody text';
const hash = sha256(content);
const intact = { file: 'blockdit.md', version: 1, sha256: hash, currentSha256: hash, intact: true };
const edited = { ...intact, currentSha256: sha256(content + ' edited'), intact: false };
const job = (status = 'ready_for_review', extra = {}) => ({ id: 'OBA-00000000', status, stages: { final: { result: { blockers: [] } } }, ...extra });
const body = (decision, extra = {}) => ({ decision, decidedBy: 'Owner', note: '', sha256: hash, ...extra });

test('approve succeeds for the exact file the owner read', () => {
  assert.equal(validateDecision(job(), intact, body('approve')), null);
});

test('decision on a stale or different version is refused', () => {
  assert.match(validateDecision(job(), intact, body('approve', { sha256: 'abc' })), /not the latest/);
});

test('file edited after the system created it cannot be approved or revised, only cancelled', () => {
  assert.match(validateDecision(job(), edited, body('approve', { sha256: edited.currentSha256 })), /edited after the system made it/);
  assert.match(validateDecision(job(), edited, body('revise', { sha256: edited.currentSha256, note: 'x' })), /edited after the system made it/);
  assert.equal(validateDecision(job(), edited, body('cancel')), null);
});

test('revise needs the actual instruction text', () => {
  assert.match(validateDecision(job(), intact, body('revise')), /saying what to change/);
  assert.equal(validateDecision(job(), intact, body('revise', { note: 'Cut the paragraph about the stock' })), null);
});

test('approving a job with open blockers needs explicit acknowledgement', () => {
  assert.match(validateDecision(job('needs_revision'), intact, body('approve')), /aware of them/);
  assert.equal(validateDecision(job('needs_revision'), intact, body('approve', { acknowledgeBlockers: true })), null);
});

test('decider name, decision type and job state are required', () => {
  assert.match(validateDecision(job(), intact, body('approve', { decidedBy: ' ' })), /name of the person/);
  assert.match(validateDecision(job(), intact, body('publish')), /approve, revise or cancel/);
  assert.match(validateDecision(job('processing'), intact, body('approve')), /cannot be decided yet/);
  assert.match(validateDecision(job('approved'), intact, body('approve')), /already approved/);
});

test('recorded decision keeps who, when, the instruction text and the file hash', () => {
  const j = job();
  const e = recordDecision(j, intact, body('revise', { note: 'Fix the standfirst' }), { headers: { 'user-agent': 'test' } });
  assert.equal(e.decidedBy, 'Owner');
  assert.equal(e.note, 'Fix the standfirst');
  assert.equal(e.sha256, hash);
  assert.equal(e.channel, 'web-ui');
  assert.ok(Date.parse(e.decidedAt));
  assert.equal(j.decisions.length, 1);
});

test('approval becomes invalid when the file changes after approval', () => {
  const j = job('approved', { decisions: [{ decision: 'approve', sha256: hash }] });
  assert.equal(approvalStatus(j, intact).valid, true);
  assert.equal(approvalStatus(j, edited).valid, false);
  assert.equal(approvalStatus(job(), intact), null);
});

test('owner channel = browser page of OBA itself; scripts and other sites are refused', () => {
  const host = '127.0.0.1:8080';
  assert.equal(isOwnerChannel({ headers: { host, origin: 'http://127.0.0.1:8080', 'sec-fetch-site': 'same-origin' } }), true);
  assert.equal(isOwnerChannel({ headers: { host } }), false); // curl / AI agent
  assert.equal(isOwnerChannel({ headers: { host, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }), false);
  assert.equal(isOwnerChannel({ headers: { host, origin: 'http://127.0.0.1:8080' } }), false);
});
