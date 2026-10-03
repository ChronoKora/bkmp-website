-- Bkmp - Oeffentlicher Changelog-Eintrag: 4 weitere neue Drachen im Ei-Dungeon
-- (03.10.2026, siehe CHANGELOG.md). Idempotent - mehrfaches Ausfuehren ist
-- unschaedlich. NACH sql/20261003-dragon-species-dracheeeee.sql ausfuehren
-- (erst wenn die Drachen in der Datenbank stehen, sollte der Eintrag sichtbar sein).
-- Kategorie 'feature' - die Tabelle erlaubt nur fix/feature/change/balance.
-- Einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-03', 'feature',
  '4 weitere neue Drachen im Ei-Dungeon',
  'Vier neue Drachenarten sind da – jede mit Ei, Baby, Jugendlich und Erwachsen: Byalex und Danw (episch) sowie Ccatched und Sunnyyvi (legendär). Die Eier findest du wie gewohnt im Ei-Dungeon und kannst sie im Drachenlager ausbrüten.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-03' and title = '4 weitere neue Drachen im Ei-Dungeon'
);
