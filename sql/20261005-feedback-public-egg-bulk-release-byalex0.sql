-- Bkmp - Markiert die am 05.10.2026 gemeldete Idee "Alle Eier einer Art auf
-- einmal loeschen" (Spieler ByAlex0, Feedback-Board) als veroeffentlichten,
-- umgesetzten Eintrag im oeffentlichen Status-Board (public.feedback_public).
-- source_feedback_id bleibt NULL (keine DB-Verbindung von hier aus moeglich) -
-- unschaedlich, die Spalte ist nullable und rein informativ. Bereits fertig
-- ausgefuellt, kein Platzhalter - einfach im Supabase SQL Editor ausfuehren.
-- Idempotent (ueberspringt sich bei erneutem Ausfuehren selbst, matched auf
-- title). Erst NACH dem Deploy ausfuehren. Anzeigename bleibt anonym (Standard) -
-- wer ByAlex0 namentlich nennen will, setzt author_mode auf 'short_name' und
-- author_display auf 'ByAlex0'.

insert into public.feedback_public (kind, title, category, status, description, response, author_mode, is_published, published_at, last_public_update, resolved_at)
select 'idea',
  'Alle Drachen-Eier einer Art auf einmal freilassen',
  'drachen',
  'veroeffentlicht',
  'Wer von manchen Drachenarten fast 100 Eier hat, brauchte bisher unzählige Klicks, um sie einzeln zu löschen.',
  'Umgesetzt - auf jeder Ei-Karte mit mindestens 2 freien Eiern gibt es jetzt den Knopf „Alle freilassen“. Zur Sicherheit bleiben Eier in Nestern immer erhalten, einzigartige Drachen sind ausgenommen und bei epischen/legendären Eiern gibt es eine zweite Nachfrage.',
  'anonymous', true, now(), now(), now()
where not exists (
  select 1 from public.feedback_public where title = 'Alle Drachen-Eier einer Art auf einmal freilassen'
);
