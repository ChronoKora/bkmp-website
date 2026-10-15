/* Echtes Postgres (PGlite, WebAssembly) fuer den Tageszaehler-Import
   (sql/20261015-tageszaehler-import.sql).

   Nachgebaut wird nur, was die Funktionen wirklich brauchen - und zwar aus den
   ECHTEN Projektdateien, nicht als zweiter Nachbau:
     * Rollen anon/authenticated + auth.jwt()/auth.uid() (wie Supabase: Claims aus
       der Sitzungsvariable request.jwt.claims)
     * admin_profiles + die ECHTE is_active_admin() aus
       sql/supabase-mapart-marketplace-schema.sql (Rollen admin/editor)
     * incomes aus sql/supabase-schema.sql inklusive der ECHTEN Rechte/Policies aus
       sql/supabase-security-hardening.sql (oeffentliches Lesen, Schreiben nur fuer
       aktive Admins) und der quantity-Spalte aus sql/20260901-incomes-quantity-column.sql
   Danach wird die neue Datei exakt so ausgefuehrt, wie sie im Supabase-SQL-Editor laeuft. */
const fs = require('fs');
const path = require('path');
const harness = require('./pg-event-harness');

const ROOT = path.join(__dirname, '..', '..');
// Zeilenenden vereinheitlichen: mit core.autocrlf=true liegen die SQL-Dateien als CRLF vor, die Marker unten nutzen \n.
const sqlFile = name => fs.readFileSync(path.join(ROOT, 'sql', name), 'utf8').replace(/\r\n/g, '\n');

function between(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  if (a < 0) throw new Error('SQL-Marker nicht gefunden: ' + startMarker);
  const b = text.indexOf(endMarker, a);
  if (b < 0) throw new Error('SQL-Endmarker nicht gefunden: ' + endMarker);
  return text.slice(a, b);
}

async function createImportDb(options) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    grant execute on function auth.jwt() to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create table public.admin_profiles (
      id uuid primary key default gen_random_uuid(), auth_user_id uuid, login_name text, role text, active boolean default true);
  `);
  // Echte is_active_admin() (Rollenfilter admin/editor).
  await db.exec(between(sqlFile('supabase-mapart-marketplace-schema.sql'),
    'create or replace function public.is_active_admin()', '-- ============================================================\n-- 1) companies'));
  await db.exec('grant execute on function public.is_active_admin() to anon, authenticated;');
  // Echte incomes-Tabelle + Policies wie in Produktion.
  await db.exec(between(sqlFile('supabase-schema.sql'), 'create table if not exists public.incomes', 'create table if not exists public.expenses'));
  await db.exec(sqlFile('20260901-incomes-quantity-column.sql'));
  await db.exec(`
    alter table public.incomes enable row level security;
    create policy "Allow anon read incomes" on public.incomes for select to anon, authenticated using (true);
    grant select on public.incomes to anon, authenticated;
  `);
  await db.exec(between(sqlFile('supabase-security-hardening.sql'),
    'create policy "Admins insert incomes"', 'drop policy if exists "Allow anon insert expenses"'));
  await db.exec('grant insert, update, delete on public.incomes to authenticated;');
  if (!options || options.install !== false) await db.exec(sqlFile('20261015-tageszaehler-import.sql'));
  return db;
}

/* Einnahme wie im Admin-Formular (direktes Einfuegen als Eigentuemer = Testaufbau). */
async function addIncome(db, row) {
  const res = await db.query(
    'insert into public.incomes (id, category, amount, date, note, quantity, created_at) values (coalesce($7::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, coalesce($6, now())) returning id',
    [row.category, row.amount, row.date, row.note || null, row.quantity == null ? null : row.quantity, row.created_at || null, row.id || null]);
  return res.rows[0].id;
}

async function incomes(db, date) {
  const res = await db.query(
    'select id, category, amount::text as amount, quantity::text as quantity, date::text as date, note from public.incomes' +
    (date ? ' where date = $1' : '') + ' order by date, category, created_at, id', date ? [date] : []);
  return res.rows;
}

async function importLines(db) {
  const res = await db.query('select * from public.tageszaehler_import_lines order by import_key');
  return res.rows;
}

module.exports = { createImportDb, addIncome, incomes, importLines, callAs: harness.callAs, rpc: harness.rpc, addAdminProfile: harness.addAdminProfile };
