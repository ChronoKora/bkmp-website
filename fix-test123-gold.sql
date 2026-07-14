-- Testaccount "test123" auf 50 Mio Gold setzen (Entwickler-Wunsch 14.07.,
-- zum Testen der neuen Features wie Dorf-Skins).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

update public.idle_player_state
set gold = 50000000
where name_key = 'test123';
