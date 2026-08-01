/* Gilden-Technologie v3 (31.07.2026, siehe CLAUDE.md/Plan
   C:\Users\David\.claude\plans\zazzy-crunching-plum.md) - RPC-Ebenen-Tests
   fuer die neuen Baum-Kern-RPCs (guild_tech_contribute/guild_tech_attempt_
   status), Stufe 1 der Umsetzung. Bewusst NUR die RPC-Ebene (rpcAs(), kein
   UI-Login noetig - identisches Muster wie guild-permissions.spec.js) - ein
   Client-Wrapper (window.bkmpGuildTechContribute) existiert erst ab Stufe 3
   (neues Frontend), es gibt also noch keine UI zu testen.

   Fixture: 3 Mitglieder derselben Gilde (member/officer/leader-Rollen, um zu
   beweisen, dass guild_tech_contribute() KEINE Rollenpruefung hat - anders
   als das alte guild_tech_upgrade(), das ist der ganze Sinn des neuen
   Systems), ein 6-Knoten-Beispiel-Baum (identisch zum Stufe-1-Seed in
   sql/20260731-guild-tech-tree-v2-foundation.sql: attack/defense/
   crit_chance sind Wurzeln, crit_damage braucht attack, boss_damage braucht
   defense+crit_chance, guild_kriegsrat braucht crit_damage+boss_damage). */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');

const LEADER_NAME = 'QaTechTreeLeader';
const OFFICER_NAME = 'QaTechTreeOfficer';
const MEMBER_NAME = 'QaTechTreeMember';
const LEADER_UID = 'qa-techtree-leader-0000';
const OFFICER_UID = 'qa-techtree-officer-0000';
const MEMBER_UID = 'qa-techtree-member-0000';

// Identisch zum Stufe-1-Beispiel-Baum in der SQL-Migration (Abschnitt 8).
const EXAMPLE_NODES = [
  { id: 'attack', category: 'schlacht', label: 'Angriff', description: '', icon: '⚔️', effect_type: 'attackPct', effect_per_tier: 7, max_tier: 5, base_gold_cost: 2000000, cost_growth: 1.5, attempts_per_tier: 25, prereq_node_ids: [], pos_x: 100, pos_y: 50 },
  { id: 'defense', category: 'schlacht', label: 'Verteidigung', description: '', icon: '🛡️', effect_type: 'defensePct', effect_per_tier: 7, max_tier: 5, base_gold_cost: 2000000, cost_growth: 1.5, attempts_per_tier: 25, prereq_node_ids: [], pos_x: 300, pos_y: 50 },
  { id: 'crit_chance', category: 'schlacht', label: 'Kritchance', description: '', icon: '🎯', effect_type: 'critChancePct', effect_per_tier: 2.1, max_tier: 5, base_gold_cost: 2000000, cost_growth: 1.5, attempts_per_tier: 25, prereq_node_ids: [], pos_x: 500, pos_y: 50 },
  { id: 'crit_damage', category: 'schlacht', label: 'Kritischer Schaden', description: '', icon: '💥', effect_type: 'critDamagePct', effect_per_tier: 14, max_tier: 5, base_gold_cost: 2500000, cost_growth: 1.55, attempts_per_tier: 25, prereq_node_ids: ['attack'], pos_x: 100, pos_y: 200 },
  { id: 'boss_damage', category: 'schlacht', label: 'Bossschaden', description: '', icon: '🐉', effect_type: 'bossDamagePct', effect_per_tier: 17.5, max_tier: 5, base_gold_cost: 2500000, cost_growth: 1.55, attempts_per_tier: 25, prereq_node_ids: ['defense', 'crit_chance'], pos_x: 400, pos_y: 200 },
  { id: 'guild_kriegsrat', category: 'schlacht', label: 'Kriegsrat', description: '', icon: '🗡️', effect_type: 'arenaExtraAttempts', effect_per_tier: 3, max_tier: 5, base_gold_cost: 3000000, cost_growth: 1.6, attempts_per_tier: 25, prereq_node_ids: ['crit_damage', 'boss_damage'], pos_x: 250, pos_y: 350 }
];

