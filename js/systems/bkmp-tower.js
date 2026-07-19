// Bkmp - Redesign Phase 2a (17.07.): mechanisch aus idledorf.js extrahiert (mit einem AST-Parser exakt abgegrenzt, keine Logik veraendert). js/systems/bkmp-tower.js


/* ---------------- Endloser Turm (Lategame-Content, Spieler-Vorgabe 16.07.:
   "Langzeit-fesselnder Content") ----------------
   Bewusster Gegenentwurf zum Dungeon-System: dort MUSS jede Schwierigkeit
   fuer jeden ausgebauten Charakter schaffbar sein (siehe die Balance-Fixes
   vom 16.07. weiter oben bei bkmpDungeonSpawnWave) - hier ist das genaue
   Gegenteil Absicht. Kein Cap auf combatMult, keine Sieg-Bedingung: man
   klettert, bis das Dorf faellt, die erreichte Stufe selbst ist die
   Bestenlisten-Wertung. Loest genau das Problem, das die Dungeon-Analyse
   vom 16.07. aufgedeckt hat (ein 75%-Krit-Build raeumt Albtraum ohne jedes
   Risiko durch) - hier gibt es keinen Deckel, den ein guter Build je
   "aussitzen" koennte, die Herausforderung waechst garantiert schneller als
   jeder gedeckelte Spieler-Stat mithalten kann.

   Wellen-Wachstum bewusst deutlich gedaempfter als beim Dungeon (1.05 statt
   1.24-1.42) - ohne Cap braucht es hier einen sehr flachen Anstieg, damit
   die Kurve ueber 50-100+ Wellen hinweg (statt nur 10-25) nicht sofort
   explodiert. Simulationsgeprueft (node, dieselben Spieler-Profile wie bei
   den Dungeon-Fixes): schwache Builds erreichen Stufe ~30-45, gut
   ausgebaute (insbesondere mit Heilungs-/Resistenz-Investition, nicht nur
   Krit) Stufe ~80-95 - echte, gleitende Differenzierung statt des binaeren
   Kipppunkts, den dieselbe Simulation beim Hochdrehen des Dungeon-Caps
   gezeigt hat. */
const BKMP_TOWER_CONFIG = {
  waveGrowth: 1.05,
  dampingExponent: 0.55,
  hpCoef: 0.06,
  miniBossEvery: 5,
  miniBossBump: 1.2
};
let bkmpTowerActive = false;
let bkmpTowerWave = 0;
let bkmpTowerStartTime = 0;
let bkmpTowerPrevDragon = null;
let bkmpTowerPrevVillageHp = null;
let bkmpTowerTimerInterval = null;
let bkmpTowerRunGold = 0;
let bkmpTowerRunXp = 0;
let bkmpTowerRunCrystals = 0;
let bkmpTowerRunRunes = 0;
let bkmpTowerRunEggs = 0;

