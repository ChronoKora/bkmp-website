/* Tageszaehler-Import (15.10.2026) - Gleichheitsbeweis Nachbau <-> echtes SQL.

   Die Browser-Tests laufen gegen den JS-Nachbau (tests/mock/tageszaehler-import-engine.js).
   Damit er nicht heimlich vom echten SQL abweicht, laeuft hier derselbe Ablauf gegen
   PGlite (sql/20261015-tageszaehler-import.sql) und gegen den Nachbau - Vorschau,
   Anlegen mit Ersetzen, Wiederholung, unveraendert, neue Revision, Entfernen,
   geloeschte Zeile, Fehlerfaelle - und alle Ergebnisse muessen gleich sein.
   Nicht verglichen wird nur der Text des Stand-Fingerabdrucks (anderer Hash).

   Wer die SQL aendert, muss den Nachbau mitziehen - sonst wird dieser Test rot. */
const { test, expect } = require('@playwright/test');
const h = require('../helpers/pg-tageszaehler-import-db');
const { createStore, table: getTable } = require('../mock/store');
const { TAGESZAEHLER_IMPORT_HANDLERS: TWIN } = require('../mock/tageszaehler-import-engine');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Reine Logik-Tests laufen nur einmal (chromium-desktop).');
});

const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ADMIN = { sub: uid(900), email: 'chef@bkmp-admin-accounts.com' };
const KONTO = 'chestshop-hauptkonto';
const REV1 = { revision_id: 'r1', revision_created_at: '2026-10-15T09:35:55Z', fingerprint: 'a'.repeat(64) };
const REV2 = { revision_id: 'r2', revision_created_at: '2026-10-15T12:00:00Z', fingerprint: 'b'.repeat(64) };
const MANUAL = [
  { id: uid(1), category: 'Bücher', amount: 2310000, date: '2026-10-14', quantity: 924, created_at: '2026-10-14T11:03:00Z' },
  { id: uid(2), category: 'Raketen', amount: 32000, date: '2026-10-14', quantity: 32, created_at: '2026-10-14T11:04:00Z' },
  { id: uid(3), category: 'Werkzeug', amount: 75000, date: '2026-10-13', quantity: 1, created_at: '2026-10-14T11:02:00Z' }
];
const L = (date, cat, name, web, amount, extra) => Object.assign({ date, counter_category_id: cat, counter_category_name: name,
  website_category: web, amount, quantity: null, quantity_status: 'offen', action: 'create' }, REV1, extra || {});
// 19.10.2026: Ausgaben (Ankaeufe) - sql/20261019-tageszaehler-ausgaben.sql
const MANUAL_EXP = [{ id: uid(4), category: 'Marketing', amount: 500, date: '2026-10-18', note: 'von Hand', created_at: '2026-10-18T09:00:00Z' }];
const E = (date, cat, name, amount, extra) => Object.assign({ kind: 'ausgabe', date, counter_category_id: cat, counter_category_name: name,
  amount, quantity: null, quantity_status: 'offen', action: 'create' }, REV1, extra || {});

