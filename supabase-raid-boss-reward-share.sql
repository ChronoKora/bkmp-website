/* ============================================================
   Weltboss-Raid: Belohnung angehoben + Gewinnbeteiligung nach Schaden
   (Spieler-Vorgabe 18.07.: "Gerne die Raidboss belohnung anheben. Und
   gerne eine Gewinnbeteilgung vom Damage dort einbauen. (Vorher jeder
   das Gleiche) Jetzt jeder unterschiedlich. (prinzip Gildenboss)").

   Bisher bekam JEDER Teilnehmer bei einem Sieg den vollen, pauschalen
   Belohnungsbetrag (siehe raid_finish() in
   supabase-dungeon-system-v2-egg-removal.sql, zuletzt aktive Fassung) -
   unabhaengig davon, ob er 1 oder 100.000 Schaden beigetragen hat.
   Diese Datei aendert das Prinzip exakt auf das des Gildenboss
   (supabase-guild-boss.sql, guild_boss_finish()): der Belohnungs-Pool
   wird EINMAL festgelegt und dann proportional zum eigenen
   Schadensanteil (eigener Schaden / Gesamtschaden des Raids) an jeden
   Teilnehmer verteilt.

   Neu: raid_bosses bekommt zusaetzlich Holz-/Stein-/Essenz-Belohnung
   (bisher gab es dort nur Gold/Edelstein/XP) - "Diamanten" ist im
   restlichen Spiel durchgehend nur die Umgangssprache fuer die
   bestehende crystals-Ressource (💎, siehe z.B. die Opfergabe-Texte in
   idledorf.js), keine neue Ressource.

   Neue Belohnungs-Summen (Pool, wird jetzt AUFGETEILT statt an jeden
   einzeln komplett ausgezahlt): 1.500.000 Gold, 150.000 XP, 1.000
   Diamanten/Kristalle, 50.000 Holz, 50.000 Stein, 2.000 Essenz.

   Alles andere in raid_finish() (MVP-/Flawless-Statistik, 5%-Zerator-
   Pluschie, 1%-Zerathordorf-Skin, 1%/1%-Goldrausch/Wissensschub-
   Booster) bleibt bewusst UNVERAENDERT und weiterhin fuer JEDEN
   Teilnehmer unabhaengig vom Schaden - das sind Teilnahme-Belohnungen,
   keine Beute-Aufteilung, die Vorgabe bezog sich ausdruecklich nur auf
   "die Belohnung" (den Ressourcen-Pool).

   Muss NACH supabase-dungeon-system-v2-egg-removal.sql ausgefuehrt
   werden (uebernimmt deren raid_finish()-Fassung als Basis). Idempotent:
   create or replace + "add column if not exists", sichere mehrfache
   Ausfuehrung. Supabase Dashboard > SQL Editor > New query > diesen
   Inhalt ausfuehren.
   ============================================================ */

alter table public.raid_bosses add column if not exists wood_reward bigint not null default 0;
alter table public.raid_bosses add column if not exists stone_reward bigint not null default 0;
alter table public.raid_bosses add column if not exists essence_reward bigint not null default 0;

update public.raid_bosses
set gold_reward = 1500000,
    xp_reward = 150000,
    gem_reward = 1000,
    wood_reward = 50000,
    stone_reward = 50000,
    essence_reward = 2000;

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
  v_total_damage bigint;
  v_share numeric;
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

  select ri.city_hp, ri.city_max_hp, ri.total_damage into v_city_hp, v_city_max_hp, v_total_damage
  from public.raid_instances ri where ri.id = p_raid_id;
  v_flawless := (v_city_max_hp > 0 and v_city_hp >= v_city_max_hp);

  select auth_user_id into v_mvp_uid
  from public.raid_participants where raid_id = p_raid_id order by damage_dealt desc limit 1;

  if p_result = 'won' then
    select rb.gold_reward, rb.gem_reward, rb.xp_reward, rb.wood_reward, rb.stone_reward, rb.essence_reward
    into v_boss_reward
    from public.raid_instances ri join public.raid_bosses rb on rb.id = ri.boss_id
    where ri.id = p_raid_id;

    for rec in select * from public.raid_participants where raid_id = p_raid_id loop
      -- Gewinnbeteiligung nach Schadensanteil, exakt wie guild_boss_finish()
      -- (supabase-guild-boss.sql) - eigener Schaden / Gesamtschaden des Raids.
      -- 0 Schaden -> 0 Anteil -> 0 Beute (Rundung), Teilnahme-Belohnungen
      -- unten (Statistik/Pluschie/Skin/Booster) bleiben davon unberuehrt.
      v_share := rec.damage_dealt::numeric / greatest(1, v_total_damage);

      update public.idle_player_state
      set gold = gold + round(v_boss_reward.gold_reward * v_share),
          total_gold_earned = total_gold_earned + round(v_boss_reward.gold_reward * v_share),
          crystals = crystals + round(v_boss_reward.gem_reward * v_share),
          xp = xp + round(v_boss_reward.xp_reward * v_share),
          wood = wood + round(v_boss_reward.wood_reward * v_share),
          stone = stone + round(v_boss_reward.stone_reward * v_share),
          essence = essence + round(v_boss_reward.essence_reward * v_share)
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
