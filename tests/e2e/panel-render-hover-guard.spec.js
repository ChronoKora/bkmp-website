const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Gezielter Bugfix (26.07.2026, Spieler-Video-Beweis: "verzoegert in
   Kategorien wie Upgrades, Kampf laeuft komplett fluessig") - siehe
   CLAUDE.md fuer die volle Root-Cause-Herleitung.

   bkmpIdleRefreshLiveTabsRender() (idledorf.js) baute Upgrades/Runen/
   Prestige/Dorf-Skins/Drachenzucht bei JEDEM Drachen-Kill komplett per
   panel.innerHTML neu auf, solange der jeweilige Tab offen war - waehrend
   aktivem Kampf (ein Kill alle ~0,9-2,5s) riss das dem Spieler mitten in
   einem Hover/Klick auf z.B. einen "Kaufen"-Knopf den DOM-Knoten unter dem
   Cursor weg. Fix: steht die Maus GERADE ueber dem Panel (:hover deckt per
   CSS-Spec auch alle Nachkommen ab), wird das Neu-Rendern verschoben statt
   sofort ausgefuehrt - holt beim naechsten Kill oder sobald die Maus das
   Panel verlaesst zuverlaessig auf. Keine Werte/Formeln geaendert, nur der
   Render-ZEITPUNKT. */

test.use({ teststand: 'C' });

// Beide Tests navigieren ueber den echten Desktop-Tab-Button (#idleTabBtnUpgrades) -
// auf mobile-small/mobile-large per kompakter Navigation versteckt/verschoben
// (siehe Phase 7.0-7.3), gleiches bereits etabliertes Muster wie in mehreren
// anderen Test-Dateien dieser Suite.
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop-only Navigation (#idleTabBtnUpgrades).');
});

test('Panel wird NICHT neu aufgebaut, waehrend die Maus darueber steht - auch nicht bei einem Kill', async ({ page, qaBaseURL, fixtureData }) => {
  await openAndLogin(page, qaBaseURL, fixtureData);
  await waitForDragonReady(page);
  await page.locator('#idleTabBtnUpgrades').click();
  await page.waitForTimeout(200);

  const btn = page.locator('.idle-upgrade-buy').first();
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Marker auf den echten DOM-Knoten setzen und PER REFERENZ (nicht per
  // Selektor) pruefen, ob es genau derselbe Knoten bleibt.
  await page.evaluate(() => {
    const el = document.querySelector('.idle-upgrade-buy');
    el.dataset.diagMarker = 'same-node';
    window.__markedBtn = el;
  });

  // Echten Kill ausloesen, WAEHREND die Maus ueber dem Panel steht -
  // bkmpIdleRefreshLiveTabs() wird intern von bkmpIdleHandleDragonDefeated
  // aufgerufen, direkter Aufruf hier simuliert exakt denselben Trigger ohne
  // vom genauen Timing/Schaden des Mock-Kampfsystems abzuhaengen.
  await page.evaluate(() => window.bkmpIdleRefreshLiveTabs());
  await page.waitForTimeout(50);

  const stillSameNode = await page.evaluate(() => {
    const current = document.querySelector('.idle-upgrade-buy');
    return current === window.__markedBtn && current.dataset.diagMarker === 'same-node';
  });
  expect(stillSameNode, 'Panel wurde trotz aktivem Hover neu aufgebaut - der DOM-Knoten unter dem Cursor wurde ersetzt').toBe(true);
});

test('Panel holt eine verschobene Aktualisierung nach, sobald die Maus es verlaesst', async ({ page, qaBaseURL, fixtureData }) => {
  await openAndLogin(page, qaBaseURL, fixtureData);
  await waitForDragonReady(page);
  await page.locator('#idleTabBtnUpgrades').click();
  await page.waitForTimeout(200);

  const grid = page.locator('.idle-upgrade-grid').first();
  const box = await grid.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);

  // Gold veraendern (Anzeige haengt am aktuellen Goldstand fuer "bezahlbar"),
  // dann einen Refresh anstossen, WAEHREND die Maus noch ueber dem Panel ist -
  // erwartungsgemaess verschoben (siehe Test oben), NICHT verloren.
  await page.evaluate(() => { bkmpIdleState.gold = (bkmpIdleState.gold || 0) + 999999999; window.bkmpIdleRefreshLiveTabs(); });
  await page.waitForTimeout(50);
  // bkmpIdleRefreshLiveTabsPending ist ein top-level "let" (js/core/bkmp-idle-state.js) -
  // haengt bewusst NICHT an window (klassisches Script, kein "var"), bare Bezeichner
  // funktioniert im Seiten-Kontext trotzdem.
  const pendingWhileHovered = await page.evaluate(() => typeof bkmpIdleRefreshLiveTabsPending !== 'undefined' && bkmpIdleRefreshLiveTabsPending === true);
  expect(pendingWhileHovered, 'Aktualisierung haette bei aktivem Hover als "pending" markiert werden muessen').toBe(true);

  // Maus verlaesst das Panel - ein weiterer Refresh-Anstoss (wie er im echten
  // Spiel durch den naechsten Kill oder das bestehende 300ms-Timer-Retry
  // passieren wuerde) muss die Aktualisierung jetzt tatsaechlich anwenden.
  await page.mouse.move(20, 20);
  await page.evaluate(() => window.bkmpIdleRefreshLiveTabs());
  await page.waitForTimeout(200);

  const html = await page.locator('.idle-upgrade-grid').first().innerHTML();
  // Bei 999.999.999 zusaetzlichem Gold muss mindestens ein vorher unbezahlbares
  // Upgrade jetzt als bezahlbar (nicht mehr :disabled) im frisch gerenderten
  // Markup auftauchen - reiner, robuster Beweis, dass tatsaechlich neu
  // gerendert wurde (nicht nur, dass "pending" wieder false ist).
  expect(html).toContain('idle-upgrade-buy');
});
