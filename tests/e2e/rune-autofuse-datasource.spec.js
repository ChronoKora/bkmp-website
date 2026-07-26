const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Dringender, gezielter Bugfix (26.07.2026, Spieler-Meldung "Auto-Schmelzen
   erkennt Runen im Schildrunen-Lager nicht, zeigt 0 an - 'Lager aufräumen'
   findet dieselben Runen aber problemlos").

   Root Cause (bewiesen durch Code-Lesen, nicht geraten): bkmpRuneAutoFuseAll()
   (Auto-Schmelzen) filterte bisher AUSSCHLIESSLICH aus dem LOKALEN
   bkmpIdlePlayerRunes - seit dem 25.07.-Ladefix (siehe idledorf.js) ist der
   UNAUSGERUESTETE Teil davon auf die 300 wertvollsten Zeilen gekappt,
   sortiert nach upgrade_level/rolled_value ABSTEIGEND. Auto-Schmelzen darf
   aber laut Spielregel (Feedback 14.07., "keine Runen mit +1/+2/+3
   verschmelzen") NUR echte +0-Runen verwenden - GENAU die werden vom
   wertabsteigenden Sortieren als LETZTES einsortiert und bei einem Spieler
   mit vielen woanders hochgestuften Runen aus den 300 gekappten Zeilen
   verdraengt. bkmpRuneSellAllByRarity() ("Lager aufräumen", ebenfalls
   26.07.) hatte das Problem nie, weil es von Anfang an frisch vom Server
   las statt aus dem gekappten lokalen Bestand.

   Fix: neue gemeinsame bkmpGetStoredMeltableRunes(filters) (bkmp-runes.js) +
   loadStoredRunes() (supabase.js, ersetzt loadRunesForBulkSellByRarity) -
   IMMER frischer Serverabruf, von BEIDEN Funktionen genutzt. bkmpRuneFuse()
   sucht Runen weiterhin ueber _cid in bkmpIdlePlayerRunes - frisch gefundene
   Kandidaten werden deshalb vor dem Verschmelzen in den lokalen Bestand
   eingemischt. */

// Alle Tests dieser Datei navigieren ueber echte Desktop-Tab-Buttons (#idleTabBtnRunen,
// .idle-runen-slot-tab) - auf mobile-small/mobile-large sind diese per kompakter Navigation
// versteckt/verschoben (siehe Phase 7.0-7.3), Klicks wuerden dort nur mit Timeout scheitern.
// Gleiches, bereits etabliertes Muster wie in buttons-inventory/dungeon-time/navigation/
// prestige/runes/save-load.spec.js (Phase 2) - dieser Bugfix-Test ist bewusst Desktop-fokussiert,
// eine Mobile-Variante der Runen-Navigation wird bereits anderswo (runes.spec.js) abgedeckt.
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop-only Navigation (#idleTabBtnRunen) - siehe Kommentar am Dateianfang.');
});

function forceRuneFuseAlwaysSucceed(page) {
  // BKMP_RUNE_FUSE_FAIL_CHANCE (gray..purple) ist ein echtes Math.random()-Risiko -
  // fuer deterministische Exakt-Zahlen-Tests immer "Erfolg" erzwingen (0.99 > jede Fail-Chance).
  return page.addInitScript(() => { window.Math.random = () => 0.99; });
}

function makeGrayRune(idPrefix, i, fixtureData, runeType, upgradeLevel) {
  return {
    id: `qa-rune-${idPrefix}-${i}`, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId,
    rune_type: runeType, rarity: 'gray', rolled_value: 5, equipped: false,
    upgrade_level: upgradeLevel || 0, substats: [], created_at: fixtureData.nowIso
  };
}

test.describe('Auto-Schmelzen - Basisverhalten (Teststand C, kein grosses Lager)', () => {
  test.use({ teststand: 'C' });

  test('Lager mit gewoehnlichen +0-Runen: Auto-Schmelzen erkennt sie, Anzeige stimmt exakt', async ({ page, qaBaseURL, fixtureData, store }) => {
    await forceRuneFuseAlwaysSucceed(page);
    for (let i = 0; i < 6; i++) store.tables.idle_player_runes.push(makeGrayRune('basic', i, fixtureData, 'slot2'));
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot2"]').click();
    await expect(page.locator('#idleRuneAutoFuseBtn')).toContainText('Auto-Schmelzen (2)'); // 6 gray -> 2 Dreiergruppen
    await expect(page.locator('#idleRuneAutoFuseBtn')).toBeEnabled();
  });

  test('Mehrere Raritaeten gleichzeitig werden korrekt gruppiert', async ({ page, qaBaseURL, fixtureData, store }) => {
    await forceRuneFuseAlwaysSucceed(page);
    for (let i = 0; i < 3; i++) store.tables.idle_player_runes.push(makeGrayRune('multi-gray', i, fixtureData, 'slot2'));
    for (let i = 0; i < 3; i++) {
      const r = makeGrayRune('multi-green', i, fixtureData, 'slot2');
      r.rarity = 'green';
      store.tables.idle_player_runes.push(r);
    }
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot2"]').click();
    await expect(page.locator('#idleRuneAutoFuseBtn')).toContainText('Auto-Schmelzen (2)'); // 1 gray-Gruppe + 1 green-Gruppe

    const evalPromise = page.evaluate(() => window.bkmpRuneAutoFuseAll());
    await expect(page.locator('#bkmpConfirmOverlay')).toHaveClass(/visible/, { timeout: 10000 });
    await expect(page.locator('#bkmpConfirmBody')).toContainText('1× Gewöhnlich');
    await expect(page.locator('#bkmpConfirmBody')).toContainText('1× Ungewöhnlich');
    await page.locator('#bkmpConfirmOkBtn').click();
    await evalPromise;

    // Praezise, ID-basiert statt per Gesamtzahl (Teststand C hat pro Slot bereits eigene Spar-Runen,
    // siehe teststands.js - eine rohe Rarity-Gesamtzahl waere dadurch kontaminiert). Die urspruenglich
    // gesaeten 3 gray + 3 green (per bekanntem ID-Praefix) muessen vollstaendig verbraucht sein.
    const grayIds = Array.from({ length: 3 }, (_, i) => `qa-rune-multi-gray-${i}`);
    const greenIds = Array.from({ length: 3 }, (_, i) => `qa-rune-multi-green-${i}`);
    const grayStillThere = store.tables.idle_player_runes.filter(r => grayIds.includes(r.id));
    const greenStillThere = store.tables.idle_player_runes.filter(r => greenIds.includes(r.id));
    expect(grayStillThere.length).toBe(0);
    expect(greenStillThere.length).toBe(0);
  });

  test('Abbrechen im Bestaetigungsdialog veraendert nichts', async ({ page, qaBaseURL, fixtureData, store }) => {
    for (let i = 0; i < 3; i++) store.tables.idle_player_runes.push(makeGrayRune('cancel-test', i, fixtureData, 'slot2'));
    const totalBefore = store.tables.idle_player_runes.length;
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot2"]').click();

    const evalPromise = page.evaluate(() => window.bkmpRuneAutoFuseAll());
    await expect(page.locator('#bkmpConfirmOverlay')).toHaveClass(/visible/, { timeout: 10000 });
    await page.locator('#bkmpConfirmCancelBtn').click();
    await evalPromise;

    expect(store.tables.idle_player_runes.length).toBe(totalBefore);
  });

  test('Kein schmelzbares Paar vorhanden: Button zeigt "(0)" und ist deaktiviert, keine Serveroperation', async ({ page, qaBaseURL, fixtureData, store }) => {
    // Nur 2 (nicht durch 3 teilbar) - keine vollstaendige Gruppe.
    for (let i = 0; i < 2; i++) store.tables.idle_player_runes.push(makeGrayRune('nogroup', i, fixtureData, 'slot2'));
    const totalBefore = store.tables.idle_player_runes.length;
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot2"]').click();
    await expect(page.locator('#idleRuneAutoFuseBtn')).toContainText('Auto-Schmelzen (0)');
    await expect(page.locator('#idleRuneAutoFuseBtn')).toBeDisabled();
    expect(store.tables.idle_player_runes.length).toBe(totalBefore);
  });

  test('Reload nach dem Schmelzen: Ergebnis bleibt bestehen', async ({ page, qaBaseURL, fixtureData, store }) => {
    await forceRuneFuseAlwaysSucceed(page);
    for (let i = 0; i < 3; i++) store.tables.idle_player_runes.push(makeGrayRune('reload-test', i, fixtureData, 'slot2'));
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot2"]').click();

    const evalPromise = page.evaluate(() => window.bkmpRuneAutoFuseAll());
    await expect(page.locator('#bkmpConfirmOverlay')).toHaveClass(/visible/, { timeout: 10000 });
    await page.locator('#bkmpConfirmOkBtn').click();
    await evalPromise;
    await page.waitForTimeout(300); // insertPlayerRunes()-Antwort (id der neuen Rune) abwarten

    await page.reload();
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);

    const grayLeft = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.rune_type === 'slot2' && r.rarity === 'gray' && !r.equipped).length);
    const greenGained = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.rune_type === 'slot2' && r.rarity === 'green' && !r.equipped).length);
    expect(grayLeft).toBe(0);
    expect(greenGained).toBe(1);
  });
});

