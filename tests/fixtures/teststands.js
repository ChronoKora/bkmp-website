/* Teststand A-E: deterministic, resettable player fixtures (Phase 7.2 /
   section 3 of the test brief). Each factory takes a startTimeMs (the
   virtual "now" the store boots at) and returns a store-seedable fixture:
   { startTimeMs, users: [...], tables: { idle_player_state: [...], ... } }.

   Login/password: mirrors bkmpPlayerEmailFromName() in supabase.js exactly
   (trim -> lowercase -> strip anything outside [a-z0-9._-]) so a real
   (mocked) login with the same display name resolves to the same auth
   user the fixture registered - no shortcut/bypass of the real auth flow. */

const { makePlayerStateRow } = require('./base-player-state');
const { cloneReferenceTables } = require('./reference-data');

function emailFromName(name) {
  const clean = String(name || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return clean ? clean + '@bkmp-player-accounts.com' : '';
}

const QA_PASSWORD = 'qa-test-pw-123';

function baseFixture(startTimeMs, displayName, authUserId) {
  const nowIso = new Date(startTimeMs).toISOString();
  const nameKey = displayName.trim().toLowerCase();
  return {
    startTimeMs,
    displayName,
    nameKey,
    authUserId,
    email: emailFromName(displayName),
    password: QA_PASSWORD,
    users: [{ id: authUserId, email: emailFromName(displayName), password: QA_PASSWORD, user_metadata: {} }],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [],
      idle_prestige_state: [],
      idle_player_runes: []
    },
    nowIso
  };
}

/* TESTSTAND A - neuer Spieler: Level 1, keine Upgrades/Runen/Drachen/Gilde/
   Erfolge/Prestige. */
function teststandA(startTimeMs) {
  const fx = baseFixture(startTimeMs, 'QaNeulingA', 'qa-user-a-0000');
  fx.tables.idle_player_state.push(
    makePlayerStateRow(fx.authUserId, fx.nameKey, fx.nowIso, { display_name: fx.displayName })
  );
  return fx;
}

/* TESTSTAND B - mittlerer Spieler: mehrere Upgrades/Skillpunkte/Runen, Dungeon-
   Fortschritt, einige Erfolge, freigeschaltete Tabs. */
function teststandB(startTimeMs) {
  const fx = baseFixture(startTimeMs, 'QaMittlerB', 'qa-user-b-0000');
  fx.tables.idle_player_state.push(makePlayerStateRow(fx.authUserId, fx.nameKey, fx.nowIso, {
    display_name: fx.displayName,
    level: 42,
    xp: 1200,
    gold: 50000,
    wood: 300,
    stone: 200,
    crystals: 15,
    essence: 8,
    total_gold_earned: 250000,
    attack: 85,
    defense: 22,
    hp: 400,
    crit_chance: 12,
    crit_damage: 165,
    gold_bonus: 15,
    xp_bonus: 10,
    loot_bonus: 5,
    skill_points_available: 3,
    skill_points_spent: 9,
    skill_allocations: { kampf_attack_pct: 4, kampf_defense_pct: 3, elem_fire: 2 },
    upgrade_purchases: { sword: 6, shield: 4, boots: 2 },
    dragon_kills: 340,
    boss_kills: 12,
    current_dragon_index: 34,
    highest_dragon_index: 34,
    fruit: 40,
    meat: 25,
    obstgarten_level: 2,
    jagdhuette_level: 1,
    mana: 60,
    manaquelle_level: 1
  }));
  fx.tables.idle_prestige_state.push({
    name_key: fx.nameKey, display_name: fx.displayName,
    prestige_level: 0, prestige_points: 0, prestige_points_spent: 0,
    prestige_allocations: {}, updated_at: fx.nowIso
  });
  fx.tables.idle_player_runes.push(
    { id: 5001, name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'wucht', rarity: 'selten', rolled_value: 12, equipped: true, upgrade_level: 2, substats: [], created_at: fx.nowIso },
    { id: 5002, name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'glueck', rarity: 'episch', rolled_value: 18, equipped: true, upgrade_level: 1, substats: [], created_at: fx.nowIso },
    { id: 5003, name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'wucht', rarity: 'gewoehnlich', rolled_value: 5, equipped: false, upgrade_level: 0, substats: [], created_at: fx.nowIso }
  );
  return fx;
}

