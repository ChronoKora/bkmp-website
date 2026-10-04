-- ============================================================
-- Drachendorf-Ausbau Phase 10 (04.10.2026): Goettliche Erweckung
--
-- Erwachsen -> Goettlich ist KEINE Folge normaler Kampf-EP, sondern ein
-- eigener, langfristiger Weg mit drei Saeulen (alles datengetrieben aus
-- dragon_species.divine_config, nicht fest fuer Lightnix/Darknix):
--   1) Bindung   - Bindungsstufe >= bond_level (Standard 5)
--   2) Nutzung   - echte gemeinsame Kampfzeit (companion_hours), gemeinsam
--                  besiegte Bosse (companion_boss_kills), abgeschlossene
--                  Expeditionen (expeditions) - Zaehler kommen nur aus
--                  dragon_activity_tick/expedition_claim (serverseitig).
--   3) Opfergabe - grosse Gold-Opfergabe in beliebig vielen Einzahlungen.
--                  Gezaehlt wird in "Goldeinheiten" (Gold eines Standard-
--                  drachen auf der hoechsten Stufe, village_gold_unit) zum
--                  Zeitpunkt der Einzahlung - das Ziel waechst also nicht
--                  mit, wenn der Spieler stark wird. Dazu moderat Kristalle
--                  und Essenz bei der Erweckung selbst.
-- Alle Bedingungen erfuellt -> 100 % Erfolg, kein Zufall. Die Verwandlung
-- ist atomar (Zeilensperren), aendert nur Stufe/Multiplikator/Zeitpunkt -
-- Name, Besitzer, Favorit, Eigenschaft, Bindung, Historie bleiben.
-- Der Staerke-Multiplikator wird EINMAL gespeichert (divine_multiplier)
-- und vom Spiel nur gelesen - nie bei Reload/mehreren Tabs erneut
-- multipliziert. Einzelstueck-Arten brauchen keine zweite Kopie.
--
-- Voraussetzung: 20261004-01, -03, -04, -08. NOCH NICHT AUSGEFUEHRT.
-- Idempotent.
-- ============================================================

alter table public.player_dragons add column if not exists divine_offering_units numeric not null default 0;

-- Schutz-Trigger um die neue Spalte erweitert (sonst identisch zu 20261004-01).
create or replace function public.player_dragons_protect_trusted()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('bkmp.trusted', true), '') = 'on' then
    return NEW;
  end if;
  if TG_OP = 'INSERT' then
    NEW.trait := null;
    NEW.bond_xp := 0;
    NEW.companion_seconds := 0;
    NEW.companion_kills := 0;
    NEW.companion_boss_kills := 0;
    NEW.expeditions_completed := 0;
    NEW.divine_offering_gold := 0;
    NEW.divine_offering_units := 0;
    NEW.divine_multiplier := 1;
    NEW.awakened_at := null;
    NEW.origin_event := null;
    if NEW.stage = 'divine' then NEW.stage := 'adult'; end if;
    return NEW;
  end if;
  NEW.trait := OLD.trait;
  NEW.bond_xp := OLD.bond_xp;
  NEW.companion_seconds := OLD.companion_seconds;
  NEW.companion_kills := OLD.companion_kills;
  NEW.companion_boss_kills := OLD.companion_boss_kills;
  NEW.expeditions_completed := OLD.expeditions_completed;
  NEW.divine_offering_gold := OLD.divine_offering_gold;
  NEW.divine_offering_units := OLD.divine_offering_units;
  NEW.divine_multiplier := OLD.divine_multiplier;
  NEW.awakened_at := OLD.awakened_at;
  NEW.origin_event := OLD.origin_event;
  NEW.species_id := OLD.species_id;
  if OLD.stage = 'divine' then
    NEW.stage := 'divine';
  elsif NEW.stage = 'divine' then
    NEW.stage := OLD.stage;
  end if;
  return NEW;
end;
$$;

