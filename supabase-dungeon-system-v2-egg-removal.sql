/* ============================================================
   Dungeon-System 2.0 (Spieler-Vorgabe 17.07.): der Ei-Dungeon wird
   die zentrale/exklusive Quelle fuer Dracheneier. Normale Drachen-
   kaempfe und Raidboss-Siege sollen deshalb aufhoeren, reguläre
   Dracheneier zu droppen. Diese Datei entfernt NUR die beiden 1%-
   Ei-Wuerfe aus raid_finish() (Zerathor/Yakshadrache) und ersetzt sie
   durch je eine 1%-Chance auf einen 30-Minuten-Booster (Goldrausch/
   Wissensschub, siehe supabase-dungeon-system-v2.sql fuer die neuen
   boost_gold_until/boost_exp_until-Spalten) - alles andere in
   raid_finish() (Gold/Gem/XP-Verteilung, MVP/Flawless-Statistik,
   5%-Zerator-Plushie, 1%-Zerathordorf-Skin) bleibt unveraendert.

   Bestehende, bereits vergebene Eier/Drachen sind von dieser
   Aenderung nicht betroffen - es wird ausschliesslich die
   Vergabe-Logik fuer KUENFTIGE Raid-Siege geaendert.

   Muss NACH supabase-dungeon-system-v2.sql ausgefuehrt werden
   (braucht die boost_gold_until/boost_exp_until-Spalten).
   Idempotent: create or replace, sichere mehrfache Ausfuehrung.
   Supabase Dashboard > SQL Editor > New query > diesen Inhalt
   ausfuehren.
   ============================================================ */

create or replace function public.raid_finish(p_raid_id text, p_result text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boss_reward record;
  v_city_hp bigint;
  v_city_max_hp bigint;
  v_mvp_uid uuid;
  v_flawless boolean;
  rec record;
  v_owns_zerator boolean;
  v_code text;
  v_attempt int;
  v_owns_zerathordorf boolean;
begin
  update public.raid_instances
  set status = p_result, ended_at = now()
  where id = p_raid_id and status = 'fighting';
  if not found then return; end if;

  select ri.city_hp, ri.city_max_hp into v_city_hp, v_city_max_hp
  from public.raid_instances ri where ri.id = p_raid_id;
  v_flawless := (v_city_max_hp > 0 and v_city_hp >= v_city_max_hp);

  select auth_user_id into v_mvp_uid
  from public.raid_participants where raid_id = p_raid_id order by damage_dealt desc limit 1;

  if p_result = 'won' then
    select rb.gold_reward, rb.gem_reward, rb.xp_reward into v_boss_reward
    from public.raid_instances ri join public.raid_bosses rb on rb.id = ri.boss_id
    where ri.id = p_raid_id;

    for rec in select * from public.raid_participants where raid_id = p_raid_id loop
      update public.idle_player_state
      set gold = gold + v_boss_reward.gold_reward,
          total_gold_earned = total_gold_earned + v_boss_reward.gold_reward,
          crystals = crystals + v_boss_reward.gem_reward,
          xp = xp + v_boss_reward.xp_reward
      where auth_user_id = rec.auth_user_id;

      update public.raid_player_stats
      set total_bosses_defeated = total_bosses_defeated + 1,
          total_mvp_count = total_mvp_count + (case when rec.auth_user_id = v_mvp_uid then 1 else 0 end),
          total_flawless_wins = total_flawless_wins + (case when v_flawless then 1 else 0 end),
          updated_at = now()
      where auth_user_id = rec.auth_user_id;

      select exists(
        select 1 from public.user_plushies
        where name_key = lower(trim(rec.display_name)) and plushie_id = 'zerathor_zorn_der_verdammnis'
      ) into v_owns_zerator;

      if not v_owns_zerator and random() < 0.05 then
        v_code := null;
        for v_attempt in 1..5 loop
          begin
            v_code := 'ZERATOR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
            insert into public.plushie_codes (code, plushie_id, note, created_by_admin)
            values (v_code, 'zerathor_zorn_der_verdammnis', 'Automatische 5%-Raidboss-Belohnung fuer ' || rec.display_name || ' (Raid ' || p_raid_id || ').', 'system');
            exit;
          exception when unique_violation then
            v_code := null;
          end;
        end loop;

        if v_code is not null then
          insert into public.raid_reward_codes (raid_id, name_key, display_name, plushie_id, code)
          values (p_raid_id, lower(trim(rec.display_name)), rec.display_name, 'zerathor_zorn_der_verdammnis', v_code)
          on conflict (raid_id, name_key) do nothing;
        end if;
      end if;

      select exists(
        select 1 from public.idle_player_village_skins
        where auth_user_id = rec.auth_user_id and skin_id = 'zerathordorf'
      ) into v_owns_zerathordorf;

      if not v_owns_zerathordorf and random() < 0.01 then
        insert into public.idle_player_village_skins (name_key, auth_user_id, skin_id)
        values (lower(trim(rec.display_name)), rec.auth_user_id, 'zerathordorf')
        on conflict (auth_user_id, skin_id) do nothing;
      end if;

      -- Ersatz fuer die frueheren 2 legendaeren Ei-Wuerfe (Dungeon-System
      -- 2.0: der Ei-Dungeon ist jetzt die alleinige Quelle fuer reguläre
      -- Dracheneier). Gleiche 1%-Chance, jetzt auf einen 30-Minuten-
      -- Booster statt eines Eis - unabhaengige Wuerfe, Boosts stapeln
      -- sich nicht ueber die einfache Verlaengerung hinaus.
      if random() < 0.01 then
        update public.idle_player_state
        set boost_gold_until = greatest(coalesce(boost_gold_until, now()), now()) + interval '30 minutes'
        where auth_user_id = rec.auth_user_id;
      end if;
      if random() < 0.01 then
        update public.idle_player_state
        set boost_exp_until = greatest(coalesce(boost_exp_until, now()), now()) + interval '30 minutes'
        where auth_user_id = rec.auth_user_id;
      end if;
    end loop;
  end if;
end;
$$;
grant execute on function public.raid_finish(text, text) to authenticated;

notify pgrst, 'reload schema';
