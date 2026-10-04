-- ============================================================
-- Drachendorf-Ausbau Phase 7 (04.10.2026): Special-Event-Framework
--
--   * special_events: konfigurierbare Events (Name, Texte, Zeiten, Pass-
--     Stufen, Quests, Belohnungen, Drachenbelohnung, Claim-Limit, Auswahl-
--     modus, Assets, Archiv). Ein Event ist erst sichtbar, wenn
--     enabled = true UND Zeiten gesetzt sind.
--     Status (berechnet, nie gespeichert):
--       HIDDEN (aus/ohne Zeiten/vor der Ankuendigung) -> COMING_SOON ->
--       LIVE -> ENDED; archived = true -> ARCHIVED.
--   * player_event_progress: Pass-Fortschritt pro Spieler. Eventpunkte
--     sind KEINE Waehrung, nur Pass-Fortschritt.
--   * event_tick(): vom Spiel etwa einmal pro Minute aufgerufen (NIE pro
--     Kill). Fortschritt aus serverseitig gespeicherten Zaehlern:
--     dragon_kills, boss_kills, playtime_seconds (idle_player_state),
--     dungeon_progress.total_keys_spent (Dungeon-Laeufe, serverseitig
--     verbucht), Runen-Aufwertungen, abgeschlossene Expeditionen,
--     Gildenprojekt-Punkte. Nur Turmstufen, Fuetterungen und Welt-
--     ereignisse meldet das Spiel selbst (gedeckelt pro Minute und Tag).
--     Jeder Zuwachs ist auf die echte Zeit seit dem letzten Aufruf
--     begrenzt, Kills zusaetzlich auf die echte Kampfzeit (Offline-Siege
--     zaehlen nicht).
--   * Tagesaufgaben: pro Spieler + Berliner Kalendertag deterministisch
--     (md5), einmal erzeugt und gespeichert - Reload aendert nichts.
--     Wochenquests: mehrstufig, bei der ersten Teilnahme erzeugt.
--     Gesperrte Systeme bekommen Alternativen.
--   * event_claim_tiers(): Stufenbelohnungen genau einmal (Zeilensperre).
--   * event_choose_reward(): Hauptbelohnung waehlen (z.B. Lightnix ODER
--     Darknix) - nur mit EARNED, dauerhaft, lebenslanges Limit pro
--     reward_group, auch nach Eventende moeglich.
--   * special_event_schedule(): Betreiber legt den Event-Montag fest
--     (nur im SQL-Editor ausfuehrbar, siehe Ende der Datei).
--
-- Voraussetzung: 20261004-01 .. 05. NOCH NICHT AUSGEFUEHRT. Idempotent,
-- rein additiv. Die Event-DATEN (z.B. Zwielicht) stehen in eigenen Dateien
-- (20261004-07-zwielicht-event.sql).
-- Logik-Spiegel fuer Tests: tests/mock/rpc-engine.js + js/systems/bkmp-event-rules.js
-- ============================================================

