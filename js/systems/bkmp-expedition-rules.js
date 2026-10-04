/* ============================================================
   Drachen-Expeditionen: gemeinsame Regeln (Drachendorf-Ausbau Phase 3)

   Exakter JS-Spiegel von expedition_team_eval()/expedition_quality()/
   dragon_bond_level() aus sql/20261004-03-expeditions.sql. Wird im Spiel
   fuer die VORSCHAU benutzt (welche Bedingungen erfuellt sind, welche
   Qualitaet zu erwarten ist) und von der lokalen Testumgebung
   (tests/mock/rpc-engine.js) als Nachbau des Servers. Massgeblich fuer das
   echte Ergebnis ist immer der Server.

   Laeuft im Browser (globale bkmp*-Funktionen) UND in Node (module.exports).
   ============================================================ */

const BKMP_DRAGON_BOND_THRESHOLDS = [0, 100, 250, 500, 900, 1500, 2400, 3600, 5200, 7500];

const BKMP_AFFINITY_META = {
  feuer: { icon: '🔥', label: 'Feuer' },
  wasser: { icon: '💧', label: 'Wasser' },
  erde: { icon: '🌍', label: 'Erde' },
  wind: { icon: '🌪️', label: 'Wind' },
  blitz: { icon: '⚡', label: 'Blitz' },
  licht: { icon: '☀️', label: 'Licht' },
  dunkel: { icon: '🌑', label: 'Dunkel' },
  arkan: { icon: '✨', label: 'Arkan' },
  neutral: { icon: '⚪', label: 'Neutral' }
};

const BKMP_EXPEDITION_RARITY_LABELS = { standard: 'Standard', selten: 'Selten', episch: 'Episch', legendaer: 'Legendär' };

const BKMP_EXPEDITION_QUALITY = [
  null,
  { stars: '⭐', label: 'Erfolgreich', mult: 1.0 },
  { stars: '⭐⭐', label: 'Sehr erfolgreich', mult: 1.25 },
  { stars: '⭐⭐⭐', label: 'Hervorragend', mult: 1.6 },
  { stars: '⭐⭐⭐⭐', label: 'Legendär', mult: 2.0 }
];

/* Eigenschaften (Phase 4): Wirkung nur auf Expeditionen (keine Kampfkraft).
   Staerke 1, bei Bindung 8+ des Traegers 1,5 (Bindungsmeilenstein 8). */
const BKMP_DRAGON_TRAIT_IDS = ['gierig', 'entdecker', 'sammler', 'mutig', 'schatzsucher', 'gesellig', 'einzelgaenger', 'forscher', 'beschuetzer', 'glueckskind', 'heiler'];

function bkmpExpeditionTraitStrength(team, traitId) {
  let s = 0;
  (team || []).forEach(m => {
    if (m.trait === traitId) s = Math.max(s, (Number(m.bond_level) || 1) >= 8 ? 1.5 : 1);
  });
  return s;
}
/* Zufallswurf-Spanne (Glueckskind erweitert nach oben, Beschuetzer hebt
   das Minimum) - identisch zu expedition_start(). */
function bkmpExpeditionRollRange(team) {
  const luck = bkmpExpeditionTraitStrength(team, 'glueckskind');
  const prot = bkmpExpeditionTraitStrength(team, 'beschuetzer');
  const span = 21 + (luck > 1 ? 8 : luck > 0 ? 5 : 0);
  const min = prot > 1 ? 12 : prot > 0 ? 8 : 0;
  return { span, min, max: span - 1 };
}
function bkmpExpeditionRoll(seedValue, team) {
  const r = bkmpExpeditionRollRange(team);
  return Math.max(r.min, Number(seedValue) % r.span);
}

function bkmpDragonBondLevel(xp) {
  const v = Number(xp) || 0;
  let lvl = 1;
  for (let i = 0; i < BKMP_DRAGON_BOND_THRESHOLDS.length; i++) {
    if (v >= BKMP_DRAGON_BOND_THRESHOLDS[i]) lvl = i + 1;
  }
  return lvl;
}

