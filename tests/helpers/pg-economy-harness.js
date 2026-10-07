/* Echtes Postgres (PGlite) fuer die Wirtschafts-Pruefung (sql/20261007-anticheat-economy-guard.sql).

   Wie pg-event-harness.js: die ECHTEN SQL-Dateien laufen gegen eine echte Postgres-Engine, in
   derselben Reihenfolge wie im Supabase-SQL-Editor - die alten Anti-Cheat-Dateien (Kills/Level/
   Skillpunkte/Kampfwerte) UND die neue Datei zusammen. So wird auch das Zusammenspiel des
   bestehenden Waechters mit dem neuen geprueft, nicht nur die neue Datei allein.

   Nachgebaut (nur was die Trigger wirklich lesen):
     * idle_player_state mit allen Spalten, die die Waechter anfassen (Spaltennamen/-typen wie im
       echten Schema, siehe supabase.js BKMP_IDLE_PLAYER_STATE_COLUMNS)
     * idle_game_config (reward_scaling, xp_curve - die echten Live-Werte), idle_prestige_state
     * Rollen anon/authenticated/service_role; is_active_admin() ist die ECHTE Definition.
   Die Schreibzugriffe laufen wie bei PostgREST: "set local role authenticated" + JWT-Claims. */
const fs = require('fs');
const path = require('path');
const h = require('./pg-event-harness');

const ROOT = path.join(__dirname, '..', '..');
// CRLF -> LF: unter Windows (core.autocrlf) sind die SQL-Dateien CRLF.
const sqlFile = name => fs.readFileSync(path.join(ROOT, 'sql', name), 'utf8').replace(/\r\n/g, '\n');

const OLD_CHAIN = [
  '20260730-idle-player-state-anticheat-guard.sql',
  '20260809-anticheat-guard-independent-fields.sql',
  '20260809-anticheat-guard-combat-stats.sql',
  '20260809-leaderboard-hide-mechanism.sql',
  '20260811-anticheat-guard-flag-insert-safety-net.sql'
];
const DECOUPLE = '20260811-leaderboard-hide-decouple-from-flags.sql';
const ARRAY_FIX = '20261007-fix-anticheat-guard-array-concat.sql';
const ECONOMY = '20261007-anticheat-economy-guard.sql';

const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

async function createEconomyDb(options) {
  const o = options || {};
  const db = await h.createEventDb({ install: false });
  await db.exec(`
    do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
    create table public.idle_game_config (key text primary key, value jsonb not null);
    insert into public.idle_game_config (key, value) values
      ('reward_scaling', '{"xpGrowthPerKill": 0.05, "xpGrowthExponent": 1.2, "goldGrowthPerKill": 0.05, "goldGrowthExponent": 1.2}'),
      ('xp_curve', '{"base": 40, "growth": 1.42}');
    create table public.idle_prestige_state (name_key text primary key, prestige_level integer not null default 0);
    create table public.idle_player_state (
      auth_user_id uuid primary key,
      name_key text not null unique,
      display_name text,
      level integer not null default 1,
      xp bigint not null default 0,
      gold bigint not null default 0,
      wood bigint not null default 0,
      stone bigint not null default 0,
      crystals bigint not null default 0,
      essence bigint not null default 0,
      total_gold_earned bigint not null default 0,
      attack numeric not null default 10,
      defense numeric not null default 2,
      hp numeric not null default 100,
      crit_chance numeric not null default 5,
      crit_damage numeric not null default 150,
      gold_bonus numeric not null default 0,
      xp_bonus numeric not null default 0,
      loot_bonus numeric not null default 0,
      skill_points_available integer not null default 0,
      skill_points_spent integer not null default 0,
      dragon_kills bigint not null default 0,
      boss_kills bigint not null default 0,
      current_dragon_index bigint not null default 0,
      highest_dragon_index bigint not null default 0,
      prestige_stage_offset bigint not null default 0,
      playtime_seconds bigint not null default 0,
      turm_highest_wave integer not null default 0,
      goldmine_level integer not null default 0,
      holzfaeller_level integer not null default 0,
      steinbruch_level integer not null default 0,
      kristallmine_level integer not null default 0,
      manaquelle_level integer not null default 0,
      magierakademie_level integer not null default 0,
      updated_at timestamptz not null default now()
    );
    grant usage on schema public to anon, authenticated, service_role;
    grant select, update on public.idle_player_state to authenticated;
    grant select on public.idle_game_config, public.idle_prestige_state to anon, authenticated;
    grant all on public.idle_player_state to service_role;
  `);
  for (const f of OLD_CHAIN) await db.exec(sqlFile(f));
  // Korrektur des Array-Fehlers im alten Waechter (siehe Datei-Kopf dort); arrayFix:false = Zustand VOR der Korrektur.
  if (o.arrayFix !== false) await db.exec(sqlFile(ARRAY_FIX));
  if (o.decoupled) await db.exec(sqlFile(DECOUPLE));
  if (o.install !== false) await db.exec(sqlFile(ECONOMY));
  return db;
}

/* Basis-Spielstaende (Spaltenwerte) - ein neuer Spieler, ein mittlerer, ein Spitzenspieler.
   Zahlen aus den echten Daten (Bestenliste 07.10.2026: Stufe bis 11.039, Level bis 1.818;
   Boni der staerksten Konten 300-970). */
