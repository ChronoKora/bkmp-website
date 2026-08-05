-- Bkmp - Oeffentlicher Changelog-Eintrag: fehlende XP-Anzeige bei Jugendlich-
-- Drachen behoben + Kampf-EP des Begleitdrachen laeuft jetzt auch offline/
-- ueber Nacht weiter (05.08.2026). Gleiches idempotentes Muster wie
-- sql/20260726-changelog.sql / sql/20260804-changelog-rune-cap-removed.sql.
-- Bereits fertig ausgefuellt, kein Platzhalter.
--
-- Zwei Bugs, ein gemeinsamer Eintrag (beide vom Spieler in derselben
-- Meldung angesprochen, beide im selben Bereich "Drachenzucht/Begleiter").

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-05', 'fix',
  'Begleitdrache: Kampf-EP-Anzeige gefehlt + kein Fortschritt über Nacht',
  'Bei Jugendlich-Drachen war die Kampf-EP-Zahl unter dem Fortschrittsbalken unsichtbar (Zahl war da, wurde aber vom Balken selbst abgeschnitten) - ist jetzt wieder gut lesbar. Außerdem sammelte ein als Begleiter gesetzter Jugendlich-Drache bisher NUR während ihr aktiv gespielt habt Kampf-EP - während einer Abwesenheit (auch über Nacht) passierte gar nichts. Der Begleitdrache wächst jetzt auch offline mit weiter, in etwa dem Tempo, das er live erreicht hätte.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-05' and title = 'Begleitdrache: Kampf-EP-Anzeige gefehlt + kein Fortschritt über Nacht'
);
