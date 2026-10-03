-- ============================================================
-- Drachendorf-Ausbau Phase 2 (04.10.2026): Dorfentwicklung
--   * Dorfprojekte (Drachenhafen I-III, Handelsposten I-II)
--   * Handelsposten: taeglich wechselnde, deterministische Angebote
--
-- NOCH NICHT AUSGEFUEHRT - im Supabase SQL Editor ausfuehren.
-- Idempotent (mehrfach ausfuehrbar), rein additiv: keine bestehende
-- Tabelle/Spalte/Zeile wird veraendert oder geloescht.
--
-- Sicherheitsprinzip: Bauen und Handeln laufen ausschliesslich ueber
-- security-definer-Funktionen. Spieler haben auf die neuen Tabellen nur
-- Leserechte (eigene Zeilen), nie Schreibrechte. Die Funktionen pruefen
-- Konto, Fortschritt und Ressourcen serverseitig und ziehen die Kosten
-- direkt in idle_player_state ab. updated_at wird dabei bewusst NICHT
-- angefasst (Anti-Cheat-Zeitbudget, siehe
-- 20260811-anticheat-guard-flag-insert-safety-net.sql) - der Client zieht
-- denselben Betrag lokal ab und speichert normal weiter.
--
-- Kosten: per Simulation aus echten (anonym gelesenen) Spielerdaten vom
-- 04.10.2026 abgeleitet, siehe MASTER_DOKUMENTATION_BKINVESTMENT.md,
-- Abschnitt "Dorfentwicklung - Balance".
-- ============================================================

-- ---------- 1) Katalog der Dorfprojekte (oeffentlich lesbar) ----------
create table if not exists public.village_building_levels (
  building_id text not null,
  level integer not null check (level >= 1),
  building_name text not null,
  icon text not null default '',
  level_label text not null default '',
  description text not null default '',
  effects jsonb not null default '{}'::jsonb,
  min_stage bigint not null default 0,
  cost_gold bigint not null default 0 check (cost_gold >= 0),
  cost_wood bigint not null default 0 check (cost_wood >= 0),
  cost_stone bigint not null default 0 check (cost_stone >= 0),
  cost_crystals bigint not null default 0 check (cost_crystals >= 0),
  cost_essence bigint not null default 0 check (cost_essence >= 0),
  sort_order integer not null default 0,
  primary key (building_id, level)
);

alter table public.village_building_levels enable row level security;
drop policy if exists village_building_levels_read on public.village_building_levels;
create policy village_building_levels_read on public.village_building_levels
  for select using (true);
grant select on public.village_building_levels to anon, authenticated;

insert into public.village_building_levels
  (building_id, level, building_name, icon, level_label, description, effects, min_stage,
   cost_gold, cost_wood, cost_stone, cost_crystals, cost_essence, sort_order)
values
  ('drachenhafen', 1, 'Drachenhafen', '⚓', 'Drachenhafen I',
   'Ein kleiner Anleger am Dorfrand. Deine erwachsenen Drachen können von hier zu Expeditionen aufbrechen.',
   '{"expedition_slots":1,"regions":["fluesterwald","glutberge"]}'::jsonb, 50,
   120000, 4000, 4000, 250, 100, 10),
  ('drachenhafen', 2, 'Drachenhafen', '⚓', 'Drachenhafen II',
   'Ein zweiter Steg und erfahrene Kartenzeichner: zwei Expeditionen gleichzeitig und neue Regionen.',
   '{"expedition_slots":2,"regions":["frostklamm","endriss"]}'::jsonb, 400,
   5000000, 40000, 40000, 3000, 1500, 11),
  ('drachenhafen', 3, 'Drachenhafen', '⚓', 'Drachenhafen III',
   'Der große Hafen. Drei Expeditionen gleichzeitig - und der Weg ins Verbotene Drachental ist frei.',
   '{"expedition_slots":3,"regions":["verbotenes_tal"]}'::jsonb, 1500,
   60000000, 150000, 150000, 20000, 10000, 12),
  ('handelsposten', 1, 'Handelsposten', '🏪', 'Handelsposten I',
   'Händler aus den Nachbardörfern tauschen jeden Tag andere Waren. 3 Angebote pro Tag.',
   '{"offers_per_day":3}'::jsonb, 100,
   400000, 10000, 10000, 500, 250, 20),
  ('handelsposten', 2, 'Handelsposten', '🏪', 'Handelsposten II',
   'Ein größerer Markt: 4 Angebote pro Tag und gelegentlich seltene Waren.',
   '{"offers_per_day":4}'::jsonb, 800,
   15000000, 60000, 60000, 5000, 2500, 21)
