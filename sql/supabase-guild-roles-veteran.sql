/* ============================================================
   Gildensystem-Erweiterung, Phase D: Rollen & Rechte-Matrix
   (Spieler-Wunsch: "Nicht nur Anführer und Mitglied... zusaetzliche
   Rollen: Anführer / Stellvertreter / Veteran / Mitglied").

   Rollen-Leiter: member < veteran < officer(="Stellvertreter") < leader.
   "officer" bleibt bewusst der interne DB-Wert fuer "Stellvertreter" -
   war schon vorher so benannt (BKMP_GUILD_ROLE_LABELS), nur das Label
   aendert sich nicht, nur eine neue Stufe wird dazwischengeschoben.

   Rechte-Matrix laut Vorgabe:
   - Anführer: alles
   - Stellvertreter: Mitglieder einladen, Mitglieder entfernen,
     Gildenquests starten (Phase F), Technologie verbessern (Phase E)
   - Veteran: Mitglieder einladen, Chat moderieren
   - Mitglied: normale Rechte (spenden, chatten, verlassen)
   "Mitglieder entfernen" (kick_guild_member) war schon immer auf
   leader+officer beschraenkt - unveraendert, Veteran bekommt hier
   bewusst KEIN Kick-Recht. "Mitglieder einladen" bedeutet konkret: den
   Einladungscode einsehen (jede tatsaechliche Gildengruendung/-beitritt
   passiert weiterhin durch den beitretenden Spieler selbst, es gibt
   keinen direkten "invite a specific player"-Mechanismus).

   Baut auf supabase-idle-guilds.sql +
   supabase-guild-extension-foundation.sql auf. Supabase Dashboard >
   SQL Editor > New query > diesen Inhalt ausfuehren. idempotent.
   ============================================================ */

alter table public.guild_members drop constraint if exists guild_members_role_check;
alter table public.guild_members add constraint guild_members_role_check
  check (role in ('leader', 'officer', 'veteran', 'member'));

-- ============================================================
-- set_guild_member_role(): jetzt zusaetzlich 'veteran' als gueltiges
-- Ziel. Rollenvergabe selbst bleibt bewusst Anfuehrer-exklusiv (die
-- Rechte-Matrix delegiert das NICHT an den Stellvertreter).
-- ============================================================
create or replace function public.set_guild_member_role(p_target_auth_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_target_guild_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_new_role not in ('officer', 'veteran', 'member') then raise exception 'invalid_role'; end if;

  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid and role = 'leader';
  if v_guild_id is null then raise exception 'not_authorized'; end if;

  select guild_id into v_target_guild_id from public.guild_members where auth_user_id = p_target_auth_user_id;
  if v_target_guild_id is null or v_target_guild_id <> v_guild_id then raise exception 'not_a_member'; end if;

  update public.guild_members set role = p_new_role where auth_user_id = p_target_auth_user_id;

  insert into public.guild_activity_log (guild_id, kind, actor_name, extra)
  select v_guild_id, case when p_new_role = 'member' then 'demote' else 'promote' end, display_name, p_new_role
  from public.guild_members where auth_user_id = p_target_auth_user_id;
end;
$$;
grant execute on function public.set_guild_member_role(uuid, text) to authenticated;

-- ============================================================
-- get_my_guild_invite_code(): "Mitglieder einladen" gehoert jetzt auch
-- zu Stellvertreter UND Veteran, nicht mehr nur zum Anfuehrer - beide
-- duerfen den bestehenden Code einsehen und weitergeben. Den Code neu
-- zu ERZEUGEN (invalidiert bereits geteilte Codes) bleibt bewusst
-- Anfuehrer-exklusiv, siehe regenerate_guild_invite_code() unveraendert.
-- ============================================================
create or replace function public.get_my_guild_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_code text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid and role in ('leader', 'officer', 'veteran');
  if v_guild_id is null then raise exception 'not_authorized'; end if;
  select invite_code into v_code from public.guilds where id = v_guild_id;
  return v_code;
end;
$$;
grant execute on function public.get_my_guild_invite_code() to authenticated;

-- ============================================================
-- delete_guild_chat_message(): neues Veteran-Recht "Chat moderieren".
-- Leader/Officer/Veteran duerfen jede Nachricht ihrer eigenen Gilde
-- loeschen (nicht nur eigene) - klassische Moderations-Befugnis.
-- ============================================================
create or replace function public.delete_guild_chat_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_my_role text;
  v_guild_id uuid;
  v_message_guild_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select guild_id, role into v_guild_id, v_my_role from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null or v_my_role not in ('leader', 'officer', 'veteran') then raise exception 'not_authorized'; end if;

  select guild_id into v_message_guild_id from public.guild_chat_messages where id = p_message_id;
  if v_message_guild_id is null or v_message_guild_id <> v_guild_id then raise exception 'not_a_member'; end if;

  delete from public.guild_chat_messages where id = p_message_id;
end;
$$;
grant execute on function public.delete_guild_chat_message(uuid) to authenticated;
