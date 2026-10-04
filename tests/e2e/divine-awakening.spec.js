/* Drachendorf-Ausbau Phase 9/10 (04.10.2026): Lightnix/Darknix mit fuenfter
   Form + Goettliche Erweckung. Server-Nachbau: tests/mock/event-engine.js
   (divine_status/_offer/_awaken), Trigger-Nachbau: tests/mock/dragon-guards.js.
   Arten + Erweckungs-Konfiguration direkt aus sql/20261004-08 gelesen. */
const fs = require('fs');
const path = require('path');
const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');
const { EVENT_SPECIES } = require('../fixtures/event-reference');
const expeditionRules = require('../../js/systems/bkmp-expedition-rules.js');

const LIGHT = 'dddddddd-0000-4000-8000-000000000001';
const DARK = 'dddddddd-0000-4000-8000-000000000002';
const NORMAL = 'dddddddd-0000-4000-8000-000000000003';

function dragon(fx, id, speciesId, extra) {
  return {
    id, name_key: fx.nameKey, auth_user_id: fx.authUserId, species_id: speciesId, stage: 'adult', nickname: null,
    food_preference: 'fruit', growth_points: 0, battle_xp: 0, is_companion: false, is_favorite: true,
    main_stat_key: 'attack', stat_attack: 400, stat_defense: 200, stat_hp: 2000,
    substats: [{ stat: 'attack_pct', value: 2 }, { stat: 'gold_find_pct', value: 2 }], ascension_level: 0,
    hatched_at: fx.nowIso, adult_at: fx.nowIso, bond_xp: 0, companion_seconds: 0, companion_kills: 0,
    companion_boss_kills: 0, expeditions_completed: 0, trait: 'mutig', divine_offering_gold: 0, divine_offering_units: 0,
    divine_multiplier: 1, awakened_at: null, origin_event: 'zwielicht', ...(extra || {})
  };
}
const READY = { bond_xp: 900, companion_seconds: 36000, companion_boss_kills: 50, expeditions_completed: 10 };

function seed(store, fx, lightExtra, darkExtra) {
  const normal = { ...EVENT_SPECIES[0], id: 'qa-normal', name: 'QA-Normal', rarity: 'standard', stage_count: 4, unique_per_account: false, event_origin: null, special_passive: null, divine_config: null };
  store.tables.dragon_species = [...EVENT_SPECIES.map(s => ({ ...s })), normal];
  store.tables.player_dragons = [dragon(fx, LIGHT, 'lightnix', lightExtra), dragon(fx, DARK, 'darknix', darkExtra), dragon(fx, NORMAL, 'qa-normal', { origin_event: null })];
  const st = store.tables.idle_player_state.find(r => r.auth_user_id === fx.authUserId);
  Object.assign(st, { gold: 5e12, crystals: 100000, essence: 100000, highest_dragon_index: 400 });
}
function serverState(store, fx) { return store.tables.idle_player_state.find(r => r.auth_user_id === fx.authUserId); }
function serverDragon(store, id) { return store.tables.player_dragons.find(d => d.id === id); }
async function reopenIdle(page, baseURL) {
  await page.goto(baseURL + '/');
  await page.locator('#idleDorfButton').click();
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await page.waitForFunction(() => typeof bkmpPlayerDragons !== 'undefined' && bkmpPlayerDragons.some(d => d.stage === 'divine'), null, { timeout: 15000 });
}
async function openDetail(page, id) {
  await page.evaluate(dragonId => bkmpDragonOpenDetail(dragonId), id);
  await expect(page.locator('#idleDragonDetailOverlay')).toHaveClass(/visible/);
}

