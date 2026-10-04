/* Drachendorf-Ausbau Phase 7-11 (04.10.2026): Nachbau der Event- und
   Erweckungs-RPCs fuer die lokale Testumgebung.
     sql/20261004-06-special-events.sql  (special_events_visible, event_tick,
                                          event_claim_tiers, event_choose_reward)
     sql/20261004-09-divine-awakening.sql (divine_status, divine_offer, divine_awaken)
     sql/20261004-01-drachendorf-grundlage.sql (bkmp_event_modifier)
   Die eigentliche Pass-Rechnung kommt aus js/systems/bkmp-event-rules.js
   (dasselbe Modul, das auch das Spiel nutzt), damit Mock und Anzeige nie
   auseinanderlaufen. */
const crypto = require('crypto');
const { table: getTable } = require('./store');
const rules = require('../../js/systems/bkmp-event-rules.js');
const expeditionRules = require('../../js/systems/bkmp-expedition-rules.js');

function rpcError(message) { const e = new Error(message); e.isRpcError = true; return e; }
function seedInt(text) { return parseInt(crypto.createHash('md5').update(String(text)).digest('hex').slice(0, 8), 16) & 0x7fffffff; }
function goldUnit(stage) { return Math.max(6, Math.round(6 * Math.pow(1 + 0.05 * Math.max(0, Number(stage) || 0), 1.2))); }
function nowIso(store) { return new Date(store.clock.nowMs()).toISOString(); }
function statusOf(store, ev) { return rules.bkmpEventStatus(ev, store.clock.nowMs()); }

/* bkmp_event_modifier(): Summe eines Bonus-Schluessels aller laufenden Events (0..100). */
function eventModifier(store, key) {
  const now = store.clock.nowMs();
  let sum = 0;
  getTable(store, 'special_events').forEach(e => {
    if (!e.enabled || e.archived || !e.starts_at || !e.ends_at) return;
    if (now < Date.parse(e.starts_at) || now >= Date.parse(e.ends_at)) return;
    const v = Number(e.config && e.config.modifiers && e.config.modifiers[key]);
    if (Number.isFinite(v)) sum += v;
  });
  return Math.max(0, Math.min(100, sum));
}

function serverMetrics(store, uid) {
  const st = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
  if (!st) return {};
  return {
    kills: Number(st.dragon_kills || 0),
    bosses: Number(st.boss_kills || 0),
    active: Math.floor(Number(st.playtime_seconds || 0)),
    runes: Number(st.rune_upgrade_successes || 0) + Number(st.rune_upgrade_failures || 0),
    dungeons: getTable(store, 'dungeon_progress').filter(r => r.auth_user_id === uid).reduce((a, r) => a + Number(r.total_keys_spent || 0), 0),
    expeditions: getTable(store, 'player_expeditions').filter(e => e.auth_user_id === uid && e.status === 'claimed').length,
    guild: getTable(store, 'guild_project_contributions').filter(c => c.auth_user_id === uid).reduce((a, c) => a + Number(c.points || 0), 0)
  };
}
function berlinDay(ms) { return rules.bkmpEventBerlinDayKey(ms); }
function weekStartOf(ms) {
  const day = berlinDay(ms);
  const d = new Date(day + 'T00:00:00Z');
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}
function requirementOk(store, uid, req) {
  if (!req) return true;
  const st = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
  if (req === 'runes') return !!st && getTable(store, 'idle_player_runes').some(r => r.name_key === st.name_key);
  if (req === 'harbor') {
    const vb = getTable(store, 'village_buildings').find(b => b.auth_user_id === uid && b.building_id === 'drachenhafen');
    return !!vb && Number(vb.level) >= 1 && getTable(store, 'player_dragons').some(d => d.auth_user_id === uid && (d.stage === 'adult' || d.stage === 'divine'));
  }
  if (req === 'guild') {
    const m = getTable(store, 'guild_members').find(x => x.auth_user_id === uid);
    if (!m) return false;
    const week = weekStartOf(store.clock.nowMs());
    return !getTable(store, 'guild_projects').some(p => p.guild_id === m.guild_id && p.week_start === week && p.completed_at);
  }
  if (req === 'babies') return getTable(store, 'player_dragons').some(d => d.auth_user_id === uid && d.stage === 'baby');
  return false;
}
function claimedGroup(store, uid, ev) {
  const group = ev.reward_group || ev.id;
  return getTable(store, 'player_event_reward_claims').some(c => c.reward_group === group && c.auth_user_id === uid);
}
function progressJson(store, uid, ev, row, status, accepted) {
  return {
    status, joined: true,
    points: row.points,
    tier: rules.bkmpEventTierFromPoints(row.points, ev.points_per_tier, ev.tier_count),
    cumulative: row.cumulative, kill_scale: row.kill_scale,
    day_key: row.day_key, day_base: row.day_base, day_quests: row.day_quests, day_closure_done: row.day_closure_done,
    weekly_quests: row.weekly_quests, weekly_done: row.weekly_done,
    tier_claimed: row.tier_claimed, unlocks: row.unlocks,
    earned: row.earned, earned_at: row.earned_at || null,
    choice_species: row.choice_species || null, chosen_at: row.chosen_at || null,
    already_claimed_group: claimedGroup(store, uid, ev),
    client_accepted: accepted || {},
    server_now: nowIso(store)
  };
}

