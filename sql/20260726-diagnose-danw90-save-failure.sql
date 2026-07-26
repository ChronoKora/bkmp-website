-- Bkmp - REIN LESENDE Diagnose (26.07.2026, Spieler-Meldung "Danw_90 kommt
-- ueber Level 2000 nicht raus", Konsolen-Beweis: wiederholte 400er auf
-- PATCH .../idle_player_state, "Idle Dorf: Speichern fehlgeschlagen" im
-- Dauerloop, dazu ein 502 auf /api/claim-idle-offline-progress).
--
-- Arbeitstheorie (per Code-Lektuere, NICHT per Live-Daten bestaetigt):
-- upsertIdlePlayerState() (supabase.js) rundet vor jedem Speichern alle
-- bigint/integer-Spalten hart (BKMP_IDLE_STATE_INTEGER_COLUMNS,
-- Math.round) - das faengt NICHT-ganzzahlige Werte ab, aber NICHT den Fall
-- NaN/Infinity: Math.round(NaN)=NaN, Math.round(Infinity)=Infinity, und
-- JSON.stringify() serialisiert beides als "null" - bei einer NOT-NULL-
-- Spalte (JEDE Spalte hier ist NOT NULL) erzeugt das serverseitig einen
-- Constraint-Fehler, den PostgREST als 400 Bad Request zurueckgibt, exakt
-- passend zum gemeldeten Symptom. Die 8 "numeric"-Spalten (attack/defense/
-- hp/crit_chance/crit_damage/gold_bonus/xp_bonus/loot_bonus) sind dabei ein
-- moeglicher URSPRUNG: Postgres' numeric-Typ kann (anders als bigint/
-- integer) den Sonderwert 'NaN' tatsaechlich SPEICHERN - ein frueherer,
-- erfolgreicher Speichervorgang koennte also unbemerkt bereits eine
-- NaN-Zahl abgelegt haben. Wird dieser Wert beim naechsten Laden zurueck
-- in eine Rechnung eingespeist (z.B. Kampfschaden, Ressourcenertrag), kann
-- daraus ueber mehrere Rechenschritte hinweg eine NaN/Infinity-Kaskade in
-- EINER der bigint-Spalten (gold/xp/...) entstehen - das wuerde JEDEN
-- weiteren Speicherversuch treffen, nicht nur einen einzelnen Aufruf, und
-- erklaert damit den beobachteten Dauerloop.
--
-- Diese Datei aendert NICHTS - reines SELECT. Bitte im Supabase Dashboard
-- > SQL Editor ausfuehren und das Ergebnis zurueckmelden (Screenshot/Text
-- reicht) - danach kann die tatsaechliche Ursache gezielt gefixt werden,
-- statt auf gut Glueck etwas zu aendern.

select
  name_key, display_name, level, xp, gold, total_gold_earned,
  attack, defense, hp, crit_chance, crit_damage, gold_bonus, xp_bonus, loot_bonus,
  current_dragon_index, highest_dragon_index, dragon_kills, boss_kills,
  village_defeats, yaksha_boss_kills, playtime_seconds, updated_at, last_seen_at,
  -- Direkte NaN-Pruefung auf allen 8 numeric-Spalten (Postgres kann 'NaN' echt speichern):
  (attack::text = 'NaN') as attack_is_nan,
  (defense::text = 'NaN') as defense_is_nan,
  (hp::text = 'NaN') as hp_is_nan,
  (crit_chance::text = 'NaN') as crit_chance_is_nan,
  (crit_damage::text = 'NaN') as crit_damage_is_nan,
  (gold_bonus::text = 'NaN') as gold_bonus_is_nan,
  (xp_bonus::text = 'NaN') as xp_bonus_is_nan,
  (loot_bonus::text = 'NaN') as loot_bonus_is_nan
from public.idle_player_state
where name_key = 'danw_90';

-- Ergaenzend: Skilltree-/Runen-Zustand, falls die numeric-Werte oben
-- unauffaellig sind (Kandidat fuer eine andere Fehlerquelle, z.B. eine
-- kaputte skill_allocations/upgrade_purchases-JSON-Struktur):
select skill_allocations, upgrade_purchases, last_offline_claim
from public.idle_player_state
where name_key = 'danw_90';
