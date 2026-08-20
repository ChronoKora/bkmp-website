-- Bkmp - Markiert die beiden am 19./20.08.2026 ueber das Feedback-Board
-- gemeldeten Bugs (Kaledoss: Stufenleiste; FlinkerBoy7289: Arena-Champion-
-- Titel) als veroeffentlichte, behobene Eintraege im oeffentlichen
-- Status-Board (public.feedback_public). source_feedback_id bleibt NULL
-- (keine DB-Verbindung zur privaten Original-Einreichung von hier aus
-- moeglich) - unschaedlich, die Spalte ist nullable und rein informativ.
-- Bereits fertig ausgefuellt, kein Platzhalter - einfach im Supabase SQL
-- Editor ausfuehren. Idempotent (ueberspringt sich bei erneutem Ausfuehren
-- selbst, matched auf title).

insert into public.feedback_public (kind, title, category, status, description, response, author_mode, is_published, published_at, last_public_update, resolved_at)
select 'bug',
  'Stufenleiste verschwindet nach einem Dungeon-/Turm-Lauf',
  'dungeons',
  'behoben',
  'Nach dem Abschließen eines Dungeon- oder Turm-Laufs verschwand die Stufen-Auswahl (Automatisch/Beste Stufe/Stufe wählen) dauerhaft - nur ein Neuladen der Seite half.',
  'Gefunden und behoben: das schließende Ergebnis-Fenster blockierte danach unsichtbar weiter Klicks im Hintergrund. Ab sofort bleibt die Stufenleiste nach jedem Lauf normal bedienbar, kein Neuladen mehr nötig.',
  'anonymous', true, now(), now(), now()
where not exists (
  select 1 from public.feedback_public where title = 'Stufenleiste verschwindet nach einem Dungeon-/Turm-Lauf'
);

insert into public.feedback_public (kind, title, category, status, description, response, author_mode, is_published, published_at, last_public_update, resolved_at)
select 'bug',
  'Arena-Champion (und weitere Gilde/Weltboss-Titel) zeigen faelschlich gesperrt',
  'kampf',
  'behoben',
  'Der Titel "Arena-Champion" (200 gewonnene Arena-Kämpfe) und ähnliche Gilde-/Weltboss-Titel konnten im Idle-Dorf selbst dauerhaft als gesperrt angezeigt werden, obwohl die eigentliche Bedingung längst erfüllt war.',
  'Gefunden und behoben: die interne Freischalt-Prüfung des Idle-Dorfs kannte den aktuellen Arena-/Weltboss-/Gilden-Stand bisher nicht vollständig - dadurch konnte auch der zugehörige Kampfbonus fehlen. Betroffene Titel (inkl. ihres Bonus) schalten sich jetzt beim nächsten Öffnen automatisch korrekt frei.',
  'anonymous', true, now(), now(), now()
where not exists (
  select 1 from public.feedback_public where title = 'Arena-Champion (und weitere Gilde/Weltboss-Titel) zeigen faelschlich gesperrt'
);
