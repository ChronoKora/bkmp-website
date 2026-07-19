-- Bkmp - Raid: eigener Schaden soll sofort in der Teilnehmerliste stehen,
-- nicht erst nach dem Realtime-Roundtrip.
--
-- Bisher gab raid_deal_damage() nur (boss_hp, status) zurueck. Der Client
-- aktualisierte damit nur die Boss-Leiste - der eigene Eintrag in der
-- Teilnehmerliste wurde ausschliesslich ueber die Realtime-Subscription
-- (postgres_changes auf raid_participants) nachgezogen. Bei mehreren
-- gleichzeitig tickenden Spielern (Auto-Tick alle 2.5s + Klicks) konnte
-- das je nach Realtime-Last spuerbar hinterherhinken - der eigene
-- Schadenswert "wirkte falsch/verzoegert".
--
-- Fix: die Funktion liefert den bereits serverseitig berechneten eigenen
-- Stand (damage_dealt/crits_landed/clicks_landed) direkt in der Antwort
-- mit zurueck, damit der Client die eigene Zeile SOFORT lokal setzen kann,
-- ohne auf Realtime zu warten. Realtime bleibt fuer die ANDEREN Mitspieler
-- unveraendert im Einsatz.
--
-- Rueckgabetyp aendert sich (neue Spalten) - Postgres erlaubt das nicht
-- per CREATE OR REPLACE, daher erst DROP.

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
  returning damage_dealt, crits_landed, clicks_landed into v_own_damage, v_own_crits, v_own_clicks;

  update public.raid_player_stats
  set total_damage_dealt = total_damage_dealt + v_amount,
      best_single_raid_damage = greatest(best_single_raid_damage, v_own_damage)
  where auth_user_id = v_uid;

  if v_new_hp <= 0 then
    perform public.raid_finish(p_raid_id, 'won');
  end if;

  return query select ri.boss_hp, ri.status, v_own_damage, v_own_crits, v_own_clicks from public.raid_instances ri where ri.id = p_raid_id;
end;
$$;
grant execute on function public.raid_deal_damage(text, numeric, boolean, boolean) to authenticated;