create table if not exists public.special_events (
  id text primary key,
  name text not null,
  subtitle text not null default '',
  description text not null default '',
  lore text not null default '',
  announce_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Europe/Berlin',
  enabled boolean not null default false,
  archived boolean not null default false,
  tier_count integer not null default 30 check (tier_count between 1 and 100),
  points_per_tier integer not null default 100 check (points_per_tier > 0),
  config jsonb not null default '{}'::jsonb,
  reward_group text,
  lifetime_claim_limit integer not null default 1 check (lifetime_claim_limit >= 0),
  choice_mode text not null default 'player_choice' check (choice_mode in ('player_choice', 'none')),
  reward_species text[] not null default '{}'::text[],
  assets jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.special_events enable row level security;
-- Kein direkter Lesezugriff: sichtbar nur ueber special_events_visible()
-- (verhindert, dass ein noch nicht angekuendigtes Event vorab auffaellt).
revoke all on public.special_events from anon, authenticated;

create or replace function public.special_event_status_of(p_enabled boolean, p_archived boolean,
  p_announce timestamptz, p_starts timestamptz, p_ends timestamptz)
returns text language sql stable as $$
  select case
    when not p_enabled then 'HIDDEN'
    when p_starts is null or p_ends is null then 'HIDDEN'
    when p_archived then 'ARCHIVED'
    when now() < coalesce(p_announce, p_starts) then 'HIDDEN'
    when now() < p_starts then 'COMING_SOON'
    when now() < p_ends then 'LIVE'
    else 'ENDED' end;
$$;

create table if not exists public.player_event_progress (
  event_id text not null references public.special_events(id) on delete cascade,
  auth_user_id uuid not null,
  name_key text not null default '',
  points integer not null default 0,
  cumulative jsonb not null default '{}'::jsonb,
  last_metrics jsonb not null default '{}'::jsonb,
  last_tick_at timestamptz,
  kill_scale numeric not null default 1,
  day_key date,
  day_base jsonb not null default '{}'::jsonb,
  day_quests jsonb not null default '[]'::jsonb,
  day_closure_done boolean not null default false,
  day_client jsonb not null default '{}'::jsonb,
  weekly_quests jsonb not null default '[]'::jsonb,
  weekly_done jsonb not null default '{}'::jsonb,
  tier_claimed integer[] not null default '{}'::integer[],
  unlocks text[] not null default '{}'::text[],
  earned boolean not null default false,
  earned_at timestamptz,
  choice_species text,
  chosen_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (event_id, auth_user_id)
);
alter table public.player_event_progress enable row level security;
drop policy if exists player_event_progress_own_read on public.player_event_progress;
create policy player_event_progress_own_read on public.player_event_progress for select using (auth.uid() = auth_user_id);
revoke all on public.player_event_progress from anon, authenticated;
grant select on public.player_event_progress to authenticated;

-- Lebenslanges Claim-Limit pro Belohnungsgruppe (z.B. "zwielicht"): wer
-- einmal Lightnix gewaehlt hat, bekommt bei einer Wiederholung nicht Darknix.
create table if not exists public.player_event_reward_claims (
  reward_group text not null,
  auth_user_id uuid not null,
  event_id text not null,
  species_id text not null,
  egg_id uuid,
  claimed_at timestamptz not null default now(),
  primary key (reward_group, auth_user_id, species_id)
);
alter table public.player_event_reward_claims enable row level security;
drop policy if exists player_event_reward_claims_own_read on public.player_event_reward_claims;
create policy player_event_reward_claims_own_read on public.player_event_reward_claims for select using (auth.uid() = auth_user_id);
revoke all on public.player_event_reward_claims from anon, authenticated;
grant select on public.player_event_reward_claims to authenticated;

-- ---------- Kennzahlen eines Spielers (nur serverseitige Werte) ----------
create or replace function public.event_server_metrics(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ips public.idle_player_state%rowtype;
  v_dungeons bigint := 0;
  v_exp bigint := 0;
  v_guild bigint := 0;
begin
  select * into v_ips from public.idle_player_state ips where ips.auth_user_id = p_uid;
  if not found then return '{}'::jsonb; end if;
  select coalesce(sum(dp.total_keys_spent), 0) into v_dungeons from public.dungeon_progress dp where dp.auth_user_id = p_uid;
  select count(*) into v_exp from public.player_expeditions pe where pe.auth_user_id = p_uid and pe.status = 'claimed';
  select coalesce(sum(c.points), 0) into v_guild from public.guild_project_contributions c where c.auth_user_id = p_uid;
  return jsonb_build_object(
    'kills', coalesce(v_ips.dragon_kills, 0),
    'bosses', coalesce(v_ips.boss_kills, 0),
    'active', floor(coalesce(v_ips.playtime_seconds, 0)),
    'runes', coalesce(v_ips.rune_upgrade_successes, 0) + coalesce(v_ips.rune_upgrade_failures, 0),
    'dungeons', v_dungeons,
    'expeditions', v_exp,
    'guild', v_guild);
end;
$$;

-- Freigeschaltete Systeme (keine Pflicht-Quest fuer gesperrte Systeme).
create or replace function public.event_requirement_ok(p_uid uuid, p_req text)
returns boolean language sql stable security definer set search_path = public as $$
  select case coalesce(p_req, '')
    when '' then true
    when 'runes' then exists (select 1 from public.idle_player_runes r
                               join public.idle_player_state ips on ips.name_key = r.name_key
                              where ips.auth_user_id = p_uid)
    when 'harbor' then exists (select 1 from public.village_buildings vb
                                where vb.auth_user_id = p_uid and vb.building_id = 'drachenhafen' and vb.level >= 1)
                       and exists (select 1 from public.player_dragons pd
                                    where pd.auth_user_id = p_uid and pd.stage in ('adult', 'divine'))
    -- Gilde + diese Woche noch offenes Gildenprojekt (in ein fertiges kann
    -- man nicht mehr einzahlen - dann waere die Aufgabe unerfuellbar).
    when 'guild' then exists (select 1 from public.guild_members gm
                               where gm.auth_user_id = p_uid
                                 and not exists (select 1 from public.guild_projects gp
                                                  where gp.guild_id = gm.guild_id
                                                    and gp.week_start = public.guild_project_week_start()
                                                    and gp.completed_at is not null))
    when 'babies' then exists (select 1 from public.player_dragons pd where pd.auth_user_id = p_uid and pd.stage = 'baby')
    else false end;
$$;

-- Ein Quest-Ziel aus der Konfiguration mit Spielerskalierung.
create or replace function public.event_scaled_target(p_q jsonb, p_scale numeric)
returns numeric language sql immutable as $$
  select greatest(1, round((p_q->>'target')::numeric
    * case when coalesce((p_q->>'scale')::boolean, false) then p_scale else 1 end));
$$;

-- Tagesaufgaben: normal_count normale + 1 schwere, deterministisch aus
-- Event + Spieler + Berliner Kalendertag, nur aus freigeschalteten Systemen.
create or replace function public.event_generate_day(p_event_id text, p_config jsonb, p_uid uuid, p_day date, p_scale numeric)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg jsonb := coalesce(p_config->'daily', '{}'::jsonb);
  v_pool jsonb := '[]'::jsonb;
  v_out jsonb := '[]'::jsonb;
  v_q jsonb;
  v_i integer;
  v_n integer;
  v_pick integer;
begin
  for v_q in select * from jsonb_array_elements(coalesce(v_cfg->'normal', '[]'::jsonb)) loop
    if public.event_requirement_ok(p_uid, v_q->>'requires') then v_pool := v_pool || jsonb_build_array(v_q); end if;
  end loop;
  v_n := least(coalesce((v_cfg->>'normal_count')::integer, 4), jsonb_array_length(v_pool));
  if v_n > 0 then
    for v_i in 0 .. v_n - 1 loop
      v_pick := (public.village_seed_int(p_event_id || ':' || p_uid::text || ':' || p_day::text || ':n' || v_i::text)
                 % jsonb_array_length(v_pool))::integer;
      v_q := v_pool->v_pick;
      v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_q->>'id', 'metric', v_q->>'metric', 'kind', 'normal',
        'target', public.event_scaled_target(v_q, p_scale), 'points', coalesce((v_cfg->>'normal_points')::integer, 40), 'done', false));
      v_pool := v_pool - v_pick;
    end loop;
  end if;
  v_pool := '[]'::jsonb;
  for v_q in select * from jsonb_array_elements(coalesce(v_cfg->'hard', '[]'::jsonb)) loop
    if public.event_requirement_ok(p_uid, v_q->>'requires') then v_pool := v_pool || jsonb_build_array(v_q); end if;
  end loop;
  if jsonb_array_length(v_pool) > 0 then
    v_pick := (public.village_seed_int(p_event_id || ':' || p_uid::text || ':' || p_day::text || ':h')
               % jsonb_array_length(v_pool))::integer;
    v_q := v_pool->v_pick;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_q->>'id', 'metric', v_q->>'metric', 'kind', 'hard',
      'target', public.event_scaled_target(v_q, p_scale), 'points', coalesce((v_cfg->>'hard_points')::integer, 90), 'done', false));
  end if;
  return v_out;
