const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Fortsetzung von prestige-automation-toggles.spec.js (26.07., deckte nur
   Automatischer Bosskampf/Automatische Runenaufwertung ab) - Nutzerwunsch
   27.07.2026: "Ich will das du alle Skills testest. Auf ihre
   Funktionalitaet. Weil habe das Gefuehl das einige nicht funktionieren."
   Deckt die restlichen 6 der 10 Automations-Zweig-Knoten ab (Schluessel-
   meister/Schluesselbund siehe eigene Datei dungeon-key-prestige-bonus.spec.js
   - dort war der erste echte Fund; Automatische Ei-Ausbruetung siehe
   dragon-breeding-automation.spec.js). Testet den echten Produktionscode,
   keine Kopien. */

test.describe('Automatisierungs-Schalter Teil 2 (Erweiterter Auto-Kauf/Auto-Kauf mehrerer Stufen) - Teststand A', () => {
  test.use({ teststand: 'A' });

  test('Erweiterter Auto-Kauf + Auto-Kauf mehrerer Stufen erhoehen das Kaeufe-pro-Tick-Limit korrekt (Basis 50, je +5/Rang)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const base = await page.evaluate(() => bkmpIdleAutoBuyMaxPurchasesPerTick());
    expect(base).toBe(50);

    const boosted = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.erweiterter_autokauf = 50; // max. Rang, +5/Rang = +250
      bkmpPrestigeState.prestige_allocations.autokauf_mehrstufig = 50; // derselbe Hebel, weitere +250
      return bkmpIdleAutoBuyMaxPurchasesPerTick();
    });
    expect(boosted).toBe(50 + 250 + 250); // 550

    // Ende-zu-Ende: bkmpIdleAutoBuyUpgrades() muss dieses Limit tatsaechlich
    // als Schleifen-Obergrenze respektieren, nicht nur die Zahl selbst stimmen.
    const purchases = await page.evaluate(() => {
      bkmpIdleState.gold = 1e18; bkmpIdleState.wood = 1e18; bkmpIdleState.stone = 1e18;
      bkmpIdleState.mana = 1e18; bkmpIdleState.essence = 1e18;
      bkmpIdleState.upgrade_purchases = {};
      const before = Object.values(bkmpIdleState.upgrade_purchases).reduce((a, b) => a + b, 0);
      bkmpIdleAutoBuyUpgrades();
      const after = Object.values(bkmpIdleState.upgrade_purchases).reduce((a, b) => a + b, 0);
      return after - before;
    });
    expect(purchases).toBe(550);
  });

  test('Ohne die beiden Knoten bleibt Auto-Kauf bei genau 50 Kaeufen pro Aufruf', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const purchases = await page.evaluate(() => {
      bkmpIdleState.gold = 1e18; bkmpIdleState.wood = 1e18; bkmpIdleState.stone = 1e18;
      bkmpIdleState.mana = 1e18; bkmpIdleState.essence = 1e18;
      bkmpIdleState.upgrade_purchases = {};
      const before = Object.values(bkmpIdleState.upgrade_purchases).reduce((a, b) => a + b, 0);
      bkmpIdleAutoBuyUpgrades();
      const after = Object.values(bkmpIdleState.upgrade_purchases).reduce((a, b) => a + b, 0);
      return after - before;
    });
    expect(purchases).toBe(50);
  });
});

test.describe('Automatisierungs-Schalter Teil 2 (Automatische Dungeon-Wiederholung) - Teststand A', () => {
  test.use({ teststand: 'A' });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - mobile-smoke.spec.js deckt die kompakte Navigation ab');
  });

  test('macht den normalen "Starten"-Knopf direkt zu einem unbegrenzten Auto-Lauf', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_dungeon_wiederholung = 1;
    });
    await page.locator('#idleTabBtnDungeon').click();
    await page.evaluate(() => bkmpDungeonRefreshStatus());
    await page.evaluate(() => bkmpIdleRenderDungeonPanel());

    await page.locator('.idle-dungeon-card[data-dungeon-type="gold"] .idle-dungeon-start-btn').click();
    await expect.poll(() => page.evaluate(() => bkmpDungeonAutoActive())).toBe(true);
    const total = await page.evaluate(() => bkmpDungeonAutoRunsTotal);
    expect(total).toBe(Infinity);
  });

  test('ohne den Knoten bleibt "Starten" ein einzelner, nicht-automatischer Lauf', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDungeon').click();
    await page.evaluate(() => bkmpDungeonRefreshStatus());
    await page.evaluate(() => bkmpIdleRenderDungeonPanel());

    await page.locator('.idle-dungeon-card[data-dungeon-type="gold"] .idle-dungeon-start-btn').click();
    await page.waitForTimeout(300);
    const autoActive = await page.evaluate(() => bkmpDungeonAutoActive());
    expect(autoActive).toBe(false);
  });
});

