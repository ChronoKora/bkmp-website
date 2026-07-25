-- Bkmp - REIN LESENDE DIAGNOSE fuer den weiterhin gemeldeten Runenverlust
-- von Spieler "BagonTr01" (25.07.2026, nach der bereits live gelaufenen
-- Rename-Reparatur sql/20260725-fix-rename-name-key-propagation.sql).
--
-- KEINE Schreibzugriffe, KEINE Loeschungen, KEINE Korrekturen - jede Abfrage
-- unten ist ein reines SELECT. Gefahrlos beliebig oft ausfuehrbar.
-- Supabase Dashboard > SQL Editor > New query > Abschnitt fuer Abschnitt
-- ausfuehren (oder alles auf einmal - es gibt nichts, das sich gegenseitig
-- beeinflussen koennte, da nichts geschrieben wird).
--
-- Hintergrund: der Spieler bestaetigt, dass seine frueheren "Level-22-/23"-
-- Runen weiterhin fehlen (gemeint ist hoechstwahrscheinlich upgrade_level,
-- siehe sql/supabase-idle-runes-v2.sql/-ascend-constraint-fix.sql - der
-- gueltige Bereich ist 0-30, ein Wert von 22/23 ist ein plausibler, sehr
-- hoher Aufwertungsstand). Im aktuellen Inventar sind hoechstens 2 lila
-- Runen fuer Slot 4 sichtbar (rarity='purple', rune_type='slot4', siehe
-- BKMP_RUNE_RARITIES/BKMP_RUNE_SLOTS in js/systems/bkmp-runes.js). Die
-- bereits live gelaufene Rename-Migration hat seinen Fall also NICHT
-- vollstaendig geloest - dieses Skript findet zuerst heraus, WARUM, bevor
-- irgendetwas repariert wird.
--
-- Architektur-Fakten, die diese Diagnose gezielt nutzt (verifiziert gegen
-- die echten create-table-Definitionen in sql/*.sql, nicht angenommen):
--  - idle_player_runes: id, name_key, auth_user_id, rune_type, rarity,
--    rolled_value, equipped, created_at, upgrade_level, substats. Jede Rune
--    ist eine EIGENE Zeile (wie user_plushies), KEIN JSON-Blob - ein
--    "leerer Zustand ueberschreibt alles"-Bug (Kategorie C) ist fuer diese
--    Tabelle strukturell praktisch ausgeschlossen: es gibt im gesamten
--    Code (supabase.js) keinen einzigen Bulk-Replace/Upsert-Pfad fuer diese
--    Tabelle, nur einzelne insert/update/delete-Aufrufe mit expliziten IDs.
--  - Echte Loeschungen (Kategorie D) sind nur ueber 5 explizite, vom
--    Spieler selbst ausgeloeste Aktionen moeglich (js/systems/bkmp-runes.js,
--    bkmpRuneDeleteRemote()): Aufstiegs-Fodder, Auto-Aufstieg-Fodder,
--    Verschmelzen, Einzelverkauf, Sammelverkauf - IMMER mit expliziter
--    id-Liste (".in('id', runeIds)"), nie ein blindes "delete all". Zusaetz-
--    lich existiert ein admin-gatetes admin_delete_player_account()
--    (sql/supabase-admin-player-management.sql), das im Rahmen einer
--    KOMPLETTEN Account-Loeschung auch "delete from idle_player_runes
--    where auth_user_id = ..." ausfuehrt - das wuerde aber gleichzeitig
--    player_stats/auth.users mitloeschen, was hier nicht der Fall ist
--    (der Spieler spielt nachweislich weiter unter demselben Namen).
--  - loadPlayerRunes() (supabase.js) filtert AUSSCHLIESSLICH nach name_key,
--    OHNE auth_user_id-Fallback - exakt der bereits bekannte Root-Cause-
--    Mechanismus des urspruenglichen Bugs.
--  - Der bereits live gelaufene Rune-Backfill (Schritt B der Rename-
--    Migration) glich name_key NUR ueber auth_user_id ab ("where
--    r.auth_user_id = ps.auth_user_id") - KEINE Mehrdeutigkeits-Bremse wie
--    beim Prestige-Backfill noetig, WEIL auth_user_id (anders als ein
--    Namens-String) strukturell eindeutig ist (siehe player_stats_auth_
--    user_id_idx, unique partial index). Das bedeutet: WENN seine Runen-
--    zeilen die korrekte auth_user_id tragen, haette der bereits gelaufene
--    Fix sie zwingend schon repariert. Sind sie WEITERHIN unsichtbar,
--    deutet das auf eine ANDERE Ursache als die bereits gefixte hin -
--    dieses Skript grenzt das gezielt ein.

-- ============================================================
-- ABSCHNITT 1 - Identitaet (Auftragspunkt 1+2)
-- ============================================================

-- 1a) Aktuelle(r) Account(s) - bewusst breite Suche (nicht nur exakter
--     Name), falls der Anzeigename inzwischen leicht abweicht.
select
  ps.auth_user_id,
  ps.name_key,
  ps.display_name,
  ps.last_name_change_at,
  ps.updated_at,
  u.created_at as account_erstellt_am
from public.player_stats ps
left join auth.users u on u.id = ps.auth_user_id
where ps.name_key = 'bagontr01'
   or ps.display_name ilike '%bagon%';

-- 1b) Saemtliche fruehere Namen/name_keys dieses Accounts, chronologisch.
select h.*
from public.player_name_history h
where h.auth_user_id in (
  select ps.auth_user_id from public.player_stats ps
  where ps.name_key = 'bagontr01' or ps.display_name ilike '%bagon%'
)
order by h.changed_at asc;

-- 1c) Sicherheitsnetz, UNABHAENGIG von 1a/1b: jede Namenshistorien-Zeile,
--     die "bagon" ueberhaupt erwaehnt - faengt den Fall ab, dass sein
--     aktueller Name/Account in 1a aus irgendeinem Grund nicht matcht.
select * from public.player_name_history
where old_name ilike '%bagon%' or new_name ilike '%bagon%'
order by changed_at asc;

-- ============================================================
-- ABSCHNITT 2 - Runen (Auftragspunkt 3+5+6)
-- ============================================================

-- 2a) ALLE Runen-Zeilen, die zu diesem Account gehoeren KOENNTEN, ueber
--     jeden bekannten Zugriffspfad gleichzeitig - inkl. Kennzeichnung,
--     UEBER WELCHEN Pfad die Zeile gefunden wurde (unterscheidet direkt
--     Kategorie A "existiert, falsch verknuepft" von "korrekt verknuepft,
--     aber trotzdem nicht geladen").
with bagon_accounts as (
  select auth_user_id, name_key as current_name_key, display_name
  from public.player_stats
  where name_key = 'bagontr01' or display_name ilike '%bagon%'
),
bagon_old_names as (
  select distinct lower(h.old_name) as old_name_key
  from public.player_name_history h
  where h.auth_user_id in (select auth_user_id from bagon_accounts)
)
select
  r.id,
  r.name_key,
  r.auth_user_id,
  r.rune_type,
  r.rarity,
  r.rolled_value,
  r.upgrade_level,
  r.equipped,
  r.substats,
  r.created_at,
  (r.auth_user_id in (select auth_user_id from bagon_accounts)) as matched_ueber_auth_user_id,
  (r.name_key in (select current_name_key from bagon_accounts)) as matched_ueber_aktuellen_namen,
  (r.name_key in (select old_name_key from bagon_old_names)) as matched_ueber_alten_namen,
  (r.name_key ilike '%bagon%') as matched_ueber_aehnlichen_namen
from public.idle_player_runes r
where r.auth_user_id in (select auth_user_id from bagon_accounts)
   or r.name_key in (select current_name_key from bagon_accounts)
   or r.name_key in (select old_name_key from bagon_old_names)
   or r.name_key ilike '%bagon%'
order by r.upgrade_level desc, r.created_at asc;

-- 2b) GLOBALE Suche (auftragspunkt 5): existieren stark aufgewertete
--     Runen (upgrade_level >= 20, deckt "Level 22/23" sicher ab) IRGENDWO
--     in der Tabelle, unabhaengig von name_key/auth_user_id - falls seine
--     Runen unter einer voelling anderen/fehlerhaften Identitaet haengen,
--     wuerden 2a sie nicht finden, diese Abfrage schon. Kleiner, gut
--     ueberschaubarer Ergebnis-Umfang (nur sehr weit aufgewertete Runen).
select
  r.id,
  r.name_key as runen_name_key,
  r.auth_user_id as runen_auth_user_id,
  r.rune_type,
  r.rarity,
  r.rolled_value,
  r.upgrade_level,
  r.equipped,
  r.created_at,
  ps_by_key.display_name as aktueller_besitzer_ueber_namen,
  ps_by_uid.display_name as aktueller_besitzer_ueber_auth_user_id
from public.idle_player_runes r
left join public.player_stats ps_by_key on ps_by_key.name_key = r.name_key
left join public.player_stats ps_by_uid on ps_by_uid.auth_user_id = r.auth_user_id
where r.upgrade_level >= 20
order by r.upgrade_level desc, r.created_at asc;

-- 2c) Mehrdeutigkeits-Check (Auftragspunkt 4): wurde einer von Bagons
--     alten Namen JEMALS auch von einem ANDEREN Account benutzt? Fuer
--     Runen ist das (anders als beim bereits gefixten Prestige-Backfill)
--     strukturell NICHT die Abgrenzung, die der bereits gelaufene Fix
--     genutzt hat (der lief ueber auth_user_id, nicht ueber Namens-
--     Historie) - diese Abfrage dient nur der vollstaendigen Beantwortung
--     von Punkt 4, nicht als Erklaerung fuer einen Runen-spezifischen Bug.
with bagon_accounts as (
  select auth_user_id from public.player_stats
  where name_key = 'bagontr01' or display_name ilike '%bagon%'
),
bagon_old_names as (
  select distinct lower(h.old_name) as old_name_key
  from public.player_name_history h
  where h.auth_user_id in (select auth_user_id from bagon_accounts)
)
select
  bon.old_name_key,
  count(distinct h2.auth_user_id) as anzahl_verschiedener_konten_die_diesen_namen_je_hatten
from bagon_old_names bon
join public.player_name_history h2 on lower(h2.old_name) = bon.old_name_key
group by bon.old_name_key
order by anzahl_verschiedener_konten_die_diesen_namen_je_hatten desc;

-- ============================================================
-- ABSCHNITT 3 - Kontext, den reines SQL NICHT beantworten kann
-- (Auftragspunkt 8, informativ, keine Abfrage moeglich)
-- ============================================================
-- idle_player_runes hat keine deleted_at-Spalte, keinen Audit-Log, keine
-- Versionierung - eine bereits vor dieser Diagnose GELOESCHTE Zeile ist
-- ueber SQL allein nicht rekonstruierbar. Zwei Wege koennten trotzdem noch
-- Daten liefern, beide NICHT ueber den SQL Editor abrufbar:
--  1) Supabase Point-in-Time-Recovery (PITR): Supabase Dashboard > Project
--     Settings > Database > Backups. Nur verfuegbar/aktiviert, falls der
--     Datenbank-Plan das unterstuetzt UND der Zeitpunkt des Verlusts noch
--     innerhalb des Aufbewahrungsfensters liegt - muss im Dashboard selbst
--     geprueft werden, kein SQL-Befehl kann das von hier aus feststellen.
--  2) Supabase-eigene Logs (Dashboard > Logs > Postgres Logs / API Logs) -
--     koennten im Retentionszeitraum zeigen, WANN/WIE ein DELETE gegen
--     idle_player_runes fuer diese auth_user_id lief (z.B. ueber welchen
--     API-Pfad) - ebenfalls nur im Dashboard einsehbar, nicht per SELECT.
