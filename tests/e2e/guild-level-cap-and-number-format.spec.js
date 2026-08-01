/* Gilden-Level-Ausbau auf Deckel 100 (01.08.2026, siehe CLAUDE.md/sql/
   20260801-guild-level-cap-100.sql) - Nutzerwunsch: "es gibt schon paar
   Gilden die lvl 30 max haben und sich langweilen.. also ruhig auf lvl 100
   direkt und wie gesagt die Gold kurve muss steigen".

   Zwei getrennte Dinge werden hier geprueft:

   1) bkmpIdleFormatNumber() (js/core/bkmp-combat-math.js) - bisher endete
      die Abkuerzung bei 'M' (Millionen), obwohl Level 30 bereits VOR diesem
      Ausbau 14.300.000.000 (14,3 Milliarden) XP brauchte - waere faelschlich
      als "14300M" statt "14,3B" erschienen. Reine Funktionstests, kein
      Login/Server noetig.

   2) bkmpGuildLevelInfo()/die Fortschrittsbalken-UI (js/systems/bkmp-
      guild.js) sind bereits vollstaendig daten-getrieben (kein hartcodiertes
      "Level 30 ist Schluss" irgendwo im Code, siehe Recherche vor dieser
      Aenderung) - ein Test beweist das direkt: die Mock-Tabelle
      guild_level_thresholds (generisch, schema-agnostisch ueber
      tests/mock/rest-engine.js, wird von keiner bestehenden Fixture
      geseedet) wird hier gezielt bis Level 100 befuellt und bewiesen, dass
      eine Gilde mit XP weit ueber der alten 14,3-Milliarden-Grenze korrekt
      ein hoeheres Level UND keinen verfruehten "Maximales Level erreicht"-
      Text zeigt. */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const LEADER_NAME = 'QaLvlCapLeader';
const LEADER_UID = 'qa-lvlcap-leader-0000';

// 1:1 aus sql/20260801-guild-level-cap-100.sql uebernommen - reicht als
// repraesentative Teilmenge fuer den Test (nicht alle 100 Zeilen noetig,
// die Formel selbst wird nicht erneut geprueft, nur dass die UI beliebig
// viele Zeilen korrekt konsumiert).
const LEVEL_THRESHOLDS = [
  { level: 1, xp_required: 0 }, { level: 29, xp_required: 12200000000 }, { level: 30, xp_required: 14300000000 },
  { level: 31, xp_required: 16736000000 }, { level: 50, xp_required: 334100000000 },
  { level: 99, xp_required: 3942000000000000 }, { level: 100, xp_required: 4906000000000000 }
];

function fixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  const row = makePlayerStateRow(LEADER_UID, LEADER_NAME.toLowerCase(), nowIso, { display_name: LEADER_NAME, gold: 1000000 });
  const user = { id: LEADER_UID, email: emailFromName(LEADER_NAME), password: QA_PASSWORD, user_metadata: {} };
  return {
    startTimeMs,
    displayName: LEADER_NAME, nameKey: LEADER_NAME.toLowerCase(), authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME), password: QA_PASSWORD,
    users: [user],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [row],
      idle_prestige_state: [], idle_player_runes: [],
      guilds: [{ id: 'g1', name: 'Testgilde Lvl', tag: 'LVL', treasury_gold: 0, guild_xp: 0, member_count: 1, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: LEADER_UID, created_at: nowIso }],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, tech_contributed_gold: 0, joined_at: nowIso }
      ],
      guild_level_thresholds: LEVEL_THRESHOLDS.map(r => ({ ...r })),
      guild_tech_levels: [], guild_activity_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, fixture(startTimeMs)), { startTimeMs: Date.now() });
    await use(server);
    await server.close();
  }
});

test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks - kompakte Navigation deckt mobile-smoke.spec.js bereits ab');
});

