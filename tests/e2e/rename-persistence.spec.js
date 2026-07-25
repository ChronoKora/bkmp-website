const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Dringender Bugfix-Auftrag 25.07.2026 (Nutzerbericht: "Meine Runen sind
   komplett weg. Das waren teilweise schon Level-22- und Level-23-Runen.").

   ROOT CAUSE (per Quellcode-Analyse bewiesen, nicht geraten): rename_player_
   account() (aktuelle/massgebliche Fassung: sql/supabase-player-name-
   blocklist.sql, "create or replace function" ueber v2/v3) aktualisiert
   name_key in player_stats/idle_player_state/user_plushies/auth.users - aber
   NICHT in idle_player_runes, idle_prestige_state und idle_player_village_
   skins. Alle drei laden strikt gefiltert nach name_key (supabase.js:
   loadPlayerRunes/loadIdlePrestigeState/loadPlayerVillageSkins, jeweils nur
   `.eq('name_key', ...)`, kein auth_user_id-Fallback). Nach einer Namens-
   aenderung zeigt der naechste Ladevorgang (Reload/erneutes Oeffnen) diese
   drei Systeme deshalb leer an, obwohl die Zeilen in der DB unveraendert
   unter dem ALTEN name_key weiterexistieren - Kategorie 1 aus dem
   Nutzerauftrag ("Runen existieren serverseitig noch, werden aber nicht
   angezeigt"), KEIN echter Datenverlust.

   tests/mock/rpc-engine.js's rename_player_account-Port (renamePlayerAccount-
   CurrentBuggyBehavior) bildet exakt diese reale Luecke nach (1:1 aus der
   aktuellen SQL-Fassung), damit dieser Test denselben Codepfad wie ein
   echter Spieler durchlaeuft, nicht eine zweite geratene Kopie. */

async function seedPlayerStats(store, fixtureData) {
  store.tables.player_stats = store.tables.player_stats || [];
  store.tables.player_stats.push({
    auth_user_id: fixtureData.authUserId, name_key: fixtureData.nameKey, display_name: fixtureData.displayName,
    last_name_change_at: null
  });
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
   echte Produktions-DB ausgefuehrte Migration (sql/20260725-fix-rename-
   name-key-propagation.sql) nachbildet - beweist, dass der Fix die Luecke
   tatsaechlich schliesst, bevor der Nutzer ihn live ausfuehrt. */
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

test.describe('Bug 1 - Namensaenderung macht Runen/Prestige/Dorf-Skins unsichtbar (Teststand C)', () => {
  test.use({ teststand: 'C' });

  test('REPRODUKTION: nach Umbenennung sind die 6 ausgeruesteten Runen (inkl. Level-22/23-Aufstiegsstufen) verschwunden, obwohl sie serverseitig unveraendert existieren', async ({ page, qaBaseURL, fixtureData, store }) => {
    await seedPlayerStats(store, fixtureData);
    // Zwei Runen auf Level 22/23 angehoben (Aufstieg ueber +15 hinaus, siehe BKMP_RUNE_ASCEND_MAX_LEVEL=30) - exakt der vom Nutzer gemeldete Zustand.
    const runesBefore = store.tables.idle_player_runes;
    runesBefore[0].upgrade_level = 22;
    runesBefore[1].upgrade_level = 23;

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const before = await page.evaluate(() => bkmpIdlePlayerRunes.length);
    expect(before).toBe(runesBefore.length);

    await renameViaRealFunction(page, 'QaUmbenanntC');
    await reopenIdleDorfAfterReload(page);

    const after = await page.evaluate(() => bkmpIdlePlayerRunes.length);
    // Der eigentliche Beweis: Runen fehlen CLIENT-seitig...
    expect(after).toBe(0);
    // ...obwohl sie SERVERSEITIG unveraendert unter dem ALTEN name_key weiterexistieren (kein Datenverlust, reiner Anzeige-/Filterfehler).
    const stillOnServer = store.tables.idle_player_runes.filter(r => r.name_key === fixtureData.nameKey);
    expect(stillOnServer.length).toBe(runesBefore.length);
    expect(stillOnServer.some(r => r.upgrade_level === 22)).toBe(true);
    expect(stillOnServer.some(r => r.upgrade_level === 23)).toBe(true);
    // Die tatsaechliche Ursache direkt am Datensatz bestaetigt: idle_player_runes.name_key wurde vom Rename NICHT mitgezogen.
    const playerStatsRow = store.tables.player_stats.find(r => r.auth_user_id === fixtureData.authUserId);
    expect(playerStatsRow.name_key).toBe('qaumbenanntc'); // player_stats WURDE aktualisiert...
    expect(stillOnServer.every(r => r.name_key === fixtureData.nameKey)).toBe(true); // ...idle_player_runes NICHT.
  });

  test('REPRODUKTION: Prestige-Stand nach Umbenennung ebenfalls unsichtbar (dieselbe Ursache, dieselbe Luecke)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await seedPlayerStats(store, fixtureData);
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const beforeLevel = await page.evaluate(() => bkmpPrestigeState && bkmpPrestigeState.prestige_level);
    expect(beforeLevel).toBe(6); // Teststand C startet mit prestige_level 6

    await renameViaRealFunction(page, 'QaUmbenanntC2');
    await reopenIdleDorfAfterReload(page);

    // idledorf.js:266 faellt bei leerem Ladeergebnis NICHT auf null zurueck, sondern auf ein FRISCHES
    // Default-Objekt (prestige_level:0) - fuer den Spieler sieht das wie ein kompletter Prestige-Reset
    // aus, nicht nur wie "kurz nicht geladen". Kein echter Absturz, aber eine irrefuehrende Anzeige.
    const afterState = await page.evaluate(() => bkmpPrestigeState);
    expect(afterState).toBeTruthy();
    expect(afterState.prestige_level).toBe(0);
    const stillOnServer = store.tables.idle_prestige_state.find(r => r.name_key === fixtureData.nameKey);
    expect(stillOnServer).toBeTruthy();
    expect(stillOnServer.prestige_level).toBe(6);
  });

  test('REPRODUKTION: Dorf-Skin-Besitz nach Umbenennung ebenfalls unsichtbar (dieselbe Ursache, dieselbe Luecke)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await seedPlayerStats(store, fixtureData);
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(async () => {
      await unlockPlayerVillageSkin(bkmpIdleState.name_key, 'eisdorf');
      bkmpPlayerVillageSkins.push('eisdorf');
    });
    expect(await page.evaluate(() => bkmpPlayerVillageSkins.includes('eisdorf'))).toBe(true);

    await renameViaRealFunction(page, 'QaUmbenanntC3');
    await reopenIdleDorfAfterReload(page);

    const ownedAfter = await page.evaluate(() => bkmpPlayerVillageSkins);
    expect(ownedAfter).toEqual([]);
    const stillOnServer = store.tables.idle_player_village_skins.find(r => r.skin_id === 'eisdorf');
    expect(stillOnServer).toBeTruthy();
    expect(stillOnServer.name_key).toBe(fixtureData.nameKey);
  });
});

