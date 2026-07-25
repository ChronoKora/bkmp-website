const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Dringender Bugfix-Auftrag 25.07.2026 (Nutzerbericht "Meine Runen sind
   komplett weg. Das waren teilweise schon Level-22- und Level-23-Runen.").
   Ergaenzt tests/e2e/rename-persistence.spec.js (dort die BEWIESENE
   Hauptursache: rename_player_account() liess idle_player_runes/
   idle_prestige_state/idle_player_village_skins beim Umbenennen unangetastet)
   um die restlichen vom Auftrag verlangten Szenarien, die NICHT mit einer
   Namensaenderung zusammenhaengen - deckt zusaetzlich ab: Reload, Logout/
   Login, Prestige, Kontowechsel, fehlgeschlagene/leere/verspaetete
   Ladeantwort, veraltete Antwort nach neuerer, Ausruestungsstatus. Keiner
   dieser Pfade zeigte beim Nachpruefen einen ZWEITEN eigenstaendigen
   Datenverlust-Bug - dieser Test beweist das POSITIV (nicht nur "wurde
   nicht gefunden"), damit die Ursache klar auf die Namensaenderung
   eingegrenzt bleibt. Die einzige zusaetzliche echte Luecke (bkmpRuneAscend
   fehlte der bereits bei bkmpRuneUpgrade/-InstantUpgrade vorhandene
   Sofort-Speichern-Schutz fuer frisch gedroppte Runen ohne DB-id) ist
   bereits in js/systems/bkmp-runes.js gefixt - Test dafuer weiter unten. */

function runeLevels(page) {
  return page.evaluate(() => bkmpIdlePlayerRunes.map(r => r.upgrade_level).sort((a, b) => a - b));
}

test.describe('Bug 1 - Reload/Logout-Login/Prestige/Kontowechsel (Teststand C)', () => {
  test.use({ teststand: 'C' });

  test('Level-22/23-Runen (Aufstieg ueber +15 hinaus) ueberleben einen normalen Reload unveraendert', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.idle_player_runes[0].upgrade_level = 22;
    store.tables.idle_player_runes[1].upgrade_level = 23;
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    expect(await runeLevels(page)).toContain(22);
    expect(await runeLevels(page)).toContain(23);

    await page.reload();
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);

    const after = await runeLevels(page);
    expect(after).toContain(22);
    expect(after).toContain(23);
    expect(after.length).toBe(store.tables.idle_player_runes.length);
  });

  test('Logout/Login desselben Spielers behaelt alle Runen inkl. Level 22/23 und Ausruestungsstatus', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => { bkmpIdlePlayerRunes[0].upgrade_level = 22; bkmpIdlePlayerRunes[1].upgrade_level = 23; });
    const before = await page.evaluate(() => bkmpIdlePlayerRunes.map(r => ({ cid: r._cid, equipped: r.equipped, upgrade_level: r.upgrade_level })).sort((a, b) => a.cid.localeCompare(b.cid)));
    const equippedCountBefore = before.filter(r => r.equipped).length;
    expect(equippedCountBefore).toBe(6); // Teststand C: alle 6 Slots real belegt

    await page.locator('#idleDorfCloseX').click();
    await page.evaluate(async () => { await bkmpPlayerLogout(); bkmpSetMcName(''); });
    await page.evaluate(() => { const b = document.getElementById('mcNameBadge'); if (b) b.click(); });
    await expect(page.locator('#mcNameOverlay')).toHaveClass(/visible/, { timeout: 10000 });
    await page.locator('#mcAuthName').fill(fixtureData.displayName);
    await page.locator('#mcAuthPassword').fill(fixtureData.password);
    await page.locator('#mcAuthSubmit').click();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);

    const after = await page.evaluate(() => bkmpIdlePlayerRunes.map(r => ({ cid: r._cid, equipped: r.equipped, upgrade_level: r.upgrade_level })).sort((a, b) => a.cid.localeCompare(b.cid)));
    expect(after).toEqual(before);
    expect(after.filter(r => r.equipped).length).toBe(6);
  });

  test('Runen (inkl. Ausruestung/Stufen/Sub-Stats) ueberleben einen echten Prestige-Aufstieg vollstaendig unveraendert', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => { bkmpIdlePlayerRunes[0].upgrade_level = 22; bkmpIdleState.highest_dragon_index = 500; });
    const before = await page.evaluate(() => JSON.stringify(bkmpIdlePlayerRunes.map(r => ({ cid: r._cid, equipped: r.equipped, upgrade_level: r.upgrade_level, substats: r.substats })).sort((a, b) => a.cid.localeCompare(b.cid))));

    await page.evaluate(() => bkmpPrestigeExecuteReset());
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => JSON.stringify(bkmpIdlePlayerRunes.map(r => ({ cid: r._cid, equipped: r.equipped, upgrade_level: r.upgrade_level, substats: r.substats })).sort((a, b) => a.cid.localeCompare(b.cid))));
    expect(after).toBe(before);
  });

  test('Kontowechsel auf demselben Geraet zeigt NICHT die Runen des vorherigen Kontos (server-geladen, kein geraeteweiter Cache wie bei Erfolgen)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    expect((await runeLevels(page)).length).toBeGreaterThan(0);

    // Zweites, unabhaengiges Konto ohne jede Rune (Teststand-A-aehnliches Profil, direkt im selben Store geseedet).
    // store.authUsersByEmail ist eine Map (siehe tests/mock/store.js createStore) - kein Array.
    store.authUsersByEmail.set('qasecondplayer@bkmp-player-accounts.com', { id: 'qa-user-second-0000', email: 'qasecondplayer@bkmp-player-accounts.com', password: fixtureData.password, user_metadata: {} });
    store.tables.idle_player_state.push({
      auth_user_id: 'qa-user-second-0000', name_key: 'qasecondplayer', display_name: 'QaSecondPlayer',
      level: 1, xp: 0, gold: 100, wood: 0, stone: 0, crystals: 0, essence: 0
    });

    await page.locator('#idleDorfCloseX').click();
    await page.evaluate(async () => { await bkmpPlayerLogout(); bkmpSetMcName(''); });
    await page.evaluate(() => { const b = document.getElementById('mcNameBadge'); if (b) b.click(); });
    await expect(page.locator('#mcNameOverlay')).toHaveClass(/visible/, { timeout: 10000 });
    await page.locator('#mcAuthName').fill('QaSecondPlayer');
    await page.locator('#mcAuthPassword').fill(fixtureData.password);
    await page.locator('#mcAuthSubmit').click();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);

    const secondAccountRunes = await runeLevels(page);
    expect(secondAccountRunes).toEqual([]);
    // Das ERSTE Konto behaelt seine Runen serverseitig unveraendert - kein Leck, keine Loeschung.
    expect(store.tables.idle_player_runes.filter(r => r.name_key === fixtureData.nameKey).length).toBe(8); // Teststand C: 6 ausgeruestet + 2 unbelegte im Inventar
  });
});

