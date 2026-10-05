const fs = require('fs');
const path = require('path');
const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Fund vom 05.10.2026 (Bindungs-Feature): "Wenn man sie zu Erwachsenen macht,
   bleiben sie scheinbar drin. Man muss sie erst ablegen, obwohl sie nirgends
   drin sind - nicht als Team, Expedition oder Trainieren."

   Ursache: bkmpDragonEvolveToAdult() speicherte nur Stufe + Werte, is_companion
   blieb true. Der Drache war danach still als erwachsener Kampf-Begleiter
   ausgeruestet: Expeditionen/Freilassen gesperrt, Bindung/Begleiter-Zeit/Boss-
   Siege liefen unbemerkt weiter, bei vollen Plaetzen erschien er in keinem Platz.

   Dieser Test sichert drei Dinge ab:
     1) Erwachsenwerden loescht den Begleiter-Status (Spiel + Server-Zeile)
     2) bereits haengende Markierungen ohne Kampfplatz werden beim Laden entfernt,
        echte Begleiter (innerhalb der freigeschalteten Plaetze) bleiben
     3) der Server-Trigger (sql/20261005-dragon-graduate-unequip.sql) sichert dasselbe
        fuer alle Wege ab - gegen ein ECHTES Postgres (PGlite) geprueft. */

test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Desktop-Projekt (echte Tab-Klicks wie in dragon-multi-companion.spec.js; die SQL-Pruefung ist unabhaengig vom Geraet)');
});

const SPECIES = {
  id: 'qa-graduate-species', name: 'QA-Absolvent', rarity: 'episch',
  egg_source: 'event', source_dragon_id: null, egg_drop_chance: 0,
  brood_seconds: 999999, sacrifice_gold: 0, sacrifice_crystals: 0,
  growth_points_required: 100, battle_xp_required: 100,
  is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1,
  egg_image: '', baby_image: '', teen_image: '', adult_image: '', sort_order: 1, active: true
};

function dragon(fx, id, extra) {
  return {
    id, name_key: fx.nameKey, auth_user_id: fx.authUserId, species_id: SPECIES.id,
    stage: 'adult', is_favorite: false, is_companion: false, ascension_level: 0, substats: [],
    stat_attack: 10, stat_defense: 10, stat_hp: 100, growth_points: 0, battle_xp: 0, bond_xp: 0,
    hatched_at: fx.nowIso, adult_at: fx.nowIso, ...(extra || {})
  };
}

function setPrestigeAllocations(store, nameKey, allocations) {
  const rows = store.tables.idle_prestige_state || (store.tables.idle_prestige_state = []);
  let row = rows.find(r => r.name_key === nameKey);
  if (!row) {
    row = { name_key: nameKey, display_name: nameKey, prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {}, updated_at: new Date().toISOString() };
    rows.push(row);
  }
  row.prestige_allocations = { ...row.prestige_allocations, ...allocations };
}

const serverRow = (store, id) => store.tables.player_dragons.find(d => d.id === id);

test.describe('Erwachsenwerden loescht den Begleiter-Status - Teststand A', () => {
  test.use({ teststand: 'A' });

  test('Jugendlicher Trainings-Begleiter wird erwachsen: danach NICHT mehr ausgeruestet (Spiel + Server), frei fuer Expeditionen', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [dragon(fixtureData, 'teen-1', { stage: 'teen', is_companion: true, battle_xp: 100, adult_at: null })];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await page.evaluate(() => bkmpIdleStopLoop());

    const before = await page.evaluate(() => { const d = bkmpPlayerDragons.find(x => x.id === 'teen-1'); return { stage: d.stage, comp: d.is_companion }; });
    expect(before).toEqual({ stage: 'teen', comp: true });

    await page.evaluate(() => bkmpDragonEvolveToAdult('teen-1'));
    await expect.poll(async () => (serverRow(store, 'teen-1') || {}).stage).toBe('adult');

    const after = await page.evaluate(() => {
      const d = bkmpPlayerDragons.find(x => x.id === 'teen-1');
      return {
        stage: d.stage, comp: d.is_companion,
        inSlots: bkmpDragonActiveCompanions().some(x => x.id === 'teen-1'),
        expeditionReady: bkmpExpAvailableDragons().some(x => x.id === 'teen-1')
      };
    });
    expect(after.stage).toBe('adult');
    expect(after.comp, 'Spiel: Begleiter-Status muss weg sein').toBe(false);
    expect(after.inSlots).toBe(false);
    expect(after.expeditionReady, 'frei fuer Expeditionen').toBe(true);
    expect(serverRow(store, 'teen-1').is_companion, 'Server-Zeile').toBe(false);
  });

  test('Ein bewusst ausgeruesteter erwachsener Begleiter bleibt unberuehrt, wenn ein anderer Jugendlicher erwachsen wird', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      dragon(fixtureData, 'adult-keep', { is_companion: true, stat_attack: 100 }),
      dragon(fixtureData, 'teen-2', { stage: 'teen', is_companion: true, battle_xp: 100, adult_at: null })
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await page.evaluate(() => bkmpIdleStopLoop());
    await page.evaluate(() => bkmpDragonEvolveToAdult('teen-2'));
    await expect.poll(async () => (serverRow(store, 'teen-2') || {}).stage).toBe('adult');
    expect(serverRow(store, 'adult-keep').is_companion).toBe(true);
    expect(serverRow(store, 'teen-2').is_companion).toBe(false);
    const equipped = await page.evaluate(() => bkmpDragonActiveCompanions().map(d => d.id));
    expect(equipped).toEqual(['adult-keep']);
  });
});

