const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Nutzer-Meldung (05.10.2026, zwei Screenshots der Lexikon-Detailansicht von
   "Troasa": einmal "Ei", einmal "Erwachsen"): "Man sieht sobald man das EGG
   hat alle Stufen bereits vom Drachen wie sie aussehen tun."
   Bisher war "entdeckt" nur pro ART - schon ein Ei schaltete alle Formen in
   voller Farbe frei, im Raster sogar immer das Erwachsenen-Bild. Jetzt gilt
   es pro FORM: farbig ist nur, was man mit dieser Art schon erreicht hat
   (dauerhafte Dex-Aufzeichnung ODER aktueller Besitz), spaetere Formen sind
   schwarze Silhouetten - wie bei unentdeckten Arten (Nutzerwunsch 17.07.).
   Siehe bkmpDragonDexReachedIndex()/bkmpDragonRenderDexPage() in
   js/systems/bkmp-breeding.js. Alles laeuft ueber direkte Funktionsaufrufe
   (keine Desktop-Tab-Klicks), daher auf allen 3 Projekten. */

test.use({ teststand: 'A' });

/* Echte, im Repo vorhandene Bilder (kein 404 -> keine Konsolenfehler). */
const art = (folderName) => ({
  egg_image: `assets/dragons/breeding/egg/${folderName}.png`,
  baby_image: `assets/dragons/breeding/baby/${folderName}.png`,
  teen_image: `assets/dragons/breeding/teen/${folderName}.png`,
  adult_image: `assets/dragons/breeding/adult/${folderName}.png`
});
function species(id, name, folderName, i, extra) {
  return {
    id, name, rarity: 'episch', egg_source: 'event', source_dragon_id: null, egg_drop_chance: 0,
    brood_seconds: 7020, sacrifice_gold: 0, sacrifice_crystals: 0, growth_points_required: 100, battle_xp_required: 100,
    is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1, ...art(folderName), sort_order: i, active: true, ...(extra || {})
  };
}
const SPECIES = () => [
  species('qa-egg', 'QA-Nur-Ei', 'wuchi', 1),
  species('qa-baby', 'QA-Baby', 'muecke', 2),
  species('qa-adult', 'QA-Erwachsen', 'flinkerboy', 3),
  species('qa-unknown', 'QA-Unentdeckt', 'codewizard', 4),
  species('qa-divine', 'QA-Goettlich', 'wuchi', 5, { stage_count: 5, final_stage_key: 'divine', final_stage_label: 'Göttlich', divine_image: 'assets/dragons/breeding/adult/derjannikhase.png' }),
  species('qa-divine-adult', 'QA-Goettlich-Nur-Erwachsen', 'muecke', 6, { stage_count: 5, final_stage_key: 'divine', final_stage_label: 'Göttlich', divine_image: 'assets/dragons/breeding/adult/derjannikhase.png' })
];
function dragon(fixtureData, id, speciesId, stage) {
  return {
    id, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: speciesId,
    stage, is_favorite: false, is_companion: false, ascension_level: 0, substats: [],
    stat_attack: 10, stat_defense: 10, stat_hp: 10, growth_points: 0, battle_xp: 0,
    hatched_at: fixtureData.nowIso, adult_at: fixtureData.nowIso
  };
}
function seed(store, fixtureData) {
  store.tables.dragon_species = SPECIES();
  store.tables.player_dragon_eggs = [
    { id: 'qa-egg-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: 'qa-egg', created_at: fixtureData.nowIso }
  ];
  store.tables.player_dragons = [
    dragon(fixtureData, 'qa-d-baby', 'qa-baby', 'baby'),
    dragon(fixtureData, 'qa-d-adult', 'qa-adult', 'adult'),
    dragon(fixtureData, 'qa-d-divine', 'qa-divine', 'divine'),
    dragon(fixtureData, 'qa-d-divine-adult', 'qa-divine-adult', 'adult')
  ];
}
async function open(page, qaBaseURL, fixtureData) {
  await openAndLogin(page, qaBaseURL, fixtureData);
  await waitForDragonReady(page);
  await page.evaluate(() => bkmpIdleStopLoop());
}
/* Raster-HTML direkt aus der echten Funktion, ohne Tab-Klick. */
const gridCards = page => page.evaluate(() => {
  const host = document.createElement('div');
  host.innerHTML = bkmpDragonRenderLexikonSection();
  return [...host.querySelectorAll('.idle-dragon-dex-card')].map(c => ({
    id: c.dataset.speciesId, reached: c.dataset.reachedForm, locked: c.classList.contains('is-locked'),
    src: c.querySelector('img').getAttribute('src'), name: c.querySelector('.idle-skin-name').textContent.trim()
  }));
});
const detail = page => page.evaluate(() => {
  const img = document.getElementById('idleDragonDexImg');
  return {
    locked: img.classList.contains('idle-dragon-dex-img-locked'), src: img.getAttribute('src'), alt: img.alt,
    name: document.getElementById('idleDragonDexName').textContent, desc: document.getElementById('idleDragonDexDesc').textContent,
    stage: document.getElementById('idleDragonDexStage').textContent,
    dots: [...document.querySelectorAll('#idleDragonDexOverlay .idle-dragon-dex-dot')].map(d => d.classList.contains('is-reached')),
    overlayLocked: document.getElementById('idleDragonDexOverlay').dataset.stageLocked
  };
});

test.describe('Lexikon: Formen erst zeigen, wenn man sie erreicht hat', () => {
  test('Raster zeigt das Bild der höchsten ERREICHTEN Form – nicht mehr immer das Erwachsenen-Bild', async ({ page, qaBaseURL, fixtureData, store }) => {
    seed(store, fixtureData);
    await open(page, qaBaseURL, fixtureData);
    const cards = Object.fromEntries((await gridCards(page)).map(c => [c.id, c]));

    // Nur ein Ei -> nur das Ei-Bild (das war der gemeldete Spoiler: vorher das Erwachsenen-Bild)
    expect(cards['qa-egg'].reached).toBe('0');
    expect(cards['qa-egg'].src).toContain('/egg/wuchi-web');
    expect(cards['qa-egg'].locked).toBe(false);
    expect(cards['qa-egg'].name).toBe('QA-Nur-Ei');
    // Baby -> Baby-Bild, Erwachsen -> Erwachsenen-Bild
    expect(cards['qa-baby'].reached).toBe('1');
    expect(cards['qa-baby'].src).toContain('/baby/muecke-web');
    expect(cards['qa-adult'].reached).toBe('3');
    expect(cards['qa-adult'].src).toContain('/adult/flinkerboy-web');
    // Fünfte Form (Göttlich) -> deren eigenes Bild
    expect(cards['qa-divine'].reached).toBe('4');
    expect(cards['qa-divine'].src).toContain('/adult/derjannikhase-web');
    // Unentdeckte Art: unverändert gesperrt, "???" und schwarze Silhouette der Erwachsenen-Form (verrät nichts)
    expect(cards['qa-unknown'].reached).toBe('-1');
    expect(cards['qa-unknown'].locked).toBe(true);
    expect(cards['qa-unknown'].name).toBe('???');
    expect(cards['qa-unknown'].src).toContain('/adult/codewizard-web');
  });

  test('Detailansicht: nur das Ei ist farbig, Baby/Jugendlich/Erwachsen sind Silhouetten mit Hinweis', async ({ page, qaBaseURL, fixtureData, store }) => {
    seed(store, fixtureData);
    await open(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpDragonOpenDexDetail('qa-egg'));

    // Seite 1 = Ei: farbig, mit Brutzeit
    let d = await detail(page);
    expect(d.stage).toBe('Ei');
    expect(d.locked).toBe(false);
    expect(d.name).toBe('QA-Nur-Ei');
    expect(d.desc).toContain('Brutzeit');
    expect(d.alt).toContain('QA-Nur-Ei');
    expect(d.dots).toEqual([true, false, false, false]);

    // Seiten 2-4: schwarz, Name bleibt sichtbar (Art ist ja entdeckt), Hinweis statt Brutzeit
    for (const [idx, label, folder] of [[1, 'Baby', 'baby'], [2, 'Jugendlich', 'teen'], [3, 'Erwachsen', 'adult']]) {
      await page.evaluate(i => bkmpDragonDexGoToPage(i), idx);
      d = await detail(page);
      expect(d.stage, `Seite ${idx}`).toBe(label);
      expect(d.locked, `Seite ${idx} gesperrt`).toBe(true);
      expect(d.overlayLocked).toBe('1');
      expect(d.name).toBe('QA-Nur-Ei');
      expect(d.desc).toContain('noch nicht erreicht');
      expect(d.desc).not.toContain('Brutzeit');
      expect(d.alt).toBe('Noch nicht erreichte Form');
      expect(d.src).toContain(`/${folder}/wuchi.png`);
    }
    // Zurückblättern zum Ei: wieder farbig
    await page.evaluate(() => bkmpDragonDexGoToPage(0));
    expect((await detail(page)).locked).toBe(false);
  });

  test('Detailansicht: Art mit Erwachsenem zeigt alle vier Formen in Farbe; fünfte Form nur bei erreichter Göttlich-Stufe', async ({ page, qaBaseURL, fixtureData, store }) => {
    seed(store, fixtureData);
    await open(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpDragonOpenDexDetail('qa-adult'));
    for (let i = 0; i < 4; i++) {
      await page.evaluate(n => bkmpDragonDexGoToPage(n), i);
      const d = await detail(page);
      expect(d.locked, `Seite ${i}`).toBe(false);
      expect(d.desc).toContain('Brutzeit');
    }
    expect((await detail(page)).dots).toEqual([true, true, true, true]);
    await page.evaluate(() => bkmpDragonCloseDexDetail());

    // Göttliche Art mit göttlichem Drachen: alle fünf Formen farbig
    await page.evaluate(() => bkmpDragonOpenDexDetail('qa-divine'));
    await page.evaluate(() => bkmpDragonDexGoToPage(4));
    const d5 = await detail(page);
    expect(d5.stage).toBe('Göttlich');
    expect(d5.locked).toBe(false);
    expect(d5.dots).toEqual([true, true, true, true, true]);
    await page.evaluate(() => bkmpDragonCloseDexDetail());

    // Art mit fünfter Form, aber nur Erwachsen erreicht: Formen 1-4 farbig, die fünfte bleibt gesperrt
    await page.evaluate(() => bkmpDragonOpenDexDetail('qa-divine-adult'));
    await page.evaluate(() => bkmpDragonDexGoToPage(3));
    expect((await detail(page)).locked).toBe(false);
    await page.evaluate(() => bkmpDragonDexGoToPage(4));
    const d5b = await detail(page);
    expect(d5b.stage).toBe('Göttlich');
    expect(d5b.locked).toBe(true);
    expect(d5b.dots).toEqual([true, true, true, true, false]);
  });

  test('Dauerhafte Aufzeichnung: erreichte Form bleibt farbig, auch wenn der Drache nicht mehr im Besitz ist', async ({ page, qaBaseURL, fixtureData, store }) => {
    seed(store, fixtureData);
    await open(page, qaBaseURL, fixtureData);
    // Art "qa-unknown" gilt als entdeckt und hatte einmal einen Erwachsenen (Aufzeichnung), ist aber nicht mehr im Besitz
    await page.evaluate(() => {
      bkmpIdleState.dragon_species_discovered_at = bkmpIdleState.dragon_species_discovered_at || {};
      bkmpIdleState.dragon_species_discovered_at['qa-unknown'] = new Date().toISOString();
      bkmpChronicleRecordDex('qa-unknown', 3, 0, 0, 0);
    });
    const cards = Object.fromEntries((await gridCards(page)).map(c => [c.id, c]));
    expect(cards['qa-unknown'].reached).toBe('3');
    expect(cards['qa-unknown'].locked).toBe(false);
    expect(cards['qa-unknown'].src).toContain('/adult/codewizard-web');
    await page.evaluate(() => bkmpDragonOpenDexDetail('qa-unknown'));
    await page.evaluate(() => bkmpDragonDexGoToPage(3));
    expect((await detail(page)).locked).toBe(false);
  });

  test('Neue Form wird sofort freigeschaltet, sobald der Drache sie erreicht', async ({ page, qaBaseURL, fixtureData, store }) => {
    seed(store, fixtureData);
    await open(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpDragonOpenDexDetail('qa-baby'));
    await page.evaluate(() => bkmpDragonDexGoToPage(2));
    expect((await detail(page)).locked).toBe(true); // Jugendlich: noch nicht erreicht
    await page.evaluate(() => { bkmpPlayerDragons.find(x => x.id === 'qa-d-baby').stage = 'teen'; bkmpDragonRenderDexPage(); });
    const d = await detail(page);
    expect(d.locked).toBe(false);
    expect(d.desc).toContain('Brutzeit');
    await page.evaluate(() => bkmpDragonDexGoToPage(3));
    expect((await detail(page)).locked).toBe(true); // Erwachsen: weiterhin gesperrt
  });

  test('Unentdeckte Art bleibt komplett gesperrt (alle Seiten schwarz, Name "???")', async ({ page, qaBaseURL, fixtureData, store }) => {
    seed(store, fixtureData);
    await open(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpDragonOpenDexDetail('qa-unknown'));
    for (let i = 0; i < 4; i++) {
      await page.evaluate(n => bkmpDragonDexGoToPage(n), i);
      const d = await detail(page);
      expect(d.locked, `Seite ${i}`).toBe(true);
      expect(d.name).toBe('???');
      expect(d.desc).toContain('Noch nicht entdeckt');
    }
    expect((await detail(page)).dots).toEqual([false, false, false, false]);
  });
});
