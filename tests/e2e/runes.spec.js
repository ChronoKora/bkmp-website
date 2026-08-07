const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');

/* Auftrag Abschnitt 16: Runensystem. Zentrale Regel: jede Runenart maximal
   einmal gleichzeitig ausgeruestet. Laeuft gegen die echten Produktions-
   funktionen (bkmpRuneToggleEquip/bkmpRuneNormalizeDuplicateEquips), kein
   Test-Doppel der Spielformel.

   test.use({teststand}) muss auf describe-Ebene stehen (nicht in einem
   einzelnen test()-Callback, das wirft zur Laufzeit) - deshalb ein eigenes
   describe je Teststand statt eines gemeinsamen Blocks. */

/* QA-Grundlage Phase 2 (24.07.2026) - siehe identischer Kommentar in
   buttons-inventory.spec.js: diese Datei klickt #idleTabBtnRunen per echtem
   Playwright-.click() (verlangt Sichtbarkeit), auf mobile-*-Projekten ist
   der Knoten korrekt unsichtbar (kompakte Navigation) - 30s-Timeout, kein
   App-Bug. Top-Level-Hook, gilt fuer alle 4 describe-Bloecke dieser Datei. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - siehe Kommentar oben, mobile-smoke.spec.js deckt die kompakte Navigation ab');
});

/* Redesign 06.08.2026: der Runen-Lager-Balken wird ab 1000px Fensterbreite in
   den Panel-Hauptbereich eingebettet (siehe bkmpRuneSyncDrawerEmbedMode in
   js/systems/bkmp-runes.js) und ist dort IMMER offen - der Zuklapp-Pfeil
   (#idleRuneDrawerToggle) wird dafuer per CSS ausgeblendet, das urspruengliche
   Ueberlapp-Problem mit #idleRuneEquipBtn (siehe Kommentar an den bisherigen
   Aufrufstellen, Phase 7.2) existiert im eingebetteten Zustand strukturell
   nicht mehr (eigene Spalte statt schwebender Balken). Ersetzt die bisherigen
   direkten `#idleRuneDrawerToggle`-Klicks - klappt nur noch zu, wenn der
   Pfeil ueberhaupt sichtbar ist (schmalere/nicht eingebettete Breiten). */
async function bkmpTestToggleDrawerIfFloating(page) {
  const toggle = page.locator('#idleRuneDrawerToggle');
  if (await toggle.isVisible()) await toggle.click();
}

test.describe('Runensystem - Teststand D (beschaedigte Daten)', () => {
  test.use({ teststand: 'D' });

  test('ungueltig doppelt ausgeruestete Runenart wird beim Laden bereinigt', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    // loadPlayerRunes()/bkmpRuneNormalizeDuplicateEquips() laufen asynchron
    // neben bkmpIdleState - ohne diese Wartezeit las der Test gelegentlich
    // ein noch leeres bkmpIdlePlayerRunes (0 statt 1), reine Timing-Race,
    // kein App-Bug (siehe gleicher Fund im Teststand-C-Test unten).
    await page.waitForFunction(() => Array.isArray(bkmpIdlePlayerRunes) && bkmpIdlePlayerRunes.length > 0, null, { timeout: 15000 });
    const result = await page.evaluate(() => ({
      slot5Equipped: bkmpIdlePlayerRunes.filter(r => r.rune_type === 'slot5' && r.equipped).length,
      totalRunes: bkmpIdlePlayerRunes.length
    }));
    // Teststand D seedet 2x "slot5" (Wuchtrune) gleichzeitig equipped=true -
    // bkmpRuneNormalizeDuplicateEquips() muss das beim Laden auf genau 1
    // reduzieren (staerkste bleibt), OHNE eine Rune zu loeschen.
    expect(result.slot5Equipped).toBe(1);
    expect(result.totalRunes).toBe(3); // 2x slot5 + 1x slot6, keine geht verloren
  });
});

test.describe('Runensystem - Teststand B (mittlerer Spieler)', () => {
  test.use({ teststand: 'B' });

  test('eine zweite Rune derselben Art auszuruesten wird verhindert (Konflikt-Warnung)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot5"]').click();

    // slot5 (Wuchtrune) hat in Teststand B zwei Runen: eine equipped (id
    // qa-rune-5001), eine nicht (qa-rune-5003) - die unequipped auswaehlen
    // und versuchen einzusetzen, waehrend die andere noch ausgeruestet ist.
    const before = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.rune_type === 'slot5' && r.equipped).map(r => r.id));
    expect(before).toEqual(['qa-rune-5001']);

    const unequippedCard = page.locator('.idle-runen-item:not(.is-equipped)').first();
    await unequippedCard.click();
    await bkmpTestToggleDrawerIfFloating(page); // aus dem Weg, siehe CLAUDE.md Phase 7.2 / Redesign 06.08.2026
    await page.waitForTimeout(300);
    await page.locator('#idleRuneEquipBtn').click();
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.rune_type === 'slot5' && r.equipped).map(r => r.id));
    // Die Konflikt-Pruefung in bkmpRuneToggleEquip() muss das verhindert
    // haben - weiterhin genau die urspruengliche Rune ausgeruestet, keine
    // zweite dazugekommen.
    expect(after).toEqual(['qa-rune-5001']);
  });

  test('eine ausgeruestete Rune laesst sich entfernen und eine andere danach einsetzen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot5"]').click();

    // 1) Die aktuell ausgeruestete Rune entfernen.
    const equippedCard = page.locator('.idle-runen-item.is-equipped').first();
    await equippedCard.click();
    await bkmpTestToggleDrawerIfFloating(page);
    await page.waitForTimeout(300);
    await expect(page.locator('#idleRuneEquipBtn')).toHaveText('Entfernen', { timeout: 5000 });
    await page.locator('#idleRuneEquipBtn').click();
    await page.waitForTimeout(300);

    let equippedNow = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.rune_type === 'slot5' && r.equipped));
    expect(equippedNow.length).toBe(0);

    // 2) Jetzt sollte sich die ANDERE (vorher blockierte) Rune einsetzen lassen.
    await bkmpTestToggleDrawerIfFloating(page); // Lager wieder aufklappen (nur schwebender Modus)
    await page.waitForTimeout(300);
    const otherCard = page.locator('.idle-runen-item:not(.is-equipped)').first();
    await otherCard.click();
    await bkmpTestToggleDrawerIfFloating(page);
    await page.waitForTimeout(300);
    await expect(page.locator('#idleRuneEquipBtn')).toHaveText('Einsetzen', { timeout: 5000 });
    await page.locator('#idleRuneEquipBtn').click();
    await page.waitForTimeout(300);

    equippedNow = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.rune_type === 'slot5' && r.equipped));
    expect(equippedNow.length).toBe(1);
  });
});

