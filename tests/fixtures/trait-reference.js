/* Drachendorf-Ausbau Phase 4 (04.10.2026): Eigenschaften-Katalog direkt aus
   sql/20261004-04-dragon-traits-bond.sql gelesen - keine zweite Kopie, die
   auseinanderlaufen koennte. */
const path = require('path');
const { readInsertTuples } = require('../helpers/sql-catalog-parser');

const DRAGON_TRAITS = readInsertTuples(path.join(__dirname, '../../sql/20261004-04-dragon-traits-bond.sql'), 'dragon_traits')
  .map(f => ({ id: f[0], name: f[1], icon: f[2], description: f[3], sort_order: Number(f[4]) }));

function cloneTraitReferenceTables() {
  return { dragon_traits: DRAGON_TRAITS.map(t => ({ ...t })) };
}

module.exports = { DRAGON_TRAITS, cloneTraitReferenceTables };
