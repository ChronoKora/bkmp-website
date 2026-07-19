// Bkmp - Redesign Phase 2a (17.07.): mechanisch aus idledorf.js extrahiert (mit einem AST-Parser exakt abgegrenzt, keine Logik veraendert). js/systems/bkmp-dungeon.js


/* Dungeon-Modus (grosses Update 17.07.): optionaler Wellen-Lauf, der die
   bestehende Kampf-Engine/Sprite-Anzeige komplett wiederverwendet -
   bkmpIdleCurrentDragon wird waehrend eines Laufs voruebergehend auf
   synthetische Wellen-Gegner umgebogen, bkmpIdleTick() selbst merkt davon
   nichts (kennt nur .hp/.attack/.defense/.maxHp). Siehe die dungeon-
   spezifischen fruehen Returns in bkmpIdleHandleDragonDefeated/
   bkmpIdleHandleDefeat weiter unten. Bewusst rein clientseitig (Personal-
   Best via localStorage) - kein neues DB-Schema, kein Wiederholungsrisiko
   der Zerstoertes-Dorf-Regression. */
let bkmpDungeonActive = false;
let bkmpDungeonWave = 0;
/* Schwierigkeitsstufen (Spieler-Wunsch 17.07.: "Ruhig viel mehr
   Schwierigkeits Stufen") - jede Stufe hat eigene Wellenzahl, eigenes
   Skalierungstempo pro Welle und einen eigenen Belohnungs-Multiplikator.
   Reihenfolge ist wichtig: die LETZTE Stufe gilt als "die schwerste" fuer
   das Dungeon-Meister-Achievement (siehe bkmpDungeonIsHardestCleared). */
/* Balance-Nachbesserung (Spieler-Meldung 17.07.: "Immernoch zu easy..",
   "Sind die Belohnungen ... nicht bisschen zu heftig?") - waveGrowth
   spuerbar erhoeht (staerkeres Wellen-Wachstum = echte spaete Wellen
   gefaehrlich statt trivial), rewardMult deutlich abgesenkt (siehe
   bkmpDungeonFinish weiter unten fuer die dazugehoerige entkoppelte
   Belohnungsformel - die alte Formel liess Belohnungen bei vielen Wellen
   exponentiell explodieren, siehe Kommentar dort). */
const BKMP_DUNGEON_DIFFICULTIES = [
  { id: 'leicht', name: 'Leicht', icon: '🟢', waves: 10, waveGrowth: 1.24, rewardMult: 1.0 },
  { id: 'mittel', name: 'Mittel', icon: '🟡', waves: 15, waveGrowth: 1.30, rewardMult: 1.3 },
  { id: 'schwer', name: 'Schwer', icon: '🟠', waves: 20, waveGrowth: 1.36, rewardMult: 1.7 },
  { id: 'albtraum', name: 'Albtraum', icon: '🔴', waves: 25, waveGrowth: 1.42, rewardMult: 2.2 }
];
let bkmpDungeonActiveDifficulty = null;
let bkmpDungeonStartTime = 0;
/* ---------------- Auto-Lauf (Spieler-Wunsch 15.07.: "10x 20x 30x Auto
   Run laufen lassen") ----------------
   bkmpDungeonAutoRunsTotal > 0 markiert "Auto-Modus aktiv", auch in der
   kurzen Pause ZWISCHEN zwei Laeufen (dort ist bkmpDungeonActive schon
   wieder false) - deshalb ein eigenes Flag statt bkmpDungeonActive
   mitzubenutzen. Stoppt automatisch bei der ersten Niederlage (weitere
   Versuche wuerden mit stark angeschlagener Stadt-HP - siehe die 30%-
   Zwischenheilung, die es nur ZWISCHEN Wellen, nicht zwischen ganzen
   Laeufen gibt - vermutlich auch scheitern) statt blind alle Versuche zu
   verbrennen. Einzelergebnisse zeigen waehrend des Auto-Laufs KEIN
   Vollbild-Overlay mehr (das waere bei 30 Laeufen 30x 4,8s Popup-Spam),
   nur eine laufend aktualisierte Zeile im Dungeon-Banner - am Ende (Ziel
   erreicht, Niederlage oder Abbruch) EIN zusammengefasstes Ergebnis. */
let bkmpDungeonAutoRunsTotal = 0;
let bkmpDungeonAutoRunsDone = 0;
let bkmpDungeonAutoCancelled = false;
let bkmpDungeonAutoStats = null;
let bkmpDungeonAutoNextRunTimer = null;
function bkmpDungeonAutoActive() {
  return bkmpDungeonAutoRunsTotal > 0;
}
let bkmpDungeonPrevDragon = null;
let bkmpDungeonPrevVillageHp = null;
let bkmpDungeonTimerInterval = null;

/* ---------------- Dungeon-System 2.0 (Spieler-Vorgabe 17.07.) ----------------
   7 spezialisierte Dungeon-Typen statt einem einzigen - jeder Typ nutzt
   dieselben Schwierigkeitsstufen/Wellen-Strukturen (BKMP_DUNGEON_DIFFICULTIES
   oben), hat aber eigene Belohnungen, ein eigenes Schluessel-Kontingent (siehe
   supabase-dungeon-system-v2.sql, max. 5, +1 alle 4h, serverseitig/now()-
   basiert damit die Client-Uhr keinen Einfluss hat) und eigene Fortschritts-
   Statistiken/Freischaltungen. Der Ei-Dungeon ist ab jetzt die alleinige
   Quelle fuer reguläre Dracheneier (Normalkampf droppt keine Eier mehr, siehe
   bkmpIdleMaybeDropTreasure weiter unten, die den frueheren Ei-Drop ersetzt;
   raid_finish() wurde separat in SQL angepasst), der Runen-Dungeon liefert
   gezielt bessere Runen als der Normalkampf (Fokus Episch/Legendaer). */
const BKMP_DUNGEON_TYPES = [
  { id: 'gold', icon: '💰', name: 'Gold-Dungeon', short: 'Gold, Goldsäckchen & -truhen', highlight: null },
  { id: 'exp', icon: '⭐', name: 'EXP-Dungeon', short: 'Spieler-EXP & EXP-Säckchen', highlight: null },
  { id: 'egg', icon: '🥚', name: 'Ei-Dungeon', short: 'Dracheneier aller Seltenheiten', highlight: 'Hauptquelle für Dracheneier' },
  { id: 'meat', icon: '🍖', name: 'Fleisch-Dungeon', short: 'Fleisch für deine Drachen', highlight: null },
  { id: 'fruit', icon: '🍎', name: 'Früchte-Dungeon', short: 'Früchte für deine Drachen', highlight: null },
  { id: 'gem', icon: '💎', name: 'Edelstein-Dungeon', short: 'Diamanten & Edelsteine', highlight: null },
  { id: 'rune', icon: '🔮', name: 'Runen-Dungeon', short: 'Hochwertige Runen', highlight: 'Hochwertige Runen: Episch bis Legendär' }
];
function bkmpDungeonTypeById(id) {
  return BKMP_DUNGEON_TYPES.find(t => t.id === id) || BKMP_DUNGEON_TYPES[0];
}
function bkmpDungeonDifficultyIndex(difficultyId) {
  const idx = BKMP_DUNGEON_DIFFICULTIES.findIndex(d => d.id === difficultyId);
  return idx >= 0 ? idx : 0;
}
const BKMP_DUNGEON_KEY_MAX = 5;

/* Serverseitiger Status (Schluessel/Tagesbonus/Freischaltung/Statistik, siehe
   dungeon_get_all_status() in supabase-dungeon-system-v2.sql) pro Typ - wird
   beim Oeffnen des Dungeon-Tabs geladen; Schluessel-Countdown/Freischaltung
   sind damit tamper-sicher (now()-basiert serverseitig), Belohnungs-BETRAEGE
   bleiben wie im Rest des Spiels client-seitig berechnet. */
let bkmpDungeonStatusByType = {};
let bkmpDungeonStatusLoadedAt = 0;
let bkmpDungeonStatusLoadFailed = false;
let bkmpDungeonStatusLoading = false;
let bkmpDungeonCountdownInterval = null;
let bkmpDungeonSelectedDifficultyByType = {};
let bkmpDungeonActiveType = null;
let bkmpDungeonStarting = false;

/* ---------------- Belohnungstabellen pro Dungeon-Typ ---------------- */
const BKMP_DUNGEON_POUCH_CHANCE = [0.15, 0.25, 0.35, 0.45];
const BKMP_DUNGEON_CHEST_CHANCE = [0.02, 0.05, 0.09, 0.14];
const BKMP_DUNGEON_BOOSTER_CHANCE = [0, 0.03, 0.06, 0.10];

/* Ei-Rarität je Schwierigkeit (Index = BKMP_DUNGEON_DIFFICULTIES-Index) -
   Gewichte fuer [standard, selten, episch, legendaer]. Legendaer bleibt bei
   JEDER Schwierigkeit einstellig (%) - der Schluessel-Deckel (max. 5, +1/4h)
   begrenzt zusaetzlich, wie oft ueberhaupt gewuerfelt werden kann, damit
   Legendär "extrem selten, nicht regelmäßig farmbar" bleibt (Spieler-Vorgabe). */
const BKMP_DUNGEON_EGG_RARITY_WEIGHTS = [
  { standard: 80, selten: 19, episch: 1, legendaer: 0 },
  { standard: 55, selten: 35, episch: 9.5, legendaer: 0.5 },
  { standard: 30, selten: 40, episch: 27, legendaer: 3 },
  { standard: 10, selten: 35, episch: 50, legendaer: 5 }
];

/* Runen-Raritaet je Schwierigkeit - Gewichte fuer [blue(selten), purple
   (episch), gold(legendaer)]. gray/green tauchen im Runen-Dungeon bewusst
   NIE als volle Rune auf (Spieler-Vorgabe: "sollen entweder gar nicht als
   volle Runen erscheinen oder nur sehr selten"). Albtraum garantiert
   mindestens eine episch-oder-besser Rune (siehe bkmpDungeonGrantReward),
   aber KEINE feste Legendär-Garantie (Spieler-Vorgabe: "nicht garantiert
   jeden Lauf"). */
const BKMP_DUNGEON_RUNE_RARITY_WEIGHTS = [
  { blue: 80, purple: 19, gold: 1 },
  { blue: 55, purple: 40, gold: 5 },
  { blue: 40, purple: 50, gold: 10 },
  { blue: 15, purple: 55, gold: 30 }
];
const BKMP_DUNGEON_RUNE_COUNT = [1, 1, 2, 2];

function bkmpDungeonWeightedPick(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return entries.length ? entries[0][0] : null;
  let roll = Math.random() * total;
  for (const [key, w] of entries) {
    if (roll < w) return key;
    roll -= w;
  }
  return entries[entries.length - 1][0];
}

