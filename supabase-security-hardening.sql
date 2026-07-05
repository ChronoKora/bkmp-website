-- Bkmp Security Hardening
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt komplett ausfuehren.
--
-- Problem, das dieses Skript behebt:
-- Bisher durften "anon"-Nutzer (also JEDER Besucher, ueber den oeffentlichen
-- Anon-Key aus supabase.js) direkt per REST-API in praktisch allen Tabellen
-- Zeilen einfuegen/aendern/loeschen - unabhaengig vom Admin-Login im Panel.
-- Zusaetzlich durfte sich jeder ueber createAdminAccess() selbst einen
-- AKTIVEN Admin-Zugang anlegen (RLS liess "active = true" beim Insert zu).
--
-- Diese Migration:
-- 1) Fuehrt eine echte Admin-Pruefung ein (public.is_active_admin()), die
--    kontrolliert, ob der eingeloggte Supabase-Auth-Nutzer einen aktiven
--    Eintrag in admin_profiles hat.
-- 2) Erlaubt Schreibzugriffe auf Finanz-/Content-Tabellen nur noch aktiven
--    Admins. Lesen bleibt oeffentlich, damit die Website weiter funktioniert.
-- 3) Laesst die oeffentliche Kartenwunsch-Funktion (Einreichen + Like/Dislike)
--    bewusst fuer anonyme Besucher offen, schraenkt "update" dort aber per
--    Spalten-Rechten auf likes/dislikes ein (Name/Bild sind nicht mehr per
--    Update von aussen veraenderbar).
-- 4) Verhindert Selbst-Freischaltung neuer Admin-Zugaenge: neue Zugaenge
--    werden inaktiv angelegt und muessen von einem bereits aktiven Admin
--    ueber die "Zugaenge"-Seite freigeschaltet werden (Ausnahme: der ALLER-
--    ERSTE Zugang, wenn admin_profiles noch komplett leer ist - Bootstrap).
--
-- WICHTIG (einmalig direkt nach dem Deploy): Lege deinen eigenen Admin-
-- Zugang an, BEVOR du den Link zur Seite weitergibst. Der erste angelegte
-- Zugang wird automatisch aktiv (siehe Bootstrap-Ausnahme oben); jeder
-- danach angelegte Zugang muss ueber die Zugaenge-Seite manuell freigeschaltet
-- werden.

-- ---------- 1) Admin-Check-Funktion ----------
create or replace function public.is_active_admin()
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
  );
$$;

grant execute on function public.is_active_admin() to anon, authenticated;

-- ---------- 2) admin_profiles: keine Selbst-Freischaltung mehr ----------
-- Die Zugaenge-Seite im Admin-Panel laesst einen bereits eingeloggten Admin
-- neue Zugaenge fuer ANDERE auth_user_id anlegen (das ist gewollt und bleibt
-- unveraendert moeglich). Verboten wird nur der Fall, dass sich jemand OHNE
-- aktiven Admin-Status selbst einen aktiven Zugang anlegt. Ausnahme: die
-- Tabelle ist noch komplett leer (Bootstrap des allerersten Admin-Zugangs).
drop policy if exists "Allow authenticated insert admin profiles" on public.admin_profiles;
create policy "Allow admin or bootstrap insert admin profiles"
on public.admin_profiles for insert to authenticated
with check (
  public.is_active_admin()
  or (auth_user_id = auth.uid() and not exists (select 1 from public.admin_profiles))
);

-- Lesen: jeder eingeloggte Nutzer darf seine EIGENE Zeile sehen (noetig fuer
-- die Login-Pruefung), die komplette Zugaenge-Liste aber nur aktive Admins.
drop policy if exists "Allow authenticated read admin profiles" on public.admin_profiles;
create policy "Allow own or admin read admin profiles"
on public.admin_profiles for select to authenticated
using (login_name = auth.jwt() ->> 'email' or public.is_active_admin());

