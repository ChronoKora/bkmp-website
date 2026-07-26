const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Direkte Fortsetzung des dringenden Bugfix-Auftrags (25.07.2026, "Meine
   Runen sind komplett weg") - nachdem die Rename-Luecke (siehe
   tests/e2e/rename-persistence.spec.js) bereits gefixt war, meldeten sich
   ZWEI WEITERE, unabhaengige Spieler (BagonTr01, Nilo3628) mit demselben
   Symptom, OHNE je umbenannt zu haben. Rein lesende SQL-Diagnose gegen die
   echte Produktions-DB (siehe Chat-Verlauf) bewies: beide Accounts hatten
   ALLE 6 Ausruestungsplaetze korrekt in der Datenbank (name_key UND
   auth_user_id passten exakt) - aber gleichzeitig ein NIE geleertes Lager
   von 7.541 bzw. 15.632 einzelnen Runen-Zeilen. loadPlayerRunes() (vorher)
   holte IMMER die KOMPLETTE Zeilenmenge in einem Aufruf - bei so einer
   Groesse (mehrere MB JSON, jede Zeile mit substats-Array) schlaegt die
   Anfrage bei jedem Netzwerk-Haenger fehl (echter, reproduzierter
   Konsolenfehler "sw.js: Failed to fetch" bei einem der beiden Spieler),
   und idledorf.js's Ladeblock setzte den KOMPLETTEN lokalen Runenbestand
   danach unconditional auf [] zurueck - nur ein stilles console.warn, dem
   Spieler nie angezeigt. Sah fuer den Spieler wie Datenverlust aus, obwohl
   in der Datenbank nachweislich nichts fehlte.

   Fix (siehe idledorf.js/supabase.js/js/systems/bkmp-runes.js fuer die
   volle Begruendung): zwei unabhaengige Ladevorgaenge (ausgeruestete Runen
   IMMER vollstaendig + ungenutztes Lager nach Wert sortiert auf 300
   Zeilen gekappt), kein stilles Leeren mehr bei einem Fehler, plus ein
   neuer, SLOT-UEBERGREIFENDER "Alle <Seltenheit> verkaufen"-Sammelverkauf
   (deleteRunesByRarity, per Filter statt id-Liste), damit Spieler ein
   bereits riesiges Lager in einem Klick aufraeumen koennen, unabhaengig
   davon, wie viele tausend Zeilen das sind. Dieser Test deckt genau diese
   neuen Mechanismen ab - die reine "existiert die Zuordnung noch korrekt"-
   Frage ist bereits in tests/e2e/rune-persistence-hardening.spec.js
   abgedeckt. */

// Alle Tests dieser Datei navigieren ueber echte Desktop-Tab-Buttons (#idleTabBtnRunen) -
// auf mobile-small/mobile-large sind diese per kompakter Navigation versteckt/verschoben
// (siehe Phase 7.0-7.3). Erst beim ersten vollstaendigen 3-Projekte-qa:full-Lauf sichtbar
// geworden (26.07.2026) - dieselbe, bereits mehrfach etablierte Luecke wie in
// buttons-inventory/dungeon-time/navigation/prestige/save-load/rune-autofuse-datasource.spec.js.
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop-only Navigation (#idleTabBtnRunen) - siehe Kommentar am Dateianfang.');
});

function runeSummary(page) {
  return page.evaluate(() => bkmpIdlePlayerRunes.map(r => ({
    cid: r._cid, rune_type: r.rune_type, rarity: r.rarity, equipped: r.equipped, upgrade_level: r.upgrade_level
  })));
}

