-- Bkmp - Skilltree-Icons auf breiter unterstuetzte Emoji umstellen.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- wirt_holz/wirt_stein stehen aktuell auf 🪵/🪨 (Unicode 13.0, 2020) - auf
-- manchen Systemen/Browsern (v.a. Windows ohne aktuelles Emoji-Font-Update,
-- aeltere Firefox-Versionen) noch nicht bekannt, wird als leeres Kaestchen
-- dargestellt (siehe Admin-Panel Skilltree-Liste). Gleiches Problem/gleiche
-- Loesung wie beim Erddrachen-Emoji zuvor: auf breiter unterstuetzte,
-- thematisch passende Alternativen umstellen (🌳/🗿 - beide aus dem
-- allerersten Emoji-Set von 2010/2015).

update public.idle_skill_nodes set icon = '🌳' where id = 'wirt_holz';
update public.idle_skill_nodes set icon = '🗿' where id = 'wirt_stein';
