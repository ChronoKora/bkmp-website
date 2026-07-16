-- Bkmp - Drachen-Lexikon (Spieler-Wunsch 17.07.): "Alle Schwarz ausgeblendet
-- die man noch nicht hat.. Und sobald dann in Voller Farbe?" - dafuer
-- braucht es einen DAUERHAFTEN "schon mal besessen"-Merker pro Art, der
-- NICHT verschwindet, wenn der letzte Vertreter der Art spaeter freigelassen
-- oder verbraucht (Aufstieg/Opfer) wird - ein Pokedex-Eintrag bleibt
-- schliesslich entdeckt.
--
-- Gleiches Muster wie titles_unlocked_at/cosmetics_unlocked_at (siehe
-- supabase-idle-title-unlock-persist.sql): jsonb-Map species_id -> Datum,
-- serverseitig persistiert statt nur lokal, damit ein Geraetewechsel den
-- Lexikon-Fortschritt nicht loescht.
--
-- Idempotent, gleiches Muster wie die anderen idle_player_state-
-- Erweiterungen in diesem Projekt.
alter table public.idle_player_state
  add column if not exists dragon_species_discovered_at jsonb not null default '{}'::jsonb;
