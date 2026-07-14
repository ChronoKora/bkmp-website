-- Bkmp - Weltboss-Raid: Balance-Update v2 (16.07.).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Spieler-Feedback: "Wenn man 1 Hardcore-Spieler dabei hat, ist jeder
-- Weltboss easy ohne Gegenschaden." Ursache: der Bossangriff auf die Stadt
-- laeuft bisher rein zeitgesteuert (raid_boss_attack_tick, fester
-- attack_interval_seconds) - ein sehr starker Spieler killt den Boss
-- schneller, als das feste Zeitintervall ueberhaupt zuenden kann, die
-- Stadt bleibt dadurch praktisch unverwundbar.
--
-- Zwei ergaenzende Gegenmassnahmen (Spieler-Vorschlag, 16.07.):
--
-- 1) GARANTIERTER GEGENANGRIFF pro 5% verlorener Boss-HP (zusaetzlich zum
--    bestehenden Zeit-Tick, nicht als Ersatz) - egal wie schnell der Boss
--    stirbt, er landet ueber den gesamten Kampf hinweg immer dieselbe
--    Mindestanzahl an Treffern (~20 bei 5%-Schritten). Neue Spalte
--    last_counter_hp merkt sich den Boss-HP-Stand beim letzten
--    Gegenangriff; raid_deal_damage() prueft nach jedem Schadenstreffer,
--    ob seitdem mindestens 5% der maximalen Boss-HP verloren gingen.
--    Faellt der Boss durch denselben Treffer auf 0, entfaellt der
--    Gegenangriff (kein Rachehieb von einem toten Boss - gleiche Regel wie
--    beim normalen Drachenkampf, siehe idledorf.js bkmpIdleTick).
--
-- 2) ENRAGE-TEMPO: das Zeitintervall in raid_boss_attack_tick() skaliert ab
--    jetzt mit dem verbleibenden Boss-HP-Anteil (attack_interval_seconds *
--    boss_hp/boss_max_hp, nach unten gedeckelt auf 1.5s) - je naeher der
--    Boss am Tod ist (also genau dann, wenn ein Burst-Kill kurz bevorsteht),
--    desto schneller greift er an. Bei voller HP unveraendert wie bisher.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.raid_instances add column if not exists last_counter_hp bigint;

-- ============================================================
-- raid_deal_damage neu definieren: 1:1 dieselbe bisherige Logik, zusaetzlich
-- der garantierte 5%-Gegenangriff nach dem Schadenstreffer (nur wenn der
-- Boss den Treffer ueberlebt).
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
  v_boss_max_hp bigint;
  v_last_counter bigint;
  v_city_dmg bigint;
  v_new_city_hp bigint;
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
    return query select ri.boss_hp, ri.status from public.raid_instances ri where ri.id = p_raid_id;
    return;
  end if;

  -- Garantierter Gegenangriff: hat der Boss seit dem letzten Gegenangriff
  -- (oder seit Kampfbeginn, falls noch keiner feuerte) mindestens 5%
  -- seiner maximalen HP verloren?
  select ri.boss_max_hp, coalesce(ri.last_counter_hp, ri.boss_max_hp) into v_boss_max_hp, v_last_counter
  from public.raid_instances ri where ri.id = p_raid_id;

  if v_last_counter - v_new_hp >= v_boss_max_hp * 0.05 then
    select greatest(1, round(rb.base_attack - (ri.city_defense / greatest(1, ri.participant_count)) * 0.5)) into v_city_dmg
    from public.raid_bosses rb join public.raid_instances ri on ri.boss_id = rb.id
    where ri.id = p_raid_id;

    update public.raid_instances ri
    set city_hp = greatest(0, ri.city_hp - v_city_dmg), last_counter_hp = v_new_hp
    where ri.id = p_raid_id
    returning ri.city_hp into v_new_city_hp;

    if v_new_city_hp is not null and v_new_city_hp <= 0 then
      perform public.raid_finish(p_raid_id, 'lost');
    end if;
  end if;

  return query select ri.boss_hp, ri.status from public.raid_instances ri where ri.id = p_raid_id;
end;
$$;
grant execute on function public.raid_deal_damage(text, numeric, boolean, boolean) to authenticated;

-- ============================================================
-- raid_boss_attack_tick neu definieren: 1:1 dieselbe bisherige Logik,
-- Zeitintervall aber jetzt Enrage-skaliert nach verbleibendem Boss-HP-
-- Anteil statt fest.
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
  v_interval_secs numeric;
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
    -- Stadt-Verteidigung mindert den Bossangriff, wie schon beim normalen
    -- Kampf gegen Drachen ueblich (bkmpIdleDamageRoll: Schaden - Verteidigung
    -- * 0.5). Damit das bei vielen Teilnehmern nicht die Stadt praktisch
    -- unverwundbar macht, wird mit der DURCHSCHNITTLICHEN Verteidigung pro
    -- Teilnehmer gerechnet, nicht mit der Summe aller - eine grosse Gruppe
    -- ist so nicht automatisch "sicherer" als eine kleine mit gleich guter
    -- Ausruestung pro Kopf.
    select greatest(1, round(rb.base_attack - (ri.city_defense / greatest(1, ri.participant_count)) * 0.5)) into v_dmg
    from public.raid_bosses rb join public.raid_instances ri on ri.boss_id = rb.id
    where ri.id = p_raid_id;

    -- Enrage: Zeitintervall schrumpft mit sinkender Boss-HP (mindestens
    -- 1.5s, egal wie ausgeduennt der Boss schon ist) - bei voller HP genau
    -- wie bisher attack_interval_seconds, kurz vor dem Tod bis zu 4x
    -- schneller.
    select greatest(1.5, (select attack_interval_seconds from public.raid_bosses where id = ri.boss_id)
      * ri.boss_hp / greatest(1, ri.boss_max_hp)) into v_interval_secs
    from public.raid_instances ri where ri.id = p_raid_id;

    update public.raid_instances ri
    set city_hp = greatest(0, ri.city_hp - greatest(1, v_dmg)),
        next_boss_attack_at = now() + make_interval(secs => v_interval_secs)
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
