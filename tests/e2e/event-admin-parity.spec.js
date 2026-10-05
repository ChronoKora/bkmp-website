/* Event-Analyse im Admin-Panel (05.10.2026) - Gleichheitsbeweis Nachbau <-> echtes SQL.

   Die Browser-Tests der Event-Analyse laufen gegen den JS-Nachbau
   (tests/mock/event-admin-engine.js), weil Postgres im Browser nicht verfuegbar ist.
   Damit dieser Nachbau nicht heimlich vom echten SQL abweicht, rechnen hier BEIDE
   mit exakt denselben Daten (die Tabellen werden aus der echten Postgres-Datenbank
   ausgelesen und in den Nachbau uebernommen) - jede Funktion, mehrere Szenarien,
   mehrere Sortierungen/Suchen - und muessen dasselbe liefern.

   Wer die SQL aendert, muss den Nachbau mitziehen - sonst wird dieser Test rot. */
const { test, expect } = require('@playwright/test');
const h = require('../helpers/pg-event-harness');
const f = require('../fixtures/event-admin-reference');
const { createStore, table: getTable } = require('../mock/store');
const { ADMIN_EVENT_HANDLERS: TWIN } = require('../mock/event-admin-engine');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Reine Logik-Tests laufen nur einmal (chromium-desktop).');
});

const ADMIN_UID = f.uid(900);
const ADMIN_EMAIL = 'chef@bkmp-admin-accounts.com';
const TABLES = ['special_events', 'player_event_progress', 'event_player_day_log', 'player_stats', 'dragon_species', 'event_admin_meta', 'player_event_reward_claims'];

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:\d{2})?)$/;
function toEpoch(text) {
  const fixed = /[+-]\d{2}$/.test(text) ? text + ':00' : text;
  return Date.parse(fixed);
}
/* Vergleichsform: Schluessel sortiert, Zeitstempel -> Millisekunden, Zahlen auf 2 Stellen. */
function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = norm(v[k]);
    return o;
  }
  if (typeof v === 'string' && ISO.test(v)) return toEpoch(v);
  if (typeof v === 'number') return Math.round((v + Number.EPSILON) * 100) / 100;
  return v;
}
/* Volatile Felder (Uhrzeit des Aufrufs) getrennt pruefen, dann entfernen. */
function splitVolatile(obj) {
  const vol = {};
  const walk = o => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object') {
      const r = {};
      for (const k of Object.keys(o)) {
        if (k === 'server_now' || k === 'remaining_seconds') { vol[k] = o[k]; continue; }
        r[k] = walk(o[k]);
      }
      return r;
    }
    return o;
  };
  return { clean: walk(obj), vol };
}

async function buildTwin(db, nowMs) {
  const store = createStore(nowMs);
  for (const name of TABLES) {
    const rows = (await db.query('select to_jsonb(t) as r from public.' + name + ' t')).rows.map(x => x.r);
    getTable(store, name).push(...rows);
  }
  store.authUsersByEmail.set(ADMIN_EMAIL, { id: ADMIN_UID, email: ADMIN_EMAIL, password: 'x', user_metadata: {} });
  getTable(store, 'admin_profiles').push({ auth_user_id: ADMIN_UID, login_name: ADMIN_EMAIL, role: 'admin', active: true });
  return store;
}

async function bothSides(db, store, fn, params, sqlArgs) {
  const claims = { sub: ADMIN_UID, email: ADMIN_EMAIL };
  const sql = await h.rpc(db, claims, fn, sqlArgs);
  const twin = TWIN[fn](store, ADMIN_UID, params);
  return { sql, twin };
}

