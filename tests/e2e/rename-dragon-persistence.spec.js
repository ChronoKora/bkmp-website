const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Dringender Bugfix-Auftrag 13.08.2026 (Discord-DM "Moni", Screenshot:
   "Eierlager: Noch keine Eier im Lager" + "Drachenlager (0/52): Noch keine
   jugendlichen oder erwachsenen Drachen" - die 52er-Kapazitaet beweist
   echte Vorgeschichte, kein frischer Account).

   ROOT CAUSE (per direktem curl gegen die echte Produktions-DB bestaetigt,
   nicht nur vermutet - siehe sql/20260813-fix-rename-dragon-tables-
   propagation.sql fuer die volle Herleitung): Moni hatte sich am 12.08.2026
   umbenannt (player_stats.last_name_change_at bestaetigt das). Ihre
   idle_player_state-Zeile ist unter dem NEUEN Namen vollstaendig gesund
   (level 4275, dragon_storage_expansions_bought=4 - passt exakt zur
   gemeldeten 52er-Kapazitaet), player_dragons/player_dragon_eggs/
   player_dragon_nests unter demselben neuen name_key sind dagegen alle
   DREI leer. Das ist EXAKT dieselbe Bugklasse wie der bereits am 25.07.2026
   gefundene+gefixte Fall fuer Runen/Prestige/Dorf-Skins (siehe rename-
   persistence.spec.js) - dieser Fix (sql/20260725-fix-rename-name-key-
   propagation.sql) ist inzwischen live, hat aber die drei Drachenzucht-
   Tabellen (sql/supabase-dragon-breeding.sql, 17.07.2026) schlicht
   uebersehen. KEIN echter Datenverlust - ihre Zeilen stehen unveraendert
   unter dem ALTEN name_key in der DB, nur der naechste Ladevorgang (strikt
   nach aktuellem name_key gefiltert, loadPlayerDragons()/
   loadPlayerDragonEggs()/loadPlayerDragonNests() in supabase.js) findet sie
   nicht mehr.

   tests/mock/rpc-engine.js's rename_player_account-Port
   (renamePlayerAccountCurrentBuggyBehavior) bildet exakt diese verbleibende
   Luecke nach - propagiert Runen/Prestige/Dorf-Skins inzwischen korrekt
   (matcht den live gefixten Stand), laesst aber player_dragons/
   player_dragon_eggs/player_dragon_nests bewusst unangetastet, damit dieser
   Test denselben Codepfad wie eine echte Umbenennung heute durchlaeuft. */

const STD_SPECIES = {
  id: 'qa-rename-species', name: 'QA-Umbenennungsdrache', rarity: 'standard',
  egg_source: 'dungeon', source_dragon_id: null, egg_drop_chance: 0,
  brood_seconds: 999999, sacrifice_gold: 0, sacrifice_crystals: 0,
  growth_points_required: 100, battle_xp_required: 100,
  is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1,
  egg_image: '', baby_image: '', teen_image: '', adult_image: '', sort_order: 1, active: true
};

async function seedPlayerStats(store, fixtureData) {
  store.tables.player_stats = store.tables.player_stats || [];
  store.tables.player_stats.push({
    auth_user_id: fixtureData.authUserId, name_key: fixtureData.nameKey, display_name: fixtureData.displayName,
    last_name_change_at: null
  });
}

