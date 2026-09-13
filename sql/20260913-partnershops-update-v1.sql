-- ============================================================
-- BKInvestment - OPBK 1.1 "PARTNERSHOPS UPDATE" - Datenbank-Migration
--
-- NICHT automatisch gegen Produktion ausgefuehrt. Im Supabase Dashboard
-- > SQL Editor > New query > diesen kompletten Inhalt einfuegen > Run.
--
-- VORAUSSETZUNG: sql/20260902-mod-account-linking-and-submissions.sql
-- UND sql/20260905-card-teleport-tracking.sql muessen bereits gelaufen sein
-- (liefern public._resolve_mod_token() / public.check_and_record_rate_limit(),
-- die hier unveraendert wiederverwendet werden). Beide sind laut CLAUDE.md
-- bereits live ausgefuehrt.
--
-- Baut additiv auf dem bestehenden partner_shops-System auf (siehe
-- sql/supabase-schema.sql, sql/supabase-security-hardening.sql,
-- sql/supabase-partner-shops-moderation.sql, sql/supabase-partner-shops-
-- policy-fix.sql - alle bleiben unveraendert gueltig, nichts davon wird
-- hier geloescht/ersetzt, nur erweitert). Wiederverwendet bewusst bereits
-- bestehende, bewaehrte Bausteine statt sie zu duplizieren:
--   - public._resolve_mod_token(text)      (sql/20260902-...)
--   - public.check_and_record_rate_limit() (sql/20260902-...)
--   - public.is_active_admin()             (sql/supabase-security-hardening.sql)
-- Das Card-Teleport-Tracking-System (sql/20260905-card-teleport-tracking.sql)
-- ist die direkte strukturelle Vorlage fuer partner_shop_visit_events +
-- record_partner_shop_visit/get_partner_shop_visit_stats/
-- get_trending_partner_shops unten - bewusst 1:1 dasselbe Sicherheitsmuster
-- (deny-by-default Tabelle, nur per SECURITY DEFINER-RPC erreichbar).
--
-- HARTE GRUNDREGELN DIESER MIGRATION:
--   - Die bestehenden 27 genehmigten Shops bleiben unveraendert approved,
--     mit unveraendertem location-Freitext. KEINE automatische Migration
--     von location in partner_shop_locations (siehe Abschnitt 26 des
--     Auftrags - das passiert bewusst manuell im Admin-Panel).
--   - KEINE Spalte, die einen frei ausfuehrbaren Minecraft-Command
--     speichert. Nur citybuild (feste Allowlist CB1-CB6) + shop_warp
--     (enges Zeichen-Whitelist-Muster) - die Mod baut daraus selbst
--     "/nav CBx" + "/sw <shopWarp>" ueber den bereits bestehenden
--     ShopTeleportValidator/ShopTeleportStateMachine.
-- ============================================================

-- ============================================================
-- Teil 1: partner_shops additiv erweitern
-- ============================================================
alter table public.partner_shops add column if not exists owner_auth_user_id uuid references auth.users(id) on delete set null;
alter table public.partner_shops add column if not exists source text not null default 'website';
alter table public.partner_shops add column if not exists review_message text;
alter table public.partner_shops add column if not exists verified boolean not null default false;
alter table public.partner_shops add column if not exists active boolean not null default true;
alter table public.partner_shops add column if not exists spotlight_enabled boolean not null default true;
alter table public.partner_shops add column if not exists updated_at timestamptz not null default now();

alter table public.partner_shops drop constraint if exists partner_shops_source_check;
alter table public.partner_shops add constraint partner_shops_source_check check (source in ('website', 'mod'));

-- Status-Constraint um 'needs_changes' erweitern (bisher nur pending/
-- approved/rejected, siehe supabase-partner-shops-moderation.sql). Default
-- bleibt 'pending' - aendert nichts an bereits approved Zeilen.
alter table public.partner_shops drop constraint if exists partner_shops_status_check;
alter table public.partner_shops add constraint partner_shops_status_check check (status in ('pending', 'approved', 'rejected', 'needs_changes'));

create index if not exists partner_shops_owner_auth_user_id_idx on public.partner_shops(owner_auth_user_id);
create index if not exists partner_shops_active_idx on public.partner_shops(active);

-- updated_at automatisch pflegen (rein informativ, identisches Muster wie
-- sql/20260829-sw-daily-stats.sql).
create or replace function public.partner_shops_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists partner_shops_set_updated_at_trg on public.partner_shops;
create trigger partner_shops_set_updated_at_trg
  before update on public.partner_shops
  for each row
  execute function public.partner_shops_set_updated_at();

