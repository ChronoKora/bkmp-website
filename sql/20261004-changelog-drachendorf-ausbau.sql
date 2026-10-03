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

-- Erst nach sql/20261004-04-dragon-traits-bond.sql ausfuehren.
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-04', 'feature',
  'Idle-Dorf: Eigenschaften, Bindung & erweitertes Drachen-Lexikon',
  'Jeder erwachsene Drache hat jetzt eine eigene, positive Eigenschaft – zum Beispiel 🪙 Gierig (mehr Gold von Expeditionen), 🧭 Entdecker (öfter besondere Ereignisse), 🛡️ Beschützer (Pech fällt milder aus) oder ✨ Glückskind. Insgesamt gibt es 11 Eigenschaften, keine davon ist schlecht. Dazu kommt die ❤️ Bindung (Stufe 1 bis 10): Sie wächst, wenn du einen Drachen wirklich als Kampfbegleiter einsetzt und auf Expeditionen schickst – ab Bindung 4 hilft er dem ganzen Expeditionsteam. Der Rahmen deiner Drachenkarte wird mit steigender Bindung immer edler. Das Drachen-Lexikon zeigt jetzt Element und Herkunft jeder Art und merkt sich deine persönlichen Rekorde, auch wenn du einen Drachen freilässt.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-04' and title = 'Idle-Dorf: Eigenschaften, Bindung & erweitertes Drachen-Lexikon'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-04', 'feature',
  'Idle-Dorf: Der Dorfpfad',
  'In der 📜 Chronik gibt es den neuen Reiter 🛤️ Pfad: sechs Kapitel von „Die ersten Mauern“ bis „Legenden“ mit insgesamt 33 Zielen, die dein Dorf Schritt für Schritt wachsen lassen. Alles, was du schon geschafft hast, zählt sofort – erfüllte Ziele kannst du direkt abholen, mit „Alle abholen“ auch alle auf einmal. Die Belohnungen wachsen mit dem Kapitel (Gold, EP, Kristalle, Essenz, später auch Runen und Dracheneier). Oben bei den Aufträgen siehst du immer deine nächsten Ziele mit einem „Los →“ direkt zum passenden Bereich.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-04' and title = 'Idle-Dorf: Der Dorfpfad'
);

-- Erst nach sql/20261004-05-guild-projects.sql ausfuehren.
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-04', 'feature',
  'Gilden: Gildenprojekt der Woche',
  'Jede Gilde bekommt jetzt jeden Montag ein gemeinsames 🏗️ Bauprojekt – zum Beispiel einen Großen Wachturm, eine Kristallschmiede oder eine Sternwarte. Alle Mitglieder können Gold, Holz, Stein, Kristalle oder Essenz einzahlen (welche Ressourcen gebraucht werden, steht beim Projekt). Das Ziel richtet sich nach der Zahl der aktiven Mitglieder, kleine Gilden haben also kleinere Ziele. Ist das Projekt fertig, bekommt jedes Mitglied mit mindestens 10 Beitragspunkten 💎 150 Kristalle, 🧪 100 Essenz und eine Rune. Jedes abgeschlossene Projekt bringt der Gilde ein 🏅 Abzeichen.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-04' and title = 'Gilden: Gildenprojekt der Woche'
);
