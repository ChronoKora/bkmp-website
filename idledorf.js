/* ============================================================
   Bkmp - Idle Drachen Dorf
   Idle-Kampfspiel-Erweiterung des bestehenden Gamification-Systems.
   Wird von index.html UND admin.html geladen (Admin braucht dieselbe
   Kampf-Mathematik fuer den Testkampf-Simulator).

   Ladereihenfolge (siehe <script>-Tags): supabase-js -> supabase.js ->
   app.js -> idledorf.js -> grosses Inline-Script. D.h. Funktionen wie
   escapeHtml(), bkmpGetSupabaseClient() sind hier bereits verfuegbar,
   aber bkmpGetMcName()/BKMP_ACHIEVEMENTS/renderAchievementBadge() erst
   NACH diesem Skript - deshalb werden sie hier nie am Top-Level,
   sondern nur innerhalb von Funktionen referenziert, die erst durch
   spaetere Nutzerinteraktion (Klick) oder per setTimeout(0) aufgerufen
   werden.
   ============================================================ */

/* ---------------- Wartungsmodus ----------------
   Notschalter bei akuten Problemen: Schalter liegt in Supabase
   (site_flags.idle_maintenance, siehe supabase-site-maintenance-flag.sql)
   und ist im Admin-Panel jederzeit ohne Deploy umschaltbar. bkmpIdleState
   des Wartungsmodus wird per Polling (alle 20s) aktuell gehalten; ist ein
   Tab GERADE OFFEN und der Schalter springt von aus auf an, wird der Tab
   automatisch neu geladen, damit auch schon aktive Spieler sofort die
   Wartungsmeldung sehen (nicht erst beim naechsten eigenen Klick). Fail
   closed: bis die erste DB-Antwort da ist bzw. falls die Abfrage fehlschlaegt,
   gilt das Idle-Dorf als gesperrt - ein Netzwerkfehler soll nie versehentlich
   ein kaputtes Spiel freigeben. */
const BKMP_IDLE_MAINTENANCE_FALLBACK_MESSAGE = 'Das Idle Drachen Dorf ist gerade kurz für Wartungsarbeiten pausiert. Es geht bald weiter, bitte versuch es später nochmal.';
let bkmpIdleMaintenanceKnown = false;
let bkmpIdleMaintenanceActive = true;
let bkmpIdleMaintenanceMessage = BKMP_IDLE_MAINTENANCE_FALLBACK_MESSAGE;

async function bkmpIdleRefreshMaintenanceFlag() {
  try {
    const flags = typeof loadSiteFlags === 'function' ? await loadSiteFlags() : null;
    if (flags) {
      bkmpIdleMaintenanceActive = !!flags.idle_maintenance;
      bkmpIdleMaintenanceMessage = flags.idle_maintenance_message || BKMP_IDLE_MAINTENANCE_FALLBACK_MESSAGE;
    } else {
      bkmpIdleMaintenanceActive = false;
    }
    bkmpIdleMaintenanceKnown = true;
  } catch (e) {
    console.warn('Idle Dorf: Wartungsmodus-Status konnte nicht geladen werden.', e);
    if (!bkmpIdleMaintenanceKnown) bkmpIdleMaintenanceActive = true;
  }
  bkmpIdleApplyMaintenanceButtonVisual();
  return bkmpIdleMaintenanceActive;
}

function bkmpIdleApplyMaintenanceButtonVisual() {
  const btn = document.getElementById('idleDorfButton');
  if (!btn) return;
  const label = btn.querySelector('.idle-dorf-btn-label');
  if (bkmpIdleMaintenanceActive) {
    btn.classList.add('idle-dorf-maintenance');
    btn.title = bkmpIdleMaintenanceMessage;
    if (label) label.textContent = ' Wartungsarbeiten';
  } else {
    btn.classList.remove('idle-dorf-maintenance');
    btn.removeAttribute('title');
    if (label) label.textContent = ' Idle Drachen Dorf';
  }
}

/* bkmpIdleMaintenanceBaseline haelt den Stand fest, den DIESER Tab beim
   allerersten Check dieser Seite gesehen hat (egal ob an oder aus - ein
   frisch geladener Tab zeigt den aktuellen Stand ja bereits korrekt an,
   braucht also KEIN Reload). Reload wird nur ausgeloest, wenn ein SPAETERER
   Poll eine echte Aenderung gegenueber der Baseline erkennt (aus -> an) -
   sonst wuerde jeder frische Seitenaufruf waehrend eines laufenden
   Wartungsmodus sich selbst sofort neu laden, was nur unnoetig flackert. */
let bkmpIdleMaintenanceBaseline = null;
function bkmpIdleMaintenancePoll() {
  bkmpIdleRefreshMaintenanceFlag().then(active => {
    if (bkmpIdleMaintenanceBaseline === null) {
      bkmpIdleMaintenanceBaseline = active;
      return;
    }
    if (active && !bkmpIdleMaintenanceBaseline) {
      window.location.reload();
    }
    bkmpIdleMaintenanceBaseline = active;
  });
}

/* ---------------- Reine Mathe-Funktionen (kein DOM) ---------------- */

function bkmpIdleXpForLevel(level, xpCurveCfg) {
  const cfg = xpCurveCfg || { base: 40, growth: 1.42 };
  return Math.max(1, Math.round(cfg.base * Math.pow(Math.max(1, level), cfg.growth)));
}

function bkmpIdleFormatStage(index) {
  const i = Math.max(0, Math.floor(index || 0));
  return `${Math.floor(i / 10)}-${i % 10}`;
}

/* Deterministischer [0,1)-Wert aus einem Text-Seed (FNV-1a 32-bit Hash,
   normiert). Bewusst KEIN Math.random(): derselbe Seed liefert IMMER
   dasselbe Ergebnis. Wird fuer den Event-Drachen-Spawnwurf verwendet, damit
   ein erneutes Laden/Oeffnen des Idle-Dorf-Fensters (ohne dass sich die
   Stufe aendert) niemals einen neuen Wurf ausloest - siehe
   bkmpIdleSelectDragonKindId(). Nicht kryptographisch sicher, muss es hier
   auch nicht sein: das Ziel ist ausschliesslich, den trivialen
   "Reload = neu wuerfeln"-Exploit zu verhindern, nicht, den Wurf gegen
   gezielte Analyse durch den Spieler selbst abzusichern. */
function bkmpIdleSeededRoll01(seed) {
  let h = 2166136261;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;
  return h / 4294967296;
}

/* Spawn-Logik: waehlt die ART des naechsten Drachen anhand der Stufe
   (killIndex+1 = wie oft insgesamt schon gekaempft wurde, 1-indiziert).
   - alle 25 Stufen (25/50/75/...): der grosse Boss
   - alle 10 Stufen (10/20/30/...), aber NICHT wenn schon Boss-Stufe: Miniboss
   - sonst seltene Event-Easter-Egg-Drachen (0,1% je Drache, deterministisch,
     nur wenn noch nicht besiegt) - siehe bkmpIdleSeededRoll01
   - sonst kleine Zufallschance auf einen seltenen Drachen (Schatten/Wuff)
   - ansonsten einer der vier Standard-Elementardrachen, zufaellig
   seedName = Spielername (name_key), fuer den deterministischen
   Event-Drachen-Wurf. excludedEventIds = Event-Drachen, die dieser
   Spieler schon besiegt hat (spawnen dauerhaft nie wieder). */
function bkmpIdleSelectDragonKindId(killIndex, dragons, rareChancePct, seedName, excludedEventIds) {
  const stage = killIndex + 1;
  const active = (dragons || []).filter(d => d.active !== false);
  const byRule = rule => active.filter(d => d.spawn_rule === rule);
  if (stage % 25 === 0) {
    const pool = byRule('boss_25');
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)].id;
  }
  if (stage % 10 === 0) {
    const pool = byRule('miniboss_10');
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)].id;
  }
  const eventPool = byRule('event_easter').filter(d => !(excludedEventIds || []).includes(d.id));
  for (const d of eventPool) {
    const seed = `${seedName || 'guest'}|${killIndex}|${d.id}`;
    if (bkmpIdleSeededRoll01(seed) < 0.001) return d.id;
  }
  const rare = byRule('rare');
  if (rare.length && Math.random() * 100 < (rareChancePct != null ? rareChancePct : 8)) {
    return rare[Math.floor(Math.random() * rare.length)].id;
  }
  const standard = byRule('standard');
  const pool = standard.length ? standard : active;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)].id : ((active[0] || {}).id || null);
}

/* Wachstumskurve fuer Drachen-HP/Angriff und Belohnungen: (1 + rate*kill)^exponent
   statt reiner Exponential-Compoundierung (1+rate)^kill. Reine Exponential-
   Compoundierung explodiert bei jeder Rate > 0 irgendwann ins Astronomische
   (selbst bei nur 2%/Kill: kill 1000 = 398 Mio x, kill 2000 = 1.6*10^17 x) -
   das macht das Spiel ab einem bestimmten Punkt IMMER unspielbar, ganz
   unabhaengig davon wie klein die Rate gewaehlt wird. Das (1+rate*kill)^exp-
   Modell waechst dagegen naeherungsweise polynomiell: mit den Standardwerten
   (rate 0.05, exp 1.15) ist Drache #1000 "nur" ~92x staerker als Drache #1
   (statt 400-Millionen-fach), bleibt aber weiterhin spuerbar schwerer -
   frueh spuerbarer Zuwachs, spaet lang anhaltende, aber ueberwindbare
   Herausforderung. Siehe bkmpIdleGetMergedDragonScalingCfg(). */
function bkmpIdleGrowthMult(ratePerKill, exponent, killIndex) {
  const rate = ratePerKill || 0;
  const exp = exponent || 1;
  return Math.pow(1 + rate * killIndex, exp);
}

/* Eigene Skalierung fuer die seltenen Event-Drachen (Shenloss/Ganz Liber
   Drache) - "wie ein Raidboss, aber eigene Formel" (siehe Auftrag). Ziel:
   - rein passiver Schaden (Auto-Tick, kein Klick) reicht NICHT zuverlaessig
   - mit aktivem Klicken ist der Kampf in einer ueberschaubaren Zeitspanne
     (Groessenordnung 45s aktiver Einsatz) machbar
   - skaliert mit den TATSAECHLICHEN aktuellen Werten des Spielers
     (Angriff inkl. aller Skilltree-/Upgrade-/Titel-/Prestige-Boni,
     Krit-Chance/-Schaden, Klickschaden-Bonus, Tick-Geschwindigkeit) statt
     mit der Stufe/killIndex - ein schwacher und ein starker Spieler
     bekommen dadurch automatisch eine jeweils angemessene Huerde.
   Der Angriffswert des Event-Drachen selbst orientiert sich an der
   bereits ausbalancierten Boss-Kurve (gleiche Bedrohlichkeit wie ein
   reguleaerer 25er-Boss dieser Spielphase), NICHT an einer neuen,
   ungetesteten Zahl. */
function bkmpIdleEventDragonScaledStats(killIndex, cfg, effectiveStats) {
  const c = cfg || {};
  const atkGrowth = bkmpIdleGrowthMult(c.atkGrowthPerKill, c.atkGrowthExponent, killIndex);
  const attack = Math.max(8, 7 * atkGrowth * (c.bossAtkMult || 1.7));

  const stats = effectiveStats || { attack: 10, critChance: 5, critDamage: 150, clickDamagePct: 0, tickIntervalMs: 900 };
  const tickSeconds = Math.max(0.3, (stats.tickIntervalMs || 900) / 1000);
  const critChance = Math.max(0, Math.min(100, stats.critChance || 0)) / 100;
  const critFactor = 1 + critChance * (Math.max(100, stats.critDamage || 150) / 100 - 1);
  const passiveDps = Math.max(1, (stats.attack || 10) * critFactor) / tickSeconds;
  const clickDamage = Math.max(1, (stats.attack || 10) * (0.12 + (stats.clickDamagePct || 0) / 100));
  const ASSUMED_ACTIVE_CLICKS_PER_SECOND = 4; // realistisches menschliches Tempo, kein Autoklicker-Tempo
  const clickDps = clickDamage * ASSUMED_ACTIVE_CLICKS_PER_SECOND;

  const TARGET_ACTIVE_SECONDS = 45; // mit aktivem Klicken soll der Kampf ungefaehr in dieser Groessenordnung liegen
  const PASSIVE_ONLY_FACTOR = 4; // rein passiv soll es spuerbar/unattraktiv laenger dauern (kein zuverlaessiges AFK)

  const hpFromActiveTarget = (passiveDps + clickDps) * TARGET_ACTIVE_SECONDS;
  const hpFloorFromPassive = passiveDps * TARGET_ACTIVE_SECONDS * PASSIVE_ONLY_FACTOR;
  const maxHp = Math.max(500, Math.round(Math.max(hpFromActiveTarget, hpFloorFromPassive)));

  return { attack, maxHp };
}

function bkmpIdleDragonStatsAt(killIndex, dragons, cfg, seedName, excludedEventIds, effectiveStats) {
  const c = cfg || {};
  const kindId = bkmpIdleSelectDragonKindId(killIndex, dragons, c.chancePct, seedName, excludedEventIds);
  const archetype = (dragons || []).find(d => d.id === kindId);
  if (!archetype) return null;
  const isEventDragon = archetype.spawn_rule === 'event_easter';
  const hpGrowth = bkmpIdleGrowthMult(c.hpGrowthPerKill, c.hpGrowthExponent, killIndex);
  const atkGrowth = bkmpIdleGrowthMult(c.atkGrowthPerKill, c.atkGrowthExponent, killIndex);
  let bossTier = null;
  let hpMult = 1;
  let atkMult = 1;
  if (archetype.spawn_rule === 'boss_25') { bossTier = 'boss'; hpMult = c.bossHpMult || 3.2; atkMult = c.bossAtkMult || 1.7; }
  else if (archetype.spawn_rule === 'miniboss_10') { bossTier = 'miniboss'; hpMult = c.minibossHpMult || 1.8; atkMult = c.minibossAtkMult || 1.3; }
  const eventStats = isEventDragon ? bkmpIdleEventDragonScaledStats(killIndex, c, effectiveStats) : null;
  return {
    id: archetype.id,
    name: archetype.name,
    emoji: archetype.emoji || '🐉',
    spriteKey: archetype.sprite_key || archetype.id,
    colorTheme: archetype.color_theme || '',
    killIndex,
    isBoss: Boolean(bossTier),
    bossTier,
    isEventDragon,
    eventDragonKey: isEventDragon ? archetype.id : null,
    maxHp: eventStats ? eventStats.maxHp : Math.max(1, Math.round((archetype.base_hp || 50) * hpGrowth * hpMult)),
    attack: eventStats ? eventStats.attack : Math.max(1, (archetype.base_attack || 5) * atkGrowth * atkMult),
    defense: archetype.base_defense || 0,
    archetype
  };
}

function bkmpIdleRewardsAt(dragon, playerBonuses, cfg) {
  if (!dragon || !dragon.archetype) return { gold: 0, xp: 0, wood: 0, stone: 0, crystals: 0, essence: 0 };
  const archetype = dragon.archetype;
  const c = cfg || {};
  const goldGrowth = bkmpIdleGrowthMult(c.goldGrowthPerKill, c.goldGrowthExponent, dragon.killIndex);
  const xpGrowth = bkmpIdleGrowthMult(c.xpGrowthPerKill, c.xpGrowthExponent, dragon.killIndex);
  const rewardMult = dragon.bossTier === 'boss' ? (c.bossRewardMult || 4) : dragon.bossTier === 'miniboss' ? (c.minibossRewardMult || 2) : 1;
  const bonuses = playerBonuses || {};
  const goldMult = 1 + (bonuses.goldBonus || 0) / 100;
  const xpMult = 1 + (bonuses.xpBonus || 0) / 100;
  const lootMult = 1 + (bonuses.lootBonus || 0) / 100;
  /* Holz-/Steinproduktion (Wirtschaft): vorher wirkungslos, effect_type
     wurde nie ausgewertet - wirkt zusaetzlich zur allgemeinen Lootchance. */
  const woodMult = lootMult * (1 + (bonuses.woodBonus || 0) / 100);
  const stoneMult = lootMult * (1 + (bonuses.stoneBonus || 0) / 100);
  return {
    gold: Math.round((archetype.gold_reward_base || 0) * goldGrowth * rewardMult * goldMult),
    xp: Math.round((archetype.xp_reward_base || 0) * xpGrowth * rewardMult * xpMult),
    wood: Math.round((archetype.wood_reward_base || 0) * woodMult),
    stone: Math.round((archetype.stone_reward_base || 0) * stoneMult),
    crystals: Math.round((archetype.crystal_reward_base || 0) * lootMult),
    essence: Math.round((archetype.essence_reward_base || 0) * lootMult)
  };
}

function bkmpIdleGetMergedDragonScalingCfg() {
  return { ...(bkmpIdleConfig.dragon_scaling || {}), ...(bkmpIdleConfig.boss_scaling || {}), ...(bkmpIdleConfig.rare_spawn || {}) };
}
function bkmpIdleGetMergedRewardScalingCfg() {
  return { ...(bkmpIdleConfig.reward_scaling || {}), ...(bkmpIdleConfig.boss_scaling || {}) };
}

function bkmpIdleDamageRoll(attack, critChancePct, critDamagePct, defense) {
  const isCrit = Math.random() * 100 < (critChancePct || 0);
  const raw = Math.max(0, attack) * (isCrit ? Math.max(1, (critDamagePct || 150) / 100) : 1);
  const amount = Math.max(1, Math.round(raw - Math.max(0, defense || 0) * 0.5));
  return { amount, isCrit };
}

function bkmpIdleSkillEffectTotals(skillAllocations, skillDefs) {
  const totals = {};
  const alloc = skillAllocations || {};
  (skillDefs || []).forEach(node => {
    const rank = Number(alloc[node.id] || 0);
    if (rank <= 0) return;
    totals[node.effect_type] = (totals[node.effect_type] || 0) + rank * Number(node.effect_value_per_rank || 0);
  });
  return totals;
}

/* ---------------- Ressourcen-Upgrades (client-seitig, nicht DB-verwaltet) ---------------- */

/* Feste Werte statt Prozent (auf Wunsch) - jede Stufe gibt einen klaren,
   greifbaren Bonus (z. B. "+1 Angriff") statt eines abstrakten Prozentsatzes.
   Produktions-Boni (Gold/Lootchance) bleiben bewusst prozentual, da sie
   inhaltlich eine Rate/Chance beschreiben, kein absoluter Kampfwert sind.

   Max-Stufen deutlich angehoben (Spieler-Feedback: "viel mehr Level, Caps
   nach oben"). Die Kosten-Kurve nutzt seit diesem Update dasselbe
   polynomielle Modell wie die Drachen-Skalierung (bkmpIdleGrowthMult,
   (1+rate*level)^exponent statt reiner Exponential-Compoundierung
   costGrowth^level) - mit 10x mehr Stufen waere die alte Formel bei
   Stufe 500 astronomisch (1.13^500 ist praktisch unendlich), aus genau
   demselben Grund, der schon fuer die Drachen-Werte dokumentiert ist
   (siehe Kommentar bei bkmpIdleGrowthMult). costRate/costExponent sind so
   gewaehlt, dass Stufe 50 (alte Obergrenze) noch aehnlich viel kostet wie
   vorher, die neue Obergrenze aber ein spuerbares Langzeitziel bleibt statt
   unerreichbar zu sein. */
const BKMP_IDLE_UPGRADES = [
  { id: 'atk', name: 'Waffenschmiede', desc: '+1 Angriff pro Stufe.', icon: '⚔️', resource: 'gold', baseCost: 35, costRate: 0.25, costExponent: 2.3, effectType: 'attack_flat', effectPerLevel: 1, maxLevel: 500 },
  { id: 'def', name: 'Rüstkammer', desc: '+1 Verteidigung pro Stufe.', icon: '🛡️', resource: 'gold', baseCost: 35, costRate: 0.25, costExponent: 2.3, effectType: 'defense_flat', effectPerLevel: 1, maxLevel: 500 },
  { id: 'hp', name: 'Vorratshaus', desc: '+5 Leben pro Stufe.', icon: '❤️', resource: 'wood', baseCost: 25, costRate: 0.22, costExponent: 2.2, effectType: 'hp_flat', effectPerLevel: 5, maxLevel: 500 },
  { id: 'walls', name: 'Steinmauern', desc: '+1 Verteidigung pro Stufe.', icon: '🧱', resource: 'stone', baseCost: 25, costRate: 0.22, costExponent: 2.2, effectType: 'defense_flat', effectPerLevel: 1, maxLevel: 500 },
  { id: 'crit', name: 'Zielübung', desc: '+1 Krit-Chance pro Stufe.', icon: '🎯', resource: 'essence', baseCost: 6, costRate: 0.2, costExponent: 1.8, effectType: 'crit_chance_flat', effectPerLevel: 1, maxLevel: 100 },
  { id: 'crystal_gold', name: 'Kristallschliff', desc: '+2% Gold-Ausbeute pro Stufe.', icon: '💎', resource: 'crystals', baseCost: 5, costRate: 0.22, costExponent: 2, effectType: 'gold_prod_pct', effectPerLevel: 2, maxLevel: 300 },
  { id: 'essence_loot', name: 'Essenzbindung', desc: '+2% Lootchance pro Stufe.', icon: '🧪', resource: 'essence', baseCost: 4, costRate: 0.22, costExponent: 2, effectType: 'loot_chance_pct', effectPerLevel: 2, maxLevel: 300 }
];

function bkmpIdleUpgradeCost(def, currentLevel) {
  return Math.round(def.baseCost * bkmpIdleGrowthMult(def.costRate, def.costExponent, currentLevel));
}
function bkmpIdleUpgradeEffectTotals(purchases) {
  const totals = {};
  const p = purchases || {};
  BKMP_IDLE_UPGRADES.forEach(def => {
    const level = Number(p[def.id] || 0);
    if (level <= 0) return;
    totals[def.effectType] = (totals[def.effectType] || 0) + level * def.effectPerLevel;
  });
  return totals;
}
function bkmpIdleResourceEmoji(resource) {
  return { gold: '💰', wood: '🌳', stone: '🗿', crystals: '💎', essence: '🧪' }[resource] || '';
}

/* ---------------- Fallback-Daten (falls SQL-Migration noch nicht lief / Supabase nicht erreichbar) ---------------- */

const BKMP_IDLE_FALLBACK_CONFIG = {
  xp_curve: { base: 40, growth: 1.42 },
  /* Polynom-Wachstum (1+rate*kill)^exponent statt Exponential-Compoundierung
     - siehe ausfuehrlichen Kommentar bei bkmpIdleGrowthMult(). Mit diesen
     Werten: Drache #100 ~7.9x HP, #500 ~42x, #1000 ~92x (statt Millionen-
     bis astronomisch-facher HP wie bei reiner Exponential-Compoundierung). */
  dragon_scaling: { hpGrowthPerKill: 0.05, hpGrowthExponent: 1.15, atkGrowthPerKill: 0.045, atkGrowthExponent: 1.1 },
  reward_scaling: { goldGrowthPerKill: 0.05, goldGrowthExponent: 1.2, xpGrowthPerKill: 0.05, xpGrowthExponent: 1.2 },
  boss_scaling: { minibossHpMult: 1.8, minibossAtkMult: 1.3, minibossRewardMult: 2, bossHpMult: 3.2, bossAtkMult: 1.7, bossRewardMult: 4 },
  rare_spawn: { chancePct: 8 },
  offline_progress: { maxHours: 12, efficiencyPct: 50 },
  base_stats: { attack: 10, defense: 2, hp: 100, critChance: 5, critDamage: 150, goldBonus: 0, xpBonus: 0, lootBonus: 0 }
};

/* Echte Drachen-Arten (ersetzt die alte tier_order-Zyklus-Liste). Jede
   Art hat eine spawn_rule, die bestimmt WANN sie erscheint (siehe
   bkmpIdleSelectDragonKindId). sprite_key zeigt auf die zugehoerige
   SpriteSheet-CSS-Klasse (assets/dragons/<sprite_key>.png). */
const BKMP_IDLE_FALLBACK_DRAGONS = [
  { id: 'feuerdrache', name: 'Feuerdrache', emoji: '🔥', sprite_key: 'feuerdrache', spawn_rule: 'standard', color_theme: '#f97316', tier_order: 0, base_hp: 60, base_attack: 7, base_defense: 1, gold_reward_base: 6, xp_reward_base: 6, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 0, essence_reward_base: 0, is_boss: false, active: true },
  { id: 'blitzdrache', name: 'Blitzdrache', emoji: '⚡', sprite_key: 'blitzdrache', spawn_rule: 'standard', color_theme: '#facc15', tier_order: 1, base_hp: 55, base_attack: 8, base_defense: 1, gold_reward_base: 6, xp_reward_base: 6, wood_reward_base: 1, stone_reward_base: 2, crystal_reward_base: 0, essence_reward_base: 0, is_boss: false, active: true },
  { id: 'erddrache', name: 'Erddrache', emoji: '🗿', sprite_key: 'erddrache', spawn_rule: 'standard', color_theme: '#84cc16', tier_order: 2, base_hp: 70, base_attack: 6, base_defense: 3, gold_reward_base: 6, xp_reward_base: 6, wood_reward_base: 1, stone_reward_base: 3, crystal_reward_base: 0, essence_reward_base: 0, is_boss: false, active: true },
  { id: 'wasserdrache', name: 'Wasserdrache', emoji: '💧', sprite_key: 'wasserdrache', spawn_rule: 'standard', color_theme: '#38bdf8', tier_order: 3, base_hp: 65, base_attack: 6, base_defense: 2, gold_reward_base: 6, xp_reward_base: 6, wood_reward_base: 2, stone_reward_base: 2, crystal_reward_base: 0, essence_reward_base: 0, is_boss: false, active: true },
  { id: 'yakshas-drache', name: 'Yakshas Drache', emoji: '🐲', sprite_key: 'yakshas-drache', spawn_rule: 'miniboss_10', color_theme: '#a78bfa', tier_order: 4, base_hp: 115, base_attack: 10, base_defense: 4, gold_reward_base: 14, xp_reward_base: 14, wood_reward_base: 3, stone_reward_base: 3, crystal_reward_base: 2, essence_reward_base: 1, is_boss: true, active: true },
  { id: 'yaksha-boss', name: 'Yaksha der Drachenboss', emoji: '👑', sprite_key: 'yaksha-boss', spawn_rule: 'boss_25', color_theme: '#ef4444', tier_order: 5, base_hp: 220, base_attack: 16, base_defense: 8, gold_reward_base: 28, xp_reward_base: 28, wood_reward_base: 5, stone_reward_base: 5, crystal_reward_base: 5, essence_reward_base: 3, is_boss: true, active: true },
  { id: 'schattendrache', name: 'Schattendrache', emoji: '🌑', sprite_key: 'schattendrache', spawn_rule: 'rare', color_theme: '#6b21a8', tier_order: 6, base_hp: 90, base_attack: 10, base_defense: 3, gold_reward_base: 12, xp_reward_base: 10, wood_reward_base: 2, stone_reward_base: 2, crystal_reward_base: 1, essence_reward_base: 1, is_boss: false, active: true },
  { id: 'wuffdrache', name: 'Wuffdrache', emoji: '🐾', sprite_key: 'wuffdrache', spawn_rule: 'rare', color_theme: '#fbbf24', tier_order: 7, base_hp: 50, base_attack: 5, base_defense: 1, gold_reward_base: 10, xp_reward_base: 8, wood_reward_base: 1, stone_reward_base: 1, crystal_reward_base: 1, essence_reward_base: 1, is_boss: false, active: true },
  /* Seltene Event-Easter-Egg-Drachen (0,1% je Drache, siehe
     bkmpIdleSelectDragonKindId) - base_hp/base_attack werden fuer diese
     spawn_rule ('event_easter') komplett ignoriert (siehe
     bkmpIdleEventDragonScaledStats), die Belohnungsbasis (gold/xp/...) gilt
     aber normal weiter. */
  { id: 'shenloss', name: 'Shenloss', emoji: '🐲', sprite_key: 'shenloss', spawn_rule: 'event_easter', color_theme: '#22c55e', tier_order: 8, base_hp: 1, base_attack: 1, base_defense: 2, gold_reward_base: 250, xp_reward_base: 250, wood_reward_base: 10, stone_reward_base: 10, crystal_reward_base: 20, essence_reward_base: 15, is_boss: false, active: true },
  { id: 'liber', name: 'Ganz Liber Drache', emoji: '🐉', sprite_key: 'liber', spawn_rule: 'event_easter', color_theme: '#e5e7eb', tier_order: 9, base_hp: 1, base_attack: 1, base_defense: 2, gold_reward_base: 250, xp_reward_base: 250, wood_reward_base: 10, stone_reward_base: 10, crystal_reward_base: 20, essence_reward_base: 15, is_boss: false, active: true }
];

/* ---------------- State ---------------- */

let bkmpIdleState = null;
let bkmpIdleLoadFailed = false;
let bkmpPrestigeState = null;
let bkmpPrestigeLoadFailed = false;
let bkmpPrestigeSaving = false;
let bkmpIdleDragonDefs = [];
let bkmpIdleSkillDefs = [];
let bkmpIdleConfig = {};
let bkmpIdleCurrentDragon = null;
let bkmpIdleLastCounterAttackAt = 0;
let bkmpIdleVillageHp = null;
let bkmpIdleEffectiveStats = null;
let bkmpIdleLoopTimer = null;
let bkmpIdleLoopTimerMs = 900;
let bkmpIdleModalOpen = false;
let bkmpIdleSyncPending = false;
let bkmpIdleSyncTimer = null;
let bkmpIdleConfigLoaded = false;
/* Sieg-Status der seltenen Event-Drachen (siehe supabase-idle-event-
   dragons.sql), unabhaengig von bkmpIdleState geladen (eigene Tabelle,
   eigenes try/catch - gleiches Vorsichtsprinzip wie beim Prestige-Stand).
   bkmpIdleEventPauseActive haelt den KOMPLETTEN Kampf an, solange das
   Vorbereitungs-Popup noch nicht bestaetigt wurde (siehe
   bkmpIdleMaybeShowEventDragonPopup). */
let bkmpIdleEventDragonState = null;
let bkmpIdleEventPauseActive = false;

function bkmpIdleDefaultState(name) {
  return {
    name_key: String(name).trim().toLowerCase(),
    display_name: name,
    level: 1, xp: 0,
    gold: 0, wood: 0, stone: 0, crystals: 0, essence: 0, total_gold_earned: 0,
    attack: 10, defense: 2, hp: 100, crit_chance: 5, crit_damage: 150,
    gold_bonus: 0, xp_bonus: 0, loot_bonus: 0,
    skill_points_available: 0, skill_points_spent: 0,
    skill_allocations: {}, upgrade_purchases: {},
    dragon_kills: 0, boss_kills: 0, current_dragon_index: 0, highest_dragon_index: 0, prestige_stage_offset: 0, auto_advance: true,
    playtime_seconds: 0,
    last_seen_at: new Date().toISOString(),
    last_offline_claim: {},
    last_skilltree_reset_at: null
  };
}

async function bkmpIdleEnsureConfigLoaded() {
  if (bkmpIdleConfigLoaded) return;
  try {
    const [dragons, skills, config] = await Promise.all([
      typeof loadIdleDragons === 'function' ? loadIdleDragons() : null,
      typeof loadIdleSkillNodes === 'function' ? loadIdleSkillNodes() : null,
      typeof loadIdleGameConfig === 'function' ? loadIdleGameConfig() : null
    ]);
    if (Array.isArray(dragons) && dragons.length) bkmpIdleDragonDefs = dragons;
    if (Array.isArray(skills) && skills.length) bkmpIdleSkillDefs = skills;
    if (config && Object.keys(config).length) bkmpIdleConfig = config;
  } catch (e) {
    console.warn('Idle Dorf: Konnte Konfiguration nicht laden, nutze Standardwerte.', e);
  }
  if (!bkmpIdleDragonDefs.length) bkmpIdleDragonDefs = BKMP_IDLE_FALLBACK_DRAGONS;
  if (!bkmpIdleConfig.xp_curve) bkmpIdleConfig = { ...BKMP_IDLE_FALLBACK_CONFIG, ...bkmpIdleConfig };
  bkmpIdleConfigLoaded = true;
}

