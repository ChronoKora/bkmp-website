-- Bkmp - Anti-Cheat-Guard erweitert: Level/Skillpunkte werden jetzt UNABHAENGIG
-- von dragon_kills geprueft (Spieler-Meldung 09.08.2026, Feedback-Board-
-- Screenshots: Account mit "9999999 Skillpunkte" + oeffentliche Bestenliste
-- mit "Level 846473"/"Level 29652"/"Level 21545" - allesamt weit jenseits
-- jeder legitimen Reichweite).
--
-- ROOT CAUSE (bestaetigt, nicht nur vermutet - per Lesen von
-- sql/20260730-idle-player-state-anticheat-guard.sql): der bestehende
-- Trigger idle_player_state_anticheat_guard() daempft Level/Skillpunkte/Gold/
-- Ressourcen NUR, wenn ZUERST ein implausibler dragon_kills-Zuwachs erkannt
-- wird (siehe "if v_claimed_kills_delta > v_max_kills_delta then ..." - die
-- GESAMTE Daempfungslogik steckt in diesem einen if-Block). Ein gefaelschtes
-- UPDATE, das gezielt NUR skill_points_available/level setzt und
-- dragon_kills unveraendert laesst (z. B. direkter Aufruf des Browser-
-- Supabase-Clients aus der Entwicklerkonsole, oder ein Netzwerk-Interceptor -
-- "Cheat Engine" im urspruenglichen Bug-Report meint hier vermutlich einen
-- Wert- oder Netzwerk-Manipulator, kein klassisches Prozess-Memory-Patching,
-- da dies ein Browser-Spiel ist), loeste den Trigger nie aus - dragon_kills
-- selbst ist zwar weiterhin korrekt gedeckelt, aber JEDES ANDERE Feld war
-- bei unveraendertem dragon_kills faktisch ungeprueft beschreibbar. Bestaetigt
-- per Schema-Check: idle_player_state.skill_points_available hat ausserhalb
-- dieses Triggers ueberhaupt KEINE eigene CHECK-Bedingung (nur "integer not
-- null default 0", jeder Wert bis zum int4-Maximum war zulaessig).
--
-- FIX: zwei weitere, UNABHAENGIGE Plausibilitaets-Signale (Level-Zuwachs,
-- Skillpunkte-GESAMT-Zuwachs) nutzen dieselbe bereits bewaehrte, echte-
-- Wanduhrzeit-basierte Budget-Logik wie der bestehende dragon_kills-Check -
-- ausgeloest wird jetzt bei JEDEM der drei Signale, nicht nur bei kills.
-- v_ratio ist danach das STRENGSTE (kleinste) der ausgeloesten Verhaeltnisse
-- und wird weiterhin auf ALLE ansteigenden Fortschritts-Felder gemeinsam
-- angewendet (gleiche bewusste Vereinfachung wie beim urspruenglichen Design -
-- keine Neuberechnung der echten Belohnungsformel je Feld).
--
-- Level-Budget = elapsed_seconds * 3 (dieselbe, bereits fuer dragon_kills
-- bewiesene Obergrenze - im normalen Tick-Kampf-Pfad kann ein Level-Aufstieg
-- rechnerisch nie schneller als ein Kill erfolgen, da XP nur pro Kill
-- vergeben wird) PLUS ein groszuegiger fester Puffer von 500 Stufen/Punkten
-- pro Speichervorgang. Der Puffer ist bewusst NICHT praezise hergeleitet
-- (Dungeon-/Turm-Laeufe vergeben XP unabhaengig von dragon_kills in einem
-- einzigen Sammel-Update, siehe bkmpDungeonGrantReward()/bkmp-tower.js -
-- ein exaktes Maximum je Account-Staerke zu berechnen waere fehleranfaellig)
-- - er ist stattdessen bewusst so grosszuegig gewaehlt, dass er JEDE
-- plausible Kombination aus Dungeon-/Turm-/Offline-Belohnungen in einem
-- einzelnen Speichervorgang locker abdeckt, dabei aber immer noch um den
-- Faktor >1000 unter den gemeldeten Missbrauchswerten liegt (846.473 bzw.
-- 9.999.999) - Praezision ist hier nicht noetig, nur eine grosse Sicherheits-
-- marge in beide Richtungen.
--
-- Skillpunkte-Sonderfall (wichtig, sonst wuerde ein legitimes Feature kaputt
-- gehen): das Skilltree-"Zuruecksetzen" verschiebt bereits ausgegebene Punkte
-- zurueck in skill_points_available (skill_points_available += skill_points_spent,
-- skill_points_spent := 0 - siehe js/systems/bkmp-skilltree.js) - das kann
-- bei einem sehr weit ausgebauten Account einen grossen EINZELNEN Zuwachs von
-- skill_points_available erzeugen, OHNE dass echte neue Punkte entstehen (nur
-- eine Umbuchung zwischen zwei Spalten, die GESAMTSUMME bleibt gleich). Eine
-- naive "skill_points_available darf nicht schneller wachsen als X" -Regel
-- wuerde dieses legitime Feature faelschlich blockieren. Deshalb wird
-- ausschliesslich die SUMME (skill_points_available + skill_points_spent)
-- geprueft - eine reine Umverteilung aendert die Summe nicht und loest daher
-- nie aus, ein tatsaechlich aus dem Nichts erzeugter Punktezuwachs (der
-- gemeldete Fall) aendert die Summe dagegen sehr wohl und wird erkannt.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich. Ersetzt den bestehenden
-- Trigger vollstaendig (create or replace function) - sql/20260730-idle-
-- player-state-anticheat-guard.sql muss NICHT vorher/nachher separat erneut
-- ausgefuehrt werden, diese Datei enthaelt bereits die komplette, aktuelle
-- Fassung.

alter table public.idle_anticheat_flags add column if not exists triggered_by text;
alter table public.idle_anticheat_flags add column if not exists claimed_level_delta numeric;
alter table public.idle_anticheat_flags add column if not exists allowed_level_delta numeric;
alter table public.idle_anticheat_flags add column if not exists claimed_skillpoints_delta numeric;
alter table public.idle_anticheat_flags add column if not exists allowed_skillpoints_delta numeric;
alter table public.idle_anticheat_flags add column if not exists old_skill_points_available integer;
alter table public.idle_anticheat_flags add column if not exists new_skill_points_available_claimed integer;

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
  v_burst_buffer constant numeric := 500; -- siehe Datei-Kopf-Kommentar
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

  if v_ratio < 1 then
    insert into public.idle_anticheat_flags (
      name_key, claimed_dragon_kills_delta, allowed_dragon_kills_delta, elapsed_seconds, ratio_applied,
      old_dragon_kills, new_dragon_kills_claimed, old_level, new_level_claimed,
      triggered_by, claimed_level_delta, allowed_level_delta, claimed_skillpoints_delta, allowed_skillpoints_delta,
      old_skill_points_available, new_skill_points_available_claimed
    ) values (
      NEW.name_key, v_claimed_kills_delta, v_max_kills_delta, v_elapsed_seconds, v_ratio,
      OLD.dragon_kills, NEW.dragon_kills, OLD.level, NEW.level,
      array_to_string(v_triggered_by, ','), v_claimed_level_delta, v_max_level_delta, v_claimed_skillpoints_delta, v_max_skillpoints_delta,
      OLD.skill_points_available, NEW.skill_points_available
    );

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

    -- Skillpunkte: die GESAMTE v_ratio gilt auch hier, nicht nur wenn
    -- ausgerechnet das Skillpunkte-Signal selbst ausgeloest hat (sonst
    -- wuerde z.B. ein durch dragon_kills ausgeloester Kuerzungsfaktor
    -- faelschlich NICHT auf mitgemeldete Skillpunkte angewendet - genau
    -- dieser Bug wurde beim eigenen Testen der ersten Fassung dieser Datei
    -- gefunden: der bereits bestehende Kills-Regressionstest schlug fehl,
    -- weil skill_points_available bei einem rein kills-getriebenen v_ratio
    -- unveraendert durchgereicht wurde). Skaliert wird aber NUR der NETTO-
    -- NEUE Anteil (v_claimed_skillpoints_delta > 0 heisst "per Saldo wurden
    -- neue Punkte behauptet") - eine reine Umbuchung zwischen available/
    -- spent (Delta <= 0) bleibt IMMER unangetastet, unabhaengig vom Betrag
    -- (siehe Datei-Kopf-Kommentar, Skilltree-Zuruecksetzen-Fall).
    if v_claimed_skillpoints_delta > 0 then
      v_allowed_new_skillpoints := floor(v_claimed_skillpoints_delta * v_ratio);
      NEW.skill_points_available := greatest(0, NEW.skill_points_available - ceil(v_claimed_skillpoints_delta - v_allowed_new_skillpoints));
    end if;
  end if;

  return NEW;
end;
$$;

-- Trigger selbst ist unveraendert (zeigt bereits auf die obige Funktion,
-- "create or replace function" reicht - kein "drop trigger"/"create trigger"
-- noetig, da Name/Definition gleich bleiben). Nur zur Sicherheit erneut
-- sichergestellt, falls der Trigger aus irgendeinem Grund fehlen sollte:
drop trigger if exists idle_player_state_anticheat_guard_trigger on public.idle_player_state;
create trigger idle_player_state_anticheat_guard_trigger
before update on public.idle_player_state
for each row execute function public.idle_player_state_anticheat_guard();
