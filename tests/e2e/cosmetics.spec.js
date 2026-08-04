const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');
const { invokeRedeemPlushieCodeHandler } = require('../mock/redeem-plushie-code-handler');

/* Phase 6 (25.07.2026) - Kosmetiksystem. Drei architektonisch komplett
   getrennte Teilsysteme, alle unter dem Sammelbegriff "Kosmetik":

   1) DORF-SKINS (idle_village_skins/idle_player_village_skins, echte
      Supabase-Tabellen, js/systems/bkmp-cosmetics.js) - Katalog oeffentlich
      lesbar, Besitz-Zeilen laufen client-seitig wie Runen/Upgrades (kein
      Kauf-RPC), aktive Auswahl liegt NUR in localStorage
      ('bkmp-active-village-skin', UNSCOPED - device-weit, nicht konto-
      gebunden) + wird zusaetzlich (seit 14.07.) nach bkmpIdleState.
      active_village_skin gespiegelt und normal mitgesynct (fuer die Arena-
      Animation, die den Skin eines ANDEREN Spielers zeigen koennen muss).

   2) IDLE-DORF-TITEL (window.BKMP_IDLE_TITLES, reine Stat-Boni, KEINE
      Kauf-/Ausruest-Mechanik) - sticky ueber bkmpIdleTitleUnlockedSticky(),
      liegt SERVERSEITIG in bkmpIdleState.titles_unlocked_at (upsert wie der
      Rest des Spielstands) + localStorage-Fast-Cache - anders als Erfolge
      (nur localStorage) uebersteht das also auch einen Geraetewechsel.
      Sichtbar im Idle-Dorf-eigenen "Erfolge"-Tab (bkmpIdleBuildTitleBonusListHtml).

   3) IDLE-DORF-KOSMETIKEN (window.BKMP_IDLE_COSMETICS, reine Namens-Farbver-
      laeufe, gleiches Sticky-Prinzip wie Titel ueber cosmetics_unlocked_at)
      - nur im SEITENWEITEN Kosmetik-Tab sichtbar (#cosmeticsList,
      renderCosmeticsPanel in js/core/bkmp-site.js), nicht im Idle-Dorf-Fenster
      selbst gerendert.

   4) CODE-EINLOESUNG (api/redeem-plushie-code.js, reward_kind='village_skin',
      seit 23.07. - siehe CLAUDE.md, SQL noch nicht live ausgefuehrt) - echter
      serverseitiger Handler, hier per invokeRedeemPlushieCodeHandler() 1:1
      in-process gegen den Mock aufgerufen (gleiche Technik wie
      offline-progress-handler.js), KEINE zweite Kopie der Kauf-/Ownership-
      Pruefung. */

/* Bugfix-Durchlauf 25.07.2026 (npm run qa:full auf allen 3 Projekten zeigte
   16 Fehlschlaege auf mobile-small/mobile-large): openSkinsPanel/openErfolgeTab
   klicken echte Desktop-Tab-Buttons (#idleTabBtnSkins/#idleTabBtnErfolge) -
   auf mobile-Breiten sind die per kompakter Navigation unsichtbar (identisches,
   bereits in tower.spec.js/runes.spec.js/etc. dokumentiertes Muster, siehe
   dortiger Kommentar). Reiner Testinfrastruktur-Fund, kein App-Bug - bewusst
   NUR fuer die betroffenen describe-Bloecke unten (Dorf-Skins/Idle-Dorf-Titel),
   NICHT dateiweit: die Kosmetik-Tab-Tests (openCosmeticsSubtab, nutzt das
   seitenweite #mcNameBadge) und die Code-Einloesungs-Tests (keine UI-
   Navigation) liefen auf mobile schon vorher fehlerfrei und sollen es bleiben. */
/* test.skip() innerhalb eines laufenden Tests wirkt auf GENAU diesen Test,
   ohne testInfo als Parameter durchreichen zu muessen (Playwright-API).
   Viewport-Breite statt Projektname geprueft - robuster (trifft exakt die
   reale Layout-Bedingung, matchMedia(max-width:760px), unabhaengig davon,
   wie ein Projekt in playwright.config.js gerade benannt ist). */
function skipIfMobileViewport(page) {
  const size = page.viewportSize();
  test.skip(!!size && size.width <= 760, 'Nutzt echte Desktop-Tab-Klicks (#idleTabBtnSkins/#idleTabBtnErfolge) - auf mobile-Breiten (<=760px) sind die per kompakter Navigation unsichtbar, siehe Kommentar oben');
}

async function openSkinsPanel(page) {
  skipIfMobileViewport(page);
  const closeBtn = page.locator('#idleDorfCloseX');
  const overlay = page.locator('#idleDorfOverlay');
  if (!(await overlay.isVisible().catch(() => false))) {
    await page.locator('#idleDorfButton').click();
    await waitForDragonReady(page);
  }
  await page.locator('#idleTabBtnSkins').click();
  await expect(page.locator('#idlePanelSkins')).toBeVisible();
}

