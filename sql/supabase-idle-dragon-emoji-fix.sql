-- Bkmp - Erddrache-Emoji auf breiter unterstuetztes Zeichen umstellen.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Gleiches Problem/gleiche Loesung wie bei den Skilltree-Icons (siehe
-- supabase-idle-skill-icon-fix.sql): 🪨 (Unicode 13.0, 2020) wird auf
-- manchen Systemen/Browsern noch als leeres Kaestchen dargestellt.
-- idledorf.js's BKMP_IDLE_FALLBACK_DRAGONS wurde bereits auf 🗿 umgestellt,
-- greift aber nur, wenn diese Tabelle NICHT erreichbar ist - der eigentlich
-- angezeigte Wert kommt live aus idle_dragons.

update public.idle_dragons set emoji = '🗿' where id = 'erddrache';
