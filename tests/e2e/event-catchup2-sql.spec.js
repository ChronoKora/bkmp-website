/* Zwielicht-Pass: Nachhol-Lauf 2 - sql/20261006-zwielicht-pass-egg-catchup-2.sql (06.10.2026).

   Anlass: Der erste Nachhol-Lauf (20261005-zwielicht-pass-egg-catchup.sql) ueberspringt
   jeden Spieler, der "seit Eventstart einen Dayman-Drachen geschluepft" oder ein
   Dayman-Ei hat. Dayman ist aber auch im normalen Ei-Wurf (Dungeon) - Live-Pruefung:
   5 Spieler haben Stufe 10 abgeholt, nie ein Pass-Ei bekommen, aber einen Dayman aus
   dem Dungeon -> uebersprungen. Dieser Test fuehrt die ECHTEN SQL-Dateien gegen
   echtes Postgres (PGlite) aus.

   Geprueft: der Fehler von Lauf 1 ist reproduziert; Lauf 2 vergibt genau EIN Ei pro
   Listen-Spieler (auch mit Dungeon-Dayman), fasst Nicht-Gelistete, nie Abgeholte und
   bereits Nachgeholte NICHT an, ist beliebig oft ausfuehrbar und in beliebiger
   Reihenfolge mit Lauf 1 kombinierbar. */
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
const sqlFile = name => fs.readFileSync(path.join(ROOT, 'sql', name), 'utf8').replace(/\r\n/g, '\n');
const CATCHUP1 = '20261005-zwielicht-pass-egg-catchup.sql';
const CATCHUP2 = '20261006-zwielicht-pass-egg-catchup-2.sql';
function between(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  if (a < 0) throw new Error('SQL-Marker nicht gefunden: ' + startMarker);
  const b = endMarker ? text.indexOf(endMarker, a) : text.length;
  if (b < 0) throw new Error('SQL-Endmarker nicht gefunden: ' + endMarker);
  return text.slice(a, b);
}

/* Die 5 Namen aus der Live-Pruefung. Die UIDs sind frei gewaehlt (nur Testdaten). */
const LISTED = ['.egoistin', 'bärli', 'chronokora', 'frecheschaos', 'kaledoss'];
const uidOf = i => '00000000-0000-4000-8000-0000000001' + String(10 + i).padStart(2, '0');
const UID = Object.fromEntries(LISTED.map((n, i) => [n, uidOf(i)]));
const UID_FREMD = uidOf(20);       // steht NICHT auf der Liste, Stufe 10 abgeholt, kein Ei
const UID_UNGEZOGEN = uidOf(21);   // Stufe 10 erreicht, aber nie abgeholt
const range = n => Array.from({ length: n }, (_, i) => i + 1);

async function buildWorld(opts) {
  const o = opts || {};
  const db = await h.createEventDb({ install: false });
  await db.exec(`
    alter table public.dragon_species add column if not exists unique_per_account boolean not null default false;
    alter table public.dragon_species add column if not exists event_origin text;
    create table public.idle_player_state (
      auth_user_id uuid primary key, name_key text not null, highest_dragon_index bigint not null default 0);
    create table public.player_dragons (
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid not null, species_id text not null,
      hatched_at timestamptz not null default now());
  `);
  await db.exec(between(sqlFile('supabase-dragon-breeding.sql'),
    'create table if not exists public.player_dragon_eggs', 'alter table public.player_dragon_eggs enable row level security'));
  await db.exec(between(sqlFile('20261004-08-lightnix-darknix.sql'),
    'create or replace function public.player_dragon_eggs_event_guard()', '-- ---------- Schutz 2'));
  await h.insertRows(db, 'dragon_species', o.species || [
    { id: 'dayman', name: 'Dayman' }, { id: 'surebrec', name: 'Surebrec' },
    { id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }]);
  await db.exec(`update public.dragon_species set unique_per_account = true, event_origin = 'zwielicht'
                  where id in ('lightnix', 'darknix')`);
  // Live existiert das Nachhol-Log schon (Lauf 1 hat es angelegt) -> hier genauso anlegen.
  if (o.logExists) await db.exec(between(sqlFile(CATCHUP1),
    'create table if not exists public.event_tier_egg_catchup', 'alter table public.event_tier_egg_catchup enable row level security'));
  const eventRow = ev.makeZwielichtEventRow({ enabled: true,
    starts_at: new Date(Date.now() - 2 * 86400000).toISOString(), ends_at: new Date(Date.now() + 5 * 86400000).toISOString() });
  await h.insertRows(db, 'special_events', [eventRow]);
  const players = o.players || [];
  for (const p of players) {
    await h.insertRows(db, 'player_stats', [{ auth_user_id: p.uid, display_name: p.name, name_key: p.name }]);
    await h.insertRows(db, 'idle_player_state', [{ auth_user_id: p.uid, name_key: p.name, highest_dragon_index: 40 }]);
    await h.insertRows(db, 'player_event_progress', [{
      event_id: 'zwielicht', auth_user_id: p.uid, name_key: p.name,
      points: (p.tiers === undefined ? 10 : p.tiers) * eventRow.points_per_tier,
      tier_claimed: p.claimed === undefined ? range(10) : p.claimed }]);
  }
  return { db };
}
const run1 = db => db.exec(sqlFile(CATCHUP1));
const run2 = db => db.exec(sqlFile(CATCHUP2));
const eggsOf = async (db, uid) => (await db.query(
  `select species_id from public.player_dragon_eggs where auth_user_id = '${uid}' order by created_at, id`)).rows.map(r => r.species_id);
