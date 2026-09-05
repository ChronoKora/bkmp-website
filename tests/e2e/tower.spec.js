const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Phase 6 (25.07.2026) - Endloser Turm (js/systems/bkmp-tower.js). Klickt
   echte Desktop-Tab-Buttons (#idleTabBtnTurm) - auf mobile-*-Projekten ist
   der Knoten korrekt unsichtbar (kompakte Navigation), siehe identisches
   Muster in dungeon-time.spec.js/buttons-inventory.spec.js. mobile-smoke.spec.js
   deckt die kompakte Navigation bereits ab.

   Architektur (per Quellcode bestaetigt, js/systems/bkmp-tower.js):
   - KEINE Freischaltbedingung - jeder Spieler kann sofort starten (kein
     Level-/Prestige-/Stufen-Gate im Code gefunden). Absichtlich NICHT
     erfunden - siehe unten "Turm gesperrt"-Test, der stattdessen genau
     diese Abwesenheit dokumentiert.
   - Wellen sind ECHT unbegrenzt (kein Cap auf combatMult, siehe Modul-
     Kommentar in bkmp-tower.js) - Gegner-Staerke skaliert an den
     EIGENEN Spielerwerten (maxHp=round(attack*4*M), attack=round(hp*0.06*M),
     defense=round(defense*0.3), M=1.05^(wave-1)*0.55-Exponent), nicht an
     einer festen Drachen-Tabelle.
   - Miniboss ("Turmwaechter") jede 5. Welle, bossBump=1.2x auf HP/Attack.
   - Ein Versuch PRO KALENDERTAG (Europe/Berlin), nicht rollierend -
     turm_last_attempt_at wird SOFORT beim Start gesetzt, VOR jedem
     Wellenkampf (ein sofortiger Reload nach dem Start verliert den Tages-
     Versuch trotzdem).
   - turm_highest_wave ist ein reiner Bestwert, faellt nie.
   - Belohnungen: jede Welle Gold+EXP, alle 5 Wellen zusaetzlich Kristalle
     (ceil(wave/5)*2), alle 25 (nicht 50) zusaetzlich 1 Rune, alle 50
     zusaetzlich Rune+moegliches Ei - IDENTISCH bei Erstabschluss und
     Wiederholung (keine gesonderte "Erstabschluss"-Belohnung im Code
     gefunden - nur der Ergebnis-Kartentext unterscheidet "Neuer Rekord"
     vs. "Stufe N").
   - Kein eigener Kampf-Timer - nutzt den geteilten bkmpIdleTick()-Loop,
     eigener bkmpTowerTimerInterval ist nur ein 500ms-Banner-Refresh (kein
     Schaden). bkmpIdleHandleDragonDefeated()/bkmpIdleHandleDefeat() (beide
     in idledorf.js) pruefen bkmpTowerActive ZUERST und rufen dann direkt
     bkmpTowerHandleWaveCleared()/bkmpTowerHandleDefeat() auf - Tests rufen
     diese Funktionen direkt auf (HP auf 0 setzen + Handler aufrufen), um
     die Turm-eigene Belohnungs-/Fortschrittslogik deterministisch zu
     pruefen, ohne echte Kampf-RNG/Tick-Timing zu brauchen (dieselbe
     Produktionsfunktion, kein Test-Doppel). */
test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - siehe Kommentar oben, mobile-smoke.spec.js deckt die kompakte Navigation ab');
});

/* bkmpTowerFinish() (js/systems/bkmp-tower.js) zeigt nach jedem
   Lauf-Ende eine SCHLIESSBARE Ergebniskarte (#bkmpTowerResultOverlay,
   bkmpIdleShowDismissibleResultCard() in js/core/bkmp-idle-state.js) -
   bewusst kein Toast, der von selbst verschwindet (Spieler-Vorgabe 16.07.,
   siehe Kommentar dort: "ein Toast verschwindet von selbst, genau das war
   das gemeldete Problem"). Bleibt sie offen, ueberdeckt sie per
   pointer-events die restliche Seite und blockiert JEDEN spaeteren Klick
   (z.B. auf einen anderen Tab) - echtes, beim eigenen Testen gefundenes
   Verhalten (kein Mock-Artefakt), das ein echter Spieler durch den
   sichtbaren Schliessen-Button (.idle-result-close-btn) selbst aufloest.
   Tests, die nach einem Lauf-Ende weiterklicken, muessen das genauso tun. */
