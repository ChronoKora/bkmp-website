/* Testdaten fuer die Event-Analyse im Admin-Panel (05.10.2026).

   Szenarien (alle deterministisch, kein Zufall ausser einem festen Seed):
     * makeZwielichtScenario(now): handgemachte 10 Spieler mit EXAKT bekannten
       Erwartungswerten (jeder Test rechnet gegen diese Zahlen - nicht gegen die
       Ausgabe der Funktion selbst).
     * makeCustomEventScenario(now): ein ANDERES Event (12 Stufen, 250 Punkte je
       Stufe, eigene Quests, eigene Belohnungen, Auswahl zwischen DREI Arten) -
       beweist, dass nichts auf "zwielicht"/30 Stufen festgelegt ist.
     * makeBulkPlayers(n, eventId, now): n Spieler fuer den Leistungstest.

   Alle Szenarien sind RELATIV zu einem uebergebenen "jetzt" gebaut (Tag 3 des
   Events = Berliner Tag von "jetzt"): die SQL-Seite (PGlite) nutzt die echte
   Uhr von now(), der Browser-Test (Mock) eine feste. Beides ergibt dieselben
   Verhaeltnisse (Tag 1 = vorgestern, Tag 2 = gestern, Tag 3 = heute).

   Alle Zeilen haben die Spaltennamen der echten Tabelle player_event_progress
   (sql/20261004-06-special-events.sql), Zeitwerte als ISO-Text. Dieselben Zeilen
   gehen in Postgres (PGlite) UND in den JS-Nachbau (tests/mock/event-admin-engine.js). */
const { ZWIELICHT_CONFIG, makeZwielichtEventRow, berlinMidnightIso } = require('./event-reference');

const HOUR = 3600 * 1000;
const iso = ms => new Date(ms).toISOString();

function berlinDateStr(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
function addDays(dateStr, n) {
  return new Date(Date.parse(dateStr + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
}
/* Berliner Wanduhrzeit (z.B. 23:59) an einem Berliner Datum als ISO - Sommer-/Winterzeit korrekt. */
function berlinIso(dateStr, hhmm) {
  const base = Date.parse(dateStr + 'T' + hhmm + ':00Z');
  for (const off of [1, 2, 0, 3]) {
    const t = base - off * HOUR;
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t));
    const get = k => parts.find(x => x.type === k).value;
    if (get('year') + '-' + get('month') + '-' + get('day') === dateStr && get('hour') + ':' + get('minute') === hhmm) return new Date(t).toISOString();
  }
  throw new Error('Berliner Zeit nicht bestimmbar: ' + dateStr + ' ' + hhmm);
}

/* Festes "jetzt" fuer die Browser-Tests: Mi 07.10.2026 14:00 Berlin (Tag 3). */
const NOW_MS = Date.parse('2026-10-07T12:00:00Z');

function uid(n) { return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); }

/* Eine Tagesquest wie event_generate_day() sie erzeugt. */
function dq(id, metric, kind, target, points, done) {
  return { id, metric, kind, target, points, done: Boolean(done) };
}
/* Wochenquests wie event_generate_week() sie erzeugt (Stufen = [Ziel, Punkte]). */
const WEEK = {
  w_kills: { id: 'w_kills', metric: 'kills', stages: [[6000, 50], [15000, 60], [30000, 70]] },
  w_bosses: { id: 'w_bosses', metric: 'bosses', stages: [[60, 35], [180, 45], [400, 50]] },
  w_runes: { id: 'w_runes', metric: 'runes', stages: [[50, 35], [150, 45], [300, 50]] },
  w_world: { id: 'w_world', metric: 'world_events', stages: [[6, 35], [18, 45], [40, 50]] }
};

