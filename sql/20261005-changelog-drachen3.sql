-- Bkmp - Oeffentlicher Changelog-Eintrag: 4 neue Drachen Wuchi, Muecke, Flinkerboy, CodeWizard
-- (05.10.2026, siehe CHANGELOG.md). Idempotent - mehrfaches Ausfuehren ist
-- unschaedlich. NACH sql/20261005-dragon-species-drachen3.sql ausfuehren (erst wenn
-- die Drachen in der Datenbank stehen, sollte der Eintrag sichtbar sein).
-- Kategorie 'feature' - die Tabelle erlaubt nur fix/feature/change/balance.
-- Einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-05', 'feature',
  '4 neue Drachen: Wuchi, Muecke, Flinkerboy & CodeWizard',
  'Vier neue Drachen sind da, jeweils mit Ei, Baby, Jugendlich und Erwachsen: die legendären Drachen Wuchi und Muecke sowie die epischen Drachen Flinkerboy und CodeWizard. Die Eier findest du wie gewohnt im Ei-Dungeon und kannst sie im Drachenlager ausbrüten.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-05' and title = '4 neue Drachen: Wuchi, Muecke, Flinkerboy & CodeWizard'
);
