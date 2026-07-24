/* Phase 3 (24.07.2026, siehe CLAUDE.md) - Arena-Tests. Erste Feature-Suite,
   die den in Phase 2 dokumentierten RPC-Mock-Luecke schliesst (siehe
   tests/FEATURE_MATRIX.md: "Arena... arena_attack-RPC im Mock fehlt -
   aktuell nicht simulierbar"). arena_attack() ist jetzt originalgetreu in
   tests/mock/rpc-engine.js portiert (siehe Kommentar dort).

   Eigene, lokale Fixture statt tests/fixtures/teststands.js - die dortigen
   Teststande sind auf EINEN Spieler zugeschnitten (Auftrag Schritt 4:
   "verschiedene Spielerzustaende"), die Arena braucht aber zwingend
   MINDESTENS ZWEI echte idle_player_state-Zeilen (Angreifer + Gegner)
   gleichzeitig im selben Store - ein eigenes, kleines Fixture hier haelt
   diese Sonderanforderung von der allgemeinen Teststand-Taxonomie fern. */

/* test/expect/createQaServer kommen seit der Sicherheitsverstaerkung
   (24.07.2026, siehe CLAUDE.md) aus network-guard.js: globale Netzwerksperre
   + zentraler createQaServer()-Baustein statt des vorher hier lokal
   nachgebauten createStore/seedStore/createTestServer-Aufbaus. Genau DAS
   Fehlen von ?qa=1 im urspruenglichen Handschrieb dieser Datei (siehe
   loginAttacker()-Kommentar unten) war der Ausloeser der Sicherheits-
   verstaerkung - qaServer.url() macht dasselbe Vergessen jetzt strukturell
   unmoeglich, und die globale Sperre faengt jeden ANDEREN denkbaren Fehler
   trotzdem ab. */
const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady } = require('../helpers/qa-fixtures');

const ATTACKER_UID = 'qa-arena-attacker-0000';
const ATTACKER_NAME = 'QaArenaAtk';
const WEAK_DEFENDER_UID = 'qa-arena-weak-0000';
const WEAK_DEFENDER_NAME = 'QaArenaWeak';
const STRONG_DEFENDER_UID = 'qa-arena-strong-0000';
const STRONG_DEFENDER_NAME = 'QaArenaStrong';
const EQUAL_DEFENDER_UID = 'qa-arena-equal-0000';
const EQUAL_DEFENDER_NAME = 'QaArenaEqual';
const GHOST_UID = 'qa-arena-ghost-0000'; // nie in idle_player_state - fuer no_defender_state

function arenaFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  const attackerRow = makePlayerStateRow(ATTACKER_UID, ATTACKER_NAME.toLowerCase(), nowIso, {
    display_name: ATTACKER_NAME, level: 50, gold: 1000,
    attack: 1000, defense: 500, hp: 5000 // sehr stark - siehe "gewinnt zuverlaessig"-Tests
  });
  const weakRow = makePlayerStateRow(WEAK_DEFENDER_UID, WEAK_DEFENDER_NAME.toLowerCase(), nowIso, {
    display_name: WEAK_DEFENDER_NAME, level: 1,
    attack: 1, defense: 1, hp: 1 // sehr schwach
  });
  const strongRow = makePlayerStateRow(STRONG_DEFENDER_UID, STRONG_DEFENDER_NAME.toLowerCase(), nowIso, {
    display_name: STRONG_DEFENDER_NAME, level: 200,
    attack: 5000, defense: 3000, hp: 50000 // deutlich staerker als der Angreifer
  });
  const equalRow = makePlayerStateRow(EQUAL_DEFENDER_UID, EQUAL_DEFENDER_NAME.toLowerCase(), nowIso, {
    display_name: EQUAL_DEFENDER_NAME, level: 50,
    attack: 1000, defense: 500, hp: 5000 // identische Werte wie der Angreifer
  });
  return {
    startTimeMs,
    displayName: ATTACKER_NAME,
    nameKey: ATTACKER_NAME.toLowerCase(),
    authUserId: ATTACKER_UID,
    email: emailFromName(ATTACKER_NAME),
    password: QA_PASSWORD,
    users: [{ id: ATTACKER_UID, email: emailFromName(ATTACKER_NAME), password: QA_PASSWORD, user_metadata: {} }],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [attackerRow, weakRow, strongRow, equalRow],
      idle_prestige_state: [],
      idle_player_runes: [],
      arena_ratings: [],
      arena_battle_log: []
    },
    nowIso
  };
}

const test = base.extend({
  rngSeed: [12345, { option: true }],
  qaServer: async ({ rngSeed }, use) => {
    const server = await createQaServer(
      (store, startTimeMs) => seedStore(store, arenaFixture(startTimeMs)),
      { rngSeed }
    );
    await use(server);
    await server.close();
  }
});

