/* Zwielicht-Event: Stufenbelohnungen gegen ECHTES Postgres (PGlite) - 05.10.2026.

   Anlass: Spieler-Meldung "Das Stufe-10-Dayman-Ei wird im Zwielicht-Event nicht
   vergeben". Die bisherigen Stufe-10-Tests (special-event.spec.js) laufen gegen den
   JS-Nachbau tests/mock/event-engine.js, NICHT gegen die echte SQL. Dieser Test
   fuehrt die ECHTEN Definitionen aus
     sql/20261004-06-special-events.sql  (event_claim_tiers)
     sql/20261004-07-zwielicht-event.sql (Konfiguration, ueber tests/fixtures)
     sql/20261004-08-lightnix-darknix.sql (Ei-Schutz-Trigger)
     sql/supabase-dragon-breeding.sql    (Tabelle player_dragon_eggs)
   gegen eine echte Postgres-Engine aus und prueft, dass auf Stufe 10 wirklich
   genau ein Dayman-Ei in player_dragon_eggs landet. */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const h = require('../helpers/pg-event-harness');
const ev = require('../fixtures/event-reference');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Reine SQL-Tests laufen nur einmal (chromium-desktop).');
});

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

const UID = '00000000-0000-4000-8000-000000000042';
const NAME = 'daymanfan';
const CLAIMS = { sub: UID, email: NAME + '@bkmp-player-accounts.com' };

async function buildWorld(opts) {
  const o = opts || {};
  const db = await h.createEventDb({ install: false });
  // Spaltenerweiterungen aus 20261004-01, die der Harness-Stand-in nicht kennt.
  await db.exec(`
    alter table public.dragon_species add column if not exists unique_per_account boolean not null default false;
    alter table public.dragon_species add column if not exists event_origin text;
    create table public.idle_player_state (
      auth_user_id uuid primary key, name_key text not null,
      highest_dragon_index bigint not null default 0,
      gold bigint not null default 0, total_gold_earned bigint not null default 0,
      wood bigint not null default 0, stone bigint not null default 0,
      crystals bigint not null default 0, essence bigint not null default 0,
      fruit bigint not null default 0, meat bigint not null default 0,
      obstgarten_level integer not null default 0, jagdhuette_level integer not null default 0);
    -- Minimaler Stand-in: die Nachhol-SQL liest nur diese drei Spalten.
    create table public.player_dragons (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null, species_id text not null,
      hatched_at timestamptz not null default now());
  `);
  // Echte Definitionen: Goldeinheit (-02), Ei-Tabelle (Basisschema), Ei-Schutz (-08), Abholfunktion (-06).
  await db.exec(between(sqlFile('20261004-02-village-projects.sql'),
    'create or replace function public.village_gold_unit', 'create or replace function public.village_seed_int'));
  await db.exec(between(sqlFile('supabase-dragon-breeding.sql'),
    'create table if not exists public.player_dragon_eggs', 'alter table public.player_dragon_eggs enable row level security'));
  await db.exec(between(sqlFile('20261004-08-lightnix-darknix.sql'),
    'create or replace function public.player_dragon_eggs_event_guard()', '-- ---------- Schutz 2'));
  await db.exec(between(sqlFile('20261004-06-special-events.sql'),
    'create or replace function public.event_claim_tiers', '-- ---------- Hauptbelohnung waehlen'));
  await db.exec(`
    revoke all on function public.event_claim_tiers(text) from public, anon;
    grant execute on function public.event_claim_tiers(text) to authenticated;
    grant select, insert, update on all tables in schema public to authenticated;
  `);

  const species = o.species || [
    { id: 'dayman', name: 'Dayman' }, { id: 'surebrec', name: 'Surebrec' },
    { id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }];
  await h.insertRows(db, 'dragon_species', species);
  // Einzelstueck-Arten (Schutz muss sie ausschliessen), normale Arten bleiben normal.
  await db.exec(`update public.dragon_species set unique_per_account = true, event_origin = 'zwielicht'
                  where id in ('lightnix', 'darknix')`);

  const eventRow = ev.makeZwielichtEventRow({ enabled: true,
    starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 5 * 86400000).toISOString() });
  await h.insertRows(db, 'special_events', [eventRow]);
  await h.insertRows(db, 'player_stats', [{ auth_user_id: UID, display_name: 'DaymanFan', name_key: NAME }]);
  await h.insertRows(db, 'idle_player_state', [{ auth_user_id: UID, name_key: NAME, highest_dragon_index: 40 }]);
  const ppt = eventRow.points_per_tier;
  await h.insertRows(db, 'player_event_progress', [{
    event_id: 'zwielicht', auth_user_id: UID, name_key: NAME,
    points: (o.tiers === undefined ? 10 : o.tiers) * ppt, tier_claimed: o.claimed || [] }]);
  return { db, eventRow };
}
const eggs = async db => (await db.query('select species_id from public.player_dragon_eggs order by created_at, species_id')).rows.map(r => r.species_id);
const claimedOf = async db => (await db.query(`select tier_claimed from public.player_event_progress where auth_user_id = '${UID}'`)).rows[0].tier_claimed;

