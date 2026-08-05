const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Spieler-Idee MCSoGGe (05.08.2026, oeffentliches Feedback-Board): "wenn man
   ein gewisses Level an Prestiges hat dass man dann 2 oder mehr Drachen
   ausruesten kann" - vom Nutzer konkretisiert: 2./3. Begleiter mit
   abnehmendem Wert (50%/25%), Freischaltung ueber einen neuen 2-stufigen
   Prestige-Knoten "weitere_gefaehrten" (1.500/3.000 Punkte, Zweig
   Vermaechtnis - siehe js/systems/bkmp-prestige.js).

   Architektur (siehe ausfuehrliche Kommentare in js/systems/bkmp-breeding.js):
   bkmpDragonMaxCompanionSlots() (1-3, aus dem Prestige-Knoten) +
   bkmpDragonActiveCompanions() (nach Staerke sortiert, auf das Limit
   gekappt) speisen sowohl die neue Begleiter-Leiste oben im Drachenzucht-
   Tab als auch bkmpIdleDragonCompanionEffectTotals()/bkmpDragonSubstatBonus()
   (BKMP_DRAGON_COMPANION_SLOT_WEIGHTS: 100%/50%/25%). Auto-Sortierung nach
   rechnerischer Staerke (nicht Ausruestungs-Reihenfolge) - bewusste
   Design-Entscheidung, verhindert dass ein Spieler seinen staerksten
   Drachen versehentlich in einen schwachen Rang setzt.

   Jugendliche "waechst heran"-Begleiter (Kampf-EP-Sammler, siehe
   bkmpDragonGrantCompanionBattleXp) bleiben davon UNABHAENGIG - weiterhin
   exakt einer gleichzeitig, zaehlt nicht gegen das neue Erwachsenen-
   Platzlimit. */

test.beforeEach(async ({}, testInfo) => {
  test.skip(/^mobile-/.test(testInfo.project.name), 'Nutzt echte Desktop-Tab-Klicks auf #idleTabBtnDrachen - siehe CLAUDE.md-Muster (z.B. dragon-lifecycle-release.spec.js)');
});

const SPECIES = {
  id: 'qa-companion-species', name: 'QA-Begleiter', rarity: 'episch',
  egg_source: 'event', source_dragon_id: null, egg_drop_chance: 0,
  brood_seconds: 999999, sacrifice_gold: 0, sacrifice_crystals: 0,
  growth_points_required: 100, battle_xp_required: 100,
  is_multi_stat: false, sub_stat_count_min: 1, sub_stat_count_max: 1,
  egg_image: '', baby_image: '', teen_image: '', adult_image: '', sort_order: 1, active: true
};

function adultDragon(fixtureData, id, stats, extra) {
  return {
    id, name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: SPECIES.id,
    stage: 'adult', is_favorite: false, is_companion: false, ascension_level: 0, substats: [],
    hatched_at: fixtureData.nowIso, adult_at: fixtureData.nowIso, ...stats, ...(extra || {})
  };
}

