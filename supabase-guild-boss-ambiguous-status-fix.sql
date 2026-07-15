-- ============================================================
-- Live-Bug-Fix 15.07. (Spieler-Report per Screenshot: "Beitritt zum
-- Gildenboss fehlgeschlagen: column reference 'status' is ambiguous").
--
-- Ursache: guild_boss_join() gibt per RETURNS TABLE(...) unter anderem
-- Spalten namens "status", "instance_id", "boss_hp", "boss_max_hp",
-- "fight_starts_at"/"fight_ends_at" zurueck - PL/pgSQL legt dafuer
-- intern gleichnamige Variablen an. Die Tabellen guild_boss_instances
-- (Spalten status/boss_hp/boss_max_hp/fight_starts_at/fight_ends_at)
-- und guild_boss_participants (Spalte instance_id) haben ECHTE Spalten
-- mit denselben Namen. Ueberall dort, wo diese Namen OHNE Tabellen-Alias
-- verwendet wurden, konnte Postgres nicht entscheiden, ob die
-- RETURNS-TABLE-Variable oder die echte Tabellenspalte gemeint ist -
-- deshalb "ambiguous". Bestaetigt per Live-Check: guild_boss_instances/
-- guild_boss_participants/guild_boss_player_stats waren fuer ALLE
-- Gilden komplett leer (boss_attempts=0 ueberall) - der Fehler trat also
-- bei JEDEM allerersten Beitrittsversuch auf, nicht nur bei diesem einen
-- Spieler.
--
-- Zwei betroffene Stellen gefunden (nicht nur die eine, die den Fehler
-- ausgeloest hat - die zweite waere beim naechsten Versuch als
-- naechstes gescheitert):
--   1) "update ... where id = v_instance_id and status = 'prep'"
--   2) "select count(*) from guild_boss_participants where instance_id = v_instance_id"
-- Fix: beide UPDATE-Anweisungen bekommen einen Tabellen-Alias, jede
-- betroffene Spaltenreferenz wird darueber eindeutig qualifiziert. Sonst
-- 1:1 identisch zu supabase-guild-boss.sql.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent (create or replace function).
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
    update public.guild_boss_instances gbi
    set status = 'fighting', started_fight_at = coalesce(gbi.started_fight_at, now())
    where gbi.id = v_instance_id and gbi.status = 'prep';
  end if;

  insert into public.guild_boss_participants (instance_id, auth_user_id, display_name)
  values (v_instance_id, v_uid, v_display_name)
  on conflict (instance_id, auth_user_id) do nothing;

  update public.guild_boss_instances gbi
  set participant_count = (select count(*) from public.guild_boss_participants gbp where gbp.instance_id = v_instance_id)
  where gbi.id = v_instance_id;

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
