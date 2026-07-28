const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Spieler-Bugreport (27.07.2026, ChronoKora): "Diese Automatische Runen
   Verschmelzen klappt aber nicht. Bei mir passiert nichts" - stellte sich
   nach Rueckfrage als Missverstaendnis heraus (der bestehende Prestige-
   Knoten "Automatische Runenaufwertung" ruestet nur AUSGERUESTETE Runen
   automatisch auf und hatte bei komplett auf +15 ausgeruesteten Runen
   erwartungsgemaess nichts mehr zu tun - kein Bug). Direkter Nutzerwunsch
   danach: "eine andere Variante automatische +15 upgrade Funktion von
   Legis und die Automatischer Aufstieg der legis dann mit einen On/Off
   Button im Runen System Seite. + Auto verschmelzung" - drei neue,
   eigenstaendige Hintergrund-Automatiken (Legi-Aufwertung ueber ALLE
   Legendaeren, nicht nur ausgeruestete; Auto-Aufstieg +15->+30; Auto-
   Verschmelzung), alle an den bestehenden Prestige-Knoten "Automatische
   Runenaufwertung" gekoppelt, mit eigenem lokalem On/Off-Schalter im
   Runen-Tab und einer EINMALIGEN Bestaetigung beim Einschalten (nicht pro
   Lauf - siehe BKMP_RUNE_BACKGROUND_TOGGLE_META in bkmp-runes.js).

   Alle drei Automatiken rufen ausschliesslich bereits bestehende, laengst
   getestete Aktionen auf (bkmpRuneUpgrade/bkmpRuneExecuteAscendPairs/
   bkmpRuneExecuteFuseGroups) - kein neuer Spielmechanismus, nur ein
   wiederkehrender Trigger ohne Klick. */

function setPrestigeAllocations(store, nameKey, allocations) {
  const rows = store.tables.idle_prestige_state || (store.tables.idle_prestige_state = []);
  let row = rows.find(r => r.name_key === nameKey);
  if (!row) {
    row = { name_key: nameKey, display_name: nameKey, prestige_level: 1, prestige_points: 999999, prestige_points_spent: 0, prestige_allocations: {}, updated_at: new Date().toISOString() };
    rows.push(row);
  }
  row.prestige_allocations = { ...row.prestige_allocations, ...allocations };
}

