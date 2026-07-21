/* Generic subset of the PostgREST query language that supabase-js actually
   emits from this codebase's .from(table).select()/.eq()/.order()/.limit()/
   .insert()/.update()/.upsert() calls: eq/neq/gt/gte/lt/lte/in/is filters,
   select projection, (possibly repeated) order, limit/offset, plain insert,
   update-by-filter, and upsert via `Prefer: resolution=merge-duplicates` +
   `on_conflict=`. Deliberately schema-agnostic (works on any table name) -
   real per-table SQL semantics (constraints, triggers, RLS) are NOT
   reproduced; only the shapes this app's own supabase-js calls rely on. */

const { table: getTable } = require('./store');

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

function matchFilter(rowValue, op, raw) {
  switch (op) {
    case 'eq': return valuesEqual(rowValue, coerce(raw));
    case 'neq': return !valuesEqual(rowValue, coerce(raw));
    case 'gt': return Number(rowValue) > Number(raw);
    case 'gte': return Number(rowValue) >= Number(raw);
    case 'lt': return Number(rowValue) < Number(raw);
    case 'lte': return Number(rowValue) <= Number(raw);
    case 'is': return raw === 'null' ? (rowValue === null || rowValue === undefined) : valuesEqual(rowValue, coerce(raw));
    case 'in': {
      const list = raw.replace(/^\(|\)$/g, '').split(',').map(coerce);
      return list.some(v => valuesEqual(rowValue, v));
    }
    default: return true;
  }
}

const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function applyFilters(rows, searchParams) {
  const filters = [];
  for (const [key, value] of searchParams.entries()) {
    if (RESERVED_PARAMS.has(key)) continue;
    const dot = value.indexOf('.');
    const op = dot >= 0 ? value.slice(0, dot) : 'eq';
    const raw = dot >= 0 ? value.slice(dot + 1) : value;
    filters.push({ key, op, raw });
  }
  if (!filters.length) return rows;
  return rows.filter(row => filters.every(f => matchFilter(row[f.key], f.op, f.raw)));
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

function applySelect(rows, searchParams) {
  const select = searchParams.get('select');
  if (!select || select === '*') return rows;
  const cols = select.split(',').map(c => c.trim());
  return rows.map(row => {
    const out = {};
    cols.forEach(c => { out[c] = row[c]; });
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

function handleRestRequest(store, { method, tableName, searchParams, body, headers }) {
  const rows = getTable(store, tableName);
  const prefer = String(headers && headers['prefer'] || headers && headers['Prefer'] || '');

  if (method === 'GET') {
    let result = applyFilters(rows, searchParams);
    result = applyOrder(result, searchParams);
    result = applyLimitOffset(result, searchParams);
    result = applySelect(result, searchParams);
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
    return { status: 201, json: applySelect(affected, searchParams) };
  }

  if (method === 'PATCH') {
    const matches = applyFilters(rows, searchParams);
    matches.forEach(row => Object.assign(row, body));
    return { status: 200, json: applySelect(matches, searchParams) };
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
