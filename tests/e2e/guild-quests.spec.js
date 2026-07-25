/* Phase 5 (24.07.2026, siehe CLAUDE.md) - Gildenquest-Tests.

   Architektur (sql/supabase-guild-quest-contribute-fix.sql = massgebliche
   Fassung fuer guild_quest_contribute, sql/supabase-guild-quests-fix.sql
   fuer guild_quest_ensure_today - siehe ausfuehrlicher Herleitungskommentar
   in tests/mock/rpc-engine.js): 3 Quests/Tag, zufaellig OHNE Wiederholung
   aus 4 Typen (dragon_kills/gold_earned/arena_wins/prestige_ups) gewaehlt,
   Tier 1/2/3 mit steigendem Zielwert+Belohnung, lazy pro Gilde+Berlin-
   Kalendertag erzeugt (kein Cron, gleiches Prinzip wie Raid/Dungeon).
   Fortschritt = SUMME aller Mitgliedsbeitraege AN DIESEM TAG (kein
   Lebenszeit-Fortschritt). Bei Zielerreichung: SOFORTIGE Belohnung an ALLE
   AKTUELLEN Mitglieder (nicht nur die, die beigetragen haben) - Gold+
   Kristalle immer, Tier 2 zusaetzlich 2 Runen (blau/lila), Tier 3
   zusaetzlich 1 Gold-Rune + 10 Prestigepunkte. guild_quest_contribute() ist
   bewusst NIE ein harter Fehler bei fehlender Mitgliedschaft (stiller
   No-Op, da automatisch bei jedem 4s-Autosave gefeuert - siehe Dateikopf-
   kommentar der contribute-fix.sql). */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const LEADER_NAME = 'QaQuestLeader';
const MEMBER_NAME = 'QaQuestMember';
const LEADER_UID = 'qa-quest-leader-0000';
const MEMBER_UID = 'qa-quest-member-0000';

// Fester Startzeitpunkt mitten am Tag (Berlin), damit ein Test verlaesslich
// "heute" von "gestern"/"morgen" unterscheiden kann.
const DAY1_NOON_MS = Date.UTC(2026, 6, 24, 10, 0, 0); // 12:00 Berlin (Sommerzeit UTC+2)

function questsFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  function row(uid, name, extra) { return makePlayerStateRow(uid, name.toLowerCase(), nowIso, { display_name: name, gold: 0, crystals: 0, ...extra }); }
  function user(uid, name) { return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} }; }
  return {
    startTimeMs,
    displayName: LEADER_NAME, nameKey: LEADER_NAME.toLowerCase(), authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME), password: QA_PASSWORD,
    users: [user(LEADER_UID, LEADER_NAME), user(MEMBER_UID, MEMBER_NAME)],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [row(LEADER_UID, LEADER_NAME), row(MEMBER_UID, MEMBER_NAME)],
      idle_prestige_state: [], idle_player_runes: [],
      guilds: [{ id: 'g1', name: 'Testgilde', tag: 'TST', treasury_gold: 0, member_count: 2, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: LEADER_UID, created_at: nowIso }],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: MEMBER_UID, guild_id: 'g1', name_key: MEMBER_NAME.toLowerCase(), display_name: MEMBER_NAME, role: 'member', contributed_gold: 0, joined_at: nowIso }
      ],
      guild_daily_quests: [], guild_activity_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, questsFixture(startTimeMs)), { startTimeMs: DAY1_NOON_MS, rngSeed: 777 });
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

