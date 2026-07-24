/* QA-Grundlage Phase 2 (24.07.2026, siehe CLAUDE.md) - gezielte visuelle
   Grundpruefung. BEWUSST KEINE grosse Screenshot-Sammlung (Auftrag Schritt
   12) - zwei getrennte Teile:

   1. "@visual-checks" - rein programmatische Pruefungen (kein horizontales
      Ueberlaufen, keine 0x0-Hauptbuttons, keine fixierte Ueberlagerung der
      Navigation, keine unsichtbaren Overlays mit aktiven pointer-events).
      Diese Pruefungen brauchen KEINE genehmigte Baseline - sie sind reine
      Assertions und koennen gefahrlos automatisch laufen (Teil von qa:full).

   2. "@visual-baseline" - Playwright toHaveScreenshot() fuer eine Handvoll
      stabile Kernbereiche. WICHTIG: toHaveScreenshot() legt beim
      allerersten Lauf automatisch eine Baseline an, OHNE dass ein Mensch sie
      gesehen/bestaetigt hat - das widerspricht dem Auftrag ("Screenshots
      duerfen nur aktualisiert werden, wenn die Veraenderung bewusst
      bestaetigt wurde"). Deshalb bewusst NICHT Teil von qa:full/qa:visual -
      eigenes Tag, muss der Nutzer einmal manuell mit --update-snapshots
      ausfuehren UND die entstandenen PNGs unter tests/e2e/visual.spec.js-
      snapshots/ selbst ansehen/bestaetigen, bevor sie als echte Referenz
      gelten. Diese Session hat bewusst KEINE Baselines erzeugt. */

/* test/expect kommen seit der Sicherheitsverstaerkung (24.07.2026, siehe
   CLAUDE.md) aus network-guard.js: globale Netzwerksperre + fertiger,
   TESTSTANDS-basierter qaServer-Fixture mit garantiertem ?qa=1. */
const { test: base, expect } = require('../helpers/network-guard');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const test = base.extend({
  teststand: ['C', { option: true }]
});

async function domClick(page, id) {
  await page.evaluate((elId) => { const el = document.getElementById(elId); if (el) el.click(); }, id);
}

async function openIdleDorf(page, qaServer) {
  await page.goto(qaServer.url(`/?stand=${qaServer.teststand}`));
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await waitForIdleStateReady(page);
  await waitForDragonReady(page).catch(() => {});
}

async function programmaticChecks(page, context) {
  const result = await page.evaluate(() => {
    const issues = [];

    // kein horizontaler Seitenueberlauf
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      issues.push(`horizontales Ueberlaufen: scrollWidth=${document.documentElement.scrollWidth} > clientWidth=${document.documentElement.clientWidth}`);
    }

    // Hauptnavigation nicht ausserhalb des Viewports
    ['[data-testid="idle-tabs-bar"]', '[data-testid="idle-compact-nav"]'].forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return; // nicht die aktive Nav in diesem Modus
      if (r.left < -5 || r.top < -5 || r.right > window.innerWidth + 5) {
        issues.push(`${sel} liegt teilweise ausserhalb des Viewports: ${JSON.stringify(r)}`);
      }
    });

    // keine wichtigen Buttons mit 0x0 Pixel (nur die, die laut display sichtbar SEIN SOLLTEN)
    // WICHTIG: getComputedStyle(el).display prueft NUR das Element selbst,
    // nicht dessen Vorfahren - ein Button in einer versteckten
    // #idleDorfTabs (display:none, z.B. auf Mobil-Breiten mit aktiver
    // Kompakt-Navigation) behaelt seinen EIGENEN "display:inline-block"
    // o.ae., waere also faelschlich als "sollte sichtbar sein" durchgefallen
    // (beim eigenen Testen so gefunden - kein App-Bug, ein Bug in dieser
    // Pruefung). el.offsetParent === null erkennt zuverlaessig auch
    // Vorfahren-display:none (Standardtechnik, keine Ausnahme fuer die hier
    // betroffenen, nicht position:fixed Tab-Buttons).
    document.querySelectorAll('[data-testid^="idle-tab-"]').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      if (el.offsetParent === null) return; // Vorfahre versteckt - nicht dieser Buttons "Schuld"
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        issues.push(`Tab-Button ${el.id || el.className} hat display!=none aber 0x0 Groesse`);
      }
    });

    // keine fixierten Elemente, die die Hauptnavigation verdecken (Hit-Test auf Nav-Mittelpunkt)
    ['[data-testid="idle-tabs-bar"]', '[data-testid="idle-compact-nav"]'].forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      // #bkmpQaPanel ist ein bewusst IMMER obenauf schwebendes Dev-Werkzeug
      // (nie in Produktion sichtbar, siehe js/dev/bkmp-qa-panel.js) - auf
      // schmalen Mobil-Breiten kann es echte App-UI ueberlappen (beim
      // eigenen Testen bei 390px so gefunden), das ist fuer ein Debug-Panel
      // hinnehmbar (hat einen eigenen "Panel verstecken"-Button) und keine
      // App-UI-Ueberlagerung im eigentlich gemeinten Sinn dieser Pruefung.
      const topInQaPanel = top && top.closest && top.closest('#bkmpQaPanel');
      if (top && !topInQaPanel && !el.contains(top) && !top.contains(el) && top !== el) {
        issues.push(`${sel}: Mittelpunkt wird von einem anderen Element ueberlagert (${top.tagName}.${top.className})`);
      }
    });

    // keine unsichtbaren Overlays mit aktiven pointer-events, die grossflaechig Klicks abfangen
    document.querySelectorAll('.joke-overlay').forEach(el => {
      if (el.classList.contains('visible')) return; // absichtlich offen, nicht relevant
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.pointerEvents !== 'none' && r.width > window.innerWidth * 0.5 && r.height > window.innerHeight * 0.5) {
        issues.push(`Geschlossenes Overlay #${el.id} hat pointer-events:${cs.pointerEvents} bei grossflaechiger Ausdehnung - koennte Klicks blockieren`);
      }
    });

    return issues;
  });
  expect(result, `${context}: ${JSON.stringify(result, null, 2)}`).toEqual([]);
}

