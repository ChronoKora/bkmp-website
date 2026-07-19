// Bkmp - Redesign Phase 2a (17.07.): mechanisch aus idledorf.js extrahiert (mit einem AST-Parser exakt abgegrenzt, keine Logik veraendert). js/systems/bkmp-prestige.js

let bkmpPrestigeState = null;
let bkmpPrestigeLoadFailed = false;
let bkmpPrestigeSaving = false;

/* ============================================================
   Prestige: dauerhafter Aufstieg, sobald die per bkmpPrestigeRequiredStage()
   berechnete Ziel-Stufe erreicht ist (steigt mit jeder Prestige-Stufe:
   100/150/200/... - siehe dort). Setzt den laufenden Durchgang zurueck (Level/Gold/Rohstoffe/
   Skilltree/Upgrades/Drachen-Fortschritt), vergibt dafuer Prestige-Punkte
   fuer einen KLEINEN, DAUERHAFTEN Bonusbaum (idle_prestige_state, siehe
   supabase-idle-prestige.sql) sowie einen sofortigen, festen Bonus pro
   Prestige-Stufe (siehe bkmpIdleRecomputeEffectiveStats). Lebenszeit-Werte
   (Spielzeit, Gesamt-Gold-verdient, Erfolge/Titel/Kosmetiken) bleiben
   unangetastet - nur der aktuelle "Lauf" wird zurueckgesetzt. */

/* Die noetige Stufe steigt mit jedem Aufstieg um 50 (Stufe 100/"10-0" fuer
   den ersten Aufstieg, 150/"15-0" fuer den zweiten, 200/"20-0" fuer den
   dritten, ...) - vorher war die Schwelle immer fix bei 100, wodurch jeder
   weitere Aufstieg dank der bereits erspielten dauerhaften Boni (Prestige-
   Baum + feste +5%/Stufe) spuerbar SCHNELLER wurde statt wie in den
   meisten Idle-Games mit jeder Stufe ein eigener, groesserer Meilenstein
   zu bleiben. prestigeLevel = bereits abgeschlossene Aufstiege (0 vor dem
   ersten). */
function bkmpPrestigeRequiredStage(prestigeLevel) {
  return 100 + Math.max(0, Math.floor(Number(prestigeLevel) || 0)) * 50;
}

/* Werte bewusst hoeher als eine erste Fassung (3-5%/Rang): bei den Kosten
   1,2,3...N Punkte pro Rang kostet ein voll ausgebauter 10-Rang-Knoten 55
   Punkte, ein erster Aufstieg (Mindest-Drachenstufe 100) bringt aber nur
   ~6 Punkte - bei niedrigen %-Werten fuehlte sich der erste, fuer den
   kompletten Reset des Fortschritts erkaufte Aufstieg viel zu mickrig an.
   portal_meisterschaft bleibt bei 8% statt hoeher, weil er sich selbst
   verstaerkt (mehr Punkte -> schneller mehr Punkte) und sonst zu schnell
   explodiert. */
const BKMP_PRESTIGE_UPGRADES = [
  { id: 'ewiges_feuer', name: 'Ewiges Feuer', desc: '+8% Angriff pro Rang - dauerhaft, übersteht jeden Aufstieg.', icon: '🔥', effectType: 'attack_pct', effectPerRank: 8, maxRank: 20 },
  { id: 'drachenblut', name: 'Drachenblut', desc: '+8% Leben pro Rang - dauerhaft.', icon: '🩸', effectType: 'hp_pct', effectPerRank: 8, maxRank: 20 },
  { id: 'goldene_ranken', name: 'Goldene Ranken', desc: '+8% Gold-Ausbeute pro Rang - dauerhaft.', icon: '🌿', effectType: 'gold_prod_pct', effectPerRank: 8, maxRank: 20 },
  { id: 'zeitraffer', name: 'Zeitraffer', desc: '+8% XP pro Rang - dauerhaft.', icon: '⏳', effectType: 'xp_pct', effectPerRank: 8, maxRank: 20 },
  { id: 'kristallkern', name: 'Kristallkern', desc: '+10% Kritischer Schaden pro Rang - dauerhaft.', icon: '💠', effectType: 'crit_damage_pct', effectPerRank: 10, maxRank: 15 },
  { id: 'portal_meisterschaft', name: 'Portal-Meisterschaft', desc: '+8% mehr Prestige-Punkte bei jedem künftigen Aufstieg pro Rang.', icon: '🌌', effectType: 'prestige_point_bonus_pct', effectPerRank: 8, maxRank: 10 }
];

function bkmpPrestigeUpgradeCost(rankBeingBought) {
  return Math.max(1, Math.round(rankBeingBought));
}

function bkmpPrestigeEffectTotals(allocations) {
  const totals = {};
  const alloc = allocations || {};
  BKMP_PRESTIGE_UPGRADES.forEach(def => {
    const rank = Number(alloc[def.id] || 0);
    if (rank <= 0) return;
    totals[def.effectType] = (totals[def.effectType] || 0) + rank * def.effectPerRank;
  });
  return totals;
}

function bkmpPrestigeEligible() {
  if (!bkmpIdleState) return false;
  /* Bei fehlgeschlagenem Laden NICHT wie "prestige_level 0" behandeln -
     das wuerde die Mindeststufe zu niedrig ansetzen und den Button
     freischalten, obwohl der echte (aber gerade nicht geladene) Stand
     schon viel weiter ist. */
  if (bkmpPrestigeLoadFailed) return false;
  const level = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : 0;
  return Number(bkmpIdleState.highest_dragon_index || 0) >= bkmpPrestigeRequiredStage(level);
}

/* Faustformel: (Stufe/20)^1.15, abgerundet - Stufe 100 -> 6 Punkte,
   Stufe 200 -> 14, Stufe 500 -> 41. Bewusst kein reines Geschenk: ein
   Aufstieg lohnt sich erst, wenn man deutlich ueber die Mindeststufe
   hinausgekommen ist. */