const logRows = async db => (await db.query(
  `select p.name_key as n, c.tier, c.species_id from public.event_tier_egg_catchup c
     join public.player_event_progress p on p.auth_user_id = c.auth_user_id order by p.name_key, c.tier`)).rows.map(r => [r.n, r.tier, r.species_id]);

/* Die Lage wie live: alle 5 haben Stufe 10 abgeholt UND einen Dayman aus einem normalen Ei-Wurf. */
const victimsWorld = (extra) => buildWorld({ logExists: !!(extra && extra.logExists), players: [
  ...LISTED.map(n => ({ uid: UID[n], name: n })),
  { uid: UID_FREMD, name: 'fremderspieler' },
  { uid: UID_UNGEZOGEN, name: 'nieabgeholt', tiers: 12, claimed: [] },
  ...((extra && extra.players) || [])] });
async function giveDungeonDayman(db) {
  // bärli: Dayman-DRACHE seit Eventstart geschluepft + zusaetzlich ein Dayman-EI (beides aus dem Dungeon)
  await db.exec(`insert into public.player_dragons (auth_user_id, species_id, hatched_at) values ('${UID['bärli']}', 'dayman', now() - interval '1 day')`);
  await db.exec(`insert into public.player_dragon_eggs (name_key, auth_user_id, species_id) values ('bärli', '${UID['bärli']}', 'dayman')`);
  // chronokora, .egoistin: nur ein Dayman-Drache aus dem Dungeon
  for (const n of ['chronokora', '.egoistin', 'frecheschaos', 'kaledoss']) {
    await db.exec(`insert into public.player_dragons (auth_user_id, species_id, hatched_at) values ('${UID[n]}', 'dayman', now() - interval '30 hours')`);
  }
}

test('REPRODUKTION: Nachhol-Lauf 1 ueberspringt alle 5 (Dayman aus dem Dungeon) - das ist der Fehler', async () => {
  const { db } = await victimsWorld();
  await giveDungeonDayman(db);
  await run1(db);
  for (const n of LISTED) {
    if (n === 'bärli') expect(await eggsOf(db, UID[n])).toEqual(['dayman']);     // nur sein Dungeon-Ei
    else expect(await eggsOf(db, UID[n])).toEqual([]);
  }
  // Lauf 1 hat nur den unbeteiligten Spieler ohne Dayman bedient - KEINEN der 5 Opfer.
  expect(await logRows(db)).toEqual([['fremderspieler', 10, 'dayman']]);
});

