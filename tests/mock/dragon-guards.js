/* Nachbau der player_dragons-Trigger aus
   sql/20261004-01-drachendorf-grundlage.sql (player_dragons_protect_trusted)
   und sql/20261004-03-expeditions.sql (player_dragons_guard_expedition) fuer
   direkte REST-Schreibzugriffe des Spiels. Serverseitige RPC-Nachbauten in
   rpc-engine.js schreiben die geschuetzten Felder direkt (= "trusted"). */
const { table: getTable } = require('./store');

const TRUSTED_FIELDS = ['trait', 'bond_xp', 'companion_seconds', 'companion_kills', 'companion_boss_kills',
  'expeditions_completed', 'divine_offering_gold', 'divine_offering_units', 'divine_multiplier', 'awakened_at', 'origin_event'];

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

/* Nachbau von player_dragon_eggs_event_guard + player_dragons_unique_guard
   (sql/20261004-08-lightnix-darknix.sql): Event-/Einzelstueck-Eier nie aus
   dem Spiel, Einzelstueck-Drachen nur aus eigenem Ei und hoechstens einer. */
function guardError(msg) { const err = new Error(msg); err.guardError = true; return err; }
function speciesOf(store, id) { return getTable(store, 'dragon_species').find(s => s.id === id) || null; }
function guardEventEggInsert(store, incoming) {
  const sp = speciesOf(store, incoming.species_id);
  if (sp && (sp.unique_per_account || sp.event_origin)) throw guardError('event_species_egg_not_allowed');
}
function guardUniqueDragonInsert(store, row) {
  const sp = speciesOf(store, row.species_id);
  if (!sp || !sp.unique_per_account) return row;
  const dragons = getTable(store, 'player_dragons');
  if (dragons.some(d => d.auth_user_id === row.auth_user_id && d.species_id === row.species_id)) throw guardError('unique_species_already_owned');
  if (!getTable(store, 'player_dragon_eggs').some(e => e.auth_user_id === row.auth_user_id && e.species_id === row.species_id)) {
    throw guardError('unique_species_needs_egg');
  }
  return { ...row, origin_event: sp.event_origin || null };
}

module.exports = { guardPlayerDragonPatch, guardPlayerDragonDelete, guardPlayerDragonInsert, guardEventEggInsert, guardUniqueDragonInsert, dragonOnRunningExpedition, TRUSTED_FIELDS };
