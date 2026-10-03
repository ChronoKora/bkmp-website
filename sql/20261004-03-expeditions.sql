-- ============================================================
-- Drachendorf-Ausbau Phase 3 (04.10.2026): Drachen-Expeditionen
--   * Katalog: Regionen, Missionen, Ereignisse (oeffentlich lesbar,
--     datengetrieben - neue Regionen/Missionen = neue Zeilen)
--   * player_expeditions: laufende/abgeholte Expeditionen pro Spieler
--   * expedition_start / expedition_claim / expedition_status
--   * Schutz: ein Drache auf Expedition kann nicht freigelassen,
--     geopfert oder als Begleiter eingesetzt werden
--
-- Voraussetzung: 20261004-01-drachendorf-grundlage.sql (Affinitaeten,
-- Bindung) und 20261004-02-village-projects.sql (Drachenhafen).
-- NOCH NICHT AUSGEFUEHRT. Idempotent, rein additiv.
--
-- Ergebnis-Prinzip: Qualitaet, Ereignisse und Belohnung werden beim START
-- serverseitig bestimmt und gespeichert (Seed = Expeditions-ID), beim
-- Abholen nur noch einmalig gutgeschrieben. Kein Totalausfall: jede
-- Expedition hat eine Grundbelohnung (Stufe 1 = "Erfolgreich").
-- Die Teambewertung entspricht 1:1 js/systems/bkmp-expedition-rules.js
-- (Vorschau im Spiel + lokale Testumgebung).
-- ============================================================

-- ---------- 1) Katalog ----------
create table if not exists public.expedition_regions (
  id text primary key,
  name text not null,
  icon text not null default '',
  description text not null default '',
  min_harbor_level integer not null default 1,
  rune_tier smallint not null default 0,
  egg_tier smallint not null default 0,
  sort_order integer not null default 0
);

