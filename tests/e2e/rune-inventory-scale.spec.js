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

   Fix (25.07.2026, siehe idledorf.js/supabase.js/js/systems/bkmp-runes.js
   fuer die volle Begruendung): zwei unabhaengige Ladevorgaenge (ausgeruestete
   Runen IMMER vollstaendig + ungenutztes Lager separat), kein stilles
   Leeren mehr bei einem Fehler.

   Nachtrag (04.08.2026, Spieler-Feedback): zwischen 25.07. und 03.08.2026
   war das ungenutzte Lager zusaetzlich auf die 300 wertvollsten Zeilen
   GEKAPPT, mit einer eigenen "Lager aufräumen"-Rarität-Verkaufsleiste als
   Abhilfe - diese Leiste sah fuer viele Spieler wie ein reiner Filter aus,
   loeste bei einem Klick aber sofort einen unwiderruflichen Sammelverkauf
   aus. Auf ausdruecklichen Nutzerwunsch (TROTZ des bekannten Risikos aus
   dem 25.07.-Vorfall) wieder auf unbegrenztes Laden umgestellt - die
   Verkaufsleiste ist komplett entfernt. Dieser Test deckt jetzt das
   GEGENTEIL des urspruenglichen Cap-Tests ab: ein sehr grosses Lager laedt
   VOLLSTAENDIG, kein Rest wird mehr verschwiegen. Die reine "existiert die
   Zuordnung noch korrekt"-Frage ist bereits in
   tests/e2e/rune-persistence-hardening.spec.js abgedeckt. */

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

  test('Ein Lager weit ueber 300 Zeilen laedt vollstaendig - keine Kappung, kein Hinweis-Banner mehr', async ({ page, qaBaseURL, fixtureData, store }) => {
    // Teststand E hat bereits 6 ausgeruestete (gold, +15) + 294 gewoehnliche
    // unausgeruestete Runen. 100 weitere, teils hochwertige (purple/+10)
    // Zeilen dazu - deutlich ueber der frueheren 300er-Kappungsgrenze.
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

    const runes = await runeSummary(page);
    const equipped = runes.filter(r => r.equipped);
    const unequipped = runes.filter(r => !r.equipped);
    // Ausruestungsplaetze sind (wie immer) vollstaendig da...
    expect(equipped.length).toBe(6);
    // ...und das UNGENUTZTE Lager ist jetzt ebenfalls vollstaendig geladen,
    // keine Kappung mehr bei 300.
    expect(unequipped.length).toBe(totalUnequippedInDb);

    // Runen-Tab tatsaechlich oeffnen, bevor die Panel-DOM-Struktur geprueft wird
    // (bkmpIdleRenderRunenPanel() baut #idleRunenInventory nur, wenn der Tab
    // aktiv ist/war).
    await page.locator('#idleTabBtnRunen').click();
    await expect(page.locator('#idlePanelRunen')).toBeVisible();

    // Kein Kappungs-Hinweis mehr - die Fehler-Banner-Klasse existiert im DOM
    // gar nicht, solange kein echter Ladefehler vorliegt.
    await expect(page.locator('.idle-runen-error-banner')).toHaveCount(0);

    // Die Zusammenfassungszeile zeigt den echten Gesamtwert ohne "+"-Suffix.
    const headerText = await page.locator('.idle-runen-inventory-header .idle-sammlung-count').first().textContent();
    expect(headerText).not.toContain('+');
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
