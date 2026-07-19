/* ============================================================
   Gildensystem-Erweiterung, Phase A: Datenmodell-Fundament
   (Spieler-Wunsch 15.07.: "Gildensystem erweitern... langfristig
   motivierend, lebendig und als echtes Endgame-Feature").

   Fuegt hinzu:
   - Gilden-Level/-XP (guild_xp, getrennt von der ausgebbaren
     treasury_gold-Kasse - siehe Kommentar bei guild_xp unten)
   - Ein Aktivitaetslog (guild_activity_log) fuer alle wichtigen
     Gildenereignisse
   - Eine eigene, echte Online-Status-Tabelle (player_presence)
   - Ein Freitext-Gildenziel + ein Banner-jsonb-Feld (Inhalt/Editor
     folgen in spaeteren Phasen, die Spalten werden hier schon
     angelegt)

   Baut auf supabase-idle-guilds.sql +
   supabase-idle-guilds-founding-cost.sql +
   supabase-idle-guilds-settings-chat.sql auf - muss NACH diesen
   Dateien ausgefuehrt werden.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt
   ausfuehren. idempotent: mehrfaches Ausfuehren ist unschaedlich.
   ============================================================ */

-- ============================================================
-- guild_xp ist bewusst NICHT dasselbe wie treasury_gold: die Kasse
-- ist ausgebbar (Technologie-Baum, spaetere Phase E) und wuerde beim
-- Ausgeben das Level wieder sinken lassen, wenn beides dieselbe Zahl
-- waere. guild_xp ist eine reine, nie sinkende Lebenszeit-Summe aller
-- jemals gespendeten Gold-Betraege - treibt ausschliesslich das Level.
-- ============================================================
alter table public.guilds add column if not exists guild_xp bigint not null default 0;
alter table public.guilds add column if not exists current_goal text not null default '';
alter table public.guilds add column if not exists banner jsonb not null default '{}'::jsonb;
create index if not exists guilds_xp_idx on public.guilds (guild_xp desc);

-- ============================================================
-- guild_level_thresholds: bewusst eine Tabelle statt einer Formel im
-- Code - "die benoetigten Werte sollen spaeter einfach anpassbar
-- sein" (Spieler-Wunsch). Einfach diesen INSERT-Block mit neuen
-- Werten erneut ausfuehren, um die Kurve nachzujustieren (on conflict
-- update macht das gefahrlos wiederholbar).
-- ============================================================
create table if not exists public.guild_level_thresholds (
  level int primary key,
  xp_required bigint not null
);
alter table public.guild_level_thresholds enable row level security;
grant select on public.guild_level_thresholds to anon, authenticated;
drop policy if exists "Public read guild level thresholds" on public.guild_level_thresholds;
create policy "Public read guild level thresholds" on public.guild_level_thresholds for select to anon, authenticated using (true);

insert into public.guild_level_thresholds (level, xp_required) values
  (1, 0), (2, 150000), (3, 500000), (4, 1500000), (5, 4000000),
  (6, 9000000), (7, 18000000), (8, 32000000), (9, 55000000), (10, 90000000),
  (11, 140000000), (12, 210000000), (13, 300000000), (14, 420000000), (15, 580000000),
  (16, 780000000), (17, 1030000000), (18, 1340000000), (19, 1720000000), (20, 2180000000),
  (21, 2730000000), (22, 3380000000), (23, 4150000000), (24, 5050000000), (25, 6100000000),
  (26, 7320000000), (27, 8730000000), (28, 10350000000), (29, 12200000000), (30, 14300000000)
on conflict (level) do update set xp_required = excluded.xp_required;

create or replace function public.guild_level_for_xp(p_xp bigint)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(max(level), 1) from public.guild_level_thresholds where xp_required <= coalesce(p_xp, 0);
$$;

-- ============================================================
-- guild_activity_log: generische, typisierte Ereigniszeile statt
-- vorformatierter Saetze - der Client baut die deutsche Anzeige aus
-- kind/actor_name/value/extra zusammen (gleiches Prinzip wie ueberall
-- sonst in diesem Projekt: Server speichert Rohdaten, Client
-- formatiert). "value" ist ein generischer Zahlwert (Gold-Betrag bei
-- 'contribute', erreichtes Level bei 'level_up', usw.) - je nach kind
-- unterschiedlich belegt.
-- ============================================================
create table if not exists public.guild_activity_log (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references public.guilds(id) on delete cascade,
  kind text not null,
  actor_name text,
  value bigint,
  extra text,
  created_at timestamptz not null default now()
);
create index if not exists guild_activity_log_guild_idx on public.guild_activity_log (guild_id, created_at desc);

alter table public.guild_activity_log enable row level security;
grant select on public.guild_activity_log to authenticated;
drop policy if exists "Members read guild activity" on public.guild_activity_log;
create policy "Members read guild activity" on public.guild_activity_log for select to authenticated
using (exists (select 1 from public.guild_members gm where gm.guild_id = guild_activity_log.guild_id and gm.auth_user_id = auth.uid()));
-- Kein direktes insert fuer Clients - nur die (erweiterten) RPCs unten schreiben hier.

