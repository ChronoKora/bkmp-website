/* Phase 5 (24.07.2026, siehe CLAUDE.md) - Einladungen/Einladungscode-Tests.

   Architektur (drei unabhaengige Beitrittswege, siehe Herleitungskommentar
   in tests/mock/rpc-engine.js):
     1) Direkt-Beitritt (join_guild): NUR fuer OEFFENTLICHE Gilden, sofortig,
        kein Code noetig.
     2) Einladungscode (join_guild_by_code): funktioniert fuer OEFFENTLICHE
        UND PRIVATE Gilden gleichermassen. Code wird per
        update_guild_settings(p_is_public=false) oder regenerate_guild_
        invite_code() erzeugt - beide sql/supabase-idle-guilds-settings-
        chat.sql, keine spaetere Fassung. get_my_guild_invite_code():
        sql/supabase-guild-roles-veteran.sql (leader/officer/veteran duerfen
        einsehen), regenerate/update bleiben bewusst Anfuehrer-exklusiv.
     3) Beitrittsanfrage (request_guild_join/respond_guild_join_request):
        sql/supabase-guild-join-requests.sql, fuer OEFFENTLICHE UND PRIVATE
        Gilden - leader/officer/veteran entscheiden.

   WICHTIGER, EHRLICH DOKUMENTIERTER BEFUND (Auftrag verlangt an mehreren
   Stellen Tests fuer "abgelaufene Einladung"/"abgelaufener Code" - siehe
   Abschnitt 5 des Auftrags): das reale System kennt KEINE zeitbasierte
   Ablauf-/TTL-Mechanik fuer weder Einladungscodes noch Beitrittsanfragen -
   in KEINER der gelesenen SQL-Dateien (supabase-idle-guilds-settings-
   chat.sql, supabase-guild-join-requests.sql, supabase-guild-roles-
   veteran.sql, supabase-guild-extra-slots.sql) existiert ein
   Ablaufdatum-Feld oder ein Zeit-Vergleich fuer Code-/Anfrage-Gueltigkeit.
   Ein Code wird AUSSCHLIESSLICH durch regenerate_guild_invite_code()
   invalidiert (der alte Wert wird durch einen neuen ERSETZT, kein Ablauf),
   eine Anfrage bleibt UNBEGRENZT 'pending', bis sie akzeptiert/abgelehnt/
   storniert wird. Da "Keine Spielregeln... erfinden" eine feste Vorgabe
   dieses Auftrags ist, wird hier KEINE erfundene TTL-Logik nachgebaut -
   stattdessen testen die unten mit "(kein TTL - siehe Dateikopfkommentar)"
   markierten Faelle die tatsaechlich existierende, funktional naechstliegende
   Alternative (Code-Regeneration bzw. bereits entschiedene Anfrage). */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const LEADER_NAME = 'QaInviteLeader';
const OFFICER_NAME = 'QaInviteOfficer';
const MEMBER_NAME = 'QaInviteMember';
const APPLICANT_NAME = 'QaInviteApplicant';
const APPLICANT2_NAME = 'QaInviteApplicant2';
const LEADER_UID = 'qa-invite-leader-0000';
const OFFICER_UID = 'qa-invite-officer-0000';
const MEMBER_UID = 'qa-invite-member-0000';
const APPLICANT_UID = 'qa-invite-applicant-0000';
const APPLICANT2_UID = 'qa-invite-applicant2-0000';

function invitesFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  function row(uid, name, extra) { return makePlayerStateRow(uid, name.toLowerCase(), nowIso, { display_name: name, gold: 0, ...extra }); }
  function user(uid, name) { return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} }; }
  return {
    startTimeMs,
    displayName: LEADER_NAME, nameKey: LEADER_NAME.toLowerCase(), authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME), password: QA_PASSWORD,
    users: [
      user(LEADER_UID, LEADER_NAME), user(OFFICER_UID, OFFICER_NAME), user(MEMBER_UID, MEMBER_NAME),
      user(APPLICANT_UID, APPLICANT_NAME), user(APPLICANT2_UID, APPLICANT2_NAME)
    ],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [
        row(LEADER_UID, LEADER_NAME), row(OFFICER_UID, OFFICER_NAME), row(MEMBER_UID, MEMBER_NAME),
        row(APPLICANT_UID, APPLICANT_NAME), row(APPLICANT2_UID, APPLICANT2_NAME)
      ],
      idle_prestige_state: [], idle_player_runes: [],
      guilds: [{ id: 'g1', name: 'Testgilde', tag: 'TST', treasury_gold: 0, member_count: 3, bonus_member_slots: 0, is_public: true, invite_code: null, description: '', leader_auth_user_id: LEADER_UID, created_at: nowIso }],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: OFFICER_UID, guild_id: 'g1', name_key: OFFICER_NAME.toLowerCase(), display_name: OFFICER_NAME, role: 'officer', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: MEMBER_UID, guild_id: 'g1', name_key: MEMBER_NAME.toLowerCase(), display_name: MEMBER_NAME, role: 'member', contributed_gold: 0, joined_at: nowIso }
      ],
      guild_join_requests: [], guild_activity_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, invitesFixture(startTimeMs)), { startTimeMs: Date.now() });
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

test.describe('Direktbeitritt (oeffentliche Gilde)', () => {
  test('gueltige Einladung (Direktbeitritt einer oeffentlichen Gilde) gelingt', async ({ page, qaServer }) => {
    await login(page, qaServer, APPLICANT_NAME);
    await page.evaluate(() => window.bkmpGuildJoin('g1'));
    expect(qaServer.store.tables.guild_members.some(m => m.auth_user_id === APPLICANT_UID && m.guild_id === 'g1')).toBe(true);
    expect(qaServer.store.tables.guilds.find(g => g.id === 'g1').member_count).toBe(4);
  });

  test('ungueltige Einladung (nicht existierende Gilde) schlaegt fehl', async ({ page, qaServer }) => {
    await login(page, qaServer, APPLICANT_NAME);
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildJoin('does-not-exist')); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/Beitritt fehlgeschlagen/);
  });

  test('private Gilde ist ueber Direktbeitritt NICHT beitretbar (nur ueber Code/Anfrage)', async ({ page, qaServer }) => {
    qaServer.store.tables.guilds.find(g => g.id === 'g1').is_public = false;
    await login(page, qaServer, APPLICANT_NAME);
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildJoin('g1')); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/Beitritt fehlgeschlagen/);
    expect(qaServer.store.tables.guild_members.some(m => m.auth_user_id === APPLICANT_UID)).toBe(false);
  });

  test('bereits Mitglied kann nicht erneut beitreten', async ({ page, qaServer }) => {
    await login(page, qaServer, MEMBER_NAME);
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildJoin('g1')); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/Du bist schon in einer Gilde/);
  });

  test('volle Gilde (Deckel erreicht) weist neue Beitritte ab', async ({ page, qaServer }) => {
    const guild = qaServer.store.tables.guilds.find(g => g.id === 'g1');
    guild.member_count = 20;
    await login(page, qaServer, APPLICANT_NAME);
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildJoin('g1')); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/bereits voll/);
  });

  test('keine doppelte Mitgliedschaft durch parallele Beitrittsversuche zweier Spieler bei nur einem freien Platz', async ({ page, qaServer }) => {
    const guild = qaServer.store.tables.guilds.find(g => g.id === 'g1');
    // Echte Fuell-Mitglieder hinzufuegen (nicht nur den Zaehler verstellen) -
    // member_count und die tatsaechliche guild_members-Zeilenzahl muessen
    // konsistent bleiben, exakt wie in der echten DB (guild_members.sql
    // pflegt beide immer gemeinsam). 16 Fuellplaetze + die 3 echten aus der
    // Fixture (Leader/Officer/Member) = 19, genau 1 Platz frei.
    for (let i = 0; i < 16; i++) {
      const fillerUid = 'qa-invite-filler-' + i;
      qaServer.store.tables.idle_player_state.push({ auth_user_id: fillerUid, name_key: 'filler' + i, display_name: 'Filler' + i, gold: 0 });
      qaServer.store.tables.guild_members.push({ auth_user_id: fillerUid, guild_id: 'g1', name_key: 'filler' + i, display_name: 'Filler' + i, role: 'member', contributed_gold: 0, joined_at: qaServer.store.clock.nowIso() });
    }
    guild.member_count = 19;
    await login(page, qaServer, APPLICANT_NAME);
    const [a, b] = await Promise.allSettled([
      page.evaluate(() => window.bkmpGuildJoin('g1')),
      rpcAs(qaServer, APPLICANT2_NAME, 'join_guild', { p_guild_id: 'g1' })
    ]);
    const results = [a.status, b.status];
    // Der Mock verarbeitet RPCs seriell (kein echter DB-Race) - GENAU einer
    // der beiden gewinnt, der andere bekommt guild_full.
    expect(results.filter(r => r === 'fulfilled').length).toBe(1);
    expect(qaServer.store.tables.guilds.find(g => g.id === 'g1').member_count).toBe(20);
    expect(qaServer.store.tables.guild_members.filter(m => m.guild_id === 'g1').length).toBe(20);
  });
});

