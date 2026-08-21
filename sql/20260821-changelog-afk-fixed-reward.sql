-- Bkmp - Oeffentlicher Changelog-Eintrag: fester Wert fuer Offline-/AFK-
-- Belohnungen anhand der hoechsten Stufe (21.08.2026). Gleiches
-- idempotentes Muster wie sql/20260811-changelog-leaderboard-hide-fix.sql.
-- Bereits fertig ausgefuellt, kein Platzhalter - einfach im Supabase SQL
-- Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-21', 'feature',
  'Offline-/AFK-Belohnung neu: fester Wert anhand deiner höchsten Stufe',
  'Die Offline-/AFK-Belohnung wurde komplett überarbeitet. Statt eines simulierten Kampfs (der unter bestimmten Umständen 0 Belohnung ergeben konnte) gibt es jetzt einen festen, vorhersehbaren Wert - berechnet aus deiner höchsten je erreichten Stufe. Eine Abwesenheit geht dadurch nie mehr leer aus und liefert bei gleicher Dauer immer denselben, verlässlichen Betrag.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-21' and title = 'Offline-/AFK-Belohnung neu: fester Wert anhand deiner höchsten Stufe'
);
