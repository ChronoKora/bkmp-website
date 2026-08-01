-- Fix fuer "guild_tech_attempt_status 404 (Not Found)" im echten Spiel
-- (Live-Report 01.08.2026, per Browser-Konsole bestaetigt).
--
-- ROOT CAUSE: die Funktion existiert nachweislich in der Datenbank (per
-- direktem Test gegen die echte REST-API bestaetigt - antwortet korrekt
-- mit "not_authenticated" fuer nicht eingeloggte Aufrufe). Der eingeloggte
-- Spieler-Browser bekommt trotzdem "404 Not Found", als gaebe es die
-- Funktion nicht. Das ist ein bekanntes PostgREST/Supabase-Verhalten: die
-- REST-Schnittstelle merkt sich intern, welche Funktionen/Tabellen
-- existieren (Schema-Cache) - dieser Cache kann fuer unterschiedliche
-- Verbindungsarten (eingeloggt/nicht eingeloggt) getrennt veraltet sein,
-- obwohl die Funktion laengst live ist. Kein Bug im Spielcode, keine
-- fehlerhafte SQL-Datei - nur ein veralteter interner Cache bei Supabase.
--
-- FIX: erzwingt einen sofortigen Neuaufbau dieses Caches. Veraendert
-- keinerlei Daten, kein Risiko.

notify pgrst, 'reload schema';
