/* Zwielicht-Pass Stufe 30 (Wahl Lightnix/Darknix) gegen ECHTES Postgres (PGlite) - 07.10.2026.

   Anlass: Nach dem Stufe-10/20-Hotfix sollte ausdruecklich geprueft werden, dass auch das
   Stufe-30-Ei funktioniert. Bisher lief event_choose_reward() nur gegen den JS-Nachbau
   (tests/mock/event-engine.js), nie gegen die echte SQL. Live gibt es noch kein einziges
   Lightnix-/Darknix-Ei (Stand 07.10.) - der Pfad wurde in Produktion also noch nie benutzt.

   Dieser Test fuehrt die ECHTEN Definitionen aus
     sql/20261004-06-special-events.sql   (event_choose_reward, event_claim_tiers)
     sql/20261004-08-lightnix-darknix.sql (Ei-Schutz + Einzelstueck-Schutz beim Schluepfen)
     sql/supabase-dragon-breeding.sql     (Tabelle player_dragon_eggs)
   aus und prueft Wahl -> Ei -> Schluepfen genau so, wie der Browser es aufruft
   (hatchDragonEgg in supabase.js: Drache einfuegen, WAEHREND das Ei noch existiert,
   danach Ei loeschen). */
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

const UID = '00000000-0000-4000-8000-0000000000a1';
const NAME = 'stufe30fan';
const CLAIMS = { sub: UID, email: NAME + '@bkmp-player-accounts.com' };
const POINTS_FOR_30 = 3000; // 30 Stufen x 100 Punkte