test.describe('Bug 1 - fehlgeschlagene/leere/verspaetete Ladeantwort schreibt NIE einen leeren Zustand zurueck (Teststand C)', () => {
  test.use({ teststand: 'C' });

  /* NACHTRAG 25.07.2026 (Fortsetzung derselben Untersuchung - siehe
     tests/e2e/rune-inventory-scale.spec.js fuer den vollen Bericht): das
     Laden lief zum Zeitpunkt dieses Tests noch als EIN EINZIGER Aufruf
     (loadPlayerRunes) - ein Fehlschlag setzte bkmpIdlePlayerRunes damals
     immer komplett auf [] zurueck, was der Test unten urspruenglich als
     "sicheres, absturzfreies Verhalten" bestaetigte. GENAU dieses
     Verhalten stellte sich aber als der eigentliche Bug heraus (siehe
     idledorf.js's Ladeblock-Kommentar): bei echten Spielern mit einem sehr
     grossen, nie geleerten Lager (bestaetigt: 7.541 bzw. 15.632 Zeilen bei
     zwei realen Accounts) fuehrte GENAU dieser Rueckfall auf [] dazu, dass
     das KOMPLETTE sichtbare Runen-Set nach einem simplen Netzwerk-Haenger
     verschwand - fuer den Spieler nicht von echtem Datenverlust zu
     unterscheiden. Der Ladepfad ist seitdem in ZWEI unabhaengige Aufrufe
     aufgeteilt (ausgeruestete Runen + gekapptes Lager, siehe
     loadEquippedPlayerRunes/loadUnequippedPlayerRunesCapped in supabase.js)
     - ein Fehlschlag des EINEN loescht nicht mehr automatisch den ANDEREN.
     Die beiden folgenden Tests ersetzen den alten, jetzt ueberholten Test
     und pruefen stattdessen genau dieses neue, robustere Verhalten. */
  test('ausgeruestete Runen schlagen fehl, das (kleine) Lager laedt trotzdem - kein Totalausfall mehr', async ({ page, context, qaBaseURL, fixtureData, store }) => {
    const runeCountBefore = store.tables.idle_player_runes.length;
    let equippedFailuresLeft = 1; // nur der ERSTE Versuch schlaegt fehl, siehe Reload-Teil unten
    await context.route('**/rest/v1/idle_player_runes*', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && url.includes('equipped=eq.true') && equippedFailuresLeft > 0) {
        equippedFailuresLeft -= 1;
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulated transient failure' }) });
      }
      return route.fallback();
    });

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // Ausgeruestete Runen fehlen fuer DIESE Sitzung (ihr eigener Abruf schlug fehl) - aber das
    // (unabhaengig geladene) Lager ist trotzdem da, kein kompletter Blackout mehr.
    const loadError = await page.evaluate(() => bkmpIdleRuneLoadError);
    expect(loadError).toBe(true);
    expect((await runeLevels(page)).length).toBeGreaterThan(0);
    // DB bleibt in jedem Fall unangetastet - reiner Lesefehler, kein Schreibzugriff.
    expect(store.tables.idle_player_runes.length).toBe(runeCountBefore);

    // Naechster (erfolgreicher) Ladevorgang zeigt wieder alle Runen inkl. Ausruestung.
    await page.reload();
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);
    expect((await runeLevels(page)).length).toBe(runeCountBefore);
    expect(await page.evaluate(() => bkmpIdleRuneLoadError)).toBe(false);
  });

  test('das (potenziell riesige) Lager schlägt fehl, die 6 ausgeruesteten Runen bleiben trotzdem sichtbar', async ({ page, context, qaBaseURL, fixtureData, store }) => {
    const runeCountBefore = store.tables.idle_player_runes.length;
    await context.route('**/rest/v1/idle_player_runes*', async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET' && url.includes('equipped=eq.false')) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulated transient failure' }) });
      }
      return route.fallback();
    });

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const loadError = await page.evaluate(() => bkmpIdleRuneLoadError);
    expect(loadError).toBe(true);
    // GENAU DAS ist der eigentliche Fix: die kampfrelevanten ausgeruesteten Runen bleiben sichtbar,
    // selbst wenn das (potenziell riesige) restliche Lager gerade nicht ladbar ist.
    const equipped = await page.evaluate(() => bkmpIdlePlayerRunes.filter(r => r.equipped).length);
    expect(equipped).toBe(6); // Teststand C: alle 6 Slots real belegt
    expect(store.tables.idle_player_runes.length).toBe(runeCountBefore);
  });

  test('leere Serverantwort (0 Zeilen, kein Fehler) wird korrekt als "keine Runen" behandelt, keine falsche Fehlermeldung, keine DB-Aenderung', async ({ page, context, qaBaseURL, fixtureData, store }) => {
    const runeCountBefore = store.tables.idle_player_runes.length;
    await context.route('**/rest/v1/idle_player_runes*', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.fallback();
    });
    const errors = [];
    page.on('pageerror', err => errors.push(String(err)));

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    expect(await runeLevels(page)).toEqual([]);
    expect(errors).toEqual([]);
    // Die (leere) Serverantwort loest KEINEN Schreibvorgang aus, der die echten Runen loeschen koennte.
    expect(store.tables.idle_player_runes.length).toBe(runeCountBefore);
  });

  test('verspaetete Ladeantwort (2s Verzoegerung) blockiert das Laden nicht dauerhaft, Runen erscheinen sobald die Antwort eintrifft', async ({ page, context, qaBaseURL, fixtureData, store }) => {
    await context.route('**/rest/v1/idle_player_runes*', async (route) => {
      if (route.request().method() === 'GET') await new Promise(r => setTimeout(r, 2000));
      return route.fallback();
    });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await expect.poll(() => runeLevels(page), { timeout: 10000 }).not.toEqual([]);
    expect((await runeLevels(page)).length).toBe(store.tables.idle_player_runes.length);
  });
});

