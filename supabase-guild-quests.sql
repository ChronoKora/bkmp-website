/* ============================================================
   Gildensystem-Erweiterung, Phase F: Tägliche Gildenquests
   (Spieler-Wunsch: "Jeden Tag werden automatisch mehrere Aufgaben
   generiert... Alle Mitglieder arbeiten gemeinsam... Nach Abschluss
   erhalten alle aktiven Mitglieder Belohnungen").

   3 Quests/Tag, zufaellig aus 4 Typen gewaehlt (dragon_kills,
   gold_earned, arena_wins, prestige_ups), Fortschritt = Summe aller
   Mitgliedsbeitraege AN DIESEM TAG (nicht Lebenszeit). Lazy erzeugt
   beim ersten Aufruf des Tages - gleiches Prinzip wie beim
   Weltboss-Raid (kein Cron noetig).

   "Alle aktiven Mitglieder" wird hier bewusst vereinfacht als "alle
   AKTUELLEN Mitglieder der Gilde im Moment des Abschlusses" ausgelegt -
   ein serverseitiges "war heute wirklich aktiv"-Tracking pro Mitglied
   waere eine eigene, deutlich groessere Zusatz-Tabelle wert und ist fuer
   den ersten Wurf nicht noetig.

   Belohnungs-Mapping (siehe Design-Entscheidung im Plan): "Runenkiste"
   = 2 zufaellige Runen (blau/lila) direkt gutgeschrieben, "Legendäres
   Ei" = 1 Rune der Gold-Rarität direkt gutgeschrieben, "Prestigepunkte"
   nutzen die bereits echte idle_prestige_state.prestige_points-Spalte.

   Baut auf supabase-guild-extension-foundation.sql,
   supabase-idle-runes.sql und supabase-idle-prestige.sql auf. Supabase
   Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   idempotent.
   ============================================================ */

create table if not exists public.guild_daily_quests (
  id uuid primary key default gen_random_uuid(),
  guild_id uuid not null references public.guilds(id) on delete cascade,
  quest_date date not null,
  quest_type text not null,
  target bigint not null,
  progress bigint not null default 0,
  tier int not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (guild_id, quest_date, quest_type)
);
create index if not exists guild_daily_quests_guild_date_idx on public.guild_daily_quests (guild_id, quest_date);

alter table public.guild_daily_quests enable row level security;
grant select on public.guild_daily_quests to authenticated;
drop policy if exists "Members read guild quests" on public.guild_daily_quests;
create policy "Members read guild quests" on public.guild_daily_quests for select to authenticated
using (exists (select 1 from public.guild_members gm where gm.guild_id = guild_daily_quests.guild_id and gm.auth_user_id = auth.uid()));
-- Kein direktes insert/update fuer Clients - nur die RPCs unten.

