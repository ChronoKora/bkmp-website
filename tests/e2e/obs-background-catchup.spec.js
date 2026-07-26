const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Gezielter Bugfix (26.07.2026, Spieler-Meldung mit Screenshot: "kein
   ersichtlicher Fortschritt im OBS-Overlay, wenn das Hauptfenster im
   Hintergrund ist - nur die Animation bewegt sich"). Root Cause: Browser
   drosseln setInterval in einer wirklich verdeckten Registerkarte (Chrome
   "Intensive Throttling") unabhaengig vom Code - bei einer laengeren
   Streaming-Session (Hauptfenster bleibt bewusst unfokussiert) fiel der
   normale Kampf-Tick dadurch faktisch aus, das Overlay zeigte seitdem nur
   noch seine eigenen CSS-Deko-Animationen. Fix: waehrend der Tab versteckt
   UND tatsaechlich ein Overlay-Zuschauer verbunden ist
   (bkmpCombatBroadcastHasListener), laeuft ein eigenes, selteneres
   Intervall (bkmpIdleStartBackgroundStreamCatchup(), idledorf.js), das die
   bereits bestehende Server-Nachhol-Berechnung (bkmpIdleClaimOfflineProgress
   - dieselbe Formel wie beim normalen Offline-Claim) nutzt und bei einem
   Stufenwechsel per bkmpIdleSpawnDragon() sofort neu broadcastet.

   Diese Tests rufen die Kern-Logik direkt auf (bkmpIdleBackgroundStreamCatchupTick())
   statt 20s echte Zeit abzuwarten - testet denselben Code-Pfad, den auch
   das echte setInterval periodisch ausloest, ohne die Testlaufzeit
   aufzublaehen. */

test.use({ teststand: 'B' });

function setHidden(page, hidden) {
  return page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { value: h, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('Waehrend versteckt + verbundener Zuschauer: periodischer Tick wendet echten Fortschritt an', async ({ page, qaBaseURL, fixtureData, store }) => {
  await openAndLogin(page, qaBaseURL, fixtureData);
  await waitForDragonReady(page);

  const before = await page.evaluate(() => ({
    gold: bkmpIdleState.gold, dragonKills: bkmpIdleState.dragon_kills, stage: bkmpIdleState.current_dragon_index
  }));

  await page.evaluate(() => { bkmpCombatBroadcastHasListener = true; });
  await setHidden(page, true);
  store.clock.advance(30 * 60 * 1000); // 30 Minuten server-seitige Zeit, weit ueber der 60s-Mindestgrenze

  await page.evaluate(() => window.bkmpIdleBackgroundStreamCatchupTick());

  const after = await page.evaluate(() => ({
    gold: bkmpIdleState.gold, dragonKills: bkmpIdleState.dragon_kills, stage: bkmpIdleState.current_dragon_index,
    dragonHp: bkmpIdleCurrentDragon ? bkmpIdleCurrentDragon.hp : null,
    dragonMaxHp: bkmpIdleCurrentDragon ? bkmpIdleCurrentDragon.maxHp : null
  }));

  expect(after.gold).toBeGreaterThan(before.gold);
  expect(after.dragonKills).toBeGreaterThan(before.dragonKills);
  // Bei einem Stufenwechsel muss der Drache tatsaechlich frisch (voll-HP,
  // passend zur neuen Stufe) neu aufgebaut worden sein - kein stehen
  // gebliebener, jetzt zur Stufe nicht mehr passender Zustand.
  if (after.stage !== before.stage) {
    expect(after.dragonHp).toBe(after.dragonMaxHp);
  }
});

test('Ohne verbundenen Zuschauer: kein Nachhol-Tick, kein Fortschritt', async ({ page, qaBaseURL, fixtureData, store }) => {
  await openAndLogin(page, qaBaseURL, fixtureData);
  await waitForDragonReady(page);

  const before = await page.evaluate(() => ({ gold: bkmpIdleState.gold, dragonKills: bkmpIdleState.dragon_kills }));

  await page.evaluate(() => { bkmpCombatBroadcastHasListener = false; });
  await setHidden(page, true);
  store.clock.advance(30 * 60 * 1000);

  await page.evaluate(() => window.bkmpIdleBackgroundStreamCatchupTick());

  const after = await page.evaluate(() => ({ gold: bkmpIdleState.gold, dragonKills: bkmpIdleState.dragon_kills }));
  expect(after.gold).toBe(before.gold);
  expect(after.dragonKills).toBe(before.dragonKills);
});

test('Intervall startet beim Verstecken (mit Zuschauer) und stoppt beim Sichtbarwerden', async ({ page, qaBaseURL, fixtureData }) => {
  await openAndLogin(page, qaBaseURL, fixtureData);
  await waitForDragonReady(page);
  await page.evaluate(() => { bkmpCombatBroadcastHasListener = true; });

  await setHidden(page, true);
  const runningWhileHidden = await page.evaluate(() => bkmpIdleBackgroundStreamCatchupTimer !== null);
  expect(runningWhileHidden).toBe(true);

  await setHidden(page, false);
  const stoppedWhileVisible = await page.evaluate(() => bkmpIdleBackgroundStreamCatchupTimer === null);
  expect(stoppedWhileVisible).toBe(true);
});

test('Erneutes Verstecken startet kein zweites, ueberlappendes Intervall', async ({ page, qaBaseURL, fixtureData }) => {
  await openAndLogin(page, qaBaseURL, fixtureData);
  await waitForDragonReady(page);
  await page.evaluate(() => { bkmpCombatBroadcastHasListener = true; });

  await setHidden(page, true);
  const firstTimerId = await page.evaluate(() => bkmpIdleBackgroundStreamCatchupTimer);
  // Zweiter "hidden"-Aufruf ohne dazwischenliegendes "visible" (z.B. zwei
  // rasch aufeinanderfolgende visibilitychange-Events) darf das bestehende
  // Intervall nicht verwaisen lassen.
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  const secondTimerId = await page.evaluate(() => bkmpIdleBackgroundStreamCatchupTimer);
  expect(secondTimerId).toBe(firstTimerId);
});
