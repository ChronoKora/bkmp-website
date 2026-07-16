-- Endloser Turm (Nutzerwunsch 16.07.: "Lategame-Content, der Spieler
-- langfristig fesselt"): eine Dauer-Kampf-Variante ohne Schwierigkeits-
-- Auswahl und ohne Sieg-Bedingung - im Gegensatz zum Dungeon-System 2.0
-- (das inzwischen fuer jeden ausgebauten Charakter zuverlaessig schaffbar
-- sein MUSS, siehe supabase-dungeon-system-v2.sql und die Balance-Fixes
-- vom 16.07.) ist der Turm bewusst dafuer gebaut, jeden Spieler irgendwann
-- zu besiegen - die erreichte Stufe selbst ist die Belohnung/Bestenlisten-
-- Wertung, kein "Clear" noetig.
--
-- Nur zwei neue Spalten auf idle_player_state, gleiches Muster wie ueberall
-- sonst im Idle-Dorf (client-berechnet, client-geschrieben - siehe
-- supabase-security-audit-rls-fix.sql: dieses Projekt vertraut dem Client
-- bereits durchgehend, hier wird bewusst keine Ausnahme gemacht):
--   turm_highest_wave    - persoenlicher Rekord, direkt Bestenlisten-Wert
--   turm_last_attempt_at - Zeitstempel des letzten Versuchsstarts, treibt
--                          den clientseitigen 24h-Cooldown (rollierend,
--                          nicht kalendertag-ausgerichtet wie z.B. die
--                          Arena - bewusst einfacher gehalten, da hier kein
--                          Wettbewerbsvorteil durch Zeitzonen-Tricksereien
--                          entsteht, anders als bei echtem PvP)
--
-- Idempotent, gleiches Muster wie die anderen idle_player_state-
-- Erweiterungen in diesem Projekt.
alter table public.idle_player_state
  add column if not exists turm_highest_wave integer not null default 0,
  add column if not exists turm_last_attempt_at timestamptz;
