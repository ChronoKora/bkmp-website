/* Phase 5 (24.07.2026, siehe CLAUDE.md) - Gildenplatz-Kauf-Tests.

   Architektur (sql/supabase-guild-extra-slots.sql, einzige Fassung):
   buy_guild_slot() - Basisdeckel 20 Mitglieder, gegen Gildenkasse
   (treasury_gold) bis zu 10 zusaetzliche Plaetze kaufbar (Deckel dann max.
   30), Kosten 400000*1,5^bereits_gekaufte_Plaetze, nur leader/officer.
   Jeder Kauf schreibt guild_activity_log ('slot_purchase'). Der neue Platz
   wird SOFORT in join_guild()/join_guild_by_code()/respond_guild_join_
   request() wirksam (dynamischer Deckel 20+bonus_member_slots, bereits seit
   Phase 3 korrekt im Mock verdrahtet). */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const LEADER_NAME = 'QaSlotLeader';
const OFFICER_NAME = 'QaSlotOfficer';
const MEMBER_NAME = 'QaSlotMember';
const LEADER_UID = 'qa-slot-leader-0000';
const OFFICER_UID = 'qa-slot-officer-0000';
const MEMBER_UID = 'qa-slot-member-0000';

function slotsFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  function row(uid, name, extra) { return makePlayerStateRow(uid, name.toLowerCase(), nowIso, { display_name: name, gold: 0, ...extra }); }
  function user(uid, name) { return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} }; }
  return {
    startTimeMs,
    displayName: LEADER_NAME, nameKey: LEADER_NAME.toLowerCase(), authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME), password: QA_PASSWORD,
    users: [user(LEADER_UID, LEADER_NAME), user(OFFICER_UID, OFFICER_NAME), user(MEMBER_UID, MEMBER_NAME)],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [row(LEADER_UID, LEADER_NAME), row(OFFICER_UID, OFFICER_NAME), row(MEMBER_UID, MEMBER_NAME)],
      idle_prestige_state: [], idle_player_runes: [],
      guilds: [{ id: 'g1', name: 'Testgilde', tag: 'TST', treasury_gold: 5000000, member_count: 3, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: LEADER_UID, created_at: nowIso }],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: OFFICER_UID, guild_id: 'g1', name_key: OFFICER_NAME.toLowerCase(), display_name: OFFICER_NAME, role: 'officer', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: MEMBER_UID, guild_id: 'g1', name_key: MEMBER_NAME.toLowerCase(), display_name: MEMBER_NAME, role: 'member', contributed_gold: 0, joined_at: nowIso }
      ],
      guild_tech_levels: [], guild_activity_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, slotsFixture(startTimeMs)), { startTimeMs: Date.now() });
    await use(server);
    await server.close();
  }
});

async function login(page, server, name) {
  await page.goto(server.url('/'));
  const overlay = page.locator('#mcNameOverlay');
  await expect(overlay).toHaveClass(/visible/, { timeout: 15000 });
  await page.evaluate(() => { const h = document.querySelector('[data-qa-hide]'); if (h) h.click(); });
  await page.locator('#mcAuthName').fill(name);
  await page.locator('#mcAuthPassword').fill(QA_PASSWORD);
  await page.locator('#mcAuthSubmit').click();
  await expect(overlay).not.toHaveClass(/visible/, { timeout: 15000 });
  await page.locator('#idleDorfButton').click();
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await waitForIdleStateReady(page);
  await waitForDragonReady(page);
  await page.evaluate(() => bkmpIdleStopLoop());
}

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
  if (rpcRes.status >= 400) throw new Error(json && json.message);
  return json;
}

