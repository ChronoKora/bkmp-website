/* ============================================================
   Bkmp - "Karten Verkaufen": Besitzer-Verknuepfung + Auszahlungssystem
   (siehe Plan in C:\Users\David\.claude\plans\wild-juggling-garden.md)

   Bindet jede genehmigte Verkaufs-Karte an eine STABILE Benutzer-ID
   (auth_user_id, wie idle_player_runes/idle_player_state - NICHT an
   den aenderbaren Spielernamen, siehe der bereits dokumentierte
   Rename-Bug vom 25.07.2026 fuer name_key-only-Tabellen) und fuehrt
   ein serverseitig atomares Auszahlungssystem ein.

   WICHTIG (Nutzer-Vorgabe): "Verdient" und "Ausgezahlt" sind ZWEI
   komplett getrennte Groessen, die NIE vermischt werden duerfen -
   card_sale_events.amount summiert IMMER den vollen historischen
   Verdienst (unabhaengig vom Auszahlungsstatus), waehrend nur
   card_sellers.historical_starting_paid_out + tatsaechlich als
   'paid' markierte card_sale_payout_requests als "ausgezahlt" gelten.

   Braucht public.is_active_admin() (sql/supabase-security-hardening.sql
   bzw. die aktuellere Fassung in sql/supabase-mapart-marketplace-schema.sql)
   und die bestehenden Tabellen public.card_sales / public.card_sale_requests
   / public.player_stats.

   NICHT automatisch ausgefuehrt. Getrennt von der Backfill-Datei
   (sql/20260901-card-sale-ownership-backfill.sql), damit beide
   unabhaengig voneinander geprueft/ausgefuehrt werden koennen.
   ============================================================ */

-- ---------- 1. Bestehende Tabellen erweitern (additiv, nichts wird zurueckgesetzt) ----------

alter table public.card_sales add column if not exists auth_user_id uuid;
create index if not exists card_sales_auth_user_id_idx on public.card_sales (auth_user_id);

alter table public.card_sale_requests add column if not exists auth_user_id uuid;
create index if not exists card_sale_requests_auth_user_id_idx on public.card_sale_requests (auth_user_id);

-- ---------- 2. card_sale_events - echtes Verkaufs-Log mit Zeitstempel ----------
-- Ersetzt den bisherigen reinen Integer-Zaehler (card_sales.sold_count),
-- damit ein echter 30-Tage-Chart / eine echte "diese Woche verdient"-KPI
-- moeglich ist. Bewusst OHNE eigene Owner-Spalte - Besitz wird immer ueber
-- den Join zu card_sales.auth_user_id abgeleitet, damit eine nachtraegliche
-- Besitzer-Korrektur (Admin-"Zuordnen"-Funktion) automatisch die GESAMTE
-- Verkaufshistorie mit umzieht, statt zwei potenziell auseinanderlaufende
-- Kopien der Besitzer-ID zu pflegen.
--
-- NICHT oeffentlich lesbar (enthaelt created_by = Admin-auth_user_id, reine
-- interne Buchfuehrung) und KEINE Insert/Update/Delete-Policy fuer
-- irgendeine Rolle - Schreiben laeuft ausschliesslich ueber die beiden
-- admin_*_card_sale_event()-RPCs weiter unten, damit die Verdienst-vs-
-- Auszahlung-Sicherheitspruefung (Abschnitt 5) nicht umgehbar ist. Kein
-- GRANT an anon/authenticated ueberhaupt - RLS mit 0 Policies waere sonst
-- nur "leer", der fehlende GRANT macht direkten Zugriff strukturell
-- unmoeglich, nicht nur policy-abhaengig.
create table if not exists public.card_sale_events (
  id uuid primary key default gen_random_uuid(),
  card_sale_id uuid not null references public.card_sales(id) on delete cascade,
  amount numeric not null default 135000,
  sold_at timestamptz not null default now(),
  -- Bewusst NULLABLE (nicht "not null default auth.uid()"): die Backfill-
  -- Migration (sql/20260901-card-sale-ownership-backfill.sql) fuegt fuer
  -- bereits bestehende Verkaeufe synthetische Event-Zeilen ein, fuer die es
  -- schlicht keinen echten "welcher Admin hat geklickt"-Wert gibt (und die
  -- Migration laeuft ausserhalb eines echten auth.uid()-Request-Kontexts,
  -- z.B. im SQL-Editor). NULL bedeutet dort eindeutig "historisch/migriert",
  -- waehrend jeder ueber admin_add_card_sale_event() neu erfasste Verkauf
  -- weiterhin immer eine echte Admin-auth_user_id traegt.
  created_by uuid default auth.uid()
);

