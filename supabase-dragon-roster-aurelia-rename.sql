-- ============================================================
-- Bkmp - Kampf-Miniboss "Yakshas Drache" wird zu "Aurelia Drache"
-- umbenannt (nur der Anzeigename, keine Werte-/Balance-Aenderung,
-- id/sprite_key/tier_order bleiben unveraendert). Spieler-Wunsch 15.07.
--
-- Der bisherige separate Kampf-Eintrag "aureliadrache" (tier_order 11,
-- ohne echtes Sprite-Bild, nur Emoji-Platzhalter) wird geloescht - er war
-- ohnehin nur dazu da, dem Aureliadrache-Ei (dragon_species) ueberhaupt
-- eine Kampf-Kill-Quelle zu geben. Diese Rolle uebernimmt jetzt der
-- umbenannte Miniboss. dragon_species.source_dragon_id wird entsprechend
-- umgebogen, damit das Ei weiterhin normal droppt.
--
-- Sicher zu loeschen: tier_order 11 ist die HOECHSTE Position im
-- Kampf-Roster (siehe supabase-dragon-breeding-roster-fix.sql) - ihr
-- Wegfall verschiebt keine tier_order-Positionen VOR ihr, betrifft also
-- current_dragon_index/highest_dragon_index bestehender Spieler nicht.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent (delete/update ohne Row = No-Op bei erneutem Ausfuehren).
-- ============================================================

update public.idle_dragons set name = 'Aurelia Drache' where id = 'yakshas-drache';

delete from public.idle_dragons where id = 'aureliadrache';

update public.dragon_species set source_dragon_id = 'yakshas-drache' where id = 'aureliadrache';