function bkmpPrestigePointsForStage(stage) {
  return Math.max(0, Math.floor(Math.pow(Math.max(0, stage) / 20, 1.15)));
}

function bkmpPrestigeBuyUpgrade(id) {
  const def = BKMP_PRESTIGE_UPGRADES.find(u => u.id === id);
  if (!def || !bkmpPrestigeState) return;
  const alloc = bkmpPrestigeState.prestige_allocations || (bkmpPrestigeState.prestige_allocations = {});
  const rank = Number(alloc[id] || 0);
  if (rank >= def.maxRank) return;
  const cost = bkmpPrestigeUpgradeCost(rank + 1);
  const available = Number(bkmpPrestigeState.prestige_points || 0) - Number(bkmpPrestigeState.prestige_points_spent || 0);
  if (available < cost) return;
  alloc[id] = rank + 1;
  bkmpPrestigeState.prestige_points_spent = Number(bkmpPrestigeState.prestige_points_spent || 0) + cost;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderPrestigePanel();
  bkmpIdleRenderHud();
  bkmpPrestigeQueueSave();
}

/* Gleiche Twitch-Sync-Absicherung wie bkmpIdleMergeBaseline/
   -RemoteSpendableFields oben, nur fuer die separate idle_prestige_state-
   Tabelle (Prestige-Punkte fuer den permanenten Bonusbaum). */
let bkmpPrestigeMergeBaseline = null;
let bkmpPrestigeSkipNextMerge = false;

function bkmpPrestigeSnapshotMergeBaseline() {
  bkmpPrestigeMergeBaseline = bkmpPrestigeState ? { prestige_points_spent: Number(bkmpPrestigeState.prestige_points_spent || 0) } : null;
}

/* Gleicher Race-Fix wie bkmpIdleMergeInFlight bei
   bkmpIdleMergeRemoteSpendableFields - siehe dort fuer die volle
   Erklaerung (ueberlappende Herzschlag-/Autosave-Aufrufe konnten sich
   sonst mit unterschiedlich "frischen" remote/baseline-Staenden
   ueberschneiden). */
let bkmpPrestigeMergeInFlight = false;
async function bkmpPrestigeMergeRemoteSpendable() {
  if (!bkmpPrestigeState || typeof loadIdlePrestigeState !== 'function') return;
  if (bkmpPrestigeMergeInFlight) return;
  bkmpPrestigeMergeInFlight = true;
  try {
  const remote = await loadIdlePrestigeState(bkmpPrestigeState.name_key);
  if (!remote) return;
  bkmpPrestigeState.prestige_allocations = bkmpIdleMergeCountMaps(bkmpPrestigeState.prestige_allocations, remote.prestige_allocations);
  const baseline = bkmpPrestigeMergeBaseline || bkmpPrestigeState;
  const spentDelta = Number(bkmpPrestigeState.prestige_points_spent || 0) - Number(baseline.prestige_points_spent || 0);
  bkmpPrestigeState.prestige_points_spent = Math.max(0, Number(remote.prestige_points_spent || 0) + Math.max(0, spentDelta));
  bkmpPrestigeState.prestige_points = Math.max(Number(bkmpPrestigeState.prestige_points || 0), Number(remote.prestige_points || 0));
  bkmpPrestigeSnapshotMergeBaseline();
  } finally {
    bkmpPrestigeMergeInFlight = false;
  }
}

let bkmpPrestigeSaveTimer = null;
function bkmpPrestigeQueueSave() {
  if (bkmpPrestigeSaveTimer) return;
  bkmpPrestigeSaveTimer = window.setTimeout(() => { bkmpPrestigeSaveTimer = null; bkmpPrestigeFlushSave(); }, 1500);
}

async function bkmpPrestigeFlushSave() {
  if (!bkmpPrestigeState) return;
  if (window.BKMP_IDLE_IS_STREAM_PAGE && !bkmpPrestigeSkipNextMerge) {
    try { await bkmpPrestigeMergeRemoteSpendable(); } catch (e) { /* naechster Speichervorgang versucht es erneut */ }
  }
  bkmpPrestigeSkipNextMerge = false;
  try {
    if (typeof saveIdlePrestigeState === 'function') await saveIdlePrestigeState(bkmpPrestigeState);
    bkmpPrestigeSnapshotMergeBaseline();
  } catch (e) { console.warn('Prestige: Speichern fehlgeschlagen (Migration ausgefuehrt?).', e); }
}

/* Erzwingt ein sofortiges Speichern des Prestige-Standes, ohne auf den
   1,5s-Debounce zu warten - gebraucht vom Single-Session-Rauswurf
   (bkmpClaimAndWatchSession in index.html), damit die letzten paar Sekunden
   Fortschritt nicht verloren gehen, wenn ein Geraet durch ein Login
   anderswo zwangsweise beendet wird. */
async function bkmpPrestigeFlushSyncNow() {
  if (bkmpPrestigeSaveTimer) { window.clearTimeout(bkmpPrestigeSaveTimer); bkmpPrestigeSaveTimer = null; }
  if (!bkmpPrestigeState) return;
  try { if (typeof saveIdlePrestigeState === 'function') await saveIdlePrestigeState(bkmpPrestigeState); }
  catch (e) { console.warn('Prestige: Speichern fehlgeschlagen.', e); }
}

// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). (2b-Ergaenzung)

/* ============================================================
   Section C (18.07.): Prestige-Zeremonie-Redesign. Ersetzt NUR die
   Praesentationsschicht (Panel-Layout, Bestaetigungsablauf, Erfolgs-
   Zeremonie) - die Rechenlogik/Reset-Reihenfolge/Speicherlogik unterhalb
   (bkmpPrestigeExecuteReset) ist wortwoertlich unveraendert aus der
   vorherigen bkmpIdlePerformPrestige uebernommen, nur in eine eigene
   Funktion ausgelagert, die jetzt vom neuen zweistufigen Bestaetigungs-
   Dialog statt einem einzelnen bkmpConfirmDialog() aufgerufen wird.

   bkmpPrestigeGetPreview() ist die EINZIGE Quelle der Wahrheit fuer alle
   angezeigten Zahlen (Panel UND Dialog UND Zeremonie) - liest nur,
   veraendert nichts, damit Anzeige und tatsaechliches Ergebnis nie
   auseinanderlaufen koennen. */
