const fs = require('fs');
const path = require('path');
const { test, expect, openAndLogin } = require('../helpers/qa-fixtures');
const { VILLAGE_BUILDING_LEVELS, VILLAGE_TRADE_TEMPLATES } = require('../fixtures/village-reference');

/* Drachendorf-Ausbau Phase 2 (04.10.2026): Dorfentwicklung (Drachenhafen I-III,
   Handelsposten I-II) - Bauen/Handeln laufen ueber die serverseitigen RPCs
   (Nachbau in tests/mock/rpc-engine.js). */

/* Auf schmalen Breiten liegt der Knopf im per transform verschobenen
   "Mehr"-Sheet: Playwrights isVisible() meldet dort faelschlich true
   (bekannte Falle, siehe guild-chat.spec.js) - deshalb an der sichtbaren
   kompakten Navigation erkennen und dann per DOM-Klick ausloesen. */
async function clickDorfTab(page) {
  const compact = await page.locator('#bkmpProtoNavMoreBtn').isVisible().catch(() => false);
  if (compact) await page.evaluate(() => document.getElementById('idleTabBtnDorf').click());
  else await page.locator('#idleTabBtnDorf').click();
}

async function openDorfTab(page) {
  // Desktop: echter Tab-Knopf. Handy: Knopf liegt im "Mehr"-Sheet -> DOM-Klick
  // (gleiches Vorgehen wie die kompakte Navigation intern).
  await clickDorfTab(page);
  await expect(page.locator('#idlePanelDorf')).toBeVisible();
  await expect(page.locator('[data-testid="village-card-drachenhafen"]')).toBeVisible({ timeout: 10000 });
}

function serverState(store, fixtureData) {
  return store.tables.idle_player_state.find(r => r.auth_user_id === fixtureData.authUserId);
}

test.describe('Dorfentwicklung – Katalog', () => {
  test('Testdaten entsprechen exakt der SQL-Migration', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../sql/20261004-02-village-projects.sql'), 'utf8');
    for (const r of VILLAGE_BUILDING_LEVELS) {
      const re = new RegExp(`\\('${r.building_id}', ${r.level}, '[^']+', '[^']*', '${r.level_label}',[\\s\\S]*?'[^']*'::jsonb, ${r.min_stage},\\s*${r.cost_gold}, ${r.cost_wood}, ${r.cost_stone}, ${r.cost_crystals}, ${r.cost_essence}, ${r.sort_order}\\)`);
      expect(sql, `Zeile ${r.building_id} ${r.level}`).toMatch(re);
      const effects = sql.match(new RegExp(`'${r.level_label}',[\\s\\S]*?'([^']*)'::jsonb`))[1];
      expect(JSON.parse(effects)).toEqual(r.effects);
    }
    for (const t of VILLAGE_TRADE_TEMPLATES) {
      const c2 = t.cost2_kind ? `'${t.cost2_kind}'` : 'null';
      const re = new RegExp(`\\('${t.id}',\\s+'${t.label}',\\s+${t.weight}, ${t.min_handelsposten_level}, '${t.cost_kind}',\\s+${t.cost_amount}, ${t.cost_gold_units}, ${c2}, ${t.cost2_amount}, '${t.reward_kind}',\\s+${t.reward_amount},\\s+${t.sort_order}\\)`);
      expect(sql, `Vorlage ${t.id}`).toMatch(re);
    }
  });
});

