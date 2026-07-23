const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Auftrag Abschnitt 20: Offline-/AFK-Belohnungen. Komplett serverseitig
   berechnet (api/claim-idle-offline-progress.js) - hier ueber die ECHTE,
   unveraenderte Handler-Datei aufgerufen (tests/mock/offline-progress-
   handler.js), keine Testkopie der Belohnungsformel. Nur die Mock-Uhr
   (store.clock) wird vorgespult - das ist server-seitige Zeit, exakt das,
   was der Handler tatsaechlich als "jetzt" sieht. */
test.describe('Offline-/AFK-Fortschritt', () => {
  test.use({ teststand: 'B' });

  async function claimOffline(page) {
    return page.evaluate(() => bkmpIdleClaimOfflineProgress(bkmpGetMcName()));
  }

  test('unter 60s Abwesenheit gibt es keine Belohnung', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await claimOffline(page);
    expect(result.elapsedSeconds).toBeLessThan(60);
    expect(result.rewards).toBeNull();
  });

  test('30 Minuten Abwesenheit zahlt eine Belohnung', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const goldBefore = await page.evaluate(() => bkmpIdleState.gold);

    store.clock.advance(30 * 60 * 1000);
    const result = await claimOffline(page);

    expect(result.ok).toBe(true);
    expect(result.elapsedSeconds).toBeGreaterThan(1000);
    expect(result.rewards).not.toBeNull();
    await page.evaluate((r) => { bkmpIdleApplyOfflineResult(r); }, result);
    const goldAfter = await page.evaluate(() => bkmpIdleState.gold);
    expect(goldAfter).toBeGreaterThan(goldBefore);
  });

  test('4 Stunden Abwesenheit zahlt mehr als 30 Minuten', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    store.clock.advance(30 * 60 * 1000);
    const shortResult = await claimOffline(page);
    await page.evaluate((r) => bkmpIdleApplyOfflineResult(r), shortResult);

    store.clock.advance(4 * 3600 * 1000);
    const longResult = await claimOffline(page);

    expect(longResult.rewards.gold).toBeGreaterThan(shortResult.rewards.gold);
    expect(longResult.elapsedSeconds).toBeGreaterThan(shortResult.elapsedSeconds);
  });

  test('Abwesenheit wird bei maxHours gedeckelt (12h), auch nach 30 Tagen', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    // WICHTIG: exakt derselbe Ausgangszustand fuer beide Vergleichswerte -
    // ein Vergleich "12h-Ertrag == 30-Tage-Ertrag" nach dem erste Claim schon
    // angewendet wurde waere unfair (current_dragon_index waere durch den
    // ersten Claim bereits weitergerueckt, staerkere/andere Drachen liefern
    // einen ANDEREN Erwartungswert - kein Bug, nur ein unfairer Test-Vergleich,
    // ueber die erste Fassung dieses Tests gefunden). Deshalb: derselbe Claim-
    // Zeitpunkt (12h vorspulen), aber zwei UNABHAENGIGE Requests gegen den
    // gleichen (noch unveraenderten) last_seen_at-Stand - eine echte
    // Wiederholung mit identischem Ausgangspunkt.
    store.clock.advance(12 * 3600 * 1000);
    const twelveHourResult = await claimOffline(page);
    expect(twelveHourResult.elapsedSeconds).toBe(12 * 3600);
    expect(twelveHourResult.ok).toBe(true);

    // Weitere 30 Tage - der Server MUSS bei den gleichen 12h kappen (nicht
    // linear mit der laengeren Abwesenheit weiter wachsen).
    store.clock.advance(30 * 24 * 3600 * 1000);
    const thirtyDayResult = await claimOffline(page);
    expect(thirtyDayResult.elapsedSeconds).toBe(12 * 3600);
  });

  test('Belohnungen und Endwerte sind nie negativ oder NaN, auch nach 7 Tagen Abwesenheit', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    store.clock.advance(7 * 24 * 3600 * 1000);
    const result = await claimOffline(page);

    expect(result.ok).toBe(true);
    Object.values(result.rewards).forEach(v => {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBeGreaterThanOrEqual(0);
    });
    Object.entries(result.newTotals).forEach(([key, v]) => {
      if (typeof v !== 'number') return;
      expect(Number.isNaN(v)).toBe(false);
      if (key !== 'current_dragon_index') expect(v).toBeGreaterThanOrEqual(0);
    });
  });

  test('ein zweiter Claim direkt danach (keine weitere Zeit vergangen) zahlt nicht doppelt aus', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    store.clock.advance(2 * 3600 * 1000);
    const first = await claimOffline(page);
    expect(first.rewards).not.toBeNull();
    await page.evaluate((r) => bkmpIdleApplyOfflineResult(r), first);

    // Keine weitere store.clock.advance() - "jetzt" ist dieselbe Sekunde wie
    // beim ersten Claim, dessen last_seen_at bereits atomar auf "jetzt" gesetzt wurde.
    const second = await claimOffline(page);
    expect(second.elapsedSeconds).toBeLessThan(60);
    expect(second.rewards).toBeNull();
  });

  test('Login-Streak wird durch eine Offline-Belohnung nicht mehrfach ausgeloest', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const streakAfterOpen = await page.evaluate(() => JSON.parse(localStorage.getItem('bkmp-idle-login-streak') || 'null'));
    expect(streakAfterOpen.count).toBe(1);

    // Mehrere Offline-Claims am selben (Browser-)Kalendertag duerfen den
    // Login-Streak (rein clientseitig, siehe login-streak.spec.js) nicht
    // beeinflussen - das sind zwei unabhaengige Systeme.
    store.clock.advance(3 * 3600 * 1000);
    await claimOffline(page);
    store.clock.advance(3 * 3600 * 1000);
    await claimOffline(page);

    const streakAfterClaims = await page.evaluate(() => JSON.parse(localStorage.getItem('bkmp-idle-login-streak') || 'null'));
    expect(streakAfterClaims.count).toBe(1);
  });
});