on conflict (building_id, level) do update set
  building_name = excluded.building_name, icon = excluded.icon, level_label = excluded.level_label,
  description = excluded.description, effects = excluded.effects, min_stage = excluded.min_stage,
  cost_gold = excluded.cost_gold, cost_wood = excluded.cost_wood, cost_stone = excluded.cost_stone,
  cost_crystals = excluded.cost_crystals, cost_essence = excluded.cost_essence, sort_order = excluded.sort_order;

-- ---------- 2) Ausbaustand pro Spieler ----------
create table if not exists public.village_buildings (
  auth_user_id uuid not null,
  name_key text not null default '',
  building_id text not null,
  level integer not null default 0 check (level >= 0),
  upgraded_at timestamptz not null default now(),
  primary key (auth_user_id, building_id)
);
alter table public.village_buildings enable row level security;
drop policy if exists village_buildings_own_read on public.village_buildings;
create policy village_buildings_own_read on public.village_buildings
  for select using (auth.uid() = auth_user_id);
revoke all on public.village_buildings from anon, authenticated;
grant select on public.village_buildings to authenticated;

-- ---------- 3) Handelsposten: Angebots-Vorlagen (oeffentlich lesbar) ----------
-- cost_gold_units/reward_gold_units: Vielfache einer "Goldeinheit" = Gold eines
-- Standarddrachens auf der hoechsten erreichten Stufe (gleiche Formel wie
-- bkmpIdleRewardsAt: 6 * (1 + 0.05*Stufe)^1.2). So bleibt Gold fuer
-- Anfaenger und Endgame-Spieler gleich "teuer".
create table if not exists public.village_trade_templates (
  id text primary key,
  label text not null,
  weight integer not null default 1 check (weight >= 1),
  min_handelsposten_level integer not null default 1,
  cost_kind text not null check (cost_kind in ('gold','wood','stone','crystals','essence')),
  cost_amount bigint not null default 0,
  cost_gold_units integer not null default 0,
  cost2_kind text check (cost2_kind in ('gold','wood','stone','crystals','essence')),
  cost2_amount bigint not null default 0,
  reward_kind text not null check (reward_kind in ('gold','wood','stone','crystals','essence','fruit','meat','rune','egg')),
  reward_amount bigint not null default 0,
  sort_order integer not null default 0
);
alter table public.village_trade_templates enable row level security;
drop policy if exists village_trade_templates_read on public.village_trade_templates;
create policy village_trade_templates_read on public.village_trade_templates for select using (true);
grant select on public.village_trade_templates to anon, authenticated;

insert into public.village_trade_templates
  (id, label, weight, min_handelsposten_level, cost_kind, cost_amount, cost_gold_units, cost2_kind, cost2_amount, reward_kind, reward_amount, sort_order)
values
  ('holz_kristall',  'Holz gegen Kristalle',  10, 1, 'wood',     2000, 0, null, 0, 'crystals', 60,   1),
  ('stein_essenz',   'Stein gegen Essenz',    10, 1, 'stone',    2000, 0, null, 0, 'essence',  40,   2),
  ('gold_frucht',    'Gold gegen Früchte',     8, 1, 'gold',        0, 900, null, 0, 'fruit',  500,  3),
  ('gold_fleisch',   'Gold gegen Fleisch',     8, 1, 'gold',        0, 900, null, 0, 'meat',   500,  4),
  ('gold_holz',      'Gold gegen Holz',        7, 1, 'gold',        0, 600, null, 0, 'wood',   1500, 5),
  ('gold_stein',     'Gold gegen Stein',       7, 1, 'gold',        0, 600, null, 0, 'stone',  1500, 6),
  ('kristall_holz',  'Kristalle gegen Holz',   6, 1, 'crystals',  150, 0, null, 0, 'wood',     2500, 7),
  ('essenz_stein',   'Essenz gegen Stein',     6, 1, 'essence',   100, 0, null, 0, 'stone',    2500, 8),
  ('kristall_rune',  'Kristalle gegen Rune',   5, 1, 'crystals',  300, 0, null, 0, 'rune',     1,    9),
  ('essenz_ei',      'Seltenes Drachenei',     2, 1, 'essence',   250, 0, 'crystals', 250, 'egg', 1,    10),
  ('gold_kristall',  'Gold gegen Kristalle',   5, 2, 'gold',        0, 2400, null, 0, 'crystals', 40, 11)
