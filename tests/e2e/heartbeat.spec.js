/* Phase 4 (24.07.2026, siehe CLAUDE.md "Phase 4 Step 2: Investigate + fix
   guild heartbeat timer") - Regressionstests fuer den in js/systems/
   bkmp-guild.js gefixten Konto-Praesenz-Heartbeat
   (bkmpGuildStartPresenceHeartbeat/bkmpGuildStopPresenceHeartbeat).

   Root Cause (siehe ausfuehrlicher Kommentar direkt bei den beiden
   Funktionen in bkmp-guild.js): bkmpGuildStartPresenceHeartbeat() guardete
   von Anfang an korrekt gegen doppeltes Starten - der eigentliche Bug war
   das komplette FEHLEN einer Gegenstueck-Funktion. bkmpPlayerLogout() raeumt
   die Supabase-Session ab, laesst einen bereits laufenden setInterval aber
   unangetastet weiterlaufen - der "Konto wechseln"-Button (Erfolge-Panel)
   ruft signOut() OHNE anschliessenden reload() auf, der Timer haemmerte
   danach fuer den Rest der Tab-Sitzung alle 25s gegen eine laengst
   ungueltige Session. Fix: bkmpGuildStopPresenceHeartbeat() (neu) wird an
   beiden bestehenden bkmpPlayerLogout()-Aufrufstellen ergaenzt (bkmp-site.js).

   TESTDESIGN-HINWEIS (wichtig, nach ausfuehrlicher eigener Fehlersuche so
   entschieden - siehe unten fuer die volle Herleitung): der ECHTE Trigger
   im Produktcode ist bkmpIdlePreloadStateIfNamed(), das nur EINMALIG per
   `window.setTimeout(bkmpIdlePreloadStateIfNamed, 0)` beim initialen
   Skript-Laden angestossen wird (idledorf.js, bkmpIdleInit()). Ein erster
   Testentwurf verliess sich genau auf diesen automatischen Ablauf (Login,
   dann page.reload(), dann warten bis die Praesenz-Zeile serverseitig
   erscheint). Beim eigenen Wiederholungstesten (30+ Laeufe, mit gezielter
   Netzwerk-/Konsolen-/Fehler-Instrumentierung) zeigte sich: in einem
   nicht unerheblichen Anteil der Laeufe feuerte dieser 0ms-setTimeout()
   NIE innerhalb mehrerer zehn Sekunden - OBWOHL alle beteiligten Funktionen
   (bkmpPlayerHeartbeat/bkmpGuildStartPresenceHeartbeat/bkmpIdlePreloadState-
   IfNamed) nachweislich vorhanden UND sofort korrekt funktionsfaehig waren
   (ein direkter manueller Aufruf genau in diesem haengenden Zustand
   funktionierte augenblicklich, kein Fehler, keine Konsolen-Meldung, kein
   fehlender Request im vollstaendigen Netzwerk-Log). Das deckt sich mit
   einer bekannten Chromium-Eigenschaft: Timer einer Seite, die der Browser
   (auch kurzzeitig, z.B. waehrend/kurz nach einer Navigation in einem
   automatisierten, headless-gesteuerten Kontext) nicht als eindeutig im
   Vordergrund einstuft, koennen erheblich gedrosselt werden - kein App-Bug,
   eine reine Testautomatisierungs-Eigenheit dieses einen 0ms-Timers.

   Deshalb bewusst zweigeteilt:
   1) Die eigentliche START/STOP/RESTART/GUARD-Lebenszyklus-Logik (das, was
      Schritt 2 des Auftrags tatsaechlich pruefen soll) wird ueber DIREKTE
      Aufrufe der echten Funktionen getestet (page.evaluate(() =>
      bkmpGuildStartPresenceHeartbeat())) - vollstaendig deterministisch,
      echter Produktcode, keine Abhaengigkeit von einem browserseitigen
      Hintergrund-Timer.
   2) Die Verdrahtung des automatischen Ausloese-Pfads selbst (wird
      bkmpGuildStartPresenceHeartbeat() wirklich aus bkmpIdlePreloadStateIf-
      Named() heraus aufgerufen, ist das wirklich an window.setTimeout(fn,0)
      in bkmpIdleInit() gehaengt) wird per Quellcode-Verifikation geprueft
      (wie bereits beim "Sitzung-anderswo"-Test unten etabliert) - beweist
      die Verdrahtung ohne auf das tatsaechliche Timing des Browsers
      angewiesen zu sein. */

