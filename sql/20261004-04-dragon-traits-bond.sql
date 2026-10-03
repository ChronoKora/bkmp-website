-- ============================================================
-- Drachendorf-Ausbau Phase 4 (04.10.2026): Eigenschaften & Bindung
--   * dragon_traits: 11 positive Eigenschaften (nur Spezialisierungen,
--     keine Minus-Werte), oeffentlich lesbar
--   * dragon_ensure_traits(): jeder erwachsene (oder goettliche) Drache
--     bekommt GENAU EINMAL eine Eigenschaft - deterministisch aus seiner
--     ID (kein Neuwuerfeln durch Reload/Geraetewechsel), serverseitig
--   * dragon_activity_tick(): Bindung durch echte Nutzung als
--     Kampf-Begleiter. Grundlage sind die serverseitig gespeicherten
--     Kampfzaehler (dragon_kills/boss_kills), NICHT Angaben des Spiels -
--     Spam bringt nichts, ein Aufruf haeufiger als alle 20 s wird ignoriert.
--
-- Voraussetzung: 20261004-01 (geschuetzte Drachenfelder) und 20261004-03
-- (expedition_trait_strength, dragon_bond_level, player_expeditions).
-- NOCH NICHT AUSGEFUEHRT. Idempotent, rein additiv.
-- ============================================================

create table if not exists public.dragon_traits (
  id text primary key,
  name text not null,
  icon text not null default '',
  description text not null default '',
  sort_order integer not null default 0
);
alter table public.dragon_traits enable row level security;
drop policy if exists dragon_traits_read on public.dragon_traits;
create policy dragon_traits_read on public.dragon_traits for select using (true);
grant select on public.dragon_traits to anon, authenticated;

insert into public.dragon_traits (id, name, icon, description, sort_order) values
  ('gierig',        'Gierig',        '🪙', 'Bringt von Expeditionen 15 % mehr Gold mit.', 1),
  ('entdecker',     'Entdecker',     '🧭', 'Erlebt auf Expeditionen öfter besondere Ereignisse.', 2),
  ('sammler',       'Sammler',       '🎒', 'Bringt 15 % mehr Holz, Stein, Früchte und Fleisch mit.', 3),
  ('mutig',         'Mutig',         '⚔️', 'Stärker bei langen 8-Stunden-Expeditionen.', 4),
  ('schatzsucher',  'Schatzsucher',  '💎', '10 % mehr Kristalle und öfter Schatztruhen und Kristalladern.', 5),
  ('gesellig',      'Gesellig',      '🐉', 'Macht jedes Team besser, in dem er mitfliegt.', 6),
  ('einzelgaenger', 'Einzelgänger',  '🌙', 'Besonders stark auf Solo-Expeditionen.', 7),
  ('forscher',      'Forscher',      '📚', '10 % mehr Essenz, höhere Runenchance, findet öfter Ruinen und Schreine.', 8),
  ('beschuetzer',   'Beschützer',    '🛡️', 'Sorgt für Stabilität: Pech beim Expeditions-Ergebnis fällt milder aus.', 9),
  ('glueckskind',   'Glückskind',    '✨', 'Kleine Chance auf eine höhere Expeditions-Qualität.', 10),
  ('heiler',        'Heiler',        '🩹', '25 % mehr Bindung durch Expeditionen, hilft verletzten Drachen.', 11)
on conflict (id) do update set name = excluded.name, icon = excluded.icon, description = excluded.description, sort_order = excluded.sort_order;