test.describe('Runen-Skalierung (Teststand E, sehr grosses Lager)', () => {
  test.use({ teststand: 'E' });

  test('Ladeobergrenze greift bei einem Lager weit ueber 300 Zeilen - ausgeruestete Runen bleiben trotzdem vollstaendig', async ({ page, qaBaseURL, fixtureData, store }) => {
    // Teststand E hat bereits 6 ausgeruestete (gold, +15) + 294 gewoehnliche
    // unausgeruestete Runen. Fuer einen echten Ladeobergrenzen-Test brauchen
    // wir MEHR als 300 unausgeruestete Zeilen insgesamt - 100 weitere,
    // teils hochwertige (purple/+10), damit sich die Sortierung nach Wert
    // klar nachweisen laesst.
    for (let i = 0; i < 100; i++) {
      store.tables.idle_player_runes.push({
        id: `qa-rune-extra-${i}`, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId,
        rune_type: ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'][i % 6],
        rarity: i < 20 ? 'purple' : 'blue', rolled_value: 8, equipped: false,
        upgrade_level: i < 20 ? 10 : 0, substats: [], created_at: fixtureData.nowIso
      });
    }
    const totalUnequippedInDb = store.tables.idle_player_runes.filter(r => !r.equipped).length;
    expect(totalUnequippedInDb).toBeGreaterThan(300); // 294 + 100 = 394

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const capped = await page.evaluate(() => bkmpIdleRuneInventoryCapped);
    expect(capped).toBe(true);

    const runes = await runeSummary(page);
    const equipped = runes.filter(r => r.equipped);
    const unequipped = runes.filter(r => !r.equipped);
    // GENAU der eigentliche Fix: alle 6 Ausruestungsplaetze sind IMMER
    // vollstaendig da, unabhaengig davon, wie riesig das restliche Lager ist.
    expect(equipped.length).toBe(6);
    expect(unequipped.length).toBe(300); // an der Ladeobergrenze gekappt

    // Die 20 frisch hinzugefuegten purple/+10-Runen sind deutlich wertvoller
    // als die restlichen gray/+0-Massenware - sie MUESSEN im gekappten
    // Ergebnis vorkommen (nach Wert sortiert, nicht nach Zufall/Reihenfolge).
    const purpleTenCount = unequipped.filter(r => r.rarity === 'purple' && r.upgrade_level === 10).length;
    expect(purpleTenCount).toBe(20);

    // Runen-Tab tatsaechlich oeffnen, bevor die Panel-DOM-Struktur geprueft wird
    // (bkmpIdleRenderRunenPanel() baut #idleRunenInventory/.idle-runen-cap-banner
    // nur, wenn der Tab aktiv ist/war).
    await page.locator('#idleTabBtnRunen').click();
    await expect(page.locator('#idlePanelRunen')).toBeVisible();

    // Render-Sicherheit: die Lager-Ansicht baut trotz hunderter Zeilen kein
    // unbegrenzt wachsendes DOM auf (keine 394 Buttons fuer einen einzelnen
    // Slot-Reiter) - bleibt bei maximal der Ladeobergrenze.
    const inventoryButtonCount = await page.locator('#idleRunenInventory .idle-runen-item').count();
    expect(inventoryButtonCount).toBeLessThanOrEqual(300);

    // Hinweis-Banner "es gibt noch mehr" ist sichtbar.
    await expect(page.locator('.idle-runen-cap-banner')).toBeVisible();
  });

  test('Runen-Panel bleibt bedienbar (kein Haenger) bei einem 394-Zeilen-Lager - Slot-Wechsel funktioniert normal', async ({ page, qaBaseURL, fixtureData, store }) => {
    for (let i = 0; i < 100; i++) {
      store.tables.idle_player_runes.push({
        id: `qa-rune-extra2-${i}`, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId,
        rune_type: ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'][i % 6],
        rarity: 'blue', rolled_value: 8, equipped: false, upgrade_level: 0, substats: [], created_at: fixtureData.nowIso
      });
    }
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    await expect(page.locator('#idlePanelRunen')).toBeVisible();
    await page.locator('.idle-runen-slot-tab[data-slot="slot3"]').click();
    await expect(page.locator('.idle-runen-slot-tab[data-slot="slot3"]')).toHaveClass(/active/);
  });
});

