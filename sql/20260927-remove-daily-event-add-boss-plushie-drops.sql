/* ============================================================
   Bkmp - Daily Code Event entfernt, Plüshie-Beute stattdessen ueber
   Weltboss-Raid + Gildenboss (Nutzerwunsch 27.09.2026, im Rahmen des
   Vercel-Traffic-Audits vom selben Tag: /api/active-daily-event.js war
   der mit Abstand groesste Treiber der Function-Invocations, siehe
   CHANGELOG.md).

   WARUM: der bisherige Client-Poll (alle 10s, jeder offene Tab einzeln,
   Cache-Control:no-store aus Fairness-Gruenden - kuenftige Events duerfen
   nie vorab sichtbar sein) verursacht ~91% der Vercel-Function-
   Invocations dieses Projekts. Raid-Boss/Gildenboss brauchen dagegen
   KEIN Polling fuer ihre Belohnungen: raid_finish()/guild_boss_finish()
   vergeben Beute bereits jetzt einmalig, rein serverseitig, exakt beim
   Boss-Kill (kein Client-Request noetig) - das ist strukturell der
   Grund, warum diese Verlagerung ueberhaupt Kosten spart, nicht nur eine
   kosmetische Umbenennung.

   NEUE SPIELREGEL (Nutzer-Vorgabe): 22 der bisherigen 26 Plüshies
   (alle AUSSER den 4 fest exklusiv woanders erhaeltlichen: kora,
   zerathor_zorn_der_verdammnis, randomauto, jakecrayson - siehe
   Kommentar in api/generate-daily-events.js, das mit dieser Migration
   entfernt wird) fallen jetzt mit 5% Chance PRO SIEGENDEM TEILNEHMER
   sowohl beim Weltboss-Raid als auch beim Gildenboss, unabhaengig
   voneinander UND unabhaengig vom bereits bestehenden Zerathor-5%-Wurf
   beim Raid (der bleibt exklusiv Zerathor, unveraendert). Der Pool wird
   bewusst DYNAMISCH aus der plushies-Tabelle gelesen (nicht als feste
   ID-Liste hartcodiert) - neue, spaeter hinzugefuegte Plüshies
   landen dadurch automatisch im Pool, ohne dass diese Migration erneut
   angefasst werden muss (identisches Prinzip wie das alte, jetzt
   entfernte api/generate-daily-events.js es bereits handhabte).

   WICHTIGER BUGFIX ALS VORAUSSETZUNG: raid_reward_codes hatte bisher
   "unique (raid_id, name_key)" - erlaubte also nur GENAU EINEN
   Belohnungscode pro Spieler pro Raid. Mit zwei unabhaengigen 5%-Wuerfen
   (Zerathor + generisch) koennte ein Spieler theoretisch BEIDE im
   selben Raid gewinnen (0,25% Chance) - der zweite Insert waere bisher
   durch "on conflict ... do nothing" STILLSCHWEIGEND verloren gegangen,
   der Spieler haette einen echten Gewinn nie zu sehen bekommen. Fix:
   Constraint auf (raid_id, name_key, plushie_id) erweitert (per
   dynamischem DO-Block, unabhaengig vom tatsaechlichen, automatisch von
   Postgres vergebenen Constraint-Namen - sicher wiederholt ausfuehrbar).

   Was NICHT geloescht wird (bewusst, siehe CHANGELOG.md fuer die volle
   Begruendung): die Tabelle daily_code_events (Historie/Rollback-
   Sicherheit, hat ohnehin nie eine oeffentliche Lese-Policy gehabt -
   kein Sicherheitsrisiko, sie bleibt einfach ungenutzt liegen), sowie
   die bereits erspielten "daily_event_1/5/15"-Erfolge und
   "lucky_one/gluecksritter/der_erste/der_schnellste/golden_hour_win/
   goldjaeger"-Titel/Erfolge im Client - Spieler, die diese frueher
   bereits gewonnen haben, behalten ihr Abzeichen, koennen es ab jetzt
   aber nicht mehr NEU erspielen (uebliches "befristetes Event,
   Bestandsgewinner behalten ihren Titel"-Prinzip).

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt
   ausfuehren. Sicher mehrfach ausfuehrbar (idempotent).
   ============================================================ */

