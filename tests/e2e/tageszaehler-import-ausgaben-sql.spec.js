/* Tageszaehler-Import: Ausgaben (19.10.2026) - die SQL-Erweiterung gegen ECHTES Postgres (PGlite).
   Getestet wird sql/20261019-tageszaehler-ausgaben.sql, so wie sie nach sql/20261015-tageszaehler-import.sql
   im Supabase-SQL-Editor laeuft - inklusive Aktualisierung einer Datenbank, die schon Importe enthaelt.

   Grundsatz des Inhabers: "Einnahmen sind Einnahmen und alles, was wir ankaufen, sind Ausgaben."
   Erwartungswerte von Hand gerechnet (echter 18.10.: Verkauf Rohstoffe 220.725,83, Ankauf 268.173,22).
   Reine Datenbank-Tests, kein Browser: laufen nur im Projekt chromium-desktop. */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const h = require('../helpers/pg-tageszaehler-import-db');

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Reine SQL-Tests laufen nur einmal (chromium-desktop).');
});

const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const KONTO = 'chestshop-hauptkonto';
const REV1 = { revision_id: '20261019-012709-957-90e4e5', revision_created_at: '2026-10-18T23:27:09Z', fingerprint: 'c'.repeat(64) };
const REV2 = { revision_id: '20261019-090000-000-dddddd', revision_created_at: '2026-10-19T09:00:00Z', fingerprint: 'd'.repeat(64) };
const ein = (cat, name, web, amount, extra) => Object.assign({ date: '2026-10-18', counter_category_id: cat, counter_category_name: name,
  website_category: web, amount, quantity: null, quantity_status: 'offen', action: 'create' }, REV1, extra || {});
const aus = (cat, name, amount, extra) => Object.assign({ kind: 'ausgabe', date: '2026-10-18', counter_category_id: cat, counter_category_name: name,
  amount, quantity: null, quantity_status: 'offen', action: 'create' }, REV1, extra || {});
const sqlText = name => fs.readFileSync(path.join(__dirname, '..', '..', 'sql', name), 'utf8');

async function world(options) {
  const db = await h.createImportDb(options);
  const admin = await h.addAdminProfile(db, { uid: uid(900), email: 'chef@bkmp-admin-accounts.com', role: 'admin' });
  return { db, admin };
}
const preview = (db, who, dates) => h.rpc(db, who, 'tageszaehler_import_preview', [KONTO, dates]);
const apply = (db, who, batch, snapshot, lines) => h.rpc(db, who, 'tageszaehler_import_apply', [batch, snapshot, JSON.stringify({ konto: KONTO, lines })]);

test.describe('Aktualisierung einer Datenbank mit bestehenden Importen', () => {
  test('Alte Importzeilen werden Einnahmen, Vorschau und Wiederholung bleiben gleich; zweimal ausfuehren ist unschaedlich', async () => {
    const { db, admin } = await world({ ausgaben: false });   // Stand wie heute live: nur 20261015
    let p = await preview(db, admin, ['2026-10-14']);
    const alt = [
      Object.assign(ein('buecher', 'Bücher', 'Bücher', '1684980.00', { quantity: 680, quantity_status: 'vollstaendig' }), { date: '2026-10-14' }),
      Object.assign(ein('barren', 'Netheritbarren', 'Netherite', '32670.00'), { date: '2026-10-14' })
    ];
    await apply(db, admin, uid(1), p.snapshot, alt);
    const incomesBefore = await h.incomes(db);

    await db.exec(sqlText('20261019-tageszaehler-ausgaben.sql'));
    await db.exec(sqlText('20261019-tageszaehler-ausgaben.sql'));   // mehrfach ausfuehren: unschaedlich

    const lines = await h.importLines(db);
    expect(lines.map(l => [l.counter_category_id, l.kind, l.expense_id])).toEqual([['barren', 'einnahme', null], ['buecher', 'einnahme', null]]);
    p = await preview(db, admin, ['2026-10-14']);
    expect(p.imports.map(i => [i.kind, i.counter_category_id, i.expense])).toEqual([['einnahme', 'barren', null], ['einnahme', 'buecher', null]]);
    expect(p.expenses).toEqual([]);
    // Dieselbe Datei (Version 1, Auftrag ohne kind) nochmal: unveraendert, nichts doppelt.
    const r = await apply(db, admin, uid(2), p.snapshot, alt.map(x => Object.assign({}, x, { action: 'update' })));
    expect(r).toMatchObject({ unveraendert: 2, angelegt: 0 });
    expect(r.lines.every(l => l.kind === 'einnahme')).toBe(true);
    expect(await h.incomes(db)).toEqual(incomesBefore);
    // Wiederholung eines vor der Aktualisierung gespeicherten Auftrags wird weiter erkannt.
    expect((await apply(db, admin, uid(1), 'egal', alt)).wiederholt).toBe(true);
  });
});

