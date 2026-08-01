/* Gilden-Technologie v3: neuer Zweig "Drachenzucht" (01.08.2026, Nutzerwunsch
   "Eher ein kompletten Zweig für die Drachenzucht? Drachen Angriff %
   Verteidung % Leben % etc?" - siehe sql/20260801-guild-tech-drachenzucht-
   branch.sql). Vier neue Knoten (drei Wurzeln guild_zucht_kraft/-panzer/
   -vitalitaet + eine Zusammenfuehrung guild_zucht_meisterschaft, die ALLE
   DREI Wurzeln gleichzeitig als Vorbedingung braucht - bisher testete kein
   bestehender Test eine 3-fache Zusammenfuehrung, nur 1er/2er). Zwei Ebenen:

   1) RPC-Ebene (rpcAs(), echte Node-IDs statt des generischen 6-Knoten-
      Beispiel-Baums aus guild-tech-tree.spec.js) - Beitrag/Fortschritt/
      Freischaltung nach vollstaendigem Ausbau aller drei Wurzeln.
   2) Read-Seite (Cache-Injektion, identisches Muster wie guild-tech-ext-
      readside.spec.js) - bkmpIdleDragonCompanionEffectTotals() (js/systems/
      bkmp-breeding.js) wendet die vier neuen Bonuswerte nur an, solange ein
      erwachsener Begleitdrache aktiv ist, Zuchtmeisterschaft wirkt additiv
      auf alle drei Hauptwerte gleichzeitig. */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { test: qaTest, expect: qaExpect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

const LEADER_NAME = 'QaZuchtLeader';
const LEADER_UID = 'qa-zucht-leader-0000';

// 1:1 aus sql/20260801-guild-tech-drachenzucht-branch.sql.
const ZUCHT_NODES = [
  { id: 'guild_zucht_kraft', category: 'schlacht', label: 'Zuchtkraft', description: '', icon: '🔥', effect_type: 'guildCompanionAttackPct', effect_per_tier: 8, max_tier: 5, base_gold_cost: 2000000, cost_growth: 1.5, attempts_per_tier: 25, prereq_node_ids: [], pos_x: 800, pos_y: 50 },
  { id: 'guild_zucht_panzer', category: 'schlacht', label: 'Zuchtpanzer', description: '', icon: '🛡️', effect_type: 'guildCompanionDefensePct', effect_per_tier: 8, max_tier: 5, base_gold_cost: 2000000, cost_growth: 1.5, attempts_per_tier: 25, prereq_node_ids: [], pos_x: 1000, pos_y: 50 },
  { id: 'guild_zucht_vitalitaet', category: 'schlacht', label: 'Zuchtvitalität', description: '', icon: '❤️', effect_type: 'guildCompanionHpPct', effect_per_tier: 8, max_tier: 5, base_gold_cost: 2000000, cost_growth: 1.5, attempts_per_tier: 25, prereq_node_ids: [], pos_x: 1200, pos_y: 50 },
  { id: 'guild_zucht_meisterschaft', category: 'schlacht', label: 'Zuchtmeisterschaft', description: '', icon: '🐲', effect_type: 'guildCompanionAllStatPct', effect_per_tier: 5, max_tier: 5, base_gold_cost: 3000000, cost_growth: 1.6, attempts_per_tier: 25, prereq_node_ids: ['guild_zucht_kraft', 'guild_zucht_panzer', 'guild_zucht_vitalitaet'], pos_x: 1000, pos_y: 200 }
];

function zuchtFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  const row = makePlayerStateRow(LEADER_UID, LEADER_NAME.toLowerCase(), nowIso, { display_name: LEADER_NAME, gold: 500000000 });
  return {
    startTimeMs,
    displayName: LEADER_NAME, nameKey: LEADER_NAME.toLowerCase(), authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME), password: QA_PASSWORD,
    users: [{ id: LEADER_UID, email: emailFromName(LEADER_NAME), password: QA_PASSWORD, user_metadata: {} }],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [row],
      idle_prestige_state: [], idle_player_runes: [],
      guilds: [{ id: 'g1', name: 'Zuchtgilde', tag: 'ZCH', treasury_gold: 0, member_count: 1, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: LEADER_UID, created_at: nowIso }],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, tech_contributed_gold: 0, joined_at: nowIso }
      ],
      guild_tech_nodes: ZUCHT_NODES.map(n => ({ ...n })),
      guild_tech_progress: [], guild_tech_contributor_attempts: [],
      guild_tech_levels: [], guild_activity_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, zuchtFixture(startTimeMs)), { startTimeMs: Date.now() });
    await use(server);
    await server.close();
  }
});