on conflict (id) do update set
  label = excluded.label, weight = excluded.weight, min_handelsposten_level = excluded.min_handelsposten_level,
  cost_kind = excluded.cost_kind, cost_amount = excluded.cost_amount, cost_gold_units = excluded.cost_gold_units,
  cost2_kind = excluded.cost2_kind, cost2_amount = excluded.cost2_amount,
  reward_kind = excluded.reward_kind, reward_amount = excluded.reward_amount, sort_order = excluded.sort_order;

-- ---------- 4) Handelsposten: Kaufprotokoll (verhindert Doppelkauf) ----------
create table if not exists public.village_trade_log (
  auth_user_id uuid not null,
  trade_day date not null,
  offer_index smallint not null,
  template_id text not null,
  created_at timestamptz not null default now(),
  primary key (auth_user_id, trade_day, offer_index)
);
alter table public.village_trade_log enable row level security;
drop policy if exists village_trade_log_own_read on public.village_trade_log;
create policy village_trade_log_own_read on public.village_trade_log for select using (auth.uid() = auth_user_id);
revoke all on public.village_trade_log from anon, authenticated;
grant select on public.village_trade_log to authenticated;

-- ---------- 5) Hilfsfunktionen ----------
create or replace function public.village_berlin_today()
returns date language sql stable as $$
  select (now() at time zone 'Europe/Berlin')::date;
$$;

create or replace function public.village_gold_unit(p_stage bigint)
returns bigint language sql immutable as $$
  select greatest(6, round(6 * power(1 + 0.05 * greatest(0, coalesce(p_stage, 0)), 1.2)))::bigint;
$$;

-- Deterministische Zahl 0..2^31-1 aus einem Text (md5 statt hashtext, damit die
-- lokale Testumgebung exakt dasselbe Ergebnis nachrechnen kann).
create or replace function public.village_seed_int(p_text text)
returns bigint language sql immutable as $$
  select ('x' || substr(md5(p_text), 1, 8))::bit(32)::bigint & 2147483647;
$$;

create or replace function public.village_building_level(p_uid uuid, p_building text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select vb.level from public.village_buildings vb
                   where vb.auth_user_id = p_uid and vb.building_id = p_building), 0);
$$;

-- Liefert die Vorlagen-IDs der Tagesangebote (gewichtete Auswahl ohne
-- Doppelte, deterministisch pro Konto + Berliner Kalendertag).
create or replace function public.village_trade_offer_ids(p_uid uuid, p_day date, p_level integer)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_count integer;
  v_ids text[] := array[]::text[];
  v_pool record;
  v_total integer;
  v_pick integer;
  v_acc integer;
  v_i integer;
begin
  v_count := case when p_level >= 2 then 4 when p_level >= 1 then 3 else 0 end;
  for v_i in 0 .. v_count - 1 loop
    select coalesce(sum(t.weight), 0) into v_total
      from public.village_trade_templates t
     where t.min_handelsposten_level <= p_level and not (t.id = any(v_ids));
    exit when v_total <= 0;
    v_pick := (public.village_seed_int(p_uid::text || ':' || p_day::text || ':' || v_i::text) % v_total)::integer;
    v_acc := 0;
    for v_pool in
      select t.id, t.weight from public.village_trade_templates t
       where t.min_handelsposten_level <= p_level and not (t.id = any(v_ids))
       order by t.sort_order, t.id
    loop
      v_acc := v_acc + v_pool.weight;
      if v_pick < v_acc then
        v_ids := array_append(v_ids, v_pool.id);
        exit;
      end if;
    end loop;
  end loop;
  return v_ids;
end;
$$;

