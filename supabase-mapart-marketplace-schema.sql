-- Bkmp - MapArt Marketplace ("Kartenauftraege"): Firmen, Auftraege, privater
-- Chat/Dateien, Status-Workflow, Verlauf.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt komplett ausfuehren.
--
-- WICHTIG: Anders als die bisherigen Gamification-Tabellen (player_stats,
-- idle_player_state - offene RLS okay, da nur kosmetischer Wert) geht es hier
-- um private Geschaeftskommunikation. Kunden bekommen deshalb ein echtes,
-- aber unsichtbares Supabase-Auth-Konto (siehe supabase.js: bkmpCustomerSignUp/
-- bkmpCustomerRestoreByCode) statt nur einem selbst eingetippten Namen.
--
-- Reihenfolge in dieser Datei ist bewusst so gewaehlt (Funktionen/Tabellen vor
-- ihrer ersten Verwendung), bitte als Ganzes in einem Rutsch ausfuehren.

-- ============================================================
-- 0) KRITISCHER FIX: is_active_admin() darf die neue Rolle
--    'company' NICHT als Admin durchlassen. admin_profiles.role
--    existierte bisher nur dekorativ (admin/editor, nie geprueft).
-- ============================================================
create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_profiles
    where login_name = auth.jwt() ->> 'email'
    and active = true
    and coalesce(role, 'admin') in ('admin', 'editor')
  );
$$;

-- ============================================================
-- 1) companies - oeffentliche Firmenprofile
-- ============================================================
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  logo_url text,
  banner_url text,
  description text,
  discord_url text,
  website_url text,
  contact_person text,
  specialties text[] not null default '{}',
  price_range_min numeric,
  price_range_max numeric,
  showcase_image_urls text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.companies enable row level security;
grant usage on schema public to anon, authenticated;
grant select on public.companies to anon, authenticated;
grant insert, update, delete on public.companies to authenticated;

drop policy if exists "Public read active companies" on public.companies;
create policy "Public read active companies" on public.companies
for select to anon, authenticated using (active = true);

drop policy if exists "Admin read all companies" on public.companies;
create policy "Admin read all companies" on public.companies
for select to authenticated using (public.is_active_admin());

drop policy if exists "Admin insert companies" on public.companies;
create policy "Admin insert companies" on public.companies
for insert to authenticated with check (public.is_active_admin());

drop policy if exists "Admin delete companies" on public.companies;
create policy "Admin delete companies" on public.companies
for delete to authenticated using (public.is_active_admin());

-- ============================================================
-- 2) admin_profiles erweitern (bestehende Tabelle, keine neue) +
--    Hilfsfunktion is_company_staff_of()
-- ============================================================
alter table public.admin_profiles
  add column if not exists company_id uuid references public.companies(id) on delete set null,
  add column if not exists can_edit_profile boolean not null default false;

create or replace function public.is_company_staff_of(target_company_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select target_company_id is not null and exists (
    select 1 from public.admin_profiles
    where login_name = auth.jwt() ->> 'email'
      and active = true
      and role = 'company'
      and company_id = target_company_id
  );
$$;
grant execute on function public.is_active_admin() to anon, authenticated;
grant execute on function public.is_company_staff_of(uuid) to anon, authenticated;

-- companies.update: Admin immer, oder ein Firmen-Mitarbeiter dieser Firma,
-- dem der Admin explizit can_edit_profile erlaubt hat (Flag sitzt pro
-- Mitarbeiter-Account in admin_profiles, nicht auf der Firma selbst).
drop policy if exists "Admin or permitted staff update companies" on public.companies;
create policy "Admin or permitted staff update companies" on public.companies
for update to authenticated
using (
  public.is_active_admin()
  or exists (
    select 1 from public.admin_profiles ap
    where ap.login_name = auth.jwt() ->> 'email'
      and ap.active = true
      and ap.role = 'company'
      and ap.company_id = companies.id
      and ap.can_edit_profile = true
  )
)
with check (
  public.is_active_admin()
  or exists (
    select 1 from public.admin_profiles ap
    where ap.login_name = auth.jwt() ->> 'email'
      and ap.active = true
      and ap.role = 'company'
      and ap.company_id = companies.id
      and ap.can_edit_profile = true
  )
);

-- ============================================================
-- 3) customer_profiles - unsichtbares Kunden-Konto
-- ============================================================
create table if not exists public.customer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  discord text,
  created_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;
grant select, insert, update on public.customer_profiles to authenticated;

drop policy if exists "Owner or admin read customer profile" on public.customer_profiles;
create policy "Owner or admin read customer profile" on public.customer_profiles
for select to authenticated using (auth.uid() = id or public.is_active_admin());

drop policy if exists "Owner insert customer profile" on public.customer_profiles;
create policy "Owner insert customer profile" on public.customer_profiles
for insert to authenticated with check (auth.uid() = id);

