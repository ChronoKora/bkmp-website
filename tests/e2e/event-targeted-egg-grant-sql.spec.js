/* Zwielicht-Pass: gezieltes Nachholen des Stufe-20-Eis + Diagnose - 07.10.2026.

   Anlass: Meldung "byalex0 hat auf Stufe 20 KEIN Ei bekommen". Der allgemeine Nachhol-Lauf
   (sql/20261005-zwielicht-pass-egg-catchup.sql) ueberspringt jeden, der ein Ei der Art besitzt
   ODER seit Eventstart einen Drachen der Art geschluepft hat. Dayman/Surebrec fallen aber auch
   normal aus dem Ei-Dungeon -> ein Spieler mit so einem Drachen bleibt OHNE Pass-Ei.
   Geprueft werden die ECHTEN Dateien
     sql/20261005-zwielicht-pass-egg-catchup.sql          (zeigt die Luecke)
     sql/20261007-zwielicht-pass-egg-grant-targeted.sql   (schliesst sie fuer genannte Spieler)
     sql/20261007-diagnose-zwielicht-stage20-byalex0.sql  (laeuft fehlerfrei, zeigt die Luecke) */
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
const sqlFile = name => fs.readFileSync(path.join(ROOT, 'sql', name), 'utf8').replace(/\r\n/g, '\n');
function between(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  if (a < 0) throw new Error('SQL-Marker nicht gefunden: ' + startMarker);
  const b = endMarker ? text.indexOf(endMarker, a) : text.length;
  if (b < 0) throw new Error('SQL-Endmarker nicht gefunden: ' + endMarker);
  return text.slice(a, b);
}

const UID_A = '00000000-0000-4000-8000-0000000000b1'; // "byalex0"
const UID_B = '00000000-0000-4000-8000-0000000000b2'; // anderer Spieler im selben Zustand
const range = n => Array.from({ length: n }, (_, i) => i + 1);
const GRANT_FILE = '20261007-zwielicht-pass-egg-grant-targeted.sql';
const CATCHUP_FILE = '20261005-zwielicht-pass-egg-catchup.sql';
const DIAG_FILE = '20261007-diagnose-zwielicht-stage20-byalex0.sql';

async function buildWorld(players) {
  const db = await h.createEventDb({ install: false });
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
    create table public.player_dragons (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null, name_key text, species_id text not null,
      stage text not null default 'baby', origin_event text,
      hatched_at timestamptz not null default now());
  `);
  await db.exec(between(sqlFile('20261004-02-village-projects.sql'),
    'create or replace function public.village_gold_unit', 'create or replace function public.village_seed_int'));
  await db.exec(between(sqlFile('supabase-dragon-breeding.sql'),
    'create table if not exists public.player_dragon_eggs', 'alter table public.player_dragon_eggs enable row level security'));
  await db.exec(between(sqlFile('20261004-08-lightnix-darknix.sql'),
    'create or replace function public.player_dragon_eggs_event_guard()', 'notify pgrst'));
  await db.exec(between(sqlFile('20261004-06-special-events.sql'),
    'create or replace function public.event_claim_tiers', '-- ---------- Sichtbare Events'));
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;`);
  await h.insertRows(db, 'dragon_species', [
    { id: 'dayman', name: 'Dayman' }, { id: 'surebrec', name: 'Surebrec' },
    { id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }]);
  await db.exec(`update public.dragon_species set unique_per_account = true, event_origin = 'zwielicht'
                  where id in ('lightnix', 'darknix')`);
  const eventRow = ev.makeZwielichtEventRow({ enabled: true,
    starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 5 * 86400000).toISOString() });
  await h.insertRows(db, 'special_events', [eventRow]);
  for (const p of players) {
    await h.insertRows(db, 'player_stats', [{ auth_user_id: p.uid, display_name: p.name, name_key: p.name }]);
    await h.insertRows(db, 'idle_player_state', [{ auth_user_id: p.uid, name_key: p.name, highest_dragon_index: 40 }]);
    await h.insertRows(db, 'player_event_progress', [{
      event_id: 'zwielicht', auth_user_id: p.uid, name_key: p.name,
      points: (p.stage === undefined ? 20 : p.stage) * eventRow.points_per_tier,
      tier_claimed: p.claimed === undefined ? range(20) : p.claimed }]);
  }
  return { db };
}
const eggsOf = async (db, uid) => (await db.query(`select species_id from public.player_dragon_eggs where auth_user_id = '${uid}' order by created_at, species_id`)).rows.map(r => r.species_id);
const logOf = async db => (await db.query('select auth_user_id, tier, species_id from public.event_tier_egg_catchup order by auth_user_id, tier')).rows.map(r => [r.auth_user_id, r.tier, r.species_id]);
const hatchedDragon = (db, uid, species, ago) => db.exec(
  `insert into public.player_dragons (auth_user_id, species_id, hatched_at) values ('${uid}', '${species}', now() - interval '${ago || '1 hour'}')`);