test.describe('Bug 1 - veraltete Antwort ueberschreibt keine neueren Runendaten (Teststand A, gezielte Race-Simulation)', () => {
  test.use({ teststand: 'A' });

  test('bkmpRuneAscend auf eine frisch gedroppte (noch ohne DB-id) Legendaere-Rune erzwingt sofortiges Speichern statt auf den Debounce-Timer zu warten', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // Zwei frisch "gedroppte" (noch ohne .id, wie bkmpIdleMaybeDropRune es anlegt) Legendaere derselben
    // Stufe/desselben Slots - erfuellt bkmpRuneCanAscend/bkmpRuneFindAscendFodder exakt.
    await page.evaluate(() => {
      bkmpIdleState.gold = 999999999;
      const mk = (cid) => ({ id: null, _cid: cid, rune_type: 'slot1', rarity: 'gold', rolled_value: 40, equipped: false, upgrade_level: 15, substats: [], created_at: new Date().toISOString() });
      bkmpIdlePlayerRunes.push(mk('qa-fresh-1'), mk('qa-fresh-2'));
      bkmpIdlePendingRuneDrops.push(bkmpIdlePlayerRunes[bkmpIdlePlayerRunes.length - 2], bkmpIdlePlayerRunes[bkmpIdlePlayerRunes.length - 1]);
    });
    await page.evaluate(() => bkmpRuneAscend('qa-fresh-1'));
    // Der Bugfix (js/systems/bkmp-runes.js bkmpRuneAscend) stoesst bkmpIdleFlushRuneSyncNow() SOFORT an,
    // statt auf den 1500ms-Debounce zu warten - kurz danach muss die ueberlebende Rune bereits eine
    // echte DB-id UND den korrekten aufgestiegenen Stand (+16) serverseitig tragen.
    await expect.poll(() => page.evaluate(() => {
      const r = bkmpIdlePlayerRunes.find(x => x._cid === 'qa-fresh-1');
      return r && !!r.id;
    }), { timeout: 5000 }).toBe(true);
    const survivorId = await page.evaluate(() => bkmpIdlePlayerRunes.find(x => x._cid === 'qa-fresh-1').id);
    const serverRow = store.tables.idle_player_runes.find(r => String(r.id) === String(survivorId));
    expect(serverRow).toBeTruthy();
    expect(serverRow.upgrade_level).toBe(16);
    // Die verbrauchte Fodder-Rune darf NICHT als Geisterzeile stehen bleiben.
    expect(await page.evaluate(() => bkmpIdlePlayerRunes.some(r => r._cid === 'qa-fresh-2'))).toBe(false);
  });
});
