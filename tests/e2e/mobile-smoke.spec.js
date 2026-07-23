const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');

/* Auftrag Abschnitt 29 (Mobile-Smoke-Teil von Stufe 1): Grundfunktionen auf
   einer echten schmalen Mobil-Breite. Der kompakte Nav (System A/B, siehe
   CLAUDE.md Phase 7.0) aktiviert sich rein ueber die Fensterbreite
   (matchMedia(max-width:760px)) - NICHT ueber ?app=idledorf, deshalb bewusst
   openAndLogin() (normale Website) auf den mobile-*-Projekten (360x800 bzw.
   groesseres Geraet, siehe playwright.config.js), nicht openAppMode(). */
test.describe('Mobile-Smoke', () => {
  test.use({ teststand: 'B' });

  // Diese Suite pruefft gezielt den kompakten Nav, der sich NUR unter
  // matchMedia(max-width:760px) aktiviert (siehe Kommentar oben) - auf den
  // Desktop-Projekten (1366px breit) wuerde jeder Test hier korrekt, aber
  // sinnlos fehlschlagen (kompakter Nav bleibt dort zu Recht unsichtbar).
  // Gehoert nur zu mobile-small/mobile-large, siehe package.json's
  // "test:e2e:mobile" - ein versehentlicher Lauf ohne --project-Filter (z.B.
  // per npm run test:e2e) soll das nicht als 15 rote Fehlschlaege zeigen.
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!/^mobile-/.test(testInfo.project.name), 'Nur auf mobile-small/mobile-large relevant');
  });

  test('kompakte Navigation ersetzt die Desktop-Tableiste auf schmaler Breite', async ({ page, qaBaseURL, fixtureData }) => {
    const consoleErrors = [];
    page.on('pageerror', err => consoleErrors.push(String(err)));
    await openAndLogin(page, qaBaseURL, fixtureData);

    await expect(page.locator('#bkmpProtoCompactNav')).toBeVisible();
    await expect(page.locator('#idleDorfTabs')).toBeHidden();
    expect(consoleErrors, `Console errors on mobile open:\n${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('ein Haupt-Tab in der kompakten Nav schaltet das echte Panel um', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    const upgradesProxyBtn = page.locator('#bkmpProtoNavPrimary [data-proto-real-btn="idleTabBtnUpgrades"]');
    await expect(upgradesProxyBtn).toBeVisible();
    await upgradesProxyBtn.click();

    await expect(page.locator('#idleTabBtnUpgrades')).toHaveClass(/active/);
    await expect(page.locator('#idlePanelUpgrades')).toBeVisible();
    await expect(page.locator('#idlePanelKampf')).toBeHidden();
  });

  test('"Mehr" oeffnet ein Ueberlauf-Menue, aus dem sich ebenfalls ein echter Tab oeffnen laesst', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#bkmpProtoNavMoreBtn').click();

    // System B (das echte, gruppierte #idleAppMoreSheet) verschiebt die
    // ECHTEN Tab-Buttons per DOM-Reparenting in #idleAppMoreSheetGrid
    // (dieselbe id/Klasse "idle-dorf-tab" bleibt erhalten, siehe
    // bkmp-app-mode-bootstrap.js: "moreSheetGrid.querySelectorAll('.idle-dorf-tab')")
    // statt eigene Proxy-Buttons zu erzeugen - kein data-app-tab hier. System
    // A's eigener Dropdown-Fallback (#bkmpProtoNavMoreMenu) ist nur relevant,
    // falls System B nie initialisiert wurde (siehe CLAUDE.md Phase 7.0).
    const realSheetItem = page.locator('#idleAppMoreSheetGrid #idleTabBtnRunen');
    const fallbackMenuItem = page.locator('#bkmpProtoNavMoreMenu [data-proto-real-btn="idleTabBtnRunen"]');

    const useRealSheet = await realSheetItem.isVisible().catch(() => false);
    if (useRealSheet) {
      await realSheetItem.click();
    } else {
      await expect(fallbackMenuItem).toBeVisible({ timeout: 5000 });
      await fallbackMenuItem.click();
    }

    await expect(page.locator('#idleTabBtnRunen')).toHaveClass(/active/);
    await expect(page.locator('#idlePanelRunen')).toBeVisible();
  });

  test('Kampf-Log oeffnet und schliesst sich als Bottom-Sheet', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    // Kampf ist der Standard-Tab nach dem Login, das Kampf-Log-Sheet ist nur dort relevant.
    await expect(page.locator('#idlePanelKampf')).toBeVisible();

    const toggle = page.locator('#idleCombatLogToggleBtn');
    await expect(toggle).toBeVisible();
    await toggle.click();
    // Eigene Klasse "open" (nicht "visible" wie beim Kraftrune-Lager-Balken -
    // andere Komponente, andere Namenskonvention, per Fehlschlag entdeckt).
    await expect(page.locator('#idleCombatLogSheet')).toHaveClass(/open/, { timeout: 5000 });

    const closeBtn = page.locator('#idleCombatLogSheet .idle-combat-log-close, #idleCombatLogCloseBtn');
    await closeBtn.first().click();
    await expect(page.locator('#idleCombatLogSheet')).not.toHaveClass(/open/, { timeout: 5000 });
  });

  test('kein horizontales Ueberlaufen der Seite auf Mobilbreite', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    const overflowInfo = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(overflowInfo.scrollWidth).toBeLessThanOrEqual(overflowInfo.clientWidth + 2); // kleine Toleranz fuer Subpixel-Rundung
  });

  test('Reload auf Mobilbreite zeigt weiterhin die kompakte Navigation (kein Bug 13 aus CLAUDE.md)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });

    await expect(page.locator('#bkmpProtoCompactNav')).toBeVisible();
    // CLAUDE.md Bug 13: ein Fenster, das SCHMAL startet und dann verbreitert
    // wird, verlor die echten .idle-dorf-tab-group-Container unwiderruflich.
    // Hier bleibt die Breite aber konstant schmal - reiner Basis-Smoke-Test,
    // der eigentliche Breitenwechsel-Fall braucht einen eigenen Test (offen,
    // siehe Abschlussbericht).
  });
});
