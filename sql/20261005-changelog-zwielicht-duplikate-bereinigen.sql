-- Bkmp - Doppelte Zwielicht-Changelog-Eintraege bereinigen (04.10.2026).
--
-- Ursache: Die Vorlage 20261004-changelog-zwielicht.sql wurde zweimal ausgefuehrt
-- (09:46 mit Datum 16.10., 14:28 nach der Korrektur auf 05.10.). Danach hat
-- 20261005-changelog-zwielicht-date-fix.sql die aelteren drei Zeilen ebenfalls auf
-- 05.10. gesetzt - dadurch stehen alle drei Eintraege jetzt doppelt im oeffentlichen
-- Changelog.
--
-- Diese Datei loescht die jeweils AELTERE Zeile (09:46). Behalten werden die neueren
-- Zeilen (14:28): beim "Erwachen des Zwielichts" enthaelt nur der neuere Text die
-- aktuellen, garantierten Eier (Dayman Stufe 10, Surebrec Stufe 20); die beiden
-- anderen Eintraege sind inhaltlich identisch.
--
-- Sicherheitsnetz: eine Zeile wird nur geloescht, wenn es zu Titel + Datum noch eine
-- neuere Zeile gibt. Idempotent - ein zweites Ausfuehren findet nichts mehr.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

delete from public.changelog_entries e
where e.id in (
    '6ea72857-bf54-466e-9d06-d97bc78df98c',  -- Das Erwachen des Zwielichts (alt, falscher Eier-Text)
    '9be3a02b-8239-4526-8bb1-4e45ddac5ad9',  -- Die Goettliche Erweckung (alt)
    'effa552c-c1b9-43d9-904d-55a974a00332'   -- Kleine Wochenereignisse (alt)
  )
  and exists (
    select 1
    from public.changelog_entries n
    where n.title = e.title
      and n.entry_date = e.entry_date
      and n.id <> e.id
      and n.created_at > e.created_at
  );

-- Kontrolle: danach muessen genau 3 Zeilen mit Datum 2026-10-05 uebrig sein.
-- select title, created_at from public.changelog_entries where entry_date = '2026-10-05' order by title;
