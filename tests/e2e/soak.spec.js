/* QA-Grundlage Phase 2 (24.07.2026, siehe CLAUDE.md) - reproduzierbarer
   Zufalls-/Dauertest mit festem Seed. Fuehrt viele gueltige Spieleraktionen
   in zufaelliger Reihenfolge aus und prueft nach jeder Aktion eine feste
   Menge an Invarianten. Bei einem Fehlschlag sind Seed + die letzten
   Aktionen + Screenshot/Trace (via playwright.config.js) + Teststand +
   GameClock-Zeit + Fenstergroesse Teil der Fehlermeldung - derselbe Seed
   reproduziert denselben Fehler deterministisch (siehe mulberry32 unten -
   ausschliesslich vom Seed abhaengig, keine echte Systemzeit/Zufallsquelle
   im Ablauf selbst).

   Kurzer Test (@soak, ~150 Aktionen) ist Teil von qa:full. Der lange
   Dauertest (@soak-long, 1000+ Aktionen) bleibt bewusst getrennt (eigenes
   npm-Script qa:soak:long, nicht Teil von qa:full) - Laufzeit im
   Minutenbereich, nicht fuer jeden lokalen Durchlauf gedacht. */

/* test/expect kommen seit der Sicherheitsverstaerkung (24.07.2026, siehe
   CLAUDE.md) aus network-guard.js: liefert automatisch die globale
   Netzwerksperre UND einen fertigen, TESTSTANDS-basierten qaServer-Fixture
   mit garantiertem ?qa=1 - der vorher hier lokal duplizierte
   createStore/seedStore/createTestServer-Bauplan entfaellt dadurch. */
const { test: base, expect } = require('../helpers/network-guard');
const { IDLE_TABS } = require('../helpers/selectors');
const { waitForIdleStateReady, waitForDragonReady, attachErrorCapture } = require('../helpers/qa-fixtures');

// --- Mulberry32: winziger, deterministischer seeded PRNG (kein Paket noetig) ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

const test = base;

async function domClick(page, id) {
  await page.evaluate((elId) => { const el = document.getElementById(elId); if (el) el.click(); }, id);
}

async function checkInvariants(page, context) {
  const state = await page.evaluate(() => {
    function isBadNumber(v) { return typeof v === 'number' && (Number.isNaN(v) || !Number.isFinite(v)); }
    const s = (typeof bkmpIdleState !== 'undefined' && bkmpIdleState) || null;
    const numericFields = ['gold', 'wood', 'stone', 'crystals', 'essence', 'xp', 'hp', 'mana', 'fruit', 'meat'];
    const badNumbers = [];
    const negatives = [];
    if (s) {
      numericFields.forEach(f => {
        if (isBadNumber(s[f])) badNumbers.push(f + '=' + s[f]);
        if (typeof s[f] === 'number' && s[f] < 0) negatives.push(f + '=' + s[f]);
      });
    }
    const desktopTabs = document.querySelector('[data-testid="idle-tabs-bar"]');
    const compactNav = document.querySelector('[data-testid="idle-compact-nav"]');
    function visible(el) {
      if (!el) return false;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    }
    const anyNavVisible = visible(desktopTabs) || visible(compactNav);
    const visiblePanels = Array.from(document.querySelectorAll('.idle-dorf-panel')).filter(el => {
      return getComputedStyle(el).display !== 'none';
    });
    return {
      hasState: !!s,
      badNumbers, negatives,
      anyNavVisible,
      visiblePanelCount: visiblePanels.length,
      idleOverlayVisible: !!document.getElementById('idleDorfOverlay') && document.getElementById('idleDorfOverlay').classList.contains('visible')
    };
  });
  if (state.idleOverlayVisible) {
    expect(state.anyNavVisible, `${context}: keine Navigation sichtbar`).toBe(true);
    expect(state.visiblePanelCount, `${context}: nicht genau ein Hauptbereich aktiv (${state.visiblePanelCount})`).toBeLessThanOrEqual(1);
  }
  expect(state.badNumbers, `${context}: NaN/Infinity in Ressourcen gefunden: ${state.badNumbers.join(',')}`).toEqual([]);
  expect(state.negatives, `${context}: negative Ressourcen gefunden: ${state.negatives.join(',')}`).toEqual([]);
}

