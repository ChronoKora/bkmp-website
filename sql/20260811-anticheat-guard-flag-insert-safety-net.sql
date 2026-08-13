-- Bkmp - DRINGEND: Spieler "OPShadowWolf" kann seit dem Ausfuehren von
-- sql/20260811-anticheat-guard-absolute-ceiling.sql GAR NICHT MEHR speichern
-- (Screenshot: wiederholte PATCH .../idle_player_state-Fehlschlaege,
-- HTTP 400, Postgres-Code 22P02 "malformed array literal: \"dragon_kills\"").
--
-- URSACHE NOCH NICHT ZWEIFELSFREI GEKLAERT (ehrlich, kein DB-Schreib-/SQL-
-- Ausfuehrungszugriff fuer diese Session, kann die echte Spalten-Definition
-- nicht direkt einsehen - PostgRESTs OpenAPI-Schema ist fuer anon leer,
-- idle_anticheat_flags selbst per RLS nicht anonym lesbar). Staerkste
-- Arbeitshypothese: die Spalte idle_anticheat_flags.triggered_by wurde
-- irgendwann (moeglicherweise durch einen fruehen, nie dokumentierten
-- Entwurf) als ARRAY-Typ statt als text angelegt - `alter table ... add
-- column if not exists triggered_by text` (sql/20260809-anticheat-guard-
-- independent-fields.sql) haette das NICHT nachtraeglich korrigiert (der
-- Befehl ist ein No-Op, sobald die Spalte schon existiert, egal mit
-- welchem Typ). array_to_string(...) liefert einen reinen Text wie
-- "dragon_kills" (ohne { }-Klammern) - beim impliziten Cast in eine
-- ARRAY-Spalte scheitert Postgres' Array-Literal-Parser daran exakt mit der
-- gemeldeten Fehlermeldung. Trotzdem NICHT zu 100% bestaetigt - siehe
-- sql/20260811-diagnose-triggered-by-column-type.sql fuer eine rein
-- lesende Pruefung, die das endgueltig klaert.
--
-- WICHTIGER, UNABHAENGIGER FIX (der eigentliche Sinn dieser Datei): egal
-- was die genaue Ursache ist - ein Bug in der reinen ALARM-PROTOKOLLIERUNG
-- darf NIEMALS die eigentliche Spielstand-Speicherung blockieren koennen.
-- Das war bisher strukturell moeglich (INSERT in idle_anticheat_flags lief
-- ungeschuetzt VOR dem "return NEW" - eine Exception dort brach die GESAMTE
-- UPDATE-Transaktion ab, inkl. des voellig unabhaengigen, eigentlich
-- erfolgreichen Kappungs-/Speicherversuchs). Jetzt in einen eigenen
-- BEGIN/EXCEPTION-Block gepackt - schlaegt die Protokollierung fehl (aus
-- welchem Grund auch immer, jetzt oder in Zukunft), wird das nur intern
-- verworfen (kein Logging-Ziel vorhanden fuer PL/pgSQL-WARNING in
-- Supabase, daher bewusst "when others then null" statt raise warning -
-- der Fehlerfall ist ohnehin selten/anomal, keine zusaetzliche Ausgabe
-- noetig) - der eigentliche Speichervorgang (inkl. der bereits erfolgten
-- Kappung von dragon_kills/level/Kampfwerten) laeuft immer normal weiter.
-- Gleiches Sicherheitsprinzip wie an vielen anderen Stellen in diesem
-- Projekt bereits etabliert ("Ladevorgang darf nie durch ein Nebensystem
-- blockiert werden", siehe idledorf.js-Kommentare zu Runen/Dorf-Skins/
-- Event-Drachen beim Laden).
--
-- ZUSAETZLICH (defensiv, deckt die Arbeitshypothese ab, aber schadlos auch
-- falls sie falsch ist): erzwingt den Spaltentyp von triggered_by explizit
-- auf text, egal was er aktuell ist. Ist er bereits text, ist das ein
-- reiner No-Op-aehnlicher Identitaets-Cast. War er tatsaechlich ein Array-
-- Typ, wird er jetzt sauber (mit den vorhandenen Werten, kein Datenverlust)
-- auf text umgestellt.
--
-- Baut auf allen vorherigen Anti-Cheat-Dateien auf (30.07./09.08.x3/11.08.-
-- absolute-ceiling). Ersetzt die Funktion erneut vollstaendig.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'idle_anticheat_flags'
      and column_name = 'triggered_by' and data_type <> 'text'
  ) then
    alter table public.idle_anticheat_flags alter column triggered_by type text using triggered_by::text;
  end if;
end $$;