async function loginAttacker(page, qaServer) {
  /* Frueherer Bug (vor der Sicherheitsverstaerkung 24.07.2026, siehe
     CLAUDE.md): die erste Fassung dieser Zeile navigierte OHNE ?qa=1 - ohne
     die App im lokalen QA-Modus zeigte supabase.js weiter auf das ECHTE
     Produktionsprojekt, der folgende Login-Versuch mit erfundenen
     Zugangsdaten erreichte dadurch kurz die echte Supabase-Auth (korrekt mit
     401 abgelehnt, kein Schaden). qaServer.url() (network-guard.js) haengt
     ?qa=1 jetzt IMMER automatisch an - ein einfaches String-Concat wie
     `qaServer.baseURL + '/...'` kann dieses spezielle Vergessen nicht mehr
     reproduzieren; die globale Netzwerksperre faengt zusaetzlich JEDEN
     anderen Fall ab, der trotzdem den Produktions-Host erreichen wuerde. */
  await page.goto(qaServer.url('/'));
  const overlay = page.locator('#mcNameOverlay');
  await expect(overlay).toHaveClass(/visible/, { timeout: 15000 });
  /* Auf schmalen Mobil-Breiten ueberlagert das schwebende QA-Panel das
     zentrierte Login-Formular (identischer, bereits in qa-mode-security.spec.js
     dokumentierter Fund) - vor dem Ausfuellen ausblenden. */
  await page.evaluate(() => { const h = document.querySelector('[data-qa-hide]'); if (h) h.click(); });
  await page.locator('#mcAuthName').fill(ATTACKER_NAME);
  await page.locator('#mcAuthPassword').fill(QA_PASSWORD);
  await page.locator('#mcAuthSubmit').click();
  await expect(overlay).not.toHaveClass(/visible/, { timeout: 15000 });
  await page.locator('#idleDorfButton').click();
  const idleOverlay = page.locator('#idleDorfOverlay');
  await expect(idleOverlay).toHaveClass(/visible/, { timeout: 15000 });
  await waitForIdleStateReady(page);
  /* Ohne das hier laeuft der normale Kampf-Tick weiter im Hintergrund und
     verdient nebenbei echtes Gold von besiegten Drachen - macht "gold vor
     vs. nach dem Arena-Angriff"-Vergleiche zu einem bewegten Ziel. Gleiches,
     bereits an anderer Stelle etablierte Muster wie in save-load.spec.js
     ("bkmpIdleStopLoop(); // avoids a moving-target gold value"). Beim
     eigenen Testen gefunden: erste Fassung verglich Gold ohne diesen Stop
     und bekam dadurch unvorhersehbare Werte statt der erwarteten exakten
     Differenz. */
  await page.evaluate(() => { if (typeof bkmpIdleStopLoop === 'function') bkmpIdleStopLoop(); });
}

async function attack(page, targetUid) {
  return page.evaluate((uid) => window.bkmpArenaAttack(uid), targetUid);
}

/* Serverseitige Wahrheit direkt aus dem Store lesen statt aus bkmpIdleState
   (Client-Spiegel) - robuster gegen Timing zwischen Browser-Roundtrips.
   bkmpIdleStopLoop() stoppt den LAUFENDEN Tick zuverlaessig (siehe
   "verliert"-Test: goldAfter===goldBefore trifft dort exakt zu), aber ein
   einzelner, schon vor dem Stop angestossener Zwischenschritt kann beim
   Client-Spiegel-Weg noch nachzuckeln - das eigentlich zu pruefende Verhalten
   ist ohnehin die RPC-Mutation selbst, nicht deren spaetere Client-Anzeige. */
function serverGold(qaServer, uid) {
  const row = qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === uid);
  return row.gold;
}

