const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');

/* Drachendorf-Ausbau Phase 5 (04.10.2026): Pfad des Drachendorfs in der Chronik. */

async function openPath(page) {
  await page.evaluate(() => bkmpChronicleOpenModal('path'));
  await expect(page.locator('#bkmpChronicleOverlay')).toHaveClass(/visible/);
  await expect(page.locator('[data-testid="path-tab"]')).toBeVisible({ timeout: 10000 });
}

test.describe('Dorfpfad – Struktur', () => {
  test.use({ teststand: 'A' });
  test('6 Kapitel, eindeutige Ziele, jedes Ziel hat ein Ziel-Bereich oder Chronik-Reiter', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    const info = await page.evaluate(() => ({
      chapters: BKMP_PATH_CHAPTERS.length,
      ids: BKMP_PATH_GOALS.map(g => g.id),
      perChapter: BKMP_PATH_CHAPTERS.map(c => BKMP_PATH_GOALS.filter(g => g.ch === c.id).length),
      badNav: BKMP_PATH_GOALS.filter(g => !(g.chronTab || (g.goTab && BKMP_CHRONICLE_TAB_BUTTONS[g.goTab]))).map(g => g.id),
      badMetric: BKMP_PATH_GOALS.filter(g => typeof BKMP_PATH_METRICS[g.metric] !== 'function').map(g => g.id)
    }));
    expect(info.chapters).toBe(6);
    expect(new Set(info.ids).size).toBe(info.ids.length);
    info.perChapter.forEach(n => expect(n).toBeGreaterThanOrEqual(5));
    expect(info.badNav).toEqual([]);
    expect(info.badMetric).toEqual([]);
  });

  test('neuer Spieler: nichts erfüllt, nächste Ziele mit „Los →“ führen in den Bereich', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpChronicleOpenModal('quests'));
    const next = page.locator('[data-testid="path-next"]');
    await expect(next).toBeVisible({ timeout: 10000 });
    await expect(next.locator('.bkmp-path-goal')).toHaveCount(3);
    await expect(next).not.toContainText('abholen');
    await next.locator('[data-path-goal="p1_upgrades"] [data-chron-action="goto"]').click();
    await expect(page.locator('#bkmpChronicleOverlay')).not.toHaveClass(/visible/);
    await expect(page.locator('#idlePanelUpgrades')).toBeVisible();
  });
});

test.describe('Dorfpfad – rückwirkend (Teststand C)', () => {
  test.use({ teststand: 'C' });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Chronik-Fenster wird auf Desktop geprüft');
  });

  test('bereits erfüllte Ziele sind sofort abholbar – „Alle abholen“ schreibt genau einmal gut', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpIdleStopLoop());
    await openPath(page);
    const claimable = await page.evaluate(() => bkmpPathClaimable().map(g => g.goal.id));
    // Teststand C: Stufe 850, viele Upgrades/Gebaeude, Runen ausgeruestet.
    expect(claimable).toEqual(expect.arrayContaining(['p1_upgrades', 'p1_buildings', 'p1_stage100', 'p3_stage500', 'p3_runes_equip']));
    expect(claimable).not.toContain('p6_stage5000');
    const goldBefore = await page.evaluate(() => bkmpIdleState.gold);
    const expected = await page.evaluate(ids => ids.reduce((s, id) => s + bkmpPathReward(BKMP_PATH_GOALS.find(g => g.id === id)).gold, 0), claimable);
    // Doppelt ausgeloest (Doppelklick) -> nur einmal.
    await page.evaluate(ids => Promise.all([bkmpPathClaim(ids), bkmpPathClaim(ids)]), claimable);
    const goldAfter = await page.evaluate(() => bkmpIdleState.gold);
    expect(goldAfter - goldBefore).toBe(expected);
    expect(await page.evaluate(() => bkmpPathClaimable().length)).toBe(0);
    await expect(page.locator('[data-testid="path-claimall"]')).toHaveCount(0);
    await expect(page.locator('[data-path-goal="p1_upgrades"]')).toHaveClass(/is-claimed/);
    // Noch einmal versuchen: keine zweite Gutschrift.
    await page.evaluate(ids => bkmpPathClaim(ids), claimable);
    expect(await page.evaluate(() => bkmpIdleState.gold)).toBe(goldAfter);
  });

  test('abgeholte Ziele bleiben nach Reload abgeholt, Abholen über die Schaltfläche funktioniert', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpIdleStopLoop());
    await openPath(page);
    await page.locator('[data-testid="path-claimall"]').click();
    await expect(page.locator('[data-testid="path-claimall"]')).toHaveCount(0, { timeout: 10000 });
    await page.evaluate(() => bkmpChronicleSaveNow());
    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await openPath(page);
    expect(await page.evaluate(() => bkmpPathClaimable().length)).toBe(0);
    await expect(page.locator('[data-path-goal="p1_stage100"]')).toHaveClass(/is-claimed/);
  });
});