async function buildWorld(opts) {
  const o = opts || {};
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
    -- Minimaler Stand-in fuer player_dragons: genau die Spalten, die der echte
    -- Einzelstueck-Schutz (-08) liest/schreibt.
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
  // -08: Ei-Schutz (Schutz 1) UND Einzelstueck-Schutz beim Schluepfen (Schutz 2) - beide echt.
  await db.exec(between(sqlFile('20261004-08-lightnix-darknix.sql'),
    'create or replace function public.player_dragon_eggs_event_guard()', 'notify pgrst'));
  // -06: Abholen + Hauptbelohnung waehlen - echt.
  await db.exec(between(sqlFile('20261004-06-special-events.sql'),
    'create or replace function public.event_claim_tiers', '-- ---------- Sichtbare Events'));
  await db.exec(`
    revoke all on function public.event_claim_tiers(text) from public, anon;
    grant execute on function public.event_claim_tiers(text) to authenticated;
    revoke all on function public.event_choose_reward(text, text) from public, anon;
    grant execute on function public.event_choose_reward(text, text) to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);

  await h.insertRows(db, 'dragon_species', [
    { id: 'dayman', name: 'Dayman' }, { id: 'surebrec', name: 'Surebrec' },
    { id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }]);
  await db.exec(`update public.dragon_species set unique_per_account = true, event_origin = 'zwielicht'
                  where id in ('lightnix', 'darknix')`);

  const eventRow = ev.makeZwielichtEventRow({ enabled: true,
    starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 5 * 86400000).toISOString() });
  await h.insertRows(db, 'special_events', [eventRow]);
  await h.insertRows(db, 'player_stats', [{ auth_user_id: UID, display_name: 'Stufe30Fan', name_key: NAME }]);
  await h.insertRows(db, 'idle_player_state', [{ auth_user_id: UID, name_key: NAME, highest_dragon_index: 40 }]);
  await h.insertRows(db, 'player_event_progress', [{
    event_id: 'zwielicht', auth_user_id: UID, name_key: NAME,
    points: o.points === undefined ? POINTS_FOR_30 : o.points,
    earned: o.earned === undefined ? true : o.earned,
    tier_claimed: o.claimed || [] }]);
  return { db, eventRow };
}

const eggs = async db => (await db.query('select species_id from public.player_dragon_eggs order by created_at, species_id')).rows.map(r => r.species_id);
const progress = async db => (await db.query(`select choice_species, chosen_at, tier_claimed from public.player_event_progress where auth_user_id = '${UID}'`)).rows[0];
const claimRows = async db => (await db.query('select reward_group, species_id, egg_id from public.player_event_reward_claims')).rows;
const choose = (db, species) => h.rpc(db, CLAIMS, 'event_choose_reward', ['zwielicht', species]);
const range = n => Array.from({ length: n }, (_, i) => i + 1);

test('Fixture entspricht der Live-Konfiguration: 30 Stufen x 100 Punkte, Wahl Lightnix/Darknix, 1 Wahl pro Konto', async () => {
  const { eventRow } = await buildWorld();
  expect(eventRow.tier_count).toBe(30);
  expect(eventRow.points_per_tier).toBe(100);
  expect(eventRow.choice_mode).toBe('player_choice');
  expect(eventRow.reward_species).toEqual(['lightnix', 'darknix']);
  expect(eventRow.lifetime_claim_limit).toBe(1);
  expect(eventRow.reward_group).toBe('zwielicht');
  const t30 = eventRow.config.tiers.find(t => t.tier === 30);
  expect(t30.reward.choice).toBe(true);
});

test('Stufe 30 erreicht: Lightnix waehlen -> genau EIN Lightnix-Ei, Wahl + Beleg gespeichert', async () => {
  const { db } = await buildWorld();
  const res = await choose(db, 'lightnix');
  expect(res.species_id).toBe('lightnix');
  expect(res.egg_id).toBeTruthy();
  expect(await eggs(db)).toEqual(['lightnix']);
  const p = await progress(db);
  expect(p.choice_species).toBe('lightnix');
  expect(p.chosen_at).toBeTruthy();
  const claims = await claimRows(db);
  expect(claims).toHaveLength(1);
  expect(claims[0]).toMatchObject({ reward_group: 'zwielicht', species_id: 'lightnix', egg_id: res.egg_id });
});

test('Darknix waehlen -> genau EIN Darknix-Ei und KEIN Lightnix-Ei', async () => {
  const { db } = await buildWorld();
  const res = await choose(db, 'darknix');
  expect(res.species_id).toBe('darknix');
  expect(await eggs(db)).toEqual(['darknix']);
  expect((await progress(db)).choice_species).toBe('darknix');
});

test('Erst alle Stufen abholen (inkl. Stufe 30 = Wahl-Stufe), danach waehlen: beides funktioniert, nur EIN Wahl-Ei', async () => {
  const { db } = await buildWorld({ claimed: [] });
  const claim = await h.rpc(db, CLAIMS, 'event_claim_tiers', ['zwielicht']);
  // Dayman (10) + Surebrec (20); Stufe 30 selbst vergibt KEIN Ei (nur die Wahl-Markierung).
  expect(claim.eggs.map(e => [e.species_id, e.tier])).toEqual([['dayman', 10], ['surebrec', 20]]);
  expect((await progress(db)).tier_claimed).toEqual(range(30));
  // Die Wahl haengt NICHT an tier_claimed - sie funktioniert auch, wenn Stufe 30 schon als abgeholt markiert ist.
  const res = await choose(db, 'lightnix');
  expect(res.egg_id).toBeTruthy();
  expect((await eggs(db)).sort()).toEqual(['dayman', 'lightnix', 'surebrec']);
});

test('Stufe 30 noch NICHT erreicht (earned=false): not_earned, kein Ei', async () => {
  const { db } = await buildWorld({ points: 2900, earned: false });
  await expect(choose(db, 'lightnix')).rejects.toThrow(/not_earned/);
  expect(await eggs(db)).toEqual([]);
  expect((await progress(db)).choice_species).toBeNull();
});

test('Zweite Wahl (gleiche oder andere Art): already_chosen, es bleibt bei EINEM Ei', async () => {
  const { db } = await buildWorld();
  await choose(db, 'lightnix');
  await expect(choose(db, 'lightnix')).rejects.toThrow(/already_chosen/);
  await expect(choose(db, 'darknix')).rejects.toThrow(/already_chosen/);
  expect(await eggs(db)).toEqual(['lightnix']);
  expect(await claimRows(db)).toHaveLength(1);
});

test('Ungueltige Art (nicht in reward_species): invalid_choice, kein Ei', async () => {
  const { db } = await buildWorld();
  await expect(choose(db, 'dayman')).rejects.toThrow(/invalid_choice/);
  await expect(choose(db, 'gibtesnicht')).rejects.toThrow(/invalid_choice/);
  expect(await eggs(db)).toEqual([]);
});

test('Lebenszeit-Limit der Belohnungsgruppe schon verbraucht (anderes Event, gleiche Gruppe): claim_limit_reached', async () => {
  const { db } = await buildWorld();
  await db.exec(`insert into public.player_event_reward_claims (reward_group, auth_user_id, event_id, species_id)
                 values ('zwielicht', '${UID}', 'zwielicht-vorjahr', 'lightnix')`);
  await expect(choose(db, 'darknix')).rejects.toThrow(/claim_limit_reached/);
  expect(await eggs(db)).toEqual([]);
});

test('Anonym darf nicht waehlen', async () => {
  const { db } = await buildWorld();
  await expect(h.rpc(db, null, 'event_choose_reward', ['zwielicht', 'lightnix'])).rejects.toThrow(/permission denied/);
  expect(await eggs(db)).toEqual([]);
});

test('Ei-Schutz bleibt auch nach der Wahl aktiv: ein Spieler kann sich Lightnix-Eier NICHT selbst einfuegen', async () => {
  const { db } = await buildWorld();
  await choose(db, 'lightnix');
  await expect(h.callAs(db, CLAIMS,
    `insert into public.player_dragon_eggs (name_key, auth_user_id, species_id) values ('${NAME}', '${UID}', 'lightnix')`))
    .rejects.toThrow(/event_species_egg_not_allowed/);
  await expect(h.callAs(db, CLAIMS,
    `insert into public.player_dragon_eggs (name_key, auth_user_id, species_id) values ('${NAME}', '${UID}', 'darknix')`))
    .rejects.toThrow(/event_species_egg_not_allowed/);
  expect(await eggs(db)).toEqual(['lightnix']);
});

test('Schluepfen wie im Browser (hatchDragonEgg): Drache einfuegen, WAEHREND das Ei existiert, dann Ei loeschen -> klappt, Herkunft = zwielicht', async () => {
  const { db } = await buildWorld();
  const { egg_id } = await choose(db, 'lightnix');
  // 1) Drache anlegen (Ei existiert noch) - als Spieler, ohne vertrauenswuerdiges Flag.
  await h.callAs(db, CLAIMS,
    `insert into public.player_dragons (auth_user_id, name_key, species_id, stage) values ('${UID}', '${NAME}', 'lightnix', 'baby')`);
  // 2) Ei loeschen.
  await h.callAs(db, CLAIMS, `delete from public.player_dragon_eggs where id = '${egg_id}'`);
  const d = (await db.query('select species_id, stage, origin_event from public.player_dragons')).rows;
  expect(d).toEqual([{ species_id: 'lightnix', stage: 'baby', origin_event: 'zwielicht' }]);
  expect(await eggs(db)).toEqual([]);
});

test('Einzelstueck-Schutz beim Schluepfen: ohne Ei -> unique_species_needs_egg, zweiter Drache -> unique_species_already_owned', async () => {
  const { db } = await buildWorld();
  const insertDragon = sp => h.callAs(db, CLAIMS,
    `insert into public.player_dragons (auth_user_id, name_key, species_id, stage) values ('${UID}', '${NAME}', '${sp}', 'baby')`);
  // Noch gar keine Wahl getroffen -> kein Ei -> kein Lightnix-Drache.
  await expect(insertDragon('lightnix')).rejects.toThrow(/unique_species_needs_egg/);
  await choose(db, 'lightnix');
  await insertDragon('lightnix');
  await expect(insertDragon('lightnix')).rejects.toThrow(/unique_species_already_owned/);
  // Die andere Art ist gesperrt, solange man kein Darknix-Ei hat.
  await expect(insertDragon('darknix')).rejects.toThrow(/unique_species_needs_egg/);
});

test('Normale Arten (Dayman/Surebrec) sind vom Einzelstueck-Schutz NICHT betroffen: mehrere Drachen + Eier erlaubt', async () => {
  const { db } = await buildWorld();
  const insertEgg = sp => h.callAs(db, CLAIMS,
    `insert into public.player_dragon_eggs (name_key, auth_user_id, species_id) values ('${NAME}', '${UID}', '${sp}')`);
  await insertEgg('dayman'); await insertEgg('dayman'); await insertEgg('surebrec');
  await h.callAs(db, CLAIMS, `insert into public.player_dragons (auth_user_id, name_key, species_id) values ('${UID}', '${NAME}', 'dayman')`);
  await h.callAs(db, CLAIMS, `insert into public.player_dragons (auth_user_id, name_key, species_id) values ('${UID}', '${NAME}', 'dayman')`);
  expect((await eggs(db)).sort()).toEqual(['dayman', 'dayman', 'surebrec']);
});