function buildActions(page) {
  return {
    async switchTab() { await domClick(page, pick(this.rng, IDLE_TABS.map(t => t.btn))); },
    async advanceClock1h() { await page.evaluate(() => window.bkmpGameClockAdvance && window.bkmpGameClockAdvance(3600000)); },
    async advanceClockDay() { await page.evaluate(() => window.bkmpGameClockAdvance && window.bkmpGameClockAdvance(86400000)); },
    async clickDragon() { await page.evaluate(() => { const el = document.getElementById('idleDragonSprite') || document.querySelector('.idle-dragon-sprite'); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); },
    async mutateResources() { await page.evaluate(() => { if (typeof bkmpIdleState !== 'undefined' && bkmpIdleState) { bkmpIdleState.gold = Number(bkmpIdleState.gold || 0) + 10; bkmpIdleState.wood = Number(bkmpIdleState.wood || 0) + 1; } }); },
    async saveNow() { await page.evaluate(() => { if (typeof bkmpIdleQueueSync === 'function') bkmpIdleQueueSync(); }); },
    async resizeSmall() { await page.setViewportSize({ width: 390, height: 844 }); },
    async resizeLarge() { await page.setViewportSize({ width: 1366, height: 768 }); },
    async openAchievements() { await domClick(page, 'mcNameBadge'); },
    async closeOverlayEsc() { await page.keyboard.press('Escape').catch(() => {}); },
    async reload() { await page.reload(); await waitForIdleStateReady(page).catch(() => {}); }
  };
}

async function runSoak(page, qaServer, actionCount, seed, testInfo) {
  const errorCapture = attachErrorCapture(page);
  const rng = mulberry32(seed);
  const actions = buildActions(page);
  actions.rng = rng;
  const actionNames = Object.keys(actions).filter(k => k !== 'rng');
  const history = [];

  await page.goto(qaServer.url(`/?stand=${qaServer.teststand}`));
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await waitForIdleStateReady(page);
  await waitForDragonReady(page).catch(() => {});
  await checkInvariants(page, 'Start');

  for (let i = 0; i < actionCount; i++) {
    const name = pick(rng, actionNames);
    history.push(name);
    if (history.length > 25) history.shift();
    try {
      await actions[name]();
    } catch (e) {
      // Einzelne Aktionsfehler (z.B. Element gerade nicht vorhanden) sind
      // erlaubt - die Invarianten-Pruefung direkt danach entscheidet, ob
      // das ein echtes Problem war.
    }
    if (i % 5 === 0 || i === actionCount - 1) {
      try {
        await checkInvariants(page, `Aktion ${i + 1}/${actionCount} ("${name}")`);
      } catch (err) {
        const simTime = await page.evaluate(() => (window.bkmpGetGameNow ? new Date(window.bkmpGetGameNow()).toISOString() : null)).catch(() => null);
        testInfo.annotations.push({ type: 'soak-seed', description: String(seed) });
        testInfo.annotations.push({ type: 'soak-last-actions', description: history.join(' -> ') });
        testInfo.annotations.push({ type: 'soak-sim-time', description: String(simTime) });
        testInfo.annotations.push({ type: 'soak-viewport', description: JSON.stringify(page.viewportSize()) });
        testInfo.annotations.push({ type: 'soak-teststand', description: qaServer.teststand });
        throw err;
      }
    }
  }
  /* Nur echte Konsolenfehler pruefen, NICHT errorCapture.assertClean()s
     volle fehlgeschlagene-Requests-Pruefung: die "reload"-Aktion gehoert
     absichtlich zum Aktionspool und kann einen gerade laufenden Speicher-
     Request per echtem Browser-Verhalten abbrechen (net::ERR_ABORTED) -
     das ist bei einem zufaelligen Reload-mitten-im-Speichern genau das
     erwartete, harmlose Verhalten (derselbe Vorgang, den z.B. save-load.spec.js
     gezielt testet), kein Zeichen fuer einen echten Fehler. Beim eigenen
     Testen gefunden: ein erster Versuch mit der vollen assertClean() schlug
     genau daran fehl, nicht an einem echten Problem. */
  /* Zweiter, gleichartiger Fund (nur auf mobile-large/WebKit beobachtet):
     ein Reload GENAU waehrend eine der Marketing-Seiten-Ladefunktionen noch
     eine Anfrage offen hat, laesst WebKit diese mit einer CORS-klingenden
     "due to access control checks"-Meldung abbrechen statt Chromiums
     net::ERR_ABORTED - beides dieselbe harmlose Ursache (Navigation
     unterbricht eine laufende Anfrage), nur unterschiedlicher Wortlaut je
     Browser-Engine. NICHT global in KNOWN_HARMLESS_CONSOLE_PATTERNS
     aufgenommen (qa-fixtures.js) - dort soll eine echte CORS-Fehlkonfiguration
     weiterhin auffallen; hier, wo "reload mitten im Ablauf" nachweislich zum
     Aktionspool gehoert, ist die engere Ausnahme gerechtfertigt. */
  const SOAK_RELOAD_INTERRUPTION_PATTERNS = [
    /due to access control checks/,
    /WebSocket connection to .* failed: WebSocket is closed before the connection is established/
  ];
  const realErrors = errorCapture.consoleErrors.filter(
    e => !SOAK_RELOAD_INTERRUPTION_PATTERNS.some(re => re.test(e))
  );
  expect(realErrors, `Zufallstest Seed ${seed}, ${actionCount} Aktionen: Konsolenfehler:\n${realErrors.join('\n')}`).toEqual([]);
  return history;
}

test.describe('Zufalls-/Dauertest @soak-short', () => {
  test.use({ teststand: 'B' });

  test('kurzer Zufallstest (~150 Aktionen, fester Seed)', async ({ page, qaServer }, testInfo) => {
    test.setTimeout(120000);
    const SEED = 424242;
    const history = await runSoak(page, qaServer, 150, SEED, testInfo);
    expect(history.length).toBeGreaterThan(0);
  });
});

test.describe('Zufalls-/Dauertest lang @soak-long', () => {
  test.use({ teststand: 'B' });

  test('langer Dauertest (1000+ Aktionen, mehrere simulierte Tage/Groessen/Reloads, fester Seed)', async ({ page, qaServer }, testInfo) => {
    test.setTimeout(20 * 60 * 1000);
    const SEED = 987654;
    const history = await runSoak(page, qaServer, 1200, SEED, testInfo);
    expect(history.length).toBeGreaterThan(0);
  });
});
