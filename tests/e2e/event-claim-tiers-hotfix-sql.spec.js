/* Hotfix sql/20261006-hotfix-event-claim-tiers-species-eggs.sql - 06.10.2026.

   Live-Pruefung: pg_get_functiondef('public.event_claim_tiers(text)') kannte
   "species_eggs" NICHT -> die Datenbank lief mit der aelteren Fassung. Die Hotfix-
   Datei ersetzt NUR diese Funktion. Dieser Test fuehrt die Datei GENAU SO aus, wie
   der Betreiber sie im Supabase-SQL-Editor ausfuehrt (komplette Datei), gegen ein
   echtes Postgres (PGlite) - und zwar auf einer Datenbank, in der vorher die ALTE
   Funktion installiert ist (tests/fixtures/event-claim-tiers-before-hotfix.sql,
   Fassung aus Commit d7585cf).

   Geprueft wird:
     * die Datei tut ausser der Funktion nichts anderes (nur revoke/grant + 1 select)
     * der Funktionskoerper ist wortgleich zu sql/20261004-06 (kein zweiter Stand)
     * alt: Stufe 10 markiert abgeholt OHNE Ei (= der Live-Fehler)
     * nach dem Hotfix: Stufe 10 -> dayman, Stufe 20 -> surebrec, je genau einmal
     * normale Stufenbelohnungen (Ressourcen/Runen/Booster/Freischaltungen) unveraendert
     * Fehlerfall: nichts wird als abgeholt markiert, nichts gutgeschrieben, kein Ei
     * Rechte: angemeldet darf abholen, anonym nicht
     * Kette alt -> Hotfix -> Nachhol-SQL heilt auch bereits Betroffene */
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
// CRLF -> LF: unter Windows (core.autocrlf) sind die Dateien CRLF, die Marker sind LF.
const readLf = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const sqlFile = name => readLf(path.join(ROOT, 'sql', name));
const HOTFIX = '20261006-hotfix-event-claim-tiers-species-eggs.sql';
const OLD_FN = readLf(path.join(ROOT, 'tests', 'fixtures', 'event-claim-tiers-before-hotfix.sql'));

function between(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  if (a < 0) throw new Error('SQL-Marker nicht gefunden: ' + startMarker);
  const b = endMarker ? text.indexOf(endMarker, a) : text.length;
  if (b < 0) throw new Error('SQL-Endmarker nicht gefunden: ' + endMarker);
  return text.slice(a, b);
}
/* Funktionskoerper "create or replace function public.event_claim_tiers ... $$;" */
function claimFunctionOf(text) {
  const a = text.indexOf('create or replace function public.event_claim_tiers(p_event_id text)');
  const end = '\n$$;\n';
  const b = text.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('event_claim_tiers nicht gefunden');
  return text.slice(a, b + end.length - 1);
}

const UID = '00000000-0000-4000-8000-000000000042';
const UID2 = '00000000-0000-4000-8000-000000000043';
const NAME = 'daymanfan';
const NAME2 = 'zweiterspieler';
const CLAIMS = { sub: UID, email: NAME + '@bkmp-player-accounts.com' };
const CLAIMS2 = { sub: UID2, email: NAME2 + '@bkmp-player-accounts.com' };
const range = n => Array.from({ length: n }, (_, i) => i + 1);