async function bkmpIdleLoadOrInitState(name) {
  const key = String(name).trim().toLowerCase();
  if (bkmpIdleState && bkmpIdleState.name_key === key) return;
  let remote = null;
  let loadThrew = false;
  try { remote = typeof loadIdlePlayerState === 'function' ? await loadIdlePlayerState(name) : null; } catch (e) { console.warn('Idle Dorf: Fortschritt konnte nicht geladen werden.', e); loadThrew = true; }
  /* Bei einem echten Ladefehler (Netzwerk/Server, z.B. wackliges Mobilfunknetz)
     NICHT wie bei "noch keine Zeile vorhanden" auf einen leeren Spielstand
     zurueckfallen - sonst wuerde der naechste Autosave (bkmpIdleFlushSync,
     4s nach jeder Aktion oder beim Schliessen/Tab-Wechsel) den echten,
     bereits erspielten Fortschritt mit Nullen ueberschreiben. Stattdessen
     bkmpIdleState explizit leer lassen; bkmpIdleOpenModal() bricht dann mit
     einer Fehlermeldung ab statt mit einem frischen Spielstand weiterzumachen. */
  if (loadThrew) {
    bkmpIdleState = null;
    bkmpIdleLoadFailed = true;
    return;
  }
  bkmpIdleLoadFailed = false;
  bkmpIdleState = remote || bkmpIdleDefaultState(name);
  bkmpIdleVillageHp = null;
  bkmpIdleCurrentDragon = null;
  /* Komplett eigenstaendiger Ladevorgang (eigene Tabelle, eigenes
     try/catch) - schlaegt die Migration noch nicht an, bleibt der normale
     Spielstand oben trotzdem vollstaendig nutzbar. WICHTIG: ein echter
     Ladefehler (Netzwerk) darf NICHT wie "noch nie prestiged" behandelt
     werden - bkmpIdlePerformPrestige() wuerde sonst prestige_level/-punkte/
     -allocations mit einem frischen Nullstand ueberschreiben und damit
     laengst erspielten, dauerhaften Prestige-Fortschritt komplett loeschen
     (gleiche Ursache/Fix wie bei bkmpIdleState oben). */
  bkmpPrestigeState = null;
  bkmpPrestigeLoadFailed = false;
  try {
    const remotePrestige = typeof loadIdlePrestigeState === 'function' ? await loadIdlePrestigeState(name) : null;
    bkmpPrestigeState = remotePrestige || { name_key: key, display_name: name, prestige_level: 0, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
  } catch (e) {
    console.warn('Idle Dorf: Prestige-Fortschritt konnte nicht geladen werden (Netzwerkfehler oder Migration noch nicht ausgefuehrt).', e);
    bkmpPrestigeState = null;
    bkmpPrestigeLoadFailed = true;
  }
  bkmpIdleEventDragonState = null;
  try {
    const remoteEventDragons = typeof loadIdleEventDragonState === 'function' ? await loadIdleEventDragonState(name) : null;
    bkmpIdleEventDragonState = remoteEventDragons || { shenloss_defeated: false, liber_defeated: false };
  } catch (e) {
    console.warn('Idle Dorf: Event-Drachen-Status konnte nicht geladen werden (Migration evtl. noch nicht ausgefuehrt).', e);
    bkmpIdleEventDragonState = { shenloss_defeated: false, liber_defeated: false };
  }
  /* Runen sind ein Bonus-System oben drauf, kein Kernfortschritt wie
     bkmpIdleState/bkmpPrestigeState oben - ein Ladefehler blockiert das
     Spiel deshalb bewusst NICHT, sondern startet einfach mit einem leeren
     Runen-Lager (Migration evtl. noch nicht ausgefuehrt). */
  bkmpIdlePlayerRunes = [];
  bkmpIdlePendingRuneDrops = [];
  try {
    const remoteRunes = typeof loadPlayerRunes === 'function' ? await loadPlayerRunes(name) : [];
    /* _cid: stabile CLIENT-seitige Kennung fuer UI-Referenzen (Ansehen/
       Aufwerten/Ausruesten) - unabhaengig von .id, das bei frisch
       gedroppten, noch nicht synchronisierten Runen zunaechst null ist
       (siehe bkmpIdleMaybeDropRune). Bei geladenen Runen ist die echte DB-id
       stabil, wird hier also 1:1 uebernommen. */
    bkmpIdlePlayerRunes = Array.isArray(remoteRunes) ? remoteRunes.map(r => ({
      ...r,
      _cid: r.id,
      upgrade_level: Number(r.upgrade_level || 0),
      substats: Array.isArray(r.substats) ? r.substats : []
    })) : [];
  } catch (e) {
    console.warn('Idle Dorf: Runen konnten nicht geladen werden (Migration evtl. noch nicht ausgefuehrt - siehe supabase-idle-runes.sql / supabase-idle-runes-v2.sql).', e);
    bkmpIdlePlayerRunes = [];
  }
}

function bkmpIdleEventDragonExcludedIds() {
  const s = bkmpIdleEventDragonState;
  const excluded = [];
  if (s && s.shenloss_defeated) excluded.push('shenloss');
  if (s && s.liber_defeated) excluded.push('liber');
  return excluded;
}

function bkmpIdleRecomputeEffectiveStats() {
  if (!bkmpIdleState) return;
  const skillTotals = bkmpIdleSkillEffectTotals(bkmpIdleState.skill_allocations, bkmpIdleSkillDefs);
  const upgradeTotals = bkmpIdleUpgradeEffectTotals(bkmpIdleState.upgrade_purchases);
  const titleTotals = bkmpIdleTitleEffectTotals(bkmpIdleGetAchievementContextFields());
  const base = bkmpIdleConfig.base_stats || BKMP_IDLE_FALLBACK_CONFIG.base_stats;
  /* t() summiert einen Effekttyp aus Skilltree, Upgrades UND freigeschalteten
     Sammlung-Titeln. Kampfwerte nutzen "_flat" (feste Zahlen, addiert VOR dem
     Prozent-Multiplikator), Produktionsraten (Gold/Loot) bleiben "_pct". */
  const prestigeTotals = bkmpPrestigeEffectTotals(bkmpPrestigeState ? bkmpPrestigeState.prestige_allocations : null);
  const runeTotals = bkmpIdleRuneEffectTotals();
  const t = key => (skillTotals[key] || 0) + (upgradeTotals[key] || 0) + (titleTotals[key] || 0) + (prestigeTotals[key] || 0) + (runeTotals[key] || 0);
  const prevMaxHp = bkmpIdleEffectiveStats ? bkmpIdleEffectiveStats.hp : null;
  const prevTickMs = bkmpIdleEffectiveStats ? bkmpIdleEffectiveStats.tickIntervalMs : null;
  /* extra_archer (Dorf) und ballista_unlock (Dorf) hatten vorher gar keinen
     Effekt (effect_type wurde nirgends konsumiert) - extra_archer wirkt wie
     weitere Prozent-Angriffsstaerke, ballista_unlock wie feste zusaetzliche
     Angriffskraft (Belagerungswaffe feuert bei jeder Salve mit). Zusaetzlich
     ein fixer Bonus pro Prestige-Stufe (dauerhaft, uebersteht jeden
     Aufstieg) als direkter, sofort spuerbarer Anreiz zu prestigen. */
  const prestigeLevel = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : 0;
  const prestigeLevelBonusPct = prestigeLevel * 5;
  const attackPctTotal = t('attack_pct') + t('extra_archer') * 6 + prestigeLevelBonusPct;
  const attackFlatTotal = t('attack_flat') + t('ballista_unlock') * 8;
  bkmpIdleEffectiveStats = {
    attack: (base.attack + attackFlatTotal) * (1 + attackPctTotal / 100),
    defense: (base.defense + t('defense_flat')) * (1 + t('defense_pct') / 100),
    hp: Math.round((base.hp + t('hp_flat')) * (1 + (t('hp_pct') + prestigeLevelBonusPct) / 100)),
    critChance: Math.min(75, base.critChance + t('crit_chance_flat') + t('crit_chance_pct')),
    critDamage: base.critDamage + t('crit_damage_flat') + t('crit_damage_pct'),
    goldBonus: base.goldBonus + t('gold_prod_pct') + t('gold_find_pct') + prestigeLevelBonusPct,
    xpBonus: base.xpBonus + t('xp_pct') + prestigeLevelBonusPct,
    lootBonus: base.lootBonus + t('loot_chance_pct'),
    /* Ab hier: Effekte, die vorher komplett wirkungslos im Skilltree lagen
       (kompletter Magie-Zweig + Teile von Burg/Wirtschaft). */
    woodBonus: t('wood_prod_pct'),
    stoneBonus: t('stone_prod_pct'),
    offlineBonus: t('offline_income_pct'),
    /* Angriffsgeschwindigkeit: schnellerer Auto-Tick statt eines weiteren
       reinen Schadens-Multiplikators - fuehlt sich im UI tatsaechlich nach
       "schneller" an. Untergrenze 400ms gegen zu viele DOM-Updates/Sekunde. */
    tickIntervalMs: Math.max(400, Math.round(900 / (1 + t('attack_speed_pct') / 100))),
    /* Heilung (magie_heilung) fliesst hier mit ein statt als separater
       "Heilung bei Kill"-Bonus: die Stadt wird nach jedem besiegten Drachen
       ohnehin schon voll geheilt (siehe bkmpIdleHandleDragonDefeated),
       ein Kill-Bonus waere also wirkungslos gewesen. Als zusaetzliche
       Tick-Regeneration macht der Knoten dagegen bei laengeren Kaempfen
       (Bosse, hohe Stufen) einen echten Unterschied. */
    villageRegenPct: t('shield_regen') * 0.4 + t('repair_speed_pct') * 0.3 + t('heal_pct') * 0.3,
    magicResistPct: Math.min(75, t('magic_resist_pct')),
    fireChancePct: Math.min(60, t('elem_fire')),
    iceChancePct: Math.min(60, t('elem_ice')),
    lightningChancePct: Math.min(60, t('elem_lightning')),
    clickDamagePct: t('click_damage_pct'),
    /* Nur von der ausgeruesteten Glücksrune gespeist (siehe
       BKMP_RUNE_SLOTS/bkmpIdleRuneEffectTotals) - erhoeht die Chance auf
       seltenere Runen beim naechsten Drop, siehe bkmpIdleRollRuneRarity. */
    runeLuckPct: t('rune_luck_pct')
  };
  if (bkmpIdleVillageHp === null || bkmpIdleVillageHp === undefined) {
    bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;
  } else if (prevMaxHp !== null && bkmpIdleEffectiveStats.hp > prevMaxHp) {
    bkmpIdleVillageHp += (bkmpIdleEffectiveStats.hp - prevMaxHp);
  }
  /* Die tatsaechlichen Kampfwerte auch in bkmpIdleState spiegeln, damit sie
     mitsynchronisiert werden (upsertIdlePlayerState schreibt bkmpIdleState
     1:1 in idle_player_state). Vorher blieben attack/defense/hp/crit_* in
     der DB permanent auf den Default-Werten (10/2/100/5/150) stehen, egal
     wie viel der Spieler investiert hatte - der Offline-Fortschritt-Server
     (api/claim-idle-offline-progress.js) sah dadurch NIE die echte Staerke
     des Spielers, nur immer den Anfangswert. */
  bkmpIdleState.attack = bkmpIdleEffectiveStats.attack;
  bkmpIdleState.defense = bkmpIdleEffectiveStats.defense;
  bkmpIdleState.hp = bkmpIdleEffectiveStats.hp;
  bkmpIdleState.crit_chance = bkmpIdleEffectiveStats.critChance;
  bkmpIdleState.crit_damage = bkmpIdleEffectiveStats.critDamage;
  bkmpIdleState.gold_bonus = bkmpIdleEffectiveStats.goldBonus;
  bkmpIdleState.xp_bonus = bkmpIdleEffectiveStats.xpBonus;
  bkmpIdleState.loot_bonus = bkmpIdleEffectiveStats.lootBonus;
  if (prevTickMs !== null && prevTickMs !== bkmpIdleEffectiveStats.tickIntervalMs) bkmpIdleSyncLoopInterval();
}

/* ---------------- Skilltree ---------------- */

const BKMP_IDLE_BRANCH_LABELS = { dorf: '🏹 Dorf', burg: '🏰 Burg', wirtschaft: '⚒ Wirtschaft', forschung: '🐉 Forschung', magie: '✨ Magie' };
const BKMP_IDLE_BRANCH_ORDER = ['dorf', 'burg', 'wirtschaft', 'forschung', 'magie'];

function bkmpIdleCanAllocateSkill(node) {
  if (!bkmpIdleState) return false;
  const alloc = bkmpIdleState.skill_allocations || {};
  const currentRank = Number(alloc[node.id] || 0);
  if (currentRank >= node.max_rank) return false;
  if (bkmpIdleState.skill_points_available < node.cost_per_rank) return false;
  if (node.requires_node_id) {
    const reqRank = Number(alloc[node.requires_node_id] || 0);
    if (reqRank < node.requires_rank) return false;
  }
  return true;
}

function bkmpIdleAllocateSkill(nodeId) {
  const node = bkmpIdleSkillDefs.find(n => n.id === nodeId);
  if (!node || !bkmpIdleCanAllocateSkill(node)) return;
  const alloc = bkmpIdleState.skill_allocations || (bkmpIdleState.skill_allocations = {});
  alloc[nodeId] = Number(alloc[nodeId] || 0) + 1;
  bkmpIdleState.skill_points_available -= node.cost_per_rank;
  bkmpIdleState.skill_points_spent += node.cost_per_rank;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderSkilltreePanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

const BKMP_SKILLTREE_RESET_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function bkmpIdleSkilltreeResetCooldownMsLeft() {
  if (!bkmpIdleState || !bkmpIdleState.last_skilltree_reset_at) return 0;
  const last = Date.parse(bkmpIdleState.last_skilltree_reset_at);
  if (isNaN(last)) return 0;
  return Math.max(0, BKMP_SKILLTREE_RESET_COOLDOWN_MS - (Date.now() - last));
}

/* Erstattet alle investierten Skillpunkte (skill_allocations komplett
   geleert, skill_points_available bekommt skill_points_spent zurueck) -
   kein permanenter Verlust, nur eine Umverteilungs-Moeglichkeit. Deshalb
   reicht 1x/Tag als Limit, nicht als harte Strafe gedacht, sondern damit
   nicht bei jedem Kampf hin- und hergeschaltet wird. */
async function bkmpIdleResetSkilltree() {
  if (!bkmpIdleState || bkmpIdleSkilltreeResetCooldownMsLeft() > 0) return;
  const confirmed = await bkmpConfirmDialog(
    '🔄 Skilltree zurücksetzen?',
    'Alle investierten Skillpunkte werden erstattet und können neu verteilt werden.',
    'Zurücksetzen',
    'Abbrechen'
  );
  if (!confirmed) return;
  bkmpIdleState.skill_points_available = Number(bkmpIdleState.skill_points_available || 0) + Number(bkmpIdleState.skill_points_spent || 0);
  bkmpIdleState.skill_points_spent = 0;
  bkmpIdleState.skill_allocations = {};
  bkmpIdleState.last_skilltree_reset_at = new Date().toISOString();
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleSkillBranchOpenState = null; // nach Reset frisch entscheiden, welcher Zweig aufklappt
  bkmpIdleRenderSkilltreePanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

function bkmpIdleCountMaxedBranches() {
  if (!bkmpIdleState || !bkmpIdleSkillDefs.length) return 0;
  const alloc = bkmpIdleState.skill_allocations || {};
  return BKMP_IDLE_BRANCH_ORDER.filter(branch => {
    const nodes = bkmpIdleSkillDefs.filter(n => n.branch === branch);
    return nodes.length > 0 && nodes.every(n => Number(alloc[n.id] || 0) >= n.max_rank);
  }).length;
}

/* ---------------- Achievement-Kontext-Felder (fuer index.html) ---------------- */

/* bkmpIdleState wird erst geladen, wenn das Idle-Dorf-Fenster geoeffnet
   wird bzw. bkmpIdlePreloadStateIfNamed() im Hintergrund fertig ist (siehe
   bkmpIdleInit weiter unten) - bis dahin lieferte diese Funktion ueberall
   0 zurueck, wodurch alle Idle-Dorf-Erfolge kurzzeitig als "nicht
   freigeschaltet" zaehlten und die Gesamtzahl in der Badge-Anzeige sprang,
   sobald der echte Stand kurz danach nachgeladen wurde. Der zuletzt
   bekannte Stand wird deshalb zusaetzlich lokal gecacht und als
   Zwischenwert benutzt, bis der echte Ladevorgang durch ist. */
const BKMP_IDLE_ACHIEVEMENT_CACHE_KEY = 'bkmp-idle-achievement-fields-cache';
function bkmpIdleGetCachedAchievementFields() {
  try { return JSON.parse(localStorage.getItem(BKMP_IDLE_ACHIEVEMENT_CACHE_KEY) || 'null'); } catch (e) { return null; }
}
function bkmpIdleGetAchievementContextFields() {
  const s = bkmpIdleState;
  if (!s) {
    return bkmpIdleGetCachedAchievementFields() || { idleDragonKills: 0, idleBossKills: 0, idleLevel: 0, idleGoldEarned: 0, idleSkillPointsSpent: 0, idleBranchesMaxed: 0, shenlossDefeated: false, liberDefeated: false, idlePrestigeLevel: 0 };
  }
  const fields = {
    idleDragonKills: Number(s.dragon_kills || 0),
    idleBossKills: Number(s.boss_kills || 0),
    idleLevel: Number(s.level || 0),
    idleGoldEarned: Number(s.total_gold_earned || 0),
    idleSkillPointsSpent: Number(s.skill_points_spent || 0),
    idleBranchesMaxed: bkmpIdleCountMaxedBranches(),
    shenlossDefeated: Boolean(bkmpIdleEventDragonState && bkmpIdleEventDragonState.shenloss_defeated),
    liberDefeated: Boolean(bkmpIdleEventDragonState && bkmpIdleEventDragonState.liber_defeated),
    /* Faellt auf den zuletzt gecachten Wert zurueck statt auf 0, falls der
       Prestige-Stand (eigene Tabelle, eigener Ladevorgang) in diesem
       Moment noch nicht durch ist - sonst wuerde ein bereits erspieltes
       Prestige-Achievement/Titel kurzzeitig faelschlich wieder gesperrt
       wirken (gleiche Vorsicht wie bei bkmpPrestigeLoadFailed). */
    idlePrestigeLevel: bkmpPrestigeState
      ? Number(bkmpPrestigeState.prestige_level || 0)
      : Number((bkmpIdleGetCachedAchievementFields() || {}).idlePrestigeLevel || 0)
  };
  try { localStorage.setItem(BKMP_IDLE_ACHIEVEMENT_CACHE_KEY, JSON.stringify(fields)); } catch (e) {}
  return fields;
}

/* ---------------- Kampf-Loop ---------------- */

const BKMP_IDLE_SPRITE_CLASS_PREFIX = 'idle-sprite-';

function bkmpIdleSpawnDragon() {
  bkmpIdleCurrentDragon = bkmpIdleDragonStatsAt(
    bkmpIdleState.current_dragon_index,
    bkmpIdleDragonDefs,
    bkmpIdleGetMergedDragonScalingCfg(),
    bkmpIdleState.name_key,
    bkmpIdleEventDragonExcludedIds(),
    bkmpIdleEffectiveStats
  );
  if (!bkmpIdleCurrentDragon) return;
  bkmpIdleCurrentDragon.hp = bkmpIdleCurrentDragon.maxHp;
  const nameEl = document.getElementById('idleDragonName');
  if (nameEl) nameEl.textContent = `${bkmpIdleCurrentDragon.isBoss ? '👑 BOSS: ' : ''}${bkmpIdleCurrentDragon.isEventDragon ? '✨ ' : ''}${bkmpIdleCurrentDragon.name} (Stufe ${bkmpIdleFormatStage(bkmpIdleCurrentDragon.killIndex)})`;
  const sprite = document.getElementById('idleDragonSprite');
  if (sprite) {
    [...sprite.classList].filter(c => c.startsWith(BKMP_IDLE_SPRITE_CLASS_PREFIX)).forEach(c => sprite.classList.remove(c));
    sprite.classList.remove('idle-sprite-attacking');
    sprite.classList.add(BKMP_IDLE_SPRITE_CLASS_PREFIX + bkmpIdleCurrentDragon.spriteKey);
  }
  const dragonEl = document.getElementById('idleDragon');
  if (dragonEl) {
    dragonEl.classList.toggle('idle-dragon-boss', bkmpIdleCurrentDragon.bossTier === 'boss');
    dragonEl.classList.toggle('idle-dragon-miniboss', bkmpIdleCurrentDragon.bossTier === 'miniboss');
    dragonEl.classList.toggle('idle-dragon-event', Boolean(bkmpIdleCurrentDragon.isEventDragon));
  }
  bkmpIdleUpdateDragonHpBar();
  bkmpIdleRenderStageBar();
  bkmpIdleMaybeShowEventDragonPopup();
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

function bkmpIdleAddXp(amount) {
  bkmpIdleState.xp += amount;
  const xpCfg = bkmpIdleConfig.xp_curve || BKMP_IDLE_FALLBACK_CONFIG.xp_curve;
  let leveled = false;
  while (bkmpIdleState.xp >= bkmpIdleXpForLevel(bkmpIdleState.level, xpCfg)) {
    bkmpIdleState.xp -= bkmpIdleXpForLevel(bkmpIdleState.level, xpCfg);
    bkmpIdleState.level += 1;
    bkmpIdleState.skill_points_available += 1;
    leveled = true;
    if (bkmpIdleState.level % 10 === 0) {
      const bonusGold = Math.round(200 * (bkmpIdleState.level / 10));
      bkmpIdleState.gold += bonusGold;
      bkmpIdleState.total_gold_earned += bonusGold;
      bkmpIdleState.crystals += 2;
      bkmpIdleLog(`🎉 Level ${bkmpIdleState.level} erreicht! Bonus: +${bonusGold} 💰 +2 💎`);
    }
  }
  if (leveled) bkmpIdleRecomputeEffectiveStats();
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

function bkmpIdleHandleDragonDefeated() {
  const defeatedEventDragon = bkmpIdleCurrentDragon && bkmpIdleCurrentDragon.isEventDragon ? bkmpIdleCurrentDragon : null;
  const rewards = bkmpIdleRewardsAt(bkmpIdleCurrentDragon, bkmpIdleEffectiveStats, bkmpIdleGetMergedRewardScalingCfg());
  bkmpIdleState.gold += rewards.gold;
  bkmpIdleState.total_gold_earned += rewards.gold;
  bkmpIdleState.wood += rewards.wood;
  bkmpIdleState.stone += rewards.stone;
  bkmpIdleState.crystals += rewards.crystals;
  bkmpIdleState.essence += rewards.essence;
  bkmpIdleState.dragon_kills += 1;
  if (bkmpIdleCurrentDragon.isBoss) bkmpIdleState.boss_kills += 1;
  bkmpIdleMaybeDropRune(bkmpIdleCurrentDragon.isBoss ? 'boss' : 'normal');
  const autoAdvance = bkmpIdleState.auto_advance !== false;
  if (autoAdvance) bkmpIdleState.current_dragon_index += 1;
  bkmpIdleState.highest_dragon_index = Math.max(Number(bkmpIdleState.highest_dragon_index || 0), bkmpIdleState.current_dragon_index);
  bkmpIdleAddXp(rewards.xp);
  bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;
  bkmpIdleLog(`${bkmpIdleCurrentDragon.emoji} ${bkmpIdleCurrentDragon.name} besiegt! +${rewards.gold}💰 +${rewards.xp}✨` + (bkmpIdleCurrentDragon.isBoss ? ' 👑 BOSS!' : '') + (autoAdvance ? '' : ' (bleibt auf dieser Stufe)'));
  /* Feuert ein leichtes, folgenloses DOM-Event mit den Belohnungen dieses
     Kills - fuer die Hauptseite bedeutungslos (kein Listener dort), aber
     die Grundlage fuer die schlanke Stream-Mini-Ansicht (idle-stream-
     mini.html, Nutzerwunsch 15.07.: "irgendwo mega süß +?? Gold +?? XP"),
     die daraus eine kleine Hochschweb-Anzeige baut, ohne dass idledorf.js
     selbst irgendetwas Seiten-spezifisches ueber DOM-Struktur wissen muss. */
  document.dispatchEvent(new CustomEvent('bkmpIdleRewardGained', { detail: { gold: rewards.gold, xp: rewards.xp, isBoss: !!bkmpIdleCurrentDragon.isBoss } }));
  bkmpIdleSpawnDragon();
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleRenderHud();
  bkmpIdleRefreshLiveTabs();
  /* Haelt den Erfolge-Zwischenspeicher waehrend des Spielens laufend
     aktuell (schreibt als Nebeneffekt in bkmp-idle-achievement-fields-
     cache, siehe bkmpIdleGetAchievementContextFields) - sonst blieb der
     Cache auf dem Stand vom letzten OEFFNEN des Fensters stehen, und ein
     Neuladen der Seite nach einer laengeren Spielsitzung zeigte kurz
     wieder die veralteten (niedrigeren) Zahlen, bis der echte Stand erneut
     nachgeladen war. */
  bkmpIdleGetAchievementContextFields();
  bkmpIdleQueueSync();
  if (defeatedEventDragon) bkmpIdleClaimEventDragonVictory(defeatedEventDragon);
}

function bkmpIdleHandleDefeat() {
  bkmpIdleLog(`💀 Niederlage gegen ${bkmpIdleCurrentDragon.emoji} ${bkmpIdleCurrentDragon.name}! Du fällst eine Stufe zurück.`);
  bkmpIdleState.current_dragon_index = Math.max(0, Number(bkmpIdleState.current_dragon_index || 0) - 1);
  bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;
  bkmpIdleSpawnDragon();
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

function bkmpIdleTick() {
  if (!bkmpIdleState || !bkmpIdleCurrentDragon || !bkmpIdleEffectiveStats) return;
  const stats = bkmpIdleEffectiveStats;
  bkmpIdleState.playtime_seconds = Number(bkmpIdleState.playtime_seconds || 0) + (stats.tickIntervalMs || 900) / 1000;

  /* Schildgenerator/Reparaturtempo (Burg): passive Regeneration der
     Stadt-Lebenspunkte - vorher wirkungslos, effect_type wurde nie
     ausgewertet. */
  if (stats.villageRegenPct > 0 && bkmpIdleVillageHp < stats.hp) {
    bkmpIdleVillageHp = Math.min(stats.hp, bkmpIdleVillageHp + stats.hp * (stats.villageRegenPct / 100));
  }

  const vRoll = bkmpIdleDamageRoll(stats.attack, stats.critChance, stats.critDamage, bkmpIdleCurrentDragon.defense);
  bkmpIdleCurrentDragon.hp = Math.max(0, bkmpIdleCurrentDragon.hp - vRoll.amount);
  bkmpIdleSpawnProjectile('arrow', vRoll.amount, vRoll.isCrit);
  bkmpIdleSpawnHitFlash('idleDragon');
  bkmpIdleUpdateDragonHpBar();

  /* Feuer (magie_feuer/magie_meister): Chance, einen Brand aufzufrischen,
     der eigenstaendig weiter tickt - genau der "Burn-Damage-Tick", der
     vorher trotz Beschreibung ("Brandpfeile"/"Feuer") gar nicht existierte. */
  if (stats.fireChancePct > 0 && Math.random() * 100 < stats.fireChancePct) {
    bkmpIdleCurrentDragon.burnDamagePerTick = Math.max(1, Math.round(stats.attack * 0.18));
    bkmpIdleCurrentDragon.burnTicksLeft = 4;
  }
  if (bkmpIdleCurrentDragon.hp > 0 && bkmpIdleCurrentDragon.burnTicksLeft > 0) {
    const burnDmg = Math.min(bkmpIdleCurrentDragon.hp, bkmpIdleCurrentDragon.burnDamagePerTick);
    bkmpIdleCurrentDragon.hp = Math.max(0, bkmpIdleCurrentDragon.hp - burnDmg);
    bkmpIdleCurrentDragon.burnTicksLeft -= 1;
    bkmpIdleSpawnBurnTick(burnDmg);
    bkmpIdleUpdateDragonHpBar();
  }

  /* Blitzschlag (magie_blitz): seltener Bonus-Schlag oben drauf. */
  if (bkmpIdleCurrentDragon.hp > 0 && stats.lightningChancePct > 0 && Math.random() * 100 < stats.lightningChancePct) {
    const boltDmg = Math.max(1, Math.round(stats.attack * 0.6));
    bkmpIdleCurrentDragon.hp = Math.max(0, bkmpIdleCurrentDragon.hp - boltDmg);
    bkmpIdleSpawnLightningBolt(boltDmg);
    bkmpIdleUpdateDragonHpBar();
  }

  if (bkmpIdleCurrentDragon.hp <= 0) {
    bkmpIdleHandleDragonDefeated();
    return;
  }

  bkmpIdleDragonCounterAttack(stats);
}

/* Gegenschlag des Drachen - eigene Funktion, damit Tick UND Klick
   (bkmpIdleHandleDragonClick) exakt dieselbe Logik nutzen. Vorher hatte
   NUR der Tick einen Gegenschlag; ein Klick, der den Drachen nicht sofort
   toetete, machte Schaden OHNE dass der Drache je zurueckschlug. Sobald
   ausschliesslich geklickt wurde (z.B. weil der Auto-Tick gerade tot war,
   siehe der Raid-Bug oben, oder einfach weil man schnell durchklickt statt
   zu warten), bekam das Dorf dadurch NIE Schaden - komplettes Nullrisiko.
   Aufgerufen wird sie nur, wenn der Drache den Treffer ueberlebt hat - beim
   toedlichen letzten Treffer bleibt der Gegenschlag weiterhin bewusst aus
   (kein Rachehieb von einem toten Drachen), egal ob per Tick oder Klick.

   Abklingzeit (bkmpIdleLastCounterAttackAt): Tick UND Klicks laufen
   gleichzeitig und unabhaengig voneinander - ohne diese Bremse loeste
   JEDER einzelne Klick zusaetzlich zum laufenden 900ms-Tick einen eigenen
   Gegenschlag aus, wodurch schnelles Klicken das Dorf um ein Vielfaches
   schneller draufgehen liess als vor der obigen Aenderung (genau das
   Gegenteil des beabsichtigten Effekts). Der Drache greift dadurch
   hoechstens einmal pro Tick-Intervall zurueck, egal ob dieser Treffer vom
   Tick oder von einem Klick kam - schliesst weiterhin das Nullrisiko-Klicken
   von oben, ohne Vielfach-Gegenschlaege bei normalem/schnellem Klicken. */
function bkmpIdleDragonCounterAttack(stats) {
  const now = Date.now();
  const cooldownMs = stats.tickIntervalMs || 900;
  if (now - bkmpIdleLastCounterAttackAt < cooldownMs) return;
  bkmpIdleLastCounterAttackAt = now;

  /* Eis (magie_eis): Chance, den Gegenangriff komplett auszusetzen. */
  const frozen = stats.iceChancePct > 0 && Math.random() * 100 < stats.iceChancePct;
  if (frozen) {
    bkmpIdleSpawnIceBlock();
  } else {
    const dRoll = bkmpIdleDamageRoll(bkmpIdleCurrentDragon.attack, 5, 150, stats.defense);
    /* Magieresistenz (magie_resistenz): mindert erlittenen Schaden zusaetzlich. */
    const finalDmg = Math.round(dRoll.amount * (1 - (stats.magicResistPct || 0) / 100));
    bkmpIdleVillageHp = Math.max(0, bkmpIdleVillageHp - finalDmg);
    bkmpIdleSpawnProjectile('fire', finalDmg, dRoll.isCrit);
    bkmpIdlePlaySpriteAttack();
    bkmpIdleSpawnHitFlash('idleVillage');
    bkmpIdleUpdateVillageHpBar();
  }

  if (bkmpIdleVillageHp <= 0) {
    bkmpIdleHandleDefeat();
  }
}

function bkmpIdleSpawnBurnTick(amount) {
  const target = document.getElementById('idleDragon');
  if (!target) return;
  const dmg = document.createElement('span');
  dmg.className = 'idle-dmg-float idle-dmg-burn';
  dmg.textContent = '🔥-' + Math.round(amount);
  target.appendChild(dmg);
  window.setTimeout(() => dmg.remove(), 800);
}

function bkmpIdleSpawnLightningBolt(amount) {
  const field = document.getElementById('idleBattlefield');
  if (field) {
    const el = document.createElement('span');
    el.className = 'idle-lightning-bolt';
    field.appendChild(el);
    window.setTimeout(() => el.remove(), 350);
  }
  const target = document.getElementById('idleDragon');
  if (target) {
    const dmg = document.createElement('span');
    dmg.className = 'idle-dmg-float idle-dmg-lightning';
    dmg.textContent = '⚡-' + Math.round(amount);
    target.appendChild(dmg);
    window.setTimeout(() => dmg.remove(), 800);
  }
}

function bkmpIdleSpawnIceBlock() {
  const target = document.getElementById('idleVillage');
  if (!target) return;
  const el = document.createElement('span');
  el.className = 'idle-ice-block';
  el.textContent = '❄️ Eingefroren!';
  target.appendChild(el);
  window.setTimeout(() => el.remove(), 800);
}

function bkmpIdleStartLoop() {
  /* Zentrale Sperre: solange das Vorbereitungs-Popup eines Event-Drachen
     noch nicht bestaetigt wurde, darf der Kampf-Loop unter KEINEN
     Umstaenden laufen - auch nicht ueber Umwege wie
     bkmpRaidStopCombatView()'s "Auto-Loop wieder anschalten"-Logik. */
  if (bkmpIdleEventPauseActive) return;
  bkmpIdleStopLoop();
  const ms = (bkmpIdleEffectiveStats && bkmpIdleEffectiveStats.tickIntervalMs) || 900;
  bkmpIdleLoopTimer = window.setInterval(bkmpIdleTick, ms);
  bkmpIdleLoopTimerMs = ms;
}
function bkmpIdleStopLoop() {
  if (bkmpIdleLoopTimer) { window.clearInterval(bkmpIdleLoopTimer); bkmpIdleLoopTimer = null; }
}
/* Angriffsgeschwindigkeit (Dorf): kann sich zur Laufzeit aendern (neuer
   Skillpunkt investiert). Restartet den laufenden Loop nur, wenn sich das
   Intervall wirklich geaendert hat - verhindert unnoetige Neustarts bei
   jedem Stat-Rebuild (z. B. nach jedem Kill). */
function bkmpIdleSyncLoopInterval() {
  if (!bkmpIdleLoopTimer || !bkmpIdleEffectiveStats) return;
  const ms = bkmpIdleEffectiveStats.tickIntervalMs || 900;
  if (ms !== bkmpIdleLoopTimerMs) bkmpIdleStartLoop();
}

/* ---------------- Rendering: Kampf-Tab ---------------- */

function bkmpIdleFormatNumber(n) {
  n = Math.floor(Number(n) || 0);
  if (n >= 1000000) return (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function bkmpIdleUpdateDragonHpBar() {
  const fill = document.getElementById('idleDragonHpFill');
  const label = document.getElementById('idleDragonHpLabel');
  if (!fill || !bkmpIdleCurrentDragon) return;
  const pct = Math.max(0, Math.min(100, (bkmpIdleCurrentDragon.hp / bkmpIdleCurrentDragon.maxHp) * 100));
  fill.style.width = pct + '%';
  if (label) label.textContent = `${Math.max(0, Math.round(bkmpIdleCurrentDragon.hp))} / ${bkmpIdleCurrentDragon.maxHp}`;
}

function bkmpIdleUpdateVillageHpBar() {
  const fill = document.getElementById('idleVillageHpFill');
  const label = document.getElementById('idleVillageHpLabel');
  if (!fill || !bkmpIdleEffectiveStats) return;
  const maxHp = bkmpIdleEffectiveStats.hp;
  const pct = Math.max(0, Math.min(100, (bkmpIdleVillageHp / maxHp) * 100));
  fill.style.width = pct + '%';
  if (label) label.textContent = `${Math.round(bkmpIdleVillageHp)} / ${Math.round(maxHp)}`;
}

function bkmpIdleSpawnProjectile(kind, amount, isCrit) {
  const field = document.getElementById('idleBattlefield');
  if (!field) return;
  const el = document.createElement('span');
  el.className = kind === 'arrow' ? 'idle-arrow' : 'idle-fire-breath';
  field.appendChild(el);
  window.setTimeout(() => el.remove(), 500);

  const targetId = kind === 'arrow' ? 'idleDragon' : 'idleVillage';
  const target = document.getElementById(targetId);
  if (target) {
    const dmg = document.createElement('span');
    dmg.className = 'idle-dmg-float' + (isCrit ? ' idle-dmg-crit' : '');
    dmg.textContent = '-' + Math.round(amount) + (isCrit ? '!' : '');
    target.appendChild(dmg);
    window.setTimeout(() => dmg.remove(), 800);
  }
}

/* Spielt den Angriffs-Frame-Zyklus des Drachensprites ab (Elementaratem).
   Nutzt animationend statt eines festen Timeouts, damit ein neuer Angriff
   die laufende Animation sauber neu startet, auch bei sehr kurzen Ticks. */
function bkmpIdlePlaySpriteAttack() {
  const sprite = document.getElementById('idleDragonSprite');
  if (!sprite) return;
  sprite.classList.remove('idle-sprite-attacking');
  void sprite.offsetWidth;
  sprite.classList.add('idle-sprite-attacking');
}

function bkmpIdleSpawnHitFlash(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.classList.remove('idle-hit-flash');
  void el.offsetWidth;
  el.classList.add('idle-hit-flash');
}

function bkmpIdleRenderHud() {
  const hud = document.getElementById('idleDorfHud');
  if (!hud || !bkmpIdleState) return;
  const xpCfg = bkmpIdleConfig.xp_curve || BKMP_IDLE_FALLBACK_CONFIG.xp_curve;
  const xpNeeded = bkmpIdleXpForLevel(bkmpIdleState.level, xpCfg);
  const xpPct = Math.max(0, Math.min(100, (bkmpIdleState.xp / xpNeeded) * 100));
  const s = bkmpIdleEffectiveStats;
  hud.innerHTML = `
    <div class="idle-hud-top">
      <div class="idle-hud-level-badge"><span class="idle-hud-level-num">${bkmpIdleState.level}</span><span class="idle-hud-level-tag">Level</span></div>
      <div class="idle-hud-xp-wrap">
        <div class="idle-hud-skillpoints">🔹 ${bkmpIdleState.skill_points_available} Skillpunkte</div>
        <div class="idle-xp-bar"><div class="idle-xp-fill" style="width:${xpPct}%"></div></div>
        <div class="idle-xp-label">${Math.floor(bkmpIdleState.xp)} / ${xpNeeded} XP</div>
      </div>
    </div>
    ${s ? `
    <div class="idle-hud-stats">
      <span title="Angriff">⚔️ ${bkmpIdleFormatNumber(Math.round(s.attack))}</span>
      <span title="Verteidigung">🛡️ ${bkmpIdleFormatNumber(Math.round(s.defense))}</span>
      <span title="Maximale Leben">❤️ ${bkmpIdleFormatNumber(Math.round(s.hp))}</span>
      <span title="Kritische-Treffer-Chance">🎯 ${s.critChance.toFixed(1)}%</span>
      <span title="Kritischer Schaden">💥 ${Math.round(s.critDamage)}%</span>
      <span title="Angriffstempo (Angriffe pro Sekunde)">⚡ ${(1000 / (s.tickIntervalMs || 900)).toFixed(2)}/s</span>
    </div>` : ''}
    <div class="idle-hud-resources">
      <span>💰 ${bkmpIdleFormatNumber(bkmpIdleState.gold)}</span>
      <span>🌳 ${bkmpIdleFormatNumber(bkmpIdleState.wood)}</span>
      <span>🗿 ${bkmpIdleFormatNumber(bkmpIdleState.stone)}</span>
      <span>💎 ${bkmpIdleFormatNumber(bkmpIdleState.crystals)}</span>
      <span>🧪 ${bkmpIdleFormatNumber(bkmpIdleState.essence)}</span>
      <span>🐉 ${bkmpIdleFormatNumber(bkmpIdleState.dragon_kills)} besiegt</span>
    </div>`;
}

function bkmpIdleToggleAutoAdvance() {
  if (!bkmpIdleState) return;
  bkmpIdleState.auto_advance = !(bkmpIdleState.auto_advance !== false);
  bkmpIdleRenderStageBar();
  bkmpIdleQueueSync();
}

/* Springt auf jede beliebige, bereits erreichte Stufe (0 <= targetIndex <=
   highest_dragon_index). Aendert NIE highest_dragon_index - das bleibt der
   dauerhafte Bestwert. Wird sowohl vom "Zur besten Stufe springen"-Button
   als auch vom Stufenwahl-Popup genutzt, damit es nur einen Sprung-Code-
   pfad gibt. */
function bkmpIdleJumpToStage(targetIndex) {
  if (!bkmpIdleState) return;
  /* Kein Stufenwechsel/Ueberspringen waehrend das Vorbereitungs-Popup
     eines Event-Drachen auf Bestaetigung wartet. */
  if (bkmpIdleEventPauseActive) return;
  const highest = Number(bkmpIdleState.highest_dragon_index || 0);
  const target = Math.max(0, Math.min(highest, Math.floor(Number(targetIndex) || 0)));
  if (target === Number(bkmpIdleState.current_dragon_index || 0)) return;
  bkmpIdleState.current_dragon_index = target;
  bkmpIdleVillageHp = bkmpIdleEffectiveStats ? bkmpIdleEffectiveStats.hp : bkmpIdleVillageHp;
  bkmpIdleSpawnDragon();
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleQueueSync();
}

function bkmpIdleJumpToHighestStage() {
  if (!bkmpIdleState) return;
  bkmpIdleJumpToStage(Number(bkmpIdleState.highest_dragon_index || 0));
}

/* Lebenszeit-Gesamtzahl erreichter Stufen ueber alle Prestige-Auffstiege
   hinweg: Summe aller vor frueheren Auffstiegen erreichten Hoechststufen
   (prestige_stage_offset, siehe bkmpIdlePerformPrestige) plus die im
   aktuellen Lauf erreichte Hoechststufe. Als reine Zahl (nicht im "Akt-
   Stufe"-Format), da genau das gewuenscht war: z.B. Aufstieg bei Stufe
   10-0 (=100) + spaeter im neuen Lauf Stufe 1-0 (=10) erreicht ergibt hier
   110, nicht "11-0". */
function bkmpIdleLifetimeStageCount() {
  if (!bkmpIdleState) return 0;
  return Number(bkmpIdleState.prestige_stage_offset || 0) + Number(bkmpIdleState.highest_dragon_index || 0);
}

function bkmpIdleRenderStageBar() {
  const el = document.getElementById('idleStageBar');
  if (!el || !bkmpIdleState) return;
  const current = Number(bkmpIdleState.current_dragon_index || 0);
  const highest = Number(bkmpIdleState.highest_dragon_index || 0);
  const autoAdvance = bkmpIdleState.auto_advance !== false;
  /* Waehrend das Vorbereitungs-Popup eines Event-Drachen offen ist, duerfen
     Stufensprung-Buttons nicht nur wirkungslos sein (siehe
     bkmpIdleJumpToStage/bkmpIdleOpenStagePicker), sondern sollen das auch
     sichtbar zeigen statt wie normale, aktive Buttons auszusehen. */
  const jumpDisabled = bkmpIdleEventPauseActive ? 'disabled title="Erst nach Bestätigung des Kampfes möglich"' : '';
  el.innerHTML = `
    <span class="idle-stage-label">Stufe <strong>${bkmpIdleFormatStage(current)}</strong> · Insgesamt erreichte Stufen: <strong>${bkmpIdleFormatNumber(bkmpIdleLifetimeStageCount())}</strong></span>
    <div class="idle-stage-buttons">
      <button type="button" class="btn-nein idle-stage-btn" id="idleStageAutoAdvanceBtn">${autoAdvance ? '⬆️ Steigt automatisch auf' : '📍 Bleibt auf dieser Stufe'}</button>
      ${highest > current ? `<button type="button" class="btn-ja idle-stage-btn" id="idleStageJumpBtn" ${jumpDisabled}>Zur besten Stufe springen</button>` : ''}
      <button type="button" class="btn-nein idle-stage-btn" id="idleStagePickerBtn" ${jumpDisabled}>🗺️ Zu bestimmter Stufe wechseln</button>
    </div>`;
  const autoBtn = document.getElementById('idleStageAutoAdvanceBtn');
  if (autoBtn) autoBtn.addEventListener('click', bkmpIdleToggleAutoAdvance);
  const jumpBtn = document.getElementById('idleStageJumpBtn');
  if (jumpBtn) jumpBtn.addEventListener('click', bkmpIdleJumpToHighestStage);
  const pickerBtn = document.getElementById('idleStagePickerBtn');
  if (pickerBtn) pickerBtn.addEventListener('click', bkmpIdleOpenStagePicker);
}

/* ---------------- Stufenwahl-Popup ---------------- */

function bkmpIdleRenderStagePickerBody() {
  const body = document.getElementById('idleStagePickerBody');
  if (!body || !bkmpIdleState) return;
  const current = Number(bkmpIdleState.current_dragon_index || 0);
  const highest = Number(bkmpIdleState.highest_dragon_index || 0);
  const highestAct = Math.floor(highest / 10);
  let html = '';
  for (let act = 0; act <= highestAct + 1; act++) {
    const locked = act > highestAct;
    html += `<div class="idle-stagepicker-act${locked ? ' is-locked' : ''}">`;
    html += `<div class="idle-stagepicker-act-title">${locked ? '🔒 ' : ''}Akt ${act + 1}</div>`;
    if (!locked) {
      html += '<div class="idle-stagepicker-grid">';
      const maxLocalStage = act === highestAct ? (highest % 10) : 9;
      for (let s = 0; s <= maxLocalStage; s++) {
        const idx = act * 10 + s;
        const isCurrent = idx === current;
        const isHighest = idx === highest;
        /* Boss-Stufe: alle 25 Kaempfe (1-indiziert, siehe
           bkmpIdleSelectDragonKindId: stage = killIndex+1, stage % 25 === 0)
           - im Auswahl-Raster optisch markiert, damit man sie schnell
           wiederfindet (Spieler-Feedback von DerJannikHase). */
        const isBoss = (idx + 1) % 25 === 0;
        const cls = ['idle-stagepicker-stage'];
        if (isCurrent) cls.push('is-current');
        if (isHighest) cls.push('is-highest');
        if (isBoss) cls.push('is-boss');
        const titleSuffix = [isHighest ? 'Beste Stufe' : '', isBoss ? 'Boss-Stufe' : ''].filter(Boolean).join(', ');
        html += `<button type="button" class="${cls.join(' ')}" data-stage-index="${idx}" title="Stufe ${bkmpIdleFormatStage(idx)}${titleSuffix ? ' (' + titleSuffix + ')' : ''}">${isBoss ? '👑 ' : ''}${bkmpIdleFormatStage(idx)}${isHighest ? ' ⭐' : ''}</button>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }
  body.innerHTML = html;
}

function bkmpIdleOpenStagePicker() {
  if (!bkmpIdleState) return;
  /* Kein Stufenwechsel waehrend das Vorbereitungs-Popup eines Event-
     Drachen auf Bestaetigung wartet - siehe bkmpIdleJumpToStage(). Das
     Popup selbst gar nicht erst oeffnen, statt es beim Klick auf eine
     Stufe einfach wirkungslos wieder zu schliessen (verwirrend). */
  if (bkmpIdleEventPauseActive) return;
  bkmpIdleRenderStagePickerBody();
  const overlay = document.getElementById('idleStagePickerOverlay');
  if (overlay) overlay.classList.add('visible');
}

function bkmpIdleCloseStagePicker() {
  const overlay = document.getElementById('idleStagePickerOverlay');
  if (overlay) overlay.classList.remove('visible');
}

function bkmpIdleWireStagePicker() {
  const body = document.getElementById('idleStagePickerBody');
  if (body) {
    body.addEventListener('click', e => {
      const btn = e.target.closest('[data-stage-index]');
      if (!btn) return;
      bkmpIdleJumpToStage(Number(btn.dataset.stageIndex));
      bkmpIdleCloseStagePicker();
    });
  }
  const overlay = document.getElementById('idleStagePickerOverlay');
  if (overlay) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) bkmpIdleCloseStagePicker();
    });
  }
  const closeX = document.getElementById('idleStagePickerCloseX');
  if (closeX) closeX.addEventListener('click', bkmpIdleCloseStagePicker);
  const closeBtn = document.getElementById('idleStagePickerCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', bkmpIdleCloseStagePicker);
}

function bkmpIdleLog(msg) {
  const log = document.getElementById('idleDorfLog');
  if (!log) return;
  const line = document.createElement('div');
  line.className = 'idle-dorf-log-line';
  line.textContent = msg;
  log.prepend(line);
  while (log.children.length > 20) log.removeChild(log.lastChild);
}

/* ---------------- Rendering: Upgrades-Tab ---------------- */

function bkmpIdleBuyUpgrade(id) {
  const def = BKMP_IDLE_UPGRADES.find(u => u.id === id);
  if (!def || !bkmpIdleState) return;
  const purchases = bkmpIdleState.upgrade_purchases || (bkmpIdleState.upgrade_purchases = {});
  const level = Number(purchases[id] || 0);
  if (level >= def.maxLevel) return;
  const cost = bkmpIdleUpgradeCost(def, level);
  if ((bkmpIdleState[def.resource] || 0) < cost) return;
  bkmpIdleState[def.resource] -= cost;
  purchases[id] = level + 1;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderUpgradesPanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

function bkmpIdleRenderUpgradesPanel() {
  const panel = document.getElementById('idlePanelUpgrades');
  if (!panel || !bkmpIdleState) return;
  const purchases = bkmpIdleState.upgrade_purchases || {};
  panel.innerHTML = `<div class="idle-upgrade-grid">${BKMP_IDLE_UPGRADES.map(def => {
    const level = Number(purchases[def.id] || 0);
    const maxed = level >= def.maxLevel;
    const cost = maxed ? 0 : bkmpIdleUpgradeCost(def, level);
    const affordable = !maxed && (bkmpIdleState[def.resource] || 0) >= cost;
    return `
      <div class="idle-upgrade-card">
        <div class="idle-upgrade-icon">${def.icon}</div>
        <div class="idle-upgrade-name">${escapeHtml(def.name)} <span class="idle-upgrade-level">Lv.${level}${maxed ? ' (Max)' : '/' + def.maxLevel}</span></div>
        <div class="idle-upgrade-desc">${escapeHtml(def.desc)}</div>
        <button type="button" class="btn-ja idle-upgrade-buy" data-upgrade-id="${def.id}" ${maxed || !affordable ? 'disabled' : ''}>
          ${maxed ? 'Maximal' : `${bkmpIdleResourceEmoji(def.resource)} ${bkmpIdleFormatNumber(cost)}`}
        </button>
      </div>`;
  }).join('')}</div>`;
  panel.querySelectorAll('.idle-upgrade-buy').forEach(btn => btn.addEventListener('click', () => bkmpIdleBuyUpgrade(btn.dataset.upgradeId)));
}

/* ---------------- Rendering: Skilltree-Tab ---------------- */

/* Tiefe eines Knotens = Anzahl Voraussetzungs-Schritte bis zur Wurzel
   (Knoten ohne requires_node_id). Bestimmt, in welcher Baum-Reihe der
   Knoten gezeichnet wird - Wurzeln oben (Tiefe 0), tiefere Voraussetzungs-
   Ketten darunter. Schutz gegen Ringverweise per seen-Set, falls
   Admin-Daten versehentlich einen Zyklus enthalten. */
function bkmpIdleSkillNodeDepth(node, allNodes) {
  let depth = 0;
  let current = node;
  const seen = new Set();
  while (current && current.requires_node_id && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = allNodes.find(n => n.id === current.requires_node_id);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

/* Zeichnet Verbindungslinien zwischen Eltern-/Kind-Knoten als SVG-Overlay
   ueber dem Baum - nachtraeglich per getBoundingClientRect(), weil die
   Knoten-Positionen erst nach dem eigentlichen HTML-Rendering feststehen
   (Zeilenumbrueche/Breite haengen vom tatsaechlichen Layout ab, nicht
   vorher berechenbar). Linien werden "aktiv" (Gold) gezeichnet, sobald das
   Kind mindestens 1 Rang hat - vorher dezent/grau. */
function bkmpIdleDrawSkillTreeLines(treeEl) {
  const svg = treeEl.querySelector('.idle-skilltree-lines');
  if (!svg) return;
  const containerRect = treeEl.getBoundingClientRect();
  svg.setAttribute('width', containerRect.width);
  svg.setAttribute('height', containerRect.height);
  svg.innerHTML = '';
  treeEl.querySelectorAll('[data-node-id]').forEach(nodeEl => {
    const parentId = nodeEl.dataset.requiresNodeId;
    if (!parentId) return;
    const parentEl = treeEl.querySelector(`[data-node-id="${parentId}"]`);
    if (!parentEl) return;
    const childRect = nodeEl.getBoundingClientRect();
    const parentRect = parentEl.getBoundingClientRect();
    const x1 = parentRect.left - containerRect.left + parentRect.width / 2;
    const y1 = parentRect.top - containerRect.top + parentRect.height;
    const x2 = childRect.left - containerRect.left + childRect.width / 2;
    const y2 = childRect.top - containerRect.top;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', 'idle-skilltree-line' + (nodeEl.classList.contains('ranked') ? ' unlocked' : ''));
    svg.appendChild(line);
  });
}

/* Welche Zweige gerade aufgeklappt sind - persistiert ueber wiederholte
   Render-Aufrufe hinweg (nach jedem +1-Klick und nach Reset wird die ganze
   Panel-HTML neu gebaut), damit ein einmal manuell geoeffneter/geschlossener
   Zweig nicht bei der naechsten Punktevergabe wieder zuklappt. null = noch
   nie initialisiert -> beim allerersten Rendern wird automatisch der erste
   Zweig mit sofort ausgebbaren Punkten aufgeklappt (das war genau das
   gemeldete Problem: Punkte in weiter unten liegenden Zweigen wurden bei
   der alten, immer volltaendig ausgeklappten Ansicht leicht uebersehen). */
let bkmpIdleSkillBranchOpenState = null;

function bkmpIdleRenderSkilltreePanel() {
  const panel = document.getElementById('idlePanelSkilltree');
  if (!panel || !bkmpIdleState) return;
  if (!bkmpIdleSkillDefs.length) { panel.innerHTML = '<p class="empty-hint">Skilltree wird bald verfügbar sein.</p>'; return; }
  const alloc = bkmpIdleState.skill_allocations || {};

  const branches = BKMP_IDLE_BRANCH_ORDER.map(branch => {
    const nodes = bkmpIdleSkillDefs.filter(n => n.branch === branch).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    if (!nodes.length) return null;
    const withDepth = nodes.map(node => ({ node, depth: bkmpIdleSkillNodeDepth(node, nodes) }));
    const maxDepth = Math.max(0, ...withDepth.map(n => n.depth));
    const rows = [];
    for (let d = 0; d <= maxDepth; d++) rows.push(withDepth.filter(n => n.depth === d).map(n => n.node));
    const investedRanks = nodes.reduce((sum, n) => sum + Number(alloc[n.id] || 0), 0);
    const maxRanks = nodes.reduce((sum, n) => sum + Number(n.max_rank || 0), 0);
    const hasAllocatable = nodes.some(n => bkmpIdleCanAllocateSkill(n));
    return { branch, nodes, rows, investedRanks, maxRanks, hasAllocatable };
  }).filter(Boolean);

  if (!bkmpIdleSkillBranchOpenState) {
    bkmpIdleSkillBranchOpenState = {};
    const autoOpen = branches.find(b => b.hasAllocatable) || branches[0];
    if (autoOpen) bkmpIdleSkillBranchOpenState[autoOpen.branch] = true;
  }

  panel.innerHTML = `
    <div class="idle-skillpoints-row">
      <p class="idle-skillpoints-hint">Verfügbare Skillpunkte: <strong>${bkmpIdleState.skill_points_available}</strong></p>
      <button type="button" class="btn-nein idle-skilltree-help-btn" id="idleSkilltreeHelpBtn">❓ Hilfe</button>
      ${(() => {
        const cooldownMs = bkmpIdleSkilltreeResetCooldownMsLeft();
        if (cooldownMs > 0) {
          const totalMinutes = Math.ceil(cooldownMs / 60000);
          const h = Math.floor(totalMinutes / 60);
          const m = totalMinutes % 60;
          return `<button type="button" class="btn-nein idle-skilltree-reset-btn" disabled>🔄 Reset in ${h}h ${m}min</button>`;
        }
        return `<button type="button" class="btn-nein idle-skilltree-reset-btn" id="idleSkilltreeResetBtn">🔄 Zurücksetzen</button>`;
      })()}
    </div>
    ${branches.map(({ branch, nodes, rows, investedRanks, maxRanks, hasAllocatable }) => {
      const isOpen = !!bkmpIdleSkillBranchOpenState[branch];
      return `<div class="idle-skill-branch ${isOpen ? 'expanded' : ''} ${hasAllocatable ? 'has-available' : ''}">
        <button type="button" class="idle-skill-branch-header" data-branch-toggle="${branch}" aria-expanded="${isOpen}">
          <span class="idle-skill-branch-name">${BKMP_IDLE_BRANCH_LABELS[branch] || branch}</span>
          <span class="idle-skill-branch-progress">${investedRanks}/${maxRanks} Ränge</span>
          ${hasAllocatable ? '<span class="idle-skill-branch-pulse" title="Hier kannst du gerade einen Punkt ausgeben!"></span>' : ''}
          <span class="idle-skill-branch-chevron">▾</span>
        </button>
        <div class="idle-skill-branch-collapse">
          <div class="idle-skill-branch-collapse-inner">
            <div class="idle-skilltree-tree">
              <svg class="idle-skilltree-lines"></svg>
              ${rows.map(rowNodes => `
                <div class="idle-skilltree-row">
                  ${rowNodes.map(node => {
                    const rank = Number(alloc[node.id] || 0);
                    const canAllocate = bkmpIdleCanAllocateSkill(node);
                    const maxed = rank >= node.max_rank;
                    const parentNode = node.requires_node_id ? nodes.find(n => n.id === node.requires_node_id) : null;
                    return `
                      <div class="idle-skill-node ${rank > 0 ? 'ranked' : ''} ${maxed ? 'maxed' : ''} ${canAllocate && rank === 0 ? 'can-allocate' : ''} ${!node.requires_node_id ? 'is-root' : ''}" data-node-id="${node.id}" ${node.requires_node_id ? `data-requires-node-id="${node.requires_node_id}"` : ''}>
                        <div class="idle-skill-node-icon">${node.icon || '✨'}</div>
                        <div class="idle-skill-node-name">${escapeHtml(node.name)}</div>
                        <div class="idle-skill-node-desc">${escapeHtml(node.description || '')}</div>
                        ${parentNode ? `<div class="idle-skill-node-requires">Braucht ${escapeHtml(parentNode.name)} Rang ${node.requires_rank}</div>` : ''}
                        <div class="idle-skill-node-rank">Rang ${rank}/${node.max_rank}</div>
                        <button type="button" class="btn-ja idle-skill-node-btn" data-node-id="${node.id}" ${!canAllocate ? 'disabled' : ''}>
                          ${maxed ? 'Max' : `+1 (${node.cost_per_rank} 🔹)`}
                        </button>
                      </div>`;
                  }).join('')}
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
    }).join('')}`;
  panel.querySelectorAll('.idle-skill-node-btn').forEach(btn => btn.addEventListener('click', () => bkmpIdleAllocateSkill(btn.dataset.nodeId)));
  /* Verbindungslinien nur fuer bereits aufgeklappte Zweige zeichnen - bei
     collapsed (grid-template-rows:0fr) liefert getBoundingClientRect()
     ueberall (0,0), das Nachzeichnen passiert stattdessen im Toggle-Handler
     unten, sobald ein Zweig tatsaechlich geoeffnet wird. */
  panel.querySelectorAll('.idle-skill-branch.expanded .idle-skilltree-tree').forEach(treeEl => bkmpIdleDrawSkillTreeLines(treeEl));
  panel.querySelectorAll('.idle-skill-branch-header').forEach(header => header.addEventListener('click', () => {
    const branch = header.dataset.branchToggle;
    const branchEl = header.closest('.idle-skill-branch');
    const nowOpen = !branchEl.classList.contains('expanded');
    bkmpIdleSkillBranchOpenState[branch] = nowOpen;
    branchEl.classList.toggle('expanded', nowOpen);
    header.setAttribute('aria-expanded', String(nowOpen));
    if (nowOpen) {
      const treeEl = branchEl.querySelector('.idle-skilltree-tree');
      /* Erst nach der CSS-Aufklapp-Transition zeichnen, sonst hat der
         Baum beim Messen noch die Hoehe 0 (Grid-Zeile startet bei 0fr). */
      setTimeout(() => bkmpIdleDrawSkillTreeLines(treeEl), 360);
    }
  }));
  const resetBtn = document.getElementById('idleSkilltreeResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', bkmpIdleResetSkilltree);
  const helpBtn = document.getElementById('idleSkilltreeHelpBtn');
  if (helpBtn) helpBtn.addEventListener('click', bkmpIdleOpenSkillHelp);
}

/* ---------------- Skilltree-Hilfe-Fenster ---------------- */

/* Wandelt effect_type + Gesamtwert (effect_value_per_rank * max_rank, bei
   extra_archer/ballista_unlock zusaetzlich mit dem echten Multiplikator aus
   bkmpIdleRecomputeEffectiveStats) in eine lesbare "bei Max-Rang"-Zeile um.
   Bewusst dieselbe Umrechnung wie dort - wenn sich die Kampfformel je
   aendert, muss nur diese eine Stelle mitgepflegt werden. */
function bkmpIdleSkillEffectAtMaxLabel(node) {
  const total = Number(node.effect_value_per_rank || 0) * Number(node.max_rank || 0);
  const fmt = v => (Math.round(v * 10) / 10).toString().replace('.', ',');
  switch (node.effect_type) {
    case 'attack_pct': case 'attack_speed_pct': case 'crit_chance_pct': case 'crit_chance_flat':
    case 'crit_damage_pct': case 'crit_damage_flat': case 'hp_pct': case 'defense_pct':
    case 'gold_prod_pct': case 'gold_find_pct': case 'xp_pct': case 'loot_chance_pct':
    case 'wood_prod_pct': case 'stone_prod_pct': case 'offline_income_pct': case 'click_damage_pct':
    case 'rune_luck_pct': {
      const labels = {
        attack_pct: 'Angriff', attack_speed_pct: 'Tempo', crit_chance_pct: 'Krit-Chance', crit_chance_flat: 'Krit-Chance',
        crit_damage_pct: 'Krit-Schaden', crit_damage_flat: 'Krit-Schaden', hp_pct: 'Leben', defense_pct: 'Verteidigung',
        gold_prod_pct: 'Gold', gold_find_pct: 'Gold', xp_pct: 'XP', loot_chance_pct: 'Lootchance',
        wood_prod_pct: 'Holz', stone_prod_pct: 'Stein', offline_income_pct: 'Offline-Effizienz', click_damage_pct: 'Klick-Schaden',
        rune_luck_pct: 'Runenglück'
      };
      return `bei Max: +${fmt(total)}% ${labels[node.effect_type]}`;
    }
    case 'attack_flat': return `bei Max: +${fmt(total)} Angriff (fest)`;
    case 'hp_flat': return `bei Max: +${fmt(total)} Leben (fest)`;
    case 'defense_flat': return `bei Max: +${fmt(total)} Verteidigung (fest)`;
    case 'extra_archer': return `bei Max: +${fmt(total * 6)}% Angriff`;
    case 'ballista_unlock': return `bei Max: +${fmt(total * 8)} Angriff (fest)`;
    case 'elem_fire': return `bei Max: ${fmt(Math.min(60, total))}% Feuer-Chance`;
    case 'elem_ice': return `bei Max: ${fmt(Math.min(60, total))}% Einfrier-Chance`;
    case 'elem_lightning': return `bei Max: ${fmt(Math.min(60, total))}% Blitz-Chance`;
    case 'magic_resist_pct': return `bei Max: +${fmt(Math.min(75, total))}% Schadensreduktion`;
    case 'shield_regen': case 'repair_speed_pct': case 'heal_pct':
      return 'Teil der Dorf-Regeneration (siehe Hinweis unten)';
    default: return '';
  }
}

function bkmpIdleOpenSkillHelp() {
  bkmpIdleRenderSkillHelp();
  const overlay = document.getElementById('idleSkillHelpOverlay');
  if (overlay) { overlay.classList.add('visible'); document.body.classList.add('modal-open'); }
}

function bkmpIdleRenderSkillHelp() {
  const list = document.getElementById('idleSkillHelpList');
  if (!list) return;
  if (!bkmpIdleSkillDefs.length) { list.innerHTML = '<p class="empty-hint">Skilltree wird bald verfügbar sein.</p>'; return; }
  list.innerHTML = BKMP_IDLE_BRANCH_ORDER.map(branch => {
    const nodes = bkmpIdleSkillDefs.filter(n => n.branch === branch).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    if (!nodes.length) return '';
    const rows = nodes.map(node => `
      <div class="skillhelp-row">
        <span class="skillhelp-icon">${node.icon || '✨'}</span>
        <div class="skillhelp-body">
          <div class="skillhelp-name">${escapeHtml(node.name)}</div>
          <div class="skillhelp-desc">${escapeHtml(node.description || '')}</div>
        </div>
        <div class="skillhelp-meta">
          <span class="skillhelp-badge">${bkmpIdleSkillEffectAtMaxLabel(node)}</span>
          <span class="skillhelp-cost">Max ${node.max_rank} · ${node.cost_per_rank}🔹/Rang</span>
        </div>
      </div>`).join('');
    return `
      <div class="skillhelp-branch">
        <div class="skillhelp-branch-title">${BKMP_IDLE_BRANCH_LABELS[branch] || branch}</div>
        ${rows}
      </div>`;
  }).join('') + `
    <div class="skillhelp-note">
      <strong>Dorf-Regeneration:</strong> Schildgenerator (Burg), Reparaturtempo (Burg) und Heilung (Magie) speisen gemeinsam die passive Leben-Regeneration pro Kampf-Tick - alle drei maximiert ergeben zusammen ca. 15% Leben-Regeneration pro Tick.<br>
      <strong>Krit-Schaden-Stapel:</strong> Brandpfeile (Dorf) und Dimensionsportal (Magie) addieren sich beide auf denselben Wert.
    </div>`;
}

/* ---------------- Rendering: Sammlung- / Erfolge-Tab (Shortcuts ins bestehende System) ---------------- */

/* Menschenlesbare Beschriftung fuer einen Titel-Bonus. Nur hier im
   Sammlung-Tab gebraucht - im allgemeinen Kosmetik-/Erfolge-Profil bleiben
   Titel absichtlich ohne Zahlenangabe. */
const BKMP_IDLE_EFFECT_LABELS = {
  attack_flat: v => `+${v} Angriff`,
  defense_flat: v => `+${v} Verteidigung`,
  hp_flat: v => `+${v} Leben`,
  crit_chance_flat: v => `+${v}% Krit-Chance`,
  gold_prod_pct: v => `+${v}% Gold`,
  xp_pct: v => `+${v}% XP`,
  loot_chance_pct: v => `+${v}% Lootchance`
};
function bkmpIdleFormatTitleBonus(title) {
  const fmt = BKMP_IDLE_EFFECT_LABELS[title.effectType];
  return fmt ? fmt(title.effectValue) : '';
}

/* Baut die komplette Titel-Boni-Liste (Ueberschrift + Zaehler + Hinweis +
   alle Zeilen) - wird sowohl im Sammlung- als auch im Erfolge-Tab gezeigt,
   damit man sie nicht extra suchen muss, egal welchen der beiden Tabs man
   zuerst aufmacht. */
function bkmpIdleBuildTitleBonusListHtml() {
  const ctx = bkmpIdleGetAchievementContextFields();
  const bonusTitles = window.BKMP_IDLE_TITLES.filter(t => t.effectType);
  const unlockedCount = bonusTitles.filter(t => t.unlockCustom(ctx)).length;
  const newBadge = typeof bkmpNewBadgeChecker === 'function' ? bkmpNewBadgeChecker('idletitles') : () => '';
  const rows = bonusTitles.map(title => {
    const unlocked = title.unlockCustom(ctx);
    return `
      <div class="achievement-row ${unlocked ? 'unlocked' : 'locked'}">
        ${newBadge(title.id)}
        <span class="achievement-icon">${unlocked ? '✅' : '🔒'}</span>
        <div class="achievement-body">
          <div class="achievement-title">${escapeHtml(title.name)}</div>
          <div class="achievement-desc">${escapeHtml(title.desc)}</div>
        </div>
        <span class="idle-title-bonus ${unlocked ? '' : 'idle-title-bonus-hidden'}">${unlocked ? escapeHtml(bkmpIdleFormatTitleBonus(title)) : '???'}</span>
      </div>`;
  }).join('');
  if (typeof bkmpMarkAllSeen === 'function') bkmpMarkAllSeen('idletitles', bonusTitles.map(t => t.id));
  return `
    <h4 class="idle-sammlung-subheading">🏅 Titel-Boni <span class="idle-sammlung-count">${unlockedCount}/${bonusTitles.length}</span></h4>
    <p class="idle-panel-hint">Jeder freigeschaltete Titel gibt einen dauerhaften Bonus - egal, welchen Titel du gerade als Namenszusatz trägst. Freigeschaltet bleibt freigeschaltet.</p>
    <div class="idle-title-bonus-list">${rows}</div>
  `;
}

function bkmpIdleRenderSammlungPanel() {
  const panel = document.getElementById('idlePanelSammlung');
  if (!panel) return;
  panel.innerHTML = `
    <p class="idle-panel-hint">Deine 18 Idle-Dorf-Kosmetiken schaltest du durch Fortschritt frei und findest sie in deinem Erfolge-Fenster unter „Kosmetik".</p>
    <button type="button" class="btn-ja" id="idleOpenCosmeticsBtn">Kosmetik öffnen</button>
    ${bkmpIdleBuildTitleBonusListHtml()}
  `;
  const btn = document.getElementById('idleOpenCosmeticsBtn');
  if (btn) btn.addEventListener('click', () => {
    bkmpIdleCloseModal();
    const mcNameBadge = document.getElementById('mcNameBadge');
    if (mcNameBadge) mcNameBadge.click();
    window.setTimeout(() => { const cosBtn = document.getElementById('achievementsSubtabCosmetics'); if (cosBtn) cosBtn.click(); }, 60);
  });
}

function bkmpIdleRenderErfolgePanel() {
  const panel = document.getElementById('idlePanelErfolge');
  if (!panel) return;
  panel.innerHTML = `
    <p class="idle-panel-hint">Deine Idle-Dorf-Erfolge findest du in deinem Erfolge-Fenster unter der Kategorie „Idle Dorf".</p>
    <button type="button" class="btn-ja" id="idleOpenAchievementsBtn">Erfolge öffnen</button>
    ${bkmpIdleBuildTitleBonusListHtml()}
  `;
  const btn = document.getElementById('idleOpenAchievementsBtn');
  if (btn) btn.addEventListener('click', () => {
    bkmpIdleCloseModal();
    const mcNameBadge = document.getElementById('mcNameBadge');
    if (mcNameBadge) mcNameBadge.click();
  });
}

/* ---------------- Rendering: Bestenliste-Tab ---------------- */

const BKMP_IDLE_LEADERBOARD_TABS = [
  { id: 'level', label: 'Top Level', field: 'level', format: v => `Level ${v}` },
  { id: 'gold', label: 'Top Gold', field: 'total_gold_earned', format: v => bkmpIdleFormatNumber(v) + ' 💰' },
  { id: 'dragons', label: 'Top Drachen', field: 'dragon_kills', format: v => bkmpIdleFormatNumber(v) + ' 🐉' },
  { id: 'playtime', label: 'Top Spielzeit', field: 'playtime_seconds', format: v => Math.round(v / 60) + ' Min.' },
  { id: 'lifetime_stages', label: 'Top Insgesamte Stufen', field: 'lifetime_stages', format: v => bkmpIdleFormatNumber(v) + ' Stufen' },
  { id: 'prestige', label: 'Top Prestige', field: 'prestige_level', format: v => '🌌 Prestige-Stufe ' + v },
  { id: 'raid_damage', label: '🐉 Raid-Schaden', isRaid: true },
  { id: 'raid_bosses', label: '🐉 Raid-Bosse', isRaid: true },
  { id: 'raid_joined', label: '🐉 Raid-Teilnahmen', isRaid: true },
  { id: 'raid_best', label: '🐉 Bester Raid', isRaid: true }
];
let bkmpIdleActiveLeaderboardTab = 'level';
let bkmpIdleLeaderboardStats = [];

async function bkmpIdleRenderBestenlistePanel() {
  const tabsEl = document.getElementById('idleLeaderboardTabs');
  const listEl = document.getElementById('idleLeaderboardList');
  if (!tabsEl || !listEl) return;
  if (!tabsEl.dataset.bound) {
    tabsEl.innerHTML = BKMP_IDLE_LEADERBOARD_TABS.map(t => `<button type="button" class="idle-dorf-tab ${t.id === bkmpIdleActiveLeaderboardTab ? 'active' : ''}" data-idle-lb="${t.id}">${t.label}</button>`).join('');
    tabsEl.dataset.bound = '1';
    tabsEl.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      bkmpIdleActiveLeaderboardTab = btn.dataset.idleLb;
      tabsEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      bkmpIdleRenderLeaderboardList();
    }));
  }
  listEl.innerHTML = '<p class="empty-hint">Lädt...</p>';
  try {
    if (typeof loadIdleLeaderboardStats === 'function') bkmpIdleLeaderboardStats = (await loadIdleLeaderboardStats()) || [];
  } catch (e) { console.warn('Idle Dorf: Bestenliste konnte nicht geladen werden.', e); }
  bkmpIdleRenderLeaderboardList();
}

function bkmpIdleRenderLeaderboardList() {
  const listEl = document.getElementById('idleLeaderboardList');
  if (!listEl) return;
  const tab = BKMP_IDLE_LEADERBOARD_TABS.find(t => t.id === bkmpIdleActiveLeaderboardTab) || BKMP_IDLE_LEADERBOARD_TABS[0];
  if (tab.isRaid) { bkmpRaidRenderLeaderboard(); return; }
  const myName = (typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '').trim().toLowerCase();
  const rows = [...bkmpIdleLeaderboardStats]
    .filter(s => Number(s[tab.field] || 0) > 0)
    .sort((a, b) => Number(b[tab.field] || 0) - Number(a[tab.field] || 0))
    .slice(0, 100);
  if (!rows.length) { listEl.innerHTML = '<p class="empty-hint">Noch keine Daten für diese Bestenliste.</p>'; return; }
  listEl.innerHTML = rows.map((row, i) => {
    const isMe = Boolean(myName) && (row.display_name || '').trim().toLowerCase() === myName;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `<div class="leaderboard-row ${isMe ? 'is-me' : ''}"><span class="leaderboard-rank">${medal}</span><span class="leaderboard-name"><span class="leaderboard-name-text">${escapeHtml(row.display_name)}</span></span><span class="leaderboard-value">${tab.format(Number(row[tab.field] || 0))}</span></div>`;
  }).join('');
}

/* ---------------- Offline-Fortschritt ---------------- */

async function bkmpIdleClaimOfflineProgress(name) {
  try {
    const res = await fetch('/api/claim-idle-offline-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : null;
  } catch (e) {
    console.warn('Idle Dorf: Offline-Fortschritt konnte nicht abgerufen werden.', e);
    return null;
  }
}

function bkmpIdleApplyOfflineResult(result) {
  if (!result || !result.newTotals || !bkmpIdleState) return;
  Object.assign(bkmpIdleState, result.newTotals);
}

function bkmpIdleShowOfflineCard(result) {
  const card = document.getElementById('idleDorfOfflineCard');
  if (!card) return;
  if (!result || !result.rewards || !result.elapsedSeconds || result.elapsedSeconds < 60) { card.style.display = 'none'; return; }
  const r = result.rewards;
  const mins = Math.round(result.elapsedSeconds / 60);
  card.innerHTML = `
    <button type="button" class="idle-offline-close" id="idleOfflineCardClose" aria-label="Schließen">&times;</button>
    <strong>Während deiner Abwesenheit... (${mins} Min.)</strong>
    <div class="idle-offline-rewards">
      <span>💰 +${bkmpIdleFormatNumber(r.gold)}</span><span>✨ +${bkmpIdleFormatNumber(r.xp)}</span>
      <span>🌳 +${bkmpIdleFormatNumber(r.wood)}</span><span>🗿 +${bkmpIdleFormatNumber(r.stone)}</span>
      <span>💎 +${bkmpIdleFormatNumber(r.crystals)}</span><span>🧪 +${bkmpIdleFormatNumber(r.essence)}</span>
      <span>🐉 ${bkmpIdleFormatNumber(r.dragonKills || 0)} besiegt</span>
      ${r.levelsGained ? `<span>⬆️ +${r.levelsGained} Level</span>` : ''}
    </div>`;
  card.style.display = '';
  const closeBtn = document.getElementById('idleOfflineCardClose');
  if (closeBtn) closeBtn.addEventListener('click', () => { card.style.display = 'none'; });
}

/* ---------------- Sync ---------------- */

function bkmpIdleQueueSync() {
  bkmpIdleSyncPending = true;
  if (bkmpIdleSyncTimer) return;
  bkmpIdleSyncTimer = window.setTimeout(() => { bkmpIdleSyncTimer = null; bkmpIdleFlushSync(); }, 4000);
}

async function bkmpIdleFlushSync() {
  if (!bkmpIdleSyncPending || !bkmpIdleState) return;
  bkmpIdleSyncPending = false;
  bkmpIdleState.playtime_seconds = Math.round(Number(bkmpIdleState.playtime_seconds || 0));
  bkmpIdleState.last_seen_at = new Date().toISOString();
  try {
    if (typeof upsertIdlePlayerState === 'function') await upsertIdlePlayerState(bkmpIdleState);
  } catch (e) {
    console.warn('Idle Dorf: Speichern fehlgeschlagen.', e);
  }
}

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

let bkmpPrestigeSaveTimer = null;
function bkmpPrestigeQueueSave() {
  if (bkmpPrestigeSaveTimer) return;
  bkmpPrestigeSaveTimer = window.setTimeout(async () => {
    bkmpPrestigeSaveTimer = null;
    if (!bkmpPrestigeState) return;
    try { if (typeof saveIdlePrestigeState === 'function') await saveIdlePrestigeState(bkmpPrestigeState); }
    catch (e) { console.warn('Prestige: Speichern fehlgeschlagen (Migration ausgefuehrt?).', e); }
  }, 1500);
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
  const stage = Number(bkmpIdleState.highest_dragon_index || 0);
  const bonusPct = bkmpPrestigeState ? (bkmpPrestigeEffectTotals(bkmpPrestigeState.prestige_allocations).prestige_point_bonus_pct || 0) : 0;
  const pointsGained = Math.max(1, Math.round(bkmpPrestigePointsForStage(stage) * (1 + bonusPct / 100)));
  const runeCountBeforePrestige = bkmpIdlePlayerRunes.length;
  const confirmed = await bkmpConfirmDialog(
    '🌌 Jetzt aufsteigen?',
    `Level, Gold, Rohstoffe, Skilltree, Upgrades und deine aktuelle Stufen-Position werden zurückgesetzt.\n\n` +
    `Du erhältst dafür ${pointsGained} Prestige-Punkte (dauerhaft, für den permanenten Bonusbaum) ` +
    `und einen dauerhaften +5%-Bonus auf Angriff/Leben/Gold/XP.\n\n` +
    `⚠️ Deine komplette Runen-Sammlung${runeCountBeforePrestige ? ` (${runeCountBeforePrestige} Runen inkl. Stufen/Sub-Stats)` : ''} geht dabei verloren!\n\n` +
    `Erfolge, Titel, Kosmetiken, deine Gesamtzahl besiegter Drachen/Bosse und deine insgesamt erreichten Stufen bleiben erhalten.`,
    'Jetzt aufsteigen',
    'Abbrechen'
  );
  if (!confirmed) return;

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
    /* NACHBESSERUNG (Nutzerwunsch): Runen gehen ab sofort beim Prestige-
       Aufstieg verloren - kehrt die fruehere Entscheidung vom 14.07. (Runen
       bewusst behalten, um Frustration zu vermeiden) bewusst wieder um. Lokal
       UND in der DB loeschen (nicht nur den Speicher leeren), sonst wuerden
       beim naechsten Laden die alten Runen einfach wieder auftauchen. */
    const runeIdsToDelete = bkmpIdlePlayerRunes.map(r => r.id).filter(Boolean);
    bkmpIdlePlayerRunes = [];
    bkmpIdlePendingRuneDrops = [];
    bkmpRuneCurrentlyViewing = null;
    bkmpRuneFuseSelection = null;
    if (runeIdsToDelete.length && typeof deletePlayerRunes === 'function') deletePlayerRunes(runeIdsToDelete).catch(() => {});

    if (!bkmpPrestigeState) bkmpPrestigeState = { name_key: bkmpIdleState.name_key, display_name: bkmpIdleState.display_name, prestige_level: 0, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
    bkmpPrestigeState.prestige_level = Number(bkmpPrestigeState.prestige_level || 0) + 1;
    bkmpPrestigeState.prestige_points = Number(bkmpPrestigeState.prestige_points || 0) + pointsGained;

    bkmpIdleRecomputeEffectiveStats();
    bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;
    bkmpIdleSpawnDragon();
    bkmpIdleRenderStageBar();
    bkmpIdleUpdateVillageHpBar();
    bkmpIdleRenderHud();
    bkmpIdleLog(`🌌 Aufstieg #${bkmpPrestigeState.prestige_level}! +${pointsGained} Prestige-Punkte, dauerhafter +5%-Bonus.`);

    await bkmpIdleFlushSyncNow();
    try { if (typeof saveIdlePrestigeState === 'function') await saveIdlePrestigeState(bkmpPrestigeState); }
    catch (e) { console.warn('Prestige: Speichern fehlgeschlagen (Migration ausgefuehrt?).', e); }

    bkmpIdleRenderActiveTabContent();
  } finally {
    bkmpPrestigeSaving = false;
  }
}

/* Erzwingt ein sofortiges Speichern statt auf den 4s-Debounce zu warten -
   nach einem Aufstieg soll der zurueckgesetzte Stand nicht verloren gehen,
   falls direkt danach das Fenster/der Tab geschlossen wird. */
async function bkmpIdleFlushSyncNow() {
  bkmpIdleSyncPending = true;
  if (bkmpIdleSyncTimer) { window.clearTimeout(bkmpIdleSyncTimer); bkmpIdleSyncTimer = null; }
  await bkmpIdleFlushSync();
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

/* ---------------- Runen ----------------
   Echtes Drop-/Ausruestungs-/Verschmelzungs-System (loest die vorherige
   reine Design-Vorschau ab, siehe supabase-idle-runes.sql). Jede Rune ist
   eine einzelne, individuell gewuerfelte Zeile in idle_player_runes -
   Spieler sammeln beliebig viele, ruesten pro Slot (=Rune-Typ) maximal
   eine aus und koennen 3 unausgeruestete gleicher Slot+Seltenheit zu einer
   der naechsten Seltenheitsstufe verschmelzen.

   Die 6 Slots und 5 Seltenheitsstufen (inkl. Farben/Bild-Dateinamen unter
   assets/runes/) waren schon vor diesem Umbau als reine Optik-Vorschau
   angelegt - hier nur mit echter Bedeutung (Kampfwert-Typ) versehen und
   ans echte Drop-/Ausruestungs-System angeschlossen, damit alle bereits
   vorbereiteten Bilder unveraendert weiterverwendet werden. */
/* Cache-Bust fuer die Runen-Bilder selbst (bisher OHNE ?v= verlinkt) -
   noetig, weil alle 30 Bilder am 14.07. nachtraeglich von "loechrigem"
   Alpha-Kanal (kaputt wirkende Transparenz-Speckles im Metallrahmen,
   Spieler-Meldung) bereinigt wurden; ohne Versionsnummer haetten Browser
   mit bereits geladenem Cache weiter die alten, fehlerhaften Bilder
   gezeigt. */
const BKMP_RUNE_IMG_V = '20260714-alphafix1';
window.BKMP_RUNE_SLOTS = [
  { id: 'slot1', name: 'Kraftrune', icon: '⚔️', stat: 'attack_pct', desc: 'Angriff' },
  { id: 'slot2', name: 'Schildrune', icon: '🛡️', stat: 'defense_pct', desc: 'Verteidigung' },
  { id: 'slot3', name: 'Herzrune', icon: '❤️', stat: 'hp_pct', desc: 'Leben' },
  { id: 'slot4', name: 'Zielrune', icon: '🎯', stat: 'crit_chance_pct', desc: 'Krit.-Chance' },
  { id: 'slot5', name: 'Wuchtrune', icon: '💥', stat: 'crit_damage_pct', desc: 'Krit.-Schaden' },
  { id: 'slot6', name: 'Glücksrune', icon: '🍀', stat: 'rune_luck_pct', desc: 'Runen-Fund-Chance' }
];
window.BKMP_RUNE_RARITIES = [
  { id: 'gray', name: 'Gewöhnlich', color: '#9ca3af', mult: 1, sellGold: 15 },
  { id: 'green', name: 'Ungewöhnlich', color: '#4ade80', mult: 1.6, sellGold: 24 },
  { id: 'blue', name: 'Selten', color: '#38bdf8', mult: 2.4, sellGold: 36 },
  { id: 'purple', name: 'Episch', color: '#a78bfa', mult: 3.4, sellGold: 51 },
  { id: 'gold', name: 'Legendär', color: '#facc15', mult: 5, sellGold: 75 }
];

/* Prozent-Positionen der 6 Hex-Rahmen auf circle-empty.png/circle-full.png
   (1254x1254), im Uhrzeigersinn ab oben - rein optisch. */
const BKMP_RUNE_SLOT_POSITIONS = {
  slot1: { top: '15.85%', left: '50%', width: '18.6%', height: '22.1%' },
  slot2: { top: '33.25%', left: '80.05%', width: '16.5%', height: '22.1%' },
  slot3: { top: '64.95%', left: '80.05%', width: '16.5%', height: '20.9%' },
  slot4: { top: '81.75%', left: '49.95%', width: '17.5%', height: '20.3%' },
  slot5: { top: '64.9%', left: '19.85%', width: '16.7%', height: '21%' },
  slot6: { top: '33.35%', left: '19.85%', width: '17.3%', height: '20.6%' }
};

/* Wert-Spannen je Stat-Schluessel + Seltenheit, zentriert um den frueheren
   "Beispielwert" (2 * rarity.mult) aus der Design-Vorschau, damit die vorher
   schon gezeigten Zahlen ungefaehr stimmen bleiben. Krit-Chance nutzt
   deutlich kleinere Zahlen (Prozentpunkte auf einer 0-75-Skala, kein
   Multiplikator wie bei den anderen 5 Stats). Nach Stat-Schluessel statt nur
   Slot-Id, weil ab jetzt auch Sub-Stats (bkmpIdleRollSubstatValue) aus
   diesem Topf gewuerfelt werden - ein Sub-Stat kann jeden der 6 Werte
   tragen, nicht nur den "eigenen" des jeweiligen Slots. */
const BKMP_RUNE_STAT_BASE = {
  attack_pct: 2, defense_pct: 2, hp_pct: 2, crit_chance_pct: 0.5, crit_damage_pct: 2, rune_luck_pct: 2,
  attack_flat: 5.714, defense_flat: 5.714, hp_flat: 14.286, attack_speed_pct: 2
};
/* Abweichende Variance-Spanne je Stat statt der generischen 0,8-1,2x fuer
   alle - auf Nutzerwunsch (15.07., "Ruhig Legendär Angriff/Verteidigung
   zwischen 7-10 und Leben zwischen 15-35") extra breit fuer hp_flat, damit
   der Sub-Stat-Wert bei Legendaer wirklich zwischen 15 und 35 landen kann
   statt nur 7-10 wie vorher. Nicht gelistete Stats nutzen weiterhin die
   Standard-Spanne (siehe bkmpIdleRuneStatRange). */
const BKMP_RUNE_STAT_VARIANCE = {
  attack_flat: [0.7, 1.0], defense_flat: [0.7, 1.0], hp_flat: [0.6, 1.4]
};
/* Fest-Wert-Varianten (attack_flat/defense_flat/hp_flat) sind dieselben
   Schluessel, die Skilltree/Upgrades/Titel schon nutzen (siehe z.B.
   "Ballisten"-Skillknoten) - koennen jetzt auch als Rune-Sub-Stat kommen.
   Auf Nutzerwunsch bewusst NIEDRIGER gewichtet als die %-Varianten (siehe
   BKMP_RUNE_SUBSTAT_WEIGHTS) und ohne Ausnahme fuer hohe Seltenheiten - "es
   muss auch mit Pech scheiss Runen rauskommen", auch bei Legendaer.
   attack_speed_pct (Angriffstempo) ist ebenfalls ein bereits bestehender,
   generisch verdrahteter Skilltree-Schluessel (verkuerzt tickIntervalMs in
   bkmpIdleRecomputeEffectiveStats) - auf Nutzerwunsch ab sofort auch als
   Rune-Sub-Stat moeglich. */
const BKMP_RUNE_SUBSTAT_WEIGHTS = {
  attack_pct: 16, defense_pct: 16, hp_pct: 16, crit_chance_pct: 12, crit_damage_pct: 12, rune_luck_pct: 10,
  attack_speed_pct: 12, attack_flat: 6, defense_flat: 6, hp_flat: 6
};
const BKMP_RUNE_EXTRA_STAT_META = {
  attack_flat: { icon: '⚔️', desc: 'Angriff (fest)' },
  defense_flat: { icon: '🛡️', desc: 'Verteidigung (fest)' },
  hp_flat: { icon: '❤️', desc: 'Leben (fest)' },
  attack_speed_pct: { icon: '⚡', desc: 'Angriffstempo' }
};
/* Liefert Icon/Beschreibung fuer JEDEN moeglichen Sub-Stat-Schluessel - bei
   den 6 "Haupt"-Stats identisch zum jeweiligen Slot (Kraftrune usw.), sonst
   aus der eigenen kleinen Tabelle, weil die zu keinem Slot als Hauptwert
   gehoeren. */
function bkmpRuneStatMeta(statKey) {
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.stat === statKey);
  if (slot) return { icon: slot.icon, desc: slot.desc };
  return BKMP_RUNE_EXTRA_STAT_META[statKey] || { icon: '✦', desc: statKey };
}
function bkmpRunePickWeightedStat(candidates) {
  const total = candidates.reduce((sum, st) => sum + (BKMP_RUNE_SUBSTAT_WEIGHTS[st] || 1), 0);
  let roll = Math.random() * total;
  for (const st of candidates) {
    roll -= (BKMP_RUNE_SUBSTAT_WEIGHTS[st] || 1);
    if (roll <= 0) return st;
  }
  return candidates[candidates.length - 1];
}
function bkmpIdleRuneStatRange(statKey, rarityId) {
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rarityId);
  if (!rarity) return [0, 0];
  const base = BKMP_RUNE_STAT_BASE[statKey] ?? 2;
  const center = base * rarity.mult;
  const [vLo, vHi] = BKMP_RUNE_STAT_VARIANCE[statKey] || [0.8, 1.2];
  return [Math.round(center * vLo * 100) / 100, Math.round(center * vHi * 100) / 100];
}
function bkmpIdleRuneValueRange(slotId, rarityId) {
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === slotId);
  return bkmpIdleRuneStatRange(slot ? slot.stat : null, rarityId);
}

/* Drop-Gewichtung je Quelle (normaler Kill / Boss-Kill alle 25 Kaempfe) -
   je hoeher die Stufe/der Gegner, desto besser die Chance auf Seltenes.
   Glueck (ausgeruestete Glücksrune) verschiebt das Gewicht zusaetzlich
   weg von "Gewöhnlich" hin zu den selteneren Stufen.

   WICHTIG (Nachbesserung): die Gewichte allein reichten NICHT, um seltene
   Runen wirklich selten zu MACHEN - selbst mit nur 0,2% Gewicht war ein
   Legendaer-Drop bereits in den ersten paar Kaempfen theoretisch moeglich
   (unabhaengig gewuerfelt bei JEDEM Kill, "das Los kennt keine Vorgeschichte"),
   was sich in der Praxis genau so gezeigt hat (Legendaer-Rune bei Stufe
   0-9). Deshalb zusaetzlich eine harte Mindeststufe pro Raritaet: unterhalb
   davon ist diese Raritaet komplett ausgeschlossen (Gewicht 0), nicht nur
   unwahrscheinlich. Verschmelzen (bkmpRuneFuse) ist davon bewusst NICHT
   betroffen - wer sich 3 Epische erspielt/ertauscht hat, darf sie jederzeit
   zu Legendaer verschmelzen, das ist ja schon die Muehe wert gewesen. */
/* NACHBESSERUNG (15.07.): Boss-Drops waren bisher garantiert (100%) - auf
   Nutzerwunsch bewusst zurueckgenommen, Runen sollen insgesamt selten
   bleiben. Weitere Absenkung (15.07., zweite Nachbesserung): 10%/12% waren
   dem Nutzer noch zu hoch - jetzt 5% normal / 10% Boss, Bosse droppen also
   doppelt so oft wie normale Kaempfe statt nur +2 Prozentpunkte. */
const BKMP_RUNE_DROP_CHANCE = { normal: 0.05, boss: 0.10 };
const BKMP_RUNE_DROP_WEIGHTS = {
  normal: [65, 25, 8, 1.8, 0.2],
  boss: [30, 35, 25, 8, 2]
};
const BKMP_RUNE_RARITY_MIN_STAGE = { gray: 0, green: 5, blue: 15, purple: 35, gold: 75 };
/* NACHBESSERUNG (14.07., "Aber Stufe 75 ist nichts?"): die Gating-Stufe kam
   bisher aus highest_dragon_index - das wird bei JEDEM Prestige-Aufstieg
   auf 0 zurueckgesetzt (siehe bkmpIdlePerformPrestige), waehrend
   prestige_stage_offset die vor dem Aufstieg erreichte Hoechststufe dauerhaft
   aufsummiert. Ergebnis: jeder Spieler, der schon einmal aufgestiegen ist,
   galt fuer's Runen-Gating faelschlich wieder als "Stufe 0", egal wie weit
   er vorher gekommen war - deshalb wirkte "Stufe 75" wie eine Wand, die nie
   erreichbar war. Fix: bkmpIdleLifetimeStageCount() (== prestige_stage_offset
   + highest_dragon_index) ist die tatsaechliche Lebenszeit-Bestleistung und
   sinkt nie, auch nicht durch Prestige. */
function bkmpIdleRollRuneRarity(source, luckPct) {
  const weights = BKMP_RUNE_DROP_WEIGHTS[source] || BKMP_RUNE_DROP_WEIGHTS.normal;
  const stage = bkmpIdleLifetimeStageCount();
  const luckFactor = 1 + Math.max(0, Number(luckPct) || 0) / 100;
  const adjusted = window.BKMP_RUNE_RARITIES.map((rarity, i) => {
    if (stage < (BKMP_RUNE_RARITY_MIN_STAGE[rarity.id] || 0)) return 0;
    const w = weights[i];
    return i === 0 ? w : w * luckFactor;
  });
  const total = adjusted.reduce((a, b) => a + b, 0);
  if (total <= 0) return window.BKMP_RUNE_RARITIES[0].id;
  let roll = Math.random() * total;
  for (let i = 0; i < adjusted.length; i++) {
    roll -= adjusted[i];
    if (roll <= 0) return window.BKMP_RUNE_RARITIES[i].id;
  }
  return window.BKMP_RUNE_RARITIES[0].id;
}
function bkmpIdleRollRuneValue(slotId, rarityId) {
  const [lo, hi] = bkmpIdleRuneValueRange(slotId, rarityId);
  return Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
}
/* Sub-Stats sind bewusst schwaecher als der Hauptwert derselben Seltenheit
   (35% davon) - genau wie in Summoners War: Sky Arena ein Sub-Stat nie so
   stark ist wie ein frischer Hauptwert gleicher Stufe, sondern ihn nur
   ergaenzt. */
function bkmpIdleRollSubstatValue(statKey, rarityId) {
  const [lo, hi] = bkmpIdleRuneStatRange(statKey, rarityId);
  const raw = (lo + Math.random() * (hi - lo)) * 0.35;
  /* Fest-Werte als ganze Zahl (mind. 1) statt Nachkommastellen - "+1,4
     Angriff (fest)" waere fuer einen Fest-Wert unueblich/unschoen. */
  return statKey.endsWith('_flat') ? Math.max(1, Math.round(raw)) : Math.round(raw * 100) / 100;
}

/* Rollt die Sub-Stats, mit denen eine Rune SOFORT droppt/verschmilzt -
   Anzahl nach Seltenheit (BKMP_RUNE_MAX_SUBSTATS), Typen gewichtet-zufaellig
   aus BKMP_RUNE_SUBSTAT_WEIGHTS, nie doppelt und nie identisch zum
   Hauptstat der Rune. Wird von bkmpIdleMaybeDropRune UND bkmpRuneFuse
   genutzt (Verschmelzen liefert seit der Nachbesserung ebenfalls direkt
   Sub-Stats passend zur neuen Seltenheit, nicht mehr leer). */
function bkmpIdleRollInitialSubstats(primaryStat, rarityId) {
  const count = BKMP_RUNE_MAX_SUBSTATS[rarityId] || 0;
  const substats = [];
  const used = new Set([primaryStat]);
  for (let i = 0; i < count; i++) {
    const pool = Object.keys(BKMP_RUNE_SUBSTAT_WEIGHTS).filter(st => !used.has(st));
    if (!pool.length) break;
    const stat = bkmpRunePickWeightedStat(pool);
    used.add(stat);
    substats.push({ stat, value: bkmpIdleRollSubstatValue(stat, rarityId) });
  }
  return substats;
}

function bkmpRuneNewLocalId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('local-' + Date.now() + '-' + Math.random().toString(36).slice(2));
}

let bkmpIdlePlayerRunes = [];
let bkmpIdlePendingRuneDrops = [];
let bkmpIdleRuneSyncTimer = null;

/* Neue Drops werden gesammelt statt sofort einzeln gespeichert - bei
   mehreren Kaempfen kurz hintereinander (autoklickender Spieler, schnelle
   Stufen) landet so bei Bedarf mehr als ein Drop in EINEM Insert-Aufruf
   statt einer Schreib-Anfrage pro Kampf (gleiche Ueberlegung wie beim
   Egress-Vorfall vom 12.07. - siehe Projektnotizen). */
function bkmpIdleQueueRuneSync() {
  if (bkmpIdleRuneSyncTimer) return;
  bkmpIdleRuneSyncTimer = window.setTimeout(async () => {
    bkmpIdleRuneSyncTimer = null;
    const pending = bkmpIdlePendingRuneDrops;
    bkmpIdlePendingRuneDrops = [];
    if (!pending.length || !bkmpIdleState || typeof insertPlayerRunes !== 'function') return;
    try {
      const inserted = await insertPlayerRunes(bkmpIdleState.name_key, pending.map(r => ({
        rune_type: r.rune_type, rarity: r.rarity, rolled_value: r.rolled_value, equipped: r.equipped, upgrade_level: r.upgrade_level, substats: r.substats
      })));
      inserted.forEach((row, i) => {
        const item = pending[i];
        if (!item || !row) return;
        item.id = row.id;
        /* Falls zwischen dem Droppen und dem Eintreffen der echten DB-id
           (bis zu 4s Debounce + Netzwerk-Laufzeit) schon ausgeruestet oder
           aufgewertet wurde, tragen bkmpRuneToggleEquip/bkmpRuneUpgrade das
           mangels id noch nicht nach - hier einmalig mit dem aktuellen Stand
           nachholen, statt es fuer immer zu verlieren. */
        if (item.equipped && typeof updatePlayerRuneEquipped === 'function') updatePlayerRuneEquipped(item.id, true).catch(() => {});
        if ((item.upgrade_level || (item.substats && item.substats.length)) && typeof updatePlayerRuneUpgrade === 'function') {
          updatePlayerRuneUpgrade(item.id, item.upgrade_level, item.substats).catch(() => {});
        }
      });
    } catch (e) {
      console.warn('Idle Dorf: Runen-Drop konnte nicht gespeichert werden.', e);
    }
  }, 4000);
}

/* Wird aus bkmpIdleHandleDragonDefeated() aufgerufen. source: 'normal'
   oder 'boss'. */
function bkmpIdleMaybeDropRune(source) {
  if (!bkmpIdleState) return null;
  const chance = BKMP_RUNE_DROP_CHANCE[source] ?? BKMP_RUNE_DROP_CHANCE.normal;
  if (Math.random() > chance) return null;
  const luck = bkmpIdleEffectiveStats ? Number(bkmpIdleEffectiveStats.runeLuckPct || 0) : 0;
  const slot = window.BKMP_RUNE_SLOTS[Math.floor(Math.random() * window.BKMP_RUNE_SLOTS.length)];
  const rarityId = bkmpIdleRollRuneRarity(source, luck);
  const rolledValue = bkmpIdleRollRuneValue(slot.id, rarityId);
  const rune = { id: null, _cid: bkmpRuneNewLocalId(), rune_type: slot.id, rarity: rarityId, rolled_value: rolledValue, equipped: false, upgrade_level: 0, substats: bkmpIdleRollInitialSubstats(slot.stat, rarityId), created_at: new Date().toISOString() };
  bkmpIdlePlayerRunes.push(rune);
  bkmpIdlePendingRuneDrops.push(rune);
  bkmpIdleQueueRuneSync();
  const rarityDef = window.BKMP_RUNE_RARITIES.find(r => r.id === rarityId);
  bkmpIdleLog(`🔮 ${rarityDef.name} ${slot.name} gefunden! (+${rolledValue}% ${slot.desc})`);
  return rune;
}

/* ---------------- Aufwertung (+0 bis +15) + Sub-Stats ----------------
   Nach dem Vorbild von Summoners War: Sky Arena (auf Nutzerwunsch recher-
   chiert), an unsere kleinere Wirtschaft angepasst:
   - Jede Stufe erhoeht den Hauptwert der Rune um einen festen Anteil.
   - Bei +3/+6/+9/+12 kommt (falls unter dem Sub-Stat-Limit BKMP_RUNE_SUBSTAT_
     CAP) ein neuer, zufaellig gewuerfelter Sub-Stat hinzu (anderer Wert als
     der Hauptstat) - sonst wird stattdessen ein zufaelliger bereits
     vorhandener Sub-Stat weiter verstaerkt, genau wie in Summoners War jede
     Aufwertung IMMER etwas bewirkt, nicht nur an den Meilenstein-Stufen.
   - NACHBESSERUNG (15.07., Nutzerwunsch): Runen droppen/verschmelzen ab
     sofort schon MIT Sub-Stats, nicht mehr leer - die Anzahl haengt von der
     Seltenheit ab (BKMP_RUNE_MAX_SUBSTATS, unveraendert: gray 0/green 1/
     blue 2/purple 3/gold 4). Das universelle Maximum bleibt bei 4
     (BKMP_RUNE_SUBSTAT_CAP) fuer ALLE Seltenheiten - der Unterschied ist nur,
     wie viele davon schon beim Drop da sind und wie viele Meilensteine also
     noch NEUE Sub-Stats bringen statt vorhandene zu verstaerken. Beispiel:
     Gewoehnlich (0 beim Drop) -> alle 4 Meilensteine bringen einen neuen
     Sub-Stat, keiner wird je verstaerkt. Legendaer (4 beim Drop, schon am
     Limit) -> alle 4 Meilensteine verstaerken nur noch vorhandene.
   - NACHBESSERUNG (15.07., Nutzerwunsch): das anfangs bewusst weggelassene
     Fehlschlag-Risiko kommt jetzt doch dazu - Aufwerten kann fehlschlagen
     (Gold ist weg, Stufe bleibt gleich), Verschmelzen kann die 3 Runen
     komplett zerstoeren statt eine neue zu liefern (siehe
     BKMP_RUNE_FUSE_FAIL_CHANCE/bkmpIdleRuneUpgradeFailChance unten). */
const BKMP_RUNE_MAX_LEVEL = 15;
const BKMP_RUNE_SUBSTAT_MILESTONES = [3, 6, 9, 12];
/* Anzahl Sub-Stats, mit denen eine Rune dieser Seltenheit droppt/verschmilzt
   (siehe bkmpIdleRollInitialSubstats). Das absolute Maximum ist immer 4
   (BKMP_RUNE_SUBSTAT_CAP), unabhaengig von der Seltenheit. */
const BKMP_RUNE_MAX_SUBSTATS = { gray: 0, green: 1, blue: 2, purple: 3, gold: 4 };
const BKMP_RUNE_SUBSTAT_CAP = 4;
/* Fehlschlagchance beim Aufwerten - steigt mit der aktuellen Stufe (0% bei
   +0->+1, waechst dann 2 Prozentpunkte pro Stufe bis max. 30%), unabhaengig
   von der Seltenheit. Bei Fehlschlag ist das Gold trotzdem weg, die Stufe
   bleibt aber gleich - fruehe Aufwertungen bleiben also sicher, erst nahe
   +15 wird es wirklich riskant. */
function bkmpIdleRuneUpgradeFailChance(rune) {
  return Math.min(0.30, Number(rune.upgrade_level || 0) * 0.02);
}
function bkmpIdleRuneUpgradeCost(rune) {
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rune.rarity);
  const mult = rarity ? rarity.mult : 1;
  return Math.round(16 * mult * Math.pow(1.42, Number(rune.upgrade_level || 0)));
}
/* +8% des Grundwerts pro Stufe -> bei +15 rund das 2,2-fache des rohen
   rolled_value (2 * 5 fuer Legendaer waere z.B. 2 -> 4,4). */
function bkmpIdleRuneEffectivePrimaryValue(rune) {
  return Math.round(Number(rune.rolled_value || 0) * (1 + Number(rune.upgrade_level || 0) * 0.08) * 100) / 100;
}
function bkmpRuneUpgrade(cid) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || !bkmpIdleState) return;
  const level = Number(rune.upgrade_level || 0);
  if (level >= BKMP_RUNE_MAX_LEVEL) return;
  const cost = bkmpIdleRuneUpgradeCost(rune);
  if (bkmpIdleState.gold < cost) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('💰 Nicht genug Gold zum Aufwerten.', 2400);
    return;
  }
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === rune.rune_type);
  bkmpIdleState.gold -= cost;
  /* NACHBESSERUNG (Nutzerwunsch, 15.07.: "beim Upgraden chance des es nicht
     sich nicht upgraded und fehlschlägt"): das Gold ist bei einem
     Fehlschlag trotzdem weg (das IST das Risiko), nur die Stufe steigt
     nicht und Sub-Stats bleiben unangetastet - die Rune selbst geht dabei
     NICHT kaputt (anders als beim Verschmelzen), sie bleibt einfach auf
     der aktuellen Stufe stehen. */
  const failChance = bkmpIdleRuneUpgradeFailChance(rune);
  if (Math.random() < failChance) {
    bkmpIdleLog(`💥 ${slot.name} +${level}: Aufwertung fehlgeschlagen! Gold verloren, Stufe bleibt gleich.`);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`💥 Aufwertung fehlgeschlagen - ${cost} Gold futsch, Stufe bleibt +${level}.`, 3200);
    bkmpRuneCurrentlyViewing = cid;
    bkmpIdleRecomputeEffectiveStats();
    bkmpIdleRenderRunenPanel();
    bkmpIdleRenderHud();
    bkmpIdleQueueSync();
    return;
  }
  rune.upgrade_level = level + 1;
  rune.substats = Array.isArray(rune.substats) ? rune.substats : [];
  /* WICHTIG (Nachbesserung, Spieler-Meldung "bei jedem +1 Upgrade hoehere
     Substats?"): Sub-Stats duerfen sich NUR an den 4 Meilenstein-Stufen
     +3/+6/+9/+12 aendern (neu ODER verstaerkt) - an allen anderen 11 Stufen
     passiert mit den Sub-Stats gar nichts, nur der Hauptwert steigt (siehe
     bkmpIdleRuneEffectivePrimaryValue). Der Bug vorher: die "verstaerke
     einen vorhandenen Sub-Stat"-Zeile lief als reines else OHNE eigene
     Meilenstein-Abfrage, also bei JEDER Nicht-Meilenstein-Stufe auch -
     dadurch wuchsen Sub-Stats bei praktisch jedem Klick, nicht nur alle 3
     Stufen wie eigentlich gewollt. */
  if (BKMP_RUNE_SUBSTAT_MILESTONES.includes(rune.upgrade_level)) {
    if (rune.substats.length < BKMP_RUNE_SUBSTAT_CAP) {
      const usedStats = new Set([slot.stat, ...rune.substats.map(s => s.stat)]);
      const pool = Object.keys(BKMP_RUNE_SUBSTAT_WEIGHTS).filter(st => !usedStats.has(st));
      if (pool.length) {
        const newStat = bkmpRunePickWeightedStat(pool);
        rune.substats.push({ stat: newStat, value: bkmpIdleRollSubstatValue(newStat, rune.rarity) });
        const meta = bkmpRuneStatMeta(newStat);
        bkmpIdleLog(`✨ ${slot.name} +${rune.upgrade_level}: neuer Sub-Stat ${meta.icon} ${meta.desc}!`);
      }
    } else if (rune.substats.length) {
      const pick = rune.substats[Math.floor(Math.random() * rune.substats.length)];
      const bump = bkmpIdleRollSubstatValue(pick.stat, rune.rarity) * 0.5;
      pick.value = pick.stat.endsWith('_flat') ? pick.value + Math.max(1, Math.round(bump)) : Math.round((pick.value + bump) * 100) / 100;
    }
  }
  /* Ohne echte DB-id (frisch gedroppt/verschmolzen, Insert noch nicht
     zurueck) kann hier noch nicht persistiert werden - die Aufwertung
     wird trotzdem sofort lokal angewendet (spielt sich sonst wie ein
     Blocker an), und sobald die id eintrifft (siehe bkmpIdleQueueRuneSync/
     bkmpRuneFuse), wird der dann aktuelle Stand automatisch nachgetragen. */
  if (rune.id) updatePlayerRuneUpgrade(rune.id, rune.upgrade_level, rune.substats).catch(() => {});
  bkmpRuneCurrentlyViewing = cid;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderRunenPanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

/* Aggregiert alle AUSGERUESTETEN Runen (Hauptwert UND Sub-Stats) zu denselben
   Effekt-Schluesseln, die Skilltree/Upgrades/Titel/Prestige schon nutzen
   (attack_pct usw.) - flieszt dadurch ganz ohne Sonderbehandlung in
   bkmpIdleRecomputeEffectiveStats ein. rune_luck_pct ist der einzige
   Schluessel, der NUR von Runen (oder dem magie_runenglueck-Skillknoten)
   kommt (siehe dort). */
function bkmpIdleRuneEffectTotals() {
  const totals = {};
  bkmpIdlePlayerRunes.forEach(r => {
    if (!r.equipped) return;
    const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === r.rune_type);
    if (!slot) return;
    totals[slot.stat] = (totals[slot.stat] || 0) + bkmpIdleRuneEffectivePrimaryValue(r);
    (r.substats || []).forEach(s => { totals[s.stat] = (totals[s.stat] || 0) + Number(s.value || 0); });
  });
  return totals;
}

/* ---------------- Runen-UI: eigenes Inventarfenster je Slot ---------------- */

let bkmpRuneActiveSlotTab = 'slot1';
let bkmpRuneCurrentlyViewing = null;
/* Aktiver Verschmelzen-Auswahlmodus: { rarityId, cids: [...] } oder null.
   Auf Nutzerwunsch (15.07., "Warnung einbauen. Und der Spieler soll gezielt
   einstellen welche verschmolzen") - vorher nahm bkmpRuneFuse() einfach die
   ersten 3 gefundenen Runen, auch eine +15 landete so ungefragt mit im
   Ofen. Jetzt waehlt der Spieler die 3 Instanzen selbst aus dem Lager aus,
   siehe bkmpRuneToggleFuseCandidate/bkmpRuneConfirmFuseSelection. */
let bkmpRuneFuseSelection = null;

function bkmpRuneSelectSlotTab(slotId) {
  if (!window.BKMP_RUNE_SLOTS.some(s => s.id === slotId)) return;
  bkmpRuneActiveSlotTab = slotId;
  bkmpRuneCurrentlyViewing = null;
  bkmpRuneFuseSelection = null;
  bkmpIdleRenderRunenPanel();
}

function bkmpRuneStartFuseSelection(rarityId) {
  bkmpRuneFuseSelection = { rarityId, cids: [] };
  bkmpIdleRenderRunenPanel();
}
function bkmpRuneCancelFuseSelection() {
  bkmpRuneFuseSelection = null;
  bkmpIdleRenderRunenPanel();
}
/* Maximale Auswahlgroesse - Vielfache von 3, damit jede Gruppe eine
   eigenstaendige Verschmelzung ergibt (Nutzerwunsch, 15.07.: "beim
   verschmelzen das man auch direkt 3/6/9 runen auswählen kann" - bisher
   war bei 3 hart Schluss, groessere Sammlungen mussten die Auswahl jedes
   Mal einzeln neu aufbauen). */
const BKMP_RUNE_FUSE_MAX_SELECT = 9;

function bkmpRuneToggleFuseCandidate(cid) {
  if (!bkmpRuneFuseSelection) return;
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || rune.rarity !== bkmpRuneFuseSelection.rarityId || rune.equipped) return;
  const idx = bkmpRuneFuseSelection.cids.indexOf(cid);
  if (idx >= 0) {
    bkmpRuneFuseSelection.cids.splice(idx, 1);
  } else {
    if (bkmpRuneFuseSelection.cids.length >= BKMP_RUNE_FUSE_MAX_SELECT) return;
    bkmpRuneFuseSelection.cids.push(cid);
  }
  bkmpIdleRenderRunenPanel();
}
/* Direktauswahl-Knoepfe "3/6/9" (siehe bkmpRuneFuseSelectionHTML) - fuellt
   die Auswahl automatisch mit den ersten N passenden, unausgeruesteten
   Instanzen statt jede einzeln anklicken zu muessen. Sortiert bewusst nach
   AUFSTEIGENDER Stufe zuerst (unaufgewertete +0-Runen zuerst gewaehlt),
   damit eine automatische Auswahl nicht unnoetig eine muehsam aufgewertete
   Rune "verbrennt", solange genug frische +0-Kopien vorhanden sind. */
