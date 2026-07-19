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

create index if not exists partner_shops_created_at_idx
on public.partner_shops (created_at desc);

create index if not exists partner_shops_category_idx
on public.partner_shops (category);

alter table public.partner_shops enable row level security;

grant usage on schema public to anon;
grant usage on schema public to authenticated;

grant select, insert, update, delete on public.partner_shops to anon;
grant select, insert, update, delete on public.partner_shops to authenticated;

drop policy if exists "Allow anon read partner shops" on public.partner_shops;
create policy "Allow anon read partner shops"
on public.partner_shops
for select
to anon, authenticated
using (true);

drop policy if exists "Allow anon insert partner shops" on public.partner_shops;
create policy "Allow anon insert partner shops"
on public.partner_shops
for insert
to anon, authenticated
with check (true);

drop policy if exists "Allow anon update partner shops" on public.partner_shops;
create policy "Allow anon update partner shops"
on public.partner_shops
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Allow anon delete partner shops" on public.partner_shops;
create policy "Allow anon delete partner shops"
on public.partner_shops
for delete
to anon, authenticated
using (true);
