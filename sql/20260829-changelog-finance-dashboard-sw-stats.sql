-- Bkmp - Oeffentliche Changelog-Eintraege: Umsatzseiten-Ausbau + neuer
-- SW-Besucher-Bereich (29.08.2026, siehe CLAUDE.md/CHANGELOG.md fuer die
-- vollstaendige technische Root-Cause-/Verifikationsdoku). Gleiches
-- idempotentes Muster wie alle bisherigen sql/*-changelog-*.sql-Dateien
-- (Tabelle+RLS bereits live seit sql/20260726-changelog.sql, hier nur
-- weitere Zeilen). Bereits fertig ausgefuellt, kein Platzhalter - einfach
-- im Supabase SQL Editor ausfuehren, mehrfaches Ausfuehren ist unschaedlich.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-29', 'feature',
  'Umsatzseite deutlich erweitert + neuer Bereich für SW-Besucherzahlen',
  'Die Umsatzseite zeigt jetzt deutlich mehr auf einen Blick: Vergleichswerte zur Vorwoche, eine kompakte Kennzahlen-Übersicht (u.a. bester Tag, durchschnittlicher Umsatz pro Tag, Gewinnmarge), eine eigene Verkaufsstatistik für Bücher sowie eine optionale Monats-Prognose. Neu dazugekommen ist außerdem ein eigener Bereich für die täglichen /sw bk-Besucherzahlen unserer CityBuilds, inklusive Verlaufsdiagramm und Top-5-Ranglistenstatus.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-29' and title = 'Umsatzseite deutlich erweitert + neuer Bereich für SW-Besucherzahlen'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-29', 'fix',
  'Text auf der Umsatzseite bei bestimmten Akzentfarben schwer lesbar',
  'Ein paar neue Werte auf der Umsatzseite (u.a. die Monats-Prognose) nutzten versehentlich die frei wählbare Akzentfarbe der Seite - bei einer dunkel gewählten Farbe waren sie dadurch kaum noch lesbar. Diese Stellen nutzen jetzt eine feste, immer gut sichtbare Farbe.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-29' and title = 'Text auf der Umsatzseite bei bestimmten Akzentfarben schwer lesbar'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-29', 'fix',
  'Diagramme auf der Umsatzseite übersichtlicher',
  'Die Verlaufsdiagramme auf der Umsatzseite zeigen jetzt zusätzlich zum Höchstwert auch den Durchschnitt und den niedrigsten Wert direkt am Rand an. Außerdem bezieht sich die Auswertung der SW-Besucherzahlen jetzt korrekt auf den zuletzt abgeschlossenen Tag statt auf den noch laufenden aktuellen Tag.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-29' and title = 'Diagramme auf der Umsatzseite übersichtlicher'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-29', 'fix',
  'Umsatzseite konnte in seltenen Fällen abgeschnitten wirken',
  'In seltenen Fällen konnte nach bestimmten Interaktionen auf der Umsatzseite ein Teil des Inhalts am unteren Rand nicht mehr sichtbar sein. Die Seite passt ihre Höhe jetzt zuverlässiger an, sodass immer der komplette Inhalt sichtbar bleibt.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-29' and title = 'Umsatzseite konnte in seltenen Fällen abgeschnitten wirken'
);
