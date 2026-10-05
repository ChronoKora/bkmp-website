/* Event-Analyse im Admin-Panel (05.10.2026) - die Oberflaeche im echten Browser.

   Der Browser spricht hier mit dem lokalen Mock-Backend; die sechs Admin-Funktionen
   laufen ueber den JS-Nachbau (tests/mock/event-admin-engine.js), dessen Gleichheit mit
   dem echten SQL tests/e2e/event-admin-parity.spec.js beweist. Die Erwartungswerte sind
   von Hand aus den Testdaten gerechnet (tests/fixtures/event-admin-reference.js).

   Jeder Test legt sein eigenes Backend an, meldet sich ueber das echte Admin-Login-
   Formular an (Konto "chef@bkmp-admin-accounts.com" + Eintrag in admin_profiles) und
   oeffnet den neuen Reiter "Events". */
const { test, expect } = require('../helpers/qa-fixtures');
const f = require('../fixtures/event-admin-reference');
const { table } = require('../mock/store');

const ADMIN_PW = 'admin-pw-123';
const SIX_RPCS = ['admin_event_list', 'admin_event_overview', 'admin_event_quests', 'admin_event_timeline', 'admin_event_players', 'admin_event_player_detail'];

function seedAccount(store, { name, role, uidN }) {
  const email = name + '@bkmp-admin-accounts.com';
  const id = f.uid(uidN);
  store.authUsersByEmail.set(email, { id, email, password: ADMIN_PW, user_metadata: {} });
  table(store, 'admin_profiles').push({ id: 'ap-' + uidN, auth_user_id: id, login_name: email, role, active: true, display_name: name });
  return { name, email, id };
}
function seedScenario(store, scenario) {
  const push = (name, rows) => table(store, name).push(...JSON.parse(JSON.stringify(rows || [])));
  push('special_events', [scenario.event]);
  push('player_event_progress', scenario.players);
  push('event_player_day_log', scenario.log);
  push('player_stats', scenario.stats);
  const have = new Set(table(store, 'dragon_species').map(s => s.id));
  (scenario.species || [{ id: 'lightnix', name: 'Lightnix' }, { id: 'darknix', name: 'Darknix' }]).forEach(s => { if (!have.has(s.id)) table(store, 'dragon_species').push({ ...s }); });
  if (!table(store, 'event_admin_meta').some(m => m.key === 'stats_since')) {
    table(store, 'event_admin_meta').push({ key: 'stats_since', set_at: new Date().toISOString() });
  }
}
function prepareStore(store, scenario, role) {
  store.clock.setNow(Date.now());                    // Mock-Uhr = echte Uhr (sonst weicht "heute" ab)
  const acc = seedAccount(store, { name: 'chef', role: role || 'admin', uidN: 900 });
  if (scenario) seedScenario(store, scenario);
  return acc;
}

/* Meldet sich ueber das echte Formular an und oeffnet (optional) den Reiter. */
async function loginAdmin(page, qaBaseURL, name) {
  await page.goto(qaBaseURL + '/admin.html');
  await page.fill('#loginName', name || 'chef');
  await page.fill('#loginPassword', ADMIN_PW);
  await page.click('#loginBtn');
  await expect(page.locator('#adminWrap')).toBeVisible({ timeout: 20000 });
}
async function openEvents(page) {
  const nav = page.locator('[data-testid="admin-nav-events"]');
  await nav.scrollIntoViewIfNeeded();
  await nav.click();
  await expect(page.locator('#page-events.active')).toBeVisible();
  await expect(page.locator('[data-testid="aev-header"]')).toBeVisible({ timeout: 20000 });
}
async function setup(page, store, qaBaseURL, scenario, role) {
  prepareStore(store, scenario, role);
  await loginAdmin(page, qaBaseURL);
  await openEvents(page);
}
/* Sichtbarer Text mit Leerzeichen zwischen den Elementen (textContent klebt Tabellenzellen
   aneinander, innerText wuerde die CSS-Grossschreibung uebernehmen). */
const text = async (loc) => loc.evaluate(el => {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('*').forEach(n => n.appendChild(document.createTextNode(' ')));
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
});
const isDesktop = () => test.info().project.name === 'chromium-desktop';

/* ============================================================
   Hauptablauf (alle Projekte: Desktop + Handy)
   ============================================================ */
