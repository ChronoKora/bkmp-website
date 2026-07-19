/* ============================================================
   Gilden-Erweiterung (Spieler-Wunsch 14.07.: "Gildeneinstellung
   hinzufügen.. Chat etc.. Privat/Öffentlich. Füge alles hinzu was so eine
   Gilde ausmacht") - Beschreibung, Privat/Oeffentlich mit Einladungscode,
   einfacher Gilden-Chat (nur fuer Mitglieder sichtbar/schreibbar).

   Braucht supabase-idle-guilds.sql. Supabase Dashboard > SQL Editor >
   New query > diesen Inhalt ausfuehren. idempotent.
   ============================================================ */

alter table public.guilds add column if not exists is_public boolean not null default true;
alter table public.guilds add column if not exists invite_code text;

-- Sicherheits-Haertung: die guilds-Tabelle ist absichtlich komplett oeffentlich
-- lesbar (Name/Tag/Kasse/Mitgliederzahl fuer die Durchsuchen-Liste), ABER
-- invite_code darf NICHT ueber einen normalen SELECT abgreifbar sein - sonst
-- waere "privat" wirkungslos (jeder koennte den Code einfach mitlesen).
-- Spalten-Rechte statt Zeilen-Rechte (RLS kann das nicht abbilden) - Security-
-- definer-RPCs (siehe unten) koennen die Spalte trotzdem intern lesen, weil
-- sie mit den Rechten des Funktionsbesitzers laufen, nicht des Aufrufers.
revoke select (invite_code) on public.guilds from anon, authenticated;

create table if not exists public.guild_chat_messages (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references public.guilds(id) on delete cascade,
  auth_user_id uuid not null,
  display_name text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists guild_chat_messages_guild_idx on public.guild_chat_messages (guild_id, created_at desc);

alter table public.guild_chat_messages enable row level security;
grant select on public.guild_chat_messages to authenticated;
drop policy if exists "Members read guild chat" on public.guild_chat_messages;
create policy "Members read guild chat" on public.guild_chat_messages for select to authenticated
using (exists (select 1 from public.guild_members gm where gm.guild_id = guild_chat_messages.guild_id and gm.auth_user_id = auth.uid()));
-- Kein direktes insert fuer Clients - nur die RPC unten (prueft Mitgliedschaft
-- UND Nachrichtenlaenge serverseitig, statt sich auf den Client zu verlassen).

-- ============================================================
-- send_guild_chat_message(): Mitgliedschaft wird ueber die eigene
-- guild_members-Zeile ermittelt (Spieler gibt keine guild_id mit - kann so
-- nicht versehentlich/absichtlich in eine fremde Gilde schreiben).
-- ============================================================
create or replace function public.send_guild_chat_message(p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_display_name text;
  v_message text := trim(p_message);
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_message = '' or length(v_message) > 300 then raise exception 'invalid_message'; end if;

  select guild_id, display_name into v_guild_id, v_display_name from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then raise exception 'not_in_guild'; end if;

  insert into public.guild_chat_messages (guild_id, auth_user_id, display_name, message)
  values (v_guild_id, v_uid, v_display_name, v_message);
end;
$$;
grant execute on function public.send_guild_chat_message(text) to authenticated;

-- ============================================================
-- update_guild_settings(): nur der Anfuehrer darf Beschreibung/Sichtbarkeit
-- aendern. Beim Wechsel zu privat wird ein Einladungscode erzeugt, falls
-- noch keiner existiert (bleibt bei erneutem Umschalten stabil, damit
-- bereits geteilte Codes nicht ungueltig werden).
-- ============================================================
create or replace function public.update_guild_settings(p_description text, p_is_public boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_description text := left(trim(coalesce(p_description, '')), 200);
  v_code text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid and role = 'leader';
  if v_guild_id is null then raise exception 'not_authorized'; end if;

  if not p_is_public then
    select invite_code into v_code from public.guilds where id = v_guild_id;
    if v_code is null then
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    end if;
  else
    v_code := null;
  end if;

  update public.guilds
  set description = v_description, is_public = p_is_public, invite_code = coalesce(v_code, invite_code)
  where id = v_guild_id;

  return v_code;
end;
$$;
grant execute on function public.update_guild_settings(text, boolean) to authenticated;

-- ============================================================
-- regenerate_guild_invite_code(): fuer den Fall, dass ein Code versehentlich
-- an die falsche Person ging.
-- ============================================================
create or replace function public.regenerate_guild_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_code text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid and role = 'leader';
  if v_guild_id is null then raise exception 'not_authorized'; end if;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update public.guilds set invite_code = v_code where id = v_guild_id;
  return v_code;
end;
$$;
grant execute on function public.regenerate_guild_invite_code() to authenticated;

-- ============================================================
-- get_my_guild_invite_code(): damit der Anfuehrer seinen Code auch nach dem
-- Schliessen/Neuladen der Seite wieder sehen kann, ohne ihn per
-- regenerate_guild_invite_code() zu aendern (wuerde bereits geteilte Codes
-- ungueltig machen).
-- ============================================================
create or replace function public.get_my_guild_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_code text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid and role = 'leader';
  if v_guild_id is null then raise exception 'not_authorized'; end if;
  select invite_code into v_code from public.guilds where id = v_guild_id;
  return v_code;
end;
$$;
grant execute on function public.get_my_guild_invite_code() to authenticated;

-- ============================================================
-- join_guild(): jetzt zusaetzlich mit Sichtbarkeits-Check - eine private
-- Gilde ist ueber diesen "normalen" Weg nicht beitretbar, nur ueber
-- join_guild_by_code() unten. Gleiche Signatur wie zuvor (nur der Koerper
-- aendert sich), daher reicht create or replace ohne vorheriges drop.
-- ============================================================
create or replace function public.join_guild(p_guild_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_display_name text;
  v_member_count integer;
  v_is_public boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.guild_members where auth_user_id = v_uid) then raise exception 'already_in_guild'; end if;

  select display_name into v_display_name from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_display_name is null then raise exception 'no_idle_state'; end if;

  select member_count, is_public into v_member_count, v_is_public from public.guilds where id = p_guild_id;
  if v_member_count is null then raise exception 'guild_not_found'; end if;
  if not v_is_public then raise exception 'guild_private'; end if;
  if v_member_count >= 20 then raise exception 'guild_full'; end if;

  insert into public.guild_members (auth_user_id, guild_id, name_key, display_name, role)
  values (v_uid, p_guild_id, lower(v_display_name), v_display_name, 'member');

  update public.guilds set member_count = member_count + 1 where id = p_guild_id;
end;
$$;
grant execute on function public.join_guild(uuid) to authenticated;

create or replace function public.join_guild_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_display_name text;
  v_guild_id uuid;
  v_member_count integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.guild_members where auth_user_id = v_uid) then raise exception 'already_in_guild'; end if;

  select display_name into v_display_name from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_display_name is null then raise exception 'no_idle_state'; end if;

  select id, member_count into v_guild_id, v_member_count from public.guilds where invite_code = upper(trim(p_code));
  if v_guild_id is null then raise exception 'invalid_code'; end if;
  if v_member_count >= 20 then raise exception 'guild_full'; end if;

  insert into public.guild_members (auth_user_id, guild_id, name_key, display_name, role)
  values (v_uid, v_guild_id, lower(v_display_name), v_display_name, 'member');

  update public.guilds set member_count = member_count + 1 where id = v_guild_id;
  return v_guild_id;
end;
$$;
grant execute on function public.join_guild_by_code(text) to authenticated;
