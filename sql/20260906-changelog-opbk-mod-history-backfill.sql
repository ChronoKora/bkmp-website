-- Bkmp - Oeffentliche Changelog-Eintraege: Nachtrag fuer die OPBK-Mod-
-- Integration seit ihrem Start (06.09.2026, auf Nutzerwunsch - "vollstaen-
-- dige Changelog seit dem Beginn von OPBK"). Diese vier Themen (Kartenda-
-- tenbank im Spiel, Einreichen+Account-Verknuepfung, erstes Limit-Update,
-- Teleport-Tracking/Trending) wurden zwischen 01.09. und 05.09.2026 gebaut
-- und live geschaltet, bekamen aber bisher KEINEN oeffentlichen Changelog-
-- Eintrag - dieser Nachtrag holt das nach. Alle vier Themen live gegen-
-- geprueft (nicht nur behauptet): get_trending_cards()/exchange_mod_
-- pairing_code() liefern echte Live-Antworten (u.a. echte, heute per Mod
-- eingereichte Karten mit echten Teleport-Zaehlern), mod_tokens/card_
-- submissions existieren live. Gleiches idempotentes Muster wie alle
-- bisherigen sql/*-changelog-*.sql-Dateien (Tabelle+RLS bereits live seit
-- sql/20260726-changelog.sql, hier nur weitere Zeilen). Bereits fertig
-- ausgefuellt, kein Platzhalter - einfach im Supabase SQL Editor ausfuehren,
-- mehrfaches Ausfuehren ist unschaedlich. Die Erhoehung auf 200 vom
-- 06.09.2026 selbst hat bereits ihren eigenen Eintrag in
-- sql/20260906-changelog-mod-submission-limit-200.sql - hier bewusst nicht
-- dupliziert.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-09-02', 'feature',
  'OPBK-Mod veröffentlicht: Kartendatenbank direkt im Spiel',
  'Die neue OPBK-Mod (Chatbefehl /opbk) bringt die komplette Kartendatenbank direkt ins Spiel - als Sammelalbum mit fünf Bereichen: "Alle Karten" zum Durchsuchen/Filtern der gesamten Datenbank, "Kategorien" für die Übersicht nach Kategorie, "Karte einreichen" (per Karte in der Hand, MapArt-Wandscan oder Bilddatei), "Meine Einreichungen" zum Verfolgen des Prüfstatus und "Account", um die Mod optional mit eurem BKInvestment-Account zu verknüpfen. Jede Kartendetailseite hat außerdem einen "Zum Shop teleportieren"-Button, der euch automatisch zur richtigen CityBuild und zum passenden Shop-Warp bringt - ganz ohne manuelles /cb oder /sw. Funktioniert ausschließlich auf opsucht.net.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-09-02' and title = 'OPBK-Mod veröffentlicht: Kartendatenbank direkt im Spiel'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-09-04', 'change',
  'Tägliches Einreiche-Limit für Karten erstmals erhöht',
  'Über die OPBK-Mod konntet ihr ab sofort bis zu 25 Kartenvorschläge pro Tag einreichen (vorher 10).'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-09-04' and title = 'Tägliches Einreiche-Limit für Karten erstmals erhöht'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-09-05', 'feature',
  'Beliebteste Karten: Teleport-Tracking für Trending-Karten',
  'Jeder "Zum Shop teleportieren"-Klick in der OPBK-Mod zählt jetzt anonym mit - daraus entsteht eine echte Trending-Liste der beliebtesten Karten (24 Stunden, 7 Tage, 30 Tage oder insgesamt). Wer eine Karte besucht hat, wird dabei nie gespeichert - nur die Gesamtzahl pro Karte.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-09-05' and title = 'Beliebteste Karten: Teleport-Tracking für Trending-Karten'
);
