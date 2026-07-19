-- Bkmp - Kartenverkaufs-Anfragen Schema
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Braucht public.is_active_admin() aus supabase-security-hardening.sql.
--
-- Gleiches Muster wie investor_requests: jeder darf eine Anfrage einreichen
-- (Insert), aber nur aktive Admins duerfen die Liste sehen/bestaetigen/
-- ablehnen/loeschen - eine Verkaufsanfrage ist keine oeffentliche Karten-
-- Datenbank-Eintragung, sondern eine private Anfrage an die Adminschaft.

create table if not exists public.card_sale_requests (
  id uuid primary key default gen_random_uuid(),
  minecraft_name text not null,
  discord text,
  image_url text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.card_sale_requests
  drop constraint if exists card_sale_requests_status_check;
alter table public.card_sale_requests
  add constraint card_sale_requests_status_check check (status in ('pending', 'confirmed', 'rejected'));

create index if not exists card_sale_requests_created_at_idx on public.card_sale_requests (created_at desc);
create index if not exists card_sale_requests_status_idx on public.card_sale_requests (status);

alter table public.card_sale_requests enable row level security;

grant usage on schema public to anon, authenticated;
grant insert on public.card_sale_requests to anon, authenticated;
grant select, update, delete on public.card_sale_requests to authenticated;

-- Oeffentlich: nur Einreichen erlaubt (Status muss "pending" sein).
drop policy if exists "Public insert card sale requests" on public.card_sale_requests;
create policy "Public insert card sale requests"
on public.card_sale_requests for insert
to anon, authenticated
with check (status = 'pending');

-- Lesen/Bearbeiten/Loeschen nur fuer aktive Admins.
drop policy if exists "Admins read card sale requests" on public.card_sale_requests;
create policy "Admins read card sale requests"
on public.card_sale_requests for select
to authenticated
using (public.is_active_admin());

drop policy if exists "Admins update card sale requests" on public.card_sale_requests;
create policy "Admins update card sale requests"
on public.card_sale_requests for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

drop policy if exists "Admins delete card sale requests" on public.card_sale_requests;
create policy "Admins delete card sale requests"
on public.card_sale_requests for delete
to authenticated
using (public.is_active_admin());
