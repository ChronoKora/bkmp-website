-- Bkmp - Korrektur des Datums der drei Zwielicht-Changelog-Eintraege (04.10.2026).
--
-- Die Eintraege stehen bereits live, aber mit entry_date 2026-10-16 (die Vorlage
-- 20261004-changelog-zwielicht.sql ging noch vom Event-Start Mo 19.10. aus). Das
-- Event startet aber Montag 05.10.2026 00:00 Uhr - die Eintraege sollen deshalb
-- das Datum 05.10.2026 tragen. Nur das Datum wird geaendert, Titel/Text bleiben.
--
-- Idempotent: ein zweites Ausfuehren findet nichts mehr mit 16.10. und aendert nichts.
-- Die Vorlage 20261004-changelog-zwielicht.sql im Repo steht ebenfalls schon auf
-- 2026-10-05 (ein erneutes Ausfuehren legt dadurch kein Duplikat an).
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

update public.changelog_entries
set entry_date = '2026-10-05'
where entry_date = '2026-10-16'
  and title in (
    'Idle-Dorf: ☀️🌑 Das Erwachen des Zwielichts',
    'Idle-Dorf: Die Göttliche Erweckung',
    'Idle-Dorf: Kleine Wochenereignisse'
  );

-- ------------------------------------------------------------
-- NUR WENN NOCH NICHT GESCHEHEN (Event-Zeitplan, nicht der Changelog):
-- Die Vorlagen 20261004-06/-07 nennen als Beispiel den 19.10. Falls der Zeitplan
-- damals so gesetzt wurde, muss er auf den echten Start korrigiert werden.
-- special_event_schedule() ist ein reines UPDATE und beliebig oft ausfuehrbar:
--   select public.special_event_schedule('zwielicht', '2026-10-05', 3);
-- -> Ankuendigung Fr 02.10. 00:00 (liegt schon in der Vergangenheit, d.h. der Pass
--    zaehlt sofort als "angekuendigt"), Start Mo 05.10. 00:00, Ende So 11.10. 23:59.
-- Zur Kontrolle (als Admin im SQL Editor):
--   select id, announce_at, starts_at, ends_at, enabled from public.special_events where id = 'zwielicht';
-- ------------------------------------------------------------
