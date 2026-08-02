const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Zwei getrennte Spieler-Wuensche, 02.08.2026:

   1) "eine Option mit einbauen das man 'Eier oder baby' loeschen /
      Freilassen kann. Aber bitte nur kleiner suesser Muelleimer symbol
      vllt oben rechts im Kasten?" - neuer kleiner Papierkorb-Knopf oben
      rechts auf Ei-Karten (Eierlager) und Baby-Karten (Fuetterung),
      siehe bkmpDragonReleaseEgg()/bkmpDragonConfirmAndRelease() in
      js/systems/bkmp-breeding.js. Eier: loescht IMMER nur EIN Ei der
      angeklickten Art (dieselbe representative eggId wie der bestehende
      "In freies Nest legen"-Knopf) - kein Massenloeschen eines ganzen
      Stapels. Babys: nutzt dieselbe Bestaetigen-Logik wie der bereits
      bestehende Freilassen-Knopf fuer jugendliche/erwachsene Drachen
      (jetzt in bkmpDragonConfirmAndRelease() ausgelagert, damit beide
      Aufrufstellen exakt dieselbe Sicherheitsabfrage nutzen).

   2) "Die Funktion fuer alle Drachen freischalten nicht nur legendaere..
      'Aufsteigen' 5 der gleichen drachen verbinden." - bkmpDragonCanAscend()
      hatte bisher zusaetzlich zu Stufe/Entwicklungsstand einen
      "species.rarity === 'legendaer'"-Filter, der jetzt entfernt wurde -
      dieselbe Mechanik (eine zweite erwachsene Kopie derselben Art wird
      verbraucht, bis zu 5 Stufen) gilt jetzt fuer JEDE Seltenheit. */

test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks auf #idleTabBtnDrachen - siehe CLAUDE.md-Muster (z.B. runes.spec.js)');
});

const STD_SPECIES = {
  id: 'qa-std-species', name: 'QA-Standarddrache', rarity: 'standard',
  egg_source: 'dungeon', source_dragon_id: null, egg_drop_chance: 0,
  brood_seconds: 999999, sacrifice_gold: 0, sacrifice_crystals: 0,
  growth_points_required: 100, battle_xp_required: 100,
  is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1,
  egg_image: '', baby_image: '', teen_image: '', adult_image: '', sort_order: 1, active: true
};
const LEGEND_SPECIES = {
  id: 'qa-legend-species', name: 'QA-Legendarius', rarity: 'legendaer',
  egg_source: 'dungeon', source_dragon_id: null, egg_drop_chance: 0,
  brood_seconds: 999999, sacrifice_gold: 0, sacrifice_crystals: 0,
  growth_points_required: 100, battle_xp_required: 100,
  is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1,
  egg_image: '', baby_image: '', teen_image: '', adult_image: '', sort_order: 2, active: true
};