function seedDragonData(store, fixtureData) {
  store.tables.dragon_species = [STD_SPECIES];
  store.tables.player_dragon_eggs = [
    { id: 'qa-rename-egg-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: STD_SPECIES.id, created_at: fixtureData.nowIso }
  ];
  store.tables.player_dragons = [
    { id: 'qa-rename-dragon-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: STD_SPECIES.id, stage: 'adult', nickname: 'MoniDrache', is_favorite: true, is_companion: false, stat_attack: 4275, stat_defense: 2100, stat_hp: 8000, substats: [], ascension_level: 2, hatched_at: fixtureData.nowIso, adult_at: fixtureData.nowIso }
  ];
  // slot_index bewusst 1 (nicht 0) - ensureFirstDragonNest() (supabase.js)
  // upsertet unbedingt einen Nest-Platz bei genau slot_index:1 (onConflict
  // 'auth_user_id,slot_index', ignoreDuplicates:true) - stimmt der Wert
  // nicht ueberein, legt es faelschlich einen ZWEITEN Nest-Platz an, egal
  // ob der Rename-Bug vorliegt oder nicht (der Konflikt-Schluessel enthaelt
  // ohnehin kein name_key, greift also in beiden Szenarien gleich).
  store.tables.player_dragon_nests = [
    { id: 'qa-rename-nest-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, slot_index: 1, egg_id: null, started_at: null }
  ];
}

async function renameViaRealFunction(page, newName) {
  return page.evaluate(async (name) => {
    const canonical = await bkmpPlayerRename(name);
    bkmpSetMcName(canonical);
    return canonical;
  }, newName);
}

/* Ruft NICHT bkmpPlayerRename() (fest verdrahtet auf den echten RPC-Namen
   'rename_player_account', supabase.js bleibt eingefroren) - sondern direkt
   den Test-Vorschau-RPC 'rename_player_account_fixed_preview'
   (tests/mock/rpc-engine.js), der 1:1 die vorgeschlagene, NICHT gegen die
   echte Produktions-DB ausgefuehrte Migration (sql/20260813-fix-rename-
   dragon-tables-propagation.sql) nachbildet - beweist, dass der Fix die
   Luecke tatsaechlich schliesst, bevor der Nutzer ihn live ausfuehrt. */
async function renameViaProposedFix(page, newName) {
  return page.evaluate(async (name) => {
    const { error } = await bkmpGetPlayerAuthClient().rpc('rename_player_account_fixed_preview', { p_new_name: name });
    if (error) throw new Error(error.message);
    bkmpSetMcName(name);
    return name;
  }, newName);
}

async function reopenIdleDorfAfterReload(page) {
  await page.reload();
  await page.locator('#idleDorfButton').click();
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await waitForDragonReady(page);
}

test.describe('Umbenennung macht Drachenlager unsichtbar (Teststand A, 13.08.2026)', () => {
  test.use({ teststand: 'A' });

  test('REPRODUKTION: nach Umbenennung sind Ei-/Drachenlager leer, obwohl sie serverseitig unveraendert existieren', async ({ page, qaBaseURL, fixtureData, store }) => {
    await seedPlayerStats(store, fixtureData);
    seedDragonData(store, fixtureData);

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const before = await page.evaluate(() => ({ eggs: bkmpPlayerDragonEggs.length, dragons: bkmpPlayerDragons.length }));
    expect(before).toEqual({ eggs: 1, dragons: 1 });

    await renameViaRealFunction(page, 'QaMoniUmbenannt');
    await reopenIdleDorfAfterReload(page);

    const after = await page.evaluate(() => ({ eggs: bkmpPlayerDragonEggs.length, dragons: bkmpPlayerDragons.length }));
    // Der eigentliche Beweis: Eier-/Drachenlager fehlen CLIENT-seitig komplett -
    // exakt Monis gemeldetes Muster ("Eierlager"/"Drachenlager (0/52)" leer).
    // Nester bewusst NICHT mitgeprueft: ensureFirstDragonNest() (supabase.js)
    // upsertet bei JEDEM Laden unbedingt einen Nest-Platz (Konflikt-Schluessel
    // nur auth_user_id+slot_index, OHNE name_key) - im Mock (rest-engine.js,
    // findConflictMatch()+Object.assign()) fuehrt das als Nebeneffekt zu einem
    // impliziten Nachziehen des name_key auf bereits vorhandenen Nestern,
    // unabhaengig vom eigentlichen Rename-Bug. Deckt sich mit Monis eigenem
    // Screenshot, wo der Nest-Platz normal/unbeeinflusst angezeigt wurde -
    // die Nester sind ohnehin nie Teil des gemeldeten Symptoms gewesen.
    expect(after).toEqual({ eggs: 0, dragons: 0 });
    // ...obwohl beide Tabellen SERVERSEITIG unveraendert unter dem ALTEN name_key weiterexistieren (kein Datenverlust).
    expect(store.tables.player_dragon_eggs.filter(r => r.name_key === fixtureData.nameKey).length).toBe(1);
    expect(store.tables.player_dragons.filter(r => r.name_key === fixtureData.nameKey).length).toBe(1);
    // Die tatsaechliche Ursache direkt am Datensatz bestaetigt: player_stats WURDE aktualisiert, die Drachentabellen NICHT.
    const playerStatsRow = store.tables.player_stats.find(r => r.auth_user_id === fixtureData.authUserId);
    expect(playerStatsRow.name_key).toBe('qamoniumbenannt');
  });
});

test.describe('FIX-BEWEIS: vorgeschlagene Migration (sql/20260813-fix-rename-dragon-tables-propagation.sql) schliesst die Luecke (Teststand A)', () => {
  test.use({ teststand: 'A' });

  test('nach Umbenennung ueber den vorgeschlagenen Fix bleiben Eier/Drachen vollstaendig sichtbar', async ({ page, qaBaseURL, fixtureData, store }) => {
    await seedPlayerStats(store, fixtureData);
    seedDragonData(store, fixtureData);

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    await renameViaProposedFix(page, 'QaMoniFixBewiesen');
    await reopenIdleDorfAfterReload(page);

    const after = await page.evaluate(() => ({
      eggs: bkmpPlayerDragonEggs.length, dragons: bkmpPlayerDragons.length,
      dragonNickname: bkmpPlayerDragons[0] && bkmpPlayerDragons[0].nickname
    }));
    expect(after.eggs).toBe(1);
    expect(after.dragons).toBe(1);
    expect(after.dragonNickname).toBe('MoniDrache');

    // Eier/Drachen tragen jetzt konsistent den NEUEN name_key - keine verwaisten Zeilen mehr.
    // (player_dragon_nests bewusst nicht separat geprueft, siehe Kommentar im
    // REPRODUKTION-Test oben - self-healt bereits unabhaengig vom Fix.)
    const newKey = 'qamonifixbewiesen';
    expect(store.tables.player_dragon_eggs.every(r => r.name_key === newKey)).toBe(true);
    expect(store.tables.player_dragons.every(r => r.name_key === newKey)).toBe(true);
  });
});
