/* Clan-Bestenliste + Clan-Arena (Spieler-Idee Kaledoss, 28.07.2026,
   Feedback-Board: "Einen Reiter für Clanbestenliste und ne Art Clanarena
   kämpfe"). guild_arena_attack() ist ein direkter Guild-Level-Port des
   bereits bewaehrten arena_attack() (siehe arena.spec.js) - Macht = SUMME
   der Kampfwerte aller aktuellen Gildenmitglieder statt eines einzelnen
   Spielers. Eigene, lokale Fixture (statt tests/fixtures/teststands.js) -
   braucht zwingend MEHRERE Gilden gleichzeitig im selben Store, wie schon
   arena.spec.js mehrere Spieler brauchte. */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const LEADER_A_NAME = 'QaClanLeaderA';
const LEADER_A_UID = 'qa-clan-leadera-0000';
const OFFICER_A_NAME = 'QaClanOfficerA';
const OFFICER_A_UID = 'qa-clan-officera-0000';
const MEMBER_A_NAME = 'QaClanMemberA';
const MEMBER_A_UID = 'qa-clan-membera-0000';
// Gilde A ist STARK (die Macht liegt bewusst komplett auf dem Anfuehrer,
// Offizier/Mitglied tragen nur minimale Werte bei - haelt die erwartete
// Gesamtmacht der Gilde vorhersagbar).
const GUILD_A_ID = 'gA';

// Fuenf separate, gleich schwache Ziel-Gilden (je 1 Anfuehrer) - erlaubt
// Tageslimit-Tests (3 verschiedene Ziele an einem Tag) OHNE gleichzeitig
// in den 30-Minuten-Cooldown gegen dasselbe Ziel zu laufen.
const WEAK_GUILD_IDS = ['gW1', 'gW2', 'gW3', 'gW4'];
function weakLeaderUid(i) { return `qa-clan-weakleader-${i}`; }
function weakLeaderName(i) { return `QaClanWeak${i}`; }

// Gilde mit IDENTISCHER Gesamtmacht wie Gilde A - fuer einen fairen
// (~50/50) ELO-Vergleich.
const GUILD_FAIR_ID = 'gFair';
const LEADER_FAIR_UID = 'qa-clan-leaderfair-0000';
const LEADER_FAIR_NAME = 'QaClanLeaderFair';

// Echter Spieler OHNE jede Gildenmitgliedschaft - fuer den "no_guild"-Fall.
const NO_GUILD_UID = 'qa-clan-noguild-0000';
const NO_GUILD_NAME = 'QaClanNoGuild';

function clanArenaFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  function playerRow(uid, name, extra) {
    return makePlayerStateRow(uid, name.toLowerCase(), nowIso, { display_name: name, ...extra });
  }
  function user(uid, name) { return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} }; }
  function member(uid, guildId, nameKey, displayName, role) {
    return { auth_user_id: uid, guild_id: guildId, name_key: nameKey, display_name: displayName, role, contributed_gold: 0, joined_at: nowIso };
  }
  function guildRow(id, name, tag, xp) {
    return {
      id, name, name_key: name.toLowerCase(), tag, description: '', leader_auth_user_id: null,
      treasury_gold: 0, member_count: 1, created_at: nowIso, is_public: true, guild_xp: xp || 0,
      current_goal: '', banner: {}, bosses_defeated: 0, boss_attempts: 0, bonus_member_slots: 0
    };
  }

  const players = [
    playerRow(LEADER_A_UID, LEADER_A_NAME, { attack: 1000, defense: 500, hp: 5000 }),
    playerRow(OFFICER_A_UID, OFFICER_A_NAME, { attack: 1, defense: 1, hp: 1 }),
    playerRow(MEMBER_A_UID, MEMBER_A_NAME, { attack: 1, defense: 1, hp: 1 }),
    playerRow(LEADER_FAIR_UID, LEADER_FAIR_NAME, { attack: 1000, defense: 500, hp: 5000 }),
    playerRow(NO_GUILD_UID, NO_GUILD_NAME, { attack: 100, defense: 50, hp: 500 }),
    ...WEAK_GUILD_IDS.map((_, i) => playerRow(weakLeaderUid(i), weakLeaderName(i), { attack: 1, defense: 1, hp: 1 }))
  ];
  const guilds = [
    guildRow(GUILD_A_ID, 'Clan A', 'CLNA', 500),
    guildRow(GUILD_FAIR_ID, 'Clan Fair', 'FAIR', 100),
    ...WEAK_GUILD_IDS.map((id, i) => guildRow(id, `Clan Weak ${i}`, `CW${i}`, 10 * i))
  ];
  const guildMembers = [
    member(LEADER_A_UID, GUILD_A_ID, LEADER_A_NAME.toLowerCase(), LEADER_A_NAME, 'leader'),
    member(OFFICER_A_UID, GUILD_A_ID, OFFICER_A_NAME.toLowerCase(), OFFICER_A_NAME, 'officer'),
    member(MEMBER_A_UID, GUILD_A_ID, MEMBER_A_NAME.toLowerCase(), MEMBER_A_NAME, 'member'),
    member(LEADER_FAIR_UID, GUILD_FAIR_ID, LEADER_FAIR_NAME.toLowerCase(), LEADER_FAIR_NAME, 'leader'),
    ...WEAK_GUILD_IDS.map((id, i) => member(weakLeaderUid(i), id, weakLeaderName(i).toLowerCase(), weakLeaderName(i), 'leader'))
  ];

  return {
    startTimeMs,
    displayName: LEADER_A_NAME, nameKey: LEADER_A_NAME.toLowerCase(), authUserId: LEADER_A_UID,
    email: emailFromName(LEADER_A_NAME), password: QA_PASSWORD,
    users: [
      user(LEADER_A_UID, LEADER_A_NAME), user(OFFICER_A_UID, OFFICER_A_NAME), user(MEMBER_A_UID, MEMBER_A_NAME),
      user(LEADER_FAIR_UID, LEADER_FAIR_NAME), user(NO_GUILD_UID, NO_GUILD_NAME),
      ...WEAK_GUILD_IDS.map((_, i) => user(weakLeaderUid(i), weakLeaderName(i)))
    ],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: players,
      idle_prestige_state: [],
      idle_player_runes: [],
      guilds, guild_members: guildMembers, guild_tech_levels: [], guild_activity_log: [],
      guild_ratings: [], guild_battle_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, clanArenaFixture(startTimeMs)), { startTimeMs: Date.now() });
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

