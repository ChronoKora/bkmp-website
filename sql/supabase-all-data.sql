-- Bkmp Investment Dashboard - alle Daten in Supabase
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.


-- Vollstaendige Supabase-Anbindung fuer alle aktuellen Dashboard-Daten.
create table if not exists public.wishes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists wishes_created_at_idx on public.wishes (created_at desc);

alter table public.wishes add column if not exists likes integer not null default 0;
alter table public.wishes add column if not exists dislikes integer not null default 0;

alter table public.expenses enable row level security;
alter table public.investors enable row level security;
alter table public.updates enable row level security;
alter table public.wishes enable row level security;

drop policy if exists "Allow anon insert expenses" on public.expenses;
create policy "Allow anon insert expenses" on public.expenses for insert to anon with check (true);

drop policy if exists "Allow anon delete expenses" on public.expenses;
create policy "Allow anon delete expenses" on public.expenses for delete to anon using (true);

drop policy if exists "Allow anon insert updates" on public.updates;
create policy "Allow anon insert updates" on public.updates for insert to anon with check (true);

drop policy if exists "Allow anon delete updates" on public.updates;
create policy "Allow anon delete updates" on public.updates for delete to anon using (true);

drop policy if exists "Allow anon read wishes" on public.wishes;
create policy "Allow anon read wishes" on public.wishes for select to anon using (true);

drop policy if exists "Allow anon insert wishes" on public.wishes;
create policy "Allow anon insert wishes" on public.wishes for insert to anon with check (true);

drop policy if exists "Allow anon delete wishes" on public.wishes;
create policy "Allow anon delete wishes" on public.wishes for delete to anon using (true);

drop policy if exists "Allow anon update wishes" on public.wishes;
create policy "Allow anon update wishes" on public.wishes for update to anon using (true) with check (true);



drop policy if exists "Allow anon update updates" on public.updates;
create policy "Allow anon update updates" on public.updates for update to anon using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('update-images', 'update-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Allow anon read update images" on storage.objects;
create policy "Allow anon read update images"
on storage.objects for select
to anon
using (bucket_id = 'update-images');

drop policy if exists "Allow anon upload update images" on storage.objects;
create policy "Allow anon upload update images"
on storage.objects for insert
to anon
with check (bucket_id = 'update-images');

drop policy if exists "Allow anon update update images" on storage.objects;
create policy "Allow anon update update images"
on storage.objects for update
to anon
using (bucket_id = 'update-images')
with check (bucket_id = 'update-images');

create table if not exists public.streamer_links (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  url text not null,
  color text not null default 'purple',
  created_at timestamptz not null default now()
);

create index if not exists streamer_links_created_at_idx on public.streamer_links (created_at asc);

alter table public.streamer_links enable row level security;

drop policy if exists "Allow anon read streamer links" on public.streamer_links;
create policy "Allow anon read streamer links" on public.streamer_links for select to anon using (true);

drop policy if exists "Allow anon insert streamer links" on public.streamer_links;
create policy "Allow anon insert streamer links" on public.streamer_links for insert to anon with check (true);

drop policy if exists "Allow anon update streamer links" on public.streamer_links;
create policy "Allow anon update streamer links" on public.streamer_links for update to anon using (true) with check (true);

drop policy if exists "Allow anon delete streamer links" on public.streamer_links;
create policy "Allow anon delete streamer links" on public.streamer_links for delete to anon using (true);

create table if not exists public.about_blocks (
  id uuid primary key default gen_random_uuid(),
  block_type text not null default 'text',
  title text,
  content text,
  image_url text,
  image_urls jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists about_blocks_sort_order_idx on public.about_blocks (sort_order asc, created_at asc);

alter table public.about_blocks enable row level security;

drop policy if exists "Allow anon read about blocks" on public.about_blocks;
create policy "Allow anon read about blocks" on public.about_blocks for select to anon using (true);

drop policy if exists "Allow anon insert about blocks" on public.about_blocks;
create policy "Allow anon insert about blocks" on public.about_blocks for insert to anon with check (true);

drop policy if exists "Allow anon update about blocks" on public.about_blocks;
create policy "Allow anon update about blocks" on public.about_blocks for update to anon using (true) with check (true);

drop policy if exists "Allow anon delete about blocks" on public.about_blocks;
create policy "Allow anon delete about blocks" on public.about_blocks for delete to anon using (true);

create table if not exists public.partner_shops (
  id uuid primary key default gen_random_uuid(),
  shop_name text not null,
  image_url text,
  location text,
  category text,
  description text,
  link text,
  contact text,
  created_at timestamptz not null default now()
);

create index if not exists partner_shops_created_at_idx on public.partner_shops (created_at desc);
create index if not exists partner_shops_category_idx on public.partner_shops (category);

alter table public.partner_shops enable row level security;

drop policy if exists "Allow anon read partner shops" on public.partner_shops;
create policy "Allow anon read partner shops" on public.partner_shops for select to anon using (true);

drop policy if exists "Allow anon insert partner shops" on public.partner_shops;
create policy "Allow anon insert partner shops" on public.partner_shops for insert to anon with check (true);

drop policy if exists "Allow anon update partner shops" on public.partner_shops;
create policy "Allow anon update partner shops" on public.partner_shops for update to anon using (true) with check (true);

drop policy if exists "Allow anon delete partner shops" on public.partner_shops;
create policy "Allow anon delete partner shops" on public.partner_shops for delete to anon using (true);

create table if not exists public.admin_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  display_name text not null,
  login_name text not null unique,
  role text not null default 'admin',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists admin_profiles_login_name_idx on public.admin_profiles (login_name);

alter table public.admin_profiles enable row level security;

drop policy if exists "Allow authenticated read admin profiles" on public.admin_profiles;
create policy "Allow authenticated read admin profiles" on public.admin_profiles for select to authenticated using (true);

drop policy if exists "Allow authenticated insert admin profiles" on public.admin_profiles;
create policy "Allow authenticated insert admin profiles" on public.admin_profiles for insert to authenticated with check (true);

drop policy if exists "Allow authenticated update admin profiles" on public.admin_profiles;
create policy "Allow authenticated update admin profiles" on public.admin_profiles for update to authenticated using (true) with check (true);
