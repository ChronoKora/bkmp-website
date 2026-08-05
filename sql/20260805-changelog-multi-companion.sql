-- Bkmp - Oeffentlicher Changelog-Eintrag: mehrere gleichzeitige Kampf-
-- Begleiter + neue Begleiter-Leiste (05.08.2026, Spieler-Idee MCSoGGe ueber
-- das oeffentliche Feedback-Board). Gleiches idempotentes Muster wie
-- sql/20260726-changelog.sql. Bereits fertig ausgefuellt, kein Platzhalter.
--
-- WICHTIG: dieser Changelog-Eintrag sollte erst NACH
-- sql/20260805-dragon-multi-companion-slots.sql ausgefuehrt werden, sonst
-- kuendigt er ein Feature an, das technisch noch nicht funktioniert.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-05', 'feature',
  'Bis zu 3 Begleitdrachen gleichzeitig im Kampf',
  'Auf Spielervorschlag: schaltet im Prestige-Baum (Vermächtnis-Zweig) "Weitere Gefährten" frei und rüstet bis zu 3 erwachsene Drachen gleichzeitig als Kampf-Begleiter aus, statt nur einen. Der stärkste zählt automatisch mit voller Kraft, der zweite mit 50%, der dritte mit 25% - eine neue Begleiter-Leiste oben im Drachenzucht-Tab zeigt alle drei Plätze auf einen Blick. Ein Klick auf einen Platz öffnet ein Auswahlfenster mit allen passenden Drachen, ein neuer 4. Block daneben lässt euch gezielt einen jugendlichen Drachen zum Trainieren wählen, und ein neuer Stats-Block zeigt den tatsächlichen Gesamtbonus eurer Begleiter auf einen Blick.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-05' and title = 'Bis zu 3 Begleitdrachen gleichzeitig im Kampf'
);
