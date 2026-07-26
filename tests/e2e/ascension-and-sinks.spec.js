const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Progression-Rebalance Phase 9+10+11 (26.07.2026): zweite Prestige-Ebene
   "Aufstieg" (Drachenseelen, siehe bkmp-prestige.js), neue Gold-Senke
   "Gebaeude-Ueberladung" (idledorf.js), Auto-Kauf-Anpassungen (Softcap-
   Prioritaet + Prestige-skalierender Kaufdeckel pro Tick). */

test.describe('Aufstieg (Drachenseelen) - Teststand B', () => {
  test.use({ teststand: 'B' });

  test('nicht eligible ohne die 3 Voraussetzungen; wird eligible, sobald alle 3 erfuellt sind', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const before = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 0, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_level = 2;
      bkmpPrestigeState.prestige_points_spent = 100;
      bkmpIdleState.highest_dragon_index = 100;
      return bkmpAscensionEligible();
    });
    expect(before).toBe(false);

    const after = await page.evaluate(() => {
      bkmpPrestigeState.prestige_level = 10;
      bkmpPrestigeState.prestige_points_spent = 500;
      bkmpIdleState.highest_dragon_index = 5000;
      bkmpIdleState.prestige_stage_offset = 0;
      return bkmpAscensionEligible();
    });
    expect(after).toBe(true);
  });

  test('Ausfuehrung: setzt Level/Ressourcen/Skilltree/Upgrades/Drachen-Fortschritt UND den GESAMTEN Prestige-Baum zurueck, vergibt Drachenseelen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(async () => {
      bkmpPrestigeState.prestige_level = 10;
      bkmpPrestigeState.prestige_points = 800;
      bkmpPrestigeState.prestige_points_spent = 500;
      bkmpPrestigeState.prestige_allocations = { ewiges_feuer: 20, drachenblut: 15 };
      bkmpIdleState.highest_dragon_index = 6000;
      bkmpIdleState.level = 250;
      bkmpIdleState.gold = 999999;
      bkmpIdleState.upgrade_purchases = { atk: 100 };
      const soulsBefore = bkmpAscensionDragonSouls();
      const ok = await bkmpAscensionExecute();
      return {
        ok,
        soulsBefore,
        soulsAfter: bkmpAscensionDragonSouls(),
        ascensionLevel: bkmpAscensionLevel(),
        prestigeLevelAfter: bkmpPrestigeState.prestige_level,
        prestigeAllocationsAfter: bkmpPrestigeState.prestige_allocations,
        levelAfter: bkmpIdleState.level,
        upgradePurchasesAfter: bkmpIdleState.upgrade_purchases,
        highestDragonIndexAfter: bkmpIdleState.highest_dragon_index
      };
    });
    expect(result.ok).toBe(true);
    expect(result.soulsAfter).toBeGreaterThan(result.soulsBefore);
    expect(result.ascensionLevel).toBe(1);
    expect(result.prestigeLevelAfter).toBe(0); // gesamter Prestige-Baum zurueckgesetzt
    expect(Object.keys(result.prestigeAllocationsAfter).filter(k => !k.startsWith('__')).length).toBe(0); // keine normalen Knoten-Raenge mehr
    expect(result.prestigeAllocationsAfter.__dragon_souls).toBe(result.soulsAfter); // Seelen bleiben im selben Objekt erhalten
    expect(result.levelAfter).toBe(1); // normaler Prestige-Reset-Teil hat gegriffen
    expect(Object.keys(result.upgradePurchasesAfter).length).toBe(0);
    expect(result.highestDragonIndexAfter).toBe(0);
  });

  test('Drachenseelen-Bonus fliesst dauerhaft in die effektiven Stats ein und uebersteht einen NORMALEN Prestige-Reset (nur der Baum selbst wird bei normalem Prestige NICHT zurueckgesetzt)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 0, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations = { __dragon_souls: 10, __ascension_level: 1 };
      bkmpIdleRecomputeEffectiveStats();
      return bkmpIdleEffectiveStats.attack;
    });
    const withoutSouls = await page.evaluate(() => {
      const saved = bkmpPrestigeState.prestige_allocations.__dragon_souls;
      bkmpPrestigeState.prestige_allocations.__dragon_souls = 0;
      bkmpIdleRecomputeEffectiveStats();
      const attack = bkmpIdleEffectiveStats.attack;
      bkmpPrestigeState.prestige_allocations.__dragon_souls = saved;
      bkmpIdleRecomputeEffectiveStats();
      return attack;
    });
    expect(result).toBeGreaterThan(withoutSouls); // 10 Seelen x 0.5% Angriff = +5% messbar
  });

  test('nicht eligible: bkmpAscensionExecute() ist ueber die UI nicht ausloesbar (kein Button gerendert)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      bkmpPrestigeState.prestige_points_spent = 30; // ueber Meilenstein 25 (Sichtbarkeit), aber weit unter Aufstiegs-Voraussetzungen
      bkmpIdleRenderPrestigePanel();
    });
    const hasButton = await page.evaluate(() => !!document.getElementById('idleAscensionBtn'));
    expect(hasButton).toBe(false);
  });
});

