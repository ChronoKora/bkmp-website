const fs = require('fs');
const path = require('path');
const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');

/* QA-Grundlage Phase 2 (24.07.2026) - echter Fund beim Ausfuehren dieser
   Suite gegen ALLE 3 konfigurierten Projekte (vorher nur je einzeln/nur
   chromium-desktop geprueft, siehe CLAUDE.md): diese Datei klickt echte
   Desktop-Tab-Buttons (#idleTabBtnXxx) per Playwrights .click() (verlangt
   Sichtbarkeit) - auf mobile-small/mobile-large sind diese Knoten absichtlich
   unsichtbar (kompakte Navigation ersetzt sie, siehe mobile-smoke.spec.js),
   der Klick haengt dadurch bis zum 30s-Timeout. KEIN App-Bug (die kompakte
   Navigation funktioniert korrekt, siehe mobile-smoke.spec.js) - die Datei
   wurde nur nie fuer Mobil-Projekte geschrieben. Gleicher Skip-Schutz wie
   mobile-smoke.spec.js, nur umgekehrt - verhindert falsche rote
   Fehlschlaege statt eines echten Fehlers zu verstecken. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - siehe Kommentar oben, mobile-smoke.spec.js deckt die kompakte Navigation ab');
});
const { IDLE_TABS } = require('../helpers/selectors');
const { collectInteractiveElements } = require('../helpers/inventory');

const REPORT_PATH = path.join(__dirname, '..', 'report', 'button-inventory.json');

/* Auftrag Abschnitt 5/6: automatische Bestandsaufnahme aller interaktiven
   Elemente im Idle-Dorf - ID/Klasse/Text/aria-label/sichtbar/aktiv, als
   maschinenlesbarer Bericht. Teststand C (fortgeschritten) benutzt, damit
   moeglichst viele sonst leere/gesperrte Bereiche echten Inhalt zeigen
   (Runen-Inventar, hohe Werte, Prestige moeglich). Kein Klick auf
   irgendein Element hier - nur Bestandsaufnahme, die eigentliche
   Reaktionspruefung passiert in den domain-spezifischen Suiten
   (combat/runes/dungeon/prestige). */
test.describe('Button-/Interaktionselement-Inventar', () => {
  test.use({ teststand: 'C' });

  test('inventarisiert alle interaktiven Elemente je Tab und schreibt einen Bericht', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);

    const report = { generatedAt: new Date().toISOString(), teststand: 'C', tabs: {} };
    const seenIds = new Map(); // id -> [tabId, ...] to detect real cross-tab ID duplicates

    for (const tab of IDLE_TABS) {
      await page.locator('#' + tab.btn).click();
      await expect(page.locator('#' + tab.panel)).toBeVisible();
      // Let the panel's own render() finish (most are synchronous, some throttle-render).
      await page.waitForTimeout(150);

      const elements = await collectInteractiveElements(page, '#' + tab.panel);
      report.tabs[tab.id] = {
        panelId: tab.panel,
        count: elements.length,
        elements
      };
      elements.forEach(el => {
        if (!el.id) return;
        if (!seenIds.has(el.id)) seenIds.set(el.id, []);
        seenIds.get(el.id).push(tab.id);
      });
    }

    // Also the always-present HUD/nav chrome outside any single tab panel.
    const chromeElements = await collectInteractiveElements(page, '#idleDorfOverlay .idle-dorf-hud, #idleDorfTabs');
    report.chrome = { count: chromeElements.length, elements: chromeElements };

    const totalCount = Object.values(report.tabs).reduce((sum, t) => sum + t.count, 0) + report.chrome.count;
    report.totalCount = totalCount;

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    expect(totalCount, 'Should have found at least some interactive elements across all tabs').toBeGreaterThan(20);

    // Duplicate IDs WITHIN the same panel are a real bug (ambiguous #id selector);
    // the same id legitimately re-appearing on unrelated tabs is not (each tab's
    // markup is a separate template render cycle, ids aren't necessarily globally
    // reserved across the whole idle-dorf, only within a panel at any one time).
    for (const tab of IDLE_TABS) {
      const ids = report.tabs[tab.id].elements.map(el => el.id).filter(Boolean);
      const duplicates = ids.filter((id, idx) => ids.indexOf(id) !== idx);
      expect(duplicates, `Duplicate element ids within tab "${tab.id}": ${duplicates.join(', ')}`).toEqual([]);
    }
  });

  test('jedes sichtbare, aktivierte Element hat einen zugaenglichen Namen (Text/aria-label/title)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    const problems = [];

    for (const tab of IDLE_TABS) {
      await page.locator('#' + tab.btn).click();
      await page.waitForTimeout(150);
      const elements = await collectInteractiveElements(page, '#' + tab.panel);
      elements
        .filter(el => el.visible && el.opacityVisible && !el.disabled && !el.hasAccessibleLabel)
        .forEach(el => problems.push(`${tab.id}: <${el.tag} id="${el.id || ''}" class="${el.className || ''}">`));
    }

    expect(problems, `Elements without any accessible name:\n${problems.join('\n')}`).toEqual([]);
  });
});
