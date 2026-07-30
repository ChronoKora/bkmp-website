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

/* Spieler-Idee Fightmaria (28.07.2026, Feedback-Board): "Auto käufer
   spezialisieren... alles ausser die Sachen mit Gold, weil man gerade auf
   etwas spart" - bkmpIdleAutoBuyUpgrades() ueberspringt jetzt jede Ressource
   in bkmpIdleGetAutoBuyExcludedResources() komplett. Rein lokal
   (localStorage), kein Server-Feld. */
test.describe('Auto-Kauf: Ressourcen-Ausschluss (Spieler-Idee Fightmaria) - Teststand A', () => {
  test.use({ teststand: 'A' });

  test('ausgeschlossene Ressource wird von Auto-Kauf komplett uebersprungen, andere kaufen weiter', async ({ page, qaBaseURL, fixtureData }) => {
    // Dieser erste Test ruft bkmpIdleAutoBuyUpgrades() nur direkt per
    // page.evaluate() auf, keine Desktop-Tab-Klicks - laeuft bewusst auch
    // auf mobile-*-Projekten mit.
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const result = await page.evaluate(() => {
      bkmpIdleState.gold = 1e18; bkmpIdleState.wood = 1e18; bkmpIdleState.stone = 1e18;
      bkmpIdleState.crystals = 1e18; bkmpIdleState.essence = 1e18;
      bkmpIdleState.upgrade_purchases = {};
      bkmpIdleSetAutoBuyResourceExcluded('gold', true);
      bkmpIdleAutoBuyUpgrades();
      const purchases = bkmpIdleState.upgrade_purchases;
      const goldUpgradeIds = BKMP_IDLE_UPGRADES.filter(d => d.resource === 'gold').map(d => d.id);
      const nonGoldUpgradeIds = BKMP_IDLE_UPGRADES.filter(d => d.resource !== 'gold').map(d => d.id);
      return {
        goldPurchased: goldUpgradeIds.reduce((sum, id) => sum + Number(purchases[id] || 0), 0),
        nonGoldPurchased: nonGoldUpgradeIds.reduce((sum, id) => sum + Number(purchases[id] || 0), 0)
      };
    });
    expect(result.goldPurchased).toBe(0); // ausgeschlossen - trotz unbegrenztem Gold kein einziger Kauf
    expect(result.nonGoldPurchased).toBeGreaterThan(0); // andere Ressourcen kaufen unveraendert weiter

    // Ausschluss wieder aufheben - Gold-Upgrades kaufen danach wieder normal.
    const afterReenable = await page.evaluate(() => {
      bkmpIdleSetAutoBuyResourceExcluded('gold', false);
      bkmpIdleAutoBuyUpgrades();
      const purchases = bkmpIdleState.upgrade_purchases;
      return BKMP_IDLE_UPGRADES.filter(d => d.resource === 'gold').reduce((sum, d) => sum + Number(purchases[d.id] || 0), 0);
    });
    expect(afterReenable).toBeGreaterThan(0);
  });

  test('Checkbox im Upgrades-Tab spiegelt und setzt den Ausschluss korrekt', async ({ page, qaBaseURL, fixtureData }, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt einen echten Desktop-Tab-Klick - mobile-smoke.spec.js deckt die kompakte Navigation ab');
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnUpgrades').click();

    const goldChip = page.locator('.idle-autobuy-resource-checkbox[data-resource="gold"]');
    await expect(goldChip).not.toBeChecked();
    await goldChip.check();
    expect(await page.evaluate(() => bkmpIdleGetAutoBuyExcludedResources())).toContain('gold');

    // Ueberlebt ein Neu-Rendern des Panels (liest den gespeicherten Zustand
    // beim Aufbau, nicht nur den einmaligen Klick-Zustand).
    await page.evaluate(() => bkmpIdleRenderUpgradesPanel());
    await expect(page.locator('.idle-autobuy-resource-checkbox[data-resource="gold"]')).toBeChecked();

    await page.locator('.idle-autobuy-resource-checkbox[data-resource="gold"]').uncheck();
    expect(await page.evaluate(() => bkmpIdleGetAutoBuyExcludedResources())).not.toContain('gold');
  });
});

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

  /* Spieler-Idee Kaledoss (28.07.2026, Feedback-Board): "Den Skill Tree in
     Prioritäten/Reihenfolgen Sortieren für einen 'Auto Kauf'" - mit einem
     bewusst KLEINEN Punktebudget (garantiert nicht genug, um einen ganzen
     Zweig leerzukaufen) muss bkmpPrestigeAutoAllocate() ausschliesslich in
     den hoechst-priorisierten Zweig investieren, unabhaengig davon, ob ein
     anderer Zweig global guenstigere Einzelknoten haette - das beweist,
     dass die Prioritaet die reine Kosten-Sortierung tatsaechlich uebersteuert. */
  test('Zweig-Prioritaet steuert, welcher Zweig bei "Automatische Verteilung" bevorzugt bedient wird', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    // Absichtlich ein kleines Budget (20 Punkte, statt der 5000 im
    // Nachbartest oben) - reicht fuer mehrere, aber nicht ALLE Raenge eines
    // Zweigs. bkmpPrestigeAutoAllocate() kauft den hoechst-priorisierten
    // Zweig leer, bis darin nichts mehr bezahlbar ist, BEVOR es zum
    // naechsten wechselt - ein kleiner Rest kann dabei noch in den
    // zweiten Zweig "ueberschwappen" (der hoechst-priorisierte Zweig hat
    // ja nicht unbegrenzt viele guenstige Optionen). Die robuste, vom
    // exakten Kosten-Feintuning unabhaengige Behauptung ist deshalb nicht
    // "0 im anderen Zweig", sondern "deutlich mehr im priorisierten Zweig
    // als im anderen" - und dass sich das Verhaeltnis beim Umdrehen der
    // Prioritaet tatsaechlich umkehrt.
    async function ranksByBranch(branchId) {
      return page.evaluate((bid) => {
        const alloc = bkmpPrestigeState.prestige_allocations || {};
        return BKMP_PRESTIGE_UPGRADES.filter(d => d.branch === bid).reduce((sum, d) => sum + Number(alloc[d.id] || 0), 0);
      }, branchId);
    }
    async function runRound(priorityOrder) {
      await page.evaluate((order) => {
        if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
        bkmpPrestigeState.prestige_allocations = { automatische_verteilung: 1 };
        bkmpPrestigeState.prestige_points = 20;
        bkmpPrestigeState.prestige_points_spent = 0;
        bkmpPrestigeSetAutoAllocatePriority(order);
        bkmpPrestigeAutoAllocate();
      }, priorityOrder);
      return { kampf: await ranksByBranch('kampf'), wirtschaft: await ranksByBranch('wirtschaft') };
    }

    const round1 = await runRound(['wirtschaft', 'kampf', 'drachen', 'runen_dungeon', 'automation', 'legacy']);
    expect(round1.wirtschaft).toBeGreaterThan(round1.kampf);
    expect(round1.wirtschaft).toBeGreaterThan(0);

    const round2 = await runRound(['kampf', 'wirtschaft', 'drachen', 'runen_dungeon', 'automation', 'legacy']);
    expect(round2.kampf).toBeGreaterThan(round2.wirtschaft);
    expect(round2.kampf).toBeGreaterThan(0);
  });

  test('Priorität-Auf/Ab-Knöpfe im Prestige-Panel sortieren die Zweigliste tatsächlich um', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_verteilung = 1;
      bkmpPrestigeSetAutoAllocatePriority(['kampf', 'wirtschaft', 'drachen', 'runen_dungeon', 'automation', 'legacy']);
    });
    await page.locator('#idleTabBtnPrestige').click();
    await page.evaluate(() => bkmpIdleRenderPrestigePanel());

    const namesBefore = await page.locator('.idle-prestige-priority-name').allTextContents();
    expect(namesBefore[0]).toContain('Kampf');

    // "Wirtschaft" (Rang 2) einmal nach oben schieben.
    await page.locator('.idle-prestige-priority-up[data-branch="wirtschaft"]').click();
    const namesAfter = await page.locator('.idle-prestige-priority-name').allTextContents();
    expect(namesAfter[0]).toContain('Wirtschaft');
    expect(namesAfter[1]).toContain('Kampf');
    expect(await page.evaluate(() => bkmpPrestigeGetAutoAllocatePriority())).toEqual(['wirtschaft', 'kampf', 'drachen', 'runen_dungeon', 'automation', 'legacy']);
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
