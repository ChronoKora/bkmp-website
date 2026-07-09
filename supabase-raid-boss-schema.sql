-- Bkmp - Weltboss/Raid-Boss-Event (stuendlich)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Braucht public.is_active_admin() aus supabase-security-hardening.sql und
-- die idle_player_state-Tabelle aus supabase-idle-dorf-schema.sql.
--
-- ARCHITEKTUR (wichtig fuer Wartung):
-- Es gibt keinen Server-Cron/Dauerprozess (statische Seite + Vercel-
-- Funktionen). Der komplette Raid-Ablauf ist deshalb rein zeitgesteuert und
-- "faul": jeder Client berechnet die aktuelle Phase (Vorbereitung/Kampf)
-- unabhaengig aus der Uhrzeit, der raid_id-String IST der Stunden-Zeitstempel
-- ('YYYYMMDDHH24', UTC). Die Raid-Zeile wird beim ERSTEN Beitritt faul
-- angelegt. Der Bossangriff auf die Stadt laeuft nach demselben Prinzip wie
-- ein verteilter Tick: jeder teilnehmende Client ruft periodisch
-- raid_boss_attack_tick() auf, aber nur EIN Aufruf pro Intervall wirkt sich
-- wirklich aus (atomare UPDATE...WHERE next_boss_attack_at <= now()-Klausel,
-- Postgres serialisiert das per Row-Lock - kein Ueberschaden moeglich, egal
-- wie viele Spieler gleichzeitig anfragen).
--
-- Alle Schreibzugriffe laufen ausschliesslich ueber SECURITY DEFINER-
-- Funktionen (RPCs) - die Tabellen selbst haben fuer normale Nutzer nur
-- Leserechte. Das verhindert, dass jemand per direktem REST-Call Bossschaden
-- faelscht oder die Stadt-HP manipuliert.

-- ============================================================
-- 1) raid_bosses - Konfiguration (admin-editierbar, erweiterbar)
-- ============================================================
create table if not exists public.raid_bosses (
  id text primary key,
  name text not null,
  sprite_key text not null,
  base_hp bigint not null default 500000,
  base_attack numeric not null default 400,
  attack_interval_seconds int not null default 4,
  gold_reward bigint not null default 5000,
  gem_reward bigint not null default 25,
  xp_reward bigint not null default 2000,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.raid_bosses (id, name, sprite_key, base_hp, base_attack, attack_interval_seconds, gold_reward, gem_reward, xp_reward)
values ('zerathor', 'Zerathor, Zorn der Verdammnis', 'zerathor', 500000, 400, 4, 5000, 25, 2000)
on conflict (id) do nothing;

alter table public.raid_bosses enable row level security;
grant usage on schema public to anon, authenticated;
grant select on public.raid_bosses to anon, authenticated;
grant insert, update, delete on public.raid_bosses to authenticated;

drop policy if exists "Public read raid bosses" on public.raid_bosses;
create policy "Public read raid bosses" on public.raid_bosses for select to anon, authenticated using (true);
drop policy if exists "Admin write raid bosses" on public.raid_bosses;
create policy "Admin write raid bosses" on public.raid_bosses for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

-- ============================================================
-- 2) raid_instances - eine Zeile pro stuendlichem Raid-Vorkommen
-- ============================================================
create table if not exists public.raid_instances (
  id text primary key,
  boss_id text not null references public.raid_bosses(id),
  boss_max_hp bigint not null,
  boss_hp bigint not null,
  city_max_hp bigint not null default 0,
  city_hp bigint not null default 0,
  city_attack numeric not null default 0,
  city_defense numeric not null default 0,
  status text not null default 'prep',
  next_boss_attack_at timestamptz not null,
  fight_starts_at timestamptz not null,
  fight_ends_at timestamptz not null,
  started_fight_at timestamptz,
  ended_at timestamptz,
  participant_count int not null default 0,
  total_damage bigint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.raid_instances drop constraint if exists raid_instances_status_check;
alter table public.raid_instances add constraint raid_instances_status_check
  check (status in ('prep', 'fighting', 'won', 'lost', 'expired'));

create index if not exists raid_instances_status_idx on public.raid_instances (status);

alter table public.raid_instances enable row level security;
grant select on public.raid_instances to anon, authenticated;

drop policy if exists "Public read raid instances" on public.raid_instances;
create policy "Public read raid instances" on public.raid_instances for select to anon, authenticated using (true);
-- Bewusst KEINE Insert/Update/Delete-Policy fuer anon/authenticated - alle
-- Aenderungen laufen ausschliesslich ueber die untenstehenden RPCs.

-- ============================================================
-- 3) raid_participants - wer nimmt an welchem Raid teil
-- ============================================================
create table if not exists public.raid_participants (
  id uuid primary key default gen_random_uuid(),
  raid_id text not null references public.raid_instances(id) on delete cascade,
  auth_user_id uuid not null,
  display_name text not null,
  attack numeric not null default 0,
  defense numeric not null default 0,
  hp numeric not null default 0,
  damage_dealt bigint not null default 0,
  crits_landed int not null default 0,
  clicks_landed int not null default 0,
  joined_at timestamptz not null default now(),
  unique (raid_id, auth_user_id)
);

