const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Spieler-Wunsch ByAlex0 (Feedback-Board, 05.10.2026): "Ein Button bei den
   Drachen Eiern, mit dem man alle Eier der gleichen Art loeschen kann. Ich
   habe von manchen Eiern fast 100 Stueck und es dauert zu lange die alle
   einzeln zu loeschen."

   Neu: bkmpDragonReleaseAllEggsOfSpecies() + deletePlayerDragonEggs()
   (js/systems/bkmp-breeding.js / supabase.js). Sicherungen, die hier einzeln
   bewiesen werden:
     - Knopf nur bei mindestens 2 FREIEN Eiern der Art
     - Eier in einem Nest sind nie betroffen (nest.egg_id = "on delete set null")
     - Einzelstueck-Arten (unique_per_account) sind ausgenommen
     - episch/legendaer: zweite "Wirklich sicher?"-Abfrage
     - welche Eier geloescht werden, wird NACH der Bestaetigung neu bestimmt
     - 100 Eier gehen in Portionen an den Server (chunking) */

test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks auf #idleTabBtnDrachen - siehe CLAUDE.md-Muster (z.B. runes.spec.js)');
});

function species(id, name, rarity, extra) {
  return Object.assign({
    id, name, rarity,
    egg_source: 'dungeon', source_dragon_id: null, egg_drop_chance: 0,
    brood_seconds: 999999, sacrifice_gold: 0, sacrifice_crystals: 0,
    growth_points_required: 100, battle_xp_required: 100,
    is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1,
    egg_image: '', baby_image: '', teen_image: '', adult_image: '', sort_order: 1, active: true
  }, extra || {});
}
const STD = species('qa-bulk-std', 'QA-Standard', 'standard');
const OTHER = species('qa-bulk-other', 'QA-Andere', 'standard', { sort_order: 2 });
const EPIC = species('qa-bulk-epic', 'QA-Epischer', 'episch', { sort_order: 3 });
const UNIQUE = species('qa-bulk-unique', 'QA-Einzigartig', 'legendaer', { sort_order: 4, unique_per_account: true });

function eggs(fixtureData, speciesId, n, prefix) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId,
    species_id: speciesId, created_at: fixtureData.nowIso
  }));
}

async function openDragonTab(page, qaBaseURL, fixtureData) {
  await openAndLogin(page, qaBaseURL, fixtureData);
  await waitForDragonReady(page);
  await page.locator('#idleTabBtnDrachen').click();
}

