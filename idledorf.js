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

/* ---------------- Reine Mathe-Funktionen (kein DOM) ---------------- */

function bkmpIdleXpForLevel(level, xpCurveCfg) {
  const cfg = xpCurveCfg || { base: 40, growth: 1.42 };
  return Math.max(1, Math.round(cfg.base * Math.pow(Math.max(1, level), cfg.growth)));
}

function bkmpIdleFormatStage(index) {
  const i = Math.max(0, Math.floor(index || 0));
  return `${Math.floor(i / 10)}-${i % 10}`;
}

/* Spawn-Logik: waehlt die ART des naechsten Drachen anhand der Stufe
   (killIndex+1 = wie oft insgesamt schon gekaempft wurde, 1-indiziert).
   - alle 25 Stufen (25/50/75/...): der grosse Boss
   - alle 10 Stufen (10/20/30/...), aber NICHT wenn schon Boss-Stufe: Miniboss
   - sonst kleine Zufallschance auf einen seltenen Drachen (Schatten/Wuff)
   - ansonsten einer der vier Standard-Elementardrachen, zufaellig */
function bkmpIdleSelectDragonKindId(killIndex, dragons, rareChancePct) {
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
  const rare = byRule('rare');
  if (rare.length && Math.random() * 100 < (rareChancePct != null ? rareChancePct : 8)) {
    return rare[Math.floor(Math.random() * rare.length)].id;
  }
  const standard = byRule('standard');
  const pool = standard.length ? standard : active;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)].id : ((active[0] || {}).id || null);
}

function bkmpIdleDragonStatsAt(killIndex, dragons, cfg) {
  const c = cfg || {};
  const kindId = bkmpIdleSelectDragonKindId(killIndex, dragons, c.chancePct);
  const archetype = (dragons || []).find(d => d.id === kindId);
  if (!archetype) return null;
  const hpGrowth = Math.pow(1 + (c.hpGrowthPerKill || 0), killIndex);
  const atkGrowth = Math.pow(1 + (c.atkGrowthPerKill || 0), killIndex);
  let bossTier = null;
  let hpMult = 1;
  let atkMult = 1;
  if (archetype.spawn_rule === 'boss_25') { bossTier = 'boss'; hpMult = c.bossHpMult || 3.2; atkMult = c.bossAtkMult || 1.7; }
  else if (archetype.spawn_rule === 'miniboss_10') { bossTier = 'miniboss'; hpMult = c.minibossHpMult || 1.8; atkMult = c.minibossAtkMult || 1.3; }
  return {
    id: archetype.id,
    name: archetype.name,
    emoji: archetype.emoji || '🐉',
    spriteKey: archetype.sprite_key || archetype.id,
    colorTheme: archetype.color_theme || '',
    killIndex,
    isBoss: Boolean(bossTier),
    bossTier,
    maxHp: Math.max(1, Math.round((archetype.base_hp || 50) * hpGrowth * hpMult)),
    attack: Math.max(1, (archetype.base_attack || 5) * atkGrowth * atkMult),
    defense: archetype.base_defense || 0,
    archetype
  };
}