async function compareAll(db, scenario, label) {
  const store = await buildTwin(db, Date.now());
  const eventId = scenario.event.id;
  const checks = [];
  const add = async (name, fn, params, sqlArgs) => {
    const { sql, twin } = await bothSides(db, store, fn, params, sqlArgs);
    const a = splitVolatile(sql), b = splitVolatile(twin);
    checks.push({ name, a, b });
  };

  await add('list', 'admin_event_list', {}, []);
  await add('overview', 'admin_event_overview', { p_event_id: eventId }, [eventId]);
  await add('quests', 'admin_event_quests', { p_event_id: eventId }, [eventId]);
  await add('timeline', 'admin_event_timeline', { p_event_id: eventId }, [eventId]);
  const pageSets = [
    ['', 'points', 'desc', 25, 0], ['', 'name', 'asc', 3, 3], ['', 'tier', 'asc', 25, 0], ['', 'last', 'desc', 25, 0],
    ['', 'daily', 'desc', 25, 0], ['', 'weekly', 'asc', 25, 0], ['', 'claimed', 'asc', 25, 0], ['a', 'name', 'asc', 25, 0],
    ['%', 'name', 'asc', 25, 0], ['  ALI ', 'points', 'desc', 25, 0], ['', 'kaputt', 'quer', 100000, -5], ['', 'points', 'desc', 0, 0]
  ];
  for (const [s, k, d, l, o] of pageSets) {
    await add('players ' + JSON.stringify([s, k, d, l, o]), 'admin_event_players',
      { p_event_id: eventId, p_search: s, p_sort: k, p_dir: d, p_limit: l, p_offset: o }, [eventId, s, k, d, l, o]);
  }
  const uids = (await db.query('select auth_user_id from public.player_event_progress where event_id = $1 order by auth_user_id limit 12', [eventId])).rows.map(r => r.auth_user_id);
  for (const u of [...uids, f.uid(424242)]) {
    await add('detail ' + u.slice(-4), 'admin_event_player_detail', { p_event_id: eventId, p_auth_user_id: u }, [eventId, u]);
  }
  for (const c of checks) expect(norm(c.b.clean), label + ' / ' + c.name).toEqual(norm(c.a.clean));
  // Uhrzeit-abhaengige Felder: gleiche Groessenordnung (Sekunden Abstand zwischen den beiden Aufrufen)
  for (const c of checks) {
    if (c.a.vol.remaining_seconds != null) expect(Math.abs(c.a.vol.remaining_seconds - c.b.vol.remaining_seconds), label + ' Restzeit').toBeLessThan(15);
    if (c.a.vol.server_now) expect(Math.abs(toEpoch(c.a.vol.server_now) - toEpoch(c.b.vol.server_now)), label + ' server_now').toBeLessThan(15000);
  }
  return checks.length;
}

/* ein Aufruf-Fenster ueber Mitternacht Berlin wuerde "heute" zwischen beiden Seiten verschieben -> einmal wiederholen */
async function compareStable(db, scenario, label) {
  const day = () => f.berlinDateStr(Date.now());
  const before = day();
  let n;
  try { n = await compareAll(db, scenario, label); }
  catch (err) { if (day() !== before) { n = await compareAll(db, scenario, label); } else throw err; }
  return n;
}

