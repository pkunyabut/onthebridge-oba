import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { ROOT_DIR } from './paths.mjs';

// The PDF reader (pdfjs-dist 6) needs features that only exist in Node 22 and newer; fail early with a clear message
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`OBA needs Node.js 22 or newer (this is ${process.versions.node}). Download it from https://nodejs.org`);
  process.exit(1);
}

// Load API keys from the project's .env (if there is one) before loading modules that call an AI
try { process.loadEnvFile(join(ROOT_DIR, '.env')); } catch {}

const { handleAPI } = await import('./core.mjs');

// A fresh clone has no data folder; create it so the first job can be written
const { mkdir } = await import('node:fs/promises');
await mkdir(join(ROOT_DIR, 'data', 'jobs'), { recursive: true });

let port = Number(process.env.PORT) || 8080;

// Accept only requests from OBA's own web page, so no other website in the browser can call the API across.
// (No CORS header is sent, so no other site can read a result, and the Host is checked against DNS rebinding.)
// The server listens on 127.0.0.1 only — never expose it to a network: there is no login.
function isLocalRequest(req) {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !allowedHosts.some(h => origin === `http://${h}`)) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return true;
}

// Sent on every response. frame-ancestors / X-Frame-Options stop another page from framing the OBA page and
// tricking a click on the Human Gate buttons (clickjacking).
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer'
};

const server = createServer(async (req, res) => {
  try {
    if (!isLocalRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // API routes
    if (url.pathname.startsWith('/api/')) {
      const result = await handleAPI(req, url);
      res.writeHead(result.status, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify(result.body));
      return;
    }

    // Static files
    const publicDir = join(ROOT_DIR, 'public');
    let relative;
    try { relative = decodeURIComponent(url.pathname); } catch { relative = ''; }
    const filePath = join(publicDir, url.pathname === '/' ? 'index.html' : relative);
    if (!relative || !filePath.startsWith(publicDir + sep)) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not found');
      return;
    }
    try {
      const content = await readFile(filePath);
      const ext = filePath.split('.').pop();
      const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
      res.writeHead(200, {
        'Content-Type': types[ext] || 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...SECURITY_HEADERS
      });
      res.end(content);
    } catch {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not found');
    }
  } catch (err) {
    console.error('Server error:', err.message);
    res.writeHead(500, SECURITY_HEADERS);
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${port} in use, trying ${port + 1}...`);
    port += 1;
    server.listen(port, '127.0.0.1');
  }
});

server.on('listening', () => {
  console.log(`OnTheBridge OBA running at http://127.0.0.1:${port}`);
});

server.listen(port, '127.0.0.1');

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err?.message || err);
});
