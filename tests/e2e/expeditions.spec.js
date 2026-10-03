const path = require('path');
const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');
const { readInsertTuples } = require('../helpers/sql-catalog-parser');
const { EXPEDITION_REGIONS, EXPEDITION_MISSIONS, EXPEDITION_EVENTS } = require('../fixtures/expedition-reference');
const rules = require('../../js/systems/bkmp-expedition-rules.js');

/* Drachendorf-Ausbau Phase 3 (04.10.2026): Drachen-Expeditionen.
   Server-Nachbau: tests/mock/rpc-engine.js (expedition_start/_claim/_status),
   Trigger-Nachbau: tests/mock/dragon-guards.js. */

const SQL_PATH = path.join(__dirname, '../../sql/20261004-03-expeditions.sql');

function species(id, name, rarity, affinities) {
  return {
    id, name, rarity, affinities, egg_source: 'event', source_dragon_id: null, egg_drop_chance: 0,
    brood_seconds: 999999, sacrifice_gold: 0, sacrifice_crystals: 0, growth_points_required: 100, battle_xp_required: 100,
    is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1,
    egg_image: '', baby_image: '', teen_image: '', adult_image: '', sort_order: 1, active: true, stage_count: 4, unique_per_account: false
  };
}
const SPECIES = [
  species('qa-feuer', 'QA-Feuerdrache', 'standard', ['feuer']),
  species('qa-wasser', 'QA-Wasserdrache', 'standard', ['wasser']),
  species('qa-wind', 'QA-Winddrache', 'standard', ['wind']),
  species('qa-erde', 'QA-Erddrache', 'selten', ['erde']),
  species('qa-licht', 'QA-Lichtdrache', 'episch', ['licht', 'arkan'])
];
function dragon(fx, id, speciesId, extra) {
  return {
    id, name_key: fx.nameKey, auth_user_id: fx.authUserId, species_id: speciesId, stage: 'adult',
    food_preference: 'fruit', growth_points: 0, battle_xp: 0, is_companion: false, is_favorite: false,
    main_stat_key: 'attack', stat_attack: 10, stat_defense: 5, stat_hp: 50, substats: [], ascension_level: 0,
    hatched_at: fx.nowIso, adult_at: fx.nowIso, bond_xp: 0, expeditions_completed: 0, trait: null, ...(extra || {})
  };
}
const D = { feuer: 'aaaaaaaa-0000-4000-8000-000000000001', wasser: 'aaaaaaaa-0000-4000-8000-000000000002', wind: 'aaaaaaaa-0000-4000-8000-000000000003', erde: 'aaaaaaaa-0000-4000-8000-000000000004', licht: 'aaaaaaaa-0000-4000-8000-000000000005' };

function seedDragons(store, fx, harborLevel) {
  store.tables.dragon_species = SPECIES.map(s => ({ ...s }));
  store.tables.player_dragons = [
    dragon(fx, D.feuer, 'qa-feuer'), dragon(fx, D.wasser, 'qa-wasser'), dragon(fx, D.wind, 'qa-wind'),
    dragon(fx, D.erde, 'qa-erde'), dragon(fx, D.licht, 'qa-licht')
  ];
  store.tables.village_buildings = harborLevel > 0
    ? [{ auth_user_id: fx.authUserId, name_key: fx.nameKey, building_id: 'drachenhafen', level: harborLevel, upgraded_at: fx.nowIso }]
    : [];
}
function serverState(store, fx) { return store.tables.idle_player_state.find(r => r.auth_user_id === fx.authUserId); }

async function openDrachenTab(page) {
  const compact = await page.locator('#bkmpProtoNavMoreBtn').isVisible().catch(() => false);
  if (compact) await page.evaluate(() => document.getElementById('idleTabBtnDrachen').click());
  else await page.locator('#idleTabBtnDrachen').click();
  await expect(page.locator('#idlePanelDrachen')).toBeVisible();
  await expect(page.locator('[data-testid="exp-section"]')).toBeVisible({ timeout: 10000 });
}