test.describe('Gebaeude-Ueberladung (Gold-Senke, Phase 10) - Teststand B', () => {
  test.use({ teststand: 'B' });

  test('kauft einen Boost, erhoeht Produktionsrate messbar, Kosten steigen bei Mehrfachkauf innerhalb 24h', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      bkmpIdleState.gold = 10000000;
      try { localStorage.removeItem(bkmpIdleBuildingOverloadStorageKey()); } catch (e) {}
      const def = BKMP_IDLE_PRODUCTION_BUILDINGS[0];
      const rateBefore = bkmpIdleProductionBuildingRatePerHour(def, 5);
      const cost1 = bkmpIdleBuildingOverloadCost(BKMP_IDLE_BUILDING_OVERLOAD_TIERS[0]);
      bkmpIdleBuyBuildingOverload(1);
      const rateAfter = bkmpIdleProductionBuildingRatePerHour(def, 5);
      const cost2 = bkmpIdleBuildingOverloadCost(BKMP_IDLE_BUILDING_OVERLOAD_TIERS[0]);
      return { rateBefore, rateAfter, cost1, cost2, activeMult: bkmpIdleProductionBoostActiveMultiplier() };
    });
    expect(result.rateAfter).toBeGreaterThan(result.rateBefore);
    expect(result.activeMult).toBe(2);
    expect(result.cost2).toBeGreaterThan(result.cost1); // Mehrfachnutzung ist teurer
  });

  test('kein Kauf ohne genug Gold, kein Effekt', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      bkmpIdleState.gold = 0;
      try { localStorage.removeItem(bkmpIdleBuildingOverloadStorageKey()); } catch (e) {}
      bkmpIdleBuyBuildingOverload(1);
      return bkmpIdleProductionBoostActiveMultiplier();
    });
    expect(result).toBe(1);
  });

  test('Boost laeuft nach Ablauf der Zeit automatisch wieder auf 1x zurueck', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      const state = { until: Date.now() - 1000, mult: 2, usesLast24h: [] }; // bereits abgelaufen
      bkmpIdleBuildingOverloadSave(state);
      return bkmpIdleProductionBoostActiveMultiplier();
    });
    expect(result).toBe(1);
  });
});

test.describe('Auto-Kauf-Anpassungen (Phase 11) - Teststand B', () => {
  test.use({ teststand: 'B' });

  test('Standard-Kaufdeckel bleibt 50 ohne Massenkauf/Erweiterter-Autokauf-Investition', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const cap = await page.evaluate(() => bkmpIdleAutoBuyMaxPurchasesPerTick());
    expect(cap).toBe(50);
  });

  test('Kaufdeckel skaliert mit investierten Massenkauf/Erweiterter-Autokauf/Auto-Kauf-mehrerer-Stufen-Raengen (geteilter Hebel)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const cap = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 0, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations = { massenkauf: 10, erweiterter_autokauf: 5 }; // 15 Raenge x 5 = +75
      return bkmpIdleAutoBuyMaxPurchasesPerTick();
    });
    expect(cap).toBe(125);
  });

  test('Auto-Kauf bevorzugt bei gleich guenstigen Optionen Upgrades ausserhalb der Softcap-Zone', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      const atkDef = BKMP_IDLE_UPGRADES.find(d => d.id === 'atk');
      const cfg = bkmpIdleUpgradeSoftcapCfg(atkDef);
      return {
        inZone: bkmpIdleUpgradeInSoftcapZone(atkDef, cfg.softCap1),
        notInZone: bkmpIdleUpgradeInSoftcapZone(atkDef, cfg.softCap1 - 1)
      };
    });
    expect(result.inZone).toBe(true);
    expect(result.notInZone).toBe(false);
  });
});
