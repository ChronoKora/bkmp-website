/* Anti-Cheat Stufe 1: Wirtschafts-Pruefung - sql/20261007-anticheat-economy-guard.sql (07.10.2026).

   Anlass: Ein Spieler hat in der Browser-Konsole ("Command Panel") direkt Gold/Ressourcen gesetzt
   (+95 Mio., 1e15). Der Browser schickt bei jedem Speichern den ganzen Stand; die Datenbank pruefte
   bisher nur Kills/Level/Skillpunkte/Kampfwerte. Dieser Test fuehrt die ECHTEN SQL-Dateien (die
   komplette alte Anti-Cheat-Kette UND die neue Datei) gegen echtes Postgres (PGlite) aus.

   Geprueft wird zweierlei, gleich wichtig:
     * LEGITIME Speicherungen (Kampf, Dungeon-Klumpen, Gebaeude-Nachtrag, Level-Aufstieg, Prestige,
       Ausgeben) werden nie gemeldet und nie veraendert - auch im scharfen Modus. Das ist die Lehre vom
       11.08.2026, als eine zu enge Grenze 33 echte Spieler betroffen hat.
     * BETRUG wird gemeldet (Standard: nur melden, nichts wird veraendert) bzw. im scharfen Modus
       auf das Plausible gekappt - auch wenn der Betrueger Bonus/Angriff/Stufe/Kills mitfaelscht oder
       viele kleine Speicherungen schickt.
   Die Zahlen unten (Konten-Groessen) leiten sich aus dem Spiel her; die Grenzen selbst stehen in der
   SQL-Datei und lassen sich ueber idle_anticheat_settings nachjustieren, ohne neue Migration. */
const { test, expect } = require('@playwright/test');
const h = require('../helpers/pg-event-harness');
const e = require('../helpers/pg-economy-harness');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Reine SQL-Tests laufen nur einmal (chromium-desktop).');
});

const num = v => Number(v);
const goldPlus = n => 'gold = gold + ' + n + ', total_gold_earned = total_gold_earned + ' + n;

let db;
test.beforeAll(async () => { db = await e.createEconomyDb(); });
test.afterAll(async () => { if (db) await db.close(); });
test.beforeEach(async () => {
  if (!db) return;
  await db.query(`delete from public.idle_anticheat_settings where key = 'economy'`);
  await db.query(`insert into public.idle_anticheat_settings (key, value) values ('economy', '{"enabled": true, "enforce": false}')`);
});