function bkmpPrestigeGetPreview() {
  if (!bkmpIdleState) return null;
  const stage = Number(bkmpIdleState.highest_dragon_index || 0);
  const level = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : 0;
  const requiredStage = bkmpPrestigeRequiredStage(level);
  const bonusPct = bkmpPrestigeState ? (bkmpPrestigeEffectTotals(bkmpPrestigeState.prestige_allocations).prestige_point_bonus_pct || 0) : 0;
  const pointsGained = Math.max(1, Math.round(bkmpPrestigePointsForStage(stage) * (1 + bonusPct / 100)));
  const totalPointsBefore = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points || 0) : 0;
  return {
    stage, level, requiredStage,
    eligible: bkmpPrestigeEligible(),
    pointsGained,
    totalPointsBefore,
    totalPointsAfter: totalPointsBefore + pointsGained,
    runeCount: bkmpIdlePlayerRunes.length,
    currentBonusPct: level * 5,
    nextLevel: level + 1,
    nextBonusPct: (level + 1) * 5,
    nextRequiredStage: bkmpPrestigeRequiredStage(level + 1),
    dragonKills: Number(bkmpIdleState.dragon_kills || 0),
    bossKills: Number(bkmpIdleState.boss_kills || 0),
    lifetimeStage: typeof bkmpIdleLifetimeStageCount === 'function' ? bkmpIdleLifetimeStageCount() : (Number(bkmpIdleState.prestige_stage_offset || 0) + stage),
    playtimeMinutes: Math.round(Number(bkmpIdleState.playtime_seconds || 0) / 60)
  };
}

/* Nur tatsaechlich zurueckgesetzte Werte (1:1 gegen bkmpPrestigeExecuteReset
   unten geprueft) - keine erfundenen Eintraege. */
function bkmpPrestigeResetItems(preview) {
  const p = preview || bkmpPrestigeGetPreview();
  if (!p) return [];
  return [
    { icon: '📉', text: 'Level (zurück auf 1) und alle Erfahrungspunkte' },
    { icon: '💰', text: 'Alle Rohstoffe: Gold, Holz, Stein, Kristalle, Essenz' },
    { icon: '🌳', text: 'Skilltree – alle Skillpunkte und ihre Verteilung' },
    { icon: '⬆️', text: 'Gekaufte Dorf-Upgrades' },
    { icon: '🏭', text: 'Alle Produktionsgebäude (Obstgarten, Jagdhütte, Holzfällerlager, Steinbruch, Goldmine, Kristallmine, Manaquelle, Magierakademie)' },
    { icon: '🐉', text: `Deine aktuelle Drachen-Stufe (${bkmpIdleFormatStage(p.stage)}) – du startest wieder bei Stufe 0-0` }
  ];
}

/* Nur tatsaechlich permanente Inhalte - Erfolge/Titel/Kosmetiken werden
   bewusst mit aufgefuehrt (existierende Systeme, aber vom Reset-Block in
   bkmpPrestigeExecuteReset nachweislich nie angefasst), keine fremden
   Systeme neu erfunden. */
function bkmpPrestigeKeepItems(preview) {
  const p = preview || bkmpPrestigeGetPreview();
  if (!p) return [];
  return [
    { icon: '🌌', text: `Prestige-Stufe ${p.nextLevel} und dein permanenter Bonusbaum (${bkmpIdleFormatNumber(p.totalPointsAfter)} Punkte gesamt)` },
    { icon: '✨', text: `Dauerhafter Bonus: +${p.nextBonusPct}% Angriff/Leben/Gold/XP` },
    { icon: '💠', text: p.runeCount > 0 ? `Deine komplette Runen-Sammlung (${bkmpIdleFormatNumber(p.runeCount)} Runen inkl. Ausrüstung, Stufen &amp; Sub-Stats)` : 'Deine Runen-Sammlung (aktuell leer)' },
    { icon: '🏆', text: 'Erfolge, Titel &amp; Kosmetiken' },
    { icon: '⚔️', text: `Gesamt besiegte Drachen (${bkmpIdleFormatNumber(p.dragonKills)}) &amp; Bosse (${bkmpIdleFormatNumber(p.bossKills)})` },
    { icon: '📈', text: `Insgesamt erreichte Drachen-Stufen (${bkmpIdleFormatNumber(p.lifetimeStage)})` },
    { icon: '⏱️', text: `Deine gesamte Spielzeit (${bkmpIdleFormatNumber(p.playtimeMinutes)} Min.)` }
  ];
}

function bkmpPrestigeRenderInfoList(items) {
  return `<ul class="idle-prestige-list">${items.map(i => `<li><span class="idle-prestige-list-icon" aria-hidden="true">${i.icon}</span><span>${i.text}</span></li>`).join('')}</ul>`;
}

/* ---------------- Zweistufiger Bestaetigungsdialog ---------------- */
let bkmpPrestigeConfirmPreview = null;
let bkmpPrestigeConfirmSubmitting = false;
let bkmpPrestigeConfirmErrored = false;

function bkmpPrestigeOpenConfirmFlow() {
  const overlay = document.getElementById('idlePrestigeConfirmOverlay');
  const preview = bkmpPrestigeGetPreview();
  if (!overlay || !preview || !preview.eligible) return;
  bkmpPrestigeConfirmPreview = preview;
  bkmpPrestigeConfirmSubmitting = false;
  bkmpPrestigeRenderConfirmStep('preview');
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');
  const nextBtn = document.getElementById('idlePrestigeConfirmNextBtn');
  if (nextBtn) nextBtn.focus();
}