test.describe('Auto-Schmelzen - Ausgeruestete Rune (Teststand A, frischer Spieler)', () => {
  // Bewusst NICHT Teststand C: dort ist pro Slot bereits eine echte ausgeruestete Rune vorhanden
  // (siehe teststands.js) - eine zweite, kollidierende hier wuerde bkmpRuneNormalizeDuplicateEquips()
  // beim Laden automatisch wieder unausgeruestet zuruecksetzen und den Test verfaelschen.
  test.use({ teststand: 'A' });

  test('Ausgeruestete Rune wird von Auto-Schmelzen ausgeschlossen', async ({ page, qaBaseURL, fixtureData, store }) => {
    await forceRuneFuseAlwaysSucceed(page);
    for (let i = 0; i < 3; i++) store.tables.idle_player_runes.push(makeGrayRune('eq-test', i, fixtureData, 'slot2'));
    const equipped = makeGrayRune('eq-test-equipped', 0, fixtureData, 'slot2');
    equipped.equipped = true;
    store.tables.idle_player_runes.push(equipped);

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot2"]').click();
    await expect(page.locator('#idleRuneAutoFuseBtn')).toContainText('Auto-Schmelzen (1)'); // nur die 3 unausgeruesteten, nicht die 4.

    const evalPromise = page.evaluate(() => window.bkmpRuneAutoFuseAll());
    await expect(page.locator('#bkmpConfirmOverlay')).toHaveClass(/visible/, { timeout: 10000 });
    await page.locator('#bkmpConfirmOkBtn').click();
    await evalPromise;

    // Die ausgeruestete Rune ueberlebt unangetastet.
    const equippedStillThere = store.tables.idle_player_runes.some(r => r.id === equipped.id && r.equipped);
    expect(equippedStillThere).toBe(true);
  });
});

