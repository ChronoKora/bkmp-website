-- Bkmp - Idle Drachen Dorf: Skilltree-Reset (1x pro Tag)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Speichert, wann ein Spieler seinen Skilltree zuletzt zurueckgesetzt hat -
-- der Client (bkmpIdleResetSkilltree in idledorf.js) erlaubt einen erneuten
-- Reset erst wieder 24 Stunden danach.

alter table public.idle_player_state
  add column if not exists last_skilltree_reset_at timestamptz;
