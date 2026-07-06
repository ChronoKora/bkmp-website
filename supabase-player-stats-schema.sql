-- Bkmp - Spieler-Statistiken fuer das Leaderboard
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Speichert pro Minecraft-Name (freiwillig im Browser eingetragen, ohne
-- Passwort/Login) die verbrachte Zeit und Anzahl freigeschalteter Erfolge,
-- damit ein Leaderboard ueber alle Besucher hinweg moeglich ist.
--
-- WICHTIG - Sicherheitshinweis: Da es kein echtes Login gibt, kann jeder
-- (auch per direktem API-Aufruf) Werte fuer JEDEN Namen eintragen oder
-- ueberschreiben. Die CHECK-Constraints unten verhindern nur offensichtlich
-- unsinnige Werte (negativ, unrealistisch hoch), sie machen das System aber
-- NICHT faelschungssicher. Fuer ein rein informelles/Spaß-Leaderboard ist
-- das ok, fuer einen echten Wettbewerb braeuchte es echte Accounts.

create table if not exists public.player_stats (
  mc_name text primary key,
  minutes_spent integer not null default 0,
  achievements_unlocked integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.player_stats drop constraint if exists player_stats_minutes_check;
alter table public.player_stats add constraint player_stats_minutes_check check (minutes_spent >= 0 and minutes_spent <= 200000);

alter table public.player_stats drop constraint if exists player_stats_achievements_check;
alter table public.player_stats add constraint player_stats_achievements_check check (achievements_unlocked >= 0 and achievements_unlocked <= 250);

create index if not exists player_stats_minutes_idx on public.player_stats (minutes_spent desc);
create index if not exists player_stats_achievements_idx on public.player_stats (achievements_unlocked desc);

alter table public.player_stats enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.player_stats to anon, authenticated;

drop policy if exists "Public read player stats" on public.player_stats;
create policy "Public read player stats"
on public.player_stats for select
to anon, authenticated
using (true);

drop policy if exists "Public insert player stats" on public.player_stats;
create policy "Public insert player stats"
on public.player_stats for insert
to anon, authenticated
with check (true);

drop policy if exists "Public update player stats" on public.player_stats;
create policy "Public update player stats"
on public.player_stats for update
to anon, authenticated
using (true)
with check (true);
