/* ============================================================
   Bkmp - Gilden-Technologie Erweiterung v2: 10 neue Zweige
   (Nutzer-Wunsch 26.07.: alle 9 bestehenden Zweige sind Stufe 20/20,
   die Gildenkasse (hier: 2358.93M Gold) hat nichts mehr zu tun -
   "Neue Zweig-Ideen" wurden gesammelt, der Nutzer waehlte gezielt
   10 davon aus: Kriegsrat/Turm-Vorreiter/Brutbeschleuniger/Schmiede/
   Autokauf/Nachtwache/Streak-Schutz/Stadtmauer/Aufstiegsvorbereitung/
   Willkommenspaket).

   Drei Aenderungen, alle idempotent (create or replace function,
   gleiche Signatur wie zuvor):

   1) guild_tech_upgrade(): bisher HART auf max_level=20 und
      Kostenkurve 200.000*1,4^Stufe fuer ALLE tech_id-Werte verdrahtet.
      Die 10 neuen Zweige brauchen unterschiedliche Maximalstufen/
      Kostenkurven (analog zum bereits bestehenden Prestige-Tier-Muster
      in js/systems/bkmp-prestige.js: WEAK/MEDIUM/STRONG/TOGGLE) - z.B.
      macht "+1 Arena-Versuch/Tag" bei 20 Stufen keinen Sinn (waere
      +20 Versuche), "Streak-Schutz" ist ein reiner Ein/Aus-Schalter
      (max. 1 Stufe). Ersetzt die feste Konstante durch eine CASE-
      Zuordnung pro tech_id - die alten 9 Zweige bekommen dabei
      EXAKT dieselben Werte wie vorher (20/200.000/1,4), keine
      Verhaltensaenderung fuer bereits gekaufte Stufen.

   2) arena_attack(): das bestehende 10x/Tag-Limit (sql/supabase-idle-
      arena-daily-limit.sql) wird um den "guild_kriegsrat"-Zweig der
      eigenen Gilde erweitert (+1 Versuch/Tag pro Stufe, max. 5 Stufen
      = +5 Versuche). Kein Gilde -> unveraendert 10.

   3) raid_join(): das bestehende Muster "Stadt-HP-Pool = Summe der
      HP-Beitraege aller Teilnehmer" (sql/20260719-fix-raid-guildboss-
      hour-check.sql) wird um den "guild_stadtmauer"-Zweig erweitert -
      der eigene HP-Beitrag zum Pool waechst um 1%/Stufe (max. 10%).
      Bewusst NICHT der geteilte Gegenangriffs-Schaden selbst (der ist
      guild-uebergreifend gepoolt, "wessen Gilde" waere dort nicht
      sauber zuordenbar) - stattdessen erhoeht Stadtmauer die eigene
      Baustein-Groesse im Pool, funktioniert unabhaengig davon, aus
      wie vielen verschiedenen Gilden ein Raid zusammenkommt.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt
   ausfuehren. Braucht supabase-guild-tech-tree.sql, supabase-idle-
   arena-daily-limit.sql, 20260719-fix-raid-guildboss-hour-check.sql
   (alle bereits live). Keine neue Tabelle/Spalte noetig - guild_tech_
   levels(guild_id, tech_id, level) ist bereits ein flaches Key-Value-
   Schema, akzeptiert beliebige neue tech_id-Strings ohne Migration.
   ============================================================ */

