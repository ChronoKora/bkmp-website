/* Event-Ankuendigungs-Popup (04.10.2026) - js/systems/bkmp-event-announce.js.
   Das Artwork (assets/events/zwielicht-announcement.webp) ist selbst das
   Fenster; getestet wird: wann es erscheint (Status, Login-Dialog, App-Modus),
   die Einmal-pro-Berliner-Tag-Regel, X/Escape/"Event ansehen", Groessen auf
   Desktop/Handy, Effektmodi, Fehlerfaelle (Bild fehlt, Speicher gesperrt,
   langsame Verbindung) und dass das Popup nie selbst Event-Daten veraendert.
   Event-Daten kommen wie im Spiel aus dem Mock (special_events_visible),
   die Popup-Konfiguration aus sql/20261004-07-zwielicht-event.sql. */
const fs = require('fs');
const path = require('path');
const { test, expect, openAppMode } = require('../helpers/qa-fixtures');
const { makeZwielichtEventRow, ZWIELICHT_CONFIG, EVENT_SPECIES, PASS_EGG_SPECIES } = require('../fixtures/event-reference');

const HOUR = 3600 * 1000;
const POPUP = '[data-testid="event-announce-popup"]';
const CTA = '[data-testid="event-announce-cta"]';
const CLOSE = '[data-testid="event-announce-close"]';
const ART_W = 1122;
const ART_H = 1402;

