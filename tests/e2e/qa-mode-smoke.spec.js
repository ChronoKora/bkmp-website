/* QA-Grundlage Phase 1 (24.07.2026, siehe CLAUDE.md) - Smoke-Test fuer den
   NEUEN, per Browser manuell nutzbaren lokalen QA-Modus (?qa=1, siehe
   index.html/supabase.js/js/dev/bkmp-qa-panel.js/scripts/qa-server.js).

   Bewusst NICHT ueber tests/helpers/qa-fixtures.js's context.route()-
   Interception (die bestehende Suite testet damit bereits sehr gruendlich
   die App selbst gegen den echten Supabase-Domainnamen) - dieser Test
   startet stattdessen exakt denselben Mock-Server, den ein Mensch per
   `npm run qa:server`/scripts/qa-server.js lokal oeffnen wuerde, auf einem
   echten 127.0.0.1-Port, und laedt die Seite mit ?qa=1 genau wie ein
   Mensch es taete. Das prueft den NEUEN Mechanismus selbst (window.
   BKMP_QA_MODE-Gate in index.html, supabase.js's URL-Umschaltung, das
   QA-Panel mit Auto-Login) end-to-end - nicht nur die schon anderswo
   getestete App-Navigation.

   Deckt Schritt 5 des Auftrags ab: Seite oeffnen, QA-Modus aktivieren,
   Testspielstand laden, Seite laedt ohne kritischen Fehler, Hauptnavigation
   sichtbar, alle Haupttabs nacheinander oeffnen, nach jedem Wechsel
   Navigation weiter sichtbar/anklickbar/nicht ueberlagert, keine kritischen
   Konsolenfehler, dieselbe Grundpruefung auf einer mobilen Bildschirmgroesse
   (siehe package.json qa:smoke: laeuft auf chromium-desktop UND
   mobile-small). */

/* test/expect kommen seit der Sicherheitsverstaerkung (24.07.2026, siehe
   CLAUDE.md) aus network-guard.js: globale Netzwerksperre + fertiger,
   TESTSTANDS-basierter qaServer-Fixture (Port 0 = vom OS vergeben, damit
   parallele Testworker sich nie einen festen Port teilen) mit garantiertem
   ?qa=1 - der vorher hier lokal duplizierte createStore/seedStore/
   createTestServer-Bauplan entfaellt dadurch. */
const { test: base, expect } = require('../helpers/network-guard');
const { IDLE_TABS } = require('../helpers/selectors');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');

const test = base;

const expectPw = expect;

async function domClick(page, id) {
  const clicked = await page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) return false;
    el.click();
    return true;
  }, id);
  expectPw(clicked, `#${id} nicht im DOM gefunden`).toBe(true);
}

/* Gleiche Kern-Invariante wie tests/e2e/nav-persistence.spec.js (Phase 7.3):
   mindestens EINES der beiden Navigationssysteme muss echte Ausdehnung im
   Viewport haben. Absichtlich hier dupliziert statt importiert - dieser Test
   soll unabhaengig von der anderen Suite lauffaehig bleiben. */
async function assertSomeNavVisible(page, context) {
  const state = await page.evaluate(() => {
    function realVisible(sel) {
      const el = document.querySelector(sel);
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        present: true,
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      };
    }
    return {
      desktopTabs: realVisible('[data-testid="idle-tabs-bar"]'),
      compactNav: realVisible('[data-testid="idle-compact-nav"]')
    };
  });
  const anyVisible = (state.desktopTabs.present && state.desktopTabs.visible)
    || (state.compactNav.present && state.compactNav.visible);
  expectPw(anyVisible, `${context}: keine Navigation sichtbar - ${JSON.stringify(state)}`).toBe(true);
  return state.compactNav.present && state.compactNav.visible ? 'compact' : 'desktop';
}

/* Volle Pruefkette pro Auftrag Schritt 5 fuer EIN Nav-Element: existiert,
   ist sichtbar, ist anklickbar (Playwrights eigener .click() scheitert bei
   nicht-anklickbaren/instabilen Elementen von selbst), liegt im sichtbaren
   Bereich, wird nicht von einem anderen Element ueberlagert
   (elementFromPoint-Hit-Test auf den Mittelpunkt). */
async function assertButtonFullyUsable(page, selector, context) {
  const locator = page.locator(selector).first();
  await expectPw(locator, `${context}: ${selector} nicht sichtbar`).toBeVisible({ timeout: 5000 });
  const hit = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: 'not_found' };
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const inViewport = cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight;
    const topEl = document.elementFromPoint(cx, cy);
    const notOccluded = !!topEl && (topEl === el || el.contains(topEl) || topEl.contains(el));
    return { ok: inViewport && notOccluded, inViewport, notOccluded, rect: { w: rect.width, h: rect.height } };
  }, selector);
  expectPw(hit.ok, `${context}: ${selector} ausserhalb des Viewports oder ueberlagert - ${JSON.stringify(hit)}`).toBe(true);
  // Echter Klick - Playwrights Actionability-Check wirft von selbst, falls das
  // Element trotz obiger Pruefungen doch nicht wirklich anklickbar waere.
  await locator.click({ trial: true, timeout: 5000 });
}

