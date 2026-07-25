/* Shared read-only "game content" reference tables (idle_dragons,
   idle_game_config, idle_skill_nodes) reused by every Teststand. These are
   a reasonable, internally-consistent approximation of the real production
   content - NOT a copy of the live Supabase project's actual rows (we
   deliberately never touch that project, see CLAUDE.md Phase 7.2 report on
   the chosen QA-mode strategy). Numeric growth/reward constants match the
   defaults api/claim-idle-offline-progress.js itself falls back to, so the
   mocked config and the real handler's own fallback assumptions agree. */

const IDLE_DRAGONS = [
  { id: 1, active: true, spawn_rule: 'standard', tier_order: 1, name: 'Schwacher Feuerdrache',
    base_hp: 50, base_attack: 5, base_defense: 1,
    gold_reward_base: 10, xp_reward_base: 8, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 0, essence_reward_base: 0 },
  { id: 2, active: true, spawn_rule: 'standard', tier_order: 2, name: 'Wasserdrache',
    base_hp: 55, base_attack: 6, base_defense: 1,
    gold_reward_base: 11, xp_reward_base: 9, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 0, essence_reward_base: 0 },
  { id: 3, active: true, spawn_rule: 'standard', tier_order: 3, name: 'Winddrache',
    base_hp: 60, base_attack: 7, base_defense: 2,
    gold_reward_base: 12, xp_reward_base: 10, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 0, essence_reward_base: 0 },
  { id: 10, active: true, spawn_rule: 'miniboss_10', tier_order: 10, name: 'Steinwaechter (Miniboss)',
    base_hp: 90, base_attack: 9, base_defense: 3,
    gold_reward_base: 20, xp_reward_base: 18, wood_reward_base: 4, stone_reward_base: 3, crystal_reward_base: 0, essence_reward_base: 0 },
  { id: 25, active: true, spawn_rule: 'boss_25', tier_order: 25, name: 'Yaksha der Drachenboss',
    base_hp: 150, base_attack: 14, base_defense: 4,
    gold_reward_base: 40, xp_reward_base: 35, wood_reward_base: 6, stone_reward_base: 5, crystal_reward_base: 1, essence_reward_base: 1 },
  { id: 90, active: true, spawn_rule: 'rare', tier_order: 90, name: 'Schattendrache',
    base_hp: 50, base_attack: 5, base_defense: 1,
    gold_reward_base: 15, xp_reward_base: 12, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 3, essence_reward_base: 3 },
  { id: 91, active: true, spawn_rule: 'rare', tier_order: 91, name: 'Wuffdrache',
    base_hp: 50, base_attack: 5, base_defense: 1,
    gold_reward_base: 15, xp_reward_base: 12, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 3, essence_reward_base: 3 }
];

const IDLE_GAME_CONFIG = [
  { key: 'offline_progress', value: { maxHours: 12, efficiencyPct: 50 } },
  { key: 'dragon_scaling', value: { hpGrowthPerKill: 0.05, hpGrowthExponent: 1.15, atkGrowthPerKill: 0.045, atkGrowthExponent: 1.1 } },
  { key: 'reward_scaling', value: { goldGrowthPerKill: 0.05, goldGrowthExponent: 1.2, xpGrowthPerKill: 0.05, xpGrowthExponent: 1.2 } },
  { key: 'boss_scaling', value: { minibossHpMult: 1.8, minibossAtkMult: 1.3, minibossRewardMult: 2, bossHpMult: 3.2, bossAtkMult: 1.7, bossRewardMult: 4 } },
  { key: 'rare_spawn', value: { chancePct: 8 } }
];

/* Village-Skin-Katalog (idle_village_skins) - Phase 6 (25.07.2026), reale
   Zeilen 1:1 aus den jeweiligen sql/supabase-idle-village-skins-*.sql-Dateien
   uebernommen (id/unlock_type/Preise/Schwellenwerte-Hinweistexte), NICHT
   erfunden - deckt jeden real existierenden unlock_type ab (free/purchase/
   achievement/boss_drop/real_money/code). Nur eine repraesentative Auswahl
   der ueber 16 echten Skins, nicht der komplette Katalog. */