-- ---------- 6) RPC: Dorfprojekt bauen/ausbauen ----------
create or replace function public.village_build(p_building_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_state public.idle_player_state%rowtype;
  v_current integer;
  v_def public.village_building_levels%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_state from public.idle_player_state ips where ips.auth_user_id = v_uid for update;
  if not found then raise exception 'no_player_state'; end if;

  v_current := public.village_building_level(v_uid, p_building_id);

  select * into v_def from public.village_building_levels vbl
   where vbl.building_id = p_building_id and vbl.level = v_current + 1;
  if not found then
    if exists (select 1 from public.village_building_levels vbl2 where vbl2.building_id = p_building_id) then
      raise exception 'max_level';
    end if;
    raise exception 'invalid_building';
  end if;

  if coalesce(v_state.highest_dragon_index, 0) < v_def.min_stage then raise exception 'stage_too_low'; end if;
  if v_state.gold < v_def.cost_gold or v_state.wood < v_def.cost_wood or v_state.stone < v_def.cost_stone
     or v_state.crystals < v_def.cost_crystals or v_state.essence < v_def.cost_essence then
    raise exception 'insufficient_resources';
  end if;

  update public.idle_player_state ips set
    gold = ips.gold - v_def.cost_gold,
    wood = ips.wood - v_def.cost_wood,
    stone = ips.stone - v_def.cost_stone,
    crystals = ips.crystals - v_def.cost_crystals,
    essence = ips.essence - v_def.cost_essence
  where ips.auth_user_id = v_uid;

  insert into public.village_buildings (auth_user_id, name_key, building_id, level, upgraded_at)
  values (v_uid, v_state.name_key, p_building_id, v_def.level, now())
  on conflict (auth_user_id, building_id) do update set level = excluded.level, name_key = excluded.name_key, upgraded_at = now();

  return jsonb_build_object(
    'building_id', p_building_id, 'level', v_def.level,
    'spent', jsonb_build_object('gold', v_def.cost_gold, 'wood', v_def.cost_wood, 'stone', v_def.cost_stone,
                                'crystals', v_def.cost_crystals, 'essence', v_def.cost_essence));
end;
$$;

-- ---------- 7) RPC: Tagesangebote des Handelspostens ----------
create or replace function public.village_trade_offers()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_level integer;
  v_day date := public.village_berlin_today();
  v_stage bigint;
  v_unit bigint;
  v_ids text[];
  v_out jsonb := '[]'::jsonb;
  v_t public.village_trade_templates%rowtype;
  v_i integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  v_level := public.village_building_level(v_uid, 'handelsposten');
  select coalesce(ips.highest_dragon_index, 0) into v_stage from public.idle_player_state ips where ips.auth_user_id = v_uid;
  v_unit := public.village_gold_unit(coalesce(v_stage, 0));
  v_ids := public.village_trade_offer_ids(v_uid, v_day, v_level);
  if v_ids is null or array_length(v_ids, 1) is null then
    return jsonb_build_object('day', v_day, 'level', v_level, 'offers', v_out);
  end if;
  for v_i in 1 .. array_length(v_ids, 1) loop
    select * into v_t from public.village_trade_templates vt where vt.id = v_ids[v_i];
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'index', v_i - 1,
      'template_id', v_t.id,
      'label', v_t.label,
      'cost_kind', v_t.cost_kind,
      'cost_amount', case when v_t.cost_kind = 'gold' then v_t.cost_gold_units * v_unit else v_t.cost_amount end,
      'cost2_kind', v_t.cost2_kind,
      'cost2_amount', v_t.cost2_amount,
      'reward_kind', v_t.reward_kind,
      'reward_amount', v_t.reward_amount,
      'bought', exists (select 1 from public.village_trade_log l
                         where l.auth_user_id = v_uid and l.trade_day = v_day and l.offer_index = v_i - 1)
    ));
  end loop;
  return jsonb_build_object('day', v_day, 'level', v_level, 'offers', v_out);
end;
$$;

