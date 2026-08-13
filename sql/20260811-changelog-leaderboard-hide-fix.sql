-- Bkmp - Oeffentlicher Changelog-Eintrag: Bestenlisten-Sichtbarkeit
-- faelschlich fuer mehrere Spieler entfernt (11.08.2026). Gleiches
-- idempotentes Muster wie sql/20260805-changelog-boss-banner-repeat.sql.
-- Bereits fertig ausgefuellt, kein Platzhalter.
--
-- Bewusst OHNE Anti-Cheat-Details (interne Sicherheitsmassnahme, nicht fuer
-- die oeffentliche Ansicht gedacht) - nur der fuer Spieler sichtbare Effekt.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-11', 'fix',
  'Einige Accounts fehlten faelschlich in der Bestenliste',
  'Ein interner Prüfmechanismus hatte mehrere Accounts fälschlich aus der öffentlichen Bestenliste entfernt, obwohl damit alles in Ordnung war. Betroffen war nur die Anzeige - der eigene Spielstand/Fortschritt war zu keinem Zeitpunkt beeinträchtigt. Behoben, alle betroffenen Accounts sind wieder sichtbar.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-11' and title = 'Einige Accounts fehlten faelschlich in der Bestenliste'
);