-- ============================================================
-- 1) raid_reward_codes: Unique-Constraint erweitern (siehe Begruendung
--    oben) - findet den tatsaechlichen, automatisch vergebenen
--    Constraint-Namen dynamisch, statt ihn zu erraten.
-- ============================================================
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.raid_reward_codes'::regclass
    and contype = 'u';
  if v_conname is not null and v_conname <> 'raid_reward_codes_raid_name_plushie_key' then
    execute format('alter table public.raid_reward_codes drop constraint %I', v_conname);
    alter table public.raid_reward_codes
      add constraint raid_reward_codes_raid_name_plushie_key unique (raid_id, name_key, plushie_id);
  elsif v_conname is null then
    alter table public.raid_reward_codes
      add constraint raid_reward_codes_raid_name_plushie_key unique (raid_id, name_key, plushie_id);
  end if;
end $$;

-- ============================================================
-- 2) guild_boss_reward_codes (neu): identisches Muster wie
--    raid_reward_codes, aber FK auf guild_boss_instances statt
--    raid_instances (guild_boss_instances.id ist text, kein FK-Konflikt
--    zur bereits bestehenden Tabelle noetig/moeglich).
-- ============================================================
create table if not exists public.guild_boss_reward_codes (
  id uuid primary key default gen_random_uuid(),
  instance_id text not null references public.guild_boss_instances(id) on delete cascade,
  name_key text not null,
  display_name text not null,
  plushie_id text not null,
  code text not null,
  created_at timestamptz not null default now(),
  unique (instance_id, name_key, plushie_id)
);

create index if not exists guild_boss_reward_codes_instance_idx on public.guild_boss_reward_codes (instance_id);
create index if not exists guild_boss_reward_codes_name_idx on public.guild_boss_reward_codes (name_key);

alter table public.guild_boss_reward_codes enable row level security;
grant select on public.guild_boss_reward_codes to anon, authenticated;

drop policy if exists "Public read guild boss reward codes" on public.guild_boss_reward_codes;
create policy "Public read guild boss reward codes" on public.guild_boss_reward_codes
  for select to anon, authenticated using (true);
-- Keine Schreib-Policy - nur guild_boss_finish() (security definer) legt Zeilen an.

-- ============================================================
-- 3) raid_finish() neu definieren: 1:1 identisch zur bisherigen Logik
--    (Gold/Kristalle/XP, MVP, Flawless, bestehender Zerathor-5%-Wurf
--    UNVERAENDERT), zusaetzlich am Ende JE GEWINNENDEM TEILNEHMER ein
--    ZWEITER, unabhaengiger 5%-Wurf auf ein zufaelliges Plüshie aus
--    dem generischen Pool (dynamisch aus plushies gelesen, abzueglich
--    der 4 exklusiven IDs UND abzueglich dessen, was der Spieler schon
--    besitzt). Faellt der Pool leer aus (Spieler besitzt bereits alle
--    22), wird einfach nichts vergeben - kein Ersatz-Bonus, exakt wie
--    beim bestehenden Zerathor-Wurf, wenn er schon besessen wird.
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
  v_generic_plushie_id text;
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

      -- Zerator-Pluschie: 5% Chance, nur wenn noch nicht im Besitz. (UNVERAENDERT)
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
          on conflict (raid_id, name_key, plushie_id) do nothing;
        end if;
      end if;

      -- NEU (27.09.2026): generisches Pluschie, 5% Chance, zufaellig aus
      -- allen NICHT-exklusiven Pluschies, die dieser Spieler noch nicht
      -- besitzt - unabhaengig vom Zerator-Wurf oben.
      if random() < 0.05 then
        select p.id into v_generic_plushie_id
        from public.plushies p
        where p.id not in ('kora', 'zerathor_zorn_der_verdammnis', 'randomauto', 'jakecrayson')
          and not exists (
            select 1 from public.user_plushies up
            where up.name_key = lower(trim(rec.display_name)) and up.plushie_id = p.id
          )
        order by random()
        limit 1;

        if v_generic_plushie_id is not null then
          v_code := null;
          for v_attempt in 1..5 loop
            begin
              v_code := 'RAID-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
              insert into public.plushie_codes (code, plushie_id, note, created_by_admin)
              values (v_code, v_generic_plushie_id, 'Automatische 5%-Raidboss-Belohnung (generischer Pool) fuer ' || rec.display_name || ' (Raid ' || p_raid_id || ').', 'system');
              exit;
            exception when unique_violation then
              v_code := null;
            end;
          end loop;

          if v_code is not null then
            insert into public.raid_reward_codes (raid_id, name_key, display_name, plushie_id, code)
            values (p_raid_id, lower(trim(rec.display_name)), rec.display_name, v_generic_plushie_id, v_code)
            on conflict (raid_id, name_key, plushie_id) do nothing;
          end if;
        end if;
      end if;
    end loop;
  end if;
