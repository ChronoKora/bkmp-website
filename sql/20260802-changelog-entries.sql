-- Bkmp - Oeffentliche Changelog-Eintraege fuer den 02.08.2026. Gleiches
-- idempotentes Muster wie sql/20260726-changelog.sql (Pruefung per
-- Datum+Titel - erneutes Ausfuehren erzeugt keine Duplikate). Bereits
-- fertig ausgefuellt, kein Platzhalter.
--
-- Alle drei Themen sind reine Client-Aenderungen (kein Datenbank-Schema
-- betroffen, keine andere SQL-Datei muss vorher laufen) - unbedenklich,
-- sobald der zugehoerige Code-Stand deployed ist.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-02', 'feature',
  'Eier und Baby-Drachen freilassen',
  'Im Eierlager und bei der Fütterung gibt es jetzt einen kleinen Papierkorb-Knopf oben rechts auf der Karte, um ein einzelnes Ei oder einen Baby-Drachen freizulassen. Bei mehreren Eiern derselben Art wird immer nur eins entfernt - der Rest bleibt sicher im Lager. Eine Bestätigung schützt vor versehentlichem Klicken.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-02' and title = 'Eier und Baby-Drachen freilassen'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-02', 'change',
  'Drachen-Aufstieg jetzt für alle Seltenheiten',
  'Der "Aufsteigen"-Knopf im Drachenlager (zwei gleiche erwachsene Drachen zu einer stärkeren Stufe verbinden) war bisher nur für legendäre Drachen verfügbar - jetzt könnt ihr Standard-, seltene, epische und legendäre Drachen gleichermaßen aufsteigen lassen. Kosten und Bonus pro Stufe bleiben unverändert.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-02' and title = 'Drachen-Aufstieg jetzt für alle Seltenheiten'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-02', 'feature',
  'Roter Punkt am Changelog-Knopf bei neuen Einträgen',
  'Der "📜 Changelog"-Knopf zeigt jetzt einen kleinen roten Punkt an, sobald es einen neuen Eintrag gibt, den ihr noch nicht gesehen habt - verschwindet automatisch, sobald ihr das Fenster einmal öffnet.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-02' and title = 'Roter Punkt am Changelog-Knopf bei neuen Einträgen'
);
