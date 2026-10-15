/* Tageszaehler-Import (15.10.2026) - die SQL-Seite gegen ECHTES Postgres (PGlite,
   siehe tests/helpers/pg-tageszaehler-import-db.js). Getestet wird die echte Datei
   sql/20261015-tageszaehler-import.sql, so wie sie im Supabase-SQL-Editor laeuft.

   Erwartungswerte sind von Hand aus den Testdaten gerechnet.
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
const FP1 = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);
const REV1 = { revision_id: '20261015-093555-111-aaaaaa', revision_created_at: '2026-10-15T09:35:55Z', fingerprint: FP1 };
const REV2 = { revision_id: '20261015-120000-222-bbbbbb', revision_created_at: '2026-10-15T12:00:00Z', fingerprint: FP2 };
const msg = err => String((err && err.message) || err);

function line(date, cat, name, web, amount, extra) {
  return Object.assign({
    date, counter_category_id: cat, counter_category_name: name, website_category: web, amount,
    quantity: null, quantity_status: 'offen', action: 'create'
  }, REV1, extra || {});
}

async function world() {
  const db = await h.createImportDb();
  const admin = await h.addAdminProfile(db, { uid: uid(900), email: 'chef@bkmp-admin-accounts.com', role: 'admin' });
  return { db, admin };
}
async function preview(db, who, dates) { return h.rpc(db, who, 'tageszaehler_import_preview', [KONTO, dates]); }
async function apply(db, who, batch, snapshot, lines) {
  return h.rpc(db, who, 'tageszaehler_import_apply', [batch, snapshot, JSON.stringify({ konto: KONTO, lines })]);
}

/* ============================================================ Rechte */
test.describe('Zugriffsschutz', () => {
  let db, admin;
  test.beforeAll(async () => {
    ({ db, admin } = await world());
    await h.addAdminProfile(db, { uid: uid(901), email: 'editor@bkmp-admin-accounts.com', role: 'editor' });
    await h.addAdminProfile(db, { uid: uid(902), email: 'mitarbeiter@bkmp-admin-accounts.com', role: 'expenses_editor' });
    await h.addAdminProfile(db, { uid: uid(903), email: 'gesperrt@bkmp-admin-accounts.com', role: 'admin', active: false });
  });

  test('Ausgeloggt: keine Funktion ausfuehrbar, Tabellen nicht lesbar', async () => {
    await expect(preview(db, null, ['2026-10-14'])).rejects.toThrow(/permission denied/i);
    await expect(apply(db, null, uid(1), 'x', [line('2026-10-14', 'buecher', 'Bücher', 'Bücher', '2475.00')])).rejects.toThrow(/permission denied/i);
    await expect(h.callAs(db, null, 'select * from public.tageszaehler_import_lines')).rejects.toThrow(/permission denied/i);
  });

  test('Spieler, Mitarbeiter- und gesperrtes Konto: not_admin', async () => {
    for (const who of [
      { sub: uid(1), email: 'spieler@bkmp-player-accounts.com' },
      { sub: uid(902), email: 'mitarbeiter@bkmp-admin-accounts.com' },
      { sub: uid(903), email: 'gesperrt@bkmp-admin-accounts.com' }
    ]) {
      await expect(preview(db, who, ['2026-10-14'])).rejects.toThrow(/not_admin/);
      await expect(apply(db, who, uid(2), 'x', [line('2026-10-14', 'buecher', 'Bücher', 'Bücher', '2475.00')])).rejects.toThrow(/not_admin/);
    }
  });

  test('Admin und Redakteur duerfen; die Tabellen bleiben auch fuer sie nur ueber die Funktionen erreichbar', async () => {
    const p = await preview(db, admin, ['2026-10-14']);
    expect(p.imports).toEqual([]);
    const editor = { sub: uid(901), email: 'editor@bkmp-admin-accounts.com' };
    expect((await preview(db, editor, ['2026-10-14'])).snapshot).toMatch(/^[0-9a-f]{32}$/);
    await expect(h.callAs(db, admin, 'select * from public.tageszaehler_import_lines')).rejects.toThrow(/permission denied/i);
    await expect(h.callAs(db, admin, 'select * from public.tageszaehler_import_batches')).rejects.toThrow(/permission denied/i);
  });

  test('Website-Kategorien entsprechen exakt BKMP_INCOME_CATEGORIES aus app.js', async () => {
    const appJs = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');
    const m = appJs.match(/const BKMP_INCOME_CATEGORIES = \[([\s\S]*?)\];/);
    const expected = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    const res = await db.query('select public.tageszaehler_import_website_categories() as c');
    expect(res.rows[0].c).toEqual(expected);
  });
});