test.describe('Slot-uebergreifender Sammelverkauf nach Seltenheit', () => {
  test.use({ teststand: 'E' });

  test('bkmpRuneSellAllByRarity loescht ALLE unausgeruesteten Runen einer Seltenheit ueber alle Slot-Typen, auch weit ueber die Ladeobergrenze hinaus, mit exaktem Gold-Gesamtwert', async ({ page, qaBaseURL, fixtureData, store }) => {
    // Teststand E hat 294 gray unequipped Runen (bereits ueber unserer
    // eigenen Anzeige-Obergrenze von 300 zusammen mit den 6 equipped) -
    // fuer einen klaren "deutlich mehr als angezeigt"-Beweis kommen nochmal
    // 200 gray dazu (macht 494 gray insgesamt) + 10 blaue als Kontrollgruppe,
    // die NICHT mitverkauft werden duerfen.
    for (let i = 0; i < 200; i++) {
      store.tables.idle_player_runes.push({
        id: `qa-rune-gray-extra-${i}`, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId,
        rune_type: ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'][i % 6],
        rarity: 'gray', rolled_value: 5, equipped: false, upgrade_level: 0, substats: [], created_at: fixtureData.nowIso
      });
    }
    for (let i = 0; i < 10; i++) {
      store.tables.idle_player_runes.push({
        id: `qa-rune-blue-control-${i}`, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId,
        rune_type: 'slot1', rarity: 'blue', rolled_value: 9, equipped: false, upgrade_level: 0, substats: [], created_at: fixtureData.nowIso
      });
    }
    const grayCountBefore = store.tables.idle_player_runes.filter(r => r.rarity === 'gray' && !r.equipped).length;
    expect(grayCountBefore).toBe(494); // 294 (Teststand E) + 200 neu - weit ueber der 300er-Anzeige-Obergrenze
    const totalRowsBefore = store.tables.idle_player_runes.length;

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const goldBefore = await page.evaluate(() => bkmpIdleState.gold);

    const evalPromise = page.evaluate(() => window.bkmpRuneSellAllByRarity('gray'));
    await expect(page.locator('#bkmpConfirmOverlay')).toHaveClass(/visible/, { timeout: 10000 });
    await page.locator('#bkmpConfirmOkBtn').click();
    await evalPromise;

    // Serverseitige Wahrheit: ALLE 494 gray-Zeilen sind weg, unabhaengig
    // davon, wie viele davon lokal je geladen/angezeigt wurden (die
    // Loeschung laeuft per Filter, nicht per geladener id-Liste).
    const grayRemaining = store.tables.idle_player_runes.filter(r => r.rarity === 'gray' && !r.equipped).length;
    expect(grayRemaining).toBe(0);
    // Nichts anderes wurde beruehrt: die 10 blauen Kontroll-Runen + alle
    // 6 ausgeruesteten Runen sind unveraendert da.
    expect(store.tables.idle_player_runes.length).toBe(totalRowsBefore - 494);
    expect(store.tables.idle_player_runes.filter(r => r.rarity === 'blue' && !r.equipped).length).toBe(10);
    expect(store.tables.idle_player_runes.filter(r => r.equipped).length).toBe(6);

    // Gold-Gesamtwert exakt: 494 gray-Runen, alle rarity='gray'/upgrade_level=0/keine
    // Substats -> jede einzelne hat denselben bkmpRuneSellValue()-Wert.
    const goldAfter = await page.evaluate(() => bkmpIdleState.gold);
    const perRuneValue = await page.evaluate(() => {
      const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === 'gray');
      return rarity.sellGold;
    });
    expect(goldAfter - goldBefore).toBe(perRuneValue * 494);

    // Lokal ist das Lager jetzt ebenfalls sauber - keine gray-Reste mehr.
    const localGrayLeft = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.rarity === 'gray' && !r.equipped).length);
    expect(localGrayLeft).toBe(0);
  });

  test('Abbrechen im Bestaetigungsdialog verkauft nichts', async ({ page, qaBaseURL, fixtureData, store }) => {
    const totalRowsBefore = store.tables.idle_player_runes.length;
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const evalPromise = page.evaluate(() => window.bkmpRuneSellAllByRarity('gray'));
    await expect(page.locator('#bkmpConfirmOverlay')).toHaveClass(/visible/, { timeout: 10000 });
    await page.locator('#bkmpConfirmCancelBtn').click();
    await evalPromise;

    expect(store.tables.idle_player_runes.length).toBe(totalRowsBefore);
  });

  test('"gold" ist keine waehlbare Sammelverkauf-Seltenheit (schuetzt die wertvollste Stufe vor versehentlichem Komplettverkauf)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnRunen').click();
    const goldButtonCount = await page.locator('.idle-runen-rarity-sell-btn[data-rarity="gold"]').count();
    expect(goldButtonCount).toBe(0);
    // Die anderen 4 (gray/green/blue/purple) sind da.
    const otherButtonCount = await page.locator('.idle-runen-rarity-sell-btn').count();
    expect(otherButtonCount).toBe(4);
  });
});

test.describe('Erneutes Laden nach Fehlschlag (bkmpRuneRetryLoad)', () => {
  test.use({ teststand: 'C' });

  test('Retry-Knopf laedt nach einem vorherigen Fehlschlag erfolgreich neu, Fehler-Banner verschwindet', async ({ page, context, qaBaseURL, fixtureData, store }) => {
    const runeCountBefore = store.tables.idle_player_runes.length;
    let shouldFail = true;
    await context.route('**/rest/v1/idle_player_runes*', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && url.includes('equipped=eq.true') && shouldFail) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulated' }) });
      }
      return route.fallback();
    });

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    expect(await page.evaluate(() => bkmpIdleRuneLoadError)).toBe(true);
    await page.locator('#idleTabBtnRunen').click();
    await expect(page.locator('#idleRuneRetryLoadBtn')).toBeVisible();

    // Ab jetzt gelingt der Ladeversuch - Retry-Klick soll den vollen Bestand zurueckbringen.
    shouldFail = false;
    await page.locator('#idleRuneRetryLoadBtn').click();
    await expect.poll(() => page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.equipped).length)).toBe(6);
    expect(await page.evaluate(() => bkmpIdleRuneLoadError)).toBe(false);
    expect(await page.evaluate(() => bkmpIdlePlayerRunes.length)).toBe(runeCountBefore);
    await expect(page.locator('#idleRuneRetryLoadBtn')).toHaveCount(0);
  });
});
