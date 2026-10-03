const { test, expect, openAndLogin, waitForDragonReady } = require('../helpers/qa-fixtures');

/* Idle-Dorf "Chronik" (03.10.2026, js/systems/bkmp-chronicle.js):
   Tagesauftraege/Wochenziele/Truhen, Login-Kalender, Drachen-Bestiarium,
   Weltereignisse. Laeuft gegen die ECHTEN Produktionsfunktionen (kein
   Testkopie-Code); nur wo die zufaellig (aber deterministisch) gewuerfelten
   Auftragsarten einen Test sonst vom Spielernamen abhaengig machen wuerden,
   wird die Auftragsliste gezielt gesetzt. Bestehende Test-Muster:
   bkmpIdleStopLoop() nach dem Laden (sonst veraendert der Hintergrund-Kampf
   Gold/Kills waehrend der Pruefung, siehe prestige.spec.js/combat.spec.js),
   Klicks auf animierte Objekte per DOM-.click() (Playwrights Stabilitaets-
   pruefung haengt bei dauerhaft wippenden Elementen, siehe CLAUDE.md
   "Combat-Test auf mobile-large/WebKit"). */

async function openChronicleReady(page, qaBaseURL, fixtureData) {
  await openAndLogin(page, qaBaseURL, fixtureData);
  await waitForDragonReady(page);
  await page.evaluate(() => bkmpIdleStopLoop());
  await page.waitForFunction(() => typeof bkmpChronicle !== 'undefined' && bkmpChronicle && bkmpChronicle.daily && bkmpChronicle.weekly, null, { timeout: 15000 });
}

function setDailyQuests(page, quests) {
  return page.evaluate(q => {
    bkmpChronicle.daily.quests = q.map(x => ({ progress: 0, claimed: false, ...x }));
    bkmpChronicle.daily.chestClaimed = false;
    bkmpChronicleRefreshUi(true);
  }, quests);
}

