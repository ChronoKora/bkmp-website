
/* Echtgeld-Kaeufe (Steampunk Dorf etc.) auf "gesperrt" halten, bis die
   Stripe-Live-Konfiguration wirklich fertig ist (STRIPE_SECRET_KEY +
   STRIPE_WEBHOOK_SECRET in Vercel, Live-Webhook eingerichtet) - bis dahin
   wuerde ein Klick entweder in einen Server-Fehler laufen oder (schlimmer)
   Geld nehmen ohne dass der Webhook zuverlaessig freischaltet. Auf true
   stellen, sobald ein echter Test-Kauf im Sandbox- UND Live-Modus
   durchgelaufen ist. */
const BKMP_REAL_MONEY_PURCHASES_ENABLED = false;

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
  { id: 'winddrache', name: 'Winddrache', emoji: '🌪️', sprite_key: 'winddrache', spawn_rule: 'standard', color_theme: '#7dd3fc', tier_order: 10, base_hp: 68, base_attack: 7, base_defense: 2, gold_reward_base: 6, xp_reward_base: 6, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 0, essence_reward_base: 0, is_boss: false, active: true },
  /* Neue Art (Spieler-Wunsch 18.07.): "soll wie die anderen Drachen normal
     auftauchen" - spawn_rule 'standard' reiht sie einfach in denselben
     Zufallspool wie Feuer-/Blitz-/Erd-/Wasser-/Winddrache ein (siehe
     bkmpIdleSelectDragonKindId - tier_order beeinflusst dort NICHTS, nur
     die Sortierung in Admin/Uebersichten). Werte an den Mittelwert der
     bestehenden Standarddrachen angelehnt, keine neue Balance-Idee.
     Echte Datenquelle ist die idle_dragons-Tabelle in Supabase, dieser
     Eintrag hier ist nur der Offline-/Fallback-Stand - siehe
     supabase-dragon-species-cyberdrache.sql fuer die echte Migration. */
  { id: 'cyberdrache', name: 'Cyberdrache', emoji: '🔷', sprite_key: 'cyberdrache', spawn_rule: 'standard', color_theme: '#22d3ee', tier_order: 11, base_hp: 62, base_attack: 7, base_defense: 2, gold_reward_base: 6, xp_reward_base: 6, wood_reward_base: 2, stone_reward_base: 1, crystal_reward_base: 0, essence_reward_base: 0, is_boss: false, active: true }
];

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
    turm_highest_wave: 0, turm_last_attempt_at: null,
    dragon_species_discovered_at: {}
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
  /* Bug-Fix 18.07.: heilt ungueltige Altzustaende (z.B. 2x Wuchtrune
     gleichzeitig ausgeruestet) automatisch bei jedem Laden, siehe
     ausfuehrlichen Kommentar bei bkmpRuneNormalizeDuplicateEquips(). */
  if (typeof bkmpRuneNormalizeDuplicateEquips === 'function') bkmpRuneNormalizeDuplicateEquips();
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