test('Lauf 2: jeder der 5 bekommt genau EIN Dayman-Ei (auch mit Dungeon-Dayman); Log hat 5 Eintraege', async () => {
  const { db } = await victimsWorld();
  await giveDungeonDayman(db);
  await run2(db);
  expect(await eggsOf(db, UID['bärli'])).toEqual(['dayman', 'dayman']);          // sein Dungeon-Ei + das Pass-Ei
  for (const n of ['.egoistin', 'chronokora', 'frecheschaos', 'kaledoss']) expect(await eggsOf(db, UID[n])).toEqual(['dayman']);
  expect(await logRows(db)).toEqual(LISTED.map(n => [n, 10, 'dayman']).sort((a, b) => a[0] < b[0] ? -1 : 1));
  // Log-Zeile zeigt auf ein wirklich vorhandenes Ei
  const orphan = (await db.query(`select count(*)::int as n from public.event_tier_egg_catchup c
                                    where not exists (select 1 from public.player_dragon_eggs e where e.id = c.egg_id)`)).rows[0].n;
  expect(orphan).toBe(0);
});

test('Lauf 2 fasst NICHT an: Nicht-Gelistete, nie Abgeholte, bereits Nachgeholte', async () => {
  const { db } = await victimsWorld({ logExists: true });
  // frecheschaos wurde schon von Lauf 1 bedient (Log-Eintrag + Ei)
  await db.exec(`insert into public.player_dragon_eggs (name_key, auth_user_id, species_id) values ('frecheschaos', '${UID['frecheschaos']}', 'dayman')`);
  await db.exec(`insert into public.event_tier_egg_catchup (event_id, auth_user_id, tier, species_id, egg_id)
                 select 'zwielicht', '${UID['frecheschaos']}', 10, 'dayman', id from public.player_dragon_eggs where auth_user_id = '${UID['frecheschaos']}'`);
  await run2(db);
  expect(await eggsOf(db, UID_FREMD)).toEqual([]);                 // nicht auf der Liste
  expect(await eggsOf(db, UID_UNGEZOGEN)).toEqual([]);             // Stufe nie abgeholt (nicht mal gelistet)
  expect(await eggsOf(db, UID['frecheschaos'])).toEqual(['dayman']); // schon bedient -> kein zweites
  for (const n of ['.egoistin', 'bärli', 'chronokora', 'kaledoss']) expect(await eggsOf(db, UID[n])).toEqual(['dayman']);
});

test('Gelisteter Spieler hat Stufe 10 NIE abgeholt -> nichts (das normale Abholen vergibt das Ei jetzt selbst)', async () => {
  const { db } = await buildWorld({ players: [{ uid: UID['bärli'], name: 'bärli', tiers: 12, claimed: [] }] });
  await run2(db);
  expect(await eggsOf(db, UID['bärli'])).toEqual([]);
  expect(await logRows(db)).toEqual([]);
});

test('Beliebig oft ausfuehrbar: Lauf 2 dreimal -> weiterhin genau ein Pass-Ei pro Spieler', async () => {
  const { db } = await victimsWorld();
  await giveDungeonDayman(db);
  await run2(db); await run2(db); await run2(db);
  expect(await eggsOf(db, UID['chronokora'])).toEqual(['dayman']);
  expect(await eggsOf(db, UID['bärli'])).toEqual(['dayman', 'dayman']);
  expect((await logRows(db)).length).toBe(5);
});

test('Reihenfolge egal: Lauf 1 -> Lauf 2 -> Lauf 1 und Lauf 2 -> Lauf 1 ergeben dasselbe, nie doppelt', async () => {
  const a = await victimsWorld(); await giveDungeonDayman(a.db);
  await run1(a.db); await run2(a.db); await run1(a.db); await run2(a.db);
  const b = await victimsWorld(); await giveDungeonDayman(b.db);
  await run2(b.db); await run1(b.db); await run2(b.db);
  for (const w of [a, b]) {
    expect(await eggsOf(w.db, UID['chronokora'])).toEqual(['dayman']);
    expect(await eggsOf(w.db, UID['bärli'])).toEqual(['dayman', 'dayman']);
    expect((await logRows(w.db)).filter(r => LISTED.includes(r[0])).length).toBe(5);
  }
  // Der unbeteiligte "fremderspieler" (Stufe 10 abgeholt, kein Dayman) wird von Lauf 1 - und nur von Lauf 1 - bedient, genau einmal.
  expect(await eggsOf(a.db, UID_FREMD)).toEqual(['dayman']);
  expect(await eggsOf(b.db, UID_FREMD)).toEqual(['dayman']);
});