create table if not exists public.expedition_missions (
  id text primary key,
  region_id text not null references public.expedition_regions(id),
  name text not null,
  description text not null default '',
  duration_hours integer not null check (duration_hours in (1, 4, 8)),
  team_size integer not null check (team_size between 1 and 3),
  requirements jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  rewards jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists public.expedition_events (
  id text primary key,
  name text not null,
  icon text not null default '',
  description text not null default '',
  base_chance numeric not null default 0,
  affinity_bonus jsonb not null default '{}'::jsonb,
  trait_bonus jsonb not null default '{}'::jsonb,
  reward jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0
);

alter table public.expedition_regions enable row level security;
alter table public.expedition_missions enable row level security;
alter table public.expedition_events enable row level security;
drop policy if exists expedition_regions_read on public.expedition_regions;
create policy expedition_regions_read on public.expedition_regions for select using (true);
drop policy if exists expedition_missions_read on public.expedition_missions;
create policy expedition_missions_read on public.expedition_missions for select using (true);
drop policy if exists expedition_events_read on public.expedition_events;
create policy expedition_events_read on public.expedition_events for select using (true);
grant select on public.expedition_regions, public.expedition_missions, public.expedition_events to anon, authenticated;

insert into public.expedition_regions (id, name, icon, description, min_harbor_level, rune_tier, egg_tier, sort_order) values
  ('fluesterwald',   'Flüsterwald',           '🌲', 'Ein uralter Wald voller Holz, wilder Früchte und vergessener Pfade.', 1, 0, 1, 1),
  ('glutberge',      'Glutberge',             '🌋', 'Glühende Hänge mit Goldadern, Kristallhöhlen und Essenzquellen.', 1, 0, 1, 2),
  ('frostklamm',     'Frostklamm',            '❄️', 'Eisige Schluchten, in denen Kristalle und alte Runen schlummern.', 2, 1, 1, 3),
  ('endriss',        'Endriss',               '🌌', 'Ein Riss im Himmel. Wer zurückkehrt, bringt seltene Runen und Eier mit.', 2, 2, 2, 4),
  ('verbotenes_tal', 'Verbotenes Drachental', '🐲', 'Die Heimat der ältesten Drachen. Nur der große Hafen kennt den Weg.', 3, 3, 3, 5)
on conflict (id) do update set name = excluded.name, icon = excluded.icon, description = excluded.description,
  min_harbor_level = excluded.min_harbor_level, rune_tier = excluded.rune_tier, egg_tier = excluded.egg_tier, sort_order = excluded.sort_order;

insert into public.expedition_missions (id, region_id, name, description, duration_hours, team_size, requirements, recommendations, rewards, sort_order) values
  ('fw_waldrand', 'fluesterwald', 'Holz am Waldrand', 'Ein ruhiger Flug zum Waldrand - ideal für einen einzelnen Drachen.', 1, 1,
   '{}', '[{"type":"affinity","value":"erde"},{"type":"affinity","value":"wind"}]',
   '{"gold_units":20,"wood":100,"fruit":60,"bond_xp":10}', 1),
  ('fw_beerenpfad', 'fluesterwald', 'Der Beerenpfad', 'Zwei Drachen sammeln Beeren und Holz entlang der alten Pfade.', 4, 2,
   '{"distinct_species_min":2}', '[{"type":"affinity","value":"wind"},{"type":"trait","value":"sammler"}]',
   '{"gold_units":70,"wood":350,"fruit":250,"bond_xp":30}', 2),
  ('fw_tiefer_wald', 'fluesterwald', 'Tief im Flüsterwald', 'Eine lange Reise ins Herz des Waldes. Erfahrene Standarddrachen kennen den Weg.', 8, 3,
   '{"rarity_min":{"standard":1}}', '[{"type":"affinity","value":"erde"},{"type":"distinct_affinities","value":3}]',
   '{"gold_units":140,"wood":700,"fruit":450,"egg_chance":0.05,"bond_xp":50}', 3),
  ('gb_lavafelder', 'glutberge', 'Lavafelder', 'Ein Feuerdrache sucht in den Lavafeldern nach Gold und Essenz.', 1, 1,
   '{"affinity_min":{"feuer":1}}', '[{"type":"trait","value":"schatzsucher"}]',
   '{"gold_units":25,"essence":5,"bond_xp":10}', 4),
  ('gb_kristallhoehle', 'glutberge', 'Kristallhöhlen', 'Zwei Drachen verschiedener Elemente erkunden die Höhlen.', 4, 2,
   '{"distinct_affinities_min":2}', '[{"type":"affinity","value":"feuer"},{"type":"affinity","value":"erde"}]',
   '{"gold_units":70,"crystals":22,"stone":350,"bond_xp":30}', 5),
  ('gb_glutkern', 'glutberge', 'Der Glutkern', 'Bis zum glühenden Kern des Berges - höchstens ein legendärer Drache darf mit.', 8, 3,
   '{"affinity_min":{"feuer":1},"rarity_max":{"legendaer":1}}', '[{"type":"affinity_count","value":"feuer","count":2},{"type":"trait","value":"mutig"}]',
   '{"gold_units":150,"essence":40,"crystals":30,"bond_xp":50}', 6),
  ('fk_eisgrat', 'frostklamm', 'Eisgrat', 'Ein kurzer Erkundungsflug über den Eisgrat.', 1, 1,
   '{}', '[{"type":"affinity","value":"wasser"},{"type":"affinity","value":"wind"}]',
   '{"crystals":8,"stone":100,"bond_xp":10}', 7),
  ('fk_frostwaechter', 'frostklamm', 'Die Frostwächter', 'Alte Eiswächter bewachen vergessene Runen.', 4, 2,
   '{"affinity_min":{"wasser":1}}', '[{"type":"distinct_affinities","value":2},{"type":"trait","value":"forscher"}]',
   '{"gold_units":50,"crystals":32,"rune_chance":0.25,"bond_xp":30}', 8),
  ('fk_gletscherherz', 'frostklamm', 'Gletscherherz', 'Drei verschiedene Drachen suchen das Herz des Gletschers.', 8, 3,
   '{"distinct_species_min":3}', '[{"type":"affinity","value":"wasser"},{"type":"affinity","value":"wind"},{"type":"affinity","value":"licht"}]',
   '{"crystals":70,"essence":20,"rune_chance":0.75,"bond_xp":50}', 9),
  ('er_leuchtfeuer', 'endriss', 'Leuchtfeuer am Rand', 'Ein Drache hält Wache am Rand des Risses.', 1, 1,
   '{}', '[{"type":"affinity","value":"licht"}]',
   '{"essence":8,"crystals":8,"bond_xp":10}', 10),
  ('er_sternenstaub', 'endriss', 'Sternenstaub', 'Zwei Drachen sammeln Sternenstaub zwischen den Welten.', 4, 2,
   '{"distinct_affinities_min":2}', '[{"type":"affinity","value":"arkan"},{"type":"affinity","value":"dunkel"}]',
   '{"essence":32,"crystals":32,"rune_chance":0.35,"bond_xp":30}', 11),
  ('er_himmelsriss', 'endriss', 'Durch den Himmelsriss', 'Eine gefährliche Reise durch den Riss. Ein vielfältiges Team kehrt mit Schätzen zurück.', 8, 3,
   '{"distinct_affinities_min":3}', '[{"type":"affinity","value":"licht"},{"type":"affinity","value":"dunkel"},{"type":"rarity","value":"episch"}]',
   '{"gold_units":100,"essence":60,"crystals":60,"rune_chance":0.75,"egg_chance":0.10,"bond_xp":50}', 12),
  ('vt_waechterflug', 'verbotenes_tal', 'Wächterflug', 'Ein Drache patrouilliert an der Grenze des Tals.', 1, 1,
   '{}', '[{"type":"rarity","value":"legendaer"}]',
   '{"gold_units":40,"crystals":12,"essence":10,"bond_xp":10}', 13),
  ('vt_ahnenschrein', 'verbotenes_tal', 'Schrein der Ahnen', 'Zwei eng verbundene Drachen besuchen den Schrein der Ahnen.', 4, 2,
   '{}', '[{"type":"affinity","value":"arkan"},{"type":"bond","value":4}]',
   '{"gold_units":110,"essence":50,"crystals":45,"rune_chance":0.4,"bond_xp":30}', 14),
  ('vt_drachenhort', 'verbotenes_tal', 'Der Drachenhort', 'Der legendäre Hort. Nur ein Team aus drei verschiedenen Arten und Elementen findet ihn.', 8, 3,
   '{"distinct_species_min":3,"distinct_affinities_min":3}', '[{"type":"affinity","value":"licht"},{"type":"affinity","value":"dunkel"},{"type":"bond","value":6}]',
   '{"gold_units":260,"crystals":110,"essence":90,"rune_chance":1,"egg_chance":0.15,"bond_xp":50}', 15)
on conflict (id) do update set region_id = excluded.region_id, name = excluded.name, description = excluded.description,
  duration_hours = excluded.duration_hours, team_size = excluded.team_size, requirements = excluded.requirements,
  recommendations = excluded.recommendations, rewards = excluded.rewards, sort_order = excluded.sort_order;

insert into public.expedition_events (id, name, icon, description, base_chance, affinity_bonus, trait_bonus, reward, sort_order) values
  ('schatztruhe',         'Alte Schatztruhe',    '💰', 'Unter Wurzeln vergraben lag eine alte Truhe voller Gold.', 0.12, '{"erde":0.03}', '{"schatzsucher":0.10}', '{"gold_units":60}', 1),
  ('kristallader',        'Kristallader',        '💎', 'Eine frei liegende Kristallader glitzerte im Fels.', 0.10, '{"erde":0.03,"arkan":0.02}', '{"schatzsucher":0.06}', '{"crystals":20}', 2),
  ('verlassene_ruine',    'Verlassene Ruine',    '🏚️', 'In einer verfallenen Ruine lag eine vergessene Rune.', 0.07, '{"arkan":0.03}', '{"forscher":0.06}', '{"runes":1}', 3),
  ('alter_schrein',       'Alter Schrein',       '⛩️', 'Ein alter Schrein schenkte dem Team leuchtende Essenz.', 0.08, '{"licht":0.04}', '{"forscher":0.04}', '{"essence":18}', 4),
  ('unbekannte_hoehle',   'Unbekannte Höhle',    '🕳️', 'Eine unentdeckte Höhle voller Stein und Holzreste.', 0.10, '{"dunkel":0.03,"erde":0.02}', '{"entdecker":0.04}', '{"stone":250,"wood":150}', 5),
  ('verlorene_lieferung', 'Verlorene Lieferung', '📦', 'Eine verlorene Händlerlieferung mit Futter für die Nester.', 0.10, '{"wind":0.03}', '{"sammler":0.08}', '{"fruit":150,"meat":150}', 6),
  ('wandernder_haendler', 'Wandernder Händler',  '🧳', 'Ein wandernder Händler bezahlte für Begleitschutz.', 0.07, '{}', '{"gierig":0.06}', '{"gold_units":40,"crystals":8}', 7),
  ('verletzter_drache',   'Verletzter Drache',   '🩹', 'Das Team half einem verletzten wilden Drachen - das schweißt zusammen.', 0.06, '{"licht":0.04,"wasser":0.02}', '{"heiler":0.10}', '{"bond_xp":60,"essence":8}', 8),
  ('geheimnisvolles_ei',  'Geheimnisvolles Ei',  '🥚', 'In einem verlassenen Nest lag ein geheimnisvolles Ei.', 0.03, '{"arkan":0.01}', '{"entdecker":0.02}', '{"eggs":1}', 9)
on conflict (id) do update set name = excluded.name, icon = excluded.icon, description = excluded.description,
  base_chance = excluded.base_chance, affinity_bonus = excluded.affinity_bonus, trait_bonus = excluded.trait_bonus,
  reward = excluded.reward, sort_order = excluded.sort_order;

-- ---------- 2) Spielerdaten ----------
create table if not exists public.player_expeditions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  name_key text not null default '',
  mission_id text not null,
  region_id text not null,
  dragon_ids uuid[] not null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'running' check (status in ('running', 'claimed')),
  quality smallint not null default 1,
  quality_score integer not null default 0,
  events jsonb not null default '[]'::jsonb,
  rewards jsonb not null default '{}'::jsonb,
  claimed_at timestamptz
);
create index if not exists player_expeditions_owner_idx on public.player_expeditions (auth_user_id, status);
alter table public.player_expeditions enable row level security;
drop policy if exists player_expeditions_own_read on public.player_expeditions;
create policy player_expeditions_own_read on public.player_expeditions for select using (auth.uid() = auth_user_id);
revoke all on public.player_expeditions from anon, authenticated;
grant select on public.player_expeditions to authenticated;

