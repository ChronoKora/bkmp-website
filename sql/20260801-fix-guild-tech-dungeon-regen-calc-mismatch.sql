-- DRINGEND: behebt einen echten, live bestätigten Produktionsfehler
-- ("guild_tech_attempt_status 404 (Not Found)" im Browser, per Netzwerk-
-- Tab-Antworttext auf den tatsächlichen Fehler zurückgeführt: "function
-- public.dungeon_regen_calc(smallint, timestamp with time zone, integer,
-- integer) does not exist"). Betrifft NICHT nur die Anzeige - genau
-- derselbe Aufruf steckt auch in guild_tech_contribute(), jeder
-- Beitragsversuch im echten Spiel scheitert aktuell ebenfalls damit.
--
-- ROOT CAUSE: beide Funktionen rufen dungeon_regen_calc(v_row.attempts,
-- v_row.last_attempt_at, 14400, 5) mit den letzten beiden Werten als
-- nackte Zahlen-Literale auf. Postgres typisiert ein Literal wie "5" ohne
-- Kontext als integer - die tatsaechlich live laufende dungeon_regen_calc()
-- akzeptiert an dieser Stelle aber keinen passenden impliziten Cast (ihr
-- reales Parameter-Profil weicht an dieser Stelle von der lokalen Kopie in
-- sql/20260727-fix-dungeon-regen-fixed-slots-and-wire-prestige.sql ab -
-- Postgres identifiziert Funktionen strikt ueber Parametertypen, siehe
-- bereits die frühere dungeon_regen_calc-Mehrdeutigkeit vom 26.07.).
--
-- FIX TEIL 1: die letzten beiden Argumente werden gar nicht mehr explizit
-- mitgeschickt - dungeon_regen_calc() hat für genau diese beiden Werte
-- (14400 Sekunden / 5 max. Schlüssel) bereits eigene Standardwerte
-- (p_interval_seconds default 14400, p_max_keys default 5), die exakt dem
-- hier gewollten Verhalten entsprechen. Kein Typ-Raten mehr nötig, robust
-- gegen die genaue Signatur der live laufenden Funktion. Keine Aenderung
-- an Beitragslogik/Kosten/Vorbedingungen - nur dieser eine Aufruf pro
-- Funktion.
--
-- NACHTRAG (nach dem ersten Live-Test dieser Datei): Fix Teil 1 hat einen
-- ZWEITEN, bis dahin verdeckten Fehler in guild_tech_contribute() sichtbar
-- gemacht ("Beitrag fehlgeschlagen: structure of query does not match
-- function result type") - vorher brach die Funktion IMMER schon beim
-- dungeon_regen_calc()-Aufruf ab, bevor sie je diese Stelle erreichte.
-- ROOT CAUSE TEIL 2: die letzte RETURN-QUERY-Spalte "v_calc.new_keys - 1"
-- rechnet smallint - integer, was in Postgres automatisch zu integer
-- hochgestuft wird - die Funktion verspricht an dieser Stelle aber
-- smallint (Spalte attempts_left). FIX TEIL 2: expliziter ::smallint-Cast
-- auf das Ergebnis dieser einen Rechnung, keine weitere Änderung.
--
-- Supabase Dashboard > SQL Editor > New query > diesen AKTUALISIERTEN
-- Inhalt (nochmal komplett) ausfuehren - create or replace ist sicher
-- mehrfach ausführbar, überschreibt einfach den vorherigen Teil-1-Stand.

begin;

create or replace function public.guild_tech_contribute(p_node_id text)
returns table (
  new_tier int,
  new_progress_gold numeric,
  tier_gold_cost numeric,
  gold_spent numeric,
  remaining_gold bigint,
  attempts_left smallint,
  seconds_to_next_attempt int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_display_name text;
  v_name_key text;
  v_node public.guild_tech_nodes%rowtype;
  v_progress public.guild_tech_progress%rowtype;
  v_prereq_id text;
  v_attempt_row public.guild_tech_contributor_attempts%rowtype;
  v_calc record;
  v_tier_gold_cost numeric;
  v_remaining_needed numeric;
  v_contribution_step numeric;
  v_actual_amount numeric;
  v_gold bigint;
  v_new_tier int;
  v_new_progress numeric;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select guild_id, display_name into v_guild_id, v_display_name from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then raise exception 'not_in_guild'; end if;

  select name_key into v_name_key from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_name_key is null then raise exception 'no_player_state'; end if;

  select * into v_node from public.guild_tech_nodes where id = p_node_id;
  if not found then raise exception 'invalid_node'; end if;

  insert into public.guild_tech_progress (guild_id, node_id) values (v_guild_id, p_node_id)
  on conflict (guild_id, node_id) do nothing;
  select * into v_progress from public.guild_tech_progress where guild_id = v_guild_id and node_id = p_node_id for update;

  if v_progress.tier >= v_node.max_tier then raise exception 'node_maxed'; end if;

  if v_node.prereq_node_ids is not null and array_length(v_node.prereq_node_ids, 1) > 0 then
    foreach v_prereq_id in array v_node.prereq_node_ids loop
      declare
        v_req_max_tier int;
        v_have_tier int;
      begin
        select max_tier into v_req_max_tier from public.guild_tech_nodes where id = v_prereq_id;
        select coalesce(tier, 0) into v_have_tier from public.guild_tech_progress where guild_id = v_guild_id and node_id = v_prereq_id;
        if v_req_max_tier is null or coalesce(v_have_tier, 0) < v_req_max_tier then
          raise exception 'prereq_not_met';
        end if;
      end;
    end loop;
  end if;

  insert into public.guild_tech_contributor_attempts (auth_user_id, name_key) values (v_uid, v_name_key)
  on conflict (auth_user_id) do nothing;
  select * into v_attempt_row from public.guild_tech_contributor_attempts where auth_user_id = v_uid for update;
  -- FIX: keine expliziten 14400/5-Literale mehr - dungeon_regen_calc()s
  -- eigene Standardwerte fuer p_interval_seconds/p_max_keys uebernehmen.
  select * into v_calc from public.dungeon_regen_calc(v_attempt_row.attempts, v_attempt_row.last_attempt_at);
  update public.guild_tech_contributor_attempts set attempts = v_calc.new_keys, last_attempt_at = v_calc.new_last_key_at, name_key = v_name_key
  where auth_user_id = v_uid;

  if v_calc.new_keys < 1 then raise exception 'no_attempts_available'; end if;

  v_tier_gold_cost := round(v_node.base_gold_cost * power(v_node.cost_growth, v_progress.tier));
  v_remaining_needed := v_tier_gold_cost - v_progress.progress_gold;
  v_contribution_step := round(v_tier_gold_cost / greatest(1, v_node.attempts_per_tier));
  v_actual_amount := least(v_contribution_step, v_remaining_needed);
  if v_actual_amount < 1 then v_actual_amount := 1; end if;

  select gold into v_gold from public.idle_player_state where auth_user_id = v_uid;
  if v_gold is null or v_gold < v_actual_amount then
    update public.guild_tech_contributor_attempts set attempts = attempts - 1 where auth_user_id = v_uid;
    raise exception 'insufficient_gold';
  end if;

  update public.idle_player_state set gold = gold - v_actual_amount where auth_user_id = v_uid;
  update public.guild_tech_contributor_attempts set attempts = attempts - 1 where auth_user_id = v_uid;
  update public.guild_members set tech_contributed_gold = tech_contributed_gold + v_actual_amount where auth_user_id = v_uid;

  v_new_progress := v_progress.progress_gold + v_actual_amount;
  v_new_tier := v_progress.tier;
  if v_new_progress >= v_tier_gold_cost then
    v_new_tier := v_progress.tier + 1;
    v_new_progress := 0;
  end if;

  update public.guild_tech_progress set tier = v_new_tier, progress_gold = v_new_progress
  where guild_id = v_guild_id and node_id = p_node_id;

  insert into public.guild_activity_log (guild_id, kind, actor_name, value, extra)
  values (v_guild_id, 'tech_contribute', v_display_name, v_actual_amount::bigint, p_node_id);
  if v_new_tier > v_progress.tier then
    insert into public.guild_activity_log (guild_id, kind, actor_name, value, extra)
    values (v_guild_id, 'tech_tier_complete', v_display_name, v_new_tier, p_node_id);
  end if;

  select gold into v_gold from public.idle_player_state where auth_user_id = v_uid;

  return query select
    v_new_tier,
    v_new_progress,
    v_tier_gold_cost,
    v_actual_amount,
    v_gold,
    (v_calc.new_keys - 1)::smallint,
    0;
end;
$$;
grant execute on function public.guild_tech_contribute(text) to authenticated;

create or replace function public.guild_tech_attempt_status()
returns table (attempts smallint, max_attempts smallint, seconds_to_next int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name_key text;
  v_row public.guild_tech_contributor_attempts%rowtype;
  v_calc record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select name_key into v_name_key from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_name_key is null then raise exception 'no_player_state'; end if;

  insert into public.guild_tech_contributor_attempts (auth_user_id, name_key) values (v_uid, v_name_key)
  on conflict (auth_user_id) do nothing;
  select * into v_row from public.guild_tech_contributor_attempts where auth_user_id = v_uid for update;
  -- FIX: siehe guild_tech_contribute() oben, gleiche Ursache/gleicher Fix.
  select * into v_calc from public.dungeon_regen_calc(v_row.attempts, v_row.last_attempt_at);

  update public.guild_tech_contributor_attempts set attempts = v_calc.new_keys, last_attempt_at = v_calc.new_last_key_at, name_key = v_name_key
  where auth_user_id = v_uid;

  return query select
    v_calc.new_keys,
    5::smallint,
    (case when v_calc.new_keys >= 5 then 0
     else (14400 - floor(extract(epoch from (now() - v_calc.new_last_key_at))))::int end);
end;
$$;
grant execute on function public.guild_tech_attempt_status() to authenticated;

commit;

-- POSTCHECK (manuell, im SQL Editor, nach dem Ausführen):
-- select * from public.dungeon_regen_calc(3::smallint, now() - interval '5 hours');
--   -> muss OHNE "function does not exist" durchlaufen (beweist die reale Signatur).
-- Danach im Spiel: Gilden-Technologie-Tab öffnen - "Beitragsversuche heute"
-- sollte sofort eine echte Zahl zeigen statt "wird geladen…", und ein
-- Beitrag zu einem Knoten sollte wieder tatsächlich Fortschritt erzeugen.
