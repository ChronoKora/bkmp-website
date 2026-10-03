// Bkmp - Idle-Dorf "Chronik" (03.10.2026). js/systems/bkmp-chronicle.js
/* ============================================================
   Langzeitmotivation fuer das Idle-Drachendorf (Nutzer-Auftrag 03.10.2026:
   "mehr Langzeitmotivation, Tiefe und Leben", ohne das Spiel neu zu bauen).
   Die Analyse (siehe IDLE_DORF_WEITERENTWICKLUNG.md) hat gezeigt: das Spiel
   hat bereits sehr viele SYSTEME (Prestige, Runen, Zucht, Dungeons, Turm,
   Gilde, Arena, Weltboss), aber vier Luecken genau bei den im Auftrag
   genannten Punkten:
     - keine persoenlichen Tages-/Wochenziele (nur Gilden-Quests)
     - keine zufaelligen Ereignisse waehrend des Kampfes
     - eine Login-Belohnung, die bei Langzeitspielern bedeutungslos wird
       (fest max. 10.000 Gold, egal ob Stufe 5 oder Stufe 5000)
     - keine Sammlung fuer die Drachen, die man im Kampf besiegt
   Dieses Modul schliesst diese vier Luecken plus eine "Naechste Ziele"-
   Uebersicht, die vorhandene Inhalte sichtbar macht:
     1) Tagesauftraege (3/Tag) + Wochenziele (3/Woche) + Truhen
     2) Login-Kalender (7-Tage-Zyklus, Belohnung waechst mit dem Spieler) -
        Auszahlung weiterhin in bkmpIdleCheckDailyStreak() (bkmp-events.js)
     3) Drachen-Bestiarium: Kills pro Drachenart, Stufen mit Dauerboni
     4) Weltereignisse: zufaellig waehrend man dem Kampf zusieht
     5) "Naechste Ziele": rein abgeleitet, keine eigene Logik
   Alle Belohnungen nutzen ausschliesslich BESTEHENDE Bausteine
   (bkmpIdleRewardsAt fuer die Skalierung, bkmpDungeonRollRune/-PersistRunes,
   bkmpDungeonRollEgg/-PersistEgg, bkmpDungeonGrantBoost, bkmpIdleAddXp) -
   keine zweite Kopie einer Belohnungs- oder Drop-Formel.

   Persistenz: EINE JSONB-Zeile pro Konto (idle_player_meta, siehe
   sql/20261003-idle-player-meta.sql) + sofortiger localStorage-Spiegel. Fehlt
   die Tabelle (SQL noch nicht ausgefuehrt), laeuft alles rein lokal weiter.
   Bewusst KEINE neue Spalte auf idle_player_state.

   Ladereihenfolge: klassisches globales Skript wie alle /js/systems/-Dateien.
   Ruft Funktionen aus idledorf.js/bkmp-dungeon.js/... erst zur LAUFZEIT auf
   (nie beim Laden) - die umgekehrte Richtung (idledorf.js -> hier) laeuft
   ueberall ueber typeof-Guards, damit admin.html/idle-stream-mini.html (die
   diese Datei nicht einbinden) unveraendert funktionieren.
   ============================================================ */

const BKMP_CHRONICLE_VERSION = 1;
const BKMP_CHRONICLE_LS_PREFIX = 'bkmp-idle-chronicle-v1:';
const BKMP_CHRONICLE_SERVER_SAVE_DEBOUNCE_MS = 20000;
const BKMP_CHRONICLE_LOCAL_SAVE_DEBOUNCE_MS = 1500;
const BKMP_CHRONICLE_TRACK_INTERVAL_MS = 4000;

let bkmpChronicle = null;
let bkmpChronicleNameKey = null;
let bkmpChronicleServerDisabled = false;
let bkmpChronicleLoadPromise = null;
let bkmpChronicleLoadingKey = null;
let bkmpChronicleLocalTimer = null;
let bkmpChronicleServerTimer = null;
let bkmpChronicleServerSaving = false;
let bkmpChronicleServerSaveQueued = false;
let bkmpChronicleDirty = false;
let bkmpChronicleLastTrackAt = 0;
let bkmpChronicleClaimBusy = false;
let bkmpChronicleModalTab = 'quests';
let bkmpChronicleLastModalHtml = '';
/* Fortschritt, der VOR dem (asynchronen) Laden eintrifft (z.B. ein Klick in
   der ersten Sekunde nach dem Oeffnen) - wird nach dem Laden nachgereicht. */
let bkmpChroniclePendingProgress = [];
let bkmpChroniclePendingKills = {};

/* ---------------- Zeit/Perioden ---------------- */
function bkmpChronicleNow() {
  return typeof bkmpGetGameNow === 'function' ? bkmpGetGameNow() : Date.now();
}
function bkmpChronicleDayKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/* ISO-Kalenderwoche (Montag-Start), lokale Zeit. Tagesdifferenz wird auf
   ganze Tage GERUNDET, damit eine Sommer-/Winterzeit-Stunde innerhalb des
   Zeitraums nie eine falsche Woche ergibt. */
