/* Gilden-Technologie (26.07.2026, urspruenglich v2) - READ-Seite mehrerer
   Zweige, die am Ende alle im selben client-seitigen Cache landen
   (bkmp-guild-tech-cache, bkmpGuildTechBonus() in js/systems/bkmp-guild.js).
   Statt jedes Mal eine echte Gilde+Beitrags-Roundtrip aufzusetzen, wird der
   Cache hier direkt injiziert - das prueft exakt denselben Code-Pfad wie ein
   echter Spieler sehen wuerde (jede Verbrauchsstelle liest ausschliesslich
   ueber bkmpGuildTechBonus()/bkmpIdleGetGuildTechCache(), nie ueber Kenntnis
   "woher" der Wert kommt) - DIESER Teil der Datei ist vom v2->v3-Umbau
   (Baum-System mit Mitglieder-Beitraegen, 31.07.2026, siehe Plan
   zazzy-crunching-plum.md/CLAUDE.md) UNBERUEHRT, weiterhin gueltig und aktiv
   (bewusst nicht uebersprungen, anders als guild-tech.spec.js/
   guild-tech-ext.spec.js, die direkt window.bkmpGuildTechUpgrade() aufrufen).

   Nachtwache ist die einzige Ausnahme (serverseitiger Offline-Deckel,
   api/claim-idle-offline-progress.js) - dort lebt der Effekt NICHT im
   Client-Cache, sondern wird bei jedem Claim frisch nachgeschlagen. Seit dem
   v3-Umbau aus guild_tech_progress/guild_tech_nodes (vorher guild_members/
   guild_tech_levels) - der zugehoerige describe-Block unten wurde auf die
   neuen Tabellen umgestellt. Braucht deshalb echte Gilden-Tabellen im
   Mock-Store (per direkter store.tables-Injektion in einen bestehenden
   Einzelspieler-Teststand, gleicher Trick wie in
   tests/e2e/prestige-automation-toggles.spec.js). */

const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

function setCache(page, obj) {
  return page.evaluate((o) => localStorage.setItem('bkmp-guild-tech-cache', JSON.stringify(o)), obj);
}

test.describe('Gilden-Technologie v2 - Read-Side ueber direkte Cache-Injektion (Brutbeschleuniger/Schmiede/Autokauf/Aufstieg)', () => {
  test.use({ teststand: 'A' });

  test('Brutbeschleuniger senkt Brutzeit UND Opfergabe-Kosten', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const before = await page.evaluate(() => ({
      brood: bkmpDragonEffectiveBroodSeconds({ brood_seconds: 1000 }),
      sac: bkmpDragonSacrificeCost({ sacrifice_gold: 1000, sacrifice_crystals: 100 })
    }));
    await setCache(page, { broodSpeedPct: 20 });
    const after = await page.evaluate(() => ({
      brood: bkmpDragonEffectiveBroodSeconds({ brood_seconds: 1000 }),
      sac: bkmpDragonSacrificeCost({ sacrifice_gold: 1000, sacrifice_crystals: 100 })
    }));
    expect(after.brood).toBeLessThan(before.brood);
    expect(after.sac.gold).toBeLessThan(before.sac.gold);
  });

  test('Gildenschmiede senkt Runen-Aufwertungskosten, gedeckelt bei 40% (Rebalance 26.07., vorher 20%)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const rune = { rarity: 'blue', upgrade_level: 3 };
    const baseCost = await page.evaluate((r) => bkmpIdleRuneUpgradeCost(r), rune);
    await setCache(page, { runeUpgradeDiscountPct: 15 });
    const discounted = await page.evaluate((r) => bkmpIdleRuneUpgradeCost(r), rune);
    expect(discounted).toBeLessThan(baseCost);
    expect(discounted).toBeCloseTo(Math.round(baseCost * 0.85), 0);
    // Deckel: 999% im Cache darf trotzdem nie mehr als 40% Rabatt geben.
    await setCache(page, { runeUpgradeDiscountPct: 999 });
    const cappedCost = await page.evaluate((r) => bkmpIdleRuneUpgradeCost(r), rune);
    expect(cappedCost).toBeCloseTo(Math.round(baseCost * 0.6), 0);
  });

  test('Gilden-Autokauf erhoeht den Kaufdeckel pro Tick zusaetzlich zu Prestige', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const before = await page.evaluate(() => bkmpIdleAutoBuyMaxPurchasesPerTick());
    await setCache(page, { autobuyExtraPurchases: 12 });
    const after = await page.evaluate(() => bkmpIdleAutoBuyMaxPurchasesPerTick());
    expect(after - before).toBe(12);
  });

  test('Aufstiegsvorbereitung senkt alle 3 Aufstiegs-Schwellen, gedeckelt bei 35% (Rebalance 26.07., vorher 10%)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const baseThresholds = await page.evaluate(() => bkmpAscensionEffectiveThresholds());
    expect(baseThresholds.minPrestigeLevel).toBe(10);
    expect(baseThresholds.minPointsSpent).toBe(500);
    expect(baseThresholds.minLifetimeStage).toBe(5000);

    await setCache(page, { ascensionThresholdDiscountPct: 10 });
    const discounted = await page.evaluate(() => bkmpAscensionEffectiveThresholds());
    expect(discounted.minPrestigeLevel).toBe(9); // round(10*0.9)
    expect(discounted.minPointsSpent).toBe(450);
    expect(discounted.minLifetimeStage).toBe(4500);

    // Ein Spieler, der NUR mit dem Rabatt eligible ist, beweist die reale Wirkung.
    const eligibility = await page.evaluate(() => {
      bkmpPrestigeState.prestige_level = 9;
      bkmpPrestigeState.prestige_points_spent = 480;
      bkmpIdleState.highest_dragon_index = 4700;
      const withDiscount = bkmpAscensionEligible();
      localStorage.setItem('bkmp-guild-tech-cache', JSON.stringify({}));
      const withoutDiscount = bkmpAscensionEligible();
      return { withDiscount, withoutDiscount };
    });
    expect(eligibility.withDiscount).toBe(true);
    expect(eligibility.withoutDiscount).toBe(false);

    // Deckel (Rebalance 26.07.): 10%->35% angehoben, nachdem die
    // Maximalstufe von 5 auf 15 (x2%=30%) gestiegen ist - 999% im Cache
    // darf trotzdem nie mehr als 35% Rabatt geben.
    await setCache(page, { ascensionThresholdDiscountPct: 999 });
    const capped = await page.evaluate(() => bkmpAscensionEffectiveThresholds());
    expect(capped.minPrestigeLevel).toBe(Math.max(1, Math.round(10 * 0.65)));
    expect(capped.minPointsSpent).toBe(Math.round(500 * 0.65));
    expect(capped.minLifetimeStage).toBe(Math.round(5000 * 0.65));
  });
});

