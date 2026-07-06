-- Bkmp - Kartenideen (Wishes) Moderation
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Gleicher Freigabe-Workflow wie bei der Kartendatenbank: neu eingereichte
-- Kartenideen sind erst oeffentlich sichtbar, nachdem ein Admin sie im
-- Admin-Panel freigegeben hat.
--
-- WICHTIG: Dieses Skript braucht die Funktion public.is_active_admin(),
-- die von supabase-security-hardening.sql angelegt wird.

alter table public.wishes add column if not exists status text not null default 'approved';
update public.wishes set status = 'approved' where status is null;
alter table public.wishes alter column status set default 'pending';

alter table public.wishes drop constraint if exists wishes_status_check;
alter table public.wishes add constraint wishes_status_check check (status in ('pending', 'approved', 'rejected'));

create index if not exists wishes_status_idx on public.wishes (status);

-- Lesen: Oeffentlich sieht nur freigegebene Kartenideen. Admins sehen alles.
drop policy if exists "Allow anon read wishes" on public.wishes;
drop policy if exists "Public read approved wishes" on public.wishes;
create policy "Public read approved wishes"
on public.wishes for select
to anon, authenticated
using (status = 'approved');

drop policy if exists "Admins read all wishes" on public.wishes;
create policy "Admins read all wishes"
on public.wishes for select
to authenticated
using (public.is_active_admin());

-- Einreichen: weiterhin fuer alle offen, aber Status muss "pending" sein.
drop policy if exists "Allow anon insert wishes" on public.wishes;
drop policy if exists "Public insert wishes" on public.wishes;
create policy "Public insert wishes"
on public.wishes for insert
to anon, authenticated
with check (status = 'pending');

-- Voting (likes/dislikes) und Admin-Update/Delete-Policies aus
-- supabase-security-hardening.sql bleiben unveraendert bestehen und decken
-- auch das Freigeben/Ablehnen (status -> 'approved'/'rejected') mit ab.