test.describe('Auto-Schmelzen und Lager-aufraeumen teilen denselben Bestand (Regressionsbeweis, grosses Lager)', () => {
  test.use({ teststand: 'E' });

  test('Auto-Schmelzen findet +0-Schildrunen auch dann, wenn sie aus dem lokalen 300er-Cache verdraengt wuerden', async ({ page, qaBaseURL, fixtureData, store }) => {
    await forceRuneFuseAlwaysSucceed(page);
    // Teststand E hat schon 294 gray/+0 unequipped ueber alle 6 Slots verteilt (siehe teststands.js).
    // Zusaetzlich 50 HOCH aufgewertete Runen in einem ANDEREN Slot (slot1), damit der wertabsteigende
    // 300er-Cache (upgrade_level DESC) diese zuerst nimmt und die frischen Schildrunen (slot2) verdraengt.
    for (let i = 0; i < 50; i++) {
      store.tables.idle_player_runes.push({
        id: `qa-rune-highvalue-${i}`, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId,
        rune_type: 'slot1', rarity: 'purple', rolled_value: 20, equipped: false, upgrade_level: 12, substats: [], created_at: fixtureData.nowIso
      });
    }
    // Exakt 9 frische +0-Schildrunen (slot2, gray) - genug fuer 3 Dreiergruppen, klar identifizierbar.
    for (let i = 0; i < 9; i++) store.tables.idle_player_runes.push(makeGrayRune('shield-fresh', i, fixtureData, 'slot2'));

    const totalUnequipped = store.tables.idle_player_runes.filter(r => !r.equipped).length;
    expect(totalUnequipped).toBeGreaterThan(300); // 294 + 50 + 9 = 353 - der lokale Cache (Limit 300) MUSS etwas ausschliessen.

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    // Beweis, dass der lokale, gekappte Bestand MINDESTENS EINE der 9 namentlich bekannten frischen
    // Schildrunen tatsaechlich NICHT enthaelt (sonst waere dieser Test kein echter Beweis fuer den
    // Fix, nur Zufall - die exakte Anzahl haengt vom Sortier-Gleichstand mit Teststand E's eigenen
    // 294 Runen ab und ist deshalb bewusst NICHT hart vorhergesagt, nur "mindestens eine fehlt").
    const knownShieldFreshIds = Array.from({ length: 9 }, (_, i) => `qa-rune-shield-fresh-${i}`);
    const localShieldFreshIds = await page.evaluate((ids) =>
      bkmpIdlePlayerRunes.filter(r => ids.includes(r.id)).map(r => r.id), knownShieldFreshIds
    );
    expect(localShieldFreshIds.length).toBeLessThan(9);

    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot2"]').click();

    // GENAU DAS ist der eigentliche Fix-Beweis: trotz gekapptem lokalem Bestand findet der echte
    // Klick-Handler (frischer Serverabruf) alle 9 Schildrunen und verschmilzt sie vollstaendig.
    // Teststand E hat selbst schon ~49 gray/+0-Runen in slot2 (294 gleichmaessig ueber 6 Slots verteilt) -
    // die Gesamtzahl im Bestaetigungsdialog ist deshalb bewusst NICHT exakt vorhergesagt (haengt von der
    // internen Verteilung ab), nur dass ueberhaupt eine "Gewöhnlich"-Gruppe angezeigt wird.
    const evalPromise = page.evaluate(() => window.bkmpRuneAutoFuseAll());
    await expect(page.locator('#bkmpConfirmOverlay')).toHaveClass(/visible/, { timeout: 10000 });
    await expect(page.locator('#bkmpConfirmBody')).toContainText('Gewöhnlich');
    await page.locator('#bkmpConfirmOkBtn').click();
    await evalPromise;

    // Praezise, ID-basierte Pruefung statt Gesamtzahl (die durch Teststand E's eigene 294 Runen
    // kontaminiert waere): so gut wie ALLE 9 NAMENTLICH BEKANNTEN frischen Schildrunen sind weg.
    // Rechnung: Teststand E saet exakt 49 gray/+0-Runen in slot2 (294 gleichmaessig ueber 6 Slots,
    // siehe teststands.js), + unsere 9 = 58 - nicht durch 3 teilbar (58 = 19*3 + 1), es bleibt also
    // IMMER genau 1 gray/+0-Rune irgendeines der 58 Kandidaten uebrig (unvermeidbarer Rest einer
    // Dreiergruppierung, kein Bug) - welche der 58 das trifft, haengt von der Ladereihenfolge ab,
    // "hoechstens 1 von unseren 9" ist deshalb die korrekte, deterministische Erwartung.
    const shieldFreshStillThere = store.tables.idle_player_runes.filter(r => knownShieldFreshIds.includes(r.id));
    expect(shieldFreshStillThere.length).toBeLessThanOrEqual(1);
  });

  test('Auto-Schmelzen und Lager-aufraeumen sehen denselben Bestand (identischer Serverabruf)', async ({ page, qaBaseURL, fixtureData, store }) => {
    for (let i = 0; i < 12; i++) store.tables.idle_player_runes.push(makeGrayRune('shared-source', i, fixtureData, 'slot2'));
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const viaAutoFuseSource = await page.evaluate(() => window.bkmpGetStoredMeltableRunes({ runeType: 'slot2', upgradeLevelZeroOnly: true }));
    const viaCleanupSource = await page.evaluate(() => window.bkmpGetStoredMeltableRunes({ rarity: 'gray' }));
    const shieldGrayFromCleanup = viaCleanupSource.filter(r => r.rune_type === 'slot2');

    // Beide Aufrufer-Pfade muessen exakt dieselben 12 (+ die 294 aus Teststand E fuer andere Slots beim
    // zweiten Aufruf, deshalb hier gezielt auf slot2 gefiltert) frisch gedroppten Schildrunen finden.
    expect(viaAutoFuseSource.length).toBeGreaterThanOrEqual(12);
    expect(shieldGrayFromCleanup.length).toBeGreaterThanOrEqual(12);
    const autoFuseIds = new Set(viaAutoFuseSource.map(r => r.id));
    const cleanupIds = new Set(shieldGrayFromCleanup.map(r => r.id));
    for (const id of autoFuseIds) expect(cleanupIds.has(id)).toBe(true);
  });
});
