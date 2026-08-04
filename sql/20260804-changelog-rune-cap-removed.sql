-- Bkmp - Oeffentlicher Changelog-Eintrag: "Lager aufraeumen"-Verkaufsleiste
-- entfernt + Runen-Ladelimit wieder aufgehoben (04.08.2026). Gleiches
-- idempotentes Muster wie sql/20260726-changelog.sql /
-- sql/20260803-changelog-schluesselmeister-removed.sql /
-- sql/20260804-changelog-combat-visual-polish.sql /
-- sql/20260804-changelog-raid-actionbar.sql. Bereits fertig ausgefuellt,
-- kein Platzhalter.
--
-- Reiner Client-Anzeige-/Lade-Eintrag - keine Kampfmechanik/-werte geaendert,
-- daher unabhaengig von jeder anderen SQL-Migration sofort einsetzbar.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-04', 'change',
  'Runen-Lager: Aufräumen-Leiste entfernt',
  'Die Knopfreihe "🧹 Lager aufräumen (alle Plätze)" im Runen-Tab ist wieder entfernt - sie hat viele Spieler verwirrt. Euer komplettes Runen-Lager wird jetzt wieder vollständig angezeigt, ohne Ladegrenze.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-04' and title = 'Runen-Lager: Aufräumen-Leiste entfernt'
);
