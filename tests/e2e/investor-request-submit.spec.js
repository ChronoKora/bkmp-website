/* Investoren-Anfrage absenden (Marketing-Seite, kein Idle-Dorf).
   Fehlerbild vom 06.10.2026 (Spieler-Screenshot): beim Absenden erscheint
   "Deine Anfrage konnte nicht gesendet werden. Bitte versuche es spaeter erneut."
   Ursache: saveInvestorRequest() hat seit dem 23.07. .insert(...).select('id')
   benutzt. investor_requests darf aber nur von Admins gelesen werden (RLS), und
   ein Einfuegen, das die Zeile zurueckverlangt, wird dafuer gegen die SELECT-Regel
   geprueft -> 42501 fuer JEDEN normalen Besucher. Live nachgewiesen (anon-Key):
   dieselbe Anfrage mit return=representation -> 42501, mit return=minimal -> kommt
   bis zur Betrags-Pruefung durch.
   Der Mock (tests/mock/router.js) bildet diese Regel jetzt nach; ohne sie waere der
   Fehler hier nie aufgefallen. Gegenprobe: mit der alten Funktion ist dieser Test rot. */
const { test, expect } = require('../helpers/qa-fixtures');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PENDING_KEY = 'bkmp-pending-investor-requests';

async function openSite(page, qaBaseURL) {
  await page.goto(qaBaseURL + '/');
  await expect(page.locator('#investorRequestSubmit')).toBeAttached({ timeout: 15000 });
  await page.waitForFunction(() => typeof saveInvestorRequest === 'function' && !!bkmpGetSupabaseClient());
}
/* Die Klicks laufen per DOM-click(): das "Wer bist du?"-Fenster geht bei jedem
   Besuch ohne Login von selbst auf und wuerde echte Mausklicks abfangen. Getestet
   wird der Absende-Ablauf, nicht die Fensterstapelung. */
async function fillAndSubmit(page, v) {
  await page.evaluate(() => document.getElementById('openInvestorRequestForm').click());
  await expect(page.locator('#investorRequestOverlay')).toHaveClass(/visible/);
  await page.fill('#investorRequestName', v.name);
  await page.fill('#investorRequestMinecraftName', v.mc);
  await page.fill('#investorRequestAmount', String(v.amount));
  await page.selectOption('#investorRequestPeriod', String(v.period));
  if (v.anonymous) await page.check('#investorRequestAnonymous');
  await page.evaluate(() => document.getElementById('investorRequestSubmit').click());
}
function watch(page) {
  const posts = [];
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('request', r => {
    if (r.method() === 'POST' && /\/rest\/v1\/investor_requests/.test(r.url())) {
      posts.push({ url: r.url(), prefer: r.headers()['prefer'] || '', body: r.postDataJSON() });
    }
  });
  return { posts, dialogs };
}

