-- Bkmp - Oeffentlicher Changelog-Eintrag: neuer Drache DerJannikHase
-- (05.10.2026, siehe CHANGELOG.md). Idempotent - mehrfaches Ausfuehren ist
-- unschaedlich. NACH sql/20261005-dragon-species-derjannikhase.sql ausfuehren
-- (erst wenn der Drache in der Datenbank steht, sollte der Eintrag sichtbar sein).
-- Kategorie 'feature' - die Tabelle erlaubt nur fix/feature/change/balance.
-- Einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-05', 'feature',
  'Neuer Drache: DerJannikHase',
  'Ein neuer epischer Drache ist da: DerJannikHase, ein schwarz-goldener Ritterdrache mit Ei, Baby, Jugendlich und Erwachsen. Das Ei findest du wie gewohnt im Ei-Dungeon und kannst es im Drachenlager ausbrüten.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-05' and title = 'Neuer Drache: DerJannikHase'
);
