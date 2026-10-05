/* Event-Analyse im Admin-Panel (05.10.2026) - die SQL-Seite gegen ECHTES Postgres
   (PGlite, siehe tests/helpers/pg-event-harness.js). Getestet wird die echte Datei
   sql/20261005-event-admin-stats.sql, so wie sie im Supabase-SQL-Editor laeuft.

   Erwartungswerte sind in den Tests von HAND aus den Testdaten gerechnet (nicht aus
   der Ausgabe der Funktionen abgeleitet) - siehe Kommentare "von Hand".

   Reine Datenbank-Tests, kein Browser: laufen deshalb nur im Projekt chromium-desktop. */
const { test, expect } = require('@playwright/test');
const h = require('../helpers/pg-event-harness');
const f = require('../fixtures/event-admin-reference');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Reine SQL-Tests laufen nur einmal (chromium-desktop).');
});

const ADMIN_UID = f.uid(900);
const ADMIN_EMAIL = 'chef@bkmp-admin-accounts.com';
const ALL_FUNCTIONS = [
  ['admin_event_list', []],
  ['admin_event_overview', ['zwielicht']],
  ['admin_event_quests', ['zwielicht']],
  ['admin_event_timeline', ['zwielicht']],
  ['admin_event_players', ['zwielicht', '', 'points', 'desc', 25, 0]],
  ['admin_event_player_detail', ['zwielicht', f.uid(1)]]
];