-- ---------- 8) RPC: Angebot annehmen (atomar, idempotent) ----------
create or replace function public.village_trade_execute(p_offer_index integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_state public.idle_player_state%rowtype;
  v_level integer;
  v_day date := public.village_berlin_today();
  v_ids text[];
  v_t public.village_trade_templates%rowtype;
  v_cost bigint;
  v_have bigint;
  v_have2 bigint;
  v_reward bigint;
  v_cap bigint;
  v_cur bigint;
  v_inserted integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_state from public.idle_player_state ips where ips.auth_user_id = v_uid for update;
  if not found then raise exception 'no_player_state'; end if;

  v_level := public.village_building_level(v_uid, 'handelsposten');
  if v_level < 1 then raise exception 'not_built'; end if;
  v_ids := public.village_trade_offer_ids(v_uid, v_day, v_level);
  if p_offer_index is null or p_offer_index < 0 or v_ids is null or p_offer_index >= coalesce(array_length(v_ids, 1), 0) then
    raise exception 'invalid_offer';
  end if;
  select * into v_t from public.village_trade_templates vt where vt.id = v_ids[p_offer_index + 1];

  if exists (select 1 from public.village_trade_log l
              where l.auth_user_id = v_uid and l.trade_day = v_day and l.offer_index = p_offer_index) then
    raise exception 'already_bought';
  end if;

  v_cost := case when v_t.cost_kind = 'gold'
                 then v_t.cost_gold_units * public.village_gold_unit(v_state.highest_dragon_index)
                 else v_t.cost_amount end;
  v_have := case v_t.cost_kind when 'gold' then v_state.gold when 'wood' then v_state.wood when 'stone' then v_state.stone
                               when 'crystals' then v_state.crystals else v_state.essence end;
  if v_have < v_cost then raise exception 'insufficient_resources'; end if;
  if v_t.cost2_kind is not null then
    v_have2 := case v_t.cost2_kind when 'gold' then v_state.gold when 'wood' then v_state.wood when 'stone' then v_state.stone
                                   when 'crystals' then v_state.crystals else v_state.essence end;
    if v_have2 < v_t.cost2_amount then raise exception 'insufficient_resources'; end if;
  end if;

  v_reward := v_t.reward_amount;
  if v_t.reward_kind in ('fruit', 'meat') then
    -- gleiche Lagergrenze wie bkmpDragonResourceCap() (2000 + Stufe*500)
    if v_t.reward_kind = 'fruit' then
      v_cap := 2000 + coalesce(v_state.obstgarten_level, 0) * 500; v_cur := coalesce(v_state.fruit, 0);
    else
      v_cap := 2000 + coalesce(v_state.jagdhuette_level, 0) * 500; v_cur := coalesce(v_state.meat, 0);
    end if;
    if v_cur >= v_cap then raise exception 'storage_full'; end if;
    v_reward := least(v_reward, v_cap - v_cur);
  end if;

  insert into public.village_trade_log (auth_user_id, trade_day, offer_index, template_id)
  values (v_uid, v_day, p_offer_index, v_t.id)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then raise exception 'already_bought'; end if;

  update public.idle_player_state ips set
    gold = ips.gold - (case when v_t.cost_kind = 'gold' then v_cost else 0 end) - (case when v_t.cost2_kind = 'gold' then v_t.cost2_amount else 0 end)
                    + (case when v_t.reward_kind = 'gold' then v_reward else 0 end),
    wood = ips.wood - (case when v_t.cost_kind = 'wood' then v_cost else 0 end) - (case when v_t.cost2_kind = 'wood' then v_t.cost2_amount else 0 end)
                    + (case when v_t.reward_kind = 'wood' then v_reward else 0 end),
    stone = ips.stone - (case when v_t.cost_kind = 'stone' then v_cost else 0 end) - (case when v_t.cost2_kind = 'stone' then v_t.cost2_amount else 0 end)
                      + (case when v_t.reward_kind = 'stone' then v_reward else 0 end),
    crystals = ips.crystals - (case when v_t.cost_kind = 'crystals' then v_cost else 0 end) - (case when v_t.cost2_kind = 'crystals' then v_t.cost2_amount else 0 end)
                            + (case when v_t.reward_kind = 'crystals' then v_reward else 0 end),
    essence = ips.essence - (case when v_t.cost_kind = 'essence' then v_cost else 0 end) - (case when v_t.cost2_kind = 'essence' then v_t.cost2_amount else 0 end)
                          + (case when v_t.reward_kind = 'essence' then v_reward else 0 end),
    fruit = coalesce(ips.fruit, 0) + (case when v_t.reward_kind = 'fruit' then v_reward else 0 end),
    meat = coalesce(ips.meat, 0) + (case when v_t.reward_kind = 'meat' then v_reward else 0 end)
  where ips.auth_user_id = v_uid;

  -- Runen/Eier werden (wie bei Dungeon-Funden und Chronik-Truhen) vom Client
  -- ausgewuerfelt und gespeichert; der Server hat hier den Kauf bereits
  -- verbindlich und einmalig verbucht.
  return jsonb_build_object(
    'index', p_offer_index, 'template_id', v_t.id,
    'cost_kind', v_t.cost_kind, 'cost_amount', v_cost,
    'cost2_kind', v_t.cost2_kind, 'cost2_amount', v_t.cost2_amount,
    'reward_kind', v_t.reward_kind, 'reward_amount', v_reward);
end;
$$;

revoke all on function public.village_build(text) from public, anon;
revoke all on function public.village_trade_offers() from public, anon;
revoke all on function public.village_trade_execute(integer) from public, anon;
revoke all on function public.village_trade_offer_ids(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.village_building_level(uuid, text) from public, anon, authenticated;
grant execute on function public.village_build(text) to authenticated;
grant execute on function public.village_trade_offers() to authenticated;
grant execute on function public.village_trade_execute(integer) to authenticated;

notify pgrst, 'reload schema';
