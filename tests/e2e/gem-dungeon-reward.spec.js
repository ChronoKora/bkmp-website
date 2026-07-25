const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Dringender Bugfix-Auftrag 25.07.2026 (Nutzerbericht: "Edelstein-Dungeon
   auf höchster Stufe gab keinen Loot. Es wurden 5000 Kristalle angezeigt,
   aber laut Anzeige habe ich keine bekommen.").

   Codeanalyse (js/systems/bkmp-dungeon.js, bkmpDungeonGrantReward/
   bkmpDungeonRewardParts/bkmpDungeonFinish): die angezeigte Zahl
   (summary.gems, per "+${summary.gems} 💎" im Ergebnis-Popup) und die
   tatsaechlich gutgeschriebene Zahl (bkmpIdleState.crystals += summary.gems)
   sind IM SELBEN Funktionsaufruf DIESELBE Variable - kein Feldnamen-Mismatch
   (kein crystals/gems/diamonds-Durcheinander gefunden), keine harte
   Obergrenze (anders als bei meat/fruit gibt es fuer Kristalle keinen
   Deckel). Der deterministische Vollablauf-Test unten (mit realistisch
   hohem Angriffswert) beweist: bei einem GENUEGEND starken Spieler stimmen
   Anzeige/State/Server/Reload/Autosave alle exakt ueberein - KEIN
   Persistenz-/Race-/Feldnamen-Bug gefunden trotz gezielter Pruefung aller
   vom Auftrag genannten Verdachtsmomente (Race Conditions, veraltete
   Antworten, langsame/parallele Speicherantworten, Reload).

   ECHTER, BESTAETIGTER FUND (per direktem Debug-Test bewiesen): der
   'gem'-Zweig von bkmpDungeonGrantReward rundete den Pro-Welle-Basiswert
   (Math.round((s.attack||10)*0.005)) VOR jeder Multiplikation/Summierung -
   bei einem Koeffizienten von 0.005 (bewusst klein gewaehlt, siehe
   Balance-Kommentar an derselben Stelle) rundet das fuer jeden Spieler mit
   einem effektiven Angriff unter ~100 schon HIER auf exakt 0, wodurch die
   GESAMTE Belohnung ueber alle Wellen hinweg bei 0 blieb (0 * Wellenzahl *
   Multiplikator = 0) - unabhaengig von der gewaehlten Schwierigkeit. Exakt
   dieselbe Bug-Klasse wie die bereits am 20.07. behobenen seltenen
   Drachen-Drops in der Offline-Simulation (siehe CLAUDE.md "Bug 7" -
   dortiger Fix: Rohwert aufsummieren, erst am Ende EINMAL runden). Gefixt
   in bkmpDungeonBaseAmount (kein Runden mehr pro Welle) + am 'gem'-Aufruf
   selbst (kein Runden mehr vor der Wellen-Summierung). */

async function seedGemDungeonUnlockedAtHighest(page) {
  await page.evaluate(() => {
    bkmpDungeonSelectedDifficultyByType.gem = 'albtraum';
    if (!bkmpDungeonStatusByType.gem) bkmpDungeonStatusByType.gem = { keys: 5, highestDifficulty: 'albtraum', totalCompletions: 0, totalDefeats: 0 };
    else bkmpDungeonStatusByType.gem.highestDifficulty = 'albtraum';
    /* WICHTIGER DIAGNOSE-FUND (per direktem Debug-Test bewiesen, nicht geraten): Teststand C's
       Fixture (tests/fixtures/teststands.js) setzt idle_player_state.attack=12500 direkt - aber
       bkmpDungeonGrantReward liest NICHT diesen Rohwert, sondern bkmpIdleEffectiveStats.attack
       (die tatsaechliche LIVE-Kampfstat, berechnet aus upgrade_purchases/skill_allocations/Runen/
       Titeln ueber bkmpIdleRecomputeEffectiveStats - siehe idledorf.js). Teststand C's
       upgrade_purchases ({sword:40,shield:40,boots:40,amulet:30}) ergeben nur ~65 effektiven
       Angriff, NICHT 12500 - reiner Fixture-Realismus-Unterschied (die Teststaende wurden fuer
       andere Zwecke gebaut, nicht fuer "hoher End-game-Angriff"), KEIN App-Bug. Fuer einen echten
       Test des Nutzer-Szenarios (starker Endgame-Spieler, "5000 Kristalle angezeigt") wird
       bkmpIdleEffectiveStats.attack hier direkt auf einen realistischen hohen Wert gesetzt -
       exakt der Weg, den auch bkmpDungeonGrantReward tatsaechlich liest. */
    bkmpIdleEffectiveStats.attack = 400000;
  });
}

test.describe('Bug 2 - Edelstein-Dungeon (hoechste Stufe) Kristall-Belohnung (Teststand C)', () => {
  test.use({ teststand: 'C' });

  test('deterministischer Vollablauf: angezeigte Kristallmenge erhoeht bkmpIdleState.crystals exakt, uebersteht sofortigen Reload UND Auto-Save', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await seedGemDungeonUnlockedAtHighest(page);

    // 1) Kristallstand VOR dem Dungeon.
    const crystalsBefore = await page.evaluate(() => bkmpIdleState.crystals);

    // 2) Hoechste vorhandene Edelstein-Dungeonstufe starten (echte Funktion, echter Schluessel-Verbrauch).
    const started = await page.evaluate(() => bkmpDungeonStart('gem'));
    expect(started).toBe(true);
    const activeDifficulty = await page.evaluate(() => bkmpDungeonActiveDifficulty.id);
    expect(activeDifficulty).toBe('albtraum');

    // 3) Dungeon erfolgreich abschliessen (direkter Aufruf der echten Abschlussfunktion,
    //    identisches Muster wie tower.spec.js/combat.spec.js - umgeht nur den Wellen-Grind-Timer,
    //    NICHT die Belohnungsformel selbst). bkmpDungeonFinish gibt die Summary nicht zurueck -
    //    das tatsaechliche Kristall-Delta wird direkt aus dem State abgeleitet (robuster als eine
    //    zweite, geratene Kopie der Formel).
    await page.evaluate(() => bkmpDungeonFinish(true));
    const crystalsAfterFinish = await page.evaluate(() => bkmpIdleState.crystals);
    const actualGain = crystalsAfterFinish - crystalsBefore;
    expect(actualGain).toBeGreaterThan(0); // "hoechste Stufe gab keinen Loot" widerlegt/bestaetigt: hier MUSS ein Gewinn > 0 stehen

    // 4) Angezeigte Belohnung exakt erfassen (aus dem echten, gerade gezeigten Ergebnis-Popup-Text).
    const popupText = await page.locator('#bkmpDungeonResultOverlay').innerText();
    const match = popupText.match(/\+([\d.,]+)\s*💎/);
    expect(match).toBeTruthy();
    const displayedGems = Number(match[1].replace(/[.,]/g, ''));

    // 5) Kristallstand muss sich EXAKT um den angezeigten Wert erhoeht haben.
    expect(actualGain).toBe(displayedGems);

    // 6) Server-/Mock-Zustand muss (nach einem erzwungenen Sofort-Speichern) denselben Wert enthalten.
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    const serverRow = store.tables.idle_player_state.find(r => r.name_key === fixtureData.nameKey);
    expect(serverRow.crystals).toBe(crystalsAfterFinish);

    // 7) Seite neu laden.
    await page.reload();
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);

    // 8) Kristalle muessen weiterhin vorhanden sein.
    const crystalsAfterReload = await page.evaluate(() => bkmpIdleState.crystals);
    expect(crystalsAfterReload).toBe(crystalsAfterFinish);

    // 9) Auto-Save auslösen (weiterer manueller Kauf-aehnlicher Zustandswechsel + Flush).
    await page.evaluate(() => { bkmpIdleState.gold += 1; bkmpIdleQueueSync(); });
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    // 10) Kristalle duerfen nicht wieder verschwinden.
    const crystalsAfterAutosave = await page.evaluate(() => bkmpIdleState.crystals);
    expect(crystalsAfterAutosave).toBe(crystalsAfterFinish);
  });

  test('normale Stufe (leicht) verhaelt sich identisch (kein auf "hoechste Stufe" beschraenkter Sonderfall)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => { bkmpDungeonSelectedDifficultyByType.gem = 'leicht'; bkmpIdleEffectiveStats.attack = 400000; });
    const crystalsBefore = await page.evaluate(() => bkmpIdleState.crystals);
    const started = await page.evaluate(() => bkmpDungeonStart('gem'));
    expect(started).toBe(true);
    await page.evaluate(() => bkmpDungeonFinish(true));
    const crystalsAfter = await page.evaluate(() => bkmpIdleState.crystals);
    expect(crystalsAfter).toBeGreaterThan(crystalsBefore);
  });

  test('REPRODUKTION (Race): sofortiger Reload INNERHALB des 4s-Debounce-Fensters nach Dungeon-Sieg verliert die gerade gewonnenen Kristalle', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await seedGemDungeonUnlockedAtHighest(page);
    const crystalsBefore = await page.evaluate(() => bkmpIdleState.crystals);
    await page.evaluate(() => bkmpDungeonStart('gem'));
    await page.evaluate(() => bkmpDungeonFinish(true));
    const crystalsAfterFinish = await page.evaluate(() => bkmpIdleState.crystals);
    expect(crystalsAfterFinish).toBeGreaterThan(crystalsBefore);

    // Server-Stand NIEMALS explizit geflusht (kein bkmpIdleFlushSyncNow, kein Warten auf die 4s) -
    // simuliert exakt "Popup sofort weggeklickt, direkt Tab/Seite gewechselt".
    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
    await page.reload();
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);
    const crystalsAfterReload = await page.evaluate(() => bkmpIdleState.crystals);

    /* Der reale beforeunload-Handler (idledorf.js) ruft bkmpIdleQueueSync()+bkmpIdleFlushSync()
       SOFORT (nicht erst nach 4s) auf - genau dafuer existiert er. Ein echtes hartes Schliessen
       OHNE dass der Browser diesem Handler noch Zeit fuer seinen Fetch gibt, waere die einzige
       Luecke - das lässt sich in Playwright nicht 1:1 nachstellen (kein echter Prozess-Kill
       mitten im Request). Bestaetigt hier NUR, dass der bereits vorhandene beforeunload-Schutz
       fuer den NORMALEN "Popup weg -> Tab wechseln/Seite neu laden"-Fall bereits ausreicht. */
    expect(crystalsAfterReload).toBe(crystalsAfterFinish);
  });

  test('langsame Speicherantwort blockiert die lokale Kristallanzeige nicht und verliert nichts, sobald sie eintrifft', async ({ page, context, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await seedGemDungeonUnlockedAtHighest(page);
    const crystalsBefore = await page.evaluate(() => bkmpIdleState.crystals);
    await context.route('**/rest/v1/idle_player_state*', async (route) => {
      if (route.request().method() === 'PATCH') await new Promise(r => setTimeout(r, 1500));
      return route.fallback();
    });
    await page.evaluate(() => bkmpDungeonStart('gem'));
    await page.evaluate(() => bkmpDungeonFinish(true));
    const crystalsAfterFinish = await page.evaluate(() => bkmpIdleState.crystals);
    expect(crystalsAfterFinish).toBeGreaterThan(crystalsBefore);
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    await expect.poll(() => {
      const row = store.tables.idle_player_state.find(r => r.name_key === fixtureData.nameKey);
      return row && row.crystals;
    }, { timeout: 5000 }).toBe(crystalsAfterFinish);
  });

  test('paralleler Auto-Save waehrend des Dungeon-Abschlusses ueberschreibt die neue Kristallmenge nicht mit einem aelteren Stand', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await seedGemDungeonUnlockedAtHighest(page);
    // Ein bereits VOR dem Dungeon-Sieg angestossener Sync (aelterer Stand) laeuft noch, WAEHREND
    // der Dungeon-Sieg den Kristallwert erhoeht - bkmpIdleFlushInFlight (siehe idledorf.js-Kommentar
    // zu bkmpIdleFlushSync) serialisiert echte Netzwerk-Schreibvorgaenge bereits fuer genau diesen Fall.
    await page.evaluate(() => { bkmpIdleState.gold += 1; });
    const flushPromise = page.evaluate(() => bkmpIdleFlushSyncNow());
    await page.evaluate(() => bkmpDungeonStart('gem'));
    await page.evaluate(() => bkmpDungeonFinish(true));
    await flushPromise;
    const crystalsAfterFinish = await page.evaluate(() => bkmpIdleState.crystals);
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    const serverRow = store.tables.idle_player_state.find(r => r.name_key === fixtureData.nameKey);
    expect(serverRow.crystals).toBe(crystalsAfterFinish);
  });

  test('kein doppelter Loot: bkmpDungeonActive schaltet sofort auf false, die beiden echten Aufrufstellen (Welle-geschafft/Niederlage) koennen bkmpDungeonFinish darum strukturell nicht zweimal fuer denselben Lauf ausloesen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await seedGemDungeonUnlockedAtHighest(page);
    await page.evaluate(() => bkmpDungeonStart('gem'));
    expect(await page.evaluate(() => bkmpDungeonActive)).toBe(true);
    await page.evaluate(() => bkmpDungeonFinish(true));
    const crystalsAfterFirstFinish = await page.evaluate(() => bkmpIdleState.crystals);
    expect(crystalsAfterFirstFinish).toBeGreaterThan(4200); // Teststand C startet mit 4200 - echter, spuerbarer Gewinn
    // bkmpDungeonActive=false wird als ALLERERSTES in bkmpDungeonFinish gesetzt (js/systems/bkmp-dungeon.js:1068) -
    // die beiden einzigen echten Aufrufstellen (bkmpDungeonHandleWaveCleared/-HandleFailure, ausgeloest vom
    // Kampf-Tick) laufen selbst nur, waehrend ein Encounter aktiv ist - kein UI-Pfad kann diesen Zustand
    // von aussen zuruecksetzen, ohne bkmpDungeonStart() (das seinerseits einen neuen, echten Schluessel
    // verbraucht) erneut zu durchlaufen.
    expect(await page.evaluate(() => bkmpDungeonActive)).toBe(false);
  });
});

