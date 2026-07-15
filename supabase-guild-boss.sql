/* ============================================================
   Gildensystem-Erweiterung, Phase G: Gildenboss
   (Spieler-Wunsch: "Ein neuer Bereich 'Gildenboss'... riesige Lebens-
   leiste... alle Mitglieder kaempfen gemeinsam... Belohnungen
   abhaengig vom verursachten Schaden... Schadensrangliste... taeglich
   oder mehrmals pro Woche").

   Struktur (atomarer Schaden, Idempotenz-Guard bei Sieg/Ablauf,
   Anti-Cheat-Deckel pro Treffer) direkt vom bestehenden Weltboss-Raid
   uebernommen, ABER: gilden-skaliert (max. 20 Mitglieder statt
   serverweit) und die Belohnung ist PROPORTIONAL zum Schadensanteil
   (der Weltboss-Raid verteilt dagegen pauschal - hier explizit anders
   gewuenscht). Anders als der Weltboss-Raid greift der Gildenboss NICHT
   zurueck an (kein "city_hp"/Gegenangriff-Konzept in der Vorgabe) - reiner
   DPS-Wettlauf gegen ein Zeitfenster: entweder die Gilde schafft es
   rechtzeitig (Sieg, proportionale Beute) oder das Fenster laeuft ab
   (kein Loot).

   Zeitfenster (bewusst taeglich statt stuendlich wie beim Weltboss-Raid,
   selbes "kein Cron noetig"-Prinzip ueber eine reine Zeit-Bucket-ID):
   Vorbereitung 19:55-20:00, Kampf 20:00-21:00 (Europe/Berlin), einmal
   pro Gilde pro Kalendertag.

   Boss-Sprite ist bewusst noch ein Platzhalter (wiederverwendet
   zerathor.mp4 vom Weltboss-Raid) - eigenes Artwork folgt spaeter, siehe
   sprite_key-Spalte fuer den spaeteren Austausch.

   Baut auf supabase-guild-extension-foundation.sql +
   supabase-idle-dorf-schema.sql (idle_player_state) auf. Supabase
   Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   idempotent.
   ============================================================ */

alter table public.guilds add column if not exists bosses_defeated bigint not null default 0;
alter table public.guilds add column if not exists boss_attempts bigint not null default 0;