function bkmpExpeditionQuality(score) {
  const s = Number(score) || 0;
  return s >= 95 ? 4 : s >= 75 ? 3 : s >= 55 ? 2 : 1;
}
function bkmpExpeditionQualityMult(q) {
  return (BKMP_EXPEDITION_QUALITY[q] || BKMP_EXPEDITION_QUALITY[1]).mult;
}

/* team: Array aus { species_id, rarity, affinities: [], trait, bond_level } */
function bkmpExpeditionTeamEval(mission, team) {
  const req = (mission && mission.requirements) || {};
  const recs = (mission && mission.recommendations) || [];
  const members = Array.isArray(team) ? team : [];
  const affSet = new Set();
  members.forEach(m => (m.affinities || []).forEach(a => affSet.add(a)));
  const distinctAff = affSet.size;
  const distinctSpecies = new Set(members.map(m => m.species_id)).size;
  const distinctRarity = new Set(members.map(m => m.rarity)).size;
  const avgBond = members.length ? members.reduce((s, m) => s + (Number(m.bond_level) || 1), 0) / members.length : 1;
  const unmet = [];
  if (req.affinity_min) {
    Object.keys(req.affinity_min).forEach(a => {
      const n = members.filter(m => (m.affinities || []).includes(a)).length;
      if (n < Number(req.affinity_min[a])) unmet.push('affinity_min:' + a);
    });
  }
  if (req.distinct_affinities_min != null && distinctAff < Number(req.distinct_affinities_min)) unmet.push('distinct_affinities_min');
  if (req.distinct_species_min != null && distinctSpecies < Number(req.distinct_species_min)) unmet.push('distinct_species_min');
  if (req.rarity_min) {
    Object.keys(req.rarity_min).forEach(r => {
      if (members.filter(m => m.rarity === r).length < Number(req.rarity_min[r])) unmet.push('rarity_min:' + r);
    });
  }
  if (req.rarity_max) {
    Object.keys(req.rarity_max).forEach(r => {
      if (members.filter(m => m.rarity === r).length > Number(req.rarity_max[r])) unmet.push('rarity_max:' + r);
    });
  }
  const met = [];
  recs.forEach((rec, i) => {
    let ok = false;
    if (rec.type === 'affinity') ok = members.some(m => (m.affinities || []).includes(rec.value));
    else if (rec.type === 'affinity_count') ok = members.filter(m => (m.affinities || []).includes(rec.value)).length >= (Number(rec.count) || 1);
    else if (rec.type === 'distinct_affinities') ok = distinctAff >= Number(rec.value);
    else if (rec.type === 'distinct_species') ok = distinctSpecies >= Number(rec.value);
    else if (rec.type === 'rarity') ok = members.some(m => m.rarity === rec.value);
    else if (rec.type === 'trait') ok = members.some(m => m.trait === rec.value);
    else if (rec.type === 'bond') ok = avgBond >= Number(rec.value);
    if (ok) met.push(i);
  });
  let score = 25 + met.length * 15 + distinctRarity * 5 + distinctAff * 4 + Math.floor((avgBond - 1) * 2);
  /* Bindungsmeilenstein 4: +3 je Teammitglied mit Bindung 4+. */
  score += 3 * members.filter(m => (Number(m.bond_level) || 1) >= 4).length;
  /* Eigenschaften mit Punktwirkung. */
  const teamSize = Number((mission && mission.team_size) || members.length);
  const mutig = bkmpExpeditionTraitStrength(members, 'mutig');
  if (mutig && Number(mission && mission.duration_hours) === 8) score += Math.floor(10 * mutig);
  const gesellig = bkmpExpeditionTraitStrength(members, 'gesellig');
  if (gesellig && teamSize >= 2) score += Math.floor(4 * (teamSize - 1) * gesellig);
  const solo = bkmpExpeditionTraitStrength(members, 'einzelgaenger');
  if (solo && teamSize === 1) score += Math.floor(12 * solo);
  /* Goettliche Aura (Phase 10): nur Drachen in der fuenften Form bringen ihr
     "expedition"-Objekt (aus dragon_species.special_passive) mit. */
  score += Math.floor(members.reduce((a, m) => a + Number((m.aura && m.aura.score_bonus) || 0), 0));
  return { unmet, met, score };
}