test.describe('Chronik - Grundlagen', () => {
  test.use({ teststand: 'B' });

  test('laedt beim Oeffnen und erzeugt 3 Tages- und 3 Wochenauftraege ohne Konsolenfehler', async ({ page, qaBaseURL, fixtureData }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await openChronicleReady(page, qaBaseURL, fixtureData);
    const info = await page.evaluate(() => ({
      daily: bkmpChronicle.daily.quests.map(q => q.type),
      weekly: bkmpChronicle.weekly.quests.map(q => q.type),
      allTargetsPositive: bkmpChronicle.daily.quests.concat(bkmpChronicle.weekly.quests).every(q => q.target > 0 && Number.isFinite(q.target))
    }));
    expect(info.daily).toHaveLength(3);
    expect(info.weekly).toHaveLength(3);
    expect(new Set(info.daily).size).toBe(3);
    expect(new Set(info.weekly).size).toBe(3);
    expect(info.allTargetsPositive).toBe(true);
    expect(errors).toEqual([]);
  });

  test('Auftraege sind pro Spieler und Tag deterministisch (Reload wuerfelt nicht neu)', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    const first = await page.evaluate(() => bkmpChronicle.daily.quests.map(q => q.type).join(','));
    await page.evaluate(() => { localStorage.removeItem('bkmp-idle-chronicle-v1:' + bkmpChronicleNameKey); });
    const regenerated = await page.evaluate(() => bkmpChronicleGenerateQuests('daily', bkmpChronicle.daily.key, 3).map(q => q.type).join(','));
    expect(regenerated).toBe(first);
  });

  test('Zaehler-Auftrag zaehlt per Delta, Abholen zahlt aus und wird auf dem Server gespeichert', async ({ page, qaBaseURL, fixtureData, store }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    await setDailyQuests(page, [{ type: 'kills', target: 5 }, { type: 'clicks', target: 999 }, { type: 'dungeon_runs', target: 99 }]);
    await page.evaluate(() => { bkmpChronicleTrack(true); bkmpIdleState.dragon_kills += 5; bkmpChronicleTrack(true); });
    const progress = await page.evaluate(() => bkmpChronicle.daily.quests[0].progress);
    expect(progress).toBe(5);

    const before = await page.evaluate(() => ({ gold: bkmpIdleState.gold, crystals: bkmpIdleState.crystals, reward: bkmpChronicleQuestReward('daily') }));
    await page.evaluate(() => bkmpChronicleOpenModal('quests'));
    await page.evaluate(() => document.querySelector('#bkmpChronicleOverlay [data-chron-action="claim"][data-scope="daily"][data-index="0"]').click());
    await page.waitForFunction(() => bkmpChronicle.daily.quests[0].claimed === true);
    const after = await page.evaluate(() => ({ gold: bkmpIdleState.gold, crystals: bkmpIdleState.crystals, done: bkmpChronicle.life.questsDone }));
    expect(after.gold - before.gold).toBe(before.reward.gold);
    expect(after.crystals - before.crystals).toBe(before.reward.crystals);
    expect(after.done).toBe(1);

    await expect.poll(() => {
      const row = (store.tables.idle_player_meta || [])[0];
      return row && row.data && row.data.daily && row.data.daily.quests[0].claimed;
    }, { timeout: 10000 }).toBe(true);
    const row = store.tables.idle_player_meta[0];
    expect(row.auth_user_id).toBe(fixtureData.authUserId);
  });

  test('Belohnungs-Gold zaehlt nicht als Fortschritt fuer einen "Verdiene Gold"-Auftrag', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    await setDailyQuests(page, [{ type: 'clicks', target: 1, progress: 1 }, { type: 'gold', target: 1e15 }, { type: 'dungeon_runs', target: 99 }]);
    await page.evaluate(() => bkmpChronicleTrack(true));
    await page.evaluate(() => bkmpChronicleClaimQuest('daily', 0));
    await page.evaluate(() => bkmpChronicleTrack(true));
    const goldProgress = await page.evaluate(() => bkmpChronicle.daily.quests[1].progress);
    expect(goldProgress).toBe(0);
  });

  test('Tagestruhe erst nach allen drei Auftraegen, gibt eine Rune, zweites Oeffnen wirkungslos', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    await setDailyQuests(page, [{ type: 'clicks', target: 1, progress: 1 }, { type: 'dungeon_runs', target: 1, progress: 1 }, { type: 'tower_waves', target: 99 }]);
    await page.evaluate(() => bkmpChronicleClaimQuest('daily', 0));
    await page.evaluate(() => bkmpChronicleClaimQuest('daily', 1));
    const lockedChest = await page.evaluate(async () => { const r = bkmpIdlePlayerRunes.length; await bkmpChronicleClaimChest('daily'); return { opened: bkmpChronicle.daily.chestClaimed, runesAdded: bkmpIdlePlayerRunes.length - r }; });
    expect(lockedChest).toEqual({ opened: false, runesAdded: 0 });

    await page.evaluate(() => { bkmpChronicleAddProgress('tower_waves', 99); });
    await page.evaluate(() => bkmpChronicleClaimQuest('daily', 2));
    const opened = await page.evaluate(async () => { const r = bkmpIdlePlayerRunes.length; const c = bkmpIdleState.crystals; await bkmpChronicleClaimChest('daily'); return { opened: bkmpChronicle.daily.chestClaimed, runesAdded: bkmpIdlePlayerRunes.length - r, crystals: bkmpIdleState.crystals - c }; });
    expect(opened.opened).toBe(true);
    expect(opened.runesAdded).toBe(1);
    expect(opened.crystals).toBeGreaterThan(0);

    const second = await page.evaluate(async () => { const r = bkmpIdlePlayerRunes.length; const c = bkmpIdleState.crystals; await bkmpChronicleClaimChest('daily'); return bkmpIdlePlayerRunes.length === r && bkmpIdleState.crystals === c; });
    expect(second).toBe(true);
  });

  test('ein auf einem anderen Geraet bereits abgeholter Auftrag zahlt hier nicht erneut aus', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    await setDailyQuests(page, [{ type: 'clicks', target: 1, progress: 1 }, { type: 'dungeon_runs', target: 99 }, { type: 'tower_waves', target: 99 }]);
    const result = await page.evaluate(async () => {
      const other = JSON.parse(JSON.stringify(bkmpChronicle));
      other.daily.quests[0].claimed = true;
      other.life.questsDone += 1;
      await upsertIdlePlayerMeta(bkmpIdleState.name_key, other);
      const gold = bkmpIdleState.gold;
      await bkmpChronicleClaimQuest('daily', 0);
      return { goldUnchanged: bkmpIdleState.gold === gold, claimed: bkmpChronicle.daily.quests[0].claimed };
    });
    expect(result).toEqual({ goldUnchanged: true, claimed: true });
  });

  test('einmal pro Tag neu auswuerfeln, danach gesperrt', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    await setDailyQuests(page, [{ type: 'clicks', target: 99 }, { type: 'dungeon_runs', target: 99 }, { type: 'tower_waves', target: 99 }]);
    const r = await page.evaluate(() => {
      const before = bkmpChronicle.daily.quests.map(q => q.type);
      bkmpChronicleRerollQuest(0);
      const afterFirst = bkmpChronicle.daily.quests.map(q => q.type);
      bkmpChronicleRerollQuest(1);
      const afterSecond = bkmpChronicle.daily.quests.map(q => q.type);
      return { before, afterFirst, afterSecond, used: bkmpChronicle.daily.rerollsUsed };
    });
    expect(r.afterFirst[0]).not.toBe(r.before[0]);
    expect(r.before).not.toContain(r.afterFirst[0]);
    expect(r.afterSecond).toEqual(r.afterFirst);
    expect(r.used).toBe(1);
  });

  test('Ereignis-Fortschritt vor dem Laden geht nicht verloren', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    await setDailyQuests(page, [{ type: 'dungeon_runs', target: 5 }, { type: 'clicks', target: 99 }, { type: 'tower_waves', target: 99 }]);
    const progress = await page.evaluate(async () => {
      const saved = bkmpChronicle;
      bkmpChronicleSaveNow();
      bkmpChronicle = null;
      bkmpChronicleAddProgress('dungeon_runs', 2); // landet in der Warteschlange
      bkmpChronicle = saved;
      bkmpChronicleFlushPending();
      return bkmpChronicle.daily.quests[0].progress;
    });
    expect(progress).toBe(2);
  });
});

