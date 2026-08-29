-- Bkmp - Oeffentlicher Changelog-Eintrag: Dungeon-Tab-Kartenraster (29.08.2026,
-- siehe CLAUDE.md fuer die vollstaendige technische Root-Cause-Doku - ein
-- versehentlich in einem CSS-Kommentar eingebautes "*/" hat die Grid-Layout-
-- Regel seit dem 17.07.2026 unbemerkt komplett verschluckt). Gleiches
-- idempotentes Muster wie alle bisherigen sql/*-changelog-*.sql-Dateien.
-- Bereits fertig ausgefuellt, kein Platzhalter - einfach im Supabase SQL
-- Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-29', 'fix',
  'Dungeon-Tab: Kartenraster wieder korrekt angeordnet',
  'Die 7 Dungeon-Karten im Dungeon-Tab wurden durch einen kleinen Darstellungsfehler nicht als sauberes Kartenraster angezeigt, sondern liefen einfach untereinander durch. Das Raster wird jetzt wieder korrekt dargestellt.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-29' and title = 'Dungeon-Tab: Kartenraster wieder korrekt angeordnet'
);