test.describe('Reiter "Events" - Zwielicht, laufend', () => {
  test('Reiter ist erreichbar, Kopf und Kennzahlen stimmen (von Hand gerechnet)', async ({ page, store, qaBaseURL }) => {
    const sc = f.makeZwielichtScenario(Date.now());
    await setup(page, store, qaBaseURL, sc);

    // Auswahl + Kopf
    await expect(page.locator('[data-testid="aev-event-select"]')).toHaveValue('zwielicht');
    await expect(page.locator('[data-testid="aev-title"]')).toHaveText(sc.event.name);
    await expect(page.locator('[data-testid="aev-status"]')).toHaveText('Läuft');
    await expect(page.locator('[data-testid="aev-timeline-text"]')).toContainText('noch');
    const header = await text(page.locator('[data-testid="aev-header"]'));
    expect(header).toContain('Stufen');
    expect(header).toMatch(/Punkte je Stufe\s*i?\s*100/);
    expect(header).toMatch(/Punkte bis zum Ziel\s*i?\s*3\.000/);
    expect(header).toMatch(/Maximal erreichbar \(geschätzt\)\s*i?\s*3\.590/);
    expect(header).toContain('00:00 Uhr');           // Start = Mitternacht Berliner Zeit

    // Kennzahlen: 10 gestartet, 9 aktiv (Ida hat 0 Punkte), Durchschnitt 155/9, Median 20, 3 abgeschlossen
    const kpi = async key => text(page.locator('[data-testid="aev-kpi-' + key + '"] .aev-kpi-value'));
    expect(await kpi('started')).toBe('10');
    expect(await kpi('active')).toBe('9');
    expect(await kpi('avg')).toBe('17,2');
    expect(await kpi('median')).toBe('20,0');
    expect(await kpi('completed')).toBe('3');
    expect(await kpi('max')).toBe('30');
    expect(await kpi('today')).toBe('7');
    expect(await kpi('points')).toBe('15.650');
    await expect(page.locator('[data-testid="aev-kpi-completed"]')).toContainText('33,3 % der Aktiven');
    await expect(page.locator('[data-testid="aev-kpi-active"]')).toContainText('90,0 % der Gestarteten');
    await expect(page.locator('[data-testid="aev-last-updated"]')).toContainText(/Zuletzt aktualisiert: \d{2}:\d{2}:\d{2}/);
  });

  test('Stufenverteilung: 31 Balken, genaue Zahl und Prozent bei Maus/Tippen', async ({ page, store, qaBaseURL }) => {
    await setup(page, store, qaBaseURL, f.makeZwielichtScenario(Date.now()));
    const bars = page.locator('[data-testid="aev-histogram"] .aev-bar');
    await expect(bars).toHaveCount(31);
    await expect(page.locator('[data-testid="aev-bar-20"]')).toHaveAttribute('data-count', '2');
    await expect(page.locator('[data-testid="aev-bar-30"]')).toHaveAttribute('data-count', '3');
    await expect(page.locator('[data-testid="aev-bar-5"]')).toHaveAttribute('data-count', '0');
    // Die Balken muessen ECHTE Groesse haben (nicht 0 px breit) und nebeneinander liegen
    const box20 = await page.locator('[data-testid="aev-bar-20"]').boundingBox();
    const box21 = await page.locator('[data-testid="aev-bar-21"]').boundingBox();
    expect(box20.width).toBeGreaterThan(3);
    expect(box20.height).toBeGreaterThan(60);
    expect(box21.x).toBeGreaterThan(box20.x);
    const fill30 = await page.locator('[data-testid="aev-bar-30"] .aev-bar-fill').boundingBox();
    const fill20 = await page.locator('[data-testid="aev-bar-20"] .aev-bar-fill').boundingBox();
    expect(fill30.height).toBeGreaterThan(fill20.height);      // 3 Spieler > 2 Spieler
    // Tippen/Maus -> genaue Zahl + Prozent der Aktiven
    await page.locator('[data-testid="aev-bar-20"]').click();
    await expect(page.locator('[data-testid="aev-hist-readout"]')).toHaveText('Stufe 20: 2 Spieler (22,2 % der Aktiven)');
    await page.locator('[data-testid="aev-bar-30"]').click();
    await expect(page.locator('[data-testid="aev-hist-readout"]')).toHaveText('Stufe 30: 3 Spieler (33,3 % der Aktiven)');
  });

  test('Meilensteine: erreicht vs. abgeholt, Auswahl-Belohnung inkl. "Entscheidung offen"', async ({ page, store, qaBaseURL }) => {
    await setup(page, store, qaBaseURL, f.makeZwielichtScenario(Date.now()));
    const ms10 = await text(page.locator('[data-testid="aev-milestone-10"]'));
    expect(ms10).toContain('Dayman');
    expect(ms10).toMatch(/Erreicht\s*6/);
    expect(ms10).toMatch(/Abgeholt\s*6/);
    const ms20 = await text(page.locator('[data-testid="aev-milestone-20"]'));
    expect(ms20).toContain('Surebrec');
    expect(ms20).toMatch(/Erreicht\s*5/);
    expect(ms20).toMatch(/Abgeholt\s*4/);
    expect(ms20).toContain('80,0 % der Erreichten');
    const ms30 = await text(page.locator('[data-testid="aev-milestone-30"]'));
    expect(ms30).toMatch(/Erreicht\s*3/);
    expect(ms30).toMatch(/Abgeholt\s*2/);
    expect(ms30).toMatch(/Auswahl getroffen\s*2/);
    // Stufe 15: Freischaltung (Abzeichen) - ebenfalls ein Meilenstein. Von Hand: erreicht 6 (Alice, Bob, Cara, Dan, Eli, Jan),
    // abgeholt 5 (Dan hat nur bis Stufe 10 abgeholt)
    const ms15 = await text(page.locator('[data-testid="aev-milestone-15"]'));
    expect(ms15).toMatch(/Erreicht\s*6/);
    expect(ms15).toMatch(/Abgeholt\s*5/);
    expect(ms15).toContain('83,3 % der Erreichten');
    // genau diese vier Meilensteine (10, 15, 20, 30) - nicht die normalen Ressourcen-Stufen
    await expect(page.locator('[data-testid^="aev-milestone-"]')).toHaveCount(4);

    await expect(page.locator('[data-testid="aev-choice-lightnix"]')).toContainText('Lightnix');
    await expect(page.locator('[data-testid="aev-choice-lightnix"] strong')).toHaveText('1');
    await expect(page.locator('[data-testid="aev-choice-darknix"] strong')).toHaveText('1');
    await expect(page.locator('[data-testid="aev-choice-open"]')).toHaveText('1');
    await expect(page.locator('[data-testid="aev-choice-summary"]')).toContainText('Stufe erreicht: 3');
  });

  test('Info-Symbol erklaert die Kennzahl (Tippen/Fokus), Sprechblase bleibt im Fenster', async ({ page, store, qaBaseURL }) => {
    await setup(page, store, qaBaseURL, f.makeZwielichtScenario(Date.now()));
    const icon = page.locator('[data-testid="aev-kpi-active"] .aev-info');
    await icon.click();
    const tip = page.locator('.aev-tip.on');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('mindestens 1 Event-Punkt');
    const box = await tip.boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
    // Heute-aktiv-Karte: Definition nennt den Berliner Tag
    await page.locator('[data-testid="aev-kpi-today"] .aev-info').click();
    await expect(page.locator('.aev-tip.on')).toContainText('Berliner');
  });

  test('Entwicklung pro Tag: Zahlen je Tag, Zeit vor dem Statistikstart wird NICHT erfunden', async ({ page, store, qaBaseURL }) => {
    const sc = f.makeZwielichtScenario(Date.now());
    await setup(page, store, qaBaseURL, sc);
    const rows = page.locator('[data-testid="aev-day-table"] tbody tr');
    await expect(rows).toHaveCount(3);
    const cells = async i => (await rows.nth(i).locator('td').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
    const [r1, r2, r3] = [await cells(0), await cells(1), await cells(2)];
    // Spalten: Tag, Neue, Aktive, Abgeschlossen, Auswahl, Punkte gesamt, Ø Stufe
    expect(r1.slice(1)).toEqual(['4', '–', '1', '1', '–', '–']);                       // vor dem Statistikstart: Aktive/Punkte/Ø nicht ermittelbar
    expect(r2.slice(1)).toEqual(['2', '–', '1', '1', '–', '–']);
    expect(r3.slice(1)).toEqual(['3', '7', '1', '0', '15.650', '17,2']);
    expect(r3[0]).toContain('(läuft)');
    const note = await text(page.locator('[data-testid="aev-timeline-note"]'));
    expect(note).toContain('Tagesprotokoll läuft seit');
    expect(note).toMatch(/1 Spieler hat einen unbekannten Beitrittstag/);
    await expect(page.locator('[data-testid="aev-timeline-chart"]')).toBeVisible();
    const chart = await page.locator('[data-testid="aev-timeline-chart"]').boundingBox();
    expect(chart.width).toBeGreaterThan(200);
    expect(chart.height).toBeGreaterThan(100);
    // Tag antippen -> Zahlen im Klartext
    await page.locator('.aev-hit').nth(2).click({ force: true });
    await expect(page.locator('[data-testid="aev-tl-readout"]')).toContainText('3 neue Teilnehmer, 7 aktive Spieler');
  });

  test('Spielertabelle: Suche, Sortierung, Einzelansicht (nur Ansicht)', async ({ page, store, qaBaseURL }) => {
    await setup(page, store, qaBaseURL, f.makeZwielichtScenario(Date.now()));
    const rows = page.locator('[data-testid="aev-player-row"]');
    await expect(rows).toHaveCount(10);
    await expect(rows.first().locator('td').first()).toHaveText('Bob');                // meiste Punkte (3050)
    // Spalten der ersten Zeile (Bob): Stufe 30, 3.050 Punkte, heute 1/5 Aufgaben, hoechste abgeholte 29, Auswahl offen
    const bob = (await rows.first().locator('td').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
    expect(bob[1]).toBe('30');
    expect(bob[2]).toBe('3.050');
    expect(bob[3]).toBe('1 / 5');
    expect(bob[7]).toBe('29');
    expect(bob[8]).toBe('offen');
    expect(bob[9]).toBe('Abgeschlossen');

    // Sortierung nach Name (aufsteigend) und Umkehr
    await page.locator('[data-psort="name"]').click();
    await expect(rows.first().locator('td').first()).toHaveText('Alice');
    await page.locator('[data-psort="name"]').click();
    await expect(rows.first().locator('td').first()).toHaveText('Jan');

    // Suche (entprellt)
    await page.fill('[data-testid="aev-search"]', 'ali');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('td').first()).toHaveText('Alice');
    await page.fill('[data-testid="aev-search"]', 'gibtesnicht');
    await expect(rows).toHaveCount(0);
    await expect(page.locator('[data-testid="aev-players"]')).toContainText('Kein Spieler gefunden');
    await page.fill('[data-testid="aev-search"]', '');
    await expect(rows).toHaveCount(10);

    // Einzelansicht: Alice, Lightnix, Verlauf der Vortage - und ESC schliesst
    await page.fill('[data-testid="aev-search"]', 'alice');
    await expect(rows).toHaveCount(1);
    await rows.first().click();
    const detail = page.locator('[data-testid="aev-detail"]');
    await expect(detail).toBeVisible();
    const d = await text(detail);
    expect(d).toContain('Alice');
    expect(d).toContain('Nur Ansicht');
    expect(d).toMatch(/Punkte\s*3\.000/);
    expect(d).toMatch(/Stufe\s*30 \/ 30/);
    expect(d).toContain('Lightnix');
    expect(d).toContain('Frühere Tage');
    const vp = page.viewportSize();
    const dbox = await detail.boundingBox();
    expect(dbox.width).toBeLessThanOrEqual(vp.width + 1);
    expect(dbox.y + dbox.height).toBeLessThanOrEqual(vp.height + 1);          // passt ins Fenster (scrollt bei Bedarf in sich)
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
  });

  test('Handy/Desktop: kein waagerechtes Seiten-Scrollen, Reiter/Knoepfe erreichbar', async ({ page, store, qaBaseURL }) => {
    await setup(page, store, qaBaseURL, f.makeZwielichtScenario(Date.now()));
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bsw: document.body.scrollWidth }));
    expect(overflow.sw, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.cw + 1);
    // alle Kennzahlen-Karten sichtbar und nicht ueber den Rand hinaus
    const vp = page.viewportSize();
    for (const key of ['started', 'active', 'avg', 'median', 'completed', 'max', 'today', 'points']) {
      const b = await page.locator('[data-testid="aev-kpi-' + key + '"]').boundingBox();
      expect(b.width, key).toBeGreaterThan(60);
      expect(b.x, key).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, key).toBeLessThanOrEqual(vp.width + 1);
    }
    // Aktualisieren-Knopf und Event-Auswahl bedienbar
    await page.locator('[data-testid="aev-refresh"]').click();
    await expect(page.locator('[data-testid="aev-refresh"]')).toHaveText('↻ Aktualisieren');
    await expect(page.locator('[data-testid="aev-event-select"]')).toBeEnabled();
  });
});

