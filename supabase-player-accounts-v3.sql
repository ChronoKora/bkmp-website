-- Bkmp - Spieler-Konten v3: Login funktioniert mit JEDEM je benutzten Namen
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Bug-Report: ein Spieler hat sich umbenannt und konnte sich danach nicht
-- mehr einloggen ("falscher Name oder Passwort"), obwohl beides stimmte -
-- er hat nur den NEUEN Namen probiert. Grund: die Login-E-Mail ist absichtlich
-- fest an den urspruenglich REGISTRIERTEN Namen gebunden (siehe Kommentar in
-- supabase-player-accounts-v2.sql - eine Aenderung der Auth-E-Mail selbst
-- waere riskant). Das war fuer Spieler aber nicht ersichtlich.
--
-- Fix: eine neue Funktion laeuft die player_name_history-Kette rueckwaerts
-- (neuer Name -> alter Name -> ... -> allererster Name) und liefert den
-- urspruenglichen Registrierungsnamen zurueck. supabase.js probiert beim
-- Login damit zuerst den eingegebenen Namen direkt, faellt bei einem
-- Fehlschlag aber automatisch auf den aufgeloesten Namen zurueck - Login
-- funktioniert danach mit JEDEM Namen, den der Account je hatte.

create or replace function public.resolve_login_name(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text := trim(p_name);
  v_key text := lower(v_current);
  v_found text;
  v_iterations int := 0;
begin
  loop
    select old_name into v_found
    from public.player_name_history
    where lower(new_name) = v_key
    order by changed_at desc
    limit 1;

    exit when v_found is null or v_iterations >= 20;
    v_current := v_found;
    v_key := lower(v_current);
    v_iterations := v_iterations + 1;
  end loop;

  return v_current;
end;
$$;
grant execute on function public.resolve_login_name(text) to anon, authenticated;

/* ---------------- rename_player_account: zusaetzlich auth.users synchron halten ----------------
   Ergaenzung zur Version aus v2: schreibt den neuen Namen jetzt auch in
   auth.users.raw_user_meta_data.display_name. Das allein loest das
   Login-Problem oben NICHT (die Login-E-Mail bleibt bewusst unveraendert),
   sorgt aber dafuer, dass das JWT nach dem naechsten Login/Token-Refresh
   wieder den AKTUELLEN Namen traegt statt fuer immer den allerersten -
   relevant fuer alles, was sich auf user_metadata.display_name verlaesst. */
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

  update public.user_plushies
  set name_key = v_new_key, display_name = v_new_name
  where name_key = v_old_row.name_key;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('display_name', v_new_name)
  where id = v_uid;
end;
$$;
grant execute on function public.rename_player_account(text) to authenticated;