const IDLE_VILLAGE_SKINS = [
  { id: 'standard', name: 'Standarddorf', description: 'Das gute alte Dorf, wie es schon immer aussah.', icon: '🏘️', image_file: 'assets/dragons/dorf.png', video_file: 'assets/village/startdorf.mp4', unlock_type: 'free', price_gold: 0, price_crystals: 0, price_eur_cents: 0, unlock_hint: '', sort_order: 0, frame_count: 1, frame_aspect_w: 2124, frame_aspect_h: 976, active: true },
  { id: 'eisdorf', name: 'Eis Dorf', description: 'Ein vereistes Dorf inmitten glitzernder Schnee- und Eislandschaften.', icon: '❄️', image_file: '', video_file: 'assets/village/eisdorf.mp4', unlock_type: 'purchase', price_gold: 150000, price_crystals: 0, price_eur_cents: 0, unlock_hint: '', sort_order: 10, frame_count: 1, frame_aspect_w: 2458, frame_aspect_h: 844, active: true },
  { id: 'pilzdorf', name: 'Pilzdorf', description: 'Ein leuchtendes Pilzdorf unter violettem Himmel - mit sanft schimmernden Ambiente-Details.', icon: '🍄', image_file: 'assets/village/pilzdorf.png', video_file: 'assets/village/pilzdorf.mp4', unlock_type: 'purchase', price_gold: 2500000, price_crystals: 0, price_eur_cents: 0, unlock_hint: '', sort_order: 1, frame_count: 3, frame_aspect_w: 2208, frame_aspect_h: 940, active: true },
  { id: 'zerstoertesdorf', name: 'Zerstörtes Dorf', description: 'Die rauchenden Ruinen unzaehliger verlorener Schlachten gegen die Drachen.', icon: '🏚️', image_file: '', video_file: 'assets/village/zerstoertesdorf.mp4', unlock_type: 'achievement', price_gold: 0, price_crystals: 0, price_eur_cents: 0, unlock_hint: '15.000x gegen Drachen verloren.', sort_order: 6, frame_count: 1, frame_aspect_w: 2618, frame_aspect_h: 792, active: true },
  { id: 'yakshasheimat', name: 'Yakshas Heimat', description: 'Das Reich des Drachenboss Yaksha.', icon: '👑', image_file: '', video_file: 'assets/village/yakshasheimat.mp4', unlock_type: 'boss_drop', price_gold: 0, price_crystals: 0, price_eur_cents: 0, unlock_hint: '50.000x den Boss Yaksha besiegen.', sort_order: 8, frame_count: 1, frame_aspect_w: 2344, frame_aspect_h: 886, active: true },
  { id: 'steampunkdorf', name: 'Steampunk Dorf', description: 'Ein Dorf voller Zahnraeder, Dampfmaschinen und messingglaenzender Technik.', icon: '⚙️', image_file: '', video_file: 'assets/village/steampunkdorf.mp4', unlock_type: 'real_money', price_gold: 0, price_crystals: 0, price_eur_cents: 199, unlock_hint: '', sort_order: 12, frame_count: 1, frame_aspect_w: 16, frame_aspect_h: 9, active: true },
  { id: 'kallejuniordorf', name: 'KalleJunior Dorf', description: 'Ein Dorf ganz im Zeichen von KalleJunior.', icon: '🏡', image_file: '', video_file: 'assets/village/kallejuniordorf.mp4', unlock_type: 'code', price_gold: 0, price_crystals: 0, price_eur_cents: 0, unlock_hint: 'Nur per Einlöse-Code erhältlich.', sort_order: 16, frame_count: 1, frame_aspect_w: 1912, frame_aspect_h: 1084, active: true }
];

const IDLE_SKILL_NODES = [
  { id: 'elem_fire', active: true, branch: 'magie', sort_order: 1, effect_type: 'elem_fire', effect_value_per_rank: 5, max_rank: 6 },
  { id: 'elem_lightning', active: true, branch: 'magie', sort_order: 2, effect_type: 'elem_lightning', effect_value_per_rank: 5, max_rank: 6 },
  { id: 'shield_regen', active: true, branch: 'magie', sort_order: 3, effect_type: 'shield_regen', effect_value_per_rank: 2, max_rank: 6 },
  { id: 'repair_speed_pct', active: true, branch: 'magie', sort_order: 4, effect_type: 'repair_speed_pct', effect_value_per_rank: 2, max_rank: 6 },
  { id: 'heal_pct', active: true, branch: 'magie', sort_order: 5, effect_type: 'heal_pct', effect_value_per_rank: 2, max_rank: 6 },
  { id: 'wirt_offline', active: true, branch: 'wirtschaft', sort_order: 1, effect_type: 'wirt_offline', effect_value_per_rank: 5, max_rank: 6 },
  { id: 'kampf_attack_pct', active: true, branch: 'kampf', sort_order: 1, effect_type: 'attack_pct', effect_value_per_rank: 3, max_rank: 10 },
  { id: 'kampf_defense_pct', active: true, branch: 'kampf', sort_order: 2, effect_type: 'defense_pct', effect_value_per_rank: 3, max_rank: 10 }
];

function cloneReferenceTables() {
  return {
    idle_dragons: IDLE_DRAGONS.map(d => ({ ...d })),
    idle_game_config: IDLE_GAME_CONFIG.map(c => ({ ...c })),
    idle_skill_nodes: IDLE_SKILL_NODES.map(n => ({ ...n })),
    idle_village_skins: IDLE_VILLAGE_SKINS.map(s => ({ ...s }))
  };
}

module.exports = { IDLE_DRAGONS, IDLE_GAME_CONFIG, IDLE_SKILL_NODES, IDLE_VILLAGE_SKINS, cloneReferenceTables };
