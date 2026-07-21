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

function createStore(startTimeMs) {
  const clock = createClock(startTimeMs);
  return {
    clock,
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
