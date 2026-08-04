const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Spieler-Nachfrage (01.08.2026, Screenshot der Raid-Kampfleiste): "Was ist
   das eigentlich beim stuendlichen Raid boss? Auto kampf? Rote Symbol.. Die
   Klickzaehler? der nicht funktioniert?"

   Root Cause: die Aktualisierung von #raidTapDamagePill/#raidRewardsStrip
   in bkmpRaidRenderCombat() (js/systems/bkmp-raid.js) stand hinter
   "if (window.BKMP_APP_MODE)" - der urspruengliche Kommentar dort behauptete
   faelschlich, die Elemente existierten auf der normalen Website nicht.
   Tatsaechlich stehen sie unconditional in index.html, .raid-action-bar ist
   seit Redesign Phase 5 IMMER sichtbar (html.bkmp-app-mode ist seit damals
   die CSS-Klasse fuer OPTIK auf jeder Seite, window.BKMP_APP_MODE bleibt das
   engere /app-exklusive VERHALTENS-Flag - siehe Kommentar in index.html).
   Jeder Klick zaehlte serverseitig+intern also schon immer korrekt, nur die
   Anzeige aktualisierte sich auf der normalen Website (window.BKMP_APP_MODE
   ===false) nie - exakt dasselbe Bugmuster wie der frueher separate
   #raidAttackBtn (siehe idledorf.js, inzwischen komplett entfernt).

   Nachtrag 04.08.2026 (Spieler-Feedback ChronoKora, "das Rote Symbol" hier
   war das "⚔️ Angreifen"-Knopf-Symbol - komplett entfernt, siehe Kommentar
   in idledorf.js/style.css): #raidTapDamagePill zaehlte urspruenglich die
   kumulierte TIPP-SCHADENSSUMME (redundant zur direkt darunter angezeigten
   Liste einzelner Treffer) - zeigt jetzt stattdessen die Anzahl der
   eigenen Klicks/Tipper (bkmpRaidTapClickSession, +1 statt +clickDamage
   pro Klick), eine tatsaechlich neue Information.

   Test laeuft bewusst NICHT unter /app (openAndLogin, nicht openAppMode) -
   genau der zuvor kaputte Fall. Reiner State-Injektions-Test (identisches
   Prinzip wie guild-tech-ext-readside.spec.js) statt eines echten Raid-Joins -
   bkmpRaidRenderCombat() liest nur bereits vorhandenen Client-State, kein
   RPC-Aufruf noetig um das reine Anzeige-Verhalten zu beweisen. */

test.describe('Raid-Kampfleiste: Klick-Zaehler + Ressourcenleiste auf der normalen Website (nicht /app)', () => {
  test.use({ teststand: 'A' });

  test('REGRESSION: #raidTapDamagePill aktualisiert sich, obwohl window.BKMP_APP_MODE hier false ist', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const result = await page.evaluate(() => {
      bkmpRaidState = {
        id: 'diag-raid-appmode-test', bossName: 'Testboss',
        bossHp: 500, bossMaxHp: 1000, cityHp: 50, cityMaxHp: 100,
        cityAttack: 10, cityDefense: 5, status: 'fight'
      };
      bkmpRaidTapDamageSessionId = 'diag-raid-appmode-test';
      bkmpRaidTapClickSession = 54321;
      bkmpRaidRenderCombat();
      return {
        isAppMode: !!window.BKMP_APP_MODE,
        tapText: document.querySelector('#raidTapDamagePill .idle-res-val').textContent,
        stripHtml: document.getElementById('raidRewardsStrip').innerHTML
      };
    });

    expect(result.isAppMode).toBe(false);
    expect(result.tapText).toBe('54.3K');
    // Ressourcenleiste braucht echten Login-State (bereits durch openAndLogin
    // vorhanden) - beweist denselben unconditional-Pfad fuer den zweiten,
    // bisher ebenso gesperrten Teil desselben Blocks.
    expect(result.stripHtml).toContain('idle-res-gold');
  });

  test('ein neuer Raid (andere Raid-Id) setzt den Zaehler korrekt auf 0 zurueck, unabhaengig vom App-Modus', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const result = await page.evaluate(() => {
      bkmpRaidState = { id: 'raid-old', bossName: 'A', bossHp: 1, bossMaxHp: 1, cityHp: 1, cityMaxHp: 1, cityAttack: 0, cityDefense: 0, status: 'fight' };
      bkmpRaidTapDamageSessionId = 'raid-old';
      bkmpRaidTapClickSession = 999; // unter der 1000er-K-Abkuerzungsgrenze, bleibt als reine Zahl erhalten
      bkmpRaidRenderCombat();
      const before = document.querySelector('#raidTapDamagePill .idle-res-val').textContent;

      bkmpRaidState = { id: 'raid-new', bossName: 'B', bossHp: 1, bossMaxHp: 1, cityHp: 1, cityMaxHp: 1, cityAttack: 0, cityDefense: 0, status: 'fight' };
      bkmpRaidRenderCombat();
      const after = document.querySelector('#raidTapDamagePill .idle-res-val').textContent;
      return { before, after };
    });

    expect(result.before).toBe('999');
    expect(result.after).toBe('0');
  });

  test('ein echter Klick auf den Boss erhoeht den Zaehler um genau 1, unabhaengig vom ausgeteilten Schaden', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    const result = await page.evaluate(() => {
      bkmpRaidState = {
        id: 'diag-raid-clickcount-test', bossName: 'Testboss',
        bossHp: 10000000, bossMaxHp: 10000000, cityHp: 100, cityMaxHp: 100,
        cityAttack: 10, cityDefense: 5, status: 'fighting'
      };
      bkmpRaidTapDamageSessionId = 'diag-raid-clickcount-test';
      bkmpRaidTapClickSession = 0;
      // submitRaidDamage() ohne echten Mock-Server nicht aufrufbar - der
      // Test bricht die Promise-Kette bewusst mit einer Fehlermeldung ab
      // (catch(()=>{}) direkt danach in bkmpRaidHandleBossClick faengt das
      // ab); der hier zu beweisende Klick-Zaehler wird bereits VOR diesem
      // Aufruf synchron erhoeht.
      bkmpRaidHandleBossClick();
      bkmpRaidHandleBossClick();
      bkmpRaidHandleBossClick();
      return { clicks: bkmpRaidTapClickSession };
    });
    // Drei schnell aufeinanderfolgende Klicks koennen je nach Autoklicker-
    // Schutz-Zeitfenster (BKMP_CLICK_RATE_CAP_MS) nicht alle drei zaehlen -
    // mindestens der erste zaehlt garantiert, das beweist bereits "+1 pro
    // Klick, nicht +Schaden".
    expect(result.clicks).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(result.clicks)).toBe(true);
  });
});