test.describe('Legitime Speicherungen werden nie gemeldet und nie veraendert', () => {
  for (const enforce of [false, true]) {
    const mode = enforce ? 'scharf (enforce)' : 'Meldemodus';

    test(`Neuer Spieler: normaler Kampf-Speicherstand - ${mode}`, async () => {
      await e.setEconomy(db, { enforce });
      await e.seedPlayer(db, 1, 'neu');
      const r = await e.directSave(db, 1, goldPlus(5000) + ', wood = wood + 30, stone = stone + 20, crystals = crystals + 1, essence = essence + 1, xp = xp + 2000, dragon_kills = dragon_kills + 20');
      expect(num(r.gold)).toBe(5000);
      expect(num(r.wood)).toBe(30);
      expect(num(r.xp)).toBe(2000);
      expect(await e.economyFlags(db, 1)).toHaveLength(0);
      const st = await e.getState(db, 1);
      expect(st).not.toBeNull();
      expect(st.violations).toBe(0);
    });

    test(`Neuer Spieler: ein Gold-Dungeon-Lauf (3000 x Angriff) - ${mode}`, async () => {
      await e.setEconomy(db, { enforce });
      await e.seedPlayer(db, 2, 'neu');
      const r = await e.directSave(db, 2, goldPlus(30000));
      expect(num(r.gold)).toBe(30000);
      expect(await e.economyFlags(db, 2)).toHaveLength(0);
    });

    test(`Mittlerer Spieler: Dungeon 2,4 Mio. Gold + EXP-Dungeon + Level-Aufstieg - ${mode}`, async () => {
      await e.setEconomy(db, { enforce });
      await e.seedPlayer(db, 3, 'mittel');
      // Level 120 -> 123 (jeweils ca. 40*l^1.42 EXP) plus 1,44 Mio. EXP aus einem EXP-Dungeon.
      const r = await e.directSave(db, 3, goldPlus(2400000) + ', xp = xp + 1440000, level = level + 3, skill_points_available = skill_points_available + 3');
      expect(num(r.gold)).toBe(4000000 + 2400000);
      expect(num(r.level)).toBe(123);
      expect(num(r.xp)).toBe(30000 + 1440000);
      expect(await e.economyFlags(db, 3)).toHaveLength(0);
    });

    test(`Spitzenspieler: Dungeon 45 Mio. Gold + 5 Level - ${mode}`, async () => {
      await e.setEconomy(db, { enforce });
      await e.seedPlayer(db, 4, 'top');
      const r = await e.directSave(db, 4, goldPlus(45000000) + ', level = level + 5, skill_points_available = skill_points_available + 5');
      expect(num(r.level)).toBe(1823);
      expect(await e.economyFlags(db, 4)).toHaveLength(0);
    });

    test(`Gebaeude-Nachtrag nach langer Abwesenheit (72 h Goldmine; Spitzenspieler 372 h) - ${mode}`, async () => {
      await e.setEconomy(db, { enforce });
      await e.seedPlayer(db, 5, 'mittel');
      // 72 h x 400*(1+20*0,8) x Prestige-Bonus (1,25) x Boost (1,25) = ca. 0,96 Mio.
      const mid = await e.directSave(db, 5, goldPlus(960000));
      expect(num(mid.gold)).toBe(4000000 + 960000);
      expect(await e.economyFlags(db, 5)).toHaveLength(0);
      await e.seedPlayer(db, 6, 'top');
      // 372 h x 49.360/h x 6 (Prestige 100) x 1,25 = ca. 138 Mio.
      const top = await e.directSave(db, 6, goldPlus(138000000));
      expect(num(top.gold)).toBe(800000000 + 138000000);
      expect(await e.economyFlags(db, 6)).toHaveLength(0);
    });

    test(`Ausgeben, Prestige-Reset und Level-Abstieg zaehlen nicht als Zuwachs - ${mode}`, async () => {
      await e.setEconomy(db, { enforce });
      await e.seedPlayer(db, 7, 'top');
      const r = await e.directSave(db, 7, 'gold = 0, wood = 0, stone = 0, crystals = 0, essence = 0, level = 1, xp = 0, dragon_kills = dragon_kills');
      expect(num(r.gold)).toBe(0);
      expect(num(r.level)).toBe(1);
      expect(await e.economyFlags(db, 7)).toHaveLength(0);
    });
  }

  test('Spitzenauslastung wird festgehalten und sinkt nie wieder', async () => {
    await e.seedPlayer(db, 8, 'mittel');
    await e.directSave(db, 8, goldPlus(2000000));
    const first = num((await e.getState(db, 8)).peak_gold);
    expect(first).toBeGreaterThan(0.01);
    expect(first).toBeLessThan(0.5);
    await e.directSave(db, 8, goldPlus(100));
    expect(num((await e.getState(db, 8)).peak_gold)).toBeGreaterThanOrEqual(first);
  });
});

