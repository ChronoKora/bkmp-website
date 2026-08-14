-- Bkmp - Neue eingeschraenkte Admin-Rolle "expenses_editor" (Nutzerwunsch
-- 14.08.2026: "Habe jetzt einen Mitarbeiter eingestellt fuer bk investment
-- der ausgaben eingeben soll im admin panel. Nur das vorerst.").
--
-- Architektur-Praezedenzfall bereits vorhanden: die Rolle "sheep_editor"
-- (admin.html, "Zitat des Tages") zeigt exakt dasselbe Muster - eine
-- eigene admin_profiles.role, clientseitig auf genau eine Seite verengt
-- (admin.html: isExpensesEditor-Zweig in showAdmin()). Diese Datei ergaenzt
-- den fehlenden SERVERSEITIGEN Teil (RLS) fuer eine analoge neue Rolle:
-- is_active_admin() bleibt bewusst UNVERAENDERT (prueft weiterhin nur
-- role in ('admin','editor')) - 'expenses_editor' faellt dort automatisch
-- durch und hat dadurch STRUKTURELL null Zugriff auf jede andere admin-only
-- Tabelle (Investoren, Feedback, Anti-Cheat, Spielerverwaltung, ...), ohne
-- dass irgendetwas davon einzeln angefasst werden musste - reines Opt-in
-- nur fuer den einen hier neu freigeschalteten Fall.
--
-- BEWUSST NUR "eingeben" (insert), KEIN Loeschen/Bearbeiten - der Nutzer
-- sagte ausdruecklich "eingeben... nur das vorerst". saveExpense() (supabase.js)
-- ist ohnehin reines insert (kein update/upsert - es gibt im Admin-Panel gar
-- keine "Ausgabe bearbeiten"-Funktion, nur hinzufuegen/loeschen). Loeschen
-- bewusst NICHT freigegeben (destruktive Aktion auf gemeinsamen Finanz-
-- daten) - kann bei Bedarf spaeter separat ergaenzt werden. Lesen ist
-- bereits oeffentlich (anon, authenticated) und bleibt unangetastet - der
-- Mitarbeiter muss die bestehende Liste sehen koennen, um nicht versehentlich
-- doppelt einzutragen.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

create or replace function public.is_expenses_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_profiles
    where login_name = auth.jwt() ->> 'email'
    and active = true
    and role = 'expenses_editor'
  );
$$;

-- Zusaetzliche, EIGENSTAENDIGE Policy (bestehende "Admins insert expenses"
-- bleibt unangetastet) - Postgres kombiniert mehrere permissive Policies
-- fuer dieselbe Operation automatisch per OR, daher hier bewusst NUR die
-- neue Bedingung, keine Wiederholung von is_active_admin().
drop policy if exists "Expenses editor insert expenses" on public.expenses;
create policy "Expenses editor insert expenses" on public.expenses
  for insert to authenticated
  with check (public.is_expenses_editor());
