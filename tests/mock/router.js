/* Top-level dispatcher: takes one HTTP-shaped request description and
   routes it to the auth engine, generic REST engine, or dungeon RPC engine.
   Used from two places against the SAME store instance so state never
   drifts apart: (1) Playwright page.route() interception of calls to the
   real Supabase project domain, and (2) the in-process invocation of the
   real api/claim-idle-offline-progress.js handler (its outbound fetch()
   calls get monkeypatched to call this router directly, see
   offline-progress-handler.js). */

const { handleAuthRequest, resolveBearerUser } = require('./auth-engine');
const { handleRestRequest } = require('./rest-engine');
const { handleRpcRequest } = require('./rpc-engine');

function route(store, { method, url, headers, body }) {
  const parsed = new URL(url, 'http://qa-mock.internal');
  const pathname = parsed.pathname;
  const searchParams = parsed.searchParams;
  headers = headers || {};

  if (pathname.startsWith('/auth/v1/')) {
    return handleAuthRequest(store, { method, pathname, searchParams, body, headers });
  }

  if (pathname.startsWith('/rest/v1/rpc/')) {
    const fnName = pathname.slice('/rest/v1/rpc/'.length);
    const user = resolveBearerUser(store, headers);
    if (!user) return { status: 401, json: { message: 'not_authenticated' } };
    return handleRpcRequest(store, user.id, fnName, body);
  }

  if (pathname.startsWith('/rest/v1/')) {
    const tableName = pathname.slice('/rest/v1/'.length);
    return handleRestRequest(store, { method, tableName, searchParams, body, headers });
  }

  /* Realtime (WebSocket combat-tick/raid broadcast channels, see CLAUDE.md's
     2026-07-20 overage incident) - out of Stage-1 scope, but the client
     library also fires a plain HTTP broadcast fallback call on the same
     REST host. A harmless no-op ack keeps it from surfacing as a console
     error; the actual realtime *behavior* (live updates from other tabs)
     is not simulated by this mock. */
  if (pathname.startsWith('/realtime/v1/')) {
    return { status: 200, json: {} };
  }

  return { status: 404, json: { message: 'unknown_mock_route', pathname } };
}

module.exports = { route };
