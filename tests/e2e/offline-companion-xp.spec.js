const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Bug-Fix (Spieler-Meldung 05.08.2026, Screenshot einer "Lohendrache
   (Jugendlich)"-Karte): "scheinbar über nacht offline timer passiert auch
   nichts an Fortschritt" - gemeint war der Kampf-EP-Fortschritt des
   jugendlichen Begleitdrachen (Jugendlich -> Erwachsen), NICHT der normale
   Drachen-Kampf-Fortschritt (Stufe/Gold/Ressourcen), der bereits laengst
   von offline-afk.spec.js abgedeckt ist und unveraendert funktioniert.

   Root Cause: api/claim-idle-offline-progress.js kannte player_dragons
   bisher ueberhaupt nicht - waehrend eine Abwesenheit den normalen
   Drachen-Kampf-Fortschritt vollstaendig simulierte, blieb der Begleitdrache
   dabei komplett aussen vor (bkmpDragonGrantCompanionBattleXp() wird live nur
   bei tatsaechlich laufendem Spiel aufgerufen, siehe idledorf.js/bkmp-dungeon.js/
   bkmp-tower.js - alle drei nur im aktiven Tick-Betrieb, nie hier).

   Laeuft ueber die ECHTE, unveraenderte Handler-Datei (identisches Prinzip
   wie offline-afk.spec.js - tests/mock/offline-progress-handler.js ruft
   api/claim-idle-offline-progress.js in-process auf, keine Testkopie der
   Formel). Nur die Mock-Uhr (store.clock) wird vorgespult. */
test.describe('Offline-Fortschritt: Begleitdrache-Kampf-EP', () => {
  test.use({ teststand: 'B' });

  const SPECIES = { id: 'qa-companion-species', name: 'QA-Begleiter', rarity: 'episch', battle_xp_required: 100, growth_points_required: 10, egg_source: 'event', sort_order: 1 };

  async function claimOffline(page) {
    return page.evaluate(() => bkmpIdleClaimOfflineProgress(bkmpGetMcName()));
  }

  test('Begleitdrache bekommt Kampf-EP fuer waehrend der Abwesenheit simulierte Kills', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      { id: 'qa-companion-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: SPECIES.id, stage: 'teen', is_companion: true, battle_xp: 0, growth_points: 10, substats: [], hatched_at: fixtureData.nowIso, adult_at: null }
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    store.clock.advance(4 * 3600 * 1000);
    const result = await claimOffline(page);

    expect(result.ok).toBe(true);
    expect(result.rewards.dragonKills).toBeGreaterThan(0);
    expect(result.rewards.dragonXpGain).toBeGreaterThan(0);

    const serverDragon = store.tables.player_dragons.find(d => d.id === 'qa-companion-1');
    expect(serverDragon.battle_xp).toBe(result.rewards.dragonXpGain);
    expect(serverDragon.battle_xp).toBeLessThanOrEqual(SPECIES.battle_xp_required);
  });

  test('EP-Gutschrift wird bei battle_xp_required gedeckelt, nicht darueber hinaus geschrieben', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      { id: 'qa-companion-2', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: SPECIES.id, stage: 'teen', is_companion: true, battle_xp: 96, growth_points: 10, substats: [], hatched_at: fixtureData.nowIso, adult_at: null }
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    // Reichlich Zeit vorspulen - garantiert deutlich mehr Kills, als die
    // verbleibenden 4 EP bis battle_xp_required (100) brauchen wuerden.
    store.clock.advance(12 * 3600 * 1000);
    const result = await claimOffline(page);
    expect(result.ok).toBe(true);

    const serverDragon = store.tables.player_dragons.find(d => d.id === 'qa-companion-2');
    expect(serverDragon.battle_xp).toBe(SPECIES.battle_xp_required); // gedeckelt bei 100, nicht darueber
    expect(result.rewards.dragonXpGain).toBe(4); // 96 -> 100
  });

  test('kein Begleitdrache vorhanden - keine Fehler, kein dragonXpGain', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [];
    store.tables.player_dragons = [];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    store.clock.advance(2 * 3600 * 1000);
    const result = await claimOffline(page);
    expect(result.ok).toBe(true);
    expect(result.rewards.dragonXpGain).toBe(0);
  });

  test('erwachsener Drache (kein Jugendlicher) bekommt keine Offline-Kampf-EP', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      { id: 'qa-companion-adult', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: SPECIES.id, stage: 'adult', is_companion: true, battle_xp: SPECIES.battle_xp_required, growth_points: 10, substats: [], stat_attack: 10, stat_defense: 5, stat_hp: 100, ascension_level: 0, hatched_at: fixtureData.nowIso, adult_at: fixtureData.nowIso }
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    store.clock.advance(4 * 3600 * 1000);
    const result = await claimOffline(page);
    expect(result.ok).toBe(true);
    expect(result.rewards.dragonXpGain).toBe(0);
  });

  test('Client uebernimmt frisch gewaehrte Kampf-EP nach bkmpIdleApplyOfflineResult in bkmpPlayerDragons', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      { id: 'qa-companion-3', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: SPECIES.id, stage: 'teen', is_companion: true, battle_xp: 0, growth_points: 10, substats: [], hatched_at: fixtureData.nowIso, adult_at: null }
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    store.clock.advance(4 * 3600 * 1000);
    const result = await claimOffline(page);
    expect(result.rewards.dragonXpGain).toBeGreaterThan(0);

    // bkmpIdleApplyOfflineResult() stoesst bei dragonXpGain>0 einen fire-
    // and-forget loadPlayerDragons()-Refresh an (siehe idledorf.js) - kurz
    // pollen statt sofort zu pruefen, echter Netzwerk-Roundtrip auch im Mock.
    await page.evaluate((r) => bkmpIdleApplyOfflineResult(r), result);
    await expect.poll(() => page.evaluate(() => {
      const d = (typeof bkmpPlayerDragons !== 'undefined' ? bkmpPlayerDragons : []).find(x => x.id === 'qa-companion-3');
      return d ? d.battle_xp : null;
    }), { timeout: 5000 }).toBe(result.rewards.dragonXpGain);
  });
});
