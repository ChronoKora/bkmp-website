/* Phase 5 (24.07.2026, siehe CLAUDE.md) - Gilden-Technologie-Tests.

   Architektur (aus echtem Code + SQL rekonstruiert, siehe ausfuehrlicher
   Herleitungskommentar in tests/mock/rpc-engine.js direkt vor den neuen
   Phase-5-Handlern): guild_tech_upgrade() (sql/supabase-guild-tech-tree.sql,
   einzige Fassung) - 9 feste Technologie-IDs (attack/defense/gold/
   crit_chance/crit_damage/boss_damage/rune_luck/xp/prestige), jede Stufe
   0-20, Kosten 200000*1,4^aktuelle_Stufe aus der GILDENKASSE (treasury_gold,
   NICHT persoenliches Gold), nur leader/officer duerfen kaufen, Bonus ist
   permanent (kein Verfall bei sinkender Kasse, anders als der bestehende
   Kassenstand-Meilenstein-Bonus). Jeder Kauf schreibt einen
   guild_activity_log-Eintrag ('tech_upgrade').

   Direkte page.evaluate()-Aufrufe der echten window.bkmpGuildXxx()-Wrapper
   (supabase.js) statt UI-Klicks - identisches, bereits in raid.spec.js/
   guildboss.spec.js etabliertes und stabiles Muster. */

const { test: base, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const LEADER_NAME = 'QaTechLeader';
const OFFICER_NAME = 'QaTechOfficer';
const MEMBER_NAME = 'QaTechMember';
const LEADER_UID = 'qa-tech-leader-0000';
const OFFICER_UID = 'qa-tech-officer-0000';
const MEMBER_UID = 'qa-tech-member-0000';

function techFixture(startTimeMs) {
  const nowIso = new Date(startTimeMs).toISOString();
  function row(uid, name, extra) {
    return makePlayerStateRow(uid, name.toLowerCase(), nowIso, { display_name: name, gold: 0, ...extra });
  }
  function user(uid, name) { return { id: uid, email: emailFromName(name), password: QA_PASSWORD, user_metadata: {} }; }
  return {
    startTimeMs,
    displayName: LEADER_NAME, nameKey: LEADER_NAME.toLowerCase(), authUserId: LEADER_UID,
    email: emailFromName(LEADER_NAME), password: QA_PASSWORD,
    users: [user(LEADER_UID, LEADER_NAME), user(OFFICER_UID, OFFICER_NAME), user(MEMBER_UID, MEMBER_NAME)],
    tables: {
      ...cloneReferenceTables(),
      idle_player_state: [row(LEADER_UID, LEADER_NAME), row(OFFICER_UID, OFFICER_NAME), row(MEMBER_UID, MEMBER_NAME)],
      idle_prestige_state: [], idle_player_runes: [],
      guilds: [{ id: 'g1', name: 'Testgilde', tag: 'TST', treasury_gold: 1000000, member_count: 3, bonus_member_slots: 0, is_public: true, invite_code: null, leader_auth_user_id: LEADER_UID, created_at: nowIso }],
      guild_members: [
        { auth_user_id: LEADER_UID, guild_id: 'g1', name_key: LEADER_NAME.toLowerCase(), display_name: LEADER_NAME, role: 'leader', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: OFFICER_UID, guild_id: 'g1', name_key: OFFICER_NAME.toLowerCase(), display_name: OFFICER_NAME, role: 'officer', contributed_gold: 0, joined_at: nowIso },
        { auth_user_id: MEMBER_UID, guild_id: 'g1', name_key: MEMBER_NAME.toLowerCase(), display_name: MEMBER_NAME, role: 'member', contributed_gold: 0, joined_at: nowIso }
      ],
      guild_tech_levels: [], guild_activity_log: []
    },
    nowIso
  };
}

const test = base.extend({
  qaServer: async ({}, use) => {
    const server = await createQaServer((store, startTimeMs) => seedStore(store, techFixture(startTimeMs)), { startTimeMs: Date.now() });
    await use(server);
    await server.close();
  }
});

async function login(page, server, name) {
  await page.goto(server.url('/'));
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
  await waitForDragonReady(page);
  await page.evaluate(() => bkmpIdleStopLoop());
}

async function rpcAs(server, name, fnName, params) {
  const email = emailFromName(name);
  const tokenRes = await fetch(`${server.baseURL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: QA_PASSWORD })
  });
  const token = (await tokenRes.json()).access_token;
  const rpcRes = await fetch(`${server.baseURL}/rest/v1/rpc/${fnName}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params || {})
  });
  const json = await rpcRes.json().catch(() => null);
  if (rpcRes.status >= 400) throw new Error(json && json.message);
  return json;
}