test.describe('Betrug wird gemeldet - im Meldemodus bleibt der Spielstand unveraendert', () => {
  test('+100 Mio. Gold bei einem neuen Konto: Alarm mit Zahlen, Wert bleibt (nur melden)', async () => {
    await e.seedPlayer(db, 10, 'neu');
    const r = await e.directSave(db, 10, goldPlus(100000000));
    expect(num(r.gold)).toBe(100000000);          // Meldemodus: nichts veraendert
    const flags = await e.economyFlags(db, 10);
    expect(flags).toHaveLength(1);
    const d = flags[0].economy_details;
    expect(d.enforced).toBe(false);
    expect(num(d.details.gold.gain)).toBe(100000000);
    expect(num(d.details.gold.ratio)).toBeGreaterThan(10);
    expect((await e.getState(db, 10)).violations).toBe(1);
  });

  test('Wert direkt auf 1e15 gesetzt (Mittel) wird gemeldet', async () => {
    await e.seedPlayer(db, 11, 'mittel');
    await e.directSave(db, 11, 'gold = 1000000000000000');
    const flags = await e.economyFlags(db, 11);
    expect(flags).toHaveLength(1);
    expect(flags[0].economy_details.details.gold).toBeTruthy();
  });

  test('Mittel: 2,4 Mio. unauffaellig, 100 Mio. gemeldet', async () => {
    await e.seedPlayer(db, 12, 'mittel');
    await e.directSave(db, 12, goldPlus(2400000));
    expect(await e.economyFlags(db, 12)).toHaveLength(0);
    await e.seedPlayer(db, 13, 'mittel');
    await e.directSave(db, 13, goldPlus(100000000));
    expect(await e.economyFlags(db, 13)).toHaveLength(1);
  });

  test('Spitzenspieler: 5 Mrd. in einer Speicherung wird gemeldet (45 Mio. nicht)', async () => {
    await e.seedPlayer(db, 14, 'top');
    await e.directSave(db, 14, goldPlus(5000000000));
    expect(await e.economyFlags(db, 14)).toHaveLength(1);
  });

  test('Nur total_gold_earned gefaelscht (Bestenliste): wird gemeldet', async () => {
    await e.seedPlayer(db, 15, 'mittel');
    const r = await e.directSave(db, 15, 'total_gold_earned = total_gold_earned + 900000000000');
    expect(num(r.gold)).toBe(4000000);            // Gold selbst unveraendert
    const flags = await e.economyFlags(db, 15);
    expect(flags).toHaveLength(1);
    expect(flags[0].economy_details.details.gold).toBeTruthy();
  });

  test('Holz, Stein, Kristalle, Essenz in einer Speicherung: alle vier stehen im Alarm', async () => {
    await e.seedPlayer(db, 16, 'mittel');
    await e.directSave(db, 16, 'wood = wood + 1000000000, stone = stone + 1000000000, crystals = crystals + 10000000, essence = essence + 10000000');
    const d = (await e.economyFlags(db, 16))[0].economy_details.details;
    expect(Object.keys(d).sort()).toEqual(['crystals', 'essence', 'stone', 'wood']);
  });

  test('Erfahrung: +500 Level auf einmal wird gemeldet', async () => {
    await e.seedPlayer(db, 17, 'mittel');
    await e.directSave(db, 17, 'level = level + 500, skill_points_available = skill_points_available + 500');
    const flags = await e.economyFlags(db, 17);
    expect(flags).toHaveLength(1);
    expect(flags[0].economy_details.details.xp).toBeTruthy();
  });

  test('Mitgefaelschte Bezugswerte (Bonus, Angriff, Stufe) vergroessern die Grenze nicht', async () => {
    await e.seedPlayer(db, 18, 'neu');
    // Der Betrueger setzt im selben Speichern Bonus/Angriff/Stufe hoch, um die Grenze zu dehnen.
    await e.directSave(db, 18, goldPlus(50000000) + ', gold_bonus = 1000000000, loot_bonus = 1000000000, xp_bonus = 1000000000, attack = 1000000000, highest_dragon_index = 1000000, current_dragon_index = 1000000');
    const flags = await e.economyFlags(db, 18);
    expect(flags).toHaveLength(1);
    expect(num(flags[0].economy_details.details.gold.gain)).toBeGreaterThanOrEqual(50000000);
  });

  test('Mitgefaelschte Kills: der alte Waechter kappt den Zuwachs schon vorher (kein Alarm der neuen Pruefung noetig)', async () => {
    await e.seedPlayer(db, 26, 'neu');
    await db.query('update public.idle_player_state set updated_at = now() where auth_user_id = $1', [e.uid(26)]);
    const r = await e.directSave(db, 26, goldPlus(50000000) + ', dragon_kills = dragon_kills + 1000000, highest_dragon_index = 1000000');
    expect(num(r.gold)).toBeLessThan(1000000);        // 50 Mio. wurden auf einen winzigen Rest herunterskaliert
    expect((await e.allFlags(db, 26)).some(f => String(f.triggered_by).includes('dragon_kills'))).toBe(true);
  });

  test('Viele Betrugs-Speicherungen hintereinander: ein Alarm (gedrosselt), alle Verstoesse gezaehlt', async () => {
    await e.seedPlayer(db, 19, 'neu');
    for (let i = 0; i < 5; i++) await e.directSave(db, 19, goldPlus(100000000));
    expect(await e.economyFlags(db, 19)).toHaveLength(1);
    expect((await e.getState(db, 19)).violations).toBe(5);
  });
});