test.describe('Gildenplatz-Kauf', () => {
  test('aktuelles Limit zeigt 20 + bonus_member_slots (0 anfangs)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const mine = await page.evaluate(() => window.bkmpGuildGetMine());
    expect(mine.guild.maxMembers).toBe(20);
    expect(mine.guild.bonusMemberSlots).toBe(0);
  });

  test('erster Platzkauf: korrekter Preis (400000) und korrekter Abzug', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const result = await page.evaluate(() => window.bkmpGuildBuySlot());
    expect(result.newBonusSlots).toBe(1);
    expect(result.treasuryGold).toBe(5000000 - 400000);
  });

  test('Preissteigerung 1,5^bereits_gekaufte_Plaetze ueber mehrere Kaeufe exakt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    let treasury = 5000000;
    const expectedCosts = [400000, 600000, 900000]; // 400000*1.5^0,^1,^2
    for (let i = 0; i < 3; i++) {
      const result = await page.evaluate(() => window.bkmpGuildBuySlot());
      expect(result.newBonusSlots).toBe(i + 1);
      treasury -= expectedCosts[i];
      expect(result.treasuryGold).toBe(treasury);
    }
  });

  test('Kauf ohne ausreichende Mittel schlaegt fehl, kein Abzug/keine Erhoehung', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.tables.guilds.find(g => g.id === 'g1').treasury_gold = 100000;
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildBuySlot()); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/Nicht genug Gold/);
    const guild = qaServer.store.tables.guilds.find(g => g.id === 'g1');
    expect(guild.treasury_gold).toBe(100000);
    expect(guild.bonus_member_slots).toBe(0);
  });

  test('unberechtigtes Mitglied (plain member) kann keinen Platz kaufen', async ({ page, qaServer }) => {
    await login(page, qaServer, MEMBER_NAME);
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildBuySlot()); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/Nur Anführer oder Stellvertreter/);
    expect(qaServer.store.tables.guilds.find(g => g.id === 'g1').bonus_member_slots).toBe(0);
  });

  test('Officer darf ebenfalls kaufen', async ({ page, qaServer }) => {
    await login(page, qaServer, OFFICER_NAME);
    const result = await page.evaluate(() => window.bkmpGuildBuySlot());
    expect(result.newBonusSlots).toBe(1);
  });

  test('Maximalgrenze von 10 zusaetzlichen Plaetzen wird durchgesetzt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.tables.guilds.find(g => g.id === 'g1').treasury_gold = 999999999999;
    qaServer.store.tables.guilds.find(g => g.id === 'g1').bonus_member_slots = 10;
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildBuySlot()); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/maximale Erweiterung/);
    expect(qaServer.store.tables.guilds.find(g => g.id === 'g1').bonus_member_slots).toBe(10);
  });

  test('parallele Kaufversuche zweier Berechtigter fuehren zu genau 2 Kaeufen, kein doppelter Abzug/keine verlorene Aktualisierung', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const [leaderResult, officerResult] = await Promise.all([
      page.evaluate(() => window.bkmpGuildBuySlot()),
      rpcAs(qaServer, OFFICER_NAME, 'buy_guild_slot', {})
    ]);
    const guild = qaServer.store.tables.guilds.find(g => g.id === 'g1');
    expect(guild.bonus_member_slots).toBe(2);
    expect(guild.treasury_gold).toBe(5000000 - 400000 - 600000); // 400000*1.5^0 + 400000*1.5^1
    expect([leaderResult.newBonusSlots, officerResult.new_bonus_slots].sort()).toEqual([1, 2]);
  });

  test('Reload zeigt den gekauften Platz weiterhin korrekt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildBuySlot());
    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    const mine = await page.evaluate(() => window.bkmpGuildGetMine());
    expect(mine.guild.bonusMemberSlots).toBe(1);
    expect(mine.guild.maxMembers).toBe(21);
  });

  test('neue Mitglieder koennen den dazugekauften Platz tatsaechlich nutzen (join_guild greift den erhoehten Deckel)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildBuySlot()); // Deckel jetzt 21
    // Gilde bis auf einen freien Platz (21. Slot) auffuellen: bereits 3
    // Mitglieder (Leader/Officer/Member) + 17 weitere = 20, dann 1 frei.
    for (let i = 0; i < 17; i++) {
      const uid = 'qa-slot-filler-' + i;
      qaServer.store.tables.idle_player_state.push({ auth_user_id: uid, name_key: 'filler' + i, display_name: 'Filler' + i, gold: 0 });
      qaServer.store.tables.guild_members.push({ auth_user_id: uid, guild_id: 'g1', name_key: 'filler' + i, display_name: 'Filler' + i, role: 'member', contributed_gold: 0, joined_at: qaServer.store.clock.nowIso() });
    }
    qaServer.store.tables.guilds.find(g => g.id === 'g1').member_count = 20;
    // Ohne den gekauften Bonusplatz waere die Gilde jetzt exakt am
    // Basis-Deckel (20) - ein 21. Beitritt darf NUR wegen des Kaufs klappen.
    qaServer.store.tables.idle_player_state.push({ auth_user_id: 'qa-slot-newcomer', name_key: 'newcomer', display_name: 'Newcomer', gold: 0 });
    const result = await rpcAs(qaServer, LEADER_NAME, 'join_guild', { p_guild_id: 'g1' }).catch(e => String(e.message || e));
    // Leader ist schon Mitglied - dieser Aufruf demonstriert nur, dass der
    // RPC ueberhaupt den erhoehten Deckel korrekt LIEST (already_in_guild
    // beweist, dass der Server ihn erreicht hat, nicht guild_full).
    expect(result).toBe('already_in_guild');

    // Echter Beitritt eines neuen Spielers ueber den 21. (bonus-)Platz.
    const client21 = await (async () => {
      const email = emailFromName('QaSlotNewcomer');
      // Direkt in der Auth-Map registrieren (kein UI-Login noetig fuer
      // diesen reinen Server-Logik-Test).
      qaServer.store.authUsersByEmail.set(email, { id: 'qa-slot-newcomer', email, password: QA_PASSWORD, user_metadata: {} });
      return null;
    })();
    void client21;
    const joinResult = await rpcAs(qaServer, 'QaSlotNewcomer', 'join_guild', { p_guild_id: 'g1' });
    expect(joinResult).toBe(null); // join_guild() gibt "void" zurueck -> null
    expect(qaServer.store.tables.guilds.find(g => g.id === 'g1').member_count).toBe(21);
  });
});
