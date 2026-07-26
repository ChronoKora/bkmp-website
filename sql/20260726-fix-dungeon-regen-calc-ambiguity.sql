-- DRINGEND: behebt einen echten, live bestätigten Produktionsfehler
-- ("Dungeon-Status konnte nicht geladen werden" bei MEHREREN Spielern).
--
-- ROOT CAUSE: sql/20260726-dungeon-key-prestige-bonus.sql fügte eine neue
-- Fassung von dungeon_regen_calc() mit ZWEI zusätzlichen Parametern
-- (p_interval_seconds/p_max_keys, beide mit Default-Werten) per
-- "create or replace function" hinzu. Da sich die Parameterliste geändert
-- hat, hat das NICHT die alte Funktion ersetzt, sondern eine zweite,
-- überladene Fassung DANEBEN angelegt (Postgres identifiziert Funktionen
-- über Name+Parametertypen). Jeder bestehende Aufruf mit genau 2 Argumenten
-- (dungeon_get_all_status(), dungeon_consume_key() u.a. in
-- sql/supabase-dungeon-system-v2.sql) ist seitdem MEHRDEUTIG - Postgres
-- kann nicht entscheiden, ob die exakte 2-Parameter-Fassung oder die neue
-- 4-Parameter-Fassung (deren letzte 2 Parameter Defaults haben, also
-- ebenfalls mit 2 Argumenten aufrufbar ist) gemeint ist, und lehnt JEDEN
-- solchen Aufruf mit PGRST203 "Could not choose the best candidate
-- function" ab. Live gegen die echte Supabase-REST-API bestätigt (nicht
-- nur vermutet), siehe Chat-Verlauf.
--
-- FIX: die alte, jetzt überflüssige 2-Parameter-Fassung wird entfernt - die
-- neue 4-Parameter-Fassung deckt dank ihrer Default-Werte (14400s/5,
-- identisch zum bisherigen hartcodierten Verhalten) jeden bestehenden
-- 2-Parameter-Aufruf weiterhin exakt gleich ab. Kein Aufrufer muss
-- geändert werden, kein Verhaltensunterschied für bestehende Aufrufe.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausführen.
-- Danach sollte das Dungeon-Tab bei allen Spielern sofort wieder laden.

begin;

drop function if exists public.dungeon_regen_calc(smallint, timestamptz);

commit;

-- POSTCHECK (manuell, nach dem Ausführen):
-- select public.dungeon_regen_calc(0::smallint, now() - interval '5 hours');
--   -> erwartet: läuft OHNE "Could not choose the best candidate function"-Fehler durch,
--      new_keys=1, new_last_key_at ~ vor 1 Stunde (identisches Verhalten wie vor dem Bug)