test.describe('Ausgaben anlegen, wiederholen, aendern', () => {
  let db, admin, manual;
  test.beforeAll(async () => {
    ({ db, admin } = await world());
    manual = await h.addExpense(db, { category: 'Marketing', amount: 500, date: '2026-10-18', note: 'von Hand' });
  });

  test('Echter 18.10.: Verkauf als Einnahme, Ankauf als Ausgabe; von Hand erfasste Ausgabe bleibt unberuehrt', async () => {
    const p = await preview(db, admin, ['2026-10-18']);
    expect(p.expenses).toEqual([expect.objectContaining({ id: manual, category: 'Marketing', from_import: false })]);
    const r = await apply(db, admin, uid(10), p.snapshot, [
      ein('buecher', 'Bücher', 'Bücher', '1779525.00', { quantity: 719, quantity_status: 'vollstaendig' }),
      ein('rohstoffe', 'Rohstoffe & Blöcke', 'Custom', '220725.83'),
      aus('rohstoffe', 'Rohstoffe & Blöcke', '268173.22', { note: '11 Artikel, größte: Quarzziegel 189.647,68 $, Rote Netherziegel 44.431,50 $' })
    ]);
    expect(r).toMatchObject({ angelegt: 3, wiederholt: false });
    expect(r.lines.map(l => [l.kind, l.counter_category_id, l.website_category])).toEqual([
      ['einnahme', 'buecher', 'Bücher'], ['einnahme', 'rohstoffe', 'Custom'], ['ausgabe', 'rohstoffe', 'Ankauf Rohstoffe & Blöcke']]);
    // Nachweis: Einnahmen 1.779.525 + 220.725,83 = 2.000.250,83; Ausgaben Import 268.173,22, mit der von Hand 268.673,22
    expect(Number(r.tage[0].import_summe)).toBeCloseTo(2000250.83, 2);
    expect(Number(r.tage[0].ausgaben_import_summe)).toBeCloseTo(268173.22, 2);
    expect(Number(r.tage[0].ausgaben_summe)).toBeCloseTo(268673.22, 2);
    expect(r.tage[0].ausgaben_zeilen).toBe(2);

    const rows = await h.expenses(db, '2026-10-18');
    const ankauf = rows.find(e => e.category === 'Ankauf Rohstoffe & Blöcke');
    expect(ankauf).toMatchObject({
      amount: '268173.22', date: '2026-10-18',
      note: 'Ankauf aus Tageszähler: Rohstoffe & Blöcke – 11 Artikel, größte: Quarzziegel 189.647,68 $, Rote Netherziegel 44.431,50 $',
      entered_by_auth_user_id: uid(900)      // wer importiert hat, steht wie bei Ausgaben von Hand an der Zeile
    });
    expect(rows.find(e => e.id === manual)).toMatchObject({ category: 'Marketing', amount: '500', note: 'von Hand' });
    // Einnahme derselben Zaehler-Kategorie hat einen eigenen Schluessel
    const keys = (await h.importLines(db)).map(l => [l.import_key, l.kind]);
    expect(keys).toEqual(expect.arrayContaining([
      ['tz1:chestshop-hauptkonto:2026-10-18:rohstoffe', 'einnahme'], ['tz1:chestshop-hauptkonto:2026-10-18:ausgabe:rohstoffe', 'ausgabe']]));
  });

  test('Vorschau danach: Ausgabe als Import erkannt, die von Hand erfasste nicht', async () => {
    const p = await preview(db, admin, ['2026-10-18']);
    const imp = p.imports.find(i => i.kind === 'ausgabe');
    expect(imp).toMatchObject({ counter_category_id: 'rohstoffe', website_category: 'Ankauf Rohstoffe & Blöcke', income_id: null, income: null });
    expect(Number(imp.expense.amount)).toBeCloseTo(268173.22, 2);
    expect(p.expenses.map(e => [e.category, e.from_import]).sort()).toEqual([['Ankauf Rohstoffe & Blöcke', true], ['Marketing', false]]);
  });

  test('Neue Revision aendert dieselbe Ausgabe-Zeile; Verlauf behaelt den alten Betrag', async () => {
    const p = await preview(db, admin, ['2026-10-18']);
    const before = p.imports.find(i => i.kind === 'ausgabe').expense_id;
    const r = await apply(db, admin, uid(11), p.snapshot, [
      ein('buecher', 'Bücher', 'Bücher', '1779525.00', Object.assign({ quantity: 719, quantity_status: 'vollstaendig', action: 'update' }, REV2)),
      ein('rohstoffe', 'Rohstoffe & Blöcke', 'Custom', '220725.83', Object.assign({ action: 'update' }, REV2)),
      aus('rohstoffe', 'Rohstoffe & Blöcke', '268000.00', Object.assign({ action: 'update', note: 'neu gezählt' }, REV2))
    ]);
    expect(r).toMatchObject({ aktualisiert: 3 });
    const ankauf = (await h.expenses(db, '2026-10-18')).find(e => e.category === 'Ankauf Rohstoffe & Blöcke');
    expect(ankauf).toMatchObject({ id: before, amount: '268000.00', note: 'Ankauf aus Tageszähler: Rohstoffe & Blöcke – neu gezählt' });
    const line = (await h.importLines(db)).find(l => l.kind === 'ausgabe');
    expect(line.history.at(-1).previous).toMatchObject({ amount: 268173.22, category: 'Ankauf Rohstoffe & Blöcke' });
  });

  test('Ausgabe nicht mehr in der neuen Revision -> nur sie wird entfernt, die von Hand erfasste bleibt', async () => {
    const p = await preview(db, admin, ['2026-10-18']);
    const REV3 = { revision_id: 'r3', revision_created_at: '2026-10-19T10:00:00Z', fingerprint: 'e'.repeat(64) };
    const r = await apply(db, admin, uid(12), p.snapshot, [aus('rohstoffe', 'Rohstoffe & Blöcke', '0.00', Object.assign({ action: 'remove' }, REV3)),
      ein('buecher', 'Bücher', 'Bücher', '1779525.00', Object.assign({ quantity: 719, quantity_status: 'vollstaendig', action: 'update' }, REV3)),
      ein('rohstoffe', 'Rohstoffe & Blöcke', 'Custom', '220725.83', Object.assign({ action: 'update' }, REV3))]);
    expect(r).toMatchObject({ entfernt: 1 });
    expect((await h.expenses(db, '2026-10-18')).map(e => e.id)).toEqual([manual]);
    expect((await h.importLines(db)).find(l => l.kind === 'ausgabe')).toMatchObject({ status: 'entfernt', expense_id: null });
  });
});