async function openErfolgeTab(page) {
  skipIfMobileViewport(page);
  const overlay = page.locator('#idleDorfOverlay');
  if (!(await overlay.isVisible().catch(() => false))) {
    await page.locator('#idleDorfButton').click();
    await waitForDragonReady(page);
  }
  await page.locator('#idleTabBtnErfolge').click();
  await expect(page.locator('#idlePanelErfolge')).toBeVisible();
}

/* #cosmeticsList lebt im seitenweiten #achievementsOverlay, nicht im
   Idle-Dorf-Fenster - gleiches Ueberdeckungsproblem/gleicher Fix wie in
   achievements.spec.js dokumentiert (openAchievementsPanel dort). */
async function openCosmeticsSubtab(page) {
  const closeBtn = page.locator('#idleDorfCloseX');
  if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();
  await page.locator('#mcNameBadge').click();
  await expect(page.locator('#achievementsOverlay')).toHaveClass(/visible/, { timeout: 10000 });
  await page.locator('#achievementsSubtabCosmetics').click();
  await page.evaluate(() => renderCosmeticsPanel());
}

test.describe('Dorf-Skins - Katalog & Besitzstatus (Teststand A, frischer Spieler)', () => {
  test.use({ teststand: 'A' });

  test('Katalog laedt alle 7 Referenz-Skins, Standarddorf ist trotz leerer Besitz-Tabelle sofort "besessen"', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);
    const state = await page.evaluate(() => ({
      catalogLen: bkmpVillageSkinsCatalog.length,
      owned: bkmpPlayerVillageSkins.slice(),
      standardOwned: bkmpVillageSkinOwned('standard')
    }));
    expect(state.catalogLen).toBe(7);
    expect(state.owned).toEqual([]);
    expect(state.standardOwned).toBe(true);
  });

  test('jeder unlock_type rendert die richtige Aktion: frei=ausgeruestet, kaufbar=Kaufen-Button, achievement/boss_drop/code=Schloss-Hinweis, real_money=deaktiviert (Feature-Flag aus)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);
    const html = await page.locator('#idlePanelSkins').innerHTML();
    // standard: bereits ausgeruestet (einziger von Anfang an besessener Skin)
    expect(html).toMatch(/Standarddorf[\s\S]*?Ausgerüstet/);
    // eisdorf/pilzdorf: unlock_type purchase -> Kaufen-Button mit Preis
    expect(html).toContain('idle-skin-buy" data-skin-id="eisdorf"');
    expect(html).toContain('idle-skin-buy" data-skin-id="pilzdorf"');
    // zerstoertesdorf/yakshasheimat: unlock_type achievement/boss_drop -> generischer Schloss-Hinweis, KEIN Kauf-Button.
    // Muss speziell auf "idle-skin-buy" pruefen (nicht nur die rohe data-skin-id) - seit der
    // Vorschau-Kachel (04.08.2026) traegt JEDE Karte ein data-skin-id-Attribut, unabhaengig
    // vom unlock_type (siehe Test-Block "Live-Vorschau" weiter unten).
    expect(html).not.toContain('idle-skin-buy" data-skin-id="zerstoertesdorf"');
    expect(html).not.toContain('idle-skin-buy" data-skin-id="yakshasheimat"');
    expect(html).toContain('15.000x gegen Drachen verloren');
    expect(html).toContain('50.000x den Boss Yaksha besiegen');
    // kallejuniordorf: unlock_type code -> ebenfalls generischer Schloss-Hinweis (bestaetigt CLAUDE.md:
    // "keine Aenderung noetig" - der generische Locked-Zweig faengt jeden nicht purchase/real_money-Fall ab)
    expect(html).toContain('Nur per Einlöse-Code erhältlich.');
    // steampunkdorf: unlock_type real_money, BKMP_REAL_MONEY_PURCHASES_ENABLED === false -> deaktivierter Button, kein Klick moeglich
    const buyRealMoneyBtn = page.locator('.idle-skin-buy-real-money-locked[data-skin-id="steampunkdorf"]');
    await expect(buyRealMoneyBtn).toBeVisible();
    await expect(buyRealMoneyBtn).toBeDisabled();
  });

  test('achievement-/boss_drop-Skins zeigen den echten Live-Fortschritt (village_defeats/yaksha_boss_kills), nicht nur den Hinweistext', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => { bkmpIdleState.village_defeats = 4200; bkmpIdleState.yaksha_boss_kills = 17; });
    await openSkinsPanel(page);
    const html = await page.locator('#idlePanelSkins').innerHTML();
    expect(html).toContain('4.2K von 15K');
    expect(html).toContain('17 von 50K');
  });
});