test.describe('Gilden-Technologie v2 - Streak-Schutz', () => {
  test.use({ teststand: 'A', useFakeClock: true, startTimeMs: Date.parse('2026-03-10T10:00:00.000Z') });

  test('ein ausgelassener Tag senkt die Serie nur um 1 statt auf 1 zurueckzusetzen', async ({ page, qaBaseURL, fixtureData, qaClock }) => {
    // qaClock MUSS destructured werden, auch wenn hier nie .advance() darauf
    // aufgerufen wird - Playwright-Fixtures laufen nur, wenn ein Test sie
    // tatsaechlich anfordert. Ohne diese Zeile installiert useFakeClock:true
    // die gefakte Uhr NIE, wodurch der erste (implizite) Streak-Check beim
    // Login noch die ECHTE Systemzeit sieht - exakt das bereits in Phase 5
    // dokumentierte Fixture-Eigenheit (siehe login-streak.spec.js), hier neu
    // gefunden, weil dieser Test qaClock urspruenglich nicht destructured hatte.
    void qaClock;
    await openAndLogin(page, qaBaseURL, fixtureData); // Tag 1
    await waitForDragonReady(page);
    await page.clock.setFixedTime(Date.parse('2026-03-11T10:00:00.000Z')); // Tag 2
    await page.evaluate(() => bkmpIdleCheckDailyStreak());
    await page.clock.setFixedTime(Date.parse('2026-03-12T10:00:00.000Z')); // Tag 3
    await page.evaluate(() => bkmpIdleCheckDailyStreak());
    await page.clock.setFixedTime(Date.parse('2026-03-13T10:00:00.000Z')); // Tag 4
    await page.evaluate(() => bkmpIdleCheckDailyStreak());
    const beforeSkip = await page.evaluate(() => JSON.parse(localStorage.getItem('bkmp-idle-login-streak')));
    expect(beforeSkip.count).toBe(4);

    await page.evaluate(() => localStorage.setItem('bkmp-guild-tech-cache', JSON.stringify({ streakProtectUnlock: 1 })));
    await page.clock.setFixedTime(Date.parse('2026-03-15T10:00:00.000Z')); // Tag 6 - Tag 5 uebersprungen
    await page.evaluate(() => bkmpIdleCheckDailyStreak());
    const afterSkip = await page.evaluate(() => JSON.parse(localStorage.getItem('bkmp-idle-login-streak')));
    expect(afterSkip.count).toBe(3); // 4 - 1, NICHT auf 1 zurueckgesetzt
  });

  test('ohne den Zweig setzt ein ausgelassener Tag weiterhin komplett auf 1 zurueck (Regressionsschutz)', async ({ page, qaBaseURL, fixtureData, qaClock }) => {
    void qaClock; // siehe Kommentar im Test oben - erzwingt die gefakte Uhr
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.clock.setFixedTime(Date.parse('2026-03-11T10:00:00.000Z'));
    await page.evaluate(() => bkmpIdleCheckDailyStreak());
    await page.clock.setFixedTime(Date.parse('2026-03-13T10:00:00.000Z')); // Tag uebersprungen, KEIN Streak-Schutz
    await page.evaluate(() => bkmpIdleCheckDailyStreak());
    const streak = await page.evaluate(() => JSON.parse(localStorage.getItem('bkmp-idle-login-streak')));
    expect(streak.count).toBe(1);
  });
});

