/* ============================================================
   Special-Event-Regeln (Drachendorf-Ausbau Phase 7/8, 04.10.2026)

   Reine Rechenfunktionen ohne DOM/Netzwerk - genutzt von:
     * dem Spiel (Anzeige: Status, Stufe, Fortschritt, Aufgabentexte)
     * der lokalen Testumgebung (tests/mock/rpc-engine.js spiegelt damit
       event_tick/event_claim_tiers aus sql/20261004-06-special-events.sql)
     * der Balance-Simulation des Zwielicht-Passes
   Massgeblich bleibt IMMER die Datenbank - diese Datei rechnet exakt
   dieselben Regeln nach (Abweichungen faengt tests/e2e/special-event.spec.js).
   ============================================================ */

const BKMP_EVENT_SERVER_METRICS = ['kills', 'bosses', 'active', 'runes', 'dungeons', 'expeditions', 'guild'];
const BKMP_EVENT_CLIENT_METRICS = ['tower', 'feedings', 'world_events'];

/* Anzeige je Kennzahl: Text fuer "Ziel N" (Tages-/Wochenaufgaben). */
const BKMP_EVENT_METRIC_META = {
  kills: { icon: '⚔️', unit: n => `Besiege ${bkmpEventFmt(n)} Drachen` },
  bosses: { icon: '👑', unit: n => `Besiege ${bkmpEventFmt(n)} Bosse oder Minibosse` },
  active: { icon: '🕒', unit: n => `Sammle ${bkmpEventDuration(n)} echte Kampfzeit` },
  runes: { icon: '🔮', unit: n => `Werte ${bkmpEventFmt(n)}× Runen auf` },
  dungeons: { icon: '🏛️', unit: n => `Schließe ${bkmpEventFmt(n)} Dungeons ab` },
  expeditions: { icon: '🧭', unit: n => `Schließe ${bkmpEventFmt(n)} Expedition${n === 1 ? '' : 'en'} ab` },
  guild: { icon: '🛡️', unit: n => `Trage ${bkmpEventFmt(n)} Punkte zum Gildenprojekt bei` },
  tower: { icon: '🗼', unit: n => `Bewältige ${bkmpEventFmt(n)} Turmstufen` },
  feedings: { icon: '🐲', unit: n => `Füttere ${bkmpEventFmt(n)}× Babydrachen` },
  world_events: { icon: '✨', unit: n => `Erlebe ${bkmpEventFmt(n)} Weltereignis${n === 1 ? '' : 'se'} im Kampf` }
};

function bkmpEventFmt(n) {
  const v = Math.floor(Number(n) || 0);
  return v.toLocaleString('de-DE');
}
function bkmpEventDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h && m) return `${h} Std. ${m} Min.`;
  if (h) return `${h} Std.`;
  return `${m} Min.`;
}

/* Status wie special_event_status_of() in der SQL. Zeiten als ms. */
function bkmpEventStatus(ev, nowMs) {
  if (!ev || !ev.enabled) return 'HIDDEN';
  const starts = Date.parse(ev.starts_at || '');
  const ends = Date.parse(ev.ends_at || '');
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return 'HIDDEN';
  if (ev.archived) return 'ARCHIVED';
  const announce = Number.isFinite(Date.parse(ev.announce_at || '')) ? Date.parse(ev.announce_at) : starts;
  if (nowMs < announce) return 'HIDDEN';
  if (nowMs < starts) return 'COMING_SOON';
  if (nowMs < ends) return 'LIVE';
  return 'ENDED';
}

/* Berliner Kalendertag "YYYY-MM-DD" (Tagesreset 00:00 Europe/Berlin). */
function bkmpEventBerlinDayKey(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms));
  const get = t => (parts.find(p => p.type === t) || {}).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
/* Naechste Berliner Mitternacht nach ms (fuer "neue Aufgaben in ..."). */
function bkmpEventNextBerlinMidnight(ms) {
  const today = bkmpEventBerlinDayKey(ms);
  let lo = ms, hi = ms + 26 * 3600 * 1000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (bkmpEventBerlinDayKey(mid) === today) lo = mid; else hi = mid;
  }
  /* Mitternacht liegt immer auf einer vollen Minute: exakt zuruecklaufen. */
  return Math.floor(hi / 60000) * 60000;
}

