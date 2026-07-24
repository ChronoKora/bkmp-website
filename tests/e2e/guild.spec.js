/* Phase 3 (24.07.2026, siehe CLAUDE.md) - Gilde-Kernmechanik-Tests. Schliesst
   die zweite in Phase 2 dokumentierte RPC-Mock-Luecke (siehe
   tests/FEATURE_MATRIX.md: "Gilde... keiner [Test]... Gilden-Fixture fehlt").
   Deckt Gruenden/Beitreten(oeffentlich)/Beitrittsanfrage(privat)/Verlassen/
   Rauswerfen/Rollen ab - siehe rpc-engine.js's Kommentar am Gilde-Abschnitt
   fuer die exakten SQL-Quellen und den bewusst NICHT portierten Rest
   (Einladecodes/Chat/Platzkauf/Technologie/Quests/Gildenboss).

   Mehrspieler-Szenarien (z.B. "Offizier nimmt eine Anfrage an") brauchen
   einen ZWEITEN echten Akteur gleichzeitig - statt eines zweiten Browser-Tabs
   wird dafuer per rpcAs() ein roher Auth+RPC-Aufruf fuer den anderen Spieler
   gemacht (eigener Login-Roundtrip gegen denselben Mock, dieselbe RPC-Engine
   wie der Browser sie auch trifft - kein Test-Doppelpfad). */

/* test/expect/createQaServer kommen seit der Sicherheitsverstaerkung
   (24.07.2026, siehe CLAUDE.md) aus network-guard.js: globale Netzwerksperre
   + zentraler createQaServer()-Baustein statt des vorher hier lokal
   nachgebauten createStore/seedStore/createTestServer-Aufbaus. */
const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady } = require('../helpers/qa-fixtures');

const LEADER_UID = 'qa-guild-leader-0000';
const LEADER_NAME = 'QaGuildLead';
const JOINER_UID = 'qa-guild-joiner-0000';
const JOINER_NAME = 'QaGuildJoin';
const OFFICER_UID = 'qa-guild-officer-0000';
const OFFICER_NAME = 'QaGuildOff';
const POOR_UID = 'qa-guild-poor-0000';
const POOR_NAME = 'QaGuildPoor';

function guildFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  function row(uid, name, gold) {
    return makePlayerStateRow(uid, name.toLowerCase(), nowIso, { display_name: name, level: 20, gold });
  }
  function user(uid, name) {
    return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} };
  }
  return {
    startTimeMs,
    displayName: LEADER_NAME,
    nameKey: LEADER_NAME.toLowerCase(),
    authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME),
    password: QA_PASSWORD,
    users: [
      user(LEADER_UID, LEADER_NAME), user(JOINER_UID, JOINER_NAME),
      user(OFFICER_UID, OFFICER_NAME), user(POOR_UID, POOR_NAME)
    ],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [
        row(LEADER_UID, LEADER_NAME, 600000),
        row(JOINER_UID, JOINER_NAME, 1000),
        row(OFFICER_UID, OFFICER_NAME, 600000),
        row(POOR_UID, POOR_NAME, 100) // zu wenig fuer die 500k-Gruendungskosten
      ],
      idle_prestige_state: [],
      idle_player_runes: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, guildFixture(startTimeMs)));
    await use(server);
    await server.close();
  }
});

async function login(page, qaServer, name) {
  await page.goto(qaServer.url('/'));
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
}

/* Roher Auth+RPC-Aufruf fuer einen ANDEREN Spieler als den im Browser
   eingeloggten - siehe Datei-Kommentar oben. */
async function rpcAs(qaServer, name, fnName, params) {
  const email = emailFromName(name);
  const tokenRes = await fetch(`${qaServer.baseURL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: QA_PASSWORD })
  });
  const tokenJson = await tokenRes.json();
  const token = tokenJson.access_token;
  const rpcRes = await fetch(`${qaServer.baseURL}/rest/v1/rpc/${fnName}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params || {})
  });
  const json = await rpcRes.json().catch(() => null);
  if (rpcRes.status >= 400) { const err = new Error(json && json.message); throw err; }
  return json;
}