test.describe('Expeditionen – Katalog & Regeln', () => {
  test('Testkatalog entspricht exakt der SQL-Migration', () => {
    const regions = readInsertTuples(SQL_PATH, 'expedition_regions').map(f => ({ id: f[0], name: f[1], icon: f[2], description: f[3], min_harbor_level: +f[4], rune_tier: +f[5], egg_tier: +f[6], sort_order: +f[7] }));
    const missions = readInsertTuples(SQL_PATH, 'expedition_missions').map(f => ({ id: f[0], region_id: f[1], name: f[2], description: f[3], duration_hours: +f[4], team_size: +f[5], requirements: JSON.parse(f[6]), recommendations: JSON.parse(f[7]), rewards: JSON.parse(f[8]), sort_order: +f[9], active: true }));
    const events = readInsertTuples(SQL_PATH, 'expedition_events').map(f => ({ id: f[0], name: f[1], icon: f[2], description: f[3], base_chance: +f[4], affinity_bonus: JSON.parse(f[5]), trait_bonus: JSON.parse(f[6]), reward: JSON.parse(f[7]), sort_order: +f[8] }));
    expect(regions).toEqual(EXPEDITION_REGIONS);
    expect(missions).toEqual(EXPEDITION_MISSIONS);
    expect(events).toEqual(EXPEDITION_EVENTS);
  });

  test('Datenregeln: keine Mission verlangt zwingend Licht/Arkan oder eine Seltenheit über Standard', () => {
    for (const m of EXPEDITION_MISSIONS) {
      const req = m.requirements || {};
      Object.keys(req.affinity_min || {}).forEach(a => expect(['feuer', 'wasser', 'wind', 'blitz', 'erde', 'dunkel'], `${m.id}: ${a}`).toContain(a));
      Object.keys(req.rarity_min || {}).forEach(r => expect(r, m.id).toBe('standard'));
      expect([1, 4, 8]).toContain(m.duration_hours);
      expect(m.team_size).toBeGreaterThanOrEqual(1);
      expect(m.team_size).toBeLessThanOrEqual(3);
      // Jede Mission hat eine Grundbelohnung (kein Totalausfall).
      const rw = m.rewards;
      expect((rw.gold_units || 0) + (rw.wood || 0) + (rw.crystals || 0) + (rw.essence || 0) + (rw.stone || 0), m.id).toBeGreaterThan(0);
    }
  });

  test('Team-Bewertung: Pflichtbedingungen, Empfehlungen, Bindungsstufen', () => {
    const m = EXPEDITION_MISSIONS.find(x => x.id === 'vt_drachenhort');
    const weak = rules.bkmpExpeditionTeamEval(m, [
      { species_id: 'a', rarity: 'standard', affinities: ['feuer'], bond_level: 1 },
      { species_id: 'a', rarity: 'standard', affinities: ['feuer'], bond_level: 1 },
      { species_id: 'b', rarity: 'standard', affinities: ['wasser'], bond_level: 1 }
    ]);
    expect(weak.unmet).toEqual(['distinct_affinities_min', 'distinct_species_min']);
    const good = rules.bkmpExpeditionTeamEval(m, [
      { species_id: 'a', rarity: 'standard', affinities: ['licht'], bond_level: 7 },
      { species_id: 'b', rarity: 'episch', affinities: ['dunkel'], bond_level: 7 },
      { species_id: 'c', rarity: 'selten', affinities: ['erde'], bond_level: 7 }
    ]);
    expect(good.unmet).toEqual([]);
    expect(good.met).toEqual([0, 1, 2]);
    // 25 + 3*15 + 3 Seltenheiten*5 + 3 Elemente*4 + (7-1)*2 + 3 Mitglieder mit Bindung 4+ * 3 = 118
    expect(good.score).toBe(118);
    expect(rules.bkmpDragonBondLevel(0)).toBe(1);
    expect(rules.bkmpDragonBondLevel(99)).toBe(1);
    expect(rules.bkmpDragonBondLevel(100)).toBe(2);
    expect(rules.bkmpDragonBondLevel(7500)).toBe(10);
    expect(rules.bkmpExpeditionQuality(54)).toBe(1);
    expect(rules.bkmpExpeditionQuality(55)).toBe(2);
    expect(rules.bkmpExpeditionQuality(75)).toBe(3);
    expect(rules.bkmpExpeditionQuality(94)).toBe(3);
    expect(rules.bkmpExpeditionQuality(95)).toBe(4);
  });
});

