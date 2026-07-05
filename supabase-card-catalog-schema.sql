-- Bkmp - Kartendatenbank Schema
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- WICHTIG: Dieses Skript braucht die Funktion public.is_active_admin(),
-- die von supabase-security-hardening.sql angelegt wird. Falls du dieses
-- Skript noch nicht ausgefuehrt hast, bitte zuerst nachholen.
--
-- Oeffentliche Sammelbank aller Karten, die es auf dem Server gibt.
-- Jeder darf Karten hinzufuegen (Insert), aber nur aktive Admins duerfen
-- Eintraege bearbeiten oder loeschen (Schutz vor Vandalismus/Spam) -
-- genau wie bei den Kartenideen.

create table if not exists public.card_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  shop_name text,
  cb text,
  submitted_by text,
  description text,
  image_url text,
  created_at timestamptz not null default now()
);

create index if not exists card_catalog_created_at_idx on public.card_catalog (created_at desc);
create index if not exists card_catalog_category_idx on public.card_catalog (category);
create index if not exists card_catalog_shop_idx on public.card_catalog (shop_name);

alter table public.card_catalog enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert on public.card_catalog to anon, authenticated;
grant update, delete on public.card_catalog to authenticated;

drop policy if exists "Public read card catalog" on public.card_catalog;
create policy "Public read card catalog"
on public.card_catalog for select
to anon, authenticated
using (true);

drop policy if exists "Public insert card catalog" on public.card_catalog;
create policy "Public insert card catalog"
on public.card_catalog for insert
to anon, authenticated
with check (true);

drop policy if exists "Admins update card catalog" on public.card_catalog;
create policy "Admins update card catalog"
on public.card_catalog for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

drop policy if exists "Admins delete card catalog" on public.card_catalog;
create policy "Admins delete card catalog"
on public.card_catalog for delete
to authenticated
using (public.is_active_admin());

-- Bilder landen im bestehenden Storage-Bucket "update-images", Ordner "card-catalog".
-- Die dafuer noetigen Storage-Policies (oeffentlicher Upload in einen eigenen
-- Unterordner) ergaenzen wir hier gleich mit.
drop policy if exists "Public upload card catalog images" on storage.objects;
create policy "Public upload card catalog images"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'update-images' and (storage.foldername(name))[1] = 'card-catalog');