test.describe('Visuelle Grundpruefung (programmatisch) @visual-checks', () => {
  test.use({ teststand: 'C' });

  const viewports = [
    { name: 'Desktop 1366x768', width: 1366, height: 768 },
    { name: 'Mobile 390x844', width: 390, height: 844 },
    { name: 'Mobile-Querformat 844x390', width: 844, height: 390 }
  ];

  for (const vp of viewports) {
    test(`Kernbereiche ohne visuelle Grundfehler bei ${vp.name}`, async ({ page, qaServer }) => {
      test.setTimeout(30000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openIdleDorf(page, qaServer);
      await programmaticChecks(page, `${vp.name}: Kampf-Tab`);

      const otherTabs = ['idleTabBtnUpgrades', 'idleTabBtnRunen', 'idleTabBtnDungeon', 'idleTabBtnPrestige'];
      for (const btn of otherTabs) {
        await domClick(page, btn);
        await programmaticChecks(page, `${vp.name}: Tab ${btn}`);
      }
    });
  }
});

/* Absichtlich SEPARATES describe/Tag, NICHT Teil von qa:full - siehe
   Datei-Kommentar oben. Nur per gezieltem `npx playwright test
   tests/e2e/visual.spec.js -g baseline --update-snapshots` auszufuehren,
   danach die PNGs manuell pruefen. */
test.describe('Screenshot-Baselines fuer Kernbereiche (manuelle Bestaetigung noetig) @visual-baseline', () => {
  test.use({ teststand: 'C' });

  test('Desktop-Hauptnavigation', async ({ page, qaServer }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openIdleDorf(page, qaServer);
    await expect(page.locator('[data-testid="idle-tabs-bar"]')).toHaveScreenshot('desktop-nav.png');
  });

  test('Kampfbereich', async ({ page, qaServer }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openIdleDorf(page, qaServer);
    await expect(page.locator('.idle-battlefield')).toHaveScreenshot('kampfbereich.png');
  });

  test('Upgrade-Bereich', async ({ page, qaServer }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openIdleDorf(page, qaServer);
    await domClick(page, 'idleTabBtnUpgrades');
    await expect(page.locator('#idlePanelUpgrades')).toHaveScreenshot('upgrade-bereich.png');
  });

  test('Runen-Bereich', async ({ page, qaServer }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openIdleDorf(page, qaServer);
    await domClick(page, 'idleTabBtnRunen');
    await expect(page.locator('#idlePanelRunen')).toHaveScreenshot('runen-bereich.png');
  });

  test('Dungeon-Bereich', async ({ page, qaServer }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openIdleDorf(page, qaServer);
    await domClick(page, 'idleTabBtnDungeon');
    await expect(page.locator('#idlePanelDungeon')).toHaveScreenshot('dungeon-bereich.png');
  });

  test('Mobile-Hauptnavigation', async ({ page, qaServer }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openIdleDorf(page, qaServer);
    await expect(page.locator('[data-testid="idle-compact-nav"]')).toHaveScreenshot('mobile-nav.png');
  });

  test('QA-Kontrollfenster', async ({ page, qaServer }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(qaServer.url(`/?stand=${qaServer.teststand}`));
    await expect(page.locator('[data-testid="qa-panel"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="qa-panel"]')).toHaveScreenshot('qa-panel.png');
  });
});
