/* Tageszaehler-Import im Admin-Panel (15.10.2026) - die Oberflaeche im echten Browser.

   Der Browser spricht mit dem lokalen Mock-Backend; die beiden Datenbankfunktionen laufen
   ueber den JS-Nachbau (tests/mock/tageszaehler-import-engine.js), dessen Gleichheit mit
   dem echten SQL tests/e2e/tageszaehler-import-parity.spec.js beweist.
   Anmeldung ueber das echte Admin-Login-Formular, kein Produktionskontakt.
   Erwartungswerte von Hand gerechnet. */
const { test, expect } = require('../helpers/qa-fixtures');
const { table } = require('../mock/store');
const { TAGESZAEHLER_IMPORT_HANDLERS: TWIN } = require('../mock/tageszaehler-import-engine');

const ADMIN_PW = 'admin-pw-123';
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const isDesktop = () => test.info().project.name === 'chromium-desktop';

function seedAccount(store, { name, role, uidN }) {
  const email = name + '@bkmp-admin-accounts.com';
  store.authUsersByEmail.set(email, { id: uid(uidN), email, password: ADMIN_PW, user_metadata: {} });
  table(store, 'admin_profiles').push({ id: 'ap-' + uidN, auth_user_id: uid(uidN), login_name: email, role, active: true, display_name: name });
}

/* Von Hand erfasste Brutto-Zeilen wie auf der echten Seite. */
function seedManual(store) {
  table(store, 'incomes').push(
    { id: uid(501), category: 'Bücher', amount: 2310000, date: '2026-10-14', note: null, quantity: 924, created_at: '2026-10-14T11:03:00Z' },
    { id: uid(502), category: 'Karten', amount: 396000, date: '2026-10-14', note: null, quantity: null, created_at: '2026-10-14T11:04:00Z' },
    { id: uid(503), category: 'Werkzeug', amount: 75000, date: '2026-10-12', note: null, quantity: 1, created_at: '2026-10-14T10:55:00Z' }
  );
}

/* Importdatei wie vom Tageszaehler (Betraege als Text + Cent). */
function day(date, revisionId, revisionAt, fp, positions) {
  const pos = positions.map(([id, name, netto, menge, status, hinweis]) => ({
    kategorieId: id, kategorieName: name, netto, nettoCent: Math.round(Number(netto) * 100),
    menge: menge == null ? null : menge, mengeStatus: status, mengeHinweis: hinweis || null
  }));
  return { datum: date, revisionId, revisionErstellt: revisionAt, fingerabdruck: fp.repeat(64).slice(0, 64), erfassung: 'Vollstaendig',
    verkaufszeilen: 242, summeCent: pos.reduce((s, p) => s + p.nettoCent, 0), positionen: pos };
}
function importFile(days) {
  return {
    format: 'bkmp-tageszaehler-import', version: 1, erstelltAm: '2026-10-15T10:00:00Z',
    quelle: { programm: 'OPSUCHT Tageszähler', version: '2.2.0', konto: 'chestshop-hauptkonto', kontoName: 'Chest-Shop-Hauptkonto' },
    freigabe: { text: '14.10.2026 mit 1.718.709,30 netto an BK Investment übertragen', bestaetigtAm: '2026-10-15T10:00:00Z' },
    tage: days, summeCent: days.reduce((s, d) => s + d.summeCent, 0)
  };
}
/* 14.10.: Summe von Hand 1.684.980,00 + 32.670 + 371,25 + 688,05 = 1.718.709,30 */
const DAY_14 = day('2026-10-14', '20261015-093555-001-aaaaaa', '2026-10-15T09:35:55Z', 'a', [
  ['buecher', 'Bücher', '1684980.00', 680.8, 'vollstaendig'],
  ['barren', 'Netheritbarren', '32670.00', null, 'offen', 'Kistenpreis noch nicht bestätigt'],
  ['raketen', 'Raketen', '371.25', null, 'offen', '24 Items = 0,375 Einheiten'],
  ['karten', 'Karten', '688.05', null, 'teilweise']
]);
DAY_14.positionen[0].menge = 680;   // ganze Zahl wie im Zaehler
DAY_14.positionen[0].netto = '1684980.00';
const FILE_14 = importFile([DAY_14]);

