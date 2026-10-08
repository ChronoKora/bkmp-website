-- ============================================================
-- Zwielicht-Pass: Eier fuer ALLE nachholen + Abholfunktion erneut einspielen (08.10.2026)
--
-- Befund (Live-Daten 07.10.):
--   * Stufe 20 braucht 2.000 Punkte. Moeglich sind hoechstens 350 Punkte je Tag
--     (4x40 + 90 + 100) plus 1.140 aus allen Wochenquests -> bis Di 06.10. 23:59
--     hoechstens 1.840. Stufe 20 wurde also von ALLEN erst am 07.10. abgeholt -
--     NACH dem Hotfix vom 06.10.
--   * 10 Spieler haben Stufe 20 abgeholt, keiner hat ein Surebrec-Ei bekommen
--     (kein Ei im Lager, kein Surebrec-Drache seit dem 07.10.); bagontr01 fehlt das
--     Stufe-10-Ei. Die Live-Konfiguration (Stufe 10 dayman, 20 surebrec) ist korrekt.
--   * tier_claimed schreibt NUR event_claim_tiers, und Eier loescht nur der Spieler
--     selbst (Freilassen/Ausbrueten).
--   -> Die am 07.10. live laufende Abholfunktion hat keine Eier angelegt.
--      Warum der Hotfix nicht gehalten hat, zeigt Teil 0 (Zustand VOR dieser Datei).
--
-- Diese Datei:
--   Teil 0  merkt sich, wie die Live-Funktion VORHER aussah (Spalten vorher_*).
--   Teil 1  spielt event_claim_tiers erneut ein (wortgleich zu sql/20261004-06, per Test
--           erzwungen) -> ab sofort bekommt jeder beim Abholen sein Ei.
--   Teil 2  gibt JEDEM Spieler, der Stufe 10/20 abgeholt hat, das fehlende Ei - EINMAL:
--             * Stufe steht in tier_claimed
--             * kein Nachhol-Eintrag fuer (Spieler, Stufe, Art)
--             * der Spieler besitzt aktuell kein Ei dieser Art
--           Ein Drache derselben Art (aus dem Ei-Dungeon) verhindert das Ei NICHT mehr.
--           Teil 2 laeuft nur beim ERSTEN Ausfuehren (Sperrvermerk) - ein zweites Ausfuehren
--           vergibt nichts mehr (sonst bekaeme, wer sein neues Ei schon ausgebruetet hat, ein zweites).
--   Teil 3  EINE Ergebniszeile:
--             vorher_vergab_abholen_eier  (Live-Funktion vor dieser Datei)
--             jetzt_vergibt_abholen_eier  -> MUSS true sein
--             nachgeholte_eier / an_wen   -> erwartet 10: 9x Stufe 20 + bagontr01 Stufe 10
--             funktionen_live             -> alle event_claim_tiers-Fassungen vorher (erwartet genau eine)
--
-- Komplett im Supabase-SQL-Editor ausfuehren. NOCH NICHT AUSGEFUEHRT.
-- ============================================================

-- ---------- Teil 0: Vorher-Zustand merken ----------
create table if not exists public.event_pass_fix_marker (
  id text primary key,
  ran_at timestamptz not null default now(),
  granted integer,
  before_has_eggs boolean,
  before_functions text
);
alter table public.event_pass_fix_marker enable row level security;
revoke all on public.event_pass_fix_marker from anon, authenticated;

do $$
begin
  if exists (select 1 from public.event_pass_fix_marker m where m.id = 'zwielicht-pass-fix-all-20261008') then
    return;
  end if;
  insert into public.event_pass_fix_marker (id, before_has_eggs, before_functions)
  values ('zwielicht-pass-fix-all-20261008',
    coalesce((select bool_or(position('species_eggs' in p.prosrc) > 0)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'event_claim_tiers'), false),
    (select string_agg(p.oid::regprocedure::text || case when position('species_eggs' in p.prosrc) > 0
                         then ' [mit Eiern]' else ' [OHNE Eier]' end, '; ' order by p.oid)
       from pg_proc p where p.proname = 'event_claim_tiers'));
end
$$;

-- ---------- Teil 1: Abholfunktion ----------
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
  v_sp text;
  v_i integer;
  v_egg uuid;
  v_egg_species text[] := '{}'::text[];
  v_egg_tiers integer[] := '{}'::integer[];
  v_eggs jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_event from public.special_events se where se.id = p_event_id;
  if not found then raise exception 'invalid_event'; end if;
  v_status := public.special_event_status_of(v_event.enabled, v_event.archived, v_event.announce_at, v_event.starts_at, v_event.ends_at);
  if v_status = 'HIDDEN' then raise exception 'invalid_event'; end if;
  -- Zeilensperre: zwei Tabs/Geraete holen nacheinander ab, der zweite sieht
  -- die Stufen schon als abgeholt (keine doppelten Eier/Ressourcen).
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
    -- Garantierte Eier einer festen Art (z.B. Zwielicht Stufe 10 = dayman):
    -- serverseitig angelegt, die Art steht in der Konfiguration, nie Zufall.
    for v_sp in select jsonb_array_elements_text(coalesce(v_rw->'species_eggs', '[]'::jsonb)) loop
      v_egg_species := array_append(v_egg_species, v_sp);
      v_egg_tiers := array_append(v_egg_tiers, v_t);
    end loop;
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
  -- Feste Arten-Eier: normale Arten (kein Einzelstueck) - der Ei-Schutz aus
  -- 20261004-08 bleibt aktiv (kein bkmp.trusted), eine Einzelstueck-Art in
  -- species_eggs wuerde also abgelehnt. Fehlt die Art, bricht alles ab und
  -- es wird NICHTS als abgeholt markiert (spaeter erneut abholbar).
  for v_i in 1 .. coalesce(array_length(v_egg_species, 1), 0) loop
    if not exists (select 1 from public.dragon_species ds where ds.id = v_egg_species[v_i]) then
      raise exception 'reward_species_missing';
    end if;
    insert into public.player_dragon_eggs (name_key, auth_user_id, species_id)
    values (v_state.name_key, v_uid, v_egg_species[v_i]) returning id into v_egg;
    v_eggs := v_eggs || jsonb_build_array(jsonb_build_object('id', v_egg, 'species_id', v_egg_species[v_i], 'tier', v_egg_tiers[v_i]));
  end loop;
  update public.player_event_progress p set tier_claimed = v_claimed, unlocks = v_unlocks, updated_at = now()
   where p.event_id = p_event_id and p.auth_user_id = v_uid;
  return jsonb_build_object('items', v_items, 'unlocks', to_jsonb(v_unlocks), 'eggs', v_eggs,
    'credited', jsonb_build_object('gold', v_gold, 'wood', v_wood, 'stone', v_stone, 'crystals', v_crystals,
      'essence', v_essence, 'fruit', v_fruit, 'meat', v_meat));