async function login(page, server) {
  await page.goto(server.url('/'));
  const overlay = page.locator('#mcNameOverlay');
  await expect(overlay).toHaveClass(/visible/, { timeout: 15000 });
  await page.evaluate(() => { const h = document.querySelector('[data-qa-hide]'); if (h) h.click(); });
  await page.locator('#mcAuthName').fill(LEADER_NAME);
  await page.locator('#mcAuthPassword').fill(QA_PASSWORD);
  await page.locator('#mcAuthSubmit').click();
  await expect(overlay).not.toHaveClass(/visible/, { timeout: 15000 });
  await page.locator('#idleDorfButton').click();
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await waitForIdleStateReady(page);
  await waitForDragonReady(page);
  await page.evaluate(() => bkmpIdleStopLoop());
}

test.describe('bkmpIdleFormatNumber() - erweiterte Grosszahlen-Abkuerzungen (B/T/Qa)', () => {
  test('Werte unter 1 Milliarde bleiben unveraendert (K/M wie zuvor)', async ({ page, qaServer }) => {
    await login(page, qaServer);
    const results = await page.evaluate(() => [
      bkmpIdleFormatNumber(0), bkmpIdleFormatNumber(999), bkmpIdleFormatNumber(1500),
      bkmpIdleFormatNumber(2500000), bkmpIdleFormatNumber(999999999)
    ]);
    expect(results).toEqual(['0', '999', '1.5K', '2.5M', '1000M']);
  });

  test('Milliarden/Billionen/Billiarden bekommen jetzt B/T/Qa statt eines falsch riesigen M-Werts', async ({ page, qaServer }) => {
    await login(page, qaServer);
    const results = await page.evaluate(() => [
      bkmpIdleFormatNumber(1000000000),        // exakt 1B
      bkmpIdleFormatNumber(14300000000),       // Level 30 (alter Deckel) - vorher faelschlich "14300M"
      bkmpIdleFormatNumber(1000000000000),     // exakt 1T
      bkmpIdleFormatNumber(4906000000000000)   // Level 100 (neuer Deckel)
    ]);
    expect(results).toEqual(['1B', '14.3B', '1T', '4.91Qa']);
  });
});

test.describe('Gildenlevel jenseits des alten Deckels 30 (daten-getriebene Kurve, keine Code-Aenderung noetig)', () => {
  test('Gilde mit XP weit ueber der alten Level-30-Grenze zeigt korrekt ein hoeheres Level, kein verfruehtes "Maximales Level"', async ({ page, qaServer }) => {
    await login(page, qaServer);
    // Direkt auf einen Wert zwischen Level 50 und 99 setzen (weit ueber dem
    // alten Deckel von 14,3 Mrd. XP/Level 30) - Server-Stand direkt gesetzt
    // (kein eigenes contribute_gold-RPC noetig, reiner Lese-Pfad-Test),
    // Panel danach ueber den echten Codepfad neu geladen.
    qaServer.store.tables.guilds.find(g => g.id === 'g1').guild_xp = 400000000000; // 400 Mrd.
    await page.evaluate(() => { bkmpGuildLoaded = false; });
    await page.locator('#idleTabBtnGilde').click();
    await expect(page.locator('#idlePanelGilde')).toContainText('Level 50');
    await expect(page.locator('#idlePanelGilde')).not.toContainText('Maximales Level erreicht');
  });

  test('Gilde exakt auf der neuen Maximalstufe (Level 100) zeigt "Maximales Level erreicht!"', async ({ page, qaServer }) => {
    await login(page, qaServer);
    qaServer.store.tables.guilds.find(g => g.id === 'g1').guild_xp = 4906000000000000;
    await page.evaluate(() => { bkmpGuildLoaded = false; });
    await page.locator('#idleTabBtnGilde').click();
    await expect(page.locator('#idlePanelGilde')).toContainText('Level 100');
    await expect(page.locator('#idlePanelGilde')).toContainText('Maximales Level erreicht!');
  });
});
