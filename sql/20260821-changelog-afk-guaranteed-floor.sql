-- Bkmp - Oeffentlicher Changelog-Eintrag: garantierter Mindestlohn fuer
-- Offline-/AFK-Kampfbelohnungen (21.08.2026). Gleiches idempotentes Muster
-- wie sql/20260811-changelog-leaderboard-hide-fix.sql. Bereits fertig
-- ausgefuellt, kein Platzhalter - einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-21', 'feature',
  'Garantierter Mindestlohn für Offline-/AFK-Belohnungen',
  'Bisher konnte eine Abwesenheit unter bestimmten Umständen komplett leer ausgehen (0 Belohnung), wenn die aktuelle Stufe offline nicht simuliert gewinnbar war - egal wie lange man weg war. Ab sofort gibt es dafür eine garantierte Mindest-Belohnung, unabhängig vom Simulationsergebnis: eine erfolgreiche Simulation bleibt dabei immer die bessere Wahl, aber eine Abwesenheit geht nie mehr komplett leer aus. Auf der Ergebnis-Karte erscheint in diesem Fall ein kleiner Hinweis "🛡️ Basis-Absicherung angewendet".'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-21' and title = 'Garantierter Mindestlohn für Offline-/AFK-Belohnungen'
);
