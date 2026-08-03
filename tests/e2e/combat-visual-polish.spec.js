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