test.describe('Scharf geschaltet (enforce=true): zu hohe Zuwaechse werden gekappt', () => {
  test('+100 Mio. Gold bei einem neuen Konto: nur das Plausible kommt an', async () => {
    await e.setEconomy(db, { enforce: true });
    await e.seedPlayer(db, 20, 'neu');
    const r = await e.directSave(db, 20, goldPlus(100000000));
    expect(num(r.gold)).toBeLessThan(2000000);
    expect(num(r.gold)).toBeGreaterThan(100000);
    expect(num(r.total_gold_earned)).toBe(num(r.gold));
    const flag = (await e.economyFlags(db, 20))[0];
    expect(flag.economy_details.enforced).toBe(true);
    expect(num(flag.ratio_applied)).toBeLessThan(0.1);
  });

  test('Nur total_gold_earned gefaelscht: wird ebenfalls gekappt', async () => {
    await e.setEconomy(db, { enforce: true });
    await e.seedPlayer(db, 21, 'mittel');
    const r = await e.directSave(db, 21, 'total_gold_earned = total_gold_earned + 900000000000');
    expect(num(r.total_gold_earned)).toBeLessThan(60000000 + 100000000);
  });

  test('Holz/Stein/Kristalle/Essenz werden einzeln gekappt', async () => {
    await e.setEconomy(db, { enforce: true });
    await e.seedPlayer(db, 22, 'mittel');
    const r = await e.directSave(db, 22, 'wood = wood + 1000000000, stone = stone + 1000000000, crystals = crystals + 10000000, essence = essence + 10000000');
    expect(num(r.wood)).toBeLessThan(90000 + 5000000);
    expect(num(r.stone)).toBeLessThan(90000 + 5000000);
    expect(num(r.crystals)).toBeLessThan(4000 + 500000);
    expect(num(r.essence)).toBeLessThan(2500 + 500000);
  });

  test('Erfahrung: der Level-/EXP-Sprung wird verworfen, die Skillpunkte dazu auch', async () => {
    await e.setEconomy(db, { enforce: true });
    await e.seedPlayer(db, 23, 'mittel', { skill_points_available: 7 });
    const r = await e.directSave(db, 23, 'level = level + 500, xp = xp + 50000, skill_points_available = skill_points_available + 500');
    expect(num(r.level)).toBe(120);
    expect(num(r.xp)).toBe(30000);
    expect(num(r.skill_points_available)).toBe(7);
  });

  test('Viele kleine Speicherungen: das Konto leert sich, insgesamt kommt nie mehr als die Obergrenze an', async () => {
    await e.setEconomy(db, { enforce: true });
    await e.seedPlayer(db, 24, 'neu');
    let last;
    for (let i = 0; i < 30; i++) last = await e.directSave(db, 24, goldPlus(900000));
    // Obergrenze eines neuen Kontos ca. 0,93 Mio. - 30 x 0,9 Mio. = 27 Mio. duerfen NICHT ankommen.
    expect(num(last.gold)).toBeLessThan(1100000);
    expect(num(last.gold)).toBeGreaterThan(850000);
  });

  test('Das Guthaben laeuft mit der Zeit wieder nach (mit der Rate des Kontos: neues Konto ca. 156/s -> 3 Stunden fuellen es)', async () => {
    await e.setEconomy(db, { enforce: true });
    await e.seedPlayer(db, 25, 'neu');
    await e.directSave(db, 25, goldPlus(900000));
    const second = await e.directSave(db, 25, goldPlus(900000));
    expect(num(second.gold)).toBeLessThan(960000);      // sofort danach: leer, nur ein Rest
    await db.query(`update public.idle_economy_guard_state set last_at = now() - interval '3 hours' where owner_key = $1`, [e.uid(25)]);
    const flagsBefore = (await e.getState(db, 25)).violations;
    const third = await e.directSave(db, 25, goldPlus(900000));
    expect(num(third.gold)).toBeGreaterThan(num(second.gold) + 850000);
    expect((await e.getState(db, 25)).violations).toBe(flagsBefore);
  });
});