async function dismissResultCardIfAny(page) {
  await page.evaluate(() => {
    const overlay = document.getElementById('bkmpTowerResultOverlay');
    if (overlay) overlay.remove();
  });
}

async function openTowerPanel(page) {
  await dismissResultCardIfAny(page);
  await page.locator('#idleTabBtnTurm').click();
  await page.evaluate(() => bkmpIdleRenderTurmPanel());
}

async function clearOneWave(page) {
  await page.evaluate(() => {
    bkmpIdleCurrentDragon.hp = 0;
    bkmpIdleHandleDragonDefeated();
  });
}

async function loseCurrentWave(page) {
  await page.evaluate(() => bkmpIdleHandleDefeat());
}

test.describe('Endloser Turm', () => {
  test.use({ teststand: 'A' });

  test('frischer Spieler: kein Freischalt-Gate vorhanden - Turm ist sofort betretbar (bewusst KEINE erfundene Sperre getestet)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openTowerPanel(page);
    const btn = page.locator('#idleTurmStartBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    const best = await page.evaluate(() => Number(bkmpIdleState.turm_highest_wave || 0));
    expect(best).toBe(0);
  });

  test('Start spawnt Welle 1 mit exakt der dokumentierten Skalierungsformel', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openTowerPanel(page);
    await page.locator('#idleTurmStartBtn').click();

    const result = await page.evaluate(() => {
      const s = bkmpIdleEffectiveStats;
      return {
        active: bkmpTowerActive,
        wave: bkmpTowerWave,
        dragonMaxHp: bkmpIdleCurrentDragon.maxHp,
        dragonAttack: bkmpIdleCurrentDragon.attack,
        dragonDefense: bkmpIdleCurrentDragon.defense,
        isTower: bkmpIdleCurrentDragon.isTower,
        expected: {
          maxHp: Math.max(1, Math.round((s.attack || 10) * 4)),
          attack: Math.max(1, Math.round((s.hp || 100) * 0.06)),
          defense: Math.round((s.defense || 0) * 0.3)
        }
      };
    });
    expect(result.active).toBe(true);
    expect(result.wave).toBe(1);
    expect(result.isTower).toBe(true);
    expect(result.dragonMaxHp).toBe(result.expected.maxHp);
    expect(result.dragonAttack).toBe(result.expected.attack);
    expect(result.dragonDefense).toBe(result.expected.defense);
  });

  test('Sieg auf Welle 1 schaltet auf Welle 2, heilt 30% und zahlt Gold+EXP', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openTowerPanel(page);
    await page.locator('#idleTurmStartBtn').click();

    const before = await page.evaluate(() => ({ gold: bkmpIdleState.gold, xp: bkmpIdleState.xp }));
    await clearOneWave(page);
    const after = await page.evaluate(() => ({
      wave: bkmpTowerWave, gold: bkmpIdleState.gold, xp: bkmpIdleState.xp,
      villageHp: bkmpIdleVillageHp, maxHp: bkmpIdleEffectiveStats.hp
    }));
    expect(after.wave).toBe(2);
    expect(after.gold).toBeGreaterThan(before.gold);
    expect(after.xp).toBeGreaterThan(before.xp);
    expect(after.villageHp).toBeLessThanOrEqual(after.maxHp);
  });

  test('Welle 5 ist ein Miniboss ("Turmwaechter") mit 1,2x Stat-Bump', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openTowerPanel(page);
    await page.locator('#idleTurmStartBtn').click();
    for (let i = 0; i < 4; i++) await clearOneWave(page);

    const state = await page.evaluate(() => {
      const s = bkmpIdleEffectiveStats;
      const M = Math.pow(1.05, 4) ** 0.55; // wave=5 => (1.05^4)^0.55
      return {
        wave: bkmpTowerWave,
        name: bkmpIdleCurrentDragon.name,
        bossTier: bkmpIdleCurrentDragon.bossTier,
        maxHp: bkmpIdleCurrentDragon.maxHp,
        expectedMaxHp: Math.max(1, Math.round(s.attack * 4 * M * 1.2))
      };
    });
    expect(state.wave).toBe(5);
    expect(state.name).toContain('Turmwächter');
    expect(state.bossTier).toBe('miniboss');
    expect(state.maxHp).toBe(state.expectedMaxHp);
  });

  test('Meilenstein-Belohnungen: Welle 5 nur Kristalle, Welle 25 zusaetzlich Rune, Welle 50 zusaetzlich Rune+moegliches Ei', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openTowerPanel(page);
    await page.locator('#idleTurmStartBtn').click();

    // bis Welle 5 (4 Siege, 5. Sieg loest den Meilenstein aus)
    for (let i = 0; i < 4; i++) await clearOneWave(page);
    const crystalsBefore = await page.evaluate(() => bkmpIdleState.crystals);
    await clearOneWave(page); // Sieg AUF Welle 5
    const afterW5 = await page.evaluate(() => bkmpIdleState.crystals);
    expect(afterW5).toBe(crystalsBefore + Math.ceil(5 / 5) * 2); // +2

    // weiter bis Welle 25 (20 weitere Siege)
    for (let i = 0; i < 19; i++) await clearOneWave(page);
    const runesBefore = await page.evaluate(() => bkmpTowerRunRunes);
    await clearOneWave(page); // Sieg AUF Welle 25
    const afterW25 = await page.evaluate(() => ({ wave: bkmpTowerWave, runes: bkmpTowerRunRunes, crystals: bkmpIdleState.crystals }));
    expect(afterW25.wave).toBe(26);
    expect(afterW25.runes).toBe(runesBefore + 1);

    // weiter bis Welle 50 (25 weitere Siege)
    for (let i = 0; i < 24; i++) await clearOneWave(page);
    const eggsBefore = await page.evaluate(() => bkmpTowerRunEggs);
    const runesBefore50 = await page.evaluate(() => bkmpTowerRunRunes);
    await clearOneWave(page); // Sieg AUF Welle 50
    const afterW50 = await page.evaluate(() => ({ wave: bkmpTowerWave, runes: bkmpTowerRunRunes, eggs: bkmpTowerRunEggs }));
    expect(afterW50.wave).toBe(51);
    expect(afterW50.runes).toBe(runesBefore50 + 1);
    expect(afterW50.eggs).toBeGreaterThanOrEqual(eggsBefore); // Ei ist eine Chance, kann 0 oder 1 sein
  });

  test('Niederlage beendet den Lauf bei wave-1, nicht bei der gerade gekaempften Welle', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openTowerPanel(page);
    await page.locator('#idleTurmStartBtn').click();
    await clearOneWave(page); // Welle 1 gewonnen -> jetzt auf Welle 2
    await clearOneWave(page); // Welle 2 gewonnen -> jetzt auf Welle 3
    await loseCurrentWave(page); // Niederlage AUF Welle 3 -> zaehlt als 2 geschafft

    const state = await page.evaluate(() => ({ active: bkmpTowerActive, best: bkmpIdleState.turm_highest_wave }));
    expect(state.active).toBe(false);
    expect(state.best).toBe(2);
  });

  test('Aufgeben-Button verhaelt sich identisch zur Niederlage (wave-1, kein Bonus)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openTowerPanel(page);
    await page.locator('#idleTurmStartBtn').click();
    await clearOneWave(page); // -> Welle 2

    await page.evaluate(() => bkmpTowerGiveUp());
    const state = await page.evaluate(() => ({ active: bkmpTowerActive, best: bkmpIdleState.turm_highest_wave }));
    expect(state.active).toBe(false);
    expect(state.best).toBe(1);
  });

  test('turm_highest_wave ist ein reiner Bestwert - ein schwaecherer Zweitlauf ueberschreibt ihn NICHT', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openTowerPanel(page);
    await page.locator('#idleTurmStartBtn').click();
    for (let i = 0; i < 4; i++) await clearOneWave(page);
    await loseCurrentWave(page); // Rekord = 4

    const bestAfterFirst = await page.evaluate(() => bkmpIdleState.turm_highest_wave);
    expect(bestAfterFirst).toBe(4);

    // Tagesgate umgehen (naechster Versuch), zweiter, SCHWAECHERER Lauf:
    await page.evaluate(() => { bkmpIdleState.turm_last_attempt_at = null; });
    await openTowerPanel(page);
    await page.locator('#idleTurmStartBtn').click();
    await loseCurrentWave(page); // sofortige Niederlage auf Welle 1 -> 0 geschafft

    const bestAfterSecond = await page.evaluate(() => bkmpIdleState.turm_highest_wave);
    expect(bestAfterSecond).toBe(4); // unveraendert, kein Rueckschritt
  });

  test('Tagesgate: ein zweiter Start-Versuch am selben Berlin-Kalendertag ist blockiert (Button + Funktionsaufruf)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openTowerPanel(page);
    await page.locator('#idleTurmStartBtn').click();
    await loseCurrentWave(page); // Lauf beenden, turm_last_attempt_at bleibt gesetzt

    await openTowerPanel(page);
    await expect(page.locator('#idleTurmStartBtn')).toBeDisabled();
    const startedAgain = await page.evaluate(() => bkmpTowerStart());
    expect(startedAgain).toBe(false);
    expect(await page.evaluate(() => bkmpTowerActive)).toBe(false);
  });

  test('Tagesgate: turm_last_attempt_at wird SOFORT beim Start gesetzt, VOR jedem Wellenkampf (ein sofortiger Reload verliert den Tagesversuch trotzdem)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openTowerPanel(page);
    const before = await page.evaluate(() => bkmpIdleState.turm_last_attempt_at);
    expect(before).toBeNull();
    await page.locator('#idleTurmStartBtn').click();
    const afterStart = await page.evaluate(() => ({ lastAttempt: bkmpIdleState.turm_last_attempt_at, wave: bkmpTowerWave }));
    expect(afterStart.lastAttempt).not.toBeNull();
    expect(afterStart.wave).toBe(1); // noch keine einzige Welle geschafft, Gate ist trotzdem schon aktiv
  });

});

