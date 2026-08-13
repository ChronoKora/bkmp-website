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

/* Nachtrag 09.08.2026 - Spieler-Meldung: Account mit "9999999 Skillpunkte",
   oeffentliche Bestenliste mit "Level 846473". Root Cause bestaetigt: der
   obige Guard daempfte Level/Skillpunkte bisher NUR als Nebeneffekt eines
   implausiblen dragon_kills-Zuwachs - ein gezieltes Update, das NUR
   skill_points_available/level setzt und dragon_kills unangetastet laesst,
   loeste die Daempfung nie aus. sql/20260809-anticheat-guard-independent-
   fields.sql fuegt zwei unabhaengige Signale hinzu (Level-Zuwachs,
   Skillpunkte-GESAMT-Zuwachs), siehe tests/mock/anticheat-guard.js fuer den
   aktualisierten JS-Nachbau. */
test.describe('Anti-Cheat-Tempo-Guard - unabhaengige Level-/Skillpunkte-Signale (09.08.)', () => {
  test.use({ teststand: 'A' });

  test('gezielte Skillpunkte-Faelschung OHNE Kills-/Level-Aenderung wird jetzt erkannt und gekappt (der gemeldete Exploit)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await settle(page);
    setLastSavedSecondsAgo(store, fixtureData, 4); // Budget hier: 4*3+500 = 512
    const before = snapshot(store, fixtureData);

    await page.evaluate(() => {
      bkmpIdleState.skill_points_available += 9999999; // exakt das gemeldete Muster - kein Kill, kein Level-Aufstieg
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    // dragon_kills/level unveraendert (Delta 0) - werden von KEINEM Signal ausgeloest, bleiben exakt gleich.
    expect(Number(row.dragon_kills)).toBe(Number(before.dragon_kills));
    expect(Number(row.level)).toBe(Number(before.level));
    // skill_points_available wird auf genau das erlaubte Budget gekappt (512), NICHT proportional skaliert.
    expect(Number(row.skill_points_available)).toBe(Number(before.skill_points_available) + 512);

    const flags = store.tables.idle_anticheat_flags || [];
    expect(flags.length).toBe(1);
    expect(flags[0].triggered_by).toBe('skill_points');
    expect(Number(flags[0].claimed_skillpoints_delta)).toBe(9999999);
    expect(Number(flags[0].allowed_skillpoints_delta)).toBe(512);
  });

  test('gezielte Level-Faelschung OHNE Kills-/Skillpunkte-Aenderung wird jetzt erkannt und gekappt', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await settle(page);
    setLastSavedSecondsAgo(store, fixtureData, 4); // Budget hier: 4*3+500 = 512
    const before = snapshot(store, fixtureData);

    await page.evaluate(() => {
      bkmpIdleState.level += 846000; // exakt das gemeldete Muster (Bestenlisten-Screenshot "Level 846473")
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.dragon_kills)).toBe(Number(before.dragon_kills));
    expect(Number(row.skill_points_available)).toBe(Number(before.skill_points_available));
    expect(Number(row.level)).toBe(Number(before.level) + 512);

    const flags = store.tables.idle_anticheat_flags || [];
    expect(flags.length).toBe(1);
    expect(flags[0].triggered_by).toBe('level');
  });

  test('Skilltree-Zuruecksetzen (grosser Zuwachs von skill_points_available bei gleichzeitig sinkendem skill_points_spent) bleibt unangetastet', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    // Realistischen Vor-Reset-Zustand herstellen: 300 Punkte ausgegeben, 0 verfuegbar.
    await page.evaluate(() => {
      bkmpIdleState.skill_points_spent = 300;
      bkmpIdleState.skill_points_available = 0;
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    setLastSavedSecondsAgo(store, fixtureData, 4); // Budget hier: 4*3+500 = 512 - der Reset-Sprung (300) waere OHNE die Summen-Pruefung faelschlich betroffen gewesen, waere aber selbst mit 300 < 512 in diesem Einzelfall knapp durchgekommen. Deshalb zusaetzlich Fall B unten mit einem 900er-Reset (> 512), der die reine Zeit-Rate-Regel definitiv gerissen haette.
    const before = snapshot(store, fixtureData);

    await page.evaluate(() => {
      // Echtes "Zuruecksetzen": alle 300 ausgegebenen Punkte wandern zurueck in "verfuegbar".
      bkmpIdleState.skill_points_available = 300;
      bkmpIdleState.skill_points_spent = 0;
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.skill_points_available)).toBe(300); // voller Reset-Betrag angekommen, NICHT gekappt
    expect(Number(row.skill_points_spent)).toBe(0);
    expect(Number(row.dragon_kills)).toBe(Number(before.dragon_kills)); // unangetastet, kein Kampf beteiligt
    expect((store.tables.idle_anticheat_flags || []).length).toBe(0);
  });

  test('Skilltree-Zuruecksetzen mit einem Betrag WEIT UEBER dem Budget bleibt trotzdem unangetastet (beweist die Summen-Pruefung, nicht nur Zufall)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    // Vorbedingung (900 bereits ausgegeben) muss selbst als plausibel gelten,
    // sonst wuerde schon DIESER Setup-Schritt geflaggt (900 > 512-Budget bei
    // frisch angelegtem Account) und den eigentlichen Test verfaelschen -
    // deshalb hier bewusst weit in die Vergangenheit zurueckdatiert, so als
    // haette der Spieler diese 900 Punkte ganz normal ueber echte Zeit
    // erspielt.
    setLastSavedSecondsAgo(store, fixtureData, 999999);
    await page.evaluate(() => {
      bkmpIdleState.skill_points_spent = 900; // > Budget (512) - eine naive "available darf nicht schneller wachsen"-Regel wuerde das faelschlich kappen
      bkmpIdleState.skill_points_available = 0;
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    setLastSavedSecondsAgo(store, fixtureData, 4); // jetzt das enge Zeitfenster fuer die eigentliche Reset-Aktion

    await page.evaluate(() => {
      bkmpIdleState.skill_points_available = 900;
      bkmpIdleState.skill_points_spent = 0;
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.skill_points_available)).toBe(900); // voller Betrag, trotz 900 > 512-Budget - Summe (available+spent) blieb ja konstant bei 900
    expect(Number(row.skill_points_spent)).toBe(0);
    expect((store.tables.idle_anticheat_flags || []).length).toBe(0);
  });

  test('grosser, aber plausibler Level-/Skillpunkte-Sprung durch Dungeon-/Turm-Belohnung (innerhalb des Burst-Puffers) bleibt unangetastet', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await settle(page);
    setLastSavedSecondsAgo(store, fixtureData, 4); // Budget hier: 4*3+500 = 512
    const before = snapshot(store, fixtureData);

    await page.evaluate(() => {
      bkmpIdleState.level += 200; // deutlich unter dem 512er-Budget, aber weit ueber der reinen 12-Kills-Zeitrate - simuliert einen grossen Dungeon-/Turm-XP-Batch
      bkmpIdleState.skill_points_available += 200;
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.level)).toBe(Number(before.level) + 200);
    expect(Number(row.skill_points_available)).toBe(Number(before.skill_points_available) + 200);
    expect((store.tables.idle_anticheat_flags || []).length).toBe(0);
  });
});

/* Nachtrag 09.08.2026 (spaeter am selben Tag) - Spieler "OPShadowWolf" schickte
   3 Videos vom eigenen LIVE-Account (bkinvestment.de), die attack=420.45M
   (HUD-Anzeige) zeigen, jeder Boss wird instant one-shot besiegt. Bestaetigt:
   attack/defense/hp/crit_chance/crit_damage/gold_bonus/xp_bonus/loot_bonus
   sind Teil desselben Upserts wie dragon_kills/level/skill_points, hatten
   aber KEINE eigene Pruefung - ein gezieltes Update, das NUR diese Felder
   setzt und kills/level/skillpoints unangetastet laesst, rutschte durch.

   NACHTRAG 11.08.2026 (Nutzer-Meldung: "einige nicht mehr in der Leaderboards
   angezeigt"): die 09.08.-Fassung (relative 50x-pro-Speicherung-Grenze) war
   viel zu eng fuer dieses Spiel - Kampfwerte werden bei JEDER relevanten
   Aenderung (Prestige-Reset, Gilden-Technologie, Runen, Auto-Kauf) komplett
   NEU berechnet, ein legitimer Burst kann dadurch voellig normal mehr als
   das 50-fache in EINER Speicherung ausmachen. Live-Auswertung: 33 von 217
   Accounts wurden faelschlich ausgeblendet. sql/20260811-anticheat-guard-
   absolute-ceiling.sql ersetzt die relative Grenze durch eine absolute,
   vom vorherigen Wert komplett UNABHAENGIGE Obergrenze - siehe
   tests/mock/anticheat-guard.js (COMBAT_STAT_CEILINGS) fuer den JS-Nachbau
   und die volle Herleitung der Zahlen. */
test.describe('Anti-Cheat-Tempo-Guard - Kampfwerte-Obergrenze (11.08. absolute Grenze)', () => {
  test.use({ teststand: 'A' });

  test('gezielte Angriffswert-Faelschung OHNE Kills-/Level-/Skillpunkte-Aenderung wird erkannt und hart gekappt (der gemeldete Exploit)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await settle(page);
    const before = snapshot(store, fixtureData);

    await page.evaluate(() => {
      bkmpIdleState.attack = 420450000; // exakt das im Video gezeigte Muster
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.dragon_kills)).toBe(Number(before.dragon_kills));
    expect(Number(row.level)).toBe(Number(before.level));
    expect(Number(row.skill_points_available)).toBe(Number(before.skill_points_available));
    expect(Number(row.attack)).toBe(1000000); // absolute Obergrenze, unabhaengig vom alten Wert

    const flags = store.tables.idle_anticheat_flags || [];
    expect(flags.length).toBe(1);
    expect(flags[0].triggered_by).toBe('combat_stats');
    expect(flags[0].combat_stat_details.attack.old).toBe(Number(before.attack));
    expect(flags[0].combat_stat_details.attack.claimed).toBe(420450000);
    expect(flags[0].combat_stat_details.attack.capped_to).toBe(1000000);
  });

  test('mehrere Kampfwerte gleichzeitig gefaelscht werden alle einzeln erkannt und auf ihre jeweilige absolute Obergrenze gekappt', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await settle(page);
    const before = snapshot(store, fixtureData);

    await page.evaluate(() => {
      bkmpIdleState.attack = 9000000; // ueber der 1.000.000er-Grenze
      bkmpIdleState.crit_damage = 50000; // ueber der 5.000er-Grenze
      bkmpIdleState.hp = 5000000; // ueber der 2.000.000er-Grenze
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.attack)).toBe(1000000);
    expect(Number(row.crit_damage)).toBe(5000);
    expect(Number(row.hp)).toBe(2000000);
    // Unbeteiligte Kampfwerte bleiben exakt unangetastet.
    expect(Number(row.defense)).toBe(Number(before.defense));
    expect(Number(row.crit_chance)).toBe(Number(before.crit_chance));

    const flags = store.tables.idle_anticheat_flags || [];
    expect(flags.length).toBe(1);
    expect(Object.keys(flags[0].combat_stat_details).sort()).toEqual(['attack', 'crit_damage', 'hp']);
  });

  test('REGRESSION: ein grosser legitimer Burst (weit ueber der alten, zu engen 50x-Grenze) bleibt jetzt unangetastet - genau der am 11.08. gemeldete Falsch-Alarm', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await settle(page);

    await page.evaluate(() => {
      // 50.000x der alten 10 (weit ueber der frueheren 50x-Grenze), aber
      // deutlich unter der neuen absoluten 1.000.000er-Obergrenze - genau so
      // ein Sprung entsteht z.B. durch einen Prestige-Reset+Neu-Investition
      // oder einen mehrstufigen Auto-Kauf in einer einzigen Speicherung.
      bkmpIdleState.attack = 500000;
      bkmpIdleState.defense = 300000;
      bkmpIdleState.hp = 800000;
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.attack)).toBe(500000);
    expect(Number(row.defense)).toBe(300000);
    expect(Number(row.hp)).toBe(800000);
    expect((store.tables.idle_anticheat_flags || []).length).toBe(0);
  });

  test('fallende Kampfwerte (z.B. durch einen schwaecheren Ausruestungswechsel) werden nie angetastet', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await page.evaluate(() => { bkmpIdleState.attack = 500000; bkmpIdleQueueSync(); });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    await page.evaluate(() => {
      bkmpIdleState.attack = 300000; // sinkt - z.B. ein Runen-Wechsel oder Prestige-Reset
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.attack)).toBe(300000);
    expect((store.tables.idle_anticheat_flags || []).length).toBe(0);
  });

  test('Kampfwert-Faelschung UND implausibler Kills-Sprung im selben Speichervorgang - beide Signale werden protokolliert', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await settle(page);
    setLastSavedSecondsAgo(store, fixtureData, 4); // Kills-Budget hier: 12
    const before = snapshot(store, fixtureData);

    await page.evaluate(() => {
      bkmpIdleState.dragon_kills += 9000; // loest die bestehende Kills-Pruefung aus
      bkmpIdleState.attack = 9000000; // loest zusaetzlich die absolute Kampfwert-Obergrenze aus
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    const row = findRow(store, fixtureData);
    expect(Number(row.dragon_kills)).toBe(Number(before.dragon_kills) + 12); // weiterhin proportional gekuerzt
    expect(Number(row.attack)).toBe(1000000); // weiterhin hart auf die absolute Obergrenze gekappt

    const flags = store.tables.idle_anticheat_flags || [];
    expect(flags.length).toBe(1);
    expect(flags[0].triggered_by).toBe('dragon_kills,combat_stats');
  });
});

