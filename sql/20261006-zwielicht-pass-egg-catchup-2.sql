-- ============================================================
-- Zwielicht-Pass: NACHHOL-LAUF 2 (06.10.2026) - 5 Spieler, die der erste
-- Nachhol-Lauf zu Unrecht uebersprungen hat.
--
-- Warum der erste Lauf (sql/20261005-zwielicht-pass-egg-catchup.sql) sie
-- uebersprungen hat: Er behandelt "Spieler hat ein Dayman-Ei / seit Eventstart
-- einen Dayman-Drachen geschluepft" als "hat das Pass-Ei schon bekommen". Dayman
-- ist aber AUCH im normalen Ei-Wurf (Dungeon u.a.), siehe bkmpDragonEggPoolEligible()
-- in js/systems/bkmp-breeding.js - schon vor dem Event sind Dayman-Drachen
-- geschluepft. Wer also zufaellig einen Dayman aus dem Dungeon hatte, bekam das
-- garantierte Stufe-10-Ei nicht nachgeholt.
--
-- BELEGT (live, 06.10.2026, rein lesend geprueft):
--   * Die 5 Spieler unten haben Stufe 10 abgeholt (stufe_10_abgeholt = true) und
--     stehen NICHT im Nachhol-Log (per_nachhol_sql_bekommen = false).
--   * Jeder von ihnen hat genau einen Dayman-Drachen, der am 05.10. zwischen
--     01:45 und 09:19 (Berlin) geschluepft ist - also VOR dem ersten Nachhol-Lauf
--     (05.10. 22:43 UTC) und VOR dem Hotfix an event_claim_tiers. Die damals
--     laufende alte Funktion hat nie ein Pass-Ei angelegt -> dieser Drache war
--     kein Pass-Ei, sondern stammt aus einem normalen Ei-Wurf.
--   * Die 3 Dayman-Drachen, die NACH Nachhol-Lauf 1 geschluepft sind, gehoeren
--     exakt zu 3 Spielern, die ihr Nachhol-Ei bekommen haben (Log = true).
--
-- Deshalb hier bewusst KEINE Regel "schon ein Ei/Drache der Art vorhanden ->
-- ueberspringen" (das war der Fehler), sondern eine EXPLIZITE Liste. Pro Spieler
-- wird beim Ausfuehren erneut geprueft: Stufe wirklich abgeholt, Art existiert und
-- ist kein Einzelstueck, noch nicht im Nachhol-Log. Danach steht der Eintrag im
-- Log (dieselbe Tabelle wie Lauf 1) -> beliebig oft ausfuehrbar, nie doppelt, und
-- Lauf 1 ueberspringt diese Spieler ebenfalls.
--
-- Voraussetzung: Hotfix sql/20261006-hotfix-event-claim-tiers-species-eggs.sql ist
-- eingespielt (ist es) - sonst waeren bereits abgeholte Stufen weiter betroffen.
-- Aendert NICHT: Event-Daten, Arten, Funktionen, Policies. Nur: Log-Tabelle
-- (falls noch nicht vorhanden) + je Spieler 1 Ei + 1 Log-Zeile.
-- NOCH NICHT AUSGEFUEHRT.
-- ============================================================

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
  c_names constant text[] := array['.egoistin', 'bärli', 'chronokora', 'frecheschaos', 'kaledoss'];
  r record;
  v_egg uuid;
  v_name text;
  v_granted integer := 0;
  v_seen text[] := '{}'::text[];
  v_missing text[];
begin
  for r in
    select se.id as event_id, p.auth_user_id, p.name_key,
           (tj->>'tier')::integer as tier, sp.value as species_id
      from public.player_event_progress p
      join public.special_events se on se.id = p.event_id
     cross join lateral jsonb_array_elements(coalesce(se.config->'tiers', '[]'::jsonb)) tj
     cross join lateral jsonb_array_elements_text(coalesce(tj->'reward'->'species_eggs', '[]'::jsonb)) sp
     where p.event_id = 'zwielicht'
       and p.name_key = any(c_names)
       and (tj->>'tier')::integer = any(p.tier_claimed)
     order by p.name_key, (tj->>'tier')::integer
  loop
    v_seen := array_append(v_seen, r.name_key);
    -- Spieler-Zeile sperren (wie event_claim_tiers) und "Stufe abgeholt" erneut pruefen.
    perform 1 from public.player_event_progress p2
     where p2.event_id = r.event_id and p2.auth_user_id = r.auth_user_id
       and r.tier = any(p2.tier_claimed)
     for update;
    if not found then continue; end if;
    -- Art muss existieren und ein normaler Ei-Wurf-Typ sein (Einzelstuecke
    -- laesst der Ei-Schutz nicht zu).
    perform 1 from public.dragon_species ds
     where ds.id = r.species_id
       and not coalesce(ds.unique_per_account, false) and ds.event_origin is null;
    if not found then continue; end if;
    -- schon nachgeholt (Lauf 1 oder dieser Lauf)?
    perform 1 from public.event_tier_egg_catchup c
     where c.event_id = r.event_id and c.auth_user_id = r.auth_user_id
       and c.tier = r.tier and c.species_id = r.species_id;
    if found then continue; end if;
    -- BEWUSST keine Pruefung auf vorhandene Eier/Drachen der Art (siehe oben).

    v_name := coalesce(nullif(r.name_key, ''),
      (select ips.name_key from public.idle_player_state ips where ips.auth_user_id = r.auth_user_id), '');
    if v_name = '' then continue; end if;

    insert into public.player_dragon_eggs (name_key, auth_user_id, species_id)
    values (v_name, r.auth_user_id, r.species_id) returning id into v_egg;
    insert into public.event_tier_egg_catchup (event_id, auth_user_id, tier, species_id, egg_id)
    values (r.event_id, r.auth_user_id, r.tier, r.species_id, v_egg);
    v_granted := v_granted + 1;
  end loop;

  select coalesce(array_agg(n order by n), '{}'::text[]) into v_missing
    from unnest(c_names) n where not (n = any(v_seen));
  raise notice 'Zwielicht-Pass Nachhol-Lauf 2: % Ei(er) vergeben. Ohne abgeholte Stufe mit Pass-Ei (nichts zu tun): %', v_granted, v_missing;
end
$$;

-- KONTROLLE (rein lesend): alle bisherigen Nachhol-Eintraege, neueste zuerst.
-- Erwartet nach dem ersten Lauf dieser Datei: 5 neue Zeilen (Stufe 10 / dayman) fuer
-- .egoistin, bärli, chronokora, frecheschaos, kaledoss, jeweils ei_noch_im_lager = 1.
select p.name_key as spieler, c.tier as stufe, c.species_id as art,
       c.granted_at at time zone 'Europe/Berlin' as vergeben_berlin,
       (select count(*) from public.player_dragon_eggs e where e.id = c.egg_id) as ei_noch_im_lager
  from public.event_tier_egg_catchup c
  join public.player_event_progress p on p.event_id = c.event_id and p.auth_user_id = c.auth_user_id
 order by c.granted_at desc, p.name_key;
