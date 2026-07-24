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
  // rune_type MUSS eine echte Slot-ID sein (window.BKMP_RUNE_SLOTS in
  // bkmp-runes.js: slot1=Kraftrune..slot6=Gluecksrune), rarity ein echtes
  // window.BKMP_RUNE_RARITIES-Element (gray/green/blue/purple/gold) - beide
  // Listen waren anfangs mit erfundenen deutschen Slugs befuellt ("wucht",
  // "selten", ...), die die UI nie einer echten Slot-Definition zuordnen
  // konnte (BKMP_RUNE_SLOTS.find(...) lief ins Leere). Gefunden, weil ein
  // Save-Load-Test 30s auf einen nie erscheinenden Slot-Tab-Selektor wartete.
  //
  // id MUSS ein STRING sein: sql/supabase-idle-runes.sql:19 definiert
  // "id uuid primary key" - PostgREST/JSON serialisiert uuid immer als
  // String. rune._cid (idledorf.js) wird direkt von r.id uebernommen und
  // spaeter per data-cid="${_cid}" ins DOM geschrieben - dataset.cid liefert
  // beim Auslesen IMMER einen String zurueck. Ein numerischer Fixture-Wert
  // (5001 statt "5001") liess bkmpRuneToggleEquip()s "r._cid === cid"-
  // Vergleich (===, kein lockeres ==) still scheitern - der Ausruesten-
  // Klick tat sichtbar nichts, ohne jeden Fehler. Reiner Mock-Fidelity-Bug,
  // keiner der echten App - gefunden per JS-State-Vergleich vor/nach Klick.
  fx.tables.idle_player_runes.push(
    { id: 'qa-rune-5001', name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'slot5', rarity: 'blue', rolled_value: 12, equipped: true, upgrade_level: 2, substats: [], created_at: fx.nowIso },
    { id: 'qa-rune-5002', name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'slot6', rarity: 'purple', rolled_value: 18, equipped: true, upgrade_level: 1, substats: [], created_at: fx.nowIso },
    { id: 'qa-rune-5003', name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'slot5', rarity: 'gray', rolled_value: 5, equipped: false, upgrade_level: 0, substats: [], created_at: fx.nowIso }
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
  // 6 belegte Runenslots (alle 6 echten Slot-IDs genau einmal ausgeruestet,
  // siehe window.BKMP_RUNE_SLOTS in bkmp-runes.js) + ein paar unbelegte im Inventar.
  const runeTypes = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'];
  fx.tables.idle_player_runes.push(...runeTypes.map((type, idx) => ({
    id: `qa-rune-6${idx}`, name_key: fx.nameKey, auth_user_id: fx.authUserId,
    rune_type: type, rarity: 'gold', rolled_value: 40 + idx, equipped: true, upgrade_level: 12, substats: [], created_at: fx.nowIso
  })));
  fx.tables.idle_player_runes.push(
    { id: 'qa-rune-6100', name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'slot5', rarity: 'purple', rolled_value: 20, equipped: false, upgrade_level: 5, substats: [], created_at: fx.nowIso },
    { id: 'qa-rune-6101', name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'slot6', rarity: 'blue', rolled_value: 14, equipped: false, upgrade_level: 3, substats: [], created_at: fx.nowIso }
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
  // Doppelt ausgeruestete Runenart (zwei "slot5"/Wuchtrune-Runen gleichzeitig
  // equipped=true) - genau der ungueltige Zustand aus CLAUDE.md-Bugfix 4
  // (20.07.), den die App beim naechsten Laden bereinigen soll.
  fx.tables.idle_player_runes.push(
    { id: 'qa-rune-7001', name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'slot5', rarity: 'purple', rolled_value: 22, equipped: true, upgrade_level: 4, substats: [], created_at: fx.nowIso },
    { id: 'qa-rune-7002', name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'slot5', rarity: 'blue', rolled_value: 11, equipped: true, upgrade_level: 1, substats: [], created_at: fx.nowIso },
    { id: 'qa-rune-7003', name_key: fx.nameKey, auth_user_id: fx.authUserId, rune_type: 'slot6', rarity: 'gray', rolled_value: -3, equipped: true, upgrade_level: 0, substats: null, created_at: fx.nowIso }
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
  // Volles Runeninventar - 300 Runen, 6 davon ausgeruestet (je eine echte Slot-ID).
  const runeTypes = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'];
  const runes = runeTypes.map((type, idx) => ({
    id: `qa-rune-9${idx}`, name_key: fx.nameKey, auth_user_id: fx.authUserId,
    rune_type: type, rarity: 'gold', rolled_value: 50, equipped: true, upgrade_level: 15, substats: [], created_at: fx.nowIso
  }));
  for (let i = 0; i < 294; i++) {
    runes.push({
      id: `qa-rune-9${100 + i}`, name_key: fx.nameKey, auth_user_id: fx.authUserId,
      rune_type: runeTypes[i % runeTypes.length], rarity: 'gray', rolled_value: 5 + (i % 10),
      equipped: false, upgrade_level: 0, substats: [], created_at: fx.nowIso
    });
  }
  fx.tables.idle_player_runes.push(...runes);
  return fx;
}

/* TESTSTAND F - unmittelbar VOR der ersten Prestige-Freischaltung:
   highest_dragon_index=99, ein Punkt unter der echten Schwelle
   (bkmpPrestigeRequiredStage(0) === 100, siehe js/systems/bkmp-prestige.js:26-28
   - 100 + prestige_level*50). Deckt den Auftrag-Schritt-4-Punkt 3 ab (Phase 2,
   24.07.2026) - der Prestige-Button MUSS hier noch verborgen/deaktiviert sein;
   ein einzelner weiterer Sieg (highest_dragon_index->100) muss ihn freischalten. */
function teststandF(startTimeMs) {
  const fx = baseFixture(startTimeMs, 'QaVorPrestF', 'qa-user-f-0000');
  fx.tables.idle_player_state.push(makePlayerStateRow(fx.authUserId, fx.nameKey, fx.nowIso, {
    display_name: fx.displayName,
    level: 95, xp: 45000, gold: 900000,
    attack: 600, defense: 90, hp: 3200,
    dragon_kills: 4200, boss_kills: 160,
    current_dragon_index: 99, highest_dragon_index: 99,
    skill_points_available: 2, skill_points_spent: 20
  }));
  fx.tables.idle_prestige_state.push({
    name_key: fx.nameKey, display_name: fx.displayName,
    prestige_level: 0, prestige_points: 0, prestige_points_spent: 0,
    prestige_allocations: {}, updated_at: fx.nowIso
  });
  return fx;
}

/* TESTSTAND G - keine Dungeon-Schluessel (0/5 in ALLEN 7 Dungeon-Typen).
   Deckt Auftrag-Schritt-4-Punkt 14 ab. dungeon_keys wird von
   tests/mock/rpc-engine.js's dungeon_get_all_status() sonst beim ersten
   Aufruf PRO Spieler faul mit {keys:5, last_key_at_ms:jetzt} angelegt (siehe
   ensureDungeonRow()) - hier bewusst VORAB mit keys:0 UND einem last_key_at_ms
   direkt am Rand des aktuellen 4h-Berlin-Slots geseedet (nicht laengst
   vergangen), damit der Zustand beim allerersten Laden wirklich 0/5 zeigt
   und nicht durch zwischenzeitlich verstrichene Slot-Grenzen sofort wieder
   regeneriert. dungeon-time.spec.js:51 erreicht denselben Zustand bisher nur
   INDIREKT ueber mehrfachen echten Schluesselverbrauch waehrend des Tests -
   dieser Teststand macht "startet bereits bei 0" als eigenen, sofort
   ladbaren Ausgangszustand testbar. */
function teststandG(startTimeMs) {
  const fx = baseFixture(startTimeMs, 'QaKeineSchlG', 'qa-user-g-0000');
  fx.tables.idle_player_state.push(makePlayerStateRow(fx.authUserId, fx.nameKey, fx.nowIso, {
    display_name: fx.displayName,
    level: 60, xp: 12000, gold: 300000,
    dragon_kills: 1800, boss_kills: 70,
    current_dragon_index: 55, highest_dragon_index: 55
  }));
  fx.tables.idle_prestige_state.push({
    name_key: fx.nameKey, display_name: fx.displayName,
    prestige_level: 0, prestige_points: 0, prestige_points_spent: 0,
    prestige_allocations: {}, updated_at: fx.nowIso
  });
  const DUNGEON_TYPES = ['gold', 'exp', 'egg', 'meat', 'fruit', 'gem', 'rune'];
  fx.tables.dungeon_keys = DUNGEON_TYPES.map(type => ({
    auth_user_id: fx.authUserId, dungeon_type: type, keys: 0, last_key_at_ms: startTimeMs
  }));
  fx.tables.dungeon_progress = DUNGEON_TYPES.map(type => ({
    auth_user_id: fx.authUserId, dungeon_type: type,
    highest_difficulty: 'leicht', total_completions: 0, total_defeats: 0, total_keys_spent: 5
  }));
  return fx;
}

const TESTSTANDS = { A: teststandA, B: teststandB, C: teststandC, D: teststandD, E: teststandE, F: teststandF, G: teststandG };

module.exports = { TESTSTANDS, emailFromName, QA_PASSWORD };
