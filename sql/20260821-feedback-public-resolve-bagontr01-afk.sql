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
  'Gefunden und behoben: war die aktuelle Kampf-Stufe offline nicht simulierbar gewinnbar, ging die komplette Abwesenheit leer aus - egal wie lange sie war. Es gibt jetzt einen garantierten Mindestlohn, der unabhängig davon greift und eine Abwesenheit nie mehr komplett leer ausgehen lässt.',
  'anonymous', true, now(), now(), now()
where not exists (
  select 1 from public.feedback_public where title = 'AFK-/Offline-Belohnung war teils komplett 0'
);