function progressRow(eventId, n, name, o) {
  const points = o.points || 0;
  return {
    event_id: eventId, auth_user_id: uid(n), name_key: name.toLowerCase(), points,
    cumulative: {}, last_metrics: {}, last_tick_at: o.last_tick_at || null, kill_scale: 1,
    day_key: o.day_key === undefined ? null : o.day_key, day_base: {}, day_quests: o.day_quests || [],
    day_closure_done: Boolean(o.closure), day_client: {},
    weekly_quests: o.weekly_quests || [], weekly_done: o.weekly_done || {},
    tier_claimed: o.claimed || [], unlocks: [],
    earned: Boolean(o.earned), earned_at: o.earned_at || null,
    choice_species: o.choice || null, chosen_at: o.chosen_at || null,
    joined_day: o.joined_day === undefined ? null : o.joined_day,
    updated_at: o.last_tick_at || undefined          // ohne Angabe: Tabellen-Default (jetzt)
  };
}
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
const NORMAL = (kills, bosses, active, dungeons) => [
  dq('d_kills', 'kills', 'normal', 1500, 40, kills), dq('d_bosses', 'bosses', 'normal', 15, 40, bosses),
  dq('d_active', 'active', 'normal', 2700, 40, active), dq('d_dungeons', 'dungeons', 'normal', 3, 40, dungeons)];

