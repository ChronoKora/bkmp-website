/* Phase 4 (24.07.2026, siehe CLAUDE.md) - Weltboss-/Raid-Tests. Schliesst die
   in Phase 2/3 dokumentierte Mock-Luecke ("Raid/Weltboss und Gildenboss sind
   noch nicht ausreichend gemockt oder getestet", tests/FEATURE_MATRIX.md).

   RPC-Quellen (siehe rpc-engine.js's Kommentar am Raid-Abschnitt fuer die
   vollstaendige Herleitung):
     - raid_join: sql/20260719-fix-raid-guildboss-hour-check.sql (aktuellste
       Fassung - prueft die Gildenboss-Stunden-Sperre gegen die START-Stunde
       DES RAIDS, nicht "jetzt")
     - raid_deal_damage/raid_boss_attack_tick: sql/supabase-raid-boss-
       combined-latest.sql (konsolidiert own_*-Rueckgabespalten MIT der
       5%-Gegenangriff-Balance aus v2/v3/v4)
     - raid_finish (intern): sql/supabase-raid-boss-reward-share.sql
       (Schadensanteil-Beloehnung, ersetzt die aeltere Pauschal-Fassung)

   Bewusst NICHT im Mock/in diesen Tests: die seltenen RNG-Kosmetik-
   Nebenwirkungen aus raid_finish() (5% Zerator-Pluschie-Code, 1%
   Zerathordorf-Skin, je 1% Gold-/Exp-Boost) - siehe tests/FEATURE_MATRIX.md.

   Eigene, lokale Fixture statt tests/fixtures/teststands.js (gleiches Muster
   wie arena.spec.js/guild.spec.js) - Raid-Tests brauchen echte raid_bosses-
   Konfiguration + oft einen zweiten gleichzeitigen Teilnehmer.

   Zeitsteuerung: bkmpRaidGetPhaseInfo()/raid_join()/raid_deal_damage()/
   raid_boss_attack_tick() akzeptieren beide entweder ein `now`-Argument
   (Client) oder lesen die Serveruhr (RPC) - fuer diese Tests wird
   AUSSCHLIESSLICH direkt gegen die echten supabase.js-Wrapper-Funktionen
   (joinRaid/submitRaidDamage/tickRaidBossAttack) aufgerufen, nicht durch
   Klicks auf die Zeit-gegateten UI-Elemente - dadurch reicht die Steuerung
   der SERVER-Uhr (qaServer.store.clock) allein aus, kein page.clock-Fake
   noetig (kein Test verlaesst sich auf client-seitiges new Date()). */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const ATTACKER_UID = 'qa-raid-attacker-0000';
const ATTACKER_NAME = 'QaRaidAtk';
const HELPER_UID = 'qa-raid-helper-0000';
const HELPER_NAME = 'QaRaidHelp';

const RAID_BOSS = {
  id: 'zerathor', name: 'Zerathor, Zorn der Verdammnis', sprite_key: 'zerathor',
  base_hp: 500000, base_attack: 90, attack_interval_seconds: 6, hp_scale_per_attack: 150,
  gold_reward: 1500000, gem_reward: 1000, xp_reward: 150000,
  wood_reward: 50000, stone_reward: 50000, essence_reward: 2000, active: true
};

// UTC-Stunde 21 am 24.07.2026 - bewusst NICHT Stunde 20 (Gildenboss-Sperre).
const FIGHT_START_MS = Date.UTC(2026, 6, 24, 21, 0, 0);
const RAID_ID = '2026072421';
/* Die Sperre prueft die BERLIN-Stunde des Kampfbeginns, nicht UTC (siehe
   raid_join()/rpc-engine.js: berlinParts(fightStartsMs).hour===20). Im Juli
   gilt Sommerzeit (Europe/Berlin = UTC+2) - Berlin 20:00 Uhr entspricht also
   UTC 18:00 Uhr, NICHT UTC 20:00 Uhr. */
const GUILDBOSS_HOUR_RAID_ID = '2026072418';

function raidFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  /* WICHTIG: *_collected_at-Felder (Produktionsgebaeude) werden bewusst auf
     die ECHTE aktuelle Wanduhrzeit gesetzt, NICHT auf nowIso/startTimeMs -
     bkmpIdleAccrueBuildingResources() (idledorf.js) rechnet nach wie vor mit
     echtem Date.now(), nicht mit der Server-/GameClock (siehe CLAUDE.md "Nur
     EINE Zeitstelle migriert"). startTimeMs ist hier bewusst kuenstlich auf
     eine gueltige Raid-Stunde gelegt (siehe FIGHT_START_MS) - faellt dieser
     Wert zufaellig NICHT mit der echten Wanduhrzeit zusammen, wuerde ein
     naiv aus startTimeMs abgeleiteter *_collected_at-Zeitstempel einen
     voellig raid-fremden, aber echten "seit X Stunden nicht abgeholt"-Ertrag
     entstehen lassen, der jede Gold-Assertion in diesen Tests verfaelscht -
     genau dieser Fund kostete beim eigenen Testen mehrere Anlaeufe, bis die
     wahre Ursache (nicht Auto-Tick-Loop, nicht Offline-Claim) feststand. */
  const realNowIso = new Date().toISOString();
  function row(uid, name, extra) {
    return makePlayerStateRow(uid, name.toLowerCase(), nowIso, {
      display_name: name, level: 50, gold: 0, attack: 100, defense: 50, hp: 10000,
      fruit_collected_at: realNowIso, meat_collected_at: realNowIso,
      holzfaeller_collected_at: realNowIso, steinbruch_collected_at: realNowIso,
      goldmine_collected_at: realNowIso, kristallmine_collected_at: realNowIso,
      manaquelle_collected_at: realNowIso, magierakademie_collected_at: realNowIso,
      ...extra
    });
  }
  function user(uid, name) {
    return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} };
  }
  return {
    startTimeMs,
    displayName: ATTACKER_NAME,
    nameKey: ATTACKER_NAME.toLowerCase(),
    authUserId: ATTACKER_UID,
    email: emailFromName(ATTACKER_NAME),
    password: QA_PASSWORD,
    users: [user(ATTACKER_UID, ATTACKER_NAME), user(HELPER_UID, HELPER_NAME)],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [row(ATTACKER_UID, ATTACKER_NAME), row(HELPER_UID, HELPER_NAME, { hp: 5000, attack: 50, defense: 20 })],
      idle_prestige_state: [],
      idle_player_runes: [],
      raid_bosses: [{ ...RAID_BOSS }],
      raid_instances: [], raid_participants: [], raid_player_stats: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, raidFixture(startTimeMs)), { startTimeMs: FIGHT_START_MS - 3 * 60000 });
    await use(server);
    await server.close();
  }
});

async function login(page, qaServer, name) {
  await page.goto(qaServer.url('/'));
  const overlay = page.locator('#mcNameOverlay');
  await expect(overlay).toHaveClass(/visible/, { timeout: 15000 });
  await page.evaluate(() => { const h = document.querySelector('[data-qa-hide]'); if (h) h.click(); });
  await page.locator('#mcAuthName').fill(name);
  await page.locator('#mcAuthPassword').fill(QA_PASSWORD);
  await page.locator('#mcAuthSubmit').click();
  await expect(overlay).not.toHaveClass(/visible/, { timeout: 15000 });
  await page.locator('#idleDorfButton').click();
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await waitForIdleStateReady(page);
  /* waitForIdleStateReady allein reicht nicht - bkmpIdleCurrentDragon (und
     damit der tatsaechliche Start des normalen Auto-Tick-Loops) wird laut
     idledorf.js ERST NACH dem Offline-Claim gesetzt, in einem spaeteren
     Schritt von bkmpIdleOpenModal()'s async-Ablauf. Ein bkmpIdleStopLoop()
     direkt nach waitForIdleStateReady kann deshalb VOR dem eigentlichen
     Loop-Start laufen und wird von diesem kurz danach wieder unbemerkt
     ueberschrieben - exakt dieselbe, bereits in dieser Session fuer
     combat.spec.js/prestige.spec.js bewiesene und behobene Bugklasse (siehe
     CLAUDE.md "Gezielte Stabilitaets-/Reparaturphase"). waitForDragonReady
     wartet auf das tatsaechlich spaetere Signal, danach ist der Loop-Start
     garantiert bereits durchgelaufen. */
  await waitForDragonReady(page);
  await page.evaluate(() => bkmpIdleStopLoop()); // kein Hintergrund-Kampf-Loop soll parallel Ressourcen aendern
}