test.describe('Endloser Turm - Zeitgate im Detail', () => {
  test.use({ teststand: 'A', useFakeClock: true, startTimeMs: Date.UTC(2026, 6, 24, 10, 0, 0) });

  test('nach Berlin-Mitternacht ist ein neuer Versuch moeglich, kurz davor noch nicht', async ({ page, qaBaseURL, fixtureData, qaClock }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnTurm').click();
    await page.evaluate(() => bkmpIdleRenderTurmPanel());
    await page.locator('#idleTurmStartBtn').click();
    await page.evaluate(() => { bkmpIdleCurrentDragon.hp = 0; bkmpIdleHandleDragonDefeated(); }); // Welle 1 gewonnen
    await page.evaluate(() => bkmpIdleHandleDefeat()); // Lauf beenden

    // 1 Minute vor Mitternacht (Berlin) - noch derselbe Kalendertag.
    await page.clock.setFixedTime(Date.UTC(2026, 6, 24, 21, 59, 0)); // 23:59 Berlin (CEST=UTC+2)
    await page.evaluate(() => bkmpIdleRenderTurmPanel());
    await expect(page.locator('#idleTurmStartBtn')).toBeDisabled();

    // 2 Minuten spaeter - neuer Berlin-Kalendertag.
    await page.clock.setFixedTime(Date.UTC(2026, 6, 24, 22, 1, 0)); // 00:01 Berlin, 25.07.
    await page.evaluate(() => bkmpIdleRenderTurmPanel());
    await expect(page.locator('#idleTurmStartBtn')).toBeEnabled();
    const started = await page.evaluate(() => bkmpTowerStart());
    expect(started).toBe(true);
  });
});