function bkmpTowerWaveMult(wave) {
  return Math.pow(BKMP_TOWER_CONFIG.waveGrowth, wave - 1);
}
function bkmpTowerCombatMult(wave) {
  /* Absichtlich OHNE Math.min-Deckel - siehe Modul-Kommentar oben. */
  return Math.pow(bkmpTowerWaveMult(wave), BKMP_TOWER_CONFIG.dampingExponent);
}
function bkmpTowerSpawnWave(wave) {
  bkmpTowerWave = wave;
  const s = bkmpIdleEffectiveStats;
  const M = bkmpTowerCombatMult(wave);
  const isMiniboss = wave % BKMP_TOWER_CONFIG.miniBossEvery === 0;
  const bossBump = isMiniboss ? BKMP_TOWER_CONFIG.miniBossBump : 1;
  const fullRoster = bkmpIdleDragonDefs.length ? bkmpIdleDragonDefs : BKMP_IDLE_FALLBACK_DRAGONS;
  const roster = fullRoster.filter(d => d.active !== false && d.spawn_rule === 'standard');
  const safeRoster = roster.length ? roster : fullRoster;
  const archetype = safeRoster[(wave - 1) % safeRoster.length] || {};
  bkmpIdleCurrentDragon = {
    id: 'turm-wave-' + wave,
    name: isMiniboss ? `👑 Turmwächter (Stufe ${wave})` : `Turmgeist (Stufe ${wave})`,
    emoji: archetype.emoji || '🐉',
    spriteKey: archetype.sprite_key || archetype.id || 'standard',
    killIndex: 0,
    isBoss: false,
    bossTier: isMiniboss ? 'miniboss' : null,
    isEventDragon: false,
    eventDragonKey: null,
    /* isDungeon=true nur fuer die geteilte Visuals-Funktion (Namens-/Sprite-
       Anzeige, siehe bkmpDungeonApplyDragonVisuals) - Dispatch/Belohnung
       laufen ueber das eigene bkmpTowerActive-Flag, nicht ueber diese. */
    isDungeon: true,
    isTower: true,
    maxHp: Math.max(1, Math.round((s.attack || 10) * 4 * M * bossBump)),
    attack: Math.max(1, Math.round((s.hp || 100) * BKMP_TOWER_CONFIG.hpCoef * M * bossBump)),
    defense: Math.round((s.defense || 0) * 0.3)
  };
  bkmpIdleCurrentDragon.hp = bkmpIdleCurrentDragon.maxHp;
  bkmpDungeonApplyDragonVisuals(bkmpIdleCurrentDragon);
  bkmpIdleUpdateDragonHpBar();
  bkmpTowerUpdateBanner();
}
/* Performance (Nutzer-Auftrag, Section B Prioritaet 2 "Turm-Tick"): siehe
   Begruendung bei bkmpDungeonUpdateBanner (bkmp-dungeon.js) - identisches
   Muster, Turm-Kaempfe laufen ebenfalls auf dem "Kampf"-Tab. */
