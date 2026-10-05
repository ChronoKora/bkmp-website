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

  /* Nutzerwunsch (05.10.2026, Spieler Kaledoss: "Wann duerfen wir wieder die
     Drachen nach Namen sortieren?"): kleiner Umschalt-Knopf "A-Z" neben den
     Rarity-Knoepfen. Aus = Seltenheit (Standard, unveraendert), an = alphabetisch
     nach Artname. Kein Dropdown zurueck. */
  const cardNames = page => page.locator('.idle-dragon-lager-card .idle-skin-name').allTextContents()
    .then(list => list.map(t => t.replace(/\s*\(.*$/, '').trim()));

  test('A–Z-Knopf: Standard bleibt Seltenheit, Klick sortiert alphabetisch, erneuter Klick zurück', async ({ page, qaBaseURL, fixtureData, store }) => {
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

    const sortBtn = page.locator('#idleDragonSortName');
    await expect(sortBtn).toBeVisible();
    await expect(sortBtn).toHaveAttribute('aria-pressed', 'false');
    // Standard unveraendert: Legendaer, Episch, Selten, Standard
    expect(await cardNames(page)).toEqual(['QA-Legendaer', 'QA-Episch', 'QA-Selten', 'QA-Standard']);

    await sortBtn.click();
    await expect(sortBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(sortBtn).toHaveClass(/active/);
    expect(await cardNames(page)).toEqual(['QA-Episch', 'QA-Legendaer', 'QA-Selten', 'QA-Standard']);

    await sortBtn.click();
    await expect(sortBtn).toHaveAttribute('aria-pressed', 'false');
    expect(await cardNames(page)).toEqual(['QA-Legendaer', 'QA-Episch', 'QA-Selten', 'QA-Standard']);
  });

  test('A–Z folgt deutschen Regeln (ä wie a, Groß/Klein egal) und gilt auch innerhalb eines Rarity-Filters', async ({ page, qaBaseURL, fixtureData, store }) => {
    const mk = (id, name, rarity, i) => ({
      id, name, rarity, egg_source: 'event', source_dragon_id: null, egg_drop_chance: 0,
      brood_seconds: 999999, sacrifice_gold: 0, sacrifice_crystals: 0, growth_points_required: 100, battle_xp_required: 100,
      is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1,
      egg_image: '', baby_image: '', teen_image: '', adult_image: '', sort_order: i, active: true
    });
    store.tables.dragon_species = [
      mk('qa-zeta', 'Zeta', 'episch', 1), mk('qa-aelpha', 'älpha', 'episch', 2),
      mk('qa-beta', 'beta', 'episch', 3), mk('qa-omega', 'Omega', 'legendaer', 4)
    ];
    const dragon = (id, species) => ({ ...adultDragon(fixtureData, id, 'episch'), species_id: species });
    store.tables.player_dragons = [dragon('d1', 'qa-zeta'), dragon('d2', 'qa-aelpha'), dragon('d3', 'qa-beta'), dragon('d4', 'qa-omega')];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await page.locator('#idleDragonSortName').click();
    // "älpha" vor "beta" (ein naiver Zeichenvergleich wuerde es hinter "Zeta" einsortieren)
    expect(await cardNames(page)).toEqual(['älpha', 'beta', 'Omega', 'Zeta']);
    // zusammen mit dem Rarity-Filter: nur Epische, weiterhin alphabetisch
    await page.locator('.idle-dragon-rarity-filter-btn[data-rarity="episch"]').click();
    expect(await cardNames(page)).toEqual(['älpha', 'beta', 'Zeta']);
  });

  test('A–Z: gleiche Art – weiter entwickelte Stufe zuerst, Reihenfolge bleibt beim Neuzeichnen stabil', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = speciesFixtures();
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'd-teen', 'episch', { stage: 'teen' }),
      adultDragon(fixtureData, 'd-adult-lvl0', 'episch'),
      adultDragon(fixtureData, 'd-adult-lvl2', 'episch', { ascension_level: 2 }),
      adultDragon(fixtureData, 'd-other', 'legendaer')
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await page.locator('#idleDragonSortName').click();
    const order = async () => page.locator('.idle-dragon-lager-card').evaluateAll(els => els.map(e => e.dataset.dragonId));
    const first = await order();
    expect(first).toEqual(['d-adult-lvl2', 'd-adult-lvl0', 'd-teen', 'd-other']);
    // Mehrfaches Neuzeichnen (jeder Kill loest eines aus) darf nichts verschieben.
    for (let i = 0; i < 4; i++) await page.evaluate(() => bkmpIdleRenderDragonsPanel());
    expect(await order()).toEqual(first);
  });

  test('A–Z-Wahl wird im Browser gemerkt (Vorliebe), der Rarity-Filter dagegen nicht', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = speciesFixtures();
    store.tables.player_dragons = [adultDragon(fixtureData, 'd-epi', 'episch'), adultDragon(fixtureData, 'd-leg', 'legendaer')];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await page.locator('#idleDragonSortName').click();
    await page.locator('.idle-dragon-rarity-filter-btn[data-rarity="episch"]').click();
    expect(await page.evaluate(() => localStorage.getItem('bkmp-dragon-lager-sort-name'))).toBe('1');
    // Echter Neustart der Seite: gespeicherte Vorliebe wird beim Laden gelesen.
    await page.evaluate(() => bkmpIdleStopLoop());
    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    expect(await page.evaluate(() => bkmpDragonLagerFilter)).toEqual({ rarity: 'all', favoritesOnly: false, sortByName: true });
    // Wieder ausschalten wird ebenfalls gespeichert.
    await page.locator('#idleTabBtnDrachen').click();
    await page.locator('#idleDragonSortName').click();
    expect(await page.evaluate(() => localStorage.getItem('bkmp-dragon-lager-sort-name'))).toBe('0');
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
