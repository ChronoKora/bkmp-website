-- Bkmp - Oeffentlicher Changelog-Eintrag fuer die 6 neuen Zucht-
-- Drachenarten (02.08.2026). Gleiches idempotentes Muster wie
-- sql/20260726-changelog.sql (Pruefung per Datum+Titel - erneutes
-- Ausfuehren erzeugt keine Duplikate). Bereits fertig ausgefuellt.
--
-- Setzt voraus, dass sql/20260802-dragon-species-neue-neue-drachen.sql
-- bereits gelaufen ist - sonst waeren die Arten oeffentlich angekuendigt,
-- bevor sie im Ei-Dungeon-Pool tatsaechlich auftauchen koennen.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-02', 'feature',
  '6 neue Drachenarten in der Drachenzucht',
  'Vier neue epische Drachen (Fynnow, Vulkarion, Bloodterion, Gravoryx) und zwei neue legendäre Drachen (Lohendrache, Darknisdrache) könnt ihr jetzt über den Ei-Dungeon finden und großziehen.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-02' and title = '6 neue Drachenarten in der Drachenzucht'
);