test.describe('Dorf-Skins - Kauf/Ausruesten/Persistenz (Teststand B)', () => {
  test.use({ teststand: 'B' });

  test('Kauf mit ausreichend Gold: Gold wird abgezogen, Besitz-Zeile serverseitig eingefuegt, Button wechselt zu Ausruesten', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // Teststand B startet mit nur 50.000 Gold (reicht nicht fuer eisdorf/150.000) - explizit aufgestockt, damit dieser Test den Kauf-ERFOLGSPFAD prueft (der Mangel-Pfad ist der naechste Test).
    await page.evaluate(() => { bkmpIdleState.gold = 300000; });
    await openSkinsPanel(page);
    await page.evaluate(() => bkmpIdleRenderSkinsPanel());
    const goldBefore = await page.evaluate(() => bkmpIdleState.gold);
    expect(goldBefore).toBe(300000);
    await page.locator('.idle-skin-buy[data-skin-id="eisdorf"]').click();
    await expect.poll(() => page.evaluate(() => bkmpPlayerVillageSkins.includes('eisdorf'))).toBe(true);
    const goldAfter = await page.evaluate(() => bkmpIdleState.gold);
    expect(goldAfter).toBe(goldBefore - 150000);
    const serverRow = store.tables.idle_player_village_skins.find(r => r.skin_id === 'eisdorf');
    expect(serverRow).toBeTruthy();
    expect(serverRow.name_key).toBe(fixtureData.nameKey);
    await page.evaluate(() => bkmpIdleRenderSkinsPanel());
    await expect(page.locator('.idle-skin-equip[data-skin-id="eisdorf"]')).toBeVisible();
  });

  test('Kauf ohne ausreichend Gold: Button ist deaktiviert, Klick-Versuch aendert weder Gold noch Besitz', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // Teststand B startet mit 50.000 Gold, pilzdorf kostet 2.500.000 - bewusst weit unerreichbar, kein Grenzfall.
    await openSkinsPanel(page);
    const buyBtn = page.locator('.idle-skin-buy[data-skin-id="pilzdorf"]');
    await expect(buyBtn).toBeDisabled();
    const goldBefore = await page.evaluate(() => bkmpIdleState.gold);
    await page.evaluate(() => bkmpIdleBuyVillageSkin('pilzdorf')); // direkter Funktionsaufruf umgeht den deaktivierten Button - Guard muss trotzdem in der Funktion selbst greifen
    await page.waitForTimeout(200);
    const goldAfter = await page.evaluate(() => bkmpIdleState.gold);
    expect(goldAfter).toBe(goldBefore);
    expect((store.tables.idle_player_village_skins || []).find(r => r.skin_id === 'pilzdorf')).toBeFalsy();
  });

  test('Ausruesten: nur besessene Skins sind waehlbar, Auswahl landet in localStorage UND wird als active_village_skin serverseitig gesynct', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(async () => {
      await unlockPlayerVillageSkin(bkmpIdleState.name_key, 'eisdorf');
      bkmpPlayerVillageSkins.push('eisdorf');
    });
    await openSkinsPanel(page);
    await page.evaluate(() => bkmpIdleRenderSkinsPanel());
    await page.locator('.idle-skin-equip[data-skin-id="eisdorf"]').click();
    const activeId = await page.evaluate(() => bkmpGetActiveVillageSkinId());
    expect(activeId).toBe('eisdorf');
    await page.evaluate(() => bkmpIdleFlushSyncNow());
    const row = store.tables.idle_player_state.find(r => r.name_key === fixtureData.nameKey);
    expect(row.active_village_skin).toBe('eisdorf');
  });

  test('Reload: besessene Skins und aktive Auswahl ueberleben (Server-Sync + localStorage)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(async () => {
      await unlockPlayerVillageSkin(bkmpIdleState.name_key, 'eisdorf');
      bkmpPlayerVillageSkins.push('eisdorf');
      bkmpIdleEquipVillageSkin('eisdorf');
      await bkmpIdleFlushSyncNow();
    });
    await page.reload();
    // Ein Reload auf der normalen Website (kein App-Modus) oeffnet #idleDorfOverlay NICHT automatisch
    // wieder - openAndLogin()/#idleDorfButton muss nach einem Reload erneut geklickt werden (gleiches
    // Muster wie in achievements.spec.js/tower.spec.js's eigenen Reload-Tests).
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);
    const after = await page.evaluate(() => ({
      owned: bkmpPlayerVillageSkins.includes('eisdorf'),
      active: bkmpGetActiveVillageSkinId()
    }));
    expect(after.owned).toBe(true);
    expect(after.active).toBe('eisdorf');
  });
});

