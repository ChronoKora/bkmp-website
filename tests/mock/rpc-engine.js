/* Faithful JS port of the dungeon-system Postgres functions in
   sql/supabase-dungeon-system-v2.sql (base) + sql/supabase-dungeon-fixed-
   key-times.sql (the CURRENT, authoritative dungeon_regen_calc - fixed
   00/04/08/12/16/20 Europe/Berlin slots, not rolling 4h-since-last-claim).
   This is a reimplementation, not the real SQL - see CLAUDE.md Phase 7.2
   report for the fidelity trade-off this implies (drifts if the SQL
   changes and this file isn't updated to match).

   Phase 3 (24.07.2026, siehe CLAUDE.md) ergaenzt arena_attack() - originalgetreuer
   Port von sql/supabase-idle-arena.sql + sql/supabase-idle-arena-daily-limit.sql
   (letztere ist die CURRENT/authoritative Fassung, "create or replace function"
   mit identischer Signatur - fuegt das Tageslimit zur Basisversion hinzu).

   Other RPCs the app calls in passing (claim_player_row, resolve_login_name,
   is_active_admin, ...) are outside Stage-1 scope and get a permissive
   no-op fallback so they don't crash login/state-merge flows. */

const { table: getTable } = require('./store');

const DUNGEON_TYPES = ['gold', 'exp', 'egg', 'meat', 'fruit', 'gem', 'rune'];
const DIFFICULTY_LADDER = ['leicht', 'mittel', 'schwer', 'albtraum'];

function berlinParts(epochMs) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = {};
  fmt.formatToParts(new Date(epochMs)).forEach(p => { if (p.type !== 'literal') parts[p.type] = Number(p.value); });
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

