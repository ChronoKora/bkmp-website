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
    if (attacksToday >= 10) throw rpcError('daily_limit_reached');

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
       - leave_guild/kick_guild_member/set_guild_member_role/contribute_gold:
         sql/supabase-idle-guilds.sql (Basisversion ist hier bereits die
         einzige/aktuelle - keine spaetere Datei ersetzt sie)
     Bewusst NICHT portiert (siehe tests/FEATURE_MATRIX.md/CLAUDE.md): Einlade-
     Codes, Gilden-Chat, Gildenplatz-Kauf, Technologie-Baum, taegliche Quests,
     Gildenboss - eigener, groesserer Umfang, fuer eine spaetere Stufe. */
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

  set_guild_member_role(store, uid, params) {
    const targetUid = params.p_target_auth_user_id;
    const newRole = params.p_new_role;
    if (!['officer', 'member'].includes(newRole)) throw rpcError('invalid_role');
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