/* TESTSTAND C - fortgeschrittener Spieler: hohes Level, grosse Werte, 6
   belegte Runenslots, Prestige moeglich, >250 "Erfolge" simuliert ueber
   grosse Zaehler (achievements selbst leben clientseitig/lokal, siehe
   CLAUDE.md - dieser Fixture liefert nur die serverseitigen Grossen-Werte). */
function teststandC(startTimeMs) {
  const fx = baseFixture(startTimeMs, 'QaFortgeschC', 'qa-user-c-0000');
  fx.tables.idle_player_state.push(makePlayerStateRow(fx.authUserId, fx.nameKey, fx.nowIso, {
    display_name: fx.displayName,
    level: 850,
    xp: 500000,
    gold: 50000000,
    wood: 90000,
    stone: 90000,
    crystals: 4200,
    essence: 3100,
    total_gold_earned: 900000000,
    attack: 12500,
    defense: 3200,
    hp: 60000,
    crit_chance: 35,
    crit_damage: 280,
    gold_bonus: 120,
    xp_bonus: 90,
    loot_bonus: 60,
    skill_points_available: 5,
    skill_points_spent: 75,
    skill_allocations: { kampf_attack_pct: 10, kampf_defense_pct: 10, elem_fire: 6, elem_lightning: 6, shield_regen: 6, repair_speed_pct: 6, heal_pct: 6, wirt_offline: 6 },
    upgrade_purchases: { sword: 40, shield: 40, boots: 40, amulet: 30 },
    dragon_kills: 85000,
    boss_kills: 3400,
    current_dragon_index: 840,
    highest_dragon_index: 850,
    prestige_stage_offset: 200,
    fruit: 9000,
    meat: 9000,
    obstgarten_level: 8,
    jagdhuette_level: 8,
    mana: 12000,
    holzfaeller_level: 8, steinbruch_level: 8, goldmine_level: 8, kristallmine_level: 8, manaquelle_level: 8, magierakademie_level: 8,
    turm_highest_wave: 220
  }));
  fx.tables.idle_prestige_state.push({
    name_key: fx.nameKey, display_name: fx.displayName,
    prestige_level: 6, prestige_points: 340, prestige_points_spent: 300,
    prestige_allocations: { prestige_point_bonus_pct: 10, gold_bonus_pct: 20 }, updated_at: fx.nowIso
  });
  // 6 belegte Runenslots (je ein Rune-Typ genau einmal ausgeruestet) + ein paar unbelegte im Inventar.
  const runeTypes = ['wucht', 'glueck', 'schild', 'tempo', 'macht', 'weisheit'];
  fx.tables.idle_player_runes.push(...runeTypes.map((type, idx) => ({
    id: 6000 + idx, name_key: fx.nameKey, auth_user_id: fx.authUserId,
    rune_type: type, rarity: 'mythisch', rolled_value: 40 + idx, equipped: true, upgrade_level: 12, substats: [], created_at: fx.nowIso
  })));
  fx.tables.idle_player_runes.push(
    { id: 6100, name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'wucht', rarity: 'episch', rolled_value: 20, equipped: false, upgrade_level: 5, substats: [], created_at: fx.nowIso },
    { id: 6101, name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'glueck', rarity: 'selten', rolled_value: 14, equipped: false, upgrade_level: 3, substats: [], created_at: fx.nowIso }
  );
  return fx;
}

/* TESTSTAND D - beschaedigte/alte Daten: fehlende Properties, NaN/negative
   Werte, doppelt ausgeruestete Runenart, unbekannte Drachen-ID. Zweck ist
   AUSDRUECKLICH, dass die App damit nicht abstuerzt/keine weiteren
   ungueltigen Werte erzeugt - kein "gesunder" Spielstand. */
