/* Phase 7.3 (23.07.2026) - Regressionstest fuer den kritischen "Navigations-
   Buttons verschwinden"-Bug (Nutzer-Video F:\Video\2026-07-23 21-53-39.mp4).

   Root Cause (siehe js/systems/bkmp-raid.js, bkmpRaidToggleCombatView):
   bkmpIdleCloseModal() ruft IMMER bkmpRaidStopCombatView() -> bkmpRaidToggle-
   CombatView(false), auch wenn nie ein Raid-Kampf lief. Diese Funktion pruefte
   bisher BKMP_PROTO_COMPACT_HUD_ENABLED (ein statisches "ist das Kompakt-HUD-
   Prototyp-Skript ueberhaupt geladen"-Flag, IMMER true) statt des dynamischen
   "ist die kompakte Navigation GERADE JETZT die sichtbare"-Zustands
   (bkmpProtoChudCompactActive) - dadurch wurde #idleDorfTabs bei JEDEM
   Schliessen unconditional auf display:none gesetzt, unabhaengig von der
   Bildschirmbreite. bkmpProtoChudSyncVisibility()'s eigener Cache-Vergleich
   (wantCompact === bkmpProtoChudCompactActive) erkennt danach keinen "echten"
   Wechsel und stellt #idleDorfTabs beim Wiederoeffnen NIE wieder her - beide
   Navigationssysteme (Desktop-Tableiste UND mobile Kompakt-Nav) bleiben
   unsichtbar, bis ein voller Seiten-Reload den Cache zuruecksetzt.

   Dieser Test deckt genau das ab: viele Oeffnen/Schliessen-Zyklen, schnelle
   Tab-Wechsel, sofortiges Schliessen/Wiederoeffnen, Breiten-Wechsel - nach
   JEDEM Zustand muss mindestens eine gueltige Navigation sichtbar sein. */

const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');
const { IDLE_TABS } = require('../helpers/selectors');

async function closeIdleDorf(page) {
  await page.locator('#idleDorfCloseX').click();
  await expect(page.locator('#idleDorfOverlay')).not.toHaveClass(/visible/, { timeout: 5000 });
}

async function reopenIdleDorf(page) {
  await page.locator('#idleDorfButton').click();
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 5000 });
}

/* Fuer die Tempo-Stresstests unten: echte DOM-.click()-Aufrufe statt
   Playwrights synthetischer Maus-Steuerung. Zwei Gruende: (1) auf schmalen
   Viewports stecken die ECHTEN #idleTabBtnXxx-Buttons absichtlich in einem
   versteckten #idleDorfTabs (die kompakte Nav bedient sie per Proxy-Klick
   genau so, siehe bkmpProtoChudActivateTab: `btn.click()`) - eine
   Null-Groesse-Bounding-Box laesst selbst {force:true} fehlschlagen, ein
   echter .click()-DOM-Aufruf aber nicht. (2) Testet zuverlaessig den echten
   Klick-Handler bei maximalem Tempo, ohne dass Playwrights eigene
   Sichtbarkeits-/Stabilitaets-Heuristik (fuer super-schnelle Klickfolgen
   ohne jede Wartezeit nicht gedacht) den Stresstest selbst verlangsamt oder
   verfaelscht. */
async function domClick(page, id) {
  const clicked = await page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) return false;
    el.click();
    return true;
  }, id);
  expect(clicked, `#${id} nicht im DOM gefunden`).toBe(true);
}

/* Zentrale Invariante (Auftrag Abschnitt 12): nach JEDEM Oeffnen muss
   mindestens eines der beiden Navigationssysteme sichtbar UND mit echter
   Ausdehnung im Viewport sein - niemals beide gleichzeitig fehlen. Desktop-
   Tableiste = #idleDorfTabs (System C/B), mobile Kompakt-Nav = #bkmpProto
   CompactNav (System A). Prueft echte Sichtbarkeit (nicht nur DOM-Praesenz):
   display, Breite/Hoehe > 0. */
async function assertSomeNavVisible(page, context) {
  const state = await page.evaluate(() => {
    function realVisible(sel) {
      const el = document.querySelector(sel);
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        present: true,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        width: rect.width,
        height: rect.height,
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      };
    }
    return {
      desktopTabs: realVisible('#idleDorfTabs'),
      compactNav: realVisible('#bkmpProtoCompactNav')
    };
  });
  const anyVisible = (state.desktopTabs.present && state.desktopTabs.visible)
    || (state.compactNav.present && state.compactNav.visible);
  expect(anyVisible, `${context}: keine Navigation sichtbar - desktopTabs=${JSON.stringify(state.desktopTabs)} compactNav=${JSON.stringify(state.compactNav)}`).toBe(true);
  return state;
}

/* Zusaetzlich, wo relevant: die im Video sichtbaren Kern-Buttons muessen
   tatsaechlich anklickbar sein, nicht nur "irgendein Nav-Element". Nav-
   bewusst: auf schmalen Viewports/App-Modus ist die kompakte Nav
   (bkmp-proto-compact-hud.js) die aktive Bedienoberflaeche - die ECHTEN
   #idleTabBtnXxx-Buttons stecken dort absichtlich in einem versteckten
   #idleDorfTabs (Bedienung laeuft ueber die Proxy-Buttons in
   #bkmpProtoNavPrimary mit data-proto-tab), das ist kein Bug. Auf breiten
   Viewports pruefen wir stattdessen direkt die echten Tab-Buttons. */
