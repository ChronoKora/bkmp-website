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

/* Echtgeld-Kaeufe (Steampunk Dorf etc.) auf "gesperrt" halten, bis die
   Stripe-Live-Konfiguration wirklich fertig ist (STRIPE_SECRET_KEY +
   STRIPE_WEBHOOK_SECRET in Vercel, Live-Webhook eingerichtet) - bis dahin
   wuerde ein Klick entweder in einen Server-Fehler laufen oder (schlimmer)
   Geld nehmen ohne dass der Webhook zuverlaessig freischaltet. Auf true
   stellen, sobald ein echter Test-Kauf im Sandbox- UND Live-Modus
   durchgelaufen ist. */
const BKMP_REAL_MONEY_PURCHASES_ENABLED = false;
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

/* Gilden-Technologie "Bossschaden" (siehe supabase-guild-tech-tree.sql) -
   wirkt bewusst NUR gegen echte Boss-Kaempfe (Weltboss-Raid, spaeter
   Gildenboss), NICHT gegen normale Drachen im Kampf-Tab, deshalb ein
   separater Multiplikator an den jeweiligen Boss-Schadensstellen statt
   ein Teil von bkmpIdleDamageRoll() selbst. */
function bkmpIdleApplyBossDamageBonus(amount) {
  const bonus = bkmpIdleEffectiveStats ? (bkmpIdleEffectiveStats.bossDamageBonus || 0) : 0;
  return Math.max(1, Math.round(amount * (1 + bonus / 100)));
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
  /* maxLevel 500 -> 5000 (Balance-Audit-Fix 16.07.): hp_flat/defense_flat
     sind FLACHE Boni ohne gemeinsamen Prozent-Deckel (im Unterschied zu
     z.B. crit_chance/loot_chance_pct weiter unten) - ihr relativer Nutzen
     sinkt von selbst, je hoeher die Basiswerte wachsen, sie koennen also
     gefahrlos immer weiter gekauft werden. Vorher bei Level 500 das Ende
     der Fahnenstange: Holz/Stein hatten danach ueberhaupt keinen
     Verwendungszweck mehr, wurden aber von den Produktionsgebaeuden
     weiter unbegrenzt nachproduziert - jetzt ein echtes Langzeitziel statt
     einer toten Ressource. */
  { id: 'hp', name: 'Vorratshaus', desc: '+5 Leben pro Stufe.', icon: '❤️', resource: 'wood', baseCost: 25, costRate: 0.22, costExponent: 2.2, effectType: 'hp_flat', effectPerLevel: 5, maxLevel: 5000 },
  { id: 'walls', name: 'Steinmauern', desc: '+1 Verteidigung pro Stufe.', icon: '🧱', resource: 'stone', baseCost: 25, costRate: 0.22, costExponent: 2.2, effectType: 'defense_flat', effectPerLevel: 1, maxLevel: 5000 },
  { id: 'crit', name: 'Zielübung', desc: '+1 Krit-Chance pro Stufe.', icon: '🎯', resource: 'essence', baseCost: 6, costRate: 0.2, costExponent: 1.8, effectType: 'crit_chance_flat', effectPerLevel: 1, maxLevel: 100 },
  /* NACHBESSERUNG (Spieler-Report 13.07.: "ich bin schon bei 🍀 +49% obwohl
     ich noch keine Runen habe, das muss runter skaliert werden") - maxLevel
     300 x effectPerLevel 2 ergab bis zu +600% aus JEWEILS NUR EINEM einzigen
     Upgrade, obendrauf zu Skilltree/Titeln/Runen. Auf denselben Rahmen wie
     'crit' oben gebracht (maxLevel 100 x 1%/Stufe = max +100% pro Upgrade) -
     zusaetzlich zur harten Gesamt-Obergrenze in bkmpIdleRecomputeEffectiveStats. */
  { id: 'crystal_gold', name: 'Kristallschliff', desc: '+1% Gold-Ausbeute pro Stufe.', icon: '💎', resource: 'crystals', baseCost: 5, costRate: 0.22, costExponent: 2, effectType: 'gold_prod_pct', effectPerLevel: 1, maxLevel: 100 },
  { id: 'essence_loot', name: 'Essenzbindung', desc: '+1% Lootchance pro Stufe.', icon: '🧪', resource: 'essence', baseCost: 4, costRate: 0.22, costExponent: 2, effectType: 'loot_chance_pct', effectPerLevel: 1, maxLevel: 100 },
  /* Neu (Balance-Audit-Fix 16.07.): 'crit' und 'essence_loot' oben sind
     Essenz's einzige bisherige Sinks, fuettern aber beide einen gedeckelten
     Pott (crit_chance absolut auf 75, loot_chance_pct auf 300% - siehe
     bkmpIdleRecomputeEffectiveStats) und sind damit irgendwann "fertig".
     Essenzkern schliesst dieselbe Luecke wie 'hp'/'walls' oben, nur fuer
     Essenz statt Holz/Stein - flacher, ungedeckelter Angriffsbonus als
     echtes Langzeitziel. */
  { id: 'essence_core', name: 'Essenzkern', desc: '+2 Angriff pro Stufe.', icon: '🔮', resource: 'essence', baseCost: 8, costRate: 0.22, costExponent: 2.0, effectType: 'attack_flat', effectPerLevel: 2, maxLevel: 5000 }
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
  { id: 'yakshas-drache', name: 'Aurelia Drache', emoji: '🐲', sprite_key: 'yakshas-drache', spawn_rule: 'miniboss_10', color_theme: '#a78bfa', tier_order: 4, base_hp: 115, base_attack: 10, base_defense: 4, gold_reward_base: 14, xp_reward_base: 14, wood_reward_base: 3, stone_reward_base: 3, crystal_reward_base: 2, essence_reward_base: 1, is_boss: true, active: true },
  { id: 'yaksha-boss', name: 'Yaksha der Drachenboss', emoji: '👑', sprite_key: 'yaksha-boss', spawn_rule: 'boss_25', color_theme: '#ef4444', tier_order: 5, base_hp: 220, base_attack: 16, base_defense: 8, gold_reward_base: 28, xp_reward_base: 28, wood_reward_base: 5, stone_reward_base: 5, crystal_reward_base: 5, essence_reward_base: 3, is_boss: true, active: true },
  { id: 'schattendrache', name: 'Schattendrache', emoji: '🌑', sprite_key: 'schattendrache', spawn_rule: 'rare', color_theme: '#6b21a8', tier_order: 6, base_hp: 90, base_attack: 10, base_defense: 3, gold_reward_base: 12, xp_reward_base: 10, wood_reward_base: 2, stone_reward_base: 2, crystal_reward_base: 1, essence_reward_base: 1, is_boss: false, active: true },
  { id: 'wuffdrache', name: 'Wuffdrache', emoji: '🐾', sprite_key: 'wuffdrache', spawn_rule: 'rare', color_theme: '#fbbf24', tier_order: 7, base_hp: 50, base_attack: 5, base_defense: 1, gold_reward_base: 10, xp_reward_base: 8, wood_reward_base: 1, stone_reward_base: 1, crystal_reward_base: 1, essence_reward_base: 1, is_boss: false, active: true },
  /* Seltene Event-Easter-Egg-Drachen (0,1% je Drache, siehe
     bkmpIdleSelectDragonKindId) - base_hp/base_attack werden fuer diese
     spawn_rule ('event_easter') komplett ignoriert (siehe
     bkmpIdleEventDragonScaledStats), die Belohnungsbasis (gold/xp/...) gilt
     aber normal weiter. */
  { id: 'shenloss', name: 'Shenloss', emoji: '🐲', sprite_key: 'shenloss', spawn_rule: 'event_easter', color_theme: '#22c55e', tier_order: 8, base_hp: 1, base_attack: 1, base_defense: 2, gold_reward_base: 250, xp_reward_base: 250, wood_reward_base: 10, stone_reward_base: 10, crystal_reward_base: 20, essence_reward_base: 15, is_boss: false, active: true },
  { id: 'liber', name: 'Ganz Liber Drache', emoji: '🐉', sprite_key: 'liber', spawn_rule: 'event_easter', color_theme: '#e5e7eb', tier_order: 9, base_hp: 1, base_attack: 1, base_defense: 2, gold_reward_base: 250, xp_reward_base: 250, wood_reward_base: 10, stone_reward_base: 10, crystal_reward_base: 20, essence_reward_base: 15, is_boss: false, active: true },
  /* Drachenzucht-Ei-Quelldrache (siehe supabase-dragon-breeding.sql). tier_order
     10 statt 4, um die vorhandene Rotation nicht zu verschieben (siehe
     supabase-dragon-breeding-roster-fix.sql). Das Aureliadrache-Ei hat KEINEN
     eigenen Kampf-Eintrag mehr - der Miniboss "yakshas-drache" wurde zu
     "Aurelia Drache" umbenannt und dient jetzt als dessen Ei-Quelle (siehe
     supabase-dragon-roster-aurelia-rename.sql, Spieler-Wunsch 15.07.). */
  { id: 'winddrache', name: 'Winddrache', emoji: '🌪️', sprite_key: 'winddrache', spawn_rule: 'standard', color_theme: '#7dd3fc', tier_order: 10, base_hp: 68, base_attack: 7, base_defense: 2, gold_reward_base: 6, xp_reward_base: 6, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 0, essence_reward_base: 0, is_boss: false, active: true }
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
let bkmpIdleLastSaveFailToastAt = 0;
let bkmpIdleConfigLoaded = false;
/* Sieg-Status der seltenen Event-Drachen (siehe supabase-idle-event-
   dragons.sql), unabhaengig von bkmpIdleState geladen (eigene Tabelle,
   eigenes try/catch - gleiches Vorsichtsprinzip wie beim Prestige-Stand).
   bkmpIdleEventPauseActive haelt den KOMPLETTEN Kampf an, solange das
   Vorbereitungs-Popup noch nicht bestaetigt wurde (siehe
   bkmpIdleMaybeShowEventDragonPopup). */
let bkmpIdleEventDragonState = null;
let bkmpIdleEventPauseActive = false;

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
    last_skilltree_reset_at: null,
    rune_fuse_successes: 0, rune_fuse_failures: 0,
    rune_upgrade_successes: 0, rune_upgrade_failures: 0,
    village_defeats: 0, yaksha_boss_kills: 0,
    fruit: 0, meat: 0, obstgarten_level: 0, jagdhuette_level: 0,
    fruit_collected_at: new Date().toISOString(), meat_collected_at: new Date().toISOString(),
    boost_gold_until: null, boost_exp_until: null,
    mana: 0,
    holzfaeller_level: 0, holzfaeller_collected_at: new Date().toISOString(),
    steinbruch_level: 0, steinbruch_collected_at: new Date().toISOString(),
    goldmine_level: 0, goldmine_collected_at: new Date().toISOString(),
    kristallmine_level: 0, kristallmine_collected_at: new Date().toISOString(),
    manaquelle_level: 0, manaquelle_collected_at: new Date().toISOString(),
    magierakademie_level: 0, magierakademie_collected_at: new Date().toISOString(),
    titles_unlocked_at: {}, cosmetics_unlocked_at: {},
    turm_highest_wave: 0, turm_last_attempt_at: null
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
  /* Aktive Dorf-Skin-Wahl geraeteuebergreifend gleichhalten (siehe
     bkmpIdleEquipVillageSkin - schreibt jetzt zusaetzlich in
     bkmpIdleState.active_village_skin) - beim Laden auf einem neuen/anderen
     Geraet den vom Server bekannten Stand als Ausgangspunkt uebernehmen. */
  if (bkmpIdleState && bkmpIdleState.active_village_skin) {
    bkmpSetActiveVillageSkinId(bkmpIdleState.active_village_skin);
  }
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
    bkmpPrestigeSnapshotMergeBaseline();
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
  /* Dorf-Skins: ebenfalls ein reines Bonus-/Kosmetik-System oben drauf,
     siehe Runen-Kommentar oben - ein Ladefehler (Migration evtl. noch
     nicht ausgefuehrt) blockiert das Spiel nicht, startet nur mit leerem
     Skin-Katalog/Besitz (dann ist ausser dem Standarddorf nichts waehlbar). */
  bkmpVillageSkinsCatalog = [];
  bkmpPlayerVillageSkins = [];
  try {
    const [catalog, owned] = await Promise.all([
      typeof loadVillageSkinsCatalog === 'function' ? loadVillageSkinsCatalog() : [],
      typeof loadPlayerVillageSkins === 'function' ? loadPlayerVillageSkins(name) : []
    ]);
    bkmpVillageSkinsCatalog = Array.isArray(catalog) ? catalog : [];
    bkmpPlayerVillageSkins = Array.isArray(owned) ? owned.map(r => r.skin_id) : [];
  } catch (e) {
    console.warn('Idle Dorf: Dorf-Skins konnten nicht geladen werden (Migration evtl. noch nicht ausgefuehrt - siehe supabase-idle-village-skins.sql).', e);
    bkmpVillageSkinsCatalog = [];
    bkmpPlayerVillageSkins = [];
  }
  bkmpApplyVillageSkin();
  await bkmpIdleLoadDragonBreedingState(name);
  /* Neue Produktionsgebäude (17.07. nachts) - Prestige-Status ist an dieser
     Stelle schon geladen (siehe oben), daher greift der Prestige-Stufen-
     Bonus auf die Offline-Aufholung korrekt schon beim allerersten Laden. */
  bkmpIdleAccrueProductionBuildings();
  bkmpIdleSnapshotMergeBaseline();
}

function bkmpIdleEventDragonExcludedIds() {
  const s = bkmpIdleEventDragonState;
  const excluded = [];
  if (s && s.shenloss_defeated) excluded.push('shenloss');
  if (s && s.liber_defeated) excluded.push('liber');
  return excluded;
}

/* ---------------- Gilden-Kassen-Bonus (siehe supabase-idle-guilds.sql) ----------------
   Gestaffelter Bonus auf Angriff/Verteidigung/Gold fuer ALLE Mitglieder,
   abhaengig vom aktuellen Kassenstand der eigenen Gilde - motiviert
   gemeinsames Beitragen, nicht nur den Anfuehrer. Rein clientseitig
   gecacht (localStorage, gleiches Muster wie die Erfolge-Caches), damit
   bkmpIdleRecomputeEffectiveStats() den Wert nutzen kann, OHNE bei jedem
   Aufruf einen Netzwerk-Request zu brauchen - wird beim Oeffnen des
   Idle-Dorfs und nach jedem Gilden-Wechsel aufgefrischt. */
const BKMP_GUILD_TREASURY_BONUS_CACHE_KEY = 'bkmp-guild-treasury-bonus-cache';
const BKMP_GUILD_TREASURY_TIERS = [
  { threshold: 1000, pct: 2 },
  { threshold: 5000, pct: 5 },
  { threshold: 20000, pct: 8 },
  { threshold: 50000, pct: 12 },
  { threshold: 150000, pct: 18 }
];
function bkmpIdleGuildTreasuryBonusPct(treasuryGold) {
  const gold = Number(treasuryGold || 0);
  let pct = 0;
  BKMP_GUILD_TREASURY_TIERS.forEach(tier => { if (gold >= tier.threshold) pct = tier.pct; });
  return pct;
}
function bkmpIdleGuildNextTreasuryMilestone(treasuryGold) {
  const gold = Number(treasuryGold || 0);
  const next = BKMP_GUILD_TREASURY_TIERS.find(tier => gold < tier.threshold);
  return next ? next.threshold : null;
}
function bkmpIdleGetGuildTreasuryBonusCache() {
  try { return Number(localStorage.getItem(BKMP_GUILD_TREASURY_BONUS_CACHE_KEY) || 0); } catch (e) { return 0; }
}
/* ---------------- Gilden-Technologie (siehe supabase-guild-tech-tree.sql)
   ----------------
   9 Zweige, jeweils ein fester Prozentsatz pro Stufe (max. 20 Stufen) -
   permanent, einmal gekauft, unabhaengig vom aktuellen Kassenstand
   (im Gegensatz zum bestehenden Kassenstand-Meilenstein-Bonus, der bei
   sinkendem Kassenstand wieder sinken wuerde). Kostenkurve MUSS exakt
   mit der serverseitigen Formel in guild_tech_upgrade() uebereinstimmen
   (200.000 * 1,4^Stufe) - hier nur fuer die Anzeige, bezahlt/geprueft
   wird ausschliesslich serverseitig. */
const BKMP_GUILD_TECH_CATALOG = [
  { id: 'attack', label: 'Angriff', icon: '⚔️', perLevel: 1, statKey: 'attackPct' },
  { id: 'defense', label: 'Verteidigung', icon: '🛡️', perLevel: 1, statKey: 'defensePct' },
  { id: 'gold', label: 'Gold', icon: '💰', perLevel: 1.5, statKey: 'goldPct' },
  { id: 'crit_chance', label: 'Kritchance', icon: '🎯', perLevel: 0.3, statKey: 'critChancePct' },
  { id: 'crit_damage', label: 'Kritischer Schaden', icon: '💥', perLevel: 2, statKey: 'critDamagePct' },
  { id: 'boss_damage', label: 'Bossschaden', icon: '🐉', perLevel: 2.5, statKey: 'bossDamagePct' },
  { id: 'rune_luck', label: 'Runenglück', icon: '🍀', perLevel: 1.5, statKey: 'runeLuckPct' },
  { id: 'xp', label: 'Erfahrungsbonus', icon: '📖', perLevel: 1, statKey: 'xpPct' },
  { id: 'prestige', label: 'Prestigebonus', icon: '🌌', perLevel: 0.5, statKey: 'prestigePct' }
];
const BKMP_GUILD_TECH_MAX_LEVEL = 20;
function bkmpGuildTechCostForLevel(currentLevel) {
  return Math.round(200000 * Math.pow(1.4, currentLevel));
}
const BKMP_GUILD_TECH_CACHE_KEY = 'bkmp-guild-tech-cache';
function bkmpIdleGetGuildTechCache() {
  try { return JSON.parse(localStorage.getItem(BKMP_GUILD_TECH_CACHE_KEY) || '{}'); } catch (e) { return {}; }
}

/* ---------------- Gildenplätze dazukaufen (siehe supabase-guild-extra-
   slots.sql) ----------------
   Spieler-Wunsch (16.07., Discord: "Die Gilde ist voll wir brauchen mehr
   Platz... So eine Funktion für Gilden mehr Platz dazu zukaufen"). Fester
   Basis-Deckel von 20 Mitgliedern (siehe join_guild() in
   supabase-idle-guilds.sql) lässt sich um bis zu BKMP_GUILD_SLOT_MAX_BONUS
   weitere Plätze erweitern. Kostenkurve MUSS exakt mit der serverseitigen
   Formel in buy_guild_slot() uebereinstimmen (400.000 * 1,5^bereits
   gekaufte Plätze) - hier nur fuer die Anzeige, bezahlt/geprueft wird
   ausschliesslich serverseitig. */
const BKMP_GUILD_SLOT_MAX_BONUS = 10;
function bkmpGuildSlotCost(currentBonusSlots) {
  return Math.round(400000 * Math.pow(1.5, currentBonusSlots));
}

/* ---------------- Gilden-Erfolge: Kontextfelder (window.BKMP_GUILD_ACHIEVEMENTS_EXTRA
   weiter unten) ----------------
   Gleiches Cache-Muster wie bkmpRaidGetAchievementContextFields, aber ohne
   eigenen Netzwerk-Request - wird im selben bkmpGuildGetMine()-Aufruf wie
   Kassenstand-Bonus/Technologie mit aufgefrischt (siehe
   bkmpGuildRefreshTreasuryBonusCache). Erfolge sind rein clientseitig aus
   dem AKTUELLEN Gildenstand abgeleitet (keine Server-seitige "wer war zum
   Zeitpunkt X Mitglied"-Historie noetig) - jedes aktuelle Mitglied einer
   Gilde, die die Schwelle erreicht hat, sieht den Erfolg als freigeschaltet. */
const BKMP_GUILD_ACHIEVEMENT_CACHE_KEY = 'bkmp-guild-achievement-fields-cache';
const BKMP_GUILD_ACHIEVEMENT_FIELDS_DEFAULT = { inGuild: false, guildRole: '', guildLevel: 1, guildXp: 0, guildBossesDefeated: 0, guildMemberCount: 0 };
function bkmpGuildGetAchievementContextFields() {
  try {
    return JSON.parse(localStorage.getItem(BKMP_GUILD_ACHIEVEMENT_CACHE_KEY) || 'null') || { ...BKMP_GUILD_ACHIEVEMENT_FIELDS_DEFAULT };
  } catch (e) {
    return { ...BKMP_GUILD_ACHIEVEMENT_FIELDS_DEFAULT };
  }
}

/* Aktualisiert ALLE Gilden-Caches (Kassenstand-Meilenstein, Technologie UND
   Erfolge-Kontext) in einem Rutsch - teilen sich denselben bkmpGuildGetMine()-
   Aufruf statt getrennte Netzwerk-Requests bei jedem der zahlreichen
   Aufrufer (nach Gruenden/Beitreten/Verlassen/Spenden/Kicken/Befoerdern -
   alles Stellen, an denen sich die Gildenzugehoerigkeit oder -kasse aendern
   kann). Name bleibt bewusst "TreasuryBonus" (nicht umbenannt), damit keiner
   der bestehenden Aufrufer angepasst werden muss. */
async function bkmpGuildRefreshTreasuryBonusCache() {
  try {
    const mine = await bkmpGuildGetMine();
    const treasury = mine ? mine.guild.treasuryGold : 0;
    /* BUGFIX (Spieler-Report 14.07., "Irgendwas stimmt mit der Skalierung
       nicht! habe 65k Rüstung... nach 50k gold mehr" -> 192,6K): hier wurde
       versehentlich der ROHE Kassenstand gecacht statt des berechneten
       Bonus-Prozentsatzes - die Stat-Formel hat den Kassenstand (z.B.
       26000) direkt als Prozentwert interpretiert ("+26000%" statt "+8%"). */
    const bonusPct = bkmpIdleGuildTreasuryBonusPct(treasury);
    localStorage.setItem(BKMP_GUILD_TREASURY_BONUS_CACHE_KEY, String(bonusPct));

    const levels = mine ? await bkmpGuildGetTechLevels(mine.guild.id) : {};
    const techTotals = {};
    BKMP_GUILD_TECH_CATALOG.forEach(tech => {
      techTotals[tech.statKey] = (levels[tech.id] || 0) * tech.perLevel;
    });
    localStorage.setItem(BKMP_GUILD_TECH_CACHE_KEY, JSON.stringify(techTotals));

    if (mine && !bkmpGuildLevelThresholds.length) {
      bkmpGuildLevelThresholds = await bkmpGuildGetLevelThresholds();
    }
    const achievementFields = mine ? {
      inGuild: true,
      guildRole: mine.myRole,
      guildLevel: bkmpGuildLevelInfo(mine.guild.guildXp).level,
      guildXp: mine.guild.guildXp,
      guildBossesDefeated: mine.guild.bossesDefeated,
      guildMemberCount: mine.guild.memberCount
    } : { ...BKMP_GUILD_ACHIEVEMENT_FIELDS_DEFAULT };
    localStorage.setItem(BKMP_GUILD_ACHIEVEMENT_CACHE_KEY, JSON.stringify(achievementFields));

    if (typeof bkmpIdleRecomputeEffectiveStats === 'function') bkmpIdleRecomputeEffectiveStats();
    if (typeof renderAchievementBadge === 'function') renderAchievementBadge(true);
  } catch (e) { /* offline/kein Login - alter Cache-Stand bleibt bestehen */ }
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
  const dragonTotals = bkmpIdleDragonCompanionEffectTotals();
  const t = key => (skillTotals[key] || 0) + (upgradeTotals[key] || 0) + (titleTotals[key] || 0) + (prestigeTotals[key] || 0) + (runeTotals[key] || 0) + (dragonTotals[key] || 0);
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
  /* NACHBESSERUNG (Spieler-Report 13.07.: "ich bin schon bei 🍀 +49% obwohl
     ich noch keine Runen habe, das muss alles runter skaliert werden") -
     Skilltree + Upgrades + Sammlung-Titel + Prestige-Baum speisen ALLE
     denselben Pott (attack_pct/gold_prod_pct/xp_pct/loot_chance_pct/
     crit_damage_pct) OHNE gemeinsame Obergrenze - bei Vielspielern mit
     vielen freigeschalteten Titeln (die sich laut Sammlung-Prinzip alle
     aufaddieren, siehe bkmpIdleTitleEffectTotals) und hohen Upgrade-Stufen
     addierte sich das auf mehrere HUNDERT Prozent aus jeder einzelnen
     Quelle fuer sich genommen schon plausibel wirkender Werte. Analog zu
     der bereits bestehenden Krit-Chance-/Magieresistenz-/Element-Deckelung
     (Math.min(75/60, ...) weiter unten) jetzt auch fuer diese vier Werte
     eine grosszuegige, aber echte Obergrenze - faengt kuenftige Powercreep-
     Kombinationen ab, ohne den erspielten Fortschritt einzelner Quellen
     (Skilltree/Titel/Runen/Prestige) zu kappen, solange sie in Summe
     vernuenftig bleiben. */
  const guildBonusPct = bkmpIdleGetGuildTreasuryBonusCache();
  /* Gilden-Technologie (siehe supabase-guild-tech-tree.sql) - permanente,
     einmal gekaufte Boni, additiv zum bestehenden Kassenstand-Bonus (der
     bleibt eigenstaendig und schwankt weiterhin mit dem aktuellen
     Kassenstand). "prestige"-Zweig verhaelt sich wie zusaetzliche
     Prestige-Stufen (wirkt auf dieselben 4 Pools wie prestigeLevelBonusPct
     unten), alle anderen Zweige wirken auf jeweils genau einen Pool. */
  const guildTechTotals = bkmpIdleGetGuildTechCache();
  const gt = key => guildTechTotals[key] || 0;
  const guildPrestigeBonusPct = gt('prestigePct');
  const attackPctTotal = Math.min(500, t('attack_pct') + t('extra_archer') * 6 + prestigeLevelBonusPct + guildBonusPct + gt('attackPct') + guildPrestigeBonusPct);
  const attackFlatTotal = t('attack_flat') + t('ballista_unlock') * 8;
  bkmpIdleEffectiveStats = {
    attack: (base.attack + attackFlatTotal) * (1 + attackPctTotal / 100),
    /* Deckel ergaenzt (Dungeon-Balance-Analyse 16.07.): defense_pct war der
       einzige Sammel-Pott ohne die Obergrenze aus der NACHBESSERUNG oben
       (attack_pct/hp_pct/gold_prod_pct/xp_pct/loot_chance_pct/crit_chance
       sind alle gedeckelt, dieser hier war es nicht) - da Schaden im Kampf
       als FESTER Abzug (0.5 * defense) statt prozentual gerechnet wird,
       haette unbegrenztes defense_pct jeden Kampf (inkl. Dungeon) trivial
       machen koennen. 400 spiegelt den bestehenden Deckel von hp_pct/
       goldBonus/xpBonus weiter unten. */
    defense: (base.defense + t('defense_flat')) * (1 + Math.min(400, t('defense_pct') + guildBonusPct + gt('defensePct')) / 100),
    hp: Math.round((base.hp + t('hp_flat')) * (1 + (t('hp_pct') + prestigeLevelBonusPct + guildPrestigeBonusPct) / 100)),
    critChance: Math.min(75, base.critChance + t('crit_chance_flat') + t('crit_chance_pct') + gt('critChancePct')),
    critDamage: base.critDamage + Math.min(300, t('crit_damage_flat') + t('crit_damage_pct') + gt('critDamagePct')),
    goldBonus: Math.min(400, base.goldBonus + t('gold_prod_pct') + t('gold_find_pct') + prestigeLevelBonusPct + guildBonusPct + gt('goldPct') + guildPrestigeBonusPct),
    xpBonus: Math.min(400, base.xpBonus + t('xp_pct') + prestigeLevelBonusPct + gt('xpPct') + guildPrestigeBonusPct),
    lootBonus: Math.min(300, base.lootBonus + t('loot_chance_pct')),
    /* Gilden-Technologie "Bossschaden" - siehe bkmpIdleApplyBossDamageBonus,
       wirkt NUR an den Boss-Kampfstellen (Weltboss-Raid, Gildenboss), nicht
       auf den normalen Drachen-Schaden hier. */
    bossDamageBonus: gt('bossDamagePct') + t('boss_dmg_pct'),
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
    runeLuckPct: t('rune_luck_pct') + gt('runeLuckPct')
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

const BKMP_IDLE_BRANCH_LABELS = { dorf: '🏹 Dorf', burg: '🏰 Burg', wirtschaft: '⚒ Wirtschaft', forschung: '🐉 Forschung', magie: '✨ Magie', meister: '🔨 Meister', zucht: '🐲 Zucht' };
/* "meister" (Zwerg Grimbold) ist bewusst MIT in dieser Liste, obwohl er
   erst nach allen 5 Basis-Zweigen freischaltet - solange die zugehoerigen
   Skill-Knoten in der DB noch nicht existieren (Migration nicht
   ausgefuehrt), filtert bkmpIdleRenderSkilltreePanel ihn automatisch weg
   (leere nodes-Liste), kein Sonderfall noetig. bkmpIdleCountMaxedBranches()
   zaehlt ihn erst mit, sobald er selbst gemaxed ist (vorher 0 Ranege
   allokiert = nicht "maxed") - beeinflusst die bestehende "alle 5 Basis-
   Zweige"-Schwelle also nicht rueckwirkend. */
const BKMP_IDLE_BRANCH_ORDER = ['dorf', 'burg', 'wirtschaft', 'forschung', 'magie', 'meister', 'zucht'];

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
    return bkmpIdleGetCachedAchievementFields() || { idleDragonKills: 0, idleBossKills: 0, idleLevel: 0, idleGoldEarned: 0, idleSkillPointsSpent: 0, idleBranchesMaxed: 0, shenlossDefeated: false, liberDefeated: false, idlePrestigeLevel: 0, idleRuneFuseSuccesses: 0, idleRuneFuseFailures: 0, idleRuneUpgradeSuccesses: 0, idleRuneUpgradeFailures: 0, idleAllEquippedRarity: null, idleAllEquippedMinLevel: -1, idleDungeonCleared: bkmpDungeonIsHardestCleared(), idleLoginStreak: 0, idleDragonsHatched: 0, idleDragonsAdult: 0, idleDragonSpeciesOwned: 0, idleLegendaryDragonsOwned: 0, idleHasSteampunkSkin: false };
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
      : Number((bkmpIdleGetCachedAchievementFields() || {}).idlePrestigeLevel || 0),
    idleRuneFuseSuccesses: Number(s.rune_fuse_successes || 0),
    idleRuneFuseFailures: Number(s.rune_fuse_failures || 0),
    idleRuneUpgradeSuccesses: Number(s.rune_upgrade_successes || 0),
    idleRuneUpgradeFailures: Number(s.rune_upgrade_failures || 0),
    idleAllEquippedRarity: bkmpIdleAllEquippedRarity(),
    idleAllEquippedMinLevel: bkmpIdleAllEquippedMinLevel(),
    idleDungeonCleared: bkmpDungeonIsHardestCleared(),
    idleLoginStreak: bkmpIdleGetStreakData().count,
    idleDragonsHatched: bkmpPlayerDragons.length,
    idleDragonsAdult: bkmpPlayerDragons.filter(d => d.stage === 'adult').length,
    idleDragonSpeciesOwned: new Set(bkmpPlayerDragons.map(d => d.species_id)).size,
    idleLegendaryDragonsOwned: bkmpPlayerDragons.filter(d => {
      const sp = bkmpDragonSpeciesById(d.species_id);
      return sp && sp.rarity === 'legendaer';
    }).length,
    idleHasSteampunkSkin: bkmpPlayerVillageSkins.includes('steampunkdorf'),
    idleTowerHighestWave: Number(s.turm_highest_wave || 0)
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
  bkmpIdleBroadcastCombatState();
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
  if (leveled) {
    bkmpIdleRecomputeEffectiveStats();
    /* Spieler-Meldung 17.07.: Level-Aufstieg (und damit neue Skillpunkte)
       liess die "+1"-Kaufbuttons im offenen Skilltree-Tab faelschlich
       ausgegraut, bis man manuell weg- und zurueckwechselte - der
       Skilltree stand bisher bewusst NICHT auf der Liste der pro Kill
       live nachgerenderten Tabs (siehe bkmpIdleRefreshLiveTabs, teure
       SVG-Linien-Neuzeichnung), aber ein Level-Aufstieg ist ein seltenes
       Ereignis (nicht jeder Kill), das gezielte Nachrendern hier kostet
       also nichts an der eigentlich vermiedenen Kill-Haeufigkeit. */
    if (bkmpIdleActiveTab === 'skilltree' && typeof bkmpIdleRenderSkilltreePanel === 'function') bkmpIdleRenderSkilltreePanel();
  }
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
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const full = Number(row.waves_cleared || 0) >= difficulty.waves;
    const valueText = full ? `🏆 ${bkmpDungeonFormatTime(row.time_ms)}` : `Welle ${row.waves_cleared} / ${difficulty.waves}`;
    return `<div class="leaderboard-row ${isMe ? 'is-me' : ''}"><span class="leaderboard-rank">${medal}</span><span class="leaderboard-name"><span class="leaderboard-name-text">${escapeHtml(row.display_name)}</span></span><span class="leaderboard-value">${valueText}</span></div>`;
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
function bkmpDungeonUpdateBanner() {
  const banner = document.getElementById('idleDungeonBanner');
  if (!banner || !bkmpDungeonActive || !bkmpDungeonActiveDifficulty) return;
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
  const sprite = document.getElementById('idleDragonSprite');
  if (sprite) {
    [...sprite.classList].filter(c => c.startsWith(BKMP_IDLE_SPRITE_CLASS_PREFIX)).forEach(c => sprite.classList.remove(c));
    sprite.classList.remove('idle-sprite-attacking');
    sprite.classList.add(BKMP_IDLE_SPRITE_CLASS_PREFIX + dragon.spriteKey);
  }
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
  bkmpIdleShowDismissibleResultCard('bkmpDungeonResultOverlay', `
    <small>Auto-Lauf beendet &middot; ${done} / ${total === Infinity ? '∞' : total} Versuche</small>
    <strong>${stats.wins} 🏆 &middot; ${stats.losses} 💀</strong>
    <p>Gesamt-Belohnung: ${parts.join(' &middot; ')}</p>
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

/* Erstellt/verdrahtet eine schliessbare Ergebnis-Karte (Spieler-Vorgabe
   16.07.: "feste Popups mit den Belohnungen, die man wegklicken kann...
   dass man auch mal weiss was man bekommen hat wenn man nicht
   hingeguckt hat") - bewusst OHNE Auto-Timeout mehr (die alte Version
   verschwand nach 4.8-5.4s von selbst, was bei AFK/nicht-hinschauen genau
   das gemeldete Problem war). Schliesst per X-Button ODER Klick auf den
   abgedunkelten Hintergrund (nicht auf die Karte selbst). Gemeinsam von
   Dungeon- und Turm-Ergebnis genutzt. */
function bkmpIdleShowDismissibleResultCard(id, innerHtml) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'bkmp-easter bkmp-easter-dismissible';
  overlay.id = id;
  overlay.innerHTML = `
    <div class="bkmp-easter-card idle-dungeon-result-card">
      <button type="button" class="idle-result-close-btn" aria-label="Schließen">✕</button>
      ${innerHtml}
    </div>
  `;
  const close = () => {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 450);
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.idle-result-close-btn').addEventListener('click', close);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));
}
function bkmpDungeonShowResult(success, wavesCleared, totalWaves, elapsedMs, summary, difficulty, dungeonType, dailyBonusGranted) {
  const parts = bkmpDungeonRewardParts(summary);
  bkmpIdleShowDismissibleResultCard('bkmpDungeonResultOverlay', `
    <small>${dungeonType.icon} ${dungeonType.name} &middot; ${difficulty.icon} ${difficulty.name}</small>
    <strong>${success ? '🏆 Dungeon gemeistert!' : `💀 Bei Welle ${wavesCleared + 1} gescheitert`}</strong>
    <p>${success ? `Alle ${totalWaves} Wellen in ${bkmpDungeonFormatTime(elapsedMs)} geschafft!` : `${wavesCleared} von ${totalWaves} Wellen überstanden.`}${dailyBonusGranted ? '<br>🎁 Tagesbonus angewendet!' : ''}<br>Belohnung: ${parts.join(' &middot; ') || '—'}</p>
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
/* Fester Mitternachts-Reset (Spieler-Vorgabe 16.07.: "soll bitte immer um
   0 Uhr reseten... alles auf 0 Uhr skaliert") statt des vorherigen
   rollierenden 24h-Cooldowns - ein Versuch um 23:50 Uhr und einer um
   00:10 Uhr am naechsten Tag waren vorher fast 24h auseinander, jetzt ist
   um Mitternacht (Europe/Berlin) IMMER wieder ein Versuch faellig, egal
   wann genau der letzte war. bkmpBerlinDateKey liefert dafuer denselben
   DST-sicheren Tages-Schluessel (YYYYMMDD in Europe/Berlin) wie an anderer
   Stelle im Spiel bereits fuer den Gildenboss verwendet (siehe
   bkmpGuildBossGetPhaseInfo) - zwei Zeitpunkte sind "derselbe Tag" genau
   dann, wenn ihre Schluessel uebereinstimmen. */
function bkmpBerlinDateKey(date) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date || new Date()).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  return `${parts.year}${parts.month}${parts.day}`;
}
function bkmpBerlinNextMidnight(date) {
  const d = date || new Date();
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  return bkmpGuildBossBerlinDateAt(Number(parts.year), Number(parts.month), Number(parts.day) + 1, 0, 0);
}
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
function bkmpTowerUpdateBanner() {
  const banner = document.getElementById('idleTurmBanner');
  if (!banner || !bkmpTowerActive) return;
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

function bkmpIdleHandleDragonDefeated() {
  if (bkmpDungeonActive) { bkmpDungeonHandleWaveCleared(); return; }
  if (bkmpTowerActive) { bkmpTowerHandleWaveCleared(); return; }
  const defeatedEventDragon = bkmpIdleCurrentDragon && bkmpIdleCurrentDragon.isEventDragon ? bkmpIdleCurrentDragon : null;
  const rewards = bkmpIdleRewardsAt(bkmpIdleCurrentDragon, bkmpIdleEffectiveStats, bkmpIdleGetMergedRewardScalingCfg());
  /* Goldrausch/Wissensschub (siehe bkmpDungeonGrantBoost) wirkt auf JEDE
     Gold-/EXP-Quelle, nicht nur Dungeon-Laeufe selbst - hier der zweite
     (neben dem Dungeon) der beiden Haupt-Einkommenspfade. */
  const goldBoost = typeof bkmpDungeonBoostMultiplier === 'function' ? bkmpDungeonBoostMultiplier('gold') : 1;
  const xpBoost = typeof bkmpDungeonBoostMultiplier === 'function' ? bkmpDungeonBoostMultiplier('exp') : 1;
  const boostedGold = goldBoost > 1 ? Math.round(rewards.gold * goldBoost) : rewards.gold;
  const boostedXp = xpBoost > 1 ? Math.round(rewards.xp * xpBoost) : rewards.xp;
  bkmpIdleState.gold += boostedGold;
  bkmpIdleState.total_gold_earned += boostedGold;
  bkmpIdleState.wood += rewards.wood;
  bkmpIdleState.stone += rewards.stone;
  bkmpIdleState.crystals += rewards.crystals;
  bkmpIdleState.essence += rewards.essence;
  bkmpIdleState.dragon_kills += 1;
  bkmpGuildQuestAddDelta('gold_earned', boostedGold);
  bkmpGuildQuestAddDelta('dragon_kills', 1);
  if (bkmpIdleCurrentDragon.isBoss) bkmpIdleState.boss_kills += 1;
  /* Yakshas-Heimat-Skin braucht Siege GENAU gegen diesen einen Boss
     (id 'yaksha-boss'), nicht Bosse allgemein - eigener Zaehler getrennt
     vom generischen boss_kills. */
  if (bkmpIdleCurrentDragon.id === 'yaksha-boss') {
    bkmpIdleState.yaksha_boss_kills = Number(bkmpIdleState.yaksha_boss_kills || 0) + 1;
    bkmpIdleCheckYakshasHeimatUnlock();
  }
  bkmpIdleMaybeDropRune(bkmpIdleCurrentDragon.isBoss ? 'boss' : 'normal');
  bkmpIdleMaybeDropTreasure(bkmpIdleCurrentDragon);
  bkmpDragonGrantCompanionBattleXp(bkmpIdleCurrentDragon.isBoss ? 25 : 4);
  const autoAdvance = bkmpIdleState.auto_advance !== false;
  if (autoAdvance) bkmpIdleState.current_dragon_index += 1;
  bkmpIdleState.highest_dragon_index = Math.max(Number(bkmpIdleState.highest_dragon_index || 0), bkmpIdleState.current_dragon_index);
  bkmpIdleAddXp(boostedXp);
  bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;
  /* Nutzerwunsch (15.07.): "wo dieses Geld und XP hochploppt gerne auch so
     Standard mäßig machen, anstatt dadrunter so ein Scroll Fenster" - die
     Gold/XP-Zeile lief bisher bei JEDEM Kill in den Kampf-Log (mehrmals pro
     Sekunde im Idle-Betrieb - genau das staendige Scrollen, das ersetzt
     werden sollte). Die Hochschweb-Zahlen (siehe bkmpIdleRewardGained-
     Listener weiter unten, urspruenglich nur fuer idle-stream-mini.html
     gebaut) uebernehmen die Gold/XP-Anzeige jetzt ueberall als Standard -
     bewusst KEIN bkmpIdleLog(...) mehr fuer den Routine-Fall. Seltenere,
     wichtigere Ereignisse (Level-Aufstieg, Boss-Titel, Runen-Funde,
     Niederlage, Aufstieg) bleiben ueber bkmpIdleLog erhalten (jetzt
     zusaetzlich als Toast, siehe dort), damit nichts Wichtiges verloren
     geht. */
  document.dispatchEvent(new CustomEvent('bkmpIdleRewardGained', { detail: { gold: boostedGold, xp: boostedXp, isBoss: !!bkmpIdleCurrentDragon.isBoss } }));
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

/* Zerstoertes-Dorf-Skin: unlock_type='achievement' bekommt (anders als
   'purchase'/'boss_drop') noch keine generische Freischalt-Logik im
   Skin-System - hier direkt am einzigen Ort geprueft, an dem
   village_defeats sich aendert. Kein Einloese-Code noetig (wie bei
   Zerathor Dorf), gleicher direkter Insert wie beim normalen Kauf-Weg
   (bkmpIdleBuyVillageSkin), nur ohne Gold-Abzug. */
const BKMP_ZERSTOERTES_DORF_UNLOCK_THRESHOLD = 15000;
function bkmpIdleCheckZerstoertesDorfUnlock() {
  if (!bkmpIdleState || bkmpPlayerVillageSkins.includes('zerstoertesdorf')) return;
  if (Number(bkmpIdleState.village_defeats || 0) < BKMP_ZERSTOERTES_DORF_UNLOCK_THRESHOLD) return;
  const nameKey = bkmpIdleState.name_key;
  Promise.resolve(typeof unlockPlayerVillageSkin === 'function' ? unlockPlayerVillageSkin(nameKey, 'zerstoertesdorf') : null)
    .then(row => {
      if (row) {
        bkmpPlayerVillageSkins.push('zerstoertesdorf');
        bkmpIdleLog('🏚️ Dorf-Skin freigeschaltet: Zerstörtes Dorf!');
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🏚️ Dorf-Skin freigeschaltet: Zerstörtes Dorf!', 3200);
        bkmpIdleRenderSkinsPanel();
      }
    })
    .catch(e => console.warn('Idle Dorf: Zerstoertes-Dorf-Freischaltung konnte nicht gespeichert werden.', e));
}

/* Yakshas-Heimat-Skin: gleicher direkter Freischalt-Mechanismus wie
   Zerstoertes Dorf oben, nur an yaksha_boss_kills statt village_defeats
   geknuepft (siehe bkmpIdleHandleDragonDefeated). */
const BKMP_YAKSHAS_HEIMAT_UNLOCK_THRESHOLD = 50000;
function bkmpIdleCheckYakshasHeimatUnlock() {
  if (!bkmpIdleState || bkmpPlayerVillageSkins.includes('yakshasheimat')) return;
  if (Number(bkmpIdleState.yaksha_boss_kills || 0) < BKMP_YAKSHAS_HEIMAT_UNLOCK_THRESHOLD) return;
  const nameKey = bkmpIdleState.name_key;
  Promise.resolve(typeof unlockPlayerVillageSkin === 'function' ? unlockPlayerVillageSkin(nameKey, 'yakshasheimat') : null)
    .then(row => {
      if (row) {
        bkmpPlayerVillageSkins.push('yakshasheimat');
        bkmpIdleLog('👑 Dorf-Skin freigeschaltet: Yakshas Heimat!');
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('👑 Dorf-Skin freigeschaltet: Yakshas Heimat!', 3200);
        bkmpIdleRenderSkinsPanel();
      }
    })
    .catch(e => console.warn('Idle Dorf: Yakshas-Heimat-Freischaltung konnte nicht gespeichert werden.', e));
}

function bkmpIdleHandleDefeat() {
  if (bkmpDungeonActive) { bkmpDungeonHandleFailure(); return; }
  if (bkmpTowerActive) { bkmpTowerHandleDefeat(); return; }
  bkmpIdleLog(`💀 Niederlage gegen ${bkmpIdleCurrentDragon.emoji} ${bkmpIdleCurrentDragon.name}! Du fällst eine Stufe zurück.`);
  bkmpIdleState.current_dragon_index = Math.max(0, Number(bkmpIdleState.current_dragon_index || 0) - 1);
  bkmpIdleState.village_defeats = Number(bkmpIdleState.village_defeats || 0) + 1;
  bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;
  bkmpIdleSpawnDragon();
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
  bkmpIdleCheckZerstoertesDorfUnlock();
}

function bkmpIdleTick() {
  if (!bkmpIdleState || !bkmpIdleCurrentDragon || !bkmpIdleEffectiveStats) return;
  const stats = bkmpIdleEffectiveStats;
  bkmpIdleState.playtime_seconds = Number(bkmpIdleState.playtime_seconds || 0) + (stats.tickIntervalMs || 900) / 1000;

  if (bkmpIdleGetAutoBuy()) bkmpIdleAutoBuyUpgrades();

  /* Schildgenerator/Reparaturtempo (Burg): passive Regeneration der
     Stadt-Lebenspunkte - vorher wirkungslos, effect_type wurde nie
     ausgewertet. Frueher waehrend Dungeon-Laeufen deaktiviert, auf
     Spielerwunsch (17.07.) wieder aktiviert - gilt jetzt auch im Dungeon. */
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
  bkmpIdleBroadcastCombatState();
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
function bkmpIdleCheckDailyStreak() {
  if (!bkmpIdleState) return;
  const data = bkmpIdleGetStreakData();
  const today = bkmpIdleDateStr(new Date());
  if (data.lastDate === today) return;
  const yesterday = bkmpIdleDateStr(new Date(Date.now() - 86400000));
  const newCount = data.lastDate === yesterday ? Number(data.count || 0) + 1 : 1;
  bkmpIdleSaveStreakData({ count: newCount, lastDate: today });
  const goldBonus = Math.min(10000, 500 * newCount);
  const gemBonus = newCount % 5 === 0 ? 10 : 0;
  bkmpIdleState.gold = Number(bkmpIdleState.gold || 0) + goldBonus;
  if (gemBonus > 0) bkmpIdleState.crystals = Number(bkmpIdleState.crystals || 0) + gemBonus;
  bkmpIdleQueueSync();
  if (typeof bkmpShowJannikToast === 'function') {
    const gemMsg = gemBonus > 0 ? ` +${gemBonus} 💎` : '';
    bkmpShowJannikToast(`🔥 ${newCount}. Tag in Folge! +${bkmpIdleFormatNumber(goldBonus)} 💰${gemMsg}`, 4200);
  }
}

function bkmpIdleRenderHud() {
  const hud = document.getElementById('idleDorfHud');
  if (!hud || !bkmpIdleState) return;
  const xpCfg = bkmpIdleConfig.xp_curve || BKMP_IDLE_FALLBACK_CONFIG.xp_curve;
  const xpNeeded = bkmpIdleXpForLevel(bkmpIdleState.level, xpCfg);
  const xpPct = Math.max(0, Math.min(100, (bkmpIdleState.xp / xpNeeded) * 100));
  const s = bkmpIdleEffectiveStats;
  const streakCount = bkmpIdleGetStreakData().count;

  /* App-Modus (siehe /app, window.BKMP_APP_MODE) bekommt eine eigene HUD-
     Vorlage (Spieler-Name+Portrait-Kachel oben, Ressourcen als eigene
     Zeile) - auf der normalen Website aendert sich NICHTS, dort greift
     unveraendert die bestehende Vorlage weiter unten. Eigene Klassen-
     Namen (idle-hud-app-*), damit hier nichts mit dem Website-Styling
     kollidiert. */
  if (window.BKMP_APP_MODE) {
    const playerName = (typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '') || bkmpIdleState.name_key || 'Spieler';
    hud.innerHTML = `
      <div class="idle-hud-app-top">
        <div class="idle-hud-app-portrait">
          <span class="idle-hud-app-portrait-icon">🐉</span>
          <span class="idle-hud-app-portrait-level">${bkmpIdleState.level}</span>
        </div>
        <div class="idle-hud-app-identity">
          <div class="idle-hud-app-name">${escapeHtml(playerName)}</div>
          <div class="idle-hud-app-sub">
            ${streakCount > 0 ? `🔥 ${streakCount} Tage Serie` : ''}
            ${bkmpIdleState.skill_points_available > 0 ? ` · 🔹 ${bkmpIdleState.skill_points_available} Skillpunkte` : ''}
          </div>
        </div>
      </div>
      <div class="idle-hud-app-resources">
        <span class="idle-res-chip idle-res-gold" data-app-tab="idleTabBtnUpgrades"><i class="idle-res-icon">💰</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.gold)}</b></span>
        <span class="idle-res-chip idle-res-wood" data-app-tab="idleTabBtnUpgrades"><i class="idle-res-icon">🌳</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.wood)}</b></span>
        <span class="idle-res-chip idle-res-stone" data-app-tab="idleTabBtnUpgrades"><i class="idle-res-icon">🗿</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.stone)}</b></span>
        <span class="idle-res-chip idle-res-crystal" data-app-tab="idleTabBtnUpgrades"><i class="idle-res-icon">💎</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.crystals)}</b></span>
        <span class="idle-res-chip idle-res-essence" data-app-tab="idleTabBtnRunen"><i class="idle-res-icon">🧪</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.essence)}</b></span>
      </div>
      ${s ? `
      <div class="idle-hud-app-stats">
        <span class="idle-res-chip idle-res-hp" title="Maximale Leben"><i class="idle-res-icon">❤️</i><b class="idle-res-val">${bkmpIdleFormatNumber(Math.round(s.hp))}</b></span>
        <span class="idle-res-chip idle-res-atk" title="Angriff"><i class="idle-res-icon">⚔️</i><b class="idle-res-val">${bkmpIdleFormatNumber(Math.round(s.attack))}</b></span>
        <span class="idle-res-chip idle-res-def" title="Verteidigung"><i class="idle-res-icon">🛡️</i><b class="idle-res-val">${bkmpIdleFormatNumber(Math.round(s.defense))}</b></span>
        <span class="idle-res-chip idle-res-lvl" title="Level"><i class="idle-res-icon">⭐</i><b class="idle-res-val">${bkmpIdleState.level}</b></span>
      </div>` : ''}
      <div class="idle-hud-app-xp">
        <div class="idle-xp-bar"><div class="idle-xp-fill" style="width:${xpPct}%"></div></div>
        <div class="idle-xp-label">${Math.floor(bkmpIdleState.xp)} / ${xpNeeded} XP</div>
      </div>
    `;
    return;
  }

  hud.innerHTML = `
    <div class="idle-hud-top">
      <div class="idle-hud-level-badge"><span class="idle-hud-level-num">${bkmpIdleState.level}</span><span class="idle-hud-level-tag">Level</span></div>
      ${streakCount > 0 ? `<div class="idle-hud-streak-badge" title="Tage in Folge eingeloggt">🔥 ${streakCount}</div>` : ''}
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
      <span title="Glücksfaktor (Bonus auf Runen-/Ressourcen-Drops, aus Upgrades/Skills/Titeln/Runen zusammen)">🍀 +${(s.lootBonus || 0).toFixed(1)}%</span>
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

/* Seit der Gold/XP-Hochschweb-Umstellung (15.07.) landen hier nur noch die
   selteneren, wichtigeren Ereignisse (Level-Aufstieg, Boss-Titel, Runen-
   Funde/-Aufwertungen, Niederlage, Prestige-Aufstieg) - der Routine-Fall
   "Drache besiegt, +Gold +XP" wird stattdessen per bkmpIdleRewardGained-
   Event/Hochschweb-Anzeige dargestellt (siehe bkmpIdleHandleDragonDefeated).
   Zusaetzlich zum (weiterhin bestehenden, aber deutlich selteneren)
   Kampf-Log jetzt auch als Toast, damit diese Ereignisse nicht verpasst
   werden, falls gerade niemand auf den Log schaut. */
function bkmpIdleLog(msg) {
  const log = document.getElementById('idleDorfLog');
  if (log) {
    const line = document.createElement('div');
    line.className = 'idle-dorf-log-line';
    line.textContent = msg;
    log.prepend(line);
    while (log.children.length > 20) log.removeChild(log.lastChild);
  }
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(msg, 3200);
}

/* ---------------- Rendering: Upgrades-Tab ---------------- */

/* Auto-Kauf: rein clientseitiger Schalter (localStorage, kein Schema-
   Wechsel noetig) - klassisches Idle-Game-QoL-Feature. Kauft pro Tick
   automatisch das jeweils guenstigste noch bezahlbare Upgrade, so lange
   noch etwas bezahlbar ist (Kaskaden-Kauf statt nur 1x pro Tick, falls
   viel Gold auf einmal reinkommt). */
const BKMP_IDLE_AUTOBUY_KEY = 'bkmp-idle-autobuy';
function bkmpIdleGetAutoBuy() {
  try { return localStorage.getItem(BKMP_IDLE_AUTOBUY_KEY) === '1'; } catch (e) { return false; }
}
function bkmpIdleSetAutoBuy(on) {
  try { localStorage.setItem(BKMP_IDLE_AUTOBUY_KEY, on ? '1' : '0'); } catch (e) {}
}
function bkmpIdleAutoBuyUpgrades() {
  if (!bkmpIdleState) return;
  let guard = 0;
  while (guard < 50) {
    guard++;
    const purchases = bkmpIdleState.upgrade_purchases || {};
    const affordable = BKMP_IDLE_UPGRADES
      .map(def => ({ def, level: Number(purchases[def.id] || 0) }))
      .filter(({ def, level }) => level < def.maxLevel)
      .map(({ def, level }) => ({ def, cost: bkmpIdleUpgradeCost(def, level) }))
      .filter(({ def, cost }) => (bkmpIdleState[def.resource] || 0) >= cost)
      .sort((a, b) => a.cost - b.cost);
    if (affordable.length === 0) break;
    bkmpIdleBuyUpgrade(affordable[0].def.id);
  }
}

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
  /* Gleiches Prinzip wie bkmpIdleRenderDragonsPanel (Obstgarten/Jagdhütte):
     jedes Oeffnen/Neurendern dieses Panels holt zuerst noch ausstehende
     Produktion seit dem letzten Checkpoint nach, damit die angezeigten
     Lv./Rate-Werte nicht veraltet wirken, waehrend der Spieler zuschaut. */
  bkmpIdleAccrueProductionBuildings();
  const purchases = bkmpIdleState.upgrade_purchases || {};
  const autoBuyOn = bkmpIdleGetAutoBuy();
  panel.innerHTML = `
    <label class="idle-autobuy-toggle">
      <input type="checkbox" id="idleAutoBuyToggle" ${autoBuyOn ? 'checked' : ''}>
      <span>🤖 Auto-Kauf: kauft automatisch das günstigste bezahlbare Upgrade</span>
    </label>
    <div class="idle-upgrade-grid">${BKMP_IDLE_UPGRADES.map(def => {
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
  }).join('')}</div>
    <h4 class="idle-upgrade-section-title">🐉 Drachenzucht-Gebäude</h4>
    <div class="idle-upgrade-grid">${[
      { kind: 'fruit', levelKey: 'obstgarten_level', icon: '🌳', name: 'Obstgarten', unit: 'Früchte/Std.' },
      { kind: 'meat', levelKey: 'jagdhuette_level', icon: '🥩', name: 'Jagdhütte', unit: 'Fleisch/Std.' }
    ].map(b => {
      const level = Number(bkmpIdleState[b.levelKey] || 0);
      const maxed = level >= BKMP_DRAGON_BUILDING_MAX_LEVEL;
      const cost = maxed ? 0 : bkmpDragonBuildingCost(level);
      const affordable = !maxed && (bkmpIdleState.gold || 0) >= cost;
      const rate = bkmpDragonResourceRatePerHour(b.kind, level);
      const cap = bkmpDragonResourceCap(level);
      return `
        <div class="idle-upgrade-card">
          <div class="idle-upgrade-icon">${b.icon}</div>
          <div class="idle-upgrade-name">${b.name} <span class="idle-upgrade-level">Lv.${level}${maxed ? ' (Max)' : '/' + BKMP_DRAGON_BUILDING_MAX_LEVEL}</span></div>
          <div class="idle-upgrade-desc">${bkmpIdleFormatNumber(rate)} ${b.unit} · Lager: ${bkmpIdleFormatNumber(cap)}</div>
          <button type="button" class="btn-ja idle-dragon-building-upgrade" data-kind="${b.kind}" ${maxed || !affordable ? 'disabled' : ''}>
            ${maxed ? 'Maximal' : `💰 ${bkmpIdleFormatNumber(cost)}`}
          </button>
        </div>`;
    }).join('')}</div>
    <h4 class="idle-upgrade-section-title">🏗️ Produktionsgebäude</h4>
    <div class="idle-upgrade-grid">${BKMP_IDLE_PRODUCTION_BUILDINGS.map(def => {
      const level = Number(bkmpIdleState[def.levelKey] || 0);
      const maxed = level >= BKMP_IDLE_PRODUCTION_BUILDING_MAX_LEVEL;
      const cost = maxed ? 0 : bkmpIdleProductionBuildingCost(def, level);
      const affordable = !maxed && (bkmpIdleState.gold || 0) >= cost;
      const rate = bkmpIdleProductionBuildingRatePerHour(def, level);
      return `
        <div class="idle-upgrade-card">
          <div class="idle-upgrade-icon">${def.icon}</div>
          <div class="idle-upgrade-name">${escapeHtml(def.name)} <span class="idle-upgrade-level">Lv.${level}${maxed ? ' (Max)' : '/' + BKMP_IDLE_PRODUCTION_BUILDING_MAX_LEVEL}</span></div>
          <div class="idle-upgrade-desc">${escapeHtml(def.desc)}<br>${bkmpIdleFormatNumber(rate)} ${def.unit}</div>
          <button type="button" class="btn-ja idle-production-building-buy" data-building-id="${def.id}" ${maxed || !affordable ? 'disabled' : ''}>
            ${maxed ? 'Maximal' : `💰 ${bkmpIdleFormatNumber(cost)}`}
          </button>
        </div>`;
    }).join('')}</div>`;
  panel.querySelectorAll('.idle-upgrade-buy').forEach(btn => btn.addEventListener('click', () => bkmpIdleBuyUpgrade(btn.dataset.upgradeId)));
  panel.querySelectorAll('.idle-dragon-building-upgrade').forEach(btn => btn.addEventListener('click', () => bkmpDragonUpgradeBuilding(btn.dataset.kind)));
  panel.querySelectorAll('.idle-production-building-buy').forEach(btn => btn.addEventListener('click', () => bkmpIdleBuyProductionBuilding(btn.dataset.buildingId)));
  const autoBuyToggle = document.getElementById('idleAutoBuyToggle');
  if (autoBuyToggle) {
    autoBuyToggle.addEventListener('change', () => {
      bkmpIdleSetAutoBuy(autoBuyToggle.checked);
      if (autoBuyToggle.checked) bkmpIdleAutoBuyUpgrades();
    });
  }
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
   nie initialisiert -> alle Zweige starten zugeklappt (siehe Kommentar
   weiter unten - Spieler-Wunsch 13.07., vorher klappte "Dorf" immer
   automatisch auf). */
let bkmpIdleSkillBranchOpenState = null;

function bkmpIdleRenderSkilltreePanel() {
  const panel = document.getElementById('idlePanelSkilltree');
  if (!panel || !bkmpIdleState) return;
  if (!bkmpIdleSkillDefs.length) { panel.innerHTML = '<p class="empty-hint">Skilltree wird bald verfügbar sein.</p>'; return; }
  const alloc = bkmpIdleState.skill_allocations || {};

  /* Freischalt-Bedingung fuer den "meister"-Zweig: alle 5 Basis-Zweige
     komplett gemaxed (siehe Kommentar bei BKMP_IDLE_BRANCH_ORDER oben) UND
     die Grimbold-Dialogszene wurde bereits gesehen (sonst bleibt der Zweig
     auch nach Erreichen der Schwelle noch kurz gesperrt angezeigt, bis der
     weiter unten ausgeloeste Dialog abgeschlossen ist - siehe
     bkmpMeisterMaybeShowDialog). */
  const meisterBranchesMaxed = bkmpIdleCountMaxedBranches() >= 5;
  const meisterUnlocked = meisterBranchesMaxed && bkmpMeisterDialogSeen();
  const branches = BKMP_IDLE_BRANCH_ORDER.map(branch => {
    const nodes = bkmpIdleSkillDefs.filter(n => n.branch === branch).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    if (!nodes.length) return null;
    const isLocked = branch === 'meister' && !meisterUnlocked;
    const withDepth = nodes.map(node => ({ node, depth: bkmpIdleSkillNodeDepth(node, nodes) }));
    const maxDepth = Math.max(0, ...withDepth.map(n => n.depth));
    const rows = [];
    for (let d = 0; d <= maxDepth; d++) rows.push(withDepth.filter(n => n.depth === d).map(n => n.node));
    const investedRanks = nodes.reduce((sum, n) => sum + Number(alloc[n.id] || 0), 0);
    const maxRanks = nodes.reduce((sum, n) => sum + Number(n.max_rank || 0), 0);
    const hasAllocatable = !isLocked && nodes.some(n => bkmpIdleCanAllocateSkill(n));
    return { branch, nodes, rows, investedRanks, maxRanks, hasAllocatable, isLocked };
  }).filter(Boolean);

  /* NACHBESSERUNG (Spieler-Wunsch 13.07.: "Dorf ist immer geoeffnet, bitte
     wie die anderen geschlossen anzeigen") - vorher wurde beim ersten
     Rendern automatisch der erste Zweig mit einem gerade kaufbaren Knoten
     aufgeklappt, was durch die Reihenfolge in BKMP_IDLE_BRANCH_ORDER
     praktisch immer "Dorf" traf. Jetzt starten alle Zweige einheitlich
     zugeklappt, der Spieler waehlt selbst. */
  if (!bkmpIdleSkillBranchOpenState) {
    bkmpIdleSkillBranchOpenState = {};
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
    ${branches.map(({ branch, nodes, rows, investedRanks, maxRanks, hasAllocatable, isLocked }) => {
      const isOpen = !!bkmpIdleSkillBranchOpenState[branch];
      if (isLocked) {
        return `<div class="idle-skill-branch idle-skill-branch-locked">
          <button type="button" class="idle-skill-branch-header" data-branch-toggle="${branch}" aria-expanded="${isOpen}">
            <span class="idle-skill-branch-name">${BKMP_IDLE_BRANCH_LABELS[branch] || branch}</span>
            <span class="idle-skill-branch-lock" title="Erst freigeschaltet, wenn alle 5 Basis-Zweige komplett gemaxed sind">🔒</span>
            <span class="idle-skill-branch-chevron">▾</span>
          </button>
          <div class="idle-skill-branch-collapse">
            <div class="idle-skill-branch-collapse-inner">
              <p class="idle-panel-hint idle-skill-branch-locked-hint">🔒 Ein Fremder wartet vor den Toren deines Dorfes - aber er zeigt sich erst, wenn alle 5 Basis-Zweige (Dorf/Burg/Wirtschaft/Forschung/Magie) komplett gemaxed sind.</p>
            </div>
          </div>
        </div>`;
      }
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
         Baum beim Messen noch die Hoehe 0 (Grid-Zeile startet bei 0fr).
         Bei einem gesperrten Zweig (siehe idle-skill-branch-locked) gibt
         es gar keinen Baum, nur einen Hinweistext - treeEl waere dann
         null. */
      if (treeEl) setTimeout(() => bkmpIdleDrawSkillTreeLines(treeEl), 360);
    }
  }));
  const resetBtn = document.getElementById('idleSkilltreeResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', bkmpIdleResetSkilltree);
  const helpBtn = document.getElementById('idleSkilltreeHelpBtn');
  if (helpBtn) helpBtn.addEventListener('click', bkmpIdleOpenSkillHelp);
  if (meisterBranchesMaxed && !bkmpMeisterDialogSeen()) bkmpMeisterMaybeShowDialog();
}

/* ---------------- "Meister"-Zweig: Grimbold-Dialogszene ----------------
   Schaltet sich frei, sobald alle 5 Basis-Zweige komplett gemaxed sind
   (siehe bkmpIdleRenderSkilltreePanel) - beim naechsten Rendern des
   Skilltree-Tabs poppt automatisch EINMALIG diese kleine Dialogszene auf,
   danach ist der Zweig normal bedienbar. Ob die Szene schon gesehen wurde,
   merkt sich NUR der Browser (localStorage) - bewusst KEIN Sync-Feld in
   idle_player_state (siehe Erklaerung bei der SQL-Migration/
   BKMP_IDLE_BRANCH_ORDER: nach dem dwarf_unlocked-Vorfall keine neue
   Kern-Spielstand-Spalte mehr ohne vorher ausgefuehrte Migration). Auf
   einem zweiten Geraet wuerde die Szene also notfalls ein zweites Mal
   auftauchen - rein kosmetisch, kein Fortschrittsrisiko. */
const BKMP_MEISTER_DIALOG_SEEN_KEY = 'bkmp-meister-dialog-seen';
function bkmpMeisterDialogSeen() {
  try { return localStorage.getItem(BKMP_MEISTER_DIALOG_SEEN_KEY) === '1'; } catch (e) { return false; }
}
function bkmpMeisterMarkDialogSeen() {
  try { localStorage.setItem(BKMP_MEISTER_DIALOG_SEEN_KEY, '1'); } catch (e) {}
}

const BKMP_MEISTER_DIALOG_LINES = [
  { face: 'neutral', text: '„Hoho! Diese Rauchsäulen sah man meilenweit übers Tal, junger Anführer. Grimbold ist mein Name.“' },
  { face: 'erzaehlend', text: '„Einst hatte mein Clan die größte Schmiede unter dem Eisenberg. Klingen, die selbst Drachenschuppen durchtrennten, kamen aus unseren Essen.“' },
  { face: 'traurig', text: 'Sein Blick verdüstert sich. „Bis der Berg einstürzte. Alles unter sich begraben - die Schmiede, meine Brüder, alles. Nur ich kam raus.“' },
  { face: 'nachdenklich', text: '„Seitdem ziehe ich umher. Suche einen Ort, der mein letztes Werk verdient. Viele Dörfer sah ich - keines hielt stand.“' },
  { face: 'ueberrascht', text: 'Er mustert deine Mauern, deine Truppen, deine Vorräte. „Aber DAS hier... jeder Winkel ausgebaut, jede Fertigkeit gemeistert. Das habe ich lange nicht gesehen.“' },
  { face: 'genervt', text: '„Diese Bögen und Kräuterkissen sind ja ganz nett - aber Stahl, ECHTER Stahl, kennt hier wohl niemand, hm?“' },
  { face: 'lachend', text: 'Er lacht dröhnend und klopft sich auf den Bauch. „Macht nichts! Genau deshalb bin ich hier. Zeig mir Platz an deiner Esse, und ich mach aus deinem Dorf eine Festung, die man in drei Königreichen fürchtet!“' },
  { face: 'empoert', text: '„Also? Worauf wartest du noch?! Ein Zwerg wartet nicht gern - meine Geduld ist so kurz wie meine Beine!“' }
];
let bkmpMeisterDialogIndex = 0;
let bkmpMeisterDialogShowing = false;

function bkmpMeisterMaybeShowDialog() {
  if (bkmpMeisterDialogShowing) return;
  bkmpMeisterDialogShowing = true;
  bkmpMeisterDialogIndex = 0;
  const overlay = document.getElementById('idleMeisterDialogOverlay');
  if (!overlay) { bkmpMeisterDialogShowing = false; return; }
  overlay.classList.add('visible');
  bkmpMeisterRenderDialogStep();
  const nextBtn = document.getElementById('idleMeisterDialogNextBtn');
  if (nextBtn) nextBtn.onclick = bkmpMeisterAdvanceDialog;
}

function bkmpMeisterRenderDialogStep() {
  const line = BKMP_MEISTER_DIALOG_LINES[bkmpMeisterDialogIndex];
  if (!line) return;
  const img = document.getElementById('idleMeisterDialogFace');
  const text = document.getElementById('idleMeisterDialogText');
  const btn = document.getElementById('idleMeisterDialogNextBtn');
  const step = document.getElementById('idleMeisterDialogStep');
  if (img) img.src = `assets/dwarf/dwarf-${line.face}.png`;
  if (text) text.textContent = line.text;
  if (step) step.textContent = `${bkmpMeisterDialogIndex + 1}/${BKMP_MEISTER_DIALOG_LINES.length}`;
  const isLast = bkmpMeisterDialogIndex >= BKMP_MEISTER_DIALOG_LINES.length - 1;
  if (btn) btn.textContent = isLast ? 'Willkommen, Grimbold!' : 'Weiter';
}

function bkmpMeisterAdvanceDialog() {
  if (bkmpMeisterDialogIndex >= BKMP_MEISTER_DIALOG_LINES.length - 1) {
    bkmpMeisterCloseDialog();
    return;
  }
  bkmpMeisterDialogIndex += 1;
  bkmpMeisterRenderDialogStep();
}

function bkmpMeisterCloseDialog() {
  const overlay = document.getElementById('idleMeisterDialogOverlay');
  if (overlay) overlay.classList.remove('visible');
  bkmpMeisterMarkDialogSeen();
  bkmpMeisterDialogShowing = false;
  bkmpIdleRenderSkilltreePanel();
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
  loot_chance_pct: v => `+${v}% Lootchance`,
  attack_pct: v => `+${v}% Angriff`,
  defense_pct: v => `+${v}% Verteidigung`,
  hp_pct: v => `+${v}% Leben`,
  crit_damage_pct: v => `+${v}% Krit-Schaden`,
  prestige_point_bonus_pct: v => `+${v}% Prestige-Punkte`
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
  const unlockedCount = bonusTitles.filter(t => bkmpIdleTitleUnlockedSticky(t, ctx)).length;
  const newBadge = typeof bkmpNewBadgeChecker === 'function' ? bkmpNewBadgeChecker('idletitles') : () => '';
  const rows = bonusTitles.map(title => {
    const unlocked = bkmpIdleTitleUnlockedSticky(title, ctx);
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

/* NACHBESSERUNG (Spieler-Wunsch 13.07.: "Sammlung und Erfolge sind 1zu1
   das gleiche, bitte pack das zusammen") - beide Tabs zeigten bereits
   dieselbe Titel-Boni-Liste (siehe bkmpIdleBuildTitleBonusListHtml) und
   unterschieden sich nur durch jeweils EINEN Shortcut-Button (Sammlung:
   "Kosmetik öffnen", Erfolge: "Erfolge öffnen") - zwei fast identische
   Tabs fuer im Grunde eine einzige Sache. Der "Sammlung"-Tab entfaellt
   komplett, der "Kosmetik öffnen"-Button zieht mit hier rein, sodass
   beide Shortcuts jetzt gemeinsam im verbleibenden "Erfolge"-Tab stehen. */
function bkmpIdleRenderErfolgePanel() {
  const panel = document.getElementById('idlePanelErfolge');
  if (!panel) return;
  panel.innerHTML = `
    <p class="idle-panel-hint">Deine Idle-Dorf-Erfolge und -Kosmetiken schaltest du durch Fortschritt frei und findest sie in deinem Erfolge-Fenster.</p>
    <div class="idle-erfolge-shortcut-row">
      <button type="button" class="btn-ja" id="idleOpenAchievementsBtn">Erfolge öffnen</button>
      <button type="button" class="btn-ja" id="idleOpenCosmeticsBtn">Kosmetik öffnen</button>
    </div>
    ${bkmpIdleBuildTitleBonusListHtml()}
  `;
  const achBtn = document.getElementById('idleOpenAchievementsBtn');
  if (achBtn) achBtn.addEventListener('click', () => {
    bkmpIdleCloseModal();
    const mcNameBadge = document.getElementById('mcNameBadge');
    if (mcNameBadge) mcNameBadge.click();
  });
  const cosBtn2 = document.getElementById('idleOpenCosmeticsBtn');
  if (cosBtn2) cosBtn2.addEventListener('click', () => {
    bkmpIdleCloseModal();
    const mcNameBadge = document.getElementById('mcNameBadge');
    if (mcNameBadge) mcNameBadge.click();
    window.setTimeout(() => { const cosBtn = document.getElementById('achievementsSubtabCosmetics'); if (cosBtn) cosBtn.click(); }, 60);
  });
}

/* ---------------- Rendering: Arena-Tab (siehe supabase-idle-arena.sql) ----------------
   Asynchroner PvP-Kampf gegen die zuletzt synchronisierten Kampfwerte
   anderer Spieler - die eigentliche Kampfabwicklung (Rating-Aenderung,
   Gold-Belohnung) laeuft komplett serverseitig ueber arena_attack(), hier
   nur Anzeige + Angriffs-Button. bkmpArenaMyAuthUserId wird einmalig beim
   ersten Oeffnen des Tabs per Session-Check ermittelt (gleiches Muster wie
   bkmpRaidRefreshAchievementCache). */
let bkmpArenaMyAuthUserId = null;
let bkmpArenaMyRating = null;
let bkmpArenaOpponents = [];
let bkmpArenaRecentBattles = [];
let bkmpArenaLoaded = false;
let bkmpArenaLoading = false;
let bkmpArenaAttacking = null;

async function bkmpArenaEnsureMyAuthUserId() {
  if (bkmpArenaMyAuthUserId) return bkmpArenaMyAuthUserId;
  const client = typeof bkmpGetPlayerAuthClient === 'function' ? bkmpGetPlayerAuthClient() : null;
  if (!client) return null;
  try {
    const { data: sessionData } = await client.auth.getSession();
    bkmpArenaMyAuthUserId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  } catch (e) { bkmpArenaMyAuthUserId = null; }
  return bkmpArenaMyAuthUserId;
}

/* Erfolge-/Titel-Anbindung (gleiches Cache-Muster wie
   bkmpRaidGetAchievementContextFields/bkmpRaidRefreshAchievementCache) -
   arena_ratings.wins wird lokal gecacht, damit Erfolge/Titel auch offline
   ihren letzten bekannten Stand zeigen. */
const BKMP_ARENA_ACHIEVEMENT_CACHE_KEY = 'bkmp-arena-achievement-fields-cache';
function bkmpArenaGetAchievementContextFields() {
  try {
    return JSON.parse(localStorage.getItem(BKMP_ARENA_ACHIEVEMENT_CACHE_KEY) || 'null') || { arenaWins: 0, arenaRating: 1000 };
  } catch (e) {
    return { arenaWins: 0, arenaRating: 1000 };
  }
}
async function bkmpArenaRefreshAchievementCache() {
  try {
    const rating = await bkmpArenaGetMyRating();
    const fields = { arenaWins: rating ? rating.wins : 0, arenaRating: rating ? rating.rating : 1000 };
    localStorage.setItem(BKMP_ARENA_ACHIEVEMENT_CACHE_KEY, JSON.stringify(fields));
    if (typeof renderAchievementBadge === 'function') renderAchievementBadge(true);
  } catch (e) { /* offline/kein Login - alter Cache-Stand bleibt bestehen */ }
}

async function bkmpArenaLoadAll() {
  bkmpArenaLoading = true;
  const uid = await bkmpArenaEnsureMyAuthUserId();
  try {
    bkmpArenaMyRating = uid ? await bkmpArenaGetMyRating() : null;
    bkmpArenaOpponents = uid ? await bkmpArenaGetOpponents(uid, bkmpArenaMyRating ? bkmpArenaMyRating.rating : 1000, 8) : [];
    bkmpArenaRecentBattles = uid ? await bkmpArenaGetRecentBattles(uid, 15) : [];
  } catch (e) {
    console.warn('Arena-Daten konnten nicht geladen werden.', e);
  }
  bkmpArenaLoaded = true;
  bkmpArenaLoading = false;
}

function bkmpArenaFormatTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('de-DE'); } catch (e) { return ''; }
}

/* Kampfanimation (Spieler-Wunsch 14.07.: "Dorf gegen Dorf?") - rein
   kosmetisch: arena_attack() hat das Ergebnis schon serverseitig
   entschieden (ein einzelner RPC-Aufruf, kein Mehrfach-Tick-Kampf wie beim
   Weltboss-Raid), die Animation spielt nur eine plausible Annaeherung
   daran ab, bevor das Ergebnis final angezeigt wird. Gibt ein Promise
   zurueck, das nach Ende der Animation aufloest. */
function bkmpArenaPlayBattleAnimation(myName, opponentName, won, myVillageSkin, opponentVillageSkin) {
  return new Promise(resolve => {
    const overlay = document.getElementById('arenaBattleOverlay');
    if (!overlay) { resolve(); return; }
    const meFill = document.getElementById('arenaBattleMeHpFill');
    const oppFill = document.getElementById('arenaBattleOpponentHpFill');
    const resultEl = document.getElementById('arenaBattleResult');
    document.getElementById('arenaBattleMeName').textContent = myName || 'Du';
    document.getElementById('arenaBattleOpponentName').textContent = opponentName || 'Gegner';
    /* Jeder mit seinem eigenen ausgeruesteten Dorf-Skin (Spieler-Wunsch
       14.07.) - eigene Seite: Ownership-Check greift ganz normal, Gegner-
       Seite: Server-Angabe wird vertraut (siehe
       bkmpApplyVillageSkinToElement, checkOwnership:false). */
    bkmpApplyVillageSkinToElement(document.getElementById('arenaBattleMeSprite'), myVillageSkin);
    bkmpApplyVillageSkinToElement(document.getElementById('arenaBattleOpponentSprite'), opponentVillageSkin, { checkOwnership: false });
    meFill.style.width = '100%';
    oppFill.style.width = '100%';
    resultEl.textContent = ' ';
    overlay.classList.add('visible');

    const loserFill = won ? oppFill : meFill;
    const loserId = won ? 'arenaBattleOpponent' : 'arenaBattleMe';
    const winnerFill = won ? meFill : oppFill;
    const winnerId = won ? 'arenaBattleMe' : 'arenaBattleOpponent';
    const winnerFinalPct = 30 + Math.round(Math.random() * 40);
    const ticks = 5;
    let tick = 0;
    const spawnDmg = (targetId, isCrit) => {
      const target = document.getElementById(targetId);
      if (!target) return;
      const dmg = document.createElement('span');
      dmg.className = 'idle-dmg-float' + (isCrit ? ' idle-dmg-crit' : '');
      dmg.textContent = '-' + Math.round(8 + Math.random() * 30) + (isCrit ? '!' : '');
      target.appendChild(dmg);
      window.setTimeout(() => dmg.remove(), 800);
    };
    const step = () => {
      tick++;
      const loserPct = Math.max(0, Math.round(100 - (100 / ticks) * tick));
      const winnerPct = tick >= ticks ? winnerFinalPct : Math.max(winnerFinalPct, Math.round(100 - ((100 - winnerFinalPct) / ticks) * tick));
      loserFill.style.width = loserPct + '%';
      winnerFill.style.width = winnerPct + '%';
      if (typeof bkmpIdleSpawnHitFlash === 'function') {
        bkmpIdleSpawnHitFlash(loserId);
        if (Math.random() < 0.4) bkmpIdleSpawnHitFlash(winnerId);
      }
      spawnDmg(loserId, tick === ticks);
      if (Math.random() < 0.5) spawnDmg(winnerId, false);
      if (tick < ticks) {
        window.setTimeout(step, 420);
      } else {
        resultEl.textContent = won ? '🏆 Sieg!' : '💥 Niederlage';
        resultEl.style.color = won ? '#4ade80' : '#f87171';
        window.setTimeout(() => { overlay.classList.remove('visible'); resolve(); }, 1100);
      }
    };
    window.setTimeout(step, 350);
  });
}

async function bkmpIdleRenderArenaPanel() {
  const panel = document.getElementById('idlePanelArena');
  if (!panel) return;

  if (!bkmpArenaLoaded && !bkmpArenaLoading) {
    panel.innerHTML = '<p class="idle-dungeon-best">⏳ Lade Arena...</p>';
    await bkmpArenaLoadAll();
  }

  const uid = bkmpArenaMyAuthUserId;
  if (!uid) {
    panel.innerHTML = `
      <div class="idle-dungeon-intro">
        <h4>⚔️ PvP-Arena</h4>
        <p>Melde dich mit deinem Spieler-Konto an und spiele mindestens einmal im Kampf-Tab, um in der Arena gegen andere Spieler anzutreten.</p>
      </div>`;
    return;
  }

  const rating = bkmpArenaMyRating ? bkmpArenaMyRating.rating : 1000;
  const wins = bkmpArenaMyRating ? bkmpArenaMyRating.wins : 0;
  const losses = bkmpArenaMyRating ? bkmpArenaMyRating.losses : 0;
  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  /* Tageslimit-Anzeige (Spieler-Wunsch 14.07.: "Arena nur 10x Täglich
     Angreifen reset um 0:00") - reine Client-Schaetzung aus den ohnehin
     schon geladenen letzten Kaempfen (server-seitig ist arena_attack() die
     eigentliche, verbindliche Grenze - siehe supabase-idle-arena-daily-
     limit.sql). Reicht fuer die Anzeige, weil ein Tageslimit von 10 locker
     innerhalb der geladenen 15 juengsten Kaempfe liegt. */
  const todayStr = new Date().toDateString();
  const attacksToday = bkmpArenaRecentBattles.filter(b => b.wasAttacker && new Date(b.occurredAt).toDateString() === todayStr).length;
  const attacksLeft = Math.max(0, 10 - attacksToday);

  panel.innerHTML = `
    <div class="idle-dungeon-intro">
      <h4>⚔️ PvP-Arena</h4>
      <p>Asynchroner Kampf gegen die aktuellen Kampfwerte anderer Spieler - kein Echtzeit-Duell, dein Gegner muss nicht online sein. Sieg bringt Rating + Gold, Niederlage kostet nur Rating (nie Gold).</p>
      <p class="idle-dungeon-best">🏅 Dein Rating: <strong>${rating}</strong> &middot; ${wins}S / ${losses}N ${total > 0 ? `(${winRate}% Siegquote)` : ''}</p>
      <p>⚔️ Angriffe heute: <strong>${attacksLeft}/10</strong> übrig &middot; Reset um 0 Uhr</p>
    </div>
    <div class="idle-arena-opponents">
      <h4 style="margin-top:1rem;">Gegner in deiner Nähe</h4>
      ${attacksLeft === 0 ? '<p class="empty-hint">Tageslimit erreicht - morgen um 0 Uhr geht es weiter.</p>' : ''}
      ${bkmpArenaOpponents.length === 0 ? '<p class="empty-hint">Noch keine anderen Spieler in der Arena. Schau später nochmal vorbei.</p>' : bkmpArenaOpponents.map(o => `
        <div class="idle-arena-opponent-card" data-opponent-uid="${escapeHtml(o.authUserId)}">
          <span class="idle-arena-opponent-name">${escapeHtml(o.displayName)}</span>
          <span class="idle-arena-opponent-rating">🏅 ${o.rating}</span>
          <span class="idle-arena-opponent-record">${o.wins}S/${o.losses}N</span>
          <button type="button" class="btn-ja idle-arena-attack-btn" ${bkmpArenaAttacking || attacksLeft === 0 ? 'disabled' : ''}>${bkmpArenaAttacking === o.authUserId ? '⏳...' : '⚔️ Angreifen'}</button>
        </div>
      `).join('')}
    </div>
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">Letzte Kämpfe</h4>
      ${bkmpArenaRecentBattles.length === 0 ? '<p class="empty-hint">Noch keine Kämpfe.</p>' : bkmpArenaRecentBattles.map(b => {
        const won = b.wasAttacker ? b.attackerWon : !b.attackerWon;
        const opponentName = escapeHtml(b.wasAttacker ? b.defenderName : b.attackerName);
        /* Spieler-Report (15.07., "Die verloren Nachrichten machen
           grammatisch gar keinen Sinn", Screenshot: "vlceBlade verloren
           gegen", "Kaledoss überrumpelt von dich"): das feste Praefix-
           /Verb-/Suffix-Muster ging nur fuer EINEN der vier Faelle
           (wasAttacker+gewonnen, "Du hast X besiegt") tatsaechlich auf -
           bei den anderen drei landete "gegen"/das Subjekt an der
           falschen Stelle oder fehlte ganz. Jetzt pro Fall ein
           vollstaendiger, eigenstaendiger Satz statt eines generischen
           Bausteins. */
        const phrase = b.wasAttacker
          ? (won ? `Du hast ${opponentName} besiegt` : `Du hast gegen ${opponentName} verloren`)
          : (won ? `Du hast ${opponentName} abgewehrt` : `${opponentName} hat dich überrumpelt`);
        return `<p class="idle-dungeon-best">${won ? '✅' : '❌'} ${phrase} &middot; ${b.wasAttacker ? (won ? '+' : '') + b.ratingChange : (won ? '+' : '') + (-b.ratingChange)} Rating${b.goldReward ? ` &middot; +${b.goldReward} 💰` : ''} &middot; ${bkmpArenaFormatTime(b.occurredAt)}</p>`;
      }).join('')}
    </div>
  `;

  panel.querySelectorAll('.idle-arena-attack-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-opponent-uid]');
      const opponentUid = card ? card.dataset.opponentUid : null;
      const opponent = bkmpArenaOpponents.find(o => o.authUserId === opponentUid);
      const opponentName = opponent ? opponent.displayName : 'Gegner';
      if (!opponentUid || bkmpArenaAttacking) return;
      bkmpArenaAttacking = opponentUid;
      bkmpIdleRenderArenaPanel();
      try {
        const result = await bkmpArenaAttack(opponentUid);
        if (result) {
          const myName = (typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '') || 'Du';
          const myVillageSkin = typeof bkmpGetActiveVillageSkinId === 'function' ? bkmpGetActiveVillageSkinId() : 'standard';
          const opponentVillageSkin = opponent ? opponent.activeVillageSkin : 'standard';
          await bkmpArenaPlayBattleAnimation(myName, opponentName, result.won, myVillageSkin, opponentVillageSkin);
          if (result.won) bkmpGuildQuestAddDelta('arena_wins', 1);
          const msg = result.won
            ? `⚔️ Sieg gegen ${result.defenderName}! +${result.ratingChange} Rating, +${result.goldReward} 💰 (jetzt ${result.newRating})`
            : `⚔️ Niederlage gegen ${result.defenderName}. ${result.ratingChange} Rating (jetzt ${result.newRating})`;
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(msg, 3800);
          bkmpIdleLog(msg);
          bkmpArenaRefreshAchievementCache();
        }
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message || 'Angriff fehlgeschlagen.', 3200);
      }
      bkmpArenaAttacking = null;
      bkmpArenaLoaded = false;
      await bkmpIdleRenderArenaPanel();
    });
  });
}

/* ---------------- Rendering: Gilde-Tab (siehe supabase-idle-guilds.sql) ----------------
   Jeder Spieler ist maximal in EINER Gilde - der Tab zeigt je nach Zustand
   entweder die eigene Gilde (Kasse/Mitglieder/Rollen) oder eine Gruenden-/
   Beitreten-Ansicht. Kassen-Bonus-Anzeige nutzt dieselben Meilenstein-
   Stufen wie bkmpIdleGuildTreasuryBonusPct() (Stat-Verdrahtung). */
let bkmpGuildMyAuthUserId = null;
let bkmpGuildState = null;
let bkmpGuildBrowseList = [];
let bkmpGuildLoaded = false;
let bkmpGuildLoading = false;
let bkmpGuildBusy = false;
let bkmpGuildChatMessages = [];
let bkmpGuildChatLoadedForGuildId = null;
let bkmpGuildStateSubscribedForGuildId = null;
let bkmpGuildSettingsOpen = false;
let bkmpGuildMyInviteCode = null;
let bkmpGuildActivityLog = [];
let bkmpGuildActivityLoadedForGuildId = null;
/* ---------------- Beitrittsanfragen (siehe supabase-guild-join-requests.sql) ----------------
   Spieler-Feedback (16.07.): Mitgliederlisten auch in der Durchsuchen-
   Ansicht zeigen, private Gilden dort nicht mehr komplett ausblenden,
   und eine Anfrage-Funktion als Alternative zum reinen Code-Beitritt. */
let bkmpGuildMyJoinRequests = [];
let bkmpGuildJoinRequests = [];
let bkmpGuildJoinRequestsLoadedForGuildId = null;
let bkmpGuildExpandedBrowseGuildId = null;
let bkmpGuildBrowseMembersCache = {};
let bkmpGuildTechLevels = {};
let bkmpGuildTechLoadedForGuildId = null;
let bkmpGuildQuests = [];
let bkmpGuildQuestsLoadedForGuildId = null;
const BKMP_GUILD_QUEST_CATALOG = {
  dragon_kills: { label: 'Drachen besiegen', icon: '🐉', format: v => bkmpIdleFormatNumber(v) },
  gold_earned: { label: 'Gold sammeln', icon: '💰', format: v => bkmpIdleFormatNumber(v) + ' 💰' },
  arena_wins: { label: 'Arena-Kämpfe gewinnen', icon: '⚔️', format: v => bkmpIdleFormatNumber(v) },
  prestige_ups: { label: 'Mal aufsteigen (Prestige)', icon: '🌌', format: v => bkmpIdleFormatNumber(v) }
};
const BKMP_GUILD_QUEST_TIER_REWARD_LABEL = {
  1: '2.000 💰 + 20 💎',
  2: '6.000 💰 + 50 💎 + 🔮 Runenkiste',
  3: '15.000 💰 + 100 💎 + 🥚 Legendäres Ei + 10 🌌'
};
let bkmpGuildPresenceMap = {};
let bkmpGuildPresenceLoadedAt = 0;

/* ---------------- Online-Status (siehe player_presence in
   supabase-guild-extension-foundation.sql) ----------------
   Heartbeat laeuft fuer die gesamte Sitzung, sobald ein Spielername
   bekannt ist (nicht erst beim Oeffnen des Idle-Dorf-Fensters oder gar
   erst im Gilde-Tab) - der Kampf laeuft laut bkmpIdleCloseModal() auch
   im Hintergrund weiter, "online" soll also den ganzen Tab-Besuch
   abdecken, nicht nur ein offenes Popup. */
const BKMP_GUILD_PRESENCE_HEARTBEAT_MS = 25000;
const BKMP_GUILD_PRESENCE_STALE_MS = 45000;
let bkmpGuildPresenceHeartbeatTimer = null;
function bkmpGuildStartPresenceHeartbeat() {
  if (bkmpGuildPresenceHeartbeatTimer) return;
  if (typeof bkmpPlayerHeartbeat !== 'function') return;
  bkmpPlayerHeartbeat();
  bkmpGuildPresenceHeartbeatTimer = window.setInterval(bkmpPlayerHeartbeat, BKMP_GUILD_PRESENCE_HEARTBEAT_MS);
}

function bkmpGuildFormatPresence(lastSeenAt) {
  if (!lastSeenAt) return '⚫ Nie online gewesen';
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  if (diffMs < BKMP_GUILD_PRESENCE_STALE_MS) return '🟢 Online';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return '⚫ Gerade eben offline';
  if (mins < 60) return `⚫ Zuletzt online vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `⚫ Zuletzt online vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `⚫ Zuletzt online vor ${days} Tag${days === 1 ? '' : 'en'}`;
}

/* ---------------- Aktivitätslog (siehe guild_activity_log) ----------------
   Server speichert nur Rohdaten (kind/actor_name/value/extra), die
   deutsche Anzeige entsteht komplett hier - gleiches Prinzip wie ueberall
   sonst in diesem Projekt (z.B. Raid-Teilnehmer speichern rohe Zahlen,
   nicht fertige Saetze). */
function bkmpGuildFormatActivityEntry(entry) {
  const name = entry.actorName ? escapeHtml(entry.actorName) : '';
  switch (entry.kind) {
    case 'contribute': return `💰 ${name} spendete ${bkmpIdleFormatNumber(entry.value)} Gold.`;
    case 'join': return `➕ ${name} trat der Gilde bei.`;
    case 'leave': return `➖ ${name} hat die Gilde verlassen.`;
    case 'kick': return `🚫 ${name} wurde aus der Gilde entfernt.`;
    case 'level_up': return `🏰 Gildenlevel ${entry.value} erreicht!`;
    case 'slot_purchase': return `🏗️ ${name} hat einen Gildenplatz dazugekauft (jetzt ${entry.value} Plätze).`;
    case 'promote': return `⭐ ${name} wurde befördert.`;
    case 'demote': return `⬇️ ${name} wurde degradiert.`;
    case 'boss_defeated': return `🐉 Gildenboss${entry.extra ? ' ' + escapeHtml(entry.extra) : ''} besiegt!`;
    case 'quest_completed': return `🎯 Gildenquest${entry.extra ? ` "${escapeHtml(entry.extra)}"` : ''} abgeschlossen!`;
    default: return `${name} ${escapeHtml(entry.kind)}`;
  }
}

const BKMP_GUILD_ROLE_CHAT_CLASS = {
  leader: 'idle-guild-chat-role-leader',
  officer: 'idle-guild-chat-role-officer',
  veteran: 'idle-guild-chat-role-veteran',
  member: 'idle-guild-chat-role-member'
};

async function bkmpGuildEnsureMyAuthUserId() {
  if (bkmpGuildMyAuthUserId) return bkmpGuildMyAuthUserId;
  const client = typeof bkmpGetPlayerAuthClient === 'function' ? bkmpGetPlayerAuthClient() : null;
  if (!client) return null;
  try {
    const { data: sessionData } = await client.auth.getSession();
    bkmpGuildMyAuthUserId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  } catch (e) { bkmpGuildMyAuthUserId = null; }
  return bkmpGuildMyAuthUserId;
}

let bkmpGuildLevelThresholds = [];

async function bkmpGuildLoadAll() {
  bkmpGuildLoading = true;
  const uid = await bkmpGuildEnsureMyAuthUserId();
  try {
    bkmpGuildState = uid ? await bkmpGuildGetMine() : null;
    bkmpGuildBrowseList = uid && !bkmpGuildState ? await bkmpGuildBrowse(30) : [];
    bkmpGuildMyJoinRequests = uid && !bkmpGuildState && typeof bkmpGuildLoadMyJoinRequests === 'function' ? await bkmpGuildLoadMyJoinRequests() : [];
    if (!bkmpGuildLevelThresholds.length && typeof bkmpGuildGetLevelThresholds === 'function') {
      bkmpGuildLevelThresholds = await bkmpGuildGetLevelThresholds();
    }
  } catch (e) {
    console.warn('Gilden-Daten konnten nicht geladen werden.', e);
  }
  bkmpGuildLoaded = true;
  bkmpGuildLoading = false;
}

/* Levelkurve lebt komplett in guild_level_thresholds (DB) - hier nur die
   reine Client-Berechnung aus dem einmalig geladenen, gecachten Array
   (siehe bkmpGuildGetLevelThresholds in supabase.js). */
function bkmpGuildLevelInfo(xp) {
  const thresholds = bkmpGuildLevelThresholds.length ? bkmpGuildLevelThresholds : [{ level: 1, xpRequired: 0 }];
  let current = thresholds[0];
  let next = null;
  for (let i = 0; i < thresholds.length; i++) {
    if (thresholds[i].xpRequired <= xp) current = thresholds[i];
    else { next = thresholds[i]; break; }
  }
  const span = next ? next.xpRequired - current.xpRequired : 0;
  const progressed = next ? xp - current.xpRequired : 0;
  const pct = next && span > 0 ? Math.min(100, Math.floor((progressed / span) * 100)) : 100;
  return { level: current.level, xpIntoLevel: progressed, xpForLevel: span, nextLevelXp: next ? next.xpRequired : null, pct };
}

const BKMP_GUILD_ROLE_LABELS = { leader: '👑 Anführer', officer: '⭐ Stellvertreter', veteran: '🛡 Veteran', member: '👤 Mitglied' };
const BKMP_GUILD_MEDALS = ['🥇', '🥈', '🥉'];

/* ---------------- Gildenbanner (siehe guilds.banner + supabase-guild-banner.sql)
   ----------------
   Baukasten aus kuratierten Presets statt Bild-Upload (vermeidet
   Moderations-/Storage-Aufwand) - Farbverlauf + Symbol-Emoji, gespeichert
   als {"color":"gold","symbol":"🐉"}. bkmpRenderGuildBanner() wird an
   mehreren Stellen wiederverwendet (Gildenkopf, Gilden-durchsuchen-Karten,
   Gildenboss-Ansicht). */
const BKMP_GUILD_BANNER_COLORS = [
  { id: 'gold', label: 'Gold', from: '#fbbf24', to: '#b45309' },
  { id: 'blue', label: 'Blau', from: '#60a5fa', to: '#1d4ed8' },
  { id: 'red', label: 'Rot', from: '#f87171', to: '#b91c1c' },
  { id: 'purple', label: 'Lila', from: '#c084fc', to: '#6d28d9' },
  { id: 'green', label: 'Grün', from: '#4ade80', to: '#15803d' },
  { id: 'teal', label: 'Türkis', from: '#5eead4', to: '#0f766e' },
  { id: 'silver', label: 'Silber', from: '#e5e7eb', to: '#6b7280' },
  { id: 'black', label: 'Schwarz-Rot', from: '#4b5563', to: '#1f1f1f' }
];
const BKMP_GUILD_BANNER_SYMBOLS = ['🐉', '🛡️', '⚔️', '🔥', '❄️', '🌙', '⭐', '💀', '🦅', '🐺', '🦁', '🌊', '⚡', '👑', '🏰', '🌳'];
function bkmpRenderGuildBanner(banner, size) {
  const colorId = (banner && banner.color) || BKMP_GUILD_BANNER_COLORS[0].id;
  const colors = BKMP_GUILD_BANNER_COLORS.find(c => c.id === colorId) || BKMP_GUILD_BANNER_COLORS[0];
  const symbol = (banner && banner.symbol) || BKMP_GUILD_BANNER_SYMBOLS[0];
  const px = size || 48;
  return `<span class="idle-guild-banner" style="width:${px}px;height:${px}px;font-size:${Math.round(px * 0.55)}px;background:linear-gradient(135deg, ${colors.from}, ${colors.to});">${symbol}</span>`;
}
/* Rollen-Leiter fuer Befoerdern/Degradieren-Buttons (leader steht bewusst
   NICHT auf der Leiter - Fuehrung wechselt nur automatisch beim
   Gilde-Verlassen des Anfuehrers, siehe leave_guild() RPC, nicht per
   Knopfdruck). */
const BKMP_GUILD_ROLE_LADDER = ['member', 'veteran', 'officer'];
function bkmpGuildNextRoleUp(role) {
  const i = BKMP_GUILD_ROLE_LADDER.indexOf(role);
  return i >= 0 && i < BKMP_GUILD_ROLE_LADDER.length - 1 ? BKMP_GUILD_ROLE_LADDER[i + 1] : null;
}
function bkmpGuildNextRoleDown(role) {
  const i = BKMP_GUILD_ROLE_LADDER.indexOf(role);
  return i > 0 ? BKMP_GUILD_ROLE_LADDER[i - 1] : null;
}

async function bkmpIdleRenderGildePanel() {
  const panel = document.getElementById('idlePanelGilde');
  if (!panel) return;

  if (!bkmpGuildLoaded && !bkmpGuildLoading) {
    panel.innerHTML = '<p class="idle-dungeon-best">⏳ Lade Gilde...</p>';
    await bkmpGuildLoadAll();
  }

  const uid = bkmpGuildMyAuthUserId;
  if (!uid) {
    if (typeof bkmpUnsubscribeFromGuildChat === 'function') bkmpUnsubscribeFromGuildChat();
    if (typeof bkmpUnsubscribeFromGuildState === 'function') bkmpUnsubscribeFromGuildState();
    panel.innerHTML = `
      <div class="idle-dungeon-intro">
        <h4>🛡️ Gilde</h4>
        <p>Melde dich mit deinem Spieler-Konto an und spiele mindestens einmal im Kampf-Tab, um einer Gilde beizutreten oder eine zu gründen.</p>
      </div>`;
    return;
  }

  if (!bkmpGuildState) {
    if (typeof bkmpUnsubscribeFromGuildChat === 'function') bkmpUnsubscribeFromGuildChat();
    if (typeof bkmpUnsubscribeFromGuildState === 'function') bkmpUnsubscribeFromGuildState();
    bkmpGuildChatLoadedForGuildId = null;
    bkmpGuildStateSubscribedForGuildId = null;
    bkmpGuildActivityLoadedForGuildId = null;
    panel.innerHTML = `
      <div class="idle-dungeon-intro">
        <h4>🛡️ Gilde gründen</h4>
        <p>Schließ dich mit anderen Spielern zusammen: gemeinsame Kasse, Kassen-Meilensteine geben ALLEN Mitgliedern dauerhafte Boni. Gründung kostet <strong>500.000 Gold</strong> (wird direkt zur Startkasse deiner neuen Gilde).</p>
        <div class="idle-guild-create-row">
          <input type="text" id="idleGuildNameInput" placeholder="Gildenname" maxlength="32">
          <input type="text" id="idleGuildTagInput" placeholder="Kürzel (max. 5)" maxlength="5" style="max-width:110px;">
          <button type="button" class="btn-ja idle-guild-create-btn" id="idleGuildCreateBtn" ${bkmpGuildBusy ? 'disabled' : ''}>Gründen (500.000 Gold)</button>
        </div>
        <p style="margin-top:0.8rem;">Hast du einen Einladungscode für eine private Gilde bekommen?</p>
        <div class="idle-guild-create-row">
          <input type="text" id="idleGuildCodeInput" placeholder="Einladungscode" maxlength="8" style="text-transform:uppercase;">
          <button type="button" class="btn-nein idle-guild-join-code-btn" id="idleGuildJoinCodeBtn" ${bkmpGuildBusy ? 'disabled' : ''}>Beitreten</button>
        </div>
      </div>
      <div class="idle-arena-history">
        <h4 style="margin-top:1rem;">Gilden durchsuchen</h4>
        ${bkmpGuildBrowseList.length === 0 ? '<p class="empty-hint">Noch keine Gilden vorhanden. Gründe die erste!</p>' : bkmpGuildBrowseList.map(g => {
          const level = bkmpGuildLevelInfo(g.guildXp).level;
          const winRate = g.bossAttempts > 0 ? Math.round((g.bossesDefeated / g.bossAttempts) * 100) : null;
          /* Spieler-Feedback (16.07.): private Gilden nicht mehr komplett
             ausblenden (guilds/guild_members sind serverseitig ohnehin
             oeffentlich lesbar, siehe Kommentar bei bkmpGuildBrowse in
             supabase.js) - stattdessen mit 🔒 kennzeichnen und statt des
             Sofort-Beitritts eine Anfrage anbieten, die Anfuehrer/
             Stellvertreter/Veteran annehmen oder ablehnen koennen. */
          const myRequest = bkmpGuildMyJoinRequests.find(r => r.guildId === g.id);
          const isExpanded = bkmpGuildExpandedBrowseGuildId === g.id;
          const members = bkmpGuildBrowseMembersCache[g.id];
          let actionHtml;
          if (g.isPublic) {
            actionHtml = `<button type="button" class="btn-ja idle-guild-join-btn" ${bkmpGuildBusy || g.memberCount >= g.maxMembers ? 'disabled' : ''}>${g.memberCount >= g.maxMembers ? 'Voll' : 'Beitreten'}</button>`;
          } else if (myRequest) {
            actionHtml = `<span class="idle-guild-request-pending">🕓 Anfrage ausstehend</span><button type="button" class="btn-nein idle-guild-cancel-request-btn" data-request-id="${escapeHtml(myRequest.id)}" ${bkmpGuildBusy ? 'disabled' : ''}>Zurückziehen</button>`;
          } else {
            actionHtml = `<button type="button" class="btn-ja idle-guild-request-btn" ${bkmpGuildBusy || g.memberCount >= g.maxMembers ? 'disabled' : ''}>${g.memberCount >= g.maxMembers ? 'Voll' : 'Anfrage senden'}</button>`;
          }
          return `
          <div class="idle-arena-opponent-card" data-guild-id="${escapeHtml(g.id)}">
            <span class="idle-arena-opponent-name">${g.isPublic ? '🌐' : '🔒'} ${bkmpRenderGuildBanner(g.banner, 28)} [${escapeHtml(g.tag)}] ${escapeHtml(g.name)}</span>
            <span class="idle-arena-opponent-rating">💰 ${bkmpIdleFormatNumber(g.treasuryGold)}</span>
            <span class="idle-arena-opponent-record">🏰 Lvl ${level} &middot; ${g.memberCount}/${g.maxMembers} Mitglieder${winRate !== null ? ` &middot; 🐲 ${g.bossesDefeated} (${winRate}%)` : ''}</span>
            <button type="button" class="btn-nein idle-guild-toggle-members-btn">${isExpanded ? 'Mitglieder ausblenden' : 'Mitglieder anzeigen'}</button>
            ${actionHtml}
            ${isExpanded ? `
              <div class="idle-guild-browse-members">
                ${!members ? '<p class="empty-hint">⏳ Lädt...</p>' : members.length === 0 ? '<p class="empty-hint">Keine Mitglieder.</p>' : members.map(m => `<span class="idle-guild-browse-member-chip">${escapeHtml(m.displayName)} &middot; ${BKMP_GUILD_ROLE_LABELS[m.role] || m.role}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        `;
        }).join('')}
      </div>
    `;
    const createBtn = document.getElementById('idleGuildCreateBtn');
    if (createBtn) createBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('idleGuildNameInput');
      const tagInput = document.getElementById('idleGuildTagInput');
      if (!nameInput.value.trim() || !tagInput.value.trim()) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Bitte Name und Kürzel eintragen.', 2800);
        return;
      }
      bkmpGuildBusy = true;
      try {
        await bkmpGuildCreate(nameInput.value.trim(), tagInput.value.trim());
        bkmpGuildLoaded = false;
        bkmpGuildRefreshTreasuryBonusCache();
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
    panel.querySelectorAll('.idle-guild-join-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-guild-id]');
        const guildId = card ? card.dataset.guildId : null;
        if (!guildId || bkmpGuildBusy) return;
        bkmpGuildBusy = true;
        try {
          await bkmpGuildJoin(guildId);
          bkmpGuildLoaded = false;
          bkmpGuildRefreshTreasuryBonusCache();
        } catch (e) {
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
        }
        bkmpGuildBusy = false;
        await bkmpIdleRenderGildePanel();
      });
    });
    panel.querySelectorAll('.idle-guild-toggle-members-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-guild-id]');
        const guildId = card ? card.dataset.guildId : null;
        if (!guildId) return;
        if (bkmpGuildExpandedBrowseGuildId === guildId) {
          bkmpGuildExpandedBrowseGuildId = null;
          await bkmpIdleRenderGildePanel();
          return;
        }
        bkmpGuildExpandedBrowseGuildId = guildId;
        if (!bkmpGuildBrowseMembersCache[guildId] && typeof bkmpGuildLoadMembersPublic === 'function') {
          await bkmpIdleRenderGildePanel();
          bkmpGuildBrowseMembersCache[guildId] = await bkmpGuildLoadMembersPublic(guildId).catch(() => []);
        }
        await bkmpIdleRenderGildePanel();
      });
    });
    panel.querySelectorAll('.idle-guild-request-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-guild-id]');
        const guildId = card ? card.dataset.guildId : null;
        if (!guildId || bkmpGuildBusy) return;
        bkmpGuildBusy = true;
        try {
          await bkmpGuildRequestJoin(guildId);
          bkmpGuildMyJoinRequests = await bkmpGuildLoadMyJoinRequests().catch(() => bkmpGuildMyJoinRequests);
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Beitrittsanfrage gesendet!', 3000);
        } catch (e) {
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
        }
        bkmpGuildBusy = false;
        await bkmpIdleRenderGildePanel();
      });
    });
    panel.querySelectorAll('.idle-guild-cancel-request-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (bkmpGuildBusy) return;
        bkmpGuildBusy = true;
        try {
          await bkmpGuildCancelJoinRequest(btn.dataset.requestId);
          bkmpGuildMyJoinRequests = await bkmpGuildLoadMyJoinRequests().catch(() => bkmpGuildMyJoinRequests);
        } catch (e) {
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
        }
        bkmpGuildBusy = false;
        await bkmpIdleRenderGildePanel();
      });
    });
    const joinCodeBtn = document.getElementById('idleGuildJoinCodeBtn');
    if (joinCodeBtn) joinCodeBtn.addEventListener('click', async () => {
      const codeInput = document.getElementById('idleGuildCodeInput');
      const code = (codeInput.value || '').trim();
      if (!code) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Bitte einen Einladungscode eintragen.', 2800);
        return;
      }
      bkmpGuildBusy = true;
      try {
        await bkmpGuildJoinByCode(code);
        bkmpGuildLoaded = false;
        bkmpGuildRefreshTreasuryBonusCache();
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
    return;
  }

  const g = bkmpGuildState.guild;
  const isLeader = bkmpGuildState.myRole === 'leader';
  const isLeaderOrOfficer = isLeader || bkmpGuildState.myRole === 'officer';
  const isModerator = isLeaderOrOfficer || bkmpGuildState.myRole === 'veteran';
  const bonusPct = typeof bkmpIdleGuildTreasuryBonusPct === 'function' ? bkmpIdleGuildTreasuryBonusPct(g.treasuryGold) : 0;
  const nextMilestone = typeof bkmpIdleGuildNextTreasuryMilestone === 'function' ? bkmpIdleGuildNextTreasuryMilestone(g.treasuryGold) : null;
  const levelInfo = bkmpGuildLevelInfo(g.guildXp);
  const slotsMaxed = g.bonusMemberSlots >= BKMP_GUILD_SLOT_MAX_BONUS;
  const nextSlotCost = bkmpGuildSlotCost(g.bonusMemberSlots);

  if (isLeader && bkmpGuildMyInviteCode === null && !g.isPublic) {
    bkmpGuildGetMyInviteCode().then(code => { bkmpGuildMyInviteCode = code || ''; bkmpIdleRenderGildePanel(); });
  }
  if (bkmpGuildChatLoadedForGuildId !== g.id) {
    bkmpGuildChatLoadedForGuildId = g.id;
    bkmpGuildGetChatMessages(g.id, 50).then(msgs => { bkmpGuildChatMessages = msgs; bkmpIdleRenderGildePanel(); }).catch(e => console.warn('Idle Dorf: Gildenchat konnte nicht geladen werden.', e));
    /* Echter Realtime-Kanal (Spieler-Wunsch: "moderner wirken") - vorher
       lud der Chat neue Nachrichten anderer Mitglieder erst beim naechsten
       eigenen Rendern/Senden nach. Neue Zeile wird direkt lokal angehaengt
       statt komplett neu zu laden (gleiches Prinzip wie beim Raid-HP-Sync).
       Flag wird SOFORT gesetzt (nicht erst nach Erfolg) - der Realtime-Kanal
       darf bei einem fehlgeschlagenen Erstladen nicht bei jedem Panel-Rerender
       ein zweites Mal abonniert werden. */
    if (typeof bkmpSubscribeToGuildChat === 'function') {
      bkmpSubscribeToGuildChat(g.id, row => {
        if (bkmpGuildChatMessages.some(m => m.id === row.id)) return;
        bkmpGuildChatMessages.push({
          id: row.id, authUserId: row.auth_user_id, displayName: row.display_name,
          message: row.message, createdAt: row.created_at
        });
        if (bkmpGuildChatMessages.length > 50) bkmpGuildChatMessages.shift();
        bkmpIdleRenderGildePanel();
      });
    }
  }
  if (bkmpGuildStateSubscribedForGuildId !== g.id) {
    bkmpGuildStateSubscribedForGuildId = g.id;
    /* Spieler-Wunsch (16.07.): "wenn Gold eingezahlt wird das es gleich
       für alle angezeigt wird, ohne reloaden zu müssen" - bisher patchte
       jede Gilden-Aktion (Beitrag/Levelaufstieg/Technologie/Platzkauf)
       nur den lokalen State des HANDELNDEN Spielers, alle anderen mit
       offenem Gilde-Tab sahen die Aenderung erst nach eigenem Neuladen.
       Siehe bkmpSubscribeToGuildState() in supabase.js fuer die genaue
       Kanal-/Filter-Begruendung. */
    if (typeof bkmpSubscribeToGuildState === 'function') {
      bkmpSubscribeToGuildState(g.id,
        row => {
          if (!bkmpGuildState || typeof bkmpGuildMapRow !== 'function') return;
          bkmpGuildState.guild = bkmpGuildMapRow(row);
          bkmpIdleRenderGildePanel();
        },
        row => {
          if (!bkmpGuildState) return;
          const mapped = {
            authUserId: row.auth_user_id,
            displayName: row.display_name,
            role: row.role,
            contributedGold: Number(row.contributed_gold || 0),
            joinedAt: row.joined_at
          };
          const idx = bkmpGuildState.members.findIndex(m => m.authUserId === mapped.authUserId);
          if (idx >= 0) bkmpGuildState.members[idx] = mapped;
          else bkmpGuildState.members.push(mapped);
          bkmpIdleRenderGildePanel();
        }
      );
    }
  }
  if (bkmpGuildActivityLoadedForGuildId !== g.id) {
    /* Flag erst NACH Erfolg setzen (anders als beim Chat oben, hier haengt
       kein Realtime-Abo dran) - schlaegt der Abruf fehl (z.B. Session noch
       nicht bereit), versucht es der naechste Panel-Rerender einfach erneut,
       statt fuer immer auf dem leeren Zustand stehen zu bleiben. */
    bkmpGuildGetActivityLog(g.id, 30).then(log => { bkmpGuildActivityLoadedForGuildId = g.id; bkmpGuildActivityLog = log; bkmpIdleRenderGildePanel(); }).catch(e => console.warn('Idle Dorf: Gildenaktivitaet konnte nicht geladen werden.', e));
  }
  if (isModerator && bkmpGuildJoinRequestsLoadedForGuildId !== g.id) {
    bkmpGuildLoadJoinRequestsForMyGuild(g.id).then(list => { bkmpGuildJoinRequestsLoadedForGuildId = g.id; bkmpGuildJoinRequests = list; bkmpIdleRenderGildePanel(); }).catch(e => console.warn('Idle Dorf: Beitrittsanfragen konnten nicht geladen werden.', e));
  } else if (!isModerator) {
    bkmpGuildJoinRequests = [];
  }
  if (bkmpGuildQuestsLoadedForGuildId !== g.id) {
    /* Gleicher Grund wie oben beim Aktivitaetslog: Flag erst nach Erfolg
       setzen, sonst blieb "⏳ Lade Quests..." bei jedem fehlgeschlagenen
       ersten Versuch dauerhaft stehen (Spieler-Report per Screenshot). */
    bkmpGuildQuestEnsureToday().then(quests => { bkmpGuildQuestsLoadedForGuildId = g.id; bkmpGuildQuests = quests; bkmpIdleRenderGildePanel(); }).catch(e => console.warn('Idle Dorf: Gildenquests konnten nicht geladen werden.', e));
  }
  if (Date.now() - bkmpGuildPresenceLoadedAt > 20000 && typeof bkmpLoadPresence === 'function') {
    bkmpGuildPresenceLoadedAt = Date.now();
    bkmpLoadPresence(bkmpGuildState.members.map(m => m.authUserId))
      .then(map => { bkmpGuildPresenceMap = map; bkmpIdleRenderGildePanel(); }).catch(() => {});
  }

  /* Gilden-Chat zeigt NUR echte Chat-Nachrichten (Spieler-Feedback: die
     vorherige Vermischung mit dem Aktivitaetslog liess Spenden/Levelaufstiege
     doppelt auftauchen, einmal oben in "Gildenaktivitaet" und nochmal hier).
     Das Aktivitaetslog bleibt ausschliesslich in seiner eigenen Sektion. */
  const roleByUid = {};
  bkmpGuildState.members.forEach(m => { roleByUid[m.authUserId] = m.role; });

  panel.innerHTML = `
    <div class="idle-dungeon-intro">
      <div class="idle-guild-header-row">
        ${bkmpRenderGuildBanner(g.banner, 56)}
        <h4>${g.isPublic ? '🌐' : '🔒'} [${escapeHtml(g.tag)}] ${escapeHtml(g.name)}</h4>
      </div>
      ${g.description ? `<p>${escapeHtml(g.description)}</p>` : ''}
      <p>${g.memberCount}/${g.maxMembers} Mitglieder &middot; Deine Rolle: ${BKMP_GUILD_ROLE_LABELS[bkmpGuildState.myRole] || bkmpGuildState.myRole} &middot; ${g.isPublic ? 'Öffentlich' : 'Privat'}</p>
      ${isLeaderOrOfficer ? `<p class="idle-dungeon-best">🏗️ Gildenplätze: ${g.bonusMemberSlots > 0 ? `+${g.bonusMemberSlots} dazugekauft` : 'noch keine dazugekauft'}${slotsMaxed
        ? ' &middot; ✅ Maximale Erweiterung erreicht'
        : ` &middot; <button type="button" class="btn-nein idle-guild-buy-slot-btn" id="idleGuildBuySlotBtn" ${bkmpGuildBusy || g.treasuryGold < nextSlotCost ? 'disabled' : ''}>+1 Platz (${bkmpIdleFormatNumber(nextSlotCost)} 💰)</button>`}</p>` : ''}
      <div class="idle-guild-level-row">
        <span class="idle-guild-level-badge">🏰 Level ${levelInfo.level}</span>
        <span class="idle-guild-level-xp">${bkmpIdleFormatNumber(levelInfo.xpIntoLevel)} / ${levelInfo.nextLevelXp !== null ? bkmpIdleFormatNumber(levelInfo.xpForLevel) : '—'} Erfahrung</span>
      </div>
      <div class="idle-guild-xp-bar">
        <div class="idle-guild-xp-fill" style="width:${levelInfo.pct}%"></div>
        <span class="idle-guild-xp-chest" style="left:${levelInfo.pct}%">💰</span>
      </div>
      <p class="idle-guild-xp-pct">${levelInfo.nextLevelXp !== null ? `${levelInfo.pct}% bis Level ${levelInfo.level + 1}` : 'Maximales Level erreicht!'}</p>
      <p class="idle-dungeon-best">💰 Gildenkasse: ${bkmpIdleFormatNumber(g.treasuryGold)} &middot; 🔺 Aktueller Bonus: +${bonusPct}% Angriff/Verteidigung/Gold für alle Mitglieder</p>
      ${nextMilestone ? `<p>Nächster Kassen-Meilenstein bei ${bkmpIdleFormatNumber(nextMilestone)} 💰 Kasse.</p>` : ''}
      <div class="idle-guild-create-row">
        <input type="number" id="idleGuildContributeInput" placeholder="Gold-Betrag" min="1">
        <button type="button" class="btn-ja idle-guild-contribute-btn" id="idleGuildContributeBtn" ${bkmpGuildBusy ? 'disabled' : ''}>Beitragen</button>
        ${isLeader ? `<button type="button" class="btn-nein" id="idleGuildSettingsToggleBtn">${bkmpGuildSettingsOpen ? 'Einstellungen schließen' : '⚙️ Einstellungen'}</button>` : ''}
        <button type="button" class="btn-nein" id="idleGuildLeaveBtn" ${bkmpGuildBusy ? 'disabled' : ''}>Gilde verlassen</button>
      </div>
    </div>
    ${isLeader && bkmpGuildSettingsOpen ? `
      <div class="idle-dungeon-intro">
        <h4>⚙️ Gilden-Einstellungen</h4>
        <div class="idle-guild-create-row" style="flex-direction:column; align-items:stretch;">
          <textarea id="idleGuildDescInput" maxlength="200" placeholder="Kurze Beschreibung deiner Gilde (max. 200 Zeichen)" style="min-height:60px; padding:0.5rem 0.7rem; border-radius:10px; border:1px solid var(--line); background:var(--paper-2); color:var(--ink); font-family:inherit;">${escapeHtml(g.description || '')}</textarea>
          <input type="text" id="idleGuildGoalInput" maxlength="100" placeholder="Gildenziel (z.B. 'Level 10 bis Ende des Monats', max. 100 Zeichen)" value="${escapeHtml(g.currentGoal || '')}">
          <label class="admin-checkbox-label" style="justify-content:center;">
            <input type="checkbox" id="idleGuildPublicToggle" ${g.isPublic ? 'checked' : ''}>
            Öffentlich (jeder kann direkt beitreten, sonst nur per Einladungscode)
          </label>
          ${!g.isPublic ? `<p class="idle-dungeon-best">🔑 Einladungscode: ${bkmpGuildMyInviteCode ? escapeHtml(bkmpGuildMyInviteCode) : '⏳ lädt...'}</p>
          <button type="button" class="btn-nein" id="idleGuildRegenCodeBtn" style="align-self:center;">Neuen Code erzeugen</button>` : ''}
          <button type="button" class="btn-ja" id="idleGuildSaveSettingsBtn" style="align-self:center;">Speichern</button>
        </div>
        <div class="idle-guild-banner-picker">
          <p style="margin:0.8rem 0 0.4rem;">🚩 Gildenbanner:</p>
          <div class="idle-guild-banner-preview">${bkmpRenderGuildBanner(g.banner, 64)}</div>
          <div class="idle-guild-banner-colors">
            ${BKMP_GUILD_BANNER_COLORS.map(c => `<button type="button" class="idle-guild-banner-color-btn ${((g.banner && g.banner.color) || BKMP_GUILD_BANNER_COLORS[0].id) === c.id ? 'active' : ''}" data-banner-color="${c.id}" style="background:linear-gradient(135deg, ${c.from}, ${c.to});" title="${c.label}"></button>`).join('')}
          </div>
          <div class="idle-guild-banner-symbols">
            ${BKMP_GUILD_BANNER_SYMBOLS.map(s => `<button type="button" class="idle-guild-banner-symbol-btn ${((g.banner && g.banner.symbol) || BKMP_GUILD_BANNER_SYMBOLS[0]) === s ? 'active' : ''}" data-banner-symbol="${s}">${s}</button>`).join('')}
          </div>
        </div>
      </div>
    ` : ''}
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">🎯 Tägliche Gildenquests</h4>
      ${bkmpGuildQuests.length === 0 ? '<p class="empty-hint">⏳ Lade Quests...</p>' : bkmpGuildQuests.map(q => {
        const def = BKMP_GUILD_QUEST_CATALOG[q.questType] || { label: q.questType, icon: '🎯', format: v => v };
        const pct = q.target > 0 ? Math.min(100, Math.floor((q.progress / q.target) * 100)) : 0;
        return `
          <div class="idle-guild-quest-card ${q.completed ? 'is-complete' : ''}">
            <div class="idle-guild-quest-title">${def.icon} ${escapeHtml(def.label)} ${q.completed ? '✅' : ''}</div>
            <div class="idle-guild-quest-bar"><div class="idle-guild-quest-fill" style="width:${pct}%"></div></div>
            <div class="idle-guild-quest-progress">${def.format(q.progress)} / ${def.format(q.target)}</div>
            <div class="idle-guild-quest-reward">Belohnung: ${BKMP_GUILD_QUEST_TIER_REWARD_LABEL[q.tier] || ''}</div>
          </div>
        `;
      }).join('')}
    </div>
    ${isModerator ? `
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">📩 Beitrittsanfragen ${bkmpGuildJoinRequests.length ? `(${bkmpGuildJoinRequests.length})` : ''}</h4>
      ${bkmpGuildJoinRequests.length === 0 ? '<p class="empty-hint">Keine offenen Anfragen.</p>' : bkmpGuildJoinRequests.map(r => `
        <div class="idle-arena-opponent-card" data-request-id="${escapeHtml(r.id)}">
          <span class="idle-arena-opponent-name">${escapeHtml(r.displayName)}</span>
          <span class="idle-arena-opponent-record">${r.message ? escapeHtml(r.message) : ''}</span>
          <button type="button" class="btn-ja idle-guild-request-accept-btn" ${g.memberCount >= g.maxMembers ? 'disabled title="Gilde ist voll"' : ''}>Annehmen</button>
          <button type="button" class="btn-nein idle-guild-request-reject-btn">Ablehnen</button>
        </div>
      `).join('')}
    </div>
    ` : ''}
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">Mitglieder</h4>
      ${bkmpGuildState.members.map(m => `
        <div class="idle-arena-opponent-card" data-member-uid="${escapeHtml(m.authUserId)}">
          <span class="idle-arena-opponent-name">${escapeHtml(m.displayName)}</span>
          <span class="idle-arena-opponent-record">${BKMP_GUILD_ROLE_LABELS[m.role] || m.role} &middot; ${bkmpGuildFormatPresence(bkmpGuildPresenceMap[m.authUserId])}</span>
          <span class="idle-arena-opponent-rating">💰 ${bkmpIdleFormatNumber(m.contributedGold)}</span>
          ${isLeaderOrOfficer && m.authUserId !== uid && m.role !== 'leader' ? `
            ${bkmpGuildState.myRole === 'leader' ? `
              ${bkmpGuildNextRoleUp(m.role) ? `<button type="button" class="btn-nein idle-guild-role-btn" data-role="${bkmpGuildNextRoleUp(m.role)}">⬆️ Befördern</button>` : ''}
              ${bkmpGuildNextRoleDown(m.role) ? `<button type="button" class="btn-nein idle-guild-role-btn" data-role="${bkmpGuildNextRoleDown(m.role)}">⬇️ Degradieren</button>` : ''}
            ` : ''}
            <button type="button" class="btn-nein idle-guild-kick-btn">Entfernen</button>
          ` : ''}
        </div>
      `).join('')}
    </div>
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">🏆 Spendenrangliste</h4>
      ${bkmpGuildState.members.filter(m => m.contributedGold > 0).length === 0 ? '<p class="empty-hint">Noch keine Spenden.</p>' : bkmpGuildState.members.filter(m => m.contributedGold > 0).map((m, i) => `
        <div class="idle-arena-opponent-card">
          <span class="idle-arena-opponent-name">${BKMP_GUILD_MEDALS[i] || `${i + 1}.`} ${escapeHtml(m.displayName)}</span>
          <span class="idle-arena-opponent-rating">${bkmpIdleFormatNumber(m.contributedGold)} 💰</span>
        </div>
      `).join('')}
    </div>
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">📜 Gildenaktivität</h4>
      <div class="idle-guild-activity-log">
        ${bkmpGuildActivityLog.length === 0 ? '<p class="empty-hint">Noch keine Aktivität.</p>' : bkmpGuildActivityLog.map(entry => `
          <p class="idle-guild-activity-entry">${bkmpGuildFormatActivityEntry(entry)} <span class="idle-guild-chat-time">${bkmpArenaFormatTime(entry.createdAt)}</span></p>
        `).join('')}
      </div>
    </div>
    ${g.currentGoal ? `<div class="idle-dungeon-intro idle-guild-goal-banner"><p><strong>🎯 Gildenziel:</strong> ${escapeHtml(g.currentGoal)}</p></div>` : ''}
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">💬 Gilden-Chat</h4>
      <div class="idle-guild-chat-log" id="idleGuildChatLog">
        ${bkmpGuildChatMessages.length === 0 ? '<p class="empty-hint">Noch keine Nachrichten.</p>' : bkmpGuildChatMessages.map(m => {
          const roleClass = BKMP_GUILD_ROLE_CHAT_CLASS[roleByUid[m.authUserId]] || BKMP_GUILD_ROLE_CHAT_CLASS.member;
          const deleteBtn = isModerator ? `<button type="button" class="idle-guild-chat-delete-btn" data-message-id="${escapeHtml(m.id)}" title="Nachricht löschen (Moderation)">🗑️</button>` : '';
          return `<p class="idle-guild-chat-msg"><strong class="${roleClass}">${escapeHtml(m.displayName)}:</strong> ${escapeHtml(m.message)} <span class="idle-guild-chat-time">${bkmpArenaFormatTime(m.createdAt)}</span>${deleteBtn}</p>`;
        }).join('')}
      </div>
      <div class="idle-guild-create-row">
        <input type="text" id="idleGuildChatInput" placeholder="Nachricht an deine Gilde..." maxlength="300">
        <button type="button" class="btn-ja" id="idleGuildChatSendBtn">Senden</button>
      </div>
    </div>
  `;
  const chatLog = document.getElementById('idleGuildChatLog');
  if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;

  const contributeBtn = document.getElementById('idleGuildContributeBtn');
  if (contributeBtn) contributeBtn.addEventListener('click', async () => {
    const input = document.getElementById('idleGuildContributeInput');
    const amount = Math.round(Number(input.value || 0));
    if (!amount || amount <= 0) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Bitte einen gültigen Betrag eintragen.', 2800);
      return;
    }
    bkmpGuildBusy = true;
    try {
      await bkmpGuildContribute(amount);
      /* contribute_gold() zieht das Gold serverseitig sofort ab (siehe
         supabase-idle-guilds.sql), aber bkmpIdleState.gold blieb bisher
         unveraendert - der naechste normale Autosave (bkmpIdleQueueSync ->
         upsertIdlePlayerState, schreibt den KOMPLETTEN State) haette den
         veralteten, noch nicht reduzierten Wert einfach wieder ueber den
         serverseitig schon abgezogenen geschrieben (Spieler-Meldung: "Gold
         wird mir nicht abgezogen") - die Kasse bekam das Gold, der Spieler
         behielt es aber effektiv trotzdem. Gleiches Muster wie bei
         Upgrade-/Runen-Kaeufen (bkmpIdleState.gold -= cost) noetig.*/
      bkmpIdleState.gold -= amount;
      bkmpIdleRenderHud();
      bkmpIdleQueueSync();
      bkmpGuildLoaded = false;
      bkmpGuildRefreshTreasuryBonusCache();
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`💰 ${amount} Gold zur Gildenkasse beigetragen!`, 3200);
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    bkmpGuildBusy = false;
    await bkmpIdleRenderGildePanel();
  });

  const leaveBtn = document.getElementById('idleGuildLeaveBtn');
  if (leaveBtn) leaveBtn.addEventListener('click', async () => {
    const confirmed = typeof bkmpConfirmDialog === 'function'
      ? await bkmpConfirmDialog('🛡️ Gilde verlassen?', 'Möchtest du diese Gilde wirklich verlassen?', 'Ja, verlassen', 'Abbrechen')
      : confirm('Gilde wirklich verlassen?');
    if (!confirmed || bkmpGuildBusy) return;
    bkmpGuildBusy = true;
    try {
      await bkmpGuildLeave();
      bkmpGuildLoaded = false;
      bkmpGuildRefreshTreasuryBonusCache();
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    bkmpGuildBusy = false;
    await bkmpIdleRenderGildePanel();
  });

  const buySlotBtn = document.getElementById('idleGuildBuySlotBtn');
  if (buySlotBtn) buySlotBtn.addEventListener('click', async () => {
    if (bkmpGuildBusy) return;
    bkmpGuildBusy = true;
    try {
      await bkmpGuildBuySlot();
      bkmpGuildLoaded = false;
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🏗️ Gildenplatz dazugekauft!', 3200);
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    bkmpGuildBusy = false;
    await bkmpIdleRenderGildePanel();
  });

  panel.querySelectorAll('.idle-guild-kick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-member-uid]');
      const targetUid = card ? card.dataset.memberUid : null;
      if (!targetUid || bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        await bkmpGuildKickMember(targetUid);
        bkmpGuildLoaded = false;
        bkmpGuildRefreshTreasuryBonusCache();
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  panel.querySelectorAll('.idle-guild-role-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-member-uid]');
      const targetUid = card ? card.dataset.memberUid : null;
      const newRole = btn.dataset.role;
      if (!targetUid || bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        await bkmpGuildSetMemberRole(targetUid, newRole);
        bkmpGuildLoaded = false;
        bkmpGuildRefreshTreasuryBonusCache();
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  panel.querySelectorAll('.idle-guild-request-accept-btn, .idle-guild-request-reject-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-request-id]');
      const requestId = card ? card.dataset.requestId : null;
      if (!requestId || bkmpGuildBusy) return;
      const accept = btn.classList.contains('idle-guild-request-accept-btn');
      bkmpGuildBusy = true;
      try {
        await bkmpGuildRespondJoinRequest(requestId, accept);
        bkmpGuildJoinRequestsLoadedForGuildId = null;
        bkmpGuildLoaded = false;
        if (accept) bkmpGuildRefreshTreasuryBonusCache();
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  panel.querySelectorAll('.idle-guild-chat-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const messageId = btn.dataset.messageId;
      if (!messageId || bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        await bkmpGuildDeleteChatMessage(messageId);
        bkmpGuildChatMessages = bkmpGuildChatMessages.filter(m => m.id !== messageId);
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  const settingsToggleBtn = document.getElementById('idleGuildSettingsToggleBtn');
  if (settingsToggleBtn) settingsToggleBtn.addEventListener('click', () => {
    bkmpGuildSettingsOpen = !bkmpGuildSettingsOpen;
    bkmpIdleRenderGildePanel();
  });

  const saveSettingsBtn = document.getElementById('idleGuildSaveSettingsBtn');
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', async () => {
    const descInput = document.getElementById('idleGuildDescInput');
    const publicToggle = document.getElementById('idleGuildPublicToggle');
    const goalInput = document.getElementById('idleGuildGoalInput');
    if (bkmpGuildBusy) return;
    bkmpGuildBusy = true;
    try {
      const newCode = await bkmpGuildUpdateSettings(descInput.value, publicToggle.checked);
      if (newCode) bkmpGuildMyInviteCode = newCode;
      if (publicToggle.checked) bkmpGuildMyInviteCode = null;
      if (goalInput) await bkmpGuildUpdateGoal(goalInput.value);
      bkmpGuildLoaded = false;
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Gilden-Einstellungen gespeichert.', 2600);
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    bkmpGuildBusy = false;
    await bkmpIdleRenderGildePanel();
  });

  const regenCodeBtn = document.getElementById('idleGuildRegenCodeBtn');
  if (regenCodeBtn) regenCodeBtn.addEventListener('click', async () => {
    if (bkmpGuildBusy) return;
    bkmpGuildBusy = true;
    try {
      bkmpGuildMyInviteCode = await bkmpGuildRegenerateInviteCode();
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Neuer Einladungscode erzeugt - alte Codes gelten nicht mehr.', 3200);
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    bkmpGuildBusy = false;
    await bkmpIdleRenderGildePanel();
  });

  panel.querySelectorAll('.idle-guild-banner-color-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        const banner = { color: btn.dataset.bannerColor, symbol: (g.banner && g.banner.symbol) || BKMP_GUILD_BANNER_SYMBOLS[0] };
        await bkmpGuildUpdateBanner(banner);
        bkmpGuildLoaded = false;
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  panel.querySelectorAll('.idle-guild-banner-symbol-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        const banner = { color: (g.banner && g.banner.color) || BKMP_GUILD_BANNER_COLORS[0].id, symbol: btn.dataset.bannerSymbol };
        await bkmpGuildUpdateBanner(banner);
        bkmpGuildLoaded = false;
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildePanel();
    });
  });

  const chatSendBtn = document.getElementById('idleGuildChatSendBtn');
  const chatInput = document.getElementById('idleGuildChatInput');
  const sendChat = async () => {
    const msg = (chatInput.value || '').trim();
    if (!msg) return;
    chatInput.value = '';
    try {
      await bkmpGuildSendChatMessage(msg);
      bkmpGuildChatLoadedForGuildId = null;
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
    }
    await bkmpIdleRenderGildePanel();
  };
  if (chatSendBtn) chatSendBtn.addEventListener('click', sendChat);
  if (chatInput) chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
}

/* ---------------- Rendering: Gilden-Technologie-Tab ----------------
   Eigener Tab statt Teil des Gilde-Tabs - 9 Karten brauchen sichtbaren
   Platz, gleiche Trennung wie Skilltree vs. Kampf-Tab. */
async function bkmpIdleRenderGildeTechPanel() {
  const panel = document.getElementById('idlePanelGildeTech');
  if (!panel) return;
  if (!bkmpGuildLoaded && !bkmpGuildLoading) await bkmpGuildLoadAll();

  if (!bkmpGuildState) {
    panel.innerHTML = `
      <div class="idle-dungeon-intro">
        <h4>🌳 Gilden-Technologie</h4>
        <p>Du musst Mitglied einer Gilde sein, um an der gemeinsamen Technologie mitzuwirken.</p>
      </div>`;
    return;
  }

  const g = bkmpGuildState.guild;
  const canUpgrade = bkmpGuildState.myRole === 'leader' || bkmpGuildState.myRole === 'officer';

  if (bkmpGuildTechLoadedForGuildId !== g.id) {
    bkmpGuildTechLoadedForGuildId = g.id;
    bkmpGuildGetTechLevels(g.id).then(levels => { bkmpGuildTechLevels = levels; bkmpIdleRenderGildeTechPanel(); }).catch(() => {});
  }

  panel.innerHTML = `
    <div class="idle-dungeon-intro">
      <h4>🌳 Gilden-Technologie</h4>
      <p>Permanente Boni für ALLE Mitglieder, bezahlt aus der Gildenkasse (💰 ${bkmpIdleFormatNumber(g.treasuryGold)}).${canUpgrade ? '' : ' Nur Anführer oder Stellvertreter dürfen verbessern.'}</p>
    </div>
    <div class="idle-guild-tech-grid">
      ${BKMP_GUILD_TECH_CATALOG.map(tech => {
        const level = bkmpGuildTechLevels[tech.id] || 0;
        const maxed = level >= BKMP_GUILD_TECH_MAX_LEVEL;
        const cost = bkmpGuildTechCostForLevel(level);
        const canAfford = g.treasuryGold >= cost;
        const bonusDisplay = (level * tech.perLevel).toFixed(1).replace(/\.0$/, '');
        return `
          <div class="idle-guild-tech-card">
            <div class="idle-guild-tech-icon">${tech.icon}</div>
            <div class="idle-guild-tech-name">${escapeHtml(tech.label)}</div>
            <div class="idle-guild-tech-level">Stufe ${level}/${BKMP_GUILD_TECH_MAX_LEVEL}</div>
            <div class="idle-guild-tech-bonus">+${bonusDisplay}%</div>
            ${maxed
              ? '<span class="idle-guild-tech-maxed">✅ Maximalstufe</span>'
              : `<button type="button" class="btn-ja idle-guild-tech-upgrade-btn" data-tech-id="${tech.id}" ${!canUpgrade || !canAfford || bkmpGuildBusy ? 'disabled' : ''}>${bkmpIdleFormatNumber(cost)} 💰</button>`}
          </div>
        `;
      }).join('')}
    </div>
  `;

  panel.querySelectorAll('.idle-guild-tech-upgrade-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const techId = btn.dataset.techId;
      if (!techId || bkmpGuildBusy) return;
      bkmpGuildBusy = true;
      try {
        const result = await bkmpGuildTechUpgrade(techId);
        if (result) {
          bkmpGuildTechLevels[techId] = result.newLevel;
          bkmpGuildState.guild.treasuryGold = result.treasuryGold;
          bkmpGuildRefreshTreasuryBonusCache();
          const techDef = BKMP_GUILD_TECH_CATALOG.find(t => t.id === techId);
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🌳 ${techDef ? techDef.label : techId} auf Stufe ${result.newLevel}!`, 3000);
        }
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBusy = false;
      await bkmpIdleRenderGildeTechPanel();
    });
  });
}

/* ---------------- Gildenboss (siehe supabase-guild-boss.sql) ----------------
   Anders als der Weltboss-Raid KEIN Gegenangriff/keine "Stadt" - reiner
   DPS-Wettlauf gegen ein taegliches Zeitfenster (20:00-21:00 Uhr Berlin,
   Vorbereitung ab 19:55). Deshalb auch kein modal-uebernehmendes
   "Kampfansicht ersetzt alle Tabs" wie beim Raid - der Gildenboss ist ein
   normaler Tab, kein server-weites Pflichtereignis. */
const BKMP_GUILD_BOSS_TICK_MS = 2500;
const BKMP_GUILD_BOSS_JOINED_KEY_PREFIX = 'bkmp-guildboss-joined-';
let bkmpGuildBossState = null;
let bkmpGuildBossParticipants = [];
let bkmpGuildBossJoinedId = null;
let bkmpGuildBossLoopTimer = null;
let bkmpGuildBossPrepCountdownInterval = null;
let bkmpGuildBossResultShown = false;
let bkmpGuildBossBusy = false;

/* TZ-sicherer Helfer: liefert den UTC-Zeitpunkt fuer "Jahr-Monat-Tag
   Stunde:Minute in Europe/Berlin", DST-sicher per "raten + korrigieren"
   (Standardtrick ohne Zeitzonen-Bibliothek). */
function bkmpGuildBossBerlinDateAt(year, month, day, hour, minute) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const berlinStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(utcGuess));
  const [datePart, timePart] = berlinStr.replace(',', '').split(' ');
  const [bm, bd, by] = datePart.split('/').map(Number);
  const [bh, bmin] = timePart.split(':').map(Number);
  const berlinAsUtc = Date.UTC(by, bm - 1, bd, bh, bmin, 0);
  return new Date(utcGuess - (berlinAsUtc - utcGuess));
}
function bkmpGuildBossGetPhaseInfo(now) {
  const d = now || new Date();
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const minutesOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const dateKey = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  const fightStartsAt = bkmpGuildBossBerlinDateAt(year, month, day, 20, 0).getTime();
  const fightEndsAt = bkmpGuildBossBerlinDateAt(year, month, day, 21, 0).getTime();
  if (minutesOfDay >= 19 * 60 + 55 && minutesOfDay < 20 * 60) {
    return { phase: 'prep', dateKey, fightStartsAt, fightEndsAt, msUntilFightStart: fightStartsAt - d.getTime() };
  }
  if (minutesOfDay >= 20 * 60 && minutesOfDay < 21 * 60) {
    return { phase: 'fight', dateKey, fightStartsAt, fightEndsAt, msUntilFightEnd: fightEndsAt - d.getTime() };
  }
  return { phase: 'none', dateKey, fightStartsAt, fightEndsAt };
}
function bkmpGuildBossHasJoined(instanceId) {
  try { return localStorage.getItem(BKMP_GUILD_BOSS_JOINED_KEY_PREFIX + instanceId) === '1'; } catch (e) { return false; }
}
function bkmpGuildBossMarkJoined(instanceId) {
  try { localStorage.setItem(BKMP_GUILD_BOSS_JOINED_KEY_PREFIX + instanceId, '1'); } catch (e) {}
  bkmpGuildBossJoinedId = instanceId;
}

function bkmpGuildBossSpawnFx(className, amount, isCrit) {
  const field = document.getElementById('guildBossBattlefield');
  if (!field) return;
  const fx = document.createElement('span');
  fx.className = 'raid-fx ' + className;
  field.appendChild(fx);
  window.setTimeout(() => fx.remove(), 700);
  if (amount != null) {
    const target = document.getElementById('guildBossCreature');
    if (target) {
      const dmg = document.createElement('span');
      dmg.className = 'raid-dmg-float' + (isCrit ? ' raid-dmg-crit' : '');
      dmg.textContent = '-' + bkmpIdleFormatNumber(amount) + (isCrit ? '!' : '');
      target.appendChild(dmg);
      window.setTimeout(() => dmg.remove(), 900);
    }
  }
}
function bkmpGuildBossHitFlash() {
  const el = document.getElementById('guildBossCreature');
  if (!el) return;
  el.classList.remove('raid-hit-flash');
  void el.offsetWidth;
  el.classList.add('raid-hit-flash');
}

/* Bug-Fix (Spieler-Report per Screenshot 15.07.: "Kein Damage" ->
   PostgREST-Fehler "Could not find the function ... in the schema
   cache", dabei fehlte in der Fehlermeldung auffaellig der p_instance_id-
   Parameter): bkmpGuildBossJoin() (siehe supabase.js) liefert ein Objekt
   mit "instanceId" (camelCase), NICHT "id". An 4 Stellen wurde hier
   trotzdem bkmpGuildBossState.id gelesen - existiert auf diesem Objekt
   gar nicht, ergibt also immer "undefined". supabase-js laesst
   undefined-Parameter beim Serialisieren des RPC-Aufrufs komplett weg,
   PostgREST bekam dadurch nur 3 statt der 4 erwarteten Parameter und
   fand keine passende Funktion mehr - kein Cache-Problem, ein simpler
   Tippfehler. Der urspruengliche Beitritt (bkmpIdleRenderGildeBossPanel)
   nutzt an den RICHTIGEN Stellen bereits korrekt "state.instanceId" -
   nur diese 4 spaeteren Aufrufe hatten den falschen Feldnamen. */
/* Spieler-Report (15.07., "nur reload aktualisiert den Schaden"): ein
   eigener Tick/Klick aktualisierte bisher nur bossHp/status lokal - die
   eigene Zeile in bkmpGuildBossParticipants (Rangliste + "Dein Schaden")
   wurde ausschliesslich per Realtime-postgres_changes-Event nachgezogen.
   guild_boss_deal_damage() gab dafuer bisher gar keinen eigenen Schadens-
   stand zurueck. Exakt dasselbe Muster wie beim Raidboss (siehe
   bkmpRaidApplyOwnDamageResult/supabase-raid-damage-sync-fix.sql) - die
   RPC liefert den serverseitig bereits berechneten eigenen Stand jetzt
   direkt mit (siehe supabase-guild-boss-damage-sync-fix.sql), damit die
   eigene Zeile SOFORT lokal gesetzt werden kann statt auf Realtime zu
   warten. */
function bkmpGuildBossApplyOwnDamageResult(result) {
  if (!result || result.ownDamageDealt == null) return;
  const myUid = bkmpGuildMyAuthUserId;
  if (!myUid) return;
  const idx = bkmpGuildBossParticipants.findIndex(p => p.authUserId === myUid);
  if (idx >= 0) {
    bkmpGuildBossParticipants[idx].damageDealt = result.ownDamageDealt;
    bkmpGuildBossParticipants[idx].critsLanded = result.ownCritsLanded;
    bkmpGuildBossParticipants[idx].clicksLanded = result.ownClicksLanded;
    bkmpGuildBossParticipants.sort((a, b) => b.damageDealt - a.damageDealt);
    bkmpGuildBossRequestParticipantsRender();
  }
}

/* Live-Vorfall 15.07. (siehe Kommentar bei bkmpGuildBossDealDamage in
   supabase.js): sobald der Boss besiegt ist, hämmerte der Auto-Tick jedes
   noch aktiven Mitspielers ohne funktionierendes Realtime endlos gegen
   "boss_not_active" - der lokale Zustand erfuhr nie vom Sieg. Statt
   weiterzuticken sofort den eigenen Loop stoppen und den echten Endstand
   nachladen, sobald der Server "final" meldet. */
function bkmpGuildBossResyncAfterFinalError() {
  if (!bkmpGuildBossState) return;
  bkmpGuildBossStopLoop();
  loadGuildBossInstance(bkmpGuildBossState.instanceId).then(info => {
    if (!info || !bkmpGuildBossState) return;
    bkmpGuildBossState.bossHp = info.bossHp;
    bkmpGuildBossState.status = info.status;
    bkmpIdleRenderGildeBossPanel();
    bkmpGuildBossCheckOutcome();
  }).catch(() => {});
}

async function bkmpGuildBossOwnTick() {
  if (!bkmpGuildBossState || bkmpGuildBossState.status !== 'fighting' || !bkmpIdleEffectiveStats) return;
  const roll = bkmpIdleDamageRoll(bkmpIdleEffectiveStats.attack, bkmpIdleEffectiveStats.critChance, bkmpIdleEffectiveStats.critDamage, 0);
  roll.amount = bkmpIdleApplyBossDamageBonus(roll.amount);
  bkmpGuildBossSpawnFx(BKMP_RAID_ATTACK_FX[Math.floor(Math.random() * BKMP_RAID_ATTACK_FX.length)], roll.amount, roll.isCrit);
  bkmpGuildBossHitFlash();
  try {
    const result = await bkmpGuildBossDealDamage(bkmpGuildBossState.instanceId, roll.amount, roll.isCrit, false);
    if (result && result.final) { bkmpGuildBossResyncAfterFinalError(); return; }
    if (result) {
      bkmpGuildBossState.bossHp = result.bossHp;
      bkmpGuildBossState.status = result.status;
      bkmpGuildBossApplyOwnDamageResult(result);
      bkmpIdleRenderGildeBossPanel();
      bkmpGuildBossCheckOutcome();
    }
  } catch (e) { /* naechster Tick versucht es erneut */ }
}

function bkmpGuildBossHandleClick() {
  if (!bkmpGuildBossState || bkmpGuildBossState.status !== 'fighting' || !bkmpIdleEffectiveStats) return;
  const isCrit = Math.random() * 100 < bkmpIdleEffectiveStats.critChance;
  const clickDamage = bkmpIdleApplyBossDamageBonus(Math.max(1, Math.round(bkmpIdleEffectiveStats.attack * (0.12 + (bkmpIdleEffectiveStats.clickDamagePct || 0) / 100) * (isCrit ? Math.max(1, bkmpIdleEffectiveStats.critDamage / 100) : 1))));
  bkmpGuildBossSpawnFx('raid-fx-magic', clickDamage, isCrit);
  bkmpGuildBossHitFlash();
  bkmpGuildBossDealDamage(bkmpGuildBossState.instanceId, clickDamage, isCrit, true).then(result => {
    if (result && result.final) { bkmpGuildBossResyncAfterFinalError(); return; }
    if (result) {
      bkmpGuildBossState.bossHp = result.bossHp;
      bkmpGuildBossState.status = result.status;
      bkmpGuildBossApplyOwnDamageResult(result);
      bkmpIdleRenderGildeBossPanel();
      bkmpGuildBossCheckOutcome();
    }
  }).catch(() => {});
}

function bkmpGuildBossStartLoop() {
  bkmpGuildBossStopLoop();
  bkmpGuildBossLoopTimer = window.setInterval(bkmpGuildBossOwnTick, BKMP_GUILD_BOSS_TICK_MS);
  if (typeof bkmpSubscribeToGuildBossInstance === 'function') {
    bkmpSubscribeToGuildBossInstance(bkmpGuildBossState.instanceId, change => {
      if (!bkmpGuildBossState) return;
      if (change.type === 'instance' && change.row) {
        bkmpGuildBossState.bossHp = Number(change.row.boss_hp);
        bkmpGuildBossState.status = change.row.status;
        bkmpGuildBossState.totalDamage = Number(change.row.total_damage || 0);
        bkmpGuildBossState.participantCount = Number(change.row.participant_count || 0);
        bkmpIdleRenderGildeBossPanel();
        bkmpGuildBossCheckOutcome();
      } else if (change.type === 'participants' && change.row) {
        const idx = bkmpGuildBossParticipants.findIndex(p => p.authUserId === change.row.auth_user_id);
        const mapped = { authUserId: change.row.auth_user_id, displayName: change.row.display_name, damageDealt: Number(change.row.damage_dealt || 0), critsLanded: Number(change.row.crits_landed || 0), clicksLanded: Number(change.row.clicks_landed || 0) };
        if (idx >= 0) bkmpGuildBossParticipants[idx] = mapped; else bkmpGuildBossParticipants.push(mapped);
        bkmpGuildBossParticipants.sort((a, b) => b.damageDealt - a.damageDealt);
        bkmpIdleRenderGildeBossPanel();
      }
    });
  }
}
function bkmpGuildBossStopLoop() {
  if (bkmpGuildBossLoopTimer) { window.clearInterval(bkmpGuildBossLoopTimer); bkmpGuildBossLoopTimer = null; }
  if (typeof bkmpUnsubscribeFromGuildBossInstance === 'function') bkmpUnsubscribeFromGuildBossInstance();
}
function bkmpGuildBossCheckOutcome() {
  if (!bkmpGuildBossState || bkmpGuildBossResultShown) return;
  if (bkmpGuildBossState.status !== 'won' && bkmpGuildBossState.status !== 'expired') return;
  bkmpGuildBossResultShown = true;
  bkmpGuildBossStopLoop();
  /* Bug-Fix (Spieler-Frage 16.07., "wann werden die Belohnungen
     ausgezahlt?"): guild_boss_finish() schreibt Gold/Kristalle bei einem
     Sieg SOFORT serverseitig direkt in idle_player_state (siehe
     supabase-guild-boss.sql) - die lokale bkmpIdleState-Kopie im Browser
     erfaehrt davon aber nie. Ohne diesen Abgleich hier ueberschreibt der
     naechste ganz normale Autosave (bkmpIdleFlushSync, spaetestens 4s
     spaeter) den frisch gutgeschriebenen Server-Stand postwendend wieder
     mit dem eigenen, noch alten lokalen Wert - die Belohnung wurde also
     ausgezahlt UND im selben Atemzug durchs eigene Speichern wieder
     geloescht. bkmpIdleMergeRemoteSpendableFields() (bisher nur auf der
     Stream-Seite als Schutz vor Mehrfach-Tab-Konflikten aktiv) macht
     genau das richtig: server_wert + eigener_lokaler_delta_seit_baseline,
     bewahrt also sowohl die externe Gutschrift als auch eigenen
     zwischenzeitlichen Fortschritt. */
  if (bkmpGuildBossState.status === 'won' && typeof bkmpIdleMergeRemoteSpendableFields === 'function') {
    bkmpIdleMergeRemoteSpendableFields().then(() => bkmpIdleRenderHud()).catch(() => {});
  }
  bkmpGuildQuestsLoadedForGuildId = null; /* Aktivitaetslog zeigt jetzt "Boss besiegt" - naechster Panel-Load frisch laden */
  bkmpGuildActivityLoadedForGuildId = null;
  loadGuildBossParticipants(bkmpGuildBossState.instanceId).then(list => { bkmpGuildBossParticipants = list; bkmpIdleRenderGildeBossPanel(); }).catch(() => {});
  /* Spieler-Wunsch (15.07., "Wieviel kriegt man denn? Ruhig anzeigen
     lassen"): weder guild_boss_join() noch guild_boss_deal_damage()
     liefern die Belohnungs-Poolgroesse zurueck (anders als beim Raid, wo
     loadRaidState() das schon erledigt). Dieselbe frische Instanz-Abfrage
     holt jetzt zusaetzlich gold_reward/gem_reward vom verknuepften
     Gildenboss sowie den serverseitig gepflegten participant_count nach -
     letzteres behebt nebenbei "Teilnehmer: 0" in der Ergebnisansicht, da
     dieses Feld sonst nirgends gesetzt wurde. */
  loadGuildBossInstance(bkmpGuildBossState.instanceId).then(info => {
    if (!info || !bkmpGuildBossState) return;
    bkmpGuildBossState.participantCount = info.participantCount;
    bkmpGuildBossState.goldReward = info.goldReward;
    bkmpGuildBossState.gemReward = info.gemReward;
    bkmpGuildBossUpdateCombatUI();
  }).catch(() => {});
}

let bkmpGuildBossPanelRenderedForKey = null;
let bkmpGuildBossUpdateRenderTimer = null;

/* Ohne Drosselung baute diese Funktion bei JEDEM eigenen Tick (alle
   BKMP_GUILD_BOSS_TICK_MS), JEDEM eigenen Klick UND jedem Realtime-Update
   von ANDEREN Gildenmitgliedern das komplette Panel per innerHTML neu -
   inklusive des <video autoplay>-Boss-Sprites, das dabei jedes Mal neu
   gestartet wurde (sichtbares Ruckeln/Flackern alle paar Sekunden,
   staerker mit mehreren gleichzeitig kaempfenden Mitgliedern). Analog zum
   bereits gefixten Raid-Screen (siehe bkmpRaidRenderCombat/
   bkmpRaidRequestParticipantsRender) wird das Grundgeruest (Video, HP-
   Balken-Container, Rangliste-Container) jetzt nur noch EINMAL pro
   Boss-Instanz gebaut; Folge-Updates schreiben nur noch in bestehende
   Knoten (textContent/style.width) bzw. drosseln den Rangliste-Rebuild
   auf max. alle 400ms. */
/* Bug-Fix (Spieler-Meldung 16.07., "Timer läuft nicht runter, nur nach
   Reload"): der "Vorbereitung - Kampf startet in..."-Text wurde bisher NUR
   einmal beim (Neu-)Rendern des Panels aus info.msUntilFightStart berechnet
   und danach nie wieder aktualisiert - stand die Karte einfach offen,
   blieb die Zahl fuer immer auf dem Stand des letzten Renders stehen.
   Gleiches Muster wie bkmpDungeonStartCountdownTicker: ein echter
   1-Sekunden-Tick, der NUR die Countdown-Textzeile lokal aktualisiert
   (kein Server-Roundtrip, kein Neu-Rendern der ganzen Karte/Listener).
   Wechselt die Phase (Vorbereitung vorbei, Kampf beginnt), wird EINMALIG
   ein echter Panel-Re-Render angestossen, damit der "Jetzt kaempfen"-
   Zustand korrekt uebernommen wird. Selbst-beendend: bricht ab, sobald der
   Gildenboss-Tab nicht mehr aktiv ist. */
function bkmpGuildBossStartPrepCountdownTicker() {
  if (bkmpGuildBossPrepCountdownInterval) { clearInterval(bkmpGuildBossPrepCountdownInterval); bkmpGuildBossPrepCountdownInterval = null; }
  bkmpGuildBossPrepCountdownInterval = setInterval(() => {
    if (bkmpIdleActiveTab !== 'gildeboss') {
      clearInterval(bkmpGuildBossPrepCountdownInterval);
      bkmpGuildBossPrepCountdownInterval = null;
      return;
    }
    const info = bkmpGuildBossGetPhaseInfo();
    if (info.phase !== 'prep') {
      clearInterval(bkmpGuildBossPrepCountdownInterval);
      bkmpGuildBossPrepCountdownInterval = null;
      bkmpIdleRenderGildeBossPanel();
      return;
    }
    const el = document.getElementById('idleGuildBossPrepCountdown');
    if (el) el.textContent = `⏳ Vorbereitung - Kampf startet in ${bkmpRaidFormatCountdown(info.msUntilFightStart)}.`;
  }, 1000);
}
async function bkmpIdleRenderGildeBossPanel() {
  const panel = document.getElementById('idlePanelGildeBoss');
  if (!panel) return;
  if (!bkmpGuildLoaded && !bkmpGuildLoading) await bkmpGuildLoadAll();

  if (!bkmpGuildState) {
    bkmpGuildBossPanelRenderedForKey = null;
    panel.innerHTML = `<div class="idle-dungeon-intro"><h4>🐲 Gildenboss</h4><p>Du musst Mitglied einer Gilde sein, um am Gildenboss teilzunehmen.</p></div>`;
    return;
  }

  const info = bkmpGuildBossGetPhaseInfo();
  const fullInstanceId = bkmpGuildState.guild.id + '-' + info.dateKey;

  if (info.phase === 'fight' && bkmpGuildBossHasJoined(fullInstanceId) && !bkmpGuildBossState) {
    bkmpGuildBossJoin().then(state => {
      if (!state) return;
      bkmpGuildBossState = state;
      bkmpGuildBossResultShown = false;
      loadGuildBossParticipants(state.instanceId).then(list => { bkmpGuildBossParticipants = list; bkmpIdleRenderGildeBossPanel(); }).catch(() => {});
      /* Bug-Fix (beim Neu-Testen des kompletten Ablaufs gefunden, 15.07.):
         war der Kampf beim (Wieder-)Oeffnen des Fensters serverseitig
         schon vorbei (won/expired) - z.B. Boss vor dem eigenen Beitritt
         von der Gilde besiegt, oder Seite waehrend 20-21 Uhr neu geladen -
         wurde weder der Loop gestartet NOCH bkmpGuildBossCheckOutcome()
         aufgerufen. Die Ergebnisansicht erschien zwar (isFinished greift
         schon am Status), aber Gold/Kristalle blieben dauerhaft bei "+0",
         weil deren Nachlade-Fetch (loadGuildBossInstance) nur dort drin
         angestossen wird. */
      if (state.status === 'fighting') bkmpGuildBossStartLoop();
      else bkmpGuildBossCheckOutcome();
      bkmpIdleRenderGildeBossPanel();
    }).catch(() => {});
  }

  if (info.phase !== 'fight' && bkmpGuildBossState) {
    bkmpGuildBossStopLoop();
    bkmpGuildBossState = null;
  }

  if (!bkmpGuildBossState) {
    bkmpGuildBossPanelRenderedForKey = null;
    let bodyHtml = '';
    if (info.phase === 'prep') {
      bodyHtml = `<p class="idle-dungeon-best" id="idleGuildBossPrepCountdown">⏳ Vorbereitung - Kampf startet in ${bkmpRaidFormatCountdown(info.msUntilFightStart)}.</p>`;
    } else if (info.phase === 'fight') {
      bodyHtml = `
        <p class="idle-dungeon-best">🐲 ${bkmpRaidFormatCountdown(info.msUntilFightEnd)} verbleiben!</p>
        <button type="button" class="btn-ja idle-guild-boss-join-btn" id="idleGuildBossJoinBtn" ${bkmpGuildBossBusy ? 'disabled' : ''}>⚔️ Jetzt kämpfen</button>
      `;
    } else {
      bodyHtml = `<p>Der Gildenboss erscheint täglich <strong>20:00-21:00 Uhr</strong> (Vorbereitung ab 19:55 Uhr).</p>`;
    }
    panel.innerHTML = `
      <div class="idle-dungeon-intro">
        <div class="idle-guild-header-row">
          ${bkmpRenderGuildBanner(bkmpGuildState.guild.banner, 40)}
          <h4>🐲 Gildenboss</h4>
        </div>
        <p>Kämpft gemeinsam als Gilde gegen einen riesigen Boss - Belohnung anteilig nach verursachtem Schaden. Bisher besiegt: ${bkmpIdleFormatNumber(bkmpGuildState.guild.bossesDefeated || 0)}.</p>
        ${bodyHtml}
      </div>
    `;
    if (info.phase === 'prep') bkmpGuildBossStartPrepCountdownTicker();
    const joinBtn = document.getElementById('idleGuildBossJoinBtn');
    if (joinBtn) joinBtn.addEventListener('click', async () => {
      if (bkmpGuildBossBusy) return;
      bkmpGuildBossBusy = true;
      try {
        const state = await bkmpGuildBossJoin();
        if (state) {
          bkmpGuildBossMarkJoined(state.instanceId);
          bkmpGuildBossState = state;
          bkmpGuildBossResultShown = false;
          bkmpGuildBossParticipants = await loadGuildBossParticipants(state.instanceId).catch(() => []);
          if (state.status === 'fighting') bkmpGuildBossStartLoop();
          else bkmpGuildBossCheckOutcome();
        }
      } catch (e) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
      }
      bkmpGuildBossBusy = false;
      await bkmpIdleRenderGildeBossPanel();
    });
    return;
  }

  const g = bkmpGuildBossState;
  const isFinished = g.status === 'won' || g.status === 'expired';
  /* g.id gibt es nicht (bkmpGuildBossJoin() liefert "instanceId", siehe
     Bug-Fix-Kommentar bei bkmpGuildBossOwnTick) - hier selbst reingefallen
     beim urspruenglichen Render-Throttle-Fix. */
  const renderKey = g.instanceId + '|' + isFinished;

  if (bkmpGuildBossPanelRenderedForKey !== renderKey) {
    bkmpGuildBossPanelRenderedForKey = renderKey;
    if (isFinished) {
      /* Spieler-Report (15.07., "der Drache ist auch einfach immernoch
         da"): bisher wurde bei Sieg/Ablauf nur die "raid-clickable"-Klasse
         entfernt und der Statustext geaendert - das lachend weiterlaufende
         Drachenvideo aus der aktiven Kampfansicht blieb optisch komplett
         unveraendert stehen, kein erkennbarer Sieg-/Ende-Zustand. Analog
         zum bereits vorhandenen Raid-Ergebnisbildschirm (bkmpRaidShowResult)
         jetzt eine eigene Ergebnisansicht statt der Kampfansicht - nutzt
         dieselben raid-result-*-CSS-Klassen, die fuer den Raid schon
         existieren. bkmpGuildBossUpdateCombatUI() unten haelt die Werte
         hier zusaetzlich aktuell, da der spaetere Nachlade-Refresh in
         bkmpGuildBossCheckOutcome() wegen desselben renderKey KEIN erneutes
         Neubauen dieses Grundgeruests mehr ausloest. */
      panel.innerHTML = `
        <div class="idle-dungeon-intro">
          <h4>🐲 ${escapeHtml(g.bossName || 'Gildenboss')}</h4>
        </div>
        <div class="raid-result-title ${g.status === 'won' ? 'won' : 'lost'}">${g.status === 'won' ? '🏆 Gildenboss besiegt!' : '⌛ Zeit abgelaufen'}</div>
        <div class="raid-result-stats">
          <div class="raid-result-stat"><div class="raid-result-stat-label">Gesamtschaden</div><div class="raid-result-stat-value" id="guildBossResultTotalDmg">0</div></div>
          <div class="raid-result-stat"><div class="raid-result-stat-label">Dein Schaden</div><div class="raid-result-stat-value" id="guildBossResultOwnDmg">0</div></div>
          <div class="raid-result-stat"><div class="raid-result-stat-label">Dein Rang</div><div class="raid-result-stat-value" id="guildBossResultRank">-</div></div>
          <div class="raid-result-stat"><div class="raid-result-stat-label">Teilnehmer</div><div class="raid-result-stat-value" id="guildBossResultParticipantCount">${g.participantCount || bkmpGuildBossParticipants.length}</div></div>
          <div class="raid-result-stat"><div class="raid-result-stat-label">MVP</div><div class="raid-result-stat-value raid-result-mvp" id="guildBossResultMvp">-</div></div>
        </div>
        ${g.status === 'won' ? '<div class="raid-result-rewards"><span>💰 +<span id="guildBossResultGold">0</span></span><span>💎 +<span id="guildBossResultGems">0</span></span></div>' : ''}
        <div class="idle-arena-history">
          <h4 style="margin-top:1rem;">🏆 Schadensrangliste</h4>
          <div id="guildBossParticipantsList"></div>
        </div>
      `;
    } else {
      const hpPct = g.bossMaxHp > 0 ? Math.max(0, Math.min(100, (g.bossHp / g.bossMaxHp) * 100)) : 0;
      panel.innerHTML = `
        <div class="idle-dungeon-intro">
          <h4>🐲 ${escapeHtml(g.bossName || 'Gildenboss')}</h4>
          <p class="idle-dungeon-best" id="guildBossStatusText"></p>
        </div>
        <div class="raid-battlefield" id="guildBossBattlefield" style="justify-content:center;">
          <div class="raid-boss raid-clickable" id="guildBossCreature">
            <video class="raid-boss-sprite raid-sprite-malthyros" id="guildBossSprite" src="assets/dragons/malthyros.mp4?v=20260715-2" autoplay muted loop playsinline></video>
            <div class="raid-hp-bar"><div class="raid-hp-fill raid-hp-fill-boss" id="guildBossHpFill" style="width:${hpPct}%"></div></div>
            <div class="raid-hp-label" id="guildBossHpLabel">${bkmpIdleFormatNumber(g.bossHp)} / ${bkmpIdleFormatNumber(g.bossMaxHp)}</div>
            <div class="raid-boss-name" id="guildBossNameLabel">${escapeHtml(g.bossName || '')}</div>
          </div>
        </div>
        <p class="idle-guild-xp-pct" id="guildBossMyDamage"></p>
        <div class="idle-arena-history">
          <h4 style="margin-top:1rem;">🏆 Schadensrangliste</h4>
          <div id="guildBossParticipantsList"></div>
        </div>
      `;
      const creature = document.getElementById('guildBossCreature');
      if (creature) creature.addEventListener('click', bkmpGuildBossHandleClick);
    }
  }

  bkmpGuildBossUpdateCombatUI();
}

function bkmpGuildBossUpdateCombatUI() {
  const g = bkmpGuildBossState;
  if (!g) return;
  const isFinished = g.status === 'won' || g.status === 'expired';
  const hpPct = g.bossMaxHp > 0 ? Math.max(0, Math.min(100, (g.bossHp / g.bossMaxHp) * 100)) : 0;
  const hpFill = document.getElementById('guildBossHpFill');
  if (hpFill) hpFill.style.width = hpPct + '%';
  const hpLabel = document.getElementById('guildBossHpLabel');
  if (hpLabel) hpLabel.textContent = `${bkmpIdleFormatNumber(g.bossHp)} / ${bkmpIdleFormatNumber(g.bossMaxHp)}`;
  const statusText = document.getElementById('guildBossStatusText');
  if (statusText) statusText.textContent = `${isFinished ? (g.status === 'won' ? '🏆 Besiegt!' : '⌛ Zeit abgelaufen.') : `⏳ ${bkmpRaidFormatCountdown(bkmpGuildBossGetPhaseInfo().msUntilFightEnd || 0)} verbleiben`} · ${g.participantCount || bkmpGuildBossParticipants.length} Kämpfer`;
  if (isFinished) {
    /* Der Nachlade-Refresh in bkmpGuildBossCheckOutcome() (frische
       Teilnehmerliste nach Kampfende) loest wegen des unveraenderten
       renderKey KEIN Neubauen des Ergebnis-Grundgeruests mehr aus (siehe
       Kommentar dort) - die Statistik-Werte muessen deshalb hier bei
       jedem Aufruf aktuell gehalten werden, nicht nur einmalig beim Bau. */
    const totalDamage = bkmpGuildBossParticipants.reduce((sum, p) => sum + p.damageDealt, 0);
    const myDamage = bkmpGuildBossParticipants.find(p => p.authUserId === bkmpGuildMyAuthUserId);
    const myRank = myDamage ? bkmpGuildBossParticipants.indexOf(myDamage) + 1 : 0;
    const mvp = bkmpGuildBossParticipants[0];
    const totalEl = document.getElementById('guildBossResultTotalDmg');
    if (totalEl) totalEl.textContent = bkmpIdleFormatNumber(totalDamage);
    const ownEl = document.getElementById('guildBossResultOwnDmg');
    if (ownEl) ownEl.textContent = bkmpIdleFormatNumber(myDamage ? myDamage.damageDealt : 0);
    const rankEl = document.getElementById('guildBossResultRank');
    if (rankEl) rankEl.textContent = myRank ? '#' + myRank : '-';
    const mvpEl = document.getElementById('guildBossResultMvp');
    if (mvpEl) mvpEl.textContent = mvp ? mvp.displayName : '-';
    const participantCountEl = document.getElementById('guildBossResultParticipantCount');
    if (participantCountEl) participantCountEl.textContent = g.participantCount || bkmpGuildBossParticipants.length;
    if (g.status === 'won') {
      /* Eigener Anteil exakt wie guild_boss_finish() serverseitig rechnet
         (Schaden-Anteil * Belohnungs-Pool, siehe supabase-guild-boss.sql) -
         g.goldReward/gemReward kommen aus dem Nachlade-Refresh in
         bkmpGuildBossCheckOutcome() (loadGuildBossInstance()), da die
         Beitritts-/Schadens-RPCs die Pool-Groesse nicht zurueckliefern. */
      const myShare = myDamage && totalDamage > 0 ? myDamage.damageDealt / totalDamage : 0;
      const goldEl = document.getElementById('guildBossResultGold');
      if (goldEl) goldEl.textContent = bkmpIdleFormatNumber(Math.round((g.goldReward || 0) * myShare));
      const gemsEl = document.getElementById('guildBossResultGems');
      if (gemsEl) gemsEl.textContent = bkmpIdleFormatNumber(Math.round((g.gemReward || 0) * myShare));
    }
  }
  bkmpGuildBossRequestParticipantsRender();
}

function bkmpGuildBossRequestParticipantsRender() {
  if (bkmpGuildBossUpdateRenderTimer) return;
  bkmpGuildBossUpdateRenderTimer = window.setTimeout(() => {
    bkmpGuildBossUpdateRenderTimer = null;
    bkmpGuildBossRenderParticipants();
  }, 400);
}

/* Spieler-Report (15.07., Schadenszahlen selbst korrekt, aber ueberall
   "0% Anteil"): g.totalDamage kam nur ueber Realtime-postgres_changes auf
   guild_boss_instances rein (siehe bkmpGuildBossStartLoop) - beim eigenen
   Tick/Klick (viel haeufigerer, direkter Pfad seit dem Own-Damage-Sync-Fix
   oben) wurde es nie gesetzt und blieb damit fuer die gesamte Kampfdauer
   "undefined", die Prozentrechnung landete deshalb immer beim 0-Fallback.
   Robuster: die Summe direkt aus den bereits vorhandenen Teilnehmer-
   Schadenswerten bilden statt auf dieses separate Feld zu vertrauen. */
function bkmpGuildBossRenderParticipants() {
  const g = bkmpGuildBossState;
  if (!g) return;
  const totalDamage = bkmpGuildBossParticipants.reduce((sum, p) => sum + p.damageDealt, 0);
  const myDamage = bkmpGuildBossParticipants.find(p => p.authUserId === bkmpGuildMyAuthUserId);
  const myDmgEl = document.getElementById('guildBossMyDamage');
  if (myDmgEl) myDmgEl.innerHTML = myDamage ? `Dein Schaden: ${bkmpIdleFormatNumber(myDamage.damageDealt)} (${totalDamage > 0 ? Math.round(myDamage.damageDealt / totalDamage * 100) : 0}% Anteil)` : '';
  const listEl = document.getElementById('guildBossParticipantsList');
  if (!listEl) return;
  listEl.innerHTML = bkmpGuildBossParticipants.length === 0 ? '<p class="empty-hint">Noch kein Schaden verursacht.</p>' : bkmpGuildBossParticipants.map((p, i) => `
    <div class="idle-arena-opponent-card">
      <span class="idle-arena-opponent-name">${BKMP_GUILD_MEDALS[i] || `${i + 1}.`} ${escapeHtml(p.displayName)}</span>
      <span class="idle-arena-opponent-rating">${totalDamage > 0 ? Math.round(p.damageDealt / totalDamage * 100) : 0}%</span>
      <span class="idle-arena-opponent-record">${bkmpIdleFormatNumber(p.damageDealt)} Schaden</span>
    </div>
  `).join('');
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
  { id: 'raid_best', label: '🐉 Bester Raid', isRaid: true },
  { id: 'dungeon', label: '🏛️ Dungeon', isDungeon: true },
  { id: 'turm', label: '🗼 Turm', field: 'turm_highest_wave', format: v => 'Stufe ' + v }
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
    if (typeof loadIdleLeaderboardStats === 'function') {
      const rows = (await loadIdleLeaderboardStats()) || [];
      bkmpIdleLeaderboardStats = rows.filter(r => !bkmpIsHiddenTestAccount(r.name_key));
    }
  } catch (e) { console.warn('Idle Dorf: Bestenliste konnte nicht geladen werden.', e); }
  bkmpIdleRenderLeaderboardList();
}

function bkmpIdleRenderLeaderboardList() {
  const listEl = document.getElementById('idleLeaderboardList');
  if (!listEl) return;
  const tab = BKMP_IDLE_LEADERBOARD_TABS.find(t => t.id === bkmpIdleActiveLeaderboardTab) || BKMP_IDLE_LEADERBOARD_TABS[0];
  if (tab.isRaid) { bkmpRaidRenderLeaderboard(); return; }
  if (tab.isDungeon) { bkmpDungeonRenderLeaderboard(); return; }
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
    /* Sicherheits-Nachtrag (Audit 15.07.): api/claim-idle-offline-progress.js
       identifiziert den Spieler jetzt ueber dieses Access-Token statt ueber
       den mitgeschickten Namen - verhindert, dass jemand per wiederholtem
       Aufruf mit fremdem Namen dessen last_seen_at zuruecksetzt und ihm so
       Offline-Fortschritt klaut. */
    const session = typeof bkmpGetPlayerSession === 'function' ? await bkmpGetPlayerSession() : null;
    const accessToken = session ? session.access_token : null;
    /* Bug-Fix (Spieler-Meldung FlinkerBoy7289, 16.07.: "bekomme ich z.B.
       ueber Nacht keine Offline Sachen"): ein fehlendes/abgelaufenes Token
       (z.B. durch den separat gefixten Session-Rauswurf-Bug) und ein 401
       vom Server wurden bisher identisch zu "return null" wie ein simples
       "nichts zu holen" behandelt - der Spieler bekam nie einen Hinweis,
       WARUM kein Offline-Fortschritt ankam. Jetzt ein eigenes, erkennbares
       Ergebnis (authError), damit bkmpIdleShowOfflineCard einen echten
       Hinweis statt stiller Nichtanzeige geben kann. */
    if (!accessToken) return { authError: true };
    const res = await fetch('/api/claim-idle-offline-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ playerName: name })
    });
    if (res.status === 401) return { authError: true };
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
  if (result && result.authError) {
    card.innerHTML = `
      <button type="button" class="idle-offline-close" id="idleOfflineCardClose" aria-label="Schließen">&times;</button>
      <strong>⚠️ Offline-Fortschritt konnte nicht abgerufen werden</strong>
      <div class="idle-offline-rewards"><span>Deine Sitzung war beim Laden nicht mehr gültig. Falls das öfter passiert: einmal aus- und wieder einloggen.</span></div>`;
    card.style.display = '';
    const closeErrBtn = document.getElementById('idleOfflineCardClose');
    if (closeErrBtn) closeErrBtn.addEventListener('click', () => { card.style.display = 'none'; });
    return;
  }
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

/* Spieler-Report (16.07., Screenshot Kampf-Tab): "Habe ich das Gefühl,
   dass es pausiert", wenn laenger ein anderer Tab/ein anderes Fenster
   darueber liegt. Kein Bug im eigentlichen Sinn - Browser drosseln
   setInterval in nicht sichtbaren/verdeckten Tabs GRUNDSAETZLICH (Standard-
   Verhalten JEDER Webseite, Akku-/CPU-Schutz), der Live-Tick (bkmpIdleTick,
   alle ~900ms) laeuft dadurch effektiv kaum noch. Bisher fing nur ein
   Neuladen/erneutes Oeffnen des Dorf-Fensters die Luecke ueber das
   serverseitige Offline-Fortschritts-Modell ab (bkmpIdleClaimOfflineProgress,
   siehe bkmpIdleOpenModal) - blieb das Fenster die ganze Zeit offen und nur
   der TAB verdeckt/im Hintergrund, gab es GAR KEINEN Ausgleich, das Dorf sah
   dann tatsaechlich wie pausiert aus. Jetzt: sobald der Tab wieder sichtbar
   wird, wird derselbe, bereits serverseitig abgesicherte Abgleich (inkl.
   dessen eigener 60-Sekunden-Mindestschwelle in api/claim-idle-offline-
   progress.js - kurzes Wegschauen loest also von selbst nichts aus) erneut
   angestossen. Bewusst NUR bei normalem Dorf-Kampf (Dorf-Fenster offen, kein
   Dungeon-/Turm-/Raid-Sonderkampf aktiv) - das Offline-Modell simuliert
   ausschliesslich die normale Drachen-Stufen-Kletterei, nicht diese
   instanzierten Sonderkaempfe. */
async function bkmpIdleCatchUpAfterHidden() {
  if (!bkmpIdleModalOpen || !bkmpIdleState) return;
  if (bkmpDungeonActive || bkmpDungeonAutoActive() || bkmpTowerActive) return;
  if (typeof bkmpRaidShouldShowCombatView === 'function' && bkmpRaidShouldShowCombatView()) return;
  const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
  if (!name) return;
  const offlineResult = await bkmpIdleClaimOfflineProgress(name);
  if (offlineResult) bkmpIdleApplyOfflineResult(offlineResult);
  bkmpIdleShowOfflineCard(offlineResult);
  if (offlineResult && offlineResult.newTotals) {
    bkmpIdleRecomputeEffectiveStats();
    bkmpIdleRenderHud();
    bkmpIdleUpdateVillageHpBar();
    bkmpIdleUpdateDragonHpBar();
  }
}

/* ---------------- Sync ---------------- */

function bkmpIdleQueueSync() {
  bkmpIdleSyncPending = true;
  if (bkmpIdleSyncTimer) return;
  bkmpIdleSyncTimer = window.setTimeout(() => { bkmpIdleSyncTimer = null; bkmpIdleFlushSync(); }, 4000);
}

/* Schnappschuss der "ausgebbaren" Felder - Referenzpunkt fuer den
   Differenz-Merge in bkmpIdleMergeRemoteSpendableFields (siehe dort). Wird
   nach jedem frischen Laden UND nach jedem erfolgreichen Merge neu gesetzt. */
let bkmpIdleMergeBaseline = null;

function bkmpIdleSnapshotMergeBaseline() {
  if (!bkmpIdleState) { bkmpIdleMergeBaseline = null; return; }
  bkmpIdleMergeBaseline = {
    level: Number(bkmpIdleState.level || 0),
    gold: Number(bkmpIdleState.gold || 0),
    wood: Number(bkmpIdleState.wood || 0),
    stone: Number(bkmpIdleState.stone || 0),
    crystals: Number(bkmpIdleState.crystals || 0),
    essence: Number(bkmpIdleState.essence || 0),
    skill_points_spent: Number(bkmpIdleState.skill_points_spent || 0),
    skill_points_available: Number(bkmpIdleState.skill_points_available || 0),
    current_dragon_index: Number(bkmpIdleState.current_dragon_index || 0),
    highest_dragon_index: Number(bkmpIdleState.highest_dragon_index || 0),
    auto_advance: bkmpIdleState.auto_advance !== false
  };
}

/* Nimmt pro Schluessel den hoeheren Wert - sicher fuer Zaehler, die nur
   wachsen (Upgrade-Stufen, verteilte Skillpunkte pro Knoten): egal welche
   Seite zuletzt gekauft hat, die weiter fortgeschrittene Seite gewinnt,
   ohne dass ein Kauf von der ANDEREN Seite verloren geht. */
function bkmpIdleMergeCountMaps(local, remote) {
  const merged = { ...(local || {}) };
  Object.keys(remote || {}).forEach(key => {
    merged[key] = Math.max(Number(merged[key] || 0), Number(remote[key] || 0));
  });
  return merged;
}

/* Kernstueck der Twitch-Sync-Nachbesserung (Nutzerwunsch 15.07.): laeuft
   NUR auf der Twitch-Seite (window.BKMP_IDLE_IS_STREAM_PAGE) - VOR jedem
   eigenen Autosave (siehe bkmpIdleFlushSync) UND zusaetzlich alle ~20s im
   Herzschlag-Takt (siehe bkmpIdleStreamStartHeartbeat), damit ein Kauf auf
   der Hauptseite auch dann sichtbar wird, wenn gerade kein Drache stirbt
   und deshalb kein eigener Autosave anstuende. Holt den aktuellen DB-Stand
   und gleicht die "ausgebbaren" Felder ab, BEVOR der eigene (evtl. veraltete) Stand
   ueberschrieben wird:
   - Ressourcen (Gold/Holz/Stein/Kristalle/Essenz): Differenz-Merge - die
     Twitch-Seite verdient laufend durch Kaempfe dazu, die Hauptseite gibt
     evtl. etwas aus. remote-Wert (frischer DB-Stand) + eigener Zuwachs
     seit dem letzten Abgleich (bkmpIdleMergeBaseline) = korrektes Ergebnis
     in beide Richtungen, ohne dass eine Seite die andere blind ueberschreibt.
   - Upgrade-Stufen/Skillpunkt-Verteilung: Maximal-Merge pro Schluessel
     (siehe bkmpIdleMergeCountMaps) - beide Seiten koennen nur kaufen/
     verteilen, nie verringern (ausser bei einem Prestige-Aufstieg, der
     ueber bkmpIdleFlushSyncNow sofort speichert und den Basiswert direkt
     danach neu setzt - kein Konflikt mit diesem Abgleich).
   - skill_points_spent: gleiche Differenz-Logik wie Ressourcen, danach
     wird skill_points_available so nachgerechnet, dass die Gesamtsumme
     (verfuegbar+ausgegeben) nie kleiner wird als auf beiden Seiten bekannt. */
/* FEHLER-FIX (Streamer-Report DerLiber, 13.07.: "manchmal bricht er den
   Kampf ab, springt zurueck" - Stufe sprang z.B. von 25-4 auf 24-8 zurueck,
   Auto-Aufstieg schaltete sich von selbst aus): der Herzschlag (alle 20s,
   siehe bkmpIdleStreamStartHeartbeat) und der kill-ausgeloeste Autosave
   (siehe bkmpIdleFlushSync) konnten diese Funktion GLEICHZEITIG aufrufen.
   `baseline` wird HIER UNTEN erst NACH dem "await loadIdlePlayerState(...)"
   gelesen - lief waehrenddessen ein ZWEITER, schneller abgeschlossener
   Aufruf komplett durch (eigener Merge + bkmpIdleSnapshotMergeBaseline()),
   sah der ERSTE (langsamere) Aufruf beim Aufwachen eine BEREITS
   AKTUALISIERTE globale Baseline, obwohl sein eigenes `remote` noch der
   ALTE, vor dem zweiten Aufruf geladene DB-Stand war - localStage schien
   dadurch faelschlich "seit der Baseline unveraendert", obwohl in
   Wirklichkeit laengst mehrere Stufen weiter gekaempft wurde, und der
   veraltete `remote`-Stand wurde faelschlich als neuer lokaler Stand
   uebernommen (echter Rueckschritt). Fix: nur EIN Abgleich gleichzeitig -
   ueberlappende Aufrufe werden einfach uebersprungen, der naechste
   turnusmaessige Aufruf (spaetestens 4s/20s spaeter) holt konsistent nach. */
let bkmpIdleMergeInFlight = false;
async function bkmpIdleMergeRemoteSpendableFields() {
  if (!bkmpIdleState || typeof loadIdlePlayerState !== 'function') return;
  if (bkmpIdleMergeInFlight) return;
  bkmpIdleMergeInFlight = true;
  try {
  const remote = await loadIdlePlayerState(bkmpIdleState.name_key);
  if (!remote) return;
  const baseline = bkmpIdleMergeBaseline || bkmpIdleState;
  /* KRITISCHER FEHLER-FIX (Spieler-Report 13.07.: "Flammengott konnte
     bereits 3x Prestigen instant, Level geht nicht zurueck, er nutzt das
     OBS-Twitch-Browser-Fenster") - ein Prestige-Aufstieg auf der
     HAUPTSEITE setzt current_dragon_index/highest_dragon_index/level/
     skill_allocations/upgrade_purchases/Ressourcen komplett zurueck und
     speichert das korrekt (bkmpIdleSkipNextMerge, siehe
     bkmpIdlePerformPrestige). War aber GLEICHZEITIG die Twitch-Seite offen
     (eigene, noch nicht zurueckgesetzte bkmpIdleState-Kopie im RAM dieser
     Seite), hat genau DIESE Funktion hier den frischen Reset praktisch
     sofort wieder rueckgaengig gemacht: highest_dragon_index nutzte einen
     reinen Maximal-Merge (siehe Kommentar weiter unten - "rein monoton"
     stimmt nur INNERHALB eines Laufs, NICHT ueber einen Prestige-Reset
     hinweg), skill_allocations/upgrade_purchases nutzen ebenfalls
     Maximal-Merge (koennen nie sinken) - beides hat den alten, hohen Stand
     der Twitch-Seite postwendend zurueck in die DB geschrieben. Dadurch
     war die naechste Prestige-Schwelle (die ja an highest_dragon_index
     haengt, siehe bkmpPrestigeEligible) sofort wieder erreicht, obwohl gar
     nicht neu gespielt wurde - daher "3x instant".

     NACHBESSERUNG (gleicher Report, Folgefehler NACH dem ersten Fix): die
     erste Fassung erkannte "Prestige woanders passiert" ueber einen
     Vergleich des prestige_level aus einer SEPARAT geladenen zweiten
     Tabelle (idle_prestige_state). bkmpIdlePerformPrestige() speichert
     idle_player_state (Reset) und idle_prestige_state (neuer Level) aber
     nacheinander in ZWEI getrennten Requests - fiel ein Abgleich hier
     GENAU in die kurze Luecke dazwischen, sah er den Reset in
     idle_player_state zwar schon, aber den erhoehten prestige_level in
     idle_prestige_state noch nicht - "prestigeHappenedElsewhere" blieb
     faelschlich false, die alte Differenz-/Maximal-Merge-Logik lief
     normal weiter und hat den frischen Reset genau wie beim urspruenglichen
     Bug sofort wieder rueckgaengig gemacht ("er ist direkt wieder auf
     Level 691 hochgesprungen").
     Robusterer Fix: KEIN Signal aus einer zweiten, separat getimten
     Tabelle mehr noetig - highest_dragon_index UND level koennen unter
     NORMALEM Spielen niemals sinken (beide sind streng monoton wachsend,
     siehe bkmpIdleAddXp/bkmpIdleJumpToStage), NUR ein Prestige-Reset kann
     sie auf einen niedrigeren Wert setzen. remote < baseline bei einem
     dieser beiden Werte ist deshalb ein in sich konsistentes Signal aus
     EINEM einzigen Request (idle_player_state), ohne Race-Fenster
     gegenueber einer zweiten Tabelle. */
  const remoteHighest = Number(remote.highest_dragon_index || 0);
  const remoteLevel = Number(remote.level || 0);
  const prestigeHappenedElsewhere = remoteHighest < Number(baseline.highest_dragon_index || 0) || remoteLevel < Number(baseline.level || 0);
  let stageChangedByRemote = false;
  if (prestigeHappenedElsewhere) {
    ['level', 'xp', 'gold', 'wood', 'stone', 'crystals', 'essence', 'skill_points_available', 'skill_points_spent', 'current_dragon_index', 'highest_dragon_index'].forEach(key => {
      bkmpIdleState[key] = Number(remote[key] || 0);
    });
    bkmpIdleState.skill_allocations = remote.skill_allocations || {};
    bkmpIdleState.upgrade_purchases = remote.upgrade_purchases || {};
    bkmpIdleState.auto_advance = remote.auto_advance !== false;
    /* Den zugehoerigen, ebenfalls neuen Prestige-Baum-Stand mituebernehmen -
       falls die zweite Tabelle in genau diesem Moment noch den alten Wert
       zeigt (siehe Race-Erklaerung oben), holt der naechste turnusmaessige
       Abgleich (spaetestens 4-20s spaeter, ueber bkmpPrestigeMergeRemoteSpendable)
       das korrekt nach - hier keine eigene Vorbedingung mehr dafuer. */
    try {
      const remotePrestige = typeof loadIdlePrestigeState === 'function' ? await loadIdlePrestigeState(bkmpIdleState.name_key) : null;
      if (remotePrestige) { bkmpPrestigeState = remotePrestige; bkmpPrestigeSnapshotMergeBaseline(); }
    } catch (e) { /* naechster Abgleich versucht es erneut */ }
    /* Runen gehen bei einem Prestige-Aufstieg ebenfalls verloren (siehe
       bkmpIdlePerformPrestige) - der lokale, hier noch veraltete Bestand
       muss geleert werden, sonst zeigt diese Seite weiter laengst
       geloeschte Runen an. */
    bkmpIdlePlayerRunes = [];
    stageChangedByRemote = true;
  } else {
  ['gold', 'wood', 'stone', 'crystals', 'essence'].forEach(key => {
    const localDelta = Number(bkmpIdleState[key] || 0) - Number(baseline[key] || 0);
    bkmpIdleState[key] = Math.max(0, Number(remote[key] || 0) + localDelta);
  });
  bkmpIdleState.upgrade_purchases = bkmpIdleMergeCountMaps(bkmpIdleState.upgrade_purchases, remote.upgrade_purchases);
  bkmpIdleState.skill_allocations = bkmpIdleMergeCountMaps(bkmpIdleState.skill_allocations, remote.skill_allocations);
  const spentDelta = Number(bkmpIdleState.skill_points_spent || 0) - Number(baseline.skill_points_spent || 0);
  const totalEarnedLocal = Number(bkmpIdleState.skill_points_available || 0) + Number(bkmpIdleState.skill_points_spent || 0);
  const totalEarnedRemote = Number(remote.skill_points_available || 0) + Number(remote.skill_points_spent || 0);
  bkmpIdleState.skill_points_spent = Math.max(0, Number(remote.skill_points_spent || 0) + Math.max(0, spentDelta));
  bkmpIdleState.skill_points_available = Math.max(0, Math.max(totalEarnedLocal, totalEarnedRemote) - bkmpIdleState.skill_points_spent);
  /* Stufe/Auto-Aufstieg (current_dragon_index/auto_advance): kein additiver
     Wert wie Gold, deshalb kein Differenz-Merge moeglich - stattdessen
     "hat sich diese Seite selbst seit dem letzten Abgleich veraendert?"-
     Regel (Streamer-Wunsch DerLiber, 13.07.: Stufensprung-Buttons auf der
     Hauptseite sollen den Drachen auf der Twitch-Seite live wechseln).
     Ist der lokale Wert seit der letzten Baseline UNVERAENDERT (kein
     eigener Kill/Sprung hier auf der Twitch-Seite), aber der entfernte
     Stand hat sich veraendert (Sprung-Klick auf der Hauptseite) - dann den
     entfernten Stand uebernehmen und weiter unten den passenden Drachen neu
     spawnen. Hat sich der lokale Wert dagegen selbst veraendert (normaler
     Kampf-Fortschritt hier), gewinnt der lokale Stand - der naechste
     Abgleich ueberschreibt den entfernten (dann veralteten) Stand ohnehin
     mit dem frischeren lokalen. highest_dragon_index ist wie Upgrade-Stufen
     INNERHALB eines Laufs monoton - ausserhalb eines Prestige-Resets (siehe
     oben) reicht dafuer ein einfacher Maximal-Merge. */
  bkmpIdleState.highest_dragon_index = Math.max(Number(bkmpIdleState.highest_dragon_index || 0), Number(remote.highest_dragon_index || 0));
  const stageBaseline = Number(baseline.current_dragon_index || 0);
  const localStage = Number(bkmpIdleState.current_dragon_index || 0);
  const remoteStage = Number(remote.current_dragon_index || 0);
  if (localStage === stageBaseline && remoteStage !== stageBaseline) {
    bkmpIdleState.current_dragon_index = Math.max(0, Math.min(bkmpIdleState.highest_dragon_index, remoteStage));
    stageChangedByRemote = true;
  }
  const autoBaseline = baseline.auto_advance !== false;
  const localAuto = bkmpIdleState.auto_advance !== false;
  const remoteAuto = remote.auto_advance !== false;
  if (localAuto === autoBaseline && remoteAuto !== autoBaseline) {
    bkmpIdleState.auto_advance = remoteAuto;
  }
  }
  bkmpIdleSnapshotMergeBaseline();
  /* Spieler-Frage (15.07.): "Habe gerade Leben upgraded, wann wird das
     akkumuliert?" - ein Upgrade AENDERT effektive Werte (max. HP/Angriff/
     etc.) nur ueber bkmpIdleRecomputeEffectiveStats(), das hier vorher
     NICHT aufgerufen wurde. upgrade_purchases war zwar schon korrekt
     gemerged, aber die sichtbare HP-Leiste/HUD auf der Twitch-Seite haette
     trotzdem noch den alten Wert gezeigt, bis rein zufaellig ein anderes
     Ereignis (naechster Kill) den Recompute ausgeloest haette. Jetzt direkt
     nach jedem Abgleich neu berechnen und anzeigen. */
  if (typeof bkmpIdleRecomputeEffectiveStats === 'function') bkmpIdleRecomputeEffectiveStats();
  if (stageChangedByRemote && typeof bkmpIdleSpawnDragon === 'function') {
    /* Frischer Kampf auf der neuen Stufe - volle Dorf-HP wie bei einem
       manuellen Sprung (siehe bkmpIdleJumpToStage), kein Uebertrag der HP
       vom vorherigen Drachen/Stand. */
    bkmpIdleVillageHp = null;
    bkmpIdleCurrentDragon = null;
    bkmpIdleSpawnDragon();
  }
  if (bkmpIdleEffectiveStats) bkmpIdleVillageHp = Math.min(bkmpIdleVillageHp == null ? bkmpIdleEffectiveStats.hp : bkmpIdleVillageHp, bkmpIdleEffectiveStats.hp);
  if (typeof bkmpIdleUpdateVillageHpBar === 'function') bkmpIdleUpdateVillageHpBar();
  if (typeof bkmpIdleRenderHud === 'function') bkmpIdleRenderHud();
  } finally {
    bkmpIdleMergeInFlight = false;
  }
}

/* FEHLER-FIX (Spieler-Report 15.07.: "Die Upgrades reseten sich jedesmal
   wenn ich was upgrade") - der Merge-Abgleich lief bisher nur alle 15s
   (throttled). Die Twitch-Seite speichert aber bei aktivem Kampf viel
   oefter (alle ~4s, nach JEDEM Drachen-Kill via bkmpIdleQueueSync) - in den
   Luecken DAZWISCHEN schrieb sie weiterhin blind ihren eigenen (noch nicht
   abgeglichenen) Stand in die DB und hat damit einen frisch auf der
   Hauptseite gekauften Upgrade praktisch sofort wieder ueberschrieben.
   Der Merge muss deshalb bei JEDEM einzelnen Speichervorgang der Twitch-
   Seite laufen, nicht nur gelegentlich - bkmpIdleSkipNextMerge ist die
   einzige bewusste Ausnahme (siehe bkmpIdlePerformPrestige: ein Aufstieg
   IST der Reset, der soll die DB unbedingt ueberschreiben statt mit einem
   moeglicherweise noch alten Remote-Stand verschmolzen zu werden). */
let bkmpIdleSkipNextMerge = false;

/* ---------------- Gildenquests: Delta-Sammlung (siehe
   supabase-guild-quests.sql) ----------------
   Statt bei jedem Drachen-Kill/Gold-Gewinn/Sieg einen eigenen RPC-Call zu
   feuern, sammeln sich Deltas hier nur lokal und werden im bestehenden
   4s-Autosave-Rhythmus (bkmpIdleFlushSync) gebuendelt mitgeschickt - kein
   zusaetzlicher Netzwerk-Traffic pro Spielaktion. */
let bkmpGuildQuestPendingDeltas = {};
function bkmpGuildQuestAddDelta(type, amount) {
  if (!amount) return;
  bkmpGuildQuestPendingDeltas[type] = (bkmpGuildQuestPendingDeltas[type] || 0) + amount;
}
function bkmpGuildQuestFlushDeltas() {
  if (!Object.keys(bkmpGuildQuestPendingDeltas).length) return;
  /* Bug-Report 17.07. (Postgres-Fehlerlog, ChronoKora): guild_quest_contribute()
     wirft "not_in_guild" fuer jeden Spieler ohne Gilde (siehe
     supabase-guild-quests.sql) - wurde hier aber bisher unabhaengig vom
     Gildenstatus bei JEDEM Autosave mit ausstehenden Deltas gefeuert (also
     praktisch bei jedem aktiven Spieler ohne Gilde, alle ~4s). bkmpGuildState
     ist nur gesetzt, wenn der Gilde-Tab schon mal geladen wurde (siehe
     bkmpGuildLoadAll) - erst dann ist wirklich bekannt, ob eine Gilde
     existiert. Bis dahin/ ohne Gilde sammeln sich die Deltas hier einfach
     folgenlos weiter, statt einen garantiert fehlschlagenden Request zu
     senden. */
  if (!bkmpGuildState || !bkmpGuildState.guild) return;
  const deltas = bkmpGuildQuestPendingDeltas;
  bkmpGuildQuestPendingDeltas = {};
  if (typeof bkmpGuildQuestContribute === 'function') bkmpGuildQuestContribute(deltas);
}

async function bkmpIdleFlushSync() {
  if (!bkmpIdleSyncPending || !bkmpIdleState) return;
  bkmpIdleSyncPending = false;
  bkmpGuildQuestFlushDeltas();
  if (window.BKMP_IDLE_IS_STREAM_PAGE && !bkmpIdleSkipNextMerge) {
    try { await bkmpIdleMergeRemoteSpendableFields(); } catch (e) { /* naechster Autosave versucht den Abgleich erneut */ }
  }
  bkmpIdleSkipNextMerge = false;
  bkmpIdleState.playtime_seconds = Math.round(Number(bkmpIdleState.playtime_seconds || 0));
  bkmpIdleState.last_seen_at = new Date().toISOString();
  try {
    if (typeof upsertIdlePlayerState === 'function') await upsertIdlePlayerState(bkmpIdleState);
    bkmpIdleSnapshotMergeBaseline();
  } catch (e) {
    console.warn('Idle Dorf: Speichern fehlgeschlagen.', e);
    /* Bug-Report 17.07. (ChronoKora): Speichern schlug ueber laengere Zeit
       komplett fehl, ohne dass der Spieler davon je etwas mitbekam - nur
       console.warn, das niemand beim normalen Spielen offen hat. Jetzt
       wenigstens EINMAL alle 60s sichtbar machen (kein Toast-Spam bei
       laengeren Ausfaellen/Offline-Phasen, aber auch kein komplett stiller
       Datenverlust mehr). */
    const now = Date.now();
    if (typeof bkmpShowJannikToast === 'function' && now - (bkmpIdleLastSaveFailToastAt || 0) > 60000) {
      bkmpIdleLastSaveFailToastAt = now;
      bkmpShowJannikToast('⚠️ Speichern fehlgeschlagen - dein Fortschritt der letzten Zeit ist evtl. nicht gesichert. Bitte Seite neu laden und prüfen.', 6000);
    }
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
    bkmpRuneDeleteRemote(runeIdsToDelete, 'Prestige-Reset');

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

/* ---------------- Drachenzucht (siehe supabase-dragon-breeding.sql) ----------------
   Vertrauensmodell wie Runen: Client wuerfelt Chancen/Werte, RLS erzwingt
   nur "eigene Zeile". Rollt/entwickelt nach demselben Muster wie Runen
   (rolled_value/substats einmal wuerfeln, dauerhaft speichern) - siehe
   bkmpIdleRollAdultDragonStats(). Nur die zwei Stellen mit echtem
   Mehrspieler-/Wiederholungsrisiko (legendaere Ei-Wuerfe, Epic-Meilenstein)
   laufen serverseitig (raid_finish/claim_epic_dragon_egg). */
let bkmpDragonSpeciesCatalog = [];
let bkmpPlayerDragonEggs = [];
let bkmpPlayerDragonNests = [];
let bkmpPlayerDragons = [];
let bkmpDragonUiEggFilter = null;
let bkmpDragonLagerFilter = { rarity: 'all', stage: 'all', favoritesOnly: false, sort: 'rarity' };

/* Kosten fuer Nest 2-5 (Index 0 = Nest 1, immer 0/automatisch frei) -
   deutlich steigend wie vom Spieler vorgegeben ("Nest 5: besonders teuer"). */
const BKMP_DRAGON_NEST_GOLD_COSTS = [0, 150000, 600000, 2000000, 6000000];
const BKMP_DRAGON_RARITY_META = {
  standard: { name: 'Standard', color: '#9ca3af' },
  selten: { name: 'Selten', color: '#38bdf8' },
  episch: { name: 'Episch', color: '#a78bfa' },
  legendaer: { name: 'Legendär', color: '#facc15' }
};
/* Sub-Stat-Pool: die ersten 8 Schluessel sind BEREITS an anderer Stelle
   verdrahtete Effekt-Typen (siehe bkmpIdleRecomputeEffectiveStats/t()) -
   ein aktiver erwachsener Begleitdrache speist sie einfach als weitere
   Quelle in denselben Topf ein (bkmpIdleDragonCompanionEffectTotals).
   Die letzten 4 (Fruechte/Fleisch/Drachen-EP-Bonus) werden NICHT ueber den
   allgemeinen Stat-Topf gelesen, sondern direkt an ihrer jeweiligen Stelle
   (Gebaeude-Produktion, Kampf-EP-Vergabe) - siehe bkmpDragonSubstatBonus(). */
const BKMP_DRAGON_SUBSTAT_POOL = [
  { key: 'attack_pct', label: 'Angriff', suffix: '%', min: 0.8, max: 2.4 },
  { key: 'defense_pct', label: 'Verteidigung', suffix: '%', min: 0.8, max: 2.4 },
  { key: 'hp_pct', label: 'Leben', suffix: '%', min: 0.8, max: 2.4 },
  { key: 'crit_chance_pct', label: 'Krit-Chance', suffix: '%', min: 0.3, max: 1.0 },
  { key: 'crit_damage_pct', label: 'Krit-Schaden', suffix: '%', min: 1.2, max: 3.5 },
  { key: 'attack_speed_pct', label: 'Angriffsgeschwindigkeit', suffix: '%', min: 0.8, max: 2.2 },
  { key: 'shield_regen', label: 'Schildstärke', suffix: '%', min: 0.8, max: 2.2 },
  { key: 'gold_find_pct', label: 'Goldbonus', suffix: '%', min: 0.8, max: 2.4 },
  { key: 'crystal_bonus_pct', label: 'Diamantenbonus', suffix: '%', min: 0.5, max: 1.5 },
  { key: 'fruit_bonus_pct', label: 'Früchteproduktion', suffix: '%', min: 2, max: 6 },
  { key: 'meat_bonus_pct', label: 'Fleischproduktion', suffix: '%', min: 2, max: 6 },
  { key: 'dragon_xp_bonus_pct', label: 'Drachen-EP', suffix: '%', min: 2, max: 6 }
];
const BKMP_DRAGON_MAIN_STAT_KEYS = ['attack', 'defense', 'hp'];
/* Basiswerte fuer die Hauptwert-Wuerfelung, skaliert mit Seltenheit
   (mult uebernimmt die bestehende Runen-Raritaets-Skala 1/1.6/2.4/3.4,
   Legendaer bekommt einen deutlich hoeheren eigenen Faktor statt der
   Runen-5, damit "niemals schwaecher als normale Drachen" sicher gilt -
   siehe Spieler-Vorgabe). */
const BKMP_DRAGON_MAIN_STAT_BASE = { attack: 6, defense: 6, hp: 60 };
const BKMP_DRAGON_RARITY_MULT = { standard: 1, selten: 1.7, episch: 2.8, legendaer: 6 };

function bkmpDragonSpeciesById(id) {
  return bkmpDragonSpeciesCatalog.find(s => s.id === id) || null;
}
function bkmpDragonRarityMeta(rarity) {
  return BKMP_DRAGON_RARITY_META[rarity] || BKMP_DRAGON_RARITY_META.standard;
}
function bkmpDragonStageImage(species, stage) {
  if (!species) return '';
  if (stage === 'egg') return species.egg_image;
  if (stage === 'baby') return species.baby_image;
  if (stage === 'teen') return species.teen_image;
  return species.adult_image;
}

/* ---------------- Laden (aus bkmpIdleLoadOrInitState aufgerufen) ---------------- */
async function bkmpIdleLoadDragonBreedingState(name) {
  bkmpDragonSpeciesCatalog = [];
  bkmpPlayerDragonEggs = [];
  bkmpPlayerDragonNests = [];
  bkmpPlayerDragons = [];
  try {
    if (typeof loadDragonSpeciesCatalog === 'function' && !bkmpDragonSpeciesCatalog.length) {
      /* Katalog ist reine Config (aendert sich nie pro Spieler) - global
         zwischenspeichern statt bei jedem Laden neu abzufragen. */
      window.__bkmpDragonSpeciesCache = window.__bkmpDragonSpeciesCache || await loadDragonSpeciesCatalog();
      bkmpDragonSpeciesCatalog = window.__bkmpDragonSpeciesCache || [];
    }
    if (typeof ensureFirstDragonNest === 'function') await ensureFirstDragonNest(name);
    const [eggs, nests, dragons] = await Promise.all([
      typeof loadPlayerDragonEggs === 'function' ? loadPlayerDragonEggs(name) : [],
      typeof loadPlayerDragonNests === 'function' ? loadPlayerDragonNests(name) : [],
      typeof loadPlayerDragons === 'function' ? loadPlayerDragons(name) : []
    ]);
    bkmpPlayerDragonEggs = Array.isArray(eggs) ? eggs : [];
    bkmpPlayerDragonNests = Array.isArray(nests) ? nests : [];
    bkmpPlayerDragons = Array.isArray(dragons) ? dragons : [];
  } catch (e) {
    console.warn('Idle Dorf: Drachenzucht-Daten konnten nicht geladen werden (Migration evtl. noch nicht ausgefuehrt - siehe supabase-dragon-breeding.sql).', e);
  }
  bkmpIdleAccrueBuildingResources();
}

/* Liest einen Effekt-Typ aus dem Zucht-Skilltree-Zweig (siehe
   supabase-guild-tech-tree.sql-Analogon supabase-dragon-breeding-
   skilltree.sql) - gleiche Quelle wie die Kampfstats
   (bkmpIdleSkillEffectTotals), nur fuer Drachenzucht-spezifische Effekte,
   die NICHT in den allgemeinen Kampf-Stat-Topf gehoeren. */
function bkmpDragonSkillBonus(key) {
  if (!bkmpIdleState) return 0;
  const totals = bkmpIdleSkillEffectTotals(bkmpIdleState.skill_allocations, bkmpIdleSkillDefs);
  return totals[key] || 0;
}

/* ---------------- Fundschatz bei Kaempfen (ehemals Ei-Drop) ----------------
   Dungeon-System 2.0 (Spieler-Vorgabe 17.07.): der Ei-Dungeon ist ab jetzt
   die alleinige Quelle fuer reguläre Dracheneier - Normalkampf droppt keine
   Eier mehr. Gleicher Aufruf-Ort/gleiche Trigger-Bedingung wie zuvor
   bkmpIdleMaybeDropDragonEgg (bkmpIdleHandleDragonDefeated, jede Drachenart
   mit egg_source='combat' und passender source_dragon_id wuerfelt weiterhin
   unabhaengig mit derselben 0,1%-Chance x Skilltree-Bonus) - statt eines
   Eis gibt es jetzt einen kleinen Fundschatz (Gold + Kristalle, nach
   Seltenheit der betroffenen Drachenart gestaffelt), damit der Kampf-Loop
   sich nicht "leerer" anfuehlt. */
function bkmpIdleMaybeDropTreasure(dragon) {
  if (!bkmpIdleState || !dragon || !dragon.id || !bkmpDragonSpeciesCatalog.length) return;
  const chanceMult = 1 + Math.min(100, bkmpDragonSkillBonus('egg_chance_pct')) / 100;
  bkmpDragonSpeciesCatalog
    .filter(sp => sp.egg_source === 'combat' && sp.source_dragon_id === dragon.id)
    .forEach(sp => {
      if (Math.random() >= Number(sp.egg_drop_chance || 0) * chanceMult) return;
      const rarityMult = sp.rarity === 'selten' ? 3 : 1;
      const gold = Math.round((bkmpIdleEffectiveStats ? bkmpIdleEffectiveStats.attack : 10) * 40 * rarityMult);
      const crystals = 2 * rarityMult;
      bkmpIdleState.gold = Number(bkmpIdleState.gold || 0) + gold;
      bkmpIdleState.total_gold_earned = Number(bkmpIdleState.total_gold_earned || 0) + gold;
      bkmpIdleState.crystals = Number(bkmpIdleState.crystals || 0) + crystals;
      bkmpIdleLog(`💰 Einen Fundschatz entdeckt! +${bkmpIdleFormatNumber(gold)} 💰 +${crystals} 💎`);
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`💰 Fundschatz entdeckt! +${bkmpIdleFormatNumber(gold)} 💰`, 3600);
    });
}

/* ---------------- Nester ---------------- */
function bkmpDragonNestCost(slotIndex) {
  const base = BKMP_DRAGON_NEST_GOLD_COSTS[slotIndex - 1] ?? (BKMP_DRAGON_NEST_GOLD_COSTS[BKMP_DRAGON_NEST_GOLD_COSTS.length - 1] * 4);
  const reductionPct = Math.min(40, bkmpDragonSkillBonus('nest_cost_pct'));
  return Math.round(base * (1 - reductionPct / 100));
}

/* Busy-Sperre (Perf-Audit 15.07.): ohne sie loeste ein schneller
   Doppelklick zwei parallele Kauf-Requests fuer denselben Nest-Slot aus,
   bevor der erste fertig war - der Server lehnt den zweiten zwar ab, aber
   der Nutzer bekam keinerlei Rueckmeldung, ob der Kauf nun geklappt hat. */
let bkmpDragonNestPurchaseBusy = false;
async function bkmpDragonPurchaseNest() {
  if (!bkmpIdleState || bkmpDragonNestPurchaseBusy) return;
  const nextSlot = bkmpPlayerDragonNests.length + 1;
  if (nextSlot > BKMP_DRAGON_NEST_GOLD_COSTS.length) return;
  const cost = bkmpDragonNestCost(nextSlot);
  if ((bkmpIdleState.gold || 0) < cost) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Nicht genug Gold für dieses Drachennest.', 2800);
    return;
  }
  bkmpDragonNestPurchaseBusy = true;
  try {
    const row = await purchaseDragonNestSlot(bkmpIdleState.name_key, nextSlot);
    if (!row) return;
    bkmpIdleState.gold -= cost;
    bkmpPlayerDragonNests.push(row);
    bkmpIdleRenderHud();
    bkmpIdleQueueSync();
    bkmpIdleRenderDragonsPanel();
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🏠 Neues Drachennest freigeschaltet!', 3000);
  } catch (e) {
    console.warn('Idle Dorf: Drachennest konnte nicht gekauft werden.', e);
  } finally {
    bkmpDragonNestPurchaseBusy = false;
  }
}

/* Legendaere Eier brauchen laut Vorgabe eine Opfergabe (Gold+Diamanten)
   VOR dem Ausbrueten - reduziert um den "zucht_opfergabe"-Skillknoten
   (sacrifice_cost_pct), gedeckelt bei 50% Ersparnis. */
function bkmpDragonSacrificeCost(species) {
  const reductionPct = Math.min(50, bkmpIdleSkillEffectTotals(bkmpIdleState ? bkmpIdleState.skill_allocations : null, bkmpIdleSkillDefs).sacrifice_cost_pct || 0);
  const mult = 1 - reductionPct / 100;
  return {
    gold: Math.round((species.sacrifice_gold || 0) * mult),
    crystals: Math.round((species.sacrifice_crystals || 0) * mult)
  };
}

async function bkmpDragonAssignEggToNest(nestId, eggId) {
  const egg = bkmpPlayerDragonEggs.find(e => e.id === eggId);
  const species = egg ? bkmpDragonSpeciesById(egg.species_id) : null;
  if (!species || !bkmpIdleState) return;
  const sacrifice = bkmpDragonSacrificeCost(species);
  if (sacrifice.gold > 0 || sacrifice.crystals > 0) {
    const parts = [];
    if (sacrifice.gold > 0) parts.push(`💰 ${bkmpIdleFormatNumber(sacrifice.gold)} Gold`);
    if (sacrifice.crystals > 0) parts.push(`💎 ${bkmpIdleFormatNumber(sacrifice.crystals)} Diamanten`);
    const body = `${species.name} ist ein legendäres Ei und verlangt eine Opfergabe, bevor die Brut beginnen kann:\n${parts.join(' + ')}`;
    const confirmed = typeof bkmpConfirmDialog === 'function'
      ? await bkmpConfirmDialog('🐲 Opfergabe erforderlich', body, 'Opfern und ausbrüten', 'Abbrechen')
      : window.confirm(body);
    if (!confirmed) return;
    if ((bkmpIdleState.gold || 0) < sacrifice.gold || (bkmpIdleState.crystals || 0) < sacrifice.crystals) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Nicht genug Gold/Diamanten für die Opfergabe.', 3000);
      return;
    }
  }
  try {
    const ok = await assignEggToDragonNest(nestId, eggId);
    if (!ok) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Dieses Nest ist gerade nicht mehr frei.', 2600);
      return;
    }
    if (sacrifice.gold > 0 || sacrifice.crystals > 0) {
      bkmpIdleState.gold -= sacrifice.gold;
      bkmpIdleState.crystals -= sacrifice.crystals;
      bkmpIdleRenderHud();
      bkmpIdleQueueSync();
    }
    const nest = bkmpPlayerDragonNests.find(n => n.id === nestId);
    if (nest) { nest.egg_id = eggId; nest.started_at = new Date().toISOString(); }
    bkmpIdleRenderDragonsPanel();
  } catch (e) {
    console.warn('Idle Dorf: Ei konnte nicht ins Nest gelegt werden.', e);
  }
}

/* Brut-Pfad: Reduktion gedeckelt bei 40% (Vorgabe: "Brutzeit darf niemals
   auf null reduziert werden... zentrale maximale Reduzierung"). */
function bkmpDragonEffectiveBroodSeconds(species) {
  const reductionPct = Math.min(40, bkmpDragonSkillBonus('brood_time_pct'));
  return species.brood_seconds * (1 - reductionPct / 100);
}
function bkmpDragonNestReady(nest) {
  if (!nest || !nest.egg_id || !nest.started_at) return false;
  const egg = bkmpPlayerDragonEggs.find(e => e.id === nest.egg_id);
  const species = egg ? bkmpDragonSpeciesById(egg.species_id) : null;
  if (!species) return false;
  return Date.now() >= Date.parse(nest.started_at) + bkmpDragonEffectiveBroodSeconds(species) * 1000;
}

/* Busy-Sperre pro Nest-ID (Perf-Audit 15.07.), analog zu
   bkmpDragonNestPurchaseBusy - verhindert zwei parallele hatchDragonEgg-
   Aufrufe fuer dasselbe Nest bei schnellem Doppelklick. */
const bkmpDragonHatchBusyNestIds = new Set();
async function bkmpDragonHatch(nestId) {
  if (bkmpDragonHatchBusyNestIds.has(nestId)) return;
  const nest = bkmpPlayerDragonNests.find(n => n.id === nestId);
  if (!nest || !bkmpDragonNestReady(nest)) return;
  const egg = bkmpPlayerDragonEggs.find(e => e.id === nest.egg_id);
  if (!egg) return;
  /* Lagerplatz-Check VOR dem Ausbrueten (Spieler-Vorgabe: "das Ausbrueten
     eines neuen Eis darf nur gestartet werden, wenn sichergestellt ist,
     dass der fertige Drache gespeichert werden kann" - der geschluepfte
     Drache bleibt bei vollem Lager also einfach im Nest liegen, statt
     verloren zu gehen). */
  if (bkmpPlayerDragons.length >= bkmpDragonStorageCapacity()) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🏠 Dein Drachenlager ist voll. Erweitere dein Lager oder lasse einen Drachen frei.', 4200);
    return;
  }
  const foodPreference = Math.random() < 0.5 ? 'fruit' : 'meat';
  bkmpDragonHatchBusyNestIds.add(nestId);
  try {
    const dragon = await hatchDragonEgg(nest.id, egg.id, bkmpIdleState.name_key, egg.species_id, foodPreference);
    if (!dragon) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Dieses Ei wurde bereits geöffnet.', 2600);
      return;
    }
    nest.egg_id = null;
    nest.started_at = null;
    bkmpPlayerDragonEggs = bkmpPlayerDragonEggs.filter(e => e.id !== egg.id);
    bkmpPlayerDragons.push(dragon);
    const species = bkmpDragonSpeciesById(egg.species_id);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🐣 Dein ${species ? species.name : 'Drache'} ist geschlüpft!`, 4200);
    bkmpIdleGetAchievementContextFields();
    bkmpIdleRenderDragonsPanel();
  } catch (e) {
    console.warn('Idle Dorf: Ei konnte nicht ausgebrütet werden.', e);
  } finally {
    bkmpDragonHatchBusyNestIds.delete(nestId);
  }
}

/* ---------------- Drachenlager (Kapazitaet) ---------------- */
const BKMP_DRAGON_STORAGE_BASE = 20;
const BKMP_DRAGON_STORAGE_EXPANSIONS = [
  { addSlots: 5, cost: 50000 },
  { addSlots: 5, cost: 150000 },
  { addSlots: 10, cost: 400000 },
  { addSlots: 10, cost: 1000000 },
  { addSlots: 15, cost: 2500000 }
];
function bkmpDragonStorageExpansionsBought() {
  try { return Number(localStorage.getItem('bkmp-dragon-storage-expansions') || 0); } catch (e) { return 0; }
}
function bkmpDragonStorageCapacity() {
  const bought = bkmpDragonStorageExpansionsBought();
  let cap = BKMP_DRAGON_STORAGE_BASE;
  for (let i = 0; i < bought && i < BKMP_DRAGON_STORAGE_EXPANSIONS.length; i++) cap += BKMP_DRAGON_STORAGE_EXPANSIONS[i].addSlots;
  return cap + Math.round(bkmpDragonSkillBonus('dragon_storage_flat'));
}
function bkmpDragonExpandStorage() {
  const bought = bkmpDragonStorageExpansionsBought();
  const next = BKMP_DRAGON_STORAGE_EXPANSIONS[bought];
  if (!next || !bkmpIdleState) return;
  if ((bkmpIdleState.gold || 0) < next.cost) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Nicht genug Gold für diese Lagererweiterung.', 2800);
    return;
  }
  bkmpIdleState.gold -= next.cost;
  try { localStorage.setItem('bkmp-dragon-storage-expansions', String(bought + 1)); } catch (e) {}
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
  bkmpIdleRenderDragonsPanel();
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🏠 Drachenlager um ${next.addSlots} Plätze erweitert!`, 3000);
}

/* ---------------- Fuettern + Wachstum (Baby -> Jugendlich) ---------------- */
async function bkmpDragonFeed(dragonId, amount) {
  const dragon = bkmpPlayerDragons.find(d => d.id === dragonId);
  const species = dragon ? bkmpDragonSpeciesById(dragon.species_id) : null;
  if (!dragon || !species || dragon.stage !== 'baby') return;
  const stock = Number(bkmpIdleState[dragon.food_preference] || 0);
  const feedAmount = Math.min(amount, stock, species.growth_points_required - dragon.growth_points);
  if (feedAmount <= 0) return;
  bkmpIdleState[dragon.food_preference] -= feedAmount;
  dragon.growth_points = Math.min(species.growth_points_required, dragon.growth_points + feedAmount);
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
  try { await updatePlayerDragon(dragonId, { growth_points: dragon.growth_points }); } catch (e) { console.warn('Idle Dorf: Fuetterung konnte nicht gespeichert werden.', e); }
  bkmpIdleRenderDragonsPanel();
}

async function bkmpDragonEvolveToTeen(dragonId) {
  const dragon = bkmpPlayerDragons.find(d => d.id === dragonId);
  const species = dragon ? bkmpDragonSpeciesById(dragon.species_id) : null;
  if (!dragon || !species || dragon.stage !== 'baby' || dragon.growth_points < species.growth_points_required) return;
  dragon.stage = 'teen';
  try { await updatePlayerDragon(dragonId, { stage: 'teen' }); } catch (e) { console.warn('Idle Dorf: Entwicklung konnte nicht gespeichert werden.', e); }
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🐉 ${species.name} ist jetzt jugendlich!`, 3600);
  bkmpIdleRenderDragonsPanel();
}

/* ---------------- Begleiter + Kampferfahrung (Jugendlich -> Erwachsen) ---------------- */
async function bkmpDragonSetCompanion(dragonId) {
  const current = bkmpPlayerDragons.find(d => d.is_companion);
  if (current && current.id === dragonId) return;
  try {
    if (current) { current.is_companion = false; await updatePlayerDragon(current.id, { is_companion: false }); }
    const dragon = bkmpPlayerDragons.find(d => d.id === dragonId);
    if (dragon && (dragon.stage === 'teen' || dragon.stage === 'adult')) {
      dragon.is_companion = true;
      await updatePlayerDragon(dragon.id, { is_companion: true });
    }
    bkmpIdleRecomputeEffectiveStats();
    bkmpIdleRenderHud();
    bkmpIdleRenderDragonsPanel();
  } catch (e) {
    console.warn('Idle Dorf: Begleitdrache konnte nicht gesetzt werden.', e);
  }
}

async function bkmpDragonUnsetCompanion() {
  const current = bkmpPlayerDragons.find(d => d.is_companion);
  if (!current) return;
  current.is_companion = false;
  try { await updatePlayerDragon(current.id, { is_companion: false }); } catch (e) {}
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderHud();
  bkmpIdleRenderDragonsPanel();
}

/* Von den Kampf-/Dungeon-/Raid-/Gildenboss-Erfolgsstellen aufgerufen -
   vergibt Kampf-EP NUR an den aktuell aktiven jugendlichen Begleiter. Ein
   erwachsener Begleiter braucht keine EP mehr (schon voll entwickelt),
   sammelt aber weiterhin keine (bewusst kein Extra-Fortschritt danach). */
let bkmpDragonEvolveReadyToastShown = {};
function bkmpDragonGrantCompanionBattleXp(amount) {
  if (!amount || amount <= 0) return;
  const dragon = bkmpPlayerDragons.find(d => d.is_companion && d.stage === 'teen');
  if (!dragon) return;
  const species = bkmpDragonSpeciesById(dragon.species_id);
  if (!species) return;
  const bonusPct = bkmpDragonSubstatBonus('dragon_xp_bonus_pct') + bkmpDragonSkillBonus('dragon_xp_pct');
  const gained = Math.round(amount * (1 + bonusPct / 100));
  dragon.battle_xp = Math.min(species.battle_xp_required, dragon.battle_xp + gained);
  updatePlayerDragon(dragon.id, { battle_xp: dragon.battle_xp }).catch(() => {});
  if (dragon.battle_xp >= species.battle_xp_required && !bkmpDragonEvolveReadyToastShown[dragon.id]) {
    bkmpDragonEvolveReadyToastShown[dragon.id] = true;
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`⭐ Dein ${species.name} ist bereit, erwachsen zu werden! Schau im Drachenlager vorbei.`, 5000);
  }
  if (typeof bkmpIdleRefreshLiveTabs === 'function') bkmpIdleRefreshLiveTabs();
}

/* Nebenwert-Bonus eines aktiven erwachsenen Begleiters fuer NICHT im
   allgemeinen Stat-Topf gefuehrte Schluessel (Fruechte/Fleisch/Drachen-EP) -
   die anderen 8 Sub-Stat-Typen laufen stattdessen ganz normal durch
   bkmpIdleDragonCompanionEffectTotals()/t() wie Runen-Sub-Stats. */
function bkmpDragonSubstatBonus(key) {
  const dragon = bkmpPlayerDragons.find(d => d.is_companion && d.stage === 'adult');
  if (!dragon) return 0;
  const entry = (dragon.substats || []).find(s => s.stat === key);
  return entry ? Number(entry.value || 0) : 0;
}

/* Einmalige Wuerfelung beim Erreichen der Erwachsenenform - exakt wie bei
   Runen (bkmpIdleRollRuneValue/bkmpIdleRollInitialSubstats): Legendaer
   bekommt ALLE drei Hauptwerte gleichzeitig, alle anderen genau einen
   zufaellig gewaehlten. Werte danach dauerhaft in der DB-Zeile gespeichert,
   ein Neuladen wuerfelt nie erneut (siehe hatchDragonEgg/updatePlayerDragon -
   hier wird nur EINMAL beim Uebergang geschrieben). */
function bkmpIdleRollAdultDragonStats(species) {
  const mult = BKMP_DRAGON_RARITY_MULT[species.rarity] || 1;
  const rollStat = key => {
    const base = BKMP_DRAGON_MAIN_STAT_BASE[key] || 5;
    const variance = 0.75 + Math.random() * 0.7; // 0.75x - 1.45x
    return Math.round(base * mult * variance * 10) / 10;
  };
  const stats = { stat_attack: 0, stat_defense: 0, stat_hp: 0 };
  let mainStatKey;
  if (species.is_multi_stat) {
    stats.stat_attack = rollStat('attack');
    stats.stat_defense = rollStat('defense');
    stats.stat_hp = rollStat('hp');
    mainStatKey = 'multi';
  } else {
    mainStatKey = BKMP_DRAGON_MAIN_STAT_KEYS[Math.floor(Math.random() * BKMP_DRAGON_MAIN_STAT_KEYS.length)];
    stats['stat_' + mainStatKey] = rollStat(mainStatKey);
  }
  const subCount = species.sub_stat_count_min + Math.floor(Math.random() * (species.sub_stat_count_max - species.sub_stat_count_min + 1));
  const pool = BKMP_DRAGON_SUBSTAT_POOL.slice();
  const substats = [];
  for (let i = 0; i < subCount && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const def = pool.splice(idx, 1)[0];
    const value = Math.round((def.min + Math.random() * (def.max - def.min)) * mult * 10) / 10;
    substats.push({ stat: def.key, value });
  }
  return { main_stat_key: mainStatKey, substats, ...stats };
}

async function bkmpDragonEvolveToAdult(dragonId) {
  const dragon = bkmpPlayerDragons.find(d => d.id === dragonId);
  const species = dragon ? bkmpDragonSpeciesById(dragon.species_id) : null;
  if (!dragon || !species || dragon.stage !== 'teen' || dragon.battle_xp < species.battle_xp_required) return;
  const rolled = bkmpIdleRollAdultDragonStats(species);
  const patch = { stage: 'adult', adult_at: new Date().toISOString(), ...rolled };
  try {
    await updatePlayerDragon(dragonId, patch);
    Object.assign(dragon, patch);
    delete bkmpDragonEvolveReadyToastShown[dragonId];
    bkmpIdleRecomputeEffectiveStats();
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`👑 Dein ${species.name} ist erwachsen geworden!`, 4400);
    bkmpIdleGetAchievementContextFields();
    bkmpIdleRenderDragonsPanel();
  } catch (e) {
    console.warn('Idle Dorf: Entwicklung zum erwachsenen Drachen konnte nicht gespeichert werden.', e);
  }
}

/* ---------------- Freilassen ---------------- */
async function bkmpDragonRelease(dragonId) {
  const dragon = bkmpPlayerDragons.find(d => d.id === dragonId);
  if (!dragon) return;
  if (dragon.is_favorite) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Entferne zuerst die Favoriten-Markierung.', 2800);
    return;
  }
  if (dragon.is_companion) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Entferne den Drachen zuerst als Begleiter.', 2800);
    return;
  }
  try {
    await releasePlayerDragon(dragonId);
    bkmpPlayerDragons = bkmpPlayerDragons.filter(d => d.id !== dragonId);
    /* Kleine Trostbelohnung (Spieler-Vorgabe) - bewusst niedrig, damit sich
       gezieltes Farmen+Freilassen nicht lohnt. */
    if (bkmpIdleState) { bkmpIdleState.gold = (bkmpIdleState.gold || 0) + 500; bkmpIdleQueueSync(); bkmpIdleRenderHud(); }
    bkmpIdleRenderDragonsPanel();
  } catch (e) {
    console.warn('Idle Dorf: Drache konnte nicht freigelassen werden.', e);
  }
}

async function bkmpDragonToggleFavorite(dragonId) {
  const dragon = bkmpPlayerDragons.find(d => d.id === dragonId);
  if (!dragon) return;
  dragon.is_favorite = !dragon.is_favorite;
  try { await updatePlayerDragon(dragonId, { is_favorite: dragon.is_favorite }); } catch (e) {}
  bkmpIdleRenderDragonsPanel();
}

/* Legendaeren-Aufstieg (Lategame-Content, Spieler-Vorgabe 16.07.):
   Zerathor/Yakshadrache droppen ohne Besitz-Limit (siehe raid_finish, 1%
   Chance pro Weltboss-Sieg, unabhaengig davon wie viele man schon hat) -
   Dubletten waren bisher reiner Ballast, nur zum Freilassen fuer eine
   kleine Trostbelohnung gut. Exakt dasselbe Prinzip wie der bestehende
   Runen-Aufstieg (BKMP_RUNE_ASCEND_MAX_LEVEL, siehe bkmpRuneAscend): eine
   zweite Legendaere DERSELBEN Art wird komplett verbraucht (Fodder), die
   behaltene steigt eine Stufe. Bewusst OHNE Fehlschlagchance (der Preis ist
   bereits eine ganze zweite Legendaere plus Gold) und mit niedrigem Deckel
   (5 Stufen) - das soll ein spuerbarer Bonus fuer Vielspieler sein, kein
   neuer unbegrenzter Powercreep-Weg. */
const BKMP_DRAGON_ASCEND_MAX_LEVEL = 5;
const BKMP_DRAGON_ASCEND_BONUS_PCT = 10;
const BKMP_DRAGON_ASCEND_COST_GOLD = 150000;
function bkmpDragonAscendedMainStat(dragon, rawValue) {
  const level = Number(dragon.ascension_level || 0);
  return Math.round(Number(rawValue || 0) * (1 + level * BKMP_DRAGON_ASCEND_BONUS_PCT / 100) * 10) / 10;
}
function bkmpDragonCanAscend(dragon) {
  const species = bkmpDragonSpeciesById(dragon.species_id);
  return Boolean(species) && species.rarity === 'legendaer' && dragon.stage === 'adult' && Number(dragon.ascension_level || 0) < BKMP_DRAGON_ASCEND_MAX_LEVEL;
}
function bkmpDragonFindAscendFodder(dragon) {
  return bkmpPlayerDragons.find(d => d.id !== dragon.id && d.species_id === dragon.species_id && d.stage === 'adult' && !d.is_favorite && !d.is_companion);
}
async function bkmpDragonAscend(dragonId) {
  const dragon = bkmpPlayerDragons.find(d => d.id === dragonId);
  if (!dragon || !bkmpIdleState || !bkmpDragonCanAscend(dragon)) return;
  const species = bkmpDragonSpeciesById(dragon.species_id);
  const fodder = bkmpDragonFindAscendFodder(dragon);
  if (!fodder) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🐉 Du brauchst eine zweite erwachsene ${species.name} (nicht favorisiert, nicht als Begleiter aktiv) als Opfer.`, 3800);
    return;
  }
  if ((bkmpIdleState.gold || 0) < BKMP_DRAGON_ASCEND_COST_GOLD) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`💰 Nicht genug Gold für den Aufstieg (${bkmpIdleFormatNumber(BKMP_DRAGON_ASCEND_COST_GOLD)} nötig).`, 3200);
    return;
  }
  try {
    await releasePlayerDragon(fodder.id);
    bkmpPlayerDragons = bkmpPlayerDragons.filter(d => d.id !== fodder.id);
    bkmpIdleState.gold -= BKMP_DRAGON_ASCEND_COST_GOLD;
    dragon.ascension_level = Number(dragon.ascension_level || 0) + 1;
    await updatePlayerDragon(dragonId, { ascension_level: dragon.ascension_level });
    bkmpIdleRecomputeEffectiveStats();
    bkmpIdleRenderHud();
    bkmpIdleQueueSync();
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🌟 ${species.name} auf Aufstiegsstufe ${dragon.ascension_level}/${BKMP_DRAGON_ASCEND_MAX_LEVEL}!`, 3800);
    bkmpIdleRenderDragonsPanel();
  } catch (e) {
    console.warn('Idle Dorf: Drache konnte nicht aufgestiegen werden.', e);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Aufstieg fehlgeschlagen. Bitte versuche es erneut.', 3200);
  }
}

/* ---------------- Obstgarten/Jagdhuette: passive Produktion ----------------
   Bewusst einfache zeitbasierte Ansammlung statt einer dedizierten
   Gebaeude-UI/Upgrade-Kette (die folgt spaeter) - jeder Spieler hat schon
   ab Level 0 eine kleine Grundproduktion, damit Fuettern sofort spielbar
   ist; obstgarten_level/jagdhuette_level (schon in idle_player_state,
   Standardwert 0) erhoehen die Rate spaeter ohne weitere Migration. */
const BKMP_DRAGON_BASE_RESOURCE_PER_HOUR = 60;
const BKMP_DRAGON_RESOURCE_CAP_BASE = 2000;
const BKMP_DRAGON_BUILDING_MAX_LEVEL = 30;
function bkmpDragonResourceRatePerHour(kind, level) {
  const companionBonusPct = bkmpDragonSubstatBonus(kind === 'fruit' ? 'fruit_bonus_pct' : 'meat_bonus_pct');
  const skillBonusPct = bkmpDragonSkillBonus(kind === 'fruit' ? 'fruit_prod_pct' : 'meat_prod_pct');
  /* Spieler-Vorgabe 17.07. nachts ("Spätere Prestige-Stufen erhöhen
     zusätzlich sämtliche Produktionsgebäude prozentual"): Obstgarten/
     Jagdhütte zaehlen als Produktionsgebaeude genau wie die neuen 6
     (siehe bkmpIdleBuildingPrestigeBonusPct weiter unten), deshalb hier
     mit-nachgezogen statt nur bei den neuen Gebaeuden. */
  const prestigeBonusPct = typeof bkmpIdleBuildingPrestigeBonusPct === 'function' ? bkmpIdleBuildingPrestigeBonusPct() : 0;
  return BKMP_DRAGON_BASE_RESOURCE_PER_HOUR * (1 + Number(level || 0) * 0.5) * (1 + (companionBonusPct + skillBonusPct + prestigeBonusPct) / 100);
}
function bkmpDragonResourceCap(level) {
  return BKMP_DRAGON_RESOURCE_CAP_BASE + Number(level || 0) * 500;
}
/* Obstgarten/Jagdhuette - eigene, dedizierte Spalten (obstgarten_level/
   jagdhuette_level) statt des generischen upgrade_purchases-Systems, weil
   ihr Effekt (Produktionsrate/Lagerkapazitaet) kein Kampf-Stat ist und
   nicht in den gemeinsamen t()-Topf gehoert. Kostenkurve nutzt trotzdem
   dieselbe bkmpIdleGrowthMult-Formel wie alle anderen Upgrades. */
function bkmpDragonBuildingCost(level) {
  return Math.round(2000 * bkmpIdleGrowthMult(0.28, 2.1, level));
}
async function bkmpDragonUpgradeBuilding(kind) {
  if (!bkmpIdleState) return;
  const levelKey = kind === 'fruit' ? 'obstgarten_level' : 'jagdhuette_level';
  const level = Number(bkmpIdleState[levelKey] || 0);
  if (level >= BKMP_DRAGON_BUILDING_MAX_LEVEL) return;
  const cost = bkmpDragonBuildingCost(level);
  if ((bkmpIdleState.gold || 0) < cost) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Nicht genug Gold für dieses Gebäude-Upgrade.', 2800);
    return;
  }
  bkmpIdleState.gold -= cost;
  bkmpIdleState[levelKey] = level + 1;
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
  if (typeof bkmpIdleRenderUpgradesPanel === 'function') bkmpIdleRenderUpgradesPanel();
  if (typeof bkmpIdleRenderDragonsPanel === 'function') bkmpIdleRenderDragonsPanel();
}
/* Balance-Audit-Fix (16.07.): passive Gebaeude-Produktion (hier und bei
   BKMP_IDLE_PRODUCTION_BUILDINGS unten) lief bisher komplett ungedeckelt -
   anders als der Kampf-Offline-Fortschritt (server-seitig auf 12h begrenzt,
   siehe api/claim-idle-offline-progress.js) konnte hier "Zeit seit letztem
   Abholen" beliebig gross werden (ein simpler Systemuhr-Trick, aber auch
   einfach ein Spieler, der zwei Monate nicht reinschaut, haette bei der
   Rueckkehr einen einzigen Ressourcen-Batzen bekommen, der jede normale
   Progression sprengt). 72h (3 Tage) statt der knapperen 12h beim Kampf,
   weil "auch offline produzieren" hier explizit das beworbene Feature ist
   (nicht nur eine Kulanz-Regelung) - im Unterschied zum Kampfsystem gibt es
   bewusst KEINEN Effizienz-Abschlag (waere ein Bruch mit genau diesem
   Verkaufsversprechen), nur eine Obergrenze fuer die anrechenbare Zeit.
   Ungenutzte Zeit darueber hinaus verfaellt (kein Nachtrag beim naechsten
   Besuch), _collected_at wird trotzdem auf "jetzt" gesetzt. */
const BKMP_IDLE_PRODUCTION_MAX_OFFLINE_HOURS = 72;
function bkmpIdleAccrueBuildingResources() {
  if (!bkmpIdleState) return;
  const now = Date.now();
  ['fruit', 'meat'].forEach(kind => {
    const levelKey = kind === 'fruit' ? 'obstgarten_level' : 'jagdhuette_level';
    const tsKey = kind + '_collected_at';
    const last = Date.parse(bkmpIdleState[tsKey] || now) || now;
    const hoursElapsed = Math.min(BKMP_IDLE_PRODUCTION_MAX_OFFLINE_HOURS, Math.max(0, (now - last) / 3600000));
    if (hoursElapsed <= 0) return;
    const gained = hoursElapsed * bkmpDragonResourceRatePerHour(kind, bkmpIdleState[levelKey]);
    /* Bug-Report 17.07. (ChronoKora): "Speichern schlaegt IMMER fehl" -
       Root Cause per Live-DB-Payload gefunden: fruit/meat sind bigint-
       Spalten, gained war aber nie gerundet (hoursElapsed ist ein echter
       Bruchteil einer Stunde) - JEDER Aufruf dieser Funktion (bei jedem
       Rendern des Drachenzucht-Tabs) machte fruit/meat krumm und damit
       JEDEN nachfolgenden Speicherversuch fuer den KOMPLETTEN Spielstand
       kaputt (Postgres: "invalid input syntax for type bigint"), nicht nur
       fuer diese beiden Felder. Math.floor statt round, damit die Obergrenze
       (Cap) nie durch Aufrunden ueberschritten wird. */
    bkmpIdleState[kind] = Math.floor(Math.min(bkmpDragonResourceCap(bkmpIdleState[levelKey]), Number(bkmpIdleState[kind] || 0) + gained));
    bkmpIdleState[tsKey] = new Date(now).toISOString();
  });
}

/* ---------------- Produktionsgebäude (Spieler-Vorgabe 17.07. nachts) ----------------
   6 neue dauerhaft-produzierende Gebäude fürs Upgrade-Menü - gleiches
   Muster wie Obstgarten/Jagdhütte oben (eigene Level-Spalte + eigene
   _collected_at-Spalte pro Gebäude, zeitbasierte Ansammlung statt
   Tick-Loop, damit Offline-Produktion "gratis" funktioniert), aber
   data-driven als EIN Array statt 6 einzelner Funktionspaare, weil sich
   nur Zahlenwerte (nicht die Mechanik) zwischen den Gebäuden unterscheiden.
   Kostenkurve pro Gebäude bewusst unterschiedlich (Spieler-Vorgabe:
   "unterschiedliche Kostenkurven, sodass nicht alle gleichzeitig
   maximiert werden können") - alle kosten Gold (wie Obstgarten/Jagdhütte),
   da es im ganzen Spiel noch keinen Mehrfach-Ressourcen-Kaufpreis gibt und
   das hier nicht neu erfunden werden soll. Gold/Holz/Stein/Kristalle/Essenz
   haben bewusst KEINEN Lager-Deckel (im Gegensatz zu Obstgarten/Jagdhütte)
   - sie fliessen in dieselben bereits heute ungedeckelten Konten wie
   Kampf-Beute. */
const BKMP_IDLE_PRODUCTION_BUILDINGS = [
  { id: 'holzfaeller', name: 'Holzfällerlager', icon: '🪓', resource: 'wood', levelKey: 'holzfaeller_level', tsKey: 'holzfaeller_collected_at', baseCost: 800, costRate: 0.25, costExponent: 2.0, baseRate: 60, rateCoef: 0.5, unit: 'Holz/Std.', desc: 'Produziert Holz pro Stunde, auch offline. Holz wird für spätere Gebäude und Upgrades benötigt.' },
  { id: 'steinbruch', name: 'Steinbruch', icon: '⛏️', resource: 'stone', levelKey: 'steinbruch_level', tsKey: 'steinbruch_collected_at', baseCost: 800, costRate: 0.25, costExponent: 2.0, baseRate: 60, rateCoef: 0.5, unit: 'Stein/Std.', desc: 'Produziert Stein pro Stunde, auch offline. Wird für Verteidigungsgebäude und Mauern verwendet.' },
  { id: 'goldmine', name: 'Goldmine', icon: '🥇', resource: 'gold', levelKey: 'goldmine_level', tsKey: 'goldmine_collected_at', baseCost: 3000, costRate: 0.30, costExponent: 2.15, baseRate: 400, rateCoef: 0.8, unit: 'Gold/Std.', desc: 'Produziert Gold pro Stunde - hohe Level steigern die Goldproduktion massiv.' },
  { id: 'kristallmine', name: 'Kristallmine', icon: '💎', resource: 'crystals', levelKey: 'kristallmine_level', tsKey: 'kristallmine_collected_at', baseCost: 6000, costRate: 0.32, costExponent: 2.2, baseRate: 3, rateCoef: 0.4, unit: 'Kristalle/Std.', desc: 'Produziert Kristalle pro Stunde - seltene Ressource für hochwertige Upgrades.' },
  /* Spieler-Korrektur 18.07.: "Manaquelle" ist KEINE neue Ressource,
     sondern produziert die bereits bestehende Essenz (dasselbe Fläschchen-
     Icon 🧪, das essence im Rest des Spiels schon hat) - kein neues
     mana-Feld mehr im Einsatz (die DB-Spalte bleibt inert bestehen, siehe
     supabase-idle-production-buildings.sql, wird aber nirgends mehr
     befuellt). */
  { id: 'manaquelle', name: 'Manaquelle', icon: '🧪', resource: 'essence', levelKey: 'manaquelle_level', tsKey: 'manaquelle_collected_at', baseCost: 10000, costRate: 0.34, costExponent: 2.25, baseRate: 4, rateCoef: 0.4, unit: 'Essenz/Std.', desc: 'Produziert Essenz pro Stunde, auch offline.' },
  { id: 'magierakademie', name: 'Magierakademie', icon: '🧙', resource: 'xp', levelKey: 'magierakademie_level', tsKey: 'magierakademie_collected_at', baseCost: 5000, costRate: 0.30, costExponent: 2.15, baseRate: 50, rateCoef: 0.5, unit: 'EXP/Std.', desc: 'Produziert Spieler-EXP pro Stunde, auch offline.' }
];
const BKMP_IDLE_PRODUCTION_BUILDING_MAX_LEVEL = 30;

/* Flacher Bonus pro Prestige-STUFE (nicht Prestige-Baumrang) - dieselbe
   Formel wie prestigeLevelBonusPct in bkmpIdleRecomputeEffectiveStats
   (+5%/Stufe), hier als eigene Funktion, damit sowohl die neuen Gebäude
   als auch (siehe Retrofit oben) Obstgarten/Jagdhütte sie lesen können,
   ohne von der Kampf-Stat-Berechnung abzuhängen. */
function bkmpIdleBuildingPrestigeBonusPct() {
  return bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) * 5 : 0;
}
function bkmpIdleProductionBuildingRatePerHour(def, level) {
  const prestigeBonusPct = bkmpIdleBuildingPrestigeBonusPct();
  return def.baseRate * (1 + Number(level || 0) * def.rateCoef) * (1 + prestigeBonusPct / 100);
}
function bkmpIdleProductionBuildingCost(def, level) {
  return Math.round(def.baseCost * bkmpIdleGrowthMult(def.costRate, def.costExponent, level));
}
function bkmpIdleAccrueProductionBuildings() {
  if (!bkmpIdleState) return;
  const now = Date.now();
  BKMP_IDLE_PRODUCTION_BUILDINGS.forEach(def => {
    const level = Number(bkmpIdleState[def.levelKey] || 0);
    const last = Date.parse(bkmpIdleState[def.tsKey] || now) || now;
    const hoursElapsed = Math.min(BKMP_IDLE_PRODUCTION_MAX_OFFLINE_HOURS, Math.max(0, (now - last) / 3600000));
    if (hoursElapsed <= 0) return;
    const gained = hoursElapsed * bkmpIdleProductionBuildingRatePerHour(def, level);
    if (def.resource === 'xp') {
      if (gained >= 1) bkmpIdleAddXp(Math.floor(gained));
    } else {
      /* Math.floor wie bei fruit/meat oben - gold/wood/stone/crystals/essence
         sind ebenfalls bigint-Spalten, ein Bruchteil wuerde denselben
         "kompletter Speicherversuch schlaegt fehl"-Bug ausloesen (siehe
         Kommentar bei bkmpIdleAccrueBuildingResources). */
      bkmpIdleState[def.resource] = Math.floor(Number(bkmpIdleState[def.resource] || 0) + gained);
      if (def.resource === 'gold') bkmpIdleState.total_gold_earned = Number(bkmpIdleState.total_gold_earned || 0) + Math.floor(gained);
    }
    bkmpIdleState[def.tsKey] = new Date(now).toISOString();
  });
}
function bkmpIdleBuyProductionBuilding(id) {
  const def = BKMP_IDLE_PRODUCTION_BUILDINGS.find(d => d.id === id);
  if (!def || !bkmpIdleState) return;
  const level = Number(bkmpIdleState[def.levelKey] || 0);
  if (level >= BKMP_IDLE_PRODUCTION_BUILDING_MAX_LEVEL) return;
  const cost = bkmpIdleProductionBuildingCost(def, level);
  if ((bkmpIdleState.gold || 0) < cost) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Nicht genug Gold für dieses Gebäude-Upgrade.', 2800);
    return;
  }
  bkmpIdleState.gold -= cost;
  bkmpIdleState[def.levelKey] = level + 1;
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
  if (typeof bkmpIdleRenderUpgradesPanel === 'function') bkmpIdleRenderUpgradesPanel();
}

/* ---------------- Effekt-Totals fuer bkmpIdleRecomputeEffectiveStats ---------------- */
function bkmpIdleDragonCompanionEffectTotals() {
  const totals = {};
  const dragon = bkmpPlayerDragons.find(d => d.is_companion && d.stage === 'adult');
  if (!dragon) return totals;
  if (dragon.stat_attack) totals.attack_flat = (totals.attack_flat || 0) + bkmpDragonAscendedMainStat(dragon, dragon.stat_attack);
  if (dragon.stat_defense) totals.defense_flat = (totals.defense_flat || 0) + bkmpDragonAscendedMainStat(dragon, dragon.stat_defense);
  if (dragon.stat_hp) totals.hp_flat = (totals.hp_flat || 0) + bkmpDragonAscendedMainStat(dragon, dragon.stat_hp);
  (dragon.substats || []).forEach(s => {
    if (['fruit_bonus_pct', 'meat_bonus_pct', 'dragon_xp_bonus_pct'].includes(s.stat)) return;
    totals[s.stat] = (totals[s.stat] || 0) + Number(s.value || 0);
  });
  return totals;
}

/* ---------------- Rendering ---------------- */
function bkmpDragonFormatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function bkmpDragonSubstatLabel(key) {
  const def = BKMP_DRAGON_SUBSTAT_POOL.find(d => d.key === key);
  return def ? def.label : key;
}
function bkmpDragonSubstatSuffix(key) {
  const def = BKMP_DRAGON_SUBSTAT_POOL.find(d => d.key === key);
  return def ? def.suffix : '';
}
function bkmpDragonMainStatLine(dragon) {
  const parts = [];
  if (dragon.stat_attack) parts.push(`⚔️ +${bkmpIdleFormatNumber(bkmpDragonAscendedMainStat(dragon, dragon.stat_attack))}`);
  if (dragon.stat_defense) parts.push(`🛡️ +${bkmpIdleFormatNumber(bkmpDragonAscendedMainStat(dragon, dragon.stat_defense))}`);
  if (dragon.stat_hp) parts.push(`❤️ +${bkmpIdleFormatNumber(bkmpDragonAscendedMainStat(dragon, dragon.stat_hp))}`);
  if (Number(dragon.ascension_level || 0) > 0) parts.push(`🌟+${dragon.ascension_level}`);
  return parts.join(' ');
}

function bkmpIdleRenderDragonsPanel() {
  const panel = document.getElementById('idlePanelDrachen');
  if (!panel || !bkmpIdleState) return;
  bkmpIdleAccrueBuildingResources();

  const unassignedEggs = bkmpPlayerDragonEggs.filter(e => !bkmpPlayerDragonNests.some(n => n.egg_id === e.id));
  const eggGroups = {};
  unassignedEggs.forEach(e => { eggGroups[e.species_id] = (eggGroups[e.species_id] || 0) + 1; });

  const eggsHtml = Object.keys(eggGroups).length
    ? `<div class="idle-skin-grid">${Object.keys(eggGroups).map(speciesId => {
        const species = bkmpDragonSpeciesById(speciesId);
        const eggId = unassignedEggs.find(e => e.species_id === speciesId).id;
        /* Bug-Fix (Spieler-Meldung 16.07., "neue Drachen-Eier werden nicht
           angezeigt"): fehlte die Spezies im gerade im Browser geladenen
           Katalog (z.B. eine neu hinzugekommene Art, bevor ein harter
           Reload den einmal pro Tab-Lebensdauer gecachten Katalog neu
           laedt - siehe window.__bkmpDragonSpeciesCache in
           bkmpIdleLoadDragonBreedingState), verschwand das Ei bisher
           KOMPLETT und kommentarlos aus dem Eierlager, obwohl die Zeile
           laengst in der Datenbank lag - fuer den Spieler ununterscheidbar
           von verlorener Beute. Zeigt jetzt einen Platzhalter statt gar
           nichts; "In Nest legen" bleibt moeglich (braucht nur die Ei-ID,
           keine Spezies-Metadaten). */
        if (!species) {
          return `
            <div class="idle-skin-card">
              <div class="idle-dragon-thumb idle-dragon-thumb-unknown">🥚</div>
              <div class="idle-skin-name">${escapeHtml(speciesId)}-Ei</div>
              <div class="idle-skin-desc">x${eggGroups[speciesId]} &middot; Art wird geladen - bitte Seite neu laden, falls das bestehen bleibt.</div>
              <button type="button" class="btn-ja idle-skin-action idle-dragon-assign-btn" data-egg-id="${eggId}">In freies Nest legen</button>
            </div>`;
        }
        const rarity = bkmpDragonRarityMeta(species.rarity);
        return `
          <div class="idle-skin-card" style="--dragon-rarity-color:${rarity.color}">
            <img class="idle-dragon-thumb" src="${species.egg_image}" alt="${escapeHtml(species.name)}">
            <div class="idle-skin-name">${escapeHtml(species.name)}-Ei</div>
            <div class="idle-skin-desc">${rarity.name} &middot; x${eggGroups[speciesId]} &middot; ${bkmpDragonFormatDuration(bkmpDragonEffectiveBroodSeconds(species) * 1000)} Brutzeit</div>
            <button type="button" class="btn-ja idle-skin-action idle-dragon-assign-btn" data-egg-id="${eggId}">In freies Nest legen</button>
          </div>`;
      }).join('')}</div>`
    : `<p class="idle-skin-empty-hint">Noch keine Eier im Lager - besiege Drachen, gewinne Weltboss-Raids oder finde besondere Ereignisse.</p>`;

  const nestsHtml = bkmpPlayerDragonNests.map(nest => {
    if (nest.egg_id) {
      const egg = bkmpPlayerDragonEggs.find(e => e.id === nest.egg_id);
      const species = egg ? bkmpDragonSpeciesById(egg.species_id) : null;
      if (!species) return `<div class="idle-dragon-nest-card"><div class="idle-skin-desc">Lädt…</div></div>`;
      const ready = bkmpDragonNestReady(nest);
      const msLeft = bkmpDragonEffectiveBroodSeconds(species) * 1000 - (Date.now() - Date.parse(nest.started_at));
      return `
        <div class="idle-dragon-nest-card ${ready ? 'is-ready' : ''}">
          <img class="idle-dragon-thumb" src="${bkmpDragonStageImage(species, ready ? 'egg' : 'egg')}" alt="${escapeHtml(species.name)}">
          <div class="idle-skin-name">${escapeHtml(species.name)}</div>
          ${ready
            ? `<button type="button" class="btn-ja idle-skin-action idle-dragon-hatch-btn" data-nest-id="${nest.id}">🐣 Drache ist geschlüpft!</button>`
            : `<div class="idle-skin-desc idle-dragon-nest-countdown" data-nest-id="${nest.id}">⏳ ${bkmpDragonFormatDuration(Math.max(0, msLeft))}</div>`}
        </div>`;
    }
    return `
      <div class="idle-dragon-nest-card idle-dragon-nest-empty">
        <div class="idle-skin-icon">🏠</div>
        <div class="idle-skin-desc">Nest ${nest.slot_index} · leer</div>
      </div>`;
  }).join('');
  const nextSlot = bkmpPlayerDragonNests.length + 1;
  const nestPurchaseHtml = nextSlot <= BKMP_DRAGON_NEST_GOLD_COSTS.length
    ? `<div class="idle-dragon-nest-card idle-dragon-nest-buy">
        <div class="idle-skin-icon">➕</div>
        <div class="idle-skin-desc">Nest ${nextSlot}</div>
        <button type="button" class="btn-ja idle-skin-action" id="idleDragonBuyNestBtn">${bkmpIdleFormatNumber(bkmpDragonNestCost(nextSlot))} 💰</button>
      </div>`
    : '';

  const babies = bkmpPlayerDragons.filter(d => d.stage === 'baby');
  const babiesHtml = babies.length
    ? babies.map(d => {
        const species = bkmpDragonSpeciesById(d.species_id);
        if (!species) return '';
        const pct = Math.min(100, Math.round((d.growth_points / species.growth_points_required) * 100));
        const foodLabel = d.food_preference === 'fruit' ? '🍎 Früchte' : '🥩 Fleisch';
        const canEvolve = d.growth_points >= species.growth_points_required;
        return `
          <div class="idle-dragon-baby-card">
            <img class="idle-dragon-thumb" src="${species.baby_image}" alt="${escapeHtml(species.name)}">
            <div class="idle-skin-name">${escapeHtml(species.name)} <small>(Baby)</small></div>
            <div class="idle-skin-desc">Frisst am liebsten: ${foodLabel} · Vorrat: ${bkmpIdleFormatNumber(Math.floor(bkmpIdleState[d.food_preference] || 0))}</div>
            <div class="idle-xp-bar"><div class="idle-xp-fill" style="width:${pct}%"></div><span>${d.growth_points}/${species.growth_points_required}</span></div>
            ${canEvolve
              ? `<button type="button" class="btn-ja idle-skin-action idle-dragon-evolve-teen-btn" data-dragon-id="${d.id}">Zum jugendlichen Drachen entwickeln</button>`
              : `<div class="idle-dragon-feed-row">
                  <button type="button" class="btn-ja idle-skin-action idle-dragon-feed-btn" data-dragon-id="${d.id}" data-amount="10">Füttern (+10)</button>
                  <button type="button" class="btn-nein idle-skin-action idle-dragon-feed-btn" data-dragon-id="${d.id}" data-amount="100">Füttern (+100)</button>
                </div>`}
          </div>`;
      }).join('')
    : '';

  let grown = bkmpPlayerDragons.filter(d => d.stage === 'teen' || d.stage === 'adult');
  const companion = bkmpPlayerDragons.find(d => d.is_companion);
  const grownTotalCount = grown.length;
  const RARITY_ORDER = ['legendaer', 'episch', 'selten', 'standard'];
  if (bkmpDragonLagerFilter.rarity !== 'all') {
    grown = grown.filter(d => {
      const sp = bkmpDragonSpeciesById(d.species_id);
      return sp && sp.rarity === bkmpDragonLagerFilter.rarity;
    });
  }
  if (bkmpDragonLagerFilter.stage !== 'all') grown = grown.filter(d => d.stage === bkmpDragonLagerFilter.stage);
  if (bkmpDragonLagerFilter.favoritesOnly) grown = grown.filter(d => d.is_favorite);
  const dragonStrength = d => Number(d.stat_attack || 0) + Number(d.stat_defense || 0) + Number(d.stat_hp || 0) / 10;
  grown = grown.slice().sort((a, b) => {
    const spA = bkmpDragonSpeciesById(a.species_id);
    const spB = bkmpDragonSpeciesById(b.species_id);
    switch (bkmpDragonLagerFilter.sort) {
      case 'name': return (spA ? spA.name : '').localeCompare(spB ? spB.name : '');
      case 'stage': return (b.stage === 'adult' ? 1 : 0) - (a.stage === 'adult' ? 1 : 0);
      case 'strength': return dragonStrength(b) - dragonStrength(a);
      case 'date': return Date.parse(b.hatched_at || 0) - Date.parse(a.hatched_at || 0);
      case 'rarity':
      default:
        return RARITY_ORDER.indexOf(spA ? spA.rarity : 'standard') - RARITY_ORDER.indexOf(spB ? spB.rarity : 'standard');
    }
  });
  const filterBarHtml = `
    <div class="idle-dragon-filter-bar">
      <select id="idleDragonFilterRarity">
        <option value="all">Alle Seltenheiten</option>
        <option value="standard">Standard</option>
        <option value="selten">Selten</option>
        <option value="episch">Episch</option>
        <option value="legendaer">Legendär</option>
      </select>
      <select id="idleDragonFilterStage">
        <option value="all">Alle Stufen</option>
        <option value="teen">Jugendlich</option>
        <option value="adult">Erwachsen</option>
      </select>
      <select id="idleDragonFilterSort">
        <option value="rarity">Sortieren: Seltenheit</option>
        <option value="stage">Sortieren: Entwicklungsstufe</option>
        <option value="strength">Sortieren: Stärke</option>
        <option value="name">Sortieren: Name</option>
        <option value="date">Sortieren: Erhaltungsdatum</option>
      </select>
      <label class="idle-dragon-filter-fav"><input type="checkbox" id="idleDragonFilterFav" ${bkmpDragonLagerFilter.favoritesOnly ? 'checked' : ''}> ★ nur Favoriten</label>
    </div>`;
  const grownHtml = grown.length
    ? `<div class="idle-skin-grid">${grown.map(d => {
        const species = bkmpDragonSpeciesById(d.species_id);
        if (!species) return '';
        const rarity = bkmpDragonRarityMeta(species.rarity);
        const isTeen = d.stage === 'teen';
        const pct = isTeen ? Math.min(100, Math.round((d.battle_xp / species.battle_xp_required) * 100)) : 100;
        const canEvolve = isTeen && d.battle_xp >= species.battle_xp_required;
        const substatsHtml = !isTeen ? (d.substats || []).map(s => `<div>${bkmpDragonSubstatLabel(s.stat)} +${s.value}${bkmpDragonSubstatSuffix(s.stat)}</div>`).join('') : '';
        return `
          <div class="idle-skin-card idle-dragon-lager-card ${d.is_companion ? 'idle-skin-card-equipped' : ''}" style="--dragon-rarity-color:${rarity.color}" data-dragon-id="${d.id}">
            ${d.is_favorite ? '<div class="idle-dragon-fav-badge">★</div>' : ''}
            <img class="idle-dragon-thumb" src="${bkmpDragonStageImage(species, d.stage)}" alt="${escapeHtml(species.name)}">
            <div class="idle-skin-name">${escapeHtml(species.name)} <small>(${isTeen ? 'Jugendlich' : 'Erwachsen'})</small></div>
            <div class="idle-skin-desc">${rarity.name}</div>
            ${isTeen
              ? `<div class="idle-xp-bar"><div class="idle-xp-fill" style="width:${pct}%"></div><span>${d.battle_xp}/${species.battle_xp_required} Kampf-EP</span></div>`
              : `<div class="idle-dragon-stats">${bkmpDragonMainStatLine(d)}<div class="idle-dragon-substats">${substatsHtml}</div></div>`}
            ${canEvolve ? `<button type="button" class="btn-ja idle-skin-action idle-dragon-evolve-adult-btn" data-dragon-id="${d.id}">⭐ Erwachsen werden</button>` : ''}
            ${!isTeen && bkmpDragonCanAscend(d) ? `<button type="button" class="btn-ja idle-skin-action idle-dragon-ascend-btn" data-dragon-id="${d.id}" title="Verbraucht eine zweite erwachsene ${escapeHtml(species.name)} (nicht favorisiert/Begleiter) + ${bkmpIdleFormatNumber(BKMP_DRAGON_ASCEND_COST_GOLD)} Gold für +${BKMP_DRAGON_ASCEND_BONUS_PCT}% Hauptwerte.">🌟 Aufsteigen (${Number(d.ascension_level || 0)}/${BKMP_DRAGON_ASCEND_MAX_LEVEL})</button>` : ''}
            <div class="idle-dragon-actions-row">
              ${d.is_companion
                ? `<button type="button" class="btn-nein idle-skin-action idle-dragon-uncompanion-btn" data-dragon-id="${d.id}">Ablegen</button>`
                : `<button type="button" class="btn-ja idle-skin-action idle-dragon-companion-btn" data-dragon-id="${d.id}">Als Begleiter</button>`}
              <button type="button" class="idle-dragon-fav-btn" data-dragon-id="${d.id}" title="Favorit">${d.is_favorite ? '★' : '☆'}</button>
              <button type="button" class="idle-dragon-release-btn" data-dragon-id="${d.id}" title="Freilassen">🗑️</button>
            </div>
          </div>`;
      }).join('')}</div>`
    : grownTotalCount === 0
      ? `<p class="idle-skin-empty-hint">Noch keine jugendlichen oder erwachsenen Drachen.</p>`
      : `<p class="idle-skin-empty-hint">Kein Drache entspricht diesem Filter.</p>`;

  panel.innerHTML = `
    <div class="idle-dragon-section">
      <h4>🍎🥩 Vorräte</h4>
      <p class="idle-skin-desc">
        🌳 Obstgarten Lv.${Number(bkmpIdleState.obstgarten_level || 0)}: ${bkmpIdleFormatNumber(Math.floor(bkmpIdleState.fruit || 0))} / ${bkmpIdleFormatNumber(bkmpDragonResourceCap(bkmpIdleState.obstgarten_level))} Früchte (+${bkmpIdleFormatNumber(bkmpDragonResourceRatePerHour('fruit', bkmpIdleState.obstgarten_level))}/Std.)<br>
        🥩 Jagdhütte Lv.${Number(bkmpIdleState.jagdhuette_level || 0)}: ${bkmpIdleFormatNumber(Math.floor(bkmpIdleState.meat || 0))} / ${bkmpIdleFormatNumber(bkmpDragonResourceCap(bkmpIdleState.jagdhuette_level))} Fleisch (+${bkmpIdleFormatNumber(bkmpDragonResourceRatePerHour('meat', bkmpIdleState.jagdhuette_level))}/Std.)
        ${companion ? `<br>Begleiter: ${escapeHtml((bkmpDragonSpeciesById(companion.species_id) || {}).name || '')}` : ''}
      </p>
      <p class="idle-skin-desc" style="margin-top:0.3rem;">Gebäude-Upgrades findest du im Tab "⬆️ Upgrades".</p>
    </div>
    <div class="idle-dragon-section">
      <h4>🏠 Drachennester</h4>
      <div class="idle-dragon-nest-grid">${nestsHtml}${nestPurchaseHtml}</div>
    </div>
    <div class="idle-dragon-section">
      <h4>🥚 Eierlager</h4>
      ${eggsHtml}
    </div>
    ${babies.length ? `<div class="idle-dragon-section"><h4>🐣 Fütterung</h4><div class="idle-skin-grid">${babiesHtml}</div></div>` : ''}
    <div class="idle-dragon-section">
      <h4>🐉 Drachenlager (${bkmpPlayerDragons.length}/${bkmpDragonStorageCapacity()})</h4>
      ${grownTotalCount ? filterBarHtml : ''}
      ${grownHtml}
      <button type="button" class="btn-nein idle-skin-action" id="idleDragonExpandStorageBtn" style="max-width:260px;margin-top:0.6rem;">Lager erweitern (${bkmpDragonStorageExpansionsBought() < BKMP_DRAGON_STORAGE_EXPANSIONS.length ? bkmpIdleFormatNumber(BKMP_DRAGON_STORAGE_EXPANSIONS[bkmpDragonStorageExpansionsBought()].cost) + ' 💰' : 'Maximum erreicht'})</button>
    </div>`;

  panel.querySelectorAll('.idle-dragon-assign-btn').forEach(btn => btn.addEventListener('click', () => {
    const freeNest = bkmpPlayerDragonNests.find(n => !n.egg_id);
    if (!freeNest) { if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Kein Drachennest frei - kaufe ein weiteres oder warte, bis eins fertig ist.', 3200); return; }
    bkmpDragonAssignEggToNest(freeNest.id, btn.dataset.eggId);
  }));
  panel.querySelectorAll('.idle-dragon-hatch-btn').forEach(btn => btn.addEventListener('click', () => bkmpDragonHatch(btn.dataset.nestId)));
  const buyNestBtn = document.getElementById('idleDragonBuyNestBtn');
  if (buyNestBtn) buyNestBtn.addEventListener('click', bkmpDragonPurchaseNest);
  panel.querySelectorAll('.idle-dragon-feed-btn').forEach(btn => btn.addEventListener('click', () => bkmpDragonFeed(btn.dataset.dragonId, Number(btn.dataset.amount))));
  panel.querySelectorAll('.idle-dragon-evolve-teen-btn').forEach(btn => btn.addEventListener('click', () => bkmpDragonEvolveToTeen(btn.dataset.dragonId)));
  panel.querySelectorAll('.idle-dragon-evolve-adult-btn').forEach(btn => btn.addEventListener('click', () => bkmpDragonEvolveToAdult(btn.dataset.dragonId)));
  panel.querySelectorAll('.idle-dragon-ascend-btn').forEach(btn => btn.addEventListener('click', () => bkmpDragonAscend(btn.dataset.dragonId)));
  panel.querySelectorAll('.idle-dragon-companion-btn').forEach(btn => btn.addEventListener('click', () => bkmpDragonSetCompanion(btn.dataset.dragonId)));
  panel.querySelectorAll('.idle-dragon-uncompanion-btn').forEach(btn => btn.addEventListener('click', bkmpDragonUnsetCompanion));
  panel.querySelectorAll('.idle-dragon-fav-btn').forEach(btn => btn.addEventListener('click', () => bkmpDragonToggleFavorite(btn.dataset.dragonId)));
  panel.querySelectorAll('.idle-dragon-release-btn').forEach(btn => btn.addEventListener('click', async () => {
    const dragon = bkmpPlayerDragons.find(d => d.id === btn.dataset.dragonId);
    const species = dragon ? bkmpDragonSpeciesById(dragon.species_id) : null;
    if (!dragon || !species) return;
    const rarity = bkmpDragonRarityMeta(species.rarity);
    const stats = bkmpDragonMainStatLine(dragon) || '';
    const body = `${species.name} (${rarity.name}, ${dragon.stage === 'adult' ? 'Erwachsen' : dragon.stage === 'teen' ? 'Jugendlich' : 'Baby'}) ${stats}\n\nDiese Aktion kann nicht rückgängig gemacht werden.`;
    const confirmed = typeof bkmpConfirmDialog === 'function'
      ? await bkmpConfirmDialog('🏞️ Drachen freilassen?', body, 'Ja, freilassen', 'Abbrechen')
      : window.confirm(body);
    if (!confirmed) return;
    const extraConfirm = species.rarity === 'episch' || species.rarity === 'legendaer';
    if (extraConfirm) {
      const doubleConfirmed = typeof bkmpConfirmDialog === 'function'
        ? await bkmpConfirmDialog('⚠️ Wirklich sicher?', `${species.name} ist ${rarity.name.toLowerCase()} und geht dauerhaft verloren.`, 'Ja, endgültig freilassen', 'Abbrechen')
        : window.confirm('Wirklich endgültig freilassen?');
      if (!doubleConfirmed) return;
    }
    bkmpDragonRelease(dragon.id);
  }));
  const expandBtn = document.getElementById('idleDragonExpandStorageBtn');
  if (expandBtn) expandBtn.addEventListener('click', bkmpDragonExpandStorage);

  const filterRarity = document.getElementById('idleDragonFilterRarity');
  const filterStage = document.getElementById('idleDragonFilterStage');
  const filterSort = document.getElementById('idleDragonFilterSort');
  const filterFav = document.getElementById('idleDragonFilterFav');
  if (filterRarity) { filterRarity.value = bkmpDragonLagerFilter.rarity; filterRarity.addEventListener('change', () => { bkmpDragonLagerFilter.rarity = filterRarity.value; bkmpIdleRenderDragonsPanel(); }); }
  if (filterStage) { filterStage.value = bkmpDragonLagerFilter.stage; filterStage.addEventListener('change', () => { bkmpDragonLagerFilter.stage = filterStage.value; bkmpIdleRenderDragonsPanel(); }); }
  if (filterSort) { filterSort.value = bkmpDragonLagerFilter.sort; filterSort.addEventListener('change', () => { bkmpDragonLagerFilter.sort = filterSort.value; bkmpIdleRenderDragonsPanel(); }); }
  if (filterFav) filterFav.addEventListener('change', () => { bkmpDragonLagerFilter.favoritesOnly = filterFav.checked; bkmpIdleRenderDragonsPanel(); });

  /* Klick auf die Karte selbst (nicht auf einen der Aktions-Buttons)
     oeffnet die Detailansicht - siehe bkmpDragonOpenDetail(). */
  panel.querySelectorAll('.idle-dragon-lager-card').forEach(card => card.addEventListener('click', e => {
    if (e.target.closest('button, select, label, input')) return;
    bkmpDragonOpenDetail(card.dataset.dragonId);
  }));

  bkmpDragonStartNestCountdownTicker();
}

/* Spieler-Report (17.07.): "Die Zeit läuft nur hackend runter" - der
   Brutzeit-Countdown im Nest wurde bisher NUR bei jedem Drachen-Kill neu
   gezeichnet (bkmpIdleRefreshLiveTabs, komplettes innerHTML-Neubauen),
   nicht auf einem eigenen Sekundentakt - je nach Angriffsgeschwindigkeit
   sprang die Anzeige dadurch in unregelmaessigen, teils grossen Schritten
   statt gleichmaessig runterzuzaehlen. Eigener leichter 1s-Takt, der NUR
   die Countdown-Textknoten aktualisiert (kein komplettes Neu-Rendern noetig -
   gleiches Prinzip wie bkmpDungeonUpdateBanner/bkmpRaidUpdateButtonState).
   Wird ein Nest waehrend des Tickens fertig, uebernimmt EIN vollstaendiges
   Neu-Rendern den Wechsel zum "Geschluepft"-Button. */
let bkmpDragonNestCountdownInterval = null;
function bkmpDragonStartNestCountdownTicker() {
  if (bkmpDragonNestCountdownInterval) return;
  bkmpDragonNestCountdownInterval = setInterval(bkmpDragonTickNestCountdowns, 1000);
}
function bkmpDragonStopNestCountdownTicker() {
  if (bkmpDragonNestCountdownInterval) { clearInterval(bkmpDragonNestCountdownInterval); bkmpDragonNestCountdownInterval = null; }
}
function bkmpDragonTickNestCountdowns() {
  const els = document.querySelectorAll('.idle-dragon-nest-countdown');
  if (!els.length) { bkmpDragonStopNestCountdownTicker(); return; }
  els.forEach(el => {
    const nest = bkmpPlayerDragonNests.find(n => n.id === el.dataset.nestId);
    if (!nest || !nest.egg_id) return;
    if (bkmpDragonNestReady(nest)) { bkmpIdleRenderDragonsPanel(); return; }
    const egg = bkmpPlayerDragonEggs.find(e => e.id === nest.egg_id);
    const species = egg ? bkmpDragonSpeciesById(egg.species_id) : null;
    if (!species) return;
    const msLeft = bkmpDragonEffectiveBroodSeconds(species) * 1000 - (Date.now() - Date.parse(nest.started_at));
    el.textContent = `⏳ ${bkmpDragonFormatDuration(Math.max(0, msLeft))}`;
  });
}

/* ---------------- Detailansicht ---------------- */
function bkmpDragonOpenDetail(dragonId) {
  const dragon = bkmpPlayerDragons.find(d => d.id === dragonId);
  const species = dragon ? bkmpDragonSpeciesById(dragon.species_id) : null;
  const overlay = document.getElementById('idleDragonDetailOverlay');
  if (!dragon || !species || !overlay) return;
  const rarity = bkmpDragonRarityMeta(species.rarity);
  const isTeen = dragon.stage === 'teen';
  const stageLabel = dragon.stage === 'baby' ? 'Baby' : (isTeen ? 'Jugendlich' : 'Erwachsen');
  const substatsHtml = (dragon.substats || []).map(s => `<div>${bkmpDragonSubstatLabel(s.stat)} +${s.value}${bkmpDragonSubstatSuffix(s.stat)}</div>`).join('') || '<div class="idle-skin-desc">–</div>';
  document.getElementById('idleDragonDetailImg').src = bkmpDragonStageImage(species, dragon.stage);
  document.getElementById('idleDragonDetailName').textContent = `${species.name} (${stageLabel})`;
  document.getElementById('idleDragonDetailRarity').textContent = rarity.name;
  document.getElementById('idleDragonDetailRarity').style.color = rarity.color;
  document.getElementById('idleDragonDetailFood').textContent = dragon.food_preference === 'fruit' ? '🍎 Früchte' : '🥩 Fleisch';
  document.getElementById('idleDragonDetailHatched').textContent = dragon.hatched_at ? new Date(dragon.hatched_at).toLocaleDateString('de-DE') : '–';
  document.getElementById('idleDragonDetailStats').innerHTML = dragon.stage === 'adult'
    ? `<div>${bkmpDragonMainStatLine(dragon) || '–'}</div>${substatsHtml}`
    : '<div class="idle-skin-desc">Werte werden erst als erwachsener Drache enthüllt.</div>';
  document.getElementById('idleDragonDetailCompanion').textContent = dragon.is_companion ? '✅ Aktiver Begleiter' : '';
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');
  const closeBtn = document.getElementById('idleDragonDetailCloseBtn');
  function close() { overlay.classList.remove('visible'); document.body.classList.remove('modal-open'); closeBtn.removeEventListener('click', close); }
  closeBtn.addEventListener('click', close);
}

/* ---------------- Dorf-Skins ----------------
   Reskin nur fuers PERSOENLICHE Dorf-Sprite im Kampf-Tab
   (.idle-village-sprite) - die geteilte Raid-Stadt (.raid-city-sprite)
   ist ein eigenes, gemeinsames Bild fuer den ganzen Server-Raid und wird
   hier bewusst NICHT mit angefasst.

   Freischaltung (Nutzervorgabe 13.07.): hauptsaechlich Kauf mit Gold/
   Kristallen, aber einzelne Skins koennen laut unlock_type auch per
   Achievement oder Boss-Drop freigeschaltet werden - diese zwei Wege
   bekommen noch keine automatische Trigger-Logik, bis der Spieler pro
   Skin mitteilt, welche Bedingung genau gelten soll (siehe SQL-Kommentar
   in supabase-idle-village-skins.sql). Das Grundgeruest (Katalog laden,
   Besitz pruefen, kaufen, ausruesten, Sprite live tauschen) steht schon,
   damit neue PNGs direkt als weitere Katalog-Zeilen eingehaengt werden
   koennen, sobald sie fertig sind. */
let bkmpVillageSkinsCatalog = [];
let bkmpPlayerVillageSkins = [];
const BKMP_ACTIVE_VILLAGE_SKIN_KEY = 'bkmp-active-village-skin';

function bkmpGetActiveVillageSkinId() {
  try { return localStorage.getItem(BKMP_ACTIVE_VILLAGE_SKIN_KEY) || 'standard'; } catch (e) { return 'standard'; }
}
function bkmpSetActiveVillageSkinId(skinId) {
  try { localStorage.setItem(BKMP_ACTIVE_VILLAGE_SKIN_KEY, skinId); } catch (e) { /* localStorage evtl. nicht verfuegbar (Privatmodus) - Auswahl gilt dann nur fuer diese Sitzung */ }
}

function bkmpVillageSkinOwned(skinId) {
  const def = bkmpVillageSkinsCatalog.find(s => s.id === skinId);
  if (!def) return false;
  return def.unlock_type === 'free' || bkmpPlayerVillageSkins.includes(skinId);
}

/* Setzt das tatsaechliche Hintergrundbild von #idleVillageSprite. Faellt
   auf 'standard' zurueck, falls die gewaehlte Skin-ID unbekannt oder (z.B.
   nach einem spaeteren Entzug) nicht mehr besessen ist - gleiche
   Nachpruef-Logik wie bkmpApplyActiveCosmetic bei den Namens-Kosmetiken,
   damit eine manipulierte localStorage-ID kein fremdes Bild erzwingen
   kann, das der Spieler nie freigeschaltet hat. */
/* FEHLER-FIX (Spieler-Report 14.07.: "Haben denn gleich Fehler wie beim
   Schaf! Bild bewegt sich von links nach rechts" statt sauber zu
   springen) - gleiche Ursache wie beim bereits geloesten Schaf-Sprite
   (bkmpSheepFrames, style.css): bei background-size N*100% darf das
   keyframe-Ziel NICHT 100% sein, sonst landen die steps(N)-
   Sprungpositionen von background-position-x auf Bruchteilen einer
   Frame-Breite statt auf ganzen Frame-Grenzen (offset = (Elementbreite -
   Hintergrundbreite) * Prozent/100 - mit Hintergrundbreite = N*Element-
   breite braucht ein glattes 0..100% ueber steps(N) das Ziel
   N/(N-1)*100%, nicht 100%). Da (anders als beim fest codierten Schaf)
   die Frame-Anzahl hier pro Skin variiert, wird das passende Keyframe
   dynamisch pro N erzeugt statt fest in style.css zu stehen. */
function bkmpEnsureVillageFrameKeyframes(frameCount) {
  const name = `idleVillageFrames${frameCount}`;
  let styleEl = document.getElementById('bkmpVillageSkinKeyframes');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'bkmpVillageSkinKeyframes';
    document.head.appendChild(styleEl);
  }
  const flagKey = 'frames' + frameCount;
  if (!styleEl.dataset[flagKey]) {
    const target = (frameCount / (frameCount - 1) * 100).toFixed(4);
    styleEl.appendChild(document.createTextNode(
      `@keyframes ${name} { from { background-position-x: 0%; } to { background-position-x: ${target}%; } }`
    ));
    styleEl.dataset[flagKey] = '1';
  }
  return name;
}

/* Verallgemeinert aus dem urspruenglich fest an #idleVillageSprite
   gebundenen Code (Spieler-Wunsch 14.07.: "Jeder mit seinem Dorfskin was
   er ausgerüstet hat" fuer die Arena-Kampfanimation) - nimmt jetzt ein
   beliebiges Element + eine Skin-ID entgegen, damit dieselbe Anzeige-Logik
   sowohl fuer das eigene Dorf im Kampf-Tab als auch fuer BEIDE Seiten der
   Arena-Animation (eigenes Dorf + Gegner-Dorf, gleichzeitig unterschiedliche
   Skins) genutzt werden kann. Ownership-Check (bkmpVillageSkinOwned) gilt
   nur fuer das EIGENE Dorf - beim Gegner wird jede vom Server gemeldete
   Skin-ID vertrauensvoll angezeigt (kein zusaetzlicher Katalog-Zugriff
   noetig, der Skin-Katalog ist ohnehin komplett bekannt). */
function bkmpApplyVillageSkinToElement(el, skinId, options) {
  if (!el) return;
  const checkOwnership = !options || options.checkOwnership !== false;
  let activeId = skinId || 'standard';
  let def = bkmpVillageSkinsCatalog.find(s => s.id === activeId);
  if (!def || (checkOwnership && !bkmpVillageSkinOwned(activeId))) {
    def = bkmpVillageSkinsCatalog.find(s => s.id === 'standard');
  }
  if (def && def.video_file) {
    /* Video-Skin (z.B. Pinguindorf) statt Bild-Sprite-Streifen: aspect-
       ratio wird hier auf die ECHTEN Video-Massse gesetzt (frame_aspect_w/h
       zweckentfremdet, siehe supabase-idle-village-skins-pinguindorf.sql),
       damit das Video ohne Zuschneiden/Verzerren exakt in den Container
       passt - object-fit:cover (style.css .idle-village-video) greift bei
       exakt passendem Seitenverhaeltnis ohnehin nicht sichtbar zu. */
    el.style.backgroundImage = '';
    el.style.backgroundSize = '';
    el.style.animation = 'none';
    const aspectW = Number(def.frame_aspect_w || 16);
    const aspectH = Number(def.frame_aspect_h || 9);
    el.style.aspectRatio = `${aspectW} / ${aspectH}`;
    let video = el.querySelector('.idle-village-video');
    if (!video) {
      video = document.createElement('video');
      video.className = 'idle-village-video';
      video.autoplay = true;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      el.appendChild(video);
    }
    if (video.dataset.src !== def.video_file) {
      video.src = def.video_file;
      video.dataset.src = def.video_file;
    }
  } else if (def && def.image_file) {
    const existingVideo = el.querySelector('.idle-village-video');
    if (existingVideo) existingVideo.remove();
    el.style.backgroundImage = `url('${def.image_file}')`;
    const frameCount = Math.max(1, Number(def.frame_count || 1));
    const aspectW = Number(def.frame_aspect_w || 1164);
    const aspectH = Number(def.frame_aspect_h || 199);
    el.style.aspectRatio = `${aspectW} / ${aspectH}`;
    if (frameCount > 1) {
      /* Mehrere leicht unterschiedliche Frames (ambiente Partikel-
         Variation, z.B. Pilzdorf) liegen als horizontaler Sprite-Streifen
         vor - background-size auf die Gesamtbreite des Streifens strecken
         und per steps() durchschalten, analog zum bestehenden Schaf-
         Sprite (bkmpSheepFrames). Feste 0.6s pro Frame, damit mehr Frames
         automatisch einen laengeren, ruhigeren Loop ergeben statt eines
         hektischeren. */
      el.style.backgroundSize = `${frameCount * 100}% 100%`;
      const kfName = bkmpEnsureVillageFrameKeyframes(frameCount);
      el.style.animation = `${kfName} ${(frameCount * 0.6).toFixed(1)}s steps(${frameCount}) infinite`;
    } else {
      el.style.backgroundSize = '100% 100%';
      el.style.animation = 'none';
    }
  } else {
    const existingVideo = el.querySelector('.idle-village-video');
    if (existingVideo) existingVideo.remove();
    el.style.backgroundImage = '';
    el.style.animation = 'none';
  }
}

function bkmpApplyVillageSkin() {
  bkmpApplyVillageSkinToElement(document.getElementById('idleVillageSprite'), bkmpGetActiveVillageSkinId());
}

function bkmpIdleBuyVillageSkin(skinId) {
  const def = bkmpVillageSkinsCatalog.find(s => s.id === skinId);
  if (!def || def.unlock_type !== 'purchase' || !bkmpIdleState) return;
  if (bkmpVillageSkinOwned(skinId)) return;
  const goldCost = Number(def.price_gold || 0);
  const crystalCost = Number(def.price_crystals || 0);
  if ((bkmpIdleState.gold || 0) < goldCost || (bkmpIdleState.crystals || 0) < crystalCost) return;
  bkmpIdleState.gold -= goldCost;
  bkmpIdleState.crystals -= crystalCost;
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
  const nameKey = bkmpIdleState.name_key;
  Promise.resolve(typeof unlockPlayerVillageSkin === 'function' ? unlockPlayerVillageSkin(nameKey, skinId) : null)
    .then(row => {
      if (row) bkmpPlayerVillageSkins.push(skinId);
      bkmpIdleRenderSkinsPanel();
    })
    .catch(e => {
      /* Kauf-Zeile konnte nicht gespeichert werden (Migration evtl. noch
         nicht ausgefuehrt, oder Netzwerkfehler) - Gold bleibt trotzdem
         abgezogen (gleiches Verhalten wie ein normaler Upgrade-Kauf bei
         Sync-Fehlern), der Spieler kann es beim naechsten Laden erneut
         versuchen. */
      console.warn('Idle Dorf: Dorf-Skin-Kauf konnte nicht gespeichert werden.', e);
    });
}

function bkmpIdleEquipVillageSkin(skinId) {
  if (!bkmpVillageSkinOwned(skinId)) return;
  bkmpSetActiveVillageSkinId(skinId);
  bkmpApplyVillageSkin();
  bkmpIdleRenderSkinsPanel();
  /* Server-Sync (Spieler-Wunsch 14.07., Arena-Kampfanimation: "Jeder mit
     seinem Dorfskin was er ausgerüstet hat") - die aktive Skin-Wahl war
     bisher rein lokal (localStorage), andere Spieler (z.B. ein Arena-Gegner)
     konnten sie serverseitig gar nicht sehen. Landet ganz normal im
     naechsten periodischen Sync mit (bkmpIdleQueueSync), kein Sonderpfad
     noetig - siehe active_village_skin in supabase-idle-village-skin-
     sync.sql. */
  if (bkmpIdleState) {
    bkmpIdleState.active_village_skin = skinId;
    bkmpIdleQueueSync();
  }
}

function bkmpIdleRenderSkinsPanel() {
  const panel = document.getElementById('idlePanelSkins');
  if (!panel || !bkmpIdleState) return;
  const activeVillageId = bkmpGetActiveVillageSkinId();
  if (!bkmpVillageSkinsCatalog.length) {
    panel.innerHTML = `<p class="idle-skin-empty-hint">Noch keine Dorf-Skins verfuegbar - schau bald wieder vorbei.</p>`;
    return;
  }
  panel.innerHTML = `<div class="idle-skin-grid">${bkmpVillageSkinsCatalog.map(def => {
    const owned = bkmpVillageSkinOwned(def.id);
    const isEquipped = owned && activeVillageId === def.id;
    let actionHtml;
    if (isEquipped) {
      actionHtml = `<button type="button" class="btn-ja idle-skin-action" disabled>Ausgerüstet</button>`;
    } else if (owned) {
      actionHtml = `<button type="button" class="btn-ja idle-skin-action idle-skin-equip" data-skin-id="${def.id}">Ausrüsten</button>`;
    } else if (def.unlock_type === 'purchase') {
      const goldCost = Number(def.price_gold || 0);
      const crystalCost = Number(def.price_crystals || 0);
      const affordable = (bkmpIdleState.gold || 0) >= goldCost && (bkmpIdleState.crystals || 0) >= crystalCost;
      const priceParts = [];
      if (goldCost > 0) priceParts.push(`💰 ${bkmpIdleFormatNumber(goldCost)}`);
      if (crystalCost > 0) priceParts.push(`💎 ${bkmpIdleFormatNumber(crystalCost)}`);
      actionHtml = `<button type="button" class="btn-ja idle-skin-action idle-skin-buy" data-skin-id="${def.id}" ${affordable ? '' : 'disabled'}>${priceParts.join(' + ') || 'Kaufen'}</button>`;
    } else if (def.unlock_type === 'real_money') {
      const priceEur = (Number(def.price_eur_cents || 0) / 100).toFixed(2).replace('.', ',');
      actionHtml = BKMP_REAL_MONEY_PURCHASES_ENABLED
        ? `<button type="button" class="btn-ja idle-skin-action idle-skin-buy-real-money" data-skin-id="${def.id}">Kaufen (${priceEur} €)</button>`
        : `<button type="button" class="btn-ja idle-skin-action idle-skin-buy-real-money-locked" data-skin-id="${def.id}" disabled title="Käufe sind noch nicht freigeschaltet">🔒 Kaufen (${priceEur} €)</button>`;
    } else {
      actionHtml = `<div class="idle-skin-locked-hint">🔒 ${escapeHtml(def.unlock_hint || (def.unlock_type === 'achievement' ? 'Über einen Erfolg freischaltbar' : 'Seltener Boss-Drop'))}</div>`;
    }
    return `
      <div class="idle-skin-card ${isEquipped ? 'idle-skin-card-equipped' : ''} ${def.unlock_type === 'real_money' ? 'idle-skin-card-premium' : ''}">
        <div class="idle-skin-icon">${def.icon || '🏘️'}</div>
        <div class="idle-skin-name">${escapeHtml(def.name)}</div>
        <div class="idle-skin-desc">${escapeHtml(def.description || '')}</div>
        ${actionHtml}
      </div>`;
  }).join('')}</div>`;
  panel.querySelectorAll('.idle-skin-buy').forEach(btn => btn.addEventListener('click', () => bkmpIdleBuyVillageSkin(btn.dataset.skinId)));
  panel.querySelectorAll('.idle-skin-equip').forEach(btn => btn.addEventListener('click', () => bkmpIdleEquipVillageSkin(btn.dataset.skinId)));
  panel.querySelectorAll('.idle-skin-buy-real-money').forEach(btn => btn.addEventListener('click', () => bkmpIdleOpenBuyFrameModal(btn.dataset.skinId)));
}

/* ---------------- Echtgeld-Kauf-Dialog (Steampunk Dorf etc.) ----------------
   Eigenes, kleines Modal statt des generischen bkmpConfirmDialog - braucht
   eine echte Checkbox fuer die gesetzlich vorgeschriebene ausdrueckliche
   Zustimmung zum sofortigen Beginn der Vertragsausfuehrung (§ 356 Abs. 5
   BGB, Verlust des 14-taegigen Widerrufsrechts bei digitalen Inhalten). */
function bkmpIdleOpenBuyFrameModal(skinId) {
  const overlay = document.getElementById('idleBuyFrameOverlay');
  const checkbox = document.getElementById('idleBuyFrameConsent');
  const confirmBtn = document.getElementById('idleBuyFrameConfirmBtn');
  const cancelBtn = document.getElementById('idleBuyFrameCancelBtn');
  if (!overlay || !checkbox || !confirmBtn || !cancelBtn || !bkmpIdleState) return;
  const def = bkmpVillageSkinsCatalog.find(s => s.id === skinId);
  const priceEur = (Number((def && def.price_eur_cents) || 0) / 100).toFixed(2).replace('.', ',');
  const nameLabel = document.getElementById('idleBuyFrameName');
  if (nameLabel) nameLabel.textContent = (def && def.name) || 'Artikel';
  checkbox.checked = false;
  confirmBtn.disabled = true;
  confirmBtn.textContent = `Weiter zu Stripe (${priceEur} €)`;
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');

  function onCheck() { confirmBtn.disabled = !checkbox.checked; }
  function cleanup() {
    overlay.classList.remove('visible');
    document.body.classList.remove('modal-open');
    checkbox.removeEventListener('change', onCheck);
    confirmBtn.removeEventListener('click', onConfirm);
    cancelBtn.removeEventListener('click', cleanup);
  }
  async function onConfirm() {
    if (!checkbox.checked || confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Wird vorbereitet...';
    try {
      const url = await bkmpCreateStripeCheckoutSession(bkmpIdleState.name_key, skinId);
      window.location.href = url;
    } catch (e) {
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3600);
      confirmBtn.disabled = false;
      confirmBtn.textContent = `Weiter zu Stripe (${priceEur} €)`;
    }
  }
  checkbox.addEventListener('change', onCheck);
  confirmBtn.addEventListener('click', onConfirm);
  cancelBtn.addEventListener('click', cleanup);
}

/* Rueckkehr von Stripe: die success_url traegt NUR zur Anzeige bei ("Danke!"),
   die eigentliche Freischaltung ist zu diesem Zeitpunkt schon (oder in
   Kuerze) ueber den Webhook passiert. Kurzes Nachpollen, falls der Webhook
   minimal langsamer war als der Redirect. */
function bkmpIdleHandleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  const purchase = params.get('purchase');
  if (!purchase) return;
  window.history.replaceState({}, '', window.location.pathname);
  if (purchase === 'cancelled') {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Kauf abgebrochen - es wurde nichts abgebucht.', 3200);
    return;
  }
  if (purchase !== 'success') return;
  const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
  if (!name) return;
  const ownedBefore = bkmpPlayerVillageSkins.length;
  let attempts = 0;
  const poll = () => {
    attempts += 1;
    Promise.resolve(bkmpIdleLoadOrInitState(name))
      .then(() => {
        if (typeof bkmpIdleRenderSkinsPanel === 'function') bkmpIdleRenderSkinsPanel();
        if (bkmpPlayerVillageSkins.length > ownedBefore) {
          if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🎉 Danke für deinen Kauf! Der neue Dorf-Skin ist freigeschaltet - im Dorf-Skins-Tab ausruestbar.', 4200);
        } else if (attempts < 4) {
          window.setTimeout(poll, 2000);
        } else if (typeof bkmpShowJannikToast === 'function') {
          bkmpShowJannikToast('Zahlung eingegangen - die Freischaltung braucht noch einen Moment, bitte gleich nochmal im Dorf-Skins-Tab nachschauen.', 5000);
        }
      })
      .catch(() => {});
  };
  poll();
}

/* Neue Drops werden gesammelt statt sofort einzeln gespeichert - bei
   mehreren Kaempfen kurz hintereinander (autoklickender Spieler, schnelle
   Stufen) landet so bei Bedarf mehr als ein Drop in EINEM Insert-Aufruf
   statt einer Schreib-Anfrage pro Kampf (gleiche Ueberlegung wie beim
   Egress-Vorfall vom 12.07. - siehe Projektnotizen). */
async function bkmpIdleFlushRuneSync() {
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
}

/* Neue Drops werden gesammelt statt sofort einzeln gespeichert - bei
   mehreren Kaempfen kurz hintereinander (autoklickender Spieler, schnelle
   Stufen) landet so bei Bedarf mehr als ein Drop in EINEM Insert-Aufruf
   statt einer Schreib-Anfrage pro Kampf (gleiche Ueberlegung wie beim
   Egress-Vorfall vom 12.07. - siehe Projektnotizen). */
function bkmpIdleQueueRuneSync() {
  if (bkmpIdleRuneSyncTimer) return;
  bkmpIdleRuneSyncTimer = window.setTimeout(bkmpIdleFlushRuneSync, 4000);
}

/* Erzwingt ein sofortiges Speichern der noch nicht gesicherten Runen-Drops,
   ohne auf den 4s-Debounce zu warten. Bug-Report 17.07.: Skillpunkte/Gold
   waren bereits gegen Reload-Datenverlust abgesichert (siehe
   bkmpIdleFlushSyncNow/beforeunload), frisch gedroppte Runen aber NICHT -
   dieser Timer wurde beim Schliessen/Reload bisher gar nicht erzwungen,
   die Rune war also bei einem Reload innerhalb der 4s schlicht nie in der
   DB angekommen (nicht nur "zurueckgesetzt" wie bei Gold, sondern komplett
   verloren). */
async function bkmpIdleFlushRuneSyncNow() {
  if (bkmpIdleRuneSyncTimer) { window.clearTimeout(bkmpIdleRuneSyncTimer); bkmpIdleRuneSyncTimer = null; }
  await bkmpIdleFlushRuneSync();
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
/* Gemeinsamer Wrapper fuer alle Rune-Loesch-Aufrufe (Verkaufen/Verschmelzen/
   Aufstiegs-Fodder/Prestige-Reset): lokal wird die Rune IMMER sofort aus
   bkmpIdlePlayerRunes entfernt (optimistisches UI), der DB-Delete laeuft
   parallel fire-and-forget. Frueher wurde ein Fehlschlag dabei ueberall
   still verschluckt (.catch(() => {})) - GENAU das gleiche Muster wie der
   Runen-Aufstieg-Bug (siehe bkmpRuneAscend-Kommentar): die Rune verschwindet
   lokal, bleibt aber in der DB stehen und taucht nach einem Reload wieder
   auf (bei Verkauf/Verschmelzen sogar dupliziert, da das Gold/die neue Rune
   ja schon vergeben wurde). Mindestens sichtbar machen statt komplett
   verschlucken. */
function bkmpRuneDeleteRemote(ids, context) {
  if (!Array.isArray(ids) || !ids.length || typeof deletePlayerRunes !== 'function') return;
  deletePlayerRunes(ids).catch(err => {
    console.error(`Runen-Loeschung fehlgeschlagen (${context}) - betroffene Runen koennten nach einem Reload dupliziert wieder auftauchen.`, err, ids);
  });
}

const BKMP_RUNE_MAX_LEVEL = 15;
/* Runen-Aufstieg (Community-Wunsch 17.07., Discord-Zitat "wir brauchen
   Mythische Runen, hab zu viele legendäre" + eigener Vorschlag "+15 Legi +
   15 Legi verbinden -> +16, dann +16+16=+17..."): Legendaer (gold) war
   bisher eine Sackgasse - weder weiter verschmelzbar (siehe BKMP_RUNE_
   FUSE_FAIL_CHANCE-Kommentar oben, kein Eintrag fuer 'gold') noch ueber
   +15 aufwertbar, Dubletten blieben nur zum Verkauf fuer ein paar Gold
   uebrig. Statt einer komplett neuen 6. Seltenheitsstufe (neue Sprites,
   neue Drop-Tabellen-Balance) loest der Aufstieg das direkt mit dem
   bereits vorhandenen System: eine ZWEITE Legendaere Rune DERSELBEN Stufe
   (gleicher Slot) wird komplett verbraucht, die erste steigt um 1 Stufe -
   bis zum neuen absoluten Maximum +30. Bewusst OHNE Fehlschlagchance (der
   Preis ist bereits eine ganze zusaetzliche maximal aufgewertete
   Legendaere plus Gold) - anders als Verschmelzen/normales Aufwerten. */
const BKMP_RUNE_ASCEND_MAX_LEVEL = 30;
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
    bkmpIdleState.rune_upgrade_failures = Number(bkmpIdleState.rune_upgrade_failures || 0) + 1;
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
  bkmpIdleState.rune_upgrade_successes = Number(bkmpIdleState.rune_upgrade_successes || 0) + 1;
  bkmpRuneCurrentlyViewing = cid;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderRunenPanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

/* Substat-Reroll (Lategame-Content, Spieler-Vorgabe 16.07.): bisher gab es
   KEINERLEI Moeglichkeit, einen bereits vorhandenen Sub-Stat neu zu wuerfeln
   - einmal (bei Drop/Verschmelzung/Meilenstein) gewuerfelt, fuer immer so.
   Klassischer "perfekte Rune jagen"-Sog fuer genau die Spieler, die
   Skilltree/Prestige/Dungeons schon ausgereizt haben, UND eine neue
   Kristall-Senke. Wuerfelt bewusst nur den WERT neu (dieselbe Range wie
   beim urspruenglichen Wurf, siehe bkmpIdleRollSubstatValue), nicht den
   Stat-Typ selbst - das waere ein anderes, viel staerkeres Feature
   ("Stat tauschen") und wuerde die Substat-Gewichtung aus
   BKMP_RUNE_SUBSTAT_WEIGHTS aushebeln. */
function bkmpRuneRerollSubstatCost(rune) {
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rune.rarity);
  const mult = rarity ? rarity.mult : 1;
  return Math.max(1, Math.round(5 * mult * (1 + Number(rune.upgrade_level || 0) * 0.15)));
}
function bkmpRuneRerollSubstat(cid, statIndex) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || !bkmpIdleState) return;
  const substats = Array.isArray(rune.substats) ? rune.substats : [];
  const entry = substats[statIndex];
  if (!entry) return;
  const cost = bkmpRuneRerollSubstatCost(rune);
  if (Number(bkmpIdleState.crystals || 0) < cost) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('💎 Nicht genug Kristalle zum Neuwürfeln.', 2400);
    return;
  }
  bkmpIdleState.crystals -= cost;
  const oldValue = entry.value;
  entry.value = bkmpIdleRollSubstatValue(entry.stat, rune.rarity);
  const meta = bkmpRuneStatMeta(entry.stat);
  const subUnit = entry.stat.endsWith('_flat') ? '' : '%';
  const better = entry.value > oldValue;
  bkmpIdleLog(`🎲 Sub-Stat neu gewürfelt: ${meta.icon} ${meta.desc} +${oldValue}${subUnit} → +${entry.value}${subUnit}${better ? ' (besser!)' : ''}`);
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🎲 ${meta.icon} ${meta.desc}: +${entry.value}${subUnit}${better ? ' 📈' : ''}`, 2800);
  if (rune.id) updatePlayerRuneUpgrade(rune.id, rune.upgrade_level, rune.substats).catch(() => {});
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderRunenPanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

function bkmpRuneCanAscend(rune) {
  const level = Number(rune.upgrade_level || 0);
  return rune.rarity === 'gold' && level >= BKMP_RUNE_MAX_LEVEL && level < BKMP_RUNE_ASCEND_MAX_LEVEL;
}
/* Findet eine zweite, unausgeruestete Legendaere desselben Slots UND
   derselben Stufe - genau die "+15 Legi + +15 Legi"-Bedingung aus dem
   Spieler-Vorschlag. Absichtlich exakt gleiche Stufe (nicht nur "auch
   maximal"), damit sich hoehere Aufstiegsstufen nicht mit beliebigen
   +15-Dubletten billig weiterschummeln lassen. */
function bkmpRuneFindAscendFodder(rune) {
  const level = Number(rune.upgrade_level || 0);
  return bkmpIdlePlayerRunes.find(r => r._cid !== rune._cid && r.rune_type === rune.rune_type && r.rarity === 'gold' && Number(r.upgrade_level || 0) === level && !r.equipped);
}
function bkmpRuneAscend(cid) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || !bkmpIdleState || !bkmpRuneCanAscend(rune)) return;
  const fodder = bkmpRuneFindAscendFodder(rune);
  if (!fodder) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🌟 Brauchst eine zweite +${Number(rune.upgrade_level || 0)} Legendäre desselben Slots zum Verbrauchen.`, 3200);
    return;
  }
  const cost = bkmpIdleRuneUpgradeCost(rune);
  if (bkmpIdleState.gold < cost) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('💰 Nicht genug Gold zum Aufsteigen.', 2400);
    return;
  }
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === rune.rune_type);
  bkmpIdleState.gold -= cost;
  bkmpIdlePlayerRunes = bkmpIdlePlayerRunes.filter(r => r._cid !== fodder._cid);
  if (fodder.id) bkmpRuneDeleteRemote([fodder.id], 'Aufstiegs-Fodder');
  rune.upgrade_level = Number(rune.upgrade_level || 0) + 1;
  if (rune.id) updatePlayerRuneUpgrade(rune.id, rune.upgrade_level, rune.substats).catch(err => {
    console.error('bkmpRuneAscend: Speichern fehlgeschlagen, Aufstieg wird beim naechsten Laden zurueckgesetzt', err);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('⚠️ Aufstieg konnte nicht gespeichert werden - bitte Seite neu laden und erneut versuchen.', 4000);
  });
  bkmpIdleState.rune_upgrade_successes = Number(bkmpIdleState.rune_upgrade_successes || 0) + 1;
  bkmpIdleLog(`🌟 ${slot ? slot.name : 'Rune'} auf +${rune.upgrade_level} aufgestiegen! Eine zweite Legendäre wurde dafür verbraucht.`);
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🌟 Aufstieg geglückt: +${rune.upgrade_level}!`, 3200);
  bkmpRuneCurrentlyViewing = cid;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderRunenPanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

/* Auto-Aufstieg (Community-Wunsch DerJannikHase 15.07.: "wie das
   Autoschmelzen nur fuer Legendäre Runen ... alle die schon auf lvl15 sind
   nicht alle einzeln upgraden", von David 17.07. bestaetigt - nur Legendaer,
   nur Runen ab +15). Findet alle aktuell moeglichen Aufstiegs-Paare (zwei
   unausgeruestete ODER eine ausgeruestete + eine unausgeruestete Legendaere
   derselben Stufe UND desselben Slots) und verarbeitet sie in einem Rutsch,
   analog zu bkmpRuneAutoFuseAll. Bewusst EIN Durchgang ohne automatisches
   Weiterverketten ueber mehrere Stufen im selben Klick - erzeugt dieser
   Durchgang neue Paare auf der naechsthoeheren Stufe, reicht ein zweiter
   Klick (macht die Vorschau/Bestaetigung deutlich einfacher, bei
   vorhandenem Gold praktisch kein Mehraufwand). Innerhalb einer Gruppe wird
   die Rune mit den meisten/staerksten Sub-Stats als Ueberlebende bevorzugt,
   die "schwaechere" Kopie wird verbraucht. */
function bkmpRuneAutoAscendPairs(candidateRunes) {
  const eligible = (candidateRunes || []).filter(r => bkmpRuneCanAscend(r));
  const byKey = {};
  eligible.forEach(r => {
    const key = r.rune_type + '|' + Number(r.upgrade_level || 0);
    (byKey[key] = byKey[key] || []).push(r);
  });
  const pairs = [];
  Object.values(byKey).forEach(list => {
    const equipped = list.find(r => r.equipped) || null;
    const unequipped = list.filter(r => !r.equipped).sort((a, b) => {
      const subDiff = (b.substats || []).length - (a.substats || []).length;
      if (subDiff !== 0) return subDiff;
      return Number(b.rolled_value || 0) - Number(a.rolled_value || 0);
    });
    const pool = unequipped.slice();
    /* Die ausgeruestete Rune bleibt IMMER Ueberlebende (nie Fodder, sonst
       wird der Ausruestungs-Slot ungefragt leer) - verbraucht dafuer aber
       bewusst die SCHWAECHSTE Dublette (pool.pop() statt shift()), damit die
       staerkeren Dubletten fuer die reine Unter-sich-Paarung unten (wo immer
       die bessere von zweien ueberlebt) erhalten bleiben. */
    if (equipped && pool.length) pairs.push({ survivor: equipped, fodder: pool.pop() });
    while (pool.length >= 2) {
      const survivor = pool.shift();
      const fodder = pool.shift();
      pairs.push({ survivor, fodder });
    }
  });
  return pairs;
}
async function bkmpRuneAutoAscendAll() {
  const activeSlot = window.BKMP_RUNE_SLOTS.find(s => s.id === bkmpRuneActiveSlotTab);
  if (!activeSlot || !bkmpIdleState) return;
  const candidates = bkmpIdlePlayerRunes.filter(r => r.rune_type === activeSlot.id);
  const pairs = bkmpRuneAutoAscendPairs(candidates);
  if (!pairs.length) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`Keine passenden Legendäre-Paare (gleiche Stufe) bei ${activeSlot.name} zum Aufsteigen.`, 2800);
    return;
  }
  const totalCost = pairs.reduce((sum, p) => sum + bkmpIdleRuneUpgradeCost(p.survivor), 0);
  const confirmed = await bkmpConfirmDialog(
    `🌟 Auto-Aufstieg: ${pairs.length}× Legendäre?`,
    `Lässt bei ${activeSlot.name} alle ${pairs.length} aktuell passenden Legendäre-Paare (gleiche Stufe) automatisch aufsteigen, für insgesamt ${bkmpIdleFormatNumber(totalCost)} Gold. Jeweils eine zweite Legendäre wird dafür verbraucht.\n\n⚠️ Reicht das Gold nicht für alle Paare, werden nur so viele wie möglich verarbeitet.\n\nTrotzdem fortfahren?`,
    'Ja, alle aufsteigen',
    'Abbrechen'
  );
  if (!confirmed) return;
  let succeeded = 0;
  let skippedForGold = 0;
  pairs.forEach(({ survivor, fodder }) => {
    if (!bkmpIdleState || survivor.upgrade_level !== fodder.upgrade_level) return; // gleiche Rune kann nicht doppelt in zwei Paaren stecken
    if (!bkmpIdlePlayerRunes.includes(survivor) || !bkmpIdlePlayerRunes.includes(fodder)) return;
    const cost = bkmpIdleRuneUpgradeCost(survivor);
    if (bkmpIdleState.gold < cost) { skippedForGold += 1; return; }
    const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === survivor.rune_type);
    bkmpIdleState.gold -= cost;
    bkmpIdlePlayerRunes = bkmpIdlePlayerRunes.filter(r => r._cid !== fodder._cid);
    if (fodder.id) bkmpRuneDeleteRemote([fodder.id], 'Auto-Aufstieg-Fodder');
    survivor.upgrade_level = Number(survivor.upgrade_level || 0) + 1;
    if (survivor.id) updatePlayerRuneUpgrade(survivor.id, survivor.upgrade_level, survivor.substats).catch(err => {
      console.error('bkmpRuneAutoAscendAll: Speichern fehlgeschlagen', err);
    });
    bkmpIdleState.rune_upgrade_successes = Number(bkmpIdleState.rune_upgrade_successes || 0) + 1;
    succeeded += 1;
  });
  const summary = skippedForGold
    ? `🌟 ${succeeded}× Legendäre aufgestiegen, ${skippedForGold}× mangels Gold übersprungen.`
    : `🌟 Alle ${succeeded} Legendäre-Paare aufgestiegen!`;
  bkmpIdleLog(summary);
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(summary, 3800);
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
/* Feedback-Vorschlag (SpielKein MC HoleNurErfolge, 13.7.: "das Runen
   verschmelzen automatisieren? weil das etwas krampf mit den einfachen
   wenn man da 50 hat"), Nutzerentscheidung: "1 Button zusaetzlich einbauen
   mit alle verschmelzen" - bewusst OHNE das BKMP_RUNE_FUSE_MAX_SELECT-Limit
   (9) des "3 auswaehlen"-Buttons, damit man nicht mehrfach klicken/
   bestaetigen muss, wenn 50 einfache Runen vorliegen. bkmpRuneConfirmFuseSelection()
   verarbeitet beliebig viele Dreiergruppen ohnehin schon in einem Rutsch
   (eine Sammel-Zusammenfassung), das war nie das eigentliche Limit - nur
   die Auswahl-Buttons waren es. NACHBESSERUNG (17.07., "6 und 9 weg"): die
   6er/9er-Zwischenstufen wieder entfernt (nur noch 3 + Alle je Seltenheit),
   siehe bkmpRuneAutoFuseAll weiter unten fuer den neuen, seltenheits-
   uebergreifenden Ein-Klick-Weg. */
function bkmpRuneQuickSelectFuseAll() {
  if (!bkmpRuneFuseSelection) return;
  /* Spieler-Feedback (14.07.): "Es werden auch Runen verschmolzen die +1 +2
     +3 haben das soll so nicht" - nur noch unangetastete +0-Runen kommen
     automatisch in die Auswahl, keine Faellt-zurueck-auf-aufgewertet mehr. */
  const candidates = bkmpIdlePlayerRunes
    .filter(r => r.rune_type === bkmpRuneActiveSlotTab && r.rarity === bkmpRuneFuseSelection.rarityId && !r.equipped && Number(r.upgrade_level || 0) === 0);
  const usableCount = Math.floor(candidates.length / 3) * 3;
  bkmpRuneFuseSelection.cids = candidates.slice(0, usableCount).map(r => r._cid);
  bkmpIdleRenderRunenPanel();
}
/* Auto-Schmelzen ueber ALLE Seltenheiten (Spieler-Wunsch 17.07.: "6 und 9
   weg, dann autoschmelzen aller ... Runen mit einem Klick aller Farben") -
   ersetzt das rarity-weise Durchklicken (Seltenheit waehlen -> "Alle" ->
   bestaetigen, einmal PRO Seltenheit) durch einen einzigen Klick, der
   gray/green/blue/purple des aktuell offenen Slots in einem Rutsch
   durchgeht (Legendaer/gold faellt raus, siehe BKMP_RUNE_FUSE_FAIL_CHANCE-
   Kommentar - kann nicht weiter verschmolzen werden). Nutzt pro Seltenheit
   dieselbe strikte +0-Auswahl wie bkmpRuneQuickSelectFuseAll. NACHBESSERUNG
   (14.07., "Es werden auch Runen verschmolzen die +1 +2 +3 haben das soll
   so nicht"): der fruehere Rueckfall auf aufgewertete Runen (falls nicht
   genug +0-Kopien vorhanden waren) ist entfernt - eine Seltenheit wird nur
   noch aus komplett unangetasteten +0-Runen gruppiert, sonst ganz
   uebersprungen. */
async function bkmpRuneAutoFuseAll() {
  const activeSlot = window.BKMP_RUNE_SLOTS.find(s => s.id === bkmpRuneActiveSlotTab);
  if (!activeSlot || !bkmpIdleState) return;
  const fusableRarities = window.BKMP_RUNE_RARITIES.filter(r => r.id !== 'gold');
  const groups = [];
  fusableRarities.forEach(rarity => {
    const candidates = bkmpIdlePlayerRunes
      .filter(r => r.rune_type === activeSlot.id && r.rarity === rarity.id && !r.equipped && Number(r.upgrade_level || 0) === 0);
    const usableCount = Math.floor(candidates.length / 3) * 3;
    for (let i = 0; i < usableCount; i += 3) groups.push({ rarityId: rarity.id, cids: candidates.slice(i, i + 3).map(r => r._cid) });
  });
  if (!groups.length) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`Keine vollständigen +0-Dreiergruppen zum Verschmelzen bei ${activeSlot.name}.`, 2800);
    return;
  }
  const byRarityCount = {};
  groups.forEach(g => { byRarityCount[g.rarityId] = (byRarityCount[g.rarityId] || 0) + 1; });
  const summaryLine = fusableRarities.filter(r => byRarityCount[r.id]).map(r => `${byRarityCount[r.id]}× ${r.name}`).join(', ');
  const confirmed = await bkmpConfirmDialog(
    `🔥 Auto-Schmelzen: ${groups.length} Gruppen?`,
    `Verschmilzt bei ${activeSlot.name} alle vollständigen +0-Dreiergruppen über alle Seltenheiten hinweg: ${summaryLine} (insgesamt ${groups.length * 3} Runen).\n\n⚠️ Jede Gruppe hat je nach Seltenheit eine eigene Chance, komplett zerstört zu werden statt zu gelingen.\n\nTrotzdem fortfahren?`,
    'Ja, alle verschmelzen',
    'Abbrechen'
  );
  if (!confirmed) return;
  bkmpRuneFuseSelection = null;
  let succeeded = 0;
  let destroyed = 0;
  groups.forEach(g => {
    const result = bkmpRuneFuse(activeSlot.id, g.rarityId, g.cids);
    if (result && result.success) succeeded += 1;
    else destroyed += 1;
  });
  const summary = destroyed
    ? `🔥 ${succeeded}/${groups.length} Verschmelzungen erfolgreich, 💥 ${destroyed} zerstört.`
    : `🔥 Alle ${groups.length} Verschmelzungen erfolgreich!`;
  bkmpIdleLog(summary);
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(summary, 3800);
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
  /* Spieler-Feedback (15.07.): "Das muss geändert werden.. Entfernen
     einfach? weil das die sub stats haben wissen sie selber" - bei "Alle
     verschmelzen" (siehe bkmpRuneQuickSelectFuseAll) kann diese Liste
     Dutzende/Hunderte Runen einzeln aufzaehlen ("+0 mit 1 Sub-Stat" x50) -
     eine unlesbare Textwand statt einer hilfreichen Warnung. Nur noch die
     Anzahl nennen, keine Einzelaufzaehlung mehr - der Spieler kennt seine
     eigenen Runen ohnehin. */
  const withProgress = runes.filter(r => Number(r.upgrade_level || 0) > 0 || (r.substats && r.substats.length));
  const progressLine = withProgress.length
    ? `\n\n⚠️ ${withProgress.length} der ausgewählten ${slot ? slot.name : 'Runen'} ${withProgress.length === 1 ? 'ist' : 'sind'} bereits aufgewertet - bei Erfolg startet das Ergebnis trotzdem wieder bei +0.`
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
  /* Aufstieg (siehe BKMP_RUNE_ASCEND_MAX_LEVEL oben) - nur relevant, sobald
     eine Legendaere den normalen Cap von +15 erreicht hat. */
  const showAscend = rune.rarity === 'gold' && level >= BKMP_RUNE_MAX_LEVEL;
  const canAscend = bkmpRuneCanAscend(rune);
  const ascendFodder = canAscend ? bkmpRuneFindAscendFodder(rune) : null;
  const ascendCost = canAscend ? bkmpIdleRuneUpgradeCost(rune) : 0;
  const canAffordAscend = canAscend && bkmpIdleState && bkmpIdleState.gold >= ascendCost;
  const isFullyAscended = rune.rarity === 'gold' && level >= BKMP_RUNE_ASCEND_MAX_LEVEL;
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
      ${rune.substats.map((s, i) => {
        const meta = bkmpRuneStatMeta(s.stat);
        const subUnit = s.stat.endsWith('_flat') ? '' : '%';
        const rerollCost = bkmpRuneRerollSubstatCost(rune);
        const canAffordReroll = bkmpIdleState && Number(bkmpIdleState.crystals || 0) >= rerollCost;
        return `<li>${meta.icon} +${s.value}${subUnit} ${escapeHtml(meta.desc)} <button type="button" class="idle-runen-reroll-btn" data-cid="${rune._cid}" data-index="${i}" ${canAffordReroll ? '' : 'disabled'} title="Diesen Sub-Stat neu würfeln (gleicher Bereich wie beim ursprünglichen Fund)">🎲 ${rerollCost} 💎</button></li>`;
      }).join('')}
    </ul>` : '<p class="idle-runen-stat-note">Noch keine Sub-Stats - bei +3/+6/+9/+12 kommt bis zu insgesamt 4 jeweils einer dazu.</p>'}
    <div class="idle-runen-stat-actions">
      <button type="button" class="btn-ja idle-runen-upgrade-btn" id="idleRuneUpgradeBtn" data-cid="${rune._cid}" ${isMaxLevel || !canAffordUpgrade ? 'disabled' : ''} title="${isMaxLevel ? '' : `${upgradeFailPct}% Chance, dass die Aufwertung fehlschlägt (Gold ist dann trotzdem weg)`}">
        ${isMaxLevel ? `⭐ Maximal aufgewertet (+${BKMP_RUNE_MAX_LEVEL})` : `⬆️ Aufwerten (${cost} Gold${upgradeFailPct ? `, ${upgradeFailPct}% Risiko` : ''})`}
      </button>
    </div>
    ${showAscend ? `
    <div class="idle-runen-stat-actions">
      <button type="button" class="btn-ja idle-runen-ascend-btn" id="idleRuneAscendBtn" data-cid="${rune._cid}" ${!canAscend || !ascendFodder || !canAffordAscend ? 'disabled' : ''} title="Verbraucht eine zweite unausgerüstete Legendäre desselben Slots UND derselben Stufe, um +1 Stufe zu erreichen (bis +${BKMP_RUNE_ASCEND_MAX_LEVEL}).">
        ${isFullyAscended ? `🌟 Vollständig aufgestiegen (+${BKMP_RUNE_ASCEND_MAX_LEVEL})` : `🌟 Aufsteigen auf +${level + 1} (${ascendCost} Gold${ascendFodder ? '' : `, 2. +${level} Legendäre nötig`})`}
      </button>
    </div>` : ''}
    <div class="idle-runen-stat-actions">
      <button type="button" class="btn-nein idle-runen-fuse-btn" id="idleRuneFuseBtn" data-rarity="${rune.rarity}" ${canFuse ? '' : 'disabled'}>
        ✨ Verschmelzen (auswählen)${canFuse ? '' : ` (${sameGroup.length}/3)`}
      </button>
      <button type="button" class="btn-nein idle-runen-sell-btn" id="idleRuneSellBtn" data-cid="${rune._cid}" ${rune.equipped ? 'disabled' : ''}>
        💰 verkaufen (+${bkmpRuneSellValue(rune)})
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
  bkmpRuneDeleteRemote(consumedIds, 'Verschmelzen');
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === slotId);
  const rarityDef = window.BKMP_RUNE_RARITIES[rarityIndex];

  const failChance = BKMP_RUNE_FUSE_FAIL_CHANCE[rarityId] || 0;
  if (Math.random() < failChance) {
    bkmpIdleLog(`💥 3× ${slot.name} (${rarityDef.name}) beim Verschmelzen zerstört - kein Ergebnis!`);
    if (bkmpIdleState) {
      bkmpIdleState.rune_fuse_failures = Number(bkmpIdleState.rune_fuse_failures || 0) + 1;
      bkmpIdleQueueSync();
    }
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
  if (bkmpIdleState) {
    bkmpIdleState.rune_fuse_successes = Number(bkmpIdleState.rune_fuse_successes || 0) + 1;
    bkmpIdleQueueSync();
  }
  bkmpRuneCurrentlyViewing = newRune._cid;
  bkmpIdleRenderRunenPanel();
  return { success: true, newRune };
}

/* Fuer die "alle 6 Slots gleiche Seltenheit"-Erfolge - gibt die geteilte
   Seltenheits-id zurueck, nur wenn WIRKLICH alle 6 Slots belegt UND
   gleich sind, sonst null (unvollstaendige Ausruestung zaehlt nicht). */
function bkmpIdleAllEquippedRarity() {
  const equipped = bkmpIdlePlayerRunes.filter(r => r.equipped);
  if (equipped.length !== window.BKMP_RUNE_SLOTS.length) return null;
  const rarity = equipped[0].rarity;
  return equipped.every(r => r.rarity === rarity) ? rarity : null;
}

/* Fuer die "alle 6 Slots mindestens +N"-Erfolge - Minimum ueber alle
   ausgeruesteten Runen, -1 solange nicht alle 6 Slots belegt sind. */
function bkmpIdleAllEquippedMinLevel() {
  const equipped = bkmpIdlePlayerRunes.filter(r => r.equipped);
  if (equipped.length !== window.BKMP_RUNE_SLOTS.length) return -1;
  return equipped.reduce((min, r) => Math.min(min, Number(r.upgrade_level || 0)), Infinity);
}

/* Balance-Nachbesserung 17.07. ("Verkaufen ist witzlos ... eine +12
   Legendaere mit 3 Sub-Stats verkauft sich genauso billig wie eine
   frische +0"): der Verkaufswert war bisher NUR von der Seltenheit
   abhaengig (fixe rarity.sellGold), Stufe/Sub-Stats floss nie mit ein.
   Jetzt: +15% des Basiswerts pro Aufwertungs-Stufe, +25% pro Sub-Stat -
   eine ausgereizte Legendaere (+15, 4 Sub-Stats) verkauft sich dadurch
   fuer etwa das 6,5-fache einer frischen. */
function bkmpRuneSellValue(rune) {
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rune.rarity);
  const base = rarity ? rarity.sellGold : 10;
  const level = Number(rune.upgrade_level || 0);
  const substatCount = (rune.substats || []).length;
  return Math.round(base * (1 + level * 0.15) * (1 + substatCount * 0.25));
}
function bkmpRuneSell(cid) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || rune.equipped || !bkmpIdleState) return;
  const value = bkmpRuneSellValue(rune);
  bkmpIdlePlayerRunes = bkmpIdlePlayerRunes.filter(r => r !== rune);
  bkmpIdleState.gold += value;
  if (rune.id) bkmpRuneDeleteRemote([rune.id], 'Einzelverkauf');
  if (bkmpRuneCurrentlyViewing === cid) bkmpRuneCurrentlyViewing = null;
  bkmpIdleRenderHud();
  bkmpIdleRenderRunenPanel();
  bkmpIdleQueueSync();
}
/* Sammel-Verkauf (Community-Wunsch 17.07., Pendant zu "Alle
   verschmelzen"): verkauft ALLE unausgeruesteten Runen des aktuell
   offenen Slot-Tabs auf einmal - bewusst NUR den aktiven Slot, nicht
   alle 6 gleichzeitig, damit man nicht versehentlich Verschmelzen-/
   Aufstiegs-Fodder in einem anderen Slot mitverkauft. Mit Bestaetigung
   vorher (Gesamtwert + Anzahl), da nicht rueckgaengig machbar. */
async function bkmpRuneSellAllDuplicates() {
  const activeSlot = window.BKMP_RUNE_SLOTS.find(s => s.id === bkmpRuneActiveSlotTab);
  if (!activeSlot || !bkmpIdleState) return;
  const candidates = bkmpIdlePlayerRunes.filter(r => r.rune_type === activeSlot.id && !r.equipped);
  if (!candidates.length) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`Keine unausgerüsteten ${activeSlot.name} zum Verkaufen.`, 2600);
    return;
  }
  const totalValue = candidates.reduce((sum, r) => sum + bkmpRuneSellValue(r), 0);
  const confirmed = await bkmpConfirmDialog(
    `💰 ${candidates.length}× ${activeSlot.name} verkaufen?`,
    `Verkauft alle ${candidates.length} unausgerüsteten ${activeSlot.name} für insgesamt ${bkmpIdleFormatNumber(totalValue)} Gold.\n\n⚠️ Das gilt auch für bereits aufgewertete Runen, die du evtl. noch als 2. Rune fürs Verschmelzen oder den Aufstieg brauchst - nicht rückgängig machbar.`,
    'Ja, verkaufen',
    'Abbrechen'
  );
  if (!confirmed) return;
  const ids = candidates.map(r => r.id).filter(Boolean);
  bkmpIdlePlayerRunes = bkmpIdlePlayerRunes.filter(r => !candidates.includes(r));
  bkmpRuneDeleteRemote(ids, 'Sammelverkauf');
  bkmpIdleState.gold += totalValue;
  if (candidates.some(r => r._cid === bkmpRuneCurrentlyViewing)) bkmpRuneCurrentlyViewing = null;
  bkmpIdleLog(`💰 ${candidates.length}× ${activeSlot.name} verkauft für ${bkmpIdleFormatNumber(totalValue)} Gold.`);
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`💰 ${candidates.length}× verkauft: +${bkmpIdleFormatNumber(totalValue)} Gold`, 3200);
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
      <p class="idle-runen-fuse-hint">Wähle unten im Lager ${escapeHtml(rarity.name)}-Kopien in einer Dreiergruppe aus - ${failPct}% Chance, dass die 3 Runen dabei zerstört werden statt zu gelingen.</p>
      <div class="idle-runen-fuse-quick-select">
        <button type="button" class="btn-nein idle-runen-fuse-quick-btn" data-count="3" ${availableCount < 3 ? 'disabled' : ''}>3 auswählen</button>
        <button type="button" class="btn-nein idle-runen-fuse-quick-btn idle-runen-fuse-all-btn" id="idleRuneFuseAllBtn" ${availableCount < 3 ? 'disabled' : ''}>Alle verschmelzen</button>
      </div>
      <div class="idle-runen-fuse-progress">${count} ausgewählt${!isValidCount && count ? ' <span class="idle-runen-fuse-warn">⚠️ muss Vielfaches von 3 sein</span>' : ''}${hasProgress ? ' <span class="idle-runen-fuse-warn">⚠️ enthält Aufwertung</span>' : ''}</div>
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
/* FEHLER-FIX (Spieler-Screenshot 15.07., "Volle Optimierung für kleinere
   Auflösungen"): auf schmaleren Fenstern (z.B. 1366px - ein sehr
   gaengiges Laptop-Format) fuellt die Karte fast die ganze Breite aus,
   sodass rechts davon kein Platz mehr fuer den 360px breiten Balken
   bleibt - er wurde bisher trotzdem stur an "Kartenkante" positioniert und
   ragte dadurch weit ueber den rechten Bildschirmrand hinaus (nur ein
   schmaler Streifen war noch sichtbar/bedienbar). Jetzt wird zusaetzlich
   die tatsaechlich verfuegbare Fensterbreite beruecksichtigt: reicht der
   Platz nicht, dockt der Balken stattdessen an die rechte BILDSCHIRM-Kante
   (ueberlappt dann leicht die Karte) statt teilweise unsichtbar zu sein -
   auf breiten Fenstern (genug Platz) bleibt das bisherige "flush an die
   Karte"-Verhalten unveraendert. */
function bkmpRuneSyncDrawerPosition() {
  const drawer = document.getElementById('idleRuneDrawer');
  const card = document.querySelector('.idle-dorf-overlay .idle-dorf-card');
  if (!drawer || !card || !drawer.classList.contains('visible')) return;
  const rect = card.getBoundingClientRect();
  const drawerWidth = drawer.offsetWidth || 360;
  const maxLeft = window.innerWidth - drawerWidth - 8;
  drawer.style.left = Math.max(0, Math.min(Math.round(rect.right), maxLeft)) + 'px';
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

  /* FEHLER-FIX (Spieler-Meldung 15.07.: "Wenn man runterscrollt.. scrollt
     er automatisch direkt wieder hoch") - dieser Neuaufbau laeuft ueber
     bkmpIdleRefreshLiveTabs() bei JEDEM Drachen-Kill (also im Kampf
     ungefaehr einmal pro Sekunde), damit Menge/Sortierung live aktuell
     bleiben. drawerContent.innerHTML = ... ersetzt dabei den kompletten
     Lager-Bereich inkl. des scrollbaren Containers durch ein frisches,
     neues Element - das hat IMMER scrollTop 0, die eigene Scroll-Position
     im Lager ging dadurch bei jedem Kill sofort wieder verloren. Vorher
     merken, hinterher auf dem neuen Element wiederherstellen. */
  const oldInventoryScroll = drawerContent.querySelector('.idle-runen-inventory-scroll');
  const savedInventoryScrollTop = oldInventoryScroll ? oldInventoryScroll.scrollTop : 0;

  const unequippedSlotCount = slotOwned.filter(r => !r.equipped).length;
  const autoFuseGroupCount = window.BKMP_RUNE_RARITIES.filter(r => r.id !== 'gold').reduce((sum, rarity) => {
    const c = slotOwned.filter(r => r.rarity === rarity.id && !r.equipped).length;
    return sum + Math.floor(c / 3);
  }, 0);
  const autoAscendPairCount = bkmpRuneAutoAscendPairs(slotOwned).length;
  drawerContent.innerHTML = `
    <div class="idle-runen-inventory-header">
      <h4 class="idle-sammlung-subheading">🎒 ${escapeHtml(activeSlot.name)}-Lager <span class="idle-sammlung-count">${slotOwned.length} von ${totalOwned} gesamt</span></h4>
      <div class="idle-runen-inventory-header-actions">
        <button type="button" class="btn-nein idle-runen-autofuse-btn" id="idleRuneAutoFuseBtn" ${autoFuseGroupCount ? '' : 'disabled'}>
          🔥 Auto-Schmelzen${autoFuseGroupCount ? ` (${autoFuseGroupCount})` : ''}
        </button>
        <button type="button" class="btn-nein idle-runen-autoascend-btn" id="idleRuneAutoAscendBtn" ${autoAscendPairCount ? '' : 'disabled'} title="Aufstieg für alle passenden Legendäre-Paare gleicher Stufe (ab +${BKMP_RUNE_MAX_LEVEL}) auf einmal.">
          🌟 Auto-Aufstieg${autoAscendPairCount ? ` (${autoAscendPairCount})` : ''}
        </button>
        <button type="button" class="btn-nein idle-runen-sell-all-btn" id="idleRuneSellAllBtn" ${unequippedSlotCount ? '' : 'disabled'}>
          💰 Alle verkaufen${unequippedSlotCount ? ` (${unequippedSlotCount})` : ''}
        </button>
      </div>
    </div>
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
  const newInventoryScroll = drawerContent.querySelector('.idle-runen-inventory-scroll');
  if (newInventoryScroll && savedInventoryScrollTop) newInventoryScroll.scrollTop = savedInventoryScrollTop;

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
  const ascendBtn = document.getElementById('idleRuneAscendBtn');
  if (ascendBtn) ascendBtn.addEventListener('click', () => bkmpRuneAscend(ascendBtn.dataset.cid));
  panel.querySelectorAll('.idle-runen-reroll-btn').forEach(btn => btn.addEventListener('click', () => bkmpRuneRerollSubstat(btn.dataset.cid, Number(btn.dataset.index))));
  const fuseBtn = document.getElementById('idleRuneFuseBtn');
  if (fuseBtn) fuseBtn.addEventListener('click', () => bkmpRuneStartFuseSelection(fuseBtn.dataset.rarity));
  const sellBtn = document.getElementById('idleRuneSellBtn');
  if (sellBtn) sellBtn.addEventListener('click', () => bkmpRuneSell(sellBtn.dataset.cid));
  const fuseConfirmBtn = document.getElementById('idleRuneFuseConfirmBtn');
  if (fuseConfirmBtn) fuseConfirmBtn.addEventListener('click', bkmpRuneConfirmFuseSelection);
  const fuseCancelBtn = document.getElementById('idleRuneFuseCancelBtn');
  if (fuseCancelBtn) fuseCancelBtn.addEventListener('click', bkmpRuneCancelFuseSelection);
  panel.querySelectorAll('.idle-runen-fuse-quick-btn[data-count]').forEach(btn => btn.addEventListener('click', () => bkmpRuneQuickSelectFuse(Number(btn.dataset.count))));
  const fuseAllBtn = document.getElementById('idleRuneFuseAllBtn');
  if (fuseAllBtn) fuseAllBtn.addEventListener('click', bkmpRuneQuickSelectFuseAll);
  const sellAllBtn = document.getElementById('idleRuneSellAllBtn');
  if (sellAllBtn) sellAllBtn.addEventListener('click', bkmpRuneSellAllDuplicates);
  const autoFuseBtn = document.getElementById('idleRuneAutoFuseBtn');
  if (autoFuseBtn) autoFuseBtn.addEventListener('click', bkmpRuneAutoFuseAll);
  const autoAscendBtn = document.getElementById('idleRuneAutoAscendBtn');
  if (autoAscendBtn) autoAscendBtn.addEventListener('click', bkmpRuneAutoAscendAll);
  const runenHelpBtn = document.getElementById('idleRunenHelpBtn');
  if (runenHelpBtn) runenHelpBtn.addEventListener('click', bkmpIdleOpenRunenHelp);
}

/* ---------------- Tabs & Modal ---------------- */

const bkmpIdleTabs = [
  { id: 'kampf', btn: 'idleTabBtnKampf', panel: 'idlePanelKampf', render: null },
  { id: 'upgrades', btn: 'idleTabBtnUpgrades', panel: 'idlePanelUpgrades', render: bkmpIdleRenderUpgradesPanel },
  { id: 'skilltree', btn: 'idleTabBtnSkilltree', panel: 'idlePanelSkilltree', render: bkmpIdleRenderSkilltreePanel },
  { id: 'erfolge', btn: 'idleTabBtnErfolge', panel: 'idlePanelErfolge', render: bkmpIdleRenderErfolgePanel },
  { id: 'prestige', btn: 'idleTabBtnPrestige', panel: 'idlePanelPrestige', render: bkmpIdleRenderPrestigePanel },
  { id: 'runen', btn: 'idleTabBtnRunen', panel: 'idlePanelRunen', render: bkmpIdleRenderRunenPanel },
  { id: 'skins', btn: 'idleTabBtnSkins', panel: 'idlePanelSkins', render: bkmpIdleRenderSkinsPanel },
  { id: 'dungeon', btn: 'idleTabBtnDungeon', panel: 'idlePanelDungeon', render: bkmpIdleRenderDungeonPanel },
  { id: 'turm', btn: 'idleTabBtnTurm', panel: 'idlePanelTurm', render: bkmpIdleRenderTurmPanel },
  { id: 'arena', btn: 'idleTabBtnArena', panel: 'idlePanelArena', render: bkmpIdleRenderArenaPanel },
  { id: 'gilde', btn: 'idleTabBtnGilde', panel: 'idlePanelGilde', render: bkmpIdleRenderGildePanel },
  { id: 'gildetech', btn: 'idleTabBtnGildeTech', panel: 'idlePanelGildeTech', render: bkmpIdleRenderGildeTechPanel },
  { id: 'gildeboss', btn: 'idleTabBtnGildeBoss', panel: 'idlePanelGildeBoss', render: bkmpIdleRenderGildeBossPanel },
  { id: 'bestenliste', btn: 'idleTabBtnBestenliste', panel: 'idlePanelBestenliste', render: bkmpIdleRenderBestenlistePanel },
  { id: 'drachen', btn: 'idleTabBtnDrachen', panel: 'idlePanelDrachen', render: bkmpIdleRenderDragonsPanel }
];
let bkmpIdleActiveTab = 'kampf';

/* Test-Account (Nutzerwunsch 16.07.: "test123" braucht vollen Zugriff auf
   noch gesperrte Tabs zum Testen, ohne den Tab fuer alle anderen
   Spieler mit freizugeben). name_key ist schon durchgehend lowercase
   (bkmpIdleLoadOrInitState), deshalb reicht ein direkter Vergleich. */
const BKMP_IDLE_TESTER_NAMES = ['test123'];
function bkmpIdleIsTesterAccount() {
  return !!(bkmpIdleState && BKMP_IDLE_TESTER_NAMES.includes(bkmpIdleState.name_key));
}
function bkmpIdleSyncLockedTabVisuals() {
  const isTester = bkmpIdleIsTesterAccount();
  bkmpIdleTabs.forEach(t => {
    if (!t.locked) return;
    const btn = document.getElementById(t.btn);
    if (btn) btn.classList.toggle('idle-dorf-tab-locked', !isTester);
  });
}

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
/* Throttle (Perf-Audit 15.07.): bei hoher Angriffsgeschwindigkeit kann
   diese Funktion deutlich unter 900ms pro Kill erneut aufgerufen werden -
   ohne Bremse baute der aktive Tab (v.a. Runen/Drachen mit grossem
   Lager/Roster) dann mehrfach pro Sekunde komplett neu, spuerbares
   Ruckeln waehrend aktivem Kampf. Sofort-Rendern beim ersten Aufruf
   (kein gefuehltes Lag), danach max. alle 300ms; verpasste Zwischen-
   staende werden am Ende des Fensters einmal nachgeholt. */
let bkmpIdleRefreshLiveTabsTimer = null;
let bkmpIdleRefreshLiveTabsPending = false;
function bkmpIdleRefreshLiveTabs() {
  if (bkmpIdleRefreshLiveTabsTimer) { bkmpIdleRefreshLiveTabsPending = true; return; }
  bkmpIdleRefreshLiveTabsRender();
  bkmpIdleRefreshLiveTabsTimer = window.setTimeout(() => {
    bkmpIdleRefreshLiveTabsTimer = null;
    if (bkmpIdleRefreshLiveTabsPending) {
      bkmpIdleRefreshLiveTabsPending = false;
      bkmpIdleRefreshLiveTabsRender();
    }
  }, 300);
}
function bkmpIdleRefreshLiveTabsRender() {
  if (bkmpIdleActiveTab === 'upgrades') bkmpIdleRenderUpgradesPanel();
  else if (bkmpIdleActiveTab === 'runen') bkmpIdleRenderRunenPanel();
  else if (bkmpIdleActiveTab === 'prestige') bkmpIdleRenderPrestigePanel();
  else if (bkmpIdleActiveTab === 'skins') bkmpIdleRenderSkinsPanel();
  else if (bkmpIdleActiveTab === 'drachen') bkmpIdleRenderDragonsPanel();
}

function bkmpIdleInitTabs() {
  bkmpIdleTabs.forEach(t => {
    const btn = document.getElementById(t.btn);
    if (!btn) return;
    btn.addEventListener('click', () => {
      /* Dorf-Skins noch gesperrt (Nutzerwunsch 14.07.) - Tab bleibt sichtbar
         (als Vorschau/Ankuendigung), laesst sich aber noch nicht oeffnen.
         Ausnahme: Test-Accounts (Nutzerwunsch 16.07., siehe
         BKMP_IDLE_TESTER_NAMES) duerfen zum Testen trotzdem rein. */
      if (t.locked && !bkmpIdleIsTesterAccount()) {
        if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🔒 Dorf-Skins sind noch gesperrt - schau bald wieder vorbei!', 3200);
        return;
      }
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
}

/* ---------------- Live-Kampf-Broadcast fuers OBS-Mini-Overlay ----------------
   Umbau 17.07. (Nutzerwunsch: "das Große entfernen, das Kleine soll nur
   noch visuell sein - Klicken/Interagieren nur noch Hauptseite... auf der
   Hauptseite kämpft/klickert sie gegen einen Winddrache und das soll man im
   OBS-Stream sehen"): loest das alte Herzschlag+Poll+Lock-System komplett
   ab (zwei Seiten konnten dort unabhaengig voneinander kaempfen, siehe
   Git-Historie). Jetzt gibt es nur noch EINE aktive Spiel-Instanz - die
   Hauptseite - die ihren aktuellen Kampf-Zustand ueber einen reinen
   Realtime-BROADCAST-Kanal sendet (keine Tabelle, keine Persistenz noetig,
   Drachen-HP war noch nie gespeichert und muss es dafuer auch nicht werden -
   ein Broadcast ist fluechtig und kostet quasi nichts). Das Mini-Overlay
   (idle-stream-mini.html) hat KEINE eigene Spiellogik mehr, sondern
   abonniert nur und zeichnet rein visuell nach. */
function bkmpIdleBroadcastCombatState() {
  if (window.BKMP_IDLE_IS_STREAM_PAGE || !bkmpIdleState || !bkmpIdleCurrentDragon || !bkmpIdleEffectiveStats) return;
  if (typeof bkmpBroadcastCombatState !== 'function') return;
  bkmpBroadcastCombatState(bkmpIdleState.name_key, {
    dragonSpriteKey: bkmpIdleCurrentDragon.spriteKey,
    dragonName: bkmpIdleCurrentDragon.name,
    dragonHp: bkmpIdleCurrentDragon.hp,
    dragonMaxHp: bkmpIdleCurrentDragon.maxHp,
    isBoss: bkmpIdleCurrentDragon.bossTier === 'boss',
    isMiniboss: bkmpIdleCurrentDragon.bossTier === 'miniboss',
    isEventDragon: Boolean(bkmpIdleCurrentDragon.isEventDragon),
    villageHp: bkmpIdleVillageHp,
    villageMaxHp: bkmpIdleEffectiveStats.hp,
    villageSkinId: typeof bkmpGetActiveVillageSkinId === 'function' ? bkmpGetActiveVillageSkinId() : null,
    level: bkmpIdleState.level
  });
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
  /* Nutzer-Meldung: "laggt kurz, dann springen Bilder vom Raidboss fuer
     Millisekunden durch". Ursache gefunden: das Fenster wird HIER schon
     sichtbar, bevor auch nur ein einziger Render-Aufruf unten gelaufen ist
     - bis dahin muessen erst 2-3 Netzwerk-Aufrufe durchlaufen
     (bkmpIdleEnsureConfigLoaded/bkmpIdleLoadOrInitState/
     bkmpIdleClaimOfflineProgress). In dieser Luecke zeigt das Fenster
     genau das, was seit dem letzten Oeffnen noch im DOM stand (z.B. noch
     der Raid-Kampf-Tab von einer frueheren Sitzung) - das ist das
     "Durchspringen". Fix: HUD/Stufenleiste/Tableiste/alle Panels bleiben
     unsichtbar (visibility, kein display - kein Layout-Sprung beim
     Wiedererscheinen), bis unten wirklich alles neu gerendert UND die
     Raid-Ansicht-Entscheidung (bkmpRaidShouldShowCombatView) getroffen
     wurde. */
  const idleDorfCard = overlay.querySelector('.idle-dorf-card');
  if (idleDorfCard) idleDorfCard.classList.add('idle-dorf-loading');

  await bkmpIdleEnsureConfigLoaded();
  await bkmpIdleLoadOrInitState(name);
  if (!bkmpIdleState) {
    /* Echter Ladefehler (siehe bkmpIdleLoadOrInitState) - auf keinen Fall mit
       leerem/kaputtem Spielstand weitermachen, sonst droht ein Autosave mit
       Nullen. Fenster wieder schliessen und zum Neuversuch auffordern. */
    overlay.classList.remove('visible');
    document.body.classList.remove('modal-open');
    bkmpIdleModalOpen = false;
    if (idleDorfCard) idleDorfCard.classList.remove('idle-dorf-loading');
    if (typeof bkmpShowJannikToast === 'function') {
      bkmpShowJannikToast('Dein Spielstand konnte nicht geladen werden (Verbindungsproblem). Bitte versuche es gleich nochmal, damit nichts überschrieben wird.', 6000);
    }
    return;
  }
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleSyncLockedTabVisuals();

  const offlineResult = await bkmpIdleClaimOfflineProgress(name);
  if (offlineResult) bkmpIdleApplyOfflineResult(offlineResult);
  bkmpIdleShowOfflineCard(offlineResult);
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleCheckDailyStreak();

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

  bkmpRaidRenderJoinBanner();
  if (bkmpRaidShouldShowCombatView()) {
    bkmpIdleStopLoop();
    bkmpRaidStartCombatView(bkmpRaidGetPhaseInfo().raidId);
  }
  /* Ab hier hat bkmpRaidToggleCombatView() (synchroner Teil ganz am Anfang
     von bkmpRaidStartCombatView) bereits entschieden, welches Panel
     tatsaechlich sichtbar sein soll - jetzt erst aufdecken. Die reinen
     Zahlen im Raid-Panel selbst (bossHp usw.) koennen noch einen Moment
     nachladen, das ist ein normales, kleines Live-Update wie beim
     Mini-Widget auch - kein falsches Panel mehr, das war der gemeldete Bug. */
  if (idleDorfCard) idleDorfCard.classList.remove('idle-dorf-loading');
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
  /* Spieler-Report (15.07.): "Das Fenster der Drachen ploppt noch im
     Hintergrund auf" - Drachen-Detail-Popup (bkmpDragonOpenDetail) hatte
     nur einen eigenen Schliessen-Button/ESC, war aber NICHT an den
     Haupt-Schliessen-Button dieses Fensters gekoppelt. Blieb es offen und
     wurde ueber diesen Button geschlossen statt ueber ESC, hing es danach
     einsam ueber der normalen Seite (kein Idle-Dorf-Fenster mehr dahinter). */
  const dragonDetailOverlay = document.getElementById('idleDragonDetailOverlay');
  if (dragonDetailOverlay) dragonDetailOverlay.classList.remove('visible');
  bkmpDragonStopNestCountdownTicker();
  document.body.classList.remove('modal-open');
  bkmpIdleModalOpen = false;
  bkmpRuneSyncDrawerVisibility();
  bkmpIdleQueueSync();
  bkmpIdleFlushSync();
  bkmpRaidStopCombatView();
  bkmpGuildBossStopLoop();
}

function bkmpIdlePreloadStateIfNamed() {
  const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
  if (!name) return;
  bkmpIdleLoadOrInitState(name)
    .then(() => { if (typeof renderAchievementBadge === 'function') renderAchievementBadge(true); })
    .catch(() => {});
  bkmpRaidRefreshAchievementCache();
  bkmpArenaRefreshAchievementCache();
  bkmpGuildRefreshTreasuryBonusCache();
  bkmpGuildStartPresenceHeartbeat();
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
/* App-Modus (Phase 16): echter Tap-Schaden-Zaehler fuer die aktuelle
   Raid-Teilnahme (kein Fake-Wert - Summe der tatsaechlich per Tipp auf
   den Boss ausgeteilten clickDamage-Betraege, siehe
   bkmpRaidHandleBossClick weiter unten). Setzt sich automatisch zurueck,
   sobald bkmpRaidRenderCombat() eine neue Raid-Id sieht (naechster Raid
   = neue Zaehlung). Auf der normalen Website ungenutzt (kein Element mit
   diesen IDs vorhanden), daher folgenlos. */
let bkmpRaidTapDamageSession = 0;
let bkmpRaidTapDamageSessionId = null;

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

/* Spieler-Feedback (viceBlade, 13.7.): "die minus Lebenspunkte [sollen]
   angezeigt werden wo man auch hin klickt anstatt auf einer bestimmten
   Stelle" - clientX/clientY (falls vorhanden, siehe bkmpIdleHandleDragonClick)
   ueberschreiben per Inline-Style die feste CSS-Position (left:65%/top:-6px
   aus .idle-dmg-click) mit der tatsaechlichen Klick-Position relativ zum
   Drachen-Kasten. Ohne Koordinaten (z.B. Leertaste als Klick-Ersatz) faellt
   die Zahl auf die alte, feste Position zurueck. */
function bkmpIdleSpawnClickDamage(amount, clientX, clientY) {
  const target = document.getElementById('idleDragon');
  if (!target) return;
  const dmg = document.createElement('span');
  dmg.className = 'idle-dmg-float idle-dmg-click';
  dmg.textContent = '-' + Math.round(amount);
  if (typeof clientX === 'number' && typeof clientY === 'number') {
    /* Nur left/top ueberschreiben, NICHT transform - die bestehende
       idleDmgFloat-Animation (@keyframes) steuert transform selbst
       (translate(-50%, 0) -> translate(-50%, -34px)) fuer den Hochschweb-
       Effekt. translate(-50%, ...) zentriert die Zahl dabei automatisch
       horizontal genau auf dem hier gesetzten left-Wert - deckt sich exakt
       mit dem Klickpunkt, kein zusaetzlicher Transform noetig/sinnvoll
       (wuerde vom Animations-Keyframe ohnehin sofort ueberschrieben). */
    const rect = target.getBoundingClientRect();
    dmg.style.left = Math.round(clientX - rect.left) + 'px';
    dmg.style.top = Math.round(clientY - rect.top) + 'px';
  }
  target.appendChild(dmg);
  window.setTimeout(() => dmg.remove(), 800);
}

function bkmpIdleHandleDragonClick(e) {
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
  bkmpIdleSpawnClickDamage(clickDamage, e && typeof e.clientX === 'number' ? e.clientX : undefined, e && typeof e.clientY === 'number' ? e.clientY : undefined);
  bkmpIdleSpawnHitFlash('idleDragon');
  bkmpIdleUpdateDragonHpBar();

  if (bkmpIdleCurrentDragon.hp <= 0) {
    bkmpIdleHandleDragonDefeated();
  } else {
    /* Ueberlebt der Drache den Klick, schlaegt er jetzt genau wie beim Tick
       zurueck - siehe bkmpIdleDragonCounterAttack. Nur der wirklich
       toedliche Treffer (oben) bleibt weiterhin gegenschlagfrei. */
    bkmpIdleDragonCounterAttack(bkmpIdleEffectiveStats);
    bkmpIdleBroadcastCombatState();
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
/* Spieler-Meldung 18.07.: "Ich will auch zwischendurch Infos haben wieviel
   Damage jeder macht.. Eine dauerhafte Live-Anzeige von Anfang bis Ende" -
   bisher aktualisierten sich die Schaden-Zahlen ANDERER Spieler nur beim
   Oeffnen der Kampfansicht und kurz vorm Sieg/Niederlage-Ergebnis, dazwischen
   ausschliesslich ueber das Realtime-Abo auf raid_participants (siehe
   bkmpSubscribeToRaidInstance) - das liefert offenbar nicht zuverlaessig
   genug. Gleiches Prinzip wie der bereits bestehende bkmpRaidBossPoll-
   Fallback fuer raid_instances (dessen eigener Kommentar das bereits als
   bekanntes Realtime-Aussetzer-Muster beschreibt): ein simpler Zeit-Poll
   als garantierte Grundlage, Realtime bleibt zusaetzlich fuer schnelleres
   Update aktiv, wenn es funktioniert. */
const BKMP_RAID_PARTICIPANTS_POLL_MS = 3000;

let bkmpRaidState = null;
let bkmpRaidParticipants = [];
let bkmpRaidJoinedId = null;
/* Sync-Fix (Spieler-Meldung 15.07., Screenshot: eigene Zeile in der
   Teilnehmerliste zeigte 0/veraltet, obwohl schon Schaden gemacht wurde):
   bkmpRaidApplyOwnDamageResult matchte die eigene Zeile bisher per
   displayName-String-Vergleich (bkmpGetMcName()), waehrend die Realtime-
   Aktualisierung fuer ALLE ANDEREN Teilnehmer (siehe bkmpSubscribeToRaidInstance
   weiter unten) per authUserId matcht - zwei verschiedene Schluessel fuer
   dieselbe Liste. Sobald der lokale Anzeigename nicht exakt (Gross-/
   Kleinschreibung, Leerzeichen, Sonderzeichen wie Umlaute) mit dem in der
   DB gespeicherten display_name uebereinstimmt, fand der String-Vergleich
   keine Zeile und legte STATTDESSEN eine zweite, verwaiste Zeile
   (authUserId: null) an, die danach nie wieder von Realtime-Updates
   erreicht wird - das Ergebnis sind doppelte/veraltete Eintraege fuer
   denselben Spieler. Gleiches Muster wie bkmpArenaMyAuthUserId/
   bkmpGuildMyAuthUserId - einmal beim Oeffnen der Kampfansicht per
   Session-Check ermittelt, danach fuer den korrekten Abgleich genutzt. */
let bkmpRaidMyAuthUserId = null;
async function bkmpRaidEnsureMyAuthUserId() {
  if (bkmpRaidMyAuthUserId) return bkmpRaidMyAuthUserId;
  const client = typeof bkmpGetPlayerAuthClient === 'function' ? bkmpGetPlayerAuthClient() : null;
  if (!client) return null;
  try {
    const { data: sessionData } = await client.auth.getSession();
    bkmpRaidMyAuthUserId = sessionData && sessionData.session && sessionData.session.user ? sessionData.session.user.id : null;
  } catch (e) { bkmpRaidMyAuthUserId = null; }
  return bkmpRaidMyAuthUserId;
}
let bkmpRaidButtonTimer = null;
let bkmpRaidLoopTimer = null;
let bkmpRaidBossPollTimer = null;
let bkmpRaidParticipantsPollTimer = null;
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

/* Spieler-Wunsch (17.07.): der staendliche Weltboss-Raid ueberschnitt sich
   in der 20-Uhr-Stunde (Europe/Berlin) mit dem taeglich fest um 20 Uhr
   laufenden Gildenboss (siehe bkmpGuildBossGetPhaseInfo) - beide buhlten
   um dieselbe Aufmerksamkeit. Der Raid faellt jetzt genau in dieser einen
   Stunde jeden Tag aus (alle anderen 23 Stunden laufen unveraendert
   weiter), damit der Fokus auf dem Gildenboss liegt. Berlin-Stunde statt
   UTC-Stunde, DST-sicher, gleiches Muster wie bkmpGuildBossBerlinDateAt.

   FEHLER-FIX (Spieler-Report per Screenshot 15.07.: "Es sollte doch jetzt
   Gilden Boss sein? bin verwirrt" - beide Banner ("Raidboss erscheint
   gleich" UND "Gildenboss-Vorbereitung") gleichzeitig sichtbar): dieser
   Check verglich bisher nur "Stunde === 20", die Gildenboss-Vorbereitung
   (siehe bkmpGuildBossGetPhaseInfo) faengt aber schon um 19:55 an - fuenf
   Minuten lang war das hier also noch Stunde 19 und lieferte faelschlich
   false, obwohl der Gildenboss sich schon in der Vorbereitung befand.
   Jetzt ueber Minuten-des-Tages verglichen (19:55 bis 21:00), exakt
   deckungsgleich mit dem tatsaechlichen Gildenboss-Fenster (prep+fight)
   statt nur dessen Kampf-Phase. */
/* Spieler-Report (15.07., "Warum kommt die Meldung eigentlich jetzt? Die
   haette um 19:55->20:00 kommen sollen"): beide Aufrufer unten riefen
   diese Funktion bisher OHNE Argument auf, sie prüfte also immer die
   AKTUELLE Uhrzeit. Beide Aufrufer laufen aber ausschliesslich waehrend
   der Vorbereitungsphase (info.phase === 'prep', taeglich jeweils :55-:59
   JEDER Stunde) - um 20:55-20:59 (Vorbereitung fuer den ganz normalen
   21-Uhr-Raid) liegt "jetzt" ebenfalls noch im 19:55-21:00-Fenster, die
   Funktion lieferte also faelschlich true und unterdrueckte Button-Glow
   und zeigte das "Weltboss pausiert"-Banner fuer einen Raid, der gar
   nicht pausiert. Jetzt uebergeben beide Aufrufer stattdessen den
   Start-Zeitpunkt DES RAIDS, fuer den gerade vorbereitet wird
   (info.fightStartsAt) - nur DESSEN Stunde entscheidet, nicht "jetzt". */
function bkmpRaidIsGuildBossHourBerlin(now) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, hour: '2-digit', minute: '2-digit' })
    .formatToParts(now || new Date()).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  const minutesOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  return minutesOfDay >= 19 * 60 + 55 && minutesOfDay < 21 * 60;
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

/* FEHLER-FIX (Spieler-Report 14.07.: "Er hat gerade den Welt-Raidboss
   gemacht, aber wurde im [OBS-]Overlay nicht angezeigt") - der Beitritt
   wurde bisher AUSSCHLIESSLICH per localStorage-Flag erkannt
   (bkmpRaidHasJoined oben). localStorage ist NICHT geteilt zwischen dem
   normalen Browser (wo "Jetzt beitreten" geklickt wurde) und dem OBS-
   Browser-Source-Prozess (idle-stream.html/idle-stream-mini.html) - selbst
   wenn dort der GLEICHE Account eingeloggt ist, sieht der eigene
   Chromium-Prozess von OBS diesen Flag nie. Die Kampfansicht blieb dadurch
   im Overlay unsichtbar, obwohl der Account serverseitig laengst als
   Teilnehmer registriert war.
   Fix: einmalig pro Raid-ID (bkmpRaidServerJoinCheckedFor als Sperre -
   kein Wiederholungs-Polling, um kein zusaetzliches Egress zu erzeugen)
   serverseitig bei raid_participants nachfragen und den lokalen Flag bei
   Treffer selbst heilen (bkmpRaidMarkJoined) - der naechste Sekunden-Tick
   von bkmpRaidUpdateButtonState sieht dann ganz normal "beigetreten". */
let bkmpRaidServerJoinCheckedFor = null;
async function bkmpRaidSyncJoinFlagFromServer(raidId) {
  if (!raidId || bkmpRaidServerJoinCheckedFor === raidId || bkmpRaidHasJoined(raidId)) return;
  bkmpRaidServerJoinCheckedFor = raidId;
  try {
    const participants = typeof loadRaidParticipants === 'function' ? await loadRaidParticipants(raidId) : [];
    const myName = typeof bkmpGetMcName === 'function' ? bkmpGetMcName().trim().toLowerCase() : '';
    const alreadyJoined = myName && Array.isArray(participants) && participants.some(p => (p.displayName || '').trim().toLowerCase() === myName);
    if (alreadyJoined) bkmpRaidMarkJoined(raidId);
  } catch (e) {
    /* Netzwerkfehler - naechster Phasenwechsel/Seitenaufruf versucht es
       erneut, deshalb die Sperre wieder freigeben statt dauerhaft zu blocken. */
    bkmpRaidServerJoinCheckedFor = null;
  }
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
  if (info.raidId && (info.phase === 'prep' || info.phase === 'fight')) {
    bkmpRaidSyncJoinFlagFromServer(info.raidId);
  }
  if (btn) {
    if (info.phase === 'prep' && !bkmpRaidIsGuildBossHourBerlin(new Date(info.fightStartsAt))) {
      btn.classList.add('raid-prep');
      if (countdownEl) { countdownEl.style.display = ''; countdownEl.textContent = '🔥 ' + bkmpRaidFormatCountdown(info.msUntilFightStart); }
    } else {
      btn.classList.remove('raid-prep');
      if (countdownEl) countdownEl.style.display = 'none';
    }
  }

  /* FEHLER-FIX (Spieler-Wunsch 13.07.: "wenn der stuendliche Boss kommt,
     soll das direkt im schon offenen Idle-Fenster erscheinen, nicht erst
     nach dem Schliessen+Neuoeffnen") - das Banner wurde bisher NUR beim
     (Wieder-)Oeffnen des Fensters gebaut (bkmpRaidRenderJoinBanner() lief
     nur einmal in bkmpIdleOpenModal()). War das Fenster schon offen, als
     die Vorbereitungsphase begann, existierte #raidBannerCountdown (wird
     erst BEIM Bauen des Banners per innerHTML erzeugt) noch nicht - der
     naechste Check unten brach dann sofort per early-return ab, ohne das
     Banner je zu erzeugen. Deshalb hier VOR diesem Check: beim Wechsel in
     die Vorbereitungsphase, waehrend das Fenster offen ist, aber das
     Banner noch nicht gebaut wurde, einmalig nachholen.

     NACHBESSERUNG (Spieler-Report 16.07.: "Das Banner kam erst nach dem
     Reload der Seite - das soll wieder voll automatisch auftauchen"):
     der urspruengliche Fix pruefte "existiert #raidBannerCountdown schon"
     als Ersatz fuer "wurde das Banner fuer DIESE Vorbereitungsphase schon
     gebaut" - das Element wird aber beim Phasenwechsel prep->fight weiter
     unten nur versteckt (banner.style.display = 'none'), NIE aus dem DOM
     entfernt. Ab der ZWEITEN Vorbereitungsphase in derselben Sitzung
     existierte #raidBannerCountdown also bereits als Ueberbleibsel der
     vorherigen Stunde - der Nachhol-Aufruf feuerte nie wieder, das Banner
     blieb unsichtbar (nur der Countdown-Text lief im Verborgenen weiter,
     siehe bannerCountdownEl.textContent unten). Jetzt direkt die
     tatsaechliche Sichtbarkeit des Banners geprueft statt der Existenz
     eines Kindelements, das den Phasenwechsel gar nicht ueberlebt. */
  const raidBanner = document.getElementById('raidJoinBanner');
  if (bkmpIdleModalOpen && info.phase === 'prep' && raidBanner && raidBanner.style.display === 'none') {
    bkmpRaidRenderJoinBanner();
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
  if (bkmpRaidIsGuildBossHourBerlin(new Date(info.fightStartsAt))) {
    banner.style.display = '';
    banner.innerHTML = `<div class="raid-join-banner-title">🛡️ Der Weltboss pausiert diese Stunde - Fokus liegt auf dem Gildenboss um 20 Uhr!</div>`;
    return;
  }

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
    /* UX-Konsistenz (Raidboss-Neu-Durchtest 15.07.): einziger verbliebener
       native alert() im ganzen Gildenboss/Raidboss-Fehlerpfad - wirkt
       neben den sonst ueberall verwendeten Toasts (bkmpShowJannikToast)
       deplatziert/blockierend. */
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e && e.message ? e.message : 'Beitritt fehlgeschlagen. Bitte versuche es erneut.', 4200);
    else alert(e && e.message ? e.message : 'Beitritt fehlgeschlagen. Bitte versuche es erneut.');
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
  bkmpRaidEnsureMyAuthUserId();
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
  /* App-Modus (Phase 16): Tap-Schaden-Zaehler pro Raid zuruecksetzen
     (neue Raid-Id seit letztem Render = neuer Kampf) und zusammen mit
     der Ressourcen-Leiste rendern - beides rein lesend aus bereits
     vorhandenem State, auf der Website ohne Wirkung (Elemente existieren
     dort nicht). */
  if (window.BKMP_APP_MODE) {
    if (bkmpRaidState.id !== bkmpRaidTapDamageSessionId) {
      bkmpRaidTapDamageSessionId = bkmpRaidState.id;
      bkmpRaidTapDamageSession = 0;
    }
    const tapVal = document.querySelector('#raidTapDamagePill .idle-res-val');
    if (tapVal) tapVal.textContent = bkmpIdleFormatNumber(bkmpRaidTapDamageSession);
    const strip = document.getElementById('raidRewardsStrip');
    if (strip && bkmpIdleState) {
      strip.innerHTML = `
        <span class="idle-res-chip idle-res-gold"><i class="idle-res-icon">💰</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.gold)}</b></span>
        <span class="idle-res-chip idle-res-wood"><i class="idle-res-icon">🌳</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.wood)}</b></span>
        <span class="idle-res-chip idle-res-stone"><i class="idle-res-icon">🗿</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.stone)}</b></span>
        <span class="idle-res-chip idle-res-crystal"><i class="idle-res-icon">💎</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.crystals)}</b></span>
        <span class="idle-res-chip idle-res-essence"><i class="idle-res-icon">🧪</i><b class="idle-res-val">${bkmpIdleFormatNumber(bkmpIdleState.essence)}</b></span>`;
    }
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

/* Eigener Schaden kommt aus der raid_deal_damage-Antwort SOFORT (der
   Server hat ihn im selben Aufruf bereits berechnet) statt erst auf den
   Realtime-Roundtrip zu warten - bei mehreren gleichzeitig tickenden
   Mitspielern konnte die eigene Zahl sonst spuerbar hinterherhinken. */
function bkmpRaidApplyOwnDamageResult(result) {
  if (!result || result.ownDamageDealt == null) return;
  /* Primaer per authUserId matchen (siehe bkmpRaidMyAuthUserId-Kommentar
     oben) - derselbe Schluessel wie die Realtime-Aktualisierung fuer alle
     anderen Teilnehmer. Der Session-Check dahinter ist async und laeuft
     nicht garantiert VOR dem allerersten Tick durch, deshalb bleibt der
     Name-Abgleich als Fallback fuer dieses eine kurze Zeitfenster - sobald
     bkmpRaidMyAuthUserId bekannt ist, greift ab dann immer der robuste Weg. */
  const myUid = bkmpRaidMyAuthUserId;
  const myName = typeof bkmpGetMcName === 'function' ? bkmpGetMcName().trim().toLowerCase() : '';
  const idx = myUid
    ? bkmpRaidParticipants.findIndex(p => p.authUserId === myUid)
    : (myName ? bkmpRaidParticipants.findIndex(p => p.displayName.trim().toLowerCase() === myName) : -1);
  if (idx >= 0) {
    bkmpRaidParticipants[idx].damageDealt = result.ownDamageDealt;
    bkmpRaidParticipants[idx].critsLanded = result.ownCritsLanded;
    bkmpRaidParticipants[idx].clicksLanded = result.ownClicksLanded;
    if (myUid) bkmpRaidParticipants[idx].authUserId = myUid;
  } else if (myName) {
    bkmpRaidParticipants.push({
      authUserId: myUid,
      displayName: bkmpGetMcName(),
      damageDealt: result.ownDamageDealt,
      critsLanded: result.ownCritsLanded,
      clicksLanded: result.ownClicksLanded,
      joinedAt: Date.now()
    });
  }
  bkmpRaidParticipants.sort((a, b) => b.damageDealt - a.damageDealt);
  bkmpRaidRequestParticipantsRender();
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
  roll.amount = bkmpIdleApplyBossDamageBonus(roll.amount);
  const fx = BKMP_RAID_ATTACK_FX[Math.floor(Math.random() * BKMP_RAID_ATTACK_FX.length)];
  bkmpRaidSpawnFx(fx, 'raidBoss', roll.amount, roll.isCrit);
  bkmpRaidHitFlash('raidBoss');
  try {
    const result = await submitRaidDamage(bkmpRaidState.id, roll.amount, roll.isCrit, false);
    if (result) { bkmpRaidState.bossHp = result.bossHp; bkmpRaidState.status = result.status; bkmpRaidApplyOwnDamageResult(result); bkmpRaidRenderCombat(); bkmpRaidCheckOutcome(); }
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
      return;
    }
    /* Bug-Report 17.07. (ChronoKora): nach Raid-Ende dauerhaft wiederkehrendes
       Ladesymbol + Netzwerk-Tab voller 400er auf raid_deal_damage/
       raid_boss_attack_tick. Ursache per Live-DB-Check bestaetigt: die RPC
       raid_deal_damage/raid_boss_attack_tick lehnt JEDEN Aufruf ab, sobald
       status != 'fighting' ist (siehe supabase-raid-boss-balance-v4.sql) -
       tickRaidBossAttack() schluckt diesen Fehler in supabase.js und gibt
       einfach null zurueck. Normalerweise erfaehrt der Client vom Raid-Ende
       ueber das Realtime-Abo auf raid_instances (bkmpRaidHandleRealtimeChange)
       - faellt dieses Update aber aus (WS-Aussetzer o.ae.), gab es bisher
       KEINEN Ausweg: beide Loops (Eigener-Schaden-Tick UND dieser Boss-Poll)
       liefen fuer den Rest der Sitzung leer weiter, alle paar Sekunden ein
       400 gegen Supabase, ohne dass der Spieler je das Ergebnis-Fenster sah.
       Deshalb hier ein direkter Zeilen-Read (loadRaidState, kein RPC, kann
       nicht an status='fighting' scheitern) als Fallback, sobald die RPC
       einmal null liefert - erkennt so auch ohne Realtime-Update zuverlaessig,
       dass der Raid vorbei ist, und beendet die Loops. */
    if (typeof loadRaidState === 'function') {
      const fallback = await loadRaidState(bkmpRaidState.id);
      if (fallback && fallback.status !== 'fighting') {
        bkmpRaidState.status = fallback.status;
        bkmpRaidState.bossHp = fallback.bossHp;
        bkmpRaidState.cityHp = fallback.cityHp;
        bkmpRaidRenderCombat();
        bkmpRaidCheckOutcome();
      }
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
  const clickDamage = bkmpIdleApplyBossDamageBonus(Math.max(1, Math.round(bkmpIdleEffectiveStats.attack * (0.12 + (bkmpIdleEffectiveStats.clickDamagePct || 0) / 100) * (isCrit ? Math.max(1, bkmpIdleEffectiveStats.critDamage / 100) : 1))));
  bkmpRaidTapDamageSession += clickDamage;
  bkmpRaidSpawnFx('raid-fx-magic', 'raidBoss', clickDamage, isCrit);
  bkmpRaidHitFlash('raidBoss');
  submitRaidDamage(bkmpRaidState.id, clickDamage, isCrit, true).then(result => {
    if (result) { bkmpRaidState.bossHp = result.bossHp; bkmpRaidState.status = result.status; bkmpRaidApplyOwnDamageResult(result); bkmpRaidRenderCombat(); bkmpRaidCheckOutcome(); }
  }).catch(() => {});
}

/* Garantierte Grundlage fuer die Live-Anzeige ANDERER Spieler (siehe
   Kommentar bei BKMP_RAID_PARTICIPANTS_POLL_MS oben) - unabhaengig davon,
   ob das Realtime-Abo gerade zuverlaessig liefert. Einfacher lesender
   Select (loadRaidParticipants), kein RPC, daher kein Interaktions-Risiko
   mit dem parallel laufenden bkmpRaidBossPoll (eigener Timer, eigener
   Fehlerfall - ein Fehlschlag hier blockiert den naechsten Boss-Poll
   nicht und umgekehrt). */
async function bkmpRaidParticipantsPoll() {
  if (!bkmpRaidState) return;
  try {
    const rows = await loadRaidParticipants(bkmpRaidState.id);
    bkmpRaidParticipants = rows;
    bkmpRaidRequestParticipantsRender();
  } catch (e) { /* naechster Poll versucht es erneut */ }
}

function bkmpRaidStartLoops(raidId) {
  bkmpRaidStopLoops();
  bkmpRaidLoopTimer = window.setInterval(bkmpRaidOwnTick, BKMP_RAID_TICK_MS);
  bkmpRaidBossPollTimer = window.setInterval(bkmpRaidBossPoll, BKMP_RAID_BOSS_POLL_MS);
  bkmpRaidParticipantsPollTimer = window.setInterval(bkmpRaidParticipantsPoll, BKMP_RAID_PARTICIPANTS_POLL_MS);
}
function bkmpRaidStopLoops() {
  if (bkmpRaidLoopTimer) { window.clearInterval(bkmpRaidLoopTimer); bkmpRaidLoopTimer = null; }
  if (bkmpRaidBossPollTimer) { window.clearInterval(bkmpRaidBossPollTimer); bkmpRaidBossPollTimer = null; }
  if (bkmpRaidParticipantsPollTimer) { window.clearInterval(bkmpRaidParticipantsPollTimer); bkmpRaidParticipantsPollTimer = null; }
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

/* Eigener Anteil exakt wie raid_finish() serverseitig rechnet (Schaden-
   Anteil * Belohnungs-Pool, siehe supabase-raid-boss-reward-share.sql) -
   gleiches Prinzip wie beim Gildenboss (bkmpGuildBossRenderParticipants).
   Nur Ressourcen mit einem Pool > 0 werden angezeigt (analog zu
   bkmpDungeonRewardParts). */
function bkmpRaidRewardSpans(state, mine, totalDamage) {
  const share = mine && totalDamage > 0 ? mine.damageDealt / totalDamage : 0;
  const parts = [];
  const add = (icon, pool) => {
    const amount = Math.round((pool || 0) * share);
    if (pool > 0) parts.push(`<span>${icon} +${bkmpIdleFormatNumber(amount)}</span>`);
  };
  add('💰', state.goldReward);
  add('💎', state.gemReward);
  add('✨', state.xpReward);
  add('🌳', state.woodReward);
  add('🗿', state.stoneReward);
  add('🧪', state.essenceReward);
  return parts.join('');
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
  /* Zerathor-Dorf-Skin: kein Einloese-Code wie beim Pluschie (Dorf-Skins
     sind nicht handelbar) - raid_finish() hat den 1%-Wurf serverseitig
     schon direkt in idle_player_village_skins geschrieben, hier wird nur
     erkannt, ob der Skin GERADE NEU dazugekommen ist (Vergleich gegen den
     Stand von vor dem Raid), um die Bonus-Zeile unten anzuzeigen und
     bkmpPlayerVillageSkins/das Skins-Panel sofort zu aktualisieren, ohne
     dass der Spieler das Fenster neu oeffnen muss. */
  let newVillageSkin = false;
  if (won && myName && !bkmpPlayerVillageSkins.includes('zerathordorf')) {
    try {
      const owned = typeof loadPlayerVillageSkins === 'function' ? await loadPlayerVillageSkins(myName) : [];
      const ownedIds = Array.isArray(owned) ? owned.map(r => r.skin_id) : [];
      if (ownedIds.includes('zerathordorf')) {
        newVillageSkin = true;
        bkmpPlayerVillageSkins.push('zerathordorf');
      }
    } catch (e) { console.warn('Raid: Dorf-Skin-Beute konnte nicht geprueft werden.', e); }
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
    ${won ? `<div class="raid-result-rewards">${bkmpRaidRewardSpans(bkmpRaidState, mine, totalDamage)}</div><p class="admin-help-text" style="margin-top:-0.3rem;">Belohnung nach Schadensanteil (${totalDamage > 0 && mine ? ((mine.damageDealt / totalDamage) * 100).toFixed(1) : '0'}% des Gesamtschadens).</p>` : ''}
    ${rewardCode ? `
    <div class="raid-result-zerator-code">
      <div class="raid-result-zerator-title">🎁 Plushie! Hier ist dein Code:</div>
      <div class="raid-result-zerator-code-row">
        <span class="raid-result-zerator-code-value" id="raidZeratorCodeValue">${escapeHtml(rewardCode.code)}</span>
        <button type="button" class="btn-nein" id="raidZeratorCodeCopyBtn">Kopieren</button>
      </div>
      <p class="raid-result-zerator-hint">Dieser Code kann nur einmal eingelöst werden – am besten gleich sichern.</p>
    </div>` : ''}
    ${newVillageSkin ? `
    <div class="raid-result-zerator-code">
      <div class="raid-result-zerator-title">🏘️ Seltene Beute! Du hast das Zerathor Dorf freigeschaltet.</div>
      <p class="raid-result-zerator-hint">Zu finden in den Dorf-Skins - dort einfach ausrüsten.</p>
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
  try { rows = (await loadRaidLeaderboard()).filter(r => !bkmpIsHiddenTestAccount(r.displayName)); } catch (e) { console.warn('Raid: Bestenliste konnte nicht geladen werden.', e); }
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
  bkmpIdleHandleStripeReturn();
  const openBtn = document.getElementById('idleDorfButton');
  if (openBtn) openBtn.addEventListener('click', bkmpIdleOpenModal);
  bkmpIdleMaintenancePoll();
  /* Egress/Performance-Fix 17.07.: dieser Poll laeuft UNCONDITIONAL fuer
     JEDEN Besucher auf JEDER der 4 Seiten (idledorf.js wird ueberall
     geladen) - 20s war fuer eine Sache, die der Admin realistisch nicht
     minuetlich umschaltet, unnoetig aggressiv (1,79 Mio. API-Requests/24h
     im Supabase-Dashboard beobachtet, siehe Projektnotizen). 90s statt 20s
     senkt das Volumen auf ~22%, ohne dass ein echter Wartungsmodus-Wechsel
     spuerbar langsamer erkannt wird. */
  window.setInterval(bkmpIdleMaintenancePoll, 90000);
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
  /* Nutzerwunsch (15.07.): "brauche eine Einbettung für die Streamer... + 1
     Anleitung", danach bestaetigt: auch als sichtbare Hilfe-Sektion auf der
     Seite selbst (nicht nur im Chat) - statischer Inhalt direkt im HTML
     (siehe #idleStreamHelpOverlay), hier nur Oeffnen/Schliessen verdrahtet,
     gleiches Muster wie Skill-/Runen-Hilfe oben. */
  const streamHelpBtn = document.getElementById('idleStreamHelpBtn');
  if (streamHelpBtn) streamHelpBtn.addEventListener('click', () => {
    const overlay = document.getElementById('idleStreamHelpOverlay');
    if (overlay) overlay.classList.add('visible');
  });
  const streamHelpClose = document.getElementById('idleStreamHelpClose');
  if (streamHelpClose) streamHelpClose.addEventListener('click', () => {
    const overlay = document.getElementById('idleStreamHelpOverlay');
    if (overlay) overlay.classList.remove('visible');
  });
  const dragonEl = document.getElementById('idleDragon');
  if (dragonEl) { dragonEl.classList.add('idle-dragon-clickable'); dragonEl.addEventListener('click', bkmpIdleHandleDragonClick); }
  bkmpIdleWireStagePicker();
  const eventDragonReadyBtn = document.getElementById('idleEventDragonReadyBtn');
  if (eventDragonReadyBtn) eventDragonReadyBtn.addEventListener('click', bkmpIdleConfirmEventDragonReady);
  /* Bug-Fund (autonome Fehlersuche 15.07.): bkmpIdleRenderRunenPanel()
     haengte diesen Resize-Listener bisher bei JEDEM eigenen Aufruf neu an
     window - und diese Funktion laeuft nach buchstaeblich jeder Runen-
     Aktion (Aufwerten, Verkaufen, Fusionieren, Ausruesten, Auto-Fusion/
     -Aufwertung, ueber 15 Aufrufstellen), niemals nur einmal. window wird
     nie aufgeraeumt - ueber eine laengere Spielsitzung sammelten sich so
     unbegrenzt viele identische Resize-Listener an (jeder einzelne feuert
     bkmpRuneSyncDrawerPosition() erneut bei jedem Browser-Resize). Gleiches
     Leck-Muster wie der bereits gefixte Donut-Chart-Listener, hier aber
     unentdeckt geblieben. Jetzt wie alle anderen globalen Listener
     (keydown/beforeunload/visibilitychange) nur EINMAL hier in der Init
     angehaengt - bkmpRuneSyncDrawerPosition() ist ohnehin intern bereits
     dagegen abgesichert, wenn der Rahmen (Lager-Balken) gerade unsichtbar
     ist, braucht also keinen weiteren Enable/Disable-Mechanismus. */
  window.addEventListener('resize', bkmpRuneSyncDrawerPosition);
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
  /* Bug-Report 17.07. ("Prüfe alles im Idle Game nach der Syncbarkeit"):
     dieser Handler flushte bisher NUR den Haupt-Spielstand (Gold/Skillpunkte/
     Rohstoffe). Prestige (eigener 1,5s-Debounce, bkmpPrestigeSaveTimer) und
     frisch gedroppte Runen (eigener 4s-Debounce, bkmpIdleRuneSyncTimer)
     haben JEWEILS ihren eigenen, unabhaengigen Speicher-Timer - der wurde
     hier nie erzwungen, blieb bei einem Reload also einfach unversendet
     stehen. Alle drei Speicherpfade muessen hier gemeinsam erzwungen
     werden, sonst bleibt genau die gleiche Bug-Klasse fuer Prestige/Runen
     bestehen, die fuer Gold/Skillpunkte schon gefixt wurde. */
  window.addEventListener('beforeunload', () => {
    bkmpIdleQueueSync(); bkmpIdleFlushSync();
    bkmpPrestigeFlushSyncNow();
    bkmpIdleFlushRuneSyncNow();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      bkmpIdleQueueSync(); bkmpIdleFlushSync();
      bkmpPrestigeFlushSyncNow();
      bkmpIdleFlushRuneSyncNow();
      return;
    }
    bkmpIdleCatchUpAfterHidden();
  });
  window.setTimeout(bkmpIdlePreloadStateIfNamed, 0);
}
bkmpIdleInit();

/* Gold/XP-Hochschweb-Anzeige (Nutzerwunsch 15.07.: "wo dieses Geld und XP
   hochploppt gerne auch so Standard mäßig machen") - urspruenglich nur ein
   Inline-Script in idle-stream-mini.html, jetzt hier zentral fuer JEDE
   Seite mit einem #idleBattlefield-Element (Hauptseite/admin.html/
   idle-stream.html/idle-stream-mini.html gleichermassen), reagiert auf das
   in bkmpIdleHandleDragonDefeated gefeuerte bkmpIdleRewardGained-Event. */
document.addEventListener('bkmpIdleRewardGained', e => {
  const field = document.getElementById('idleBattlefield');
  if (!field || !e.detail) return;
  const el = document.createElement('div');
  el.className = 'idle-reward-float';
  el.innerHTML = `<span class="rf-gold">+${Math.round(e.detail.gold)} 💰</span><span class="rf-xp">+${Math.round(e.detail.xp)} ✨</span>`;
  field.appendChild(el);
  window.setTimeout(() => el.remove(), 1500);
});

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
/* Erweitert 16.07. (Lategame-Content, Spieler-Vorgabe: "Langzeit-fesselnder
   Content") ueber die bisherige Obergrenze von 10 hinaus - die Stufen-
   Anforderung fuer den naechsten Prestige-Aufstieg waechst laut
   bkmpPrestigeRequiredStage() UNBEGRENZT weiter (100 + Stufe*50), belohnte
   das bisher aber ab Stufe 10 ("Was ist Prestige?" war buchstaeblich als
   Scherz-Ceiling gedacht) ueberhaupt nicht mehr. 15 neue Stufen mit
   waechsenden Abstaenden (spiegelt den ebenfalls waechsenden Aufwand pro
   Aufstieg), Namensreihe endet bewusst offen ("Der Unendliche") statt an
   einer weiteren harten Zahl. */
window.BKMP_IDLE_PRESTIGE_TIERS = [
  [1, 'Prestige 1'], [2, 'Prestige 2'], [3, 'Prestige 3'], [4, 'Prestige 4'], [5, 'Prestige 5'],
  [6, 'Prestige 6'], [7, 'Prestige 7'], [8, 'Prestige 8'], [9, 'Prestige 9'], [10, 'Prestige 10'],
  [12, 'Prestige 12'], [14, 'Prestige 14'], [16, 'Prestige 16'], [18, 'Prestige 18'], [20, 'Prestige 20'],
  [23, 'Prestige 23'], [26, 'Prestige 26'], [30, 'Prestige 30'], [35, 'Prestige 35'], [40, 'Prestige 40'],
  [45, 'Prestige 45'], [50, 'Prestige 50'], [60, 'Prestige 60'], [75, 'Prestige 75'], [100, 'Prestige 100']
];
window.BKMP_IDLE_PRESTIGE_TITLE_NAMES = [
  'Prestige Jäger', 'Prestige Krieger', 'Prestige Veteran', 'Prestige Meister', 'Prestige Champion',
  'Prestige Legende', 'Prestige Titan', 'Prestige Halbgott', 'Prestige Gott', 'Was ist Prestige?',
  'Portal-Wächter', 'Portal-Herrscher', 'Zyklus-Wanderer', 'Ewiger Wanderer', 'Dimensionsreisender',
  'Zeitloser', 'Unsterblicher', 'Kosmischer Wanderer', 'Universums-Architekt', 'Multiversum-Meister',
  'Jenseits der Sterne', 'Schöpfer neuer Welten', 'Der Ewige Kreislauf', 'Wächter der Unendlichkeit', 'Der Unendliche'
];
/* Turm-Erfolge/Titel (Nachtrag 16.07., Spieler-Frage "was ist mit
   Belohnungen vom Endlosen Turm?"): der Turm selbst gibt zwar schon
   laufend Gold/EXP pro Welle + Kristalle alle 10 Stufen (siehe
   bkmpTowerHandleWaveCleared), hatte aber als einziges System im ganzen
   Spiel KEINE eigene Erfolgs-/Titel-Reihe - jedes andere System (Dungeon,
   Zucht, Gilde, Arena, Raid, Prestige) hat welche. Gleiches Tier-Array-
   Muster wie ueberall sonst, gekoppelt an ctx.idleTowerHighestWave
   (persoenlicher Rekord). */
window.BKMP_IDLE_TOWER_TIERS = [
  [10, 'Turmkletterer'], [20, 'Turmläufer'], [35, 'Turmbezwinger'], [50, 'Turmveteran'], [75, 'Turmmeister'],
  [100, 'Turmchampion'], [150, 'Turmlegende'], [200, 'Turmtitan'], [300, 'Turmgott'], [500, 'Der Unaufhaltsame']
];

/* Runen-Erfolge (Kategorie "Runen"). Vier Tier-Reihen fuer Verschmelzen/
   Aufwerten, je Erfolg UND Misserfolg - die Misserfolgs-Reihen sind
   bewusst genauso ausgebaut wie die Erfolgs-Reihen (nicht nur 1-2
   Alibi-Stufen), da Pech beim Verschmelzen/Aufwerten ein echter,
   wiederkehrender Teil des Runen-Systems ist. */
window.BKMP_RUNE_FUSE_SUCCESS_TIERS = [
  [1, 'Erste Verschmelzung'], [5, 'Runenschmelzer'], [15, 'Fusionsmeister'], [30, 'Runenalchemist'],
  [60, 'Schmelztiegel-Meister'], [100, 'Runenveredler'], [200, 'Großmeister der Fusion'], [350, 'Legende der Verschmelzung'],
  [500, 'Fusionsdämon'], [750, 'Runenschmiede-Titan'], [1000, 'Tausendfache Verschmelzung'], [2500, 'Schmelztiegel-Gottheit'],
  [5000, 'Ewiger Verschmelzer'], [10000, 'Der Runen-Ursprung']
];
window.BKMP_RUNE_FUSE_FAIL_TIERS = [
  [1, 'Erster Rückschlag'], [5, 'Pechvogel'], [15, 'Explosionsgefahr'], [30, 'Unverwüstlicher Optimist'], [50, 'Schmelztiegel des Grauens'],
  [100, 'Fluch des Schmelztiegels'], [250, 'Wandelnde Katastrophe'], [500, 'Meister des Missgeschicks'], [1000, 'Der Verschmelzungs-Fluch'],
  [2500, 'Von den Runen verflucht'], [5000, 'Sisyphos des Schmelztiegels']
];
window.BKMP_RUNE_UPGRADE_SUCCESS_TIERS = [
  [1, 'Erste Aufwertung'], [10, 'Runenschleifer'], [25, 'Veredelungskünstler'], [50, 'Runenoptimierer'],
  [100, 'Aufwertungsmeister'], [200, 'Runenperfektionist'], [400, 'Großmeister der Veredelung'], [750, 'Legende der Veredelung'],
  [1500, 'Veredelungstitan'], [3000, 'Runenschleif-Gottheit'], [5000, 'Ewiger Veredler'], [10000, 'Der Aufwertungs-Ursprung']
];
window.BKMP_RUNE_UPGRADE_FAIL_TIERS = [
  [1, 'Gold verbrannt'], [5, 'Teurer Fehlschlag'], [15, 'Risikofreudig'], [30, 'Nerven aus Stahl'], [50, 'Va-Banque-Spieler'],
  [100, 'Gold-Verbrenner'], [250, 'Bankrotteur'], [500, 'Meister des Ruins'], [1000, 'Der Aufwertungs-Fluch'],
  [2500, 'Von Pech verfolgt'], [5000, 'Sisyphos der Aufwertung']
];
/* Fuenf Erfolge fuer "alle 6 Slots mit derselben Seltenheit ausgeruestet" -
   Reihenfolge exakt wie BKMP_RUNE_RARITIES (gray/green/blue/purple/gold). */
window.BKMP_RUNE_EQUIP_RARITY_TIERS = [
  ['gray', 'Purist'], ['green', 'Grüner Daumen'], ['blue', 'Blaues Blut'], ['purple', 'Violette Vorherrschaft'], ['gold', 'Runengott']
];
/* Fuenf Erfolge fuer "alle 6 Slots mindestens auf Stufe N" - deckt sich
   exakt mit BKMP_RUNE_MAX_LEVEL = 15 (absolutes Maximum fuer alle
   Seltenheiten AUSSER Legendaer, die per Aufstieg noch bis
   BKMP_RUNE_ASCEND_MAX_LEVEL weiterkommt - siehe bkmpRuneAscend). */
window.BKMP_RUNE_EQUIP_LEVEL_TIERS = [
  [3, 'Frisch geschliffen'], [6, 'Feingeschliffen'], [9, 'Meisterlich veredelt'], [12, 'Nahezu perfekt'], [15, 'Runen-Perfektion']
];

window.BKMP_IDLE_ACHIEVEMENTS_EXTRA = [
  { id: 'idle_started', category: 'Idle Dorf', title: 'Dorfgründung', desc: 'Öffne das Idle Drachen Dorf zum ersten Mal.', check: ctx => ctx.idleLevel >= 1 },
  { id: 'idle_first_boss', category: 'Idle Dorf', title: 'Bosskämpfer', desc: 'Besiege deinen ersten Boss-Drachen im Idle Dorf.', check: ctx => ctx.idleBossKills >= 1 },
  { id: 'idle_boss_10', category: 'Idle Dorf', title: 'Bossjäger', desc: 'Besiege 10 Boss-Drachen.', progress: ctx => [ctx.idleBossKills, 10], check: ctx => ctx.idleBossKills >= 10 },
  { id: 'idle_boss_50', category: 'Idle Dorf', title: 'Boss-Vernichter', desc: 'Besiege 50 Boss-Drachen.', progress: ctx => [ctx.idleBossKills, 50], check: ctx => ctx.idleBossKills >= 50 },
  { id: 'idle_skillpoints_1', category: 'Idle Dorf', title: 'Erster Skillpunkt', desc: 'Investiere deinen ersten Skillpunkt.', check: ctx => ctx.idleSkillPointsSpent >= 1 },
  { id: 'idle_branch_one', category: 'Idle Dorf', title: 'Spezialist', desc: 'Maximiere einen kompletten Skilltree-Zweig.', check: ctx => ctx.idleBranchesMaxed >= 1 },
  { id: 'idle_branch_three', category: 'Idle Dorf', title: 'Vielseitiger Anführer', desc: 'Maximiere drei komplette Skilltree-Zweige.', progress: ctx => [ctx.idleBranchesMaxed, 3], check: ctx => ctx.idleBranchesMaxed >= 3 },
  { id: 'idle_branch_all', category: 'Idle Dorf', title: 'Skilltree-Meister', desc: 'Maximiere alle 5 Skilltree-Zweige.', progress: ctx => [ctx.idleBranchesMaxed, 5], check: ctx => ctx.idleBranchesMaxed >= 5 },
  ...window.BKMP_RUNE_EQUIP_RARITY_TIERS.map(([rarityId, label]) => {
    const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rarityId);
    return {
      id: `rune_equip_rarity_${rarityId}`, category: 'Runen', title: label,
      desc: `Ruste alle 6 Runen-Plätze gleichzeitig mit ${rarity.name}-Runen aus.`,
      check: ctx => ctx.idleAllEquippedRarity === rarityId
    };
  }),
  ...window.BKMP_RUNE_EQUIP_LEVEL_TIERS.map(([n, label]) => ({
    id: `rune_equip_level_${n}`, category: 'Runen', title: label,
    desc: `Bringe alle 6 ausgerüsteten Runen gleichzeitig auf mindestens +${n}.`,
    check: ctx => ctx.idleAllEquippedMinLevel >= n
  })),
  /* Drachenzucht (siehe supabase-dragon-breeding.sql) - Kategorie
     "Drachenzucht", eigene Zaehler aus bkmpIdleGetAchievementContextFields. */
  { id: 'dragon_first_egg', category: 'Drachenzucht', title: 'Das erste Ei', desc: 'Finde dein erstes Drachenei.', check: () => bkmpPlayerDragonEggs.length + bkmpPlayerDragons.length >= 1 },
  { id: 'dragon_first_hatch', category: 'Drachenzucht', title: 'Geschlüpft!', desc: 'Brüte deinen ersten Drachen aus.', check: ctx => ctx.idleDragonsHatched >= 1 },
  { id: 'dragon_hatch_5', category: 'Drachenzucht', title: 'Drachenzüchter', desc: 'Brüte 5 Drachen aus.', progress: ctx => [ctx.idleDragonsHatched, 5], check: ctx => ctx.idleDragonsHatched >= 5 },
  { id: 'dragon_hatch_20', category: 'Drachenzucht', title: 'Drachenhort', desc: 'Brüte 20 Drachen aus.', progress: ctx => [ctx.idleDragonsHatched, 20], check: ctx => ctx.idleDragonsHatched >= 20 },
  { id: 'dragon_first_adult', category: 'Drachenzucht', title: 'Erwachsen geworden', desc: 'Ziehe deinen ersten Drachen bis zur Erwachsenenform auf.', check: ctx => ctx.idleDragonsAdult >= 1 },
  { id: 'dragon_adult_10', category: 'Drachenzucht', title: 'Drachenmeister', desc: 'Ziehe 10 erwachsene Drachen auf.', progress: ctx => [ctx.idleDragonsAdult, 10], check: ctx => ctx.idleDragonsAdult >= 10 },
  { id: 'dragon_species_5', category: 'Drachenzucht', title: 'Vielfältige Zucht', desc: 'Besitze Drachen von 5 unterschiedlichen Arten.', progress: ctx => [ctx.idleDragonSpeciesOwned, 5], check: ctx => ctx.idleDragonSpeciesOwned >= 5 },
  { id: 'dragon_species_all', category: 'Drachenzucht', title: 'Herr über alle Arten', desc: 'Besitze Drachen aller 17 Arten.', progress: ctx => [ctx.idleDragonSpeciesOwned, 17], check: ctx => ctx.idleDragonSpeciesOwned >= 17 },
  { id: 'dragon_legendary_first', category: 'Drachenzucht', title: 'Legendäre Zucht', desc: 'Besitze deinen ersten legendären Drachen.', check: ctx => ctx.idleLegendaryDragonsOwned >= 1 },
  { id: 'dragon_legendary_both', category: 'Drachenzucht', title: 'Meister beider Legenden', desc: 'Besitze sowohl einen Zerathor- als auch einen Yakshadrachen.', check: ctx => bkmpPlayerDragons.some(d => d.species_id === 'zerathor') && bkmpPlayerDragons.some(d => d.species_id === 'yakshadrache') },
  { id: 'dragon_companion_first', category: 'Drachenzucht', title: 'Treuer Begleiter', desc: 'Ruste deinen ersten Begleitdrachen aus.', check: ctx => bkmpPlayerDragons.some(d => d.is_companion) },
  { id: 'dragon_zucht_branch_maxed', category: 'Drachenzucht', title: 'Zuchtmeister', desc: 'Maximiere den kompletten Zucht-Skilltree-Zweig.', check: () => {
    if (!bkmpIdleState || !bkmpIdleSkillDefs.length) return false;
    const alloc = bkmpIdleState.skill_allocations || {};
    const nodes = bkmpIdleSkillDefs.filter(n => n.branch === 'zucht');
    return nodes.length > 0 && nodes.every(n => Number(alloc[n.id] || 0) >= n.max_rank);
  } },
  /* Login-Streak (rein clientseitig, siehe bkmpIdleCheckDailyStreak). */
  { id: 'streak_3', category: 'Idle Dorf', title: 'Dranbleiber', desc: 'Logge dich 3 Tage in Folge ein.', progress: ctx => [ctx.idleLoginStreak, 3], check: ctx => ctx.idleLoginStreak >= 3 },
  { id: 'streak_7', category: 'Idle Dorf', title: 'Wochentreue', desc: 'Logge dich 7 Tage in Folge ein.', progress: ctx => [ctx.idleLoginStreak, 7], check: ctx => ctx.idleLoginStreak >= 7 },
  { id: 'streak_30', category: 'Idle Dorf', title: 'Ein Monat treu', desc: 'Logge dich 30 Tage in Folge ein.', progress: ctx => [ctx.idleLoginStreak, 30], check: ctx => ctx.idleLoginStreak >= 30 },
  { id: 'steampunk_owner', category: 'Idle Dorf', title: 'Zahnrad-Sammler', desc: 'Besitze den Dorf-Skin "Steampunk Dorf".', check: ctx => ctx.idleHasSteampunkSkin }
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
  ...window.BKMP_IDLE_TOWER_TIERS.map(([n, label], i) => ({
    id: `idletitle_turm_${n}`, name: label, desc: `Erreiche Stufe ${n} im Endlosen Turm.`,
    unlockCustom: ctx => ctx.idleTowerHighestWave >= n, effectType: 'hp_pct', effectValue: i + 1
  })),
  ...window.BKMP_RUNE_FUSE_SUCCESS_TIERS.map(([n, label], i) => ({
    id: `runetitle_fuse_${n}`, name: label, desc: `Verschmelze ${n} Runen erfolgreich.`,
    unlockCustom: ctx => ctx.idleRuneFuseSuccesses >= n, effectType: 'loot_chance_pct', effectValue: i + 1
  })),
  ...window.BKMP_RUNE_FUSE_FAIL_TIERS.map(([n, label], i) => ({
    id: `runetitle_fusefail_${n}`, name: label, desc: `Erlebe ${n} fehlgeschlagene Runen-Verschmelzungen.`,
    unlockCustom: ctx => ctx.idleRuneFuseFailures >= n
  })),
  ...window.BKMP_RUNE_UPGRADE_SUCCESS_TIERS.map(([n, label], i) => ({
    id: `runetitle_upgrade_${n}`, name: label, desc: `Werte Runen ${n}-mal erfolgreich auf.`,
    unlockCustom: ctx => ctx.idleRuneUpgradeSuccesses >= n, effectType: 'attack_pct', effectValue: i + 1
  })),
  ...window.BKMP_RUNE_UPGRADE_FAIL_TIERS.map(([n, label], i) => ({
    id: `runetitle_upgradefail_${n}`, name: label, desc: `Erlebe ${n} fehlgeschlagene Runen-Aufwertungen.`,
    unlockCustom: ctx => ctx.idleRuneUpgradeFailures >= n
  })),
  ...window.BKMP_RUNE_EQUIP_RARITY_TIERS.map(([rarityId, label], i) => {
    const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rarityId);
    return {
      id: `runetitle_equiprarity_${rarityId}`, name: label, desc: `Alle 6 Runen-Plätze mit ${rarity.name}-Runen ausgerüstet.`,
      unlockCustom: ctx => ctx.idleAllEquippedRarity === rarityId, effectType: 'crit_chance_flat', effectValue: i + 1
    };
  }),
  ...window.BKMP_RUNE_EQUIP_LEVEL_TIERS.map(([n, label], i) => ({
    id: `runetitle_equiplevel_${n}`, name: label, desc: `Alle 6 ausgerüsteten Runen auf mindestens +${n}.`,
    unlockCustom: ctx => ctx.idleAllEquippedMinLevel >= n, effectType: 'crit_damage_pct', effectValue: i + 1
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
  { id: 'idletitle_liber', name: 'Du hast ihn besiegt.', desc: 'Den Ganz Liber Drache im Kampf besiegt.', unlockCustom: ctx => ctx.liberDefeated },
  /* Gilde/Arena/Weltboss hatten bisher NUR Erfolge, keine passenden Titel
     mit echtem Statbonus (Nutzerwunsch 16.07.: "viel mehr Erfolge/Titel...
     Gilden Arena... Überrasche mich") - hier nachgeholt, gleiches
     effectType/effectValue-Muster wie oben. ctx.guildLevel/arenaWins/
     raidBossesDefeated usw. kommen aus dem gemeinsamen, zentral in
     index.html zusammengebauten Kontext (siehe bkmpBuildAchievementContext),
     genau wie bei den bereits bestehenden Gilde/Arena/Weltboss-ERFOLGEN. */
  { id: 'idletitle_guild_member', name: 'Gildenmitglied', desc: 'Einer Gilde beigetreten.', unlockCustom: ctx => ctx.inGuild, effectType: 'defense_flat', effectValue: 2 },
  { id: 'idletitle_guild_leader', name: 'Gildenanführer', desc: 'Anführer einer Gilde.', unlockCustom: ctx => ctx.guildRole === 'leader', effectType: 'attack_pct', effectValue: 3 },
  { id: 'idletitle_guild_level10', name: 'Etablierte Gilde', desc: 'Gildenlevel 10 erreicht.', unlockCustom: ctx => ctx.guildLevel >= 10, effectType: 'gold_prod_pct', effectValue: 3 },
  { id: 'idletitle_guild_level20', name: 'Gildenlegende', desc: 'Gildenlevel 20 erreicht.', unlockCustom: ctx => ctx.guildLevel >= 20, effectType: 'gold_prod_pct', effectValue: 6 },
  { id: 'idletitle_guild_boss10', name: 'Gildenboss-Bezwinger', desc: '10 Gildenbosse besiegt.', unlockCustom: ctx => ctx.guildBossesDefeated >= 10, effectType: 'boss_dmg_pct', effectValue: 4 },
  { id: 'idletitle_arena_win10', name: 'Arena-Kämpfer', desc: '10 Arena-Kämpfe gewonnen.', unlockCustom: ctx => ctx.arenaWins >= 10, effectType: 'crit_chance_flat', effectValue: 1 },
  { id: 'idletitle_arena_win50', name: 'Arena-Veteran', desc: '50 Arena-Kämpfe gewonnen.', unlockCustom: ctx => ctx.arenaWins >= 50, effectType: 'crit_chance_flat', effectValue: 2 },
  { id: 'idletitle_arena_win200', name: 'Arena-Champion', desc: '200 Arena-Kämpfe gewonnen.', unlockCustom: ctx => ctx.arenaWins >= 200, effectType: 'crit_damage_pct', effectValue: 8 },
  { id: 'idletitle_arena_rating1500', name: 'Aufstrebender Kämpfer', desc: 'Arena-Rating 1500 erreicht.', unlockCustom: ctx => ctx.arenaRating >= 1500, effectType: 'attack_flat', effectValue: 3 },
  { id: 'idletitle_raid_boss10', name: 'Bossbezwinger', desc: '10 Weltbosse besiegt.', unlockCustom: ctx => ctx.raidBossesDefeated >= 10, effectType: 'hp_flat', effectValue: 15 },
  { id: 'idletitle_raid_boss100', name: 'Legendärer Drachenjäger', desc: '100 Weltbosse besiegt.', unlockCustom: ctx => ctx.raidBossesDefeated >= 100, effectType: 'boss_dmg_pct', effectValue: 8 },
  { id: 'idletitle_raid_mvp', name: 'Raid-MVP', desc: 'Bester Schadensausteiler in einem Weltboss-Raid.', unlockCustom: ctx => ctx.raidMvpCount >= 1, effectType: 'crit_damage_pct', effectValue: 4 },
  /* Drachenzucht (siehe supabase-dragon-breeding.sql). */
  { id: 'idletitle_dragon_hatch1', name: 'Drachenzüchter', desc: 'Deinen ersten Drachen ausgebrütet.', unlockCustom: ctx => ctx.idleDragonsHatched >= 1, effectType: 'hp_flat', effectValue: 5 },
  { id: 'idletitle_dragon_adult1', name: 'Drachenreiter', desc: 'Deinen ersten Drachen zur Erwachsenenform aufgezogen.', unlockCustom: ctx => ctx.idleDragonsAdult >= 1, effectType: 'attack_pct', effectValue: 4 },
  { id: 'idletitle_dragon_species5', name: 'Vielfältiger Züchter', desc: 'Drachen von 5 verschiedenen Arten besessen.', unlockCustom: ctx => ctx.idleDragonSpeciesOwned >= 5, effectType: 'gold_prod_pct', effectValue: 4 },
  { id: 'idletitle_dragon_speciesall', name: 'Herr aller Drachenarten', desc: 'Drachen aller 17 Arten besessen.', unlockCustom: ctx => ctx.idleDragonSpeciesOwned >= 17, effectType: 'xp_pct', effectValue: 10 },
  { id: 'idletitle_dragon_legendary', name: 'Legendärer Züchter', desc: 'Einen legendären Drachen besessen.', unlockCustom: ctx => ctx.idleLegendaryDragonsOwned >= 1, effectType: 'crit_damage_pct', effectValue: 10 },
  /* Login-Streak. */
  { id: 'idletitle_streak7', name: 'Wochentreue', desc: '7 Tage in Folge eingeloggt.', unlockCustom: ctx => ctx.idleLoginStreak >= 7, effectType: 'xp_pct', effectValue: 3 },
  { id: 'idletitle_streak30', name: 'Der Unermüdliche', desc: '30 Tage in Folge eingeloggt.', unlockCustom: ctx => ctx.idleLoginStreak >= 30, effectType: 'xp_pct', effectValue: 8 },
  { id: 'idletitle_zuchtmeister', name: 'Zuchtmeister', desc: 'Den kompletten Zucht-Skilltree-Zweig maximiert.', unlockCustom: () => {
    if (!bkmpIdleState || !bkmpIdleSkillDefs.length) return false;
    const alloc = bkmpIdleState.skill_allocations || {};
    const nodes = bkmpIdleSkillDefs.filter(n => n.branch === 'zucht');
    return nodes.length > 0 && nodes.every(n => Number(alloc[n.id] || 0) >= n.max_rank);
  }, effectType: 'gold_prod_pct', effectValue: 10 }
];

/* Bug-Fix (Spieler-Meldung Kaledoss 18.07., "Purist"/"Grüner Daumen"/
   "Blaues Blut"/"Violette Vorherrschaft" - Runen-Raritaet-Titel: "wird auf
   der Seite gezaehlt, aber nicht im Game selbst"): Titel UND Kosmetiken
   pruefen ihre unlockCustom-Bedingung bisher IMMER live gegen den
   aktuellen Kontext - bei nicht-monotonen Bedingungen (z.B. "alle 6
   Runen-Plaetze gleiche Raritaet ausgeruestet", "alle Skilltree-Zweige
   maximiert") faellt der Titel/die Kosmetik faelschlich wieder auf
   "gesperrt" zurueck, sobald sich der Zustand seither aendert (Rune
   getauscht, Prestige-Reset) - obwohl sowohl der Hinweistext ("Jeder
   freigeschaltete Titel gibt einen dauerhaften Bonus... Freigeschaltet
   bleibt freigeschaltet.") als auch der Funktionskommentar bei
   bkmpIdleTitleEffectTotals das Gegenteil versprechen. GENAU dasselbe
   Bug-Muster wurde fuer Erfolge (BKMP_ACHIEVEMENTS) bereits am 13.07.
   behoben (siehe bkmpAchievementUnlocked in index.html) - hier dieselbe
   Loesung (localStorage-Merkliste "wurde je erreicht") fuer die beiden
   bisher uebersehenen Parallel-Systeme Titel/Kosmetik nachgezogen. Liegt
   bewusst in idledorf.js statt index.html, weil bkmpIdleTitleEffectTotals
   echte Kampf-Stats beeinflusst und auch auf idle-stream-mini.html
   (laedt index.html's Inline-Script NICHT) korrekt funktionieren muss. */
/* Balance-Audit-Fix (16.07., "kritischer Fund"): vorher lag die Merkliste
   NUR in localStorage - echter Datenverlust bei Geraetewechsel/Cache-Leeren
   (die Dauerboni aus bkmpIdleTitleEffectTotals unten verschwanden dann
   ersatzlos, obwohl Level/Kills/... laengst auf dem Server standen), UND
   mit einem einzigen localStorage-Eintrag im Browser faelschbar, OHNE die
   App je zu beruehren - ein deutlich niedrigerer Aufwand als jede andere
   Manipulation in dieser Wirtschaft. localStorage bleibt als synchroner
   Fast-Cache bestehen (diese Funktion wird sehr haeufig aufgerufen, u.a.
   bei jedem Stat-Rebuild, noch bevor bkmpIdleState immer sicher gesetzt
   ist), der eigentliche Speicherort ist jetzt aber bkmpIdleState.
   titles_unlocked_at (neue Spalte, siehe supabase-idle-title-unlock-
   persist.sql) - der ganz normal ueber upsertIdlePlayerState() mitgesichert
   wird wie der Rest des Spielstands. Alte, nur lokal bekannte
   Freischaltungen (Sessions von vor diesem Fix) werden beim ersten Lesen
   einmalig in bkmpIdleState uebernommen, damit niemand seine bereits
   erspielten Titel-Boni durch dieses Update verliert. */
const BKMP_IDLE_TITLE_UNLOCKED_AT_KEY = 'bkmp-idle-title-unlocked-at';
function bkmpIdleGetTitleUnlockedAtMap() {
  let local = {};
  try { local = JSON.parse(localStorage.getItem(BKMP_IDLE_TITLE_UNLOCKED_AT_KEY) || '{}'); } catch (e) {}
  const server = (bkmpIdleState && bkmpIdleState.titles_unlocked_at) || {};
  const merged = { ...local, ...server };
  if (bkmpIdleState && Object.keys(merged).length !== Object.keys(server).length) {
    bkmpIdleState.titles_unlocked_at = merged;
  }
  return merged;
}
function bkmpIdleSetTitleUnlockedAt(id) {
  const map = bkmpIdleGetTitleUnlockedAtMap();
  if (map[id]) return;
  map[id] = new Date().toISOString();
  try { localStorage.setItem(BKMP_IDLE_TITLE_UNLOCKED_AT_KEY, JSON.stringify(map)); } catch (e) {}
  if (bkmpIdleState) bkmpIdleState.titles_unlocked_at = map;
}
function bkmpIdleTitleUnlockedSticky(title, ctx) {
  if (!title.unlockCustom) return false;
  if (Boolean(title.unlockCustom(ctx))) { bkmpIdleSetTitleUnlockedAt(title.id); return true; }
  return Boolean(bkmpIdleGetTitleUnlockedAtMap()[title.id]);
}

/* Gleicher Fix wie bkmpIdleGetTitleUnlockedAtMap oben - siehe Kommentar
   dort. Kosmetiken haben keinen Kampf-Bonus, aber denselben Datenverlust-
   Bug (Freischaltungen verschwanden bei Geraetewechsel/Cache-Leeren). */
const BKMP_IDLE_COSMETIC_UNLOCKED_AT_KEY = 'bkmp-idle-cosmetic-unlocked-at';
function bkmpIdleGetCosmeticUnlockedAtMap() {
  let local = {};
  try { local = JSON.parse(localStorage.getItem(BKMP_IDLE_COSMETIC_UNLOCKED_AT_KEY) || '{}'); } catch (e) {}
  const server = (bkmpIdleState && bkmpIdleState.cosmetics_unlocked_at) || {};
  const merged = { ...local, ...server };
  if (bkmpIdleState && Object.keys(merged).length !== Object.keys(server).length) {
    bkmpIdleState.cosmetics_unlocked_at = merged;
  }
  return merged;
}
function bkmpIdleSetCosmeticUnlockedAt(id) {
  const map = bkmpIdleGetCosmeticUnlockedAtMap();
  if (map[id]) return;
  map[id] = new Date().toISOString();
  try { localStorage.setItem(BKMP_IDLE_COSMETIC_UNLOCKED_AT_KEY, JSON.stringify(map)); } catch (e) {}
  if (bkmpIdleState) bkmpIdleState.cosmetics_unlocked_at = map;
}
function bkmpIdleCosmeticUnlockedSticky(cosmetic, ctx) {
  if (!cosmetic.unlockCustom) return false;
  if (Boolean(cosmetic.unlockCustom(ctx))) { bkmpIdleSetCosmeticUnlockedAt(cosmetic.id); return true; }
  return Boolean(bkmpIdleGetCosmeticUnlockedAtMap()[cosmetic.id]);
}

/* Summiert die Boni aller FREIGESCHALTETEN (nicht nur des aktiv
   getragenen) Idle-Dorf-Titel - Sammlung-Prinzip: was du erreicht hast,
   bleibt dauerhaft wirksam, unabhaengig davon welchen Titel du gerade als
   Namenszusatz zeigst. */
function bkmpIdleTitleEffectTotals(ctx) {
  const totals = {};
  window.BKMP_IDLE_TITLES.forEach(title => {
    if (!title.effectType || !bkmpIdleTitleUnlockedSticky(title, ctx)) return;
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
  { id: 'sternenstaub', name: 'Sternenstaub', desc: 'Glitzernder Staub aus fernen Galaxien.', rarity: 'Mythisch', unlockCustom: ctx => ctx.idleBranchesMaxed >= 5 },
  /* Neue Kosmetiken 16.07. (Nutzerwunsch: "viel mehr... Präfixe... mit
     Farbverläufen und Effekten... Gilden Arena... Überrasche mich") - je
     ein eigenständiger visueller Stil pro großem Feature-Bereich des
     heutigen Tages, gleiche Farbverlauf-Technik wie die bestehenden
     Kosmetiken oben (siehe style.css .mc-cosmetic-*). */
  { id: 'guild_heraldik', name: 'Gilden-Wappen', desc: 'Prunkvolles Gold-Burgunder-Wappen für Gildenanführer.', rarity: 'Episch', unlockCustom: ctx => ctx.guildRole === 'leader' },
  { id: 'arena_blutrausch', name: 'Blutrausch', desc: 'Feurig pulsierendes Rot für Arena-Champions.', rarity: 'Legendär', unlockCustom: ctx => ctx.arenaWins >= 50 },
  { id: 'weltenbezwinger', name: 'Weltenbezwinger', desc: 'Dunkler Purpur-Glanz für Weltboss-Veteranen.', rarity: 'Legendär', unlockCustom: ctx => ctx.raidBossesDefeated >= 25 },
  { id: 'drachenschuppen', name: 'Drachenschuppen', desc: 'Schillernde Schuppenfarben für vielfältige Drachenzüchter.', rarity: 'Episch', unlockCustom: ctx => ctx.idleDragonSpeciesOwned >= 5 },
  { id: 'legendaerer_hort', name: 'Legendärer Hort', desc: 'Opulentes Gold-Schwarz für Besitzer legendärer Drachen.', rarity: 'Mythisch', unlockCustom: ctx => ctx.idleLegendaryDragonsOwned >= 1 },
  { id: 'gluetnfeuer', name: 'Glutfeuer', desc: 'Warmes Glühen für treue Dranbleiber.', rarity: 'Episch', unlockCustom: ctx => ctx.idleLoginStreak >= 30 },
  { id: 'zahnradglanz', name: 'Zahnradglanz', desc: 'Bronze-Kupfer-Schimmer für Steampunk-Liebhaber.', rarity: 'Selten', unlockCustom: ctx => ctx.idleHasSteampunkSkin },
  /* Neu 16.07. (Lategame-Content): Prestige-Anzahl gated bisher NICHTS
     (anders als die Gesamt-Erfolgszahl, die bereits bis 100 Kosmetiken
     freischaltet, siehe BKMP_COSMETICS in index.html) - obwohl die
     Stufen-Anforderung pro Aufstieg unbegrenzt weiterwaechst. Dieselbe
     Eskalations-Logik wie oben, nur an ctx.idlePrestigeLevel gekoppelt. */
  { id: 'portal_wirbel', name: 'Portal-Wirbel', desc: 'Verzerrtes Violett-Türkis wie ein sich schließendes Portal.', rarity: 'Legendär', unlockCustom: ctx => ctx.idlePrestigeLevel >= 10 },
  { id: 'ewiger_kreislauf', name: 'Ewiger Kreislauf', desc: 'Ein Verlauf, der nie endet, für die, die nie aufhören.', rarity: 'Mythisch', unlockCustom: ctx => ctx.idlePrestigeLevel >= 20 },
  { id: 'jenseits_der_sterne', name: 'Jenseits der Sterne', desc: 'Nur für die wenigen, die den Turm der Aufstiege bis hierher bezwungen haben.', rarity: 'Mythisch', unlockCustom: ctx => ctx.idlePrestigeLevel >= 30 }
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

/* ---------------- PvP-Arena: Erfolge (window.BKMP_ARENA_ACHIEVEMENTS_EXTRA) ----------------
   Gleiches Einbinde-Muster wie BKMP_RAID_ACHIEVEMENTS_EXTRA. */
window.BKMP_ARENA_ACHIEVEMENTS_EXTRA = [
  { id: 'arena_first_win', category: 'Arena', title: 'Erster Arena-Sieg', desc: 'Gewinne deinen ersten Arena-Kampf.', check: ctx => ctx.arenaWins >= 1 },
  { id: 'arena_win_10', category: 'Arena', title: 'Arena-Kämpfer', desc: 'Gewinne 10 Arena-Kämpfe.', progress: ctx => [ctx.arenaWins, 10], check: ctx => ctx.arenaWins >= 10 },
  { id: 'arena_win_50', category: 'Arena', title: 'Arena-Veteran', desc: 'Gewinne 50 Arena-Kämpfe.', progress: ctx => [ctx.arenaWins, 50], check: ctx => ctx.arenaWins >= 50 },
  { id: 'arena_win_200', category: 'Arena', title: 'Arena-Champion', desc: 'Gewinne 200 Arena-Kämpfe.', progress: ctx => [ctx.arenaWins, 200], check: ctx => ctx.arenaWins >= 200 },
  { id: 'arena_rating_1500', category: 'Arena', title: 'Aufstrebender Kämpfer', desc: 'Erreiche ein Arena-Rating von 1500.', progress: ctx => [ctx.arenaRating, 1500], check: ctx => ctx.arenaRating >= 1500 }
];

/* ---------------- Gilde: Erfolge (window.BKMP_GUILD_ACHIEVEMENTS_EXTRA) ----------------
   Gleiches Einbinde-Muster wie BKMP_RAID_ACHIEVEMENTS_EXTRA. Rein aus dem
   AKTUELLEN Gildenstand abgeleitet (siehe bkmpGuildGetAchievementContextFields)
   - kein Titel/Kosmetik-Reward verknuepft, genau wie bei Weltboss/Arena. */
window.BKMP_GUILD_ACHIEVEMENTS_EXTRA = [
  { id: 'guild_member', category: 'Gilde', title: 'Gildenmitglied', desc: 'Trete einer Gilde bei.', check: ctx => ctx.inGuild },
  { id: 'guild_leader', category: 'Gilde', title: 'Anführer', desc: 'Werde Anführer einer Gilde.', check: ctx => ctx.guildRole === 'leader' },
  { id: 'guild_level_5', category: 'Gilde', title: 'Aufstrebende Gilde', desc: 'Erreiche Gildenlevel 5.', progress: ctx => [ctx.guildLevel, 5], check: ctx => ctx.guildLevel >= 5 },
  { id: 'guild_level_10', category: 'Gilde', title: 'Etablierte Gilde', desc: 'Erreiche Gildenlevel 10.', progress: ctx => [ctx.guildLevel, 10], check: ctx => ctx.guildLevel >= 10 },
  { id: 'guild_level_20', category: 'Gilde', title: 'Mächtige Gilde', desc: 'Erreiche Gildenlevel 20.', progress: ctx => [ctx.guildLevel, 20], check: ctx => ctx.guildLevel >= 20 },
  { id: 'guild_xp_1m', category: 'Gilde', title: 'Großzügige Gilde', desc: 'Deine Gilde hat insgesamt 1.000.000 Gold in die Kasse eingezahlt.', progress: ctx => [ctx.guildXp, 1000000], check: ctx => ctx.guildXp >= 1000000 },
  { id: 'guild_boss_first', category: 'Gilde', title: 'Erster Gildenboss', desc: 'Besiege deinen ersten Gildenboss.', check: ctx => ctx.guildBossesDefeated >= 1 },
  { id: 'guild_boss_10', category: 'Gilde', title: 'Gildenboss-Bezwinger', desc: 'Besiege 10 Gildenbosse.', progress: ctx => [ctx.guildBossesDefeated, 10], check: ctx => ctx.guildBossesDefeated >= 10 },
  { id: 'guild_full_roster', category: 'Gilde', title: 'Volles Haus', desc: 'Sei Mitglied einer Gilde mit 20 Mitgliedern.', check: ctx => ctx.guildMemberCount >= 20 }
];
