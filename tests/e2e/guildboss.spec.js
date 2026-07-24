/* Phase 4 (24.07.2026, siehe CLAUDE.md) - Gildenboss-Tests. Zweite Haelfte
   der in Phase 2/3 dokumentierten Mock-Luecke ("Raid/Weltboss und
   Gildenboss sind noch nicht ausreichend gemockt oder getestet").

   RPC-Quellen (siehe rpc-engine.js's Kommentar am Gildenboss-Abschnitt fuer
   die vollstaendige Herleitung):
     - guild_boss_join: sql/supabase-guild-boss-ambiguous-status-fix.sql
       (behebt "column reference is ambiguous" der Basisversion aus
       supabase-guild-boss.sql - reine SQL-Alias-Korrektur)
     - guild_boss_deal_damage: sql/supabase-guild-boss-damage-sync-fix.sql
       (own_*-Rueckgabespalten, baut auf der ambiguous-status-fix.sql-Fassung
       auf)
     - guild_boss_finish (intern): sql/supabase-guild-boss.sql (einzige
       Fassung - weder von den beiden Fixes oben noch von -reward-increase.sql
       (reine Datenaenderung: gold_reward 200k->5.000.000, gem_reward
       1.000->20.000) noch von -retro-payout.sql (einmaliges Backfill-Skript,
       keine Funktionsaenderung) erneut definiert)

   Anders als der Weltboss-Raid: KEIN Gegenangriff-Konzept (reiner DPS-
   Wettlauf gegen die Zeit), KEIN wood/stone/essence-Reward (nur Gold+
   Kristalle), Belohnung nur an Teilnehmer MIT damage_dealt>0 (Raid filtert
   nicht). guild_boss_deal_damage() prueft NUR guild_boss_participants, NICHT
   die aktuelle Gildenmitgliedschaft - ein Spieler, der NACH dem Beitritt die
   Gilde verlaesst, kann technisch weiter Schaden einreichen (echtes,
   bestehendes Verhalten, kein Test-Fehler).

   Sync nach Sieg laeuft ueber bkmpIdleMergeRemoteSpendableFields() (bereits
   an mehreren Stellen in CLAUDE.md dokumentiert/gefixt), NICHT ueber eine
   eigene, einfache Feld-Kopier-Funktion wie beim Raid - wird hier ueber die
   echte Produktionsfunktion getestet, nicht neu nachgebaut.

   Zeitfenster: taeglich 19:55-21:00 Europe/Berlin (Vorbereitung ab 19:55,
   Kampf 20:00-21:00). Im Juli gilt Sommerzeit (UTC+2): 20:00 Berlin = 18:00
   UTC.

   Lektionen aus raid.spec.js direkt uebernommen (identische Bugklassen
   proaktiv vermieden, nicht erst wieder gefunden):
     - *_collected_at auf ECHTE Wanduhrzeit setzen, nicht auf die kuenstliche
       Kampf-Zeitleiste (sonst bogus Produktionsgebaeude-Ertrag)
     - waitForDragonReady() VOR bkmpIdleStopLoop() (sonst Race mit dem noch
       nicht gestarteten Auto-Tick-Loop)
     - nach jedem Reload: last_seen_at auf store.clock zurechtruecken, BEVOR
       das Oeffnen den Offline-Abgleich ausloest (sonst bogus Offline-
       Kampf-Simulation durch Clock-Source-Mismatch) */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const LEADER_UID = 'qa-gboss-leader-0000';
const LEADER_NAME = 'QaGBossLead';
const MEMBER_UID = 'qa-gboss-member-0000';
const MEMBER_NAME = 'QaGBossMem';
const NONMEMBER_UID = 'qa-gboss-nonmem-0000';
const NONMEMBER_NAME = 'QaGBossNon';
const OTHERGUILD_UID = 'qa-gboss-other-0000';
const OTHERGUILD_NAME = 'QaGBossOther';

const GUILD_BOSS = {
  id: 'grimlok', name: 'Malthyros, der Weltenverschlinger', sprite_key: 'malthyros',
  base_hp: 2000000, hp_scale_per_attack: 150, gold_reward: 5000000, gem_reward: 20000, active: true
};

