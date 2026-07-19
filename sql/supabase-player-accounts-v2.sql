-- Bkmp - Spieler-Konten v2: Namensaenderung + robustere Claim-Logik
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Voraussetzung: supabase-player-accounts.sql wurde bereits (oder wird davor)
-- ausgefuehrt. Diese Datei ist unabhaengig davon sicher erneut ausfuehrbar
-- (alles "if not exists"/"drop ... if exists" + "create or replace").
--
-- Warum dieser Nachtrag: das urspruengliche RLS-Design band jeden Schreib-
-- zugriff auf player_stats/idle_player_state an
-- "name_key = lower(JWT-user_metadata.display_name)". Das passt fuer eine
-- UNVERAENDERLICHE Identitaet, ist aber fuer eine aenderbare (Namensaenderung,
-- dieser Nachtrag) fragil: das JWT traegt bis zum naechsten Token-Refresh
-- noch den alten Namen, wuerde also eigene Schreibversuche direkt nach einer
-- Umbenennung faelschlich blockieren. Claimen und Umbenennen laufen deshalb
-- ab jetzt ausschliesslich ueber die beiden SECURITY DEFINER-Funktionen
-- unten (nutzen auth.uid() direkt, kein JWT-Metadata-Vergleich noetig) -
-- normale Gameplay-Schreibzugriffe (Level, Gold, Erfolge, ...) aendern
-- name_key nie und werden dadurch mit reinem "auth_user_id = auth.uid()"
-- ausreichend abgesichert.

alter table public.player_stats add column if not exists achievement_unlocks jsonb not null default '{}'::jsonb;
alter table public.player_stats add column if not exists last_name_change_at timestamptz;

create table if not exists public.player_name_history (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null,
  old_name text not null,
  new_name text not null,
  changed_at timestamptz not null default now()
);
alter table public.player_name_history enable row level security;
grant select on public.player_name_history to authenticated;
drop policy if exists "Admin read player name history" on public.player_name_history;
create policy "Admin read player name history"
on public.player_name_history for select
to authenticated
using (public.is_active_admin());
-- Keine insert/update/delete-Policies fuer anon/authenticated: Zeilen
-- entstehen ausschliesslich ueber rename_player_account() (SECURITY
-- DEFINER, umgeht RLS serverseitig kontrolliert).

/* ---------------- claim_player_row: verwaiste Zeile beim Registrieren/Login uebernehmen ---------------- */
create or replace function public.claim_player_row(p_name_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  update public.player_stats set auth_user_id = v_uid where name_key = p_name_key and auth_user_id is null;
  update public.idle_player_state set auth_user_id = v_uid where name_key = p_name_key and auth_user_id is null;
end;
$$;
grant execute on function public.claim_player_row(text) to authenticated;

/* ---------------- rename_player_account: Ingame-Namen aendern (30-Tage-Cooldown) ---------------- */
create or replace function public.rename_player_account(p_new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new_name text := trim(p_new_name);
  v_new_key text := lower(v_new_name);
  v_old_row public.player_stats%rowtype;
  v_conflict_owner uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if v_new_key = '' or length(v_new_key) > 32 then
    raise exception 'invalid_name';
  end if;

  select * into v_old_row from public.player_stats where auth_user_id = v_uid limit 1;
  if not found then
    raise exception 'no_account';
  end if;

  if v_old_row.name_key = v_new_key then
    raise exception 'same_name';
  end if;

  if v_old_row.last_name_change_at is not null and v_old_row.last_name_change_at > now() - interval '30 days' then
    raise exception 'cooldown_active';
  end if;

  select auth_user_id into v_conflict_owner from public.player_stats where name_key = v_new_key limit 1;
  if found and v_conflict_owner is distinct from v_uid then
    raise exception 'name_taken';
  end if;

  insert into public.player_name_history (auth_user_id, old_name, new_name)
  values (v_uid, v_old_row.display_name, v_new_name);

  update public.player_stats
  set name_key = v_new_key, display_name = v_new_name, last_name_change_at = now()
  where auth_user_id = v_uid;

  update public.idle_player_state
  set name_key = v_new_key, display_name = v_new_name
  where auth_user_id = v_uid;

  -- Bestandsdaten (Pluschie-Besitz), die bisher nur ueber den alten Namen
  -- verknuepft waren (user_plushies ist nicht auth_user_id-gebunden),
  -- bestmoeglich mitnehmen, damit "vorhandene Namenslogik nicht kaputt geht".
  update public.user_plushies
  set name_key = v_new_key, display_name = v_new_name
  where name_key = v_old_row.name_key;
end;
$$;
grant execute on function public.rename_player_account(text) to authenticated;

/* ---------------- Vereinfachte, robustere RLS fuer player_stats/idle_player_state ---------------- */
drop policy if exists "Owner insert player stats" on public.player_stats;
create policy "Owner insert player stats"
on public.player_stats for insert
to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "Owner update player stats" on public.player_stats;
create policy "Owner update player stats"
on public.player_stats for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

drop policy if exists "Owner insert idle player state" on public.idle_player_state;
create policy "Owner insert idle player state"
on public.idle_player_state for insert
to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "Owner update idle player state" on public.idle_player_state;
create policy "Owner update idle player state"
on public.idle_player_state for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());
