-- Bkmp - "Karten Verkaufen" Schema
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- WICHTIG: Dieses Skript braucht die Funktion public.is_active_admin(),
-- die von supabase-security-hardening.sql angelegt wird. Falls du dieses
-- Skript noch nicht ausgefuehrt hast, bitte zuerst nachholen.

create table if not exists public.card_sales (
  id uuid primary key default gen_random_uuid(),
  player_name text not null,
  image_url text,
  sold_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists card_sales_created_at_idx on public.card_sales (created_at desc);

alter table public.card_sales enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.card_sales to anon, authenticated;
grant insert, update, delete on public.card_sales to authenticated;

-- Lesen bleibt oeffentlich (wird auf der Website angezeigt).
drop policy if exists "Allow public read card sales" on public.card_sales;
create policy "Allow public read card sales" on public.card_sales for select to anon, authenticated using (true);

-- Schreiben (anlegen, Verkaufszaehler erhoehen, loeschen) nur fuer aktive Admins.
drop policy if exists "Admins insert card sales" on public.card_sales;
create policy "Admins insert card sales" on public.card_sales for insert to authenticated with check (public.is_active_admin());

drop policy if exists "Admins update card sales" on public.card_sales;
create policy "Admins update card sales" on public.card_sales for update to authenticated using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists "Admins delete card sales" on public.card_sales;
create policy "Admins delete card sales" on public.card_sales for delete to authenticated using (public.is_active_admin());