async function openWithoutLogin(page, qaServer) {
  await page.goto(qaServer.url('/'));
  await expect(page.locator('#mcNameOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await page.evaluate(() => { const h = document.querySelector('[data-qa-hide]'); if (h) h.click(); });
}

/* Roher Auth+RPC-Aufruf fuer einen zweiten Akteur, identisches Muster wie
   arena.spec.js/guild.spec.js's rpcAs(). */
async function rpcAs(qaServer, name, fnName, params) {
  const email = emailFromName(name);
  const tokenRes = await fetch(`${qaServer.baseURL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: QA_PASSWORD })
  });
  const tokenJson = await tokenRes.json();
  const token = tokenJson.access_token;
  const rpcRes = await fetch(`${qaServer.baseURL}/rest/v1/rpc/${fnName}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params || {})
  });
  const json = await rpcRes.json().catch(() => null);
  if (rpcRes.status >= 400) { const err = new Error(json && json.message); throw err; }
  return json;
}

test.describe('Weltboss-/Raid-Kernmechanik', () => {
  test('Beitritt ohne Login schlägt fehl', async ({ page, qaServer }) => {
    await openWithoutLogin(page, qaServer);
    const result = await page.evaluate((raidId) => window.joinRaid(raidId).then(() => 'ok').catch(e => String(e.message || e)), RAID_ID);
    expect(result).toMatch(/melde dich an/i);
  });

  test('Beitritt außerhalb der Vorbereitungsphase (Raid nicht aktiv) schlägt fehl', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    // FIGHT_START_MS liegt noch >5min in der Zukunft der Serveruhr - siehe
    // qaServer-Fixture (startTimeMs = FIGHT_START_MS - 3min => eigentlich SCHON
    // im Prep-Fenster). Fuer "nicht aktiv" die Uhr weit VOR das Prep-Fenster zurueckdrehen.
    qaServer.store.clock.setNow(FIGHT_START_MS - 60 * 60000);
    const result = await page.evaluate((raidId) => window.joinRaid(raidId).then(() => 'ok').catch(e => String(e.message || e)), RAID_ID);
    expect(result).toMatch(/Vorbereitungsphase/);
  });

  test('Beitritt während der Gildenboss-Stunde (Berlin 20 Uhr) schlägt fehl', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    // Die Sperre haengt nur an der Berlin-Stunde des RAID-Starts (siehe
    // GUILDBOSS_HOUR_RAID_ID-Kommentar oben), nicht an "jetzt" - die
    // Serveruhr steht bereits (aus der Fixture) im Vorbereitungsfenster
    // dieses Raids, keine zusaetzliche Zeitsteuerung noetig.
    qaServer.store.clock.setNow(Date.UTC(2026, 6, 24, 18, 0, 0) - 3 * 60000);
    const result = await page.evaluate((raidId) => window.joinRaid(raidId).then(() => 'ok').catch(e => String(e.message || e)), GUILDBOSS_HOUR_RAID_ID);
    expect(result).toMatch(/Gildenboss/);
  });

  test('Beitritt in der Vorbereitungsphase gelingt und skaliert Boss-/Stadt-HP exakt', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    const result = await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    // Angreifer: attack=100 -> 100*150=15000 < base_hp 500000 -> base_hp gewinnt.
    expect(result.bossMaxHp).toBe(500000);
    expect(result.bossHp).toBe(500000);
    // Stadt-HP = Summe der HP aller Teilnehmer (bisher nur der Angreifer, hp=10000).
    expect(result.cityHp).toBe(10000);
    expect(result.cityMaxHp).toBe(10000);

    const raw = await page.evaluate((raidId) => window.loadRaidState(raidId), RAID_ID);
    expect(raw.bossName).toBe('Zerathor, Zorn der Verdammnis');
    expect(raw.status).toBe('prep');
  });

  test('zweiter Teilnehmer erhöht Stadt-HP korrekt (Summenbildung)', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    await rpcAs(qaServer, HELPER_NAME, 'raid_join', { p_raid_id: RAID_ID });
    const raw = await page.evaluate((raidId) => window.loadRaidState(raidId), RAID_ID);
    expect(raw.cityMaxHp).toBe(15000); // 10000 (Angreifer) + 5000 (Helfer)
  });

  test('Schaden verringert Boss-HP exakt um den eingereichten Betrag', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID); // prep -> fighting

    const result = await page.evaluate((raidId) => window.submitRaidDamage(raidId, 12345, false, true), RAID_ID);
    expect(result.bossHp).toBe(500000 - 12345);
    expect(result.ownDamageDealt).toBe(12345);
    expect(result.ownClicksLanded).toBe(1);
    expect(result.status).toBe('fighting');
  });

  test('Boss-HP fällt nie unter 0 (Overkill-Schaden wird geklemmt)', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);
    // 3x 200000 (Deckel pro Treffer) = 600000 > boss_max_hp 500000.
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 200000, false, true), RAID_ID);
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 200000, false, true), RAID_ID);
    const result = await page.evaluate((raidId) => window.submitRaidDamage(raidId, 200000, false, true), RAID_ID);
    expect(result.bossHp).toBe(0);
    expect(result.status).toBe('won');
    expect(Number.isNaN(result.bossHp)).toBe(false);
  });

  test('ungültige Schadenswerte (0, negativ, zu groß, NaN, Infinity) werden abgelehnt', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);

    const cases = await page.evaluate(async (raidId) => {
      async function attempt(amount) {
        try { await window.submitRaidDamage(raidId, amount, false, false); return 'ok'; }
        catch (e) { return String(e && e.message || e); }
      }
      return {
        zero: await attempt(0),
        negative: await attempt(-500),
        tooLarge: await attempt(200001),
        nan: await attempt(NaN),
        infinity: await attempt(Infinity)
      };
    }, RAID_ID);
    // submitRaidDamage() in supabase.js wirft den rohen Server-Fehler nicht um
    // (kein try/catch mit deutscher Uebersetzung dort) - der RPC-Fehlertext
    // "invalid_amount" kommt direkt durch.
    Object.values(cases).forEach(msg => expect(msg).toMatch(/invalid_amount/));

    const state = await page.evaluate((raidId) => window.loadRaidState(raidId), RAID_ID);
    expect(state.bossHp).toBe(500000);
    expect(Number.isNaN(state.bossHp)).toBe(false);
  });

  test('Gegenangriff trifft die Stadt nach 5% Boss-HP-Fortschritt mit exaktem Schaden (1,4% der Stadt-Max-HP)', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID); // cityMaxHp=10000
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    /* Der ERSTE tick-Aufruf, der prep->fighting umschaltet, faellt in
       DERSELBEN Ausfuehrung direkt weiter in den 'fighting'-Zweig (echte
       SQL-Fassung macht das identisch, siehe combined-latest.sql Zeile 153+
       165) - next_boss_attack_at steht seit raid_join() bereits auf
       fight_starts_at, ein Tick 1s NACH Kampfbeginn ist also faellig und
       loest sofort einen ersten, von der 5%-Boss-HP-Regel UNABHAENGIGEN
       Stadt-Treffer aus. Baseline fuer die eigentliche Pruefung unten ist
       deshalb 9860 (10000 - 140), nicht die urspruengliche cityMaxHp. */
    await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);
    let state = await page.evaluate((raidId) => window.loadRaidState(raidId), RAID_ID);
    expect(state.cityHp).toBe(9860);

    // 5% von 500000 = 25000 - knapp darunter loest KEINEN weiteren (2.) Gegenangriff aus.
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 24999, false, false), RAID_ID);
    state = await page.evaluate((raidId) => window.loadRaidState(raidId), RAID_ID);
    expect(state.cityHp).toBe(9860); // unveraendert seit dem ersten Tick-Treffer

    // Der naechste Treffer ueberschreitet die 5%-Schwelle (kumulativ 25000+).
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 100, false, false), RAID_ID);
    state = await page.evaluate((raidId) => window.loadRaidState(raidId), RAID_ID);
    expect(state.cityHp).toBe(9860 - Math.round(10000 * 0.014)); // 9860 - 140 = 9720
  });

  test('parallele Angriffe zweier Spieler werden beide korrekt gezählt (Gesamtschaden = Summe)', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    await rpcAs(qaServer, HELPER_NAME, 'raid_join', { p_raid_id: RAID_ID });
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);

    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 30000, false, false), RAID_ID);
    await rpcAs(qaServer, HELPER_NAME, 'raid_deal_damage', { p_raid_id: RAID_ID, p_amount: 20000, p_is_crit: false, p_is_click: false });

    const state = await page.evaluate((raidId) => window.loadRaidState(raidId), RAID_ID);
    expect(state.totalDamage).toBe(50000);
    const participants = await page.evaluate((raidId) => window.loadRaidParticipants(raidId), RAID_ID);
    const atk = participants.find(p => p.displayName === ATTACKER_NAME);
    const help = participants.find(p => p.displayName === HELPER_NAME);
    expect(atk.damageDealt).toBe(30000);
    expect(help.damageDealt).toBe(20000);
  });

  test('Boss besiegt: Belohnung wird proportional zum Schadensanteil verteilt (exakte Beträge)', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    await rpcAs(qaServer, HELPER_NAME, 'raid_join', { p_raid_id: RAID_ID });
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);

    // Angreifer 400000 (80%), Helfer 100000 (20%) - Boss max 500000, exakt besiegt.
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 200000, false, false), RAID_ID);
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 200000, false, false), RAID_ID);
    await rpcAs(qaServer, HELPER_NAME, 'raid_deal_damage', { p_raid_id: RAID_ID, p_amount: 100000, p_is_crit: false, p_is_click: false });

    const state = await page.evaluate((raidId) => window.loadRaidState(raidId), RAID_ID);
    expect(state.status).toBe('won');

    const atkPlayer = await page.evaluate((name) => window.loadIdlePlayerState(name), ATTACKER_NAME);
    expect(atkPlayer.gold).toBe(Math.round(1500000 * 0.8));
    expect(atkPlayer.crystals).toBe(Math.round(1000 * 0.8));
    expect(atkPlayer.xp).toBe(Math.round(150000 * 0.8));
    expect(atkPlayer.wood).toBe(Math.round(50000 * 0.8));
    expect(atkPlayer.stone).toBe(Math.round(50000 * 0.8));
    expect(atkPlayer.essence).toBe(Math.round(2000 * 0.8));

    const helpPlayer = await page.evaluate((name) => window.loadIdlePlayerState(name), HELPER_NAME);
    expect(helpPlayer.gold).toBe(Math.round(1500000 * 0.2));

    const leaderboard = await page.evaluate(() => window.loadRaidLeaderboard());
    const atkStats = leaderboard.find(r => r.displayName === ATTACKER_NAME);
    expect(atkStats.totalBossesDefeated).toBe(1);
    expect(atkStats.totalMvpCount).toBe(1); // 80% > 20%, Angreifer ist MVP
  });

  test('REGRESSION: bkmpRaidSyncIdleStateAfterFinish() gleicht auch Holz/Stein/Essenz ab (nicht nur Gold/Kristalle/XP)', async ({ page, qaServer }) => {
    // Deckt den beim eigenen Testen gefundenen und sofort gefixten Bug ab
    // (siehe Kommentar in js/systems/bkmp-raid.js): raid_finish() vergibt seit
    // supabase-raid-boss-reward-share.sql (18.07.) auch Holz/Stein/Essenz,
    // der clientseitige Abgleich danach kannte bis zu diesem Fix nur
    // Gold/Kristalle/XP - ohne den Fix wuerde der naechste Autosave die
    // korrekt gutgeschriebene Holz-/Stein-/Essenz-Belohnung wieder auf 0
    // zuruecksetzen.
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);
    // 200000 ist der Anti-Cheat-Deckel PRO Treffer - 500000 Boss-HP brauchen
    // deshalb mindestens 3 Treffer.
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 200000, false, false), RAID_ID);
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 200000, false, false), RAID_ID);
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 100000, false, false), RAID_ID);

    await page.evaluate(() => window.bkmpRaidSyncIdleStateAfterFinish());
    const clientState = await page.evaluate(() => ({ gold: bkmpIdleState.gold, wood: bkmpIdleState.wood, stone: bkmpIdleState.stone, essence: bkmpIdleState.essence }));
    expect(clientState.gold).toBe(1500000);
    expect(clientState.wood).toBe(50000);
    expect(clientState.stone).toBe(50000);
    expect(clientState.essence).toBe(2000);
  });

  test('nach Sieg schlägt weiterer Schaden fehl (kein doppelter Abschluss / keine doppelte Belohnung)', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);
    // 200000 ist der Anti-Cheat-Deckel PRO Treffer (siehe invalid_amount-Test
    // oben) - 500000 Boss-HP brauchen deshalb mindestens 3 Treffer.
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 200000, false, false), RAID_ID);
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 200000, false, false), RAID_ID);
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 100000, false, false), RAID_ID);

    const goldAfterFirstWin = (await page.evaluate((name) => window.loadIdlePlayerState(name), ATTACKER_NAME)).gold;
    expect(goldAfterFirstWin).toBe(1500000);

    const err = await page.evaluate((raidId) => window.submitRaidDamage(raidId, 100, false, false).then(() => 'ok').catch(e => String(e.message || e)), RAID_ID);
    expect(err).toMatch(/raid_not_active/);

    const goldAfterSecondAttempt = (await page.evaluate((name) => window.loadIdlePlayerState(name), ATTACKER_NAME)).gold;
    expect(goldAfterSecondAttempt).toBe(1500000); // unveraendert - keine doppelte Gutschrift
  });

  test('Stadt-HP auf 0 beendet den Raid als Niederlage - keine Belohnung', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    // Sehr kleine Stadt-HP (hp=1), damit ein einzelner Gegenangriff (1,4% von
    // city_max_hp, mindestens 1) die Stadt sicher auf 0 wirft. raid_join()
    // liest hp vom SERVER-seitigen idle_player_state - bkmpIdleState (Client)
    // hier zu aendern haette keine Wirkung, die Store-Zeile muss direkt
    // angefasst werden (identisches Prinzip wie ein echter, sehr schwacher
    // Spieler, der beitritt).
    qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === ATTACKER_UID).hp = 1;
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    /* Der ERSTE tick-Aufruf schaltet prep->fighting UND wendet im selben
       Aufruf sofort den faelligen Stadt-Treffer an (next_boss_attack_at
       steht seit raid_join() bereits auf fight_starts_at - siehe Kommentar
       im "Gegenangriff"-Test oben). Bei city_max_hp=1 wirft bereits GENAU
       dieser erste Treffer (max(1, round(1*0.014))=1) die Stadt auf 0 - der
       Raid endet also schon hier als 'lost', BEVOR ueberhaupt Schaden am
       Boss eingereicht wurde. Ein anschliessender submitRaidDamage()-Aufruf
       wuerde folgerichtig mit 'raid_not_active' scheitern (Status ist nicht
       mehr 'fighting') - die eigentliche Pruefung gehoert deshalb direkt an
       die Tick-Antwort, nicht an einen (hier gar nicht mehr moeglichen)
       Schadens-Aufruf danach. */
    const tickResult = await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);
    expect(tickResult.status).toBe('lost');
    expect(tickResult.cityHp).toBe(0);

    const state = await page.evaluate((raidId) => window.loadRaidState(raidId), RAID_ID);
    expect(state.status).toBe('lost');
    expect(state.cityHp).toBe(0);

    const player = await page.evaluate((name) => window.loadIdlePlayerState(name), ATTACKER_NAME);
    expect(player.gold).toBe(0); // keine Belohnung bei Niederlage
  });

  test('Raid läuft nach Ablauf der Kampfzeit automatisch als "expired" aus - keine Belohnung', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 10000, false, false), RAID_ID);

    // 55 Minuten Kampfzeit ueberschritten.
    qaServer.store.clock.setNow(FIGHT_START_MS + 56 * 60000);
    const result = await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);
    expect(result.status).toBe('expired');

    const player = await page.evaluate((name) => window.loadIdlePlayerState(name), ATTACKER_NAME);
    expect(player.gold).toBe(0);
  });

  test('raid_boss_attack_tick wechselt prep->fighting exakt beim Start, nicht davor', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);

    // Noch 1s vor Kampfbeginn - Status muss 'prep' bleiben.
    qaServer.store.clock.setNow(FIGHT_START_MS - 1000);
    let state = await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);
    expect(state.status).toBe('prep');

    qaServer.store.clock.setNow(FIGHT_START_MS);
    state = await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);
    expect(state.status).toBe('fighting');
  });

  test('Reload nach einem Sieg zeigt den bereits gutgeschriebenen Ressourcenstand', async ({ page, qaServer }) => {
    await login(page, qaServer, ATTACKER_NAME);
    await page.evaluate((raidId) => window.joinRaid(raidId), RAID_ID);
    qaServer.store.clock.setNow(FIGHT_START_MS + 1000);
    await page.evaluate((raidId) => window.tickRaidBossAttack(raidId), RAID_ID);
    // 200000 ist der Anti-Cheat-Deckel PRO Treffer (siehe invalid_amount-Test
    // oben) - 500000 Boss-HP brauchen deshalb mindestens 3 Treffer.
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 200000, false, false), RAID_ID);
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 200000, false, false), RAID_ID);
    await page.evaluate((raidId) => window.submitRaidDamage(raidId, 100000, false, false), RAID_ID);

    /* Echter, im Code selbst dokumentierter Bug-Mechanismus (siehe
       bkmpRaidSyncIdleStateAfterFinish()-Kommentar in bkmp-raid.js): raid_finish()
       vergibt die Belohnung serverseitig atomar - der lokale bkmpIdleState
       weiss davon nichts, solange niemand ihn abgleicht. Im echten Spiel
       macht bkmpRaidCheckOutcome() das automatisch, sobald der Spieler die
       Kampfansicht sieht. Dieser Test ruft die RPC-Wrapper bewusst direkt
       auf (siehe Datei-Kopfkommentar) und durchlaeuft diese UI-Kette nie -
       ohne den expliziten Abgleich hier wuerde der naechste Autosave
       (page.reload() loest via beforeunload sofort einen aus) den
       serverseitig laengst gutgeschriebenen Betrag mit dem veralteten
       (0-Gold-)Client-Stand ueberschreiben. Das ist exakt derselbe reale
       Mechanismus, den bkmpRaidSyncIdleStateAfterFinish() im echten Spiel
       verhindert - hier wird dieselbe, echte Funktion aufgerufen statt
       eines Test-Workarounds. */
    await page.evaluate(() => window.bkmpRaidSyncIdleStateAfterFinish());

    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    /* beforeunload (ausgeloest von page.reload()) stempelt last_seen_at
       unconditional mit der ECHTEN Wanduhrzeit (idledorf.js bkmpIdleFlushSync,
       nicht GameClock/store.clock-bewusst - siehe CLAUDE.md "Nur EINE
       Zeitstelle migriert"). Die Offline-Fortschritts-Simulation beim
       gleich folgenden Oeffnen vergleicht das aber gegen store.clock (siehe
       tests/mock/offline-progress-handler.js) - steht store.clock (hier
       kuenstlich auf eine gueltige Raid-Kampfstunde gelegt) deutlich VOR der
       echten Wanduhrzeit zum Testlaufzeitpunkt, wuerde das faelschlich eine
       mehrstuendige "Abwesenheit" ergeben und eine echte, aber fuer DIESEN
       Test voellig fachfremde Offline-Kampf-Simulation ausloesen (beim
       eigenen Testen genau so gefunden: ploetzlich +9000 Gold aus 561
       simulierten Drachenkills). Fix: last_seen_at unmittelbar vor dem
       Oeffnen (das den Offline-Abgleich ausloest) wieder auf store.clock
       zurechtruecken - identisch zu dem, was ein echter, kontinuierlich
       online bleibender Client ohnehin fortlaufend selbst taete. */
    qaServer.store.tables.idle_player_state.find(r => r.auth_user_id === ATTACKER_UID).last_seen_at = qaServer.store.clock.nowIso();
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForIdleStateReady(page);
    // Die neu geladene Seite startet ihren EIGENEN, frischen Auto-Tick-Loop -
    // der fruehere Stop aus login() gilt nur fuer die urspruengliche Seite.
    // Ohne diesen zweiten Stop koennte der neue Loop vor dem folgenden
    // Server-Read bereits weitere, mit dem Raid-Sieg nicht zusammenhaengende
    // Kampf-Belohnungen aufsummieren und autospeichern.
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    // Serverseitige Wahrheit pruefen (nicht bkmpIdleState) - robust gegen
    // jede clientseitige Timing-Feinheit rund um den frischen Seitenaufbau.
    const player = await page.evaluate((name) => window.loadIdlePlayerState(name), ATTACKER_NAME);
    expect(player.gold).toBe(1500000);
    expect(player.wood).toBe(50000);
    expect(player.stone).toBe(50000);
    expect(player.essence).toBe(2000);
  });

  /* REGRESSION (25.07.2026, Nutzer-Auftrag "Minimierungs-Button am
     Raidboss-Banner entfernen"): der Knopf (bkmpRaidBannerSetMinimized(),
     #raidBannerMinimizeBtn) brachte laut Nutzer kaum Nutzen, sparte
     praktisch keinen Platz und wirkte optisch stoerend - vollstaendig
     entfernt (Markup in bkmpRaidRenderJoinBanner(), Event-Handling, der
     sessionStorage-Minimierungs-Zustand selbst, sowie die zugehoerigen
     CSS-Regeln .raid-join-banner-minimize/.raid-join-banner-minimized).
     Dieser Test prueft, dass der Banner trotzdem weiterhin vollstaendig
     funktioniert (Timer, Anmeldestatus in beiden Zustaenden) UND dass der
     Knopf wirklich nirgends mehr im DOM auftaucht - weder vor noch nach
     einem Beitritt. */
  test('REGRESSION: Raidboss-Banner zeigt Timer+Status ohne Minimierungs-Button', async ({ page, qaServer }) => {
    /* bkmpRaidGetPhaseInfo() (js/systems/bkmp-raid.js) nutzt ohne explizites
       `now`-Argument die ECHTE Browser-Wanduhr (new Date()), NICHT
       qaServer.store.clock (das nur die serverseitigen RPCs betrifft, siehe
       Datei-Kopfkommentar oben) - der Banner selbst wird ausschliesslich
       darüber gerendert, welcher Raid GERADE JETZT (echte Uhrzeit) laeuft.
       Ohne eine gefakte Browser-Uhr wuerde der Banner den (uninteressanten)
       Raid der tatsaechlichen aktuellen Stunde zeigen, nicht RAID_ID/
       FIGHT_START_MS aus der Fixture - Playwrights eigene Clock-API friert
       die Browser-Uhr exakt auf denselben Zeitpunkt ein, den auch
       qaServer.store.clock/die Fixture-Zeitstempel schon nutzen (identisches
       Muster wie login-streak.spec.js/dungeon-time.spec.js). */
    await page.clock.install({ time: FIGHT_START_MS - 3 * 60000 });
    await login(page, qaServer, ATTACKER_NAME);

    const banner = page.locator('#raidJoinBanner');
    await expect(banner).toBeVisible();
    await expect(page.locator('#raidBannerMinimizeBtn')).toHaveCount(0);
    await expect(page.locator('.raid-join-banner-minimize')).toHaveCount(0);

    // Timer sichtbar und nicht leer.
    const countdown = page.locator('#raidBannerCountdown');
    await expect(countdown).toBeVisible();
    await expect(countdown).not.toHaveText('');

    // Status vor dem Beitritt: Beitreten-Button sichtbar, keine
    // "Angemeldet"-Anzeige.
    await expect(page.locator('#raidJoinBtn')).toBeVisible();
    await expect(banner.locator('.raid-join-banner-joined')).toHaveCount(0);

    // Nach dem Beitritt: Status wechselt korrekt auf "Angemeldet", der
    // Knopf bleibt weiterhin komplett abwesend (Beweis, dass er nicht nur
    // im Anfangszustand fehlt, sondern bei JEDEM Neu-Rendern des Banners).
    await page.evaluate((raidId) => window.bkmpRaidJoin(raidId), RAID_ID);
    await expect(page.locator('#raidJoinBtn')).toHaveCount(0);
    await expect(banner.locator('.raid-join-banner-joined')).toBeVisible();
    await expect(banner.locator('.raid-join-banner-joined')).toContainText('Angemeldet');
    await expect(page.locator('#raidBannerMinimizeBtn')).toHaveCount(0);
    await expect(page.locator('.raid-join-banner-minimize')).toHaveCount(0);

    // Kein CSS-Rest der entfernten Funktion mehr aktiv.
    await expect(banner).not.toHaveClass(/raid-join-banner-minimized/);
  });
});