/* Welt wie in event-claim-tiers-sql.spec.js; die Abholfunktion ist aber waehlbar:
   fn: 'old' = Fassung vor dem Hotfix | 'none' = noch keine installiert (der Hotfix kommt spaeter). */
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
    create table public.player_dragons (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null, species_id text not null,
      hatched_at timestamptz not null default now());
  `);
  await db.exec(between(sqlFile('20261004-02-village-projects.sql'),
    'create or replace function public.village_gold_unit', 'create or replace function public.village_seed_int'));
  await db.exec(between(sqlFile('supabase-dragon-breeding.sql'),
    'create table if not exists public.player_dragon_eggs', 'alter table public.player_dragon_eggs enable row level security'));
  await db.exec(between(sqlFile('20261004-08-lightnix-darknix.sql'),
    'create or replace function public.player_dragon_eggs_event_guard()', '-- ---------- Schutz 2'));
  if ((o.fn || 'old') === 'old') {
    await db.exec(OLD_FN);
    await db.exec(`
      revoke all on function public.event_claim_tiers(text) from public, anon;
      grant execute on function public.event_claim_tiers(text) to authenticated;`);
  }
  await db.exec(`grant select, insert, update on all tables in schema public to authenticated;`);

  const species = o.species || [
    { id: 'dayman', name: 'Dayman' }, { id: 'surebrec', name: 'Surebrec' },
    { id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }];
  await h.insertRows(db, 'dragon_species', species);
  await db.exec(`update public.dragon_species set unique_per_account = true, event_origin = 'zwielicht'
                  where id in ('lightnix', 'darknix')`);

  const eventRow = ev.makeZwielichtEventRow({ enabled: true,
    starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 5 * 86400000).toISOString() });
  await h.insertRows(db, 'special_events', [eventRow]);
  const players = o.players || [{ uid: UID, name: NAME, tiers: o.tiers === undefined ? 10 : o.tiers, claimed: o.claimed || [] }];
  for (const p of players) {
    await h.insertRows(db, 'player_stats', [{ auth_user_id: p.uid, display_name: p.name, name_key: p.name }]);
    await h.insertRows(db, 'idle_player_state', [{ auth_user_id: p.uid, name_key: p.name, highest_dragon_index: 40 }]);
    await h.insertRows(db, 'player_event_progress', [{
      event_id: 'zwielicht', auth_user_id: p.uid, name_key: p.name,
      points: p.tiers * eventRow.points_per_tier, tier_claimed: p.claimed || [] }]);
  }
  return { db, eventRow };
}
const applyHotfix = db => db.exec(sqlFile(HOTFIX));
const eggs = async (db, uid) => (await db.query(
  `select species_id from public.player_dragon_eggs ${uid ? `where auth_user_id = '${uid}'` : ''} order by created_at, species_id`)).rows.map(r => r.species_id);
const claimedOf = async (db, uid) => (await db.query(`select tier_claimed from public.player_event_progress where auth_user_id = '${uid || UID}'`)).rows[0].tier_claimed;
const stateOf = async (db, uid) => (await db.query(`select * from public.idle_player_state where auth_user_id = '${uid || UID}'`)).rows[0];
const progressOf = async (db, uid) => {
  const r = (await db.query(`select tier_claimed, unlocks from public.player_event_progress where auth_user_id = '${uid || UID}'`)).rows[0];
  return { tier_claimed: r.tier_claimed, unlocks: r.unlocks };
};
const claim = (db, claims) => h.rpc(db, claims || CLAIMS, 'event_claim_tiers', ['zwielicht']);
const knowsSpeciesEggs = async db => (await db.query(
  `select position('species_eggs' in pg_get_functiondef('public.event_claim_tiers(text)'::regprocedure)) > 0 as k`)).rows[0].k;

/* ---------------- Aufbau der Datei ---------------- */
test('Datei: enthaelt ausser der EINEN Funktion nur revoke/grant (diese Funktion) und eine lesende Kontrollabfrage', async () => {
  const text = sqlFile(HOTFIX);
  const fn = claimFunctionOf(text);
  const rest = text.replace(fn, '')
    .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  const statements = rest.split(';').map(s => s.trim()).filter(Boolean);
  expect(statements.length).toBe(3);
  expect(statements[0]).toMatch(/^revoke all on function public\.event_claim_tiers\(text\) from public, anon$/);
  expect(statements[1]).toMatch(/^grant execute on function public\.event_claim_tiers\(text\) to authenticated$/);
  expect(statements[2]).toMatch(/^select position\('species_eggs' in pg_get_functiondef\('public\.event_claim_tiers\(text\)'::regprocedure\)\) > 0/);
  // Nur CODE zaehlt (Kommentare duerfen das Wort "create" enthalten).
  const code = text.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  // genau eine create-Anweisung, und zwar fuer diese Funktion
  expect((code.match(/\bcreate\b/gi) || []).length).toBe(1);
  expect((code.match(/create or replace function public\.event_claim_tiers\(p_event_id text\)/g) || []).length).toBe(1);
  // nichts Gefaehrliches im gesamten Code der Datei
  for (const bad of [/\bcreate\s+table\b/i, /\bcreate\s+policy\b/i, /\bdrop\b/i, /\balter\b/i, /\btruncate\b/i, /\bdelete\s+from\b/i,
    /\bcreate\s+trigger\b/i, /\bcreate\s+index\b/i, /\bnotify\b/i, /\bdo\s+\$\$/i]) {
    expect(code, String(bad)).not.toMatch(bad);
  }
  // die einzigen Schreibzugriffe stehen IN der Funktion (Ressourcen, Fortschritt, Eier)
  const writes = (fn.match(/\b(insert\s+into|update|delete\s+from)\s+public\.[a-z_]+/gi) || []).map(s => s.replace(/\s+/g, ' ').toLowerCase()).sort();
  expect(writes).toEqual(['insert into public.player_dragon_eggs', 'update public.idle_player_state', 'update public.player_event_progress']);
});

test('Datei: Funktionskoerper ist WORTGLEICH zu sql/20261004-06-special-events.sql (kein zweiter Stand)', async () => {
  const fromHotfix = claimFunctionOf(sqlFile(HOTFIX));
  const fromMigration = claimFunctionOf(sqlFile('20261004-06-special-events.sql'));
  expect(fromHotfix).toBe(fromMigration);
  expect(fromHotfix).toContain('species_eggs');
  expect(fromHotfix).toContain("raise exception 'reward_species_missing'");
});

/* ---------------- Kette: alt -> Hotfix ---------------- */
test('ALT (Live-Zustand): Stufe 10 wird als abgeholt markiert, aber es entsteht KEIN Ei', async () => {
  const { db } = await buildWorld({ tiers: 10 });
  expect(await knowsSpeciesEggs(db)).toBe(false);
  const res = await claim(db);
  expect(res.eggs).toBeUndefined();
  expect(await eggs(db)).toEqual([]);
  expect(await claimedOf(db)).toEqual(range(10));
});

test('Hotfix: komplette Datei laeuft durch, Kontrollabfrage liefert true / true / false, zweiter Lauf ebenfalls fehlerfrei', async () => {
  const { db } = await buildWorld({ tiers: 10 });
  expect(await knowsSpeciesEggs(db)).toBe(false);
  const results = await applyHotfix(db);
  const last = results[results.length - 1].rows[0];
  expect(last).toEqual({ funktion_kennt_species_eggs: true, angemeldete_spieler_duerfen_abholen: true, anonyme_besucher_duerfen_abholen: false });
  expect(await knowsSpeciesEggs(db)).toBe(true);
  const again = await applyHotfix(db);
  expect(again[again.length - 1].rows[0].funktion_kennt_species_eggs).toBe(true);
});

test('Nach dem Hotfix: Stufe 10 -> genau EIN Dayman-Ei, Stufe wird abgeholt, zweiter Abholversuch legt nichts doppelt an', async () => {
  const { db } = await buildWorld({ tiers: 10 });
  await applyHotfix(db);
  const res = await claim(db);
  expect(res.eggs.map(e => [e.species_id, e.tier])).toEqual([['dayman', 10]]);
  expect(await eggs(db)).toEqual(['dayman']);
  expect(await claimedOf(db)).toEqual(range(10));
  const second = await claim(db);
  expect(second.eggs).toEqual([]);
  expect(second.items).toEqual([]);
  expect(await eggs(db)).toEqual(['dayman']);
});

test('Nach dem Hotfix: Stufe 20 -> Dayman (10) UND Surebrec (20), je genau einmal; spaeter erneut abholen nichts neues', async () => {
  const { db } = await buildWorld({ tiers: 20 });
  await applyHotfix(db);
  const res = await claim(db);
  expect(res.eggs.map(e => [e.species_id, e.tier])).toEqual([['dayman', 10], ['surebrec', 20]]);
  expect((await eggs(db)).sort()).toEqual(['dayman', 'surebrec']);
  await claim(db);
  expect((await eggs(db)).sort()).toEqual(['dayman', 'surebrec']);
});

test('Nach dem Hotfix: in Etappen abgeholt (erst bis 9, dann bis 20) -> Dayman erst bei Stufe 10, Surebrec erst bei 20, nie doppelt', async () => {
  const { db } = await buildWorld({ tiers: 9 });
  await applyHotfix(db);
  expect((await claim(db)).eggs).toEqual([]);
  await db.exec(`update public.player_event_progress set points = 1500 where auth_user_id = '${UID}'`);
  expect((await claim(db)).eggs.map(e => e.species_id)).toEqual(['dayman']);
  await db.exec(`update public.player_event_progress set points = 2000 where auth_user_id = '${UID}'`);
  expect((await claim(db)).eggs.map(e => e.species_id)).toEqual(['surebrec']);
  expect((await claim(db)).eggs).toEqual([]);
  expect((await eggs(db)).sort()).toEqual(['dayman', 'surebrec']);
});

/* ---------------- Normale Belohnungen unveraendert ---------------- */
test('Normale Stufenbelohnungen unveraendert: alt vs. Hotfix liefern auf allen 30 Stufen identische items/unlocks/credited/Ressourcen/Fortschritt (nur die Eier kommen dazu)', async () => {
  const a = await buildWorld({ tiers: 30 });                       // Live-Zustand (alte Funktion)
  const b = await buildWorld({ tiers: 30 }); await applyHotfix(b.db); // mit Hotfix
  const ra = await claim(a.db);
  const rb = await claim(b.db);
  // Der EINZIGE Unterschied im Ergebnis: der neue Schluessel "eggs".
  const { eggs: newEggs, ...rbRest } = rb;
  expect(newEggs.map(e => [e.species_id, e.tier])).toEqual([['dayman', 10], ['surebrec', 20]]);
  expect(rbRest).toEqual(ra);
  expect(ra.items.length).toBe(30);
  // Ressourcen/Gold/Fortschritt in der Datenbank identisch.
  expect(await stateOf(b.db)).toEqual(await stateOf(a.db));
  expect(await progressOf(b.db)).toEqual(await progressOf(a.db));
  expect(await claimedOf(b.db)).toEqual(range(30));
  // und es wurde wirklich etwas gutgeschrieben (der Vergleich ist nicht leer)
  const st = await stateOf(b.db);
  expect(Number(st.gold)).toBeGreaterThan(0);
  expect(Number(st.wood)).toBeGreaterThan(0);
});

/* ---------------- Fehlerfaelle ---------------- */
test('Fehlerfall: Art fehlt -> reward_species_missing, KEINE Stufe als abgeholt markiert, nichts gutgeschrieben, kein Ei', async () => {
  const { db } = await buildWorld({ tiers: 10, fn: 'none',
    species: [{ id: 'surebrec', name: 'Surebrec' }, { id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }] });
  await applyHotfix(db);
  const before = await stateOf(db);
  await expect(claim(db)).rejects.toThrow(/reward_species_missing/);
  expect(await claimedOf(db)).toEqual([]);
  expect(await eggs(db)).toEqual([]);
  expect(await stateOf(db)).toEqual(before);
});

test('Fehlerfall mitten in der Eiervergabe: Dayman waere ok, Surebrec fehlt -> alles zurueckgerollt (kein verwaistes Dayman-Ei, nichts abgeholt)', async () => {
  const { db } = await buildWorld({ tiers: 20, fn: 'none',
    species: [{ id: 'dayman', name: 'Dayman' }, { id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }] });
  await applyHotfix(db);
  const before = await stateOf(db);
  await expect(claim(db)).rejects.toThrow(/reward_species_missing/);
  expect(await eggs(db)).toEqual([]);
  expect(await claimedOf(db)).toEqual([]);
  expect(await stateOf(db)).toEqual(before);
});

test('Fehlerfall: Ei-Schutz lehnt eine Einzelstueck-Art ab -> nichts abgeholt, nichts gutgeschrieben, kein Ei', async () => {
  const { db } = await buildWorld({ tiers: 10, fn: 'none' });
  await applyHotfix(db);
  await db.exec(`update public.special_events set config = replace(config::text, '"dayman"', '"lightnix"')::jsonb where id = 'zwielicht'`);
  const before = await stateOf(db);
  await expect(claim(db)).rejects.toThrow(/event_species_egg_not_allowed/);
  expect(await claimedOf(db)).toEqual([]);
  expect(await eggs(db)).toEqual([]);
  expect(await stateOf(db)).toEqual(before);
});

test('Nach behobenem Fehler ist die Stufe wieder abholbar (Art nachtraeglich angelegt -> Ei kommt)', async () => {
  const { db } = await buildWorld({ tiers: 10, fn: 'none',
    species: [{ id: 'surebrec', name: 'Surebrec' }, { id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }] });
  await applyHotfix(db);
  await expect(claim(db)).rejects.toThrow(/reward_species_missing/);
  await h.insertRows(db, 'dragon_species', [{ id: 'dayman', name: 'Dayman' }]);
  const res = await claim(db);
  expect(res.eggs.map(e => e.species_id)).toEqual(['dayman']);
  expect(await claimedOf(db)).toEqual(range(10));
});

/* ---------------- Rechte ---------------- */
test('Rechte: angemeldet darf abholen, anonym nicht', async () => {
  const { db } = await buildWorld({ tiers: 10, fn: 'none' });
  await applyHotfix(db);
  await expect(h.callAs(db, null, 'select public.event_claim_tiers($1) as r', ['zwielicht'])).rejects.toThrow(/permission denied/);
  expect((await claim(db)).eggs.map(e => e.species_id)).toEqual(['dayman']);
});

/* ---------------- Kette alt -> Hotfix -> Nachhol-SQL ---------------- */
test('Kette: Spieler A hat mit der ALTEN Funktion abgeholt (kein Ei), Hotfix, dann Spieler B (neu) -> B bekommt Ei, A noch nicht; Nachhol-SQL heilt A genau einmal', async () => {
  const { db } = await buildWorld({ players: [
    { uid: UID, name: NAME, tiers: 10, claimed: [] },
    { uid: UID2, name: NAME2, tiers: 10, claimed: [] }] });
  // A holt noch mit der alten Funktion ab -> abgeholt, aber kein Ei (der Live-Fehler).
  await claim(db, CLAIMS);
  expect(await eggs(db, UID)).toEqual([]);
  expect(await claimedOf(db, UID)).toEqual(range(10));
  // Hotfix einspielen.
  await applyHotfix(db);
  // B holt NACH dem Hotfix ab -> Ei.
  expect((await claim(db, CLAIMS2)).eggs.map(e => e.species_id)).toEqual(['dayman']);
  expect(await eggs(db, UID2)).toEqual(['dayman']);
  // A erneut abholen: Stufe ist schon abgeholt -> der Hotfix allein heilt A NICHT (bewusst: dafuer ist die Nachhol-SQL da).
  expect((await claim(db, CLAIMS)).eggs).toEqual([]);
  expect(await eggs(db, UID)).toEqual([]);
  // Nachhol-SQL (separater, manueller Schritt): A bekommt genau EIN Ei, B (hat schon eins) keins zusaetzlich.
  await db.exec(sqlFile('20261005-zwielicht-pass-egg-catchup.sql'));
  await db.exec(sqlFile('20261005-zwielicht-pass-egg-catchup.sql'));
  expect(await eggs(db, UID)).toEqual(['dayman']);
  expect(await eggs(db, UID2)).toEqual(['dayman']);
});
