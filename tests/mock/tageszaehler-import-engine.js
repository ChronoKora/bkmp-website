/* Nachbau des Tageszaehler-Imports fuer die lokale Testumgebung - das JS-Gegenstueck
   zu sql/20261015-tageszaehler-import.sql und der Ausgaben-Erweiterung
   sql/20261019-tageszaehler-ausgaben.sql:

     tageszaehler_import_preview(p_konto, p_dates)
     tageszaehler_import_apply(p_batch_id, p_snapshot, p_request)

   Postgres ist im Browser-Test nicht verfuegbar. Dass dieser Nachbau dem ECHTEN SQL
   entspricht, beweist tests/e2e/tageszaehler-import-parity.spec.js (gleiche Ablaeufe
   gegen PGlite und gegen diese Datei, gleiche Ergebnisse). Wer die SQL aendert, muss
   diese Datei mitziehen.

   Der Stand-Fingerabdruck ist hier ein anderer Hash als in Postgres - verglichen wird
   nur sein Verhalten (gleich bleiben / sich aendern), nicht der Text. */
const crypto = require('crypto');
const { table: getTable } = require('./store');
const { isAdmin } = require('./event-admin-engine');

const WEBSITE_CATEGORIES = ['Karten', 'Bücher', 'Tränke', 'Elytra', 'Raketen', 'Werkzeug', 'Schmiede Vorlagen', 'Netherite', 'Selbst Verdient', 'Custom'];

function rpcError(message) { const e = new Error(message); e.isRpcError = true; return e; }
function requireAdmin(store, uid) { if (!isAdmin(store, uid)) throw rpcError('not_admin'); }
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
  && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const num = v => (v == null ? null : Number(v));
const cents = v => Math.round(Number(v) * 100);
const nowIso = store => new Date(store.clock && store.clock.now ? store.clock.now() : Date.now()).toISOString();
const kindOf = l => l.kind || 'einnahme';

function lines(store) { return getTable(store, 'tageszaehler_import_lines'); }
function batches(store) { return getTable(store, 'tageszaehler_import_batches'); }
function incomes(store) { return getTable(store, 'incomes'); }
function expenses(store) { return getTable(store, 'expenses'); }

function snapshot(store, konto, dates) {
  const l = lines(store).filter(x => x.konto === konto && dates.includes(x.business_date))
    .sort((a, b) => a.import_key.localeCompare(b.import_key))
    .map(x => [x.import_key, kindOf(x), x.status, x.income_id || '-', x.expense_id || '-', x.website_category, cents(x.amount),
      x.quantity == null ? '-' : num(x.quantity), x.revision_id, x.fingerprint].join('#'));
  const i = incomes(store).filter(x => dates.includes(x.date))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(x => [x.id, x.category, cents(x.amount), x.quantity == null ? '-' : num(x.quantity), x.date, x.note == null ? '-' : x.note].join('#'));
  const e = expenses(store).filter(x => dates.includes(x.date))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(x => [x.id, x.category, cents(x.amount), x.date, x.note == null ? '-' : x.note].join('#'));
  return crypto.createHash('md5').update(l.join('|') + '||' + i.join('|') + '||' + e.join('|')).digest('hex');
}

function incomeJson(row) {
  return row ? { id: row.id, category: row.category, amount: num(row.amount), quantity: num(row.quantity), date: row.date, note: row.note == null ? null : row.note } : null;
}
function expenseJson(row) {
  return row ? { id: row.id, category: row.category, amount: num(row.amount), date: row.date, note: row.note == null ? null : row.note } : null;
}
const byCreated = (a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category)
  || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id));