test.describe('Alle Eier einer Art freilassen - Teststand A', () => {
  test.use({ teststand: 'A' });

  test('Knopf erscheint nur bei mindestens 2 freien Eiern der Art', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD, OTHER];
    store.tables.player_dragon_eggs = [...eggs(fixtureData, STD.id, 3, 'std'), ...eggs(fixtureData, OTHER.id, 1, 'oth')];
    await openDragonTab(page, qaBaseURL, fixtureData);

    const btns = page.locator('.idle-dragon-egg-release-all-btn');
    await expect(btns).toHaveCount(1);                         // nur die Art mit 3 Eiern
    await expect(btns.first()).toHaveAttribute('data-species-id', STD.id);
    await expect(btns.first()).toContainText('Alle 3');
    await expect(page.locator('.idle-dragon-egg-delete-btn')).toHaveCount(2); // der kleine Einzel-Muelleimer bleibt bei beiden Arten
  });

  test('Layout: der Sammel-Knopf sitzt direkt unter "In freies Nest legen", innerhalb der Karte, ohne Luecke', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD, OTHER];
    // Eine Nachbarkarte mit langem Text (unbekannte Art) macht die Zeile hoeher - die Sammel-Karte wird
    // gestreckt und HAT damit freien Platz, der verteilt werden muss (nur dann zeigt sich der Auto-Rand-Fehler).
    store.tables.player_dragon_eggs = [...eggs(fixtureData, STD.id, 3, 'std'), ...eggs(fixtureData, OTHER.id, 1, 'oth'), ...eggs(fixtureData, 'qa-bulk-unknown-long', 1, 'unk')];
    await openDragonTab(page, qaBaseURL, fixtureData);

    const geo = await page.evaluate((stdId) => {
      const bulk = document.querySelector('.idle-dragon-egg-release-all-btn[data-species-id="' + stdId + '"]');
      const card = bulk.closest('.idle-skin-card');
      const assign = card.querySelector('.idle-dragon-assign-btn');
      const b = bulk.getBoundingClientRect(), a = assign.getBoundingClientRect(), c = card.getBoundingClientRect();
      return {
        gapToAssign: Math.round(b.top - a.bottom),
        insideCard: b.left >= c.left - 1 && b.right <= c.right + 1 && b.bottom <= c.bottom + 1,
        sameWidth: Math.abs(b.width - a.width) < 2,
        height: Math.round(b.height),
        cardStretched: Math.round(c.height)
      };
    }, STD.id);
    expect(geo.insideCard).toBe(true);
    expect(geo.sameWidth).toBe(true);
    expect(geo.gapToAssign).toBeGreaterThanOrEqual(0);
    expect(geo.gapToAssign).toBeLessThan(9);       // direkt darunter - nicht durch zwei Auto-Raender auseinandergezogen
    expect(geo.height).toBeGreaterThan(30);        // gut tippbar
  });

  test('Abbrechen loescht nichts', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD];
    store.tables.player_dragon_eggs = eggs(fixtureData, STD.id, 4, 'std');
    await openDragonTab(page, qaBaseURL, fixtureData);

    await page.locator('.idle-dragon-egg-release-all-btn').click();
    await expect(page.locator('#bkmpConfirmTitle')).toHaveText(/Alle 4 Eier freilassen/);
    await expect(page.locator('#bkmpConfirmBody')).toContainText('4 × QA-Standard-Ei');
    await expect(page.locator('#bkmpConfirmBody')).toContainText('Nest');
    await page.locator('#bkmpConfirmCancelBtn').click();

    await page.waitForTimeout(200);
    expect(await page.evaluate(() => bkmpPlayerDragonEggs.length)).toBe(4);
    expect(store.tables.player_dragon_eggs.length).toBe(4);
  });

  test('Bestaetigen loescht alle freien Eier der Art - andere Arten bleiben, Client UND Server', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD, OTHER];
    store.tables.player_dragon_eggs = [...eggs(fixtureData, STD.id, 5, 'std'), ...eggs(fixtureData, OTHER.id, 2, 'oth')];
    await openDragonTab(page, qaBaseURL, fixtureData);

    await page.locator(`.idle-dragon-egg-release-all-btn[data-species-id="${STD.id}"]`).click();
    await page.locator('#bkmpConfirmOkBtn').click(); // Standard-Art: nur EINE Abfrage

    await expect.poll(() => page.evaluate(() => bkmpPlayerDragonEggs.length), { timeout: 5000 }).toBe(2);
    const clientIds = await page.evaluate(() => bkmpPlayerDragonEggs.map(e => e.id).sort());
    expect(clientIds).toEqual(['oth-1', 'oth-2']);
    expect(store.tables.player_dragon_eggs.map(e => e.id).sort()).toEqual(['oth-1', 'oth-2']);
    // Die Karte der geloeschten Art ist weg, die andere noch da
    await expect(page.locator('.idle-dragon-egg-delete-btn')).toHaveCount(1);
  });

  test('Eier in einem Nest werden nie geloescht - das Nest bleibt befuellt', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD];
    store.tables.player_dragon_eggs = eggs(fixtureData, STD.id, 4, 'std');
    store.tables.player_dragon_nests = [
      { id: 'qa-nest-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, slot_index: 1, egg_id: 'std-1', started_at: fixtureData.nowIso }
    ];
    await openDragonTab(page, qaBaseURL, fixtureData);

    await page.locator('.idle-dragon-egg-release-all-btn').click();
    await expect(page.locator('#bkmpConfirmTitle')).toHaveText(/Alle 3 Eier freilassen/); // 3 freie, nicht 4
    await page.locator('#bkmpConfirmOkBtn').click();

    await expect.poll(() => page.evaluate(() => bkmpPlayerDragonEggs.length), { timeout: 5000 }).toBe(1);
    expect(store.tables.player_dragon_eggs.map(e => e.id)).toEqual(['std-1']);
    expect(store.tables.player_dragon_nests[0].egg_id).toBe('std-1');
    expect(await page.evaluate(() => bkmpPlayerDragonNests[0].egg_id)).toBe('std-1');
  });

  test('Ei, das waehrend des offenen Dialogs in ein Nest gelegt wird, ueberlebt (Auswahl erst NACH der Bestaetigung)', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD];
    store.tables.player_dragon_eggs = eggs(fixtureData, STD.id, 3, 'std');
    store.tables.player_dragon_nests = [
      { id: 'qa-nest-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, slot_index: 1, egg_id: null, started_at: null }
    ];
    await openDragonTab(page, qaBaseURL, fixtureData);

    await page.locator('.idle-dragon-egg-release-all-btn').click();
    await expect(page.locator('#bkmpConfirmTitle')).toHaveText(/Alle 3 Eier freilassen/);
    // Waehrend der Dialog offen ist, wandert ein Ei ins Nest (z.B. Automatik)
    await page.evaluate(() => { bkmpPlayerDragonNests[0].egg_id = 'std-2'; });
    await page.locator('#bkmpConfirmOkBtn').click();

    await expect.poll(() => page.evaluate(() => bkmpPlayerDragonEggs.length), { timeout: 5000 }).toBe(1);
    expect(store.tables.player_dragon_eggs.map(e => e.id)).toEqual(['std-2']);
  });

  test('episch: zweite "Wirklich sicher?"-Abfrage - Abbrechen dort loescht nichts, Bestaetigen loescht', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [EPIC];
    store.tables.player_dragon_eggs = eggs(fixtureData, EPIC.id, 3, 'ep');
    await openDragonTab(page, qaBaseURL, fixtureData);

    await page.locator('.idle-dragon-egg-release-all-btn').click();
    await expect(page.locator('#bkmpConfirmTitle')).toHaveText(/Alle 3 Eier freilassen/);
    await page.locator('#bkmpConfirmOkBtn').click();
    await expect(page.locator('#bkmpConfirmTitle')).toHaveText(/Wirklich sicher/);
    await page.locator('#bkmpConfirmCancelBtn').click();
    await page.waitForTimeout(250);
    expect(store.tables.player_dragon_eggs.length).toBe(3);
    expect(await page.evaluate(() => bkmpPlayerDragonEggs.length)).toBe(3);

    await page.locator('.idle-dragon-egg-release-all-btn').click();
    await page.locator('#bkmpConfirmOkBtn').click();
    await expect(page.locator('#bkmpConfirmTitle')).toHaveText(/Wirklich sicher/);
    await page.locator('#bkmpConfirmOkBtn').click();
    await expect.poll(() => page.evaluate(() => bkmpPlayerDragonEggs.length), { timeout: 5000 }).toBe(0);
    expect(store.tables.player_dragon_eggs.length).toBe(0);
  });

  test('Einzelstueck-Art: kein Sammel-Knopf, auch ein direkter Aufruf loescht nichts', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [UNIQUE];
    store.tables.player_dragon_eggs = eggs(fixtureData, UNIQUE.id, 3, 'un');
    await openDragonTab(page, qaBaseURL, fixtureData);

    await expect(page.locator('.idle-dragon-egg-release-all-btn')).toHaveCount(0);
    // Voraussetzungen, damit "es passiert nichts" wirklich etwas beweist:
    expect(await page.evaluate(() => bkmpPlayerDragonEggs.length)).toBe(3);
    expect(await page.evaluate(() => bkmpDragonFreeEggsOfSpecies('qa-bulk-unique').length)).toBe(3);
    expect(await page.evaluate(() => !!bkmpDragonSpeciesById('qa-bulk-unique').unique_per_account)).toBe(true);
    await page.evaluate(() => { window.__confirmCalls = 0; window.bkmpConfirmDialog = async () => { window.__confirmCalls++; return true; }; });
    await page.evaluate(() => bkmpDragonReleaseAllEggsOfSpecies('qa-bulk-unique'));
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__confirmCalls)).toBe(0);   // nicht einmal gefragt
    expect(store.tables.player_dragon_eggs.length).toBe(3);
  });

  test('100 Eier einer Art gehen in Portionen an den Server und sind danach alle weg', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD, OTHER];
    store.tables.player_dragon_eggs = [...eggs(fixtureData, STD.id, 100, 'std'), ...eggs(fixtureData, OTHER.id, 2, 'oth')];
    await openDragonTab(page, qaBaseURL, fixtureData);

    const deleteRequests = [];
    page.on('request', req => { if (req.method() === 'DELETE' && /player_dragon_eggs/.test(req.url())) deleteRequests.push(req.url()); });

    await expect(page.locator(`.idle-dragon-egg-release-all-btn[data-species-id="${STD.id}"]`)).toContainText('Alle 100');
    await page.locator(`.idle-dragon-egg-release-all-btn[data-species-id="${STD.id}"]`).click();
    await page.locator('#bkmpConfirmOkBtn').click();

    await expect.poll(() => page.evaluate(() => bkmpPlayerDragonEggs.length), { timeout: 8000 }).toBe(2);
    expect(store.tables.player_dragon_eggs.map(e => e.id).sort()).toEqual(['oth-1', 'oth-2']);
    expect(deleteRequests.length).toBe(2); // 100 Eier = 80 + 20 - nicht 100 Einzelanfragen, aber auch keine einzige riesige URL
  });

  test('Der bisherige Einzel-Muelleimer funktioniert unveraendert (loescht genau EIN Ei)', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD];
    store.tables.player_dragon_eggs = eggs(fixtureData, STD.id, 3, 'std');
    await openDragonTab(page, qaBaseURL, fixtureData);

    await page.locator('.idle-dragon-egg-delete-btn').click();
    await expect(page.locator('#bkmpConfirmTitle')).toHaveText(/Ei freilassen\?/);
    await page.locator('#bkmpConfirmOkBtn').click();
    await expect.poll(() => page.evaluate(() => bkmpPlayerDragonEggs.length), { timeout: 5000 }).toBe(2);
    expect(store.tables.player_dragon_eggs.length).toBe(2);
  });
});
