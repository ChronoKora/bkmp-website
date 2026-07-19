-- Bkmp - KRITISCHER Fix: Runen werden nie gespeichert (Spieler-Meldung
-- "Kaledoss": "Nach dem Seite aktualisieren waren alle meine Runen weg xD")
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Root Cause: die Spalte "rarity" wurde in supabase-idle-runes.sql als
-- "smallint check (rarity between 1 and 5)" angelegt. idledorf.js/supabase.js
-- schreiben aber IMMER den text-Id der Seltenheit ('gray'/'green'/'blue'/
-- 'purple'/'gold', siehe BKMP_RUNE_RARITIES), nie eine Zahl. Jeder einzelne
-- insertPlayerRunes()-Aufruf ist dadurch seit Einfuehrung des Runen-Systems
-- an der Datenbank mit einem Typ-Fehler gescheitert (smallint erwartet, text
-- bekommen) - der Fehler wurde in bkmpIdleQueueRuneSync() nur mit
-- console.warn() abgefangen, nie dem Spieler angezeigt. Ergebnis: Runen
-- lebten immer nur im Browser-Speicher der laufenden Sitzung und waren nach
-- jedem Neuladen komplett weg, ohne dass je eine Zeile in der DB ankam.
--
-- Fix: Spalte auf text umstellen (kein Datenverlust moeglich, da nie ein
-- Insert erfolgreich war - "using rarity::text" ist trotzdem sicherheitshalber
-- dabei, falls doch vereinzelt etwas drin steht).

alter table public.idle_player_runes
  drop constraint if exists idle_player_runes_rarity_check;

alter table public.idle_player_runes
  alter column rarity type text using rarity::text;

alter table public.idle_player_runes
  add constraint idle_player_runes_rarity_check
  check (rarity in ('gray', 'green', 'blue', 'purple', 'gold'));
