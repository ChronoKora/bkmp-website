const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Dringender Bugfix-Auftrag 25.07.2026 (Nutzerbericht: "Effekte: An/Aus"-
   Schalter oben rechts verschwindet ~1s nach dem Oeffnen des Idle-Dorf-
   Fensters).

   URSACHE (js/ui/bkmp-hud.js, bkmpIdleRenderHud(), Desktop-Zweig ab
   window.matchMedia('(min-width:761px)') bzw. kein BKMP_APP_MODE/schmaler
   Viewport): #idleFxModeBtn lebt statisch in index.html AUSSERHALB von
   #idleDorfHud und wird beim ERSTEN Render per Portal-Muster
   (hudTop.appendChild) in die frisch gebaute .idle-hud-top gehaengt. Der
   dortige Kommentar behauptete, der Button "ueberlebe die innerHTML-
   Ersetzung unbeschadet" - das stimmt nur fuer GENAU DIESEN ersten Aufruf.
   Ab dem ZWEITEN Render (jeder Tick/Ressourcenwechsel ruft
   bkmpIdleRenderHud() erneut auf) ist der Button laengst ein Kind von
   #idleDorfHud - "hud.innerHTML = ..." zerstoert den echten DOM-Knoten
   dabei unwiderruflich, BEVOR die (bisherige) "document.getElementById(...)"-
   Zeile danach ueberhaupt lief - die fand ab da fuer immer nichts mehr,
   das Element verschwand endgueltig aus dem DOM (kein reines CSS-
   Sichtbarkeitsproblem, kein Layout-Ueberdecken - der Knoten selbst war weg).
   Erklaert exakt "nach ungefaehr einer Sekunde" (der naechste normale
   Kampf-Tick loest den zweiten Render aus).

   FIX (kleinstmoegliche Aenderung, js/ui/bkmp-hud.js): der Button wird jetzt
   IMMER VOR der innerHTML-Ersetzung per .remove() aus #idleDorfHud
   herausgeloest (falls er gerade dort haengt) und danach aus genau dieser
   JS-Referenz (nicht aus einem erneuten getElementById-Aufruf) wieder
   eingehaengt - ueberlebt dadurch JEDEN Render, nicht nur den ersten.

   Betrifft strukturell nur den DESKTOP-Zweig (window.BKMP_APP_MODE ||
   matchMedia(max-width:760px) => fruehe Rueckkehr VOR dem Portal-Code,
   siehe Kommentar dort "Nur im Desktop-Zweig"). Per echtem Vorher/Nachher-
   Testlauf bestaetigt (Fix kurz entfernt, Tests liefen rot, Fix
   zurueckgesetzt, Tests liefen wieder gruen). Auf mobile-small/mobile-large
   (beide <760px) ist #idleFxModeBtn KEIN sinnvoller Test-Gegenstand - dort
   greift schon beim ALLERERSTEN Render die kompakte HUD-Vorlage (fruehe
   Rueckkehr, Portal-Code laeuft nie), waehrend #idleFxModeBtn an seiner
   urspruenglichen statischen Position ausserhalb des sichtbaren kompakten
   Layouts verbleibt (per Test bestaetigt: dort "hidden", nicht Teil dieses
   Bugs) - die kompakte Vorlage hat dafuer ihr EIGENES, architektonisch
   unabhaengiges Icon (#bkmpProtoChudFxBtn, js/prototype/bkmp-proto-compact-
   hud.js), das nie per innerHTML-Wipe-Muster aufgebaut wird und darum nie
   demselben Bug unterliegen konnte - eigener, unten separat gepruefter
   Testblock. */