/* ---------- zwei gleich bedienbare Seiten ---------- */
async function sqlSide() {
  const db = await h.createImportDb();
  await h.addAdminProfile(db, { uid: ADMIN.sub, email: ADMIN.email, role: 'admin' });
  for (const m of MANUAL) await h.addIncome(db, m);
  for (const m of MANUAL_EXP) await h.addExpense(db, m);
  return {
    name: 'sql',
    preview: dates => h.rpc(db, ADMIN, 'tageszaehler_import_preview', [KONTO, dates]),
    apply: (batch, snap, lines) => h.rpc(db, ADMIN, 'tageszaehler_import_apply', [batch, snap, JSON.stringify({ konto: KONTO, lines })]),
    deleteIncome: id => h.callAs(db, ADMIN, 'delete from public.incomes where id = $1', [id]),
    addIncome: row => h.addIncome(db, row),
    deleteExpense: id => h.callAs(db, ADMIN, 'delete from public.expenses where id = $1', [id]),
    addExpense: row => h.addExpense(db, row)
  };
}
async function twinSide() {
  const store = createStore(Date.parse('2026-10-15T10:00:00Z'));
  store.authUsersByEmail.set(ADMIN.email, { id: ADMIN.sub, email: ADMIN.email, password: 'x', user_metadata: {} });
  getTable(store, 'admin_profiles').push({ id: 'ap', auth_user_id: ADMIN.sub, login_name: ADMIN.email, role: 'admin', active: true });
  MANUAL.forEach(m => getTable(store, 'incomes').push(Object.assign({ note: null }, m)));
  MANUAL_EXP.forEach(m => getTable(store, 'expenses').push(Object.assign({ note: null }, m)));
  const call = (fn, params) => { try { return Promise.resolve(JSON.parse(JSON.stringify(TWIN[fn](store, ADMIN.sub, params)))); } catch (e) { return Promise.reject(e); } };
  return {
    name: 'twin',
    preview: dates => call('tageszaehler_import_preview', { p_konto: KONTO, p_dates: dates }),
    apply: (batch, snap, lines) => call('tageszaehler_import_apply', { p_batch_id: batch, p_snapshot: snap, p_request: { konto: KONTO, lines } }),
    deleteIncome: id => { const t = getTable(store, 'incomes'); t.splice(t.findIndex(i => i.id === id), 1); return Promise.resolve(); },
    addIncome: row => { getTable(store, 'incomes').push(Object.assign({ id: require('crypto').randomUUID(), note: null, quantity: null, created_at: '2026-10-15T10:30:00Z' }, row)); return Promise.resolve(); },
    deleteExpense: id => { const t = getTable(store, 'expenses'); t.splice(t.findIndex(e => e.id === id), 1); return Promise.resolve(); },
    addExpense: row => { getTable(store, 'expenses').push(Object.assign({ id: require('crypto').randomUUID(), note: null, created_at: '2026-10-18T10:30:00Z' }, row)); return Promise.resolve(); }
  };
}

/* Vergleichsform: Snapshot-Text, Zeitstempel und zufaellige IDs neutralisieren. */
function normalize(v, ids) {
  if (Array.isArray(v)) return v.map(x => normalize(x, ids));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) {
      if (k === 'snapshot' || k === 'imported_at' || k === 'created_at' || k === 'batch_id') continue;
      if (k === 'revision_created_at') { o[k] = Date.parse(v[k]); continue; }
      o[k] = normalize(v[k], ids);
    }
    return o;
  }
  if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)
      && !MANUAL.some(m => m.id === v) && !MANUAL_EXP.some(m => m.id === v)) {
    if (!ids.has(v)) ids.set(v, 'ID' + ids.size);
    return ids.get(v);
  }
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  return v;
}

