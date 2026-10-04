-- ============================================================
-- Drachendorf-Ausbau Phase 6 (04.10.2026): Woechentliche Gildenprojekte
--   * Jede Gilde bekommt pro Woche (Mo 00:00 bis So 23:59, Berlin) ein
--     gemeinsames Bauprojekt. Mitglieder zahlen vorhandene Ressourcen ein.
--   * Einzahlungen werden in Projektpunkte umgerechnet:
--       1 Punkt = 20 Goldeinheiten (Gold eines Standarddrachens auf der
--                 eigenen hoechsten Stufe x 20 - fair fuer Anfaenger und
--                 Profis) | 100 Holz | 100 Stein | 5 Kristalle | 5 Essenz
--   * Ziel waechst mit aktiven Mitgliedern (letzte 7 Tage) und Gildenlevel,
--     mit festen Unter-/Obergrenzen.
--   * Belohnung (bescheiden, keine dauerhafte Macht): Kristalle + Essenz,
--     eine Rune (wie Dungeon-Funde vom Spiel ausgewuerfelt) und ein
--     Gildenabzeichen (Zaehler abgeschlossener Projekte). Abholen genau
--     einmal pro Person und Woche, nur wer mindestens 10 Punkte beigetragen hat.
--
-- Voraussetzung: 20261004-02-village-projects.sql (village_gold_unit,
-- village_seed_int, village_berlin_today). NOCH NICHT AUSGEFUEHRT.
-- Idempotent, rein additiv.
-- ============================================================

create table if not exists public.guild_project_defs (
  id text primary key,
  name text not null,
  icon text not null default '',
  description text not null default '',
  resource_kinds text[] not null,
  sort_order integer not null default 0
);
alter table public.guild_project_defs enable row level security;
drop policy if exists guild_project_defs_read on public.guild_project_defs;
create policy guild_project_defs_read on public.guild_project_defs for select using (true);
grant select on public.guild_project_defs to anon, authenticated;

insert into public.guild_project_defs (id, name, icon, description, resource_kinds, sort_order) values
  ('wachturm',       'Großer Wachturm',   '🗼', 'Ein Turm, von dem aus die ganze Gilde die Drachen kommen sieht.', array['gold','stone','wood'], 1),
  ('drachenstall',   'Gemeinsamer Drachenstall', '🐉', 'Ein Stall, in dem sich die Drachen aller Mitglieder ausruhen.', array['wood','essence','gold'], 2),
  ('kristallschmiede','Kristallschmiede', '💎', 'Eine Schmiede, die Kristalle zu Runen verarbeitet.', array['crystals','stone','gold'], 3),
  ('festhalle',      'Festhalle',          '🎉', 'Eine Halle für große Feste nach erfolgreichen Bosskämpfen.', array['gold','wood','essence'], 4),
  ('sternwarte',     'Sternwarte',         '🔭', 'Eine Sternwarte, die neue Wege für Expeditionen findet.', array['crystals','essence','stone'], 5)
on conflict (id) do update set name = excluded.name, icon = excluded.icon, description = excluded.description,
  resource_kinds = excluded.resource_kinds, sort_order = excluded.sort_order;

create table if not exists public.guild_projects (
  guild_id uuid not null references public.guilds(id) on delete cascade,
  week_start date not null,
  def_id text not null references public.guild_project_defs(id),
  target_points integer not null,
  progress_points integer not null default 0,
  completed_at timestamptz,
  primary key (guild_id, week_start)
);
create table if not exists public.guild_project_contributions (
  guild_id uuid not null,
  week_start date not null,
  auth_user_id uuid not null,
  name_key text not null default '',
  display_name text not null default '',
  points integer not null default 0,
  primary key (guild_id, week_start, auth_user_id)
);
create table if not exists public.guild_project_claims (
  guild_id uuid not null,
  week_start date not null,
  auth_user_id uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (guild_id, week_start, auth_user_id)
);
alter table public.guilds add column if not exists projects_completed integer not null default 0;

alter table public.guild_projects enable row level security;
alter table public.guild_project_contributions enable row level security;
alter table public.guild_project_claims enable row level security;
drop policy if exists guild_projects_read on public.guild_projects;
create policy guild_projects_read on public.guild_projects for select using (true);
drop policy if exists guild_project_contributions_read on public.guild_project_contributions;
create policy guild_project_contributions_read on public.guild_project_contributions for select using (true);
drop policy if exists guild_project_claims_own_read on public.guild_project_claims;
create policy guild_project_claims_own_read on public.guild_project_claims for select using (auth.uid() = auth_user_id);
revoke all on public.guild_projects, public.guild_project_contributions, public.guild_project_claims from anon, authenticated;
grant select on public.guild_projects, public.guild_project_contributions to anon, authenticated;
grant select on public.guild_project_claims to authenticated;

-- Montag der aktuellen Woche (Berlin)
create or replace function public.guild_project_week_start()
returns date language sql stable as $$
  select (public.village_berlin_today() - ((extract(isodow from public.village_berlin_today())::integer) - 1))::date;