function bkmpEventTierFromPoints(points, perTier, tierCount) {
  return Math.min(Number(tierCount) || 30, Math.floor(Math.max(0, Number(points) || 0) / Math.max(1, Number(perTier) || 100)));
}
function bkmpEventTierProgress(points, perTier, tierCount) {
  const per = Math.max(1, Number(perTier) || 100);
  const count = Number(tierCount) || 30;
  const tier = bkmpEventTierFromPoints(points, per, count);
  const into = tier >= count ? per : Math.max(0, Number(points) || 0) - tier * per;
  return { tier, into, need: per, maxed: tier >= count };
}

function bkmpEventScaledTarget(q, scale) {
  const base = Number(q.target) || 0;
  const s = q.scale === true || q.scale === 'true' ? Number(scale) || 1 : 1;
  // SQL: greatest(1, round(x)) - round() rundet .5 vom Nullpunkt weg.
  return Math.max(1, Math.round(base * s));
}

/* Tagesaufgaben wie event_generate_day(). seedInt(text) -> 0..2^31-1
   (md5, identisch zu village_seed_int), reqOk(req) -> bool. */
function bkmpEventGenerateDay(eventId, config, uid, dayKey, scale, seedInt, reqOk) {
  const cfg = (config && config.daily) || {};
  const out = [];
  let pool = (cfg.normal || []).filter(q => reqOk(q.requires || ''));
  const n = Math.min(Number(cfg.normal_count) || 4, pool.length);
  for (let i = 0; i < n; i++) {
    const pick = seedInt(`${eventId}:${uid}:${dayKey}:n${i}`) % pool.length;
    const q = pool[pick];
    out.push({ id: q.id, metric: q.metric, kind: 'normal', target: bkmpEventScaledTarget(q, scale), points: Number(cfg.normal_points) || 40, done: false });
    pool = pool.filter((_, j) => j !== pick);
  }
  const hard = (cfg.hard || []).filter(q => reqOk(q.requires || ''));
  if (hard.length) {
    const q = hard[seedInt(`${eventId}:${uid}:${dayKey}:h`) % hard.length];
    out.push({ id: q.id, metric: q.metric, kind: 'hard', target: bkmpEventScaledTarget(q, scale), points: Number(cfg.hard_points) || 90, done: false });
  }
  return out;
}

/* Wochenquests wie event_generate_week(). */
function bkmpEventGenerateWeek(config, scale, reqOk) {
  const alts = (config && config.weekly_alts) || [];
  const out = [];
  ((config && config.weekly) || []).forEach(q0 => {
    let q = q0;
    if (!reqOk(q.requires || '')) {
      q = alts.find(a => a.id === q0.alt);
      if (!q) return;
    }
    out.push({
      id: q.id, metric: q.metric,
      stages: (q.stages || []).map(s => [bkmpEventScaledTarget({ target: s[0], scale: q.scale }, scale), Number(s[1]) || 0])
    });
  });
  return out;
}

function bkmpEventMetricCap(metric, elapsed) {
  const e = Math.max(0, Number(elapsed) || 0);
  switch (metric) {
    case 'kills': return Math.floor(e * 3);
    case 'bosses': return Math.floor(e / 20) + 1;
    case 'active': return Math.floor(e);
    case 'runes': return Math.floor(e / 2) + 1;
    case 'dungeons': return Math.floor(e / 30) + 1;
    case 'expeditions': return 3;
    case 'guild': return 100000;
    case 'tower': return Math.floor(e / 3) + 1;
    case 'feedings': return Math.floor(e / 3) + 1;
    case 'world_events': return Math.floor(e / 120) + 1;
    default: return 0;
  }
}
function bkmpEventClientDayCap(metric) {
  return metric === 'tower' ? 130 : metric === 'feedings' ? 80 : metric === 'world_events' ? 30 : 0;
}

/* Kern von event_tick() fuer einen LIVE-Aufruf. row wird kopiert und
   aktualisiert zurueckgegeben (+ accepted). Alle Zeitangaben in Sekunden. */
