/* ============================================================
   Admin-Panel: Spieler-Verwaltung (Spieler-Wunsch 14.07.: "Funktion im
   AdminPanel mit gerade erstellten Account und einer Löschfunktion die mir
   gleichzeitig die SQL-Datei erstellt") - direkte Folge der wiederholten
   Troll-Accounts vom selben Tag (Adolf/KillTheJews88/Heinrich_H/Sakuyumi),
   die bisher jedes Mal ein manuell in den Chat gepostetes Loesch-Skript
   brauchten. Ab jetzt: Liste der zuletzt registrierten Accounts direkt im
   Admin-Panel, ein Klick loescht komplett (dieselbe Tabellen-Kaskade wie die
   bisherigen manuellen Skripte) UND das Admin-Panel kann sich zusaetzlich
   das aequivalente SQL-Skript als Datei herunterladen (Transparenz/Backup).

   Beide Funktionen sind admin-gated ueber is_active_admin() (siehe
   supabase-security-hardening.sql) - kein Spieler kann das selbst aufrufen.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   idempotent: mehrfaches Ausfuehren ist unschaedlich.
   ============================================================ */

create or replace function public.admin_list_recent_players(p_limit integer default 30)
returns table (
  auth_user_id uuid,
  display_name text,
  name_key text,
  created_at timestamptz,
  bonk_count integer,
  achievements_unlocked integer,
  minutes_spent integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_active_admin() then
    raise exception 'not_admin';
  end if;
  return query
  select u.id, ps.display_name, ps.name_key, u.created_at,
         coalesce(ps.bonk_count, 0), coalesce(ps.achievements_unlocked, 0), coalesce(ps.minutes_spent, 0)
  from auth.users u
  join public.player_stats ps on ps.auth_user_id = u.id
  order by u.created_at desc
  limit greatest(1, least(200, p_limit));
end;
$$;
grant execute on function public.admin_list_recent_players(integer) to authenticated;

-- ============================================================
-- admin_delete_player_account(): dieselbe Tabellen-Kaskade wie die
-- bisherigen manuellen Loesch-Skripte im Chat, jetzt als wiederverwendbare
-- Funktion. Absichtlich NICHT identisch mit delete_own_player_account()
-- (die prueft auth.uid() = eigener Account) - hier darf ein Admin JEDEN
-- Account angeben.
-- ============================================================
create or replace function public.admin_delete_player_account(p_auth_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_name_key text;
  v_display_name text;
begin
  if not public.is_active_admin() then
    raise exception 'not_admin';
  end if;
  if p_auth_user_id is null then
    raise exception 'invalid_target';
  end if;

  select ps.name_key, ps.display_name into v_name_key, v_display_name
  from public.player_stats ps where ps.auth_user_id = p_auth_user_id limit 1;

  if v_name_key is null then
    select ips.name_key, ips.display_name into v_name_key, v_display_name
    from public.idle_player_state ips where ips.auth_user_id = p_auth_user_id limit 1;
  end if;

  delete from public.wish_votes where auth_user_id = p_auth_user_id;
  delete from public.raid_participants where auth_user_id = p_auth_user_id;
  delete from public.raid_player_stats where auth_user_id = p_auth_user_id;
  delete from public.idle_event_dragon_state where auth_user_id = p_auth_user_id or (v_name_key is not null and name_key = v_name_key);
  if v_name_key is not null then
    delete from public.user_plushies where name_key = v_name_key;
    delete from public.idle_prestige_state where name_key = v_name_key;
    delete from public.idle_dungeon_results where name_key = v_name_key;
  end if;
  delete from public.idle_player_runes where auth_user_id = p_auth_user_id;
  delete from public.poll_votes where auth_user_id = p_auth_user_id;
  delete from public.idle_player_state where auth_user_id = p_auth_user_id;
  delete from public.player_stats where auth_user_id = p_auth_user_id;
  delete from auth.users where id = p_auth_user_id;

  return coalesce(v_display_name, 'Unbekannt');
end;
$$;
grant execute on function public.admin_delete_player_account(uuid) to authenticated;
