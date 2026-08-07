-- Bkmp - Oeffentlicher Changelog-Eintrag: neues verstecktes Minispiel-Easter-Egg.
-- Bewusst vage gehalten (Nutzerwunsch "nicht mit zu vielen Infos") - kein Name,
-- kein Hinweis auf den Trigger, keine Mechanik-Details, damit das Suchen/
-- Entdecken selbst der Spass bleibt. Gleiches idempotentes Muster wie alle
-- bisherigen sql/*-changelog-*.sql-Dateien - fertig ausgefuellt, einfach im
-- Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-07', 'feature',
  'Ein neues verstecktes Mini-Spiel-Easter-Egg wurde eingebaut',
  'Irgendwo auf der Seite versteckt sich jetzt ein kleines, komplett neues Easter-Egg-Minispiel. Mehr wird nicht verraten - viel Spaß beim Suchen! 🕵️'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-07' and title = 'Ein neues verstecktes Mini-Spiel-Easter-Egg wurde eingebaut'
);