test.describe('Bug 4 - Effekte-Schalter bleibt nach dem Oeffnen dauerhaft sichtbar (Teststand A, Desktop-HUD)', () => {
  test.use({ teststand: 'A' });
  test.beforeEach(({}, testInfo) => {
    test.skip(/^mobile-/.test(testInfo.project.name), '#idleFxModeBtn ist der Desktop-Portal-Button - auf mobile-Breiten greift die kompakte HUD-Vorlage mit ihrem eigenen #bkmpProtoChudFxBtn (siehe separater Testblock unten), #idleFxModeBtn ist dort strukturell nie sichtbar');
  });

  test('Schalter sofort sichtbar, ueberlebt mehrere echte HUD-Renders (2s/mehrere Ticks), bleibt bei Effekte-Aus sichtbar, uebersteht Reload, laesst sich wieder einschalten', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    // 1+2) Idle-Fenster offen, Schalter sofort sichtbar.
    const fxBtn = page.locator('#idleFxModeBtn');
    await expect(fxBtn).toBeVisible();
    await expect(fxBtn).toContainText('Effekte:');
    const box1 = await fxBtn.boundingBox();
    expect(box1).toBeTruthy();
    expect(box1.width).toBeGreaterThan(0);
    expect(box1.height).toBeGreaterThan(0);

    // 3) Mehrere echte HUD-Renders erzwingen (kein reines Warten - bkmpIdleRenderHud() wird
    //    normalerweise durch den Kampf-Tick ausgeloest, hier direkt und wiederholt aufgerufen,
    //    um GENAU den Bug-Pfad zu treffen: "ab dem zweiten Render").
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => bkmpIdleRenderHud());
    }
    await page.waitForTimeout(2000);
    await page.evaluate(() => bkmpIdleRenderHud());

    // 4) Schalter muss weiterhin im DOM UND sichtbar sein.
    await expect(fxBtn).toBeVisible();
    await expect(fxBtn).toHaveCount(1); // keine Geister-Duplikate durch wiederholtes appendChild
    const box2 = await fxBtn.boundingBox();
    expect(box2.width).toBeGreaterThan(0);
    expect(box2.height).toBeGreaterThan(0);

    // Kein Overlay blockiert ihn - ein echter Hit-Test am Mittelpunkt muss den Button selbst treffen.
    const hitOk = await page.evaluate(() => {
      const el = document.getElementById('idleFxModeBtn');
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    });
    expect(hitOk).toBe(true);

    // 5) Effekte ausschalten (echter Klick durch den Zyklus Hoch -> Reduziert -> Aus).
    await fxBtn.click();
    await fxBtn.click();
    // 6) Schalter bleibt sichtbar und zeigt "Aus".
    await expect(fxBtn).toBeVisible();
    await expect(fxBtn).toContainText('Aus');

    // Weitere Renders NACH dem Ausschalten duerfen ihn ebenfalls nicht entfernen.
    await page.evaluate(() => bkmpIdleRenderHud());
    await expect(fxBtn).toBeVisible();
    await expect(fxBtn).toContainText('Aus');

    // 7+8) Seite neu laden - Einstellung (localStorage) UND Schalter (DOM) bleiben erhalten.
    await page.reload();
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);
    const fxBtnAfterReload = page.locator('#idleFxModeBtn');
    await expect(fxBtnAfterReload).toBeVisible();
    await expect(fxBtnAfterReload).toContainText('Aus');

    // 9) Effekte wieder einschalten (Zyklus Aus -> Hoch).
    await fxBtnAfterReload.click();
    await expect(fxBtnAfterReload).toContainText('Hoch');
    await expect(fxBtnAfterReload).toBeVisible();

    // Kein horizontales Ueberlaufen durch den Schalter verursacht.
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflowX).toBe(false);
  });

  test('keine doppelten Klick-Listener: ein einzelner Klick zyklisiert den Modus genau einmal, auch nach mehreren HUD-Renders', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    for (let i = 0; i < 4; i++) await page.evaluate(() => bkmpIdleRenderHud());
    const fxBtn = page.locator('#idleFxModeBtn');
    const before = await fxBtn.innerText();
    await fxBtn.click();
    const after = await fxBtn.innerText();
    expect(after).not.toBe(before);
    // Waere derselbe Klick-Listener mehrfach (auf mehreren, nicht wirklich entfernten Kopien)
    // registriert, haette EIN Klick den Modus mehrfach weitergeschaltet (z.B. Hoch->Aus statt
    // Hoch->Reduziert) - stattdessen exakt eine Stufe im bekannten Zyklus Hoch->Reduziert->Aus->Hoch.
    const expectedNext = { '✨ Effekte: Hoch': 'Reduziert', '🔅 Effekte: Reduziert': 'Aus', '🚫 Effekte: Aus': 'Hoch' };
    const expectedLabel = expectedNext[before];
    expect(expectedLabel).toBeTruthy();
    expect(after).toContain(expectedLabel);
  });
});

test.describe('Bug 4 - mobiles Effekte-Icon bleibt ebenfalls dauerhaft sichtbar (Teststand A, kompakte HUD)', () => {
  test.use({ teststand: 'A' });
  test.beforeEach(({}, testInfo) => {
    test.skip(!/^mobile-/.test(testInfo.project.name), 'Kompakte HUD-Vorlage (#bkmpProtoChudFxBtn) ist nur auf mobile-Projekten aktiv, siehe Testblock oben fuer Desktop (#idleFxModeBtn)');
  });

  test('#bkmpProtoChudFxBtn bleibt nach mehreren HUD-Renders sichtbar und anklickbar (eigenstaendige Architektur, nie vom selben innerHTML-Wipe-Bug betroffen, aber trotzdem als echte Absicherung geprueft)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const fxIcon = page.locator('#bkmpProtoChudFxBtn');
    await expect(fxIcon).toBeVisible();
    const box1 = await fxIcon.boundingBox();
    expect(box1.width).toBeGreaterThan(0);
    expect(box1.height).toBeGreaterThan(0);

    for (let i = 0; i < 5; i++) await page.evaluate(() => bkmpIdleRenderHud());
    await page.waitForTimeout(2000);
    await page.evaluate(() => bkmpIdleRenderHud());

    await expect(fxIcon).toBeVisible();
    await expect(fxIcon).toHaveCount(1);
    const box2 = await fxIcon.boundingBox();
    expect(box2.width).toBeGreaterThan(0);
    expect(box2.height).toBeGreaterThan(0);

    await fxIcon.click();
    const menu = page.locator('#bkmpProtoChudFxMenu');
    await expect(menu).toBeVisible();

    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflowX).toBe(false);
  });
});