/* Vollstaendiges Ergebnis einer Expedition - exakter Spiegel von
   expedition_start() in sql/20261004-03-expeditions.sql. seedInt(text)
   liefert eine ganze Zahl 0..2^31-1 (Server: md5-basiert). */
function bkmpExpeditionOutcome({ mission, region, team, events, goldUnit, seedInt, id, eventModPct }) {
  const ev = bkmpExpeditionTeamEval(mission, team);
  const roll = bkmpExpeditionRoll(seedInt(id + ':quality'), team);
  const score = ev.score + roll;
  const quality = bkmpExpeditionQuality(score);
  const mult = bkmpExpeditionQualityMult(quality);
  const rw = (mission && mission.rewards) || {};
  const s = t => bkmpExpeditionTraitStrength(team, t);
  const gold = 1 + 0.15 * s('gierig');
  const mat = 1 + 0.15 * s('sammler');
  const cry = 1 + 0.10 * s('schatzsucher');
  const ess = 1 + 0.10 * s('forscher');
  const runeMult = 1 + 0.15 * s('forscher');
  const bondMult = 1 + 0.25 * s('heiler');
  const auraPct = (team || []).reduce((a, m) => a + Number((m.aura && m.aura.reward_pct) || 0), 0);
  const auraEvent = (team || []).reduce((a, m) => a + Number((m.aura && m.aura.event_bonus) || 0), 0);
  const r = {
    gold: Math.round(Number(rw.gold_units || 0) * goldUnit * mult * gold),
    wood: Math.round(Number(rw.wood || 0) * mult * mat),
    stone: Math.round(Number(rw.stone || 0) * mult * mat),
    crystals: Math.round(Number(rw.crystals || 0) * mult * cry),
    essence: Math.round(Number(rw.essence || 0) * mult * ess),
    fruit: Math.round(Number(rw.fruit || 0) * mult * mat),
    meat: Math.round(Number(rw.meat || 0) * mult * mat),
    bond_xp: Math.round(Number(rw.bond_xp || 0) * bondMult),
    runes: 0, eggs: 0
  };
  r.crystals = Math.round(r.crystals * (1 + auraPct / 100));
  r.essence = Math.round(r.essence * (1 + auraPct / 100));
  const hit = (key, chance) => (seedInt(id + ':' + key) % 10000) < Math.round(chance * 10000);
  const runeChance = Number(rw.rune_chance || 0) * runeMult;
  const eggChance = Number(rw.egg_chance || 0);
  r.runes = Math.floor(runeChance) + (hit('rune', runeChance - Math.floor(runeChance)) ? 1 : 0);
  r.eggs = Math.floor(eggChance) + (hit('egg', eggChance - Math.floor(eggChance)) ? 1 : 0);
  const traits = new Set((team || []).map(m => m.trait).filter(Boolean));
  const affs = new Set();
  (team || []).forEach(m => (m.affinities || []).forEach(a => affs.add(a)));
  const happened = [];
  (events || []).slice().sort((a, b) => (a.sort_order - b.sort_order) || (a.id < b.id ? -1 : 1)).forEach(e => {
    if (happened.length >= 2) return;
    let chance = Number(e.base_chance) + (quality - 1) * 0.015 + 0.03 * s('entdecker') + auraEvent;
    Object.keys(e.affinity_bonus || {}).forEach(a => { if (affs.has(a)) chance += Number(e.affinity_bonus[a]); });
    Object.keys(e.trait_bonus || {}).forEach(t => { if (traits.has(t)) chance += Number(e.trait_bonus[t]); });
    if (!hit('ev:' + e.id, chance)) return;
    happened.push({ id: e.id, name: e.name, icon: e.icon, description: e.description });
    const er = e.reward || {};
    r.gold += Math.round(Number(er.gold_units || 0) * goldUnit);
    ['wood', 'stone', 'crystals', 'essence', 'fruit', 'meat'].forEach(k => { r[k] += Number(er[k] || 0); });
    r.runes += Number(er.runes || 0);
    r.eggs += Number(er.eggs || 0);
    r.bond_xp += Number(er.bond_xp || 0);
  });
  /* Kleine Wochenereignisse (Phase 11, z.B. Expeditionsfieber). */
  const mod = Math.max(0, Math.min(100, Number(eventModPct) || 0));
  if (mod > 0) ['gold', 'wood', 'stone', 'crystals', 'essence', 'fruit', 'meat'].forEach(k => { r[k] = Math.round(r[k] * (1 + mod / 100)); });
  r.rune_tier = region ? Number(region.rune_tier || 0) : 0;
  r.egg_tier = region ? Number(region.egg_tier || 0) : 0;
  return { score, quality, rewards: r, events: happened, eval: ev };
}