const PERSONA = {
  neu: { level: 1, attack: 10, highest_dragon_index: 0, current_dragon_index: 0 },
  mittel: {
    level: 120, xp: 30000, gold: 4000000, wood: 90000, stone: 90000, crystals: 4000, essence: 2500,
    total_gold_earned: 60000000, attack: 800, defense: 400, hp: 3000,
    gold_bonus: 400, xp_bonus: 400, loot_bonus: 300, dragon_kills: 120000,
    highest_dragon_index: 300, current_dragon_index: 300, goldmine_level: 20, holzfaeller_level: 15,
    steinbruch_level: 15, kristallmine_level: 10, manaquelle_level: 10, magierakademie_level: 10, prestige: 5
  },
  top: {
    level: 1818, xp: 900000, gold: 800000000, wood: 4000000, stone: 4000000, crystals: 90000, essence: 60000,
    total_gold_earned: 466824185321, attack: 15000, defense: 9000, hp: 14800,
    gold_bonus: 970, xp_bonus: 800, loot_bonus: 700, dragon_kills: 4924488,
    highest_dragon_index: 11039, current_dragon_index: 11039, goldmine_level: 150, holzfaeller_level: 150,
    steinbruch_level: 150, kristallmine_level: 150, manaquelle_level: 150, magierakademie_level: 150, prestige: 100
  }
};

/* Legt einen Spieler neu an (ersetzt einen vorhandenen). updated_at liegt standardmaessig 1 Stunde
   zurueck, damit der ALTE Waechter (Zeitbudget fuer Kills/Level) in diesen Tests nicht selbst anschlaegt. */
async function seedPlayer(db, n, persona, overrides) {
  const base = Object.assign({}, PERSONA[persona] || {}, overrides || {});
  const prestige = base.prestige || 0;
  delete base.prestige;
  const key = 'spieler' + n;
  // Die Konto-Tabelle gibt es erst nach der neuen Datei (Varianten mit install:false haben sie nicht).
  const hasState = (await db.query(`select to_regclass('public.idle_economy_guard_state') as t`)).rows[0].t;
  if (hasState) await db.query('delete from public.idle_economy_guard_state where owner_key = $1', [uid(n)]);
  await db.query('delete from public.idle_anticheat_flags where name_key = $1', [key]);
  await db.query('delete from public.idle_prestige_state where name_key = $1', [key]);
  await db.query('delete from public.idle_player_state where auth_user_id = $1', [uid(n)]);
  const row = Object.assign({ auth_user_id: uid(n), name_key: key, display_name: key }, base);
  const cols = Object.keys(row);
  await db.query(
    'insert into public.idle_player_state (' + cols.map(c => '"' + c + '"').join(', ') + ') values (' +
    cols.map((_, i) => '$' + (i + 1)).join(', ') + ')', cols.map(c => row[c]));
  await db.query(`update public.idle_player_state set updated_at = now() - interval '1 hour' where auth_user_id = $1`, [uid(n)]);
  if (prestige > 0) await db.query('insert into public.idle_prestige_state (name_key, prestige_level) values ($1, $2)', [key, prestige]);
  return key;
}

/* Ein Speichern wie vom Browser: Rolle authenticated + JWT des Spielers. "assignments" ist ein
   SQL-Textstueck wie "gold = gold + 100, wood = 5" (nur Testcode, keine Nutzereingabe). */
async function directSave(db, n, assignments) {
  const rows = await h.callAs(db, { sub: uid(n) },
    'update public.idle_player_state set ' + assignments + ' where auth_user_id = $1 returning *', [uid(n)]);
  return rows[0];
}
/* Dasselbe als Administrator-Konto bzw. als service_role (Offline-Nachtrag). */
async function adminSave(db, n, adminClaims, assignments) {
  // adminClaims = { sub, email } wie von h.addAdminProfile geliefert (is_active_admin() prueft die E-Mail).
  const rows = await h.callAs(db, adminClaims,
    'update public.idle_player_state set ' + assignments + ' where auth_user_id = $1 returning *', [uid(n)]);
  return rows[0];
}
async function serviceSave(db, n, assignments) {
  await db.exec('begin');
  try {
    await db.exec('set local role service_role');
    const res = await db.query('update public.idle_player_state set ' + assignments + ' where auth_user_id = $1 returning *', [uid(n)]);
    await db.exec('commit');
    return res.rows[0];
  } catch (err) { await db.exec('rollback'); throw err; }
}

async function getState(db, n) {
  const r = await db.query('select * from public.idle_economy_guard_state where owner_key = $1', [uid(n)]);
  return r.rows[0] || null;
}
async function getRow(db, n) {
  const r = await db.query('select * from public.idle_player_state where auth_user_id = $1', [uid(n)]);
  return r.rows[0] || null;
}
async function economyFlags(db, n) {
  const r = await db.query(`select * from public.idle_anticheat_flags where name_key = $1 and triggered_by = 'economy' order by flagged_at`, ['spieler' + n]);
  return r.rows;
}
async function allFlags(db, n) {
  const r = await db.query('select * from public.idle_anticheat_flags where name_key = $1 order by flagged_at', ['spieler' + n]);
  return r.rows;
}
async function setEconomy(db, patch) {
  await db.query(`insert into public.idle_anticheat_settings (key, value) values ('economy', $1::jsonb)
                  on conflict (key) do update set value = public.idle_anticheat_settings.value || $1::jsonb`, [JSON.stringify(patch)]);
}

module.exports = {
  createEconomyDb, seedPlayer, directSave, adminSave, serviceSave, getState, getRow, economyFlags, allFlags,
  setEconomy, uid, PERSONA, sqlFile, ECONOMY, ARRAY_FIX, OLD_CHAIN, DECOUPLE
};
