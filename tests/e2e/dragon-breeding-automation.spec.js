const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Dringender Spieler-Bugreport (27.07.2026, Discord, "Kaiser [Dustin]"):
   "Auto bruetet funktioniert aber die Eier werden trotzdem angezeigt das man
   sie nochmal Bruten kann?" - der Prestige-Automations-Zweig
   auto_egg_nest_unlock (bkmpIdleRunAutomationToggles(), idledorf.js) konnte
   ein legendaeres Ei, das eine AWAIT-blockierende Opfergabe-Bestaetigung
   braucht (bkmpDragonAssignEggToNest, bkmp-breeding.js), zweimal verwenden:

   1) Der Dispatcher waehlte das "beste" Ei direkt aus dem rohen
      bkmpPlayerDragonEggs - anders als bkmpIdleRenderDragonsPanel()s
      unassignedEggs-Filter (bkmp-breeding.js), der Eier ausschliesst, die
      bereits in einem Nest brueten. Solange ein legendaeres Ei auf seine
      Bestaetigung wartete, blieb es in bkmpPlayerDragonEggs unveraendert
      "verfuegbar" - ein spaeterer Automations-Durchlauf mit einem ZWEITEN
      freien Nest griff dasselbe (noch nicht geschluepfte) Ei erneut und
      legte es in ein zweites Nest. assignEggToDragonNest() prueft nur, ob
      das NEST leer ist, nicht ob das EI schon woanders liegt - aus einem Ei
      wurden zwei Drachen.
   2) Selbst OHNE ein zweites Nest konnte ein zweiter Automations-Durchlauf
      (10s-Takt) waehrend eine erste Bestaetigung fuer dasselbe Nest+Ei noch
      offen war, ein ZWEITES, redundantes Bestaetigungsfenster aufreissen
      ("es wird wieder angezeigt") - kein Ei-Duplikat (der Server-Guard in
      assignEggToDragonNest verhindert eine echte Doppel-Zuweisung ins
      selbe Nest), aber verwirrend und bei doppelter Bestaetigung eine
      doppelte Opfergabe-Belastung fuer nur eine tatsaechliche Zuweisung.

   Fix: bkmpDragonAssignEggToNest() (bkmp-breeding.js) bekommt (a) einen
   "bereits in einem Nest"-Guard direkt am Funktionsanfang (schuetzt jeden
   aktuellen UND kuenftigen Aufrufer, nicht nur die Automatisierung) und (b)
   eine Nest-ID-Busy-Sperre (identisches Muster wie das bereits bestehende
   bkmpDragonHatchBusyNestIds) ueber die GESAMTE Funktionsdauer inkl. der
   Bestaetigung. Der Automations-Dispatcher selbst (idledorf.js) bekommt
   zusaetzlich denselben unassignedEggs-Filter wie die manuelle Render-
   Funktion, damit er bei mehreren freien Nestern korrekt das naechste
   TATSAECHLICH freie Ei waehlt statt untaetig auf das bereits vergebene
   Top-Raritaets-Ei zu beharren. */