test.describe('Runensystem - Teststand C (fortgeschritten)', () => {
  test.use({ teststand: 'C' });

  test('6 belegte Runenslots werden korrekt geladen (ein echter Slot pro Typ)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    // loadPlayerRunes() ist ein eigener, asynchroner Ladevorgang neben
    // bkmpIdleLoadOrInitState() - bkmpIdlePlayerRunes kann fuer einen Moment
    // noch leer sein, selbst nachdem bkmpIdleState/der Drache schon bereit
    // sind (gefunden: dieser Test las sonst ein leeres Array).
    await page.waitForFunction(() => Array.isArray(bkmpIdlePlayerRunes) && bkmpIdlePlayerRunes.length > 0, null, { timeout: 15000 });
    const equippedByType = await page.evaluate(() => {
      const out = {};
      bkmpIdlePlayerRunes.filter(r => r.equipped).forEach(r => { out[r.rune_type] = (out[r.rune_type] || 0) + 1; });
      return out;
    });
    expect(Object.keys(equippedByType).sort()).toEqual(['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6']);
    Object.values(equippedByType).forEach(count => expect(count).toBe(1));
  });

  /* Spieler-Idee OPShadowWolf (30.07.2026, Feedback-Board): "Einsetzen"-Button
     (#idleRuneEquipBtn) wird vom geoeffneten Kraftrune-Lager verdeckt, muss
     bisher jedes Mal erst geschlossen werden - bereits als bekannter, nicht
     behobener horizontaler Overlap in save-load.spec.js dokumentiert gewesen
     (siehe dortiger frueherer Workaround-Kommentar, jetzt entfernt). Fix:
     bkmpRuneSyncDrawerPosition() reserviert live per CSS-Variable exakt so
     viel Rand-Abstand, wie der Balken tatsaechlich ueberlappen wuerde. */
  test('Einsetzen-Button bleibt sichtbar/erreichbar, wenn das geoeffnete Runen-Lager ihn sonst ueberlappen wuerde', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnRunen').click();
    await page.locator('.idle-runen-slot-tab[data-slot="slot1"]').click();
    await expect(page.locator('#idleRuneDrawer')).toHaveClass(/open/);

    const geometry = await page.evaluate(() => {
      const drawer = document.getElementById('idleRuneDrawer');
      const btn = document.getElementById('idleRuneEquipBtn');
      const dRect = drawer.getBoundingClientRect();
      const bRect = btn.getBoundingClientRect();
      return {
        overlapVar: getComputedStyle(document.getElementById('idlePanelRunen')).getPropertyValue('--rune-drawer-overlap').trim(),
        drawerLeft: dRect.left, btnRight: bRect.right,
        covered: !(bRect.right <= dRect.left || bRect.left >= dRect.right)
      };
    });
    expect(geometry.covered).toBe(false);
    expect(geometry.btnRight).toBeLessThanOrEqual(geometry.drawerLeft);

    // Nicht nur Geometrie - der Button muss bei geoeffnetem Balken auch
    // wirklich per echtem Playwright-Klick erreichbar sein (kein anderes
    // Element liegt trotz korrekter Geometrie im Klickpfad).
    const equipBtn = page.locator('#idleRuneEquipBtn');
    await expect(equipBtn).toBeVisible();
    await equipBtn.click({ trial: true }); // wirft, falls etwas anderes den Klickpunkt abfaengt
  });
});

test.describe('Runensystem - Teststand E (Maximalbelastung)', () => {
  test.use({ teststand: 'E' });

  test('ein volles 300er-Runeninventar laedt ohne Absturz, genau 6 bleiben ausgeruestet', async ({ page, qaBaseURL, fixtureData }) => {
    const consoleErrors = [];
    page.on('pageerror', err => consoleErrors.push(String(err)));
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnRunen').click();
    await page.waitForTimeout(300);

    const info = await page.evaluate(() => ({
      total: bkmpIdlePlayerRunes.length,
      equipped: bkmpIdlePlayerRunes.filter(r => r.equipped).length
    }));
    expect(info.total).toBe(300);
    expect(info.equipped).toBe(6);
    expect(consoleErrors, `Page errors while rendering a 300-rune inventory:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
