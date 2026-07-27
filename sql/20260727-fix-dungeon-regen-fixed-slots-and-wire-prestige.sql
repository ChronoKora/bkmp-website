/* ============================================================
   Zwei Dinge in einer Datei, weil sie dieselbe Funktion betreffen und nicht
   unabhaengig voneinander sinnvoll sind:

   1) ECHTER REGRESSIONS-FIX (27.07.2026, beim Verdrahten von Schluesselmeister/
      Schluesselbund gefunden, nicht Teil des urspruenglichen Auftrags):
      sql/supabase-dungeon-fixed-key-times.sql hatte am 16.07. auf
      ausdruecklichen Spielerwunsch ("Alles auf 0/4/8/12/16/20 Uhr skaliert")
      dungeon_regen_calc() von "4h rollend seit dem individuellen letzten
      Zeitstempel" auf "feste, fuer ALLE Spieler gleiche Uhrzeiten" umgestellt.
      sql/20260726-dungeon-key-prestige-bonus.sql (bereits live ausgefuehrt,
      siehe sql/20260726-fix-dungeon-regen-calc-ambiguity.sql) hat beim
      Hinzufuegen der zwei neuen Parameter (p_interval_seconds/p_max_keys)
      VERSEHENTLICH wieder die AELTERE rollierende Logik verwendet - die
      Fixed-Slots-Aenderung war damit seit dem 26.07. still rueckgaengig
      gemacht, ohne dass es bisher aufgefallen ist (kein Fehler, nur ein
      anderes, nicht mehr dem Spielerwunsch entsprechendes Zeitverhalten).

   2) Verdrahtung der Prestige-Knoten "Schluesselmeister" (+3% schnellere
      Regeneration/Rang)/"Schluesselbund" (+1 maximale Schluessel/Rang) -
      bisher kaufbar/sichtbar, aber wirkungslos (siehe Kommentar in
      js/systems/bkmp-prestige.js). dungeon_get_all_status()/
      dungeon_consume_key() lesen jetzt prestige_allocations und rechnen
      Rang+Paragon-Rang in echte Werte um, statt der festen Default-Werte.

   Geloeste Design-Frage: ein individuell VERKUERZTES Intervall (durch
   Schluesselmeister) kann nicht mehr auf demselben globalen, fuer alle
   Spieler gleichen Zeitraster liegen (das war ja der ganze Sinn des
   16.07.-Wunsches: EIN gemeinsames Raster). Deshalb: Standard-Intervall
   (14400s, kein Schluesselmeister-Rang) -> unveraendertes festes Raster wie
   bisher. Individuelles (kuerzeres) Intervall -> rollierend seit dem
   letzten eigenen Zeitstempel (wie vor der Fixed-Slots-Aenderung, aber mit
   dem persoenlichen Intervall/Limit) - kein Anspruch auf ein gemeinsames
   Raster mehr, sobald der Spieler sich bewusst fuer einen individuellen
   Vorteil entschieden hat. Schluesselbund (hoeheres Limit) allein aendert
   NICHTS am Intervall - bleibt also auch bei aktivem Schluesselbund auf dem
   festen Raster, nur mit hoeherer Obergrenze.

   Schluesselmeister-Deckel bei 95% (nie 0/negatives Intervall): der normale
   Maximalrang (30 * 3% = 90%) bleibt voll nutzbar (nicht nachtraeglich
   entwertet), Paragon-Raenge koennen die verbleibenden 5 Prozentpunkte noch
   ausschoepfen, mehr macht rechnerisch keinen Sinn (95% von 14400s sind noch
   720s/12min Minimum pro Schluessel).

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (create or replace function).
   ============================================================ */

begin;

