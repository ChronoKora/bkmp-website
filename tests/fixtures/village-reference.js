/* Drachendorf-Ausbau Phase 2 (04.10.2026): 1:1-Spiegel der Katalogzeilen aus
   sql/20261004-02-village-projects.sql (village_building_levels,
   village_trade_templates). tests/e2e/village.spec.js vergleicht diese Werte
   automatisch mit der SQL-Datei - eine Abweichung faellt dadurch sofort auf. */

const VILLAGE_BUILDING_LEVELS = [
  { building_id: 'drachenhafen', level: 1, building_name: 'Drachenhafen', icon: '⚓', level_label: 'Drachenhafen I',
    description: 'Ein kleiner Anleger am Dorfrand. Deine erwachsenen Drachen können von hier zu Expeditionen aufbrechen.',
    effects: { expedition_slots: 1, regions: ['fluesterwald', 'glutberge'] }, min_stage: 50,
    cost_gold: 120000, cost_wood: 4000, cost_stone: 4000, cost_crystals: 250, cost_essence: 100, sort_order: 10 },
  { building_id: 'drachenhafen', level: 2, building_name: 'Drachenhafen', icon: '⚓', level_label: 'Drachenhafen II',
    description: 'Ein zweiter Steg und erfahrene Kartenzeichner: zwei Expeditionen gleichzeitig und neue Regionen.',
    effects: { expedition_slots: 2, regions: ['frostklamm', 'endriss'] }, min_stage: 400,
    cost_gold: 5000000, cost_wood: 40000, cost_stone: 40000, cost_crystals: 3000, cost_essence: 1500, sort_order: 11 },
  { building_id: 'drachenhafen', level: 3, building_name: 'Drachenhafen', icon: '⚓', level_label: 'Drachenhafen III',
    description: 'Der große Hafen. Drei Expeditionen gleichzeitig - und der Weg ins Verbotene Drachental ist frei.',
    effects: { expedition_slots: 3, regions: ['verbotenes_tal'] }, min_stage: 1500,
    cost_gold: 60000000, cost_wood: 150000, cost_stone: 150000, cost_crystals: 20000, cost_essence: 10000, sort_order: 12 },
  { building_id: 'handelsposten', level: 1, building_name: 'Handelsposten', icon: '🏪', level_label: 'Handelsposten I',
    description: 'Händler aus den Nachbardörfern tauschen jeden Tag andere Waren. 3 Angebote pro Tag.',
    effects: { offers_per_day: 3 }, min_stage: 100,
    cost_gold: 400000, cost_wood: 10000, cost_stone: 10000, cost_crystals: 500, cost_essence: 250, sort_order: 20 },
  { building_id: 'handelsposten', level: 2, building_name: 'Handelsposten', icon: '🏪', level_label: 'Handelsposten II',
    description: 'Ein größerer Markt: 4 Angebote pro Tag und gelegentlich seltene Waren.',
    effects: { offers_per_day: 4 }, min_stage: 800,
    cost_gold: 15000000, cost_wood: 60000, cost_stone: 60000, cost_crystals: 5000, cost_essence: 2500, sort_order: 21 }
];

const VILLAGE_TRADE_TEMPLATES = [
  { id: 'holz_kristall', label: 'Holz gegen Kristalle', weight: 10, min_handelsposten_level: 1, cost_kind: 'wood', cost_amount: 2000, cost_gold_units: 0, cost2_kind: null, cost2_amount: 0, reward_kind: 'crystals', reward_amount: 60, sort_order: 1 },
  { id: 'stein_essenz', label: 'Stein gegen Essenz', weight: 10, min_handelsposten_level: 1, cost_kind: 'stone', cost_amount: 2000, cost_gold_units: 0, cost2_kind: null, cost2_amount: 0, reward_kind: 'essence', reward_amount: 40, sort_order: 2 },
  { id: 'gold_frucht', label: 'Gold gegen Früchte', weight: 8, min_handelsposten_level: 1, cost_kind: 'gold', cost_amount: 0, cost_gold_units: 900, cost2_kind: null, cost2_amount: 0, reward_kind: 'fruit', reward_amount: 500, sort_order: 3 },
  { id: 'gold_fleisch', label: 'Gold gegen Fleisch', weight: 8, min_handelsposten_level: 1, cost_kind: 'gold', cost_amount: 0, cost_gold_units: 900, cost2_kind: null, cost2_amount: 0, reward_kind: 'meat', reward_amount: 500, sort_order: 4 },
  { id: 'gold_holz', label: 'Gold gegen Holz', weight: 7, min_handelsposten_level: 1, cost_kind: 'gold', cost_amount: 0, cost_gold_units: 600, cost2_kind: null, cost2_amount: 0, reward_kind: 'wood', reward_amount: 1500, sort_order: 5 },
  { id: 'gold_stein', label: 'Gold gegen Stein', weight: 7, min_handelsposten_level: 1, cost_kind: 'gold', cost_amount: 0, cost_gold_units: 600, cost2_kind: null, cost2_amount: 0, reward_kind: 'stone', reward_amount: 1500, sort_order: 6 },
  { id: 'kristall_holz', label: 'Kristalle gegen Holz', weight: 6, min_handelsposten_level: 1, cost_kind: 'crystals', cost_amount: 150, cost_gold_units: 0, cost2_kind: null, cost2_amount: 0, reward_kind: 'wood', reward_amount: 2500, sort_order: 7 },
  { id: 'essenz_stein', label: 'Essenz gegen Stein', weight: 6, min_handelsposten_level: 1, cost_kind: 'essence', cost_amount: 100, cost_gold_units: 0, cost2_kind: null, cost2_amount: 0, reward_kind: 'stone', reward_amount: 2500, sort_order: 8 },
  { id: 'kristall_rune', label: 'Kristalle gegen Rune', weight: 5, min_handelsposten_level: 1, cost_kind: 'crystals', cost_amount: 300, cost_gold_units: 0, cost2_kind: null, cost2_amount: 0, reward_kind: 'rune', reward_amount: 1, sort_order: 9 },
  { id: 'essenz_ei', label: 'Seltenes Drachenei', weight: 2, min_handelsposten_level: 1, cost_kind: 'essence', cost_amount: 250, cost_gold_units: 0, cost2_kind: 'crystals', cost2_amount: 250, reward_kind: 'egg', reward_amount: 1, sort_order: 10 },
  { id: 'gold_kristall', label: 'Gold gegen Kristalle', weight: 5, min_handelsposten_level: 2, cost_kind: 'gold', cost_amount: 0, cost_gold_units: 2400, cost2_kind: null, cost2_amount: 0, reward_kind: 'crystals', reward_amount: 40, sort_order: 11 }
];

function cloneVillageReferenceTables() {
  return {
    village_building_levels: VILLAGE_BUILDING_LEVELS.map(r => ({ ...r, effects: JSON.parse(JSON.stringify(r.effects)) })),
    village_trade_templates: VILLAGE_TRADE_TEMPLATES.map(r => ({ ...r }))
  };
}

module.exports = { VILLAGE_BUILDING_LEVELS, VILLAGE_TRADE_TEMPLATES, cloneVillageReferenceTables };