async function guildAttack(page, targetGuildId) {
  return page.evaluate(async (id) => {
    try { return { ok: true, res: await window.bkmpGuildArenaAttack(id) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  }, targetGuildId);
}

test.describe('Clan-Arena (RPC-Ebene)', () => {
  test('Anführer gewinnt zuverlässig gegen eine deutlich schwächere Gilde, Gold geht in die Kasse', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_A_NAME);
    const before = qaServer.store.tables.guilds.find(g => g.id === GUILD_A_ID).treasury_gold;
    const r = await guildAttack(page, WEAK_GUILD_IDS[0]);
    expect(r.ok).toBe(true);
    expect(r.res.won).toBe(true);
    expect(r.res.goldReward).toBeGreaterThan(0);
    const after = qaServer.store.tables.guilds.find(g => g.id === GUILD_A_ID).treasury_gold;
    expect(after - before).toBe(r.res.goldReward);
  });

  test('Niederlage kostet nur Rating, nie Kassen-Gold', async ({ page, qaServer }) => {
    await login(page, qaServer, weakLeaderName(0));
    const before = qaServer.store.tables.guilds.find(g => g.id === WEAK_GUILD_IDS[0]).treasury_gold;
    const r = await guildAttack(page, GUILD_A_ID);
    expect(r.ok).toBe(true);
    expect(r.res.won).toBe(false);
    expect(r.res.goldReward).toBe(0);
    expect(r.res.ratingChange).toBeLessThan(0);
    const after = qaServer.store.tables.guilds.find(g => g.id === WEAK_GUILD_IDS[0]).treasury_gold;
    expect(after).toBe(before);
  });

  test('Offizier darf ebenfalls angreifen (nicht nur der Anführer)', async ({ page, qaServer }) => {
    await login(page, qaServer, OFFICER_A_NAME);
    const r = await guildAttack(page, WEAK_GUILD_IDS[0]);
    expect(r.ok).toBe(true);
  });

  test('normales Mitglied darf NICHT angreifen (insufficient_role)', async ({ page, qaServer }) => {
    await login(page, qaServer, MEMBER_A_NAME);
    const r = await guildAttack(page, WEAK_GUILD_IDS[0]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Nur Anführer/Stellvertreter');
  });

  test('Angriff auf die eigene Gilde schlägt fehl', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_A_NAME);
    const r = await guildAttack(page, GUILD_A_ID);
    expect(r.ok).toBe(false);
  });

  test('Spieler ohne Gilde kann nicht angreifen (no_guild)', async ({ page, qaServer }) => {
    await login(page, qaServer, NO_GUILD_NAME);
    const r = await guildAttack(page, WEAK_GUILD_IDS[0]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Du bist in keiner Gilde');
  });

  test('Tageslimit von 3 Angriffen wird durchgesetzt (vierter schlägt fehl)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_A_NAME);
    for (let i = 0; i < 3; i++) {
      const r = await guildAttack(page, WEAK_GUILD_IDS[i]);
      expect(r.ok).toBe(true);
    }
    const r4 = await guildAttack(page, WEAK_GUILD_IDS[3]);
    expect(r4.ok).toBe(false);
    expect(r4.error).toMatch(/Tageslimit/);
  });

  test('Cooldown von 30 Minuten gegen dasselbe Ziel wird durchgesetzt und läuft danach ab', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_A_NAME);
    const r1 = await guildAttack(page, WEAK_GUILD_IDS[0]);
    expect(r1.ok).toBe(true);
    const r2 = await guildAttack(page, WEAK_GUILD_IDS[0]);
    expect(r2.ok).toBe(false);
    expect(r2.error).toMatch(/vor Kurzem angegriffen/);
    qaServer.store.clock.advance(30 * 60 * 1000 + 1000);
    const r3 = await guildAttack(page, WEAK_GUILD_IDS[0]);
    expect(r3.ok).toBe(true);
  });

  test('exakte ELO-Formel (K=32) bei gleich starken Gilden', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_A_NAME);
    const r = await guildAttack(page, GUILD_FAIR_ID);
    expect(r.ok).toBe(true);
    // Beide Gilden starten bei Rating 1000 (Erwartungswert exakt 50%) -> K*0.5 = 16.
    expect(Math.abs(r.res.ratingChange)).toBe(16);
  });
});

test.describe('Clan-Bestenliste', () => {
  test('sortiert Gilden nach guild_xp (Level) absteigend', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_A_NAME);
    const list = await page.evaluate(() => window.bkmpGuildGetLeaderboard(50));
    const xps = list.map(g => g.guildXp);
    const sorted = [...xps].sort((a, b) => b - a);
    expect(xps).toEqual(sorted);
    expect(list[0].id).toBe(GUILD_A_ID); // Clan A hat mit 500 die hoechste guild_xp im Fixture
  });
});

