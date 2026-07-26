/* Gilden-Technologie v2 (26.07.2026) - 10 neue Zweige (Nutzerwunsch: die 9
   bestehenden STANDARD-Zweige waren alle Stufe 20/20, die Kasse hatte nichts
   mehr zu tun). Siehe sql/20260726-guild-tech-branches-v2.sql fuer die
   serverseitige Herleitung/Kommentare, js/systems/bkmp-guild.js fuer
   BKMP_GUILD_TECH_CATALOG_EXT/BKMP_GUILD_TECH_TIER.

   Zwei Test-Strategien, je nachdem wo der Effekt tatsaechlich lebt:
   - Kriegsrat/Stadtmauer/Nachtwache aendern echte SERVERSEITIGE RPC-/API-
     Logik (arena_attack/raid_join/api/claim-idle-offline-progress.js) -
     brauchen eine echte Gilde+Kauf im Mock-Store, kein Cache-Trick moeglich.
   - Die uebrigen 7 (inkl. der beiden client-seitig SPEZIELL berechneten,
     Turm-Vorreiter/Willkommenspaket) landen am Ende alle im selben
     localStorage-Cache (bkmp-guild-tech-cache, bkmpGuildTechBonus()) -
     die READ-Seite (wirkt der Bonus korrekt in Brutzeit/Runenkosten/Auto-
     Kauf/Streak/Aufstieg?) laesst sich direkt per Cache-Injektion pruefen,
     schnell und ohne echten Gilden-Kauf-Roundtrip. Die WRITE-Seite (fuellt
     ein echter Kauf den Cache korrekt?) wird separat in der Guild-Fixture
     abgedeckt (Turm-Vorreiter/Willkommenspaket/generischer Cache-Test). */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const LEADER_NAME = 'QaExtLeader';
const MEMBER_NAME = 'QaExtMember';
const LEADER_UID = 'qa-ext-leader-0000';
const MEMBER_UID = 'qa-ext-member-0000';
const RAID_BOSS = {
  id: 'zerathor', name: 'Zerathor, Zorn der Verdammnis', sprite_key: 'zerathor',
  base_hp: 500000, base_attack: 90, attack_interval_seconds: 6, hp_scale_per_attack: 150,
  gold_reward: 1500000, gem_reward: 1000, xp_reward: 150000,
  wood_reward: 50000, stone_reward: 50000, essence_reward: 2000, active: true
};

function extFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  function row(uid, name, extra) {
    return makePlayerStateRow(uid, name.toLowerCase(), nowIso, { display_name: name, gold: 0, attack: 100, defense: 50, hp: 2000, ...extra });
  }
  function user(uid, name) { return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} }; }
  return {
    startTimeMs,
    displayName: LEADER_NAME, nameKey: LEADER_NAME.toLowerCase(), authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME), password: QA_PASSWORD,
    users: [user(LEADER_UID, LEADER_NAME), user(MEMBER_UID, MEMBER_NAME)],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [row(LEADER_UID, LEADER_NAME), row(MEMBER_UID, MEMBER_NAME)],
      idle_prestige_state: [],
      idle_player_runes: [
        { id: 'qa-ext-rune-1', name_key: LEADER_NAME.toLowerCase(), auth_user_id: LEADER_UID, rune_type: 'slot5', rarity: 'blue', rolled_value: 10, equipped: true, upgrade_level: 3, substats: [], created_at: nowIso }
      ],
      guilds: [{ id: 'g1', name: 'Testgilde Ext', tag: 'EXT', treasury_gold: 50000000, member_count: 2, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: LEADER_UID, created_at: nowIso }],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: MEMBER_UID, guild_id: 'g1', name_key: MEMBER_NAME.toLowerCase(), display_name: MEMBER_NAME, role: 'member', contributed_gold: 0, joined_at: nowIso }
      ],
      guild_tech_levels: [], guild_activity_log: [],
      raid_bosses: [{ ...RAID_BOSS }], raid_instances: [], raid_participants: [], raid_player_stats: [],
      arena_ratings: [], arena_battle_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, extFixture(startTimeMs)), { startTimeMs: Date.now() });
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

async function buyTech(page, techId, times) {
  let result = null;
  for (let i = 0; i < (times || 1); i++) {
    result = await page.evaluate((id) => window.bkmpGuildTechUpgrade(id), techId);
  }
  return result;
}