/* ---------- Szenario 1: Zwielicht, 10 Spieler ---------- */
function makeZwielichtScenario(nowMs) {
  nowMs = nowMs || NOW_MS;
  const d3 = berlinDateStr(nowMs), d2 = addDays(d3, -1), d1 = addDays(d3, -2);
  const startIso = berlinMidnightIso(d1);
  const endIso = new Date(Date.parse(berlinMidnightIso(addDays(d1, 7))) - 60 * 1000).toISOString();
  const event = makeZwielichtEventRow({
    enabled: true, announce_at: berlinMidnightIso(addDays(d1, -3)), starts_at: startIso, ends_at: endIso
  });
  const E = 'zwielicht';
  const live = iso(nowMs - 5 * 60 * 1000);                  // vor 5 Minuten
  const old = berlinIso(d2, '10:00');                       // gestern
  const players = [
    // Tag 3 aktiv, Stufe 30, alles abgeholt, Lightnix gewaehlt
    progressRow(E, 1, 'Alice', { points: 3000, earned: true, earned_at: berlinIso(d2, '20:30'), claimed: range(1, 30),
      choice: 'lightnix', chosen_at: berlinIso(d2, '20:40'), joined_day: d1, last_tick_at: live, day_key: d3,
      day_quests: [...NORMAL(true, true, true, true), dq('h_kills', 'kills', 'hard', 4200, 90, true)], closure: true,
      weekly_quests: [WEEK.w_kills, WEEK.w_bosses], weekly_done: { w_kills: 3, w_bosses: 3 } }),
    // Stufe 30 (Ueberschuss), Auswahl OFFEN, nicht alles abgeholt
    progressRow(E, 2, 'Bob', { points: 3050, earned: true, earned_at: berlinIso(d3, '09:00'), claimed: range(1, 29),
      joined_day: d1, last_tick_at: live, day_key: d3,
      day_quests: [...NORMAL(true, false, false, false), dq('h_kills', 'kills', 'hard', 4200, 90, false)],
      weekly_quests: [WEEK.w_kills, WEEK.w_runes], weekly_done: { w_kills: 2, w_runes: 1 } }),
    // Stufe 20, bis 20 abgeholt
    progressRow(E, 3, 'Cara', { points: 2000, claimed: range(1, 20), joined_day: d1, last_tick_at: live, day_key: d3,
      day_quests: [...NORMAL(true, true, true, false), dq('h_kills', 'kills', 'hard', 4200, 90, false)],
      weekly_quests: [WEEK.w_kills, WEEK.w_bosses], weekly_done: { w_kills: 1, w_bosses: 0 } }),
    // Stufe 20, nur bis 10 abgeholt (11-20 nicht abgeholt), gestern zuletzt online
    progressRow(E, 4, 'Dan', { points: 2000, claimed: range(1, 10), joined_day: d1, last_tick_at: old, day_key: d2,
      day_quests: NORMAL(true, false, false, false), weekly_quests: [WEEK.w_bosses], weekly_done: { w_bosses: 2 } }),
    // Stufe 15, heute aktiv
    progressRow(E, 5, 'Eli', { points: 1500, claimed: range(1, 15), joined_day: d2, last_tick_at: live, day_key: d3,
      day_quests: [...NORMAL(false, false, true, false), dq('h_kills', 'kills', 'hard', 4200, 90, false)],
      weekly_quests: [WEEK.w_kills, WEEK.w_world], weekly_done: { w_kills: 1, w_world: 3 } }),
    // Stufe 9
    progressRow(E, 6, 'Finn', { points: 950, claimed: [1, 2, 3], joined_day: d2, last_tick_at: old, day_key: d2,
      day_quests: NORMAL(false, false, undefined, undefined).slice(0, 2), weekly_quests: [WEEK.w_kills], weekly_done: { w_kills: 0 } }),
    // Stufe 1, heute aktiv
    progressRow(E, 7, 'Gina', { points: 100, claimed: [1], joined_day: d3, last_tick_at: live, day_key: d3,
      day_quests: NORMAL(false, false, false, false), weekly_quests: [WEEK.w_kills], weekly_done: { w_kills: 0 } }),
    // Stufe 0, aber aktiv (50 Punkte)
    progressRow(E, 8, 'Hugo', { points: 50, joined_day: d3, last_tick_at: live, day_key: d3,
      day_quests: [dq('d_kills', 'kills', 'normal', 1500, 40, false)], weekly_quests: [WEEK.w_kills], weekly_done: {} }),
    // gestartet, 0 Punkte
    progressRow(E, 9, 'Ida', { points: 0, joined_day: d3, last_tick_at: live, day_key: d3,
      day_quests: [dq('d_kills', 'kills', 'normal', 1500, 40, false)], weekly_quests: [WEEK.w_kills], weekly_done: {} }),
    // Stufe 30, Darknix, Beitrittstag unbekannt (vor Statistikstart), gestern zuletzt online
    progressRow(E, 10, 'Jan', { points: 3000, earned: true, earned_at: berlinIso(d1, '22:00'), claimed: range(1, 30),
      choice: 'darknix', chosen_at: berlinIso(d1, '22:05'), joined_day: null, last_tick_at: old, day_key: d2,
      day_quests: [dq('d_kills', 'kills', 'normal', 1500, 40, true)], weekly_quests: [WEEK.w_kills], weekly_done: { w_kills: 3 } })
  ];
  const names = ['Alice', 'Bob', 'Cara', 'Dan', 'Eli', 'Finn', 'Gina', 'Hugo', 'Ida', 'Jan'];
  const stats = players.map((p, i) => ({ auth_user_id: p.auth_user_id, display_name: names[i], name_key: p.name_key }));
  /* Tagesprotokoll: Alice (Tag 1+2), Cara (Tag 1+2), Dan (Tag 1) haben Tageswechsel hinter sich. */
  const log = [
    { event_id: E, auth_user_id: uid(1), day_key: d1, closure_done: true, points_end: 400, quests: [...NORMAL(true, true, true, true), dq('h_kills', 'kills', 'hard', 4200, 90, true)] },
    { event_id: E, auth_user_id: uid(1), day_key: d2, closure_done: true, points_end: 2900, quests: [...NORMAL(true, true, true, true), dq('h_kills', 'kills', 'hard', 4200, 90, false)] },
    { event_id: E, auth_user_id: uid(3), day_key: d1, closure_done: false, points_end: 300, quests: NORMAL(true, false, false, false) },
    { event_id: E, auth_user_id: uid(3), day_key: d2, closure_done: false, points_end: 1700, quests: NORMAL(true, true, false, false) },
    { event_id: E, auth_user_id: uid(4), day_key: d1, closure_done: false, points_end: 500, quests: NORMAL(false, false, true, false) }
  ];
  return { event, players, stats, log, now: nowMs, days: { d1, d2, d3 } };
}