test.describe('Gilden-Technologie v3 - Nachtwache (serverseitiger Offline-Deckel, umgestellt von guild_tech_levels auf guild_tech_progress)', () => {
  test.use({ teststand: 'B' });

  /* 31.07.2026: api/claim-idle-offline-progress.js liest den Nachtwache-Bonus
     seit dem Baum-System-Umbau (v3) dynamisch aus guild_tech_progress/
     guild_tech_nodes statt aus dem abgeloesten guild_tech_levels - dieser
     Test wurde entsprechend umgestellt (Tabellen/Spaltennamen), die Assertion
     selbst (13h nicht gekappt) blieb unveraendert gueltig, da tier=4 *
     effect_per_tier=2,5 = 10h Bonus -> 22h Deckel, exakt aequivalent zum
     alten level=4 * 0,5 = 2h Bonus -> 14h Deckel fuer diesen Testfall. */
  test('erhoeht den Offline-Fortschritts-Deckel um effect_per_tier Std./Stufe fuer Mitglieder einer Gilde mit diesem Zweig', async ({ page, qaBaseURL, fixtureData, store }) => {
    // Guild-Tabellen nachtraeglich in den (auf Teststand B basierenden)
    // Store injizieren - derselbe Trick wie beim Raid-Automations-Test
    // (tests/e2e/prestige-automation-toggles.spec.js): store.tables ist ein
    // gewoehnliches, veraenderbares Objekt, unabhaengig davon, welche
    // Fixture es urspruenglich befuellt hat.
    const myAuthId = fixtureData.authUserId;
    store.tables.guild_members = [{ auth_user_id: myAuthId, guild_id: 'g-nachtwache', name_key: fixtureData.nameKey, display_name: fixtureData.displayName, role: 'leader', contributed_gold: 0, tech_contributed_gold: 0, joined_at: fixtureData.nowIso }];
    store.tables.guild_tech_nodes = [{ id: 'guild_nachtwache', category: 'wachstum', label: 'Nachtwache', description: '', icon: '🌙', effect_type: 'offlineCapExtraHours', effect_per_tier: 2.5, max_tier: 5, base_gold_cost: 3000000, cost_growth: 1.6, attempts_per_tier: 25, prereq_node_ids: [], pos_x: 100, pos_y: 350 }];
    store.tables.guild_tech_progress = [{ guild_id: 'g-nachtwache', node_id: 'guild_nachtwache', tier: 4, progress_gold: 0 }]; // 4 * 2,5 = +10 Std.

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    store.clock.advance(13 * 3600 * 1000); // 13h - ueber dem Standard-12h-Deckel, unter dem erweiterten 22h-Deckel
    const result = await page.evaluate(() => bkmpIdleClaimOfflineProgress(bkmpGetMcName()));
    expect(result.elapsedSeconds).toBe(13 * 3600); // NICHT bei 12h gekappt
  });

  test('ohne Gildenmitgliedschaft bleibt der Standard-Deckel (12h) unveraendert (Regressionsschutz)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    store.clock.advance(13 * 3600 * 1000);
    const result = await page.evaluate(() => bkmpIdleClaimOfflineProgress(bkmpGetMcName()));
    expect(result.elapsedSeconds).toBe(12 * 3600); // weiterhin beim Standard-Deckel gekappt
  });
});