test.describe('Gilden-Technologie v2 - generische Zweig-Infrastruktur', () => {
  test('Kostenkurve/Maximalstufe je Tier korrekt durchgesetzt (LOW vs. MED vs. TOGGLE, Rebalance 26.07.)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    // LOW (Kriegsrat): max. 15 Stufen (Rebalance, vorher 5), Basis 600000, Wachstum 1.5.
    const kriegsrat1 = await buyTech(page, 'guild_kriegsrat');
    expect(kriegsrat1.newLevel).toBe(1);
    expect(50000000 - kriegsrat1.treasuryGold).toBe(600000);
    // Maxen aller 15 Stufen kostet insgesamt ca. 524M - deutlich mehr als die
    // Standard-Fixture-Kasse (50M), daher hier gezielt aufgestockt (reine
    // Testvorbereitung, kein Produktivwert).
    qaServer.store.tables.guilds.find(g => g.id === 'g1').treasury_gold = 1000000000;
    await buyTech(page, 'guild_kriegsrat', 14); // insgesamt 15 Kaeufe -> Stufe 15, Maximalstufe
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildTechUpgrade('guild_kriegsrat')); } catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/Maximalstufe/);

    // TOGGLE (Streak-Schutz): max. 1 Stufe, fester Preis 8.000.000 (Rebalance, vorher 1.500.000).
    const toggle1 = await buyTech(page, 'guild_streak_schutz');
    expect(toggle1.newLevel).toBe(1);
    let toggleThrew = null;
    try { await page.evaluate(() => window.bkmpGuildTechUpgrade('guild_streak_schutz')); } catch (e) { toggleThrew = String(e.message || e); }
    expect(toggleThrew).toMatch(/Maximalstufe/);
  });

  test('Paragon-Fortfuehrung: erst ab Maximalstufe kaufbar, laeuft mit steigenden Kosten weiter (max. Rang 1000)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.tables.guilds.find(g => g.id === 'g1').treasury_gold = 5000000000;

    // Paragon VOR Erreichen der normalen Maximalstufe muss abgelehnt werden.
    let tooEarly = null;
    try { await page.evaluate(() => window.bkmpGuildTechUpgrade('guild_kriegsrat__paragon')); } catch (e) { tooEarly = String(e.message || e); }
    expect(tooEarly).toBeTruthy();

    await buyTech(page, 'guild_kriegsrat', 15); // volle Maximalstufe
    const beforeParagon = qaServer.store.tables.guilds.find(g => g.id === 'g1').treasury_gold;
    const paragon1 = await buyTech(page, 'guild_kriegsrat__paragon');
    expect(paragon1.newLevel).toBe(1);
    // Erste Paragon-Stufe kostet exakt die vorab berechnete Basis (siehe
    // sql/20260726-guild-tech-rebalance-paragon.sql / bkmpGuildTechParagonCost()).
    expect(beforeParagon - paragon1.treasuryGold).toBe(289009968);

    const paragon2 = await buyTech(page, 'guild_kriegsrat__paragon');
    expect(paragon2.newLevel).toBe(2);
    expect(paragon2.treasuryGold).toBeLessThan(paragon1.treasuryGold); // Kosten steigen weiter (Wachstum 1.65)

    // bkmpGuildTechBonus() muss den Paragon-Anteil (4% des normalen
    // Effekts pro Rang) zusaetzlich zum normalen Maximalstufen-Effekt zeigen.
    await page.evaluate(() => bkmpGuildRefreshTreasuryBonusCache());
    const bonus = await page.evaluate(() => bkmpGuildTechBonus('arenaExtraAttempts'));
    // 15 normale Stufen x 1 + 2 Paragon-Raenge x 0,04 = 15,08
    expect(bonus).toBeCloseTo(15.08, 5);
  });

  test('Nur Anfuehrer/Stellvertreter duerfen einen neuen Zweig kaufen (RPC selbst, nicht nur UI)', async ({ page, qaServer }) => {
    await login(page, qaServer, MEMBER_NAME);
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildTechUpgrade('guild_nachtwache')); } catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/Anführer/);
  });

  test('Nach einem echten Kauf spiegelt bkmpGuildRefreshTreasuryBonusCache() ALLE 8 einfachen EXT-Zweige korrekt in den Cache', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await buyTech(page, 'guild_brutbeschleuniger', 3); // 3 x 1% = 3%
    await buyTech(page, 'guild_schmiede', 2); // 2 x 1% = 2%
    await buyTech(page, 'guild_autokauf', 4); // 4 x 2 = 8
    await buyTech(page, 'guild_nachtwache', 2); // 2 x 0.5 = 1 Std.
    await buyTech(page, 'guild_stadtmauer', 3); // 3 x 1% = 3%
    await buyTech(page, 'guild_aufstiegsvorbereitung', 2); // 2 x 2% = 4%
    await buyTech(page, 'guild_kriegsrat', 2); // 2 x 1 = 2 Versuche
    await buyTech(page, 'guild_streak_schutz'); // TOGGLE -> 1

    await page.evaluate(() => bkmpGuildRefreshTreasuryBonusCache());
    const cache = await page.evaluate(() => bkmpIdleGetGuildTechCache());
    expect(cache.broodSpeedPct).toBeCloseTo(3, 5);
    expect(cache.runeUpgradeDiscountPct).toBeCloseTo(2, 5);
    expect(cache.autobuyExtraPurchases).toBeCloseTo(8, 5);
    expect(cache.offlineCapExtraHours).toBeCloseTo(1, 5);
    expect(cache.raidCityHpPct).toBeCloseTo(3, 5);
    expect(cache.ascensionThresholdDiscountPct).toBeCloseTo(4, 5);
    expect(cache.arenaExtraAttempts).toBeCloseTo(2, 5);
    expect(cache.streakProtectUnlock).toBeCloseTo(1, 5);
  });
});

