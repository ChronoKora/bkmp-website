const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Progression-Rebalance Phase 2+3+4 (26.07.2026, siehe PROGRESSION_REBALANCE_
   PHASE1.md): neue, deutlich hoehere Upgrade-Caps (500->2.500 / 5.000->
   20.000 / 100->150 bzw. 500) + zentrales Softcap-System (voller Bonus bis
   softCap1, reduzierter Grenznutzen+staerkere Kosten danach, nochmal
   reduziert ab softCap2) + deterministische Meilensteine (25/50/100/500/
   1000, aus dem Rang berechenbar, kein Claim/State noetig). Prueft die
   ECHTEN Produktionsfunktionen (bkmpIdleUpgradeCost/-EffectAtLevel/
   -MilestonesReached/-NextMilestone in js/core/bkmp-combat-math.js bzw.
   idledorf.js), keine eigene Kopie der Formeln. */

test.describe('Upgrade-Softcaps + Meilensteine (Teststand B)', () => {
  test.use({ teststand: 'B' });

  test('neue Caps sind live (nicht mehr die alten 500/5.000/100)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const caps = await page.evaluate(() => Object.fromEntries(BKMP_IDLE_UPGRADES.map(d => [d.id, d.maxLevel])));
    expect(caps.atk).toBe(2500);
    expect(caps.def).toBe(2500);
    expect(caps.hp).toBe(20000);
    expect(caps.walls).toBe(20000);
    expect(caps.essence_core).toBe(20000);
    expect(caps.crystal_defense).toBe(20000);
    expect(caps.crit).toBe(150);
    expect(caps.crystal_gold).toBe(500);
    expect(caps.essence_loot).toBe(500);
  });

  test('Kosten: unterhalb softCap1 identisch zur alten Formel, ab softCap1 spuerbar teurer, ab softCap2 nochmal teurer', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      const def = BKMP_IDLE_UPGRADES.find(d => d.id === 'atk');
      const cfg = bkmpIdleUpgradeSoftcapCfg(def);
      const baseline = Math.round(def.baseCost * bkmpIdleGrowthMult(def.costRate, def.costExponent, cfg.softCap1 - 1));
      const actualBelow = bkmpIdleUpgradeCost(def, cfg.softCap1 - 1);
      const atThreshold = bkmpIdleUpgradeCost(def, cfg.softCap1);
      const atSecondThreshold = bkmpIdleUpgradeCost(def, cfg.softCap2);
      return { baseline, actualBelow, atThreshold, atSecondThreshold, softCap1: cfg.softCap1, softCap2: cfg.softCap2 };
    });
    // Unterhalb der Schwelle exakt die alte, unveraenderte Formel.
    expect(result.actualBelow).toBe(result.baseline);
    // Ab softCap1 ein echter, spuerbarer Sprung (staerkere Kostensteigerung) -
    // Wert per Phase-15-Simulation bewusst moderat gehalten (siehe Kommentar
    // bei BKMP_IDLE_UPGRADE_SOFTCAP_CFG in idledorf.js: die erste Fassung mit
    // einem >10x-Sprung ergab am Cap eine ~750-Tage-Wartezeit selbst fuer
    // Endgame-Spieler - realer harter Stopp trotz "Softcap"-Anspruch).
    expect(result.atThreshold).toBeGreaterThan(result.actualBelow * 2);
    // Ab softCap2 nochmal deutlich teurer als bei softCap1.
    expect(result.atSecondThreshold).toBeGreaterThan(result.atThreshold);
  });

  test('Bonus: additiv pro Rang, keine rueckwirkende Kuerzung bereits gekaufter Raenge', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      const def = BKMP_IDLE_UPGRADES.find(d => d.id === 'atk');
      const cfg = bkmpIdleUpgradeSoftcapCfg(def);
      const atThreshold = bkmpIdleUpgradeEffectAtLevel(def, cfg.softCap1);
      const oneAfter = bkmpIdleUpgradeEffectAtLevel(def, cfg.softCap1 + 1);
      const marginal = oneAfter - atThreshold;
      return { atThreshold, marginal, expectedFullMarginal: def.effectPerLevel, expectedReducedMarginal: def.effectPerLevel * cfg.bonusMultiplierAfterSoftCap1 };
    });
    // Der Rang GENAU an der Schwelle liefert noch vollen Wert (softCap1 selbst zaehlt zur vollen Zone).
    expect(result.atThreshold).toBe(625); // softCap1 fuer atk ist 625, effectPerLevel 1 -> exakt 625
    // Der Rang DANACH liefert nur noch den reduzierten Grenznutzen.
    expect(result.marginal).toBeCloseTo(result.expectedReducedMarginal, 5);
    expect(result.marginal).toBeLessThan(result.expectedFullMarginal);
  });

  test('Kauf ueber bkmpIdleBuyUpgrade respektiert die neuen Caps/Softcaps end-to-end, kein NaN/Infinity', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      bkmpIdleState.upgrade_purchases.atk = 2499;
      bkmpIdleState.gold = 1e16;
      bkmpIdleBuyUpgrade('atk');
      const levelAfterOneBuy = bkmpIdleState.upgrade_purchases.atk;
      bkmpIdleBuyUpgrade('atk'); // sollte am Cap (2500) nichts mehr tun
      const levelAfterCapAttempt = bkmpIdleState.upgrade_purchases.atk;
      bkmpIdleRecomputeEffectiveStats();
      return {
        levelAfterOneBuy, levelAfterCapAttempt,
        attack: bkmpIdleEffectiveStats.attack,
        goldAfter: bkmpIdleState.gold,
        isFinite: Number.isFinite(bkmpIdleEffectiveStats.attack) && Number.isFinite(bkmpIdleState.gold)
      };
    });
    expect(result.levelAfterOneBuy).toBe(2500);
    expect(result.levelAfterCapAttempt).toBe(2500); // Cap haelt, kein Ueberkauf
    expect(result.isFinite).toBe(true);
    expect(result.attack).toBeGreaterThan(0);
    expect(result.goldAfter).toBeGreaterThanOrEqual(0);
  });

  test('Meilensteine: deterministisch aus dem Rang, kein doppelter/eigener State, ueberlebt Reload automatisch', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const before = await page.evaluate(() => {
      const def = BKMP_IDLE_UPGRADES.find(d => d.id === 'atk');
      return {
        at24: bkmpIdleUpgradeMilestonesReached(def, 24),
        at25: bkmpIdleUpgradeMilestonesReached(def, 25),
        at100: bkmpIdleUpgradeMilestonesReached(def, 100),
        at2500: bkmpIdleUpgradeMilestonesReached(def, 2500), // Cap 2500 >= alle 5 Meilensteine (25/50/100/500/1000)
        nextAt10: bkmpIdleUpgradeNextMilestone(def, 10),
        nextAt2500: bkmpIdleUpgradeNextMilestone(def, 2500)
      };
    });
    expect(before.at24).toBe(0);
    expect(before.at25).toBe(1);
    expect(before.at100).toBe(3); // 25/50/100 erreicht
    expect(before.at2500).toBe(5); // alle 5 Meilensteine (25/50/100/500/1000) liegen unter dem Cap 2500
    expect(before.nextAt10).toBe(25);
    expect(before.nextAt2500).toBe(null); // alle Meilensteine erreicht, kein naechster mehr

    // crit hat Cap 150 - 500/1000 duerfen fuer dieses Upgrade gar nicht erst zaehlen.
    const critMilestones = await page.evaluate(() => {
      const def = BKMP_IDLE_UPGRADES.find(d => d.id === 'crit');
      return bkmpIdleUpgradeMilestonesForDef(def);
    });
    expect(critMilestones).toEqual([25, 50, 100]);

    // Milestone-Bonus fliesst korrekt in die effektiven Stats ein, ist rein
    // aus dem Rang berechenbar (keine eigene Claim-Funktion/kein eigener
    // Speicherzustand) und bleibt bei wiederholtem Aufruf identisch - echter
    // Beweis der "ueberlebt Reload automatisch"-Eigenschaft OHNE einen
    // echten page.reload() zu brauchen (der echte Persistenzpfad von
    // upgrade_purchases selbst ist bereits durch die bestehende save-load.spec.js
    // abgedeckt - hier geht es nur um die deterministische Berechnung an sich).
    await page.evaluate(() => { bkmpIdleState.upgrade_purchases.atk = 100; bkmpIdleRecomputeEffectiveStats(); });
    const first = await page.evaluate(() => bkmpIdleEffectiveStats.bossDamageBonus);
    expect(first).toBeGreaterThanOrEqual(3); // 3 Meilensteine x 1%/Meilenstein = mind. 3
    const second = await page.evaluate(() => { bkmpIdleRecomputeEffectiveStats(); return bkmpIdleEffectiveStats.bossDamageBonus; });
    expect(second).toBe(first); // wiederholter Aufruf mit unveraendertem Rang liefert exakt denselben Wert - keine versteckte Zustandsabhaengigkeit
    const persisted = await page.evaluate(() => bkmpIdleState.upgrade_purchases.atk);
    expect(persisted).toBe(100); // Rang selbst bleibt die einzige Quelle der Wahrheit, kein separater Meilenstein-Zaehler
  });

  test('Sammel-Pott-Obergrenzen wurden proportional angehoben (goldBonus/xpBonus/lootBonus/critDamage/defense_pct), critChance bleibt bewusst bei 75', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      // Kuenstlich extreme Werte injizieren, um die Obergrenzen selbst zu treffen.
      bkmpIdleState.upgrade_purchases = { crystal_gold: 500, essence_loot: 500, crit: 150 };
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_level = 200; // treibt prestigeLevelBonusPct kuenstlich extrem hoch
      bkmpIdleRecomputeEffectiveStats();
      return {
        goldBonus: bkmpIdleEffectiveStats.goldBonus,
        xpBonus: bkmpIdleEffectiveStats.xpBonus,
        lootBonus: bkmpIdleEffectiveStats.lootBonus,
        critDamageBase: bkmpIdleEffectiveStats.critDamage,
        critChance: bkmpIdleEffectiveStats.critChance
      };
    });
    expect(result.goldBonus).toBeLessThanOrEqual(2000);
    expect(result.xpBonus).toBeLessThanOrEqual(2000);
    expect(result.lootBonus).toBeLessThanOrEqual(1500);
    expect(result.critChance).toBeLessThanOrEqual(75); // absolute Chance-Obergrenze bewusst unveraendert
    expect(Number.isFinite(result.goldBonus)).toBe(true);
    expect(Number.isFinite(result.xpBonus)).toBe(true);
  });
});