test.describe('Dorf-Skins - Sicherheit (Teststand A)', () => {
  test.use({ teststand: 'A' });

  test('manipulierte/nie besessene Skin-ID in localStorage faellt am echten Sprite-Element sicher auf "standard" zurueck', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    // Simuliert einen manipulierten localStorage-Eintrag (Skin nie gekauft/nie in bkmpPlayerVillageSkins).
    await page.evaluate(() => { localStorage.setItem('bkmp-active-village-skin', 'pilzdorf'); });
    const applied = await page.evaluate(() => {
      const el = document.createElement('div');
      bkmpApplyVillageSkinToElement(el, bkmpGetActiveVillageSkinId());
      // 'standard' hat sowohl image_file als auch video_file - bkmpApplyVillageSkinToElement bevorzugt
      // video_file IMMER (siehe Funktionskommentar "video_file hat ohnehin Vorrang"), das gefaelschte
      // 'pilzdorf' darf hier also weder als Hintergrundbild noch als Video-Quelle auftauchen.
      const video = el.querySelector('.idle-village-video');
      return { backgroundImage: el.style.backgroundImage, videoSrc: video ? video.dataset.src : null };
    });
    expect(applied.videoSrc).toContain('startdorf.mp4');
    expect(applied.videoSrc).not.toContain('pilzdorf');
    expect(applied.backgroundImage).not.toContain('pilzdorf');
  });

  test('Skin-Name/Beschreibung mit HTML/Script-Inhalt wird im Panel escaped gerendert (kein XSS)', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.idle_village_skins.push({
      id: 'qa-xss-skin', name: '<img src=x onerror=alert(1)>', description: '<script>window.__xss=true</script>',
      icon: '🏘️', image_file: '', video_file: '', unlock_type: 'purchase', price_gold: 100, price_crystals: 0,
      price_eur_cents: 0, unlock_hint: '', sort_order: 99, frame_count: 1, frame_aspect_w: 16, frame_aspect_h: 9, active: true
    });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);
    const html = await page.locator('#idlePanelSkins').innerHTML();
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>window.__xss=true</script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const xssFired = await page.evaluate(() => window.__xss === true);
    expect(xssFired).toBe(false);
  });
});

/* Spieler-Idee NikschiOG (04.08.2026, Feedback-Board): "Vorschau bei den
   Dorf Skins, da man sonst nicht weiß was man kauft" - kleine statische
   Vorschau-Kachel in jeder Shop-Karte (forceStatic:true, kein gleichzeitiges
   Abspielen aller sichtbaren Videos) + Klick/Enter oeffnet die vergroesserte,
   LIVE animierte Ansicht in #idleSkinPreviewOverlay (identisches Lightbox-
   Muster wie #investorPayoutViewerOverlay, 28.07.2026). Alle 7 Referenz-
   Skins (reference-data.js) haben ein gesetztes video_file - bevorzugt von
   bkmpApplyVillageSkinToElement IMMER vor image_file (siehe Sicherheits-
   Test oben) - deshalb rendert praktisch jede echte Kachel als <video>,
   nicht als Sprite-Hintergrundbild; ein eigener Test unten pusht deshalb
   einen synthetischen reinen Bild-Skin, um auch den Sprite-Zweig
   (frame_count>1, KEINE laufende steps()-Animation trotz forceStatic) zu
   pruefen. */
