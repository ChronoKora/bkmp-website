-- Bkmp - Selbstständiges Löschen des eigenen Spieler-Accounts.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- WICHTIG: braucht supabase-player-accounts.sql / -v2.sql / -v3.sql (fuer
-- die player_stats/idle_player_state-Struktur und den player-auth-Client).
--
-- Loescht den kompletten Spielstand des eingeloggten Spielers UND seinen
-- Login-Account (auth.users) unwiderruflich - genau das, wonach ein Spieler
-- fragt, der "alle meine Daten loeschen" will (siehe Support-Anfrage per
-- Mail, die ohne echten Login gar nicht sicher verifizierbar waere - dieser
-- RPC ist die richtige Antwort darauf: wer eingeloggt ist und sein Passwort
-- kennt, hat sich bereits ausreichend verifiziert).
--
-- security definer, weil das Loeschen aus auth.users normale RLS-Rechte
-- eines "authenticated"-Nutzers uebersteigt - die Funktion laeuft mit den
-- Rechten ihres Erstellers (i. d. R. postgres/supabase_admin ueber den SQL
-- Editor), PRUEFT aber selbst zuerst auth.uid(), sodass ein Nutzer
-- ausschliesslich SEINEN EIGENEN Account loeschen kann.
create or replace function public.delete_own_player_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_name_key text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Aktuellen name_key ueber die eigene idle_player_state/player_stats-Zeile
  -- ermitteln - user_plushies/idle_prestige_state haengen NICHT an
  -- auth_user_id, sondern ausschliesslich am name_key.
  select ips.name_key into v_name_key
  from public.idle_player_state ips
  where ips.auth_user_id = v_uid
  limit 1;

  if v_name_key is null then
    select lower(ps.display_name) into v_name_key
    from public.player_stats ps
    where ps.auth_user_id = v_uid
    limit 1;
  end if;

  -- Reihenfolge bewusst: erst abhaengige/verknuepfte Tabellen, zuletzt die
  -- Haupt-Zeilen und der Auth-Account selbst.
  delete from public.wish_votes where auth_user_id = v_uid;
  delete from public.raid_participants where auth_user_id = v_uid;
  delete from public.raid_player_stats where auth_user_id = v_uid;
  delete from public.idle_event_dragon_state where auth_user_id = v_uid or (v_name_key is not null and name_key = v_name_key);

  if v_name_key is not null then
    delete from public.user_plushies where name_key = v_name_key;
    delete from public.idle_prestige_state where name_key = v_name_key;
  end if;

  delete from public.idle_player_state where auth_user_id = v_uid;
  delete from public.player_stats where auth_user_id = v_uid;

  -- Zum Schluss der eigentliche Login-Account.
  delete from auth.users where id = v_uid;
end;
$$;

grant execute on function public.delete_own_player_account() to authenticated;