/* Lesbare Texte fuer Bedingungen/Empfehlungen (Vorschau im Spiel). */
function bkmpExpeditionRequirementLines(mission) {
  const req = (mission && mission.requirements) || {};
  const lines = [];
  const aff = a => (BKMP_AFFINITY_META[a] ? BKMP_AFFINITY_META[a].icon + ' ' + BKMP_AFFINITY_META[a].label : a);
  const rar = r => BKMP_EXPEDITION_RARITY_LABELS[r] || r;
  if (req.affinity_min) Object.keys(req.affinity_min).forEach(a => lines.push({ key: 'affinity_min:' + a, text: `mindestens ${req.affinity_min[a]}× ${aff(a)}` }));
  if (req.distinct_affinities_min != null) lines.push({ key: 'distinct_affinities_min', text: `mindestens ${req.distinct_affinities_min} verschiedene Elemente` });
  if (req.distinct_species_min != null) lines.push({ key: 'distinct_species_min', text: `${req.distinct_species_min} verschiedene Drachenarten` });
  if (req.rarity_min) Object.keys(req.rarity_min).forEach(r => lines.push({ key: 'rarity_min:' + r, text: `mindestens ${req.rarity_min[r]}× ${rar(r)}` }));
  if (req.rarity_max) Object.keys(req.rarity_max).forEach(r => lines.push({ key: 'rarity_max:' + r, text: `höchstens ${req.rarity_max[r]}× ${rar(r)}` }));
  return lines;
}
function bkmpExpeditionRecommendationText(rec, traitLabels) {
  const aff = a => (BKMP_AFFINITY_META[a] ? BKMP_AFFINITY_META[a].icon + ' ' + BKMP_AFFINITY_META[a].label : a);
  if (rec.type === 'affinity') return `${aff(rec.value)} bevorzugt`;
  if (rec.type === 'affinity_count') return `${rec.count || 1}× ${aff(rec.value)}`;
  if (rec.type === 'distinct_affinities') return `${rec.value} verschiedene Elemente`;
  if (rec.type === 'distinct_species') return `${rec.value} verschiedene Arten`;
  if (rec.type === 'rarity') return `ein ${BKMP_EXPEDITION_RARITY_LABELS[rec.value] || rec.value}er Drache`;
  if (rec.type === 'trait') return `Eigenschaft „${(traitLabels && traitLabels[rec.value]) || rec.value}“`;
  if (rec.type === 'bond') return `Bindung ${rec.value}+`;
  return rec.type;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BKMP_DRAGON_BOND_THRESHOLDS, BKMP_AFFINITY_META, BKMP_EXPEDITION_QUALITY, BKMP_DRAGON_TRAIT_IDS,
    bkmpExpeditionTraitStrength, bkmpExpeditionRollRange, bkmpExpeditionRoll, bkmpExpeditionOutcome,
    bkmpDragonBondLevel, bkmpExpeditionQuality, bkmpExpeditionQualityMult, bkmpExpeditionTeamEval,
    bkmpExpeditionRequirementLines, bkmpExpeditionRecommendationText
  };
}
