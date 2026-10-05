const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Nutzerwunsch (05.10.2026): "dieses Ladebildschirm-Prinzip erst auf den Klick
   ins Drachen-Idle-Game hinzufuegen" - statt eines Ladebildschirms fuer die
   ganze Startseite gibt es einen NUR beim Oeffnen des Spiels.

   Der Ladebildschirm (#idleDorfLoader in der Spielkarte) haengt komplett an der
   bereits bestehenden Klasse "idle-dorf-loading" (idledorf.js,
   bkmpIdleOpenModal: beim Klick gesetzt, am Ende des Ladens - auch bei einem
   Ladefehler - entfernt). Die Tests halten das Laden kuenstlich an, indem sie
   bkmpIdleLoadOrInitState() durch eine Version ersetzen, die erst auf ein
   Signal wartet - dadurch bleibt der Ladezustand beliebig lange sichtbar. */

test.use({ teststand: 'A' });

/* Spiel schliessen, Ladevorgang anhalten, per echtem Klick wieder oeffnen. */
async function reopenWithHeldLoad(page) {
  await page.evaluate(() => bkmpIdleStopLoop());
  await page.evaluate(() => bkmpIdleCloseModal());
  await expect(page.locator('#idleDorfOverlay')).not.toHaveClass(/visible/);
  await page.evaluate(() => {
    const original = window.bkmpIdleLoadOrInitState;
    window.__qaReleaseLoad = null;
    window.bkmpIdleLoadOrInitState = async function (name) {
      await new Promise(resolve => { window.__qaReleaseLoad = resolve; });
      return original.call(this, name);
    };
  });
  await page.locator('#idleDorfButton').click();
  await expect(page.locator('#idleDorfOverlay .idle-dorf-card')).toHaveClass(/idle-dorf-loading/);
  await page.waitForFunction(() => typeof window.__qaReleaseLoad === 'function');
}
const release = page => page.evaluate(() => window.__qaReleaseLoad());
const loaderOpacity = page => page.evaluate(() => getComputedStyle(document.getElementById('idleDorfLoader')).opacity);

test.describe('Ladebildschirm beim Öffnen des Drachen-Idle-Games', () => {
  test('erscheint beim langsamen Öffnen mittig, blockiert keinen Klick und verschwindet nach dem Laden wieder', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // Im normal geöffneten Spiel ist der Ladebildschirm komplett weg.
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('idleDorfLoader')).display)).toBe('none');

    await reopenWithHeldLoad(page);
    await expect.poll(() => loaderOpacity(page), { timeout: 4000 }).toBe('1');

    const m = await page.evaluate(() => {
      const loader = document.getElementById('idleDorfLoader');
      const card = document.querySelector('#idleDorfOverlay .idle-dorf-card');
      const cs = getComputedStyle(loader);
      const r = loader.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const visibleNavRects = ['#idleDorfTabs', '#bkmpProtoCompactNav'].map(sel => document.querySelector(sel)).filter(el => el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none').map(el => el.getBoundingClientRect());
      const overlapsNav = visibleNavRects.some(n => r.left < n.right && r.right > n.left && r.top < n.bottom && r.bottom > n.top);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const firstPanel = document.querySelector('#idleDorfOverlay .idle-dorf-panel');
      return {
        display: cs.display, position: cs.position, pointerEvents: cs.pointerEvents,
        role: loader.getAttribute('role'), title: loader.querySelector('.idle-dorf-loader-title').textContent,
        insideCard: r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom,
        centerOffsetX: Math.abs((r.left + r.width / 2) - (c.left + c.width / 2)), centerOffsetY: Math.abs((r.top + r.height / 2) - (c.top + c.height / 2)),
        w: Math.round(r.width), h: Math.round(r.height), overlapsNav,
        clickThrough: !!hit && !loader.contains(hit),
        panelsHidden: firstPanel ? getComputedStyle(firstPanel).visibility === 'hidden' : null
      };
    });
    expect(m.display).toBe('flex');
    expect(m.position).toBe('absolute'); // nicht von "> *" auf relative gedrückt
    expect(m.pointerEvents).toBe('none');
    expect(m.role).toBe('status');
    expect(m.title).toContain('Dein Dorf wird geladen');
    expect(m.insideCard).toBe(true);
    expect(m.centerOffsetX).toBeLessThan(4);
    expect(m.centerOffsetY).toBeLessThan(4);
    expect(m.w).toBeGreaterThan(150);
    expect(m.h).toBeGreaterThan(80);
    expect(m.overlapsNav).toBe(false);
    expect(m.clickThrough).toBe(true);
    expect(m.panelsHidden).toBe(true);

    await release(page);
    await waitForDragonReady(page);
    await expect(page.locator('#idleDorfOverlay .idle-dorf-card')).not.toHaveClass(/idle-dorf-loading/);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('idleDorfLoader')).display)).toBe('none');
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/);
  });

  test('schnelles Wiederöffnen (unter 250 ms) zeigt nichts – kein Aufblitzen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await reopenWithHeldLoad(page);
    const opacityAt100ms = await page.evaluate(async () => {
      await new Promise(r => setTimeout(r, 100));
      const o = getComputedStyle(document.getElementById('idleDorfLoader')).opacity;
      window.__qaReleaseLoad();
      return o;
    });
    expect(opacityAt100ms).toBe('0');
    await waitForDragonReady(page);
    await expect(page.locator('#idleDorfOverlay .idle-dorf-card')).not.toHaveClass(/idle-dorf-loading/);
  });

  test('Ladefehler: Fenster schließt, Ladebildschirm und Lade-Klasse sind garantiert weg (kein Hängenbleiben)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    await page.evaluate(() => bkmpIdleCloseModal());
    await page.evaluate(() => {
      bkmpIdleState = null;
      window.bkmpIdleLoadOrInitState = async () => null; // simulierter Ladefehler
    });
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).not.toHaveClass(/visible/, { timeout: 10000 });
    await expect(page.locator('#idleDorfOverlay .idle-dorf-card')).not.toHaveClass(/idle-dorf-loading/);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('idleDorfLoader')).display)).toBe('none');
  });

  test('Hinweis bei langsamer Verbindung erst nach 12 s; reduzierte Bewegung und Effekte „Aus“ stoppen die Animationen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await reopenWithHeldLoad(page);
    const normal = await page.evaluate(() => {
      const q = sel => getComputedStyle(document.querySelector(sel));
      return { slowDelay: q('.idle-dorf-loader-slow').animationDelay, slowOpacity: q('.idle-dorf-loader-slow').opacity, bar: q('.idle-dorf-loader-bar span').animationName, icon: q('.idle-dorf-loader-icon').animationName };
    });
    expect(normal.slowDelay).toBe('12s');
    expect(normal.slowOpacity).toBe('0'); // direkt nach dem Öffnen noch unsichtbar
    expect(normal.bar).toBe('idleDorfLoaderBar');
    expect(normal.icon).toBe('idleDorfLoaderBob');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await page.evaluate(() => {
      const q = sel => getComputedStyle(document.querySelector(sel));
      return { bar: q('.idle-dorf-loader-bar span').animationName, icon: q('.idle-dorf-loader-icon').animationName, ring: getComputedStyle(document.querySelector('.idle-dorf-loader-badge'), '::after').display };
    });
    expect(reduced).toEqual({ bar: 'none', icon: 'none', ring: 'none' });

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => document.documentElement.setAttribute('data-fx', 'aus'));
    const fxOff = await page.evaluate(() => ({ bar: getComputedStyle(document.querySelector('.idle-dorf-loader-bar span')).animationName, icon: getComputedStyle(document.querySelector('.idle-dorf-loader-icon')).animationName }));
    expect(fxOff).toEqual({ bar: 'none', icon: 'none' });

    await release(page);
    await waitForDragonReady(page);
  });
});
