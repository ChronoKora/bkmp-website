-- Bkmp - Spieler-Statistiken fuer das Leaderboard (+ Cross-Device-Sync)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Speichert pro Minecraft-Name (freiwillig im Browser eingetragen, ohne
-- Passwort/Login) Zeit, Erfolge und Easter-Egg-Fortschritt, damit ein
-- Leaderboard ueber alle Besucher hinweg moeglich ist UND damit derselbe
-- Name auf mehreren Geraeten (PC + Handy) denselben Fortschritt zeigt.
--
-- name_key ist der Name in Kleinbuchstaben und die eigentliche eindeutige
-- Identitaet ("ChronoKora" und "chronokora" sind derselbe Eintrag).
-- display_name ist die zuerst benutzte Schreibweise, die ueberall angezeigt
-- wird.
--
-- WICHTIG - Sicherheitshinweis: Da es kein echtes Login gibt, kann jeder
-- (auch per direktem API-Aufruf) Werte fuer JEDEN Namen eintragen oder
-- ueberschreiben. Die CHECK-Constraints unten verhindern nur offensichtlich
-- unsinnige Werte, sie machen das System aber NICHT faelschungssicher.

-- Falls die Tabelle schon mit dem alten Schema (mc_name als Primary Key)
-- existiert, hier sicher auf das neue Schema umbauen, ohne Daten zu verlieren.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'player_stats')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'player_stats' and column_name = 'mc_name')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'player_stats' and column_name = 'name_key')
  then
    alter table public.player_stats rename column mc_name to display_name;
    alter table public.player_stats add column name_key text;
    update public.player_stats set name_key = lower(display_name);
    alter table public.player_stats drop constraint if exists player_stats_pkey;
    alter table public.player_stats alter column name_key set not null;
    alter table public.player_stats add primary key (name_key);
  end if;
end $$;

create table if not exists public.player_stats (
  name_key text primary key,
  display_name text not null,
  minutes_spent integer not null default 0,
  achievements_unlocked integer not null default 0,
  eggs_found jsonb not null default '[]'::jsonb,
  days_visited jsonb not null default '[]'::jsonb,
  flags jsonb not null default '{}'::jsonb,
  panel_opens integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.player_stats add column if not exists eggs_found jsonb not null default '[]'::jsonb;
alter table public.player_stats add column if not exists days_visited jsonb not null default '[]'::jsonb;
alter table public.player_stats add column if not exists flags jsonb not null default '{}'::jsonb;
alter table public.player_stats add column if not exists panel_opens integer not null default 0;
alter table public.player_stats add column if not exists active_title text not null default '';

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