/* Jeder Bestandteil der Ertragsrate wird einzeln abgesichert: Das Konto wird leer gemacht und um
   100 Sekunden zurueckgestellt, dann gilt NUR die Rate (kein Guthaben, kein Einmal-Zuschlag). Dieselbe
   Speicherung ohne die jeweilige Eigenschaft muss gemeldet werden - sonst wuerde der Test auch
   bestehen, wenn der Bestandteil in der SQL fehlte. */
test.describe('Bestandteile der Rate: Bonus, Angriff, Stufe, Prestige werden beruecksichtigt', () => {
  async function prepare(n, persona, overrides, seconds) {
    await e.seedPlayer(db, n, persona, overrides);
    await e.directSave(db, n, 'gold = gold + 1, total_gold_earned = total_gold_earned + 1');   // legt das Konto an
    await db.query(`update public.idle_economy_guard_state set credit_gold = 0, last_at = now() - ($2::int * interval '1 second') where owner_key = $1`, [e.uid(n), seconds]);
  }

  test('Gold-Bonus erhoeht die Rate (Bonus 1000 %: 100.000 Gold in 100 s ok, ohne Bonus nicht)', async () => {
    await prepare(110, 'neu', { gold_bonus: 1000 }, 100);
    await e.directSave(db, 110, goldPlus(100000));
    expect(await e.economyFlags(db, 110)).toHaveLength(0);
    await prepare(111, 'neu', {}, 100);
    await e.directSave(db, 111, goldPlus(100000));
    expect(await e.economyFlags(db, 111)).toHaveLength(1);
  });

  test('Der mitgesendete Bonus wird gedeckelt (bonus_cap_pct 2000): 10000 % im selben Speichern bringt nichts', async () => {
    await e.seedPlayer(db, 112, 'neu');
    await e.directSave(db, 112, goldPlus(5000000) + ', gold_bonus = 10000');       // Obergrenze des alten Waechters, aber ueber dem Deckel hier
    expect(await e.economyFlags(db, 112)).toHaveLength(1);
    await e.seedPlayer(db, 113, 'neu');
    await e.directSave(db, 113, goldPlus(2000000) + ', gold_bonus = 2000');        // am Deckel: 2 Mio. passen
    expect(await e.economyFlags(db, 113)).toHaveLength(0);
  });

  test('Der Angriff erhoeht die Gold-Rate (Dungeon/Turm: ca. 3,5 x Angriff je Sekunde)', async () => {
    await prepare(114, 'neu', { attack: 200000 }, 100);
    await e.directSave(db, 114, goldPlus(30000000));
    expect(await e.economyFlags(db, 114)).toHaveLength(0);
    await prepare(115, 'neu', {}, 100);
    await e.directSave(db, 115, goldPlus(30000000));
    expect(await e.economyFlags(db, 115)).toHaveLength(1);
  });

  test('Die Drachen-Stufe erhoeht die Rate (Stufe 5000 gibt rund das 750-fache an Gold je Sieg)', async () => {
    await prepare(116, 'neu', { highest_dragon_index: 5000, current_dragon_index: 5000 }, 100);
    await e.directSave(db, 116, goldPlus(5000000));
    expect(await e.economyFlags(db, 116)).toHaveLength(0);
    await prepare(117, 'neu', {}, 100);
    await e.directSave(db, 117, goldPlus(5000000));
    expect(await e.economyFlags(db, 117)).toHaveLength(1);
  });

  test('Prestige erhoeht den Gebaeude-Nachtrag (Stufe 100: Faktor 6 und 372 Offline-Stunden statt 72)', async () => {
    await e.seedPlayer(db, 118, 'neu', { goldmine_level: 150, prestige: 100 });
    await e.directSave(db, 118, goldPlus(200000000));
    expect(await e.economyFlags(db, 118)).toHaveLength(0);
    await e.seedPlayer(db, 119, 'neu', { goldmine_level: 150 });
    await e.directSave(db, 119, goldPlus(200000000));
    expect(await e.economyFlags(db, 119)).toHaveLength(1);
  });
});

