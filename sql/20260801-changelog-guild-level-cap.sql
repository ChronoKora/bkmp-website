-- Bkmp - Oeffentlicher Changelog-Eintrag fuer den Gilden-Level-Ausbau
-- (Deckel 30 -> 100, 01.08.2026, siehe CLAUDE.md). Gleiches idempotentes
-- Muster wie die bisherigen Changelog-SQL-Dateien (Pruefung per Datum+
-- Titel - erneutes Ausfuehren erzeugt keine Duplikate). Bereits fertig
-- ausgefuellt, kein Platzhalter, kein weiterer Handgriff noetig ausser
-- diese Datei einmal im Supabase SQL Editor auszufuehren.
--
-- Hinweis: sollte VOR bzw. zusammen mit sql/20260801-guild-level-cap-100.sql
-- ausgefuehrt werden, sonst kuendigt der Changelog ein Feature an, das
-- serverseitig noch nicht existiert.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-01', 'feature',
  'Gildenlevel-Deckel von 30 auf 100 angehoben',
  'Für Gilden, die bereits Level 30 (das bisherige Maximum) erreicht hatten, gibt es jetzt ein viel größeres Ziel: der neue Deckel liegt bei Level 100, mit einer spürbar steileren Erfahrungskurve. Vier neue Erfolge/Titel für Level 40, 60, 80 und 100. Bereits erreichte Level 1-30 bleiben unverändert.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-01' and title = 'Gildenlevel-Deckel von 30 auf 100 angehoben'
);