function berlinDateStr(epochMs) {
  const p = berlinParts(epochMs);
  const pad = n => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function slotNaiveMs(epochMs) {
  const p = berlinParts(epochMs);
  const slotHour = Math.floor(p.hour / 4) * 4;
  return Date.UTC(p.year, p.month - 1, p.day, slotHour, 0, 0);
}

/* Mirrors arena_attack()'s v_today_start: Berlin-Mitternacht des aktuellen
   Tages, als echter Zeitpunkt (nicht nur ein Datumsstring wie berlinDateStr) -
   fuer den 10-Angriffe/Tag-Vergleich gegen occurred_at gebraucht. Gleiches
   Doppel-Konvertierungs-Muster wie slotNaiveMs (naiv nach Berlin-Uhrzeit
   rechnen, dann als UTC-ms zurueckgeben, dann mit berlinOffsetMs zurueck in
   echte UTC-ms umrechnen). */
function berlinMidnightMs(epochMs) {
  const p = berlinParts(epochMs);
  const naiveMidnightUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  // Offset am REFERENZ-Zeitpunkt (epochMs), nicht am naiven Mitternachtswert -
  // identisches Muster wie dungeonRegenCalc's "nowSlot - berlinOffsetMs(nowMs)".
  return naiveMidnightUtc - berlinOffsetMs(epochMs);
}

function berlinOffsetMs(epochMs) {
  const p = berlinParts(epochMs);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - epochMs;
}

/* Mirrors dungeon_regen_calc(): +1 key per fixed 4h Berlin slot crossed
   since last_key_at, capped at 5, anchor snaps to the current slot (no
   "keep leftover progress" - fixed-time version replaced that). */
function dungeonRegenCalc(keys, lastKeyAtMs, nowMs) {
  const nowSlot = slotNaiveMs(nowMs);
  const lastSlot = slotNaiveMs(lastKeyAtMs);
  const intervals = Math.round((nowSlot - lastSlot) / (4 * 3600 * 1000));
  if (intervals <= 0) return { newKeys: keys, newLastKeyAtMs: lastKeyAtMs };
  const newKeys = Math.min(5, keys + intervals);
  const newLastKeyAtMs = nowSlot - berlinOffsetMs(nowMs);
  return { newKeys, newLastKeyAtMs };
}

function berlinDateStrCompact(epochMs) {
  const p = berlinParts(epochMs);
  const pad = n => String(n).padStart(2, '0');
  return `${p.year}${pad(p.month)}${pad(p.day)}`;
}

// 'YYYYMMDDHH24' UTC -> epoch ms, mirrors to_timestamp(p_raid_id,'YYYYMMDDHH24') at time zone 'UTC'.
function parseRaidIdToMs(raidId) {
  if (!/^\d{10}$/.test(String(raidId || ''))) return NaN;
  const y = Number(raidId.slice(0, 4));
  const mo = Number(raidId.slice(4, 6));
  const d = Number(raidId.slice(6, 8));
  const h = Number(raidId.slice(8, 10));
  return Date.UTC(y, mo - 1, d, h, 0, 0, 0);
}

// Deckt beide Weltboss-/Gildenboss-Schaden-RPCs ab: greatest(0, round(p_amount))
// mit anschliessender Bereichs-/Deckel-Pruefung wie in raid_deal_damage()/
// guild_boss_deal_damage() (200000 Anti-Cheat-Deckel pro Treffer). Postgres'
// numeric-Typ sortiert NaN als groesser als jeder andere Wert (anders als
// IEEE754/JS) - "greatest(0, round(NaN))" wuerde dort also bereits NaN liefern
// UND "NaN > 200000" waere dort wahr (faengt sich also serverseitig von
// selbst). JS folgt IEEE754 (jeder NaN-Vergleich ist false) - ohne expliziten
// Number.isFinite()-Check wuerde ein manipulierter NaN/Infinity-Betrag hier
// sonst lautlos durchrutschen statt korrekt abgelehnt zu werden.
function clampDamageAmount(rawAmount) {
  const n = Number(rawAmount);
  if (!Number.isFinite(n)) return NaN;
  return Math.max(0, Math.round(n));
}

function findNameKeyForUid(store, uid) {
  const row = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
  return row ? row.name_key : null;
}

function ensureDungeonRow(store, tableName, uid, dungeonType, defaults) {
  const rows = getTable(store, tableName);
  let row = rows.find(r => r.auth_user_id === uid && r.dungeon_type === dungeonType);
  if (!row) {
    row = { auth_user_id: uid, dungeon_type: dungeonType, ...defaults };
    rows.push(row);
  }
  return row;
}

function rpcError(message) {
  const err = new Error(message);
  err.isRpcError = true;
  return err;
}

/* Gilden-Technologie v2 (26.07.2026) - gemeinsamer Nachschlage-Helfer fuer
   die drei serverseitigen Zweige (Kriegsrat/Stadtmauer/Nachtwache), die
   NICHT nur einen client-seitig gecachten Stat-Pool speisen, sondern
   echte RPC-Logik veraendern (arena_attack/raid_join) - originalgetreu
   zu sql/20260726-guild-tech-branches-v2.sql. Liefert 0, wenn der Spieler
   in keiner Gilde ist oder der Zweig nie gekauft wurde. */
function guildTechLevelFor(store, uid, techId) {
  const member = getTable(store, 'guild_members').find(m => m.auth_user_id === uid);
  if (!member) return 0;
  const row = getTable(store, 'guild_tech_levels').find(r => r.guild_id === member.guild_id && r.tech_id === techId);
  return row ? Number(row.level || 0) : 0;
}

/* Phase 4 (24.07.2026, siehe CLAUDE.md) - raid_finish() (interner Helfer,
   nie direkt vom Client aufgerufen, nur ueber raid_deal_damage()/
   raid_boss_attack_tick()'s "perform"). Belohnungs-Anteil-Formel aus
   sql/supabase-raid-boss-reward-share.sql (18.07., authoritative - ersetzt
   die aeltere Pauschal-Fassung aus supabase-raid-boss-schema.sql). Bewusst
   NICHT portiert: die seltenen RNG-Kosmetik-Nebenwirkungen (5% Zerator-
   Pluschie-Code, 1% Zerathordorf-Skin, je 1% Gold-/Exp-Boost) - eigenstaendige,
   fuer die Kern-Testabdeckung (Schaden/HP/Cooldown/Belohnungsanteil/Claim)
   nicht entscheidende Nebenpfade, siehe tests/FEATURE_MATRIX.md fuer die
   ehrliche Lueckenangabe. Idempotenz-Guard (status muss 'fighting' sein)
   identisch zur SQL-Fassung - ein zweiter Aufruf fuer denselben Raid ist
   ein sicheres No-Op. */
function raidFinishInternal(store, raidId, result) {
  const inst = getTable(store, 'raid_instances').find(r => r.id === raidId);
  if (!inst || inst.status !== 'fighting') return;
  inst.status = result;
  inst.ended_at = store.clock.nowIso();
  if (result !== 'won') return;

  const participants = getTable(store, 'raid_participants').filter(p => p.raid_id === raidId);
  const totalDamage = Number(inst.total_damage || 0);
  const boss = getTable(store, 'raid_bosses').find(b => b.id === inst.boss_id) || {};
  const flawless = Number(inst.city_max_hp) > 0 && Number(inst.city_hp) >= Number(inst.city_max_hp);
  let mvp = null;
  participants.forEach(p => { if (!mvp || Number(p.damage_dealt) > Number(mvp.damage_dealt)) mvp = p; });

  const playerStates = getTable(store, 'idle_player_state');
  const raidStats = getTable(store, 'raid_player_stats');
  participants.forEach(p => {
    const share = totalDamage > 0 ? Number(p.damage_dealt) / totalDamage : 0;
    const player = playerStates.find(ps => ps.auth_user_id === p.auth_user_id);
    if (player) {
      const addGold = Math.round(Number(boss.gold_reward || 0) * share);
      player.gold = Number(player.gold || 0) + addGold;
      player.total_gold_earned = Number(player.total_gold_earned || 0) + addGold;
      player.crystals = Number(player.crystals || 0) + Math.round(Number(boss.gem_reward || 0) * share);
      player.xp = Number(player.xp || 0) + Math.round(Number(boss.xp_reward || 0) * share);
      player.wood = Number(player.wood || 0) + Math.round(Number(boss.wood_reward || 0) * share);
      player.stone = Number(player.stone || 0) + Math.round(Number(boss.stone_reward || 0) * share);
      player.essence = Number(player.essence || 0) + Math.round(Number(boss.essence_reward || 0) * share);
    }
    const s = raidStats.find(r => r.auth_user_id === p.auth_user_id);
    if (s) {
      s.total_bosses_defeated = Number(s.total_bosses_defeated || 0) + 1;
      if (mvp && p.auth_user_id === mvp.auth_user_id) s.total_mvp_count = Number(s.total_mvp_count || 0) + 1;
      if (flawless) s.total_flawless_wins = Number(s.total_flawless_wins || 0) + 1;
      s.updated_at = store.clock.nowIso();
    }
  });
}

/* guild_boss_finish() (interner Helfer) - Formel 1:1 aus
   sql/supabase-guild-boss.sql (guild_boss_finish ist dort die einzige/
   aktuelle Fassung, weder von -ambiguous-status-fix.sql noch -damage-sync-
   fix.sql noch -reward-increase.sql/-retro-payout.sql erneut definiert -
   Letztere beiden aendern nur Daten bzw. sind ein einmaliges Backfill-Skript,
   keine Funktionsaenderung). Nur Gold/Kristalle (kein Holz/Stein/Essenz wie
   beim Weltboss-Raid) - nur an Teilnehmer MIT Schaden > 0, exakt wie im
   SQL-"where ... and damage_dealt > 0"-Filter. */
function guildBossFinishInternal(store, instanceId, result) {
  const inst = getTable(store, 'guild_boss_instances').find(r => r.id === instanceId);
  if (!inst || inst.status !== 'fighting') return;
  inst.status = result;
  inst.ended_at = store.clock.nowIso();
  if (result !== 'won') return;

  const boss = getTable(store, 'guild_bosses').find(b => b.id === inst.boss_id) || {};
  const guild = getTable(store, 'guilds').find(g => g.id === inst.guild_id);
  if (guild) guild.bosses_defeated = Number(guild.bosses_defeated || 0) + 1;
  getTable(store, 'guild_activity_log').push({ id: store.nextId(), guild_id: inst.guild_id, kind: 'boss_defeated', created_at: store.clock.nowIso() });

  const totalDamage = Number(inst.total_damage || 0);
  const participants = getTable(store, 'guild_boss_participants').filter(p => p.instance_id === instanceId && Number(p.damage_dealt) > 0);
  const playerStates = getTable(store, 'idle_player_state');
  const stats = getTable(store, 'guild_boss_player_stats');
  participants.forEach(p => {
    const share = totalDamage > 0 ? Number(p.damage_dealt) / totalDamage : 0;
    const player = playerStates.find(ps => ps.auth_user_id === p.auth_user_id);
    if (player) {
      player.gold = Number(player.gold || 0) + Math.round(Number(boss.gold_reward || 0) * share);
      player.crystals = Number(player.crystals || 0) + Math.round(Number(boss.gem_reward || 0) * share);
    }
    const s = stats.find(r => r.auth_user_id === p.auth_user_id);
    if (s) s.total_bosses_defeated = Number(s.total_bosses_defeated || 0) + 1;
  });
}

/* Bugfix-Durchlauf 25.07.2026 (dringender Nutzerauftrag, siehe CLAUDE.md) -
   originalgetreuer Port von rename_player_account() aus der zuletzt
   ausgefuehrten Fassung sql/supabase-player-name-blocklist.sql (create or
   replace ueber v2/v3 - diese Datei ist die aktuelle/massgebliche). Bewusst
   1:1 inklusive der real existierenden LUECKE: aktualisiert player_stats/
   idle_player_state/user_plushies/auth.users, aber NICHT idle_player_runes/
   idle_prestige_state/idle_player_village_skins (alle drei filtern beim
   Laden strikt nach name_key, siehe supabase.js loadPlayerRunes/
   loadIdlePrestigeState/loadPlayerVillageSkins) - genau diese Luecke soll
   der Reproduktionstest beweisen, bevor sie gefixt wird. is_name_blocked()
   (separate, hier nicht sicherheitsrelevante Pruefung) bewusst NICHT
   nachgebaut - fuer diesen Bug irrelevant. */
function renamePlayerAccountCurrentBuggyBehavior(store, uid, params) {
  const newName = String(params.p_new_name || '').trim();
  const newKey = newName.toLowerCase();
  if (!newKey || newKey.length > 32) throw rpcError('invalid_name');
  const playerStats = getTable(store, 'player_stats');
  const oldRow = playerStats.find(r => r.auth_user_id === uid);
  if (!oldRow) throw rpcError('no_account');
  if (oldRow.name_key === newKey) throw rpcError('same_name');
  if (oldRow.last_name_change_at && (store.clock.nowMs() - Date.parse(oldRow.last_name_change_at)) < 30 * 24 * 3600 * 1000) {
    throw rpcError('cooldown_active');
  }
  const conflict = playerStats.find(r => r.name_key === newKey);
  if (conflict && conflict.auth_user_id !== uid) throw rpcError('name_taken');

  const oldKey = oldRow.name_key;
  const oldDisplayName = oldRow.display_name;
  getTable(store, 'player_name_history').push({ id: store.nextId(), auth_user_id: uid, old_name: oldDisplayName, new_name: newName, created_at: store.clock.nowIso() });

  oldRow.name_key = newKey;
  oldRow.display_name = newName;
  oldRow.last_name_change_at = store.clock.nowIso();

  const stateRow = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
  if (stateRow) { stateRow.name_key = newKey; stateRow.display_name = newName; }

  getTable(store, 'user_plushies').filter(r => r.name_key === oldKey).forEach(r => { r.name_key = newKey; r.display_name = newName; });

  const authUser = [...store.authUsersByEmail.values()].find(u => u.id === uid);
  if (authUser) authUser.user_metadata = { ...(authUser.user_metadata || {}), display_name: newName };

  // ABSICHTLICH NICHT aktualisiert (siehe Funktionskommentar) - idle_player_runes/idle_prestige_state/idle_player_village_skins.
  return null;
}

/* Originalgetreuer Port des VORGESCHLAGENEN Fixes (sql/20260725-fix-rename-
   name-key-propagation.sql, NICHT gegen die echte Produktions-DB
   ausgefuehrt) - identisch zu renamePlayerAccountCurrentBuggyBehavior oben,
   nur mit den drei zusaetzlichen UPDATEs aus der neuen Migration. Absichtlich
   NICHT unter dem echten RPC-Namen registriert (der echte Produktionscode
   soll weiterhin die aktuell tatsaechlich deployte, fehlerhafte Fassung
   durchlaufen) - nur ueber den Test-Namen 'rename_player_account_fixed_
   preview' erreichbar, ausschliesslich fuer den Beweis, dass die
   vorgeschlagene Migration die Luecke tatsaechlich schliesst, BEVOR der
   Nutzer sie live ausfuehrt. */
function renamePlayerAccountFixedPreview(store, uid, params) {
  const newName = String(params.p_new_name || '').trim();
  const newKey = newName.toLowerCase();
  if (!newKey || newKey.length > 32) throw rpcError('invalid_name');
  const playerStats = getTable(store, 'player_stats');
  const oldRow = playerStats.find(r => r.auth_user_id === uid);
  if (!oldRow) throw rpcError('no_account');
  if (oldRow.name_key === newKey) throw rpcError('same_name');
  if (oldRow.last_name_change_at && (store.clock.nowMs() - Date.parse(oldRow.last_name_change_at)) < 30 * 24 * 3600 * 1000) {
    throw rpcError('cooldown_active');
  }
  const conflict = playerStats.find(r => r.name_key === newKey);
  if (conflict && conflict.auth_user_id !== uid) throw rpcError('name_taken');

  const oldKey = oldRow.name_key;
  const oldDisplayName = oldRow.display_name;
  getTable(store, 'player_name_history').push({ id: store.nextId(), auth_user_id: uid, old_name: oldDisplayName, new_name: newName, created_at: store.clock.nowIso() });

  oldRow.name_key = newKey;
  oldRow.display_name = newName;
  oldRow.last_name_change_at = store.clock.nowIso();

  const stateRow = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
  if (stateRow) { stateRow.name_key = newKey; stateRow.display_name = newName; }

  getTable(store, 'user_plushies').filter(r => r.name_key === oldKey).forEach(r => { r.name_key = newKey; r.display_name = newName; });

  // NEU (25.07.2026-Fix): dieselben drei Systeme, die die Buggy-Fassung uebersehen hat.
  getTable(store, 'idle_player_runes').filter(r => r.name_key === oldKey).forEach(r => { r.name_key = newKey; });
  getTable(store, 'idle_prestige_state').filter(r => r.name_key === oldKey).forEach(r => { r.name_key = newKey; r.display_name = newName; });
  getTable(store, 'idle_player_village_skins').filter(r => r.name_key === oldKey).forEach(r => { r.name_key = newKey; });

  const authUser = [...store.authUsersByEmail.values()].find(u => u.id === uid);
  if (authUser) authUser.user_metadata = { ...(authUser.user_metadata || {}), display_name: newName };

  return null;
}

const RPC_HANDLERS = {
  rename_player_account(store, uid, params) { return renamePlayerAccountCurrentBuggyBehavior(store, uid, params); },
  rename_player_account_fixed_preview(store, uid, params) { return renamePlayerAccountFixedPreview(store, uid, params); },

  dungeon_get_all_status(store, uid) {
    const nameKey = findNameKeyForUid(store, uid);
    if (!nameKey) throw rpcError('no_player_state');
    const nowMs = store.clock.nowMs();
    const today = berlinDateStr(nowMs);
    return DUNGEON_TYPES.map(type => {
      const keyRow = ensureDungeonRow(store, 'dungeon_keys', uid, type, { keys: 5, last_key_at_ms: nowMs });
      const calc = dungeonRegenCalc(keyRow.keys, keyRow.last_key_at_ms, nowMs);
      keyRow.keys = calc.newKeys;
      keyRow.last_key_at_ms = calc.newLastKeyAtMs;
      const progressRow = ensureDungeonRow(store, 'dungeon_progress', uid, type, {
        highest_difficulty: 'leicht', total_completions: 0, total_defeats: 0, total_keys_spent: 0
      });
      const bonusRows = getTable(store, 'dungeon_daily_bonus');
      const bonusClaimed = bonusRows.some(r => r.auth_user_id === uid && r.dungeon_type === type && r.bonus_date === today);
      const secondsToNext = calc.newKeys >= 5 ? 0 : Math.max(0, Math.floor((14400 * 1000 - (nowMs - calc.newLastKeyAtMs)) / 1000));
      return {
        dungeon_type: type,
        keys: calc.newKeys,
        seconds_to_next: secondsToNext,
        daily_bonus_available: !bonusClaimed,
        highest_difficulty: progressRow.highest_difficulty,
        total_completions: progressRow.total_completions,
        total_defeats: progressRow.total_defeats,
        total_keys_spent: progressRow.total_keys_spent
      };
    });
  },

  dungeon_consume_key(store, uid, params) {
    const dungeonType = params.p_dungeon_type;
    if (!DUNGEON_TYPES.includes(dungeonType)) throw rpcError('invalid_dungeon_type');
    const nameKey = findNameKeyForUid(store, uid);
    if (!nameKey) throw rpcError('no_player_state');
    const nowMs = store.clock.nowMs();
    const keyRow = ensureDungeonRow(store, 'dungeon_keys', uid, dungeonType, { keys: 5, last_key_at_ms: nowMs });
    const calc = dungeonRegenCalc(keyRow.keys, keyRow.last_key_at_ms, nowMs);
    if (calc.newKeys < 1) {
      keyRow.keys = calc.newKeys;
      keyRow.last_key_at_ms = calc.newLastKeyAtMs;
      throw rpcError('no_keys_available');
    }
    const final = calc.newKeys - 1;
    keyRow.keys = final;
    keyRow.last_key_at_ms = calc.newLastKeyAtMs;
    const progressRow = ensureDungeonRow(store, 'dungeon_progress', uid, dungeonType, {
      highest_difficulty: 'leicht', total_completions: 0, total_defeats: 0, total_keys_spent: 0
    });
    progressRow.total_keys_spent += 1;
    return final;
  },

  dungeon_claim_daily_bonus(store, uid, params) {
    const dungeonType = params.p_dungeon_type;
    if (!DUNGEON_TYPES.includes(dungeonType)) throw rpcError('invalid_dungeon_type');
    const nameKey = findNameKeyForUid(store, uid);
    if (!nameKey) throw rpcError('no_player_state');
    const today = berlinDateStr(store.clock.nowMs());
    const bonusRows = getTable(store, 'dungeon_daily_bonus');
    const already = bonusRows.some(r => r.auth_user_id === uid && r.dungeon_type === dungeonType && r.bonus_date === today);
    if (already) return false;
    bonusRows.push({ auth_user_id: uid, dungeon_type: dungeonType, bonus_date: today });
    return true;
  },

  dungeon_mark_progress(store, uid, params) {
    const { p_dungeon_type: dungeonType, p_success: success, p_difficulty_id: difficultyId } = params;
    if (!DUNGEON_TYPES.includes(dungeonType)) throw rpcError('invalid_dungeon_type');
    if (!DIFFICULTY_LADDER.includes(difficultyId)) throw rpcError('invalid_difficulty');
    const nameKey = findNameKeyForUid(store, uid);
    if (!nameKey) throw rpcError('no_player_state');
    const row = ensureDungeonRow(store, 'dungeon_progress', uid, dungeonType, {
      highest_difficulty: 'leicht', total_completions: 0, total_defeats: 0, total_keys_spent: 0
    });
    if (success) {
      const idx = DIFFICULTY_LADDER.indexOf(row.highest_difficulty);
      const next = (difficultyId === row.highest_difficulty && idx < DIFFICULTY_LADDER.length - 1)
        ? DIFFICULTY_LADDER[idx + 1] : row.highest_difficulty;
      row.total_completions += 1;
      row.highest_difficulty = next;
      return next;
    }
    row.total_defeats += 1;
    return row.highest_difficulty;
  },

  /* Originalgetreuer Port von arena_attack() - siehe sql/supabase-idle-arena-
     daily-limit.sql (aktuelle/massgebliche Fassung, ersetzt per "create or
     replace function" mit identischer Signatur die Basisversion aus
     sql/supabase-idle-arena.sql und ergaenzt nur das 10x/Tag-Limit). */
  arena_attack(store, uid, params) {
    const targetUid = params.p_target_auth_user_id;
    if (!targetUid || targetUid === uid) throw rpcError('invalid_target');

    const nowMs = store.clock.nowMs();
    const battleLog = getTable(store, 'arena_battle_log');

    const todayStartMs = berlinMidnightMs(nowMs);
    const attacksToday = battleLog.filter(r => r.attacker_auth_user_id === uid && r.occurred_at_ms >= todayStartMs).length;
    // Gilden-Technologie v2 (26.07.), "Kriegsrat": +1 Versuch/Tag pro Stufe.
    const dailyLimit = 10 + guildTechLevelFor(store, uid, 'guild_kriegsrat');
    if (attacksToday >= dailyLimit) throw rpcError('daily_limit_reached');

    const stateRows = getTable(store, 'idle_player_state');
    const atk = stateRows.find(r => r.auth_user_id === uid);
    if (!atk) throw rpcError('no_attacker_state');
    const def = stateRows.find(r => r.auth_user_id === targetUid);
    if (!def) throw rpcError('no_defender_state');

    const lastAttack = battleLog
      .filter(r => r.attacker_auth_user_id === uid && r.defender_auth_user_id === targetUid)
      .sort((a, b) => b.occurred_at_ms - a.occurred_at_ms)[0];
    if (lastAttack && lastAttack.occurred_at_ms > nowMs - 3 * 60 * 1000) throw rpcError('cooldown_active');

    const ratings = getTable(store, 'arena_ratings');
    let atkRatingRow = ratings.find(r => r.auth_user_id === uid);
    if (!atkRatingRow) {
      atkRatingRow = { auth_user_id: uid, name_key: atk.name_key, display_name: atk.display_name, rating: 1000, wins: 0, losses: 0 };
      ratings.push(atkRatingRow);
    } else {
      atkRatingRow.name_key = atk.name_key;
      atkRatingRow.display_name = atk.display_name;
    }
    let defRatingRow = ratings.find(r => r.auth_user_id === targetUid);
    if (!defRatingRow) {
      defRatingRow = { auth_user_id: targetUid, name_key: def.name_key, display_name: def.display_name, rating: 1000, wins: 0, losses: 0 };
      ratings.push(defRatingRow);
    } else {
      defRatingRow.name_key = def.name_key;
      defRatingRow.display_name = def.display_name;
    }

    // Kampfstaerke/Gewinnchance - identische Gewichtung wie in arena_attack():
    // Angriff*2 + Verteidigung + HP*0.3, Bradley-Terry-Gewinnchance.
    const atkPower = Math.max(1, Number(atk.attack || 0) * 2 + Number(atk.defense || 0) + Number(atk.hp || 0) * 0.3);
    const defPower = Math.max(1, Number(def.attack || 0) * 2 + Number(def.defense || 0) + Number(def.hp || 0) * 0.3);
    const winChance = atkPower / (atkPower + defPower);
    const won = store.rng() < winChance;

    // Elo-aehnliche Ratingveraenderung, K=32.
    const K = 32;
    const expected = 1.0 / (1.0 + Math.pow(10, (defRatingRow.rating - atkRatingRow.rating) / 400));
    let change;
    let gold = 0;
    if (won) {
      change = Math.round(K * (1 - expected));
      gold = Math.round(Math.max(5, defPower * 0.8));
    } else {
      change = -Math.round(K * expected);
    }

    atkRatingRow.rating += change;
    atkRatingRow.wins += won ? 1 : 0;
    atkRatingRow.losses += won ? 0 : 1;
    defRatingRow.rating -= change;
    defRatingRow.wins += won ? 0 : 1;
    defRatingRow.losses += won ? 1 : 0;

    if (won && gold > 0) {
      atk.gold = Number(atk.gold || 0) + gold;
      atk.total_gold_earned = Number(atk.total_gold_earned || 0) + gold;
    }

    battleLog.push({
      id: store.nextId(),
      attacker_auth_user_id: uid, attacker_name: atk.display_name,
      defender_auth_user_id: targetUid, defender_name: def.display_name,
      attacker_won: won, rating_change: change, gold_reward: gold,
      occurred_at_ms: nowMs, occurred_at: new Date(nowMs).toISOString()
    });

    return {
      attacker_won: won, rating_change: change, new_rating: atkRatingRow.rating,
      gold_reward: gold, defender_display_name: def.display_name
    };
  },

  /* Gilde-Kernmechanik (24.07.2026, siehe CLAUDE.md Phase 3) -
     originalgetreuer Port der JEWEILS aktuellsten Fassung:
       - create_guild: sql/supabase-idle-guilds-founding-cost.sql (500k-Gold-
         Kosten, ersetzt die kostenlose Basisversion aus supabase-idle-guilds.sql)
       - join_guild/respond_guild_join_request: sql/supabase-guild-extra-
         slots.sql (dynamischer Mitglieder-Deckel 20+bonus_member_slots,
         ersetzt die fest-20-Version aus den jeweiligen Basisdateien)
       - request_guild_join/cancel_guild_join_request: sql/supabase-guild-
         join-requests.sql (unveraendert von dort - keine neuere Fassung)

     Phase 5 (24.07.2026, siehe CLAUDE.md) - Reihenfolge der Gildensystem-
     SQL-Dateien per Inhalt rekonstruiert (git-Commit-Zeitstempel sind fuer
     ALLE Dateien identisch - Sammel-Import am 19.07., keine Aussagekraft
     ueber die tatsaechliche Entstehungsreihenfolge). Eigene, im Dateikopf
     hinterlegte "Phase A/D/E/F/G"-Kennzeichnung + explizite "Baut auf ...
     auf"-Abhaengigkeitshinweise ergeben zusammen eine eindeutige Kette:
     extension-foundation(A) -> idle-guilds-settings-chat (Chat+Sichtbarkeit/
     Einladungscode-Grundlage, KEIN Phase-Buchstabe) -> guild-roles-veteran(D,
     fuehrt die Veteran-Rolle ein UND redefiniert zwei Funktionen aus der
     Chat-Datei) -> guild-tech-tree(E) -> guild-quests(F) [+ guild-quests-fix.sql
     + guild-quest-contribute-fix.sql, beide inhaltlich reine Bugfixes ohne
     eigene Phase-Kennzeichnung] -> guild-join-requests.sql (nennt explizit
     ALLE vier vorherigen Dateien als Abhaengigkeit) -> guild-extra-slots.sql
     (G folgt separat als Gildenboss, siehe Phase 4) - portiert:
       - set_guild_member_role: sql/supabase-guild-roles-veteran.sql (fuegt
         'veteran' als gueltige Zielrolle hinzu - ersetzt die reine
         officer/member-Fassung aus supabase-idle-guilds.sql. ECHTER
         Mock-Nachzuegler-Fund: der bestehende Phase-3-Mock nutzte noch die
         AELTERE, veteran-unbewusste Fassung - siehe Root-Cause-Kommentar
         direkt am gefixten Handler unten).
       - get_my_guild_invite_code: sql/supabase-guild-roles-veteran.sql
         (leader/officer/veteran duerfen einsehen - ersetzt die reine
         Anfuehrer-Fassung aus supabase-idle-guilds-settings-chat.sql).
       - regenerate_guild_invite_code/update_guild_settings: sql/supabase-
         idle-guilds-settings-chat.sql (keine spaetere Fassung gefunden -
         bleibt Anfuehrer-exklusiv, absichtlich NICHT auf Veteran erweitert,
         siehe Dateikommentar dort: "Den Code neu zu ERZEUGEN bleibt bewusst
         Anfuehrer-exklusiv").
       - send_guild_chat_message/delete_guild_chat_message: erstere aus
         supabase-idle-guilds-settings-chat.sql (keine spaetere Fassung),
         letztere komplett NEU aus supabase-guild-roles-veteran.sql (Veteran-
         Moderationsrecht, existierte vorher gar nicht).
       - guild_tech_upgrade: sql/supabase-guild-tech-tree.sql (einzige
         Fassung).
       - guild_quest_ensure_today/guild_quest_contribute: sql/supabase-guild-
         quest-contribute-fix.sql ist die massgebliche Fassung fuer
         contribute (stiller No-Op statt Exception bei fehlender
         Mitgliedschaft, numeric+round() statt direktem bigint-Cast fuer
         Dezimalwerte) - ensure_today aus supabase-guild-quests-fix.sql
         (inhaltlich identisch zur bereits im Basis-File dokumentierten
         Ambiguitaets-Korrektur).
       - buy_guild_slot: sql/supabase-guild-extra-slots.sql (einzige
         Fassung).
       - leave_guild/kick_guild_member/contribute_gold: sql/supabase-idle-
         guilds.sql (Basisversion ist hier bereits die einzige/aktuelle -
         keine spaetere Datei ersetzt sie)
     Bewusst NICHT portiert (ausserhalb des Phase-5-Auftragsumfangs):
     update_guild_banner/update_guild_goal (sql/supabase-guild-banner.sql,
     sql/supabase-guild-goal.sql - rein kosmetische Zusatzfelder, nicht Teil
     der 5 angefragten Systeme), Gildenchat-Realtime-Zustellung (siehe
     eigener Kommentar bei send_guild_chat_message unten). */
  create_guild(store, uid, params) {
    const name = String(params.p_name || '').trim();
    const tag = String(params.p_tag || '').trim().toUpperCase();
    const nameKey = name.toLowerCase();
    if (!name || name.length > 32) throw rpcError('invalid_name');
    if (!tag || tag.length > 5) throw rpcError('invalid_tag');

    const members = getTable(store, 'guild_members');
    if (members.some(m => m.auth_user_id === uid)) throw rpcError('already_in_guild');
    const guilds = getTable(store, 'guilds');
    if (guilds.some(g => g.name_key === nameKey)) throw rpcError('name_taken');

    const player = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
    if (!player) throw rpcError('no_idle_state');
    const cost = 500000;
    if (!(Number(player.gold) >= cost)) throw rpcError('insufficient_gold');

    player.gold = Number(player.gold) - cost;
    const guildId = 'qa-guild-' + store.nextId();
    guilds.push({
      id: guildId, name, name_key: nameKey, tag, description: '',
      leader_auth_user_id: uid, treasury_gold: cost, member_count: 1,
      is_public: true, bonus_member_slots: 0, invite_code: null,
      created_at: store.clock.nowIso()
    });
    members.push({
      auth_user_id: uid, guild_id: guildId, name_key: player.name_key,
      display_name: player.display_name, role: 'leader',
      contributed_gold: cost, joined_at: store.clock.nowIso()
    });
    return guildId;
  },

  join_guild(store, uid, params) {
    const guildId = params.p_guild_id;
    const members = getTable(store, 'guild_members');
    if (members.some(m => m.auth_user_id === uid)) throw rpcError('already_in_guild');
    const player = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
    if (!player) throw rpcError('no_idle_state');
    const guild = getTable(store, 'guilds').find(g => g.id === guildId);
    if (!guild) throw rpcError('guild_not_found');
    if (!guild.is_public) throw rpcError('guild_private');
    if (guild.member_count >= 20 + (guild.bonus_member_slots || 0)) throw rpcError('guild_full');

    members.push({
      auth_user_id: uid, guild_id: guildId, name_key: player.name_key,
      display_name: player.display_name, role: 'member',
      contributed_gold: 0, joined_at: store.clock.nowIso()
    });
    guild.member_count += 1;
    getTable(store, 'guild_activity_log').push({ id: store.nextId(), guild_id: guildId, kind: 'join', actor_name: player.display_name, created_at: store.clock.nowIso() });
    return null;
  },

  leave_guild(store, uid) {
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid);
    if (!me) throw rpcError('not_in_guild');
    const guildId = me.guild_id;
    const wasLeader = me.role === 'leader';
    const idx = members.indexOf(me);
    members.splice(idx, 1);

    const remaining = members.filter(m => m.guild_id === guildId);
    const guilds = getTable(store, 'guilds');
    const guild = guilds.find(g => g.id === guildId);
    if (remaining.length === 0) {
      const gIdx = guilds.indexOf(guild);
      if (gIdx >= 0) guilds.splice(gIdx, 1);
      return null;
    }
    guild.member_count = remaining.length;
    if (wasLeader) {
      // "order by (role='officer') desc, joined_at asc limit 1"
      remaining.sort((a, b) => {
        const aOfficer = a.role === 'officer' ? 0 : 1;
        const bOfficer = b.role === 'officer' ? 0 : 1;
        if (aOfficer !== bOfficer) return aOfficer - bOfficer;
        return new Date(a.joined_at) - new Date(b.joined_at);
      });
      const next = remaining[0];
      next.role = 'leader';
      guild.leader_auth_user_id = next.auth_user_id;
    }
    return null;
  },

  contribute_gold(store, uid, params) {
    const amount = Number(params.p_amount);
    if (!amount || amount <= 0) throw rpcError('invalid_amount');
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid);
    if (!me) throw rpcError('not_in_guild');
    const player = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
    if (!player || Number(player.gold) < amount) throw rpcError('insufficient_gold');
    player.gold = Number(player.gold) - amount;
    me.contributed_gold = Number(me.contributed_gold || 0) + amount;
    const guild = getTable(store, 'guilds').find(g => g.id === me.guild_id);
    guild.treasury_gold = Number(guild.treasury_gold || 0) + amount;
    return null;
  },

  kick_guild_member(store, uid, params) {
    const targetUid = params.p_target_auth_user_id;
    if (uid === targetUid) throw rpcError('cannot_kick_self');
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid);
    if (!me || !['leader', 'officer'].includes(me.role)) throw rpcError('not_authorized');
    const target = members.find(m => m.auth_user_id === targetUid);
    if (!target || target.guild_id !== me.guild_id) throw rpcError('not_a_member');
    if (target.role === 'leader') throw rpcError('cannot_kick_leader');
    if (me.role === 'officer' && target.role === 'officer') throw rpcError('not_authorized');

    members.splice(members.indexOf(target), 1);
    const guild = getTable(store, 'guilds').find(g => g.id === me.guild_id);
    guild.member_count = Math.max(0, guild.member_count - 1);
    return null;
  },

  /* Phase 5 (24.07.2026) - Root-Cause-Fund: dieser Handler stammte noch aus
     Phase 3 (portiert aus der Basisversion in sql/supabase-idle-guilds.sql,
     die nur 'officer'/'member' als gueltige Zielrolle kennt) - zu diesem
     Zeitpunkt war supabase-guild-roles-veteran.sql (fuehrt 'veteran' ein
     und redefiniert genau diese Funktion) noch nicht beruecksichtigt worden.
     Reiner Mock-Nachzuegler, kein Bug im echten App-/SQL-Code (beide waren
     immer schon konsistent zueinander) - ohne diesen Fix wuerde JEDE
     Befoerderung zu Veteran im Mock faelschlich mit invalid_role scheitern,
     obwohl BKMP_GUILD_ROLE_LADDER (bkmp-guild.js) das als echten,
     regulaeren Schritt anbietet. */
  set_guild_member_role(store, uid, params) {
    const targetUid = params.p_target_auth_user_id;
    const newRole = params.p_new_role;
    if (!['officer', 'veteran', 'member'].includes(newRole)) throw rpcError('invalid_role');
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid && m.role === 'leader');
    if (!me) throw rpcError('not_authorized');
    const target = members.find(m => m.auth_user_id === targetUid);
    if (!target || target.guild_id !== me.guild_id) throw rpcError('not_a_member');
    target.role = newRole;
    return null;
  },

  request_guild_join(store, uid, params) {
    const guildId = params.p_guild_id;
    const message = params.p_message;
    const members = getTable(store, 'guild_members');
    if (members.some(m => m.auth_user_id === uid)) throw rpcError('already_in_guild');
    const player = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
    if (!player) throw rpcError('no_idle_state');
    if (!getTable(store, 'guilds').some(g => g.id === guildId)) throw rpcError('guild_not_found');
    const requests = getTable(store, 'guild_join_requests');
    if (requests.some(r => r.guild_id === guildId && r.auth_user_id === uid && r.status === 'pending')) {
      throw rpcError('already_requested');
    }
    requests.push({
      id: 'qa-joinreq-' + store.nextId(), guild_id: guildId, auth_user_id: uid,
      name_key: player.name_key, display_name: player.display_name,
      message: message ? String(message).trim() || null : null,
      status: 'pending', created_at: store.clock.nowIso(), decided_at: null, decided_by_name: null
    });
    return null;
  },

  cancel_guild_join_request(store, uid, params) {
    const requestId = params.p_request_id;
    const requests = getTable(store, 'guild_join_requests');
    const req = requests.find(r => r.id === requestId && r.auth_user_id === uid && r.status === 'pending');
    if (!req) throw rpcError('request_not_found');
    req.status = 'cancelled';
    req.decided_at = store.clock.nowIso();
    return null;
  },

  respond_guild_join_request(store, uid, params) {
    const requestId = params.p_request_id;
    const accept = !!params.p_accept;
    const requests = getTable(store, 'guild_join_requests');
    const req = requests.find(r => r.id === requestId);
    if (!req) throw rpcError('request_not_found');
    if (req.status !== 'pending') throw rpcError('request_already_decided');

    const members = getTable(store, 'guild_members');
    const decider = members.find(m => m.auth_user_id === uid && m.guild_id === req.guild_id);
    if (!decider || !['leader', 'officer', 'veteran'].includes(decider.role)) throw rpcError('not_authorized');

    if (!accept) {
      req.status = 'rejected';
      req.decided_at = store.clock.nowIso();
      req.decided_by_name = decider.display_name;
      return null;
    }

    if (members.some(m => m.auth_user_id === req.auth_user_id)) {
      req.status = 'cancelled';
      req.decided_at = store.clock.nowIso();
      req.decided_by_name = decider.display_name;
      throw rpcError('requester_already_in_guild');
    }

    const guild = getTable(store, 'guilds').find(g => g.id === req.guild_id);
    if (guild.member_count >= 20 + (guild.bonus_member_slots || 0)) throw rpcError('guild_full');

    members.push({
      auth_user_id: req.auth_user_id, guild_id: req.guild_id, name_key: req.name_key,
      display_name: req.display_name, role: 'member', contributed_gold: 0, joined_at: store.clock.nowIso()
    });
    guild.member_count += 1;
    getTable(store, 'guild_activity_log').push({ id: store.nextId(), guild_id: req.guild_id, kind: 'join', actor_name: req.display_name, created_at: store.clock.nowIso() });

    req.status = 'accepted';
    req.decided_at = store.clock.nowIso();
    req.decided_by_name = decider.display_name;

    // Alle anderen offenen Anfragen desselben Spielers stornieren.
    requests.forEach(r => {
      if (r.auth_user_id === req.auth_user_id && r.status === 'pending' && r.id !== requestId) {
        r.status = 'cancelled';
        r.decided_at = store.clock.nowIso();
      }
    });
    return null;
  },

  /* Phase 5 (24.07.2026, siehe CLAUDE.md) - Einladungen/Sichtbarkeit
     (sql/supabase-idle-guilds-settings-chat.sql + sql/supabase-guild-roles-
     veteran.sql, siehe Herleitungs-Kommentar oben bei create_guild). */
  get_my_guild_invite_code(store, uid) {
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid && ['leader', 'officer', 'veteran'].includes(m.role));
    if (!me) throw rpcError('not_authorized');
    const guild = getTable(store, 'guilds').find(g => g.id === me.guild_id);
    return guild ? (guild.invite_code || null) : null;
  },

  regenerate_guild_invite_code(store, uid) {
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid && m.role === 'leader');
    if (!me) throw rpcError('not_authorized');
    const guild = getTable(store, 'guilds').find(g => g.id === me.guild_id);
    const code = Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, 'X').slice(0, 8);
    guild.invite_code = code;
    return code;
  },

  update_guild_settings(store, uid, params) {
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid && m.role === 'leader');
    if (!me) throw rpcError('not_authorized');
    const guild = getTable(store, 'guilds').find(g => g.id === me.guild_id);
    const description = String(params.p_description == null ? '' : params.p_description).trim().slice(0, 200);
    const isPublic = !!params.p_is_public;
    let code = null;
    if (!isPublic) {
      code = guild.invite_code || (Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, 'X').slice(0, 8));
    }
    guild.description = description;
    guild.is_public = isPublic;
    guild.invite_code = code || guild.invite_code || null;
    return code;
  },

  join_guild_by_code(store, uid, params) {
    const code = String(params.p_code || '').trim().toUpperCase();
    const members = getTable(store, 'guild_members');
    if (members.some(m => m.auth_user_id === uid)) throw rpcError('already_in_guild');
    const player = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
    if (!player) throw rpcError('no_idle_state');
    const guild = getTable(store, 'guilds').find(g => g.invite_code === code);
    if (!guild) throw rpcError('invalid_code');
    if (guild.member_count >= 20 + (guild.bonus_member_slots || 0)) throw rpcError('guild_full');

    members.push({
      auth_user_id: uid, guild_id: guild.id, name_key: player.name_key,
      display_name: player.display_name, role: 'member', contributed_gold: 0, joined_at: store.clock.nowIso()
    });
    guild.member_count += 1;
    getTable(store, 'guild_activity_log').push({ id: store.nextId(), guild_id: guild.id, kind: 'join', actor_name: player.display_name, created_at: store.clock.nowIso() });
    return guild.id;
  },

  /* Phase 5 (24.07.2026) - Gildenchat (sql/supabase-idle-guilds-settings-
     chat.sql + delete_guild_chat_message aus sql/supabase-guild-roles-
     veteran.sql). Bewusst KEIN echtes Realtime-Ereignis ausgeloest -
     bkmpSubscribeToGuildChat() (supabase.js) haengt an postgres_changes auf
     guild_chat_messages; der lokale Mock-Realtime-Server (siehe
     tests/mock/server.js) akzeptiert WebSocket-Verbindungen nur still ohne
     jedes Message-Framing (identisches, bereits etabliertes Prinzip wie bei
     Raid/Gildenboss) - ein Test, der auf ein Live-Update wartet, wuerde
     also nie eins bekommen; alle Chat-Tests lesen stattdessen ueber
     loadGuildChatMessages()/window.bkmpGuildGetChatMessages() erneut, exakt
     wie ein Spieler es nach einem manuellen Neuladen des Panels saehe. */
  send_guild_chat_message(store, uid, params) {
    const message = String(params.p_message == null ? '' : params.p_message).trim();
    if (!message || message.length > 300) throw rpcError('invalid_message');
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid);
    if (!me) throw rpcError('not_in_guild');
    getTable(store, 'guild_chat_messages').push({
      id: 'qa-chatmsg-' + store.nextId(), guild_id: me.guild_id, auth_user_id: uid,
      display_name: me.display_name, message, created_at: store.clock.nowIso()
    });
    return null;
  },

  delete_guild_chat_message(store, uid, params) {
    const messageId = params.p_message_id;
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid);
    if (!me || !['leader', 'officer', 'veteran'].includes(me.role)) throw rpcError('not_authorized');
    const messages = getTable(store, 'guild_chat_messages');
    const msg = messages.find(m => m.id === messageId);
    if (!msg || msg.guild_id !== me.guild_id) throw rpcError('not_a_member');
    messages.splice(messages.indexOf(msg), 1);
    return null;
  },

  /* Phase 5 (24.07.2026) - Gilden-Technologie (sql/supabase-guild-tech-
     tree.sql, einzige Fassung). 9 gueltige tech_id-Werte + Kostenkurve
     (200000 * 1,4^Stufe) serverseitig hart hinterlegt, exakt wie im echten
     SQL - dem Client wird nie vertraut. */
  guild_tech_upgrade(store, uid, params) {
    const techId = params.p_tech_id;
    /* Gilden-Technologie v2 (26.07.2026, siehe sql/20260726-guild-tech-
       branches-v2.sql) - die 9 STANDARD-Zweige behalten EXAKT ihre
       bisherigen Werte (20/200000/1,4). Rebalance (26.07., siehe
       sql/20260726-guild-tech-rebalance-paragon.sql): die 8 nicht-TOGGLE
       neuen Zweige bekamen deutlich hoehere Maximalstufen/Kosten + eine
       Paragon-Fortfuehrung ("<id>__paragon", max. Rang 1000) danach. */
    const TECH_TIERS = {
      attack: { max: 20, base: 200000, growth: 1.4 }, defense: { max: 20, base: 200000, growth: 1.4 },
      gold: { max: 20, base: 200000, growth: 1.4 }, crit_chance: { max: 20, base: 200000, growth: 1.4 },
      crit_damage: { max: 20, base: 200000, growth: 1.4 }, boss_damage: { max: 20, base: 200000, growth: 1.4 },
      rune_luck: { max: 20, base: 200000, growth: 1.4 }, xp: { max: 20, base: 200000, growth: 1.4 },
      prestige: { max: 20, base: 200000, growth: 1.4 },
      guild_kriegsrat: { max: 15, base: 600000, growth: 1.5 },
      guild_aufstiegsvorbereitung: { max: 15, base: 600000, growth: 1.5 },
      guild_turm_vorreiter: { max: 25, base: 350000, growth: 1.28 },
      guild_autokauf: { max: 25, base: 350000, growth: 1.28 },
      guild_nachtwache: { max: 25, base: 350000, growth: 1.28 },
      guild_stadtmauer: { max: 25, base: 350000, growth: 1.28 },
      guild_brutbeschleuniger: { max: 35, base: 250000, growth: 1.18 },
      guild_schmiede: { max: 35, base: 250000, growth: 1.18 },
      guild_streak_schutz: { max: 1, base: 8000000, growth: 1 },
      guild_willkommenspaket: { max: 1, base: 8000000, growth: 1 },
      'guild_kriegsrat__paragon': { max: 1000, base: 289009968, growth: 1.65, baseTechId: 'guild_kriegsrat' },
      'guild_aufstiegsvorbereitung__paragon': { max: 1000, base: 289009968, growth: 1.65, baseTechId: 'guild_aufstiegsvorbereitung' },
      'guild_turm_vorreiter__paragon': { max: 1000, base: 187259282, growth: 1.43, baseTechId: 'guild_turm_vorreiter' },
      'guild_autokauf__paragon': { max: 1000, base: 187259282, growth: 1.43, baseTechId: 'guild_autokauf' },
      'guild_nachtwache__paragon': { max: 1000, base: 187259282, growth: 1.43, baseTechId: 'guild_nachtwache' },
      'guild_stadtmauer__paragon': { max: 1000, base: 187259282, growth: 1.43, baseTechId: 'guild_stadtmauer' },
      'guild_brutbeschleuniger__paragon': { max: 1000, base: 92422965, growth: 1.33, baseTechId: 'guild_brutbeschleuniger' },
      'guild_schmiede__paragon': { max: 1000, base: 92422965, growth: 1.33, baseTechId: 'guild_schmiede' }
    };
    const tier = TECH_TIERS[techId];
    if (!tier) throw rpcError('invalid_tech');
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid);
    if (!me || !['leader', 'officer'].includes(me.role)) throw rpcError('not_authorized');
    const guild = getTable(store, 'guilds').find(g => g.id === me.guild_id);

    const levels = getTable(store, 'guild_tech_levels');
    if (tier.baseTechId) {
      const baseTier = TECH_TIERS[tier.baseTechId];
      const baseRow = levels.find(r => r.guild_id === me.guild_id && r.tech_id === tier.baseTechId);
      const baseLevel = baseRow ? Number(baseRow.level || 0) : 0;
      if (baseLevel < baseTier.max) throw rpcError('base_not_maxed');
    }
    let levelRow = levels.find(r => r.guild_id === me.guild_id && r.tech_id === techId);
    const currentLevel = levelRow ? Number(levelRow.level || 0) : 0;
    if (currentLevel >= tier.max) throw rpcError('max_level');

    const cost = Math.round(tier.base * Math.pow(tier.growth, currentLevel));
    const treasury = Number(guild.treasury_gold || 0);
    if (treasury < cost) throw rpcError('insufficient_treasury');

    guild.treasury_gold = treasury - cost;
    if (levelRow) levelRow.level = currentLevel + 1;
    else { levelRow = { guild_id: me.guild_id, tech_id: techId, level: 1 }; levels.push(levelRow); }

    getTable(store, 'guild_activity_log').push({
      id: store.nextId(), guild_id: me.guild_id, kind: 'tech_upgrade',
      actor_name: me.display_name, value: levelRow.level, extra: techId, created_at: store.clock.nowIso()
    });
    return { new_level: levelRow.level, treasury_gold: guild.treasury_gold };
  },

  /* Phase 5 (24.07.2026) - Gildenplaetze dazukaufen (sql/supabase-guild-
     extra-slots.sql, einzige Fassung). Gleiches Rechte-/Kosten-Prinzip wie
     guild_tech_upgrade oben. */
  buy_guild_slot(store, uid) {
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid);
    if (!me || !['leader', 'officer'].includes(me.role)) throw rpcError('not_authorized');
    const guild = getTable(store, 'guilds').find(g => g.id === me.guild_id);

    const currentBonus = Number(guild.bonus_member_slots || 0);
    if (currentBonus >= 10) throw rpcError('max_slots');

    const cost = Math.round(400000 * Math.pow(1.5, currentBonus));
    const treasury = Number(guild.treasury_gold || 0);
    if (treasury < cost) throw rpcError('insufficient_treasury');

    guild.treasury_gold = treasury - cost;
    guild.bonus_member_slots = currentBonus + 1;

    getTable(store, 'guild_activity_log').push({
      id: store.nextId(), guild_id: me.guild_id, kind: 'slot_purchase',
      actor_name: me.display_name, value: 20 + guild.bonus_member_slots, created_at: store.clock.nowIso()
    });
    return { new_bonus_slots: guild.bonus_member_slots, treasury_gold: guild.treasury_gold };
  },

  /* Phase 5 (24.07.2026) - Taegliche Gildenquests. guild_quest_ensure_today:
     sql/supabase-guild-quests-fix.sql (Ambiguitaets-Fix, inhaltlich
     identisch zur bereits im Basis-File dokumentierten Loesung).
     guild_quest_contribute: sql/supabase-guild-quest-contribute-fix.sql
     (massgebliche Fassung - stiller No-Op statt Exception bei fehlender
     Mitgliedschaft, numeric+round() Delta-Parsing statt direktem
     bigint-Cast). "3 Quests/Tag, zufaellig aus 4 Typen" nutzt store.rng()
     (seedbar, faellt ohne Seed auf Math.random() zurueck - identisches
     Prinzip wie arena_attack() in Phase 3) statt echtem Math.random()
     direkt, damit ein Test bei Bedarf einen festen Seed fuer eine
     vorhersagbare Quest-Auswahl setzen kann. */
  guild_quest_ensure_today(store, uid) {
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid);
    if (!me) throw rpcError('not_in_guild');
    const today = berlinDateStr(store.clock.nowMs());
    const quests = getTable(store, 'guild_daily_quests');
    const existing = quests.filter(q => q.guild_id === me.guild_id && q.quest_date === today);
    if (existing.length === 0) {
      const types = ['dragon_kills', 'gold_earned', 'arena_wins', 'prestige_ups'];
      const pool = types.slice();
      const chosen = [];
      for (let i = 0; i < 3 && pool.length; i++) {
        const idx = Math.floor(store.rng() * pool.length);
        chosen.push(pool.splice(idx, 1)[0]);
      }
      const targetFor = (type) => {
        switch (type) {
          case 'dragon_kills': return 300 + Math.floor(store.rng() * 500);
          case 'gold_earned': return 1000000 + Math.floor(store.rng() * 4000000);
          case 'arena_wins': return 50 + Math.floor(store.rng() * 100);
          case 'prestige_ups': return 5 + Math.floor(store.rng() * 15);
          default: return 0;
        }
      };
      chosen.forEach((type, i) => {
        quests.push({
          id: 'qa-quest-' + store.nextId(), guild_id: me.guild_id, quest_date: today,
          quest_type: type, target: targetFor(type), progress: 0, tier: i + 1,
          completed: false, created_at: store.clock.nowIso()
        });
      });
    }
    return quests
      .filter(q => q.guild_id === me.guild_id && q.quest_date === today)
      .sort((a, b) => a.tier - b.tier)
      .map(q => ({ id: q.id, quest_type: q.quest_type, target: q.target, progress: q.progress, tier: q.tier, completed: q.completed }));
  },

  guild_quest_contribute(store, uid, params) {
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid);
    if (!me) return null; // stiller No-Op, siehe Dateikommentar (quest-contribute-fix.sql)
    const today = berlinDateStr(store.clock.nowMs());
    const quests = getTable(store, 'guild_daily_quests');
    const deltas = params.p_deltas && typeof params.p_deltas === 'object' ? params.p_deltas : {};

    Object.keys(deltas).forEach(key => {
      const rawDelta = Number(deltas[key]);
      const delta = Number.isFinite(rawDelta) ? Math.round(rawDelta) : NaN;
      if (!Number.isFinite(delta) || delta <= 0) return;

      const quest = quests.find(q => q.guild_id === me.guild_id && q.quest_date === today && q.quest_type === key && !q.completed);
      if (!quest) return;

      const newProgress = Math.min(quest.target, quest.progress + delta);
      const justCompleted = newProgress >= quest.target;
      quest.progress = newProgress;
      quest.completed = justCompleted;

      if (justCompleted) {
        getTable(store, 'guild_activity_log').push({ id: store.nextId(), guild_id: me.guild_id, kind: 'quest_completed', extra: key, created_at: store.clock.nowIso() });
        const rewardGold = quest.tier === 1 ? 2000 : quest.tier === 2 ? 6000 : 15000;
        const rewardCrystals = quest.tier === 1 ? 20 : quest.tier === 2 ? 50 : 100;
        const guildMembers = members.filter(m => m.guild_id === me.guild_id);
        const playerStates = getTable(store, 'idle_player_state');
        const runes = getTable(store, 'idle_player_runes');
        const prestigeStates = getTable(store, 'idle_prestige_state');
        guildMembers.forEach(member => {
          const ps = playerStates.find(p => p.auth_user_id === member.auth_user_id);
          if (ps) { ps.gold = Number(ps.gold || 0) + rewardGold; ps.crystals = Number(ps.crystals || 0) + rewardCrystals; }
          if (quest.tier === 2) {
            for (let i = 0; i < 2; i++) {
              const rarity = store.rng() < 0.5 ? 'blue' : 'purple';
              runes.push({
                id: 'qa-quest-rune-' + store.nextId(), name_key: member.name_key, auth_user_id: member.auth_user_id,
                rune_type: 'slot' + (1 + Math.floor(store.rng() * 6)), rarity, rolled_value: rarity === 'purple' ? 6.8 : 4.8,
                equipped: false, upgrade_level: 0, substats: [], created_at: store.clock.nowIso()
              });
            }
          } else if (quest.tier === 3) {
            runes.push({
              id: 'qa-quest-rune-' + store.nextId(), name_key: member.name_key, auth_user_id: member.auth_user_id,
              rune_type: 'slot' + (1 + Math.floor(store.rng() * 6)), rarity: 'gold', rolled_value: 10,
              equipped: false, upgrade_level: 0, substats: [], created_at: store.clock.nowIso()
            });
            let prestige = prestigeStates.find(p => p.name_key === member.name_key);
            if (prestige) prestige.prestige_points = Number(prestige.prestige_points || 0) + 10;
            else prestigeStates.push({ name_key: member.name_key, display_name: member.display_name, prestige_level: 0, prestige_points: 10, prestige_points_spent: 0, prestige_allocations: {}, updated_at: store.clock.nowIso() });
          }
        });
      }
    });
    return null;
  },

  /* Stabilitaets-/Testabdeckungsphase (24.07.2026, siehe CLAUDE.md "Phase 4") -
     player_heartbeat: 1:1 aus sql/supabase-guild-extension-foundation.sql
     (einzige Fassung, nie ersetzt). Kontostatus, NICHT gildengebunden. */
  player_heartbeat(store, uid) {
    const rows = getTable(store, 'player_presence');
    let row = rows.find(r => r.auth_user_id === uid);
    if (!row) { row = { auth_user_id: uid }; rows.push(row); }
    row.last_seen_at = store.clock.nowIso();
    return null;
  },

  /* Weltboss-/Raid-Kernmechanik - originalgetreuer Port der jeweils
     aktuellsten Fassung:
       - raid_join: sql/20260719-fix-raid-guildboss-hour-check.sql (prueft die
         Gildenboss-Stunden-Sperre gegen die START-Stunde DES RAIDS, nicht
         "jetzt" - ersetzt die frühere Fassung aus supabase-raid-pause-
         guildboss-hour.sql, die exakt diesen Bug hatte)
       - raid_deal_damage/raid_boss_attack_tick: sql/supabase-raid-boss-
         combined-latest.sql (konsolidiert damage-sync-fix.sql's own_*-
         Rueckgabespalten MIT balance-v2/v3/v4's 5%-Gegenangriff-Balance -
         siehe CLAUDE.md/Dateikommentar dort fuer die urspruengliche
         Divergenz zwischen beiden unabhaengig entstandenen Fassungen)
       - raid_finish: interner Helfer, siehe raidFinishInternal() oben. */
  raid_join(store, uid, params) {
    const raidId = String(params.p_raid_id || '');
    const fightStartsMs = parseRaidIdToMs(raidId);
    if (!Number.isFinite(fightStartsMs)) throw rpcError('invalid_raid_id');
    const prepStartsMs = fightStartsMs - 5 * 60000;
    const nowMs = store.clock.nowMs();

    if (berlinParts(fightStartsMs).hour === 20) throw rpcError('raid_paused_guild_boss_hour');
    if (nowMs < prepStartsMs || nowMs >= fightStartsMs) throw rpcError('not_in_prep_window');

    const player = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
    if (!player) throw rpcError('no_idle_state');

    // Gilden-Technologie v2 (26.07.), "Stadtmauer": +1% eigener HP-Beitrag
    // zum Stadt-HP-Pool pro Stufe.
    const stadtmauerLevel = guildTechLevelFor(store, uid, 'guild_stadtmauer');
    const effectiveHp = Number(player.hp || 0) * (1 + stadtmauerLevel * 0.01);

    const instances = getTable(store, 'raid_instances');
    let inst = instances.find(r => r.id === raidId);
    if (!inst) {
      const bosses = getTable(store, 'raid_bosses');
      const boss = bosses.find(b => b.active !== false) || bosses[0];
      if (!boss) throw rpcError('no_active_boss');
      inst = {
        id: raidId, boss_id: boss.id,
        boss_max_hp: Number(boss.base_hp), boss_hp: Number(boss.base_hp),
        city_max_hp: 0, city_hp: 0, city_attack: 0, city_defense: 0,
        status: 'prep',
        fight_starts_at: new Date(fightStartsMs).toISOString(),
        fight_ends_at: new Date(fightStartsMs + 55 * 60000).toISOString(),
        next_boss_attack_at: new Date(fightStartsMs).toISOString(),
        started_fight_at: null, ended_at: null,
        participant_count: 0, total_damage: 0, last_counter_hp: null
      };
      instances.push(inst);
    }

    const participants = getTable(store, 'raid_participants');
    let p = participants.find(r => r.raid_id === raidId && r.auth_user_id === uid);
    if (p) {
      p.attack = Number(player.attack || 0); p.defense = Number(player.defense || 0);
      p.hp = effectiveHp; p.display_name = player.display_name;
    } else {
      p = {
        raid_id: raidId, auth_user_id: uid, display_name: player.display_name,
        attack: Number(player.attack || 0), defense: Number(player.defense || 0), hp: effectiveHp,
        damage_dealt: 0, crits_landed: 0, clicks_landed: 0, joined_at: store.clock.nowIso()
      };
      participants.push(p);
    }

    // Boss-/Stadt-HP nur waehrend 'prep' neu skalieren (echtes SQL: "where
    // ... and status='prep'" in der UPDATE-Klausel - ein spaeterer erneuter
    // raid_join()-Aufruf nach Kampfbeginn darf laufende HP nicht zuruecksetzen).
    if (inst.status === 'prep') {
      const mine = participants.filter(r => r.raid_id === raidId);
      const totalHp = mine.reduce((s, r) => s + Number(r.hp || 0), 0);
      const totalAttack = mine.reduce((s, r) => s + Number(r.attack || 0), 0);
      const totalDefense = mine.reduce((s, r) => s + Number(r.defense || 0), 0);
      const boss = getTable(store, 'raid_bosses').find(b => b.id === inst.boss_id) || {};
      inst.city_max_hp = totalHp; inst.city_hp = totalHp;
      inst.city_attack = totalAttack; inst.city_defense = totalDefense;
      inst.participant_count = mine.length;
      const scaledHp = Math.max(Number(boss.base_hp || 0), Math.round(totalAttack * Number(boss.hp_scale_per_attack || 150)));
      inst.boss_max_hp = scaledHp; inst.boss_hp = scaledHp;
    }

    const raidStats = getTable(store, 'raid_player_stats');
    let stats = raidStats.find(s => s.auth_user_id === uid);
    if (stats) { stats.total_raids_joined = Number(stats.total_raids_joined || 0) + 1; stats.display_name = player.display_name; }
    else {
      stats = {
        auth_user_id: uid, display_name: player.display_name, total_raids_joined: 1,
        total_bosses_defeated: 0, total_damage_dealt: 0, total_mvp_count: 0, total_flawless_wins: 0, best_single_raid_damage: 0
      };
      raidStats.push(stats);
    }

    const boss = getTable(store, 'raid_bosses').find(b => b.id === inst.boss_id) || {};
    return {
      city_hp: inst.city_hp, city_max_hp: inst.city_max_hp,
      boss_hp: inst.boss_hp, boss_max_hp: inst.boss_max_hp,
      boss_name: boss.name, sprite_key: boss.sprite_key
    };
  },

  raid_deal_damage(store, uid, params) {
    const raidId = params.p_raid_id;
    const amount = clampDamageAmount(params.p_amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 200000) throw rpcError('invalid_amount');
    const isCrit = !!params.p_is_crit;
    const isClick = !!params.p_is_click;

    const p = getTable(store, 'raid_participants').find(r => r.raid_id === raidId && r.auth_user_id === uid);
    if (!p) throw rpcError('not_a_participant');

    const inst = getTable(store, 'raid_instances').find(r => r.id === raidId);
    if (!inst) throw rpcError('raid_not_found');
    if (inst.status !== 'fighting') throw rpcError('raid_not_active');

    inst.boss_hp = Math.max(0, Number(inst.boss_hp) - amount);
    inst.total_damage = Number(inst.total_damage || 0) + amount;
    p.damage_dealt = Number(p.damage_dealt || 0) + amount;
    p.crits_landed = Number(p.crits_landed || 0) + (isCrit ? 1 : 0);
    p.clicks_landed = Number(p.clicks_landed || 0) + (isClick ? 1 : 0);

    const raidStats = getTable(store, 'raid_player_stats').find(s => s.auth_user_id === uid);
    if (raidStats) {
      raidStats.total_damage_dealt = Number(raidStats.total_damage_dealt || 0) + amount;
      raidStats.best_single_raid_damage = Math.max(Number(raidStats.best_single_raid_damage || 0), p.damage_dealt);
    }

    if (inst.boss_hp <= 0) {
      raidFinishInternal(store, raidId, 'won');
      return { boss_hp: inst.boss_hp, status: inst.status, own_damage_dealt: p.damage_dealt, own_crits_landed: p.crits_landed, own_clicks_landed: p.clicks_landed };
    }

    // Gegenangriff nur alle 5% Boss-HP-Fortschritt (Balance-v2/v3/v4).
    const bossMaxHp = Number(inst.boss_max_hp);
    const lastCounter = inst.last_counter_hp == null ? bossMaxHp : Number(inst.last_counter_hp);
    if (lastCounter - inst.boss_hp >= bossMaxHp * 0.05) {
      const cityDmg = Math.max(1, Math.round(Number(inst.city_max_hp) * 0.014));
      inst.city_hp = Math.max(0, Number(inst.city_hp) - cityDmg);
      inst.last_counter_hp = inst.boss_hp;
      if (inst.city_hp <= 0) raidFinishInternal(store, raidId, 'lost');
    }

    return { boss_hp: inst.boss_hp, status: inst.status, own_damage_dealt: p.damage_dealt, own_crits_landed: p.crits_landed, own_clicks_landed: p.clicks_landed };
  },

  raid_boss_attack_tick(store, uid, params) {
    const raidId = params.p_raid_id;
    if (!getTable(store, 'raid_participants').some(r => r.raid_id === raidId && r.auth_user_id === uid)) throw rpcError('not_a_participant');

    const inst = getTable(store, 'raid_instances').find(r => r.id === raidId);
    if (!inst) throw rpcError('raid_not_found');

    const nowMs = store.clock.nowMs();
    const fightStartsMs = Date.parse(inst.fight_starts_at);
    const fightEndsMs = Date.parse(inst.fight_ends_at);

    if (inst.status === 'prep' && nowMs >= fightStartsMs) {
      inst.status = 'fighting';
      inst.started_fight_at = inst.started_fight_at || store.clock.nowIso();
    }

    if (inst.status === 'fighting' && nowMs >= fightEndsMs) {
      raidFinishInternal(store, raidId, 'expired');
      return { city_hp: inst.city_hp, boss_hp: inst.boss_hp, status: inst.status };
    }

    if (inst.status === 'fighting') {
      const nextAttackMs = Date.parse(inst.next_boss_attack_at);
      if (nextAttackMs <= nowMs) {
        const dmg = Math.max(1, Math.round(Number(inst.city_max_hp) * 0.014));
        const boss = getTable(store, 'raid_bosses').find(b => b.id === inst.boss_id) || {};
        const intervalSecs = Math.max(1.5, Number(boss.attack_interval_seconds || 6) * Number(inst.boss_hp) / Math.max(1, Number(inst.boss_max_hp)));
        inst.city_hp = Math.max(0, Number(inst.city_hp) - dmg);
        inst.next_boss_attack_at = new Date(nowMs + intervalSecs * 1000).toISOString();
        if (inst.city_hp <= 0) raidFinishInternal(store, raidId, 'lost');
      }
    }

    return { city_hp: inst.city_hp, boss_hp: inst.boss_hp, status: inst.status };
  },

  /* Gildenboss-Kernmechanik - originalgetreuer Port der jeweils aktuellsten
     Fassung:
       - guild_boss_join: sql/supabase-guild-boss-ambiguous-status-fix.sql
         (behebt "column reference is ambiguous" der Basisversion - reine
         SQL-Alias-Korrektur, Spiellogik selbst unveraendert)
       - guild_boss_deal_damage: sql/supabase-guild-boss-damage-sync-fix.sql
         (own_*-Rueckgabespalten, baut auf der ambiguous-status-fix.sql-Fassung
         auf, "1:1 uebernommen" laut eigenem Dateikommentar)
       - guild_boss_finish: sql/supabase-guild-boss.sql (einzige Fassung,
         siehe guildBossFinishInternal() oben). supabase-guild-boss-reward-
         increase.sql aendert nur Daten (gold_reward/gem_reward auf
         5.000.000/20.000), keine Funktionsaenderung - in der Teststand-
         Fixture direkt mit den erhoehten Werten geseedet.
     Absichtlich UNGEPRUEFT gegen aktuelle guild_members-Mitgliedschaft in
     guild_boss_deal_damage() - exakt wie im echten SQL (nur guild_boss_
     participants wird geprueft), ein Spieler, der NACH dem Beitritt die
     Gilde verlaesst, kann also weiter Schaden einreichen. Kein Bug, echtes
     bestehendes Verhalten - nicht "repariert", nur nachgebildet. */
  guild_boss_join(store, uid) {
    const members = getTable(store, 'guild_members');
    const me = members.find(m => m.auth_user_id === uid);
    if (!me) throw rpcError('not_in_guild');
    const guildId = me.guild_id;

    const player = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
    if (!player) throw rpcError('no_idle_state');

    const nowMs = store.clock.nowMs();
    const midnightMs = berlinMidnightMs(nowMs);
    const windowStartMs = midnightMs + 20 * 3600 * 1000;
    const windowEndMs = windowStartMs + 3600 * 1000;
    const prepStartMs = windowStartMs - 5 * 60000;
    if (nowMs < prepStartMs || nowMs >= windowEndMs) throw rpcError('not_in_window');

    const instanceId = guildId + '-' + berlinDateStrCompact(nowMs);
    const instances = getTable(store, 'guild_boss_instances');
    let inst = instances.find(r => r.id === instanceId);
    if (!inst) {
      const bosses = getTable(store, 'guild_bosses');
      const boss = bosses.find(b => b.active !== false) || bosses[0];
      if (!boss) throw rpcError('no_boss_configured');
      const memberUids = new Set(members.filter(m => m.guild_id === guildId).map(m => m.auth_user_id));
      const totalAttack = getTable(store, 'idle_player_state')
        .filter(ps => memberUids.has(ps.auth_user_id))
        .reduce((s, ps) => s + Number(ps.attack || 0), 0);
      const scaledHp = Math.max(Number(boss.base_hp), Math.round(totalAttack * Number(boss.hp_scale_per_attack || 150)));
      inst = {
        id: instanceId, guild_id: guildId, boss_id: boss.id,
        boss_max_hp: scaledHp, boss_hp: scaledHp, status: 'prep',
        fight_starts_at: new Date(windowStartMs).toISOString(),
        fight_ends_at: new Date(windowEndMs).toISOString(),
        started_fight_at: null, ended_at: null,
        participant_count: 0, total_damage: 0
      };
      instances.push(inst);
      const guild = getTable(store, 'guilds').find(g => g.id === guildId);
      if (guild) guild.boss_attempts = Number(guild.boss_attempts || 0) + 1;
    }

    if (nowMs >= windowStartMs && inst.status === 'prep') {
      inst.status = 'fighting';
      inst.started_fight_at = inst.started_fight_at || store.clock.nowIso();
    }

    const participants = getTable(store, 'guild_boss_participants');
    let p = participants.find(r => r.instance_id === instanceId && r.auth_user_id === uid);
    if (!p) {
      p = { instance_id: instanceId, auth_user_id: uid, display_name: player.display_name, damage_dealt: 0, crits_landed: 0, clicks_landed: 0, joined_at: store.clock.nowIso() };
      participants.push(p);
    }
    inst.participant_count = participants.filter(r => r.instance_id === instanceId).length;

    const statsRows = getTable(store, 'guild_boss_player_stats');
    let s = statsRows.find(r => r.auth_user_id === uid);
    if (s) { s.total_fights_joined = Number(s.total_fights_joined || 0) + 1; s.display_name = player.display_name; }
    else {
      s = { auth_user_id: uid, display_name: player.display_name, total_fights_joined: 1, total_bosses_defeated: 0, total_damage_dealt: 0, best_single_fight_damage: 0 };
      statsRows.push(s);
    }

    const boss = getTable(store, 'guild_bosses').find(b => b.id === inst.boss_id) || {};
    return {
      instance_id: inst.id, boss_hp: inst.boss_hp, boss_max_hp: inst.boss_max_hp, status: inst.status,
      boss_name: boss.name, sprite_key: boss.sprite_key,
      fight_starts_at: inst.fight_starts_at, fight_ends_at: inst.fight_ends_at
    };
  },

  guild_boss_deal_damage(store, uid, params) {
    const instanceId = params.p_instance_id;
    const amount = clampDamageAmount(params.p_amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 200000) throw rpcError('invalid_amount');
    const isCrit = !!params.p_is_crit;
    const isClick = !!params.p_is_click;

    const p = getTable(store, 'guild_boss_participants').find(r => r.instance_id === instanceId && r.auth_user_id === uid);
    if (!p) throw rpcError('not_a_participant');

    const inst = getTable(store, 'guild_boss_instances').find(r => r.id === instanceId);
    if (!inst) throw rpcError('boss_not_found');
    if (inst.status !== 'fighting') throw rpcError('boss_not_active');

    const nowMs = store.clock.nowMs();
    if (nowMs >= Date.parse(inst.fight_ends_at)) {
      guildBossFinishInternal(store, instanceId, 'expired');
      return { boss_hp: inst.boss_hp, status: inst.status, own_damage_dealt: p.damage_dealt, own_crits_landed: p.crits_landed, own_clicks_landed: p.clicks_landed };
    }

    inst.boss_hp = Math.max(0, Number(inst.boss_hp) - amount);
    inst.total_damage = Number(inst.total_damage || 0) + amount;
    p.damage_dealt = Number(p.damage_dealt || 0) + amount;
    p.crits_landed = Number(p.crits_landed || 0) + (isCrit ? 1 : 0);
    p.clicks_landed = Number(p.clicks_landed || 0) + (isClick ? 1 : 0);

    const stats = getTable(store, 'guild_boss_player_stats').find(s => s.auth_user_id === uid);
    if (stats) {
      stats.total_damage_dealt = Number(stats.total_damage_dealt || 0) + amount;
      stats.best_single_fight_damage = Math.max(Number(stats.best_single_fight_damage || 0), p.damage_dealt);
    }

    if (inst.boss_hp <= 0) guildBossFinishInternal(store, instanceId, 'won');

    return { boss_hp: inst.boss_hp, status: inst.status, own_damage_dealt: p.damage_dealt, own_crits_landed: p.crits_landed, own_clicks_landed: p.clicks_landed };
  }
};

function handleRpcRequest(store, uid, fnName, params) {
  const handler = RPC_HANDLERS[fnName];
  if (!handler) {
    // Permissive no-op fallback for RPCs outside Stage-1 scope (claim_player_row,
    // resolve_login_name, is_active_admin, ...) so unrelated flows don't crash.
    return { status: 200, json: null };
  }
  try {
    const result = handler(store, uid, params || {});
    return { status: 200, json: result };
  } catch (err) {
    if (err.isRpcError) return { status: 400, json: { message: err.message, code: err.message } };
    throw err;
  }
}

module.exports = { handleRpcRequest, berlinDateStr, dungeonRegenCalc, DUNGEON_TYPES, DIFFICULTY_LADDER };