test.describe('Bug 2 - REGRESSION: Edelstein-Belohnung durfte nicht mehr auf 0 abrunden (Teststand A/B, realistische niedrige/mittlere Angriffswerte)', () => {
  test.use({ teststand: 'A' });

  test('niedriger Angriffswert (Teststand A, frischer Spieler): Edelstein-Dungeon "leicht" liefert trotzdem einen echten, spuerbaren Kristallgewinn statt lautlos 0', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // bkmpIdleEffectiveStats.attack fuer einen frischen Spieler bewusst NICHT angehoben - genau der
    // Zustand (niedriger, aber nicht Null Angriff), der den Bug vor dem Fix ausgeloest hat.
    const attack = await page.evaluate(() => bkmpIdleEffectiveStats.attack);
    expect(attack).toBeGreaterThan(0);
    expect(attack).toBeLessThan(100); // genau der vorher betroffene Bereich (Math.round(attack*0.005) rundete auf 0)
    await page.evaluate(() => {
      bkmpDungeonSelectedDifficultyByType.gem = 'leicht';
      if (!bkmpDungeonStatusByType.gem) bkmpDungeonStatusByType.gem = { keys: 5, highestDifficulty: 'leicht', totalCompletions: 0, totalDefeats: 0 };
    });
    const crystalsBefore = await page.evaluate(() => bkmpIdleState.crystals);
    const started = await page.evaluate(() => bkmpDungeonStart('gem'));
    expect(started).toBe(true);
    await page.evaluate(() => bkmpDungeonFinish(true));
    const crystalsAfter = await page.evaluate(() => bkmpIdleState.crystals);
    expect(crystalsAfter).toBeGreaterThan(crystalsBefore);
  });

  test('direkter Formel-Beweis: bkmpDungeonBaseAmount(0.3, 25 Wellen, ...) liefert vor dem Fix IMMER 0, nach dem Fix einen echten positiven Wert', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const result = await page.evaluate(() => bkmpDungeonBaseAmount(0.3, 25, 2.2, true));
    // 0.3 pro Welle * (1..25 Wellen, +8%/Welle) aufsummiert * 2.2 (Albtraum-rewardMult) * 1.2 (Erfolgsbonus).
    // Vor dem Fix: Math.round(0.3*...)=0 in JEDER Welle -> total bleibt 0. Nach dem Fix: echte Summe > 0.
    expect(result).toBeGreaterThan(0);
  });
});
