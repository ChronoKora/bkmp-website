-- Bkmp - Bonk-Zaehler fuer den Bonk-Button (oben links)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Speichert, wie oft ein Spieler auf den Bonk-Button geklickt hat, damit
-- der Fortschritt (Bonk-Erfolge/-Kosmetiken/-Titel) auch geraeteuebergreifend
-- erhalten bleibt.

alter table public.player_stats add column if not exists bonk_count integer not null default 0;

-- Keine Obergrenze mehr - die Bonk-Bestenliste kennt Titel bis 1.000.000
-- ("Der ewige Bonker"), ein zu niedriger Deckel liess JEDEN Stats-Sync
-- fehlschlagen, sobald er ueberschritten wurde (siehe
-- supabase-player-stats-bonk-cap-fix.sql).
alter table public.player_stats drop constraint if exists player_stats_bonk_check;
alter table public.player_stats add constraint player_stats_bonk_check check (bonk_count >= 0);
