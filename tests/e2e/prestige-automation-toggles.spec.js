const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Direkte Antwort auf eine Nutzer-Nachfrage (26.07.2026, Screenshot der
   "Automatischer Bosskampf"-Prestige-Karte, "Und das Funktioniert?") - keiner
   der drei neuen Automation-Zweig-Schalter aus Progression-Rebalance Phase 5
   (bkmpIdleRunAutomationToggles(), idledorf.js) hatte bisher einen
   dedizierten Test, der den TATSAECHLICHEN Lauf beweist (nur Ascension/
   Building-Overload/Auto-Kauf-Skalierung aus Phase 16 waren abgedeckt).

   Testet den echten Produktionscode-Pfad, keine Kopie: bkmpIdleTick() (echter
   setInterval-Loop, ~900ms) ruft bkmpIdleRunAutomationToggles() jeden Tick
   auf - der Test laesst diesen Loop unter einer synchron mitlaufenden
   gefaketen Uhr (useFakeClock) tatsaechlich feuern, statt die Automation
   direkt aufzurufen, damit auch der Verdrahtungs-/Throttle-Teil real
   mitgeprueft wird. */

test.describe('Automatisierungs-Schalter (Prestige-Zweig "Automation") - Teststand C', () => {
  // 08:56 UTC = 5 Minuten vor der vollen Stunde -> bkmpRaidGetPhaseInfo()
  // meldet 'prep' fuer den Raid der naechsten Stunde (siehe bkmp-raid.js:84).
  // Berlin-Stunde des Raid-Starts ist 10 Uhr (Winterzeit) - NICHT die per
  // Gildenboss-Kollision pausierte 20-Uhr-Stunde (siehe raid_join-Guard in
  // tests/mock/rpc-engine.js).
  test.use({ teststand: 'C', startTimeMs: Date.parse('2026-01-15T08:56:00.000Z'), useFakeClock: true });

  /* Die Standard-Teststaende A-G (im Gegensatz zur eigenen Mehrspieler-Fixture
     in raid.spec.js) seeden nie eine raid_bosses-Zeile - raid_join() lehnt
     ohne einen aktiven Boss mit 'no_active_boss' ab (rpc-engine.js). Fuer
     einen Einzelspieler-Automations-Test reicht ein einzelner, minimaler
     Boss-Datensatz, direkt vor dem ersten Seitenaufruf in denselben Store
     geschrieben, den qaBaseURL bereits bedient. */
  const RAID_BOSS = {
    id: 'zerathor', name: 'Zerathor, Zorn der Verdammnis', sprite_key: 'zerathor',
    base_hp: 500000, base_attack: 90, attack_interval_seconds: 6, hp_scale_per_attack: 150,
    gold_reward: 1500000, gem_reward: 1000, xp_reward: 150000,
    wood_reward: 50000, stone_reward: 50000, essence_reward: 2000, active: true
  };

  test('Automatischer Bosskampf (auto_raid_join_unlock): tritt einem Raid in der Vorbereitungsphase von selbst bei', async ({ page, qaBaseURL, fixtureData, store, qaClock }) => {
    store.tables.raid_bosses = [{ ...RAID_BOSS }];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const setup = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatischer_bosskampf = 1;
      const info = bkmpRaidGetPhaseInfo();
      return { bonus: bkmpPrestigeBonus('auto_raid_join_unlock'), phase: info.phase, raidId: info.raidId, alreadyJoined: bkmpRaidHasJoined(info.raidId) };
    });
    expect(setup.bonus).toBeGreaterThan(0);
    expect(setup.phase).toBe('prep');
    expect(setup.alreadyJoined).toBe(false);

    // 3 echte Tick-Intervalle vorspulen (echter setInterval-Callback feuert
    // innerhalb der gefaketen Zeit) - genug fuer den 10s-Automations-
    // Throttle, ohne die 5-Minuten-Vorbereitungsphase zu verlassen.
    await qaClock.advance(store, 3000);

    /* bkmpRaidJoin() ist bewusst fire-and-forget (nicht awaited) im
       Dispatcher - der Netzwerk-Roundtrip laeuft ueber die ECHTE (nicht
       gefakete) Event-Loop-Zeit, unabhaengig von der gefaketen Spieluhr.
       page.clock.fastForward() wartet nur, bis der SYNCHRONE Teil des
       Timer-Callbacks zurueckkehrt, nicht bis ein von ihm angestossenes
       Promise aufgeloest ist - eine sofortige Pruefung direkt danach ist
       deshalb ein echtes Test-Race (beobachtet: 2 von 5 Wiederholungen
       schlugen ohne dieses Polling fehl), kein App-Bug. */
    await expect.poll(() => page.evaluate((raidId) => bkmpRaidHasJoined(raidId), setup.raidId), { timeout: 5000 }).toBe(true);

    const participantRow = (store.tables.raid_participants || []).find(r => r.raid_id === setup.raidId);
    expect(participantRow).toBeTruthy();
    expect(participantRow.auth_user_id).toBeTruthy();
  });

  test('Ohne den Prestige-Rang passiert nichts: kein automatischer Beitritt trotz Vorbereitungsphase', async ({ page, qaBaseURL, fixtureData, store, qaClock }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const setup = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      delete bkmpPrestigeState.prestige_allocations.automatischer_bosskampf;
      const info = bkmpRaidGetPhaseInfo();
      return { bonus: bkmpPrestigeBonus('auto_raid_join_unlock'), phase: info.phase, raidId: info.raidId };
    });
    expect(setup.bonus).toBe(0);
    expect(setup.phase).toBe('prep');

    await qaClock.advance(store, 3000);
    await page.waitForTimeout(1000); // Puffer fuer einen faelschlich ausgeloesten, asynchronen Join

    const after = await page.evaluate((raidId) => bkmpRaidHasJoined(raidId), setup.raidId);
    expect(after).toBe(false);
  });

  /* Spieler-Wunsch (04.08.2026, BagonTr01 im Feedback-Discord): "ist
     irgendwie ne Moeglichkeit das man das automatische Bossbeitreten [beim
     stuendlichen Weltboss] an und ausschalten kann?" - siehe Kommentar bei
     BKMP_RAID_AUTO_JOIN_ENABLED_KEY in bkmp-raid.js fuer die volle
     Herleitung. Zwei neue Tests: der lokale Schalter selbst (Engine-Ebene,
     identisches Fixture-Setup wie der erste Test oben, nur mit dem
     Schalter explizit ausgeschaltet) + die Checkbox an der Knotenkarte im
     Prestige-Baum (UI-Ebene). */
  test('Automatischer Bosskampf mit lokal AUSGESCHALTETEM Schalter: kein Beitritt trotz Prestige-Freischaltung', async ({ page, qaBaseURL, fixtureData, store, qaClock }) => {
    store.tables.raid_bosses = [{ ...RAID_BOSS }];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const setup = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatischer_bosskampf = 1;
      bkmpRaidAutoJoinEnabledSet(false);
      const info = bkmpRaidGetPhaseInfo();
      return { bonus: bkmpPrestigeBonus('auto_raid_join_unlock'), enabled: bkmpRaidAutoJoinEnabledGet(), phase: info.phase, raidId: info.raidId };
    });
    expect(setup.bonus).toBeGreaterThan(0);
    expect(setup.enabled).toBe(false);
    expect(setup.phase).toBe('prep');

    await qaClock.advance(store, 3000);
    await page.waitForTimeout(1000); // Puffer fuer einen faelschlich ausgeloesten, asynchronen Join

    const after = await page.evaluate((raidId) => bkmpRaidHasJoined(raidId), setup.raidId);
    expect(after).toBe(false);

    // Positivkontrolle im selben Test: erneut einschalten laesst den Beitritt
    // sofort (naechster 10s-Automations-Durchlauf) wieder greifen - beweist,
    // dass der Schalter tatsaechlich beide Richtungen steuert, nicht nur
    // einmalig einen Zustand einfriert.
    await page.evaluate(() => bkmpRaidAutoJoinEnabledSet(true));
    await qaClock.advance(store, 11000);
    await expect.poll(() => page.evaluate((raidId) => bkmpRaidHasJoined(raidId), setup.raidId), { timeout: 5000 }).toBe(true);
  });

  test('Checkbox "Automatisch beitreten" erscheint erst nach dem Kauf, spiegelt+setzt den lokalen Schalter korrekt', async ({ page, qaBaseURL, fixtureData }, testInfo) => {
    // Einziger Test in dieser Datei mit einem echten Desktop-Tab-Klick
    // (alle anderen rufen die Automations-/Bonus-Funktionen direkt auf) -
    // gleiches, bereits etabliertes Muster wie prestige.spec.js: auf
    // mobile-*-Projekten ist #idleTabBtnPrestige korrekt unsichtbar
    // (kompakte Navigation), kein App-Bug.
    test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt einen echten Desktop-Tab-Klick - siehe Kommentar oben, mobile-smoke.spec.js deckt die kompakte Navigation ab');
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnPrestige').click();

    const beforePurchase = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      // "Automation"-Zweig ist erst ab 100 investierten Punkten ueberhaupt
      // sichtbar (bkmpPrestigeBranchUnlocked, siehe Meilenstein "Erweiterter
      // Baum") - ohne das wuerde die Karte gar nicht erst gerendert.
      bkmpPrestigeState.prestige_points_spent = 100;
      delete bkmpPrestigeState.prestige_allocations.automatischer_bosskampf;
      bkmpPrestigeSetActiveBranch('automation');
      bkmpIdleRenderPrestigePanel();
      return document.querySelector('.idle-prestige-raidjoin-checkbox') !== null;
    });
    expect(beforePurchase).toBe(false);

    const afterPurchase = await page.evaluate(() => {
      bkmpPrestigeState.prestige_allocations.automatischer_bosskampf = 1;
      bkmpIdleRenderPrestigePanel();
      const cb = document.querySelector('.idle-prestige-raidjoin-checkbox');
      return { present: !!cb, checkedByDefault: cb ? cb.checked : null };
    });
    expect(afterPurchase.present).toBe(true);
    // Default TRUE (siehe Kommentar bei BKMP_RAID_AUTO_JOIN_ENABLED_KEY) -
    // bestehendes Verhalten fuer alle, die den Schalter nie anfassen.
    expect(afterPurchase.checkedByDefault).toBe(true);

    await page.click('.idle-prestige-raidjoin-checkbox');
    const afterUncheck = await page.evaluate(() => ({
      checked: document.querySelector('.idle-prestige-raidjoin-checkbox').checked,
      stored: bkmpRaidAutoJoinEnabledGet()
    }));
    expect(afterUncheck.checked).toBe(false);
    expect(afterUncheck.stored).toBe(false);

    // Ueberlebt einen erneuten Panel-Render (z.B. durch einen anderen Kauf
    // ausgeloest) - liest den Zustand aus localStorage, nicht aus einer
    // reinen DOM-Checkbox-Erinnerung.
    await page.evaluate(() => bkmpIdleRenderPrestigePanel());
    const stillUnchecked = await page.evaluate(() => document.querySelector('.idle-prestige-raidjoin-checkbox').checked);
    expect(stillUnchecked).toBe(false);
  });

  test('Automatische Rune-Aufwertung (auto_rune_upgrade_unlock): wertet die guenstigste ausgeruestete Rune ohne Klick auf', async ({ page, qaBaseURL, fixtureData, store, qaClock }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const before = await page.evaluate(() => {
      if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 1, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
      bkmpPrestigeState.prestige_allocations.automatische_runenaufwertung = 1;
      bkmpIdleState.gold = 999999999;
      const equipped = bkmpIdlePlayerRunes.filter(r => r.equipped);
      return {
        bonus: bkmpPrestigeBonus('auto_rune_upgrade_unlock'),
        equippedCount: equipped.length,
        gold: bkmpIdleState.gold
      };
    });
    expect(before.equippedCount).toBeGreaterThan(0);

    await qaClock.advance(store, 3000);

    /* bkmpRuneUpgrade() hat eine ABSICHTLICHE Fehlschlagchance (Nutzerwunsch
       15.07., siehe Kommentar in bkmp-runes.js: Gold ist bei einem
       Fehlschlag trotzdem weg, nur die Stufe steigt dann nicht) - eine
       Pruefung auf "irgendeine Stufe ist gestiegen" waere deshalb nur
       probabilistisch wahr (in ~30% von 10 Wiederholungen tatsaechlich
       beobachtet), selbst wenn die Automatisierung korrekt jeden Tick
       auslöst. Der zuverlaessige, deterministische Beweis dafuer, dass die
       Automatisierung tatsaechlich einen Aufwertungsversuch ausgeloest hat,
       ist der Gold-Abzug (passiert IMMER, unabhaengig vom Wuerfelergebnis). */
    await expect.poll(() => page.evaluate(() => bkmpIdleState.gold), { timeout: 5000 }).toBeLessThan(before.gold);
  });
});