-- ------------------------------------------------------------
-- Teil 1b: RLS-Haertung der bestehenden oeffentlichen INSERT-Policy
-- ------------------------------------------------------------
-- "Public insert partner shops" (sql/supabase-partner-shops-moderation.sql)
-- prueft bisher NUR status='pending' - die neuen Spalten (verified/
-- owner_auth_user_id/active/spotlight_enabled/source) waeren dadurch ueber
-- einen rohen Insert mit dem OEFFENTLICHEN anon-Key frei mitsendbar (z.B.
-- verified=true oder eine fremde owner_auth_user_id). Die eigentliche
-- Website-Einreichung laeuft ueber api/submit-entry.js (Service-Role-Key,
-- umgeht RLS ohnehin) und die Mod-Einreichung ueber
-- create_partner_shop_submission() (SECURITY DEFINER, umgeht RLS ebenfalls) -
-- diese Policy betrifft also nur einen direkten Raw-REST-Aufruf mit dem
-- oeffentlichen anon-Key, ist aber trotzdem ein echtes Haertungsziel
-- (Abschnitt 0.4/10/18: "kein pauschales using(true) fuer Schreibrechte",
-- "owner_auth_user_id niemals frei mitsenden", "verified nur Admin").
drop policy if exists "Public insert partner shops" on public.partner_shops;
create policy "Public insert partner shops"
on public.partner_shops for insert
to anon, authenticated
with check (
  status = 'pending'
  and verified is not true
  and owner_auth_user_id is null
  and coalesce(source, 'website') = 'website'
);

-- Abschnitt 11: "Public APIs liefern standardmaessig nur status=approved
-- AND active=true" - bisher pruefte die oeffentliche SELECT-Policy
-- (sql/supabase-partner-shops-moderation.sql) nur status. Defense-in-
-- Depth: ein deaktivierter Shop (active=false) darf auch bei einem
-- rohen Raw-REST-Aufruf mit dem oeffentlichen anon-Key nicht sichtbar
-- sein, nicht nur client-seitig weggefiltert werden.
drop policy if exists "Public read approved partner shops" on public.partner_shops;
create policy "Public read approved partner shops"
on public.partner_shops for select
to anon, authenticated
using (status = 'approved' and active = true);

-- ============================================================
-- Teil 2: partner_shop_locations (strukturierte, sichere Teleport-Ziele)
-- ============================================================
create table if not exists public.partner_shop_locations (
  id uuid primary key default gen_random_uuid(),
  partner_shop_id uuid not null references public.partner_shops(id) on delete cascade,
  citybuild text not null,
  shop_warp text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_shop_locations_citybuild_check check (citybuild in ('CB1', 'CB2', 'CB3', 'CB4', 'CB5', 'CB6')),
  -- Identisches Zeichen-Whitelist-Muster wie der bestehende
  -- ShopTeleportValidator in der Mod (Mod-Repo:
  -- src/main/java/de/bkinvestment/cardbrowser/teleport/ShopTeleportValidator.java) -
  -- 1-32 Zeichen, nur Buchstaben/Ziffern/Unterstrich. Keine Slashes,
  -- Semikolons, Leerzeichen, Zeilenumbrueche - strukturell unmoeglich,
  -- hier einen Command-Separator einzuschmuggeln.
  constraint partner_shop_locations_shop_warp_check check (shop_warp ~ '^[A-Za-z0-9_]{1,32}$'),
  constraint partner_shop_locations_unique unique (partner_shop_id, citybuild, shop_warp)
);

create index if not exists partner_shop_locations_partner_shop_id_idx on public.partner_shop_locations(partner_shop_id);
create index if not exists partner_shop_locations_active_idx on public.partner_shop_locations(active);

create or replace function public.partner_shop_locations_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists partner_shop_locations_set_updated_at_trg on public.partner_shop_locations;
create trigger partner_shop_locations_set_updated_at_trg
  before update on public.partner_shop_locations
  for each row
  execute function public.partner_shop_locations_set_updated_at();

alter table public.partner_shop_locations enable row level security;

-- Oeffentlich nur aktive Standorte AKTIVER, genehmigter Shops lesen -
-- identisches Sichtbarkeitsprinzip wie partner_shops selbst.
drop policy if exists "Public read active partner shop locations" on public.partner_shop_locations;
create policy "Public read active partner shop locations" on public.partner_shop_locations
  for select to anon, authenticated
  using (
    active = true
    and exists (
      select 1 from public.partner_shops ps
      where ps.id = partner_shop_locations.partner_shop_id
        and ps.status = 'approved'
        and ps.active = true
    )
  );

