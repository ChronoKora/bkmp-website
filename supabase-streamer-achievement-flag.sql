-- Bkmp - Streamer: Flag "zaehlt fuer den Stream-Erfolg"
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Neuer Erfolg pro Creator ("Stream von X angeschaut") - manche Eintraege
-- (z. B. reine YouTube-Kanaele ohne Live-Status-Anzeige) sollen davon
-- ausgenommen werden koennen. Admin steuert das ueber eine Checkbox im
-- Twitch-Leiste-Formular.

alter table public.streamer_links add column if not exists counts_for_achievement boolean not null default true;

-- Pekka14 und Gamecrash sind reine YouTube-Kanaele (keine Live-Erkennung
-- moeglich) - direkt beim Anlegen der Spalte ausschliessen.
update public.streamer_links set counts_for_achievement = false where display_name in ('Pekka14', 'Gamecrash');
