-- Bkmp - Investoren-Anfragen Schema
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- WICHTIG: Dieses Skript braucht die Funktion public.is_active_admin(),
-- die von supabase-security-hardening.sql angelegt wird. Falls du dieses
-- Skript noch nicht ausgefuehrt hast, bitte zuerst nachholen.
--
-- Besonderheit dieser Tabelle: Anders als bei allen anderen Tabellen ist
-- hier das LESEN nicht oeffentlich. Jeder darf eine Anfrage einreichen
-- (Insert), aber nur aktive Admins duerfen die Liste der Anfragen sehen,
-- bestaetigen, ablehnen oder loeschen.

create table if not exists public.investor_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  minecraft_name text,
  anonymous boolean not null default false,
  amount numeric not null,
  share_percent numeric not null,
  period_months integer not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.investor_requests
  drop constraint if exists investor_requests_amount_check;
alter table public.investor_requests
  add constraint investor_requests_amount_check check (amount >= 50000000 and amount <= 150000000);

alter table public.investor_requests
  drop constraint if exists investor_requests_share_check;
alter table public.investor_requests
  add constraint investor_requests_share_check check (share_percent >= 5 and share_percent <= 15);

alter table public.investor_requests
  drop constraint if exists investor_requests_period_check;
alter table public.investor_requests
  add constraint investor_requests_period_check check (period_months > 0);

alter table public.investor_requests
  drop constraint if exists investor_requests_status_check;
alter table public.investor_requests
  add constraint investor_requests_status_check check (status in ('pending', 'confirmed', 'rejected'));

create index if not exists investor_requests_created_at_idx on public.investor_requests (created_at desc);
create index if not exists investor_requests_status_idx on public.investor_requests (status);

alter table public.investor_requests enable row level security;

grant usage on schema public to anon, authenticated;
grant insert on public.investor_requests to anon, authenticated;
grant select, update, delete on public.investor_requests to authenticated;

-- Oeffentlich: nur Einreichen erlaubt (Status muss "pending" sein, damit
-- niemand sich per direktem API-Aufruf selbst als "confirmed" eintraegt).
drop policy if exists "Public insert investor requests" on public.investor_requests;
create policy "Public insert investor requests"
on public.investor_requests for insert
to anon, authenticated
with check (status = 'pending');

-- Lesen/Bearbeiten/Loeschen nur fuer aktive Admins - Anfragen sind NICHT
-- oeffentlich sichtbar.
drop policy if exists "Admins read investor requests" on public.investor_requests;
create policy "Admins read investor requests"
on public.investor_requests for select
to authenticated
using (public.is_active_admin());

drop policy if exists "Admins update investor requests" on public.investor_requests;
create policy "Admins update investor requests"
on public.investor_requests for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

drop policy if exists "Admins delete investor requests" on public.investor_requests;
create policy "Admins delete investor requests"
on public.investor_requests for delete
to authenticated
using (public.is_active_admin());
