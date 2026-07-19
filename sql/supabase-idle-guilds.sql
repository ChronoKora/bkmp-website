/* ============================================================
   Gildensystem (Spieler-Wunsch 14.07.: "PvP Arena einbauen. Und Das Gilden
   System") - kleine Spielergruppen mit gemeinsamer Kasse, die per
   Meilenstein passive Boni fuer ALLE Mitglieder freischaltet (siehe
   supabase-idle-guilds-treasury-bonus.sql / bkmpIdleRecomputeEffectiveStats
   in idledorf.js).

   Jeder Spieler ist zu jeder Zeit maximal in EINER Gilde - vereinfacht
   Balance/Anzeige deutlich, ohne die eigentliche Idee (gemeinsame Kasse,
   Rollen, Bestenliste) einzuschraenken. Alle Schreibzugriffe laufen ueber
   security-definer-RPCs (nicht direkt auf die Tabellen) - verhindert
   gefaelschte Kassenstaende oder Rollen-Manipulation per direktem
   REST-Call, gleiches Vorsichtsprinzip wie beim Weltboss-Raid.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   idempotent: mehrfaches Ausfuehren ist unschaedlich.
   ============================================================ */

create table if not exists public.guilds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text not null unique,
  tag text not null,
  description text not null default '',
  leader_auth_user_id uuid not null,
  treasury_gold bigint not null default 0,
  member_count integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists guilds_treasury_idx on public.guilds (treasury_gold desc);

alter table public.guilds enable row level security;
grant select on public.guilds to anon, authenticated;
drop policy if exists "Public read guilds" on public.guilds;
create policy "Public read guilds" on public.guilds for select to anon, authenticated using (true);
-- Kein direktes insert/update/delete fuer Clients - nur die RPCs unten.

create table if not exists public.guild_members (
  auth_user_id uuid primary key,
  guild_id uuid not null references public.guilds(id) on delete cascade,
  name_key text not null,
  display_name text not null,
  role text not null default 'member' check (role in ('leader', 'officer', 'member')),
  contributed_gold bigint not null default 0,
  joined_at timestamptz not null default now()
);
create index if not exists guild_members_guild_idx on public.guild_members (guild_id);

alter table public.guild_members enable row level security;
grant select on public.guild_members to anon, authenticated;
drop policy if exists "Public read guild members" on public.guild_members;
create policy "Public read guild members" on public.guild_members for select to anon, authenticated using (true);

-- ============================================================
-- create_guild(): Gildenname UND -Tag laufen durch dieselbe Namens-Sperre
-- wie Spieler-Namen (is_name_blocked, siehe supabase-player-name-
-- blocklist.sql) - eine Gilde ist genauso oeffentlich sichtbar wie ein
-- Spielername, dieselbe Missbrauchsgefahr.
-- ============================================================
create or replace function public.create_guild(p_name text, p_tag text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := trim(p_name);
  v_tag text := upper(trim(p_tag));
  v_name_key text := lower(v_name);
  v_display_name text;
  v_guild_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_name = '' or length(v_name) > 32 then raise exception 'invalid_name'; end if;
  if v_tag = '' or length(v_tag) > 5 then raise exception 'invalid_tag'; end if;
  if public.is_name_blocked(v_name) or public.is_name_blocked(v_tag) then raise exception 'name_blocked'; end if;
  if exists (select 1 from public.guild_members where auth_user_id = v_uid) then raise exception 'already_in_guild'; end if;
  if exists (select 1 from public.guilds where name_key = v_name_key) then raise exception 'name_taken'; end if;

  select display_name into v_display_name from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_display_name is null then raise exception 'no_idle_state'; end if;

  insert into public.guilds (name, name_key, tag, leader_auth_user_id)
  values (v_name, v_name_key, v_tag, v_uid)
  returning id into v_guild_id;

  insert into public.guild_members (auth_user_id, guild_id, name_key, display_name, role)
  values (v_uid, v_guild_id, lower(v_display_name), v_display_name, 'leader');

  return v_guild_id;
end;
$$;
grant execute on function public.create_guild(text, text) to authenticated;

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
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.guild_members where auth_user_id = v_uid) then raise exception 'already_in_guild'; end if;

  select display_name into v_display_name from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_display_name is null then raise exception 'no_idle_state'; end if;

  select member_count into v_member_count from public.guilds where id = p_guild_id;
  if v_member_count is null then raise exception 'guild_not_found'; end if;
  if v_member_count >= 20 then raise exception 'guild_full'; end if;

  insert into public.guild_members (auth_user_id, guild_id, name_key, display_name, role)
  values (v_uid, p_guild_id, lower(v_display_name), v_display_name, 'member');

  update public.guilds set member_count = member_count + 1 where id = p_guild_id;
