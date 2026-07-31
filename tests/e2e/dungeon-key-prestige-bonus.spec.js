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

  /* 30.07.2026 - Spieler-Meldung ("Dungeon schluessel funktioniert nicht so
     gut", Screenshot zeigte "Ei-Dungeon Schluessel: 7/5") - der obige Test
     bewies bereits, dass der SERVER korrekt bis 25 akkumuliert. Der Bug lag
     ausschliesslich auf der CLIENT-Anzeige-Seite: bkmpDungeonKeyLineHtml()/
     bkmpDungeonStartCountdownTicker() nutzten bisher die alte feste
     BKMP_DUNGEON_KEY_MAX=5-Konstante statt bkmpDungeonEffectiveKeyMax() -
     zeigte "7/5" statt "7/25" UND liess den Sekunden-Countdown fuer diesen
     Dungeon-Typ dauerhaft einfrieren, sobald der Bestand ueber 5 stieg
     (siehe Kommentar an bkmpDungeonStartCountdownTicker() in
     js/systems/bkmp-dungeon.js). Dieser Test prueft explizit die ANZEIGE
     und den TICKER, nicht nur den bereits bewiesenen Server-Wert. */
  test('REGRESSION: Anzeige + Countdown-Ticker nutzen den echten (Schluesselbund-inklusiven) Maximalwert statt der alten festen "5"', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    setPrestigeAllocations(store, fixtureData.nameKey, { schluesselbund: 10 }); // 5 Basis + 10*1 = 15
    // bkmpPrestigeState ist ein beim Login einmalig geladener Client-Cache
    // (anders als der Server-RPC oben, der bei jedem Aufruf frisch aus der
    // DB liest) - muss nach dem direkten Store-Eingriff explizit
    // nachgezogen werden, sonst saehe bkmpDungeonEffectiveKeyMax() weiterhin
    // die alte, beim Login geladene Zuteilung.
    await page.evaluate(async (nameKey) => { bkmpPrestigeState = await loadIdlePrestigeState(nameKey); }, fixtureData.nameKey);
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);

    const effectiveMax = await page.evaluate(() => bkmpDungeonEffectiveKeyMax());
    expect(effectiveMax).toBe(15);

    // Kartentext zeigt den echten, hoeheren Maximalwert statt der alten "5" -
    // Bestand absichtlich auf 7 gesetzt (exakt das im Bugreport gezeigte
    // Muster "7/5") und neu gerendert.
    await page.evaluate(() => { bkmpDungeonStatusByType.gold.keys = 7; bkmpIdleRenderDungeonPanel(); });
    const keyLineText = await page.locator('#idle-dungeon-keys-gold').innerText();
    expect(keyLineText).toContain('7/15');
    expect(keyLineText).not.toContain('7/5');

    // Der Einleitungstext im Panel-Kopf nennt ebenfalls den echten Maximalwert.
    const introText = await page.locator('.idle-dungeon-intro').innerText();
    expect(introText).toContain('max. 15');

    // REGRESSION: der Countdown-Ticker darf bei 7 Schluesseln (> alte feste
    // Konstante 5, aber < neuer Maximalwert 15) NICHT mehr einfrieren -
    // vorher stoppte die Sekunden-Anzeige fuer diesen Typ dauerhaft, sobald
    // der Bestand ueber 5 lag.
    await page.evaluate(() => {
      bkmpDungeonStatusByType.gold.secondsToNext = 6;
      bkmpDungeonStartCountdownTicker();
    });
    await page.waitForTimeout(1300); // echter 1s-Tick des Ticker-Intervalls
    const secondsAfterTick = await page.evaluate(() => bkmpDungeonStatusByType.gold.secondsToNext);
    expect(secondsAfterTick).toBeLessThan(6);
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
