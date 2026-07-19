-- Bkmp - Idle Drachen Dorf: Runen-Erfolge (neue Kategorie "Runen")
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Ergaenzt 4 neue Zaehler-Spalten in idle_player_state, damit
-- Runen-Verschmelzen/-Aufwerten (Erfolg UND Misserfolg) fuer die neue
-- Erfolge-Kategorie "Runen" (idledorf.js BKMP_RUNE_FUSE_SUCCESS_TIERS/
-- BKMP_RUNE_FUSE_FAIL_TIERS/BKMP_RUNE_UPGRADE_SUCCESS_TIERS/
-- BKMP_RUNE_UPGRADE_FAIL_TIERS) dauerhaft mitgezaehlt wird. Idempotent
-- per "add column if not exists", kann gefahrlos mehrfach ausgefuehrt
-- werden.

alter table public.idle_player_state
  add column if not exists rune_fuse_successes integer not null default 0;

alter table public.idle_player_state
  add column if not exists rune_fuse_failures integer not null default 0;

alter table public.idle_player_state
  add column if not exists rune_upgrade_successes integer not null default 0;

alter table public.idle_player_state
  add column if not exists rune_upgrade_failures integer not null default 0;
