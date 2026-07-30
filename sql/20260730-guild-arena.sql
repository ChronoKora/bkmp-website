-- Bkmp - Clan-Arena (Spieler-Idee Kaledoss, 28.07.2026, Feedback-Board:
-- "Einen Reiter für Clanbestenliste und ne Art Clanarena kämpfe").
--
-- Die Clan-BESTENLISTE selbst braucht KEINE neue Tabelle/Spalte - guilds
-- traegt bereits guild_xp (Lebenszeit-Gold-Spende, siehe supabase-guild-
-- extension-foundation.sql), oeffentlich lesbar, bereits indiziert
-- (guilds_xp_idx). Der Client sortiert einfach danach.
--
-- Die Clan-ARENA (asynchroner Gilde-gegen-Gilde-Kampf) ist neu, folgt aber
-- 1:1 dem bereits bewaehrten, produktiv laufenden Spieler-Arena-Muster
-- (sql/supabase-idle-arena.sql + -daily-limit.sql + 20260726-guild-tech-
-- branches-v2.sql fuer die Kriegsrat-Erweiterung) - gleiche Macht-Formel
-- (Angriff*2+Verteidigung+HP*0.3), gleiche ELO-Formel (K=32), gleiches
-- Grundprinzip (Sieg = Gold, Niederlage = nur Rating, nie Verlust von
-- Gold), nur auf GILDEN-Ebene statt Spieler-Ebene: die "Macht" einer Gilde
-- ist die SUMME der Kampfwerte all ihrer aktuellen Mitglieder (identisches
-- Aggregations-Prinzip wie bereits bei Raid/Gildenboss - "Boss-HP skaliert
-- mit der GESAMTEN Gildenangriffskraft").
--
-- Bewusste Design-Entscheidungen:
--  - Nur Anfuehrer/Offiziere duerfen angreifen (betrifft die GANZE Gilde,
--    nicht nur den Angreifer selbst - gleiches Rechte-Prinzip wie beim
--    Kauf von Gilden-Technologie).
--  - Tageslimit 3 statt 10 (wirkt auf viele Spieler gleichzeitig, sonst
--    koennte eine aktive Gilde zu haeufig alle anderen Gilden gleichzeitig
--    "im Rating schwaechen").
--  - Cooldown 30 statt 3 Minuten gegen dasselbe Ziel (dieselbe Ueberlegung).
--  - Gewinn fliesst in die GEMEINSAME Kasse (treasury_gold, bleibt normal
--    ausgebbar) - NICHT in guild_xp (das bliebe sonst ein zweiter,
--    unbeabsichtigter Level-Hebel neben echten Gold-Spenden).
--  - Niederlage kostet nur Rating, nie Kassen-Gold (identisches Prinzip
--    wie beim Spieler-Arena: "nie Gold verlieren, nur Rating").
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Braucht supabase-idle-guilds.sql + supabase-guild-extension-foundation.sql
-- (guild_xp). idempotent: mehrfaches Ausfuehren ist unschaedlich.

create table if not exists public.guild_ratings (
  guild_id uuid primary key references public.guilds(id) on delete cascade,
  rating integer not null default 1000,
  wins integer not null default 0,
  losses integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists guild_ratings_rating_idx on public.guild_ratings (rating desc);

alter table public.guild_ratings enable row level security;
grant select on public.guild_ratings to anon, authenticated;
drop policy if exists "Public read guild ratings" on public.guild_ratings;
create policy "Public read guild ratings" on public.guild_ratings for select to anon, authenticated using (true);
-- Kein direktes insert/update fuer Clients - nur ueber guild_arena_attack() unten.

create table if not exists public.guild_battle_log (
  id uuid primary key default gen_random_uuid(),
  attacker_guild_id uuid not null references public.guilds(id) on delete cascade,
  attacker_guild_name text not null,
  defender_guild_id uuid not null references public.guilds(id) on delete cascade,
  defender_guild_name text not null,
  attacker_won boolean not null,
  rating_change integer not null,
  gold_reward bigint not null default 0,
  occurred_at timestamptz not null default now()
);
create index if not exists guild_battle_log_attacker_idx on public.guild_battle_log (attacker_guild_id, occurred_at desc);
create index if not exists guild_battle_log_defender_idx on public.guild_battle_log (defender_guild_id, occurred_at desc);

alter table public.guild_battle_log enable row level security;
grant select on public.guild_battle_log to anon, authenticated;
drop policy if exists "Public read guild battle log" on public.guild_battle_log;
create policy "Public read guild battle log" on public.guild_battle_log for select to anon, authenticated using (true);

-- ============================================================
-- guild_arena_attack(): siehe Kommentar oben fuer die Design-Entscheidungen.
-- ============================================================
create or replace function public.guild_arena_attack(p_target_guild_id uuid)
returns table (
  attacker_won boolean,
  rating_change integer,
  new_rating integer,
  gold_reward bigint,
  defender_guild_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_my_guild_id uuid;
  v_my_role text;
  v_my_guild_name text;
  v_def_guild_name text;
  v_atk_power numeric;
  v_def_power numeric;
  v_win_chance numeric;
  v_won boolean;
  v_atk_rating integer;
  v_def_rating integer;
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

  select guild_id, role into v_my_guild_id, v_my_role from public.guild_members where auth_user_id = v_uid;
  if v_my_guild_id is null then
    raise exception 'no_guild';
  end if;
  if v_my_role not in ('leader', 'officer') then
    raise exception 'insufficient_role';
  end if;
  if p_target_guild_id is null or p_target_guild_id = v_my_guild_id then
    raise exception 'invalid_target';
  end if;

  select name into v_my_guild_name from public.guilds where id = v_my_guild_id;
  select name into v_def_guild_name from public.guilds where id = p_target_guild_id;
  if v_def_guild_name is null then
    raise exception 'no_defender_guild';
  end if;

  v_today_start := date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
  select count(*) into v_attacks_today
  from public.guild_battle_log
  where attacker_guild_id = v_my_guild_id and occurred_at >= v_today_start;
  if v_attacks_today >= 3 then
    raise exception 'daily_limit_reached';
  end if;

  select occurred_at into v_last_attack
  from public.guild_battle_log
  where attacker_guild_id = v_my_guild_id and defender_guild_id = p_target_guild_id
  order by occurred_at desc limit 1;
  if v_last_attack is not null and v_last_attack > now() - interval '30 minutes' then
    raise exception 'cooldown_active';
  end if;

  select coalesce(sum(greatest(1, ips.attack * 2 + ips.defense + ips.hp * 0.3)), 0) into v_atk_power
  from public.guild_members gm
  join public.idle_player_state ips on ips.auth_user_id = gm.auth_user_id
  where gm.guild_id = v_my_guild_id;

  select coalesce(sum(greatest(1, ips.attack * 2 + ips.defense + ips.hp * 0.3)), 0) into v_def_power
  from public.guild_members gm
  join public.idle_player_state ips on ips.auth_user_id = gm.auth_user_id
  where gm.guild_id = p_target_guild_id;

  if v_atk_power <= 0 or v_def_power <= 0 then
    raise exception 'no_combat_stats';
  end if;

  insert into public.guild_ratings (guild_id) values (v_my_guild_id) on conflict (guild_id) do nothing;
  insert into public.guild_ratings (guild_id) values (p_target_guild_id) on conflict (guild_id) do nothing;

  select rating into v_atk_rating from public.guild_ratings where guild_id = v_my_guild_id;
  select rating into v_def_rating from public.guild_ratings where guild_id = p_target_guild_id;

  v_win_chance := v_atk_power / (v_atk_power + v_def_power);
  v_won := random() < v_win_chance;

  v_expected := 1.0 / (1.0 + power(10, (v_def_rating - v_atk_rating) / 400.0));
  if v_won then
    v_change := round(v_k * (1 - v_expected));
    v_gold := round(greatest(50, v_def_power * 8));
  else
    v_change := -round(v_k * v_expected);
  end if;

  update public.guild_ratings set rating = rating + v_change, wins = wins + (case when v_won then 1 else 0 end),
    losses = losses + (case when v_won then 0 else 1 end), updated_at = now()
  where guild_id = v_my_guild_id
  returning rating into v_atk_rating;

  update public.guild_ratings set rating = rating - v_change, wins = wins + (case when v_won then 0 else 1 end),
    losses = losses + (case when v_won then 1 else 0 end), updated_at = now()
  where guild_id = p_target_guild_id;

  if v_won and v_gold > 0 then
    update public.guilds set treasury_gold = treasury_gold + v_gold where id = v_my_guild_id;
    insert into public.guild_activity_log (guild_id, kind, actor_name, value)
    values (v_my_guild_id, 'clan_arena_win', v_my_guild_name, v_gold);
  end if;

  insert into public.guild_battle_log (attacker_guild_id, attacker_guild_name, defender_guild_id, defender_guild_name, attacker_won, rating_change, gold_reward)
  values (v_my_guild_id, v_my_guild_name, p_target_guild_id, v_def_guild_name, v_won, v_change, v_gold);

  return query select v_won, v_change, v_atk_rating, v_gold, v_def_guild_name;
end;
$$;
grant execute on function public.guild_arena_attack(uuid) to authenticated;