async function rpcAs(server, name, fnName, params) {
  const email = emailFromName(name);
  const tokenRes = await fetch(`${server.baseURL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: QA_PASSWORD })
  });
  const token = (await tokenRes.json()).access_token;
  const rpcRes = await fetch(`${server.baseURL}/rest/v1/rpc/${fnName}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params || {})
  });
  const json = await rpcRes.json().catch(() => null);
  return { status: rpcRes.status, json };
}

async function maxOutNode(server, nodeId) {
  // Genug Beitraege in Folge, um die Stufe auf max_tier zu heben (25 Versuche/Tag
  // reichen fuer 5 Stufen bei attempts_per_tier=25 nicht in EINEM Tag - die
  // Versuchs-Zeile wird deshalb nicht vorab manuell angelegt (der Handler tut
  // das selbst korrekt beim ersten Aufruf, inkl. des internen Feldnamens
  // last_attempt_at_ms - ein eigener manueller Zeitstempel-Push hier wuerde
  // bei falschem Feldnamen zu "Invalid time value" fuehren), sondern bei
  // jedem verbrauchten Pool per direktem Reset auf 5 wieder aufgefuellt.
  let tier = 0;
  let guardLoops = 0;
  while (tier < 5 && guardLoops < 200) {
    guardLoops += 1;
    const res = await rpcAs(server, LEADER_NAME, 'guild_tech_contribute', { p_node_id: nodeId });
    if (res.status !== 200) {
      // Beitragsversuche verbraucht - Pool direkt wieder auffuellen (Mock-Zeitreise unnoetig fuer diesen Test).
      const attemptsRow = server.store.tables.guild_tech_contributor_attempts.find(r => r.auth_user_id === LEADER_UID);
      if (attemptsRow) attemptsRow.attempts = 5;
      continue;
    }
    // Die RPC-Antwort ist ein einzelnes Objekt, kein Array (identisches Muster wie guild-tech-tree.spec.js:104).
    const row = Array.isArray(res.json) ? res.json[0] : res.json;
    tier = row.new_tier;
  }
  return tier;
}

test.describe('Gilden-Technologie v3: Zweig "Drachenzucht" (RPC-Ebene, echte Node-IDs)', () => {
  test('ein Beitrag zu einer Wurzel (z.B. Zuchtkraft) erhoeht den Fortschritt normal', async ({ qaServer }) => {
    const res = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_contribute', { p_node_id: 'guild_zucht_kraft' });
    expect(res.status).toBe(200);
    const row = Array.isArray(res.json) ? res.json[0] : res.json;
    expect(row.new_tier).toBeGreaterThanOrEqual(0);
    expect(Number(row.gold_spent)).toBeGreaterThan(0);
  });

  test('Zuchtmeisterschaft (3-fache Zusammenfuehrung) lehnt ab, solange auch nur EINE der drei Wurzeln nicht voll ist', async ({ qaServer }) => {
    await maxOutNode(qaServer, 'guild_zucht_kraft');
    await maxOutNode(qaServer, 'guild_zucht_panzer');
    // guild_zucht_vitalitaet bewusst NICHT ausgebaut.
    const res = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_contribute', { p_node_id: 'guild_zucht_meisterschaft' });
    expect(res.status).toBe(400);
    expect(res.json.message || res.json.hint || JSON.stringify(res.json)).toContain('prereq_not_met');
  });

  test('Zuchtmeisterschaft schaltet sich frei, sobald ALLE DREI Wurzeln voll ausgebaut sind', async ({ qaServer }) => {
    expect(await maxOutNode(qaServer, 'guild_zucht_kraft')).toBe(5);
    expect(await maxOutNode(qaServer, 'guild_zucht_panzer')).toBe(5);
    expect(await maxOutNode(qaServer, 'guild_zucht_vitalitaet')).toBe(5);
    // Der Beitragsversuch-Pool ist EIN gemeinsamer Vorrat ueber ALLE Knoten
    // (nicht pro Knoten wie bei dungeon_keys) - nach drei maxOutNode()-Laeufen
    // kann er auf einem beliebigen Zwischenstand (0-4) stehen. Direkt wieder
    // auffuellen, damit dieser Test wirklich die Freischaltung selbst prueft,
    // nicht zufaellig einen ausgeschoepften Pool.
    const attemptsRow = qaServer.store.tables.guild_tech_contributor_attempts.find(r => r.auth_user_id === LEADER_UID);
    if (attemptsRow) attemptsRow.attempts = 5;
    const res = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_contribute', { p_node_id: 'guild_zucht_meisterschaft' });
    expect(res.status).toBe(200);
    const row = Array.isArray(res.json) ? res.json[0] : res.json;
    expect(row.new_tier).toBeGreaterThanOrEqual(0);
  });
});

