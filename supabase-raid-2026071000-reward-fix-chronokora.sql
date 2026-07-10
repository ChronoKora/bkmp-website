-- EINMALIGER Nachtrag NUR fuer ChronoKora - die urspruengliche Gutschrift aus
-- supabase-raid-2026071000-reward-fix.sql wurde durch einen aktiven
-- Client-Autosave (Idle-Dorf-Fenster war offen) sofort wieder ueberschrieben.
-- NICHT fuer andere Spieler wiederholen, die haben ihre Gutschrift schon
-- behalten - sonst gibt es eine doppelte Belohnung!

update public.idle_player_state
set gold = gold + 50000,
    total_gold_earned = total_gold_earned + 50000,
    crystals = crystals + 25,
    xp = xp + 5000
where auth_user_id = '44a201b2-0a11-4410-844f-bd6498ac97fe';
