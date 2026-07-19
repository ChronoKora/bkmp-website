-- Bkmp - Spieler-Statistiken: aktives Kosmetik-Effekt speichern
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Damit der gewaehlte Namens-Effekt (z.B. "Gold-Gluehen") auch in der
-- Bestenliste bei anderen Besuchern sichtbar ist, nicht nur lokal im
-- eigenen Browser.

alter table public.player_stats add column if not exists active_cosmetic text not null default '';
