/* ============================================================
   Gildensystem-Erweiterung: Beitrittsanfrage als Alternative zum reinen
   Code-Beitritt (Spieler-Feedback 16.07.: "wäre es Möglich das man sieht
   wer in welcher Gilde drin ist... Und gerne auch in der Gilden Liste die
   anzeigen die Privat sind. Vielleicht ein 'Anfrage' Join Funktion?
   Anstatt Code?").

   Antragsteller stellt eine Anfrage an eine (oeffentliche ODER private)
   Gilde, Anfuehrer/Stellvertreter/Veteran nehmen an oder lehnen ab -
   dieselbe Rechte-Stufe wie das bestehende "Mitglieder einladen"
   (siehe get_my_guild_invite_code() in supabase-guild-roles-veteran.sql).
   Bei Annahme laeuft exakt dieselbe Kernlogik wie join_guild()/
   join_guild_by_code() (Groessen-Check, Aktivitaetslog-Eintrag).

   Mitgliederliste/private-Gilden-Sichtbarkeit brauchen KEINE SQL-Aenderung -
   guild_members/guilds sind serverseitig bereits vollstaendig oeffentlich
   lesbar (RLS "using (true)"), die Browse-Liste hat das bisher nur
   clientseitig ausgefiltert. Diese Datei betrifft ausschliesslich die neue
   Anfrage-Funktion.

   Baut auf supabase-idle-guilds.sql + supabase-idle-guilds-settings-chat.sql
   + supabase-guild-extension-foundation.sql + supabase-guild-roles-veteran.sql
   auf - muss NACH diesen Dateien ausgefuehrt werden.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   idempotent: mehrfaches Ausfuehren ist unschaedlich.
   ============================================================ */

create table if not exists public.guild_join_requests (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references public.guilds(id) on delete cascade,
  auth_user_id uuid not null,
  name_key text not null,
  display_name text not null,
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_name text
);
create index if not exists guild_join_requests_guild_idx on public.guild_join_requests (guild_id, status);
-- Verhindert doppelte OFFENE Anfragen an dieselbe Gilde (faengt eine
-- Wettlaufsituation aus zwei schnellen Klicks serverseitig ab; der
-- freundlichere "already_requested"-Fehler in request_guild_join() greift
-- meistens schon vorher).
create unique index if not exists guild_join_requests_pending_unique
  on public.guild_join_requests (guild_id, auth_user_id) where status = 'pending';

alter table public.guild_join_requests enable row level security;
grant select on public.guild_join_requests to authenticated;

-- Antragsteller sieht die eigenen Anfragen (an beliebig viele Gilden
-- gleichzeitig moeglich), Anfuehrer/Stellvertreter/Veteran sehen alle
-- Anfragen an die EIGENE Gilde. Bewusst NICHT die offene "using (true)"-
-- Vorlage von guilds/guild_members - eine Anfrage ist keine oeffentliche
-- Information.
drop policy if exists "Own or guild staff read join requests" on public.guild_join_requests;
create policy "Own or guild staff read join requests" on public.guild_join_requests for select to authenticated
using (
  auth_user_id = auth.uid()
  or exists (
    select 1 from public.guild_members gm
    where gm.guild_id = guild_join_requests.guild_id
      and gm.auth_user_id = auth.uid()
      and gm.role in ('leader', 'officer', 'veteran')
  )
);
-- Kein direktes insert/update/delete fuer Clients - nur die drei RPCs unten.

-- ============================================================
-- request_guild_join(): legt eine neue Anfrage an. Gleiche Vorbedingungen
-- wie join_guild() (echter Idle-Spielstand vorhanden, noch in keiner
-- Gilde) - funktioniert bewusst fuer OEFFENTLICHE und PRIVATE Gilden
-- gleichermassen (fuer oeffentliche bleibt der direkte Sofort-Beitritt
-- per join_guild() natuerlich weiterhin die schnellere Option).
-- ============================================================
create or replace function public.request_guild_join(p_guild_id uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_display_name text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.guild_members where auth_user_id = v_uid) then raise exception 'already_in_guild'; end if;

  select display_name into v_display_name from public.idle_player_state where auth_user_id = v_uid limit 1;
  if v_display_name is null then raise exception 'no_idle_state'; end if;

  if not exists (select 1 from public.guilds where id = p_guild_id) then raise exception 'guild_not_found'; end if;

  if exists (select 1 from public.guild_join_requests where guild_id = p_guild_id and auth_user_id = v_uid and status = 'pending') then
    raise exception 'already_requested';
  end if;

  insert into public.guild_join_requests (guild_id, auth_user_id, name_key, display_name, message)
  values (p_guild_id, v_uid, lower(v_display_name), v_display_name, nullif(trim(coalesce(p_message, '')), ''));