end;
$$;

-- Wochenquests: konfigurierte Liste, gesperrte Systeme durch "alt" ersetzt.
create or replace function public.event_generate_week(p_config jsonb, p_uid uuid, p_scale numeric)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_q jsonb;
  v_alt jsonb;
  v_stages jsonb;
  v_s jsonb;
begin
  for v_q in select * from jsonb_array_elements(coalesce(p_config->'weekly', '[]'::jsonb)) loop
    if not public.event_requirement_ok(p_uid, v_q->>'requires') then
      v_alt := null;
      select a into v_alt from jsonb_array_elements(coalesce(p_config->'weekly_alts', '[]'::jsonb)) a
       where a->>'id' = v_q->>'alt' limit 1;
      continue when v_alt is null;
      v_q := v_alt;
    end if;
    v_stages := '[]'::jsonb;
    for v_s in select * from jsonb_array_elements(v_q->'stages') loop
      v_stages := v_stages || jsonb_build_array(jsonb_build_array(
        public.event_scaled_target(jsonb_build_object('target', v_s->>0, 'scale', coalesce(v_q->>'scale', 'false')), p_scale),
        (v_s->>1)::integer));
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_q->>'id', 'metric', v_q->>'metric', 'stages', v_stages));
  end loop;
  return v_out;