async function setPrestigeCompanionRank(page, rank) {
  await page.evaluate((r) => {
    if (!bkmpPrestigeState) bkmpPrestigeState = { prestige_level: 0, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
    bkmpPrestigeState.prestige_allocations = { ...(bkmpPrestigeState.prestige_allocations || {}), weitere_gefaehrten: r };
  }, rank);
}

async function equip(page, dragonId) {
  await page.evaluate((id) => bkmpDragonSetCompanion(id), dragonId);
  await page.waitForTimeout(50); // rein clientseitige async-Kette (kein Server-Roundtrip im Mock relevant), kurze Beruhigung fuer nachfolgende DOM-Lesevorgaenge
}

test.describe('Mehrere gleichzeitige Kampf-Begleiter (Prestige-Knoten "Weitere Gefährten") - Teststand A', () => {
  test.use({ teststand: 'A' });

  test('ohne Prestige-Investition: nur 1 Begleiter moeglich, ein zweiter Versuch wird mit Hinweis blockiert', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'qa-a', { stat_attack: 100, stat_defense: 50, stat_hp: 200 }),
      adultDragon(fixtureData, 'qa-b', { stat_attack: 40, stat_defense: 20, stat_hp: 100 })
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();

    await equip(page, 'qa-a');
    const afterFirst = await page.evaluate(() => bkmpPlayerDragons.find(d => d.id === 'qa-a').is_companion);
    expect(afterFirst).toBe(true);

    await equip(page, 'qa-b');
    const afterSecond = await page.evaluate(() => ({
      bIsCompanion: bkmpPlayerDragons.find(d => d.id === 'qa-b').is_companion,
      aStillCompanion: bkmpPlayerDragons.find(d => d.id === 'qa-a').is_companion
    }));
    expect(afterSecond.bIsCompanion).toBe(false); // blockiert, nicht einfach ersetzt
    expect(afterSecond.aStillCompanion).toBe(true);

    const toastText = await page.locator('.bkmp-jannik-toast').textContent();
    expect(toastText).toContain('Maximal 1 Begleiter');

    // Begleiter-Leiste: Rang 1 gefuellt, Rang 2+3 gesperrt (kein Prestige investiert).
    const bar = await page.evaluate(() => {
      const slots = Array.from(document.querySelectorAll('.idle-dragon-companion-slot'));
      return slots.map(s => ({ filled: s.classList.contains('is-filled'), locked: s.classList.contains('is-locked'), empty: s.classList.contains('is-empty') }));
    });
    expect(bar[0]).toEqual({ filled: true, locked: false, empty: false });
    expect(bar[1].locked).toBe(true);
    expect(bar[2].locked).toBe(true);
  });

  test('Rang 1 (2 Plätze): zweiter Begleiter zählt korrekt mit 50% Gewicht, egal in welcher Reihenfolge ausgerüstet', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'qa-stronger', { stat_attack: 100, stat_defense: 50, stat_hp: 200 }),
      adultDragon(fixtureData, 'qa-weaker', { stat_attack: 40, stat_defense: 20, stat_hp: 100 })
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await setPrestigeCompanionRank(page, 1);

    // Bewusst den SCHWAECHEREN zuerst ausruesten - die Rang-Zuteilung muss
    // trotzdem nach STAERKE sortieren, nicht nach Ausruestungs-Reihenfolge.
    await equip(page, 'qa-weaker');
    await equip(page, 'qa-stronger');

    const bar = await page.evaluate(() => Array.from(document.querySelectorAll('.idle-dragon-companion-slot-name')).map(el => el.textContent));
    expect(bar[0]).toBe('QA-Begleiter'); // beide haben denselben Namen, Reihenfolge zaehlt

    const ranks = await page.evaluate(() => Array.from(document.querySelectorAll('.idle-dragon-companion-slot.is-filled')).map(s => s.dataset.dragonId));
    expect(ranks[0]).toBe('qa-stronger'); // trotz spaeterer Ausruestung in Rang 1
    expect(ranks[1]).toBe('qa-weaker');

    const totals = await page.evaluate(() => bkmpIdleDragonCompanionEffectTotals());
    expect(totals.attack_flat).toBeCloseTo(100 * 1 + 40 * 0.5, 5); // 120
    expect(totals.defense_flat).toBeCloseTo(50 * 1 + 20 * 0.5, 5); // 60
    expect(totals.hp_flat).toBeCloseTo(200 * 1 + 100 * 0.5, 5); // 250
  });

  test('Rang 2 (3 Plätze): dritter Begleiter zählt mit 25%, ein vierter Versuch wird blockiert', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'qa-stronger', { stat_attack: 100, stat_defense: 50, stat_hp: 200 }),
      adultDragon(fixtureData, 'qa-weaker', { stat_attack: 40, stat_defense: 20, stat_hp: 100 }),
      adultDragon(fixtureData, 'qa-weakest', { stat_attack: 10, stat_defense: 5, stat_hp: 50 }),
      adultDragon(fixtureData, 'qa-fourth', { stat_attack: 5, stat_defense: 5, stat_hp: 50 })
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await setPrestigeCompanionRank(page, 2);

    await equip(page, 'qa-weakest');
    await equip(page, 'qa-weaker');
    await equip(page, 'qa-stronger');

    const totals = await page.evaluate(() => bkmpIdleDragonCompanionEffectTotals());
    expect(totals.attack_flat).toBeCloseTo(100 * 1 + 40 * 0.5 + 10 * 0.25, 5); // 122.5
    expect(totals.defense_flat).toBeCloseTo(50 * 1 + 20 * 0.5 + 5 * 0.25, 5); // 61.25
    expect(totals.hp_flat).toBeCloseTo(200 * 1 + 100 * 0.5 + 50 * 0.25, 5); // 262.5

    // Alle 3 Plaetze belegt - ein vierter Versuch muss blockiert werden.
    await equip(page, 'qa-fourth');
    const fourthResult = await page.evaluate(() => bkmpPlayerDragons.find(d => d.id === 'qa-fourth').is_companion);
    expect(fourthResult).toBe(false);
    const toastText = await page.locator('.bkmp-jannik-toast').last().textContent();
    expect(toastText).toContain('Maximal 3 Begleiter');
  });

  test('Ablegen über die Begleiter-Leiste (×-Knopf) entfernt genau diesen Begleiter und gibt den Platz frei', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'qa-a', { stat_attack: 100, stat_defense: 50, stat_hp: 200 }),
      adultDragon(fixtureData, 'qa-b', { stat_attack: 40, stat_defense: 20, stat_hp: 100 })
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await setPrestigeCompanionRank(page, 1);
    await equip(page, 'qa-a');
    await equip(page, 'qa-b');

    await page.locator('.idle-dragon-companion-slot-remove[data-dragon-id="qa-a"]').click();
    const state = await page.evaluate(() => ({
      aCompanion: bkmpPlayerDragons.find(d => d.id === 'qa-a').is_companion,
      bCompanion: bkmpPlayerDragons.find(d => d.id === 'qa-b').is_companion
    }));
    expect(state.aCompanion).toBe(false);
    expect(state.bCompanion).toBe(true); // nur der angeklickte wird entfernt

    // Platz 1 ist jetzt frei (qa-b ruecht nach vorne, da es der einzige verbleibende ist).
    const totals = await page.evaluate(() => bkmpIdleDragonCompanionEffectTotals());
    expect(totals.attack_flat).toBeCloseTo(40, 5); // volle 100%, nicht mehr 50%
  });

  test('jugendlicher "wächst heran"-Begleiter bleibt unabhängig vom Erwachsenen-Platzlimit', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'qa-adult', { stat_attack: 100, stat_defense: 50, stat_hp: 200 }),
      { id: 'qa-teen', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: SPECIES.id, stage: 'teen', is_favorite: false, is_companion: false, battle_xp: 0, growth_points: 10, substats: [], hatched_at: fixtureData.nowIso, adult_at: null }
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    // Bewusst OHNE Prestige-Investition (maxSlots=1) - beweist, dass der
    // jugendliche Begleiter NICHT gegen das Erwachsenen-Limit zaehlt.
    await equip(page, 'qa-adult');
    await equip(page, 'qa-teen');

    const state = await page.evaluate(() => ({
      adultCompanion: bkmpPlayerDragons.find(d => d.id === 'qa-adult').is_companion,
      teenCompanion: bkmpPlayerDragons.find(d => d.id === 'qa-teen').is_companion
    }));
    expect(state.adultCompanion).toBe(true); // unveraendert, kein Konflikt
    expect(state.teenCompanion).toBe(true); // beide gleichzeitig aktiv

    // Nachbesserung (05.08.2026): der 4. Block (is-teen-slot) zeigt den
    // trainierenden Jugendlichen jetzt direkt als eigenen Slot statt einer
    // reinen Textzeile - unabhaengig vom Kampf-Slot 1, der weiterhin den
    // erwachsenen Begleiter zeigt.
    const teenSlotName = await page.locator('.idle-dragon-companion-slot.is-teen-slot .idle-dragon-companion-slot-name').textContent();
    expect(teenSlotName).toBe('QA-Begleiter');
    const combatSlotFilled = await page.locator('.idle-dragon-companion-combat-group .idle-dragon-companion-slot.is-filled').count();
    expect(combatSlotFilled).toBe(1); // der jugendliche taucht NICHT in der Kampf-Gruppe auf
  });

  test('gesperrter Platz zeigt ein Schloss-Symbol und blockiert nicht die Anzeige der übrigen Plätze', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [adultDragon(fixtureData, 'qa-a', { stat_attack: 100, stat_defense: 50, stat_hp: 200 })];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();

    const lockedIcons = await page.locator('.idle-dragon-companion-slot.is-locked .idle-dragon-companion-slot-icon').allTextContents();
    expect(lockedIcons).toEqual(['🔒', '🔒']);
    const headerText = await page.locator('.idle-dragon-companion-section h4').textContent();
    expect(headerText).toContain('0/1');
  });

  /* Nachbesserung (05.08.2026, Nutzerwunsch nach Klick auf Platz 1: "alle
     Erwachsenden Drachen angezeigt werden in einen Kleinen Fenster das man
     nicht Runterscrollen muss"). */
  test('Klick auf einen freien Kampf-Platz öffnet ein Auswahlfenster mit allen erwachsenen Drachen, Klick auf einen Eintrag rüstet ihn aus', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'qa-a', { stat_attack: 100, stat_defense: 50, stat_hp: 200 }),
      adultDragon(fixtureData, 'qa-b', { stat_attack: 40, stat_defense: 20, stat_hp: 100 })
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();

    await page.locator('.idle-dragon-companion-slot.is-empty[data-picker-stage="adult"]').click();
    await expect(page.locator('#idleDragonCompanionPickerOverlay')).toHaveClass(/visible/);
    const rows = page.locator('.idle-dragon-companion-picker-row');
    await expect(rows).toHaveCount(2); // beide erwachsenen Drachen sichtbar, keine muss man erst runterscrollen

    await page.locator('.idle-dragon-companion-picker-row[data-dragon-id="qa-a"]').click();
    const equippedAfterClick = await page.evaluate(() => bkmpPlayerDragons.find(d => d.id === 'qa-a').is_companion);
    expect(equippedAfterClick).toBe(true);
    // Modal aktualisiert sich selbst (bleibt offen fuer weitere Auswahl), zeigt den Status jetzt korrekt.
    await expect(page.locator('.idle-dragon-companion-picker-row[data-dragon-id="qa-a"] .idle-dragon-companion-picker-status.is-active')).toBeVisible();

    await page.locator('#idleDragonCompanionPickerCloseBtn').click();
    await expect(page.locator('#idleDragonCompanionPickerOverlay')).not.toHaveClass(/visible/);
  });

  test('Klick auf den Trainings-Platz (4. Block) öffnet ein auf Jugendliche gefiltertes Auswahlfenster', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'qa-adult', { stat_attack: 100, stat_defense: 50, stat_hp: 200 }),
      { id: 'qa-teen-1', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: SPECIES.id, stage: 'teen', is_favorite: false, is_companion: false, battle_xp: 30, growth_points: 10, substats: [], hatched_at: fixtureData.nowIso, adult_at: null }
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();

    await page.locator('.idle-dragon-companion-slot.is-teen-slot').click();
    await expect(page.locator('#idleDragonCompanionPickerOverlay')).toHaveClass(/visible/);
    const title = await page.locator('#idleDragonCompanionPickerTitle').textContent();
    expect(title).toContain('Jugendlichen');
    // NUR der jugendliche Drache erscheint - der erwachsene wird korrekt ausgefiltert.
    await expect(page.locator('.idle-dragon-companion-picker-row')).toHaveCount(1);
    await expect(page.locator('.idle-dragon-companion-picker-row[data-dragon-id="qa-teen-1"]')).toBeVisible();

    await page.locator('.idle-dragon-companion-picker-row[data-dragon-id="qa-teen-1"]').click();
    const teenEquipped = await page.evaluate(() => bkmpPlayerDragons.find(d => d.id === 'qa-teen-1').is_companion);
    expect(teenEquipped).toBe(true);
  });

  test('Klick auf einen bereits ausgerüsteten Drachen im Auswahlfenster legt ihn wieder ab (Umschalten)', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [adultDragon(fixtureData, 'qa-a', { stat_attack: 100, stat_defense: 50, stat_hp: 200 })];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await equip(page, 'qa-a');

    await page.locator('.idle-dragon-companion-slot.is-filled[data-picker-stage="adult"]').click();
    await expect(page.locator('#idleDragonCompanionPickerOverlay')).toHaveClass(/visible/);
    await page.locator('.idle-dragon-companion-picker-row[data-dragon-id="qa-a"]').click();
    const equippedAfter = await page.evaluate(() => bkmpPlayerDragons.find(d => d.id === 'qa-a').is_companion);
    expect(equippedAfter).toBe(false);
  });

  test('gesperrter Platz öffnet kein Auswahlfenster', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [adultDragon(fixtureData, 'qa-a', { stat_attack: 100, stat_defense: 50, stat_hp: 200 })];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();

    await page.locator('.idle-dragon-companion-slot.is-locked').first().click();
    const overlayExists = await page.locator('#idleDragonCompanionPickerOverlay').count();
    expect(overlayExists).toBe(0); // Modal wurde nie erzeugt, kein Klick-Handler auf gesperrten Plaetzen
  });

  /* Nutzerwunsch (05.08.2026): "hier muss die Stats stylisch angezeigt
     werden... Links oder rechts 1 einzelnen Block wo nur die Stats stehen" -
     zeigt den TATSAECHLICH wirksamen (gewichteten) Gesamtbonus, nicht die
     Rohwerte eines einzelnen Drachens. */
  test('Stats-Block zeigt den tatsächlich gewichteten Gesamtbonus (⚔️/🛡️/❤️), nicht die Rohwerte eines einzelnen Drachens', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'qa-a', { stat_attack: 100, stat_defense: 50, stat_hp: 200 }),
      adultDragon(fixtureData, 'qa-b', { stat_attack: 40, stat_defense: 20, stat_hp: 100 })
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await setPrestigeCompanionRank(page, 1);

    // Vor jeder Ausruestung: Block existiert bereits, zeigt +0.
    const initial = await page.locator('.idle-dragon-companion-stat-value').allTextContents();
    expect(initial).toEqual(['+0', '+0', '+0']);

    await equip(page, 'qa-a');
    await equip(page, 'qa-b');
    // 100%+50% Gewichtung: Angriff 100+20=120, Verteidigung 50+10=60, Leben 200+50=250.
    const afterEquip = await page.locator('.idle-dragon-companion-stat-value').allTextContents();
    expect(afterEquip).toEqual(['+120', '+60', '+250']);
  });

  /* REGRESSION (Nutzer-Screenshot 05.08.2026, "Da fehlen aber noch so paar
     Bonuse" - Vergleich Drachen-Detailkarte (zeigt "Drachen-EP +27.7%",
     "Goldbonus +7.1%", "Krit-Schaden +10.7%", "Fleischproduktion +12.3%")
     gegen den "Gesamtbonus"-Block (zeigte bisher nur Angriff/Verteidigung/
     Leben): der Stats-Block ignorierte bisher jede Prozent-Substat-Zeile
     komplett, obwohl bkmpIdleDragonCompanionEffectTotals() 9 der 12
     moeglichen Substat-Typen bereits korrekt gewichtet berechnet - und die
     restlichen 3 (fruit/meat/dragon_xp-Bonus) ueber den separaten,
     ebenfalls bereits korrekten bkmpDragonSubstatBonus()-Pfad verfuegbar
     sind. Nutzt exakt dieselben 4 Substat-Werte wie im Nutzer-Screenshot. */
  test('REGRESSION: Gesamtbonus-Block zeigt auch Prozent-Substats (Drachen-EP/Goldbonus/Krit-Schaden/Fleischproduktion), nicht nur die 3 Hauptwerte', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'qa-a', { stat_attack: 35, stat_defense: 34, stat_hp: 439 }, {
        substats: [
          { stat: 'dragon_xp_bonus_pct', value: 27.7 },
          { stat: 'gold_find_pct', value: 7.1 },
          { stat: 'crit_damage_pct', value: 10.7 },
          { stat: 'meat_bonus_pct', value: 12.3 }
        ]
      })
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await equip(page, 'qa-a');

    const rows = await page.locator('.idle-dragon-companion-stat-row').allInnerTexts();
    const normalized = rows.map(r => r.replace(/\s+/g, ' ').trim());
    expect(normalized).toEqual(expect.arrayContaining([
      '⚔️ Angriff +35', '🛡️ Verteidigung +34', '❤️ Leben +439',
      '🐲 Drachen-EP +27.7%', '💰 Goldbonus +7.1%', '💥 Krit-Schaden +10.7%', '🥩 Fleischproduktion +12.3%'
    ]));
    expect(normalized.length).toBe(7); // keine unerwarteten Zusatzzeilen (nie gerollte Substat-Typen bleiben aus, kein "+0%"-Wall)
  });

  /* REGRESSION (Nutzer-Screenshot 05.08.2026): der Trainings-Platz (4.
     Block) erschien bei knappem Platz MITTEN zwischen den 3 Kampf-Plaetzen
     statt sauber daneben/darunter, einer der Kampf-Plaetze riss dabei auf
     eine eigene Zeile ab - Ursache war flex-wrap:wrap auf der Kampf-Gruppe
     selbst (siehe Fix-Kommentar bei .idle-dragon-companion-combat-group in
     style.css). Erzwingt eine schmale Fenstergroesse, um die urspruenglich
     gemeldete Enge nachzustellen. */
  test('REGRESSION: die 3 Kampf-Plätze bleiben bei knappem Platz IMMER zusammen in einer Reihe, der Trainings-Platz rutscht bei Bedarf als Ganzes darunter', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [
      adultDragon(fixtureData, 'qa-a', { stat_attack: 100, stat_defense: 50, stat_hp: 200 }),
      { id: 'qa-teen', name_key: fixtureData.nameKey, auth_user_id: fixtureData.authUserId, species_id: SPECIES.id, stage: 'teen', is_favorite: false, is_companion: false, battle_xp: 30, growth_points: 10, substats: [], hatched_at: fixtureData.nowIso, adult_at: null }
    ];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await equip(page, 'qa-a');
    await equip(page, 'qa-teen');

    await page.setViewportSize({ width: 480, height: 900 });
    const tops480 = await page.locator('.idle-dragon-companion-slot').evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
    // Alle 4 Plaetze (3 Kampf + 1 Training) auf derselben Zeile - genug Breite dafuer.
    expect(new Set(tops480).size).toBe(1);

    await page.setViewportSize({ width: 300, height: 900 });
    const tops300 = await page.locator('.idle-dragon-companion-slot').evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
    // Die 3 Kampf-Plaetze (erste 3 im DOM) bleiben zusammen auf EINER Zeile...
    expect(new Set(tops300.slice(0, 3)).size).toBe(1);
    // ...der Trainings-Platz (4.) rutscht als GANZES auf eine eigene, tiefere Zeile - kein Kampf-Platz reisst dabei einzeln ab.
    expect(tops300[3]).toBeGreaterThan(tops300[0]);
  });

  /* REGRESSION (Nutzer-Screenshot 05.08.2026, korrektes Layout aber grosse
     ungenutzte Luecke: "Wir haben sooviel platz. Nutze denn doch mal.") -
     .idle-dragon-companion-combat-group/-teen-wrap hatten kein flex-grow,
     wodurch der von .idle-dragon-companion-bar (flex:1 1 auto) beanspruchte
     Restplatz nie an die Kind-Gruppen weitergereicht wurde. Erzwingt ein
     breites Fenster, um zu beweisen, dass die Plaetze tatsaechlich WACHSEN
     statt auf ihrer Mindestgroesse (110px Basis) stehenzubleiben. */
  test('REGRESSION: die Begleiter-Plätze nutzen ueberschuessigen Platz bei breitem Fenster (wachsen ueber die Mindestgroesse hinaus)', async ({ page, qaBaseURL, fixtureData, store }) => {
    store.tables.dragon_species = [SPECIES];
    store.tables.player_dragons = [adultDragon(fixtureData, 'qa-a', { stat_attack: 100, stat_defense: 50, stat_hp: 200 })];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.locator('#idleTabBtnDrachen').click();
    await equip(page, 'qa-a');

    await page.setViewportSize({ width: 1400, height: 900 });
    const widths = await page.locator('.idle-dragon-companion-slot').evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().width)));
    // Alle 4 Plaetze deutlich ueber der 110px-Flex-Basis gewachsen - kein Rest-Leerraum daneben.
    for (const w of widths) expect(w).toBeGreaterThan(180);

    const [barRight, statsLeft] = await page.evaluate(() => {
      const bar = document.querySelector('.idle-dragon-companion-bar').getBoundingClientRect();
      const stats = document.querySelector('.idle-dragon-companion-stats-block').getBoundingClientRect();
      return [bar.right, stats.left];
    });
    // Die Luecke zwischen Leiste und Stats-Block bleibt ein normaler Flex-Gap, kein grosser toter Leerraum.
    expect(statsLeft - barRight).toBeLessThan(60);
  });
});