test.describe('Automatisierungs-Schalter Teil 2 (Gespeicherte Ausruestungssets) - Teststand C', () => {
  test.use({ teststand: 'C' });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - mobile-smoke.spec.js deckt die kompakte Navigation ab');
  });

  test('schaltet Set-speichern/-laden Buttons frei und stellt die exakte vorherige Ausruestung wieder her', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.gespeicherte_ausruestungssets = 1;
    });
    await page.locator('#idleTabBtnRunen').click();
    await page.evaluate(() => bkmpIdleRenderRunenPanel());
    await expect(page.locator('#idleRuneSaveLoadoutBtn')).toBeVisible();

    const before = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.equipped).map(r => r.id).sort());
    expect(before.length).toBeGreaterThan(0);

    await page.evaluate(() => bkmpRuneSaveLoadout());
    // Alles abruesten, dann wiederherstellen.
    await page.evaluate(() => {
      bkmpIdlePlayerRunes.filter(r => r.equipped).forEach(r => bkmpRuneToggleEquip(r._cid));
    });
    const afterUnequip = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.equipped).length);
    expect(afterUnequip).toBe(0);

    await page.evaluate(() => bkmpRuneRestoreLoadout());
    const restored = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.equipped).map(r => r.id).sort());
    expect(restored).toEqual(before);
  });

  test('ohne den Knoten sind die Set-Buttons nicht sichtbar', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.evaluate(() => bkmpIdleRenderRunenPanel());
    await expect(page.locator('#idleRuneSaveLoadoutBtn')).toHaveCount(0);
  });
});

test.describe('Automatisierungs-Schalter Teil 2 (Hoehere Kampfgeschwindigkeit) - Teststand A', () => {
  test.use({ teststand: 'A' });

  test('verkuerzt den echten Tick-Takt gemaess Formel 900ms/(1+Bonus%/100)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const base = await page.evaluate(() => bkmpIdleEffectiveStats.tickIntervalMs);
    expect(base).toBe(900);

    const boosted = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.hoehere_kampfgeschwindigkeit = 10; // 10*3%=30%
      bkmpIdleRecomputeEffectiveStats();
      return bkmpIdleEffectiveStats.tickIntervalMs;
    });
    expect(boosted).toBe(Math.max(400, Math.round(900 / 1.3))); // 692
  });
});

test.describe('Automatisierungs-Schalter Teil 2 (Automatische Prestige-Vorschau) - Teststand A', () => {
  test.use({ teststand: 'A' });
  test.beforeEach(async ({}, testInfo) => {
    // Prueft die Sichtbarkeit von #idleTabBtnPrestige selbst (Nav-Tab-Button) -
    // unter kompakter Mobil-Navigation kein normaler Desktop-Button.
    test.skip(/^mobile-/.test(testInfo.project.name), 'Prueft einen Desktop-Nav-Tab-Button direkt - mobile-smoke.spec.js deckt die kompakte Navigation ab');
  });

  test('zeigt ein "!"-Abzeichen am Prestige-Tab, sobald ein Aufstieg moeglich wird', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_prestige_vorschau = 1;
      bkmpIdleState.highest_dragon_index = 150; // ueber der Mindeststufe 100 fuer prestige_level 0
      bkmpPrestigeUpdateTabBadge();
    });
    await expect(page.locator('#idleTabBtnPrestige .idle-prestige-tab-badge')).toBeVisible();
  });

  test('ohne den Knoten bleibt das Abzeichen aus, auch wenn ein Aufstieg moeglich waere', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      bkmpIdleState.highest_dragon_index = 150;
      bkmpPrestigeUpdateTabBadge();
    });
    await expect(page.locator('#idleTabBtnPrestige .idle-prestige-tab-badge')).toHaveCount(0);
  });
});

test.describe('Automatisierungs-Schalter Teil 2 (Automatische Verteilung) - Teststand A', () => {
  test.use({ teststand: 'A' });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - mobile-smoke.spec.js deckt die kompakte Navigation ab');
  });

  test('schaltet den "Empfohlene Verteilung"-Knopf frei, Klick verteilt verfuegbare Punkte tatsaechlich', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_verteilung = 1;
      bkmpPrestigeState.prestige_points = 5000;
      bkmpPrestigeState.prestige_points_spent = 0;
    });
    await page.locator('#idleTabBtnPrestige').click();
    await page.evaluate(() => bkmpIdleRenderPrestigePanel());
    await expect(page.locator('#idlePrestigeAutoAllocateBtn')).toBeVisible();

    const spentBefore = await page.evaluate(() => bkmpPrestigeState.prestige_points_spent);
    await page.locator('#idlePrestigeAutoAllocateBtn').click();
    const spentAfter = await page.evaluate(() => bkmpPrestigeState.prestige_points_spent);
    expect(spentAfter).toBeGreaterThan(spentBefore);
    expect(spentAfter).toBeLessThanOrEqual(5000);
  });

  test('ohne den Knoten ist der Knopf nicht sichtbar', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 5000, prestige_points_spent: 0, prestige_allocations: {} };
    });
    await page.locator('#idleTabBtnPrestige').click();
    await page.evaluate(() => bkmpIdleRenderPrestigePanel());
    await expect(page.locator('#idlePrestigeAutoAllocateBtn')).toHaveCount(0);
  });
});