drop policy if exists "Admins read all partner shop locations" on public.partner_shop_locations;
create policy "Admins read all partner shop locations" on public.partner_shop_locations
  for select to authenticated
  using (public.is_active_admin());

-- Schreiben nur durch Admins im Admin-Panel (direkte Standortpflege,
-- Abschnitt 24) ODER durch die SECURITY DEFINER-RPCs unten (die laufen mit
-- den Rechten des Funktionseigentuemers, RLS gilt fuer sie nicht - Mod-
-- Einreichung/Revision schreibt NIE direkt per PostgREST in diese Tabelle).
drop policy if exists "Admins insert partner shop locations" on public.partner_shop_locations;
create policy "Admins insert partner shop locations" on public.partner_shop_locations
  for insert to authenticated
  with check (public.is_active_admin());

drop policy if exists "Admins update partner shop locations" on public.partner_shop_locations;
create policy "Admins update partner shop locations" on public.partner_shop_locations
  for update to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

drop policy if exists "Admins delete partner shop locations" on public.partner_shop_locations;
create policy "Admins delete partner shop locations" on public.partner_shop_locations
  for delete to authenticated
  using (public.is_active_admin());

-- ============================================================
-- Teil 3: card_catalog <-> partner_shops Verknuepfung (additiv, optional)
-- ============================================================
alter table public.card_catalog add column if not exists partner_shop_id uuid references public.partner_shops(id) on delete set null;
create index if not exists card_catalog_partner_shop_id_idx on public.card_catalog(partner_shop_id);

-- ============================================================
-- Teil 4: partner_shop_visit_events (Besuchsstatistik, deny-by-default)
-- ============================================================
-- 1:1 dieselbe Architektur wie card_teleport_events (sql/20260905-card-
-- teleport-tracking.sql) - Tabelle fuer anon/authenticated strukturell
-- unerreichbar (RLS aktiv, bewusst KEINE Policies), nur ueber die beiden
-- SECURITY DEFINER-Funktionen in Teil 5 lesbar/schreibbar.
create table if not exists public.partner_shop_visit_events (
  id bigint generated always as identity primary key,
  partner_shop_id uuid not null references public.partner_shops(id) on delete cascade,
  partner_shop_location_id uuid references public.partner_shop_locations(id) on delete set null,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'mod',
  created_at timestamptz not null default now()
);

create index if not exists partner_shop_visit_events_shop_id_idx on public.partner_shop_visit_events(partner_shop_id);
create index if not exists partner_shop_visit_events_created_at_idx on public.partner_shop_visit_events(created_at desc);
create index if not exists partner_shop_visit_events_dedup_idx on public.partner_shop_visit_events(auth_user_id, partner_shop_id, created_at desc);

alter table public.partner_shop_visit_events enable row level security;
-- Bewusst KEINE Policies fuer anon/authenticated (deny-by-default).