end;
$$;
grant execute on function public.raid_finish(text, text) to authenticated;

-- ============================================================
-- 4) guild_boss_finish() neu definieren: 1:1 identisch zur bisherigen
--    Gold/Kristall-Logik (Schadensanteil, UNVERAENDERT), zusaetzlich
--    derselbe generische 5%-Pluschie-Wurf wie beim Raid oben, nur in
--    guild_boss_reward_codes statt raid_reward_codes.
-- ============================================================
create or replace function public.guild_boss_finish(p_instance_id text, p_result text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guild_id uuid;
  v_total_damage bigint;
  v_gold_pool bigint;
  v_gem_pool bigint;
  v_rec record;
  v_share numeric;
  v_code text;
  v_attempt int;
  v_generic_plushie_id text;
begin
  update public.guild_boss_instances set status = p_result, ended_at = now()
  where id = p_instance_id and status = 'fighting';
  if not found then return; end if;

  select guild_id, total_damage into v_guild_id, v_total_damage from public.guild_boss_instances where id = p_instance_id;

  if p_result = 'won' then
    select gb.gold_reward, gb.gem_reward into v_gold_pool, v_gem_pool
    from public.guild_bosses gb join public.guild_boss_instances gbi on gbi.boss_id = gb.id
    where gbi.id = p_instance_id;

    update public.guilds set bosses_defeated = bosses_defeated + 1 where id = v_guild_id;
    insert into public.guild_activity_log (guild_id, kind) values (v_guild_id, 'boss_defeated');

    for v_rec in select * from public.guild_boss_participants where instance_id = p_instance_id and damage_dealt > 0 loop
      v_share := v_rec.damage_dealt::numeric / greatest(1, v_total_damage);
      update public.idle_player_state
      set gold = gold + round(v_gold_pool * v_share), crystals = crystals + round(v_gem_pool * v_share)
      where auth_user_id = v_rec.auth_user_id;

      update public.guild_boss_player_stats
      set total_bosses_defeated = total_bosses_defeated + 1
      where auth_user_id = v_rec.auth_user_id;

      -- NEU (27.09.2026): generisches Pluschie, 5% Chance, identisches
      -- Prinzip wie beim Raid oben - unabhaengig fuer jeden Teilnehmer
      -- mit echtem Schaden.
      if random() < 0.05 then
        select p.id into v_generic_plushie_id
        from public.plushies p
        where p.id not in ('kora', 'zerathor_zorn_der_verdammnis', 'randomauto', 'jakecrayson')
          and not exists (
            select 1 from public.user_plushies up
            where up.name_key = lower(trim(v_rec.display_name)) and up.plushie_id = p.id
          )
        order by random()
        limit 1;

        if v_generic_plushie_id is not null then
          v_code := null;
          for v_attempt in 1..5 loop
            begin
              v_code := 'GILDE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
              insert into public.plushie_codes (code, plushie_id, note, created_by_admin)
              values (v_code, v_generic_plushie_id, 'Automatische 5%-Gildenboss-Belohnung fuer ' || v_rec.display_name || ' (Instanz ' || p_instance_id || ').', 'system');
              exit;
            exception when unique_violation then
              v_code := null;
            end;
          end loop;

          if v_code is not null then
            insert into public.guild_boss_reward_codes (instance_id, name_key, display_name, plushie_id, code)
            values (p_instance_id, lower(trim(v_rec.display_name)), v_rec.display_name, v_generic_plushie_id, v_code)
            on conflict (instance_id, name_key, plushie_id) do nothing;
          end if;
        end if;
      end if;
    end loop;
  end if;
end;
$$;
grant execute on function public.guild_boss_finish(text, text) to authenticated;