-- ============================================================
-- player_presence: echter Online-Heartbeat, getrennt vom
-- ereignisgetriebenen idle_player_state.last_seen_at (das aktualisiert
-- sich nur bei Spielaktionen, nicht waehrend z.B. nur der Gilden-Tab
-- offen ist). Gleiches Heartbeat-Prinzip wie beim bestehenden
-- Twitch-Sync (idle_stream_presence), nur global statt Stream-bezogen.
-- ============================================================
create table if not exists public.player_presence (
  auth_user_id uuid primary key,
  last_seen_at timestamptz not null default now()
);
alter table public.player_presence enable row level security;
grant select on public.player_presence to anon, authenticated;
drop policy if exists "Public read presence" on public.player_presence;
create policy "Public read presence" on public.player_presence for select to anon, authenticated using (true);
-- Kein direktes insert/update fuer Clients - nur player_heartbeat() unten
-- (verhindert, dass jemand einen fremden Online-Status faelscht).

create or replace function public.player_heartbeat()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  insert into public.player_presence (auth_user_id, last_seen_at)
  values (v_uid, now())
  on conflict (auth_user_id) do update set last_seen_at = now();
end;
$$;
grant execute on function public.player_heartbeat() to authenticated;

-- ============================================================
-- contribute_gold(): gleiche Signatur wie zuvor (nur der Koerper
-- aendert sich, daher reicht create or replace ohne vorheriges drop).
-- Neu: schreibt guild_xp zusaetzlich zur Kasse hoch, erkennt einen
-- Levelaufstieg (Vergleich vor/nach ueber guild_level_for_xp) und
-- protokolliert beides im Aktivitaetslog.
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
  v_display_name text;
  v_gold bigint;
  v_old_xp bigint;
  v_new_xp bigint;
  v_old_level int;
  v_new_level int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  select guild_id, display_name into v_guild_id, v_display_name from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then raise exception 'not_in_guild'; end if;

  select gold into v_gold from public.idle_player_state where auth_user_id = v_uid;
  if v_gold is null or v_gold < p_amount then raise exception 'insufficient_gold'; end if;

  select guild_xp into v_old_xp from public.guilds where id = v_guild_id;
  v_old_level := public.guild_level_for_xp(coalesce(v_old_xp, 0));

  update public.idle_player_state set gold = gold - p_amount where auth_user_id = v_uid;
  update public.guild_members set contributed_gold = contributed_gold + p_amount where auth_user_id = v_uid;
  update public.guilds set treasury_gold = treasury_gold + p_amount, guild_xp = guild_xp + p_amount
    where id = v_guild_id
    returning guild_xp into v_new_xp;

  v_new_level := public.guild_level_for_xp(v_new_xp);

  insert into public.guild_activity_log (guild_id, kind, actor_name, value)
  values (v_guild_id, 'contribute', v_display_name, p_amount);

  if v_new_level > v_old_level then
    insert into public.guild_activity_log (guild_id, kind, value)
    values (v_guild_id, 'level_up', v_new_level);
  end if;
end;
$$;
grant execute on function public.contribute_gold(bigint) to authenticated;

-- ============================================================
-- join_guild / join_guild_by_code / leave_guild / kick_guild_member:
-- gleiche Signaturen und gleiche Kernlogik wie in
-- supabase-idle-guilds-settings-chat.sql, jeweils nur um einen
-- Aktivitaetslog-Eintrag ergaenzt.
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

  insert into public.guild_activity_log (guild_id, kind, actor_name)
  values (p_guild_id, 'join', v_display_name);
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

  insert into public.guild_activity_log (guild_id, kind, actor_name)
  values (v_guild_id, 'join', v_display_name);

  return v_guild_id;
end;
$$;
grant execute on function public.join_guild_by_code(text) to authenticated;

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
  v_display_name text;
  v_remaining integer;
  v_next_leader uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select guild_id, (role = 'leader'), display_name into v_guild_id, v_was_leader, v_display_name
  from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then raise exception 'not_in_guild'; end if;

  delete from public.guild_members where auth_user_id = v_uid;

  select count(*) into v_remaining from public.guild_members where guild_id = v_guild_id;
  if v_remaining = 0 then
    delete from public.guilds where id = v_guild_id;
    return;
  end if;

  update public.guilds set member_count = v_remaining where id = v_guild_id;

  insert into public.guild_activity_log (guild_id, kind, actor_name)
  values (v_guild_id, 'leave', v_display_name);

  if v_was_leader then
    select auth_user_id into v_next_leader from public.guild_members
    where guild_id = v_guild_id order by (role = 'officer') desc, joined_at asc limit 1;
    update public.guild_members set role = 'leader' where auth_user_id = v_next_leader;
    update public.guilds set leader_auth_user_id = v_next_leader where id = v_guild_id;
  end if;
end;
$$;
grant execute on function public.leave_guild() to authenticated;

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
  v_target_name text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_uid = p_target_auth_user_id then raise exception 'cannot_kick_self'; end if;

  select guild_id, role into v_guild_id, v_my_role from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null or v_my_role not in ('leader', 'officer') then raise exception 'not_authorized'; end if;

  select guild_id, role, display_name into v_target_guild_id, v_target_role, v_target_name from public.guild_members where auth_user_id = p_target_auth_user_id;
  if v_target_guild_id is null or v_target_guild_id <> v_guild_id then raise exception 'not_a_member'; end if;
  if v_target_role = 'leader' then raise exception 'cannot_kick_leader'; end if;
  if v_my_role = 'officer' and v_target_role = 'officer' then raise exception 'not_authorized'; end if;

  delete from public.guild_members where auth_user_id = p_target_auth_user_id;
  update public.guilds set member_count = greatest(0, member_count - 1) where id = v_guild_id;

  insert into public.guild_activity_log (guild_id, kind, actor_name)
  values (v_guild_id, 'kick', v_target_name);
end;
$$;
grant execute on function public.kick_guild_member(uuid) to authenticated;
