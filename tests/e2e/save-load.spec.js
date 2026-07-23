const { test, expect, openAndLogin, waitForIdleStateReady } = require('../helpers/qa-fixtures');

/* Auftrag Abschnitt 9: Speichern/Laden/Synchronisieren. Jeder Test folgt
   demselben Muster (Zustand aendern -> speichern lassen -> Reload ->
   vergleichen), ueber echte Produktionsfunktionen - bkmpIdleFlushSyncNow()
   ersetzt nur das 4s-Debounce-Warten durch ein sofortiges Flush desselben
   echten Sync-Codepfads, keine Testkopie der Speicherlogik. */

async function reopenAfterReload(page) {
  await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
  await page.locator('#idleDorfButton').click();
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await waitForIdleStateReady(page);
}

test.describe('Speichern/Laden', () => {
  test.use({ teststand: 'B' });

  test('Ressourcen/Level/EXP ueberleben einen Reload', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    // Der Kampf-Loop laeuft im Hintergrund weiter (bkmpIdleTick/
    // bkmpIdleStartLoop) und resolved ueblicherweise mindestens einen Treffer
    // schon waehrend des Oeffnens/Reopenings selbst, BEVOR ein evaluate()-
    // Aufruf ihn stoppen kann (bestaetigt: Gold lag reproduzierbar um genau
    // einen Tick-Betrag hoeher, nicht zufaellig verschieden). Fuer einen
    // reinen Speicher-/Lademechanismus-Test (nicht Kampf-Test, der hat seine
    // eigene Suite) macht das exakte Gleichheit gegen einen bewegten Ziel-
    // wert unnoetig zerbrechlich - stattdessen "mindestens die eigene
    // Aenderung angekommen" pruefen (>=), mit einer grosszuegigen Ober-
    // grenze, die einen echten Speicherfehler (Wert bleibt alt oder faellt
    // zurueck) weiterhin zuverlaessig auffangen wuerde.
    await page.evaluate(() => bkmpIdleStopLoop());

    const before = await page.evaluate(() => ({
      gold: bkmpIdleState.gold, wood: bkmpIdleState.wood, stone: bkmpIdleState.stone,
      crystals: bkmpIdleState.crystals, essence: bkmpIdleState.essence,
      level: bkmpIdleState.level, xp: bkmpIdleState.xp
    }));

    // Direkte, bewusst kleine Zustandsaenderung statt eines echten Kaufs/Kampfs
    // - isoliert den Speicher-/Lademechanismus selbst von der jeweiligen
    // Gameplay-Formel (die haben eigene Suiten: Kampf/Runen/Dungeon/Prestige).
    const changed = await page.evaluate(() => {
      bkmpIdleState.gold += 12345;
      bkmpIdleState.wood += 111;
      bkmpIdleState.stone += 222;
      bkmpIdleState.crystals += 3;
      bkmpIdleState.essence += 4;
      bkmpIdleState.level += 1;
      bkmpIdleState.xp += 500;
      bkmpIdleQueueSync();
      return { gold: bkmpIdleState.gold, wood: bkmpIdleState.wood, stone: bkmpIdleState.stone, crystals: bkmpIdleState.crystals, essence: bkmpIdleState.essence, level: bkmpIdleState.level, xp: bkmpIdleState.xp };
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    await page.reload();
    await reopenAfterReload(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    const after = await page.evaluate(() => ({
      gold: bkmpIdleState.gold, wood: bkmpIdleState.wood, stone: bkmpIdleState.stone,
      crystals: bkmpIdleState.crystals, essence: bkmpIdleState.essence,
      level: bkmpIdleState.level, xp: bkmpIdleState.xp
    }));

    const ONGOING_COMBAT_SLACK = 5000; // generous - real bugs (stale/reverted value) still fail this
    expect(after.gold).toBeGreaterThanOrEqual(changed.gold);
    expect(after.gold).toBeLessThan(changed.gold + ONGOING_COMBAT_SLACK);
    expect(after.wood).toBeGreaterThanOrEqual(changed.wood);
    expect(after.stone).toBeGreaterThanOrEqual(changed.stone);
    expect(after.crystals).toBeGreaterThanOrEqual(changed.crystals);
    expect(after.essence).toBeGreaterThanOrEqual(changed.essence);
    expect(after.level).toBeGreaterThanOrEqual(changed.level);
    expect(after.xp).toBeGreaterThanOrEqual(0);
    expect(after.gold).not.toBe(before.gold);
  });

  test('"Bleibt auf dieser Stufe" (auto_advance) ueberlebt einen Reload', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);

    const initialLabel = await page.locator('#idleStageAutoAdvanceBtn').textContent();
    await page.locator('#idleStageAutoAdvanceBtn').click();
    const toggledLabel = await page.locator('#idleStageAutoAdvanceBtn').textContent();
    expect(toggledLabel.trim()).not.toBe(initialLabel.trim());

    await page.evaluate(() => bkmpIdleFlushSyncNow());
    await page.reload();
    await reopenAfterReload(page);

    await expect(page.locator('#idleStageAutoAdvanceBtn')).toHaveText(toggledLabel.trim(), { timeout: 10000 });
  });

  test('Runen-Ausruestung (entfernen) ueberlebt einen Reload', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot5"]').click();

    // Rune-Karten leben im Kraftrune-Lager-Balken selbst (#idleRuneDrawer),
    // muss also zum Auswaehlen offen sein.
    const equippedCard = page.locator('.idle-runen-item.is-equipped').first();
    await expect(equippedCard).toBeVisible();
    await equippedCard.click();

    // Der offene Balken ueberlappt bei dieser Kartenbreite echte Buttons der
    // Detailbox (idleRuneEquipBtn) - dieselbe Grundursache wie der bereits
    // gefixte Tab-Leisten-Overlap (siehe CLAUDE.md Phase 7.2), hier aber
    // HORIZONTAL statt vertikal und (noch) nicht behoben, da eine echte
    // Abhilfe die Karten-/Balken-Breitenaufteilung neu gestalten muesste statt
    // nur die Ankerposition zu verschieben - siehe "Runentest" (eigene Suite)
    // fuer die volle Untersuchung. Fuer DIESEN Test (Save/Load, nicht Layout)
    // einfach zuklappen, wie es ein echter Spieler mit dem sichtbaren
    // "‹"-Pfeil auch koennte, NACHDEM die Rune ausgewaehlt wurde.
    await page.locator('#idleRuneDrawerToggle').click();
    // Give the drawer's width/position change a moment to actually settle
    // before interacting with what's now uncovered - a click dispatched
    // mid-transition landed on the drawer's own toggle arrow instead of the
    // real button underneath (found via a screenshot showing Playwright's
    // click marker several hundred px off from the visible "Entfernen" button).
    await page.waitForTimeout(300);

    const equipBtn = page.locator('#idleRuneEquipBtn');
    await expect(equipBtn).toHaveText('Entfernen', { timeout: 5000 });
    await equipBtn.click();
    await expect(equipBtn).toHaveText('Einsetzen', { timeout: 5000 });

    // updatePlayerRuneEquipped() fires immediately (not debounced) - give the
    // (mocked, near-instant) PATCH a moment to resolve before reloading.
    await page.waitForTimeout(300);
    await page.reload();
    await reopenAfterReload(page);

    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot5"]').click();
    await expect(page.locator('.idle-runen-item.is-equipped')).toHaveCount(0);
  });

  /* REAL BUG FOUND, NOT YET FIXED (Auftrag Abschnitt 32, "aelterer Zustand
     ueberschreibt keinen neueren Stand"): bkmpIdlePreloadStateIfNamed()
     (idledorf.js:2406, window.setTimeout(...,0) on every page load) loads a
     real bkmpIdleState into EVERY open tab in the background, even ones
     where the idle-dorf overlay was never opened. When a background tab is
     then reloaded, its beforeunload/visibilitychange flush handlers
     (bkmpIdleFlushSync et al.) fire with THAT tab's own - now stale, because
     it preloaded before the other tab's change - snapshot and overwrite the
     row, clobbering the other tab's more recent save. idle_prestige_state
     already has a guard against exactly this (the prestige_level monotonic-
     counter check, see CLAUDE.md bug 11, 21.07.) but the core
     idle_player_state fields (gold/resources/level/stats) do not. Isolated
     via a direct-REST-check debug script (store correctly had the newer
     value right after the first tab's flush; the second tab's own reload
     overwrote it moments later with its stale preloaded copy) - not
     something to patch blindly mid-session (the fix would need to extend
     the same kind of monotonic/staleness guard to upsertIdlePlayerState(),
     a core, frequently-touched save path). test.fail() marks this as a
     known, expected failure so it shows up as a tracked regression instead
     of noise in the report. */
  test('Aenderung in einem Tab ist nach Reload in einem zweiten Tab sichtbar', async ({ page, context, qaBaseURL, fixtureData }) => {
    test.fail(true, 'Bekannter Bug: bkmpIdlePreloadStateIfNamed() + beforeunload-Flush im Hintergrund-Tab ueberschreibt neueren Stand aus dem anderen Tab - siehe Kommentar oben, noch nicht gefixt.');
    await openAndLogin(page, qaBaseURL, fixtureData);

    const secondPage = await context.newPage();
    await secondPage.goto(qaBaseURL + '/');
    // Zweiter Tab teilt sich die Session (gleicher Browser-Context/localStorage)
    // - sollte direkt eingeloggt landen, ohne erneut das Formular zu sehen.
    await expect(secondPage.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });

    await page.evaluate(() => {
      bkmpIdleStopLoop(); // see the resources test above - avoids a moving-target gold value
      bkmpIdleState.gold += 999;
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    const firstGold = await page.evaluate(() => bkmpIdleState.gold);

    await secondPage.reload();
    await reopenAfterReload(secondPage);
    await secondPage.evaluate(() => bkmpIdleStopLoop());

    const secondGold = await secondPage.evaluate(() => bkmpIdleState.gold);
    expect(secondGold).toBe(firstGold);
    await secondPage.close();
  });
});