test('Stufe 10 erreicht: die echte SQL legt genau EIN Dayman-Ei an und merkt Stufe 10 als abgeholt', async () => {
  const { db } = await buildWorld({ tiers: 10 });
  const res = await h.rpc(db, CLAIMS, 'event_claim_tiers', ['zwielicht']);
  expect(res.eggs.map(e => [e.species_id, e.tier])).toEqual([['dayman', 10]]);
  expect(await eggs(db)).toEqual(['dayman']);
  expect(await claimedOf(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('Zweiter Abholversuch (zweiter Tab): kein zweites Ei', async () => {
  const { db } = await buildWorld({ tiers: 10 });
  await h.rpc(db, CLAIMS, 'event_claim_tiers', ['zwielicht']);
  const second = await h.rpc(db, CLAIMS, 'event_claim_tiers', ['zwielicht']);
  expect(second.eggs).toEqual([]);
  expect(await eggs(db)).toEqual(['dayman']);
});

test('Stufe 20 erreicht: Dayman (Stufe 10) UND Surebrec (Stufe 20), je genau einmal', async () => {
  const { db } = await buildWorld({ tiers: 20 });
  const res = await h.rpc(db, CLAIMS, 'event_claim_tiers', ['zwielicht']);
  expect(res.eggs.map(e => [e.species_id, e.tier])).toEqual([['dayman', 10], ['surebrec', 20]]);
  expect((await eggs(db)).sort()).toEqual(['dayman', 'surebrec']);
});

test('Stufe 10 war schon mit einer aelteren Version als abgeholt markiert: kein Ei mehr (Spiegel der Live-Vermutung)', async () => {
  const { db } = await buildWorld({ tiers: 10, claimed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  const res = await h.rpc(db, CLAIMS, 'event_claim_tiers', ['zwielicht']);
  expect(res.eggs).toEqual([]);
  expect(await eggs(db)).toEqual([]);
});

/* ---------------- Nachhol-SQL (sql/20261005-zwielicht-pass-egg-catchup.sql) ---------------- */
const runCatchup = db => db.exec(sqlFile('20261005-zwielicht-pass-egg-catchup.sql'));
const catchupLog = async db => (await db.query('select tier, species_id from public.event_tier_egg_catchup order by tier, species_id')).rows.map(r => [r.tier, r.species_id]);
const range = n => Array.from({ length: n }, (_, i) => i + 1);

test('Nachhol-SQL: Stufe 10 war abgeholt, aber ohne Ei -> genau EIN Dayman-Ei, zweiter Lauf vergibt nichts mehr', async () => {
  const { db } = await buildWorld({ tiers: 10, claimed: range(10) });
  expect(await eggs(db)).toEqual([]);
  await runCatchup(db);
  expect(await eggs(db)).toEqual(['dayman']);
  expect(await catchupLog(db)).toEqual([[10, 'dayman']]);
  await runCatchup(db);
  await runCatchup(db);
  expect(await eggs(db)).toEqual(['dayman']);
  expect(await catchupLog(db)).toEqual([[10, 'dayman']]);
});

test('Nachhol-SQL: nachgeholtes Ei wurde freigelassen -> der naechste Lauf holt es NICHT noch einmal nach (Log-Tabelle)', async () => {
  const { db } = await buildWorld({ tiers: 10, claimed: range(10) });
  await runCatchup(db);
  expect(await eggs(db)).toEqual(['dayman']);
  // Spieler laesst das Ei frei: kein Ei, kein Drache mehr -> nur das Log verhindert die Neuvergabe.
  await db.exec(`delete from public.player_dragon_eggs where auth_user_id = '${UID}'`);
  await runCatchup(db);
  expect(await eggs(db)).toEqual([]);
  expect(await catchupLog(db)).toEqual([[10, 'dayman']]);
});

test('Nachhol-SQL: Stufe 20 abgeholt -> Dayman (10) und Surebrec (20), je einmal', async () => {
  const { db } = await buildWorld({ tiers: 20, claimed: range(20) });
  await runCatchup(db); await runCatchup(db);
  expect((await eggs(db)).sort()).toEqual(['dayman', 'surebrec']);
  expect(await catchupLog(db)).toEqual([[10, 'dayman'], [20, 'surebrec']]);
});

test('Nachhol-SQL: Stufe NICHT abgeholt -> nichts (das normale Abholen vergibt das Ei selbst)', async () => {
  const { db } = await buildWorld({ tiers: 10, claimed: [] });
  await runCatchup(db);
  expect(await eggs(db)).toEqual([]);
  const res = await h.rpc(db, CLAIMS, 'event_claim_tiers', ['zwielicht']);
  expect(res.eggs.map(e => e.species_id)).toEqual(['dayman']);
  await runCatchup(db);
  expect(await eggs(db)).toEqual(['dayman']);
});

test('Nachhol-SQL: Spieler hat das Ei schon (z.B. von Hand gutgeschrieben) -> kein zweites', async () => {
  const { db } = await buildWorld({ tiers: 10, claimed: range(10) });
  await db.exec(`insert into public.player_dragon_eggs (name_key, auth_user_id, species_id) values ('${NAME}', '${UID}', 'dayman')`);
  await runCatchup(db);
  expect(await eggs(db)).toEqual(['dayman']);
  expect(await catchupLog(db)).toEqual([]);
});

test('Nachhol-SQL: seit Eventstart geschluepfter Dayman-Drache zaehlt als bekommen, aelterer nicht', async () => {
  const a = await buildWorld({ tiers: 10, claimed: range(10) });
  await a.db.exec(`insert into public.player_dragons (auth_user_id, species_id, hatched_at) values ('${UID}', 'dayman', now())`);
  await runCatchup(a.db);
  expect(await eggs(a.db)).toEqual([]);
  const b = await buildWorld({ tiers: 10, claimed: range(10) });
  await b.db.exec(`insert into public.player_dragons (auth_user_id, species_id, hatched_at) values ('${UID}', 'dayman', now() - interval '3 days')`);
  await runCatchup(b.db);
  expect(await eggs(b.db)).toEqual(['dayman']);
});

test('Nachhol-SQL: ueberspringt Einzelstueck-Arten (Ei-Schutz wuerde sie ablehnen) statt abzubrechen', async () => {
  const { db } = await buildWorld({ tiers: 10, claimed: range(10) });
  // Konfiguration so verbiegen, dass Stufe 10 ein Einzelstueck verspricht.
  await db.exec(`update public.special_events set config = replace(config::text, '"dayman"', '"lightnix"')::jsonb where id = 'zwielicht'`);
  await runCatchup(db);
  expect(await eggs(db)).toEqual([]);
});

test('Fehlt Dayman in dragon_species: reward_species_missing, NICHTS als abgeholt markiert', async () => {
  const { db } = await buildWorld({ tiers: 10, species: [{ id: 'surebrec', name: 'Surebrec' }, { id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }] });
  await expect(h.rpc(db, CLAIMS, 'event_claim_tiers', ['zwielicht'])).rejects.toThrow(/reward_species_missing/);
  expect(await claimedOf(db)).toEqual([]);
  expect(await eggs(db)).toEqual([]);
});
