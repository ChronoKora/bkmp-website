/* ============================================================
   Dungeon-System 2.0 (Spieler-Vorgabe 17.07.: 7 spezialisierte
   Dungeons mit eigenem Schluessel-System, Tagesbonus, unabhaengigen
   Schwierigkeits-Freischaltungen und persistenten Statistiken).

   Vertrauensmodell wie im Rest des Spiels: Kampf-Simulation und
   Belohnungs-BETRAEGE bleiben clientseitig (wie Arena/Raid/der alte
   Dungeon), NUR die beiden echten Duplizierungs-/Manipulations-
   Risiken werden serverseitig (security definer, now()-basiert)
   abgesichert:
     1) Schluessel-Verbrauch (5 max, +1 alle 4h, muss offline korrekt
        nachlaufen und darf nicht per Client-Uhr manipulierbar sein)
     2) Tagesbonus-Vergabe (darf nicht durch Reload/Re-Login erneut
        ausgeloest werden)
   Schwierigkeits-Freischaltung wird ebenfalls serverseitig als
   Nebenprodukt von dungeon_mark_progress() gefuehrt (kostet nichts
   extra, ist aber kein hartes Gate wie bei 1) und 2) - identisch
   zum bestehenden Trust-Level bei Skilltree/Erfolgen).

   Idempotent: mehrfaches Ausfuehren ist unschaedlich (create table/
   function if not exists / or replace, drop constraint if exists).
   Supabase Dashboard > SQL Editor > New query > diesen Inhalt
   ausfuehren.
   ============================================================ */

/* ---------------- Booster (Goldrausch/Wissensschub) ----------------
   Minimalistisches Buff-System, das es im Spiel bisher gar nicht gab
   (Audit bestaetigt: keine Zeile mit "booster"/"buff" existierte).
   Zwei Zeitstempel-Spalten, gleiches Muster wie fruit/meat auf
   idle_player_state - Anwendung erfolgt clientseitig beim Gutschreiben
   von Gold/EXP (Date.now() < boost_..._until), selber Trust-Level wie
   der Rest der Wirtschaft in diesem Spiel. */
alter table public.idle_player_state add column if not exists boost_gold_until timestamptz;
alter table public.idle_player_state add column if not exists boost_exp_until timestamptz;

/* ---------------- dungeon_keys: 5 max, +1 alle 4h pro Dungeon-Typ ---------------- */
create table if not exists public.dungeon_keys (
  auth_user_id uuid not null,
  name_key text not null,
  dungeon_type text not null,
  keys smallint not null default 5 check (keys >= 0 and keys <= 5),
  last_key_at timestamptz not null default now(),
  primary key (auth_user_id, dungeon_type)
);
alter table public.dungeon_keys drop constraint if exists dungeon_keys_type_check;
alter table public.dungeon_keys add constraint dungeon_keys_type_check
  check (dungeon_type in ('gold', 'exp', 'egg', 'meat', 'fruit', 'gem', 'rune'));
alter table public.dungeon_keys enable row level security;
drop policy if exists "Own read dungeon keys" on public.dungeon_keys;
create policy "Own read dungeon keys" on public.dungeon_keys for select to authenticated using (auth_user_id = auth.uid());

/* ---------------- dungeon_daily_bonus: 1 Zeile pro Spieler+Typ+Berlin-Tag ---------------- */
create table if not exists public.dungeon_daily_bonus (
  auth_user_id uuid not null,
  name_key text not null,
  dungeon_type text not null,
  bonus_date date not null,
  claimed_at timestamptz not null default now(),
  primary key (auth_user_id, dungeon_type, bonus_date)
);
alter table public.dungeon_daily_bonus enable row level security;
drop policy if exists "Own read dungeon daily bonus" on public.dungeon_daily_bonus;
create policy "Own read dungeon daily bonus" on public.dungeon_daily_bonus for select to authenticated using (auth_user_id = auth.uid());

/* ---------------- dungeon_progress: Freischaltung + Lifetime-Statistik pro Typ ---------------- */
create table if not exists public.dungeon_progress (
  auth_user_id uuid not null,
  name_key text not null,
  dungeon_type text not null,
  highest_difficulty text not null default 'leicht',
  total_completions integer not null default 0,
  total_defeats integer not null default 0,
  total_keys_spent integer not null default 0,
  primary key (auth_user_id, dungeon_type)
);
alter table public.dungeon_progress drop constraint if exists dungeon_progress_type_check;
alter table public.dungeon_progress add constraint dungeon_progress_type_check
  check (dungeon_type in ('gold', 'exp', 'egg', 'meat', 'fruit', 'gem', 'rune'));
alter table public.dungeon_progress drop constraint if exists dungeon_progress_difficulty_check;
alter table public.dungeon_progress add constraint dungeon_progress_difficulty_check
  check (highest_difficulty in ('leicht', 'mittel', 'schwer', 'albtraum'));
