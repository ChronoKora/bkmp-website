/* sql/20261008-zwielicht-pass-fix-all.sql gegen ECHTES Postgres (PGlite) - 08.10.2026.

   Live-Daten 07.10.: 10 Spieler haben Stufe 20 abgeholt, bagontr01 Stufe 10 - keiner hat
   das Ei bekommen; seit dem Hotfix hat keine normale Abholung ein Pass-Ei erzeugt.
   Ausgangslage im Test daher: die ALTE Abholfunktion ist installiert
   (tests/fixtures/event-claim-tiers-before-hotfix.sql) und die Spieler stehen genau so
   da wie in der Live-Abfrage (abgeholt / nachgeholt / Drachen aus dem Ei-Dungeon). */
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
const readLf = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const sqlFile = name => readLf(path.join(ROOT, 'sql', name));
const FIX = '20261008-zwielicht-pass-fix-all.sql';
const OLD_FN = readLf(path.join(ROOT, 'tests', 'fixtures', 'event-claim-tiers-before-hotfix.sql'));
function between(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  if (a < 0) throw new Error('SQL-Marker nicht gefunden: ' + startMarker);
  const b = endMarker ? text.indexOf(endMarker, a) : text.length;
  if (b < 0) throw new Error('SQL-Endmarker nicht gefunden: ' + endMarker);
  return text.slice(a, b);
}
function claimFunctionOf(text) {
  const a = text.indexOf('create or replace function public.event_claim_tiers(p_event_id text)');
  const end = '\n$$;\n';
  const b = text.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('event_claim_tiers nicht gefunden');
  return text.slice(a, b + end.length - 1);
}
const range = n => Array.from({ length: n }, (_, i) => i + 1);
const uid = n => '00000000-0000-4000-8000-0000000001' + String(n).padStart(2, '0');

/* Spieler wie in der Live-Abfrage vom 07.10. */
const P = {
  dexxtar: { uid: uid(1), name: 'dexxtar_', stage: 21, claimed: range(21), log: [10], dragons: ['dayman'] },
  xxkibo: { uid: uid(2), name: 'xxkibotaxx', stage: 21, claimed: range(21), log: [10], dragons: ['dayman', 'surebrec'] },
  byalex: { uid: uid(3), name: 'byalex0', stage: 20, claimed: range(20), log: [10, 20], eggs: ['surebrec'], dragons: ['dayman'] },
  bagon: { uid: uid(4), name: 'bagontr01', stage: 11, claimed: range(11), log: [], eggs: ['surebrec'] },
  kora: { uid: uid(5), name: 'chronokora', stage: 12, claimed: range(12), log: [10], eggs: ['dayman'] },
  neu: { uid: uid(6), name: 'neuling', stage: 12, claimed: [] },
  // Surebrec-Ei liegt schon im Lager (z.B. aus dem Ei-Dungeon), aber kein Nachhol-Eintrag -> kein zweites.
  egoistin: { uid: uid(7), name: '.egoistin', stage: 21, claimed: range(21), log: [10], eggs: ['surebrec'] },
};
const SPECIES_OF_TIER = { 10: 'dayman', 20: 'surebrec' };