function bkmpRuneQuickSelectFuse(count) {
  if (!bkmpRuneFuseSelection) return;
  const candidates = bkmpIdlePlayerRunes
    .filter(r => r.rune_type === bkmpRuneActiveSlotTab && r.rarity === bkmpRuneFuseSelection.rarityId && !r.equipped)
    .sort((a, b) => Number(a.upgrade_level || 0) - Number(b.upgrade_level || 0));
  bkmpRuneFuseSelection.cids = candidates.slice(0, Math.min(count, BKMP_RUNE_FUSE_MAX_SELECT)).map(r => r._cid);
  bkmpIdleRenderRunenPanel();
}
/* Bestaetigt die aktuelle Auswahl (3, 6 oder 9 Runen = 1, 2 oder 3
   unabhaengige Verschmelzungen) - warnt VORHER ueber beides: die
   Fehlschlagchance (Nutzerwunsch: "Chance einbauen das Runen beim
   Schmelzen kaputt gehen können") UND, falls zutreffend, ueber bereits
   aufgewertete Runen in der Auswahl (die bei Erfolg ihre Stufe verlieren,
   bei Fehlschlag komplett weg sind). Jede 3er-Gruppe wird einzeln per
   bkmpRuneFuse() gewuerfelt, damit Erfolg/Misserfolg nicht an der ganzen
   Auswahl haengt, sondern pro Dreiergruppe entschieden wird. */