/* ---------- Szenario 2: ein ganz anderes Event ---------- */
function makeCustomEventScenario(nowMs) {
  nowMs = nowMs || NOW_MS;
  const config = {
    daily: { normal_count: 2, normal_points: 60, hard_points: 150,
      closure: { need: 2, points: 80, name: 'Abschluss', icon: 'x' },
      normal: [{ id: 'c_a', name: 'Alpha-Aufgabe', metric: 'kills', target: 100 }, { id: 'c_b', name: 'Beta-Aufgabe', metric: 'bosses', target: 3 }],
      hard: [{ id: 'c_h', name: 'Harte Aufgabe', metric: 'kills', target: 900 }] },
    weekly: [{ id: 'cw_x', name: 'Wochen-X', metric: 'kills', stages: [[1000, 100], [3000, 120]] }],
    weekly_alts: [],
    tiers: [
      { tier: 1, reward: { gold_units: 10 } },
      { tier: 4, reward: { label: 'Kristallkiste', crystals: 100 } },
      { tier: 8, reward: { label: 'Seltenes Ei', species_eggs: ['dayman'] } },
      { tier: 12, reward: { label: 'Wahl des Pfades', choice: true } }
    ],
    choices: { aaa: { icon: 'A', name: 'Aaa-Drache' }, bbb: { icon: 'B', name: 'Bbb-Drache' }, ccc: { icon: 'C', name: 'Ccc-Drache' } }
  };
  // Drei Tage, der letzte Tag ist der Berliner Tag von "jetzt" minus 5 -> das Event ist bereits ENDED.
  const lastDay = addDays(berlinDateStr(nowMs), -5), firstDay = addDays(lastDay, -2);
  const start = Date.parse(berlinMidnightIso(firstDay));
  const end = Date.parse(berlinMidnightIso(addDays(lastDay, 1))) - 60 * 1000;
  const mid = addDays(firstDay, 1);
  const event = {
    id: 'frostfest', name: '❄️ Frostfest', subtitle: 'Ein anderes Event', description: '', lore: '',
    announce_at: iso(start - 24 * HOUR), starts_at: iso(start), ends_at: iso(end), timezone: 'Europe/Berlin',
    enabled: true, archived: false, tier_count: 12, points_per_tier: 250, config,
    reward_group: 'frost', lifetime_claim_limit: 1, choice_mode: 'player_choice', reward_species: ['aaa', 'bbb', 'ccc'], assets: {}
  };
  const E = 'frostfest';
  const wk = { id: 'cw_x', metric: 'kills', stages: [[1000, 100], [3000, 120]] };
  const players = [
    progressRow(E, 101, 'Ann', { points: 3000, earned: true, earned_at: berlinIso(mid, '10:00'), claimed: [1, 4, 8, 12], choice: 'aaa', chosen_at: berlinIso(mid, '10:10'), joined_day: firstDay, day_key: lastDay,
      day_quests: [dq('c_a', 'kills', 'normal', 100, 60, true), dq('c_b', 'bosses', 'normal', 3, 60, true), dq('c_h', 'kills', 'hard', 900, 150, true)], closure: true, weekly_quests: [wk], weekly_done: { cw_x: 2 } }),
    progressRow(E, 102, 'Ben', { points: 3300, earned: true, earned_at: berlinIso(mid, '15:00'), claimed: [1, 4, 8], choice: 'ccc', chosen_at: berlinIso(mid, '15:10'), joined_day: firstDay, day_key: lastDay,
      day_quests: [dq('c_a', 'kills', 'normal', 100, 60, true), dq('c_b', 'bosses', 'normal', 3, 60, false), dq('c_h', 'kills', 'hard', 900, 150, false)], weekly_quests: [wk], weekly_done: { cw_x: 1 } }),
    progressRow(E, 103, 'Cleo', { points: 2000, claimed: [1, 4, 8], joined_day: mid, day_key: mid,
      day_quests: [dq('c_a', 'kills', 'normal', 100, 60, false), dq('c_b', 'bosses', 'normal', 3, 60, false)], weekly_quests: [wk], weekly_done: { cw_x: 0 } }),
    progressRow(E, 104, 'Dirk', { points: 600, claimed: [1], joined_day: lastDay, day_key: lastDay,
      day_quests: [dq('c_a', 'kills', 'normal', 100, 60, true), dq('c_b', 'bosses', 'normal', 3, 60, false)], weekly_quests: [wk], weekly_done: { cw_x: 0 } }),
    progressRow(E, 105, 'Emma', { points: 3000, earned: true, earned_at: berlinIso(lastDay, '09:00'), claimed: [1, 4, 8], joined_day: firstDay, day_key: lastDay,
      day_quests: [dq('c_a', 'kills', 'normal', 100, 60, true)], weekly_quests: [wk], weekly_done: { cw_x: 2 } })
  ];
  const names = ['Ann', 'Ben', 'Cleo', 'Dirk', 'Emma'];
  const stats = players.map((p, i) => ({ auth_user_id: p.auth_user_id, display_name: names[i], name_key: p.name_key }));
  return { event, players, stats, log: [], now: nowMs, days: { firstDay, mid, lastDay },
    species: [{ id: 'aaa', name: 'Aaa' }, { id: 'bbb', name: 'Bbb' }, { id: 'ccc', name: 'Ccc' }] };
}

