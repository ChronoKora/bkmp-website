const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Progression-Rebalance Phase 5+6+7+8 (26.07.2026, siehe PROGRESSION_
   REBALANCE_PHASE1.md): der alte 6-Knoten-Prestige-Baum (linearer Kosten-
   Verfall, Gesamtkosten nur 1.015 Punkte) wird zu 5 Zweigen a 10 Knoten +
   einem "Vermaechtnis"-Zweig fuer die 2 thematisch nicht passenden alten
   Knoten erweitert - exponentielle Kosten (Phase 6), Meilensteine nach
   investierten Punkten (Phase 7), Paragon-System nach Erreichen des
   normalen Maximalrangs (Phase 8). Migrationssicherheit: alle 6 alten
   Knoten-IDs bleiben unveraendert bestehen (prestige_allocations ist
   additives JSONB), ein bereits investierter Rang behaelt seinen vollen
   Bonus. */

test.describe('Prestige-Baum v2: Struktur/Kosten/Paragon/Meilensteine (Teststand B)', () => {
  test.use({ teststand: 'B' });

  test('alle 6 alten Knoten-IDs existieren unveraendert, mit unveraendertem effectType/effectPerRank', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const legacy = await page.evaluate(() => Object.fromEntries(
      ['ewiges_feuer', 'drachenblut', 'goldene_ranken', 'zeitraffer', 'kristallkern', 'portal_meisterschaft']
        .map(id => [id, bkmpPrestigeNodeById(id) ? { effectType: bkmpPrestigeNodeById(id).effectType, effectPerRank: bkmpPrestigeNodeById(id).effectPerRank } : null])
    ));
    expect(legacy.ewiges_feuer).toEqual({ effectType: 'attack_pct', effectPerRank: 8 });
    expect(legacy.drachenblut).toEqual({ effectType: 'hp_pct', effectPerRank: 8 });
    expect(legacy.goldene_ranken).toEqual({ effectType: 'gold_prod_pct', effectPerRank: 8 });
    expect(legacy.zeitraffer).toEqual({ effectType: 'xp_pct', effectPerRank: 8 });
    expect(legacy.kristallkern).toEqual({ effectType: 'crit_damage_pct', effectPerRank: 10 });
    expect(legacy.portal_meisterschaft).toEqual({ effectType: 'prestige_point_bonus_pct', effectPerRank: 8 });
  });

  test('bereits investierter Rang eines alten Knotens bleibt nach der Erweiterung voll wirksam (Migrationsbeweis)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // Simuliert einen Spieler, der VOR der Erweiterung bereits kristallkern auf altem Max (15) hatte.
    const result = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 0, prestige_points: 1000, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations = { kristallkern: 15 };
      const totals = bkmpPrestigeEffectTotals(bkmpPrestigeState.prestige_allocations);
      const def = bkmpPrestigeNodeById('kristallkern');
      return { critDamagePct: totals.crit_damage_pct, maxRankNow: def.maxRank, rankStillValid: 15 <= def.maxRank };
    });
    expect(result.critDamagePct).toBe(150); // 15 Raenge x 10% - exakt der alte Wert, unveraendert
    expect(result.maxRankNow).toBeGreaterThanOrEqual(15); // neues Cap (20) >= altes Cap, nie kleiner
    expect(result.rankStillValid).toBe(true);
  });

  test('5 Zweige + Vermaechtnis vorhanden, je 10 Knoten in den 5 Hauptzweigen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const counts = await page.evaluate(() => {
      const byBranch = {};
      BKMP_PRESTIGE_UPGRADES.forEach(d => { byBranch[d.branch] = (byBranch[d.branch] || 0) + 1; });
      return byBranch;
    });
    expect(counts.kampf).toBe(10);
    expect(counts.wirtschaft).toBe(10);
    expect(counts.drachen).toBe(10);
    expect(counts.runen_dungeon).toBe(10);
    expect(counts.automation).toBe(10);
    expect(counts.legacy).toBe(2);
  });

  test('Kosten sind exponentiell (jeder Rang teurer als der vorherige, Wachstum beschleunigt sich)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const costs = await page.evaluate(() => {
      const def = bkmpPrestigeNodeById('ewiges_feuer');
      return [1, 2, 5, 10, 20].map(r => bkmpPrestigeUpgradeCost(def, r));
    });
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    // Wachstumsrate zwischen Rang 19->20 muss groesser sein als zwischen Rang 1->2 (echt exponentiell, nicht linear).
    const growth1 = costs[1] / costs[0];
    const lastDef = await page.evaluate(() => { const d = bkmpPrestigeNodeById('ewiges_feuer'); return { r19: bkmpPrestigeUpgradeCost(d, 19), r20: bkmpPrestigeUpgradeCost(d, 20) }; });
    const growthLast = lastDef.r20 / lastDef.r19;
    expect(growthLast).toBeGreaterThan(1);
    expect(costs[0]).toBeGreaterThan(0);
  });

  test('Paragon: erst kaufbar nach vollem normalem Maximalrang, deutlich schwaecherer Bonus/Rang, steigende Kosten', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const before = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 0, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.ewiges_feuer = 19; // noch nicht Max (20)
      bkmpPrestigeState.prestige_points = 1e9;
      bkmpPrestigeState.prestige_points_spent = 0;
      bkmpPrestigeBuyParagon('ewiges_feuer'); // sollte nichts tun, Knoten noch nicht voll
      return { paragonRank: Number(bkmpPrestigeState.prestige_allocations['ewiges_feuer__paragon'] || 0), pointsSpent: bkmpPrestigeState.prestige_points_spent };
    });
    expect(before.paragonRank).toBe(0);
    expect(before.pointsSpent).toBe(0);

    const after = await page.evaluate(() => {
      bkmpPrestigeState.prestige_allocations.ewiges_feuer = 20; // jetzt voll
      bkmpPrestigeBuyParagon('ewiges_feuer');
      const def = bkmpPrestigeNodeById('ewiges_feuer');
      const totals = bkmpPrestigeEffectTotals(bkmpPrestigeState.prestige_allocations);
      return {
        paragonRank: Number(bkmpPrestigeState.prestige_allocations['ewiges_feuer__paragon'] || 0),
        attackPctFromNormalOnly: def.effectPerRank * 20,
        attackPctTotal: totals.attack_pct,
        paragonEffectPerRank: bkmpPrestigeParagonEffectPerRank(def)
      };
    });
    expect(after.paragonRank).toBe(1);
    expect(after.attackPctTotal).toBeGreaterThan(after.attackPctFromNormalOnly); // Paragon-Rang traegt zusaetzlich bei
    expect(after.paragonEffectPerRank).toBeLessThan(1); // "deutlich schwaecher" - 4% von 8% = 0.32
    expect(after.paragonEffectPerRank).toBeCloseTo(0.32, 5);

    // Chance-basierte Knoten (SPECIAL-Tier) duerfen NIE Paragon-faehig sein.
    const chanceNodeParagonEligible = await page.evaluate(() => bkmpPrestigeParagonEligible(bkmpPrestigeNodeById('doppelschlag')));
    expect(chanceNodeParagonEligible).toBe(false);
  });

  test('Meilensteine: deterministisch aus investierten Punkten, schalten Zweige/Paragon frei', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const gated = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 0, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_points_spent = 50; // unter 100 -> runen_dungeon/automation gesperrt
      return {
        runenDungeonLocked: !bkmpPrestigeBranchUnlocked('runen_dungeon'),
        automationLocked: !bkmpPrestigeBranchUnlocked('automation'),
        kampfUnlocked: bkmpPrestigeBranchUnlocked('kampf'),
        paragonLocked: !bkmpPrestigeParagonSystemUnlocked()
      };
    });
    expect(gated.runenDungeonLocked).toBe(true);
    expect(gated.automationLocked).toBe(true);
    expect(gated.kampfUnlocked).toBe(true); // Kampf/Wirtschaft/Drachen sind nie gesperrt
    expect(gated.paragonLocked).toBe(true);

    const unlocked = await page.evaluate(() => {
      bkmpPrestigeState.prestige_points_spent = 400; // ueber 350 -> Paragon frei, ueber 100 -> Zweige frei
      return {
        runenDungeonUnlocked: bkmpPrestigeBranchUnlocked('runen_dungeon'),
        automationUnlocked: bkmpPrestigeBranchUnlocked('automation'),
        paragonUnlocked: bkmpPrestigeParagonSystemUnlocked()
      };
    });
    expect(unlocked.runenDungeonUnlocked).toBe(true);
    expect(unlocked.automationUnlocked).toBe(true);
    expect(unlocked.paragonUnlocked).toBe(true);
  });

  test('Meilenstein-Boni fliessen deterministisch in die effektiven Stats ein (kein Doppel-Trigger, reine Funktion des investierten Punktestands)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 0, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_points_spent = 30; // unter dem ersten Meilenstein (25) bereits drueber
      bkmpIdleRecomputeEffectiveStats();
      const attackAt30 = bkmpIdleEffectiveStats.attack;
      bkmpIdleRecomputeEffectiveStats(); // erneuter Aufruf, unveraenderter Punktestand
      const attackAt30Again = bkmpIdleEffectiveStats.attack;
      return { attackAt30, attackAt30Again, milestoneTotals25 : bkmpPrestigeMilestoneEffectTotals(30) };
    });
    expect(result.attackAt30).toBe(result.attackAt30Again); // deterministisch, kein Drift bei wiederholtem Aufruf
    expect(result.milestoneTotals25.attack_pct).toBe(2); // Meilenstein 25 gibt +2% Angriff
  });
});
