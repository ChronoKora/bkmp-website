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

/* 06.09.2026 (Fund beim Aufraeumen des Kartendatenbank-Admins/Teleport-
   Trackings, siehe CLAUDE.md): dieses Gate ging bisher davon aus, dass
   JEDE RPC einen echten eingeloggten Nutzer braucht - stimmt fuer die
   allermeisten (Spielstand/Runen/Gilde/...), aber NICHT fuer die paar
   bewusst "grant execute to anon, authenticated"-RPCs, die die normale,
   nicht eingeloggte Marketing-/Investoren-Seite selbst aufruft (Karten-
   Verkaufen-Statistik, Teleport-Tracking-Trending/-Statistik) - die
   laufen dort mit dem blossen Anon-Key, nie mit einem Nutzer-Token. Das
   Live-Backend erlaubt genau das per RLS/GRANT; dieses Mock-Gate tat es
   bisher nicht, mit dem Ergebnis, dass die Marketing-Seite (die auf JEDEM
   Seitenaufruf mitlaeuft, auch waehrend eines Idle-Dorf-Tests im
   Hintergrund) einen echten 401 bekam - sichtbar als Browser-eigener
   "Failed to load resource"-Konsolenfehler in etlichen, inhaltlich
   voellig unabhaengigen Navigations-Tests (56 Fehlschlaege, siehe
   CLAUDE.md-Eintrag). Kein App-Bug - das Mock-Gate war schlicht enger als
   das echte Backend. */
const PUBLIC_RPC_NAMES = new Set([
  'get_card_sale_public_stats',
  'get_card_sale_daily_earnings',
  'get_trending_cards',
  'get_card_teleport_stats',
]);

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
    if (!user && !PUBLIC_RPC_NAMES.has(fnName)) return { status: 401, json: { message: 'not_authenticated' } };
    return handleRpcRequest(store, user ? user.id : null, fnName, body);
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