function bkmpIdleRewardsAt(dragon, playerBonuses, cfg) {
  if (!dragon || !dragon.archetype) return { gold: 0, xp: 0, wood: 0, stone: 0, crystals: 0, essence: 0 };
  const archetype = dragon.archetype;
  const c = cfg || {};
  const goldGrowth = Math.pow(1 + (c.goldGrowthPerKill || 0), dragon.killIndex);
  const xpGrowth = Math.pow(1 + (c.xpGrowthPerKill || 0), dragon.killIndex);
  const rewardMult = dragon.bossTier === 'boss' ? (c.bossRewardMult || 4) : dragon.bossTier === 'miniboss' ? (c.minibossRewardMult || 2) : 1;
  const bonuses = playerBonuses || {};
  const goldMult = 1 + (bonuses.goldBonus || 0) / 100;
  const xpMult = 1 + (bonuses.xpBonus || 0) / 100;
  const lootMult = 1 + (bonuses.lootBonus || 0) / 100;
  return {
    gold: Math.round((archetype.gold_reward_base || 0) * goldGrowth * rewardMult * goldMult),
    xp: Math.round((archetype.xp_reward_base || 0) * xpGrowth * rewardMult * xpMult),
    wood: Math.round((archetype.wood_reward_base || 0) * lootMult),
    stone: Math.round((archetype.stone_reward_base || 0) * lootMult),
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
   inhaltlich eine Rate/Chance beschreiben, kein absoluter Kampfwert sind. */
const BKMP_IDLE_UPGRADES = [
  { id: 'atk', name: 'Waffenschmiede', desc: '+1 Angriff pro Stufe.', icon: '⚔️', resource: 'gold', baseCost: 35, costGrowth: 1.13, effectType: 'attack_flat', effectPerLevel: 1, maxLevel: 50 },
  { id: 'def', name: 'Rüstkammer', desc: '+1 Verteidigung pro Stufe.', icon: '🛡️', resource: 'gold', baseCost: 35, costGrowth: 1.13, effectType: 'defense_flat', effectPerLevel: 1, maxLevel: 50 },
  { id: 'hp', name: 'Vorratshaus', desc: '+5 Leben pro Stufe.', icon: '❤️', resource: 'wood', baseCost: 25, costGrowth: 1.12, effectType: 'hp_flat', effectPerLevel: 5, maxLevel: 50 },
  { id: 'walls', name: 'Steinmauern', desc: '+1 Verteidigung pro Stufe.', icon: '🧱', resource: 'stone', baseCost: 25, costGrowth: 1.12, effectType: 'defense_flat', effectPerLevel: 1, maxLevel: 50 },
  { id: 'crit', name: 'Zielübung', desc: '+1 Krit-Chance pro Stufe.', icon: '🎯', resource: 'essence', baseCost: 6, costGrowth: 1.2, effectType: 'crit_chance_flat', effectPerLevel: 1, maxLevel: 25 },
  { id: 'crystal_gold', name: 'Kristallschliff', desc: '+2% Gold-Ausbeute pro Stufe.', icon: '💎', resource: 'crystals', baseCost: 5, costGrowth: 1.2, effectType: 'gold_prod_pct', effectPerLevel: 2, maxLevel: 30 },
  { id: 'essence_loot', name: 'Essenzbindung', desc: '+2% Lootchance pro Stufe.', icon: '🧪', resource: 'essence', baseCost: 4, costGrowth: 1.2, effectType: 'loot_chance_pct', effectPerLevel: 2, maxLevel: 30 }
];

function bkmpIdleUpgradeCost(def, currentLevel) {
  return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel));
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
  /* Deutlich gentler als vorher (war 0.045/0.035 - Kaempfe wurden ab
     Stufe ~50 unspielbar lang). Bei 0.02/0.016 dauert Stufe 100 noch
     einige Sekunden statt mehrerer Minuten. */
  dragon_scaling: { hpGrowthPerKill: 0.02, atkGrowthPerKill: 0.016 },
  reward_scaling: { goldGrowthPerKill: 0.022, xpGrowthPerKill: 0.022 },
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
  { id: 'erddrache', name: 'Erddrache', emoji: '🪨', sprite_key: 'erddrache', spawn_rule: 'standard', color_theme: '#84cc16', tier_order: 2, base_hp: 70, base_attack: 6, base_defense: 3, gold_reward_base: 6, xp_reward_base: 6, wood_reward_base: 1, stone_reward_base: 3, crystal_reward_base: 0, essence_reward_base: 0, is_boss: false, active: true },
  { id: 'wasserdrache', name: 'Wasserdrache', emoji: '💧', sprite_key: 'wasserdrache', spawn_rule: 'standard', color_theme: '#38bdf8', tier_order: 3, base_hp: 65, base_attack: 6, base_defense: 2, gold_reward_base: 6, xp_reward_base: 6, wood_reward_base: 2, stone_reward_base: 2, crystal_reward_base: 0, essence_reward_base: 0, is_boss: false, active: true },
  { id: 'yakshas-drache', name: 'Yakshas Drache', emoji: '🐲', sprite_key: 'yakshas-drache', spawn_rule: 'miniboss_10', color_theme: '#a78bfa', tier_order: 4, base_hp: 115, base_attack: 10, base_defense: 4, gold_reward_base: 14, xp_reward_base: 14, wood_reward_base: 3, stone_reward_base: 3, crystal_reward_base: 2, essence_reward_base: 1, is_boss: true, active: true },
  { id: 'yaksha-boss', name: 'Yaksha der Drachenboss', emoji: '👑', sprite_key: 'yaksha-boss', spawn_rule: 'boss_25', color_theme: '#ef4444', tier_order: 5, base_hp: 220, base_attack: 16, base_defense: 8, gold_reward_base: 28, xp_reward_base: 28, wood_reward_base: 5, stone_reward_base: 5, crystal_reward_base: 5, essence_reward_base: 3, is_boss: true, active: true },
  { id: 'schattendrache', name: 'Schattendrache', emoji: '🌑', sprite_key: 'schattendrache', spawn_rule: 'rare', color_theme: '#6b21a8', tier_order: 6, base_hp: 90, base_attack: 10, base_defense: 3, gold_reward_base: 12, xp_reward_base: 10, wood_reward_base: 2, stone_reward_base: 2, crystal_reward_base: 1, essence_reward_base: 1, is_boss: false, active: true },
  { id: 'wuffdrache', name: 'Wuffdrache', emoji: '🐾', sprite_key: 'wuffdrache', spawn_rule: 'rare', color_theme: '#fbbf24', tier_order: 7, base_hp: 50, base_attack: 5, base_defense: 1, gold_reward_base: 10, xp_reward_base: 8, wood_reward_base: 1, stone_reward_base: 1, crystal_reward_base: 1, essence_reward_base: 1, is_boss: false, active: true }
];