async function worldOf(scenario) {
  const db = await h.createEventDb();
  await h.seedScenario(db, scenario);
  await h.addAdminProfile(db, { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' });
  return db;
}

test.describe('JS-Nachbau == echtes SQL', () => {
  const HOUR = 3600 * 1000;

  test('Zwielicht, laufend (10 Spieler, Tagesprotokoll, Auswahl, Wochenquests): alle Funktionen, alle Sortierungen', async () => {
    const db = await worldOf(f.makeZwielichtScenario(Date.now()));
    expect(await compareStable(db, f.makeZwielichtScenario(Date.now()), 'zwielicht')).toBeGreaterThan(20);
    await db.close();
  });

  test('Zwielicht in jedem Status: kommend / beendet / archiviert / versteckt', async () => {
    const now = Date.now();
    const variants = {
      COMING_SOON: { announce_at: new Date(now - HOUR).toISOString(), starts_at: new Date(now + 24 * HOUR).toISOString(), ends_at: new Date(now + 8 * 24 * HOUR).toISOString() },
      ENDED: { announce_at: new Date(now - 10 * 24 * HOUR).toISOString(), starts_at: new Date(now - 9 * 24 * HOUR).toISOString(), ends_at: new Date(now - 2 * 24 * HOUR).toISOString() },
      ARCHIVED: { archived: true },
      HIDDEN: { enabled: false }
    };
    for (const [label, patch] of Object.entries(variants)) {
      const sc = f.makeZwielichtScenario(now);
      Object.assign(sc.event, patch);
      const db = await worldOf(sc);
      await compareStable(db, sc, label);
      await db.close();
    }
  });

  test('Anderes Event (12 Stufen, 250 Punkte, drei Auswahl-Arten, beendet) und Event ohne Auswahl-Belohnung', async () => {
    const sc = f.makeCustomEventScenario(Date.now());
    const db = await h.createEventDb();
    await h.seedScenario(db, sc);
    await h.addAdminProfile(db, { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' });
    await compareStable(db, sc, 'frostfest');
    await db.query("update public.special_events set choice_mode = 'none' where id = 'frostfest'");
    await compareStable(db, sc, 'frostfest-ohne-auswahl');
    await db.close();
  });

  test('Ohne Teilnehmer', async () => {
    const sc = f.makeZwielichtScenario(Date.now());
    sc.players = []; sc.log = []; sc.stats = [];
    const db = await worldOf(sc);
    await compareStable(db, sc, 'leer');
    await db.close();
  });

  test('Genau ein Teilnehmer / zwei Teilnehmer (Median)', async () => {
    for (const keep of [['Cara'], ['Cara', 'Eli'], ['Ida']]) {
      const sc = f.makeZwielichtScenario(Date.now());
      sc.players = sc.players.filter(p => keep.map(k => k.toLowerCase()).includes(p.name_key));
      sc.log = sc.log.filter(l => sc.players.some(p => p.auth_user_id === l.auth_user_id));
      const db = await worldOf(sc);
      await compareStable(db, sc, 'teilnehmer ' + keep.join('+'));
      await db.close();
    }
  });

  test('Zugriffsregel identisch: Nicht-Admins bekommen auf beiden Seiten not_admin', async () => {
    const sc = f.makeZwielichtScenario(Date.now());
    const db = await worldOf(sc);
    await h.addAdminProfile(db, { uid: f.uid(902), email: 'mitarbeiter@bkmp-admin-accounts.com', role: 'expenses_editor' });
    await h.addAdminProfile(db, { uid: f.uid(905), email: 'gesperrt@bkmp-admin-accounts.com', role: 'admin', active: false });
    const store = await buildTwin(db, Date.now());
    store.authUsersByEmail.set('mitarbeiter@bkmp-admin-accounts.com', { id: f.uid(902), email: 'mitarbeiter@bkmp-admin-accounts.com' });
    store.authUsersByEmail.set('gesperrt@bkmp-admin-accounts.com', { id: f.uid(905), email: 'gesperrt@bkmp-admin-accounts.com' });
    getTable(store, 'admin_profiles').push(
      { auth_user_id: f.uid(902), login_name: 'mitarbeiter@bkmp-admin-accounts.com', role: 'expenses_editor', active: true },
      { auth_user_id: f.uid(905), login_name: 'gesperrt@bkmp-admin-accounts.com', role: 'admin', active: false });
    const actors = [
      ['Mitarbeiter', { sub: f.uid(902), email: 'mitarbeiter@bkmp-admin-accounts.com' }, f.uid(902)],
      ['Gesperrt', { sub: f.uid(905), email: 'gesperrt@bkmp-admin-accounts.com' }, f.uid(905)],
      ['Spieler', { sub: f.uid(1), email: 'alice@bkmp-player-accounts.com' }, f.uid(1)],
      ['Unbekannt', { sub: f.uid(999), email: 'x@y.z' }, f.uid(999)],
      ['Ausgeloggt', null, null]
    ];
    for (const [label, claims, uid] of actors) {
      // SQL
      await expect(h.rpc(db, claims, 'admin_event_overview', ['zwielicht']), 'sql ' + label).rejects.toThrow(/not_admin|permission denied/);
      // Nachbau
      expect(() => TWIN.admin_event_overview(store, uid, { p_event_id: 'zwielicht' }), 'twin ' + label).toThrow(/not_admin/);
    }
    await db.close();
  });
});
