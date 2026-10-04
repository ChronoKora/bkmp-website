/* Drachendorf-Ausbau Phase 8 (04.10.2026): Event-Daten fuer die lokale
   Testumgebung - direkt aus sql/20261004-07-zwielicht-event.sql gelesen
   (kein zweiter, auseinanderlaufender Katalog). Die Konfiguration steht dort
   als JSON zwischen $cfg$-Markierungen. */
const fs = require('fs');
const path = require('path');

const SQL_FILE = path.join(__dirname, '..', '..', 'sql', '20261004-07-zwielicht-event.sql');

function readZwielichtConfig() {
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  // Start = Markierung direkt vor "{", Ende = "}" direkt vor der Markierung
  // (der Kopfkommentar erwaehnt die Markierung ebenfalls).
  const marker = '$' + 'cfg' + '$';
  const a = sql.indexOf(marker + '{');
  const b = sql.indexOf('}' + marker, a);
  if (a < 0 || b < 0) throw new Error('Zwielicht-Konfiguration nicht gefunden');
  return JSON.parse(sql.slice(a + marker.length, b + 1));
}

const ZWIELICHT_CONFIG = readZwielichtConfig();

/* Event-Zeile wie in der SQL (enabled=false, ohne Termine) - Tests setzen
   Termine/Schalter selbst (wie special_event_schedule()). */
function makeZwielichtEventRow(overrides) {
  return {
    id: 'zwielicht',
    name: '☀️🌑 Das Erwachen des Zwielichts',
    subtitle: 'Licht gegen Dunkelheit – eine siebentägige Prüfung',
    description: 'Sieben Tage, 30 Stufen, tägliche Prüfungen und große Wochenquests. Wer Stufe 30 erreicht, wählt seinen Weg: ☀️ Lightnix oder 🌑 Darknix.',
    lore: '',
    announce_at: null, starts_at: null, ends_at: null, timezone: 'Europe/Berlin',
    enabled: false, archived: false, tier_count: 30, points_per_tier: 100,
    config: JSON.parse(JSON.stringify(ZWIELICHT_CONFIG)),
    reward_group: 'zwielicht', lifetime_claim_limit: 1, choice_mode: 'player_choice',
    reward_species: ['lightnix', 'darknix'], assets: {},
    ...(overrides || {})
  };
}

/* Montag 00:00 Berlin als ISO (Winter-/Sommerzeit korrekt). */
function berlinMidnightIso(dateStr) {
  // Startpunkt 00:00 UTC, dann so lange verschieben, bis Berlin 00:00 zeigt.
  const base = Date.parse(dateStr + 'T00:00:00Z');
  for (const off of [-1, -2, 0]) {
    const t = base + off * 3600 * 1000;
    const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));
    if (s === '00:00') return new Date(t).toISOString();
  }
  throw new Error('Berlin-Mitternacht nicht bestimmbar: ' + dateStr);
}
/* Termine wie special_event_schedule(monday, teaserDays). */
function scheduleFor(mondayStr, teaserDays) {
  const d = n => {
    const t = new Date(Date.parse(mondayStr + 'T12:00:00Z') + n * 864e5);
    return t.toISOString().slice(0, 10);
  };
  const starts = berlinMidnightIso(mondayStr);
  const ends = new Date(Date.parse(berlinMidnightIso(d(7))) - 60 * 1000).toISOString();
  return { announce_at: berlinMidnightIso(d(-(teaserDays == null ? 3 : teaserDays))), starts_at: starts, ends_at: ends, enabled: true, archived: false };
}

/* Lightnix/Darknix-Arten aus sql/20261004-08-lightnix-darknix.sql:
   Grundzeile aus dem insert, Zusatzfelder (Affinitaet, fuenfte Form,
   Aura, Erweckungs-Konfiguration) aus den beiden update-Anweisungen. */
