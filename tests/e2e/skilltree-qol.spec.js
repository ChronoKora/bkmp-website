/* Folgeupdate 04.10.2026: Skilltree-QoL nach Spieler-Feedback ("nach jedem
   Prestige den Skilltree neu klicken").
   - MAX-Knopf (fuer alle, keine Freischaltung)
   - Skilltree-Builds (3 Plaetze, speichern/anwenden/umbenennen/loeschen,
     Teil-Wiederherstellung, nie kostenlose Punkte)
   - Auto-Skilltree (Prestige-Knoten "Meister der Pfade")
   Die Planung (js/systems/bkmp-skill-builds.js) wird zusaetzlich ohne
   Browser direkt gegen die Test-Knotendaten geprueft. */
const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');
const planner = require('../../js/systems/bkmp-skill-builds.js');
const { IDLE_SKILL_NODES } = require('../fixtures/reference-data');

const BASE_BRANCHES = ['dorf', 'burg', 'forschung', 'magie', 'wirtschaft'];
function fullBuild(defs) {
  const r = {};
  defs.filter(n => BASE_BRANCHES.includes(n.branch)).forEach(n => { r[n.id] = n.max_rank; });
  return r;
}
function costOf(defs, steps) {
  const byId = new Map(defs.map(n => [n.id, n]));
  return steps.reduce((a, id) => a + byId.get(id).cost_per_rank, 0);
}

