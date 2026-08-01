/* ============================================================
   Bkmp - Gilden-Technologie v3: Baum-System mit Mitglieder-Beitraegen
   (ersetzt das bisherige "Anfuehrer/Stellvertreter kauft aus der
   Gildenkasse"-System vollstaendig, siehe Plan in
   C:\Users\David\.claude\plans\zazzy-crunching-plum.md)

   Nutzer-Vorbild: Whiteout Survival's Allianz-Technologie-Baum -
   JEDES Gildenmitglied kann mit eigenem Gold zu einem GEMEINSAMEN
   Fortschrittsbalken pro Knoten beitragen, Knoten haben Vorbedingungen
   (echter Baum, Pfade laufen zusammen), taegliches Beitragsversuchs-
   Limit pro Mitglied (regeneriert wie die bestehenden Dungeon-
   Schluessel), gildeninterne Bestenliste nach Beitrag.

   Nutzer-Entscheidungen (final): komplett ersetzen (nicht additiv),
   nur Gold als Waehrung, KEIN Paragon in v1 (jeder Knoten hat ein
   klares Ende).

   STUFE 1 dieser Umsetzung (nur Backend, noch kein neues Frontend):
   3 neue Tabellen, 2 neue RPCs, Anpassung von arena_attack()/
   raid_join() (lasen bisher DIREKT aus guild_tech_levels, unabhaengig
   vom Client-Cache - waeren sonst nach dem Umbau stumm kaputt),
   einmalige proportionale Migration bestehender Gilden-Fortschritte,
   und ein 6-Knoten-Beispiel-Baum zum Testen der RPCs. Der vollstaendige
   19-Knoten-Baum kommt in Stufe 2 (reines INSERT, keine Schema-
   Aenderung noetig - das Migrations-Insert unten ist bereits so
   geschrieben, dass es automatisch alle Knoten erfasst, sobald sie
   in guild_tech_nodes existieren).

   Warum eine echte Tabelle statt eines dritten hardcodierten Katalogs
   (wie bisher SQL-CASE + JS-Katalog + JS-Mock): dieses Muster hat in
   diesem Projekt bereits mehrfach echte Bugs verursacht (z.B. die
   dungeon_regen_calc()-Mehrdeutigkeit vom 26.07.). guild_tech_nodes
   ist oeffentlich lesbar und admin-frei per direktem SQL-Insert
   pflegbar - identisches Muster wie die bereits bestehende
   guild_level_thresholds-Tabelle.
   ============================================================ */

-- ============================================================
-- 1) Knoten-Katalog: id = alte tech_id (ermoeglicht triviale 1:1-
--    Migration + lesbare Aktivitaets-Log-Historie ueber den Umbau
--    hinweg). Aendert sich selten, wird per direktem INSERT gepflegt.
-- ============================================================
create table if not exists public.guild_tech_nodes (
  id text primary key,
  category text not null check (category in ('wachstum','schlacht')),
  label text not null,
  description text not null default '',
  icon text not null default '🌳',
  effect_type text not null,
  effect_per_tier numeric not null,
  max_tier int not null,
  base_gold_cost numeric not null,
  cost_growth numeric not null default 1.5,
  attempts_per_tier int not null default 25,
  prereq_node_ids text[] not null default '{}',
  pos_x int not null default 0,
  pos_y int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.guild_tech_nodes enable row level security;
grant select on public.guild_tech_nodes to anon, authenticated;
drop policy if exists "Public read guild tech nodes" on public.guild_tech_nodes;
create policy "Public read guild tech nodes" on public.guild_tech_nodes for select to anon, authenticated using (true);
-- Kein Client-Schreibzugriff - nur per direktem SQL-Insert (unten) gepflegt.

-- ============================================================
-- 2) Gemeinsamer Fortschrittsbalken pro Knoten und Gilde
-- ============================================================
create table if not exists public.guild_tech_progress (
  guild_id uuid not null references public.guilds(id) on delete cascade,
  node_id text not null references public.guild_tech_nodes(id),
  tier int not null default 0,
  progress_gold numeric not null default 0,
  primary key (guild_id, node_id)
);
alter table public.guild_tech_progress enable row level security;
grant select on public.guild_tech_progress to anon, authenticated;
drop policy if exists "Public read guild tech progress" on public.guild_tech_progress;
create policy "Public read guild tech progress" on public.guild_tech_progress for select to anon, authenticated using (true);
-- Kein Client-Schreibzugriff - nur guild_tech_contribute() unten. Identisches Policy-
-- Muster wie das abgeloeste guild_tech_levels (sql/supabase-guild-tech-tree.sql).

