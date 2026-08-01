-- Bkmp - Oeffentlicher Changelog-Eintrag fuer den Gilden-Technologie-Umbau
-- (v3, Baum-System mit Mitglieder-Beitraegen, 31.07.2026, siehe CLAUDE.md-
-- Abschnitt "Gilden-Technologie v3: Baum-System mit Mitglieder-Beitraegen").
-- Gleiches idempotentes Muster wie sql/20260726-changelog.sql/
-- sql/20260730-changelog-entries.sql (Pruefung per Datum+Titel - erneutes
-- Ausfuehren erzeugt keine Duplikate). Bereits fertig ausgefuellt, kein
-- Platzhalter, kein weiterer Handgriff noetig ausser diese Datei einmal im
-- Supabase SQL Editor auszufuehren.
--
-- Hinweis: sollte VOR bzw. zusammen mit sql/20260731-guild-tech-tree-v2-
-- foundation.sql ausgefuehrt werden, sonst kuendigt der Changelog ein
-- Feature an, das serverseitig noch nicht existiert.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-07-31', 'feature',
  'Gilden-Technologie komplett neu: jetzt trägt die ganze Gilde bei',
  'Die Gilden-Technologie ist kein Kauf mehr aus der Gildenkasse durch Anführer/Stellvertreter, sondern ein echter Technologie-Baum, zu dem JEDES Mitglied mit eigenem Gold beitragen kann. Fortschritt wird gemeinsam gesammelt, Vorbedingungen schalten weitere Technologien frei, und es gibt eine neue Rangliste für die fleißigsten Beitragenden eurer Gilde. Bereits erreichter Fortschritt aus dem alten System wurde anteilig übernommen.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-07-31' and title = 'Gilden-Technologie komplett neu: jetzt trägt die ganze Gilde bei'
);