function bkmpChronicleWeekKey(ms) {
  const d = new Date(ms);
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayNr + 3);
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const jan4DayNr = (jan4.getDay() + 6) % 7;
  const firstThursday = new Date(jan4.getFullYear(), 0, 4 - jan4DayNr + 3);
  const days = Math.round((thursday - firstThursday) / 86400000);
  const week = 1 + Math.round(days / 7);
  return thursday.getFullYear() + '-W' + String(week).padStart(2, '0');
}
function bkmpChronicleMsUntilNextDay(ms) {
  const d = new Date(ms);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return Math.max(0, next - d);
}
function bkmpChronicleMsUntilNextWeek(ms) {
  const d = new Date(ms);
  const dayNr = (d.getDay() + 6) % 7;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (7 - dayNr));
  return Math.max(0, next - d);
}
function bkmpChronicleFormatDuration(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} T ${hours} Std.`;
  if (hours > 0) return `${hours} Std. ${mins} Min.`;
  return `${mins} Min.`;
}
function bkmpChronicleFmt(n) {
  return typeof bkmpIdleFormatNumber === 'function' ? bkmpIdleFormatNumber(n) : String(Math.floor(Number(n) || 0));
}
function bkmpChronicleEsc(s) {
  return typeof escapeHtml === 'function' ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function bkmpChronicleRoll(seed) {
  if (typeof bkmpIdleSeededRoll01 === 'function') return bkmpIdleSeededRoll01(seed);
  return Math.random();
}

/* ---------------- Belohnungs-Skalierung ----------------
   EINE gemeinsame "Belohnungseinheit" fuer alle Systeme dieses Moduls:
   Gold/EXP = genau das, was ein normaler Drache auf der persoenlichen
   HOECHSTEN Stufe gerade geben wuerde (inkl. aller Spieler-Boni) - exakt
   dieselbe bkmpIdleRewardsAt()-Formel wie beim echten Kill. Kristalle/Essenz
   = was ein Boss gibt (normale Drachen geben laut idle_dragons gar keine).
   Dadurch fuehlt sich jede Belohnung fuer Stufe-5- UND Stufe-5000-Spieler
   gleich wertvoll an ("so viel wie N Minuten Kaempfen"), ohne die Wirtschaft
   mit festen Zahlen zu sprengen oder bedeutungslos zu werden. */
function bkmpChronicleRewardUnits() {
  const units = { gold: 5, xp: 5, crystals: 2, essence: 1 };
  if (typeof bkmpIdleRewardsAt !== 'function' || !bkmpIdleState) return units;
  const defs = Array.isArray(bkmpIdleDragonDefs) ? bkmpIdleDragonDefs : [];
  const std = defs.find(d => d && d.spawn_rule === 'standard' && d.active !== false) || defs[0];
  const boss = defs.find(d => d && d.spawn_rule === 'boss_25' && d.active !== false) || std;
  const idx = Math.max(0, Number(bkmpIdleState.highest_dragon_index || 0));
  const cfg = typeof bkmpIdleGetMergedRewardScalingCfg === 'function' ? bkmpIdleGetMergedRewardScalingCfg() : {};
  const stats = bkmpIdleEffectiveStats || {};
  try {
    const normal = std ? bkmpIdleRewardsAt({ archetype: std, killIndex: idx, bossTier: null }, stats, cfg) : null;
    const bossR = boss ? bkmpIdleRewardsAt({ archetype: boss, killIndex: idx, bossTier: 'boss' }, stats, cfg) : null;
    if (normal) {
      units.gold = Math.max(units.gold, Number(normal.gold) || 0);
      units.xp = Math.max(units.xp, Number(normal.xp) || 0);
    }
    if (bossR) {
      units.crystals = Math.max(units.crystals, Number(bossR.crystals) || 0);
      units.essence = Math.max(units.essence, Number(bossR.essence) || 0);
    }
  } catch (e) { /* Fallback-Einheiten oben */ }
  return units;
}
/* Seltenheits-Stufe fuer Runen/Eier aus Truhen (0-3 = dieselben Gewichtungen
   wie die Dungeon-Schwierigkeiten Leicht..Albtraum) - waechst mit dem
   Lebenszeit-Fortschritt, identisches Prinzip wie bkmpTowerMilestoneDifficultyIdx. */
function bkmpChronicleLootTierIdx() {
  const lifetime = typeof bkmpIdleLifetimeStageCount === 'function' ? bkmpIdleLifetimeStageCount() : 0;
  if (lifetime >= 3000) return 3;
  if (lifetime >= 1000) return 2;
  if (lifetime >= 250) return 1;
  return 0;
}

/* ---------------- Auftrags-Typen ----------------
   counter: Fortschritt aus bereits gespeicherten Zaehlern in bkmpIdleState
     (Delta-Verfahren, siehe bkmpChronicleTrack) - zaehlt damit automatisch
     auch Offline-Fortschritt mit ("Belohnung fuers Zurueckkehren").
   ohne counter: Fortschritt per bkmpChronicleAddProgress(type, n) aus dem
     jeweiligen System (Dungeon/Turm/Klick/Fuetterung/Arena/Weltereignis).
   units: Ziel = Belohnungseinheit Gold x units (waechst mit dem Spieler). */
const BKMP_CHRONICLE_QUEST_TYPES = {
  kills: { icon: '🐉', counter: 'kills', daily: 400, weekly: 6000, weight: 10, goTab: 'kampf', text: n => `Besiege ${bkmpChronicleFmt(n)} Drachen` },
  boss_kills: { icon: '👑', counter: 'bossKills', daily: 12, weekly: 150, weight: 8, goTab: 'kampf', text: n => `Besiege ${bkmpChronicleFmt(n)} Bosse oder Minibosse` },
  gold: { icon: '💰', counter: 'gold', dailyUnits: 500, weeklyUnits: 8000, weight: 9, goTab: 'kampf', text: n => `Verdiene ${bkmpChronicleFmt(n)} Gold` },
  playtime: { icon: '⏱️', counter: 'playtime', daily: 900, weekly: 10800, weight: 7, goTab: 'kampf', text: n => `Lass dein Dorf ${Math.round(n / 60)} Minuten kämpfen` },
  upgrades: { icon: '⬆️', counter: 'upgrades', daily: 30, weekly: 300, weight: 7, goTab: 'upgrades', text: n => `Kaufe ${bkmpChronicleFmt(n)} Upgrade-Stufen` },
  rune_upgrades: { icon: '🔮', counter: 'runeUp', daily: 8, weekly: 50, weight: 6, goTab: 'runen', text: n => `Versuche ${bkmpChronicleFmt(n)} Runen-Aufwertungen`, available: () => Array.isArray(bkmpIdlePlayerRunes) && bkmpIdlePlayerRunes.length > 0 },
  clicks: { icon: '👆', daily: 150, weekly: 1500, weight: 6, goTab: 'kampf', text: n => `Greife ${bkmpChronicleFmt(n)}-mal per Klick an` },
  dungeon_runs: { icon: '🏛️', daily: 2, weekly: 14, weight: 7, goTab: 'dungeon', text: n => `Bestreite ${n} Dungeon-Läufe` },
  tower_waves: { icon: '🗼', daily: 15, weekly: 100, weight: 6, goTab: 'turm', text: n => `Erklimme ${n} Stufen im Endlosen Turm` },
  world_events: { icon: '✨', daily: 2, weekly: 15, weight: 7, goTab: 'kampf', text: n => `Erlebe ${n} Weltereignisse im Kampf` },
  dragon_feeds: { icon: '🍖', daily: 3, weekly: null, weight: 5, goTab: 'drachen', text: n => `Füttere deine Babydrachen ${n}-mal`, available: () => Array.isArray(bkmpPlayerDragons) && bkmpPlayerDragons.some(d => d && d.stage === 'baby') },
  arena_fights: { icon: '⚔️', daily: 2, weekly: 12, weight: 4, goTab: 'arena', text: n => `Bestreite ${n} Arena-Kämpfe` }
};
const BKMP_CHRONICLE_COUNTER_TO_TYPE = { kills: 'kills', bossKills: 'boss_kills', gold: 'gold', playtime: 'playtime', upgrades: 'upgrades', runeUp: 'rune_upgrades' };
const BKMP_CHRONICLE_TAB_BUTTONS = {
  kampf: 'idleTabBtnKampf', upgrades: 'idleTabBtnUpgrades', runen: 'idleTabBtnRunen', dungeon: 'idleTabBtnDungeon',
  turm: 'idleTabBtnTurm', arena: 'idleTabBtnArena', drachen: 'idleTabBtnDrachen', prestige: 'idleTabBtnPrestige', erfolge: 'idleTabBtnErfolge',
  skilltree: 'idleTabBtnSkilltree', gilde: 'idleTabBtnGilde', dorf: 'idleTabBtnDorf'
};

function bkmpChronicleQuestTarget(scope, type) {
  const def = BKMP_CHRONICLE_QUEST_TYPES[type];
  if (!def) return 1;
  if (def.dailyUnits || def.weeklyUnits) {
    const units = bkmpChronicleRewardUnits();
    const mult = scope === 'weekly' ? def.weeklyUnits : def.dailyUnits;
    return Math.max(100, Math.round(units.gold * mult));
  }
  return Math.max(1, Number(scope === 'weekly' ? def.weekly : def.daily) || 1);
}
function bkmpChronicleTypeAvailable(scope, type) {
  const def = BKMP_CHRONICLE_QUEST_TYPES[type];
  if (!def) return false;
  if (scope === 'weekly' && !def.weekly && !def.weeklyUnits) return false;
  if (typeof def.available === 'function') {
    try { return Boolean(def.available()); } catch (e) { return false; }
  }
  return true;
}
/* Deterministisch aus Spielername + Periode gewuerfelt: zwei Geraete erzeugen
   dieselben Auftraege, auch bevor sie sich ueber die Datenbank abgeglichen
   haben - und ein Neuladen wuerfelt nie neu. */
function bkmpChronicleGenerateQuests(scope, periodKey, count, excludeTypes, saltPrefix) {
  const pool = Object.keys(BKMP_CHRONICLE_QUEST_TYPES).filter(t => !(excludeTypes || []).includes(t) && bkmpChronicleTypeAvailable(scope, t));
  const quests = [];
  let salt = 0;
  while (quests.length < count && pool.length) {
    const totalWeight = pool.reduce((sum, t) => sum + BKMP_CHRONICLE_QUEST_TYPES[t].weight, 0);
    let r = bkmpChronicleRoll(`${bkmpChronicleNameKey}|${scope}|${periodKey}|${saltPrefix || ''}${salt++}`) * totalWeight;
    let pick = pool[pool.length - 1];
    for (const t of pool) {
      r -= BKMP_CHRONICLE_QUEST_TYPES[t].weight;
      if (r < 0) { pick = t; break; }
    }
    pool.splice(pool.indexOf(pick), 1);
    quests.push({ type: pick, target: bkmpChronicleQuestTarget(scope, pick), progress: 0, claimed: false });
  }
  return quests;
}

/* ---------------- Datenmodell / Normalisierung / Merge ---------------- */
function bkmpChronicleEmpty() {
  return {
    v: BKMP_CHRONICLE_VERSION,
    updatedAt: 0,
    daily: null,
    weekly: null,
    trackers: null,
    trackersAt: 0,
    streak: null,
    bestiary: {},
    /* Drachendorf-Ausbau Phase 4: Dex-Rekorde pro Art [hoechste Form 0-4,
       hoechster Aufstieg, hoechste Bindung, Expeditionen] - nur steigend. */
    dex: {},
    /* Drachendorf-Ausbau Phase 5: abgeholte Dorfpfad-Ziele { zielId: 1 } (nur ODER). */
    path: {},
    life: { questsDone: 0, dailyChests: 0, weeklyChests: 0, eventsCaught: 0, eventsByType: {} }
  };
}
function bkmpChronicleNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function bkmpChronicleNormalizePeriod(p) {
  if (!p || typeof p !== 'object' || typeof p.key !== 'string' || !Array.isArray(p.quests)) return null;
  const quests = p.quests
    .filter(q => q && BKMP_CHRONICLE_QUEST_TYPES[q.type])
    .slice(0, 5)
    .map(q => {
      const target = Math.max(1, bkmpChronicleNum(q.target) || 1);
      return { type: q.type, target, progress: Math.min(target, bkmpChronicleNum(q.progress)), claimed: Boolean(q.claimed) };
    });
  return { key: p.key, quests, chestClaimed: Boolean(p.chestClaimed), rerollsUsed: Math.min(9, bkmpChronicleNum(p.rerollsUsed)) };
}
function bkmpChronicleNormalize(raw) {
  const c = bkmpChronicleEmpty();
  if (!raw || typeof raw !== 'object') return c;
  c.updatedAt = bkmpChronicleNum(raw.updatedAt);
  c.daily = bkmpChronicleNormalizePeriod(raw.daily);
  c.weekly = bkmpChronicleNormalizePeriod(raw.weekly);
  if (raw.trackers && typeof raw.trackers === 'object') {
    c.trackers = {};
    Object.keys(BKMP_CHRONICLE_COUNTER_TO_TYPE).forEach(k => { c.trackers[k] = bkmpChronicleNum(raw.trackers[k]); });
    c.trackersAt = bkmpChronicleNum(raw.trackersAt);
  }
  if (raw.streak && typeof raw.streak === 'object' && typeof raw.streak.lastDate === 'string') {
    c.streak = { count: Math.floor(bkmpChronicleNum(raw.streak.count)), lastDate: raw.streak.lastDate };
  }
  if (raw.bestiary && typeof raw.bestiary === 'object') {
    Object.keys(raw.bestiary).slice(0, 80).forEach(k => {
      if (/^[a-z0-9_-]{1,40}$/i.test(k)) c.bestiary[k] = Math.floor(bkmpChronicleNum(raw.bestiary[k]));
    });
  }
  if (raw.dex && typeof raw.dex === 'object') {
    Object.keys(raw.dex).slice(0, 200).forEach(k => {
      const v = raw.dex[k];
      if (!/^[a-z0-9_-]{1,40}$/i.test(k) || !Array.isArray(v)) return;
      c.dex[k] = [
        Math.min(4, Math.floor(bkmpChronicleNum(v[0]))),
        Math.min(100, Math.floor(bkmpChronicleNum(v[1]))),
        Math.min(10, Math.floor(bkmpChronicleNum(v[2]))),
        Math.min(1e7, Math.floor(bkmpChronicleNum(v[3])))
      ];
    });
  }
  if (raw.path && typeof raw.path === 'object') {
    Object.keys(raw.path).slice(0, 300).forEach(k => {
      if (/^[a-z0-9_-]{1,40}$/i.test(k) && raw.path[k]) c.path[k] = 1;
    });
  }
  if (raw.life && typeof raw.life === 'object') {
    ['questsDone', 'dailyChests', 'weeklyChests', 'eventsCaught'].forEach(k => { c.life[k] = Math.floor(bkmpChronicleNum(raw.life[k])); });
    if (raw.life.eventsByType && typeof raw.life.eventsByType === 'object') {
      Object.keys(raw.life.eventsByType).slice(0, 20).forEach(k => { c.life.eventsByType[k] = Math.floor(bkmpChronicleNum(raw.life.eventsByType[k])); });
    }
  }
  return c;
}
function bkmpChronicleMergePeriod(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.key !== b.key) return a.key > b.key ? a : b;
  const sameShape = a.quests.length === b.quests.length && a.quests.every((q, i) => q.type === b.quests[i].type);
  let quests;
  if (sameShape) {
    quests = a.quests.map((q, i) => {
      const o = b.quests[i];
      const target = Math.max(q.target, o.target);
      return { type: q.type, target, progress: Math.min(target, Math.max(q.progress, o.progress)), claimed: q.claimed || o.claimed };
    });
  } else {
    /* Eine Seite hat einen Auftrag neu ausgewuerfelt: die Seite mit mehr
       bereits abgeholten Auftraegen gewinnt (verhindert doppelte Belohnung),
       bei Gleichstand die mit mehr Neuwuerfeln (= die neuere Entscheidung). */
    const claimedA = a.quests.filter(q => q.claimed).length;
    const claimedB = b.quests.filter(q => q.claimed).length;
    quests = (claimedA !== claimedB ? (claimedA > claimedB ? a : b) : (a.rerollsUsed >= b.rerollsUsed ? a : b)).quests.map(q => ({ ...q }));
  }
  return { key: a.key, quests, chestClaimed: a.chestClaimed || b.chestClaimed, rerollsUsed: Math.max(a.rerollsUsed, b.rerollsUsed) };
}
function bkmpChronicleMerge(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const m = bkmpChronicleEmpty();
  m.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  m.daily = bkmpChronicleMergePeriod(local.daily, remote.daily);
  m.weekly = bkmpChronicleMergePeriod(local.weekly, remote.weekly);
  const trackerSrc = (remote.trackersAt || 0) > (local.trackersAt || 0) ? remote : local;
  m.trackers = trackerSrc.trackers ? { ...trackerSrc.trackers } : (local.trackers || remote.trackers);
  m.trackersAt = Math.max(local.trackersAt || 0, remote.trackersAt || 0);
  if (local.streak && remote.streak) {
    m.streak = local.streak.lastDate !== remote.streak.lastDate
      ? (local.streak.lastDate > remote.streak.lastDate ? local.streak : remote.streak)
      : { lastDate: local.streak.lastDate, count: Math.max(local.streak.count, remote.streak.count) };
  } else {
    m.streak = local.streak || remote.streak;
  }
  new Set([...Object.keys(local.bestiary), ...Object.keys(remote.bestiary)]).forEach(k => {
    m.bestiary[k] = Math.max(local.bestiary[k] || 0, remote.bestiary[k] || 0);
  });
  new Set([...Object.keys(local.dex || {}), ...Object.keys(remote.dex || {})]).forEach(k => {
    const a = (local.dex || {})[k] || [0, 0, 0, 0];
    const b = (remote.dex || {})[k] || [0, 0, 0, 0];
    m.dex[k] = [0, 1, 2, 3].map(i => Math.max(a[i] || 0, b[i] || 0));
  });
  Object.keys(Object.assign({}, local.path || {}, remote.path || {})).forEach(k => { m.path[k] = 1; });
  ['questsDone', 'dailyChests', 'weeklyChests', 'eventsCaught'].forEach(k => { m.life[k] = Math.max(local.life[k] || 0, remote.life[k] || 0); });
  new Set([...Object.keys(local.life.eventsByType), ...Object.keys(remote.life.eventsByType)]).forEach(k => {
    m.life.eventsByType[k] = Math.max(local.life.eventsByType[k] || 0, remote.life.eventsByType[k] || 0);
  });
  return m;
}

/* ---------------- Persistenz ---------------- */
function bkmpChronicleLsKey(nameKey) { return BKMP_CHRONICLE_LS_PREFIX + nameKey; }
function bkmpChronicleReadLocal(nameKey) {
  try {
    const raw = localStorage.getItem(bkmpChronicleLsKey(nameKey));
    return raw ? bkmpChronicleNormalize(JSON.parse(raw)) : null;
  } catch (e) { return null; }
}
function bkmpChronicleWriteLocal() {
  if (!bkmpChronicle || !bkmpChronicleNameKey) return;
  try { localStorage.setItem(bkmpChronicleLsKey(bkmpChronicleNameKey), JSON.stringify(bkmpChronicle)); } catch (e) {}
}
function bkmpChronicleIsMissingTableError(e) {
  if (!e) return false;
  const code = String(e.code || '');
  const msg = String(e.message || '') + ' ' + String(e.details || '') + ' ' + String(e.hint || '');
  return code === 'PGRST205' || code === '42P01' || (/idle_player_meta/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg));
}
async function bkmpChronicleFetchRemote() {
  if (bkmpChronicleServerDisabled || typeof loadIdlePlayerMeta !== 'function') return null;
  try {
    const row = await loadIdlePlayerMeta();
    return row && row.data ? bkmpChronicleNormalize(row.data) : null;
  } catch (e) {
    if (bkmpChronicleIsMissingTableError(e)) bkmpChronicleServerDisabled = true;
    else console.warn('Chronik: Serverstand konnte nicht geladen werden (lokal weiter).', e);
    return null;
  }
}
function bkmpChronicleMarkDirty() {
  if (!bkmpChronicle) return;
  bkmpChronicle.updatedAt = Date.now();
  bkmpChronicleDirty = true;
  if (!bkmpChronicleLocalTimer) {
    bkmpChronicleLocalTimer = window.setTimeout(() => { bkmpChronicleLocalTimer = null; bkmpChronicleWriteLocal(); }, BKMP_CHRONICLE_LOCAL_SAVE_DEBOUNCE_MS);
  }
  if (!bkmpChronicleServerTimer && !bkmpChronicleServerDisabled) {
    bkmpChronicleServerTimer = window.setTimeout(() => { bkmpChronicleServerTimer = null; bkmpChronicleSaveNow(); }, BKMP_CHRONICLE_SERVER_SAVE_DEBOUNCE_MS);
  }
}
async function bkmpChronicleSaveNow() {
  if (!bkmpChronicle) return false;
  if (bkmpChronicleLocalTimer) { clearTimeout(bkmpChronicleLocalTimer); bkmpChronicleLocalTimer = null; }
  if (bkmpChronicleServerTimer) { clearTimeout(bkmpChronicleServerTimer); bkmpChronicleServerTimer = null; }
  bkmpChronicleWriteLocal();
  if (bkmpChronicleServerDisabled || typeof upsertIdlePlayerMeta !== 'function') { bkmpChronicleDirty = false; return false; }
  if (bkmpChronicleServerSaving) { bkmpChronicleServerSaveQueued = true; return false; }
  bkmpChronicleServerSaving = true;
  try {
    await upsertIdlePlayerMeta(bkmpChronicleNameKey, bkmpChronicle);
    bkmpChronicleDirty = false;
    return true;
  } catch (e) {
    if (bkmpChronicleIsMissingTableError(e)) bkmpChronicleServerDisabled = true;
    else console.warn('Chronik: Speichern auf dem Server fehlgeschlagen (lokal gesichert).', e);
    return false;
  } finally {
    bkmpChronicleServerSaving = false;
    if (bkmpChronicleServerSaveQueued) { bkmpChronicleServerSaveQueued = false; bkmpChronicleSaveNow(); }
  }
}
/* Vor jeder Belohnungs-Auszahlung: frischen Serverstand dazumischen, damit ein
   auf einem ANDEREN Geraet bereits abgeholter Auftrag hier nicht ein zweites
   Mal ausgezahlt wird. */
async function bkmpChronicleRefreshFromServer() {
  if (!bkmpChronicle) return;
  const remote = await bkmpChronicleFetchRemote();
  if (remote) bkmpChronicle = bkmpChronicleMerge(bkmpChronicle, remote);
}

/* Laedt den Chronik-Stand fuer den angemeldeten Spieler (lokal + Server,
   zusammengefuehrt). Mehrfach-Aufruf-sicher, gibt immer dasselbe Promise
   fuer denselben Namen zurueck. */
function bkmpChronicleEnsureLoaded(name) {
  const nameKey = String(name || (bkmpIdleState && bkmpIdleState.name_key) || '').trim().toLowerCase();
  if (!nameKey) return Promise.resolve(null);
  if (bkmpChronicle && bkmpChronicleNameKey === nameKey) return Promise.resolve(bkmpChronicle);
  if (bkmpChronicleLoadPromise && bkmpChronicleLoadingKey === nameKey) return bkmpChronicleLoadPromise;
  bkmpChronicleLoadingKey = nameKey;
  bkmpChronicleLoadPromise = (async () => {
    const local = bkmpChronicleReadLocal(nameKey);
    const remote = await bkmpChronicleFetchRemote();
    bkmpChronicleNameKey = nameKey;
    bkmpChronicle = bkmpChronicleMerge(local || bkmpChronicleEmpty(), remote);
    bkmpChronicleAdoptStreakIntoLocal();
    bkmpChronicleEnsurePeriods();
    bkmpChronicleTrack(true);
    bkmpChronicleFlushPending();
    bkmpChronicleWriteLocal();
    if (typeof bkmpIdleRecomputeEffectiveStats === 'function' && bkmpIdleState) bkmpIdleRecomputeEffectiveStats();
    bkmpChronicleRefreshUi();
    return bkmpChronicle;
  })().finally(() => { bkmpChronicleLoadPromise = null; bkmpChronicleLoadingKey = null; });
  return bkmpChronicleLoadPromise;
}
/* Kontowechsel im selben Tab: alten Stand sofort sichern und verwerfen. */
function bkmpChronicleResetForAccountSwitch() {
  if (bkmpChronicle && bkmpChronicleDirty) bkmpChronicleSaveNow();
  bkmpChronicle = null;
  bkmpChronicleNameKey = null;
  bkmpChroniclePendingProgress = [];
  bkmpChroniclePendingKills = {};
}
function bkmpChronicleReady() {
  if (!bkmpChronicle || !bkmpIdleState) return false;
  if (bkmpChronicleNameKey !== bkmpIdleState.name_key) {
    bkmpChronicleResetForAccountSwitch();
    bkmpChronicleEnsureLoaded(bkmpIdleState.name_key);
    return false;
  }
  return true;
}
function bkmpChronicleFlushPending() {
  const progress = bkmpChroniclePendingProgress;
  bkmpChroniclePendingProgress = [];
  progress.forEach(p => bkmpChronicleAddProgress(p.type, p.amount));
  const kills = bkmpChroniclePendingKills;
  bkmpChroniclePendingKills = {};
  Object.keys(kills).forEach(id => bkmpChronicleAddBestiaryKills(id, kills[id], true));
}

/* ---------------- Login-Serie (bkmp-events.js) ----------------
   Die Serie selbst bleibt unveraendert im bestehenden localStorage-Schluessel
   (Erfolge/Titel lesen ihn dort). Die Chronik spiegelt sie nur zusaetzlich auf
   den Server - so geht die Serie bei einem Geraetewechsel nicht mehr verloren
   und wird nicht doppelt ausgezahlt. */
function bkmpChronicleAdoptStreakIntoLocal() {
  if (!bkmpChronicle || !bkmpChronicle.streak || typeof bkmpIdleGetStreakData !== 'function') return;
  const local = bkmpIdleGetStreakData();
  const remote = bkmpChronicle.streak;
  const remoteNewer = !local.lastDate || remote.lastDate > local.lastDate || (remote.lastDate === local.lastDate && remote.count > Number(local.count || 0));
  if (remoteNewer && typeof bkmpIdleSaveStreakData === 'function') bkmpIdleSaveStreakData({ count: remote.count, lastDate: remote.lastDate });
}
function bkmpChronicleMirrorStreak(data, rewardGranted) {
  if (!bkmpChronicleReady() || !data || !data.lastDate) return;
  const prev = bkmpChronicle.streak;
  if (prev && prev.lastDate === data.lastDate && prev.count === data.count) return;
  bkmpChronicle.streak = { count: Number(data.count || 0), lastDate: data.lastDate };
  bkmpChronicleMarkDirty();
  if (rewardGranted) bkmpChronicleSaveNow();
}

/* Faktoren bewusst so gewaehlt, dass ein BRANDNEUER Spieler (Stufe 0, ~6 Gold
   pro Kill) in der ersten Woche exakt die alten Betraege bekommt (die alte
   Formel greift als Untergrenze) - sonst haette schon der allererste Login
   z.B. den Titel "Erste Reserven" (1.000 Gold sammeln) geschenkt statt
   erspielt (per cosmetics.spec.js gefunden). Die Skalierung greift erst mit
   echtem Fortschritt - dort wird sie dann schnell deutlich groesser. */
const BKMP_CHRONICLE_CALENDAR = [
  { day: 1, icon: '💰', label: 'Goldbeutel', gold: 80 },
  { day: 2, icon: '📚', label: 'Gold & Erfahrung', gold: 110, xp: 100 },
  { day: 3, icon: '💎', label: 'Kristalle & Essenz', crystals: 2, essence: 2 },
  { day: 4, icon: '🌟', label: 'Goldrausch (30 Min.)', gold: 140, boostGold: true },
  { day: 5, icon: '💎', label: 'Kristallschatz', gold: 80, crystals: 4 },
  { day: 6, icon: '📜', label: 'Wissensschub (30 Min.)', xp: 200, boostExp: true },
  { day: 7, icon: '🎁', label: 'Wochentruhe mit Rune', gold: 220, crystals: 5, essence: 4, runes: 1 }
];
function bkmpChronicleCalendarWeekMult(count) {
  return 1 + Math.min(0.5, Math.floor(Math.max(0, count - 1) / 7) * 0.1);
}
/* Belohnung fuer den count-ten Tag in Folge (bereits fertig skaliert). Wird
   von bkmpIdleCheckDailyStreak() ausgezahlt - die alte, feste Formel (Gold
   min(10.000, 500 x Tag) JEDEN Tag + 10 Kristalle an jedem 5. Tag) bleibt als
   UNTERGRENZE erhalten, damit kein Anfaenger je weniger bekommt als vorher. */
function bkmpChronicleLoginReward(count) {
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  const entry = BKMP_CHRONICLE_CALENDAR[(safeCount - 1) % 7];
  const units = bkmpChronicleRewardUnits();
  const mult = bkmpChronicleCalendarWeekMult(safeCount);
  const legacyGold = Math.min(10000, 500 * safeCount);
  const legacyGems = safeCount % 5 === 0 ? 10 : 0;
  return {
    day: entry.day,
    icon: entry.icon,
    label: entry.label,
    mult,
    gold: Math.max(legacyGold, entry.gold ? Math.round(units.gold * entry.gold * mult) : 0),
    xp: entry.xp ? Math.round(units.xp * entry.xp * mult) : 0,
    crystals: (entry.crystals ? Math.round(units.crystals * entry.crystals * mult) : 0) + legacyGems,
    essence: entry.essence ? Math.round(units.essence * entry.essence * mult) : 0,
    runes: entry.runes || 0,
    runeIdx: bkmpChronicleLootTierIdx(),
    boostGold: Boolean(entry.boostGold),
    boostExp: Boolean(entry.boostExp)
  };
}

/* ---------------- Belohnung auszahlen ----------------
   Schreibt ausschliesslich in bereits bestehende, synchronisierte Felder bzw.
   ueber bestehende Persistenz-Pfade (Runen/Eier/Booster). Gold zaehlt NICHT
   als Fortschritt fuer den eigenen "Verdiene Gold"-Auftrag (Tracker wird
   mitgezogen - sonst wuerde eine Auftragsbelohnung den naechsten Auftrag
   gleich mit erfuellen). Gibt die Anzeige-Teile zurueck. */
function bkmpChronicleGrant(reward) {
  const parts = [];
  if (!bkmpIdleState || !reward) return parts;
  const gold = Math.max(0, Math.round(reward.gold || 0));
  const xp = Math.max(0, Math.round(reward.xp || 0));
  const crystals = Math.max(0, Math.round(reward.crystals || 0));
  const essence = Math.max(0, Math.round(reward.essence || 0));
  if (gold > 0) {
    bkmpIdleState.gold = Number(bkmpIdleState.gold || 0) + gold;
    bkmpIdleState.total_gold_earned = Number(bkmpIdleState.total_gold_earned || 0) + gold;
    if (bkmpChronicle && bkmpChronicle.trackers) bkmpChronicle.trackers.gold = Number(bkmpChronicle.trackers.gold || 0) + gold;
    parts.push(`+${bkmpChronicleFmt(gold)} 💰`);
  }
  if (crystals > 0) { bkmpIdleState.crystals = Number(bkmpIdleState.crystals || 0) + crystals; parts.push(`+${bkmpChronicleFmt(crystals)} 💎`); }
  if (essence > 0) { bkmpIdleState.essence = Number(bkmpIdleState.essence || 0) + essence; parts.push(`+${bkmpChronicleFmt(essence)} 🧪`); }
  if (xp > 0) {
    if (typeof bkmpIdleAddXp === 'function') bkmpIdleAddXp(xp);
    else bkmpIdleState.xp = Number(bkmpIdleState.xp || 0) + xp;
    parts.push(`+${bkmpChronicleFmt(xp)} EP`);
  }
  const runeCount = Math.max(0, Math.floor(reward.runes || 0));
  if (runeCount > 0 && typeof bkmpDungeonRollRune === 'function' && typeof bkmpDungeonPersistRunes === 'function') {
    const runes = [];
    for (let i = 0; i < runeCount; i++) {
      try { runes.push(bkmpDungeonRollRune(Math.max(0, Math.min(3, reward.runeIdx || 0)))); } catch (e) {}
    }
    if (runes.length) {
      bkmpDungeonPersistRunes(runes);
      const rarityNames = runes.map(r => {
        const rarity = Array.isArray(window.BKMP_RUNE_RARITIES) ? window.BKMP_RUNE_RARITIES.find(x => x.id === r.rarity) : null;
        return rarity ? rarity.name : 'Rune';
      });
      parts.push(`🔮 ${runes.length > 1 ? runes.length + ' Runen' : 'Rune'} (${rarityNames.join(', ')})`);
    }
  }
  if (reward.egg && typeof bkmpDungeonRollEgg === 'function' && typeof bkmpDungeonPersistEgg === 'function') {
    let egg = null;
    try { egg = bkmpDungeonRollEgg(Math.max(0, Math.min(3, reward.eggIdx || 0))); } catch (e) {}
    if (egg) {
      bkmpDungeonPersistEgg(egg);
      parts.push(`🥚 ${egg.name}-Ei`);
    }
  }
  if (reward.boostGold && typeof bkmpDungeonGrantBoost === 'function') { bkmpDungeonGrantBoost('gold'); parts.push('🌟 Goldrausch 30 Min.'); }
  if (reward.boostExp && typeof bkmpDungeonGrantBoost === 'function') { bkmpDungeonGrantBoost('exp'); parts.push('📚 Wissensschub 30 Min.'); }
  if (typeof bkmpIdleRenderHud === 'function') bkmpIdleRenderHud();
  if (typeof bkmpIdleQueueSync === 'function') bkmpIdleQueueSync();
  return parts;
}

/* ---------------- Auftraege: Perioden, Fortschritt, Abholen ---------------- */
function bkmpChronicleEnsurePeriods() {
  if (!bkmpChronicle) return;
  const now = bkmpChronicleNow();
  const dayKey = bkmpChronicleDayKey(now);
  const weekKey = bkmpChronicleWeekKey(now);
  let changed = false;
  if (!bkmpChronicle.daily || bkmpChronicle.daily.key !== dayKey) {
    bkmpChronicle.daily = { key: dayKey, quests: bkmpChronicleGenerateQuests('daily', dayKey, 3), chestClaimed: false, rerollsUsed: 0 };
    changed = true;
  }
  if (!bkmpChronicle.weekly || bkmpChronicle.weekly.key !== weekKey) {
    bkmpChronicle.weekly = { key: weekKey, quests: bkmpChronicleGenerateQuests('weekly', weekKey, 3), chestClaimed: false, rerollsUsed: 0 };
    changed = true;
  }
  if (changed) bkmpChronicleMarkDirty();
}
function bkmpChronicleCounterValues() {
  const s = bkmpIdleState || {};
  const upgrades = Object.values(s.upgrade_purchases || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
  return {
    kills: Number(s.dragon_kills || 0),
    bossKills: Number(s.boss_kills || 0),
    gold: Number(s.total_gold_earned || 0),
    playtime: Math.floor(Number(s.playtime_seconds || 0)),
    upgrades,
    runeUp: Number(s.rune_upgrade_successes || 0) + Number(s.rune_upgrade_failures || 0)
  };
}
/* Delta-Verfahren: nur ZUWAECHSE seit dem letzten Abgleich zaehlen. Sinkt ein
   Zaehler (Prestige setzt z.B. Upgrades zurueck), wird nur die Basis neu
   gesetzt - nie negativer Fortschritt, nie rueckwirkend erfundener. */
function bkmpChronicleTrack(force) {
  if (!bkmpChronicleReady()) return;
  const now = Date.now();
  if (!force && now - bkmpChronicleLastTrackAt < BKMP_CHRONICLE_TRACK_INTERVAL_MS) return;
  bkmpChronicleLastTrackAt = now;
  bkmpChronicleEnsurePeriods();
  const cur = bkmpChronicleCounterValues();
  const prev = bkmpChronicle.trackers;
  bkmpChronicle.trackers = cur;
  bkmpChronicle.trackersAt = now;
  if (!prev) { bkmpChronicleMarkDirty(); return; }
  let progressed = false;
  Object.keys(BKMP_CHRONICLE_COUNTER_TO_TYPE).forEach(counter => {
    const delta = Number(cur[counter]) - Number(prev[counter]);
    if (Number.isFinite(delta) && delta > 0) progressed = bkmpChronicleApplyProgress(BKMP_CHRONICLE_COUNTER_TO_TYPE[counter], delta) || progressed;
  });
  if (progressed || prev.playtime !== cur.playtime) bkmpChronicleMarkDirty();
  bkmpChronicleRefreshUi();
}
function bkmpChronicleApplyProgress(type, amount) {
  let changed = false;
  ['daily', 'weekly'].forEach(scope => {
    const period = bkmpChronicle[scope];
    if (!period) return;
    period.quests.forEach(q => {
      if (q.type !== type || q.claimed || q.progress >= q.target) return;
      const before = q.progress;
      q.progress = Math.min(q.target, q.progress + amount);
      changed = true;
      if (before < q.target && q.progress >= q.target) bkmpChronicleNotifyQuestComplete(scope, q);
    });
  });
  return changed;
}
/* Oeffentlicher Einstieg fuer Ereignis-Fortschritt (Dungeon/Turm/Klick/...). */
function bkmpChronicleAddProgress(type, amount) {
  const n = Math.max(0, Number(amount) || 0);
  if (!n || !BKMP_CHRONICLE_QUEST_TYPES[type]) return;
  if (!bkmpChronicleReady()) {
    if (bkmpChroniclePendingProgress.length < 500) bkmpChroniclePendingProgress.push({ type, amount: n });
    return;
  }
  bkmpChronicleEnsurePeriods();
  if (bkmpChronicleApplyProgress(type, n)) {
    bkmpChronicleMarkDirty();
    bkmpChronicleRefreshUi();
  }
}
function bkmpChronicleNotifyQuestComplete(scope, quest) {
  const def = BKMP_CHRONICLE_QUEST_TYPES[quest.type];
  if (typeof bkmpRewardPresent === 'function') {
    bkmpRewardPresent({
      tier: 'toast',
      title: `✅ ${scope === 'weekly' ? 'Wochenziel' : 'Tagesauftrag'} erfüllt: ${def ? def.text(quest.target) : ''} – Belohnung in der Chronik abholen!`,
      dedupeKey: `chronicle-done-${scope}-${quest.type}`,
      autoCloseMs: 4200
    });
  }
}
function bkmpChronicleQuestReward(scope) {
  const u = bkmpChronicleRewardUnits();
  if (scope === 'weekly') return { gold: u.gold * 1500, xp: u.xp * 1200, crystals: u.crystals * 8, essence: u.essence * 5 };
  return { gold: u.gold * 250, xp: u.xp * 200, crystals: u.crystals * 2 };
}
function bkmpChronicleChestReward(scope) {
  const u = bkmpChronicleRewardUnits();
  const idx = bkmpChronicleLootTierIdx();
  if (scope === 'weekly') {
    return { crystals: u.crystals * 15, essence: u.essence * 10, runes: 2, runeIdx: Math.min(3, idx + 1), egg: true, eggIdx: idx, boostGold: true, boostExp: true };
  }
  return { crystals: u.crystals * 4, essence: u.essence * 3, runes: 1, runeIdx: idx, randomBoost: true };
}
function bkmpChronicleClaimableCount() {
  if (!bkmpChronicle) return 0;
  let n = 0;
  ['daily', 'weekly'].forEach(scope => {
    const p = bkmpChronicle[scope];
    if (!p) return;
    n += p.quests.filter(q => !q.claimed && q.progress >= q.target).length;
    if (!p.chestClaimed && p.quests.length && p.quests.every(q => q.claimed)) n += 1;
  });
  /* Drachendorf-Ausbau Phase 5: abholbare Dorfpfad-Ziele zaehlen mit. */
  if (typeof bkmpPathClaimableCount === 'function') n += bkmpPathClaimableCount();
  return n;
}
async function bkmpChronicleClaimQuest(scope, index) {
  if (bkmpChronicleClaimBusy || !bkmpChronicleReady()) return;
  bkmpChronicleClaimBusy = true;
  try {
    await bkmpChronicleRefreshFromServer();
    bkmpChronicleEnsurePeriods();
    const period = bkmpChronicle[scope];
    const quest = period && period.quests[index];
    if (!quest || quest.claimed || quest.progress < quest.target) return;
    quest.claimed = true;
    bkmpChronicle.life.questsDone += 1;
    bkmpChronicleMarkDirty();
    bkmpChronicleWriteLocal();
    const parts = bkmpChronicleGrant(bkmpChronicleQuestReward(scope));
    bkmpChronicleSaveNow();
    const def = BKMP_CHRONICLE_QUEST_TYPES[quest.type];
    if (typeof bkmpRewardPresent === 'function') {
      bkmpRewardPresent({
        tier: scope === 'weekly' ? 'card' : 'toast',
        rarity: scope === 'weekly' ? 'rare' : null,
        icon: def ? def.icon : '📜',
        title: scope === 'weekly' ? 'Wochenziel abgeschlossen!' : `Auftrag abgeschlossen! ${parts.join(' ')}`,
        description: scope === 'weekly' ? parts.join(' · ') : undefined,
        source: 'Chronik',
        dedupeKey: `chronicle-claim-${scope}-${period.key}-${index}`
      });
    }
    if (typeof bkmpIdleGetAchievementContextFields === 'function') bkmpIdleGetAchievementContextFields();
    if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
    bkmpChronicleFlashClaimed(scope, index);
  } finally {
    bkmpChronicleClaimBusy = false;
    bkmpChronicleRefreshUi(true);
  }
}
async function bkmpChronicleClaimChest(scope) {
  if (bkmpChronicleClaimBusy || !bkmpChronicleReady()) return;
  bkmpChronicleClaimBusy = true;
  try {
    await bkmpChronicleRefreshFromServer();
    bkmpChronicleEnsurePeriods();
    const period = bkmpChronicle[scope];
    if (!period || period.chestClaimed || !period.quests.length || !period.quests.every(q => q.claimed)) return;
    period.chestClaimed = true;
    if (scope === 'weekly') bkmpChronicle.life.weeklyChests += 1;
    else bkmpChronicle.life.dailyChests += 1;
    bkmpChronicleMarkDirty();
    bkmpChronicleWriteLocal();
    const reward = bkmpChronicleChestReward(scope);
    if (reward.randomBoost) {
      if (Math.random() < 0.35) {
        if (Math.random() < 0.5) reward.boostGold = true; else reward.boostExp = true;
      }
    }
    const parts = bkmpChronicleGrant(reward);
    bkmpChronicleSaveNow();
    if (typeof bkmpRewardPresent === 'function') {
      bkmpRewardPresent({
        tier: 'card',
        rarity: scope === 'weekly' ? 'legendary' : 'epic',
        icon: scope === 'weekly' ? '👑' : '🎁',
        title: scope === 'weekly' ? 'Wochentruhe geöffnet!' : 'Tagestruhe geöffnet!',
        description: parts.join(' · '),
        source: 'Chronik',
        dedupeKey: `chronicle-chest-${scope}-${period.key}`
      });
    }
    if (typeof bkmpIdleGetAchievementContextFields === 'function') bkmpIdleGetAchievementContextFields();
    if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
  } finally {
    bkmpChronicleClaimBusy = false;
    bkmpChronicleRefreshUi(true);
  }
}
/* Ein Tagesauftrag pro Tag darf kostenlos neu ausgewuerfelt werden (nur wenn
   noch nicht erfuellt) - kleine Komfortfunktion gegen "unpassende" Auftraege. */
function bkmpChronicleRerollQuest(index) {
  if (!bkmpChronicleReady()) return;
  bkmpChronicleEnsurePeriods();
  const period = bkmpChronicle.daily;
  const quest = period && period.quests[index];
  if (!quest || quest.claimed || quest.progress >= quest.target || period.rerollsUsed >= 1) return;
  const exclude = period.quests.map(q => q.type);
  const replacement = bkmpChronicleGenerateQuests('daily', period.key, 1, exclude, `reroll${period.rerollsUsed}-${index}-`)[0];
  if (!replacement) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Gerade gibt es keinen anderen passenden Auftrag.', 2800);
    return;
  }
  period.quests[index] = replacement;
  period.rerollsUsed += 1;
  bkmpChronicleMarkDirty();
  bkmpChronicleSaveNow();
  bkmpChronicleRefreshUi(true);
}

/* ---------------- Drachen-Bestiarium ----------------
   Kills PRO Drachenart (nur normaler Kampf - Dungeon/Turm haben eigene
   Wellen). Jede Art hat 5 Stufen; jede erreichte Stufe gibt einen kleinen,
   DAUERHAFTEN Bonus, der wie jede andere Quelle in denselben Sammel-Pott von
   bkmpIdleRecomputeEffectiveStats() fliesst (dort gedeckelt). Offline-Kills
   werden anteilig verteilt (siehe bkmpChronicleCreditOfflineKills). */
const BKMP_CHRONICLE_BESTIARY_TIERS = {
  standard: [100, 1000, 10000, 50000, 250000],
  rare: [10, 100, 1000, 5000, 25000],
  miniboss_10: [10, 100, 1000, 5000, 25000],
  boss_25: [5, 50, 500, 2500, 10000]
};
const BKMP_CHRONICLE_BESTIARY_TIER_NAMES = ['Bronze', 'Silber', 'Gold', 'Platin', 'Diamant'];
const BKMP_CHRONICLE_BESTIARY_BONUS = {
  feuerdrache: { effectType: 'attack_pct', perTier: 2 },
  blitzdrache: { effectType: 'crit_damage_pct', perTier: 4 },
  erddrache: { effectType: 'defense_pct', perTier: 2 },
  wasserdrache: { effectType: 'hp_pct', perTier: 2 },
  winddrache: { effectType: 'xp_pct', perTier: 2 },
  cyberdrache: { effectType: 'gold_prod_pct', perTier: 2 },
  schattendrache: { effectType: 'loot_chance_pct', perTier: 3 },
  wuffdrache: { effectType: 'gold_prod_pct', perTier: 3 },
  'yakshas-drache': { effectType: 'attack_pct', perTier: 2 },
  'yaksha-boss': { effectType: 'boss_dmg_pct', perTier: 3 }
};
const BKMP_CHRONICLE_BESTIARY_BONUS_BY_RULE = {
  standard: { effectType: 'attack_pct', perTier: 1 },
  rare: { effectType: 'loot_chance_pct', perTier: 2 },
  miniboss_10: { effectType: 'attack_pct', perTier: 2 },
  boss_25: { effectType: 'boss_dmg_pct', perTier: 3 }
};
const BKMP_CHRONICLE_EFFECT_LABELS = {
  attack_pct: v => `+${v}% Angriff`,
  defense_pct: v => `+${v}% Verteidigung`,
  hp_pct: v => `+${v}% Leben`,
  crit_damage_pct: v => `+${v}% Krit-Schaden`,
  xp_pct: v => `+${v}% Erfahrung`,
  gold_prod_pct: v => `+${v}% Gold`,
  loot_chance_pct: v => `+${v}% Beute`,
  boss_dmg_pct: v => `+${v}% Schaden gegen Welt-/Gildenbosse`
};
function bkmpChronicleEffectLabel(effectType, value) {
  const fn = BKMP_CHRONICLE_EFFECT_LABELS[effectType];
  return fn ? fn(value) : `+${value} ${effectType}`;
}
function bkmpChronicleBestiaryKinds() {
  const defs = Array.isArray(bkmpIdleDragonDefs) ? bkmpIdleDragonDefs : [];
  return defs.filter(d => d && d.id && d.active !== false && d.spawn_rule !== 'event_easter' && BKMP_CHRONICLE_BESTIARY_TIERS[d.spawn_rule]);
}
function bkmpChronicleBestiaryThresholds(kind) {
  return BKMP_CHRONICLE_BESTIARY_TIERS[kind && kind.spawn_rule] || BKMP_CHRONICLE_BESTIARY_TIERS.standard;
}
function bkmpChronicleBestiaryBonus(kind) {
  return BKMP_CHRONICLE_BESTIARY_BONUS[kind.id] || BKMP_CHRONICLE_BESTIARY_BONUS_BY_RULE[kind.spawn_rule] || BKMP_CHRONICLE_BESTIARY_BONUS_BY_RULE.standard;
}
function bkmpChronicleBestiaryTier(kind, count) {
  return bkmpChronicleBestiaryThresholds(kind).filter(t => count >= t).length;
}
function bkmpChronicleBestiaryEffectTotals() {
  const totals = {};
  if (!bkmpChronicle || !bkmpIdleState || bkmpChronicleNameKey !== bkmpIdleState.name_key) return totals;
  bkmpChronicleBestiaryKinds().forEach(kind => {
    const tier = bkmpChronicleBestiaryTier(kind, bkmpChronicle.bestiary[kind.id] || 0);
    if (!tier) return;
    const bonus = bkmpChronicleBestiaryBonus(kind);
    totals[bonus.effectType] = (totals[bonus.effectType] || 0) + tier * bonus.perTier;
  });
  return totals;
}
function bkmpChronicleBestiaryTotalTiers() {
  if (!bkmpChronicle) return 0;
  return bkmpChronicleBestiaryKinds().reduce((sum, kind) => sum + bkmpChronicleBestiaryTier(kind, bkmpChronicle.bestiary[kind.id] || 0), 0);
}
function bkmpChronicleAddBestiaryKills(kindId, amount, silent) {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (!n || !kindId) return;
  if (!bkmpChronicleReady()) {
    bkmpChroniclePendingKills[kindId] = (bkmpChroniclePendingKills[kindId] || 0) + n;
    return;
  }
  const kind = bkmpChronicleBestiaryKinds().find(k => k.id === kindId);
  if (!kind) return;
  const before = bkmpChronicle.bestiary[kindId] || 0;
  const after = before + n;
  bkmpChronicle.bestiary[kindId] = after;
  const tierBefore = bkmpChronicleBestiaryTier(kind, before);
  const tierAfter = bkmpChronicleBestiaryTier(kind, after);
  bkmpChronicleMarkDirty();
  if (tierAfter > tierBefore) {
    if (typeof bkmpIdleRecomputeEffectiveStats === 'function') bkmpIdleRecomputeEffectiveStats();
    const bonus = bkmpChronicleBestiaryBonus(kind);
    if (!silent && typeof bkmpRewardPresent === 'function') {
      bkmpRewardPresent({
        tier: tierAfter >= 4 ? 'card' : 'toast',
        rarity: tierAfter >= 4 ? 'epic' : null,
        icon: kind.emoji || '🐉',
        title: `📖 Bestiarium: ${kind.name} – ${BKMP_CHRONICLE_BESTIARY_TIER_NAMES[tierAfter - 1]}! ${bkmpChronicleEffectLabel(bonus.effectType, bonus.perTier)}`,
        description: `Dauerhaft: ${bkmpChronicleEffectLabel(bonus.effectType, tierAfter * bonus.perTier)}`,
        source: 'Bestiarium',
        dedupeKey: `bestiary-${kindId}-${tierAfter}`
      });
    }
    if (typeof bkmpIdleGetAchievementContextFields === 'function') bkmpIdleGetAchievementContextFields();
  }
}
/* Aufruf aus bkmpIdleHandleDragonDefeated() (nur normaler Kampf). */
function bkmpChronicleRecordKill(dragon) {
  if (!dragon || !dragon.id || dragon.isEventDragon) return;
  bkmpChronicleAddBestiaryKills(dragon.id, 1, false);
}
/* Offline-Fortschritt kennt keine einzelnen Drachenarten (Server-Simulation,
   siehe api/claim-idle-offline-progress.js) - verteilt wird deshalb nach den
   echten Spawn-Regeln: Bosse ~1/3 grosser Boss, ~2/3 Miniboss; von den
   normalen Kills ~8% seltene Arten (rare_spawn.chancePct), Rest gleichmaessig
   auf die Standardarten (die echte Auswahl ist ebenfalls gleichverteilt). */
function bkmpChronicleCreditOfflineKills(killDelta, bossDelta) {
  const kills = Math.max(0, Math.floor(Number(killDelta) || 0));
  const bosses = Math.min(kills, Math.max(0, Math.floor(Number(bossDelta) || 0)));
  if (!kills) return;
  const kinds = bkmpChronicleBestiaryKinds();
  const byRule = rule => kinds.filter(k => k.spawn_rule === rule);
  const spread = (list, total) => {
    if (!list.length || total <= 0) return;
    const base = Math.floor(total / list.length);
    let rest = total - base * list.length;
    list.forEach(k => {
      const n = base + (rest > 0 ? 1 : 0);
      if (rest > 0) rest -= 1;
      if (n > 0) bkmpChronicleAddBestiaryKills(k.id, n, true);
    });
  };
  const bigBoss = Math.round(bosses / 3);
  spread(byRule('boss_25'), bigBoss);
  spread(byRule('miniboss_10'), bosses - bigBoss);
  const normal = kills - bosses;
  const rareChance = bkmpIdleConfig && bkmpIdleConfig.rare_spawn ? Number(bkmpIdleConfig.rare_spawn.chancePct || 8) : 8;
  const rare = Math.round(normal * Math.max(0, Math.min(50, rareChance)) / 100);
  spread(byRule('rare'), rare);
  spread(byRule('standard'), normal - rare);
}

/* ---------------- Weltereignisse ----------------
   Zufaellige kleine Ereignisse, NUR waehrend der Spieler dem Kampf wirklich
   zusieht (Fenster offen, Kampf-Tab aktiv, Browser-Tab sichtbar - dieselbe
   bkmpIdleCombatVisualsActive()-Bedingung wie die Kampfeffekte), nie im
   Dungeon/Turm/Raid/Event-Drachen-Pause. Belohnt aktives Zuschauen, ohne
   AFK-Spieler zu bestrafen (die bekommen weiterhin den vollen Offline-
   Fortschritt). Buffs gelten nur fuer die laufende Sitzung (kurzlebig,
   bewusst nicht gespeichert). Kein Buff erhoeht die Kill-RATE ueber den
   bestehenden 400ms-Tick-Boden hinaus (Kampfrausch = mehr Schaden pro Treffer,
   nicht mehr Treffer) - kompatibel mit dem serverseitigen Anti-Cheat-Guard. */
const BKMP_WORLD_EVENT_TYPES = {
  chest: { icon: '📦', name: 'Schatztruhe', kind: 'click', lifeMs: 12000, weight: 30, hint: 'Schnell anklicken!' },
  star: { icon: '🌠', name: 'Sternschnuppe', kind: 'click', lifeMs: 7000, weight: 20, hint: 'Fang sie!' },
  merchant: { icon: '🧙', name: 'Wandernder Händler', kind: 'click', lifeMs: 20000, weight: 10, hint: 'Hat ein Angebot', available: () => bkmpIdleState && Number(bkmpIdleState.wood || 0) >= 200 && Number(bkmpIdleState.stone || 0) >= 200 },
  goldrain: { icon: '💰', name: 'Goldregen', kind: 'buff', durationMs: 90000, weight: 15, desc: 'Doppeltes Gold aus Kämpfen' },
  wisdom: { icon: '📚', name: 'Weisheitswind', kind: 'buff', durationMs: 90000, weight: 15, desc: 'Doppelte Erfahrung aus Kämpfen' },
  frenzy: { icon: '🔥', name: 'Kampfrausch', kind: 'buff', durationMs: 60000, weight: 10, desc: '+50% Schaden' }
};
const BKMP_WORLD_EVENT_CHECK_MS = 10000;
const BKMP_WORLD_EVENT_CHANCE = 0.06;
const BKMP_WORLD_EVENT_FIRST_DELAY_MS = 60000;
const BKMP_WORLD_EVENT_COOLDOWN_MS = 150000;
let bkmpWorldEventBuff = null;
let bkmpWorldEventClickable = null;
let bkmpWorldEventLastCheckAt = 0;
let bkmpWorldEventCooldownUntil = 0;
let bkmpWorldEventSessionStartAt = 0;
let bkmpWorldEventBannerEl = null;

function bkmpWorldEventOnOpen() {
  bkmpWorldEventSessionStartAt = Date.now();
}
function bkmpWorldEventCombatContextOk() {
  if (typeof bkmpIdleCombatVisualsActive === 'function' && !bkmpIdleCombatVisualsActive()) return false;
  if (typeof bkmpDungeonActive !== 'undefined' && bkmpDungeonActive) return false;
  if (typeof bkmpTowerActive !== 'undefined' && bkmpTowerActive) return false;
  if (typeof bkmpIdleEventPauseActive !== 'undefined' && bkmpIdleEventPauseActive) return false;
  return true;
}
function bkmpWorldEventBuffActive(type) {
  if (!bkmpWorldEventBuff || bkmpWorldEventBuff.type !== type) return false;
  if (Date.now() >= bkmpWorldEventBuff.endsAt) return false;
  if (typeof bkmpDungeonActive !== 'undefined' && bkmpDungeonActive) return false;
  if (typeof bkmpTowerActive !== 'undefined' && bkmpTowerActive) return false;
  return true;
}
function bkmpWorldEventGoldMult() { return bkmpWorldEventBuffActive('goldrain') ? 2 : 1; }
function bkmpWorldEventXpMult() { return bkmpWorldEventBuffActive('wisdom') ? 2 : 1; }
function bkmpWorldEventDamageMult() { return bkmpWorldEventBuffActive('frenzy') ? 1.5 : 1; }

/* Aufruf aus bkmpIdleTick() - jeder Tick, intern auf 10s-Pruefungen gedrosselt. */
function bkmpWorldEventTick() {
  const now = Date.now();
  if (bkmpWorldEventBuff && now >= bkmpWorldEventBuff.endsAt) {
    bkmpWorldEventBuff = null;
    bkmpWorldEventCooldownUntil = now + BKMP_WORLD_EVENT_COOLDOWN_MS;
    bkmpWorldEventRenderBanner();
    bkmpChronicleRefreshUi();
  } else if (bkmpWorldEventBuff) {
    bkmpWorldEventRenderBanner();
  }
  if (now - bkmpWorldEventLastCheckAt < BKMP_WORLD_EVENT_CHECK_MS) return;
  bkmpWorldEventLastCheckAt = now;
  if (bkmpWorldEventBuff || bkmpWorldEventClickable) return;
  if (!bkmpIdleState || !bkmpWorldEventCombatContextOk()) return;
  if (!bkmpWorldEventSessionStartAt) bkmpWorldEventSessionStartAt = now;
  if (now - bkmpWorldEventSessionStartAt < BKMP_WORLD_EVENT_FIRST_DELAY_MS) return;
  if (now < bkmpWorldEventCooldownUntil) return;
  if (Math.random() >= BKMP_WORLD_EVENT_CHANCE) return;
  bkmpWorldEventStart(bkmpWorldEventPickType());
}
function bkmpWorldEventPickType() {
  const pool = Object.keys(BKMP_WORLD_EVENT_TYPES).filter(t => {
    const def = BKMP_WORLD_EVENT_TYPES[t];
    if (typeof def.available !== 'function') return true;
    try { return Boolean(def.available()); } catch (e) { return false; }
  });
  const total = pool.reduce((s, t) => s + BKMP_WORLD_EVENT_TYPES[t].weight, 0);
  let r = Math.random() * total;
  for (const t of pool) {
    r -= BKMP_WORLD_EVENT_TYPES[t].weight;
    if (r < 0) return t;
  }
  return pool[0] || 'chest';
}
function bkmpWorldEventStart(type) {
  const def = BKMP_WORLD_EVENT_TYPES[type];
  if (!def) return;
  if (def.kind === 'buff') {
    bkmpWorldEventBuff = { type, endsAt: Date.now() + def.durationMs };
    bkmpWorldEventRecordCaught(type);
    if (typeof bkmpIdleShowCombatStatus === 'function') bkmpIdleShowCombatStatus('naechsteStufe', `${def.icon} ${def.name}! ${def.desc}`, { durationMs: 1800 });
    if (typeof bkmpIdleLog === 'function') bkmpIdleLog(`${def.icon} Weltereignis: ${def.name} – ${def.desc} (${Math.round(def.durationMs / 1000)} Sek.)`, true);
    bkmpWorldEventRenderBanner();
    bkmpChronicleRefreshUi();
    return;
  }
  bkmpWorldEventSpawnClickable(type);
}
function bkmpWorldEventRecordCaught(type) {
  if (bkmpChronicleReady()) {
    bkmpChronicle.life.eventsCaught += 1;
    bkmpChronicle.life.eventsByType[type] = (bkmpChronicle.life.eventsByType[type] || 0) + 1;
    bkmpChronicleMarkDirty();
  }
  bkmpChronicleAddProgress('world_events', 1);
  if (typeof bkmpIdleGetAchievementContextFields === 'function') bkmpIdleGetAchievementContextFields();
}
function bkmpWorldEventRenderBanner() {
  const field = document.getElementById('idleBattlefield');
  if (!field) return;
  const active = bkmpWorldEventBuff && Date.now() < bkmpWorldEventBuff.endsAt ? bkmpWorldEventBuff : null;
  if (!active) {
    if (bkmpWorldEventBannerEl) { bkmpWorldEventBannerEl.remove(); bkmpWorldEventBannerEl = null; }
    return;
  }
  const def = BKMP_WORLD_EVENT_TYPES[active.type];
  if (!bkmpWorldEventBannerEl || !bkmpWorldEventBannerEl.isConnected) {
    bkmpWorldEventBannerEl = document.createElement('div');
    bkmpWorldEventBannerEl.className = 'idle-world-event-banner';
    bkmpWorldEventBannerEl.setAttribute('role', 'status');
    field.appendChild(bkmpWorldEventBannerEl);
  }
  const secs = Math.max(0, Math.ceil((active.endsAt - Date.now()) / 1000));
  const text = `${def.icon} ${def.name} · ${def.desc} · ${secs}s`;
  if (bkmpWorldEventBannerEl.textContent !== text) bkmpWorldEventBannerEl.textContent = text;
  bkmpWorldEventBannerEl.dataset.type = active.type;
}
function bkmpWorldEventSpawnClickable(type) {
  const def = BKMP_WORLD_EVENT_TYPES[type];
  const field = document.getElementById('idleBattlefield');
  if (!def || !field) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `idle-world-event-obj idle-world-event-${type}`;
  btn.dataset.testid = 'world-event-obj';
  btn.setAttribute('aria-label', `${def.name}: ${def.hint}`);
  btn.innerHTML = `<span class="idle-world-event-obj-icon" aria-hidden="true">${def.icon}</span><span class="idle-world-event-obj-label">${bkmpChronicleEsc(def.name)}</span>`;
  /* Position in der Mitte des Schlachtfelds (zwischen Dorf und Drache), damit
     nie ein HP-Balken/Name ueberdeckt wird. Die Sternschnuppe fliegt per CSS
     quer ueber den oberen Bereich. */
  if (type !== 'star') {
    btn.style.left = (34 + Math.random() * 26).toFixed(1) + '%';
    btn.style.top = (22 + Math.random() * 34).toFixed(1) + '%';
  } else {
    btn.style.top = (8 + Math.random() * 18).toFixed(1) + '%';
    btn.style.setProperty('--we-life', (def.lifeMs / 1000) + 's');
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    bkmpWorldEventHandleClick(type);
  });
  field.appendChild(btn);
  const timer = window.setTimeout(() => bkmpWorldEventExpireClickable(), def.lifeMs);
  bkmpWorldEventClickable = { type, el: btn, timer };
}
function bkmpWorldEventClearClickable() {
  if (!bkmpWorldEventClickable) return;
  clearTimeout(bkmpWorldEventClickable.timer);
  if (bkmpWorldEventClickable.el) bkmpWorldEventClickable.el.remove();
  bkmpWorldEventClickable = null;
}
function bkmpWorldEventExpireClickable() {
  if (!bkmpWorldEventClickable) return;
  const el = bkmpWorldEventClickable.el;
  bkmpWorldEventClickable = null;
  bkmpWorldEventCooldownUntil = Date.now() + BKMP_WORLD_EVENT_COOLDOWN_MS / 2;
  if (el && el.isConnected) {
    el.classList.add('is-leaving');
    el.disabled = true;
    window.setTimeout(() => el.remove(), 450);
  }
}
async function bkmpWorldEventHandleClick(type) {
  if (!bkmpWorldEventClickable || bkmpWorldEventClickable.type !== type || !bkmpIdleState) return;
  const el = bkmpWorldEventClickable.el;
  clearTimeout(bkmpWorldEventClickable.timer);
  bkmpWorldEventClickable = null;
  bkmpWorldEventCooldownUntil = Date.now() + BKMP_WORLD_EVENT_COOLDOWN_MS;
  const rect = el ? el.getBoundingClientRect() : null;
  if (el) { el.disabled = true; el.classList.add('is-caught'); window.setTimeout(() => el.remove(), 520); }
  const units = bkmpChronicleRewardUnits();
  let reward = null;
  if (type === 'chest') {
    reward = { gold: units.gold * 60, crystals: Math.max(2, units.crystals) };
    if (Math.random() < 0.12) { reward.runes = 1; reward.runeIdx = bkmpChronicleLootTierIdx(); }
  } else if (type === 'star') {
    reward = { xp: units.xp * 80, essence: Math.max(1, units.essence) };
  } else if (type === 'merchant') {
    reward = await bkmpWorldEventMerchantOffer(units);
    if (!reward) return;
  }
  bkmpWorldEventRecordCaught(type);
  const parts = bkmpChronicleGrant(reward);
  const def = BKMP_WORLD_EVENT_TYPES[type];
  bkmpWorldEventFloatText(rect, parts.join(' '));
  if (typeof bkmpRewardPresent === 'function') {
    bkmpRewardPresent({ tier: 'toast', title: `${def.icon} ${def.name}: ${parts.join(' ')}`, dedupeKey: `world-event-${type}` });
  }
  if (typeof bkmpIdleLog === 'function') bkmpIdleLog(`${def.icon} ${def.name}: ${parts.join(' ')}`, true);
  bkmpChronicleRefreshUi();
}
/* Gibt der Spieler ein Fuenftel seines Holz-/Steinvorrats ab, bekommt er
   Kristalle und Essenz - ein echter Abfluss fuer die oft ungenutzt
   anwachsenden Holz-/Steinbestaende. Ablehnen ist folgenlos. */
async function bkmpWorldEventMerchantOffer(units) {
  const wood = Math.floor(Number(bkmpIdleState.wood || 0) * 0.2);
  const stone = Math.floor(Number(bkmpIdleState.stone || 0) * 0.2);
  const crystals = Math.max(8, Math.round(units.crystals * 4));
  const essence = Math.max(4, Math.round(units.essence * 3));
  const body = `Der Händler bietet dir ${bkmpChronicleFmt(crystals)} 💎 Kristalle und ${bkmpChronicleFmt(essence)} 🧪 Essenz für ${bkmpChronicleFmt(wood)} 🌳 Holz und ${bkmpChronicleFmt(stone)} 🗿 Stein (ein Fünftel deines Vorrats).`;
  const ok = typeof bkmpConfirmDialog === 'function'
    ? await bkmpConfirmDialog('🧙 Wandernder Händler', body, 'Handel annehmen', 'Ablehnen')
    : window.confirm(body);
  if (!ok) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🧙 Der Händler zieht weiter.', 2400);
    return null;
  }
  if (Number(bkmpIdleState.wood || 0) < wood || Number(bkmpIdleState.stone || 0) < stone) return null;
  bkmpIdleState.wood = Number(bkmpIdleState.wood || 0) - wood;
  bkmpIdleState.stone = Number(bkmpIdleState.stone || 0) - stone;
  return { crystals, essence };
}
function bkmpWorldEventFloatText(rect, text) {
  const field = document.getElementById('idleBattlefield');
  if (!field || !text) return;
  const fieldRect = field.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'idle-world-event-float';
  el.textContent = text;
  if (rect && fieldRect.width) {
    el.style.left = Math.max(4, rect.left - fieldRect.left + rect.width / 2) + 'px';
    el.style.top = Math.max(4, rect.top - fieldRect.top) + 'px';
  }
  field.appendChild(el);
  window.setTimeout(() => el.remove(), 1700);
}
function bkmpWorldEventOnClose() {
  /* Anklickbare Ereignisse verschwinden mit dem Fenster (man koennte sie ja
     nicht mehr sehen) - ein laufender Buff laeuft einfach ab. */
  bkmpWorldEventClearClickable();
}

/* ---------------- "Naechste Ziele" ----------------
   Rein abgeleitet aus bereits geladenen Daten - keine eigene Spielregel.
   Zeigt Spielern, was es als Naechstes zu erreichen gibt (viele bestehende
   Langzeit-Systeme waren bisher schlicht nicht sichtbar). */
function bkmpChronicleBuildGoals() {
  const goals = [];
  const s = bkmpIdleState;
  if (!s) return goals;
  const current = Number(s.current_dragon_index || 0);
  const highest = Number(s.highest_dragon_index || 0);
  let nextBoss = current;
  while ((nextBoss + 1) % 25 !== 0) nextBoss += 1;
  const stagesLeft = nextBoss - current;
  goals.push({ icon: '👑', title: 'Nächster Boss', detail: stagesLeft === 0 ? 'Du kämpfst gerade gegen einen Boss!' : `Stufe ${typeof bkmpIdleFormatStage === 'function' ? bkmpIdleFormatStage(nextBoss) : nextBoss} – noch ${stagesLeft} Stufe${stagesLeft === 1 ? '' : 'n'}`, cur: 25 - stagesLeft, max: 25, goTab: 'kampf' });

  if (typeof bkmpPrestigeRequiredStage === 'function') {
    const plvl = typeof bkmpPrestigeState !== 'undefined' && bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : 0;
    const req = bkmpPrestigeRequiredStage(plvl);
    goals.push({ icon: '🌌', title: `Prestige ${plvl + 1}`, detail: highest >= req ? 'Ein Aufstieg ist jetzt möglich!' : `Erreiche Stufe ${req} (beste: ${highest})`, cur: Math.min(highest, req), max: req, goTab: 'prestige', ready: highest >= req });
  }

  if (Array.isArray(typeof BKMP_IDLE_UPGRADES !== 'undefined' ? BKMP_IDLE_UPGRADES : null) && typeof bkmpIdleUpgradeNextMilestone === 'function') {
    let best = null;
    BKMP_IDLE_UPGRADES.forEach(def => {
      const level = Number((s.upgrade_purchases || {})[def.id] || 0);
      const next = bkmpIdleUpgradeNextMilestone(def, level);
      if (!next) return;
      const ratio = level / next;
      if (!best || ratio > best.ratio) best = { def, level, next, ratio };
    });
    if (best) goals.push({ icon: best.def.icon || '⬆️', title: `Meilenstein: ${best.def.name}`, detail: `Rang ${best.level}/${best.next} – schaltet einen Zusatzbonus frei`, cur: best.level, max: best.next, goTab: 'upgrades' });
  }

  const tierGoal = (tiers, value, icon, prefix, goTab) => {
    if (!Array.isArray(tiers)) return;
    const next = tiers.find(([n]) => value < n);
    if (!next) return;
    goals.push({ icon, title: `Titel „${next[1]}“`, detail: `${prefix}: ${bkmpChronicleFmt(value)} / ${bkmpChronicleFmt(next[0])}`, cur: value, max: next[0], goTab });
  };
  tierGoal(window.BKMP_IDLE_DRAGON_KILL_TIERS, Number(s.dragon_kills || 0), '🐉', 'Besiegte Drachen', 'erfolge');
  tierGoal(window.BKMP_IDLE_LEVEL_TIERS, Number(s.level || 0), '⭐', 'Dorf-Level', 'erfolge');
  tierGoal(window.BKMP_IDLE_TOWER_TIERS, Number(s.turm_highest_wave || 0), '🗼', 'Turm-Rekord', 'turm');

  if (Array.isArray(typeof bkmpDragonSpeciesCatalog !== 'undefined' ? bkmpDragonSpeciesCatalog : null) && bkmpDragonSpeciesCatalog.length) {
    const discovered = Object.keys(s.dragon_species_discovered_at || {}).length;
    const total = bkmpDragonSpeciesCatalog.filter(sp => sp.active !== false).length;
    if (discovered < total) goals.push({ icon: '🥚', title: 'Drachen-Dex', detail: `${discovered} von ${total} Drachenarten entdeckt`, cur: discovered, max: total, goTab: 'drachen' });
  }

  if (bkmpChronicle) {
    let bestB = null;
    bkmpChronicleBestiaryKinds().forEach(kind => {
      const count = bkmpChronicle.bestiary[kind.id] || 0;
      const thresholds = bkmpChronicleBestiaryThresholds(kind);
      const next = thresholds.find(t => count < t);
      if (!next) return;
      const ratio = count / next;
      if (!bestB || ratio > bestB.ratio) bestB = { kind, count, next, ratio, tier: bkmpChronicleBestiaryTier(kind, count) };
    });
    if (bestB) {
      const bonus = bkmpChronicleBestiaryBonus(bestB.kind);
      goals.push({ icon: bestB.kind.emoji || '📖', title: `Bestiarium: ${bestB.kind.name}`, detail: `${bkmpChronicleFmt(bestB.count)} / ${bkmpChronicleFmt(bestB.next)} – ${BKMP_CHRONICLE_BESTIARY_TIER_NAMES[bestB.tier]} (${bkmpChronicleEffectLabel(bonus.effectType, bonus.perTier)})`, cur: bestB.count, max: bestB.next, chronTab: 'bestiary' });
    }
  }
  return goals;
}

/* ---------------- UI: Einstiegspunkte + Badge ---------------- */
let bkmpChronicleLastUiRenderAt = 0;
function bkmpChronicleRefreshUi(force) {
  bkmpChronicleUpdateBadges();
  const now = Date.now();
  if (!force && now - bkmpChronicleLastUiRenderAt < 1500) return;
  bkmpChronicleLastUiRenderAt = now;
  bkmpChronicleRenderTrackerCard();
  const overlay = document.getElementById('bkmpChronicleOverlay');
  if (overlay && overlay.classList.contains('visible')) {
    /* Gleiches Prinzip wie bkmpIdleRefreshLiveTabsRender(): steht die Maus
       gerade ueber dem Fenster, NICHT neu aufbauen (sonst springt ein
       angepeilter Knopf weg) - es sei denn, es ist ein erzwungenes Update
       direkt nach einer eigenen Aktion. */
    const card = overlay.querySelector('.joke-card');
    const body = document.getElementById('bkmpChronicleBody');
    /* Tastatur-Nutzer: liegt der Fokus gerade auf einem Knopf IM Inhalt,
       ebenfalls nicht neu aufbauen (sonst ginge der Fokus verloren). */
    const focusInBody = body && document.activeElement && body.contains(document.activeElement);
    if (force || ((!card || !card.matches(':hover')) && !focusInBody)) bkmpChronicleRenderModalBody();
  }
}
function bkmpChronicleUpdateBadges() {
  const n = bkmpChronicleClaimableCount();
  document.querySelectorAll('[data-chronicle-badge]').forEach(el => {
    el.textContent = n > 0 ? String(n) : '';
    el.hidden = n <= 0;
  });
  const hudBtn = document.getElementById('bkmpProtoChudChronicleBtn');
  if (hudBtn) hudBtn.classList.toggle('has-claimable', n > 0);
}
function bkmpChronicleQuestRowHtml(scope, q, index, compact) {
  const def = BKMP_CHRONICLE_QUEST_TYPES[q.type];
  if (!def) return '';
  const done = q.progress >= q.target;
  const pct = Math.max(0, Math.min(100, Math.round((q.progress / q.target) * 100)));
  const progressText = q.type === 'playtime'
    ? `${Math.floor(q.progress / 60)} / ${Math.round(q.target / 60)} Min.`
    : `${bkmpChronicleFmt(q.progress)} / ${bkmpChronicleFmt(q.target)}`;
  if (compact) {
    return `<div class="idle-chron-mini-row${q.claimed ? ' is-claimed' : done ? ' is-done' : ''}">
      <span class="idle-chron-mini-icon" aria-hidden="true">${q.claimed ? '✅' : def.icon}</span>
      <span class="idle-chron-mini-main">
        <span class="idle-chron-mini-text">${bkmpChronicleEsc(def.text(q.target))}</span>
        <span class="idle-chron-bar"><span class="idle-chron-bar-fill" style="width:${pct}%"></span></span>
      </span>
    </div>`;
  }
  const reward = bkmpChronicleQuestReward(scope);
  const rewardBits = [`${bkmpChronicleFmt(reward.gold)} 💰`, `${bkmpChronicleFmt(reward.xp)} EP`, `${bkmpChronicleFmt(reward.crystals)} 💎`];
  if (reward.essence) rewardBits.push(`${bkmpChronicleFmt(reward.essence)} 🧪`);
  let actionHtml;
  if (q.claimed) actionHtml = '<span class="bkmp-chron-claimed">✅ Abgeholt</span>';
  else if (done) actionHtml = `<button type="button" class="bkmp-chron-claim-btn" data-chron-action="claim" data-scope="${scope}" data-index="${index}">Abholen</button>`;
  else {
    const canReroll = scope === 'daily' && bkmpChronicle && bkmpChronicle.daily && bkmpChronicle.daily.rerollsUsed < 1;
    actionHtml = `${def.goTab ? `<button type="button" class="bkmp-chron-go-btn" data-chron-action="goto" data-tab="${def.goTab}" title="Zum passenden Bereich">Los →</button>` : ''}${canReroll ? `<button type="button" class="bkmp-chron-reroll-btn" data-chron-action="reroll" data-index="${index}" title="Diesen Auftrag einmal pro Tag kostenlos neu auswürfeln">🎲</button>` : ''}`;
  }
  return `<div class="bkmp-chron-quest${q.claimed ? ' is-claimed' : done ? ' is-done' : ''}" data-chron-quest="${scope}-${index}">
    <div class="bkmp-chron-quest-icon" aria-hidden="true">${def.icon}</div>
    <div class="bkmp-chron-quest-main">
      <div class="bkmp-chron-quest-title">${bkmpChronicleEsc(def.text(q.target))}</div>
      <div class="idle-chron-bar"><span class="idle-chron-bar-fill" style="width:${pct}%"></span></div>
      <div class="bkmp-chron-quest-meta"><span>${progressText}</span><span class="bkmp-chron-quest-reward" title="Belohnung (wächst mit deinem Fortschritt)">🎁 ${rewardBits.join(' · ')}</span></div>
    </div>
    <div class="bkmp-chron-quest-actions">${actionHtml}</div>
  </div>`;
}
function bkmpChronicleChestHtml(scope) {
  const period = bkmpChronicle && bkmpChronicle[scope];
  if (!period) return '';
  const claimed = period.quests.filter(q => q.claimed).length;
  const total = period.quests.length;
  const ready = !period.chestClaimed && total > 0 && claimed >= total;
  const reward = bkmpChronicleChestReward(scope);
  const preview = scope === 'weekly'
    ? `🥚 Drachenei · 🔮 2 Runen · ${bkmpChronicleFmt(reward.crystals)} 💎 · ${bkmpChronicleFmt(reward.essence)} 🧪 · 🌟📚 beide Booster`
    : `🔮 Rune · ${bkmpChronicleFmt(reward.crystals)} 💎 · ${bkmpChronicleFmt(reward.essence)} 🧪 · Chance auf Booster`;
  return `<div class="bkmp-chron-chest${ready ? ' is-ready' : ''}${period.chestClaimed ? ' is-opened' : ''}">
    <div class="bkmp-chron-chest-icon" aria-hidden="true">${period.chestClaimed ? '📭' : scope === 'weekly' ? '👑' : '🎁'}</div>
    <div class="bkmp-chron-chest-main">
      <div class="bkmp-chron-chest-title">${scope === 'weekly' ? 'Wochentruhe' : 'Tagestruhe'} <span class="bkmp-chron-chest-count">${claimed}/${total}</span></div>
      <div class="bkmp-chron-chest-preview">${preview}</div>
    </div>
    ${period.chestClaimed
      ? '<span class="bkmp-chron-claimed">Geöffnet</span>'
      : `<button type="button" class="bkmp-chron-claim-btn bkmp-chron-chest-btn" data-chron-action="chest" data-scope="${scope}" ${ready ? '' : 'disabled'}>${ready ? 'Öffnen' : 'Alle abholen'}</button>`}
  </div>`;
}
function bkmpChronicleRenderTrackerCard() {
  const card = document.getElementById('idleChronicleCard');
  if (!card) return;
  if (!bkmpChronicle || !bkmpChronicle.daily || !bkmpIdleState || bkmpChronicleNameKey !== bkmpIdleState.name_key) {
    card.innerHTML = '';
    return;
  }
  if (card.matches(':hover') && card.childElementCount) return;
  const n = bkmpChronicleClaimableCount();
  const now = bkmpChronicleNow();
  const buff = bkmpWorldEventBuff && Date.now() < bkmpWorldEventBuff.endsAt ? BKMP_WORLD_EVENT_TYPES[bkmpWorldEventBuff.type] : null;
  card.innerHTML = `
    <div class="idle-chron-card-head">
      <span class="idle-chron-card-title">📜 Tagesaufträge</span>
      <span class="idle-chron-card-reset" title="Neue Aufträge um Mitternacht">⏳ ${bkmpChronicleFormatDuration(bkmpChronicleMsUntilNextDay(now))}</span>
    </div>
    <div class="idle-chron-mini-list">${bkmpChronicle.daily.quests.map((q, i) => bkmpChronicleQuestRowHtml('daily', q, i, true)).join('')}</div>
    ${buff ? `<div class="idle-chron-card-event">${buff.icon} ${bkmpChronicleEsc(buff.name)} aktiv</div>` : ''}
    <button type="button" class="idle-chron-open-btn" data-chronicle-open="quests">${n > 0 ? `🎁 ${n} Belohnung${n === 1 ? '' : 'en'} abholen` : 'Chronik öffnen'}</button>
    <div class="idle-chron-quicklinks">
      <button type="button" class="idle-chron-quicklink" data-chronicle-open="calendar" title="Login-Kalender">📅 Kalender</button>
      <button type="button" class="idle-chron-quicklink" data-chronicle-open="bestiary" title="Drachen-Bestiarium">📖 Bestiarium</button>
      <button type="button" class="idle-chron-quicklink" data-chronicle-open="goals" title="Nächste Ziele">🎯 Ziele</button>
    </div>
  `;
}

/* ---------------- UI: Chronik-Fenster ---------------- */
const BKMP_CHRONICLE_MODAL_TABS = [
  { id: 'quests', label: '📜 Aufträge' },
  { id: 'calendar', label: '📅 Kalender' },
  { id: 'path', label: '🛤️ Pfad' },
  { id: 'bestiary', label: '📖 Bestiarium' },
  { id: 'goals', label: '🎯 Ziele' }
];
function bkmpChronicleEnsureModal() {
  if (document.getElementById('bkmpChronicleOverlay')) return;
  if (typeof bkmpUiModalHtml !== 'function') return;
  document.body.insertAdjacentHTML('beforeend', bkmpUiModalHtml({
    id: 'bkmpChronicle',
    titleHtml: '📜 Chronik des Drachendorfs',
    bodyHtml: `
      <div class="bkmp-chron-tabs" role="tablist">
        ${BKMP_CHRONICLE_MODAL_TABS.map(t => `<button type="button" class="bkmp-chron-tab" role="tab" data-chron-action="tab" data-tab-id="${t.id}">${t.label}${t.id === 'quests' ? ' <span class="bkmp-chronicle-badge" data-chronicle-badge hidden></span>' : ''}</button>`).join('')}
      </div>
      <div class="bkmp-chron-body" id="bkmpChronicleBody" role="tabpanel"></div>
    `,
    buttonsHtml: '<button type="button" class="btn-nein" id="bkmpChronicleCloseBtn">Schließen</button>',
    extraClass: 'bkmp-chron-card'
  }));
  const overlay = document.getElementById('bkmpChronicleOverlay');
  /* Spiel-Stimmung wie alle anderen Spiel-Popups (siehe .zone-game .joke-card
     in style.css) - das Fenster haengt an document.body, nicht im Dorf-Fenster. */
  overlay.classList.add('zone-game', 'bkmp-chron-overlay');
  if (typeof bkmpUiTrapFocus === 'function') bkmpUiTrapFocus(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { bkmpChronicleCloseModal(); return; }
    const actionEl = e.target.closest('[data-chron-action]');
    if (!actionEl || actionEl.disabled) return;
    const action = actionEl.dataset.chronAction;
    if (action === 'tab') { bkmpChronicleModalTab = actionEl.dataset.tabId; bkmpChronicleRenderModalBody(); }
    else if (action === 'claim') bkmpChronicleClaimQuest(actionEl.dataset.scope, Number(actionEl.dataset.index));
    else if (action === 'chest') bkmpChronicleClaimChest(actionEl.dataset.scope);
    else if (action === 'reroll') bkmpChronicleRerollQuest(Number(actionEl.dataset.index));
    else if (action === 'goto') { bkmpChronicleCloseModal(); bkmpChronicleGoToTab(actionEl.dataset.tab); }
    else if (action === 'chrontab') { bkmpChronicleModalTab = actionEl.dataset.tabId; bkmpChronicleRenderModalBody(); }
    else if (action === 'pathclaim' && typeof bkmpPathClaim === 'function') bkmpPathClaim([actionEl.dataset.goalId]);
    else if (action === 'pathclaimall' && typeof bkmpPathClaim === 'function') bkmpPathClaim(bkmpPathClaimable().map(g => g.goal.id));
  });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') bkmpChronicleCloseModal(); });
  document.getElementById('bkmpChronicleCloseBtn').addEventListener('click', bkmpChronicleCloseModal);
}
async function bkmpChronicleOpenModal(tab) {
  if (!bkmpIdleState) return;
  bkmpChronicleEnsureModal();
  const overlay = document.getElementById('bkmpChronicleOverlay');
  if (!overlay) return;
  if (tab) bkmpChronicleModalTab = tab;
  overlay.classList.add('visible');
  const body = document.getElementById('bkmpChronicleBody');
  if (!bkmpChronicleReady()) {
    if (body) body.innerHTML = '<p class="bkmp-chron-empty">⏳ Chronik wird geladen…</p>';
    await bkmpChronicleEnsureLoaded(bkmpIdleState.name_key);
  }
  bkmpChronicleTrack(true);
  bkmpChronicleRenderModalBody();
  const firstTab = overlay.querySelector('.bkmp-chron-tab.is-active') || overlay.querySelector('.bkmp-chron-tab');
  if (firstTab) firstTab.focus();
}
function bkmpChronicleCloseModal() {
  const overlay = document.getElementById('bkmpChronicleOverlay');
  if (overlay) overlay.classList.remove('visible');
}
function bkmpChronicleGoToTab(tabId) {
  const btn = document.getElementById(BKMP_CHRONICLE_TAB_BUTTONS[tabId] || '');
  if (btn) btn.click();
  if (typeof bkmpProtoChudSyncActiveNav === 'function') bkmpProtoChudSyncActiveNav();
}
function bkmpChronicleRenderModalBody() {
  const overlay = document.getElementById('bkmpChronicleOverlay');
  const body = document.getElementById('bkmpChronicleBody');
  if (!overlay || !body) return;
  overlay.querySelectorAll('.bkmp-chron-tab').forEach(btn => {
    const active = btn.dataset.tabId === bkmpChronicleModalTab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  bkmpChronicleUpdateBadges();
  let html;
  if (!bkmpChronicleReady()) html = '<p class="bkmp-chron-empty">⏳ Chronik wird geladen…</p>';
  else if (bkmpChronicleModalTab === 'calendar') html = bkmpChronicleCalendarHtml();
  else if (bkmpChronicleModalTab === 'bestiary') html = bkmpChronicleBestiaryHtml();
  else if (bkmpChronicleModalTab === 'goals') html = bkmpChronicleGoalsHtml();
  else if (bkmpChronicleModalTab === 'path' && typeof bkmpPathHtml === 'function') html = bkmpPathHtml();
  else html = bkmpChronicleQuestsHtml();
  /* Nur ersetzen, wenn sich wirklich etwas geaendert hat - verhindert, dass
     Knoepfe unter dem Mauszeiger/Fokus grundlos neu erzeugt werden. */
  if (bkmpChronicleLastModalHtml === html && body.childElementCount) return;
  bkmpChronicleLastModalHtml = html;
  body.innerHTML = html;
}
function bkmpChronicleQuestsHtml() {
  const now = bkmpChronicleNow();
  const d = bkmpChronicle.daily;
  const w = bkmpChronicle.weekly;
  const offlineNote = bkmpChronicleServerDisabled
    ? '<p class="bkmp-chron-note">ℹ️ Dein Chronik-Fortschritt wird gerade nur auf diesem Gerät gespeichert.</p>'
    : '';
  return `
    ${typeof bkmpPathNextGoalsHtml === 'function' ? bkmpPathNextGoalsHtml() : ''}
    <section class="bkmp-chron-section">
      <header class="bkmp-chron-section-head"><h4>Tagesaufträge</h4><span class="bkmp-chron-reset">Neue Aufträge in ${bkmpChronicleFormatDuration(bkmpChronicleMsUntilNextDay(now))}</span></header>
      ${d.quests.map((q, i) => bkmpChronicleQuestRowHtml('daily', q, i, false)).join('')}
      ${bkmpChronicleChestHtml('daily')}
    </section>
    <section class="bkmp-chron-section">
      <header class="bkmp-chron-section-head"><h4>Wochenziele</h4><span class="bkmp-chron-reset">Neue Ziele in ${bkmpChronicleFormatDuration(bkmpChronicleMsUntilNextWeek(now))}</span></header>
      ${w.quests.map((q, i) => bkmpChronicleQuestRowHtml('weekly', q, i, false)).join('')}
      ${bkmpChronicleChestHtml('weekly')}
    </section>
    <p class="bkmp-chron-note">Belohnungen wachsen mit deiner höchsten Stufe – sie sind immer etwa so viel wert wie einige Minuten Kämpfen. Offline-Fortschritt zählt mit.</p>
    ${offlineNote}
  `;
}
function bkmpChronicleCalendarHtml() {
  const streak = typeof bkmpIdleGetStreakData === 'function' ? bkmpIdleGetStreakData() : { count: 0, lastDate: null };
  const count = Number(streak.count || 0);
  const now = bkmpChronicleNow();
  const today = bkmpChronicleDayKey(now);
  const yesterday = bkmpChronicleDayKey(now - 86400000);
  const claimedToday = streak.lastDate === today;
  /* refCount = der Tag, dessen Belohnung HEUTE ausgezahlt wurde bzw. als
     Naechstes faellig ist. Die Vorschau zeigt den kompletten aktuellen
     7-Tage-Zyklus mit genau den Werten, die tatsaechlich ausgezahlt werden. */
  const refCount = claimedToday ? Math.max(1, count) : (streak.lastDate === yesterday ? count + 1 : 1);
  const refDay = ((refCount - 1) % 7) + 1;
  const cycleStart = refCount - refDay;
  const mult = bkmpChronicleCalendarWeekMult(refCount);
  const nextMult = bkmpChronicleCalendarWeekMult(refCount + 1);
  return `
    <div class="bkmp-chron-calendar-head">
      <div class="bkmp-chron-streak">🔥 <strong>${count}</strong> Tag${count === 1 ? '' : 'e'} in Folge</div>
      <div class="bkmp-chron-streak-mult">Treuebonus: <strong>+${Math.round((mult - 1) * 100)}%</strong> auf alle Kalender-Belohnungen <span class="bkmp-chron-muted">(+10% pro vollständiger Woche, max. +50%)</span></div>
    </div>
    <div class="bkmp-chron-calendar">
      ${BKMP_CHRONICLE_CALENDAR.map(entry => {
        const isToday = entry.day === refDay;
        const isPast = entry.day < refDay || (isToday && claimedToday);
        const preview = bkmpChronicleLoginReward(cycleStart + entry.day);
        const bits = [];
        if (preview.gold) bits.push(`${bkmpChronicleFmt(preview.gold)} 💰`);
        if (preview.xp) bits.push(`${bkmpChronicleFmt(preview.xp)} EP`);
        if (preview.crystals) bits.push(`${bkmpChronicleFmt(preview.crystals)} 💎`);
        if (preview.essence) bits.push(`${bkmpChronicleFmt(preview.essence)} 🧪`);
        if (preview.runes) bits.push('🔮 Rune');
        if (preview.boostGold) bits.push('🌟 Goldrausch');
        if (preview.boostExp) bits.push('📚 Wissensschub');
        return `<div class="bkmp-chron-day${isToday ? ' is-today' : ''}${isPast ? ' is-past' : ''}${entry.day === 7 ? ' is-big' : ''}">
          <div class="bkmp-chron-day-num">Tag ${entry.day}</div>
          <div class="bkmp-chron-day-icon" aria-hidden="true">${isPast ? '✅' : entry.icon}</div>
          <div class="bkmp-chron-day-label">${bkmpChronicleEsc(entry.label)}</div>
          <div class="bkmp-chron-day-reward">${bits.join('<br>')}</div>
        </div>`;
      }).join('')}
    </div>
    <p class="bkmp-chron-note">${claimedToday ? `✅ Heutige Belohnung erhalten. Komm morgen wieder für Tag ${(refDay % 7) + 1}${nextMult > mult ? ` – dann steigt dein Treuebonus auf +${Math.round((nextMult - 1) * 100)}%!` : '!'}` : 'Öffne das Dorf, um die heutige Belohnung zu erhalten.'} Die Belohnung wird beim ersten Öffnen des Dorfes an jedem Tag automatisch ausgezahlt.</p>
  `;
}
function bkmpChronicleBestiaryHtml() {
  const kinds = bkmpChronicleBestiaryKinds();
  if (!kinds.length) return '<p class="bkmp-chron-empty">Noch keine Drachenarten geladen.</p>';
  const totals = bkmpChronicleBestiaryEffectTotals();
  const totalBits = Object.keys(totals).map(k => bkmpChronicleEffectLabel(k, totals[k]));
  const order = { boss_25: 0, miniboss_10: 1, rare: 2, standard: 3 };
  const sorted = kinds.slice().sort((a, b) => (order[a.spawn_rule] - order[b.spawn_rule]) || String(a.name).localeCompare(String(b.name)));
  return `
    <div class="bkmp-chron-bestiary-sum">
      <div><strong>${bkmpChronicleBestiaryTotalTiers()}</strong> von ${kinds.length * 5} Bestiarium-Stufen</div>
      <div class="bkmp-chron-muted">${totalBits.length ? 'Aktive Dauerboni: ' + totalBits.join(' · ') : 'Besiege Drachen, um dauerhafte Boni freizuschalten.'}</div>
    </div>
    <div class="bkmp-chron-bestiary">
      ${sorted.map(kind => {
        const count = bkmpChronicle.bestiary[kind.id] || 0;
        const tier = bkmpChronicleBestiaryTier(kind, count);
        const thresholds = bkmpChronicleBestiaryThresholds(kind);
        const next = thresholds[tier];
        const prev = tier > 0 ? thresholds[tier - 1] : 0;
        const pct = next ? Math.max(0, Math.min(100, Math.round(((count - prev) / (next - prev)) * 100))) : 100;
        const bonus = bkmpChronicleBestiaryBonus(kind);
        const ruleLabel = { boss_25: 'Boss', miniboss_10: 'Miniboss', rare: 'Selten', standard: 'Standard' }[kind.spawn_rule] || '';
        const stars = BKMP_CHRONICLE_BESTIARY_TIER_NAMES.map((name, i) => `<span class="bkmp-chron-star${i < tier ? ' is-on' : ''}" title="${name}: ${bkmpChronicleFmt(thresholds[i])} Siege">★</span>`).join('');
        return `<div class="bkmp-chron-beast tier-${tier}" style="--beast-color:${bkmpChronicleEsc(kind.color_theme || '#a78bfa')}">
          <div class="bkmp-chron-beast-head"><span class="bkmp-chron-beast-emoji" aria-hidden="true">${kind.emoji || '🐉'}</span><span class="bkmp-chron-beast-name">${bkmpChronicleEsc(kind.name)}</span><span class="bkmp-chron-beast-rule">${ruleLabel}</span></div>
          <div class="bkmp-chron-beast-stars">${stars}</div>
          <div class="idle-chron-bar"><span class="idle-chron-bar-fill" style="width:${pct}%"></span></div>
          <div class="bkmp-chron-beast-meta">${bkmpChronicleFmt(count)} Siege${next ? ` · nächste Stufe bei ${bkmpChronicleFmt(next)}` : ' · Höchststufe!'}</div>
          <div class="bkmp-chron-beast-bonus">${tier > 0 ? bkmpChronicleEffectLabel(bonus.effectType, tier * bonus.perTier) : `Pro Stufe: ${bkmpChronicleEffectLabel(bonus.effectType, bonus.perTier)}`}</div>
        </div>`;
      }).join('')}
    </div>
    <p class="bkmp-chron-note">Zählt Siege im normalen Kampf (Offline-Siege werden anteilig verteilt). Das Bestiarium bleibt über Prestige und Aufstieg hinweg erhalten.</p>
  `;
}
function bkmpChronicleGoalsHtml() {
  const goals = bkmpChronicleBuildGoals();
  const life = bkmpChronicle.life;
  return `
    <div class="bkmp-chron-goals">
      ${goals.map(g => {
        const pct = g.max > 0 ? Math.max(0, Math.min(100, Math.round((g.cur / g.max) * 100))) : 0;
        const btn = g.chronTab
          ? `<button type="button" class="bkmp-chron-go-btn" data-chron-action="chrontab" data-tab-id="${g.chronTab}">Ansehen</button>`
          : g.goTab ? `<button type="button" class="bkmp-chron-go-btn" data-chron-action="goto" data-tab="${g.goTab}">Los →</button>` : '';
        return `<div class="bkmp-chron-goal${g.ready ? ' is-ready' : ''}">
          <div class="bkmp-chron-goal-icon" aria-hidden="true">${g.icon}</div>
          <div class="bkmp-chron-goal-main">
            <div class="bkmp-chron-goal-title">${bkmpChronicleEsc(g.title)}</div>
            <div class="bkmp-chron-goal-detail">${bkmpChronicleEsc(g.detail)}</div>
            <div class="idle-chron-bar"><span class="idle-chron-bar-fill" style="width:${pct}%"></span></div>
          </div>
          ${btn}
        </div>`;
      }).join('')}
    </div>
    <div class="bkmp-chron-life">
      <span>📜 ${bkmpChronicleFmt(life.questsDone)} Aufträge erledigt</span>
      <span>🎁 ${bkmpChronicleFmt(life.dailyChests)} Tagestruhen</span>
      <span>👑 ${bkmpChronicleFmt(life.weeklyChests)} Wochentruhen</span>
      <span>✨ ${bkmpChronicleFmt(life.eventsCaught)} Weltereignisse</span>
    </div>
  `;
}
function bkmpChronicleFlashClaimed(scope, index) {
  window.requestAnimationFrame(() => {
    const el = document.querySelector(`[data-chron-quest="${scope}-${index}"]`);
    if (el) el.classList.add('is-just-claimed');
  });
}

/* ---------------- Erfolge-Anbindung ----------------
   Felder fuer bkmpIdleGetAchievementContextFields() (idledorf.js). Ist die
   Chronik (noch) nicht geladen, wird der zuletzt zwischengespeicherte Wert
   genommen, damit ein bereits erspielter Erfolg/Titel nie kurz "verschwindet". */
function bkmpChronicleAchievementFields(cachedOrGetter) {
  if (!bkmpChronicle || !bkmpIdleState || bkmpChronicleNameKey !== bkmpIdleState.name_key) {
    /* Cache nur lesen, wenn er wirklich gebraucht wird (Aufruf erfolgt bei
       jedem Kill - kein unnoetiges JSON.parse im Normalfall). */
    const c = (typeof cachedOrGetter === 'function' ? cachedOrGetter() : cachedOrGetter) || {};
    return {
      idleQuestsDone: Number(c.idleQuestsDone || 0),
      idleWeeklyChests: Number(c.idleWeeklyChests || 0),
      idleWorldEventsCaught: Number(c.idleWorldEventsCaught || 0),
      idleBestiaryTiers: Number(c.idleBestiaryTiers || 0)
    };
  }
  return {
    idleQuestsDone: bkmpChronicle.life.questsDone,
    idleWeeklyChests: bkmpChronicle.life.weeklyChests,
    idleWorldEventsCaught: bkmpChronicle.life.eventsCaught,
    idleBestiaryTiers: bkmpChronicleBestiaryTotalTiers()
  };
}

/* ---------------- Verdrahtung ---------------- */
function bkmpChronicleInitDom() {
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-chronicle-open]');
    if (!opener) return;
    e.preventDefault();
    bkmpChronicleOpenModal(opener.dataset.chronicleOpen || 'quests');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && bkmpChronicleDirty) bkmpChronicleSaveNow();
  });
  window.addEventListener('pagehide', () => {
    if (bkmpChronicleDirty) bkmpChronicleSaveNow();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bkmpChronicleInitDom);
else bkmpChronicleInitDom();


/* ---------------- Dex-Rekorde (Drachendorf-Ausbau Phase 4) ----------------
   Dauerhafte Hoechstwerte pro Drachenart, auch wenn der Drache spaeter
   freigelassen oder geopfert wird. Nur steigend (Merge = Maximum). */
function bkmpChronicleDexRecords() {
  return (bkmpChronicle && bkmpChronicle.dex) || {};
}
function bkmpChronicleRecordDex(speciesId, form, asc, bond, exp) {
  if (!bkmpChronicle || !speciesId || !/^[a-z0-9_-]{1,40}$/i.test(speciesId)) return false;
  if (!bkmpChronicle.dex) bkmpChronicle.dex = {};
  const cur = bkmpChronicle.dex[speciesId] || [0, 0, 0, 0];
  const next = [
    Math.max(cur[0], Math.min(4, Math.floor(Number(form) || 0))),
    Math.max(cur[1], Math.min(100, Math.floor(Number(asc) || 0))),
    Math.max(cur[2], Math.min(10, Math.floor(Number(bond) || 0))),
    Math.max(cur[3], Math.min(1e7, Math.floor(Number(exp) || 0)))
  ];
  if (bkmpChronicle.dex[speciesId] && next.every((v, i) => v === cur[i])) return false;
  bkmpChronicle.dex[speciesId] = next;
  bkmpChronicleMarkDirty();
  return true;
}
