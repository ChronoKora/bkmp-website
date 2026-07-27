const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');

/* 27.07.2026 - Nutzerwunsch "teste alle Skills, ich glaube manche
   funktionieren nicht" fuehrte zum Fund, dass die Prestige-Knoten
   "Schluesselmeister"/"Schluesselbund" (Zweig Runen & Dungeons) zwar
   kaufbar waren, aber wirkungslos - der player-facing Text enthielt sogar
   einen rohen Entwickler-Hinweis ("SQL-Migration erforderlich, siehe
   Kommentar im Code"), den ein Spieler live gesehen hat. Beim Verdrahten
   zusaetzlich gefunden: sql/20260726-dungeon-key-prestige-bonus.sql (bereits
   live ausgefuehrt) hatte VERSEHENTLICH das aeltere, rollierende
   Zeitverhalten wiederhergestellt und damit den expliziten Spielerwunsch
   vom 16.07. ("feste 0/4/8/12/16/20-Uhr-Slots fuer ALLE Spieler gleich")
   seit dem 26.07. still rueckgaengig gemacht - siehe sql/20260727-fix-
   dungeon-regen-fixed-slots-and-wire-prestige.sql fuer beide Fixes in
   einer Datei. Die Slot-Grenzen-Tests hier verwenden dieselbe Ankerzeit-
   Technik wie der bestehende "exakte Slot-Grenze"-Block in
   dungeon-time.spec.js (dessen MOCK-Fassung uebrigens die ganze Zeit
   korrekt geblieben war - der Regressions-Fund betrifft nur die echte
   Produktions-SQL, nicht diesen Mock, ein gutes Beispiel dafuer, dass ein
   Mock nicht automatisch merkt, wenn die echte SQL abseits davon drifted). */

/* Nutzt echte Desktop-Tab-Klicks (#idleTabBtnDungeon) - auf mobile-*-
   Projekten korrekt unsichtbar (kompakte Navigation), identisches, bereits
   etabliertes Muster wie in dungeon-time.spec.js. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - siehe Kommentar oben, mobile-smoke.spec.js deckt die kompakte Navigation ab');
});

async function refreshDungeonStatus(page) {
  await page.evaluate(() => bkmpDungeonRefreshStatus());
}

function setPrestigeAllocations(store, nameKey, allocations) {
  const rows = store.tables.idle_prestige_state || (store.tables.idle_prestige_state = []);
  let row = rows.find(r => r.name_key === nameKey);
  if (!row) {
    row = { name_key: nameKey, display_name: nameKey, prestige_level: 1, prestige_points: 999999, prestige_points_spent: 0, prestige_allocations: {}, updated_at: new Date().toISOString() };
    rows.push(row);
  }
  row.prestige_allocations = { ...row.prestige_allocations, ...allocations };
}

test.describe('Dungeon-Schluessel: Schluesselmeister/Schluesselbund-Verdrahtung + Fixed-Slot-Regression', () => {
  test.use({ teststand: 'A', startTimeMs: Date.parse('2026-01-15T07:00:00.000Z') }); // 08:00 Uhr Berlin (Winterzeit), exakt ein Slot

  test('REGRESSION: ohne Bonus bleibt das feste, gemeinsame 4h-Raster unveraendert (nicht rollierend seit dem eigenen Zeitstempel)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);
    await page.evaluate(() => bkmpDungeonConsumeKey('exp')); // 4/5, verankert auf dem 08:00-Slot

    store.clock.advance(3 * 3600 * 1000 + 59 * 60 * 1000); // -> 11:59 Berlin, naechster Slot (12:00) noch nicht erreicht
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.exp.keys)).toBe(4);

    store.clock.advance(2 * 60 * 1000); // -> 12:01 Berlin, Slot ueberschritten
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.exp.keys)).toBe(5);
  });

  test('Schluesselmeister Rang 10 (30% schneller): naechster Schluessel bereits nach 2h48min statt nach 4h, nicht mehr auf dem gemeinsamen Raster', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    setPrestigeAllocations(store, fixtureData.nameKey, { schluesselmeister: 10 }); // 10*3%=30% -> Intervall 14400*0,7=10080s
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);
    await page.evaluate(() => bkmpDungeonConsumeKey('gold'));

    store.clock.advance(10080 * 1000 - 60 * 1000); // 1 Min. vor der persoenlichen Grenze
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.gold.keys)).toBe(4);

    store.clock.advance(2 * 60 * 1000); // ueber die persoenliche Grenze
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.gold.keys)).toBe(5);
  });

  test('Schluesselbund Rang 20: Deckel steigt von 5 auf 25', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    setPrestigeAllocations(store, fixtureData.nameKey, { schluesselbund: 20 });
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);
    store.clock.advance(40 * 4 * 3600 * 1000); // 40 feste Slots - ohne Deckel-Anhebung laengst bei 5 gedeckelt
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.gold.keys)).toBe(25);
  });

  test('Paragon-Raenge zaehlen anteilig mit (Schluesselmeister Maximalrang + 10 Paragon-Raenge = 91,2%)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    setPrestigeAllocations(store, fixtureData.nameKey, { schluesselmeister: 30, schluesselmeister__paragon: 10 });
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);
    await page.evaluate(() => bkmpDungeonConsumeKey('rune'));

    const expectedIntervalMs = Math.round(14400 * (1 - 91.2 / 100)) * 1000; // 1267000ms
    store.clock.advance(expectedIntervalMs - 5000);
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.rune.keys)).toBe(4);

    store.clock.advance(10000);
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.rune.keys)).toBe(5);
  });

  test('extremer Paragon-Ausbau bleibt bei 95% gedeckelt (nie 0/negatives Intervall)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    setPrestigeAllocations(store, fixtureData.nameKey, { schluesselmeister: 30, schluesselmeister__paragon: 1000 });
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);
    await page.evaluate(() => bkmpDungeonConsumeKey('meat'));

    store.clock.advance(719 * 1000); // 95%-Deckel -> Intervall = 14400*0,05 = 720s
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.meat.keys)).toBe(4);

    store.clock.advance(2000);
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.meat.keys)).toBe(5);
  });
});