test.describe('Bug 1 - FIX-BEWEIS: vorgeschlagene Migration (sql/20260725-fix-rename-name-key-propagation.sql) schliesst die Luecke (Teststand C)', () => {
  test.use({ teststand: 'C' });

  test('nach Umbenennung ueber den vorgeschlagenen Fix bleiben Runen (inkl. Level 22/23), Prestige und Dorf-Skins vollstaendig sichtbar', async ({ page, qaBaseURL, fixtureData, store }) => {
    await seedPlayerStats(store, fixtureData);
    store.tables.idle_player_runes[0].upgrade_level = 22;
    store.tables.idle_player_runes[1].upgrade_level = 23;
    const runeCountBefore = store.tables.idle_player_runes.length;

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(async () => {
      await unlockPlayerVillageSkin(bkmpIdleState.name_key, 'eisdorf');
      bkmpPlayerVillageSkins.push('eisdorf');
    });
    const prestigeBefore = await page.evaluate(() => bkmpPrestigeState.prestige_level);
    expect(prestigeBefore).toBe(6);

    await renameViaProposedFix(page, 'QaFixBewiesenC');
    await reopenIdleDorfAfterReload(page);

    const runesAfter = await page.evaluate(() => bkmpIdlePlayerRunes.map(r => r.upgrade_level));
    expect(runesAfter.length).toBe(runeCountBefore);
    expect(runesAfter).toContain(22);
    expect(runesAfter).toContain(23);

    const prestigeAfter = await page.evaluate(() => bkmpPrestigeState && bkmpPrestigeState.prestige_level);
    expect(prestigeAfter).toBe(6); // NICHT mehr 0 - der Fix laedt jetzt den echten, bereits umbenannten Datensatz

    const skinsAfter = await page.evaluate(() => bkmpPlayerVillageSkins);
    expect(skinsAfter).toContain('eisdorf');

    // Alle drei Tabellen tragen jetzt konsistent den NEUEN name_key - keine verwaisten Zeilen mehr.
    const newKey = 'qafixbewiesenc';
    expect(store.tables.idle_player_runes.every(r => r.name_key === newKey)).toBe(true);
    expect(store.tables.idle_prestige_state.find(r => r.name_key === newKey)).toBeTruthy();
    expect(store.tables.idle_player_village_skins.every(r => r.name_key === newKey)).toBe(true);
  });
});
