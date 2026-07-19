-- Bkmp - Gilden: Gruendungskosten (Spieler-Wunsch 14.07.: "Gilden Gründen
-- sollte kosten 500k Gold"). Das Gold fliesst direkt als Startkapital in
-- die neue Gildenkasse (zaehlt sofort als Beitrag des Gruenders) statt
-- einfach zu verschwinden - motiviert das Gruenden trotz der Kosten, weil
-- die Gilde dadurch schon beim Start ueber dem ersten Bonus-Meilenstein
-- (1.000 Gold) liegt.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Braucht supabase-idle-guilds.sql. idempotent: mehrfaches Ausfuehren ist
-- unschaedlich.

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
  v_gold bigint;
  v_guild_id uuid;
  v_cost constant bigint := 500000;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_name = '' or length(v_name) > 32 then raise exception 'invalid_name'; end if;
  if v_tag = '' or length(v_tag) > 5 then raise exception 'invalid_tag'; end if;
  if public.is_name_blocked(v_name) or public.is_name_blocked(v_tag) then raise exception 'name_blocked'; end if;
  if exists (select 1 from public.guild_members where auth_user_id = v_uid) then raise exception 'already_in_guild'; end if;
  if exists (select 1 from public.guilds where name_key = v_name_key) then raise exception 'name_taken'; end if;

  select display_name, gold into v_display_name, v_gold from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_display_name is null then raise exception 'no_idle_state'; end if;
  if v_gold is null or v_gold < v_cost then raise exception 'insufficient_gold'; end if;

  update public.idle_player_state set gold = gold - v_cost where auth_user_id = v_uid;

  insert into public.guilds (name, name_key, tag, leader_auth_user_id, treasury_gold)
  values (v_name, v_name_key, v_tag, v_uid, v_cost)
  returning id into v_guild_id;

  insert into public.guild_members (auth_user_id, guild_id, name_key, display_name, role, contributed_gold)
  values (v_uid, v_guild_id, lower(v_display_name), v_display_name, 'leader', v_cost);

  return v_guild_id;
end;
$$;
grant execute on function public.create_guild(text, text) to authenticated;
