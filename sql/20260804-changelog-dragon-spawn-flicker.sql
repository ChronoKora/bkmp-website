-- Bkmp - Oeffentlicher Changelog-Eintrag: Gegnerwechsel-Flackern behoben
-- (04.08.2026). Gleiches idempotentes Muster wie sql/20260726-changelog.sql /
-- sql/20260803-changelog-schluesselmeister-removed.sql /
-- sql/20260804-changelog-combat-visual-polish.sql /
-- sql/20260804-changelog-raid-actionbar.sql /
-- sql/20260804-changelog-rune-cap-removed.sql /
-- sql/20260804-changelog-skin-preview.sql. Bereits fertig ausgefuellt, kein
-- Platzhalter.
--
-- Reiner Anzeige-/Animations-Fix - keine Kampfmechanik/-werte geaendert,
-- daher unabhaengig von jeder anderen SQL-Migration sofort einsetzbar.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-04', 'fix',
  'Gegnerwechsel-Flackern behoben',
  'Beim Wechsel zwischen zwei Video-Drachen konnte die Kampf-Box kurz komplett leer aufblitzen und dabei sichtbar kleiner wirken. Die neue "weniger abrupt"-Übergangsanimation startet jetzt erst, sobald das Bild des nächsten Drachen wirklich geladen ist.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-04' and title = 'Gegnerwechsel-Flackern behoben'
);