test.describe('Chronik - Bestiarium', () => {
  test.use({ teststand: 'B' });

  test('Kills pro Art steigen in Stufen und geben einen Dauerbonus auf die Kampfwerte', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    const r = await page.evaluate(() => {
      const kind = bkmpChronicleBestiaryKinds().find(k => k.spawn_rule === 'standard');
      const atkBefore = bkmpIdleEffectiveStats.attackBonusPct;
      const t = bkmpChronicleBestiaryThresholds(kind);
      bkmpChronicleAddBestiaryKills(kind.id, t[1], true);
      return { tier: bkmpChronicleBestiaryTier(kind, bkmpChronicle.bestiary[kind.id]), totals: bkmpChronicleBestiaryEffectTotals(), atkBefore, atkAfter: bkmpIdleEffectiveStats.attackBonusPct, bonus: bkmpChronicleBestiaryBonus(kind) };
    });
    expect(r.tier).toBe(2);
    expect(r.totals[r.bonus.effectType]).toBe(2 * r.bonus.perTier);
    if (r.bonus.effectType === 'attack_pct') expect(r.atkAfter).toBeGreaterThan(r.atkBefore);
  });

  test('Offline-Kills werden vollstaendig nach Spawn-Regeln verteilt', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    const r = await page.evaluate(() => {
      const before = JSON.parse(JSON.stringify(bkmpChronicle.bestiary));
      bkmpChronicleCreditOfflineKills(1000, 60);
      const kinds = bkmpChronicleBestiaryKinds();
      const delta = id => (bkmpChronicle.bestiary[id] || 0) - (before[id] || 0);
      const sumRule = rule => kinds.filter(k => k.spawn_rule === rule).reduce((s, k) => s + delta(k.id), 0);
      return { total: kinds.reduce((s, k) => s + delta(k.id), 0), bosses: sumRule('boss_25') + sumRule('miniboss_10'), standard: sumRule('standard'), rare: sumRule('rare') };
    });
    expect(r.total).toBe(1000);
    expect(r.bosses).toBe(60);
    expect(r.standard).toBeGreaterThan(r.rare);
  });

  test('ein echter Kill im Kampf wird der richtigen Drachenart gutgeschrieben', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    const r = await page.evaluate(() => {
      const id = bkmpIdleCurrentDragon.id;
      const isEvent = bkmpIdleCurrentDragon.isEventDragon;
      const before = bkmpChronicle.bestiary[id] || 0;
      bkmpIdleCurrentDragon.hp = 0;
      bkmpIdleHandleDragonDefeated();
      return { isEvent, delta: (bkmpChronicle.bestiary[id] || 0) - before };
    });
    expect(r.delta).toBe(r.isEvent ? 0 : 1);
  });
});