test('LUECKE: Stufe 20 abgeholt, Surebrec-Drache aus dem Ei-Dungeon seit Eventstart -> der allgemeine Nachhol-Lauf vergibt KEIN Ei', async () => {
  const { db } = await buildWorld([{ uid: UID_A, name: 'byalex0' }]);
  await hatchedDragon(db, UID_A, 'surebrec');
  await db.exec(sqlFile(CATCHUP_FILE));
  // Dayman (Stufe 10) wird nachgeholt, Surebrec (Stufe 20) NICHT - das ist die Luecke.
  expect(await eggsOf(db, UID_A)).toEqual(['dayman']);
});

test('Gezielt nachholen: byalex0 bekommt das Surebrec-Ei (nur Stufe 20), ein zweiter/dritter Lauf legt nichts mehr an', async () => {
  const { db } = await buildWorld([{ uid: UID_A, name: 'byalex0' }]);
  await hatchedDragon(db, UID_A, 'surebrec');
  await db.exec(sqlFile(GRANT_FILE));
  expect(await eggsOf(db, UID_A)).toEqual(['surebrec']);
  expect(await logOf(db)).toEqual([[UID_A, 20, 'surebrec']]);
  await db.exec(sqlFile(GRANT_FILE));
  await db.exec(sqlFile(GRANT_FILE));
  expect(await eggsOf(db, UID_A)).toEqual(['surebrec']);
});

test('Nur NAMENTLICH genannte Spieler: ein zweiter Spieler im selben Zustand bleibt unberuehrt', async () => {
  const { db } = await buildWorld([{ uid: UID_A, name: 'byalex0' }, { uid: UID_B, name: 'anderer' }]);
  await db.exec(sqlFile(GRANT_FILE));
  expect(await eggsOf(db, UID_A)).toEqual(['surebrec']);
  expect(await eggsOf(db, UID_B)).toEqual([]);
});

test('Namensliste und Stufenliste sind anpassbar (wie im Dateikopf beschrieben): beide Spieler, Stufe 10 + 20', async () => {
  const { db } = await buildWorld([{ uid: UID_A, name: 'byalex0' }, { uid: UID_B, name: 'anderer' }]);
  const edited = sqlFile(GRANT_FILE)
    .replace("array['byalex0']", "array['byalex0', 'anderer']")
    .replace('array[20]', 'array[10, 20]');
  expect(edited).not.toBe(sqlFile(GRANT_FILE));
  await db.exec(edited);
  expect((await eggsOf(db, UID_A)).sort()).toEqual(['dayman', 'surebrec']);
  expect((await eggsOf(db, UID_B)).sort()).toEqual(['dayman', 'surebrec']);
});

test('Standard betrifft NUR Stufe 20: ein fehlendes Dayman-Ei (Stufe 10) wird nicht angefasst', async () => {
  const { db } = await buildWorld([{ uid: UID_A, name: 'byalex0' }]);
  await db.exec(sqlFile(GRANT_FILE));
  expect(await eggsOf(db, UID_A)).toEqual(['surebrec']);
});

test('Stufe 20 NICHT abgeholt -> nichts (das normale Abholen im Spiel vergibt das Ei selbst)', async () => {
  const { db } = await buildWorld([{ uid: UID_A, name: 'byalex0', stage: 20, claimed: range(19) }]);
  await db.exec(sqlFile(GRANT_FILE));
  expect(await eggsOf(db, UID_A)).toEqual([]);
  expect(await logOf(db)).toEqual([]);
});

