const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Garantierter Mindestlohn fuer Offline-/AFK-Kampf-Belohnungen (21.08.2026).
   Spieler-Meldung BagonTr01: "ganzen Abend weg... nichts bekommen fuers
   AFK". Root Cause + volles Design siehe grosser Kommentar in
   api/claim-idle-offline-progress.js - kurz zusammengefasst: die gesamte
   Offline-Belohnung haengt bisher EINZIG am Erfolg der Zug-fuer-Zug-Kampf-
   simulation; ist die aktuelle Stufe innerhalb des Zeitbudgets nicht
   gewinnbar (z.B. ein Spieler, der weit ueber seiner Kampfkraft steht),
   bricht die Simulation bei der allerersten Iteration ab und JEDE
   Ressource bleibt bei 0, unabhaengig von der Abwesenheitsdauer.

   Laeuft wie offline-afk.spec.js ueber die ECHTE, unveraenderte Handler-
   Datei (tests/mock/offline-progress-handler.js), keine Testkopie der
   Belohnungsformel - nur die Mock-Uhr wird vorgespult. */
test.describe('Offline-/AFK-Fortschritt - garantierter Mindestlohn', () => {
  test.use({ teststand: 'B' });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Reine Speicher-/Server-Logik, keine UI-Interaktion noetig - deckt sich mit offline-afk.spec.js.');
  });

  function findRow(store, fixtureData) {
    return store.tables.idle_player_state.find(r => r.name_key === fixtureData.nameKey);
  }

  async function claimOffline(page) {
    return page.evaluate(() => bkmpIdleClaimOfflineProgress(bkmpGetMcName()));
  }

  function setOfflineFloorConfig(store, value) {
    const row = store.tables.idle_game_config.find(r => r.key === 'offline_floor');
    if (row) row.value = value;
    else store.tables.idle_game_config.push({ key: 'offline_floor', value });
  }

  // Erste Testfassung nutzte nur current_dragon_index=5000, um eine
  // unwinnbare Stufe zu simulieren - schlug fehl (352 echte Kills statt der
  // erwarteten 0): Teststand Bs eigene Kampfwerte reichten trotz der weit
  // entfernten Stufe noch aus, um innerhalb des grosszuegigen 2h-Zeitbudgets
  // (Tausende moegliche Treffer) irgendwann doch zu gewinnen - ein reiner
  // Stufen-Sprung allein war kein verlaesslicher Weg, die Simulation
  // tatsaechlich scheitern zu lassen. Fix im Test: zusaetzlich die
  // Kampfwerte selbst auf ein garantiert unwinnbares Minimum kappen (gleiches
  // Prinzip wie beim dritten Test unten), kombiniert mit der hohen Stufe.
  function makeCombatUnwinnable(row) {
    row.current_dragon_index = 5000;
    row.highest_dragon_index = Math.max(row.highest_dragon_index || 0, 5000);
    row.attack = 1;
    row.defense = 0;
    row.crit_chance = 0;
    row.crit_damage = 100;
  }

  // Zweiter Testfassung-Fund: selbst mit auf 1/0 gekappten Werten fand die
  // Simulation bei 2h Abwesenheit noch 160 echte Kills - der bereits
  // bestehende exponentielle Rueckzug (siehe idle Belohnungscode weiter
  // oben in dieser Datei, "consecutiveDefeats"-Mechanik) arbeitet sich bei
  // GENUEGEND Zeitbudget zuverlaessig zu einer gewinnbaren Stufe zurueck -
  // das ist tatsaechlich der bereits am 20.07. gefixte Teil der Bug-Klasse,
  // funktioniert hier korrekt. Der historische "0 fuer die GESAMTE
  // Abwesenheit"-Fall (den der Mindestlohn absichern soll) tritt zuverlaessig
  // nur auf, wenn schon der ALLERERSTE Kampf laenger dauern wuerde als das
  // GESAMTE Zeitbudget - dafuer reicht bei einem grosszuegigen 12h-Deckel
  // eine kurze, aber immer noch ueber der 60s-Mindestschwelle liegende
  // Abwesenheit (der Rueckzugs-Mechanismus selbst wird dann nie erreicht,
  // siehe `if (simulatedSeconds + timeToKill > budgetSeconds) break;` VOR
  // der Rueckzugs-Pruefung in api/claim-idle-offline-progress.js).
  const SHORT_UNWINNABLE_WINDOW_MS = 3 * 60 * 1000; // 3 Min., budgetSeconds bei 50% Basis-Effizienz ≈ 90s

  test('REGRESSION: Spieler weit ueber seiner Kampfkraft (unwinnbare Stufe) bekommt trotzdem eine Belohnung statt der bisherigen harten 0', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const row = findRow(store, fixtureData);
    makeCombatUnwinnable(row);

    store.clock.advance(SHORT_UNWINNABLE_WINDOW_MS);
    const result = await claimOffline(page);

    expect(result.ok).toBe(true);
    expect(result.elapsedSeconds).toBeGreaterThanOrEqual(60);
    expect(result.rewards).not.toBeNull();
    expect(result.rewards.floorApplied).toBe(true);
    // dragonKills spiegelt bewusst max(simulierte Kills, Mindestlohn-Kills)
    // wider (Konsistenz-Anforderung aus dem Design: die Belohnungshoehe und
    // der angezeigte Kill-Zaehler sollen nie auseinanderlaufen) - hier also
    // exakt der Mindestlohn-Kill-Wert (floor(180s / 45s) = 4), NICHT 0, da
    // die echte Simulation an dieser Stufe zwar nichts geschafft hat, der
    // Mindestlohn dafuer aber konsistent eingesprungen ist.
    expect(result.rewards.dragonKills).toBe(4);
    // Der eigentliche Bug-Beweis: mindestens EINE Ressource ist jetzt > 0.
    const anyPositive = ['gold', 'xp', 'wood', 'stone'].some(k => result.rewards[k] > 0);
    expect(anyPositive).toBe(true);

    // Sicherheits-Anforderung aus dem Design: current_dragon_index darf vom
    // Mindestlohn NIE veraendert werden - ein Spieler, der seine Stufe nicht
    // schafft, soll nicht zusaetzlich auf eine noch schwerere Stufe vorruecken.
    expect(result.newTotals.current_dragon_index).toBe(5000);
  });

  test('REGRESSION: Kill-Schalter offline_floor.enabled=false stellt exakt das alte (fehlerhafte) Verhalten wieder her', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    setOfflineFloorConfig(store, { enabled: false });
    const row = findRow(store, fixtureData);
    makeCombatUnwinnable(row);

    store.clock.advance(SHORT_UNWINNABLE_WINDOW_MS);
    const result = await claimOffline(page);

    expect(result.ok).toBe(true);
    expect(result.rewards).not.toBeNull();
    expect(result.rewards.dragonKills).toBe(0);
    expect(result.rewards.floorApplied).toBeFalsy();
    // Mit abgeschaltetem Mindestlohn ist das alte Verhalten exakt reproduziert:
    // eine unwinnbare Stufe zahlt wieder komplett 0, ueber alle Ressourcen.
    ['gold', 'xp', 'wood', 'stone', 'crystals', 'essence'].forEach(k => {
      expect(result.rewards[k]).toBe(0);
    });
  });

  test('ein normaler, zur Stufe passender Spieler bekommt weiterhin die volle Simulation, der Mindestlohn greift nie ein', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // Teststand B ist bereits zu seiner eigenen aktuellen Stufe passend
    // ausbalanciert (unveraendert) - reiner Regressionsbeweis, dass die
    // neue Mindestlohn-Logik eine ohnehin funktionierende Simulation nicht
    // anfasst.
    store.clock.advance(30 * 60 * 1000);
    const result = await claimOffline(page);

    expect(result.ok).toBe(true);
    expect(result.rewards).not.toBeNull();
    expect(result.rewards.dragonKills).toBeGreaterThan(0);
    expect(result.rewards.floorApplied).toBeFalsy();
  });

  test('der Mindestlohn zahlt spuerbar WENIGER als eine echte erfolgreiche Simulation an derselben Stufe ueber dieselbe Zeit', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const row = findRow(store, fixtureData);
    const realStage = row.current_dragon_index;

    // Erst: normaler, gewinnbarer Lauf an der eigenen Stufe als Referenzwert.
    store.clock.advance(3 * 3600 * 1000);
    const winningResult = await claimOffline(page);
    expect(winningResult.rewards.dragonKills).toBeGreaterThan(0);

    // Direkt danach: derselbe Spieler, aber jetzt kuenstlich auf dieselbe
    // Stufe wie vorher zurueckgesetzt UND mit auf nahezu 0 gekappten Werten,
    // damit garantiert NICHTS mehr gewinnbar ist - reiner Mindestlohn-Pfad,
    // gleiche Referenzstufe wie der Gewinn-Lauf oben, gleiche Zeitspanne.
    row.current_dragon_index = realStage;
    row.attack = 1;
    row.defense = 0;
    row.crit_chance = 0;
    row.crit_damage = 100;
    store.clock.advance(3 * 3600 * 1000);
    const floorResult = await claimOffline(page);
    expect(floorResult.rewards.floorApplied).toBe(true);

    expect(floorResult.rewards.gold).toBeLessThan(winningResult.rewards.gold);
  });

  // Gleiches Fixture-Muster wie offline-companion-xp.spec.js: dragon_species/
  // player_dragons muessen VOR dem Login gesetzt sein, nicht danach per
  // push() nachgereicht (der Mock seedet/liest sie beim Login-Ablauf).
  const COMPANION_SPECIES = { id: 'qa-floor-companion-species', name: 'QA-Floor-Begleiter', rarity: 'episch', battle_xp_required: 100, growth_points_required: 10, egg_source: 'event', sort_order: 1 };

  test('Begleitdrache erhaelt eine kleine garantierte Kampf-EP-Trickle-Menge, wenn die Simulation komplett leer ausgeht', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [COMPANION_SPECIES];
    store.tables.player_dragons = [
      { id: 'qa-floor-companion-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: COMPANION_SPECIES.id, stage: 'teen', is_companion: true, battle_xp: 0, growth_points: 10, substats: [], hatched_at: fixtureData.nowIso, adult_at: null }
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const row = findRow(store, fixtureData);
    makeCombatUnwinnable(row);

    // Kalibriert (siehe Diagnose-Lauf beim Schreiben dieses Tests): bei
    // dieser Stufe/diesen Werten liefert die echte Simulation bis mindestens
    // 60 Min. Abwesenheit durchgaengig 0 echte Kills (dragonKills folgt exakt
    // floor(elapsedSeconds/45) - dem Mindestlohn-Wert, nicht der Simulation).
    // Erst bei laengeren Fenstern (getestet: 2h) findet der bereits
    // bestehende exponentielle Rueckzug irgendwann doch eine gewinnbare
    // Stufe - fuer diesen Test bewusst UNTER dieser Schwelle geblieben, um
    // den Mindestlohn-Pfad isoliert zu pruefen.
    store.clock.advance(3600 * 1000);
    const result = await claimOffline(page);

    expect(result.rewards.floorApplied).toBe(true);
    expect(result.rewards.dragonKills).toBe(80); // floor(3600s / 45s) - reiner Mindestlohn-Wert
    expect(result.rewards.dragonXpGain).toBe(8); // floor(1h * 8 XP/h)
  });
});
