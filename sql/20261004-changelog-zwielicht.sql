-- Bkmp - Oeffentliche Changelog-Eintraege: Zwielicht-Event, Lightnix/Darknix,
-- Goettliche Erweckung, kleine Wochenereignisse (Drachendorf-Ausbau Phase 7-11).
-- Fertig ausgefuellt, idempotent (mehrfaches Ausfuehren unschaedlich).
--
-- WICHTIG: erst am Tag der Ankuendigung ausfuehren - also NACHDEM
--   select public.special_event_schedule('zwielicht', '<Montag>', 3);
-- gelaufen ist. Vorher wuerde der Changelog ein Event verraten, das es
-- noch nicht gibt. Das Datum unten (zweimal pro Eintrag) vorher auf den
-- echten Ankuendigungstag setzen.
-- Voraussetzung: alle sql/20261004-0*/-10-Dateien sind ausgefuehrt.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-05', 'feature',
  'Idle-Dorf: ☀️🌑 Das Erwachen des Zwielichts',
  'Das erste große Spezial-Event im Drachendorf! Sieben Tage lang, von Montag 00:00 bis Sonntag 23:59 Uhr, läuft der kostenlose Zwielicht-Pass mit 30 Stufen. Jeden Tag gibt es 5 neue Prüfungen und einen Tagesabschluss, dazu große Wochenquests. Unterwegs warten Truhen, Runen, zwei garantierte Dracheneier (🥚 Dayman auf Stufe 10, 🥚 Surebrec auf Stufe 20 – kein Zufall), der Titel „Zwielicht-Wanderer“, ein Abzeichen und die Namensfarbe „Zwielicht“. Wer Stufe 30 erreicht, wählt seinen Weg: ☀️ Lightnix oder 🌑 Darknix – nur einer pro Account. Beide Drachen haben fünf Entwicklungsstufen bis hin zur göttlichen Form. Hinweis: Das Event verlangt echtes Spielen über mehrere Tage, Stufe 30 ist frühestens gegen Ende der Woche erreichbar.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-05' and title = 'Idle-Dorf: ☀️🌑 Das Erwachen des Zwielichts'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-05', 'feature',
  'Idle-Dorf: Die Göttliche Erweckung',
  'Lightnix und Darknix besitzen eine fünfte Entwicklungsstufe: ✨ Göttlich. Sie entsteht nicht durch normale Kampf-Erfahrung, sondern durch einen eigenen Weg: eine starke Bindung (Stufe 5), echte gemeinsame Abenteuer (Kampfzeit als Begleiter, gemeinsam besiegte Bosse und Expeditionen) und eine große Gold-Opfergabe, die du in beliebig vielen Teilen einzahlen kannst. Sind alle Bedingungen erfüllt, gelingt die Erweckung immer. Der göttliche Drache ist spürbar stärker und erhält eine eigene Aura: das Licht schützt dein Dorf, die Finsternis stärkt deine Angriffe. Name, Eigenschaft und Bindung bleiben erhalten – es gibt keinen Zeitdruck.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-05' and title = 'Idle-Dorf: Die Göttliche Erweckung'
);

-- Diesen Eintrag erst ausfuehren, wenn das erste kleine Wochenereignis
-- (Brutwoche, Runenmond, Bossjagd, Erntefest, Expeditionsfieber oder
-- Gildenwoche) eingeplant ist - Datum entsprechend anpassen.
insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-05', 'feature',
  'Idle-Dorf: Kleine Wochenereignisse',
  'Zwischendurch gibt es jetzt kleine Wochenereignisse mit besonderen Boni: 🥚 Brutwoche (Eier schlüpfen schneller, Babydrachen wachsen stärker), 🌕 Runenmond (Runen-Aufwertungen schlagen seltener fehl), 👑 Bossjagd (mehr Gold und Erfahrung von Bossen), 🌾 Erntefest (mehr Früchte und Fleisch), 🧭 Expeditionsfieber (mehr Expeditionsbeute) und 🛡️ Gildenwoche (Gildenprojekte kommen schneller voran). Laufende Ereignisse siehst du direkt im Kampf-Reiter.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-05' and title = 'Idle-Dorf: Kleine Wochenereignisse'
);
