const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');

/* Auftrag Abschnitt 16: Runensystem. Zentrale Regel: jede Runenart maximal
   einmal gleichzeitig ausgeruestet. Laeuft gegen die echten Produktions-
   funktionen (bkmpRuneToggleEquip/bkmpRuneNormalizeDuplicateEquips), kein
   Test-Doppel der Spielformel.

   test.use({teststand}) muss auf describe-Ebene stehen (nicht in einem
   einzelnen test()-Callback, das wirft zur Laufzeit) - deshalb ein eigenes
   describe je Teststand statt eines gemeinsamen Blocks. */

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
    await page.locator('#idleRuneDrawerToggle').click(); // aus dem Weg, siehe CLAUDE.md Phase 7.2
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
    await page.locator('#idleRuneDrawerToggle').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#idleRuneEquipBtn')).toHaveText('Entfernen', { timeout: 5000 });
    await page.locator('#idleRuneEquipBtn').click();
    await page.waitForTimeout(300);

    let equippedNow = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.rune_type === 'slot5' && r.equipped));
    expect(equippedNow.length).toBe(0);

    // 2) Jetzt sollte sich die ANDERE (vorher blockierte) Rune einsetzen lassen.
    await page.locator('#idleRuneDrawerToggle').click(); // Lager wieder aufklappen
    await page.waitForTimeout(300);
    const otherCard = page.locator('.idle-runen-item:not(.is-equipped)').first();
    await otherCard.click();
    await page.locator('#idleRuneDrawerToggle').click();
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