const EVENT_HANDLERS = {
  special_events_visible(store) {
    const now = store.clock.nowMs();
    return getTable(store, 'special_events')
      .filter(e => rules.bkmpEventStatus(e, now) !== 'HIDDEN')
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .map(e => ({
        id: e.id, name: e.name, subtitle: e.subtitle, description: e.description, lore: e.lore,
        announce_at: e.announce_at, starts_at: e.starts_at, ends_at: e.ends_at, timezone: e.timezone,
        status: rules.bkmpEventStatus(e, now), tier_count: e.tier_count, points_per_tier: e.points_per_tier,
        config: e.config, reward_group: e.reward_group || e.id, reward_species: e.reward_species || [], assets: e.assets || {},
        lifetime_claim_limit: e.lifetime_claim_limit, choice_mode: e.choice_mode, server_now: new Date(now).toISOString()
      }));
  },

  event_tick(store, uid, params) {
    if (!uid) throw rpcError('not_authenticated');
    const ev = getTable(store, 'special_events').find(e => e.id === params.p_event_id);
    if (!ev) throw rpcError('invalid_event');
    const status = statusOf(store, ev);
    if (status === 'HIDDEN') throw rpcError('invalid_event');
    const rows = getTable(store, 'player_event_progress');
    let row = rows.find(r => r.event_id === ev.id && r.auth_user_id === uid);
    const now = store.clock.nowMs();
    if (!row) {
      if (status !== 'LIVE') return { status, joined: false, server_now: nowIso(store), already_claimed_group: claimedGroup(store, uid, ev) };
      const st = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
      if (!st) throw rpcError('no_player_state');
      const kph = Number(st.dragon_kills || 0) / Math.max(Number(st.playtime_seconds || 0) / 3600, 1);
      const scale = Math.max(0.6, Math.min(1.6, Math.round(kph / 3000 * 100) / 100));
      row = {
        event_id: ev.id, auth_user_id: uid, name_key: st.name_key, points: 0, cumulative: {},
        last_metrics: serverMetrics(store, uid), last_tick_at_ms: now, kill_scale: scale,
        day_key: null, day_base: {}, day_quests: [], day_closure_done: false, day_client: {},
        weekly_quests: rules.bkmpEventGenerateWeek(ev.config, scale, r => requirementOk(store, uid, r)),
        weekly_done: {}, tier_claimed: [], unlocks: [], earned: false, earned_at: null, choice_species: null, chosen_at: null
      };
      rows.push(row);
    }
    let accepted = {};
    if (status === 'LIVE') {
      const elapsed = Math.min(600, Math.max(0, (now - Number(row.last_tick_at_ms || now)) / 1000));
      const dayKey = berlinDay(now);
      const out = rules.bkmpEventApplyTick(row, {
        config: ev.config, nowMetrics: serverMetrics(store, uid), client: params.p_client || {},
        elapsedSec: elapsed, dayKey, tierCount: ev.tier_count, perTier: ev.points_per_tier,
        genDay: () => rules.bkmpEventGenerateDay(ev.id, ev.config, uid, dayKey, row.kill_scale, seedInt, r => requirementOk(store, uid, r))
      });
      const earnedNow = out.row.earned_at_pending;
      delete out.row.earned_at_pending;
      Object.assign(row, out.row, { last_tick_at_ms: now });
      if (earnedNow) row.earned_at = nowIso(store);
      accepted = out.accepted;
    }
    return progressJson(store, uid, ev, row, status, accepted);
  },

  event_claim_tiers(store, uid, params) {
    if (!uid) throw rpcError('not_authenticated');
    const ev = getTable(store, 'special_events').find(e => e.id === params.p_event_id);
    if (!ev || statusOf(store, ev) === 'HIDDEN') throw rpcError('invalid_event');
    const row = getTable(store, 'player_event_progress').find(r => r.event_id === ev.id && r.auth_user_id === uid);
    if (!row) throw rpcError('not_joined');
    const st = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
    if (!st) throw rpcError('no_player_state');
    const unit = goldUnit(st.highest_dragon_index);
    const tier = rules.bkmpEventTierFromPoints(row.points, ev.points_per_tier, ev.tier_count);
    const c = { gold: 0, wood: 0, stone: 0, crystals: 0, essence: 0, fruit: 0, meat: 0 };
    const items = [];
    const claimed = row.tier_claimed.slice();
    const unlocks = row.unlocks.slice();
    for (let t = 1; t <= tier; t++) {
      if (claimed.includes(t)) continue;
      claimed.push(t);
      const rw = rules.bkmpEventTierReward(ev.config, t);
      if (!rw) continue;
      c.gold += Math.round(Number(rw.gold_units || 0) * unit);
      ['wood', 'stone', 'crystals', 'essence', 'fruit', 'meat'].forEach(k => { c[k] += Number(rw[k] || 0); });
      if (rw.unlock && !unlocks.includes(rw.unlock)) unlocks.push(rw.unlock);
      items.push({ tier: t, reward: rw });
    }
    c.fruit = Math.max(0, Math.min(c.fruit, 2000 + Number(st.obstgarten_level || 0) * 500 - Number(st.fruit || 0)));
    c.meat = Math.max(0, Math.min(c.meat, 2000 + Number(st.jagdhuette_level || 0) * 500 - Number(st.meat || 0)));
    st.gold = Number(st.gold || 0) + c.gold;
    st.total_gold_earned = Number(st.total_gold_earned || 0) + c.gold;
    ['wood', 'stone', 'crystals', 'essence', 'fruit', 'meat'].forEach(k => { st[k] = Number(st[k] || 0) + c[k]; });
    row.tier_claimed = claimed;
    row.unlocks = unlocks;
    return { items, unlocks, credited: c };
  },

  event_choose_reward(store, uid, params) {
    if (!uid) throw rpcError('not_authenticated');
    const ev = getTable(store, 'special_events').find(e => e.id === params.p_event_id);
    if (!ev || statusOf(store, ev) === 'HIDDEN') throw rpcError('invalid_event');
    const species = params.p_species_id;
    if (ev.choice_mode !== 'player_choice' || !(ev.reward_species || []).includes(species)) throw rpcError('invalid_choice');
    const row = getTable(store, 'player_event_progress').find(r => r.event_id === ev.id && r.auth_user_id === uid);
    if (!row || !row.earned) throw rpcError('not_earned');
    if (row.choice_species) throw rpcError('already_chosen');
    const group = ev.reward_group || ev.id;
    const claims = getTable(store, 'player_event_reward_claims').filter(c => c.reward_group === group && c.auth_user_id === uid).length;
    if (claims >= Number(ev.lifetime_claim_limit)) throw rpcError('claim_limit_reached');
    const st = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
    if (!st) throw rpcError('no_player_state');
    if (!getTable(store, 'dragon_species').some(s => s.id === species)) throw rpcError('invalid_choice');
    const eggId = crypto.randomUUID();
    getTable(store, 'player_dragon_eggs').push({ id: eggId, name_key: st.name_key, auth_user_id: uid, species_id: species, created_at: nowIso(store) });
    getTable(store, 'player_event_reward_claims').push({ reward_group: group, auth_user_id: uid, event_id: ev.id, species_id: species, egg_id: eggId, claimed_at: nowIso(store) });
    row.choice_species = species;
    row.chosen_at = nowIso(store);
    return { species_id: species, egg_id: eggId };
  },

  /* ---------- Goettliche Erweckung ---------- */
  divine_status(store, uid, params) {
    if (!uid) throw rpcError('not_authenticated');
    const d = getTable(store, 'player_dragons').find(x => x.id === params.p_dragon_id && x.auth_user_id === uid);
    if (!d) throw rpcError('dragon_not_found');
    const sp = getTable(store, 'dragon_species').find(s => s.id === d.species_id) || {};
    const cfg = sp.divine_config;
    if (Number(sp.stage_count || 4) < 5 || !cfg) return { eligible_species: false };
    const st = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid) || {};
    return {
      eligible_species: true, stage: d.stage, divine: d.stage === 'divine',
      bond_level: expeditionRules.bkmpDragonBondLevel(d.bond_xp || 0), need_bond: Number(cfg.bond_level || 5),
      companion_seconds: Number(d.companion_seconds || 0), need_seconds: Math.round(Number(cfg.companion_hours || 10) * 3600),
      boss_kills: Number(d.companion_boss_kills || 0), need_boss_kills: Number(cfg.companion_boss_kills || 50),
      expeditions: Number(d.expeditions_completed || 0), need_expeditions: Number(cfg.expeditions || 10),
      offering_units: Number(d.divine_offering_units || 0), offering_gold: Number(d.divine_offering_gold || 0),
      need_units: Number(cfg.offering_gold_units || 600000), gold_unit: goldUnit(st.highest_dragon_index),
      need_crystals: Number(cfg.crystals || 0), need_essence: Number(cfg.essence || 0),
      stat_multiplier: Number(cfg.stat_multiplier || 1.25), divine_multiplier: Number(d.divine_multiplier || 1), awakened_at: d.awakened_at || null
    };
  },
  divine_offer(store, uid, params) {
    if (!uid) throw rpcError('not_authenticated');
    const gold = Math.floor(Number(params.p_gold) || 0);
    if (gold <= 0) throw rpcError('amount_too_small');
    const st = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
    if (!st) throw rpcError('no_player_state');
    const d = getTable(store, 'player_dragons').find(x => x.id === params.p_dragon_id && x.auth_user_id === uid);
    if (!d) throw rpcError('dragon_not_found');
    const sp = getTable(store, 'dragon_species').find(s => s.id === d.species_id) || {};
    if (Number(sp.stage_count || 4) < 5 || !sp.divine_config) throw rpcError('not_divine_species');
    if (d.stage === 'divine') throw rpcError('already_divine');
    if (d.stage !== 'adult') throw rpcError('not_adult');
    const unit = goldUnit(st.highest_dragon_index);
    const need = Number(sp.divine_config.offering_gold_units || 600000);
    const have = Number(d.divine_offering_units || 0);
    const remaining = need - have;
    if (remaining <= 0) throw rpcError('offering_complete');
    const spend = Math.min(gold, Math.ceil(remaining * unit), Math.floor(Number(st.gold || 0)));
    if (spend < unit) throw rpcError('amount_too_small');
    const units = Math.min(remaining, spend / unit);
    st.gold = Number(st.gold || 0) - spend;
    d.divine_offering_units = have + units;
    d.divine_offering_gold = Number(d.divine_offering_gold || 0) + spend;
    return { spent: spend, units: d.divine_offering_units, need_units: need, complete: d.divine_offering_units >= need, gold_unit: unit };
  },
  divine_awaken(store, uid, params) {
    if (!uid) throw rpcError('not_authenticated');
    const st = getTable(store, 'idle_player_state').find(r => r.auth_user_id === uid);
    if (!st) throw rpcError('no_player_state');
    const d = getTable(store, 'player_dragons').find(x => x.id === params.p_dragon_id && x.auth_user_id === uid);
    if (!d) throw rpcError('dragon_not_found');
    const sp = getTable(store, 'dragon_species').find(s => s.id === d.species_id) || {};
    const cfg = sp.divine_config;
    if (Number(sp.stage_count || 4) < 5 || !cfg) throw rpcError('not_divine_species');
    if (d.stage === 'divine') throw rpcError('already_divine');
    if (d.stage !== 'adult') throw rpcError('not_adult');
    if (getTable(store, 'player_expeditions').some(e => e.status === 'running' && (e.dragon_ids || []).includes(d.id))) throw rpcError('dragon_on_expedition');
    if (expeditionRules.bkmpDragonBondLevel(d.bond_xp || 0) < Number(cfg.bond_level || 5)) throw rpcError('bond_too_low');
    if (Number(d.companion_seconds || 0) < Math.round(Number(cfg.companion_hours || 10) * 3600)) throw rpcError('usage_too_low');
    if (Number(d.companion_boss_kills || 0) < Number(cfg.companion_boss_kills || 50)) throw rpcError('usage_too_low');
    if (Number(d.expeditions_completed || 0) < Number(cfg.expeditions || 10)) throw rpcError('usage_too_low');
    if (Number(d.divine_offering_units || 0) < Number(cfg.offering_gold_units || 600000)) throw rpcError('offering_incomplete');
    const crystals = Number(cfg.crystals || 0), essence = Number(cfg.essence || 0);
    if (Number(st.crystals || 0) < crystals || Number(st.essence || 0) < essence) throw rpcError('insufficient_resources');
    const mult = Math.max(1, Math.min(2, Number(cfg.stat_multiplier || 1.25)));
    st.crystals = Number(st.crystals) - crystals;
    st.essence = Number(st.essence) - essence;
    d.stage = 'divine';
    d.divine_multiplier = mult;
    d.awakened_at = nowIso(store);
    return { stage: 'divine', divine_multiplier: mult, crystals, essence, awakened_at: d.awakened_at };
  }
};

module.exports = { EVENT_HANDLERS, eventModifier, serverMetrics, seedInt };
