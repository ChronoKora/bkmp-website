-- Bkmp - Anti-Cheat Stufe 1: AUSWERTUNG der Wirtschafts-Pruefung (07.10.2026).
-- REIN LESEND - veraendert nichts. Im Supabase-Dashboard > SQL Editor ausfuehren, NACHDEM
-- sql/20261007-anticheat-economy-guard.sql einige Tage im Meldemodus (enforce=false) gelaufen ist.
-- Jede Abfrage einzeln markieren und mit "Run" ausfuehren (oder alles zusammen: dann zeigt
-- der Editor nur das Ergebnis der letzten).
--
-- WIE LESEN: "Auslastung" = Zuwachs einer Speicherung / verfuegbares Guthaben. 0,3 = die
-- groesste einzelne Speicherung hat 30 % des Erlaubten verbraucht, 1,0 = Grenze erreicht,
-- ueber 1 = Verstoss. Ehrliche Spieler sollten weit unter 1 bleiben. Liegt das 99-%-Perzentil
-- (Abfrage 2) deutlich unter 1 und Abfrage 3 zeigt nur Konten, die wirklich auffaellig sind,
-- kann in idle_anticheat_settings 'economy' enforce=true gesetzt werden (siehe unten).

-- ---------------------------------------------------------------------------------
-- 1) Ueberblick: wie viele Konten werden gefuehrt, wie viele haben einen Verstoss?
-- ---------------------------------------------------------------------------------
select
  count(*)                                                   as konten,
  count(*) filter (where violations > 0)                     as konten_mit_verstoss,
  coalesce(sum(violations), 0)                               as verstoesse_gesamt,
  count(*) filter (where greatest(peak_gold, peak_wood, peak_stone, peak_crystals, peak_essence, peak_xp) >= 0.8) as konten_ueber_80_prozent,
  min(updated_at)                                            as aeltester_eintrag,
  max(updated_at)                                            as juengster_eintrag
from public.idle_economy_guard_state;

-- ---------------------------------------------------------------------------------
-- 2) Verteilung der Spitzenauslastung je Ressource (die eigentliche Kalibrier-Tabelle)
-- ---------------------------------------------------------------------------------
select ressource,
       round(percentile_cont(0.50) within group (order by wert)::numeric, 3) as median,
       round(percentile_cont(0.90) within group (order by wert)::numeric, 3) as p90,
       round(percentile_cont(0.99) within group (order by wert)::numeric, 3) as p99,
       round(max(wert)::numeric, 3)                                         as maximum,
       count(*) filter (where wert >= 1)                                    as konten_ueber_grenze
from (
  select 'gold' as ressource, peak_gold as wert from public.idle_economy_guard_state
  union all select 'holz',     peak_wood     from public.idle_economy_guard_state
  union all select 'stein',    peak_stone    from public.idle_economy_guard_state
  union all select 'kristall', peak_crystals from public.idle_economy_guard_state
  union all select 'essenz',   peak_essence  from public.idle_economy_guard_state
  union all select 'erfahrung', peak_xp      from public.idle_economy_guard_state
) t
group by ressource
order by ressource;

-- ---------------------------------------------------------------------------------
-- 3) Konten mit Verstoss oder hoher Auslastung (zuerst die auffaelligsten)
--    Hier entscheidet sich, ob ein Alarm Betrug oder eine zu enge Grenze ist: ein Konto mit
--    hohem Level/Gesamt-Gold und knapp ueber 1 ist eher eine zu enge Grenze, ein neues Konto
--    mit Auslastung 40 ist Betrug.
-- ---------------------------------------------------------------------------------
select g.name_key,
       g.violations                                                     as verstoesse,
       round(greatest(g.peak_gold, g.peak_wood, g.peak_stone, g.peak_crystals, g.peak_essence, g.peak_xp)::numeric, 2) as hoechste_auslastung,
       round(g.peak_gold::numeric, 2) as gold, round(g.peak_wood::numeric, 2) as holz, round(g.peak_stone::numeric, 2) as stein,
       round(g.peak_crystals::numeric, 2) as kristall, round(g.peak_essence::numeric, 2) as essenz, round(g.peak_xp::numeric, 2) as erfahrung,
       s.level, s.highest_dragon_index                                  as hoechste_stufe,
       s.total_gold_earned                                              as gold_gesamt,
       s.gold                                                           as gold_jetzt,
       g.last_flag_at
from public.idle_economy_guard_state g
left join public.idle_player_state s on s.auth_user_id::text = g.owner_key
where g.violations > 0
   or greatest(g.peak_gold, g.peak_wood, g.peak_stone, g.peak_crystals, g.peak_essence, g.peak_xp) >= 0.8
order by greatest(g.peak_gold, g.peak_wood, g.peak_stone, g.peak_crystals, g.peak_essence, g.peak_xp) desc
limit 100;

-- ---------------------------------------------------------------------------------
-- 4) Die letzten 50 Wirtschafts-Alarme mit Zahlen (gleiche Daten wie im Admin-Panel)
-- ---------------------------------------------------------------------------------
select f.flagged_at, f.name_key,
       f.economy_details ->> 'enforced'  as scharf,
       f.economy_details -> 'details'    as zuwaechse_und_grenzen,
       f.dismissed
from public.idle_anticheat_flags f
where f.triggered_by = 'economy'
order by f.flagged_at desc
limit 50;

-- ---------------------------------------------------------------------------------
-- NACH DER AUSWERTUNG (nur wenn alles plausibel aussieht) - einzeln und bewusst ausfuehren:
--   Scharf schalten:        update public.idle_anticheat_settings
--                              set value = value || '{"enforce": true}'::jsonb, updated_at = now() where key = 'economy';
--   Grenze lockern (x1,5):  update public.idle_anticheat_settings
--                              set value = value || '{"safety": 1.5}'::jsonb, updated_at = now() where key = 'economy';
--   Wieder nur melden:      update public.idle_anticheat_settings
--                              set value = value || '{"enforce": false}'::jsonb, updated_at = now() where key = 'economy';
--   Ganz ausschalten:       update public.idle_anticheat_settings
--                              set value = value || '{"enabled": false}'::jsonb, updated_at = now() where key = 'economy';
-- Wirkt sofort beim naechsten Speichern, ohne neue Migration.