/* ---------------- State ---------------- */

let bkmpIdleState = null;
let bkmpIdleDragonDefs = [];
let bkmpIdleSkillDefs = [];
let bkmpIdleConfig = {};
let bkmpIdleCurrentDragon = null;
let bkmpIdleVillageHp = null;
let bkmpIdleEffectiveStats = null;
let bkmpIdleLoopTimer = null;
let bkmpIdleModalOpen = false;
let bkmpIdleSyncPending = false;
let bkmpIdleSyncTimer = null;
let bkmpIdleConfigLoaded = false;

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
    dragon_kills: 0, boss_kills: 0, current_dragon_index: 0, highest_dragon_index: 0, auto_advance: true,
    playtime_seconds: 0,
    last_seen_at: new Date().toISOString(),
    last_offline_claim: {}
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
  try { remote = typeof loadIdlePlayerState === 'function' ? await loadIdlePlayerState(name) : null; } catch (e) { console.warn('Idle Dorf: Fortschritt konnte nicht geladen werden.', e); }
  bkmpIdleState = remote || bkmpIdleDefaultState(name);
  bkmpIdleVillageHp = null;
  bkmpIdleCurrentDragon = null;
}

function bkmpIdleRecomputeEffectiveStats() {
  if (!bkmpIdleState) return;
  const skillTotals = bkmpIdleSkillEffectTotals(bkmpIdleState.skill_allocations, bkmpIdleSkillDefs);
  const upgradeTotals = bkmpIdleUpgradeEffectTotals(bkmpIdleState.upgrade_purchases);
  const base = bkmpIdleConfig.base_stats || BKMP_IDLE_FALLBACK_CONFIG.base_stats;
  /* t() summiert einen Effekttyp aus Skilltree UND Upgrades. Kampfwerte
     nutzen jetzt "_flat" (feste Zahlen, addiert VOR dem Prozent-Multiplikator),
     Produktionsraten (Gold/Loot) bleiben "_pct". */
  const t = key => (skillTotals[key] || 0) + (upgradeTotals[key] || 0);
  const prevMaxHp = bkmpIdleEffectiveStats ? bkmpIdleEffectiveStats.hp : null;
  bkmpIdleEffectiveStats = {
    attack: (base.attack + t('attack_flat')) * (1 + t('attack_pct') / 100),
    defense: (base.defense + t('defense_flat')) * (1 + t('defense_pct') / 100),
    hp: Math.round((base.hp + t('hp_flat')) * (1 + t('hp_pct') / 100)),
    critChance: Math.min(75, base.critChance + t('crit_chance_flat') + t('crit_chance_pct')),
    critDamage: base.critDamage + t('crit_damage_flat') + t('crit_damage_pct'),
    goldBonus: base.goldBonus + t('gold_prod_pct') + t('gold_find_pct'),
    xpBonus: base.xpBonus + t('xp_pct'),
    lootBonus: base.lootBonus + t('loot_chance_pct')
  };
  if (bkmpIdleVillageHp === null || bkmpIdleVillageHp === undefined) {
    bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;
  } else if (prevMaxHp !== null && bkmpIdleEffectiveStats.hp > prevMaxHp) {
    bkmpIdleVillageHp += (bkmpIdleEffectiveStats.hp - prevMaxHp);
  }
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

function bkmpIdleCountMaxedBranches() {
  if (!bkmpIdleState || !bkmpIdleSkillDefs.length) return 0;
  const alloc = bkmpIdleState.skill_allocations || {};
  return BKMP_IDLE_BRANCH_ORDER.filter(branch => {
    const nodes = bkmpIdleSkillDefs.filter(n => n.branch === branch);
    return nodes.length > 0 && nodes.every(n => Number(alloc[n.id] || 0) >= n.max_rank);
  }).length;
}

/* ---------------- Achievement-Kontext-Felder (fuer index.html) ---------------- */

function bkmpIdleGetAchievementContextFields() {
  const s = bkmpIdleState;
  return {
    idleDragonKills: s ? Number(s.dragon_kills || 0) : 0,
    idleBossKills: s ? Number(s.boss_kills || 0) : 0,
    idleLevel: s ? Number(s.level || 0) : 0,
    idleGoldEarned: s ? Number(s.total_gold_earned || 0) : 0,
    idleSkillPointsSpent: s ? Number(s.skill_points_spent || 0) : 0,
    idleBranchesMaxed: bkmpIdleCountMaxedBranches()
  };
}

/* ---------------- Kampf-Loop ---------------- */

const BKMP_IDLE_SPRITE_CLASS_PREFIX = 'idle-sprite-';

function bkmpIdleSpawnDragon() {
  bkmpIdleCurrentDragon = bkmpIdleDragonStatsAt(bkmpIdleState.current_dragon_index, bkmpIdleDragonDefs, bkmpIdleGetMergedDragonScalingCfg());
  if (!bkmpIdleCurrentDragon) return;
  bkmpIdleCurrentDragon.hp = bkmpIdleCurrentDragon.maxHp;
  const nameEl = document.getElementById('idleDragonName');
  if (nameEl) nameEl.textContent = `${bkmpIdleCurrentDragon.isBoss ? '👑 BOSS: ' : ''}${bkmpIdleCurrentDragon.name} (Stufe ${bkmpIdleFormatStage(bkmpIdleCurrentDragon.killIndex)})`;
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
  }
  bkmpIdleUpdateDragonHpBar();
  bkmpIdleRenderStageBar();
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

function bkmpIdleHandleDragonDefeated() {
  const rewards = bkmpIdleRewardsAt(bkmpIdleCurrentDragon, bkmpIdleEffectiveStats, bkmpIdleGetMergedRewardScalingCfg());
  bkmpIdleState.gold += rewards.gold;
  bkmpIdleState.total_gold_earned += rewards.gold;
  bkmpIdleState.wood += rewards.wood;
  bkmpIdleState.stone += rewards.stone;
  bkmpIdleState.crystals += rewards.crystals;
  bkmpIdleState.essence += rewards.essence;
  bkmpIdleState.dragon_kills += 1;
  if (bkmpIdleCurrentDragon.isBoss) bkmpIdleState.boss_kills += 1;
  const autoAdvance = bkmpIdleState.auto_advance !== false;
  if (autoAdvance) bkmpIdleState.current_dragon_index += 1;
  bkmpIdleState.highest_dragon_index = Math.max(Number(bkmpIdleState.highest_dragon_index || 0), bkmpIdleState.current_dragon_index);
  bkmpIdleAddXp(rewards.xp);
  bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;
  bkmpIdleLog(`${bkmpIdleCurrentDragon.emoji} ${bkmpIdleCurrentDragon.name} besiegt! +${rewards.gold}💰 +${rewards.xp}✨` + (bkmpIdleCurrentDragon.isBoss ? ' 👑 BOSS!' : '') + (autoAdvance ? '' : ' (bleibt auf dieser Stufe)'));
  bkmpIdleSpawnDragon();
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
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
  bkmpIdleState.playtime_seconds = Number(bkmpIdleState.playtime_seconds || 0) + 0.9;

  const vRoll = bkmpIdleDamageRoll(bkmpIdleEffectiveStats.attack, bkmpIdleEffectiveStats.critChance, bkmpIdleEffectiveStats.critDamage, bkmpIdleCurrentDragon.defense);
  bkmpIdleCurrentDragon.hp = Math.max(0, bkmpIdleCurrentDragon.hp - vRoll.amount);
  bkmpIdleSpawnProjectile('arrow', vRoll.amount, vRoll.isCrit);
  bkmpIdleSpawnHitFlash('idleDragon');
  bkmpIdleUpdateDragonHpBar();

  if (bkmpIdleCurrentDragon.hp <= 0) {
    bkmpIdleHandleDragonDefeated();
    return;
  }

  const dRoll = bkmpIdleDamageRoll(bkmpIdleCurrentDragon.attack, 5, 150, bkmpIdleEffectiveStats.defense);
  bkmpIdleVillageHp = Math.max(0, bkmpIdleVillageHp - dRoll.amount);
  bkmpIdleSpawnProjectile('fire', dRoll.amount, dRoll.isCrit);
  bkmpIdlePlaySpriteAttack();
  bkmpIdleSpawnHitFlash('idleVillage');
  bkmpIdleUpdateVillageHpBar();

  if (bkmpIdleVillageHp <= 0) {
    bkmpIdleHandleDefeat();
  }
}

function bkmpIdleStartLoop() {
  bkmpIdleStopLoop();
  bkmpIdleLoopTimer = window.setInterval(bkmpIdleTick, 900);
}
function bkmpIdleStopLoop() {
  if (bkmpIdleLoopTimer) { window.clearInterval(bkmpIdleLoopTimer); bkmpIdleLoopTimer = null; }
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
  hud.innerHTML = `
    <div class="idle-hud-level">Level ${bkmpIdleState.level} <span class="idle-hud-skillpoints">🔹 ${bkmpIdleState.skill_points_available} Skillpunkte</span></div>
    <div class="idle-xp-bar"><div class="idle-xp-fill" style="width:${xpPct}%"></div></div>
    <div class="idle-xp-label">${Math.floor(bkmpIdleState.xp)} / ${xpNeeded} XP</div>
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

function bkmpIdleJumpToHighestStage() {
  if (!bkmpIdleState) return;
  const highest = Number(bkmpIdleState.highest_dragon_index || 0);
  if (highest <= Number(bkmpIdleState.current_dragon_index || 0)) return;
  bkmpIdleState.current_dragon_index = highest;
  bkmpIdleVillageHp = bkmpIdleEffectiveStats ? bkmpIdleEffectiveStats.hp : bkmpIdleVillageHp;
  bkmpIdleSpawnDragon();
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleQueueSync();
}

function bkmpIdleRenderStageBar() {
  const el = document.getElementById('idleStageBar');
  if (!el || !bkmpIdleState) return;
  const current = Number(bkmpIdleState.current_dragon_index || 0);
  const highest = Number(bkmpIdleState.highest_dragon_index || 0);
  const autoAdvance = bkmpIdleState.auto_advance !== false;
  el.innerHTML = `
    <span class="idle-stage-label">Stufe <strong>${bkmpIdleFormatStage(current)}</strong>${highest > current ? ` · Beste Stufe: <strong>${bkmpIdleFormatStage(highest)}</strong>` : ''}</span>
    <div class="idle-stage-buttons">
      <button type="button" class="btn-nein idle-stage-btn" id="idleStageAutoAdvanceBtn">${autoAdvance ? '⬆️ Steigt automatisch auf' : '📍 Bleibt auf dieser Stufe'}</button>
      ${highest > current ? '<button type="button" class="btn-ja idle-stage-btn" id="idleStageJumpBtn">Zur besten Stufe springen</button>' : ''}
    </div>`;
  const autoBtn = document.getElementById('idleStageAutoAdvanceBtn');
  if (autoBtn) autoBtn.addEventListener('click', bkmpIdleToggleAutoAdvance);
  const jumpBtn = document.getElementById('idleStageJumpBtn');
  if (jumpBtn) jumpBtn.addEventListener('click', bkmpIdleJumpToHighestStage);
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

function bkmpIdleRenderSkilltreePanel() {
  const panel = document.getElementById('idlePanelSkilltree');
  if (!panel || !bkmpIdleState) return;
  if (!bkmpIdleSkillDefs.length) { panel.innerHTML = '<p class="empty-hint">Skilltree wird bald verfügbar sein.</p>'; return; }
  const alloc = bkmpIdleState.skill_allocations || {};
  panel.innerHTML = `
    <p class="idle-skillpoints-hint">Verfügbare Skillpunkte: <strong>${bkmpIdleState.skill_points_available}</strong></p>
    ${BKMP_IDLE_BRANCH_ORDER.map(branch => {
      const nodes = bkmpIdleSkillDefs.filter(n => n.branch === branch).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      if (!nodes.length) return '';
      return `<div class="idle-skill-branch">
        <div class="idle-skill-branch-title">${BKMP_IDLE_BRANCH_LABELS[branch] || branch}</div>
        <div class="idle-skill-node-grid">
          ${nodes.map(node => {
            const rank = Number(alloc[node.id] || 0);
            const canAllocate = bkmpIdleCanAllocateSkill(node);
            const maxed = rank >= node.max_rank;
            return `
              <div class="idle-skill-node ${rank > 0 ? 'ranked' : ''}">
                <div class="idle-skill-node-icon">${node.icon || '✨'}</div>
                <div class="idle-skill-node-name">${escapeHtml(node.name)}</div>
                <div class="idle-skill-node-desc">${escapeHtml(node.description || '')}</div>
                <div class="idle-skill-node-rank">Rang ${rank}/${node.max_rank}</div>
                <button type="button" class="btn-ja idle-skill-node-btn" data-node-id="${node.id}" ${!canAllocate ? 'disabled' : ''}>
                  ${maxed ? 'Max' : `+1 (${node.cost_per_rank} 🔹)`}
                </button>
              </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}`;
  panel.querySelectorAll('.idle-skill-node-btn').forEach(btn => btn.addEventListener('click', () => bkmpIdleAllocateSkill(btn.dataset.nodeId)));
}

/* ---------------- Rendering: Sammlung- / Erfolge-Tab (Shortcuts ins bestehende System) ---------------- */

function bkmpIdleRenderSammlungPanel() {
  const panel = document.getElementById('idlePanelSammlung');
  if (!panel) return;
  panel.innerHTML = '<p class="idle-panel-hint">Deine 18 Idle-Dorf-Kosmetiken schaltest du durch Fortschritt frei und findest sie in deinem Erfolge-Fenster unter „Kosmetik".</p><button type="button" class="btn-ja" id="idleOpenCosmeticsBtn">Kosmetik öffnen</button>';
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
  panel.innerHTML = '<p class="idle-panel-hint">Deine Idle-Dorf-Erfolge findest du in deinem Erfolge-Fenster unter der Kategorie „Idle Dorf".</p><button type="button" class="btn-ja" id="idleOpenAchievementsBtn">Erfolge öffnen</button>';
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
  { id: 'playtime', label: 'Top Spielzeit', field: 'playtime_seconds', format: v => Math.round(v / 60) + ' Min.' }
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
  const myName = (typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '').trim().toLowerCase();
  const rows = [...bkmpIdleLeaderboardStats]
    .filter(s => Number(s[tab.field] || 0) > 0)
    .sort((a, b) => Number(b[tab.field] || 0) - Number(a[tab.field] || 0))
    .slice(0, 25);
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

/* ---------------- Tabs & Modal ---------------- */

const bkmpIdleTabs = [
  { id: 'kampf', btn: 'idleTabBtnKampf', panel: 'idlePanelKampf', render: null },
  { id: 'upgrades', btn: 'idleTabBtnUpgrades', panel: 'idlePanelUpgrades', render: bkmpIdleRenderUpgradesPanel },
  { id: 'skilltree', btn: 'idleTabBtnSkilltree', panel: 'idlePanelSkilltree', render: bkmpIdleRenderSkilltreePanel },
  { id: 'sammlung', btn: 'idleTabBtnSammlung', panel: 'idlePanelSammlung', render: bkmpIdleRenderSammlungPanel },
  { id: 'erfolge', btn: 'idleTabBtnErfolge', panel: 'idlePanelErfolge', render: bkmpIdleRenderErfolgePanel },
  { id: 'bestenliste', btn: 'idleTabBtnBestenliste', panel: 'idlePanelBestenliste', render: bkmpIdleRenderBestenlistePanel }
];
let bkmpIdleActiveTab = 'kampf';

function bkmpIdleRenderActiveTabContent() {
  const tab = bkmpIdleTabs.find(t => t.id === bkmpIdleActiveTab);
  if (tab && typeof tab.render === 'function') tab.render();
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
    });
  });
}

async function bkmpIdleOpenModal() {
  const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
  if (!name) {
    const mcNameOverlay = document.getElementById('mcNameOverlay');
    const mcNameInput = document.getElementById('mcNameInput');
    if (mcNameOverlay && mcNameInput) { mcNameInput.value = ''; mcNameOverlay.classList.add('visible'); mcNameInput.focus(); }
    return;
  }
  const overlay = document.getElementById('idleDorfOverlay');
  if (!overlay) return;
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');
  bkmpIdleModalOpen = true;

  await bkmpIdleEnsureConfigLoaded();
  await bkmpIdleLoadOrInitState(name);
  bkmpIdleRecomputeEffectiveStats();

  const offlineResult = await bkmpIdleClaimOfflineProgress(name);
  if (offlineResult) bkmpIdleApplyOfflineResult(offlineResult);
  bkmpIdleShowOfflineCard(offlineResult);
  bkmpIdleRecomputeEffectiveStats();

  if (!bkmpIdleCurrentDragon) bkmpIdleSpawnDragon();
  bkmpIdleRenderHud();
  bkmpIdleRenderStageBar();
  bkmpIdleUpdateVillageHpBar();
  bkmpIdleUpdateDragonHpBar();
  bkmpIdleStartLoop();
  bkmpIdleRenderActiveTabContent();
  if (typeof renderAchievementBadge === 'function') renderAchievementBadge();
}

function bkmpIdleCloseModal() {
  const overlay = document.getElementById('idleDorfOverlay');
  if (overlay) overlay.classList.remove('visible');
  document.body.classList.remove('modal-open');
  bkmpIdleModalOpen = false;
  bkmpIdleStopLoop();
  bkmpIdleQueueSync();
  bkmpIdleFlushSync();
}

function bkmpIdlePreloadStateIfNamed() {
  const name = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : '';
  if (!name) return;
  bkmpIdleLoadOrInitState(name)
    .then(() => { if (typeof renderAchievementBadge === 'function') renderAchievementBadge(); })
    .catch(() => {});
}

function bkmpIdleInit() {
  bkmpIdleInitTabs();
  const openBtn = document.getElementById('idleDorfButton');
  if (openBtn) openBtn.addEventListener('click', bkmpIdleOpenModal);
  const closeBtn = document.getElementById('idleDorfClose');
  if (closeBtn) closeBtn.addEventListener('click', bkmpIdleCloseModal);
  const closeX = document.getElementById('idleDorfCloseX');
  if (closeX) closeX.addEventListener('click', bkmpIdleCloseModal);
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

window.BKMP_IDLE_TITLES = [
  ...window.BKMP_IDLE_DRAGON_KILL_TIERS.map(([n, label]) => ({ id: `idletitle_dragon_${n}`, name: label, desc: `Für ${n} besiegte Drachen im Idle Dorf.`, unlockAchievement: `idledragon_${n}` })),
  ...window.BKMP_IDLE_LEVEL_TIERS.map(([n, label]) => ({ id: `idletitle_level_${n}`, name: label, desc: `Erreiche Dorf-Level ${n}.`, unlockAchievement: `idlelevel_${n}` })),
  ...window.BKMP_IDLE_GOLD_TIERS.map(([n, label]) => ({ id: `idletitle_gold_${n}`, name: label, desc: `Sammle ${n} Gold im Idle Dorf.`, unlockAchievement: `idlegold_${n}` })),
  ...window.BKMP_IDLE_SKILLPOINTS_TIERS.map(([n, label]) => ({ id: `idletitle_skill_${n}`, name: label, desc: `Investiere ${n} Skillpunkte.`, unlockAchievement: `idleskill_${n}` })),
  { id: 'idletitle_founder', name: 'Dorfgründer', desc: 'Das Idle Dorf gegründet.', unlockAchievement: 'idle_started' },
  { id: 'idletitle_boss1', name: 'Bosskämpfer', desc: 'Besiegt den ersten Boss.', unlockAchievement: 'idle_first_boss' },
  { id: 'idletitle_boss10', name: 'Bossjäger', desc: 'Besiegt 10 Bosse.', unlockAchievement: 'idle_boss_10' },
  { id: 'idletitle_boss50', name: 'Boss-Vernichter', desc: 'Besiegt 50 Bosse.', unlockAchievement: 'idle_boss_50' },
  { id: 'idletitle_branch1', name: 'Spezialist', desc: 'Ein Skilltree-Zweig maximiert.', unlockAchievement: 'idle_branch_one' },
  { id: 'idletitle_branch3', name: 'Vielseitiger Anführer', desc: 'Drei Skilltree-Zweige maximiert.', unlockAchievement: 'idle_branch_three' },
  { id: 'idletitle_branchall', name: 'Skilltree-Meister', desc: 'Alle Skilltree-Zweige maximiert.', unlockAchievement: 'idle_branch_all' }
];

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
