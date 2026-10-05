/* Nachbau der Event-Analyse-Funktionen (Admin-Panel "📊 Events") fuer die lokale
   Testumgebung - das JS-Gegenstueck zu sql/20261005-event-admin-stats.sql.

     admin_event_list / admin_event_overview / admin_event_quests /
     admin_event_timeline / admin_event_players / admin_event_player_detail

   WICHTIG zur Vertrauenswuerdigkeit: Postgres ist im Browser-Test nicht
   verfuegbar, deshalb rechnet dieser Nachbau dasselbe nochmal in JS. Dass er
   dem ECHTEN SQL entspricht, beweist tests/e2e/event-admin-sql.spec.js: dort
   laufen beide mit denselben Daten und die Ergebnisse muessen identisch sein.
   Wer die SQL aendert, muss diese Datei mitziehen - sonst wird dieser Test rot.

   Rechtepruefung wie is_active_admin(): aktives admin_profiles-Konto mit der
   Rolle admin/editor (Anmelde-E-Mail = login_name). Mitarbeiter-/Schaf-Konten,
   normale Spieler und ausgeloggte Nutzer bekommen 'not_admin'. */
const { table: getTable } = require('./store');
const rules = require('../../js/systems/bkmp-event-rules.js');

function rpcError(message) { const e = new Error(message); e.isRpcError = true; return e; }

