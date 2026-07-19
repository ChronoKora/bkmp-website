-- ============================================================
-- Gildenbanner (Spieler-Wunsch "Gildenbanner" aus der Gildensystem-
-- Erweiterung) - Baukasten aus kuratierten Presets (Farbverlauf +
-- Symbol-Emoji), KEIN Bild-Upload (vermeidet Moderations-/Storage-
-- Aufwand). Wird in guilds.banner (jsonb, existiert bereits seit
-- supabase-guild-extension-foundation.sql) gespeichert, z.B.
-- {"color":"gold","symbol":"🐉"}. Nur der Anführer darf es ändern.
-- Idempotent, kann gefahrlos mehrfach ausgeführt werden.
-- ============================================================

create or replace function public.update_guild_banner(p_banner jsonb)
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
  set banner = coalesce(p_banner, '{}'::jsonb)
  where id = v_guild_id;
end;
$$;

grant execute on function public.update_guild_banner(jsonb) to authenticated;
