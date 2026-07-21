/* The one shared Playwright fixture file every Stage-1 spec imports from.
   Boots a fresh, isolated mock backend (store + local static/API server +
   Supabase-domain network interception) per test, seeded from one of the
   Teststand A-E fixtures - see tests/fixtures/teststands.js. Nothing here
   ever talks to the real Supabase project; supabase.js/index.html are never
   modified, only the network calls they make are intercepted from the test
   side (see CLAUDE.md Phase 7.2 report for why this shape was chosen over a
   dedicated QA Supabase project). */

const base = require('@playwright/test');
const { createStore, seedStore } = require('../mock/store');
const { route: mockRoute } = require('../mock/router');
const { createTestServer } = require('../mock/server');
const { TESTSTANDS } = require('../fixtures/teststands');

const SUPABASE_HOST_PATTERN = 'https://zgknyrwzpohvfdweomxf.supabase.co/**';
/* Must track the REAL wall clock, not a fixed historical date: every mocked
   session's expires_at is computed from this virtual clock, but the browser's
   own (unmocked, unless useFakeClock installs Playwright's clock) Date.now()
   is what supabase-js actually compares against when deciding whether a
   persisted session needs a refresh. A fixed past/future date made every
   token look expired from the browser's perspective - supabase-js still
   completed a same-session refresh during an active login, but discarded the
   session outright on a fresh page load/reload, silently logging the test
   player back out. Found via an 18/18-failing first smoke run, not guessed. */
const DEFAULT_START_TIME_MS = Date.now();

const test = base.test.extend({
  teststand: ['A', { option: true }],
  startTimeMs: [DEFAULT_START_TIME_MS, { option: true }],
  useFakeClock: [false, { option: true }],

  fixtureData: async ({ teststand, startTimeMs }, use) => {
    const factory = TESTSTANDS[teststand];
    if (!factory) throw new Error(`Unknown teststand "${teststand}" - expected one of ${Object.keys(TESTSTANDS).join(', ')}`);
    await use(factory(startTimeMs));
  },

  store: async ({ fixtureData }, use) => {
    const store = createStore(fixtureData.startTimeMs);
    seedStore(store, fixtureData);
    await use(store);
  },

  qaBaseURL: async ({ store }, use) => {
    const server = createTestServer(store);
    const baseURL = await server.listen();
    await use(baseURL);
    await server.close();
  },

  page: async ({ page, store }, use) => {
    await page.route(SUPABASE_HOST_PATTERN, async (route) => {
      const request = route.request();
      const method = request.method();
      if (method === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': '*'
          }
        });
      }
      let body;
      const postData = request.postData();
      if (postData) {
        try { body = JSON.parse(postData); } catch (e) { body = postData; }
      }
      const result = mockRoute(store, { method, url: request.url(), headers: request.headers(), body });
      await route.fulfill({
        status: result.status,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(result.json)
      });
    });
    await use(page);
  },

  qaClock: async ({ page, useFakeClock, fixtureData }, use) => {
    if (useFakeClock) await page.clock.install({ time: fixtureData.startTimeMs });
    await use({
      async advance(store, ms) {
        store.clock.advance(ms);
        if (useFakeClock) await page.clock.fastForward(ms);
      }
    });
  }
});

const expect = base.expect;

/* IMPORTANT: .joke-overlay (mcNameOverlay/idleDorfOverlay/...) shows/hides
   via a "visible" CSS class that only flips opacity+pointer-events (see
   style.css:416-423) - display:flex stays on unconditionally, so the
   element always has a non-empty bounding box. Playwright's built-in
   visible/hidden actionability state does NOT look at opacity, so
   locator.waitFor({state:'visible'|'hidden'}) is a no-op false-positive
   here regardless of the real open/closed state. Assert on the "visible"
   class directly instead - found by an 18/18-failing first smoke run, not
   a mock-backend bug. */
async function loginThroughForm(page, fixtureData) {
  const overlay = page.locator('#mcNameOverlay');
  await base.expect(overlay).toHaveClass(/visible/, { timeout: 15000 });
  await page.locator('#mcAuthName').fill(fixtureData.displayName);
  await page.locator('#mcAuthPassword').fill(fixtureData.password);
  await page.locator('#mcAuthSubmit').click();
  await base.expect(overlay).not.toHaveClass(/visible/, { timeout: 15000 });
}

/* DEFAULT entry point for Stage-1 functional tests: the plain marketing
   site (no ?app=idledorf), logging in through the real "Wer bist du?" form
   and then clicking the real #idleDorfButton CTA - no shortcut/bypass.

   Deliberately NOT app-mode: found via the first smoke run that
   ?app=idledorf forces the COMPACT mobile-style nav (System A/System B's
   "Mehr" overflow sheet) UNCONDITIONALLY, regardless of viewport width (see
   js/core/bkmp-app-mode-bootstrap.js's BKMP_APP_MODE-gated setup, and
   CLAUDE.md's Phase 7.0 "Nachtrag 21.07.2026" - the compact nav is only
   *disabled* on wide viewports when BKMP_APP_MODE is false). At a normal
   desktop viewport on the plain site, all 15 tabs render flat and directly
   clickable (Phase 7.1 Stage 3's ".idle-dorf-tab-group display:contents on
   desktop too" - System C). Use openAppMode() instead for mobile/app-mode-
   specific tests where the compact nav + "Mehr" sheet IS the thing under
   test. */
async function openAndLogin(page, qaBaseURL, fixtureData) {
  await page.goto(qaBaseURL + '/');
  await loginThroughForm(page, fixtureData);
  const idleDorfOverlay = page.locator('#idleDorfOverlay');
  await page.locator('#idleDorfButton').click();
  await base.expect(idleDorfOverlay).toHaveClass(/visible/, { timeout: 15000 });
}

/* App-mode entry point (auto-opens the idle-dorf overlay, see index.html's
   early BKMP_APP_MODE detection) - use for mobile/compact-nav-specific
   tests, not general desktop navigation (see openAndLogin's comment).

   Real app behavior, not a mock artifact: bkmpIdleOpenModal() (idledorf.js:
   2268) only opens #idleDorfOverlay when a name already resolves; if empty
   it just clicks #mcNameBadge to show the login form and RETURNS - it is
   never re-invoked after a successful login (confirmed by reading
   js/core/bkmp-app-mode-bootstrap.js:257-270's one-shot boot() and
   mcAuthSubmitHandler in js/core/bkmp-site.js, which never calls
   bkmpIdleOpenModal() itself). So on a genuinely first-time, no-session
   app-mode visit, logging in does NOT automatically open the idle-dorf - a
   second trigger (here: reload, which re-runs boot() with the now-resolved
   session) is needed. This is a real, if minor, UX rough edge worth flagging
   in the Stage-1 report, not something to silently paper over. */
async function openAppMode(page, qaBaseURL, fixtureData) {
  await page.goto(qaBaseURL + '/?app=idledorf');
  await loginThroughForm(page, fixtureData);
  const idleDorfOverlay = page.locator('#idleDorfOverlay');
  if (!/visible/.test(await idleDorfOverlay.getAttribute('class'))) {
    await page.reload();
  }
  await base.expect(idleDorfOverlay).toHaveClass(/visible/, { timeout: 15000 });
}

module.exports = { test, expect, openAndLogin, openAppMode, SUPABASE_HOST_PATTERN };