/* ---------- Planung ohne Browser ---------- */
test.describe('Skilltree-Builds – Planung', () => {
  const defs = IDLE_SKILL_NODES;
  const byId = new Map(defs.map(n => [n.id, n]));

  test('nie mehr Punkte als verfügbar, Voraussetzungen vor Kindern, nie über Max-Rang', () => {
    const build = fullBuild(defs);
    for (const points of [0, 1, 7, 80, 150, 9999]) {
      const plan = planner.bkmpSkillBuildPlan(build, {}, defs, points, []);
      expect(costOf(defs, plan.steps)).toBeLessThanOrEqual(points);
      const cur = {};
      plan.steps.forEach(id => {
        const n = byId.get(id);
        if (n.requires_node_id) expect(cur[n.requires_node_id] || 0, `${id} vor ${n.requires_node_id}`).toBeGreaterThanOrEqual(n.requires_rank);
        cur[id] = (cur[id] || 0) + 1;
        expect(cur[id]).toBeLessThanOrEqual(n.max_rank);
        expect(cur[id]).toBeLessThanOrEqual(build[id]);
      });
    }
    // Genug Punkte: genau der Build, nichts darueber hinaus
    const all = planner.bkmpSkillBuildPlan(build, {}, defs, 9999, []);
    const cur = {};
    all.steps.forEach(id => { cur[id] = (cur[id] || 0) + 1; });
    expect(Object.keys(cur).sort()).toEqual(Object.keys(build).sort());
    Object.keys(build).forEach(id => expect(cur[id], id).toBe(build[id]));
    expect(planner.bkmpSkillBuildProgress(build, cur, defs).complete).toBe(true);
  });

  test('teilweise Wiederherstellung: 80 von N Punkten, dieselben Punkte fließen nur in den Build', () => {
    const build = fullBuild(defs);
    const total = planner.bkmpSkillBuildProgress(build, {}, defs).total;
    expect(total).toBeGreaterThan(80);
    const plan = planner.bkmpSkillBuildPlan(build, {}, defs, 80, []);
    const cur = {};
    plan.steps.forEach(id => { cur[id] = (cur[id] || 0) + 1; });
    const p = planner.bkmpSkillBuildProgress(build, cur, defs);
    expect(p.done).toBe(costOf(defs, plan.steps));
    expect(p.done).toBeGreaterThanOrEqual(79);
    expect(p.done).toBeLessThanOrEqual(80);
    expect(p.total).toBe(total);
    // Guenstige Grundwerte zuerst, gleichmaessig verteilt (kein Knoten > 2 Raenge vor dem naechsten)
    const firstTen = planner.bkmpSkillBuildPlan(build, {}, defs, 10, []).steps;
    expect(firstTen.every(id => byId.get(id).cost_per_rank === 1)).toBe(true);
    expect(new Set(firstTen).size).toBeGreaterThanOrEqual(5);
    // Weiterbauen ab einem Teilstand ergibt am Ende denselben Build
    const rest = planner.bkmpSkillBuildPlan(build, cur, defs, 9999, []);
    rest.steps.forEach(id => { cur[id] = (cur[id] || 0) + 1; });
    expect(planner.bkmpSkillBuildProgress(build, cur, defs).complete).toBe(true);
  });

  test('unbekannte Knoten fallen weg, zu hohe Ränge werden gekappt, Voraussetzungen ergänzt, gesperrte Zweige übersprungen', () => {
    const t = planner.bkmpSkillBuildEffectiveTargets({ geloeschter_knoten: 5, dorf_ballisten: 99 }, defs);
    expect(t.geloeschter_knoten).toBeUndefined();
    expect(t.dorf_ballisten).toBe(byId.get('dorf_ballisten').max_rank);
    // Kette ballisten <- bogenschuetzen(4) <- angriffstempo(3) <- pfeilschaden(3)
    expect(t.dorf_bogenschuetzen).toBe(4);
    expect(t.dorf_angriffstempo).toBe(3);
    expect(t.dorf_pfeilschaden).toBe(3);
    const locked = planner.bkmpSkillBuildPlan({ dorf_pfeilschaden: 5, burg_leben: 5 }, {}, defs, 999, ['dorf']);
    expect(locked.steps.every(id => id === 'burg_leben')).toBe(true);
    expect(planner.bkmpSkillBuildPlan(fullBuild(defs), {}, defs, 0, []).steps).toEqual([]);
  });

  test('Zwei Geräte: pro Platz gewinnt die neuere Änderung (auch Löschen), Schalter ebenso', () => {
    const a = planner.bkmpSkillBuildsEmpty();
    const b = planner.bkmpSkillBuildsEmpty();
    a.slots[0] = { name: 'Standard', ranks: { burg_leben: 5 }, savedAt: 100 }; a.slotAt[0] = 100;
    b.slots[0] = { name: 'Neu', ranks: { burg_leben: 9 }, savedAt: 200 }; b.slotAt[0] = 200;
    a.slots[1] = { name: 'Farm', ranks: { forsch_gold: 3 }, savedAt: 300 }; a.slotAt[1] = 300;
    b.slots[1] = null; b.slotAt[1] = 400; // spaeter auf dem anderen Geraet geloescht
    a.auto = true; a.autoAt = 500; b.auto = false; b.autoAt = 100;
    a.active = 1; a.activeAt = 300; b.active = 0; b.activeAt = 250;
    const m = planner.bkmpSkillBuildsMerge(a, b);
    expect(m.slots[0].name).toBe('Neu');
    expect(m.slots[1]).toBeNull();
    expect(m.auto).toBe(true);
    expect(m.active).toBe(-1); // aktiver Platz wurde geloescht -> kein aktiver Build
    // Ungueltige Daten werden bereinigt
    const n = planner.bkmpSkillBuildsNormalize({ slots: [{ name: 'x'.repeat(80), ranks: { 'b@d': 3, ok_knoten: -2, gut: 4 } }], active: 7, auto: 'ja' });
    expect(n.slots[0].name.length).toBe(24);
    expect(n.slots[0].ranks).toEqual({ gut: 4 });
    expect(n.active).toBe(-1);
    expect(n.auto).toBe(false);
  });
});

