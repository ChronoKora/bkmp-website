-- NUR FUER TESTS. Fassung von public.event_claim_tiers(text) VOR dem Hotfix
-- (aus Commit d7585cf, sql/20261004-06-special-events.sql): kennt reward.species_eggs
-- NICHT - legt auf Stufe 10/20 kein Ei an, markiert die Stufe aber als abgeholt.
-- Das ist die Fassung, die laut Live-Pruefung (funktion_kennt_species_eggs = false)
-- in der Datenbank lief. Wird nirgends in Produktion ausgefuehrt.

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
