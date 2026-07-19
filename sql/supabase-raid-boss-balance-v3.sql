-- Bkmp - Weltboss-Raid: Balance-Update v3 (14.07.) - eigentliche Ursache
-- fuer "immer noch viel zu einfach" gefunden.
--
-- Live-Datenvergleich der letzten 3 Raids (18/19/20 Uhr UTC):
--   raid_id 2026071420 (22 Uhr lokal): boss_max_hp 742.182, city_max_hp
--   8.643, city_defense 3.065 -> Stadt verlor in 51 Sekunden trotz 15
--   Teilnehmern und einem klaren Sieg nur 40 von 8.643 HP (0,46%).
--
-- Der Gegenangriff-Schaden (v2) rechnete: greatest(1, base_attack -
-- (city_defense / teilnehmerzahl) * 0.5). base_attack steht fest bei 90
-- (raid_bosses-Konfigwert), city_defense waechst dagegen JEDE Raid-Instanz
-- automatisch mit der Gesamtstaerke aller Teilnehmer (city_defense =
-- Summe aller Verteidigungswerte). Bei 3.065 city_defense / 15 Teilnehmer *
-- 0.5 = 102 - das ist schon groesser als base_attack (90), die Formel
-- landet dadurch IMMER auf dem Minimum von 1 Schaden pro Treffer. Die
-- garantierten 5%-Gegenangriffe UND das Enrage-Tempo (v2) feuern beide
-- zuverlaessig (in diesem einen Kampf zusammen ca. 40 Treffer) - das
-- Frequenz-Problem von v2 ist also geloest, nur jeder einzelne Treffer war
-- wertlos.
--
-- Fix: der Gegenangriff bemisst sich jetzt an einem Prozentsatz der
-- STADT-MAX-HP statt an einer Differenz aus einem statischen Konfigwert und
-- der (mitwachsenden) Stadt-Verteidigung - skaliert dadurch automatisch mit
-- jeder Raid-Instanz mit, kann also nicht mehr wie base_attack "veralten".
-- 0,8% von city_max_hp pro Treffer: bei obigem Beispiel ~69 Schaden/Treffer,
-- macht einen sehr schnellen Sieg (40 Treffer) zu ~32% Stadt-HP-Verlust -
-- spuerbar, aber ueberlebbar. Ein langsamer Kampf (deutlich mehr Treffer
-- durch mehr verstrichene Zeit) kann die Stadt jetzt auch wirklich in echte
-- Gefahr bringen. Wert ist bewusst als einzelne Konstante gehalten, falls
-- nach dem naechsten Raid nachjustiert werden muss.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich. Gleiche Signatur wie
-- v2, daher reicht "create or replace" ohne vorheriges drop.

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

  select ri.boss_max_hp, coalesce(ri.last_counter_hp, ri.boss_max_hp) into v_boss_max_hp, v_last_counter
  from public.raid_instances ri where ri.id = p_raid_id;

  if v_last_counter - v_new_hp >= v_boss_max_hp * 0.05 then
    select greatest(1, round(ri.city_max_hp * 0.008)) into v_city_dmg
    from public.raid_instances ri where ri.id = p_raid_id;

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
    select greatest(1, round(ri.city_max_hp * 0.008)) into v_dmg
    from public.raid_instances ri where ri.id = p_raid_id;

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
