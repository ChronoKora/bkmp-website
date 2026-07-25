-- Bkmp - REIN LESENDE, ERWEITERTE Diagnose (25.07.2026), nachdem ein
-- ZWEITER, unabhaengiger Spieler (Nilo3628) denselben Runenverlust
-- gemeldet hat wie BagonTr01 (siehe sql/20260725-diagnose-bagontr01-rune-
-- loss.sql) - prueft, ob das Muster SYSTEMWEIT auftritt, nicht nur bei
-- diesen zwei Spielern.
--
-- KEINE Schreibzugriffe, KEINE Loeschungen, KEINE Korrekturen - jede
-- Abfrage unten ist ein reines SELECT. Gefahrlos beliebig oft ausfuehrbar.
-- Supabase Dashboard > SQL Editor > New query > Abschnitt fuer Abschnitt
-- ausfuehren.

-- ============================================================
-- ABSCHNITT 1 - Nilo3628, exakt gleiches Muster wie bei BagonTr01
-- ============================================================

-- 1a) Identitaet.
select
  ps.auth_user_id, ps.name_key, ps.display_name, ps.last_name_change_at, ps.updated_at,
  u.created_at as account_erstellt_am
from public.player_stats ps
left join auth.users u on u.id = ps.auth_user_id
where ps.name_key = 'nilo3628' or ps.display_name ilike '%nilo%';

-- 1b) Namenshistorie.
select h.*
from public.player_name_history h
where h.auth_user_id in (
  select ps.auth_user_id from public.player_stats ps
  where ps.name_key = 'nilo3628' or ps.display_name ilike '%nilo%'
)
order by h.changed_at asc;

-- 1c) ALLE seine Runen, ueber jeden bekannten Pfad, mit Markierung WARUM
--     jede Zeile gefunden wurde (identisch zu Abschnitt 2a der Bagon-
--     Diagnose).
with nilo_accounts as (
  select auth_user_id, name_key as current_name_key, display_name
  from public.player_stats
  where name_key = 'nilo3628' or display_name ilike '%nilo%'
),
nilo_old_names as (
  select distinct lower(h.old_name) as old_name_key
  from public.player_name_history h
  where h.auth_user_id in (select auth_user_id from nilo_accounts)
)
select
  r.id, r.name_key, r.auth_user_id, r.rune_type, r.rarity, r.rolled_value,
  r.upgrade_level, r.equipped, r.substats, r.created_at,
  (r.auth_user_id in (select auth_user_id from nilo_accounts)) as matched_ueber_auth_user_id,
  (r.name_key in (select current_name_key from nilo_accounts)) as matched_ueber_aktuellen_namen,
  (r.name_key in (select old_name_key from nilo_old_names)) as matched_ueber_alten_namen,
  (r.name_key ilike '%nilo%') as matched_ueber_aehnlichen_namen
from public.idle_player_runes r
where r.auth_user_id in (select auth_user_id from nilo_accounts)
   or r.name_key in (select current_name_key from nilo_accounts)
   or r.name_key in (select old_name_key from nilo_old_names)
   or r.name_key ilike '%nilo%'
order by r.upgrade_level desc, r.created_at asc;

-- ============================================================
-- ABSCHNITT 2 - SYSTEMWEITE Pruefung (nicht mehr nur 2 Spieler): gibt es
-- ueberhaupt Runen-Zeilen, deren name_key NICHT zur aktuellen
-- player_stats-Zeile ihrer eigenen auth_user_id passt? Das ist GENAU der
-- Zustand, den Kategorie A ("existiert, falsch verknuepft") beschreibt -
-- diese Abfrage findet das fuer JEDEN Spieler, nicht nur die zwei
-- gemeldeten Faelle. Kleines, gut lesbares Ergebnis erwartet (nur echte
-- Abweichungen).
-- ============================================================
select
  r.auth_user_id,
  r.name_key as runen_name_key,
  ps.name_key as aktueller_name_key_laut_player_stats,
  ps.display_name as aktueller_anzeigename,
  count(*) as anzahl_betroffener_runenzeilen,
  count(*) filter (where r.equipped) as davon_ausgeruestet,
  max(r.upgrade_level) as hoechster_upgrade_level_dabei
from public.idle_player_runes r
join public.player_stats ps on ps.auth_user_id = r.auth_user_id
where r.name_key is distinct from ps.name_key
group by r.auth_user_id, r.name_key, ps.name_key, ps.display_name
order by anzahl_betroffener_runenzeilen desc;

-- ============================================================
-- ABSCHNITT 3 - SYSTEMWEIT, Gegenrichtung: Runen, deren auth_user_id auf
-- GAR KEINEN existierenden Account mehr zeigt (echte Waisen, Kategorie B/
-- "Account existiert nicht mehr unter dieser auth_user_id"). Getrennt von
-- Abschnitt 2, weil das ein anderes Bild ergeben kann (Runen komplett
-- unauffindbar vs. nur falsch aktualisiert).
-- ============================================================
select
  r.auth_user_id, r.name_key, count(*) as anzahl_zeilen,
  count(*) filter (where r.equipped) as davon_ausgeruestet,
  max(r.upgrade_level) as hoechster_upgrade_level_dabei
from public.idle_player_runes r
where not exists (select 1 from public.player_stats ps where ps.auth_user_id = r.auth_user_id)
group by r.auth_user_id, r.name_key
order by anzahl_zeilen desc;

-- ============================================================
-- ABSCHNITT 4 - Zeitliche Haeufung: wann wurden zuletzt Rename-Vorgaenge
-- durchgefuehrt? Falls Bagon UND Nilo beide kuerzlich umbenannt haben,
-- waere das ein starker gemeinsamer Nenner - falls NICHT, deutet das eher
-- auf eine andere, nicht rename-bezogene gemeinsame Ursache hin (z.B. ein
-- Ladeproblem, das mehrere Spieler unabhaengig vom Rename-Verlauf trifft).
-- ============================================================
select h.auth_user_id, ps.display_name as aktueller_name, h.old_name, h.new_name, h.changed_at
from public.player_name_history h
left join public.player_stats ps on ps.auth_user_id = h.auth_user_id
order by h.changed_at desc
limit 30;