test.describe('Chronik - Weltereignisse', () => {
  test.use({ teststand: 'B' });

  test('Schatztruhe erscheint im Schlachtfeld, Anklicken zahlt aus und zaehlt als Ereignis', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    const r = await page.evaluate(async () => {
      bkmpWorldEventStart('chest');
      const el = document.querySelector('#idleBattlefield .idle-world-event-obj');
      const gold = bkmpIdleState.gold;
      el.click();
      await new Promise(res => setTimeout(res, 50));
      return { appeared: !!el, goldGain: bkmpIdleState.gold - gold, caught: bkmpChronicle.life.eventsCaught, cleared: !bkmpWorldEventClickable };
    });
    expect(r.appeared).toBe(true);
    expect(r.goldGain).toBeGreaterThan(0);
    expect(r.caught).toBe(1);
    expect(r.cleared).toBe(true);
  });

  test('nicht angeklickte Truhe verschwindet von selbst ohne Belohnung', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    const r = await page.evaluate(async () => {
      const gold = bkmpIdleState.gold;
      bkmpWorldEventStart('chest');
      bkmpWorldEventExpireClickable();
      await new Promise(res => setTimeout(res, 600));
      return { gone: !document.querySelector('#idleBattlefield .idle-world-event-obj'), gold: bkmpIdleState.gold === gold, caught: bkmpChronicle.life.eventsCaught };
    });
    expect(r).toEqual({ gone: true, gold: true, caught: 0 });
  });

  test('Goldregen verdoppelt Gold aus Kaempfen nur waehrend der Laufzeit und nie im Dungeon', async ({ page, qaBaseURL, fixtureData }) => {
    await openChronicleReady(page, qaBaseURL, fixtureData);
    const r = await page.evaluate(() => {
      const base = bkmpIdleRewardsAt(bkmpIdleCurrentDragon, bkmpIdleEffectiveStats, bkmpIdleGetMergedRewardScalingCfg()).gold;
      const boost = bkmpDungeonBoostMultiplier('gold');
      bkmpWorldEventStart('goldrain');
      const banner = !!document.querySelector('#idleBattlefield .idle-world-event-banner');
      const gold = bkmpIdleState.gold;
      bkmpIdleCurrentDragon.hp = 0;
      bkmpIdleHandleDragonDefeated();
      const gain = bkmpIdleState.gold - gold;
      bkmpDungeonActive = true;
      const inDungeon = bkmpWorldEventGoldMult();
      bkmpDungeonActive = false;
      bkmpWorldEventBuff.endsAt = Date.now() - 1;
      bkmpWorldEventTick();
      return { base, boost, gain, banner, inDungeon, afterEnd: bkmpWorldEventGoldMult(), bannerGone: !document.querySelector('#idleBattlefield .idle-world-event-banner') };
    });
    expect(r.banner).toBe(true);
    expect(r.gain).toBeGreaterThanOrEqual(Math.round(r.base * r.boost * 2));
    expect(r.inDungeon).toBe(1);
    expect(r.afterEnd).toBe(1);
    expect(r.bannerGone).toBe(true);
  });
});

test.describe('Chronik - Login-Kalender', () => {
  test.use({ teststand: 'A', useFakeClock: true, startTimeMs: Date.parse('2026-03-10T10:00:00.000Z') });

  test('Belohnung nie kleiner als die alte Formel, Tag 7 gibt eine Rune', async ({ page, qaBaseURL, fixtureData, qaClock }) => {
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    await page.evaluate(() => bkmpIdleStopLoop());
    const day1 = await page.evaluate(() => bkmpChronicleLoginReward(1));
    expect(day1.gold).toBeGreaterThanOrEqual(500);
    for (let day = 2; day <= 6; day++) {
      await page.clock.setFixedTime(Date.parse(`2026-03-${9 + day}T10:00:00.000Z`));
      await page.evaluate(() => bkmpIdleCheckDailyStreak());
    }
    const runesBefore = await page.evaluate(() => bkmpIdlePlayerRunes.length);
    await page.clock.setFixedTime(Date.parse('2026-03-16T10:00:00.000Z'));
    await page.evaluate(() => bkmpIdleCheckDailyStreak());
    const r = await page.evaluate(() => ({ streak: bkmpIdleGetStreakData().count, runes: bkmpIdlePlayerRunes.length, mirror: bkmpChronicle && bkmpChronicle.streak }));
    expect(r.streak).toBe(7);
    expect(r.runes - runesBefore).toBe(1);
    expect(r.mirror.count).toBe(7);
  });

  test('auf einem anderen Geraet bereits beanspruchter Tag wird nicht doppelt ausgezahlt', async ({ page, qaBaseURL, fixtureData, store, qaClock }) => {
    store.tables.idle_player_meta = [{
      auth_user_id: fixtureData.authUserId,
      name_key: fixtureData.nameKey,
      data: { v: 1, updatedAt: Date.now(), streak: { count: 4, lastDate: '2026-03-10' }, bestiary: {}, life: {} },
      updated_at: new Date().toISOString()
    }];
    await openAndLogin(page, qaBaseURL, fixtureData);
    await waitForDragonReady(page);
    const r = await page.evaluate(() => ({ streak: bkmpIdleGetStreakData(), gold: bkmpIdleState.gold }));
    expect(r.streak.count).toBe(4);
    expect(r.streak.lastDate).toBe('2026-03-10');
    // Teststand A startet bei 0 Gold; eine (zweite) Login-Auszahlung waere >= 500.
    // Kleine Toleranz fuer die Goldmine-Grundproduktion waehrend des Tests
    // (siehe prestige.spec.js-Erkenntnis vom 25.07.2026).
    expect(r.gold).toBeLessThan(400);
  });
});

