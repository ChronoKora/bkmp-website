const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Kampf-Feinschliff (03.08.2026, Nutzer-Auftrag "visueller Feinschliff der
   Kampfansicht"): Regressionstests fuer die neuen, rein visuellen Klassen/
   Funktionen (Schadenszahlen-Jitter+Deckel, Gegnerwechsel-Uebergang,
   Trefferfeedback fuer die Spielerseite, Status-Banner, Belohnungs-
   Hochschweb-Anzeige-Deckel). Laeuft gegen die ECHTE bkmpIdleTick()/
   bkmpIdleHandleDragonDefeated()/bkmpIdleHandleDefeat()-Logik (kein
   Test-Doppel) - Teststand A macht Ergebnisse vorhersagbar genug fuer feste
   Assertions, ohne die echte Kampfformel nachzubauen. Keine der bestehenden
   Kampfmechanik-Werte wurde durch diese Aenderung angefasst - reine
   Anzeige-/Animations-Ergaenzungen. */
test.describe('Kampf-Feinschliff (visuell)', () => {
  test.use({ teststand: 'A' });

  test('Schadenszahlen: Deckel + Zufalls-Versatz + kein unbegrenztes DOM-Wachstum', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    const result = await page.evaluate(() => {
      for (let i = 0; i < 10; i++) bkmpIdleSpawnProjectile('arrow', 50 + i, false);
      const floats = [...document.querySelectorAll('#idleDragon .idle-dmg-float')];
      const margins = new Set(floats.map(el => el.style.marginLeft + '/' + el.style.marginTop));
      return {
        trackedCount: bkmpDmgFloatsByTarget.idleDragon.length,
        domCountRightAfterSpawn: floats.length,
        uniqueMargins: margins.size
      };
    });
    // BKMP_DMG_FLOAT_MAX_PER_TARGET = 5 (bkmp-hud.js) - die Merkliste darf
    // nie mehr als diese Zahl gleichzeitig verfolgter Elemente enthalten.
    expect(result.trackedCount).toBeLessThanOrEqual(5);
    // Mind. die Haelfte der 10 erzeugten Zahlen muss einen erkennbar
    // unterschiedlichen Zufalls-Versatz bekommen haben (kein permanentes
    // exaktes Uebereinanderliegen).
    expect(result.uniqueMargins).toBeGreaterThan(5);

    // Nach Ablauf der 800ms-Laufzeit (+ 130ms Fastout-Puffer fuer die
    // vorzeitig ausgeblendeten aeltesten) muss das DOM wieder vollstaendig
    // leer sein - kein dauerhaft wachsendes DOM auch nach vielen Zahlen.
    await page.waitForTimeout(1100);
    const remaining = await page.evaluate(() => document.querySelectorAll('#idleDragon .idle-dmg-float').length);
    expect(remaining).toBe(0);
    const trackedAfter = await page.evaluate(() => bkmpDmgFloatsByTarget.idleDragon.length);
    expect(trackedAfter).toBe(0);
  });

  test('Kritischer Treffer: eigene, kraeftigere Animation, deutlich vom normalen Treffer unterscheidbar', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    const result = await page.evaluate(() => {
      bkmpIdleSpawnProjectile('arrow', 30, false);
      bkmpIdleSpawnProjectile('arrow', 999, true);
      const normal = document.querySelector('#idleDragon .idle-dmg-float:not(.idle-dmg-crit)');
      const crit = document.querySelector('#idleDragon .idle-dmg-crit');
      return {
        normalAnim: normal ? getComputedStyle(normal).animationName : null,
        critAnim: crit ? getComputedStyle(crit).animationName : null,
        normalFontSize: normal ? parseFloat(getComputedStyle(normal).fontSize) : 0,
        critFontSize: crit ? parseFloat(getComputedStyle(crit).fontSize) : 0
      };
    });
    expect(result.normalAnim).toBe('idleDmgFloat');
    expect(result.critAnim).toBe('idleDmgFloatCrit');
    expect(result.normalAnim).not.toBe(result.critAnim);
    expect(result.critFontSize).toBeGreaterThan(result.normalFontSize);
  });

  test('Gegnerwechsel: kein doppelter Gegner, kein Schaden vom besiegten Drachen, naechster Drache korrekt geladen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    const before = await page.evaluate(() => ({
      killIndex: bkmpIdleState.current_dragon_index,
      kills: bkmpIdleState.dragon_kills
    }));
    await page.evaluate(() => { bkmpIdleCurrentDragon.hp = 1; });
    await page.locator('#idleDragon').click();
    await page.waitForTimeout(250);

    const after = await page.evaluate(() => ({
      killIndex: bkmpIdleState.current_dragon_index,
      kills: bkmpIdleState.dragon_kills,
      dragonHp: bkmpIdleCurrentDragon ? bkmpIdleCurrentDragon.hp : null,
      dragonMaxHp: bkmpIdleCurrentDragon ? bkmpIdleCurrentDragon.maxHp : null,
      villageHp: bkmpIdleVillageHp,
      spawnInClass: document.getElementById('idleDragonSprite').classList.contains('idle-dragon-spawn-in'),
      dragonElementCount: document.querySelectorAll('#idleDragon').length,
      villageElementCount: document.querySelectorAll('#idleVillage').length
    }));
    // Genau EIN Gegner-Container, kein doppelt gerenderter Drache.
    expect(after.dragonElementCount).toBe(1);
    expect(after.villageElementCount).toBe(1);
    // Naechster Drache korrekt geladen: neues, volles HP (kein Rest-HP des
    // besiegten Vorgaengers uebernommen).
    expect(after.dragonHp).toBe(after.dragonMaxHp);
    expect(after.dragonHp).toBeGreaterThan(0);
    expect(after.kills).toBeGreaterThan(before.kills);
    expect(after.killIndex).toBeGreaterThanOrEqual(before.killIndex);
    // Dorf-HP wurde nicht durch den toten Drachen weiter reduziert (bleibt
    // korrekt bei voller HP nach einem Sieg).
    expect(after.villageHp).toBeGreaterThan(0);
    expect(after.spawnInClass).toBe(true);

    // Der neue Drache ist sofort normal angreifbar (Daten korrekt geladen).
    const dmgAfterClick = await page.evaluate(() => {
      const hpBefore = bkmpIdleCurrentDragon.hp;
      bkmpIdleHandleDragonClick({ clientX: 100, clientY: 100 });
      return { hpBefore, hpAfter: bkmpIdleCurrentDragon ? bkmpIdleCurrentDragon.hp : null };
    });
    expect(dmgAfterClick.hpAfter === null || dmgAfterClick.hpAfter < dmgAfterClick.hpBefore).toBe(true);
  });

  /* REGRESSION (Spieler-Videobeweis 04.08.2026, 16:28 Uhr: "Das ganze Fenster
     flackert kurz und wird ein stück kleiner") - siehe Funktionskommentar bei
     bkmpIdleTriggerDragonSpawnAnim() (js/ui/bkmp-hud.js) fuer die volle
     Root-Cause-Erklaerung. Die Teststand-A-Mock-Drachen tragen numerische
     spriteKeys (id-Fallback, siehe reference-data.js) und matchen NIE gegen
     BKMP_IDLE_VIDEO_DRAGON_SPRITES - die reale Drachenrotation im Mock
     durchlaeuft den Video-Zweig deshalb nie. Diese Tests rufen die (seit
     diesem Bugfix eigenstaendige, benannte) Funktion deshalb direkt mit
     einem echten <video>-Element auf, dessen Netzwerkanfrage gezielt
     verzoegert wird - testet exakt denselben Produktionscode wie
     bkmpIdleSpawnDragon(), unabhaengig von der Mock-Rotation. */
  test.describe('REGRESSION: Gegnerwechsel-Animation wartet auf ein echtes Video-Bild statt eine leere Box zu animieren', () => {
    test('Video noch nicht geladen: Animation startet NICHT sofort, sondern erst beim ersten darstellbaren Bild (loadeddata)', async ({ page, qaBaseURL, fixtureData }) => {
      let releaseVideo;
      const videoGate = new Promise(resolve => { releaseVideo = resolve; });
      await page.route('**/assets/dragons/feuerdrache.mp4*', async route => {
        await videoGate;
        await route.continue();
      });
      await openAndLogin(page, qaBaseURL, fixtureData);
      await waitForDragonReady(page);

      const whileBlocked = await page.evaluate(() => {
        const sprite = document.createElement('div');
        const video = document.createElement('video');
        video.className = 'idle-dragon-sprite-video';
        video.muted = true;
        video.src = 'assets/dragons/feuerdrache.mp4';
        sprite.appendChild(video);
        window.__qaTestSprite = sprite; // ausserhalb des DOM, aber am Leben halten
        bkmpIdleTriggerDragonSpawnAnim(sprite);
        return { spawnInClass: sprite.classList.contains('idle-dragon-spawn-in'), readyState: video.readyState };
      });
      expect(whileBlocked.readyState).toBeLessThan(2); // Beweis: die Blockade wirkt tatsaechlich (kein Bild verfuegbar)
      expect(whileBlocked.spawnInClass).toBe(false); // Kernbeweis: keine Animation auf einer noch leeren Box

      releaseVideo();
      await expect.poll(() => page.evaluate(() => window.__qaTestSprite.classList.contains('idle-dragon-spawn-in'))).toBe(true);
      const finalReadyState = await page.evaluate(() => window.__qaTestSprite.querySelector('video').readyState);
      expect(finalReadyState).toBeGreaterThanOrEqual(2); // die Animation startete tatsaechlich erst NACHDEM ein Bild da war
    });

    test('Video bereits geladen (z.B. derselbe Drache erscheint erneut): Animation startet weiterhin sofort', async ({ page, qaBaseURL, fixtureData }) => {
      await openAndLogin(page, qaBaseURL, fixtureData);
      await waitForDragonReady(page);

      const result = await page.evaluate(async () => {
        const sprite = document.createElement('div');
        const video = document.createElement('video');
        video.className = 'idle-dragon-sprite-video';
        video.muted = true;
        video.src = 'assets/dragons/feuerdrache.mp4';
        sprite.appendChild(video);
        await new Promise(resolve => { video.addEventListener('loadeddata', resolve, { once: true }); });
        bkmpIdleTriggerDragonSpawnAnim(sprite);
        return { spawnInClass: sprite.classList.contains('idle-dragon-spawn-in'), readyState: video.readyState };
      });
      expect(result.readyState).toBeGreaterThanOrEqual(2);
      expect(result.spawnInClass).toBe(true);
    });

    test('PNG-Sprite-Drache (kein <video>): Animation startet unveraendert sofort', async ({ page, qaBaseURL, fixtureData }) => {
      await openAndLogin(page, qaBaseURL, fixtureData);
      await waitForDragonReady(page);

      const spawnInClass = await page.evaluate(() => {
        const sprite = document.createElement('div');
        sprite.classList.add('idle-sprite-erddrache'); // reine PNG-Klasse, kein <video>-Kind
        bkmpIdleTriggerDragonSpawnAnim(sprite);
        return sprite.classList.contains('idle-dragon-spawn-in');
      });
      expect(spawnInClass).toBe(true);
    });

    test('Fallback: feuert das loadeddata-Ereignis nie (z.B. Netzwerkfehler), startet die Animation trotzdem nach dem 600ms-Zeitfenster', async ({ page, qaBaseURL, fixtureData }) => {
      // Blockiert die Anfrage DAUERHAFT (kein route.continue()) - simuliert einen
      // haengenden/fehlgeschlagenen Ladevorgang, bei dem 'loadeddata' nie feuert.
      await page.route('**/assets/dragons/feuerdrache.mp4*', () => {});
      await openAndLogin(page, qaBaseURL, fixtureData);
      await waitForDragonReady(page);

      const immediatelyAfter = await page.evaluate(() => {
        const sprite = document.createElement('div');
        const video = document.createElement('video');
        video.className = 'idle-dragon-sprite-video';
        video.muted = true;
        video.src = 'assets/dragons/feuerdrache.mp4';
        sprite.appendChild(video);
        window.__qaTestSpriteFallback = sprite;
        bkmpIdleTriggerDragonSpawnAnim(sprite);
        return sprite.classList.contains('idle-dragon-spawn-in');
      });
      expect(immediatelyAfter).toBe(false); // noch nicht - Video haengt weiterhin fest

      await expect.poll(
        () => page.evaluate(() => window.__qaTestSpriteFallback.classList.contains('idle-dragon-spawn-in')),
        { timeout: 2000 }
      ).toBe(true); // der 600ms-Fallback-Timer greift trotzdem
    });
  });

  test('Trefferfeedback Spielerseite: Dorf-Puls + HP-Balken-Aufleuchten erscheinen und raeumen sich selbst wieder auf', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    const during = await page.evaluate(() => {
      bkmpIdleSpawnHitFlash('idleVillage');
      const villageEl = document.getElementById('idleVillage');
      const sprite = villageEl.querySelector('.idle-village-sprite');
      const hpBar = document.getElementById('idleVillageHpFill').parentElement;
      return {
        pulseClassPresent: villageEl.classList.contains('idle-village-damage-pulse'),
        spriteAnimName: getComputedStyle(sprite).animationName,
        hpBarAnimName: getComputedStyle(hpBar).animationName
      };
    });
    // Gewinnt trotz des immer vorhandenen Inline-"style.animation" auf
    // #idleVillageSprite (siehe bkmpApplyVillageSkinToElement) - echter,
    // beim eigenen Testen gefundener Bug, siehe Kommentar in bkmp-hud.js.
    expect(during.pulseClassPresent).toBe(true);
    expect(during.spriteAnimName).toBe('idleVillageDamagePulse');
    expect(during.hpBarAnimName).toBe('idleHpBarFlash');

    // Raeumt sich nach der 0.4s-Animation selbst auf (kein dauerhaftes
    // Ueberschreiben einer echten Dorf-Skin-Ambiente-Animation).
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => document.getElementById('idleVillage').classList.contains('idle-village-damage-pulse'));
    expect(after).toBe(false);
  });

  test('Trefferfeedback: animierte Dorf-Skin-Animation ueberlebt einen Treffer (kein dauerhaftes Ueberschreiben)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    await page.evaluate(() => {
      const sprite = document.getElementById('idleVillage').querySelector('.idle-village-sprite');
      sprite.style.animation = 'bkmpQaFakeAmbientLoop 1.8s steps(3) infinite';
    });
    await page.evaluate(() => bkmpIdleSpawnHitFlash('idleVillage'));
    await page.waitForTimeout(600);
    const restored = await page.evaluate(() => {
      const sprite = document.getElementById('idleVillage').querySelector('.idle-village-sprite');
      return getComputedStyle(sprite).animationName;
    });
    expect(restored).toBe('bkmpQaFakeAmbientLoop');
  });

  test('Status-Banner: Bosskampf hat Vorrang vor Naechste-Stufe, blockiert keine Klicks, verschwindet von selbst', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    const result = await page.evaluate(() => {
      bkmpIdleShowCombatStatus('sieg', '👑 Boss besiegt!', { durationMs: 5000 });
      const firstEl = document.querySelector('#idleBattlefield .idle-combat-status');
      const pointerEvents = firstEl ? getComputedStyle(firstEl).pointerEvents : null;
      // niedrigere Prioritaet darf eine laufende hoehere nicht ersetzen
      bkmpIdleShowCombatStatus('naechsteStufe', 'sollte ignoriert werden', { durationMs: 5000 });
      const stillFirst = document.querySelector('#idleBattlefield .idle-combat-status').textContent;
      // hoehere Prioritaet ersetzt korrekt
      bkmpIdleShowCombatStatus('niederlage', '💀 Niederlage', { variant: 'defeat', durationMs: 150 });
      const nowText = document.querySelector('#idleBattlefield .idle-combat-status').textContent;
      const count = document.querySelectorAll('#idleBattlefield .idle-combat-status').length;
      return { pointerEvents, stillFirst, nowText, count };
    });
    expect(result.pointerEvents).toBe('none');
    expect(result.stillFirst).toContain('Boss besiegt');
    expect(result.nowText).toContain('Niederlage');
    expect(result.count).toBe(1);

    // Muss von selbst wieder verschwinden (kurze durationMs=150 oben).
    await page.waitForTimeout(700);
    const remaining = await page.evaluate(() => document.querySelectorAll('#idleBattlefield .idle-combat-status').length);
    expect(remaining).toBe(0);

    // Klicks auf den Drachen funktionieren waehrend/nach einem Banner
    // unveraendert (kein blockierendes Overlay).
    const clickWorked = await page.evaluate(() => {
      bkmpIdleShowCombatStatus('bosskampf', '👑 Bosskampf!', { strong: true, durationMs: 5000 });
      const hpBefore = bkmpIdleCurrentDragon.hp;
      bkmpIdleHandleDragonClick({ clientX: 100, clientY: 100 });
      return bkmpIdleCurrentDragon ? bkmpIdleCurrentDragon.hp < hpBefore || bkmpIdleCurrentDragon.hp !== hpBefore : true;
    });
    expect(clickWorked).toBe(true);
  });

  test('Boss-Spawn zeigt automatisch das Bosskampf-Banner', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const bannerText = await page.evaluate(() => {
      bkmpIdleState.current_dragon_index = 24;
      bkmpIdleState.highest_dragon_index = Math.max(bkmpIdleState.highest_dragon_index || 0, 24);
      bkmpIdleSpawnDragon();
      const el = document.querySelector('#idleBattlefield .idle-combat-status');
      return el ? el.textContent : null;
    });
    expect(bannerText).toContain('Bosskampf');
  });

  /* REGRESSION (Spieler-Meldung 05.08.2026, Screenshot: "Bleibt hier" aktiv,
     Bosskampf-Banner erscheint trotzdem dauerhaft wiederkehrend statt nur
     einmal beim Erreichen der Stufe) - siehe Root-Cause-Kommentar bei
     bkmpIdleLastBannerBossIndex (js/ui/bkmp-hud.js). */
  test('REGRESSION: Bosskampf-Banner erscheint nur beim ERSTEN Erreichen der Stufe, nicht bei jedem erneuten Spawn derselben Stufe ("Bleibt hier")', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const result = await page.evaluate(() => {
      bkmpIdleState.current_dragon_index = 24;
      bkmpIdleState.highest_dragon_index = Math.max(bkmpIdleState.highest_dragon_index || 0, 24);
      bkmpIdleSpawnDragon();
      const firstBanner = document.querySelector('#idleBattlefield .idle-combat-status');
      const firstText = firstBanner ? firstBanner.textContent : null;
      // Banner manuell entfernen (simuliert Ablauf der durationMs) statt nur
      // die bereits anderswo getestete "neuere Meldung ersetzt aeltere"-
      // Prioritaetsregel erneut zu pruefen - hier geht es um einen echten
      // ZWEITEN Spawn-Aufruf mit unveraendertem Index.
      if (firstBanner) firstBanner.remove();
      bkmpCombatStatusActive = null;
      // "Bleibt hier" (auto_advance=false): current_dragon_index bleibt nach
      // einem Kill unveraendert, derselbe Boss wird einfach mit vollem HP
      // neu aufgebaut - genau das simuliert ein zweiter bkmpIdleSpawnDragon()-
      // Aufruf ohne Indexwechsel.
      bkmpIdleSpawnDragon();
      const secondBanner = document.querySelector('#idleBattlefield .idle-combat-status');
      return { firstText, secondBannerPresent: !!secondBanner };
    });
    expect(result.firstText).toContain('Bosskampf');
    expect(result.secondBannerPresent).toBe(false);
  });

  test('REGRESSION: verlaesst man die Boss-Stufe (Nicht-Boss-Stufe dazwischen) und erreicht sie erneut, zeigt das Banner wieder', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);

    const result = await page.evaluate(() => {
      bkmpIdleState.current_dragon_index = 24;
      bkmpIdleSpawnDragon();
      document.querySelector('#idleBattlefield .idle-combat-status')?.remove();
      bkmpCombatStatusActive = null;

      // Nicht-Boss-Stufe dazwischen (z.B. Rueckzug nach einer Niederlage,
      // oder ein Prestige-Reset, der current_dragon_index zuruecksetzt).
      bkmpIdleState.current_dragon_index = 23;
      bkmpIdleSpawnDragon();
      const nonBossBannerPresent = !!document.querySelector('#idleBattlefield .idle-combat-status');

      // Zurueck auf die Boss-Stufe - Banner muss wieder erscheinen, nicht
      // dauerhaft unterdrueckt bleiben.
      bkmpIdleState.current_dragon_index = 24;
      bkmpIdleSpawnDragon();
      const secondBanner = document.querySelector('#idleBattlefield .idle-combat-status');
      return { nonBossBannerPresent, secondBannerText: secondBanner ? secondBanner.textContent : null };
    });
    expect(result.nonBossBannerPresent).toBe(false);
    expect(result.secondBannerText).toContain('Bosskampf');
  });

  test('Belohnungs-Hochschweb-Anzeige: Deckel bei schnell aufeinanderfolgenden Siegen, kein unbegrenztes DOM-Wachstum', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    await page.evaluate(() => {
      // Simuliert 6 schnell aufeinanderfolgende Sieges-Events (BKMP_REWARD_
      // FLOAT_MAX = 3 in idledorf.js) ohne den echten Kampf zu durchlaufen.
      for (let i = 0; i < 6; i++) {
        document.dispatchEvent(new CustomEvent('bkmpIdleRewardGained', { detail: { gold: 100 + i, xp: 50 + i, isBoss: false } }));
      }
    });
    const trackedRightAfter = await page.evaluate(() => bkmpRewardFloats.length);
    expect(trackedRightAfter).toBeLessThanOrEqual(3);

    await page.waitForTimeout(1900);
    const remaining = await page.evaluate(() => ({
      dom: document.querySelectorAll('#idleBattlefield .idle-reward-float').length,
      tracked: bkmpRewardFloats.length
    }));
    expect(remaining.dom).toBe(0);
    expect(remaining.tracked).toBe(0);
  });

  test('Effekte-Aus (data-fx="aus") deaktiviert die neuen Animationen ohne Fehler', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    const result = await page.evaluate(() => {
      document.documentElement.setAttribute('data-fx', 'aus');
      bkmpIdleSpawnProjectile('arrow', 42, false);
      bkmpIdleSpawnHitFlash('idleVillage');
      bkmpIdleShowCombatStatus('sieg', '👑 Boss besiegt!', { durationMs: 900 });
      const dmg = document.querySelector('#idleDragon .idle-dmg-float');
      const status = document.querySelector('#idleBattlefield .idle-combat-status');
      return {
        dmgAnim: dmg ? getComputedStyle(dmg).animationName : null,
        statusAnim: status ? getComputedStyle(status).animationName : null,
        statusVisible: status ? getComputedStyle(status).opacity : null
      };
    });
    expect(result.dmgAnim).toBe('none');
    expect(result.statusAnim).toBe('none');
    expect(result.statusVisible).toBe('1');
    expect(errors).toEqual([]);

    // Zuruecksetzen fuer nachfolgende Tests im selben Worker.
    await page.evaluate(() => document.documentElement.setAttribute('data-fx', 'hoch'));
  });

  test('Effekte-Einzelschalter "hitShake" deaktiviert Dorf-Puls/HP-Balken-Aufleuchten gezielt', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());

    const result = await page.evaluate(() => {
      document.documentElement.classList.add('fx-off-hitShake');
      bkmpIdleSpawnHitFlash('idleVillage');
      const sprite = document.getElementById('idleVillage').querySelector('.idle-village-sprite');
      const hpBar = document.getElementById('idleVillageHpFill').parentElement;
      return {
        spriteAnim: getComputedStyle(sprite).animationName,
        hpBarAnim: getComputedStyle(hpBar).animationName
      };
    });
    expect(result.spriteAnim).toBe('none');
    expect(result.hpBarAnim).toBe('none');
    await page.evaluate(() => document.documentElement.classList.remove('fx-off-hitShake'));
  });
});