/* ---------- im Spiel ---------- */
function playerRow(store, fixtureData) { return store.tables.idle_player_state.find(r => r.auth_user_id === fixtureData.authUserId); }
function setSkillState(store, fixtureData, available, allocations) {
  const row = playerRow(store, fixtureData);
  const alloc = allocations || {};
  const byId = new Map(store.tables.idle_skill_nodes.map(n => [n.id, n]));
  row.skill_allocations = { ...alloc };
  row.skill_points_spent = Object.entries(alloc).reduce((a, [id, r]) => a + r * (byId.get(id) ? byId.get(id).cost_per_rank : 1), 0);
  row.skill_points_available = available;
}
async function startGame(page, qaBaseURL, fixtureData) {
  await openAndLogin(page, qaBaseURL, fixtureData);
  await waitForDragonReady(page);
  await page.evaluate(() => bkmpIdleStopLoop());
}
async function openSkilltree(page) {
  await page.evaluate(() => document.getElementById('idleTabBtnSkilltree').click());
  await expect(page.locator('#idlePanelSkilltree')).toBeVisible();
}
async function waitBuildsReady(page) {
  await expect.poll(() => page.evaluate(() => typeof bkmpChronicleReady === 'function' && bkmpChronicleReady()), { timeout: 15000 }).toBe(true);
  await page.evaluate(() => bkmpIdleRenderSkilltreePanel());
  await expect(page.locator('[data-testid="skillbuilds"]')).toBeVisible();
}
async function expandBranch(page, branch) {
  const header = page.locator(`[data-branch-toggle="${branch}"]`);
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
}
const pointsSum = page => page.evaluate(() => Number(bkmpIdleState.skill_points_available) + Number(bkmpIdleState.skill_points_spent));
const alloc = page => page.evaluate(() => ({ ...(bkmpIdleState.skill_allocations || {}) }));

test.describe('Skilltree – MAX-Knopf (für alle)', () => {
  test.use({ teststand: 'C' });

  test('MAX kauft so viele Ränge wie möglich – Punkte, Max-Rang und Voraussetzung zählen', async ({ page, qaBaseURL, fixtureData, store }) => {
    setSkillState(store, fixtureData, 12, {});
    await startGame(page, qaBaseURL, fixtureData);
    await openSkilltree(page);
    await expandBranch(page, 'dorf');
    // Voraussetzung (Pfeilschaden Rang 3) fehlt -> MAX fuer Angriffstempo gesperrt
    await expect(page.locator('[data-node-max-id="dorf_angriffstempo"]')).toBeDisabled();
    await expect(page.locator('[data-node-max-id="dorf_pfeilschaden"]')).toHaveText('MAX ×10');
    await page.locator('[data-node-max-id="dorf_pfeilschaden"]').click();
    expect((await alloc(page)).dorf_pfeilschaden).toBe(10);
    expect(await page.evaluate(() => bkmpIdleState.skill_points_available)).toBe(2);
    // Max-Rang erreicht: kein MAX-Knopf mehr, "+1" zeigt Max
    await expect(page.locator('[data-node-max-id="dorf_pfeilschaden"]')).toHaveCount(0);
    // Angriffstempo jetzt frei, aber nur 2 Punkte -> genau 2 Raenge
    await page.locator('[data-node-max-id="dorf_angriffstempo"]').click();
    expect((await alloc(page)).dorf_angriffstempo).toBe(2);
    expect(await page.evaluate(() => bkmpIdleState.skill_points_available)).toBe(0);
    await expect(page.locator('[data-node-max-id="burg_leben"]')).toBeDisabled();
    expect(await pointsSum(page)).toBe(12);
    // Gespeichert: Server kennt dieselbe Verteilung, Summe unveraendert
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    const row = playerRow(store, fixtureData);
    expect(row.skill_allocations.dorf_pfeilschaden).toBe(10);
    expect(Number(row.skill_points_available) + Number(row.skill_points_spent)).toBe(12);
  });

  test('gesperrter Meister-Zweig bleibt auch für MAX/Builds gesperrt', async ({ page, qaBaseURL, fixtureData, store }) => {
    setSkillState(store, fixtureData, 50, {});
    await startGame(page, qaBaseURL, fixtureData);
    const r = await page.evaluate(() => {
      const node = { id: 'qa_meister', branch: 'meister', name: 'Test', max_rank: 5, cost_per_rank: 1, requires_node_id: null, requires_rank: 0, effect_type: 'attack_pct', effect_value_per_rank: 1 };
      bkmpIdleSkillDefs.push(node);
      const res = { locked: bkmpIdleSkillBranchLocked('meister'), can: bkmpIdleCanAllocateSkill(node), max: bkmpIdleSkillMaxBuyable(node), bought: bkmpIdleAllocateSkillRanksQuiet('qa_meister', 5) };
      bkmpIdleSkillDefs.pop();
      return res;
    });
    expect(r).toEqual({ locked: true, can: false, max: 0, bought: 0 });
  });
});

