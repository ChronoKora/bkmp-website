const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* QA-Grundlage Phase 2 (24.07.2026) - siehe identischer Kommentar in
   buttons-inventory.spec.js: diese Datei klickt #idleTabBtnPrestige per
   echtem Playwright-.click() (verlangt Sichtbarkeit), auf mobile-*-Projekten
   ist der Knoten korrekt unsichtbar (kompakte Navigation) - 30s-Timeout,
   kein App-Bug. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - siehe Kommentar oben, mobile-smoke.spec.js deckt die kompakte Navigation ab');
});

/* Auftrag Abschnitt 15: Prestige. Laeuft gegen die echte
   bkmpPrestigeExecuteReset() (idledorf.js/bkmp-prestige.js), kein Test-
   Doppel der Reset-Logik. Mindest-Drachenstufe fuer Prestige-Level 0 ist
   100 (bkmpPrestigeRequiredStage: 100 + level*50, js/systems/bkmp-
   prestige.js:26) - direkt gesetzt statt hunderte Kaempfe zu simulieren,
   das Reset-VERHALTEN selbst bleibt echter Produktionscode. */
test.describe('Prestige', () => {
  test.use({ teststand: 'B' });

  test('Button ist erst ab der Mindest-Drachenstufe sichtbar', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // Teststand B: highest_dragon_index=34, Mindeststufe fuer Level 0 ist 100.
    await page.locator('#idleTabBtnPrestige').click();
    await expect(page.locator('#idlePrestigeBtn')).toHaveCount(0);
    await expect(page.locator('#idlePanelPrestige')).toContainText('Erreiche Drachen-Stufe');
  });

  test('vollstaendiger Aufstieg: Level/Gold/Skilltree/Upgrades/Drachen-Fortschritt zurueckgesetzt, Runen bleiben', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    await page.evaluate(() => { bkmpIdleState.highest_dragon_index = 150; });
    await page.locator('#idleTabBtnPrestige').click();
    await page.evaluate(() => bkmpIdleRenderPrestigePanel());

    const before = await page.evaluate(() => ({
      prestigeLevel: bkmpPrestigeState ? bkmpPrestigeState.prestige_level : 0,
      dragonKills: bkmpIdleState.dragon_kills,
      runeCount: bkmpIdlePlayerRunes.length,
      equippedRuneIds: bkmpIdlePlayerRunes.filter(r => r.equipped).map(r => r.id).sort()
    }));

    await expect(page.locator('#idlePrestigeBtn')).toBeVisible();
    await page.locator('#idlePrestigeBtn').click();
    await expect(page.locator('#idlePrestigeConfirmOverlay')).toHaveClass(/visible/, { timeout: 5000 });
    await page.locator('#idlePrestigeConfirmNextBtn').click();
    await expect(page.locator('#idlePrestigeConfirmFinalBtn')).toBeVisible();
    await page.locator('#idlePrestigeConfirmFinalBtn').click();
    await expect(page.locator('#idlePrestigeConfirmOverlay')).not.toHaveClass(/visible/, { timeout: 10000 });

    const after = await page.evaluate(() => ({
      level: bkmpIdleState.level,
      xp: bkmpIdleState.xp,
      gold: bkmpIdleState.gold,
      wood: bkmpIdleState.wood,
      stone: bkmpIdleState.stone,
      crystals: bkmpIdleState.crystals,
      essence: bkmpIdleState.essence,
      skillPointsSpent: bkmpIdleState.skill_points_spent,
      upgradePurchases: bkmpIdleState.upgrade_purchases,
      currentDragonIndex: bkmpIdleState.current_dragon_index,
      highestDragonIndex: bkmpIdleState.highest_dragon_index,
      dragonKills: bkmpIdleState.dragon_kills,
      prestigeLevel: bkmpPrestigeState.prestige_level,
      prestigePoints: bkmpPrestigeState.prestige_points,
      runeCount: bkmpIdlePlayerRunes.length,
      equippedRuneIds: bkmpIdlePlayerRunes.filter(r => r.equipped).map(r => r.id).sort()
    }));

    // Muss zurueckgesetzt sein.
    expect(after.level).toBe(1);
    expect(after.xp).toBe(0);
    expect(after.gold).toBe(0);
    expect(after.wood).toBe(0);
    expect(after.stone).toBe(0);
    expect(after.crystals).toBe(0);
    expect(after.essence).toBe(0);
    expect(after.skillPointsSpent).toBe(0);
    expect(Object.keys(after.upgradePurchases).length).toBe(0);
    expect(after.currentDragonIndex).toBe(0);
    expect(after.highestDragonIndex).toBe(0);

    // Muss erhalten bleiben (dragon_kills seit 18.07. explizit NICHT mehr
    // zurueckgesetzt, siehe Kommentar in bkmpPrestigeExecuteReset).
    expect(after.dragonKills).toBe(before.dragonKills);
    expect(after.runeCount).toBe(before.runeCount);
    expect(after.equippedRuneIds).toEqual(before.equippedRuneIds);

    // Der eigentliche Aufstieg.
    expect(after.prestigeLevel).toBe(before.prestigeLevel + 1);
    expect(after.prestigePoints).toBeGreaterThan(0);
  });

  test('Abbrechen im Bestaetigungsdialog aendert nichts', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => { bkmpIdleState.highest_dragon_index = 150; });
    await page.locator('#idleTabBtnPrestige').click();
    await page.evaluate(() => bkmpIdleRenderPrestigePanel());

    const levelBefore = await page.evaluate(() => bkmpIdleState.level);
    await page.locator('#idlePrestigeBtn').click();
    await expect(page.locator('#idlePrestigeConfirmOverlay')).toHaveClass(/visible/, { timeout: 5000 });
    await page.locator('#idlePrestigeConfirmCancelBtn').click();
    await expect(page.locator('#idlePrestigeConfirmOverlay')).not.toHaveClass(/visible/, { timeout: 5000 });

    const levelAfter = await page.evaluate(() => bkmpIdleState.level);
    expect(levelAfter).toBe(levelBefore);
  });

  test('ein zweiter Klick auf "endgueltig aufsteigen" loest keinen doppelten Aufstieg aus', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => { bkmpIdleState.highest_dragon_index = 150; });
    await page.locator('#idleTabBtnPrestige').click();
    await page.evaluate(() => bkmpIdleRenderPrestigePanel());

    await page.locator('#idlePrestigeBtn').click();
    await expect(page.locator('#idlePrestigeConfirmOverlay')).toHaveClass(/visible/, { timeout: 5000 });
    await page.locator('#idlePrestigeConfirmNextBtn').click();

    const finalBtn = page.locator('#idlePrestigeConfirmFinalBtn');
    await expect(finalBtn).toBeVisible();
    // Zwei schnelle Klicks direkt hintereinander - bkmpPrestigeSaving muss
    // den zweiten Aufruf von bkmpPrestigeExecuteReset() blockieren.
    await finalBtn.click({ force: true, noWaitAfter: true });
    await finalBtn.click({ force: true, noWaitAfter: true }).catch(() => {});
    await page.waitForTimeout(500);

    const prestigeLevel = await page.evaluate(() => bkmpPrestigeState.prestige_level);
    expect(prestigeLevel).toBe(1); // genau EIN Aufstieg, nicht zwei
  });

  test('Reload nach dem Aufstieg behaelt den neuen (zurueckgesetzten) Stand', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    /* Stabilitaets-Fix (Sicherheits-/Stabilitaetsphase 24.07.2026, siehe
       CLAUDE.md): ohne diesen Stop lief der Auto-Tick-Kampf-Loop waehrend
       des GESAMTEN Tests weiter - auch NACH bkmpPrestigeExecuteReset(), das
       den Drachen-Index korrekt auf 0 zuruecksetzt UND sofort einen neuen,
       sehr schwachen Drachen spawnt (bkmpIdleSpawnDragon(), bkmp-prestige.js:
       568). Der Reset selbst schreibt gold=0 korrekt und sofort
       (bkmpIdleFlushSyncNow() wird awaited), aber der weiterlaufende Loop
       kann DANACH unbemerkt bereits den naechsten Kill einstreichen -
       page.reload() loest dabei den 'beforeunload'-Handler (idledorf.js:
       2572) aus, der bkmpIdleQueueSync()+bkmpIdleFlushSync() SOFORT (nicht
       erst nach 4s-Debounce) mit dem dann AKTUELLEN (nicht mehr 0) Gold-Wert
       feuert - das ueberschreibt den sauberen Reset-Wert im Mock-Server, je
       nachdem ob dieser Schreibvorgang die Navigation noch rechtzeitig
       erreicht (erklaert die Seltenheit/Sporadik). Per eigens gebautem
       Diagnose-Test empirisch UND DETERMINISTISCH bestaetigt (nicht nur
       vermutet): 5/5 Wiederholungen mit erzwungenem Wartefenster zeigten
       exakt denselben stehengebliebenen Gold-Wert nach dem Reload wie
       unmittelbar vor dem Reload (z.B. 15 vor Reload -> 15 nach Reload,
       nie 0). Gleiches Grundmuster wie der combat.spec.js-Fix oben in
       dieser Session: der Hintergrund-Loop ist fuer DIESEN Test nur eine
       unbeabsichtigte Stoerquelle (getestet wird der Reset-Bestand nach
       Reload, nicht das Zusammenspiel mit dem Auto-Tick) - kein
       force:true/waitForTimeout/laengeres Timeout noetig, kein App-Code
       angefasst. */
    await page.evaluate(() => bkmpIdleStopLoop());
    await page.evaluate(() => { bkmpIdleState.highest_dragon_index = 150; });
    await page.locator('#idleTabBtnPrestige').click();
    await page.evaluate(() => bkmpIdleRenderPrestigePanel());

    await page.locator('#idlePrestigeBtn').click();
    await page.locator('#idlePrestigeConfirmNextBtn').click();
    await page.locator('#idlePrestigeConfirmFinalBtn').click();
    await expect(page.locator('#idlePrestigeConfirmOverlay')).not.toHaveClass(/visible/, { timeout: 10000 });

    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await page.waitForFunction(() => typeof bkmpIdleState !== 'undefined' && bkmpIdleState != null, null, { timeout: 15000 });
    await waitForDragonReady(page);

    const state = await page.evaluate(() => ({ level: bkmpIdleState.level, gold: bkmpIdleState.gold, prestigeLevel: bkmpPrestigeState.prestige_level }));
    expect(state.level).toBe(1);
    expect(state.gold).toBe(0);
    expect(state.prestigeLevel).toBe(1);
  });
});
