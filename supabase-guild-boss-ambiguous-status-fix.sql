-- ============================================================
-- Live-Bug-Fix 15.07. (Spieler-Report per Screenshot: "Beitritt zum
-- Gildenboss fehlgeschlagen: column reference 'status' is ambiguous",
-- danach nach Anwenden des ersten Fixes: "... 'instance_id' is
-- ambiguous").
--
-- Ursache: guild_boss_join()/guild_boss_deal_damage() geben per
-- RETURNS TABLE(...) Spalten namens "status"/"instance_id"/"boss_hp"/
-- "boss_max_hp"/"fight_starts_at"/"fight_ends_at" zurueck - PL/pgSQL
-- legt dafuer intern gleichnamige Variablen an. guild_boss_instances/
-- guild_boss_participants haben ECHTE Tabellenspalten mit denselben
-- Namen. Ueberall dort, wo ein Name OHNE Tabellen-Alias verwendet
-- wurde, konnte Postgres nicht entscheiden, ob die RETURNS-TABLE-
-- Variable oder die Tabellenspalte gemeint ist - "ambiguous".
--
-- Bestaetigt per Live-Check: guild_boss_instances/-participants/
-- -player_stats waren fuer ALLE Gilden komplett leer (boss_attempts=0
-- ueberall) - betraf also jeden allerersten Beitrittsversuch, nicht nur
-- einen Spieler.
--
-- Der erste Patch-Versuch behob nur guild_boss_join() (2 Stellen dort).
-- Sobald der Beitritt klappt, ruft der Client aber SOFORT bei jedem
-- Kampf-Tick guild_boss_deal_damage() auf - und DIESE Funktion (eigene
-- RETURNS TABLE(boss_hp, status)) hat DIESELBE Fehlerklasse an zwei
-- weiteren, bisher ungepatchten Stellen. Das urspruengliche Vorbild
-- raid_deal_damage() (siehe supabase-raid-damage-sync-fix.sql) qualifiziert
-- konsequent alles ueber den "ri."-Alias - beim Kopieren fuer den
-- Gildenboss ist das an diesen zwei Stellen verlorengegangen:
--   1) "select status, fight_ends_at into ... where id = p_instance_id"
--   2) "set boss_hp = greatest(0, boss_hp - v_amount) ... returning boss_hp"
--
-- Diese Datei enthaelt jetzt BEIDE Funktionen komplett (den bereits
-- funktionierenden guild_boss_join()-Fix erneut plus den neuen
-- guild_boss_deal_damage()-Fix), damit ein einziger Lauf alles abdeckt.
--
-- NACHBESSERUNG (Spieler-Report: nach dem ersten Fix-Versuch weiterhin
-- EXAKT derselbe "instance_id is ambiguous"-Fehler, kein Fortschritt zu
-- einem anderen Fehler): zusaetzlich zu den manuell qualifizierten
-- Stellen jetzt "#variable_conflict use_column" direkt als erste Zeile
-- in beiden Funktionsruempfen ergaenzt - eine Standard-PL/pgSQL-Direktive
-- genau fuer diese Fehlerklasse, die bei jedem Namenskonflikt zwischen
-- RETURNS-TABLE-Spalte und Tabellenspalte automatisch die Tabellenspalte
-- gewinnen laesst, statt einen Fehler zu werfen. Das federt auch jede
-- Stelle ab, die trotz sorgfaeltiger Durchsicht noch uebersehen wurde.
-- WICHTIG: falls der Fehler nach dieser Version immer noch exakt gleich
-- auftritt, pruefe bitte, ob im SQL-Editor wirklich DIESE Datei (mit der
-- "#variable_conflict"-Zeile) komplett eingefuegt und ausgefuehrt wurde,
-- nicht eine aeltere Version/ein alter Tab - der exakt identische
-- Fehlertext ueber mehrere Versuche hinweg deutet stark darauf hin, dass
-- der vorherige Fix technisch nie angekommen ist.
--
-- Sonst 1:1 identisch zu supabase-guild-boss.sql.
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
#variable_conflict use_column
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

create or replace function public.guild_boss_deal_damage(p_instance_id text, p_amount numeric, p_is_crit boolean default false, p_is_click boolean default false)
returns table (boss_hp bigint, status text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
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

  select gbi.status, gbi.fight_ends_at into v_status, v_fight_ends from public.guild_boss_instances gbi where gbi.id = p_instance_id for update;
  if v_status is null then raise exception 'boss_not_found'; end if;
  if v_status <> 'fighting' then raise exception 'boss_not_active'; end if;

  if now() >= v_fight_ends then
    perform public.guild_boss_finish(p_instance_id, 'expired');
    return query select gbi.boss_hp, gbi.status from public.guild_boss_instances gbi where gbi.id = p_instance_id;
    return;
  end if;

  update public.guild_boss_instances gbi
  set boss_hp = greatest(0, gbi.boss_hp - v_amount), total_damage = gbi.total_damage + v_amount
  where gbi.id = p_instance_id
  returning gbi.boss_hp into v_new_hp;

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

-- Spieler-Report: "Could not find the function public.guild_boss_deal_damage
-- (...) in the schema cache" - PostgREST (die REST-API-Schicht, die der
-- Browser tatsaechlich anspricht) hatte nach dem Neuanlegen der Funktion
-- oben noch den alten Stand im Cache, siehe bereits bestehende
-- supabase-reload-schema-cache.sql fuer denselben Fix bei einem frueheren
-- Vorfall. Zwingt PostgREST, sofort neu zu laden statt auf den naechsten
-- automatischen Refresh zu warten.
notify pgrst, 'reload schema';
