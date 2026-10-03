const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');
const { DRAGON_TRAITS } = require('../fixtures/trait-reference');
const { EXPEDITION_MISSIONS, EXPEDITION_EVENTS } = require('../fixtures/expedition-reference');
const rules = require('../../js/systems/bkmp-expedition-rules.js');

/* Drachendorf-Ausbau Phase 4 (04.10.2026): Eigenschaften, Bindung, Dex. */

function species(id, rarity, affinities, extra) {
  return {
    id, name: 'QA-' + id, rarity, affinities, egg_source: 'event', source_dragon_id: null, egg_drop_chance: 0,
    brood_seconds: 999999, sacrifice_gold: 0, sacrifice_crystals: 0, growth_points_required: 100, battle_xp_required: 100,
    is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1, egg_image: '', baby_image: '', teen_image: '', adult_image: '',
    sort_order: 1, active: true, stage_count: 4, unique_per_account: false, ...(extra || {})
  };
}
function dragon(fx, id, speciesId, extra) {
  return {
    id, name_key: fx.nameKey, auth_user_id: fx.authUserId, species_id: speciesId, stage: 'adult', food_preference: 'fruit',
    growth_points: 0, battle_xp: 0, is_companion: false, is_favorite: false, main_stat_key: 'attack', stat_attack: 10, stat_defense: 5,
    stat_hp: 50, substats: [], ascension_level: 0, hatched_at: fx.nowIso, adult_at: fx.nowIso, bond_xp: 0, expeditions_completed: 0, ...(extra || {})
  };
}
const A = 'bbbbbbbb-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002', T = 'bbbbbbbb-0000-4000-8000-000000000003';

test.describe('Eigenschaften – Katalog & Regeln', () => {
  test('11 positive Eigenschaften, alle in Missionen/Ereignissen verwendeten existieren', () => {
    expect(DRAGON_TRAITS.map(t => t.id)).toEqual(rules.BKMP_DRAGON_TRAIT_IDS);
    const ids = new Set(DRAGON_TRAITS.map(t => t.id));
    for (const m of EXPEDITION_MISSIONS) for (const r of m.recommendations) if (r.type === 'trait') expect(ids, `${m.id}: ${r.value}`).toContain(r.value);
    for (const e of EXPEDITION_EVENTS) for (const t of Object.keys(e.trait_bonus)) expect(ids, `${e.id}: ${t}`).toContain(t);
    // Keine negativen Eigenschaften: Beschreibung ohne Minus-Werte.
    for (const t of DRAGON_TRAITS) expect(t.description, t.id).not.toMatch(/[−-]\s?\d+\s?%/);
  });

  test('Wirkungen: Mutig, Gesellig, Einzelgänger, Bindungsmeilenstein 4, Beschützer, Glückskind, Gierig, Entdecker', () => {
    // 8-Std.-Mission OHNE Eigenschafts-Empfehlung, damit nur die Eigenschaftswirkung zaehlt.
    const m8 = { ...EXPEDITION_MISSIONS.find(m => m.id === 'fw_tiefer_wald') };
    const base = [{ species_id: 'a', rarity: 'standard', affinities: ['feuer'], bond_level: 1 }, { species_id: 'b', rarity: 'standard', affinities: ['feuer'], bond_level: 1 }, { species_id: 'c', rarity: 'standard', affinities: ['wasser'], bond_level: 1 }];
    const s0 = rules.bkmpExpeditionTeamEval(m8, base).score;
    expect(rules.bkmpExpeditionTeamEval(m8, base.map((x, i) => i === 0 ? { ...x, trait: 'mutig' } : x)).score).toBe(s0 + 10);
    expect(rules.bkmpExpeditionTeamEval(m8, base.map((x, i) => i === 0 ? { ...x, trait: 'mutig', bond_level: 8 } : x)).score)
      .toBe(s0 + 15 + 3 + Math.floor((((8 + 1 + 1) / 3) - 1) * 2)); // Bindung 8 -> staerkere Eigenschaft + Meilenstein 4 + Durchschnitt
    expect(rules.bkmpExpeditionTeamEval(m8, base.map((x, i) => i === 1 ? { ...x, trait: 'gesellig' } : x)).score).toBe(s0 + 8);
    const solo = EXPEDITION_MISSIONS.find(m => m.id === 'fw_waldrand');
    const one = [{ species_id: 'a', rarity: 'standard', affinities: ['feuer'], bond_level: 1 }];
    expect(rules.bkmpExpeditionTeamEval(solo, [{ ...one[0], trait: 'einzelgaenger' }]).score).toBe(rules.bkmpExpeditionTeamEval(solo, one).score + 12);
    // Beschuetzer: Minimum 8 statt 0; Glueckskind: Spanne 26 statt 21.
    expect(rules.bkmpExpeditionRoll(21, [{ trait: 'beschuetzer', bond_level: 1 }])).toBe(8);
    expect(rules.bkmpExpeditionRoll(21, [{}])).toBe(0);
    expect(rules.bkmpExpeditionRollRange([{ trait: 'glueckskind', bond_level: 1 }]).max).toBe(25);
    // Gierig: +15 % Gold; Entdecker: hoehere Ereignischance.
    const fixed = v => () => v;
    const args = (team, seed) => ({ mission: solo, region: { rune_tier: 0, egg_tier: 1 }, team, events: EXPEDITION_EVENTS, goldUnit: 1000, seedInt: seed, id: 'x' });
    const plain = rules.bkmpExpeditionOutcome(args(one, fixed(9999)));
    const greedy = rules.bkmpExpeditionOutcome(args([{ ...one[0], trait: 'gierig' }], fixed(9999)));
    expect(greedy.rewards.gold).toBe(Math.round(plain.rewards.gold * 1.15));
    // Seed 1300: knapp ueber der Schatztruhen-Grundchance (12 %) -> nur mit Entdecker (+3 %) ein Treffer.
    expect(rules.bkmpExpeditionOutcome(args(one, fixed(1300))).events.map(e => e.id)).not.toContain('schatztruhe');
    expect(rules.bkmpExpeditionOutcome(args([{ ...one[0], trait: 'entdecker' }], fixed(1300))).events.map(e => e.id)).toContain('schatztruhe');
  });
});

