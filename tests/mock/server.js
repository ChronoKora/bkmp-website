/* Local, test-only static file server for the (build-step-free) repo root,
   plus a same-origin handler for the one Vercel API route Stage-1 needs
   (/api/claim-idle-offline-progress). Started fresh per test by
   tests/helpers/qa-fixtures.js on an OS-assigned free port, bound to that
   test's own isolated store - never shared across tests, never reachable
   from outside localhost.

   Extended 24.07.2026 (QA-Grundlage Phase 1, see CLAUDE.md) to ALSO double
   as a standalone, persistent local dev server (started via
   scripts/qa-server.js, not per-Playwright-test) that a real browser can
   point at directly. Two additions, both only reachable on 127.0.0.1:
     1. A generic /auth/v1|/rest/v1|/realtime/v1 passthrough to the SAME
        router.js used by Playwright's context.route() interception - so a
        plain browser whose supabase.js has been pointed at this server's
        origin (see supabase.js's window.BKMP_QA_MODE branch) gets the exact
        same mocked backend Playwright tests already trust, no second mock
        implementation.
     2. Two dev-only /__qa__/* endpoints the QA control panel
        (js/dev/bkmp-qa-panel.js) calls: status/reseed. These endpoints do
        not exist in production and are never proxied there (not under
        /api/, vercel.json does not deploy this directory). Deliberately NO
        /__qa__/patch-state (an earlier version had one): patching a player
        row directly in the DB while that player's own tab is still open
        loses the race against the game's own normal save loop, which keeps
        pushing its (unaware, stale) in-memory copy back over the patch
        within seconds - found by testing this manually in a real browser,
        not guessed. The panel instead mutates the already-loaded
        bkmpIdleState in place and flushes it through the game's own real
        save path (bkmpIdleFlushSyncNow()) - see the panel file for the
        full writeup. */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { invokeOfflineProgressHandler } = require('./offline-progress-handler');