create or replace function public.idle_player_state_anticheat_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elapsed_seconds numeric;
  v_max_kills_per_second constant numeric := 3;
  v_min_elapsed_seconds constant numeric := 4;
  v_burst_buffer constant numeric := 500;
  v_max_kills_delta numeric;
  v_max_level_delta numeric;
  v_max_skillpoints_delta numeric;
  v_claimed_kills_delta numeric;
  v_claimed_level_delta numeric;
  v_old_skillpoints_total numeric;
  v_new_skillpoints_total numeric;
  v_claimed_skillpoints_delta numeric;
  v_allowed_new_skillpoints numeric;
  v_ratio_kills numeric := 1;
  v_ratio_level numeric := 1;
  v_ratio_skillpoints numeric := 1;
  v_ratio numeric;
  v_triggered_by text[] := '{}';
  v_ceiling_attack constant numeric := 1000000;
  v_ceiling_defense constant numeric := 1000000;
  v_ceiling_hp constant numeric := 2000000;
  v_ceiling_crit_chance constant numeric := 100;
  v_ceiling_crit_damage constant numeric := 5000;
  v_ceiling_gold_bonus constant numeric := 10000;
  v_ceiling_xp_bonus constant numeric := 10000;
  v_ceiling_loot_bonus constant numeric := 10000;
  v_combat_stat_details jsonb := '{}'::jsonb;
  v_combat_stat_triggered boolean := false;