end;
$$;
grant execute on function public.request_guild_join(uuid, text) to authenticated;

-- ============================================================
-- cancel_guild_join_request(): Antragsteller zieht die eigene, noch
-- offene Anfrage zurueck (z.B. um sich stattdessen anderswo zu bewerben).
-- ============================================================
create or replace function public.cancel_guild_join_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.guild_join_requests
  set status = 'cancelled', decided_at = now()
  where id = p_request_id and auth_user_id = v_uid and status = 'pending';
  if not found then raise exception 'request_not_found'; end if;
end;
$$;
grant execute on function public.cancel_guild_join_request(uuid) to authenticated;

-- ============================================================
-- respond_guild_join_request(): Anfuehrer/Stellvertreter/Veteran nimmt an
-- oder lehnt ab. Bei Annahme exakt dieselben Pruefungen/Effekte wie
-- join_guild() (Groessen-Deckel 20, Aktivitaetslog-Eintrag 'join'), plus:
-- alle ANDEREN offenen Anfragen desselben Spielers an andere Gilden werden
-- automatisch storniert (er kann ja nur noch in dieser einen Gilde sein -
-- sonst blieben tote Anfragen liegen, die eine andere Gildenleitung
-- spaeter faelschlich noch annehmen koennte).
-- ============================================================
create or replace function public.respond_guild_join_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_my_role text;
  v_request record;
  v_member_count integer;
  v_decider_name text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_request from public.guild_join_requests where id = p_request_id for update;
  if v_request is null then raise exception 'request_not_found'; end if;
  if v_request.status <> 'pending' then raise exception 'request_already_decided'; end if;

  select role, display_name into v_my_role, v_decider_name
  from public.guild_members where auth_user_id = v_uid and guild_id = v_request.guild_id;
  if v_my_role is null or v_my_role not in ('leader', 'officer', 'veteran') then raise exception 'not_authorized'; end if;

  if not p_accept then
    update public.guild_join_requests set status = 'rejected', decided_at = now(), decided_by_name = v_decider_name where id = p_request_id;
    return;
  end if;

  -- Zwischenzeitlich anderswo beigetreten (z.B. per Code)? Anfrage kann
  -- nicht mehr angenommen werden.
  if exists (select 1 from public.guild_members where auth_user_id = v_request.auth_user_id) then
    update public.guild_join_requests set status = 'cancelled', decided_at = now(), decided_by_name = v_decider_name where id = p_request_id;
    raise exception 'requester_already_in_guild';
  end if;

  select member_count into v_member_count from public.guilds where id = v_request.guild_id;
  if v_member_count >= 20 then raise exception 'guild_full'; end if;

  insert into public.guild_members (auth_user_id, guild_id, name_key, display_name, role)
  values (v_request.auth_user_id, v_request.guild_id, v_request.name_key, v_request.display_name, 'member');

  update public.guilds set member_count = member_count + 1 where id = v_request.guild_id;

  insert into public.guild_activity_log (guild_id, kind, actor_name)
  values (v_request.guild_id, 'join', v_request.display_name);

  update public.guild_join_requests set status = 'accepted', decided_at = now(), decided_by_name = v_decider_name where id = p_request_id;

  update public.guild_join_requests
  set status = 'cancelled', decided_at = now()
  where auth_user_id = v_request.auth_user_id and status = 'pending' and id <> p_request_id;
end;
$$;
grant execute on function public.respond_guild_join_request(uuid, boolean) to authenticated;
