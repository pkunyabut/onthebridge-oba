// ─── OBA MCP server (stdio) — lets Claude do the final check before posting to Blockdit / the website ─────────────────
// Runs on the owner's machine only (no port is opened) · for installing in Claude Desktop / Claude Code see docs/MCP.md
// Only 5 tools: 4 that read (list, article, source, checks) + 1 that saves the ready-to-post version (writes only to the job's final/ folder)
// There is no publishing tool, no tool that edits state / approves / reads .env — the Human Gate belongs to the owner, through the web page only

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listApproved, getArticle, getSource, getChecks, saveFinal, CHANGE_TYPES, DATA_NOTICE } from './finalizer.mjs';

const INSTRUCTIONS = [
  'OBA = the article-writing system. These tools are for the final check before an article that has been "approved" is posted to Blockdit and the website.',
  'Order: oba_list_approved → oba_get_article (gives the Blockdit / web drafts the code prepared) → oba_get_checks → oba_get_source (use find to look up only the numbers / names / quotes you need to compare; do not read every whole source, it eats context) → edit → oba_save_final',
  'Rules: ' + DATA_NOTICE + ' · There is no publishing tool; never claim anything was posted · Every fact fix / addition needs a source · The result is saved as new files and the approved version is never overwritten · In the end the owner reviews the change report and posts it themselves'
].join('\n');

const asText = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const fail = e => ({ isError: true, content: [{ type: 'text', text: String(e?.message || e) }] });
const wrap = fn => async args => { try { return asText(await fn(args)); } catch (e) { return fail(e); } };
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function buildServer() {
  const server = new McpServer({ name: 'oba', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const jobId = z.string().regex(/^OBA-[0-9a-f]{8}$/, 'Job id in the form OBA-xxxxxxxx').describe('Job id, e.g. OBA-16bc26ee');

  server.registerTool('oba_list_approved', {
    title: 'List approved jobs', description: 'Jobs the owner approved whose file still matches the approved version, with the number of ready-to-post versions saved so far', inputSchema: {}, annotations: READ
  }, wrap(async () => ({ notice: DATA_NOTICE, jobs: await listApproved() })));

  server.registerTool('oba_get_article', {
    title: 'Get the approved article', description: 'The approved article (bound to its sha256) + the Blockdit draft (no [n] numbers) and the web draft (with [n] numbers) that the code prepared + the table of sources', inputSchema: { jobId }, annotations: READ
  }, wrap(({ jobId }) => getArticle(jobId)));

  server.registerTool('oba_get_source', {
    title: 'Get source text', description: 'The text of source N, in pieces (default 12,000 characters; use offset to keep reading), or pass find to search for a word / number / name and get only the text around each hit — use find first to save context', inputSchema: { jobId, n: z.number().int().min(1).max(50).describe('Source number as in the Sources list'), find: z.string().optional().describe('A word or number to compare with the source'), offset: z.number().int().min(0).optional(), maxChars: z.number().int().min(100).max(30000).optional() }, annotations: READ
  }, wrap(({ jobId, n, find, offset, maxChars }) => getSource(jobId, n, { find, offset, maxChars })));

  server.registerTool('oba_get_checks', {
    title: 'Get the system checks', description: 'The fact check done by code (fact_check.md), the observations of the AI reviewer, the evidence base, and the items the system flagged', inputSchema: { jobId }, annotations: READ
  }, wrap(({ jobId }) => getChecks(jobId)));

  const change = z.object({
    type: z.enum(CHANGE_TYPES).describe('fact_fix / addition need a source'),
    where: z.string().optional().describe('Location, e.g. a heading or paragraph'),
    before: z.string().optional(), after: z.string().optional(),
    reason: z.string().describe('The reason for the change'),
    source: z.string().optional().describe('A URL or "source N" — required for fact_fix and addition')
  });
  server.registerTool('oba_save_final', {
    title: 'Save the ready-to-post version (waiting for the owner\'s review)',
    description: 'Saves the Blockdit version + the web version + (optionally) an image-prompt set + the change list as new files in the job\'s final/ folder. It never overwrites the approved version and never publishes. If a fact_fix/addition has no source, the save is refused.',
    inputSchema: {
      jobId, baseSha256: z.string().describe('approvedSha256 from oba_get_article'),
      blockditMd: z.string().describe('The version for Blockdit (no [n] numbers in the body)'),
      webMd: z.string().describe('The version for the website (with [n] numbers)'),
      imagePromptsMd: z.string().optional(), changes: z.array(change).min(1), notes: z.string().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, wrap(args => saveFinal(args.jobId, args)));

  return server;
}

if (process.argv[1] && process.argv[1].split('\\').join('/').endsWith('/mcp-server.mjs')) {
  await buildServer().connect(new StdioServerTransport());
}