function bkmpPrestigeRenderConfirmStep(step) {
  const overlay = document.getElementById('idlePrestigeConfirmOverlay');
  if (!overlay || !bkmpPrestigeConfirmPreview) return;
  const p = bkmpPrestigeConfirmPreview;
  overlay.dataset.step = step;
  const gainEl = document.getElementById('idlePrestigeConfirmGain');
  if (gainEl) gainEl.innerHTML = `+${bkmpIdleFormatNumber(p.pointsGained)} Prestige-Punkte &middot; neuer dauerhafter Bonus +${p.nextBonusPct}%`;
  const resetEl = document.getElementById('idlePrestigeConfirmResetList');
  if (resetEl) resetEl.innerHTML = bkmpPrestigeRenderInfoList(bkmpPrestigeResetItems(p));
  const keepEl = document.getElementById('idlePrestigeConfirmKeepList');
  if (keepEl) keepEl.innerHTML = bkmpPrestigeRenderInfoList(bkmpPrestigeKeepItems(p));
  const finalGainEl = document.getElementById('idlePrestigeConfirmFinalGain');
  if (finalGainEl) finalGainEl.innerHTML = `+${bkmpIdleFormatNumber(p.pointsGained)} Prestige-Punkte<br>Dauerhafter Bonus: +${p.nextBonusPct}% Angriff/Leben/Gold/XP`;
  const finalBtn = document.getElementById('idlePrestigeConfirmFinalBtn');
  /* Setzt auch style.display zurueck, das der (seltene, defensive)
     Fehlerpfad in bkmpPrestigeConfirmFinalize() setzt (finalBtn versteckt) -
     sonst wuerde ein einmal aufgetretener Fehler diesen Button dauerhaft
     fuer JEDEN spaeteren Aufstiegsversuch in diesem Tab kaputt lassen. */
  if (finalBtn) { finalBtn.disabled = false; finalBtn.textContent = '🌌 Jetzt endgültig aufsteigen'; finalBtn.style.display = ''; }
  const backBtn = document.getElementById('idlePrestigeConfirmBackBtn');
  if (backBtn) { backBtn.disabled = false; backBtn.textContent = 'Zurück'; }
  const errEl = document.getElementById('idlePrestigeConfirmError');
  if (errEl) { errEl.textContent = ''; errEl.classList.remove('visible'); }
  bkmpPrestigeConfirmErrored = false;
}

function bkmpPrestigeConfirmGoToFinal() {
  if (!bkmpPrestigeConfirmPreview) return;
  bkmpPrestigeRenderConfirmStep('final');
  const btn = document.getElementById('idlePrestigeConfirmFinalBtn');
  if (btn) btn.focus();
}

/* Der "Zurueck"-Button ist IMMER derselbe, einmal in bkmpPrestigeInit()
   verdrahtete Button (kein onclick-Reassignment, um nicht mit dem dort
   bereits registrierten addEventListener zu kollidieren) - im (seltenen)
   Fehlerfall wird er nur umbeschriftet ("Schliessen") und dieser Handler
   prueft bkmpPrestigeConfirmErrored, um dann komplett zu schliessen statt
   zur Vorschau zurueckzuspringen. Zurueck zur Vorschau wuerde den bereits
   deaktivierten "Jetzt aufsteigen"-Button wieder aktivieren und so einen
   zweiten bkmpPrestigeExecuteReset()-Aufruf ermoeglichen - genau die
   doppelte Ausfuehrung, die verhindert werden soll. */
function bkmpPrestigeConfirmGoToPreview() {
  if (!bkmpPrestigeConfirmPreview || bkmpPrestigeConfirmSubmitting) return;
  if (bkmpPrestigeConfirmErrored) { bkmpPrestigeConfirmCancel(); return; }
  bkmpPrestigeRenderConfirmStep('preview');
  const btn = document.getElementById('idlePrestigeConfirmNextBtn');
  if (btn) btn.focus();
}

function bkmpPrestigeConfirmCancel() {
  if (bkmpPrestigeConfirmSubmitting) return;
  const overlay = document.getElementById('idlePrestigeConfirmOverlay');
  if (overlay) overlay.classList.remove('visible');
  document.body.classList.remove('modal-open');
  bkmpPrestigeConfirmPreview = null;
  bkmpPrestigeConfirmErrored = false;
}

/* Finaler Bestaetigungs-Klick. bkmpPrestigeSaving wird synchron VOR dem
   ersten await geprueft/gesetzt (siehe bkmpPrestigeExecuteReset) - das ist
   dieselbe Doppelklick-Sperre wie vorher, hier zusaetzlich noch am Button
   selbst gespiegelt (disabled+Text), damit auch optisch sofort sichtbar
   ist, dass ein Klick bereits verarbeitet wird. */