function setCache(page, obj) {
  return page.evaluate((o) => localStorage.setItem('bkmp-guild-tech-cache', JSON.stringify(o)), obj);
}
function setCompanionDragon(page, stats) {
  return page.evaluate((s) => {
    bkmpPlayerDragons = [{ id: 'zucht-companion-1', is_companion: true, stage: 'adult', species_id: 'wuffdrache', ascension_level: 0, substats: [], ...s }];
  }, stats);
}

qaTest.describe('Gilden-Technologie v3: Zweig "Drachenzucht" (Read-Seite - bkmpIdleDragonCompanionEffectTotals)', () => {
  qaTest.use({ teststand: 'A' });

  qaTest('ohne aktiven Begleitdrachen bleiben die Totals leer, egal wie hoch der Cache ist', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await setCache(page, { guildCompanionAttackPct: 40, guildCompanionDefensePct: 40, guildCompanionHpPct: 40, guildCompanionAllStatPct: 25 });
    const totals = await page.evaluate(() => bkmpIdleDragonCompanionEffectTotals());
    qaExpect(totals).toEqual({});
  });

  qaTest('Zuchtkraft/-panzer/-vitalitaet wirken unabhaengig auf Angriff/Verteidigung/Leben des Begleitdrachens', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await setCompanionDragon(page, { stat_attack: 100, stat_defense: 100, stat_hp: 100 });
    const base = await page.evaluate(() => bkmpIdleDragonCompanionEffectTotals());
    qaExpect(base.attack_flat).toBeCloseTo(100, 1);
    qaExpect(base.defense_flat).toBeCloseTo(100, 1);
    qaExpect(base.hp_flat).toBeCloseTo(100, 1);

    await setCache(page, { guildCompanionAttackPct: 24, guildCompanionDefensePct: 16, guildCompanionHpPct: 8 });
    const boosted = await page.evaluate(() => bkmpIdleDragonCompanionEffectTotals());
    qaExpect(boosted.attack_flat).toBeCloseTo(124, 1);
    qaExpect(boosted.defense_flat).toBeCloseTo(116, 1);
    qaExpect(boosted.hp_flat).toBeCloseTo(108, 1);
  });

  qaTest('Zuchtmeisterschaft (guildCompanionAllStatPct) wirkt ADDITIV auf alle drei Hauptwerte gleichzeitig, zusaetzlich zu den einzelnen Zweigen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await setCompanionDragon(page, { stat_attack: 100, stat_defense: 100, stat_hp: 100 });
    await setCache(page, { guildCompanionAttackPct: 24, guildCompanionDefensePct: 16, guildCompanionHpPct: 8, guildCompanionAllStatPct: 25 });
    const totals = await page.evaluate(() => bkmpIdleDragonCompanionEffectTotals());
    // attack: 24 (eigener Zweig) + 25 (Meisterschaft) = 49% -> 149
    qaExpect(totals.attack_flat).toBeCloseTo(149, 1);
    // defense: 16 + 25 = 41% -> 141
    qaExpect(totals.defense_flat).toBeCloseTo(141, 1);
    // hp: 8 + 25 = 33% -> 133
    qaExpect(totals.hp_flat).toBeCloseTo(133, 1);
  });

  qaTest('Deckel bei 200% pro Zweig verhindert einen unbegrenzten Wert bei einem manipulierten Cache', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await setCompanionDragon(page, { stat_attack: 100, stat_defense: 100, stat_hp: 100 });
    await setCache(page, { guildCompanionAttackPct: 99999, guildCompanionDefensePct: 0, guildCompanionHpPct: 0, guildCompanionAllStatPct: 0 });
    const totals = await page.evaluate(() => bkmpIdleDragonCompanionEffectTotals());
    // 200% Deckel -> Faktor 3 statt eines absurd hohen Werts.
    qaExpect(totals.attack_flat).toBeCloseTo(300, 1);
  });
});
