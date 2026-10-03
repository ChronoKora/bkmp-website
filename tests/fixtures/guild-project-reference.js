/* Drachendorf-Ausbau Phase 6 (04.10.2026): Gildenprojekt-Katalog direkt aus
   sql/20261004-05-guild-projects.sql gelesen (keine zweite Kopie). */
const path = require('path');
const { readInsertTuples } = require('../helpers/sql-catalog-parser');

const GUILD_PROJECT_DEFS = readInsertTuples(path.join(__dirname, '../../sql/20261004-05-guild-projects.sql'), 'guild_project_defs')
  .map(f => ({ id: f[0], name: f[1], icon: f[2], description: f[3], resource_kinds: f[4].replace(/^array\[|\]$/g, '').split(',').map(x => x.trim().replace(/'/g, '')), sort_order: Number(f[5]) }));

function cloneGuildProjectReferenceTables() {
  return { guild_project_defs: GUILD_PROJECT_DEFS.map(d => ({ ...d, resource_kinds: d.resource_kinds.slice() })) };
}

module.exports = { GUILD_PROJECT_DEFS, cloneGuildProjectReferenceTables };