async function bkmpPrestigeConfirmFinalize() {
  if (bkmpPrestigeSaving || bkmpPrestigeConfirmSubmitting || !bkmpPrestigeConfirmPreview) return;
  /* Erneute Pruefung (gleiche Funktion wie beim Oeffnen des Dialogs) - der
     Dialog kann beliebig lange offen stehen, waehrend der Kampf im
     Hintergrund weiterlaeuft (siehe bkmpIdleCloseModal-Kommentar: Fenster
     zu != Spiel pausiert). Ein Event-Drache koennte also erst WAEHREND der
     offenen Vorschau erscheinen - dieselbe Sperre wie beim urspruenglichen
     Aufruf, nur robuster gegen das laengere Zeitfenster des neuen
     zweistufigen Dialogs. */
  if (bkmpIdleEventPauseActive) {
    bkmpPrestigeConfirmCancel();
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Erst den Event-Drachen bestätigen/bekämpfen, dann kannst du aufsteigen.', 4000);
    return;
  }
  const preview = bkmpPrestigeConfirmPreview;
  const pointsBefore = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points || 0) : 0;
  bkmpPrestigeConfirmSubmitting = true;
  const finalBtn = document.getElementById('idlePrestigeConfirmFinalBtn');
  const backBtn = document.getElementById('idlePrestigeConfirmBackBtn');
  const errEl = document.getElementById('idlePrestigeConfirmError');
  if (finalBtn) { finalBtn.disabled = true; finalBtn.textContent = 'Wird gespeichert…'; }
  if (backBtn) backBtn.disabled = true;
  if (errEl) { errEl.textContent = ''; errEl.classList.remove('visible'); }
  try {
    await bkmpPrestigeExecuteReset();
    const pointsAfter = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points || 0) : 0;
    const actualLevel = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : preview.nextLevel;
    const result = {
      pointsGained: Math.max(0, pointsAfter - pointsBefore),
      nextLevel: actualLevel,
      nextBonusPct: actualLevel * 5
    };
    const overlay = document.getElementById('idlePrestigeConfirmOverlay');
    if (overlay) overlay.classList.remove('visible');
    document.body.classList.remove('modal-open');
    bkmpPrestigeConfirmPreview = null;
    bkmpPrestigeConfirmSubmitting = false;
    bkmpPrestigeShowCeremony(result);
  } catch (e) {
    /* In der Praxis faengt bkmpPrestigeExecuteReset() (genau wie vorher)
       beide Speichervorgaenge bereits INTERN ab (siehe Kommentare dort) -
       dieser Zweig ist also ein defensives Sicherheitsnetz fuer den
       unwahrscheinlichen Fall eines echten Laufzeitfehlers, kein normaler
       Pfad. WICHTIG: bewusst KEIN Button, der bkmpPrestigeExecuteReset()
       erneut aufruft - der Reset (inkl. Punktevergabe) hat zu diesem
       Zeitpunkt bereits lokal stattgefunden (nicht rueckgaengig gemacht),
       ein zweiter Aufruf wuerde Prestige-Stufe/-Punkte ein zweites Mal
       vergeben. Stattdessen nur "Schliessen" - der bereits veraenderte
       Spielstand wird vom regulaeren Autosave (laeuft unabhaengig davon
       weiter) beim naechsten Zyklus ganz normal nachgezogen. */
    console.warn('Prestige: unerwarteter Fehler beim Aufstieg.', e);
    bkmpPrestigeConfirmSubmitting = false;
    if (errEl) {
      errEl.innerHTML = '⚠️ Es gab ein unerwartetes Problem. Dein Aufstieg wurde bereits lokal durchgeführt und wird im Hintergrund automatisch weiter gespeichert – bitte schließe dieses Fenster und lass die Seite offen, bis der nächste automatische Speichervorgang durchgelaufen ist.';
      errEl.classList.add('visible');
    }
    if (finalBtn) { finalBtn.disabled = true; finalBtn.style.display = 'none'; }
    /* bkmpPrestigeConfirmErrored steuert den bereits registrierten
       "Zurueck"-Klick-Handler (bkmpPrestigeConfirmGoToPreview) um, statt
       ein zweites onclick auf denselben Button zu haengen - siehe
       Kommentar dort. */
    bkmpPrestigeConfirmErrored = true;
    if (backBtn) { backBtn.disabled = false; backBtn.textContent = 'Schließen'; }
  }
}

/* ---------------- Zeremonie ---------------- */
let bkmpPrestigeCeremonyDismissTimer = null;

function bkmpPrestigeShowCeremony(result) {
  const overlay = document.getElementById('idlePrestigeCeremonyOverlay');
  if (!overlay) { bkmpIdleRenderActiveTabContent(); return; }
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fxMode = typeof bkmpFxGetMode === 'function' ? bkmpFxGetMode() : 'hoch';
  const instant = reducedMotion || fxMode === 'aus';
  const simplified = fxMode === 'reduziert';

  const levelEl = document.getElementById('idlePrestigeCeremonyLevel');
  if (levelEl) levelEl.textContent = `Aufstieg #${result.nextLevel}`;
  const bonusEl = document.getElementById('idlePrestigeCeremonyBonus');
  if (bonusEl) bonusEl.innerHTML = `+${bkmpIdleFormatNumber(result.pointsGained)} Prestige-Punkte<br><span class="idle-prestige-ceremony-bonus-pct">Dauerhafter Bonus: +${result.nextBonusPct}% Angriff/Leben/Gold/XP</span>`;

  overlay.classList.remove('phase-gather', 'phase-dissolve', 'phase-result', 'is-instant', 'is-simplified');
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');

  if (instant) {
    overlay.classList.add('is-instant', 'phase-result');
    bkmpPrestigeCeremonyDismissTimer = window.setTimeout(bkmpPrestigeCloseCeremony, 1600);
    return;
  }
  if (simplified) overlay.classList.add('is-simplified');
  const gatherMs = simplified ? 500 : 1100;
  const dissolveMs = simplified ? 500 : 900;
  const resultLingerMs = simplified ? 1200 : 1400;
  overlay.classList.add('phase-gather');
  /* Funken nur in "Hoch" (sparsame, EINMALIGE Partikel - "Fortschritt
     loest sich auf", Schritt 4 der Zeremonie) - in "Reduziert" bewusst
     keine, siehe Auftrag Abschnitt 6. Wiederverwendet dieselbe Zufalls-
     Streutechnik wie bkmpFireAchievementConfetti (bkmp-site.js), nur mit
     Amethyst/Gold-Paletten und einwaerts->auswaerts Richtung statt
     Aufwaerts-Burst. */
  if (!simplified) {
    const sparksEl = overlay.querySelector('.idle-prestige-ceremony-sparks');
    if (sparksEl) {
      const colors = ['#a78bfa', '#c9a56a', '#7c3aed', '#e9d5a1'];
      sparksEl.innerHTML = Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
        const dist = 70 + Math.random() * 50;
        const sx = Math.round(Math.cos(angle) * dist);
        const sy = Math.round(Math.sin(angle) * dist);
        const delay = (gatherMs / 1000 + Math.random() * 0.15).toFixed(2);
        return `<span style="background:${colors[i % colors.length]}; --sx:${sx}px; --sy:${sy}px; animation-delay:${delay}s;"></span>`;
      }).join('');
    }
  }
  window.setTimeout(() => { overlay.classList.remove('phase-gather'); overlay.classList.add('phase-dissolve'); }, gatherMs);
  window.setTimeout(() => { overlay.classList.remove('phase-dissolve'); overlay.classList.add('phase-result'); }, gatherMs + dissolveMs);
  bkmpPrestigeCeremonyDismissTimer = window.setTimeout(bkmpPrestigeCloseCeremony, gatherMs + dissolveMs + resultLingerMs);
}

