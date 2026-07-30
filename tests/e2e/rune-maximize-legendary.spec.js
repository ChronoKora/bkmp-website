const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Spieler-Idee BagonTr01 (30.07.2026, Feedback-Board): "mehrere Legendäre
   Runen gleichzeitig auf +15 maximieren" statt jede einzeln durchzuklicken -
   nach einer AFK-Phase kann das laut Spieler "teilweise ne Stunde" dauern.

   Neuer manueller Sammel-Button "⚡ Auf +15 maximieren (N)" im Runen-Lager
   (bkmpRuneMaximizeLegendarySlot(), js/systems/bkmp-runes.js) - ruft fuer
   jede unausgeruestete Legendaere des aktuell offenen Ruestungsplatzes die
   bereits bestehende, produktiv genutzte bkmpRuneInstantUpgrade() auf (keine
   zweite Kopie der Kosten-/Fehlschlag-/Substat-Formeln). Fetcht bewusst
   frisch vom Server (bkmpGetStoredMeltableRunes, gleiches Prinzip wie
   Auto-Schmelzen/Lager-aufraeumen) statt aus dem potenziell auf 300 Zeilen
   gekappten lokalen Bestand - siehe letzter Test unten fuer den Beweis. */

// Alle Tests dieser Datei navigieren ueber echte Desktop-Tab-Buttons (#idleTabBtnRunen,
// .idle-runen-slot-tab) - auf mobile-small/mobile-large sind diese per kompakter Navigation
// versteckt/verschoben (siehe Phase 7.0-7.3), Klicks wuerden dort nur mit Timeout scheitern.
// Gleiches, bereits etabliertes Muster wie in rune-autofuse-datasource.spec.js.
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop-only Navigation (#idleTabBtnRunen) - siehe Kommentar am Dateianfang.');
});

function forceRuneUpgradeAlwaysSucceed(page) {
  // bkmpIdleRuneUpgradeFailChance() ist max. 0.30 (siehe bkmp-runes.js) - 0.99 garantiert Erfolg.
  return page.addInitScript(() => { window.Math.random = () => 0.99; });
}

function makeGoldRune(idPrefix, i, fixtureData, runeType, opts) {
  return {
    id: `qa-rune-${idPrefix}-${i}`, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId,
    rune_type: runeType, rarity: 'gold', rolled_value: 8, equipped: (opts && opts.equipped) || false,
    upgrade_level: (opts && opts.level) || 0, substats: [], created_at: fixtureData.nowIso
  };
}

async function setHighGold(page) {
  await page.evaluate(() => { bkmpIdleState.gold = 5000000; });
}

test.describe('Auf +15 maximieren - Basisverhalten (Teststand A, frischer Spieler)', () => {
  test.use({ teststand: 'A' });

  test('Anzeige zeigt exakt die unausgerüsteten, nicht-maximalen Legendären des aktuellen Rüstungsplatzes', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.idle_player_runes.push(makeGoldRune('count-unmaxed', 0, fixtureData, 'slot3', { level: 3 }));
    store.tables.idle_player_runes.push(makeGoldRune('count-unmaxed', 1, fixtureData, 'slot3', { level: 7 }));
    store.tables.idle_player_runes.push(makeGoldRune('count-maxed', 0, fixtureData, 'slot3', { level: 15 })); // bereits maximal - zaehlt nicht mit
    store.tables.idle_player_runes.push(makeGoldRune('count-equipped', 0, fixtureData, 'slot3', { level: 2, equipped: true })); // ausgeruestet - zaehlt nicht mit

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot3"]').click();

    await expect(page.locator('#idleRuneMaximizeLegiBtn')).toContainText('Auf +15 maximieren (2)');
    await expect(page.locator('#idleRuneMaximizeLegiBtn')).toBeEnabled();
  });

  test('Klick wertet alle passenden Legendären bis +15 auf (ausreichend Gold vorausgesetzt)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await forceRuneUpgradeAlwaysSucceed(page);
    store.tables.idle_player_runes.push(makeGoldRune('maxall', 0, fixtureData, 'slot4', { level: 0 }));
    store.tables.idle_player_runes.push(makeGoldRune('maxall', 1, fixtureData, 'slot4', { level: 9 }));

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await setHighGold(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot4"]').click();
    await expect(page.locator('#idleRuneMaximizeLegiBtn')).toContainText('Auf +15 maximieren (2)');

    await page.locator('#idleRuneMaximizeLegiBtn').click();
    await page.waitForTimeout(400); // updatePlayerRuneUpgrade()-Fire-and-forget-Aufrufe abwarten

    const levelA = await page.evaluate(() => bkmpIdlePlayerRunes.find(r => r.id === 'qa-rune-maxall-0').upgrade_level);
    const levelB = await page.evaluate(() => bkmpIdlePlayerRunes.find(r => r.id === 'qa-rune-maxall-1').upgrade_level);
    expect(levelA).toBe(15);
    expect(levelB).toBe(15);
    // Button-Anzeige aktualisiert sich sofort auf 0, da beide jetzt maximal sind.
    await expect(page.locator('#idleRuneMaximizeLegiBtn')).toContainText('Auf +15 maximieren (0)');
    await expect(page.locator('#idleRuneMaximizeLegiBtn')).toBeDisabled();
  });

  test('Ausgerüstete Legendäre wird vom Sammel-Klick nicht angetastet', async ({ page, qaBaseURL, fixtureData, store }) => {
    await forceRuneUpgradeAlwaysSucceed(page);
    store.tables.idle_player_runes.push(makeGoldRune('eq-untouched', 0, fixtureData, 'slot5', { level: 4, equipped: true }));
    store.tables.idle_player_runes.push(makeGoldRune('eq-untouched-lager', 0, fixtureData, 'slot5', { level: 0 }));

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await setHighGold(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot5"]').click();
    await expect(page.locator('#idleRuneMaximizeLegiBtn')).toContainText('Auf +15 maximieren (1)'); // nur die unausgeruestete

    await page.locator('#idleRuneMaximizeLegiBtn').click();
    await page.waitForTimeout(400);

    const equippedLevel = await page.evaluate(() => bkmpIdlePlayerRunes.find(r => r.id === 'qa-rune-eq-untouched-0').upgrade_level);
    const lagerLevel = await page.evaluate(() => bkmpIdlePlayerRunes.find(r => r.id === 'qa-rune-eq-untouched-lager-0').upgrade_level);
    expect(equippedLevel).toBe(4); // unveraendert
    expect(lagerLevel).toBe(15); // maximiert
  });

  test('Keine passenden Legendären: Button zeigt "(0)" und ist deaktiviert, keine Serveroperation', async ({ page, qaBaseURL, fixtureData, store }) => {
    const totalBefore = store.tables.idle_player_runes.length;
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot6"]').click();
    await expect(page.locator('#idleRuneMaximizeLegiBtn')).toContainText('Auf +15 maximieren (0)');
    await expect(page.locator('#idleRuneMaximizeLegiBtn')).toBeDisabled();
    expect(store.tables.idle_player_runes.length).toBe(totalBefore);
  });
});