/* Saisonaler Dungeon-Modifikator (Lategame-Content, Spieler-Vorgabe 16.07.):
   rotierender woechentlicher Bonus auf EINEN der 7 Dungeon-Typen. Bewusst
   OHNE eigene DB-Tabelle/Server-Cron - die Berechnung haengt nur von
   Date.now() ab, jeder Client kommt unabhaengig auf denselben Typ fuer
   dieselbe Woche (gleiches Prinzip wie z.B. bkmpDungeonWaveMult: rein
   deterministisch statt gespeichert). "Woche" hier vereinfacht als
   7-Tage-Block seit Unix-Epoch (nicht kalenderwochen-/zeitzonen-exakt) -
   fuer einen reinen Komfort-Bonus ohne echten Wettbewerbs-Anspruch reicht
   das, spart aber die Komplexitaet einer echten ISO-Wochenberechnung. */
function bkmpDungeonSeasonalFeaturedType() {
  const weekIndex = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  return BKMP_DUNGEON_TYPES[weekIndex % BKMP_DUNGEON_TYPES.length].id;
}
const BKMP_DUNGEON_SEASONAL_BONUS_MULT = 1.5;

/* Basis-Geldformel (unveraendert aus dem alten Dungeon uebernommen, siehe
   Balance-Kommentar weiter unten) - linear pro Welle wachsend, mit
   rewardMult skaliert, +20% bei vollstaendigem Erfolg. Wird fuer alle
   "kontinuierlichen" Belohnungstypen (Gold/EXP/Fleisch/Frucht/Edelstein) als
   Basis genutzt, nur der per-Welle-Basiswert unterscheidet sich je Typ. */
function bkmpDungeonBaseAmount(perWaveBase, wavesCleared, rewardMult, success) {
  let total = 0;
  for (let w = 1; w <= wavesCleared; w++) total += Math.round(perWaveBase * (1 + 0.08 * (w - 1)));
  total = Math.round(total * rewardMult);
  if (success) total = Math.round(total * 1.2);
  return total;
}

/* Goldrausch/Wissensschub-Booster (Spieler-Vorgabe: "zeitlich begrenzter
   Booster") - es gab im Spiel bisher gar kein Buff-System (Audit bestaetigt:
   keine Zeile mit "booster"/"buff"). Zwei Zeitstempel-Spalten auf
   idle_player_state (boost_gold_until/boost_exp_until, siehe
   supabase-dungeon-system-v2.sql), gleiches Muster wie fruit/meat - Anwendung
   erfolgt beim Gutschreiben von Gold/EXP ueber bkmpDungeonBoostMultiplier(),
   selber Client-Trust-Level wie der Rest der Wirtschaft in diesem Spiel. */
function bkmpDungeonGrantBoost(kind) {
  if (!bkmpIdleState) return;
  const key = kind === 'gold' ? 'boost_gold_until' : 'boost_exp_until';
  const now = Date.now();
  const current = Date.parse(bkmpIdleState[key] || 0) || now;
  bkmpIdleState[key] = new Date(Math.max(current, now) + 30 * 60 * 1000).toISOString();
}
function bkmpDungeonBoostMultiplier(kind) {
  if (!bkmpIdleState) return 1;
  const key = kind === 'gold' ? 'boost_gold_until' : 'boost_exp_until';
  const until = Date.parse(bkmpIdleState[key] || 0);
  return (Number.isFinite(until) && until > Date.now()) ? 1.25 : 1;
}

function bkmpDungeonRollEgg(difficultyIdx) {
  const weights = BKMP_DUNGEON_EGG_RARITY_WEIGHTS[difficultyIdx] || BKMP_DUNGEON_EGG_RARITY_WEIGHTS[0];
  const rarity = bkmpDungeonWeightedPick(weights) || 'standard';
  const pool = bkmpDragonSpeciesCatalog.filter(sp => sp.active !== false && sp.rarity === rarity);
  const species = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  return species ? { speciesId: species.id, name: species.name, rarity } : null;
}
function bkmpDungeonPersistEgg(egg) {
  if (!egg || !bkmpIdleState || typeof insertPlayerDragonEgg !== 'function') return;
  insertPlayerDragonEgg(bkmpIdleState.name_key, egg.speciesId).then(row => {
    if (!row) return;
    bkmpPlayerDragonEggs.push(row);
    if (typeof bkmpIdleRenderDragonsPanel === 'function') bkmpIdleRenderDragonsPanel();
    /* Phase 5.5 (19.07.): normale/seltene Eier bleiben bewusst nur Teil der
       kompakten Dungeon-Zusammenfassung (bkmpDungeonRewardParts/
       bkmpDungeonShowResult) - "keine zehn Dialoge" gilt auch hier. Ab
       episch/legendaer bekommt das Ei zusaetzlich eine eigene Karte (Auftrag:
       "insbesondere seltene Belohnungen koennen danach separat hervorgehoben
       werden"). Nicht blockierend, erscheint also unabhaengig davon, ob das
       Dungeon-Ergebnis-Overlay gerade noch offen ist. */
    if ((egg.rarity === 'episch' || egg.rarity === 'legendaer') && typeof bkmpRewardPresent === 'function') {
      const species = typeof bkmpDragonSpeciesById === 'function' ? bkmpDragonSpeciesById(egg.speciesId) : null;
      /* 'legendaer' loest in bkmpRewardPresent automatisch die groessere
         Zeremonie-Stufe aus (siehe BKMP_REWARD_RARITY_DEFAULT_TIER), 'episch'
         bleibt bei der Karte - die Thumbnail-Klasse muss dieselbe Zuordnung
         spiegeln, sonst bekommt ein legendaeres Ei versehentlich die kleinere
         Karten-Bildgroesse. */
      const thumbClass = egg.rarity === 'legendaer' ? 'bkmp-reward-ceremony-thumb' : 'bkmp-reward-card-thumb';
      const iconHtml = species && typeof bkmpDragonThumbHtml === 'function'
        ? bkmpDragonThumbHtml(bkmpDragonStageImage(species, 'egg'), egg.name, thumbClass)
        : '🥚';
      bkmpRewardPresent({
        rarity: egg.rarity,
        icon: iconHtml,
        title: `${egg.name}-Ei erhalten`,
        description: 'Leg es in ein freies Nest im Drachenlager, um es auszubrüten.',
        source: 'Dungeon',
        dedupeKey: `egg-${row.id}`
      });
    }
  }).catch(e => {
    /* Bug-Fix (Spieler-Meldung 16.07., "neue Drachen-Eier werden nicht
       angezeigt"): schlug das Speichern fehl (z.B. weil die Spezies zum
       Zeitpunkt des Wurfs noch nicht/nicht mehr in der DB existierte),
       verschwand das Ei bisher SPURLOS - der Sieg-Popup hatte den Namen
       schon angezeigt, das Ei landete aber nie im Eierlager, und niemand
       ausser der Browser-Konsole erfuhr je davon. */
    console.warn('Idle Dorf: Dungeon-Ei konnte nicht gespeichert werden.', e);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`⚠️ ${egg.name}-Ei konnte nicht gespeichert werden - bitte melden.`, 4200);
  });
}
function bkmpDungeonRollRune(difficultyIdx, forceRarityId) {
  const weights = BKMP_DUNGEON_RUNE_RARITY_WEIGHTS[difficultyIdx] || BKMP_DUNGEON_RUNE_RARITY_WEIGHTS[0];
  const rarityId = forceRarityId || bkmpDungeonWeightedPick(weights) || 'blue';
  const slot = window.BKMP_RUNE_SLOTS[Math.floor(Math.random() * window.BKMP_RUNE_SLOTS.length)];
  const rolledValue = bkmpIdleRollRuneValue(slot.id, rarityId);
  return { id: null, _cid: bkmpRuneNewLocalId(), rune_type: slot.id, rarity: rarityId, rolled_value: rolledValue, equipped: false, upgrade_level: 0, substats: bkmpIdleRollInitialSubstats(slot.stat, rarityId), created_at: new Date().toISOString() };
}
function bkmpDungeonPersistRunes(runes) {
  runes.forEach(rune => {
    bkmpIdlePlayerRunes.push(rune);
    bkmpIdlePendingRuneDrops.push(rune);
  });
  if (typeof bkmpIdleQueueRuneSync === 'function') bkmpIdleQueueRuneSync();
}

/* Zentrale Belohnungs-Vergabe fuer einen abgeschlossenen (oder verlorenen)
   Lauf - liest/schreibt bkmpIdleState direkt, genau wie es der alte Dungeon
   und der normale Kampf schon immer getan haben (gleicher Trust-Level).
   dailyBonusGranted kommt IMMER vom serverseitigen dungeon_claim_daily_bonus-
   Ergebnis (siehe bkmpDungeonFinish), nie von der lokalen Anzeige-Kopie.
   Bei kontinuierlichen Belohnungen (Gold/EXP/Fleisch/Frucht/Edelstein) wird
   der Tagesbonus als exaktes x1.5 angewendet; bei stueckigen Belohnungen
   (Ei/Rune, "keine halben Eier") stattdessen als GARANTIERTER Extra-Wurf -
   siehe Spezifikation. */