async function buildWorld(opts) {
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
      auth_user_id uuid not null, species_id text not null,
      hatched_at timestamptz not null default now());
    create table public.event_tier_egg_catchup (
      event_id text not null, auth_user_id uuid not null, tier integer not null, species_id text not null,
      egg_id uuid, granted_at timestamptz not null default now(),
      primary key (event_id, auth_user_id, tier, species_id));
  `);
  await db.exec(between(sqlFile('20261004-02-village-projects.sql'),
    'create or replace function public.village_gold_unit', 'create or replace function public.village_seed_int'));
  await db.exec(between(sqlFile('supabase-dragon-breeding.sql'),
    'create table if not exists public.player_dragon_eggs', 'alter table public.player_dragon_eggs enable row level security'));
  await db.exec(between(sqlFile('20261004-08-lightnix-darknix.sql'),
    'create or replace function public.player_dragon_eggs_event_guard()', '-- ---------- Schutz 2'));
  // Live-Zustand: ALTE Abholfunktion (vergibt keine Eier) - oder auf Wunsch schon die korrekte.
  await db.exec(opts && opts.fnAlreadyFixed ? claimFunctionOf(sqlFile('20261004-06-special-events.sql')) : OLD_FN);
  await db.exec(`
    revoke all on function public.event_claim_tiers(text) from public, anon;
    grant execute on function public.event_claim_tiers(text) to authenticated;
    grant select, insert, update on all tables in schema public to authenticated;`);
  await h.insertRows(db, 'dragon_species', [
    { id: 'dayman', name: 'Dayman' }, { id: 'surebrec', name: 'Surebrec' },
    { id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }]);
  await db.exec(`update public.dragon_species set unique_per_account = true, event_origin = 'zwielicht' where id in ('lightnix', 'darknix')`);
  const eventRow = ev.makeZwielichtEventRow({ enabled: true,
    starts_at: new Date(Date.now() - 3 * 86400000).toISOString(), ends_at: new Date(Date.now() + 4 * 86400000).toISOString() });
  await h.insertRows(db, 'special_events', [eventRow]);
  for (const p of Object.values(P)) {
    await h.insertRows(db, 'player_stats', [{ auth_user_id: p.uid, display_name: p.name, name_key: p.name }]);
    await h.insertRows(db, 'idle_player_state', [{ auth_user_id: p.uid, name_key: p.name, highest_dragon_index: 40 }]);
    await h.insertRows(db, 'player_event_progress', [{
      event_id: 'zwielicht', auth_user_id: p.uid, name_key: p.name,
      points: p.stage * eventRow.points_per_tier, tier_claimed: p.claimed }]);
    for (const t of p.log || []) {
      await db.query(`insert into public.event_tier_egg_catchup (event_id, auth_user_id, tier, species_id, granted_at)
                      values ('zwielicht', $1, $2, $3, now() - interval '1 day')`, [p.uid, t, SPECIES_OF_TIER[t]]);
    }
    for (const sp of p.eggs || []) {
      await db.query(`insert into public.player_dragon_eggs (name_key, auth_user_id, species_id, created_at)
                      values ($1, $2, $3, now() - interval '1 day')`, [p.name, p.uid, sp]);
    }
    for (const sp of p.dragons || []) {
      await db.query(`insert into public.player_dragons (auth_user_id, species_id, hatched_at) values ($1, $2, now() - interval '12 hours')`, [p.uid, sp]);
    }
  }
  return { db };
}
const eggsOf = async (db, p) => (await db.query(
  `select species_id from public.player_dragon_eggs where auth_user_id = $1 order by species_id`, [p.uid])).rows.map(r => r.species_id);
const claimsFor = p => ({ sub: p.uid, email: p.name + '@bkmp-player-accounts.com' });
const runFix = async db => db.exec(sqlFile(FIX));
/* Teil 3 = letzte Abfrage der Datei, genau eine Zeile (der SQL-Editor zeigt nur das letzte Ergebnis). */
const controlRow = results => {
  const sel = results.filter(r => r.fields && r.fields.length);
  const last = sel[sel.length - 1];
  expect(last.rows.length).toBe(1);
  return last.rows[0];
};

test('Ausgangslage = Live-Fehler: mit der alten Funktion bringt Abholen KEIN Ei', async () => {
  const { db } = await buildWorld();
  const res = await h.rpc(db, claimsFor(P.neu), 'event_claim_tiers', ['zwielicht']);
  expect(res.eggs).toBeUndefined();
  expect(await eggsOf(db, P.neu)).toEqual([]);
});

test('Funktionskoerper in der Fix-Datei ist WORTGLEICH zu sql/20261004-06 (und zum Hotfix)', async () => {
  const fromFix = claimFunctionOf(sqlFile(FIX));
  expect(fromFix).toBe(claimFunctionOf(sqlFile('20261004-06-special-events.sql')));
  expect(fromFix).toBe(claimFunctionOf(sqlFile('20261006-hotfix-event-claim-tiers-species-eggs.sql')));
  expect(fromFix).toContain('species_eggs');
});

test('Fix: jeder Betroffene bekommt genau das fehlende Ei - auch mit Drachen aus dem Ei-Dungeon', async () => {
  const { db } = await buildWorld();
  const results = await runFix(db);
  expect(await eggsOf(db, P.dexxtar)).toEqual(['surebrec']);              // Stufe 20 fehlte
  expect(await eggsOf(db, P.xxkibo)).toEqual(['surebrec']);               // Dungeon-Surebrec blockiert NICHT mehr
  expect(await eggsOf(db, P.byalex)).toEqual(['surebrec']);               // schon nachgeholt -> kein zweites
  expect(await eggsOf(db, P.bagon)).toEqual(['dayman', 'surebrec']);      // Stufe 10 fehlte (Surebrec war Dungeon)
  expect(await eggsOf(db, P.kora)).toEqual(['dayman']);                   // nichts fehlt
  expect(await eggsOf(db, P.neu)).toEqual([]);                            // nichts abgeholt -> nichts
  expect(await eggsOf(db, P.egoistin)).toEqual(['surebrec']);             // Ei schon da -> kein zweites
  // Kontrolle (Teil 3): eine Zeile mit Vorher/Jetzt, Anzahl und Namen.
  const row = controlRow(results);
  expect(row.vorher_vergab_abholen_eier).toBe(false);
  expect(row.jetzt_vergibt_abholen_eier).toBe(true);
  expect(row.nachgeholte_eier).toBe(3);
  expect(row.an_wen).toBe('bagontr01 (Stufe 10), dexxtar_ (Stufe 20), xxkibotaxx (Stufe 20)');
  expect(row.funktionen_live).toBe('event_claim_tiers(text) [OHNE Eier]');
});

test('Kontrolle meldet "vorher korrekt", wenn die Live-Funktion schon Eier vergab', async () => {
  const { db } = await buildWorld({ fnAlreadyFixed: true });
  const row = controlRow(await runFix(db));
  expect(row.vorher_vergab_abholen_eier).toBe(true);
  expect(row.jetzt_vergibt_abholen_eier).toBe(true);
  expect(row.funktionen_live).toBe('event_claim_tiers(text) [mit Eiern]');
  expect(row.nachgeholte_eier).toBe(3);
});

test('Nach dem Fix: normales Abholen vergibt das Ei (Teil 1 wirkt)', async () => {
  const { db } = await buildWorld();
  await runFix(db);
  const res = await h.rpc(db, claimsFor(P.neu), 'event_claim_tiers', ['zwielicht']);
  expect(res.eggs.map(e => [e.species_id, e.tier])).toEqual([['dayman', 10]]);
  expect(await eggsOf(db, P.neu)).toEqual(['dayman']);
});

test('Zweites Ausfuehren vergibt NICHTS mehr - auch wenn jemand sein neues Ei schon ausgebruetet hat', async () => {
  const { db } = await buildWorld();
  await runFix(db);
  // xxkibotaxx brueet das Ei aus (Ei weg, Drache da); neuling holt normal ab und brueet ebenfalls aus.
  await db.query(`delete from public.player_dragon_eggs where auth_user_id = $1`, [P.xxkibo.uid]);
  await h.rpc(db, claimsFor(P.neu), 'event_claim_tiers', ['zwielicht']);
  await db.query(`delete from public.player_dragon_eggs where auth_user_id = $1`, [P.neu.uid]);
  await runFix(db);
  const row = controlRow(await runFix(db));
  expect(await eggsOf(db, P.xxkibo)).toEqual([]);
  expect(await eggsOf(db, P.neu)).toEqual([]);
  expect(await eggsOf(db, P.dexxtar)).toEqual(['surebrec']);
  expect((await db.query('select count(*)::int as n from public.event_pass_fix_marker')).rows[0].n).toBe(1);
  // Kontrollzeile zeigt weiter den ERSTEN Lauf (Vorher-Zustand nicht ueberschrieben).
  expect(row.vorher_vergab_abholen_eier).toBe(false);
  expect(row.nachgeholte_eier).toBe(3);
});

test('Einzelstueck-Arten werden uebersprungen statt den Lauf abzubrechen', async () => {
  const { db } = await buildWorld();
  await db.exec(`update public.special_events set config = replace(config::text, '"surebrec"', '"lightnix"')::jsonb where id = 'zwielicht'`);
  await runFix(db);
  expect(await eggsOf(db, P.dexxtar)).toEqual([]);
  expect(await eggsOf(db, P.bagon)).toEqual(['dayman', 'surebrec']);
});
