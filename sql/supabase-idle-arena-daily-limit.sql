-- Bkmp - Arena: Tageslimit (Spieler-Wunsch 14.07.: "Arena nur 10x Täglich
-- Angreifen reset um 0:00") - verhindert, dass die Arena zu einer reinen
-- Farm-Maschine wird und macht jeden Angriff etwas bedeutsamer. Reset an
-- der ECHTEN Mitternacht in deutscher Zeit (Europe/Berlin, beruecksichtigt
-- Sommerzeit automatisch), nicht UTC-Mitternacht.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Braucht supabase-idle-arena.sql. idempotent: mehrfaches Ausfuehren ist
-- unschaedlich (gleiche Signatur wie zuvor, daher reicht create or replace
-- ohne vorheriges drop).

create or replace function public.arena_attack(p_target_auth_user_id uuid)
returns table (
  attacker_won boolean,
  rating_change integer,
  new_rating integer,
  gold_reward bigint,
  defender_display_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_atk public.idle_player_state%rowtype;
  v_def public.idle_player_state%rowtype;
  v_atk_rating integer;
  v_def_rating integer;
  v_atk_power numeric;
  v_def_power numeric;
  v_win_chance numeric;
  v_won boolean;
  v_expected numeric;
  v_k integer := 32;
  v_change integer;
  v_gold bigint := 0;
  v_last_attack timestamptz;
  v_today_start timestamptz;
  v_attacks_today integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_target_auth_user_id is null or p_target_auth_user_id = v_uid then
    raise exception 'invalid_target';
  end if;

  v_today_start := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
  select count(*) into v_attacks_today
  from public.arena_battle_log
  where attacker_auth_user_id = v_uid and occurred_at >= v_today_start;
  if v_attacks_today >= 10 then
    raise exception 'daily_limit_reached';
  end if;

  select * into v_atk from public.idle_player_state where auth_user_id = v_uid limit 1;
  if not found then
    raise exception 'no_attacker_state';
  end if;

  select * into v_def from public.idle_player_state where auth_user_id = p_target_auth_user_id limit 1;
  if not found then
    raise exception 'no_defender_state';
  end if;

  select occurred_at into v_last_attack
  from public.arena_battle_log
  where attacker_auth_user_id = v_uid and defender_auth_user_id = p_target_auth_user_id
  order by occurred_at desc limit 1;
  if v_last_attack is not null and v_last_attack > now() - interval '3 minutes' then
    raise exception 'cooldown_active';
  end if;

  insert into public.arena_ratings (auth_user_id, name_key, display_name, rating)
  values (v_uid, v_atk.name_key, v_atk.display_name, 1000)
  on conflict (auth_user_id) do update set name_key = excluded.name_key, display_name = excluded.display_name
  returning rating into v_atk_rating;

  insert into public.arena_ratings (auth_user_id, name_key, display_name, rating)
  values (p_target_auth_user_id, v_def.name_key, v_def.display_name, 1000)
  on conflict (auth_user_id) do update set name_key = excluded.name_key, display_name = excluded.display_name
  returning rating into v_def_rating;

  v_atk_power := greatest(1, v_atk.attack * 2 + v_atk.defense + v_atk.hp * 0.3);
  v_def_power := greatest(1, v_def.attack * 2 + v_def.defense + v_def.hp * 0.3);
  v_win_chance := v_atk_power / (v_atk_power + v_def_power);
  v_won := random() < v_win_chance;

  v_expected := 1.0 / (1.0 + power(10, (v_def_rating - v_atk_rating) / 400.0));
  if v_won then
    v_change := round(v_k * (1 - v_expected));
    v_gold := round(greatest(5, v_def_power * 0.8));
  else
    v_change := -round(v_k * v_expected);
  end if;

  update public.arena_ratings set rating = rating + v_change,
    wins = wins + (case when v_won then 1 else 0 end),
    losses = losses + (case when v_won then 0 else 1 end),
    updated_at = now()
  where auth_user_id = v_uid
  returning rating into v_atk_rating;

  update public.arena_ratings set rating = rating - v_change,
    wins = wins + (case when v_won then 0 else 1 end),
    losses = losses + (case when v_won then 1 else 0 end),
    updated_at = now()
  where auth_user_id = p_target_auth_user_id;

  if v_won and v_gold > 0 then
    update public.idle_player_state set gold = gold + v_gold, total_gold_earned = total_gold_earned + v_gold
    where auth_user_id = v_uid;
  end if;

  insert into public.arena_battle_log (attacker_auth_user_id, attacker_name, defender_auth_user_id, defender_name, attacker_won, rating_change, gold_reward)
  values (v_uid, v_atk.display_name, p_target_auth_user_id, v_def.display_name, v_won, v_change, v_gold);

  return query select v_won, v_change, v_atk_rating, v_gold, v_def.display_name;
end;
$$;
grant execute on function public.arena_attack(uuid) to authenticated;