test.describe('Dorf-Skins - Live-Vorschau (Grid-Kachel + Lightbox, 04.08.2026)', () => {
  test.use({ teststand: 'A' });

  test('jede der 7 Karten zeigt eine Vorschau-Kachel mit korrektem Video/Hintergrund - auch fuer NICHT besessene Skins (checkOwnership:false, das ist der ganze Sinn des Features)', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);
    const thumbs = await page.evaluate(() => Array.from(document.querySelectorAll('#idlePanelSkins .idle-skin-preview-thumb')).map(el => {
      const v = el.querySelector('.idle-village-video');
      return { skinId: el.dataset.skinId, hasVideo: !!v, videoSrc: v ? v.dataset.src : null };
    }));
    expect(thumbs.length).toBe(7);
    const eisdorf = thumbs.find(t => t.skinId === 'eisdorf'); // Teststand A besitzt eisdorf NICHT
    expect(eisdorf.hasVideo).toBe(true);
    expect(eisdorf.videoSrc).toContain('eisdorf.mp4');
  });

  test('Vorschau-Kacheln spielen KEIN Video ab (forceStatic) - verhindert, dass alle sichtbaren Karten gleichzeitig 7 Videos abspielen', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);
    const paused = await page.evaluate(() => Array.from(document.querySelectorAll('#idlePanelSkins .idle-skin-preview-thumb .idle-village-video')).map(v => v.paused));
    expect(paused.length).toBe(7);
    expect(paused.every(p => p === true)).toBe(true);
  });

  test('reiner Mehrfach-Frame-Sprite-Skin (kein Video): Kachel zeigt das Hintergrundbild ohne laufende Animation', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.idle_village_skins.push({
      id: 'qa-sprite-skin', name: 'Sprite-Testdorf', description: 'Nur fuer den Test.', icon: '🧪',
      image_file: 'assets/village/qa-sprite.png', video_file: '', unlock_type: 'purchase', price_gold: 100,
      price_crystals: 0, price_eur_cents: 0, unlock_hint: '', sort_order: 99, frame_count: 4,
      frame_aspect_w: 1164, frame_aspect_h: 199, active: true
    });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);
    const thumb = page.locator('.idle-skin-preview-thumb[data-skin-id="qa-sprite-skin"]');
    // el.style.animationName statt el.style.animation - das Shorthand serialisiert beim
    // Zurücklesen alle Longhand-Defaults mit ("auto ease 0s 1 normal none running none"),
    // exakt dieselbe, bereits an anderer Stelle in diesem Projekt dokumentierte Browser-
    // Eigenheit wie bei getComputedStyle().transitionDuration (siehe CLAUDE.md, Hover-
    // Performance-Fix) - animationName ist das robuste Longhand-Feld, das genau das prueft,
    // was gemeint ist: laeuft irgendein benanntes @keyframes, oder eben keins ('none').
    const style = await thumb.evaluate(el => ({ backgroundImage: el.style.backgroundImage, animationName: el.style.animationName, hasVideo: !!el.querySelector('.idle-village-video') }));
    expect(style.backgroundImage).toContain('qa-sprite.png');
    expect(style.animationName).toBe('none'); // forceStatic: kein steps()-Loop trotz frame_count:4
    expect(style.hasVideo).toBe(false);
  });

  test('Klick auf eine Kachel oeffnet die Lightbox mit korrektem Titel/Beschreibung + startet die echte (live) Wiedergabe', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);
    await page.locator('.idle-skin-preview-thumb[data-skin-id="eisdorf"]').click();
    await expect(page.locator('#idleSkinPreviewOverlay')).toHaveClass(/visible/);
    await expect(page.locator('#idleSkinPreviewName')).toHaveText('❄️ Eis Dorf');
    await expect(page.locator('#idleSkinPreviewDesc')).toHaveText('Ein vereistes Dorf inmitten glitzernder Schnee- und Eislandschaften.');
    const stageVideo = await page.evaluate(() => {
      const v = document.querySelector('#idleSkinPreviewStage .idle-village-video');
      return v ? { src: v.dataset.src, paused: v.paused } : null;
    });
    expect(stageVideo).not.toBeNull();
    expect(stageVideo.src).toContain('eisdorf.mp4');
    expect(stageVideo.paused).toBe(false); // anders als die Grid-Kachel: hier KEIN forceStatic, echtes Abspielen wird versucht
  });

  test('nicht besessener Skin zeigt seine echte Vorschau in der Lightbox statt eines Standard-Fallbacks', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);
    const owned = await page.evaluate(() => bkmpVillageSkinOwned('pilzdorf'));
    expect(owned).toBe(false); // Teststand A besitzt nur 'standard'
    await page.locator('.idle-skin-preview-thumb[data-skin-id="pilzdorf"]').click();
    await expect(page.locator('#idleSkinPreviewName')).toHaveText('🍄 Pilzdorf');
    const stageVideoSrc = await page.evaluate(() => {
      const v = document.querySelector('#idleSkinPreviewStage .idle-village-video');
      return v ? v.dataset.src : null;
    });
    expect(stageVideoSrc).toContain('pilzdorf.mp4'); // nicht der Standard-Fallback (startdorf.mp4)
  });

  test('Schließen-Button UND Klick auf den Hintergrund (nicht auf die Karte) schließen die Lightbox wieder', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);

    await page.locator('.idle-skin-preview-thumb[data-skin-id="eisdorf"]').click();
    await expect(page.locator('#idleSkinPreviewOverlay')).toHaveClass(/visible/);
    await page.locator('#idleSkinPreviewCloseBtn').click();
    await expect(page.locator('#idleSkinPreviewOverlay')).not.toHaveClass(/visible/);
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);

    await page.locator('.idle-skin-preview-thumb[data-skin-id="eisdorf"]').click();
    await expect(page.locator('#idleSkinPreviewOverlay')).toHaveClass(/visible/);
    // Direkt auf das Overlay-Element selbst dispatcht (e.target === overlay, exakt die
    // Bedingung, die bkmpIdleOpenSkinPreview() prueft) - robuster als Koordinaten-Klicks,
    // die je nach Kartenbreite/Viewport zufaellig doch die Karte selbst treffen koennten.
    await page.locator('#idleSkinPreviewOverlay').evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await expect(page.locator('#idleSkinPreviewOverlay')).not.toHaveClass(/visible/);
  });

  test('Tastatur (Enter) auf einer fokussierten Kachel öffnet die Lightbox genau wie ein Klick', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);
    await page.locator('.idle-skin-preview-thumb[data-skin-id="eisdorf"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#idleSkinPreviewOverlay')).toHaveClass(/visible/);
    await expect(page.locator('#idleSkinPreviewName')).toHaveText('❄️ Eis Dorf');
  });

  /* REGRESSION (Spieler-Meldung 04.08.2026, Screenshot der Lightbox: "In der
     Großansicht verschwinden alle Ansichten und fangen an zu flackern") -
     bkmpIdleRefreshLiveTabsRender() ruft bkmpIdleRenderSkinsPanel() bei JEDEM
     Drachen-Kill erneut auf, solange der Dorf-Skins-Tab offen ist (idledorf.js,
     throttled auf max. alle 300ms) - ein voller innerHTML-Rebuild zerstoerte
     dabei bisher JEDES <video>-Vorschauelement und erzwang einen kompletten
     Neustart, alle ~0,9-2,5s waehrend im Hintergrund weitergekaempft wird -
     sichtbar als Flackern/Verschwinden, auch waehrend die Lightbox offen war
     (die Karten dahinter blitzten sichtbar durch). Direkter DOM-Knoten-
     Identitaetsvergleich (nicht nur ein CSS-Selektor-Treffer) beweist, dass
     dieselbe Kachel-Node (inkl. ihrem <video>-Kind) mehrere aufeinander-
     folgende Renders unveraendert ueberlebt - identisches Beweismuster wie
     bereits in panel-render-hover-guard.spec.js (26.07.) fuer ein verwandtes
     Problem etabliert. */
  test('REGRESSION: wiederholte Panel-Renders (simuliert den Live-Tick-Rebuild bei jedem Drachen-Kill) zerstören/erneuern die Vorschau-Kacheln NICHT', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);

    const result = await page.evaluate(() => {
      const panel = document.getElementById('idlePanelSkins');
      const thumbsBefore = Array.from(panel.querySelectorAll('.idle-skin-preview-thumb'));
      thumbsBefore.forEach((t, i) => { t.dataset.qaIdentity = 'marker-' + i; });

      // Fünf aufeinanderfolgende Renders - exakt das, was bkmpIdleRefreshLiveTabsRender()
      // bei fünf schnell aufeinanderfolgenden Drachen-Kills auslösen würde.
      for (let i = 0; i < 5; i++) bkmpIdleRenderSkinsPanel();

      const thumbsAfter = Array.from(panel.querySelectorAll('.idle-skin-preview-thumb'));
      return {
        countBefore: thumbsBefore.length,
        countAfter: thumbsAfter.length,
        allSameNode: thumbsBefore.every((t, i) => t === thumbsAfter[i]),
        allMarkersSurvived: thumbsAfter.every((t, i) => t.dataset.qaIdentity === 'marker-' + i)
      };
    });
    expect(result.countBefore).toBe(7);
    expect(result.countAfter).toBe(7);
    expect(result.allSameNode).toBe(true);
    expect(result.allMarkersSurvived).toBe(true);
  });

  test('REGRESSION: ein waehrend der Sitzung neu zum Katalog hinzugekommener Skin bekommt trotzdem eine korrekt initialisierte Kachel', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openSkinsPanel(page);
    // Erster Render bereits durch openSkinsPanel() geschehen - Katalog danach erweitern
    // (simuliert z.B. einen frisch live nachgeladenen Skin) und erneut rendern.
    const freshThumb = await page.evaluate(() => {
      bkmpVillageSkinsCatalog.push({
        id: 'qa-fresh-mid-session', name: 'Frischer Testskin', description: 'Neu.', icon: '🆕',
        unlock_type: 'purchase', price_gold: 1, price_crystals: 0, image_file: '',
        video_file: 'assets/village/pilzdorf.mp4', frame_count: 1, frame_aspect_w: 16, frame_aspect_h: 9, active: true
      });
      bkmpIdleRenderSkinsPanel();
      const thumb = document.querySelector('.idle-skin-preview-thumb[data-skin-id="qa-fresh-mid-session"]');
      const video = thumb ? thumb.querySelector('.idle-village-video') : null;
      return { exists: !!thumb, videoSrc: video ? video.dataset.src : null };
    });
    expect(freshThumb.exists).toBe(true);
    expect(freshThumb.videoSrc).toContain('pilzdorf.mp4');
  });
});