test.describe('Skilltree-Builds – Freischaltung', () => {
  test.use({ teststand: 'F' });
  test('vor dem ersten möglichen Aufstieg: Hinweis statt Builds, MAX trotzdem da', async ({ page, qaBaseURL, fixtureData, store }) => {
    setSkillState(store, fixtureData, 10, {});
    await startGame(page, qaBaseURL, fixtureData);
    await openSkilltree(page);
    await expect(page.locator('[data-testid="skillbuilds-locked"]')).toContainText('Stufe 100');
    await expect(page.locator('[data-testid="skillbuilds"]')).toHaveCount(0);
    await expandBranch(page, 'burg');
    await expect(page.locator('[data-node-max-id="burg_leben"]')).toBeEnabled();
  });
});

test.describe('Skilltree-Builds – speichern, anwenden, nach Prestige', () => {
  test.use({ teststand: 'C' });

  test('speichern → Prestige-Reset → Hinweis → teilweise anwenden (nur verfügbare Punkte) → weiterbauen', async ({ page, qaBaseURL, fixtureData, store }) => {
    const build = { dorf_pfeilschaden: 10, dorf_angriffstempo: 5, burg_leben: 10, burg_verteidigung: 10, forsch_xp: 6, forsch_loot: 4 };
    setSkillState(store, fixtureData, 0, build);
    await startGame(page, qaBaseURL, fixtureData);
    await openSkilltree(page);
    await waitBuildsReady(page);
    await page.locator('[data-testid="skillbuild-save"]').click();
    await expect(page.locator('[data-testid="skillbuild-slot-0"]')).toContainText('Standard');
    await expect(page.locator('[data-testid="skillbuilds-progress"]')).toContainText('Standard');
    const total = await page.evaluate(() => bkmpSkillBuildProgressOf(bkmpSkillBuildsState().slots[0]).total);
    expect(total).toBe(10 + 5 + 10 + 10 + 6 + 4 * 2);

    // Prestige setzt den Skilltree zurueck (Punkte 0, Verteilung leer)
    await page.evaluate(() => {
      bkmpIdleState.skill_points_available = 0;
      bkmpIdleState.skill_points_spent = 0;
      bkmpIdleState.skill_allocations = {};
      bkmpIdleRenderSkilltreePanel();
    });
    const banner = page.locator('[data-testid="skillbuilds-banner"]');
    await expect(banner).toContainText('Skilltree zurückgesetzt');
    await expect(banner).toContainText('„Standard“');
    // "Manuell verteilen" blendet den Hinweis fuer diesen Durchlauf aus
    await page.locator('[data-testid="skillbuilds-banner-manual"]').click();
    await expect(banner).toHaveCount(0);

    // Mit 0 Punkten anwenden: nichts kostenlos, Build wird aktiv
    await page.locator('[data-testid="skillbuild-apply"]').click();
    expect(await alloc(page)).toEqual({});
    expect(await page.evaluate(() => bkmpSkillBuildsState().active)).toBe(0);
    await expect(page.locator('[data-testid="skillbuilds-progress"]')).toContainText(`0 / ${total}`);

    // 20 neue Punkte (Level-Aufstiege) -> genau 20 ausgegeben, Build bleibt aktiv
    await page.evaluate(() => { bkmpIdleState.skill_points_available = 20; bkmpIdleRenderSkilltreePanel(); });
    await expect(page.locator('[data-testid="skillbuilds-continue"]')).toBeVisible();
    await page.locator('[data-testid="skillbuilds-continue"]').click();
    expect(await page.evaluate(() => bkmpIdleState.skill_points_available)).toBe(0);
    expect(await pointsSum(page)).toBe(20);
    const a = await alloc(page);
    Object.keys(a).forEach(id => expect(Object.keys(build)).toContain(id));
    Object.entries(a).forEach(([id, r]) => expect(r).toBeLessThanOrEqual(build[id]));
    await expect(page.locator('[data-testid="skillbuilds-progress"]')).toContainText(`20 / ${total}`);

    // Genug Punkte -> vollstaendig, Rest bleibt frei verfuegbar
    await page.evaluate(() => { bkmpIdleState.skill_points_available = 100; bkmpIdleRenderSkilltreePanel(); });
    await page.locator('[data-testid="skillbuilds-continue"]').click();
    expect(await alloc(page)).toEqual(build);
    expect(await page.evaluate(() => bkmpIdleState.skill_points_available)).toBe(120 - total);
    await expect(page.locator('[data-testid="skillbuilds-progress"]')).toContainText(`${total} / ${total}`);
    await expect(page.locator('[data-testid="skillbuilds-continue"]')).toHaveCount(0);
  });

  test('umbenennen, zweiter Platz, löschen – und alles bleibt nach dem Neuladen erhalten', async ({ page, qaBaseURL, fixtureData, store }) => {
    setSkillState(store, fixtureData, 0, { burg_leben: 4 });
    await startGame(page, qaBaseURL, fixtureData);
    await openSkilltree(page);
    await waitBuildsReady(page);
    await page.locator('[data-testid="skillbuild-save"]').click();
    await page.locator('[data-testid="skillbuild-rename"]').click();
    const input = page.locator('#bkmpSkillBuildRenameInput');
    await expect(input).toBeVisible();
    await input.fill('Bossjagd mit sehr langem Namen 12345');
    await page.locator('#bkmpSkillBuildRenameOk').click();
    await expect(page.locator('#bkmpSkillBuildRenameOverlay')).toHaveCount(0);
    await expect(page.locator('[data-testid="skillbuild-slot-0"]')).toContainText('Bossjagd mit sehr langem');
    // Zweiter Platz
    await page.locator('[data-testid="skillbuild-slot-1"]').click();
    await page.locator('[data-testid="skillbuild-save"]').click();
    await expect(page.locator('[data-testid="skillbuild-slot-1"]')).toContainText('Farm');
    // Loeschen mit Rueckfrage
    await page.locator('[data-testid="skillbuild-delete"]').click();
    await page.locator('#bkmpConfirmOkBtn').click();
    await expect(page.locator('[data-testid="skillbuild-slot-1"]')).toContainText('leer');
    expect(await alloc(page)).toEqual({ burg_leben: 4 }); // Loeschen aendert nie die Verteilung
    // Neu laden: Builds kommen vom Server (Chronik) zurueck
    await page.evaluate(() => bkmpChronicleSaveNow());
    await expect.poll(() => (store.tables.idle_player_meta || []).length).toBe(1);
    // Lokale Kopie verwerfen: die Builds muessen vom Server kommen
    await page.evaluate(key => localStorage.removeItem('bkmp-idle-chronicle-v1:' + key), fixtureData.nameKey);
    await page.reload();
    await page.waitForFunction(() => typeof bkmpIdleOpenModal === 'function');
    await page.evaluate(() => bkmpIdleOpenModal());
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await openSkilltree(page);
    await waitBuildsReady(page);
    await expect(page.locator('[data-testid="skillbuild-slot-0"]')).toContainText('Bossjagd mit sehr langem');
    await expect(page.locator('[data-testid="skillbuild-slot-1"]')).toContainText('leer');
  });
});

