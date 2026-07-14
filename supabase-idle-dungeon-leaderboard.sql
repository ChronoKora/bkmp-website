/* ============================================================
   Dungeon-Bestenliste (Spieler-Wunsch 17.07.: "Wo ist die
   Bestenliste dafuer?") - der Dungeon-Modus (siehe idledorf.js,
   BKMP_DUNGEON_DIFFICULTIES) speicherte Bestwerte bisher NUR lokal
   (localStorage) - eine Zeile pro Spieler+Schwierigkeitsstufe, wird
   nur bei einer echten Verbesserung ueberschrieben (siehe
   submitDungeonResult() in supabase.js, aufgerufen aus
   bkmpDungeonFinish() in idledorf.js). Gleiches permissives RLS-
   Muster wie idle_player_state (siehe supabase-idle-dorf-schema.sql)
   - dieses Projekt vertraut dem Client fuer Spielstand-Schreibzugriffe
   bereits durchgehend, kein Sonderfall hier.
   ============================================================ */

create table if not exists public.idle_dungeon_results (
  id uuid primary key default gen_random_uuid(),
  name_key text not null,
  display_name text not null,
  difficulty_id text not null,
  waves_cleared integer not null default 0,
  time_ms bigint not null default 0,
  achieved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.idle_dungeon_results drop constraint if exists idle_dungeon_results_name_difficulty_key;
alter table public.idle_dungeon_results add constraint idle_dungeon_results_name_difficulty_key unique (name_key, difficulty_id);

alter table public.idle_dungeon_results drop constraint if exists idle_dungeon_results_difficulty_check;
alter table public.idle_dungeon_results add constraint idle_dungeon_results_difficulty_check
  check (difficulty_id in ('leicht', 'mittel', 'schwer', 'albtraum'));

alter table public.idle_dungeon_results drop constraint if exists idle_dungeon_results_waves_check;
alter table public.idle_dungeon_results add constraint idle_dungeon_results_waves_check check (waves_cleared >= 0 and waves_cleared <= 100);

create index if not exists idle_dungeon_results_difficulty_idx on public.idle_dungeon_results (difficulty_id, waves_cleared desc, time_ms asc);

alter table public.idle_dungeon_results enable row level security;
grant select, insert, update on public.idle_dungeon_results to anon, authenticated;
grant delete on public.idle_dungeon_results to authenticated;

drop policy if exists "Public read idle dungeon results" on public.idle_dungeon_results;
create policy "Public read idle dungeon results" on public.idle_dungeon_results for select to anon, authenticated using (true);

drop policy if exists "Public insert idle dungeon results" on public.idle_dungeon_results;
create policy "Public insert idle dungeon results" on public.idle_dungeon_results for insert to anon, authenticated with check (true);

drop policy if exists "Public update idle dungeon results" on public.idle_dungeon_results;
create policy "Public update idle dungeon results" on public.idle_dungeon_results for update to anon, authenticated using (true) with check (true);

drop policy if exists "Admin delete idle dungeon results" on public.idle_dungeon_results;
create policy "Admin delete idle dungeon results" on public.idle_dungeon_results for delete to authenticated using (public.is_active_admin());
