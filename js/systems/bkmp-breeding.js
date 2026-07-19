// Bkmp - Redesign Phase 2a (17.07.): mechanisch aus idledorf.js extrahiert (mit einem AST-Parser exakt abgegrenzt, keine Logik veraendert). js/systems/bkmp-breeding.js


/* ---------------- Drachenzucht (siehe supabase-dragon-breeding.sql) ----------------
   Vertrauensmodell wie Runen: Client wuerfelt Chancen/Werte, RLS erzwingt
   nur "eigene Zeile". Rollt/entwickelt nach demselben Muster wie Runen
   (rolled_value/substats einmal wuerfeln, dauerhaft speichern) - siehe
   bkmpIdleRollAdultDragonStats(). Nur die zwei Stellen mit echtem
   Mehrspieler-/Wiederholungsrisiko (legendaere Ei-Wuerfe, Epic-Meilenstein)
   laufen serverseitig (raid_finish/claim_epic_dragon_egg). */
let bkmpDragonSpeciesCatalog = [];
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
/* Redesign Phase 1 (17.07.): die Original-Drachen-PNGs (aus Supabase,
   `egg_image`/`baby_image`/... Spalten, bis zu 3MB/1400px) bleiben
   unangetastet fuer volle Aufloesung; scripts/optimize-images.ps1 erzeugt
   daneben "-web.webp"/"-web.png" (480px, fuer die 96-160px-Anzeigeflaeche
   dieser Karten reichlich). Diese Funktion leitet die kleinen Varianten
   rein clientseitig vom Original-Pfad ab, damit KEINE Datenbank-Aenderung
   noetig ist - faellt automatisch auf das Original zurueck, falls ein Bild
   (noch) nicht durchs Skript gelaufen ist (Browser laedt dann einfach die
   grosse PNG als <img>-Fallback, nichts bricht). */
function bkmpDragonImgVariants(path) {
  if (!path) return { webp: '', fallback: '' };
  const dot = path.lastIndexOf('.');
  if (dot === -1) return { webp: '', fallback: path };
  const base = path.slice(0, dot);
  return { webp: `${base}-web.webp`, fallback: `${base}-web.png` };
}
function bkmpDragonThumbHtml(path, altText, extraClass) {
  const v = bkmpDragonImgVariants(path);
  const cls = `idle-dragon-thumb${extraClass ? ' ' + extraClass : ''}`;
  return `<picture><source srcset="${v.webp}" type="image/webp"><img class="${cls}" src="${v.fallback || path}" alt="${altText}" width="96" height="96" loading="lazy" decoding="async"></picture>`;
}

/* ---------------- Lexikon (Spieler-Wunsch 17.07.) ----------------
   Dauerhafter "schon mal besessen"-Merker pro Art (dragon_species_
   discovered_at, siehe supabase-idle-dragon-species-discovered.sql) -
   bewusst NICHT aus der aktuellen Live-Sammlung (bkmpPlayerDragons/
   bkmpPlayerDragonEggs) abgeleitet, denn die verliert Eintraege, sobald
   der letzte Vertreter einer Art freigelassen oder fuer einen Aufstieg
   verbraucht wird - ein Lexikon-Eintrag soll aber wie bei einem echten
   Pokedex fuer immer entdeckt bleiben, sobald er einmal aufgetaucht ist.
   Reconciliation laeuft rein additiv (nie entfernen) bei jedem Laden der
   Zucht-Daten - das faengt sowohl neue Eier/Drachen als auch den
   Alt-Bestand ab, den Spieler schon VOR Einfuehrung dieses Features
   hatten. */
