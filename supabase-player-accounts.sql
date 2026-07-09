-- Bkmp - Echte Spieler-Konten (Name + Passwort) fuer player_stats/idle_player_state
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Vorher: player_stats/idle_player_state waren rein per Freitext-Name
-- ("name_key") identifiziert, mit komplett offener RLS - jeder konnte per
-- direktem API-Aufruf jeden Namen faelschen/ueberschreiben (siehe Kommentar
-- in supabase-player-stats-schema.sql). Jetzt: echte Supabase-Auth-Konten
-- (gleiche Technik wie admin_profiles/bkmpLoginAdmin - Fake-E-Mail aus dem
-- Namen, Supabase Auth hasht das Passwort sicher). Jede Zeile gehoert danach
-- fest einem auth.uid() UND ist zusaetzlich an den in der JWT hinterlegten
-- display_name gebunden, damit niemand per manuellem API-Aufruf einen
-- fremden name_key beschreiben kann.
--
-- Bestehende Zeilen (vor diesem Umbau angelegt) bleiben unveraendert mit
-- auth_user_id = null ("verwaist") bestehen. Registriert sich der passende
-- Name spaeter echt, "claimt" der Registrierungs-Code in supabase.js genau
-- diese Zeile (update ... where name_key = x and auth_user_id is null) -
-- bestehender Fortschritt geht nicht verloren.

alter table public.player_stats add column if not exists auth_user_id uuid;
alter table public.idle_player_state add column if not exists auth_user_id uuid;

create unique index if not exists player_stats_auth_user_id_idx on public.player_stats (auth_user_id) where auth_user_id is not null;
create unique index if not exists idle_player_state_auth_user_id_idx on public.idle_player_state (auth_user_id) where auth_user_id is not null;

/* ---------------- player_stats: alte offene Policies weg, neue owner-gebundene Policies ---------------- */
drop policy if exists "Public insert player stats" on public.player_stats;
drop policy if exists "Public update player stats" on public.player_stats;

revoke insert, update on public.player_stats from anon;

drop policy if exists "Owner insert player stats" on public.player_stats;
create policy "Owner insert player stats"
on public.player_stats for insert
to authenticated
with check (
  auth_user_id = auth.uid()
  and name_key = lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'display_name', ''))
);

drop policy if exists "Owner update player stats" on public.player_stats;
create policy "Owner update player stats"
on public.player_stats for update
to authenticated
using (auth_user_id = auth.uid() or auth_user_id is null)
with check (
  auth_user_id = auth.uid()
  and name_key = lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'display_name', ''))
);
-- "Public read player stats" (select, anon+authenticated, using(true)) bleibt
-- unveraendert bestehen - die Bestenliste braucht weiterhin oeffentliches Lesen.

/* ---------------- idle_player_state: gleiches Muster ---------------- */
drop policy if exists "Public insert idle player state" on public.idle_player_state;
drop policy if exists "Public update idle player state" on public.idle_player_state;

revoke insert, update on public.idle_player_state from anon;

drop policy if exists "Owner insert idle player state" on public.idle_player_state;
create policy "Owner insert idle player state"
on public.idle_player_state for insert
to authenticated
with check (
  auth_user_id = auth.uid()
  and name_key = lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'display_name', ''))
);

drop policy if exists "Owner update idle player state" on public.idle_player_state;
create policy "Owner update idle player state"
on public.idle_player_state for update
to authenticated
using (auth_user_id = auth.uid() or auth_user_id is null)
with check (
  auth_user_id = auth.uid()
  and name_key = lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'display_name', ''))
);
-- "Public read idle player state" (select) und "Admin delete idle player
-- state" bleiben unveraendert bestehen.