function bkmpEventApplyTick(rowIn, opts) {
  const row = JSON.parse(JSON.stringify(rowIn));
  const { config, nowMetrics, client, elapsedSec, dayKey, tierCount, perTier, genDay } = opts;
  const elapsed = Math.min(600, Math.max(0, Number(elapsedSec) || 0));
  const last = row.last_metrics || {};
  const prevCum = { ...(row.cumulative || {}) };
  const cum = { ...prevCum };
  const nowA = Number(nowMetrics.active || 0);
  const activeDelta = Math.max(0, Math.min(nowA - (last.active != null ? Number(last.active) : nowA), bkmpEventMetricCap('active', elapsed)));
  Object.keys(nowMetrics).forEach(key => {
    const now = Number(nowMetrics[key] || 0);
    let delta = now - (last[key] != null ? Number(last[key]) : now);
    delta = Math.max(0, Math.min(delta, bkmpEventMetricCap(key, elapsed)));
    if (key === 'active') delta = activeDelta;
    if (key === 'kills') delta = Math.min(delta, Math.floor(activeDelta * 3));
    if (key === 'bosses') delta = Math.min(delta, Math.floor(activeDelta / 20) + (activeDelta > 0 ? 1 : 0));
    cum[key] = Number(cum[key] || 0) + delta;
  });
  if (row.day_key !== dayKey) {
    row.day_key = dayKey;
    row.day_base = prevCum;
    row.day_quests = genDay();
    row.day_closure_done = false;
    row.day_client = {};
  }
  const dayClient = { ...(row.day_client || {}) };
  const accepted = {};
  BKMP_EVENT_CLIENT_METRICS.forEach(key => {
    const used = Number(dayClient[key] || 0);
    const delta = Math.max(0, Math.min(Math.floor(Number((client || {})[key]) || 0), bkmpEventMetricCap(key, elapsed), bkmpEventClientDayCap(key) - used));
    accepted[key] = delta;
    dayClient[key] = used + delta;
    cum[key] = Number(cum[key] || 0) + delta;
  });
  let points = Number(row.points || 0);
  const base = row.day_base || {};
  let doneCount = 0;
  row.day_quests = (row.day_quests || []).map(q => {
    const nq = { ...q };
    if (!nq.done && Number(cum[nq.metric] || 0) - Number(base[nq.metric] || 0) >= Number(nq.target)) {
      nq.done = true;
      points += Number(nq.points) || 0;
    }
    if (nq.done) doneCount++;
    return nq;
  });
  const closure = (config.daily && config.daily.closure) || {};
  if (!row.day_closure_done && doneCount >= (Number(closure.need) || 4)) {
    row.day_closure_done = true;
    points += Number(closure.points) || 100;
  }
  const week = { ...(row.weekly_done || {}) };
  (row.weekly_quests || []).forEach(q => {
    let done = Number(week[q.id] || 0);
    while (done < q.stages.length && Number(cum[q.metric] || 0) >= Number(q.stages[done][0])) {
      points += Number(q.stages[done][1]) || 0;
      done++;
    }
    week[q.id] = done;
  });
  const tier = bkmpEventTierFromPoints(points, perTier, tierCount);
  row.points = points;
  row.cumulative = cum;
  row.last_metrics = { ...nowMetrics };
  row.day_client = dayClient;
  row.weekly_done = week;
  if (!row.earned && tier >= tierCount) { row.earned = true; row.earned_at_pending = true; }
  return { row, accepted };
}

/* Belohnung einer Stufe aus der Konfiguration. */
function bkmpEventTierReward(config, tier) {
  const t = ((config && config.tiers) || []).find(x => Number(x.tier) === Number(tier));
  return t ? t.reward || null : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BKMP_EVENT_SERVER_METRICS, BKMP_EVENT_CLIENT_METRICS, BKMP_EVENT_METRIC_META,
    bkmpEventStatus, bkmpEventBerlinDayKey, bkmpEventNextBerlinMidnight,
    bkmpEventTierFromPoints, bkmpEventTierProgress, bkmpEventScaledTarget,
    bkmpEventGenerateDay, bkmpEventGenerateWeek, bkmpEventMetricCap, bkmpEventClientDayCap,
    bkmpEventApplyTick, bkmpEventTierReward, bkmpEventFmt, bkmpEventDuration
  };
}