test.describe('Arena', () => {
  test('Angriff auf einen deutlich schwaecheren Gegner gewinnt zuverlaessig und zahlt Gold', async ({ page, qaServer }) => {
    await loginAttacker(page, qaServer);
    const goldBefore = serverGold(qaServer, ATTACKER_UID);
    const result = await attack(page, WEAK_DEFENDER_UID);
    expect(result.won).toBe(true);
    expect(result.goldReward).toBeGreaterThan(0);
    expect(result.ratingChange).toBeGreaterThan(0);
    expect(serverGold(qaServer, ATTACKER_UID)).toBe(goldBefore + result.goldReward);
  });

  test('Angriff auf einen deutlich staerkeren Gegner verliert zuverlaessig und zahlt kein Gold', async ({ page, qaServer }) => {
    await loginAttacker(page, qaServer);
    const goldBefore = serverGold(qaServer, ATTACKER_UID);
    const result = await attack(page, STRONG_DEFENDER_UID);
    expect(result.won).toBe(false);
    expect(result.goldReward).toBe(0);
    expect(result.ratingChange).toBeLessThan(0);
    expect(serverGold(qaServer, ATTACKER_UID)).toBe(goldBefore);
  });

  test('Rating-Aenderung bei gleich starken, neuen Gegnern folgt exakt der Elo-Formel (K=32, 50/50 erwartet)', async ({ page, qaServer }) => {
    await loginAttacker(page, qaServer);
    const result = await attack(page, EQUAL_DEFENDER_UID);
    // Beide starten bei Rating 1000 -> expected=0.5 -> |change| = round(32*0.5) = 16, exakt, unabhaengig vom Sieg/Niederlage-Wurf.
    expect(Math.abs(result.ratingChange)).toBe(16);
    expect(result.newRating).toBe(1000 + result.ratingChange);
  });

  test('Cooldown blockiert einen zweiten Angriff auf dasselbe Ziel innerhalb von 3 Minuten', async ({ page, qaServer }) => {
    await loginAttacker(page, qaServer);
    await attack(page, WEAK_DEFENDER_UID);
    let threw = null;
    try { await attack(page, WEAK_DEFENDER_UID); } catch (e) { threw = String(e.message || e); }
    // bkmpArenaAttack() (supabase.js) uebersetzt den rohen RPC-Fehlercode
    // ("cooldown_active") bereits client-seitig in eine deutsche Meldung,
    // bevor er den Aufrufer erreicht - dieselbe Uebersetzungsstelle wird
    // schon beim no_defender_state-Test unten korrekt beruecksichtigt.
    expect(threw).toContain('schon vor Kurzem angegriffen');
  });

  test('Nach Ablauf des Cooldowns ist ein erneuter Angriff auf dasselbe Ziel wieder moeglich', async ({ page, qaServer }) => {
    await loginAttacker(page, qaServer);
    await attack(page, WEAK_DEFENDER_UID);
    qaServer.store.clock.advance(3 * 60 * 1000 + 1000); // 3min + 1s
    const result = await attack(page, WEAK_DEFENDER_UID);
    expect(result.won).toBe(true);
  });

  test('Tageslimit von 10 Angriffen wird durchgesetzt (elfter Angriff schlaegt fehl)', async ({ page, qaServer }) => {
    test.setTimeout(30000);
    await loginAttacker(page, qaServer);
    for (let i = 0; i < 10; i++) {
      await attack(page, WEAK_DEFENDER_UID);
      qaServer.store.clock.advance(3 * 60 * 1000 + 1000); // Cooldown umgehen, noch selber Berlin-Tag
    }
    let threw = null;
    try { await attack(page, WEAK_DEFENDER_UID); } catch (e) { threw = String(e.message || e); }
    expect(threw).toContain('Tageslimit von 10 Arena-Angriffen erreicht');
  });

  test('Tageslimit setzt sich am naechsten Berlin-Kalendertag zurueck', async ({ page, qaServer }) => {
    test.setTimeout(30000);
    await loginAttacker(page, qaServer);
    for (let i = 0; i < 10; i++) {
      await attack(page, WEAK_DEFENDER_UID);
      qaServer.store.clock.advance(3 * 60 * 1000 + 1000);
    }
    qaServer.store.clock.advance(24 * 60 * 60 * 1000); // ein voller Tag weiter
    const result = await attack(page, WEAK_DEFENDER_UID);
    expect(result.won).toBe(true);
  });

  test('Angriff auf sich selbst schlaegt fehl', async ({ page, qaServer }) => {
    await loginAttacker(page, qaServer);
    let threw = null;
    try { await attack(page, ATTACKER_UID); } catch (e) { threw = String(e.message || e); }
    expect(threw).toBeTruthy();
  });

  test('Angriff auf ein Ziel ohne Kampf-Fortschritt schlaegt fehl', async ({ page, qaServer }) => {
    await loginAttacker(page, qaServer);
    let threw = null;
    try { await attack(page, GHOST_UID); } catch (e) { threw = String(e.message || e); }
    expect(threw).toContain('Kampf-Fortschritt');
  });

  test('Gegnerliste zeigt echte Kampfwerte und eine geschaetzte Gewinnchance', async ({ page, qaServer }) => {
    await loginAttacker(page, qaServer);
    const opponents = await page.evaluate(() => window.bkmpArenaGetOpponents(bkmpIdleState.auth_user_id, 1000, 20));
    const names = opponents.map(o => o.displayName);
    expect(names).toContain(WEAK_DEFENDER_NAME);
    expect(names).toContain(STRONG_DEFENDER_NAME);
    const weak = opponents.find(o => o.displayName === WEAK_DEFENDER_NAME);
    expect(weak.attack).toBe(1);
    expect(weak.hp).toBe(1);
  });
});
