-- Bkmp - Weltboss-Raid: konsolidierte, garantiert aktuelle Fassung von
-- raid_deal_damage()/raid_boss_attack_tick().
--
-- Beim kompletten Neu-Durchtest des Raidboss (15.07., nachdem der
-- Gildenboss bereits mehrere reale Bugs hatte) ist aufgefallen: es gibt
-- ZWEI verschiedene SQL-Dateien, die beide raid_deal_damage() komplett
-- neu definieren, unabhaengig voneinander entstanden und nie
-- zusammengefuehrt:
--   1) supabase-raid-damage-sync-fix.sql (13.07.) - fuegt own_damage_dealt/
--      own_crits_landed/own_clicks_landed zur Rueckgabe hinzu, damit der
--      eigene Schaden sofort lokal angezeigt wird (exakt derselbe Fix, der
--      am 15.07. auch fuer den Gildenboss noetig war).
--   2) supabase-raid-boss-balance-v2/v3/v4.sql (14.07., v4 zuletzt) -
--      komplett neue Gegenangriffs-Balance (Stadt nimmt nur noch alle 5%
--      Boss-HP-Fortschritt Schaden, Prozentsatz mehrfach nachjustiert),
--      aber mit der URSPRUENGLICHEN Rueckgabe (boss_hp, status) OHNE die
--      own_*-Spalten.
-- Je nachdem, welche der beiden Dateien zuletzt tatsaechlich ausgefuehrt
-- wurde, ueberschreibt "create or replace" komplett die Aenderung der
-- jeweils anderen - beide Male OHNE Fehlermeldung, da beide dieselbe
-- Funktionssignatur (Parameter) verwenden. Falls aktuell die
-- Balance-v4-Fassung ohne die own_*-Spalten aktiv ist, bekommt der Client
-- (supabase.js: submitRaidDamage()) fuer row.own_damage_dealt schlicht
-- "undefined" -> Number(undefined || 0) = 0 statt "null" - der Fehler
-- waere clientseitig NICHT sichtbar (kein Absturz, kein Fehler-Toast),
-- sondern wuerde sich exakt wie der bereits gefixte Gildenboss-Bug
-- aeussern: die eigene Schadenszahl in der Teilnehmerliste bliebe waehrend
-- des gesamten Kampfes bei 0 stehen, bis Realtime (oder ein Reload) den
-- echten Wert nachliefert. Ob das live tatsaechlich so ist, laesst sich
-- ohne DB-Zugriff nicht zweifelsfrei feststellen (PostgREST-Schema-
-- Introspection verlangt den Secret Key, nicht den anon Key) - diese Datei
-- macht die Frage irrelevant, indem sie EINMALIG beide Aenderungen
-- zusammengefuehrt in einer einzigen, ab jetzt alleine massgeblichen Datei
-- bereitstellt.
--
-- raid_boss_attack_tick() ist von diesem Konflikt nicht betroffen (nur
-- raid_deal_damage() aendert die Rueckgabespalten) - hier 1:1 aus v4
-- uebernommen, rein zur Vollstaendigkeit (diese Datei soll ab jetzt die
-- einzige Quelle fuer beide Funktionen sein).
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Rueckgabetyp von raid_deal_damage aendert sich moeglicherweise (falls
-- aktuell noch die 2-Spalten-Fassung aktiv ist) - Postgres erlaubt das
-- nicht per CREATE OR REPLACE, daher erst DROP. Unschaedlich, falls schon
-- die 5-Spalten-Fassung aktiv war (dann ist das ein reines No-Op-Replace).

alter table public.raid_instances add column if not exists last_counter_hp bigint;

drop function if exists public.raid_deal_damage(text, numeric, boolean, boolean);

create or replace function public.raid_deal_damage(p_raid_id text, p_amount numeric, p_is_crit boolean default false, p_is_click boolean default false)
returns table (boss_hp bigint, status text, own_damage_dealt bigint, own_crits_landed integer, own_clicks_landed integer)
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
  v_own_crits integer;
  v_own_clicks integer;
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
  returning damage_dealt, crits_landed, clicks_landed into v_own_damage, v_own_crits, v_own_clicks;

  update public.raid_player_stats
  set total_damage_dealt = total_damage_dealt + v_amount,
      best_single_raid_damage = greatest(best_single_raid_damage, v_own_damage)
  where auth_user_id = v_uid;

  if v_new_hp <= 0 then
    perform public.raid_finish(p_raid_id, 'won');
    return query select ri.boss_hp, ri.status, v_own_damage, v_own_crits, v_own_clicks from public.raid_instances ri where ri.id = p_raid_id;
    return;
  end if;

  -- Gegenangriff nur alle 5% Boss-HP-Fortschritt statt bei jedem Treffer
  -- (Balance-v2/v3/v4, 14.07.) - last_counter_hp merkt sich den Boss-HP-
  -- Stand beim letzten Gegenangriff.
  select ri.boss_max_hp, coalesce(ri.last_counter_hp, ri.boss_max_hp) into v_boss_max_hp, v_last_counter
  from public.raid_instances ri where ri.id = p_raid_id;

  if v_last_counter - v_new_hp >= v_boss_max_hp * 0.05 then
    select greatest(1, round(ri.city_max_hp * 0.014)) into v_city_dmg
    from public.raid_instances ri where ri.id = p_raid_id;

    update public.raid_instances ri
    set city_hp = greatest(0, ri.city_hp - v_city_dmg), last_counter_hp = v_new_hp
    where ri.id = p_raid_id
    returning ri.city_hp into v_new_city_hp;

    if v_new_city_hp is not null and v_new_city_hp <= 0 then
      perform public.raid_finish(p_raid_id, 'lost');
    end if;
  end if;

  return query select ri.boss_hp, ri.status, v_own_damage, v_own_crits, v_own_clicks from public.raid_instances ri where ri.id = p_raid_id;
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
    select greatest(1, round(ri.city_max_hp * 0.014)) into v_dmg
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
