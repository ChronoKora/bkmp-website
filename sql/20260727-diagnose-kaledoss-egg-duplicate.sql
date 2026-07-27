/* ============================================================
   Rein LESENDE Diagnose (keine Aenderung an irgendeiner Zeile) - gezielt
   fuer den per Discord bestaetigten Ei-Duplikat-Fall bei Spieler "Kaledoss"
   (27.07.2026, siehe CLAUDE.md "Dringender Fix: Ei-Duplikat ueber
   Automatische Ei-Ausbruetung"). Eigene Schilderung: Ei-Dungeon gemacht,
   1-2 Eier bekommen, Automatik hat das eine Ei in ein Nest gelegt und
   dasselbe Ei ist danach nach ein paar Sekunden IMMER WIEDER im naechsten
   freien Slot erschienen, bis alle 5 Nester voll waren.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   ============================================================ */

-- 1) Aktueller Nest-Zustand: wie viele Nester, welche Eier (falls noch
-- nicht geschluepft), wann jeweils gestartet.
select id, slot_index, egg_id, started_at
from public.player_dragon_nests
where name_key = 'kaledoss'
order by slot_index asc;

-- 2) Noch nicht eingesetzte/nicht geschluepfte Eier im Bestand.
select id, species_id, created_at
from public.player_dragon_eggs
where name_key = 'kaledoss'
order by created_at asc;

-- 3) ALLE bereits geschluepften wuffdrache-Drachen (nicht nur Paare
-- innerhalb 10 Minuten wie in der vorherigen Diagnose - falls die 5
-- Zuweisungen ueber laengere Zeit hinweg geschluepft wurden, fallen sie aus
-- dem 10-Minuten-Fenster der ersten Abfrage raus).
select id, hatched_at, stage, main_stat_key, stat_attack, stat_defense, stat_hp
from public.player_dragons
where name_key = 'kaledoss' and species_id = 'wuffdrache'
order by hatched_at asc nulls last;