test.describe('Runen-Hintergrund-Automatik (Legi-Aufwertung/Aufstieg/Verschmelzung) - Teststand A', () => {
  test.use({ teststand: 'A' });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - mobile-smoke.spec.js deckt die kompakte Navigation ab');
  });

  test('Schalter erscheinen erst, wenn der Prestige-Knoten "Automatische Runenaufwertung" gekauft ist', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.evaluate(() => bkmpIdleRenderRunenPanel());
    await expect(page.locator('.idle-runen-bgauto-row')).toHaveCount(0);

    await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_runenaufwertung = 1;
      bkmpIdleRenderRunenPanel();
    });
    const checkboxes = page.locator('.idle-runen-bgauto-checkbox');
    await expect(checkboxes).toHaveCount(3);
  });

  test('Einschalten fragt einmalig nach - Abbrechen laesst den Schalter aus', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      window.bkmpConfirmDialog = async () => false; // simuliert "Abbrechen"
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_runenaufwertung = 1;
    });
    await page.locator('#idleTabBtnRunen').click();
    await page.evaluate(() => bkmpIdleRenderRunenPanel());

    const legiCheckbox = page.locator('.idle-runen-bgauto-checkbox[data-auto-name="legiUpgrade"]');
    await legiCheckbox.click(); // bewusst .click() statt .check() - .check() wuerde einen dauerhaft angehakten Zustand erzwingen, hier wird das Gegenteil geprueft
    await expect.poll(() => legiCheckbox.isChecked()).toBe(false);
    const stored = await page.evaluate(() => localStorage.getItem('bkmp-rune-auto-legiupgrade-enabled'));
    expect(stored).not.toBe('1');
  });

  test('Ausschalten fragt NICHT nach', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      window.bkmpConfirmDialog = async () => true;
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_runenaufwertung = 1;
    });
    await page.locator('#idleTabBtnRunen').click();
    await page.evaluate(() => bkmpIdleRenderRunenPanel());
    const fuseCheckbox = page.locator('.idle-runen-bgauto-checkbox[data-auto-name="fuse"]');
    await fuseCheckbox.check(); // on, mit Bestaetigung (gemockt: true)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bkmp-rune-auto-fuse-enabled'))).toBe('1');

    let confirmCalledForOff = false;
    await page.evaluate(() => { window.bkmpConfirmDialog = async () => { window.__confirmCalled = true; return true; }; });
    await fuseCheckbox.uncheck();
    confirmCalledForOff = await page.evaluate(() => window.__confirmCalled === true);
    expect(confirmCalledForOff).toBe(false);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bkmp-rune-auto-fuse-enabled'))).toBe('0');
  });

  test('Auto-Legi-Aufwertung wertet eine UNAUSGERÜSTETE Legendäre auf (anders als der bestehende Prestige-Knoten)', async ({ page, qaBaseURL, fixtureData, store, qaClock }) => {
    store.tables.idle_player_runes = [
      { id: 'qa-legi-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, rune_type: 'slot1', rarity: 'gold', rolled_value: 20, equipped: false, upgrade_level: 5, substats: [], created_at: fixtureData.nowIso }
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      window.bkmpConfirmDialog = async () => true;
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_runenaufwertung = 1;
      bkmpIdleState.gold = 999999999;
    });
    await page.locator('#idleTabBtnRunen').click();
    await page.evaluate(() => bkmpIdleRenderRunenPanel());
    await page.locator('.idle-runen-bgauto-checkbox[data-auto-name="legiUpgrade"]').check();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bkmp-rune-auto-legiupgrade-enabled'))).toBe('1');

    await page.evaluate(() => bkmpIdleStopLoop()); // Kampf-Loop nicht noetig, vermeidet Nebenwirkungen
    await page.evaluate(() => bkmpRuneRunBackgroundLegiUpgrade());
    const goldAfter = await page.evaluate(() => bkmpIdleState.gold);
    expect(goldAfter).toBeLessThan(999999999); // deterministischer Beweis (Aufwertungs-Fehlschlagchance existiert, Gold-Abzug nicht)
  });

  test('Auto-Aufstieg verbraucht eine zweite +15-Legendäre und laesst die andere auf +16 aufsteigen', async ({ page, qaBaseURL, fixtureData, store, qaClock }) => {
    store.tables.idle_player_runes = [
      { id: 'qa-legi-a', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, rune_type: 'slot3', rarity: 'gold', rolled_value: 25, equipped: false, upgrade_level: 15, substats: [], created_at: fixtureData.nowIso },
      { id: 'qa-legi-b', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, rune_type: 'slot3', rarity: 'gold', rolled_value: 22, equipped: false, upgrade_level: 15, substats: [], created_at: fixtureData.nowIso }
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      window.bkmpConfirmDialog = async () => true;
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_runenaufwertung = 1;
      bkmpIdleState.gold = 999999999;
    });
    await page.locator('#idleTabBtnRunen').click();
    await page.evaluate(() => bkmpIdleRenderRunenPanel());
    await page.locator('.idle-runen-bgauto-checkbox[data-auto-name="ascend"]').check();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bkmp-rune-auto-ascend-enabled'))).toBe('1');

    await page.evaluate(() => bkmpIdleStopLoop());
    await page.evaluate(() => bkmpRuneRunBackgroundAscend());
    const after = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.rune_type === 'slot3').map(r => r.upgrade_level));
    expect(after).toEqual([16]); // eine Rune ueberlebt+steigt auf +16, die andere ist verbraucht
  });

  test('Auto-Verschmelzung verarbeitet auch Slots, die gerade NICHT als Tab geoeffnet sind', async ({ page, qaBaseURL, fixtureData, store, qaClock }) => {
    // bkmpRuneActiveSlotTab startet auf 'slot1' - Runen absichtlich in
    // 'slot2' gesetzt, um zu beweisen, dass der Hintergrund-Lauf nicht vom
    // gerade offenen Tab abhaengt.
    store.tables.idle_player_runes = [
      { id: 'qa-gray-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, rune_type: 'slot2', rarity: 'gray', rolled_value: 3, equipped: false, upgrade_level: 0, substats: [], created_at: fixtureData.nowIso },
      { id: 'qa-gray-2', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, rune_type: 'slot2', rarity: 'gray', rolled_value: 3, equipped: false, upgrade_level: 0, substats: [], created_at: fixtureData.nowIso },
      { id: 'qa-gray-3', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, rune_type: 'slot2', rarity: 'gray', rolled_value: 3, equipped: false, upgrade_level: 0, substats: [], created_at: fixtureData.nowIso }
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      window.bkmpConfirmDialog = async () => true;
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_runenaufwertung = 1;
    });
    await page.locator('#idleTabBtnRunen').click();
    await page.evaluate(() => bkmpIdleRenderRunenPanel());
    expect(await page.evaluate(() => bkmpRuneActiveSlotTab)).toBe('slot1');
    await page.locator('.idle-runen-bgauto-checkbox[data-auto-name="fuse"]').check();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bkmp-rune-auto-fuse-enabled'))).toBe('1');

    await page.evaluate(() => bkmpIdleStopLoop());
    // Cursor gezielt auf slot2 setzen (Index 1) - deterministisch statt auf
    // mehrere Zufalls-Durchlaeufe ueber alle 6 Slots zu warten.
    await page.evaluate(async () => {
      bkmpRuneBackgroundFuseSlotCursor = 1;
      await bkmpRuneRunBackgroundFuse();
    });
    const remainingGray = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.rune_type === 'slot2' && r.rarity === 'gray').length);
    expect(remainingGray).toBe(0); // alle 3 Quell-Runen verbraucht (Erfolg ODER Zerstoerung - beides raeumt sie auf)
  });
});
