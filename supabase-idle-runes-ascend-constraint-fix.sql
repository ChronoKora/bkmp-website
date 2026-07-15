-- ============================================================
-- Bugfix: Runen-Aufstieg (Runen-Aufstieg, Feature #181) hat nie funktioniert,
-- weil der alte Check-Constraint aus supabase-idle-runes-v2.sql den
-- upgrade_level weiterhin auf max. 15 begrenzt hat. Jeder Aufstiegs-Schreib-
-- vorgang (der auf +16 bis +30 gehen soll) wurde von der DB abgelehnt und
-- im Client stillschweigend verschluckt (.catch) - die Rune sah kurzzeitig
-- aufgestiegen aus, ist aber beim naechsten Laden auf +15 zurueckgefallen.
-- Bug-Report: Spieler "DerJannikHase", Legendaere Rune +16 -> wieder +15.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent (drop+add constraint).
-- ============================================================

alter table public.idle_player_runes
  drop constraint if exists idle_player_runes_upgrade_level_check;
alter table public.idle_player_runes
  add constraint idle_player_runes_upgrade_level_check
  check (upgrade_level >= 0 and upgrade_level <= 30) not valid;