drop policy if exists "Owner update customer profile" on public.customer_profiles;
create policy "Owner update customer profile" on public.customer_profiles
for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- ============================================================
-- 4) map_orders - Kartenauftraege
-- ============================================================
create sequence if not exists public.map_order_number_seq;

create table if not exists public.map_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null default ('A-' || lpad(nextval('public.map_order_number_seq')::text, 5, '0')),

  customer_auth_id uuid not null references auth.users(id),
  customer_display_name text not null,
  customer_discord text,

  title text not null,
  description text not null,
  category text not null check (category in ('pixelart','teppich','wolle','allblock','3d','sonstiges')),

  size_known boolean not null default false,
  size_width int,
  size_height int,
  size_parts int,
  size_notes text,

  budget_per_part numeric check (budget_per_part is null or (budget_per_part >= 250000 and budget_per_part <= 500000)),
  budget_is_custom boolean not null default false,
  budget_total numeric,

  desired_completion_date date,
  priority text not null default 'normal' check (priority in ('normal','schnell','egal')),

  reference_image_urls text[] not null default '{}',
  additional_notes text,

  status text not null default 'offen' check (status in
    ('neu','offen','angenommen','in_bearbeitung','rueckfrage','wartet_auf_kunde','fertig','abgeschlossen','abgebrochen')),

  assigned_company_id uuid references public.companies(id),
  assigned_at timestamptz,
  completed_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists map_orders_status_idx on public.map_orders (status);
create index if not exists map_orders_company_idx on public.map_orders (assigned_company_id);
create index if not exists map_orders_customer_idx on public.map_orders (customer_auth_id);
create unique index if not exists map_orders_order_number_unique on public.map_orders (order_number);

alter table public.map_orders enable row level security;
grant select on public.map_orders to anon, authenticated;
grant insert on public.map_orders to authenticated;

-- (a) Oeffentliches Auftragsbrett: auch fuer nicht angemeldete Besucher, NUR
-- unclaimte offene Auftraege - alles andere ist privat.
drop policy if exists "Public read open orders" on public.map_orders;
create policy "Public read open orders" on public.map_orders
for select to anon, authenticated
using (status = 'offen' and assigned_company_id is null);

-- (b) Beteiligte: Ersteller, Mitarbeiter der zugewiesenen Firma, Admins.
drop policy if exists "Participants read own orders" on public.map_orders;
create policy "Participants read own orders" on public.map_orders
for select to authenticated
using (
  auth.uid() = customer_auth_id
  or public.is_company_staff_of(assigned_company_id)
  or public.is_active_admin()
);

drop policy if exists "Customer create own order" on public.map_orders;
create policy "Customer create own order" on public.map_orders
for insert to authenticated
with check (
  auth.uid() = customer_auth_id
  and assigned_company_id is null
  and status in ('neu','offen')
);

-- Update-Policies: Kunde nur eigene Zeile, Firma nur zugewiesene Zeile, Admin alles.
-- assigned_company_id/assigned_at sind bewusst NICHT im allgemeinen Grant unten -
-- die kann ausschliesslich die Service-Role (api/claim-map-order.js) oder die
-- admin_reassign_order()-Funktion setzen.
drop policy if exists "Customer update own order" on public.map_orders;
create policy "Customer update own order" on public.map_orders
for update to authenticated
using (auth.uid() = customer_auth_id)
with check (auth.uid() = customer_auth_id);

drop policy if exists "Company update assigned order" on public.map_orders;
create policy "Company update assigned order" on public.map_orders
for update to authenticated
using (public.is_company_staff_of(assigned_company_id))
with check (public.is_company_staff_of(assigned_company_id));

drop policy if exists "Admin update any order" on public.map_orders;
create policy "Admin update any order" on public.map_orders
for update to authenticated
using (public.is_active_admin()) with check (public.is_active_admin());

drop policy if exists "Admin delete order" on public.map_orders;
create policy "Admin delete order" on public.map_orders
for delete to authenticated using (public.is_active_admin());
grant delete on public.map_orders to authenticated;

revoke update on public.map_orders from authenticated;
grant update (status, completed_at, title, description, category, size_known, size_width, size_height,
  size_parts, size_notes, budget_per_part, budget_is_custom, budget_total, desired_completion_date,
  priority, additional_notes) on public.map_orders to authenticated;

