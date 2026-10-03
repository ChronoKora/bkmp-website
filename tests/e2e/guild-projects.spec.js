/* Drachendorf-Ausbau Phase 6 (04.10.2026): woechentliches Gildenprojekt.
   Nachbau der RPCs in tests/mock/rpc-engine.js (sql/20261004-05-guild-projects.sql). */
const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { GUILD_PROJECT_DEFS } = require('../fixtures/guild-project-reference');

const LEADER = 'QaProjLeader', LEADER_UID = 'qa-proj-leader-0000';
const LAZY = 'QaProjLazy', LAZY_UID = 'qa-proj-lazy-0000';

function fixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  const rich = { gold: 500000000, wood: 900000, stone: 900000, crystals: 900000, essence: 900000 };
  return {
    startTimeMs, displayName: LEADER, nameKey: LEADER.toLowerCase(), authUserId: LEADER_UID, email: emailFromName(LEADER), password: QA_PASSWORD,
    users: [
      { id: LEADER_UID, email: emailFromName(LEADER), password: QA_PASSWORD, user_metadata: {} },
      { id: LAZY_UID, email: emailFromName(LAZY), password: QA_PASSWORD, user_metadata: {} }
    ],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [
        makePlayerStateRow(LEADER_UID, LEADER.toLowerCase(), nowIso, { display_name: LEADER, ...rich }),
        makePlayerStateRow(LAZY_UID, LAZY.toLowerCase(), new Date(startTimeMs - 30 * 864e5).toISOString(), { display_name: LAZY, ...rich })
      ],
      idle_prestige_state: [], idle_player_runes: [],
      guilds: [{ id: 'gp1', name: 'Projektgilde', tag: 'PRJ', treasury_gold: 0, member_count: 2, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: LEADER_UID, created_at: nowIso, guild_xp: 0 }],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'gp1', name_key: LEADER.toLowerCase(), display_name: LEADER, role: 'leader', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: LAZY_UID, guild_id: 'gp1', name_key: LAZY.toLowerCase(), display_name: LAZY, role: 'member', contributed_gold: 0, joined_at: nowIso }
      ],
      guild_activity_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, fixture(startTimeMs)), { startTimeMs: Date.now() });
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
  await page.waitForFunction(() => typeof bkmpIdleState !== 'undefined' && bkmpIdleState && bkmpIdleState.name_key, null, { timeout: 15000 });
  await page.evaluate(() => bkmpIdleStopLoop());
}
async function openGuild(page) {
  const compact = await page.locator('#bkmpProtoNavMoreBtn').isVisible().catch(() => false);
  if (compact) await page.evaluate(() => document.getElementById('idleTabBtnGilde').click());
  else await page.locator('#idleTabBtnGilde').click();
  await expect(page.locator('[data-testid="guild-project"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="guild-project-progress"]')).toBeVisible({ timeout: 15000 });
}

test('Projekt der Woche: Ziel nach aktiven Mitgliedern, Einzahlen zieht serverseitig ab', async ({ page, qaServer }) => {
  await login(page, qaServer, LEADER);
  await openGuild(page);
  const proj = qaServer.store.tables.guild_projects[0];
  // 1 aktives Mitglied (der zweite war 30 Tage nicht da), Gildenlevel 1: 400 + 250 + 40 = 690.
  expect(proj.target_points).toBe(690);
  const def = GUILD_PROJECT_DEFS.find(d => d.id === proj.def_id);
  expect(def).toBeTruthy();
  const kind = def.resource_kinds.find(k => k !== 'gold') || 'gold';
  await page.evaluate(() => bkmpIdleFlushSyncNow());
  const st = qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === LEADER_UID);
  const before = Number(st[kind]);
  await page.locator(`[data-testid="guild-project-give-${kind}"]`).click();
  await expect(page.locator('[data-testid="guild-project-progress"]')).toContainText('10 / 690', { timeout: 10000 });
  const per = kind === 'wood' || kind === 'stone' ? 100 : 5;
  expect(before - Number(st[kind])).toBe(per * 10);
  expect(await page.evaluate(k => bkmpIdleState[k], kind)).toBe(Number(st[kind]));
  // Falsche Ressource wird abgelehnt.
  const wrong = ['gold', 'wood', 'stone', 'crystals', 'essence'].find(k => !def.resource_kinds.includes(k));
  const msg = await page.evaluate(k => bkmpGuildProjectContributeRpc(k, 100000).then(() => 'ok', e => e.message), wrong);
  expect(msg).toMatch(/braucht das Projekt/);
});

test('Fertigstellen: nie über das Ziel hinaus, Belohnung genau einmal, nur für Beitragende', async ({ page, qaServer, browser }) => {
  await login(page, qaServer, LEADER);
  await openGuild(page);
  // Riesige Einzahlung: wird auf das Ziel gedeckelt, nur der benoetigte Teil kostet.
  const res = await page.evaluate(() => bkmpGuildProjectContributeRpc('gold', 999999999));
  const proj = qaServer.store.tables.guild_projects[0];
  expect(proj.progress_points).toBe(proj.target_points);
  expect(res.points).toBe(proj.target_points);
  expect(res.completed).toBe(true);
  expect(qaServer.store.tables.guilds[0].projects_completed).toBe(1);
  const again = await page.evaluate(() => bkmpGuildProjectContributeRpc('gold', 100000).then(() => 'ok', e => e.message));
  expect(again).toMatch(/schon fertig/);

  await page.evaluate(() => bkmpGuildProjectEnsureLoaded(true).then(() => bkmpIdleRenderGildePanel()));
  await page.evaluate(() => bkmpIdleFlushSyncNow());
  const st = qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === LEADER_UID);
  const crystalsBefore = Number(st.crystals);
  const runesBefore = await page.evaluate(() => bkmpIdlePlayerRunes.length);
  await page.locator('[data-testid="guild-project-claim"]').click();
  await expect(page.locator('[data-testid="guild-project"]')).toContainText('Belohnung abgeholt', { timeout: 10000 });
  expect(Number(st.crystals) - crystalsBefore).toBe(150);
  expect(await page.evaluate(() => bkmpIdlePlayerRunes.length)).toBe(runesBefore + 1);
  const twice = await page.evaluate(() => bkmpGuildProjectClaimRpc().then(() => 'ok', e => e.message));
  expect(twice).toMatch(/schon abgeholt/);

  // Wer nichts beigetragen hat, bekommt nichts.
  const ctx = await browser.newContext();
  const page2 = await ctx.newPage();
  await login(page2, qaServer, LAZY);
  const lazy = await page2.evaluate(() => bkmpGuildProjectClaimRpc().then(() => 'ok', e => e.message));
  expect(lazy).toMatch(/mindestens 10 Punkte/);
  await ctx.close();
});