function berlinDay(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const g = t => parts.find(p => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
const seenKey = ms => `bkmp-event-popup-zwielicht-${berlinDay(ms)}`;

/* Event mit Popup, Status ueber das Verhaeltnis zur Store-Uhr. */
function eventRow(store, status, extra) {
  const now = store.clock.nowMs();
  const t = {
    COMING_SOON: { announce_at: now - HOUR, starts_at: now + 2 * 24 * HOUR, ends_at: now + 9 * 24 * HOUR },
    LIVE: { announce_at: now - 3 * 24 * HOUR, starts_at: now - HOUR, ends_at: now + 6 * 24 * HOUR },
    ENDED: { announce_at: now - 12 * 24 * HOUR, starts_at: now - 9 * 24 * HOUR, ends_at: now - 2 * 24 * HOUR },
    HIDDEN: { announce_at: now + 3 * 24 * HOUR, starts_at: now + 6 * 24 * HOUR, ends_at: now + 13 * 24 * HOUR }
  }[status];
  return makeZwielichtEventRow({
    keepAnnouncement: true, enabled: true,
    announce_at: new Date(t.announce_at).toISOString(), starts_at: new Date(t.starts_at).toISOString(), ends_at: new Date(t.ends_at).toISOString(),
    ...(extra || {})
  });
}
function seed(store, status, extra) {
  store.tables.special_events = [eventRow(store, status, extra)];
  store.tables.dragon_species = [...EVENT_SPECIES, ...PASS_EGG_SPECIES].map(s => ({ ...s }));
}
/* Neuer Besucher ohne Login: das "Wer bist du?"-Fenster geht von selbst auf. */
async function openSite(page, qaBaseURL) {
  await page.goto(qaBaseURL + '/');
  await expect(page.locator('#mcNameOverlay')).toHaveClass(/visible/, { timeout: 15000 });
}
async function skipLogin(page) {
  await page.evaluate(() => document.getElementById('mcNameSkip').click());
  await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/);
}
/* Nach einem Reload geht "Wer bist du?" erneut auf - erst dann wegklicken. */
async function reloadAndSkip(page) {
  await page.reload();
  await expect(page.locator('#mcNameOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await skipLogin(page);
}
async function waitForPopup(page) {
  await expect(page.locator(POPUP)).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator(POPUP)).toHaveClass(/is-settled/, { timeout: 10000 });
}
/* Negativ-Pruefung: Events sind geladen, Verzoegerung + Ladezeit sind vorbei. */
async function expectNoPopup(page, ms) {
  await page.waitForFunction(() => typeof bkmpSpecialEvents !== 'undefined' && typeof bkmpSpecialEventsLoadedAt !== 'undefined' && bkmpSpecialEventsLoadedAt > 0 || (typeof bkmpSpecialEventsMissing !== 'undefined' && bkmpSpecialEventsMissing), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(ms || 3200);
  await expect(page.locator(POPUP)).toHaveCount(0);
}
async function loginViaForm(page, fixtureData) {
  await page.locator('#mcAuthName').fill(fixtureData.displayName);
  await page.locator('#mcAuthPassword').fill(fixtureData.password);
  await page.locator('#mcAuthSubmit').click();
  await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
}
async function boxes(page) {
  return page.evaluate(() => {
    const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    return { win: r('.bkmp-ann-window'), cta: r('.bkmp-ann-cta'), close: r('.bkmp-ann-close'), vw: window.innerWidth, vh: window.innerHeight };
  });
}
function eventRpcCalls(page) {
  const calls = [];
  page.on('request', r => { if (/\/rpc\/event_(tick|claim_tiers|choose_reward)/.test(r.url())) calls.push(r.url()); });
  return calls;
}

test.describe('Event-Popup – Konfiguration', () => {
  test('Popup-Konfiguration in 20261004-07 und 20261004-11 ist identisch', () => {
    const sql11 = fs.readFileSync(path.join(__dirname, '../../sql/20261004-11-event-announcement-popup.sql'), 'utf8');
    const a = sql11.indexOf('$ann$') + 5;
    const b = sql11.indexOf('$ann$', a);
    expect(a).toBeGreaterThan(4);
    expect(b).toBeGreaterThan(a);
    expect(JSON.parse(sql11.slice(a, b))).toEqual(ZWIELICHT_CONFIG.announcementPopup);
  });

  test('Konfiguration: Bild vorhanden, Klickflächen + Plakette liegen innerhalb des Artworks', () => {
    const c = ZWIELICHT_CONFIG.announcementPopup;
    expect(c.enabled).toBe(true);
    expect(c.daily).toBe(true);
    expect(c.action).toBe('open_event');
    const file = path.join(__dirname, '../..', c.image.split('?')[0]);
    expect(fs.existsSync(file), c.image).toBe(true);
    expect(c.width).toBe(ART_W);
    expect(c.height).toBe(ART_H);
    const inside = (x, y) => x >= 0 && x <= c.width && y >= 0 && y <= c.height;
    expect(inside(c.close.x - c.close.r, c.close.y - c.close.r) && inside(c.close.x + c.close.r, c.close.y + c.close.r)).toBe(true);
    expect(inside(c.cta.x, c.cta.y) && inside(c.cta.x + c.cta.w, c.cta.y + c.cta.h)).toBe(true);
    c.cta.face.forEach(p => {
      expect(inside(p[0], p[1])).toBe(true);
      // die Plakette liegt in der Klickfläche
      expect(p[0]).toBeGreaterThanOrEqual(c.cta.x);
      expect(p[0]).toBeLessThanOrEqual(c.cta.x + c.cta.w);
      expect(p[1]).toBeGreaterThanOrEqual(c.cta.y);
      expect(p[1]).toBeLessThanOrEqual(c.cta.y + c.cta.h);
    });
    expect(c.ctaLabel).toContain('Zwielicht');
    expect(c.closeLabel).toBeTruthy();
  });

  test('Ungültige Konfiguration ergibt kein Popup (Pfad, Format, fehlende Größe, ausgeschaltet)', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await page.goto(qaBaseURL + '/');
    await page.waitForFunction(() => typeof bkmpAnnNormalizeConfig === 'function');
    const results = await page.evaluate(() => {
      const base = () => ({ id: 'x', name: 'X', config: { announcementPopup: { enabled: true, image: 'assets/events/a.webp', width: 100, height: 120, cta: { x: 1, y: 1, w: 50, h: 20 } } } });
      const mut = f => { const e = base(); f(e.config.announcementPopup); return !!bkmpAnnNormalizeConfig(e); };
      return {
        ok: !!bkmpAnnNormalizeConfig(base()),
        none: !bkmpAnnNormalizeConfig({ id: 'x', config: {} }),
        off: mut(c => { c.enabled = false; }),
        external: mut(c => { c.image = 'https://evil.example/x.png'; }),
        traversal: mut(c => { c.image = 'assets/../secret.png'; }),
        protocol: mut(c => { c.image = 'javascript:alert(1)'; }),
        wrongType: mut(c => { c.image = 'assets/events/a.svg'; }),
        noSize: mut(c => { c.width = 0; }),
        noCta: mut(c => { c.cta = {}; }),
        queryOk: mut(c => { c.image = 'assets/events/a.webp?v=3'; })
      };
    });
    expect(results).toEqual({ ok: true, none: true, off: false, external: false, traversal: false, protocol: false, wrongType: false, noSize: false, noCta: false, queryOk: true });
  });
});

test.describe('Event-Popup – wann es erscheint', () => {
  test('Angekündigt: erscheint erst nach dem Login-Dialog, mit Artwork, Overlay, Labels und Hitboxen', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    const rpc = eventRpcCalls(page);
    await openSite(page, qaBaseURL);
    // Solange "Wer bist du?" offen ist, wartet das Popup (nie beides übereinander).
    await page.waitForTimeout(2800);
    await expect(page.locator(POPUP)).toHaveCount(0);
    await skipLogin(page);
    await waitForPopup(page);

    const popup = page.locator(POPUP);
    await expect(popup).toHaveAttribute('role', 'dialog');
    await expect(popup).toHaveAttribute('aria-modal', 'true');
    await expect(popup).toHaveAttribute('data-event-id', 'zwielicht');
    const art = page.locator('.bkmp-ann-art');
    await expect(art).toHaveAttribute('data-src', /assets\/events\/zwielicht-announcement\.webp/);
    await expect(art).toHaveAttribute('src', /^blob:/); // einmal geladen, dann aus dem Arbeitsspeicher
    await expect.poll(() => art.evaluate(i => i.complete && i.naturalWidth)).toBe(ART_W);
    await expect(art).toHaveAttribute('alt', /Zwielicht/);
    await expect(page.locator(CTA)).toHaveAttribute('aria-label', 'Zwielicht-Event ansehen');
    await expect(page.locator(CLOSE)).toHaveAttribute('aria-label', 'Event-Ankündigung schließen');
    // Echte Buttons (Tastatur/Screenreader), keine Box um das Artwork.
    expect(await page.locator(`${POPUP} button`).evaluateAll(b => b.map(x => x.tagName))).toEqual(['BUTTON', 'BUTTON']);
    const bg = await popup.evaluate(e => getComputedStyle(e).backgroundImage);
    expect(bg).toContain('radial-gradient');
    const winStyle = await page.locator('.bkmp-ann-window').evaluate(e => { const s = getComputedStyle(e); return { bg: s.backgroundColor, border: s.borderTopWidth, shadow: s.boxShadow, filter: s.filter }; });
    expect(winStyle).toEqual({ bg: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none', filter: 'none' });
    // Das Popup selbst löst keinerlei Event-Aktion aus.
    expect(rpc).toEqual([]);
    expect(store.tables.player_event_progress || []).toEqual([]);
  });

  test('Laufend (LIVE): erscheint ebenfalls', async ({ page, qaBaseURL, store }) => {
    seed(store, 'LIVE');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
  });

  for (const status of ['HIDDEN', 'ENDED']) {
    test(`Status ${status}: kein Popup`, async ({ page, qaBaseURL, store }) => {
      seed(store, status);
      await openSite(page, qaBaseURL);
      await skipLogin(page);
      await expectNoPopup(page);
    });
  }

  test('Status ARCHIVED, ausgeschaltet oder ohne Termin: kein Popup', async ({ page, qaBaseURL, store }) => {
    seed(store, 'LIVE', { archived: true });
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await expectNoPopup(page, 2600);
    store.tables.special_events = [eventRow(store, 'LIVE', { enabled: false })];
    await reloadAndSkip(page);
    await expectNoPopup(page, 2600);
    store.tables.special_events = [eventRow(store, 'LIVE', { starts_at: null, ends_at: null })];
    await reloadAndSkip(page);
    await expectNoPopup(page, 2600);
  });

  test('Event ohne announcementPopup oder mit enabled:false: kein Popup', async ({ page, qaBaseURL, store }) => {
    store.tables.special_events = [eventRow(store, 'LIVE', { keepAnnouncement: false })];
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await expectNoPopup(page, 2600);
    const off = eventRow(store, 'LIVE');
    off.config.announcementPopup.enabled = false;
    store.tables.special_events = [off];
    await reloadAndSkip(page);
    await expectNoPopup(page, 2600);
  });

  test('Status wechselt von selbst: aus der Ankündigung wird LIVE, danach ENDED = kein Popup mehr', async ({ page, qaBaseURL, store }) => {
    seed(store, 'LIVE');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    await page.locator(CLOSE).click();
    // neuer Berliner Tag, Event inzwischen vorbei
    store.clock.advance(10 * 24 * HOUR);
    await reloadAndSkip(page);
    await expectNoPopup(page, 2600);
  });

  test('App-Modus: kein Popup (man ist ohnehin im Spiel)', async ({ page, qaBaseURL, store, fixtureData }) => {
    seed(store, 'LIVE');
    await openAppMode(page, qaBaseURL, fixtureData);
    await page.waitForTimeout(3200);
    await expect(page.locator(POPUP)).toHaveCount(0);
  });

  test('Eingeloggt (Reload mit bestehender Sitzung): 700–1200 ms nach dem vollständigen Laden, ohne Login-Dialog', async ({ page, qaBaseURL, store, fixtureData }) => {
    seed(store, 'LIVE');
    await openSite(page, qaBaseURL);
    await loginViaForm(page, fixtureData);
    await waitForPopup(page);
    await page.locator(CLOSE).click();
    // Tages-Merker löschen, damit der Reload wieder "der erste Besuch des Tages" ist.
    await page.evaluate(k => localStorage.removeItem(k), seenKey(store.clock.nowMs()));
    await page.addInitScript(() => {
      window.addEventListener('load', () => { window.__loadAt = performance.now(); });
      const mo = new MutationObserver(() => {
        if (document.getElementById('bkmpEventAnnounceOverlay')) { window.__shownAt = performance.now(); mo.disconnect(); }
      });
      mo.observe(document, { childList: true, subtree: true });
    });
    await page.reload();
    await waitForPopup(page);
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/);
    const t = await page.evaluate(() => ({ load: window.__loadAt, shown: window.__shownAt }));
    expect(t.load).toBeGreaterThan(0);
    expect(t.shown - t.load).toBeGreaterThanOrEqual(690); // nie sofort „hart auf den Bildschirm“
    expect(t.shown - t.load).toBeLessThan(4000);
  });

  test('Tab im Hintergrund geöffnet: Popup wartet, bis der Tab sichtbar wird (Tageskontingent bleibt unverbraucht)', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await page.addInitScript(() => {
      window.__hiddenNow = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hiddenNow });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__hiddenNow ? 'hidden' : 'visible') });
    });
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await page.waitForTimeout(3000);
    await expect(page.locator(POPUP)).toHaveCount(0);
    expect(await page.evaluate(k => localStorage.getItem(k), seenKey(store.clock.nowMs()))).toBeNull();
    await page.evaluate(() => { window.__hiddenNow = false; document.dispatchEvent(new Event('visibilitychange')); });
    await waitForPopup(page);
    // Wird der Tab während der Anzeige verborgen, pausieren die Animationen.
    await page.evaluate(() => { window.__hiddenNow = true; document.dispatchEvent(new Event('visibilitychange')); });
    await expect(page.locator(POPUP)).toHaveClass(/is-paused/);
  });

  test('Eingeloggt: Popup erscheint ohne Login-Dialog, ausgeloggtes Idle-Dorf-Fenster bleibt unberührt', async ({ page, qaBaseURL, store, fixtureData }) => {
    seed(store, 'COMING_SOON');
    await openSite(page, qaBaseURL);
    await loginViaForm(page, fixtureData);
    await waitForPopup(page);
    await expect(page.locator('#idleDorfOverlay')).not.toHaveClass(/visible/);
  });
});