async function assertCoreTabButtonsVisible(page, context) {
  const compactActive = await page.evaluate(() => {
    const el = document.getElementById('bkmpProtoCompactNav');
    if (!el) return false;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return cs.display !== 'none' && rect.width > 0 && rect.height > 0;
  });
  const checks = compactActive
    ? { selector: '#bkmpProtoNavPrimary [data-proto-tab]', ids: ['kampf', 'upgrades', 'skilltree', 'prestige'] }
    : { selector: null, ids: ['idleTabBtnKampf', 'idleTabBtnUpgrades', 'idleTabBtnSkilltree', 'idleTabBtnPrestige', 'idleTabBtnRunen'] };
  for (const id of checks.ids) {
    const visible = await page.evaluate(({ id: btnId, compact }) => {
      const el = compact
        ? document.querySelector(`#bkmpProtoNavPrimary [data-proto-tab="${btnId}"]`)
        : document.getElementById(btnId);
      if (!el) return false;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }, { id, compact: compactActive });
    expect(visible, `${context} (compactActive=${compactActive}): Kern-Tab "${id}" nicht sichtbar`).toBe(true);
  }
}

test.describe('Idle-Dorf Navigations-Persistenz @regression', () => {
  test.use({ teststand: 'B' });

  test('Navigation bleibt nach 50x Oeffnen/Schliessen sichtbar', async ({ page, qaBaseURL, fixtureData }) => {
    test.setTimeout(90000); // 50 echte Oeffnen/Schliessen-Zyklen ueberschreiten das 30s-Standardlimit, v.a. unter Mobil-Emulation.
    const consoleErrors = [];
    page.on('pageerror', err => consoleErrors.push(String(err)));
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await openAndLogin(page, qaBaseURL, fixtureData);
    await assertSomeNavVisible(page, 'Erstes Oeffnen');
    await assertCoreTabButtonsVisible(page, 'Erstes Oeffnen');

    for (let i = 1; i <= 50; i++) {
      await domClick(page, 'idleDorfCloseX');
      await expect(page.locator('#idleDorfOverlay')).not.toHaveClass(/visible/, { timeout: 5000 });
      await domClick(page, 'idleDorfButton');
      await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 5000 });
      await assertSomeNavVisible(page, `Zyklus ${i}`);
    }
    await assertCoreTabButtonsVisible(page, 'Nach 50 Zyklen');

    expect(consoleErrors, `Konsolenfehler:\n${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('100 schnelle Tab-Wechsel lassen Navigation intakt', async ({ page, qaBaseURL, fixtureData }) => {
    test.setTimeout(60000);
    await openAndLogin(page, qaBaseURL, fixtureData);
    const ids = IDLE_TABS.map(t => t.btn);
    for (let i = 0; i < 100; i++) {
      await domClick(page, ids[i % ids.length]);
    }
    await assertSomeNavVisible(page, 'Nach 100 Tab-Wechseln');
    await assertCoreTabButtonsVisible(page, 'Nach 100 Tab-Wechseln');
  });

  test('20x schnelles Oeffnen/Schliessen ohne Wartezeit', async ({ page, qaBaseURL, fixtureData }) => {
    test.setTimeout(60000);
    await openAndLogin(page, qaBaseURL, fixtureData);
    for (let i = 1; i <= 20; i++) {
      await domClick(page, 'idleDorfCloseX');
      await domClick(page, 'idleDorfButton');
    }
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 5000 });
    await assertSomeNavVisible(page, 'Nach 20x schnellem Zyklus');
  });

  test('Oeffnen, sofort schliessen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await closeIdleDorf(page);
    await reopenIdleDorf(page);
    await assertSomeNavVisible(page, 'Sofort-Schliessen-Test');
  });

  test('Schliessen, sofort wieder oeffnen (Kernszenario aus dem Video)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleDorfCloseX').click();
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 5000 });
    await assertSomeNavVisible(page, 'Sofort-Wiederoeffnen-Test');
    await assertCoreTabButtonsVisible(page, 'Sofort-Wiederoeffnen-Test');
  });

  test('Doppelklick auf Oeffnen-Button erzeugt keine Dopplung/keinen Nav-Verlust', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await closeIdleDorf(page);
    await page.locator('#idleDorfButton').dblclick();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 5000 });
    await assertSomeNavVisible(page, 'Nach Doppelklick');
    const desktopTabCount = await page.locator('#idleDorfTabs').count();
    expect(desktopTabCount, 'Keine doppelte #idleDorfTabs-Instanz').toBeLessThanOrEqual(1);
  });

  test('Groessenwechsel Desktop->Mobil->Desktop nach Reopen behaelt gueltige Navigation', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await closeIdleDorf(page);
    await reopenIdleDorf(page);
    await assertSomeNavVisible(page, 'Vor Groessenwechsel (Desktop)');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350); // debounced 200ms resize handler
    await assertSomeNavVisible(page, 'Nach Wechsel auf Mobil');

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(350);
    await assertSomeNavVisible(page, 'Nach Rueckkehr zu Desktop');
    await assertCoreTabButtonsVisible(page, 'Nach Rueckkehr zu Desktop');
  });

  test('Raid-Kampfansicht schliessen (ohne je einem Raid beigetreten zu sein) hinterlaesst Navigation intakt', async ({ page, qaBaseURL, fixtureData }) => {
    // Direkter Funktionsaufruf: reproduziert exakt den im Bug-Report
    // relevanten Pfad (bkmpRaidStopCombatView, IMMER Teil von bkmpIdleCloseModal),
    // ohne einen echten Raid-Zustand im Mock-Backend simulieren zu muessen.
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.evaluate(() => { bkmpRaidStopCombatView(); });
    await assertSomeNavVisible(page, 'Nach direktem bkmpRaidStopCombatView()-Aufruf');
    await assertCoreTabButtonsVisible(page, 'Nach direktem bkmpRaidStopCombatView()-Aufruf');
  });
});