test('Spieler besitzt AKTUELL schon ein Surebrec-Ei -> kein zweites', async () => {
  const { db } = await buildWorld([{ uid: UID_A, name: 'byalex0' }]);
  await db.exec(`insert into public.player_dragon_eggs (name_key, auth_user_id, species_id) values ('byalex0', '${UID_A}', 'surebrec')`);
  await db.exec(sqlFile(GRANT_FILE));
  expect(await eggsOf(db, UID_A)).toEqual(['surebrec']);
  expect(await logOf(db)).toEqual([]);
});

test('Einzelstueck-Art in der Konfiguration (Lightnix/Darknix): wird uebersprungen statt den Lauf abzubrechen', async () => {
  const { db } = await buildWorld([{ uid: UID_A, name: 'byalex0' }]);
  // Konfiguration so verbiegen, dass Stufe 20 ein Einzelstueck verspricht - der Ei-Schutz wuerde es ablehnen.
  await db.exec(`update public.special_events set config = replace(config::text, '"surebrec"', '"lightnix"')::jsonb where id = 'zwielicht'`);
  await db.exec(sqlFile(GRANT_FILE)); // darf NICHT werfen
  expect(await eggsOf(db, UID_A)).toEqual([]);
  expect(await logOf(db)).toEqual([]);
});

test('Nachgeholtes Ei wurde freigelassen -> der naechste Lauf holt es NICHT noch einmal nach (Log-Tabelle)', async () => {
  const { db } = await buildWorld([{ uid: UID_A, name: 'byalex0' }]);
  await db.exec(sqlFile(GRANT_FILE));
  await db.exec(`delete from public.player_dragon_eggs where auth_user_id = '${UID_A}'`);
  await db.exec(sqlFile(GRANT_FILE));
  expect(await eggsOf(db, UID_A)).toEqual([]);
  expect(await logOf(db)).toEqual([[UID_A, 20, 'surebrec']]);
});

test('Vom allgemeinen Nachhol-Lauf schon bedient (Log-Eintrag) -> die gezielte Datei vergibt nichts doppelt', async () => {
  const { db } = await buildWorld([{ uid: UID_A, name: 'byalex0' }]);
  await db.exec(sqlFile(CATCHUP_FILE));            // Dayman + Surebrec (kein Drache, kein Ei -> nichts blockiert)
  expect((await eggsOf(db, UID_A)).sort()).toEqual(['dayman', 'surebrec']);
  await db.exec(`delete from public.player_dragon_eggs where auth_user_id = '${UID_A}' and species_id = 'surebrec'`);
  await db.exec(sqlFile(GRANT_FILE));
  expect(await eggsOf(db, UID_A)).toEqual(['dayman']);
});

test('Die Diagnose-Datei laeuft komplett durch; Abfrage 5 zeigt die Luecke vorher und "nachgeholt" nachher', async () => {
  const { db } = await buildWorld([{ uid: UID_A, name: 'byalex0' }]);
  await hatchedDragon(db, UID_A, 'surebrec');
  // Die Diagnose liest die Log-Tabelle des Nachhol-Laufs -> sie muss existieren (in Produktion tut sie das).
  await db.exec(sqlFile(CATCHUP_FILE));
  const run = async () => await db.exec(sqlFile(DIAG_FILE));
  let res = await run();
  expect(res).toHaveLength(6);
  const q1 = res[0].rows[0];
  // Im Test fehlen Choose-Funktion/Trigger-Installation von -06/-08 teils - die Abfrage selbst muss aber laufen.
  expect(q1.abholen_kennt_species_eggs).toBe(true);
  const q2 = res[1].rows[0];
  expect(q2).toMatchObject({ name_key: 'byalex0', stufe_erreicht: 20, s10_abgeholt: true, s20_abgeholt: true, s30_abgeholt: false });
  const gap = res[4].rows.find(r => r.spieler === 'byalex0' && r.stufe === 20);
  expect(gap).toMatchObject({ art: 'surebrec', nachgeholt: false, ei_jetzt: false });
  expect(Number(gap.drachen_seit_start)).toBe(1);
  await db.exec(sqlFile(GRANT_FILE));
  res = await run();
  const after = res[4].rows.find(r => r.spieler === 'byalex0' && r.stufe === 20);
  expect(after).toMatchObject({ nachgeholt: true, ei_jetzt: true });
  expect(Number(res[5].rows[0].stufe_20_erreicht)).toBe(1);
  expect(Number(res[5].rows[0].stufe_20_abgeholt)).toBe(1);
});
