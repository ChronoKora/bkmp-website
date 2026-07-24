const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');

/* QA-Grundlage Phase 2 (24.07.2026) - siehe identischer Kommentar in
   buttons-inventory.spec.js: diese Datei klickt #idleTabBtnXxx per echtem
   Playwright-.click() (verlangt Sichtbarkeit), auf mobile-*-Projekten sind
   diese Knoten korrekt unsichtbar (kompakte Navigation) - 30s-Timeout, kein
   App-Bug. Die kompakte Navigation selbst wird bereits von
   mobile-smoke.spec.js/nav-persistence.spec.js/qa-mode-smoke.spec.js
   (nutzen echte DOM-.click()-Aufrufe statt Playwrights Sichtbarkeits-
   pruefung) auf mobile-small/mobile-large abgedeckt. */
test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - siehe Kommentar oben, mobile-smoke.spec.js/nav-persistence.spec.js decken die kompakte Navigation ab');
});
const { IDLE_TABS } = require('../helpers/selectors');

test.describe('Idle-Dorf Navigation @smoke', () => {
  test.use({ teststand: 'B' });

  test('login opens the idle-dorf overlay on the Kampf tab', async ({ page, qaBaseURL, fixtureData }) => {
    const consoleErrors = [];
    page.on('pageerror', err => consoleErrors.push(String(err)));
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await openAndLogin(page, qaBaseURL, fixtureData);

    await expect(page.locator('#idleTabBtnKampf')).toHaveClass(/active/);
    await expect(page.locator('#idlePanelKampf')).toBeVisible();

    expect(consoleErrors, `Console errors after login/open:\n${consoleErrors.join('\n')}`).toEqual([]);
  });

  for (const tab of IDLE_TABS) {
    test(`clicking tab "${tab.id}" shows its panel and marks the button active`, async ({ page, qaBaseURL, fixtureData }) => {
      const consoleErrors = [];
      page.on('pageerror', err => consoleErrors.push(String(err)));
      page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

      await openAndLogin(page, qaBaseURL, fixtureData);

      const btn = page.locator('#' + tab.btn);
      await expect(btn).toBeVisible();
      await btn.click();

      await expect(btn).toHaveClass(/active/);
      await expect(page.locator('#' + tab.panel)).toBeVisible();

      // Other panels must not remain visible at the same time.
      for (const other of IDLE_TABS) {
        if (other.id === tab.id) continue;
        await expect(page.locator('#' + other.panel)).toBeHidden();
      }

      expect(consoleErrors, `Console errors on tab "${tab.id}":\n${consoleErrors.join('\n')}`).toEqual([]);
    });
  }

  test('rapid tab switching ends on the last clicked tab with no stuck panels', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    const sequence = ['upgrades', 'runen', 'dungeon', 'prestige', 'kampf'];
    for (const id of sequence) {
      const tab = IDLE_TABS.find(t => t.id === id);
      await page.locator('#' + tab.btn).click();
    }
    const last = IDLE_TABS.find(t => t.id === sequence[sequence.length - 1]);
    await expect(page.locator('#' + last.btn)).toHaveClass(/active/);
    await expect(page.locator('#' + last.panel)).toBeVisible();
    const visiblePanels = await Promise.all(
      IDLE_TABS.filter(t => t.id !== last.id).map(t => page.locator('#' + t.panel).isVisible())
    );
    expect(visiblePanels.some(Boolean), 'No panel other than the last-clicked one should stay visible').toBe(false);
  });

  test('reload restores the session (not necessarily the active tab) with no stuck panels', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnRunen').click();
    await expect(page.locator('#idlePanelRunen')).toBeVisible();

    await page.reload();
    // Session should already be restored (real login persisted via the mocked
    // Auth backend) - no second login prompt. The idle-dorf overlay itself is
    // NOT auto-reopened on the plain website after a reload (that's only
    // app-mode's one-shot boot() behavior, see openAppMode's comment) - the
    // user re-opens it via #idleDorfButton, same as any first visit.
    // (#mcNameOverlay shows/hides via opacity, not display - assert the
    // "visible" class, not Playwright's built-in hidden/visible state.)
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });

    // Whichever tab ends up active (bkmpIdleActiveTab is in-memory only, not
    // persisted - most likely resets to "kampf"), exactly one panel must be
    // visible and none left stuck open from before the reload. Polled (not a
    // one-shot check) since the tab render after reopening is asynchronous.
    await expect(async () => {
      const visibleFlags = await Promise.all(IDLE_TABS.map(t => page.locator('#' + t.panel).isVisible()));
      expect(visibleFlags.filter(Boolean).length).toBe(1);
    }).toPass({ timeout: 5000 });
  });
});
