-- Bkmp - Oeffentlicher Changelog-Eintrag: Drachenlager wieder nach Namen sortierbar
-- (05.10.2026, siehe CHANGELOG.md). Idempotent - mehrfaches Ausfuehren ist
-- unschaedlich. Erst NACH dem Deploy ausfuehren (der Knopf muss live sein).
-- Kategorie 'change' - die Tabelle erlaubt nur fix/feature/change/balance.
-- Einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-05', 'change',
  'Drachenlager: Sortierung nach Namen',
  'Im Drachenlager gibt es neben den Seltenheits-Knöpfen jetzt einen A–Z-Knopf. Ein Klick sortiert deine Drachen alphabetisch nach Namen, ein zweiter Klick wechselt zurück zur Sortierung nach Seltenheit. Deine Wahl merkt sich das Spiel auf deinem Gerät.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-05' and title = 'Drachenlager: Sortierung nach Namen'
);
