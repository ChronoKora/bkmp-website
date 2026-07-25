const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Dringender Bugfix-Auftrag 25.07.2026 (Nutzerbericht: beim Erfolg
   "Gildenboss-Bezwinger" ist nicht erkennbar, welchen Vorteil der Spieler
   erhaelt).

   BEFUND: die Erfolgs-Definition ('guild_boss_10', js/systems/bkmp-guild.js
   BKMP_GUILD_ACHIEVEMENTS_EXTRA) traegt selbst kein Belohnungsfeld - ABER es
   existiert ein gleichnamiger idle-Dorf-TITEL ('idletitle_guild_boss10',
   idledorf.js, window.BKMP_IDLE_TITLES) mit einem echten Dauerbonus
   (effectType:'boss_dmg_pct', effectValue:4 = +4% Bossschaden), der bisher
   NUR im separaten Titel-Tab sichtbar war, nicht auf der Erfolgs-Karte
   selbst. Fix: js/core/bkmp-site.js's renderAchievementsPanel() zeigt jetzt
   ueber bkmpAchievementLinkedTitleBonus() (Namens-Abgleich gegen
   window.BKMP_IDLE_TITLES - die einzige im Code bereits vorhandene, nicht
   erfundene Verknuepfung) den echten Bonus direkt auf der Erfolgs-Karte
   an (".achievement-bonus"). Betrifft nicht nur diesen einen Erfolg -
   guild_member/guild_leader/guild_level_10 haben dasselbe Muster, werden
   also automatisch mitgefixt. Erfolge OHNE gleichnamigen Bonus-Titel zeigen
   weiterhin korrekt KEINEN Vorteilstext (echt kosmetisch/Sammlung, kein
   Fehler). */

async function openAchievementsPanel(page) {
  const closeBtn = page.locator('#idleDorfCloseX');
  if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();
  await page.locator('#mcNameBadge').click();
  await expect(page.locator('#achievementsOverlay')).toHaveClass(/visible/, { timeout: 10000 });
  await page.evaluate(() => renderAchievementsPanel());
}

async function openGuildCategory(page) {
  const guildHead = page.locator('.achievement-category-head[data-category="Gilde"]');
  await expect(guildHead).toBeVisible();
  const alreadyOpen = await page.evaluate(() => !!bkmpAchievementCategoryOpen['Gilde']);
  if (!alreadyOpen) await guildHead.click();
}

test.describe('Bug 3 - Erfolg "Gildenboss-Bezwinger" zeigt den echten Titel-Bonus (Teststand A)', () => {
  test.use({ teststand: 'A' });

  test('nicht abgeschlossen: Vorteilstext ist trotzdem sichtbar (gedaempft, mit Schloss-Hinweis "nach Freischaltung aktiv")', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openAchievementsPanel(page);
    await openGuildCategory(page);
    const row = page.locator('.achievement-row', { has: page.locator('.achievement-title', { hasText: 'Gildenboss-Bezwinger' }) });
    await expect(row).toHaveClass(/locked/);
    const bonus = row.locator('.achievement-bonus');
    await expect(bonus).toBeVisible();
    const text = (await bonus.innerText()).trim();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('Bossschaden');
    expect(text).toContain('4%');
    expect(text).toContain('nach Freischaltung aktiv');
  });

  test('abgeschlossen (10 Gildenbosse besiegt): Vorteilstext bleibt sichtbar, ohne Schloss-Hinweis', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // bkmpGuildGetAchievementContextFields() liest ueber bkmpAchievementReadCache() aus genau
    // diesem localStorage-Schluessel (js/systems/bkmp-guild.js:70/72) - direkter, realistischer
    // Weg, den Erfolg als freigeschaltet zu simulieren, ohne 10 echte Gildenboss-Kaempfe zu spielen.
    await page.evaluate(() => {
      localStorage.setItem('bkmp-guild-achievement-fields-cache', JSON.stringify({
        inGuild: true, guildRole: 'member', guildLevel: 5, guildXp: 0, guildBossesDefeated: 10, guildMemberCount: 3
      }));
    });
    await openAchievementsPanel(page);
    await openGuildCategory(page);
    const row = page.locator('.achievement-row', { has: page.locator('.achievement-title', { hasText: 'Gildenboss-Bezwinger' }) });
    await expect(row).toHaveClass(/unlocked/);
    const bonus = row.locator('.achievement-bonus');
    await expect(bonus).toBeVisible();
    const text = (await bonus.innerText()).trim();
    expect(text).toContain('Bossschaden');
    expect(text).toContain('4%');
    expect(text).not.toContain('nach Freischaltung aktiv');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  test('rein kosmetische Erfolge (kein gleichnamiger Bonus-Titel) zeigen weiterhin korrekt KEINEN Vorteilstext', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openAchievementsPanel(page);
    await openGuildCategory(page);
    // 'guild_full_roster' ("Volles Haus") hat KEINEN gleichnamigen Titel in window.BKMP_IDLE_TITLES -
    // korrekt weiterhin ohne .achievement-bonus, kein erfundener Vorteilstext.
    const row = page.locator('.achievement-row', { has: page.locator('.achievement-title', { hasText: 'Volles Haus' }) });
    await expect(row).toBeVisible();
    await expect(row.locator('.achievement-bonus')).toHaveCount(0);
  });
});

test.describe('Bug 3 - Darstellung auf allen Viewports (kein abgeschnittener/leerer Text)', () => {
  test.use({ teststand: 'A' });

  test('Vorteilstext ist auf der aktuellen Projekt-Viewportgroesse vollstaendig lesbar, keine 0-Breite/-Hoehe', async ({ page, qaBaseURL, fixtureData }, testInfo) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      localStorage.setItem('bkmp-guild-achievement-fields-cache', JSON.stringify({
        inGuild: true, guildRole: 'member', guildLevel: 5, guildXp: 0, guildBossesDefeated: 10, guildMemberCount: 3
      }));
    });
    await openAchievementsPanel(page);
    await openGuildCategory(page);
    const bonus = page.locator('.achievement-row', { has: page.locator('.achievement-title', { hasText: 'Gildenboss-Bezwinger' }) }).locator('.achievement-bonus');
    await expect(bonus).toBeVisible();
    const box = await bonus.boundingBox();
    expect(box).toBeTruthy();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    const text = (await bonus.innerText()).trim();
    expect(text.length).toBeGreaterThan(5);
    // Kein horizontales Ueberlaufen der Karte durch den zusaetzlichen Text.
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflowX).toBe(false);
    testInfo.annotations.push({ type: 'project', description: testInfo.project.name });
  });
});