drop policy if exists "Allow authenticated update admin profiles" on public.admin_profiles;
create policy "Allow active admin update admin profiles"
on public.admin_profiles for update to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

-- ---------- 3) Reine Admin-Tabellen: Schreiben nur fuer aktive Admins ----------
-- incomes / expenses: nur Insert + Delete werden von der App genutzt.
drop policy if exists "Allow anon insert incomes" on public.incomes;
drop policy if exists "Allow anon delete incomes" on public.incomes;
create policy "Admins insert incomes" on public.incomes for insert to authenticated with check (public.is_active_admin());
create policy "Admins delete incomes" on public.incomes for delete to authenticated using (public.is_active_admin());

drop policy if exists "Allow anon insert expenses" on public.expenses;
drop policy if exists "Allow anon delete expenses" on public.expenses;
create policy "Admins insert expenses" on public.expenses for insert to authenticated with check (public.is_active_admin());
create policy "Admins delete expenses" on public.expenses for delete to authenticated using (public.is_active_admin());

-- investors / updates / streamer_links / about_blocks / partner_shops: voller CRUD im Admin-Panel.
drop policy if exists "Allow anon insert investors" on public.investors;
drop policy if exists "Allow anon update investors" on public.investors;
drop policy if exists "Allow anon delete investors" on public.investors;
create policy "Admins insert investors" on public.investors for insert to authenticated with check (public.is_active_admin());
create policy "Admins update investors" on public.investors for update to authenticated using (public.is_active_admin()) with check (public.is_active_admin());
create policy "Admins delete investors" on public.investors for delete to authenticated using (public.is_active_admin());

drop policy if exists "Allow anon insert updates" on public.updates;
drop policy if exists "Allow anon update updates" on public.updates;
drop policy if exists "Allow anon delete updates" on public.updates;
create policy "Admins insert updates" on public.updates for insert to authenticated with check (public.is_active_admin());
create policy "Admins update updates" on public.updates for update to authenticated using (public.is_active_admin()) with check (public.is_active_admin());
create policy "Admins delete updates" on public.updates for delete to authenticated using (public.is_active_admin());

drop policy if exists "Allow anon insert streamer links" on public.streamer_links;
drop policy if exists "Allow anon update streamer links" on public.streamer_links;
drop policy if exists "Allow anon delete streamer links" on public.streamer_links;
create policy "Admins insert streamer links" on public.streamer_links for insert to authenticated with check (public.is_active_admin());
create policy "Admins update streamer links" on public.streamer_links for update to authenticated using (public.is_active_admin()) with check (public.is_active_admin());
create policy "Admins delete streamer links" on public.streamer_links for delete to authenticated using (public.is_active_admin());

drop policy if exists "Allow anon insert about blocks" on public.about_blocks;
drop policy if exists "Allow anon update about blocks" on public.about_blocks;
drop policy if exists "Allow anon delete about blocks" on public.about_blocks;
create policy "Admins insert about blocks" on public.about_blocks for insert to authenticated with check (public.is_active_admin());
create policy "Admins update about blocks" on public.about_blocks for update to authenticated using (public.is_active_admin()) with check (public.is_active_admin());
create policy "Admins delete about blocks" on public.about_blocks for delete to authenticated using (public.is_active_admin());

drop policy if exists "Allow anon insert partner shops" on public.partner_shops;
drop policy if exists "Allow anon update partner shops" on public.partner_shops;
drop policy if exists "Allow anon delete partner shops" on public.partner_shops;
create policy "Admins insert partner shops" on public.partner_shops for insert to authenticated with check (public.is_active_admin());
create policy "Admins update partner shops" on public.partner_shops for update to authenticated using (public.is_active_admin()) with check (public.is_active_admin());
create policy "Admins delete partner shops" on public.partner_shops for delete to authenticated using (public.is_active_admin());