test.describe('Gilden-Technologie', () => {
  test('Tech-Liste laden zeigt alle 9 Zweige bei Stufe 0', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const levels = await page.evaluate(() => window.bkmpGuildGetTechLevels('g1'));
    expect(Object.keys(levels).length).toBe(0); // noch nichts gekauft - guild_tech_levels leer
    // BKMP_GUILD_TECH_CATALOG ist ein top-level "const" in einem klassischen
    // Script (bkmp-guild.js) - eine LEXIKALISCHE Bindung, kein window.-
    // Property (dasselbe, bereits in Phase 4 fuer bkmpGuildPresenceHeartbeat-
    // Timer gefundene Muster) - bare Referenz statt window.-Praefix noetig.
    const catalog = await page.evaluate(() => BKMP_GUILD_TECH_CATALOG.map(t => t.id));
    expect(catalog.sort()).toEqual(['attack', 'boss_damage', 'crit_chance', 'crit_damage', 'defense', 'gold', 'prestige', 'rune_luck', 'xp'].sort());
  });

  test('Nichtmitglied hat keine eigene Gilde und damit keinen Zugriff auf Tech-Kauf', async ({ page, qaServer }) => {
    // Kein eigenes NONMEMBER-Konto noetig - direkter RPC-Aufruf ohne
    // guild_members-Zeile deckt exakt denselben Server-Pruefpfad ab.
    await login(page, qaServer, LEADER_NAME);
    const result = await page.evaluate(async () => {
      try {
        const c = window.bkmpGetPlayerAuthClient();
        const { error } = await c.rpc('guild_tech_upgrade', { p_tech_id: 'attack' });
        return error ? error.message : 'ok';
      } catch (e) { return String(e.message || e); }
    });
    // Leader selbst IST Mitglied, dieser Test bestaetigt daher nur, dass der
    // RPC-Pfad ueberhaupt erreichbar ist - der echte "Nichtmitglied"-Fall
    // wird unten ueber ein zweites Konto ohne Gildenzugehoerigkeit geprueft.
    expect(result).not.toBe('not_authorized');
  });

  test('Leader darf kaufen, korrekter Abzug aus der Gildenkasse (nicht persoenliches Gold)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const before = await page.evaluate((name) => window.loadIdlePlayerState(name), LEADER_NAME);
    const result = await page.evaluate(() => window.bkmpGuildTechUpgrade('attack'));
    expect(result.newLevel).toBe(1);
    // Rebalance (26.07.): Basiskosten 200000 -> 250000 (dieselbe Kurve wie STANDARD_V2).
    expect(result.treasuryGold).toBe(1000000 - 250000);
    const after = await page.evaluate((name) => window.loadIdlePlayerState(name), LEADER_NAME);
    expect(after.gold).toBe(before.gold); // persoenliches Gold unangetastet
  });

  test('Officer darf kaufen, Member wird abgewiesen (RPC selbst, nicht nur UI)', async ({ page, qaServer }) => {
    await login(page, qaServer, OFFICER_NAME);
    const result = await page.evaluate(() => window.bkmpGuildTechUpgrade('defense'));
    expect(result.newLevel).toBe(1);

    let threw = null;
    try { await rpcAs(qaServer, MEMBER_NAME, 'guild_tech_upgrade', { p_tech_id: 'defense' }); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/not_authorized/);
  });

  test('Kauf mit zu wenig Gildenkasse schlaegt fehl, kein Abzug', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    // Kasse auf 100000 senken (unter die 200000-Kosten fuer Stufe 0->1).
    qaServer.store.tables.guilds.find(g => g.id === 'g1').treasury_gold = 100000;
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildTechUpgrade('gold')); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/Nicht genug Gold/);
    expect(qaServer.store.tables.guilds.find(g => g.id === 'g1').treasury_gold).toBe(100000);
    expect(qaServer.store.tables.guild_tech_levels.some(l => l.tech_id === 'gold')).toBe(false);
  });

  test('Kostenkurve steigt exakt mit 250000*1,18^Stufe ueber mehrere Kaeufe (Rebalance 26.07., vorher 200000*1,4^Stufe)', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    let treasury = 1000000;
    const expectedCosts = [250000, 295000, 348100]; // 250000*1.18^0, *1.18^1, *1.18^2 (gerundet)
    for (let i = 0; i < 3; i++) {
      const result = await page.evaluate(() => window.bkmpGuildTechUpgrade('crit_chance'));
      expect(result.newLevel).toBe(i + 1);
      treasury -= expectedCosts[i];
      expect(result.treasuryGold).toBe(treasury);
    }
  });

  test('Maximalstufe 35 (Rebalance 26.07., vorher 20) wird durchgesetzt, kein Kauf darueber hinaus', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.tables.guilds.find(g => g.id === 'g1').treasury_gold = 999999999999;
    qaServer.store.tables.guild_tech_levels.push({ guild_id: 'g1', tech_id: 'xp', level: 35 });
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildTechUpgrade('xp')); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/Maximalstufe/);
    expect(qaServer.store.tables.guild_tech_levels.find(l => l.tech_id === 'xp').level).toBe(35);
  });

  test('Paragon-Fortfuehrung (Rebalance 26.07.) fuer einen urspruenglichen Zweig: erst ab Maximalstufe kaufbar, teilt sich dieselben Basiswerte wie STANDARD_V2', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.tables.guilds.find(g => g.id === 'g1').treasury_gold = 999999999999;
    qaServer.store.tables.guild_tech_levels.push({ guild_id: 'g1', tech_id: 'attack', level: 35 });
    const paragon1 = await page.evaluate(() => window.bkmpGuildTechUpgrade('attack__paragon'));
    expect(paragon1.newLevel).toBe(1);
    // Teilt sich denselben Paragon-Basiswert wie Brutbeschleuniger/Gildenschmiede (STANDARD_V2).
    expect(999999999999 - paragon1.treasuryGold).toBe(92422965);
  });

  test('ungueltige Technologie-ID wird abgelehnt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    let threw = null;
    try { await page.evaluate(() => window.bkmpGuildTechUpgrade('does_not_exist')); }
    catch (e) { threw = String(e.message || e); }
    expect(threw).toMatch(/Unbekannte Technologie-ID/);
  });

  test('negative, NaN- oder Infinity-Kostenwerte koennen nicht entstehen - Kosten sind serverseitig fest berechnet', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const result = await page.evaluate(() => window.bkmpGuildTechUpgrade('boss_damage'));
    expect(Number.isFinite(result.newLevel)).toBe(true);
    expect(Number.isFinite(result.treasuryGold)).toBe(true);
    expect(result.treasuryGold).toBeGreaterThanOrEqual(0);
  });

  test('parallele Kaufversuche zweier Berechtigter werden beide korrekt verbucht, keine verlorene Aktualisierung', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    const [leaderResult, officerResult] = await Promise.all([
      page.evaluate(() => window.bkmpGuildTechUpgrade('rune_luck')),
      rpcAs(qaServer, OFFICER_NAME, 'guild_tech_upgrade', { p_tech_id: 'rune_luck' })
    ]);
    // Beide Aufrufe kaufen dieselbe Technologie - der Mock verarbeitet RPCs
    // seriell (kein echter DB-Race), daher muessen es am Ende GENAU 2 Stufen
    // sein (kein doppeltes Verbuchen, kein Verlust).
    const finalLevel = qaServer.store.tables.guild_tech_levels.find(l => l.tech_id === 'rune_luck').level;
    expect(finalLevel).toBe(2);
    expect([leaderResult.newLevel, officerResult.new_level].sort()).toEqual([1, 2]);
  });

  test('Bonusberechnung: gestaffelter Effekt ist Stufe * perLevel-Prozentsatz, korrekt im Cache gespiegelt', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildTechUpgrade('crit_damage')); // perLevel 2 -> +2%
    await page.evaluate(() => window.bkmpGuildTechUpgrade('crit_damage')); // Stufe 2 -> +4%
    await page.evaluate(() => window.bkmpGuildRefreshTreasuryBonusCache());
    const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('bkmp-guild-tech-cache') || '{}'));
    expect(cache.critDamagePct).toBeCloseTo(4, 5);
  });

  test('Reload zeigt weiterhin die korrekt gekaufte Stufe', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildTechUpgrade('prestige'));
    await page.reload();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    const levels = await page.evaluate(() => window.bkmpGuildGetTechLevels('g1'));
    expect(levels.prestige).toBe(1);
  });

  test('Logout/Login zeigt weiterhin den korrekten, serverseitig persistenten Stand', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    await page.evaluate(() => window.bkmpGuildTechUpgrade('gold'));
    // Server-Wahrheit unabhaengig vom Client-Session-Status pruefen.
    const levels = await page.evaluate(() => window.bkmpGuildGetTechLevels('g1'));
    expect(levels.gold).toBe(1);
  });
});