test.describe('Auf +15 maximieren und grosses Lager (Regressionsbeweis, Teststand E)', () => {
  test.use({ teststand: 'E' });

  test('Findet und maximiert Legendäre auch dann, wenn der lokale 300er-Cache sie ausschließen würde', async ({ page, qaBaseURL, fixtureData, store }) => {
    await forceRuneUpgradeAlwaysSucceed(page);
    // Teststand E hat bereits 294 gray/+0 ueber alle 6 Slots verteilt. Zusaetzlich 305 HOCH
    // aufgewertete Runen (mehr als der 300er-Cache selbst fasst) in einem ANDEREN Slot (slot1),
    // damit der wertabsteigende Cache (upgrade_level DESC) den Cap allein schon fuellt und
    // unsere frischen, nur niedrigstufigen Legendaeren (slot2, Stufe 1/5) GARANTIERT verdraengt -
    // identisches Beweismuster wie rune-autofuse-datasource.spec.js, nur mit genug Konkurrenz,
    // damit unsere zwei Kandidaten (anders als dort simple 9x +0-Runen) sicher rausfallen.
    for (let i = 0; i < 305; i++) {
      store.tables.idle_player_runes.push({
        id: `qa-rune-highvalue2-${i}`, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId,
        rune_type: 'slot1', rarity: 'purple', rolled_value: 20, equipped: false, upgrade_level: 13, substats: [], created_at: fixtureData.nowIso
      });
    }
    store.tables.idle_player_runes.push(makeGoldRune('cap-bypass', 0, fixtureData, 'slot2', { level: 1 }));
    store.tables.idle_player_runes.push(makeGoldRune('cap-bypass', 1, fixtureData, 'slot2', { level: 5 }));

    const totalUnequipped = store.tables.idle_player_runes.filter(r => !r.equipped).length;
    expect(totalUnequipped).toBeGreaterThan(300); // 294 + 305 + 2 = 601 - der lokale Cache (Limit 300) MUSS etwas ausschliessen.

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await setHighGold(page);

    // Beweis, dass unsere 2 namentlich bekannten (nur Stufe 1/5) Legendaeren GARANTIERT nicht im
    // lokalen, gekappten Bestand landen - die 305 hoeherstufigen (Stufe 13) Konkurrenten fuellen den
    // 300er-Cap bereits allein komplett (sonst waere dieser Test kein echter Beweis fuer den Fix).
    const knownIds = ['qa-rune-cap-bypass-0', 'qa-rune-cap-bypass-1'];
    const localFound = await page.evaluate((ids) => bkmpIdlePlayerRunes.filter(r => ids.includes(r.id)).length, knownIds);
    expect(localFound).toBe(0);

    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot2"]').click();
    // Die Anzeige "(N)" ist (wie bei Auto-Schmelzen/Auto-Aufstieg, siehe deren Kommentare) nur ein
    // lokaler, synchroner Schaetzwert und zeigt hier erwartungsgemaess "(0)"/deaktiviert, da beide
    // Kandidaten lokal nicht sichtbar sind - identisches, bereits akzeptiertes Verhalten wie beim
    // Schwester-Feature. Die eigentliche Funktion selbst holt trotzdem frisch vom Server nach, direkt
    // aufgerufen statt per (hier absichtlich deaktiviertem) Button-Klick - identisches Testmuster wie
    // rune-autofuse-datasource.spec.js's Cap-Bypass-Beweis.
    await expect(page.locator('#idleRuneMaximizeLegiBtn')).toContainText('Auf +15 maximieren (0)');
    await expect(page.locator('#idleRuneMaximizeLegiBtn')).toBeDisabled();
    await page.evaluate(() => window.bkmpRuneMaximizeLegendarySlot());
    await page.waitForTimeout(500);

    // GENAU DAS ist der eigentliche Fix-Beweis: trotz gekapptem lokalem Bestand findet die echte
    // Funktion (frischer Serverabruf) beide Legendaeren und wertet sie vollstaendig auf +15 auf.
    const levelA = store.tables.idle_player_runes.find(r => r.id === 'qa-rune-cap-bypass-0').upgrade_level;
    const levelB = store.tables.idle_player_runes.find(r => r.id === 'qa-rune-cap-bypass-1').upgrade_level;
    expect(levelA).toBe(15);
    expect(levelB).toBe(15);
  });
});