test.describe('QA-Modus Smoke-Test @qa-smoke', () => {
  test.use({ teststand: 'B' });

  test('QA-Modus laedt, Testspielstand wird geladen, Navigation bleibt durchgehend nutzbar', async ({ page, qaServer }, testInfo) => {
    test.setTimeout(60000);

    const consoleErrors = [];
    const failedRequests = [];
    page.on('pageerror', err => consoleErrors.push(String(err)));
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('requestfailed', req => {
      failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure() && req.failure().errorText}`);
    });

    // 1+2+3: Seite oeffnen, QA-Modus aktivieren (?qa=1), Testspielstand laden (&stand=B)
    await page.goto(qaServer.url(`/?stand=${qaServer.teststand}`));

    const qaModeActive = await page.evaluate(() => window.BKMP_QA_MODE === true);
    expectPw(qaModeActive, 'window.BKMP_QA_MODE muss auf dem lokalen 127.0.0.1-QA-Server aktiv sein').toBe(true);

    // QA-Panel selbst muss erscheinen (js/dev/bkmp-qa-panel.js aktiviert sich korrekt)
    await expectPw(page.locator('[data-testid="qa-panel"]')).toBeVisible({ timeout: 10000 });

    // Panel loggt automatisch den in ?stand= angegebenen Teststand ein und
    // oeffnet das Idle-Dorf-Fenster (siehe qaTryAutoLogin() in der Panel-Datei).
    await expectPw(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForIdleStateReady(page);
    await waitForDragonReady(page);

    // 4: Seite laedt ohne kritischen Fehler
    expectPw(consoleErrors, `Konsolenfehler beim Laden/Anmelden:\n${consoleErrors.join('\n')}`).toEqual([]);

    // 5: Hauptnavigation sichtbar
    let navMode = await assertSomeNavVisible(page, 'Nach dem Laden');

    // Kern-Buttons (in beiden Nav-Modi real vorhanden) muessen die volle
    // Schritt-5-Pruefkette bestehen: existiert/sichtbar/anklickbar/im
    // Viewport/nicht ueberlagert.
    const coreSelector = navMode === 'compact'
      ? '[data-testid="idle-compact-nav-primary"] [data-proto-tab="kampf"]'
      : '[data-testid="idle-tab-kampf"]';
    await assertButtonFullyUsable(page, coreSelector, 'Erstes Laden');

    // 6+7+8: nacheinander ALLE Haupttabs oeffnen, nach jedem Wechsel
    // Navigation pruefen. Echte DOM-.click()-Aufrufe (nicht Playwrights
    // Maussteuerung) fuer den Tab-Wechsel selbst - identisches, bereits in
    // nav-persistence.spec.js bewaehrtes Muster: auf schmalen Viewports
    // stecken die echten #idleTabBtnXxx-Knoten absichtlich in einem
    // versteckten #idleDorfTabs (die kompakte Nav bedient sie per
    // Proxy-Klick genau so), eine Null-Groesse-Bounding-Box wuerde einen
    // synthetischen Playwright-Klick sonst faelschlich als "Button fehlt"
    // erscheinen lassen statt den echten Tab-Wechsel zu pruefen.
    for (const tab of IDLE_TABS) {
      await domClick(page, tab.btn);
      await expectPw.poll(async () => {
        return page.evaluate((panelId) => {
          const el = document.getElementById(panelId);
          return !!el && getComputedStyle(el).display !== 'none';
        }, tab.panel);
      }, { message: `Panel #${tab.panel} nach Klick auf #${tab.btn} nicht sichtbar`, timeout: 5000 }).toBe(true);

      navMode = await assertSomeNavVisible(page, `Tab "${tab.id}"`);
    }

    // Nach der vollen Durchquerung: Kern-Button erneut voll pruefen (deckt
    // exakt die Bug-Klasse "Buttons nach mehreren Wechseln verschwunden" ab).
    const finalCoreSelector = navMode === 'compact'
      ? '[data-testid="idle-compact-nav-primary"] [data-proto-tab="kampf"]'
      : '[data-testid="idle-tab-kampf"]';
    await assertButtonFullyUsable(page, finalCoreSelector, 'Nach allen Tab-Wechseln');

    // 9: keine kritischen Konsolenfehler / fehlgeschlagenen Netzwerkaufrufe
    expectPw(consoleErrors, `Konsolenfehler waehrend der Tab-Durchquerung:\n${consoleErrors.join('\n')}`).toEqual([]);
    expectPw(failedRequests, `Fehlgeschlagene Netzwerkaufrufe:\n${failedRequests.join('\n')}`).toEqual([]);

    // Fehlerbericht-Grundlage (Schritt 6): Bildschirmgroesse im Report
    // sichtbar machen, damit ein Fehlschlag sofort zeigt, welche Groesse
    // betroffen war (Screenshot/Trace kommen automatisch von
    // playwright.config.js's retain-on-failure-Einstellungen).
    testInfo.annotations.push({ type: 'viewport', description: JSON.stringify(page.viewportSize()) });
    testInfo.annotations.push({ type: 'teststand', description: qaServer.teststand });
  });
});