-- ============================================================
-- 3) Privater Beitragsversuch-Pool pro Spieler - EIN gemeinsamer Pool
--    fuer alle Knoten (anders als dungeon_keys, das pro Dungeon-Typ
--    einen eigenen Vorrat hat), da hier nur EIN geteiltes Tages-
--    Limit ueber alle Knoten hinweg gewuenscht ist.
-- ============================================================
create table if not exists public.guild_tech_contributor_attempts (
  auth_user_id uuid primary key,
  name_key text not null,
  attempts smallint not null default 5 check (attempts >= 0 and attempts <= 5),
  last_attempt_at timestamptz not null default now()
);
alter table public.guild_tech_contributor_attempts enable row level security;
grant select on public.guild_tech_contributor_attempts to authenticated;
drop policy if exists "Own read tech attempts" on public.guild_tech_contributor_attempts;
create policy "Own read tech attempts" on public.guild_tech_contributor_attempts for select to authenticated using (auth_user_id = auth.uid());
-- Kein Client-Schreibzugriff - nur guild_tech_contribute()/guild_tech_attempt_status().

-- ============================================================
-- 4) Neue Lifetime-Spalte fuer die Baum-Beitrags-Bestenliste.
--    BEWUSST NICHT guild_members.contributed_gold ueberladen - das ist
--    bereits die bestehende, andere "Spendenrangliste"-Metrik fuer
--    contribute_gold() (freiwillige Kassenspende, komplett getrennter
--    Vorgang, bleibt unveraendert bestehen).
-- ============================================================
alter table public.guild_members add column if not exists tech_contributed_gold bigint not null default 0;
create index if not exists guild_members_tech_contrib_idx on public.guild_members (guild_id, tech_contributed_gold desc);