function bkmpPrestigeCloseCeremony() {
  if (bkmpPrestigeCeremonyDismissTimer) { window.clearTimeout(bkmpPrestigeCeremonyDismissTimer); bkmpPrestigeCeremonyDismissTimer = null; }
  const overlay = document.getElementById('idlePrestigeCeremonyOverlay');
  if (overlay) {
    overlay.classList.remove('visible', 'phase-gather', 'phase-dissolve', 'phase-result', 'is-instant', 'is-simplified');
    const sparksEl = overlay.querySelector('.idle-prestige-ceremony-sparks');
    if (sparksEl) sparksEl.innerHTML = '';
  }
  document.body.classList.remove('modal-open');
}

/* Einmalige Verdrahtung, aufgerufen aus bkmpIdleInit() (gleiches Muster wie
   bkmpFxInit()/bkmpRaidInit()). bkmpUiTrapFocus() ist die in Phase 3 bereits
   fertiggestellte, bis jetzt aber an keiner echten Stelle verdrahtete
   Fokus-Falle (siehe js/ui/bkmp-ui-components.js) - hier zum ersten Mal
   tatsaechlich genutzt. */
function bkmpPrestigeInit() {
  const cancelBtn = document.getElementById('idlePrestigeConfirmCancelBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', bkmpPrestigeConfirmCancel);
  const nextBtn = document.getElementById('idlePrestigeConfirmNextBtn');
  if (nextBtn) nextBtn.addEventListener('click', bkmpPrestigeConfirmGoToFinal);
  const backBtn = document.getElementById('idlePrestigeConfirmBackBtn');
  if (backBtn) backBtn.addEventListener('click', bkmpPrestigeConfirmGoToPreview);
  const finalBtn = document.getElementById('idlePrestigeConfirmFinalBtn');
  if (finalBtn) finalBtn.addEventListener('click', bkmpPrestigeConfirmFinalize);
  const continueBtn = document.getElementById('idlePrestigeCeremonyContinueBtn');
  if (continueBtn) continueBtn.addEventListener('click', bkmpPrestigeCloseCeremony);
  if (typeof bkmpUiTrapFocus === 'function') {
    bkmpUiTrapFocus(document.getElementById('idlePrestigeConfirmOverlay'));
    bkmpUiTrapFocus(document.getElementById('idlePrestigeCeremonyOverlay'));
  }
}

async function bkmpIdlePerformPrestige() {
  /* Fehlte bisher: waehrend ein Event-Drache (Shenloss/Liber) auf
     Bestaetigung wartet, war der Aufsteigen-Button trotzdem ganz normal
     klickbar - ein Aufstieg setzt current_dragon_index/highest_dragon_index
     sofort auf 0 zurueck und spawnt einen neuen Drachen, wodurch der noch
     nicht bekaempfte Event-Drache faktisch spurlos verschwand, OHNE dass er
     je gegen ihn gekaempft hat (siehe idle_event_dragon_state: kein Eintrag
     = nie als besiegt gezaehlt). Genau die gleiche Sperre wie bei
     Stufensprung/-Auswahl (bkmpIdleJumpToStage) noetig. */
  if (bkmpIdleEventPauseActive) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Erst den Event-Drachen bestätigen/bekämpfen, dann kannst du aufsteigen.', 4000);
    return;
  }
  if (!bkmpPrestigeEligible() || bkmpPrestigeSaving) return;
  bkmpPrestigeOpenConfirmFlow();
}

/* Unveraenderte Reset-/Speicherlogik (siehe Dateikopf-Kommentar oben) -
   wortwoertlich aus der vorherigen bkmpIdlePerformPrestige uebernommen,
   berechnet Stufe/Bonus/Punkte bewusst selbststaendig neu (haengt NICHT
   vom evtl. inzwischen leicht veralteten Vorschau-Snapshot im Dialog ab). */
