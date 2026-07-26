const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Live-Bugreport 26.07.2026 (Nutzerscreenshot: Stufenleisten-Buttons
   "Automatisch"/"Beste Stufe"/"Stufe waehlen" nach einem Kampf dauerhaft
   verschwunden, Nutzer erwaehnte "XP von einem Boss" - passt zum Turm-
   System, dessen Mini-Boss-Wellen dieselben "+Gold +XP"-Hochschweb-Chips
   zeigen wie ein normaler Drachen-Boss).

   Root Cause (per Codeanalyse bewiesen, siehe bkmpIdleStageBarWantedVisible()
   in idledorf.js): bkmpDungeonStart()/bkmpTowerStart() setzen #idleStageBar
   fuer die Laufdauer direkt auf style.display='none', ausserhalb jeder
   Koordination mit bkmpProtoChudSyncVisibility() (js/prototype/bkmp-proto-
   compact-hud.js). Ein Fix vom 20.07. (Spieler-Meldung "nach einem Dungeon
   kam das alte Menu wieder") entfernte das Wiedereinblenden in
   bkmpDungeonFinish()/bkmpTowerFinish() ERSATZLOS, mit der nur fuer den
   KOMPAKTEN Mobil-Modus richtigen Begruendung "die alte Stufenleiste soll
   dauerhaft versteckt bleiben". Auf normaler Desktop-Breite ist #idleStageBar
   aber die EINZIGE Stufenleiste - seit diesem Fix blieb sie dort nach JEDEM
   Dungeon-/Turm-Lauf fuer den Rest der Sitzung unsichtbar, weil
   bkmpProtoChudSyncVisibility()s eigener Cache (bkmpProtoChudCompactActive)
   den direkten, uncoordinierten style.display-Zugriff der Dungeon-/Turm-
   Funktionen nie als "Zustandswechsel" erkennt und deshalb nie erneut
   eingreift. Fix: bkmpIdleStageBarWantedVisible() (idledorf.js) prueft den
   ECHTEN, aktuellen Kompakt-Zustand dynamisch (identisches Muster wie die
   bereits in Phase 7.3 gefundene bkmpRaidToggleCombatView()-Bugklasse -
   statisches Lade-Flag durch echten Live-Zustand ersetzt) - beide Finish-
   Funktionen blenden #idleStageBar jetzt nur dann wieder ein, wenn der
   kompakte Modus GERADE JETZT nicht aktiv ist. */

test.describe('Stufenleisten-Sichtbarkeit nach Dungeon-/Turm-Lauf (Teststand C)', () => {
  test.use({ teststand: 'C' });

  test('Desktop: Dungeon-Lauf versteckt die Stufenleiste waehrend des Laufs und blendet sie danach korrekt wieder ein', async ({ page, qaBaseURL, fixtureData }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const before = await page.evaluate(() => ({
      display: document.getElementById('idleStageBar').style.display,
      buttonCount: document.getElementById('idleStageBar').querySelectorAll('button').length
    }));
    expect(before.display).not.toBe('none');
    expect(before.buttonCount).toBeGreaterThan(0);

    await page.evaluate(() => {
      if (!bkmpDungeonStatusByType.gold) bkmpDungeonStatusByType.gold = { keys: 5, highestDifficulty: 'leicht', totalCompletions: 0, totalDefeats: 0 };
      else bkmpDungeonStatusByType.gold.keys = 5;
      bkmpDungeonSelectedDifficultyByType.gold = 'leicht';
    });
    const started = await page.evaluate(() => bkmpDungeonStart('gold'));
    expect(started).toBe(true);

    const duringRun = await page.evaluate(() => document.getElementById('idleStageBar').style.display);
    expect(duringRun).toBe('none');

    await page.evaluate(() => bkmpDungeonFinish(true));

    const after = await page.evaluate(() => ({
      display: getComputedStyle(document.getElementById('idleStageBar')).display,
      buttonCount: document.getElementById('idleStageBar').querySelectorAll('button').length
    }));
    expect(after.display).not.toBe('none');
    expect(after.buttonCount).toBeGreaterThan(0);
  });

  test('Desktop: Turm-Lauf versteckt die Stufenleiste waehrend des Laufs und blendet sie danach korrekt wieder ein (Niederlage)', async ({ page, qaBaseURL, fixtureData }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const started = await page.evaluate(() => bkmpTowerStart());
    expect(started).toBe(true);
    const duringRun = await page.evaluate(() => document.getElementById('idleStageBar').style.display);
    expect(duringRun).toBe('none');

    // Niederlage simulieren (deckt denselben Finish-Pfad ab wie ein Sieg -
    // bkmpTowerFinish() wird in beiden Faellen aufgerufen).
    await page.evaluate(() => bkmpTowerHandleDefeat());

    const after = await page.evaluate(() => ({
      display: getComputedStyle(document.getElementById('idleStageBar')).display,
      buttonCount: document.getElementById('idleStageBar').querySelectorAll('button').length
    }));
    expect(after.display).not.toBe('none');
    expect(after.buttonCount).toBeGreaterThan(0);
  });

  test('Desktop: "Turm aufgeben" waehrend eines laufenden Versuchs blendet die Stufenleiste ebenfalls korrekt wieder ein', async ({ page, qaBaseURL, fixtureData }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    await page.evaluate(() => bkmpTowerStart());
    await page.evaluate(() => bkmpTowerGiveUp());

    const after = await page.evaluate(() => getComputedStyle(document.getElementById('idleStageBar')).display);
    expect(after).not.toBe('none');
  });

  test('Regressionsschutz: bleibt im kompakten Modus weiterhin dauerhaft versteckt (die urspruengliche 20.07.-Absicht darf nicht kaputtgehen)', async ({ page, qaBaseURL, fixtureData }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    // Kompakten Modus simulieren, ohne die echte Breiten-/Resize-Erkennung
    // nachzustellen - bkmpIdleStageBarWantedVisible() liest ausschliesslich
    // dieses eine Flag, exakt wie die echte bkmpProtoChudSyncVisibility().
    await page.evaluate(() => { bkmpProtoChudCompactActive = true; document.getElementById('idleStageBar').style.display = 'none'; });

    await page.evaluate(() => {
      if (!bkmpDungeonStatusByType.gold) bkmpDungeonStatusByType.gold = { keys: 5, highestDifficulty: 'leicht', totalCompletions: 0, totalDefeats: 0 };
      else bkmpDungeonStatusByType.gold.keys = 5;
      bkmpDungeonSelectedDifficultyByType.gold = 'leicht';
    });
    await page.evaluate(() => bkmpDungeonStart('gold'));
    await page.evaluate(() => bkmpDungeonFinish(true));

    const display = await page.evaluate(() => document.getElementById('idleStageBar').style.display);
    expect(display).toBe('none');
  });
});