function bkmpTowerUpdateBanner() {
  const banner = document.getElementById('idleTurmBanner');
  if (!banner || !bkmpTowerActive) return;
  if (typeof bkmpIdleCombatVisualsActive === 'function' && !bkmpIdleCombatVisualsActive()) return;
  const elapsed = Date.now() - bkmpTowerStartTime;
  const best = Number((bkmpIdleState && bkmpIdleState.turm_highest_wave) || 0);
  banner.innerHTML = `🗼 Endloser Turm &middot; Stufe ${bkmpTowerWave} &middot; Rekord: ${best} &middot; ⏱ ${bkmpDungeonFormatTime(elapsed)} <button type="button" class="idle-dungeon-auto-cancel-btn" id="idleTowerGiveUpBtn">Aufgeben</button>`;
  const giveUpBtn = document.getElementById('idleTowerGiveUpBtn');
  if (giveUpBtn) giveUpBtn.addEventListener('click', bkmpTowerGiveUp);
}
async function bkmpTowerStart() {
  if (bkmpTowerActive || bkmpDungeonActive || bkmpDungeonStarting || !bkmpIdleState || !bkmpIdleEffectiveStats) return false;
  if (bkmpIdleEventPauseActive) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Erst den Event-Drachen bestätigen, bevor der Turm startet.', 3200);
    return false;
  }
  if (typeof bkmpRaidShouldShowCombatView === 'function' && bkmpRaidShouldShowCombatView()) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Während eines laufenden Raids kann der Turm nicht gestartet werden.', 3200);
    return false;
  }
  const lastAttempt = Date.parse(bkmpIdleState.turm_last_attempt_at || '');
  if (Number.isFinite(lastAttempt) && bkmpBerlinDateKey(new Date(lastAttempt)) === bkmpBerlinDateKey(new Date())) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🗼 Der Turm ist heute schon erklommen - komm nach Mitternacht wieder.', 3200);
    return false;
  }

  bkmpTowerActive = true;
  bkmpTowerWave = 0;
  bkmpTowerStartTime = Date.now();
  bkmpTowerRunGold = 0;
  bkmpTowerRunXp = 0;
  bkmpTowerRunCrystals = 0;
  bkmpTowerRunRunes = 0;
  bkmpTowerRunEggs = 0;
  bkmpTowerPrevDragon = bkmpIdleCurrentDragon;
  bkmpTowerPrevVillageHp = bkmpIdleVillageHp;
  bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;
  bkmpIdleState.turm_last_attempt_at = new Date().toISOString();

  bkmpIdleActiveTab = 'kampf';
  bkmpIdleTabs.forEach(t => {
    const b = document.getElementById(t.btn);
    const p = document.getElementById(t.panel);
    if (b) b.classList.toggle('active', t.id === 'kampf');
    if (p) p.style.display = t.id === 'kampf' ? '' : 'none';
  });
  const stageBar = document.getElementById('idleStageBar');
  if (stageBar) stageBar.style.display = 'none';
  const banner = document.getElementById('idleTurmBanner');
  if (banner) banner.style.display = '';
  if (bkmpTowerTimerInterval) clearInterval(bkmpTowerTimerInterval);
  bkmpTowerTimerInterval = setInterval(bkmpTowerUpdateBanner, 500);
  bkmpTowerSpawnWave(1);
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleQueueSync();
  if (typeof bkmpRuneSyncDrawerVisibility === 'function') bkmpRuneSyncDrawerVisibility();
  return true;
}
/* Meilenstein-Rasterung fuer die Turm-Belohnungen (Nachbesserung 16.07.,
   Spieler-Nachfrage "was bekommt man konkret bei Stufe 5/10/15?") - vorher
   gab es nur alle 10 Stufen ueberhaupt etwas ueber Gold/EXP hinaus, und
   auch dann nur Kristalle. Jetzt alle 5 Stufen ein Meilenstein, mit
   steigender Guete je nach Groesse der erreichten Schwelle (5/10/15/...
   nur Kristalle, 25/75/125/... zusaetzlich eine Rune, 50/100/150/...
   zusaetzlich Rune+Ei) - dieselbe Eskalationslogik wie beim bestehenden
   Dungeon-Tagesbonus (kontinuierlich = Multiplikator, stueckig = Extra-
   Gewaehrung), nur auf Wellen-Vielfache statt auf "einmal pro Tag"
   bezogen. Rarität skaliert mit der erreichten Stufe (nutzt dieselben
   Raritaets-Gewichtungen wie die Dungeon-Schwierigkeiten leicht/mittel/
   schwer/albtraum) - je weiter man klettert, desto besser die Beute. */
