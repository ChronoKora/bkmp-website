-- Bkmp - Bonk-Zaehler-Obergrenze entfernen (Bug-Fix).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Der bisherige Check-Constraint deckelte bonk_count bei 200.000, obwohl
-- die Bonk-Bestenliste Titel bis 1.000.000 ("Der ewige Bonker") kennt.
-- Sobald ein Spieler die 200.000 ueberschritt, schlug JEDER Stats-Sync fehl
-- (Fehler 23514, check constraint "player_stats_bonk_check") - da es ein
-- Update der GESAMTEN Zeile ist, blieben dadurch auch Erfolge/Zeit/Titel
-- etc. dauerhaft auf dem letzten erfolgreichen Stand haengen, nicht nur
-- der Bonk-Zaehler selbst (siehe Bug-Report RandomAuto).
alter table public.player_stats drop constraint if exists player_stats_bonk_check;
alter table public.player_stats add constraint player_stats_bonk_check check (bonk_count >= 0);
