import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { JOBS_DIR, jobDir, isValidJobId } from './paths.mjs';
import { writeDeliverable, readDeliverable, approvalStatus, isOwnerChannel, validateDecision, recordDecision } from './humanGate.mjs';
import { runStage } from './stages/index.mjs';
import { loadSkillMemory, saveSkillMemory } from './skills/skillMemory.mjs';
import { getStats as getKnowledgeStats, recordArticle, markPublished, getAnalytics, getKPIs, exportToCSV } from './skills/knowledgeStore.mjs';
import { addCalendarEntry, getCalendarStats, getCalendarByStatus, checkDuplicate } from './skills/editorialCalendar.mjs';
import { exportMultiFormat, getExports } from './skills/exportFormats.mjs';
import { getDashboardData } from './skills/dashboard.mjs';
import { researchTools } from './skills/researchTools.mjs';
import { cleanTranscripts } from './stages/research.mjs';
import { runFactAudit } from './factAudit.mjs';
import { PILLARS } from './rules.mjs';
import { normalizeLanguage } from './language.mjs';
import { callAI } from './adapters/index.mjs';
import { suggestWebCode, validateWebCode, WEB_CODES } from './webCategory.mjs';
import { runDeepFactAudit } from './deepCheck.mjs';
import { snapshotVersion, listVersions, readVersion, diffParagraphs, diffSummary } from './versions.mjs';
import { recheckSources } from './sourceRecheck.mjs';
import { importUniversal, listImports } from './skills/universalImporter.mjs';
import { getCostSummary, recordJobCost, estimateCost } from './skills/costTracker.mjs';
import { verifyArticleWithClaude, summarizeArticleWithClaude } from './skills/claudeCLI.mjs';

// API keys the user sends with a job are kept in memory while it runs only; they are never written to state.json
const SECRET_FIELDS = ['deepseekKey', 'searchKey'];
const jobSecrets = new Map();

function withoutSecrets(job) {
  const clean = { ...job };
  for (const field of SECRET_FIELDS) delete clean[field];
  return clean;
}

// ─── Job Management ──────────────────────────────────────────────────────────