/* Nachtrag 11.08.2026 (noch spaeter am selben Tag) - Spieler "OPShadowWolf"
   meldete per Screenshot, dass er nach dem Deploy der Absolute-Ceiling-
   Aenderung GAR NICHT MEHR speichern konnte - wiederholte PATCH .../
   idle_player_state-Fehlschlaege (HTTP 400, Postgres-Code 22P02
   "malformed array literal"). Root Cause nicht abschliessend geklaert
   (kein DB-Schreibzugriff, um die echte Spaltendefinition direkt
   einzusehen - siehe sql/20260811-anticheat-guard-flag-insert-safety-net.sql
   fuer die volle, ehrliche Herleitung + Arbeitshypothese), aber unabhaengig
   von der genauen Ursache gilt: ein Fehler in der reinen ALARM-PROTOKOLLIERUNG
   darf strukturell NIE die eigentliche Spielstand-Speicherung blockieren
   koennen - das war vorher moeglich (INSERT in idle_anticheat_flags lief
   ungeschuetzt, eine Exception dort riss die GESAMTE UPDATE-Transaktion
   mit sich). Jetzt in ein eigenes BEGIN/EXCEPTION (SQL) bzw. try/catch
   (JS-Mock, tests/mock/rest-engine.js) gepackt. Dieser Test simuliert das
   Szenario deterministisch (Flags-Tabelle absichtlich kaputt gemacht,
   Push wirft garantiert), statt auf den echten, nicht zuverlaessig
   reproduzierbaren Postgres-Fehler zu warten - beweist die strukturelle
   Absicherung selbst, unabhaengig von der konkreten Fehlerursache. */
