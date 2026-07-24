/* In-memory stand-in for the whole Supabase backend (Auth + Postgres/
   PostgREST tables). One store instance == one isolated "QA-Modus" backend;
   tests/helpers/qa-fixtures.js creates a brand-new one per test so tests
   never share state or depend on execution order.

   This is NOT a partial mock bolted onto the real Supabase project - no
   test ever talks to zgknyrwzpohvfdweomxf.supabase.co. Everything here is
   local, resettable, and thrown away when the test ends. */

const { createClock } = require('./clock');

let idCounter = 1;
function nextId() { return idCounter++; }

/* Phase 3 (24.07.2026, siehe CLAUDE.md) - deterministischer, seedbarer PRNG
   (mulberry32, gleiche winzige Implementierung wie tests/e2e/soak.spec.js -
   kein neues Paket) fuer RPCs, die serverseitig echtes random() nutzen
   (aktuell nur arena_attack(), siehe rpc-engine.js). Ohne Seed (Standardfall,
   z.B. alle bestehenden Dungeon-Tests) faellt store.rng() auf echtes
   Math.random() zurueck - null Verhaltensaenderung fuer jeden Test, der das
   nicht braucht. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createStore(startTimeMs, rngSeed) {
  const clock = createClock(startTimeMs);
  const rng = typeof rngSeed === 'number' ? mulberry32(rngSeed) : Math.random;
  return {
    clock,
    rng,
    tables: Object.create(null),
    authUsersByEmail: new Map(), // email -> { id, email, password, user_metadata }
    sessionsByAccessToken: new Map(), // access_token -> { userId, refreshToken, expiresAtMs }
    sessionsByRefreshToken: new Map(), // refresh_token -> access_token
    nextId
  };
}

function table(store, name) {
  if (!store.tables[name]) store.tables[name] = [];
  return store.tables[name];
}

/* Seeds a fresh store from a fixture object shaped like:
   { users: [{name,email,password,id}], tables: { idle_player_state: [...], ... }, startTimeMs } */
function seedStore(store, fixture) {
  store.tables = Object.create(null);
  store.authUsersByEmail.clear();
  store.sessionsByAccessToken.clear();
  store.sessionsByRefreshToken.clear();
  if (typeof fixture.startTimeMs === 'number') store.clock.setNow(fixture.startTimeMs);
  (fixture.users || []).forEach(u => {
    store.authUsersByEmail.set(u.email, {
      id: u.id,
      email: u.email,
      password: u.password,
      user_metadata: u.user_metadata || {}
    });
  });
  Object.keys(fixture.tables || {}).forEach(tableName => {
    store.tables[tableName] = (fixture.tables[tableName] || []).map(row => ({ ...row }));
  });
}

module.exports = { createStore, table, seedStore };