alter table public.dungeon_progress enable row level security;
drop policy if exists "Own read dungeon progress" on public.dungeon_progress;
create policy "Own read dungeon progress" on public.dungeon_progress for select to authenticated using (auth_user_id = auth.uid());

/* ---------------- idle_dungeon_results: um dungeon_type erweitern (bestehende Zeilen -> 'gold', Bestzeiten bleiben erhalten) ---------------- */
alter table public.idle_dungeon_results add column if not exists dungeon_type text not null default 'gold';

alter table public.idle_dungeon_results drop constraint if exists idle_dungeon_results_type_check;
alter table public.idle_dungeon_results add constraint idle_dungeon_results_type_check
  check (dungeon_type in ('gold', 'exp', 'egg', 'meat', 'fruit', 'gem', 'rune'));

alter table public.idle_dungeon_results drop constraint if exists idle_dungeon_results_name_difficulty_key;
alter table public.idle_dungeon_results drop constraint if exists idle_dungeon_results_name_type_difficulty_key;
alter table public.idle_dungeon_results add constraint idle_dungeon_results_name_type_difficulty_key unique (name_key, dungeon_type, difficulty_id);

create index if not exists idle_dungeon_results_type_difficulty_idx on public.idle_dungeon_results (dungeon_type, difficulty_id, waves_cleared desc, time_ms asc);

/* ============================================================
   Funktionen
   ============================================================ */

/* Interner Hilfsbaustein: aus (aktuelle Schluessel, letzter Schluessel-
   Zeitpunkt) den nachgelaufenen Stand berechnen. +1 Schluessel pro
   volle 4h, Rest-Fortschritt zum naechsten Schluessel bleibt erhalten
   (Anker wird nur um die VERBRAUCHTEN vollen Intervalle vorgerueckt),
   bei Erreichen des Maximums wird der Anker auf now() gesetzt (kein
   Aufstauen ueber 5 hinaus). */
create or replace function public.dungeon_regen_calc(p_keys smallint, p_last_key_at timestamptz, out new_keys smallint, out new_last_key_at timestamptz)
language plpgsql
as $$
declare
  v_intervals int;
begin
  v_intervals := floor(extract(epoch from (now() - p_last_key_at)) / 14400)::int;
  if v_intervals <= 0 then
    new_keys := p_keys;
    new_last_key_at := p_last_key_at;
    return;
  end if;
  if p_keys + v_intervals >= 5 then
    new_keys := 5;
    new_last_key_at := now();
  else
    new_keys := (p_keys + v_intervals)::smallint;
    new_last_key_at := p_last_key_at + make_interval(hours => v_intervals * 4);
  end if;
end;
$$;
grant execute on function public.dungeon_regen_calc(smallint, timestamptz) to authenticated;

