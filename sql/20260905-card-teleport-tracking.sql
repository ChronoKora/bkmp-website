-- ============================================================
-- BKInvestment - Card-Teleport-Tracking + Trending/Highlights
--
-- Neues Feature (05.09.2026): zaehlt ECHTE, tatsaechlich gestartete
-- "Zum Shop teleportieren"-Vorgaenge aus der Minecraft-Mod
-- (bkmp-card-browser-mod) pro Karte, damit daraus Trending-/
-- Highlight-Bereiche (Website + Mod) entstehen koennen. Baut auf
-- sql/20260902-mod-account-linking-and-submissions.sql auf (muss vorher
-- gelaufen sein - wiederverwendet dessen public._resolve_mod_token()
-- und public.check_and_record_rate_limit() unveraendert, siehe unten).
--
-- WICHTIGSTE ARCHITEKTURREGEL (Auftrag Abschnitt 75): der Client rechnet
-- NIE selbst aus Rohdaten. Schreiben laeuft ausschliesslich ueber
-- record_card_teleport() (ein einzelner, atomarer RPC-Aufruf), Lesen
-- ausschliesslich ueber die beiden Aggregat-RPCs get_trending_cards()/
-- get_card_teleport_stats() - card_teleport_events selbst ist fuer
-- anon/authenticated komplett unerreichbar (RLS aktiv, KEINE Policies,
-- identisches Prinzip wie das bereits bestehende mod_rate_limit_events).
--
-- "account_id" aus dem urspruenglichen Auftrag heisst in diesem Projekt
-- durchgehend "auth_user_id" (siehe card_submissions/mod_tokens) - hier
-- konsequent genauso benannt statt einen zweiten Namen einzufuehren.
-- ============================================================

