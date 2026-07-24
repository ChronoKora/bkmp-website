/* Sicherheitsverstaerkung vor Phase-3-Abschluss (24.07.2026, siehe CLAUDE.md) -
   zentrale, EINE-Datei-Netzwerksperre fuer die gesamte Playwright-Suite.

   Ausloeser: arena.spec.js's erste Fassung navigierte einmal ohne ?qa=1 und
   erreichte dadurch kurz den echten Produktions-Supabase-Host (401, kein
   Schaden - siehe CLAUDE.md). Bis dahin war "kein Produktionskontakt" reine
   Testdisziplin (jede Datei musste ?qa=1 selbst richtig setzen). Dieses
   Modul macht einen Produktionskontakt stattdessen STRUKTURELL unmoeglich,
   unabhaengig davon, ob ein Test ?qa=1 vergisst, die falsche Fixture nutzt,
   oder schlicht falsch geschrieben ist.

   Mechanik: die `context`-Fixture wird HIER, an der Wurzel, um eine
   deny-by-default Route (HTTP via context.route + WebSocket via
   context.routeWebSocket) erweitert, BEVOR irgendein Test sie destrukturiert.
   Jede Datei, die ihr `test`/`expect` (direkt oder ueber tests/helpers/
   qa-fixtures.js, das seinerseits von hier erbt) aus DIESER Datei bezieht,
   bekommt die Sperre automatisch - kein Opt-in, kein "daran denken" noetig.
   Erlaubt sind ausschliesslich 127.0.0.1/localhost/::1 (jeder lokale
   Mock-Server dieser Suite) plus eine einzige, eng dokumentierte Ausnahme
   (minotar.net, siehe unten). Jede andere Anfrage - insbesondere an den
   echten Produktions-Host - wird sofort abgebrochen (route.abort, WebSocket
   sofort geschlossen OHNE echte Serververbindung) UND der Test schlaegt mit
   einer praezisen Fehlermeldung fehl (siehe context-Fixture unten).

   Host-basiert, nicht Pfad-basiert: die Sperre prueft nur den Hostnamen, nie
   den Pfad (/auth/v1, /rest/v1, /rpc/*, /storage/v1, /functions/v1, das
   Realtime-WebSocket, ...) - jede heutige UND jede kuenftige Supabase-API-
   Oberflaeche ist damit automatisch abgedeckt, ohne eine Pfadliste pflegen
   zu muessen.

   Bewusst NICHT abgedeckt: rohe Node-seitige fetch()-Aufrufe innerhalb einer
   Testdatei (z.B. guild.spec.js's rpcAs()-Helfer fuer einen zweiten
   Akteur) - die laufen ausserhalb des Browser-Kontexts, context.route()
   greift dort nicht. Strukturell trotzdem sicher: diese Aufrufe zielen in
   diesem Repo immer auf `qaServer.baseURL`, eine von createQaServer()/
   createTestServer() selbst erzeugte 127.0.0.1-Adresse - es gibt keinen
   Codepfad, der dort einen fremden Host einsetzen koennte. */

const base = require('@playwright/test');
const { createStore, seedStore } = require('../mock/store');
const { createTestServer } = require('../mock/server');
const { TESTSTANDS } = require('../fixtures/teststands');

const PROD_HOSTS = ['zgknyrwzpohvfdweomxf.supabase.co'];

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/* Einzige dokumentierte Ausnahme (zuerst gefunden+eng gefasst in
   qa-mode-security.spec.js, Phase 2, 24.07.2026): js/core/bkmp-site.js baut
   fuer den Spieler-Avatar ein <img src> gegen den oeffentlichen, zustands-
   losen Minecraft-Skin-Renderer minotar.net (Name -> Kopfbild). Voellig
   unabhaengig von Supabase, keine Konto-/Sitzungsdaten beteiligt (nur der
   ohnehin oeffentliche Anzeigename als URL-Teil). Jeder ANDERE externe Host
   bleibt strikt verboten. */
const ALLOWED_EXTRA_HOSTS = new Set(['minotar.net']);

function isAllowedHost(hostname) {
  return !!hostname && (ALLOWED_HOSTS.has(hostname) || ALLOWED_EXTRA_HOSTS.has(hostname));
}

function violationMessage(kind, url, index) {
  return `[network-guard] BLOCKED ${kind} request #${index} to a disallowed host: ${url}\n` +
    'Nur localhost/127.0.0.1/::1 (+ die dokumentierte minotar.net-Ausnahme, siehe ' +
    'tests/helpers/network-guard.js) sind aus einem Playwright-Test heraus erlaubt. ' +
    'Meist bedeutet das: ein Test ist ohne ?qa=1 navigiert (window.BKMP_QA_MODE hat nie ' +
    'aktiviert, supabase.js zeigte deshalb weiter auf das echte Produktionsprojekt) - ' +
    'siehe CLAUDE.md "Sicherheitsverstaerkung vor Phase-3-Abschluss".';
}

/* Merged immer ?qa=1 in die Ziel-URL, egal welche anderen Query-Parameter
   (z.B. &stand=B) schon gesetzt sind - der zentrale Baustein fuer Punkt 6
   des Auftrags ("neue Tests starten standardmaessig mit ?qa=1"). */
function qaUrl(baseURL, pathAndQuery) {
  const u = new URL(pathAndQuery || '/', baseURL);
  u.searchParams.set('qa', '1');
  return u.toString();
}