test.describe('Haengende Markierungen werden beim Laden aufgeraeumt - Teststand A', () => {
  test.use({ teststand: 'A' });

  test('1 freigeschalteter Platz, 2 markierte Erwachsene: der schwaechere ohne Platz wird frei, der staerkere bleibt (Spiel + Server)', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      dragon(fixtureData, 'strong', { is_companion: true, stat_attack: 200, stat_defense: 100, stat_hp: 500, bond_xp: 321 }),
      dragon(fixtureData, 'stale', { is_companion: true, stat_attack: 20, stat_defense: 10, stat_hp: 100, bond_xp: 123 })
    ];
    setPrestigeAllocations(store, fixtureData.nameKey, {});
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    const local = await page.evaluate(() => Object.fromEntries(bkmpPlayerDragons.map(d => [d.id, { comp: d.is_companion, bond: d.bond_xp }])));
    expect(local.strong.comp).toBe(true);
    expect(local.stale.comp, 'ohne Kampfplatz: Markierung weg').toBe(false);
    await expect.poll(async () => serverRow(store, 'stale').is_companion).toBe(false);
    expect(serverRow(store, 'strong').is_companion).toBe(true);
    // Die erarbeitete Bindung bleibt erhalten
    expect(serverRow(store, 'stale').bond_xp).toBe(123);
    expect(serverRow(store, 'strong').bond_xp).toBe(321);
    // und der bereinigte Drache ist wieder fuer Expeditionen frei
    expect(await page.evaluate(() => bkmpExpAvailableDragons().some(d => d.id === 'stale'))).toBe(true);
  });

  test('3 freigeschaltete Plaetze (Prestige "Weitere Gefaehrten" Rang 2): alle 3 echten Begleiter bleiben - nichts wird abgelegt', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      dragon(fixtureData, 'c1', { is_companion: true, stat_attack: 300 }),
      dragon(fixtureData, 'c2', { is_companion: true, stat_attack: 200 }),
      dragon(fixtureData, 'c3', { is_companion: true, stat_attack: 100 })
    ];
    setPrestigeAllocations(store, fixtureData.nameKey, { weitere_gefaehrten: 2 });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await page.waitForTimeout(300); // evtl. (fehlerhaftes) Abspeichern haette hier schon stattgefunden
    const local = await page.evaluate(() => bkmpPlayerDragons.map(d => d.is_companion));
    expect(local).toEqual([true, true, true]);
    for (const id of ['c1', 'c2', 'c3']) expect(serverRow(store, id).is_companion).toBe(true);
  });

  test('Prestige-Stand nicht geladen (Netzwerkfehler): nichts wird abgelegt, Aufraeumen ist ein No-Op', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      dragon(fixtureData, 'a', { is_companion: true, stat_attack: 300 }),
      dragon(fixtureData, 'b', { is_companion: true, stat_attack: 100 })
    ];
    setPrestigeAllocations(store, fixtureData.nameKey, { weitere_gefaehrten: 1 }); // 2 Plaetze: beide echt
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    const result = await page.evaluate(() => {
      const saved = { s: bkmpPrestigeState, f: bkmpPrestigeLoadFailed };
      bkmpPrestigeState = null; bkmpPrestigeLoadFailed = true;           // Ladefehler simulieren (Platzlimit waere faelschlich 1)
      const healedFailed = bkmpDragonHealStaleCompanions();
      const stillBoth = bkmpPlayerDragons.every(d => d.is_companion);
      bkmpPrestigeState = saved.s; bkmpPrestigeLoadFailed = saved.f;
      const healedOk = bkmpDragonHealStaleCompanions();                  // Normalfall: 2 Plaetze, 2 Begleiter -> nichts zu tun
      return { healedFailed, stillBoth, healedOk };
    });
    expect(result).toEqual({ healedFailed: 0, stillBoth: true, healedOk: 0 });
  });

  test('Aufraeumen ist wiederholbar (zweiter Aufruf findet nichts mehr)', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      dragon(fixtureData, 'x1', { is_companion: true, stat_attack: 300 }),
      dragon(fixtureData, 'x2', { is_companion: true, stat_attack: 100 })
    ];
    setPrestigeAllocations(store, fixtureData.nameKey, {});
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    expect(await page.evaluate(() => bkmpDragonHealStaleCompanions())).toBe(0); // beim Laden schon erledigt
    expect(serverRow(store, 'x2').is_companion).toBe(false);
  });
});