-- Fortschritt eines Drachen (fuer "Weg zur Goettlichkeit").
create or replace function public.divine_status(p_dragon_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_d public.player_dragons%rowtype;
  v_sp public.dragon_species%rowtype;
  v_cfg jsonb;
  v_unit bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_d from public.player_dragons pd where pd.id = p_dragon_id and pd.auth_user_id = v_uid;
  if not found then raise exception 'dragon_not_found'; end if;
  select * into v_sp from public.dragon_species ds where ds.id = v_d.species_id;
  v_cfg := v_sp.divine_config;
  if coalesce(v_sp.stage_count, 4) < 5 or v_cfg is null then
    return jsonb_build_object('eligible_species', false);
  end if;
  select public.village_gold_unit(ips.highest_dragon_index) into v_unit from public.idle_player_state ips where ips.auth_user_id = v_uid;
  return jsonb_build_object(
    'eligible_species', true, 'stage', v_d.stage, 'divine', v_d.stage = 'divine',
    'bond_level', public.dragon_bond_level(v_d.bond_xp), 'need_bond', coalesce((v_cfg->>'bond_level')::integer, 5),
    'companion_seconds', v_d.companion_seconds, 'need_seconds', round(coalesce((v_cfg->>'companion_hours')::numeric, 10) * 3600),
    'boss_kills', v_d.companion_boss_kills, 'need_boss_kills', coalesce((v_cfg->>'companion_boss_kills')::integer, 50),
    'expeditions', v_d.expeditions_completed, 'need_expeditions', coalesce((v_cfg->>'expeditions')::integer, 10),
    'offering_units', v_d.divine_offering_units, 'offering_gold', v_d.divine_offering_gold,
    'need_units', coalesce((v_cfg->>'offering_gold_units')::numeric, 600000),
    'gold_unit', coalesce(v_unit, 6),
    'need_crystals', coalesce((v_cfg->>'crystals')::integer, 0), 'need_essence', coalesce((v_cfg->>'essence')::integer, 0),
    'stat_multiplier', coalesce((v_cfg->>'stat_multiplier')::numeric, 1.25),
    'divine_multiplier', v_d.divine_multiplier, 'awakened_at', v_d.awakened_at);
end;
$$;

-- Gold-Opfergabe (beliebig viele Einzahlungen, nie ueber das Ziel hinaus).
create or replace function public.divine_offer(p_dragon_id uuid, p_gold bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_d public.player_dragons%rowtype;
  v_sp public.dragon_species%rowtype;
  v_state public.idle_player_state%rowtype;
  v_unit bigint;
  v_need numeric;
  v_remaining numeric;
  v_spend bigint;
  v_units numeric;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_gold is null or p_gold <= 0 then raise exception 'amount_too_small'; end if;
  select * into v_state from public.idle_player_state ips where ips.auth_user_id = v_uid for update;
  if not found then raise exception 'no_player_state'; end if;
  select * into v_d from public.player_dragons pd where pd.id = p_dragon_id and pd.auth_user_id = v_uid for update;
  if not found then raise exception 'dragon_not_found'; end if;
  select * into v_sp from public.dragon_species ds where ds.id = v_d.species_id;
  if coalesce(v_sp.stage_count, 4) < 5 or v_sp.divine_config is null then raise exception 'not_divine_species'; end if;
  if v_d.stage = 'divine' then raise exception 'already_divine'; end if;
  if v_d.stage <> 'adult' then raise exception 'not_adult'; end if;
  v_unit := public.village_gold_unit(v_state.highest_dragon_index);
  v_need := coalesce((v_sp.divine_config->>'offering_gold_units')::numeric, 600000);
  v_remaining := v_need - v_d.divine_offering_units;
  if v_remaining <= 0 then raise exception 'offering_complete'; end if;
  v_spend := least(p_gold, ceil(v_remaining * v_unit)::bigint, floor(coalesce(v_state.gold, 0))::bigint);
  if v_spend < v_unit then raise exception 'amount_too_small'; end if;
  v_units := least(v_remaining, v_spend::numeric / v_unit);
  update public.idle_player_state ips set gold = ips.gold - v_spend where ips.auth_user_id = v_uid;
  perform set_config('bkmp.trusted', 'on', true);
  update public.player_dragons pd set
    divine_offering_units = pd.divine_offering_units + v_units,
    divine_offering_gold = pd.divine_offering_gold + v_spend
  where pd.id = p_dragon_id;
  perform set_config('bkmp.trusted', 'off', true);
  return jsonb_build_object('spent', v_spend, 'units', v_d.divine_offering_units + v_units, 'need_units', v_need,
    'complete', v_d.divine_offering_units + v_units >= v_need, 'gold_unit', v_unit);
end;
$$;

-- Die Erweckung selbst (atomar, 100 % Erfolg wenn alles erfuellt ist).
create or replace function public.divine_awaken(p_dragon_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_d public.player_dragons%rowtype;
  v_sp public.dragon_species%rowtype;
  v_state public.idle_player_state%rowtype;
  v_cfg jsonb;
  v_crystals bigint;
  v_essence bigint;
  v_mult numeric;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_state from public.idle_player_state ips where ips.auth_user_id = v_uid for update;
  if not found then raise exception 'no_player_state'; end if;
  select * into v_d from public.player_dragons pd where pd.id = p_dragon_id and pd.auth_user_id = v_uid for update;
  if not found then raise exception 'dragon_not_found'; end if;
  select * into v_sp from public.dragon_species ds where ds.id = v_d.species_id;
  v_cfg := v_sp.divine_config;
  if coalesce(v_sp.stage_count, 4) < 5 or v_cfg is null then raise exception 'not_divine_species'; end if;
  if v_d.stage = 'divine' then raise exception 'already_divine'; end if;
  if v_d.stage <> 'adult' then raise exception 'not_adult'; end if;
  if exists (select 1 from public.player_expeditions pe where pe.status = 'running' and v_d.id = any(pe.dragon_ids)) then
    raise exception 'dragon_on_expedition';
  end if;
  if public.dragon_bond_level(v_d.bond_xp) < coalesce((v_cfg->>'bond_level')::integer, 5) then raise exception 'bond_too_low'; end if;
  if v_d.companion_seconds < round(coalesce((v_cfg->>'companion_hours')::numeric, 10) * 3600) then raise exception 'usage_too_low'; end if;
  if v_d.companion_boss_kills < coalesce((v_cfg->>'companion_boss_kills')::integer, 50) then raise exception 'usage_too_low'; end if;
  if v_d.expeditions_completed < coalesce((v_cfg->>'expeditions')::integer, 10) then raise exception 'usage_too_low'; end if;
  if v_d.divine_offering_units < coalesce((v_cfg->>'offering_gold_units')::numeric, 600000) then raise exception 'offering_incomplete'; end if;
  v_crystals := coalesce((v_cfg->>'crystals')::bigint, 0);
  v_essence := coalesce((v_cfg->>'essence')::bigint, 0);
  if coalesce(v_state.crystals, 0) < v_crystals or coalesce(v_state.essence, 0) < v_essence then raise exception 'insufficient_resources'; end if;
  v_mult := greatest(1, least(2, coalesce((v_cfg->>'stat_multiplier')::numeric, 1.25)));

  update public.idle_player_state ips set crystals = ips.crystals - v_crystals, essence = ips.essence - v_essence
   where ips.auth_user_id = v_uid;
  perform set_config('bkmp.trusted', 'on', true);
  update public.player_dragons pd set stage = 'divine', divine_multiplier = v_mult, awakened_at = now()
   where pd.id = p_dragon_id;
  perform set_config('bkmp.trusted', 'off', true);
  return jsonb_build_object('stage', 'divine', 'divine_multiplier', v_mult, 'crystals', v_crystals, 'essence', v_essence,
    'awakened_at', now());
end;
$$;

revoke all on function public.divine_status(uuid) from public, anon;
revoke all on function public.divine_offer(uuid, bigint) from public, anon;
revoke all on function public.divine_awaken(uuid) from public, anon;
grant execute on function public.divine_status(uuid) to authenticated;
grant execute on function public.divine_offer(uuid, bigint) to authenticated;
grant execute on function public.divine_awaken(uuid) to authenticated;

notify pgrst, 'reload schema';
