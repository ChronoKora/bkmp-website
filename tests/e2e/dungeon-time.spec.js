const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');

/* QA-Grundlage Phase 2 (24.07.2026) - siehe identischer Kommentar in
   buttons-inventory.spec.js: diese Datei klickt #idleTabBtnDungeon per
   echtem Playwright-.click() (verlangt Sichtbarkeit), auf mobile-*-Projekten
   ist der Knoten korrekt unsichtbar (kompakte Navigation) - 30s-Timeout,
   kein App-Bug. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - siehe Kommentar oben, mobile-smoke.spec.js deckt die kompakte Navigation ab');
});

/* Auftrag Abschnitt 17: Dungeons - Schluessel/Zeit. Die Schluessel-
   Regeneration ist zu 100% server-/mock-seitig berechnet (siehe
   tests/mock/rpc-engine.js, originalgetreuer Port von
   sql/supabase-dungeon-fixed-key-times.sql: feste 00/04/08/12/16/20-Uhr-
   Berlin-Slots) - der Client zeigt nur einen 1s-Countdown fuer die Anzeige.
   Deshalb wird hier direkt die MOCK-Uhr (store.clock) vorgespult, ohne
   Playwrights Browser-Clock zu installieren - die Zeit, die tatsaechlich
   zaehlt, lebt server-/mock-seitig, nicht im Browser. */

async function refreshDungeonStatus(page) {
  await page.evaluate(() => bkmpDungeonRefreshStatus());
}

test.describe('Dungeon-Schluessel/Zeit', () => {
  test.use({ teststand: 'A' });

  test('frischer Spieler startet mit 5/5 Schluesseln je Dungeon-Typ', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);
    const keys = await page.evaluate(() => bkmpDungeonStatusByType.gold.keys);
    expect(keys).toBe(5);
  });

  test('Dungeon starten verbraucht genau einen Schluessel', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);

    const before = await page.evaluate(() => bkmpDungeonStatusByType.gold.keys);
    await page.evaluate(() => bkmpDungeonConsumeKey('gold'));
    await refreshDungeonStatus(page);
    const after = await page.evaluate(() => bkmpDungeonStatusByType.gold.keys);
    expect(after).toBe(before - 1);
  });

  test('Schluessel-Regeneration deckelt bei 5, auch nach mehreren Tagen', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);
    await page.evaluate(() => bkmpDungeonConsumeKey('egg'));

    store.clock.advance(9 * 24 * 3600 * 1000); // 9 Tage - weit mehr als noetig, um auf 5 aufzufuellen
    await refreshDungeonStatus(page);
    const keys = await page.evaluate(() => bkmpDungeonStatusByType.egg.keys);
    expect(keys).toBe(5);
  });

  test('0/5 Schluessel blockiert den Start-Button UND den serverseitigen Verbrauch', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) await bkmpDungeonConsumeKey('fruit');
    });
    await refreshDungeonStatus(page);
    await page.evaluate(() => bkmpIdleRenderDungeonPanel());

    const startBtn = page.locator('.idle-dungeon-card[data-dungeon-type="fruit"] .idle-dungeon-start-btn');
    await expect(startBtn).toBeDisabled();
    await expect(startBtn).toContainText('Keine Schlüssel');

    // Ein 6. Versuch muss serverseitig abgelehnt werden (no_keys_available),
    // nicht nur clientseitig durch den deaktivierten Button verhindert werden.
    const sixthAttempt = await page.evaluate(async () => {
      try { await bkmpDungeonConsumeKey('fruit'); return 'consumed'; }
      catch (e) { return e.message; }
    });
    expect(sixthAttempt).toBe('no_keys_available');
  });

  test('Tagesbonus ist nach dem Beanspruchen erst am naechsten Berlin-Kalendertag wieder verfuegbar', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);

    const claimedFirst = await page.evaluate(() => bkmpDungeonClaimDailyBonus('gem'));
    expect(claimedFirst).toBe(true);
    const claimedAgainSameDay = await page.evaluate(() => bkmpDungeonClaimDailyBonus('gem'));
    expect(claimedAgainSameDay).toBe(false); // kein zweites Mal am selben Tag

    await refreshDungeonStatus(page);
    let bonusAvailable = await page.evaluate(() => bkmpDungeonStatusByType.gem.dailyBonusAvailable);
    expect(bonusAvailable).toBe(false);

    store.clock.advance(25 * 3600 * 1000); // sicher ueber Mitternacht hinaus
    await refreshDungeonStatus(page);
    bonusAvailable = await page.evaluate(() => bkmpDungeonStatusByType.gem.dailyBonusAvailable);
    expect(bonusAvailable).toBe(true);
  });

  test('Ei-Dungeon regeneriert genauso wie andere Dungeons (keine Sonderbehandlung/kein Steckenbleiben bei 0)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);
    await page.evaluate(async () => { for (let i = 0; i < 5; i++) await bkmpDungeonConsumeKey('egg'); });
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.egg.keys)).toBe(0);

    store.clock.advance(9 * 3600 * 1000); // grosszuegig ueber einen vollen 4h-Slot hinaus, siehe describe unten fuer die praezise Slot-Grenze
    await refreshDungeonStatus(page);
    const keys = await page.evaluate(() => bkmpDungeonStatusByType.egg.keys);
    expect(keys).toBeGreaterThanOrEqual(1);
  });
});

/* Eigener Block mit FESTER Startzeit (exakt auf einem 4h-Berlin-Slot,
   08:00 Berlin = 07:00 UTC im Winter): die restlichen Tests oben starten
   bewusst auf der echten Systemzeit (Date.now()) und pruefen deshalb nur
   "vor/nach einem Slot", nie "wie viele Minuten bis zum naechsten Slot" -
   das haengt sonst von der Tageszeit ab, zu der die Suite gerade laeuft,
   und waere ohne eine fixe Ankerzeit nicht deterministisch (z.B. um
   23:58 Uhr echter Zeit waere "3h59m vorspulen" schon ueber ZWEI Slots
   hinweg statt ueber keinen). */
test.describe('Dungeon-Schluessel/Zeit - exakte Slot-Grenze', () => {
  test.use({ teststand: 'A', startTimeMs: Date.parse('2026-01-15T07:00:00.000Z') }); // 08:00 Uhr Berlin (Winterzeit), exakt ein Slot

  test('nach 3h59m kein neuer Schluessel, direkt nach dem naechsten festen 4h-Slot genau einer mehr', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnDungeon').click();
    await refreshDungeonStatus(page);
    await page.evaluate(() => bkmpDungeonConsumeKey('exp')); // auf 4/5, exakt auf dem 08:00-Slot verankert

    store.clock.advance(3 * 3600 * 1000 + 59 * 60 * 1000); // -> 11:59 Berlin, naechster Slot 12:00 noch nicht erreicht
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.exp.keys)).toBe(4);

    store.clock.advance(2 * 60 * 1000); // -> 12:01 Berlin, ueber den 12:00-Slot hinaus
    await refreshDungeonStatus(page);
    expect(await page.evaluate(() => bkmpDungeonStatusByType.exp.keys)).toBe(5);
  });
});
