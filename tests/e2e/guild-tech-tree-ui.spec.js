/* Gilden-Technologie v3 (31.07.2026, siehe CLAUDE.md/Plan
   zazzy-crunching-plum.md) - Stufe 3, UI-Ebene (SVG-Baum-Rendering,
   Beitrags-Modal, Rangliste, "gesperrt"-Toast). Die RPC-Ebene selbst ist
   bereits vollstaendig in tests/e2e/guild-tech-tree.spec.js bewiesen (kein
   UI-Login noetig dort) - diese Datei prueft nur den neuen Client-Code
   (js/systems/bkmp-guild-tech.js, js/ui/bkmp-ui-components.js#bkmpUiGuildTechTreeHtml).

   Gleicher 6-Knoten-Beispiel-Baum wie guild-tech-tree.spec.js (identisch zum
   Stufe-1-Seed in sql/20260731-guild-tech-tree-v2-foundation.sql), alle 6
   Knoten sind Kategorie 'schlacht' - die 'wachstum'-Kategorie ist in dieser
   Fixture bewusst leer (deckt den Leerzustand "Noch keine Technologien in
   dieser Kategorie" mit ab). */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const LEADER_NAME = 'QaTechUiLeader';
const LEADER_UID = 'qa-techui-leader-0000';

const EXAMPLE_NODES = [
  { id: 'attack', category: 'schlacht', label: 'Angriff', description: '+7% Angriff pro Stufe.', icon: '⚔️', effect_type: 'attackPct', effect_per_tier: 7, max_tier: 5, base_gold_cost: 2000000, cost_growth: 1.5, attempts_per_tier: 25, prereq_node_ids: [], pos_x: 100, pos_y: 50 },
  { id: 'defense', category: 'schlacht', label: 'Verteidigung', description: '+7% Verteidigung pro Stufe.', icon: '🛡️', effect_type: 'defensePct', effect_per_tier: 7, max_tier: 5, base_gold_cost: 2000000, cost_growth: 1.5, attempts_per_tier: 25, prereq_node_ids: [], pos_x: 300, pos_y: 50 },
  { id: 'crit_chance', category: 'schlacht', label: 'Kritchance', description: '+2,1% Kritchance pro Stufe.', icon: '🎯', effect_type: 'critChancePct', effect_per_tier: 2.1, max_tier: 5, base_gold_cost: 2000000, cost_growth: 1.5, attempts_per_tier: 25, prereq_node_ids: [], pos_x: 500, pos_y: 50 },
  { id: 'crit_damage', category: 'schlacht', label: 'Kritischer Schaden', description: '+14% kritischer Schaden pro Stufe.', icon: '💥', effect_type: 'critDamagePct', effect_per_tier: 14, max_tier: 5, base_gold_cost: 2500000, cost_growth: 1.55, attempts_per_tier: 25, prereq_node_ids: ['attack'], pos_x: 100, pos_y: 200 },
  { id: 'boss_damage', category: 'schlacht', label: 'Bossschaden', description: '+17,5% Bossschaden pro Stufe.', icon: '🐉', effect_type: 'bossDamagePct', effect_per_tier: 17.5, max_tier: 5, base_gold_cost: 2500000, cost_growth: 1.55, attempts_per_tier: 25, prereq_node_ids: ['defense', 'crit_chance'], pos_x: 400, pos_y: 200 },
  { id: 'guild_kriegsrat', category: 'schlacht', label: 'Kriegsrat', description: '+3 zusätzliche Arena-Angriffe pro Tag pro Stufe.', icon: '🗡️', effect_type: 'arenaExtraAttempts', effect_per_tier: 3, max_tier: 5, base_gold_cost: 3000000, cost_growth: 1.6, attempts_per_tier: 25, prereq_node_ids: ['crit_damage', 'boss_damage'], pos_x: 250, pos_y: 350 }
];

function fixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  const row = makePlayerStateRow(LEADER_UID, LEADER_NAME.toLowerCase(), nowIso, { display_name: LEADER_NAME, gold: 100000000 });
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
      guilds: [{ id: 'g1', name: 'Testgilde UI', tag: 'GUI', treasury_gold: 1000000, member_count: 1, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: LEADER_UID, created_at: nowIso }],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, tech_contributed_gold: 0, joined_at: nowIso }
      ],
      guild_tech_nodes: EXAMPLE_NODES.map(n => ({ ...n })),
      guild_tech_progress: [], guild_tech_contributor_attempts: [],
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
  await page.locator('#idleTabBtnGildeTech').click();
  await expect(page.locator('#idlePanelGildeTech')).toBeVisible();
}

test.describe('Gilden-Technologie v3: Baum-Panel (UI-Ebene)', () => {
  test('Panel zeigt Beitragsversuche 5/5 und die leere Wachstums-Kategorie als Leerzustand', async ({ page, qaServer }) => {
    await login(page, qaServer);
    await expect(page.locator('#idlePanelGildeTech')).toContainText('5/5');
    // Standard-Kategorie ist 'wachstum' - in dieser Fixture bewusst leer.
    await expect(page.locator('#idlePanelGildeTech .idle-guild-tech-tree-wrap')).toContainText('Noch keine Technologien in dieser Kategorie');
  });

  test('Schlacht-Kategorie zeigt alle 6 Knoten mit korrektem gesperrt/verfuegbar-Zustand', async ({ page, qaServer }) => {
    await login(page, qaServer);
    await page.locator('.idle-guild-tech-category-tab[data-category="schlacht"]').click();
    const nodes = page.locator('.bkmp-guild-tech-node');
    await expect(nodes).toHaveCount(6);
    await expect(page.locator('.bkmp-guild-tech-node[data-node-id="attack"]')).toHaveClass(/state-available/);
    await expect(page.locator('.bkmp-guild-tech-node[data-node-id="defense"]')).toHaveClass(/state-available/);
    await expect(page.locator('.bkmp-guild-tech-node[data-node-id="crit_chance"]')).toHaveClass(/state-available/);
    await expect(page.locator('.bkmp-guild-tech-node[data-node-id="crit_damage"]')).toHaveClass(/state-locked/);
    await expect(page.locator('.bkmp-guild-tech-node[data-node-id="boss_damage"]')).toHaveClass(/state-locked/);
    await expect(page.locator('.bkmp-guild-tech-node[data-node-id="guild_kriegsrat"]')).toHaveClass(/state-locked/);
  });

  test('Klick auf gesperrten Knoten zeigt einen Hinweis-Toast statt das Modal zu oeffnen', async ({ page, qaServer }) => {
    await login(page, qaServer);
    await page.locator('.idle-guild-tech-category-tab[data-category="schlacht"]').click();
    await page.locator('.bkmp-guild-tech-node[data-node-id="crit_damage"]').click();
    await expect(page.locator('.bkmp-jannik-toast.visible')).toContainText('Vorbedingungen');
    await expect(page.locator('#bkmpGuildTechContributeOverlay')).toHaveCount(0);
  });

  test('Klick auf verfuegbaren Knoten oeffnet das Modal mit korrekten Werten, Beitragen aktualisiert Gold/Fortschritt/Versuche, Modal bleibt offen', async ({ page, qaServer }) => {
    await login(page, qaServer);
    await page.locator('.idle-guild-tech-category-tab[data-category="schlacht"]').click();
    await page.locator('.bkmp-guild-tech-node[data-node-id="attack"]').click();

    const overlay = page.locator('#bkmpGuildTechContributeOverlay');
    await expect(overlay).toHaveClass(/visible/);
    await expect(page.locator('#bkmpGuildTechModalTitle')).toContainText('Angriff');
    await expect(page.locator('#bkmpGuildTechModalProgress')).toContainText('Stufe 0/5');
    // round(2.000.000/25) = 80.000 - bkmpIdleFormatNumber() zeigt das abgekuerzt als "80K".
    await expect(page.locator('#bkmpGuildTechModalMeta')).toContainText('80K Gold');

    const goldBefore = await page.evaluate(() => bkmpIdleState.gold);
    await page.locator('#bkmpGuildTechModalContributeBtn').click();
    await expect(page.locator('#bkmpGuildTechModalMeta')).toContainText('Beitragsversuche heute: 4/5');

    const goldAfter = await page.evaluate(() => bkmpIdleState.gold);
    expect(goldAfter).toBe(goldBefore - 80000);

    // Modal blieb offen (siehe bkmpGuildTechHandleContributeClick-Kommentar:
    // das Modal haengt in document.body, ein voller Panel-Re-Render loescht
    // es nicht) UND der Hintergrund-Baum wurde mit aktualisiert.
    await expect(overlay).toHaveClass(/visible/);
    await expect(page.locator('#idlePanelGildeTech')).toContainText('4/5');
    const barWidth = await page.locator('#bkmpGuildTechModalBarFill').evaluate(el => el.style.width);
    expect(parseFloat(barWidth)).toBeGreaterThan(0);

    await page.locator('#bkmpGuildTechModalCloseBtn').click();
    await expect(overlay).not.toHaveClass(/visible/);
  });

  test('Rangliste zeigt den beitragenden Spieler nach einem Beitrag', async ({ page, qaServer }) => {
    await login(page, qaServer);
    await page.locator('.idle-guild-tech-category-tab[data-category="schlacht"]').click();
    await page.locator('.bkmp-guild-tech-node[data-node-id="defense"]').click();
    await page.locator('#bkmpGuildTechModalContributeBtn').click();
    await page.locator('#bkmpGuildTechModalCloseBtn').click();
    await expect(page.locator('#idlePanelGildeTech')).toContainText('🏆 Technologie-Rangliste');
    await expect(page.locator('#idlePanelGildeTech')).toContainText(LEADER_NAME);
    await expect(page.locator('#idlePanelGildeTech')).toContainText('80K'); // bkmpIdleFormatNumber(80000)
  });

  /* Regression (01.08.2026, Nutzer-Screenshot: "0/5 - Naechster in
     00:00:00" nach dem letzten Beitrag). Root Cause per temporaerem
     Diagnose-Test bewiesen: guild_tech_contribute() liefert
     seconds_to_next_attempt bewusst IMMER als 0 zurueck (echte Berechnung
     braucht guild_tech_attempt_status()) - der Client patchte bisher nur
     .attempts und liess .secondsToNext auf dem alten "voll"-Stand (0)
     stehen, bis der Countdown-Ticker eine Sekunde spaeter selbst nachlud.
     Fuer den Spieler wirkte das wie ein haengender 00:00:00-Countdown.
     Fix: bkmpGuildTechHandleContributeClick() laedt den echten Stand jetzt
     SOFORT nach, kein falscher Zwischenzustand mehr sichtbar. */
  test('REGRESSION: nach dem letzten Beitragsversuch zeigt der Countdown sofort die echte Wartezeit, nie 00:00:00', async ({ page, qaServer }) => {
    await login(page, qaServer);
    await page.locator('.idle-guild-tech-category-tab[data-category="schlacht"]').click();
    await page.locator('.bkmp-guild-tech-node[data-node-id="attack"]').click();

    for (let i = 0; i < 5; i++) {
      await page.locator('#bkmpGuildTechModalContributeBtn').click();
    }

    // Sofortiger Zustand direkt nach dem 5. (letzten) Beitrag - VOR jedem
    // Ticker-Tick (der laeuft erst nach 1s) - muss bereits korrekt sein.
    const attemptsLine = page.locator('#idlePanelGildeTech .idle-guild-tech-attempts');
    await expect(attemptsLine).toContainText('0/5');
    await expect(attemptsLine).not.toContainText('00:00:00');
    const countdownText = await page.locator('#idleGuildTechCountdown').textContent();
    expect(countdownText).not.toBe('00:00:00');
    expect(countdownText).toMatch(/^0[34]:\d{2}:\d{2}$/); // ~4h (bewusst grosszuegig: 03:xx oder 04:00:00 je nach Timing)
  });
});