async function bkmpRuneConfirmFuseSelection() {
  if (!bkmpRuneFuseSelection || bkmpRuneFuseSelection.cids.length === 0 || bkmpRuneFuseSelection.cids.length % 3 !== 0) return;
  const slotId = bkmpRuneActiveSlotTab;
  const rarityId = bkmpRuneFuseSelection.rarityId;
  const cids = bkmpRuneFuseSelection.cids.slice();
  const runes = cids.map(cid => bkmpIdlePlayerRunes.find(r => r._cid === cid)).filter(Boolean);
  if (runes.length !== cids.length) { bkmpRuneFuseSelection = null; bkmpIdleRenderRunenPanel(); return; }
  const groupCount = cids.length / 3;
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === slotId);
  const rarityDef = window.BKMP_RUNE_RARITIES.find(r => r.id === rarityId);
  const failPct = Math.round((BKMP_RUNE_FUSE_FAIL_CHANCE[rarityId] || 0) * 100);
  const withProgress = runes.filter(r => Number(r.upgrade_level || 0) > 0 || (r.substats && r.substats.length));
  const progressLine = withProgress.length
    ? `\n\n⚠️ ${withProgress.length} der ausgewählten ${slot ? slot.name : 'Runen'} ${withProgress.length === 1 ? 'ist' : 'sind'} bereits aufgewertet (${withProgress.map(r => `+${r.upgrade_level || 0}${r.substats && r.substats.length ? ` mit ${r.substats.length} Sub-Stat${r.substats.length === 1 ? '' : 's'}` : ''}`).join(', ')}) - bei Erfolg startet das Ergebnis trotzdem wieder bei +0.`
    : '';
  const confirmed = await bkmpConfirmDialog(
    `✨ ${groupCount}× verschmelzen?`,
    `Du verschmilzt ${cids.length} ${rarityDef ? rarityDef.name : ''} ${slot ? slot.name : ''} in ${groupCount} unabhängigen Gruppen zu je 3.\n\n⚠️ Jede Gruppe hat eine ${failPct}%-Chance, dass die 3 eingesetzten Runen dabei komplett zerstört werden (keine neue Rune, alle 3 sind weg) statt zu gelingen.${progressLine}\n\nTrotzdem fortfahren?`,
    'Ja, verschmelzen',
    'Abbrechen'
  );
  if (!confirmed) return;

  bkmpRuneFuseSelection = null;
  let succeeded = 0;
  let destroyed = 0;
  for (let i = 0; i < cids.length; i += 3) {
    const group = cids.slice(i, i + 3);
    const result = bkmpRuneFuse(slotId, rarityId, group);
    if (result && result.success) succeeded += 1;
    else destroyed += 1;
  }
  if (groupCount > 1) {
    const summary = destroyed
      ? `✨ ${succeeded}/${groupCount} Verschmelzungen erfolgreich, 💥 ${destroyed} zerstört.`
      : `✨ Alle ${groupCount} Verschmelzungen erfolgreich!`;
    bkmpIdleLog(summary);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(summary, 3600);
  } else if (typeof bkmpShowJannikToast === 'function' && succeeded) {
    bkmpShowJannikToast(`✨ Verschmolzen: ${window.BKMP_RUNE_RARITIES[window.BKMP_RUNE_RARITIES.findIndex(r => r.id === rarityId) + 1].name} ${slot ? slot.name : ''}!`, 3200);
  }
}