-- ============================================================
-- 5) guild_tech_contribute(): der Kern der neuen Mechanik. Jedes
--    Mitglied (KEINE Rollenpruefung - das ist der ganze Sinn des neuen
--    Systems, anders als das alte leader/officer-only guild_tech_
--    upgrade()) kann eigenes Gold gegen einen Beitragsversuch in einen
--    freigeschalteten, noch nicht vollen Knoten stecken.
-- ============================================================
create or replace function public.guild_tech_contribute(p_node_id text)
returns table (
  new_tier int,
  new_progress_gold numeric,
  tier_gold_cost numeric,
  gold_spent numeric,
  remaining_gold bigint,
  attempts_left smallint,
  seconds_to_next_attempt int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_display_name text;
  v_name_key text;
  v_node public.guild_tech_nodes%rowtype;
  v_progress public.guild_tech_progress%rowtype;
  v_prereq_id text;
  v_attempt_row public.guild_tech_contributor_attempts%rowtype;
  v_calc record;
  v_tier_gold_cost numeric;
  v_remaining_needed numeric;
  v_contribution_step numeric;
  v_actual_amount numeric;
  v_gold bigint;
  v_new_tier int;
  v_new_progress numeric;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select guild_id, display_name into v_guild_id, v_display_name from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then raise exception 'not_in_guild'; end if;

  select name_key into v_name_key from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_name_key is null then raise exception 'no_player_state'; end if;

  select * into v_node from public.guild_tech_nodes where id = p_node_id;
  if not found then raise exception 'invalid_node'; end if;

  insert into public.guild_tech_progress (guild_id, node_id) values (v_guild_id, p_node_id)
  on conflict (guild_id, node_id) do nothing;
  select * into v_progress from public.guild_tech_progress where guild_id = v_guild_id and node_id = p_node_id for update;

  if v_progress.tier >= v_node.max_tier then raise exception 'node_maxed'; end if;

  -- Vorbedingungs-Pruefung: JEDE in prereq_node_ids gelistete ID muss in
  -- dieser Gilde bereits ihre eigene Maximalstufe erreicht haben (generalisierte
  -- Fassung des alten Paragon-"base_not_maxed"-Gates, hier ueber ein Array
  -- statt einer einzelnen fest verdrahteten ID).
  if v_node.prereq_node_ids is not null and array_length(v_node.prereq_node_ids, 1) > 0 then
    foreach v_prereq_id in array v_node.prereq_node_ids loop
      declare
        v_req_max_tier int;
        v_have_tier int;
      begin
        select max_tier into v_req_max_tier from public.guild_tech_nodes where id = v_prereq_id;
        select coalesce(tier, 0) into v_have_tier from public.guild_tech_progress where guild_id = v_guild_id and node_id = v_prereq_id;
        if v_req_max_tier is null or coalesce(v_have_tier, 0) < v_req_max_tier then
          raise exception 'prereq_not_met';
        end if;
      end;
    end loop;
  end if;

  -- Beitragsversuch-Pool sichern+sperren, Regen ueber die bestehende, bereits
  -- bewaehrte dungeon_regen_calc() (unveraendert wiederverwendet - festes
  -- gemeinsames 4h-Raster, da hier bewusst KEIN personalisiertes Intervall
  -- vorgesehen ist). Ergebnis wird SOFORT persistiert, auch wenn der Beitrag
  -- weiter unten noch an insufficient_gold scheitert - identisches Prinzip
  -- wie dungeon_consume_key(), damit der Countdown-Anker nie haengen bleibt.
  insert into public.guild_tech_contributor_attempts (auth_user_id, name_key) values (v_uid, v_name_key)
  on conflict (auth_user_id) do nothing;
  select * into v_attempt_row from public.guild_tech_contributor_attempts where auth_user_id = v_uid for update;
  select * into v_calc from public.dungeon_regen_calc(v_attempt_row.attempts, v_attempt_row.last_attempt_at, 14400, 5);
  update public.guild_tech_contributor_attempts set attempts = v_calc.new_keys, last_attempt_at = v_calc.new_last_key_at, name_key = v_name_key
  where auth_user_id = v_uid;

  if v_calc.new_keys < 1 then raise exception 'no_attempts_available'; end if;

  v_tier_gold_cost := round(v_node.base_gold_cost * power(v_node.cost_growth, v_progress.tier));
  v_remaining_needed := v_tier_gold_cost - v_progress.progress_gold;
  v_contribution_step := round(v_tier_gold_cost / greatest(1, v_node.attempts_per_tier));
  v_actual_amount := least(v_contribution_step, v_remaining_needed);
  if v_actual_amount < 1 then v_actual_amount := 1; end if;

  select gold into v_gold from public.idle_player_state where auth_user_id = v_uid;
  if v_gold is null or v_gold < v_actual_amount then
    -- Versuch bleibt verbraucht (bereits oben persistiert) - identisch zu
    -- einem gescheiterten Dungeon-Lauf, der auch einen Schluessel kostet.
    update public.guild_tech_contributor_attempts set attempts = attempts - 1 where auth_user_id = v_uid;
    raise exception 'insufficient_gold';
  end if;

  -- Commit: Gold abziehen, Versuch verbrauchen, persoenlichen Beitrag +
  -- gemeinsamen Fortschritt fortschreiben, Stufenaufstieg bei Bedarf.
  update public.idle_player_state set gold = gold - v_actual_amount where auth_user_id = v_uid;
  update public.guild_tech_contributor_attempts set attempts = attempts - 1 where auth_user_id = v_uid;
  update public.guild_members set tech_contributed_gold = tech_contributed_gold + v_actual_amount where auth_user_id = v_uid;

  v_new_progress := v_progress.progress_gold + v_actual_amount;
  v_new_tier := v_progress.tier;
  if v_new_progress >= v_tier_gold_cost then
    v_new_tier := v_progress.tier + 1;
    v_new_progress := 0;
  end if;

  update public.guild_tech_progress set tier = v_new_tier, progress_gold = v_new_progress
  where guild_id = v_guild_id and node_id = p_node_id;

  insert into public.guild_activity_log (guild_id, kind, actor_name, value, extra)
  values (v_guild_id, 'tech_contribute', v_display_name, v_actual_amount::bigint, p_node_id);
  if v_new_tier > v_progress.tier then
    insert into public.guild_activity_log (guild_id, kind, actor_name, value, extra)
    values (v_guild_id, 'tech_tier_complete', v_display_name, v_new_tier, p_node_id);
  end if;

  select gold into v_gold from public.idle_player_state where auth_user_id = v_uid;

  return query select
    v_new_tier,
    v_new_progress,
    v_tier_gold_cost,
    v_actual_amount,
    v_gold,
    v_calc.new_keys - 1,
    0; -- seconds_to_next_attempt wird vom Client ueber guild_tech_attempt_status() frisch geholt
end;
$$;
grant execute on function public.guild_tech_contribute(text) to authenticated;

-- ============================================================
-- 6) guild_tech_attempt_status(): Einzeilen-Aequivalent zu
--    dungeon_get_all_status() (EIN gemeinsamer Pool statt mehrerer
--    Typen) - fuer den initialen Panel-Load und den Ticker-Resync.
-- ============================================================
create or replace function public.guild_tech_attempt_status()
returns table (attempts smallint, max_attempts smallint, seconds_to_next int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name_key text;
  v_row public.guild_tech_contributor_attempts%rowtype;
  v_calc record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select name_key into v_name_key from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_name_key is null then raise exception 'no_player_state'; end if;

  insert into public.guild_tech_contributor_attempts (auth_user_id, name_key) values (v_uid, v_name_key)
  on conflict (auth_user_id) do nothing;
  select * into v_row from public.guild_tech_contributor_attempts where auth_user_id = v_uid for update;
  select * into v_calc from public.dungeon_regen_calc(v_row.attempts, v_row.last_attempt_at, 14400, 5);

  update public.guild_tech_contributor_attempts set attempts = v_calc.new_keys, last_attempt_at = v_calc.new_last_key_at, name_key = v_name_key
  where auth_user_id = v_uid;

  return query select
    v_calc.new_keys,
    5::smallint,
    (case when v_calc.new_keys >= 5 then 0
     else (14400 - floor(extract(epoch from (now() - v_calc.new_last_key_at))))::int end);
end;
$$;
grant execute on function public.guild_tech_attempt_status() to authenticated;

-- ============================================================
-- 7) arena_attack()/raid_join(): lasen bisher DIREKT aus
--    guild_tech_levels (unabhaengig vom Client-Cache) - MUESSEN in
--    derselben Migration auf guild_tech_progress umgestellt werden,
--    sonst brechen Arena-Tageslimit (Kriegsrat) und Raid-Stadtmauer-
--    Bonus fuer jede Gilde still. Rest der Funktionen unveraendert
--    (identisch zu sql/20260726-guild-tech-branches-v2.sql), nur die
--    jeweils eine guild_tech_levels-Abfrage ersetzt.
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
  v_kriegsrat_tier int;
  v_kriegsrat_per_tier numeric;
  v_daily_limit integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_target_auth_user_id is null or p_target_auth_user_id = v_uid then
    raise exception 'invalid_target';
  end if;

  -- effect_per_tier wird bewusst DYNAMISCH aus guild_tech_nodes gelesen statt
  -- hier ein zweites Mal hardcodiert - genau dieses "zwei Kopien muessen
  -- synchron bleiben"-Muster hat in diesem Projekt bereits mehrfach echte
  -- Bugs verursacht (z.B. dungeon_regen_calc()-Mehrdeutigkeit vom 26.07.).
  v_daily_limit := 10;
  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is not null then
    select coalesce(tier, 0) into v_kriegsrat_tier from public.guild_tech_progress where guild_id = v_guild_id and node_id = 'guild_kriegsrat';
    select effect_per_tier into v_kriegsrat_per_tier from public.guild_tech_nodes where id = 'guild_kriegsrat';
    v_daily_limit := 10 + round(coalesce(v_kriegsrat_tier, 0) * coalesce(v_kriegsrat_per_tier, 0))::int;
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
  v_stadtmauer_tier int;
  v_stadtmauer_per_tier numeric;
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

  -- effect_per_tier (Prozent) wird dynamisch aus guild_tech_nodes gelesen,
  -- gleiches Prinzip wie bei arena_attack()'s Kriegsrat-Lookup oben - keine
  -- zweite hardcodierte Kopie des Prozentwerts.
  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is not null then
    select coalesce(tier, 0) into v_stadtmauer_tier from public.guild_tech_progress where guild_id = v_guild_id and node_id = 'guild_stadtmauer';
    if v_stadtmauer_tier > 0 then
      select effect_per_tier into v_stadtmauer_per_tier from public.guild_tech_nodes where id = 'guild_stadtmauer';
      v_hp := v_hp * (1 + v_stadtmauer_tier * coalesce(v_stadtmauer_per_tier, 0) / 100.0);
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