async function freshWorld(scenario) {
  const db = await h.createEventDb();
  await h.seedScenario(db, scenario);
  const admin = await h.addAdminProfile(db, { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' });
  return { db, admin };
}
const msg = err => String((err && err.message) || err);

/* ============================================================
   Zugriff: wer darf was?
   ============================================================ */
test.describe('Zugriffsschutz - jede Funktion, jede Rolle', () => {
  let db, admin;
  test.beforeAll(async () => {
    ({ db, admin } = await freshWorld(f.makeZwielichtScenario(Date.now())));
    await h.addAdminProfile(db, { uid: f.uid(901), email: 'editor@bkmp-admin-accounts.com', role: 'editor' });
    await h.addAdminProfile(db, { uid: f.uid(902), email: 'mitarbeiter@bkmp-admin-accounts.com', role: 'expenses_editor' });
    await h.addAdminProfile(db, { uid: f.uid(903), email: 'schaf@bkmp-admin-accounts.com', role: 'sheep_editor' });
    await h.addAdminProfile(db, { uid: f.uid(904), email: 'firma@bkmp-admin-accounts.com', role: 'company' });
    await h.addAdminProfile(db, { uid: f.uid(905), email: 'gesperrt@bkmp-admin-accounts.com', role: 'admin', active: false });
  });

  test('Ausgeloggt (anon): keine einzige Funktion ausfuehrbar', async () => {
    for (const [fn, args] of ALL_FUNCTIONS) {
      await expect(h.rpc(db, null, fn, args), fn).rejects.toThrow(/permission denied|not_admin/i);
    }
  });

  test('Normaler Spieler (eingeloggt, aber kein Admin-Profil): not_admin bei jeder Funktion', async () => {
    const player = { sub: f.uid(1), email: 'alice@bkmp-player-accounts.com' };
    for (const [fn, args] of ALL_FUNCTIONS) {
      await expect(h.rpc(db, player, fn, args), fn).rejects.toThrow(/not_admin/);
    }
  });

  test('Eingeloggt ohne E-Mail-Claim: not_admin', async () => {
    for (const [fn, args] of ALL_FUNCTIONS) {
      await expect(h.rpc(db, { sub: f.uid(1) }, fn, args), fn).rejects.toThrow(/not_admin/);
    }
  });

  for (const [label, email] of [
    ['Mitarbeiter-Konto (expenses_editor)', 'mitarbeiter@bkmp-admin-accounts.com'],
    ['Schaf-Konto (sheep_editor)', 'schaf@bkmp-admin-accounts.com'],
    ['Firmen-Konto (company)', 'firma@bkmp-admin-accounts.com'],
    ['Gesperrtes Admin-Konto (active=false)', 'gesperrt@bkmp-admin-accounts.com']
  ]) {
    test(label + ': not_admin bei jeder Funktion', async () => {
      const uidFor = { 'mitarbeiter@bkmp-admin-accounts.com': 902, 'schaf@bkmp-admin-accounts.com': 903, 'firma@bkmp-admin-accounts.com': 904, 'gesperrt@bkmp-admin-accounts.com': 905 }[email];
      for (const [fn, args] of ALL_FUNCTIONS) {
        await expect(h.rpc(db, { sub: f.uid(uidFor), email }, fn, args), fn).rejects.toThrow(/not_admin/);
      }
    });
  }

  test('Admin und Redakteur (editor) duerfen alles lesen', async () => {
    for (const claims of [admin, { sub: f.uid(901), email: 'editor@bkmp-admin-accounts.com' }]) {
      for (const [fn, args] of ALL_FUNCTIONS) {
        const out = await h.rpc(db, claims, fn, args);
        expect(out, fn).not.toBeNull();
      }
    }
  });

  test('Rohe Tabellen bleiben fuer Spieler unlesbar (Protokoll + Meta), Funktionen sind security definer mit festem search_path', async () => {
    const player = { sub: f.uid(1), email: 'alice@bkmp-player-accounts.com' };
    await expect(h.callAs(db, player, 'select * from public.event_player_day_log')).rejects.toThrow(/permission denied/i);
    await expect(h.callAs(db, player, 'select * from public.event_admin_meta')).rejects.toThrow(/permission denied/i);
    await expect(h.callAs(db, null, 'select * from public.event_player_day_log')).rejects.toThrow(/permission denied/i);
    const procs = (await db.query(`
      select p.proname, p.prosecdef, p.proconfig::text as cfg,
             has_function_privilege('anon', p.oid, 'execute') as anon_exec,
             has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'admin_event_%'
       order by p.proname`)).rows;
    expect(procs.map(p => p.proname)).toEqual(['admin_event_list', 'admin_event_overview', 'admin_event_player_detail', 'admin_event_players', 'admin_event_quests', 'admin_event_timeline']);
    for (const p of procs) {
      expect(p.prosecdef, p.proname + ' security definer').toBe(true);
      expect(p.cfg, p.proname + ' search_path').toContain('search_path=public');
      expect(p.anon_exec, p.proname + ' anon darf nicht').toBe(false);
      expect(p.auth_exec, p.proname + ' authenticated darf (Pruefung steckt in der Funktion)').toBe(true);
    }
  });

  test('Es gibt in den Admin-Funktionen keine Schreibzugriffe auf Spielerdaten (Tabellen unveraendert nach allen Aufrufen)', async () => {
    const snap = async () => JSON.stringify({
      p: (await db.query('select * from public.player_event_progress order by auth_user_id')).rows,
      l: (await db.query('select * from public.event_player_day_log order by auth_user_id, day_key')).rows,
      e: (await db.query('select * from public.special_events order by id')).rows
    });
    const before = await snap();
    for (const [fn, args] of ALL_FUNCTIONS) await h.rpc(db, admin, fn, args);
    expect(await snap()).toBe(before);
  });
});

/* ============================================================
   Zahlen (Zwielicht, 10 Spieler) - von Hand gerechnet
   ============================================================ */
test.describe('Zwielicht-Szenario: exakte Zahlen', () => {
  let db, admin, sc;
  test.beforeAll(async () => {
    sc = f.makeZwielichtScenario(Date.now());
    ({ db, admin } = await freshWorld(sc));
  });

  test('Event-Liste: ein Event, LIVE, mit Kennzahlen fuer den Vergleich', async () => {
    const list = await h.rpc(db, admin, 'admin_event_list');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'zwielicht', status: 'LIVE', tier_count: 30, points_per_tier: 100, started: 10, active: 9, completed: 3, avg_tier: 17.22 });
  });

  test('Kopf: Stufenzahl, Punkte je Stufe, Punkte fuers Ziel, theoretisches Maximum, Restzeit - alles aus dem Event', async () => {
    const ov = await h.rpc(db, admin, 'admin_event_overview', ['zwielicht']);
    expect(ov.event).toMatchObject({ id: 'zwielicht', status: 'LIVE', tier_count: 30, points_per_tier: 100, points_to_finish: 3000, choice_mode: 'player_choice', reward_species: ['lightnix', 'darknix'] });
    // von Hand: 7 Tage x (4x40 + 90 + 100 Tagesabschluss = 350) = 2450 + Wochenquests
    // (w_kills 180 + w_bosses 130 + w_active 180 + w_dungeons 130 + w_tower 130 + w_runes 130 + w_feed 130 + w_exp 130 = 1140) = 3590
    expect(ov.event.theoretical_max_points).toBe(3590);
    expect(ov.event.remaining_seconds).toBeGreaterThan(0);
    expect(ov.event.tier_rewards).toHaveLength(30);
    expect(Object.keys(ov.event.choices).sort()).toEqual(['darknix', 'lightnix']);
  });

  test('KPIs: Teilnehmer gestartet/aktiv, Durchschnitt, Median, Abschluss, hoechste Stufe, heute aktiv', async () => {
    const { kpis } = await h.rpc(db, admin, 'admin_event_overview', ['zwielicht']);
    // von Hand: Stufen der aktiven (Punkte>0): 30,30,20,20,15,9,1,0,30 -> Summe 155 / 9 = 17,22; sortiert 0,1,9,15,20,20,30,30,30 -> Median 20
    expect(kpis.started).toBe(10);          // Ida (0 Punkte) zaehlt als gestartet ...
    expect(kpis.active).toBe(9);            // ... aber nicht als aktiv
    expect(kpis.avg_tier).toBeCloseTo(17.22, 2);
    expect(kpis.median_tier).toBe(20);
    expect(kpis.completed).toBe(3);         // Alice, Bob, Jan
    expect(kpis.max_tier).toBe(30);
    expect(kpis.total_points).toBe(15650);
    expect(kpis.active_today).toBe(7);      // Alice, Bob, Cara, Eli, Gina, Hugo, Ida haben heute (Berliner Tag) das Event geoeffnet
  });

  test('Stufenverteilung: 31 Balken (Stufe 0-30), nur aktive Teilnehmer, Lücken mit 0', async () => {
    const { histogram } = await h.rpc(db, admin, 'admin_event_overview', ['zwielicht']);
    expect(histogram).toHaveLength(31);
    const nonZero = Object.fromEntries(histogram.filter(x => x.count > 0).map(x => [x.tier, x.count]));
    expect(nonZero).toEqual({ 0: 1, 1: 1, 9: 1, 15: 1, 20: 2, 30: 3 });
    expect(histogram.reduce((s, x) => s + x.count, 0)).toBe(9);
  });

  test('Belohnungsanalyse: je Stufe erreicht vs. tatsaechlich abgeholt (unterschiedlich!)', async () => {
    const { tiers } = await h.rpc(db, admin, 'admin_event_overview', ['zwielicht']);
    expect(tiers).toHaveLength(30);
    const at = t => tiers.find(x => x.tier === t);
    // von Hand: erreicht = aktive mit Stufe >= t; abgeholt = Spieler mit t in tier_claimed
    expect(at(1)).toMatchObject({ reached: 8, claimed: 8 });
    expect(at(9)).toMatchObject({ reached: 7, claimed: 6 });     // Finn (Stufe 9) hat nur 1-3 abgeholt
    expect(at(10)).toMatchObject({ reached: 6, claimed: 6 });    // Dayman-Stufe
    expect(at(20)).toMatchObject({ reached: 5, claimed: 4 });    // Surebrec-Stufe: Dan hat nur bis 10 abgeholt
    expect(at(30)).toMatchObject({ reached: 3, claimed: 2 });    // Bob hat Stufe 30 noch nicht abgeholt
  });

  test('Auswahl-Belohnung: Lightnix/Darknix, Entscheidung offen - generisch aus der Event-Konfiguration', async () => {
    const { choice } = await h.rpc(db, admin, 'admin_event_overview', ['zwielicht']);
    expect(choice.enabled).toBe(true);
    expect(choice.species).toEqual([{ id: 'lightnix', name: 'Lightnix', count: 1 }, { id: 'darknix', name: 'Darknix', count: 1 }]);
    expect(choice.earned).toBe(3);
    expect(choice.open).toBe(1);            // Bob: Stufe 30 erreicht, noch nicht gewaehlt
  });

  test('Daily-Analyse: vergeben/abgeschlossen je Quest (Tagesprotokoll + laufender Tag), schwere Quest getrennt, Tagesabschluss', async () => {
    const q = await h.rpc(db, admin, 'admin_event_quests', ['zwielicht']);
    const d = id => q.daily.find(x => x.id === id);
    // von Hand aus den Protokollzeilen (5) + den laufenden Tagen (10):
    expect(d('d_kills')).toMatchObject({ kind: 'normal', assigned: 15, completed: 9, today_assigned: 7, today_completed: 3 });
    expect(d('d_bosses')).toMatchObject({ kind: 'normal', assigned: 12, completed: 5, today_assigned: 5, today_completed: 2 });
    expect(d('d_active')).toMatchObject({ kind: 'normal', assigned: 11, completed: 6, today_assigned: 5, today_completed: 3 });
    expect(d('d_dungeons')).toMatchObject({ kind: 'normal', assigned: 11, completed: 3, today_assigned: 5, today_completed: 1 });
    expect(d('h_kills')).toMatchObject({ kind: 'hard', assigned: 6, completed: 2, today_assigned: 4, today_completed: 1 });
    expect(q.closure).toEqual({ assigned: 15, completed: 3 });
    expect(q.defs.daily_normal.map(x => x.id)).toContain('d_kills');
    expect(q.defs.daily_hard.map(x => x.id)).toContain('h_kills');
  });

  test('Wochenquests: Spieler mit Quest, jede Stufe einzeln, vollstaendig abgeschlossen', async () => {
    const q = await h.rpc(db, admin, 'admin_event_quests', ['zwielicht']);
    const w = id => q.weekly.find(x => x.id === id);
    // von Hand aus weekly_done: w_kills -> Alice 3, Bob 2, Cara 1, Eli 1, Jan 3 (Finn/Gina/Hugo/Ida 0)
    expect(w('w_kills')).toMatchObject({ players: 9, stage_count: 3, stages: [5, 3, 2], completed: 2 });
    expect(w('w_bosses')).toMatchObject({ players: 3, stage_count: 3, stages: [2, 2, 1], completed: 1 });
    expect(w('w_runes')).toMatchObject({ players: 1, stages: [1, 0, 0], completed: 0 });
    expect(w('w_world')).toMatchObject({ players: 1, stages: [1, 1, 1], completed: 1 });
  });

  test('Tagesentwicklung: neue Teilnehmer, aktive, Abschluesse, Auswahlen, Punkte und Durchschnittsstufe je Berliner Tag', async () => {
    const t = await h.rpc(db, admin, 'admin_event_timeline', ['zwielicht']);
    expect(t.days.map(x => x.day)).toEqual([sc.days.d1, sc.days.d2, sc.days.d3]);
    const [a, b, c] = t.days;
    // von Hand (siehe Fixture): Tag 1
    expect(a).toMatchObject({ new_participants: 4, active: 3, completed: 1, choices: 1, with_points: 3, total_points: 1200 });
    expect(a.avg_tier).toBeCloseTo(4, 2);
    expect(b).toMatchObject({ new_participants: 2, active: 5, completed: 1, choices: 1, with_points: 5, total_points: 10550 });
    expect(b.avg_tier).toBeCloseTo(21, 2);
    expect(c).toMatchObject({ new_participants: 3, active: 7, completed: 1, choices: 0, with_points: 9, total_points: 15650 });
    expect(c.avg_tier).toBeCloseTo(17.22, 2);
    expect(t.unknown_join_count).toBe(1);   // Jan: Beitrittstag unbekannt - wird NICHT geraten
    expect(t.stats_since_day).toBe(sc.days.d3);
    expect(t.days.map(x => x.tracked)).toEqual([false, false, true]);   // vor dem Installationstag: nicht als vollstaendig gekennzeichnet
  });

  test('Spielertabelle: Suche, Sortierung, Seiten, Status', async () => {
    const page = (search, sort, dir, limit, offset) => h.rpc(db, admin, 'admin_event_players', ['zwielicht', search, sort, dir, limit, offset]);
    let r = await page('', 'points', 'desc', 25, 0);
    expect(r.total).toBe(10);
    expect(r.rows.map(x => x.name)).toEqual(['Bob', 'Alice', 'Jan', 'Cara', 'Dan', 'Eli', 'Finn', 'Gina', 'Hugo', 'Ida']);
    expect(r.rows[0]).toMatchObject({ name: 'Bob', points: 3050, tier: 30, status: 'completed', max_claimed: 29, choice_species: null });
    // Name aufsteigend
    r = await page('', 'name', 'asc', 25, 0);
    expect(r.rows.map(x => x.name)).toEqual(['Alice', 'Bob', 'Cara', 'Dan', 'Eli', 'Finn', 'Gina', 'Hugo', 'Ida', 'Jan']);
    // Seiten
    r = await page('', 'name', 'asc', 3, 3);
    expect(r.total).toBe(10);
    expect(r.rows.map(x => x.name)).toEqual(['Dan', 'Eli', 'Finn']);
    // Suche: Anzeigename und name_key, Gross/Klein egal
    expect((await page('ALI', 'name', 'asc', 25, 0)).rows.map(x => x.name)).toEqual(['Alice']);
    expect((await page('jan', 'name', 'asc', 25, 0)).rows.map(x => x.name)).toEqual(['Jan']);
    // Platzhalterzeichen der Suche werden als normale Zeichen behandelt, nicht als Muster
    expect((await page('%', 'name', 'asc', 25, 0)).total).toBe(0);
    expect((await page('_', 'name', 'asc', 25, 0)).total).toBe(0);
    // unbekannte Sortierung faellt auf Punkte zurueck, Seitengroesse wird begrenzt
    expect((await page('', 'DROP TABLE x', 'sideways', 25, 0)).rows[0].name).toBe('Bob');
    expect((await page('', 'points', 'desc', 100000, 0)).rows).toHaveLength(10);
    expect((await page('', 'points', 'desc', 0, 0)).rows).toHaveLength(1);
    // letzte Aktivitaet: sieben heute Online-Gewesene zuerst (gleiche Zeit -> Name), dann die drei von gestern
    r = await page('', 'last', 'desc', 25, 0);
    expect(r.rows.map(x => x.name)).toEqual(['Alice', 'Bob', 'Cara', 'Eli', 'Gina', 'Hugo', 'Ida', 'Dan', 'Finn', 'Jan']);
    // hoechste abgeholte Stufe aufsteigend: Spieler ohne Abholung zuerst
    r = await page('', 'claimed', 'asc', 25, 0);
    expect(r.rows.slice(0, 3).map(x => x.name)).toEqual(['Hugo', 'Ida', 'Gina']);
    // Status
    r = await page('', 'name', 'asc', 25, 0);
    const st = Object.fromEntries(r.rows.map(x => [x.name, x.status]));
    expect(st).toMatchObject({ Alice: 'completed', Cara: 'active_today', Dan: 'inactive', Hugo: 'active_today', Ida: 'started', Jan: 'completed' });
  });

  test('Spielertabelle: Daily/Weekly-Zaehler je Spieler', async () => {
    const r = await h.rpc(db, admin, 'admin_event_players', ['zwielicht', '', 'name', 'asc', 25, 0]);
    const by = Object.fromEntries(r.rows.map(x => [x.name, x]));
    // von Hand: Alice live 5 + Protokoll (5 + 4) = 14; Cara live 3 + 1 + 2 = 6; Dan live 1 + 1 = 2; Bob 1
    expect(by.Alice).toMatchObject({ daily_done: 14, today_done: 5, today_total: 5, weekly_done: 6, weekly_total: 6 });
    expect(by.Cara).toMatchObject({ daily_done: 6, today_done: 3, today_total: 5 });
    expect(by.Dan).toMatchObject({ daily_done: 2, today_done: null, today_total: null });
    expect(by.Bob).toMatchObject({ daily_done: 1, weekly_done: 3, weekly_total: 6 });
  });

  test('Spieler-Detail: Fortschritt, Quests, Wochenstufen, Protokoll - und unbekannter Spieler', async () => {
    const d = await h.rpc(db, admin, 'admin_event_player_detail', ['zwielicht', f.uid(1)]);
    expect(d).toMatchObject({ found: true, name: 'Alice', points: 3000, tier: 30, tier_count: 30, earned: true, choice_species: 'lightnix', is_today: true });
    expect(d.tier_claimed).toHaveLength(30);
    expect(d.day_quests).toHaveLength(5);
    expect(d.weekly_done).toEqual({ w_kills: 3, w_bosses: 3 });
    expect(d.history.map(x => [x.day, x.done, x.total, x.closure_done, x.points_end])).toEqual([[sc.days.d1, 5, 5, true, 400], [sc.days.d2, 4, 5, true, 2900]]);
    expect(await h.rpc(db, admin, 'admin_event_player_detail', ['zwielicht', f.uid(555)])).toEqual({ found: false });
    await expect(h.rpc(db, admin, 'admin_event_overview', ['gibt-es-nicht'])).rejects.toThrow(/invalid_event/);
  });
});