/* ============================================================ Ablauf */
test.describe('Uebernahme, Wiederholung, Revisionen', () => {
  let db, admin, manualBooks, manualRockets, otherDay;
  test.beforeAll(async () => {
    ({ db, admin } = await world());
    // Von Hand erfasste Brutto-Zeilen wie auf der echten Seite (924 Buecher x 2.500).
    manualBooks = await h.addIncome(db, { category: 'Bücher', amount: 2310000, date: '2026-10-14', quantity: 924 });
    manualRockets = await h.addIncome(db, { category: 'Raketen', amount: 32000, date: '2026-10-14', quantity: 32 });
    otherDay = await h.addIncome(db, { category: 'Bücher', amount: 962500, date: '2026-10-12', quantity: 385 });
  });

  test('Vorschau zeigt die von Hand erfassten Zeilen des Tages (nicht die anderer Tage)', async () => {
    const p = await preview(db, admin, ['2026-10-14']);
    expect(p.imports).toEqual([]);
    expect(p.incomes.map(i => i.id).sort()).toEqual([manualBooks, manualRockets].sort());
    expect(p.incomes.every(i => i.from_import === false)).toBe(true);
  });

  test('Bestaetigung: Netto exakt, Altzeile nur wenn ausgewaehlt ersetzt, Menge nur wenn vollstaendig', async () => {
    const p = await preview(db, admin, ['2026-10-14']);
    const lines = [
      line('2026-10-14', 'buecher', 'Bücher', 'Bücher', '2286900.00', { quantity: 924, quantity_status: 'vollstaendig', replace_income_ids: [manualBooks] }),
      line('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '43560.00'),
      line('2026-10-14', 'raketen', 'Raketen', 'Raketen', '31681.25', { quantity_status: 'teilweise' })
    ];
    const r = await apply(db, admin, uid(100), p.snapshot, lines);
    expect(r).toMatchObject({ angelegt: 3, aktualisiert: 0, unveraendert: 0, entfernt: 0, ersetzt_manuell: 1, wiederholt: false });

    const rows = await h.incomes(db, '2026-10-14');
    // Altzeile Buecher ersetzt, Altzeile Raketen (nicht ausgewaehlt) bleibt -> von Hand: 3 neue + 1 alte = 4
    expect(rows.map(x => x.id)).not.toContain(manualBooks);
    expect(rows.map(x => x.id)).toContain(manualRockets);
    expect(rows).toHaveLength(4);
    const books = rows.find(x => x.category === 'Bücher');
    expect(books).toMatchObject({ amount: '2286900.00', quantity: '924', note: 'Netto aus Tageszähler: Bücher' });
    expect(rows.find(x => x.note === 'Netto aus Tageszähler: Raketen')).toMatchObject({ amount: '31681.25', quantity: null });
    expect(rows.find(x => x.category === 'Netherite')).toMatchObject({ amount: '43560.00', quantity: null });

    // Nachweis im Ergebnis: Importsumme von Hand 2.286.900 + 43.560 + 31.681,25 = 2.362.141,25;
    // Tagessumme zusaetzlich mit der behaltenen Altzeile 32.000 = 2.394.141,25
    expect(Number(r.tage[0].import_summe)).toBeCloseTo(2362141.25, 2);
    expect(Number(r.tage[0].einnahmen_summe)).toBeCloseTo(2394141.25, 2);
    // Ersetzter Inhalt bleibt im Verlauf nachvollziehbar
    const book = (await h.importLines(db)).find(l => l.counter_category_id === 'buecher');
    expect(book.history[0].replaced[0]).toMatchObject({ id: manualBooks, amount: 2310000, quantity: 924 });
    // Anderer Tag unberuehrt
    expect((await h.incomes(db, '2026-10-12')).map(x => x.id)).toEqual([otherDay]);
  });

  test('Verlorene Antwort: derselbe Auftrag nochmal -> gespeichertes Ergebnis, nichts doppelt', async () => {
    const before = await h.incomes(db);
    const lines = [
      line('2026-10-14', 'buecher', 'Bücher', 'Bücher', '2286900.00', { quantity: 924, quantity_status: 'vollstaendig', replace_income_ids: [manualBooks] }),
      line('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '43560.00'),
      line('2026-10-14', 'raketen', 'Raketen', 'Raketen', '31681.25', { quantity_status: 'teilweise' })
    ];
    // Der alte Stand-Fingerabdruck stimmt nicht mehr - die Wiederholung wird trotzdem erkannt.
    const r = await apply(db, admin, uid(100), 'veralteter-stand', lines);
    expect(r.wiederholt).toBe(true);
    expect(r.angelegt).toBe(3);
    expect(await h.incomes(db)).toEqual(before);
    // Gleiche Kennung, anderer Inhalt -> abgelehnt
    await expect(apply(db, admin, uid(100), 'x', [lines[1]])).rejects.toThrow(/batch_conflict/);
  });

  test('Dieselbe Datei erneut (neue Kennung): unveraendert, keine neue Einnahme', async () => {
    const before = await h.incomes(db);
    const p = await preview(db, admin, ['2026-10-14']);
    expect(p.imports).toHaveLength(3);
    const r = await apply(db, admin, uid(101), p.snapshot, [
      line('2026-10-14', 'buecher', 'Bücher', 'Bücher', '2286900.00', { quantity: 924, quantity_status: 'vollstaendig', action: 'update' }),
      line('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '43560.00', { action: 'update' }),
      line('2026-10-14', 'raketen', 'Raketen', 'Raketen', '31681.25', { quantity_status: 'teilweise', action: 'update' })
    ]);
    expect(r).toMatchObject({ angelegt: 0, aktualisiert: 0, unveraendert: 3 });
    expect(await h.incomes(db)).toEqual(before);
    // Ein zweites "Anlegen" derselben Position ist ausgeschlossen
    const p2 = await preview(db, admin, ['2026-10-14']);
    await expect(apply(db, admin, uid(102), p2.snapshot, [line('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '43560.00')]))
      .rejects.toThrow(/already_imported/);
  });

  test('Zwischen Vorschau und Bestaetigung geaendert -> nichts geschrieben (stale_preview)', async () => {
    const p = await preview(db, admin, ['2026-10-14']);
    await h.addIncome(db, { category: 'Custom', amount: 500, date: '2026-10-14', note: 'nachtraeglich von Hand' });
    const before = await h.incomes(db);
    await expect(apply(db, admin, uid(103), p.snapshot, [
      line('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '99999.00', Object.assign({ action: 'update' }, REV2))
    ])).rejects.toThrow(/stale_preview/);
    expect(await h.incomes(db)).toEqual(before);
  });

  test('Neuere Revision: Betrag wird an derselben Zeile aktualisiert, Verlauf behaelt den alten Wert', async () => {
    const p = await preview(db, admin, ['2026-10-14']);
    const netherBefore = p.imports.find(x => x.counter_category_id === 'barren');
    const r = await apply(db, admin, uid(104), p.snapshot, [
      line('2026-10-14', 'buecher', 'Bücher', 'Bücher', '2286900.00', Object.assign({ quantity: 924, quantity_status: 'vollstaendig', action: 'update' }, REV2)),
      // Kistenpreis bestaetigt: 43.560 = 4 x 10.890 -> Menge jetzt bekannt, Betrag unveraendert
      line('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '43560.00', Object.assign({ quantity: 4, quantity_status: 'vollstaendig', action: 'update' }, REV2)),
      // Raketen in der neuen Revision nicht mehr vorhanden -> entfernen
      line('2026-10-14', 'raketen', 'Raketen', 'Raketen', '0.00', Object.assign({ action: 'remove' }, REV2))
    ]);
    expect(r).toMatchObject({ aktualisiert: 2, entfernt: 1, angelegt: 0 });
    const rows = await h.incomes(db, '2026-10-14');
    const nether = rows.find(x => x.category === 'Netherite');
    expect(nether.id).toBe(netherBefore.income_id);
    expect(nether).toMatchObject({ amount: '43560.00', quantity: '4' });
    expect(rows.find(x => x.note === 'Netto aus Tageszähler: Raketen')).toBeUndefined();
    const lines = await h.importLines(db);
    expect(lines.find(l => l.counter_category_id === 'raketen')).toMatchObject({ status: 'entfernt', income_id: null });
    expect(lines.find(l => l.counter_category_id === 'barren').history.at(-1).previous).toMatchObject({ amount: 43560, quantity: null });
    expect(lines.every(l => l.revision_id === REV2.revision_id)).toBe(true);
  });

  test('Aeltere Revision ueberschreibt nichts (older_revision)', async () => {
    const p = await preview(db, admin, ['2026-10-14']);
    const before = await h.incomes(db);
    await expect(apply(db, admin, uid(105), p.snapshot, [
      line('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '11880.00', { action: 'update' })
    ])).rejects.toThrow(/older_revision/);
    expect(await h.incomes(db)).toEqual(before);
  });

  test('Auf der Website geloeschte Import-Zeile: normales Loeschen funktioniert, erneutes Anlegen ist moeglich', async () => {
    const p = await preview(db, admin, ['2026-10-14']);
    const nether = p.imports.find(x => x.counter_category_id === 'barren');
    // Loeschen wie im Admin-Panel (RLS-Policy "Admins delete incomes") - kein Fremdschluessel stoert
    await h.callAs(db, admin, 'delete from public.incomes where id = $1', [nether.income_id]);
    const p2 = await preview(db, admin, ['2026-10-14']);
    expect(p2.imports.find(x => x.counter_category_id === 'barren').income).toBeNull();
    const r = await apply(db, admin, uid(106), p2.snapshot, [
      line('2026-10-14', 'barren', 'Netheritbarren', 'Netherite', '43560.00', Object.assign({ quantity: 4, quantity_status: 'vollstaendig' }, REV2))
    ]);
    expect(r.angelegt).toBe(1);
    expect((await h.incomes(db, '2026-10-14')).filter(x => x.category === 'Netherite')).toHaveLength(1);
  });
});

/* ============================================================ Eingaben pruefen */
test.describe('Ungueltige Auftraege werden ganz abgelehnt (alles oder nichts)', () => {
  let db, admin, manualOther;
  test.beforeAll(async () => {
    ({ db, admin } = await world());
    manualOther = await h.addIncome(db, { category: 'Werkzeug', amount: 75000, date: '2026-10-13', quantity: 1 });
  });

  const cases = [
    ['drei Nachkommastellen', [line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475.001')], /invalid_amount/],
    ['negativer Betrag', [line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '-2475')], /invalid_amount/],
    ['unbekannte Website-Kategorie', [line('2026-10-13', 'buecher', 'Bücher', 'Buecher', '2475')], /invalid_website_category/],
    ['Menge trotz offener Menge', [line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475', { quantity: 1 })], /invalid_quantity/],
    ['gebrochene Menge', [line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475', { quantity: 0.5, quantity_status: 'vollstaendig' })], /invalid_quantity/],
    ['zwei Revisionen an einem Tag', [line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475'),
      line('2026-10-13', 'barren', 'Netheritbarren', 'Netherite', '10890', REV2)], /mixed_revisions/],
    ['doppelte Position', [line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475'), line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475')], /duplicate_line/],
    ['Ersetzen einer Zeile anderer Kategorie', [line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475', { replace_income_ids: ['__OTHER__'] })], /invalid_replace/],
    ['ungueltiger Fingerabdruck', [line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475', { fingerprint: 'abc' })], /invalid_fingerprint/],
    ['Aktualisieren ohne frueheren Import', [line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475', { action: 'update' })], /not_imported/],
    ['gueltige Zeile + ungueltige Zeile', [line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475'),
      line('2026-10-13', 'traenke', 'Tränke', 'Traenke', '1485')], /invalid_website_category/]
  ];
  for (const [label, rawLines, err] of cases) {
    test(label, async () => {
      const lines = JSON.parse(JSON.stringify(rawLines).replace('__OTHER__', manualOther));
      const p = await preview(db, admin, ['2026-10-13']);
      const before = await h.incomes(db);
      await expect(apply(db, admin, uid(200 + cases.findIndex(c => c[0] === label)), p.snapshot, lines)).rejects.toThrow(err);
      expect(await h.incomes(db)).toEqual(before);
      expect(await h.importLines(db)).toEqual([]);
    });
  }

  test('Eine aus einem Import stammende Zeile kann nicht als "von Hand" ersetzt werden', async () => {
    let p = await preview(db, admin, ['2026-10-13']);
    await apply(db, admin, uid(300), p.snapshot, [line('2026-10-13', 'buecher', 'Bücher', 'Bücher', '2475.00')]);
    p = await preview(db, admin, ['2026-10-13']);
    const imported = p.incomes.find(i => i.from_import);
    expect(imported).toBeTruthy();
    await expect(apply(db, admin, uid(301), p.snapshot, [
      line('2026-10-13', 'karten', 'Karten', 'Bücher', '99.00', { replace_income_ids: [imported.id] })
    ])).rejects.toThrow(/invalid_replace/);
  });
});
