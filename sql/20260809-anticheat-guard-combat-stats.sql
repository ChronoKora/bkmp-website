-- Bkmp - Anti-Cheat-Guard erweitert um Kampfwerte (Spieler "OPShadowWolf" hat
-- am 09.08.2026 selbst 3 Videos geschickt, die vorfuehren, wie sein LIVE-
-- Account auf bkinvestment.de mit einem Angriffswert von "420.45M" (siehe
-- HUD im Video) jeden Boss instant mit Schadenszahlen wie "-16500008073!"
-- besiegt und Stufe fuer Stufe in Sekunden durchraeumt - Prestige-Level war
-- dabei nur 16 (frueher Fortschritt, keinesfalls genug legitime Investition
-- fuer diese Groessenordnung).
--
-- ROOT CAUSE (bestaetigt per Code-Lesen, nicht nur aus dem Video vermutet):
-- BKMP_IDLE_PLAYER_STATE_COLUMNS (supabase.js) sendet bei JEDER Speicherung
-- ZUSAETZLICH zu den bereits geschuetzten Feldern auch attack, defense, hp,
-- crit_chance, crit_damage, gold_bonus, xp_bonus, loot_bonus mit - acht
-- weitere, komplett ungeschuetzte Zahlenspalten ohne jede CHECK-Bedingung
-- (bestaetigt per Schema-Durchsuchung: keine einzige Zeile in sql/*.sql
-- begrenzt deren Wertebereich). Der bisherige Trigger (30.07./09.08. Level-
-- /Skillpunkte-Erweiterung) prueft diese acht Felder ueberhaupt nicht -
-- exakt dieselbe Bug-Klasse wie der bereits gefundene Level-/Skillpunkte-
-- Fall, nur an einer anderen Stelle derselben Tabelle.
--
-- WARUM HIER EIN ANDERER ANSATZ ALS BEI KILLS/LEVEL/SKILLPUNKTE NOETIG IST:
-- Kills/Level/Skillpunkte wachsen ueber ECHTE VERSTRICHENE ZEIT (mehr Zeit =
-- mehr moeglicher Zuwachs) - dafuer passt ein zeitbasiertes Budget perfekt.
-- Kampfwerte sind dagegen KEIN Zeit-Akkumulator, sondern eine bei JEDER
-- Aenderung (Level-Aufstieg, Skillpunkt ausgegeben, Rune aufgewertet, Titel
-- ausgeruestet, Upgrade gekauft) neu BERECHNETE Momentaufnahme - ein
-- legitimer Sprung kann voellig zurecht INSTANT passieren (z. B. ein
-- einzelner starker Rune-Fund verdoppelt den Angriff sofort). Ein
-- zeitbasiertes Budget waere hier also entweder zu streng (blockiert
-- legitime grosse Einzelspruenge) oder - wenn grosszuegig genug fuer
-- legitime Spruenge - zu locker fuer den gemeldeten Fall. Die tatsaechliche
-- Belohnungsformel (haengt von Level/Skilltree/Prestige/Runen/Titeln/
-- Gilden-Tech ab, mehrfach ueberarbeitet) serverseitig nachzubauen waere
-- fehleranfaellig und wurde bewusst vermieden (gleiche Begruendung wie beim
-- dragon_kills-Ansatz selbst: Rate/Verhaeltnis statt exakter Formel).
--
-- STATTDESSEN: eine harte, bewusst SEHR grosszuegige MULTIPLIKATOR-Obergrenze
-- pro einzelner Speicherung (Faktor 50 + fester Sockel 1000) - unabhaengig
-- von verstrichener Zeit, weil ein legitimer Sprung ja augenblicklich
-- passieren darf. Faktor 50 heisst: der Wert darf sich in EINER einzigen
-- Speicherung mehr als verfuenfzigfachen, plus ein Sockel von 1000 fuer den
-- Sprung aus einem sehr niedrigen/neuen Ausgangswert. Der gemeldete Fall
-- zeigte einen Sprung von grob 130.000 auf 420.450.000 (Faktor ~3230) -
-- selbst mit dieser bewusst grosszuegigen Grenze (Faktor 50) bleibt eine
-- riesige Sicherheitsmarge in beide Richtungen: kein legitimer Spieler
-- verfuenfzigfacht ALLE Kampfwerte gleichzeitig in einer einzigen
-- Speicherung, aber ein einzelner grosser legitimer Sprung in EINEM Wert
-- (z. B. nur der Angriff durch einen seltenen Rune-Fund) bleibt erlaubt.
--
-- Anders als bei Kills/Level/Skillpunkte wird hier NICHT proportional
-- herunterskaliert (kein v_ratio), sondern der Wert direkt hart auf die
-- Obergrenze gekappt - einfacher zu pruefen/testen, keine Interaktion mit
-- der bestehenden Ratio-Logik noetig.
--
-- Baut auf sql/20260730-idle-player-state-anticheat-guard.sql UND
-- sql/20260809-anticheat-guard-independent-fields.sql auf (ersetzt die
-- Trigger-Funktion erneut vollstaendig - enthaelt bereits alles aus beiden
-- vorigen Dateien, diese muessen NICHT zusaetzlich erneut ausgefuehrt werden,
-- wurden aber vorausgesetzt fuer idle_anticheat_flags/die Grundstruktur).
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.idle_anticheat_flags add column if not exists combat_stat_details jsonb;

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
  -- Kampfwerte (09.08., neu):
  v_max_stat_growth_factor constant numeric := 50;
  v_stat_growth_floor constant numeric := 1000;
  v_combat_stat_details jsonb := '{}'::jsonb;
  v_combat_stat_triggered boolean := false;
  v_stat_cap numeric;
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

  -- ---------------- Kampfwerte: harte Multiplikator-Obergrenze (09.08., neu) ----------------
  -- Acht Felder, jedes einzeln geprueft, unabhaengig von v_ratio oben (siehe
  -- Datei-Kopf-Kommentar fuer die Begruendung). Bewusst als acht fast
  -- identische Bloecke statt einer dynamischen Schleife - gleicher Stil wie
  -- die bereits bestehenden Kills/Gold/Ressourcen-Zeilen weiter unten,
  -- leichter zu lesen/pruefen als generische SQL.
  if NEW.attack > OLD.attack * v_max_stat_growth_factor + v_stat_growth_floor then
    v_stat_cap := OLD.attack * v_max_stat_growth_factor + v_stat_growth_floor;
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('attack', jsonb_build_object('old', OLD.attack, 'claimed', NEW.attack, 'capped_to', v_stat_cap));
    NEW.attack := v_stat_cap;
    v_combat_stat_triggered := true;
  end if;
  if NEW.defense > OLD.defense * v_max_stat_growth_factor + v_stat_growth_floor then
    v_stat_cap := OLD.defense * v_max_stat_growth_factor + v_stat_growth_floor;
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('defense', jsonb_build_object('old', OLD.defense, 'claimed', NEW.defense, 'capped_to', v_stat_cap));
    NEW.defense := v_stat_cap;
    v_combat_stat_triggered := true;
  end if;
  if NEW.hp > OLD.hp * v_max_stat_growth_factor + v_stat_growth_floor then
    v_stat_cap := OLD.hp * v_max_stat_growth_factor + v_stat_growth_floor;
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('hp', jsonb_build_object('old', OLD.hp, 'claimed', NEW.hp, 'capped_to', v_stat_cap));
    NEW.hp := v_stat_cap;
    v_combat_stat_triggered := true;
  end if;
  -- crit_chance/crit_damage/*_bonus sind Prozentwerte, nicht additive
  -- Ressourcen - derselbe Multiplikator-Ansatz funktioniert trotzdem, weil
  -- er relativ (Faktor vom alten Wert) statt absolut ist. Sockel bewusst
  -- niedriger (100 statt 1000) - ein Prozentwert faengt nie annaehernd bei
  -- Zehntausenden an, ein zu grosser Sockel wuerde hier die Obergrenze
  -- bedeutungslos machen.
  if NEW.crit_chance > OLD.crit_chance * v_max_stat_growth_factor + 100 then
    v_stat_cap := OLD.crit_chance * v_max_stat_growth_factor + 100;
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('crit_chance', jsonb_build_object('old', OLD.crit_chance, 'claimed', NEW.crit_chance, 'capped_to', v_stat_cap));
    NEW.crit_chance := v_stat_cap;
    v_combat_stat_triggered := true;
  end if;
  if NEW.crit_damage > OLD.crit_damage * v_max_stat_growth_factor + 100 then
    v_stat_cap := OLD.crit_damage * v_max_stat_growth_factor + 100;
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('crit_damage', jsonb_build_object('old', OLD.crit_damage, 'claimed', NEW.crit_damage, 'capped_to', v_stat_cap));
    NEW.crit_damage := v_stat_cap;
    v_combat_stat_triggered := true;
  end if;
  if NEW.gold_bonus > OLD.gold_bonus * v_max_stat_growth_factor + 100 then
    v_stat_cap := OLD.gold_bonus * v_max_stat_growth_factor + 100;
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('gold_bonus', jsonb_build_object('old', OLD.gold_bonus, 'claimed', NEW.gold_bonus, 'capped_to', v_stat_cap));
    NEW.gold_bonus := v_stat_cap;
    v_combat_stat_triggered := true;
  end if;
  if NEW.xp_bonus > OLD.xp_bonus * v_max_stat_growth_factor + 100 then
    v_stat_cap := OLD.xp_bonus * v_max_stat_growth_factor + 100;
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('xp_bonus', jsonb_build_object('old', OLD.xp_bonus, 'claimed', NEW.xp_bonus, 'capped_to', v_stat_cap));
    NEW.xp_bonus := v_stat_cap;
    v_combat_stat_triggered := true;
  end if;
  if NEW.loot_bonus > OLD.loot_bonus * v_max_stat_growth_factor + 100 then
    v_stat_cap := OLD.loot_bonus * v_max_stat_growth_factor + 100;
    v_combat_stat_details := v_combat_stat_details || jsonb_build_object('loot_bonus', jsonb_build_object('old', OLD.loot_bonus, 'claimed', NEW.loot_bonus, 'capped_to', v_stat_cap));
    NEW.loot_bonus := v_stat_cap;
    v_combat_stat_triggered := true;
  end if;

  if v_ratio < 1 or v_combat_stat_triggered then
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
