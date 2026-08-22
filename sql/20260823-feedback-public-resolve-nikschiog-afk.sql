-- Bkmp - Markiert den am 23.08.2026 gemeldeten "Offline-/AFK-Belohnung zu
-- niedrig, Kristalle/Essenz fehlen"-Bug (Spieler NikschiOG, Feedback-Board)
-- als veroeffentlichten, behobenen Eintrag im oeffentlichen Status-Board
-- (public.feedback_public). source_feedback_id bleibt NULL (keine DB-
-- Verbindung von hier aus moeglich) - unschaedlich, die Spalte ist
-- nullable und rein informativ. Bereits fertig ausgefuellt, kein
-- Platzhalter - einfach im Supabase SQL Editor ausfuehren. Idempotent
-- (ueberspringt sich bei erneutem Ausfuehren selbst, matched auf title).

insert into public.feedback_public (kind, title, category, status, description, response, author_mode, is_published, published_at, last_public_update, resolved_at)
select 'bug',
  'Offline-/AFK-Belohnung zu niedrig, Kristalle/Essenz fehlten',
  'kampf',
  'behoben',
  'Die Offline-/AFK-Belohnung fiel deutlich zu niedrig aus, Kristalle und Essenz wurden praktisch nie gutgeschrieben.',
  'Behoben - die Berechnung nutzte bisher nur einen einzelnen Referenz-Gegner an deiner höchsten Stufe; landete der zufällig nicht auf einer Boss-/Miniboss-Stufe, fielen Kristalle/Essenz komplett weg und Gold/XP zu niedrig aus. Jetzt fließt die tatsächliche Gegner-Mischung (normal/selten/Miniboss/Boss) mit ein - spürbar mehr Belohnung, Kristalle/Essenz sind jetzt regelmäßig dabei.',
  'anonymous', true, now(), now(), now()
where not exists (
  select 1 from public.feedback_public where title = 'Offline-/AFK-Belohnung zu niedrig, Kristalle/Essenz fehlten'
);
