// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). js/systems/bkmp-events.js


function bkmpIdleEventDragonExcludedIds() {
  const s = bkmpIdleEventDragonState;
  const excluded = [];
  if (s && s.shenloss_defeated) excluded.push('shenloss');
  if (s && s.liber_defeated) excluded.push('liber');
  return excluded;
}

/* ---------------- Vorbereitungs-Popup: seltene Event-Drachen ----------------
   Erscheint bei JEDEM Auftauchen eines noch nicht besiegten Event-Drachen
   (nicht nur beim ersten Mal - siehe bkmpIdleSpawnDragon, das diese
   Funktion nach jedem Spawn aufruft). Solange bkmpIdleEventPauseActive
   true ist, wird der komplette Kampf angehalten: der Tick-Loop wird
   gestoppt (bkmpIdleStartLoop() selbst weigert sich ausserdem, waehrend
   der Pause einen neuen Loop zu starten - zentrale Sperre gegen jeden
   Aufrufer, auch bkmpRaidStopCombatView()), Klicks auf den Drachen werden
   ignoriert (bkmpIdleHandleDragonClick) und ein Stufenwechsel ist
   gesperrt (bkmpIdleJumpToStage). */
const BKMP_IDLE_EVENT_DRAGON_POPUPS = {
  shenloss: { title: 'Shenloss erscheint!', message: 'Ehm Kaledoss? Bist du das?', button: 'Ich bin bereit! Angriff!' },
  liber: { title: 'Ganz Liber Drache erscheint!', message: 'Ehm Liber, hast du jetzt eine Drachen Form?', button: 'Ich bin bereit! Angriff!' }
};

function bkmpIdleMaybeShowEventDragonPopup() {
  const d = bkmpIdleCurrentDragon;
  const overlay = document.getElementById('idleEventDragonOverlay');
  if (!d || !d.isEventDragon || bkmpIdleEventDragonExcludedIds().includes(d.eventDragonKey)) {
    bkmpIdleEventPauseActive = false;
    if (overlay) overlay.classList.remove('visible');
    return;
  }
  const cfg = BKMP_IDLE_EVENT_DRAGON_POPUPS[d.eventDragonKey];
  if (!cfg) { bkmpIdleEventPauseActive = false; return; }
  bkmpIdleEventPauseActive = true;
  bkmpIdleStopLoop();
  const titleEl = document.getElementById('idleEventDragonTitle');
  const msgEl = document.getElementById('idleEventDragonMessage');
  const btnEl = document.getElementById('idleEventDragonReadyBtn');
  if (titleEl) titleEl.textContent = cfg.title;
  if (msgEl) msgEl.textContent = cfg.message;
  if (btnEl) btnEl.textContent = cfg.button;
  if (overlay) overlay.classList.add('visible');
}

function bkmpIdleConfirmEventDragonReady() {
  if (!bkmpIdleEventPauseActive) return;
  bkmpIdleEventPauseActive = false;
  const overlay = document.getElementById('idleEventDragonOverlay');
  if (overlay) overlay.classList.remove('visible');
  if (bkmpIdleModalOpen) bkmpIdleStartLoop();
}

/* Meldet einen Sieg gegen einen Event-Drachen serverseitig (siehe
   idle_claim_event_dragon_victory() in supabase-idle-event-dragons.sql) -
   einziger Weg, shenloss_defeated/liber_defeated dauerhaft zu setzen.
   Aktualisiert bei Erfolg sofort den lokalen Cache, damit der Titel ohne
   Neuladen sichtbar wird und der Drache ab sofort nie wieder spawnt. */
async function bkmpIdleClaimEventDragonVictory(defeatedDragon) {
  if (!defeatedDragon || !defeatedDragon.isEventDragon) return;
  const key = defeatedDragon.eventDragonKey;
  try {
    const result = typeof idleClaimEventDragonVictory === 'function'
      ? await idleClaimEventDragonVictory(bkmpIdleState.name_key, key)
      : null;
    if (!result || !result.newly_defeated) return;
    if (!bkmpIdleEventDragonState) bkmpIdleEventDragonState = { shenloss_defeated: false, liber_defeated: false };
    if (key === 'shenloss') bkmpIdleEventDragonState.shenloss_defeated = true;
    else if (key === 'liber') bkmpIdleEventDragonState.liber_defeated = true;
    bkmpIdleGetAchievementContextFields();
    const titleName = key === 'shenloss' ? 'DragonBall Herrscher' : 'Du hast ihn besiegt.';
    bkmpIdleLog(`🏆 ${defeatedDragon.name} besiegt! Titel „${titleName}" dauerhaft freigeschaltet!`);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🎉 ${defeatedDragon.name} besiegt! Neuer Titel: „${titleName}"`, 4500);
    if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
  } catch (e) {
    console.warn('Idle Dorf: Sieg gegen Event-Drache konnte nicht gespeichert werden.', e);
  }
}

