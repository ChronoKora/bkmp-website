-- Bkmp - Oeffentliche Changelog-Eintraege: komplettes Mobile-First-Redesign
-- des Idle-Dorf-Kampffensters + 3 begleitende Fixes (06.08.2026). Gleiches
-- idempotentes Muster wie sql/20260726-changelog.sql /
-- sql/20260805-changelog-boss-banner-repeat.sql / sql/20260805-changelog-
-- dragon-growth-xp.sql. Bereits fertig ausgefuellt, kein Platzhalter -
-- einfach im Supabase SQL Editor ausfuehren.
--
-- Nur die vier tatsaechlich SPIELER-relevanten Punkte dieser Session sind
-- hier aufgenommen. Zwei weitere, waehrend des Testens gefundene "Bugs"
-- (Drachen-Sprite unsichtbar, nur 2 von 5 Skilltree-Zweigen) betrafen
-- AUSSCHLIESSLICH die lokale QA-Testumgebung dieser Session (fehlende
-- Testdaten in tests/fixtures/reference-data.js) - kein echter Spieler war
-- je davon betroffen, deshalb bewusst NICHT als oeffentlicher Changelog-
-- Eintrag aufgenommen (waere sonst ein erfundener Bug fuer echte Spieler).

-- ============================================================
-- 1) Kompletter Umbau der Handyansicht (statt nur verkleinerter Desktop-Ansicht).
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-06', 'change',
  'Handyansicht des Kampffensters komplett überarbeitet',
  'Die Handyansicht des Idle-Dorf-Kampffensters war bisher nur eine zusammengedrückte Desktop-Version - jetzt ist sie eigenständig neu aufgebaut: Kopfzeile, Stufenleiste, Kampf-Log und Fußzeile sind deutlich kompakter, die untere Navigation zeigt 4 klare Haupt-Tabs (Kampf/Upgrades/Drachen/Prestige) plus ein aufgeräumtes "Mehr"-Menü für den Rest, statt 7 überfüllter Buttons nebeneinander. Der "Für Streamer"-Link ist auf dem Handy ausgeblendet (bleibt am PC wie gewohnt sichtbar - dort ist er ohnehin am nützlichsten). Am PC/Desktop hat sich dabei nichts verändert.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-06' and title = 'Handyansicht des Kampffensters komplett überarbeitet'
);

-- ============================================================
-- 2) Niederlagen-Meldung (Doppel-Anzeige + riesige Blase) + abgeschnittener
--    Gegnername auf dem Handy.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-06', 'fix',
  'Niederlagen-Meldung & abgeschnittener Gegnername auf dem Handy',
  'Auf dem Handy erschien bei einer Niederlage bisher eine riesige runde Blase UND gleichzeitig noch ein zweiter, großer Hinweis - jetzt gibt es nur noch eine kompakte, gut lesbare Meldung (am PC unverändert). Außerdem wurden lange Gegnernamen bisher mitten im Wort abgeschnitten (z.B. "Schwa…") - sie werden jetzt vollständig angezeigt.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-06' and title = 'Niederlagen-Meldung & abgeschnittener Gegnername auf dem Handy'
);

-- ============================================================
-- 3) Unnoetiger Scrollbalken im geoeffneten Idle-Dorf-Fenster.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-06', 'fix',
  'Unnötiger Scrollbalken im Idle-Dorf-Fenster entfernt',
  'Bei geöffnetem Idle-Dorf-Fenster konnte im Hintergrund noch die ganze Seite mitscrollen - das erzeugte einen kleinen, verwirrenden Scrollbalken am Rand, obwohl es dort nichts zu scrollen gab. Der Hintergrund ist jetzt zuverlässig gesperrt, solange das Fenster offen ist. Zusätzlich wurde der reservierte Platz für die untere Navigation verkleinert, wodurch auch innerhalb der Karte selbst weniger unnötiger Leerlauf-Scroll übrig bleibt.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-06' and title = 'Unnötiger Scrollbalken im Idle-Dorf-Fenster entfernt'
);

-- ============================================================
-- 4) Feedback-/Schliessen-Button-Ueberlappung oben rechts.
-- ============================================================
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-06', 'fix',
  'Feedback- und Schließen-Button überlappten sich',
  'Die beiden runden Buttons oben rechts im Idle-Dorf-Fenster (Feedback und Schließen) lagen zu dicht beieinander und überlappten sich leicht - jetzt haben sie einen sauberen Abstand.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-06' and title = 'Feedback- und Schließen-Button überlappten sich'
);
