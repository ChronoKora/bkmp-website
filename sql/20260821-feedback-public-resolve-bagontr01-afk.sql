-- Bkmp - Markiert den am 21.08.2026 gemeldeten "0 AFK-Belohnung nach
-- ganzem Abend"-Bug als veroeffentlichten, behobenen Eintrag im
-- oeffentlichen Status-Board (public.feedback_public). source_feedback_id
-- bleibt NULL (keine DB-Verbindung von hier aus moeglich, Meldung kam
-- direkt im Chat) - unschaedlich, die Spalte ist nullable und rein
-- informativ. Bereits fertig ausgefuellt, kein Platzhalter - einfach im
-- Supabase SQL Editor ausfuehren. Idempotent (ueberspringt sich bei
-- erneutem Ausfuehren selbst, matched auf title).

insert into public.feedback_public (kind, title, category, status, description, response, author_mode, is_published, published_at, last_public_update, resolved_at)
select 'bug',
  'AFK-/Offline-Belohnung war teils komplett 0',
  'kampf',
  'behoben',
  'Nach einer längeren Abwesenheit gab es teilweise gar keine AFK-Belohnung, obwohl man mehrere Stunden weg war.',
  'Behoben - und dabei gleich das ganze System überarbeitet: die Offline-/AFK-Belohnung wird jetzt als fester, vorhersehbarer Wert anhand deiner höchsten je erreichten Stufe berechnet, statt wie bisher einen Kampf zu simulieren. Eine Abwesenheit kann dadurch strukturell nie mehr leer ausgehen.',
  'anonymous', true, now(), now(), now()
where not exists (
  select 1 from public.feedback_public where title = 'AFK-/Offline-Belohnung war teils komplett 0'
);
