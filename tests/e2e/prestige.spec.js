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
    /* Stabilitaets-Fix (Sicherheits-/Stabilitaetsphase 24.07.2026): stoppt
       den Auto-Tick-Kampf-Loop, damit der Klick-Ablauf unten nicht durch
       einen parallel laufenden Kampf gestoert wird (identisches Muster wie
       der combat.spec.js-Fix). */
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
    await page.evaluate(() => bkmpIdleStopLoop());

    /* ECHTE Ursache eines sporadischen Fehlschlags gefunden (25.07.2026,
       per Setter-Falle auf bkmpIdleState.gold + vollstaendigem Netzwerk-Log
       isoliert, unter kuenstlicher Last 4x wiederholt reproduziert -
       KEIN Timer-/Sync-Wettlauf, wie zwei vorherige Reparaturversuche
       fael­schlich annahmen; beide Server-Schreibvorgaenge (Reset auf 0,
       anschliessendes Auslesen nach dem Reload) waren nachweislich stets
       korrekt): bkmpIdleAccrueProductionBuildings() (idledorf.js, laeuft
       bei JEDEM bkmpIdleLoadOrInitState()-Aufruf, also auch direkt nach
       diesem Reload) rechnet fuer JEDES Produktionsgebaeude die seit
       dessen *_collected_at verstrichene Zeit zur Grundrate hinzu - AUCH
       bei Stufe 0 ("Level 0 produziert weiterhin die Grundrate", siehe
       Kommentar in bkmpPrestigeExecuteReset() oben). Der Prestige-Reset
       setzt bewusst NUR die Gebaeude-STUFEN zurueck, nicht ihre
       *_collected_at-Zeitstempel (exakt dokumentiertes, gewolltes
       Verhalten - identisches Prinzip wie bei fruit/meat). Die Goldmine
       (idledorf.js: BKMP_IDLE_PRODUCTION_BUILDINGS) hat baseRate:400
       Gold/Std. (~0,11 Gold/Sek.) - das Teststand-B-Fixture setzt
       goldmine_collected_at beim Server-Start auf "jetzt", die reale Zeit
       zwischen Fixture-Erzeugung und diesem Reload (Login+Kampf-Wartezeit+
       mehrere Klicks+Reset+Reload+erneutes Laden) reicht dafuer haeufig
       genug aus, um automatisch 1 (manchmal mehr) Gold Grundproduktion zu
       erzeugen - voellig unabhaengig vom eigentlichen Prestige-Reset,
       nachweislich verstaerkt bei jeder Verlangsamung des Testablaufs
       (System-Last, langsameres CI). Das ist kein Bug, sondern exakt das
       dokumentierte Design ("kein Totalstillstand") - die urspruengliche
       Annahme dieses Tests ("gold bleibt exakt 0") war zu strikt. Die
       Assertion prueft jetzt stattdessen das eigentlich relevante
       Verhalten: der Reset darf NIE den alten, hohen Vor-Reset-Wert
       (50000 im Teststand-B-Fixture) ueberleben lassen, toleriert aber
       die kleine, dokumentierte Grundproduktion (grosszuegige Grenze fuer
       auch sehr langsame Umgebungen, weit unter dem alten Wert). */
    const state = await page.evaluate(() => ({ level: bkmpIdleState.level, gold: bkmpIdleState.gold, prestigeLevel: bkmpPrestigeState.prestige_level }));
    expect(state.level).toBe(1);
    expect(state.gold).toBeGreaterThanOrEqual(0);
    expect(state.gold).toBeLessThan(50);
    expect(state.prestigeLevel).toBe(1);
  });
});