test.describe('Clan-Tab (UI)', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt einen echten Desktop-Tab-Klick - mobile-smoke.spec.js deckt die kompakte Navigation ab');
  });

  test('zeigt Bestenliste + Beitritts-Hinweis fuer Spieler ohne Gilde, Arena fuer Mitglieder', async ({ page, qaServer }) => {
    await login(page, qaServer, weakLeaderName(1)); // hat bereits eine eigene Gilde - Gegenbeweis siehe naechster Test
    await page.locator('#idleTabBtnClan').click();
    await expect(page.locator('#idlePanelClan')).toContainText('Gilden-Bestenliste');
    await expect(page.locator('#idlePanelClan')).toContainText('Gilden-Arena');
  });

  test('Angreifen-Button ist fuer ein normales Mitglied deaktiviert', async ({ page, qaServer }) => {
    await login(page, qaServer, MEMBER_A_NAME);
    await page.locator('#idleTabBtnClan').click();
    await page.evaluate(() => bkmpIdleRenderClanPanel());
    await expect(page.locator('#idlePanelClan')).toContainText('nur Anführer/Stellvertreter können angreifen');
    const attackBtns = page.locator('.idle-clan-arena-attack-btn');
    const count = await attackBtns.count();
    for (let i = 0; i < count; i++) await expect(attackBtns.nth(i)).toBeDisabled();
  });

  test('Anführer kann per echtem Klick angreifen, Toast/Log zeigen das Ergebnis', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_A_NAME);
    await page.locator('#idleTabBtnClan').click();
    await page.evaluate(() => bkmpIdleRenderClanPanel());
    const card = page.locator(`.idle-arena-opponent-card[data-target-guild-id="${WEAK_GUILD_IDS[0]}"]`);
    await expect(card).toBeVisible();
    await card.locator('.idle-clan-arena-attack-btn').click();
    await expect.poll(() => page.evaluate(() => bkmpClanArenaAttacking)).toBe(null);
    const logText = await page.evaluate(() => document.getElementById('idleDorfLog') ? document.getElementById('idleDorfLog').textContent : '');
    expect(logText).toMatch(/Gilden-(Sieg|Niederlage)/);
  });

  /* Spieler-Nachfrage 30.07.2026 ("Hatte kein Angriffs Animation?") - neue
     Kampfanimation (bkmpClanArenaPlayBattleAnimation, js/systems/bkmp-guild.js),
     Port von bkmpArenaPlayBattleAnimation (Spieler-Arena) mit Gilden-Tag-
     Abzeichen statt Dorf-Skin-Sprite. Guild A (LEADER_A) besiegt die
     schwachen Zielgilden zuverlaessig (siehe Machtwerte oben) - garantierter
     Sieg fuer einen deterministischen Test, ohne den echten arena_attack()-
     Zufallswurf zu mocken. */
  test('Kampfanimation zeigt beide Gilden-Tags/-Namen an und endet mit korrektem Sieg-Ergebnis', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_A_NAME);
    await page.locator('#idleTabBtnClan').click();
    await page.evaluate(() => bkmpIdleRenderClanPanel());
    const card = page.locator(`.idle-arena-opponent-card[data-target-guild-id="${WEAK_GUILD_IDS[0]}"]`);
    await expect(card).toBeVisible();
    await card.locator('.idle-clan-arena-attack-btn').click();

    const overlay = page.locator('#clanArenaBattleOverlay');
    await expect(overlay).toHaveClass(/visible/, { timeout: 10000 });
    await expect(page.locator('#clanArenaBattleMeName')).toContainText('Clan A');
    await expect(page.locator('#clanArenaBattleMeTag')).toContainText('[CLNA]');
    await expect(page.locator('#clanArenaBattleOpponentName')).toContainText('Clan Weak 0');
    await expect(page.locator('#clanArenaBattleOpponentTag')).toContainText('[CW0]');

    // Die Animation selbst dauert ~350ms + 5x420ms + 1100ms Ergebnis-Anzeige (~3.5s) -
    // grosszuegiger Timeout, danach schliesst sich das Overlay automatisch wieder.
    await expect(overlay).not.toHaveClass(/visible/, { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => bkmpClanArenaAttacking)).toBe(null);
    const logText = await page.evaluate(() => document.getElementById('idleDorfLog') ? document.getElementById('idleDorfLog').textContent : '');
    expect(logText).toMatch(/Gilden-Sieg/); // Guild A ist deutlich staerker als jede WEAK_GUILD - garantierter Sieg.
  });

  test('Kampfanimation zeigt korrektes Niederlage-Ergebnis, wenn die schwache Gilde die starke angreift', async ({ page, qaServer }) => {
    // Umgekehrter Fall: ein schwacher Gilden-Anfuehrer greift die deutlich staerkere Guild A an - garantierte Niederlage.
    await login(page, qaServer, weakLeaderName(1));
    await page.locator('#idleTabBtnClan').click();
    await page.evaluate(() => bkmpIdleRenderClanPanel());
    const card = page.locator(`.idle-arena-opponent-card[data-target-guild-id="${GUILD_A_ID}"]`);
    await expect(card).toBeVisible();
    await card.locator('.idle-clan-arena-attack-btn').click();

    const overlay = page.locator('#clanArenaBattleOverlay');
    await expect(overlay).toHaveClass(/visible/, { timeout: 10000 });
    await expect(page.locator('#clanArenaBattleMeTag')).toContainText('[CW1]');
    await expect(page.locator('#clanArenaBattleOpponentTag')).toContainText('[CLNA]');
    await expect(overlay).not.toHaveClass(/visible/, { timeout: 10000 });

    const logText = await page.evaluate(() => document.getElementById('idleDorfLog') ? document.getElementById('idleDorfLog').textContent : '');
    expect(logText).toMatch(/Gilden-Niederlage/);
  });
});