// 20:00 Europe/Berlin (Sommerzeit, UTC+2) am 24.07.2026 = 18:00 UTC.
const FIGHT_START_MS = Date.UTC(2026, 6, 24, 18, 0, 0);
const OUTSIDE_WINDOW_MS = Date.UTC(2026, 6, 24, 10, 0, 0);

function guildBossFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  const realNowIso = new Date().toISOString();
  function row(uid, name, extra) {
    return makePlayerStateRow(uid, name.toLowerCase(), nowIso, {
      display_name: name, level: 50, gold: 0, crystals: 0, attack: 1, defense: 1, hp: 1,
      fruit_collected_at: realNowIso, meat_collected_at: realNowIso,
      holzfaeller_collected_at: realNowIso, steinbruch_collected_at: realNowIso,
      goldmine_collected_at: realNowIso, kristallmine_collected_at: realNowIso,
      manaquelle_collected_at: realNowIso, magierakademie_collected_at: realNowIso,
      ...extra
    });
  }
  function user(uid, name) { return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} }; }
  return {
    startTimeMs,
    displayName: LEADER_NAME,
    nameKey: LEADER_NAME.toLowerCase(),
    authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME),
    password: QA_PASSWORD,
    users: [user(LEADER_UID, LEADER_NAME), user(MEMBER_UID, MEMBER_NAME), user(NONMEMBER_UID, NONMEMBER_NAME), user(OTHERGUILD_UID, OTHERGUILD_NAME)],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [
        row(LEADER_UID, LEADER_NAME, { attack: 100 }),
        row(MEMBER_UID, MEMBER_NAME, { attack: 50 }),
        row(NONMEMBER_UID, NONMEMBER_NAME, {}),
        row(OTHERGUILD_UID, OTHERGUILD_NAME, {})
      ],
      idle_prestige_state: [], idle_player_runes: [],
      guild_bosses: [{ ...GUILD_BOSS }],
      guild_boss_instances: [], guild_boss_participants: [], guild_boss_player_stats: [],
      guilds: [
        { id: 'g1', name: 'Testgilde', tag: 'TST', bosses_defeated: 0, boss_attempts: 0, member_count: 2, bonus_member_slots: 0, leader_auth_user_id: LEADER_UID, treasury_gold: 0, is_public: true, created_at: nowIso },
        { id: 'g2', name: 'Andere Gilde', tag: 'AND', bosses_defeated: 0, boss_attempts: 0, member_count: 1, bonus_member_slots: 0, leader_auth_user_id: OTHERGUILD_UID, treasury_gold: 0, is_public: true, created_at: nowIso }
      ],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: MEMBER_UID, guild_id: 'g1', name_key: MEMBER_NAME.toLowerCase(), display_name: MEMBER_NAME, role: 'member', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: OTHERGUILD_UID, guild_id: 'g2', name_key: OTHERGUILD_NAME.toLowerCase(), display_name: OTHERGUILD_NAME, role: 'leader', contributed_gold: 0, joined_at: nowIso }
      ],
      guild_activity_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, guildBossFixture(startTimeMs)), { startTimeMs: FIGHT_START_MS - 2 * 60000 });
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
  await waitForDragonReady(page);
  await page.evaluate(() => bkmpIdleStopLoop());
}