function bkmpRuneStatBoxHTML(slot, rune) {
  if (!rune) return `<p class="idle-runen-stat-placeholder">Du besitzt noch keine ${escapeHtml(slot.name)} - beim Kämpfen und bei Bossen droppen zufällig neue.</p>`;
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rune.rarity);
  const level = Number(rune.upgrade_level || 0);
  const unit = '%';
  const effectiveValue = bkmpIdleRuneEffectivePrimaryValue(rune);
  const isMaxLevel = level >= BKMP_RUNE_MAX_LEVEL;
  const cost = bkmpIdleRuneUpgradeCost(rune);
  const canAffordUpgrade = bkmpIdleState && bkmpIdleState.gold >= cost;
  const sameGroup = bkmpIdlePlayerRunes.filter(r => r.rune_type === rune.rune_type && r.rarity === rune.rarity && !r.equipped);
  const canFuse = sameGroup.length >= 3 && rune.rarity !== 'gold';
  const upgradeFailPct = Math.round(bkmpIdleRuneUpgradeFailChance(rune) * 100);
  return `
    <div class="idle-runen-stat-head" style="--rune-color:${rarity.color}">
      <img src="assets/runes/${slot.id}-${rune.rarity}.png?v=${BKMP_RUNE_IMG_V}" alt="">
      <div>
        <div class="idle-runen-stat-name">${slot.icon} ${escapeHtml(slot.name)} <span class="idle-runen-stat-level">+${level}</span></div>
        <div class="idle-runen-stat-rarity">${escapeHtml(rarity.name)}</div>
      </div>
      <button type="button" class="${rune.equipped ? 'btn-nein' : 'btn-ja'} idle-runen-equip-btn" id="idleRuneEquipBtn" data-cid="${rune._cid}">
        ${rune.equipped ? 'Entfernen' : 'Einsetzen'}
      </button>
    </div>
    <p class="idle-runen-stat-line idle-runen-stat-primary">+${effectiveValue}${unit} ${escapeHtml(slot.desc)}</p>
    ${rune.substats && rune.substats.length ? `<ul class="idle-runen-substat-list">
      ${rune.substats.map(s => {
        const meta = bkmpRuneStatMeta(s.stat);
        const subUnit = s.stat.endsWith('_flat') ? '' : '%';
        return `<li>${meta.icon} +${s.value}${subUnit} ${escapeHtml(meta.desc)}</li>`;
      }).join('')}
    </ul>` : '<p class="idle-runen-stat-note">Noch keine Sub-Stats - bei +3/+6/+9/+12 kommt bis zu insgesamt 4 jeweils einer dazu.</p>'}
    <div class="idle-runen-stat-actions">
      <button type="button" class="btn-ja idle-runen-upgrade-btn" id="idleRuneUpgradeBtn" data-cid="${rune._cid}" ${isMaxLevel || !canAffordUpgrade ? 'disabled' : ''} title="${isMaxLevel ? '' : `${upgradeFailPct}% Chance, dass die Aufwertung fehlschlägt (Gold ist dann trotzdem weg)`}">
        ${isMaxLevel ? '⭐ Maximal aufgewertet' : `⬆️ Aufwerten (${cost} Gold${upgradeFailPct ? `, ${upgradeFailPct}% Risiko` : ''})`}
      </button>
    </div>
    <div class="idle-runen-stat-actions">
      <button type="button" class="btn-nein idle-runen-fuse-btn" id="idleRuneFuseBtn" data-rarity="${rune.rarity}" ${canFuse ? '' : 'disabled'}>
        ✨ Verschmelzen (auswählen)${canFuse ? '' : ` (${sameGroup.length}/3)`}
      </button>
      <button type="button" class="btn-nein idle-runen-sell-btn" id="idleRuneSellBtn" data-cid="${rune._cid}" ${rune.equipped ? 'disabled' : ''}>
        💰 verkaufen (+${rarity.sellGold})
      </button>
    </div>
  `;
}

/* Ruestet eine konkrete Rune-Instanz aus/ab (per _cid, nicht mehr nur
   Slot+Seltenheit, da Instanzen jetzt durch Stufe/Sub-Stats unterschiedlich
   stark sein koennen) - ersetzt dabei automatisch eine evtl. schon im
   selben Slot sitzende andere Rune (max. 1 pro Slot). */
function bkmpRuneToggleEquip(cid) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune) return;
  if (rune.equipped) {
    rune.equipped = false;
    if (rune.id) updatePlayerRuneEquipped(rune.id, false).catch(() => {});
  } else {
    const otherInSlot = bkmpIdlePlayerRunes.find(r => r.rune_type === rune.rune_type && r.equipped);
    if (otherInSlot) {
      otherInSlot.equipped = false;
      if (otherInSlot.id) updatePlayerRuneEquipped(otherInSlot.id, false).catch(() => {});
    }
    rune.equipped = true;
    if (rune.id) updatePlayerRuneEquipped(rune.id, true).catch(() => {});
  }
  bkmpRuneCurrentlyViewing = cid;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderRunenPanel();
  bkmpIdleRenderHud();
}

/* Fehlschlagchance beim Verschmelzen (Nutzerwunsch, 15.07.: "Chance
   einbauen das Runen beim Schmelzen kaputt gehen können.. so höher die
   Rarity desto eher") - je hoeher die Seltenheit der 3 EINGESETZTEN Runen,
   desto riskanter. Bei Fehlschlag sind alle 3 unwiderruflich weg (keine
   neue Rune) - keine der 5 Seltenheiten kann selbst verschmolzen werden
   (Legendaer ist die Obergrenze), daher kein Eintrag fuer "gold" noetig. */
const BKMP_RUNE_FUSE_FAIL_CHANCE = { gray: 0.03, green: 0.06, blue: 0.12, purple: 0.20 };

/* 3 unausgeruestete Runen gleichen Slots + gleicher Seltenheit -> 1 neue
   Rune der naechsten Seltenheitsstufe (frisch gewuerfelter Hauptwert +
   frisch gewuerfelte Sub-Stats passend zur neuen Seltenheit, siehe
   bkmpIdleRollInitialSubstats - startet aber bewusst wieder bei +0, sonst
   wuerde Verschmelzen zum umstaendlichen Umweg, um eine hoehere Stufe
   "billiger" aufzuwerten, statt einer eigenstaendigen Belohnung fuer viele
   gesammelte Runen). Legendär ist die Obergrenze, kann nicht weiter
   verschmolzen werden.
   cids (optional): genau 3 vom Spieler ausgewaehlte Instanzen (siehe
   bkmpRuneConfirmFuseSelection) - werden diese uebergeben, gelten NUR sie,
   nicht mehr einfach "die ersten 3 gefundenen" (Spieler-Wunsch: gezielt
   auswaehlen koennen, damit z.B. eine +15 nicht ungefragt mitverschmilzt).
   Gibt { success, newRune? } zurueck, damit bkmpRuneConfirmFuseSelection
   bei mehreren Gruppen (3/6/9, siehe dort) die Ergebnisse zusammenzaehlen
   kann. */
function bkmpRuneFuse(slotId, rarityId, cids) {
  const rarityIndex = window.BKMP_RUNE_RARITIES.findIndex(r => r.id === rarityId);
  if (rarityIndex < 0 || rarityIndex >= window.BKMP_RUNE_RARITIES.length - 1) return { success: false };
  let consumed;
  if (Array.isArray(cids) && cids.length === 3) {
    consumed = cids
      .map(cid => bkmpIdlePlayerRunes.find(r => r._cid === cid && r.rune_type === slotId && r.rarity === rarityId && !r.equipped))
      .filter(Boolean);
    if (consumed.length !== 3) return { success: false };
  } else {
    const candidates = bkmpIdlePlayerRunes.filter(r => r.rune_type === slotId && r.rarity === rarityId && !r.equipped);
    if (candidates.length < 3) return { success: false };
    consumed = candidates.slice(0, 3);
  }
  const consumedIds = consumed.map(r => r.id).filter(Boolean);
  bkmpIdlePlayerRunes = bkmpIdlePlayerRunes.filter(r => !consumed.includes(r));
  if (consumedIds.length && typeof deletePlayerRunes === 'function') deletePlayerRunes(consumedIds).catch(() => {});
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === slotId);
  const rarityDef = window.BKMP_RUNE_RARITIES[rarityIndex];

  const failChance = BKMP_RUNE_FUSE_FAIL_CHANCE[rarityId] || 0;
  if (Math.random() < failChance) {
    bkmpIdleLog(`💥 3× ${slot.name} (${rarityDef.name}) beim Verschmelzen zerstört - kein Ergebnis!`);
    bkmpIdleRenderRunenPanel();
    return { success: false, destroyed: true };
  }

  const newRarity = window.BKMP_RUNE_RARITIES[rarityIndex + 1];
  const newValue = bkmpIdleRollRuneValue(slotId, newRarity.id);
  const primarySlotObj = window.BKMP_RUNE_SLOTS.find(s => s.id === slotId);
  const newSubstats = bkmpIdleRollInitialSubstats(primarySlotObj ? primarySlotObj.stat : null, newRarity.id);
  const newRune = { id: null, _cid: bkmpRuneNewLocalId(), rune_type: slotId, rarity: newRarity.id, rolled_value: newValue, equipped: false, upgrade_level: 0, substats: newSubstats, created_at: new Date().toISOString() };
  bkmpIdlePlayerRunes.push(newRune);
  if (bkmpIdleState && typeof insertPlayerRunes === 'function') {
    insertPlayerRunes(bkmpIdleState.name_key, [{ rune_type: slotId, rarity: newRarity.id, rolled_value: newValue, equipped: false, upgrade_level: 0, substats: newSubstats }])
      .then(rows => {
        if (!rows || !rows[0]) return;
        newRune.id = rows[0].id;
        /* Siehe bkmpIdleQueueRuneSync - falls die frisch verschmolzene Rune
           schon ausgeruestet/aufgewertet wurde, bevor die id zurueckkam. */
        if (newRune.equipped && typeof updatePlayerRuneEquipped === 'function') updatePlayerRuneEquipped(newRune.id, true).catch(() => {});
        if ((newRune.upgrade_level || (newRune.substats && newRune.substats.length)) && typeof updatePlayerRuneUpgrade === 'function') {
          updatePlayerRuneUpgrade(newRune.id, newRune.upgrade_level, newRune.substats).catch(() => {});
        }
      })
      .catch(() => {});
  }
  bkmpIdleLog(`✨ 3× ${slot.name} (${rarityDef.name}) zu ${newRarity.name} verschmolzen!`);
  bkmpRuneCurrentlyViewing = newRune._cid;
  bkmpIdleRenderRunenPanel();
  return { success: true, newRune };
}

function bkmpRuneSell(cid) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || rune.equipped || !bkmpIdleState) return;
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rune.rarity);
  bkmpIdlePlayerRunes = bkmpIdlePlayerRunes.filter(r => r !== rune);
  bkmpIdleState.gold += rarity.sellGold;
  if (rune.id && typeof deletePlayerRunes === 'function') deletePlayerRunes([rune.id]).catch(() => {});
  if (bkmpRuneCurrentlyViewing === cid) bkmpRuneCurrentlyViewing = null;
  bkmpIdleRenderHud();
  bkmpIdleRenderRunenPanel();
  bkmpIdleQueueSync();
}

/* ❓-Hilfe-Overlay statt eines Dauer-Hinweistexts im Panel selbst (auf
   Nutzerwunsch - der Fliesstext oben im Runen-Tab wirkte zu textlastig).
   Gleiches Muster wie bkmpIdleOpenSkillHelp/#idleSkillHelpOverlay, nur mit
   Runen-eigenem Inhalt statt der Skill-Knoten-Liste. */
function bkmpIdleOpenRunenHelp() {
  bkmpIdleRenderRunenHelp();
  const overlay = document.getElementById('idleRunenHelpOverlay');
  if (overlay) { overlay.classList.add('visible'); document.body.classList.add('modal-open'); }
}

function bkmpIdleRenderRunenHelp() {
  const list = document.getElementById('idleRunenHelpList');
  if (!list) return;
  const slotsHtml = window.BKMP_RUNE_SLOTS.map(slot => `
    <div class="skillhelp-row">
      <span class="skillhelp-icon">${slot.icon}</span>
      <div class="skillhelp-body">
        <div class="skillhelp-name">${escapeHtml(slot.name)}</div>
        <div class="skillhelp-desc">Haupt-Stat: ${escapeHtml(slot.desc)}</div>
      </div>
    </div>`).join('');
  const raritiesHtml = window.BKMP_RUNE_RARITIES.map(rarity => `
    <div class="skillhelp-row">
      <span class="skillhelp-icon" style="color:${rarity.color}">●</span>
      <div class="skillhelp-body">
        <div class="skillhelp-name" style="color:${rarity.color}">${escapeHtml(rarity.name)}</div>
      </div>
      <div class="skillhelp-meta">
        <span class="skillhelp-cost">Verkauf: ${rarity.sellGold} Gold</span>
      </div>
    </div>`).join('');
  list.innerHTML = `
    <div class="skillhelp-branch">
      <div class="skillhelp-branch-title">🔮 Wie bekomme ich Runen?</div>
      <p class="skillhelp-note" style="margin:0 0 0.6rem;">Kleine Chance nach jedem besiegten Drachen, bei Bossen (alle 25 Kämpfe) etwas höher. Eine ausgerüstete Glücksrune oder der Skilltree-Knoten „Runenglück" (Zweig Magie) erhöhen zusätzlich die Chance auf bessere Seltenheitsstufen.</p>
    </div>
    <div class="skillhelp-branch">
      <div class="skillhelp-branch-title">Die 6 Rune-Typen</div>
      ${slotsHtml}
    </div>
    <div class="skillhelp-branch">
      <div class="skillhelp-branch-title">Seltenheitsstufen</div>
      ${raritiesHtml}
    </div>
    <div class="skillhelp-note">
      <strong>⬆️ Aufwerten:</strong> Mit Gold von +0 bis +15 - jede Stufe erhöht den Hauptwert der Rune, Kosten steigen mit Stufe und Seltenheit. Ab höheren Stufen kann eine Aufwertung fehlschlagen (steigt bis max. 30% bei +14→+15) - das Gold ist dann trotzdem weg, die Rune bleibt aber unversehrt auf ihrer Stufe stehen.<br>
      <strong>✦ Sub-Stats:</strong> Runen droppen schon MIT Sub-Stats - Anzahl je nach Seltenheit (Gewöhnlich 0, Ungewöhnlich 1, Selten 2, Episch 3, Legendär 4). Bei +3/+6/+9/+12 kommt jeweils ein neuer dazu, bis maximal 4 erreicht sind - danach verstärkt jede dieser Stufen stattdessen einen vorhandenen Sub-Stat weiter. Meist ein zweiter %-Wert, seltener ein fester Bonus (z. B. „+2 Angriff fest" statt „+3% Angriff") oder Angriffstempo - das kann bei jeder Seltenheit passieren, auch bei Legendär.<br>
      <strong>✨ Verschmelzen:</strong> Je 3 unausgerüstete Runen gleichen Slots und gleicher Seltenheit (die du selbst auswählst, auch gleich 6 oder 9 auf einmal in Dreiergruppen) ergeben 1 neue der nächsthöheren Seltenheit mit frisch gewürfelten Sub-Stats - startet aber wieder bei +0. Jede Dreiergruppe hat außerdem eine Fehlschlagchance, die mit der Seltenheit steigt (Gewöhnlich 3%, Ungewöhnlich 6%, Selten 12%, Episch 20%) - bei Fehlschlag sind alle 3 eingesetzten Runen komplett verloren, ohne Ergebnis. Vor jeder Verschmelzung kommt eine Warnung mit der genauen Chance.<br>
      <strong>💰 Verkaufen:</strong> Unausgerüstete Runen lassen sich jederzeit für Gold verkaufen.<br>
      <strong>🌌 Prestige:</strong> Ein Aufstieg setzt deine komplette Runen-Sammlung zurück - sammle vor dem Aufsteigen lieber nochmal alles Wichtige ein oder verschmelze/verkaufe erst.
    </div>
  `;
}

function bkmpRuneFuseSelectionHTML(slot) {
  const sel = bkmpRuneFuseSelection;
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === sel.rarityId);
  const count = sel.cids.length;
  const selectedRunes = sel.cids.map(cid => bkmpIdlePlayerRunes.find(r => r._cid === cid)).filter(Boolean);
  const hasProgress = selectedRunes.some(r => Number(r.upgrade_level || 0) > 0 || (r.substats && r.substats.length));
  const availableCount = bkmpIdlePlayerRunes.filter(r => r.rune_type === slot.id && r.rarity === sel.rarityId && !r.equipped).length;
  const failPct = Math.round((BKMP_RUNE_FUSE_FAIL_CHANCE[sel.rarityId] || 0) * 100);
  const isValidCount = count > 0 && count % 3 === 0;
  return `
    <div class="idle-runen-fuse-panel" style="--rune-color:${rarity.color}">
      <div class="idle-runen-fuse-title">✨ ${escapeHtml(rarity.name)} ${escapeHtml(slot.name)} verschmelzen</div>
      <p class="idle-runen-fuse-hint">Wähle unten im Lager ${escapeHtml(rarity.name)}-Kopien in Dreiergruppen aus (3, 6 oder 9) - je Gruppe ${failPct}% Chance, dass die 3 Runen dabei zerstört werden statt zu gelingen.</p>
      <div class="idle-runen-fuse-quick-select">
        ${[3, 6, 9].map(n => `<button type="button" class="btn-nein idle-runen-fuse-quick-btn" data-count="${n}" ${availableCount < n ? 'disabled' : ''}>${n} auswählen</button>`).join('')}
      </div>
      <div class="idle-runen-fuse-progress">${count}/${BKMP_RUNE_FUSE_MAX_SELECT} ausgewählt${!isValidCount && count ? ' <span class="idle-runen-fuse-warn">⚠️ muss Vielfaches von 3 sein</span>' : ''}${hasProgress ? ' <span class="idle-runen-fuse-warn">⚠️ enthält Aufwertung</span>' : ''}</div>
      <div class="idle-runen-stat-actions">
        <button type="button" class="btn-ja idle-runen-fuse-confirm-btn" id="idleRuneFuseConfirmBtn" ${isValidCount ? '' : 'disabled'}>✨ Verschmelzen${isValidCount ? ` (${count / 3}×)` : ''}</button>
        <button type="button" class="btn-nein idle-runen-fuse-cancel-btn" id="idleRuneFuseCancelBtn">Abbrechen</button>
      </div>
    </div>
  `;
}

