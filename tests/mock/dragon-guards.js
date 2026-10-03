/* Nachbau der player_dragons-Trigger aus
   sql/20261004-01-drachendorf-grundlage.sql (player_dragons_protect_trusted)
   und sql/20261004-03-expeditions.sql (player_dragons_guard_expedition) fuer
   direkte REST-Schreibzugriffe des Spiels. Serverseitige RPC-Nachbauten in
   rpc-engine.js schreiben die geschuetzten Felder direkt (= "trusted"). */
const { table: getTable } = require('./store');

const TRUSTED_FIELDS = ['trait', 'bond_xp', 'companion_seconds', 'companion_kills', 'companion_boss_kills',
  'expeditions_completed', 'divine_offering_gold', 'divine_multiplier', 'awakened_at', 'origin_event'];

function dragonOnRunningExpedition(store, dragonId) {
  return getTable(store, 'player_expeditions').some(e => e.status === 'running' && (e.dragon_ids || []).includes(dragonId));
}

/* Liefert den bereinigten Patch oder wirft { guardError }. */
function guardPlayerDragonPatch(store, row, patch) {
  const clean = { ...patch };
  TRUSTED_FIELDS.forEach(f => { if (f in clean) delete clean[f]; });
  delete clean.species_id;
  if (row.stage === 'divine' && 'stage' in clean) clean.stage = 'divine';
  else if (clean.stage === 'divine') delete clean.stage;
  if (clean.is_companion === true && !row.is_companion && dragonOnRunningExpedition(store, row.id)) {
    const err = new Error('dragon_on_expedition'); err.guardError = true; throw err;
  }
  return clean;
}
function guardPlayerDragonDelete(store, row) {
  if (dragonOnRunningExpedition(store, row.id)) {
    const err = new Error('dragon_on_expedition'); err.guardError = true; throw err;
  }
}
function guardPlayerDragonInsert(incoming) {
  const row = { ...incoming };
  TRUSTED_FIELDS.forEach(f => { delete row[f]; });
  if (row.stage === 'divine') row.stage = 'adult';
  return row;
}

module.exports = { guardPlayerDragonPatch, guardPlayerDragonDelete, guardPlayerDragonInsert, dragonOnRunningExpedition, TRUSTED_FIELDS };
