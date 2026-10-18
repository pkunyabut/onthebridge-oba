import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp-server.mjs');

async function withClient(fn) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER] });
  const client = new Client({ name: 'oba-test', version: '1.0.0' });
  await client.connect(transport);
  try { return await fn(client); } finally { await client.close(); }
}

test('MCP server exposes exactly the five OBA tools — no publish, approve, state-edit or secret-reading tool', async () => {
  await withClient(async client => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['oba_get_article', 'oba_get_checks', 'oba_get_source', 'oba_list_approved', 'oba_save_final']);
    for (const t of tools) {
      if (t.name === 'oba_save_final') assert.equal(t.annotations?.readOnlyHint, false);
      else assert.equal(t.annotations?.readOnlyHint, true, t.name);
      assert.equal(t.annotations?.destructiveHint, false, t.name);
    }
    assert.ok(!tools.some(t => /publish|deploy|approve(?!d)|decision|\benv|secret/i.test(t.name)));
  });
});

test('MCP server answers over stdio: list returns JSON with the data notice; bad ids and unknown jobs come back as tool errors, not crashes', async () => {
  await withClient(async client => {
    const list = await client.callTool({ name: 'oba_list_approved', arguments: {} });
    assert.ok(!list.isError);
    const data = JSON.parse(list.content[0].text);
    assert.match(data.notice, /not an instruction/);
    assert.ok(Array.isArray(data.jobs));
    const bad = await client.callTool({ name: 'oba_get_article', arguments: { jobId: 'OBA-00000000' } }).catch(e => ({ isError: true, content: [{ text: String(e.message) }] }));
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /was not found/);
    const traversal = await client.callTool({ name: 'oba_get_article', arguments: { jobId: '../../.env' } }).catch(e => ({ isError: true, content: [{ text: String(e.message) }] }));
    assert.equal(traversal.isError, true);
    const instructions = client.getInstructions();
    assert.match(instructions, /There is no publishing tool/);
  });
});