test.describe('Göttliche Erweckung', () => {
  test.use({ teststand: 'C' });

  test('Arten-Daten: fünf Stufen, Göttlich ist eine Stufe (keine Seltenheit), Auren gleichwertig', () => {
    expect(EVENT_SPECIES.map(s => s.id)).toEqual(['lightnix', 'darknix']);
    for (const s of EVENT_SPECIES) {
      expect(s.rarity).toBe('legendaer');
      expect(s.stage_count).toBe(5);
      expect(s.final_stage_label).toBe('Göttlich');
      expect(s.unique_per_account).toBe(true);
      expect(s.divine_image).toBe(`assets/dragons/breeding/divine/${s.id}.png`);
      expect(s.divine_config.stat_multiplier).toBeGreaterThanOrEqual(1.2);
      expect(s.divine_config.stat_multiplier).toBeLessThanOrEqual(1.3);
    }
    const [l, d] = EVENT_SPECIES.map(s => s.special_passive.divine_aura);
    /* Gleichwertig: jede Aura-Wirkung in "Zusatzwert-Maximalwuerfen" umrechnen
       (Hoechstwert je Art aus BKMP_DRAGON_SUBSTAT_POOL), Summen hoechstens
       10 % auseinander - andere Spielweise, keine Meta-Wahl. */
    const src = fs.readFileSync(path.join(__dirname, '../../js/systems/bkmp-breeding.js'), 'utf8');
    const maxOf = key => Number(src.match(new RegExp("key: '" + key + "'[^}]*max: ([0-9.]+)"))[1]);
    const worth = o => Object.entries(o).reduce((a, [k, v]) => a + v / maxOf(k), 0);
    const wl = worth(l.effects), wd = worth(d.effects);
    expect(Math.abs(wl - wd) / Math.max(wl, wd)).toBeLessThanOrEqual(0.1);
    expect(Object.keys(l.effects)).not.toEqual(Object.keys(d.effects));
    // Normale Arten bleiben bei vier Stufen
    expect(l.name).toContain('Licht');
    expect(d.name).toContain('Finsternis');
  });

  test('Ohne Bindung/Nutzung/Opfergabe keine Erweckung; Opfergabe in Teilen, nie über das Ziel', async ({ page, qaBaseURL, fixtureData, store }) => {
    seed(store, fixtureData, {}, {});
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await openDetail(page, LIGHT);
    const panel = page.locator('[data-testid="divine-panel"]');
    await expect(panel).toContainText('Weg zur Göttlichkeit', { timeout: 10000 });
    await expect(page.locator('[data-testid="divine-awaken-btn"]')).toBeDisabled();
    expect(await page.evaluate(id => bkmpDivineAwakenRpc(id).then(() => 'ok', e => e.message), LIGHT)).toMatch(/Bindung/);
    // Ohne Kampfdrachen-Nutzung, aber genug Bindung: Nutzung fehlt
    serverDragon(store, LIGHT).bond_xp = 900;
    expect(await page.evaluate(id => bkmpDivineAwakenRpc(id).then(() => 'ok', e => e.message), LIGHT)).toMatch(/gemeinsam/);
    // Opfergabe: 10 %, dann alles; Server und Spiel ziehen exakt gleich ab
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    const goldBefore = Number(serverState(store, fixtureData).gold);
    await panel.locator('[data-divine-offer]').first().click();
    await expect(panel).toContainText('Opfergabe: 10 %', { timeout: 10000 });
    await panel.locator('[data-divine-offer]').last().click();
    await expect(page.locator('[data-testid="divine-offering"]')).toContainText('100 %', { timeout: 10000 });
    const unit = Math.max(6, Math.round(6 * Math.pow(1 + 0.05 * 400, 1.2)));
    const spent = goldBefore - Number(serverState(store, fixtureData).gold);
    expect(spent).toBe(Math.ceil(600000 * unit));
    expect(serverDragon(store, LIGHT).divine_offering_units).toBe(600000);
    expect(await page.evaluate(() => bkmpIdleState.gold)).toBe(Number(serverState(store, fixtureData).gold));
    expect(await page.evaluate(id => bkmpDivineOfferRpc(id, 1e9).then(() => 'ok', e => e.message), LIGHT)).toMatch(/bereits vollständig/);
    // Ein Spiel-Patch kann geschuetzte Felder nicht setzen
    await page.evaluate(id => updatePlayerDragon(id, { stage: 'divine', divine_multiplier: 5, divine_offering_units: 9e9 }), DARK);
    expect(serverDragon(store, DARK).stage).toBe('adult');
    expect(serverDragon(store, DARK).divine_multiplier).toBe(1);
    expect(serverDragon(store, DARK).divine_offering_units).toBe(0);
  });

  test('Erweckung: 100 % Erfolg, gleicher Drache bleibt, Bonus einmal gespeichert, nicht bei Reload/2 Tabs doppelt', async ({ page, qaBaseURL, fixtureData, store, context }) => {
    test.setTimeout(90000);
    seed(store, fixtureData, { ...READY, divine_offering_units: 600000, is_companion: true, nickname: 'Sonnenschein' }, {});
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    const before = await page.evaluate(id => {
      const d = bkmpPlayerDragons.find(x => x.id === id);
      return { atk: bkmpDragonAscendedMainStat(d, d.stat_attack), totals: bkmpIdleDragonCompanionEffectTotals() };
    }, LIGHT);
    expect(before.totals.defense_pct || 0).toBe(0); // Aura erst als Goettlich
    await openDetail(page, LIGHT);
    await expect(page.locator('[data-testid="divine-awaken-btn"]')).toBeEnabled({ timeout: 10000 });
    const crystalsBefore = Number(serverState(store, fixtureData).crystals);
    await page.locator('[data-testid="divine-awaken-btn"]').click();
    await page.locator('#bkmpConfirmOkBtn').click();
    await expect.poll(() => serverDragon(store, LIGHT).stage, { timeout: 10000 }).toBe('divine');
    const d = serverDragon(store, LIGHT);
    expect(d.divine_multiplier).toBe(1.25);
    expect(d.trait).toBe('mutig');
    expect(d.bond_xp).toBe(900);
    expect(d.is_favorite).toBe(true);
    expect(d.nickname).toBe('Sonnenschein');
    expect(d.id).toBe(LIGHT);
    /* 2.000 Kristalle Kosten; die Kristallmine kann waehrend des Klicks
       (Speichern direkt vor der Erweckung) noch 1-2 Kristalle produzieren. */
    const spentCrystals = crystalsBefore - Number(serverState(store, fixtureData).crystals);
    expect(spentCrystals).toBeGreaterThanOrEqual(1995);
    expect(spentCrystals).toBeLessThanOrEqual(2000);
    expect(await page.evaluate(() => bkmpIdleState.crystals)).toBe(Number(serverState(store, fixtureData).crystals));
    expect(await page.evaluate(id => bkmpDivineAwakenRpc(id).then(() => 'ok', e => e.message), LIGHT)).toMatch(/bereits göttlich/);
    const after = await page.evaluate(id => {
      const x = bkmpPlayerDragons.find(y => y.id === id);
      return { stage: x.stage, atk: bkmpDragonAscendedMainStat(x, x.stat_attack), totals: bkmpIdleDragonCompanionEffectTotals() };
    }, LIGHT);
    expect(after.stage).toBe('divine');
    expect(after.atk).toBeCloseTo(before.atk * 1.25, 5);
    expect(after.totals.defense_pct).toBeCloseTo(6, 5);
    expect(after.totals.attack_pct).toBeCloseTo(2 * 1.125, 5); // Zusatzwert x1,125
    // Reload: derselbe Wert, kein zweites Multiplizieren
    await reopenIdle(page, qaBaseURL);
    const reloaded = await page.evaluate(id => { const x = bkmpPlayerDragons.find(y => y.id === id); return bkmpDragonAscendedMainStat(x, x.stat_attack); }, LIGHT);
    expect(reloaded).toBeCloseTo(after.atk, 5);
    // Zweiter Tab sieht denselben Wert
    const page2 = await context.newPage();
    await reopenIdle(page2, qaBaseURL);
    const tab2 = await page2.evaluate(id => { const x = bkmpPlayerDragons.find(y => y.id === id); return bkmpDragonAscendedMainStat(x, x.stat_attack); }, LIGHT);
    expect(tab2).toBeCloseTo(after.atk, 5);
    expect(serverDragon(store, LIGHT).divine_multiplier).toBe(1.25);
  });

  test('Einzelstück: kein Aufstieg mit Kopie, kein Freilassen; Dex mit 5 Formen; Expedition mit Göttlich-Aura', async ({ page, qaBaseURL, fixtureData, store }) => {
    seed(store, fixtureData, {}, { ...READY, stage: 'divine', divine_multiplier: 1.25 });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    const r = await page.evaluate(([l, n]) => ({
      ascendLight: bkmpDragonCanAscend(bkmpPlayerDragons.find(d => d.id === l)),
      ascendNormal: bkmpDragonCanAscend(bkmpPlayerDragons.find(d => d.id === n)),
      stagesLight: bkmpDragonSpeciesStages(bkmpDragonSpeciesById('lightnix')),
      stagesNormal: bkmpDragonSpeciesStages(bkmpDragonSpeciesById('qa-normal')),
      divineImg: bkmpDragonStageImage(bkmpDragonSpeciesById('darknix'), 'divine')
    }), [LIGHT, NORMAL]);
    expect(r.ascendLight).toBe(false);
    expect(r.ascendNormal).toBe(true);
    expect(r.stagesLight).toEqual(['egg', 'baby', 'teen', 'adult', 'divine']);
    expect(r.stagesNormal).toEqual(['egg', 'baby', 'teen', 'adult']);
    expect(r.divineImg).toBe('assets/dragons/breeding/divine/darknix.png');
    await page.evaluate(id => bkmpDragonConfirmAndRelease(id), LIGHT);
    expect(serverDragon(store, LIGHT)).toBeTruthy();
    // Aura auf Expeditionen: identisch in Regelmodul und Server-Nachbau
    const sp = EVENT_SPECIES.find(s => s.id === 'darknix');
    const team = [{ species_id: 'darknix', rarity: 'legendaer', affinities: ['dunkel'], trait: null, bond_level: 5, aura: sp.special_passive.divine_aura.expedition }];
    const plain = [{ ...team[0], aura: null }];
    const mission = { id: 'x', team_size: 1, duration_hours: 1, requirements: {}, recommendations: [], rewards: { gold_units: 10, crystals: 100, essence: 100 } };
    const seedFn = () => 0;
    const a = expeditionRules.bkmpExpeditionOutcome({ mission, team, events: [], goldUnit: 10, seedInt: seedFn, id: 'e1' });
    const b = expeditionRules.bkmpExpeditionOutcome({ mission, team: plain, events: [], goldUnit: 10, seedInt: seedFn, id: 'e1' });
    expect(a.rewards.crystals).toBe(Math.round(b.rewards.crystals * 1.1));
    const lightAura = EVENT_SPECIES.find(s => s.id === 'lightnix').special_passive.divine_aura.expedition;
    const evalL = expeditionRules.bkmpExpeditionTeamEval(mission, [{ ...plain[0], aura: lightAura }]);
    expect(evalL.score - expeditionRules.bkmpExpeditionTeamEval(mission, plain).score).toBe(6);
  });
});