create or replace function public.guild_tech_upgrade(p_tech_id text)
returns table (new_level int, treasury_gold bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_my_role text;
  v_display_name text;
  v_current_level int;
  v_cost bigint;
  v_treasury bigint;
  v_max_level int;
  v_base_cost bigint;
  v_growth numeric;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  case p_tech_id
    when 'attack', 'defense', 'gold', 'crit_chance', 'crit_damage', 'boss_damage', 'rune_luck', 'xp', 'prestige' then
      v_max_level := 20; v_base_cost := 200000; v_growth := 1.4;
    when 'guild_kriegsrat' then
      v_max_level := 5; v_base_cost := 350000; v_growth := 1.6;
    when 'guild_turm_vorreiter' then
      v_max_level := 10; v_base_cost := 300000; v_growth := 1.35;
    when 'guild_brutbeschleuniger' then
      v_max_level := 20; v_base_cost := 200000; v_growth := 1.4;
    when 'guild_schmiede' then
      v_max_level := 20; v_base_cost := 200000; v_growth := 1.4;
    when 'guild_autokauf' then
      v_max_level := 10; v_base_cost := 300000; v_growth := 1.35;
    when 'guild_nachtwache' then
      v_max_level := 10; v_base_cost := 300000; v_growth := 1.35;
    when 'guild_streak_schutz' then
      v_max_level := 1; v_base_cost := 1500000; v_growth := 1;
    when 'guild_stadtmauer' then
      v_max_level := 10; v_base_cost := 300000; v_growth := 1.35;
    when 'guild_aufstiegsvorbereitung' then
      v_max_level := 5; v_base_cost := 350000; v_growth := 1.6;
    when 'guild_willkommenspaket' then
      v_max_level := 1; v_base_cost := 1500000; v_growth := 1;
    else
      raise exception 'invalid_tech';
  end case;

  select guild_id, role, display_name into v_guild_id, v_my_role, v_display_name from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null or v_my_role not in ('leader', 'officer') then raise exception 'not_authorized'; end if;

  select coalesce(level, 0) into v_current_level from public.guild_tech_levels where guild_id = v_guild_id and tech_id = p_tech_id;
  v_current_level := coalesce(v_current_level, 0);
  if v_current_level >= v_max_level then raise exception 'max_level'; end if;

  v_cost := round(v_base_cost * power(v_growth, v_current_level));
  select guilds.treasury_gold into v_treasury from public.guilds where id = v_guild_id;
  if v_treasury is null or v_treasury < v_cost then raise exception 'insufficient_treasury'; end if;

  update public.guilds set treasury_gold = guilds.treasury_gold - v_cost where id = v_guild_id returning guilds.treasury_gold into v_treasury;

  insert into public.guild_tech_levels (guild_id, tech_id, level) values (v_guild_id, p_tech_id, 1)
  on conflict (guild_id, tech_id) do update set level = guild_tech_levels.level + 1
  returning level into v_current_level;

  insert into public.guild_activity_log (guild_id, kind, actor_name, value, extra)
  values (v_guild_id, 'tech_upgrade', v_display_name, v_current_level, p_tech_id);

  return query select v_current_level, v_treasury;
end;
$$;
grant execute on function public.guild_tech_upgrade(text) to authenticated;

-- ============================================================
-- 2) Kriegsrat: +1 Arena-Versuch/Tag pro Stufe (max. 5 Stufen -> +5)
-- ============================================================
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
  v_guild_id uuid;
  v_kriegsrat_level int;
  v_daily_limit integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_target_auth_user_id is null or p_target_auth_user_id = v_uid then
    raise exception 'invalid_target';
  end if;

  v_daily_limit := 10;
  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is not null then
    select coalesce(level, 0) into v_kriegsrat_level from public.guild_tech_levels where guild_id = v_guild_id and tech_id = 'guild_kriegsrat';
    v_daily_limit := 10 + coalesce(v_kriegsrat_level, 0);
  end if;

  v_today_start := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
  select count(*) into v_attacks_today
  from public.arena_battle_log
  where attacker_auth_user_id = v_uid and occurred_at >= v_today_start;
  if v_attacks_today >= v_daily_limit then
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