end;
$$;

-- Obergrenzen je Sekunde echter Zeit (Anti-Spam). 'kills'/'bosses' werden
-- zusaetzlich an die echte Kampfzeit gekoppelt (siehe event_tick).
create or replace function public.event_metric_cap(p_metric text, p_elapsed numeric)
returns numeric language sql immutable as $$
  select case p_metric
    when 'kills' then floor(p_elapsed * 3)
    when 'bosses' then floor(p_elapsed / 20) + 1
    when 'active' then floor(p_elapsed)
    when 'runes' then floor(p_elapsed / 2) + 1
    when 'dungeons' then floor(p_elapsed / 30) + 1
    when 'expeditions' then 3
    when 'guild' then 100000
    when 'tower' then floor(p_elapsed / 3) + 1
    when 'feedings' then floor(p_elapsed / 3) + 1
    when 'world_events' then floor(p_elapsed / 120) + 1
    else 0 end;
$$;
-- Tagesdeckel fuer die nur vom Spiel gemeldeten Kennzahlen.
create or replace function public.event_client_day_cap(p_metric text)
returns numeric language sql immutable as $$
  select case p_metric when 'tower' then 130 when 'feedings' then 80 when 'world_events' then 30 else 0 end;
$$;

-- ---------- Haupt-RPC: Fortschritt nachziehen + Stand liefern ----------
-- p_client: Zuwaechse seit dem letzten erfolgreichen Aufruf fuer die
-- Kennzahlen, die nur das Spiel kennt ({tower, feedings, world_events}).
-- Antwort enthaelt client_accepted - das Spiel zieht nur diese Mengen von
-- seinen offenen Zaehlern ab.
create or replace function public.event_tick(p_event_id text, p_client jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.special_events%rowtype;
  v_status text;
  v_row public.player_event_progress%rowtype;
  v_ips public.idle_player_state%rowtype;
  v_now_metrics jsonb;
  v_prev_cum jsonb;
  v_cum jsonb;
  v_elapsed numeric;
  v_active_delta numeric;
  v_key text;
  v_delta numeric;
  v_accept jsonb := '{}'::jsonb;
  v_day date := public.village_berlin_today();
  v_day_client jsonb;
  v_used numeric;
  v_quests jsonb;
  v_q jsonb;
  v_i integer;
  v_done_count integer;
  v_points integer;
  v_week jsonb;
  v_stages_done integer;
  v_s integer;
  v_scale numeric;
  v_kph numeric;
  v_tier integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_event from public.special_events se where se.id = p_event_id;
  if not found then raise exception 'invalid_event'; end if;
  v_status := public.special_event_status_of(v_event.enabled, v_event.archived, v_event.announce_at, v_event.starts_at, v_event.ends_at);
  if v_status = 'HIDDEN' then raise exception 'invalid_event'; end if;

  select * into v_row from public.player_event_progress p
   where p.event_id = p_event_id and p.auth_user_id = v_uid for update;
  if not found then
    if v_status <> 'LIVE' then
      return jsonb_build_object('status', v_status, 'joined', false, 'server_now', now(),
        'already_claimed_group', exists (select 1 from public.player_event_reward_claims c
           where c.reward_group = coalesce(v_event.reward_group, v_event.id) and c.auth_user_id = v_uid));
    end if;
    select * into v_ips from public.idle_player_state ips where ips.auth_user_id = v_uid;
    if not found then raise exception 'no_player_state'; end if;
    -- Spielerskalierung fuer Kill-Ziele: Lebenszeit-Kills pro Kampfstunde
    -- gegen 3.000 (Median aktiver Langzeitspieler), sanft gedeckelt.
    v_kph := coalesce(v_ips.dragon_kills, 0)::numeric / greatest(coalesce(v_ips.playtime_seconds, 0)::numeric / 3600, 1);
    v_scale := greatest(0.6, least(1.6, round(v_kph / 3000, 2)));
    insert into public.player_event_progress (event_id, auth_user_id, name_key, last_metrics, last_tick_at, kill_scale, weekly_quests)
    values (p_event_id, v_uid, v_ips.name_key, public.event_server_metrics(v_uid), now(), v_scale,
            public.event_generate_week(v_event.config, v_uid, v_scale))
    on conflict (event_id, auth_user_id) do nothing;
    select * into v_row from public.player_event_progress p
     where p.event_id = p_event_id and p.auth_user_id = v_uid for update;
  end if;

  if v_status = 'LIVE' then
    v_elapsed := least(600, greatest(0, extract(epoch from (now() - coalesce(v_row.last_tick_at, now())))));
    v_now_metrics := public.event_server_metrics(v_uid);
    v_prev_cum := coalesce(v_row.cumulative, '{}'::jsonb);
    v_cum := v_prev_cum;

    -- Echte Kampfzeit zuerst (Kills/Bosse duerfen nur aus ihr entstehen).
    v_active_delta := greatest(0, least(
      coalesce((v_now_metrics->>'active')::numeric, 0) - coalesce((v_row.last_metrics->>'active')::numeric, (v_now_metrics->>'active')::numeric),
      public.event_metric_cap('active', v_elapsed)));
    for v_key in select jsonb_object_keys(v_now_metrics) loop
      v_delta := coalesce((v_now_metrics->>v_key)::numeric, 0)
               - coalesce((v_row.last_metrics->>v_key)::numeric, (v_now_metrics->>v_key)::numeric);
      v_delta := greatest(0, least(v_delta, public.event_metric_cap(v_key, v_elapsed)));
      if v_key = 'active' then v_delta := v_active_delta; end if;
      if v_key = 'kills' then v_delta := least(v_delta, floor(v_active_delta * 3)); end if;
      if v_key = 'bosses' then v_delta := least(v_delta, floor(v_active_delta / 20) + case when v_active_delta > 0 then 1 else 0 end); end if;
      v_cum := jsonb_set(v_cum, array[v_key], to_jsonb(coalesce((v_cum->>v_key)::numeric, 0) + v_delta));
    end loop;

    -- Neuer Berliner Tag -> neue Tagesaufgaben. Basis = Stand VOR diesem
    -- Aufruf, damit der Zuwachs rund um Mitternacht dem neuen Tag zaehlt.
    if v_row.day_key is distinct from v_day then
      v_row.day_key := v_day;
      v_row.day_base := v_prev_cum;
      v_row.day_quests := public.event_generate_day(v_event.id, v_event.config, v_uid, v_day, v_row.kill_scale);
      v_row.day_closure_done := false;
      v_row.day_client := '{}'::jsonb;
    end if;

    -- Vom Spiel gemeldete Kennzahlen: je Minute + je Tag gedeckelt.
    v_day_client := coalesce(v_row.day_client, '{}'::jsonb);
    for v_key in select unnest(array['tower', 'feedings', 'world_events']) loop
      v_used := coalesce((v_day_client->>v_key)::numeric, 0);
      v_delta := greatest(0, least(
        floor(coalesce((p_client->>v_key)::numeric, 0)),
        public.event_metric_cap(v_key, v_elapsed),
        public.event_client_day_cap(v_key) - v_used));
      v_accept := jsonb_set(v_accept, array[v_key], to_jsonb(v_delta));
      v_day_client := jsonb_set(v_day_client, array[v_key], to_jsonb(v_used + v_delta));
      v_cum := jsonb_set(v_cum, array[v_key], to_jsonb(coalesce((v_cum->>v_key)::numeric, 0) + v_delta));
    end loop;

    v_points := v_row.points;

    -- Tagesaufgaben
    v_quests := v_row.day_quests;
    v_done_count := 0;
    for v_i in 0 .. jsonb_array_length(v_quests) - 1 loop
      v_q := v_quests->v_i;
      if not coalesce((v_q->>'done')::boolean, false)
         and coalesce((v_cum->>(v_q->>'metric'))::numeric, 0) - coalesce((v_row.day_base->>(v_q->>'metric'))::numeric, 0)
             >= (v_q->>'target')::numeric then
        v_quests := jsonb_set(v_quests, array[v_i::text, 'done'], 'true'::jsonb);
        v_points := v_points + (v_q->>'points')::integer;
      end if;
      if coalesce((v_quests->v_i->>'done')::boolean, false) then v_done_count := v_done_count + 1; end if;
    end loop;
    if not v_row.day_closure_done
       and v_done_count >= coalesce((v_event.config->'daily'->'closure'->>'need')::integer, 4) then
      v_row.day_closure_done := true;
      v_points := v_points + coalesce((v_event.config->'daily'->'closure'->>'points')::integer, 100);
    end if;

    -- Wochenquests (mehrstufig, Fortschritt seit der ersten Teilnahme)
    v_week := coalesce(v_row.weekly_done, '{}'::jsonb);
    for v_q in select * from jsonb_array_elements(v_row.weekly_quests) loop
      v_stages_done := coalesce((v_week->>(v_q->>'id'))::integer, 0);
      if v_stages_done < jsonb_array_length(v_q->'stages') then
        for v_s in v_stages_done .. jsonb_array_length(v_q->'stages') - 1 loop
          exit when coalesce((v_cum->>(v_q->>'metric'))::numeric, 0) < (v_q->'stages'->v_s->>0)::numeric;
          v_points := v_points + (v_q->'stages'->v_s->>1)::integer;
          v_stages_done := v_s + 1;
        end loop;
      end if;
      v_week := jsonb_set(v_week, array[v_q->>'id'], to_jsonb(v_stages_done));
    end loop;

    v_tier := least(v_event.tier_count, floor(v_points / v_event.points_per_tier)::integer);
    update public.player_event_progress p set
      points = v_points, cumulative = v_cum, last_metrics = v_now_metrics, last_tick_at = now(),
      day_key = v_row.day_key, day_base = v_row.day_base, day_quests = v_quests,
      day_closure_done = v_row.day_closure_done, day_client = v_day_client,
      weekly_done = v_week,
      earned = p.earned or v_tier >= v_event.tier_count,
      earned_at = case when not p.earned and v_tier >= v_event.tier_count then now() else p.earned_at end,
      updated_at = now()
    where p.event_id = p_event_id and p.auth_user_id = v_uid;
    select * into v_row from public.player_event_progress p where p.event_id = p_event_id and p.auth_user_id = v_uid;
  end if;

  return jsonb_build_object(
    'status', v_status, 'joined', true,
    'points', v_row.points,
    'tier', least(v_event.tier_count, floor(v_row.points / v_event.points_per_tier)::integer),
    'cumulative', v_row.cumulative,
    'kill_scale', v_row.kill_scale,
    'day_key', v_row.day_key, 'day_base', v_row.day_base, 'day_quests', v_row.day_quests,
    'day_closure_done', v_row.day_closure_done,
    'weekly_quests', v_row.weekly_quests, 'weekly_done', v_row.weekly_done,
    'tier_claimed', to_jsonb(v_row.tier_claimed), 'unlocks', to_jsonb(v_row.unlocks),
    'earned', v_row.earned, 'earned_at', v_row.earned_at,
    'choice_species', v_row.choice_species, 'chosen_at', v_row.chosen_at,
    'already_claimed_group', exists (select 1 from public.player_event_reward_claims c
       where c.reward_group = coalesce(v_event.reward_group, v_event.id) and c.auth_user_id = v_uid),
    'client_accepted', v_accept,
    'server_now', now());
end;
$$;

-- ---------- Stufenbelohnungen (alle erreichten, noch nicht abgeholten) ----------
-- Ressourcen schreibt der Server direkt gut (ohne updated_at - das Anti-
-- Cheat-Zeitbudget bleibt intakt); Runen/Eier/Booster/Freischaltungen
-- kommen als Liste zurueck und werden vom Spiel ueber die bestehenden
-- Wege verbucht (wie bei Dungeon-Funden).
create or replace function public.event_claim_tiers(p_event_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.special_events%rowtype;
  v_status text;
  v_row public.player_event_progress%rowtype;
  v_state public.idle_player_state%rowtype;
  v_tier integer;
  v_t integer;
  v_rw jsonb;
  v_items jsonb := '[]'::jsonb;
  v_unit numeric;
  v_gold bigint := 0; v_wood bigint := 0; v_stone bigint := 0; v_crystals bigint := 0; v_essence bigint := 0;
  v_fruit bigint := 0; v_meat bigint := 0;
  v_unlocks text[];
  v_claimed integer[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_event from public.special_events se where se.id = p_event_id;
  if not found then raise exception 'invalid_event'; end if;
  v_status := public.special_event_status_of(v_event.enabled, v_event.archived, v_event.announce_at, v_event.starts_at, v_event.ends_at);
  if v_status = 'HIDDEN' then raise exception 'invalid_event'; end if;
  select * into v_row from public.player_event_progress p where p.event_id = p_event_id and p.auth_user_id = v_uid for update;
  if not found then raise exception 'not_joined'; end if;
  select * into v_state from public.idle_player_state ips where ips.auth_user_id = v_uid for update;
  if not found then raise exception 'no_player_state'; end if;
  v_unit := public.village_gold_unit(v_state.highest_dragon_index);
  v_tier := least(v_event.tier_count, floor(v_row.points / v_event.points_per_tier)::integer);
  v_unlocks := v_row.unlocks;
  v_claimed := v_row.tier_claimed;
  for v_t in 1 .. v_tier loop
    continue when v_t = any(v_claimed);
    v_claimed := array_append(v_claimed, v_t);
    v_rw := null;
    select t->'reward' into v_rw from jsonb_array_elements(coalesce(v_event.config->'tiers', '[]'::jsonb)) t
     where (t->>'tier')::integer = v_t limit 1;
    continue when v_rw is null;
    v_gold := v_gold + round(coalesce((v_rw->>'gold_units')::numeric, 0) * v_unit);
    v_wood := v_wood + coalesce((v_rw->>'wood')::bigint, 0);
    v_stone := v_stone + coalesce((v_rw->>'stone')::bigint, 0);
    v_crystals := v_crystals + coalesce((v_rw->>'crystals')::bigint, 0);
    v_essence := v_essence + coalesce((v_rw->>'essence')::bigint, 0);
    v_fruit := v_fruit + coalesce((v_rw->>'fruit')::bigint, 0);
    v_meat := v_meat + coalesce((v_rw->>'meat')::bigint, 0);
    if v_rw ? 'unlock' and not ((v_rw->>'unlock') = any(v_unlocks)) then v_unlocks := array_append(v_unlocks, v_rw->>'unlock'); end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('tier', v_t, 'reward', v_rw));
  end loop;
  -- Futter respektiert den Lagerdeckel (wie Handelsposten/Expeditionen).
  v_fruit := greatest(0, least(v_fruit, 2000 + coalesce(v_state.obstgarten_level, 0) * 500 - coalesce(v_state.fruit, 0)));
  v_meat := greatest(0, least(v_meat, 2000 + coalesce(v_state.jagdhuette_level, 0) * 500 - coalesce(v_state.meat, 0)));
  if v_gold + v_wood + v_stone + v_crystals + v_essence + v_fruit + v_meat > 0 then
    update public.idle_player_state ips set
      gold = ips.gold + v_gold, total_gold_earned = ips.total_gold_earned + v_gold,
      wood = ips.wood + v_wood, stone = ips.stone + v_stone,
      crystals = ips.crystals + v_crystals, essence = ips.essence + v_essence,
      fruit = coalesce(ips.fruit, 0) + v_fruit, meat = coalesce(ips.meat, 0) + v_meat
    where ips.auth_user_id = v_uid;
  end if;
  update public.player_event_progress p set tier_claimed = v_claimed, unlocks = v_unlocks, updated_at = now()
   where p.event_id = p_event_id and p.auth_user_id = v_uid;
  return jsonb_build_object('items', v_items, 'unlocks', to_jsonb(v_unlocks),
    'credited', jsonb_build_object('gold', v_gold, 'wood', v_wood, 'stone', v_stone, 'crystals', v_crystals,
      'essence', v_essence, 'fruit', v_fruit, 'meat', v_meat));
end;
$$;

-- ---------- Hauptbelohnung waehlen (dauerhaft, legt das Ei serverseitig an) ----------
create or replace function public.event_choose_reward(p_event_id text, p_species_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_event public.special_events%rowtype;
  v_status text;
  v_row public.player_event_progress%rowtype;
  v_state public.idle_player_state%rowtype;
  v_group text;
  v_claims integer;
  v_egg uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_event from public.special_events se where se.id = p_event_id;
  if not found then raise exception 'invalid_event'; end if;
  v_status := public.special_event_status_of(v_event.enabled, v_event.archived, v_event.announce_at, v_event.starts_at, v_event.ends_at);
  if v_status = 'HIDDEN' then raise exception 'invalid_event'; end if;
  if v_event.choice_mode <> 'player_choice' or not (p_species_id = any(v_event.reward_species)) then
    raise exception 'invalid_choice';
  end if;
  v_group := coalesce(v_event.reward_group, v_event.id);
  perform pg_advisory_xact_lock(hashtext('event-claim:' || v_group || ':' || v_uid::text));
  select * into v_row from public.player_event_progress p where p.event_id = p_event_id and p.auth_user_id = v_uid for update;
  if not found or not v_row.earned then raise exception 'not_earned'; end if;
  if v_row.choice_species is not null then raise exception 'already_chosen'; end if;
  select count(*) into v_claims from public.player_event_reward_claims c where c.reward_group = v_group and c.auth_user_id = v_uid;
  if v_claims >= v_event.lifetime_claim_limit then raise exception 'claim_limit_reached'; end if;
  select * into v_state from public.idle_player_state ips where ips.auth_user_id = v_uid;
  if not found then raise exception 'no_player_state'; end if;
  if not exists (select 1 from public.dragon_species ds where ds.id = p_species_id) then raise exception 'invalid_choice'; end if;

  perform set_config('bkmp.trusted', 'on', true);
  insert into public.player_dragon_eggs (name_key, auth_user_id, species_id)
  values (v_state.name_key, v_uid, p_species_id) returning id into v_egg;
  perform set_config('bkmp.trusted', 'off', true);
  insert into public.player_event_reward_claims (reward_group, auth_user_id, event_id, species_id, egg_id)
  values (v_group, v_uid, p_event_id, p_species_id, v_egg);
  update public.player_event_progress p set choice_species = p_species_id, chosen_at = now(), updated_at = now()
   where p.event_id = p_event_id and p.auth_user_id = v_uid;
  return jsonb_build_object('species_id', p_species_id, 'egg_id', v_egg);
end;
$$;

-- ---------- Sichtbare Events (Teaser, Website, Archiv) - ohne Login ----------
create or replace function public.special_events_visible()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', se.id, 'name', se.name, 'subtitle', se.subtitle, 'description', se.description, 'lore', se.lore,
      'announce_at', se.announce_at, 'starts_at', se.starts_at, 'ends_at', se.ends_at, 'timezone', se.timezone,
      'status', public.special_event_status_of(se.enabled, se.archived, se.announce_at, se.starts_at, se.ends_at),
      'tier_count', se.tier_count, 'points_per_tier', se.points_per_tier, 'config', se.config,
      'reward_group', coalesce(se.reward_group, se.id), 'reward_species', to_jsonb(se.reward_species), 'assets', se.assets,
      'lifetime_claim_limit', se.lifetime_claim_limit, 'choice_mode', se.choice_mode, 'server_now', now())
      order by se.starts_at), '[]'::jsonb)
    from public.special_events se
   where public.special_event_status_of(se.enabled, se.archived, se.announce_at, se.starts_at, se.ends_at) <> 'HIDDEN';
