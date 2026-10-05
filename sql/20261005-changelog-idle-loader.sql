-- Bkmp - Oeffentlicher Changelog-Eintrag: Ladebildschirm beim Oeffnen des Drachen-Idle-Games
-- (05.10.2026, siehe CHANGELOG.md). Idempotent - mehrfaches Ausfuehren ist
-- unschaedlich. Erst NACH dem Deploy ausfuehren (der Ladebildschirm muss live sein).
-- Kategorie 'change' - die Tabelle erlaubt nur fix/feature/change/balance.
-- Einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-05', 'change',
  'Neuer Ladebildschirm im Drachen-Idle-Game',
  'Wenn du das Drachen-Idle-Game öffnest und das Laden einen Moment dauert, siehst du jetzt einen kleinen Ladebildschirm mit Drache und Fortschrittsbalken statt eines leeren Fensters. Bei schnellem Laden erscheint er gar nicht erst. Dein Menü und der Schließen-Knopf bleiben dabei jederzeit bedienbar.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-05' and title = 'Neuer Ladebildschirm im Drachen-Idle-Game'
);