test.describe('Eigenschaften & Bindung – im Spiel (Teststand C)', () => {
  test.use({ teststand: 'C' });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Lager-Karten-Prüfung per Desktop-Reiter');
  });

  function seed(store, fx) {
    store.tables.dragon_species = [species('qa-feuer', 'standard', ['feuer']), species('qa-licht', 'episch', ['licht', 'arkan']),
      species('qa-gott', 'legendaer', ['licht'], { stage_count: 5, final_stage_key: 'divine', final_stage_label: 'Göttlich', event_origin: 'QA-Event' })];
    store.tables.player_dragons = [dragon(fx, A, 'qa-feuer'), dragon(fx, B, 'qa-licht'), dragon(fx, T, 'qa-feuer', { stage: 'teen', adult_at: null })];
  }

  test('Erwachsene bekommen genau einmal eine Eigenschaft – deterministisch, nicht vom Spiel änderbar', async ({ page, qaBaseURL, fixtureData, store }) => {
    seed(store, fixtureData);
    await openAndLogin(page, qaBaseURL, fixtureData);
    await expect.poll(() => store.tables.player_dragons.filter(d => d.trait).length, { timeout: 10000 }).toBe(2);
    const a = store.tables.player_dragons.find(d => d.id === A).trait;
    const b = store.tables.player_dragons.find(d => d.id === B).trait;
    expect(rules.BKMP_DRAGON_TRAIT_IDS).toContain(a);
    expect(rules.BKMP_DRAGON_TRAIT_IDS).toContain(b);
    expect(store.tables.player_dragons.find(d => d.id === T).trait).toBeFalsy(); // Jugendliche noch nicht
    // Erneuter Aufruf aendert nichts.
    const again = await page.evaluate(() => bkmpDragonEnsureTraitsRpc());
    expect(again.rows).toEqual([]);
    // Direkter Schreibversuch des Spiels wird verworfen (geschuetztes Feld).
    const other = rules.BKMP_DRAGON_TRAIT_IDS.find(x => x !== a);
    await page.evaluate(([id, t]) => updatePlayerDragon(id, { trait: t, bond_xp: 7500 }), [A, other]);
    const row = store.tables.player_dragons.find(d => d.id === A);
    expect(row.trait).toBe(a);
    expect(row.bond_xp).toBe(0);
    // Anzeige auf der Lager-Karte + im Detailfenster.
    await page.locator('#idleTabBtnDrachen').click();
    const traitName = DRAGON_TRAITS.find(t => t.id === a).name;
    await expect(page.locator(`.idle-dragon-lager-card[data-dragon-id="${A}"] .dd-id-trait`)).toContainText(traitName);
    await expect(page.locator(`.idle-dragon-lager-card[data-dragon-id="${A}"] .dd-id-aff`)).toContainText('🔥');
  });

  test('Bindung wächst nur durch echte, gespeicherte Siege als Begleiter – Spam bringt nichts', async ({ page, qaBaseURL, fixtureData, store }) => {
    seed(store, fixtureData);
    store.tables.player_dragons.find(d => d.id === A).is_companion = true;
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpIdleStopLoop());
    const first = await page.evaluate(() => bkmpDragonActivityTickRpc());
    expect(first.bond_gain).toBe(0); // setzt nur den Ausgangswert
    const st = store.tables.idle_player_state.find(r => r.auth_user_id === fixtureData.authUserId);
    // Spam: sofortiger zweiter Aufruf wird ignoriert.
    st.dragon_kills = Number(st.dragon_kills) + 500;
    const spam = await page.evaluate(() => bkmpDragonActivityTickRpc());
    expect(spam.too_soon).toBe(true);
    // 60 s spaeter: 500 behauptete Siege, aber hoechstens 3/s zaehlen (180) -> 4 Punkte, gedeckelt auf 3/min.
    store.clock.advance(60 * 1000);
    const tick = await page.evaluate(() => bkmpDragonActivityTickRpc());
    expect(tick.kills).toBe(180);
    expect(tick.bond_gain).toBe(3);
    const a = store.tables.player_dragons.find(d => d.id === A);
    expect(a.bond_xp).toBe(3);
    expect(a.companion_kills).toBe(180);
    // Nicht-Begleiter bekommt nichts.
    expect(store.tables.player_dragons.find(d => d.id === B).bond_xp || 0).toBe(0);
  });

  test('Dex: Infoblock, fünf Formen bei Event-Art, Rekorde bleiben nach Freilassen erhalten', async ({ page, qaBaseURL, fixtureData, store }) => {
    seed(store, fixtureData);
    store.tables.player_dragons.push(dragon(fixtureData, 'bbbbbbbb-0000-4000-8000-000000000009', 'qa-gott', { ascension_level: 2 }));
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnDrachen').click();
    await expect(page.locator('[data-testid="dex-stats"]')).toContainText('Arten entdeckt');
    await page.evaluate(() => bkmpDexReconcile());
    await page.evaluate(() => bkmpDragonOpenDexDetail('qa-gott'));
    await expect(page.locator('#idleDragonDexOverlay .idle-dragon-dex-dot')).toHaveCount(5);
    await expect(page.locator('#idleDragonDexInfo')).toContainText('Elemente');
    await expect(page.locator('#idleDragonDexInfo')).toContainText('Höchster Aufstieg: 2');
    await expect(page.locator('#idleDragonDexInfo')).toContainText('QA-Event');
    await page.evaluate(() => bkmpDragonCloseDexDetail());
    await page.evaluate(() => bkmpDragonOpenDexDetail('qa-feuer'));
    await expect(page.locator('#idleDragonDexOverlay .idle-dragon-dex-dot')).toHaveCount(4);
    await page.evaluate(() => bkmpDragonCloseDexDetail());
    // Rekord bleibt, auch wenn der Drache weg ist.
    await page.evaluate(() => { bkmpPlayerDragons = bkmpPlayerDragons.filter(d => d.species_id !== 'qa-gott'); });
    const rec = await page.evaluate(() => bkmpDexRecord('qa-gott'));
    expect(rec[0]).toBe(3);
    expect(rec[1]).toBe(2);
  });
});