async function bkmpPrestigeExecuteReset() {
  const stage = Number(bkmpIdleState.highest_dragon_index || 0);
  const bonusPct = bkmpPrestigeState ? (bkmpPrestigeEffectTotals(bkmpPrestigeState.prestige_allocations).prestige_point_bonus_pct || 0) : 0;
  const pointsGained = Math.max(1, Math.round(bkmpPrestigePointsForStage(stage) * (1 + bonusPct / 100)));

  bkmpPrestigeSaving = true;
  try {
    bkmpIdleState.level = 1;
    bkmpIdleState.xp = 0;
    bkmpIdleState.gold = 0;
    bkmpIdleState.wood = 0;
    bkmpIdleState.stone = 0;
    bkmpIdleState.crystals = 0;
    bkmpIdleState.essence = 0;
    bkmpIdleState.skill_points_available = 0;
    bkmpIdleState.skill_points_spent = 0;
    bkmpIdleState.skill_allocations = {};
    bkmpIdleState.upgrade_purchases = {};
    /* Spieler-Vorgabe 18.07. (im Zuge der Drachenzwinger-Entfernung, siehe
       supabase-remove-zucht-lagerplaetze.sql): Obstgarten/Jagdhuette
       sollten bisher bewusst NICHT zurueckgesetzt werden - jetzt auf
       ausdruecklichen Wunsch doch, damit die komplette Zucht-Wirtschaft
       (Skilltree UND Gebaeude) beim Aufstieg einheitlich zurueckgesetzt
       wird, genau wie Gold/Holz/Stein/Kristalle/Essenz. Level 0 produziert
       weiterhin die Grundrate (kein Totalstillstand), nur der Ausbau-
       Fortschritt geht verloren. */
    bkmpIdleState.obstgarten_level = 0;
    bkmpIdleState.jagdhuette_level = 0;
    bkmpIdleState.fruit = 0;
    bkmpIdleState.meat = 0;
    /* Spieler-Vorgabe 18.07. (Folgeanfrage direkt danach): die 6 Produktions-
       gebaeude (siehe BKMP_IDLE_PRODUCTION_BUILDINGS) sollen beim Prestige
       ebenfalls zurueckgesetzt werden, analog zu Obstgarten/Jagdhuette oben.
       Nur die Level muessen hier genullt werden - die zugehoerigen
       Ressourcen (gold/wood/stone/crystals/essence) sind bereits oben in
       diesem Block generell auf 0 gesetzt; *_collected_at bleibt bewusst
       unangetastet (gleiches Muster wie bei fruit/meat: die naechste
       Ansammlung rechnet einfach ab jetzt mit Level 0 weiter). */
    BKMP_IDLE_PRODUCTION_BUILDINGS.forEach(def => { bkmpIdleState[def.levelKey] = 0; });
    /* dragon_kills/boss_kills bleiben ab sofort ueber Prestige-Auffstiege
       hinweg erhalten (nicht mehr zurueckgesetzt) - vorher liess das die
       Bestenliste (loadIdleLeaderboardStats liest dragon_kills direkt)
       nach jedem Aufstieg faelschlich wieder bei 0 anfangen, obwohl der
       Spieler laengst viel mehr Drachen insgesamt besiegt hatte. */
    /* Die aktuelle Lauf-Stufe VOR dem Reset in den dauerhaften Lebenszeit-
       Zaehler einrechnen, damit "insgesamt erreichte Stufen" (siehe
       bkmpIdleRenderStageBar) ueber Auffstiege hinweg weiterzaehlt statt
       auch auf 0 zurueckzufallen. */
    bkmpIdleState.prestige_stage_offset = Number(bkmpIdleState.prestige_stage_offset || 0) + Number(bkmpIdleState.highest_dragon_index || 0);
    bkmpIdleState.current_dragon_index = 0;
    bkmpIdleState.highest_dragon_index = 0;
    bkmpIdleState.auto_advance = true;
    /* NACHBESSERUNG (Spieler-Feedback 18.07.): kehrt die 17.07.-Entscheidung
       ("Runen gehen beim Prestige verloren") wieder um, zurueck zur
       urspruenglichen 14.07.-Entscheidung - eine hochgelevelte Rune (z.B.
       +30) kostet zu viel Zeit/Aufwand, um sie bei jedem Aufstieg komplett
       zu verlieren, das fuehlte sich unfair an. Runen (ausgeruestet UND
       Inventar, alle Seltenheiten/Stufen/Sub-Stats/Slot-Zuordnung) bleiben
       ab sofort vollstaendig erhalten - weder lokal noch in der DB wird
       hier noch geloescht. bkmpRuneNormalizeDuplicateEquips() (siehe
       js/systems/bkmp-runes.js) heilt dabei automatisch jeden ungueltigen
       Mehrfach-Ausruestungs-Zustand, falls einer bestehen sollte - der
       Prestige-Reset selbst muss sich darum nicht mehr kuemmern. */

    if (!bkmpPrestigeState) bkmpPrestigeState = { name_key: bkmpIdleState.name_key, display_name: bkmpIdleState.display_name, prestige_level: 0, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
    bkmpPrestigeState.prestige_level = Number(bkmpPrestigeState.prestige_level || 0) + 1;
    bkmpPrestigeState.prestige_points = Number(bkmpPrestigeState.prestige_points || 0) + pointsGained;
    bkmpGuildQuestAddDelta('prestige_ups', 1);

    bkmpIdleRecomputeEffectiveStats();
    bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;
    bkmpIdleSpawnDragon();
    bkmpIdleRenderStageBar();
    bkmpIdleUpdateVillageHpBar();
    bkmpIdleRenderHud();
    bkmpIdleLog(`🌌 Aufstieg #${bkmpPrestigeState.prestige_level}! +${pointsGained} Prestige-Punkte, dauerhafter +5%-Bonus.`);

    /* Ein Aufstieg IST der Reset - hier soll der frisch genullte Stand die
       DB unbedingt ueberschreiben, nicht mit einem evtl. noch aelteren
       Remote-Stand verschmolzen werden (der Twitch-Sync-Merge-Check oben in
       bkmpIdleFlushSync ist fuer NORMALE Kaeufe gedacht, nicht fuer einen
       kompletten Lauf-Reset) - genau EINEN Speichervorgang lang ueberspringen,
       alle Speichervorgaenge DANACH referenzieren wieder korrekt den neuen
       (genullten) Basiswert. */
    bkmpIdleSkipNextMerge = true;
    bkmpPrestigeSkipNextMerge = true;
    await bkmpIdleFlushSyncNow();
    try { if (typeof saveIdlePrestigeState === 'function') await saveIdlePrestigeState(bkmpPrestigeState); bkmpPrestigeSnapshotMergeBaseline(); }
    catch (e) { console.warn('Prestige: Speichern fehlgeschlagen (Migration ausgefuehrt?).', e); }

    bkmpIdleRenderActiveTabContent();
  } finally {
    bkmpPrestigeSaving = false;
  }
}

function bkmpIdleRenderPrestigePanel() {
  const panel = document.getElementById('idlePanelPrestige');
  if (!panel || !bkmpIdleState) return;
  if (bkmpPrestigeLoadFailed) {
    panel.innerHTML = `<p class="idle-prestige-hint">⚠️ Dein Prestige-Fortschritt konnte gerade nicht geladen werden (Verbindungsproblem). Aufsteigen ist deshalb momentan gesperrt, damit nichts überschrieben wird - versuch es gleich nochmal (z.B. Fenster schließen &amp; neu öffnen).</p>`;
    return;
  }
  const stage = Number(bkmpIdleState.highest_dragon_index || 0);
  const level = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : 0;
  const requiredStage = bkmpPrestigeRequiredStage(level);
  const eligible = bkmpPrestigeEligible();
  const progressPct = Math.max(0, Math.min(100, (stage / requiredStage) * 100));
  const totalPoints = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points || 0) : 0;
  const spentPoints = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points_spent || 0) : 0;
  const available = Math.max(0, totalPoints - spentPoints);
  const previewGain = bkmpPrestigePointsForStage(stage);
  const alloc = bkmpPrestigeState ? bkmpPrestigeState.prestige_allocations || {} : {};
  const preview = bkmpPrestigeGetPreview();

  panel.innerHTML = `
    <div class="idle-prestige-summary">
      <div class="idle-prestige-level">🌌 Prestige-Stufe ${level}</div>
      <div class="idle-prestige-points">${bkmpIdleFormatNumber(available)} / ${bkmpIdleFormatNumber(totalPoints)} Punkte verfügbar</div>
      ${level > 0 ? `<div class="idle-prestige-bonus-note">Dauerhafter Bonus: +${level * 5}% Angriff/Leben/Gold/XP</div>` : ''}
    </div>
    <div class="idle-prestige-progress-card">
      <div class="idle-prestige-progress-label">Drachen-Stufe ${bkmpIdleFormatStage(stage)} / ${bkmpIdleFormatStage(requiredStage)} zum Aufsteigen <span class="idle-prestige-progress-hint">(nicht dein Level – die höchste erreichte Drachen-Stufe)</span></div>
      <div class="idle-hp-bar"><div class="idle-hp-fill idle-hp-fill-village" style="width:${progressPct}%"></div></div>
      ${eligible
        ? `<button type="button" class="btn-ja idle-prestige-btn" id="idlePrestigeBtn" ${bkmpIdleEventPauseActive ? 'disabled title="Erst nach Bestätigung des Event-Drachen möglich"' : ''}>🌌 Jetzt aufsteigen (+${bkmpIdleFormatNumber(previewGain)} Punkte)</button>`
        : `<p class="idle-prestige-hint">Erreiche Drachen-Stufe ${bkmpIdleFormatStage(requiredStage)}, um dauerhaft aufsteigen zu können.</p>`}
    </div>

    <div class="idle-prestige-section idle-prestige-section-gain">
      <div class="idle-upgrade-section-title">Du erhältst</div>
      <div class="idle-prestige-gain-highlight">+${bkmpIdleFormatNumber(preview.pointsGained)} Prestige-Punkte <span class="idle-prestige-gain-arrow">&rarr; neuer dauerhafter Bonus +${preview.nextBonusPct}%</span></div>
      ${!eligible ? `<p class="idle-prestige-hint">Verfügbar, sobald du Drachen-Stufe ${bkmpIdleFormatStage(requiredStage)} erreichst.</p>` : ''}
    </div>

    <div class="idle-prestige-columns">
      <div class="idle-prestige-section idle-prestige-section-reset">
        <div class="idle-upgrade-section-title idle-upgrade-section-title-reset">Wird zurückgesetzt</div>
        ${bkmpPrestigeRenderInfoList(bkmpPrestigeResetItems(preview))}
      </div>
      <div class="idle-prestige-section idle-prestige-section-keep">
        <div class="idle-upgrade-section-title idle-upgrade-section-title-keep">Bleibt erhalten</div>
        ${bkmpPrestigeRenderInfoList(bkmpPrestigeKeepItems(preview))}
      </div>
    </div>

    <div class="idle-prestige-section idle-prestige-section-next">
      <div class="idle-upgrade-section-title">Nächster Durchlauf</div>
      <p class="idle-prestige-next-note">Der übernächste Aufstieg benötigt Drachen-Stufe ${bkmpIdleFormatStage(preview.nextRequiredStage)} (+50 gegenüber jetzt) - dein dann bereits höherer dauerhafter Bonus macht diesen kommenden Lauf spürbar schneller als den aktuellen.</p>
    </div>

    <div class="idle-upgrade-section-title">Permanenter Bonusbaum</div>
    <div class="idle-upgrade-grid">${BKMP_PRESTIGE_UPGRADES.map(def => {
      const rank = Number(alloc[def.id] || 0);
      const maxed = rank >= def.maxRank;
      const cost = maxed ? 0 : bkmpPrestigeUpgradeCost(rank + 1);
      const affordable = !maxed && available >= cost;
      return `
        <div class="idle-upgrade-card">
          <div class="idle-upgrade-icon">${def.icon}</div>
          <div class="idle-upgrade-name">${escapeHtml(def.name)} <span class="idle-upgrade-level">Rang ${rank}${maxed ? ' (Max)' : '/' + def.maxRank}</span></div>
          <div class="idle-upgrade-desc">${escapeHtml(def.desc)}</div>
          <button type="button" class="btn-ja idle-prestige-buy" data-prestige-id="${def.id}" ${maxed || !affordable ? 'disabled' : ''}>
            ${maxed ? 'Maximal' : `🌌 ${bkmpIdleFormatNumber(cost)}`}
          </button>
        </div>`;
    }).join('')}</div>
  `;
  const prestigeBtn = document.getElementById('idlePrestigeBtn');
  if (prestigeBtn) prestigeBtn.addEventListener('click', bkmpIdlePerformPrestige);
  panel.querySelectorAll('.idle-prestige-buy').forEach(btn => btn.addEventListener('click', () => bkmpPrestigeBuyUpgrade(btn.dataset.prestigeId)));
}