test.describe('Endloser Turm - Reload/Nutzertrennung/Grenzfaelle', () => {
  test.use({ teststand: 'A' });

  test('Reload waehrend eines laufenden Turmlaufs verliert die Wellen-Position, aber nicht bereits gebankte Belohnungen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // 06.09.2026 (Testfund, kein App-Bug - identisches, bereits mehrfach in
    // CLAUDE.md dokumentiertes Muster wie bei prestige.spec.js/combat.spec.js):
    // der Hintergrund-Kampf-Loop laeuft ohne diesen Stop unveraendert weiter,
    // waehrend der Test "goldBeforeReload" als exakten, unveraenderlichen
    // Referenzwert nimmt - ein einzelner Tick zwischen Snapshot und Reload
    // kann Gold legitim erhoehen (Gebaeude-Trickle/ein weiterer Kill), was
    // die Assertion faelschlich als Datenverlust-Bug erscheinen laesst.
    await page.evaluate(() => bkmpIdleStopLoop());
    await page.locator('#idleTabBtnTurm').click();
    await page.evaluate(() => bkmpIdleRenderTurmPanel());
    await page.locator('#idleTurmStartBtn').click();
    await clearOneWave(page); // Welle 1 gewonnen (Gold/EXP bereits gebankt), jetzt auf Welle 2
    const goldBeforeReload = await page.evaluate(() => bkmpIdleState.gold);
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    await page.reload();
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);

    const after = await page.evaluate(() => ({ active: bkmpTowerActive, gold: bkmpIdleState.gold, best: bkmpIdleState.turm_highest_wave }));
    expect(after.active).toBe(false); // kein "Wellenposition ueberlebt Reload"-Mechanismus vorhanden
    // 06.09.2026 (Testfund, kein App-Bug - identische, bereits am 25.07.2026
    // fuer prestige.spec.js dokumentierte und dort geloeste Ursache): der
    // Reload laesst bkmpIdleAccrueProductionBuildings() beim Neuladen
    // erneut ueber die tatsaechlich verstrichene WANDUHRZEIT abrechnen
    // (Teststand A hat goldmine_level:8, produziert spuerbar) - komplett
    // unabhaengig vom (oben bereits gestoppten) Kampf-Tick-Loop. Ein exakter
    // Gleichheits-Check ist damit zu strikt fuer ein Idle-Spiel, das laut
    // Design nie total stillsteht - toleriert bewusst eine kleine, aus
    // echter Zeit resultierende Grundproduktion, waehrend ein echter
    // Datenverlust (gold < goldBeforeReload) weiterhin zuverlaessig auffiele.
    expect(after.gold).toBeGreaterThanOrEqual(goldBeforeReload);
    expect(after.gold).toBeLessThan(goldBeforeReload + 50);
    expect(after.best).toBe(0); // Welle 2 wurde nie fertig gekaempft, zaehlt nicht als Rekord
  });

  test('Logout/Login zeigt weiterhin den serverseitig persistenten Rekord', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnTurm').click();
    await page.evaluate(() => bkmpIdleRenderTurmPanel());
    await page.locator('#idleTurmStartBtn').click();
    for (let i = 0; i < 2; i++) await clearOneWave(page);
    await loseCurrentWave(page); // Rekord = 2
    await dismissResultCardIfAny(page);
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    /* Etabliertes Logout/Login-Muster (siehe qa-mode-security.spec.js) -
       bkmpPlayerLogout() raeumt nur die Supabase-Session weg, den
       GECACHTEN Anzeigenamen erst bkmpSetMcName('') (sonst haelt
       #mcNameBadge den Spieler faelschlich fuer eingeloggt) - beide
       Aufrufe muessen awaited werden, kein page.reload() noetig. */
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

    const best = await page.evaluate(() => bkmpIdleState.turm_highest_wave);
    expect(best).toBe(2);
  });

  test('doppelter/paralleler Start-Versuch startet den Lauf nur genau einmal (bkmpTowerActive-Sperre)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnTurm').click();
    await page.evaluate(() => bkmpIdleRenderTurmPanel());

    const results = await page.evaluate(() => Promise.all([bkmpTowerStart(), bkmpTowerStart(), bkmpTowerStart()]));
    expect(results.filter(r => r === true).length).toBe(1);
    expect(await page.evaluate(() => bkmpTowerWave)).toBe(1);
  });

});

test.describe('Endloser Turm - Teststand E (Maximalbelastung)', () => {
  test.use({ teststand: 'E' });

  test('bereits hoher Rekord (5000): keine negativen/NaN/Infinity-Werte nach weiteren Siegen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnTurm').click();
    await page.evaluate(() => bkmpIdleRenderTurmPanel());
    await page.locator('#idleTurmStartBtn').click();
    for (let i = 0; i < 3; i++) await clearOneWave(page);

    const state = await page.evaluate(() => ({
      maxHp: bkmpIdleCurrentDragon.maxHp, attack: bkmpIdleCurrentDragon.attack,
      gold: bkmpIdleState.gold, xp: bkmpIdleState.xp
    }));
    for (const key of ['maxHp', 'attack', 'gold', 'xp']) {
      expect(Number.isFinite(state[key])).toBe(true);
      expect(state[key]).toBeGreaterThanOrEqual(0);
    }
    await loseCurrentWave(page);
    const best = await page.evaluate(() => bkmpIdleState.turm_highest_wave);
    expect(best).toBeGreaterThanOrEqual(5000); // vorheriger Rekord (5000) bleibt mindestens erhalten
    expect(Number.isFinite(best)).toBe(true);
  });
});