-- Schreibrechte fuer "anon" auf DB-Ebene komplett entziehen (Insert/Update/Delete).
-- Lesen bleibt erlaubt, INSERT/UPDATE/DELETE laufen jetzt ausschliesslich
-- ueber die admin-geprueften Policies fuer die Rolle "authenticated".
revoke insert, update, delete on public.incomes from anon;
revoke insert, update, delete on public.expenses from anon;
revoke insert, update, delete on public.investors from anon;
revoke insert, update, delete on public.updates from anon;
revoke insert, update, delete on public.streamer_links from anon;
revoke insert, update, delete on public.about_blocks from anon;
revoke insert, update, delete on public.partner_shops from anon;
grant insert, update, delete on public.incomes, public.expenses, public.investors, public.updates, public.streamer_links, public.about_blocks, public.partner_shops to authenticated;

-- ---------- 4) Kartenideen: oeffentliches Einreichen/Voten bleibt erhalten ----------
-- Einreichen (Insert) bleibt fuer alle offen - das ist eine bewusste, oeffentliche
-- Funktion der Seite ("Du hast einen Wunsch?").
drop policy if exists "Allow anon insert wishes" on public.wishes;
create policy "Public insert wishes" on public.wishes for insert to anon, authenticated with check (true);

-- Loeschen bleibt Admins vorbehalten.
drop policy if exists "Allow anon delete wishes" on public.wishes;
create policy "Admins delete wishes" on public.wishes for delete to authenticated using (public.is_active_admin());
revoke delete on public.wishes from anon;
grant delete on public.wishes to authenticated;

-- Update: oeffentliche Besucher duerfen nur noch likes/dislikes aendern
-- (Voting), nicht mehr Name oder Bild ueberschreiben. Admins duerfen alles.
-- Wichtig: Die "Public vote wishes"-Policy gilt bewusst NUR fuer "anon" (nicht
-- zusaetzlich "authenticated") - sonst wuerde sie per OR-Verknuepfung die
-- staerkere Admin-Pruefung fuer eingeloggte, aber nicht-aktive Nutzer aushebeln.
drop policy if exists "Allow anon update wishes" on public.wishes;
create policy "Public vote wishes" on public.wishes for update to anon using (true) with check (true);
create policy "Admins update wishes" on public.wishes for update to authenticated using (public.is_active_admin()) with check (public.is_active_admin());

revoke update on public.wishes from anon;
revoke update on public.wishes from authenticated;
grant update (likes, dislikes) on public.wishes to anon;
grant update on public.wishes to authenticated;

-- Anonyme Besucher: durch Spalten-Grant (nur likes/dislikes) UND die Policy
-- "Public vote wishes" beschraenkt. Eingeloggte Nutzer: voller Spaltenzugriff,
-- aber nur nutzbar, wenn "Admins update wishes" (aktiver Admin) zutrifft.

-- ---------- 5) Storage (Bilder): oeffentliche Wunsch-Uploads bleiben moeglich ----------
drop policy if exists "Allow anon upload update images" on storage.objects;
drop policy if exists "Allow anon update update images" on storage.objects;
drop policy if exists "Allow anon delete update images" on storage.objects;

-- Oeffentliche Besucher duerfen nur in den "wishes/"-Ordner hochladen.
create policy "Public upload wish images"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'update-images' and (storage.foldername(name))[1] = 'wishes');

-- Admins duerfen in alle Ordner des Buckets hochladen/aendern/loeschen
-- (News-Bilder, Wer-sind-wir-Galerien, PartnerShop-Logos, ...).
create policy "Admins upload update images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'update-images' and public.is_active_admin());

create policy "Admins update update images"
on storage.objects for update
to authenticated
using (bucket_id = 'update-images' and public.is_active_admin())
with check (bucket_id = 'update-images' and public.is_active_admin());

create policy "Admins delete update images"
on storage.objects for delete
to authenticated
using (bucket_id = 'update-images' and public.is_active_admin());