test.describe('Idle-Dorf-Titel (BKMP_IDLE_TITLES, sticky ueber bkmpIdleState.titles_unlocked_at)', () => {
  test.use({ teststand: 'A' });

  test('frischer Spieler: kein Titel freigeschaltet, Boni-Summe leer', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const ctx = await page.evaluate(() => bkmpIdleGetAchievementContextFields());
    expect(ctx.idleDragonKills).toBe(0);
    await openErfolgeTab(page);
    const html = await page.locator('#idlePanelErfolge').innerHTML();
    expect(html).toContain('0/'); // "0/N" Zaehler in der Ueberschrift
    expect(html).not.toContain('class="achievement-row unlocked"');
  });

  test('genau bei dragon_kills=1 schaltet "Erster Drache" (idletitle_dragon_1) frei, Bonus-Summe enthaelt +1% Gold', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => { bkmpIdleState.dragon_kills = 1; });
    const result = await page.evaluate(() => {
      const ctx = bkmpIdleGetAchievementContextFields();
      const title = window.BKMP_IDLE_TITLES.find(t => t.id === 'idletitle_dragon_1');
      const unlocked = bkmpIdleTitleUnlockedSticky(title, ctx);
      const totals = bkmpIdleTitleEffectTotals(ctx);
      return { unlocked, goldProdPct: totals.gold_prod_pct || 0 };
    });
    expect(result.unlocked).toBe(true);
    expect(result.goldProdPct).toBe(1);
  });

  test('Sticky ueberlebt einen Ruecksetzung-aehnlichen Rueckgang (z.B. Prestige) - einmal freigeschaltet bleibt freigeschaltet', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => {
      bkmpIdleState.dragon_kills = 25;
      const ctx = bkmpIdleGetAchievementContextFields();
      const title = window.BKMP_IDLE_TITLES.find(t => t.id === 'idletitle_dragon_25');
      bkmpIdleTitleUnlockedSticky(title, ctx); // erster Aufruf schreibt den Sticky-Zeitstempel
      bkmpIdleState.dragon_kills = 0; // simulierter Prestige-Reset
    });
    const stillUnlocked = await page.evaluate(() => {
      const ctx = bkmpIdleGetAchievementContextFields();
      const title = window.BKMP_IDLE_TITLES.find(t => t.id === 'idletitle_dragon_25');
      return bkmpIdleTitleUnlockedSticky(title, ctx);
    });
    expect(stillUnlocked).toBe(true);
  });

  test('Reload: Sticky-Freischaltung uebersteht den Reload UNVERAENDERT, weil sie serverseitig in idle_player_state.titles_unlocked_at liegt (nicht nur localStorage wie bei Erfolgen)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(async () => {
      bkmpIdleState.dragon_kills = 5;
      const ctx = bkmpIdleGetAchievementContextFields();
      const title = window.BKMP_IDLE_TITLES.find(t => t.id === 'idletitle_dragon_5');
      bkmpIdleTitleUnlockedSticky(title, ctx);
      await bkmpIdleFlushSyncNow();
    });
    const serverRow = store.tables.idle_player_state.find(r => r.name_key === fixtureData.nameKey);
    expect(serverRow.titles_unlocked_at && serverRow.titles_unlocked_at.idletitle_dragon_5).toBeTruthy();
    // Beweist, dass der Server-Wert (nicht nur der lokale Fast-Cache) den Reload traegt: eigener Browser-Kontext,
    // localStorage bleibt zwar innerhalb desselben page-Objekts erhalten, aber der entscheidende Beweis ist die Server-Zeile oben.
    await page.reload();
    // Ein Reload auf der normalen Website (kein App-Modus) oeffnet #idleDorfOverlay NICHT automatisch
    // wieder - openAndLogin()/#idleDorfButton muss nach einem Reload erneut geklickt werden (gleiches
    // Muster wie in achievements.spec.js/tower.spec.js's eigenen Reload-Tests).
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);
    const stillUnlocked = await page.evaluate(() => {
      bkmpIdleState.dragon_kills = 0;
      const ctx = bkmpIdleGetAchievementContextFields();
      const title = window.BKMP_IDLE_TITLES.find(t => t.id === 'idletitle_dragon_5');
      return bkmpIdleTitleUnlockedSticky(title, ctx);
    });
    expect(stillUnlocked).toBe(true);
  });
});

