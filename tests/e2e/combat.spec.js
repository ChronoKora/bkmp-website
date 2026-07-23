const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Auftrag Abschnitt 10/11: Kampfsystem. Laeuft gegen die echte
   bkmpIdleTick()/bkmpIdleHandleDragonClick()-Logik (kein Test-Doppel) -
   Teststand A (frischer Spieler, Stufe 1 gegen den ersten Testdrachen aus
   tests/fixtures/reference-data.js) macht Ergebnisse vorhersagbar genug fuer
   feste Assertions, ohne die echte Kampfformel nachzubauen. */
test.describe('Kampfsystem', () => {
  test.use({ teststand: 'A' });

  test('Kampfszene zeigt einen gueltigen Gegner mit Name/Stufe/HP', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await expect(page.locator('#idleDragonName')).not.toBeEmpty();
    const dragonName = await page.locator('#idleDragonName').textContent();
    expect(dragonName).toMatch(/Stufe/);

    const dragonHpLabel = await page.locator('#idleDragonHpLabel').textContent();
    const villageHpLabel = await page.locator('#idleVillageHpLabel').textContent();
    expect(dragonHpLabel).not.toMatch(/NaN|undefined/);
    expect(villageHpLabel).not.toMatch(/NaN|undefined/);

    const state = await page.evaluate(() => ({
      dragonHp: bkmpIdleCurrentDragon.hp,
      dragonMaxHp: bkmpIdleCurrentDragon.maxHp,
      villageHp: bkmpIdleVillageHp,
      killIndex: bkmpIdleCurrentDragon.killIndex
    }));
    expect(state.dragonHp).toBeGreaterThan(0);
    expect(state.dragonHp).toBeLessThanOrEqual(state.dragonMaxHp);
    expect(state.villageHp).toBeGreaterThan(0);
    expect(state.killIndex).toBe(0);
    expect(Number.isNaN(state.dragonHp)).toBe(false);
    expect(Number.isNaN(state.villageHp)).toBe(false);
  });

  test('manueller Klick auf den Drachen fuegt sofort Schaden zu', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop()); // isoliert den Klick vom Auto-Tick fuer eine klare Vorher/Nachher-Messung

    const before = await page.evaluate(() => bkmpIdleCurrentDragon.hp);
    await page.locator('#idleDragon').click();
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => bkmpIdleCurrentDragon ? bkmpIdleCurrentDragon.hp : null);

    // after ist entweder ein niedrigerer HP-Wert (Drache ueberlebt) oder der
    // NAECHSTE Drache wurde bereits gespawnt (besiegt) - beides ist ein
    // gueltiges "der Klick hat etwas bewirkt".
    if (after !== null) {
      expect(after).toBeLessThan(before);
    }
    const killIndexAfter = await page.evaluate(() => bkmpIdleState.current_dragon_index);
    expect(killIndexAfter).toBeGreaterThanOrEqual(0);
  });

  test('der Auto-Tick fuegt ueber die Zeit Schaden zu, ohne dass geklickt wird', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const before = await page.evaluate(() => ({ hp: bkmpIdleCurrentDragon.hp, kills: bkmpIdleState.dragon_kills }));

    // Echte Tick-Rate abwarten (900ms Default) statt Fake-Clock - dieser Test
    // soll sichtbar/beobachtbar den echten Loop pruefen (Auftrag Abschnitt 39).
    await page.waitForTimeout(3000);

    const after = await page.evaluate(() => ({
      hp: bkmpIdleCurrentDragon ? bkmpIdleCurrentDragon.hp : null,
      kills: bkmpIdleState.dragon_kills
    }));
    // Nach 3s echter Zeit muss SICH ETWAS bewegt haben: entweder der Drache
    // hat Schaden genommen, oder er (und ggf. mehrere Nachfolger) wurden
    // bereits besiegt (kills gestiegen).
    const dragonDamaged = after.hp !== null && after.hp < before.hp;
    const killsIncreased = after.kills > before.kills;
    expect(dragonDamaged || killsIncreased, `Erwartete Bewegung nach 3s Auto-Tick: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`).toBe(true);
  });

  test('Dorf- und Drachen-HP werden nie negativ oder NaN', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.waitForTimeout(2500);
    const state = await page.evaluate(() => ({
      dragonHp: bkmpIdleCurrentDragon ? bkmpIdleCurrentDragon.hp : 0,
      villageHp: bkmpIdleVillageHp
    }));
    expect(state.dragonHp).toBeGreaterThanOrEqual(0);
    expect(state.villageHp).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(state.dragonHp)).toBe(false);
    expect(Number.isNaN(state.villageHp)).toBe(false);
    const villageLabel = await page.locator('#idleVillageHpLabel').textContent();
    const dragonLabel = await page.locator('#idleDragonHpLabel').textContent();
    expect(villageLabel).not.toMatch(/-\d|NaN/);
    expect(dragonLabel).not.toMatch(/-\d|NaN/);
  });

  test('Besiegen eines Drachen erhoeht dragon_kills und schaltet die naechste Stufe frei', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const before = await page.evaluate(() => ({ kills: bkmpIdleState.dragon_kills, highest: bkmpIdleState.highest_dragon_index }));

    // Direkt auf 1 HP setzen statt viele echte Ticks abzuwarten - der
    // eigentliche Uebergang (bkmpIdleHandleDragonDefeated) ist echter
    // Produktionscode, nur das "HP fast leer" wird abgekuerzt.
    await page.evaluate(() => { bkmpIdleCurrentDragon.hp = 1; });
    await page.locator('#idleDragon').click();
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => ({ kills: bkmpIdleState.dragon_kills, highest: bkmpIdleState.highest_dragon_index, killIndex: bkmpIdleState.current_dragon_index }));
    expect(after.kills).toBeGreaterThan(before.kills);
    expect(after.highest).toBeGreaterThanOrEqual(before.highest);
    expect(after.killIndex).toBeGreaterThanOrEqual(0);
  });

  test('jede 25. Stufe ist ein Boss', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const bossInfo = await page.evaluate(() => {
      bkmpIdleState.current_dragon_index = 24;
      bkmpIdleState.highest_dragon_index = Math.max(bkmpIdleState.highest_dragon_index || 0, 24);
      bkmpIdleSpawnDragon();
      return { isBoss: bkmpIdleCurrentDragon.isBoss, bossTier: bkmpIdleCurrentDragon.bossTier, name: bkmpIdleCurrentDragon.name };
    });
    expect(bossInfo.isBoss).toBe(true);
    expect(bossInfo.bossTier).toBe('boss');
    await expect(page.locator('#idleDragonName')).toContainText('BOSS');
  });

  test('Reload mitten im Kampf behaelt die Kampf-Stufe (Dorf-HP startet wieder voll)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      bkmpIdleState.current_dragon_index = 5;
      bkmpIdleState.highest_dragon_index = 5;
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await page.waitForFunction(() => typeof bkmpIdleState !== 'undefined' && bkmpIdleState != null, null, { timeout: 15000 });
    await waitForDragonReady(page);

    const stage = await page.evaluate(() => bkmpIdleState.current_dragon_index);
    expect(stage).toBe(5);
    // "Village-HP startet bei jedem Oeffnen des Modals immer voll" (Kommentar
    // in bkmpIdleOpenModal/bkmpIdleRecomputeEffectiveStats, idledorf.js).
    const villageHpFull = await page.evaluate(() => bkmpIdleVillageHp >= bkmpIdleEffectiveStats.hp);
    expect(villageHpFull).toBe(true);
  });
});
