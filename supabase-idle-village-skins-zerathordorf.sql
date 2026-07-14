-- Bkmp - Idle Drachen Dorf: vierter Dorf-Skin "Zerathor Dorf" (Video-Skin,
-- gleiches Schema wie Pinguindorf/Geisterdorf/Pilzdorf) - erster Skin mit
-- unlock_type='boss_drop' statt 'purchase': NICHT kaufbar, sondern 1%
-- Chance als Beute nach einem GEWONNENEN Weltboss-Raid (Nutzervorgabe
-- 16.07.: "Bekommen: 1% Chance vom Raid Welten Boss zubekommen").
--
-- Anders als beim Zerator-Pluschie (5%-Wurf, siehe
-- supabase-idle-event-dragons.sql) braucht dieser Drop KEINEN
-- Einloese-Code: Dorf-Skins sind nicht handelbar/uebertragbar wie
-- Pluschie-Codes, deshalb schreibt raid_finish() den Besitz direkt in
-- idle_player_village_skins (security definer, gleiche Vertrauens-Ebene
-- wie der Rest der server-seitigen Belohnungslogik).
--
-- frame_aspect_w/h zweckentfremdet als natives Video-Seitenverhaeltnis
-- (2230 x 930, echte Video-Massse) - siehe Kommentar in
-- supabase-idle-village-skins-pinguindorf.sql fuer die volle Begruendung.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.idle_village_skins add column if not exists video_file text;

insert into public.idle_village_skins (id, name, description, icon, image_file, video_file, unlock_type, price_gold, price_crystals, frame_count, frame_aspect_w, frame_aspect_h, unlock_hint, sort_order)
values ('zerathordorf', 'Zerathor Dorf', 'Ein von Zerathors Macht gezeichnetes Dorf im Bann des Weltboss-Drachen.', '🐉', '', 'assets/village/zerathordorf.mp4', 'boss_drop', 0, 0, 1, 2230, 930, '1% Chance als Beute nach einem gewonnenen Weltboss-Raid.', 4)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  image_file = excluded.image_file,
  video_file = excluded.video_file,
  unlock_type = excluded.unlock_type,
  price_gold = excluded.price_gold,
  price_crystals = excluded.price_crystals,
  frame_count = excluded.frame_count,
  frame_aspect_w = excluded.frame_aspect_w,
  frame_aspect_h = excluded.frame_aspect_h,
  unlock_hint = excluded.unlock_hint,
  sort_order = excluded.sort_order;

-- ============================================================
-- raid_finish neu definieren: 1:1 dieselbe Logik wie in
-- supabase-idle-event-dragons.sql (Gold/Kristalle/XP, MVP, Flawless,
-- Zerator-5%-Pluschie-Wurf), zusaetzlich am Ende JE GEWINNENDEM
-- TEILNEHMER ein UNABHAENGIGER 1%-Wurf auf den Zerathor-Dorf-Skin - nur
-- bei echtem Sieg (p_result = 'won') und nur wenn noch nicht besessen.
-- Die aeussere "nur einmal pro Raid"-Sperre (update ... where status =
-- 'fighting') bleibt unveraendert die einzige Instanz - der Skin-Wurf
-- erbt diese Einmaligkeit automatisch mit.
-- ============================================================
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

      -- Zerator-Pluschie: 5% Chance, nur wenn noch nicht im Besitz.
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

      -- Zerathor-Dorf-Skin: unabhaengiger 1%-Wurf, nur wenn noch nicht im
      -- Besitz - direkter Insert statt Einloese-Code, siehe Kommentar oben.
      select exists(
        select 1 from public.idle_player_village_skins
        where auth_user_id = rec.auth_user_id and skin_id = 'zerathordorf'
      ) into v_owns_zerathordorf;

      if not v_owns_zerathordorf and random() < 0.01 then
        insert into public.idle_player_village_skins (name_key, auth_user_id, skin_id)
        values (lower(trim(rec.display_name)), rec.auth_user_id, 'zerathordorf')
        on conflict (auth_user_id, skin_id) do nothing;
      end if;
    end loop;
  end if;
end;
$$;
grant execute on function public.raid_finish(text, text) to authenticated;
