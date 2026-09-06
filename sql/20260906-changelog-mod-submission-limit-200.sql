-- Bkmp - Oeffentlicher Changelog-Eintrag: taegliches Einreiche-Limit fuer
-- die OPBK-Mod erhoeht (06.09.2026, siehe CLAUDE.md/CHANGELOG.md fuer die
-- vollstaendige technische Herleitung). Ersetzt eine zwischenzeitlich
-- erwogene, nie live ausgefuehrte Erhoehung auf 30 direkt durch 200 -
-- kein zweiter Eintrag fuer den nie live gewesenen Zwischenschritt.
-- Gleiches idempotentes Muster wie alle bisherigen sql/*-changelog-*.sql-
-- Dateien (Tabelle+RLS bereits live seit sql/20260726-changelog.sql, hier
-- nur eine weitere Zeile). Bereits fertig ausgefuellt, kein Platzhalter -
-- einfach im Supabase SQL Editor ausfuehren, mehrfaches Ausfuehren ist
-- unschaedlich.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-09-06', 'change',
  'Tägliches Einreiche-Limit für Karten deutlich erhöht',
  'Über die OPBK-Mod könnt ihr jetzt bis zu 200 Kartenvorschläge pro Tag einreichen (vorher 25).'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-09-06' and title = 'Tägliches Einreiche-Limit für Karten deutlich erhöht'
);