async function loginAndOpen(page, qaBaseURL, name) {
  await page.goto(qaBaseURL + '/admin.html');
  await page.fill('#loginName', name || 'chef');
  await page.fill('#loginPassword', ADMIN_PW);
  await page.click('#loginBtn');
  await expect(page.locator('#adminWrap')).toBeVisible({ timeout: 20000 });
  const nav = page.locator('[data-testid="admin-nav-tzimport"]');
  await nav.scrollIntoViewIfNeeded();
  await nav.click();
  await expect(page.locator('#page-tzimport.active')).toBeVisible();
}
async function upload(page, file, name) {
  await page.setInputFiles('[data-testid="tzi-file"]', { name: name || 'bk-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
}
const line = (page, cat) => page.locator(`[data-testid="tzi-line"][data-key="tz1:chestshop-hauptkonto:2026-10-14:${cat}"]`);

test.describe('Tageszähler-Import: Hauptablauf', () => {
  test('Vorschau, Entscheidungen, Übernahme, Nachweis, kein Doppelimport', async ({ page, store, qaBaseURL }) => {
    store.clock.setNow(Date.parse('2026-10-15T10:00:00Z'));
    seedAccount(store, { name: 'chef', role: 'admin', uidN: 900 });
    seedManual(store);
    await loginAndOpen(page, qaBaseURL);
    await upload(page, FILE_14);

    await expect(page.locator('[data-testid="tzi-file-total"]')).toHaveText('1.718.709,30 €');
    // Auch auf dem Handy: keine Karte ragt ueber den Bildschirmrand (Tabellen scrollen in der Karte).
    const overflow = await page.evaluate(() => [...document.querySelectorAll('#page-tzimport .tzi-card')]
      .map(c => Math.round(c.getBoundingClientRect().right - window.innerWidth)).filter(d => d > 1));
    expect(overflow).toEqual([]);
    await expect(page.locator('[data-testid="tzi-day-netto"]')).toHaveText('1.718.709,30 €');
    // Standardzuordnung: Netheritbarren -> Netherite, Karten -> Karten (mit Hinweis)
    await expect(page.locator('select[data-tzi-map="barren"]')).toHaveValue('Netherite');
    await expect(page.locator('[data-testid="tzi-mapping"]')).toContainText('150.000');
    // Menge: nur bei vollstaendiger Menge, sonst leer
    await expect(line(page, 'buecher')).toContainText('680');
    await expect(line(page, 'raketen')).toContainText('offen – leer');
    await expect(line(page, 'karten')).toContainText('teilweise bekannt – leer');
    await expect(line(page, 'raketen')).toContainText('24 Items = 0,375 Einheiten');
    // Zwei Konflikte mit von Hand erfassten Zeilen (Bücher, Karten) -> Entscheidung noetig
    await expect(page.locator('[data-testid="tzi-decision"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="tzi-missing"]')).toContainText('2 Entscheidung');
    await expect(page.locator('[data-testid="tzi-apply"]')).toBeDisabled();

    await page.check(`input[data-tzi-choice="tz1:chestshop-hauptkonto:2026-10-14:buecher"][value="replace"]`);
    await page.check(`input[data-tzi-choice="tz1:chestshop-hauptkonto:2026-10-14:karten"][value="replace"]`);
    // Website vorher 2.310.000 + 396.000 = 2.706.000; nachher = nur der Import 1.718.709,30
    await expect(page.locator('[data-testid="tzi-day-after"]')).toHaveText('1.718.709,30 €');
    await expect(page.locator('[data-testid="tzi-diff"]')).toHaveText('−987.290,70 €');
    await expect(page.locator('[data-testid="tzi-confirm-text"]')).toHaveText('14.10.2026 mit 1.718.709,30 € netto an BK Investment übertragen.');
    await expect(page.locator('[data-testid="tzi-apply"]')).toBeDisabled();       // Haken fehlt noch
    await page.check('input[data-tzi-confirmed]');
    await page.click('[data-testid="tzi-apply"]');

    await expect(page.locator('[data-testid="tzi-result"]')).toContainText('4 angelegt');
    await expect(page.locator('[data-testid="tzi-result"]')).toContainText('2 von Hand erfasste Zeile(n) ersetzt');
    await expect(page.locator('[data-testid="tzi-result"]')).toContainText('alle Einnahmen des Tages 1.718.709,30 €');

    // In der Datenbank (Nachbau): exakte Nettobetraege, Menge nur bei Buechern, anderer Tag unberuehrt
    const rows = table(store, 'incomes').filter(i => i.date === '2026-10-14');
    expect(rows.map(r => [r.category, r.amount, r.quantity]).sort()).toEqual([
      ['Bücher', 1684980, 680], ['Karten', 688.05, null], ['Netherite', 32670, null], ['Raketen', 371.25, null]
    ].sort());
    expect(table(store, 'incomes').some(i => i.id === uid(503))).toBe(true);

    // Dieselbe Datei nochmal: nichts zu tun
    await upload(page, FILE_14, 'bk-import-nochmal.json');
    await expect(page.locator('[data-testid="tzi-nothing"]')).toBeVisible();
    await expect(page.locator('[data-testid="tzi-apply"]')).toHaveCount(0);
    expect(table(store, 'incomes').filter(i => i.date === '2026-10-14')).toHaveLength(4);
  });
});

test.describe('Tageszähler-Import: Sicherheit und Fehlerfälle', () => {
  test.beforeEach(() => { test.skip(!isDesktop(), 'Detailtests laufen auf dem Desktop-Projekt (Handy-Abdeckung: Hauptablauf).'); });

  test('Verlorene Serverantwort: erneutes Senden bucht nichts doppelt', async ({ page, store, qaBaseURL }) => {
    store.clock.setNow(Date.parse('2026-10-15T10:00:00Z'));
    seedAccount(store, { name: 'chef', role: 'admin', uidN: 900 });
    await loginAndOpen(page, qaBaseURL);
    // Server speichert, aber die Antwort kommt nie an. WICHTIG: kein route.fetch()/route.continue() -
    // die Seite spricht die Produktions-Adresse an, die nur die Kontext-Route der Fixtures auf den
    // Nachbau umleitet; route.fetch() wuerde echt ins Netz gehen. Deshalb verarbeitet der erste Aufruf
    // den Auftrag direkt im Nachbau (ohne Netzwerk), der zweite faellt auf die Kontext-Route zurueck.
    let first = true;
    await page.route('**/rest/v1/rpc/tageszaehler_import_apply', async route => {
      if (first) {
        first = false;
        TWIN.tageszaehler_import_apply(store, uid(900), route.request().postDataJSON());
        await route.abort('failed');
      } else {
        await route.fallback();
      }
    });
    await upload(page, FILE_14);
    await page.check('input[data-tzi-confirmed]');
    await page.click('[data-testid="tzi-apply"]');
    await expect(page.locator('[data-testid="tzi-error"]')).toContainText('gefahrlos erneut gesendet');
    await expect(page.locator('[data-testid="tzi-apply"]')).toHaveText('Erneut senden (gleicher Auftrag)');
    expect(table(store, 'incomes')).toHaveLength(4);          // bereits gespeichert
    await page.click('[data-testid="tzi-apply"]');
    await expect(page.locator('[data-testid="tzi-result"]')).toContainText('Bereits übertragen');
    expect(table(store, 'incomes')).toHaveLength(4);          // nicht doppelt
  });

  test('Ungültige Datei wird abgelehnt, ohne etwas zu laden oder zu schreiben', async ({ page, store, qaBaseURL }) => {
    seedAccount(store, { name: 'chef', role: 'admin', uidN: 900 });
    await loginAndOpen(page, qaBaseURL);
    const kaputt = JSON.parse(JSON.stringify(FILE_14));
    kaputt.tage[0].positionen[1].nettoCent = 3267001;   // Cent passt nicht zum Betrag
    await upload(page, kaputt);
    await expect(page.locator('[data-testid="tzi-error"]')).toContainText('Betrag und Cent-Angabe passen nicht zusammen');
    await expect(page.locator('[data-testid="tzi-day"]')).toHaveCount(0);
    await upload(page, { format: 'etwas-anderes' });
    await expect(page.locator('[data-testid="tzi-error"]')).toContainText('keine Importdatei des Tageszählers');
    expect(table(store, 'incomes')).toHaveLength(0);
  });

  test('Mitarbeiter-Konto sieht den Import nicht', async ({ page, store, qaBaseURL }) => {
    seedAccount(store, { name: 'mitarbeiter', role: 'expenses_editor', uidN: 902 });
    await page.goto(qaBaseURL + '/admin.html');
    await page.fill('#loginName', 'mitarbeiter');
    await page.fill('#loginPassword', ADMIN_PW);
    await page.click('#loginBtn');
    await expect(page.locator('#adminWrap')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid="admin-nav-tzimport"]')).toBeHidden();
  });

  test('Neue Revision: Vorschau zeigt Änderung und Wegfall, Übernahme aktualisiert dieselben Zeilen', async ({ page, store, qaBaseURL }) => {
    store.clock.setNow(Date.parse('2026-10-15T10:00:00Z'));
    seedAccount(store, { name: 'chef', role: 'admin', uidN: 900 });
    await loginAndOpen(page, qaBaseURL);
    await upload(page, FILE_14);
    await page.check('input[data-tzi-confirmed]');
    await page.click('[data-testid="tzi-apply"]');
    await expect(page.locator('[data-testid="tzi-result"]')).toContainText('4 angelegt');
    const netherId = table(store, 'incomes').find(i => i.category === 'Netherite').id;

    // Revision 2: Kistenpreis bestaetigt (Menge 3, Betrag gleich), Karten geklaert und entfallen
    const rev2 = day('2026-10-14', '20261015-120000-002-bbbbbb', '2026-10-15T12:00:00Z', 'b', [
      ['buecher', 'Bücher', '1684980.00', 680, 'vollstaendig'],
      ['barren', 'Netheritbarren', '32670.00', 3, 'vollstaendig'],
      ['raketen', 'Raketen', '371.25', null, 'offen'],
      ['custom', 'Custom / Sonstige', '688.05', null, 'offen']
    ]);
    await upload(page, importFile([rev2]), 'bk-import-rev2.json');
    await expect(line(page, 'barren').locator('[data-testid="tzi-kind"]')).toHaveText('Änderung');
    await expect(line(page, 'karten').locator('[data-testid="tzi-kind"]')).toHaveText('entfällt (neue Revision)');
    await expect(line(page, 'custom').locator('[data-testid="tzi-kind"]')).toHaveText('neu');
    await expect(page.locator('[data-testid="tzi-diff"]')).toHaveText('0,00 €');   // reine Mengenklaerung + Umbuchung
    await page.check('input[data-tzi-confirmed]');
    await page.click('[data-testid="tzi-apply"]');
    await expect(page.locator('[data-testid="tzi-result"]')).toContainText('1 angelegt');
    await expect(page.locator('[data-testid="tzi-result"]')).toContainText('1 entfernt');
    const nether = table(store, 'incomes').find(i => i.category === 'Netherite');
    expect(nether.id).toBe(netherId);
    expect(nether.quantity).toBe(3);
    expect(table(store, 'incomes').filter(i => i.date === '2026-10-14').reduce((s, i) => s + Math.round(i.amount * 100), 0)).toBe(171870930);
  });
});
