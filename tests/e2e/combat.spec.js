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

    /* Stabilitaets-Fix (Sicherheits-/Stabilitaetsphase 24.07.2026, siehe
       CLAUDE.md): ohne diesen Stop lief der Auto-Tick-Kampf-Loop waehrend
       des gesamten Tests im Hintergrund weiter und traf den Drachen alle
       ~900ms selbst - jeder dieser Treffer haengt bkmpIdleSpawnHitFlash()
       zufolge die Klasse .idle-hit-flash an #idleDragon (idledorf.js:735),
       deren CSS-Animation `idleHitFlash` GENAU auf #idleDragon selbst einen
       echten transform:scale(...)-Verlauf abspielt (style.css:6044-6049) -
       das exakte Element, das gleich per .click() angesprochen wird. Per
       eigens gebautem Diagnose-Test empirisch bestaetigt (nicht nur
       vermutet): className/transform/BoundingClientRect von #idleDragon
       aendern sich dadurch fortlaufend, className blieb ueber 4s Messung
       fast durchgehend "...idle-hit-flash", transform pendelte zwischen
       "none" und "matrix(scale,...)" - Playwrights eigene Klick-
       Stabilitaetspruefung (verlangt zwei aufeinanderfolgende Frames mit
       UNVERAENDERTER BoundingClientRect) konvergiert dadurch auf WebKit
       (mobile-large) oft nicht innerhalb des 30s-Test-Timeouts (reproduziert
       10/20 Laeufe). Gleichzeitig per direktem, Playwright-Stabilitaet
       umgehendem DOM-Klick MITTEN in der Animation bestaetigt: ein echter
       Tastendruck/Klick wird vom Spiel voellig normal verarbeitet (HP sank
       sofort sichtbar) - betrifft also nachweislich NUR Playwrights eigene
       Pruefung, nie einen echten Nutzer. Der bereits benachbarte Test
       "manueller Klick..." (Zeile 40 oben) ruft bkmpIdleStopLoop() bereits
       genau aus diesem Grund auf und flaked deshalb nie - hier fehlte der
       identische, bereits etablierte Aufruf schlicht. Der Hintergrund-Loop
       ist fuer DIESEN Test ohnehin nur eine unbeabsichtigte Stoerquelle
       (getestet wird der manuelle Todesstoss, nicht das Zusammenspiel mit
       dem Auto-Tick) - kein force:true, keine Wartezeit, keine App-
       Aenderung noetig. */
    await page.evaluate(() => bkmpIdleStopLoop());

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