async function createJob(topic, audience = 'general', instructions = '', language = '') {
  const id = `OBA-${randomUUID().slice(0, 8)}`;
  const dir = jobDir(id);
  await mkdir(dir, { recursive: true });

  const job = {
    id,
    topic,
    audience,
    instructions,
    language: normalizeLanguage(language),
    status: 'created',
    revision: 1,
    stages: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await writeFile(join(dir, 'state.json'), JSON.stringify(job, null, 2));
  return job;
}

async function loadJob(id) {
  const state = JSON.parse(await readFile(join(jobDir(id), 'state.json'), 'utf-8'));
  return withoutSecrets(state);
}

async function saveJob(job) {
  job.updatedAt = new Date().toISOString();
  await writeFile(join(jobDir(job.id), 'state.json'), JSON.stringify(withoutSecrets(job), null, 2));
}

async function deleteJob(id) {
  if (!isValidJobId(id)) return false;
  // A job has a sub-folder (sources/), so deletion is recursive — jobDir validates the id format, so nothing outside data/jobs can be removed
  try {
    await rm(jobDir(id), { recursive: true });
    return true;
  } catch (err) {
    console.error(`[${id}] Delete failed:`, err.message);
    return false;
  }
}

// Open a job's folder in the system file manager (only a jobId is accepted; no user text goes through a shell)
function openFolder(dir) {
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [dir]]
    : process.platform === 'darwin' ? ['open', [dir]]
    : ['xdg-open', [dir]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', err => console.error('Open folder failed:', err.message));
  child.unref();
}

// ─── Agent Pipeline (8 stages) ──────────────────────────────────────────────

// fromStage: start part-way (used when the owner sends the article back for edits → start at write using the existing draft)
async function runPipeline(jobId, { fromStage } = {}) {
  const job = { ...(await loadJob(jobId)), ...jobSecrets.get(jobId) };
  const stages = ['brief', 'research', 'evidence', 'outline', 'write', 'review', 'channels', 'final'];
  const provider = job.provider || 'deepseek';
  const resumed = !!fromStage;

  job.status = 'processing';
  job.provider = provider;
  // tokenUsage accumulates over the whole job; runUsage = this run only, used for cost recording so nothing is counted twice
  const zero = () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 });
  job.tokenUsage = resumed ? (job.tokenUsage || zero()) : zero();
  const runUsage = zero();
  await saveJob(job);

  let stageIndex = resumed ? stages.indexOf(fromStage) : 0;
  while (stageIndex < stages.length) {
    const stage = stages[stageIndex];
    try {
      console.log(`[${jobId}] Running stage: ${stage} (provider: ${provider})`);
      const result = await runStage(stage, job);
      job.stages[stage] = { status: 'complete', result, completedAt: new Date().toISOString() };
      if (result.searchUsage) job.searchUsage = result.searchUsage;

      // Track token usage
      if (result._usage) {
        for (const usage of [job.tokenUsage, runUsage]) {
          usage.promptTokens += result._usage.promptTokens || 0;
          usage.completionTokens += result._usage.completionTokens || 0;
          usage.totalTokens += result._usage.totalTokens || 0;
          usage.apiCalls += 1;
        }
      }

      if (stage === 'review') {
        // Keep the history of every round, because job.stages.review is overwritten in the next round
        job.reviewHistory = [...(job.reviewHistory || []), {
          revision: result.revision, verdict: result.verdict, wordCount: result.wordCount, issues: result.issues
        }];
        if (result.feedback) await saveSkillMemory(result.feedback);

        // Did not pass and rounds remain → send the existing draft back to the write stage with the list of problems
        if (result.retry) {
          job.revision = (job.revision || 1) + 1;
          job.reviewFeedback = result.feedback;
          console.log(`[${jobId}] Review found ${result.issues.length} issue(s), revising (round ${job.revision})`);
          await saveJob(job);
          stageIndex = stages.indexOf('write');
          continue;
        }
        delete job.reviewFeedback;
      }

      await saveJob(job);
      stageIndex++;
    } catch (err) {
      console.error(`[${jobId}] Stage ${stage} failed:`, err.message);
      job.stages[stage] = { status: 'error', error: err.message };
      job.status = 'error';
      job.error = err.message;
      await saveJob(job);
      break;
    }
  }

  // The cost has been incurred even when the job failed, so it is always recorded
  try {
    await recordJobCost(jobId, provider, runUsage.apiCalls, runUsage.promptTokens, runUsage.completionTokens, job.model || '');
  } catch (e) {
    console.error('Cost recording failed:', e.message);
  }

  if (job.status !== 'error') {
    // ready_for_human_review = passed the internal checks, waiting for the owner to read and decide (it is not an approval)
    const verdict = job.stages.final?.result?.verdict;
    job.status = verdict === 'ready_for_human_review' ? 'ready_for_review' : 'needs_revision';
    // The file handed to the person to read + its hash — the decision is tied to this file
    try {
      await writeDeliverable(job);
    } catch (e) {
      console.error('Deliverable write failed:', e.message);
    }
    if (!resumed) {
      try {
        await recordArticle(job);
      } catch (e) {
        console.error('Analytics recording failed:', e.message);
      }
    }
    await saveJob(job);
  }
  jobSecrets.delete(jobId);
  return withoutSecrets(job);
}

// ─── API Handler ─────────────────────────────────────────────────────────────