$$;

-- ---------- Betreiber: Event-Montag festlegen ----------
-- Nur im Supabase-SQL-Editor ausfuehrbar (kein Spieler-Zugriff). Beispiel:
--   select public.special_event_schedule('zwielicht', '2026-10-19', 3);
-- -> Ankuendigung Fr 16.10. 00:00, Start Mo 19.10. 00:00, Ende So 25.10. 23:59
--    (jeweils Europe/Berlin), Event wird eingeschaltet.
-- Ausschalten: update public.special_events set enabled = false where id = 'zwielicht';
-- Archivieren (nur noch Rueckblick): update public.special_events set archived = true where id = 'zwielicht';
create or replace function public.special_event_schedule(p_event_id text, p_monday date, p_teaser_days integer default 3)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row public.special_events%rowtype;
begin
  if extract(isodow from p_monday) <> 1 then raise exception 'not_a_monday'; end if;
  update public.special_events se set
    announce_at = ((p_monday - greatest(0, p_teaser_days))::timestamp at time zone se.timezone),
    starts_at = (p_monday::timestamp at time zone se.timezone),
    ends_at = (((p_monday + 7)::timestamp - interval '1 minute') at time zone se.timezone),
    enabled = true, archived = false
  where se.id = p_event_id
  returning * into v_row;
  if not found then raise exception 'invalid_event'; end if;
  return jsonb_build_object('id', v_row.id, 'announce_at', v_row.announce_at, 'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at);
end;
$$;

revoke all on function public.special_event_schedule(text, date, integer) from public, anon, authenticated;
revoke all on function public.event_server_metrics(uuid) from public, anon, authenticated;
revoke all on function public.event_requirement_ok(uuid, text) from public, anon, authenticated;
revoke all on function public.event_generate_day(text, jsonb, uuid, date, numeric) from public, anon, authenticated;
revoke all on function public.event_generate_week(jsonb, uuid, numeric) from public, anon, authenticated;
revoke all on function public.event_tick(text, jsonb) from public, anon;
revoke all on function public.event_claim_tiers(text) from public, anon;
revoke all on function public.event_choose_reward(text, text) from public, anon;
grant execute on function public.event_tick(text, jsonb) to authenticated;
grant execute on function public.event_claim_tiers(text) to authenticated;
grant execute on function public.event_choose_reward(text, text) to authenticated;
grant execute on function public.special_events_visible() to anon, authenticated;

notify pgrst, 'reload schema';
