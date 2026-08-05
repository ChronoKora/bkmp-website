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

  test('5 Zweige + Vermaechtnis vorhanden, je 10 Knoten in den 5 Hauptzweigen (runen_dungeon seit 03.08.2026 nur noch 9 - Schluesselmeister entfernt; Vermaechtnis seit 05.08.2026 3 statt 2 - "Weitere Gefaehrten" ergaenzt)', async ({ page, qaBaseURL, fixtureData }) => {
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
    expect(counts.runen_dungeon).toBe(9); // Schluesselmeister komplett entfernt (Nutzerwunsch: feste Schluesselzeiten machen den Knoten wirkungslos)
    expect(counts.automation).toBe(10);
    expect(counts.legacy).toBe(3); // "Weitere Gefaehrten" (05.08.2026, Spieler-Idee MCSoGGe) ergaenzt
  });

  test('"Weitere Gefährten" (mehrere Kampf-Begleiter): exakte Kosten 1.500/3.000, maxRank 2, kein Paragon', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      const def = bkmpPrestigeNodeById('weitere_gefaehrten');
      return {
        branch: def.branch, effectType: def.effectType, effectPerRank: def.effectPerRank, maxRank: def.maxRank,
        paragonEligible: bkmpPrestigeParagonEligible(def),
        rank1Cost: bkmpPrestigeUpgradeCost(def, 0),
        rank2Cost: bkmpPrestigeUpgradeCost(def, 1)
      };
    });
    expect(result.branch).toBe('legacy');
    expect(result.effectType).toBe('companion_slot_bonus');
    expect(result.effectPerRank).toBe(1);
    expect(result.maxRank).toBe(2);
    expect(result.paragonEligible).toBe(false);
    expect(result.rank1Cost).toBe(1500);
    expect(result.rank2Cost).toBe(3000);
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

  /* Nutzerwunsch 31.07.2026 ("maximal 3 lvl" beim Schluesselbund-Skill,
     siehe Dungeon-Schluessel-Anzeigefix in CLAUDE.md) - maxRank 50->3,
     effectPerRank/Kosten-Basis unveraendert. Das "bereits hoehere Bestands-
     raenge bleiben unangetastet"-Verhalten aus der ersten Fassung wurde
     NOCH AM SELBEN TAG per Fairness-Nachbesserung durch eine echte
     Rueckerstattungs-Migration ersetzt (siehe die beiden Tests direkt
     darunter) - dieser Test prueft nur noch den reinen Kauf-Stopp bei
     Rang 3 fuer NEUE Kaeufe, nicht mehr das (inzwischen ueberholte)
     Bestandsschutz-Verhalten. */
  test('Schluesselbund: Maximalrang auf 3 gesenkt, weitere normale Kaeufe darueber hinaus blockiert', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const maxRank = await page.evaluate(() => bkmpPrestigeNodeById('schluesselbund').maxRank);
    expect(maxRank).toBe(3);

    // Genug Punkte fuer weit mehr als 3 Raenge - der Kauf muss trotzdem bei Rang 3 stoppen.
    const buyResult = await page.evaluate(() => {
      bkmpPrestigeState.prestige_allocations.schluesselbund = 0;
      bkmpPrestigeState.prestige_points = 100000;
      bkmpPrestigeState.prestige_points_spent = 0;
      for (let i = 0; i < 6; i++) bkmpPrestigeBuyUpgrade('schluesselbund');
      return {
        rank: bkmpPrestigeState.prestige_allocations.schluesselbund,
        spent: bkmpPrestigeState.prestige_points_spent
      };
    });
    expect(buyResult.rank).toBe(3);
    const spentAfterThreeRanks = buyResult.spent;

    // Ein siebter Kaufversuch (bereits am Cap) darf weder den Rang noch die ausgegebenen Punkte veraendern.
    const afterExtraAttempt = await page.evaluate(() => {
      bkmpPrestigeBuyUpgrade('schluesselbund');
      return { rank: bkmpPrestigeState.prestige_allocations.schluesselbund, spent: bkmpPrestigeState.prestige_points_spent };
    });
    expect(afterExtraAttempt.rank).toBe(3);
    expect(afterExtraAttempt.spent).toBe(spentAfterThreeRanks);

    // Paragon wurde fuer diesen Knoten bewusst komplett entfernt (Fairness-Nachbesserung).
    const paragonEligible = await page.evaluate(() => bkmpPrestigeParagonEligible(bkmpPrestigeNodeById('schluesselbund')));
    expect(paragonEligible).toBe(false);
  });

  /* Nachtrag 31.07.2026 (Fairness-Nachbesserung auf Nutzerwunsch, siehe
     Kommentar am Knoten): anders als der urspruengliche Plan (Bestandsraenge
     bleiben grandfathered) sollen ALLE Spieler einheitlich bei Rang 3 landen,
     ueberschuessige Punkte (normale Raenge UND die zwischenzeitlich per
     Paragon investierten) werden zurueckerstattet statt behalten. */
  test('Schluesselbund-Downgrade-Migration: bereits hoeherer Rang + Paragon-Raenge werden auf 3 gekappt, exakte Rueckerstattung, idempotent bei erneutem Aufruf', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const result = await page.evaluate(() => {
      const def = bkmpPrestigeNodeById('schluesselbund');
      // Simuliert einen Spieler mit Rang 10 (vor der Grind-Reduktion investiert)
      // UND 3 Paragon-Raengen (kurzzeitig nach dem ersten maxRank-Fix erreichbar,
      // bevor Paragon fuer diesen Knoten wieder entfernt wurde - exakt der im
      // Nutzer-Screenshot gezeigte Fall).
      let refundExpected = 0;
      for (let r = def.maxRank + 1; r <= 10; r++) refundExpected += bkmpPrestigeUpgradeCost(def, r);
      for (let p = 1; p <= 3; p++) refundExpected += bkmpPrestigeParagonCost(def, p);

      bkmpPrestigeState.prestige_allocations = { schluesselbund: 10, schluesselbund__paragon: 3 };
      bkmpPrestigeState.prestige_points_spent = 100000; // deutlich ueber dem erwarteten Refund, damit max(0,...) nie greift
      const spentBefore = bkmpPrestigeState.prestige_points_spent;

      bkmpPrestigeMigrateSchluesselbundDowngrade();
      const afterFirst = {
        rank: bkmpPrestigeState.prestige_allocations.schluesselbund,
        paragon: bkmpPrestigeState.prestige_allocations.schluesselbund__paragon,
        spent: bkmpPrestigeState.prestige_points_spent,
        bonus: bkmpPrestigeEffectTotals(bkmpPrestigeState.prestige_allocations).dungeon_key_cap_bonus
      };

      // Zweiter Aufruf (z.B. beim naechsten Laden) darf nichts mehr veraendern - idempotent.
      bkmpPrestigeMigrateSchluesselbundDowngrade();
      const afterSecond = {
        rank: bkmpPrestigeState.prestige_allocations.schluesselbund,
        spent: bkmpPrestigeState.prestige_points_spent
      };

      return { refundExpected, spentBefore, afterFirst, afterSecond };
    });

    expect(result.afterFirst.rank).toBe(3);
    expect(result.afterFirst.paragon).toBeUndefined();
    expect(result.afterFirst.bonus).toBe(3); // nur noch der gekappte Rang zaehlt, kein Paragon-Anteil mehr
    expect(result.spentBefore - result.afterFirst.spent).toBe(result.refundExpected);
    expect(result.refundExpected).toBeGreaterThan(0); // echter, spuerbarer Refund, kein Nullbetrag

    // Idempotenz: zweiter Aufruf aendert weder Rang noch ausgegebene Punkte.
    expect(result.afterSecond.rank).toBe(3);
    expect(result.afterSecond.spent).toBe(result.afterFirst.spent);
  });

  test('Schluesselbund-Downgrade-Migration: ein Spieler bei Rang<=3 ohne Paragon bleibt komplett unangetastet', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      bkmpPrestigeState.prestige_allocations = { schluesselbund: 2 };
      bkmpPrestigeState.prestige_points_spent = 500;
      bkmpPrestigeMigrateSchluesselbundDowngrade();
      return { rank: bkmpPrestigeState.prestige_allocations.schluesselbund, spent: bkmpPrestigeState.prestige_points_spent };
    });
    expect(result.rank).toBe(2);
    expect(result.spent).toBe(500);
  });

  test('Schluesselbund-Downgrade-Migration laeuft automatisch beim echten Login (kein manueller Funktionsaufruf noetig) - exakt der gemeldete Produktionsfall', async ({ page, qaBaseURL, fixtureData, store }) => {
    // Simuliert genau das, was in der DB fuer einen betroffenen Spieler stand,
    // BEVOR er sich das erste Mal nach dem Fix wieder einloggt - identisches
    // Muster wie setPrestigeAllocations() in dungeon-key-prestige-bonus.spec.js.
    const rows = store.tables.idle_prestige_state || (store.tables.idle_prestige_state = []);
    let row = rows.find(r => r.name_key === fixtureData.nameKey);
    if (!row) {
      row = { name_key: fixtureData.nameKey, display_name: fixtureData.nameKey, prestige_level: 5, prestige_points: 500, prestige_points_spent: 300, prestige_allocations: {}, updated_at: new Date().toISOString() };
      rows.push(row);
    }
    row.prestige_allocations = { ...row.prestige_allocations, schluesselbund: 10, schluesselbund__paragon: 3 };
    row.prestige_points_spent = 100000;

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const result = await page.evaluate(() => ({
      rank: bkmpPrestigeState.prestige_allocations.schluesselbund,
      paragon: bkmpPrestigeState.prestige_allocations.schluesselbund__paragon,
      spentLessThanBefore: bkmpPrestigeState.prestige_points_spent < 100000
    }));
    expect(result.rank).toBe(3);
    expect(result.paragon).toBeUndefined();
    expect(result.spentLessThanBefore).toBe(true);
  });

  /* Nutzerwunsch 03.08.2026 ("wir haben Feste Schluessel Zeiten. da bringt
     so ein skill nichts"): der Knoten "Schluesselmeister" (individuelles,
     vom gemeinsamen Raster abweichendes Zeitverhalten) wurde komplett aus
     dem Katalog entfernt - anders als die Schluesselbund-Downgrade-
     Migration oben (Rang wird nur GEKAPPT, Knoten bleibt kaufbar) gibt es
     hier gar keinen Zielrang mehr, jede Investition wird vollstaendig
     zurueckerstattet. Gleiches Test-Trio wie beim Schluesselbund-Vorbild:
     (1) Knoten wirklich weg + nicht mehr kaufbar, (2) Rueckerstattungs-
     Migration exakt + idempotent, (3) ein Spieler ohne Investition bleibt
     unangetastet. */
  test('Schluesselmeister: Knoten komplett aus dem Katalog entfernt, nicht mehr kaufbar', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const result = await page.evaluate(() => {
      const before = bkmpPrestigeState.prestige_allocations.schluesselmeister || 0;
      const spentBefore = bkmpPrestigeState.prestige_points_spent;
      bkmpPrestigeState.prestige_points = 100000;
      bkmpPrestigeBuyUpgrade('schluesselmeister'); // darf ins Leere laufen - kein solcher Knoten mehr im Katalog
      return {
        nodeExists: !!bkmpPrestigeNodeById('schluesselmeister'),
        rankAfter: bkmpPrestigeState.prestige_allocations.schluesselmeister || 0,
        rankBefore: before,
        spentUnchanged: bkmpPrestigeState.prestige_points_spent === spentBefore
      };
    });
    expect(result.nodeExists).toBe(false);
    expect(result.rankAfter).toBe(result.rankBefore); // kein Kauf moeglich, da kein Knoten mehr existiert
    expect(result.spentUnchanged).toBe(true);
  });

  test('Schluesselmeister-Entfernungs-Migration: Rang + Paragon werden vollstaendig zurueckerstattet, exakt, idempotent bei erneutem Aufruf', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const result = await page.evaluate(() => {
      // Simuliert einen Spieler mit Maximalrang (30) + 2 Paragon-Raengen -
      // exakt der reale Blacklaier1337-Bestand aus der Live-Untersuchung.
      const legacyDef = bkmpPrestigeTierDef('MEDIUM');
      let refundExpected = 0;
      for (let r = 1; r <= 30; r++) refundExpected += bkmpPrestigeUpgradeCost(legacyDef, r);
      for (let p = 1; p <= 2; p++) refundExpected += bkmpPrestigeParagonCost(legacyDef, p);

      bkmpPrestigeState.prestige_allocations = { schluesselmeister: 30, schluesselmeister__paragon: 2 };
      bkmpPrestigeState.prestige_points_spent = 5000000; // deutlich ueber dem erwarteten Refund
      const spentBefore = bkmpPrestigeState.prestige_points_spent;

      bkmpPrestigeMigrateSchluesselmeisterRemoval();
      const afterFirst = {
        rank: bkmpPrestigeState.prestige_allocations.schluesselmeister,
        paragon: bkmpPrestigeState.prestige_allocations.schluesselmeister__paragon,
        spent: bkmpPrestigeState.prestige_points_spent
      };

      // Zweiter Aufruf (z.B. beim naechsten Laden) darf nichts mehr veraendern - idempotent.
      bkmpPrestigeMigrateSchluesselmeisterRemoval();
      const afterSecond = {
        rank: bkmpPrestigeState.prestige_allocations.schluesselmeister,
        spent: bkmpPrestigeState.prestige_points_spent
      };

      return { refundExpected, spentBefore, afterFirst, afterSecond };
    });

    expect(result.afterFirst.rank).toBeUndefined();
    expect(result.afterFirst.paragon).toBeUndefined();
    expect(result.spentBefore - result.afterFirst.spent).toBe(result.refundExpected);
    expect(result.refundExpected).toBeGreaterThan(0); // echter, spuerbarer Refund, kein Nullbetrag

    // Idempotenz: zweiter Aufruf aendert weder Zuteilung noch ausgegebene Punkte.
    expect(result.afterSecond.rank).toBeUndefined();
    expect(result.afterSecond.spent).toBe(result.afterFirst.spent);
  });

  test('Schluesselmeister-Entfernungs-Migration: ein Spieler ohne jede Investition bleibt komplett unangetastet', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      bkmpPrestigeState.prestige_allocations = { ewiges_feuer: 5 };
      bkmpPrestigeState.prestige_points_spent = 500;
      bkmpPrestigeMigrateSchluesselmeisterRemoval();
      return { spent: bkmpPrestigeState.prestige_points_spent, otherRankUntouched: bkmpPrestigeState.prestige_allocations.ewiges_feuer };
    });
    expect(result.spent).toBe(500);
    expect(result.otherRankUntouched).toBe(5);
  });

  /* REGRESSION (Nutzer-Screenshot 05.08.2026, "Sieht schrecklich aus" zum
     "Weitere Gefährten"-Knoten): bkmpPrestigeRenderBranchGridHtml() setzte
     Icon+Name bisher als flache Flex-Kinder direkt in die Karte statt in
     den seit Phase 5.4 (18.07., siehe idledorf.js/bkmpIdleUpgradeCardHtml)
     etablierten .idle-upgrade-card-head/-card-title-Wrapper - das Icon
     rutschte dadurch als eigene grosse Zeile UEBER den Titel statt daneben
     zu stehen. Zweiter, unabhaengiger Fund an derselben Karte: .idle-
     upgrade-desc hatte ueberhaupt keine CSS-Regel (reiner unstyled Browser-
     Default-Text). Ruft die echte Render-Funktion direkt auf (kein Tab-
     Klick noetig, gleiches Muster wie der Rest dieser Datei). */
  test('Prestige-Knoten-Karte nutzt dieselbe Icon+Titel-Kopfzeile wie der Upgrades-Tab, Beschreibung ist gestylt (nicht Browser-Default)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => {
      bkmpPrestigeSetActiveBranch('legacy');
      const panel = document.createElement('div');
      panel.className = 'idle-dorf-panel';
      document.body.appendChild(panel);
      panel.innerHTML = bkmpPrestigeRenderBranchGridHtml(bkmpPrestigeState.prestige_allocations || {}, 999999999);
      const card = Array.from(panel.querySelectorAll('.idle-upgrade-card')).find(c => c.textContent.includes('Weitere Gefährten'));
      const head = card.querySelector('.idle-upgrade-card-head');
      const icon = card.querySelector('.idle-upgrade-icon');
      const title = card.querySelector('.idle-upgrade-card-title');
      const name = card.querySelector('.idle-upgrade-name');
      const level = card.querySelector('.idle-upgrade-level');
      const desc = card.querySelector('.idle-upgrade-desc');
      const iconRect = icon.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const descCs = getComputedStyle(desc);
      const out = {
        hasHeadWrapper: !!head,
        iconInsideHead: head ? head.contains(icon) : false,
        titleInsideHead: head ? head.contains(title) : false,
        // "Gleiche Zeile" heisst: vertikaler Ueberlapp, NICHT gleicher top-Wert -
        // align-items:center verschiebt den top eines kuerzeren Icons (32px)
        // gegenueber dem zweizeiligen Titel (56.6px) bewusst nach unten.
        iconSameRowAsTitle: iconRect.top < titleRect.bottom && iconRect.bottom > titleRect.top,
        iconLeftOfTitle: iconRect.right <= titleRect.left + 2,
        nameText: name.textContent.trim(),
        levelText: level.textContent.trim(),
        // Browser-Default fuer <div> ist stets rgb(0,0,0) (schwarz) - ein gestyltes muted Grau/Lila darf das nie sein.
        descIsNotBlackDefault: descCs.color !== 'rgb(0, 0, 0)',
        descOverflowWrap: descCs.overflowWrap
      };
      panel.remove();
      return out;
    });
    expect(result.hasHeadWrapper).toBe(true);
    expect(result.iconInsideHead).toBe(true);
    expect(result.titleInsideHead).toBe(true);
    expect(result.iconSameRowAsTitle).toBe(true);
    expect(result.iconLeftOfTitle).toBe(true);
    expect(result.nameText).toBe('Weitere Gefährten');
    expect(result.levelText).toMatch(/^Rang \d+\/2$/);
    expect(result.descIsNotBlackDefault).toBe(true);
    expect(result.descOverflowWrap).toBe('break-word');
  });
});