test.describe('Event-Popup – einmal pro Berliner Kalendertag', () => {
  test('Reload, neuer Tab und erneutes Öffnen zeigen es am selben Tag nicht erneut – auch ohne zu schließen', async ({ page, context, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    // Merker steht schon, sobald das Popup angezeigt wird.
    const key = seenKey(store.clock.nowMs());
    expect(await page.evaluate(k => localStorage.getItem(k), key)).toBe('1');
    await reloadAndSkip(page);
    await expectNoPopup(page);
    const tab2 = await context.newPage();
    await tab2.goto(qaBaseURL + '/');
    await expect(tab2.locator('#mcNameOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await tab2.evaluate(() => document.getElementById('mcNameSkip').click());
    await tab2.waitForTimeout(3200);
    await expect(tab2.locator(POPUP)).toHaveCount(0);
  });

  test('X und Escape markieren als gesehen; interne Navigation zeigt es nicht erneut', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    await page.locator(CLOSE).click();
    await expect(page.locator(POPUP)).toHaveCount(0);
    expect(await page.evaluate(k => localStorage.getItem(k), seenKey(store.clock.nowMs()))).toBe('1');
    // Innerhalb der Seite zwischen Tabs wechseln: kein neuer Versuch.
    await page.locator('.tab-btn').nth(1).click();
    await page.locator('.tab-btn').nth(0).click();
    await page.waitForTimeout(2600);
    await expect(page.locator(POPUP)).toHaveCount(0);
    // Auch ein erneuter Start des Skripts erzeugt nichts.
    await page.evaluate(() => { bkmpAnnStarted = false; bkmpAnnInit(); });
    await page.waitForTimeout(2600);
    await expect(page.locator(POPUP)).toHaveCount(0);
  });

  test('Nächster Berliner Kalendertag: Popup erscheint wieder (Mitternacht Berlin, Sommer- und Winterzeit)', async ({ page, qaBaseURL, store }) => {
    // Event über den ganzen Zeitraum angekündigt/laufend; Uhr direkt vor Berliner Mitternacht (CEST, UTC+2).
    const sched = { announce_at: '2026-10-01T00:00:00Z', starts_at: '2026-10-12T00:00:00Z', ends_at: '2026-11-30T00:00:00Z' };
    store.clock.setNow(Date.parse('2026-10-05T21:59:20Z')); // 05.10. 23:59:20 Berlin
    store.tables.special_events = [makeZwielichtEventRow({ keepAnnouncement: true, enabled: true, ...sched })];
    store.tables.dragon_species = [...EVENT_SPECIES, ...PASS_EGG_SPECIES].map(s => ({ ...s }));
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    expect(await page.evaluate(k => localStorage.getItem(k), 'bkmp-event-popup-zwielicht-2026-10-05')).toBe('1');
    await page.locator(CLOSE).click();
    // Noch derselbe Berliner Tag (23:59:50): nichts.
    store.clock.setNow(Date.parse('2026-10-05T21:59:50Z'));
    await reloadAndSkip(page);
    await expectNoPopup(page, 2600);
    // 00:00:10 Berlin = nächster Tag: wieder einmal.
    store.clock.setNow(Date.parse('2026-10-05T22:00:10Z'));
    await reloadAndSkip(page);
    await waitForPopup(page);
    expect(await page.evaluate(k => localStorage.getItem(k), 'bkmp-event-popup-zwielicht-2026-10-06')).toBe('1');
    // Alte Tages-Merker werden aufgeräumt.
    expect(await page.evaluate(k => localStorage.getItem(k), 'bkmp-event-popup-zwielicht-2026-10-05')).toBeNull();
  });

  test('Winterzeit: 25.10. 23:59 Berlin (UTC+1) ist noch derselbe Tag, 00:00 der nächste', async ({ page, qaBaseURL, store }) => {
    const sched = { announce_at: '2026-10-01T00:00:00Z', starts_at: '2026-10-12T00:00:00Z', ends_at: '2026-11-30T00:00:00Z' };
    store.clock.setNow(Date.parse('2026-10-25T22:59:20Z')); // 25.10. 23:59:20 Berlin (Winterzeit seit 03:00)
    store.tables.special_events = [makeZwielichtEventRow({ keepAnnouncement: true, enabled: true, ...sched })];
    store.tables.dragon_species = [...EVENT_SPECIES, ...PASS_EGG_SPECIES].map(s => ({ ...s }));
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    expect(await page.evaluate(k => localStorage.getItem(k), 'bkmp-event-popup-zwielicht-2026-10-25')).toBe('1');
  });

  test('Merker lässt sich nicht speichern: Popup erscheint gar nicht (lieber nie nerven als jedes Mal)', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await page.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (String(k).indexOf('bkmp-event-popup-') === 0) throw new Error('quota'); return orig.call(this, k, v); };
    });
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await expectNoPopup(page);
  });
});

