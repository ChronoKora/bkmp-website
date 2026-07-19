-- ============================================================
-- Gildenziel (Spieler-Wunsch "Gildenziel" aus der Gildensystem-
-- Erweiterung) - freies Textfeld, vom Anführer editierbar, oberhalb des
-- Chats fuer alle Mitglieder sichtbar. Nutzt die bereits vorhandene Spalte
-- guilds.current_goal (siehe supabase-guild-extension-foundation.sql).
-- Eigene RPC statt Erweiterung von update_guild_settings, um dessen
-- bestehende Signatur (2 Parameter) nicht zu veraendern. Idempotent.
-- ============================================================

create or replace function public.update_guild_goal(p_goal text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid and role = 'leader';
  if v_guild_id is null then raise exception 'not_authorized'; end if;

  update public.guilds
  set current_goal = left(trim(coalesce(p_goal, '')), 100)
  where id = v_guild_id;
end;
$$;

grant execute on function public.update_guild_goal(text) to authenticated;
