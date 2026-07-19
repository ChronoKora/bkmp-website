// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). js/core/bkmp-combat-math.js


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

/* ---------------- Rendering: Kampf-Tab ---------------- */

function bkmpIdleFormatNumber(n) {
  n = Math.floor(Number(n) || 0);
  if (n >= 1000000) return (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
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