test.describe('Automatische Ei-Ausbruetung (auto_egg_nest_unlock) - kein Ei-Duplikat - Teststand C', () => {
  test.use({ teststand: 'C', startTimeMs: Date.parse('2026-01-15T08:00:00.000Z'), useFakeClock: true });

  const LEGENDARY_SPECIES = {
    id: 'qa-legendary-species', name: 'QA-Legendarius', rarity: 'legendaer',
    egg_source: 'dungeon', source_dragon_id: null, egg_drop_chance: 0,
    brood_seconds: 999999, sacrifice_gold: 5000000, sacrifice_crystals: 200,
    growth_points_required: 100, battle_xp_required: 100,
    is_multi_stat: true, sub_stat_count_min: 1, sub_stat_count_max: 1,
    egg_image: '', baby_image: '', teen_image: '', adult_image: '', sort_order: 1, active: true
  };
  const COMMON_SPECIES = {
    id: 'qa-common-species', name: 'QA-Commonus', rarity: 'standard',
    egg_source: 'dungeon', source_dragon_id: null, egg_drop_chance: 0,
    brood_seconds: 999999, sacrifice_gold: 0, sacrifice_crystals: 0,
    growth_points_required: 100, battle_xp_required: 100,
    is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1,
    egg_image: '', baby_image: '', teen_image: '', adult_image: '', sort_order: 2, active: true
  };

  test('REGRESSION: weist ein bereits genestetes legendaeres Ei nicht einem zweiten freien Nest zu', async ({ page, qaBaseURL, fixtureData, store, qaClock }) => {
    store.tables.dragon_species = [LEGENDARY_SPECIES];
    store.tables.player_dragon_eggs = [
      { id: 'qa-egg-legendary-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: LEGENDARY_SPECIES.id, created_at: fixtureData.nowIso }
    ];
    store.tables.player_dragon_nests = [
      { id: 'qa-nest-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, slot_index: 1, egg_id: null, started_at: null },
      { id: 'qa-nest-2', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, slot_index: 2, egg_id: null, started_at: null }
    ];

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const setup = await page.evaluate(() => {
      // Auto-Bestaetigen statt echter Modal-Interaktion (identisches Prinzip
      // wie admin.html's window.prompt-Mock, siehe CLAUDE.md).
      window.bkmpConfirmDialog = async () => true;
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_eiausbruetung = 1;
      bkmpIdleState.gold = 999999999;
      bkmpIdleState.crystals = 999999;
      return {
        bonus: bkmpPrestigeBonus('auto_egg_nest_unlock'),
        nestCount: bkmpPlayerDragonNests.length,
        eggCount: bkmpPlayerDragonEggs.length
      };
    });
    expect(setup.bonus).toBeGreaterThan(0);
    expect(setup.nestCount).toBe(2);
    expect(setup.eggCount).toBe(1);

    // Erster Automations-Durchlauf feuert praktisch sofort (der Throttle
    // vergleicht gegen bkmpIdleAutomationLastRunAt===0 beim Laden) - danach
    // ueber den 10s-Takt hinaus vorspulen fuer einen ZWEITEN Durchlauf, der
    // (vor dem Fix) das gleiche Ei erneut ins zweite Nest gelegt haette.
    await qaClock.advance(store, 1000);
    await expect.poll(() => page.evaluate(() => bkmpIdleState.gold), { timeout: 5000 }).toBeLessThan(999999999);
    await qaClock.advance(store, 11000);
    await page.waitForTimeout(500); // Puffer fuer einen (vor dem Fix) zweiten, fehlerhaften Zuweisungsversuch

    const after = await page.evaluate(() => ({
      nests: bkmpPlayerDragonNests.map(n => ({ id: n.id, egg_id: n.egg_id })),
      gold: bkmpIdleState.gold,
      crystals: bkmpIdleState.crystals
    }));

    const filledNests = after.nests.filter(n => n.egg_id === 'qa-egg-legendary-1');
    expect(filledNests.length).toBe(1); // NICHT 2 - das waere das gemeldete Duplikat
    const emptyNests = after.nests.filter(n => !n.egg_id);
    expect(emptyNests.length).toBe(1); // zweites Nest bleibt mangels eines zweiten Eis frei

    // Opfergabe darf nur EINMAL abgezogen worden sein, nicht zweimal.
    expect(999999999 - after.gold).toBe(LEGENDARY_SPECIES.sacrifice_gold);
    expect(999999 - after.crystals).toBe(LEGENDARY_SPECIES.sacrifice_crystals);

    // Server-Wahrheit direkt im Mock-Store gegenpruefen, nicht nur den
    // lokalen Client-Spiegel - genau ein Nest-Datensatz traegt das Ei.
    const serverFilledNests = (store.tables.player_dragon_nests || []).filter(n => n.egg_id === 'qa-egg-legendary-1');
    expect(serverFilledNests.length).toBe(1);
  });

  test('zwei unterschiedliche Eier werden weiterhin korrekt auf zwei freie Nester verteilt (keine Regression der eigentlichen Automatisierung)', async ({ page, qaBaseURL, fixtureData, store, qaClock }) => {
    store.tables.dragon_species = [LEGENDARY_SPECIES, COMMON_SPECIES];
    store.tables.player_dragon_eggs = [
      { id: 'qa-egg-legendary-2', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: LEGENDARY_SPECIES.id, created_at: fixtureData.nowIso },
      { id: 'qa-egg-common-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: COMMON_SPECIES.id, created_at: fixtureData.nowIso }
    ];
    store.tables.player_dragon_nests = [
      { id: 'qa-nest-3', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, slot_index: 1, egg_id: null, started_at: null },
      { id: 'qa-nest-4', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, slot_index: 2, egg_id: null, started_at: null }
    ];

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    await page.evaluate(() => {
      window.bkmpConfirmDialog = async () => true;
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_eiausbruetung = 1;
      bkmpIdleState.gold = 999999999;
      bkmpIdleState.crystals = 999999;
    });

    await qaClock.advance(store, 1000);
    await expect.poll(() => page.evaluate(() => bkmpPlayerDragonNests.some(n => n.egg_id)), { timeout: 5000 }).toBe(true);
    await qaClock.advance(store, 11000);
    await expect.poll(() => page.evaluate(() => bkmpPlayerDragonNests.every(n => n.egg_id)), { timeout: 5000 }).toBe(true);

    const eggIds = await page.evaluate(() => bkmpPlayerDragonNests.map(n => n.egg_id).sort());
    expect(eggIds).toEqual(['qa-egg-common-1', 'qa-egg-legendary-2'].sort());
  });

  test('direkter Nebenlaeufigkeits-Beweis: zwei parallele Aufrufe fuer dasselbe Nest+Ei duplizieren weder Zuweisung noch Opfergabe-Abzug', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [LEGENDARY_SPECIES];
    store.tables.player_dragon_eggs = [
      { id: 'qa-egg-legendary-3', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: LEGENDARY_SPECIES.id, created_at: fixtureData.nowIso }
    ];
    store.tables.player_dragon_nests = [
      { id: 'qa-nest-5', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, slot_index: 1, egg_id: null, started_at: null }
    ];

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    await page.evaluate(() => {
      window.bkmpConfirmDialog = async () => true;
      bkmpIdleState.gold = 999999999;
      bkmpIdleState.crystals = 999999;
    });

    // Beide Aufrufe starten im SELBEN synchronen Tick, bevor der erste sein
    // erstes await erreicht - genau das Rennen, das vor dem Fix ein zweites
    // Bestaetigungsfenster fuer dasselbe Nest+Ei aufriss.
    await page.evaluate(() => Promise.all([
      bkmpDragonAssignEggToNest('qa-nest-5', 'qa-egg-legendary-3'),
      bkmpDragonAssignEggToNest('qa-nest-5', 'qa-egg-legendary-3')
    ]));

    const after = await page.evaluate(() => ({
      nest: bkmpPlayerDragonNests.find(n => n.id === 'qa-nest-5'),
      gold: bkmpIdleState.gold,
      crystals: bkmpIdleState.crystals
    }));
    expect(after.nest.egg_id).toBe('qa-egg-legendary-3');
    expect(999999999 - after.gold).toBe(LEGENDARY_SPECIES.sacrifice_gold); // nur EINMAL abgezogen
    expect(999999 - after.crystals).toBe(LEGENDARY_SPECIES.sacrifice_crystals);
  });
});
