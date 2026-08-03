-- Bkmp - Oeffentlicher Changelog-Eintrag: Visueller Feinschliff der
-- Kampfansicht (04.08.2026). Gleiches idempotentes Muster wie
-- sql/20260726-changelog.sql / sql/20260803-changelog-schluesselmeister-
-- removed.sql. Bereits fertig ausgefuellt, kein Platzhalter.
--
-- Reiner Anzeige-/Gefuehl-Eintrag - keine Kampfmechanik/-werte geaendert,
-- daher unabhaengig von jeder anderen SQL-Migration sofort einsetzbar.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-04', 'change',
  'Kampfansicht spürbar überarbeitet',
  'Schadenszahlen, Gegnerwechsel, Trefferfeedback und Belohnungsanzeigen im Kampf fühlen sich jetzt runder an: Schadenszahlen stapeln sich nicht mehr exakt übereinander und häufen sich bei schnellem Kämpfen nicht mehr unbegrenzt an, kritische Treffer sind deutlicher zu erkennen, ein neuer Drache blendet weich statt hart ein, das Dorf zeigt bei einem Treffer ein kurzes rotes Aufleuchten, und neue kurze Meldungen zeigen Sieg/Bosskampf/Nächste-Stufe/Niederlage direkt im Kampfbereich an. Alle Effekte respektieren weiterhin eure Einstellungen unter "Effekte".'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-04' and title = 'Kampfansicht spürbar überarbeitet'
);