test.describe('Gilden-Technologie v2 - Kriegsrat (Arena-Tageslimit)', () => {
  test('erhoeht das serverseitige Tageslimit um +1 pro Stufe - RPC selbst, nicht nur Anzeige', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await buyTech(page, 'guild_kriegsrat', 2); // +2 -> Limit 12
    await page.evaluate(() => bkmpGuildRefreshTreasuryBonusCache());

    // Als Leader (selbst Gildenmitglied mit dem Zweig) GENAU 12 Angriffe
    // gegen das MITGLIED ausfuehren (das volle, erweiterte Tageslimit) -
    // NICHT gegen sich selbst (invalid_target). Zwischen jedem Angriff die
    // Mock-Uhr um >3min vorspulen, um den Cooldown zu umgehen (identisches
    // Muster wie im bestehenden "Tageslimit von 10"-Test in arena.spec.js).
    const attackResult = [];
    for (let i = 0; i < 12; i++) {
      if (i > 0) qaServer.store.clock.advance(3 * 60 * 1000 + 1000);
      const r = await page.evaluate(async () => {
        try {
          const res = await window.bkmpArenaAttack('qa-ext-member-0000');
          return { ok: true, res };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      });
      attackResult.push(r);
    }
    expect(attackResult.length).toBe(12);
    expect(attackResult.every(r => r.ok)).toBe(true);

    // 13. Angriff (bereits ueber dem erweiterten Limit von 12) muss fehlschlagen.
    qaServer.store.clock.advance(3 * 60 * 1000 + 1000);
    const overLimit = await page.evaluate(async () => {
      try { await window.bkmpArenaAttack('qa-ext-member-0000'); return { ok: true }; }
      catch (e) { return { ok: false, error: String(e.message || e) }; }
    });
    expect(overLimit.ok).toBe(false);
    expect(overLimit.error).toMatch(/Tageslimit/);
  });
});