const { invokeVercelHandler } = require('./invoke-vercel-handler');
const { route: mockRoute } = require('./router');
const { seedStore } = require('./store');

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

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function createTestServer(store, opts) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'qa-mock-service-role-key';
  /* Only used by the standalone QA server (scripts/qa-server.js) - Playwright
     never calls /__qa__/* and never passes opts, so this stays undefined
     (and thus invisible) for every existing test. */
  let currentTeststand = (opts && opts.initialTeststand) || null;
  const teststandFactories = (opts && opts.teststandFactories) || null;

  const server = http.createServer(async (req, res) => {
    const urlPath = req.url.split('?')[0];

    /* Dev-only QA control endpoints (js/dev/bkmp-qa-panel.js). Not part of
       the real Supabase-shaped API surface, never reachable except through
       this local, 127.0.0.1-only server - see file header comment. */
    if (urlPath === '/__qa__/status' && req.method === 'GET') {
      return jsonResponse(res, 200, {
        ok: true,
        teststand: currentTeststand,
        simulatedNowIso: store.clock.nowIso(),
        simulatedNowMs: store.clock.nowMs()
      });
    }
    if (urlPath === '/__qa__/reseed' && req.method === 'POST') {
      if (!teststandFactories) return jsonResponse(res, 500, { error: 'reseed_not_configured' });
      try {
        const rawBody = await readRequestBody(req);
        const parsed = rawBody ? JSON.parse(rawBody) : {};
        const teststandId = String(parsed.teststand || 'A').toUpperCase();
        const factory = teststandFactories[teststandId];
        if (!factory) return jsonResponse(res, 400, { error: 'unknown_teststand', teststand: teststandId });
        seedStore(store, factory(Date.now()));
        currentTeststand = teststandId;
        return jsonResponse(res, 200, { ok: true, teststand: teststandId });
      } catch (err) {
        return jsonResponse(res, 500, { error: 'reseed_failed', detail: String(err && err.message || err) });
      }
    }
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

    /* Generic Supabase-shaped passthrough - only exercised when a browser's
       supabase.js has been pointed at THIS server's own origin (QA mode),
       never during a normal Playwright run (those intercept the real
       supabase.co domain directly via context.route(), see
       tests/helpers/qa-fixtures.js - this codepath and that one both end up
       calling the exact same router.js, so behavior never drifts apart). */
    if (urlPath.startsWith('/auth/v1/') || urlPath.startsWith('/rest/v1/') || urlPath.startsWith('/realtime/v1/')) {
      try {
        const rawBody = await readRequestBody(req);
        let body;
        if (rawBody) {
          try { body = JSON.parse(rawBody); } catch (e) { body = rawBody; }
        }
        const result = mockRoute(store, { method: req.method, url: req.url, headers: req.headers, body });
        return jsonResponse(res, result.status, result.json);
      } catch (err) {
        return jsonResponse(res, 500, { error: 'mock_server_error', detail: String(err && err.message || err) });
      }
    }

    serveStatic(req, res);
  });

  /* Minimal, protocol-valid WebSocket handshake for /realtime/v1/websocket -
     supabase-js's Realtime client (combat-tick/raid broadcast channels)
     always attempts this connection on init, real network or not. Without
     answering the upgrade at all, a plain browser sees a real "WebSocket
     handshake failed" console error (this server would otherwise just
     answer the plain HTTP handler above with a 200, which is an invalid
     response to an Upgrade request) - found via the QA smoke test's own
     "no console errors" assertion, not anticipated up front. Deliberately
     minimal: completes the handshake (RFC 6455 Sec-WebSocket-Accept), then
     stays silently connected - no framing/message handling. Matches the
     REST realtime fallback's existing "harmless no-op ack" philosophy
     (see the /realtime/v1/ branch in router.js): actual live-broadcast
     behavior between browser tabs is NOT simulated by this mock, same as
     documented there. */
  /* http.Server.close()'s callback only fires once every open connection has
     ended - a silently-kept-open WS socket (see above) would otherwise hang
     close() forever (found via the QA smoke test's own teardown timing out,
     not anticipated up front). Track and force-destroy them on close()
     instead of waiting for a client-initiated close that never comes.

     Erweitert 24.07.2026 (Sicherheitsverstaerkung vor Phase-3-Abschluss,
     siehe CLAUDE.md): network-guard.js routet jetzt auch WebSockets ueber
     context.routeWebSocket()/connectToServer() - das haengt fuer erlaubte
     Hosts eine ZUSAETZLICHE, von PLAYWRIGHT SELBST (nicht vom Browser)
     aufgebaute Proxy-Verbindung zwischen sich und diesem Server. Beendet ein
     sehr kurzlebiger Test (page.goto() + sofort evaluate() + Testende) die
     Seite, WAEHREND dieser Handshake noch mitten im TCP-Connect/HTTP-Upgrade
     haengt (auf WebKit/mobile-large reproduziert, auf Chromium nicht), war
     dieser Socket zum Zeitpunkt von close() noch NICHT im 'upgrade'-Handler
     unten registriert - openRealtimeSockets blieb leer, http.Server.close()
     wartete dadurch endlos auf genau diese eine, nie fertig verhandelte
     Verbindung (Testfehler: "Tearing down 'qaServer' exceeded the test
     timeout", "Error: read ECONNRESET"). Fix: JEDE rohe TCP-Verbindung wird
     jetzt schon beim Verbindungsaufbau selbst erfasst (server.on
     ('connection', ...), nicht erst nach einem abgeschlossenen Upgrade) -
     server.close() zerstoert damit auch mitten im Handshake haengende
     Verbindungen zuverlaessig. */
  const openSockets = new Set();
  server.on('connection', (socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });
  server.on('upgrade', (req, socket) => {
    if (!req.url.startsWith('/realtime/v1/')) { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    // Silent no-op connection - see comment above. Bleibt zusaetzlich in
    // openSockets erfasst (schon beim 'connection'-Event eingetragen).
  });

  return {
    async listen(port) {
      await new Promise(resolve => server.listen(port || 0, '127.0.0.1', resolve));
      const boundPort = server.address().port;
      return `http://127.0.0.1:${boundPort}`;
    },
    async close() {
      openSockets.forEach(socket => socket.destroy());
      openSockets.clear();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

module.exports = { createTestServer };
