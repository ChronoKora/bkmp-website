-- ============================================================
-- Idle-Dorf "Chronik" (03.10.2026): Tagesauftraege, Wochenziele,
-- Login-Kalender, Drachen-Bestiarium, Weltereignis-Statistik.
--
-- NOCH NICHT AUSGEFUEHRT. Das Spiel funktioniert auch OHNE diese Tabelle:
-- js/systems/bkmp-chronicle.js erkennt eine fehlende Tabelle (PGRST205/42P01)
-- und speichert dann rein lokal (localStorage) weiter. Mit dieser Tabelle wird
-- der Chronik-Fortschritt zusaetzlich geraeteuebergreifend gespeichert und
-- doppelte Belohnungen auf zwei Geraeten werden zuverlaessig verhindert.
--
-- Design-Entscheidungen:
-- * EINE Zeile pro Konto, Daten als JSONB (data) - kein Dutzend neuer Spalten
--   auf idle_player_state (dort fuehrt jede noch nicht live existierende
--   Spalte sofort zu fehlschlagenden Autosaves fuer ALLE Spieler, siehe
--   BKMP_IDLE_PLAYER_STATE_COLUMNS in supabase.js / Zerstoertes-Dorf-Vorfall).
-- * Schluessel ist auth_user_id, NICHT name_key: eine Umbenennung kann diese
--   Zeile dadurch nie "verwaisen" lassen (siehe Rename-Vorfall 25.07.2026,
--   sql/20260725-fix-rename-name-key-propagation.sql). name_key wird nur zur
--   Lesbarkeit im Dashboard mitgespeichert.
-- * Nur der eigene Spieler darf lesen/schreiben (RLS), kein Loeschen noetig.
-- * Groessenbremse gegen Missbrauch (Daten sind real ~2-6 KB gross).
--
-- Sicher wiederholbar (if not exists / drop policy if exists).
-- ============================================================

create table if not exists public.idle_player_meta (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  name_key text not null default '',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint idle_player_meta_data_size check (pg_column_size(data) <= 65536)
);

create index if not exists idle_player_meta_name_key_idx on public.idle_player_meta (name_key);

alter table public.idle_player_meta enable row level security;

drop policy if exists "idle_player_meta_select_own" on public.idle_player_meta;
create policy "idle_player_meta_select_own" on public.idle_player_meta
  for select using (auth.uid() = auth_user_id);

drop policy if exists "idle_player_meta_insert_own" on public.idle_player_meta;
create policy "idle_player_meta_insert_own" on public.idle_player_meta
  for insert with check (auth.uid() = auth_user_id);

drop policy if exists "idle_player_meta_update_own" on public.idle_player_meta;
create policy "idle_player_meta_update_own" on public.idle_player_meta
  for update using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);

revoke all on public.idle_player_meta from anon;
grant select, insert, update on public.idle_player_meta to authenticated;

-- updated_at serverseitig setzen (der Client schickt zwar auch einen Wert,
-- massgeblich ist aber immer die Serverzeit).
create or replace function public.idle_player_meta_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists idle_player_meta_touch_trg on public.idle_player_meta;
create trigger idle_player_meta_touch_trg
  before insert or update on public.idle_player_meta
  for each row execute function public.idle_player_meta_touch();

notify pgrst, 'reload schema';
