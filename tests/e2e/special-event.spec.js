/* Drachendorf-Ausbau Phase 7-9/11 (04.10.2026): Special-Event-Framework,
   Zwielicht-Pass, Wahl Lightnix/Darknix, kleine Wochenereignisse.
   Server-Nachbau: tests/mock/event-engine.js (nutzt dieselben Regeln wie
   das Spiel: js/systems/bkmp-event-rules.js). Konfiguration + Arten werden
   direkt aus sql/20261004-07/-08 gelesen. */
const fs = require('fs');
const path = require('path');
const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');
const { createStore, seedStore } = require('../mock/store');
const { handleRpcRequest } = require('../mock/rpc-engine');
const { handleRestRequest } = require('../mock/rest-engine');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { ZWIELICHT_CONFIG, makeZwielichtEventRow, scheduleFor, EVENT_SPECIES, PASS_EGG_SPECIES } = require('../fixtures/event-reference');
/* Event-Arten (Lightnix/Darknix) + die echten Arten der garantierten Pass-Eier. */
const ALL_SPECIES = () => [...EVENT_SPECIES, ...PASS_EGG_SPECIES].map(s => ({ ...s }));
const rules = require('../../js/systems/bkmp-event-rules.js');

const UID = 'qa-ev-0000-4000-8000-000000000001';
const NAME = 'qaevent';
const HOUR = 3600 * 1000;

/* ---------- reine Server-/Regel-Tests (ohne Browser) ---------- */
function makeWorld(startIso, opts) {
  const start = Date.parse(startIso);
  const store = createStore(start);
  seedStore(store, {
    startTimeMs: start,
    users: [],
    tables: {
      idle_player_state: [makePlayerStateRow(UID, NAME, startIso, {
        display_name: 'QaEvent', dragon_kills: 300000, playtime_seconds: 100 * 3600, boss_kills: 1000, highest_dragon_index: 500,
        gold: 1e9, crystals: 1e6, essence: 1e6, ...((opts && opts.state) || {})
      })],
      dragon_species: ALL_SPECIES(),
      special_events: [makeZwielichtEventRow((opts && opts.event) || {})],
      player_dragons: (opts && opts.dragons) || [],
      idle_player_runes: (opts && opts.runes) || [],
      guild_members: (opts && opts.guild) || []
    }
  });
  return store;
}
function rpc(store, fn, params, uid) {
  const r = handleRpcRequest(store, uid === undefined ? UID : uid, fn, params || {});
  if (r.status !== 200) { const e = new Error(r.json && r.json.message); e.rpc = r.json; throw e; }
  return r.json;
}
function rpcErr(store, fn, params) {
  try { rpc(store, fn, params); return 'ok'; } catch (e) { return e.message; }
}
function state(store) { return store.tables.idle_player_state.find(r => r.auth_user_id === UID); }
/* Spieler kaempft "secs" Sekunden lang mit "kph" Kills/Stunde (gespeicherte Zaehler). */
function play(store, secs, kph, bossesPerHour) {
  const st = state(store);
  st.playtime_seconds += secs;
  st.dragon_kills += Math.round(kph * secs / 3600);
  st.boss_kills += Math.round((bossesPerHour || 0) * secs / 3600);
  store.clock.advance(secs * 1000);
}
/* Termine: Montag 19.10.2026 (Winterzeit-Umstellung erst am 25.10.). */
const MONDAY = '2026-10-19';
const SCHED = scheduleFor(MONDAY, 3);