-- Gleiche Zuordnung wie village_seed_int (md5) - ueber die Drachen-ID.
create or replace function public.dragon_trait_for(p_dragon_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select dt.id from public.dragon_traits dt
   order by dt.sort_order, dt.id
   offset (public.village_seed_int('trait:' || p_dragon_id::text) % greatest(1, (select count(*) from public.dragon_traits)))
   limit 1;
$$;

create or replace function public.dragon_ensure_traits()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform set_config('bkmp.trusted', 'on', true);
  with upd as (
    update public.player_dragons pd set trait = public.dragon_trait_for(pd.id)
     where pd.auth_user_id = v_uid and pd.stage in ('adult', 'divine') and pd.trait is null
    returning pd.id, pd.trait
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', upd.id, 'trait', upd.trait)), '[]'::jsonb) into v_out from upd;
  perform set_config('bkmp.trusted', 'off', true);
  return v_out;
end;
$$;

-- ---------- Bindung durch echte Nutzung ----------
create table if not exists public.player_activity_state (
  auth_user_id uuid primary key,
  last_report_at timestamptz not null default now(),
  last_kills bigint not null default 0,
  last_boss_kills bigint not null default 0,
  kill_carry integer not null default 0
);
alter table public.player_activity_state enable row level security;
revoke all on public.player_activity_state from anon, authenticated;

create or replace function public.dragon_activity_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ips public.idle_player_state%rowtype;
  v_act public.player_activity_state%rowtype;
  v_elapsed numeric;
  v_kills bigint;
  v_boss bigint;
  v_total bigint;
  v_bond integer;
  v_ids uuid[];
  v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_ips from public.idle_player_state ips where ips.auth_user_id = v_uid;
  if not found then raise exception 'no_player_state'; end if;

  select * into v_act from public.player_activity_state pas where pas.auth_user_id = v_uid for update;
  if not found then
    insert into public.player_activity_state (auth_user_id, last_report_at, last_kills, last_boss_kills, kill_carry)
    values (v_uid, now(), coalesce(v_ips.dragon_kills, 0), coalesce(v_ips.boss_kills, 0), 0)
    on conflict (auth_user_id) do nothing;
    return jsonb_build_object('bond_gain', 0, 'kills', 0, 'dragons', '[]'::jsonb);
  end if;

  v_elapsed := extract(epoch from (now() - v_act.last_report_at));
  if v_elapsed < 20 then
    return jsonb_build_object('bond_gain', 0, 'kills', 0, 'dragons', '[]'::jsonb, 'too_soon', true);
  end if;
  v_elapsed := least(v_elapsed, 180);

  -- Nur echte, bereits gespeicherte Kaempfe zaehlen (der Anti-Cheat-Trigger
  -- auf idle_player_state begrenzt deren Wachstum ohnehin auf 3/s).
  v_kills := greatest(0, coalesce(v_ips.dragon_kills, 0) - v_act.last_kills);
  v_kills := least(v_kills, floor(v_elapsed * 3)::bigint);
  v_boss := greatest(0, coalesce(v_ips.boss_kills, 0) - v_act.last_boss_kills);
  v_boss := least(v_boss, floor(v_elapsed / 20)::bigint + 1);

  select array_agg(pd.id) into v_ids from public.player_dragons pd
   where pd.auth_user_id = v_uid and pd.is_companion and pd.stage in ('adult', 'divine')
     and not exists (select 1 from public.player_expeditions pe where pe.status = 'running' and pd.id = any(pe.dragon_ids));

  v_total := v_act.kill_carry + v_kills;
  v_bond := least(floor(v_total / 40)::integer + v_boss::integer, 3 * ceil(v_elapsed / 60)::integer);

  if v_ids is not null and array_length(v_ids, 1) > 0 then
    perform set_config('bkmp.trusted', 'on', true);
    with upd as (
      update public.player_dragons pd set
        bond_xp = least(7500, pd.bond_xp + v_bond),
        companion_kills = pd.companion_kills + v_kills,
        companion_boss_kills = pd.companion_boss_kills + v_boss,
        companion_seconds = pd.companion_seconds + floor(v_elapsed)::bigint
       where pd.id = any(v_ids)
      returning pd.id, pd.bond_xp, pd.companion_kills, pd.companion_boss_kills, pd.companion_seconds
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', upd.id, 'bond_xp', upd.bond_xp, 'companion_kills', upd.companion_kills,
             'companion_boss_kills', upd.companion_boss_kills, 'companion_seconds', upd.companion_seconds)), '[]'::jsonb)
      into v_out from upd;
    perform set_config('bkmp.trusted', 'off', true);
  else
    v_bond := 0;
  end if;

  update public.player_activity_state pas set
    last_report_at = now(),
    last_kills = coalesce(v_ips.dragon_kills, 0),
    last_boss_kills = coalesce(v_ips.boss_kills, 0),
    kill_carry = case when v_ids is not null and array_length(v_ids, 1) > 0 then (v_total % 40)::integer else 0 end
  where pas.auth_user_id = v_uid;

  return jsonb_build_object('bond_gain', v_bond, 'kills', v_kills, 'boss_kills', v_boss, 'dragons', v_out);
end;
$$;

revoke all on function public.dragon_ensure_traits() from public, anon;
revoke all on function public.dragon_activity_tick() from public, anon;
revoke all on function public.dragon_trait_for(uuid) from public, anon, authenticated;
grant execute on function public.dragon_ensure_traits() to authenticated;
grant execute on function public.dragon_activity_tick() to authenticated;

notify pgrst, 'reload schema';