function bkmpDragonReconcileDiscovered() {
  if (!bkmpIdleState) return false;
  if (!bkmpIdleState.dragon_species_discovered_at) bkmpIdleState.dragon_species_discovered_at = {};
  const map = bkmpIdleState.dragon_species_discovered_at;
  const ownedIds = new Set([
    ...bkmpPlayerDragonEggs.map(e => e.species_id),
    ...bkmpPlayerDragons.map(d => d.species_id)
  ]);
  let changed = false;
  ownedIds.forEach(id => {
    if (id && !map[id]) { map[id] = new Date().toISOString(); changed = true; }
  });
  if (changed) bkmpIdleQueueSync();
  return changed;
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
    /* Phase 5.5 (19.07.): Schluepfen ist im Auftrag explizit als Stufe-3-
       Zeremonie-Beispiel genannt, unabhaengig von der Seltenheit - anders als
       bei Runen/Eiern wird hier NICHT ueber die Rarity automatisch die Stufe
       gewaehlt, sondern fest 'ceremony' erzwungen. Feuert erst hier, NACH dem
       bestaetigten `dragon`-Rueckgabewert (siehe Abbruch weiter oben, falls
       `!dragon`) - der neue Drache ist zu diesem Zeitpunkt bereits in der DB
       gespeichert. Der alte Toast bleibt als Fallback (z.B. falls das Reward-
       Presenter-Script auf einer anderen Seite als index.html fehlt). */
    if (typeof bkmpRewardPresent === 'function') {
      const iconHtml = species && typeof bkmpDragonThumbHtml === 'function'
        ? bkmpDragonThumbHtml(bkmpDragonStageImage(species, 'baby'), species.name, 'bkmp-reward-ceremony-thumb')
        : '🐣';
      bkmpRewardPresent({
        tier: 'ceremony',
        rarity: species ? species.rarity : null,
        icon: iconHtml,
        title: `${species ? species.name : 'Dein Drache'} ist geschlüpft!`,
        description: foodPreference === 'fruit' ? 'Bevorzugt Früchte als Nahrung.' : 'Bevorzugt Fleisch als Nahrung.',
        source: 'Drachennest',
        dedupeKey: `dragon-hatch-${dragon.id}`
      });
    } else if (typeof bkmpShowJannikToast === 'function') {
      bkmpShowJannikToast(`🐣 Dein ${species ? species.name : 'Drache'} ist geschlüpft!`, 4200);
    }
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
  /* Phase 5.5 (19.07.): Baby->Jugendlich ist kein Stufe-3-Beispiel im Auftrag
     (nur Schluepfen und Erwachsen-Werden sind es), bekommt aber als
     Entwicklungsschritt bewusst mehr als einen Toast - feste Stufe-2-Karte
     statt rarity-abhaengiger Automatik, sonst wuerde ein 'standard'-Drache
     (keine Rarity-Metadaten in BKMP_UI_RARITY_MAP) mangels erkannter Stufe
     stillschweigend auf Toast zurueckfallen. */
  if (typeof bkmpRewardPresent === 'function') {
    bkmpRewardPresent({
      tier: 'card',
      rarity: species.rarity,
      icon: typeof bkmpDragonThumbHtml === 'function' ? bkmpDragonThumbHtml(bkmpDragonStageImage(species, 'teen'), species.name, 'bkmp-reward-card-thumb') : '🐉',
      title: `${species.name} ist jetzt jugendlich!`,
      description: 'Setze ihn als Begleiter ein, um Kampf-EP für die letzte Entwicklungsstufe zu sammeln.',
      source: 'Drachenlager',
      dedupeKey: `dragon-teen-${dragonId}`
    });
  } else if (typeof bkmpShowJannikToast === 'function') {
    bkmpShowJannikToast(`🐉 ${species.name} ist jetzt jugendlich!`, 3600);
  }
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
    /* Phase 5.5 (19.07.): Erwachsen-Werden ist im Auftrag explizit als
       Stufe-3-Zeremonie-Beispiel genannt. Der Hauptwert wurde bereits oben
       von bkmpIdleRollAdultDragonStats() EINMALIG gewuerfelt und in `dragon`
       gemergt (Object.assign) - bkmpDragonMainStatLine() liest hier nur noch
       den bereits gespeicherten Wert aus, wuerfelt nichts neu. */
    if (typeof bkmpRewardPresent === 'function') {
      bkmpRewardPresent({
        tier: 'ceremony',
        rarity: species.rarity,
        icon: typeof bkmpDragonThumbHtml === 'function' ? bkmpDragonThumbHtml(bkmpDragonStageImage(species, 'adult'), species.name, 'bkmp-reward-ceremony-thumb') : '👑',
        title: `${species.name} ist erwachsen geworden!`,
        description: typeof bkmpDragonMainStatLine === 'function' ? bkmpDragonMainStatLine(dragon) : '',
        source: 'Drachenlager',
        dedupeKey: `dragon-adult-${dragonId}`
      });
    } else if (typeof bkmpShowJannikToast === 'function') {
      bkmpShowJannikToast(`👑 Dein ${species.name} ist erwachsen geworden!`, 4400);
    }
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

/* ---------------- Lexikon-Raster + 4-Seiten-Detailansicht ----------------
   Nutzerwunsch (17.07.): "Lexikon von den Drachen der Drachenzucht... was
   man schon hat und was nicht... 4 Seiten zum blaettern EGG -> Baby ->
   Jugendlich -> Erwachsen... Alle Schwarz ausgeblendet die man noch nicht
   hat... sobald dann in Voller Farbe". Nutzt bkmpDragonSpeciesCatalog (ALLE
   bekannten Arten, nicht nur besessene) + dragon_species_discovered_at
   (siehe bkmpDragonReconcileDiscovered) fuer den Besitz-Status. */
function bkmpDragonRenderLexikonSection() {
  bkmpDragonReconcileDiscovered();
  const discovered = (bkmpIdleState && bkmpIdleState.dragon_species_discovered_at) || {};
  const species = bkmpDragonSpeciesCatalog.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const discoveredCount = species.filter(s => discovered[s.id]).length;
  const cardsHtml = species.length
    ? species.map(sp => {
        const isDiscovered = Boolean(discovered[sp.id]);
        const rarity = bkmpDragonRarityMeta(sp.rarity);
        return `
          <div class="idle-skin-card idle-dragon-dex-card ${isDiscovered ? 'is-discovered' : 'is-locked'}" data-species-id="${sp.id}" style="--dragon-rarity-color:${rarity.color}">
            ${bkmpDragonThumbHtml(sp.adult_image, isDiscovered ? escapeHtml(sp.name) : 'Unentdeckte Art')}
            <div class="idle-skin-name">${isDiscovered ? escapeHtml(sp.name) : '???'}</div>
            <div class="idle-skin-desc">${isDiscovered ? rarity.name : 'Noch nicht entdeckt'}</div>
          </div>`;
      }).join('')
    : `<p class="idle-skin-empty-hint">Lexikon konnte nicht geladen werden - Migration evtl. noch nicht ausgefuehrt.</p>`;
  return `
    <div class="idle-dragon-section">
      <h4>📖 Drachen-Lexikon (${discoveredCount}/${species.length})</h4>
      <div class="idle-skin-grid idle-dragon-dex-grid">${cardsHtml}</div>
    </div>`;
}

const BKMP_DRAGON_DEX_STAGES = ['egg', 'baby', 'teen', 'adult'];
const BKMP_DRAGON_DEX_STAGE_LABELS = { egg: 'Ei', baby: 'Baby', teen: 'Jugendlich', adult: 'Erwachsen' };
let bkmpDragonDexPageIndex = 0;

function bkmpDragonOpenDexDetail(speciesId) {
  const species = bkmpDragonSpeciesById(speciesId);
  const overlay = document.getElementById('idleDragonDexOverlay');
  if (!species || !overlay) return;
  const discovered = Boolean(bkmpIdleState && bkmpIdleState.dragon_species_discovered_at && bkmpIdleState.dragon_species_discovered_at[speciesId]);
  bkmpDragonDexPageIndex = 0;
  overlay.dataset.speciesId = speciesId;
  overlay.dataset.discovered = discovered ? '1' : '0';
  /* .onclick statt addEventListener: haelt pro Element garantiert genau
     EINEN Handler, kein manuelles removeEventListener-Bookkeeping noetig,
     obwohl dieses Overlay (anders als die generierten Lager-Karten) bei
     jedem Oeffnen dieselben statischen Buttons wiederverwendet. */
  const prevBtn = document.getElementById('idleDragonDexPrevBtn');
  const nextBtn = document.getElementById('idleDragonDexNextBtn');
  const closeBtn = document.getElementById('idleDragonDexCloseBtn');
  if (prevBtn) prevBtn.onclick = () => bkmpDragonDexPage(-1);
  if (nextBtn) nextBtn.onclick = () => bkmpDragonDexPage(1);
  if (closeBtn) closeBtn.onclick = bkmpDragonCloseDexDetail;
  document.querySelectorAll('.idle-dragon-dex-dot').forEach((dot, i) => { dot.onclick = () => bkmpDragonDexGoToPage(i); });
  /* Sichtbar machen VOR dem ersten Render - bkmpDragonRenderDexPage()
     verweigert bei einem noch nicht sichtbaren Overlay (Schutz gegen
     Schreiben auf ein bereits geschlossenes Fenster bei einer verzoegerten
     Zwischenaktualisierung), sonst blieb die allererste Seite leer. */
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');
  bkmpDragonRenderDexPage();
}

function bkmpDragonRenderDexPage() {
  const overlay = document.getElementById('idleDragonDexOverlay');
  if (!overlay || !overlay.classList.contains('visible')) return;
  const species = bkmpDragonSpeciesById(overlay.dataset.speciesId);
  if (!species) return;
  const discovered = overlay.dataset.discovered === '1';
  const rarity = bkmpDragonRarityMeta(species.rarity);
  const stage = BKMP_DRAGON_DEX_STAGES[bkmpDragonDexPageIndex];
  const img = document.getElementById('idleDragonDexImg');
  if (img) {
    img.src = bkmpDragonStageImage(species, stage) || '';
    img.classList.toggle('idle-dragon-dex-img-locked', !discovered);
  }
  const nameEl = document.getElementById('idleDragonDexName');
  if (nameEl) nameEl.textContent = discovered ? species.name : '???';
  const stageEl = document.getElementById('idleDragonDexStage');
  if (stageEl) stageEl.textContent = BKMP_DRAGON_DEX_STAGE_LABELS[stage];
  const rarityEl = document.getElementById('idleDragonDexRarity');
  if (rarityEl) { rarityEl.textContent = discovered ? rarity.name : ''; rarityEl.style.color = rarity.color; }
  const descEl = document.getElementById('idleDragonDexDesc');
  if (descEl) {
    descEl.textContent = discovered
      ? `${bkmpDragonFormatDuration(bkmpDragonEffectiveBroodSeconds(species) * 1000)} Brutzeit`
      : 'Noch nicht entdeckt - besiege Drachen, gewinne Weltboss-Raids oder finde besondere Ereignisse.';
  }
  document.querySelectorAll('.idle-dragon-dex-dot').forEach((dot, i) => dot.classList.toggle('is-active', i === bkmpDragonDexPageIndex));
  const prevBtn = document.getElementById('idleDragonDexPrevBtn');
  const nextBtn = document.getElementById('idleDragonDexNextBtn');
  if (prevBtn) prevBtn.disabled = bkmpDragonDexPageIndex === 0;
  if (nextBtn) nextBtn.disabled = bkmpDragonDexPageIndex === BKMP_DRAGON_DEX_STAGES.length - 1;
}

function bkmpDragonDexPage(delta) {
  bkmpDragonDexPageIndex = Math.max(0, Math.min(BKMP_DRAGON_DEX_STAGES.length - 1, bkmpDragonDexPageIndex + delta));
  bkmpDragonRenderDexPage();
}

function bkmpDragonDexGoToPage(index) {
  bkmpDragonDexPageIndex = Math.max(0, Math.min(BKMP_DRAGON_DEX_STAGES.length - 1, index));
  bkmpDragonRenderDexPage();
}

function bkmpDragonCloseDexDetail() {
  const overlay = document.getElementById('idleDragonDexOverlay');
  if (overlay) overlay.classList.remove('visible');
  document.body.classList.remove('modal-open');
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

// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). (2b-Ergaenzung)


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
    bkmpDragonReconcileDiscovered();
  } catch (e) {
    console.warn('Idle Dorf: Drachenzucht-Daten konnten nicht geladen werden (Migration evtl. noch nicht ausgefuehrt - siehe supabase-dragon-breeding.sql).', e);
  }
  bkmpIdleAccrueBuildingResources();
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
            ${bkmpDragonThumbHtml(species.egg_image, escapeHtml(species.name))}
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
          ${bkmpDragonThumbHtml(bkmpDragonStageImage(species, ready ? 'egg' : 'egg'), escapeHtml(species.name))}
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
            ${bkmpDragonThumbHtml(species.baby_image, escapeHtml(species.name))}
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
            ${bkmpDragonThumbHtml(bkmpDragonStageImage(species, d.stage), escapeHtml(species.name))}
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
    </div>
    ${bkmpDragonRenderLexikonSection()}`;

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
  panel.querySelectorAll('.idle-dragon-dex-card').forEach(card => card.addEventListener('click', () => {
    bkmpDragonOpenDexDetail(card.dataset.speciesId);
  }));

  bkmpDragonStartNestCountdownTicker();
}