test.describe('Ausnahmen: nur direkte Browser-Speicherungen werden geprueft', () => {
  test('Serverfunktion (SECURITY DEFINER, z. B. Raid/Event/Expedition): +1e12 Gold bleibt unbeachtet', async () => {
    await db.exec(`
      create or replace function public.test_rpc_credit(p_uid uuid, p_gold bigint) returns void
      language plpgsql security definer set search_path = public as $$
      begin
        update public.idle_player_state set gold = gold + p_gold, total_gold_earned = total_gold_earned + p_gold
         where auth_user_id = p_uid;
      end $$;`);
    await e.setEconomy(db, { enforce: true });
    await e.seedPlayer(db, 30, 'neu');
    await h.callAs(db, { sub: e.uid(30) }, 'select public.test_rpc_credit($1, $2)', [e.uid(30), 1000000000000]);
    expect(num((await e.getRow(db, 30)).gold)).toBe(1000000000000);
    expect(await e.economyFlags(db, 30)).toHaveLength(0);
    expect(await e.getState(db, 30)).toBeNull();
  });

  test('service_role (Offline-Nachtrag): +1e12 Gold bleibt unbeachtet', async () => {
    await e.setEconomy(db, { enforce: true });
    await e.seedPlayer(db, 31, 'neu');
    const r = await e.serviceSave(db, 31, goldPlus(1000000000000));
    expect(num(r.gold)).toBe(1000000000000);
    expect(await e.economyFlags(db, 31)).toHaveLength(0);
  });

  test('Administrator: +1e12 Gold bleibt unbeachtet', async () => {
    await e.setEconomy(db, { enforce: true });
    const claims = await h.addAdminProfile(db, { uid: e.uid(900), email: 'admin@test.de', role: 'admin' });
    await e.seedPlayer(db, 32, 'neu');
    const r = await e.adminSave(db, 32, claims, goldPlus(1000000000000));
    expect(num(r.gold)).toBe(1000000000000);
    expect(await e.economyFlags(db, 32)).toHaveLength(0);
  });

  test('Schalter enabled=false: gar keine Pruefung', async () => {
    await e.setEconomy(db, { enabled: false, enforce: true });
    await e.seedPlayer(db, 33, 'neu');
    const r = await e.directSave(db, 33, goldPlus(100000000));
    expect(num(r.gold)).toBe(100000000);
    expect(await e.economyFlags(db, 33)).toHaveLength(0);
  });
});

test.describe('Zusammenspiel mit dem bestehenden Waechter', () => {
  test('Kampfwerte-Obergrenze (11.08.) wirkt unveraendert weiter', async () => {
    await e.seedPlayer(db, 40, 'neu');
    const r = await e.directSave(db, 40, goldPlus(1000) + ', attack = 5000000');
    expect(num(r.attack)).toBe(1000000);
    const flags = await e.allFlags(db, 40);
    expect(flags.some(f => String(f.triggered_by).includes('combat_stats'))).toBe(true);
  });

  test('Kill-Tempo (30.07.): Speichern klappt, beide Waechter melden', async () => {
    await e.seedPlayer(db, 41, 'neu');
    await db.query(`update public.idle_player_state set updated_at = now() where auth_user_id = $1`, [e.uid(41)]);
    const r = await e.directSave(db, 41, goldPlus(100000000) + ', dragon_kills = dragon_kills + 1000000');
    expect(num(r.dragon_kills)).toBeLessThan(1000);   // alter Waechter hat gekappt
    const flags = await e.allFlags(db, 41);
    expect(flags.some(f => String(f.triggered_by).includes('dragon_kills'))).toBe(true);
  });

  test('Reihenfolge der Waechter: Herkunft zuerst, dann alt, dann neu', async () => {
    const r = await db.query(`select tgname from pg_trigger where tgrelid = 'public.idle_player_state'::regclass and not tgisinternal order by tgname`);
    expect(r.rows.map(x => x.tgname)).toEqual([
      'idle_player_state_0_origin_probe', 'idle_player_state_anticheat_guard_trigger', 'idle_player_state_economy_guard_trigger']);
  });
});