async function openWithoutLogin(page, qaServer) {
  await page.goto(qaServer.url('/'));
  await expect(page.locator('#mcNameOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await page.evaluate(() => { const h = document.querySelector('[data-qa-hide]'); if (h) h.click(); });
}

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

test.describe('Gildenboss-Kernmechanik', () => {
  test('Beitritt ohne Login schlägt fehl', async ({ page, qaServer }) => {
    await openWithoutLogin(page, qaServer);
    // Anders als joinRaid() (supabase.js:3877, eigener Client-seitiger
    // "melde dich an"-Vorab-Check) hat bkmpGuildBossJoin() KEINEN solchen
    // Vorab-Check (nur "Supabase ist nicht verbunden" bei fehlendem Client
    // selbst) - der RPC-Aufruf laeuft anonym durch und die Servermeldung
    // "not_authenticated" wird ungefiltert in die generische
    // Fehlermeldung eingebettet (supabase.js:4750). Bestaetigtes, echtes
    // Verhalten, keine Test-Erwartung an einen nicht existierenden Text.
    const result = await page.evaluate(() => window.bkmpGuildBossJoin().then(() => 'ok').catch(e => String(e.message || e)));
    expect(result).toMatch(/not_authenticated/);
  });

  test('Nichtmitglied wird abgewiesen', async ({ page, qaServer }) => {
    await login(page, qaServer, NONMEMBER_NAME);
    const result = await page.evaluate(() => window.bkmpGuildBossJoin().then(() => 'ok').catch(e => String(e.message || e)));
    expect(result).toMatch(/keiner Gilde/);
  });

  test('Beitritt während der Vorbereitungsphase liefert Status "prep"', async ({ page, qaServer }) => {
    // Fixture-Start (FIGHT_START_MS - 2min) liegt bereits in 19:55-20:00
    // Berlin - keine Zeitmanipulation noetig.
    await login(page, qaServer, LEADER_NAME);
    const result = await page.evaluate(() => window.bkmpGuildBossJoin());
    expect(result.status).toBe('prep');
    expect(result.bossHp).toBe(2000000);
  });

  test('Mitglied darf teilnehmen und Boss-HP skaliert nach GESAMTER Gildenangriffskraft (nicht nur Beigetretene)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const result = await page.evaluate(() => window.bkmpGuildBossJoin());
    // total_attack = SUMME ALLER Gildenmitglieder (Leader 100 + Member 50 =
    // 150), auch wenn nur der Leader bisher beigetreten ist - siehe
    // guild_boss_join()-Kommentar in rpc-engine.js.
    expect(result.bossMaxHp).toBe(Math.max(2000000, Math.round(150 * 150))); // = 2000000 (base_hp dominiert)
    expect(result.bossHp).toBe(2000000);
    expect(result.status).toBe('fighting');
    expect(result.bossName).toBe('Malthyros, der Weltenverschlinger');
  });

  test('Beitritt außerhalb des Zeitfensters schlägt fehl', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(OUTSIDE_WINDOW_MS);
    const result = await page.evaluate(() => window.bkmpGuildBossJoin().then(() => 'ok').catch(e => String(e.message || e)));
    expect(result).toMatch(/nicht aktiv/);
  });

  test('Schaden verringert Boss-HP exakt, eigener Beitrag wird korrekt gezählt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    const result = await page.evaluate((instanceId) => window.bkmpGuildBossDealDamage(instanceId, 12345, false, true), joined.instanceId);
    expect(result.bossHp).toBe(2000000 - 12345);
    expect(result.ownDamageDealt).toBe(12345);
    expect(result.ownClicksLanded).toBe(1);
    expect(result.status).toBe('fighting');
  });

  test('falsche Gilde: Mitglied einer anderen Gilde ohne Beitritt kann keinen Schaden einreichen', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    // OTHERGUILD_NAME ist Mitglied von g2, nie diesem g1-Kampf beigetreten -
    // guild_boss_deal_damage() prueft NUR guild_boss_participants, nicht die
    // aktuelle Gildenzugehoerigkeit (echtes, bestehendes Verhalten).
    let threw = null;
    try { await rpcAs(qaServer, OTHERGUILD_NAME, 'guild_boss_deal_damage', { p_instance_id: joined.instanceId, p_amount: 1000, p_is_crit: false, p_is_click: false }); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/not_a_participant/);
  });

  test('Boss-HP fällt nie unter 0 (Overkill-Schaden wird geklemmt)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    // 2.000.000 Boss-HP, 200000 Anti-Cheat-Deckel PRO Treffer (siehe
    // invalid_amount-Test unten) - 9x200000 + 1x150000 = 1.950.000, laesst
    // absichtlich nur noch 50.000 HP fuer den letzten Treffer uebrig, damit
    // dieser (200000 gegen nur noch 50000 Rest-HP) ein ECHTER Overkill-Treffer
    // ist, der geklemmt werden muss - eine vorherige Fassung traf zufaellig
    // exakt 0 (kein echter Overkill-Test).
    let result;
    for (let i = 0; i < 9; i++) {
      result = await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 200000, false, false), { instanceId: joined.instanceId });
    }
    expect(result.bossHp).toBe(200000);
    result = await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 150000, false, false), { instanceId: joined.instanceId });
    expect(result.bossHp).toBe(50000);
    result = await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 200000, false, false), { instanceId: joined.instanceId });
    expect(result.bossHp).toBe(0);
    expect(result.status).toBe('won');
    expect(Number.isNaN(result.bossHp)).toBe(false);
  });

  test('ungültige Schadenswerte (0, negativ, zu groß, NaN, Infinity) werden abgelehnt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    const cases = await page.evaluate(async (instanceId) => {
      async function attempt(amount) {
        try {
          const c = window.bkmpGetPlayerAuthClient();
          const { error } = await c.rpc('guild_boss_deal_damage', { p_instance_id: instanceId, p_amount: amount, p_is_crit: false, p_is_click: false });
          return error ? String(error.message) : 'ok';
        } catch (e) { return String(e && e.message || e); }
      }
      return { zero: await attempt(0), negative: await attempt(-500), tooLarge: await attempt(200001), nan: await attempt(NaN), infinity: await attempt(Infinity) };
    }, joined.instanceId);
    Object.values(cases).forEach(msg => expect(msg).toMatch(/invalid_amount/));

    const state = await page.evaluate((instanceId) => window.loadGuildBossInstance(instanceId), joined.instanceId);
    expect(state.bossHp).toBe(2000000);
    expect(Number.isNaN(state.bossHp)).toBe(false);
  });

  test('parallele Angriffe zweier Mitglieder werden beide korrekt gezählt (Gesamtschaden = Summe)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    await rpcAs(qaServer, MEMBER_NAME, 'guild_boss_join', {});

    await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 30000, false, false), { instanceId: joined.instanceId });
    await rpcAs(qaServer, MEMBER_NAME, 'guild_boss_deal_damage', { p_instance_id: joined.instanceId, p_amount: 20000, p_is_crit: false, p_is_click: false });

    const state = await page.evaluate((instanceId) => window.loadGuildBossInstance(instanceId), joined.instanceId);
    expect(state.totalDamage).toBe(50000);
    const participants = await page.evaluate((instanceId) => window.loadGuildBossParticipants(instanceId), joined.instanceId);
    expect(participants.find(p => p.displayName === LEADER_NAME).damageDealt).toBe(30000);
    expect(participants.find(p => p.displayName === MEMBER_NAME).damageDealt).toBe(20000);
  });

  test('Boss besiegt: Belohnung wird proportional zum Schadensanteil verteilt (exakte Beträge), nur an Teilnehmer mit Schaden > 0', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    await rpcAs(qaServer, MEMBER_NAME, 'guild_boss_join', {});

    // Leader 1.500.000 (75%), Member 500.000 (25%) - exakt 2.000.000, Sieg.
    for (let i = 0; i < 7; i++) {
      await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 200000, false, false), { instanceId: joined.instanceId });
    }
    await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 100000, false, false), { instanceId: joined.instanceId });
    // Member: 200000 + 200000 + 100000 = 500000 (200000-Deckel pro Treffer
    // erzwingt drei statt einem einzelnen Treffer).
    await rpcAs(qaServer, MEMBER_NAME, 'guild_boss_deal_damage', { p_instance_id: joined.instanceId, p_amount: 200000, p_is_crit: false, p_is_click: false });
    await rpcAs(qaServer, MEMBER_NAME, 'guild_boss_deal_damage', { p_instance_id: joined.instanceId, p_amount: 200000, p_is_crit: false, p_is_click: false });
    // rpcAs() gibt die rohe RPC-Antwort zurueck - der Mock liefert (wie das
    // echte PostgREST fuer diese RETURNS-TABLE-Funktion bei Einzelzeile auch
    // tut ueber supabase-js' Unwrapping) ein einzelnes Objekt, kein Array.
    const final = await rpcAs(qaServer, MEMBER_NAME, 'guild_boss_deal_damage', { p_instance_id: joined.instanceId, p_amount: 100000, p_is_crit: false, p_is_click: false });
    expect(final.status).toBe('won');

    const leaderPlayer = await page.evaluate((name) => window.loadIdlePlayerState(name), LEADER_NAME);
    expect(leaderPlayer.gold).toBe(Math.round(5000000 * 0.75));
    expect(leaderPlayer.crystals).toBe(Math.round(20000 * 0.75));

    const memberPlayer = await page.evaluate((name) => window.loadIdlePlayerState(name), MEMBER_NAME);
    expect(memberPlayer.gold).toBe(Math.round(5000000 * 0.25));
    expect(memberPlayer.crystals).toBe(Math.round(20000 * 0.25));

    const guildRow = qaServer.store.tables.guilds.find(g => g.id === 'g1');
    expect(guildRow.bosses_defeated).toBe(1);
  });

  test('Teilnehmer OHNE eigenen Schaden bekommt keine Belohnung (Mindestbeitrag = Schaden > 0)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    await rpcAs(qaServer, MEMBER_NAME, 'guild_boss_join', {}); // beigetreten, aber nie Schaden eingereicht

    for (let i = 0; i < 9; i++) {
      await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 200000, false, false), { instanceId: joined.instanceId });
    }
    await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 200000, false, false), { instanceId: joined.instanceId });

    const memberPlayer = await page.evaluate((name) => window.loadIdlePlayerState(name), MEMBER_NAME);
    expect(memberPlayer.gold).toBe(0);
    expect(memberPlayer.crystals).toBe(0);
    const memberStats = await page.evaluate((name) => window.loadGuildBossLeaderboard().then(rows => rows.find(r => r.displayName === name)), MEMBER_NAME);
    expect(memberStats.totalBossesDefeated).toBe(0); // nicht mitgezaehlt (damage_dealt=0-Filter in guild_boss_finish)
  });

  test('nach Sieg schlägt weiterer Schaden fehl (kein doppelter Abschluss / keine doppelte Belohnung)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    for (let i = 0; i < 9; i++) {
      await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 200000, false, false), { instanceId: joined.instanceId });
    }
    await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 200000, false, false), { instanceId: joined.instanceId });

    const goldAfterWin = (await page.evaluate((name) => window.loadIdlePlayerState(name), LEADER_NAME)).gold;
    expect(goldAfterWin).toBe(5000000);

    const err = await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 100, false, false).then(r => (r && r.final) ? 'final' : JSON.stringify(r)).catch(e => String(e.message || e)), { instanceId: joined.instanceId });
    // bkmpGuildBossDealDamage() (supabase.js) faengt boss_not_active/
    // boss_not_found selbst ab und liefert { final: true } statt zu werfen.
    expect(err).toBe('final');

    const goldAfterSecondAttempt = (await page.evaluate((name) => window.loadIdlePlayerState(name), LEADER_NAME)).gold;
    expect(goldAfterSecondAttempt).toBe(5000000);
  });

  test('Kampf läuft nach Ablauf des Zeitfensters automatisch als "expired" aus - keine Belohnung', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 10000, false, false), { instanceId: joined.instanceId });

    qaServer.store.clock.setNow(FIGHT_START_MS + 61 * 60000); // Fenster endet 19:00 UTC (21 Uhr Berlin)
    // Anders als bei "boss_not_active"/"boss_not_found" (siehe naechster
    // Test) ist der Zeitablauf-Fall in guild_boss_deal_damage() (siehe
    // sql/supabase-guild-boss-damage-sync-fix.sql:61-67) KEIN Fehler -
    // die Funktion schliesst den Kampf intern ab und liefert ganz normal
    // (Status 200) den neuen Status "expired" zurueck, kein {final:true}
    // (das setzt bkmpGuildBossDealDamage()/supabase.js nur im catch-Zweig
    // eines echten RPC-Fehlers). Bestaetigtes, echtes Verhalten - dieser
    // Treffer selbst zaehlt NICHT mehr (kein bossHp-Rueckgang), da die
    // Funktion vor dem Schadens-Update returnt.
    const result = await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 100, false, false), { instanceId: joined.instanceId });
    expect(result.status).toBe('expired');
    expect(result.bossHp).toBe(2000000 - 10000); // nur der erste, VOR dem Ablauf eingereichte Treffer zaehlte

    const state = await page.evaluate((instanceId) => window.loadGuildBossInstance(instanceId), joined.instanceId);
    expect(state.status).toBe('expired');
    const player = await page.evaluate((name) => window.loadIdlePlayerState(name), LEADER_NAME);
    expect(player.gold).toBe(0);
  });

  test('Verlassen der Gilde nach Beitritt verhindert weiteren Schaden NICHT (bestehendes, echtes Verhalten)', async ({ page, qaServer }) => {
    await login(page, qaServer, MEMBER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    // Mitglied verlaesst die Gilde NACH dem Beitritt zum Gildenboss.
    await rpcAs(qaServer, MEMBER_NAME, 'leave_guild', {});
    const result = await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 5000, false, false), { instanceId: joined.instanceId });
    expect(result.ownDamageDealt).toBe(5000);
    expect(result.bossHp).toBe(2000000 - 5000);
  });

  test('Reload nach einem Sieg zeigt den bereits gutgeschriebenen Ressourcenstand', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    for (let i = 0; i < 9; i++) {
      await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 200000, false, false), { instanceId: joined.instanceId });
    }
    await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 200000, false, false), { instanceId: joined.instanceId });

    /* bkmpIdleMergeRemoteSpendableFields() (echte Produktionsfunktion, siehe
       bkmpGuildBossCheckOutcome()-Kommentar in bkmp-guild.js) ist per Absicht
       ADDITIV: neuer Serverwert + eigener LOKALER Delta seit der letzten
       Baseline (idledorf.js:1740-1743) - anders als bei raid.spec.js's
       simplem Feld-Kopieren gibt es hier also keine Garantie auf "genau der
       Server-Wert". bkmpIdleStopLoop() (siehe login()) unterbindet nur
       KUENFTIGE Ticks, kann aber einen bereits VOR dem Stop gefeuerten
       Kampf-Tick des Hauptkampf-Loops (unabhaengig vom hier getesteten
       Gildenboss) nicht rueckgaengig machen - ein einzelner Treffer auf den
       frisch gespawnten Startdrachen koennte theoretisch schon ein paar Gold
       lokal gutgeschrieben haben, BEVOR ueberhaupt der Gildenboss-Kampf
       beginnt. Um trotzdem eine feste, deterministische Erwartungszahl
       pruefen zu koennen (statt eines vagen "irgendwas beliebiges kommt
       zurueck"), wird der lokale Stand der beiden hier gepruesten Felder
       unmittelbar vor dem Abgleich explizit auf 0 zurueckgesetzt - kein
       Eingriff in bkmpIdleMergeRemoteSpendableFields() selbst, nur eine
       saubere, kontrollierte Ausgangslage fuer DIESEN Test. */
    await page.evaluate(() => { bkmpIdleState.gold = 0; bkmpIdleState.crystals = 0; });
    await page.evaluate(() => window.bkmpIdleMergeRemoteSpendableFields());

    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    // Siehe Datei-Kopfkommentar: last_seen_at nach dem beforeunload-Flush
    // (echte Wanduhrzeit) wieder auf store.clock zurechtruecken, BEVOR das
    // Oeffnen den Offline-Abgleich ausloest.
    qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === LEADER_UID).last_seen_at = qaServer.store.clock.nowIso();
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForIdleStateReady(page);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    const player = await page.evaluate((name) => window.loadIdlePlayerState(name), LEADER_NAME);
    expect(player.gold).toBe(5000000);
    expect(player.crystals).toBe(20000);
  });

  test('Logout/Login: nach erneutem Login zeigt der Server weiterhin den korrekten Stand', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    const joined = await page.evaluate(() => window.bkmpGuildBossJoin());
    for (let i = 0; i < 9; i++) {
      await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 200000, false, false), { instanceId: joined.instanceId });
    }
    await page.evaluate(({ instanceId }) => window.bkmpGuildBossDealDamage(instanceId, 200000, false, false), { instanceId: joined.instanceId });

    const player = await page.evaluate((name) => window.loadIdlePlayerState(name), LEADER_NAME);
    expect(player.gold).toBe(5000000); // serverseitig unabhaengig vom Client-Login-Status korrekt
  });
});