end;
$$;
grant execute on function public.join_guild(uuid) to authenticated;

-- ============================================================
-- leave_guild(): verlaesst die aktuelle Gilde ganz einfach ist der letzte
-- verbleibende Fuehrer die Gilde wird geloescht (verwaist sonst leiter-
-- los), ansonsten geht die Fuehrung an das laengst dienende verbleibende
-- Mitglied (kein manuelles Uebergabe-Prozedere noetig).
-- ============================================================
create or replace function public.leave_guild()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_was_leader boolean;
  v_remaining integer;
  v_next_leader uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select guild_id, (role = 'leader') into v_guild_id, v_was_leader
  from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then raise exception 'not_in_guild'; end if;

  delete from public.guild_members where auth_user_id = v_uid;

  select count(*) into v_remaining from public.guild_members where guild_id = v_guild_id;
  if v_remaining = 0 then
    delete from public.guilds where id = v_guild_id;
    return;
  end if;

  update public.guilds set member_count = v_remaining where id = v_guild_id;

  if v_was_leader then
    select auth_user_id into v_next_leader from public.guild_members
    where guild_id = v_guild_id order by (role = 'officer') desc, joined_at asc limit 1;
    update public.guild_members set role = 'leader' where auth_user_id = v_next_leader;
    update public.guilds set leader_auth_user_id = v_next_leader where id = v_guild_id;
  end if;
end;
$$;
grant execute on function public.leave_guild() to authenticated;

-- ============================================================
-- contribute_gold(): zieht Gold direkt vom eigenen idle_player_state ab -
-- security definer umgeht die normale, offene idle_player_state-RLS nicht,
-- prueft aber zusaetzlich auf ausreichendes Guthaben (ein simples Client-
-- Update koennte sonst behaupten, mehr beigetragen zu haben als vorhanden).
-- ============================================================
create or replace function public.contribute_gold(p_amount bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_gold bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then raise exception 'not_in_guild'; end if;

  select gold into v_gold from public.idle_player_state where auth_user_id = v_uid;
  if v_gold is null or v_gold < p_amount then raise exception 'insufficient_gold'; end if;

  update public.idle_player_state set gold = gold - p_amount where auth_user_id = v_uid;
  update public.guild_members set contributed_gold = contributed_gold + p_amount where auth_user_id = v_uid;
  update public.guilds set treasury_gold = treasury_gold + p_amount where id = v_guild_id;
end;
$$;
grant execute on function public.contribute_gold(bigint) to authenticated;

create or replace function public.kick_guild_member(p_target_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_my_role text;
  v_guild_id uuid;
  v_target_guild_id uuid;
  v_target_role text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_uid = p_target_auth_user_id then raise exception 'cannot_kick_self'; end if;

  select guild_id, role into v_guild_id, v_my_role from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null or v_my_role not in ('leader', 'officer') then raise exception 'not_authorized'; end if;

  select guild_id, role into v_target_guild_id, v_target_role from public.guild_members where auth_user_id = p_target_auth_user_id;
  if v_target_guild_id is null or v_target_guild_id <> v_guild_id then raise exception 'not_a_member'; end if;
  if v_target_role = 'leader' then raise exception 'cannot_kick_leader'; end if;
  if v_my_role = 'officer' and v_target_role = 'officer' then raise exception 'not_authorized'; end if;

  delete from public.guild_members where auth_user_id = p_target_auth_user_id;
  update public.guilds set member_count = greatest(0, member_count - 1) where id = v_guild_id;
end;
$$;
grant execute on function public.kick_guild_member(uuid) to authenticated;

create or replace function public.set_guild_member_role(p_target_auth_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_target_guild_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_new_role not in ('officer', 'member') then raise exception 'invalid_role'; end if;

  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid and role = 'leader';
  if v_guild_id is null then raise exception 'not_authorized'; end if;

  select guild_id into v_target_guild_id from public.guild_members where auth_user_id = p_target_auth_user_id;
  if v_target_guild_id is null or v_target_guild_id <> v_guild_id then raise exception 'not_a_member'; end if;

  update public.guild_members set role = p_new_role where auth_user_id = p_target_auth_user_id;
end;
$$;
grant execute on function public.set_guild_member_role(uuid, text) to authenticated;