const HANDLERS = {
  tageszaehler_import_preview(store, uid, params) {
    requireAdmin(store, uid);
    const konto = params.p_konto;
    if (typeof konto !== 'string' || !/^[a-z0-9-]{1,40}$/.test(konto)) throw rpcError('invalid_konto');
    const dates = [...new Set((params.p_dates || []).filter(d => d != null))].sort();
    if (dates.length === 0 || dates.length > 62 || !dates.every(isDate)) throw rpcError('invalid_dates');
    const inc = incomes(store);
    const exp = expenses(store);
    return {
      snapshot: snapshot(store, konto, dates),
      imports: lines(store).filter(x => x.konto === konto && dates.includes(x.business_date))
        .sort((a, b) => a.business_date.localeCompare(b.business_date) || kindOf(a).localeCompare(kindOf(b))
          || a.counter_category_id.localeCompare(b.counter_category_id))
        .map(x => ({
          import_key: x.import_key, kind: kindOf(x), date: x.business_date, counter_category_id: x.counter_category_id,
          counter_category_name: x.counter_category_name, website_category: x.website_category, status: x.status,
          amount: num(x.amount), quantity: num(x.quantity), quantity_status: x.quantity_status, revision_id: x.revision_id,
          revision_created_at: x.revision_created_at, fingerprint: x.fingerprint, imported_at: x.imported_at,
          income_id: x.income_id || null, income: incomeJson(inc.find(i => i.id === x.income_id)),
          expense_id: x.expense_id || null, expense: expenseJson(exp.find(e => e.id === x.expense_id))
        })),
      incomes: inc.filter(i => dates.includes(i.date)).sort(byCreated)
        .map(i => Object.assign(incomeJson(i), { created_at: i.created_at, from_import: lines(store).some(l => l.income_id === i.id) })),
      expenses: exp.filter(e => dates.includes(e.date)).sort(byCreated)
        .map(e => Object.assign(expenseJson(e), { created_at: e.created_at, from_import: lines(store).some(l => l.expense_id === e.id) }))
    };
  },

  tageszaehler_import_apply(store, uid, params) {
    requireAdmin(store, uid);
    const batchId = params.p_batch_id;
    if (!batchId) throw rpcError('invalid_batch');
    const req = params.p_request;
    if (!req || typeof req !== 'object' || Array.isArray(req)) throw rpcError('invalid_request');
    const hash = crypto.createHash('md5').update(JSON.stringify(req)).digest('hex');
    const known = batches(store).find(b => b.batch_id === batchId);
    if (known) {
      if (known.request_hash !== hash) throw rpcError('batch_conflict');
      return Object.assign({}, known.result, { wiederholt: true });
    }
    const konto = req.konto;
    if (typeof konto !== 'string' || !/^[a-z0-9-]{1,40}$/.test(konto)) throw rpcError('invalid_konto');
    const reqLines = req.lines;
    if (!Array.isArray(reqLines) || reqLines.length === 0 || reqLines.length > 2000) throw rpcError('invalid_lines');
    if (!reqLines.every(x => isDate(x && x.date))) throw rpcError('invalid_date');
    const dates = [...new Set(reqLines.map(x => x.date))].sort();
    if (dates.length > 62) throw rpcError('invalid_dates');
    if (snapshot(store, konto, dates) !== params.p_snapshot) throw rpcError('stale_preview');

    // Alles oder nichts: auf Kopien arbeiten, erst am Ende uebernehmen.
    const inc = JSON.parse(JSON.stringify(incomes(store)));
    const exp = JSON.parse(JSON.stringify(expenses(store)));
    const led = JSON.parse(JSON.stringify(lines(store)));
    const keys = [];
    const dayRev = {};
    const out = [];
    const n = { angelegt: 0, aktualisiert: 0, unveraendert: 0, entfernt: 0, uebersprungen: 0, ersetzt_manuell: 0 };
    const at = nowIso(store);

    for (const x of reqLines) {
      const kind = x.kind == null ? 'einnahme' : x.kind;
      const cat = x.counter_category_id;
      const catName = String(x.counter_category_name == null ? '' : x.counter_category_name).trim();
      const action = x.action;
      let qstatus = x.quantity_status;
      const rev = x.revision_id;
      const fp = x.fingerprint;
      if (!['einnahme', 'ausgabe'].includes(kind)) throw rpcError('invalid_kind');
      if (typeof cat !== 'string' || !/^[a-z0-9_]{1,40}$/.test(cat)) throw rpcError('invalid_category');
      if (catName.length === 0 || catName.length > 60) throw rpcError('invalid_category');
      let web;
      if (kind === 'einnahme') {
        web = x.website_category;
        if (!WEBSITE_CATEGORIES.includes(web)) throw rpcError('invalid_website_category');
      } else {
        web = 'Ankauf ' + catName;   // Ausgaben haben auf der Website nur eine Bezeichnung
      }
      if (!['create', 'update', 'remove', 'skip'].includes(action)) throw rpcError('invalid_action');
      if (kind === 'ausgabe' && qstatus == null) qstatus = 'offen';
      if (!['vollstaendig', 'teilweise', 'offen'].includes(qstatus)) throw rpcError('invalid_quantity');
      if (typeof rev !== 'string' || rev.length === 0 || rev.length > 80) throw rpcError('invalid_revision');
      if (typeof fp !== 'string' || !/^[0-9a-f]{64}$/.test(fp)) throw rpcError('invalid_fingerprint');
      const revAt = Date.parse(x.revision_created_at);
      const amountText = String(x.amount);
      if (Number.isNaN(revAt) || !/^-?\d+(\.\d+)?$/.test(amountText)) throw rpcError('invalid_number');
      const amount = Number(amountText);
      const qty = x.quantity == null ? null : Number(x.quantity);
      if (qty != null && Number.isNaN(qty)) throw rpcError('invalid_number');
      if (amount < 0 || amount >= 1e12 || !/^\d+(\.\d{1,2})?0*$/.test(amountText.replace(/^(\d+\.\d{2})0+$/, '$1'))) throw rpcError('invalid_amount');
      if (qty != null && (qty < 0 || !Number.isInteger(qty) || qty >= 1e9)) throw rpcError('invalid_quantity');
      if (qstatus !== 'vollstaendig' && qty != null) throw rpcError('invalid_quantity');
      let detail = null;
      if (kind === 'ausgabe') {
        if (qty != null) throw rpcError('invalid_quantity');
        qstatus = 'offen';
        detail = String(x.note == null ? '' : x.note).trim() || null;
        if (detail != null && detail.length > 300) throw rpcError('invalid_note');
      }

      if (dayRev[x.date]) {
        if (dayRev[x.date][0] !== rev || dayRev[x.date][1] !== fp) throw rpcError('mixed_revisions');
      } else dayRev[x.date] = [rev, fp];

      const key = 'tz1:' + konto + ':' + x.date + ':' + (kind === 'ausgabe' ? 'ausgabe:' : '') + cat;
      if (keys.includes(key)) throw rpcError('duplicate_line');
      keys.push(key);

      const imp = led.find(l => l.import_key === key) || null;
      let linked = null;
      if (imp && kind === 'einnahme' && imp.income_id) linked = inc.find(i => i.id === imp.income_id) || null;
      if (imp && kind === 'ausgabe' && imp.expense_id) linked = exp.find(e => e.id === imp.expense_id) || null;
      if (imp && action !== 'skip' && revAt < Date.parse(imp.revision_created_at)) throw rpcError('older_revision');

      const replaced = [];
      if (Array.isArray(x.replace_income_ids) && x.replace_income_ids.length) {
        if (kind !== 'einnahme' || !['create', 'update'].includes(action)) throw rpcError('invalid_replace');
        for (const rid of x.replace_income_ids) {
          const r = inc.find(i => i.id === rid);
          if (!r || r.date !== x.date || r.category !== web || led.some(l => l.income_id === r.id)) throw rpcError('invalid_replace');
          replaced.push({ id: r.id, category: r.category, amount: num(r.amount), quantity: num(r.quantity), date: r.date, note: r.note == null ? null : r.note, created_at: r.created_at });
          inc.splice(inc.indexOf(r), 1);
          n.ersetzt_manuell++;
        }
      }

      const note = kind === 'ausgabe'
        ? 'Ankauf aus Tageszähler: ' + catName + (detail ? ' – ' + detail : '')
        : 'Netto aus Tageszähler: ' + catName;
      let status = null;
      if (action === 'skip') {
        status = 'uebersprungen'; n.uebersprungen++;
      } else if (action === 'create') {
        if (imp && imp.status === 'aktiv' && linked) throw rpcError('already_imported');
        const id = crypto.randomUUID();
        if (kind === 'ausgabe') exp.push({ id, category: web, amount, date: x.date, note, created_at: at, entered_by_auth_user_id: uid });
        else inc.push({ id, category: web, amount, date: x.date, note, quantity: qty, created_at: at });
        const fields = {
          counter_category_name: catName, website_category: web,
          income_id: kind === 'einnahme' ? id : null, expense_id: kind === 'ausgabe' ? id : null,
          status: 'aktiv', amount, quantity: qty, quantity_status: qstatus, revision_id: rev,
          revision_created_at: x.revision_created_at, fingerprint: fp, last_batch_id: batchId, imported_at: at, imported_by: uid
        };
        if (imp) {
          imp.history = (imp.history || []).concat([{ at, action: 'create', batch: batchId, previous_status: imp.status,
            previous_income_id: imp.income_id || null, previous_expense_id: imp.expense_id || null, previous_amount: num(imp.amount),
            previous_revision: imp.revision_id, replaced }]);
          Object.assign(imp, fields);
        } else {
          led.push(Object.assign({ import_key: key, kind, konto, business_date: x.date, counter_category_id: cat,
            history: [{ at, action: 'create', batch: batchId, replaced }] }, fields));
        }
        status = 'angelegt'; n.angelegt++;
      } else if (action === 'update') {
        if (!imp || imp.status !== 'aktiv' || !linked) throw rpcError('not_imported');
        if (kind === 'ausgabe') {
          const same = imp.revision_id === rev && imp.fingerprint === fp && linked.category === web && cents(linked.amount) === cents(amount);
          if (same) {
            status = 'unveraendert'; n.unveraendert++;
          } else {
            const previous = { amount: num(linked.amount), category: linked.category, note: linked.note == null ? null : linked.note, revision: imp.revision_id, fingerprint: imp.fingerprint };
            Object.assign(linked, { category: web, amount, note });
            imp.history = (imp.history || []).concat([{ at, action: 'update', batch: batchId, previous, replaced }]);
            Object.assign(imp, { counter_category_name: catName, website_category: web, amount, quantity: null, quantity_status: qstatus,
              revision_id: rev, revision_created_at: x.revision_created_at, fingerprint: fp, last_batch_id: batchId, imported_at: at, imported_by: uid });
            status = 'aktualisiert'; n.aktualisiert++;
          }
        } else {
          const same = imp.revision_id === rev && imp.fingerprint === fp && imp.website_category === web && linked.category === web
            && cents(linked.amount) === cents(amount) && (linked.quantity == null ? null : num(linked.quantity)) === qty && replaced.length === 0;
          if (same) {
            status = 'unveraendert'; n.unveraendert++;
          } else {
            const previous = { amount: num(linked.amount), quantity: num(linked.quantity), category: linked.category, revision: imp.revision_id, fingerprint: imp.fingerprint };
            Object.assign(linked, { category: web, amount, quantity: qty, note });
            imp.history = (imp.history || []).concat([{ at, action: 'update', batch: batchId, previous, replaced }]);
            Object.assign(imp, { counter_category_name: catName, website_category: web, amount, quantity: qty, quantity_status: qstatus,
              revision_id: rev, revision_created_at: x.revision_created_at, fingerprint: fp, last_batch_id: batchId, imported_at: at, imported_by: uid });
            status = 'aktualisiert'; n.aktualisiert++;
          }
        }
      } else if (action === 'remove') {
        if (!imp || imp.status !== 'aktiv') throw rpcError('not_imported');
        let previous = null;
        if (linked && kind === 'ausgabe') {
          previous = { id: linked.id, amount: num(linked.amount), category: linked.category, note: linked.note == null ? null : linked.note };
          exp.splice(exp.indexOf(linked), 1);
        } else if (linked) {
          previous = { id: linked.id, amount: num(linked.amount), quantity: num(linked.quantity), category: linked.category, note: linked.note };
          inc.splice(inc.indexOf(linked), 1);
        }
        imp.history = (imp.history || []).concat([{ at, action: 'remove', batch: batchId, previous, previous_revision: imp.revision_id }]);
        Object.assign(imp, { status: 'entfernt', income_id: null, expense_id: null, revision_id: rev, revision_created_at: x.revision_created_at,
          fingerprint: fp, last_batch_id: batchId, imported_at: at, imported_by: uid });
        status = 'entfernt'; n.entfernt++;
      }
      out.push({ import_key: key, kind, date: x.date, counter_category_id: cat, website_category: web, status, amount, quantity: qty, replaced: replaced.length });
    }

    // Uebernehmen (erst jetzt - vorher geworfene Fehler aendern nichts).
    const incTable = incomes(store);
    incTable.splice(0, incTable.length, ...inc);
    const expTable = expenses(store);
    expTable.splice(0, expTable.length, ...exp);
    const ledTable = lines(store);
    ledTable.splice(0, ledTable.length, ...led);

    const activeSum = (d, field, rows) => ledTable.filter(l => l.konto === konto && l.business_date === d && l.status === 'aktiv')
      .reduce((s, l) => { const r = rows.find(row => row.id === l[field]); return s + (r ? cents(r.amount) : 0); }, 0) / 100;
    const result = Object.assign({ batch_id: batchId }, n, {
      lines: out,
      tage: dates.map(d => ({
        date: d,
        import_summe: activeSum(d, 'income_id', incTable),
        einnahmen_summe: incTable.filter(i => i.date === d).reduce((s, i) => s + cents(i.amount), 0) / 100,
        einnahmen_zeilen: incTable.filter(i => i.date === d).length,
        ausgaben_import_summe: activeSum(d, 'expense_id', expTable),
        ausgaben_summe: expTable.filter(e => e.date === d).reduce((s, e) => s + cents(e.amount), 0) / 100,
        ausgaben_zeilen: expTable.filter(e => e.date === d).length
      })),
      snapshot: snapshot(store, konto, dates),
      wiederholt: false
    });
    batches(store).push({ batch_id: batchId, request_hash: hash, created_at: at, created_by: uid, result });
    return result;
  }
};

module.exports = { TAGESZAEHLER_IMPORT_HANDLERS: HANDLERS, WEBSITE_CATEGORIES };
