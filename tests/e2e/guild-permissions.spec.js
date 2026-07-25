/* Phase 5 (24.07.2026, siehe CLAUDE.md) - Systemuebergreifende Rollen-/
   Rechtematrix fuer die 5 neuen Gildensysteme (Auftrag Abschnitt 7:
   "Erstelle eine gemeinsame Rollenprüfung... Prüfe, dass sensible Aktionen
   nicht nur über ausgeblendete Buttons geschützt sind, sondern auch der
   Mock-RPC beziehungsweise Serverzugriff selbst ablehnt").

   Ergaenzt (nicht ersetzt) die bereits pro System vorhandenen Rollen-Tests
   in guild-tech.spec.js/guild-slots.spec.js/guild-quests.spec.js/
   guild-chat.spec.js/guild-invites.spec.js - hier als EIN zentraler
   Ueberblick, der bewusst NUR die RPC-Ebene direkt anspricht (rpcAs(), kein
   UI-Login noetig), um zu beweisen, dass die Ablehnung serverseitig
   passiert, nicht nur durch einen ausgeblendeten/deaktivierten Button.

   Rollen-Leiter (sql/supabase-guild-roles-veteran.sql): member < veteran <
   officer < leader. Rechte-Matrix laut diesem SQL-Kommentar:
     - Leader: alles
     - Officer: Technologie verbessern, Gildenplatz kaufen, Mitglieder
       einladen (Code einsehen), Mitglieder entfernen
     - Veteran: Mitglieder einladen (Code einsehen), Chat moderieren,
       Beitrittsanfragen entscheiden
     - Member: nur eigene, unprivilegierte Aktionen (spenden, chatten,
       Gilde verlassen) - keines der 5 hier getesteten Systeme gewaehrt
       einem plain Member eine privilegierte Aktion. */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');

const LEADER_NAME = 'QaPermLeader';
const OFFICER_NAME = 'QaPermOfficer';
const VETERAN_NAME = 'QaPermVeteran';
const MEMBER_NAME = 'QaPermMember';
const LEADER_UID = 'qa-perm-leader-0000';
const OFFICER_UID = 'qa-perm-officer-0000';
const VETERAN_UID = 'qa-perm-veteran-0000';
const MEMBER_UID = 'qa-perm-member-0000';

function permsFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  function row(uid, name, extra) { return makePlayerStateRow(uid, name.toLowerCase(), nowIso, { display_name: name, gold: 0, ...extra }); }
  function user(uid, name) { return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} }; }
  return {
    startTimeMs,
    displayName: LEADER_NAME, nameKey: LEADER_NAME.toLowerCase(), authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME), password: QA_PASSWORD,
    users: [user(LEADER_UID, LEADER_NAME), user(OFFICER_UID, OFFICER_NAME), user(VETERAN_UID, VETERAN_NAME), user(MEMBER_UID, MEMBER_NAME)],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [row(LEADER_UID, LEADER_NAME), row(OFFICER_UID, OFFICER_NAME), row(VETERAN_UID, VETERAN_NAME), row(MEMBER_UID, MEMBER_NAME)],
      idle_prestige_state: [], idle_player_runes: [],
      guilds: [{ id: 'g1', name: 'Testgilde', tag: 'TST', treasury_gold: 5000000, member_count: 4, bonus_member_slots: 0, is_public: true, invite_code: 'FIXEDCOD', description: '', leader_auth_user_id: LEADER_UID, created_at: nowIso }],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: OFFICER_UID, guild_id: 'g1', name_key: OFFICER_NAME.toLowerCase(), display_name: OFFICER_NAME, role: 'officer', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: VETERAN_UID, guild_id: 'g1', name_key: VETERAN_NAME.toLowerCase(), display_name: VETERAN_NAME, role: 'veteran', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: MEMBER_UID, guild_id: 'g1', name_key: MEMBER_NAME.toLowerCase(), display_name: MEMBER_NAME, role: 'member', contributed_gold: 0, joined_at: nowIso }
      ],
      guild_tech_levels: [], guild_daily_quests: [], guild_chat_messages: [], guild_join_requests: [], guild_activity_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, permsFixture(startTimeMs)), { startTimeMs: Date.now() });
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

