/* Generic subset of the PostgREST query language that supabase-js actually
   emits from this codebase's .from(table).select()/.eq()/.order()/.limit()/
   .insert()/.update()/.upsert() calls: eq/neq/gt/gte/lt/lte/in/is filters,
   select projection, (possibly repeated) order, limit/offset, plain insert,
   update-by-filter, and upsert via `Prefer: resolution=merge-duplicates` +
   `on_conflict=`. Deliberately schema-agnostic (works on any table name) -
   real per-table SQL semantics (constraints, triggers, RLS) are NOT
   reproduced; only the shapes this app's own supabase-js calls rely on. */

const { table: getTable } = require('./store');
const { applyIdlePlayerStateAntiCheatGuard } = require('./anticheat-guard');

function coerce(raw) {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function valuesEqual(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  // eslint-disable-next-line eqeqeq
  return a == b || String(a) === String(b);
}

/* gt/gte/lt/lte muessen sowohl echte Zahlenspalten (level, gold, ...) als
   auch Zeitstempel-Spalten (occurred_at, created_at, ...) vergleichen
   koennen - reine Number()-Umwandlung ergibt bei ISO-Datums-Strings immer
   NaN (NaN >= NaN ist immer false), wodurch jeder .gte()/.lt()-Filter auf
   eine Zeitstempel-Spalte bisher stillschweigend NICHTS traf, egal welcher
   Wert. Gefunden beim Bauen eines neuen, echten Zeitraum-Filters
   (bkmpArenaGetAttacksTodayCount, 29.07.2026) - betraf latent auch die
   bereits bestehende Update-Dedup-Abfrage in supabase.js (Zeile ~1163),
   dort bisher offenbar nie von einem Test durchlaufen. Erst Zahlen
   versuchen, dann Datums-Parsing, sonst String-Vergleich als letzter
   Rueckfall. */
function compareForRange(rowValue, raw) {
  const numA = Number(rowValue), numB = Number(raw);
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
  const dateA = Date.parse(rowValue), dateB = Date.parse(raw);
  if (!Number.isNaN(dateA) && !Number.isNaN(dateB)) return dateA - dateB;
  return rowValue > raw ? 1 : rowValue < raw ? -1 : 0;
}

function matchFilter(rowValue, op, raw) {
  switch (op) {
    case 'eq': return valuesEqual(rowValue, coerce(raw));
    case 'neq': return !valuesEqual(rowValue, coerce(raw));
    case 'gt': return compareForRange(rowValue, raw) > 0;
    case 'gte': return compareForRange(rowValue, raw) >= 0;
    case 'lt': return compareForRange(rowValue, raw) < 0;
    case 'lte': return compareForRange(rowValue, raw) <= 0;
    case 'is': return raw === 'null' ? (rowValue === null || rowValue === undefined) : valuesEqual(rowValue, coerce(raw));
    case 'in': {
      const list = raw.replace(/^\(|\)$/g, '').split(',').map(coerce);
      return list.some(v => valuesEqual(rowValue, v));
    }
    default: return true;
  }
}

const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

/* .or('a.eq.1,b.eq.2') (PostgREST: or=(a.eq.1,b.eq.2)) wurde bisher WIE EIN
   NORMALER SPALTENFILTER behandelt ("or" existiert auf keiner Zeile als
   Spalte, matchFilter() faellt fuer den daraus falsch geparsten
   "op" immer auf den default-Zweig "return true" zurueck) - jeder .or()-
   Aufruf war dadurch faktisch wirkungslos (liess ausnahmslos ALLE Zeilen
   durch), nicht nur bei einzelnen Faellen. Gefunden beim Bau der Clan-Arena
   (30.07.2026, bkmpGuildArenaGetRecentBattles nutzt exakt dasselbe
   .or()-Muster wie das schon laenger bestehende bkmpArenaGetRecentBattles) -
   dort waere der Fehler durch mehrere gleichzeitig kaempfende Gilden im
   selben Test sofort sichtbar geworden, beim Spieler-Pendant bisher nie,
   weil die bestehenden Tests zufaellig nie fremde, nicht zum Spieler
   gehoerende Kaempfe im selben Store hatten. */
function parseOrConditions(raw) {
  const inner = raw.replace(/^\(|\)$/g, '');
  return inner.split(',').map(part => {
    const firstDot = part.indexOf('.');
    const key = part.slice(0, firstDot);
    const rest = part.slice(firstDot + 1);
    const secondDot = rest.indexOf('.');
    const op = secondDot >= 0 ? rest.slice(0, secondDot) : 'eq';
    const val = secondDot >= 0 ? rest.slice(secondDot + 1) : rest;
    return { key, op, val };
  }).filter(c => c.key);
}

function applyFilters(rows, searchParams) {
  const filters = [];
  let orConditions = null;
  for (const [key, value] of searchParams.entries()) {
    if (RESERVED_PARAMS.has(key)) continue;
    if (key === 'or') { orConditions = parseOrConditions(value); continue; }
    const dot = value.indexOf('.');
    const op = dot >= 0 ? value.slice(0, dot) : 'eq';
    const raw = dot >= 0 ? value.slice(dot + 1) : value;
    filters.push({ key, op, raw });
  }
  if (!filters.length && !orConditions) return rows;
  return rows.filter(row => {
    if (!filters.every(f => matchFilter(row[f.key], f.op, f.raw))) return false;
    if (orConditions && !orConditions.some(c => matchFilter(row[c.key], c.op, c.val))) return false;
    return true;
  });
}

function applyOrder(rows, searchParams) {
  const orderSpecs = [];
  searchParams.getAll('order').forEach(val => {
    val.split(',').forEach(part => {
      const [col, dir] = part.split('.');
      if (col) orderSpecs.push({ col, ascending: dir !== 'desc' });
    });
  });
  if (!orderSpecs.length) return rows;
  const sorted = rows.slice();
  sorted.sort((a, b) => {
    for (const spec of orderSpecs) {
      const av = a[spec.col];
      const bv = b[spec.col];
      if (av === bv) continue;
      const cmp = av > bv ? 1 : -1;
      return spec.ascending ? cmp : -cmp;
    }
    return 0;
  });
  return sorted;
}

/* Phase 4 (24.07.2026, siehe CLAUDE.md) - Raid/Weltboss + Gildenboss
   brauchen als ERSTE Tabellen in dieser Suite PostgREST's eingebettete
   Fremdtabellen-Syntax (supabase.js: loadRaidState()/loadGuildBossInstance()
   lesen z.B. "..., raid_bosses(name, sprite_key, gold_reward, ...)" auf
   raid_instances, um den Bossnamen/die Beloehnung mitzuladen, statt eines
   zweiten Requests). Bisher schnitt applySelect() das select-Argument naiv
   an JEDEM Komma - haette "raid_bosses(name, sprite_key, ...)" mitten in
   der Klammer zerrissen und garantiert falsche/leere Spalten geliefert.
   Ohne echte FK-Metadaten (dieser Mock kennt keine echten Constraints) wird
   die Fremdschluessel-Beziehung hier bewusst eng/explizit aufgelistet statt
   generisch "erraten" - deckt exakt die zwei tatsaechlich im Code
   verwendeten Einbettungen ab, kein genereller PostgREST-Join-Parser. */
const EMBED_FK_MAP = {
  raid_instances: { raid_bosses: { fk: 'boss_id', pk: 'id' } },
  guild_boss_instances: { guild_bosses: { fk: 'boss_id', pk: 'id' } }
};

// Comma-Split, das Klammer-Inhalte (eingebettete Tabellen) nicht aufbricht.
function splitSelectTopLevel(select) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; }
    else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function applySelect(rows, searchParams, tableName, store) {
  const select = searchParams.get('select');
  if (!select || select === '*') return rows;
  const parts = splitSelectTopLevel(select);
  const plainCols = [];
  const embeds = [];
  parts.forEach(part => {
    const m = /^(\w+)\(([^)]*)\)$/.exec(part);
    if (m) embeds.push({ embedTable: m[1], cols: m[2].split(',').map(c => c.trim()).filter(Boolean) });
    else plainCols.push(part);
  });
  const embedDefs = embeds.map(e => {
    const rel = EMBED_FK_MAP[tableName] && EMBED_FK_MAP[tableName][e.embedTable];
    return { ...e, rel, embedRows: rel && store ? getTable(store, e.embedTable) : [] };
  });
  return rows.map(row => {
    const out = {};
    plainCols.forEach(c => { out[c] = row[c]; });
    embedDefs.forEach(({ embedTable, cols, rel, embedRows }) => {
      if (!rel) { out[embedTable] = null; return; }
      const match = embedRows.find(r => r[rel.pk] === row[rel.fk]);
      if (!match) { out[embedTable] = null; return; }
      const picked = {};
      cols.forEach(c => { picked[c] = match[c]; });
      out[embedTable] = picked;
    });
    return out;
  });
}