function techTreeFixture(startTimeMs, opts) {
  const options = opts || {};
  const nowIso = new Date(startTimeMs).toISOString();
  function row(uid, name, extra) { return makePlayerStateRow(uid, name.toLowerCase(), nowIso, { display_name: name, gold: 100000000, ...extra }); }
  function user(uid, name) { return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} }; }
  return {
    startTimeMs,
    displayName: LEADER_NAME, nameKey: LEADER_NAME.toLowerCase(), authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME), password: QA_PASSWORD,
    users: [user(LEADER_UID, LEADER_NAME), user(OFFICER_UID, OFFICER_NAME), user(MEMBER_UID, MEMBER_NAME)],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [
        row(LEADER_UID, LEADER_NAME),
        row(OFFICER_UID, OFFICER_NAME),
        row(MEMBER_UID, MEMBER_NAME, options.memberGoldOverride !== undefined ? { gold: options.memberGoldOverride } : {})
      ],
      idle_prestige_state: [], idle_player_runes: [],
      guilds: [{ id: 'g1', name: 'Testgilde', tag: 'TST', treasury_gold: 1000000, member_count: 3, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: LEADER_UID, created_at: nowIso }],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, tech_contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: OFFICER_UID, guild_id: 'g1', name_key: OFFICER_NAME.toLowerCase(), display_name: OFFICER_NAME, role: 'officer', contributed_gold: 0, tech_contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: MEMBER_UID, guild_id: 'g1', name_key: MEMBER_NAME.toLowerCase(), display_name: MEMBER_NAME, role: 'member', contributed_gold: 0, tech_contributed_gold: 0, joined_at: nowIso }
      ],
      guild_tech_nodes: EXAMPLE_NODES.map(n => ({ ...n })),
      guild_tech_progress: [], guild_tech_contributor_attempts: [],
      guild_tech_levels: [], guild_activity_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, techTreeFixture(startTimeMs)), { startTimeMs: Date.now() });
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

function goldOf(qaServer, uid) {
  return Number(qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === uid).gold);
}

