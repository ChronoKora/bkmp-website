/* Shared read-only "game content" reference tables (idle_dragons,
   idle_game_config, idle_skill_nodes) reused by every Teststand. These are
   a reasonable, internally-consistent approximation of the real production
   content - NOT a copy of the live Supabase project's actual rows (we
   deliberately never touch that project, see CLAUDE.md Phase 7.2 report on
   the chosen QA-mode strategy). Numeric growth/reward constants match the
   defaults api/claim-idle-offline-progress.js itself falls back to, so the
   mocked config and the real handler's own fallback assumptions agree. */

/* NACHTRAG (06.08.2026, Spieler-Screenshot waehrend einer Live-QA-Sitzung:
   "Warum sehe ich keine Drachen-Animation?"): dieser Fixture-Datei fehlte
   von Anfang an die "sprite_key"-Spalte, die die echte Produktions-
   Tabelle "idle_dragons" tatsaechlich hat (siehe z.B. sql/supabase-
   dragon-species-cyberdrache.sql). bkmpIdleApplyDragonSprite() (js/ui/
   bkmp-hud.js) baut daraus entweder eine Video-Quelle (BKMP_IDLE_VIDEO_
   DRAGON_SPRITES) oder eine ".idle-sprite-<key>"-CSS-Klasse (style.css) -
   beide sind nach NAMEN (z.B. "winddrache") indiziert, nicht nach der
   numerischen "id". Ohne "sprite_key" faellt der Code auf "archetype.id"
   zurueck (js/core/bkmp-combat-math.js: "archetype.sprite_key ||
   archetype.id") - eine Zahl wie "3" trifft dann weder eine Video- noch
   eine CSS-Klasse, der Drachen-Container bleibt bei fehlendem Bild ohne
   aspect-ratio komplett unsichtbar (0px hoch). REINER Mock-Fidelity-Fund
   (kein App-Bug, kein Produktions-Bug): die echte Supabase-Tabelle hat
   "sprite_key" fuer jeden Drachen befuellt, betrifft also nur diese
   lokale QA-Testumgebung. "Steinwaechter (Miniboss)" ist ein rein
   erfundener Testdrache ohne echtes Produktions-Gegenstueck (kein
   "steinwaechter"-Asset existiert in assets/dragons/) - bekommt hier
   bewusst "erddrache" als thematisch passenden, real existierenden
   Platzhalter, rein damit die QA-Sitzung auch fuer diesen einen
   Mini-boss ein sichtbares Sprite zeigt. */