function bkmpDungeonGrantReward(type, difficulty, wavesCleared, success, dailyBonusGranted) {
  const s = bkmpIdleEffectiveStats || {};
  const idx = bkmpDungeonDifficultyIndex(difficulty.id);
  const dailyMult = dailyBonusGranted ? 1.5 : 1;
  const summary = { type, gold: 0, xp: 0, gems: 0, meat: 0, fruit: 0, eggs: [], runes: [], boosterGold: false, boosterExp: false, pouchBonus: false, chestBonus: false, dailyBonusApplied: dailyBonusGranted };

  if (type === 'gold') {
    let gold = bkmpDungeonBaseAmount(Math.round((s.attack || 10) * 5), wavesCleared, difficulty.rewardMult, success);
    gold = Math.round(gold * dailyMult);
    if (success && Math.random() < BKMP_DUNGEON_POUCH_CHANCE[idx]) { gold = Math.round(gold * 1.15); summary.pouchBonus = true; }
    if (success && Math.random() < BKMP_DUNGEON_CHEST_CHANCE[idx]) { gold = Math.round(gold * 1.4); summary.chestBonus = true; }
    if (success && Math.random() < BKMP_DUNGEON_BOOSTER_CHANCE[idx]) { bkmpDungeonGrantBoost('gold'); summary.boosterGold = true; }
    summary.gold = gold;
    summary.xp = Math.round(gold / 4);
  } else if (type === 'exp') {
    let xp = bkmpDungeonBaseAmount(Math.round((s.attack || 10) * 3), wavesCleared, difficulty.rewardMult, success);
    xp = Math.round(xp * dailyMult);
    if (success && Math.random() < BKMP_DUNGEON_BOOSTER_CHANCE[idx]) { bkmpDungeonGrantBoost('exp'); summary.boosterExp = true; }
    summary.xp = xp;
    summary.gold = Math.round(xp / 3);
  } else if (type === 'meat' || type === 'fruit') {
    let amount = bkmpDungeonBaseAmount(Math.round((s.attack || 10) * 0.5), wavesCleared, difficulty.rewardMult, success);
    amount = Math.round(amount * dailyMult);
    summary[type] = amount;
    summary.gold = bkmpDungeonBaseAmount(Math.round((s.attack || 10) * 0.6), wavesCleared, difficulty.rewardMult, success);
  } else if (type === 'gem') {
    summary.gems = success ? Math.round(8 * difficulty.rewardMult * dailyMult) : 0;
    summary.gold = bkmpDungeonBaseAmount(Math.round((s.attack || 10) * 1.2), wavesCleared, difficulty.rewardMult, success);
  } else if (type === 'egg') {
    summary.gold = bkmpDungeonBaseAmount(Math.round((s.attack || 10) * 1.2), wavesCleared, difficulty.rewardMult, success);
    if (success) {
      const egg1 = bkmpDungeonRollEgg(idx);
      if (egg1) summary.eggs.push(egg1);
      if (dailyBonusGranted) {
        const egg2 = bkmpDungeonRollEgg(idx);
        if (egg2) summary.eggs.push(egg2);
      }
    }
  } else if (type === 'rune') {
    summary.gold = bkmpDungeonBaseAmount(Math.round((s.attack || 10) * 1.2), wavesCleared, difficulty.rewardMult, success);
    if (success) {
      const count = BKMP_DUNGEON_RUNE_COUNT[idx] + (dailyBonusGranted ? 1 : 0);
      const runes = [];
      for (let i = 0; i < count; i++) runes.push(bkmpDungeonRollRune(idx));
      if (idx === BKMP_DUNGEON_DIFFICULTIES.length - 1 && !runes.some(r => r.rarity === 'purple' || r.rarity === 'gold')) {
        runes[runes.length - 1] = bkmpDungeonRollRune(idx, 'purple');
      }
      summary.runes = runes;
    }
  }

  /* Goldrausch/Wissensschub anwenden, falls gerade aktiv - gilt fuer JEDEN
     Dungeon-Typ (nicht nur Gold-/EXP-Dungeon selbst), da der Booster
     allgemein auf "Goldproduktion"/"erhaltene EXP" wirkt. */
  const goldBoost = bkmpDungeonBoostMultiplier('gold');
  const xpBoost = bkmpDungeonBoostMultiplier('exp');
  if (goldBoost > 1 && summary.gold > 0) summary.gold = Math.round(summary.gold * goldBoost);
  if (xpBoost > 1 && summary.xp > 0) summary.xp = Math.round(summary.xp * xpBoost);

  /* Saisonaler Wochen-Bonus - siehe bkmpDungeonSeasonalFeaturedType weiter
     unten. Nur auf die kontinuierlichen Belohnungen angewendet, gleiche
     Begruendung wie beim Tagesbonus (stueckige Ei-/Runen-Beute nicht mit
     reingezogen, um deren bestehende Drop-Logik nicht anzufassen). */
  if (success && type === bkmpDungeonSeasonalFeaturedType()) {
    if (summary.gold > 0) summary.gold = Math.round(summary.gold * BKMP_DUNGEON_SEASONAL_BONUS_MULT);
    if (summary.xp > 0) summary.xp = Math.round(summary.xp * BKMP_DUNGEON_SEASONAL_BONUS_MULT);
    if (summary.gems > 0) summary.gems = Math.round(summary.gems * BKMP_DUNGEON_SEASONAL_BONUS_MULT);
    if (summary.meat > 0) summary.meat = Math.round(summary.meat * BKMP_DUNGEON_SEASONAL_BONUS_MULT);
    if (summary.fruit > 0) summary.fruit = Math.round(summary.fruit * BKMP_DUNGEON_SEASONAL_BONUS_MULT);
    summary.seasonalBonusApplied = true;
  }

  if (summary.gold > 0) {
    bkmpIdleState.gold = Number(bkmpIdleState.gold || 0) + summary.gold;
    bkmpIdleState.total_gold_earned = Number(bkmpIdleState.total_gold_earned || 0) + summary.gold;
  }
  if (summary.gems > 0) bkmpIdleState.crystals = Number(bkmpIdleState.crystals || 0) + summary.gems;
  if (summary.meat > 0) {
    const cap = bkmpDragonResourceCap(bkmpIdleState.jagdhuette_level || 0);
    bkmpIdleState.meat = Math.min(cap, Number(bkmpIdleState.meat || 0) + summary.meat);
  }
  if (summary.fruit > 0) {
    const cap = bkmpDragonResourceCap(bkmpIdleState.obstgarten_level || 0);
    bkmpIdleState.fruit = Math.min(cap, Number(bkmpIdleState.fruit || 0) + summary.fruit);
  }
  if (summary.xp > 0) bkmpIdleAddXp(summary.xp);

  summary.eggs.forEach(egg => bkmpDungeonPersistEgg(egg));
  if (summary.runes.length) bkmpDungeonPersistRunes(summary.runes);

  return summary;
}

/* ---------------- Dungeon-Modus ---------------- */

const BKMP_DUNGEON_BEST_KEY = 'bkmp-idle-dungeon-best';
/* Bestwert-Speicher jetzt PRO Dungeon-Typ UND Schwierigkeitsstufe (Map
   type -> difficultyId -> {waves,timeMs}) - migriert das alte reine
   Schwierigkeits-Format (vor Dungeon-System 2.0, 17.07.) automatisch unter
   'gold' (der direkte Nachfolger des alten Einzel-Dungeons: Gold war dort
   die Haupt-Belohnung, und die Bestenliste defaultet ebenfalls auf 'gold'),
   damit bereits gespeicherte Bestwerte nicht verloren gehen. */