/* ---------- Server-Trigger gegen ein echtes Postgres ---------- */
test.describe('Server-Trigger sql/20261005-dragon-graduate-unequip.sql (echtes Postgres, PGlite)', () => {
  const SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', '20261005-dragon-graduate-unequip.sql'), 'utf8');

  async function makeDb() {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();
    await db.exec(`create table public.player_dragons (
      id text primary key, stage text not null default 'baby', is_companion boolean not null default false,
      stat_attack integer not null default 0);`);
    await db.exec(SQL);
    return db;
  }
  const comp = async (db, id) => (await db.query('select is_companion from public.player_dragons where id = $1', [id])).rows[0].is_companion;

  test('Jugendlich -> Erwachsen: is_companion wird auf false gesetzt, selbst wenn der Aufrufer true mitschickt', async () => {
    const db = await makeDb();
    await db.exec(`insert into public.player_dragons (id, stage, is_companion) values ('t', 'teen', true);`);
    await db.exec(`update public.player_dragons set stage = 'adult', is_companion = true where id = 't';`);
    expect(await comp(db, 't')).toBe(false);
    expect((await db.query(`select stage from public.player_dragons where id = 't'`)).rows[0].stage).toBe('adult');
    await db.close();
  });

  test('alle anderen Aenderungen bleiben unberuehrt', async () => {
    const db = await makeDb();
    await db.exec(`insert into public.player_dragons (id, stage, is_companion) values
      ('a', 'adult', true), ('t', 'teen', true), ('d', 'adult', true), ('b', 'baby', false);`);
    // Erwachsener bleibt Begleiter, auch wenn andere Spalten oder die Stufe unveraendert gesetzt werden
    await db.exec(`update public.player_dragons set stat_attack = 5 where id = 'a';`);
    await db.exec(`update public.player_dragons set stage = 'adult' where id = 'a';`);
    expect(await comp(db, 'a')).toBe(true);
    // Jugendlicher bleibt Trainings-Begleiter, solange er Jugendlicher ist
    await db.exec(`update public.player_dragons set stat_attack = 9 where id = 't';`);
    await db.exec(`update public.player_dragons set stage = 'teen' where id = 't';`);
    expect(await comp(db, 't')).toBe(true);
    // Erwachsen -> Goettlich (Erweckung) aendert die Ausruestung nicht
    await db.exec(`update public.player_dragons set stage = 'divine' where id = 'd';`);
    expect(await comp(db, 'd')).toBe(true);
    // Wer nach dem Erwachsenwerden bewusst ausruestet, darf das (eigener Befehl, keine Stufenaenderung)
    await db.exec(`update public.player_dragons set stage = 'teen', is_companion = false where id = 'b';`);
    await db.exec(`update public.player_dragons set stage = 'adult' where id = 'b';`);
    await db.exec(`update public.player_dragons set is_companion = true where id = 'b';`);
    expect(await comp(db, 'b')).toBe(true);
    await db.close();
  });

  test('Datei ist wiederholbar einspielbar (idempotent)', async () => {
    const db = await makeDb();
    await db.exec(SQL);
    await db.exec(SQL);
    await db.exec(`insert into public.player_dragons (id, stage, is_companion) values ('t', 'teen', true);`);
    await db.exec(`update public.player_dragons set stage = 'adult' where id = 't';`);
    expect(await comp(db, 't')).toBe(false);
    await db.close();
  });
});