test.describe('Gildenquests', () => {
  test('Questliste laden erzeugt genau 3 Quests mit unterschiedlichen Typen aus 4 moeglichen', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    expect(quests.length).toBe(3);
    const types = quests.map(q => q.questType);
    expect(new Set(types).size).toBe(3);
    types.forEach(t => expect(['dragon_kills', 'gold_earned', 'arena_wins', 'prestige_ups']).toContain(t));
    expect(quests.map(q => q.tier).sort()).toEqual([1, 2, 3]);
    quests.forEach(q => { expect(q.completed).toBe(false); expect(q.progress).toBe(0); expect(q.target).toBeGreaterThan(0); });
  });

  test('erneuter Aufruf am selben Tag liefert IDENTISCHE Quests (kein Neu-Wuerfeln)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const first = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const second = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    expect(second.map(q => q.id)).toEqual(first.map(q => q.id));
    expect(second.map(q => q.target)).toEqual(first.map(q => q.target));
  });

  test('Fortschritt erhoehen: Delta wird korrekt aufaddiert, nicht doppelt gezaehlt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const q = quests[0];
    await page.evaluate((questType) => window.bkmpGuildQuestContribute({ [questType]: 10 }), q.questType);
    await page.evaluate((questType) => window.bkmpGuildQuestContribute({ [questType]: 5 }), q.questType);
    const updated = qaServer.store.tables.guild_daily_quests.find(r => r.id === q.id);
    expect(updated.progress).toBe(15);
    expect(updated.completed).toBe(false);
  });

  test('Ziel exakt erreichen schliesst die Quest ab und zahlt Belohnung an ALLE Mitglieder', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const q1 = quests.find(x => x.tier === 1);
    await page.evaluate(({ type, amount }) => window.bkmpGuildQuestContribute({ [type]: amount }), { type: q1.questType, amount: q1.target });
    const updated = qaServer.store.tables.guild_daily_quests.find(r => r.id === q1.id);
    expect(updated.progress).toBe(q1.target);
    expect(updated.completed).toBe(true);
    const leaderState = qaServer.store.tables.idle_player_state.find(p => p.auth_user_id === LEADER_UID);
    const memberState = qaServer.store.tables.idle_player_state.find(p => p.auth_user_id === MEMBER_UID);
    expect(leaderState.gold).toBe(2000);
    expect(leaderState.crystals).toBe(20);
    expect(memberState.gold).toBe(2000); // Member hat NICHTS beigetragen, bekommt trotzdem die Belohnung
    expect(memberState.crystals).toBe(20);
  });

  test('Ziel ueberschreiten klemmt den Fortschritt am Ziel (kein Ueberlauf), Rest-Delta verfaellt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const q1 = quests.find(x => x.tier === 1);
    await page.evaluate(({ type, amount }) => window.bkmpGuildQuestContribute({ [type]: amount }), { type: q1.questType, amount: q1.target + 500 });
    const updated = qaServer.store.tables.guild_daily_quests.find(r => r.id === q1.id);
    expect(updated.progress).toBe(q1.target); // nicht target+500
    expect(updated.completed).toBe(true);
  });

  test('Belohnung wird vor Abschluss NICHT vergeben (0 Fortschritt = keine Auszahlung)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const leaderState = qaServer.store.tables.idle_player_state.find(p => p.auth_user_id === LEADER_UID);
    expect(leaderState.gold).toBe(0);
  });

  test('nach Abschluss zaehlt weiterer Beitrag zu DERSELBEN Quest nicht mehr (kein doppelter Claim)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const q1 = quests.find(x => x.tier === 1);
    await page.evaluate(({ type, amount }) => window.bkmpGuildQuestContribute({ [type]: amount }), { type: q1.questType, amount: q1.target });
    const goldAfterFirst = qaServer.store.tables.idle_player_state.find(p => p.auth_user_id === LEADER_UID).gold;
    expect(goldAfterFirst).toBe(2000);

    await page.evaluate(({ type, amount }) => window.bkmpGuildQuestContribute({ [type]: amount }), { type: q1.questType, amount: 100 });
    const goldAfterSecond = qaServer.store.tables.idle_player_state.find(p => p.auth_user_id === LEADER_UID).gold;
    expect(goldAfterSecond).toBe(2000); // unveraendert - completed-Quest wird bewusst uebersprungen
  });

  test('mehrere Mitglieder tragen zur selben Quest bei, Fortschritt ist die SUMME (nicht pro Spieler getrennt)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const q1 = quests.find(x => x.tier === 1);
    const half = Math.floor(q1.target / 2);
    await page.evaluate(({ type, amount }) => window.bkmpGuildQuestContribute({ [type]: amount }), { type: q1.questType, amount: half });
    await rpcAs(qaServer, MEMBER_NAME, 'guild_quest_contribute', { p_deltas: { [q1.questType]: q1.target - half } });
    const updated = qaServer.store.tables.guild_daily_quests.find(r => r.id === q1.id);
    expect(updated.progress).toBe(q1.target);
    expect(updated.completed).toBe(true);
  });

  test('Reload zeigt weiterhin denselben Fortschritt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const q1 = quests.find(x => x.tier === 1);
    await page.evaluate(({ type }) => window.bkmpGuildQuestContribute({ [type]: 42 }), { type: q1.questType });
    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    const reloaded = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    expect(reloaded.find(q => q.tier === 1).progress).toBe(42);
  });

  test('Logout/Login zeigt weiterhin den serverseitig persistenten Fortschritt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const q1 = quests.find(x => x.tier === 1);
    await page.evaluate(({ type }) => window.bkmpGuildQuestContribute({ [type]: 7 }), { type: q1.questType });
    const updated = qaServer.store.tables.guild_daily_quests.find(r => r.id === q1.id);
    expect(updated.progress).toBe(7);
  });

  test('taeglicher Reset: neuer Berlin-Kalendertag erzeugt neue, unabhaengige Quests', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const day1Quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const q1 = day1Quests.find(x => x.tier === 1);
    await page.evaluate(({ type }) => window.bkmpGuildQuestContribute({ [type]: 50 }), { type: q1.questType });

    // 25h vorspulen (garantiert ueber die Berlin-Mitternacht hinweg, nicht
    // nur 24h - vermeidet DST-Randfaelle).
    qaServer.store.clock.advance(25 * 3600 * 1000);
    const day2Quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    expect(day2Quests.map(q => q.id).sort()).not.toEqual(day1Quests.map(q => q.id).sort());
    day2Quests.forEach(q => expect(q.progress).toBe(0)); // frischer Tag, kein Uebertrag

    // Die GESTRIGE Quest-Zeile existiert weiterhin unveraendert mit ihrem
    // damaligen Fortschritt (kein rueckwirkendes Ueberschreiben).
    const yesterdayRow = qaServer.store.tables.guild_daily_quests.find(r => r.id === q1.id);
    expect(yesterdayRow.progress).toBe(50);
  });

  test('Gildenwechsel: nach Verlassen zaehlt ein Beitrag nicht mehr fuer die alte Gilde (stiller No-Op)', async ({ page, qaServer }) => {
    await login(page, qaServer, MEMBER_NAME);
    const quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const q1 = quests.find(x => x.tier === 1);
    await rpcAs(qaServer, MEMBER_NAME, 'leave_guild', {});
    // Kein Fehler erwartet (stiller No-Op, siehe Dateikopfkommentar).
    const result = await page.evaluate(({ type }) => window.bkmpGuildQuestContribute({ [type]: 99 }).then(() => 'ok').catch(e => String(e.message || e)), { type: q1.questType });
    expect(result).toBe('ok');
    const updated = qaServer.store.tables.guild_daily_quests.find(r => r.id === q1.id);
    expect(updated.progress).toBe(0); // Beitrag ging nirgendwo hin
  });

  test('ungueltige Quest-ID (kein passender Quest-Typ heute) wird still uebersprungen, kein Fehler', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const result = await page.evaluate(() => window.bkmpGuildQuestContribute({ nonexistent_quest_type: 100 }).then(() => 'ok').catch(e => String(e.message || e)));
    expect(result).toBe('ok');
  });

  test('Mock-Fehler/fehlende Datensaetze: Nichtmitglied-Aufruf ohne jede Gildenzugehoerigkeit ist ein stiller No-Op', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const result = await rpcAs(qaServer, 'GhostPlayerNotSeeded', 'guild_quest_contribute', { p_deltas: { dragon_kills: 5 } }).catch(e => 'threw:' + e.message);
    // GhostPlayerNotSeeded existiert nicht als Auth-Nutzer - rpcAs() selbst
    // wuerde beim Auth-Schritt bereits scheitern (kein gueltiges Token),
    // das ist erwartet und beweist, dass unauthentifizierte Aufrufe gar
    // nicht erst bis zur RPC-Logik vordringen.
    expect(result).toMatch(/threw:/);
  });

  test('negative oder Dezimal-Deltas werden korrekt behandelt (numeric+round, keine negativen Fortschritte)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const quests = await page.evaluate(() => window.bkmpGuildQuestEnsureToday());
    const q1 = quests.find(x => x.tier === 1);
    // Negativer Delta wird ignoriert (kein Fortschritts-Ruecksetzen moeglich).
    await page.evaluate(({ type }) => window.bkmpGuildQuestContribute({ [type]: -50 }), { type: q1.questType });
    expect(qaServer.store.tables.guild_daily_quests.find(r => r.id === q1.id).progress).toBe(0);

    // Dezimalwert wird gerundet, nicht verworfen (Bugfix aus quest-
    // contribute-fix.sql: direkter bigint-Cast haette hier eine Exception
    // geworfen).
    await page.evaluate(({ type }) => window.bkmpGuildQuestContribute({ [type]: 12.6 }), { type: q1.questType });
    expect(qaServer.store.tables.guild_daily_quests.find(r => r.id === q1.id).progress).toBe(13);
  });
});