create index if not exists raid_participants_raid_id_idx on public.raid_participants (raid_id);
create index if not exists raid_participants_auth_user_id_idx on public.raid_participants (auth_user_id);

alter table public.raid_participants enable row level security;
grant select on public.raid_participants to anon, authenticated;

drop policy if exists "Public read raid participants" on public.raid_participants;
create policy "Public read raid participants" on public.raid_participants for select to anon, authenticated using (true);

-- ============================================================
-- 4) raid_player_stats - Aggregat pro Account (Erfolge/Bestenliste)
-- ============================================================
create table if not exists public.raid_player_stats (
  auth_user_id uuid primary key,
  display_name text not null,
  total_raids_joined int not null default 0,
  total_bosses_defeated int not null default 0,
  total_damage_dealt bigint not null default 0,
  total_mvp_count int not null default 0,
  total_flawless_wins int not null default 0,
  best_single_raid_damage bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.raid_player_stats enable row level security;
grant select on public.raid_player_stats to anon, authenticated;

drop policy if exists "Public read raid player stats" on public.raid_player_stats;
create policy "Public read raid player stats" on public.raid_player_stats for select to anon, authenticated using (true);

-- ============================================================
-- 5) raid_finish - interner Helfer (Sieg/Niederlage/Ablauf abschliessen)
-- ============================================================
create or replace function public.raid_finish(p_raid_id text, p_result text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boss_reward record;
  v_city_hp bigint;
  v_city_max_hp bigint;
  v_mvp_uid uuid;
  v_flawless boolean;
  rec record;
begin
  -- Nur EINMAL wirklich abschliessen (idempotent bei gleichzeitigen Aufrufen).
  update public.raid_instances
  set status = p_result, ended_at = now()
  where id = p_raid_id and status = 'fighting';
  if not found then return; end if;

  select ri.city_hp, ri.city_max_hp into v_city_hp, v_city_max_hp
  from public.raid_instances ri where ri.id = p_raid_id;
  v_flawless := (v_city_max_hp > 0 and v_city_hp >= v_city_max_hp);

  select auth_user_id into v_mvp_uid
  from public.raid_participants where raid_id = p_raid_id order by damage_dealt desc limit 1;

  if p_result = 'won' then
    select rb.gold_reward, rb.gem_reward, rb.xp_reward into v_boss_reward
    from public.raid_instances ri join public.raid_bosses rb on rb.id = ri.boss_id
    where ri.id = p_raid_id;

    for rec in select * from public.raid_participants where raid_id = p_raid_id loop
      update public.idle_player_state
      set gold = gold + v_boss_reward.gold_reward,
          total_gold_earned = total_gold_earned + v_boss_reward.gold_reward,
          crystals = crystals + v_boss_reward.gem_reward,
          xp = xp + v_boss_reward.xp_reward
      where auth_user_id = rec.auth_user_id;

      update public.raid_player_stats
      set total_bosses_defeated = total_bosses_defeated + 1,
          total_mvp_count = total_mvp_count + (case when rec.auth_user_id = v_mvp_uid then 1 else 0 end),
          total_flawless_wins = total_flawless_wins + (case when v_flawless then 1 else 0 end),
          updated_at = now()
      where auth_user_id = rec.auth_user_id;
    end loop;
  end if;
end;
$$;
grant execute on function public.raid_finish(text, text) to authenticated;

-- ============================================================
-- 6) raid_join - waehrend der 5-Minuten-Vorbereitungsphase beitreten
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
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  v_fight_starts := to_timestamp(p_raid_id, 'YYYYMMDDHH24') at time zone 'UTC';
  v_prep_starts := v_fight_starts - interval '5 minutes';
  if now() < v_prep_starts or now() >= v_fight_starts then
    raise exception 'not_in_prep_window';
  end if;

  select ips.display_name, ips.attack, ips.defense, ips.hp
  into v_display_name, v_attack, v_defense, v_hp
  from public.idle_player_state ips where ips.auth_user_id = v_uid limit 1;
  if not found then raise exception 'no_idle_state'; end if;

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
    participant_count = sub.cnt
  from (
    select sum(hp) total_hp, sum(attack) total_attack, sum(defense) total_defense, count(*) cnt
    from public.raid_participants where raid_id = p_raid_id
  ) sub
  where ri.id = p_raid_id and ri.status = 'prep';

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
-- 7) raid_deal_damage - eigenen (Auto- oder Klick-)Schaden einreichen
-- ============================================================
create or replace function public.raid_deal_damage(p_raid_id text, p_amount numeric, p_is_crit boolean default false, p_is_click boolean default false)
returns table (boss_hp bigint, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount bigint := greatest(0, round(p_amount));
  v_new_hp bigint;
  v_status text;
  v_own_damage bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  -- Deckel pro Aufruf gegen manipulierte Werte - ein einzelner Tick/Klick
  -- kann realistisch nicht mehr als das hier verursachen.
  if v_amount <= 0 or v_amount > 200000 then raise exception 'invalid_amount'; end if;

  if not exists (select 1 from public.raid_participants where raid_id = p_raid_id and auth_user_id = v_uid) then
    raise exception 'not_a_participant';
  end if;

  select ri.status into v_status from public.raid_instances ri where ri.id = p_raid_id for update;
  if v_status is null then raise exception 'raid_not_found'; end if;
  if v_status <> 'fighting' then raise exception 'raid_not_active'; end if;

  update public.raid_instances ri
  set boss_hp = greatest(0, ri.boss_hp - v_amount), total_damage = ri.total_damage + v_amount
  where ri.id = p_raid_id
  returning ri.boss_hp into v_new_hp;

  update public.raid_participants
  set damage_dealt = damage_dealt + v_amount,
      crits_landed = crits_landed + (case when p_is_crit then 1 else 0 end),
      clicks_landed = clicks_landed + (case when p_is_click then 1 else 0 end)
  where raid_id = p_raid_id and auth_user_id = v_uid
  returning damage_dealt into v_own_damage;

  update public.raid_player_stats
  set total_damage_dealt = total_damage_dealt + v_amount,
      best_single_raid_damage = greatest(best_single_raid_damage, v_own_damage)
  where auth_user_id = v_uid;

  if v_new_hp <= 0 then
    perform public.raid_finish(p_raid_id, 'won');
  end if;

  return query select ri.boss_hp, ri.status from public.raid_instances ri where ri.id = p_raid_id;
end;
$$;
grant execute on function public.raid_deal_damage(text, numeric, boolean, boolean) to authenticated;

-- ============================================================
-- 8) raid_boss_attack_tick - verteilter Tick fuer den Bossangriff auf die
--    Stadt UND Phasenwechsel (prep -> fighting, Ablauf -> expired).
--    Wird von JEDEM teilnehmenden Client periodisch aufgerufen, wirkt sich
--    aber dank der WHERE-Klausel nur einmal pro Intervall wirklich aus.
-- ============================================================
create or replace function public.raid_boss_attack_tick(p_raid_id text)
returns table (city_hp bigint, boss_hp bigint, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_fight_starts timestamptz;
  v_fight_ends timestamptz;
  v_dmg bigint;
  v_new_city_hp bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.raid_participants where raid_id = p_raid_id and auth_user_id = v_uid) then
    raise exception 'not_a_participant';
  end if;

  select ri.status, ri.fight_starts_at, ri.fight_ends_at into v_status, v_fight_starts, v_fight_ends
  from public.raid_instances ri where ri.id = p_raid_id;
  if v_status is null then raise exception 'raid_not_found'; end if;

  if v_status = 'prep' and now() >= v_fight_starts then
    update public.raid_instances ri set status = 'fighting', started_fight_at = now()
    where ri.id = p_raid_id and ri.status = 'prep';
    v_status := 'fighting';
  end if;

  if v_status = 'fighting' and now() >= v_fight_ends then
    perform public.raid_finish(p_raid_id, 'expired');
    return query select ri.city_hp, ri.boss_hp, ri.status from public.raid_instances ri where ri.id = p_raid_id;
    return;
  end if;

  if v_status = 'fighting' then
    select round(rb.base_attack) into v_dmg
    from public.raid_bosses rb join public.raid_instances ri on ri.boss_id = rb.id
    where ri.id = p_raid_id;

    update public.raid_instances ri
    set city_hp = greatest(0, ri.city_hp - greatest(1, v_dmg)),
        next_boss_attack_at = now() + make_interval(secs => (select attack_interval_seconds from public.raid_bosses where id = ri.boss_id))
    where ri.id = p_raid_id and ri.status = 'fighting' and ri.next_boss_attack_at <= now()
    returning ri.city_hp into v_new_city_hp;

    if v_new_city_hp is not null and v_new_city_hp <= 0 then
      perform public.raid_finish(p_raid_id, 'lost');
    end if;
  end if;

  return query select ri.city_hp, ri.boss_hp, ri.status from public.raid_instances ri where ri.id = p_raid_id;
end;
$$;
grant execute on function public.raid_boss_attack_tick(text) to authenticated;