test('Ein gelisteter Name existiert im Event nicht: kein Fehler, die anderen werden bedient', async () => {
  const { db } = await buildWorld({ players: LISTED.filter(n => n !== 'kaledoss').map(n => ({ uid: UID[n], name: n })) });
  await run2(db);
  for (const n of LISTED.filter(n => n !== 'kaledoss')) expect(await eggsOf(db, UID[n])).toEqual(['dayman']);
});

test('Art fehlt in dragon_species -> kein Ei, kein Fehler, kein Log (spaeter erneut ausfuehrbar)', async () => {
  const { db } = await buildWorld({ species: [{ id: 'surebrec', name: 'Surebrec' }, { id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }],
    players: [{ uid: UID['chronokora'], name: 'chronokora' }] });
  await run2(db);
  expect(await eggsOf(db, UID['chronokora'])).toEqual([]);
  expect(await logRows(db)).toEqual([]);
  await h.insertRows(db, 'dragon_species', [{ id: 'dayman', name: 'Dayman' }]);
  await run2(db);
  expect(await eggsOf(db, UID['chronokora'])).toEqual(['dayman']);
});

test('Einzelstueck-Art in der Event-Konfiguration (z.B. Lightnix): kein Ei, KEIN Fehler, kein Log', async () => {
  const { db } = await buildWorld({ players: [{ uid: UID['chronokora'], name: 'chronokora' }, { uid: UID['bärli'], name: 'bärli' }] });
  // Konfiguration so verbiegen, dass Stufe 10 eine Einzelstueck-Art verspricht. Ohne die Art-Pruefung
  // wuerde der Ei-Schutz (Trigger) einen Fehler werfen und den GANZEN Lauf abbrechen.
  await db.exec(`update public.special_events set config = replace(config::text, '"dayman"', '"lightnix"')::jsonb where id = 'zwielicht'`);
  expect((await db.query(`select (config::text like '%"lightnix"%') as ok from public.special_events where id = 'zwielicht'`)).rows[0].ok).toBe(true);
  await run2(db);
  expect(await eggsOf(db, UID['chronokora'])).toEqual([]);
  expect(await eggsOf(db, UID['bärli'])).toEqual([]);
  expect(await logRows(db)).toEqual([]);
});

test('Log-Tabelle in Lauf 2 ist Zeichen fuer Zeichen die aus Lauf 1 (gleiches Schema, gleiche Rechte)', async () => {
  const take = f => between(sqlFile(f), 'create table if not exists public.event_tier_egg_catchup', 'do $$');
  expect(take(CATCHUP2)).toBe(take(CATCHUP1));
});

test('Datei: nur Log-Tabelle (falls fehlend) + EIN do-Block + 1 lesende Kontrollabfrage; Namensliste = die 5 belegten Spieler', async () => {
  const text = sqlFile(CATCHUP2);
  const code = text.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  // nichts Zerstoerendes, keine Event-/Artenaenderung, keine Funktionen/Policies
  for (const bad of [/\bdrop\b/i, /\balter\s+table\b(?![^;]*enable row level security)/i, /\btruncate\b/i, /\bdelete\s+from\b/i,
    /\bcreate\s+(or\s+replace\s+)?function\b/i, /\bcreate\s+policy\b/i, /\bcreate\s+trigger\b/i, /\bupdate\s+public\./i, /\bnotify\b/i]) {
    expect(code, String(bad)).not.toMatch(bad);
  }
  // Schreibzugriffe nur auf Eier + Nachhol-Log
  const writes = (code.match(/\binsert\s+into\s+public\.[a-z_]+/gi) || []).map(s => s.replace(/\s+/g, ' ').toLowerCase()).sort();
  expect(writes).toEqual(['insert into public.event_tier_egg_catchup', 'insert into public.player_dragon_eggs']);
  expect((code.match(/\bdo\s+\$\$/gi) || []).length).toBe(1);
  const m = code.match(/c_names constant text\[\] := array\[([^\]]*)\]/);
  expect(m).not.toBeNull();
  expect(m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort()).toEqual([...LISTED].sort());
  // Kontrollabfrage am Ende ist ein reines select
  const last = code.trim().split(';').map(s => s.trim()).filter(Boolean).pop();
  expect(last).toMatch(/^select\s/i);
});