function applyLimitOffset(rows, searchParams) {
  const offset = Number(searchParams.get('offset') || 0);
  const limit = searchParams.has('limit') ? Number(searchParams.get('limit')) : null;
  const sliced = offset ? rows.slice(offset) : rows;
  return limit != null ? sliced.slice(0, limit) : sliced;
}

function findConflictMatch(rows, incoming, conflictCols) {
  return rows.find(row => conflictCols.every(col => valuesEqual(row[col], incoming[col])));
}

/* Nachbau der Postgres-VIEW public.idle_player_state_leaderboard (siehe
   sql/20260811-leaderboard-hide-decouple-from-flags.sql) - blendet NUR noch
   manuell ausgeblendete Accounts (idle_leaderboard_hidden_accounts) aus,
   NICHT mehr automatisch jeden Account mit einem undismissed Anti-Cheat-
   Alarm (das war der am 11.08.2026 gemeldete Falsch-Alarm-Bug: 33 von 217
   echten Accounts wurden dadurch faelschlich unsichtbar). Nur GET wird
   nachgebaut (die echte View ist read-only) - reine Read-Time-Filterung
   ueber idle_player_state, keine eigene Zeilen-Tabelle im Store. */
function computeLeaderboardViewRows(store) {
  const playerRows = getTable(store, 'idle_player_state');
  const hiddenNames = new Set(getTable(store, 'idle_leaderboard_hidden_accounts').map(r => r.name_key));
  return playerRows
    .filter(r => !hiddenNames.has(r.name_key))
    .map(r => ({
      name_key: r.name_key, display_name: r.display_name, level: r.level,
      total_gold_earned: r.total_gold_earned, dragon_kills: r.dragon_kills,
      playtime_seconds: r.playtime_seconds, highest_dragon_index: r.highest_dragon_index,
      prestige_stage_offset: r.prestige_stage_offset, turm_highest_wave: r.turm_highest_wave
    }));
}