test.describe('Gilden-Technologie v2 - Stadtmauer (Raid-Stadt-HP-Beitrag)', () => {
  test('erhoeht den eigenen HP-Beitrag zum Stadt-HP-Pool eines Weltboss-Raids um 1%/Stufe', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await buyTech(page, 'guild_stadtmauer', 5); // +5% HP-Beitrag
    await page.evaluate(() => bkmpGuildRefreshTreasuryBonusCache());

    const now = Date.now();
    const fightStart = new Date(now);
    fightStart.setUTCMinutes(0, 0, 0);
    fightStart.setUTCHours(fightStart.getUTCHours() + 1);
    const raidId = `${fightStart.getUTCFullYear()}${String(fightStart.getUTCMonth() + 1).padStart(2, '0')}${String(fightStart.getUTCDate()).padStart(2, '0')}${String(fightStart.getUTCHours()).padStart(2, '0')}`;
    qaServer.store.clock.setNow(fightStart.getTime() - 3 * 60 * 1000); // 3 Min. vor Kampfbeginn -> prep

    const berlinHour = new Date(fightStart.getTime()).toLocaleString('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false });
    test.skip(Number(berlinHour) === 20, 'Gildenboss-Stunde - Raid pausiert, Testzeitpunkt zufaellig ungeeignet');

    const result = await page.evaluate(async (rid) => {
      const client = window.bkmpGetPlayerAuthClient();
      const { data, error } = await client.rpc('raid_join', { p_raid_id: rid });
      if (error) throw new Error(error.message);
      return data;
    }, raidId);

    // 2000 HP * 1.05 = 2100 (gerundet auf ganze Zahl im Mock, siehe rpc-engine.js).
    // Der Mock gibt fuer raid_join() ein einzelnes Objekt zurueck (nicht in
    // ein Array gewickelt wie bei anderen "returns table(...)"-Funktionen) -
    // beim eigenen Testen so vorgefunden, kein App-Bug.
    expect(Math.round(result.city_max_hp)).toBe(2100);
  });
});

test.describe('Gilden-Technologie v2 - Turm-Vorreiter (client-berechneter Champion-Bonus)', () => {
  test('nutzt die hoechste Turmstufe UNTER ALLEN Mitgliedern, nicht nur die eigene', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    // Leader selbst hat turm_highest_wave=0 (Default) - das MITGLIED hat 340.
    const memberRow = qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === MEMBER_UID);
    memberRow.turm_highest_wave = 340;

    await buyTech(page, 'guild_turm_vorreiter', 4); // Stufe 4 x 0.05%/10-Wellen
    await page.evaluate(() => bkmpGuildRefreshTreasuryBonusCache());

    const bonus = await page.evaluate(() => bkmpGuildTechBonus('towerChampionPct'));
    // floor(340/10) * 4 * 0.05 = 34 * 0.2 = 6.8%
    expect(bonus).toBeCloseTo(6.8, 5);

    // Wirkt tatsaechlich in den Kampfwerten (attackPctTotal-Pool, siehe idledorf.js).
    const attackWithBonus = await page.evaluate(() => { bkmpIdleRecomputeEffectiveStats(); return bkmpIdleEffectiveStats.attack; });
    await page.evaluate(() => { localStorage.setItem('bkmp-guild-tech-cache', JSON.stringify({})); bkmpIdleRecomputeEffectiveStats(); });
    const attackWithoutBonus = await page.evaluate(() => bkmpIdleEffectiveStats.attack);
    expect(attackWithBonus).toBeGreaterThan(attackWithoutBonus);
  });

  test('Deckel bei 50% (Rebalance, vorher 25%) greift auch bei extrem hoher Turmstufe', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.tables.guilds.find(g => g.id === 'g1').treasury_gold = 1000000000;
    const memberRow = qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === MEMBER_UID);
    memberRow.turm_highest_wave = 100000; // absurd hoch
    await buyTech(page, 'guild_turm_vorreiter', 25); // Maximalstufe (Rebalance, vorher 10)
    await page.evaluate(() => bkmpGuildRefreshTreasuryBonusCache());
    const bonus = await page.evaluate(() => bkmpGuildTechBonus('towerChampionPct'));
    expect(bonus).toBe(50);
  });
});

test.describe('Gilden-Technologie v2 - Willkommenspaket (befristeter Neumitglieder-Bonus)', () => {
  test('aktiv innerhalb der ersten 3 Tage nach Beitritt, nicht mehr danach', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await buyTech(page, 'guild_willkommenspaket');

    // Frisch beigetreten (joined_at = "jetzt") -> aktiv.
    await page.evaluate(() => bkmpGuildRefreshTreasuryBonusCache());
    const activeBonus = await page.evaluate(() => bkmpGuildTechBonus('newMemberBonusPct'));
    expect(activeBonus).toBe(10);

    // Beitritt vor 10 Tagen -> nicht mehr aktiv.
    const memberRow = qaServer.store.tables.guild_members.find(m => m.auth_user_id === LEADER_UID);
    memberRow.joined_at = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await page.evaluate(() => bkmpGuildRefreshTreasuryBonusCache());
    const expiredBonus = await page.evaluate(() => bkmpGuildTechBonus('newMemberBonusPct'));
    expect(expiredBonus).toBe(0);
  });
});