const IDLE_DRAGONS = [
  { id: 1, active: true, spawn_rule: 'standard', tier_order: 1, name: 'Schwacher Feuerdrache', sprite_key: 'feuerdrache',
    base_hp: 50, base_attack: 5, base_defense: 1,
    gold_reward_base: 10, xp_reward_base: 8, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 0, essence_reward_base: 0 },
  { id: 2, active: true, spawn_rule: 'standard', tier_order: 2, name: 'Wasserdrache', sprite_key: 'wasserdrache',
    base_hp: 55, base_attack: 6, base_defense: 1,
    gold_reward_base: 11, xp_reward_base: 9, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 0, essence_reward_base: 0 },
  { id: 3, active: true, spawn_rule: 'standard', tier_order: 3, name: 'Winddrache', sprite_key: 'winddrache',
    base_hp: 60, base_attack: 7, base_defense: 2,
    gold_reward_base: 12, xp_reward_base: 10, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 0, essence_reward_base: 0 },
  { id: 10, active: true, spawn_rule: 'miniboss_10', tier_order: 10, name: 'Steinwaechter (Miniboss)', sprite_key: 'erddrache',
    base_hp: 90, base_attack: 9, base_defense: 3,
    gold_reward_base: 20, xp_reward_base: 18, wood_reward_base: 4, stone_reward_base: 3, crystal_reward_base: 0, essence_reward_base: 0 },
  { id: 25, active: true, spawn_rule: 'boss_25', tier_order: 25, name: 'Yaksha der Drachenboss', sprite_key: 'yaksha-boss',
    base_hp: 150, base_attack: 14, base_defense: 4,
    gold_reward_base: 40, xp_reward_base: 35, wood_reward_base: 6, stone_reward_base: 5, crystal_reward_base: 1, essence_reward_base: 1 },
  { id: 90, active: true, spawn_rule: 'rare', tier_order: 90, name: 'Schattendrache', sprite_key: 'schattendrache',
    base_hp: 50, base_attack: 5, base_defense: 1,
    gold_reward_base: 15, xp_reward_base: 12, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 3, essence_reward_base: 3 },
  { id: 91, active: true, spawn_rule: 'rare', tier_order: 91, name: 'Wuffdrache', sprite_key: 'wuffdrache',
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

/* NACHTRAG (06.08.2026, Spieler-Screenshot: "Bei Skills werden mir nur 2
   angezeigt"): dieses Array war urspruenglich NUR fuer den Offline-
   Fortschritts-Simulations-Test gedacht (siehe "Bug 6" in CLAUDE.md -
   elem_fire/elem_lightning/shield_regen/repair_speed_pct/heal_pct/
   wirt_offline sind exakt die Effekte, die api/claim-idle-offline-
   progress.js dort beruecksichtigen muss) und hatte deshalb weder
   "name"/"description"/"icon"/"cost_per_rank"/"requires_node_id" (die
   echte Produktions-Tabelle "idle_skill_nodes" hat all das, siehe sql/
   supabase-idle-dorf-schema.sql) noch Eintraege fuer die drei anderen
   echten Basis-Zweige "dorf"/"burg"/"forschung" (BKMP_IDLE_BRANCH_LABELS,
   js/systems/bkmp-skilltree.js) - deren Kacheln blieben dadurch in der
   Skilltree-UI komplett unsichtbar, nur "Wirtschaft"+"Magie" (die einzigen
   zwei mit vorhandenen Knoten) erschienen. Der bereits genutzte "kampf"-
   Zweig ist gar kein echter Zweig (fehlt bewusst in BKMP_IDLE_BRANCH_
   LABELS) - blieb deshalb ebenfalls unsichtbar, obwohl seine 2 Knoten
   weiterhin ganz normal in die Effektsumme einfliessen.
   Fix: die urspruenglichen 8 IDs/effect_types/branches/max_ranks bleiben
   UNVERAENDERT (Teststand B/C in teststands.js weisen "skill_allocations"
   exakt gegen diese IDs zu, z.B. "elem_fire:6" - ein Umbenennen haette die
   dort schon vorinvestierten Punkte verwaisen lassen) - nur die fehlenden
   Anzeige-Felder wurden ergaenzt. Dorf/Burg/Forschung sind als NEUE, echte
   Knoten ergaenzt (IDs/Namen/Icons/Effekte 1:1 aus der Original-Schema-
   Datei uebernommen, nicht erfunden) - macht die Skilltree-Ansicht fuer
   Tests wieder vollstaendig, ohne bestehende Allokationen zu beruehren. */
const IDLE_SKILL_NODES = [
  // Bestehend, nur Anzeige-Felder ergaenzt (IDs/effect_type/branch/max_rank unveraendert)
  { id: 'elem_fire', active: true, branch: 'magie', sort_order: 1, name: 'Feuer', description: 'Zusätzlicher Feuerschaden bei jedem Treffer.', icon: '🔥', cost_per_rank: 2, requires_node_id: null, requires_rank: 1, effect_type: 'elem_fire', effect_value_per_rank: 5, max_rank: 6 },
  { id: 'elem_lightning', active: true, branch: 'magie', sort_order: 2, name: 'Blitzschlag', description: 'Ruft gelegentlich einen Blitzschlag auf den Drachen.', icon: '⚡', cost_per_rank: 2, requires_node_id: null, requires_rank: 1, effect_type: 'elem_lightning', effect_value_per_rank: 5, max_rank: 6 },
  { id: 'shield_regen', active: true, branch: 'magie', sort_order: 3, name: 'Schildgenerator', description: 'Regeneriert kontinuierlich einen Teil der Lebenspunkte.', icon: '🔵', cost_per_rank: 2, requires_node_id: 'elem_fire', requires_rank: 2, effect_type: 'shield_regen', effect_value_per_rank: 2, max_rank: 6 },
  { id: 'repair_speed_pct', active: true, branch: 'magie', sort_order: 4, name: 'Reparaturtempo', description: 'Beschädigte Gebäude werden schneller repariert.', icon: '🔧', cost_per_rank: 2, requires_node_id: 'elem_lightning', requires_rank: 2, effect_type: 'repair_speed_pct', effect_value_per_rank: 2, max_rank: 6 },
  { id: 'heal_pct', active: true, branch: 'magie', sort_order: 5, name: 'Heilung', description: 'Heilt das Dorf regelmäßig ein wenig.', icon: '💚', cost_per_rank: 2, requires_node_id: 'shield_regen', requires_rank: 3, effect_type: 'heal_pct', effect_value_per_rank: 2, max_rank: 6 },
  { id: 'wirt_offline', active: true, branch: 'wirtschaft', sort_order: 1, name: 'Offline-Einnahmen', description: 'Erhöht die Effizienz deines Fortschritts während du weg bist.', icon: '🌙', cost_per_rank: 2, requires_node_id: null, requires_rank: 1, effect_type: 'wirt_offline', effect_value_per_rank: 5, max_rank: 6 },
  { id: 'kampf_attack_pct', active: true, branch: 'kampf', sort_order: 1, name: 'Angriffstraining', description: '(Interner Testknoten, kein echter Zweig - siehe Kommentar oben.)', icon: '⚔️', cost_per_rank: 1, requires_node_id: null, requires_rank: 1, effect_type: 'attack_pct', effect_value_per_rank: 3, max_rank: 10 },
  { id: 'kampf_defense_pct', active: true, branch: 'kampf', sort_order: 2, name: 'Verteidigungstraining', description: '(Interner Testknoten, kein echter Zweig - siehe Kommentar oben.)', icon: '🛡️', cost_per_rank: 1, requires_node_id: null, requires_rank: 1, effect_type: 'defense_pct', effect_value_per_rank: 3, max_rank: 10 },
  // Neu: die drei bisher fehlenden echten Basis-Zweige (Struktur/Namen 1:1 aus sql/supabase-idle-dorf-schema.sql)
  { id: 'dorf_pfeilschaden', active: true, branch: 'dorf', sort_order: 0, name: 'Pfeilschaden', description: 'Erhöht den Schaden deiner Bogenschützen.', icon: '🏹', cost_per_rank: 1, requires_node_id: null, requires_rank: 1, effect_type: 'attack_pct', effect_value_per_rank: 3, max_rank: 10 },
  { id: 'dorf_angriffstempo', active: true, branch: 'dorf', sort_order: 1, name: 'Angriffsgeschwindigkeit', description: 'Deine Bogenschützen greifen schneller an.', icon: '⏱️', cost_per_rank: 1, requires_node_id: 'dorf_pfeilschaden', requires_rank: 3, effect_type: 'attack_speed_pct', effect_value_per_rank: 4, max_rank: 5 },
  { id: 'dorf_krit', active: true, branch: 'dorf', sort_order: 2, name: 'Kritische Treffer', description: 'Erhöht deine Chance auf kritische Treffer.', icon: '🎯', cost_per_rank: 1, requires_node_id: null, requires_rank: 1, effect_type: 'crit_chance_pct', effect_value_per_rank: 1.5, max_rank: 8 },
  { id: 'dorf_brandpfeile', active: true, branch: 'dorf', sort_order: 3, name: 'Brandpfeile', description: 'Deine Pfeile fügen zusätzlichen Schaden über Zeit zu.', icon: '🔥', cost_per_rank: 2, requires_node_id: 'dorf_krit', requires_rank: 4, effect_type: 'crit_damage_pct', effect_value_per_rank: 6, max_rank: 5 },
  { id: 'dorf_bogenschuetzen', active: true, branch: 'dorf', sort_order: 4, name: 'Mehr Bogenschützen', description: 'Rekrutiere zusätzliche Bogenschützen fürs Dorf.', icon: '🧑‍🤝‍🧑', cost_per_rank: 2, requires_node_id: 'dorf_angriffstempo', requires_rank: 3, effect_type: 'extra_archer', effect_value_per_rank: 1, max_rank: 6 },
  { id: 'dorf_ballisten', active: true, branch: 'dorf', sort_order: 5, name: 'Ballisten', description: 'Baue Ballisten für massiven Flächenschaden.', icon: '🎡', cost_per_rank: 3, requires_node_id: 'dorf_bogenschuetzen', requires_rank: 4, effect_type: 'ballista_unlock', effect_value_per_rank: 1, max_rank: 3 },
  { id: 'burg_leben', active: true, branch: 'burg', sort_order: 0, name: 'Mehr Leben', description: 'Erhöht die maximale Lebenspunkte des Dorfes.', icon: '❤️', cost_per_rank: 1, requires_node_id: null, requires_rank: 1, effect_type: 'hp_pct', effect_value_per_rank: 5, max_rank: 10 },
  { id: 'burg_verteidigung', active: true, branch: 'burg', sort_order: 1, name: 'Verteidigung', description: 'Erhöht die Verteidigung des Dorfes.', icon: '🛡️', cost_per_rank: 1, requires_node_id: null, requires_rank: 1, effect_type: 'defense_pct', effect_value_per_rank: 4, max_rank: 10 },
  { id: 'burg_schild', active: true, branch: 'burg', sort_order: 2, name: 'Schildgenerator', description: 'Regeneriert kontinuierlich einen Teil der Lebenspunkte.', icon: '🔵', cost_per_rank: 2, requires_node_id: 'burg_verteidigung', requires_rank: 4, effect_type: 'shield_regen', effect_value_per_rank: 1.5, max_rank: 5 },
  { id: 'burg_reparatur', active: true, branch: 'burg', sort_order: 3, name: 'Reparaturtempo', description: 'Beschädigte Gebäude werden schneller repariert.', icon: '🔧', cost_per_rank: 2, requires_node_id: 'burg_leben', requires_rank: 4, effect_type: 'repair_speed_pct', effect_value_per_rank: 5, max_rank: 5 },
  { id: 'burg_mauern', active: true, branch: 'burg', sort_order: 4, name: 'Verstärkte Mauern', description: 'Weitere Erhöhung der maximalen Lebenspunkte.', icon: '🧱', cost_per_rank: 2, requires_node_id: 'burg_schild', requires_rank: 3, effect_type: 'hp_pct', effect_value_per_rank: 4, max_rank: 6 },
  { id: 'burg_wachen', active: true, branch: 'burg', sort_order: 5, name: 'Torwachen', description: 'Zusätzliche Verteidigung durch aufmerksame Wachen.', icon: '💂', cost_per_rank: 2, requires_node_id: 'burg_reparatur', requires_rank: 3, effect_type: 'defense_pct', effect_value_per_rank: 4, max_rank: 6 },
  { id: 'forsch_xp', active: true, branch: 'forschung', sort_order: 0, name: 'Mehr XP', description: 'Erhöht die XP, die du pro Drache erhältst.', icon: '📘', cost_per_rank: 1, requires_node_id: null, requires_rank: 1, effect_type: 'xp_pct', effect_value_per_rank: 4, max_rank: 10 },
  { id: 'forsch_gold', active: true, branch: 'forschung', sort_order: 1, name: 'Mehr Gold', description: 'Weitere Steigerung der Gold-Belohnung.', icon: '📗', cost_per_rank: 1, requires_node_id: null, requires_rank: 1, effect_type: 'gold_find_pct', effect_value_per_rank: 3, max_rank: 8 },
  { id: 'forsch_loot', active: true, branch: 'forschung', sort_order: 2, name: 'Bessere Lootchance', description: 'Erhöht die Chance auf seltene Beute.', icon: '🎁', cost_per_rank: 2, requires_node_id: 'forsch_xp', requires_rank: 4, effect_type: 'loot_chance_pct', effect_value_per_rank: 3, max_rank: 8 },
  { id: 'forsch_drachenkunde', active: true, branch: 'forschung', sort_order: 3, name: 'Drachenkunde', description: 'Du verstehst Drachen besser und triffst gezielter.', icon: '📖', cost_per_rank: 2, requires_node_id: 'forsch_gold', requires_rank: 3, effect_type: 'attack_pct', effect_value_per_rank: 2.5, max_rank: 6 },
  { id: 'forsch_alchemie', active: true, branch: 'forschung', sort_order: 4, name: 'Alchemie', description: 'Wandelt Wissen in weitere Lootchance um.', icon: '⚗️', cost_per_rank: 2, requires_node_id: 'forsch_loot', requires_rank: 3, effect_type: 'loot_chance_pct', effect_value_per_rank: 2.5, max_rank: 6 },
  { id: 'forsch_kartografie', active: true, branch: 'forschung', sort_order: 5, name: 'Kartografie', description: 'Findet effizientere Wege zu neuen Drachen.', icon: '🗺️', cost_per_rank: 3, requires_node_id: 'forsch_drachenkunde', requires_rank: 3, effect_type: 'xp_pct', effect_value_per_rank: 3, max_rank: 5 }
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
