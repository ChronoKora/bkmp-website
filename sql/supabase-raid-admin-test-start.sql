/* ============================================================
   Admin: Test-Raid sofort starten (Spieler-Wunsch 14.07.: "Code wo ich ihn
   direkt aus Testzwecken starten konnte") - der normale Weg (raid_join)
   ist fest an die volle Stunde gekoppelt (Vorbereitung nur Minute 55-59),
   zum Testen der Balance-Aenderungen unpraktisch. Diese Funktion umgeht das
   komplett: erstellt sofort einen laufenden Solo-Raid (status = 'fighting'
   direkt, keine Vorbereitungsphase) mit den eigenen Kampfwerten als
   Grundlage - admin-gated, kein Spieler kann das selbst aufrufen.

   WICHTIG: Das ist die echte Live-Datenbank, kein Sandbox-Modus - der
   Test-Raid ist ein echter raid_instances-Eintrag. Die normale Seiten-UI
   erkennt ihn NICHT automatisch (sie sucht nur nach der aktuellen vollen
   Stunde als ID) - Interaktion laeuft ueber die Konsole (raid_deal_damage/
   raid_boss_attack_tick direkt aufrufen, siehe supabase.js).

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   idempotent: mehrfaches Ausfuehren ist unschaedlich.
   ============================================================ */

create or replace function public.admin_start_test_raid()
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_raid_id text;
  v_boss record;
  v_display_name text;
  v_attack numeric;
  v_defense numeric;
  v_hp numeric;
begin
  if not public.is_active_admin() then
    raise exception 'not_admin';
  end if;
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select ips.display_name, ips.attack, ips.defense, ips.hp
  into v_display_name, v_attack, v_defense, v_hp
  from public.idle_player_state ips where ips.auth_user_id = v_uid limit 1;
  if not found then
    raise exception 'no_idle_state';
  end if;

  select * into v_boss from public.raid_bosses where active = true order by created_at desc limit 1;
  if not found then raise exception 'no_active_boss'; end if;

  v_raid_id := 'test' || floor(extract(epoch from now()))::bigint;

  insert into public.raid_instances (
    id, boss_id, boss_max_hp, boss_hp, city_max_hp, city_hp, city_attack, city_defense,
    participant_count, fight_starts_at, fight_ends_at, started_fight_at, next_boss_attack_at, status
  ) values (
    v_raid_id, v_boss.id,
    greatest(v_boss.base_hp, round(v_attack * v_boss.hp_scale_per_attack)),
    greatest(v_boss.base_hp, round(v_attack * v_boss.hp_scale_per_attack)),
    v_hp, v_hp, v_attack, v_defense, 1,
    now(), now() + interval '15 minutes', now(), now(),
    'fighting'
  );

  insert into public.raid_participants (raid_id, auth_user_id, display_name, attack, defense, hp)
  values (v_raid_id, v_uid, v_display_name, v_attack, v_defense, v_hp);

  return v_raid_id;
end;
$$;
grant execute on function public.admin_start_test_raid() to authenticated;