-- Schluesselbund kann den Schluessel-Deckel ueber 5 heben (bis zu ~95 bei
-- Maximalrang+Paragon, siehe js/systems/bkmp-prestige.js) - dungeon_keys.keys
-- hatte bisher eine harte CHECK-Constraint bei genau 5 (sql/supabase-dungeon-
-- system-v2.sql:41), die jedes Speichern eines hoeheren Werts abgelehnt haette
-- (identisches Bugmuster wie der Level-2000-Deckel vom 26.07.). Grosszuegig
-- auf 100 angehoben (deutlich ueber dem realistischen Maximum von ~95).
alter table public.dungeon_keys drop constraint if exists dungeon_keys_check;
alter table public.dungeon_keys drop constraint if exists dungeon_keys_keys_check;
alter table public.dungeon_keys add constraint dungeon_keys_keys_check check (keys >= 0 and keys <= 100);

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
  if p_interval_seconds = 14400 then
    -- Standardfall (kein Schluesselmeister-Bonus): unveraendertes Verhalten
    -- aus sql/supabase-dungeon-fixed-key-times.sql - feste, fuer ALLE
    -- Spieler gleiche 00/04/08/12/16/20-Uhr-Slots (Europe/Berlin).
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
  else
    -- Schluesselmeister-Bonus aktiv (individuell verkuerztes Intervall) -
    -- ein gemeinsames festes Raster ergibt hier keinen Sinn mehr, rollierend
    -- seit dem eigenen letzten Zeitstempel (identisch zur Logik vor dem
    -- 16.07.-Fixed-Slots-Wunsch, nur mit personalisiertem Intervall/Limit).
    v_intervals := floor(extract(epoch from (now() - p_last_key_at)) / greatest(1, p_interval_seconds))::int;
    if v_intervals <= 0 then
      new_keys := p_keys;
      new_last_key_at := p_last_key_at;
      return;
    end if;
    if p_keys + v_intervals >= p_max_keys then
      new_keys := p_max_keys;
      new_last_key_at := now();
    else
      new_keys := (p_keys + v_intervals)::smallint;
      new_last_key_at := p_last_key_at + make_interval(secs => v_intervals * p_interval_seconds);
    end if;
  end if;
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
  v_regen_speed_pct numeric;
  v_key_cap_bonus int;
  v_interval_seconds int;
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

  select prestige_allocations into v_alloc from public.idle_prestige_state where name_key = v_name_key;
  v_alloc := coalesce(v_alloc, '{}'::jsonb);
  v_regen_speed_pct := least(95, coalesce((v_alloc->>'schluesselmeister')::numeric, 0) * 3 + coalesce((v_alloc->>'schluesselmeister__paragon')::numeric, 0) * 0.12);
  v_key_cap_bonus := floor(coalesce((v_alloc->>'schluesselbund')::numeric, 0) * 1 + coalesce((v_alloc->>'schluesselbund__paragon')::numeric, 0) * 0.04)::int;
  v_interval_seconds := greatest(1, round(14400 * (1 - v_regen_speed_pct / 100)))::int;
  v_max_keys := (5 + v_key_cap_bonus)::smallint;

  foreach v_type in array v_types loop
    insert into public.dungeon_keys (auth_user_id, name_key, dungeon_type)
    values (v_uid, v_name_key, v_type)
    on conflict (auth_user_id, dungeon_type) do nothing;

    select * into v_row from public.dungeon_keys where auth_user_id = v_uid and dungeon_type = v_type for update;
    select * into v_calc from public.dungeon_regen_calc(v_row.keys, v_row.last_key_at, v_interval_seconds, v_max_keys);

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
       else (v_interval_seconds - floor(extract(epoch from (now() - v_calc.new_last_key_at))))::int end),
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
  v_regen_speed_pct numeric;
  v_key_cap_bonus int;
  v_interval_seconds int;
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
  v_regen_speed_pct := least(95, coalesce((v_alloc->>'schluesselmeister')::numeric, 0) * 3 + coalesce((v_alloc->>'schluesselmeister__paragon')::numeric, 0) * 0.12);
  v_key_cap_bonus := floor(coalesce((v_alloc->>'schluesselbund')::numeric, 0) * 1 + coalesce((v_alloc->>'schluesselbund__paragon')::numeric, 0) * 0.04)::int;
  v_interval_seconds := greatest(1, round(14400 * (1 - v_regen_speed_pct / 100)))::int;
  v_max_keys := (5 + v_key_cap_bonus)::smallint;

  insert into public.dungeon_keys (auth_user_id, name_key, dungeon_type)
  values (v_uid, v_name_key, p_dungeon_type)
  on conflict (auth_user_id, dungeon_type) do nothing;

  select * into v_row from public.dungeon_keys where auth_user_id = v_uid and dungeon_type = p_dungeon_type for update;
  select * into v_calc from public.dungeon_regen_calc(v_row.keys, v_row.last_key_at, v_interval_seconds, v_max_keys);

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
-- 1) Ohne Schluesselmeister/Schluesselbund (Standardfall, gemeinsames Raster):
-- select public.dungeon_regen_calc(0::smallint, now() - interval '5 hours');
--   -> erwartet: new_keys=1, new_last_key_at auf dem letzten festen 4h-Slot (00/04/08/12/16/20 Uhr Berlin)
-- 2) Mit Bonus (individuelles Intervall):
-- select public.dungeon_regen_calc(0::smallint, now() - interval '5 hours', 7200, 8);
--   -> erwartet: new_keys=2 (2h-Intervall statt 4h), Maximum jetzt 8 statt 5, new_last_key_at rollierend (NICHT auf einem festen Slot)
