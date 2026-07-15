-- Bkmp - Gildenboss: eigener Schaden soll sofort in der Rangliste/"Dein
-- Schaden"-Anzeige stehen, nicht erst nach dem Realtime-Roundtrip.
--
-- Spieler-Report 15.07. (Screenshot: Boss-HP zeigte bereits 1.98M/2M
-- Schaden, aber "Dein Schaden: 0 (0% Anteil)" und die gesamte Rangliste
-- blieben bei 0 stehen - erst ein manueller Seiten-Reload zeigte den
-- korrekten Stand): guild_boss_deal_damage() gab bisher nur (boss_hp,
-- status) zurueck. Der Client aktualisierte damit nur die Boss-HP-Leiste
-- lokal - die eigene Zeile in der Teilnehmerliste wurde ausschliesslich
-- ueber die Realtime-Subscription (postgres_changes auf
-- guild_boss_participants) nachgezogen. Bei aktivem Auto-Tick alle paar
-- Sekunden blieb die eigene Anzeige dadurch dauerhaft auf dem Stand vom
-- Beitritt (0) stehen, sobald/solange dieses Realtime-Event den Client
-- nicht erreichte.
--
-- Exakt dasselbe Muster wie beim Raidboss, siehe
-- supabase-raid-damage-sync-fix.sql: die Funktion liefert den bereits
-- serverseitig berechneten eigenen Stand (damage_dealt/crits_landed/
-- clicks_landed) jetzt direkt in der Antwort mit zurueck, damit der
-- Client die eigene Zeile SOFORT lokal setzen kann, ohne auf Realtime zu
-- warten. Realtime bleibt fuer die ANDEREN Gildenmitglieder unveraendert
-- im Einsatz.
--
-- Enthaelt weiterhin alle Alias-Qualifizierungen + "#variable_conflict
-- use_column" aus supabase-guild-boss-ambiguous-status-fix.sql (1:1
-- uebernommen) - nur der Rueckgabetyp aendert sich um die drei neuen
-- Spalten. Postgres erlaubt eine Typaenderung nicht per CREATE OR
-- REPLACE, daher erst DROP.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

drop function if exists public.guild_boss_deal_damage(text, numeric, boolean, boolean);

create or replace function public.guild_boss_deal_damage(p_instance_id text, p_amount numeric, p_is_crit boolean default false, p_is_click boolean default false)
returns table (boss_hp bigint, status text, own_damage_dealt bigint, own_crits_landed integer, own_clicks_landed integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_amount bigint := greatest(0, round(p_amount));
  v_status text;
  v_fight_ends timestamptz;
  v_new_hp bigint;
  v_own_damage bigint;
  v_own_crits integer;
  v_own_clicks integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_amount <= 0 or v_amount > 200000 then raise exception 'invalid_amount'; end if;
  if not exists (select 1 from public.guild_boss_participants where instance_id = p_instance_id and auth_user_id = v_uid) then
    raise exception 'not_a_participant';
  end if;

  select gbi.status, gbi.fight_ends_at into v_status, v_fight_ends from public.guild_boss_instances gbi where gbi.id = p_instance_id for update;
  if v_status is null then raise exception 'boss_not_found'; end if;
  if v_status <> 'fighting' then raise exception 'boss_not_active'; end if;

  if now() >= v_fight_ends then
    perform public.guild_boss_finish(p_instance_id, 'expired');
    select gbp.damage_dealt, gbp.crits_landed, gbp.clicks_landed into v_own_damage, v_own_crits, v_own_clicks
    from public.guild_boss_participants gbp where gbp.instance_id = p_instance_id and gbp.auth_user_id = v_uid;
    return query select gbi.boss_hp, gbi.status, v_own_damage, v_own_crits, v_own_clicks from public.guild_boss_instances gbi where gbi.id = p_instance_id;
    return;
  end if;

  update public.guild_boss_instances gbi
  set boss_hp = greatest(0, gbi.boss_hp - v_amount), total_damage = gbi.total_damage + v_amount
  where gbi.id = p_instance_id
  returning gbi.boss_hp into v_new_hp;

  update public.guild_boss_participants
  set damage_dealt = damage_dealt + v_amount,
      crits_landed = crits_landed + (case when p_is_crit then 1 else 0 end),
      clicks_landed = clicks_landed + (case when p_is_click then 1 else 0 end)
  where instance_id = p_instance_id and auth_user_id = v_uid
  returning damage_dealt, crits_landed, clicks_landed into v_own_damage, v_own_crits, v_own_clicks;

  update public.guild_boss_player_stats
  set total_damage_dealt = total_damage_dealt + v_amount,
      best_single_fight_damage = greatest(best_single_fight_damage, v_own_damage)
  where auth_user_id = v_uid;

  if v_new_hp <= 0 then
    perform public.guild_boss_finish(p_instance_id, 'won');
  end if;

  return query select gbi.boss_hp, gbi.status, v_own_damage, v_own_crits, v_own_clicks from public.guild_boss_instances gbi where gbi.id = p_instance_id;
end;
$$;
grant execute on function public.guild_boss_deal_damage(text, numeric, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