/* Taegliche Login-Streak: rein clientseitig (localStorage), da nur ein
   "wievielter Tag in Folge" gebraucht wird - kein geraeteuebergreifender
   Abgleich noetig, kein Risiko fuer den bestehenden Sync-Mechanismus.
   Bonus fliesst in die bereits synchronisierten Felder gold/crystals -
   keine neue DB-Spalte, kein Wiederholungsrisiko der Zerstoertes-Dorf-
   Regression (siehe supabase.js BKMP_IDLE_PLAYER_STATE_COLUMNS). */
const BKMP_IDLE_STREAK_KEY = 'bkmp-idle-login-streak';
function bkmpIdleDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function bkmpIdleGetStreakData() {
  try { return JSON.parse(localStorage.getItem(BKMP_IDLE_STREAK_KEY) || 'null') || { count: 0, lastDate: null }; } catch (e) { return { count: 0, lastDate: null }; }
}
function bkmpIdleSaveStreakData(data) {
  try { localStorage.setItem(BKMP_IDLE_STREAK_KEY, JSON.stringify(data)); } catch (e) {}
}
/* GameClock-Migration (24.07.2026, siehe CLAUDE.md/js/core/bkmp-game-clock.js):
   bewusst die ERSTE (und fuer Phase 1 einzige) migrierte Zeitstelle - rein
   clientseitig (localStorage, kein Server-Schreibzugriff), macht diesen
   Tageswechsel-Check im lokalen QA-Modus per Panel-Zeitsprung testbar, ohne
   echte Tage abwarten zu muessen. bkmpGetGameNow() ist ausserhalb des
   QA-Modus IMMER identisch zu Date.now() (siehe Datei-Kommentar dort) - kein
   Verhaltensunterschied im normalen Spiel. Alle anderen Date.now()/new
   Date()-Stellen (Kampf-Tick, Offline-Claim, Sync-Sperren in idledorf.js)
   sind ABSICHTLICH nicht migriert, siehe CLAUDE.md. */
function bkmpIdleCheckDailyStreak() {
  if (!bkmpIdleState) return;
  const gameNow = typeof bkmpGetGameNow === 'function' ? bkmpGetGameNow() : Date.now();
  const data = bkmpIdleGetStreakData();
  const today = bkmpIdleDateStr(new Date(gameNow));
  if (data.lastDate === today) return;
  const yesterday = bkmpIdleDateStr(new Date(gameNow - 86400000));
  const newCount = data.lastDate === yesterday ? Number(data.count || 0) + 1 : 1;
  bkmpIdleSaveStreakData({ count: newCount, lastDate: today });
  const goldBonus = Math.min(10000, 500 * newCount);
  const gemBonus = newCount % 5 === 0 ? 10 : 0;
  bkmpIdleState.gold = Number(bkmpIdleState.gold || 0) + goldBonus;
  if (gemBonus > 0) bkmpIdleState.crystals = Number(bkmpIdleState.crystals || 0) + gemBonus;
  bkmpIdleQueueSync();
  /* Phase 5.5 (19.07.): Belohnung ist bereits oben vergeben+lokal gespeichert
     (localStorage lastDate=heute), BEVOR hier irgendetwas angezeigt wird -
     ein Reload waehrend/nach der Anzeige kann also nie ein zweites Mal
     auszahlen. Jeder 5. Tag hat bereits HEUTE einen echten Mehrwert
     (gemBonus, siehe oben) - dieselbe bestehende Schwelle entscheidet auch
     hier Toast (normaler Tag) vs. Karte (5er-Meilenstein), keine neue
     Grenze erfunden. */
  const gemMsg = gemBonus > 0 ? ` +${gemBonus} 💎` : '';
  const rewardMsg = `+${bkmpIdleFormatNumber(goldBonus)} 💰${gemMsg}`;
  if (typeof bkmpRewardPresent === 'function') {
    /* Toast zeigt nur `title` an (kein separates `description`-Feld dort,
       siehe bkmpRewardPresent) - Betrag deshalb im Toast-Fall direkt in den
       Titeltext eingebaut, bei der Karte bleibt er als eigene Zeile. */
    bkmpRewardPresent({
      tier: gemBonus > 0 ? 'card' : 'toast',
      rarity: gemBonus > 0 ? 'selten' : null,
      icon: '🔥',
      title: gemBonus > 0 ? `${newCount}. Tag in Folge!` : `${newCount}. Tag in Folge! ${rewardMsg}`,
      description: gemBonus > 0 ? rewardMsg : undefined,
      source: 'Login-Streak',
      dedupeKey: `login-streak-${today}`
    });
  } else if (typeof bkmpShowJannikToast === 'function') {
    bkmpShowJannikToast(`🔥 ${newCount}. Tag in Folge! +${bkmpIdleFormatNumber(goldBonus)} 💰${gemMsg}`, 4200);
  }
}
