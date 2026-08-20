-- Bkmp - Oeffentliche Changelog-Eintraege fuer zwei am 19./20.08.2026
-- gemeldete und behobene Bugs (Kaledoss: Stufenleiste verschwindet nach
-- Dungeon-Lauf; FlinkerBoy7289: Arena-Champion-Titel zeigt faelschlich
-- gesperrt). Gleiches idempotentes Muster wie
-- sql/20260811-changelog-leaderboard-hide-fix.sql. Bereits fertig
-- ausgefuellt, kein Platzhalter - einfach im Supabase SQL Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-20', 'fix',
  'Stufenleiste verschwand nach einem Dungeon-/Turm-Lauf',
  'Nach dem Abschließen eines Dungeon- oder Turm-Laufs konnte die Stufen-Auswahl rechts oben (Automatisch/Beste Stufe/Stufe wählen) unsichtbar werden - erst ein Neuladen der Seite brachte sie zurück. Behoben: das schließende Ergebnis-Fenster blockiert danach keine Klicks mehr im Hintergrund.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-20' and title = 'Stufenleiste verschwand nach einem Dungeon-/Turm-Lauf'
);

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-20', 'fix',
  'Titel-Boni aus Arena/Weltboss/Gilde blieben teils dauerhaft gesperrt',
  'Titel wie "Arena-Champion", "Bossbezwinger" oder die Gilden-Level-Titel konnten im Idle-Dorf selbst dauerhaft als gesperrt angezeigt bleiben, obwohl die Bedingung längst erfüllt war - dadurch wurde auch ihr echter Kampfbonus nicht immer zuverlässig gutgeschrieben. Behoben: die Freischalt-Prüfung berücksichtigt jetzt zuverlässig den aktuellen Arena-/Weltboss-/Gilden-Stand, betroffene Titel schalten sich beim nächsten Öffnen automatisch korrekt frei.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-20' and title = 'Titel-Boni aus Arena/Weltboss/Gilde blieben teils dauerhaft gesperrt'
);