/* Ob der ausklappbare Runen-Lager-Balken (idleRuneDrawer, siehe index.html)
   gerade offen ist - persistiert NICHT ueber Sitzungen hinweg, startet
   bewusst offen (deckt sich mit dem fruehren, immer sichtbaren Lager). */
let bkmpRuneDrawerOpen = true;

/* Zeigt/versteckt den Lager-Balken je nachdem, ob das Idle-Dorf-Fenster
   ueberhaupt offen ist UND der Runen-Tab gerade aktiv ist (Nutzerwunsch,
   15.07.: "Extra Balken daneben... mit einem Pfeil in der Mitte
   ausklappbar" - der Balken haengt fest am rechten Bildschirmrand statt im
   normalen Fensterinhalt, siehe .idle-runen-drawer in style.css). */
function bkmpRuneSyncDrawerVisibility() {
  const drawer = document.getElementById('idleRuneDrawer');
  if (!drawer) return;
  const shouldShow = !!bkmpIdleModalOpen && bkmpIdleActiveTab === 'runen';
  drawer.classList.toggle('visible', shouldShow);
  drawer.classList.toggle('open', shouldShow && bkmpRuneDrawerOpen);
  if (shouldShow) bkmpRuneSyncDrawerPosition();
}

/* Haengt den Lager-Balken direkt an die rechte Kante der Idle-Dorf-Karte an
   (Nutzer-Wunsch, 15.07.: "lieber an unser Fenster mit ran" - vorher klebte
   der Balken fest am Bildschirmrand, was bei breiten Fenstern eine
   sichtbare Luecke zur Karte liess, siehe Screenshot). Die Karte ist per
   Flexbox in der Fenstermitte zentriert, ihre tatsaechliche rechte
   Bildschirm-Position haengt also von der aktuellen Fensterbreite ab -
   deshalb per JS live gemessen statt fix in CSS, und bei jedem
   Fenster-Resize neu synchronisiert (siehe Listener in
   bkmpIdleInitTabs). */
function bkmpRuneSyncDrawerPosition() {
  const drawer = document.getElementById('idleRuneDrawer');
  const card = document.querySelector('.idle-dorf-overlay .idle-dorf-card');
  if (!drawer || !card || !drawer.classList.contains('visible')) return;
  const rect = card.getBoundingClientRect();
  drawer.style.left = Math.round(rect.right) + 'px';
}

function bkmpRuneToggleDrawer() {
  bkmpRuneDrawerOpen = !bkmpRuneDrawerOpen;
  bkmpRuneSyncDrawerVisibility();
}

function bkmpIdleRenderRunenPanel() {
  const panel = document.getElementById('idlePanelRunen');
  const drawerContent = document.getElementById('idleRuneDrawerContent');
  if (!panel || !drawerContent) return;
  const equippedBySlot = {};
  bkmpIdlePlayerRunes.forEach(r => { if (r.equipped) equippedBySlot[r.rune_type] = r; });
  const allSixEquipped = Object.keys(equippedBySlot).length >= 6;
  const totalOwned = bkmpIdlePlayerRunes.length;

  if (!window.BKMP_RUNE_SLOTS.some(s => s.id === bkmpRuneActiveSlotTab)) bkmpRuneActiveSlotTab = 'slot1';
  const activeSlot = window.BKMP_RUNE_SLOTS.find(s => s.id === bkmpRuneActiveSlotTab);
  const slotOwned = bkmpIdlePlayerRunes.filter(r => r.rune_type === activeSlot.id).slice().sort((a, b) => {
    const ra = window.BKMP_RUNE_RARITIES.findIndex(x => x.id === a.rarity);
    const rb = window.BKMP_RUNE_RARITIES.findIndex(x => x.id === b.rarity);
    if (rb !== ra) return rb - ra;
    if (!!b.equipped !== !!a.equipped) return b.equipped ? 1 : -1;
    return Number(b.upgrade_level || 0) - Number(a.upgrade_level || 0);
  });

  if (!bkmpRuneCurrentlyViewing || !slotOwned.some(r => r._cid === bkmpRuneCurrentlyViewing)) {
    const preferred = slotOwned.find(r => r.equipped) || slotOwned[0] || null;
    bkmpRuneCurrentlyViewing = preferred ? preferred._cid : null;
  }
  const viewingRune = slotOwned.find(r => r._cid === bkmpRuneCurrentlyViewing) || null;

  panel.innerHTML = `
    <div class="idle-runen-header-row">
      <button type="button" class="btn-nein idle-runen-help-btn" id="idleRunenHelpBtn">❓ Hilfe</button>
    </div>
    <div class="idle-runen-slot-tabs" id="idleRunenSlotTabs">
      ${window.BKMP_RUNE_SLOTS.map(slot => {
        const count = bkmpIdlePlayerRunes.filter(r => r.rune_type === slot.id).length;
        return `<button type="button" class="idle-runen-slot-tab ${slot.id === activeSlot.id ? 'active' : ''}" data-slot="${slot.id}">
          <span class="idle-runen-slot-tab-icon">${slot.icon}</span>
          <span class="idle-runen-slot-tab-name">${escapeHtml(slot.name)}</span>
          ${count ? `<span class="idle-runen-slot-tab-count">${count}</span>` : ''}
        </button>`;
      }).join('')}
    </div>
    <div class="idle-runen-main-row">
      <div class="idle-runen-circle-wrap">
        <div class="idle-runen-circle-inner">
          <img src="assets/runes/${allSixEquipped ? 'circle-full' : 'circle-empty'}.png?v=${BKMP_RUNE_IMG_V}" alt="Runen-Kreis" class="idle-runen-circle-img">
          ${window.BKMP_RUNE_SLOTS.map(slot => {
            const eq = equippedBySlot[slot.id];
            if (!eq) return '';
            const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === eq.rarity);
            const pos = BKMP_RUNE_SLOT_POSITIONS[slot.id];
            if (!rarity || !pos) return '';
            return `<button type="button" class="idle-runen-equip-slot" style="top:${pos.top}; left:${pos.left}; width:${pos.width}; height:${pos.height}; --rune-color:${rarity.color}" data-cid="${eq._cid}" data-slot="${slot.id}" title="${escapeHtml(slot.name)} ansehen &amp; aufwerten">
              <img src="assets/runes/${slot.id}-${eq.rarity}.png?v=${BKMP_RUNE_IMG_V}" alt="${escapeHtml(slot.name)} (${escapeHtml(rarity.name)})">
              ${eq.upgrade_level ? `<span class="idle-runen-slot-level">+${eq.upgrade_level}</span>` : ''}
            </button>`;
          }).join('')}
        </div>
      </div>
      <div class="idle-runen-stat-box" id="idleRunenStatBox">${bkmpRuneFuseSelection ? bkmpRuneFuseSelectionHTML(activeSlot) : bkmpRuneStatBoxHTML(activeSlot, viewingRune)}</div>
    </div>
  `;

  drawerContent.innerHTML = `
    <h4 class="idle-sammlung-subheading">🎒 ${escapeHtml(activeSlot.name)}-Lager <span class="idle-sammlung-count">${slotOwned.length} von ${totalOwned} gesamt</span></h4>
    <div class="idle-runen-inventory-scroll">
      <div class="idle-runen-inventory" id="idleRunenInventory">
      ${slotOwned.length ? slotOwned.map(r => {
        const rarity = window.BKMP_RUNE_RARITIES.find(x => x.id === r.rarity);
        const isViewing = r._cid === bkmpRuneCurrentlyViewing;
        const inFuseMode = !!bkmpRuneFuseSelection;
        const isFuseEligible = inFuseMode && r.rarity === bkmpRuneFuseSelection.rarityId && !r.equipped;
        const isFuseSelected = inFuseMode && bkmpRuneFuseSelection.cids.includes(r._cid);
        const fuseClasses = inFuseMode ? `${isFuseSelected ? 'is-fuse-selected' : ''} ${isFuseEligible ? 'is-fuse-eligible' : 'is-fuse-ineligible'}` : '';
        return `
        <button type="button" class="idle-runen-item ${r.equipped ? 'is-equipped' : ''} ${isViewing && !inFuseMode ? 'is-viewing' : ''} ${fuseClasses}" data-cid="${r._cid}" style="--rune-color:${rarity.color}" title="${escapeHtml(rarity.name)}${r.upgrade_level ? ' +' + r.upgrade_level : ''}${r.equipped ? ' (eingesetzt)' : ''}">
          <img src="assets/runes/${activeSlot.id}-${r.rarity}.png?v=${BKMP_RUNE_IMG_V}" alt="${escapeHtml(rarity.name)}">
          ${r.equipped ? '<span class="idle-runen-equipped-badge">✓</span>' : ''}
          ${isFuseSelected ? '<span class="idle-runen-equipped-badge idle-runen-fuse-check">✓</span>' : ''}
          ${r.upgrade_level ? `<span class="idle-runen-count-badge idle-runen-level-badge">+${r.upgrade_level}</span>` : ''}
        </button>`;
      }).join('') : `<p class="idle-runen-stat-placeholder">Noch keine ${escapeHtml(activeSlot.name)} gefunden - beim Kämpfen und bei Bossen droppen zufällig neue.</p>`}
      </div>
    </div>
  `;

  bkmpRuneSyncDrawerVisibility();

  panel.querySelectorAll('.idle-runen-slot-tab').forEach(btn => btn.addEventListener('click', () => bkmpRuneSelectSlotTab(btn.dataset.slot)));
  drawerContent.querySelectorAll('.idle-runen-item').forEach(btn => btn.addEventListener('click', () => {
    if (bkmpRuneFuseSelection) { bkmpRuneToggleFuseCandidate(btn.dataset.cid); return; }
    bkmpRuneCurrentlyViewing = btn.dataset.cid;
    bkmpIdleRenderRunenPanel();
  }));
  /* NACHBESSERUNG (Nutzerwunsch): ein Klick auf die eingesetzte Rune im
     Kreis hat sie bisher SOFORT entfernt (bkmpRuneToggleEquip direkt) - das
     wirkte wie ein Versehen-Trigger, da man dort eigentlich nur die Rune
     ansehen/aufwerten wollte. Jetzt wechselt der Klick stattdessen nur auf
     den passenden Reiter und waehlt genau diese (eingesetzte) Rune zur
     Ansicht aus - "Entfernen" bleibt weiterhin ein expliziter Button in der
     Detailbox (idleRuneEquipBtn), nicht mehr am Kreis selbst. */
  panel.querySelectorAll('.idle-runen-equip-slot').forEach(btn => btn.addEventListener('click', () => bkmpRuneSelectSlotTab(btn.dataset.slot)));
  const equipBtn = document.getElementById('idleRuneEquipBtn');
  if (equipBtn) equipBtn.addEventListener('click', () => bkmpRuneToggleEquip(equipBtn.dataset.cid));
  const upgradeBtn = document.getElementById('idleRuneUpgradeBtn');
  if (upgradeBtn) upgradeBtn.addEventListener('click', () => bkmpRuneUpgrade(upgradeBtn.dataset.cid));
  const fuseBtn = document.getElementById('idleRuneFuseBtn');
  if (fuseBtn) fuseBtn.addEventListener('click', () => bkmpRuneStartFuseSelection(fuseBtn.dataset.rarity));
  const sellBtn = document.getElementById('idleRuneSellBtn');
  if (sellBtn) sellBtn.addEventListener('click', () => bkmpRuneSell(sellBtn.dataset.cid));
  const fuseConfirmBtn = document.getElementById('idleRuneFuseConfirmBtn');
  if (fuseConfirmBtn) fuseConfirmBtn.addEventListener('click', bkmpRuneConfirmFuseSelection);
  const fuseCancelBtn = document.getElementById('idleRuneFuseCancelBtn');
  if (fuseCancelBtn) fuseCancelBtn.addEventListener('click', bkmpRuneCancelFuseSelection);
  panel.querySelectorAll('.idle-runen-fuse-quick-btn').forEach(btn => btn.addEventListener('click', () => bkmpRuneQuickSelectFuse(Number(btn.dataset.count))));
  const runenHelpBtn = document.getElementById('idleRunenHelpBtn');
  if (runenHelpBtn) runenHelpBtn.addEventListener('click', bkmpIdleOpenRunenHelp);
}

/* ---------------- Tabs & Modal ---------------- */

const bkmpIdleTabs = [
  { id: 'kampf', btn: 'idleTabBtnKampf', panel: 'idlePanelKampf', render: null },
  { id: 'upgrades', btn: 'idleTabBtnUpgrades', panel: 'idlePanelUpgrades', render: bkmpIdleRenderUpgradesPanel },
  { id: 'skilltree', btn: 'idleTabBtnSkilltree', panel: 'idlePanelSkilltree', render: bkmpIdleRenderSkilltreePanel },
  { id: 'sammlung', btn: 'idleTabBtnSammlung', panel: 'idlePanelSammlung', render: bkmpIdleRenderSammlungPanel },
  { id: 'erfolge', btn: 'idleTabBtnErfolge', panel: 'idlePanelErfolge', render: bkmpIdleRenderErfolgePanel },
  { id: 'bestenliste', btn: 'idleTabBtnBestenliste', panel: 'idlePanelBestenliste', render: bkmpIdleRenderBestenlistePanel },
  { id: 'prestige', btn: 'idleTabBtnPrestige', panel: 'idlePanelPrestige', render: bkmpIdleRenderPrestigePanel },
  { id: 'runen', btn: 'idleTabBtnRunen', panel: 'idlePanelRunen', render: bkmpIdleRenderRunenPanel }
];
let bkmpIdleActiveTab = 'kampf';

function bkmpIdleRenderActiveTabContent() {
  const tab = bkmpIdleTabs.find(t => t.id === bkmpIdleActiveTab);
  if (tab && typeof tab.render === 'function') tab.render();
}

/* Haelt Tabs, deren Inhalt (Kauf-Buttons/Runen-Lager) von automatischen
   Kaempfen im Hintergrund abhaengt, waehrend des Zusehens live aktuell -
   vorher aenderte sich z.B. ein "zu teuer"-Button erst nach manuellem
   Tab-Wechsel zu "kaufbar", und neu gedroppte Runen tauchten im offenen
   Runen-Fenster erst nach dem Wechsel weg-und-zurueck auf (Spieler-Meldung:
   "Aktualisieren sich nicht im Runen fenster automatisch.. erst nach tab
   switch" / "Kann man in dem Runenfenster bleiben und beobachten wenn sie
   gedropt werden?"). Bewusst NICHT alle Tabs bei jedem Kill neu rendern
   (z.B. Skilltree zeichnet zusaetzlich SVG-Linien per getBoundingClientRect,
   das waere bei hoher Angriffsgeschwindigkeit unnoetig teuer) - nur die drei
   Tabs, deren Anzeige tatsaechlich direkt von Gold/Ressourcen/Runen-Lager
   abhaengt, die sich durch einen Kill aendern koennen. */
function bkmpIdleRefreshLiveTabs() {
  if (bkmpIdleActiveTab === 'upgrades') bkmpIdleRenderUpgradesPanel();
  else if (bkmpIdleActiveTab === 'runen') bkmpIdleRenderRunenPanel();
  else if (bkmpIdleActiveTab === 'prestige') bkmpIdleRenderPrestigePanel();
}

function bkmpIdleInitTabs() {
  bkmpIdleTabs.forEach(t => {
    const btn = document.getElementById(t.btn);
    if (!btn) return;
    btn.addEventListener('click', () => {
      bkmpIdleActiveTab = t.id;
      bkmpIdleTabs.forEach(other => {
        const b = document.getElementById(other.btn);
        const p = document.getElementById(other.panel);
        if (b) b.classList.toggle('active', other.id === t.id);
        if (p) p.style.display = other.id === t.id ? '' : 'none';
      });
      if (typeof t.render === 'function') t.render();
      /* Der Lager-Balken haengt am rechten Bildschirmrand ausserhalb der
         Karte (siehe .idle-runen-drawer) - muss deshalb bei JEDEM
         Tab-Wechsel explizit ein-/ausgeblendet werden, nicht nur beim
         Runen-Tab selbst (sonst bliebe er beim Wechsel zu einem anderen
         Tab faelschlich sichtbar). */
      bkmpRuneSyncDrawerVisibility();
    });
  });
  const drawerToggle = document.getElementById('idleRuneDrawerToggle');
  if (drawerToggle) drawerToggle.addEventListener('click', bkmpRuneToggleDrawer);
  window.addEventListener('resize', bkmpRuneSyncDrawerPosition);
}

/* ---------------- Live-Sync zwischen Hauptseite und Twitch-Overlay ----------------
   Nutzerwunsch (15.07.): "auf der Hauptseite geupgraded wird / oder Stufe
   Skills etc / und hier im TwitchBrowser alles sync ist" - Fortschritt, der
   auf der Twitch-Seite (idle-stream.html/idle-stream-mini.html) gespielt
   wird, soll auf der Hauptseite live sichtbar sein. Um Konflikte durch
   gleichzeitiges Spielen an zwei Stellen zu vermeiden (Entscheidung mit dem
   Nutzer, 15.07.): die Twitch-Seite ist die aktive Instanz, die Hauptseite
   wird waehrend die Twitch-Seite offen ist zu einer reinen Zuschauer-
   Ansicht (Bedienung gesperrt, eigener Kampf-Loop pausiert, Stand kommt
   stattdessen periodisch direkt aus der DB).

   window.BKMP_IDLE_IS_STREAM_PAGE (gesetzt in idle-stream.html/idle-
   stream-mini.html VOR dieser Datei, auf der Hauptseite nicht gesetzt)
   entscheidet, welche der beiden Rollen eine Seite spielt:
   - Twitch-Seite: sendet alle 20s einen Herzschlag (bkmpIdleStreamHeartbeat).
   - Hauptseite: prueft alle 8s, ob ein frischer Herzschlag da ist
     (loadIdleStreamPresence) und sperrt/entsperrt sich entsprechend.

   WICHTIG (bewusste Grenze): nur der PERSISTENTE Fortschritt (Level/Gold/
   Rohstoffe/Skillpunkte/Upgrades/Stufe/Prestige/Runen) wird gespiegelt -
   der laufende Kampf selbst (aktuelle Drachen-HP/Dorf-HP) lebt nur lokal
   im RAM der aktiven Seite und wird nirgends in der DB gespeichert, kann
   also nicht mitgespiegelt werden. Die Zuschauer-Ansicht zeigt deshalb
   immer einen neu gespawnten Drachen bei voller HP, aktualisiert aber
   Level/Ressourcen/Skilltree/Runen alle paar Sekunden korrekt. */
const BKMP_IDLE_STREAM_HEARTBEAT_MS = 20000;
const BKMP_IDLE_STREAM_POLL_MS = 8000;
const BKMP_IDLE_STREAM_STALE_MS = 35000; // > 1x Herzschlag-Intervall + Puffer
let bkmpIdleStreamTimer = null;
let bkmpIdleStreamLocked = false;

function bkmpIdleStreamStartHeartbeat() {
  if (bkmpIdleStreamTimer || !bkmpIdleState) return;
  const send = () => {
    if (typeof bkmpIdleStreamHeartbeat === 'function' && bkmpIdleState) bkmpIdleStreamHeartbeat(bkmpIdleState.name_key).catch(() => {});
  };
  send();
  bkmpIdleStreamTimer = window.setInterval(send, BKMP_IDLE_STREAM_HEARTBEAT_MS);
}

function bkmpIdleStreamStartPresencePoll() {
  if (bkmpIdleStreamTimer || !bkmpIdleState) return;
  const check = async () => {
    if (typeof loadIdleStreamPresence !== 'function' || !bkmpIdleState) return;
    let lastSeen = null;
    try { lastSeen = await loadIdleStreamPresence(bkmpIdleState.name_key); } catch (e) { return; }
    const isLive = !!lastSeen && (Date.now() - new Date(lastSeen).getTime()) < BKMP_IDLE_STREAM_STALE_MS;
    if (isLive !== bkmpIdleStreamLocked) {
      await bkmpIdleStreamApplyLockState(isLive);
    } else if (isLive) {
      await bkmpIdleStreamRefreshRemoteState();
    }
  };
  check();
  bkmpIdleStreamTimer = window.setInterval(check, BKMP_IDLE_STREAM_POLL_MS);
}

function bkmpIdleStreamStopPolling() {
  if (bkmpIdleStreamTimer) { window.clearInterval(bkmpIdleStreamTimer); bkmpIdleStreamTimer = null; }
}

/* Sperrt/entsperrt die Bedienung der Hauptseite je nachdem, ob die Twitch-
   Seite gerade als "live" erkannt wurde. Nur auf der Hauptseite relevant -
   #idleStreamLiveBanner existiert nur dort (null-sicher). */
async function bkmpIdleStreamApplyLockState(isLive) {
  bkmpIdleStreamLocked = isLive;
  const overlay = document.getElementById('idleDorfOverlay');
  if (overlay) overlay.classList.toggle('idle-stream-locked', isLive);
  const banner = document.getElementById('idleStreamLiveBanner');
  if (banner) banner.style.display = isLive ? '' : 'none';
  if (isLive) {
    bkmpIdleStopLoop();
    await bkmpIdleStreamRefreshRemoteState();
  } else {
    /* Zurueck zur eigenen Kontrolle: einen wirklich frischen, eigenstaendigen
       Stand laden statt mit dem zuletzt gespiegelten (evtl. veralteten)
       Stand weiterzuspielen. bkmpIdleLoadOrInitState() hat einen Cache-
       Kurzschluss fuer gleichbleibenden Namen - deshalb bkmpIdleState hier
       bewusst erst leeren. */
    const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : (bkmpIdleState ? bkmpIdleState.name_key : '');
    bkmpIdleState = null;
    if (name) {
      await bkmpIdleLoadOrInitState(name);
      bkmpIdleRecomputeEffectiveStats();
      if (!bkmpIdleCurrentDragon) bkmpIdleSpawnDragon();
      bkmpIdleStartLoop();
    }
  }
  bkmpIdleRenderHud();
  bkmpIdleRenderStageBar();
  bkmpIdleRenderActiveTabContent();
}

/* Holt den aktuellen, persistenten Stand direkt aus der DB und ersetzt
   damit den lokalen Zuschauer-Stand - laesst den laufenden Kampf-Loop
   bewusst aus (siehe Erklaerung oben, Drachen-HP wird nirgends
   gespeichert). */
async function bkmpIdleStreamRefreshRemoteState() {
  if (!bkmpIdleState) return;
  const name = bkmpIdleState.name_key;
  try {
    const remote = typeof loadIdlePlayerState === 'function' ? await loadIdlePlayerState(name) : null;
    if (remote) {
      bkmpIdleState = remote;
      bkmpIdleCurrentDragon = null;
    }
  } catch (e) { /* naechster Poll-Durchlauf versucht es erneut */ }
  try {
    const remotePrestige = typeof loadIdlePrestigeState === 'function' ? await loadIdlePrestigeState(name) : null;
    if (remotePrestige) bkmpPrestigeState = remotePrestige;
  } catch (e) {}
  try {
    const remoteRunes = typeof loadPlayerRunes === 'function' ? await loadPlayerRunes(name) : null;
    if (Array.isArray(remoteRunes)) bkmpIdlePlayerRunes = remoteRunes.map(r => ({ ...r, _cid: r.id }));
  } catch (e) {}
  bkmpIdleRecomputeEffectiveStats();
  if (!bkmpIdleCurrentDragon) bkmpIdleSpawnDragon();
  bkmpIdleVillageHp = bkmpIdleEffectiveStats ? bkmpIdleEffectiveStats.hp : bkmpIdleVillageHp;
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleUpdateDragonHpBar();
  bkmpIdleRenderHud();
  bkmpIdleRenderStageBar();
  /* Bewusst der generische Renderer statt bkmpIdleRefreshLiveTabs() (das
     deckt nur Upgrades/Runen/Prestige ab) - beim Zuschauen soll JEDER
     gerade offene Tab (auch Skilltree/Sammlung/Erfolge/Bestenliste) den
     gespiegelten Stand zeigen, nicht nur die drei "live-relevanten" Tabs
     aus dem normalen Eigenspiel-Betrieb. */
  bkmpIdleRenderActiveTabContent();
}

async function bkmpIdleOpenModal() {
  /* Immer frisch pruefen statt auf den zuletzt gepollten Stand zu
     vertrauen - so entscheidet exakt der Stand im Moment des Klicks,
     nicht ein bis zu 20s alter Cache. */
  await bkmpIdleRefreshMaintenanceFlag();
  if (bkmpIdleMaintenanceActive) {
    const maintOverlay = document.getElementById('idleMaintenanceOverlay');
    const maintMsg = document.getElementById('idleMaintenanceMessage');
    if (maintMsg) maintMsg.textContent = bkmpIdleMaintenanceMessage;
    if (maintOverlay) maintOverlay.classList.add('visible');
    return;
  }
  const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
  if (!name) {
    const mcNameBadge = document.getElementById('mcNameBadge');
    if (mcNameBadge) mcNameBadge.click();
    return;
  }
  const overlay = document.getElementById('idleDorfOverlay');
  if (!overlay) return;
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');
  bkmpIdleModalOpen = true;

  await bkmpIdleEnsureConfigLoaded();
  await bkmpIdleLoadOrInitState(name);
  if (!bkmpIdleState) {
    /* Echter Ladefehler (siehe bkmpIdleLoadOrInitState) - auf keinen Fall mit
       leerem/kaputtem Spielstand weitermachen, sonst droht ein Autosave mit
       Nullen. Fenster wieder schliessen und zum Neuversuch auffordern. */
    overlay.classList.remove('visible');
    document.body.classList.remove('modal-open');
    bkmpIdleModalOpen = false;
    if (typeof bkmpShowJannikToast === 'function') {
      bkmpShowJannikToast('Dein Spielstand konnte nicht geladen werden (Verbindungsproblem). Bitte versuche es gleich nochmal, damit nichts überschrieben wird.', 6000);
    }
    return;
  }
  bkmpIdleRecomputeEffectiveStats();

  const offlineResult = await bkmpIdleClaimOfflineProgress(name);
  if (offlineResult) bkmpIdleApplyOfflineResult(offlineResult);
  bkmpIdleShowOfflineCard(offlineResult);
  bkmpIdleRecomputeEffectiveStats();

  if (!bkmpIdleCurrentDragon) bkmpIdleSpawnDragon();
  /* Auch wenn der Drache schon im Speicher war (Fenster nur geschlossen,
     nicht neu geladen) - erneut pruefen, ob es sich um einen noch nicht
     bestaetigten Event-Drachen handelt. Das Popup MUSS bei jedem
     Wiedereroeffnen des Fensters erneut erscheinen, solange der Kampf noch
     nicht mit dem Bereit-Button gestartet wurde (siehe Auftrag Abschnitt 3). */
  bkmpIdleMaybeShowEventDragonPopup();
  bkmpIdleRenderHud();
  bkmpIdleRenderStageBar();
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleUpdateDragonHpBar();
  bkmpIdleStartLoop();
  bkmpIdleRenderActiveTabContent();
  if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
  if (window.BKMP_IDLE_IS_STREAM_PAGE) bkmpIdleStreamStartHeartbeat();
  else bkmpIdleStreamStartPresencePoll();

  bkmpRaidRenderJoinBanner();
  if (bkmpRaidShouldShowCombatView()) {
    bkmpIdleStopLoop();
    bkmpRaidStartCombatView(bkmpRaidGetPhaseInfo().raidId);
  }
}

/* NACHBESSERUNG (Spieler-Wunsch): frueher stoppte das Schliessen des
   Fensters den Kampf-Loop komplett ("Fenster zu = Spiel pausiert"), obwohl
   der Spieler ja weiterhin auf der Seite blieb - beim naechsten Oeffnen sah
   es dann so aus, als waere in der Zwischenzeit gar nichts passiert
   (Offline-Fortschritt-Logik griff, weil serverseitig kein Sync in der
   Zwischenzeit ankam). bkmpIdleStopLoop() wird hier bewusst NICHT mehr
   aufgerufen - der Kampf laeuft im Hintergrund weiter (Gold/XP/Kills), auch
   ohne offenes Fenster, solange der Tab offen bleibt. Der Raid-Kampf bleibt
   davon unberuehrt (bkmpRaidStopCombatView pausiert weiterhin gezielt nur
   die Live-Raid-Ansicht, die echt das offene Fenster braucht). */
function bkmpIdleCloseModal() {
  const overlay = document.getElementById('idleDorfOverlay');
  if (overlay) overlay.classList.remove('visible');
  document.body.classList.remove('modal-open');
  bkmpIdleModalOpen = false;
  bkmpRuneSyncDrawerVisibility();
  bkmpIdleStreamStopPolling();
  bkmpIdleQueueSync();
  bkmpIdleFlushSync();
  bkmpRaidStopCombatView();
}

function bkmpIdlePreloadStateIfNamed() {
  const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
  if (!name) return;
  bkmpIdleLoadOrInitState(name)
    .then(() => { if (typeof renderAchievementBadge === 'function') renderAchievementBadge(true); })
    .catch(() => {});
  bkmpRaidRefreshAchievementCache();
}

/* ---------------- Autoklicker-Erkennung: Muster statt reiner Frequenz ----------------
   Vorher: feste Grenze "mehr als 10 Klicks/Sekunde = Autoklicker" - hat
   schnelle, aber echte Spieler faelschlich blockiert (Menschen KOENNEN
   kurzzeitig >10 Klicks/s erreichen). Jetzt: bewertet stattdessen, wie
   GLEICHMAESSIG die Abstaende zwischen den letzten Klicks sind
   (Variationskoeffizient = Standardabweichung / Mittelwert der Intervalle).
   Ein Mensch klickt auch beim schnellen, konzentrierten Klicken nie ueber
   laengere Zeit in nahezu identischen Millisekunden-Abstaenden - ein
   Autoklicker/Makro dagegen schon (meist Abweichungen im niedrigen
   Prozentbereich statt der natuerlichen ~20-40%+ eines Menschen).
   Reagiert erst, wenn (a) genug Datenpunkte gesammelt wurden UND das
   gleichmaessige Muster durchgehend mindestens BKMP_AUTOCLICK_MIN_SPAN_MS
   (30 Sekunden) angehalten hat (kein Fehlalarm durch einen kurzen
   zufaelligen gleichmaessigen Abschnitt), UND (b) die Klicks auch schnell
   genug sind (langsames, zufaellig gleichmaessiges Klicken ist weder
   verdaechtig noch spielerisch ausnutzbar) - erst wenn ALLE Indikatoren
   gemeinsam zutreffen, gilt es als Autoklicker-Muster.
   Reaktion bleibt wie zuvor: kurzzeitige Sperre + Hinweis-Toast, danach
   automatisch wieder frei - keine dauerhafte Sperre. Gemeinsam genutzt von
   Idle-Dorf-Klicks (bkmpIdleHandleDragonClick) UND Raid-Klicks
   (bkmpRaidHandleBossClick), damit beide Stellen exakt dasselbe,
   einmal getestete Muster nutzen. */
/* BKMP_AUTOCLICK_WINDOW ist bewusst ein reiner NOTBREMSE-Deckel gegen
   unbegrenztes Array-Wachstum, NICHT Teil der eigentlichen Erkennungslogik -
   das war vorher ein echter Bug: bei 300 Eintraegen gedeckelt UND
   gleichzeitig muss die Zeitspanne mindestens MIN_SPAN_MS betragen. Bei
   jedem Klick-Tempo schneller als MIN_SPAN_MS/WINDOW wurde das Array schon
   durch das Mengenlimit gestutzt, BEVOR die Zeitspanne ueberhaupt erreicht
   werden konnte - die Pruefung war dadurch bei schnellen Autoklickern
   NIEMALS erfuellbar, egal wie lange gewartet wurde (live durch einen
   Community-Test bestaetigt: 80ms-Autoklicker 60s laufen lassen -> nie
   ausgeloest, spaeter sogar bei 1ms/Klick 30s am Stueck reproduziert). Hoch
   genug angesetzt (65000 Eintraege = volle HISTORY_MS-Spanne noch bei
   1ms/Klick, extremer als jeder reale Autoklicker), damit der Zeit-Filter
   (HISTORY_MS) allein die Begrenzung uebernimmt und nie vorzeitig eingreift.

   Absichtliche Design-Entscheidung (nach Spieler-Feedback): kurze, intensive
   Klick-Ausbrueche (z.B. 30-60s "Hass-Klicken" beim Raidboss oder
   Event-Drachen) sollen NIEMALS ausgeloest werden, egal wie schnell/
   gleichmaessig - nur wer wirklich DAUERHAFT/AFK mit einem Autoklicker
   spielt, soll erwischt werden. Deshalb MIN_SPAN_MS auf 60s angehoben (unter
   60s Dauerklicken triggert nie) UND die Sperre bei echtem Auftreten von
   frueher nur 4s auf 10 Minuten verlaengert - eine 4s-Sperre war praktisch
   kostenlos umgehbar (alle 30s kurz pausieren, sofort weiterklicken), 10
   Minuten machen dauerhaftes Autoklicken tatsaechlich unattraktiv. */
const BKMP_AUTOCLICK_WINDOW = 65000;
const BKMP_AUTOCLICK_MIN_SAMPLES = 15;
const BKMP_AUTOCLICK_MIN_SPAN_MS = 60000;
const BKMP_AUTOCLICK_MAX_AVG_INTERVAL_MS = 260;
const BKMP_AUTOCLICK_CV_THRESHOLD = 0.12;
const BKMP_AUTOCLICK_LOCK_MS = 10 * 60 * 1000;
const BKMP_AUTOCLICK_HISTORY_MS = 62000; // etwas mehr als MIN_SPAN_MS, sonst wuerden aeltere, fuer die 60s-Pruefung noetige Zeitstempel schon vorher weggefiltert
const BKMP_AUTOCLICK_TOAST = 'Deine Klicks wirken verdächtig gleichmäßig – kurze Pause fürs Handgelenk 😉';