test.describe('Expeditionen – im Spiel (Teststand C)', () => {
  test.use({ teststand: 'C' });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Planungsfenster wird auf Desktop geprüft; Handy siehe eigener Block unten');
  });

  test('ohne Drachenhafen: Hinweis + Sprung zur Dorfentwicklung', async ({ page, qaBaseURL, fixtureData, store }) => {
    seedDragons(store, fixtureData, 0);
    await openAndLogin(page, qaBaseURL, fixtureData);
    await openDrachenTab(page);
    await expect(page.locator('[data-testid="exp-section"]')).toContainText('Drachenhafen');
    await page.locator('[data-exp-goto-dorf]').click();
    await expect(page.locator('#idlePanelDorf')).toBeVisible();
  });

  test('Expedition planen, starten, Drache ist gesperrt, abholen nach Ablauf – genau einmal', async ({ page, qaBaseURL, fixtureData, store }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    seedDragons(store, fixtureData, 1);
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await openDrachenTab(page);

    await page.locator('[data-testid="exp-plan-btn"]').click();
    await expect(page.locator('#idleExpPlannerOverlay')).toHaveClass(/visible/);
    // Frostklamm braucht Drachenhafen II.
    await expect(page.locator('[data-exp-region="frostklamm"]')).toHaveClass(/is-locked/);
    await page.locator('[data-testid="exp-mission-fw_waldrand"]').click();
    await expect(page.locator('[data-testid="exp-start-btn"]')).toBeDisabled();
    await page.locator(`[data-exp-dragon="${D.erde}"]`).click();
    await expect(page.locator('[data-testid="exp-quality"]')).toContainText('⭐');
    await page.locator('[data-testid="exp-start-btn"]').click();
    await expect(page.locator('#idleExpPlannerOverlay')).not.toHaveClass(/visible/);

    const exp = store.tables.player_expeditions[0];
    expect(exp.dragon_ids).toEqual([D.erde]);
    expect(exp.status).toBe('running');
    await expect(page.locator(`[data-testid="exp-running-${exp.id}"]`)).toContainText('Holz am Waldrand');
    await expect(page.locator(`.idle-dragon-lager-card[data-dragon-id="${D.erde}"]`)).toContainText('Auf Expedition');

    // Gesperrt: Begleiter setzen (Client) und Freilassen (Server-Trigger).
    await page.evaluate(id => bkmpDragonSetCompanion(id), D.erde);
    expect(store.tables.player_dragons.find(d => d.id === D.erde).is_companion).toBe(false);
    const delMsg = await page.evaluate(id => releasePlayerDragon(id).then(() => 'ok', e => e.message), D.erde);
    expect(delMsg).toMatch(/dragon_on_expedition/);
    expect(store.tables.player_dragons.some(d => d.id === D.erde)).toBe(true);

    // Nur 1 Platz bei Drachenhafen I.
    const slotMsg = await page.evaluate(id => bkmpExpeditionStartRpc('fw_waldrand', [id]).then(() => 'ok', e => e.message), D.wind);
    expect(slotMsg).toMatch(/Expeditionsplätze/);

    // Zu frueh abholen geht nicht.
    const early = await page.evaluate(id => bkmpExpeditionClaimRpc(id).then(() => 'ok', e => e.message), exp.id);
    expect(early).toMatch(/noch unterwegs/);

    // 1 Std. + 1 Min. vorspulen (Server-Uhr), Status neu laden -> Abholen.
    store.clock.advance(61 * 60 * 1000);
    await page.evaluate(async () => { await bkmpExpEnsureLoaded(true); bkmpIdleRenderDragonsPanel(); });
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    const before = { ...serverState(store, fixtureData) };
    const rewards = { ...exp.rewards };
    expect(rewards.gold).toBeGreaterThan(0); // Grundbelohnung, kein Totalausfall
    await page.locator(`[data-exp-claim="${exp.id}"]`).click();
    await expect(page.locator('#idleExpResultOverlay')).toHaveClass(/visible/, { timeout: 10000 });
    await expect(page.locator('[data-testid="exp-result-rewards"]')).toContainText('Gold');

    const after = serverState(store, fixtureData);
    expect(Number(after.gold) - Number(before.gold)).toBe(rewards.gold);
    expect(Number(after.wood) - Number(before.wood)).toBe(rewards.wood);
    const local = await page.evaluate(() => ({ gold: bkmpIdleState.gold, wood: bkmpIdleState.wood }));
    expect(local.gold).toBe(Number(after.gold));
    expect(local.wood).toBe(Number(after.wood));
    const d = store.tables.player_dragons.find(x => x.id === D.erde);
    expect(d.expeditions_completed).toBe(1);
    expect(d.bond_xp).toBe(rewards.bond_xp);

    // Zweites Abholen: keine zweite Gutschrift.
    const again = await page.evaluate(id => bkmpExpeditionClaimRpc(id), exp.id);
    expect(again.newly_claimed).toBe(false);
    expect(Number(serverState(store, fixtureData).gold)).toBe(Number(after.gold));
    // Drache ist wieder frei.
    const delAfter = await page.evaluate(id => bkmpExpIsDragonOnExpedition(id), D.erde);
    expect(delAfter).toBe(false);
    expect(errors).toEqual([]);
  });

  test('Pflichtbedingung: Lavafelder ohne Feuerdrache lässt sich nicht starten (auch nicht serverseitig)', async ({ page, qaBaseURL, fixtureData, store }) => {
    seedDragons(store, fixtureData, 1);
    await openAndLogin(page, qaBaseURL, fixtureData);
    await openDrachenTab(page);
    await page.locator('[data-testid="exp-plan-btn"]').click();
    await page.locator('[data-exp-region="glutberge"]').click();
    await page.locator('[data-testid="exp-mission-gb_lavafelder"]').click();
    await page.locator(`[data-exp-dragon="${D.wasser}"]`).click();
    await expect(page.locator('.dd-exp-checklist .is-missing')).toContainText('Feuer');
    await expect(page.locator('[data-testid="exp-start-btn"]')).toBeDisabled();
    const msg = await page.evaluate(id => bkmpExpeditionStartRpc('gb_lavafelder', [id]).then(() => 'ok', e => e.message), D.wasser);
    expect(msg).toMatch(/Bedingungen/);
    // "Team vorschlagen" findet den Feuerdrachen.
    await page.locator('[data-exp-suggest]').click();
    await expect(page.locator(`[data-exp-dragon="${D.feuer}"]`)).toHaveClass(/is-selected/);
    await expect(page.locator('[data-testid="exp-start-btn"]')).toBeEnabled();
  });

  test('Serverprüfungen: falsche Teamgröße, doppelter Drache, fremder/Kampf-Drache, gesperrte Region', async ({ page, qaBaseURL, fixtureData, store }) => {
    seedDragons(store, fixtureData, 2);
    store.tables.player_dragons.find(d => d.id === D.licht).is_companion = true;
    await openAndLogin(page, qaBaseURL, fixtureData);
    const r = await page.evaluate(async ([D]) => {
      const t = (m, ids) => bkmpExpeditionStartRpc(m, ids).then(() => 'ok', e => e.message);
      return {
        size: await t('fw_beerenpfad', [D.feuer]),
        dup: await t('fw_beerenpfad', [D.feuer, D.feuer]),
        companion: await t('fw_waldrand', [D.licht]),
        foreign: await t('fw_waldrand', ['ffffffff-0000-4000-8000-000000000000']),
        region: await t('vt_waechterflug', [D.feuer])
      };
    }, [D]);
    expect(r.size).toMatch(/Anzahl/);
    expect(r.dup).toMatch(/einmal/);
    expect(r.companion).toMatch(/nicht verfügbar/);
    expect(r.foreign).toMatch(/nicht verfügbar/);
    expect(r.region).toMatch(/größeren Drachenhafen/);
    expect(store.tables.player_expeditions || []).toEqual([]);
  });

  test('Doppelklick: zwei gleichzeitige Abholungen schreiben nur einmal gut', async ({ page, qaBaseURL, fixtureData, store }) => {
    seedDragons(store, fixtureData, 2);
    await openAndLogin(page, qaBaseURL, fixtureData);
    /* Erst das komplette Oeffnen abwarten (Login-Belohnung der Tagesserie wird
       erst NACH dem Chronik-Laden gutgeschrieben), sonst landet sie zwischen
       Messung und Abholung im Server-Gold. */
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    const started = await page.evaluate(id => bkmpExpeditionStartRpc('fw_waldrand', [id]), D.wind);
    store.clock.advance(2 * 3600 * 1000);
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    const goldBefore = Number(serverState(store, fixtureData).gold);
    const res = await page.evaluate(id => Promise.all([bkmpExpeditionClaimRpc(id), bkmpExpeditionClaimRpc(id)]), started.id);
    expect(res.filter(x => x.newly_claimed)).toHaveLength(1);
    const exp = store.tables.player_expeditions.find(e => e.id === started.id);
    expect(Number(serverState(store, fixtureData).gold) - goldBefore).toBe(exp.rewards.gold);
  });

  test('Datenbank-Update noch nicht ausgeführt: Abschnitt bleibt still verborgen', async ({ page, qaBaseURL, fixtureData, store }) => {
    seedDragons(store, fixtureData, 1);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route(/\/rest\/v1\/expedition_regions/, route => route.fulfill({
      status: 404, contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.expedition_regions' in the schema cache" })
    }));
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.locator('#idleTabBtnDrachen').click();
    await expect(page.locator('#idlePanelDrachen')).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-testid="exp-section"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('Expeditionen – Handy', () => {
  test.use({ teststand: 'C' });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!/^mobile-/.test(testInfo.project.name), 'Nur auf mobile-small/mobile-large');
  });
  test('Abschnitt + Planungsfenster funktionieren auf dem Handy', async ({ page, qaBaseURL, fixtureData, store }) => {
    seedDragons(store, fixtureData, 1);
    await openAndLogin(page, qaBaseURL, fixtureData);
    await openDrachenTab(page);
    await page.evaluate(() => document.querySelector('[data-testid="exp-plan-btn"]').click());
    await expect(page.locator('#idleExpPlannerOverlay')).toHaveClass(/visible/);
    await page.locator('[data-testid="exp-mission-fw_waldrand"]').click();
    await page.locator('[data-exp-suggest]').click();
    await expect(page.locator('[data-testid="exp-start-btn"]')).toBeEnabled();
    const box = await page.locator('.dd-exp-modal-card').boundingBox();
    const vw = page.viewportSize().width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
    await page.locator('[data-testid="exp-start-btn"]').click();
    await expect(page.locator('#idleExpPlannerOverlay')).not.toHaveClass(/visible/);
    expect(store.tables.player_expeditions).toHaveLength(1);
  });
});