-- ============================================================
-- 3) Stadtmauer: +1% eigener HP-Beitrag zum Raid-Stadt-HP-Pool pro
--    Stufe (max. 10 Stufen -> +10%)
-- ============================================================
create or replace function public.raid_join(p_raid_id text)
returns table (city_hp bigint, city_max_hp bigint, boss_hp bigint, boss_max_hp bigint, boss_name text, sprite_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fight_starts timestamptz;
  v_prep_starts timestamptz;
  v_display_name text;
  v_attack numeric;
  v_defense numeric;
  v_hp numeric;
  v_boss record;
  v_guild_id uuid;
  v_stadtmauer_level int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  v_fight_starts := to_timestamp(p_raid_id, 'YYYYMMDDHH24') at time zone 'UTC';
  v_prep_starts := v_fight_starts - interval '5 minutes';

  if extract(hour from v_fight_starts at time zone 'Europe/Berlin') = 20 then
    raise exception 'raid_paused_guild_boss_hour';
  end if;

  if now() < v_prep_starts or now() >= v_fight_starts then
    raise exception 'not_in_prep_window';
  end if;

  select ips.display_name, ips.attack, ips.defense, ips.hp
  into v_display_name, v_attack, v_defense, v_hp
  from public.idle_player_state ips where ips.auth_user_id = v_uid limit 1;
  if not found then raise exception 'no_idle_state'; end if;

  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is not null then
    select coalesce(level, 0) into v_stadtmauer_level from public.guild_tech_levels where guild_id = v_guild_id and tech_id = 'guild_stadtmauer';
    if v_stadtmauer_level > 0 then
      v_hp := v_hp * (1 + v_stadtmauer_level * 0.01);
    end if;
  end if;

  if not exists (select 1 from public.raid_instances where id = p_raid_id) then
    select * into v_boss from public.raid_bosses where active = true order by created_at desc limit 1;
    if not found then raise exception 'no_active_boss'; end if;
    insert into public.raid_instances (id, boss_id, boss_max_hp, boss_hp, fight_starts_at, fight_ends_at, next_boss_attack_at, status)
    values (p_raid_id, v_boss.id, v_boss.base_hp, v_boss.base_hp, v_fight_starts, v_fight_starts + interval '55 minutes', v_fight_starts, 'prep')
    on conflict (id) do nothing;
  end if;

  insert into public.raid_participants (raid_id, auth_user_id, display_name, attack, defense, hp)
  values (p_raid_id, v_uid, v_display_name, v_attack, v_defense, v_hp)
  on conflict (raid_id, auth_user_id) do update
  set attack = excluded.attack, defense = excluded.defense, hp = excluded.hp, display_name = excluded.display_name;

  update public.raid_instances ri set
    city_max_hp = sub.total_hp,
    city_hp = sub.total_hp,
    city_attack = sub.total_attack,
    city_defense = sub.total_defense,
    participant_count = sub.cnt,
    boss_max_hp = greatest(rb.base_hp, round(sub.total_attack * rb.hp_scale_per_attack)),
    boss_hp = greatest(rb.base_hp, round(sub.total_attack * rb.hp_scale_per_attack))
  from (
    select sum(hp) total_hp, sum(attack) total_attack, sum(defense) total_defense, count(*) cnt
    from public.raid_participants where raid_id = p_raid_id
  ) sub, public.raid_bosses rb
  where ri.id = p_raid_id and ri.status = 'prep' and rb.id = ri.boss_id;

  update public.raid_player_stats
  set total_raids_joined = total_raids_joined + 1, display_name = v_display_name, updated_at = now()
  where auth_user_id = v_uid;
  if not found then
    insert into public.raid_player_stats (auth_user_id, display_name, total_raids_joined)
    values (v_uid, v_display_name, 1);
  end if;

  return query
  select ri.city_hp, ri.city_max_hp, ri.boss_hp, ri.boss_max_hp, rb.name, rb.sprite_key
  from public.raid_instances ri join public.raid_bosses rb on rb.id = ri.boss_id
  where ri.id = p_raid_id;
end;
$$;
grant execute on function public.raid_join(text) to authenticated;
