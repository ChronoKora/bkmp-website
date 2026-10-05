-- ============================================================
-- Zwielicht-Pass: garantierte Eier NACHHOLEN (05.10.2026)
--
-- Problem: Stufe 10 (Dayman-Ei) und Stufe 20 (Surebrec-Ei) werden von
-- event_claim_tiers() vergeben. Wurde eine Stufe abgeholt, WAEHREND live noch
-- die aeltere Fassung der Funktion lief (ohne reward.species_eggs), steht die
-- Stufe als abgeholt in player_event_progress.tier_claimed - das Ei wurde aber
-- nie angelegt, und erneutes Abholen ueberspringt die Stufe.
--
-- REIHENFOLGE (wichtig):
--   1. sql/20261004-06-special-events.sql  erneut ausfuehren (neue Funktion
--      event_claim_tiers mit species_eggs; idempotent)
--   2. sql/20261004-07-zwielicht-event.sql erneut ausfuehren (Stufen-Konfiguration
--      mit species_eggs; idempotent, bricht ab wenn dayman/surebrec fehlen ->
--      dann zuerst 20261003-dragon-species-neue-drachen2.sql)
--   3. DIESE Datei
--   Vorher optional sql/20261005-diagnose-zwielicht-pass-eggs.sql (rein lesend).
--
-- Vergeben wird je (Spieler, Stufe, Art) hoechstens EIN Ei, nur wenn
--   * die Stufe wirklich als abgeholt markiert ist,
--   * die Konfiguration fuer diese Stufe species_eggs enthaelt,
--   * die Art existiert und KEIN Einzelstueck/Event-Drache ist,
--   * noch kein Nachhol-Eintrag existiert (Log-Tabelle -> beliebig oft ausfuehrbar),
--   * der Spieler aktuell KEIN Ei dieser Art besitzt und seit Eventstart auch
--     keinen Drachen dieser Art geschluepft hat (konservativ gegen Doppelvergabe -
--     wer das Ei schon bekommen und verwendet hat, bekommt kein zweites).
-- Idempotent. NOCH NICHT AUSGEFUEHRT.
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
  r record;
  v_egg uuid;
  v_name text;
  v_granted integer := 0;
begin
  for r in
    select se.id as event_id, se.starts_at, p.auth_user_id, p.name_key,
           (tj->>'tier')::integer as tier, sp.value as species_id
      from public.player_event_progress p
      join public.special_events se on se.id = p.event_id
     cross join lateral jsonb_array_elements(coalesce(se.config->'tiers', '[]'::jsonb)) tj
     cross join lateral jsonb_array_elements_text(coalesce(tj->'reward'->'species_eggs', '[]'::jsonb)) sp
     where (tj->>'tier')::integer = any(p.tier_claimed)
     order by p.auth_user_id, (tj->>'tier')::integer
  loop
    -- Spieler-Zeile sperren (wie event_claim_tiers) und Bedingungen erneut pruefen.
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
    -- schon nachgeholt?
    perform 1 from public.event_tier_egg_catchup c
     where c.event_id = r.event_id and c.auth_user_id = r.auth_user_id
       and c.tier = r.tier and c.species_id = r.species_id;
    if found then continue; end if;
    -- besitzt der Spieler das Ei bzw. einen seit Eventstart geschluepften Drachen?
    perform 1 from public.player_dragon_eggs e
     where e.auth_user_id = r.auth_user_id and e.species_id = r.species_id;
    if found then continue; end if;
    perform 1 from public.player_dragons d
     where d.auth_user_id = r.auth_user_id and d.species_id = r.species_id
       and d.hatched_at >= coalesce(r.starts_at, '-infinity'::timestamptz);
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
  raise notice 'Zwielicht-Pass Nachhol-Eier vergeben: %', v_granted;
end
$$;

-- Kontrolle: was wurde nachgeholt?
select c.event_id, c.tier, c.species_id, c.auth_user_id, c.egg_id, c.granted_at
  from public.event_tier_egg_catchup c order by c.granted_at, c.tier;