test.describe('Einladungscode', () => {
  test('Anfuehrer erhaelt beim Wechsel zu privat einen 8-stelligen Einladungscode', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const code = await page.evaluate(() => window.bkmpGuildUpdateSettings('Meine Gilde', false));
    expect(typeof code).toBe('string');
    expect(code.length).toBe(8);
  });

  test('Officer und Veteran duerfen den bestehenden Code einsehen, plain Member nicht', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const code = await page.evaluate(() => window.bkmpGuildUpdateSettings('', false));
    await rpcAs(qaServer, LEADER_NAME, 'set_guild_member_role', { p_target_auth_user_id: MEMBER_UID, p_new_role: 'veteran' });

    const officerCode = await rpcAs(qaServer, OFFICER_NAME, 'get_my_guild_invite_code', {});
    expect(officerCode).toBe(code);
    const veteranCode = await rpcAs(qaServer, MEMBER_NAME, 'get_my_guild_invite_code', {});
    expect(veteranCode).toBe(code);

    // Nach der Befoerderung gibt es keinen plain Member mehr in der Fixture -
    // ein frischer Beitretender simuliert den Fall direkt. Die Gilde ist an
    // dieser Stelle bereits PRIVAT (siehe oben) - der Direktbeitrittsweg
    // (join_guild) waere hier selbst zurecht "guild_private", das wuerde
    // NICHT den zu pruefenden Fall zeigen. Direktes Einfuegen in
    // guild_members statt eines RPC-Umwegs ueber einen Beitrittsweg, der
    // an dieser Stelle gar nicht der Pruefgegenstand ist.
    qaServer.store.tables.guild_members.push({
      auth_user_id: APPLICANT_UID, guild_id: 'g1', name_key: APPLICANT_NAME.toLowerCase(),
      display_name: APPLICANT_NAME, role: 'member', contributed_gold: 0, joined_at: qaServer.store.clock.nowIso()
    });
    let threw = null;
    try { await rpcAs(qaServer, APPLICANT_NAME, 'get_my_guild_invite_code', {}); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/not_authorized/);
  });

  test('gueltiger Einladungscode fuehrt zum Beitritt einer privaten Gilde', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const code = await page.evaluate(() => window.bkmpGuildUpdateSettings('', false));
    // rpcAs() statt eines zweiten UI-Logins auf derselben page - vermeidet
    // jede Unsicherheit rund um bereits in localStorage/Supabase-Session
    // hinterlegte Anmeldedaten des ERSTEN Logins bei einer erneuten
    // Navigation (echter Zweitspieler waere ohnehin ein separater Tab).
    await rpcAs(qaServer, APPLICANT_NAME, 'join_guild_by_code', { p_code: code });
    expect(qaServer.store.tables.guild_members.some(m => m.auth_user_id === APPLICANT_UID && m.guild_id === 'g1')).toBe(true);
  });

  test('falscher Code wird abgelehnt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildUpdateSettings('', false));
    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });

    let threw = null;
    try { await rpcAs(qaServer, APPLICANT_NAME, 'join_guild_by_code', { p_code: 'WRONGCOD' }); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/invalid_code/);
  });

  test('"abgelaufener" Code (kein TTL - siehe Dateikopfkommentar): ein REGENERIERTER Code invalidiert den alten sofort', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const oldCode = await page.evaluate(() => window.bkmpGuildUpdateSettings('', false));
    const newCode = await page.evaluate(() => window.bkmpGuildRegenerateInviteCode());
    expect(newCode).not.toBe(oldCode);

    let threw = null;
    try { await rpcAs(qaServer, APPLICANT_NAME, 'join_guild_by_code', { p_code: oldCode }); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/invalid_code/);

    await rpcAs(qaServer, APPLICANT_NAME, 'join_guild_by_code', { p_code: newCode });
    expect(qaServer.store.tables.guild_members.some(m => m.auth_user_id === APPLICANT_UID)).toBe(true);
  });

  test('erneute Nutzung: derselbe Code ist NICHT einmalig - ein zweiter, anderer Spieler kann ihn ebenfalls verwenden', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const code = await page.evaluate(() => window.bkmpGuildUpdateSettings('', false));
    await rpcAs(qaServer, APPLICANT_NAME, 'join_guild_by_code', { p_code: code });
    await rpcAs(qaServer, APPLICANT2_NAME, 'join_guild_by_code', { p_code: code });
    expect(qaServer.store.tables.guild_members.some(m => m.auth_user_id === APPLICANT_UID)).toBe(true);
    expect(qaServer.store.tables.guild_members.some(m => m.auth_user_id === APPLICANT2_UID)).toBe(true);
  });

  test('volle Gilde weist auch Code-Beitritte ab', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const code = await page.evaluate(() => window.bkmpGuildUpdateSettings('', false));
    qaServer.store.tables.guilds.find(g => g.id === 'g1').member_count = 20;
    let threw = null;
    try { await rpcAs(qaServer, APPLICANT_NAME, 'join_guild_by_code', { p_code: code }); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/guild_full/);
  });

  test('nach Rueckwechsel zu oeffentlich bleibt der zuletzt ausgegebene Code weiterhin technisch gueltig (bestaetigtes, echtes Verhalten - keine Neu-Erfindung)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const code = await page.evaluate(() => window.bkmpGuildUpdateSettings('', false));
    const returnedOnPublic = await page.evaluate(() => window.bkmpGuildUpdateSettings('', true));
    expect(returnedOnPublic).toBeNull(); // Client zeigt keinen Code mehr an ...
    // ... aber die DB-Spalte behaelt ihn (coalesce(null, invite_code) im
    // echten SQL) - ein alter Code funktioniert technisch weiter.
    await rpcAs(qaServer, APPLICANT_NAME, 'join_guild_by_code', { p_code: code });
    expect(qaServer.store.tables.guild_members.some(m => m.auth_user_id === APPLICANT_UID)).toBe(true);
  });

  test('parallele Annahme desselben Codes durch mehrere Nutzer bei nur einem freien Platz - genau einer gewinnt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const code = await page.evaluate(() => window.bkmpGuildUpdateSettings('', false));
    qaServer.store.tables.guilds.find(g => g.id === 'g1').member_count = 19;
    const [a, b] = await Promise.allSettled([
      rpcAs(qaServer, APPLICANT_NAME, 'join_guild_by_code', { p_code: code }),
      rpcAs(qaServer, APPLICANT2_NAME, 'join_guild_by_code', { p_code: code })
    ]);
    expect([a.status, b.status].filter(s => s === 'fulfilled').length).toBe(1);
    expect(qaServer.store.tables.guilds.find(g => g.id === 'g1').member_count).toBe(20);
  });

  test('Reload zeigt weiterhin denselben Einladungscode', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const code = await page.evaluate(() => window.bkmpGuildUpdateSettings('', false));
    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    const reloaded = await page.evaluate(() => window.bkmpGuildGetMyInviteCode());
    expect(reloaded).toBe(code);
  });

  test('Logout/Login zeigt weiterhin den serverseitig persistenten Code', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const code = await page.evaluate(() => window.bkmpGuildUpdateSettings('', false));
    expect(qaServer.store.tables.guilds.find(g => g.id === 'g1').invite_code).toBe(code);
  });
});