-- ============================================================
-- Teil 5: partner_shop_revisions (Aenderungen an genehmigten Shops)
-- ============================================================
-- Abschnitt 58: ein approved Live-Shop bleibt unveraendert online+sichtbar,
-- bis eine eingereichte Aenderung vom Admin angenommen wurde. Typisierte
-- Spalten statt rohem JSON (Abschnitt 59) - nur die Standort-Liste einer
-- Revision braucht eine eigene Kind-Tabelle, da eine Revision mehrere
-- Standorte gleichzeitig aendern kann.
create table if not exists public.partner_shop_revisions (
  id uuid primary key default gen_random_uuid(),
  partner_shop_id uuid not null references public.partner_shops(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  name text,
  description text,
  category text,
  image_url text,
  -- true, wenn diese Revision die Standortliste des Shops ersetzen soll
  -- (siehe review_partner_shop_revision() unten) - false bedeutet "nur
  -- Name/Beschreibung/Kategorie/Logo geaendert, Standorte unangetastet".
  locations_changed boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_message text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create index if not exists partner_shop_revisions_shop_id_idx on public.partner_shop_revisions(partner_shop_id);
create index if not exists partner_shop_revisions_status_idx on public.partner_shop_revisions(status);
create index if not exists partner_shop_revisions_submitted_by_idx on public.partner_shop_revisions(submitted_by);

create table if not exists public.partner_shop_revision_locations (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.partner_shop_revisions(id) on delete cascade,
  citybuild text not null check (citybuild in ('CB1', 'CB2', 'CB3', 'CB4', 'CB5', 'CB6')),
  shop_warp text not null check (shop_warp ~ '^[A-Za-z0-9_]{1,32}$')
);

create index if not exists partner_shop_revision_locations_revision_id_idx on public.partner_shop_revision_locations(revision_id);

alter table public.partner_shop_revisions enable row level security;
alter table public.partner_shop_revision_locations enable row level security;

-- Website-Defense-in-Depth (die Mod selbst hat keine Supabase-Session und
-- nutzt stattdessen list_my_partner_shop_revisions() in Teil 7 unten).
drop policy if exists "Owner select own partner shop revisions" on public.partner_shop_revisions;
create policy "Owner select own partner shop revisions" on public.partner_shop_revisions
  for select to authenticated
  using (submitted_by = auth.uid());

drop policy if exists "Admins select all partner shop revisions" on public.partner_shop_revisions;
create policy "Admins select all partner shop revisions" on public.partner_shop_revisions
  for select to authenticated
  using (public.is_active_admin());

-- Admins duerfen im Admin-Panel direkt einsehen, welche Standorte eine
-- Revision vorschlaegt (join ueber revision_id) - kein eigenstaendiger
-- Owner-Zugriff noetig, die Mod liest das gebuendelt ueber die RPC unten.
drop policy if exists "Admins select partner shop revision locations" on public.partner_shop_revision_locations;
create policy "Admins select partner shop revision locations" on public.partner_shop_revision_locations
  for select to authenticated
  using (public.is_active_admin());

-- Absichtlich KEIN INSERT/UPDATE/DELETE-Policy fuer anon/authenticated auf
-- beiden Tabellen - Anlage nur ueber submit_partner_shop_revision(),
-- Entscheidung nur ueber review_partner_shop_revision() (beide unten,
-- SECURITY DEFINER).

-- ============================================================
-- Teil 6: partner_shop_reports (Shop melden, V1)
-- ============================================================
create table if not exists public.partner_shop_reports (
  id uuid primary key default gen_random_uuid(),
  partner_shop_id uuid not null references public.partner_shops(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  report_type text not null check (report_type in ('broken_warp', 'wrong_information', 'other')),
  message text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists partner_shop_reports_shop_id_idx on public.partner_shop_reports(partner_shop_id);
create index if not exists partner_shop_reports_status_idx on public.partner_shop_reports(status);

alter table public.partner_shop_reports enable row level security;

drop policy if exists "Admins select partner shop reports" on public.partner_shop_reports;
create policy "Admins select partner shop reports" on public.partner_shop_reports
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists "Admins update partner shop reports" on public.partner_shop_reports;
create policy "Admins update partner shop reports" on public.partner_shop_reports
  for update to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

-- Kein INSERT-Policy fuer anon/authenticated - Anlage nur ueber
-- report_partner_shop() (Teil 8, SECURITY DEFINER, eigenes Rate-Limit).

-- ============================================================
-- Teil 7: RPCs - Mod-Einreichung / Meine Shops / Revisionen
-- ============================================================

-- Mod-Seite: neuen Shop einreichen. status IMMER serverseitig 'pending',
-- source IMMER 'mod', owner_auth_user_id IMMER aus dem Token abgeleitet -
-- der Mod-Client kann keines dieser drei Felder selbst bestimmen
-- (Abschnitt 4/54, identisches Prinzip wie create_card_submission()).
-- p_citybuilds/p_shop_warps sind parallele Arrays (Index i gehoert
-- zusammen) statt eines JSON-Blobs - die STANDORTE werden trotzdem in
-- echten, typisierten partner_shop_locations-Zeilen gespeichert (keine
-- rohe JSON-Spalte als Langzeitspeicher, siehe Abschnitt 59-Prinzip auch
-- hier sinngemaess angewendet).
create or replace function public.create_partner_shop_submission(
  p_raw_token text,
  p_name text,
  p_description text,
  p_category text,
  p_image_url text default null,
  p_citybuilds text[] default '{}',
  p_shop_warps text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
  v_new_id uuid;
  v_rate_ok boolean;
  v_i integer;
  v_cb text;
  v_warp text;
begin
  v_uid := public._resolve_mod_token(p_raw_token);

  select public.check_and_record_rate_limit('partnershop_submission_create:' || v_uid::text, 'partnershop_submission_create', 10, 86400) into v_rate_ok;
  if not v_rate_ok then
    raise exception 'rate_limited';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name_required';
  end if;
  if length(coalesce(p_name, '')) > 120
    or length(coalesce(p_category, '')) > 60
    or length(coalesce(p_description, '')) > 2000
  then
    raise exception 'field_too_long';
  end if;
  -- Abschnitt 9: serverseitig feste Kategorie-Allowlist fuer NEUE,
  -- Mod-originierte Shops (Legacy-Kategorien auf Website-Bestandsshops
  -- bleiben unangetastet, siehe Teil 1 - diese Pruefung betrifft nur den
  -- Mod-Einreichungsweg).
  if p_category is not null and length(trim(p_category)) > 0 and p_category not in (
    'Karten', 'Bücher', 'Baumaterialien', 'Werkzeuge', 'Deko', 'Ankauf', 'Sonstiges'
  ) then
    raise exception 'invalid_category';
  end if;
  -- Nur Bilder akzeptieren, die tatsaechlich vom dafuer vorgesehenen
  -- Upload-Endpunkt stammen (api/partner-shop-submission-image.js) -
  -- identisches Absicherungsprinzip wie create_card_submission().
  if p_image_url is not null and length(trim(p_image_url)) > 0
    and p_image_url not like 'https://zgknyrwzpohvfdweomxf.supabase.co/storage/v1/object/public/update-images/partner-shop-submissions/%'
  then
    raise exception 'invalid_image_url';
  end if;

  if array_length(p_citybuilds, 1) is distinct from array_length(p_shop_warps, 1) then
    raise exception 'locations_mismatch';
  end if;
  if coalesce(array_length(p_citybuilds, 1), 0) > 6 then
    raise exception 'too_many_locations';
  end if;

  insert into public.partner_shops (shop_name, description, category, image_url, status, source, owner_auth_user_id, active, spotlight_enabled)
  values (trim(p_name), nullif(trim(coalesce(p_description, '')), ''), nullif(trim(coalesce(p_category, '')), ''), nullif(trim(coalesce(p_image_url, '')), ''), 'pending', 'mod', v_uid, true, true)
  returning id into v_new_id;

  if coalesce(array_length(p_citybuilds, 1), 0) > 0 then
    for v_i in 1..array_length(p_citybuilds, 1) loop
      v_cb := upper(trim(p_citybuilds[v_i]));
      v_warp := trim(p_shop_warps[v_i]);
      if v_cb not in ('CB1', 'CB2', 'CB3', 'CB4', 'CB5', 'CB6') then
        raise exception 'invalid_citybuild';
      end if;
      if v_warp !~ '^[A-Za-z0-9_]{1,32}$' then
        raise exception 'invalid_shop_warp';
      end if;
      insert into public.partner_shop_locations (partner_shop_id, citybuild, shop_warp, active)
      values (v_new_id, v_cb, v_warp, true)
      on conflict (partner_shop_id, citybuild, shop_warp) do nothing;
    end loop;
  end if;

  return v_new_id;
end;
$$;

revoke execute on function public.create_partner_shop_submission(text, text, text, text, text, text[], text[]) from public;
grant execute on function public.create_partner_shop_submission(text, text, text, text, text, text[], text[]) to anon, authenticated;

-- Mod-Seite: "Meine Shops" - ausschliesslich ueber die aus dem Token
-- abgeleitete auth_user_id gefiltert, kein Parameter fuer eine fremde ID
-- (IDOR strukturell ausgeschlossen, identisches Prinzip wie
-- list_my_mod_submissions()).
create or replace function public.list_my_partner_shops(p_raw_token text)
returns setof public.partner_shops
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
begin
  v_uid := public._resolve_mod_token(p_raw_token);
  return query select * from public.partner_shops where owner_auth_user_id = v_uid order by created_at desc;
end;
$$;

revoke execute on function public.list_my_partner_shops(text) from public;
grant execute on function public.list_my_partner_shops(text) to anon, authenticated;

-- Mod-Seite: eigene Standorte EINES eigenen Shops lesen (Shop-Detail +
-- "Meine Shops"-Bearbeitungsansicht). Prueft Besitz serverseitig, bevor
-- irgendetwas zurueckgegeben wird.
create or replace function public.list_my_partner_shop_locations(p_raw_token text, p_partner_shop_id uuid)
returns setof public.partner_shop_locations
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
  v_owner uuid;
begin
  v_uid := public._resolve_mod_token(p_raw_token);
  select owner_auth_user_id into v_owner from public.partner_shops where id = p_partner_shop_id;
  if v_owner is null or v_owner <> v_uid then
    raise exception 'not_owner';
  end if;
  return query select * from public.partner_shop_locations where partner_shop_id = p_partner_shop_id order by citybuild;
end;
$$;

revoke execute on function public.list_my_partner_shop_locations(text, uuid) from public;
grant execute on function public.list_my_partner_shop_locations(text, uuid) to anon, authenticated;

-- Mod-Seite: Aenderung an einem EIGENEN, bereits genehmigten Shop
-- einreichen (Abschnitt 57/58). Der Live-Shop bleibt dabei unveraendert
-- sichtbar - es entsteht nur eine neue pending-Revision. leere
-- p_citybuilds/p_shop_warps-Arrays bedeuten "Standorte nicht aendern"
-- (locations_changed=false); werden Standorte explizit mitgeschickt (auch
-- eine leere Liste als bewusste "alle entfernen"-Absicht zu modellieren
-- waere hier zu riskant fuer V1 - daher: Standorte aendern heisst immer
-- mindestens 1 Standort mitschicken).
create or replace function public.submit_partner_shop_revision(
  p_raw_token text,
  p_partner_shop_id uuid,
  p_name text default null,
  p_description text default null,
  p_category text default null,
  p_image_url text default null,
  p_citybuilds text[] default '{}',
  p_shop_warps text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
  v_owner uuid;
  v_rate_ok boolean;
  v_revision_id uuid;
  v_locations_changed boolean;
  v_i integer;
  v_cb text;
  v_warp text;
begin
  v_uid := public._resolve_mod_token(p_raw_token);

  select owner_auth_user_id into v_owner from public.partner_shops where id = p_partner_shop_id;
  if v_owner is null or v_owner <> v_uid then
    raise exception 'not_owner';
  end if;

  select public.check_and_record_rate_limit('partnershop_revision_create:' || v_uid::text, 'partnershop_revision_create', 10, 86400) into v_rate_ok;
  if not v_rate_ok then
    raise exception 'rate_limited';
  end if;

  if p_name is not null and length(trim(p_name)) > 120 then raise exception 'field_too_long'; end if;
  if p_description is not null and length(trim(p_description)) > 2000 then raise exception 'field_too_long'; end if;
  if p_category is not null and length(trim(p_category)) > 60 then raise exception 'field_too_long'; end if;
  if p_category is not null and length(trim(p_category)) > 0 and p_category not in (
    'Karten', 'Bücher', 'Baumaterialien', 'Werkzeuge', 'Deko', 'Ankauf', 'Sonstiges'
  ) then
    raise exception 'invalid_category';
  end if;
  if p_image_url is not null and length(trim(p_image_url)) > 0
    and p_image_url not like 'https://zgknyrwzpohvfdweomxf.supabase.co/storage/v1/object/public/update-images/partner-shop-submissions/%'
  then
    raise exception 'invalid_image_url';
  end if;
  if array_length(p_citybuilds, 1) is distinct from array_length(p_shop_warps, 1) then
    raise exception 'locations_mismatch';
  end if;
  if coalesce(array_length(p_citybuilds, 1), 0) > 6 then
    raise exception 'too_many_locations';
  end if;

  v_locations_changed := coalesce(array_length(p_citybuilds, 1), 0) > 0;

  insert into public.partner_shop_revisions (partner_shop_id, submitted_by, name, description, category, image_url, locations_changed, status)
  values (
    p_partner_shop_id, v_uid,
    nullif(trim(coalesce(p_name, '')), ''), nullif(trim(coalesce(p_description, '')), ''),
    nullif(trim(coalesce(p_category, '')), ''), nullif(trim(coalesce(p_image_url, '')), ''),
    v_locations_changed, 'pending'
  )
  returning id into v_revision_id;

  if v_locations_changed then
    for v_i in 1..array_length(p_citybuilds, 1) loop
      v_cb := upper(trim(p_citybuilds[v_i]));
      v_warp := trim(p_shop_warps[v_i]);
      if v_cb not in ('CB1', 'CB2', 'CB3', 'CB4', 'CB5', 'CB6') then
        raise exception 'invalid_citybuild';
      end if;
      if v_warp !~ '^[A-Za-z0-9_]{1,32}$' then
        raise exception 'invalid_shop_warp';
      end if;
      insert into public.partner_shop_revision_locations (revision_id, citybuild, shop_warp)
      values (v_revision_id, v_cb, v_warp);
    end loop;
  end if;

  return v_revision_id;
end;
$$;

revoke execute on function public.submit_partner_shop_revision(text, uuid, text, text, text, text, text[], text[]) from public;
grant execute on function public.submit_partner_shop_revision(text, uuid, text, text, text, text, text[], text[]) to anon, authenticated;

-- Mod-Seite: eigene Revisionen eines Shops einsehen (Status "Wird
-- geprueft"/"Aenderung erforderlich"/"Abgelehnt", Abschnitt 56).
create or replace function public.list_my_partner_shop_revisions(p_raw_token text, p_partner_shop_id uuid default null)
returns setof public.partner_shop_revisions
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
begin
  v_uid := public._resolve_mod_token(p_raw_token);
  return query
    select * from public.partner_shop_revisions
    where submitted_by = v_uid
      and (p_partner_shop_id is null or partner_shop_id = p_partner_shop_id)
    order by created_at desc;
end;
$$;

revoke execute on function public.list_my_partner_shop_revisions(text, uuid) from public;
grant execute on function public.list_my_partner_shop_revisions(text, uuid) to anon, authenticated;

-- Admin-Seite (Website, admin.html): Revision annehmen/ablehnen. Nur bei
-- 'approve' UND locations_changed=true wird die Standortliste des Shops
-- ATOMAR ersetzt (alte Standorte geloescht, neue aus der Revision
-- eingefuegt) - eine Revision ohne Standort-Aenderung laesst bestehende
-- Standorte unangetastet.
create or replace function public.review_partner_shop_revision(p_revision_id uuid, p_action text, p_review_message text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.partner_shop_revisions%rowtype;
  v_admin text := auth.jwt() ->> 'email';
begin
  if not public.is_active_admin() then
    raise exception 'not_admin';
  end if;
  if p_action not in ('approve', 'reject') then
    raise exception 'invalid_action';
  end if;

  select * into v_row from public.partner_shop_revisions where id = p_revision_id for update;
  if v_row.id is null then
    raise exception 'revision_not_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'revision_not_pending';
  end if;

  if p_action = 'approve' then
    update public.partner_shops set
      shop_name = coalesce(v_row.name, shop_name),
      description = coalesce(v_row.description, description),
      category = coalesce(v_row.category, category),
      image_url = coalesce(v_row.image_url, image_url)
    where id = v_row.partner_shop_id;

    if v_row.locations_changed then
      delete from public.partner_shop_locations where partner_shop_id = v_row.partner_shop_id;
      insert into public.partner_shop_locations (partner_shop_id, citybuild, shop_warp, active)
      select v_row.partner_shop_id, rl.citybuild, rl.shop_warp, true
      from public.partner_shop_revision_locations rl
      where rl.revision_id = v_row.id;
    end if;

    update public.partner_shop_revisions
    set status = 'approved', review_message = p_review_message, reviewed_at = now(), reviewed_by = v_admin
    where id = p_revision_id;
  else
    update public.partner_shop_revisions
    set status = 'rejected', review_message = p_review_message, reviewed_at = now(), reviewed_by = v_admin
    where id = p_revision_id;
  end if;
end;
$$;

revoke execute on function public.review_partner_shop_revision(uuid, text, text) from public;
grant execute on function public.review_partner_shop_revision(uuid, text, text) to authenticated;

-- ============================================================
-- Teil 8: RPC - Shop melden (V1)
-- ============================================================
-- Anonym ODER per Mod-Token aufrufbar (website-Karten ohne Login duerfen
-- spaeter ebenfalls melden, daher p_raw_token optional). Rate-Limit pro
-- Shop (globaler Spam-Deckel, Abschnitt 62) UND zusaetzlich pro Account,
-- falls ein Token mitgeschickt wurde.
create or replace function public.report_partner_shop(p_partner_shop_id uuid, p_report_type text, p_message text default null, p_raw_token text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := null;
  v_rate_ok boolean;
begin
  if p_report_type not in ('broken_warp', 'wrong_information', 'other') then
    raise exception 'invalid_report_type';
  end if;
  if p_message is not null and length(p_message) > 500 then
    raise exception 'message_too_long';
  end if;
  if not exists (select 1 from public.partner_shops where id = p_partner_shop_id) then
    raise exception 'shop_not_found';
  end if;

  select public.check_and_record_rate_limit('partnershop_report_shop:' || p_partner_shop_id::text, 'partnershop_report', 20, 3600) into v_rate_ok;
  if not v_rate_ok then
    raise exception 'rate_limited';
  end if;

  if p_raw_token is not null and length(trim(p_raw_token)) > 0 then
    begin
      v_uid := public._resolve_mod_token(p_raw_token);
    exception when others then
      v_uid := null;
    end;
    if v_uid is not null then
      select public.check_and_record_rate_limit('partnershop_report_user:' || v_uid::text, 'partnershop_report', 10, 86400) into v_rate_ok;
      if not v_rate_ok then
        raise exception 'rate_limited';
      end if;
    end if;
  end if;

  insert into public.partner_shop_reports (partner_shop_id, auth_user_id, report_type, message)
  values (p_partner_shop_id, v_uid, p_report_type, nullif(trim(coalesce(p_message, '')), ''));
end;
$$;

revoke execute on function public.report_partner_shop(uuid, text, text, text) from public;
grant execute on function public.report_partner_shop(uuid, text, text, text) to anon, authenticated;

-- ============================================================
-- Teil 9: Besuchsstatistik - Aufzeichnen + Aggregation (analog Karten)
-- ============================================================

-- Einziger Schreibweg. Teleport wird IMMER von der Mod bereits ausgefuehrt,
-- bevor dieser Aufruf passiert (Abschnitt 46, fail-open) - ein fehl-
-- geschlagener/deduplizierter Aufruf hier darf den Teleport nie nachtraeglich
-- verhindern, das ist bereits laengst passiert.
create or replace function public.record_partner_shop_visit(p_raw_token text, p_partner_shop_id uuid, p_partner_shop_location_id uuid default null)
returns table (recorded boolean, reason text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
  v_shop_status text;
  v_shop_active boolean;
  v_location_ok boolean;
  v_rate_ok boolean;
begin
  v_uid := public._resolve_mod_token(p_raw_token);

  if p_partner_shop_id is null then
    raise exception 'shop_not_found';
  end if;

  select status, active into v_shop_status, v_shop_active from public.partner_shops where id = p_partner_shop_id;
  if v_shop_status is null or v_shop_status <> 'approved' or v_shop_active is distinct from true then
    raise exception 'shop_not_found';
  end if;

  if p_partner_shop_location_id is not null then
    select exists(
      select 1 from public.partner_shop_locations
      where id = p_partner_shop_location_id and partner_shop_id = p_partner_shop_id and active = true
    ) into v_location_ok;
    if not v_location_ok then
      raise exception 'location_not_found';
    end if;
  end if;

  -- Dedup: max. 1 gezaehlter Besuch pro (Account, Shop) innerhalb von 5
  -- Minuten - identische Semantik/identischer Wert wie
  -- record_card_teleport().
  select public.check_and_record_rate_limit(
    'partnershop_visit:' || v_uid::text || ':' || p_partner_shop_id::text,
    'partnershop_visit_record',
    1,
    300
  ) into v_rate_ok;

  if not v_rate_ok then
    return query select false, 'deduplicated';
    return;
  end if;

  insert into public.partner_shop_visit_events (partner_shop_id, partner_shop_location_id, auth_user_id, source)
  values (p_partner_shop_id, p_partner_shop_location_id, v_uid, 'mod');

  return query select true, null::text;
end;
$$;

revoke execute on function public.record_partner_shop_visit(text, uuid, uuid) from public;
grant execute on function public.record_partner_shop_visit(text, uuid, uuid) to anon, authenticated;

-- Shop-Detail: aggregierte Besuchszahlen (nie Einzeldaten, Abschnitt 47).
create or replace function public.get_partner_shop_visit_stats(p_partner_shop_id uuid)
returns table (
  visits_24h bigint,
  visits_7d bigint,
  visits_30d bigint,
  visits_all_time bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select
    count(*) filter (where created_at >= now() - interval '24 hours'),
    count(*) filter (where created_at >= now() - interval '7 days'),
    count(*) filter (where created_at >= now() - interval '30 days'),
    count(*)
  from public.partner_shop_visit_events
  where partner_shop_id = p_partner_shop_id;
$$;

revoke execute on function public.get_partner_shop_visit_stats(uuid) from public;
grant execute on function public.get_partner_shop_visit_stats(uuid) to anon, authenticated;

-- Trending-Shops je Zeitraum (Website + Mod). Feste Perioden-Allowlist,
-- hartes Server-Limit (<=50) - identisches Muster wie get_trending_cards().
create or replace function public.get_trending_partner_shops(p_period text, p_limit integer default 5)
returns table (
  id uuid,
  shop_name text,
  image_url text,
  location text,
  category text,
  description text,
  link text,
  contact text,
  verified boolean,
  created_at timestamptz,
  updated_at timestamptz,
  visit_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_since timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 50);
begin
  if p_period = '24h' then
    v_since := now() - interval '24 hours';
  elsif p_period = '7d' then
    v_since := now() - interval '7 days';
  elsif p_period = '30d' then
    v_since := now() - interval '30 days';
  elsif p_period = 'all' then
    v_since := null;
  else
    raise exception 'invalid_period';
  end if;

  return query
    select
      s.id, s.shop_name, s.image_url, s.location, s.category, s.description, s.link, s.contact,
      s.verified, s.created_at, s.updated_at,
      count(e.id)::bigint as visit_count
    from public.partner_shop_visit_events e
    join public.partner_shops s on s.id = e.partner_shop_id and s.status = 'approved' and s.active = true
    where v_since is null or e.created_at >= v_since
    group by s.id
    order by visit_count desc, s.created_at desc
    limit v_limit;
end;
$$;

revoke execute on function public.get_trending_partner_shops(text, integer) from public;
grant execute on function public.get_trending_partner_shops(text, integer) to anon, authenticated;
