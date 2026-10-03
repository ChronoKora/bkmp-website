-- Bkmp - Oeffentliche Changelog-Eintraege: Drachendorf-Ausbau (ab 04.10.2026,
-- siehe CHANGELOG.md fuer die technische Herleitung). Gleiches idempotentes
-- Muster wie alle bisherigen sql/*-changelog-*.sql-Dateien - fertig
-- ausgefuellt, im Supabase SQL Editor ausfuehren, mehrfaches Ausfuehren ist
-- unschaedlich.
--
-- WICHTIG: erst ausfuehren, wenn der Branch feature/drachendorf-ausbau live
-- ist UND die zugehoerigen Datenbank-Dateien gelaufen sind
-- (sql/20261004-02-village-projects.sql fuer die Dorfentwicklung).
-- Das Datum kann vor dem Ausfuehren auf den echten Veroeffentlichungstag
-- angepasst werden (jeweils an beiden Stellen pro Eintrag).

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-04', 'change',
  'Idle-Dorf: Aufgeräumte Navigation in 4 Bereichen',
  'Die vielen Reiter im Drachendorf sind jetzt in vier Bereiche sortiert: ⚔️ Abenteuer (Kampf, Dungeon, Turm, Arena), 🏡 Entwicklung (Upgrades, Dorfentwicklung, Skilltree, Prestige, Runen), 🐉 Drachen & Sammlung (Drachenzucht, Dorf-Skins, Erfolge, Bestenliste) und 🛡️ Gemeinschaft (Gilde, Gilden-Tech, Gildenboss, Gilden-Arena). Am PC lassen sich die Bereiche ein- und ausklappen, auf dem Handy ist das „Mehr“-Menü genauso gruppiert. Das Spiel merkt sich außerdem, wo du zuletzt warst, und öffnet beim nächsten Mal direkt dort.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-04' and title = 'Idle-Dorf: Aufgeräumte Navigation in 4 Bereichen'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-04', 'feature',
  'Idle-Dorf: Dorfentwicklung – Drachenhafen & Handelsposten',
  'Unter 🏡 Entwicklung gibt es jetzt die 🏗️ Dorfentwicklung mit großen Bauprojekten für dein Dorf. Der ⚓ Drachenhafen (3 Ausbaustufen) ist der Startpunkt für Drachen-Expeditionen. Der 🏪 Handelsposten bietet dir jeden Tag neue Tauschangebote, z. B. Holz gegen Kristalle, Stein gegen Essenz, Gold gegen Futter, Kristalle gegen eine Rune und manchmal sogar ein seltenes Drachenei. Gebaut wird mit Gold, Holz, Stein, Kristallen und Essenz – fertige Bauten bleiben auch nach einem Prestige erhalten. Die Angebote wechseln jeden Tag um 00:00 Uhr.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-04' and title = 'Idle-Dorf: Dorfentwicklung – Drachenhafen & Handelsposten'
);

-- Erst nach sql/20261004-01-drachendorf-grundlage.sql und
-- sql/20261004-03-expeditions.sql ausfuehren.
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-04', 'feature',
  'Idle-Dorf: Drachen-Expeditionen',
  'Mit dem ⚓ Drachenhafen kannst du deine erwachsenen Drachen auf Expeditionen schicken (1, 4 oder 8 Stunden) – zu finden im Drachenzucht-Reiter. Fünf Regionen warten: 🌲 Flüsterwald, 🌋 Glutberge, ❄️ Frostklamm, 🌌 Endriss und das 🐲 Verbotene Drachental. Jede Mission hat eigene Bedingungen und Empfehlungen (z. B. Elemente oder verschiedene Arten) – es lohnt sich also, verschiedene Drachen einzusetzen, nicht nur die stärksten. Keine Expedition geht leer aus: Je besser das Team passt, desto höher die Qualität (⭐ bis ⭐⭐⭐⭐) und die Belohnung. Unterwegs passieren Ereignisse wie Schatztruhen, Kristalladern oder sogar ein geheimnisvolles Ei. „✨ Team vorschlagen“ hilft bei der Zusammenstellung. Drachen auf Expedition können nicht kämpfen oder freigelassen werden.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-04' and title = 'Idle-Dorf: Drachen-Expeditionen'
);