test.describe('Chronik - Einstiegspunkte', () => {
  test.use({ teststand: 'B' });

  test('Desktop: Tagesauftrags-Karte in der Kampfspalte oeffnet das Fenster', async ({ page, qaBaseURL, fixtureData }) => {
    test.skip((page.viewportSize() || { width: 1280 }).width < 1000, 'Karte gibt es nur in der grossen Desktop-Ansicht');
    await openChronicleReady(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpChronicleRefreshUi(true));
    const card = page.locator('[data-testid="chronicle-card"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.idle-chron-mini-row')).toHaveCount(3);
    await card.locator('.idle-chron-open-btn').click();
    await expect(page.locator('#bkmpChronicleOverlay')).toHaveClass(/visible/);
    await expect(page.locator('#bkmpChronicleOverlay .bkmp-chron-quest')).toHaveCount(6);
    // Kurzlink "Bestiarium" (Spieler-Frage 03.10.2026: "Wo finde ich dieses Bestiarium?")
    await page.evaluate(() => bkmpChronicleCloseModal());
    await card.locator('[data-chronicle-open="bestiary"]').click();
    await expect(page.locator('#bkmpChronicleOverlay [data-tab-id="bestiary"]')).toHaveClass(/is-active/);
    await expect(page.locator('#bkmpChronicleOverlay .bkmp-chron-beast').first()).toBeVisible();
  });

  test('Mobil: 📜-Knopf im kompakten HUD oeffnet das Fenster', async ({ page, qaBaseURL, fixtureData }) => {
    test.skip((page.viewportSize() || { width: 1280 }).width >= 1000, 'Kompaktes HUD gibt es nur auf schmalen Breiten');
    await openChronicleReady(page, qaBaseURL, fixtureData);
    const btn = page.locator('[data-testid="chronicle-hud-btn"]');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('#bkmpChronicleOverlay')).toHaveClass(/visible/);
    const overflow = await page.evaluate(() => { const c = document.querySelector('#bkmpChronicleOverlay .joke-card'); return c.scrollWidth > c.clientWidth + 1; });
    expect(overflow).toBe(false);
  });

  test('alle vier Reiter rendern ohne Fehler', async ({ page, qaBaseURL, fixtureData }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await openChronicleReady(page, qaBaseURL, fixtureData);
    await page.evaluate(() => bkmpChronicleOpenModal('quests'));
    for (const tab of ['calendar', 'bestiary', 'goals', 'quests']) {
      await page.evaluate(id => document.querySelector(`#bkmpChronicleOverlay [data-tab-id="${id}"]`).click(), tab);
      await expect(page.locator(`#bkmpChronicleOverlay [data-tab-id="${tab}"]`)).toHaveClass(/is-active/);
    }
    await expect(page.locator('#bkmpChronicleOverlay .bkmp-chron-day')).toHaveCount(0);
    await page.evaluate(() => document.querySelector('#bkmpChronicleOverlay [data-tab-id="calendar"]').click());
    await expect(page.locator('#bkmpChronicleOverlay .bkmp-chron-day')).toHaveCount(7);
    expect(errors).toEqual([]);
  });
});
