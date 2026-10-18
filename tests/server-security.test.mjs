import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.mjs');
const PORT = 20000 + Math.floor(Math.random() * 20000);
let child;

// A raw request so that the Host and Origin headers can be set freely
function raw(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, path, method, headers: { Host: `127.0.0.1:${PORT}`, ...headers } }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await raw('/'); return; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('the server did not start');
});
after(() => { child?.kill(); });

test('the page and the API answer on 127.0.0.1 and every response carries the anti-framing headers', async () => {
  const page = await raw('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /OnTheBridge OBA/);
  const api = await raw('/api/jobs');
  assert.equal(api.status, 200);
  for (const r of [page, api]) {
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  }
});

test('a request from another website (foreign Origin or cross-site fetch) is refused', async () => {
  assert.equal((await raw('/api/jobs', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await raw('/api/jobs', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});

test('a wrong Host header (DNS rebinding) is refused', async () => {
  assert.equal((await raw('/api/jobs', { headers: { Host: 'attacker.example' } })).status, 403);
  assert.equal((await raw('/api/jobs', { headers: { Host: `attacker.example:${PORT}` } })).status, 403);
});

test('a decision cannot be recorded without the browser headers of the owner channel', async () => {
  const noOrigin = await raw('/api/jobs/OBA-00000000/decision', { method: 'POST' });
  assert.notEqual(noOrigin.status, 200);
  const publish = await raw('/api/publish', { method: 'POST' });
  assert.equal(publish.status, 403);
});

test('static files cannot escape the public folder', async () => {
  for (const path of ['/..%2f..%2fpackage.json', '/%2e%2e/package.json', '/..%5csrc%5cserver.mjs', '/%00']) {
    assert.ok([400, 404].includes((await raw(path)).status), path);
  }
  assert.equal((await raw('/package.json')).status, 404);
});