test.describe('Dorfentwicklung – früher Spieler (Teststand B)', () => {
  test.use({ teststand: 'B' });

  test('Projekte sichtbar, Bauen gesperrt mit verständlichem Grund', async ({ page, qaBaseURL, fixtureData, store }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await openAndLogin(page, qaBaseURL, fixtureData);
    await openDorfTab(page);
    await expect(page.locator('[data-testid="village-card-handelsposten"]')).toBeVisible();
    await expect(page.locator('[data-testid="village-build-drachenhafen"]')).toBeDisabled();
    await expect(page.locator('[data-testid="village-card-drachenhafen"]')).toContainText('Benötigt Kampf-Stufe 5-0');
    await expect(page.locator('[data-testid="village-card-drachenhafen"] .dd-cost-chip.is-short').first()).toBeVisible();

    // Server lehnt auch einen direkten Aufruf ab (Stufe 34 < 50).
    const msg = await page.evaluate(() => bkmpVillageBuildRpc('drachenhafen').then(() => 'ok', e => e.message));
    expect(msg).toMatch(/weiter vorankommen/);
    expect(store.tables.village_buildings || []).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('Dorfentwicklung – Fortgeschritten (Teststand C)', () => {
  test.use({ teststand: 'C' });

  test('Drachenhafen I bauen: Kosten serverseitig und lokal identisch abgezogen, bleibt nach Reload', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpIdleStopLoop());
    await openDorfTab(page);
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    const before = { ...serverState(store, fixtureData) };

    await page.locator('[data-testid="village-build-drachenhafen"]').click();
    await expect(page.locator('[data-testid="village-card-drachenhafen"]')).toContainText('Drachenhafen II', { timeout: 10000 });

    const after = serverState(store, fixtureData);
    const def = VILLAGE_BUILDING_LEVELS[0];
    for (const k of ['gold', 'wood', 'stone', 'crystals', 'essence']) {
      expect(Number(before[k]) - Number(after[k]), k).toBe(def['cost_' + k]);
    }
    const local = await page.evaluate(() => ({ gold: bkmpIdleState.gold, wood: bkmpIdleState.wood, crystals: bkmpIdleState.crystals }));
    expect(local.gold).toBe(Number(after.gold));
    expect(local.wood).toBe(Number(after.wood));
    expect(local.crystals).toBe(Number(after.crystals));

    const eff = await page.evaluate(() => bkmpVillageHarborEffects());
    expect(eff).toEqual({ level: 1, slots: 1, regions: ['fluesterwald', 'glutberge'] });

    // Autosave darf den Abzug nicht rueckgaengig machen.
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    expect(Number(serverState(store, fixtureData).gold)).toBe(Number(after.gold));

    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await openDorfTab(page);
    await expect(page.locator('[data-testid="village-card-drachenhafen"]')).toContainText('Stufe 1 / 3');
  });

  test('Doppelklick / zwei gleichzeitige Aufrufe bauen nur eine Stufe', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpIdleStopLoop());
    await openDorfTab(page);
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    const goldBefore = Number(serverState(store, fixtureData).gold);
    await page.evaluate(() => Promise.all([bkmpVillageBuild('drachenhafen'), bkmpVillageBuild('drachenhafen')]));
    const rows = store.tables.village_buildings.filter(r => r.auth_user_id === fixtureData.authUserId);
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe(1);
    expect(goldBefore - Number(serverState(store, fixtureData).gold)).toBe(VILLAGE_BUILDING_LEVELS[0].cost_gold);
  });

  test('Stufe III bleibt gesperrt (Kampf-Stufe 850 < 1500) – auch serverseitig', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpIdleStopLoop());
    await page.evaluate(async () => { await bkmpIdleFlushSyncNow(); await bkmpVillageBuildRpc('drachenhafen'); });
    serverState(store, fixtureData).wood = 900000; serverState(store, fixtureData).stone = 900000;
    serverState(store, fixtureData).crystals = 90000; serverState(store, fixtureData).essence = 90000;
    serverState(store, fixtureData).gold = 900000000;
    const r2 = await page.evaluate(() => bkmpVillageBuildRpc('drachenhafen').then(r => r.level, e => e.message));
    expect(r2).toBe(2);
    const r3 = await page.evaluate(() => bkmpVillageBuildRpc('drachenhafen').then(r => r.level, e => e.message));
    expect(r3).toMatch(/weiter vorankommen/);
  });

  test('Handelsposten: 3 Tagesangebote, deterministisch, Kauf genau einmal', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpIdleStopLoop());
    await openDorfTab(page);
    await page.locator('[data-testid="village-build-handelsposten"]').click();
    await expect(page.locator('[data-testid="village-trade"] .dd-trade-card')).toHaveCount(3, { timeout: 10000 });

    const first = await page.evaluate(() => bkmpVillageTradeOffersRpc());
    const again = await page.evaluate(() => bkmpVillageTradeOffersRpc());
    expect(again.offers.map(o => o.template_id)).toEqual(first.offers.map(o => o.template_id));
    expect(new Set(first.offers.map(o => o.template_id)).size).toBe(3);

    // Ein Angebot waehlen, das sicher bezahlbar ist und keinen Lagerdeckel hat.
    const st = serverState(store, fixtureData);
    const pick = first.offers.find(o => !['fruit', 'meat'].includes(o.reward_kind) && Number(st[o.cost_kind]) >= o.cost_amount && (!o.cost2_kind || Number(st[o.cost2_kind]) >= o.cost2_amount));
    test.skip(!pick, 'Kein bezahlbares Angebot in der heutigen Auswahl');
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    const before = { ...serverState(store, fixtureData) };
    const runesBefore = await page.evaluate(() => bkmpIdlePlayerRunes.length);
    const eggsBefore = await page.evaluate(() => bkmpPlayerDragonEggs.length);

    const results = await page.evaluate(i => Promise.all([
      bkmpVillageTradeExecuteRpc(i).then(r => 'ok', e => e.message),
      bkmpVillageTradeExecuteRpc(i).then(r => 'ok', e => e.message)
    ]), pick.index);
    expect(results.filter(r => r === 'ok')).toHaveLength(1);
    expect(results.find(r => r !== 'ok')).toMatch(/heute schon/);

    const after = serverState(store, fixtureData);
    expect(Number(before[pick.cost_kind]) - Number(after[pick.cost_kind]) + (pick.reward_kind === pick.cost_kind ? pick.reward_amount : 0)).toBe(pick.cost_amount);
    if (!['rune', 'egg'].includes(pick.reward_kind)) {
      expect(Number(after[pick.reward_kind]) - Number(before[pick.reward_kind])).toBe(pick.reward_amount);
    }
    // Kein ungewolltes Runen-/Ei-Geschenk bei einem reinen Ressourcen-Tausch.
    if (!['rune', 'egg'].includes(pick.reward_kind)) {
      expect(await page.evaluate(() => bkmpIdlePlayerRunes.length)).toBe(runesBefore);
      expect(await page.evaluate(() => bkmpPlayerDragonEggs.length)).toBe(eggsBefore);
    }
  });

  test('Handelsposten: Rune als Belohnung wird genau einmal gutgeschrieben', async ({ page, qaBaseURL, fixtureData, store }) => {
    // Nur die Runen-Vorlage anbieten (Katalog ist datengetrieben).
    store.tables.village_trade_templates = store.tables.village_trade_templates.filter(t => t.id === 'kristall_rune');
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpIdleStopLoop());
    await openDorfTab(page);
    await page.locator('[data-testid="village-build-handelsposten"]').click();
    await expect(page.locator('[data-testid="village-offer-0"]')).toBeVisible({ timeout: 10000 });
    const runesBefore = await page.evaluate(() => bkmpIdlePlayerRunes.length);
    const crystalsBefore = await page.evaluate(() => bkmpIdleState.crystals);
    await page.locator('[data-testid="village-offer-0"] .dd-trade-btn').click();
    await expect(page.locator('[data-testid="village-offer-0"]')).toContainText('Heute angenommen', { timeout: 10000 });
    expect(await page.evaluate(() => bkmpIdlePlayerRunes.length)).toBe(runesBefore + 1);
    expect(await page.evaluate(() => bkmpIdleState.crystals)).toBe(crystalsBefore - 300);
  });

  test('Lagerdeckel: Früchte-Tausch bei vollem Lager wird abgelehnt, nichts abgezogen', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.village_trade_templates = store.tables.village_trade_templates.filter(t => t.id === 'gold_frucht');
    await openAndLogin(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpIdleStopLoop());
    await page.evaluate(async () => { await bkmpIdleFlushSyncNow(); await bkmpVillageBuildRpc('handelsposten'); });
    const before = Number(serverState(store, fixtureData).gold);
    // Teststand C: 9.000 Früchte bei Obstgarten 8 (Deckel 6.000) -> voll.
    const msg = await page.evaluate(() => bkmpVillageTradeExecuteRpc(0).then(() => 'ok', e => e.message));
    expect(msg).toMatch(/Lager/);
    expect(Number(serverState(store, fixtureData).gold)).toBe(before);
    expect((store.tables.village_trade_log || []).length).toBe(0);
  });

  test('Datenbank-Update noch nicht ausgeführt: ruhiger Hinweis statt Fehler', async ({ page, qaBaseURL, fixtureData }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route(/\/rest\/v1\/village_building_levels/, route => route.fulfill({
      status: 404, contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.village_building_levels' in the schema cache" })
    }));
    await openAndLogin(page, qaBaseURL, fixtureData);
    await clickDorfTab(page);
    await expect(page.locator('#idlePanelDorf')).toContainText('bald verfügbar', { timeout: 10000 });
    expect(errors).toEqual([]);
  });
});
