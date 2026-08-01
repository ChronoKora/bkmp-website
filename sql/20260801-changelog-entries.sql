-- Bkmp - Oeffentlicher Changelog-Eintrag fuer den 01.08.2026 (live
-- bestaetigter kritischer Gilden-Technologie-Fix). Gleiches idempotentes
-- Muster wie sql/20260726-changelog.sql (Pruefung per Datum+Titel -
-- erneutes Ausfuehren erzeugt keine Duplikate). Bereits fertig ausgefuellt.
--
-- Bewusst NUR dieser eine Eintrag - die uebrigen heutigen Themen (Gilden-
-- Level-Deckel 100, neuer Drachenzucht-Zweig) haben ihre eigene SQL-Datei
-- noch nicht ausgefuehrt bekommen; ein Changelog-Eintrag dafuer waere sofort
-- oeffentlich sichtbar (changelog_entries hat kein "unveroeffentlicht"-Flag,
-- reiner RLS-Select fuer anon), obwohl das jeweilige Feature fuer Spieler
-- noch gar nicht existiert - wuerde nur verwirren. Nachreichen, sobald die
-- jeweilige Migration live ist.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-01', 'fix',
  'Gilden-Technologie: Beitragen war zeitweise nicht möglich',
  'Ein Fehler auf unserer Seite hat kurzzeitig dafür gesorgt, dass Beiträge zum Gilden-Technologie-Baum mit einer Fehlermeldung scheiterten und die Anzeige "Beitragsversuche heute" dauerhaft bei "wird geladen…" hängen blieb. Ist behoben, Beitragen funktioniert wieder normal - kein Gold oder Fortschritt ist dabei verloren gegangen.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-01' and title = 'Gilden-Technologie: Beitragen war zeitweise nicht möglich'
);