end;
$$;

revoke all on function public.event_claim_tiers(text) from public, anon;
grant execute on function public.event_claim_tiers(text) to authenticated;

-- ---------- Teil 2: fehlende Eier fuer alle Betroffenen (nur beim ersten Ausfuehren) ----------
create table if not exists public.event_tier_egg_catchup (
  event_id text not null,
  auth_user_id uuid not null,
  tier integer not null,
  species_id text not null,
  egg_id uuid,
  granted_at timestamptz not null default now(),
  primary key (event_id, auth_user_id, tier, species_id)
);
alter table public.event_tier_egg_catchup enable row level security;
revoke all on public.event_tier_egg_catchup from anon, authenticated;

do $$
declare
  r record;
  v_egg uuid;
  v_name text;
  v_granted integer := 0;
begin
  -- Sperrvermerk sperren; granted ist erst nach dem ersten vollstaendigen Lauf gesetzt.
  perform 1 from public.event_pass_fix_marker m
   where m.id = 'zwielicht-pass-fix-all-20261008' and m.granted is null
   for update;
  if not found then
    raise notice 'Teil 2 lief bereits - es wird nichts erneut vergeben.';
    return;
  end if;
  for r in
    select se.id as event_id, p.auth_user_id, p.name_key,
           (tj->>'tier')::integer as tier, sp.value as species_id
      from public.player_event_progress p
      join public.special_events se on se.id = p.event_id
     cross join lateral jsonb_array_elements(coalesce(se.config->'tiers', '[]'::jsonb)) tj
     cross join lateral jsonb_array_elements_text(coalesce(tj->'reward'->'species_eggs', '[]'::jsonb)) sp
     where (tj->>'tier')::integer = any(p.tier_claimed)
     order by p.auth_user_id, (tj->>'tier')::integer
  loop
    perform 1 from public.player_event_progress p2
     where p2.event_id = r.event_id and p2.auth_user_id = r.auth_user_id
       and r.tier = any(p2.tier_claimed)
     for update;
    if not found then continue; end if;
    perform 1 from public.dragon_species ds
     where ds.id = r.species_id
       and not coalesce(ds.unique_per_account, false) and ds.event_origin is null;
    if not found then continue; end if;
    perform 1 from public.event_tier_egg_catchup c
     where c.event_id = r.event_id and c.auth_user_id = r.auth_user_id
       and c.tier = r.tier and c.species_id = r.species_id;
    if found then continue; end if;
    perform 1 from public.player_dragon_eggs e
     where e.auth_user_id = r.auth_user_id and e.species_id = r.species_id;
    if found then continue; end if;

    v_name := coalesce(nullif(r.name_key, ''),
      (select ips.name_key from public.idle_player_state ips where ips.auth_user_id = r.auth_user_id), '');
    if v_name = '' then continue; end if;

    insert into public.player_dragon_eggs (name_key, auth_user_id, species_id)
    values (v_name, r.auth_user_id, r.species_id) returning id into v_egg;
    insert into public.event_tier_egg_catchup (event_id, auth_user_id, tier, species_id, egg_id)
    values (r.event_id, r.auth_user_id, r.tier, r.species_id, v_egg);
    v_granted := v_granted + 1;
  end loop;
  update public.event_pass_fix_marker set granted = v_granted where id = 'zwielicht-pass-fix-all-20261008';
  raise notice 'Zwielicht-Pass: % Ei(er) nachgeholt', v_granted;
end
$$;

-- ---------- Teil 3: Kontrolle (eine Zeile) ----------
select m.before_has_eggs as vorher_vergab_abholen_eier,
       position('species_eggs' in pg_get_functiondef('public.event_claim_tiers(text)'::regprocedure)) > 0
         as jetzt_vergibt_abholen_eier,
       m.granted as nachgeholte_eier,
       (select string_agg(coalesce(ps.name_key, c.auth_user_id::text) || ' (Stufe ' || c.tier || ')', ', '
                          order by c.tier, ps.name_key)
          from public.event_tier_egg_catchup c
          left join public.player_stats ps on ps.auth_user_id = c.auth_user_id
         where c.granted_at between m.ran_at - interval '1 minute' and m.ran_at + interval '10 minutes') as an_wen,
       m.before_functions as funktionen_live
  from public.event_pass_fix_marker m
 where m.id = 'zwielicht-pass-fix-all-20261008';