function berlinDay(ms) { return rules.bkmpEventBerlinDayKey(ms); }
function berlinDayOfIso(isoText) { return isoText ? berlinDay(Date.parse(isoText)) : null; }
function dayDiff(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5); }
function addDays(dayKey, n) { return new Date(Date.parse(dayKey + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function round2(x) { return x == null || !Number.isFinite(x) ? null : Math.round((x + Number.EPSILON) * 100) / 100; }

function isAdmin(store, uid) {
  if (!uid) return false;
  const user = [...store.authUsersByEmail.values()].find(u => u.id === uid);
  if (!user) return false;
  return getTable(store, 'admin_profiles').some(p => p.login_name === user.email && p.active !== false
    && ['admin', 'editor'].includes(p.role == null ? 'admin' : p.role));
}
function requireAdmin(store, uid) { if (!isAdmin(store, uid)) throw rpcError('not_admin'); }

function findEvent(store, id) {
  const ev = getTable(store, 'special_events').find(e => e.id === id);
  if (!ev) throw rpcError('invalid_event');
  return ev;
}
function progressOf(store, eventId) { return getTable(store, 'player_event_progress').filter(p => p.event_id === eventId); }
function logOf(store, eventId) { return getTable(store, 'event_player_day_log').filter(l => l.event_id === eventId); }
function nowMs(store) { return store.clock.nowMs(); }
function tierOf(points, ev) { return Math.min(ev.tier_count, Math.floor(Number(points || 0) / ev.points_per_tier)); }
function arr(v) { return Array.isArray(v) ? v : []; }
function lastTickIso(p) {
  if (p.last_tick_at) return p.last_tick_at;
  return p.last_tick_at_ms ? new Date(Number(p.last_tick_at_ms)).toISOString() : null;
}
function doneCount(quests) { return arr(quests).filter(q => q && q.done === true).length; }
/* percentile_cont(0.5) */
function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const pos = (n - 1) * 0.5, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
/* Alle (Spieler, Tag)-Zeilen: Protokoll + laufender aktueller Tag (jede genau einmal). */
function dayRows(store, eventId) {
  const out = logOf(store, eventId).map(l => ({ uid: l.auth_user_id, day: l.day_key, quests: l.quests, closure: !!l.closure_done, points: Number(l.points_end || 0) }));
  progressOf(store, eventId).forEach(p => {
    if (p.day_key) out.push({ uid: p.auth_user_id, day: p.day_key, quests: p.day_quests, closure: !!p.day_closure_done, points: Number(p.points || 0) });
  });
  return out;
}

const HANDLERS = {
  admin_event_list(store, uid) {
    requireAdmin(store, uid);
    const now = nowMs(store);
    const list = getTable(store, 'special_events').map(ev => {
      const rows = progressOf(store, ev.id);
      const active = rows.filter(p => Number(p.points) > 0);
      const tiers = active.map(p => tierOf(p.points, ev));
      return {
        _sort: ev.starts_at ? Date.parse(ev.starts_at) : null,
        obj: {
          id: ev.id, name: ev.name, subtitle: ev.subtitle || '', status: rules.bkmpEventStatus(ev, now),
          enabled: !!ev.enabled, archived: !!ev.archived,
          announce_at: ev.announce_at || null, starts_at: ev.starts_at || null, ends_at: ev.ends_at || null,
          tier_count: ev.tier_count, points_per_tier: ev.points_per_tier,
          started: rows.length, active: active.length,
          avg_tier: tiers.length ? round2(tiers.reduce((a, b) => a + b, 0) / tiers.length) : null,
          completed: rows.filter(p => Math.floor(Number(p.points || 0) / ev.points_per_tier) >= ev.tier_count).length
        }
      };
    });
    list.sort((a, b) => {
      if (a._sort == null && b._sort != null) return 1;
      if (b._sort == null && a._sort != null) return -1;
      if (a._sort !== b._sort) return b._sort - a._sort;
      return a.obj.name < b.obj.name ? -1 : a.obj.name > b.obj.name ? 1 : 0;
    });
    return list.map(x => x.obj);
  },

  admin_event_overview(store, uid, params) {
    requireAdmin(store, uid);
    const ev = findEvent(store, params.p_event_id);
    const now = nowMs(store);
    const status = rules.bkmpEventStatus(ev, now);
    const today = berlinDay(now);
    const tc = ev.tier_count, ppt = ev.points_per_tier;
    const cfg = ev.config || {};
    const rows = progressOf(store, ev.id);
    const withTier = rows.map(p => ({ p, points: Number(p.points || 0), tier: tierOf(p.points, ev) }));
    const active = withTier.filter(r => r.points > 0);
    const activeTiers = active.map(r => r.tier).sort((a, b) => a - b);

    const kpis = {
      started: rows.length,
      active: active.length,
      avg_tier: activeTiers.length ? round2(activeTiers.reduce((a, b) => a + b, 0) / activeTiers.length) : null,
      median_tier: median(activeTiers),
      completed: withTier.filter(r => r.tier >= tc).length,
      max_tier: withTier.reduce((m, r) => Math.max(m, r.tier), 0),
      total_points: withTier.reduce((s, r) => s + r.points, 0),
      active_today: status === 'LIVE' ? rows.filter(p => p.day_key === today).length : null
    };

    const counts = new Array(tc + 1).fill(0);
    active.forEach(r => { counts[r.tier] += 1; });
    const histogram = counts.map((count, tier) => ({ tier, count }));

    const claimedCount = {};
    rows.forEach(p => arr(p.tier_claimed).forEach(t => { claimedCount[t] = (claimedCount[t] || 0) + 1; }));
    const tiers = [];
    for (let t = 1; t <= tc; t++) {
      tiers.push({ tier: t, reached: active.filter(r => r.tier >= t).length, claimed: claimedCount[t] || 0 });
    }

    let choice = { enabled: false };
    const species = arr(ev.reward_species);
    if (ev.choice_mode === 'player_choice' && species.length > 0) {
      const speciesTable = getTable(store, 'dragon_species');
      choice = {
        enabled: true,
        species: species.map(id => ({
          id, name: (speciesTable.find(s => s.id === id) || {}).name || null,
          count: rows.filter(p => p.choice_species === id).length
        })),
        earned: rows.filter(p => p.earned).length,
        open: rows.filter(p => p.earned && !p.choice_species).length
      };
    }

    let max = null;
    if (ev.starts_at && ev.ends_at) {
      const days = Math.max(1, dayDiff(berlinDay(Date.parse(ev.starts_at)), berlinDay(Date.parse(ev.ends_at))) + 1);
      let daily = 0, weekly = 0;
      if (cfg.daily && typeof cfg.daily === 'object' && !Array.isArray(cfg.daily)) {
        const normalN = Math.min(cfg.daily.normal_count != null ? Number(cfg.daily.normal_count) : 4, arr(cfg.daily.normal).length);
        const hardN = arr(cfg.daily.hard).length > 0 ? 1 : 0;
        const closure = cfg.daily.closure || {};
        daily = normalN * (cfg.daily.normal_points != null ? Number(cfg.daily.normal_points) : 40)
          + hardN * (cfg.daily.hard_points != null ? Number(cfg.daily.hard_points) : 90)
          + (normalN + hardN >= (closure.need != null ? Number(closure.need) : 4) ? (closure.points != null ? Number(closure.points) : 100) : 0);
      }
      arr(cfg.weekly).forEach(q => arr(q.stages).forEach(s => { weekly += Number(s[1]); }));
      max = days * daily + weekly;
    }

    return {
      event: {
        id: ev.id, name: ev.name, subtitle: ev.subtitle || '', status,
        enabled: !!ev.enabled, archived: !!ev.archived,
        announce_at: ev.announce_at || null, starts_at: ev.starts_at || null, ends_at: ev.ends_at || null,
        timezone: ev.timezone, tier_count: tc, points_per_tier: ppt,
        points_to_finish: tc * ppt, theoretical_max_points: max,
        remaining_seconds: status === 'LIVE' ? Math.floor((Date.parse(ev.ends_at) - now) / 1000) : null,
        choice_mode: ev.choice_mode, reward_species: species,
        tier_rewards: arr(cfg.tiers), choices: cfg.choices || {}
      },
      kpis, histogram, tiers, choice,
      berlin_today: today, server_now: new Date(now).toISOString()
    };
  },

  admin_event_quests(store, uid, params) {
    requireAdmin(store, uid);
    const ev = findEvent(store, params.p_event_id);
    const today = berlinDay(nowMs(store));
    const cfg = ev.config || {};
    const rows = dayRows(store, ev.id);

    const byQuest = new Map();
    rows.forEach(r => arr(r.quests).forEach(q => {
      const kind = q.kind || 'normal';
      const key = kind + '\u0000' + q.id;
      if (!byQuest.has(key)) byQuest.set(key, { id: q.id, kind, assigned: 0, completed: 0, today_assigned: 0, today_completed: 0 });
      const s = byQuest.get(key);
      const done = q.done === true;
      s.assigned += 1;
      if (done) s.completed += 1;
      if (r.day === today) { s.today_assigned += 1; if (done) s.today_completed += 1; }
    }));
    const daily = [...byQuest.values()].sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

    const closure = { assigned: rows.length, completed: rows.filter(r => r.closure).length };

    const weeklyMap = new Map();
    progressOf(store, ev.id).forEach(p => arr(p.weekly_quests).forEach(q => {
      const stageCount = arr(q.stages).length;
      const done = Number((p.weekly_done || {})[q.id] || 0);
      if (!weeklyMap.has(q.id)) weeklyMap.set(q.id, { id: q.id, players: 0, stage_count: 0, completed: 0, reached: [] });
      const w = weeklyMap.get(q.id);
      w.players += 1;
      w.stage_count = Math.max(w.stage_count, stageCount);
      if (stageCount > 0 && done >= stageCount) w.completed += 1;
      for (let s = 1; s <= stageCount; s++) w.reached[s - 1] = (w.reached[s - 1] || 0) + (done >= s ? 1 : 0);
    }));
    const weekly = [...weeklyMap.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map(w => ({ id: w.id, players: w.players, stage_count: w.stage_count, completed: w.completed, stages: Array.from({ length: w.stage_count }, (_, i) => w.reached[i] || 0) }));

    return {
      daily, closure, weekly,
      defs: {
        daily_normal: arr(cfg.daily && cfg.daily.normal), daily_hard: arr(cfg.daily && cfg.daily.hard),
        closure: (cfg.daily && cfg.daily.closure) || {},
        weekly: arr(cfg.weekly), weekly_alts: arr(cfg.weekly_alts)
      },
      berlin_today: today
    };
  },

  admin_event_timeline(store, uid, params) {
    requireAdmin(store, uid);
    const ev = findEvent(store, params.p_event_id);
    const now = nowMs(store);
    const today = berlinDay(now);
    const meta = getTable(store, 'event_admin_meta').find(m => m.key === 'stats_since');
    const since = meta && meta.set_at ? berlinDayOfIso(meta.set_at) : null;
    const progress = progressOf(store, ev.id);
    const unknown = progress.filter(p => !p.joined_day).length;
    let days = [];
    if (ev.starts_at && ev.ends_at) {
      const start = berlinDay(Date.parse(ev.starts_at));
      const endEv = berlinDay(Date.parse(ev.ends_at));
      const end = endEv < today ? endEv : today;
      if (end >= start) {
        const ppd = dayRows(store, ev.id);
        for (let day = start; day <= end; day = addDays(day, 1)) {
          // letzter bekannter Stand je Spieler bis einschliesslich "day"
          const latest = new Map();
          ppd.forEach(r => {
            if (r.day <= day) {
              const cur = latest.get(r.uid);
              if (!cur || r.day > cur.day) latest.set(r.uid, r);
            }
          });
          const asof = [...latest.values()];
          const withPoints = asof.filter(r => r.points > 0);
          const avg = withPoints.length
            ? withPoints.reduce((s, r) => s + Math.min(ev.tier_count, Math.floor(r.points / ev.points_per_tier)), 0) / withPoints.length : null;
          days.push({
            day,
            tracked: since != null && day >= since,
            active: new Set(ppd.filter(r => r.day === day).map(r => r.uid)).size,
            new_participants: progress.filter(p => p.joined_day === day).length,
            completed: progress.filter(p => p.earned_at && berlinDayOfIso(p.earned_at) === day).length,
            choices: progress.filter(p => p.chosen_at && berlinDayOfIso(p.chosen_at) === day).length,
            with_points: withPoints.length,
            total_points: asof.reduce((s, r) => s + r.points, 0),
            avg_tier: round2(avg)
          });
        }
      }
    }
    return { days, stats_since_day: since, unknown_join_count: unknown, berlin_today: today };
  },

  admin_event_players(store, uid, params) {
    requireAdmin(store, uid);
    const ev = findEvent(store, params.p_event_id);
    const today = berlinDay(nowMs(store));
    const q = String(params.p_search == null ? '' : params.p_search).trim().toLowerCase();
    const dir = String(params.p_dir || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const sortKey = ['name', 'tier', 'points', 'last', 'daily', 'weekly', 'claimed'].includes(String(params.p_sort || '').toLowerCase())
      ? String(params.p_sort).toLowerCase() : 'points';
    const limit = Math.max(1, Math.min(100, params.p_limit == null ? 25 : Number(params.p_limit)));
    const offset = Math.max(0, params.p_offset == null ? 0 : Number(params.p_offset));
    const stats = new Map(getTable(store, 'player_stats').map(s => [s.auth_user_id, s]));

    const dailyDone = new Map();
    dayRows(store, ev.id).forEach(r => dailyDone.set(r.uid, (dailyDone.get(r.uid) || 0) + doneCount(r.quests)));

    let base = progressOf(store, ev.id).map(p => {
      const ps = stats.get(p.auth_user_id);
      const wq = arr(p.weekly_quests);
      const isToday = p.day_key === today;
      const points = Number(p.points || 0);
      const claimed = arr(p.tier_claimed);
      return {
        auth_user_id: p.auth_user_id,
        name: (ps && ps.display_name) || p.name_key || 'Unbekannt',
        _nameKey: p.name_key || '', _display: (ps && ps.display_name) || '',
        points, tier: tierOf(points, ev),
        last_tick_at: lastTickIso(p), day_key: p.day_key || null, joined_day: p.joined_day || null,
        today_done: isToday ? doneCount(p.day_quests) : null,
        today_total: isToday ? arr(p.day_quests).length : null,
        daily_done: dailyDone.get(p.auth_user_id) || 0,
        weekly_done: wq.reduce((s, w) => s + Math.min(Number((p.weekly_done || {})[w.id] || 0), arr(w.stages).length), 0),
        weekly_total: wq.reduce((s, w) => s + arr(w.stages).length, 0),
        max_claimed: claimed.length ? Math.max(...claimed) : null,
        choice_species: p.choice_species || null,
        _earned: !!p.earned
      };
    });
    if (q) base = base.filter(b => b._display.toLowerCase().includes(q) || b._nameKey.toLowerCase().includes(q));
    const sign = dir === 'asc' ? 1 : -1;
    const lc = s => String(s).toLowerCase();
    const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    base.sort((a, b) => {
      let c = 0;
      if (sortKey === 'name') c = sign * cmpStr(lc(a.name), lc(b.name));
      else if (sortKey === 'tier') c = sign * (a.tier - b.tier);
      else if (sortKey === 'points') c = sign * (a.points - b.points);
      else if (sortKey === 'daily') c = sign * (a.daily_done - b.daily_done);
      else if (sortKey === 'weekly') c = sign * (a.weekly_done - b.weekly_done);
      else if (sortKey === 'last') {
        const av = a.last_tick_at ? Date.parse(a.last_tick_at) : null, bv = b.last_tick_at ? Date.parse(b.last_tick_at) : null;
        if (av == null && bv == null) c = 0; else if (av == null) c = 1; else if (bv == null) c = -1; else c = sign * (av - bv);
      } else if (sortKey === 'claimed') {
        const av = a.max_claimed, bv = b.max_claimed;
        if (av == null && bv == null) c = 0;
        else if (av == null) c = dir === 'asc' ? -1 : 1;     // asc nulls first, desc nulls last
        else if (bv == null) c = dir === 'asc' ? 1 : -1;
        else c = sign * (av - bv);
      }
      if (c) return c;
      c = cmpStr(lc(a.name), lc(b.name));
      return c || cmpStr(a.auth_user_id, b.auth_user_id);
    });
    const total = base.length;
    const rows = base.slice(offset, offset + limit).map(b => ({
      auth_user_id: b.auth_user_id, name: b.name, points: b.points, tier: b.tier,
      last_tick_at: b.last_tick_at, day_key: b.day_key, joined_day: b.joined_day,
      today_done: b.today_done, today_total: b.today_total,
      daily_done: b.daily_done, weekly_done: b.weekly_done, weekly_total: b.weekly_total,
      max_claimed: b.max_claimed, choice_species: b.choice_species,
      status: b.tier >= ev.tier_count ? 'completed' : b.points <= 0 ? 'started' : b.day_key === today ? 'active_today' : 'inactive'
    }));
    return { total, rows };
  },

  admin_event_player_detail(store, uid, params) {
    requireAdmin(store, uid);
    const ev = findEvent(store, params.p_event_id);
    const today = berlinDay(nowMs(store));
    const p = progressOf(store, ev.id).find(r => r.auth_user_id === params.p_auth_user_id);
    if (!p) return { found: false };
    const ps = getTable(store, 'player_stats').find(s => s.auth_user_id === p.auth_user_id);
    const history = logOf(store, ev.id).filter(l => l.auth_user_id === p.auth_user_id)
      .sort((a, b) => (a.day_key < b.day_key ? -1 : a.day_key > b.day_key ? 1 : 0))
      .map(l => ({ day: l.day_key, points_end: Number(l.points_end || 0), closure_done: !!l.closure_done, total: arr(l.quests).length, done: doneCount(l.quests) }));
    return {
      found: true,
      name: (ps && ps.display_name) || p.name_key || 'Unbekannt',
      points: Number(p.points || 0), tier: tierOf(p.points, ev),
      tier_count: ev.tier_count, points_per_tier: ev.points_per_tier,
      tier_claimed: arr(p.tier_claimed),
      earned: !!p.earned, earned_at: p.earned_at || null,
      choice_species: p.choice_species || null, chosen_at: p.chosen_at || null,
      joined_day: p.joined_day || null, last_tick_at: lastTickIso(p),
      day_key: p.day_key || null, is_today: p.day_key === today,
      day_closure_done: !!p.day_closure_done,
      cumulative: p.cumulative || {}, day_base: p.day_base || {},
      day_quests: arr(p.day_quests), weekly_quests: arr(p.weekly_quests), weekly_done: p.weekly_done || {},
      history
    };
  }
};

module.exports = { ADMIN_EVENT_HANDLERS: HANDLERS, isAdmin };
