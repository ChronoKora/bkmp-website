-- Bkmp - Oeffentlicher Changelog-Eintrag: "Bosskampf!"-Banner erschien bei
-- "Bleibt hier" dauerhaft wiederkehrend statt nur einmal (05.08.2026).
-- Gleiches idempotentes Muster wie sql/20260726-changelog.sql /
-- sql/20260805-changelog-dragon-growth-xp.sql. Bereits fertig ausgefuellt,
-- kein Platzhalter.
--
-- Reiner Anzeige-Fix - keine Kampfmechanik/-werte geaendert.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-05', 'fix',
  '"Bosskampf!"-Banner erschien bei "Bleibt hier" ständig erneut',
  'Wer bei einem Boss auf "Bleibt hier" stand, bekam die "Bosskampf!"-Meldung bei jedem einzelnen Kill erneut eingeblendet statt nur einmal beim Erreichen der Stufe. Die Meldung erscheint jetzt nur noch einmal - beim Wiederverlassen und erneuten Erreichen einer Boss-Stufe wird sie natürlich weiterhin ganz normal wieder angezeigt.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-05' and title = '"Bosskampf!"-Banner erschien bei "Bleibt hier" ständig erneut'
);
