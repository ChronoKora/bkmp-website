-- Bkmp - Oeffentlicher Changelog-Eintrag: Startseite deutlich schneller
-- (02.10.2026, siehe CHANGELOG.md fuer die technische Herleitung). Gleiches
-- idempotentes Muster wie alle bisherigen sql/*-changelog-*.sql-Dateien -
-- bereits fertig ausgefuellt, einfach im Supabase SQL Editor ausfuehren,
-- mehrfaches Ausfuehren ist unschaedlich.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-02', 'change',
  'Website lädt deutlich schneller',
  'Beim Öffnen der Website wurden bisher im Hintergrund über 20 MB an Bildern und Videos geladen, die man auf der Startseite gar nicht sieht (vor allem die Plüshie-Bilder der Bestenliste in voller Größe). Die Plüshies nutzen jetzt kleine Vorschaubilder und Videos laden erst, wenn sie wirklich gebraucht werden – die Seite ist dadurch spürbar schneller da, besonders am Handy.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-02' and title = 'Website lädt deutlich schneller'
);