-- ============================================================
-- Teil 1: Ereignistabelle
-- ============================================================
-- "on delete cascade" auf card_id (Auftrag Abschnitt 48, Nutzer-Vorgabe):
-- wird eine Karte geloescht, sind ihre Teleport-Events ohne die Karte
-- selbst bedeutungslos - anders als card_submissions.approved_card_id
-- ("on delete set null", weil die EINREICHUNG als Audit-Spur auch ohne
-- die spaeter geloeschte Karte erhalten bleiben soll) gibt es hier keinen
-- eigenstaendigen Grund, verwaiste Events aufzubewahren.
create table if not exists public.card_teleport_events (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.card_catalog(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  -- Abschnitt 7: bewusst nur ein einzelnes, simples Feld - "mod" ist der
  -- einzige heute existierende Wert, spaeter theoretisch erweiterbar.
  source text not null default 'mod',
  created_at timestamptz not null default now()
);

-- Abschnitt 16: mindestens card_id, created_at, (account_id+card_id+created_at).
create index if not exists card_teleport_events_card_id_idx on public.card_teleport_events(card_id);
create index if not exists card_teleport_events_created_at_idx on public.card_teleport_events(created_at desc);
create index if not exists card_teleport_events_dedup_idx on public.card_teleport_events(auth_user_id, card_id, created_at desc);

alter table public.card_teleport_events enable row level security;
-- Abschnitt 17: bewusst KEINE Policies fuer anon/authenticated (deny-by-
-- default) - identisches Prinzip wie mod_rate_limit_events oben. Weder
-- Website noch Mod lesen/schreiben diese Tabelle je direkt per
-- PostgREST/anon-Key; nur die drei SECURITY DEFINER-Funktionen unten
-- (laufen mit den Rechten des Funktions-Eigentuemers, RLS gilt fuer sie
-- nicht) fassen sie an. Kein "User X hat Karte Y besucht" jemals oeffentlich
-- lesbar (Abschnitt 49) - strukturell unmoeglich, nicht nur per Policy.

-- ============================================================
-- Teil 2: Aufzeichnen - der einzige Schreibweg
-- ============================================================
-- Auftrag Abschnitt 5/11/12/15: die Account-Identitaet kommt IMMER aus
-- dem bereits bestehenden Mod-Token (_resolve_mod_token, siehe
-- 20260902-mod-account-linking-and-submissions.sql), NIE aus einem vom
-- Client behaupteten Feld. Es gibt nur "record_card_teleport(cardId)" -
-- keinen Parameter, mit dem der Client selbst einen Zaehler oder eine
-- fremde Account-ID setzen koennte (Abschnitt 15).
create or replace function public.record_card_teleport(p_raw_token text, p_card_id uuid)
returns table (recorded boolean, reason text)
language plpgsql
security definer
-- "public, extensions" - _resolve_mod_token() ruft intern digest() (pgcrypto) auf.
set search_path = public, extensions
as $$
declare
  v_uid uuid;
  v_card_status text;
  v_rate_ok boolean;
begin
  v_uid := public._resolve_mod_token(p_raw_token);

  if p_card_id is null then
    raise exception 'card_not_found';
  end if;

  -- Abschnitt 12: Karte muss existieren UND sichtbar/aktiv sein
  -- (status='approved', siehe supabase-card-catalog-moderation.sql) -
  -- ein pending/rejected/geloeschter Datensatz zaehlt nie.
  select status into v_card_status from public.card_catalog where id = p_card_id;
  if v_card_status is null or v_card_status <> 'approved' then
    raise exception 'card_not_found';
  end if;

  -- Abschnitt 13: Dedup ueber den bereits bestehenden generischen
  -- Rate-Limit-Baustein wiederverwendet statt eines zweiten, parallelen
  -- Mechanismus - "max. 1 Aufruf pro (Account, Karte) innerhalb von 300s"
  -- ist exakt dieselbe Semantik wie ein normales Rate-Limit mit p_max=1.
  -- 300 Sekunden = die zentral konfigurierbare 5-Minuten-Dedup-Zeit
  -- (Abschnitt 13/56, Standard 5 Minuten) - einzige Stelle, die diesen
  -- Wert traegt, hier bei Bedarf spaeter aenderbar.
  select public.check_and_record_rate_limit(
    'teleport:' || v_uid::text || ':' || p_card_id::text,
    'teleport_record',
    1,
    300
  ) into v_rate_ok;

  if not v_rate_ok then
    -- Abschnitt 52: kein Fehler, nur "nicht gezaehlt" - der eigentliche
    -- Teleport (laengst durch die Mod gesendet, bevor dieser Aufruf ueberhaupt
    -- passiert) ist davon vollkommen unabhaengig.
    return query select false, 'deduplicated';
    return;
  end if;

  insert into public.card_teleport_events (card_id, auth_user_id, source)
  values (p_card_id, v_uid, 'mod');

  return query select true, null::text;
end;
$$;

-- Haertung (05.09.2026, Nachpruefung vor dem Produktiv-Lauf): Postgres
-- vergibt EXECUTE auf eine neue Funktion standardmaessig automatisch an
-- PUBLIC - bei "security definer" ist das ein unnoetig breiter impliziter
-- Zugriffsweg (jede aktuelle UND jede kuenftige Rolle in dieser DB koennte
-- sie sonst aufrufen, auch ohne einen der beiden folgenden Grants).
-- Identisches Muster wie bereits bei _resolve_mod_token/
-- check_and_record_rate_limit in 20260902-mod-account-linking-and-
-- submissions.sql - hier fuer Konsistenz nachgezogen.
revoke execute on function public.record_card_teleport(text, uuid) from public;
-- Abschnitt 11: anonym aufrufbar (die Mod hat keine Supabase-Session,
-- identisches Prinzip wie create_card_submission/get_my_mod_account) -
-- die Sicherheit kommt aus dem p_raw_token-Parameter selbst.
grant execute on function public.record_card_teleport(text, uuid) to anon, authenticated;

-- ============================================================
-- Teil 3: Aggregation - Top-Karten je Zeitraum (Trending/Highlights)
-- ============================================================
-- Abschnitt 39: Perioden nur aus fester Allowlist, kein beliebiger vom
-- Client mitgesendeter SQL-Zeitraum. Abschnitt 41: liefert Karte+Zahl in
-- einem Rutsch (kein N+1). Gibt dieselben Spalten wie card_catalog
-- zurueck (plus teleport_count), damit die Website/Mod-API dieselbe
-- mapRow()-Logik wie /api/cards fuer normale Karten wiederverwenden kann
-- (siehe api/cards.js).
create or replace function public.get_trending_cards(p_period text, p_limit integer default 5)
returns table (
  id uuid,
  name text,
  category text,
  shop_name text,
  cb text,
  size text,
  submitted_by text,
  description text,
  image_url text,
  created_at timestamptz,
  series text,
  price numeric,
  seller text,
  creator text,
  width_maps integer,
  height_maps integer,
  total_maps integer,
  teleport_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_since timestamptz;
  -- Abschnitt 40: serverseitig hart auf max. 50 begrenzt, unabhaengig
  -- davon, was der Aufrufer anfragt.
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
      c.id, c.name, c.category, c.shop_name, c.cb, c.size, c.submitted_by, c.description,
      c.image_url, c.created_at, c.series, c.price, c.seller, c.creator,
      c.width_maps, c.height_maps, c.total_maps,
      count(e.id)::bigint as teleport_count
    from public.card_teleport_events e
    join public.card_catalog c on c.id = e.card_id and c.status = 'approved'
    where v_since is null or e.created_at >= v_since
    group by c.id
    order by teleport_count desc, c.created_at desc
    limit v_limit;
end;
$$;

-- Haertung (05.09.2026): siehe Kommentar bei record_card_teleport oben -
-- impliziten PUBLIC-Standardzugriff entziehen, danach gezielt freigeben.
revoke execute on function public.get_trending_cards(text, integer) from public;
-- Abschnitt 17: oeffentliche Trending-Abfragen geben ausschliesslich
-- aggregierte Zahlen aus (nie "User X hat Karte Y besucht") - anon-Grant
-- ist hier unbedenklich, weil die Funktion selbst nie einzelne Events
-- zurueckgibt, nur die bereits aggregierte Zaehlung pro Karte.
grant execute on function public.get_trending_cards(text, integer) to anon, authenticated;

-- ============================================================
-- Teil 4: Aggregation - Statistik einer einzelnen Karte
-- ============================================================
-- Abschnitt 19/32/33: 24h/7d/30d/All-Time fuer GENAU EINE Karte (Website-
-- und Mod-Detailansicht). "language sql" statt plpgsql (reiner
-- Einzeiler ohne Kontrollfluss noetig, gleiche security definer/stable-
-- Deklaration wie oben).
create or replace function public.get_card_teleport_stats(p_card_id uuid)
returns table (
  teleports_24h bigint,
  teleports_7d bigint,
  teleports_30d bigint,
  teleports_all_time bigint
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
  from public.card_teleport_events
  where card_id = p_card_id;
$$;

-- Haertung (05.09.2026): siehe Kommentar bei record_card_teleport oben -
-- impliziten PUBLIC-Standardzugriff entziehen, danach gezielt freigeben.
revoke execute on function public.get_card_teleport_stats(uuid) from public;
grant execute on function public.get_card_teleport_stats(uuid) to anon, authenticated;