/* ---------- Leistungstest: n Spieler, deterministisch verteilt ---------- */
function makeBulkPlayers(n, eventId, nowMs) {
  nowMs = nowMs || NOW_MS;
  const d3 = berlinDateStr(nowMs), d2 = addDays(d3, -1), d1 = addDays(d3, -2);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rows = [], stats = [], log = [];
  for (let i = 0; i < n; i++) {
    const points = Math.min(3300, Math.floor(rnd() * rnd() * 3400));          // viele niedrig, wenige hoch
    const tier = Math.min(30, Math.floor(points / 100));
    const dayKey = rnd() < 0.5 ? d3 : d2;
    const name = 'Spieler' + String(i).padStart(5, '0');
    const row = progressRow(eventId, 1000 + i, name, {
      points, earned: tier >= 30, earned_at: tier >= 30 ? iso(nowMs - 20 * HOUR) : null,
      claimed: range(1, Math.floor(tier * rnd())), choice: tier >= 30 && rnd() < 0.8 ? (rnd() < 0.6 ? 'lightnix' : 'darknix') : null,
      chosen_at: null, joined_day: rnd() < 0.9 ? d1 : d2, last_tick_at: iso(nowMs - Math.floor(rnd() * 48) * HOUR), day_key: dayKey,
      day_quests: [dq('d_kills', 'kills', 'normal', 1500, 40, rnd() < 0.6), dq('d_bosses', 'bosses', 'normal', 15, 40, rnd() < 0.5),
        dq('d_dungeons', 'dungeons', 'normal', 3, 40, rnd() < 0.4), dq('h_kills', 'kills', 'hard', 4200, 90, rnd() < 0.2)],
      weekly_quests: [WEEK.w_kills, WEEK.w_bosses], weekly_done: { w_kills: Math.floor(rnd() * 4), w_bosses: Math.floor(rnd() * 4) }
    });
    if (row.choice_species) row.chosen_at = iso(nowMs - 19 * HOUR);
    rows.push(row);
    stats.push({ auth_user_id: row.auth_user_id, display_name: name, name_key: name.toLowerCase() });
    if (dayKey === d3) log.push({ event_id: eventId, auth_user_id: row.auth_user_id, day_key: d2, closure_done: rnd() < 0.3, points_end: Math.floor(points * 0.7),
      quests: [dq('d_kills', 'kills', 'normal', 1500, 40, rnd() < 0.6), dq('d_bosses', 'bosses', 'normal', 15, 40, rnd() < 0.5)] });
  }
  return { players: rows, stats, log };
}

module.exports = { NOW_MS, uid, berlinDateStr, addDays, berlinIso, makeZwielichtScenario, makeCustomEventScenario, makeBulkPlayers, ZWIELICHT_CONFIG };
