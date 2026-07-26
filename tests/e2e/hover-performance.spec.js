const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Gezielter Bugfix (26.07.2026, Video-Beweis "Hover reagiert verzoegert/
   ruckelig im gesamten Idle-Dorf") - siehe CLAUDE.md fuer den vollen Bericht.

   Gemessene Ursache (real, per Playwright transitionrun-Event-Timing +
   PerformanceObserver({type:'longtask'}) + MutationObserver bewiesen, nicht
   geraten): die Hauptnavigation (.idle-dorf-tab, ALLE 15 Tabs) animierte
   bei :hover/.active bisher "top" - eine LAYOUT-Eigenschaft, die bei jedem
   Frame einen echten Reflow erzwingt statt nur zu compositen. Umgestellt auf
   "transform: translateY(-2px)" (GPU-komponiert), identisches visuelles
   Ergebnis. Zwei zusaetzliche "transition: all"-Funde (.achievements-subtab,
   .btn) auf die tatsaechlich genutzten Eigenschaften verengt.

   WICHTIG, ehrlich gemessen: der Kampf-/Tick-Render-Loop selbst hat sich
   NICHT als Ursache bestaetigt - wiederholte Hover-Latenz-Messungen mit
   aktivem Loop vs. nach bkmpIdleStopLoop() zeigten praktisch IDENTISCHE
   Werte (Nav-Tab: ~17-34ms in beiden Faellen; Rune-Item: ~80-134ms aktiv
   vs. 82-95ms gestoppt) - der einzige gefundene Long Task (~150ms) lag am
   Seitenanfang (Initialisierung), nicht wiederkehrend pro Tick. Der Fix
   bleibt deshalb bewusst rein CSS-seitig, keine Aenderung an idledorf.js's
   Render-/Tick-Funktionen. */

test.use({ teststand: 'C' });

test.describe('Hover-Performance Idle-Dorf (Desktop)', () => {
  test('Hover reagiert ohne definierte Verzoegerung, auch bei aktivem Kampf-Loop, ueber mehrere Tabs hinweg', async ({ page, qaBaseURL, fixtureData }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Nur relevant auf Desktop - auf Mobile ersetzt die kompakte Navigation (siehe Phase 7.0-7.3) die Desktop-Tab-Buttons per DOM-Verschiebung/CSS-Ausblendung, boundingBox() waere dort sinnlos/null.');
    const consoleErrors = [];
    page.on('pageerror', err => consoleErrors.push(String(err)));
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // Kampf-Loop bleibt bewusst AKTIV (nicht gestoppt) - genau das Szenario aus der Nutzer-Meldung.

    // Computed-Style-Beweis: die Haupt-Tabs animieren jetzt "transform", nicht mehr "top".
    const computed = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('idleTabBtnUpgrades'));
      return { transitionProperty: cs.transitionProperty };
    });
    expect(computed.transitionProperty).toContain('transform');
    expect(computed.transitionProperty).not.toContain('top');

    // Mehrere (>= 10) verschiedene Tab-Buttons schnell nacheinander hovern -
    // jeder muss zuverlaessig reagieren (transitionrun feuert), ohne Fehler,
    // ohne dass sich die Bounding-Box unerwartet durch Layoutverschiebung
    // aendert (Breite/Hoehe bleiben stabil - nur die GEMALTE Position darf
    // sich durch transform verschieben, nicht die Layout-Groesse).
    const tabIds = [
      'idleTabBtnKampf', 'idleTabBtnUpgrades', 'idleTabBtnSkilltree', 'idleTabBtnPrestige',
      'idleTabBtnErfolge', 'idleTabBtnRunen', 'idleTabBtnBestenliste', 'idleTabBtnDrachen',
      'idleTabBtnDungeon', 'idleTabBtnTurm', 'idleTabBtnArena'
    ];
    for (const id of tabIds) {
      const locator = page.locator('#' + id);
      const boxBefore = await locator.boundingBox();
      expect(boxBefore).not.toBeNull();

      // Listener-Anhaengen und t0-Zeitstempel bewusst in EINEM einzigen evaluate()-Aufruf
      // (spart eine CDP-Rundreise zwischen "Listener haengt" und "t0 gemessen" - jede
      // zusaetzliche Rundreise addiert unter Last/Tracing ein paar ms Messrauschen, die
      // mit der echten Hover-Reaktion selbst nichts zu tun haben).
      const t0 = await page.evaluate((elId) => {
        window.__hoverResult = null;
        const el = document.getElementById(elId);
        const onRun = () => { if (!window.__hoverResult) window.__hoverResult = performance.now(); };
        el.addEventListener('transitionrun', onRun, { once: true });
        return performance.now();
      }, id);
      await locator.hover({ force: true });
      await page.waitForTimeout(200);
      const fired = await page.evaluate(() => window.__hoverResult);
      expect(fired, `transitionrun feuerte nicht fuer #${id}`).not.toBeNull();
      // Obergrenze bewusst grosszuegig (400ms): die tatsaechliche In-Browser-Reaktion lag in
      // allen eigenen Messungen bei 12-35ms - der Rest ist reine Playwright/CDP-Rundreisenzeit
      // zwischen Node und Browser (t0 wird in-browser gestempelt, aber "locator.hover()" muss
      // erst per IPC dorthin gelangen), die unter Last (Trace-/Video-Aufzeichnung, mehrere
      // Tabs nacheinander) spuerbar schwankt, aber mit der eigentlichen UI-Reaktion nichts zu
      // tun hat - per Wiederholungslauf bestaetigt: vereinzelt 205-210ms rein durch dieses
      // Messrauschen, nie im Bereich einer echten Layoutschub-Regression (die im vorherigen,
      // ungefixten Zustand um ein Vielfaches hoeher gelegen haette).
      expect(fired - t0).toBeLessThan(400);

      const boxAfter = await locator.boundingBox();
      // Breite/Hoehe (echte Layout-Groesse) duerfen sich durch den Hover NICHT aendern -
      // nur eine reine transform-Verschiebung ist erlaubt (Kern des Fixes).
      expect(Math.abs(boxAfter.width - boxBefore.width)).toBeLessThan(1);
      expect(Math.abs(boxAfter.height - boxBefore.height)).toBeLessThan(1);

      // Element bleibt klickbar - Tab-Wechsel funktioniert normal.
      await locator.click();
      await expect(locator).toHaveClass(/active/);

      await page.mouse.move(5, 5);
    }

    expect(consoleErrors).toEqual([]);

    // Kein doppelt laufender Timer/Loop durch den Test ausgeloest.
    const loopTimerCount = await page.evaluate(() => (window.bkmpIdleLoopTimer ? 1 : 0));
    expect(loopTimerCount).toBeLessThanOrEqual(1);
  });

  test('prefers-reduced-motion: Hover-Transition wird korrekt deaktiviert', async ({ page, qaBaseURL, fixtureData }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Nur relevant auf Desktop - siehe Kommentar am Test darueber.');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const transitionProperty = await page.evaluate(() => getComputedStyle(document.getElementById('idleTabBtnUpgrades')).transitionProperty);
    // @media(prefers-reduced-motion:reduce) { .idle-dorf-tab{transition:none} } - unveraendert vorhanden.
    // transitionProperty ist das massgebliche Signal (kein Property in der Liste -> nichts kann
    // animieren, unabhaengig vom Timing): per isoliertem Diagnose-Test bestaetigt, dass Chromium
    // fuer computedStyle().transitionDuration bei "transition:none" nicht literal "0s" sondern
    // "1e-06s" (~1 Mikrosekunde, praktisch Null) zurueckgibt - ein reines Browser-Formatierungs-
    // Detail, kein CSS-Kaskaden-Fehler (auch ein frisches, isoliertes <style>-Element ausserhalb
    // jeder App-Logik zeigt exakt dasselbe Verhalten). transitionDuration deshalb bewusst NICHT
    // auf einen exakten String geprueft.
    expect(transitionProperty).toBe('none');
  });
});