test.describe('Anti-Cheat-Tempo-Guard - Sicherheitsnetz gegen einen Protokollierungsfehler (11.08. Nachtrag)', () => {
  test.use({ teststand: 'A' });

  test('REGRESSION: ein Fehler beim Schreiben in idle_anticheat_flags blockiert die eigentliche (bereits gekappte) Speicherung NICHT', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await settle(page);

    // Simuliert einen beliebigen Fehler beim Protokollieren (z.B. den
    // gemeldeten Postgres-Typkonflikt) - Array.prototype.push wird fuer
    // GENAU diese eine Tabelle so ersetzt, dass er garantiert wirft.
    store.tables.idle_anticheat_flags = store.tables.idle_anticheat_flags || [];
    store.tables.idle_anticheat_flags.push = () => { throw new Error('simulierter Protokollierungs-Fehler (z.B. malformed array literal)'); };

    await page.evaluate(() => {
      bkmpIdleState.attack = 9000000; // loest die Kampfwert-Obergrenze aus - genau der Pfad, der protokollieren wollte
      bkmpIdleQueueSync();
    });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    // Der eigentliche Speichervorgang MUSS trotzdem durchgelaufen sein, mit
    // dem korrekt gekappten Wert - das ist der eigentliche Beweis, nicht
    // die (hier absichtlich kaputte) Protokollierung selbst.
    const row = findRow(store, fixtureData);
    expect(Number(row.attack)).toBe(1000000);
  });
});
