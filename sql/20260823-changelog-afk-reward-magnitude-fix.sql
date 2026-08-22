-- Bkmp - Oeffentlicher Changelog-Eintrag: Offline-/AFK-Belohnung (fester
-- Wert, siehe 21.08.2026-Eintrag) war fuer die meisten Spieler deutlich zu
-- niedrig, Kristalle/Essenz fielen praktisch immer aus (23.08.2026, siehe
-- CHANGELOG.md fuer die technische Root-Cause-Erklaerung). Gleiches
-- idempotentes Muster wie sql/20260821-changelog-afk-fixed-reward.sql.
-- Bereits fertig ausgefuellt, kein Platzhalter - einfach im Supabase SQL
-- Editor ausfuehren.

insert into public.changelog_entries (entry_date, category, title, description)
select '2026-08-23', 'fix',
  'Offline-/AFK-Belohnung deutlich erhöht + Kristalle/Essenz jetzt zuverlässig dabei',
  'Die vor kurzem eingeführte feste Offline-/AFK-Belohnung fiel für die meisten Spieler spürbar zu niedrig aus, Kristalle und Essenz wurden praktisch nie gutgeschrieben. Die Berechnung wurde korrigiert - sie berücksichtigt jetzt die tatsächliche Mischung aus normalen, seltenen, Miniboss- und Boss-Gegnern an deiner höchsten Stufe, statt nur einen einzelnen Referenz-Gegner anzunehmen. Ergebnis: spürbar mehr Gold/XP, und Kristalle/Essenz sind jetzt regelmäßig dabei.'
where not exists (
  select 1 from public.changelog_entries where entry_date = '2026-08-23' and title = 'Offline-/AFK-Belohnung deutlich erhöht + Kristalle/Essenz jetzt zuverlässig dabei'
);