-- ============================================================
-- 8) Stufe-1-Beispiel-Baum (6 Knoten, Schlacht-Kategorie) - macht die
--    RPCs oben sofort testbar. Beweist lineare Fortsetzung
--    (attack -> crit_damage) UND 2-fache Zusammenfuehrung
--    (defense + crit_chance -> boss_damage -> zusammen mit
--    crit_damage -> guild_kriegsrat). Kosten/Werte sind ein bewusst
--    grober erster Entwurf (per einfachem UPDATE spaeter leicht
--    anpassbar) - Feinabstimmung ist Aufgabe von Stufe 2, wenn alle
--    19 Knoten echten Inhalt bekommen.
-- ============================================================
insert into public.guild_tech_nodes (id, category, label, description, icon, effect_type, effect_per_tier, max_tier, base_gold_cost, cost_growth, attempts_per_tier, prereq_node_ids, pos_x, pos_y)
values
  ('attack', 'schlacht', 'Angriff', '+7% Angriff pro Stufe.', '⚔️', 'attackPct', 7, 5, 2000000, 1.5, 25, '{}', 100, 50),
  ('defense', 'schlacht', 'Verteidigung', '+7% Verteidigung pro Stufe.', '🛡️', 'defensePct', 7, 5, 2000000, 1.5, 25, '{}', 300, 50),
  ('crit_chance', 'schlacht', 'Kritchance', '+2,1% Kritchance pro Stufe.', '🎯', 'critChancePct', 2.1, 5, 2000000, 1.5, 25, '{}', 500, 50),
  ('crit_damage', 'schlacht', 'Kritischer Schaden', '+14% kritischer Schaden pro Stufe.', '💥', 'critDamagePct', 14, 5, 2500000, 1.55, 25, array['attack'], 100, 200),
  ('boss_damage', 'schlacht', 'Bossschaden', '+17,5% Bossschaden pro Stufe.', '🐉', 'bossDamagePct', 17.5, 5, 2500000, 1.55, 25, array['defense','crit_chance'], 400, 200),
  ('guild_kriegsrat', 'schlacht', 'Kriegsrat', '+3 zusätzliche Arena-Angriffe pro Tag pro Stufe.', '🗡️', 'arenaExtraAttempts', 3, 5, 3000000, 1.6, 25, array['crit_damage','boss_damage'], 250, 350)