function handleRestRequest(store, { method, tableName, searchParams, body, headers }) {
  if (tableName === 'idle_player_state_leaderboard' && method === 'GET') {
    let result = applyFilters(computeLeaderboardViewRows(store), searchParams);
    result = applyOrder(result, searchParams);
    result = applyLimitOffset(result, searchParams);
    return { status: 200, json: result };
  }
  const rows = getTable(store, tableName);
  const prefer = String(headers && headers['prefer'] || headers && headers['Prefer'] || '');

  if (method === 'GET') {
    let result = applyFilters(rows, searchParams);
    result = applyOrder(result, searchParams);
    result = applyLimitOffset(result, searchParams);
    result = applySelect(result, searchParams, tableName, store);
    return { status: 200, json: result };
  }

  if (method === 'POST') {
    const incomingList = Array.isArray(body) ? body : [body];
    const isUpsert = prefer.includes('resolution=merge-duplicates') || searchParams.has('on_conflict');
    const conflictCols = (searchParams.get('on_conflict') || '').split(',').map(s => s.trim()).filter(Boolean);
    const affected = [];
    incomingList.forEach(incoming => {
      let existing = isUpsert && conflictCols.length ? findConflictMatch(rows, incoming, conflictCols) : null;
      if (existing) {
        Object.assign(existing, incoming);
        affected.push(existing);
      } else {
        const row = { id: incoming.id != null ? incoming.id : store.nextId(), ...incoming };
        rows.push(row);
        affected.push(row);
      }
    });
    return { status: 201, json: applySelect(affected, searchParams, tableName, store) };
  }

  if (method === 'PATCH') {
    const matches = applyFilters(rows, searchParams);
    matches.forEach(row => {
      let patchBody = body;
      /* Anti-Cheat-Tempo-Guard (30.07.2026) - Nachbau des Postgres-Triggers
         idle_player_state_anticheat_guard(), siehe anticheat-guard.js fuer
         die volle Begruendung. Nur fuer diese eine Tabelle gescoped, alle
         anderen PATCH-Ziele bleiben unveraendert. */
      if (tableName === 'idle_player_state') {
        const guard = applyIdlePlayerStateAntiCheatGuard(row, body, store.clock.nowMs());
        patchBody = guard.body;
        if (guard.flagged) {
          /* Sicherheitsnetz (11.08.2026, siehe sql/20260811-anticheat-guard-
             flag-insert-safety-net.sql fuer die volle Begruendung - Spieler
             "OPShadowWolf" konnte nach dem Deploy der Absolute-Ceiling-
             Aenderung gar nicht mehr speichern, weil ein Fehler beim
             Protokollieren des Alarms die GESAMTE Speicherung mitgerissen
             hat): ein Fehler beim reinen Protokollieren darf NIE die
             eigentliche, bereits gekappte Speicherung blockieren - gleiches
             Prinzip wie im echten SQL-Trigger, hier per try/catch statt
             BEGIN/EXCEPTION nachgebaut. */
          try {
            getTable(store, 'idle_anticheat_flags').push({
              id: store.nextId(),
              name_key: row.name_key,
              flagged_at: store.clock.nowIso(),
              claimed_dragon_kills_delta: guard.claimedKillsDelta,
              allowed_dragon_kills_delta: guard.maxKillsDelta,
              elapsed_seconds: guard.elapsedSeconds,
              ratio_applied: guard.ratio,
              triggered_by: guard.triggeredBy,
              claimed_level_delta: guard.claimedLevelDelta,
              allowed_level_delta: guard.maxLevelDelta,
              claimed_skillpoints_delta: guard.claimedSkillpointsDelta,
              allowed_skillpoints_delta: guard.maxSkillpointsDelta,
              combat_stat_details: guard.combatStatDetails
            });
          } catch (e) { /* siehe Kommentar oben - Protokollierungsfehler duerfen die Speicherung nie blockieren */ }
        }
      }
      Object.assign(row, patchBody);
    });
    return { status: 200, json: applySelect(matches, searchParams, tableName, store) };
  }

  if (method === 'DELETE') {
    const matches = applyFilters(rows, searchParams);
    const matchSet = new Set(matches);
    store.tables[tableName] = rows.filter(r => !matchSet.has(r));
    return { status: 200, json: matches };
  }

  return { status: 405, json: { error: 'method_not_allowed' } };
}

module.exports = { handleRestRequest };