export async function handleAPI(req, url) {
  const body = await readBody(req);

  switch (url.pathname) {
    case '/api/jobs': {
      if (req.method === 'GET') {
        const jobs = await listJobs();
        return { status: 200, body: { jobs } };
      }
      if (req.method === 'POST') {
        const { topic, audience, instructions, deepseekKey, searchKey, template, external, provider, model } = body;
        if (!topic || typeof topic !== 'string') {
          return { status: 400, body: { error: 'topic is required' } };
        }
        const job = await createJob(topic, audience, instructions, body.language);
        job.template = template || 'auto';
        job.pillar = PILLARS.includes(body.pillar) ? body.pillar : 'auto';
        job.external = external || [];
        job.transcripts = cleanTranscripts(body.transcripts);
        job.provider = provider || 'deepseek';
        job.model = model || '';
        await saveJob(job);
        jobSecrets.set(job.id, { deepseekKey: deepseekKey || '', searchKey: searchKey || '' });
        runPipeline(job.id).catch(console.error);
        return { status: 201, body: { job } };
      }
      break;
    }

    case '/api/skills': {
      if (req.method === 'GET') {
        const memory = await loadSkillMemory();
        return { status: 200, body: memory };
      }
      break;
    }

    case '/api/analytics': {
      if (req.method === 'GET') {
        const analytics = await getAnalytics();
        const knowledge = await getKnowledgeStats();
        return { status: 200, body: { analytics, knowledge } };
      }
      break;
    }

    case '/api/kpis': {
      if (req.method === 'GET') {
        const kpis = await getKPIs();
        return { status: 200, body: { kpis } };
      }
      break;
    }

    case '/api/calendar': {
      if (req.method === 'GET') {
        const { status } = Object.fromEntries(url.searchParams);
        const entries = await getCalendarByStatus(status);
        const stats = await getCalendarStats();
        return { status: 200, body: { entries, stats } };
      }
      if (req.method === 'POST') {
        const entry = await addCalendarEntry(body);
        return { status: 201, body: { entry } };
      }
      break;
    }

    case '/api/calendar/stats': {
      if (req.method === 'GET') {
        const stats = await getCalendarStats();
        return { status: 200, body: { stats } };
      }
      break;
    }

    case '/api/duplicate-check': {
      if (req.method === 'POST') {
        const { topic } = body;
        const result = await checkDuplicate(topic);
        return { status: 200, body: result };
      }
      break;
    }

    case '/api/export-formats': {
      if (req.method === 'POST') {
        // Drafts for other channels are made only from an approved version whose file has not been edited
        const { jobId, formats, deepseekKey } = body;
        if (!isValidJobId(jobId)) return { status: 400, body: { error: 'Invalid jobId' } };
        const job = await loadJob(jobId);
        const approval = approvalStatus(job, await readDeliverable(job));
        if (!approval?.valid) return { status: 409, body: { error: 'Drafts for other channels can be made only from an approved version whose file has not been edited since approval' } };
        const wanted = Array.isArray(formats) && formats.length ? formats : ['social'];
        const secrets = jobSecrets.get(jobId) || {};
        const results = await exportMultiFormat(jobId, wanted, deepseekKey || secrets.deepseekKey || '');
        return { status: 200, body: { results } };
      }
      break;
    }

    case '/api/dashboard': {
      if (req.method === 'GET') {
        const dashboard = await getDashboardData();
        return { status: 200, body: dashboard };
      }
      break;
    }

    case '/api/costs': {
      if (req.method === 'GET') {
        const costs = await getCostSummary();
        return { status: 200, body: costs };
      }
      break;
    }

    case '/api/costs/estimate': {
      if (req.method === 'POST') {
        const { provider, apiCalls, model } = body;
        const estimate = estimateCost(provider || 'deepseek', apiCalls || 5, 4000, model || '');
        return { status: 200, body: estimate };
      }
      break;
    }

    case '/api/open-folder': {
      if (req.method === 'POST') {
        const { jobId } = body;
        if (!isValidJobId(jobId)) return { status: 400, body: { error: 'Invalid jobId' } };
        openFolder(jobDir(jobId));
        return { status: 200, body: { success: true } };
      }
      break;
    }

    case '/api/test-connection': {
      if (req.method === 'POST') {
        const { provider, model, apiKey } = body;
        try {
          const result = await callAI('Say "OK" in one word', {
            provider,
            model,
            key: apiKey,
            maxTokens: 10
          });
          return {
            status: 200,
            body: {
              success: true,
              provider,
              model,
              usage: result._usage
            }
          };
        } catch (err) {
          return { status: 200, body: { success: false, provider, error: err.message } };
        }
      }
      break;
    }

    // Optional: needs the Claude Code CLI ("claude") installed and signed in. Fixed prompts only.
    case '/api/claude/verify': {
      if (req.method === 'POST') {
        const { jobId } = body;
        if (!isValidJobId(jobId)) return { status: 400, body: { error: 'Invalid jobId' } };
        const job = await loadJob(jobId);
        const result = await verifyArticleWithClaude(job);
        return { status: 200, body: result };
      }
      break;
    }

    case '/api/claude/summarize': {
      if (req.method === 'POST') {
        const { jobId } = body;
        if (!isValidJobId(jobId)) return { status: 400, body: { error: 'Invalid jobId' } };
        const job = await loadJob(jobId);
        const result = await summarizeArticleWithClaude(job);
        return { status: 200, body: result };
      }
      break;
    }

    case '/api/research/source-credibility': {
      if (req.method === 'POST') {
        const { url, title, content, author, date, deepseekKey, provider } = body;
        const result = await researchTools('source-credibility', { url, title, content, author, date }, deepseekKey || '', provider || 'deepseek');
        return { status: 200, body: result };
      }
      break;
    }

    case '/api/research/summarize': {
      if (req.method === 'POST') {
        const { text, deepseekKey, provider } = body;
        const result = await researchTools('summarize-research', { text }, deepseekKey || '', provider || 'deepseek');
        return { status: 200, body: result };
      }
      break;
    }

    case '/api/research/extract-pdf': {
      if (req.method === 'POST') {
        const { text, deepseekKey, provider } = body;
        const result = await researchTools('extract-pdf', { text }, deepseekKey || '', provider || 'deepseek');
        return { status: 200, body: result };
      }
      break;
    }

    case '/api/import': {
      if (req.method === 'POST') {
        const { type, content, url, title, filename, deepseekKey, provider } = body;
        const result = await importUniversal({ type, content, url, title, filename }, deepseekKey || '', provider || 'deepseek');
        return { status: 200, body: result };
      }
      if (req.method === 'GET') {
        const imports = await listImports();
        return { status: 200, body: { imports } };
      }
      break;
    }

    case '/api/export': {
      if (req.method === 'GET') {
        const { knowledgeCSV, analyticsCSV } = await exportToCSV();
        return { status: 200, body: { knowledgeCSV, analyticsCSV } };
      }
      break;
    }

    case '/api/publish': {
      if (req.method === 'POST') {
        // The system never publishes by itself — this button only records that the owner posted it,
        // and only for an approved version whose file has not been edited
        const { jobId } = body;
        if (!isOwnerChannel(req)) return { status: 403, body: { error: 'This must be recorded from the OBA web page' } };
        const job = await loadJob(jobId);
        const approval = approvalStatus(job, await readDeliverable(job));
        if (!approval?.valid) return { status: 409, body: { error: 'Only an approved version whose file has not been edited since approval can be recorded as posted' } };
        if (job.publishedAt) return { status: 409, body: { error: 'This job was already recorded as posted' } };
        // Fact gate before recording: if items remain that were not found in the sources, the owner must confirm they checked them
        const audit = await runFactAudit(job, (await readDeliverable(job)).content);
        if (audit.summary.flagged > 0 && body.factCheckAcknowledged !== true) {
          return { status: 409, body: { error: `${audit.summary.flagged} item(s) were not found in the sources by the system — read fact_check.md and confirm you checked them yourself before recording`, needsAck: true, flagged: audit.summary.flagged } };
        }
        if (audit.summary.flagged > 0) job.factCheckAcknowledged = { flagged: audit.summary.flagged, at: new Date().toISOString() };
        job.publishedAt = new Date().toISOString();
        await saveJob(job);
        const analytics = await markPublished(jobId);
        return { status: 200, body: { analytics, publishedAt: job.publishedAt } };
      }
      break;
    }

    default: {
      // /api/export-formats/:jobId
      const exportsMatch = url.pathname.match(/^\/api\/export-formats\/([^/]+)$/);
      if (exportsMatch && req.method === 'GET') {
        if (!isValidJobId(exportsMatch[1])) return { status: 400, body: { error: 'Invalid jobId' } };
        const exports = await getExports(exportsMatch[1]);
        return { status: 200, body: { exports } };
      }

      // /api/jobs/:id/deliverable and /api/jobs/:id/decision (Human Gate)
      const gate = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(deliverable|decision|factcheck|recheck|versions|webcode)$/);
      if (gate) {
        const [, jobId, action] = gate;
        if (!isValidJobId(jobId)) return { status: 400, body: { error: 'Invalid jobId' } };
        const job = await loadJob(jobId);
        // A job that passed the checks but was created before the Human Gate existed: create the review file the first time
        // (old jobs with status 'complete' never passed the evidence checks, so they are not created — they must be run again)
        if (!job.deliverable && job.stages.channels?.result && ['ready_for_review', 'needs_revision'].includes(job.status)) {
          await writeDeliverable(job);
          await saveJob(job);
        }
        const deliverable = await readDeliverable(job);

        // Fact check in code (no AI call): GET = the review file · POST {text} = text the owner pasted
        if (action === 'factcheck') {
          if (req.method !== 'GET' && req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
          if (!deliverable?.content) return { status: 404, body: { error: 'There is no review file to check yet' } };
          const pasted = req.method === 'POST' && typeof body?.text === 'string' ? body.text.trim() : '';
          // deep=1: search for a second source + Fact Check Tools (a small search cost, the user clicks it) · omitted = code-only check
          const deep = url.searchParams.get('deep') === '1' || body?.deep === true;
          const run = deep ? runDeepFactAudit : runFactAudit;
          const report = await run(job, pasted || deliverable.content, { edited: !!pasted });
          return { status: 200, body: report };
        }

        // Web category code: GET = the value suggested from the Pillar + the value the editor chose · POST {code} = the editor chooses / edits (owner channel only)
        if (action === 'webcode') {
          const pillar = job.stages.brief?.result?.pillar || '';
          if (req.method === 'GET') {
            return { status: 200, body: { pillar, suggestion: suggestWebCode(pillar), chosen: job.webCode || null, codes: WEB_CODES } };
          }
          if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
          if (!isOwnerChannel(req)) return { status: 403, body: { error: 'This must be chosen from the OBA web page' } };
          const code = String(body?.code || '').toUpperCase();
          const problem = validateWebCode(code, pillar);
          if (problem) return { status: 400, body: { error: problem } };
          job.webCode = { code, pillar, setAt: new Date().toISOString() };
          await saveJob(job);
          // Always stored as a pair so the web-upload step can read it (web file header: cat + pillar)
          await writeFile(join(jobDir(job.id), 'web_meta.json'), JSON.stringify({ pillar, cat: code, note: 'The code is the value the editor chose — draft 2 of the mapping table' }, null, 2), 'utf-8');
          return { status: 200, body: { chosen: job.webCode } };
        }

        // Copies of every review version: GET = the list · GET ?from=1&to=2 = paragraph-by-paragraph diff (to=current is the current version)
        if (action === 'versions') {
          if (req.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } };
          // A job from before the copy system existed: keep the current version for it (if the file is still the one the system made)
          if (deliverable?.intact && deliverable.content) await snapshotVersion(job, deliverable.content);
          const from = url.searchParams.get('from'), to = url.searchParams.get('to');
          if (from && to) {
            const num = v => (v === 'current' ? deliverable?.version : Number(v));
            const [a, b] = [await readVersion(job, num(from)), await readVersion(job, num(to))];
            if (a === null || b === null) return { status: 404, body: { error: 'The requested version copy was not found' } };
            const ops = diffParagraphs(a, b);
            return { status: 200, body: { from: num(from), to: num(to), summary: diffSummary(ops), ops } };
          }
          const versions = (await listVersions(job)).map(v => ({
            ...v, decisions: (job.decisions || []).filter(d => d.version === v.version).map(d => ({ decision: d.decision, decidedBy: d.decidedBy, decidedAt: d.decidedAt, note: d.note }))
          }));
          return { status: 200, body: { versions, current: deliverable?.version || null } };
        }

        // Re-check sources after approval / publication: open the links again and compare with the stored copy
        if (action === 'recheck') {
          if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
          if (job.status !== 'approved') return { status: 409, body: { error: 'Sources can be re-checked only for an approved job' } };
          const entry = await recheckSources(job);
          await saveJob(job);
          return { status: 200, body: entry };
        }

        if (action === 'deliverable' && req.method === 'GET') {
          if (!deliverable) return { status: 404, body: { error: 'There is no review file yet' } };
          return { status: 200, body: { deliverable, approval: approvalStatus(job, deliverable), decisions: job.decisions || [] } };
        }

        if (action === 'decision' && req.method === 'POST') {
          if (!isOwnerChannel(req)) {
            return { status: 403, body: { error: 'A decision must come from the owner\'s OBA web page only' } };
          }
          const problem = validateDecision(job, deliverable, body);
          if (problem) return { status: 409, body: { error: problem } };

          const entry = recordDecision(job, deliverable, body, req);
          if (body.decision === 'approve') job.status = 'approved';
          if (body.decision === 'cancel') job.status = 'cancelled';
          if (body.decision === 'revise') {
            // Feed the owner's instruction + the latest blockers from the final stage (sentence + problem + fix) in as
            // must-fix items, then revise sentence by sentence from the existing draft and re-check
            const blockers = (job.stages.final?.result?.blockers || []).map(b => ({
              kind: b.kind || 'blocker', section: b.section || '', sentence: b.sentence || '',
              problem: b.problem || '', fix: b.fix || '', blocking: true
            }));
            const ownerItem = { kind: 'owner_request', section: '', sentence: '', problem: `The owner asked for this change: ${entry.note}`, fix: entry.note, blocking: true };
            job.reviewFeedback = {
              summary: `The owner asked for this change: ${entry.note}` + (blockers.length ? ` (and ${blockers.length} must-fix item(s) left over from the checks)` : ''),
              issues: [`owner_request: ${entry.note}`, ...blockers.map(b => `${b.kind}: ${b.problem}`)],
              items: [ownerItem, ...blockers],
              wordCount: job.stages.review?.result?.wordCount || 0,
              wordRange: job.stages.review?.result?.wordRange
            };
            job.revision = 1;
            job.ownerRevisions = (job.ownerRevisions || 0) + 1;
            job.status = 'processing';
          }
          await saveJob(job);
          if (body.decision === 'revise') runPipeline(jobId, { fromStage: 'write' }).catch(console.error);
          return { status: 200, body: { decision: entry, status: job.status } };
        }
        return { status: 405, body: { error: 'Method not allowed' } };
      }

      // /api/jobs/:id
      const match = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (match) {
        const jobId = match[1];
        if (!isValidJobId(jobId)) return { status: 400, body: { error: 'Invalid jobId' } };
        if (req.method === 'GET') {
          const job = await loadJob(jobId);
          // Make sure tokenUsage is in the response
          if (!job.tokenUsage) {
            job.tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 };
          }
          job.dir = jobDir(jobId);
          return { status: 200, body: { job } };
        }
        if (req.method === 'DELETE') {
          const success = await deleteJob(jobId);
          return { status: success ? 200 : 500, body: { success } };
        }
      }
    }
  }

  return { status: 404, body: { error: 'Not found' } };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 12 * 1024 * 1024; // pasted transcripts and imports can be large; beyond this the request is ignored

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { req.destroy(); resolve({}); return; }
      data += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

async function listJobs() {
  let dirs = [];
  try { dirs = await readdir(JOBS_DIR); } catch { return []; }   // a fresh install has no data folder yet
  const jobs = [];
  for (const d of dirs) {
    try {
      const state = JSON.parse(await readFile(join(JOBS_DIR, d, 'state.json'), 'utf-8'));
      jobs.push({
        id: state.id,
        topic: state.topic,
        status: state.status,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt
      });
    } catch {}
  }
  return jobs.reverse();
}