create index if not exists card_sale_events_card_sale_id_idx on public.card_sale_events (card_sale_id);
create index if not exists card_sale_events_sold_at_idx on public.card_sale_events (sold_at);

alter table public.card_sale_events enable row level security;

-- Trigger: haelt card_sales.sold_count immer synchron mit der echten
-- Event-Anzahl, damit der komplette bestehende Lesepfad (renderCardSales(),
-- admin.html-Liste) unveraendert weiterfunktioniert.
create or replace function public.card_sales_sync_sold_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.card_sales
  set sold_count = (
    select count(*) from public.card_sale_events
    where card_sale_id = coalesce(new.card_sale_id, old.card_sale_id)
  )
  where id = coalesce(new.card_sale_id, old.card_sale_id);
  return null;
end;
$$;

drop trigger if exists card_sale_events_sync_count_trg on public.card_sale_events;
create trigger card_sale_events_sync_count_trg
after insert or delete on public.card_sale_events
for each row execute function public.card_sales_sync_sold_count();

-- ---------- 3. card_sellers - Lock-Anker + historischer Auszahlungs-Startwert ----------
-- Bewusst eine EIGENE, wenig frequentierte Tabelle statt player_stats zu
-- sperren (player_stats wird bei praktisch jedem Panel-Open/Heartbeat
-- geschrieben - eine Sperre dort wuerde echte Gameplay-Schreibvorgaenge
-- blockieren). historical_starting_paid_out ist die einzige Stelle, an
-- der "vor Systemeinfuehrung bereits ausgezahltes Geld" festgehalten wird
-- (siehe Backfill-Datei: startet bei 0 fuer alle bestehenden Verkaeufer,
-- da bisher nachweislich noch nichts ausgezahlt wurde).
create table if not exists public.card_sellers (
  auth_user_id uuid primary key,
  historical_starting_paid_out numeric not null default 0,
  historical_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.card_sellers enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.card_sellers to authenticated;

drop policy if exists "Admins read card sellers" on public.card_sellers;
create policy "Admins read card sellers"
on public.card_sellers for select
to authenticated
using (public.is_active_admin());

drop policy if exists "Admins insert card sellers" on public.card_sellers;
create policy "Admins insert card sellers"
on public.card_sellers for insert
to authenticated
with check (public.is_active_admin());

drop policy if exists "Admins update card sellers" on public.card_sellers;
create policy "Admins update card sellers"
on public.card_sellers for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

-- ---------- 4. card_sale_payout_requests ----------
-- KEIN Insert/Update-Grant an authenticated ueberhaupt - Anlegen nur ueber
-- request_card_sale_payout(), Status-Aenderung nur ueber
-- process_card_sale_payout() (beide SECURITY DEFINER, umgehen RLS/GRANTs
-- fuer ihre eigenen internen Schreibvorgaenge, exakt wie bereits bei
-- guild_tech_contribute() in diesem Projekt etabliert). Direkte Client-
-- Mutation ist dadurch strukturell unmoeglich, nicht nur policy-verboten.
create table if not exists public.card_sale_payout_requests (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  name_key text,
  display_name text,
  amount numeric not null,
  status text not null default 'pending',
  reject_reason text,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid
);

alter table public.card_sale_payout_requests
  drop constraint if exists card_sale_payout_requests_status_check;
alter table public.card_sale_payout_requests
  add constraint card_sale_payout_requests_status_check check (status in ('pending', 'paid', 'rejected'));

create index if not exists card_sale_payout_requests_auth_user_id_idx on public.card_sale_payout_requests (auth_user_id);
create index if not exists card_sale_payout_requests_status_idx on public.card_sale_payout_requests (status);
create index if not exists card_sale_payout_requests_created_at_idx on public.card_sale_payout_requests (created_at desc);

alter table public.card_sale_payout_requests enable row level security;

grant select on public.card_sale_payout_requests to authenticated;

drop policy if exists "Admins read card sale payout requests" on public.card_sale_payout_requests;
create policy "Admins read card sale payout requests"
on public.card_sale_payout_requests for select
to authenticated
using (public.is_active_admin());

-- ---------- 5. RPC: request_card_sale_payout() ----------
-- Fordert IMMER den kompletten aktuell verfuegbaren Betrag an (kein
-- Freitext-Betrag, Nutzer-Vorgabe "moeglichst simpel"). Kopiert das
-- Lock-Muster von guild_tech_contribute() (sql/20260731-guild-tech-tree-
-- v2-foundation.sql): insert ... on conflict do nothing gefolgt von
-- select ... for update auf die EIGENE Zeile verhindert die "Phantom-
-- Zeile"-Race bei zwei gleichzeitigen Klicks desselben Nutzers. Danach
-- werden die betroffenen card_sales/card_sale_payout_requests-Zeilen
-- gesperrt, BEVOR aggregiert wird (Postgres erlaubt FOR UPDATE nicht
-- zusammen mit Aggregatfunktionen in derselben Abfrage - deshalb zwei
-- getrennte Schritte: erst sperren, dann in einer separaten Abfrage
-- aggregieren). Der ausgezahlte Betrag wird IMMER serverseitig berechnet,
-- nie vom Client uebernommen.
create or replace function public.request_card_sale_payout()
returns table (payout_id uuid, amount numeric, new_pending_total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_seller public.card_sellers%rowtype;
  v_total_earned numeric;
  v_total_paid numeric;
  v_total_pending numeric;
  v_available numeric;
  v_name_key text;
  v_display_name text;
  v_payout_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.card_sellers (auth_user_id) values (v_uid)
  on conflict (auth_user_id) do nothing;
  select * into v_seller from public.card_sellers where auth_user_id = v_uid for update;

  -- Sperrt alle Karten dieses Verkaeufers (verhindert eine Race mit einer
  -- gleichzeitigen Admin-Korrektur ueber admin_add/remove_card_sale_event()).
  perform 1 from public.card_sales where auth_user_id = v_uid for update;
  select coalesce(sum(cse.amount), 0) into v_total_earned
    from public.card_sale_events cse
    join public.card_sales cs on cs.id = cse.card_sale_id
    where cs.auth_user_id = v_uid;

  -- Sperrt alle bestehenden Auszahlungs-Anfragen dieses Verkaeufers
  -- (verhindert zwei gleichzeitige Anfragen desselben Nutzers UND eine
  -- Race mit einer gleichzeitigen Admin-Entscheidung ueber
  -- process_card_sale_payout()).
  perform 1 from public.card_sale_payout_requests where auth_user_id = v_uid for update;
  select
    coalesce(sum(amount) filter (where status = 'paid'), 0),
    coalesce(sum(amount) filter (where status = 'pending'), 0)
    into v_total_paid, v_total_pending
    from public.card_sale_payout_requests where auth_user_id = v_uid;

  v_total_paid := v_seller.historical_starting_paid_out + v_total_paid;
  v_available := v_total_earned - v_total_paid - v_total_pending;

  if v_available <= 0 then
    raise exception 'nothing_available';
  end if;

  select name_key, display_name into v_name_key, v_display_name
    from public.player_stats where auth_user_id = v_uid limit 1;

  insert into public.card_sale_payout_requests (auth_user_id, name_key, display_name, amount, status)
  values (v_uid, v_name_key, v_display_name, v_available, 'pending')
  returning id into v_payout_id;

  return query select v_payout_id, v_available, v_total_pending + v_available;
end;
$$;

grant execute on function public.request_card_sale_payout() to authenticated;

-- ---------- 6. RPC: get_my_card_sale_status() ----------
-- Rein lesend. KEIN Parameter (nie eine fremde auth_user_id entgegennehmen)
-- - auth.uid() wird ausschliesslich intern verwendet, liefert daher
-- garantiert nur Daten des aufrufenden Nutzers. Deckt sowohl "soll das
-- Verkaeufer-Dashboard ueberhaupt angezeigt werden" (card_count) als auch
-- dessen kompletten Inhalt inkl. Status-Badge der letzten Anfrage in
-- einem einzigen Aufruf ab, ohne dass Spieler direkten Tabellenzugriff
-- auf card_sellers/card_sale_payout_requests brauchen.
create or replace function public.get_my_card_sale_status()
returns table (
  total_earned numeric,
  total_paid numeric,
  total_pending numeric,
  available numeric,
  card_count integer,
  latest_status text,
  latest_amount numeric,
  latest_created_at timestamptz,
  latest_processed_at timestamptz,
  latest_reject_reason text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_historical_paid numeric;
  v_earned numeric;
  v_paid numeric;
  v_pending numeric;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select coalesce(historical_starting_paid_out, 0) into v_historical_paid
    from public.card_sellers where auth_user_id = v_uid;
  v_historical_paid := coalesce(v_historical_paid, 0);

  select coalesce(sum(cse.amount), 0) into v_earned
    from public.card_sale_events cse
    join public.card_sales cs on cs.id = cse.card_sale_id
    where cs.auth_user_id = v_uid;

  select coalesce(sum(amount) filter (where status = 'paid'), 0),
         coalesce(sum(amount) filter (where status = 'pending'), 0)
    into v_paid, v_pending
    from public.card_sale_payout_requests where auth_user_id = v_uid;
  v_paid := v_historical_paid + v_paid;

  -- LEFT JOIN LATERAL statt einer UNION-ALL-Fallback-Konstruktion: liefert
  -- immer genau eine Zeile (dummy-Basiszeile), r.* ist NULL, wenn der
  -- Verkaeufer noch nie eine Auszahlung angefragt hat - eindeutig korrekt
  -- und leicht nachvollziehbar, statt sich auf eine implizite
  -- "NOT EXISTS deckt genau den Gegenfall ab"-Symmetrie zu verlassen.
  return query
  select
    v_earned,
    v_paid,
    v_pending,
    v_earned - v_paid - v_pending,
    (select count(*)::int from public.card_sales where auth_user_id = v_uid),
    r.status, r.amount, r.created_at, r.processed_at, r.reject_reason
  from (select 1) as dummy
  left join lateral (
    select status, amount, created_at, processed_at, reject_reason
    from public.card_sale_payout_requests
    where auth_user_id = v_uid
    order by created_at desc
    limit 1
  ) r on true;
end;
$$;

grant execute on function public.get_my_card_sale_status() to authenticated;

-- ---------- 7. RPC: admin_add_card_sale_event() ----------
-- Ersetzt sowohl den bisherigen "+"-Zaehler-Knopf als auch die
-- "Anfangs-Verkaufszahl beim Neuanlegen"-Eingabe im Admin-Bearbeiten-
-- Formular - EIN einziger Schreibpfad statt zwei. Interne Admin-Pruefung
-- (nicht nur GRANT/RLS) als zusaetzliche Absicherung.
create or replace function public.admin_add_card_sale_event(p_card_sale_id uuid, p_count integer default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_uid uuid := auth.uid();
  v_exists boolean;
  v_i integer;
  v_new_count integer;
begin
  if v_admin_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_active_admin() then
    raise exception 'not_admin';
  end if;
  if p_count is null or p_count < 1 then
    raise exception 'invalid_count';
  end if;

  select exists(select 1 from public.card_sales where id = p_card_sale_id) into v_exists;
  if not v_exists then
    raise exception 'card_not_found';
  end if;

  v_i := 0;
  while v_i < p_count loop
    insert into public.card_sale_events (card_sale_id, created_by) values (p_card_sale_id, v_admin_uid);
    v_i := v_i + 1;
  end loop;

  select sold_count into v_new_count from public.card_sales where id = p_card_sale_id;
  return v_new_count;
end;
$$;

grant execute on function public.admin_add_card_sale_event(uuid, integer) to authenticated;

-- ---------- 8. RPC: admin_remove_last_card_sale_event() ----------
-- Ersetzt den bisherigen "-"-Zaehler-Knopf. Nutzer-Vorgabe: ein Verkauf
-- darf NICHT entfernt werden, wenn dadurch der Gesamtverdienst unter die
-- Summe aus bereits ausgezahltem + reserviertem (pending) Geld faellt -
-- sonst koennte total_earned < total_paid entstehen. Sperrt dafuer (wie
-- request_card_sale_payout()) alle card_sales/card_sale_payout_requests-
-- Zeilen des Besitzers, BEVOR geprueft/geloescht wird - identische
-- Lock-Reihenfolge wie die Auszahlungs-RPC, verhindert eine Race mit
-- einer gleichzeitigen Auszahlungsanfrage desselben Verkaeufers.
create or replace function public.admin_remove_last_card_sale_event(p_card_sale_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_uid uuid := auth.uid();
  v_owner uuid;
  v_found boolean;
  v_event_id uuid;
  v_event_amount numeric;
  v_total_earned numeric;
  v_total_reserved numeric;
  v_historical_paid numeric;
  v_new_count integer;
begin
  if v_admin_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_active_admin() then
    raise exception 'not_admin';
  end if;

  select auth_user_id into v_owner from public.card_sales where id = p_card_sale_id;
  v_found := found;
  if not v_found then
    raise exception 'card_not_found';
  end if;

  if v_owner is not null then
    perform 1 from public.card_sales where auth_user_id = v_owner for update;
    perform 1 from public.card_sale_payout_requests where auth_user_id = v_owner for update;
    perform 1 from public.card_sellers where auth_user_id = v_owner for update;

    select coalesce(sum(cse.amount), 0) into v_total_earned
      from public.card_sale_events cse
      join public.card_sales cs on cs.id = cse.card_sale_id
      where cs.auth_user_id = v_owner;

    select coalesce(historical_starting_paid_out, 0) into v_historical_paid
      from public.card_sellers where auth_user_id = v_owner;
    v_historical_paid := coalesce(v_historical_paid, 0);

    select v_historical_paid
      + coalesce((select sum(amount) from public.card_sale_payout_requests where auth_user_id = v_owner and status = 'paid'), 0)
      + coalesce((select sum(amount) from public.card_sale_payout_requests where auth_user_id = v_owner and status = 'pending'), 0)
      into v_total_reserved;
  end if;

  select id, amount into v_event_id, v_event_amount
    from public.card_sale_events
    where card_sale_id = p_card_sale_id
    order by sold_at desc, id desc
    limit 1;

  if v_event_id is null then
    raise exception 'no_events_to_remove';
  end if;

  if v_owner is not null and (v_total_earned - v_event_amount) < v_total_reserved then
    raise exception 'earnings_already_reserved_or_paid';
  end if;

  delete from public.card_sale_events where id = v_event_id;

  select sold_count into v_new_count from public.card_sales where id = p_card_sale_id;
  return v_new_count;
end;
$$;

grant execute on function public.admin_remove_last_card_sale_event(uuid) to authenticated;

-- ---------- 9. RPC: process_card_sale_payout() ----------
-- Ersetzt den urspruenglich geplanten rohen Admin-.update() vollstaendig -
-- Status-Aenderung ist damit strukturell nur ueber diese eine, validierte
-- Funktion moeglich (siehe Tabellen-Grant oben: kein Update-Grant an
-- authenticated). amount/auth_user_id werden nie vom Aufruf beruehrt.
create or replace function public.process_card_sale_payout(p_request_id uuid, p_action text, p_reason text default null)
returns table (id uuid, status text, processed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_uid uuid := auth.uid();
  v_row public.card_sale_payout_requests%rowtype;
begin
  if v_admin_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_active_admin() then
    raise exception 'not_admin';
  end if;
  if p_action not in ('paid', 'rejected') then
    raise exception 'invalid_action';
  end if;

  select * into v_row from public.card_sale_payout_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'not_pending';
  end if;

  -- is_read wird hier bewusst mitgesetzt (kein eigener "Gelesen"-Knopf im
  -- Admin-Panel fuer diese Liste, anders als bei Investoren-/Kartenverkaufs-
  -- Anfragen) - sobald ein Admin eine Anfrage bearbeitet hat, ist sie per
  -- Definition nicht mehr "ungelesen".
  if p_action = 'paid' then
    update public.card_sale_payout_requests
    set status = 'paid', processed_at = now(), processed_by = v_admin_uid, is_read = true
    where id = p_request_id;
  else
    update public.card_sale_payout_requests
    set status = 'rejected', reject_reason = p_reason, processed_at = now(), processed_by = v_admin_uid, is_read = true
    where id = p_request_id;
  end if;

  return query select cspr.id, cspr.status, cspr.processed_at
    from public.card_sale_payout_requests cspr where cspr.id = p_request_id;
end;
$$;

grant execute on function public.process_card_sale_payout(uuid, text, text) to authenticated;

-- ---------- 10. Oeffentliche Aggregat-RPCs (nur Summen, keine Einzeldaten) ----------
-- "Verdient" und "Ausgezahlt" bleiben strikt getrennte Werte (Nutzer-
-- Vorgabe) - total_earned summiert IMMER den vollen historischen
-- Verdienst, total_paid_out ausschliesslich tatsaechlich bezahltes Geld.
create or replace function public.get_card_sale_public_stats()
returns table (
  total_earned numeric,
  total_paid_out numeric,
  total_sold_count integer,
  active_listings integer,
  earned_this_week numeric
)
language sql
security definer
stable
set search_path = public
as $$
  select
    (select coalesce(sum(amount), 0) from public.card_sale_events),
    (select coalesce(sum(historical_starting_paid_out), 0) from public.card_sellers)
      + (select coalesce(sum(amount), 0) from public.card_sale_payout_requests where status = 'paid'),
    (select coalesce(sum(sold_count), 0)::int from public.card_sales),
    (select count(*)::int from public.card_sales),
    (select coalesce(sum(amount), 0) from public.card_sale_events where sold_at >= now() - interval '7 days');
$$;

grant execute on function public.get_card_sale_public_stats() to anon, authenticated;

create or replace function public.get_card_sale_daily_earnings(p_days integer default 30)
returns table (day date, amount numeric)
language sql
security definer
stable
set search_path = public
as $$
  select date_trunc('day', sold_at)::date as day, sum(amount) as amount
  from public.card_sale_events
  where sold_at >= now() - (greatest(coalesce(p_days, 30), 1) || ' days')::interval
  group by 1
  order by 1;
$$;

grant execute on function public.get_card_sale_daily_earnings(integer) to anon, authenticated;