test.describe('Idle-Dorf-Kosmetiken (BKMP_IDLE_COSMETICS, sticky ueber bkmpIdleState.cosmetics_unlocked_at, seitenweites Kosmetik-Tab)', () => {
  test.use({ teststand: 'A' });

  test('frischer Spieler: keine Kosmetik freigeschaltet', async ({ page, qaBaseURL, fixtureData }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await openCosmeticsSubtab(page);
    const html = await page.locator('#cosmeticsList').innerHTML();
    // 'rotgruen' braucht idleDragonKills>=20 - bei 0 Kills gesperrt: Swatch existiert, traegt "locked" + zeigt
    // "🔒" statt des echten Namens (der echte Name "Rot → Grün" darf bei gesperrtem Zustand NICHT im Markup stehen).
    expect(html).toContain('mc-cosmetic-rotgruen locked');
    expect(html).not.toContain('Rot → Grün');
    const locked = await page.evaluate(() => {
      const ctx = bkmpAchievementContextWithMeta();
      const c = BKMP_COSMETICS.find(x => x.id === 'rotgruen');
      return !bkmpIdleCosmeticUnlockedSticky(c, ctx);
    });
    expect(locked).toBe(true);
  });

  test('Schwelle exakt erreicht (idleDragonKills=20) schaltet "rotgruen" frei und uebersteht Reload ueber bkmpIdleState.cosmetics_unlocked_at', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(async () => {
      bkmpIdleState.dragon_kills = 20;
      const ctx = bkmpAchievementContextWithMeta();
      const c = BKMP_COSMETICS.find(x => x.id === 'rotgruen');
      bkmpIdleCosmeticUnlockedSticky(c, ctx);
      await bkmpIdleFlushSyncNow();
    });
    const serverRow = store.tables.idle_player_state.find(r => r.name_key === fixtureData.nameKey);
    expect(serverRow.cosmetics_unlocked_at && serverRow.cosmetics_unlocked_at.rotgruen).toBeTruthy();
    await page.reload();
    // Ein Reload auf der normalen Website (kein App-Modus) oeffnet #idleDorfOverlay NICHT automatisch
    // wieder - openAndLogin()/#idleDorfButton muss nach einem Reload erneut geklickt werden (gleiches
    // Muster wie in achievements.spec.js/tower.spec.js's eigenen Reload-Tests).
    await page.locator('#idleDorfButton').click();
    await expect(page.locator('#idleDorfOverlay')).toHaveClass(/visible/, { timeout: 15000 });
    await waitForDragonReady(page);
    const stillUnlocked = await page.evaluate(() => {
      bkmpIdleState.dragon_kills = 0;
      const ctx = bkmpAchievementContextWithMeta();
      const c = BKMP_COSMETICS.find(x => x.id === 'rotgruen');
      return bkmpIdleCosmeticUnlockedSticky(c, ctx);
    });
    expect(stillUnlocked).toBe(true);
  });
});