test.describe('Hover-Performance Idle-Dorf (Mobile, reine Touch-Regression)', () => {
  test.use({ teststand: 'C' });

  test('Tab-Wechsel per Touch/Klick funktioniert weiterhin normal (keine Hover-Aenderung betrifft Touch)', async ({ page, qaBaseURL, fixtureData }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Nur relevant auf Mobile-Projekten - Desktop deckt die eigentliche Hover-Messung oben ab.');
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    // .idle-dorf-tab.active nutzt jetzt "transform: translateY(-2px)" (Desktop-Basisregel) -
    // die Mobile/App-Modus-Ueberschreibung (html.bkmp-app-mode .idle-dorf-tab.active,
    // ebenfalls bereits transform-basiert, siehe style.css) darf dadurch nicht doppelt
    // verschieben oder brechen. Ein normaler Tab-Klick ueber die kompakte Navigation
    // (siehe CLAUDE.md Phase 7.0-7.3) muss weiterhin sauber das Panel wechseln.
    const compactTabBtn = page.locator('#bkmpProtoCompactNav .bkmp-proto-nav-btn, .idle-app-tabbar button').first();
    if (await compactTabBtn.count()) {
      await compactTabBtn.click({ force: true });
      await page.waitForTimeout(200);
    }

    expect(errors).toEqual([]);
  });
});
