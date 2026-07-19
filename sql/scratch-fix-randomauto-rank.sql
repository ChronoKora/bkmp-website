-- Einmaliger Korrektur-Befehl: RandomAuto's Erfolge-Zaehler haengt seit dem
-- 8. Juli fest (siehe Bug-Report), obwohl der Live-Stand laut Screenshot bei
-- 148 lag. Setzt den Bestenlisten-Wert manuell auf den bekannten Stand.
-- Einmal im Supabase SQL Editor ausfuehren.
update public.player_stats
set achievements_unlocked = 148
where name_key = 'randomauto';