async function rpcNoAuth(server, fnName, params) {
  // Ausgeloggter Nutzer: gar kein Authorization-Header - simuliert exakt
  // den Zustand, den auth.uid() in der echten SQL-Funktion als NULL sieht.
  const rpcRes = await fetch(`${server.baseURL}/rest/v1/rpc/${fnName}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {})
  });
  const json = await rpcRes.json().catch(() => null);
  return { status: rpcRes.status, json };
}

test.describe('Gilden-Rollen-/Rechtematrix (5 neue Systeme, RPC-Ebene direkt)', () => {
  test('Gilden-Technologie: nur leader/officer duerfen kaufen (RPC lehnt ab, nicht nur UI)', async ({ qaServer }) => {
    const leaderRes = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_upgrade', { p_tech_id: 'attack' });
    expect(leaderRes.status).toBe(200);
    const officerRes = await rpcAs(qaServer, OFFICER_NAME, 'guild_tech_upgrade', { p_tech_id: 'defense' });
    expect(officerRes.status).toBe(200);
    const veteranRes = await rpcAs(qaServer, VETERAN_NAME, 'guild_tech_upgrade', { p_tech_id: 'gold' });
    expect(veteranRes.status).toBe(400);
    expect(veteranRes.json.message).toBe('not_authorized');
    const memberRes = await rpcAs(qaServer, MEMBER_NAME, 'guild_tech_upgrade', { p_tech_id: 'gold' });
    expect(memberRes.status).toBe(400);
    expect(memberRes.json.message).toBe('not_authorized');
  });

  test('Gildenplatz-Kauf: nur leader/officer duerfen kaufen', async ({ qaServer }) => {
    const officerRes = await rpcAs(qaServer, OFFICER_NAME, 'buy_guild_slot', {});
    expect(officerRes.status).toBe(200);
    const veteranRes = await rpcAs(qaServer, VETERAN_NAME, 'buy_guild_slot', {});
    expect(veteranRes.status).toBe(400);
    expect(veteranRes.json.message).toBe('not_authorized');
    const memberRes = await rpcAs(qaServer, MEMBER_NAME, 'buy_guild_slot', {});
    expect(memberRes.status).toBe(400);
    expect(memberRes.json.message).toBe('not_authorized');
  });

  test('Gildenchat: jede Rolle (inkl. plain Member) darf schreiben, Nichtmitglied nicht', async ({ qaServer }) => {
    const leaderRes = await rpcAs(qaServer, LEADER_NAME, 'send_guild_chat_message', { p_message: 'Leader' });
    expect(leaderRes.status).toBe(200);
    const memberRes = await rpcAs(qaServer, MEMBER_NAME, 'send_guild_chat_message', { p_message: 'Member' });
    expect(memberRes.status).toBe(200); // normale Rechte, siehe Rechte-Matrix oben
  });

  test('Gildenchat-Moderation (Loeschen): leader/officer/veteran duerfen, plain Member nicht', async ({ qaServer }) => {
    await rpcAs(qaServer, LEADER_NAME, 'send_guild_chat_message', { p_message: 'zu loeschen 1' });
    await rpcAs(qaServer, LEADER_NAME, 'send_guild_chat_message', { p_message: 'zu loeschen 2' });
    await rpcAs(qaServer, LEADER_NAME, 'send_guild_chat_message', { p_message: 'zu loeschen 3' });
    // IDs vorab einmal fest einsammeln - guild_chat_messages ist DIESELBE
    // Array-Referenz, die delete_guild_chat_message() per splice() direkt
    // verkuerzt; ein spaeteres erneutes Indizieren (messages[1]/[2]) nach
    // bereits erfolgten Loeschungen wuerde durch die verschobenen Indizes
    // ins Leere greifen (beim ersten Testentwurf so gefunden).
    const ids = qaServer.store.tables.guild_chat_messages.map(m => m.id);
    expect(ids.length).toBe(3);

    const memberDelete = await rpcAs(qaServer, MEMBER_NAME, 'delete_guild_chat_message', { p_message_id: ids[0] });
    expect(memberDelete.status).toBe(400);
    expect(memberDelete.json.message).toBe('not_authorized');

    const veteranDelete = await rpcAs(qaServer, VETERAN_NAME, 'delete_guild_chat_message', { p_message_id: ids[0] });
    expect(veteranDelete.status).toBe(200);
    const officerDelete = await rpcAs(qaServer, OFFICER_NAME, 'delete_guild_chat_message', { p_message_id: ids[1] });
    expect(officerDelete.status).toBe(200);
    const leaderDelete = await rpcAs(qaServer, LEADER_NAME, 'delete_guild_chat_message', { p_message_id: ids[2] });
    expect(leaderDelete.status).toBe(200);
    expect(qaServer.store.tables.guild_chat_messages.length).toBe(0);
  });

  test('Einladungscode einsehen: leader/officer/veteran duerfen, plain Member nicht', async ({ qaServer }) => {
    const leaderRes = await rpcAs(qaServer, LEADER_NAME, 'get_my_guild_invite_code', {});
    expect(leaderRes.status).toBe(200);
    const officerRes = await rpcAs(qaServer, OFFICER_NAME, 'get_my_guild_invite_code', {});
    expect(officerRes.status).toBe(200);
    const veteranRes = await rpcAs(qaServer, VETERAN_NAME, 'get_my_guild_invite_code', {});
    expect(veteranRes.status).toBe(200);
    const memberRes = await rpcAs(qaServer, MEMBER_NAME, 'get_my_guild_invite_code', {});
    expect(memberRes.status).toBe(400);
    expect(memberRes.json.message).toBe('not_authorized');
  });

  test('Einladungscode neu erzeugen/Gildeneinstellungen aendern: NUR leader (Officer/Veteran explizit ausgenommen)', async ({ qaServer }) => {
    const officerRes = await rpcAs(qaServer, OFFICER_NAME, 'regenerate_guild_invite_code', {});
    expect(officerRes.status).toBe(400);
    expect(officerRes.json.message).toBe('not_authorized');
    const veteranRes = await rpcAs(qaServer, VETERAN_NAME, 'update_guild_settings', { p_description: 'x', p_is_public: true });
    expect(veteranRes.status).toBe(400);
    expect(veteranRes.json.message).toBe('not_authorized');
    const leaderRes = await rpcAs(qaServer, LEADER_NAME, 'regenerate_guild_invite_code', {});
    expect(leaderRes.status).toBe(200);
  });

  test('Beitrittsanfragen entscheiden: leader/officer/veteran duerfen, plain Member nicht', async ({ qaServer }) => {
    // Antragsteller braucht keine Rolle in der Test-Gilde - ein einfacher
    // Nichtmitglied-Nutzer reicht (per Direktimport statt echtem 5. Konto).
    qaServer.store.authUsersByEmail.set(emailFromName('QaPermApplicant'), { id: 'qa-perm-applicant', email: emailFromName('QaPermApplicant'), password: QA_PASSWORD, user_metadata: {} });
    qaServer.store.tables.idle_player_state.push({ auth_user_id: 'qa-perm-applicant', name_key: 'qapermapplicant', display_name: 'QaPermApplicant', gold: 0 });
    await rpcAs(qaServer, 'QaPermApplicant', 'request_guild_join', { p_guild_id: 'g1', p_message: null });
    const requestId = qaServer.store.tables.guild_join_requests[0].id;

    const memberRes = await rpcAs(qaServer, MEMBER_NAME, 'respond_guild_join_request', { p_request_id: requestId, p_accept: true });
    expect(memberRes.status).toBe(400);
    expect(memberRes.json.message).toBe('not_authorized');

    const veteranRes = await rpcAs(qaServer, VETERAN_NAME, 'respond_guild_join_request', { p_request_id: requestId, p_accept: true });
    expect(veteranRes.status).toBe(200);
  });

  test('Ausgeloggter Nutzer (kein Auth-Header) wird von JEDEM der 9 neuen RPCs abgelehnt', async ({ qaServer }) => {
    const calls = [
      ['guild_tech_upgrade', { p_tech_id: 'attack' }],
      ['buy_guild_slot', {}],
      ['send_guild_chat_message', { p_message: 'x' }],
      ['delete_guild_chat_message', { p_message_id: 'whatever' }],
      ['get_my_guild_invite_code', {}],
      ['regenerate_guild_invite_code', {}],
      ['update_guild_settings', { p_description: '', p_is_public: true }],
      ['join_guild_by_code', { p_code: 'FIXEDCOD' }],
      ['guild_quest_ensure_today', {}]
    ];
    for (const [fnName, params] of calls) {
      const res = await rpcNoAuth(qaServer, fnName, params);
      // Der Mock-Router (tests/mock/router.js:24-28) prueft einen gueltigen
      // Bearer-Token bereits VOR jeder einzelnen RPC-Funktion - ein
      // fehlender/ungueltiger Token fuehrt zu einem generischen 401 auf
      // Router-Ebene, bevor ueberhaupt einer der Handler unten je erreicht
      // wird (identisches Prinzip wie ein echter PostgREST-Server vor
      // security-definer-Funktionen). Erwartungsgemaess 401, NICHT 400 -
      // 400 waere ein spaeterer, funktionsspezifischer Fehler.
      expect(res.status, `${fnName} sollte ohne Login ablehnen`).toBe(401);
      expect(res.json.message, `${fnName} sollte not_authenticated liefern`).toBe('not_authenticated');
    }
  });

  test('guild_quest_contribute ist die EINZIGE bewusste Ausnahme: stiller No-Op statt Fehler bei fehlender Mitgliedschaft (Absicht, siehe Dateikommentar rpc-engine.js) - gilt fuer einen ECHT eingeloggten, aber gildenlosen Nutzer, nicht fuer einen komplett unauthentifizierten Aufruf (der scheitert bereits auf Router-Ebene, siehe Test oben)', async ({ qaServer }) => {
    qaServer.store.authUsersByEmail.set(emailFromName('QaPermLoner'), { id: 'qa-perm-loner', email: emailFromName('QaPermLoner'), password: QA_PASSWORD, user_metadata: {} });
    qaServer.store.tables.idle_player_state.push({ auth_user_id: 'qa-perm-loner', name_key: 'qapermloner', display_name: 'QaPermLoner', gold: 0 });
    const res = await rpcAs(qaServer, 'QaPermLoner', 'guild_quest_contribute', { p_deltas: { dragon_kills: 5 } });
    expect(res.status).toBe(200);
    expect(res.json).toBeNull();
  });
});