function bkmpDungeonGetAllBests() {
  try {
    const raw = JSON.parse(localStorage.getItem(BKMP_DUNGEON_BEST_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return {};
    if ('waves' in raw) return { gold: { leicht: raw } };
    const typeIds = BKMP_DUNGEON_TYPES.map(t => t.id);
    const looksLikeOldFlatFormat = Object.keys(raw).length > 0 && Object.keys(raw).every(k => !typeIds.includes(k));
    if (looksLikeOldFlatFormat) return { gold: raw };
    return raw;
  } catch (e) { return {}; }
}
function bkmpDungeonGetBest(type, difficultyId) {
  const all = bkmpDungeonGetAllBests();
  return (all[type] && all[type][difficultyId]) || { waves: 0, timeMs: 0 };
}
function bkmpDungeonSaveBest(type, difficultyId, data) {
  const all = bkmpDungeonGetAllBests();
  if (!all[type]) all[type] = {};
  all[type][difficultyId] = data;
  try { localStorage.setItem(BKMP_DUNGEON_BEST_KEY, JSON.stringify(all)); } catch (e) {}
}
function bkmpDungeonIsHardestCleared() {
  const hardest = BKMP_DUNGEON_DIFFICULTIES[BKMP_DUNGEON_DIFFICULTIES.length - 1];
  return bkmpDungeonGetBest('gold', hardest.id).waves >= hardest.waves;
}

/* Sortierung fuer die Bestenliste: vollstaendige Laeufe (alle Wellen
   dieser Schwierigkeit geschafft) IMMER vor Teil-Laeufen, darunter nach
   Zeit (schneller = besser); Teil-Laeufe untereinander nach erreichter
   Welle sortiert. Muss clientseitig passieren, weil "vollstaendig" von
   der pro-Schwierigkeit unterschiedlichen Wellenzahl abhaengt, die die DB
   nicht kennt. */
function bkmpDungeonSortLeaderboardRows(rows, totalWaves) {
  return [...rows].sort((a, b) => {
    const aFull = Number(a.waves_cleared || 0) >= totalWaves;
    const bFull = Number(b.waves_cleared || 0) >= totalWaves;
    if (aFull && bFull) return Number(a.time_ms || 0) - Number(b.time_ms || 0);
    if (aFull) return -1;
    if (bFull) return 1;
    return Number(b.waves_cleared || 0) - Number(a.waves_cleared || 0);
  });
}

let bkmpDungeonLeaderboardTypeId = BKMP_DUNGEON_TYPES[0].id;
let bkmpDungeonLeaderboardDifficultyId = BKMP_DUNGEON_DIFFICULTIES[0].id;
async function bkmpDungeonRenderLeaderboard() {
  const listEl = document.getElementById('idleLeaderboardList');
  if (!listEl) return;
  const type = bkmpDungeonTypeById(bkmpDungeonLeaderboardTypeId);
  const difficulty = BKMP_DUNGEON_DIFFICULTIES.find(d => d.id === bkmpDungeonLeaderboardDifficultyId) || BKMP_DUNGEON_DIFFICULTIES[0];
  listEl.innerHTML = `
    <div class="idle-dungeon-diff-row">${BKMP_DUNGEON_TYPES.map(t => `
      <button type="button" class="idle-dungeon-diff-btn${t.id === type.id ? ' active' : ''}" data-lb-type-id="${t.id}">${t.icon} ${t.name}</button>
    `).join('')}</div>
    <div class="idle-dungeon-diff-row">${BKMP_DUNGEON_DIFFICULTIES.map(d => `
      <button type="button" class="idle-dungeon-diff-btn${d.id === difficulty.id ? ' active' : ''}" data-lb-difficulty-id="${d.id}">${d.icon} ${d.name}</button>
    `).join('')}</div>
    <div id="idleDungeonLeaderboardRows"><p class="empty-hint">Lädt...</p></div>
  `;
  listEl.querySelectorAll('[data-lb-type-id]').forEach(btn => btn.addEventListener('click', () => {
    bkmpDungeonLeaderboardTypeId = btn.dataset.lbTypeId;
    bkmpDungeonRenderLeaderboard();
  }));
  listEl.querySelectorAll('[data-lb-difficulty-id]').forEach(btn => btn.addEventListener('click', () => {
    bkmpDungeonLeaderboardDifficultyId = btn.dataset.lbDifficultyId;
    bkmpDungeonRenderLeaderboard();
  }));
  let rows = [];
  try {
    rows = typeof loadDungeonLeaderboard === 'function' ? (await loadDungeonLeaderboard(type.id, difficulty.id)) || [] : [];
    rows = rows.filter(r => !bkmpIsHiddenTestAccount(r.name_key));
  } catch (e) { console.warn('Dungeon: Bestenliste konnte nicht geladen werden.', e); }
  /* Tab kann waehrend des Ladens gewechselt worden sein - dann existiert
     dieser Container nicht mehr, nicht in eine fremde Ansicht schreiben. */
  const rowsEl = document.getElementById('idleDungeonLeaderboardRows');
  if (!rowsEl) return;
  const sorted = bkmpDungeonSortLeaderboardRows(rows, difficulty.waves);
  const myName = (typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '').trim().toLowerCase();
  rowsEl.innerHTML = sorted.length ? sorted.slice(0, 100).map((row, i) => {
    const isMe = Boolean(myName) && (row.display_name || '').trim().toLowerCase() === myName;
    const full = Number(row.waves_cleared || 0) >= difficulty.waves;
    const valueText = full ? `🏆 ${bkmpDungeonFormatTime(row.time_ms)}` : `Welle ${row.waves_cleared} / ${difficulty.waves}`;
    return bkmpLeaderboardRenderSimpleRow(i, row.display_name, valueText, isMe);
  }).join('') : '<p class="empty-hint">Noch keine Daten für diese Bestenliste.</p>';
}
function bkmpDungeonFormatTime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}
function bkmpDungeonFormatCountdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
/* Skalierung IMMER relativ zu den eigenen effektiven Werten (nicht zur
   normalen Fortschritts-Stufe) - dadurch bleibt die Herausforderung fair,
   egal wie weit jemand in der normalen Progression schon ist, und die
   Bestzeiten-Rangliste (spaeter moeglich) waere ueber alle Spielstaerken
   hinweg vergleichbar. */
function bkmpDungeonWaveMult(wave) {
  const growth = (bkmpDungeonActiveDifficulty || BKMP_DUNGEON_DIFFICULTIES[0]).waveGrowth;
  return Math.pow(growth, wave - 1);
}

/* Laedt den serverseitigen Schluessel-/Tagesbonus-/Fortschritts-Status fuer
   alle 7 Typen in EINEM RPC-Aufruf (siehe dungeon_get_all_status() in
   supabase-dungeon-system-v2.sql) und rendert danach neu, falls der
   Dungeon-Tab noch offen ist. */
async function bkmpDungeonRefreshStatus() {
  /* Bug-Fix (Spieler-Meldung 18.07., Screenshot "Lädt Dungeon-Status..."
     haengt fest): bei einem Fehlschlag (z.B. weil supabase-dungeon-system-
     v2.sql noch nicht ausgefuehrt wurde und die RPC serverseitig noch gar
     nicht existiert) blieb bkmpDungeonStatusLoadedAt auf 0 stehen - jedes
     Rendern des Panels sah dadurch weiterhin "nicht geladen", zeigte den
     Ladetext und stiess SOFORT wieder einen neuen (wieder scheiternden)
     Aufruf an: eine stille Endlosschleife ohne jede Rueckmeldung fuer den
     Spieler. Jetzt: ein eigenes Fehlgeschlagen-Flag, das eine klare
     Fehlermeldung mit Wiederholen-Knopf zeigt statt endlos weiterzuladen,
     plus ein Lauf-Schutz gegen ueberlappende parallele Aufrufe. */
  if (bkmpDungeonStatusLoading) return;
  bkmpDungeonStatusLoading = true;
  try {
    const rows = typeof bkmpDungeonGetAllStatus === 'function' ? await bkmpDungeonGetAllStatus() : [];
    const map = {};
    rows.forEach(r => { map[r.dungeonType] = r; });
    bkmpDungeonStatusByType = map;
    bkmpDungeonStatusLoadedAt = Date.now();
    bkmpDungeonStatusLoadFailed = false;
  } catch (e) {
    console.warn('Dungeon: Status konnte nicht geladen werden (Migration evtl. noch nicht ausgefuehrt - siehe supabase-dungeon-system-v2.sql).', e);
    bkmpDungeonStatusLoadFailed = true;
  }
  bkmpDungeonStatusLoading = false;
  if (bkmpIdleActiveTab === 'dungeon') bkmpIdleRenderDungeonPanel();
}

function bkmpDungeonKeyLineHtml(status) {
  const keysFull = status.keys >= BKMP_DUNGEON_KEY_MAX;
  return keysFull
    ? `🔑 Schlüssel: ${status.keys}/${BKMP_DUNGEON_KEY_MAX}<br>✓ Schlüssel vollständig aufgeladen`
    : `🔑 Schlüssel: ${status.keys}/${BKMP_DUNGEON_KEY_MAX}<br>Nächster Schlüssel in: ${bkmpDungeonFormatCountdown(status.secondsToNext)}`;
}

/* Bug-Fix (Spieler-Meldung 18.07., Screenshot "Nächster Schlüssel in:
   00:00:00" trotz nur 4/5 Schlüsseln): der Countdown wurde bisher NUR beim
   (Neu-)Rendern des Panels einmalig vom Server geholt und danach nie mehr
   aktualisiert - stand die Karte einfach offen, tickte die Zahl nie
   sichtbar herunter und sah dadurch bei kleinen Restzeiten wie
   "hängengeblieben bei 0" aus, obwohl der Server-Wert an sich korrekt war.
   Jetzt: ein echter 1-Sekunden-Tick, der NUR die Countdown-Textzeile lokal
   herunterzaehlt (kein Server-Roundtrip pro Sekunde, kein Neu-Rendern der
   ganzen Karte/Listener). Erreicht ein Countdown 0, wird EINMALIG ein
   echter Status-Refresh angestossen, damit der neue Schluessel-Stand
   serverseitig (now()-basiert, nicht per lokaler Uhr) bestaetigt wird.
   Selbst-beendend: bricht ab, sobald der Dungeon-Tab nicht mehr aktiv ist,
   kein manuelles Aufraeumen an anderer Stelle noetig. */
function bkmpDungeonStartCountdownTicker() {
  if (bkmpDungeonCountdownInterval) { clearInterval(bkmpDungeonCountdownInterval); bkmpDungeonCountdownInterval = null; }
  bkmpDungeonCountdownInterval = setInterval(() => {
    if (bkmpIdleActiveTab !== 'dungeon' || bkmpDungeonStatusLoadFailed || !bkmpDungeonStatusLoadedAt) {
      clearInterval(bkmpDungeonCountdownInterval);
      bkmpDungeonCountdownInterval = null;
      return;
    }
    let anyReachedZero = false;
    BKMP_DUNGEON_TYPES.forEach(type => {
      const status = bkmpDungeonStatusByType[type.id];
      if (!status || status.keys >= BKMP_DUNGEON_KEY_MAX) return;
      status.secondsToNext = Math.max(0, Number(status.secondsToNext || 0) - 1);
      if (status.secondsToNext <= 0) { anyReachedZero = true; return; }
      const el = document.getElementById('idle-dungeon-keys-' + type.id);
      if (el) el.innerHTML = bkmpDungeonKeyLineHtml(status);
    });
    if (anyReachedZero) bkmpDungeonRefreshStatus();
  }, 1000);
}

function bkmpDungeonRenderCard(type, busy) {
  const status = bkmpDungeonStatusByType[type.id] || { keys: BKMP_DUNGEON_KEY_MAX, secondsToNext: 0, dailyBonusAvailable: true, highestDifficulty: 'leicht', totalCompletions: 0, totalDefeats: 0 };
  const selectedId = bkmpDungeonSelectedDifficultyByType[type.id] || 'leicht';
  const unlockedIdx = bkmpDungeonDifficultyIndex(status.highestDifficulty);
  const selected = BKMP_DUNGEON_DIFFICULTIES.find(d => d.id === selectedId) || BKMP_DUNGEON_DIFFICULTIES[0];
  const best = bkmpDungeonGetBest(type.id, selected.id);
  const bestText = best.waves > 0
    ? (best.waves >= selected.waves ? `🏆 ${bkmpDungeonFormatTime(best.timeMs)}` : `Welle ${best.waves}/${selected.waves}`)
    : '—';
  const isRunningHere = bkmpDungeonActiveType === type.id && busy;
  const keyLine = bkmpDungeonKeyLineHtml(status);
  const bonusLine = status.dailyBonusAvailable
    ? '🎁 Tagesbonus verfügbar: +50 %'
    : '✓ Tagesbonus heute bereits erhalten';
  return `
    <div class="idle-dungeon-card${type.highlight ? ' idle-dungeon-card-special' : ''}${type.id === 'egg' ? ' idle-dungeon-card-egg' : ''}${type.id === 'rune' ? ' idle-dungeon-card-rune' : ''}" data-dungeon-type="${type.id}">
      <div class="idle-dungeon-card-head">
        <span class="idle-dungeon-card-icon">${type.icon}</span>
        <div>
          <strong>${type.name}</strong>
          <small>${type.short}</small>
        </div>
        ${type.id === bkmpDungeonSeasonalFeaturedType() ? `<span class="idle-dungeon-seasonal-badge" title="Diese Woche +${Math.round((BKMP_DUNGEON_SEASONAL_BONUS_MULT - 1) * 100)}% Belohnung">⭐</span>` : ''}
      </div>
      ${type.highlight ? `<div class="idle-dungeon-card-highlight">${type.highlight}</div>` : ''}
      <div class="idle-dungeon-card-keys" id="idle-dungeon-keys-${type.id}">${keyLine}</div>
      <div class="idle-dungeon-card-bonus${status.dailyBonusAvailable ? ' available' : ''}">${bonusLine}</div>
      <div class="idle-dungeon-diff-row">${BKMP_DUNGEON_DIFFICULTIES.map((d, i) => `
        <button type="button" class="idle-dungeon-diff-btn${d.id === selected.id ? ' active' : ''}" data-difficulty-id="${d.id}" ${busy || i > unlockedIdx ? 'disabled' : ''} title="${i > unlockedIdx ? 'Erst nach Abschluss der vorherigen Stufe freigeschaltet' : ''}">${d.icon} ${d.name}</button>
      `).join('')}</div>
      <p class="idle-dungeon-card-meta">${selected.waves} Wellen &middot; Bestleistung: ${bestText} &middot; ${status.totalCompletions}× geschafft, ${status.totalDefeats}× gescheitert</p>
      <button type="button" class="btn-ja idle-dungeon-start-btn" data-start-type="${type.id}" ${busy || status.keys < 1 ? 'disabled' : ''}>${isRunningHere ? '⏳ Läuft...' : status.keys < 1 ? '🔒 Keine Schlüssel' : `${selected.icon} Starten`}</button>
      <div class="idle-dungeon-auto-row">
        <span class="idle-dungeon-auto-label">🔁 Auto-Lauf:</span>
        <div class="idle-dungeon-diff-row">
          ${[1, 5].map(n => `<button type="button" class="btn-nein idle-dungeon-auto-btn" data-auto-type="${type.id}" data-auto-count="${n}" ${busy || status.keys < 1 ? 'disabled' : ''}>${n}×</button>`).join('')}
          <button type="button" class="btn-nein idle-dungeon-auto-btn" data-auto-type="${type.id}" data-auto-count="-1" ${busy || status.keys < 1 ? 'disabled' : ''}>Bis Schlüssel leer</button>
        </div>
      </div>
    </div>
  `;
}

function bkmpDungeonWireCard(type) {
  const card = document.querySelector(`.idle-dungeon-card[data-dungeon-type="${type.id}"]`);
  if (!card) return;
  card.querySelectorAll('.idle-dungeon-diff-btn').forEach(btn => btn.addEventListener('click', () => {
    if (bkmpDungeonActive || bkmpDungeonAutoActive()) return;
    bkmpDungeonSelectedDifficultyByType[type.id] = btn.dataset.difficultyId;
    bkmpIdleRenderDungeonPanel();
  }));
  const startBtn = card.querySelector('.idle-dungeon-start-btn');
  if (startBtn) startBtn.addEventListener('click', () => bkmpDungeonStart(type.id));
  card.querySelectorAll('.idle-dungeon-auto-btn').forEach(btn => btn.addEventListener('click', () => {
    const count = Number(btn.dataset.autoCount);
    bkmpDungeonStartAuto(type.id, count === -1 ? Infinity : count);
  }));
}

/* Spieler-Report (15.07., "Der Abbrechen Knopf geht nicht", Screenshot
   mitten in einer aktiven Welle): bkmpDungeonCancelAuto() bricht bewusst
   erst NACH dem gerade laufenden Versuch ab (siehe Kommentar dort), setzt
   dabei aber bisher NUR den internen bkmpDungeonAutoCancelled-Flag - diese
   Funktion hier baut den Banner alle 500ms unveraendert mit demselben
   aktiven "Abbrechen"-Button neu, egal ob der Flag schon gesetzt ist.
   Fuer den Spieler sah das nach einem Klick optisch exakt gleich aus wie
   vorher - kein Wunder, dass es wie "geht nicht" wirkte, obwohl der Auto-
   Lauf nach der aktuellen Welle tatsaechlich korrekt gestoppt haette.
   Jetzt zeigt der Banner nach dem Klick sofort einen erkennbaren anderen
   Zustand (kein Button mehr, Hinweistext statt "Abbrechen"). */
/* Performance (Nutzer-Auftrag, Section B Prioritaet 1 "Dungeon-Tick"):
   reiner Anzeige-Refresh (baut nur die Banner-innerHTML aus bereits
   vorhandenem State neu auf, veraendert nichts) - alle 500ms, auch wenn
   der Spieler laengst auf einem anderen Tab ist oder der Browser-Tab im
   Hintergrund liegt. bkmpIdleCombatVisualsActive() (idledorf.js) prueft
   exakt dieselbe Sichtbarkeit wie beim Hauptkampf-Tick (Dungeon-Kaempfe
   laufen ja auf demselben "Kampf"-Tab, siehe bkmpDungeonStart). */
function bkmpDungeonUpdateBanner() {
  const banner = document.getElementById('idleDungeonBanner');
  if (!banner || !bkmpDungeonActive || !bkmpDungeonActiveDifficulty) return;
  if (typeof bkmpIdleCombatVisualsActive === 'function' && !bkmpIdleCombatVisualsActive()) return;
  const dungeonType = bkmpDungeonTypeById(bkmpDungeonActiveType);
  const elapsed = Date.now() - bkmpDungeonStartTime;
  const totalLabel = bkmpDungeonAutoRunsTotal === Infinity ? '∞' : bkmpDungeonAutoRunsTotal;
  const autoSuffix = bkmpDungeonAutoActive()
    ? (bkmpDungeonAutoCancelled
        ? ` &middot; 🔁 Auto ${bkmpDungeonAutoRunsDone + 1}/${totalLabel} &middot; ⏹️ Wird nach dieser Welle beendet...`
        : ` &middot; 🔁 Auto ${bkmpDungeonAutoRunsDone + 1}/${totalLabel} <button type="button" class="idle-dungeon-auto-cancel-btn" id="idleDungeonAutoCancelBtn">Abbrechen</button>`)
    : '';
  banner.innerHTML = `${dungeonType.icon} ${dungeonType.name} (${bkmpDungeonActiveDifficulty.icon} ${bkmpDungeonActiveDifficulty.name}) &middot; Welle ${bkmpDungeonWave} / ${bkmpDungeonActiveDifficulty.waves} &middot; ⏱ ${bkmpDungeonFormatTime(elapsed)}${autoSuffix}`;
  if (bkmpDungeonAutoActive() && !bkmpDungeonAutoCancelled) {
    const cancelBtn = document.getElementById('idleDungeonAutoCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', bkmpDungeonCancelAuto);
  }
}

/* Setzt den fuer die normale Anzeige zustaendigen Sprite-/Namens-/HP-Kram
   auf einen beliebigen Drachen (echt oder Dungeon-Welle) - gleiche Logik
   wie in bkmpIdleSpawnDragon, hier extrahiert, damit sie sowohl fuer
   Dungeon-Wellen als auch fuer die Wiederherstellung des echten Drachen
   nach Dungeon-Ende genutzt werden kann, ohne den echten Fortschritt
   (current_dragon_index) anzufassen. */
function bkmpDungeonApplyDragonVisuals(dragon) {
  const nameEl = document.getElementById('idleDragonName');
  if (nameEl) {
    nameEl.textContent = dragon.isDungeon
      ? `${dragon.isBoss ? '👑 ' : ''}${dragon.name}`
      : `${dragon.isBoss ? '👑 BOSS: ' : ''}${dragon.isEventDragon ? '✨ ' : ''}${dragon.name} (Stufe ${bkmpIdleFormatStage(dragon.killIndex)})`;
  }
  bkmpIdleApplyDragonSprite(document.getElementById('idleDragonSprite'), dragon.spriteKey);
  const dragonEl = document.getElementById('idleDragon');
  if (dragonEl) {
    dragonEl.classList.toggle('idle-dragon-boss', dragon.bossTier === 'boss');
    dragonEl.classList.toggle('idle-dragon-miniboss', dragon.bossTier === 'miniboss');
    dragonEl.classList.toggle('idle-dragon-event', Boolean(dragon.isEventDragon));
  }
}

function bkmpDungeonSpawnWave(wave) {
  bkmpDungeonWave = wave;
  const s = bkmpIdleEffectiveStats;
  const waveMult = bkmpDungeonWaveMult(wave);
  /* Balance-Fix (Spieler-Meldung 15.07., Screenshot Level 117/Angriff 287/
     Verteidigung 284/HP 819: "Leicht" kippt schon bei Welle 7-8, niemand
     kommt weiter): sowohl maxHp ALS AUCH attack multiplizierten bisher mit
     dem VOLLEN waveMult. "Noetige Treffer bis zum Sieg" (aus maxHp/eigenem
     Schaden) UND "Schaden pro Gegentreffer" (aus attack) wuchsen dadurch
     GLEICHZEITIG mit demselben Faktor - der tatsaechliche GESAMTSCHADEN
     einer Welle (Treffer x Schaden/Treffer) wuchs also quadratisch statt,
     wie der Name "waveGrowth" nahelegt, linear mit der Wellenzahl.
     Nachgerechnet fuer den Report: bei Welle 7 (waveMult ~3.64) allein
     waren das ~1200 erwarteter Schaden gegen nur 819 max. Stadt-HP -
     rechnerisch nie ueberlebbar, ganz ohne die (separat unten gefixte)
     fehlende Zwischenheilung. Jetzt bekommen maxHp UND attack denselben
     gedaempften Multiplikator (waveMult^0.55 statt waveMult^1) - beide
     wachsen weiterhin spuerbar mit der Wellenzahl (spaete Wellen brauchen
     immer noch mehr Treffer UND treffen haerter), aber ihr PRODUKT (der
     eigentliche Gesamtschaden) waechst wieder ungefaehr im urspruenglich
     gemeinten waveGrowth-Tempo statt in dessen Quadrat. Mit dem 30%-
     Zwischenheil (siehe bkmpDungeonHandleWaveCleared) durchgerechnet und
     gegen den genauen Report-Screenshot verifiziert (node-Simulation,
     Level 117/Angriff 287/Verteidigung 284/HP 819/56,2% Krit/214% Krit-
     Schaden): schafft "Leicht" jetzt mit ca. 55% Rest-HP statt bei Welle
     7 zu sterben - spuerbar leichter, aber kein Selbstlaeufer. Mittel/
     Schwer/Albtraum bleiben bewusst deutlich haerter (mehr Wellen, hoehere
     waveGrowth-Werte) fuer staerker ausgebaute Charaktere.

     Balance-Fix (Spieler-Meldung 16.07.: "keiner schafft Mittel/Schwer/
     Albtraum"): combatMult wuchs oben trotz Daempfung (^0.55) ueber die
     GROESSERE Wellenzahl dieser drei Stufen weiter ungebremst exponentiell
     (bei Albtraum Welle 25 z.B. auf das ~100-fache von Welle 1). Da sowohl
     maxHp als auch attack mit combatMult skalieren, wuchs der GESAMTSCHADEN
     einer einzelnen Welle dadurch quadratisch mit combatMult - eine
     Simulation (node, alle vier Schwierigkeiten, mehrere realistische
     Spieler-Profile inkl. des obigen Report-Spielers) zeigte 0% Siegrate
     auf Mittel/Schwer/Albtraum unabhaengig vom Ausbaustand, weil KEIN
     Spieler-Stat (die sind alle ueber die Sammel-Pools weiter oben
     gedeckelt, siehe attack_pct/hp_pct/crit_chance-Caps) mit einem
     unbegrenzt wachsenden Gegner mithalten kann. Deckel auf 3.0 (per
     Simulation verifiziert: macht alle vier Schwierigkeiten fuer normal
     ausgebaute Charaktere zuverlaessig schaffbar, haelt Schwer/Albtraum
     durch die schiere Wellenzahl trotzdem spuerbar zaeher als Leicht/
     Mittel) - ab dem Zeitpunkt, an dem eine Welle das Cap erreicht, bleibt
     die Pro-Welle-Gefahr konstant statt weiter zu eskalieren. */
  const combatMult = Math.min(3.0, Math.pow(waveMult, 0.55));
  const fullRoster = bkmpIdleDragonDefs.length ? bkmpIdleDragonDefs : BKMP_IDLE_FALLBACK_DRAGONS;
  /* Nur "normale" aktive Drachen fuer die Wellen-Optik zulassen - Spieler-
     Meldung 17.07. ("Der hat überall Lücken") zeigte, dass die vorherige
     blinde Reihum-Auswahl ueber den KOMPLETTEN Roster auch Event-Drachen
     (spawn_rule 'event_easter', eigene Sonderbehandlung/Popup an anderer
     Stelle) und inaktive/unfertige Eintraege treffen konnte, deren Sprite
     nie fuer normale Anzeige gedacht war. */
  const roster = fullRoster.filter(d => d.active !== false && d.spawn_rule === 'standard');
  const safeRoster = roster.length ? roster : fullRoster;
  const archetype = safeRoster[(wave - 1) % safeRoster.length] || {};
  const isFinalWave = wave === bkmpDungeonActiveDifficulty.waves;
  /* Dungeon-System 2.0 (Spieler-Vorgabe: "ein Mini-Boss/stärkerer Gegner bei
     Welle 5"): bei jeder Schwierigkeit auf halbem Weg (aufgerundet) ein
     spuerbar staerkerer Zwischen-Gegner, zusaetzlich zum bestehenden
     Endboss auf der letzten Welle. */
  const isMinibossWave = !isFinalWave && wave === Math.ceil(bkmpDungeonActiveDifficulty.waves / 2);
  /* Balance-Audit-Fix (16.07.): der als "Dungeon-Champion" benannte Endboss
     bekam bisher GAR KEINEN eigenen Bonus (bossBump 1) - mechanisch schwaecher
     beworben als der Miniboss auf halber Strecke (1.15). 1.3 gewaehlt und
     gegen den frisch eingefuehrten combatMult-Cap simuliert (node, dieselben
     fuenf Spieler-Profile wie beim combatMult-Fix oben): bleibt fuer jeden
     normal ausgebauten Charakter zuverlaessig schaffbar (>=98% Siegrate ueber
     alle vier Schwierigkeiten), macht den eigentlichen Endkampf aber wieder
     spuerbar haerter als eine gewoehnliche Welle. */
  const bossBump = isFinalWave ? 1.3 : (isMinibossWave ? 1.15 : 1);
  bkmpIdleCurrentDragon = {
    id: 'dungeon-wave-' + wave,
    name: isFinalWave ? 'Dungeon-Champion' : (isMinibossWave ? 'Wellen-Elite' : `Wellen-Wächter (Welle ${wave})`),
    emoji: archetype.emoji || '🐉',
    spriteKey: archetype.sprite_key || archetype.id || 'standard',
    killIndex: 0,
    isBoss: isFinalWave,
    bossTier: isFinalWave ? 'boss' : (isMinibossWave ? 'miniboss' : null),
    isEventDragon: false,
    eventDragonKey: null,
    maxHp: Math.max(1, Math.round((s.attack || 10) * 4 * combatMult * bossBump)),
    /* Balance-Nachbesserung 17.07.: 0.035 war viel zu niedrig - kombiniert
       mit der (jetzt separat gefixten) passiven Heilung liess sich der
       Dungeon komplett ohne echten Gegenschaden durchspielen. 0.09 macht
       jeden Gegenangriff spuerbar (ca. 9% der eigenen maximalen Stadt-HP
       pro Treffer bei Welle 1, mit combatMult weiter steigend - siehe
       Balance-Fix-Kommentar oben zu combatMult vs. waveMult).

       Balance-Fix (Spieler-Meldung 16.07., siehe combatMult-Cap oben): der
       Gegenangriff skaliert bewusst mit der EIGENEN Stadt-HP (nicht dem
       eigenen Angriff), damit er unabhaengig vom Spiel-Baustil spuerbar
       bleibt - das bestrafte in der Simulation aber gerade HP-lastig
       ausgebaute Charaktere doppelt (mehr eigene HP = haertere Gegner-
       treffer, ohne dass mehr eigener Schaden dem etwas entgegensetzt).
       0.09 kombiniert mit dem jetzt gedeckelten combatMult war fuer solche
       Builds immer noch toedlich; 0.06 (simulationsgeprueft gegen einen
       schwachen, einen HP-lastigen [genau das Report-Profil oben], einen
       reinen Tank- und einen Glaskanonen-Build) macht alle vier
       Schwierigkeiten fuer jeden davon zuverlaessig schaffbar. */
    attack: Math.max(1, Math.round((s.hp || 100) * 0.06 * combatMult * bossBump)),
    defense: Math.round((s.defense || 0) * 0.3),
    isDungeon: true
  };
  bkmpIdleCurrentDragon.hp = bkmpIdleCurrentDragon.maxHp;
  bkmpDungeonApplyDragonVisuals(bkmpIdleCurrentDragon);
  bkmpIdleUpdateDragonHpBar();
  bkmpDungeonUpdateBanner();
}

async function bkmpDungeonStartAuto(type, count) {
  if (bkmpDungeonActive || bkmpDungeonAutoActive() || !count || count <= 0) return;
  bkmpDungeonAutoRunsTotal = count;
  bkmpDungeonAutoRunsDone = 0;
  bkmpDungeonAutoCancelled = false;
  bkmpDungeonAutoStats = { wins: 0, losses: 0, gold: 0, xp: 0, gems: 0, meat: 0, fruit: 0, eggs: 0, runes: 0, boostersGold: 0, boostersExp: 0 };
  /* bkmpDungeonStart() zeigt bei einer Blockade (Event-Pause/laufender
     Raid/keine Schluessel) selbst schon einen erklaerenden Toast - hier nur
     sauber zuruecksetzen, kein zweiter Hinweis noetig. */
  if (!(await bkmpDungeonStart(type))) {
    bkmpDungeonAutoRunsTotal = 0;
    bkmpDungeonAutoStats = null;
  }
}

/* Bricht NACH dem gerade laufenden Versuch ab (nicht mitten im Kampf -
   ein Abbruch waehrend eines Laufs wuerde Belohnung/Bestenliste des
   angefangenen Versuchs verlieren, ohne echten Vorteil). Waehrend der
   kurzen Pause zwischen zwei Laeufen (bkmpDungeonAutoNextRunTimer laeuft)
   greift der Abbruch sofort, da dort noch kein Kampf aktiv ist. */
function bkmpDungeonCancelAuto() {
  if (!bkmpDungeonAutoActive()) return;
  bkmpDungeonAutoCancelled = true;
  if (bkmpDungeonAutoNextRunTimer) {
    clearTimeout(bkmpDungeonAutoNextRunTimer);
    bkmpDungeonAutoNextRunTimer = null;
    bkmpDungeonAutoFinishSequence();
  }
}

function bkmpDungeonAutoFinishSequence() {
  const stats = bkmpDungeonAutoStats;
  const done = bkmpDungeonAutoRunsDone;
  const total = bkmpDungeonAutoRunsTotal;
  bkmpDungeonAutoRunsTotal = 0;
  bkmpDungeonAutoRunsDone = 0;
  bkmpDungeonAutoStats = null;
  bkmpDungeonAutoCancelled = false;
  /* Bug-Fix (Spieler-Report 16.07., "der Autokampf ist nicht abbrechbar"):
     wird waehrend der kurzen Pause zwischen zwei Auto-Laeufen auf
     Abbrechen geklickt (oder schlaegt der naechste Versuch dort fehl,
     z.B. weil zwischenzeitlich die Schluessel ausgingen), landet man
     HIER, OHNE vorher durch bkmpDungeonFinish() gelaufen zu sein - und
     nur DORT wurden Banner/Stage-Leiste bisher aufgeraeumt. Der Auto-Lauf
     stoppte technisch zwar sofort korrekt (kein weiterer Versuch startete
     mehr), das "naechster Versuch startet gleich..."-Banner samt totem
     Abbrechen-Button blieb aber fuer immer sichtbar stehen - fuer den
     Spieler sah das exakt wie ein wirkungsloser Klick aus. Jetzt raeumt
     diese Funktion die Anzeige selbst auf (idempotent, falls sie ueber
     bkmpDungeonFinish() bereits erledigt wurde). */
  const banner = document.getElementById('idleDungeonBanner');
  const stageBar = document.getElementById('idleStageBar');
  if (banner) banner.style.display = 'none';
  if (stageBar) stageBar.style.display = '';
  if (stats) {
    bkmpDungeonShowAutoSummary(stats, done, total);
  }
  if (bkmpIdleActiveTab === 'dungeon') bkmpDungeonRefreshStatus();
}

function bkmpDungeonShowAutoSummary(stats, done, total) {
  /* Bug-Fix (Spieler-Meldung 18.07., "genau das gleiche" wie die bereits
     gefixte Pro-Lauf-Log-Zeile): Gold und XP standen hier bisher IMMER in
     der Liste, egal ob der gelaufene Dungeon-Typ ueberhaupt XP vergibt
     (z.B. Ei-/Fleisch-/Frucht-/Edelstein-/Runen-Dungeon geben nie XP) -
     zeigte dann verwirrend "+0 XP" an. Jetzt wie bei den Nebenbelohnungen
     unten: nur anzeigen, was tatsaechlich > 0 ist. */
  const parts = [];
  if (stats.gold > 0) parts.push(`+${bkmpIdleFormatNumber(stats.gold)} 💰`);
  if (stats.xp > 0) parts.push(`+${bkmpIdleFormatNumber(stats.xp)} XP`);
  if (stats.gems > 0) parts.push(`+${stats.gems} 💎`);
  if (stats.meat > 0) parts.push(`+${bkmpIdleFormatNumber(stats.meat)} 🍖`);
  if (stats.fruit > 0) parts.push(`+${bkmpIdleFormatNumber(stats.fruit)} 🍎`);
  if (stats.eggs > 0) parts.push(`${stats.eggs}× 🥚`);
  if (stats.runes > 0) parts.push(`${stats.runes}× 🔮`);
  if (stats.boostersGold > 0) parts.push(`⚡ Goldrausch ${stats.boostersGold}×`);
  if (stats.boostersExp > 0) parts.push(`⚡ Wissensschub ${stats.boostersExp}×`);
  /* Phase 5.5 (19.07.): gleiche Ergaenzung wie bkmpDungeonShowResult - nach
     einem ganzen Auto-Lauf-Stapel ist "wie viele Schluessel bleiben mir fuer
     den naechsten Stapel" die naheliegendste Anschlussfrage. bkmpDungeonActiveType
     haelt zu diesem Zeitpunkt noch den soeben gelaufenen Typ (erst der
     naechste bkmpDungeonStart() ueberschreibt ihn wieder). */
  const status = bkmpDungeonActiveType ? bkmpDungeonStatusByType[bkmpDungeonActiveType] : null;
  const keyLine = status ? `<p class="idle-dungeon-result-keys">${bkmpDungeonKeyLineHtml(status)}</p>` : '';
  bkmpIdleShowDismissibleResultCard('bkmpDungeonResultOverlay', `
    <small>Auto-Lauf beendet &middot; ${done} / ${total === Infinity ? '∞' : total} Versuche</small>
    <strong>${stats.wins} 🏆 &middot; ${stats.losses} 💀</strong>
    <p>Gesamt-Belohnung: ${parts.join(' &middot; ')}</p>
    ${keyLine}
  `);
}

/* Gibt zurueck, ob der Lauf wirklich gestartet wurde - der Auto-Modus
   (bkmpDungeonStartAuto/bkmpDungeonFinish) braucht das, um sich sauber
   zu beenden statt haengen zu bleiben, falls ein Start (Erst-Aufruf ODER
   ein automatisch nachgeschobener Folgelauf) an einer dieser Bedingungen
   scheitert. Jetzt async: der Schluessel-Verbrauch laeuft ueber die
   serverseitige, now()-basierte RPC dungeon_consume_key (siehe
   supabase-dungeon-system-v2.sql) - erst wenn die einen Schluessel
   erfolgreich abgezogen hat, startet die eigentliche (weiterhin rein
   clientseitige) Kampf-Simulation. */
async function bkmpDungeonStart(type) {
  if (bkmpDungeonActive || bkmpDungeonStarting || bkmpTowerActive || !bkmpIdleState || !bkmpIdleEffectiveStats) return false;
  if (bkmpIdleEventPauseActive) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Erst den Event-Drachen bestätigen, bevor der Dungeon startet.', 3200);
    return false;
  }
  if (typeof bkmpRaidShouldShowCombatView === 'function' && bkmpRaidShouldShowCombatView()) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Während eines laufenden Raids kann der Dungeon nicht gestartet werden.', 3200);
    return false;
  }
  const dungeonType = bkmpDungeonTypeById(type);
  const difficultyId = bkmpDungeonSelectedDifficultyByType[type] || 'leicht';
  const status = bkmpDungeonStatusByType[type];
  const unlockedIdx = bkmpDungeonDifficultyIndex(status ? status.highestDifficulty : 'leicht');
  if (bkmpDungeonDifficultyIndex(difficultyId) > unlockedIdx) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Diese Schwierigkeit ist noch nicht freigeschaltet.', 3200);
    return false;
  }
  /* Lager-voll-Warnung (Spieler-Vorgabe: "Spieler muss VOR dem Start
     gewarnt werden") - Fleisch/Frucht sind die einzigen Belohnungstypen
     dieses Systems mit einem ECHTEN Kapazitaets-Deckel (bestehendes
     Gebaeude-Limit, siehe bkmpDragonResourceCap); Eier und Runen haben im
     gesamten restlichen Spiel gar kein Limit, ein Start-Block dafuer waere
     erfunden statt real - siehe Projektnotiz zur Dungeon-System-2.0-Analyse. */
  if (dungeonType.id === 'meat' || dungeonType.id === 'fruit') {
    const cap = bkmpDragonResourceCap(bkmpIdleState[dungeonType.id === 'meat' ? 'jagdhuette_level' : 'obstgarten_level'] || 0);
    if (Number(bkmpIdleState[dungeonType.id] || 0) >= cap && typeof bkmpShowJannikToast === 'function') {
      bkmpShowJannikToast(`⚠️ Dein ${dungeonType.id === 'meat' ? 'Fleisch' : 'Frucht'}-Lager ist bereits voll - die Belohnung wird trotzdem gutgeschrieben, sobald wieder Platz ist.`, 4200);
    }
  }

  bkmpDungeonStarting = true;
  let remainingKeys;
  try {
    remainingKeys = typeof bkmpDungeonConsumeKey === 'function' ? await bkmpDungeonConsumeKey(type) : 0;
  } catch (e) {
    bkmpDungeonStarting = false;
    if (String(e && e.message) === 'no_keys_available') {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🔒 Keine Schlüssel mehr für ${dungeonType.name}. Warte auf die Regeneration.`, 3600);
    } else {
      console.warn('Dungeon: Schluessel konnten nicht verbraucht werden.', e);
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Der Dungeon konnte nicht gestartet werden. Bitte versuche es erneut.', 3600);
    }
    bkmpDungeonRefreshStatus();
    return false;
  }
  bkmpDungeonStarting = false;
  if (bkmpDungeonStatusByType[type]) bkmpDungeonStatusByType[type].keys = remainingKeys;

  bkmpDungeonActive = true;
  bkmpDungeonActiveType = type;
  bkmpDungeonWave = 0;
  bkmpDungeonActiveDifficulty = BKMP_DUNGEON_DIFFICULTIES.find(d => d.id === difficultyId) || BKMP_DUNGEON_DIFFICULTIES[0];
  bkmpDungeonStartTime = Date.now();
  bkmpDungeonPrevDragon = bkmpIdleCurrentDragon;
  bkmpDungeonPrevVillageHp = bkmpIdleVillageHp;
  bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;

  bkmpIdleActiveTab = 'kampf';
  bkmpIdleTabs.forEach(t => {
    const b = document.getElementById(t.btn);
    const p = document.getElementById(t.panel);
    if (b) b.classList.toggle('active', t.id === 'kampf');
    if (p) p.style.display = t.id === 'kampf' ? '' : 'none';
  });
  const stageBar = document.getElementById('idleStageBar');
  if (stageBar) stageBar.style.display = 'none';
  const banner = document.getElementById('idleDungeonBanner');
  if (banner) banner.style.display = '';
  if (bkmpDungeonTimerInterval) clearInterval(bkmpDungeonTimerInterval);
  bkmpDungeonTimerInterval = setInterval(bkmpDungeonUpdateBanner, 500);
  bkmpDungeonSpawnWave(1);
  bkmpIdleUpdateVillageHpBar();
  if (typeof bkmpRuneSyncDrawerVisibility === 'function') bkmpRuneSyncDrawerVisibility();
  return true;
}

function bkmpDungeonHandleWaveCleared() {
  bkmpDragonGrantCompanionBattleXp(6);
  if (bkmpDungeonWave >= bkmpDungeonActiveDifficulty.waves) {
    bkmpDungeonFinish(true);
    return;
  }
  /* Balance-Fix (Spieler-Meldung 15.07., siehe combatMult-Kommentar in
     bkmpDungeonSpawnWave): anders als im normalen Kampf (dort heilt die
     Stadt nach JEDEM Sieg komplett, siehe bkmpIdleHandleDragonDefeated)
     gab es im Dungeon bisher GAR KEINE Erholung zwischen den Wellen -
     Schaden summierte sich ueber alle 10/15/20/25 Wellen ungebremst auf.
     Kein voller Heil (das wuerde die Herausforderung trivialisieren, nur
     der letzte Kampf zaehlte dann noch) - 30% der maximalen Stadt-HP
     Erholung nach jeder ueberstandenen Welle, gedeckelt aufs Maximum. */
  bkmpIdleVillageHp = Math.min(bkmpIdleEffectiveStats.hp, bkmpIdleVillageHp + bkmpIdleEffectiveStats.hp * 0.30);
  bkmpDungeonSpawnWave(bkmpDungeonWave + 1);
  bkmpIdleUpdateVillageHpBar();
}

function bkmpDungeonHandleFailure() {
  bkmpDungeonFinish(false);
}

/* Gemeinsame Belohnungs-Liste fuer die Einzelergebnis-Karte UND die Auto-
   Lauf-Log-Zeile (siehe bkmpDungeonFinish) - vorher zeigte die Log-Zeile
   IMMER nur Gold, auch bei Dungeon-Typen, deren Hauptbelohnung etwas ganz
   anderes ist (z.B. EXP-Dungeon: Gold ist dort nur die Nebenbelohnung,
   die eigentliche XP fehlte komplett in der Zeile - Spieler-Meldung 18.07.,
   Screenshot "Auto-Lauf ... EXP-Dungeon ... Sieg - +5.1K 💰" ohne jede
   XP-Angabe). */
function bkmpDungeonRewardParts(summary) {
  const parts = [];
  if (summary.gold > 0) parts.push(`+${bkmpIdleFormatNumber(summary.gold)} 💰`);
  if (summary.xp > 0) parts.push(`+${bkmpIdleFormatNumber(summary.xp)} XP`);
  if (summary.gems > 0) parts.push(`+${summary.gems} 💎`);
  if (summary.meat > 0) parts.push(`+${bkmpIdleFormatNumber(summary.meat)} 🍖`);
  if (summary.fruit > 0) parts.push(`+${bkmpIdleFormatNumber(summary.fruit)} 🍎`);
  summary.eggs.forEach(egg => { if (egg) parts.push(`🥚 ${egg.name}`); });
  summary.runes.forEach(rune => {
    const rarityDef = window.BKMP_RUNE_RARITIES.find(r => r.id === rune.rarity);
    parts.push(`🔮 ${rarityDef ? rarityDef.name : rune.rarity} Rune`);
  });
  if (summary.boosterGold) parts.push('⚡ Goldrausch (+25% Gold, 30 Min.)');
  if (summary.boosterExp) parts.push('⚡ Wissensschub (+25% EXP, 30 Min.)');
  return parts;
}
function bkmpDungeonShowResult(success, wavesCleared, totalWaves, elapsedMs, summary, difficulty, dungeonType, dailyBonusGranted) {
  const parts = bkmpDungeonRewardParts(summary);
  /* Phase 5.5 (19.07.): Auftrag Abschnitt 9 ("Dungeon-Abschluss ... verbleibende
     Versuche, Regen-Timer, naechster sinnvoller Schritt") - beides existiert
     bereits fertig berechnet (bkmpDungeonKeyLineHtml, gespeist aus dem in
     bkmpDungeonStart() beim Start bereits aktualisierten Schluessel-Stand),
     nur bisher nirgends in DIESEM Ergebnis-Popup sichtbar, nur in der
     Dungeon-Uebersichtskarte darunter. Reine Anzeige-Ergaenzung, keine neue
     Berechnung. Die kompakte Ein-Zeilen-Belohnungsuebersicht selbst bleibt
     unveraendert - erfuellt "keine zehn Dialoge" bereits seit Dungeon-System
     2.0, seltene Eier/Runen bekommen ihre zusaetzliche Hervorhebung separat
     ueber bkmpRewardPresent (siehe bkmpDungeonPersistEgg/-PersistRunes). */
  const status = bkmpDungeonStatusByType[dungeonType.id];
  const keyLine = status ? `<p class="idle-dungeon-result-keys">${bkmpDungeonKeyLineHtml(status)}</p>` : '';
  bkmpIdleShowDismissibleResultCard('bkmpDungeonResultOverlay', `
    <small>${dungeonType.icon} ${dungeonType.name} &middot; ${difficulty.icon} ${difficulty.name}</small>
    <strong>${success ? '🏆 Dungeon gemeistert!' : `💀 Bei Welle ${wavesCleared + 1} gescheitert`}</strong>
    <p>${success ? `Alle ${totalWaves} Wellen in ${bkmpDungeonFormatTime(elapsedMs)} geschafft!` : `${wavesCleared} von ${totalWaves} Wellen überstanden.`}${dailyBonusGranted ? '<br>🎁 Tagesbonus angewendet!' : ''}<br>Belohnung: ${parts.join(' &middot; ') || '—'}</p>
    ${keyLine}
  `);
}

const BKMP_DUNGEON_ACHIEVEMENT_KEY = 'bkmp-idle-dungeon-cleared';
function bkmpDungeonMarkAchievement() {
  try {
    if (localStorage.getItem(BKMP_DUNGEON_ACHIEVEMENT_KEY) === '1') return;
    localStorage.setItem(BKMP_DUNGEON_ACHIEVEMENT_KEY, '1');
  } catch (e) {}
}

async function bkmpDungeonFinish(success) {
  const difficulty = bkmpDungeonActiveDifficulty;
  const type = bkmpDungeonActiveType;
  const dungeonType = bkmpDungeonTypeById(type);
  const elapsedMs = Date.now() - bkmpDungeonStartTime;
  const wavesCleared = success ? difficulty.waves : Math.max(0, bkmpDungeonWave - 1);
  bkmpDungeonActive = false;
  if (bkmpDungeonTimerInterval) { clearInterval(bkmpDungeonTimerInterval); bkmpDungeonTimerInterval = null; }

  /* Auto-Lauf (siehe bkmpDungeonStartAuto): bei einem Sieg, der noch
     nicht der letzte angeforderte Versuch war und nicht abgebrochen
     wurde, bleibt die Kampfansicht/Banner sichtbar - der naechste Lauf
     startet gleich automatisch, kein Grund, zwischendurch auf die
     normale Dorf-Ansicht umzuschalten. */
  const willContinueAuto = bkmpDungeonAutoActive() && success && !bkmpDungeonAutoCancelled
    && (bkmpDungeonAutoRunsDone + 1) < bkmpDungeonAutoRunsTotal;

  const banner = document.getElementById('idleDungeonBanner');
  const stageBar = document.getElementById('idleStageBar');
  if (!willContinueAuto) {
    if (banner) banner.style.display = 'none';
    if (stageBar) stageBar.style.display = '';
  }

  bkmpIdleCurrentDragon = bkmpDungeonPrevDragon;
  bkmpIdleVillageHp = bkmpDungeonPrevVillageHp;
  if (bkmpIdleCurrentDragon) {
    bkmpDungeonApplyDragonVisuals(bkmpIdleCurrentDragon);
  } else {
    bkmpIdleSpawnDragon();
  }
  bkmpIdleUpdateDragonHpBar();
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleRenderStageBar();

  /* Tagesbonus IMMER ueber die serverseitige, idempotente RPC pruefen/
     beanspruchen (siehe dungeon_claim_daily_bonus in
     supabase-dungeon-system-v2.sql) - nie ueber die lokale Anzeige-Kopie
     entscheiden, sonst waere der Bonus per Reload/Mehrfachklick erneut
     ausloesbar. Nur bei vollstaendigem Erfolg ueberhaupt versucht. */
  let dailyBonusGranted = false;
  if (success) {
    try {
      dailyBonusGranted = typeof bkmpDungeonClaimDailyBonus === 'function' ? await bkmpDungeonClaimDailyBonus(type) : false;
    } catch (e) {
      console.warn('Dungeon: Tagesbonus konnte nicht geprueft werden.', e);
    }
  }

  const summary = bkmpDungeonGrantReward(type, difficulty, wavesCleared, success, dailyBonusGranted);

  if (success && type === 'gold' && difficulty.id === BKMP_DUNGEON_DIFFICULTIES[BKMP_DUNGEON_DIFFICULTIES.length - 1].id) {
    bkmpDungeonMarkAchievement();
  }

  /* Schwierigkeits-Freischaltung + Lifetime-Statistik serverseitig fuehren
     (siehe dungeon_mark_progress in supabase-dungeon-system-v2.sql) -
     nicht fatal, falls es fehlschlaegt (Netzwerk-Hoppler): der Lauf/die
     Belohnung ist zu diesem Zeitpunkt schon vergeben, nur die Statistik-
     Zeile bliebe dann bis zum naechsten Erfolg auf altem Stand. */
  try {
    if (typeof bkmpDungeonMarkProgress === 'function') {
      const newHighest = await bkmpDungeonMarkProgress(type, success, difficulty.id);
      const st = bkmpDungeonStatusByType[type];
      if (st) {
        st.highestDifficulty = newHighest || st.highestDifficulty;
        st.totalCompletions += success ? 1 : 0;
        st.totalDefeats += success ? 0 : 1;
        if (dailyBonusGranted) st.dailyBonusAvailable = false;
      }
    }
  } catch (e) {
    console.warn('Dungeon: Fortschritt konnte nicht gespeichert werden.', e);
  }

  const best = bkmpDungeonGetBest(type, difficulty.id);
  const newBest = { ...best };
  let improved = false;
  if (wavesCleared > best.waves) {
    newBest.waves = wavesCleared;
    newBest.timeMs = success ? elapsedMs : 0;
    improved = true;
  } else if (success && wavesCleared === difficulty.waves && (best.timeMs === 0 || elapsedMs < best.timeMs)) {
    newBest.timeMs = elapsedMs;
    improved = true;
  }
  bkmpDungeonSaveBest(type, difficulty.id, newBest);
  /* Nur bei ECHTER Verbesserung ans Bestenlisten-Backend melden (Spieler-
     Meldung 17.07.: "Wo ist die Bestenliste dafuer?") - kein Aufruf bei
     jedem Versuch, spart unnoetige Schreibzugriffe. */
  if (improved && bkmpIdleState && bkmpIdleState.name_key && typeof submitDungeonResult === 'function') {
    const displayName = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : bkmpIdleState.name_key;
    submitDungeonResult(bkmpIdleState.name_key, displayName, type, difficulty.id, newBest.waves, newBest.timeMs)
      .catch(e => console.warn('Dungeon: Bestwert konnte nicht ans Leaderboard gemeldet werden.', e));
  }

  bkmpIdleRenderHud();
  bkmpIdleQueueSync();

  if (bkmpDungeonAutoActive()) {
    /* Kein Vollbild-Overlay pro Einzelversuch waehrend eines Auto-Laufs
       (bei vielen Versuchen sonst wiederholtes Popup-Spam) - stattdessen
       eine Zeile im ohnehin schon offenen Kampf-Log, plus am Ende (Ziel
       erreicht/Niederlage/Abbruch) EINE zusammengefasste Meldung, siehe
       bkmpDungeonShowAutoSummary. */
    bkmpDungeonAutoRunsDone += 1;
    bkmpDungeonAutoStats.wins += success ? 1 : 0;
    bkmpDungeonAutoStats.losses += success ? 0 : 1;
    bkmpDungeonAutoStats.gold += summary.gold;
    bkmpDungeonAutoStats.xp += summary.xp;
    bkmpDungeonAutoStats.gems += summary.gems;
    bkmpDungeonAutoStats.meat += summary.meat;
    bkmpDungeonAutoStats.fruit += summary.fruit;
    bkmpDungeonAutoStats.eggs += summary.eggs.length;
    bkmpDungeonAutoStats.runes += summary.runes.length;
    if (summary.boosterGold) bkmpDungeonAutoStats.boostersGold += 1;
    if (summary.boosterExp) bkmpDungeonAutoStats.boostersExp += 1;
    const totalLabel = bkmpDungeonAutoRunsTotal === Infinity ? '∞' : bkmpDungeonAutoRunsTotal;
    const rewardText = bkmpDungeonRewardParts(summary).join(' · ') || '—';
    bkmpIdleLog(`${success ? '🏆' : '💀'} Auto-Lauf ${bkmpDungeonAutoRunsDone}/${totalLabel} (${dungeonType.icon} ${dungeonType.name}, ${difficulty.icon} ${difficulty.name}): ${success ? 'Sieg' : `Niederlage bei Welle ${wavesCleared + 1}`} - ${rewardText}`);

    if (willContinueAuto) {
      if (banner) {
        banner.innerHTML = `🔁 Auto-Lauf ${bkmpDungeonAutoRunsDone}/${totalLabel} &middot; naechster Versuch startet gleich... <button type="button" class="idle-dungeon-auto-cancel-btn" id="idleDungeonAutoCancelBtn">Abbrechen</button>`;
        const cancelBtn = document.getElementById('idleDungeonAutoCancelBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', bkmpDungeonCancelAuto);
      }
      bkmpDungeonAutoNextRunTimer = window.setTimeout(async () => {
        bkmpDungeonAutoNextRunTimer = null;
        if (!(await bkmpDungeonStart(type))) bkmpDungeonAutoFinishSequence();
      }, 1600);
    } else {
      bkmpDungeonAutoFinishSequence();
    }
    return;
  }

  bkmpDungeonShowResult(success, wavesCleared, difficulty.waves, elapsedMs, summary, difficulty, dungeonType, dailyBonusGranted);
  if (bkmpIdleActiveTab === 'dungeon') bkmpDungeonRefreshStatus();
}

// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). (2b-Ergaenzung)


function bkmpIdleRenderDungeonPanel() {
  const panel = document.getElementById('idlePanelDungeon');
  if (!panel || !bkmpIdleState) return;
  if (bkmpDungeonStatusLoadFailed) {
    panel.innerHTML = `
      <p class="empty-hint">⚠️ Dungeon-Status konnte nicht geladen werden. Bitte versuche es gleich noch einmal.</p>
      <button type="button" class="btn-ja" id="idleDungeonRetryBtn">🔄 Erneut versuchen</button>
    `;
    const retryBtn = document.getElementById('idleDungeonRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', () => { bkmpDungeonStatusLoadFailed = false; bkmpDungeonRefreshStatus(); });
    return;
  }
  if (!bkmpDungeonStatusLoadedAt) {
    panel.innerHTML = '<p class="empty-hint">Lädt Dungeon-Status...</p>';
    bkmpDungeonRefreshStatus();
    return;
  }
  const busy = bkmpDungeonActive || bkmpDungeonAutoActive();
  const seasonalType = bkmpDungeonTypeById(bkmpDungeonSeasonalFeaturedType());
  panel.innerHTML = `
    <div class="idle-dungeon-intro">
      <h4>🏛️ Dungeon-System</h4>
      <p>7 spezialisierte Dungeons, jeder mit eigenem Schlüssel-Vorrat (max. ${BKMP_DUNGEON_KEY_MAX}, +1 zu festen Uhrzeiten: 0, 4, 8, 12, 16 und 20 Uhr - läuft auch offline korrekt weiter) und eigenem Tagesbonus (+50% auf die erste erfolgreiche Runde pro Tag). Wähle einen Dungeon und eine Schwierigkeit - jede Schwierigkeit schaltet sich erst nach dem Meistern der vorherigen frei.</p>
      <p class="idle-dungeon-seasonal-hint">⭐ Diese Woche im Rampenlicht: <b>${seasonalType.icon} ${seasonalType.name}</b> - +${Math.round((BKMP_DUNGEON_SEASONAL_BONUS_MULT - 1) * 100)}% auf Gold/EXP/Fleisch/Frucht/Edelsteine bei Erfolg.</p>
    </div>
    <div class="idle-dungeon-type-grid">
      ${BKMP_DUNGEON_TYPES.map(t => bkmpDungeonRenderCard(t, busy)).join('')}
    </div>
  `;
  BKMP_DUNGEON_TYPES.forEach(t => bkmpDungeonWireCard(t));
  bkmpDungeonStartCountdownTicker();
}
