-- Bkmp - Runen-System fuer das Idle Drachen Dorf.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Jede Rune ist eine einzelne, individuell gewuerfelte Zeile (wie
-- public.user_plushies, NICHT wie ein einziges JSON-Blob) - Spieler
-- sammeln viele Runen, ruesten pro Typ maximal eine aus (rune_type ist
-- KEIN unique-Constraint, das erzwingt idledorf.js beim Ausruesten selbst)
-- und koennen 3 gleiche (gleicher Typ + gleiche Raritaet) zu einer
-- besseren verschmelzen.
--
-- Ownership-Muster 1:1 wie idle_player_state (siehe
-- supabase-player-accounts-v2.sql): name_key ist die fachliche Kennung,
-- auth_user_id ist die alleinige Schreibberechtigung, oeffentlich lesbar.
-- Runen-Drops laufen client-seitig (derselbe Vertrauens-Rahmen wie
-- Gold/XP im restlichen Idle-Spiel - alles hier ist eine clientseitige
-- Idle-Simulation, kein serverseitig autoritatives Kampfsystem).

create table if not exists public.idle_player_runes (
  id uuid primary key default gen_random_uuid(),
  name_key text not null,
  auth_user_id uuid not null,
  rune_type text not null,
  rarity smallint not null check (rarity between 1 and 5),
  rolled_value numeric not null,
  equipped boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idle_player_runes_name_idx on public.idle_player_runes (name_key);
create index if not exists idle_player_runes_owner_idx on public.idle_player_runes (auth_user_id);

alter table public.idle_player_runes enable row level security;

drop policy if exists "Public read player runes" on public.idle_player_runes;
create policy "Public read player runes"
on public.idle_player_runes for select to anon, authenticated using (true);

drop policy if exists "Owner insert player runes" on public.idle_player_runes;
create policy "Owner insert player runes"
on public.idle_player_runes for insert to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "Owner update player runes" on public.idle_player_runes;
create policy "Owner update player runes"
on public.idle_player_runes for update to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

drop policy if exists "Owner delete player runes" on public.idle_player_runes;
create policy "Owner delete player runes"
on public.idle_player_runes for delete to authenticated
using (auth_user_id = auth.uid());