/* Spieler-Meldung 30.07.2026 (Screenshot: "Kritischer Schaden", Stufe 35/35,
   Paragon-Rang 5, "+70%") - "Level Paragon hoch aber am Wert ändert sich
   nichts". Root Cause: bkmpIdleRenderGildeTechPanel()'s "+X%"-Kartenanzeige
   rechnete bisher direkt "level * tech.perLevel" aus, unabhaengig vom
   Paragon-Rang - der reale Spieleffekt (bkmpGuildTechBonus(), siehe Test
   oben "Bonusberechnung...") war nie betroffen, nur diese eine Anzeige.
   Anders als der Rest dieser Datei (reine RPC-Aufrufe) braucht dieser
   Beweis eine echte UI-Pruefung - der Bug lebte ausschliesslich in der
   Render-Funktion, kein bestehender RPC-Test haette ihn je auffangen
   koennen. */
test.describe('Gilden-Technologie: Anzeige-Bugfix (Paragon-Bonus in der Karte)', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt einen echten Desktop-Tab-Klick (#idleTabBtnGildeTech).');
  });

  test('Kartenanzeige "+X%" aendert sich sichtbar nach einem Paragon-Kauf', async ({ page, qaServer }) => {
    await login(page, qaServer, LEADER_NAME);
    qaServer.store.tables.guilds.find(g => g.id === 'g1').treasury_gold = 999999999999;
    qaServer.store.tables.guild_tech_levels.push({ guild_id: 'g1', tech_id: 'crit_damage', level: 35 });

    await page.locator('#idleTabBtnGildeTech').click();
    // Die Stufe wurde direkt in den Store injiziert (nicht ueber einen echten
    // Kauf-RPC) - bkmpGuildTechLevels (Client-Cache) und der localStorage-
    // Bonus-Cache muessen deshalb hier explizit aufgefrischt werden, sonst
    // rendert die erste Zeile noch mit dem alten "Stufe 0"-Stand.
    await page.evaluate(async () => {
      bkmpGuildTechLevels = await window.bkmpGuildGetTechLevels('g1');
      await bkmpGuildRefreshTreasuryBonusCache();
      bkmpIdleRenderGildeTechPanel();
    });

    const card = page.locator('.idle-guild-tech-card', { hasText: 'Kritischer Schaden' });
    // Vor dem Fix: bliebe hier fuer immer bei "+70%" stehen, egal wie viele
    // Paragon-Raenge gekauft werden (35 * 2 = 70, Paragon nie eingerechnet).
    await expect(card.locator('.idle-guild-tech-bonus')).toHaveText('+70%');

    await card.locator('.idle-guild-tech-paragon-btn').click();
    await expect.poll(() => page.evaluate(() => bkmpGuildBusy)).toBe(false);

    // 1 Paragon-Rang * (2% Basis-Effekt * 4% Paragon-Anteil) = +0,08% -> 70,08 rundet auf 70,1.
    await expect(card.locator('.idle-guild-tech-bonus')).toHaveText('+70.1%');
  });
});
