-- Bkmp Investment Dashboard - Supabase Schema
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

create extension if not exists pgcrypto;

create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  amount numeric not null default 0,
  date date not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  amount numeric not null default 0,
  date date not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.investors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  investment numeric not null default 0,
  profit_percent numeric not null default 0,
  start_date date,
  end_date date,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.updates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  image_urls text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists incomes_date_idx on public.incomes (date desc, created_at desc);
create index if not exists expenses_date_idx on public.expenses (date desc, created_at desc);
create index if not exists investors_created_at_idx on public.investors (created_at desc);
create index if not exists updates_created_at_idx on public.updates (created_at desc);

alter table public.incomes enable row level security;
alter table public.expenses enable row level security;
alter table public.investors enable row level security;
alter table public.updates enable row level security;

drop policy if exists "Allow anon read incomes" on public.incomes;
create policy "Allow anon read incomes" on public.incomes for select to anon using (true);

drop policy if exists "Allow anon insert incomes" on public.incomes;
create policy "Allow anon insert incomes" on public.incomes for insert to anon with check (true);

drop policy if exists "Allow anon delete incomes" on public.incomes;
create policy "Allow anon delete incomes" on public.incomes for delete to anon using (true);

-- Fuer spaetere Schritte vorbereitet. Noch nicht in der App verdrahtet.
drop policy if exists "Allow anon read expenses" on public.expenses;
create policy "Allow anon read expenses" on public.expenses for select to anon using (true);

drop policy if exists "Allow anon read investors" on public.investors;
create policy "Allow anon read investors" on public.investors for select to anon using (true);

drop policy if exists "Allow anon read updates" on public.updates;
create policy "Allow anon read updates" on public.updates for select to anon using (true);

drop policy if exists "Allow anon insert investors" on public.investors;
create policy "Allow anon insert investors" on public.investors for insert to anon with check (true);

drop policy if exists "Allow anon update investors" on public.investors;
create policy "Allow anon update investors" on public.investors for update to anon using (true) with check (true);

drop policy if exists "Allow anon delete investors" on public.investors;
create policy "Allow anon delete investors" on public.investors for delete to anon using (true);
