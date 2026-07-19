-- ============================================================
-- Bkmp - Bug-Fix: Beitritt zum 21-Uhr-Weltboss-Raid wurde faelschlich
-- blockiert (Spieler-Report 19.07., 21 Uhr: "Weltboss pausiert diese
-- Stunde..." obwohl gerade NICHT die 20-Uhr-Gildenboss-Stunde ist).
--
-- ROOT CAUSE: raid_join() (siehe sql/supabase-raid-pause-guildboss-hour.sql,
-- 17.07.) prueft bisher "extract(hour from now() at time zone
-- 'Europe/Berlin') = 20" - also die Uhrzeit GENAU IM MOMENT DES KLICKS,
-- nicht die Startstunde DES RAIDS, dem beigetreten werden soll.
--
-- Die Vorbereitungsphase eines Raids beginnt bereits 5 Minuten vor
-- Kampfbeginn (siehe v_prep_starts unten). Wer also zwischen 20:55 und
-- 20:59:59 Uhr dem GANZ NORMALEN 21-Uhr-Raid beitritt, sieht serverseitig
-- immer noch "now() = 20 Uhr" und wird faelschlich abgewiesen - obwohl
-- der Raid, dem er beitreten will (21 Uhr), gar nicht die gesperrte
-- Gildenboss-Stunde ist.
--
-- Der Client (js/systems/bkmp-raid.js, bkmpRaidIsGuildBossHourBerlin)
-- wurde fuer EXAKT dasselbe Fehlerbild bereits am 15.07. korrigiert -
-- dort wird schon der Start-Zeitpunkt DES RAIDS geprueft (info.fightStartsAt),
-- nicht "jetzt". Diese Migration bringt die Server-Funktion auf denselben
-- Stand: die Stunden-Sperre prueft jetzt v_fight_starts (aus p_raid_id
-- geparst) statt now().
--
-- Verhalten aendert sich NUR fuer die letzten 5 Minuten jeder Stunde
-- (Vorbereitungsphase): der 20-Uhr-Raid selbst bleibt weiterhin in JEDER
-- seiner eigenen Minuten (19:55 Vorbereitung bis 20:59 Kampfende) gesperrt -
-- nur der direkt darauffolgende 21-Uhr-Raid ist ab 20:55 wieder normal
-- beitrittbar, wie vom Client ohnehin schon angezeigt.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent (create or replace function). Aendert NUR die Stunden-Pruefung,
-- keine Kampfwerte/Belohnungen/Schadensberechnung angefasst.
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

  -- Fix (19.07.): v_fight_starts wird jetzt VOR der Stunden-Pruefung
  -- berechnet, damit die Pruefung die Startstunde DES RAIDS verwendet,
  -- nicht den Moment des Klicks (now()).
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