/* Status aller 7 Dungeon-Typen in einem Aufruf (fuer die Kartenansicht) -
   legt fehlende Zeilen bei Bedarf lazy an, rechnet Schluessel-Regen
   nach und persistiert das Ergebnis gleich mit. */
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
/* Bug-Fix (Live-Fehler 18.07.: "column reference \"dungeon_type\" is
   ambiguous"): "returns table (dungeon_type text, ...)" erzeugt automatisch
   eine gleichnamige PL/pgSQL-Variable "dungeon_type" - die kollidiert mit
   der echten Tabellenspalte dungeon_keys.dungeon_type/dungeon_progress.
   dungeon_type/dungeon_daily_bonus.dungeon_type in jeder WHERE-Klausel
   dieser Funktion. #variable_conflict use_column loest jede so entstehende
   Mehrdeutigkeit zugunsten der echten Tabellenspalte auf (der eigentliche
   Rueckgabewert kommt ohnehin ueber v_type, nie ueber die Variable
   "dungeon_type" selbst). */
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_name_key text;
  v_types text[] := array['gold', 'exp', 'egg', 'meat', 'fruit', 'gem', 'rune'];
  v_type text;
  v_row public.dungeon_keys%rowtype;
  v_calc record;
  v_today date;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select name_key into v_name_key from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_name_key is null then
    raise exception 'no_player_state';
  end if;
  v_today := (now() at time zone 'Europe/Berlin')::date;

  foreach v_type in array v_types loop
    insert into public.dungeon_keys (auth_user_id, name_key, dungeon_type)
    values (v_uid, v_name_key, v_type)
    on conflict (auth_user_id, dungeon_type) do nothing;

    select * into v_row from public.dungeon_keys where auth_user_id = v_uid and dungeon_type = v_type for update;
    select * into v_calc from public.dungeon_regen_calc(v_row.keys, v_row.last_key_at);

    update public.dungeon_keys set keys = v_calc.new_keys, last_key_at = v_calc.new_last_key_at, name_key = v_name_key
    where auth_user_id = v_uid and dungeon_type = v_type;

    insert into public.dungeon_progress (auth_user_id, name_key, dungeon_type)
    values (v_uid, v_name_key, v_type)
    on conflict (auth_user_id, dungeon_type) do nothing;

    return query
    select
      v_type,
      v_calc.new_keys,
      (case when v_calc.new_keys >= 5 then 0
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

/* Schluessel fuer EINEN Dungeon-Typ verbrauchen (beim Start eines Laufs).
   Wirft 'no_keys_available', wenn nach dem Nachrechnen < 1 Schluessel
   uebrig ist - der Client muss den Start dann abbrechen. */
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

  insert into public.dungeon_keys (auth_user_id, name_key, dungeon_type)
  values (v_uid, v_name_key, p_dungeon_type)
  on conflict (auth_user_id, dungeon_type) do nothing;

  select * into v_row from public.dungeon_keys where auth_user_id = v_uid and dungeon_type = p_dungeon_type for update;
  select * into v_calc from public.dungeon_regen_calc(v_row.keys, v_row.last_key_at);

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

/* Tagesbonus fuer EINEN Dungeon-Typ beanspruchen - idempotent, gibt
   true nur beim ERSTEN erfolgreichen Aufruf des Berlin-Kalendertages
   zurueck. Wird vom Client genau einmal beim erfolgreichen Abschluss
   eines vollstaendigen Laufs aufgerufen, bevor die Belohnung berechnet
   wird. */
create or replace function public.dungeon_claim_daily_bonus(p_dungeon_type text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name_key text;
  v_today date;
  v_rows int;
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

  v_today := (now() at time zone 'Europe/Berlin')::date;

  insert into public.dungeon_daily_bonus (auth_user_id, name_key, dungeon_type, bonus_date)
  values (v_uid, v_name_key, p_dungeon_type, v_today)
  on conflict (auth_user_id, dungeon_type, bonus_date) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
grant execute on function public.dungeon_claim_daily_bonus(text) to authenticated;

/* Read-only Vorschau, ob der Tagesbonus fuer einen Typ noch verfuegbar
   waere - fuer die Kartenanzeige, OHNE ihn zu verbrauchen. */
create or replace function public.dungeon_daily_bonus_available(p_dungeon_type text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public.dungeon_daily_bonus
    where auth_user_id = auth.uid() and dungeon_type = p_dungeon_type
      and bonus_date = (now() at time zone 'Europe/Berlin')::date
  );
$$;
grant execute on function public.dungeon_daily_bonus_available(text) to authenticated;

/* Lauf-Ergebnis eintragen: Completion/Defeat-Zaehler hochzaehlen und -
   nur bei Erfolg auf genau der aktuell hoechsten freigeschalteten
   Schwierigkeit - die naechste Stufe freischalten. Gibt die (ggf. neue)
   hoechste freigeschaltete Schwierigkeit zurueck. */
create or replace function public.dungeon_mark_progress(p_dungeon_type text, p_success boolean, p_difficulty_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name_key text;
  v_row public.dungeon_progress%rowtype;
  v_ladder text[] := array['leicht', 'mittel', 'schwer', 'albtraum'];
  v_current_idx int;
  v_next text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_dungeon_type not in ('gold', 'exp', 'egg', 'meat', 'fruit', 'gem', 'rune') then
    raise exception 'invalid_dungeon_type';
  end if;
  if p_difficulty_id not in ('leicht', 'mittel', 'schwer', 'albtraum') then
    raise exception 'invalid_difficulty';
  end if;
  select name_key into v_name_key from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_name_key is null then
    raise exception 'no_player_state';
  end if;

  insert into public.dungeon_progress (auth_user_id, name_key, dungeon_type)
  values (v_uid, v_name_key, p_dungeon_type)
  on conflict (auth_user_id, dungeon_type) do nothing;

  select * into v_row from public.dungeon_progress where auth_user_id = v_uid and dungeon_type = p_dungeon_type for update;

  if p_success then
    v_current_idx := array_position(v_ladder, v_row.highest_difficulty);
    if p_difficulty_id = v_row.highest_difficulty and v_current_idx < array_length(v_ladder, 1) then
      v_next := v_ladder[v_current_idx + 1];
    else
      v_next := v_row.highest_difficulty;
    end if;
    update public.dungeon_progress
    set total_completions = total_completions + 1, highest_difficulty = v_next, name_key = v_name_key
    where auth_user_id = v_uid and dungeon_type = p_dungeon_type;
  else
    v_next := v_row.highest_difficulty;
    update public.dungeon_progress
    set total_defeats = total_defeats + 1, name_key = v_name_key
    where auth_user_id = v_uid and dungeon_type = p_dungeon_type;
  end if;

  return v_next;
end;
$$;
grant execute on function public.dungeon_mark_progress(text, boolean, text) to authenticated;

notify pgrst, 'reload schema';