create table if not exists public.guild_bosses (
  id text primary key,
  name text not null,
  sprite_key text,
  base_hp bigint not null default 2000000,
  hp_scale_per_attack numeric not null default 150,
  gold_reward bigint not null default 200000,
  gem_reward bigint not null default 1000,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.guild_bosses enable row level security;
grant select on public.guild_bosses to anon, authenticated;
drop policy if exists "Public read guild bosses" on public.guild_bosses;
create policy "Public read guild bosses" on public.guild_bosses for select to anon, authenticated using (true);
drop policy if exists "Admin write guild bosses" on public.guild_bosses;
create policy "Admin write guild bosses" on public.guild_bosses for update to authenticated using (public.is_active_admin());

insert into public.guild_bosses (id, name, sprite_key, base_hp, hp_scale_per_attack, gold_reward, gem_reward)
values ('grimlok', 'Malthyros, der Weltenverschlinger', 'malthyros', 2000000, 150, 200000, 1000)
on conflict (id) do update set name = excluded.name, sprite_key = excluded.sprite_key;

create table if not exists public.guild_boss_instances (
  id text primary key,
  guild_id uuid not null references public.guilds(id) on delete cascade,
  boss_id text references public.guild_bosses(id),
  boss_max_hp bigint not null,
  boss_hp bigint not null,
  status text not null default 'prep' check (status in ('prep', 'fighting', 'won', 'expired')),
  fight_starts_at timestamptz not null,
  fight_ends_at timestamptz not null,
  started_fight_at timestamptz,
  ended_at timestamptz,
  participant_count int not null default 0,
  total_damage bigint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.guild_boss_instances enable row level security;
grant select on public.guild_boss_instances to anon, authenticated;
drop policy if exists "Public read guild boss instances" on public.guild_boss_instances;
create policy "Public read guild boss instances" on public.guild_boss_instances for select to anon, authenticated using (true);

create table if not exists public.guild_boss_participants (
  id uuid primary key default gen_random_uuid(),
  instance_id text not null references public.guild_boss_instances(id) on delete cascade,
  auth_user_id uuid not null,
  display_name text not null,
  damage_dealt bigint not null default 0,
  crits_landed int not null default 0,
  clicks_landed int not null default 0,
  joined_at timestamptz not null default now(),
  unique (instance_id, auth_user_id)
);
create index if not exists guild_boss_participants_instance_idx on public.guild_boss_participants (instance_id, damage_dealt desc);
alter table public.guild_boss_participants enable row level security;
grant select on public.guild_boss_participants to anon, authenticated;
drop policy if exists "Public read guild boss participants" on public.guild_boss_participants;
create policy "Public read guild boss participants" on public.guild_boss_participants for select to anon, authenticated using (true);

create table if not exists public.guild_boss_player_stats (
  auth_user_id uuid primary key,
  display_name text not null,
  total_fights_joined int not null default 0,
  total_bosses_defeated int not null default 0,
  total_damage_dealt bigint not null default 0,
  best_single_fight_damage bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.guild_boss_player_stats enable row level security;
grant select on public.guild_boss_player_stats to anon, authenticated;
drop policy if exists "Public read guild boss player stats" on public.guild_boss_player_stats;
create policy "Public read guild boss player stats" on public.guild_boss_player_stats for select to anon, authenticated using (true);

-- ============================================================
-- guild_boss_join(): lazy Instanz-Erzeugung (wie beim Weltboss-Raid),
-- aber ID = Gilde + Kalendertag statt reine Stunde, und Boss-HP skaliert
-- mit der GESAMTEN Angriffskraft der Gildenmitglieder (nicht nur der
-- Beigetretenen) - ein grosses Gildenboss-Ziel soll die ganze Gilde
-- betreffen, nicht nur die ersten paar Klicker.
-- ============================================================
create or replace function public.guild_boss_join()
returns table (instance_id text, boss_hp bigint, boss_max_hp bigint, status text, boss_name text, sprite_key text, fight_starts_at timestamptz, fight_ends_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_display_name text;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_window_start timestamptz := (date_trunc('day', now() at time zone 'Europe/Berlin') + interval '20 hours') at time zone 'Europe/Berlin';
  v_window_end timestamptz := v_window_start + interval '1 hour';
  v_prep_start timestamptz := v_window_start - interval '5 minutes';
  v_instance_id text;
  v_boss_id text;
  v_base_hp bigint;
  v_hp_scale numeric;
  v_total_attack numeric;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then raise exception 'not_in_guild'; end if;

  select display_name into v_display_name from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_display_name is null then raise exception 'no_idle_state'; end if;

  if now() < v_prep_start or now() >= v_window_end then raise exception 'not_in_window'; end if;

  v_instance_id := v_guild_id::text || '-' || to_char(v_today, 'YYYYMMDD');

  if not exists (select 1 from public.guild_boss_instances where id = v_instance_id) then
    select id, base_hp, hp_scale_per_attack into v_boss_id, v_base_hp, v_hp_scale
    from public.guild_bosses where active = true order by created_at desc limit 1;
    if v_boss_id is null then raise exception 'no_boss_configured'; end if;

    select coalesce(sum(ips.attack), 0) into v_total_attack
    from public.idle_player_state ips
    join public.guild_members gm on gm.auth_user_id = ips.auth_user_id
    where gm.guild_id = v_guild_id;

    insert into public.guild_boss_instances (id, guild_id, boss_id, boss_max_hp, boss_hp, status, fight_starts_at, fight_ends_at)
    values (
      v_instance_id, v_guild_id, v_boss_id,
      greatest(v_base_hp, round(v_total_attack * v_hp_scale)),
      greatest(v_base_hp, round(v_total_attack * v_hp_scale)),
      'prep', v_window_start, v_window_end
    )
    on conflict (id) do nothing;

    update public.guilds set boss_attempts = boss_attempts + 1 where id = v_guild_id;
  end if;

  if now() >= v_window_start then
    update public.guild_boss_instances set status = 'fighting', started_fight_at = coalesce(started_fight_at, now())
    where id = v_instance_id and status = 'prep';
  end if;

  insert into public.guild_boss_participants (instance_id, auth_user_id, display_name)
  values (v_instance_id, v_uid, v_display_name)
  on conflict (instance_id, auth_user_id) do nothing;

  update public.guild_boss_instances
  set participant_count = (select count(*) from public.guild_boss_participants where instance_id = v_instance_id)
  where id = v_instance_id;

  insert into public.guild_boss_player_stats (auth_user_id, display_name, total_fights_joined)
  values (v_uid, v_display_name, 1)
  on conflict (auth_user_id) do update set total_fights_joined = guild_boss_player_stats.total_fights_joined + 1, display_name = excluded.display_name;

  return query
    select gbi.id, gbi.boss_hp, gbi.boss_max_hp, gbi.status, gb.name, gb.sprite_key, gbi.fight_starts_at, gbi.fight_ends_at
    from public.guild_boss_instances gbi join public.guild_bosses gb on gb.id = gbi.boss_id
    where gbi.id = v_instance_id;
end;
$$;
grant execute on function public.guild_boss_join() to authenticated;

-- ============================================================
-- guild_boss_finish(): idempotent (status='fighting' in der WHERE-
-- Klausel + "if not found then return" - gleiches Prinzip wie
-- raid_finish()). Bei Sieg: proportionale Belohnung nach Schadensanteil,
-- NICHT pauschal wie beim Weltboss-Raid.
-- ============================================================
create or replace function public.guild_boss_finish(p_instance_id text, p_result text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guild_id uuid;
  v_total_damage bigint;
  v_gold_pool bigint;
  v_gem_pool bigint;
  v_rec record;
  v_share numeric;
begin
  update public.guild_boss_instances set status = p_result, ended_at = now()
  where id = p_instance_id and status = 'fighting';
  if not found then return; end if;

  select guild_id, total_damage into v_guild_id, v_total_damage from public.guild_boss_instances where id = p_instance_id;

  if p_result = 'won' then
    select gb.gold_reward, gb.gem_reward into v_gold_pool, v_gem_pool
    from public.guild_bosses gb join public.guild_boss_instances gbi on gbi.boss_id = gb.id
    where gbi.id = p_instance_id;

    update public.guilds set bosses_defeated = bosses_defeated + 1 where id = v_guild_id;
    insert into public.guild_activity_log (guild_id, kind) values (v_guild_id, 'boss_defeated');

    for v_rec in select * from public.guild_boss_participants where instance_id = p_instance_id and damage_dealt > 0 loop
      v_share := v_rec.damage_dealt::numeric / greatest(1, v_total_damage);
      update public.idle_player_state
      set gold = gold + round(v_gold_pool * v_share), crystals = crystals + round(v_gem_pool * v_share)
      where auth_user_id = v_rec.auth_user_id;

      update public.guild_boss_player_stats
      set total_bosses_defeated = total_bosses_defeated + 1
      where auth_user_id = v_rec.auth_user_id;
    end loop;
  end if;
end;
$$;
grant execute on function public.guild_boss_finish(text, text) to authenticated;

-- ============================================================
-- guild_boss_deal_damage(): gleicher Anti-Cheat-Deckel (200000/Treffer)
-- und dieselbe FOR-UPDATE-Sperre wie raid_deal_damage(). Prueft die
-- Ablauf-Deadline selbst (kein separater Tick-RPC noetig, da es hier
-- keinen periodischen Gegenangriff gibt, der ohnehin regelmaessig
-- ticken muesste - die Deadline wird einfach beim naechsten Treffer
-- nach Ablauf erkannt).
-- ============================================================
create or replace function public.guild_boss_deal_damage(p_instance_id text, p_amount numeric, p_is_crit boolean default false, p_is_click boolean default false)
returns table (boss_hp bigint, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount bigint := greatest(0, round(p_amount));
  v_status text;
  v_fight_ends timestamptz;
  v_new_hp bigint;
  v_own_damage bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_amount <= 0 or v_amount > 200000 then raise exception 'invalid_amount'; end if;
  if not exists (select 1 from public.guild_boss_participants where instance_id = p_instance_id and auth_user_id = v_uid) then
    raise exception 'not_a_participant';
  end if;

  select status, fight_ends_at into v_status, v_fight_ends from public.guild_boss_instances where id = p_instance_id for update;
  if v_status is null then raise exception 'boss_not_found'; end if;
  if v_status <> 'fighting' then raise exception 'boss_not_active'; end if;

  if now() >= v_fight_ends then
    perform public.guild_boss_finish(p_instance_id, 'expired');
    return query select gbi.boss_hp, gbi.status from public.guild_boss_instances gbi where gbi.id = p_instance_id;
    return;
  end if;

  update public.guild_boss_instances
  set boss_hp = greatest(0, boss_hp - v_amount), total_damage = total_damage + v_amount
  where id = p_instance_id
  returning boss_hp into v_new_hp;

  update public.guild_boss_participants
  set damage_dealt = damage_dealt + v_amount,
      crits_landed = crits_landed + (case when p_is_crit then 1 else 0 end),
      clicks_landed = clicks_landed + (case when p_is_click then 1 else 0 end)
  where instance_id = p_instance_id and auth_user_id = v_uid
  returning damage_dealt into v_own_damage;

  update public.guild_boss_player_stats
  set total_damage_dealt = total_damage_dealt + v_amount,
      best_single_fight_damage = greatest(best_single_fight_damage, v_own_damage)
  where auth_user_id = v_uid;

  if v_new_hp <= 0 then
    perform public.guild_boss_finish(p_instance_id, 'won');
  end if;

  return query select gbi.boss_hp, gbi.status from public.guild_boss_instances gbi where gbi.id = p_instance_id;
end;
$$;
grant execute on function public.guild_boss_deal_damage(text, numeric, boolean, boolean) to authenticated;