/* Ein kompletter Ablauf; liefert alle Ergebnisse (bzw. Fehlercodes) in Reihenfolge. */
async function scenario(side) {
  const out = [];
  const ids = new Map();
  const rec = async (label, p) => {
    try { out.push([label, normalize(await p, ids)]); } catch (e) { out.push([label, 'FEHLER ' + (String(e.message).match(/[a-z_]+$/) || [e.message])[0]]); }
  };
  const snap = async dates => (await side.preview(dates)).snapshot;

  await rec('vorschau leer', side.preview(['2026-10-14', '2026-10-13']));
  let s = await snap(['2026-10-14']);
  const first = [
    L('2026-10-14', 'buecher', 'Bücher', 'Bücher', '2286900.00', { quantity: 924, quantity_status: 'vollstaendig', replace_income_ids: [uid(1)] }),
    L('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '43560.00'),
    L('2026-10-14', 'raketen', 'Raketen', 'Raketen', '31681.25', { quantity_status: 'teilweise' })
  ];
  await rec('anlegen', side.apply(uid(100), s, first));
  await rec('wiederholung', side.apply(uid(100), 'egal', first));
  await rec('batch-konflikt', side.apply(uid(100), 'egal', [first[1]]));
  await rec('vorschau nach import', side.preview(['2026-10-14']));
  s = await snap(['2026-10-14']);
  await rec('unveraendert', side.apply(uid(101), s, first.map(x => Object.assign({}, x, { action: 'update', replace_income_ids: undefined }))));
  s = await snap(['2026-10-14']);
  await rec('doppelt anlegen', side.apply(uid(102), s, [first[1]]));
  await rec('veraltet', side.apply(uid(103), 'falscher-stand', [first[1]]));
  s = await snap(['2026-10-14']);
  await rec('neue revision', side.apply(uid(104), s, [
    L('2026-10-14', 'buecher', 'Bücher', 'Bücher', '2289375.00', Object.assign({ quantity: 925, quantity_status: 'vollstaendig', action: 'update' }, REV2)),
    L('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '43560.00', Object.assign({ quantity: 4, quantity_status: 'vollstaendig', action: 'update' }, REV2)),
    L('2026-10-14', 'raketen', 'Raketen', 'Raketen', '0.00', Object.assign({ action: 'remove' }, REV2))
  ]));
  s = await snap(['2026-10-14']);
  await rec('aeltere revision', side.apply(uid(105), s, [L('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '11880.00', { action: 'update' })]));
  const p = await side.preview(['2026-10-14']);
  await side.deleteIncome(p.imports.find(x => x.counter_category_id === 'barren').income_id);
  await rec('vorschau nach loeschen', side.preview(['2026-10-14']));
  s = await snap(['2026-10-14']);
  await rec('erneut anlegen', side.apply(uid(106), s, [L('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '43560.00', Object.assign({ quantity: 4, quantity_status: 'vollstaendig' }, REV2))]));
  // Fehlerfaelle (je genau ein Fehler)
  s = await snap(['2026-10-13']);
  for (const [label, line] of [
    ['3 nachkommastellen', L('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475.001')],
    ['negativ', L('2026-10-13', 'buecher', 'Bücher', 'Bücher', '-1')],
    ['kategorie', L('2026-10-13', 'buecher', 'Bücher', 'Buecher', '2475')],
    ['menge offen', L('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475', { quantity: 1 })],
    ['ersetzen falsch', L('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475', { replace_income_ids: [uid(1)] })],
    ['fingerabdruck', L('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475', { fingerprint: 'x' })],
    ['update ohne import', L('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475', { action: 'update' })]
  ]) {
    await rec(label, side.apply(uid(300 + label.length), s, [line]));
  }
  await rec('zwei revisionen', side.apply(uid(400), s, [L('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475'),
    L('2026-10-13', 'barren', 'Netheritbarren', 'Netherite', '10890', REV2)]));
  await side.addIncome({ category: 'Custom', amount: 500, date: '2026-10-13', note: 'spaeter' });
  await rec('stand geaendert', side.apply(uid(401), s, [L('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475')]));
  await rec('vorschau 13.10.', side.preview(['2026-10-13']));

  // ---- Ausgaben (19.10.2026): Einnahme und Ausgabe derselben Zaehler-Kategorie, von Hand erfasste Ausgabe bleibt ----
  await rec('vorschau 18.10.', side.preview(['2026-10-18']));
  s = await snap(['2026-10-18']);
  const tag18 = [
    L('2026-10-18', 'rohstoffe', 'Rohstoffe & Blöcke', 'Custom', '220725.83'),
    E('2026-10-18', 'rohstoffe', 'Rohstoffe & Blöcke', '268173.22', { note: '11 Artikel, größte: Quarzziegel 189.647,68 $' }),
    E('2026-10-18', 'buecher', 'Bücher', '2475.00')
  ];
  await rec('ausgaben anlegen', side.apply(uid(500), s, tag18));
  await rec('ausgaben wiederholung', side.apply(uid(500), 'egal', tag18));
  await rec('vorschau 18.10. nach import', side.preview(['2026-10-18']));
  s = await snap(['2026-10-18']);
  await rec('ausgaben unveraendert', side.apply(uid(501), s, tag18.map(x => Object.assign({}, x, { action: 'update' }))));
  s = await snap(['2026-10-18']);
  await rec('ausgabe doppelt anlegen', side.apply(uid(502), s, [tag18[1]]));
  await rec('ausgaben neue revision', side.apply(uid(503), s, [
    L('2026-10-18', 'rohstoffe', 'Rohstoffe & Blöcke', 'Custom', '220725.83', Object.assign({ action: 'update' }, REV2)),
    E('2026-10-18', 'rohstoffe', 'Rohstoffe & Blöcke', '268000.00', Object.assign({ action: 'update', note: 'neu gezählt' }, REV2)),
    E('2026-10-18', 'buecher', 'Bücher', '0.00', Object.assign({ action: 'remove' }, REV2))
  ]));
  s = await snap(['2026-10-18']);
  await rec('ausgabe aeltere revision', side.apply(uid(504), s, [E('2026-10-18', 'rohstoffe', 'Rohstoffe & Blöcke', '1.00', { action: 'update' })]));
  const p18 = await side.preview(['2026-10-18']);
  await side.deleteExpense(p18.imports.find(x => x.kind === 'ausgabe' && x.counter_category_id === 'rohstoffe').expense_id);
  await rec('vorschau nach ausgabe loeschen', side.preview(['2026-10-18']));
  s = await snap(['2026-10-18']);
  await rec('ausgabe erneut anlegen', side.apply(uid(505), s, [E('2026-10-18', 'rohstoffe', 'Rohstoffe & Blöcke', '268000.00', REV2)]));
  s = await snap(['2026-10-18']);
  for (const [label, line] of [
    ['kind falsch', E('2026-10-18', 'tranke', 'Tränke', '10', Object.assign({ kind: 'spende' }, REV2))],
    ['ausgabe mit menge', E('2026-10-18', 'traenke', 'Tränke', '10', Object.assign({ quantity: 2, quantity_status: 'vollstaendig' }, REV2))],
    ['ausgabe hinweis zu lang', E('2026-10-18', 'traenke', 'Tränke', '10', Object.assign({ note: 'x'.repeat(301) }, REV2))],
    ['ausgabe ersetzen', E('2026-10-18', 'traenke', 'Tränke', '10', Object.assign({ replace_income_ids: [uid(1)] }, REV2))],
    ['ausgabe negativ', E('2026-10-18', 'traenke', 'Tränke', '-10', REV2)]
  ]) {
    await rec(label, side.apply(uid(600 + label.length), s, [line]));
  }
  await side.addExpense({ category: 'Spende', amount: 50, date: '2026-10-18' });
  await rec('ausgaben stand geaendert', side.apply(uid(700), s, [E('2026-10-18', 'traenke', 'Tränke', '10', REV2)]));
  await rec('vorschau 18.10. ende', side.preview(['2026-10-18']));
  return out;
}

test('Nachbau und echtes SQL liefern im gesamten Ablauf dieselben Ergebnisse', async () => {
  const sql = await scenario(await sqlSide());
  const twin = await scenario(await twinSide());
  expect(twin.map(x => x[0])).toEqual(sql.map(x => x[0]));
  for (let i = 0; i < sql.length; i++) {
    expect(twin[i], 'Schritt „' + sql[i][0] + '“').toEqual(sql[i]);
  }
  // Plausibilitaet: die Fehlerfaelle sind wirklich Fehler, die Erfolgsfaelle keine.
  const byLabel = Object.fromEntries(sql);
  expect(byLabel['stand geaendert']).toBe('FEHLER stale_preview');
  expect(byLabel['aeltere revision']).toBe('FEHLER older_revision');
  expect(byLabel['wiederholung'].wiederholt).toBe(true);
  expect(byLabel['neue revision']).toMatchObject({ aktualisiert: 2, entfernt: 1 });
  // Ausgaben: angelegt, unveraendert, aktualisiert/entfernt, Fehlerfaelle wirklich Fehler.
  expect(byLabel['ausgaben anlegen']).toMatchObject({ angelegt: 3 });
  expect(byLabel['ausgaben anlegen'].tage[0]).toMatchObject({ import_summe: 220725.83, ausgaben_import_summe: 270648.22, ausgaben_summe: 271148.22, ausgaben_zeilen: 3 });
  expect(byLabel['ausgaben wiederholung'].wiederholt).toBe(true);
  expect(byLabel['ausgaben unveraendert']).toMatchObject({ unveraendert: 3 });
  expect(byLabel['ausgabe doppelt anlegen']).toBe('FEHLER already_imported');
  // Einnahme (neue Revision, gleicher Betrag) + Rohstoff-Ausgabe aktualisiert, Bücher-Ausgabe entfällt.
  expect(byLabel['ausgaben neue revision']).toMatchObject({ aktualisiert: 2, unveraendert: 0, entfernt: 1 });
  expect(byLabel['ausgabe aeltere revision']).toBe('FEHLER older_revision');
  expect(byLabel['ausgabe erneut anlegen']).toMatchObject({ angelegt: 1 });
  expect(byLabel['kind falsch']).toBe('FEHLER invalid_kind');
  expect(byLabel['ausgabe mit menge']).toBe('FEHLER invalid_quantity');
  expect(byLabel['ausgabe hinweis zu lang']).toBe('FEHLER invalid_note');
  expect(byLabel['ausgabe ersetzen']).toBe('FEHLER invalid_replace');
  expect(byLabel['ausgabe negativ']).toBe('FEHLER invalid_amount');
  expect(byLabel['ausgaben stand geaendert']).toBe('FEHLER stale_preview');
  const ende = byLabel['vorschau 18.10. ende'];
  expect(ende.expenses.filter(e => !e.from_import).map(e => e.category).sort()).toEqual(['Marketing', 'Spende']);
  expect(ende.expenses.filter(e => e.from_import)).toEqual([expect.objectContaining({ category: 'Ankauf Rohstoffe & Blöcke', amount: 268000 })]);
});