begin
  if TG_OP <> 'UPDATE' then
    return NEW;
  end if;

  v_elapsed_seconds := greatest(v_min_elapsed_seconds, extract(epoch from (now() - coalesce(OLD.updated_at, now()))));
  v_max_kills_delta := v_elapsed_seconds * v_max_kills_per_second;
  v_max_level_delta := v_elapsed_seconds * v_max_kills_per_second + v_burst_buffer;
  v_max_skillpoints_delta := v_max_level_delta;

  v_claimed_kills_delta := coalesce(NEW.dragon_kills, OLD.dragon_kills) - coalesce(OLD.dragon_kills, 0);
  if v_claimed_kills_delta > v_max_kills_delta then
    v_ratio_kills := v_max_kills_delta / v_claimed_kills_delta;
    v_triggered_by := v_triggered_by || 'dragon_kills';
  end if;

  v_claimed_level_delta := coalesce(NEW.level, OLD.level) - coalesce(OLD.level, 0);
  if v_claimed_level_delta > v_max_level_delta then
    v_ratio_level := v_max_level_delta / v_claimed_level_delta;
    v_triggered_by := v_triggered_by || 'level';
  end if;

  v_old_skillpoints_total := coalesce(OLD.skill_points_available, 0) + coalesce(OLD.skill_points_spent, 0);
  v_new_skillpoints_total := coalesce(NEW.skill_points_available, 0) + coalesce(NEW.skill_points_spent, 0);
  v_claimed_skillpoints_delta := v_new_skillpoints_total - v_old_skillpoints_total;
  if v_claimed_skillpoints_delta > v_max_skillpoints_delta then
    v_ratio_skillpoints := v_max_skillpoints_delta / v_claimed_skillpoints_delta;
    v_triggered_by := v_triggered_by || 'skill_points';
  end if;

  v_ratio := least(v_ratio_kills, v_ratio_level, v_ratio_skillpoints);

  -- ---------------- Kampfwerte: absolute Obergrenze (11.08.) ----------------
  if NEW.attack > v_ceiling_attack then
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('attack', jsonb_build_object('old', OLD.attack, 'claimed', NEW.attack, 'capped_to', v_ceiling_attack));
    NEW.attack := v_ceiling_attack;
    v_combat_stat_triggered := true;
  end if;
  if NEW.defense > v_ceiling_defense then
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('defense', jsonb_build_object('old', OLD.defense, 'claimed', NEW.defense, 'capped_to', v_ceiling_defense));
    NEW.defense := v_ceiling_defense;
    v_combat_stat_triggered := true;
  end if;
  if NEW.hp > v_ceiling_hp then
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('hp', jsonb_build_object('old', OLD.hp, 'claimed', NEW.hp, 'capped_to', v_ceiling_hp));
    NEW.hp := v_ceiling_hp;
    v_combat_stat_triggered := true;
  end if;
  if NEW.crit_chance > v_ceiling_crit_chance then
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('crit_chance', jsonb_build_object('old', OLD.crit_chance, 'claimed', NEW.crit_chance, 'capped_to', v_ceiling_crit_chance));
    NEW.crit_chance := v_ceiling_crit_chance;
    v_combat_stat_triggered := true;
  end if;
  if NEW.crit_damage > v_ceiling_crit_damage then
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('crit_damage', jsonb_build_object('old', OLD.crit_damage, 'claimed', NEW.crit_damage, 'capped_to', v_ceiling_crit_damage));
    NEW.crit_damage := v_ceiling_crit_damage;
    v_combat_stat_triggered := true;
  end if;
  if NEW.gold_bonus > v_ceiling_gold_bonus then
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('gold_bonus', jsonb_build_object('old', OLD.gold_bonus, 'claimed', NEW.gold_bonus, 'capped_to', v_ceiling_gold_bonus));
    NEW.gold_bonus := v_ceiling_gold_bonus;
    v_combat_stat_triggered := true;
  end if;
  if NEW.xp_bonus > v_ceiling_xp_bonus then
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('xp_bonus', jsonb_build_object('old', OLD.xp_bonus, 'claimed', NEW.xp_bonus, 'capped_to', v_ceiling_xp_bonus));
    NEW.xp_bonus := v_ceiling_xp_bonus;
    v_combat_stat_triggered := true;
  end if;
  if NEW.loot_bonus > v_ceiling_loot_bonus then
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('loot_bonus', jsonb_build_object('old', OLD.loot_bonus, 'claimed', NEW.loot_bonus, 'capped_to', v_ceiling_loot_bonus));
    NEW.loot_bonus := v_ceiling_loot_bonus;
    v_combat_stat_triggered := true;
  end if;

  -- ---------------- NEU (11.08., Sicherheitsnetz): Protokollierung darf nie
  -- die eigentliche Speicherung blockieren, egal welcher Fehler dabei
  -- auftritt - siehe Datei-Kopf-Kommentar. ----------------
  if v_ratio < 1 or v_combat_stat_triggered then
    begin
      insert into public.idle_anticheat_flags (
        name_key, claimed_dragon_kills_delta, allowed_dragon_kills_delta, elapsed_seconds, ratio_applied,
        old_dragon_kills, new_dragon_kills_claimed, old_level, new_level_claimed,
        triggered_by, claimed_level_delta, allowed_level_delta, claimed_skillpoints_delta, allowed_skillpoints_delta,
        old_skill_points_available, new_skill_points_available_claimed, combat_stat_details
      ) values (
        NEW.name_key, v_claimed_kills_delta, v_max_kills_delta, v_elapsed_seconds, v_ratio,
        OLD.dragon_kills, NEW.dragon_kills, OLD.level, NEW.level,
        array_to_string(case when v_combat_stat_triggered then v_triggered_by || 'combat_stats' else v_triggered_by end, ','),
        v_claimed_level_delta, v_max_level_delta, v_claimed_skillpoints_delta, v_max_skillpoints_delta,
        OLD.skill_points_available, NEW.skill_points_available,
        case when v_combat_stat_triggered then v_combat_stat_details else null end
      );
    exception when others then
      null;
    end;
  end if;

  if v_ratio < 1 then
    -- Nur ansteigende Deltas kappen, fallende (Ausgeben/Prestige) unangetastet lassen.
    if NEW.dragon_kills > OLD.dragon_kills then NEW.dragon_kills := OLD.dragon_kills + floor((NEW.dragon_kills - OLD.dragon_kills) * v_ratio); end if;
    if NEW.boss_kills > OLD.boss_kills then NEW.boss_kills := OLD.boss_kills + floor((NEW.boss_kills - OLD.boss_kills) * v_ratio); end if;
    if NEW.gold > OLD.gold then NEW.gold := OLD.gold + floor((NEW.gold - OLD.gold) * v_ratio); end if;
    if NEW.total_gold_earned > OLD.total_gold_earned then NEW.total_gold_earned := OLD.total_gold_earned + floor((NEW.total_gold_earned - OLD.total_gold_earned) * v_ratio); end if;
    if NEW.wood > OLD.wood then NEW.wood := OLD.wood + floor((NEW.wood - OLD.wood) * v_ratio); end if;
    if NEW.stone > OLD.stone then NEW.stone := OLD.stone + floor((NEW.stone - OLD.stone) * v_ratio); end if;
    if NEW.crystals > OLD.crystals then NEW.crystals := OLD.crystals + floor((NEW.crystals - OLD.crystals) * v_ratio); end if;
    if NEW.essence > OLD.essence then NEW.essence := OLD.essence + floor((NEW.essence - OLD.essence) * v_ratio); end if;
    if NEW.xp > OLD.xp then NEW.xp := OLD.xp + floor((NEW.xp - OLD.xp) * v_ratio); end if;
    if NEW.level > OLD.level then NEW.level := OLD.level + floor((NEW.level - OLD.level) * v_ratio); end if;

    if v_claimed_skillpoints_delta > 0 then
      v_allowed_new_skillpoints := floor(v_claimed_skillpoints_delta * v_ratio);
      NEW.skill_points_available := greatest(0, NEW.skill_points_available - ceil(v_claimed_skillpoints_delta - v_allowed_new_skillpoints));
    end if;
  end if;

  return NEW;
end;
$$;

-- Trigger selbst unveraendert (zeigt bereits auf die obige Funktion).
drop trigger if exists idle_player_state_anticheat_guard_trigger on public.idle_player_state;
create trigger idle_player_state_anticheat_guard_trigger
before update on public.idle_player_state
for each row execute function public.idle_player_state_anticheat_guard();
