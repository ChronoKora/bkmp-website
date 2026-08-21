const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Fester AFK-Belohnungswert (21.08.2026) - ersetzt die bis dahin genutzte
   Zug-fuer-Zug-Kampfsimulation vollstaendig (siehe grosser Kommentar am
   Kopf von api/claim-idle-offline-progress.js fuer die volle Herleitung).
   Nutzerauftrag nach Betrachtung des vorherigen Zwischenstands (garantierter
   Mindestlohn ALS ZUSATZ zur Simulation): "Ich will das wir nur noch einen
   'Festwert' haben. Anhand der hoechsten Stufe. 75% Der Belohnung der
   hoechsten Stufe." - die Formel liest jetzt AUSSCHLIESSLICH deterministische
   Daten (hoechste je erreichte Stufe + feste Kill-Rate-Annahme + fester
   Prozentsatz), komplett unabhaengig von Kampfstats/Skilltree-Kampfzustand.

   Laeuft wie offline-afk.spec.js ueber die ECHTE, unveraenderte Handler-
   Datei (tests/mock/offline-progress-handler.js), keine Testkopie der
   Formel. Nur die Mock-Uhr (store.clock) wird vorgespult. */
test.describe('Offline-/AFK-Fortschritt - fester Wert anhand der hoechsten Stufe', () => {
  test.use({ teststand: 'B' });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Reine Speicher-/Server-Logik, keine UI-Interaktion noetig - deckt sich mit offline-afk.spec.js.');
  });

  function findRow(store, fixtureData) {
    return store.tables.idle_player_state.find(r => r.name_key === fixtureData.nameKey);
  }

  async function claimOffline(page) {
    return page.evaluate(() => bkmpIdleClaimOfflineProgress(bkmpGetMcName()));
  }

  function setAfkRewardConfig(store, value) {
    const row = store.tables.idle_game_config.find(r => r.key === 'offline_afk_reward');
    if (row) row.value = value;
    else store.tables.idle_game_config.push({ key: 'offline_afk_reward', value });
  }

  test('REGRESSION: Kampfwerte haben KEINEN Einfluss mehr auf die Belohnung (der urspruengliche BagonTr01-Bug ist strukturell unmoeglich)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const row = findRow(store, fixtureData);
    row.highest_dragon_index = 8;
    // Genau die Werte, die vorher (Kampfsimulation) garantiert zu 0
    // Belohnung gefuehrt haetten - jetzt duerfen sie ueberhaupt keine Rolle
    // mehr spielen.
    row.attack = 1;
    row.defense = 0;
    row.crit_chance = 0;
    row.crit_damage = 100;
    row.hp = 1;

    store.clock.advance(60 * 60 * 1000);
    const result = await claimOffline(page);

    expect(result.ok).toBe(true);
    expect(result.rewards).not.toBeNull();
    const anyPositive = ['gold', 'xp', 'wood', 'stone'].some(k => result.rewards[k] > 0);
    expect(anyPositive).toBe(true);
    expect(result.rewards.dragonKills).toBeGreaterThan(0);
  });

  test('Belohnung richtet sich nach highest_dragon_index, NICHT nach current_dragon_index', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const row = findRow(store, fixtureData);
    // Aktuell auf einer sehr niedrigen Stufe (z.B. nach einem Ruecksetzen/
    // "Bleibt auf dieser Stufe"), aber die hoechste je erreichte Stufe ist
    // weit hoeher - die Belohnung MUSS trotzdem die hohe Stufe verwenden.
    row.current_dragon_index = 1;
    row.highest_dragon_index = 60;

    store.clock.advance(60 * 60 * 1000);
    const lowRefResult = await claimOffline(page);

    // Vergleichswert: derselbe Spieler, aber highest_dragon_index jetzt
    // kuenstlich auf denselben niedrigen Wert wie current_dragon_index
    // gesetzt - muss deutlich weniger zahlen als der Lauf oben.
    row.current_dragon_index = 1;
    row.highest_dragon_index = 1;
    store.clock.advance(60 * 60 * 1000);
    const lowResult = await claimOffline(page);

    expect(lowRefResult.rewards.gold).toBeGreaterThan(lowResult.rewards.gold);
  });

  test('current_dragon_index und highest_dragon_index werden durch eine Abwesenheit nie veraendert', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const row = findRow(store, fixtureData);
    row.current_dragon_index = 3;
    row.highest_dragon_index = 42;

    store.clock.advance(6 * 3600 * 1000);
    const result = await claimOffline(page);

    expect(result.rewards.dragonKills).toBeGreaterThan(0); // echte Belohnung wurde gezahlt
    // newTotals enthaelt current_dragon_index/highest_dragon_index bewusst
    // gar nicht mehr (der PATCH-Payload setzt sie nie) - Object.assign(...)
    // im Client (bkmpIdleApplyOfflineResult) laesst dadurch bereits
    // bestehende Client-Werte automatisch unangetastet. Die eigentliche
    // Pruefung: der SERVER-seitige Stand selbst bleibt unveraendert.
    expect(result.newTotals.current_dragon_index).toBeUndefined();
    expect(result.newTotals.highest_dragon_index).toBeUndefined();
    expect(findRow(store, fixtureData).current_dragon_index).toBe(3);
    expect(findRow(store, fixtureData).highest_dragon_index).toBe(42);
  });

  test('Belohnung waechst linear mit der Abwesenheitsdauer (2h ≈ 2x 1h)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    findRow(store, fixtureData).highest_dragon_index = 10;

    store.clock.advance(3600 * 1000);
    const oneHour = await claimOffline(page);
    store.clock.advance(3600 * 1000);
    const secondHour = await claimOffline(page);

    // Zwei unabhaengige, gleich lange Fenster hintereinander muessen (bei
    // gleicher Referenzstufe) nahezu denselben Betrag zahlen - kleine
    // Rundungsabweichungen (Math.floor/Math.round) sind erlaubt, echte
    // Verdopplung/Halbierung waere ein Bug.
    expect(secondHour.rewards.gold).toBeGreaterThan(0);
    const ratio = secondHour.rewards.gold / oneHour.rewards.gold;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });

  test('Admin-Konfig (efficiencyPct) wird tatsaechlich angewendet', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    findRow(store, fixtureData).highest_dragon_index = 10;

    setAfkRewardConfig(store, { efficiencyPct: 75, assumedSecondsPerKill: 45, assumedSecondsPerBossKill: 180, companionXpPerHour: 8 });
    store.clock.advance(3600 * 1000);
    const at75 = await claimOffline(page);

    setAfkRewardConfig(store, { efficiencyPct: 25, assumedSecondsPerKill: 45, assumedSecondsPerBossKill: 180, companionXpPerHour: 8 });
    store.clock.advance(3600 * 1000);
    const at25 = await claimOffline(page);

    expect(at25.rewards.gold).toBeLessThan(at75.rewards.gold);
    // Bei identischer Kill-Rate ist der Unterschied direkt proportional
    // zum Effizienz-Verhaeltnis (25/75) - grosszuegige Toleranz wegen
    // mehrfacher Rundung (Wachstum, Belohnung, beide je Math.round()).
    const ratio = at25.rewards.gold / at75.rewards.gold;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.45);
  });

  test('Wirtschafts-Skilltree "wirt_offline" erhoeht den Prozentsatz weiterhin additiv (bereits investierte Punkte bleiben wirksam)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const row = findRow(store, fixtureData);
    row.highest_dragon_index = 10;
    row.skill_allocations = { ...(row.skill_allocations || {}) };

    store.clock.advance(3600 * 1000);
    const withoutSkill = await claimOffline(page);

    row.skill_allocations = { ...(row.skill_allocations || {}), wirt_offline: 6 }; // Maximalrang, +30%
    store.clock.advance(3600 * 1000);
    const withSkill = await claimOffline(page);

    expect(withSkill.rewards.gold).toBeGreaterThan(withoutSkill.rewards.gold);
  });

  test('Boss-Stufe als hoechste Stufe zahlt Kristalle/Essenz und zaehlt alle Kills als Boss-Kills', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // Stufe 25 (killIndex 24) ist laut spawn_rule='boss_25' immer ein Boss.
    const row = findRow(store, fixtureData);
    row.highest_dragon_index = 24;
    const bossKillsBefore = Number(row.boss_kills || 0);

    store.clock.advance(3600 * 1000);
    const result = await claimOffline(page);

    expect(result.rewards.dragonKills).toBeGreaterThan(0);
    expect(result.rewards.crystals).toBeGreaterThan(0);
    expect(result.rewards.essence).toBeGreaterThan(0);
    expect(result.newTotals.boss_kills).toBe(bossKillsBefore + result.rewards.dragonKills);
  });
});