test.describe('Code-Einloesung (api/redeem-plushie-code.js, reward_kind="village_skin", 25.07.2026 noch nicht live-SQL)', () => {
  test.use({ teststand: 'A' });

  /* Server-seitiger Handler braucht eine echte player_stats-Zeile (Name-
     Aufloesung ueber auth_user_id) - anders als idle_player_state wird diese
     bislang von KEINEM Teststand geseedet (das Handler-Feature ist neuer als
     die Teststand-Fixtures). Minimal direkt in den Store geschrieben, exakt
     das Spaltenschema, das supabase.js:2891-2896 (bkmpPlayerRegister)
     tatsaechlich einfuegt. */
  async function seedPlayerStatsAndCode(store, fixtureData, codeOverrides) {
    store.tables.player_stats = store.tables.player_stats || [];
    store.tables.player_stats.push({
      auth_user_id: fixtureData.authUserId, name_key: fixtureData.nameKey, display_name: fixtureData.displayName
    });
    store.tables.plushie_codes = store.tables.plushie_codes || [];
    store.tables.idle_player_village_skins = store.tables.idle_player_village_skins || [];
    const row = { id: 1, code: 'QA-SKIN-CODE', reward_kind: 'village_skin', skin_id: 'kallejuniordorf', plushie_id: null, is_redeemed: false, is_reusable: false, ...codeOverrides };
    store.tables.plushie_codes.push(row);
    return row;
  }

  async function redeem(page, store, code) {
    const accessToken = await page.evaluate(async () => {
      const { data } = await bkmpGetPlayerAuthClient().auth.getSession();
      return data.session.access_token;
    });
    return invokeRedeemPlushieCodeHandler(store, {
      headers: { authorization: `Bearer ${accessToken}` },
      body: { code }
    });
  }

  test('gueltiger, unbenutzter Code: 200 ok, Besitz-Zeile wird eingefuegt', async ({ page, qaBaseURL, fixtureData, store }) => {
    await seedPlayerStatsAndCode(store, fixtureData);
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const res = await redeem(page, store, 'QA-SKIN-CODE');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, rewardKind: 'village_skin', plushieId: null, skinId: 'kallejuniordorf' });
    const owned = store.tables.idle_player_village_skins.find(r => r.skin_id === 'kallejuniordorf' && r.auth_user_id === fixtureData.authUserId);
    expect(owned).toBeTruthy();
    const codeRow = store.tables.plushie_codes.find(r => r.code === 'QA-SKIN-CODE');
    expect(codeRow.is_redeemed).toBe(true);
  });

  test('bereits eingeloester Code: 409 already_redeemed, keine zweite Besitz-Zeile', async ({ page, qaBaseURL, fixtureData, store }) => {
    await seedPlayerStatsAndCode(store, fixtureData, { is_redeemed: true });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const res = await redeem(page, store, 'QA-SKIN-CODE');
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('already_redeemed');
    expect(store.tables.idle_player_village_skins.length).toBe(0);
  });

  test('Skin bereits im Besitz: 409 already_owned, Code wird NICHT verbraucht (is_redeemed bleibt false)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await seedPlayerStatsAndCode(store, fixtureData);
    store.tables.idle_player_village_skins.push({ id: 'existing', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, skin_id: 'kallejuniordorf', unlocked_at: new Date().toISOString() });
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const res = await redeem(page, store, 'QA-SKIN-CODE');
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('already_owned');
    const codeRow = store.tables.plushie_codes.find(r => r.code === 'QA-SKIN-CODE');
    expect(codeRow.is_redeemed).toBe(false); // Code bleibt unverbraucht - koennte spaeter fuer einen anderen Skin/Account genutzt werden
  });

  test('unbekannter Code: 404 invalid_code', async ({ page, qaBaseURL, fixtureData, store }) => {
    await seedPlayerStatsAndCode(store, fixtureData);
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const res = await redeem(page, store, 'DOES-NOT-EXIST');
    expect(res.status).toBe(404);
    expect(res.json.error).toBe('invalid_code');
  });

  test('zwei gleichzeitige Einloese-Versuche desselben Codes: genau einer gewinnt (atomares Beanspruchen)', async ({ page, qaBaseURL, fixtureData, store }) => {
    await seedPlayerStatsAndCode(store, fixtureData);
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const [r1, r2] = await Promise.all([redeem(page, store, 'QA-SKIN-CODE'), redeem(page, store, 'QA-SKIN-CODE')]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect([409, 200]).toContain(statuses[1]); // zweiter Versuch: entweder schon eingeloest ODER (Race) schon im Besitz
    expect(store.tables.idle_player_village_skins.filter(r => r.skin_id === 'kallejuniordorf').length).toBe(1);
  });
});
