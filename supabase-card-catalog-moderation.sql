-- Bkmp - Kartendatenbank Moderation
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Fuehrt einen Freigabe-Workflow ein: neu eingereichte Karten sind erst
-- oeffentlich sichtbar, nachdem ein Admin sie im Admin-Panel freigegeben hat.
-- So kann niemand mehr direkt (unmoderiert) Inhalte auf der oeffentlichen
-- Seite veroeffentlichen, z. B. beleidigende oder rechtsradikale Bilder/Texte.
--
-- WICHTIG: Dieses Skript braucht die Funktion public.is_active_admin(),
-- die von supabase-security-hardening.sql angelegt wird.

-- 1) Spalte anlegen. Bestehende Eintraege gelten sofort als "approved"
--    (sie waren ja schon oeffentlich sichtbar), erst NEUE Eintraege
--    bekommen ab jetzt automatisch "pending".
alter table public.card_catalog add column if not exists status text not null default 'approved';
update public.card_catalog set status = 'approved' where status is null;
alter table public.card_catalog alter column status set default 'pending';

alter table public.card_catalog drop constraint if exists card_catalog_status_check;
alter table public.card_catalog add constraint card_catalog_status_check check (status in ('pending', 'approved'));

create index if not exists card_catalog_status_idx on public.card_catalog (status);

-- 2) Lesen: Oeffentlich sieht nur freigegebene Karten. Admins sehen alles
--    (inklusive "pending"), damit sie im Admin-Panel pruefen koennen.
drop policy if exists "Public read card catalog" on public.card_catalog;
drop policy if exists "Public read approved card catalog" on public.card_catalog;
create policy "Public read approved card catalog"
on public.card_catalog for select
to anon, authenticated
using (status = 'approved');

drop policy if exists "Admins read all card catalog" on public.card_catalog;
create policy "Admins read all card catalog"
on public.card_catalog for select
to authenticated
using (public.is_active_admin());

-- 3) Einreichen: Jeder darf weiterhin einreichen, aber der Status muss
--    "pending" sein - niemand kann sich per direktem API-Aufruf selbst
--    freigeben.
drop policy if exists "Public insert card catalog" on public.card_catalog;
create policy "Public insert card catalog"
on public.card_catalog for insert
to anon, authenticated
with check (status = 'pending');

-- Update/Delete-Policies fuer Admins bleiben unveraendert bestehen
-- (aus supabase-card-catalog-schema.sql) und decken auch das Freigeben
-- (status -> 'approved') mit ab.
