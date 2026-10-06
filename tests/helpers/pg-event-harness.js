/* Echtes Postgres (PGlite, WebAssembly) fuer die SQL-Seite der Event-Analyse
   (sql/20261005-event-admin-stats.sql).

   Warum: die Admin-Funktionen laufen in Produktion NUR in Postgres. Ein JS-
   Nachbau (tests/mock/event-admin-engine.js) allein koennte vom echten SQL
   abweichen, ohne dass es jemand merkt. Dieser Helfer fuehrt die ECHTEN SQL-
   Dateien gegen eine echte Postgres-Engine aus - dieselbe Datei, die der
   Betreiber im Supabase-SQL-Editor ausfuehrt.

   Was nachgebaut wird (nur das, was die Funktionen wirklich brauchen):
     * Rollen anon/authenticated + auth.jwt()/auth.uid() (lesen die Claims aus
       der Sitzungsvariable request.jwt.claims - wie Supabase)
     * admin_profiles + die ECHTE is_active_admin()-Definition aus
       sql/supabase-mapart-marketplace-schema.sql (Rollenfilter admin/editor)
     * die ECHTE village_berlin_today() aus sql/20261004-02-village-projects.sql
     * die ECHTEN Tabellen special_events/player_event_progress/
       player_event_reward_claims + special_event_status_of() aus
       sql/20261004-06-special-events.sql (bis vor den Spieler-Funktionen)
     * kleine Stand-ins fuer player_stats/dragon_species (nur die gelesenen Spalten)
   Das Zwielicht-Event selbst kommt aus tests/fixtures (dort aus sql/20261004-07 gelesen). */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// CRLF -> LF: unter Windows (core.autocrlf) sind die SQL-Dateien CRLF, die Marker in between() sind LF.
const sqlFile = name => fs.readFileSync(path.join(ROOT, 'sql', name), 'utf8').replace(/\r\n/g, '\n');

function between(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  if (a < 0) throw new Error('SQL-Marker nicht gefunden: ' + startMarker);
  const b = endMarker ? text.indexOf(endMarker, a) : text.length;
  if (b < 0) throw new Error('SQL-Endmarker nicht gefunden: ' + endMarker);
  return text.slice(a, b);
}

/* Datenbank mit den ECHTEN Grundtabellen/-funktionen. Optional gleich die neue Datei installieren. */
async function createEventDb(options) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();

  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    create table public.admin_profiles (
      id uuid primary key default gen_random_uuid(), auth_user_id uuid, login_name text, role text, active boolean default true);
    create table public.player_stats (auth_user_id uuid primary key, display_name text, name_key text);
    create table public.dragon_species (id text primary key, name text);
  `);

  // Echte Definitionen aus den Projekt-Dateien (kein zweiter, abweichender Nachbau).
  await db.exec(between(sqlFile('supabase-mapart-marketplace-schema.sql'),
    'create or replace function public.is_active_admin()', '-- ============================================================\n-- 1) companies'));
  await db.exec(between(sqlFile('20261004-02-village-projects.sql'),
    'create or replace function public.village_berlin_today()', 'create or replace function public.village_gold_unit'));
  await db.exec(between(sqlFile('20261004-06-special-events.sql'),
    'create table if not exists public.special_events', '-- ---------- Kennzahlen eines Spielers'));
  if (!options || options.install !== false) await installEventAdminStats(db);
  return db;
}

/* Die neue Datei - exakt so, wie sie im Supabase-SQL-Editor laeuft. */
async function installEventAdminStats(db) {
  await db.exec(sqlFile('20261005-event-admin-stats.sql'));
}

/* Fuehrt EINEN Aufruf mit einer bestimmten Anmeldung aus (wie ein Request mit
   JWT). claims = null -> ausgeloggt (anon). Der Rollenwechsel (set local role)
   greift die Execute-Rechte der Funktionen genauso wie Supabase. */
async function callAs(db, claims, sql, params) {
  await db.exec('begin');
  try {
    if (claims) await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await db.exec(`set local role ${claims ? 'authenticated' : 'anon'}`);
    const res = await db.query(sql, params || []);
    await db.exec('commit');
    return res.rows;
  } catch (err) {
    await db.exec('rollback');
    throw err;
  }
}

/* Bequemer Aufruf einer Admin-Funktion: select <fn>(...) -> jsonb. */
async function rpc(db, claims, fn, args) {
  const params = args || [];
  const placeholders = params.map((_, i) => '$' + (i + 1)).join(', ');
  const rows = await callAs(db, claims, 'select public.' + fn + '(' + placeholders + ') as r', params);
  return rows[0].r;
}

/* Generisches, schnelles Einfuegen von Objektzeilen (jsonb_populate_recordset: die
   Spaltentypen - jsonb, int[], text[], date, timestamptz - kommen aus der Tabelle).
   Es werden nur die Spalten eingefuegt, die in den Zeilen VORKOMMEN - alle anderen
   behalten ihren Tabellen-Default (created_at, joined_day, ...). */
async function insertRows(db, table, rows) {
  if (!rows || !rows.length) return;
  // Zeilen mit unterschiedlichen Spalten (undefined = weggelassen) getrennt einfuegen,
  // damit fehlende Spalten ihren Tabellen-Default behalten statt NULL zu bekommen.
  const groups = new Map();
  for (const r of rows) {
    const cols = Object.keys(r).filter(k => r[k] !== undefined);
    const key = cols.join('|');
    if (!groups.has(key)) groups.set(key, { cols, rows: [] });
    groups.get(key).rows.push(r);
  }
  const CHUNK = 2000;
  for (const { cols, rows: grp } of groups.values()) {
    const colList = cols.map(c => '"' + c + '"').join(', ');
    for (let i = 0; i < grp.length; i += CHUNK) {
      await db.query(
        'insert into public.' + table + ' (' + colList + ') select ' + colList +
        ' from jsonb_populate_recordset(null::public.' + table + ', $1::jsonb)',
        [JSON.stringify(grp.slice(i, i + CHUNK))]);
    }
  }
}

/* Ein Szenario aus tests/fixtures/event-admin-reference.js in die Datenbank legen. */
async function seedScenario(db, scenario) {
  await insertRows(db, 'dragon_species', scenario.species || [{ id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }]);
  await insertRows(db, 'special_events', [scenario.event]);
  await insertRows(db, 'player_stats', scenario.stats);
  await insertRows(db, 'player_event_progress', scenario.players);
  await insertRows(db, 'event_player_day_log', scenario.log);
}

/* Ein Admin-/Redakteurs-Konto (wie bkmpLoginAdmin es ueber admin_profiles prueft). */
async function addAdminProfile(db, { uid, email, role, active }) {
  await db.query('insert into public.admin_profiles (auth_user_id, login_name, role, active) values ($1, $2, $3, $4)',
    [uid, email, role === undefined ? 'admin' : role, active === undefined ? true : active]);
  return { sub: uid, email };
}

module.exports = { createEventDb, installEventAdminStats, callAs, rpc, insertRows, seedScenario, addAdminProfile };
