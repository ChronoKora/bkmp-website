/* Regressionstest fuer die Sicherheitsverstaerkung vor Phase-3-Abschluss
   (24.07.2026, siehe CLAUDE.md) - weist nach, dass tests/helpers/
   network-guard.js's globale Sperre wirklich greift: eine ABSICHTLICH
   ausgeloeste Anfrage an den echten Produktions-Host wird sowohl auf
   Browser-Seite (fetch()/WebSocket bekommen nie eine echte Antwort) als auch
   auf Fixture-Seite (networkGuardViolations zeichnet den Verstoss auf)
   zuverlaessig blockiert.

   Bewusst NICHT ueber tests/helpers/qa-fixtures.js (dessen eigene,
   SPEZIFISCHERE SUPABASE_HOST_PATTERN-Route wuerde eine Anfrage an genau
   diesen Host schon VORHER abfangen und mocken, siehe network-guard.js's
   Dateikommentar zur Registrierungsreihenfolge/LIFO-Praezedenz - dieser Test
   soll stattdessen gezielt die BREITE, host-basierte Fallback-Sperre selbst
   pruefen, die fuer JEDEN anderen/kuenftigen Fall greift), sondern direkt
   gegen network-guard.js's eigenes `test`.

   networkGuardViolations wird nach jeder absichtlichen Ausloesung bewusst
   geleert (`.length = 0`) - sonst wuerde die automatische Teardown-Pruefung
   in network-guard.js's context-Fixture GENAU DIESEN Test faelschlich rot
   werden lassen, obwohl der Verstoss hier gewollt und bereits bewiesen ist.
   Jeder ANDERE, unbeabsichtigte Verstoss in jedem ANDEREN Test bleibt davon
   komplett unberuehrt und faellt weiterhin durch. */

const { test, expect, PROD_HOSTS } = require('../helpers/network-guard');

const PROD_HOST = PROD_HOSTS[0];

test.describe('network-guard @network-guard', () => {
  test('blockiert eine absichtliche fetch()-Anfrage an den echten Produktions-Host', async ({ page, qaServer, networkGuardViolations }) => {
    await page.goto(qaServer.url('/'));

    const result = await page.evaluate(async (host) => {
      try {
        const res = await fetch(`https://${host}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: 'network-guard-regression-test' },
          body: JSON.stringify({ email: 'nobody@example.invalid', password: 'wrong' })
        });
        return { reached: true, status: res.status };
      } catch (e) {
        return { reached: false, error: String(e) };
      }
    }, PROD_HOST);

    // Browser-Seite: der Request darf NIE eine echte Antwort bekommen haben.
    expect(result.reached, `fetch() haette blockiert werden muessen, bekam aber: ${JSON.stringify(result)}`).toBe(false);

    // Fixture-Seite: die Sperre muss den Verstoss selbst aufgezeichnet haben.
    expect(networkGuardViolations.length, 'network-guard.js haette den Verstoss aufzeichnen muessen').toBeGreaterThan(0);
    expect(networkGuardViolations.some(v => v.includes(PROD_HOST))).toBe(true);

    networkGuardViolations.length = 0; // siehe Datei-Kommentar oben
  });

  test('blockiert eine absichtliche WebSocket-Verbindung an den echten Produktions-Host', async ({ page, qaServer, networkGuardViolations }) => {
    await page.goto(qaServer.url('/'));

    const result = await page.evaluate((host) => new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
      try {
        const ws = new WebSocket(`wss://${host}/realtime/v1/websocket?apikey=x&vsn=1.0.0`);
        ws.onopen = () => finish({ opened: true });
        ws.onerror = () => finish({ opened: false, viaError: true });
        ws.onclose = (ev) => finish({ opened: false, viaClose: true, code: ev.code, reason: ev.reason });
      } catch (e) {
        finish({ opened: false, threw: String(e) });
      }
      setTimeout(() => finish({ opened: false, timedOut: true }), 5000);
    }), PROD_HOST);

    expect(result.opened, `WebSocket haette nie oeffnen duerfen: ${JSON.stringify(result)}`).toBe(false);
    expect(networkGuardViolations.length, 'network-guard.js haette den WebSocket-Verstoss aufzeichnen muessen').toBeGreaterThan(0);
    expect(networkGuardViolations.some(v => v.includes(PROD_HOST))).toBe(true);

    networkGuardViolations.length = 0; // siehe Datei-Kommentar oben
  });

  test('erlaubt weiterhin normale Anfragen an den eigenen lokalen QA-Server (Positivkontrolle)', async ({ page, qaServer, networkGuardViolations }) => {
    await page.goto(qaServer.url('/'));
    const qaModeActive = await page.evaluate(() => window.BKMP_QA_MODE === true);
    expect(qaModeActive, 'QA-Modus haette auf dem lokalen Server aktivieren muessen').toBe(true);
    // Eine ganz normale Seiten-Ladung gegen den erlaubten 127.0.0.1-Host darf
    // NICHT als Verstoss gezaehlt werden - ohne diese Kontrolle koennte die
    // Sperre "immer alles blockieren" und die beiden Tests oben wuerden
    // trotzdem gruen erscheinen.
    expect(networkGuardViolations).toEqual([]);
  });

  /* Sicherheits-/Stabilitaetsphase 24.07.2026 (siehe CLAUDE.md), Auftragspunkt
     "QA-Server-nicht-erreichbar-Szenario": SUPABASE_URL wird im QA-Modus
     EINMALIG statisch auf location.origin gesetzt (supabase.js), nicht per
     Laufzeit-Fallback - stirbt der lokale Mock-Server WAEHREND einer Sitzung
     (oder war die Ziel-URL nie erreichbar), gibt es strukturell keinen
     Codepfad, der stattdessen automatisch das echte Produktionsprojekt
     kontaktieren wuerde. Dieser Test bildet genau das nach: ein qaServer wird
     erzeugt und SOFORT wieder geschlossen, dann wird versucht, die (jetzt
     tote) Adresse zu laden. */
  test('QA-Server nicht erreichbar: schlaegt lokal fehl, kein Fallback auf Produktion', async ({ page, qaServer, networkGuardViolations }) => {
    const deadUrl = qaServer.url('/');
    await qaServer.close(); // Server sofort wieder schliessen - Adresse bleibt gueltig-aussehend, aber niemand hoert mehr zu.

    let navError = null;
    try {
      await page.goto(deadUrl, { timeout: 5000 });
    } catch (e) {
      navError = String(e);
    }
    expect(navError, 'Navigation zu einem toten lokalen Server haette fehlschlagen muessen').not.toBeNull();
    // Browser-spezifischer Wortlaut unterscheidet sich (Chromium: "net::ERR_
    // CONNECTION_REFUSED", WebKit: "Could not connect to server") - beide
    // sagen dasselbe aus (Verbindung schlug fehl), daher ein breiteres Muster
    // statt eines Chromium-spezifischen.
    expect(navError).toMatch(/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|Timeout|net::|Could not connect|NS_ERROR_CONNECTION_REFUSED/i);

    // Kein Fallback-Kontakt zu irgendeinem nicht erlaubten Host - die einzige
    // "Anfrage" war der gescheiterte lokale Verbindungsversuch selbst.
    expect(networkGuardViolations).toEqual([]);
  });
});
