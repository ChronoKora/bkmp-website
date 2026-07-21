/* Faithful JS port of the dungeon-system Postgres functions in
   sql/supabase-dungeon-system-v2.sql (base) + sql/supabase-dungeon-fixed-
   key-times.sql (the CURRENT, authoritative dungeon_regen_calc - fixed
   00/04/08/12/16/20 Europe/Berlin slots, not rolling 4h-since-last-claim).
   This is a reimplementation, not the real SQL - see CLAUDE.md Phase 7.2
   report for the fidelity trade-off this implies (drifts if the SQL
   changes and this file isn't updated to match).

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

const RPC_HANDLERS = {
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