test.describe('Investoren-Anfrage absenden', () => {
  test('Normaler Besucher (nicht eingeloggt): Anfrage kommt an, Erfolgsansicht, keine Fehlermeldung', async ({ page, qaBaseURL, store }) => {
    const w = watch(page);
    await openSite(page, qaBaseURL);
    await fillAndSubmit(page, { name: 'Thangentehaken42', mc: 'Thangentehake42', amount: 75000000, period: 3, anonymous: false });
    await expect(page.locator('#investorRequestSuccessView')).toBeVisible({ timeout: 10000 });
    expect(w.dialogs, 'keine Fehlermeldung (alert)').toEqual([]);
    const rows = store.tables.investor_requests || [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Thangentehaken42', minecraft_name: 'Thangentehake42', amount: 75000000,
      share_percent: 7.5, period_months: 3, anonymous: false, status: 'pending' });
  });

  test('Die Anfrage verlangt die Zeile NICHT zurueck (kein return=representation, kein ?select=) - nur das ist fuer Nicht-Admins erlaubt', async ({ page, qaBaseURL }) => {
    const w = watch(page);
    await openSite(page, qaBaseURL);
    await fillAndSubmit(page, { name: 'A', mc: 'B', amount: 50000000, period: 1, anonymous: true });
    await expect(page.locator('#investorRequestSuccessView')).toBeVisible({ timeout: 10000 });
    expect(w.posts).toHaveLength(1);
    expect(w.posts[0].prefer).not.toMatch(/return=representation/);
    expect(w.posts[0].url).not.toMatch(/[?&]select=/);
    expect(w.posts[0].body.status).toBe('pending');
  });

  test('Die ID vergibt der Browser: gueltige UUID v4 im Insert, gespeichert in der Zeile UND fuer die Entscheidungs-Benachrichtigung gemerkt', async ({ page, qaBaseURL, store }) => {
    const w = watch(page);
    await openSite(page, qaBaseURL);
    await fillAndSubmit(page, { name: 'Test', mc: 'T', amount: 100000000, period: 6, anonymous: false });
    await expect(page.locator('#investorRequestSuccessView')).toBeVisible({ timeout: 10000 });
    const sentId = w.posts[0].body.id;
    expect(sentId).toMatch(UUID_V4);
    expect(store.tables.investor_requests[0].id).toBe(sentId);
    // 1x-Popup (23.07.): die ID muss lokal gemerkt sein, sonst gibt es spaeter keine Benachrichtigung.
    const pending = await page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), PENDING_KEY);
    expect(pending.map(p => (typeof p === 'string' ? p : p.id))).toContain(sentId);
  });

  test('Zwei Anfragen (nach Ablauf der Sperrzeit) bekommen verschiedene IDs', async ({ page, qaBaseURL, store }) => {
    await openSite(page, qaBaseURL);
    await fillAndSubmit(page, { name: 'Eins', mc: 'E', amount: 60000000, period: 1, anonymous: false });
    await expect(page.locator('#investorRequestSuccessView')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await openSite(page, qaBaseURL);
    await fillAndSubmit(page, { name: 'Zwei', mc: 'Z', amount: 70000000, period: 1, anonymous: false });
    await expect(page.locator('#investorRequestSuccessView')).toBeVisible({ timeout: 10000 });
    const ids = store.tables.investor_requests.map(r => r.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  test('Fehlerfall bleibt sichtbar: lehnt der Server ab, erscheint die Meldung, der Knopf ist wieder bedienbar, nichts wird als gesendet gemerkt', async ({ page, qaBaseURL, store }) => {
    const w = watch(page);
    await page.route('**/rest/v1/investor_requests*', r => r.request().method() === 'POST'
      ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '23514', message: 'check constraint' }) })
      : r.fallback());
    await openSite(page, qaBaseURL);
    await fillAndSubmit(page, { name: 'X', mc: 'Y', amount: 80000000, period: 1, anonymous: false });
    await expect.poll(() => w.dialogs.length, { timeout: 10000 }).toBe(1);
    expect(w.dialogs[0]).toMatch(/konnte nicht gesendet werden/);
    await expect(page.locator('#investorRequestSubmit')).toBeEnabled();
    await expect(page.locator('#investorRequestSuccessView')).toBeHidden();
    expect(store.tables.investor_requests || []).toHaveLength(0);
    const pending = await page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), PENDING_KEY);
    expect(pending).toEqual([]);
  });

  test('Nachbildung der echten Zugriffsregel im Mock: ein Einfuegen MIT Zeilen-Rueckgabe wird mit 42501 abgelehnt, OHNE Rueckgabe angenommen', async ({ page, qaBaseURL, store }) => {
    await openSite(page, qaBaseURL);
    const body = { name: 'Direkt', amount: 50000000, share_percent: 5, period_months: 1, status: 'pending' };
    const res = await page.evaluate(async b => {
      const ctx = { url: location.origin + '/rest/v1/investor_requests', h: { 'Content-Type': 'application/json', apikey: 'x', Authorization: 'Bearer x' } };
      const withRows = await fetch(ctx.url + '?select=id', { method: 'POST', headers: { ...ctx.h, Prefer: 'return=representation' }, body: JSON.stringify(b) });
      const minimal = await fetch(ctx.url, { method: 'POST', headers: { ...ctx.h, Prefer: 'return=minimal' }, body: JSON.stringify(b) });
      return { withRows: withRows.status, withRowsCode: (await withRows.json()).code, minimal: minimal.status };
    }, body);
    // Der Browser spricht hier den lokalen Mock direkt an (kein Supabase-Host) -> dieselbe Router-Regel.
    expect(res.withRows).toBe(401);
    expect(res.withRowsCode).toBe('42501');
    expect(res.minimal).toBe(201);
    expect((store.tables.investor_requests || []).length).toBe(1);
  });
});
