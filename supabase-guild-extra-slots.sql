/* ============================================================
   Gildensystem-Erweiterung: Gildenplätze dazukaufen (Spieler-Wunsch
   16.07., Discord: "Die Gilde ist voll wir brauchen mehr Platz ^^" /
   "So eine Funktion für Gilden mehr Platz dazu zukaufen").

   Bisher war der Mitglieder-Deckel (20) in join_guild()/
   join_guild_by_code()/respond_guild_join_request() hart einprogrammiert.
   Fuegt eine neue Spalte guilds.bonus_member_slots hinzu (0 = nur der
   Basis-Deckel von 20) und eine neue RPC buy_guild_slot(), mit der
   Anfuehrer/Stellvertreter die Gildenkasse (treasury_gold, dieselbe
   ausgebbare Kasse wie beim Technologie-Baum, siehe
   supabase-guild-tech-tree.sql) gegen +1 zusaetzlichen Platz eintauschen
   koennen - max. 10 zusaetzliche Plaetze (Deckel dann 30). Kostenkurve
   400.000 * 1,5^bereits gekaufte Plaetze (client-seitig identisch in
   idledorf.js's bkmpGuildSlotCost() nachgebildet, NUR fuer die Anzeige -
   bezahlt/geprueft wird ausschliesslich hier serverseitig).

   join_guild()/join_guild_by_code() (zuletzt definiert in
   supabase-guild-extension-foundation.sql) und
   respond_guild_join_request() (aus supabase-guild-join-requests.sql)
   werden hier erneut per create-or-replace mit demselben Koerper, aber
   dynamischem Deckel (20 + bonus_member_slots statt hart 20) ersetzt.

   Baut auf supabase-idle-guilds.sql + supabase-guild-extension-
   foundation.sql + supabase-guild-join-requests.sql auf - muss NACH
   diesen Dateien ausgefuehrt werden.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   idempotent: mehrfaches Ausfuehren ist unschaedlich.
   ============================================================ */

alter table public.guilds add column if not exists bonus_member_slots integer not null default 0;

-- ============================================================
-- buy_guild_slot(): +1 Mitgliederplatz gegen Gildenkasse, max. 10 Käufe
-- pro Gilde (Deckel 20 -> 30). Gleiches Rechte-/Kosten-Prinzip wie
-- guild_tech_upgrade() (nur Anführer/Stellvertreter, zieht von
-- treasury_gold ab).
-- ============================================================
create or replace function public.buy_guild_slot()
returns table (new_bonus_slots int, treasury_gold bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_my_role text;
  v_display_name text;
  v_current_bonus int;
  v_cost bigint;
  v_treasury bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select guild_id, role, display_name into v_guild_id, v_my_role, v_display_name from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null or v_my_role not in ('leader', 'officer') then raise exception 'not_authorized'; end if;

  select guilds.bonus_member_slots, guilds.treasury_gold into v_current_bonus, v_treasury from public.guilds where id = v_guild_id;
  v_current_bonus := coalesce(v_current_bonus, 0);
  if v_current_bonus >= 10 then raise exception 'max_slots'; end if;

  v_cost := round(400000 * power(1.5, v_current_bonus));
  if v_treasury is null or v_treasury < v_cost then raise exception 'insufficient_treasury'; end if;

  update public.guilds set treasury_gold = guilds.treasury_gold - v_cost, bonus_member_slots = guilds.bonus_member_slots + 1
    where id = v_guild_id
    returning guilds.bonus_member_slots, guilds.treasury_gold into v_current_bonus, v_treasury;

  insert into public.guild_activity_log (guild_id, kind, actor_name, value)
  values (v_guild_id, 'slot_purchase', v_display_name, 20 + v_current_bonus);

  return query select v_current_bonus, v_treasury;
end;
$$;
grant execute on function public.buy_guild_slot() to authenticated;

-- ============================================================
-- join_guild() / join_guild_by_code(): identisch zur Fassung in
-- supabase-guild-extension-foundation.sql, nur der Groessen-Deckel ist
-- jetzt dynamisch (20 + bonus_member_slots statt hart 20).
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
  v_bonus_slots integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.guild_members where auth_user_id = v_uid) then raise exception 'already_in_guild'; end if;

  select display_name into v_display_name from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_display_name is null then raise exception 'no_idle_state'; end if;

  select member_count, is_public, bonus_member_slots into v_member_count, v_is_public, v_bonus_slots from public.guilds where id = p_guild_id;
  if v_member_count is null then raise exception 'guild_not_found'; end if;
  if not v_is_public then raise exception 'guild_private'; end if;
  if v_member_count >= 20 + coalesce(v_bonus_slots, 0) then raise exception 'guild_full'; end if;

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
  v_bonus_slots integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.guild_members where auth_user_id = v_uid) then raise exception 'already_in_guild'; end if;

  select display_name into v_display_name from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_display_name is null then raise exception 'no_idle_state'; end if;

  select id, member_count, bonus_member_slots into v_guild_id, v_member_count, v_bonus_slots from public.guilds where invite_code = upper(trim(p_code));
  if v_guild_id is null then raise exception 'invalid_code'; end if;
  if v_member_count >= 20 + coalesce(v_bonus_slots, 0) then raise exception 'guild_full'; end if;

  insert into public.guild_members (auth_user_id, guild_id, name_key, display_name, role)
  values (v_uid, v_guild_id, lower(v_display_name), v_display_name, 'member');

  update public.guilds set member_count = member_count + 1 where id = v_guild_id;

  insert into public.guild_activity_log (guild_id, kind, actor_name)
  values (v_guild_id, 'join', v_display_name);

  return v_guild_id;
