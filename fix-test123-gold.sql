-- Testaccount "test123" mit reichlich Gold ausstatten (Entwickler-Wunsch
-- 14.07. + 16.07. Nachbesserung "mehr Gold" - 999.999.999 deckt bequem alle
-- aktuellen und absehbaren Dorf-Skin-Kaufpreise ab, z.B. Libers Heimat
-- fuer 50 Mio).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

update public.idle_player_state
set gold = 999999999
where name_key = 'test123';
