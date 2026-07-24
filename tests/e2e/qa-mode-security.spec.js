/* QA-Grundlage Phase 2 (24.07.2026, siehe CLAUDE.md) - dedizierter
   Sicherheitstest: schlaegt SOFORT fehl, sobald waehrend eines vollstaendigen
   Spielerablaufs im lokalen QA-Modus irgendeine Netzwerkanfrage an einen
   anderen Host als 127.0.0.1/localhost geht - insbesondere an den echten
   Produktions-Host zgknyrwzpohvfdweomxf.supabase.co.

   Anders als qa-mode-smoke.spec.js (das den Ablauf funktional prueft) ist
   dieser Test AUSSCHLIESSLICH auf Netzwerk-Isolation fokussiert: er
   registriert page.on('request') VOR jeder Navigation (damit auch die
   allerersten Requests erfasst werden) und wertet danach JEDE einzelne
   beobachtete Request-URL aus - keine Stichprobe, keine Annahme.

   Deckt den vom Auftrag verlangten 13-Schritte-Ablauf ab: QA-Modus oeffnen,
   Testnutzer anmelden, Testspielstand laden, Ressourcen aendern, Speichern
   ausloesen, Auto-Save gezielt ausloesen, mehrere Bereiche oeffnen, Seite neu
   laden, Testspielstand erneut laden, ausloggen, erneut einloggen, QA-Zeit
   vorspulen, erneut speichern. */

/* test/expect kommen seit der Sicherheitsverstaerkung (24.07.2026, siehe
   CLAUDE.md) aus network-guard.js: globale, AKTIVE Netzwerksperre (blockiert
   sofort) + fertiger, TESTSTANDS-basierter qaServer-Fixture mit garantiertem
   ?qa=1. Dieser Test bleibt trotzdem bestehen und eigenstaendig: er beweist
   die Isolation von AUSSEN (page.on('request')/('websocket') beobachtet, was
   der Browser tatsaechlich versucht hat), waehrend network-guard.js von
   INNEN (Playwright-Routing) blockiert - zwei unabhaengige Nachweise
   desselben Ziels, PROD_HOST/isAllowedHost jetzt aus einer einzigen Quelle
   statt einer zweiten, potenziell driftenden Kopie. */
const { test: base, expect } = require('../helpers/network-guard');
const { QA_PASSWORD } = require('../fixtures/teststands');
const { IDLE_TABS } = require('../helpers/selectors');
const { waitForIdleStateReady, waitForDragonReady } = require('../helpers/qa-fixtures');
const { PROD_HOSTS, isAllowedHost } = require('../helpers/network-guard');

const PROD_HOST = PROD_HOSTS[0];

const test = base;

function hostOf(urlString) {
  try { return new URL(urlString).hostname; } catch (e) { return null; }
}

async function domClick(page, id) {
  await page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (el) el.click();
  }, id);
}

async function reopenIdleDorf(page) {
  await domClick(page, 'idleDorfButton');
  await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
  await waitForIdleStateReady(page);
}