end;
$$;
grant execute on function public.join_guild_by_code(text) to authenticated;

-- ============================================================
-- respond_guild_join_request(): identisch zur Fassung in
-- supabase-guild-join-requests.sql, nur der Groessen-Deckel ist jetzt
-- ebenfalls dynamisch.
-- ============================================================
create or replace function public.respond_guild_join_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_my_role text;
  v_request record;
  v_member_count integer;
  v_bonus_slots integer;
  v_decider_name text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_request from public.guild_join_requests where id = p_request_id for update;
  if v_request is null then raise exception 'request_not_found'; end if;
  if v_request.status <> 'pending' then raise exception 'request_already_decided'; end if;

  select role, display_name into v_my_role, v_decider_name
  from public.guild_members where auth_user_id = v_uid and guild_id = v_request.guild_id;
  if v_my_role is null or v_my_role not in ('leader', 'officer', 'veteran') then raise exception 'not_authorized'; end if;

  if not p_accept then
    update public.guild_join_requests set status = 'rejected', decided_at = now(), decided_by_name = v_decider_name where id = p_request_id;
    return;
  end if;

  -- Zwischenzeitlich anderswo beigetreten (z.B. per Code)? Anfrage kann
  -- nicht mehr angenommen werden.
  if exists (select 1 from public.guild_members where auth_user_id = v_request.auth_user_id) then
    update public.guild_join_requests set status = 'cancelled', decided_at = now(), decided_by_name = v_decider_name where id = p_request_id;
    raise exception 'requester_already_in_guild';
  end if;

  select member_count, bonus_member_slots into v_member_count, v_bonus_slots from public.guilds where id = v_request.guild_id;
  if v_member_count >= 20 + coalesce(v_bonus_slots, 0) then raise exception 'guild_full'; end if;

  insert into public.guild_members (auth_user_id, guild_id, name_key, display_name, role)
  values (v_request.auth_user_id, v_request.guild_id, v_request.name_key, v_request.display_name, 'member');

  update public.guilds set member_count = member_count + 1 where id = v_request.guild_id;

  insert into public.guild_activity_log (guild_id, kind, actor_name)
  values (v_request.guild_id, 'join', v_request.display_name);

  update public.guild_join_requests set status = 'accepted', decided_at = now(), decided_by_name = v_decider_name where id = p_request_id;

  update public.guild_join_requests
  set status = 'cancelled', decided_at = now()
  where auth_user_id = v_request.auth_user_id and status = 'pending' and id <> p_request_id;
end;
$$;
grant execute on function public.respond_guild_join_request(uuid, boolean) to authenticated;
