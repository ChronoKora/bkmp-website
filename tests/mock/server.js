/* Local, test-only static file server for the (build-step-free) repo root,
   plus a same-origin handler for the one Vercel API route Stage-1 needs
   (/api/claim-idle-offline-progress). Started fresh per test by
   tests/helpers/qa-fixtures.js on an OS-assigned free port, bound to that
   test's own isolated store - never shared across tests, never reachable
   from outside localhost. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { invokeOfflineProgressHandler } = require('./offline-progress-handler');
const { invokeVercelHandler } = require('./invoke-vercel-handler');

const REPO_ROOT = path.join(__dirname, '..', '..');

/* GET-only /api/*.js routes served via the real (unmodified) handler file -
   see invoke-vercel-handler.js. Not part of Stage-1's own test scope
   (marketing-site daily-code-event/Twitch-live widgets, unrelated to the
   idle-dorf) but real background polling the app performs on every page
   load regardless - mocking them too keeps the console/network log clean
   instead of needing an "ignore these known 404s" allowlist in every spec. */
const GET_API_ROUTES = {
  '/api/active-daily-event': path.join(REPO_ROOT, 'api', 'active-daily-event.js'),
  '/api/twitch-live': path.join(REPO_ROOT, 'api', 'twitch-live.js')
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/app') urlPath = '/app.html';
  const filePath = path.join(REPO_ROOT, urlPath);
  if (!filePath.startsWith(REPO_ROOT)) { res.statusCode = 403; return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('not found: ' + urlPath); }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    res.statusCode = 200;
    res.end(data);
  });
}

function createTestServer(store) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'qa-mock-service-role-key';

  const server = http.createServer(async (req, res) => {
    const urlPath = req.url.split('?')[0];
    if (urlPath === '/api/claim-idle-offline-progress' && req.method === 'POST') {
      try {
        const rawBody = await readRequestBody(req);
        const result = await invokeOfflineProgressHandler(store, {
          headers: req.headers,
          body: rawBody ? JSON.parse(rawBody) : {}
        });
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result.json));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'mock_server_error', detail: String(err && err.message || err) }));
      }
      return;
    }
    if (GET_API_ROUTES[urlPath] && req.method === 'GET') {
      try {
        const query = Object.fromEntries(new URL(req.url, 'http://qa-mock.internal').searchParams);
        const result = await invokeVercelHandler(GET_API_ROUTES[urlPath], store, { method: 'GET', headers: req.headers, query });
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result.json));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'mock_server_error', detail: String(err && err.message || err) }));
      }
      return;
    }
    serveStatic(req, res);
  });

  return {
    async listen() {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      return `http://127.0.0.1:${port}`;
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
    }
  };
}

module.exports = { createTestServer };