/* ============================================================
   Event-Status, leere/kleine Events
   ============================================================ */
test.describe('Event-Status und Randfaelle', () => {
  const HOUR = 3600 * 1000;
  async function statusWorld(patch) {
    const sc = f.makeZwielichtScenario(Date.now());
    Object.assign(sc.event, patch);
    return freshWorld(sc);
  }

  test('LIVE / COMING_SOON / ENDED / ARCHIVED / HIDDEN - Status und zeitabhaengige Felder', async () => {
    const now = Date.now();
    const cases = [
      ['LIVE', {}, true],
      ['COMING_SOON', { announce_at: new Date(now - HOUR).toISOString(), starts_at: new Date(now + 24 * HOUR).toISOString(), ends_at: new Date(now + 8 * 24 * HOUR).toISOString() }, false],
      ['ENDED', { announce_at: new Date(now - 10 * 24 * HOUR).toISOString(), starts_at: new Date(now - 9 * 24 * HOUR).toISOString(), ends_at: new Date(now - 2 * 24 * HOUR).toISOString() }, false],
      ['ARCHIVED', { archived: true }, false],
      ['HIDDEN', { enabled: false }, false]
    ];
    for (const [expected, patch, live] of cases) {
      const { db, admin } = await statusWorld(patch);
      const ov = await h.rpc(db, admin, 'admin_event_overview', ['zwielicht']);
      expect(ov.event.status, expected).toBe(expected);
      expect((await h.rpc(db, admin, 'admin_event_list'))[0].status, 'Liste ' + expected).toBe(expected);
      // "heute aktiv" und "Restzeit" gibt es nur bei einem laufenden Event - sonst NICHT raten
      if (live) { expect(ov.kpis.active_today).toBe(7); expect(ov.event.remaining_seconds).toBeGreaterThan(0); }
      else { expect(ov.kpis.active_today, expected).toBeNull(); expect(ov.event.remaining_seconds, expected).toBeNull(); }
      // beendete/archivierte Events bleiben vollstaendig auswertbar (Event-Archiv)
      expect(ov.kpis.started, expected).toBe(10);
      expect(ov.kpis.completed, expected).toBe(3);
      expect(ov.choice.species.map(s => s.count), expected).toEqual([1, 1]);
      await db.close();
    }
  });

  test('0 Teilnehmer: alles 0/leer, keine Fehler, kein Teilen durch 0', async () => {
    const sc = f.makeZwielichtScenario(Date.now());
    sc.players = []; sc.log = []; sc.stats = [];
    const { db, admin } = await freshWorld(sc);
    const ov = await h.rpc(db, admin, 'admin_event_overview', ['zwielicht']);
    expect(ov.kpis).toMatchObject({ started: 0, active: 0, avg_tier: null, median_tier: null, completed: 0, max_tier: 0, total_points: 0, active_today: 0 });
    expect(ov.histogram).toHaveLength(31);
    expect(ov.histogram.every(x => x.count === 0)).toBe(true);
    expect(ov.tiers.every(x => x.reached === 0 && x.claimed === 0)).toBe(true);
    expect(ov.choice).toMatchObject({ enabled: true, earned: 0, open: 0 });
    const q = await h.rpc(db, admin, 'admin_event_quests', ['zwielicht']);
    expect(q).toMatchObject({ daily: [], weekly: [], closure: { assigned: 0, completed: 0 } });
    const t = await h.rpc(db, admin, 'admin_event_timeline', ['zwielicht']);
    expect(t.days).toHaveLength(3);
    expect(t.days.every(x => x.active === 0 && x.total_points === 0 && x.avg_tier === null)).toBe(true);
    expect(await h.rpc(db, admin, 'admin_event_players', ['zwielicht', '', 'points', 'desc', 25, 0])).toEqual({ total: 0, rows: [] });
    await db.close();
  });

  test('Genau 1 Teilnehmer: Durchschnitt = Median = seine Stufe', async () => {
    const sc = f.makeZwielichtScenario(Date.now());
    sc.players = [sc.players[2]]; sc.log = []; sc.stats = [sc.stats[2]];     // Cara, Stufe 20
    const { db, admin } = await freshWorld(sc);
    const { kpis, histogram } = await h.rpc(db, admin, 'admin_event_overview', ['zwielicht']);
    expect(kpis).toMatchObject({ started: 1, active: 1, avg_tier: 20, median_tier: 20, completed: 0, max_tier: 20, total_points: 2000 });
    expect(histogram.find(x => x.tier === 20).count).toBe(1);
    await db.close();
  });

  test('Median bei gerader Anzahl = Mitte zwischen den beiden mittleren (percentile_cont)', async () => {
    const sc = f.makeZwielichtScenario(Date.now());
    sc.players = sc.players.filter(p => ['Cara', 'Eli'].includes(p.name_key.replace(/^./, c => c.toUpperCase())));   // Stufe 20 + 15
    sc.log = [];
    const { db, admin } = await freshWorld(sc);
    const { kpis } = await h.rpc(db, admin, 'admin_event_overview', ['zwielicht']);
    expect(kpis).toMatchObject({ active: 2, avg_tier: 17.5, median_tier: 17.5 });
    await db.close();
  });

  test('Ein ganz anderes Event (12 Stufen, 250 Punkte je Stufe, drei Auswahl-Arten): nichts ist auf Zwielicht/30 festgelegt', async () => {
    const sc = f.makeCustomEventScenario(Date.now());
    const db = await h.createEventDb();
    await h.seedScenario(db, sc);
    const admin = await h.addAdminProfile(db, { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' });
    const ov = await h.rpc(db, admin, 'admin_event_overview', ['frostfest']);
    expect(ov.event).toMatchObject({ status: 'ENDED', tier_count: 12, points_per_tier: 250, points_to_finish: 3000 });
    // von Hand: 3 Tage x (2x60 + 150 + 80 Abschluss = 350) = 1050 + Wochenquest 100+120 = 1270
    expect(ov.event.theoretical_max_points).toBe(1270);
    // Stufen: Ann 12 (3000/250), Ben 12 (3300 -> gedeckelt), Cleo 8, Dirk 2, Emma 12
    expect(ov.kpis).toMatchObject({ started: 5, active: 5, completed: 3, max_tier: 12, avg_tier: 9.2, median_tier: 12, total_points: 11900 });
    expect(ov.histogram).toHaveLength(13);
    expect(Object.fromEntries(ov.histogram.filter(x => x.count).map(x => [x.tier, x.count]))).toEqual({ 2: 1, 8: 1, 12: 3 });
    expect(ov.tiers).toHaveLength(12);
    expect(ov.tiers.find(x => x.tier === 4)).toMatchObject({ reached: 4, claimed: 4 });
    expect(ov.tiers.find(x => x.tier === 12)).toMatchObject({ reached: 3, claimed: 1 });
    // Auswahl zwischen DREI Arten, Namen aus der Konfiguration (Arten-Namen aus dragon_species)
    expect(ov.choice.species).toEqual([{ id: 'aaa', name: 'Aaa', count: 1 }, { id: 'bbb', name: 'Bbb', count: 0 }, { id: 'ccc', name: 'Ccc', count: 1 }]);
    expect(ov.choice).toMatchObject({ earned: 3, open: 1 });
    expect(ov.event.tier_rewards.map(t => t.tier)).toEqual([1, 4, 8, 12]);
    const q = await h.rpc(db, admin, 'admin_event_quests', ['frostfest']);
    const d = id => q.daily.find(x => x.id === id);
    expect(d('c_a')).toMatchObject({ kind: 'normal', assigned: 5, completed: 4 });
    expect(d('c_b')).toMatchObject({ kind: 'normal', assigned: 4, completed: 1 });
    expect(d('c_h')).toMatchObject({ kind: 'hard', assigned: 2, completed: 1 });
    expect(q.closure).toEqual({ assigned: 5, completed: 1 });
    expect(q.weekly).toEqual([{ id: 'cw_x', players: 5, stage_count: 2, completed: 2, stages: [3, 2] }]);
    expect(q.defs.daily_normal.map(x => x.name)).toEqual(['Alpha-Aufgabe', 'Beta-Aufgabe']);
    const t = await h.rpc(db, admin, 'admin_event_timeline', ['frostfest']);
    expect(t.days).toHaveLength(3);                       // beendetes Event: nur die Tage des Events
    expect(t.days.map(x => x.new_participants)).toEqual([3, 1, 1]);
    expect(t.days.map(x => x.completed)).toEqual([0, 2, 1]);
    expect(t.days.map(x => x.choices)).toEqual([0, 2, 0]);
    // Event ohne Auswahl-Belohnung: Bereich aus
    await db.query("update public.special_events set choice_mode = 'none' where id = 'frostfest'");
    expect((await h.rpc(db, admin, 'admin_event_overview', ['frostfest'])).choice).toEqual({ enabled: false });
    await db.close();
  });
});

/* ============================================================
   Zeitzone: Berliner Tageswechsel, Sommer-/Winterzeit
   ============================================================ */
test.describe('Zeitzone Europe/Berlin - Tagesgrenzen', () => {
  test('Abschluesse/Auswahlen landen am richtigen BERLINER Tag (23:59:59 vs. 00:00:00, Winter- und Sommerzeit)', async () => {
    // Beendetes Event ueber die Zeitumstellung 29.03.2026 (Berlin: 02:00 -> 03:00).
    const event = { id: 'dst', name: 'DST', subtitle: '', description: '', lore: '', announce_at: '2026-03-20T00:00:00Z',
      starts_at: '2026-03-26T23:00:00Z', ends_at: '2026-04-02T21:59:00Z', timezone: 'Europe/Berlin', enabled: true, archived: false,
      tier_count: 30, points_per_tier: 100, config: {}, reward_group: 'dst', lifetime_claim_limit: 1, choice_mode: 'none', reward_species: [], assets: {} };
    const mk = (n, earnedUtc) => ({ event_id: 'dst', auth_user_id: f.uid(n), name_key: 'p' + n, points: 3000, earned: true, earned_at: earnedUtc,
      chosen_at: null, cumulative: {}, last_metrics: {}, day_base: {}, day_quests: [], day_client: {}, weekly_quests: [], weekly_done: {}, tier_claimed: [], unlocks: [], joined_day: '2026-03-27' });
    const players = [
      mk(1, '2026-03-28T22:59:59Z'),   // 23:59:59 MEZ am 28.03.  -> 28.03.
      mk(2, '2026-03-28T23:00:00Z'),   // 00:00:00 MEZ am 29.03.  -> 29.03.
      mk(3, '2026-04-01T21:59:59Z'),   // 23:59:59 MESZ am 01.04. -> 01.04.
      mk(4, '2026-04-01T22:00:00Z')    // 00:00:00 MESZ am 02.04. -> 02.04.
    ];
    const db = await h.createEventDb();
    await h.insertRows(db, 'special_events', [event]);
    await h.insertRows(db, 'player_event_progress', players);
    const admin = await h.addAdminProfile(db, { uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' });
    const t = await h.rpc(db, admin, 'admin_event_timeline', ['dst']);
    expect(t.days.map(x => x.day)).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02']);
    expect(Object.fromEntries(t.days.map(x => [x.day, x.completed]))).toEqual({
      '2026-03-27': 0, '2026-03-28': 1, '2026-03-29': 1, '2026-03-30': 0, '2026-03-31': 0, '2026-04-01': 1, '2026-04-02': 1 });
    await db.close();
  });

  test('Spalten-Default joined_day = Berliner Tag von jetzt (nicht der UTC-Tag)', async () => {
    const sc = f.makeZwielichtScenario(Date.now());
    const { db } = await freshWorld(sc);
    await db.query(`insert into public.player_event_progress (event_id, auth_user_id, name_key) values ('zwielicht', $1, 'neu')`, [f.uid(777)]);
    const row = (await db.query(`select joined_day::text as d, public.village_berlin_today()::text as berlin,
      (now() at time zone 'Europe/Berlin')::date::text as expected from public.player_event_progress where auth_user_id = $1`, [f.uid(777)])).rows[0];
    expect(row.d).toBe(row.berlin);
    expect(row.d).toBe(row.expected);
    await db.close();
  });
});

/* ============================================================
   Installation: idempotent, Nachtrag nur wo sicher, Trigger
   ============================================================ */
test.describe('Installation und Tageswechsel-Protokoll', () => {
  test('Mehrfach ausfuehren ist unschaedlich (Daten bleiben, keine Fehler)', async () => {
    const { db, admin } = await freshWorld(f.makeZwielichtScenario(Date.now()));
    const before = await h.rpc(db, admin, 'admin_event_overview', ['zwielicht']);
    const logCount = (await db.query('select count(*)::int as c from public.event_player_day_log')).rows[0].c;
    await h.installEventAdminStats(db);
    await h.installEventAdminStats(db);
    expect((await db.query('select count(*)::int as c from public.event_player_day_log')).rows[0].c).toBe(logCount);
    const after = await h.rpc(db, admin, 'admin_event_overview', ['zwielicht']);
    expect(after.kpis).toEqual(before.kpis);
    expect((await db.query('select count(*)::int as c from public.event_admin_meta')).rows[0].c).toBe(1);
    await db.close();
  });

  test('Nachtrag joined_day: nur Spieler, deren aktueller Tag noch der erste Eventtag ist (sicher), alle anderen bleiben leer', async () => {
    const db = await h.createEventDb({ install: false });     // Datenbank VOR der Installation, mit schon vorhandenen Spielern
    const sc = f.makeZwielichtScenario(Date.now());
    await h.insertRows(db, 'special_events', [sc.event]);
    const base = r => ({ event_id: 'zwielicht', auth_user_id: r.uid, name_key: r.name, points: 100, day_key: r.day });
    const sqlInsert = async rows => { for (const r of rows) await db.query(
      `insert into public.player_event_progress (event_id, auth_user_id, name_key, points, day_key) values ($1,$2,$3,$4,$5)`,
      [r.event_id, r.auth_user_id, r.name_key, r.points, r.day_key]); };
    await sqlInsert([base({ uid: f.uid(1), name: 'erster', day: sc.days.d1 }), base({ uid: f.uid(2), name: 'spaeter', day: sc.days.d3 }), base({ uid: f.uid(3), name: 'ohne', day: null })]);
    await h.installEventAdminStats(db);
    const rows = Object.fromEntries((await db.query('select name_key, joined_day::text as d from public.player_event_progress')).rows.map(r => [r.name_key, r.d]));
    expect(rows).toEqual({ erster: sc.days.d1, spaeter: null, ohne: null });
    await db.close();
  });

  test('Trigger: Tageswechsel sichert den alten Tag (Quests, Abschluss, Punktestand) - sonst nichts', async () => {
    const sc = f.makeZwielichtScenario(Date.now());
    sc.players = []; sc.log = []; sc.stats = [];
    const { db } = await freshWorld(sc);
    const { d1, d2, d3 } = sc.days;
    const quests = [{ id: 'd_kills', metric: 'kills', kind: 'normal', target: 1500, points: 40, done: true }, { id: 'd_bosses', metric: 'bosses', kind: 'normal', target: 15, points: 40, done: false }];
    await h.insertRows(db, 'player_event_progress', [{ event_id: 'zwielicht', auth_user_id: f.uid(1), name_key: 'a', points: 80, day_key: null,
      day_quests: [], day_closure_done: false, cumulative: {}, last_metrics: {}, day_base: {}, day_client: {}, weekly_quests: [], weekly_done: {}, tier_claimed: [], unlocks: [] }]);
    const log = async () => (await db.query('select day_key::text as d, closure_done, points_end, quests from public.event_player_day_log order by day_key')).rows;
    // erster Tick: null -> Tag 1 ist KEIN Tageswechsel
    await db.query(`update public.player_event_progress set day_key = $1, day_quests = $2::jsonb where auth_user_id = $3`, [d1, JSON.stringify(quests), f.uid(1)]);
    expect(await log()).toEqual([]);
    // gleicher Tag, Punkte aendern sich: kein Protokoll
    await db.query(`update public.player_event_progress set day_key = $1, points = 120 where auth_user_id = $2`, [d1, f.uid(1)]);
    await db.query(`update public.player_event_progress set points = 160, updated_at = now() where auth_user_id = $1`, [f.uid(1)]);
    expect(await log()).toEqual([]);
    // Tageswechsel Tag 1 -> Tag 2: der alte Tag wird gesichert (mit Punktestand VOR dem Wechsel)
    await db.query(`update public.player_event_progress set day_key = $1, points = 260, day_closure_done = false, day_quests = '[]'::jsonb where auth_user_id = $2`, [d2, f.uid(1)]);
    let rows = await log();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ d: d1, closure_done: false, points_end: 160 });
    expect(rows[0].quests).toEqual(quests);
    // Tageswechsel Tag 2 -> Tag 3
    await db.query(`update public.player_event_progress set day_key = $1, points = 400 where auth_user_id = $2`, [d3, f.uid(1)]);
    rows = await log();
    expect(rows.map(r => [r.d, r.points_end])).toEqual([[d1, 160], [d2, 260]]);
    // dieselbe Zeile erneut auf denselben Tag setzen: nichts doppelt
    await db.query(`update public.player_event_progress set day_key = $1 where auth_user_id = $2`, [d3, f.uid(1)]);
    expect(await log()).toHaveLength(2);
    // Loeschen des Events raeumt das Protokoll mit auf
    await db.query(`delete from public.special_events where id = 'zwielicht'`);
    expect(await log()).toEqual([]);
    await db.close();
  });

  test('Trigger-Fehler blockieren NIE den Event-Tick (reine Statistik darf den Spielstand nicht gefaehrden)', async () => {
    const sc = f.makeZwielichtScenario(Date.now());
    sc.players = []; sc.log = []; sc.stats = [];
    const { db } = await freshWorld(sc);
    await h.insertRows(db, 'player_event_progress', [{ event_id: 'zwielicht', auth_user_id: f.uid(1), name_key: 'a', points: 10, day_key: sc.days.d1,
      day_quests: [], day_closure_done: false, cumulative: {}, last_metrics: {}, day_base: {}, day_client: {}, weekly_quests: [], weekly_done: {}, tier_claimed: [], unlocks: [] }]);
    // Protokoll-Einfuegen kuenstlich unmoeglich machen
    await db.query('alter table public.event_player_day_log add constraint kaputt check (points_end < 0)');
    await db.query(`update public.player_event_progress set day_key = $1, points = 50 where auth_user_id = $2`, [sc.days.d2, f.uid(1)]);
    const row = (await db.query('select day_key::text as d, points from public.player_event_progress')).rows[0];
    expect(row).toMatchObject({ d: sc.days.d2, points: 50 });                        // Tick-Update wurde NICHT zurueckgerollt
    expect((await db.query('select count(*)::int as c from public.event_player_day_log')).rows[0].c).toBe(0);
    await db.close();
  });

  test('Protokoll fuer Tageswechsel mitten im Event liefert danach echte Tagesdaten in Quest-Analyse und Verlauf', async () => {
    const sc = f.makeZwielichtScenario(Date.now());
    sc.players = []; sc.log = []; sc.stats = [];
    const { db, admin } = await freshWorld(sc);
    const q1 = [{ id: 'd_kills', metric: 'kills', kind: 'normal', target: 1500, points: 40, done: true }];
    const q2 = [{ id: 'd_kills', metric: 'kills', kind: 'normal', target: 1500, points: 40, done: false }];
    await h.insertRows(db, 'player_event_progress', [{ event_id: 'zwielicht', auth_user_id: f.uid(1), name_key: 'a', points: 40, day_key: sc.days.d1, day_quests: q1,
      day_closure_done: false, cumulative: {}, last_metrics: {}, day_base: {}, day_client: {}, weekly_quests: [], weekly_done: {}, tier_claimed: [], unlocks: [] }]);
    await db.query(`update public.player_event_progress set day_key = $1, day_quests = $2::jsonb, points = 40 where auth_user_id = $3`, [sc.days.d2, JSON.stringify(q2), f.uid(1)]);
    const q = await h.rpc(db, admin, 'admin_event_quests', ['zwielicht']);
    expect(q.daily).toEqual([{ id: 'd_kills', kind: 'normal', assigned: 2, completed: 1, today_assigned: 0, today_completed: 0 }]);
    const t = await h.rpc(db, admin, 'admin_event_timeline', ['zwielicht']);
    expect(t.days.map(x => x.active)).toEqual([1, 1, 0]);                             // aktiv an Tag 1 (Protokoll) und Tag 2 (laufend)
    await db.close();
  });
});

/* ============================================================
   Leistung: grosse Teilnehmerzahl
   ============================================================ */
test.describe('Leistung bei sehr vielen Teilnehmern', () => {
  test('20.000 Teilnehmer: alle Auswertungen laufen serverseitig aggregiert in vertretbarer Zeit', async () => {
    const sc = f.makeZwielichtScenario(Date.now());
    sc.players = []; sc.log = []; sc.stats = [];
    const { db, admin } = await freshWorld(sc);
    const bulk = f.makeBulkPlayers(20000, 'zwielicht', Date.now());
    const tSeed = Date.now();
    await h.insertRows(db, 'player_stats', bulk.stats);
    await h.insertRows(db, 'player_event_progress', bulk.players);
    await h.insertRows(db, 'event_player_day_log', bulk.log);
    const timings = { seed: Date.now() - tSeed };
    const time = async (label, fn, args) => { const t0 = Date.now(); const out = await h.rpc(db, admin, fn, args); timings[label] = Date.now() - t0; return out; };

    const ov = await time('overview', 'admin_event_overview', ['zwielicht']);
    expect(ov.kpis.started).toBe(20000);
    expect(ov.histogram.reduce((s, x) => s + x.count, 0)).toBe(ov.kpis.active);
    expect(ov.kpis.completed).toBe(ov.histogram[30].count);
    const q = await time('quests', 'admin_event_quests', ['zwielicht']);
    expect(q.daily.find(x => x.id === 'd_kills').assigned).toBe(20000 + bulk.log.length);
    const tl = await time('timeline', 'admin_event_timeline', ['zwielicht']);
    expect(tl.days).toHaveLength(3);
    const pl = await time('players', 'admin_event_players', ['zwielicht', '', 'points', 'desc', 25, 0]);
    expect(pl.total).toBe(20000);
    expect(pl.rows).toHaveLength(25);
    const pl2 = await time('players-search', 'admin_event_players', ['zwielicht', 'spieler0199', 'name', 'asc', 25, 0]);
    expect(pl2.total).toBe(10);
    await time('detail', 'admin_event_player_detail', ['zwielicht', f.uid(1000)]);
    await time('list', 'admin_event_list');

    test.info().annotations.push({ type: 'timings (ms, PGlite/WASM - echtes Postgres ist deutlich schneller)', description: JSON.stringify(timings) });
    // Grosszuegige Grenzen (WASM ist viel langsamer als ein echter Server): faengt ein versehentlich quadratisches Verhalten ab.
    for (const k of ['overview', 'quests', 'timeline', 'players', 'players-search']) expect(timings[k], k + ' ' + JSON.stringify(timings)).toBeLessThan(20000);
    expect(timings.detail).toBeLessThan(3000);
    expect(timings.list).toBeLessThan(5000);
    await db.close();
  });
});