test.describe('Gilde - Kernmechanik', () => {
  test('Gruenden kostet 500k Gold, das direkt als Gildenkasse startet', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const guildId = await page.evaluate(() => window.bkmpGuildCreate('Testgilde', 'TST'));
    expect(guildId).toBeTruthy();
    const guild = qaServer.store.tables.guilds.find(g => g.id === guildId);
    expect(guild.treasury_gold).toBe(500000);
    expect(guild.member_count).toBe(1);
    const leaderState = qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === LEADER_UID);
    expect(leaderState.gold).toBe(600000 - 500000);
    const member = qaServer.store.tables.guild_members.find(m => m.auth_user_id === LEADER_UID);
    expect(member.role).toBe('leader');
  });

  test('Gruenden ohne genug Gold schlaegt fehl', async ({ page, qaServer }) => {
    await login(page, qaServer, POOR_NAME);
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildCreate('Armegilde', 'ARM')); } catch (e) { threw = String(e.message || e); }
    expect(threw).toContain('500.000 Gold');
  });

  test('Zweite Gruendung mit demselben Namen schlaegt fehl', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildCreate('Doppelname', 'DUP'));
    await rpcAs(qaServer, JOINER_NAME, 'leave_guild', {}).catch(() => {}); // no-op, sicherstellen dass Joiner nicht in Gilde ist
    let threw = null;
    try {
      await rpcAs(qaServer, OFFICER_NAME, 'create_guild', { p_name: 'Doppelname', p_tag: 'DU2' });
    } catch (e) { threw = String(e.message || e); }
    expect(threw).toContain('name_taken');
  });

  test('Beitritt zu einer oeffentlichen Gilde funktioniert direkt ohne Anfrage', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const guildId = await page.evaluate(() => window.bkmpGuildCreate('Offene Gilde', 'OFN'));
    await rpcAs(qaServer, JOINER_NAME, 'join_guild', { p_guild_id: guildId });
    const guild = qaServer.store.tables.guilds.find(g => g.id === guildId);
    expect(guild.member_count).toBe(2);
    const joinerMember = qaServer.store.tables.guild_members.find(m => m.auth_user_id === JOINER_UID);
    expect(joinerMember.role).toBe('member');
  });

  test('Beitritt zu einer privaten Gilde ohne Anfrage schlaegt fehl', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const guildId = await page.evaluate(() => window.bkmpGuildCreate('Private Gilde', 'PRV'));
    qaServer.store.tables.guilds.find(g => g.id === guildId).is_public = false;
    let threw = null;
    try { await rpcAs(qaServer, JOINER_NAME, 'join_guild', { p_guild_id: guildId }); } catch (e) { threw = String(e.message || e); }
    expect(threw).toContain('guild_private');
  });

  test('Beitrittsanfrage: stellen, vom Anfuehrer annehmen, Mitgliedschaft entsteht', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const guildId = await page.evaluate(() => window.bkmpGuildCreate('Anfragegilde', 'ANF'));
    await rpcAs(qaServer, JOINER_NAME, 'request_guild_join', { p_guild_id: guildId, p_message: 'Bitte aufnehmen!' });
    const request = qaServer.store.tables.guild_join_requests.find(r => r.guild_id === guildId && r.auth_user_id === JOINER_UID);
    expect(request.status).toBe('pending');

    await page.evaluate((reqId) => window.bkmpGuildRespondJoinRequest(reqId, true), request.id);
    expect(request.status).toBe('accepted');
    const guild = qaServer.store.tables.guilds.find(g => g.id === guildId);
    expect(guild.member_count).toBe(2);
  });

  test('Beitrittsanfrage ablehnen erzeugt keine Mitgliedschaft', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const guildId = await page.evaluate(() => window.bkmpGuildCreate('Ablehngilde', 'ABL'));
    await rpcAs(qaServer, JOINER_NAME, 'request_guild_join', { p_guild_id: guildId });
    const request = qaServer.store.tables.guild_join_requests.find(r => r.guild_id === guildId);

    await page.evaluate((reqId) => window.bkmpGuildRespondJoinRequest(reqId, false), request.id);
    expect(request.status).toBe('rejected');
    const guild = qaServer.store.tables.guilds.find(g => g.id === guildId);
    expect(guild.member_count).toBe(1);
  });

  test('Normales Mitglied darf keine Beitrittsanfrage annehmen', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const guildId = await page.evaluate(() => window.bkmpGuildCreate('Rechtegilde', 'RGL'));
    await rpcAs(qaServer, JOINER_NAME, 'join_guild', { p_guild_id: guildId }); // normales Mitglied
    await rpcAs(qaServer, POOR_NAME, 'request_guild_join', { p_guild_id: guildId });
    const request = qaServer.store.tables.guild_join_requests.find(r => r.guild_id === guildId);
    let threw = null;
    try { await rpcAs(qaServer, JOINER_NAME, 'respond_guild_join_request', { p_request_id: request.id, p_accept: true }); } catch (e) { threw = String(e.message || e); }
    expect(threw).toContain('not_authorized');
  });

  test('Anfuehrer befoerdert ein Mitglied zum Offizier, der danach selbst Anfragen annehmen darf', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const guildId = await page.evaluate(() => window.bkmpGuildCreate('Befoerdergilde', 'BEF'));
    await rpcAs(qaServer, JOINER_NAME, 'join_guild', { p_guild_id: guildId });
    await page.evaluate((uid) => window.bkmpGuildSetMemberRole(uid, 'officer'), JOINER_UID);
    expect(qaServer.store.tables.guild_members.find(m => m.auth_user_id === JOINER_UID).role).toBe('officer');

    await rpcAs(qaServer, POOR_NAME, 'request_guild_join', { p_guild_id: guildId });
    const request = qaServer.store.tables.guild_join_requests.find(r => r.guild_id === guildId && r.auth_user_id === POOR_UID);
    await rpcAs(qaServer, JOINER_NAME, 'respond_guild_join_request', { p_request_id: request.id, p_accept: true });
    expect(qaServer.store.tables.guild_join_requests.find(r => r.id === request.id).status).toBe('accepted');
  });

  test('Anfuehrer kann nicht rausgeworfen werden (auch nicht von einem Offizier)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const guildId = await page.evaluate(() => window.bkmpGuildCreate('Unwerfbargilde', 'UNW'));
    await rpcAs(qaServer, OFFICER_NAME, 'join_guild', { p_guild_id: guildId });
    await page.evaluate((uid) => window.bkmpGuildSetMemberRole(uid, 'officer'), OFFICER_UID);

    let threw = null;
    try { await rpcAs(qaServer, OFFICER_NAME, 'kick_guild_member', { p_target_auth_user_id: LEADER_UID }); } catch (e) { threw = String(e.message || e); }
    expect(threw).toContain('cannot_kick_leader');
  });

  test('Offizier kann ein normales Mitglied rauswerfen', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const guildId = await page.evaluate(() => window.bkmpGuildCreate('Rauswurfgilde', 'RAU'));
    await rpcAs(qaServer, JOINER_NAME, 'join_guild', { p_guild_id: guildId });
    await rpcAs(qaServer, OFFICER_NAME, 'join_guild', { p_guild_id: guildId });
    await page.evaluate((uid) => window.bkmpGuildSetMemberRole(uid, 'officer'), OFFICER_UID);

    await rpcAs(qaServer, OFFICER_NAME, 'kick_guild_member', { p_target_auth_user_id: JOINER_UID });
    expect(qaServer.store.tables.guild_members.find(m => m.auth_user_id === JOINER_UID)).toBeUndefined();
    expect(qaServer.store.tables.guilds.find(g => g.id === guildId).member_count).toBe(2);
  });

  test('Verlassen als letztes Mitglied loescht die Gilde', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const guildId = await page.evaluate(() => window.bkmpGuildCreate('Einsamgilde', 'EIN'));
    await page.evaluate(() => window.bkmpGuildLeave());
    expect(qaServer.store.tables.guilds.find(g => g.id === guildId)).toBeUndefined();
    expect(qaServer.store.tables.guild_members.find(m => m.guild_id === guildId)).toBeUndefined();
  });

  test('Verlassen als Anfuehrer uebergibt die Fuehrung an das laengst dienende verbleibende Mitglied', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const guildId = await page.evaluate(() => window.bkmpGuildCreate('Erbfolgegilde', 'ERB'));
    await rpcAs(qaServer, JOINER_NAME, 'join_guild', { p_guild_id: guildId });
    qaServer.store.clock.advance(1000);
    await rpcAs(qaServer, OFFICER_NAME, 'join_guild', { p_guild_id: guildId }); // spaeter beigetreten als JOINER

    await page.evaluate(() => window.bkmpGuildLeave());

    const guild = qaServer.store.tables.guilds.find(g => g.id === guildId);
    expect(guild.leader_auth_user_id).toBe(JOINER_UID); // laenger dabei als OFFICER
    expect(qaServer.store.tables.guild_members.find(m => m.auth_user_id === JOINER_UID).role).toBe('leader');
    expect(guild.member_count).toBe(2);
  });

  test('Gildenbeitrag fliesst von Spieler-Gold in die Gildenkasse', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildCreate('Spendengilde', 'SPD'));
    const goldBefore = qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === LEADER_UID).gold;
    await page.evaluate(() => window.bkmpGuildContribute(1000));
    const goldAfter = qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === LEADER_UID).gold;
    expect(goldAfter).toBe(goldBefore - 1000);
  });
});