/* ============================================================
   Nur Desktop: Detailtests
   ============================================================ */
test.describe('Reiter "Events" - Detailanalysen (Desktop)', () => {
  test.beforeEach(() => { test.skip(!isDesktop(), 'Detailtests laufen auf dem Desktop-Projekt (Handy-Abdeckung: Haupttests oben).'); });

  test('Daily-Analyse: Standard-Sortierung = niedrigste Abschlussquote zuerst, Umsortieren per Klick', async ({ page, store, qaBaseURL }) => {
    await setup(page, store, qaBaseURL, f.makeZwielichtScenario(Date.now()));
    const order = async () => page.locator('[data-testid="aev-daily-table"] tbody tr').evaluateAll(trs => trs.map(t => t.dataset.testid.replace('aev-quest-', '')));
    // von Hand: d_dungeons 3/11 = 27,3 %  <  d_bosses 5/12 = 41,7 %  <  d_active 6/11 = 54,5 %  <  d_kills 9/15 = 60 %
    expect(await order()).toEqual(['d_dungeons', 'd_bosses', 'd_active', 'd_kills']);
    const kills = await text(page.locator('[data-testid="aev-quest-d_kills"]'));
    expect(kills).toMatch(/15\s+9\s+60,0 %/);
    expect(kills).toContain('3 / 7');                                  // heute: 3 von 7 abgeschlossen
    await page.locator('[data-testid="aev-daily-table"] [data-qsort="rate"]').click();                  // gleiche Spalte -> Reihenfolge umkehren
    expect(await order()).toEqual(['d_kills', 'd_active', 'd_bosses', 'd_dungeons']);
    await page.locator('[data-testid="aev-daily-table"] [data-qsort="assigned"]').click();              // nach "Vergeben" aufsteigend: 11, 11, 12, 15
    const byAssigned = await order();
    expect(byAssigned[2]).toBe('d_bosses');
    expect(byAssigned[3]).toBe('d_kills');
    // schwere Quest und Tagesabschluss getrennt
    const hard = await text(page.locator('[data-testid="aev-quest-h_kills"]'));
    expect(hard).toMatch(/6\s+2\s+33,3 %/);
    const closure = await text(page.locator('[data-testid="aev-closure"]'));
    expect(closure).toContain('Vergeben: 15');
    expect(closure).toContain('Abgeschlossen: 3');
    expect(closure).toContain('Quote: 20,0 %');
    // Wochenquests: je Stufe einzeln
    const w = (await page.locator('[data-testid="aev-weekly-w_kills"] td').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
    expect(w[1]).toBe('9');
    expect(w[2]).toMatch(/^5 56 %$/);
    expect(w[3]).toMatch(/^3 33 %$/);
    expect(w[4]).toMatch(/^2 22 %$/);
    expect(w[5]).toMatch(/^2 22 %$/);
  });

  test('Belohnungsanalyse: Abholquote je Stufe, Filter "nur Meilensteine"', async ({ page, store, qaBaseURL }) => {
    await setup(page, store, qaBaseURL, f.makeZwielichtScenario(Date.now()));
    await expect(page.locator('[data-testid="aev-reward-table"] tbody tr')).toHaveCount(30);
    const cells = async tier => (await page.locator('[data-testid="aev-reward-' + tier + '"] td').allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
    const t20 = await cells(20);
    expect(t20[0]).toBe('20');
    expect(t20[1]).toContain('Surebrec');
    expect(t20[2]).toMatch(/^5 56 %$/);
    expect(t20[3]).toBe('4');
    expect(t20[4]).toBe('80,0 %');
    expect((await cells(10))[4]).toBe('100,0 %');
    expect((await cells(30))[4]).toBe('66,7 %');
    expect((await cells(1))[1]).toContain('Gold');                     // normale Stufe: Belohnung aus der Konfiguration beschrieben
    // Regression 05.10.2026: Stufen mit Fruechten/Fleisch/Boosts zeigten "–", weil die Anzeige die Schluessel nicht kannte
    for (let tier = 1; tier <= 30; tier++) {
      const c = await cells(tier);
      expect(c[1], 'Stufe ' + tier + ' darf keine leere Belohnung zeigen').not.toBe('–');
      expect(c[1].length, 'Stufe ' + tier).toBeGreaterThan(1);
    }
    expect((await cells(4))[1]).toMatch(/150 Früchte.*150 Fleisch/);
    expect((await cells(7))[1]).toContain('Goldrausch');
    expect((await cells(13))[1]).toContain('Wissensschub');
    expect((await cells(22))[1]).toMatch(/Goldrausch.*Wissensschub/);
    // Unbekannte Belohnungsarten eines kuenftigen Events werden nie verschluckt
    expect(await page.evaluate(() => bkmpAdminEvents.describeReward({ gold_units: 5, mondstaub: 7, geschenk: { a: 1 } }))).toBe('5 Gold-Einheiten · mondstaub: 7 · geschenk: {"a":1}');
    expect(await page.evaluate(() => bkmpAdminEvents.describeReward({}))).toBe('–');
    await page.check('#aevOnlyMs');
    await expect(page.locator('[data-testid="aev-reward-table"] tbody tr')).toHaveCount(4);
    await page.uncheck('#aevOnlyMs');
    await expect(page.locator('[data-testid="aev-reward-table"] tbody tr')).toHaveCount(30);
  });

  test('Spielerliste: Seiten, wenn es viele Teilnehmer gibt (nie alle auf einmal)', async ({ page, store, qaBaseURL }) => {
    const sc = f.makeZwielichtScenario(Date.now());
    const bulk = f.makeBulkPlayers(40, 'zwielicht', Date.now());
    sc.players.push(...bulk.players); sc.stats.push(...bulk.stats); sc.log.push(...bulk.log);
    await setup(page, store, qaBaseURL, sc);
    const rows = page.locator('[data-testid="aev-player-row"]');
    await expect(rows).toHaveCount(25);
    await expect(page.locator('[data-testid="aev-pager-info"]')).toHaveText('1–25 von 50');
    await expect(page.locator('[data-testid="aev-page-label"]')).toHaveText('Seite 1 / 2');
    await expect(page.locator('[data-page-step="-1"]')).toBeDisabled();
    const firstPage = await rows.first().locator('td').first().textContent();
    await page.locator('[data-page-step="1"]').click();
    await expect(page.locator('[data-testid="aev-pager-info"]')).toHaveText('26–50 von 50');
    await expect(rows).toHaveCount(25);
    expect(await rows.first().locator('td').first().textContent()).not.toBe(firstPage);
    await expect(page.locator('[data-page-step="1"]')).toBeDisabled();
    // Suche springt zurueck auf Seite 1
    await page.fill('[data-testid="aev-search"]', 'spieler00003');
    await expect(page.locator('[data-testid="aev-pager-info"]')).toHaveText('1–1 von 1');
    await expect(page.locator('[data-testid="aev-page-label"]')).toHaveText('Seite 1 / 1');
  });

  test('Nur Ansicht: keine Schreib-Knoepfe, nur lesende Datenbankaufrufe', async ({ page, store, qaBaseURL }) => {
    prepareStore(store, f.makeZwielichtScenario(Date.now()));
    await loginAdmin(page, qaBaseURL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    const calls = [];
    page.on('request', req => {
      const url = req.url();
      if (!url.includes('/rest/v1/')) return;
      calls.push({ method: req.method(), path: new URL(url).pathname });
    });
    await openEvents(page);
    const rows = page.locator('[data-testid="aev-player-row"]');
    await rows.first().click();
    await expect(page.locator('[data-testid="aev-detail"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="aev-refresh"]').click();
    await expect(page.locator('[data-testid="aev-refresh"]')).toHaveText('↻ Aktualisieren');
    await page.locator('[data-psort="points"]').click();
    await expect(rows.first()).toBeVisible();
    // 1) Datenbank: ausschliesslich POST auf die sechs Admin-Funktionen (RPC), nichts anderes veraendert Daten
    const writes = calls.filter(c => c.method !== 'GET' && c.method !== 'OPTIONS' && c.method !== 'HEAD');
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(w.method, JSON.stringify(w)).toBe('POST');
      expect(SIX_RPCS.map(n => '/rest/v1/rpc/' + n), JSON.stringify(w)).toContain(w.path);
    }
    // 2) Oberflaeche: kein Knopf/Feld zum Veraendern
    const controls = await page.locator('#page-events button, #page-events input, #page-events select, #page-events textarea').evaluateAll(els => els.map(e => ({
      tag: e.tagName, type: e.type || '', id: e.id || '', label: ((e.textContent || e.getAttribute('aria-label') || e.placeholder || '')).trim().slice(0, 40)
    })));
    const forbidden = /(lösch|entfern|zurücksetz|reset|speicher|bearbeit|ändern|gutschreib|verleih|(punkte|stufe|stufen|belohnung|event|spieler)\s*(vergeb|geb|setz|send|zuteil|erhöh|änder|lösch|entzieh))/i;
    for (const c of controls) expect(forbidden.test(c.label), JSON.stringify(c)).toBe(false);
    const inputs = controls.filter(c => c.tag === 'INPUT' || c.tag === 'TEXTAREA');
    for (const i of inputs) expect(['search', 'checkbox'], JSON.stringify(i)).toContain(i.type);
  });

  test('Aktualisieren: manueller Knopf + optionale automatische Aktualisierung', async ({ page, store, qaBaseURL }) => {
    await setup(page, store, qaBaseURL, f.makeZwielichtScenario(Date.now()));
    const first = await text(page.locator('[data-testid="aev-last-updated"]'));
    await page.waitForTimeout(1200);
    await page.locator('[data-testid="aev-refresh"]').click();
    await expect.poll(async () => text(page.locator('[data-testid="aev-last-updated"]'))).not.toBe(first);
    // Neue Daten erscheinen nach "Aktualisieren"
    table(store, 'player_event_progress').push(JSON.parse(JSON.stringify({ ...table(store, 'player_event_progress')[0], auth_user_id: f.uid(77), name_key: 'neuling', points: 150, joined_day: null })));
    table(store, 'player_stats').push({ auth_user_id: f.uid(77), display_name: 'Neuling', name_key: 'neuling' });
    await page.locator('[data-testid="aev-refresh"]').click();
    await expect(page.locator('[data-testid="aev-kpi-started"] .aev-kpi-value')).toHaveText('11');
    // Automatik: Haken setzt/loescht den 60-Sekunden-Takt
    expect(await page.evaluate(() => bkmpAdminEvents.isAutoRefreshOn())).toBe(false);
    await page.check('[data-testid="aev-auto"]');
    expect(await page.evaluate(() => bkmpAdminEvents.isAutoRefreshOn())).toBe(true);
    await page.uncheck('[data-testid="aev-auto"]');
    expect(await page.evaluate(() => bkmpAdminEvents.isAutoRefreshOn())).toBe(false);
  });

});

/* ============================================================
   Berliner Zeit unabhaengig von der Zeitzone des Browsers
   ============================================================ */
test.describe('Reiter "Events" - Zeitzone', () => {
  test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });
  test('Start/Ende zeigen Berliner Uhrzeit, auch wenn der Browser in Los Angeles laeuft', async ({ page, store, qaBaseURL }) => {
    test.skip(!isDesktop(), 'Desktop-Projekt.');
    await setup(page, store, qaBaseURL, f.makeZwielichtScenario(Date.now()));
    const header = await text(page.locator('[data-testid="aev-header"]'));
    expect(header).toMatch(/Start\s*\d{2}\.\d{2}\.\d{4}, 00:00 Uhr/);          // Mitternacht BERLIN, nicht Los Angeles
    expect(header).toMatch(/Ende\s*\d{2}\.\d{2}\.\d{4}, 23:59 Uhr/);
    expect(await page.evaluate(() => new Date().toString())).toMatch(/Pacific/);   // der Browser lief wirklich in LA
    // Der "heute"-Zaehler richtet sich nach dem BERLINER Tag, nicht nach dem Browser-Tag
    expect(await text(page.locator('[data-testid="aev-kpi-today"] .aev-kpi-value'))).toBe('7');
  });
});

/* ============================================================
   Status, mehrere Events, beliebige Konfiguration (Desktop)
   ============================================================ */
test.describe('Reiter "Events" - Status und fremde Events (Desktop)', () => {
  test.beforeEach(() => { test.skip(!isDesktop(), 'Desktop-Projekt.'); });
  const HOUR = 3600 * 1000;

  for (const [label, expectedBadge, patchFn, timeText, todayShown] of [
    ['kommend', 'Kommt bald', now => ({ announce_at: new Date(now - HOUR).toISOString(), starts_at: new Date(now + 24 * HOUR).toISOString(), ends_at: new Date(now + 8 * 24 * HOUR).toISOString() }), 'startet in', false],
    ['beendet', 'Beendet', now => ({ announce_at: new Date(now - 10 * 24 * HOUR).toISOString(), starts_at: new Date(now - 9 * 24 * HOUR).toISOString(), ends_at: new Date(now - 2 * 24 * HOUR).toISOString() }), 'beendet vor', false],
    ['archiviert', 'Archiviert', () => ({ archived: true }), null, false],
    ['versteckt', 'Versteckt', () => ({ enabled: false }), null, false]
  ]) {
    test('Status ' + label + ': Badge "' + expectedBadge + '", Zahlen bleiben auswertbar, nichts wird geraten', async ({ page, store, qaBaseURL }) => {
      const sc = f.makeZwielichtScenario(Date.now());
      Object.assign(sc.event, patchFn(Date.now()));
      await setup(page, store, qaBaseURL, sc);
      await expect(page.locator('[data-testid="aev-status"]')).toHaveText(expectedBadge);
      if (timeText) await expect(page.locator('[data-testid="aev-timeline-text"]')).toContainText(timeText);
      else await expect(page.locator('[data-testid="aev-timeline-text"]')).toHaveCount(0);
      // Event-Archiv: die Auswertung funktioniert trotzdem komplett
      expect(await text(page.locator('[data-testid="aev-kpi-started"] .aev-kpi-value'))).toBe('10');
      expect(await text(page.locator('[data-testid="aev-kpi-completed"] .aev-kpi-value'))).toBe('3');
      expect(await text(page.locator('[data-testid="aev-kpi-today"] .aev-kpi-value'))).toBe('–');   // "heute aktiv" gibt es nur bei laufendem Event
      await expect(page.locator('[data-testid="aev-kpi-today"]')).toContainText('nur bei laufendem Event');
      await expect(page.locator('[data-testid="aev-histogram"] .aev-bar')).toHaveCount(31);
      await expect(page.locator('[data-testid="aev-player-row"]')).toHaveCount(10);
    });
  }

  test('Ein ganz anderes Event (12 Stufen, 250 Punkte, 3 Auswahl-Arten, eigene Aufgaben): nichts ist auf Zwielicht fest verdrahtet', async ({ page, store, qaBaseURL }) => {
    const zw = f.makeZwielichtScenario(Date.now());
    const ff = f.makeCustomEventScenario(Date.now());
    prepareStore(store, zw);
    seedScenario(store, ff);
    await loginAdmin(page, qaBaseURL);
    await openEvents(page);
    // Standard = laufendes Event; beide stehen in der Auswahl
    await expect(page.locator('[data-testid="aev-event-select"]')).toHaveValue('zwielicht');
    await expect(page.locator('[data-testid="aev-event-select"] option')).toHaveCount(2);
    // Vergleich erscheint, weil zwei Events Teilnehmer haben
    await expect(page.locator('[data-testid="aev-compare-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="aev-compare-table"] tbody tr')).toHaveCount(2);

    await page.selectOption('[data-testid="aev-event-select"]', 'frostfest');
    await expect(page.locator('[data-testid="aev-title"]')).toHaveText('❄️ Frostfest');
    await expect(page.locator('[data-testid="aev-status"]')).toHaveText('Beendet');
    const header = await text(page.locator('[data-testid="aev-header"]'));
    expect(header).toMatch(/Punkte bis zum Ziel\s*i?\s*3\.000/);                     // 12 x 250
    expect(header).toMatch(/Maximal erreichbar \(geschätzt\)\s*i?\s*1\.270/);
    const kpi = async key => text(page.locator('[data-testid="aev-kpi-' + key + '"] .aev-kpi-value'));
    expect(await kpi('started')).toBe('5');
    expect(await kpi('avg')).toBe('9,2');                                             // (12+12+8+2+12)/5
    expect(await kpi('median')).toBe('12,0');
    expect(await kpi('completed')).toBe('3');
    expect(await kpi('points')).toBe('11.900');
    await expect(page.locator('[data-testid="aev-histogram"] .aev-bar')).toHaveCount(13);          // Stufe 0..12
    await expect(page.locator('[data-testid="aev-bar-12"]')).toHaveAttribute('data-count', '3');
    await expect(page.locator('[data-testid="aev-bar-30"]')).toHaveCount(0);
    // Meilensteine nur dort, wo die Konfiguration Ei/Auswahl/Freischaltung hat: Stufen 8 und 12
    await expect(page.locator('[data-testid^="aev-milestone-"]')).toHaveCount(2);
    expect(await text(page.locator('[data-testid="aev-milestone-8"]'))).toContain('Seltenes Ei');
    // Auswahl: DREI Arten, Namen aus der Event-Konfiguration
    await expect(page.locator('[data-testid^="aev-choice-"][data-testid$="aaa"]')).toContainText('Aaa-Drache');
    await expect(page.locator('[data-testid="aev-choice-bbb"] strong')).toHaveText('0');
    await expect(page.locator('[data-testid="aev-choice-ccc"] strong')).toHaveText('1');
    await expect(page.locator('[data-testid="aev-choice-open"]')).toHaveText('1');
    // Eigene Aufgaben mit eigenen Namen
    expect(await text(page.locator('[data-testid="aev-quest-c_a"]'))).toContain('Alpha-Aufgabe');
    expect(await text(page.locator('[data-testid="aev-weekly-cw_x"]'))).toContain('Wochen-X');
    await expect(page.locator('[data-testid="aev-reward-table"] tbody tr')).toHaveCount(12);
    // nichts von Zwielicht darf stehenbleiben
    // (der Event-Vergleich nennt absichtlich BEIDE Events - er wird hier ausgenommen)
    const sections = await page.locator('#aevBody > *:not(:has([data-testid="aev-compare-table"]))').evaluateAll(els => els.map(e => e.textContent).join(' '));
    expect(sections).not.toMatch(/Lightnix|Darknix|Dayman|Surebrec|Zwielicht|Drachenjäger/);
    expect(sections).toContain('Frostfest');
    expect(await page.locator('[data-testid="aev-player-row"]').count()).toBe(5);
    // zurueck zu Zwielicht
    await page.selectOption('[data-testid="aev-event-select"]', 'zwielicht');
    await expect(page.locator('[data-testid="aev-kpi-started"] .aev-kpi-value')).toHaveText('10');
  });

  test('Kein Event vorhanden: freundliche Leer-Ansicht statt Fehler', async ({ page, store, qaBaseURL }) => {
    prepareStore(store, null);
    await loginAdmin(page, qaBaseURL);
    const nav = page.locator('[data-testid="admin-nav-events"]');
    await nav.click();
    await expect(page.locator('[data-testid="aev-empty"]')).toContainText('noch kein Event');
    await expect(page.locator('[data-testid="aev-error"]')).toHaveCount(0);
  });

  test('Event ohne Teilnehmer: alles 0/leer, keine NaN-Werte', async ({ page, store, qaBaseURL }) => {
    const sc = f.makeZwielichtScenario(Date.now());
    sc.players = []; sc.log = []; sc.stats = [];
    await setup(page, store, qaBaseURL, sc);
    expect(await text(page.locator('[data-testid="aev-kpi-started"] .aev-kpi-value'))).toBe('0');
    expect(await text(page.locator('[data-testid="aev-kpi-avg"] .aev-kpi-value'))).toBe('–');
    expect(await text(page.locator('[data-testid="aev-kpi-median"] .aev-kpi-value'))).toBe('–');
    await expect(page.locator('[data-testid="aev-players"]')).toContainText('Noch keine Teilnehmer');
    const all = await text(page.locator('#aevBody'));
    expect(all).not.toMatch(/NaN|Infinity|undefined|null/);
  });
});

/* ============================================================
   Zugriff + Fehlerfaelle (Desktop)
   ============================================================ */
test.describe('Reiter "Events" - Zugriff und Fehlerfaelle (Desktop)', () => {
  test.beforeEach(() => { test.skip(!isDesktop(), 'Desktop-Projekt.'); });
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json' };

  test('Redakteur (editor) darf den Reiter nutzen', async ({ page, store, qaBaseURL }) => {
    await setup(page, store, qaBaseURL, f.makeZwielichtScenario(Date.now()), 'editor');
    await expect(page.locator('[data-testid="aev-kpi-started"] .aev-kpi-value')).toHaveText('10');
  });

  test('Mitarbeiter-Konto (expenses_editor): Reiter nicht sichtbar, Daten auch per direktem Aufruf gesperrt', async ({ page, store, qaBaseURL }) => {
    prepareStore(store, f.makeZwielichtScenario(Date.now()), 'expenses_editor');
    await loginAdmin(page, qaBaseURL);
    await expect(page.locator('[data-testid="admin-nav-events"]')).toBeHidden();
    // selbst wenn jemand die Funktion direkt aufruft: der Server verweigert die Daten
    const out = await page.evaluate(async () => {
      const res = await bkmpGetSupabaseClient().rpc('admin_event_overview', { p_event_id: 'zwielicht' });
      return { data: res.data, error: res.error ? (res.error.message || res.error.code) : null };
    });
    expect(out.data).toBeNull();
    expect(out.error).toMatch(/not_admin/);
    // und die Seite selbst zeigt dann eine klare Meldung statt Daten
    await page.evaluate(() => {
      document.querySelectorAll('.admin-page').forEach(s => s.classList.toggle('active', s.id === 'page-events'));
      bkmpAdminEventsOnOpen();
    });
    await expect(page.locator('[data-testid="aev-error"]')).toContainText('Kein Zugriff');
    await expect(page.locator('[data-testid="aev-kpi-started"]')).toHaveCount(0);
  });

  test('Schaf-Konto (sheep_editor): ebenfalls kein Zugriff', async ({ page, store, qaBaseURL }) => {
    prepareStore(store, f.makeZwielichtScenario(Date.now()), 'sheep_editor');
    await loginAdmin(page, qaBaseURL);
    await expect(page.locator('[data-testid="admin-nav-events"]')).toBeHidden();
    const err = await page.evaluate(async () => { const r = await bkmpGetSupabaseClient().rpc('admin_event_list'); return r.error ? r.error.message : null; });
    expect(err).toMatch(/not_admin/);
  });

  test('Ausgeloggt: keine einzige Funktion liefert Daten', async ({ page, store, qaBaseURL }) => {
    prepareStore(store, f.makeZwielichtScenario(Date.now()));
    await page.goto(qaBaseURL + '/admin.html');
    await expect(page.locator('#loginCard')).toBeVisible();
    const out = await page.evaluate(async () => {
      const client = bkmpGetSupabaseClient();
      const results = {};
      for (const [fn, args] of [['admin_event_list', {}], ['admin_event_overview', { p_event_id: 'zwielicht' }], ['admin_event_quests', { p_event_id: 'zwielicht' }],
        ['admin_event_timeline', { p_event_id: 'zwielicht' }], ['admin_event_players', { p_event_id: 'zwielicht' }], ['admin_event_player_detail', { p_event_id: 'zwielicht', p_auth_user_id: '00000000-0000-4000-8000-000000000001' }]]) {
        const r = await client.rpc(fn, args);
        results[fn] = { hasData: r.data != null, error: Boolean(r.error) };
      }
      return results;
    });
    for (const [fn, r] of Object.entries(out)) { expect(r.hasData, fn).toBe(false); expect(r.error, fn).toBe(true); }
  });

  test('Fehler beim Laden: klare Meldung + "Erneut versuchen" (danach funktioniert alles wieder)', async ({ page, store, qaBaseURL }) => {
    prepareStore(store, f.makeZwielichtScenario(Date.now()));
    await loginAdmin(page, qaBaseURL);
    let fail = true;
    await page.route('**/rest/v1/rpc/admin_event_overview*', route => {
      if (!fail) return route.fallback();
      return route.fulfill({ status: 500, headers: CORS, body: JSON.stringify({ message: 'Datenbank kurz nicht erreichbar', code: 'XX000' }) });
    });
    await page.locator('[data-testid="admin-nav-events"]').click();
    await expect(page.locator('[data-testid="aev-error"]')).toContainText('Laden fehlgeschlagen');
    await expect(page.locator('[data-testid="aev-error"]')).toContainText('Datenbank kurz nicht erreichbar');
    fail = false;
    await page.locator('#aevRetry').click();
    await expect(page.locator('[data-testid="aev-header"]')).toBeVisible();
    await expect(page.locator('[data-testid="aev-error"]')).toHaveCount(0);
  });

  test('SQL noch nicht eingespielt: die Meldung nennt die Datei', async ({ page, store, qaBaseURL }) => {
    prepareStore(store, f.makeZwielichtScenario(Date.now()));
    await loginAdmin(page, qaBaseURL);
    await page.route('**/rest/v1/rpc/admin_event_list*', route => route.fulfill({
      status: 404, headers: CORS, body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.admin_event_list without parameters in the schema cache' })
    }));
    await page.locator('[data-testid="admin-nav-events"]').click();
    await expect(page.locator('[data-testid="aev-error"]')).toContainText('sql/20261005-event-admin-stats.sql');
  });
});

/* ============================================================
   Leistung (Desktop)
   ============================================================ */
test.describe('Reiter "Events" - Leistung', () => {
  test('Viele Teilnehmer: Seite bleibt schnell, es werden nie alle Spieler gerendert', async ({ page, store, qaBaseURL }) => {
    test.skip(!isDesktop(), 'Desktop-Projekt.');
    const sc = f.makeZwielichtScenario(Date.now());
    const bulk = f.makeBulkPlayers(5000, 'zwielicht', Date.now());
    sc.players.push(...bulk.players); sc.stats.push(...bulk.stats); sc.log.push(...bulk.log);
    prepareStore(store, sc);
    await loginAdmin(page, qaBaseURL);
    const t0 = Date.now();
    await page.locator('[data-testid="admin-nav-events"]').click();
    await expect(page.locator('[data-testid="aev-header"]')).toBeVisible({ timeout: 30000 });
    const loadMs = Date.now() - t0;
    expect(await text(page.locator('[data-testid="aev-kpi-started"] .aev-kpi-value'))).toBe('5.010');
    await expect(page.locator('[data-testid="aev-player-row"]')).toHaveCount(25);
    await expect(page.locator('[data-testid="aev-pager-info"]')).toHaveText('1–25 von 5.010');
    const domNodes = await page.evaluate(() => document.querySelectorAll('#page-events *').length);
    expect(domNodes).toBeLessThan(6000);
    test.info().annotations.push({ type: 'Ladezeit 5.010 Teilnehmer (ms)', description: String(loadMs) });
    expect(loadMs).toBeLessThan(15000);
    // Suche/Sortierung bleiben flink
    const t1 = Date.now();
    await page.fill('[data-testid="aev-search"]', 'spieler04');
    await expect(page.locator('[data-testid="aev-pager-info"]')).toContainText('von 1.000');
    expect(Date.now() - t1).toBeLessThan(8000);
  });
});

/* ============================================================
   Keine Fehler in der Konsole (alle Projekte)
   ============================================================ */
test.describe('Reiter "Events" - Konsole', () => {
  test('Oeffnen, Bedienen, Spielerkarte, Aktualisieren: keine Skript- oder Konsolenfehler vom neuen Reiter', async ({ page, store, qaBaseURL }) => {
    const errors = [];
    // Zwei Fehler der bestehenden Admin-Seite (idledorf.js, nicht Teil dieser Arbeit) werden ausgeklammert,
    // damit der Test nur den neuen Reiter pruefen kann.
    const KNOWN_UNRELATED = [/bkmpIdleRenderGildeTechPanel is not defined/, /Cannot access 'bkmpIdleTabs' before initialization/];
    const keep = msg => !KNOWN_UNRELATED.some(re => re.test(msg));
    page.on('pageerror', e => { if (keep(String(e && e.message || e))) errors.push('pageerror: ' + (e && e.message || e)); });
    page.on('console', m => { if (m.type() === 'error' && keep(m.text())) errors.push('console: ' + m.text()); });

    const sc = f.makeZwielichtScenario(Date.now());
    const bulk = f.makeBulkPlayers(30, 'zwielicht', Date.now());
    sc.players.push(...bulk.players); sc.stats.push(...bulk.stats); sc.log.push(...bulk.log);
    await setup(page, store, qaBaseURL, sc);

    await page.locator('[data-testid="aev-bar-20"]').click();
    await page.locator('[data-testid="aev-kpi-active"] .aev-info').click();
    await page.fill('[data-testid="aev-search"]', 'spieler');
    await expect(page.locator('[data-testid="aev-player-row"]').first()).toBeVisible();
    await page.locator('[data-testid="aev-player-row"]').first().click();
    await expect(page.locator('[data-testid="aev-detail"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="aev-refresh"]').click();
    await expect(page.locator('[data-testid="aev-last-updated"]')).toContainText('Zuletzt aktualisiert');
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
