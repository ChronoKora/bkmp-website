const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Server-seitige Tempo-Grenze gegen Timer-Speedhacks/direkte Zustands-
   Manipulation (Spieler-Meldung 30.07.2026, Feedback-Board-Screenshot + 2
   Beweisvideos). Volle Begruendung in sql/20260730-idle-player-state-
   anticheat-guard.sql und CLAUDE.md. Diese Suite testet den JS-Nachbau des
   Postgres-Triggers (tests/mock/anticheat-guard.js, verdrahtet in
   tests/mock/rest-engine.js's PATCH-Zweig) - die reale Formel/Konstanten
   sind absichtlich identisch zur SQL-Datei gehalten (MAX_KILLS_PER_SECOND=3,
   MIN_ELAPSED_SECONDS=4), siehe dortige Kommentare fuer die Herleitung.

   Jeder Test flusht EINMAL bewusst VOR der eigentlichen Test-Mutation
   ("Settle-Flush") - beim ersten Entwurf schlug eine Zeile mit einer
   unerwarteten Gold-Abweichung fehl: ohne diesen Schritt kann ein voellig
   unabhaengiger, legitimer Vorgang (z.B. der bestehende Tages-Login-
   Streak-Bonus) noch NICHT in der DB stehen, obwohl bkmpIdleState ihn
   clientseitig schon zeigt - der eigentliche Test-Flush wuerde dann BEIDE
   Aenderungen (Bonus + eigene Mutation) in einem Rutsch einreichen und
   die Kuerzungs-Ratio auf eine falsche Ausgangsbasis anwenden. Der Settle-
   Flush macht den DB-Stand VOR jeder Messung nachweislich deckungsgleich
   mit bkmpIdleState - kein Bug im neuen Guard, nur eine Testreihenfolge-
   Frage. */

test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Reine Speicher-/Server-Logik, keine UI-Interaktion noetig - deckt sich mit save-load.spec.js.');
});

function findRow(store, fixtureData) {
  return store.tables.idle_player_state.find(r => r.auth_user_id === fixtureData.authUserId);
}

function snapshot(store, fixtureData) {
  return { ...findRow(store, fixtureData) };
}

function setLastSavedSecondsAgo(store, fixtureData, seconds) {
  findRow(store, fixtureData).updated_at = new Date(Date.now() - seconds * 1000).toISOString();
}

async function settle(page) {
  await page.evaluate(() => { bkmpIdleQueueSync(); });
  await page.evaluate(() => bkmpIdleFlushSyncNow());
}

test.describe('Anti-Cheat-Tempo-Guard (idle_player_state)', () => {
  test.use({ teststand: 'A' });

  test('kleine, normale Aenderung innerhalb der Debounce-Zeit bleibt unangetastet', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await settle(page);
    setLastSavedSecondsAgo(store, fixtureData, 4); // exakt an der Debounce-/Mindestgrenze
    const before = snapshot(store, fixtureData);

    await page.evaluate(() => {
      bkmpIdleState.dragon_kills += 5; // 5 Kills in 4s = 1,25/s, weit unter dem 3/s-Limit
      bkmpIdleState.gold += 300;
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.dragon_kills)).toBe(Number(before.dragon_kills) + 5);
    expect(Number(row.gold)).toBe(Number(before.gold) + 300);
    expect((store.tables.idle_anticheat_flags || []).length).toBe(0);
  });

  test('implausibler Kills-/Ressourcen-Sprung in kurzer Zeit wird anteilig gekuerzt und protokolliert', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await settle(page);
    setLastSavedSecondsAgo(store, fixtureData, 4); // erlaubt maximal 4*3=12 Kills
    const before = snapshot(store, fixtureData);

    await page.evaluate(() => {
      bkmpIdleState.dragon_kills += 12000; // weit jenseits von 12 - klassisches Speedhack-Muster
      bkmpIdleState.boss_kills += 1200;
      bkmpIdleState.gold += 600000;
      bkmpIdleState.xp += 50000;
      bkmpIdleState.level += 40;
      bkmpIdleState.skill_points_available += 40;
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    // erlaubtes Delta = 4s * 3/s = 12 -> ratio = 12/12000 = 0.001
    const ratio = 0.001;
    expect(Number(row.dragon_kills)).toBe(Number(before.dragon_kills) + 12);
    expect(Number(row.boss_kills)).toBe(Number(before.boss_kills) + Math.floor(1200 * ratio));
    expect(Number(row.gold)).toBe(Number(before.gold) + Math.floor(600000 * ratio));
    expect(Number(row.xp)).toBe(Number(before.xp) + Math.floor(50000 * ratio));
    expect(Number(row.level)).toBe(Number(before.level) + Math.floor(40 * ratio));
    expect(Number(row.skill_points_available)).toBe(Number(before.skill_points_available) + Math.floor(40 * ratio));

    const flags = store.tables.idle_anticheat_flags || [];
    expect(flags.length).toBe(1);
    expect(flags[0].name_key).toBe(fixtureData.nameKey);
    expect(Number(flags[0].claimed_dragon_kills_delta)).toBe(12000);
    expect(Number(flags[0].allowed_dragon_kills_delta)).toBe(12);
  });

  test('grosser, aber ueber lange echte Zeit plausibler Sprung (z.B. nach Offline-Claim) bleibt unangetastet', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await settle(page);
    setLastSavedSecondsAgo(store, fixtureData, 5 * 3600); // 5 echte Stunden seit dem letzten Speichern
    const before = snapshot(store, fixtureData);

    await page.evaluate(() => {
      bkmpIdleState.dragon_kills += 5000; // erlaubtes Budget hier: 5*3600*3 = 54.000 - 5000 bleibt weit darunter
      bkmpIdleState.gold += 900000;
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.dragon_kills)).toBe(Number(before.dragon_kills) + 5000);
    expect(Number(row.gold)).toBe(Number(before.gold) + 900000);
    expect((store.tables.idle_anticheat_flags || []).length).toBe(0);
  });

  test('fallende Werte (z.B. Ausgeben/Prestige-Reset) werden nie gekuerzt, auch nicht in einer geflaggten Speicherung', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    // Etwas Startgold, damit ein echtes Verringern ueberhaupt sichtbar ist.
    await page.evaluate(() => { bkmpIdleState.gold = 5000; bkmpIdleQueueSync(); });
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    setLastSavedSecondsAgo(store, fixtureData, 4);
    const before = snapshot(store, fixtureData);

    await page.evaluate(() => {
      bkmpIdleState.dragon_kills += 9000; // loest die Kuerzung aus
      bkmpIdleState.gold = 100; // gleichzeitig: Gold sinkt (z.B. ausgegeben) - MUSS exakt erhalten bleiben
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.dragon_kills)).toBe(Number(before.dragon_kills) + 12); // weiterhin gekuerzt
    expect(Number(row.gold)).toBe(100); // unveraendert uebernommen, nicht auf den alten Wert zurueckgesetzt
  });
});