test.describe('Zwielicht-Pass – Konfiguration & Regeln', () => {
  test('Konfiguration aus der SQL: 30 Stufen, Meilensteine, Punkte-Spielraum, bekannte Kennzahlen', () => {
    const c = ZWIELICHT_CONFIG;
    expect(c.tiers.map(t => t.tier)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(c.tiers[29].reward.choice).toBe(true);
    [5, 10, 15, 20, 25, 28, 29].forEach(t => expect(c.tiers[t - 1].reward.label, 'Meilenstein ' + t).toBeTruthy());
    expect(c.tiers.find(t => t.tier === 10).reward.unlock).toBe('title_zwielicht');
    expect(c.tiers.find(t => t.tier === 15).reward.unlock).toBe('badge_zwielicht');
    expect(c.tiers.find(t => t.tier === 20).reward.unlock).toBe('cosmetic_zwielicht');
    const daily = 7 * (c.daily.normal_count * c.daily.normal_points + c.daily.hard_points + c.daily.closure.points);
    const weekly = c.weekly.reduce((a, q) => a + q.stages.reduce((b, s) => b + s[1], 0), 0);
    expect(daily).toBe(2450);
    expect(daily + weekly).toBeGreaterThanOrEqual(3400);
    expect(daily + weekly).toBeLessThanOrEqual(3600);
    // Wochenquests mit Freischalt-Bedingung haben eine gleichwertige Alternative.
    c.weekly.filter(q => q.requires).forEach(q => {
      const alt = c.weekly_alts.find(a => a.id === q.alt);
      expect(alt, q.id).toBeTruthy();
      expect(alt.stages.reduce((b, s) => b + s[1], 0)).toBe(q.stages.reduce((b, s) => b + s[1], 0));
    });
    const metrics = [...c.daily.normal, ...c.daily.hard, ...c.weekly, ...c.weekly_alts].map(q => q.metric);
    metrics.forEach(m => expect(rules.BKMP_EVENT_METRIC_META[m], m).toBeTruthy());
  });

  test('SQL und Regelmodul rechnen dieselben Deckel', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../sql/20261004-06-special-events.sql'), 'utf8');
    const block = sql.slice(sql.indexOf('function public.event_metric_cap'), sql.indexOf('function public.event_client_day_cap'));
    const re = /when '([a-z_]+)' then (?:floor\(p_elapsed(?: (\*|\/) (\d+))?\)(?: \+ (\d+))?|(\d+))/g;
    let m, n = 0;
    while ((m = re.exec(block))) {
      n++;
      for (const e of [0, 7, 59, 60, 600]) {
        let expected;
        if (m[5] !== undefined) expected = Number(m[5]);
        else expected = Math.floor(!m[2] ? e : m[2] === '*' ? e * Number(m[3]) : e / Number(m[3])) + Number(m[4] || 0);
        expect(rules.bkmpEventMetricCap(m[1], e), `${m[1]} @${e}s`).toBe(expected);
      }
    }
    expect(n).toBeGreaterThanOrEqual(10);
    ['tower', 'feedings', 'world_events'].forEach(k => {
      const v = Number(sql.match(new RegExp(`when '${k}' then (\\d+)`, 'g')).pop().match(/(\d+)$/)[1]);
      expect(rules.bkmpEventClientDayCap(k)).toBe(v);
    });
  });

  test('Status: aus/ohne Termin unsichtbar, Ankündigung, Montag 00:00 live, Sonntag 23:59 vorbei, Archiv', () => {
    const ev = makeZwielichtEventRow(SCHED);
    const at = iso => rules.bkmpEventStatus(ev, Date.parse(iso));
    expect(rules.bkmpEventStatus(makeZwielichtEventRow(), Date.parse('2026-10-20T10:00:00Z'))).toBe('HIDDEN');
    expect(rules.bkmpEventStatus({ ...ev, enabled: false }, Date.parse('2026-10-20T10:00:00Z'))).toBe('HIDDEN');
    expect(at('2026-10-15T21:59:59Z')).toBe('HIDDEN'); // Do 23:59:59 Berlin
    expect(at('2026-10-15T22:00:00Z')).toBe('COMING_SOON'); // Fr 00:00 Berlin
    expect(at('2026-10-18T21:59:59Z')).toBe('COMING_SOON');
    expect(at('2026-10-18T22:00:00Z')).toBe('LIVE'); // Mo 00:00 Berlin (Sommerzeit)
    expect(at('2026-10-25T22:58:59Z')).toBe('LIVE'); // So 23:58:59 Berlin (Winterzeit)
    expect(at('2026-10-25T22:59:00Z')).toBe('ENDED'); // So 23:59 Berlin
    expect(rules.bkmpEventStatus({ ...ev, archived: true }, Date.parse('2026-11-30T10:00:00Z'))).toBe('ARCHIVED');
    // Berliner Kalendertag + naechste Mitternacht ueber die Zeitumstellung hinweg
    expect(rules.bkmpEventBerlinDayKey(Date.parse('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
    expect(new Date(rules.bkmpEventNextBerlinMidnight(Date.parse('2026-10-25T12:00:00Z'))).toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  test('Tagesaufgaben: 4 normale + 1 schwere, gleich bei Reload, neu am nächsten Tag, keine gesperrten Systeme', () => {
    const store = makeWorld('2026-10-19T08:00:00Z', { event: SCHED });
    const a = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    expect(a.joined).toBe(true);
    play(store, 60, 3000);
    const b = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    expect(b.day_quests).toHaveLength(5);
    expect(b.day_quests.filter(q => q.kind === 'hard')).toHaveLength(1);
    // Ohne Gilde/Drachenhafen/Babys/Runen: keine solche Pflichtaufgabe.
    b.day_quests.forEach(q => expect(['guild', 'expeditions', 'feedings', 'runes']).not.toContain(q.metric));
    // Kein Neuwuerfeln innerhalb des Tages
    play(store, 60, 3000);
    const c = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    expect(c.day_quests.map(q => q.id)).toEqual(b.day_quests.map(q => q.id));
    // Wochenquests: Alternativen statt gesperrter Systeme
    expect(c.weekly_quests.map(q => q.id)).toEqual(['w_kills', 'w_bosses', 'w_active', 'w_dungeons', 'w_tower', 'w_world', 'w_hunt', 'w_trials']);
    // Naechster Berliner Tag -> neue Aufgaben (deterministisch, nicht zufaellig pro Aufruf)
    const keys = new Set([c.day_key]);
    const sets = new Set([c.day_quests.map(q => q.id).join()]);
    for (let d = 0; d < 4; d++) {
      play(store, 24 * 3600, 0);
      const t = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
      keys.add(t.day_key);
      sets.add(t.day_quests.map(q => q.id).join());
    }
    expect(keys.size).toBe(5);
    expect(sets.size).toBeGreaterThan(1);
  });

  test('Fortschritt: nur echte Kampfzeit zählt, Offline-Kills nicht, Deckel pro Minute und Tag', () => {
    const store = makeWorld('2026-10-19T08:00:00Z', { event: SCHED });
    rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    // Offline-Belohnung: 50.000 Kills ohne Kampfzeit -> zaehlt nicht
    state(store).dragon_kills += 50000;
    store.clock.advance(60 * 1000);
    let t = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    expect(t.cumulative.kills).toBe(0);
    // 10 Minuten echtes Spiel bei 3.000/h -> 500 Kills
    play(store, 600, 3000);
    t = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    expect(t.cumulative.kills).toBe(500);
    expect(t.cumulative.active).toBe(600);
    // Unrealistischer Kill-Sprung: Deckel 3 Kills/Sekunde echter Kampfzeit
    const st = state(store);
    st.playtime_seconds += 60; st.dragon_kills += 100000; store.clock.advance(60 * 1000);
    t = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    expect(t.cumulative.kills).toBe(500 + 180);
    // Vom Spiel gemeldete Zaehler: pro Minute und pro Tag gedeckelt
    store.clock.advance(60 * 1000);
    t = rpc(store, 'event_tick', { p_event_id: 'zwielicht', p_client: { tower: 999, world_events: 999, feedings: 3 } });
    expect(t.client_accepted).toEqual({ tower: 21, feedings: 3, world_events: 1 });
    for (let i = 0; i < 20; i++) { store.clock.advance(600 * 1000); rpc(store, 'event_tick', { p_event_id: 'zwielicht', p_client: { tower: 999 } }); }
    t = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    expect(t.cumulative.tower).toBe(130);
  });

  test('Punkte: Tagesaufgaben + Tagesabschluss genau einmal, Wochenstufen, mehrere Passstufen auf einmal', () => {
    const store = makeWorld('2026-10-19T08:00:00Z', { event: SCHED });
    rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    const st = state(store);
    // 3 Stunden Kampf + 10 Dungeons + Turm + Weltereignisse am ersten Tag
    store.tables.dungeon_progress = [{ auth_user_id: UID, dungeon_type: 'gold', total_keys_spent: 0 }];
    for (let i = 0; i < 18; i++) {
      play(store, 600, 3000, 120);
      store.tables.dungeon_progress[0].total_keys_spent += 1;
      rpc(store, 'event_tick', { p_event_id: 'zwielicht', p_client: { tower: 5, world_events: 1 } });
    }
    const t = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    expect(t.day_quests.every(q => q.done)).toBe(true);
    expect(t.day_closure_done).toBe(true);
    const dayPts = 4 * 40 + 90 + 100;
    const weeklyPts = t.weekly_quests.reduce((a, q) => a + q.stages.slice(0, t.weekly_done[q.id]).reduce((b, s) => b + s[1], 0), 0);
    expect(t.points).toBe(dayPts + weeklyPts);
    expect(t.tier).toBe(Math.floor(t.points / 100));
    expect(t.tier).toBeGreaterThanOrEqual(3);
    // Weitere Aufrufe am selben Tag: keine doppelten Punkte
    play(store, 600, 3000);
    const t2 = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    expect(t2.points - t.points).toBe(t2.weekly_quests.reduce((a, q) => a + q.stages.slice(t.weekly_done[q.id], t2.weekly_done[q.id]).reduce((b, s) => b + s[1], 0), 0));
    expect(st.playtime_seconds).toBeGreaterThan(0);
  });

  test('Hardcore-Woche: Montag bis Freitag unmöglich, frühestens Samstag Stufe 30, danach EARNED auch nach Eventende', () => {
    const store = makeWorld('2026-10-18T22:00:30Z', { event: SCHED });
    store.tables.dungeon_progress = [{ auth_user_id: UID, dungeon_type: 'gold', total_keys_spent: 0 }];
    rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    const tierAtEndOf = {};
    for (let day = 0; day < 7; day++) {
      // 10 Stunden extremes Spiel pro Tag in 10-Minuten-Schritten, alles was geht
      for (let i = 0; i < 60; i++) {
        play(store, 600, 3500, 180);
        store.tables.dungeon_progress[0].total_keys_spent += 1;
        rpc(store, 'event_tick', { p_event_id: 'zwielicht', p_client: { tower: 30, world_events: 5, feedings: 10 } });
      }
      const t = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
      tierAtEndOf[day] = t.tier;
      store.clock.setNow(Date.parse(SCHED.starts_at) + (day + 1) * 24 * HOUR + 30 * 1000);
    }
    expect(tierAtEndOf[4], 'Freitag').toBeLessThan(30);
    expect(tierAtEndOf[5], 'Samstag').toBe(30);
    const row = store.tables.player_event_progress[0];
    expect(row.earned).toBe(true);
    // Nach Sonntag 23:59: keine neuen Punkte, EARNED bleibt
    store.clock.setNow(Date.parse(SCHED.ends_at) + HOUR);
    const pts = row.points;
    play(store, 3600, 3500);
    const after = rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    expect(after.status).toBe('ENDED');
    expect(after.points).toBe(pts);
    expect(after.earned).toBe(true);
  });

  test('Stufenbelohnungen: genau einmal, Futter mit Lagerdeckel, Freischaltungen gespeichert', () => {
    const store = makeWorld('2026-10-19T08:00:00Z', { event: SCHED, state: { fruit: 1950, obstgarten_level: 0 } });
    rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    store.tables.player_event_progress[0].points = 1050; // Stufe 10
    const goldBefore = state(store).gold;
    const r = rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' });
    expect(r.items.map(i => i.tier)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.unlocks).toEqual(['title_zwielicht']);
    const unit = Math.max(6, Math.round(6 * Math.pow(1 + 0.05 * 500, 1.2)));
    expect(state(store).gold - goldBefore).toBe(Math.round(120 * unit) + Math.round(300 * unit) + Math.round(180 * unit));
    expect(r.credited.fruit).toBe(50); // Lagerdeckel 2.000
    const again = rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' });
    expect(again.items).toEqual([]);
    expect(state(store).gold - goldBefore).toBe(r.credited.gold);
  });

  test('Wahl: erst ab Stufe 30, genau einer, dauerhaft – auch nach Eventende und bei Wiederholung nie ein zweiter', () => {
    const store = makeWorld('2026-10-19T08:00:00Z', { event: SCHED });
    rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    expect(rpcErr(store, 'event_choose_reward', { p_event_id: 'zwielicht', p_species_id: 'lightnix' })).toBe('not_earned');
    const row = store.tables.player_event_progress[0];
    row.points = 3000; row.earned = true;
    expect(rpcErr(store, 'event_choose_reward', { p_event_id: 'zwielicht', p_species_id: 'feuerdrache' })).toBe('invalid_choice');
    store.clock.setNow(Date.parse(SCHED.ends_at) + 2 * 24 * HOUR); // nach dem Event
    const res = rpc(store, 'event_choose_reward', { p_event_id: 'zwielicht', p_species_id: 'darknix' });
    expect(res.species_id).toBe('darknix');
    expect(store.tables.player_dragon_eggs.filter(e => e.auth_user_id === UID).map(e => e.species_id)).toEqual(['darknix']);
    expect(rpcErr(store, 'event_choose_reward', { p_event_id: 'zwielicht', p_species_id: 'lightnix' })).toBe('already_chosen');
    // Wiederholung des Events (neue ID, gleiche Belohnungsgruppe): kein zweiter Drache
    const nextMonday = '2027-03-01';
    store.tables.special_events.push(makeZwielichtEventRow({ id: 'zwielicht2', ...scheduleFor(nextMonday, 3) }));
    store.clock.setNow(Date.parse(scheduleFor(nextMonday, 3).starts_at) + HOUR);
    const t = rpc(store, 'event_tick', { p_event_id: 'zwielicht2' });
    expect(t.already_claimed_group).toBe(true);
    store.tables.player_event_progress.find(p => p.event_id === 'zwielicht2').earned = true;
    expect(rpcErr(store, 'event_choose_reward', { p_event_id: 'zwielicht2', p_species_id: 'lightnix' })).toBe('claim_limit_reached');
    expect(store.tables.player_dragon_eggs.filter(e => e.auth_user_id === UID)).toHaveLength(1);
  });

  test('Schutz: Event-Eier nie aus dem Spiel, Einzelstück-Drache nur aus eigenem Ei und höchstens einmal', () => {
    const store = makeWorld('2026-10-19T08:00:00Z', { event: SCHED });
    const post = (table, body) => handleRestRequest(store, { method: 'POST', tableName: table, searchParams: new URLSearchParams(), body, headers: {} });
    expect(post('player_dragon_eggs', { name_key: NAME, auth_user_id: UID, species_id: 'lightnix' }).status).toBe(400);
    const dragon = { name_key: NAME, auth_user_id: UID, species_id: 'lightnix', stage: 'baby', food_preference: 'fruit' };
    expect(post('player_dragons', { ...dragon }).json.message).toBe('unique_species_needs_egg');
    store.tables.player_dragon_eggs = [{ id: 'egg-1', name_key: NAME, auth_user_id: UID, species_id: 'lightnix' }];
    const ok = post('player_dragons', { ...dragon });
    expect(ok.status).toBe(201);
    expect(ok.json[0].origin_event).toBe('zwielicht');
    expect(post('player_dragons', { ...dragon }).json.message).toBe('unique_species_already_owned');
    // Normale Arten bleiben unberuehrt
    store.tables.dragon_species.push({ id: 'qa-normal', rarity: 'standard', stage_count: 4, unique_per_account: false, event_origin: null });
    expect(post('player_dragon_eggs', { name_key: NAME, auth_user_id: UID, species_id: 'qa-normal' }).status).toBe(201);
  });

  test('Kleine Wochenereignisse: Bonus nur solange das Event läuft, höchstens 100 %', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../sql/20261004-10-small-weekly-events.sql'), 'utf8');
    const ids = Array.from(sql.matchAll(/\('([a-z]+)', '([^']+)', '[^']*',/g)).map(m => m[1]);
    expect(ids).toEqual(['brutwoche', 'runenmond', 'bossjagd', 'erntefest', 'expeditionsfieber', 'gildenwoche']);
    const { eventModifier } = require('../mock/event-engine');
    const store = makeWorld('2026-11-02T08:00:00Z', {});
    const base = { name: 'Gildenwoche', config: { kind: 'modifier', modifiers: { guild_project_points_pct: 50 } }, tier_count: 1, points_per_tier: 1 };
    store.tables.special_events.push({ id: 'gildenwoche', ...base, enabled: false, archived: false, starts_at: null, ends_at: null });
    expect(eventModifier(store, 'guild_project_points_pct')).toBe(0);
    Object.assign(store.tables.special_events[1], scheduleFor('2026-11-02', 0));
    expect(eventModifier(store, 'guild_project_points_pct')).toBe(50);
    store.tables.special_events.push({ id: 'x2', ...base, ...scheduleFor('2026-11-02', 0), config: { modifiers: { guild_project_points_pct: 80 } } });
    expect(eventModifier(store, 'guild_project_points_pct')).toBe(100);
    store.clock.setNow(Date.parse('2026-11-09T12:00:00Z'));
    expect(eventModifier(store, 'guild_project_points_pct')).toBe(0);
  });
});


/* ---------- Folgeupdate: garantierte Pass-Eier (Dayman / Surebrec) ---------- */
test.describe('Zwielicht-Pass – garantierte Eier', () => {
  function eggsOf(store, uid) { return (store.tables.player_dragon_eggs || []).filter(e => e.auth_user_id === (uid || UID)); }
  function speciesOf(store, uid) { return eggsOf(store, uid).map(e => e.species_id); }

  test('Konfiguration: Stufe 10 = Dayman, Stufe 20 = Surebrec, keine Zufallseier, Stufe 30 unverändert', () => {
    const c = ZWIELICHT_CONFIG;
    const t = n => c.tiers.find(x => x.tier === n).reward;
    expect(t(10).species_eggs).toEqual(['dayman']);
    expect(t(10).unlock).toBe('title_zwielicht');
    expect(t(20).species_eggs).toEqual(['surebrec']);
    expect(t(20).unlock).toBe('cosmetic_zwielicht');
    // Genau diese zwei Ei-Meilensteine, nirgends ein zufaelliges Ei
    expect(c.tiers.filter(x => x.reward.eggs)).toEqual([]);
    expect(c.tiers.flatMap(x => (x.reward.species_eggs || []).map(id => [x.tier, id]))).toEqual([[10, 'dayman'], [20, 'surebrec']]);
    // Stufe 30 bleibt die Wahl Lightnix/Darknix, ohne zusaetzliche Eier
    expect(t(30)).toEqual({ label: 'Die Wahl des Zwielichts: ☀️ Lightnix oder 🌑 Darknix', choice: true });
    // Echte Arten aus der Drachen-SQL, normale Arten (kein Einzelstueck)
    expect(PASS_EGG_SPECIES.map(sp => [sp.id, sp.name, sp.rarity])).toEqual([['dayman', 'Dayman', 'episch'], ['surebrec', 'Surebrec', 'episch']]);
    // Die SQL prueft vorab genau diese Arten (kein spaeteres Scheitern beim Abholen)
    const sql = fs.readFileSync(path.join(__dirname, '../../sql/20261004-07-zwielicht-event.sql'), 'utf8');
    const pre = sql.slice(0, sql.indexOf('insert into public.special_events'));
    ['dayman', 'surebrec'].forEach(id => expect(pre).toContain(`ds.id = '${id}'`));
  });

  test('Stufe 10 gibt genau ein Dayman-Ei, Stufe 20 genau ein Surebrec-Ei – nie eine andere Art', () => {
    // Mehrere Spieler/Tage: die Art haengt nie vom Zufall oder Spieler ab.
    for (let i = 0; i < 12; i++) {
      const uid = `qa-ev-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`;
      const store = makeWorld(new Date(Date.parse('2026-10-19T03:00:00Z') + i * 11 * HOUR).toISOString(), { event: SCHED });
      store.tables.idle_player_state[0].auth_user_id = uid;
      rpc(store, 'event_tick', { p_event_id: 'zwielicht' }, uid);
      const row = store.tables.player_event_progress[0];
      row.points = 999; // Stufe 9
      rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' }, uid);
      expect(speciesOf(store, uid)).toEqual([]);
      row.points = 1000; // Stufe 10
      const r10 = rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' }, uid);
      expect(r10.items.map(x => x.tier)).toEqual([10]);
      expect(r10.eggs.map(e => [e.species_id, e.tier])).toEqual([['dayman', 10]]);
      expect(speciesOf(store, uid)).toEqual(['dayman']);
      expect(r10.unlocks).toContain('title_zwielicht');
      row.points = 1999; // Stufe 19
      expect(rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' }, uid).eggs).toEqual([]);
      row.points = 2000; // Stufe 20
      const r20 = rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' }, uid);
      expect(r20.eggs.map(e => [e.species_id, e.tier])).toEqual([['surebrec', 20]]);
      expect(r20.unlocks).toContain('cosmetic_zwielicht');
      row.points = 3590; // alles bis Stufe 30
      expect(rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' }, uid).eggs).toEqual([]);
      expect(speciesOf(store, uid)).toEqual(['dayman', 'surebrec']);
      expect(eggsOf(store, uid).every(e => e.name_key === NAME)).toBe(true);
    }
  });

  test('Mehrere Stufen auf einmal (0 → 30): beide Eier genau einmal, Stufe 30 bleibt die Wahl', () => {
    const store = makeWorld('2026-10-24T10:00:00Z', { event: SCHED });
    rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    Object.assign(store.tables.player_event_progress[0], { points: 3000, earned: true });
    const r = rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' });
    expect(r.items).toHaveLength(30);
    expect(r.eggs.map(e => e.species_id)).toEqual(['dayman', 'surebrec']);
    expect(speciesOf(store)).toEqual(['dayman', 'surebrec']);
    // Kein Lightnix/Darknix durch das Abholen - nur ueber die Wahl
    rpc(store, 'event_choose_reward', { p_event_id: 'zwielicht', p_species_id: 'lightnix' });
    expect(speciesOf(store)).toEqual(['dayman', 'surebrec', 'lightnix']);
    expect(rpcErr(store, 'event_choose_reward', { p_event_id: 'zwielicht', p_species_id: 'darknix' })).toBe('already_chosen');
  });

  test('Vorhandener Dayman/Surebrec (Ei und Drache) verhindert das Abholen nicht', () => {
    const dragons = ['dayman', 'surebrec'].map((sp, i) => ({ id: 'qa-own-' + i, name_key: NAME, auth_user_id: UID, species_id: sp, stage: 'adult', food_preference: 'fruit' }));
    const store = makeWorld('2026-10-20T10:00:00Z', { event: SCHED, dragons });
    store.tables.player_dragon_eggs = [
      { id: 'qa-own-egg-1', name_key: NAME, auth_user_id: UID, species_id: 'dayman' },
      { id: 'qa-own-egg-2', name_key: NAME, auth_user_id: UID, species_id: 'surebrec' }
    ];
    rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    store.tables.player_event_progress[0].points = 2000;
    const r = rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' });
    expect(r.eggs.map(e => e.species_id)).toEqual(['dayman', 'surebrec']);
    expect(speciesOf(store).sort()).toEqual(['dayman', 'dayman', 'surebrec', 'surebrec']);
    expect(store.tables.player_dragons).toHaveLength(2);
  });

  test('Doppelt abholen (zweiter Tab/Gerät, erneuter Klick): nie ein zweites Ei', () => {
    const store = makeWorld('2026-10-20T10:00:00Z', { event: SCHED });
    rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    store.tables.player_event_progress[0].points = 2100;
    const first = rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' });
    const second = rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' });
    const third = rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' });
    expect(first.eggs).toHaveLength(2);
    expect(second.items).toEqual([]);
    expect(second.eggs).toEqual([]);
    expect(third.eggs).toEqual([]);
    expect(speciesOf(store)).toEqual(['dayman', 'surebrec']);
  });

  test('Fehlende Art: nichts wird abgeholt (später erneut möglich); Einzelstück-Arten sind als festes Ei gesperrt', () => {
    const store = makeWorld('2026-10-20T10:00:00Z', { event: SCHED });
    store.tables.dragon_species = store.tables.dragon_species.filter(sp => sp.id !== 'dayman');
    rpc(store, 'event_tick', { p_event_id: 'zwielicht' });
    store.tables.player_event_progress[0].points = 1000;
    const before = { ...state(store) };
    expect(rpcErr(store, 'event_claim_tiers', { p_event_id: 'zwielicht' })).toBe('reward_species_missing');
    expect(store.tables.player_event_progress[0].tier_claimed).toEqual([]);
    expect(state(store).gold).toBe(before.gold);
    expect(speciesOf(store)).toEqual([]);
    store.tables.dragon_species.push(PASS_EGG_SPECIES.find(sp => sp.id === 'dayman'));
    expect(rpc(store, 'event_claim_tiers', { p_event_id: 'zwielicht' }).eggs.map(e => e.species_id)).toEqual(['dayman']);
    // Eine Einzelstueck-Art (Lightnix) als festes Ei wird vom Ei-Schutz abgelehnt
    const ev = store.tables.special_events[0];
    ev.config.tiers.find(t => t.tier === 11).reward.species_eggs = ['lightnix'];
    store.tables.player_event_progress[0].points = 1100;
    expect(rpcErr(store, 'event_claim_tiers', { p_event_id: 'zwielicht' })).toBe('event_species_egg_not_allowed');
    expect(speciesOf(store)).toEqual(['dayman']);
  });
});

/* ---------- im Spiel (Browser) ---------- */
test.describe('Zwielicht-Pass – im Spiel', () => {
  test.use({ teststand: 'C' });

  function liveSchedule(store) {
    const now = store.clock.nowMs();
    return { announce_at: new Date(now - 4 * 24 * HOUR).toISOString(), starts_at: new Date(now - HOUR).toISOString(), ends_at: new Date(now + 5 * 24 * HOUR).toISOString(), enabled: true };
  }
  async function openPass(page) {
    const hud = page.locator('#bkmpProtoChudEventBtn');
    if (await hud.isVisible().catch(() => false)) await hud.click();
    else await page.locator('#idleEventPassCard [data-event-open]').first().click();
    await expect(page.locator('#bkmpEventPassOverlay')).toHaveClass(/visible/);
  }

  test('Angekündigt: Teaser mit Countdown im Spiel und auf der Website (auch ohne Login)', async ({ page, qaBaseURL, fixtureData, store }) => {
    const now = store.clock.nowMs();
    store.tables.special_events = [makeZwielichtEventRow({ announce_at: new Date(now - HOUR).toISOString(), starts_at: new Date(now + 2 * 24 * HOUR).toISOString(), ends_at: new Date(now + 9 * 24 * HOUR).toISOString(), enabled: true })];
    store.tables.dragon_species = ALL_SPECIES();
    await page.goto(qaBaseURL + '/');
    const announce = page.locator('[data-testid="event-announcement"]');
    await expect(announce).toHaveCount(1, { timeout: 15000 });
    await expect(announce).toContainText('Das Erwachen des Zwielichts');
    await expect(announce).toContainText('Lightnix');
    await expect(announce).toContainText('Beginnt in');
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openPass(page);
    await expect(page.locator('[data-testid="event-teaser"]')).toContainText('DAS ZWIELICHT NAHT');
    await expect(page.locator('[data-testid="event-teaser"] [data-event-countdown]')).toContainText(/T\./);
    expect(store.tables.player_event_progress || []).toEqual([]);
  });

  test('Live: Pass mit Stufe, 5 Tagesaufgaben + Abschluss, 30 Stufen (Stufe 30 Licht/Dunkel), Belohnungen abholen', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.special_events = [makeZwielichtEventRow(liveSchedule(store))];
    store.tables.dragon_species = ALL_SPECIES();
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await expect.poll(() => (store.tables.player_event_progress || []).length, { timeout: 15000 }).toBe(1);
    await openPass(page);
    await expect(page.locator('[data-testid="event-tier"]')).toHaveText('Stufe 0 / 30');
    await page.evaluate(() => bkmpEventTick(true));
    await expect(page.locator('[data-testid="event-daily-quest"]')).toHaveCount(5);
    await expect(page.locator('[data-testid="event-daily-closure"]')).toContainText('4 von 5');
    await page.locator('#bkmpEventPassTabs [data-tab-id="week"]').click();
    await expect(page.locator('[data-testid="event-weekly-quest"]')).toHaveCount(8);
    await page.locator('#bkmpEventPassTabs [data-tab-id="rewards"]').click();
    await expect(page.locator('[data-testid="event-tier-30"]')).toContainText('DAS ZWIELICHT WARTET');
    const bg = await page.locator('[data-testid="event-tier-30"]').evaluate(el => getComputedStyle(el).backgroundImage);
    expect(bg).toContain('linear-gradient');
    // Stufe 7 erreicht -> Belohnungen abholen, lokaler Stand = Serverstand
    store.tables.player_event_progress[0].points = 750;
    await page.evaluate(() => bkmpEventTick(true));
    await page.locator('[data-testid="event-claim-btn"]').click();
    await expect(page.locator('[data-testid="event-claim-btn"]')).toHaveCount(0, { timeout: 10000 });
    const server = store.tables.idle_player_state.find(r => r.auth_user_id === fixtureData.authUserId);
    expect(await page.evaluate(() => bkmpIdleState.crystals)).toBe(Number(server.crystals));
    expect(store.tables.player_event_progress[0].tier_claimed).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(await page.evaluate(() => bkmpIdlePlayerRunes.length)).toBeGreaterThan(0);
  });

  test('Stufe 30: Wahl mit deutlicher Warnung, Ei im Lager, danach nur kompakter Status statt Werbung', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.special_events = [makeZwielichtEventRow(liveSchedule(store))];
    store.tables.dragon_species = ALL_SPECIES();
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await expect.poll(() => (store.tables.player_event_progress || []).length, { timeout: 15000 }).toBe(1);
    Object.assign(store.tables.player_event_progress[0], { points: 3000, earned: true });
    await page.evaluate(() => bkmpEventTick(true));
    await openPass(page);
    await expect(page.locator('[data-testid="event-choice"]')).toContainText('DAS ZWIELICHT ANTWORTET');
    await page.locator('[data-testid="event-choose-lightnix"]').click();
    await expect(page.locator('#bkmpConfirmOverlay')).toHaveClass(/visible/);
    await expect(page.locator('#bkmpConfirmTitle')).toHaveText('⚠️ Diese Wahl ist dauerhaft.');
    await expect(page.locator('#bkmpConfirmBody')).toContainText('Du kannst während dieses Events nur einen der beiden Drachen erhalten.');
    await expect(page.locator('#bkmpConfirmBody')).toContainText('Möchtest du wirklich Lightnix wählen?');
    await page.locator('#bkmpConfirmOkBtn').click();
    await expect(page.locator('[data-testid="event-chosen"]')).toContainText('Lightnix erhalten ✅', { timeout: 10000 });
    expect(store.tables.player_dragon_eggs.filter(e => e.species_id === 'lightnix')).toHaveLength(1);
    expect(await page.evaluate(() => bkmpPlayerDragonEggs.some(e => e.species_id === 'lightnix'))).toBe(true);
    expect(await page.locator('[data-testid="event-choose-darknix"]').count()).toBe(0);
  });

  test('Garantierte Eier sind vorab sichtbar (Meilensteine, Stufen-Zeilen, Pass-Karte) – kein Zufallsei', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.special_events = [makeZwielichtEventRow(liveSchedule(store))];
    store.tables.dragon_species = ALL_SPECIES();
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await expect.poll(() => (store.tables.player_event_progress || []).length, { timeout: 15000 }).toBe(1);
    await page.evaluate(() => bkmpEventTick(true));
    const card = page.locator('[data-testid="event-card-next"]');
    if (await page.locator('#idleEventPassCard').isVisible().catch(() => false)) {
      await expect(card).toContainText('Stufe 10');
      await expect(card).toContainText('Garantiertes Dayman-Ei');
    }
    await openPass(page);
    await page.locator('#bkmpEventPassTabs [data-tab-id="rewards"]').click();
    await expect(page.locator('[data-testid="event-highlight-10"]')).toContainText('Garantiertes Dayman-Ei');
    await expect(page.locator('[data-testid="event-highlight-20"]')).toContainText('Garantiertes Surebrec-Ei');
    await expect(page.locator('[data-testid="event-highlight-30"]')).toContainText('Lightnix oder');
    await expect(page.locator('[data-testid="event-tier-row-10"]')).toContainText('Garantiertes Dayman-Ei');
    await expect(page.locator('[data-testid="event-tier-row-10"]')).toContainText('Titel');
    await expect(page.locator('[data-testid="event-tier-row-20"]')).toContainText('Garantiertes Surebrec-Ei');
    await expect(page.locator('[data-testid="event-tier-row-20"]')).toContainText('Namensfarbe');
    // Ei-Vorschau aus dem echten Artenkatalog
    await expect(page.locator('[data-testid="event-tier-row-10"] img.bkmp-event-egg-thumb')).toHaveAttribute('src', /egg\/dayman-web\.png$/);
    await expect(page.locator('[data-testid="event-highlight-20"] img.bkmp-event-egg-thumb')).toHaveAttribute('src', /egg\/surebrec-web\.png$/);
    await expect(page.locator('.bkmp-event-track')).not.toContainText('Drachenei');
    await expect(page.locator('[data-testid="event-tier-30"]')).toContainText('DAS ZWIELICHT WARTET');
  });

  test('Stufe 10 + 20 abholen: Dayman- und Surebrec-Ei im Lager, Reload ändert die Art nicht', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.special_events = [makeZwielichtEventRow(liveSchedule(store))];
    store.tables.dragon_species = ALL_SPECIES();
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await expect.poll(() => (store.tables.player_event_progress || []).length, { timeout: 15000 }).toBe(1);
    const uid = fixtureData.authUserId;
    const before = store.tables.player_dragon_eggs.filter(e => e.auth_user_id === uid).length;
    store.tables.player_event_progress[0].points = 2050;
    await page.evaluate(() => bkmpEventTick(true));
    await openPass(page);
    await page.locator('[data-testid="event-claim-btn"]').click();
    await expect(page.locator('[data-testid="event-claim-btn"]')).toHaveCount(0, { timeout: 10000 });
    const serverEggs = () => store.tables.player_dragon_eggs.filter(e => e.auth_user_id === uid);
    expect(serverEggs()).toHaveLength(before + 2);
    const newEggs = serverEggs().filter(e => e.species_id === 'dayman' || e.species_id === 'surebrec');
    expect(newEggs.map(e => e.species_id).sort()).toEqual(['dayman', 'surebrec']);
    const ids = newEggs.map(e => e.id).sort();
    const local = await page.evaluate(ids => bkmpPlayerDragonEggs.filter(e => ids.includes(e.id)).map(e => e.species_id).sort(), ids);
    expect(local).toEqual(['dayman', 'surebrec']);
    // Reload: dieselben Eier mit derselben Art, nichts doppelt, kein neuer Abhol-Knopf
    await page.reload();
    await page.waitForFunction(() => typeof bkmpIdleOpenModal === 'function');
    await page.evaluate(() => bkmpIdleOpenModal());
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await expect.poll(() => page.evaluate(ids => bkmpPlayerDragonEggs.filter(e => ids.includes(e.id)).map(e => e.id + ':' + e.species_id).sort(), ids), { timeout: 15000 })
      .toEqual(newEggs.map(e => e.id + ':' + e.species_id).sort());
    expect(serverEggs()).toHaveLength(before + 2);
    await page.evaluate(() => bkmpEventTick(true));
    await openPass(page);
    await expect(page.locator('[data-testid="event-claim-btn"]')).toHaveCount(0);
  });

  test('Zwei Tabs holen gleichzeitig ab: genau ein Dayman-Ei', async ({ page, context, qaBaseURL, fixtureData, store }) => {
    test.setTimeout(90000);
    store.tables.special_events = [makeZwielichtEventRow(liveSchedule(store))];
    store.tables.dragon_species = ALL_SPECIES();
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await expect.poll(() => (store.tables.player_event_progress || []).length, { timeout: 15000 }).toBe(1);
    const page2 = await context.newPage();
    await page2.goto(page.url());
    await page2.evaluate(() => typeof bkmpIdleOpenModal === 'function' && bkmpIdleOpenModal());
    await waitForDragonReady(page2);
    await page2.evaluate(() => bkmpIdleStopLoop());
    const uid = fixtureData.authUserId;
    const before = store.tables.player_dragon_eggs.filter(e => e.auth_user_id === uid).length;
    store.tables.player_event_progress[0].points = 1000;
    await Promise.all([page.evaluate(() => bkmpEventTick(true)), page2.evaluate(() => bkmpEventTick(true))]);
    await Promise.all([page.evaluate(() => bkmpEventClaimTiers()), page2.evaluate(() => bkmpEventClaimTiers())]);
    const eggs = store.tables.player_dragon_eggs.filter(e => e.auth_user_id === uid);
    expect(eggs).toHaveLength(before + 1);
    expect(eggs.filter(e => e.species_id === 'dayman')).toHaveLength(1);
    const count = p => p.evaluate(() => bkmpPlayerDragonEggs.filter(e => e.species_id === 'dayman').length);
    expect((await count(page)) + (await count(page2))).toBe(1);
    expect(store.tables.player_event_progress[0].tier_claimed.filter(t => t === 10)).toHaveLength(1);
    await page2.close();
  });
});
