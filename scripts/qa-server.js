#!/usr/bin/env node
/* Standalone local QA/mock dev server (Testgrundlage Phase 1, 24.07.2026 -
   see CLAUDE.md). Serves the repo root exactly as it is (no build step) PLUS
   a full local mock of Supabase Auth/REST/RPC (reusing tests/mock/, the same
   mock the Playwright suite already trusts - see tests/mock/server.js's file
   header comment). NEVER talks to the real Supabase project - there is no
   code path in tests/mock/ that can reach the network.

   Usage:
     node scripts/qa-server.js [--teststand=A|B|C|D|E] [--port=4173]
     npm run qa:server -- --teststand=B

   Open the printed URL with ?qa=1 appended (the server prints the full URL
   already). Stop with Ctrl+C. */

const { createStore, seedStore } = require('../tests/mock/store');
const { createTestServer } = require('../tests/mock/server');
const { TESTSTANDS, QA_PASSWORD } = require('../tests/fixtures/teststands');

function parseArgs(argv) {
  const out = { teststand: 'A', port: 4173 };
  argv.forEach(arg => {
    const m = /^--([a-z]+)=(.+)$/.exec(arg);
    if (!m) return;
    if (m[1] === 'teststand') out.teststand = m[2].toUpperCase();
    if (m[1] === 'port') out.port = Number(m[2]) || out.port;
  });
  return out;
}

async function main() {
  const { teststand, port } = parseArgs(process.argv.slice(2));
  const factory = TESTSTANDS[teststand];
  if (!factory) {
    console.error(`Unbekannter Teststand "${teststand}" - erwartet einer von ${Object.keys(TESTSTANDS).join(', ')}`);
    process.exit(1);
  }

  const startTimeMs = Date.now();
  const store = createStore(startTimeMs);
  const fixture = factory(startTimeMs);
  seedStore(store, fixture);

  const server = createTestServer(store, { initialTeststand: teststand, teststandFactories: TESTSTANDS });
  let baseURL;
  try {
    baseURL = await server.listen(port);
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${port} ist bereits belegt - laeuft schon ein QA-Server? Anderen Port mit --port=... waehlen.`);
      process.exit(1);
    }
    throw err;
  }

  console.log('');
  console.log('=== BKMP lokaler QA-/Mock-Server ===');
  console.log(`Website (QA-Modus):  ${baseURL}/?qa=1`);
  console.log(`Teststand:           ${teststand} (Anzeigename: "${fixture.displayName}")`);
  console.log(`Login-Passwort:      ${QA_PASSWORD}  (fuer ALLE Teststaende gleich)`);
  console.log('Datenbank:           NUR dieser lokale Mock, niemals das echte Supabase-Projekt.');
  console.log('Beenden:             Strg+C');
  console.log('');
  console.log('Das im Browser geoeffnete QA-Kontrollfenster (unten rechts) kann direkt');
  console.log('einen anderen Teststand laden/zuruecksetzen - kein Neustart dieses Servers noetig.');
  console.log('');

  const shutdown = async () => {
    console.log('\nQA-Server wird beendet...');
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('QA-Server konnte nicht gestartet werden:', err);
  process.exit(1);
});
