-- Bkmp - Oeffentlicher Changelog-Eintrag: Startseite laedt schneller (04.10.2026,
-- siehe CHANGELOG.md). Idempotent - mehrfaches Ausfuehren ist unschaedlich.
-- Kategorie 'change' - die Tabelle erlaubt nur fix/feature/change/balance.
-- Erst ausfuehren, wenn die Aenderung deployed ist.
-- Einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-04', 'change',
  'Startseite lädt spürbar schneller',
  'Mehrere sehr große Bilder (Dorf, Zwerg Grimbold, Bonk-Button, OPSUCHT-Logo) wurden verkleinert und werden nur noch geladen, wenn sie wirklich gebraucht werden. Die Seite lädt dadurch rund ein Drittel weniger Daten – besonders auf Handy und bei langsamer Verbindung geht es merklich schneller.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-04' and title = 'Startseite lädt spürbar schneller'
);