/* Eigenstaendiger Baustein fuer Tests mit eigenem Seed (z.B. arena.spec.js/
   guild.spec.js's Mehrspieler-Fixtures statt der TESTSTANDS-Taxonomie) - vor
   dieser Aenderung baute jede dieser Dateien createStore/seedStore/
   createTestServer/server.listen() einzeln selbst nach (6x fast identischer
   Code, jede Kopie ein eigenes Risiko, ?qa=1 beim naechsten manuellen goto()
   zu vergessen). `seedFn(store, startTimeMs)` muss den Store selbst fuellen
   (typischerweise per seedStore(store, irgendeineFixture(startTimeMs))). */
async function createQaServer(seedFn, opts) {
  const options = opts || {};
  const startTimeMs = options.startTimeMs || Date.now();
  const store = createStore(startTimeMs, options.rngSeed);
  seedFn(store, startTimeMs);
  const server = createTestServer(store, options.serverOptions);
  const baseURL = await server.listen();
  return {
    baseURL,
    store,
    url(pathAndQuery) { return qaUrl(baseURL, pathAndQuery); },
    async close() { await server.close(); }
  };
}

const test = base.test.extend({
  teststand: ['B', { option: true }],

  /* Gesammelte Verstoesse dieses Tests - normalerweise nur intern von der
     context-Fixture unten gelesen/geschrieben, aber bewusst als eigene
     Fixture exportiert: der Regressionstest (network-guard.spec.js) braucht
     direkten Zugriff, um NACH einer ABSICHTLICH ausgeloesten Blockade zu
     beweisen, dass sie wirklich stattfand, ohne den eigenen Test durch den
     automatischen Fehlschlag unten rot werden zu lassen (siehe dortiger
     Kommentar). */
  networkGuardViolations: async ({}, use) => {
    await use([]);
  },

  context: async ({ context, networkGuardViolations }, use) => {
    await context.route('**/*', (route) => {
      const req = route.request();
      let hostname;
      try { hostname = new URL(req.url()).hostname; } catch (e) { return route.continue(); }
      if (isAllowedHost(hostname)) return route.continue();
      networkGuardViolations.push(violationMessage(req.method(), req.url(), networkGuardViolations.length + 1));
      return route.abort('blockedbyclient');
    });

    /* Ohne connectToServer() verbindet ein gerouteter WebSocket sich laut
       Playwright-Doku NIE mit dem echten Server - fuer erlaubte Hosts muss
       das hier deshalb explizit nachgeholt werden (sonst wuerde z.B. der
       lokale Mock-Server unter 127.0.0.1 seinen eigenen Realtime-Handshake
       nie erreichen). Fuer nicht erlaubte Hosts bleibt genau dieses
       Standardverhalten (keine echte Verbindung) bestehen - schliesst die
       Route stattdessen sofort selbst. */
    await context.routeWebSocket(() => true, (ws) => {
      let hostname;
      try { hostname = new URL(ws.url()).hostname; } catch (e) { hostname = null; }
      if (isAllowedHost(hostname)) { ws.connectToServer(); return; }
      networkGuardViolations.push(violationMessage('WEBSOCKET', ws.url(), networkGuardViolations.length + 1));
      ws.close({ code: 4403, reason: 'blocked-by-network-guard' });
    });

    await use(context);

    if (networkGuardViolations.length) {
      throw new Error(
        `network-guard.js: ${networkGuardViolations.length} nicht erlaubte Netzwerkanfrage(n) waehrend dieses Tests:\n\n` +
        networkGuardViolations.join('\n\n')
      );
    }
  },

  /* Zentraler Standard-Server fuer neue, einfache Tests (Punkt 6 des
     Auftrags) - TESTSTANDS-basiert wie bisher qa-mode-smoke/qa-mode-security/
     soak/visual.spec.js es je einzeln nachgebaut hatten. Ein Test mit
     eigenem Mehrspieler-Seed (arena/guild-Stil) ueberschreibt `qaServer`
     weiterhin lokal per test.extend({ qaServer: async (...) => {...} }) -
     genau wie bisher, jetzt aber ueber createQaServer() statt eigenem
     createStore/seedStore/createTestServer-Bauplan. */
  qaServer: async ({ teststand }, use) => {
    const factory = TESTSTANDS[teststand];
    if (!factory) throw new Error(`Unbekannter Teststand "${teststand}" - erwartet einen von ${Object.keys(TESTSTANDS).join(', ')}`);
    const server = await createQaServer(
      (store, startTimeMs) => seedStore(store, factory(startTimeMs)),
      { serverOptions: { initialTeststand: teststand, teststandFactories: TESTSTANDS } }
    );
    // close() bewusst mit exponiert (nicht nur baseURL/store/url) - z.B.
    // network-guard.spec.js's "QA-Server nicht erreichbar"-Test schliesst
    // den Server absichtlich VORZEITIG selbst. createTestServer()s close()
    // ist idempotent (server.close() ein zweites Mal loest lediglich den
    // bereits erfuellten Promise erneut auf, kein Fehler) - der zweite
    // Aufruf hier unten bleibt deshalb in JEDEM Fall sicher.
    await use({ baseURL: server.baseURL, store: server.store, teststand, url: server.url, close: server.close });
    await server.close();
  }
});

const expect = base.expect;

module.exports = { test, expect, PROD_HOSTS, ALLOWED_HOSTS, ALLOWED_EXTRA_HOSTS, isAllowedHost, qaUrl, createQaServer };