test.describe('Auto-Skilltree (Prestige-Knoten „Meister der Pfade“)', () => {
  test.use({ teststand: 'C' });

  test('Knoten im Automation-Zweig, gleicher Preis wie die anderen Automatiken', async ({ page, qaBaseURL, fixtureData }) => {
    await startGame(page, qaBaseURL, fixtureData);
    const def = await page.evaluate(() => {
      const d = bkmpPrestigeNodeById('meister_der_pfade');
      const other = bkmpPrestigeNodeById('automatischer_bosskampf');
      return { branch: d.branch, effectType: d.effectType, maxRank: d.maxRank, cost: bkmpPrestigeUpgradeCost(d, 0), otherCost: bkmpPrestigeUpgradeCost(other, 0) };
    });
    expect(def).toEqual({ branch: 'automation', effectType: 'auto_skilltree_unlock', maxRank: 1, cost: 50, otherCost: 50 });
  });

  test('ohne Knoten nur Hinweis; mit Knoten: Level-Aufstiege verteilen neue Punkte automatisch nach dem aktiven Build', async ({ page, qaBaseURL, fixtureData, store }) => {
    const build = { burg_leben: 10, burg_verteidigung: 10, forsch_xp: 5 };
    setSkillState(store, fixtureData, 0, build);
    await startGame(page, qaBaseURL, fixtureData);
    await openSkilltree(page);
    await waitBuildsReady(page);
    await expect(page.locator('[data-testid="skillbuilds-auto-locked"]')).toContainText('Meister der Pfade');
    await page.locator('[data-testid="skillbuild-save"]').click();
    // Prestige-Reset simulieren + Knoten freischalten
    await page.evaluate(() => {
      bkmpPrestigeState.prestige_allocations = { ...(bkmpPrestigeState.prestige_allocations || {}), meister_der_pfade: 1 };
      bkmpIdleState.skill_points_available = 0; bkmpIdleState.skill_points_spent = 0; bkmpIdleState.skill_allocations = {};
      bkmpIdleRenderSkilltreePanel();
    });
    const auto = page.locator('[data-testid="skillbuilds-auto"] input');
    await expect(auto).not.toBeChecked();
    await auto.check();
    await expect.poll(() => page.evaluate(() => bkmpSkillBuildsState().auto)).toBe(true);
    // Kein Banner mehr, solange Auto mit aktivem Build laeuft
    await expect(page.locator('[data-testid="skillbuilds-banner"]')).toHaveCount(0);
    // Level-Aufstiege: neue Punkte fliessen automatisch in den Build
    const before = await page.evaluate(() => bkmpIdleState.level);
    await page.evaluate(() => {
      const cfg = bkmpIdleConfig.xp_curve || BKMP_IDLE_FALLBACK_CONFIG.xp_curve;
      for (let i = 0; i < 7; i++) bkmpIdleAddXp(bkmpIdleXpForLevel(bkmpIdleState.level, cfg));
    });
    const gained = await page.evaluate(lv => bkmpIdleState.level - lv, before);
    expect(gained).toBeGreaterThanOrEqual(7);
    expect(await page.evaluate(() => bkmpIdleState.skill_points_available)).toBe(0);
    expect(await pointsSum(page)).toBe(gained);
    Object.keys(await alloc(page)).forEach(id => expect(Object.keys(build)).toContain(id));
    // Ausschalten: neue Punkte bleiben frei
    await page.locator('[data-testid="skillbuilds-auto"] input').uncheck();
    await page.evaluate(() => bkmpIdleAddXp(bkmpIdleXpForLevel(bkmpIdleState.level, bkmpIdleConfig.xp_curve || BKMP_IDLE_FALLBACK_CONFIG.xp_curve)));
    expect(await page.evaluate(() => bkmpIdleState.skill_points_available)).toBeGreaterThanOrEqual(1);
  });

  test('beim Laden: liegen gebliebene Punkte werden nach dem aktiven Build verteilt (Auto an)', async ({ page, qaBaseURL, fixtureData, store }) => {
    setSkillState(store, fixtureData, 15, {});
    const prest = store.tables.idle_prestige_state.find(p => p.name_key === fixtureData.nameKey);
    prest.prestige_allocations = { ...(prest.prestige_allocations || {}), meister_der_pfade: 1 };
    // Chronik-Zeile mit gespeichertem, aktivem Build + Auto an (wie von einem anderen Geraet)
    store.tables.idle_player_meta = [{
      auth_user_id: fixtureData.authUserId, name_key: fixtureData.nameKey, updated_at: new Date().toISOString(),
      data: { v: 1, updatedAt: Date.now(), skillBuilds: { slots: [{ name: 'Standard', ranks: { burg_leben: 10, forsch_xp: 10 }, savedAt: 1 }, null, null], slotAt: [1, 0, 0], active: 0, activeAt: 1, auto: true, autoAt: 1 } }
    }];
    await startGame(page, qaBaseURL, fixtureData);
    await expect.poll(() => page.evaluate(() => bkmpIdleState.skill_points_available), { timeout: 15000 }).toBe(0);
    const a = await alloc(page);
    expect((a.burg_leben || 0) + (a.forsch_xp || 0)).toBe(15);
    expect(await pointsSum(page)).toBe(15);
  });
});