-- Admin-Funktion: Firma manuell zuweisen oder zuruecksetzen (einzige Stelle
-- neben der Service-Role, die assigned_company_id/assigned_at aendern darf).
create or replace function public.admin_reassign_order(p_order_id uuid, p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_admin() then
    raise exception 'not_authorized';
  end if;
  update public.map_orders
  set assigned_company_id = p_company_id,
      assigned_at = case when p_company_id is null then null else now() end,
      status = case when p_company_id is null then 'offen' else status end
  where id = p_order_id;

  insert into public.order_events (order_id, event_type, actor_type, actor_auth_id, to_status, detail)
  values (p_order_id, case when p_company_id is null then 'reset_to_open' else 'company_reassigned' end,
    'admin', auth.uid(), case when p_company_id is null then 'offen' else null end,
    case when p_company_id is null then 'Von Admin zurueckgesetzt' else 'Von Admin manuell zugewiesen' end);
end;
$$;
grant execute on function public.admin_reassign_order(uuid, uuid) to authenticated;

-- ============================================================
-- 5) order_files (vor order_messages, da diese darauf verweist)
-- ============================================================
create table if not exists public.order_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.map_orders(id) on delete cascade,
  uploaded_by_auth_id uuid not null,
  uploaded_by_display_name text not null,
  uploaded_by_type text not null check (uploaded_by_type in ('customer','company','admin')),
  file_name text not null,
  storage_path text not null,
  file_type text,
  file_size bigint,
  created_at timestamptz not null default now()
);
create index if not exists order_files_order_idx on public.order_files (order_id, created_at);

alter table public.order_files enable row level security;
grant select, insert on public.order_files to authenticated;

create or replace function public.is_order_participant(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.map_orders o
    where o.id = p_order_id
      and (
        o.customer_auth_id = auth.uid()
        or public.is_company_staff_of(o.assigned_company_id)
        or public.is_active_admin()
      )
  );
$$;
grant execute on function public.is_order_participant(uuid) to authenticated;

drop policy if exists "Participants read order files" on public.order_files;
create policy "Participants read order files" on public.order_files
for select to authenticated using (public.is_order_participant(order_id));

drop policy if exists "Participants add order files" on public.order_files;
create policy "Participants add order files" on public.order_files
for insert to authenticated
with check (public.is_order_participant(order_id) and uploaded_by_auth_id = auth.uid());

-- ============================================================
-- 6) order_messages - Chat
-- ============================================================
create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.map_orders(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer','company','admin')),
  sender_auth_id uuid not null,
  sender_display_name text not null,
  body text,
  attachment_file_id uuid references public.order_files(id),
  created_at timestamptz not null default now()
);
create index if not exists order_messages_order_idx on public.order_messages (order_id, created_at);

alter table public.order_messages enable row level security;
grant select, insert on public.order_messages to authenticated;

drop policy if exists "Participants read order messages" on public.order_messages;
create policy "Participants read order messages" on public.order_messages
for select to authenticated using (public.is_order_participant(order_id));

drop policy if exists "Participants send order messages" on public.order_messages;
create policy "Participants send order messages" on public.order_messages
for insert to authenticated
with check (public.is_order_participant(order_id) and sender_auth_id = auth.uid());

-- ============================================================
-- 7) order_events - Verlauf / Audit-Log
-- ============================================================
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.map_orders(id) on delete cascade,
  event_type text not null check (event_type in
    ('created','claimed','status_changed','message_sent','file_uploaded','completed','reset_to_open','company_reassigned','withdrawn')),
  actor_type text not null check (actor_type in ('customer','company','admin','system')),
  actor_auth_id uuid,
  actor_display_name text,
  from_status text,
  to_status text,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

alter table public.order_events enable row level security;
grant select, insert on public.order_events to authenticated;

drop policy if exists "Participants read order events" on public.order_events;
create policy "Participants read order events" on public.order_events
for select to authenticated using (public.is_order_participant(order_id));

drop policy if exists "Participants write order events" on public.order_events;
create policy "Participants write order events" on public.order_events
for insert to authenticated
with check (public.is_order_participant(order_id) and (actor_auth_id = auth.uid() or actor_type = 'system'));

-- ============================================================
-- 8) order_read_state - Ungelesen-Tracking
-- ============================================================
create table if not exists public.order_read_state (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.map_orders(id) on delete cascade,
  reader_auth_id uuid not null,
  last_read_at timestamptz not null default now(),
  unique (order_id, reader_auth_id)
);

alter table public.order_read_state enable row level security;
grant select, insert, update on public.order_read_state to authenticated;

drop policy if exists "Owner manage own read state" on public.order_read_state;
create policy "Owner manage own read state" on public.order_read_state
for all to authenticated
using (reader_auth_id = auth.uid() and public.is_order_participant(order_id))
with check (reader_auth_id = auth.uid() and public.is_order_participant(order_id));

-- ============================================================
-- 9) Storage: privater Bucket 'order-files'
-- ============================================================
insert into storage.buckets (id, name, public)
values ('order-files', 'order-files', false)
on conflict (id) do update set public = false;

grant usage on schema storage to authenticated;
grant select, insert on storage.objects to authenticated;

drop policy if exists "Participants read order-files objects" on storage.objects;
create policy "Participants read order-files objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'order-files'
  and public.is_order_participant((storage.foldername(name))[1]::uuid)
);

drop policy if exists "Participants upload order-files objects" on storage.objects;
create policy "Participants upload order-files objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'order-files'
  and public.is_order_participant((storage.foldername(name))[1]::uuid)
);

-- ============================================================
-- 10) Realtime fuer den Chat
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_messages'
  ) then
    alter publication supabase_realtime add table public.order_messages;
  end if;
end $$;
