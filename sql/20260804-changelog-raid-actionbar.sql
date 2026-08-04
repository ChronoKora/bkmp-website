-- Bkmp - Oeffentlicher Changelog-Eintrag: Weltboss-Kampfleiste aufgeraeumt +
-- Ein/Aus-Schalter "Automatischer Bosskampf" (04.08.2026). Gleiches
-- idempotentes Muster wie sql/20260726-changelog.sql /
-- sql/20260803-changelog-schluesselmeister-removed.sql /
-- sql/20260804-changelog-combat-visual-polish.sql. Bereits fertig
-- ausgefuellt, kein Platzhalter.
--
-- Reiner Anzeige-/Komfort-Eintrag - keine Kampfmechanik/-werte geaendert,
-- daher unabhaengig von jeder anderen SQL-Migration sofort einsetzbar.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-04', 'change',
  'Weltboss-Kampfleiste aufgeräumt',
  'Der rote "⚔️ Angreifen"-Knopf beim stündlichen Weltboss ist entfallen - er tat genau dasselbe wie ein Tipp auf den Boss selbst oder die Leertaste. Die Anzeige daneben zeigt jetzt eure Klick-Anzahl statt der (bereits weiter unten sichtbaren) Schadenssumme. Der Prestige-Skill "Automatischer Bosskampf" lässt sich jetzt außerdem an der Prestige-Karte gezielt an- und ausschalten, statt euch dauerhaft automatisch beitreten zu lassen.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-04' and title = 'Weltboss-Kampfleiste aufgeräumt'
);
