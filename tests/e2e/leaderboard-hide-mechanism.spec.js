const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Reine Server-/Datenlogik, keine UI-Interaktion noetig - deckt sich mit anticheat-progress-rate-guard.spec.js.');
});

/* Regressionsschutz fuer den am 11.08.2026 gemeldeten Falsch-Alarm-Sturm
   ("habe berichte das einige nicht mehr in der Leaderboards angezeigt
   werden"). ROOT CAUSE: die urspruengliche View aus sql/20260809-leaderboard-
   hide-mechanism.sql blendete automatisch JEDEN Account mit irgendeinem
   undismissed Anti-Cheat-Alarm aus - der viel zu enge combat-stat-Trigger
   (siehe anticheat-progress-rate-guard.spec.js) loeste dadurch bei ca. 15%
   aller aktiven Accounts (33 von 217, per curl gegen die echte Produktions-
   DB bestaetigt) einen Falsch-Alarm aus, praktisch nur lange dokumentierte,
   echte Spieler (inkl. des eigenen Accounts des Betreibers). sql/20260811-
   leaderboard-hide-decouple-from-flags.sql entkoppelt das Ausblenden
   vollstaendig von der automatischen Alarm-Erkennung - nur noch eine
   manuelle Admin-Panel-Entscheidung (idle_leaderboard_hidden_accounts)
   blendet einen Account aus. Diese Suite existierte beim urspruenglichen Bau
   des Ausblend-Mechanismus (09.08., Task "Build leaderboard-hiding
   mechanism") noch nicht - haette den Bug aber sofort gefangen.

   tests/mock/rest-engine.js bildet dafuer erstmals die reale Postgres-VIEW
   public.idle_player_state_leaderboard nach (computeLeaderboardViewRows()) -
   vorher gab es im Mock ueberhaupt keine Unterscheidung zwischen der rohen
   idle_player_state-Tabelle und der gefilterten View. */
test.describe('Oeffentliche Bestenliste - Ausblend-Mechanismus', () => {
  test.use({ teststand: 'A' });

  function seedOtherPlayer(store, nameKey, overrides) {
    store.tables.idle_player_state.push({
      auth_user_id: `other-${nameKey}`, name_key: nameKey, display_name: nameKey,
      level: 500, total_gold_earned: 1000, dragon_kills: 50000, playtime_seconds: 10000,
      highest_dragon_index: 100, prestige_stage_offset: 0, turm_highest_wave: 0,
      ...overrides
    });
  }

  test('ein Account mit einem undismissed Anti-Cheat-Alarm bleibt auf der Bestenliste sichtbar (Kern-Regressionsbeweis fuer den 11.08.-Falsch-Alarm-Sturm)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    seedOtherPlayer(store, 'flaggedplayer');
    store.tables.idle_anticheat_flags = store.tables.idle_anticheat_flags || [];
    store.tables.idle_anticheat_flags.push({
      id: store.nextId(), name_key: 'flaggedplayer', dismissed: false, triggered_by: 'combat_stats'
    });

    const rows = await page.evaluate(() => loadIdleLeaderboardStats());
    expect(rows.map(r => r.name_key)).toContain('flaggedplayer');
  });

  test('ein Account mit MEHREREN undismissed Alarmen (kills+level+combat_stats) bleibt trotzdem sichtbar', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    seedOtherPlayer(store, 'multiflagplayer');
    store.tables.idle_anticheat_flags = store.tables.idle_anticheat_flags || [];
    store.tables.idle_anticheat_flags.push(
      { id: store.nextId(), name_key: 'multiflagplayer', dismissed: false, triggered_by: 'dragon_kills' },
      { id: store.nextId(), name_key: 'multiflagplayer', dismissed: false, triggered_by: 'level' },
      { id: store.nextId(), name_key: 'multiflagplayer', dismissed: false, triggered_by: 'combat_stats' }
    );

    const rows = await page.evaluate(() => loadIdleLeaderboardStats());
    expect(rows.map(r => r.name_key)).toContain('multiflagplayer');
  });

  test('ein manuell ausgeblendeter Account fehlt auf der Bestenliste', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    seedOtherPlayer(store, 'hiddenplayer');

    let rows = await page.evaluate(() => loadIdleLeaderboardStats());
    expect(rows.map(r => r.name_key)).toContain('hiddenplayer');

    await page.evaluate((name) => hideFromLeaderboard(name, 'Testgrund'), 'hiddenplayer');
    rows = await page.evaluate(() => loadIdleLeaderboardStats());
    expect(rows.map(r => r.name_key)).not.toContain('hiddenplayer');
  });

  test('unhideFromLeaderboard() stellt einen zuvor ausgeblendeten Account wieder her', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    seedOtherPlayer(store, 'unhideplayer');
    await page.evaluate((name) => hideFromLeaderboard(name, 'Testgrund'), 'unhideplayer');

    let rows = await page.evaluate(() => loadIdleLeaderboardStats());
    expect(rows.map(r => r.name_key)).not.toContain('unhideplayer');

    await page.evaluate((name) => unhideFromLeaderboard(name), 'unhideplayer');
    rows = await page.evaluate(() => loadIdleLeaderboardStats());
    expect(rows.map(r => r.name_key)).toContain('unhideplayer');
  });

  test('andere, nicht betroffene Accounts bleiben unabhaengig von Flags/Ausblendung normal sichtbar', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    seedOtherPlayer(store, 'normalplayer1');
    seedOtherPlayer(store, 'normalplayer2');
    seedOtherPlayer(store, 'hiddenplayer2');
    await page.evaluate((name) => hideFromLeaderboard(name, 'x'), 'hiddenplayer2');

    const rows = await page.evaluate(() => loadIdleLeaderboardStats());
    const names = rows.map(r => r.name_key);
    expect(names).toContain('normalplayer1');
    expect(names).toContain('normalplayer2');
    expect(names).not.toContain('hiddenplayer2');
  });

  test('END-ZU-ENDE-Beweis: eine echte Kampfwerte-Kappung ueber den Trigger-Mock (den urspruenglichen Ausloeser) fuehrt NICHT mehr zum Verschwinden vom eigenen Account', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    // Loest ueber den echten Speicherpfad (PATCH idle_player_state) einen
    // echten Anti-Cheat-Alarm aus - exakt der Codepfad, der am 11.08. den
    // eigenen Account des Betreibers und 32 weitere echte Spieler faelschlich
    // von der Bestenliste verschwinden liess.
    await page.evaluate(() => {
      bkmpIdleState.attack = 9000000; // ueber der absoluten Obergrenze (1.000.000)
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    expect((store.tables.idle_anticheat_flags || []).length).toBeGreaterThan(0);

    const rows = await page.evaluate(() => loadIdleLeaderboardStats());
    expect(rows.map(r => r.name_key)).toContain(fixtureData.nameKey);
  });
});
