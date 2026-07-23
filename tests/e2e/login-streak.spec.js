const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Auftrag Abschnitt 19: Login-Streak. Rein clientseitig (localStorage
   'bkmp-idle-login-streak', js/systems/bkmp-events.js bkmpIdleCheckDailyStreak) -
   KEIN Server-Roundtrip, deshalb ist hier (anders als beim Dungeon-Suite)
   tatsaechlich die BROWSER-Uhr das, was zaehlt (bkmpIdleDateStr() nutzt
   new Date().getFullYear()/getMonth()/getDate() - lokale Browser-Zeitzone,
   nicht extra Europe/Berlin wie beim Gildenboss). page.clock.setFixedTime()
   statt fastForward()/qaClock.advance(): ein echter Tagessprung wuerde sonst
   JEDEN dazwischenliegenden 900ms-Kampf-Tick tatsaechlich abfeuern (langsam,
   und fuer diesen Test irrelevant - die eigentliche Kampf-Tick-Zeitreise hat
   ihre eigene Zukunft in der Offline-/AFK-Suite). bkmpIdleCheckDailyStreak()
   direkt aufgerufen statt jedes Mal das ganze Fenster zu schliessen/wieder-
   zuoeffnen - dieselbe echte Produktionsfunktion, die bkmpIdleOpenModal()
   bei jedem echten Wiedereroeffnen sowieso aufruft. */
test.describe('Login-Streak', () => {
  test.use({ teststand: 'A', useFakeClock: true, startTimeMs: Date.parse('2026-03-10T10:00:00.000Z') });

  function readStreak(page) {
    return page.evaluate(() => JSON.parse(localStorage.getItem('bkmp-idle-login-streak') || 'null'));
  }

  test('erster Login des Tages zaehlt als Streak-Tag 1 und zahlt Gold', async ({ page, qaBaseURL, fixtureData, qaClock }) => {
    await openAndLogin(page, qaBaseURL, fixtureData); // bkmpIdleOpenModal() ruft bkmpIdleCheckDailyStreak() bereits selbst auf
    await waitForDragonReady(page);
    const streak = await readStreak(page);
    expect(streak.count).toBe(1);
    const gold = await page.evaluate(() => bkmpIdleState.gold);
    expect(gold).toBeGreaterThan(0); // Teststand A startet bei 0 Gold, +500*1 Streak-Bonus
  });

  test('ein zweiter Aufruf am selben Tag zahlt die Belohnung nicht doppelt aus', async ({ page, qaBaseURL, fixtureData, qaClock }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const goldAfterFirst = await page.evaluate(() => bkmpIdleState.gold);
    const streakAfterFirst = await readStreak(page);

    await page.evaluate(() => bkmpIdleCheckDailyStreak());

    const goldAfterSecond = await page.evaluate(() => bkmpIdleState.gold);
    const streakAfterSecond = await readStreak(page);
    expect(streakAfterSecond.count).toBe(streakAfterFirst.count);
    expect(goldAfterSecond).toBe(goldAfterFirst);
  });

  test('am naechsten Kalendertag steigt der Streak auf 2', async ({ page, qaBaseURL, fixtureData, qaClock }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    expect((await readStreak(page)).count).toBe(1);

    await page.clock.setFixedTime(Date.parse('2026-03-11T10:00:00.000Z')); // +24h, naechster Kalendertag
    await page.evaluate(() => bkmpIdleCheckDailyStreak());

    const streak = await readStreak(page);
    expect(streak.count).toBe(2);
  });

  test('ein uebersprungener Tag setzt den Streak auf 1 zurueck', async ({ page, qaBaseURL, fixtureData, qaClock }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.clock.setFixedTime(Date.parse('2026-03-11T10:00:00.000Z')); // Tag 2
    await page.evaluate(() => bkmpIdleCheckDailyStreak());
    expect((await readStreak(page)).count).toBe(2);

    await page.clock.setFixedTime(Date.parse('2026-03-13T10:00:00.000Z')); // Tag 4 - Tag 3 uebersprungen
    await page.evaluate(() => bkmpIdleCheckDailyStreak());
    const streak = await readStreak(page);
    expect(streak.count).toBe(1);
  });

  test('jeder 5. Streak-Tag zahlt zusaetzlich Edelsteine', async ({ page, qaBaseURL, fixtureData, qaClock }) => {
    await openAndLogin(page, qaBaseURL, fixtureData); // Tag 1
    await waitForDragonReady(page);
    const crystalsBefore = await page.evaluate(() => bkmpIdleState.crystals);

    for (let day = 2; day <= 5; day++) {
      await page.clock.setFixedTime(Date.parse(`2026-03-${9 + day}T10:00:00.000Z`));
      await page.evaluate(() => bkmpIdleCheckDailyStreak());
    }
    const streak = await readStreak(page);
    expect(streak.count).toBe(5);
    const crystalsAfter = await page.evaluate(() => bkmpIdleState.crystals);
    expect(crystalsAfter).toBeGreaterThan(crystalsBefore);
  });

  test('Reload direkt nach dem Beanspruchen zahlt keine zweite Belohnung aus', async ({ page, qaBaseURL, fixtureData, qaClock }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const streakBeforeReload = await readStreak(page);
    const goldBeforeReload = await page.evaluate(() => bkmpIdleState.gold);
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await page.waitForFunction(() => typeof bkmpIdleState !== 'undefined' && bkmpIdleState != null, null, { timeout: 15000 });
    await waitForDragonReady(page);

    const streakAfterReload = await readStreak(page);
    const goldAfterReload = await page.evaluate(() => bkmpIdleState.gold);
    expect(streakAfterReload.count).toBe(streakBeforeReload.count);
    expect(goldAfterReload).toBe(goldBeforeReload);
  });
});
