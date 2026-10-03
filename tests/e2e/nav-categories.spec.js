const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');

/* Drachendorf-Ausbau Phase 1 (04.10.2026): Navigation in 4 Kategorien
   (⚔️ Abenteuer / 🏡 Entwicklung / 🐉 Drachen & Sammlung / 🛡️ Gemeinschaft).
   Desktop: Seitenleiste mit einklappbaren Kopfzeilen. Handy: "Mehr"-Sheet
   nach denselben 4 Kategorien gruppiert. Letzter Bereich wird gemerkt. */

const CATEGORIES = {
  abenteuer: ['idleTabBtnKampf', 'idleTabBtnDungeon', 'idleTabBtnTurm', 'idleTabBtnArena'],
  entwicklung: ['idleTabBtnUpgrades', 'idleTabBtnDorf', 'idleTabBtnSkilltree', 'idleTabBtnPrestige', 'idleTabBtnRunen'],
  drachen: ['idleTabBtnDrachen', 'idleTabBtnSkins', 'idleTabBtnErfolge', 'idleTabBtnBestenliste'],
  gemeinschaft: ['idleTabBtnGilde', 'idleTabBtnGildeTech', 'idleTabBtnGildeBoss', 'idleTabBtnClan']
};

async function reopenAfterReload(page) {
  await page.reload();
  await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
  await page.locator('#idleDorfButton').click();
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
}

test.describe('Navigation in 4 Kategorien – Desktop', () => {
  test.use({ teststand: 'B' });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Seitenleiste mit Kopfzeilen gibt es nur auf Desktop-Breite');
  });

  test('vier Kopfzeilen in fester Reihenfolge, jeder Bereich genau einmal unter seiner Kategorie', async ({ page, qaBaseURL, fixtureData }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await openAndLogin(page, qaBaseURL, fixtureData);

    const order = await page.evaluate(() => Array.from(document.querySelectorAll('#idleDorfTabs > *'))
      .filter(el => el.classList.contains('idle-dorf-cat-header') || (el.classList.contains('idle-dorf-tab') && el.id !== 'idleAppMoreBtn'))
      .map(el => el.classList.contains('idle-dorf-cat-header') ? 'H:' + el.dataset.navCatHeader : el.id));

    const expected = [];
    Object.keys(CATEGORIES).forEach(key => { expected.push('H:' + key); expected.push(...CATEGORIES[key]); });
    expect(order).toEqual(expected);

    for (const key of Object.keys(CATEGORIES)) {
      await expect(page.locator(`[data-nav-cat-header="${key}"]`)).toBeVisible();
    }
    // Weltboss ist KEIN fester Hauptbereich.
    expect(order.some(id => /Raid|Weltboss/i.test(id))).toBe(false);
    expect(errors).toEqual([]);
  });

  test('Kategorie einklappen/aufklappen, Zustand bleibt nach Reload erhalten', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    const header = page.locator('[data-nav-cat-header="gemeinschaft"]');
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    for (const id of CATEGORIES.gemeinschaft) await expect(page.locator('#' + id)).toBeHidden();
    // Andere Kategorien bleiben offen.
    await expect(page.locator('#idleTabBtnRunen')).toBeVisible();

    await reopenAfterReload(page);
    await expect(page.locator('[data-nav-cat-header="gemeinschaft"]')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#idleTabBtnGilde')).toBeHidden();

    await page.locator('[data-nav-cat-header="gemeinschaft"]').click();
    for (const id of CATEGORIES.gemeinschaft) await expect(page.locator('#' + id)).toBeVisible();
  });

  test('die Kategorie des aktiven Bereichs wird nie eingeklappt', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    // Kampf ist aktiv -> Abenteuer darf sich nicht zuklappen lassen (bleibt sichtbar).
    await page.locator('[data-nav-cat-header="abenteuer"]').click();
    await expect(page.locator('#idleTabBtnKampf')).toBeVisible();
    await expect(page.locator('[data-nav-cat-header="abenteuer"]')).toHaveAttribute('aria-expanded', 'true');
    // Wechsel in einen anderen Bereich -> jetzt greift das gemerkte Einklappen.
    await page.locator('#idleTabBtnUpgrades').click();
    await expect(page.locator('#idleTabBtnDungeon')).toBeHidden();
    await expect(page.locator('[data-nav-cat-header="abenteuer"]')).toHaveClass(/is-collapsed/);
  });

  test('letzter Bereich wird nach Reload wieder aufgeschlagen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnRunen').click();
    await expect(page.locator('#idlePanelRunen')).toBeVisible();

    await reopenAfterReload(page);
    await expect(page.locator('#idleTabBtnRunen')).toHaveClass(/active/, { timeout: 10000 });
    await expect(page.locator('#idlePanelRunen')).toBeVisible();
    await expect(page.locator('[data-nav-cat-header="entwicklung"]')).toHaveClass(/has-active/);
  });

  test('neuer Bereich Dorfentwicklung ist unter Entwicklung erreichbar', async ({ page, qaBaseURL, fixtureData }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnDorf').click();
    await expect(page.locator('#idlePanelDorf')).toBeVisible();
    await expect(page.locator('#idlePanelDorf')).toContainText('Dorfentwicklung');
    expect(errors).toEqual([]);
  });
});

test.describe('Navigation in 4 Kategorien – Handy', () => {
  test.use({ teststand: 'B' });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!/^mobile-/.test(testInfo.project.name), 'Nur auf mobile-small/mobile-large relevant');
  });

  test('"Mehr"-Sheet ist nach den 4 Kategorien gruppiert und enthält Dorfentwicklung', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    const titles = await page.locator('#idleAppMoreSheetGrid .idle-app-more-sheet-group-title').allTextContents();
    expect(titles.map(t => t.trim())).toEqual(['⚔️ Abenteuer', '🏡 Entwicklung', '🐉 Drachen & Sammlung', '🛡️ Gemeinschaft']);
    expect(await page.locator('#idleAppMoreSheetGrid #idleTabBtnDorf').count()).toBe(1);
    // Kopfzeilen der Desktop-Seitenleiste bleiben auf dem Handy unsichtbar.
    await expect(page.locator('[data-nav-cat-header="abenteuer"]')).toBeHidden();

    await page.locator('#bkmpProtoNavMoreBtn').click();
    const sheetItem = page.locator('#idleAppMoreSheetGrid #idleTabBtnDorf');
    if (await sheetItem.isVisible().catch(() => false)) {
      await sheetItem.click();
    } else {
      await page.evaluate(() => document.getElementById('idleTabBtnDorf').click());
    }
    await expect(page.locator('#idlePanelDorf')).toBeVisible();
  });
});
