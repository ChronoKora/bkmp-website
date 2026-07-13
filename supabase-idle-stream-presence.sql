-- Bkmp - Idle Drachen Dorf: Live-Sync zwischen Hauptseite und Twitch-Overlay
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Nutzerwunsch (15.07.): Fortschritt (Level/Stufe/Skills/Upgrades), der auf
-- der Twitch-Seite (idle-stream.html/idle-stream-mini.html) gespielt wird,
-- soll auf der Hauptseite live mitlaufen - dort aber bewusst NUR als
-- Zuschauer-Ansicht (Bedienung gesperrt, solange die Twitch-Seite offen
-- ist), um Konflikte durch gleichzeitiges Spielen an zwei Stellen zu
-- vermeiden. Diese winzige Tabelle ist ausschliesslich ein "Herzschlag":
-- die Twitch-Seite traegt hier alle ~20s "ich bin noch offen" ein, die
-- Hauptseite prueft alle paar Sekunden, ob der Herzschlag noch frisch ist.
-- Enthaelt bewusst KEINE Spieldaten selbst (die kommen weiterhin aus
-- idle_player_state/idle_prestige_state/idle_player_runes).

create table if not exists public.idle_stream_presence (
  name_key text primary key,
  auth_user_id uuid not null,
  last_seen_at timestamptz not null default now()
);

alter table public.idle_stream_presence enable row level security;

-- Oeffentlich lesbar (gleiches Muster wie idle_player_state) - so kann die
-- Hauptseite den Herzschlag ganz normal ueber den bestehenden anonymen
-- Lese-Client abfragen, ohne eine zusaetzliche Sonderbehandlung noetig zu
-- machen.
drop policy if exists "Public read stream presence" on public.idle_stream_presence;
create policy "Public read stream presence"
on public.idle_stream_presence for select to anon, authenticated using (true);

drop policy if exists "Owner upsert stream presence" on public.idle_stream_presence;
create policy "Owner upsert stream presence"
on public.idle_stream_presence for insert to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "Owner update stream presence" on public.idle_stream_presence;
create policy "Owner update stream presence"
on public.idle_stream_presence for update to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());