test.describe('Gilden-Technologie v3: Baum-Beitrags-RPCs (RPC-Ebene direkt)', () => {
  test('ein Beitrag zu einer Wurzel (keine Vorbedingung) erhoeht den gemeinsamen Fortschritt UND das eigene Gold sinkt', async ({ qaServer }) => {
    const goldBefore = goldOf(qaServer, MEMBER_UID);
    const res = await rpcAs(qaServer, MEMBER_NAME, 'guild_tech_contribute', { p_node_id: 'attack' });
    expect(res.status).toBe(200);
    const row = Array.isArray(res.json) ? res.json[0] : res.json;
    expect(row.new_tier).toBe(0); // ein einzelner Beitrag reicht bei attempts_per_tier=25 nicht fuer einen vollen Tier
    expect(row.new_progress_gold).toBeGreaterThan(0);
    expect(row.gold_spent).toBeGreaterThan(0);
    expect(row.attempts_left).toBe(4);
    expect(goldOf(qaServer, MEMBER_UID)).toBe(goldBefore - row.gold_spent);

    const progress = qaServer.store.tables.guild_tech_progress.find(r => r.guild_id === 'g1' && r.node_id === 'attack');
    expect(progress.progress_gold).toBe(row.new_progress_gold);
  });

  test('KEINE Rollenpruefung: ein plain Member darf beitragen (anders als das alte guild_tech_upgrade)', async ({ qaServer }) => {
    const res = await rpcAs(qaServer, MEMBER_NAME, 'guild_tech_contribute', { p_node_id: 'attack' });
    expect(res.status).toBe(200);
  });

  test('ein gesperrter Knoten (Vorbedingung nicht erfuellt) lehnt mit prereq_not_met ab', async ({ qaServer }) => {
    const res = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_contribute', { p_node_id: 'crit_damage' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.json.message).toContain('prereq_not_met');
  });

  test('nach vollstaendigem Ausbau der Vorbedingung wird der Folgeknoten freigeschaltet', async ({ qaServer }) => {
    // "attack" (Wurzel, 5 Tiers, 25 Versuche/Tier) auf Maximalstufe bringen -
    // mehr Versuche noetig als das 5/Tag-Limit erlaubt, deshalb die Uhr
    // zwischen den Beitraegen um jeweils einen vollen 4h-Slot vorspulen.
    for (let i = 0; i < 5 * 25; i++) {
      const res = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_contribute', { p_node_id: 'attack' });
      if (res.status !== 200) {
        expect(res.json.message).toContain('no_attempts_available');
        qaServer.store.clock.advance(4 * 3600 * 1000);
        i -= 1; // dieser Versuch wurde nicht verbraucht, erneut versuchen
        continue;
      }
    }
    const attackProgress = qaServer.store.tables.guild_tech_progress.find(r => r.guild_id === 'g1' && r.node_id === 'attack');
    expect(attackProgress.tier).toBe(5);

    // Die letzten Versuche des obigen Loops koennen das Tages-Kontingent
    // erschoepft zurueckgelassen haben - Uhr sicherheitshalber einen vollen
    // Slot weiter, damit der folgende Beitrag garantiert nicht an
    // no_attempts_available scheitert (das wird oben bereits separat getestet).
    qaServer.store.clock.advance(4 * 3600 * 1000);

    // crit_damage braucht NUR "attack" (jetzt maximal) - muss jetzt klappen.
    const res = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_contribute', { p_node_id: 'crit_damage' });
    expect(res.status).toBe(200);

    // "attack" selbst ist jetzt voll - ein weiterer Beitrag lehnt mit node_maxed ab.
    const maxedRes = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_contribute', { p_node_id: 'attack' });
    expect(maxedRes.status).toBeGreaterThanOrEqual(400);
    expect(maxedRes.json.message).toContain('node_maxed');
  });

  test('Beitragsversuche: 5/Tag, festes gemeinsames Raster (identisch zum Dungeon-Schluessel-System) - 6. Versuch scheitert, nach einem vollen Slot wieder verfuegbar', async ({ qaServer }) => {
    for (let i = 0; i < 5; i++) {
      const res = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_contribute', { p_node_id: 'attack' });
      expect(res.status).toBe(200);
    }
    const sixth = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_contribute', { p_node_id: 'attack' });
    expect(sixth.status).toBeGreaterThanOrEqual(400);
    expect(sixth.json.message).toContain('no_attempts_available');

    qaServer.store.clock.advance(4 * 3600 * 1000); // ein voller Slot weiter
    const status = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_attempt_status', {});
    expect(status.status).toBe(200);
    const row = Array.isArray(status.json) ? status.json[0] : status.json;
    expect(row.attempts).toBeGreaterThan(0);
    expect(row.max_attempts).toBe(5);
  });

  test('REGRESSION: insufficient_gold verbraucht trotzdem einen Beitragsversuch (identisches Prinzip wie ein gescheiterter Dungeon-Lauf) - kein haengender Countdown-Anker', async ({ qaServer }) => {
    // Eigene Fixture mit einem mittellosen Mitglied fuer diesen einen Test.
    const server = await createQaServer((store, startTimeMs) => seedStore(store, techTreeFixture(startTimeMs, { memberGoldOverride: 0 })), { startTimeMs: Date.now() });
    try {
      const before = await rpcAs(server, MEMBER_NAME, 'guild_tech_attempt_status', {});
      const attemptsBefore = (Array.isArray(before.json) ? before.json[0] : before.json).attempts;

      const res = await rpcAs(server, MEMBER_NAME, 'guild_tech_contribute', { p_node_id: 'attack' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.json.message).toContain('insufficient_gold');

      const after = await rpcAs(server, MEMBER_NAME, 'guild_tech_attempt_status', {});
      const attemptsAfter = (Array.isArray(after.json) ? after.json[0] : after.json).attempts;
      expect(attemptsAfter).toBe(attemptsBefore - 1);

      // Gold blieb unangetastet - kein Teilabzug bei einem gescheiterten Beitrag.
      expect(goldOf(server, MEMBER_UID)).toBe(0);
      const progress = server.store.tables.guild_tech_progress.find(r => r.guild_id === 'g1' && r.node_id === 'attack');
      expect(progress ? progress.progress_gold : 0).toBe(0);
    } finally {
      await server.close();
    }
  });

  test('persoenlicher Beitrag wird fuer die gildeninterne Bestenliste mitgezaehlt (tech_contributed_gold)', async ({ qaServer }) => {
    const res = await rpcAs(qaServer, MEMBER_NAME, 'guild_tech_contribute', { p_node_id: 'attack' });
    expect(res.status).toBe(200);
    const row = Array.isArray(res.json) ? res.json[0] : res.json;
    const member = qaServer.store.tables.guild_members.find(m => m.auth_user_id === MEMBER_UID);
    expect(member.tech_contributed_gold).toBe(row.gold_spent);
  });

  test('unbekannte Knoten-ID wird mit invalid_node abgelehnt', async ({ qaServer }) => {
    const res = await rpcAs(qaServer, LEADER_NAME, 'guild_tech_contribute', { p_node_id: 'does_not_exist' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.json.message).toContain('invalid_node');
  });

  test('Nichtmitglied wird mit not_in_guild abgelehnt', async ({ qaServer }) => {
    // Ein vierter, echter, aber gildenloser Nutzer.
    const server = qaServer;
    const outsiderName = 'QaTechTreeOutsider';
    const outsiderEmail = emailFromName(outsiderName);
    server.store.authUsersByEmail.set(outsiderEmail, { id: 'qa-techtree-outsider-0000', email: outsiderEmail, password: QA_PASSWORD, user_metadata: {} });
    server.store.tables.idle_player_state.push({ auth_user_id: 'qa-techtree-outsider-0000', name_key: outsiderName.toLowerCase(), display_name: outsiderName, gold: 1000000 });
    const res = await rpcAs(server, outsiderName, 'guild_tech_contribute', { p_node_id: 'attack' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.json.message).toContain('not_in_guild');
  });

  test('ausgeloggter Nutzer (kein Auth-Header) wird von beiden neuen RPCs abgelehnt', async ({ qaServer }) => {
    const rpcNoAuth = async (fnName, params) => {
      const rpcRes = await fetch(`${qaServer.baseURL}/rest/v1/rpc/${fnName}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {})
      });
      const json = await rpcRes.json().catch(() => null);
      return { status: rpcRes.status, json };
    };
    const a = await rpcNoAuth('guild_tech_contribute', { p_node_id: 'attack' });
    expect(a.status).toBe(401);
    const b = await rpcNoAuth('guild_tech_attempt_status', {});
    expect(b.status).toBe(401);
  });
});
