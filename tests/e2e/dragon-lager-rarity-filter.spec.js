const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Nutzerwunsch (05.08.2026, Screenshot der 3 <select>-Dropdowns "Alle
   Seltenheiten"/"Alle Stufen"/"Sortieren: Seltenheit"): "So bitte diese
   Sortierung entfernen. Einfach nur Buttons mit 'Legendäre' 'Epische'
   'Seltene' Das reicht schön nebeneinander neben favoriten." - ersetzt
   die 3 Dropdowns im Drachenlager-Filter durch 3 einfache Umschalt-Knoepfe
   (Legendäre/Epische/Seltene), Klick auf den bereits aktiven Knopf setzt
   wieder auf "alle" zurueck. Stufen-Filter und Sortierauswahl sind
   ersatzlos entfernt - Sortierung ist seitdem fest auf Seltenheit (war
   ohnehin bereits der Standardwert). Siehe bkmp-breeding.js,
   bkmpDragonLagerFilter/bkmpIdleRenderDragonsPanel(). */

test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks auf #idleTabBtnDrachen - siehe CLAUDE.md-Muster (z.B. dragon-lifecycle-release.spec.js)');
});

const SPECIES_BY_RARITY = {
  standard: { id: 'qa-filter-std', name: 'QA-Standard', rarity: 'standard' },
  selten: { id: 'qa-filter-selten', name: 'QA-Selten', rarity: 'selten' },
  episch: { id: 'qa-filter-episch', name: 'QA-Episch', rarity: 'episch' },
  legendaer: { id: 'qa-filter-legendaer', name: 'QA-Legendaer', rarity: 'legendaer' }
};

function speciesFixtures() {
  return Object.values(SPECIES_BY_RARITY).map((s, i) => ({
    id: s.id, name: s.name, rarity: s.rarity,
    egg_source: 'event', source_dragon_id: null, egg_drop_chance: 0,
    brood_seconds: 999999, sacrifice_gold: 0, sacrifice_crystals: 0,
    growth_points_required: 100, battle_xp_required: 100,
    is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1,
    egg_image: '', baby_image: '', teen_image: '', adult_image: '', sort_order: i + 1, active: true
  }));
}

function adultDragon(fixtureData, id, rarity, extra) {
  return {
    id, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: SPECIES_BY_RARITY[rarity].id,
    stage: 'adult', is_favorite: false, is_companion: false, ascension_level: 0, substats: [],
    stat_attack: 10, stat_defense: 10, stat_hp: 10,
    hatched_at: fixtureData.nowIso, adult_at: fixtureData.nowIso, ...(extra || {})
  };
}

test.describe('Drachenlager: Rarity-Schnellfilter-Knöpfe statt Dropdowns - Teststand A', () => {
  test.use({ teststand: 'A' });

  test('genau 3 Knöpfe (Legendäre/Epische/Seltene), keine <select>-Dropdowns mehr', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = speciesFixtures();
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'd-std', 'standard'),
      adultDragon(fixtureData, 'd-sel', 'selten'),
      adultDragon(fixtureData, 'd-epi', 'episch'),
      adultDragon(fixtureData, 'd-leg', 'legendaer')
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();

    const bar = page.locator('.idle-dragon-filter-bar');
    await expect(bar.locator('select')).toHaveCount(0);
    const btnTexts = await bar.locator('.idle-dragon-rarity-filter-btn').allTextContents();
    expect(btnTexts).toEqual(['Legendäre', 'Epische', 'Seltene']);
    // Favoriten-Schalter bleibt in derselben Zeile direkt daneben.
    await expect(bar.locator('.idle-dragon-filter-fav')).toBeVisible();
    // Ohne aktiven Filter sind alle 4 Seltenheiten sichtbar (inkl. Standard, das keinen eigenen Knopf hat).
    await expect(page.locator('.idle-dragon-lager-card')).toHaveCount(4);
  });

  test('Klick auf einen Rarity-Knopf filtert, erneuter Klick auf denselben Knopf setzt zurück auf "alle"', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = speciesFixtures();
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'd-std', 'standard'),
      adultDragon(fixtureData, 'd-sel', 'selten'),
      adultDragon(fixtureData, 'd-epi', 'episch'),
      adultDragon(fixtureData, 'd-leg', 'legendaer')
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();

    const legBtn = page.locator('.idle-dragon-rarity-filter-btn[data-rarity="legendaer"]');
    await legBtn.click();
    await expect(legBtn).toHaveClass(/active/);
    await expect(page.locator('.idle-dragon-lager-card')).toHaveCount(1);
    await expect(page.locator('.idle-dragon-lager-card')).toContainText('QA-Legendaer');

    // Klick auf einen ANDEREN Knopf wechselt den Filter direkt (nur einer aktiv).
    const epiBtn = page.locator('.idle-dragon-rarity-filter-btn[data-rarity="episch"]');
    await epiBtn.click();
    await expect(legBtn).not.toHaveClass(/active/);
    await expect(epiBtn).toHaveClass(/active/);
    await expect(page.locator('.idle-dragon-lager-card')).toHaveCount(1);
    await expect(page.locator('.idle-dragon-lager-card')).toContainText('QA-Episch');

    // Erneuter Klick auf den bereits aktiven Knopf setzt zurueck auf "alle".
    await epiBtn.click();
    await expect(epiBtn).not.toHaveClass(/active/);
    await expect(page.locator('.idle-dragon-lager-card')).toHaveCount(4);
  });

  test('Favoriten-Filter funktioniert weiterhin unverändert neben den neuen Knöpfen', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = speciesFixtures();
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'd-leg', 'legendaer', { is_favorite: true }),
      adultDragon(fixtureData, 'd-leg2', 'legendaer', { is_favorite: false })
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();

    await page.locator('#idleDragonFilterFav').check();
    await expect(page.locator('.idle-dragon-lager-card')).toHaveCount(1);
    await page.locator('#idleDragonFilterFav').uncheck();
    await expect(page.locator('.idle-dragon-lager-card')).toHaveCount(2);
  });
});