test.describe('Ei/Baby freilassen ueber den neuen Mini-Muelleimer-Knopf - Teststand A', () => {
  test.use({ teststand: 'A' });

  test('Ei-Karte: kleiner Muelleimer-Knopf oben rechts, Abbrechen loescht nichts', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD_SPECIES];
    store.tables.player_dragon_eggs = [
      { id: 'qa-egg-a', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: STD_SPECIES.id, created_at: fixtureData.nowIso },
      { id: 'qa-egg-b', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: STD_SPECIES.id, created_at: fixtureData.nowIso }
    ];

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();

    const eggDeleteBtn = page.locator('.idle-dragon-egg-delete-btn');
    await expect(eggDeleteBtn).toHaveCount(1); // beide Eier sind derselben Art - EIN gruppierter Knopf
    const geometry = await eggDeleteBtn.evaluate(btn => {
      const card = btn.closest('.idle-skin-card');
      const b = btn.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const cs = getComputedStyle(btn);
      return { topOffset: Math.round(b.top - c.top), rightOffset: Math.round(c.right - b.right), radius: cs.borderRadius };
    });
    expect(geometry.topOffset).toBeLessThan(20); // klar oben, keine Zeile weiter unten
    expect(geometry.rightOffset).toBeLessThan(20); // klar rechts
    expect(geometry.radius).toBe('50%'); // rund, nicht das generische 14px-Rechteck-Reset

    await eggDeleteBtn.click();
    await expect(page.locator('text=Ei freilassen?')).toBeVisible();
    await expect(page.locator('text=noch 1 weiteres Ei dieser Art')).toBeVisible();
    await page.locator('#bkmpConfirmCancelBtn').click();

    await page.waitForTimeout(200);
    const eggsAfterCancel = await page.evaluate(() => bkmpPlayerDragonEggs.length);
    expect(eggsAfterCancel).toBe(2); // Abbrechen aendert nichts
  });

  test('Ei-Karte: Bestaetigen loescht genau EIN Ei der Art, Rest bleibt (auch server-seitig)', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD_SPECIES];
    store.tables.player_dragon_eggs = [
      { id: 'qa-egg-c', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: STD_SPECIES.id, created_at: fixtureData.nowIso },
      { id: 'qa-egg-d', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: STD_SPECIES.id, created_at: fixtureData.nowIso }
    ];

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await page.evaluate(() => { window.bkmpConfirmDialog = async () => true; });

    await page.locator('.idle-dragon-egg-delete-btn').click();
    await expect.poll(() => page.evaluate(() => bkmpPlayerDragonEggs.length), { timeout: 5000 }).toBe(1);

    const after = await page.evaluate(() => ({
      clientRemainingIds: bkmpPlayerDragonEggs.map(e => e.id)
    }));
    expect(after.clientRemainingIds).toEqual(['qa-egg-d']); // die repraesentative eggId ('qa-egg-c') wurde geloescht, nicht die andere

    const serverEggs = (store.tables.player_dragon_eggs || []).map(e => e.id);
    expect(serverEggs).toEqual(['qa-egg-d']); // Server-Wahrheit stimmt mit dem Client ueberein
  });

  test('Ei-Karte (unbekannte Spezies-Fallback): Muelleimer-Knopf funktioniert trotzdem', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [];
    store.tables.player_dragon_eggs = [
      { id: 'qa-egg-unknown', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: 'nicht-geladene-art', created_at: fixtureData.nowIso }
    ];

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await page.evaluate(() => { window.bkmpConfirmDialog = async () => true; });

    await expect(page.locator('.idle-dragon-egg-delete-btn')).toHaveCount(1);
    await page.locator('.idle-dragon-egg-delete-btn').click();
    await expect.poll(() => page.evaluate(() => bkmpPlayerDragonEggs.length), { timeout: 5000 }).toBe(0);
  });

  test('Baby-Karte: kleiner Muelleimer-Knopf freilaesst das Baby ueber dieselbe Bestaetigen-Logik wie erwachsene Drachen', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD_SPECIES];
    store.tables.player_dragons = [
      { id: 'qa-baby-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: STD_SPECIES.id, stage: 'baby', growth_points: 5, food_preference: 'fruit', is_favorite: false, is_companion: false, substats: [], hatched_at: fixtureData.nowIso, adult_at: null }
    ];

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();

    const babyDeleteBtn = page.locator('.idle-dragon-baby-delete-btn');
    await expect(babyDeleteBtn).toHaveCount(1);
    const radius = await babyDeleteBtn.evaluate(btn => getComputedStyle(btn).borderRadius);
    expect(radius).toBe('50%');

    await babyDeleteBtn.click();
    await expect(page.locator('#bkmpConfirmTitle')).toHaveText(/Drachen freilassen/);
    await expect(page.locator('#bkmpConfirmBody')).toContainText(STD_SPECIES.name);
    await page.locator('#bkmpConfirmOkBtn').click();

    await expect.poll(() => page.evaluate(() => bkmpPlayerDragons.length), { timeout: 5000 }).toBe(0);
    const serverDragons = (store.tables.player_dragons || []).filter(d => d.id === 'qa-baby-1');
    expect(serverDragons.length).toBe(0); // wirklich geloescht, nicht nur lokal ausgeblendet
  });
});