function bkmpTowerMilestoneDifficultyIdx(wave) {
  if (wave >= 100) return 3;
  if (wave >= 50) return 2;
  if (wave >= 25) return 1;
  return 0;
}
function bkmpTowerHandleWaveCleared() {
  bkmpDragonGrantCompanionBattleXp(6);
  const s = bkmpIdleEffectiveStats;
  const wave = bkmpTowerWave;
  const goldGain = Math.round(s.attack * 0.8);
  const xpGain = Math.round(s.attack * 0.4);
  bkmpIdleState.gold = Math.floor((bkmpIdleState.gold || 0) + goldGain);
  bkmpIdleState.total_gold_earned = Math.floor((bkmpIdleState.total_gold_earned || 0) + goldGain);
  bkmpTowerRunGold += goldGain;
  bkmpTowerRunXp += xpGain;
  if (typeof bkmpIdleAddXp === 'function') bkmpIdleAddXp(xpGain);
  /* Bug-Fix (Spieler-Meldung 16.07., "beim Abschliessen einer Stufe soll
     auch die Belohnung angezeigt werden"): vorher gab es pro Welle nur
     bei jeder 5. Stufe ueberhaupt eine sichtbare Rueckmeldung (den
     Meilenstein-Toast weiter unten) - das laufende Gold/EXP jeder
     einzelnen Welle wurde nur still ins Konto gebucht, ohne jede
     Anzeige. Gleiches bkmpIdleRewardGained-Event wie beim normalen
     Drachen-Kill (siehe bkmpIdleHandleDragonDefeated) - der bereits
     bestehende, seitenweite "+Gold +XP"-Hochschweb-Listener greift
     dadurch automatisch auch hier, ohne eigene Anzeige-Logik. */
  document.dispatchEvent(new CustomEvent('bkmpIdleRewardGained', { detail: { gold: goldGain, xp: xpGain, isBoss: wave % BKMP_TOWER_CONFIG.miniBossEvery === 0 } }));
  if (wave % 5 === 0) {
    const idx = bkmpTowerMilestoneDifficultyIdx(wave);
    const milestoneCrystals = Math.ceil(wave / 5) * 2;
    bkmpIdleState.crystals = Math.floor((bkmpIdleState.crystals || 0) + milestoneCrystals);
    bkmpTowerRunCrystals += milestoneCrystals;
    const parts = [`+${milestoneCrystals} 💎`];
    if (wave % 50 === 0) {
      const rune = bkmpDungeonRollRune(idx);
      bkmpDungeonPersistRunes([rune]);
      bkmpTowerRunRunes += 1;
      parts.push('🔮 Rune');
      const egg = bkmpDungeonRollEgg(idx);
      if (egg) { bkmpDungeonPersistEgg(egg); bkmpTowerRunEggs += 1; parts.push('🥚 Ei'); }
    } else if (wave % 25 === 0) {
      const rune = bkmpDungeonRollRune(idx);
      bkmpDungeonPersistRunes([rune]);
      bkmpTowerRunRunes += 1;
      parts.push('🔮 Rune');
    }
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🗼 Stufe ${wave} erreicht! ${parts.join(' · ')}`, 3600);
  }
  /* Gleiche 30%-Zwischenheilung wie im Dungeon (siehe
     bkmpDungeonHandleWaveCleared) - kein Voll-Heil, sonst zaehlt am Ende
     nur noch die letzte Welle. */
  bkmpIdleVillageHp = Math.min(s.hp, bkmpIdleVillageHp + s.hp * 0.30);
  bkmpTowerSpawnWave(wave + 1);
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}
function bkmpTowerFinish(reachedWave) {
  bkmpTowerActive = false;
  if (bkmpTowerTimerInterval) { clearInterval(bkmpTowerTimerInterval); bkmpTowerTimerInterval = null; }
  const banner = document.getElementById('idleTurmBanner');
  if (banner) banner.style.display = 'none';
  const stageBar = document.getElementById('idleStageBar');
  if (stageBar) stageBar.style.display = '';

  bkmpIdleCurrentDragon = bkmpTowerPrevDragon;
  bkmpIdleVillageHp = bkmpTowerPrevVillageHp;
  if (bkmpIdleCurrentDragon) {
    bkmpDungeonApplyDragonVisuals(bkmpIdleCurrentDragon);
  } else if (typeof bkmpIdleSpawnDragon === 'function') {
    bkmpIdleSpawnDragon();
  }
  bkmpIdleUpdateDragonHpBar();
  bkmpIdleUpdateVillageHpBar();
  if (typeof bkmpIdleRenderStageBar === 'function') bkmpIdleRenderStageBar();

  const prevBest = Number(bkmpIdleState.turm_highest_wave || 0);
  const isNewBest = reachedWave > prevBest;
  if (isNewBest) bkmpIdleState.turm_highest_wave = reachedWave;
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();

  const rewardParts = [];
  if (bkmpTowerRunGold > 0) rewardParts.push(`+${bkmpIdleFormatNumber(bkmpTowerRunGold)} 💰`);
  if (bkmpTowerRunXp > 0) rewardParts.push(`+${bkmpIdleFormatNumber(bkmpTowerRunXp)} XP`);
  if (bkmpTowerRunCrystals > 0) rewardParts.push(`+${bkmpTowerRunCrystals} 💎`);
  if (bkmpTowerRunRunes > 0) rewardParts.push(`${bkmpTowerRunRunes}× 🔮`);
  if (bkmpTowerRunEggs > 0) rewardParts.push(`${bkmpTowerRunEggs}× 🥚`);
  const rewardText = rewardParts.length ? rewardParts.join(' &middot; ') : '—';
  /* Schliessbare Karte statt Toast (Spieler-Vorgabe 16.07.) - ein Toast
     verschwindet von selbst, genau das war das gemeldete Problem, wenn man
     beim Fallen des Dorfes gerade nicht hingeschaut hat. */
  bkmpIdleShowDismissibleResultCard('bkmpTowerResultOverlay', `
    <small>🗼 Endloser Turm</small>
    <strong>${isNewBest ? '🏆 Neuer Rekord!' : `💀 Stufe ${reachedWave}`}</strong>
    <p>${isNewBest ? `Neue Bestmarke: Stufe ${reachedWave} (vorher ${prevBest}).` : `Stufe ${reachedWave} erreicht (Rekord bleibt Stufe ${prevBest}).`}<br>Belohnung: ${rewardText}</p>
  `);
  if (bkmpIdleActiveTab === 'turm' && typeof bkmpIdleRenderTurmPanel === 'function') bkmpIdleRenderTurmPanel();
}
function bkmpTowerHandleDefeat() {
  /* bkmpTowerWave ist die Welle, an der man gestorben ist - die wurde
     NICHT ueberstanden, siehe wavesCleared-Logik in bkmpDungeonFinish fuer
     dasselbe Muster. */
  bkmpTowerFinish(Math.max(0, bkmpTowerWave - 1));
}
function bkmpTowerGiveUp() {
  if (!bkmpTowerActive) return;
  bkmpTowerFinish(Math.max(0, bkmpTowerWave - 1));
}

// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). (2b-Ergaenzung)

function bkmpIdleRenderTurmPanel() {
  const panel = document.getElementById('idlePanelTurm');
  if (!panel || !bkmpIdleState) return;
  const best = Number(bkmpIdleState.turm_highest_wave || 0);
  const lastAttempt = Date.parse(bkmpIdleState.turm_last_attempt_at || '');
  const attemptedToday = Number.isFinite(lastAttempt) && bkmpBerlinDateKey(new Date(lastAttempt)) === bkmpBerlinDateKey(new Date());
  const remainingMs = attemptedToday ? Math.max(0, bkmpBerlinNextMidnight().getTime() - Date.now()) : 0;
  const ready = !attemptedToday && !bkmpTowerActive && !bkmpDungeonActive;
  panel.innerHTML = `
    <div class="idle-dungeon-intro">
      <h4>🗼 Endloser Turm</h4>
      <p>Wellen ohne Ende - keine Schwierigkeitsstufe, kein Limit. Jede Stufe wird härter als die letzte, bis dein Dorf fällt. Ein Versuch pro Tag, Reset immer um Mitternacht (Europe/Berlin).</p>
      <p class="idle-dungeon-seasonal-hint">🎁 Belohnungen: jede besiegte Welle Gold + EXP · alle 5 Stufen (5, 10, 15, ...) zusätzlich Kristalle · alle 25 Stufen (25, 75, 125, ...) zusätzlich eine Rune · alle 50 Stufen (50, 100, 150, ...) zusätzlich Rune + Drachenei. Je höher die Stufe, desto besser die Rune-/Ei-Rarität.</p>
    </div>
    <div class="idle-dungeon-type-grid">
      <div class="idle-dungeon-card">
        <p>🏆 Aktueller Rekord: <b>Stufe ${best}</b></p>
        <p>${ready ? '✅ Bereit für einen Versuch' : bkmpTowerActive ? '⚔️ Lauf aktiv...' : `⏳ Nächster Versuch um Mitternacht (in ${bkmpDungeonFormatCountdown(Math.ceil(remainingMs / 1000))})`}</p>
        <button type="button" class="btn-ja" id="idleTurmStartBtn" ${ready ? '' : 'disabled'}>🗼 Turm betreten</button>
      </div>
    </div>
  `;
  const btn = document.getElementById('idleTurmStartBtn');
  if (btn) btn.addEventListener('click', bkmpTowerStart);
}