$$;

-- Ziel: 400 + 250 je aktivem Mitglied + 40 je Gildenlevel, zwischen 600 und 8000.
create or replace function public.guild_project_target(p_guild_id uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_active integer;
  v_level integer;
begin
  select count(*) into v_active from public.guild_members gm
    join public.idle_player_state ips on ips.auth_user_id = gm.auth_user_id
   where gm.guild_id = p_guild_id and ips.updated_at > now() - interval '7 days';
  select coalesce(max(glt.level), 1) into v_level from public.guild_level_thresholds glt, public.guilds g
   where g.id = p_guild_id and glt.xp_required <= coalesce(g.guild_xp, 0);
  return greatest(600, least(8000, 400 + 250 * greatest(1, v_active) + 40 * coalesce(v_level, 1)));
end;
$$;

-- Holt (oder legt an) das Projekt dieser Woche. Projektart deterministisch aus Gilde + Woche.
create or replace function public.guild_project_ensure(p_guild_id uuid)
returns public.guild_projects language plpgsql security definer set search_path = public as $$
declare
  v_week date := public.guild_project_week_start();
  v_row public.guild_projects%rowtype;
  v_def text;
  v_count integer;
begin
  select * into v_row from public.guild_projects gp where gp.guild_id = p_guild_id and gp.week_start = v_week;
  if found then return v_row; end if;
  select count(*) into v_count from public.guild_project_defs;
  select gpd.id into v_def from public.guild_project_defs gpd order by gpd.sort_order, gpd.id
   offset (public.village_seed_int(p_guild_id::text || ':' || v_week::text) % greatest(1, v_count)) limit 1;
  insert into public.guild_projects (guild_id, week_start, def_id, target_points)
  values (p_guild_id, v_week, v_def, public.guild_project_target(p_guild_id))
  on conflict (guild_id, week_start) do nothing;
  select * into v_row from public.guild_projects gp where gp.guild_id = p_guild_id and gp.week_start = v_week;
  return v_row;
end;
$$;

create or replace function public.guild_project_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_guild uuid;
  v_proj public.guild_projects%rowtype;
  v_def public.guild_project_defs%rowtype;
  v_mine integer;
  v_claimed boolean;
  v_badges integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select gm.guild_id into v_guild from public.guild_members gm where gm.auth_user_id = v_uid;
  if v_guild is null then return jsonb_build_object('in_guild', false); end if;
  v_proj := public.guild_project_ensure(v_guild);
  select * into v_def from public.guild_project_defs gpd where gpd.id = v_proj.def_id;
  select coalesce(max(c.points), 0) into v_mine from public.guild_project_contributions c
   where c.guild_id = v_guild and c.week_start = v_proj.week_start and c.auth_user_id = v_uid;
  v_claimed := exists (select 1 from public.guild_project_claims cl where cl.guild_id = v_guild and cl.week_start = v_proj.week_start and cl.auth_user_id = v_uid);
  select coalesce(g.projects_completed, 0) into v_badges from public.guilds g where g.id = v_guild;
  return jsonb_build_object(
    'in_guild', true, 'guild_id', v_guild, 'week_start', v_proj.week_start,
    'def', jsonb_build_object('id', v_def.id, 'name', v_def.name, 'icon', v_def.icon, 'description', v_def.description, 'resource_kinds', to_jsonb(v_def.resource_kinds)),
    'target_points', v_proj.target_points, 'progress_points', v_proj.progress_points,
    'completed', v_proj.completed_at is not null, 'my_points', v_mine, 'claimed', v_claimed, 'badges', v_badges,
    'gold_unit', (select public.village_gold_unit(ips.highest_dragon_index) from public.idle_player_state ips where ips.auth_user_id = v_uid),
    -- Kleine Wochenereignisse (Phase 11, "Gildenwoche"): Bonus in %, macht jeden Punkt guenstiger.
    'point_mod_pct', public.bkmp_event_modifier('guild_project_points_pct'),
    'top', coalesce((select jsonb_agg(jsonb_build_object('name', c.display_name, 'points', c.points) order by c.points desc)
                       from (select * from public.guild_project_contributions c2 where c2.guild_id = v_guild and c2.week_start = v_proj.week_start order by c2.points desc limit 5) c), '[]'::jsonb));
end;
$$;

create or replace function public.guild_project_contribute(p_kind text, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_guild uuid;
  v_member public.guild_members%rowtype;
  v_state public.idle_player_state%rowtype;
  v_proj public.guild_projects%rowtype;
  v_def public.guild_project_defs%rowtype;
  v_per_point bigint;
  v_points integer;
  v_cost bigint;
  v_have bigint;
  v_room integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_member from public.guild_members gm where gm.auth_user_id = v_uid;
  if not found then raise exception 'not_in_guild'; end if;
  v_guild := v_member.guild_id;
  if p_kind not in ('gold', 'wood', 'stone', 'crystals', 'essence') then raise exception 'invalid_kind'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  v_proj := public.guild_project_ensure(v_guild);
  select * into v_proj from public.guild_projects gp where gp.guild_id = v_guild and gp.week_start = v_proj.week_start for update;
  if v_proj.completed_at is not null then raise exception 'project_completed'; end if;
  select * into v_def from public.guild_project_defs gpd where gpd.id = v_proj.def_id;
  if not (p_kind = any(v_def.resource_kinds)) then raise exception 'kind_not_needed'; end if;

  select * into v_state from public.idle_player_state ips where ips.auth_user_id = v_uid for update;
  if not found then raise exception 'no_player_state'; end if;
  v_per_point := case p_kind
    when 'gold' then 20 * public.village_gold_unit(v_state.highest_dragon_index)
    when 'wood' then 100 when 'stone' then 100 else 5 end;
  -- Gildenwoche (Phase 11): Punkte werden guenstiger, solange das Event laeuft.
  v_per_point := greatest(1, round(v_per_point / (1 + public.bkmp_event_modifier('guild_project_points_pct') / 100)))::bigint;
  v_points := floor(p_amount / v_per_point)::integer;
  if v_points < 1 then raise exception 'amount_too_small'; end if;
  v_room := v_proj.target_points - v_proj.progress_points;
  v_points := least(v_points, v_room);
  v_cost := v_points * v_per_point;
  v_have := case p_kind when 'gold' then v_state.gold when 'wood' then v_state.wood when 'stone' then v_state.stone
                        when 'crystals' then v_state.crystals else v_state.essence end;
  if v_have < v_cost then raise exception 'insufficient_resources'; end if;

  update public.idle_player_state ips set
    gold = ips.gold - (case when p_kind = 'gold' then v_cost else 0 end),
    wood = ips.wood - (case when p_kind = 'wood' then v_cost else 0 end),
    stone = ips.stone - (case when p_kind = 'stone' then v_cost else 0 end),
    crystals = ips.crystals - (case when p_kind = 'crystals' then v_cost else 0 end),
    essence = ips.essence - (case when p_kind = 'essence' then v_cost else 0 end)
  where ips.auth_user_id = v_uid;

  insert into public.guild_project_contributions (guild_id, week_start, auth_user_id, name_key, display_name, points)
  values (v_guild, v_proj.week_start, v_uid, v_member.name_key, v_member.display_name, v_points)
  on conflict (guild_id, week_start, auth_user_id) do update set points = public.guild_project_contributions.points + excluded.points,
    display_name = excluded.display_name;

  update public.guild_projects gp set
    progress_points = gp.progress_points + v_points,
    completed_at = case when gp.progress_points + v_points >= gp.target_points then now() else null end
  where gp.guild_id = v_guild and gp.week_start = v_proj.week_start;
  if v_proj.progress_points + v_points >= v_proj.target_points then
    update public.guilds g set projects_completed = coalesce(g.projects_completed, 0) + 1 where g.id = v_guild;
  end if;

  return jsonb_build_object('kind', p_kind, 'spent', v_cost, 'points', v_points,
    'progress_points', v_proj.progress_points + v_points, 'target_points', v_proj.target_points,
    'completed', v_proj.progress_points + v_points >= v_proj.target_points);
end;
$$;

create or replace function public.guild_project_claim()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_guild uuid;
  v_proj public.guild_projects%rowtype;
  v_mine integer;
  v_inserted integer;
  v_crystals integer := 150;
  v_essence integer := 100;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select gm.guild_id into v_guild from public.guild_members gm where gm.auth_user_id = v_uid;
  if v_guild is null then raise exception 'not_in_guild'; end if;
  select * into v_proj from public.guild_projects gp where gp.guild_id = v_guild and gp.week_start = public.guild_project_week_start();
  if not found or v_proj.completed_at is null then raise exception 'not_completed'; end if;
  select coalesce(max(c.points), 0) into v_mine from public.guild_project_contributions c
   where c.guild_id = v_guild and c.week_start = v_proj.week_start and c.auth_user_id = v_uid;
  if v_mine < 10 then raise exception 'too_little_contribution'; end if;
  insert into public.guild_project_claims (guild_id, week_start, auth_user_id) values (v_guild, v_proj.week_start, v_uid)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then raise exception 'already_claimed'; end if;
  update public.idle_player_state ips set crystals = ips.crystals + v_crystals, essence = ips.essence + v_essence
   where ips.auth_user_id = v_uid;
  return jsonb_build_object('crystals', v_crystals, 'essence', v_essence, 'runes', 1, 'rune_tier', 2);
end;
$$;

revoke all on function public.guild_project_status() from public, anon;
revoke all on function public.guild_project_contribute(text, bigint) from public, anon;
revoke all on function public.guild_project_claim() from public, anon;
revoke all on function public.guild_project_ensure(uuid) from public, anon, authenticated;
revoke all on function public.guild_project_target(uuid) from public, anon, authenticated;
grant execute on function public.guild_project_status() to authenticated;
grant execute on function public.guild_project_contribute(text, bigint) to authenticated;
grant execute on function public.guild_project_claim() to authenticated;

notify pgrst, 'reload schema';
