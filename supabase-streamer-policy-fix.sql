create table if not exists public.streamer_links (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  url text not null,
  color text not null default 'purple',
  created_at timestamptz not null default now()
);

create index if not exists streamer_links_created_at_idx
on public.streamer_links (created_at asc);

alter table public.streamer_links enable row level security;

grant usage on schema public to anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.streamer_links to anon;
grant select, insert, update, delete on public.streamer_links to authenticated;

drop policy if exists "Allow anon read streamer links" on public.streamer_links;
create policy "Allow anon read streamer links"
on public.streamer_links
for select
to anon, authenticated
using (true);

drop policy if exists "Allow anon insert streamer links" on public.streamer_links;
create policy "Allow anon insert streamer links"
on public.streamer_links
for insert
to anon, authenticated
with check (true);

drop policy if exists "Allow anon update streamer links" on public.streamer_links;
create policy "Allow anon update streamer links"
on public.streamer_links
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Allow anon delete streamer links" on public.streamer_links;
create policy "Allow anon delete streamer links"
on public.streamer_links
for delete
to anon, authenticated
using (true);