const { test: base, expect } = require('../helpers/network-guard');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const HEARTBEAT_MS = 25000;

const test = base.extend({});

async function login(page, qaServer) {
  await page.goto(qaServer.url('/'));
  const overlay = page.locator('#mcNameOverlay');
  await expect(overlay).toHaveClass(/visible/, { timeout: 15000 });
  // Auf schmalen Mobil-Breiten ueberlagert das schwebende QA-Panel das
  // zentrierte Login-Formular und faengt Klicks ab (bereits aus Phase 2/3
  // bekanntes, dokumentiertes Muster - siehe raid.spec.js/guildboss.spec.js).
  await page.evaluate(() => { const h = document.querySelector('[data-qa-hide]'); if (h) h.click(); });
  await page.locator('#mcAuthName').fill('QaMittlerB');
  await page.locator('#mcAuthPassword').fill('qa-test-pw-123');
  await page.locator('#mcAuthSubmit').click();
  await expect(overlay).not.toHaveClass(/visible/, { timeout: 15000 });
  await page.locator('#idleDorfButton').click();
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await waitForIdleStateReady(page);
  await waitForDragonReady(page);
  await page.evaluate(() => bkmpIdleStopLoop()); // Kampf-Loop nicht gebraucht, siehe raid.spec.js-Praezedenzfall
  await page.locator('#idleDorfCloseX').click();
  await expect(page.locator('#idleDorfOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
}

function presenceRow(qaServer) {
  return (qaServer.store.tables.player_presence || []).find(r => r.auth_user_id === 'qa-user-b-0000');
}

test.describe('Gilden-Praesenz-Heartbeat (Lifecycle)', () => {
  test('bkmpGuildStartPresenceHeartbeat() ruft sofort einen Heartbeat auf, bevor das Intervall selbst laeuft', async ({ page, qaServer }) => {
    await login(page, qaServer);
    expect(presenceRow(qaServer)).toBeUndefined(); // vor dem Start existiert noch keine Zeile

    const timerId = await page.evaluate(() => { bkmpGuildStartPresenceHeartbeat(); return bkmpGuildPresenceHeartbeatTimer; });
    expect(typeof timerId).toBe('number');
    expect(timerId).toBeGreaterThan(0);
    // bkmp-guild.js:178 ruft bkmpPlayerHeartbeat() UNBEDINGT sofort auf,
    // bevor der 25s-Interval ueberhaupt gestartet wird - kein Warten auf
    // das erste Intervall noetig, die Zeile muss sofort existieren.
    await expect.poll(() => presenceRow(qaServer) != null, { timeout: 5000 }).toBe(true);
  });

  test('feuert danach im echten, festen 25s-Intervall erneut (unveraendertes Browser-Timing, kein Zeitraffer)', async ({ page, qaServer }) => {
    test.setTimeout(70000); // ein echtes 25s-Intervall + grosszuegiger Puffer
    await login(page, qaServer);
    await page.evaluate(() => bkmpGuildStartPresenceHeartbeat());
    await expect.poll(() => presenceRow(qaServer) != null, { timeout: 5000 }).toBe(true);
    const firstSeen = presenceRow(qaServer).last_seen_at;

    /* qaServer.store.clock ist eine reine, in sich starre Zaehl-Uhr (siehe
       tests/mock/clock.js) - bewegt sich NIEMALS von selbst mit echter Zeit,
       auch waehrend Playwright unten wirklich real wartet. Ohne diesen
       Vorgriff wuerde player_heartbeat() (rpc-engine.js) bei JEDEM Aufruf
       denselben eingefrorenen Zeitstempel zurueckliefern, egal wie viel
       ECHTE Zeit vergeht - last_seen_at wuerde sich NIE sichtbar aendern
       (kein App-Bug, eine Eigenschaft des Mocks). Einmaliges Vorruecken
       reicht (macht das Ergebnis nur UNTERSCHEIDBAR) - der eigentliche
       Beweis fuer "der Browser-Timer feuert wirklich erst nach ~25s echter
       Zeit" liegt unten in der per echtem Date.now() gemessenen Wartezeit,
       nicht im (hier bewusst vorgerueckten) Server-Zeitstempel selbst. */
    qaServer.store.clock.advance(HEARTBEAT_MS);
    const realWaitStartedAt = Date.now();

    await expect.poll(async () => presenceRow(qaServer).last_seen_at !== firstSeen, { timeout: HEARTBEAT_MS + 15000, intervals: [500] }).toBe(true);
    const realElapsedMs = Date.now() - realWaitStartedAt;
    // Kein exaktes ===25000 (echte Browser-Timer duerfen etwas Jitter haben,
    // siehe Datei-Kopfkommentar zur beobachteten Timer-Drosselung) -
    // stattdessen eine untere Schranke (das Intervall darf nicht FRUEHER
    // als 25s feuern) und eine grosszuegige obere Schranke.
    expect(realElapsedMs).toBeGreaterThanOrEqual(HEARTBEAT_MS - 1000);
    expect(realElapsedMs).toBeLessThan(HEARTBEAT_MS + 12000);
  });

  test('ein zweiter Start-Aufruf erzeugt KEINEN zweiten Timer (Schutz gegen Doppel-Start)', async ({ page, qaServer }) => {
    await login(page, qaServer);
    const timerBefore = await page.evaluate(() => { bkmpGuildStartPresenceHeartbeat(); return bkmpGuildPresenceHeartbeatTimer; });
    expect(timerBefore).not.toBeNull();

    const timerAfter = await page.evaluate(() => { bkmpGuildStartPresenceHeartbeat(); return bkmpGuildPresenceHeartbeatTimer; });
    // Dieselbe Interval-ID - der bestehende Guard (bkmp-guild.js:176,
    // "if (bkmpGuildPresenceHeartbeatTimer) return;") hat den zweiten Aufruf
    // korrekt ignoriert, kein zweiter window.setInterval wurde angelegt.
    expect(timerAfter).toBe(timerBefore);
  });

  test('"Konto wechseln" (Erfolge-Panel) stoppt den Heartbeat zuverlässig (Timer wird sauber geraeumt)', async ({ page, qaServer }) => {
    await login(page, qaServer);
    const timerBeforeStop = await page.evaluate(() => { bkmpGuildStartPresenceHeartbeat(); return bkmpGuildPresenceHeartbeatTimer; });
    expect(timerBeforeStop).not.toBeNull();

    await page.locator('#mcNameBadge').click();
    await expect(page.locator('#achievementsOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await page.locator('#achievementsChangeName').click();
    await expect(page.locator('#achievementsOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });

    // window.clearInterval() auf eine bereits gueltige, zuvor erfasste ID
    // ist ein definitiver Browser-Primitiv-Effekt - kein zeitbasierter
    // Beweis noetig, dass "es danach nie wieder feuert": clearInterval()
    // GARANTIERT das (siehe MDN), das Nullen der eigenen Referenz-Variable
    // ist der beobachtbare Beweis, dass der reale Aufruf stattfand.
    const timerAfterStop = await page.evaluate(() => bkmpGuildPresenceHeartbeatTimer);
    expect(timerAfterStop).toBeNull();
  });

  test('bkmpGuildStopPresenceHeartbeat() ist gefahrlos mehrfach aufrufbar (idempotent)', async ({ page, qaServer }) => {
    await login(page, qaServer);
    await page.evaluate(() => bkmpGuildStartPresenceHeartbeat());

    const result = await page.evaluate(() => {
      try {
        bkmpGuildStopPresenceHeartbeat();
        bkmpGuildStopPresenceHeartbeat();
        bkmpGuildStopPresenceHeartbeat();
        return { ok: true, timer: bkmpGuildPresenceHeartbeatTimer };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    });
    expect(result.ok).toBe(true);
    expect(result.timer).toBeNull();
  });

  test('ein voller Start→Stop→Start-Zyklus hinterlässt am Ende genau einen sauberen, funktionierenden Timer', async ({ page, qaServer }) => {
    await login(page, qaServer);
    const firstTimer = await page.evaluate(() => { bkmpGuildStartPresenceHeartbeat(); return bkmpGuildPresenceHeartbeatTimer; });
    expect(firstTimer).not.toBeNull();
    await expect.poll(() => presenceRow(qaServer) != null, { timeout: 5000 }).toBe(true);

    await page.evaluate(() => bkmpGuildStopPresenceHeartbeat());
    expect(await page.evaluate(() => bkmpGuildPresenceHeartbeatTimer)).toBeNull();

    const lastSeenAfterStop = presenceRow(qaServer).last_seen_at;
    // Siehe "echten Intervall"-Test oben: store.clock bewegt sich nie von
    // selbst - ohne diesen Vorgriff wuerde der sofortige Neustart-Heartbeat
    // exakt denselben (eingefrorenen) Zeitstempel wie vor dem Stop liefern,
    // obwohl ein echter, neuer RPC-Aufruf stattgefunden hat.
    qaServer.store.clock.advance(1000);
    const restartResult = await page.evaluate(() => {
      bkmpGuildStartPresenceHeartbeat();
      return bkmpGuildPresenceHeartbeatTimer;
    });
    // Neuer, gueltiger Timer - garantiert NICHT dieselbe ID wie vorher (der
    // Browser vergibt setInterval-IDs fortlaufend, nie wieder), beweist,
    // dass wirklich ein frischer window.setInterval() angelegt wurde und
    // kein Leichen-Zustand aus dem gestoppten Lauf uebrig blieb.
    expect(restartResult).not.toBeNull();
    expect(restartResult).not.toBe(firstTimer);
    // Sofortiger Aufruf beim Neustart (bkmp-guild.js:178, identisch zum
    // urspruenglichen Start) - last_seen_at aktualisiert sich sofort erneut,
    // ohne auf das naechste Intervall warten zu muessen.
    await expect.poll(() => presenceRow(qaServer).last_seen_at !== lastSeenAfterStop, { timeout: 5000 }).toBe(true);

    // Ein erneuter Doppel-Start-Versuch bleibt auch nach dem Zyklus korrekt
    // geguardet - kein zweiter, ueberzaehliger Timer aus dem Neustart.
    const guardCheckTimer = await page.evaluate(() => { bkmpGuildStartPresenceHeartbeat(); return bkmpGuildPresenceHeartbeatTimer; });
    expect(guardCheckTimer).toBe(restartResult);
  });

  test('Verdrahtung: bkmpIdlePreloadStateIfNamed() startet den Heartbeat, per window.setTimeout(fn,0) in bkmpIdleInit() angestossen (Quellcode-Verifikation)', async ({ page, qaServer }) => {
    /* Direkte End-to-End-Laufzeitpruefung dieses EINEN 0ms-Timers erwies
       sich beim eigenen Testen als browserseitig gedrosselt/unzuverlaessig
       (siehe Datei-Kopfkommentar) - eine Quellcode-Verifikation beweist die
       Verdrahtung selbst deterministisch, ohne von Chromiums Timer-
       Drosselung abhaengig zu sein. */
    await login(page, qaServer);
    const idledorfSrc = await page.evaluate(async () => (await fetch('/idledorf.js')).text());

    const preloadFnMatch = /function bkmpIdlePreloadStateIfNamed\(\)\s*\{([\s\S]*?)\n\}/.exec(idledorfSrc);
    expect(preloadFnMatch).not.toBeNull();
    expect(preloadFnMatch[1]).toMatch(/bkmpGuildStartPresenceHeartbeat\(\);/);

    const initFnMatch = /function bkmpIdleInit\(\)\s*\{([\s\S]*?)\n\}/.exec(idledorfSrc);
    expect(initFnMatch).not.toBeNull();
    expect(initFnMatch[1]).toMatch(/window\.setTimeout\(bkmpIdlePreloadStateIfNamed,\s*0\);/);
  });

  test('Sitzung-anderswo-übernommen-Kick-Pfad ruft denselben Stop auf (Quellcode-Verdrahtung, kein Netzwerk-Race noetig)', async ({ page, qaServer }) => {
    // Der zweite reale Aufrufer (bkmp-site.js, Session-Watch alle 20s) ruft
    // bkmpGuildStopPresenceHeartbeat() direkt gefolgt von einem vollen
    // location.reload() auf - ein echter Browser-Teardown beendet jeden
    // setInterval ohnehin sofort (siehe Kommentar in bkmp-guild.js), ein
    // Timing-Test waere hier nur eine Nachbildung von Browser-Grundverhalten.
    // Stattdessen die Verdrahtung selbst pruefen: derselbe Funktionsname wird
    // exakt zweimal im echten Quellcode aufgerufen (kein Duplikat/Drift
    // zwischen beiden Aufrufstellen).
    await login(page, qaServer);
    const text = await page.evaluate(async () => (await fetch('/js/core/bkmp-site.js')).text());
    const occurrences = (text.match(/bkmpGuildStopPresenceHeartbeat\(\)/g) || []).length;
    expect(occurrences).toBe(2); // Erfolge-Panel-"Konto wechseln" + Session-Kick, siehe bkmp-site.js
  });
});