on conflict (id) do update set
  category = excluded.category, label = excluded.label, description = excluded.description, icon = excluded.icon,
  effect_type = excluded.effect_type, effect_per_tier = excluded.effect_per_tier, max_tier = excluded.max_tier,
  base_gold_cost = excluded.base_gold_cost, cost_growth = excluded.cost_growth, attempts_per_tier = excluded.attempts_per_tier,
  prereq_node_ids = excluded.prereq_node_ids, pos_x = excluded.pos_x, pos_y = excluded.pos_y;

-- ============================================================
-- 8b) STUFE 2 (31.07.2026): restliche 13 Knoten - macht den Baum
--     inhaltlich vollstaendig (11 Wachstum / 8 Schlacht insgesamt,
--     identisch zur alten Zweig-Anzahl). effect_type-Werte 1:1 aus dem
--     alten System uebernommen (BKMP_GUILD_TECH_CATALOG_EXT in
--     js/systems/bkmp-guild.js) - Turm-Vorreiter/Willkommenspaket
--     bleiben bewusst Sonderfaelle (ihr effect_type ist nur ein
--     Erkennungsmerkmal fuer die spezielle Bonus-Berechnung in Stufe 3,
--     nicht der direkte Cache-Schluessel - identisches Prinzip wie im
--     abgeloesten System, siehe bkmpGuildRefreshTreasuryBonusCache()).
--
--     Kosten/Effektwerte sind wie beim Stufe-1-Beispiel ein bewusst
--     grober erster Entwurf (Gesamteffekt bei Maximalstufe naeherungs-
--     weise auf dem alten Niveau gehalten: alte Gesamtsumme = alte
--     Maximalstufe * alter Effekt/Stufe, gleichmaessig auf 5 neue Stufen
--     verteilt) - per einfachem UPDATE spaeter leicht anpassbar, ganz
--     im Sinne der neuen Katalog-in-der-Datenbank-Architektur.
--
--     Baum-Struktur Wachstum (4 Wurzeln, 2 Zwischenebenen, 1 Abschluss-
--     Zusammenfuehrung - guild_streak_schutz bleibt bewusst ein
--     eigenstaendiges Blatt, nicht jeder Pfad muss sich wieder
--     vereinigen):
--       gold, xp, prestige, rune_luck (Wurzeln)
--         -> guild_autokauf[gold], guild_brutbeschleuniger[xp,prestige], guild_schmiede[rune_luck]
--           -> guild_nachtwache[guild_autokauf], guild_aufstiegsvorbereitung[guild_brutbeschleuniger], guild_streak_schutz[guild_schmiede]
--             -> guild_willkommenspaket[guild_nachtwache, guild_aufstiegsvorbereitung]
--     Baum-Struktur Schlacht (Erweiterung des Stufe-1-Baums um einen
--     dritten Pfad ab crit_chance, der mit boss_damage zu Stadtmauer
--     zusammenlaeuft):
--       crit_chance -> guild_turm_vorreiter -> (zusammen mit boss_damage) -> guild_stadtmauer
-- ============================================================
insert into public.guild_tech_nodes (id, category, label, description, icon, effect_type, effect_per_tier, max_tier, base_gold_cost, cost_growth, attempts_per_tier, prereq_node_ids, pos_x, pos_y)
values
  -- Schlacht: 2 weitere Knoten (Turm-Vorreiter/Stadtmauer), erweitert den Stufe-1-Baum.
  ('guild_turm_vorreiter', 'schlacht', 'Turm-Vorreiter', '+0,25% Angriff/Verteidigung/Gold pro 10 Turmstufen des staerksten Mitglieds, pro Stufe (max. 50%).', '🗼', 'towerChampionPctPer10', 0.25, 5, 2500000, 1.55, 25, array['crit_chance'], 600, 200),
  ('guild_stadtmauer', 'schlacht', 'Stadtmauer', '+5% eigener HP-Beitrag zum Raid-Stadt-HP-Pool pro Stufe.', '🏯', 'raidCityHpPct', 5, 5, 3000000, 1.6, 25, array['boss_damage','guild_turm_vorreiter'], 500, 350),

  -- Wachstum: 4 Wurzeln, keine Vorbedingung.
  ('gold', 'wachstum', 'Gold', '+10,5% Gold pro Stufe.', '💰', 'goldPct', 10.5, 5, 2000000, 1.5, 25, '{}', 100, 50),
  ('xp', 'wachstum', 'Erfahrungsbonus', '+7% Erfahrung pro Stufe.', '📖', 'xpPct', 7, 5, 2000000, 1.5, 25, '{}', 300, 50),
  ('prestige', 'wachstum', 'Prestigebonus', '+3,5% Prestige-Effekt pro Stufe.', '🌌', 'prestigePct', 3.5, 5, 2000000, 1.5, 25, '{}', 500, 50),
  ('rune_luck', 'wachstum', 'Runenglück', '+10,5% Chance auf höhere Runen-Seltenheit pro Stufe.', '🍀', 'runeLuckPct', 10.5, 5, 2000000, 1.5, 25, '{}', 700, 50),

  -- Wachstum: zweite Ebene (1 Vorbedingung bzw. Zusammenfuehrung von 2).
  ('guild_autokauf', 'wachstum', 'Gilden-Autokauf', '+10 automatische Käufe pro Tick für alle Mitglieder, pro Stufe.', '🤖', 'autobuyExtraPurchases', 10, 5, 2500000, 1.55, 25, array['gold'], 100, 200),
  ('guild_brutbeschleuniger', 'wachstum', 'Brutbeschleuniger', 'Verkürzt Brutzeit + Opfergabe-Rabatt um 7% pro Stufe.', '🥚', 'broodSpeedPct', 7, 5, 2500000, 1.55, 25, array['xp','prestige'], 400, 200),
  ('guild_schmiede', 'wachstum', 'Gildenschmiede', '-7% Runen-Aufwertungskosten pro Stufe (Gesamtdeckel 40%).', '⚒️', 'runeUpgradeDiscountPct', 7, 5, 2500000, 1.55, 25, array['rune_luck'], 700, 200),

  -- Wachstum: dritte Ebene.
  ('guild_nachtwache', 'wachstum', 'Nachtwache', '+2,5 Std. Offline-Fortschritts-Deckel pro Stufe.', '🌙', 'offlineCapExtraHours', 2.5, 5, 3000000, 1.6, 25, array['guild_autokauf'], 100, 350),
  ('guild_aufstiegsvorbereitung', 'wachstum', 'Aufstiegsvorbereitung', 'Senkt die Aufstiegs-Schwellen um 6% pro Stufe (Gesamtdeckel 35%).', '🌌', 'ascensionThresholdDiscountPct', 6, 5, 3000000, 1.6, 25, array['guild_brutbeschleuniger'], 400, 350),
  ('guild_streak_schutz', 'wachstum', 'Streak-Schutz', 'Ein ausgelassener Tag setzt die Login-Serie nur um eine Stufe zurück statt komplett auf 1.', '🛡️', 'streakProtectUnlock', 1, 1, 8000000, 1, 40, array['guild_schmiede'], 700, 350),

  -- Wachstum: Abschluss-Zusammenfuehrung (TOGGLE, nur 1 Stufe).
  ('guild_willkommenspaket', 'wachstum', 'Willkommenspaket', 'Neue Mitglieder erhalten in den ersten 3 Tagen nach dem Beitritt +10% auf Angriff/Verteidigung/Gold.', '🎁', 'newMemberBonusUnlock', 1, 1, 8000000, 1, 40, array['guild_nachtwache','guild_aufstiegsvorbereitung'], 250, 500)