-- ============================================================
-- guild_quest_ensure_today(): lazy Erzeugung, gleiche Idee wie die
-- stundenweise Raid-Instanz - keine Quests existieren, bis sie das
-- erste Mal an diesem Tag abgefragt werden.
-- ============================================================
create or replace function public.guild_quest_ensure_today()
returns table (id uuid, quest_type text, target bigint, progress bigint, tier int, completed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_count int;
  v_types text[] := array['dragon_kills', 'gold_earned', 'arena_wins', 'prestige_ups'];
  v_chosen text[];
  v_tier int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then raise exception 'not_in_guild'; end if;

  select count(*) into v_count from public.guild_daily_quests where guild_id = v_guild_id and quest_date = v_today;
  if v_count = 0 then
    v_chosen := array(select unnest(v_types) order by random() limit 3);
    for v_tier in 1..3 loop
      insert into public.guild_daily_quests (guild_id, quest_date, quest_type, target, tier)
      values (
        v_guild_id, v_today, v_chosen[v_tier],
        case v_chosen[v_tier]
          when 'dragon_kills' then 300 + floor(random() * 500)::bigint
          when 'gold_earned' then 1000000 + floor(random() * 4000000)::bigint
          when 'arena_wins' then 50 + floor(random() * 100)::bigint
          when 'prestige_ups' then 5 + floor(random() * 15)::bigint
        end,
        v_tier
      )
      on conflict (guild_id, quest_date, quest_type) do nothing;
    end loop;
  end if;

  return query
    select gdq.id, gdq.quest_type, gdq.target, gdq.progress, gdq.tier, gdq.completed
    from public.guild_daily_quests gdq
    where gdq.guild_id = v_guild_id and gdq.quest_date = v_today
    order by gdq.tier;
end;
$$;
grant execute on function public.guild_quest_ensure_today() to authenticated;

-- ============================================================
-- guild_quest_contribute(): gebuendelter Fortschritts-Push (Client
-- sammelt Deltas lokal ueber den normalen 4s-Autosave-Rhythmus statt
-- pro einzelnem Drachen-Kill einen RPC-Call zu feuern). p_deltas
-- Beispiel: {"dragon_kills": 5, "gold_earned": 12000}. Bei
-- Zielerreichung: sofortige Belohnung an ALLE aktuellen Mitglieder.
-- ============================================================
create or replace function public.guild_quest_contribute(p_deltas jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_guild_id uuid;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_key text;
  v_delta_text text;
  v_delta bigint;
  v_quest record;
  v_new_progress bigint;
  v_just_completed boolean;
  v_member record;
  v_rune_type text;
  v_rarity text;
  v_rolled numeric;
  v_i int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select guild_id into v_guild_id from public.guild_members where auth_user_id = v_uid;
  if v_guild_id is null then raise exception 'not_in_guild'; end if;

  for v_key, v_delta_text in select key, value from jsonb_each_text(p_deltas) loop
    v_delta := nullif(v_delta_text, '')::bigint;
    if v_delta is null or v_delta <= 0 then continue; end if;

    select * into v_quest from public.guild_daily_quests
    where guild_id = v_guild_id and quest_date = v_today and quest_type = v_key and not completed
    for update;
    if v_quest.id is null then continue; end if;

    v_new_progress := least(v_quest.target, v_quest.progress + v_delta);
    v_just_completed := v_new_progress >= v_quest.target;

    update public.guild_daily_quests
    set progress = v_new_progress, completed = v_just_completed
    where id = v_quest.id;

    if v_just_completed then
      insert into public.guild_activity_log (guild_id, kind, extra) values (v_guild_id, 'quest_completed', v_key);

      for v_member in select auth_user_id, name_key, display_name from public.guild_members where guild_id = v_guild_id loop
        update public.idle_player_state
        set gold = gold + (case v_quest.tier when 1 then 2000 when 2 then 6000 else 15000 end),
            crystals = crystals + (case v_quest.tier when 1 then 20 when 2 then 50 else 100 end)
        where auth_user_id = v_member.auth_user_id;

        if v_quest.tier = 2 then
          for v_i in 1..2 loop
            v_rune_type := 'slot' || (1 + floor(random() * 6))::int;
            v_rarity := (array['blue', 'purple'])[1 + floor(random() * 2)];
            v_rolled := case v_rarity when 'purple' then 6.8 else 4.8 end;
            insert into public.idle_player_runes (name_key, auth_user_id, rune_type, rarity, rolled_value)
            values (v_member.name_key, v_member.auth_user_id, v_rune_type, v_rarity, v_rolled);
          end loop;
        elsif v_quest.tier = 3 then
          v_rune_type := 'slot' || (1 + floor(random() * 6))::int;
          insert into public.idle_player_runes (name_key, auth_user_id, rune_type, rarity, rolled_value)
          values (v_member.name_key, v_member.auth_user_id, v_rune_type, 'gold', 10);

          insert into public.idle_prestige_state (name_key, display_name, prestige_points)
          values (v_member.name_key, v_member.display_name, 10)
          on conflict (name_key) do update set prestige_points = idle_prestige_state.prestige_points + 10;
        end if;
      end loop;
    end if;
  end loop;
end;
$$;
grant execute on function public.guild_quest_contribute(jsonb) to authenticated;
