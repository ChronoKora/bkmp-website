// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/* Dev-only Playwright config for the BKMP idle-dorf E2E suite (Phase 7.2).
   No webServer entry here on purpose: each test starts its OWN isolated
   static+mock-API server bound to its own in-memory store (see
   tests/helpers/qa-fixtures.js) so tests never share backend state or
   depend on execution order. */
module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html', { outputFolder: 'tests/report/html', open: 'never' }],
    ['list']
  ],
  outputDir: 'tests/report/artifacts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /* CRITICAL isolation guard: sw.js is a network-passthrough service
       worker (registered only in app-mode) whose fetch handler re-issues
       every request via the Service Worker's OWN fetch() call, in a
       separate execution context that page.route() does NOT intercept.
       Once active (after the first load - this is why it only showed up
       on reload, not on first navigation) it silently sent real requests
       straight to the production Supabase project (caught only because
       the mock's forged JWT correctly failed real signature verification,
       401 - no data was ever read or written, but the request still left
       the mock entirely). Blocking service workers for the whole test
       run closes this gap for every project/spec, not just the ones that
       happened to reload. Found via a reload smoke test, not anticipated
       up front - see CLAUDE.md Phase 7.2 report. */
    serviceWorkers: 'block'
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], viewport: { width: 1366, height: 768 } } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1366, height: 768 } } },
    { name: 'mobile-small', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 } } },
    { name: 'mobile-large', use: { ...devices['iPhone 14 Pro Max'] } }
  ]
});