/* Zusaetzliche harte Obergrenze (unabhaengig von der Muster-Erkennung
   oben): die CV-Pruefung erkennt nur SEHR gleichmaessige Abstaende - ein
   Skript, das absichtlich mit leichtem Zufalls-Jitter klickt, koennte die
   Muster-Erkennung umgehen und trotzdem z.B. 50x/Sekunde klicken. 10
   Klicks/Sekunde (= 100ms Abstand) sind fuer echtes, auch sehr hektisches
   Hass-Klicken locker erreichbar, fuer dauerhaftes/automatisiertes Klicken
   aber bereits eine spuerbare Bremse - schliesst die Luecke, ohne echte
   kurze Ausbrueche zu beeintraechtigen. */
const BKMP_CLICK_RATE_CAP_MS = 100;
let bkmpIdleLastClickAt = 0;
let bkmpRaidLastClickAt = 0;

/* Sofort-Sperre bei eindeutigem Extrem-Ausbruch: 20+ Klick-VERSUCHE
   innerhalb einer Sekunde (auch die vom 100ms-Ratenlimit ohnehin
   verworfenen zaehlen mit, deshalb ein eigener Zaehler VOR dem Ratenlimit-
   Check) sind fuer einen Menschen unmoeglich und eindeutig ein Bot/Skript -
   loest dieselbe 10-Minuten-Sperre wie die 60s-Mustererkennung aus, aber
   sofort statt erst nach einer vollen Minute Beobachtung. */
const BKMP_BURST_CLICK_THRESHOLD = 20;
const BKMP_BURST_WINDOW_MS = 1000;
let bkmpIdleClickBurst = [];
let bkmpRaidClickBurst = [];

/* Sperre + Klick-Verlauf muessen einen Seiten-Reload ueberleben - sonst
   waere der ganze Autoklicker-Schutz kostenlos umgehbar (Reload sobald
   gesperrt hebt die Sperre sofort auf; regelmaessiges Reload alle ~55s
   verhindert sogar, dass die 60s-Mustererkennung je zuschlaegt). Deshalb
   in localStorage statt nur im Skript-Speicher. */
const BKMP_IDLE_CLICK_LOCK_KEY = 'bkmp-idle-click-locked-until';
const BKMP_IDLE_CLICK_HISTORY_KEY = 'bkmp-idle-click-timestamps';
const BKMP_RAID_CLICK_LOCK_KEY = 'bkmp-raid-click-locked-until';
const BKMP_RAID_CLICK_HISTORY_KEY = 'bkmp-raid-click-timestamps';
function bkmpAutoclickLoadNumber(key) {
  try { return Number(localStorage.getItem(key) || 0) || 0; } catch (e) { return 0; }
}
function bkmpAutoclickSaveNumber(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) {}
}
function bkmpAutoclickLoadTimestamps(key) {
  try { const arr = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(arr) ? arr : []; } catch (e) { return []; }
}
function bkmpAutoclickSaveTimestamps(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
}

function bkmpIdleDetectAutoclickPattern(timestamps) {
  if (!timestamps || timestamps.length < BKMP_AUTOCLICK_MIN_SAMPLES) return false;
  /* Absichtlich KEIN erneutes .slice() hier - das hatte denselben Bug nur
     eine Ebene tiefer reproduziert. timestamps kommt bereits zeitlich
     korrekt begrenzt vom Aufrufer (HISTORY_MS-Filter). */
  const recent = timestamps;
  /* Muss ueber mindestens 30 Sekunden hinweg angehalten haben - ein kurzer,
     zufaellig gleichmaessiger Klick-Ausbruch (z.B. 1-2s) reicht bewusst
     nicht aus, egal wie niedrig dessen Variationskoeffizient ausfaellt. */
  if (recent[recent.length - 1] - recent[0] < BKMP_AUTOCLICK_MIN_SPAN_MS) return false;
  const intervals = [];
  for (let i = 1; i < recent.length; i++) intervals.push(recent[i] - recent[i - 1]);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (!(mean > 0) || mean > BKMP_AUTOCLICK_MAX_AVG_INTERVAL_MS) return false;
  const variance = intervals.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / intervals.length;
  const coefficientOfVariation = Math.sqrt(variance) / mean;
  return coefficientOfVariation < BKMP_AUTOCLICK_CV_THRESHOLD;
}

let bkmpIdleClickTimestamps = bkmpAutoclickLoadTimestamps(BKMP_IDLE_CLICK_HISTORY_KEY);
let bkmpIdleClickLockedUntil = bkmpAutoclickLoadNumber(BKMP_IDLE_CLICK_LOCK_KEY);

function bkmpIdleSpawnClickDamage(amount) {
  const target = document.getElementById('idleDragon');
  if (!target) return;
  const dmg = document.createElement('span');
  dmg.className = 'idle-dmg-float idle-dmg-click';
  dmg.textContent = '-' + Math.round(amount);
  target.appendChild(dmg);
  window.setTimeout(() => dmg.remove(), 800);
}

function bkmpIdleHandleDragonClick() {
  if (!bkmpIdleModalOpen || !bkmpIdleState || !bkmpIdleCurrentDragon || !bkmpIdleEffectiveStats) return;
  /* Kein Klickschaden, solange das Vorbereitungs-Popup eines Event-
     Drachen noch nicht bestaetigt wurde. */
  if (bkmpIdleEventPauseActive) return;

  const now = Date.now();
  if (now < bkmpIdleClickLockedUntil) return;

  bkmpIdleClickBurst = bkmpIdleClickBurst.filter(t => now - t <= BKMP_BURST_WINDOW_MS);
  bkmpIdleClickBurst.push(now);
  if (bkmpIdleClickBurst.length >= BKMP_BURST_CLICK_THRESHOLD) {
    bkmpIdleClickLockedUntil = now + BKMP_AUTOCLICK_LOCK_MS;
    bkmpIdleClickBurst = [];
    bkmpIdleClickTimestamps = [];
    bkmpAutoclickSaveNumber(BKMP_IDLE_CLICK_LOCK_KEY, bkmpIdleClickLockedUntil);
    bkmpAutoclickSaveTimestamps(BKMP_IDLE_CLICK_HISTORY_KEY, bkmpIdleClickTimestamps);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(BKMP_AUTOCLICK_TOAST, 3200);
    return;
  }

  if (now - bkmpIdleLastClickAt < BKMP_CLICK_RATE_CAP_MS) return;
  bkmpIdleLastClickAt = now;
  bkmpIdleClickTimestamps.push(now);
  bkmpIdleClickTimestamps = bkmpIdleClickTimestamps.filter(t => now - t <= BKMP_AUTOCLICK_HISTORY_MS).slice(-BKMP_AUTOCLICK_WINDOW);
  bkmpAutoclickSaveTimestamps(BKMP_IDLE_CLICK_HISTORY_KEY, bkmpIdleClickTimestamps);
  if (bkmpIdleDetectAutoclickPattern(bkmpIdleClickTimestamps)) {
    bkmpIdleClickLockedUntil = now + BKMP_AUTOCLICK_LOCK_MS;
    bkmpIdleClickTimestamps = [];
    bkmpAutoclickSaveNumber(BKMP_IDLE_CLICK_LOCK_KEY, bkmpIdleClickLockedUntil);
    bkmpAutoclickSaveTimestamps(BKMP_IDLE_CLICK_HISTORY_KEY, bkmpIdleClickTimestamps);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(BKMP_AUTOCLICK_TOAST, 3200);
    return;
  }

  const clickDamage = Math.max(1, Math.round(bkmpIdleEffectiveStats.attack * (0.12 + (bkmpIdleEffectiveStats.clickDamagePct || 0) / 100)));
  bkmpIdleCurrentDragon.hp = Math.max(0, bkmpIdleCurrentDragon.hp - clickDamage);
  bkmpIdleSpawnClickDamage(clickDamage);
  bkmpIdleSpawnHitFlash('idleDragon');
  bkmpIdleUpdateDragonHpBar();

  if (bkmpIdleCurrentDragon.hp <= 0) {
    bkmpIdleHandleDragonDefeated();
  } else {
    /* Ueberlebt der Drache den Klick, schlaegt er jetzt genau wie beim Tick
       zurueck - siehe bkmpIdleDragonCounterAttack. Nur der wirklich
       toedliche Treffer (oben) bleibt weiterhin gegenschlagfrei. */
    bkmpIdleDragonCounterAttack(bkmpIdleEffectiveStats);
  }
}

/* ============================================================
   Weltboss/Raid-Event (stuendlich, siehe supabase-raid-boss-schema.sql)

   Zeitmodell: rein UTC-Uhrzeit-basiert, komplett ohne Server-Cron. Minute
   55-59 jeder Stunde = Vorbereitungsphase fuer den Raid der NAECHSTEN vollen
   Stunde, Minute 0-54 = laufender Kampf des AKTUELLEN Stunden-Raids (endet
   spaetestens Minute 55, danach 'expired' falls Boss/Stadt bis dahin nicht
   entschieden). bkmpRaidCurrentId() (supabase.js) liefert dieselbe
   'YYYYMMDDHH24'-ID wie die SQL-Seite - jeder Client kommt unabhaengig auf
   dieselbe Raid-ID, kein Abstimmen noetig. Boss-HP/Stadt-HP sind
   serverseitig autoritativ (siehe RPCs) - hier wird nur zur Anzeige/fuer
   sofortiges visuelles Feedback lokal simuliert, der tatsaechliche Zaehler
   kommt immer aus der RPC-Antwort bzw. per Realtime von anderen Spielern. */

const BKMP_RAID_JOINED_KEY_PREFIX = 'bkmp-raid-joined-';
const BKMP_RAID_TICK_MS = 2500;
const BKMP_RAID_BOSS_POLL_MS = 1500;

let bkmpRaidState = null;
let bkmpRaidParticipants = [];
let bkmpRaidJoinedId = null;
let bkmpRaidButtonTimer = null;
let bkmpRaidLoopTimer = null;
let bkmpRaidBossPollTimer = null;
let bkmpRaidResultShown = false;
let bkmpRaidClickTimestamps = bkmpAutoclickLoadTimestamps(BKMP_RAID_CLICK_HISTORY_KEY);
let bkmpRaidClickLockedUntil = bkmpAutoclickLoadNumber(BKMP_RAID_CLICK_LOCK_KEY);

function bkmpRaidGetPhaseInfo(now) {
  const d = now || new Date();
  const minute = d.getUTCMinutes();
  if (minute >= 55) {
    const fightStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1, 0, 0, 0));
    return { phase: 'prep', raidId: bkmpRaidCurrentId(fightStart), fightStartsAt: fightStart.getTime(), msUntilFightStart: fightStart.getTime() - d.getTime() };
  }
  const fightStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0));
  const fightEnd = fightStart.getTime() + 55 * 60000;
  return { phase: 'fight', raidId: bkmpRaidCurrentId(fightStart), fightStartsAt: fightStart.getTime(), fightEndsAt: fightEnd, msUntilFightEnd: fightEnd - d.getTime() };
}

function bkmpRaidFormatCountdown(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function bkmpRaidHasJoined(raidId) {
  try { return localStorage.getItem(BKMP_RAID_JOINED_KEY_PREFIX + raidId) === '1'; } catch (e) { return false; }
}
function bkmpRaidMarkJoined(raidId) {
  try { localStorage.setItem(BKMP_RAID_JOINED_KEY_PREFIX + raidId, '1'); } catch (e) {}
  bkmpRaidJoinedId = raidId;
}

/* ---------------- Button-Feuer/Glow (laeuft immer, auch ohne offenes Fenster) ---------------- */
function bkmpRaidFormatParticipantCount(count) {
  return count > 0 ? `${count} Spieler bereits angemeldet` : 'Sei der/die Erste, die beitritt!';
}

/* Laeuft 1x/Sekunde global (auch ohne offenes Idle-Dorf-Fenster) - zwei
   Aufgaben: 1) Button-Feuer/Countdown immer aktuell halten, 2) falls das
   Beitritts-Banner gerade offen ist, dessen Countdown live weiterzaehlen
   und automatisch in die Kampfansicht wechseln, sobald die
   Vorbereitungsphase endet - vorher blieb der Countdown bei laenger
   geoeffnetem Fenster einfach auf dem Stand beim Oeffnen stehen. */
function bkmpRaidUpdateButtonState() {
  if (bkmpIdleMaintenanceActive) return;
  const btn = document.getElementById('idleDorfButton');
  const countdownEl = document.getElementById('raidBtnCountdown');
  const info = bkmpRaidGetPhaseInfo();
  if (btn) {
    if (info.phase === 'prep') {
      btn.classList.add('raid-prep');
      if (countdownEl) { countdownEl.style.display = ''; countdownEl.textContent = '🔥 ' + bkmpRaidFormatCountdown(info.msUntilFightStart); }
    } else {
      btn.classList.remove('raid-prep');
      if (countdownEl) countdownEl.style.display = 'none';
    }
  }

  const bannerCountdownEl = document.getElementById('raidBannerCountdown');
  if (!bannerCountdownEl) return;
  if (info.phase === 'prep') {
    bannerCountdownEl.textContent = bkmpRaidFormatCountdown(info.msUntilFightStart);
    return;
  }
  const banner = document.getElementById('raidJoinBanner');
  if (banner) banner.style.display = 'none';
  /* Nur EINMAL beim Phasenwechsel prep->fight in die Kampfansicht starten,
     nicht bei jedem Sekunden-Tick erneut - bkmpRaidStartCombatView raeumt
     ueber bkmpRaidStartLoops() die laufenden Intervalle (Boss-Poll 1.5s,
     eigener Schaden-Tick 2.5s) ab und setzt sie neu. Ohne diese Sperre
     wurden beide Intervalle jede Sekunde vor ihrer Faelligkeit wieder
     geloescht und neu gestartet und sind dadurch NIE gefeuert - kompletter
     Kampf-Stillstand trotz aktiver Teilnehmer. */
  if (bkmpRaidLoopTimer) return;
  bkmpUnsubscribeFromRaidInstance();
  if (bkmpIdleModalOpen && bkmpRaidShouldShowCombatView()) {
    bkmpIdleStopLoop();
    bkmpRaidStartCombatView(info.raidId);
  }
}

/* ---------------- Beitritts-Banner (Idle-Dorf-Fenster, Vorbereitungsphase) ---------------- */
function bkmpRaidHandlePrepRealtimeChange(change) {
  if (change.type !== 'instance' || !change.row) return;
  const countEl = document.getElementById('raidBannerParticipants');
  if (countEl) countEl.textContent = bkmpRaidFormatParticipantCount(Number(change.row.participant_count || 0));
}

async function bkmpRaidRenderJoinBanner() {
  const banner = document.getElementById('raidJoinBanner');
  if (!banner) return;
  const info = bkmpRaidGetPhaseInfo();
  if (info.phase !== 'prep') { banner.style.display = 'none'; return; }

  const joined = bkmpRaidHasJoined(info.raidId);
  banner.style.display = '';
  banner.innerHTML = `
    <div class="raid-join-banner-title">🐉 Ein mächtiger Raidboss erscheint in wenigen Minuten!</div>
    <div class="raid-join-banner-countdown" id="raidBannerCountdown">${bkmpRaidFormatCountdown(info.msUntilFightStart)}</div>
    ${joined
      ? '<div class="raid-join-banner-joined">✅ Du bist angemeldet - der Kampf beginnt automatisch.</div>'
      : '<button type="button" class="btn-ja raid-join-banner-btn" id="raidJoinBtn">Jetzt beitreten</button>'}
    <div class="raid-join-banner-participants" id="raidBannerParticipants"></div>
  `;
  const joinBtn = document.getElementById('raidJoinBtn');
  if (joinBtn) joinBtn.addEventListener('click', () => bkmpRaidJoin(info.raidId));

  /* Live-Updates fuer die Teilnehmerzahl waehrend das Banner offen bleibt -
     vorher wurde die Zahl nur EINMAL beim Oeffnen geladen und blieb dann
     stehen, waehrend in Wirklichkeit laufend weitere Spieler beitraten. */
  bkmpSubscribeToRaidInstance(info.raidId, bkmpRaidHandlePrepRealtimeChange);

  try {
    const state = await loadRaidState(info.raidId);
    const countEl = document.getElementById('raidBannerParticipants');
    if (countEl && state) countEl.textContent = bkmpRaidFormatParticipantCount(state.participantCount);
  } catch (e) { /* Raid existiert evtl. noch nicht - kein Problem, erster Beitritt legt sie an */ }
}

async function bkmpRaidJoin(raidId) {
  const joinBtn = document.getElementById('raidJoinBtn');
  if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = 'Wird beigetreten...'; }
  try {
    await joinRaid(raidId);
    bkmpRaidMarkJoined(raidId);
    bkmpRaidRenderJoinBanner();
    bkmpRaidRefreshAchievementCache();
  } catch (e) {
    alert(e && e.message ? e.message : 'Beitritt fehlgeschlagen. Bitte versuche es erneut.');
    if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Jetzt beitreten'; }
  }
}

/* ---------------- Gemeinsame Kampfansicht ---------------- */
function bkmpRaidShouldShowCombatView() {
  const info = bkmpRaidGetPhaseInfo();
  return info.phase === 'fight' && bkmpRaidHasJoined(info.raidId) && bkmpRaidJoinedId !== 'ended-' + info.raidId;
}

function bkmpRaidToggleCombatView(show) {
  const tabs = document.getElementById('idleDorfTabs');
  const combatView = document.getElementById('raidCombatView');
  const panels = document.querySelectorAll('#idleDorfOverlay .idle-dorf-panel:not(#raidCombatView)');
  if (tabs) tabs.style.display = show ? 'none' : '';
  if (combatView) combatView.style.display = show ? '' : 'none';
  panels.forEach(p => { if (show) p.style.display = 'none'; });
  if (!show) {
    const activeTab = bkmpIdleTabs.find(t => t.id === bkmpIdleActiveTab);
    const p = activeTab ? document.getElementById(activeTab.panel) : null;
    if (p) p.style.display = '';
  }
}

async function bkmpRaidStartCombatView(raidId) {
  bkmpRaidResultShown = false;
  const resultCard = document.getElementById('raidResultCard');
  const battlefield = document.getElementById('raidBattlefield');
  if (resultCard) resultCard.style.display = 'none';
  if (battlefield) battlefield.style.display = '';
  bkmpRaidToggleCombatView(true);
  try {
    bkmpRaidState = await loadRaidState(raidId);
    bkmpRaidParticipants = await loadRaidParticipants(raidId);
  } catch (e) {
    console.warn('Raid: Zustand konnte nicht geladen werden.', e);
  }
  /* Der Raid kann laengst zuende sein, ohne dass dieser Client das live
     mitbekommen hat (Fenster war zu, als der Sieg/die Niederlage passiert
     ist - bkmpRaidJoinedId wird nur bei einem live beobachteten Ende auf
     'ended-...' gesetzt, siehe bkmpRaidCheckOutcome). Nur ein WIRKLICH
     abgeschlossener Status (won/lost/expired) zaehlt hier als "vorbei" -
     'prep' NICHT, denn der Serverwechsel prep->fighting passiert erst beim
     ERSTEN Aufruf von raid_boss_attack_tick() (siehe bkmpRaidBossPoll,
     gestartet unten via bkmpRaidStartLoops). Genau am Stundenwechsel steht
     die DB-Zeile fuer die ersten paar hundert Millisekunden also noch auf
     'prep', obwohl die Kampfzeit laut Uhr laengst begonnen hat. Wuerde
     dieser Fall hier faelschlich als "schon vorbei" gewertet, bricht der
     JEWEILS ERSTE Client sofort ab, bevor er ueberhaupt raid_boss_attack_tick
     aufrufen konnte - der Statuswechsel passiert dann NIE, und der Raid
     haengt fuer alle Spieler dauerhaft in 'prep' fest (genau das Symptom
     "Kampf beginnt und schliesst sich direkt wieder"). */
  const raidTerminalStatus = bkmpRaidState && (bkmpRaidState.status === 'won' || bkmpRaidState.status === 'lost' || bkmpRaidState.status === 'expired');
  if (raidTerminalStatus) {
    bkmpRaidJoinedId = 'ended-' + raidId;
    bkmpRaidToggleCombatView(false);
    /* Derselbe Loop-Neustart wie in bkmpRaidCheckOutcome, aber fuer einen
       anderen Fall: dort wird ein Raid-Ende live mitverfolgt (Fenster war
       die ganze Zeit offen). Hier oeffnet der Spieler das Idle-Dorf-Fenster
       NEU (oder erneut), nachdem ein Raid, dem er beigetreten war, LAENGST
       zuende ist, ohne dass dieser Client das live mitbekommen hat -
       bkmpIdleOpenModal stoppt den normalen Kampf-Loop bereits VOR diesem
       Aufruf (weil bkmpRaidShouldShowCombatView() faelschlich noch true
       liefert, solange bkmpRaidJoinedId nicht auf 'ended-...' steht), aber
       niemand startet ihn hier wieder - das Idle-Dorf-Fenster oeffnet sich
       dann zwar normal, der automatische Tick bleibt aber fuer den Rest der
       Sitzung tot ("nichts passiert", genau das gemeldete Symptom). */
    if (bkmpIdleModalOpen) bkmpIdleStartLoop();
    return;
  }
  bkmpRaidRenderCombat();
  bkmpSubscribeToRaidInstance(raidId, bkmpRaidHandleRealtimeChange);
  bkmpRaidStartLoops(raidId);
}

function bkmpRaidStopCombatView() {
  bkmpRaidToggleCombatView(false);
  bkmpRaidStopLoops();
  bkmpUnsubscribeFromRaidInstance();
  /* Der normale Auto-Kampf-Loop wurde beim Betreten der Raid-Ansicht
     gestoppt (bkmpIdleStopLoop, siehe bkmpIdleOpenModal/bkmpRaidUpdateButtonState)
     und muss beim Verlassen wieder anlaufen, sonst bleiben automatische
     Angriffe/Animationen fuer den Rest der Sitzung tot (nur manuelle Klicks
     funktionieren noch, da die eigenstaendig sind) - nur, wenn das
     Idle-Dorf-Fenster ueberhaupt noch offen ist (bkmpIdleCloseModal setzt
     bkmpIdleModalOpen VOR diesem Aufruf bereits auf false und stoppt den
     Loop selbst schon explizit). */
  if (bkmpIdleModalOpen) bkmpIdleStartLoop();
}

function bkmpRaidHandleRealtimeChange(change) {
  if (!bkmpRaidState) return;
  if (change.type === 'instance' && change.row) {
    bkmpRaidState.bossHp = Number(change.row.boss_hp || 0);
    bkmpRaidState.cityHp = Number(change.row.city_hp || 0);
    bkmpRaidState.cityAttack = Number(change.row.city_attack || bkmpRaidState.cityAttack || 0);
    bkmpRaidState.cityDefense = Number(change.row.city_defense || bkmpRaidState.cityDefense || 0);
    bkmpRaidState.status = change.row.status;
    bkmpRaidState.participantCount = Number(change.row.participant_count || 0);
    bkmpRaidRenderCombat();
    bkmpRaidCheckOutcome();
  } else if (change.type === 'participants' && bkmpRaidState) {
    /* Eingehende Zeile direkt einsortieren statt bei JEDEM Tick JEDES
       Mitspielers die komplette Liste neu von der DB zu laden - vermeidet
       die Ruckler/kurzen Rueckspruenge auf veraltete Werte, die durch
       ueberholende parallele Refetches entstanden sind. Nur bei
       unerwartetem Payload-Format (z. B. DELETE ohne "new"-Zeile) auf
       einen echten Refetch zurueckfallen. */
    const row = change.row;
    if (row && row.auth_user_id) {
      const mapped = {
        authUserId: row.auth_user_id,
        displayName: row.display_name,
        damageDealt: Number(row.damage_dealt || 0),
        critsLanded: Number(row.crits_landed || 0),
        clicksLanded: Number(row.clicks_landed || 0),
        joinedAt: row.joined_at ? Date.parse(row.joined_at) : 0
      };
      const idx = bkmpRaidParticipants.findIndex(p => p.authUserId === mapped.authUserId);
      if (idx >= 0) bkmpRaidParticipants[idx] = mapped; else bkmpRaidParticipants.push(mapped);
      bkmpRaidParticipants.sort((a, b) => b.damageDealt - a.damageDealt);
      bkmpRaidRequestParticipantsRender();
    } else {
      loadRaidParticipants(bkmpRaidState.id).then(rows => { bkmpRaidParticipants = rows; bkmpRaidRequestParticipantsRender(); }).catch(() => {});
    }
  }
}

function bkmpRaidRenderCombat() {
  if (!bkmpRaidState) return;
  const nameEl = document.getElementById('raidBossName');
  if (nameEl) nameEl.textContent = `👑 ${bkmpRaidState.bossName || 'Weltboss'}`;
  const bossFill = document.getElementById('raidBossHpFill');
  const bossLabel = document.getElementById('raidBossHpLabel');
  if (bossFill) bossFill.style.width = Math.max(0, Math.min(100, (bkmpRaidState.bossHp / Math.max(1, bkmpRaidState.bossMaxHp)) * 100)) + '%';
  if (bossLabel) bossLabel.textContent = `${bkmpIdleFormatNumber(bkmpRaidState.bossHp)} / ${bkmpIdleFormatNumber(bkmpRaidState.bossMaxHp)}`;
  const cityFill = document.getElementById('raidCityHpFill');
  const cityLabel = document.getElementById('raidCityHpLabel');
  if (cityFill) cityFill.style.width = Math.max(0, Math.min(100, (bkmpRaidState.cityHp / Math.max(1, bkmpRaidState.cityMaxHp)) * 100)) + '%';
  if (cityLabel) cityLabel.textContent = `${bkmpIdleFormatNumber(bkmpRaidState.cityHp)} / ${bkmpIdleFormatNumber(bkmpRaidState.cityMaxHp)}`;
  const cityStatsEl = document.getElementById('raidCityStats');
  if (cityStatsEl) cityStatsEl.textContent = `⚔️ ${bkmpIdleFormatNumber(bkmpRaidState.cityAttack || 0)} · 🛡️ ${bkmpIdleFormatNumber(bkmpRaidState.cityDefense || 0)}`;
  const timerEl = document.getElementById('raidCombatTimer');
  if (timerEl) {
    const info = bkmpRaidGetPhaseInfo();
    timerEl.textContent = info.phase === 'fight' ? '⏳ ' + bkmpRaidFormatCountdown(info.msUntilFightEnd) : '';
  }
  /* Ueber den Throttle statt direkt - bkmpRaidRenderCombat wird bei jedem
     eigenen Tick (2.5s), jedem Boss-Poll (1.5s) UND jedem Realtime-Update
     von ANDEREN Mitspielern aufgerufen. Ohne Throttle wurde die komplette
     Teilnehmerliste (innerHTML) dabei mehrfach pro Sekunde neu gebaut -
     sichtbare kurze Ruckler/Sprünge in der Schadensanzeige. */
  bkmpRaidRequestParticipantsRender();
}

let bkmpRaidParticipantsRenderTimer = null;
function bkmpRaidRequestParticipantsRender() {
  if (bkmpRaidParticipantsRenderTimer) return;
  bkmpRaidParticipantsRenderTimer = window.setTimeout(() => {
    bkmpRaidParticipantsRenderTimer = null;
    bkmpRaidRenderParticipants();
  }, 400);
}

function bkmpRaidRenderParticipants() {
  const list = document.getElementById('raidParticipantsList');
  if (!list) return;
  const myName = typeof bkmpGetMcName === 'function' ? bkmpGetMcName().trim().toLowerCase() : '';
  list.innerHTML = bkmpRaidParticipants.slice(0, 20).map(p => `
    <div class="raid-participant-row ${p.displayName.trim().toLowerCase() === myName ? 'is-me' : ''}">
      <span>${escapeHtml(p.displayName)}</span>
      <span>${bkmpIdleFormatNumber(p.damageDealt)} Schaden</span>
    </div>`).join('');
}

function bkmpRaidSpawnFx(className, targetId, amount, isCrit) {
  const field = document.getElementById('raidBattlefield');
  if (!field) return;
  const fx = document.createElement('span');
  fx.className = 'raid-fx ' + className;
  field.appendChild(fx);
  window.setTimeout(() => fx.remove(), 700);
  if (amount != null) {
    const target = document.getElementById(targetId);
    if (target) {
      const dmg = document.createElement('span');
      dmg.className = 'raid-dmg-float' + (isCrit ? ' raid-dmg-crit' : '');
      dmg.textContent = '-' + bkmpIdleFormatNumber(amount) + (isCrit ? '!' : '');
      target.appendChild(dmg);
      window.setTimeout(() => dmg.remove(), 900);
    }
  }
}
function bkmpRaidHitFlash(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.classList.remove('raid-hit-flash');
  void el.offsetWidth;
  el.classList.add('raid-hit-flash');
}

const BKMP_RAID_ATTACK_FX = ['raid-fx-arrow', 'raid-fx-fireball', 'raid-fx-lightning', 'raid-fx-magic'];

async function bkmpRaidOwnTick() {
  if (!bkmpRaidState || bkmpRaidState.status !== 'fighting' || !bkmpIdleEffectiveStats) return;
  const roll = bkmpIdleDamageRoll(bkmpIdleEffectiveStats.attack, bkmpIdleEffectiveStats.critChance, bkmpIdleEffectiveStats.critDamage, 0);
  const fx = BKMP_RAID_ATTACK_FX[Math.floor(Math.random() * BKMP_RAID_ATTACK_FX.length)];
  bkmpRaidSpawnFx(fx, 'raidBoss', roll.amount, roll.isCrit);
  bkmpRaidHitFlash('raidBoss');
  try {
    const result = await submitRaidDamage(bkmpRaidState.id, roll.amount, roll.isCrit, false);
    if (result) { bkmpRaidState.bossHp = result.bossHp; bkmpRaidState.status = result.status; bkmpRaidRenderCombat(); bkmpRaidCheckOutcome(); }
  } catch (e) { /* naechster Tick versucht es erneut */ }
}

function bkmpRaidPlayBossAttackSprite() {
  const el = document.getElementById('raidBoss');
  if (!el) return;
  el.classList.remove('raid-boss-attacking');
  void el.offsetWidth;
  el.classList.add('raid-boss-attacking');
}

async function bkmpRaidBossPoll() {
  if (!bkmpRaidState) return;
  try {
    const result = await tickRaidBossAttack(bkmpRaidState.id);
    if (result) {
      /* Gegen den vorherigen Stand vergleichen, nicht gegen cityMaxHp -
         sonst wuerde die Angriffs-FX/-Animation auf JEDEM Poll erneut
         feuern, sobald die Stadt einmal Schaden hat, statt nur bei einem
         tatsaechlich NEUEN Treffer in diesem Tick. */
      const prevCityHp = bkmpRaidState.cityHp;
      bkmpRaidState.cityHp = result.cityHp;
      bkmpRaidState.bossHp = result.bossHp;
      const changed = bkmpRaidState.status !== result.status;
      bkmpRaidState.status = result.status;
      if (changed || result.cityHp < prevCityHp) {
        bkmpRaidSpawnFx('raid-fx-boss-attack', 'raidCity', null, false);
        bkmpRaidHitFlash('raidCity');
        bkmpRaidPlayBossAttackSprite();
      }
      bkmpRaidRenderCombat();
      bkmpRaidCheckOutcome();
    }
  } catch (e) { /* naechster Poll versucht es erneut */ }
}

function bkmpRaidHandleBossClick() {
  if (!bkmpRaidState || bkmpRaidState.status !== 'fighting' || !bkmpIdleEffectiveStats) return;
  const now = Date.now();
  if (now < bkmpRaidClickLockedUntil) return;

  bkmpRaidClickBurst = bkmpRaidClickBurst.filter(t => now - t <= BKMP_BURST_WINDOW_MS);
  bkmpRaidClickBurst.push(now);
  if (bkmpRaidClickBurst.length >= BKMP_BURST_CLICK_THRESHOLD) {
    bkmpRaidClickLockedUntil = now + BKMP_AUTOCLICK_LOCK_MS;
    bkmpRaidClickBurst = [];
    bkmpRaidClickTimestamps = [];
    bkmpAutoclickSaveNumber(BKMP_RAID_CLICK_LOCK_KEY, bkmpRaidClickLockedUntil);
    bkmpAutoclickSaveTimestamps(BKMP_RAID_CLICK_HISTORY_KEY, bkmpRaidClickTimestamps);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(BKMP_AUTOCLICK_TOAST, 3200);
    return;
  }

  if (now - bkmpRaidLastClickAt < BKMP_CLICK_RATE_CAP_MS) return;
  bkmpRaidLastClickAt = now;
  bkmpRaidClickTimestamps.push(now);
  bkmpRaidClickTimestamps = bkmpRaidClickTimestamps.filter(t => now - t <= BKMP_AUTOCLICK_HISTORY_MS).slice(-BKMP_AUTOCLICK_WINDOW);
  bkmpAutoclickSaveTimestamps(BKMP_RAID_CLICK_HISTORY_KEY, bkmpRaidClickTimestamps);
  if (bkmpIdleDetectAutoclickPattern(bkmpRaidClickTimestamps)) {
    bkmpRaidClickLockedUntil = now + BKMP_AUTOCLICK_LOCK_MS;
    bkmpRaidClickTimestamps = [];
    bkmpAutoclickSaveNumber(BKMP_RAID_CLICK_LOCK_KEY, bkmpRaidClickLockedUntil);
    bkmpAutoclickSaveTimestamps(BKMP_RAID_CLICK_HISTORY_KEY, bkmpRaidClickTimestamps);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(BKMP_AUTOCLICK_TOAST, 3200);
    return;
  }

  const isCrit = Math.random() * 100 < bkmpIdleEffectiveStats.critChance;
  const clickDamage = Math.max(1, Math.round(bkmpIdleEffectiveStats.attack * (0.12 + (bkmpIdleEffectiveStats.clickDamagePct || 0) / 100) * (isCrit ? Math.max(1, bkmpIdleEffectiveStats.critDamage / 100) : 1)));
  bkmpRaidSpawnFx('raid-fx-magic', 'raidBoss', clickDamage, isCrit);
  bkmpRaidHitFlash('raidBoss');
  submitRaidDamage(bkmpRaidState.id, clickDamage, isCrit, true).then(result => {
    if (result) { bkmpRaidState.bossHp = result.bossHp; bkmpRaidState.status = result.status; bkmpRaidRenderCombat(); bkmpRaidCheckOutcome(); }
  }).catch(() => {});
}