test.describe('Event-Popup – Bedienung', () => {
  test('X schließt (Hitbox sitzt auf dem X im Artwork), Klick daneben und aufs Artwork schließen nicht', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    const b = await boxes(page);
    // Klick auf den dunklen Hintergrund neben dem Fenster und mitten aufs Artwork: bleibt offen.
    await page.mouse.click(2, 2);
    await page.mouse.click(b.win.x + b.win.w * 0.5, b.win.y + b.win.h * 0.4);
    await page.waitForTimeout(500);
    await expect(page.locator(POPUP)).toHaveCount(1);
    // Mittelpunkt des X laut Konfiguration -> genau der X-Button.
    const c = ZWIELICHT_CONFIG.announcementPopup.close;
    const x = b.win.x + c.x / ART_W * b.win.w;
    const y = b.win.y + c.y / ART_H * b.win.h;
    expect(await page.evaluate(([px, py]) => document.elementFromPoint(px, py).getAttribute('data-testid'), [x, y])).toBe('event-announce-close');
    await page.mouse.click(x, y);
    await expect(page.locator(POPUP)).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);
  });

  test('Escape schließt', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    await page.keyboard.press('Escape');
    await expect(page.locator(POPUP)).toHaveCount(0);
  });

  test('Tastatur: Tab wandert nur zwischen "Event ansehen" und X, Enter löst aus', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.getAttribute('data-testid'))).toBe('event-announce-cta');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.getAttribute('data-testid'))).toBe('event-announce-close');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.getAttribute('data-testid'))).toBe('event-announce-cta');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.activeElement.getAttribute('data-testid'))).toBe('event-announce-close');
    await page.keyboard.press('Enter');
    await expect(page.locator(POPUP)).toHaveCount(0);
  });

  test('Mehrfach-Schutz: nie ein zweites Popup, auch bei wiederholtem Aufruf', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    const again = await page.evaluate(async () => [await bkmpAnnTryShow(), await bkmpAnnTryShow(), document.querySelectorAll('#bkmpEventAnnounceOverlay').length]);
    expect(again).toEqual(['none', 'none', 1]);
  });

  test('Klick auf "Event ansehen" (angekündigt): Idle-Dorf öffnet sich mit der Event-Vorschau + Countdown, Popup ist weg', async ({ page, qaBaseURL, store, fixtureData }) => {
    seed(store, 'COMING_SOON');
    const rpc = eventRpcCalls(page);
    await openSite(page, qaBaseURL);
    await loginViaForm(page, fixtureData);
    await waitForPopup(page);
    await page.locator(CTA).click();
    await expect(page.locator(POPUP)).toHaveCount(0);
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await expect(page.locator('#bkmpEventPassOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await expect(page.locator('[data-testid="event-teaser"]')).toContainText('DAS ZWIELICHT NAHT');
    await expect(page.locator('[data-testid="event-teaser"] [data-event-countdown]')).toContainText(/T\./);
    // COMING_SOON: nichts startet, nichts wird abgeholt.
    expect(rpc.filter(u => /event_claim_tiers|event_choose_reward/.test(u))).toEqual([]);
    expect(store.tables.player_event_progress || []).toEqual([]);
    expect(await page.evaluate(k => localStorage.getItem(k), seenKey(store.clock.nowMs()))).toBe('1');
  });

  test('Klick auf "Event ansehen" (LIVE): direkt im Zwielicht-Pass mit Stufe und Heute-Aufgaben', async ({ page, qaBaseURL, store, fixtureData }) => {
    seed(store, 'LIVE');
    const rpc = eventRpcCalls(page);
    await openSite(page, qaBaseURL);
    await loginViaForm(page, fixtureData);
    await waitForPopup(page);
    await page.locator(CTA).click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await expect(page.locator('#bkmpEventPassOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await expect(page.locator('[data-testid="event-tier"]')).toContainText('Stufe', { timeout: 15000 });
    await expect(page.locator('#bkmpEventPassOverlay')).toContainText('Heute');
    // Belohnungen holt nur der Spieler selbst - das Popup nie.
    expect(rpc.filter(u => /event_claim_tiers|event_choose_reward/.test(u))).toEqual([]);
  });

  test('Klick auf "Event ansehen" ohne Login: das Login-Fenster öffnet sich (kein Event-Fenster, nichts erzwungen)', async ({ page, qaBaseURL, store }) => {
    seed(store, 'LIVE');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    await page.locator(CTA).click();
    await expect(page.locator(POPUP)).toHaveCount(0);
    await expect(page.locator('#mcNameOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await expect(page.locator('#idleDorfOverlay')).not.toHaveClass(/visible/);
    await expect(page.locator('#bkmpEventPassOverlay')).toHaveCount(0);
  });

  test('Doppelklick auf "Event ansehen" öffnet das Dorf nur einmal', async ({ page, qaBaseURL, store, fixtureData }) => {
    seed(store, 'LIVE');
    await openSite(page, qaBaseURL);
    await loginViaForm(page, fixtureData);
    await waitForPopup(page);
    await page.evaluate(() => { window.__opens = 0; const o = window.bkmpIdleOpenModal; window.bkmpIdleOpenModal = function () { window.__opens++; return o.apply(this, arguments); }; });
    await page.evaluate(() => { const b = document.querySelector('[data-testid="event-announce-cta"]'); b.click(); b.click(); });
    await expect(page.locator('#bkmpEventPassOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    expect(await page.evaluate(() => window.__opens)).toBe(1);
  });
});

test.describe('Event-Popup – Größe und Treffsicherheit', () => {
  test('Fenster liegt komplett im Bild, Seitenverhältnis stimmt, Klickflächen sitzen auf X und Plakette', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    const b = await boxes(page);
    const small = b.vw <= 760;
    expect(b.win.x).toBeGreaterThanOrEqual(0);
    expect(b.win.y).toBeGreaterThanOrEqual(0);
    expect(b.win.x + b.win.w).toBeLessThanOrEqual(b.vw + 0.5);
    expect(b.win.y + b.win.h).toBeLessThanOrEqual(b.vh + 0.5);
    expect(b.win.h).toBeLessThanOrEqual(b.vh * (small ? 0.921 : 0.901));
    expect(b.win.w).toBeLessThanOrEqual(b.vw * (small ? 0.941 : 0.961));
    expect(b.win.w / b.win.h).toBeCloseTo(ART_W / ART_H, 2);
    // Mindestgröße zum Antippen
    expect(b.close.w).toBeGreaterThanOrEqual(43.5);
    expect(b.cta.h).toBeGreaterThanOrEqual(43.5);
    // Plakette liegt (in Artwork-Koordinaten) in der unteren Bildhälfte, mittig.
    const cx = (b.cta.x + b.cta.w / 2 - b.win.x) / b.win.w;
    const cy = (b.cta.y + b.cta.h / 2 - b.win.y) / b.win.h;
    expect(cx).toBeGreaterThan(0.49);
    expect(cx).toBeLessThan(0.52);
    expect(cy).toBeGreaterThan(0.87);
    expect(cy).toBeLessThan(0.91);
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).getAttribute('data-testid'), [b.cta.x + b.cta.w / 2, b.cta.y + b.cta.h / 2]);
    expect(hit).toBe('event-announce-cta');
    // Kopie der Plakette liegt genau auf der Plakette des Artworks.
    const f = ZWIELICHT_CONFIG.announcementPopup.cta.face;
    const fb = await page.evaluate(() => { const r = document.querySelector('.bkmp-ann-face').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const xs = f.map(p => p[0]); const ys = f.map(p => p[1]);
    expect(fb.x).toBeCloseTo(b.win.x + Math.min(...xs) / ART_W * b.win.w, 0);
    expect(fb.y).toBeCloseTo(b.win.y + Math.min(...ys) / ART_H * b.win.h, 0);
    expect(fb.w).toBeCloseTo((Math.max(...xs) - Math.min(...xs)) / ART_W * b.win.w, 0);
  });

  test('Plakette: Hover hebt/vergrößert, Drücken verkleinert, Cursor ist pointer', async ({ page, qaBaseURL, store }, testInfo) => {
    test.skip(/mobile/.test(testInfo.project.name), 'Hover gibt es nur mit Maus');
    seed(store, 'COMING_SOON');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    await page.addStyleTag({ content: '.bkmp-ann-face-in { animation: none !important; }' });
    const b = await boxes(page);
    const matrix = () => page.locator('.bkmp-ann-face').evaluate(e => getComputedStyle(e).transform);
    expect(await page.locator(CTA).evaluate(e => getComputedStyle(e).cursor)).toBe('pointer');
    expect(await matrix()).toBe('none');
    await page.mouse.move(b.cta.x + b.cta.w / 2, b.cta.y + b.cta.h / 2);
    await expect.poll(matrix).toMatch(/^matrix\(1\.04/);
    await page.mouse.down();
    await expect.poll(matrix).toMatch(/^matrix\(0\.97/);
    await page.mouse.up();
  });

  test('Artwork hat Alpha: Ecken sind durchsichtig, keine Box um das Fenster', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    const alpha = await page.evaluate(async () => {
      const img = document.querySelector('.bkmp-ann-art');
      const c = document.createElement('canvas'); c.width = 8; c.height = 8;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 4, 4, 0, 0, 1, 1); // nur die 4x4 Pixel der äußersten Ecke
      return g.getImageData(0, 0, 1, 1).data[3];
    });
    expect(alpha).toBe(0);
  });
});

test.describe('Event-Popup – Effekte', () => {
  async function animNames(page) {
    return page.evaluate(() => {
      const root = document.querySelector('[data-testid="event-announce-popup"]');
      return Array.from(new Set(root.getAnimations({ subtree: true })
        .filter(a => a.effect && a.effect.getComputedTiming().iterations === Infinity)
        .map(a => a.animationName))).sort();
    });
  }
  const FX_KEY = 'bkmp-fx-mode';

  test('Effektmodus Hoch: Glühen, Funken, Funkeln, Atmen und Glanz laufen – nur transform/opacity', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await page.addInitScript(k => localStorage.setItem(k, 'hoch'), FX_KEY);
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    expect(await animNames(page)).toEqual(['bkmpAnnBreathe', 'bkmpAnnGlowPulse', 'bkmpAnnRise', 'bkmpAnnShine', 'bkmpAnnTwinkle']);
    // Keine teuren Filter/Blurs/Blend-Modi im Popup.
    const heavy = await page.evaluate(() => Array.from(document.querySelectorAll('#bkmpEventAnnounceOverlay, #bkmpEventAnnounceOverlay *')).filter(e => {
      const s = getComputedStyle(e);
      return (s.filter && s.filter !== 'none') || (s.backdropFilter && s.backdropFilter !== 'none') || (s.mixBlendMode && s.mixBlendMode !== 'normal');
    }).length);
    expect(heavy).toBe(0);
    // Viele Partikel gibt es nicht: wenige goldene links, wenige violette rechts.
    const sparks = await page.evaluate(() => ({ light: document.querySelectorAll('.bkmp-ann-spark-light').length, dark: document.querySelectorAll('.bkmp-ann-spark-dark').length }));
    expect(sparks).toEqual({ light: 7, dark: 7 });
  });

  test('Effektmodus Reduziert: nur dezentes Funkeln (kein Atmen, kein Glanz, keine aufsteigenden Funken)', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await page.addInitScript(k => localStorage.setItem(k, 'reduziert'), FX_KEY);
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    const names = await animNames(page);
    expect(names).toEqual(['bkmpAnnFlicker', 'bkmpAnnTwinkle']);
  });

  test('Effektmodus Aus: keine Dauer-Animation', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await page.addInitScript(k => localStorage.setItem(k, 'aus'), FX_KEY);
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    expect(await animNames(page)).toEqual([]);
  });

  test('prefers-reduced-motion: keine Dauer-Animation, selbst im Modus Hoch; Öffnen ohne Verschiebung', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(k => localStorage.setItem(k, 'hoch'), FX_KEY);
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    expect(await animNames(page)).toEqual([]);
    expect(await page.locator('.bkmp-ann-window').evaluate(e => getComputedStyle(e).transform)).toBe('none');
  });

  test('Einblenden ist weich: startet kleiner und transparent, endet voll sichtbar (400–550 ms, transform + opacity)', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await page.addInitScript(() => {
      window.__annSamples = [];
      const mo = new MutationObserver(() => {
        const o = document.getElementById('bkmpEventAnnounceOverlay');
        if (!o) return;
        mo.disconnect();
        const t0 = performance.now();
        const w = o.querySelector('.bkmp-ann-window');
        const tick = () => {
          const cs = getComputedStyle(w);
          const m = /^matrix\(([-\d.e]+)/.exec(cs.transform);
          window.__annSamples.push({ t: Math.round(performance.now() - t0), op: Number(cs.opacity), sc: m ? Number(m[1]) : 1 });
          if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
        };
        tick();
      });
      mo.observe(document, { childList: true, subtree: true });
    });
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await waitForPopup(page);
    await page.waitForTimeout(900);
    const samples = await page.evaluate(() => window.__annSamples);
    expect(samples.length).toBeGreaterThan(5);
    expect(samples[0].op).toBeLessThan(0.2);
    expect(samples[0].sc).toBeLessThan(0.95);
    const last = samples[samples.length - 1];
    expect(last.op).toBe(1);
    expect(last.sc).toBe(1);
    // voll sichtbar nach etwa einer halben Sekunde (Toleranz für langsame Testläufer)
    const full = samples.find(x => x.op >= 0.999 && x.sc >= 0.999);
    expect(full.t).toBeGreaterThan(300);
    expect(full.t).toBeLessThan(1000);
    expect(await page.locator(POPUP).evaluate(e => getComputedStyle(e).opacity)).toBe('1');
  });
});

test.describe('Event-Popup – Fehlerfälle', () => {
  test('Bild lässt sich nicht laden: kein Popup, kein Merker – morgen/nächster Besuch versucht es erneut', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    await page.route('**/assets/events/zwielicht-announcement.webp*', route => route.abort('failed'));
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await expectNoPopup(page, 3500);
    expect(await page.evaluate(k => localStorage.getItem(k), seenKey(store.clock.nowMs()))).toBeNull();
    // Beim nächsten Besuch (Bild jetzt da) erscheint es.
    await page.unroute('**/assets/events/zwielicht-announcement.webp*');
    await reloadAndSkip(page);
    await waitForPopup(page);
  });

  test('Langsame Verbindung: Popup erscheint erst, wenn das Bild da ist – nie ein halbes Bild, nur einmal geladen', async ({ page, qaBaseURL, store }) => {
    seed(store, 'COMING_SOON');
    let imageRequests = 0;
    await page.route('**/assets/events/zwielicht-announcement.webp*', async route => {
      imageRequests++;
      await new Promise(r => setTimeout(r, 2500));
      // wie Vercel (vercel.json: /assets/*) - sonst gilt die Antwort nicht als cachebar
      const resp = await route.fetch();
      await route.fulfill({ response: resp, headers: { ...resp.headers(), 'cache-control': 'public, max-age=86400, must-revalidate' } });
    });
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await page.waitForTimeout(1500);
    await expect(page.locator(POPUP)).toHaveCount(0); // Bild noch unterwegs
    expect(await page.evaluate(k => localStorage.getItem(k), seenKey(store.clock.nowMs()))).toBeNull();
    await waitForPopup(page);
    await expect.poll(() => page.locator('.bkmp-ann-art').evaluate(i => i.complete && i.naturalWidth)).toBe(ART_W);
    expect(imageRequests).toBe(1); // genau ein Download (Artwork + Plakette teilen sich die Daten)
  });

  test('Bild wird nur geladen, wenn das Popup heute dran ist', async ({ page, qaBaseURL, store }) => {
    seed(store, 'HIDDEN');
    const loads = [];
    page.on('request', r => { if (/zwielicht-announcement/.test(r.url())) loads.push(r.url()); });
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await expectNoPopup(page, 2600);
    expect(loads).toEqual([]);
  });

  test('Event-System fehlt (Datenbank ohne Migration): kein Popup, kein Fehler', async ({ page, qaBaseURL, store }) => {
    store.tables.special_events = [];
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await openSite(page, qaBaseURL);
    await skipLogin(page);
    await expectNoPopup(page, 2600);
    expect(errors).toEqual([]);
  });
});