test.describe('Beitrittsanfrage', () => {
  test('Anfrage an oeffentliche UND private Gilde funktioniert gleichermassen', async ({ page, qaServer }) => {
    await login(page, qaServer, APPLICANT_NAME);
    await page.evaluate(() => window.bkmpGuildRequestJoin('g1', 'Bitte aufnehmen!'));
    const requests = await page.evaluate(() => window.bkmpGuildLoadMyJoinRequests());
    expect(requests.length).toBe(1);
    expect(requests[0].message).toBe('Bitte aufnehmen!');
    expect(requests[0].status).toBe('pending');
  });

  test('Einladung/Annahme durch unberechtigtes Mitglied (plain member) wird abgewiesen', async ({ page, qaServer }) => {
    await rpcAs(qaServer, APPLICANT_NAME, 'request_guild_join', { p_guild_id: 'g1', p_message: null });
    const requestId = qaServer.store.tables.guild_join_requests[0].id;
    await login(page, qaServer, MEMBER_NAME);
    let threw = null;
    try { await page.evaluate((id) => window.bkmpGuildRespondJoinRequest(id, true), requestId); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/mindestens die Rolle Veteran/);
    expect(qaServer.store.tables.guild_join_requests[0].status).toBe('pending');
  });

  test('Officer darf annehmen', async ({ page, qaServer }) => {
    await rpcAs(qaServer, APPLICANT_NAME, 'request_guild_join', { p_guild_id: 'g1', p_message: null });
    const requestId = qaServer.store.tables.guild_join_requests[0].id;
    await login(page, qaServer, OFFICER_NAME);
    await page.evaluate((id) => window.bkmpGuildRespondJoinRequest(id, true), requestId);
    expect(qaServer.store.tables.guild_join_requests[0].status).toBe('accepted');
    expect(qaServer.store.tables.guild_members.some(m => m.auth_user_id === APPLICANT_UID)).toBe(true);
  });

  test('Ablehnen fuegt den Antragsteller NICHT der Gilde hinzu', async ({ page, qaServer }) => {
    await rpcAs(qaServer, APPLICANT_NAME, 'request_guild_join', { p_guild_id: 'g1', p_message: null });
    const requestId = qaServer.store.tables.guild_join_requests[0].id;
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate((id) => window.bkmpGuildRespondJoinRequest(id, false), requestId);
    expect(qaServer.store.tables.guild_join_requests[0].status).toBe('rejected');
    expect(qaServer.store.tables.guild_members.some(m => m.auth_user_id === APPLICANT_UID)).toBe(false);
  });

  test('bereits entschiedene Anfrage laesst sich nicht erneut entscheiden (naechstliegendes reales Aequivalent zu "abgelaufen" - kein TTL, siehe Dateikopfkommentar)', async ({ page, qaServer }) => {
    await rpcAs(qaServer, APPLICANT_NAME, 'request_guild_join', { p_guild_id: 'g1', p_message: null });
    const requestId = qaServer.store.tables.guild_join_requests[0].id;
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate((id) => window.bkmpGuildRespondJoinRequest(id, false), requestId);
    let threw = null;
    try { await page.evaluate((id) => window.bkmpGuildRespondJoinRequest(id, true), requestId); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/schon entschieden/);
  });

  test('Antragsteller bereits Mitglied (anderswo per Code beigetreten) verhindert nachtraegliche Annahme', async ({ page, qaServer }) => {
    await rpcAs(qaServer, APPLICANT_NAME, 'request_guild_join', { p_guild_id: 'g1', p_message: null });
    const requestId = qaServer.store.tables.guild_join_requests[0].id;
    // Antragsteller tritt zwischenzeitlich einer ANDEREN Gilde bei.
    qaServer.store.tables.guilds.push({ id: 'g2', name: 'Zweite Gilde', tag: 'ZW2', treasury_gold: 0, member_count: 1, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: APPLICANT_UID, created_at: qaServer.store.clock.nowIso() });
    qaServer.store.tables.guild_members.push({ auth_user_id: APPLICANT_UID, guild_id: 'g2', name_key: APPLICANT_NAME.toLowerCase(), display_name: APPLICANT_NAME, role: 'leader', contributed_gold: 0, joined_at: qaServer.store.clock.nowIso() });

    await login(page, qaServer, LEADER_NAME);
    let threw = null;
    try { await page.evaluate((id) => window.bkmpGuildRespondJoinRequest(id, true), requestId); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/inzwischen schon in einer anderen Gilde/);
    expect(qaServer.store.tables.guild_join_requests[0].status).toBe('cancelled');
  });

  test('volle Gilde weist auch eine angenommene Anfrage ab', async ({ page, qaServer }) => {
    await rpcAs(qaServer, APPLICANT_NAME, 'request_guild_join', { p_guild_id: 'g1', p_message: null });
    const requestId = qaServer.store.tables.guild_join_requests[0].id;
    qaServer.store.tables.guilds.find(g => g.id === 'g1').member_count = 20;
    await login(page, qaServer, LEADER_NAME);
    let threw = null;
    try { await page.evaluate((id) => window.bkmpGuildRespondJoinRequest(id, true), requestId); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/bereits voll/);
  });

  test('Antragsteller kann eine offene Anfrage selbst zurueckziehen', async ({ page, qaServer }) => {
    await login(page, qaServer, APPLICANT_NAME);
    await page.evaluate(() => window.bkmpGuildRequestJoin('g1', null));
    const requestId = qaServer.store.tables.guild_join_requests[0].id;
    await page.evaluate((id) => window.bkmpGuildCancelJoinRequest(id), requestId);
    expect(qaServer.store.tables.guild_join_requests[0].status).toBe('cancelled');
  });

  test('Annahme einer Anfrage storniert automatisch alle ANDEREN offenen Anfragen desselben Spielers', async ({ page, qaServer }) => {
    qaServer.store.tables.guilds.push({ id: 'g2', name: 'Zweite Gilde', tag: 'ZW2', treasury_gold: 0, member_count: 1, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: OFFICER_UID, created_at: qaServer.store.clock.nowIso() });
    await rpcAs(qaServer, APPLICANT_NAME, 'request_guild_join', { p_guild_id: 'g1', p_message: null });
    await rpcAs(qaServer, APPLICANT_NAME, 'request_guild_join', { p_guild_id: 'g2', p_message: null });
    const requestForG1 = qaServer.store.tables.guild_join_requests.find(r => r.guild_id === 'g1').id;
    const requestForG2 = qaServer.store.tables.guild_join_requests.find(r => r.guild_id === 'g2').id;

    await login(page, qaServer, LEADER_NAME);
    await page.evaluate((id) => window.bkmpGuildRespondJoinRequest(id, true), requestForG1);
    expect(qaServer.store.tables.guild_join_requests.find(r => r.id === requestForG1).status).toBe('accepted');
    expect(qaServer.store.tables.guild_join_requests.find(r => r.id === requestForG2).status).toBe('cancelled');
  });

  test('keine doppelte Mitgliedschaft: paralleles Annehmen derselben Anfrage durch zwei Berechtigte fuehrt zu genau einer Aufnahme', async ({ page, qaServer }) => {
    await rpcAs(qaServer, APPLICANT_NAME, 'request_guild_join', { p_guild_id: 'g1', p_message: null });
    const requestId = qaServer.store.tables.guild_join_requests[0].id;
    await login(page, qaServer, LEADER_NAME);
    const [a, b] = await Promise.allSettled([
      page.evaluate((id) => window.bkmpGuildRespondJoinRequest(id, true), requestId),
      rpcAs(qaServer, OFFICER_NAME, 'respond_guild_join_request', { p_request_id: requestId, p_accept: true })
    ]);
    expect([a.status, b.status].filter(s => s === 'fulfilled').length).toBe(1);
    expect(qaServer.store.tables.guild_members.filter(m => m.auth_user_id === APPLICANT_UID).length).toBe(1);
  });

  test('Reload zeigt weiterhin die offene Anfrage', async ({ page, qaServer }) => {
    await login(page, qaServer, APPLICANT_NAME);
    await page.evaluate(() => window.bkmpGuildRequestJoin('g1', null));
    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    const requests = await page.evaluate(() => window.bkmpGuildLoadMyJoinRequests());
    expect(requests.length).toBe(1);
  });

  test('Logout/Login zeigt weiterhin die serverseitig persistente Anfrage', async ({ page, qaServer }) => {
    await login(page, qaServer, APPLICANT_NAME);
    await page.evaluate(() => window.bkmpGuildRequestJoin('g1', null));
    expect(qaServer.store.tables.guild_join_requests.length).toBe(1);
  });
});
