-- Bkmp - Oeffentliche Changelog-Eintraege: Idle-Dorf "Chronik" (03.10.2026,
-- siehe CHANGELOG.md/CLAUDE.md fuer die technische Herleitung). Gleiches
-- idempotentes Muster wie alle bisherigen sql/*-changelog-*.sql-Dateien -
-- bereits fertig ausgefuellt, einfach im Supabase SQL Editor ausfuehren,
-- mehrfaches Ausfuehren ist unschaedlich.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-03', 'feature',
  'Idle-Dorf: Die Chronik ist da – Tagesaufträge & Wochenziele',
  'Neu im Drachendorf: die 📜 Chronik. Jeden Tag warten 3 Tagesaufträge, jede Woche 3 Wochenziele auf dich (z. B. Drachen besiegen, Dungeon-Läufe, Turmstufen, Runen aufwerten). Die Belohnungen wachsen mit deinem Fortschritt mit, Offline-Fortschritt zählt mit – und wer alle drei schafft, öffnet zusätzlich eine Truhe mit Rune, Kristallen und Essenz. Die Wochentruhe enthält sogar ein Drachenei! Einen Tagesauftrag darfst du einmal täglich kostenlos neu auswürfeln. Zu finden rechts im Kampf-Tab bzw. auf dem Handy über den 📜-Knopf oben.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-03' and title = 'Idle-Dorf: Die Chronik ist da – Tagesaufträge & Wochenziele'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-03', 'feature',
  'Idle-Dorf: Neuer Login-Kalender mit mitwachsenden Belohnungen',
  'Die tägliche Login-Belohnung ist jetzt ein 7-Tage-Kalender: Gold, Erfahrung, Kristalle, Essenz, Goldrausch- und Wissensschub-Booster und an Tag 7 eine Rune. Die Belohnungen wachsen mit deiner höchsten Stufe mit (vorher gab es höchstens 10.000 Gold), und für jede vollständige Woche in Folge gibt es +10 % Treuebonus (bis +50 %). Niemand bekommt dabei weniger als vorher. Deine Serie bleibt jetzt auch beim Gerätewechsel erhalten.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-03' and title = 'Idle-Dorf: Neuer Login-Kalender mit mitwachsenden Belohnungen'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-10-03', 'feature',
  'Idle-Dorf: Drachen-Bestiarium & Weltereignisse',
  'Das neue 📖 Bestiarium zählt, wie oft du jede Drachenart besiegt hast – jede Art hat 5 Stufen (Bronze bis Diamant) mit kleinen dauerhaften Boni, die auch nach Prestige erhalten bleiben. Außerdem passieren im Kampf jetzt zufällige ✨ Weltereignisse: Schatztruhen und Sternschnuppen zum Anklicken, ein wandernder Händler, der Holz und Stein gegen Kristalle tauscht, sowie Goldregen, Weisheitswind und Kampfrausch. Dazu gibt es eine „Ziele“-Übersicht, die zeigt, was du als Nächstes erreichen kannst, und 9 neue Erfolge mit 4 neuen Titeln.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-10-03' and title = 'Idle-Dorf: Drachen-Bestiarium & Weltereignisse'
);
