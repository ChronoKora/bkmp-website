/* ============================================================
   Bkmp - Prestige-Knoten "Schluesselmeister" entfernt (03.08.2026,
   Nutzerwunsch: "wir haben Feste Schluessel Zeiten. da bringt so ein
   skill nichts").

   Hintergrund: sql/20260727-fix-dungeon-regen-fixed-slots-and-wire-
   prestige.sql hatte Schluesselmeister (+3% schnellere Regeneration/Rang)
   server-seitig verdrahtet - dabei bewusst dokumentiert, dass ein
   personalisiertes, verkuerztes Intervall nicht mehr auf demselben festen
   Raster wie alle anderen Spieler liegen kann (ein aktiver Schluesselmeister-
   Rang schaltete den Spieler deshalb auf ein rollierendes EIGENES Intervall
   um, siehe "else"-Zweig der alten dungeon_regen_calc()-Fassung). Genau das
   widerspricht aber dem urspruenglichen Wunsch vom 16.07.
   (sql/supabase-dungeon-fixed-key-times.sql: "Alles auf 0/4/8/12/16/20 Uhr
   skaliert" - ein GEMEINSAMES Raster fuer ALLE Spieler ohne Ausnahme).

   Diese Datei macht NUR den Schluesselmeister-Teil der 27.07.-Migration
   rueckgaengig - der andere Teil derselben Datei (Schluesselbund hebt den
   Schluessel-DECKEL an, betrifft nicht das Zeitraster selbst) bleibt
   vollstaendig unveraendert bestehen, ebenso der urspruengliche Fixed-Slot-
   Fix selbst (der bleibt jetzt sogar die EINZIGE Verhaltensweise, kein
   "Standardfall vs. Schluesselmeister-Fall" mehr).

   dungeon_regen_calc() behaelt ihre bisherige 4-Parameter-Signatur
   (Aufrufer wie guild_tech_contribute()/guild_tech_attempt_status(), siehe
   sql/20260801-fix-guild-tech-dungeon-regen-calc-mismatch.sql, rufen sie
   weiterhin mit ihren eigenen Standardwerten 14400/5 auf - unveraendert
   kompatibel) - der Funktionskoerper nutzt ab jetzt aber IMMER die feste
   Slot-Logik, unabhaengig vom uebergebenen p_interval_seconds-Wert.

   Client-seitig: das Passivpendant zu dieser Datei ist
   js/systems/bkmp-prestige.js's bkmpPrestigeMigrateSchluesselmeisterRemoval()
   - erstattet jedem Spieler mit Bestandsraengen (Basis UND Paragon) die
   dafuer ausgegebenen Prestige-Punkte beim naechsten Laden vollstaendig
   zurueck, der Knoten selbst wurde aus dem Prestige-Katalog entfernt.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (create or replace function).
   ============================================================ */

begin;

create or replace function public.dungeon_regen_calc(
  p_keys smallint,
  p_last_key_at timestamptz,
  p_interval_seconds int default 14400,
  p_max_keys smallint default 5,
  out new_keys smallint,
  out new_last_key_at timestamptz
)
language plpgsql
as $$
declare
  v_now_local timestamp;
  v_last_local timestamp;
  v_now_slot_ts timestamp;
  v_last_slot_ts timestamp;
  v_intervals int;
begin
  -- Immer das feste, fuer ALLE Spieler gleiche 00/04/08/12/16/20-Uhr-Raster
  -- (Europe/Berlin) - kein personalisiertes/verkuerztes Intervall mehr,
  -- unabhaengig davon, was in p_interval_seconds uebergeben wird
  -- (Schluesselmeister ist entfernt, kein Aufrufer setzt diesen Wert mehr
  -- absichtlich abweichend von 14400 - ein etwaiger abweichender Wert wird
  -- hier bewusst ignoriert statt still ein zweites Zeitverhalten zu erlauben).
  v_now_local := now() at time zone 'Europe/Berlin';
  v_last_local := p_last_key_at at time zone 'Europe/Berlin';
  v_now_slot_ts := v_now_local::date + make_interval(hours => (extract(hour from v_now_local)::int / 4) * 4);
  v_last_slot_ts := v_last_local::date + make_interval(hours => (extract(hour from v_last_local)::int / 4) * 4);
  v_intervals := round(extract(epoch from (v_now_slot_ts - v_last_slot_ts)) / 14400)::int;
  if v_intervals <= 0 then
    new_keys := p_keys;
    new_last_key_at := p_last_key_at;
    return;
  end if;
  if p_keys + v_intervals >= p_max_keys then
    new_keys := p_max_keys;
  else
    new_keys := (p_keys + v_intervals)::smallint;
  end if;
  new_last_key_at := v_now_slot_ts at time zone 'Europe/Berlin';
end;
$$;
grant execute on function public.dungeon_regen_calc(smallint, timestamptz, int, smallint) to authenticated;