on conflict (id) do update set
  category = excluded.category, label = excluded.label, description = excluded.description, icon = excluded.icon,
  effect_type = excluded.effect_type, effect_per_tier = excluded.effect_per_tier, max_tier = excluded.max_tier,
  base_gold_cost = excluded.base_gold_cost, cost_growth = excluded.cost_growth, attempts_per_tier = excluded.attempts_per_tier,
  prereq_node_ids = excluded.prereq_node_ids, pos_x = excluded.pos_x, pos_y = excluded.pos_y;

-- ============================================================
-- 9) Einmalige, proportionale Migration bestehender Gilden-Fortschritte
--    (KEIN Gold-Refund - anders als die kuerzliche Schluesselbund-
--    Rueckerstattung, weil treasury_gold ein gemeinsamer, von der
--    Fuehrung verwalteter Topf war, kein individuell nachverfolgtes
--    Spieler-Guthaben; eine faire Pro-Spieler-Rueckerstattung waere
--    hier nicht sauber zurechenbar). __paragon-Zeilen fallen bewusst
--    raus (Paragon entfaellt in v1). Erfasst automatisch NUR die
--    tech_ids, die bereits als guild_tech_nodes-Zeile existieren (siehe
--    Seed oben) - braucht bei Stufe 2 (voller 19-Knoten-Baum) KEINE
--    Aenderung an dieser Abfrage.
--    WICHTIG: "on conflict do NOTHING", nicht "do update" - diese Migration
--    ist bewusst ein reiner EINMAL-Bootstrap. Der Node-Katalog (Abschnitt 8/
--    8b) ist ausdruecklich per einfachem spaeteren UPDATE pflegbar - wuerde
--    diese Abfrage bei einem erneuten Ausfuehren der Datei (z.B. nur um
--    Kosten/Effektwerte anzupassen) bestehende Zeilen ueberschreiben, wuerde
--    das laengst echten, von Spielern ueber guild_tech_contribute()
--    erspielten Fortschritt stillschweigend auf den alten migrierten Wert
--    zuruecksetzen. "do nothing" macht die gesamte Datei sicher beliebig oft
--    wiederholbar, ohne je echten v3-Fortschritt zu gefaehrden.
-- ============================================================
insert into public.guild_tech_progress (guild_id, node_id, tier, progress_gold)
select gtl.guild_id, gtl.tech_id,
       floor(
         gtl.level::numeric
         / (case gtl.tech_id
              when 'attack' then 35 when 'defense' then 35 when 'gold' then 35
              when 'crit_chance' then 35 when 'crit_damage' then 35 when 'boss_damage' then 35
              when 'rune_luck' then 35 when 'xp' then 35 when 'prestige' then 35
              when 'guild_kriegsrat' then 15 when 'guild_aufstiegsvorbereitung' then 15
              when 'guild_turm_vorreiter' then 25 when 'guild_autokauf' then 25
              when 'guild_nachtwache' then 25 when 'guild_stadtmauer' then 25
              when 'guild_brutbeschleuniger' then 35 when 'guild_schmiede' then 35
              when 'guild_streak_schutz' then 1 when 'guild_willkommenspaket' then 1
              else null end)
         * gtn.max_tier
       )::int,
       0
from public.guild_tech_levels gtl
join public.guild_tech_nodes gtn on gtn.id = gtl.tech_id
where gtl.tech_id not like '%\_\_paragon' escape '\'
on conflict (guild_id, node_id) do nothing;