const SPECIES_SQL_FILE = path.join(__dirname, '..', '..', 'sql', '20261004-08-lightnix-darknix.sql');
function readEventSpecies() {
  const { readInsertTuples } = require('../helpers/sql-catalog-parser');
  const sql = fs.readFileSync(SPECIES_SQL_FILE, 'utf8');
  const cols = ['id', 'name', 'rarity', 'egg_source', 'source_dragon_id', 'egg_drop_chance', 'brood_seconds',
    'sacrifice_gold', 'sacrifice_crystals', 'growth_points_required', 'battle_xp_required', 'is_multi_stat',
    'sub_stat_count_min', 'sub_stat_count_max', 'egg_image', 'baby_image', 'teen_image', 'adult_image', 'sort_order'];
  const num = new Set(['egg_drop_chance', 'brood_seconds', 'sacrifice_gold', 'sacrifice_crystals', 'growth_points_required',
    'battle_xp_required', 'sub_stat_count_min', 'sub_stat_count_max', 'sort_order']);
  return readInsertTuples(SPECIES_SQL_FILE, 'dragon_species').map(t => {
    const row = { active: true };
    cols.forEach((c, i) => {
      const v = t[i];
      row[c] = v === 'null' ? null : num.has(c) ? Number(v) : c === 'is_multi_stat' ? v === 'true' : v;
    });
    const start = sql.indexOf('update public.dragon_species set');
    const block = sql.slice(start).split(/update public\.dragon_species set/).find(b => b.includes(`where id = '${row.id}'`));
    if (!block) throw new Error('update-Block fehlt fuer ' + row.id);
    const json = key => JSON.parse(block.match(new RegExp(key + " = '([\\s\\S]*?)'::jsonb"))[1]);
    const str = key => block.match(new RegExp(key + " = '([^']*)'"))[1];
    row.affinities = block.match(/affinities = array\[([^\]]*)\]/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
    row.stage_count = Number(block.match(/stage_count = (\d+)/)[1]);
    row.final_stage_key = str('final_stage_key');
    row.final_stage_label = str('final_stage_label');
    row.divine_image = str('divine_image');
    row.event_origin = str('event_origin');
    row.unique_per_account = /unique_per_account = true/.test(block);
    row.reward_group = str('reward_group');
    row.special_passive = json('special_passive');
    row.divine_config = json('divine_config');
    return row;
  });
}
const EVENT_SPECIES = readEventSpecies();

/* Garantierte Pass-Eier (reward.species_eggs, z.B. Stufe 10 = dayman):
   die echten Arten aus sql/20261003-dragon-species-neue-drachen2.sql -
   gleiche IDs wie spaeter in der Datenbank, keine erfundenen Testarten. */
const PASS_EGG_SPECIES_SQL_FILE = path.join(__dirname, '..', '..', 'sql', '20261003-dragon-species-neue-drachen2.sql');
function readPassEggSpecies() {
  const { readInsertTuples } = require('../helpers/sql-catalog-parser');
  const wanted = new Set();
  (ZWIELICHT_CONFIG.tiers || []).forEach(t => ((t.reward || {}).species_eggs || []).forEach(id => wanted.add(id)));
  const cols = ['id', 'name', 'rarity', 'egg_source', 'source_dragon_id', 'egg_drop_chance', 'brood_seconds',
    'sacrifice_gold', 'sacrifice_crystals', 'growth_points_required', 'battle_xp_required', 'is_multi_stat',
    'sub_stat_count_min', 'sub_stat_count_max', 'egg_image', 'baby_image', 'teen_image', 'adult_image', 'sort_order'];
  const num = new Set(['egg_drop_chance', 'brood_seconds', 'sacrifice_gold', 'sacrifice_crystals', 'growth_points_required',
    'battle_xp_required', 'sub_stat_count_min', 'sub_stat_count_max', 'sort_order']);
  const rows = readInsertTuples(PASS_EGG_SPECIES_SQL_FILE, 'dragon_species').map(t => {
    const row = { active: true, stage_count: 4, unique_per_account: false, event_origin: null };
    cols.forEach((c, i) => {
      const v = t[i];
      row[c] = v === 'null' ? null : num.has(c) ? Number(v) : c === 'is_multi_stat' ? v === 'true' : v;
    });
    return row;
  }).filter(r => wanted.has(r.id));
  if (rows.length !== wanted.size) throw new Error('Pass-Ei-Art fehlt in ' + PASS_EGG_SPECIES_SQL_FILE);
  return rows;
}
const PASS_EGG_SPECIES = readPassEggSpecies();

module.exports = { ZWIELICHT_CONFIG, makeZwielichtEventRow, scheduleFor, berlinMidnightIso, SQL_FILE, EVENT_SPECIES, PASS_EGG_SPECIES };
