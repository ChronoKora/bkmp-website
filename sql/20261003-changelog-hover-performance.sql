-- Bkmp - Oeffentlicher Changelog-Eintrag: Idle-Dorf reagiert wieder sofort
-- (03.10.2026, siehe CHANGELOG.md/CLAUDE.md fuer die technische Herleitung).
-- Gleiches idempotentes Muster wie alle bisherigen sql/*-changelog-*.sql-
-- Dateien - fertig ausgefuellt, einfach im Supabase SQL Editor ausfuehren,
-- mehrfaches Ausfuehren ist unschaedlich.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-03', 'fix',
  'Idle-Dorf reagiert wieder sofort auf die Maus',
  'Knöpfe im Drachendorf haben beim Drüberfahren mit der Maus teils eine halbe Sekunde verzögert reagiert – auch mit „Effekte: Aus“. Ursache war ein unscheinbarer Leucht-Effekt am Fensterrahmen, der den Browser gezwungen hat, das komplette Fenster in jedem Bild neu zu zeichnen. Behoben: das Fenster sieht gleich aus, braucht aber nur noch einen Bruchteil der Grafikleistung. „Effekte: Aus“ schaltet jetzt außerdem wirklich alle dekorativen Animationen im Spiel ab. Neu: In der Tagesauftrags-Karte im Kampf-Tab führen Kurzlinks direkt zu Kalender, Bestiarium und Zielen.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-03' and title = 'Idle-Dorf reagiert wieder sofort auf die Maus'
);