-- ---------- 3) Hilfsfunktionen ----------
-- Bindungsstufe 1-10 aus Bindungspunkten (gleiche Schwellen wie
-- BKMP_DRAGON_BOND_THRESHOLDS in js/systems/bkmp-expedition-rules.js).
create or replace function public.dragon_bond_level(p_xp integer)
returns integer language sql immutable as $$
  select case
    when coalesce(p_xp, 0) >= 7500 then 10 when p_xp >= 5200 then 9 when p_xp >= 3600 then 8
    when p_xp >= 2400 then 7 when p_xp >= 1500 then 6 when p_xp >= 900 then 5
    when p_xp >= 500 then 4 when p_xp >= 250 then 3 when p_xp >= 100 then 2 else 1 end;
$$;

-- Bewertet ein Team fuer eine Mission. Liefert die nicht erfuellten
-- Pflichtbedingungen und die erfuellten Empfehlungen sowie den festen Teil
-- der Punktzahl (ohne Zufall). Team: jsonb-Array aus
-- {species_id, rarity, affinities[], trait, bond_level}.
create or replace function public.expedition_team_eval(p_mission public.expedition_missions, p_team jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v_req jsonb := coalesce(p_mission.requirements, '{}'::jsonb);
  v_recs jsonb := coalesce(p_mission.recommendations, '[]'::jsonb);
  v_unmet jsonb := '[]'::jsonb;
  v_met jsonb := '[]'::jsonb;
  v_key text;
  v_val jsonb;
  v_n integer;
  v_rec jsonb;
  v_ok boolean;
  v_distinct_aff integer;
  v_distinct_species integer;
  v_distinct_rarity integer;
  v_avg_bond numeric;
  v_score integer;
begin
  select count(distinct a) into v_distinct_aff from jsonb_array_elements(p_team) m, jsonb_array_elements_text(coalesce(m->'affinities', '[]'::jsonb)) a;
  select count(distinct m->>'species_id'), count(distinct m->>'rarity'), coalesce(avg(coalesce((m->>'bond_level')::numeric, 1)), 1)
    into v_distinct_species, v_distinct_rarity, v_avg_bond from jsonb_array_elements(p_team) m;

  -- Pflichtbedingungen
  if v_req ? 'affinity_min' then
    for v_key, v_val in select * from jsonb_each(v_req->'affinity_min') loop
      select count(*) into v_n from jsonb_array_elements(p_team) m where coalesce(m->'affinities', '[]'::jsonb) ? v_key;
      if v_n < (v_val)::text::integer then v_unmet := v_unmet || jsonb_build_array('affinity_min:' || v_key); end if;
    end loop;
  end if;
  if v_req ? 'distinct_affinities_min' and v_distinct_aff < (v_req->>'distinct_affinities_min')::integer then
    v_unmet := v_unmet || jsonb_build_array('distinct_affinities_min');
  end if;
  if v_req ? 'distinct_species_min' and v_distinct_species < (v_req->>'distinct_species_min')::integer then
    v_unmet := v_unmet || jsonb_build_array('distinct_species_min');
  end if;
  if v_req ? 'rarity_min' then
    for v_key, v_val in select * from jsonb_each(v_req->'rarity_min') loop
      select count(*) into v_n from jsonb_array_elements(p_team) m where m->>'rarity' = v_key;
      if v_n < (v_val)::text::integer then v_unmet := v_unmet || jsonb_build_array('rarity_min:' || v_key); end if;
    end loop;
  end if;
  if v_req ? 'rarity_max' then
    for v_key, v_val in select * from jsonb_each(v_req->'rarity_max') loop
      select count(*) into v_n from jsonb_array_elements(p_team) m where m->>'rarity' = v_key;
      if v_n > (v_val)::text::integer then v_unmet := v_unmet || jsonb_build_array('rarity_max:' || v_key); end if;
    end loop;
  end if;

  -- Empfehlungen
  for v_n in 0 .. jsonb_array_length(v_recs) - 1 loop
    v_rec := v_recs->v_n;
    v_ok := false;
    if v_rec->>'type' = 'affinity' then
      v_ok := exists (select 1 from jsonb_array_elements(p_team) m where coalesce(m->'affinities', '[]'::jsonb) ? (v_rec->>'value'));
    elsif v_rec->>'type' = 'affinity_count' then
      v_ok := (select count(*) from jsonb_array_elements(p_team) m where coalesce(m->'affinities', '[]'::jsonb) ? (v_rec->>'value')) >= coalesce((v_rec->>'count')::integer, 1);
    elsif v_rec->>'type' = 'distinct_affinities' then
      v_ok := v_distinct_aff >= (v_rec->>'value')::integer;
    elsif v_rec->>'type' = 'distinct_species' then
      v_ok := v_distinct_species >= (v_rec->>'value')::integer;
    elsif v_rec->>'type' = 'rarity' then
      v_ok := exists (select 1 from jsonb_array_elements(p_team) m where m->>'rarity' = v_rec->>'value');
    elsif v_rec->>'type' = 'trait' then
      v_ok := exists (select 1 from jsonb_array_elements(p_team) m where m->>'trait' = v_rec->>'value');
    elsif v_rec->>'type' = 'bond' then
      v_ok := v_avg_bond >= (v_rec->>'value')::numeric;
    end if;
    if v_ok then v_met := v_met || jsonb_build_array(v_n); end if;
  end loop;

  v_score := 25 + jsonb_array_length(v_met) * 15 + v_distinct_rarity * 5 + v_distinct_aff * 4 + floor((v_avg_bond - 1) * 2)::integer;
  -- Bindungsmeilenstein 4: +3 je Teammitglied mit Bindung 4+
  v_score := v_score + 3 * (select count(*) from jsonb_array_elements(p_team) m where coalesce((m->>'bond_level')::integer, 1) >= 4)::integer;
  -- Eigenschaften (Phase 4): Mutig (8-Std.-Missionen), Gesellig (Teams), Einzelgaenger (solo)
  if p_mission.duration_hours = 8 then
    v_score := v_score + floor(10 * public.expedition_trait_strength(p_team, 'mutig'))::integer;
  end if;
  if p_mission.team_size >= 2 then
    v_score := v_score + floor(4 * (p_mission.team_size - 1) * public.expedition_trait_strength(p_team, 'gesellig'))::integer;
  end if;
  if p_mission.team_size = 1 then
    v_score := v_score + floor(12 * public.expedition_trait_strength(p_team, 'einzelgaenger'))::integer;
  end if;
  return jsonb_build_object('unmet', v_unmet, 'met', v_met, 'score', v_score);
end;
$$;

create or replace function public.expedition_trait_strength(p_team jsonb, p_trait text)
returns numeric language sql immutable as $
  select coalesce(max(case when coalesce((m->>'bond_level')::integer, 1) >= 8 then 1.5 else 1 end), 0)
    from jsonb_array_elements(coalesce(p_team, '[]'::jsonb)) m where m->>'trait' = p_trait;
$;

create or replace function public.expedition_quality(p_score integer)
returns integer language sql immutable as $$
  select case when p_score >= 95 then 4 when p_score >= 75 then 3 when p_score >= 55 then 2 else 1 end;
$$;
create or replace function public.expedition_quality_mult(p_quality integer)
returns numeric language sql immutable as $$
  select case p_quality when 4 then 2.0 when 3 then 1.6 when 2 then 1.25 else 1.0 end;
$$;

-- ---------- 4) RPC: Expedition starten ----------
create or replace function public.expedition_start(p_mission_id text, p_dragon_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_state public.idle_player_state%rowtype;
  v_mission public.expedition_missions%rowtype;
  v_region public.expedition_regions%rowtype;
  v_harbor integer;
  v_slots integer;
  v_running integer;
  v_team jsonb;
  v_team_count integer;
  v_eval jsonb;
  v_id uuid := gen_random_uuid();
  v_roll integer;
  v_span integer;
  v_score integer;
  v_quality integer;
  v_mult numeric;
  v_unit bigint;
  v_rw jsonb;
  v_events jsonb := '[]'::jsonb;
  v_ev public.expedition_events%rowtype;
  v_chance numeric;
  v_key text;
  v_val jsonb;
  v_gold bigint; v_wood bigint; v_stone bigint; v_crystals bigint; v_essence bigint; v_fruit bigint; v_meat bigint;
  v_runes integer; v_eggs integer; v_bond integer;
  v_frac numeric;
  v_traits text[];
  v_affs text[];
  v_ends timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_state from public.idle_player_state ips where ips.auth_user_id = v_uid for update;
  if not found then raise exception 'no_player_state'; end if;

  select * into v_mission from public.expedition_missions em where em.id = p_mission_id and em.active;
  if not found then raise exception 'invalid_mission'; end if;
  select * into v_region from public.expedition_regions er where er.id = v_mission.region_id;

  v_harbor := public.village_building_level(v_uid, 'drachenhafen');
  if v_harbor < 1 then raise exception 'harbor_not_built'; end if;
  if v_harbor < v_region.min_harbor_level then raise exception 'region_locked'; end if;
  select coalesce((vbl.effects->>'expedition_slots')::integer, v_harbor) into v_slots
    from public.village_building_levels vbl where vbl.building_id = 'drachenhafen' and vbl.level = v_harbor;
  v_slots := coalesce(v_slots, v_harbor);
  select count(*) into v_running from public.player_expeditions pe where pe.auth_user_id = v_uid and pe.status = 'running';
  if v_running >= v_slots then raise exception 'no_free_slot'; end if;

  if p_dragon_ids is null or coalesce(array_length(p_dragon_ids, 1), 0) <> v_mission.team_size then raise exception 'wrong_team_size'; end if;
  if (select count(distinct x) from unnest(p_dragon_ids) x) <> v_mission.team_size then raise exception 'duplicate_dragon'; end if;

  -- Drachen sperren, damit parallele Starts sie nicht doppelt verwenden.
  perform 1 from public.player_dragons pd where pd.id = any(p_dragon_ids) for update;
  select count(*) into v_team_count from public.player_dragons pd
   where pd.id = any(p_dragon_ids) and pd.auth_user_id = v_uid and pd.stage in ('adult', 'divine') and not pd.is_companion;
  if v_team_count <> v_mission.team_size then raise exception 'dragon_not_available'; end if;
  if exists (select 1 from public.player_expeditions pe where pe.auth_user_id = v_uid and pe.status = 'running' and pe.dragon_ids && p_dragon_ids) then
    raise exception 'dragon_on_expedition';
  end if;

  select jsonb_agg(jsonb_build_object('species_id', ds.id, 'rarity', ds.rarity,
           'affinities', to_jsonb(coalesce(ds.affinities, '{}'::text[])), 'trait', pd.trait,
           'bond_level', public.dragon_bond_level(pd.bond_xp))),
         array_agg(distinct pd.trait) filter (where pd.trait is not null)
    into v_team, v_traits
    from public.player_dragons pd join public.dragon_species ds on ds.id = pd.species_id
   where pd.id = any(p_dragon_ids);
  select array_agg(distinct a) into v_affs
    from public.player_dragons pd join public.dragon_species ds on ds.id = pd.species_id, unnest(coalesce(ds.affinities, '{}'::text[])) a
   where pd.id = any(p_dragon_ids);

  v_eval := public.expedition_team_eval(v_mission, v_team);
  if jsonb_array_length(v_eval->'unmet') > 0 then raise exception 'requirements_not_met'; end if;

  v_span := 21 + case when public.expedition_trait_strength(v_team, 'glueckskind') > 1 then 8
                      when public.expedition_trait_strength(v_team, 'glueckskind') > 0 then 5 else 0 end;
  v_roll := (public.village_seed_int(v_id::text || ':quality') % v_span)::integer;
  v_roll := greatest(v_roll, case when public.expedition_trait_strength(v_team, 'beschuetzer') > 1 then 12
                                  when public.expedition_trait_strength(v_team, 'beschuetzer') > 0 then 8 else 0 end);
  v_score := (v_eval->>'score')::integer + v_roll;
  v_quality := public.expedition_quality(v_score);
  v_mult := public.expedition_quality_mult(v_quality);
  v_unit := public.village_gold_unit(v_state.highest_dragon_index);
  v_rw := v_mission.rewards;

  -- Eigenschaften: Gierig (Gold), Sammler (Material/Futter), Schatzsucher
  -- (Kristalle), Forscher (Essenz + Runenchance), Heiler (Bindung)
  v_gold := round(coalesce((v_rw->>'gold_units')::numeric, 0) * v_unit * v_mult * (1 + 0.15 * public.expedition_trait_strength(v_team, 'gierig')));
  v_wood := round(coalesce((v_rw->>'wood')::numeric, 0) * v_mult * (1 + 0.15 * public.expedition_trait_strength(v_team, 'sammler')));
  v_stone := round(coalesce((v_rw->>'stone')::numeric, 0) * v_mult * (1 + 0.15 * public.expedition_trait_strength(v_team, 'sammler')));
  v_crystals := round(coalesce((v_rw->>'crystals')::numeric, 0) * v_mult * (1 + 0.10 * public.expedition_trait_strength(v_team, 'schatzsucher')));
  v_essence := round(coalesce((v_rw->>'essence')::numeric, 0) * v_mult * (1 + 0.10 * public.expedition_trait_strength(v_team, 'forscher')));
  v_fruit := round(coalesce((v_rw->>'fruit')::numeric, 0) * v_mult * (1 + 0.15 * public.expedition_trait_strength(v_team, 'sammler')));
  v_meat := round(coalesce((v_rw->>'meat')::numeric, 0) * v_mult * (1 + 0.15 * public.expedition_trait_strength(v_team, 'sammler')));
  v_bond := round(coalesce((v_rw->>'bond_xp')::numeric, 0) * (1 + 0.25 * public.expedition_trait_strength(v_team, 'heiler')));
  -- Runen/Eier: ganze Anteile sicher, Rest als Chance (deterministisch).
  v_frac := coalesce((v_rw->>'rune_chance')::numeric, 0) * (1 + 0.15 * public.expedition_trait_strength(v_team, 'forscher'));
  v_runes := floor(v_frac)::integer
    + case when (public.village_seed_int(v_id::text || ':rune') % 10000) < round((v_frac - floor(v_frac)) * 10000) then 1 else 0 end;
  v_frac := coalesce((v_rw->>'egg_chance')::numeric, 0);
  v_eggs := floor(v_frac)::integer
    + case when (public.village_seed_int(v_id::text || ':egg') % 10000) < round((v_frac - floor(v_frac)) * 10000) then 1 else 0 end;

  -- Ereignisse (hoechstens 2)
  for v_ev in select * from public.expedition_events ee order by ee.sort_order, ee.id loop
    exit when jsonb_array_length(v_events) >= 2;
    v_chance := v_ev.base_chance + (v_quality - 1) * 0.015 + 0.03 * public.expedition_trait_strength(v_team, 'entdecker');
    for v_key, v_val in select * from jsonb_each(v_ev.affinity_bonus) loop
      if v_affs is not null and v_key = any(v_affs) then v_chance := v_chance + (v_val)::text::numeric; end if;
    end loop;
    for v_key, v_val in select * from jsonb_each(v_ev.trait_bonus) loop
      if v_traits is not null and v_key = any(v_traits) then v_chance := v_chance + (v_val)::text::numeric; end if;
    end loop;
    if (public.village_seed_int(v_id::text || ':ev:' || v_ev.id) % 10000) < round(v_chance * 10000) then
      v_events := v_events || jsonb_build_array(jsonb_build_object('id', v_ev.id, 'name', v_ev.name, 'icon', v_ev.icon, 'description', v_ev.description));
      v_gold := v_gold + round(coalesce((v_ev.reward->>'gold_units')::numeric, 0) * v_unit);
      v_wood := v_wood + coalesce((v_ev.reward->>'wood')::bigint, 0);
      v_stone := v_stone + coalesce((v_ev.reward->>'stone')::bigint, 0);
      v_crystals := v_crystals + coalesce((v_ev.reward->>'crystals')::bigint, 0);
      v_essence := v_essence + coalesce((v_ev.reward->>'essence')::bigint, 0);
      v_fruit := v_fruit + coalesce((v_ev.reward->>'fruit')::bigint, 0);
      v_meat := v_meat + coalesce((v_ev.reward->>'meat')::bigint, 0);
      v_runes := v_runes + coalesce((v_ev.reward->>'runes')::integer, 0);
      v_eggs := v_eggs + coalesce((v_ev.reward->>'eggs')::integer, 0);
      v_bond := v_bond + coalesce((v_ev.reward->>'bond_xp')::integer, 0);
    end if;
  end loop;

  v_ends := now() + make_interval(hours => v_mission.duration_hours);
  insert into public.player_expeditions (id, auth_user_id, name_key, mission_id, region_id, dragon_ids, started_at, ends_at,
    status, quality, quality_score, events, rewards)
  values (v_id, v_uid, v_state.name_key, v_mission.id, v_mission.region_id, p_dragon_ids, now(), v_ends, 'running',
    v_quality, v_score, v_events,
    jsonb_build_object('gold', v_gold, 'wood', v_wood, 'stone', v_stone, 'crystals', v_crystals, 'essence', v_essence,
      'fruit', v_fruit, 'meat', v_meat, 'runes', v_runes, 'eggs', v_eggs, 'bond_xp', v_bond,
      'rune_tier', v_region.rune_tier, 'egg_tier', v_region.egg_tier));

  -- Belohnung und Ereignisse bleiben bis zum Abholen verborgen.
  return jsonb_build_object('id', v_id, 'mission_id', v_mission.id, 'region_id', v_mission.region_id,
    'dragon_ids', to_jsonb(p_dragon_ids), 'started_at', now(), 'ends_at', v_ends, 'status', 'running');
end;
$$;

-- ---------- 5) RPC: Expedition abholen (atomar, idempotent) ----------
create or replace function public.expedition_claim(p_expedition_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_exp public.player_expeditions%rowtype;
  v_state public.idle_player_state%rowtype;
  v_rw jsonb;
  v_fruit bigint; v_meat bigint;
  v_fruit_cap bigint; v_meat_cap bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_exp from public.player_expeditions pe where pe.id = p_expedition_id and pe.auth_user_id = v_uid for update;
  if not found then raise exception 'invalid_expedition'; end if;
  if v_exp.status = 'claimed' then
    return jsonb_build_object('id', v_exp.id, 'newly_claimed', false, 'quality', v_exp.quality, 'events', v_exp.events, 'rewards', v_exp.rewards);
  end if;
  if v_exp.ends_at > now() then raise exception 'not_finished'; end if;

  select * into v_state from public.idle_player_state ips where ips.auth_user_id = v_uid for update;
  if not found then raise exception 'no_player_state'; end if;
  v_rw := v_exp.rewards;
  -- Futter respektiert den Lagerdeckel (2000 + Stufe*500), Ueberschuss verfaellt.
  v_fruit_cap := 2000 + coalesce(v_state.obstgarten_level, 0) * 500;
  v_meat_cap := 2000 + coalesce(v_state.jagdhuette_level, 0) * 500;
  v_fruit := greatest(0, least(coalesce((v_rw->>'fruit')::bigint, 0), v_fruit_cap - coalesce(v_state.fruit, 0)));
  v_meat := greatest(0, least(coalesce((v_rw->>'meat')::bigint, 0), v_meat_cap - coalesce(v_state.meat, 0)));

  update public.idle_player_state ips set
    gold = ips.gold + coalesce((v_rw->>'gold')::bigint, 0),
    total_gold_earned = ips.total_gold_earned + coalesce((v_rw->>'gold')::bigint, 0),
    wood = ips.wood + coalesce((v_rw->>'wood')::bigint, 0),
    stone = ips.stone + coalesce((v_rw->>'stone')::bigint, 0),
    crystals = ips.crystals + coalesce((v_rw->>'crystals')::bigint, 0),
    essence = ips.essence + coalesce((v_rw->>'essence')::bigint, 0),
    fruit = coalesce(ips.fruit, 0) + v_fruit,
    meat = coalesce(ips.meat, 0) + v_meat
  where ips.auth_user_id = v_uid;

  perform set_config('bkmp.trusted', 'on', true);
  update public.player_dragons pd set
    expeditions_completed = pd.expeditions_completed + 1,
    bond_xp = pd.bond_xp + coalesce((v_rw->>'bond_xp')::integer, 0)
  where pd.id = any(v_exp.dragon_ids) and pd.auth_user_id = v_uid;
  perform set_config('bkmp.trusted', 'off', true);

  v_rw := v_rw || jsonb_build_object('fruit', v_fruit, 'meat', v_meat);
  update public.player_expeditions pe set status = 'claimed', claimed_at = now(), rewards = v_rw where pe.id = v_exp.id;

  return jsonb_build_object('id', v_exp.id, 'newly_claimed', true, 'quality', v_exp.quality, 'events', v_exp.events, 'rewards', v_rw);
end;
$$;

-- ---------- 6) RPC: Status (Plaetze + laufende Expeditionen) ----------
create or replace function public.expedition_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_harbor integer;
  v_slots integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_harbor := public.village_building_level(v_uid, 'drachenhafen');
  select coalesce((vbl.effects->>'expedition_slots')::integer, v_harbor) into v_slots
    from public.village_building_levels vbl where vbl.building_id = 'drachenhafen' and vbl.level = v_harbor;
  return jsonb_build_object(
    'harbor_level', v_harbor,
    'slots', coalesce(v_slots, v_harbor),
    'server_now', now(),
    'expeditions', coalesce((
      select jsonb_agg(jsonb_build_object('id', pe.id, 'mission_id', pe.mission_id, 'region_id', pe.region_id,
               'dragon_ids', to_jsonb(pe.dragon_ids), 'started_at', pe.started_at, 'ends_at', pe.ends_at, 'status', pe.status)
             order by pe.started_at)
        from public.player_expeditions pe where pe.auth_user_id = v_uid and pe.status = 'running'), '[]'::jsonb));
end;
$$;

-- ---------- 7) Schutz: Drache auf Expedition ----------
create or replace function public.player_dragons_guard_expedition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    if exists (select 1 from public.player_expeditions pe where pe.status = 'running' and OLD.id = any(pe.dragon_ids)) then
      raise exception 'dragon_on_expedition';
    end if;
    return OLD;
  end if;
  if NEW.is_companion and not OLD.is_companion
     and exists (select 1 from public.player_expeditions pe where pe.status = 'running' and OLD.id = any(pe.dragon_ids)) then
    raise exception 'dragon_on_expedition';
  end if;
  return NEW;
end;
$$;
drop trigger if exists player_dragons_guard_expedition_trg on public.player_dragons;
create trigger player_dragons_guard_expedition_trg
  before update or delete on public.player_dragons
  for each row execute function public.player_dragons_guard_expedition();

revoke all on function public.expedition_start(text, uuid[]) from public, anon;
revoke all on function public.expedition_claim(uuid) from public, anon;
revoke all on function public.expedition_status() from public, anon;
grant execute on function public.expedition_start(text, uuid[]) to authenticated;
grant execute on function public.expedition_claim(uuid) to authenticated;
grant execute on function public.expedition_status() to authenticated;

notify pgrst, 'reload schema';
