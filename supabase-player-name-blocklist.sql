-- Bkmp - Sperrliste fuer rassistische/NS-verherrlichende Ingame-Namen.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Anlass (14.07.): Spieler-Account "Adolf Hitler" musste manuell geloescht
-- werden. Wunsch: "zukuenftig das rassistische Namen nicht benutzbar sind...
-- das sowas erst gar nicht erstellbar ist." Statt einer ungeprueften
-- Wortliste aus dem Netz: eine kuratierte, jederzeit per INSERT erweiterbare
-- Tabelle (siehe Abschnitt ganz unten fuer "neuen Begriff sperren").
--
-- Greift an ZWEI Stellen, beide serverseitig (nicht nur im Frontend
-- umgehbar):
--   1) Registrierung (auth.users, Trigger) - siehe bkmpPlayerRegister in
--      supabase.js, die zusaetzlich VOR dem eigentlichen signUp per RPC
--      prueft, damit der Spieler eine saubere deutsche Fehlermeldung sieht
--      statt eines rohen Datenbankfehlers.
--   2) Namensaenderung (rename_player_account, siehe
--      supabase-player-accounts-v3.sql) - gleicher Check, gleiche Funktion.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

-- ============================================================
-- 1) Tabelle: gesperrte Namensbestandteile (normalisiert: klein, nur a-z0-9)
-- ============================================================
create table if not exists public.blocked_display_names (
  name_key text primary key,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.blocked_display_names enable row level security;

drop policy if exists "Admins manage blocked names" on public.blocked_display_names;
create policy "Admins manage blocked names"
on public.blocked_display_names for all
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

-- ============================================================
-- 2) is_name_blocked(): normalisiert den Kandidaten (klein, Sonderzeichen
--    raus) und prueft, ob ein gesperrter Begriff darin vorkommt (nicht nur
--    exakte Uebereinstimmung - faengt auch "xAdolfHitlerx" oder
--    "adolf_hitler99"). security definer + fuer anon nutzbar, damit die
--    Registrierung (noch nicht eingeloggt) den Vorab-Check per RPC machen
--    kann.
-- ============================================================
create or replace function public.is_name_blocked(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocked_display_names b
    where length(b.name_key) > 0
    and regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]', '', 'g') like '%' || b.name_key || '%'
  );
$$;
grant execute on function public.is_name_blocked(text) to anon, authenticated;

-- ============================================================
-- 3) Registrierung serverseitig blocken (Trigger auf auth.users) - faengt
--    auch Umgehungsversuche ab, die nicht ueber die normale Registrierungs-
--    UI laufen.
-- ============================================================
create or replace function public.block_forbidden_display_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_name_blocked(new.raw_user_meta_data ->> 'display_name') then
    raise exception 'name_blocked';
  end if;
  return new;
end;
$$;

drop trigger if exists bkmp_block_forbidden_names on auth.users;
create trigger bkmp_block_forbidden_names
  before insert on auth.users
  for each row execute function public.block_forbidden_display_names();

-- ============================================================
-- 4) rename_player_account() um denselben Check ergaenzen (1:1 dieselbe
--    Logik wie in supabase-player-accounts-v3.sql, nur mit der zusaetzlichen
--    Pruefung nach invalid_name).
-- ============================================================
create or replace function public.rename_player_account(p_new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new_name text := trim(p_new_name);
  v_new_key text := lower(v_new_name);
  v_old_row public.player_stats%rowtype;
  v_conflict_owner uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if v_new_key = '' or length(v_new_key) > 32 then
    raise exception 'invalid_name';
  end if;
  if public.is_name_blocked(v_new_name) then
    raise exception 'name_blocked';
  end if;

  select * into v_old_row from public.player_stats where auth_user_id = v_uid limit 1;
  if not found then
    raise exception 'no_account';
  end if;

  if v_old_row.name_key = v_new_key then
    raise exception 'same_name';
  end if;

  if v_old_row.last_name_change_at is not null and v_old_row.last_name_change_at > now() - interval '30 days' then
    raise exception 'cooldown_active';
  end if;

  select auth_user_id into v_conflict_owner from public.player_stats where name_key = v_new_key limit 1;
  if found and v_conflict_owner is distinct from v_uid then
    raise exception 'name_taken';
  end if;

  insert into public.player_name_history (auth_user_id, old_name, new_name)
  values (v_uid, v_old_row.display_name, v_new_name);

  update public.player_stats
  set name_key = v_new_key, display_name = v_new_name, last_name_change_at = now()
  where auth_user_id = v_uid;

  update public.idle_player_state
  set name_key = v_new_key, display_name = v_new_name
  where auth_user_id = v_uid;

  update public.user_plushies
  set name_key = v_new_key, display_name = v_new_name
  where name_key = v_old_row.name_key;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', v_new_name)
  where id = v_uid;
end;
$$;
grant execute on function public.rename_player_account(text) to authenticated;

-- ============================================================
-- 5) Kuratierte Grundliste: bekannte NS-Fuehrungsfiguren, NS-Symbolik/Codes
--    und gaengige rassistische Begriffe (normalisiert: klein, nur a-z0-9).
--    "on conflict do nothing", damit mehrfaches Ausfuehren nichts doppelt
--    anlegt.
-- ============================================================
insert into public.blocked_display_names (name_key, reason) values
  ('adolfhitler', 'NS-Führungsfigur'),
  ('hitler', 'NS-Führungsfigur'),
  ('mengele', 'NS-Kriegsverbrecher'),
  ('himmler', 'NS-Führungsfigur'),
  ('goebbels', 'NS-Führungsfigur'),
  ('goering', 'NS-Führungsfigur'),
  ('heydrich', 'NS-Führungsfigur'),
  ('eichmann', 'NS-Kriegsverbrecher'),
  ('nsdap', 'NS-Symbolik'),
  ('hakenkreuz', 'NS-Symbolik'),
  ('swastika', 'NS-Symbolik'),
  ('siegheil', 'NS-Symbolik'),
  ('heilhitler', 'NS-Symbolik'),
  ('1488', 'Bekannter Hasscode (NS-Bezug)'),
  ('kkk', 'Rassistische Organisation'),
  ('kukluxklan', 'Rassistische Organisation'),
  ('whitepower', 'Rassistischer Slogan'),
  ('masterrace', 'Rassistischer Slogan'),
  ('herrenrasse', 'Rassistischer Slogan')
on conflict (name_key) do nothing;

-- ============================================================
-- Neuen Begriff sperren (spaeter jederzeit per SQL Editor ausfuehrbar):
--
--   insert into public.blocked_display_names (name_key, reason)
--   values ('beispielname', 'Begruendung')
--   on conflict (name_key) do nothing;
--
-- WICHTIG: name_key immer klein und nur a-z0-9 (keine Leerzeichen/Symbole,
-- keine Umlaute - "ö"/"ä"/"ü" werden bei der Normalisierung entfernt statt
-- zu oe/ae/ue umgewandelt, also z. B. "goering" statt "göring" eintragen).
-- ============================================================
