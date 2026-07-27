/* ============================================================
   Rein LESENDE Diagnose (keine Aenderung an irgendeiner Zeile) fuer den
   Ei-Duplikat-Bug vom 27.07.2026 (Discord-Meldung "Kaiser [Dustin]", siehe
   CLAUDE.md "Dringender Fix: Ei-Duplikat ueber Automatische
   Ei-Ausbruetung"). Prueft, ob der Bug bei irgendeinem Spieler bereits
   tatsaechlich zu einem doppelten Ei-Einsatz gefuehrt hat, BEVOR der Fix
   griff.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   ============================================================ */

-- Signal 1: ein Ei, das GERADE JETZT in mehr als einem Nest liegt (sollte
-- unter korrektem Betrieb strukturell nie vorkommen - waere ein noch nicht
-- geschluepftes, aktiv dupliziertes Ei).
select egg_id, count(*) as nest_count, array_agg(name_key) as betroffene_spieler
from public.player_dragon_nests
where egg_id is not null
group by egg_id
having count(*) > 1;

-- Signal 2 (Heuristik, da ein geschluepftes Ei geloescht wird und damit
-- keine direkte egg_id-Spur mehr hinterlaesst): Spieler mit zwei oder mehr
-- Drachen derselben Spezies, deren hatched_at innerhalb von 10 Minuten
-- auseinanderliegt - waere das erwartbare Muster, wenn ein Ei ueber zwei
-- Nester "verdoppelt" wurde und beide kurz hintereinander schluepften.
select
  d1.name_key,
  d1.species_id,
  d1.id as dragon_a_id, d1.hatched_at as hatched_a,
  d2.id as dragon_b_id, d2.hatched_at as hatched_b,
  extract(epoch from (d2.hatched_at - d1.hatched_at)) as sekunden_abstand
from public.player_dragons d1
join public.player_dragons d2
  on d1.name_key = d2.name_key
  and d1.species_id = d2.species_id
  and d1.id < d2.id
  and d1.hatched_at is not null and d2.hatched_at is not null
  and abs(extract(epoch from (d2.hatched_at - d1.hatched_at))) < 600
order by sekunden_abstand asc;