test.describe('Bestehender Waechter: Array-Fehler (22P02) - Korrektur-Datei', () => {
  test('VOR der Korrektur bricht ein Speichern mit zu vielen Kills mit 22P02 ab (das ist der Live-Fehler vom 11.08.)', async () => {
    const adb = await e.createEconomyDb({ arrayFix: false, install: false });
    try {
      await e.seedPlayer(adb, 80, 'neu');
      await adb.query('update public.idle_player_state set updated_at = now() where auth_user_id = $1', [e.uid(80)]);
      await expect(e.directSave(adb, 80, 'dragon_kills = dragon_kills + 1000000')).rejects.toThrow(/malformed array literal/);
      expect(num((await e.getRow(adb, 80)).dragon_kills)).toBe(0);        // nichts gespeichert
    } finally { await adb.close(); }
  });

  test('NACH der Korrektur wird gekappt statt abgelehnt; der Alarm nennt dragon_kills', async () => {
    await e.seedPlayer(db, 81, 'neu');
    await db.query('update public.idle_player_state set updated_at = now() where auth_user_id = $1', [e.uid(81)]);
    const r = await e.directSave(db, 81, 'dragon_kills = dragon_kills + 1000000');
    expect(num(r.dragon_kills)).toBeLessThan(100);
    const flags = await e.allFlags(db, 81);
    expect(flags.some(f => String(f.triggered_by).includes('dragon_kills'))).toBe(true);
  });

  test('Auch Level, Skillpunkte und der Kampfwerte-Alarm (combat_stats) funktionieren', async () => {
    await e.seedPlayer(db, 82, 'neu');
    await db.query('update public.idle_player_state set updated_at = now() where auth_user_id = $1', [e.uid(82)]);
    const r = await e.directSave(db, 82, 'level = level + 50000, skill_points_available = skill_points_available + 50000, attack = 9000000');
    expect(num(r.level)).toBeLessThan(2000);
    expect(num(r.skill_points_available)).toBeLessThan(2000);
    expect(num(r.attack)).toBe(1000000);
    const by = (await e.allFlags(db, 82)).map(f => String(f.triggered_by)).join(',');
    expect(by).toContain('level');
    expect(by).toContain('skill_points');
    expect(by).toContain('combat_stats');
  });

  test('Die Korrektur-Datei ist wiederholbar und aendert sonst nichts an der Funktion', async () => {
    await db.exec(e.sqlFile(e.ARRAY_FIX));
    const fn = (await db.query(`select pg_get_functiondef('public.idle_player_state_anticheat_guard'::regproc) as d`)).rows[0].d;
    expect(fn).toContain("array_append(v_triggered_by, 'dragon_kills')");
    expect(fn).not.toMatch(/v_triggered_by \|\| '/);
  });
});

test.describe('Rechte und Wiederholbarkeit', () => {
  test('Spieler koennen weder Einstellungen noch das Konto lesen oder aendern', async () => {
    await e.seedPlayer(db, 50, 'neu');
    await e.directSave(db, 50, goldPlus(10));
    const asPlayer = { sub: e.uid(50) };
    const state = await h.callAs(db, asPlayer, 'select * from public.idle_economy_guard_state');
    expect(state).toHaveLength(0);
    const settings = await h.callAs(db, asPlayer, 'select * from public.idle_anticheat_settings');
    expect(settings).toHaveLength(0);
    const upd = await h.callAs(db, asPlayer, `update public.idle_anticheat_settings set value = '{"enabled": false}' returning *`);
    expect(upd).toHaveLength(0);
    await expect(h.callAs(db, asPlayer, `insert into public.idle_anticheat_settings (key, value) values ('x', '{}')`)).rejects.toThrow();
    await expect(h.callAs(db, asPlayer, `update public.idle_economy_guard_state set credit_gold = 1e18`)).rejects.toThrow();
  });

  test('Datei ist wiederholbar: zweites Ausfuehren behaelt Einstellungen und Konten', async () => {
    await e.setEconomy(db, { enforce: true, safety: 3 });
    await e.seedPlayer(db, 51, 'neu');
    await e.directSave(db, 51, goldPlus(500));
    const before = await e.getState(db, 51);
    await db.exec(e.sqlFile(e.ECONOMY));
    const settings = (await db.query(`select value from public.idle_anticheat_settings where key = 'economy'`)).rows[0].value;
    expect(settings.enforce).toBe(true);
    expect(settings.safety).toBe(3);
    const after = await e.getState(db, 51);
    expect(after.owner_key).toBe(before.owner_key);
    expect(num(after.credit_gold)).toBe(num(before.credit_gold));
  });

  test('Einstellungen aendern das Verhalten sofort (safety hoeher = mehr Spielraum)', async () => {
    await e.seedPlayer(db, 52, 'mittel');
    await e.directSave(db, 52, goldPlus(60000000));
    expect(await e.economyFlags(db, 52)).toHaveLength(1);        // mit safety 1 zu viel (Grenze ca. 38 Mio.)
    await e.setEconomy(db, { safety: 3 });
    await e.seedPlayer(db, 53, 'mittel');
    await e.directSave(db, 53, goldPlus(60000000));
    expect(await e.economyFlags(db, 53)).toHaveLength(0);
  });
});

test.describe('Ausfallsicher: ein Fehler in der Pruefung blockiert nie das Speichern', () => {
  let fdb;
  test.beforeAll(async () => { fdb = await e.createEconomyDb(); });
  test.afterAll(async () => { if (fdb) await fdb.close(); });

  test('Kaputte Einstellung (Text statt Zahl): Speichern klappt, nichts gemeldet', async () => {
    await fdb.query(`insert into public.idle_anticheat_settings (key, value) values ('economy', '{"safety": "viel"}')
                     on conflict (key) do update set value = excluded.value`);
    await e.seedPlayer(fdb, 60, 'neu');
    const r = await e.directSave(fdb, 60, goldPlus(100000000));
    expect(num(r.gold)).toBe(100000000);
    expect(await e.economyFlags(fdb, 60)).toHaveLength(0);
  });

  test('Fehlende Alarm-Spalte: Speichern klappt, das Konto wird trotzdem gefuehrt', async () => {
    await fdb.query(`update public.idle_anticheat_settings set value = '{"enabled": true, "enforce": false}' where key = 'economy'`);
    await fdb.exec('alter table public.idle_anticheat_flags drop column economy_details');
    await e.seedPlayer(fdb, 61, 'neu');
    const r = await e.directSave(fdb, 61, goldPlus(100000000));
    expect(num(r.gold)).toBe(100000000);
    expect((await e.getState(fdb, 61)).violations).toBe(1);
    await fdb.exec('alter table public.idle_anticheat_flags add column economy_details jsonb');
  });

  test('Konto-Tabelle fehlt komplett: Speichern klappt (auch scharf), Wert bleibt wie behauptet', async () => {
    await e.setEconomy(fdb, { enforce: true });
    await fdb.exec('drop table public.idle_economy_guard_state');
    await e.seedPlayer(fdb, 62, 'neu');
    const r = await e.directSave(fdb, 62, goldPlus(100000000));
    expect(num(r.gold)).toBe(100000000);
  });
});

test.describe('Sicherheitsnetz Bestenliste', () => {
  test('Ohne die Entkopplung vom 11.08. blendet die alte Sicht bei Alarm aus - die neue Datei stellt das ab', async () => {
    const vdb = await e.createEconomyDb({ install: false });
    try {
      await e.seedPlayer(vdb, 70, 'mittel');
      await vdb.query(`insert into public.idle_anticheat_flags (name_key, claimed_dragon_kills_delta, allowed_dragon_kills_delta, elapsed_seconds, ratio_applied)
                       values ('spieler70', 0, 0, 1, 1)`);
      let rows = await vdb.query(`select name_key from public.idle_player_state_leaderboard where name_key = 'spieler70'`);
      expect(rows.rows).toHaveLength(0);                      // Gefahr nachgewiesen: alte Sicht blendet aus
      await vdb.exec(e.sqlFile(e.ECONOMY));
      rows = await vdb.query(`select name_key from public.idle_player_state_leaderboard where name_key = 'spieler70'`);
      expect(rows.rows).toHaveLength(1);                      // jetzt sichtbar trotz ungeprueftem Alarm
      await vdb.query(`insert into public.idle_leaderboard_hidden_accounts (name_key, reason) values ('spieler70', 'test')`);
      rows = await vdb.query(`select name_key from public.idle_player_state_leaderboard where name_key = 'spieler70'`);
      expect(rows.rows).toHaveLength(0);                      // manuelles Ausblenden wirkt weiter
    } finally { await vdb.close(); }
  });
});
