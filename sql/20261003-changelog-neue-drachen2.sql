-- Bkmp - Oeffentlicher Changelog-Eintrag: 16 neue Drachen im Ei-Dungeon
-- (03.10.2026, siehe CHANGELOG.md). Idempotent - mehrfaches Ausfuehren ist
-- unschaedlich. NACH sql/20261003-dragon-species-neue-drachen2.sql ausfuehren
-- (erst wenn die Drachen in der Datenbank stehen, sollte der Eintrag sichtbar sein).
-- Einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-03', 'feature',
  '16 neue Drachen im Ei-Dungeon',
  '16 neue Drachenarten sind da – jede mit Ei, Baby, Jugendlich und Erwachsen: Almerio, Alphorius, Dayman, GrumpyJedi, Jodeljochen, Lukas, MaxEnder, MiaTao, Randomauto, Ronjawolf, Scusy, StarManius, Troasa, Tsheyn, Vaelith und Surebrec. Almerio, Alphorius, MaxEnder, Ronjawolf, Tsheyn und Vaelith sind legendär, die anderen zehn episch. Die Eier findest du wie gewohnt im Ei-Dungeon und kannst sie im Drachenlager ausbrüten.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-03' and title = '16 neue Drachen im Ei-Dungeon'
);
