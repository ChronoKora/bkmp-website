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
  const score = 25 + met.length * 15 + distinctRarity * 5 + distinctAff * 4 + Math.floor((avgBond - 1) * 2);
  return { unmet, met, score };
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
    BKMP_DRAGON_BOND_THRESHOLDS, BKMP_AFFINITY_META, BKMP_EXPEDITION_QUALITY,
    bkmpDragonBondLevel, bkmpExpeditionQuality, bkmpExpeditionQualityMult, bkmpExpeditionTeamEval,
    bkmpExpeditionRequirementLines, bkmpExpeditionRecommendationText
  };
}