function bkmpIdleAddXp(amount) {
  bkmpIdleState.xp += amount;
  const xpCfg = bkmpIdleConfig.xp_curve || BKMP_IDLE_FALLBACK_CONFIG.xp_curve;
  let leveled = false;
  let levelsGained = 0;
  let milestone = null;
  while (bkmpIdleState.xp >= bkmpIdleXpForLevel(bkmpIdleState.level, xpCfg)) {
    bkmpIdleState.xp -= bkmpIdleXpForLevel(bkmpIdleState.level, xpCfg);
    bkmpIdleState.level += 1;
    bkmpIdleState.skill_points_available += 1;
    leveled = true;
    levelsGained += 1;
    if (bkmpIdleState.level % 10 === 0) {
      const bonusGold = Math.round(200 * (bkmpIdleState.level / 10));
      bkmpIdleState.gold += bonusGold;
      bkmpIdleState.total_gold_earned += bonusGold;
      bkmpIdleState.crystals += 2;
      bkmpIdleLog(`🎉 Level ${bkmpIdleState.level} erreicht! Bonus: +${bonusGold} 💰 +2 💎`);
      milestone = { level: bkmpIdleState.level, bonusGold };
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
    /* Phase 5.5 (19.07.): vorher gab es fuer den haeufigen Normalfall
       (kein 10er-Meilenstein) ueberhaupt keine sichtbare Rueckmeldung
       ausser dem sich fuellenden XP-Balken - jetzt ein kompakter Reward-
       Toast fuer JEDEN Aufstieg. Mehrere Level-Aufstiege durch EINEN
       einzigen Xp-Zuwachs (z.B. ein grosser Offline-Nachtrag) werden
       bewusst zu EINER Meldung zusammengefasst statt levelsGained
       einzelner Toasts (Auftrag: "mehrere schnelle Level-Ups: kompakt").
       Kein neuer Zufallswert/keine neue Berechnung - level/skill_points_
       available/gold/crystals sind zu diesem Zeitpunkt bereits fertig
       zugewiesen, hier wird nur noch angezeigt. */
    if (typeof bkmpRewardPresent === 'function') {
      if (milestone) {
        bkmpRewardPresent({
          tier: 'card', rarity: 'rare', icon: '🎉',
          title: `Level ${milestone.level} erreicht!`,
          description: `${levelsGained > 1 ? `+${levelsGained} Stufen auf einmal · ` : ''}Meilenstein-Bonus: +${bkmpIdleFormatNumber(milestone.bonusGold)} Gold, +2 Kristalle`,
          dedupeKey: `levelup-milestone-${milestone.level}`
        });
      } else {
        bkmpRewardPresent({
          tier: 'toast', rarity: 'common',
          title: levelsGained > 1
            ? `Level ${bkmpIdleState.level} erreicht (+${levelsGained} Skillpunkte)`
            : `Level ${bkmpIdleState.level} erreicht (+1 Skillpunkt)`,
          dedupeKey: `levelup-${bkmpIdleState.level}`
        });
      }
    }
  }
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
  const prevHighestIndex = Number(bkmpIdleState.highest_dragon_index || 0);
  if (autoAdvance) bkmpIdleState.current_dragon_index += 1;
  bkmpIdleState.highest_dragon_index = Math.max(prevHighestIndex, bkmpIdleState.current_dragon_index);
  /* Phase 5.5 (19.07.), Abschnitt 12 "Aktfreischaltung": nur wenn dieser Kill
     TATSAECHLICH neues Terrain erreicht (highest_dragon_index steigt) UND
     dabei die Akt-Grenze (alle 10 Stufen, siehe bkmpIdleFormatStage/
     Stufenwahl-Popup) ueberschreitet - beim Zurueckspringen/erneuten
     Durchspielen alter Stufen (Stufenwahl-Popup) NICHT erneut. Bewusst Karte
     statt Zeremonie (analog "neuer Turm-Stock", nicht "Drache schluepft") -
     bei schnellem Auto-Kampf koennten sonst alle paar Kills Vollbild-
     Zeremonien aufploppen, was Abschnitt 20 ("kein Overheating/Dauer-
     Unterbrechung") widerspraeche. */
  if (autoAdvance && typeof bkmpRewardPresent === 'function' && bkmpIdleState.current_dragon_index > prevHighestIndex) {
    const newAct = Math.floor(bkmpIdleState.current_dragon_index / 10);
    const prevAct = Math.floor(prevHighestIndex / 10);
    if (newAct > prevAct) {
      bkmpRewardPresent({
        tier: 'card',
        rarity: 'selten',
        icon: '🗺️',
        title: `Akt ${newAct + 1} erreicht!`,
        description: 'Neues Gebiet, stärkere Drachen - deine Reise geht weiter.',
        source: 'Kampf',
        dedupeKey: `act-${newAct}`
      });
    }
  }
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

/* Performance (Nutzer-Report 17.07.: "ruckelt alles sehr stark waehrend
   des Kampfes"): bkmpIdleTick() darf laut Spieler-Wunsch (siehe
   bkmpIdleCloseModal-Kommentar weiter unten) auch bei geschlossenem
   Fenster weiterlaufen (Gold/XP/Kills sammeln sich passiv weiter) - das
   bleibt unveraendert. Was NICHT weiterlaufen muss, sind die rein
   VISUELLEN Nebeneffekte pro Tick (Projektil-/Schadenszahl-/Trefferblitz-
   Spans erzeugen+entfernen, erzwungene Reflows via offsetWidth, HP-Balken-
   DOM-Updates) - die haben null Spielwert, wenn ohnehin niemand hinschaut
   (Fenster zu, Browser-Tab im Hintergrund, oder ein anderer Idle-Dorf-Tab
   als "Kampf" gerade aktiv). bkmpIdleCombatVisualsActive() buendelt genau
   diese drei Faelle - reine Sichtbarkeits-Abfrage, aendert nie Spielwerte. */
function bkmpIdleCombatVisualsActive() {
  return bkmpIdleModalOpen === true && bkmpIdleActiveTab === 'kampf' && document.visibilityState === 'visible';
}

function bkmpIdleTick() {
  if (!bkmpIdleState || !bkmpIdleCurrentDragon || !bkmpIdleEffectiveStats) return;
  const stats = bkmpIdleEffectiveStats;
  const showVisuals = bkmpIdleCombatVisualsActive();
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
  if (showVisuals) {
    bkmpIdleSpawnProjectile('arrow', vRoll.amount, vRoll.isCrit);
    bkmpIdleSpawnHitFlash('idleDragon');
    bkmpIdleUpdateDragonHpBar();
  }

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
    if (showVisuals) {
      bkmpIdleSpawnBurnTick(burnDmg);
      bkmpIdleUpdateDragonHpBar();
    }
  }

  /* Blitzschlag (magie_blitz): seltener Bonus-Schlag oben drauf. */
  if (bkmpIdleCurrentDragon.hp > 0 && stats.lightningChancePct > 0 && Math.random() * 100 < stats.lightningChancePct) {
    const boltDmg = Math.max(1, Math.round(stats.attack * 0.6));
    bkmpIdleCurrentDragon.hp = Math.max(0, bkmpIdleCurrentDragon.hp - boltDmg);
    if (showVisuals) {
      bkmpIdleSpawnLightningBolt(boltDmg);
      bkmpIdleUpdateDragonHpBar();
    }
  }

  if (bkmpIdleCurrentDragon.hp <= 0) {
    bkmpIdleHandleDragonDefeated();
    return;
  }

  bkmpIdleDragonCounterAttack(stats, showVisuals);
  bkmpIdleBroadcastCombatState();
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
  /* Section C, Punkt 1 (Spieler-Wunsch 18.07.: naechste Boss-Stufe statt
     "wie viele Kills noch"): 👑-Boss-Stufen sind fest alle 25 Kaempfe (siehe
     bkmpIdleSelectDragonKindId: stage = current_dragon_index+1, stage%25===0
     - identische Regel hier dupliziert, keine neue Konstante erfunden).
     Bewusst NICHT fuer Liber/Shenloss (spawn_rule 'event_easter') - die
     spawnen zufaellig (siehe Bug-Fix bkmpIdleSpawnDragon) und duerfen dem
     Spieler nicht als garantierte kommende Stufe angezeigt werden. */
  const nextBossStageIdx = Math.ceil((current + 1) / 25) * 25 - 1;
  el.innerHTML = `
    <span class="idle-stage-label">Stufe <strong>${bkmpIdleFormatStage(current)}</strong> · Insgesamt erreichte Stufen: <strong>${bkmpIdleFormatNumber(bkmpIdleLifetimeStageCount())}</strong> · 👑 Nächster Boss: <strong>Stufe ${bkmpIdleFormatStage(nextBossStageIdx)}</strong></span>
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
  /* PROTOTYP 2 (18.07., entfernbar): spiegelt dieselben, oben schon
     berechneten Werte zusaetzlich in die kompakte Stufenleiste - kein
     neuer Wert, reiner No-op wenn der Prototyp inaktiv ist. */
  if (typeof bkmpProtoChudRenderStageBar === 'function') bkmpProtoChudRenderStageBar();
}

/* ---------------- Stufenwahl-Popup ----------------
   Redesign 18.07. (Spieler-Wunsch: "hübscheres Fenster, an die Zukunft
   denken - was, wenn Akt 1000?"): die alte Version rendert JEDEN Akt
   dauerhaft voll aufgeklappt mit allen 10 Stufen-Buttons - bei Akt 1000
   waeren das 10.000 Buttons gleichzeitig im DOM, unabhaengig vom
   Aussehen nicht mehr performant und ein praktisch endloses Scroll-
   Fenster. Neues Modell, zwei sich ergaenzende Bausteine:
   1) Sprungleiste (siehe bkmpIdleParseStagePickerInput/
      bkmpIdleStagePickerHandleJump) - direkter Sprung zu jeder beliebigen
      bereits erreichten Stufe per Eingabe ("Akt-Stufe", z.B. "12-3"),
      voellig unabhaengig von der Gesamtzahl der Akte.
   2) Akte werden nur noch als schlanke Kopfzeile gerendert - das
      10er-Stufen-Grid eines Akts wird erst BEIM AUFKLAPPEN einmalig
      gebaut und danach im DOM belassen (kein erneutes Bauen bei
      wiederholtem Auf-/Zuklappen). Nur der Akt der aktuellen Stufe ist
      beim Oeffnen automatisch aufgeklappt.
   Zusaetzlich zeigt die Kopfzeilen-Liste selbst standardmaessig nur die
   letzten BKMP_STAGEPICKER_RECENT_ACTS Akte (die relevanten/juengsten) -
   ein Knopf blendet bei Bedarf alle frueheren Akte zusaetzlich ein.
   Verhindert, dass allein schon die Kopfzeilen-Liste bei sehr hohen
   Akt-Zahlen unbegrenzt waechst. */
const BKMP_STAGEPICKER_RECENT_ACTS = 20;
let bkmpStagePickerShowAllActs = false;
let bkmpStagePickerOpenActs = new Set();

function bkmpIdleStagePickerBuildGridHtml(act, highestAct, highest) {
  const maxLocalStage = act === highestAct ? (highest % 10) : 9;
  const current = Number(bkmpIdleState.current_dragon_index || 0);
  let html = '';
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
  return html;
}

function bkmpIdleStagePickerActHeaderHtml(act, highestAct, current, highest) {
  const locked = act > highestAct;
  const isCurrentAct = Math.floor(current / 10) === act;
  const isBestAct = Math.floor(highest / 10) === act;
  const open = bkmpStagePickerOpenActs.has(act);
  const badges = [
    isCurrentAct ? '<span class="idle-stagepicker-act-badge is-current">Hier</span>' : '',
    isBestAct ? '<span class="idle-stagepicker-act-badge is-best">⭐ Beste</span>' : ''
  ].filter(Boolean).join('');
  return `
    <div class="idle-stagepicker-act${locked ? ' is-locked' : ''}${open ? ' is-open' : ''}" data-act="${act}">
      <button type="button" class="idle-stagepicker-act-header" data-act-toggle="${act}" ${locked ? 'disabled' : ''} aria-expanded="${open ? 'true' : 'false'}">
        <span class="idle-stagepicker-act-chevron">${locked ? '🔒' : '▸'}</span>
        <span class="idle-stagepicker-act-title">Akt ${act + 1}</span>
        ${badges}
      </button>
      <div class="idle-stagepicker-grid" data-act-grid="${act}" style="display:${open ? '' : 'none'}"></div>
    </div>`;
}

function bkmpIdleRenderStagePickerBody() {
  const body = document.getElementById('idleStagePickerBody');
  if (!body || !bkmpIdleState) return;
  const current = Number(bkmpIdleState.current_dragon_index || 0);
  const highest = Number(bkmpIdleState.highest_dragon_index || 0);
  const highestAct = Math.floor(highest / 10);
  const currentAct = Math.floor(current / 10);
  bkmpStagePickerOpenActs = new Set([currentAct]);

  const totalKnownActs = highestAct + 1;
  const firstShownAct = bkmpStagePickerShowAllActs ? 0 : Math.max(0, totalKnownActs - BKMP_STAGEPICKER_RECENT_ACTS);
  let html = '';
  if (firstShownAct > 0) {
    html += `<button type="button" class="idle-stagepicker-showolder-btn" id="idleStagePickerShowOlderBtn">⏶ ${firstShownAct} frühere ${firstShownAct === 1 ? 'Akt' : 'Akte'} anzeigen</button>`;
  }
  for (let act = firstShownAct; act <= highestAct + 1; act++) {
    html += bkmpIdleStagePickerActHeaderHtml(act, highestAct, current, highest);
  }
  body.innerHTML = html;
  const openGrid = body.querySelector(`[data-act-grid="${currentAct}"]`);
  if (openGrid) openGrid.innerHTML = bkmpIdleStagePickerBuildGridHtml(currentAct, highestAct, highest);
}

/* Akzeptiert das Anzeigeformat "Akt-Stufe" (z.B. "12-3", auch mit , oder
   . statt -), sowie eine blanke Zahl als Akt-Kurzform (springt dann auf
   die erste Stufe dieses Akts). Gibt null bei unlesbarer Eingabe zurueck -
   die Bereichspruefung (schon erreicht?) passiert separat im Aufrufer,
   damit dort eine gezielte Fehlermeldung moeglich ist. */
function bkmpIdleParseStagePickerInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const pair = s.match(/^(\d+)\s*[-,.\s]\s*(\d+)$/);
  if (pair) {
    const act = Math.max(0, parseInt(pair[1], 10));
    const local = Math.max(0, Math.min(9, parseInt(pair[2], 10)));
    return act * 10 + local;
  }
  const single = s.match(/^(\d+)$/);
  if (single) return Math.max(0, parseInt(single[1], 10)) * 10;
  return null;
}

function bkmpIdleStagePickerHandleJump() {
  const input = document.getElementById('idleStagePickerJumpInput');
  const errorEl = document.getElementById('idleStagePickerJumpError');
  if (!input || !bkmpIdleState) return;
  const highest = Number(bkmpIdleState.highest_dragon_index || 0);
  const parsed = bkmpIdleParseStagePickerInput(input.value);
  if (parsed === null) {
    if (errorEl) { errorEl.textContent = 'Bitte im Format "Akt-Stufe" eingeben, z. B. 12-3.'; errorEl.style.display = ''; }
    return;
  }
  if (parsed > highest) {
    if (errorEl) { errorEl.textContent = `Diese Stufe hast du noch nicht erreicht (beste Stufe: ${bkmpIdleFormatStage(highest)}).`; errorEl.style.display = ''; }
    return;
  }
  if (errorEl) errorEl.style.display = 'none';
  input.value = '';
  bkmpIdleJumpToStage(parsed);
  bkmpIdleCloseStagePicker();
}

function bkmpIdleOpenStagePicker() {
  if (!bkmpIdleState) return;
  /* Kein Stufenwechsel waehrend das Vorbereitungs-Popup eines Event-
     Drachen auf Bestaetigung wartet - siehe bkmpIdleJumpToStage(). Das
     Popup selbst gar nicht erst oeffnen, statt es beim Klick auf eine
     Stufe einfach wirkungslos wieder zu schliessen (verwirrend). */
  if (bkmpIdleEventPauseActive) return;
  bkmpStagePickerShowAllActs = false;
  bkmpIdleRenderStagePickerBody();
  const errorEl = document.getElementById('idleStagePickerJumpError');
  if (errorEl) errorEl.style.display = 'none';
  const input = document.getElementById('idleStagePickerJumpInput');
  if (input) input.value = '';
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
      const stageBtn = e.target.closest('[data-stage-index]');
      if (stageBtn) {
        bkmpIdleJumpToStage(Number(stageBtn.dataset.stageIndex));
        bkmpIdleCloseStagePicker();
        return;
      }
      const toggleBtn = e.target.closest('[data-act-toggle]');
      if (toggleBtn) {
        const act = Number(toggleBtn.dataset.actToggle);
        const wrap = body.querySelector(`.idle-stagepicker-act[data-act="${act}"]`);
        const grid = body.querySelector(`[data-act-grid="${act}"]`);
        if (!wrap || !grid) return;
        const nowOpen = !bkmpStagePickerOpenActs.has(act);
        if (nowOpen) {
          bkmpStagePickerOpenActs.add(act);
          if (!grid.innerHTML) {
            const highest = Number(bkmpIdleState.highest_dragon_index || 0);
            const highestAct = Math.floor(highest / 10);
            grid.innerHTML = bkmpIdleStagePickerBuildGridHtml(act, highestAct, highest);
          }
          grid.style.display = '';
        } else {
          bkmpStagePickerOpenActs.delete(act);
          grid.style.display = 'none';
        }
        wrap.classList.toggle('is-open', nowOpen);
        toggleBtn.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
        toggleBtn.querySelector('.idle-stagepicker-act-chevron').textContent = nowOpen ? '▾' : '▸';
        return;
      }
      const showOlderBtn = e.target.closest('#idleStagePickerShowOlderBtn');
      if (showOlderBtn) {
        bkmpStagePickerShowAllActs = true;
        bkmpIdleRenderStagePickerBody();
      }
    });
  }
  const jumpBtn = document.getElementById('idleStagePickerJumpBtn');
  if (jumpBtn) jumpBtn.addEventListener('click', bkmpIdleStagePickerHandleJump);
  const jumpInput = document.getElementById('idleStagePickerJumpInput');
  if (jumpInput) jumpInput.addEventListener('keydown', e => { if (e.key === 'Enter') bkmpIdleStagePickerHandleJump(); });
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
/* Nutzerwunsch (19.07.): "Funktion die unten im Drop-Chat einstellbar ist,
   ob nur Legi-Runen angezeigt werden" - persistiert wie Theme/Effektmodus
   ueber localStorage. Filtert bewusst NUR die Runenfund-Zeile im Kampf-Log
   (siehe Aufrufstelle in bkmpIdleMaybeDropRune, bkmp-runes.js) - alle
   anderen bkmpIdleLog-Aufrufer (Level-Aufstieg, Aufwertungen, Niederlage,
   Prestige, ...) bleiben unveraendert sichtbar. Die Belohnungs-Karte/
   -Zeremonie daneben ist davon nicht betroffen, nur die Textzeile im Log. */
const BKMP_IDLE_LOG_LEGENDARY_ONLY_KEY = 'bkmp-idle-log-legendary-only';
function bkmpIdleLogLegendaryOnly() {
  try { return localStorage.getItem(BKMP_IDLE_LOG_LEGENDARY_ONLY_KEY) === '1'; } catch (e) { return false; }
}
function bkmpIdleLogLegendaryOnlyInit() {
  const toggle = document.getElementById('idleLogLegendaryOnlyToggle');
  if (!toggle) return;
  toggle.checked = bkmpIdleLogLegendaryOnly();
  toggle.addEventListener('change', () => {
    try { localStorage.setItem(BKMP_IDLE_LOG_LEGENDARY_ONLY_KEY, toggle.checked ? '1' : '0'); } catch (e) {}
  });
}
/* skipToast (Nutzerwunsch 19.07., Screenshot "oben die Benachrichtigung weg"):
   fuer Ereignisse, die GLEICHZEITIG ueber das neue Reward-Presentation-
   System (bkmpRewardPresent, siehe js/ui/bkmp-reward-presenter.js) bereits
   eine eigene Anzeige bekommen, war der hier automatisch ausgeloeste
   bkmpShowJannikToast doppelt gemoppelt - zwei fast identische Meldungen
   gleichzeitig oben mittig. Bewusst opt-in (Standardverhalten fuer alle
   anderen bkmpIdleLog-Aufrufer bleibt exakt gleich), nur an den Stellen
   gesetzt, die bereits eigenstaendig ueber bkmpRewardPresent benachrichtigen. */
function bkmpIdleLog(msg, skipToast) {
  const log = document.getElementById('idleDorfLog');
  if (log) {
    const line = document.createElement('div');
    line.className = 'idle-dorf-log-line';
    line.textContent = msg;
    log.prepend(line);
    while (log.children.length > 20) log.removeChild(log.lastChild);
  }
  if (!skipToast && typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(msg, 3200);
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

/* Redesign 18.07. (Phase 5.4, Abschnitt Upgrades): reine Darstellungs-
   Ueberarbeitung - liest weiterhin exakt dieselben Felder
   (effectPerLevel/baseCost/costRate/costExponent, bkmpIdleUpgradeCost,
   bkmpDragonResourceRatePerHour, bkmpIdleProductionBuildingRatePerHour),
   berechnet keinen neuen Spielwert. "Aktueller Effekt"/"Nächste Stufe"
   ist nur (Stufe * effectPerLevel) bzw. ((Stufe+1) * effectPerLevel) -
   bzw. bei den beiden Gebaeude-Gruppen derselbe Ratenaufruf einmal mit
   Stufe, einmal mit Stufe+1 - reine Vorschau bereits existierender
   Formeln, keine neue Berechnung. */
function bkmpIdleUpgradeEffectLabel(effectType, value) {
  const fn = BKMP_IDLE_EFFECT_LABELS[effectType];
  return fn ? fn(value) : `+${value}`;
}

function bkmpIdleUpgradeCardHtml(opts) {
  const { icon, name, level, maxLevel, maxed, cost, affordable, resourceEmoji, currentLabel, nextLabel, buyClass, buyDataAttr } = opts;
  return `
    <div class="idle-upgrade-card${maxed ? ' is-maxed' : ''}">
      <div class="idle-upgrade-card-head">
        <span class="idle-upgrade-icon">${icon}</span>
        <div class="idle-upgrade-card-title">
          <span class="idle-upgrade-name">${escapeHtml(name)}</span>
          <span class="idle-upgrade-level">Stufe ${level}${maxed ? ' · Max' : ' / ' + maxLevel}</span>
        </div>
      </div>
      <div class="idle-upgrade-effect-row">
        <div class="idle-upgrade-effect-line idle-upgrade-effect-current">${currentLabel}</div>
        ${!maxed ? `<div class="idle-upgrade-effect-line idle-upgrade-effect-next"><span class="idle-upgrade-effect-arrow" aria-hidden="true">→</span> ${nextLabel}</div>` : ''}
      </div>
      <button type="button" class="btn-ja idle-upgrade-buy ${buyClass}" ${buyDataAttr} ${maxed || !affordable ? 'disabled' : ''}>
        ${maxed ? 'Maximal' : `${resourceEmoji} ${bkmpIdleFormatNumber(cost)}`}
      </button>
    </div>`;
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
      <span>Auto-Kauf: kauft automatisch das günstigste bezahlbare Upgrade</span>
    </label>
    <div class="idle-upgrade-grid">${BKMP_IDLE_UPGRADES.map(def => {
    const level = Number(purchases[def.id] || 0);
    const maxed = level >= def.maxLevel;
    const cost = maxed ? 0 : bkmpIdleUpgradeCost(def, level);
    const affordable = !maxed && (bkmpIdleState[def.resource] || 0) >= cost;
    return bkmpIdleUpgradeCardHtml({
      icon: def.icon, name: def.name, level, maxLevel: def.maxLevel, maxed, cost, affordable,
      resourceEmoji: bkmpIdleResourceEmoji(def.resource),
      currentLabel: level > 0 ? bkmpIdleUpgradeEffectLabel(def.effectType, level * def.effectPerLevel) : 'Noch kein Effekt',
      nextLabel: bkmpIdleUpgradeEffectLabel(def.effectType, (level + 1) * def.effectPerLevel),
      buyClass: '', buyDataAttr: `data-upgrade-id="${def.id}"`
    });
  }).join('')}</div>
    <h4 class="idle-upgrade-section-title">Drachenzucht-Gebäude</h4>
    <div class="idle-upgrade-grid">${[
      { kind: 'fruit', levelKey: 'obstgarten_level', icon: '🌳', name: 'Obstgarten', unit: 'Früchte/Std.' },
      { kind: 'meat', levelKey: 'jagdhuette_level', icon: '🥩', name: 'Jagdhütte', unit: 'Fleisch/Std.' }
    ].map(b => {
      const level = Number(bkmpIdleState[b.levelKey] || 0);
      const maxed = level >= BKMP_DRAGON_BUILDING_MAX_LEVEL;
      const cost = maxed ? 0 : bkmpDragonBuildingCost(level);
      const affordable = !maxed && (bkmpIdleState.gold || 0) >= cost;
      const rate = bkmpDragonResourceRatePerHour(b.kind, level);
      const nextRate = bkmpDragonResourceRatePerHour(b.kind, level + 1);
      const cap = bkmpDragonResourceCap(level);
      return bkmpIdleUpgradeCardHtml({
        icon: b.icon, name: b.name, level, maxLevel: BKMP_DRAGON_BUILDING_MAX_LEVEL, maxed, cost, affordable,
        resourceEmoji: '💰',
        currentLabel: `${bkmpIdleFormatNumber(rate)} ${b.unit} · Lager ${bkmpIdleFormatNumber(cap)}`,
        nextLabel: `${bkmpIdleFormatNumber(nextRate)} ${b.unit}`,
        buyClass: 'idle-dragon-building-upgrade', buyDataAttr: `data-kind="${b.kind}"`
      });
    }).join('')}</div>
    <h4 class="idle-upgrade-section-title">Produktionsgebäude</h4>
    <div class="idle-upgrade-grid">${BKMP_IDLE_PRODUCTION_BUILDINGS.map(def => {
      const level = Number(bkmpIdleState[def.levelKey] || 0);
      const maxed = level >= BKMP_IDLE_PRODUCTION_BUILDING_MAX_LEVEL;
      const cost = maxed ? 0 : bkmpIdleProductionBuildingCost(def, level);
      const affordable = !maxed && (bkmpIdleState.gold || 0) >= cost;
      const rate = bkmpIdleProductionBuildingRatePerHour(def, level);
      const nextRate = bkmpIdleProductionBuildingRatePerHour(def, level + 1);
      return bkmpIdleUpgradeCardHtml({
        icon: def.icon, name: def.name, level, maxLevel: BKMP_IDLE_PRODUCTION_BUILDING_MAX_LEVEL, maxed, cost, affordable,
        resourceEmoji: '💰',
        currentLabel: `${bkmpIdleFormatNumber(rate)} ${def.unit}`,
        nextLabel: `${bkmpIdleFormatNumber(nextRate)} ${def.unit}`,
        buyClass: 'idle-production-building-buy', buyDataAttr: `data-building-id="${def.id}"`
      });
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
    /* Redesign Phase 3 (17.07.): laeuft jetzt ueber die geteilte UI-
       Komponente statt bkmpLeaderboardRenderSimpleRow() direkt aufzurufen -
       kein rarity-Argument hier (diese Tabs kennen keine Seltenheit), also
       identisches Ergebnis wie vorher, aber bereit fuer eine kuenftige
       Sammler-Bestenliste, die sie mitgeben will. */
    return bkmpUiLeaderboardRow(i, row.display_name, tab.format(Number(row[tab.field] || 0)), isMe);
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
    /* Bug-Fix 18.07. (Section B, "Runen ueberleben Prestige"): Runen
       gehen seit der Aenderung an bkmpPrestigeExecuteReset NICHT mehr
       verloren - der bisherige Code hier ging noch von der alten Annahme
       aus und hat den lokalen Runenbestand einfach GELEERT, sobald ein
       Prestige-Aufstieg auf einem ANDEREN Geraet/Tab erkannt wurde. Das
       haette echte, weiterhin existierende Runen faelschlich unsichtbar
       gemacht, bis zum naechsten vollen Neuladen. Stattdessen jetzt ein
       frischer Server-Abgleich (derselbe Lademechanismus wie beim
       eigentlichen Spielstart) - holt den tatsaechlich aktuellen Stand,
       inkl. eventueller Aenderungen, die auf dem anderen Geraet VOR dessen
       Aufstieg noch am Runenbestand vorgenommen wurden. */
    try {
      const remoteRunesAfterElsewherePrestige = typeof loadPlayerRunes === 'function' ? await loadPlayerRunes(bkmpIdleState.name_key) : [];
      bkmpIdlePlayerRunes = Array.isArray(remoteRunesAfterElsewherePrestige) ? remoteRunesAfterElsewherePrestige.map(r => ({
        ...r,
        _cid: r.id,
        upgrade_level: Number(r.upgrade_level || 0),
        substats: Array.isArray(r.substats) ? r.substats : []
      })) : [];
      if (typeof bkmpRuneNormalizeDuplicateEquips === 'function') bkmpRuneNormalizeDuplicateEquips();
    } catch (e) { /* naechster Abgleich versucht es erneut, lokaler Bestand bleibt vorerst unveraendert */ }
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

/* Erzwingt ein sofortiges Speichern statt auf den 4s-Debounce zu warten -
   nach einem Aufstieg soll der zurueckgesetzte Stand nicht verloren gehen,
   falls direkt danach das Fenster/der Tab geschlossen wird. */
async function bkmpIdleFlushSyncNow() {
  bkmpIdleSyncPending = true;
  if (bkmpIdleSyncTimer) { window.clearTimeout(bkmpIdleSyncTimer); bkmpIdleSyncTimer = null; }
  await bkmpIdleFlushSync();
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

/* ---------------- Tabs & Modal ---------------- */

/* Holt HP-Balken/-Sprites auf den echten (waehrend der Tab inaktiv war
   still weiterlaufenden, siehe bkmpIdleCombatVisualsActive) Spielstand
   nach - noetig, weil bkmpIdleTick() waehrend eines anderen aktiven Tabs
   bewusst KEINE DOM-Updates mehr macht (Performance), der Kampf selbst
   aber unveraendert weiterlief. Ohne diesen Nachhol-Schritt wuerden HP-
   Balken/Drachen-Sprite beim Zurueckwechseln zu "Kampf" bis zu einem
   Tick lang (max. 900ms) veraltete Werte zeigen. */
/* Performance-Modus (Nutzer-Auftrag, Section B Prioritaet 7: "Hoch /
   Reduziert / Aus"). Reine Anzeige-Einstellung - steuert ausschliesslich,
   welche der in der Profiling-Runde identifizierten teuersten CSS-
   Animationen laufen (Screen-Shake, Krit-Flash, Hintergrund-Ambience,
   backdrop-filter auf der mobilen Bottom-Nav, siehe die einzelnen
   html[data-fx="..."]-Regeln in style.css) - fasst NIE Spielwerte,
   Drop-Chancen oder Kampfberechnungen an, die bleiben in JEDER Stufe
   exakt gleich (nur was der Spieler SIEHT, nicht was passiert).
   Bewusst OHNE automatische Geraete-/Mobil-Erkennung als Standard (Nutzer-
   Vorgabe: "Mobile Geraete sollen nicht pauschal als langsam behandelt
   werden" + "schwaecheres Geraet darf keinen spielerischen Nachteil
   erhalten") - Startwert ist immer "hoch", der Spieler entscheidet aktiv
   selbst. Persistiert wie Theme/Akzentfarbe ueber localStorage. */
const BKMP_FX_MODE_KEY = 'bkmp-fx-mode';
const BKMP_FX_MODES = ['hoch', 'reduziert', 'aus'];
const BKMP_FX_MODE_LABELS = { hoch: '✨ Effekte: Hoch', reduziert: '🔅 Effekte: Reduziert', aus: '🚫 Effekte: Aus' };

function bkmpFxGetMode() {
  let saved = null;
  try { saved = localStorage.getItem(BKMP_FX_MODE_KEY); } catch (e) {}
  if (BKMP_FX_MODES.indexOf(saved) !== -1) return saved;
  /* Kein gespeicherter Wert: einzig erlaubte automatische Vorbelegung ist
     das explizite Betriebssystem-Signal "prefers-reduced-motion" (Nutzer-
     Vorgabe: "soll respektiert werden") - AUSDRUECKLICH NICHT Bildschirm-
     breite/Geraeteart, die duerfen laut Auftrag niemals als "vermutlich
     schwach" gewertet werden. */
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduziert';
  return 'hoch';
}

function bkmpFxApplyMode(mode) {
  document.documentElement.setAttribute('data-fx', mode);
  const btn = document.getElementById('idleFxModeBtn');
  if (btn) btn.textContent = BKMP_FX_MODE_LABELS[mode] || BKMP_FX_MODE_LABELS.hoch;
  /* Nutzerwunsch (19.07.): "Aus" haelt jetzt auch die Drachen-Kampfvideos
     an (Standbild statt Endlosschleife) - deckt den Fall ab, dass schon
     ein Drache zu sehen ist, WAEHREND umgeschaltet wird (Neu-Erscheinen
     eines Drachen deckt bkmpIdleApplyDragonSprite in js/ui/bkmp-hud.js
     selbst ab). Reiner Anzeige-Unterschied, keine Kampfwerte betroffen. */
  if (typeof bkmpIdleSyncDragonVideoPlayback === 'function') bkmpIdleSyncDragonVideoPlayback();
}

function bkmpFxSetMode(mode) {
  if (BKMP_FX_MODES.indexOf(mode) === -1) return;
  try { localStorage.setItem(BKMP_FX_MODE_KEY, mode); } catch (e) {}
  bkmpFxApplyMode(mode);
}

function bkmpFxCycleMode() {
  const idx = BKMP_FX_MODES.indexOf(bkmpFxGetMode());
  bkmpFxSetMode(BKMP_FX_MODES[(idx + 1) % BKMP_FX_MODES.length]);
}

function bkmpFxInit() {
  bkmpFxApplyMode(bkmpFxGetMode());
  const btn = document.getElementById('idleFxModeBtn');
  if (btn) btn.addEventListener('click', bkmpFxCycleMode);
}

function bkmpIdleCatchUpCombatVisuals() {
  if (bkmpIdleCurrentDragon) bkmpIdleUpdateDragonHpBar();
  bkmpIdleUpdateVillageHpBar();
  /* Dungeon-/Turm-Banner (siehe bkmpDungeonUpdateBanner/bkmpTowerUpdateBanner)
     pausieren ihren 500ms-Refresh ebenfalls ausserhalb des Kampf-Tabs -
     hier einmalig nachholen, damit Welle/Zeit beim Zurueckwechseln sofort
     aktuell sind statt bis zu 500ms zu haengen. */
  if (bkmpDungeonActive && typeof bkmpDungeonUpdateBanner === 'function') bkmpDungeonUpdateBanner();
  if (bkmpTowerActive && typeof bkmpTowerUpdateBanner === 'function') bkmpTowerUpdateBanner();
}

const bkmpIdleTabs = [
  { id: 'kampf', btn: 'idleTabBtnKampf', panel: 'idlePanelKampf', render: bkmpIdleCatchUpCombatVisuals },
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
  /* Section C (18.07.): gleiches Muster wie beim Drachen-Detail-Popup oben -
     ohne diese explizite Kopplung koennten die neuen Prestige-Overlays
     (Bestaetigung/Zeremonie) unsichtbar ueber der geschlossenen Seite haengen
     bleiben, wenn der Spieler das ganze Idle-Dorf-Fenster schliesst, waehrend
     einer von beiden gerade offen ist. */
  const prestigeConfirmOverlay = document.getElementById('idlePrestigeConfirmOverlay');
  if (prestigeConfirmOverlay) prestigeConfirmOverlay.classList.remove('visible');
  bkmpPrestigeConfirmPreview = null;
  bkmpPrestigeConfirmSubmitting = false;
  bkmpPrestigeConfirmErrored = false;
  if (typeof bkmpPrestigeCloseCeremony === 'function') bkmpPrestigeCloseCeremony();
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

/* Sperre + Klick-Verlauf muessen einen Seiten-Reload ueberleben - sonst
   waere der ganze Autoklicker-Schutz kostenlos umgehbar (Reload sobald
   gesperrt hebt die Sperre sofort auf; regelmaessiges Reload alle ~55s
   verhindert sogar, dass die 60s-Mustererkennung je zuschlaegt). Deshalb
   in localStorage statt nur im Skript-Speicher. */
const BKMP_IDLE_CLICK_LOCK_KEY = 'bkmp-idle-click-locked-until';
const BKMP_IDLE_CLICK_HISTORY_KEY = 'bkmp-idle-click-timestamps';

let bkmpIdleClickTimestamps = bkmpAutoclickLoadTimestamps(BKMP_IDLE_CLICK_HISTORY_KEY);
let bkmpIdleClickLockedUntil = bkmpAutoclickLoadNumber(BKMP_IDLE_CLICK_LOCK_KEY);

function bkmpIdleInit() {
  bkmpIdleInitTabs();
  bkmpFxInit();
  bkmpIdleLogLegendaryOnlyInit();
  bkmpPrestigeInit();
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
  el.innerHTML = `<span class="rf-chip rf-gold"><span class="rf-icon">💰</span>+${Math.round(e.detail.gold)}</span><span class="rf-chip rf-xp"><span class="rf-icon">✨</span>+${Math.round(e.detail.xp)}</span>`;
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