function bkmpRaidStartLoops(raidId) {
  bkmpRaidStopLoops();
  bkmpRaidLoopTimer = window.setInterval(bkmpRaidOwnTick, BKMP_RAID_TICK_MS);
  bkmpRaidBossPollTimer = window.setInterval(bkmpRaidBossPoll, BKMP_RAID_BOSS_POLL_MS);
}
function bkmpRaidStopLoops() {
  if (bkmpRaidLoopTimer) { window.clearInterval(bkmpRaidLoopTimer); bkmpRaidLoopTimer = null; }
  if (bkmpRaidBossPollTimer) { window.clearInterval(bkmpRaidBossPollTimer); bkmpRaidBossPollTimer = null; }
}

/* raid_finish() vergibt Gold/Kristalle/XP serverseitig atomar direkt in
   idle_player_state - der lokale bkmpIdleState weiss davon nichts. Der
   normale Autosave (bkmpIdleQueueSync -> upsertIdlePlayerState) schreibt den
   KOMPLETTEN lokalen Stand zurueck (kein atomares Increment), und feuert
   frueher oder spaeter sowieso wieder (naechster Drachenkill, Tab-Wechsel,
   Fenster schliessen). Ohne diesen Abgleich wuerde dieser naechste Autosave
   den serverseitig gutgeschriebenen Betrag mit dem veralteten lokalen Stand
   ueberschreiben - die Belohnung waere dann zwar kurz in der DB, aber sofort
   wieder weg, ohne dass irgendwo ein Fehler auftritt. */
async function bkmpRaidSyncIdleStateAfterFinish() {
  if (!bkmpIdleState) return;
  const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
  if (!name) return;
  try {
    const remote = typeof loadIdlePlayerState === 'function' ? await loadIdlePlayerState(name) : null;
    if (!remote) return;
    bkmpIdleState.gold = remote.gold;
    bkmpIdleState.total_gold_earned = remote.total_gold_earned;
    bkmpIdleState.crystals = remote.crystals;
    bkmpIdleState.xp = remote.xp;
    bkmpIdleRenderHud();
  } catch (e) { console.warn('Raid: Spielstand nach Raid-Ende nicht abgeglichen.', e); }
}

async function bkmpRaidCheckOutcome() {
  if (!bkmpRaidState || bkmpRaidResultShown) return;
  if (bkmpRaidState.status === 'fighting' || bkmpRaidState.status === 'prep') return;
  bkmpRaidResultShown = true;
  bkmpRaidJoinedId = 'ended-' + bkmpRaidState.id;
  bkmpRaidStopLoops();
  bkmpUnsubscribeFromRaidInstance();
  bkmpRaidShowResult();
  bkmpRaidRefreshAchievementCache();
  await bkmpRaidSyncIdleStateAfterFinish();
  /* Der normale Idle-Dorf-Kampf-Loop wurde beim Betreten des Raids gestoppt
     (siehe bkmpRaidUpdateButtonState) und wird bisher NUR wieder gestartet,
     wenn der Spieler die Kampfansicht manuell verlaesst (bkmpRaidStopCombatView).
     Endet ein Raid aber von selbst (gewonnen/verloren/abgelaufen), waehrend
     das Ergebnis-Fenster noch offen ist, lief dieser Pfad nie - der
     automatische Tick (und damit jeder Gegenschlag der Drachen) blieb fuer
     den Rest der Sitzung tot, nur Klicks funktionierten noch weiter (die
     ueberspringen den Gegenschlag grundsaetzlich, siehe bkmpIdleHandleDragonClick)
     - im Ergebnis liess sich jeder Drache nach einem Raid ohne jedes Risiko
     wegklicken, bis die Seite neu geladen wurde. Live von Spielern bestaetigt. */
  if (bkmpIdleModalOpen) bkmpIdleStartLoop();
}

async function bkmpRaidShowResult() {
  const resultCard = document.getElementById('raidResultCard');
  const battlefield = document.getElementById('raidBattlefield');
  const listEl = document.getElementById('raidParticipantsList');
  if (!resultCard) return;
  let participants = bkmpRaidParticipants;
  try { participants = await loadRaidParticipants(bkmpRaidState.id); } catch (e) {}
  const myName = (typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '').trim().toLowerCase();
  const mine = participants.find(p => p.displayName.trim().toLowerCase() === myName);
  const myRank = mine ? participants.findIndex(p => p === mine) + 1 : 0;
  const mvp = participants[0];
  const won = bkmpRaidState.status === 'won';
  const flawless = won && bkmpRaidState.cityMaxHp > 0 && bkmpRaidState.cityHp >= bkmpRaidState.cityMaxHp;
  const totalDamage = participants.reduce((sum, p) => sum + p.damageDealt, 0);
  /* Persoenlicher Zerator-Belohnungscode: reine Abfrage einer serverseitig
     (raid_finish(), 5%-Wurf NUR bei echtem Sieg) bereits fertig erzeugten
     Zeile - der Client erzeugt hier nichts selbst, ein erneutes Aufrufen
     dieser Funktion (z.B. durch Neuladen der Seite waehrend das
     Ergebnis-Fenster noch offen ist) liefert daher zuverlaessig denselben
     Code statt einen neuen zu erzeugen. */
  let rewardCode = null;
  if (won && myName) {
    try { rewardCode = await loadRaidRewardCode(bkmpRaidState.id, myName); } catch (e) { console.warn('Raid: Belohnungscode konnte nicht geladen werden.', e); }
  }
  if (battlefield) battlefield.style.display = 'none';
  if (listEl) listEl.style.display = 'none';
  resultCard.style.display = '';
  resultCard.innerHTML = `
    <div class="raid-result-title ${won ? 'won' : 'lost'}">${won ? '🏆 Raid gewonnen!' : bkmpRaidState.status === 'expired' ? '⌛ Raid abgelaufen' : '💀 Raid verloren'}</div>
    ${flawless ? '<div class="raid-result-flawless">🛡️ Perfekt! Die Stadt blieb unbeschadet.</div>' : ''}
    <div class="raid-result-stats">
      <div class="raid-result-stat"><div class="raid-result-stat-label">Gesamtschaden</div><div class="raid-result-stat-value">${bkmpIdleFormatNumber(totalDamage)}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">Dein Schaden</div><div class="raid-result-stat-value">${bkmpIdleFormatNumber(mine ? mine.damageDealt : 0)}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">Dein Rang</div><div class="raid-result-stat-value">${myRank ? '#' + myRank : '-'}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">Deine Krits</div><div class="raid-result-stat-value">${mine ? mine.critsLanded : 0}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">Deine Klicks</div><div class="raid-result-stat-value">${mine ? mine.clicksLanded : 0}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">Teilnehmer</div><div class="raid-result-stat-value">${participants.length}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">MVP</div><div class="raid-result-stat-value raid-result-mvp">${mvp ? escapeHtml(mvp.displayName) : '-'}</div></div>
      <div class="raid-result-stat"><div class="raid-result-stat-label">${won ? 'Stadt-HP übrig' : 'Boss-HP übrig'}</div><div class="raid-result-stat-value">${bkmpIdleFormatNumber(won ? bkmpRaidState.cityHp : bkmpRaidState.bossHp)}</div></div>
    </div>
    ${won ? `<div class="raid-result-rewards"><span>💰 +${bkmpIdleFormatNumber(bkmpRaidState.goldReward || 5000)}</span><span>💎 +${bkmpIdleFormatNumber(bkmpRaidState.gemReward || 25)}</span><span>✨ +${bkmpIdleFormatNumber(bkmpRaidState.xpReward || 2000)}</span></div>` : ''}
    ${rewardCode ? `
    <div class="raid-result-zerator-code">
      <div class="raid-result-zerator-title">🎁 Plushie! Hier ist dein Code:</div>
      <div class="raid-result-zerator-code-row">
        <span class="raid-result-zerator-code-value" id="raidZeratorCodeValue">${escapeHtml(rewardCode.code)}</span>
        <button type="button" class="btn-nein" id="raidZeratorCodeCopyBtn">Kopieren</button>
      </div>
      <p class="raid-result-zerator-hint">Dieser Code kann nur einmal eingelöst werden – am besten gleich sichern.</p>
    </div>` : ''}
    <button type="button" class="btn-ja" id="raidResultCloseBtn">Schließen</button>
  `;
  const copyBtn = document.getElementById('raidZeratorCodeCopyBtn');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    const text = rewardCode ? rewardCode.code : '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => { copyBtn.textContent = 'Kopiert!'; window.setTimeout(() => { copyBtn.textContent = 'Kopieren'; }, 1800); }).catch(() => {});
    }
  });
  const closeBtn = document.getElementById('raidResultCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    bkmpRaidStopCombatView();
    bkmpIdleRenderActiveTabContent();
  });
}

/* ---------------- Raid-Bestenliste (in idle-dorf-Bestenliste-Tab eingehaengt) ---------------- */
async function bkmpRaidRenderLeaderboard() {
  const listEl = document.getElementById('idleLeaderboardList');
  if (!listEl) return;
  listEl.innerHTML = '<p class="empty-hint">Lädt...</p>';
  let rows = [];
  try { rows = await loadRaidLeaderboard(); } catch (e) { console.warn('Raid: Bestenliste konnte nicht geladen werden.', e); }
  const field = bkmpIdleActiveLeaderboardTab.replace('raid_', '');
  const fieldMap = { damage: 'totalDamageDealt', bosses: 'totalBossesDefeated', joined: 'totalRaidsJoined', best: 'bestSingleRaidDamage' };
  const key = fieldMap[field] || 'totalDamageDealt';
  const myName = (typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '').trim().toLowerCase();
  const sorted = rows.filter(r => r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 100);
  if (!sorted.length) { listEl.innerHTML = '<p class="empty-hint">Noch keine Raid-Daten vorhanden.</p>'; return; }
  listEl.innerHTML = sorted.map((row, i) => {
    const isMe = Boolean(myName) && row.displayName.trim().toLowerCase() === myName;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `<div class="leaderboard-row ${isMe ? 'is-me' : ''}"><span class="leaderboard-rank">${medal}</span><span class="leaderboard-name"><span class="leaderboard-name-text">${escapeHtml(row.displayName)}</span></span><span class="leaderboard-value">${bkmpIdleFormatNumber(row[key])}</span></div>`;
  }).join('');
}

/* ---------------- Achievement-Kontext (fuer index.html, gleiches
   Cache-Muster wie bkmpIdleGetAchievementContextFields) ---------------- */
const BKMP_RAID_ACHIEVEMENT_CACHE_KEY = 'bkmp-raid-achievement-fields-cache';
function bkmpRaidGetAchievementContextFields() {
  try {
    return JSON.parse(localStorage.getItem(BKMP_RAID_ACHIEVEMENT_CACHE_KEY) || 'null') ||
      { raidsJoined: 0, raidBossesDefeated: 0, raidTotalDamage: 0, raidMvpCount: 0, raidFlawlessWins: 0, raidBestDamage: 0 };
  } catch (e) {
    return { raidsJoined: 0, raidBossesDefeated: 0, raidTotalDamage: 0, raidMvpCount: 0, raidFlawlessWins: 0, raidBestDamage: 0 };
  }
}
async function bkmpRaidRefreshAchievementCache() {
  const client = typeof bkmpGetPlayerAuthClient === 'function' ? bkmpGetPlayerAuthClient() : null;
  if (!client) return;
  try {
    const { data: sessionData } = await client.auth.getSession();
    const userId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
    if (!userId) return;
    const { data } = await client
      .from('raid_player_stats')
      .select('total_raids_joined, total_bosses_defeated, total_damage_dealt, total_mvp_count, total_flawless_wins, best_single_raid_damage')
      .eq('auth_user_id', userId)
      .limit(1);
    const row = Array.isArray(data) && data[0] ? data[0] : null;
    const fields = {
      raidsJoined: Number(row ? row.total_raids_joined : 0),
      raidBossesDefeated: Number(row ? row.total_bosses_defeated : 0),
      raidTotalDamage: Number(row ? row.total_damage_dealt : 0),
      raidMvpCount: Number(row ? row.total_mvp_count : 0),
      raidFlawlessWins: Number(row ? row.total_flawless_wins : 0),
      raidBestDamage: Number(row ? row.best_single_raid_damage : 0)
    };
    try { localStorage.setItem(BKMP_RAID_ACHIEVEMENT_CACHE_KEY, JSON.stringify(fields)); } catch (e) {}
    if (typeof renderAchievementBadge === 'function') renderAchievementBadge(true);
  } catch (e) { /* Cache bleibt auf altem Stand */ }
}

/* ---------------- Init ---------------- */
function bkmpRaidInit() {
  bkmpRaidUpdateButtonState();
  window.setInterval(bkmpRaidUpdateButtonState, 1000);
  const bossEl = document.getElementById('raidBoss');
  if (bossEl) bossEl.addEventListener('click', bkmpRaidHandleBossClick);
}

function bkmpIdleInit() {
  bkmpIdleInitTabs();
  bkmpRaidInit();
  const openBtn = document.getElementById('idleDorfButton');
  if (openBtn) openBtn.addEventListener('click', bkmpIdleOpenModal);
  bkmpIdleMaintenancePoll();
  window.setInterval(bkmpIdleMaintenancePoll, 20000);
  const maintClose = document.getElementById('idleMaintenanceClose');
  if (maintClose) maintClose.addEventListener('click', () => {
    const el = document.getElementById('idleMaintenanceOverlay');
    if (el) el.classList.remove('visible');
  });
  const closeBtn = document.getElementById('idleDorfClose');
  if (closeBtn) closeBtn.addEventListener('click', bkmpIdleCloseModal);
  const closeX = document.getElementById('idleDorfCloseX');
  if (closeX) closeX.addEventListener('click', bkmpIdleCloseModal);
  const skillHelpClose = document.getElementById('idleSkillHelpClose');
  if (skillHelpClose) skillHelpClose.addEventListener('click', () => {
    const overlay = document.getElementById('idleSkillHelpOverlay');
    if (overlay) overlay.classList.remove('visible');
    document.body.classList.remove('modal-open');
  });
  const runenHelpClose = document.getElementById('idleRunenHelpClose');
  if (runenHelpClose) runenHelpClose.addEventListener('click', () => {
    const overlay = document.getElementById('idleRunenHelpOverlay');
    if (overlay) overlay.classList.remove('visible');
    document.body.classList.remove('modal-open');
  });
  const dragonEl = document.getElementById('idleDragon');
  if (dragonEl) { dragonEl.classList.add('idle-dragon-clickable'); dragonEl.addEventListener('click', bkmpIdleHandleDragonClick); }
  bkmpIdleWireStagePicker();
  const eventDragonReadyBtn = document.getElementById('idleEventDragonReadyBtn');
  if (eventDragonReadyBtn) eventDragonReadyBtn.addEventListener('click', bkmpIdleConfirmEventDragonReady);
  /* Leertaste als Alternative zum Maus-Klick auf den Drachen/Weltboss -
     Autoklicker-Schutz greift ueber dieselben Handler-Funktionen genauso,
     da hier nur der jeweilige Klick-Handler aufgerufen wird, keine eigene
     Schaden-Logik. Ignoriert, solange irgendwo getippt wird (Formulare,
     Feedback usw.), damit ein Leerzeichen dort nicht ausversehen einen
     Angriff ausloest. */
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    const active = document.activeElement;
    const tag = active ? active.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (active && active.isContentEditable)) return;
    if (!bkmpIdleModalOpen) return;
    const combatView = document.getElementById('raidCombatView');
    const raidActive = combatView && combatView.style.display !== 'none';
    e.preventDefault();
    if (raidActive) bkmpRaidHandleBossClick();
    else bkmpIdleHandleDragonClick();
  });
  window.addEventListener('beforeunload', () => { bkmpIdleQueueSync(); bkmpIdleFlushSync(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { bkmpIdleQueueSync(); bkmpIdleFlushSync(); } });
  window.setTimeout(bkmpIdlePreloadStateIfNamed, 0);
}
bkmpIdleInit();

/* ============================================================
   Inhalte: 50+ Achievements, 50+ Titel, 18 Kosmetiken.
   Werden per window.BKMP_IDLE_* von index.html's
   bkmpBuildAchievementsList()/bkmpBuildTitlesList()/BKMP_COSMETICS
   eingebunden (dort liegt bkmpTieredAchievements()). Alle IDs mit
   Praefix "idle*" - keine Kollision mit bestehenden IDs.
   ============================================================ */

window.BKMP_IDLE_DRAGON_KILL_TIERS = [
  [1, 'Erster Drache'], [5, 'Drachentöter'], [10, 'Drachenschreck'], [25, 'Drachenjäger'], [50, 'Drachenbezwinger'],
  [100, 'Hundert Drachen'], [200, 'Zweihundert Drachen'], [350, 'Drachenschlächter'], [500, 'Fünfhundert Drachen'],
  [750, 'Dreiviertel-Tausend'], [1000, 'Drachenlegende'], [2000, 'Zweitausend Drachen'], [5000, 'Der Drachenkönig']
];
window.BKMP_IDLE_LEVEL_TIERS = [
  [5, 'Dorfgründer'], [10, 'Aufstrebendes Dorf'], [20, 'Wachsendes Reich'], [30, 'Starkes Dorf'], [40, 'Blühendes Reich'],
  [50, 'Mächtiges Dorf'], [60, 'Festung'], [75, 'Bollwerk'], [100, 'Legendäres Dorf'], [150, 'Unbezwingbares Reich'],
  [200, 'Ewiges Dorf'], [300, 'Mythisches Reich']
];
window.BKMP_IDLE_GOLD_TIERS = [
  [1000, 'Erste Reserven'], [10000, 'Ordentliche Kasse'], [50000, 'Wohlhabend'], [100000, 'Reicher Händler'],
  [500000, 'Kleines Vermögen'], [1000000, 'Millionär'], [5000000, 'Großes Vermögen'], [10000000, 'Zehnfacher Millionär'],
  [50000000, 'Schatzmeister'], [100000000, 'Goldberg'], [500000000, 'Unermesslicher Reichtum'], [1000000000, 'Drachenschatz-Herrscher']
];
window.BKMP_IDLE_SKILLPOINTS_TIERS = [
  [5, 'Erste Talente'], [15, 'Talentiert'], [30, 'Vielseitig geschult'], [50, 'Meister der Künste'],
  [75, 'Großmeister'], [100, 'Skilltree-Experte'], [150, 'Vollendete Kunst'], [200, 'Meister aller Zweige']
];
/* Ein Erfolg pro Prestige-Aufstieg (1 bis 10) - Erfolgs-Titel bewusst
   schlicht "Prestige N", waehrend die zugehoerigen Sammlung-Titel (siehe
   BKMP_IDLE_PRESTIGE_TITLE_NAMES) eine eigene, eskalierende Namensreihe
   bekommen. */
window.BKMP_IDLE_PRESTIGE_TIERS = [
  [1, 'Prestige 1'], [2, 'Prestige 2'], [3, 'Prestige 3'], [4, 'Prestige 4'], [5, 'Prestige 5'],
  [6, 'Prestige 6'], [7, 'Prestige 7'], [8, 'Prestige 8'], [9, 'Prestige 9'], [10, 'Prestige 10']
];
window.BKMP_IDLE_PRESTIGE_TITLE_NAMES = [
  'Prestige Jäger', 'Prestige Krieger', 'Prestige Veteran', 'Prestige Meister', 'Prestige Champion',
  'Prestige Legende', 'Prestige Titan', 'Prestige Halbgott', 'Prestige Gott', 'Was ist Prestige?'
];

window.BKMP_IDLE_ACHIEVEMENTS_EXTRA = [
  { id: 'idle_started', category: 'Idle Dorf', title: 'Dorfgründung', desc: 'Öffne das Idle Drachen Dorf zum ersten Mal.', check: ctx => ctx.idleLevel >= 1 },
  { id: 'idle_first_boss', category: 'Idle Dorf', title: 'Bosskämpfer', desc: 'Besiege deinen ersten Boss-Drachen im Idle Dorf.', check: ctx => ctx.idleBossKills >= 1 },
  { id: 'idle_boss_10', category: 'Idle Dorf', title: 'Bossjäger', desc: 'Besiege 10 Boss-Drachen.', progress: ctx => [ctx.idleBossKills, 10], check: ctx => ctx.idleBossKills >= 10 },
  { id: 'idle_boss_50', category: 'Idle Dorf', title: 'Boss-Vernichter', desc: 'Besiege 50 Boss-Drachen.', progress: ctx => [ctx.idleBossKills, 50], check: ctx => ctx.idleBossKills >= 50 },
  { id: 'idle_skillpoints_1', category: 'Idle Dorf', title: 'Erster Skillpunkt', desc: 'Investiere deinen ersten Skillpunkt.', check: ctx => ctx.idleSkillPointsSpent >= 1 },
  { id: 'idle_branch_one', category: 'Idle Dorf', title: 'Spezialist', desc: 'Maximiere einen kompletten Skilltree-Zweig.', check: ctx => ctx.idleBranchesMaxed >= 1 },
  { id: 'idle_branch_three', category: 'Idle Dorf', title: 'Vielseitiger Anführer', desc: 'Maximiere drei komplette Skilltree-Zweige.', progress: ctx => [ctx.idleBranchesMaxed, 3], check: ctx => ctx.idleBranchesMaxed >= 3 },
  { id: 'idle_branch_all', category: 'Idle Dorf', title: 'Skilltree-Meister', desc: 'Maximiere alle 5 Skilltree-Zweige.', progress: ctx => [ctx.idleBranchesMaxed, 5], check: ctx => ctx.idleBranchesMaxed >= 5 }
];

/* Frueher zeigten alle Tier-Titel auf "unlockAchievement"-IDs (z. B.
   "idledragon_5"), fuer die es nie ein passendes Achievement-Objekt gab -
   dadurch waren sie technisch unerreichbar/dauerhaft gesperrt. Jetzt
   direkt per unlockCustom gegen den Kontext geprueft (funktioniert genauso
   wie bei den Kosmetiken weiter unten) UND mit einem echten Kampf-/
   Produktionsbonus versehen (effectType/effectValue) - siehe
   bkmpIdleTitleEffectTotals(). Diese Boni gelten PERMANENT sobald der
   Titel freigeschaltet ist (Sammlung, nicht "aktiv getragen"), werden aber
   nur in der Sammlung-Ansicht angezeigt, nicht im allgemeinen Kosmetik-/
   Erfolge-Profil (dort bleiben Titel rein kosmetisch). */
window.BKMP_IDLE_TITLES = [
  ...window.BKMP_IDLE_DRAGON_KILL_TIERS.map(([n, label], i) => ({
    id: `idletitle_dragon_${n}`, name: label, desc: `Für ${n} besiegte Drachen im Idle Dorf.`,
    unlockCustom: ctx => ctx.idleDragonKills >= n, effectType: 'gold_prod_pct', effectValue: i + 1
  })),
  ...window.BKMP_IDLE_LEVEL_TIERS.map(([n, label], i) => ({
    id: `idletitle_level_${n}`, name: label, desc: `Erreiche Dorf-Level ${n}.`,
    unlockCustom: ctx => ctx.idleLevel >= n, effectType: 'xp_pct', effectValue: i + 1
  })),
  ...window.BKMP_IDLE_GOLD_TIERS.map(([n, label], i) => ({
    id: `idletitle_gold_${n}`, name: label, desc: `Sammle ${n} Gold im Idle Dorf.`,
    unlockCustom: ctx => ctx.idleGoldEarned >= n, effectType: 'loot_chance_pct', effectValue: i + 1
  })),
  ...window.BKMP_IDLE_SKILLPOINTS_TIERS.map(([n, label], i) => ({
    id: `idletitle_skill_${n}`, name: label, desc: `Investiere ${n} Skillpunkte.`,
    unlockCustom: ctx => ctx.idleSkillPointsSpent >= n, effectType: 'attack_flat', effectValue: i + 1
  })),
  ...window.BKMP_IDLE_PRESTIGE_TIERS.map(([n], i) => ({
    id: `idletitle_prestige_${n}`, name: window.BKMP_IDLE_PRESTIGE_TITLE_NAMES[i], desc: `Erreiche Prestige-Stufe ${n} im Idle Dorf.`,
    unlockCustom: ctx => ctx.idlePrestigeLevel >= n, effectType: 'attack_pct', effectValue: i + 1
  })),
  { id: 'idletitle_founder', name: 'Dorfgründer', desc: 'Das Idle Dorf gegründet.', unlockCustom: ctx => ctx.idleLevel >= 1 },
  { id: 'idletitle_boss1', name: 'Bosskämpfer', desc: 'Besiegt den ersten Boss.', unlockCustom: ctx => ctx.idleBossKills >= 1, effectType: 'crit_chance_flat', effectValue: 1 },
  { id: 'idletitle_boss10', name: 'Bossjäger', desc: 'Besiegt 10 Bosse.', unlockCustom: ctx => ctx.idleBossKills >= 10, effectType: 'crit_chance_flat', effectValue: 2 },
  { id: 'idletitle_boss50', name: 'Boss-Vernichter', desc: 'Besiegt 50 Bosse.', unlockCustom: ctx => ctx.idleBossKills >= 50, effectType: 'crit_chance_flat', effectValue: 3 },
  { id: 'idletitle_branch1', name: 'Spezialist', desc: 'Ein Skilltree-Zweig maximiert.', unlockCustom: ctx => ctx.idleBranchesMaxed >= 1, effectType: 'defense_flat', effectValue: 2 },
  { id: 'idletitle_branch3', name: 'Vielseitiger Anführer', desc: 'Drei Skilltree-Zweige maximiert.', unlockCustom: ctx => ctx.idleBranchesMaxed >= 3, effectType: 'defense_flat', effectValue: 5 },
  { id: 'idletitle_branchall', name: 'Skilltree-Meister', desc: 'Alle Skilltree-Zweige maximiert.', unlockCustom: ctx => ctx.idleBranchesMaxed >= 5, effectType: 'hp_flat', effectValue: 20 },
  /* Seltene Event-Drachen (siehe bkmpIdleMaybeShowEventDragonPopup) - der
     Sieg-Status kommt aus der server-seitig abgesicherten
     idle_event_dragon_state-Tabelle (shenlossDefeated/liberDefeated,
     siehe bkmpIdleGetAchievementContextFields), nicht aus einem lokal
     faelschbaren Flag. Bewusst ohne effectType - reine Sammlungs-/
     Auszeichnungs-Titel fuer diese beiden Easter-Egg-Kaempfe, kein
     zusaetzlicher Kampfbonus. */
  { id: 'idletitle_shenloss', name: 'DragonBall Herrscher', desc: 'Shenloss im Kampf besiegt.', unlockCustom: ctx => ctx.shenlossDefeated },
  { id: 'idletitle_liber', name: 'Du hast ihn besiegt.', desc: 'Den Ganz Liber Drache im Kampf besiegt.', unlockCustom: ctx => ctx.liberDefeated }
];

/* Summiert die Boni aller FREIGESCHALTETEN (nicht nur des aktiv
   getragenen) Idle-Dorf-Titel - Sammlung-Prinzip: was du erreicht hast,
   bleibt dauerhaft wirksam, unabhaengig davon welchen Titel du gerade als
   Namenszusatz zeigst. */
function bkmpIdleTitleEffectTotals(ctx) {
  const totals = {};
  window.BKMP_IDLE_TITLES.forEach(title => {
    if (!title.effectType || !title.unlockCustom || !title.unlockCustom(ctx)) return;
    totals[title.effectType] = (totals[title.effectType] || 0) + (title.effectValue || 0);
  });
  return totals;
}

window.BKMP_IDLE_COSMETICS = [
  { id: 'rotgruen', name: 'Rot → Grün', desc: 'Wandelt sich von Rot zu Grün.', rarity: 'Selten', unlockCustom: ctx => ctx.idleDragonKills >= 20 },
  { id: 'goldweiss', name: 'Gold → Weiß', desc: 'Strahlendes Gold trifft auf reines Weiß.', rarity: 'Selten', unlockCustom: ctx => ctx.idleLevel >= 15 },
  { id: 'lilapink', name: 'Lila → Pink', desc: 'Verspielter Verlauf von Lila zu Pink.', rarity: 'Episch', unlockCustom: ctx => ctx.idleDragonKills >= 50 },
  { id: 'tuerkisblau', name: 'Türkis → Blau', desc: 'Kühler Verlauf wie tiefes Meerwasser.', rarity: 'Episch', unlockCustom: ctx => ctx.idleLevel >= 25 },
  { id: 'orangerot', name: 'Orange → Rot', desc: 'Wie glühende Kohle.', rarity: 'Episch', unlockCustom: ctx => ctx.idleDragonKills >= 100 },
  { id: 'regenbogen_idle', name: 'Regenbogen (Dorf)', desc: 'Alle Farben des Regenbogens im Wechsel.', rarity: 'Legendär', unlockCustom: ctx => ctx.idleLevel >= 40 },
  { id: 'amethyst', name: 'Amethyst', desc: 'Violetter Kristallglanz.', rarity: 'Episch', unlockCustom: ctx => ctx.idleDragonKills >= 150 },
  { id: 'smaragd', name: 'Smaragd', desc: 'Sattes, edles Grün.', rarity: 'Episch', unlockCustom: ctx => ctx.idleLevel >= 50 },
  { id: 'kosmos', name: 'Kosmos', desc: 'Tiefes Weltraum-Violett mit Sternenglanz.', rarity: 'Legendär', unlockCustom: ctx => ctx.idleDragonKills >= 250 },
  { id: 'aurora_himmel', name: 'Aurora-Himmel', desc: 'Ein zweites, noch intensiveres Polarlicht.', rarity: 'Legendär', unlockCustom: ctx => ctx.idleLevel >= 60 },
  { id: 'blutmond', name: 'Blutmond', desc: 'Dunkles, blutrotes Glühen.', rarity: 'Episch', unlockCustom: ctx => ctx.idleBossKills >= 5 },
  { id: 'sonnenlicht', name: 'Sonnenlicht', desc: 'Warmes, strahlendes Gelb.', rarity: 'Selten', unlockCustom: ctx => ctx.idleDragonKills >= 300 },
  { id: 'galaxie_tiefe', name: 'Galaxie-Tiefe', desc: 'Wirbelnde Sterne in der Tiefe des Alls.', rarity: 'Legendär', unlockCustom: ctx => ctx.idleLevel >= 75 },
  { id: 'mythisch', name: 'Mythisch', desc: 'Ein Verlauf, den nur wahre Legenden tragen.', rarity: 'Mythisch', unlockCustom: ctx => ctx.idleBranchesMaxed >= 3 },
  { id: 'leuchtendgold', name: 'Leuchtend Gold', desc: 'Gold, das pulsierend leuchtet.', rarity: 'Legendär', unlockCustom: ctx => ctx.idleGoldEarned >= 1000000 },
  { id: 'drachenfeuer', name: 'Drachenfeuer', desc: 'Für echte Drachenbezwinger.', rarity: 'Legendär', unlockCustom: ctx => ctx.idleDragonKills >= 500 },
  { id: 'schatten_dunkel', name: 'Schatten-Dunkel', desc: 'Noch tiefere Schatten als zuvor.', rarity: 'Episch', unlockCustom: ctx => ctx.idleBossKills >= 15 },
  { id: 'sternenstaub', name: 'Sternenstaub', desc: 'Glitzernder Staub aus fernen Galaxien.', rarity: 'Mythisch', unlockCustom: ctx => ctx.idleBranchesMaxed >= 5 }
];

/* ---------------- Weltboss/Raid: Erfolge (window.BKMP_RAID_ACHIEVEMENTS_EXTRA) ----------------
   Gleiches Einbinde-Muster wie BKMP_IDLE_ACHIEVEMENTS_EXTRA - wird per
   Spread direkt in BKMP_ACHIEVEMENTS (index.html, bkmpBuildAchievementsList)
   uebernommen und automatisch von Neu-Badge + Zeitstempel-System erfasst. */
window.BKMP_RAID_ACHIEVEMENTS_EXTRA = [
  { id: 'raid_first_join', category: 'Weltboss', title: 'Erster Raid', desc: 'Nimm an deinem ersten Weltboss-Raid teil.', check: ctx => ctx.raidsJoined >= 1 },
  { id: 'raid_first_boss', category: 'Weltboss', title: 'Erster Boss besiegt', desc: 'Besiege deinen ersten Weltboss.', check: ctx => ctx.raidBossesDefeated >= 1 },
  { id: 'raid_boss_10', category: 'Weltboss', title: 'Bossbezwinger', desc: 'Besiege 10 Weltbosse.', progress: ctx => [ctx.raidBossesDefeated, 10], check: ctx => ctx.raidBossesDefeated >= 10 },
  { id: 'raid_boss_100', category: 'Weltboss', title: 'Legendärer Drachenjäger', desc: 'Besiege 100 Weltbosse.', progress: ctx => [ctx.raidBossesDefeated, 100], check: ctx => ctx.raidBossesDefeated >= 100 },
  { id: 'raid_damage_1m', category: 'Weltboss', title: 'Ein Millionen Schaden', desc: 'Verursache insgesamt 1.000.000 Schaden in Weltboss-Raids.', progress: ctx => [ctx.raidTotalDamage, 1000000], check: ctx => ctx.raidTotalDamage >= 1000000 },
  { id: 'raid_mvp', category: 'Weltboss', title: 'MVP', desc: 'Sei der Spieler mit dem meisten Schaden in einem Raid.', check: ctx => ctx.raidMvpCount >= 1 },
  { id: 'raid_flawless', category: 'Weltboss', title: 'Ohne Niederlage gewonnen', desc: 'Gewinne einen Raid, ohne dass die Stadt Schaden nimmt.', check: ctx => ctx.raidFlawlessWins >= 1 }
];
