-- ============================================================
-- Bkmp - Ei-Fund-Chance (Standard/Selten) von 0,4% auf 0,1% pro Kill
-- gesenkt (Spieler-Feedback 17.07.: "2 Eier in 4 Minuten ist zu haeufig").
-- Entspricht jetzt der schon etablierten "wirklich selten"-Chance im Spiel
-- (Event-Drachen Shenloss/Liber droppen ebenfalls mit 0,1%).
--
-- Episch/Legendaer sind ohnehin event-/raid-exklusiv (egg_drop_chance=0
-- bzw. eigene raid-Chance) und bleiben unberuehrt.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent (setzt festen Wert).
-- ============================================================

update public.dragon_species set egg_drop_chance = 0.001
where rarity in ('standard', 'selten') and egg_source = 'combat';