create or replace function public.dungeon_get_all_status()
returns table (
  dungeon_type text,
  keys smallint,
  seconds_to_next integer,
  daily_bonus_available boolean,
  highest_difficulty text,
  total_completions integer,
  total_defeats integer,
  total_keys_spent integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_name_key text;
  v_types text[] := array['gold', 'exp', 'egg', 'meat', 'fruit', 'gem', 'rune'];
  v_type text;
  v_row public.dungeon_keys%rowtype;
  v_calc record;
  v_today date;
  v_alloc jsonb;
  v_key_cap_bonus int;
  v_max_keys smallint;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select name_key into v_name_key from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_name_key is null then
    raise exception 'no_player_state';
  end if;
  v_today := (now() at time zone 'Europe/Berlin')::date;

  -- Schluesselbund bleibt unveraendert (hebt nur den DECKEL an, nicht das
  -- Zeitraster) - Schluesselmeister-Regen-Geschwindigkeit entfernt.
  select prestige_allocations into v_alloc from public.idle_prestige_state where name_key = v_name_key;
  v_alloc := coalesce(v_alloc, '{}'::jsonb);
  v_key_cap_bonus := floor(coalesce((v_alloc->>'schluesselbund')::numeric, 0) * 1 + coalesce((v_alloc->>'schluesselbund__paragon')::numeric, 0) * 0.04)::int;
  v_max_keys := (5 + v_key_cap_bonus)::smallint;

  foreach v_type in array v_types loop
    insert into public.dungeon_keys (auth_user_id, name_key, dungeon_type)
    values (v_uid, v_name_key, v_type)
    on conflict (auth_user_id, dungeon_type) do nothing;

    select * into v_row from public.dungeon_keys where auth_user_id = v_uid and dungeon_type = v_type for update;
    select * into v_calc from public.dungeon_regen_calc(v_row.keys, v_row.last_key_at, 14400, v_max_keys);

    update public.dungeon_keys set keys = v_calc.new_keys, last_key_at = v_calc.new_last_key_at, name_key = v_name_key
    where auth_user_id = v_uid and dungeon_type = v_type;

    insert into public.dungeon_progress (auth_user_id, name_key, dungeon_type)
    values (v_uid, v_name_key, v_type)
    on conflict (auth_user_id, dungeon_type) do nothing;

    return query
    select
      v_type,
      v_calc.new_keys,
      (case when v_calc.new_keys >= v_max_keys then 0
       else (14400 - floor(extract(epoch from (now() - v_calc.new_last_key_at))))::int end),
      not exists (
        select 1 from public.dungeon_daily_bonus
        where auth_user_id = v_uid and dungeon_type = v_type and bonus_date = v_today
      ),
      dp.highest_difficulty,
      dp.total_completions,
      dp.total_defeats,
      dp.total_keys_spent
    from public.dungeon_progress dp
    where dp.auth_user_id = v_uid and dp.dungeon_type = v_type;
  end loop;
end;
$$;
grant execute on function public.dungeon_get_all_status() to authenticated;

create or replace function public.dungeon_consume_key(p_dungeon_type text)
returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name_key text;
  v_row public.dungeon_keys%rowtype;
  v_calc record;
  v_final smallint;
  v_alloc jsonb;
  v_key_cap_bonus int;
  v_max_keys smallint;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_dungeon_type not in ('gold', 'exp', 'egg', 'meat', 'fruit', 'gem', 'rune') then
    raise exception 'invalid_dungeon_type';
  end if;
  select name_key into v_name_key from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_name_key is null then
    raise exception 'no_player_state';
  end if;

  select prestige_allocations into v_alloc from public.idle_prestige_state where name_key = v_name_key;
  v_alloc := coalesce(v_alloc, '{}'::jsonb);
  v_key_cap_bonus := floor(coalesce((v_alloc->>'schluesselbund')::numeric, 0) * 1 + coalesce((v_alloc->>'schluesselbund__paragon')::numeric, 0) * 0.04)::int;
  v_max_keys := (5 + v_key_cap_bonus)::smallint;

  insert into public.dungeon_keys (auth_user_id, name_key, dungeon_type)
  values (v_uid, v_name_key, p_dungeon_type)
  on conflict (auth_user_id, dungeon_type) do nothing;

  select * into v_row from public.dungeon_keys where auth_user_id = v_uid and dungeon_type = p_dungeon_type for update;
  select * into v_calc from public.dungeon_regen_calc(v_row.keys, v_row.last_key_at, 14400, v_max_keys);

  if v_calc.new_keys < 1 then
    update public.dungeon_keys set keys = v_calc.new_keys, last_key_at = v_calc.new_last_key_at, name_key = v_name_key
    where auth_user_id = v_uid and dungeon_type = p_dungeon_type;
    raise exception 'no_keys_available';
  end if;

  v_final := v_calc.new_keys - 1;
  update public.dungeon_keys set keys = v_final, last_key_at = v_calc.new_last_key_at, name_key = v_name_key
  where auth_user_id = v_uid and dungeon_type = p_dungeon_type;

  insert into public.dungeon_progress (auth_user_id, name_key, dungeon_type, total_keys_spent)
  values (v_uid, v_name_key, p_dungeon_type, 1)
  on conflict (auth_user_id, dungeon_type) do update
  set total_keys_spent = public.dungeon_progress.total_keys_spent + 1, name_key = v_name_key;

  return v_final;
end;
$$;
grant execute on function public.dungeon_consume_key(text) to authenticated;

commit;

-- POSTCHECK (manuell, nach dem Ausfuehren):
-- select public.dungeon_regen_calc(0::smallint, now() - interval '5 hours');
--   -> erwartet: new_keys=1, new_last_key_at auf dem letzten festen 4h-Slot
--      (00/04/08/12/16/20 Uhr Berlin) - IMMER, auch mit abweichenden
--      p_interval_seconds-Werten (dritter Parameter wird jetzt ignoriert).
