-- Persistiert die "Titel/Kosmetik jemals freigeschaltet"-Merkliste
-- serverseitig - Balance-Audit 16.07.: bkmpIdleTitleUnlockedSticky /
-- bkmpIdleCosmeticUnlockedSticky (idledorf.js) hielten diesen Status bisher
-- AUSSCHLIESSLICH in localStorage. Titel geben permanente Kampf-Boni
-- (potenziell mehrere hundert % kombiniert ueber alle freigeschalteten
-- Titel), der Freischalt-Status haengt aber an nichts, das je den Server
-- erreicht:
--   1. echter Datenverlust - ein Geraetewechsel oder geleerter Browser-
--      Cache loescht saemtliche Titel-/Kosmetik-Freischaltungen und damit
--      alle daraus resultierenden Dauerboni, obwohl die zugrunde liegenden
--      Fortschrittswerte (Level, Drachen-Kills, ...) laengst persistiert
--      sind.
--   2. der Freischalt-Status liess sich mit einem einzigen localStorage-
--      Eintrag im Browser faelschen, OHNE die App/den Server je zu
--      beruehren - ein deutlich niedrigerer Aufwand als jede andere
--      Manipulation in dieser (bewusst clientseitig vertrauenden)
--      Wirtschaft.
--
-- Idempotent, gleiches Muster wie die anderen idle_player_state-
-- Erweiterungen in diesem Projekt.
alter table public.idle_player_state
  add column if not exists titles_unlocked_at jsonb not null default '{}'::jsonb,
  add column if not exists cosmetics_unlocked_at jsonb not null default '{}'::jsonb;
