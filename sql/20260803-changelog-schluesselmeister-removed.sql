-- Bkmp - Oeffentlicher Changelog-Eintrag: Prestige-Knoten "Schluesselmeister"
-- entfernt (03.08.2026). Gleiches idempotentes Muster wie
-- sql/20260726-changelog.sql. Bereits fertig ausgefuellt.
--
-- Setzt voraus, dass sql/20260803-remove-schluesselmeister-fixed-slots-
-- only.sql bereits gelaufen ist (sonst waere der Eintrag oeffentlich
-- sichtbar, bevor die Rueckerstattung/Server-Aenderung tatsaechlich live ist).

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-03', 'change',
  'Prestige-Skill "Schlüsselmeister" entfernt',
  'Der Skill "Schlüsselmeister" (schnellere Dungeon-Schlüssel-Regeneration) ist entfallen, da die Schlüssel-Zeiten für alle Spieler fest auf dieselben Uhrzeiten (0/4/8/12/16/20 Uhr) laufen. Bereits investierte Prestige-Punkte wurden euch beim nächsten Öffnen des Spiels automatisch vollständig zurückerstattet.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-03' and title = 'Prestige-Skill "Schlüsselmeister" entfernt'
);
