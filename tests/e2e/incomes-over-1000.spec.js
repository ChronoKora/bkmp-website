/* Einnahmen ueber 1.000 Zeilen (15.10.2026).

   Live-Befund: 1.008 Einnahmen in der Datenbank, Supabase liefert je Abfrage hoechstens
   1.000 Zeilen (PostgREST max-rows). loadIncomes() holte alles in EINER Abfrage, sortiert
   nach Datum aufsteigend - die 8 neuesten Buchungen (Tageszaehler-Import vom 14.10.)
   fehlten in Admin-Liste, Summen und auf der oeffentlichen Seite.

   Der Mock begrenzt hier wie Supabase auf 1.000 Zeilen je Abfrage (store.maxRows).
   Die 11 Zeilen vom 14.10. haben wie bei einem Import dasselbe created_at und ids, die
   nicht der Einfuegereihenfolge entsprechen - prueft den id-Sortierschluessel an der
   Blockgrenze (keine Zeile doppelt, keine fehlt). Erwartungswerte von Hand gerechnet. */
const { test, expect } = require('../helpers/qa-fixtures');
const { table } = require('../mock/store');
const { handleRestRequest } = require('../mock/rest-engine');

const ADMIN_PW = 'admin-pw-123';
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

/* Wie live am 14.10. importiert: Summe 1.718.709,30 */
const IMPORT_14 = [1037025, 519750, 59771.25, 55440, 32917.5, 5940, 4752, 1435.5, 1237.5, 321.75, 118.8];

function seed(store) {
  store.maxRows = 1000;
  const email = 'chef@bkmp-admin-accounts.com';
  store.authUsersByEmail.set(email, { id: uid(900), email, password: ADMIN_PW, user_metadata: {} });
  table(store, 'admin_profiles').push({ id: 'ap-900', auth_user_id: uid(900), login_name: email, role: 'admin', active: true, display_name: 'chef' });
  const rows = table(store, 'incomes');
  // 997 aeltere Einnahmen zu je 100 € (01.07. bis 12.10.), je eigener Zeitstempel
  const start = Date.parse('2026-07-01T12:00:00Z');
  for (let i = 0; i < 997; i++) {
    const t = new Date(start + i * 2.5 * 3600 * 1000);
    rows.push({ id: uid(10000 + i), category: 'Bücher', amount: 100, date: t.toISOString().slice(0, 10), note: null, quantity: 1, created_at: t.toISOString() });
  }
  // 11 Zeilen vom 14.10., gleiches created_at, ids absichtlich durcheinander
  IMPORT_14.forEach((amount, i) => rows.push({
    id: uid(20000 + ((i * 7) % 11)), category: i === 0 ? 'Bücher' : 'Custom', amount, date: '2026-10-14',
    note: 'Netto aus Tageszähler: Test ' + i, quantity: null, created_at: '2026-10-15T10:02:43Z'
  }));
}
// 997 × 100 + 1.718.709,30
const TOTAL = 99700 + 1718709.3;

test.describe('Einnahmen über 1.000 Zeilen', () => {
  test('Mock begrenzt wie Supabase auf 1.000 Zeilen je Abfrage (Voraussetzung)', async ({ store }) => {
    seed(store);
    const res = handleRestRequest(store, { method: 'GET', tableName: 'incomes', searchParams: new URLSearchParams('select=id'), body: null, headers: {} });
    expect(res.json).toHaveLength(1000);
  });

  test('Admin: alle 1.008 Einnahmen geladen, neueste sichtbar, Summe vollständig', async ({ page, store, qaBaseURL }) => {
    store.clock.setNow(Date.parse('2026-10-15T12:00:00Z'));
    seed(store);
    await page.goto(qaBaseURL + '/admin.html');
    await page.fill('#loginName', 'chef');
    await page.fill('#loginPassword', ADMIN_PW);
    await page.click('#loginBtn');
    await expect(page.locator('#adminWrap')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#overviewGrid')).toContainText('1008 Buchungen', { timeout: 20000 });

    const loaded = await page.evaluate(() => ({
      n: data.income.length,
      unique: new Set(data.income.map(r => r.id)).size,
      sum: bkmpSum(data.income),
      day14: data.income.filter(r => r.date === '2026-10-14').length
    }));
    expect(loaded.n).toBe(1008);
    expect(loaded.unique).toBe(1008);
    expect(loaded.day14).toBe(11);
    expect(loaded.sum).toBeCloseTo(TOTAL, 2);

    const nav = page.locator('.admin-nav-btn[data-page="income"]');
    await nav.scrollIntoViewIfNeeded();
    await nav.click();
    // Neueste Zeile (Bücher 1.037.025 vom 14.10.) steht oben in der Liste
    await expect(page.locator('#incomeList .entry-row').first()).toContainText('1.037.025');
    await expect(page.locator('#incomeList .entry-row', { hasText: '14. Oktober 2026' })).toHaveCount(11);
  });

  test('Öffentliche Seite: loadIncomes() liefert alle 1.008 Einnahmen', async ({ page, store, qaBaseURL }) => {
    seed(store);
    await page.goto(qaBaseURL + '/');
    await page.waitForFunction(() => typeof loadIncomes === 'function' && typeof bkmpGetSupabaseClient === 'function' && !!bkmpGetSupabaseClient(), null, { timeout: 20000 });
    const r = await page.evaluate(() => loadIncomes().then(list => ({ n: list.length, unique: new Set(list.map(x => x.id)).size, last: list[list.length - 1].date })));
    expect(r).toEqual({ n: 1008, unique: 1008, last: '2026-10-14' });
  });
});