test.describe('Ungueltige Ausgaben werden ganz abgelehnt (alles oder nichts)', () => {
  let db, admin;
  test.beforeAll(async () => { ({ db, admin } = await world()); });
  const cases = [
    ['unbekannte Art', [aus('rohstoffe', 'Rohstoffe & Blöcke', '10', { kind: 'spende' })], /invalid_kind/],
    ['Ausgabe mit Menge', [aus('rohstoffe', 'Rohstoffe & Blöcke', '10', { quantity: 3, quantity_status: 'vollstaendig' })], /invalid_quantity/],
    ['Hinweis ueber 300 Zeichen', [aus('rohstoffe', 'Rohstoffe & Blöcke', '10', { note: 'x'.repeat(301) })], /invalid_note/],
    ['negativer Ankauf', [aus('rohstoffe', 'Rohstoffe & Blöcke', '-10')], /invalid_amount/],
    ['Ausgabe will eine Einnahme ersetzen', [aus('rohstoffe', 'Rohstoffe & Blöcke', '10', { replace_income_ids: [uid(1)] })], /invalid_replace/],
    ['gueltige Einnahme + ungueltige Ausgabe', [ein('buecher', 'Bücher', 'Bücher', '2475.00'), aus('rohstoffe', 'Rohstoffe & Blöcke', '1.001')], /invalid_amount/]
  ];
  for (const [label, lines, err] of cases) {
    test(label, async () => {
      const p = await preview(db, admin, ['2026-10-18']);
      await expect(apply(db, admin, uid(100 + cases.findIndex(c => c[0] === label)), p.snapshot, lines)).rejects.toThrow(err);
      expect(await h.incomes(db)).toEqual([]);
      expect(await h.expenses(db)).toEqual([]);
      expect(await h.importLines(db)).toEqual([]);
    });
  }

  test('Ohne Admin-Rechte: auch Ausgaben nicht (not_admin)', async () => {
    await h.addAdminProfile(db, { uid: uid(902), email: 'mitarbeiter@bkmp-admin-accounts.com', role: 'expenses_editor' });
    const mitarbeiter = { sub: uid(902), email: 'mitarbeiter@bkmp-admin-accounts.com' };
    await expect(apply(db, mitarbeiter, uid(150), 'x', [aus('rohstoffe', 'Rohstoffe & Blöcke', '10')])).rejects.toThrow(/not_admin/);
    expect(await h.expenses(db)).toEqual([]);
  });
});
