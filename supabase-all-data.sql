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