function teststandD(startTimeMs) {
  const fx = baseFixture(startTimeMs, 'QaBeschaedD', 'qa-user-d-0000');
  const row = makePlayerStateRow(fx.authUserId, fx.nameKey, fx.nowIso, {
    display_name: fx.displayName,
    level: 30,
    xp: -5, // negativer Wert
    gold: Number.NaN, // NaN
    attack: 40,
    defense: 5,
    hp: 0, // Dorf "tot" gespeichert
    current_dragon_index: 999999, // unbekannte/nicht existierende Drachen-Stufe
    skill_allocations: null, // fehlt/kaputt statt {}
    upgrade_purchases: undefined
  });
  delete row.crit_chance; // fehlende Property
  delete row.crit_damage;
  fx.tables.idle_player_state.push(row);
  fx.tables.idle_prestige_state.push({
    name_key: fx.nameKey, display_name: fx.displayName,
    prestige_level: 1, prestige_points: -10, prestige_points_spent: 0,
    prestige_allocations: {}, updated_at: fx.nowIso
  });
  // Doppelt ausgeruestete Runenart (zwei "wucht"-Runen gleichzeitig equipped=true) - genau der
  // ungueltige Zustand aus CLAUDE.md-Bugfix 4 (20.07.), den die App beim naechsten Laden bereinigen soll.
  fx.tables.idle_player_runes.push(
    { id: 7001, name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'wucht', rarity: 'episch', rolled_value: 22, equipped: true, upgrade_level: 4, substats: [], created_at: fx.nowIso },
    { id: 7002, name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'wucht', rarity: 'selten', rolled_value: 11, equipped: true, upgrade_level: 1, substats: [], created_at: fx.nowIso },
    { id: 7003, name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'glueck', rarity: 'gewoehnlich', rolled_value: -3, equipped: true, upgrade_level: 0, substats: null, created_at: fx.nowIso }
  );
  return fx;
}

/* TESTSTAND E - Maximalbelastung: volles Runeninventar, viele Erfolge/
   Logeintraege-aequivalente Zaehler, grosse Ressourcenwerte. */
function teststandE(startTimeMs) {
  const fx = baseFixture(startTimeMs, 'QaMaxlastE', 'qa-user-e-0000');
  fx.tables.idle_player_state.push(makePlayerStateRow(fx.authUserId, fx.nameKey, fx.nowIso, {
    display_name: fx.displayName,
    level: 5000,
    xp: 9999999,
    gold: 999999999999,
    wood: 999999999,
    stone: 999999999,
    crystals: 999999,
    essence: 999999,
    total_gold_earned: Number.MAX_SAFE_INTEGER,
    attack: 500000,
    defense: 120000,
    hp: 2000000,
    crit_chance: 75,
    crit_damage: 500,
    dragon_kills: 5000000,
    boss_kills: 200000,
    current_dragon_index: 4999,
    highest_dragon_index: 5000,
    turm_highest_wave: 5000
  }));
  fx.tables.idle_prestige_state.push({
    name_key: fx.nameKey, display_name: fx.displayName,
    prestige_level: 60, prestige_points: 999999, prestige_points_spent: 999000,
    prestige_allocations: { prestige_point_bonus_pct: 60 }, updated_at: fx.nowIso
  });
  // Volles Runeninventar - 300 Runen, 6 davon ausgeruestet (je ein Typ).
  const runeTypes = ['wucht', 'glueck', 'schild', 'tempo', 'macht', 'weisheit'];
  const runes = runeTypes.map((type, idx) => ({
    id: 9000 + idx, name_key: fx.nameKey, auth_user_id: fx.authUserId,
    rune_type: type, rarity: 'mythisch', rolled_value: 50, equipped: true, upgrade_level: 15, substats: [], created_at: fx.nowIso
  }));
  for (let i = 0; i < 294; i++) {
    runes.push({
      id: 9100 + i, name_key: fx.nameKey, auth_user_id: fx.authUserId,
      rune_type: runeTypes[i % runeTypes.length], rarity: 'gewoehnlich', rolled_value: 5 + (i % 10),
      equipped: false, upgrade_level: 0, substats: [], created_at: fx.nowIso
    });
  }
  fx.tables.idle_player_runes.push(...runes);
  return fx;
}

const TESTSTANDS = { A: teststandA, B: teststandB, C: teststandC, D: teststandD, E: teststandE };

module.exports = { TESTSTANDS, emailFromName, QA_PASSWORD };
