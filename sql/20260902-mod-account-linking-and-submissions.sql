-- ============================================================
-- BKInvestment - Minecraft-Mod-Account-Verknuepfung + Karteneinreichungen
--
-- Neues Feature (02.09.2026): die Minecraft-Mod (bkmp-card-browser-mod)
-- bekommt vier Bereiche - Karten entdecken (bereits vorhanden, api/cards.js
-- unveraendert), Karte einreichen, Meine Einreichungen, Account/
-- Einstellungen. Dieses File deckt die komplette neue Datenbank-Seite ab.
--
-- ARCHITEKTUR-ENTSCHEIDUNG (siehe CLAUDE.md-Analyse vom 01./02.09.2026,
-- Recherche-Agent-Bericht): die Mod haelt NIEMALS einen Supabase-Service-
-- Role-Key oder eine echte Supabase-Auth-Session. Stattdessen:
--
-- 1. Der Spieler generiert AUF DER WEBSITE (echter, eingeloggter
--    player_stats-Account) einen kurzlebigen Pairing-Code
--    (create_mod_pairing_code, SECURITY DEFINER, auth.uid()-gebunden).
-- 2. Die Mod tauscht diesen Code EINMALIG gegen einen eigenen,
--    langlebigen Mod-Token (exchange_mod_pairing_code, anonym aufrufbar,
--    da die Mod keine Supabase-Session hat - die Sicherheit kommt aus
--    dem Code selbst: zufaellig, einmalig, 10 Minuten gueltig).
-- 3. Server-seitig wird NUR der SHA-256-Hash des rohen Tokens
--    gespeichert (mod_tokens.token_hash) - der rohe Token existiert nur
--    einmal im Exchange-Response und danach ausschliesslich lokal in
--    der Mod-Konfigurationsdatei auf dem Client.
-- 4. JEDE weitere Mod-Anfrage (Submission erstellen, Bild hochladen,
--    eigene Einreichungen lesen) verifiziert diesen Token server-seitig
--    in api/*.js (Hash-Lookup gegen mod_tokens, siehe dortige
--    verifyModToken()-Hilfsfunktion, identisches Muster zum bereits
--    bestehenden verifyPlayerAccessToken() in api/submit-entry.js) -
--    die auth_user_id kommt IMMER aus dieser Server-seitigen Ableitung,
--    NIE aus einem vom Client behaupteten Feld (IDOR-Schutz).
--
-- Der Mod-Token selbst ist nur fuer GENAU DIE drei oben genannten
-- Aktionen brauchbar - er ist kein Supabase-JWT, kann also strukturell
-- NIE fuer eine beliebige PostgREST-Anfrage missbraucht werden, selbst
-- wenn er geleakt wuerde (er wird von PostgREST/RLS gar nicht verstanden,
-- nur von den neuen api/*.js-Handlern unten).
-- ============================================================

-- ============================================================
-- Teil 1: card_catalog additiv erweitern
-- ============================================================
-- Neue, bislang nicht vorhandene Konzepte (Serie/Preis/Verkaeufer/
-- Ersteller/MapArt-Format) - additiv, nullable, aendert nichts an
-- bestehenden Zeilen/Lesern. Wird sowohl von echten Einreichungen
-- (nach Freigabe) als auch (optional) von kuenftigen Admin-Direkt-
-- Anlagen genutzt. api/cards.js's SELECT/mapRow() wird unten passend
-- erweitert (siehe Kommentar dort - eigene Aenderung ausserhalb dieser
-- SQL-Datei noetig, in api/cards.js selbst).
alter table public.card_catalog add column if not exists series text;
alter table public.card_catalog add column if not exists price numeric;
alter table public.card_catalog add column if not exists seller text;
alter table public.card_catalog add column if not exists creator text;
alter table public.card_catalog add column if not exists width_maps integer;
alter table public.card_catalog add column if not exists height_maps integer;
alter table public.card_catalog add column if not exists total_maps integer;

-- ============================================================
-- Teil 2: Pairing-Codes
-- ============================================================
create table if not exists public.mod_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_mod_token_id uuid
);

create index if not exists mod_pairing_codes_auth_user_id_idx on public.mod_pairing_codes(auth_user_id);
create index if not exists mod_pairing_codes_code_idx on public.mod_pairing_codes(code) where used_at is null;

alter table public.mod_pairing_codes enable row level security;
-- Absichtlich KEINE Policies fuer anon/authenticated - weder Website
-- noch Mod lesen/schreiben diese Tabelle je direkt per PostgREST, nur
-- die beiden SECURITY DEFINER-Funktionen unten (die laufen mit den
-- Rechten des Funktions-Eigentuemers, RLS gilt fuer sie nicht) fassen
-- sie an. Ein roher Zugriff mit dem anon-Key sieht dadurch nie einen
-- fremden Code, selbst wenn er die ID erraten wuerde.

-- ============================================================
-- Teil 3: Mod-Tokens
-- ============================================================
create table if not exists public.mod_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  mc_name_at_link text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or revoked_by in ('user', 'admin'))
);

create index if not exists mod_tokens_auth_user_id_idx on public.mod_tokens(auth_user_id);
create index if not exists mod_tokens_token_hash_idx on public.mod_tokens(token_hash) where revoked_at is null;

alter table public.mod_tokens enable row level security;

-- Der Spieler darf seine EIGENEN Verbindungen auf der Website sehen
-- (fuer eine kuenftige "verbundene Geraete"-Anzeige) - nur lesend, nie
-- den Hash selbst zurueckgeben lassen wuerde hier nichts nuetzen (der
-- Hash ist ohnehin wertlos ohne den rohen Token), aber der Vollstaendig-
-- keit halber trotzdem nur die unbedenklichen Spalten in einer View
-- freigeben statt der Rohtabelle.
create or replace view public.my_mod_connections as
select id, mc_name_at_link, created_at, last_used_at, revoked_at
from public.mod_tokens
where auth_user_id = auth.uid();

grant select on public.my_mod_connections to authenticated;

-- "drop ... if exists" davor: create policy kennt kein "if not exists" in
-- Postgres, ein zweiter Lauf dieser Datei (z.B. nach einem vorherigen,
-- erst spaeter im Skript fehlgeschlagenen Versuch) wuerde sonst mit
-- "policy already exists" abbrechen. Reine Zugriffsregel-Metadaten, kein
-- Datenverlust moeglich durch Loeschen+Neuanlegen einer Policy.
drop policy if exists "mod_tokens select own" on public.mod_tokens;
create policy "mod_tokens select own" on public.mod_tokens
  for select to authenticated
  using (auth_user_id = auth.uid());
-- Kein INSERT/UPDATE/DELETE-Policy fuer anon/authenticated - Anlage nur
-- ueber exchange_mod_pairing_code(), Widerruf nur ueber
-- revoke_my_mod_token() (beide SECURITY DEFINER, siehe unten).

-- ============================================================
-- Teil 4: card_submissions
-- ============================================================
create table if not exists public.card_submissions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  minecraft_name text not null,
  image_url text not null,
  card_name text not null,
  category text not null,
  series text,
  width_maps integer,
  height_maps integer,
  total_maps integer,
  server text,
  warp text,
  seller text,
  price numeric,
  creator text,
  description text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'needs_changes')),
  rejection_reason text,
  approved_card_id uuid references public.card_catalog(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create index if not exists card_submissions_auth_user_id_idx on public.card_submissions(auth_user_id);
create index if not exists card_submissions_status_idx on public.card_submissions(status);
create index if not exists card_submissions_created_at_idx on public.card_submissions(created_at desc);

alter table public.card_submissions enable row level security;

-- Der Spieler darf (ueber eine ECHTE Website-Session, auth.uid()) seine
-- eigenen Einreichungen sehen - Verteidigung in der Tiefe fuer eine
-- moegliche kuenftige Website-Anzeige. Die Mod selbst hat KEINE
-- Supabase-Session und nutzt dafuer stattdessen api/card-submissions.js
-- (GET), das den Mod-Token server-seitig verifiziert - diese Policy ist
-- fuer den Mod-Pfad irrelevant, schadet aber nicht.
drop policy if exists "card_submissions select own" on public.card_submissions;
create policy "card_submissions select own" on public.card_submissions
  for select to authenticated
  using (auth_user_id = auth.uid());

-- Admins sehen + aendern alles (Pruefbereich, admin.html).
drop policy if exists "card_submissions admin select" on public.card_submissions;
create policy "card_submissions admin select" on public.card_submissions
  for select to authenticated
  using (public.is_active_admin());

-- "status != 'approved'" im with check: ein Admin darf per rohem Update
-- ablehnen/Aenderung anfordern/is_read setzen, aber NICHT direkt auf
-- 'approved' setzen - das wuerde die Einreichung als angenommen
-- markieren, OHNE die zugehoerige echte card_catalog-Zeile anzulegen
-- (approve_card_submission() unten macht beides atomar in einer
-- Transaktion). Kein Sicherheitsloch (nur Admins koennten es ohnehin
-- ausloesen), aber ein echtes Risiko fuer einen inkonsistenten
-- Zwischenstand, das sich mit dieser einen Zeile strukturell
-- ausschliessen laesst statt nur auf admin.html's eigene Disziplin zu
-- vertrauen.
drop policy if exists "card_submissions admin update" on public.card_submissions;
create policy "card_submissions admin update" on public.card_submissions
  for update to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin() and status != 'approved');

-- Absichtlich KEIN INSERT-Policy fuer anon/authenticated - Einreichungen
-- entstehen ausschliesslich ueber api/card-submissions.js (POST), das
-- den Mod-Token server-seitig prueft und mit dem Service-Role-Key
-- schreibt (identisches Architekturprinzip wie api/submit-entry.js).
-- Ein roher INSERT-Versuch mit dem anon-Key (z.B. bei geleaktem Key)
-- wird dadurch strukturell abgelehnt, unabhaengig von jeder Anwendungs-
-- logik.

-- ============================================================
-- Teil 5: Rate-Limit-Buchhaltung
-- ============================================================
-- Generisches Sliding-Window-Rate-Limit ueber alle neuen Endpunkte
-- hinweg (Pairing/Upload/Submission/Statusabfragen) - siehe
-- check_and_record_rate_limit() unten. Ausschliesslich vom Service-
-- Role-Key aus den neuen api/*.js-Dateien angefasst, nie von anon/
-- authenticated direkt - RLS aktiv, aber bewusst OHNE jede Policy
-- (deny-by-default), Service-Role umgeht RLS ohnehin strukturell.
create table if not exists public.mod_rate_limit_events (
  id bigint generated always as identity primary key,
  subject text not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists mod_rate_limit_events_lookup_idx on public.mod_rate_limit_events(subject, action, created_at desc);

alter table public.mod_rate_limit_events enable row level security;

-- ============================================================
-- Teil 6: Funktionen
-- ============================================================

-- pgcrypto liefert gen_random_bytes()/digest(), gebraucht fuer den
-- Roh-Token/dessen Hash (siehe exchange_mod_pairing_code/_resolve_mod_token/
-- get_my_mod_account/revoke_my_mod_token_by_raw unten). "if not exists" -
-- reiner No-Op, falls die Extension (z.B. ueber das aeltere
-- sql/supabase-schema.sql, dort ohne explizites Schema) bereits an anderer
-- Stelle installiert ist; "with schema extensions" installiert sie sonst an
-- der auf Supabase-Projekten ueblichen Stelle. Kombiniert mit dem unten
-- jeweils auf "public, extensions" erweiterten search_path der vier
-- betroffenen Funktionen findet sich gen_random_bytes()/digest() dadurch
-- zuverlaessig, egal in welchem der beiden Schemas es tatsaechlich landet.
create extension if not exists pgcrypto with schema extensions;

-- Zeichensatz ohne verwechselbare Zeichen (0/O, 1/I) - identisches
-- Prinzip wie api/generate-daily-events.js's CODE_CHARS/randomCode().
create or replace function public._mod_random_code_segment(p_len integer)
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32) + 1)::int, 1),
    ''
  )
  from generate_series(1, p_len);
$$;

-- Postgres gewaehrt EXECUTE auf neue Funktionen standardmaessig an
-- PUBLIC (anders als bei Tabellen) - dieses Projekt widerruft das sonst
-- nirgends explizit, weil bislang jede Funktion ohnehin fuer die
-- vorgesehene Rolle freigegeben werden sollte. Diese hier ist rein
-- interner Hilfsbaustein (nur von create_mod_pairing_code() genutzt) -
-- bewusst eng gehalten, kein Aussenstehender braucht einen zufaelligen
-- Code-Abschnitt einzeln aufrufen zu koennen.
revoke execute on function public._mod_random_code_segment(integer) from public;

-- Website-Seite: eingeloggter Spieler erzeugt einen Pairing-Code.
-- Jeder Aufruf loescht zuerst einen evtl. noch offenen eigenen Code
-- (immer nur EIN aktiver Code pro Spieler - vermeidet Verwirrung
-- ueber "welcher Code gilt jetzt" und begrenzt gleichzeitig implizit
-- die Anzahl gleichzeitig gueltiger Codes pro Konto).
create or replace function public.create_mod_pairing_code()
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_expires timestamptz := now() + interval '10 minutes';
  v_rate_ok boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select public.check_and_record_rate_limit('pairing_create:' || v_uid::text, 'pairing_create', 5, 3600) into v_rate_ok;
  if not v_rate_ok then
    raise exception 'rate_limited';
  end if;

  delete from public.mod_pairing_codes where auth_user_id = v_uid and used_at is null;

  loop
    v_code := public._mod_random_code_segment(4) || '-' || public._mod_random_code_segment(4);
    begin
      insert into public.mod_pairing_codes (auth_user_id, code, expires_at)
      values (v_uid, v_code, v_expires);
      exit;
    exception when unique_violation then
      -- extrem unwahrscheinliche Kollision (32^8 Kombinationen) - neu ziehen.
    end;
  end loop;

  return query select v_code, v_expires;
end;
$$;

grant execute on function public.create_mod_pairing_code() to authenticated;

-- Mod-Seite: Code gegen einen Token tauschen. Anonym aufrufbar (die Mod
-- hat keine Supabase-Session) - die Sicherheit kommt ausschliesslich
-- aus dem Code selbst (zufaellig/einmalig/kurzlebig), nicht aus dem
-- Aufrufer. p_mc_name ist rein informativ (Anzeige "verbunden als..." /
-- Audit-Spur mc_name_at_link) - siehe api/mod-pairing-exchange.js's
-- Kommentar zur Minecraft-Identitaets-Einschraenkung: NICHT die
-- Sicherheitsgrenze, nur eine Anzeige-Hilfe.
create or replace function public.exchange_mod_pairing_code(p_code text, p_mc_name text)
returns table (raw_token text, bk_display_name text, mc_name text)
language plpgsql
security definer
-- "public, extensions" statt nur "public": ruft gen_random_bytes()/digest()
-- auf (pgcrypto) - auf Supabase-Projekten lebt die Extension ueblicherweise
-- im "extensions"-Schema, nicht in "public". Ein reines "public" haette das
-- unqualifizierte gen_random_bytes()/digest() dort nicht gefunden (live
-- bestaetigt: "function gen_random_bytes(integer) does not exist"). Sicher,
-- da "extensions" ein admin-verwaltetes, nicht Nutzer-beschreibbares Schema
-- ist - kein erneutes Einfallstor fuer eine search_path-Injektion, genau
-- das "set search_path" hier eigentlich verhindern soll.
set search_path = public, extensions
as $$
declare
  v_row public.mod_pairing_codes%rowtype;
  v_raw_token text;
  v_token_hash text;
  v_new_token_id uuid;
  v_display_name text;
  v_rate_ok boolean;
begin
  -- Zwei getrennte Limits: (1) pro EINZELNEM Code - bremst wiederholtes
  -- Raten desselben (z.B. teilweise bekannten/abgefangenen) Codes, (2)
  -- ein grober GLOBALER Deckel unabhaengig vom Codewert - der Aufrufer
  -- kommt ueber PostgREST, echte Client-IPs sind auf dieser Ebene nicht
  -- zuverlaessig verfuegbar (inet_client_addr() wuerde nur PostgRESTs
  -- eigene Adresse liefern, nicht die des Spielers/Mods), ein codewert-
  -- unabhaengiger Deckel faengt trotzdem einen echten automatisierten
  -- Massen-Rateversuch ab, ohne normale Spieler zu stoeren (bei 32^8
  -- moeglichen Codes ist reines Blind-Raten ohnehin praktisch aussichtslos -
  -- dieser zweite Deckel ist zusaetzliche Tiefenverteidigung, keine
  -- alleinige Absicherung).
  select public.check_and_record_rate_limit('pairing_exchange:' || coalesce(p_code, ''), 'pairing_exchange', 10, 3600) into v_rate_ok;
  if not v_rate_ok then
    raise exception 'rate_limited';
  end if;
  select public.check_and_record_rate_limit('pairing_exchange_global', 'pairing_exchange_global', 200, 60) into v_rate_ok;
  if not v_rate_ok then
    raise exception 'rate_limited';
  end if;

  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'invalid_code';
  end if;

  select * into v_row from public.mod_pairing_codes where code = upper(trim(p_code)) for update;

  if v_row.id is null then
    raise exception 'invalid_code';
  end if;
  if v_row.used_at is not null then
    raise exception 'code_already_used';
  end if;
  if v_row.expires_at < now() then
    raise exception 'code_expired';
  end if;

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  insert into public.mod_tokens (auth_user_id, token_hash, mc_name_at_link)
  values (v_row.auth_user_id, v_token_hash, nullif(trim(coalesce(p_mc_name, '')), ''))
  returning id into v_new_token_id;

  update public.mod_pairing_codes
  set used_at = now(), used_mod_token_id = v_new_token_id
  where id = v_row.id;

  select display_name into v_display_name from public.player_stats where auth_user_id = v_row.auth_user_id limit 1;

  return query select v_raw_token, v_display_name, nullif(trim(coalesce(p_mc_name, '')), '');
end;
$$;

grant execute on function public.exchange_mod_pairing_code(text, text) to anon, authenticated;

-- Website-Seite: Spieler widerruft eine eigene Verbindung.
create or replace function public.revoke_my_mod_token(p_token_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.mod_tokens
  set revoked_at = now(), revoked_by = 'user'
  where id = p_token_id and auth_user_id = v_uid and revoked_at is null;

  if not found then
    raise exception 'token_not_found';
  end if;
end;
$$;

grant execute on function public.revoke_my_mod_token(uuid) to authenticated;

-- Generisches Sliding-Window-Rate-Limit: erlaubt max. p_max Aufrufe pro
-- (subject, action) innerhalb der letzten p_window_seconds Sekunden.
-- Raeumt bei jedem Aufruf beilaeufig eigene abgelaufene Zeilen auf
-- (kein separater Cron-Job noetig - das Datenvolumen bleibt dadurch
-- von selbst klein). SECURITY DEFINER, aber NICHT oeffentlich
-- ausfuehrbar (kein grant to anon/authenticated) - wird nur intern von
-- anderen SECURITY DEFINER-Funktionen bzw. direkt per Service-Role-Key
-- aus api/*.js aufgerufen.
create or replace function public.check_and_record_rate_limit(p_subject text, p_action text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.mod_rate_limit_events
  where subject = p_subject and action = p_action and created_at < now() - (p_window_seconds || ' seconds')::interval;

  select count(*) into v_count from public.mod_rate_limit_events where subject = p_subject and action = p_action;

  if v_count >= p_max then
    return false;
  end if;

  insert into public.mod_rate_limit_events (subject, action) values (p_subject, p_action);
  return true;
end;
$$;

revoke execute on function public.check_and_record_rate_limit(text, text, integer, integer) from public;
grant execute on function public.check_and_record_rate_limit(text, text, integer, integer) to service_role;

-- Interner Helfer: loest einen rohen Mod-Token zu seiner auth_user_id
-- auf (Hash-Lookup, widerrufen-Pruefung), aktualisiert last_used_at.
-- NICHT direkt ausfuehrbar (kein grant to anon/authenticated) - wird
-- nur von den drei oeffentlichen p_raw_token-Funktionen unten intern
-- aufgerufen. Zentrale Stelle fuer die Token-Pruefung, damit sie nicht
-- drei Mal leicht unterschiedlich dupliziert wird.
create or replace function public._resolve_mod_token(p_raw_token text)
returns uuid
language plpgsql
security definer
-- siehe Kommentar bei exchange_mod_pairing_code oben - digest() (pgcrypto)
-- braucht "extensions" mit im search_path.
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_uid uuid;
begin
  if p_raw_token is null or length(p_raw_token) < 32 then
    raise exception 'invalid_token';
  end if;

  v_hash := encode(digest(p_raw_token, 'sha256'), 'hex');

  select auth_user_id into v_uid from public.mod_tokens where token_hash = v_hash and revoked_at is null;

  if v_uid is null then
    raise exception 'invalid_token';
  end if;

  update public.mod_tokens set last_used_at = now() where token_hash = v_hash;

  return v_uid;
end;
$$;

-- Rein interner Baustein (siehe _mod_random_code_segment-Kommentar
-- oben zum PUBLIC-Default) - wuerde einem beliebigen anon-Aufrufer
-- sonst erlauben, direkt "ist dieser Token gueltig?" zu pruefen und
-- last_used_at fuer einen fremden Token zu verfaelschen, ganz ohne
-- eine der eigentlich vorgesehenen Aktionen auszufuehren.
revoke execute on function public._resolve_mod_token(text) from public;

-- Mod-Seite: Account-Status pruefen (Account-Screen zeigt "Verbunden
-- als..."/erkennt "Verbindung abgelaufen", falls der Token inzwischen
-- widerrufen wurde, OHNE dafuer erst eine Einreichung ausloesen zu
-- muessen).
create or replace function public.get_my_mod_account(p_raw_token text)
returns table (bk_display_name text, mc_name_at_link text, connected_since timestamptz)
language plpgsql
security definer
-- siehe Kommentar bei exchange_mod_pairing_code oben - digest() (pgcrypto)
-- braucht "extensions" mit im search_path.
set search_path = public, extensions
as $$
declare
  v_uid uuid := public._resolve_mod_token(p_raw_token);
begin
  return query
    select ps.display_name, mt.mc_name_at_link, mt.created_at
    from public.mod_tokens mt
    join public.player_stats ps on ps.auth_user_id = mt.auth_user_id
    where mt.token_hash = encode(digest(p_raw_token, 'sha256'), 'hex')
    limit 1;
end;
$$;

grant execute on function public.get_my_mod_account(text) to anon, authenticated;

-- Mod-Seite: eigene Verbindung trennen (identischer Effekt wie
-- revoke_my_mod_token, aber vom Mod-Client selbst ausloesbar, da er
-- keine Supabase-Session hat um die authenticated-Variante zu nutzen).
create or replace function public.revoke_my_mod_token_by_raw(p_raw_token text)
returns void
language plpgsql
security definer
-- siehe Kommentar bei exchange_mod_pairing_code oben - digest() (pgcrypto)
-- braucht "extensions" mit im search_path.
set search_path = public, extensions
as $$
declare
  v_hash text := encode(digest(coalesce(p_raw_token, ''), 'sha256'), 'hex');
begin
  update public.mod_tokens set revoked_at = now(), revoked_by = 'user'
  where token_hash = v_hash and revoked_at is null;
end;
$$;

grant execute on function public.revoke_my_mod_token_by_raw(text) to anon, authenticated;

-- Mod-Seite: neue Einreichung anlegen. status wird IMMER serverseitig
-- auf 'pending' erzwungen (steht nicht als Parameter zur Verfuegung) -
-- der Mod-Client kann eine Einreichung strukturell nie mit einem
-- anderen Status anlegen. auth_user_id/minecraft_name kommen aus dem
-- Token bzw. als reiner Anzeige-/Audit-Wert, nie als vom Aufrufer frei
-- waehlbare "wessen Einreichung ist das"-Angabe.
create or replace function public.create_card_submission(
  p_raw_token text,
  p_minecraft_name text,
  p_image_url text,
  p_card_name text,
  p_category text,
  p_series text default null,
  p_width_maps integer default null,
  p_height_maps integer default null,
  p_total_maps integer default null,
  p_server text default null,
  p_warp text default null,
  p_seller text default null,
  p_price numeric default null,
  p_creator text default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_new_id uuid;
  v_rate_ok boolean;
begin
  v_uid := public._resolve_mod_token(p_raw_token);

  select public.check_and_record_rate_limit('submission_create:' || v_uid::text, 'submission_create', 10, 86400) into v_rate_ok;
  if not v_rate_ok then
    raise exception 'rate_limited';
  end if;

  if p_card_name is null or length(trim(p_card_name)) = 0 then
    raise exception 'card_name_required';
  end if;
  if p_category is null or length(trim(p_category)) = 0 then
    raise exception 'category_required';
  end if;
  if p_image_url is null or length(trim(p_image_url)) = 0 then
    raise exception 'image_required';
  end if;
  -- Nur Bilder akzeptieren, die tatsaechlich vom neuen Upload-Endpunkt
  -- stammen (api/card-submission-image.js schreibt ausschliesslich in
  -- dieses Praefix) - verhindert, dass ein manipulierter Aufruf eine
  -- beliebige fremde image_url (z.B. eine andere Domain) einschleust.
  if p_image_url not like 'https://zgknyrwzpohvfdweomxf.supabase.co/storage/v1/object/public/update-images/card-submissions/%' then
    raise exception 'invalid_image_url';
  end if;
  if length(coalesce(p_card_name, '')) > 120
    or length(coalesce(p_category, '')) > 60
    or length(coalesce(p_series, '')) > 120
    or length(coalesce(p_server, '')) > 40
    or length(coalesce(p_warp, '')) > 120
    or length(coalesce(p_seller, '')) > 60
    or length(coalesce(p_creator, '')) > 60
    or length(coalesce(p_description, '')) > 2000
    or length(coalesce(p_minecraft_name, '')) > 40
  then
    raise exception 'field_too_long';
  end if;
  if p_price is not null and (p_price < 0 or p_price > 100000000) then
    raise exception 'invalid_price';
  end if;
  if p_width_maps is not null and (p_width_maps < 1 or p_width_maps > 30) then
    raise exception 'invalid_dimensions';
  end if;
  if p_height_maps is not null and (p_height_maps < 1 or p_height_maps > 30) then
    raise exception 'invalid_dimensions';
  end if;

  insert into public.card_submissions (
    auth_user_id, minecraft_name, image_url, card_name, category, series,
    width_maps, height_maps, total_maps, server, warp, seller, price, creator, description, status
  ) values (
    v_uid, nullif(trim(coalesce(p_minecraft_name, '')), ''), p_image_url, trim(p_card_name), trim(p_category), nullif(trim(coalesce(p_series, '')), ''),
    p_width_maps, p_height_maps, p_total_maps, nullif(trim(coalesce(p_server, '')), ''), nullif(trim(coalesce(p_warp, '')), ''),
    nullif(trim(coalesce(p_seller, '')), ''), p_price, nullif(trim(coalesce(p_creator, '')), ''), nullif(trim(coalesce(p_description, '')), ''), 'pending'
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.create_card_submission(text, text, text, text, text, text, integer, integer, integer, text, text, text, numeric, text, text) to anon, authenticated;

-- Mod-Seite: eigene Einreichungen auflisten ("Meine Einreichungen").
-- Filtert ausschliesslich nach der aus dem Token abgeleiteten
-- auth_user_id - es gibt keinen Parameter, ueber den ein Aufrufer nach
-- einer FREMDEN auth_user_id fragen koennte (IDOR strukturell
-- ausgeschlossen, nicht nur per Policy verhindert).
create or replace function public.list_my_mod_submissions(p_raw_token text)
returns setof public.card_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_rate_ok boolean;
begin
  v_uid := public._resolve_mod_token(p_raw_token);

  select public.check_and_record_rate_limit('submission_list:' || v_uid::text, 'submission_list', 60, 3600) into v_rate_ok;
  if not v_rate_ok then
    raise exception 'rate_limited';
  end if;

  return query select * from public.card_submissions where auth_user_id = v_uid order by created_at desc;
end;
$$;

grant execute on function public.list_my_mod_submissions(text) to anon, authenticated;

-- Admin-Seite (admin.html, Karteneinreichungen-Bereich): Einreichung
-- annehmen. Atomar: legt die echte card_catalog-Zeile an UND markiert
-- die Einreichung als approved, in einer Transaktion (entweder beides
-- oder keins) - vermeidet einen inkonsistenten Zwischenstand, den ein
-- rohes zweiteiliges "insert dann update" von admin.html aus riskieren
-- wuerde. Wiederverwendbar statt admin.html eigene Insert-Logik
-- schreiben zu lassen (siehe CLAUDE.md-Anforderung "keine rohen Inserts
-- duplizieren, wenn Businesslogik existieren sollte").
create or replace function public.approve_card_submission(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.card_submissions%rowtype;
  v_new_card_id uuid;
  v_admin text := auth.jwt() ->> 'email';
begin
  if not public.is_active_admin() then
    raise exception 'not_admin';
  end if;

  select * into v_row from public.card_submissions where id = p_id for update;
  if v_row.id is null then
    raise exception 'submission_not_found';
  end if;
  if v_row.status != 'pending' and v_row.status != 'needs_changes' then
    raise exception 'submission_not_pending';
  end if;

  insert into public.card_catalog (
    name, category, shop_name, cb, size, submitted_by, description, image_url,
    series, price, seller, creator, width_maps, height_maps, total_maps, status
  ) values (
    v_row.card_name, v_row.category, v_row.warp, v_row.server,
    case when v_row.total_maps is not null then v_row.total_maps::text || 'er' else null end,
    v_row.minecraft_name, v_row.description, v_row.image_url,
    v_row.series, v_row.price, v_row.seller, v_row.creator,
    v_row.width_maps, v_row.height_maps, v_row.total_maps, 'approved'
  )
  returning id into v_new_card_id;

  update public.card_submissions
  set status = 'approved', approved_card_id = v_new_card_id, reviewed_at = now(), reviewed_by = v_admin
  where id = p_id;

  return v_new_card_id;
end;
$$;

grant execute on function public.approve_card_submission(uuid) to authenticated;
