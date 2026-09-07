-- Bkmp - Oeffentlicher Changelog-Eintrag: versteckte stuendliche Bild-
-- Upload-Bremse beim Karten-Einreichen behoben (06.09.2026, siehe
-- CLAUDE.md/CHANGELOG.md fuer die vollstaendige technische Herleitung).
-- Gleiches idempotentes Muster wie alle bisherigen sql/*-changelog-*.sql-
-- Dateien (Tabelle+RLS bereits live seit sql/20260726-changelog.sql, hier
-- nur eine weitere Zeile). Bereits fertig ausgefuellt, kein Platzhalter -
-- einfach im Supabase SQL Editor ausfuehren, mehrfaches Ausfuehren ist
-- unschaedlich.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-09-06', 'fix',
  'Einreichen mehrerer Karten hintereinander blockierte zu früh',
  'Beim Einreichen mehrerer Karten kurz hintereinander (z. B. mehrere MapArt-Wände nacheinander) konnte es passieren, dass ihr schon nach etwa 15 Einreichungen blockiert wurdet, obwohl das eigentliche Tageslimit deutlich höher liegt. Ursache war eine zusätzliche, zu enge stündliche Bremse beim Bildupload - die ist jetzt an das echte Tageslimit angeglichen.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-09-06' and title = 'Einreichen mehrerer Karten hintereinander blockierte zu früh'
);