test.describe('QA-Modus Sicherheitstest: kein Produktionskontakt @qa-security', () => {
  test.use({ teststand: 'B' });

  test('kompletter 13-Schritte-Spielerablauf kontaktiert NIEMALS den echten Supabase-Host', async ({ page, qaServer }) => {
    test.setTimeout(90000);

    /* Alle beobachteten Requests werden gesammelt (nicht sofort geworfen) -
       so liefert ein Fehlschlag am Ende eine vollstaendige Liste statt nur
       der ersten Verletzung, und der Test bleibt lesbar, welche Aktion
       (per Log-Marker) zum Zeitpunkt der Anfrage gerade lief. */
    const allRequests = [];
    let currentStep = 'vor Testbeginn';
    page.on('request', (req) => {
      allRequests.push({ url: req.url(), host: hostOf(req.url()), step: currentStep });
    });
    // Deckt auch WebSocket-Verbindungen ab (Realtime) - page.on('request')
    // erfasst normale HTTP(S)-Anfragen; WebSockets laufen separat.
    const allWebSockets = [];
    page.on('websocket', (ws) => {
      allWebSockets.push({ url: ws.url(), host: hostOf(ws.url()), step: currentStep });
    });

    function step(name) { currentStep = name; }

    // 1. QA-Modus oeffnen
    step('1. QA-Modus oeffnen');
    await page.goto(qaServer.url(`/?stand=${qaServer.teststand}`));
    const qaModeActive = await page.evaluate(() => window.BKMP_QA_MODE === true);
    expect(qaModeActive, 'window.BKMP_QA_MODE muss aktiv sein').toBe(true);

    // 2. Testnutzer anmelden (das QA-Panel meldet per ?stand= automatisch an)
    step('2. Testnutzer anmelden');
    await expect(page.locator('[data-testid="qa-panel"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForIdleStateReady(page);
    await waitForDragonReady(page);

    // 3. Testspielstand laden (bereits durch Schritt 2 geschehen - zusaetzlich
    //    explizit bestaetigen, dass ein echter Zustand da ist)
    step('3. Testspielstand laden');
    const initialState = await page.evaluate(() => ({ level: bkmpIdleState.level, gold: bkmpIdleState.gold }));
    expect(initialState.level).toBeGreaterThan(0);

    // 4. Ressourcen aendern
    step('4. Ressourcen aendern');
    await page.evaluate(() => {
      bkmpIdleState.gold = Number(bkmpIdleState.gold || 0) + 4321;
      bkmpIdleState.wood = Number(bkmpIdleState.wood || 0) + 111;
    });

    // 5. Speichern ausloesen + 6. Auto-Save gezielt ausloesen (echte
    //    Produktionsfunktion, kein Testkopie-Pfad)
    step('5+6. Speichern / Auto-Save ausloesen');
    await page.evaluate(() => bkmpIdleQueueSync());
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    // 7. Mehrere Bereiche oeffnen (alle 15 Haupttabs)
    step('7. Mehrere Bereiche oeffnen');
    for (const tab of IDLE_TABS) {
      await domClick(page, tab.btn);
    }

    // 8. Seite neu laden
    step('8. Seite neu laden');
    await page.reload();
    await waitForIdleStateReady(page);

    // 9. Testspielstand erneut laden (anderen Teststand nachladen ueber das
    //    QA-Panel, deckt den Reseed+Redirect-Pfad mit ab)
    step('9. Testspielstand erneut laden');
    await page.evaluate(async () => {
      await fetch(location.origin + '/__qa__/reseed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teststand: 'C' })
      });
    });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(qaServer.url('/?stand=C'));
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForIdleStateReady(page);

    // 10. Ausloggen (echte Produktionsfunktion) - bkmpPlayerLogout() allein
    //     loescht nur die Supabase-Session; den GECACHTEN Anzeigenamen
    //     raeumt erst bkmpSetMcName('') weg (siehe js/core/bkmp-site.js's
    //     "Konto wechseln"-Handler, exakt derselbe Zwei-Schritt-Ablauf) -
    //     ohne den zweiten Aufruf haelt #mcNameBadge den Spieler faelschlich
    //     fuer weiter eingeloggt und oeffnet beim naechsten Klick die
    //     Erfolge-Ansicht statt des Login-Formulars (beim eigenen Testen
    //     gefunden: Schritt 11 blieb dadurch 10s auf dem geschlossenen
    //     Login-Overlay haengen).
    step('10. Ausloggen');
    /* Das Idle-Dorf-Fenster war zu diesem Zeitpunkt noch offen (Schritt 9) -
       ein echter Spieler wuerde es vor/als Teil eines Kontowechsels
       schliessen. Ohne diesen Schritt bleibt #idleDorfOverlay sichtbar UND
       ueberlagert das gleich darauf geoeffnete Login-Formular (dessen
       Absenden-Button dadurch nie einen echten Klick erhaelt, 90s-Timeout -
       beim eigenen Testen gefunden, kein App-Bug, nur eine unrealistische
       Test-Reihenfolge). */
    await domClick(page, 'idleDorfCloseX');
    await page.evaluate(async () => { await bkmpPlayerLogout(); bkmpSetMcName(''); });

    // 11. Erneut einloggen (echtes Login-Formular, wie ein Spieler es nutzt)
    step('11. Erneut einloggen');
    /* Auf schmalen Mobil-Breiten (390px) ist das schwebende QA-Panel (280px,
       unten rechts fixiert) breit genug, um das zentrierte Login-Formular
       teilweise zu ueberlagern und dessen Absenden-Button fuer echte
       Playwright-Klicks unerreichbar zu machen (beim eigenen Testen
       gefunden - eine reale UX-Kleinigkeit des Panels selbst, keine
       Sicherheitsluecke). Das Panel hat dafuer bereits einen eigenen
       "Panel verstecken"-Button (Phase 1) - genau das wuerde ein Mensch in
       dieser Situation auch tun. */
    await page.evaluate(() => { const h = document.querySelector('[data-qa-hide]'); if (h) h.click(); });
    await page.evaluate(() => { const b = document.getElementById('mcNameBadge'); if (b) b.click(); });
    await expect(page.locator('#mcNameOverlay')).toHaveClass(/visible/, { timeout: 10000 });
    await page.locator('#mcAuthName').fill('QaFortgeschC');
    await page.locator('#mcAuthPassword').fill(QA_PASSWORD);
    await page.locator('#mcAuthSubmit').click();
    await expect(page.locator('#mcNameOverlay')).not.toHaveClass(/visible/, { timeout: 15000 });
    await reopenIdleDorf(page);

    // 12. QA-Zeit vorspulen
    step('12. QA-Zeit vorspulen');
    await page.evaluate(() => window.bkmpGameClockAdvance(86400000));
    const simulated = await page.evaluate(() => window.bkmpGameClockIsSimulated());
    expect(simulated, 'GameClock sollte nach Vorspulen im QA-Modus als simuliert gelten').toBe(true);

    // 13. Erneut speichern
    step('13. Erneut speichern');
    await page.evaluate(() => { bkmpIdleState.gold = Number(bkmpIdleState.gold || 0) + 777; });
    await page.evaluate(() => bkmpIdleQueueSync());
    await page.evaluate(() => bkmpIdleFlushSyncNow());

    step('Testende');

    // --- Auswertung: JEDE beobachtete Anfrage muss 127.0.0.1/localhost sein ---
    const violations = allRequests.filter(r => !isAllowedHost(r.host));
    const prodContact = allRequests.filter(r => r.host === PROD_HOST);
    const wsViolations = allWebSockets.filter(r => !isAllowedHost(r.host));

    expect(prodContact, `Direkter Kontakt zum echten Produktions-Host gefunden:\n${JSON.stringify(prodContact, null, 2)}`).toEqual([]);
    expect(violations, `Anfrage(n) an einen nicht erlaubten Host gefunden (erwartet nur 127.0.0.1/localhost):\n${JSON.stringify(violations, null, 2)}`).toEqual([]);
    expect(wsViolations, `WebSocket-Verbindung(en) zu einem nicht erlaubten Host gefunden:\n${JSON.stringify(wsViolations, null, 2)}`).toEqual([]);

    // Positivkontrolle: der Test soll nicht "zufaellig gruen" sein, weil er
    // z.B. gar keine Anfragen beobachtet hat (kaputter Listener waere sonst
    // unbemerkt) - es MUESSEN reale lokale Anfragen stattgefunden haben.
    expect(allRequests.length, 'Es wurden ueberhaupt keine Netzwerkanfragen beobachtet - Listener vermutlich fehlerhaft').toBeGreaterThan(10);
  });
});
