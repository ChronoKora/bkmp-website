-- Bkmp - POST-MIGRATIONSPRUEFUNG (read-only, keine Schreibzugriffe) fuer
-- sql/20260725-fix-rename-name-key-propagation.sql. NACH der Migration
-- ausfuehren. Supabase Dashboard > SQL Editor > New query.
--
-- ERWARTUNG:
--  Abfrage 1 und 2 MUESSEN leer sein (0 Zeilen) - jeder Treffer waere ein
--  echtes Problem (eine Zeile, die die Migration haette anfassen sollen,
--  aber nicht angefasst hat).
--  Abfrage 3 DARF Zeilen zeigen - das sind die bewusst NICHT automatisch
--  reparierten, mehrdeutigen Prestige-Faelle (siehe PREVIEW-Datei,
--  Abfrage 2). Kein Fehler, nur zur eigenen Kenntnis.

-- 1) Runen, die noch nicht zu ihrem aktuellen Konto passen - MUSS LEER SEIN.
select r.auth_user_id, r.name_key as runen_name_key, ps.name_key as aktueller_name
from public.idle_player_runes r
join public.player_stats ps on ps.auth_user_id = r.auth_user_id
where r.name_key is distinct from ps.name_key;

-- 2) Dorf-Skins, die noch nicht zu ihrem aktuellen Konto passen - MUSS LEER SEIN.
select v.auth_user_id, v.name_key as skin_name_key, ps.name_key as aktueller_name
from public.idle_player_village_skins v
join public.player_stats ps on ps.auth_user_id = v.auth_user_id
where v.name_key is distinct from ps.name_key;

-- 3) Verwaiste Prestige-Zeilen, die bewusst NICHT automatisch repariert
--    wurden (mehrdeutige Namens-Historie) - Zeilen hier sind ERWARTET.
select p.name_key as verwaister_name, p.prestige_level, p.prestige_points, p.updated_at
from public.idle_prestige_state p
where not exists (select 1 from public.player_stats ps where ps.name_key = p.name_key)
order by p.updated_at desc;

-- 4) Zur Bestaetigung: die Funktion selbst enthaelt jetzt alle drei
--    zusaetzlichen Tabellen (sollte "true" liefern).
select
  pg_get_functiondef('public.rename_player_account'::regproc) like '%idle_player_runes%'
  and pg_get_functiondef('public.rename_player_account'::regproc) like '%idle_prestige_state%'
  and pg_get_functiondef('public.rename_player_account'::regproc) like '%idle_player_village_skins%'
  as fix_is_live;
