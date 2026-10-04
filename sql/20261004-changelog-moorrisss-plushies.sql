-- Bkmp - Oeffentlicher Changelog-Eintrag: neuer Drache Moorrisss + 3 neue Plueshies
-- (04.10.2026, siehe CHANGELOG.md). Idempotent - mehrfaches Ausfuehren ist
-- unschaedlich. NACH sql/20261004-dragon-species-moorrisss.sql und
-- sql/20261004-plushies-ccatched-tsheyn-sunnyyvi.sql ausfuehren (erst wenn Drache
-- und Plueshies in der Datenbank stehen, sollte der Eintrag sichtbar sein).
-- Kategorie 'feature' - die Tabelle erlaubt nur fix/feature/change/balance.
-- Einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-04', 'feature',
  'Neuer Drache Moorrisss + 3 neue Plüschies',
  'Ein neuer epischer Drache ist da: Moorrisss – mit Ei, Baby, Jugendlich und Erwachsen. Das Ei findest du wie gewohnt im Ei-Dungeon und kannst es im Drachenlager ausbrüten. Außerdem gibt es drei neue Plüschies: Ccatched, Tsheyn und Sunnyyvi.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-04' and title = 'Neuer Drache Moorrisss + 3 neue Plüschies'
);