test.describe('Drachen-Aufstieg fuer alle Seltenheiten (nicht mehr nur legendaer) - Teststand A', () => {
  test.use({ teststand: 'A' });

  test('REGRESSION+ERWEITERUNG: eine STANDARD-Art kann jetzt genauso aufsteigen wie vorher nur Legendaere', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD_SPECIES, LEGEND_SPECIES];
    store.tables.player_dragons = [
      { id: 'qa-std-main', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: STD_SPECIES.id, stage: 'adult', is_favorite: false, is_companion: false, stat_attack: 10, stat_defense: 5, stat_hp: 100, substats: [], ascension_level: 0, hatched_at: fixtureData.nowIso, adult_at: fixtureData.nowIso },
      { id: 'qa-std-fodder', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: STD_SPECIES.id, stage: 'adult', is_favorite: false, is_companion: false, stat_attack: 10, stat_defense: 5, stat_hp: 100, substats: [], ascension_level: 0, hatched_at: fixtureData.nowIso, adult_at: fixtureData.nowIso },
      { id: 'qa-legend-main', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: LEGEND_SPECIES.id, stage: 'adult', is_favorite: false, is_companion: false, stat_attack: 40, stat_defense: 30, stat_hp: 500, substats: [], ascension_level: 0, hatched_at: fixtureData.nowIso, adult_at: fixtureData.nowIso },
      { id: 'qa-legend-fodder', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: LEGEND_SPECIES.id, stage: 'adult', is_favorite: false, is_companion: false, stat_attack: 40, stat_defense: 30, stat_hp: 500, substats: [], ascension_level: 0, hatched_at: fixtureData.nowIso, adult_at: fixtureData.nowIso }
    ];

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await page.evaluate(() => { bkmpIdleState.gold = 999999999; });

    // Vorher: nur der legendaere Ascend-Knopf existierte - jetzt beide.
    await expect(page.locator('.idle-dragon-ascend-btn[data-dragon-id="qa-std-main"]')).toBeVisible();
    await expect(page.locator('.idle-dragon-ascend-btn[data-dragon-id="qa-legend-main"]')).toBeVisible();
    await expect(page.locator('.idle-dragon-ascend-btn[data-dragon-id="qa-std-main"]')).toHaveText('🌟 Aufsteigen (0/5)');

    const goldBefore = await page.evaluate(() => bkmpIdleState.gold);
    await page.locator('.idle-dragon-ascend-btn[data-dragon-id="qa-std-main"]').click();

    await expect.poll(() => page.evaluate(() => {
      const d = bkmpPlayerDragons.find(x => x.id === 'qa-std-main');
      return d ? d.ascension_level : null;
    }), { timeout: 5000 }).toBe(1);

    const after = await page.evaluate(() => ({
      gold: bkmpIdleState.gold,
      fodderStillThere: bkmpPlayerDragons.some(d => d.id === 'qa-std-fodder'),
      mainStillThere: bkmpPlayerDragons.some(d => d.id === 'qa-std-main')
    }));
    expect(goldBefore - after.gold).toBe(150000); // BKMP_DRAGON_ASCEND_COST_GOLD
    expect(after.fodderStillThere).toBe(false); // Opfer-Kopie verbraucht
    expect(after.mainStillThere).toBe(true);

    const serverFodder = (store.tables.player_dragons || []).find(d => d.id === 'qa-std-fodder');
    expect(serverFodder).toBeUndefined(); // auch server-seitig weg, nicht nur lokal ausgeblendet
  });

  test('ohne zweite Kopie derselben Art zeigt der Standard-Drache einen Hinweis statt aufzusteigen', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [STD_SPECIES];
    store.tables.player_dragons = [
      { id: 'qa-std-solo', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: STD_SPECIES.id, stage: 'adult', is_favorite: false, is_companion: false, stat_attack: 10, stat_defense: 5, stat_hp: 100, substats: [], ascension_level: 0, hatched_at: fixtureData.nowIso, adult_at: fixtureData.nowIso }
    ];

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await page.evaluate(() => { bkmpIdleState.gold = 999999999; });

    await page.locator('.idle-dragon-ascend-btn[data-dragon-id="qa-std-solo"]').click();
    await expect(page.locator('.bkmp-jannik-toast', { hasText: 'zweite erwachsene' })).toBeVisible();
    const level = await page.evaluate(() => bkmpPlayerDragons.find(d => d.id === 'qa-std-solo').ascension_level);
    expect(level).toBe(0); // kein Aufstieg ohne Opfer
  });
});
