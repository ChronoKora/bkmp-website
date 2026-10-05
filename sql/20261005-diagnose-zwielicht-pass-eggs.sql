-- ============================================================
-- DIAGNOSE (rein lesend, aendert NICHTS): Zwielicht-Pass - fehlende
-- garantierte Eier (Stufe 10 = Dayman, Stufe 20 = Surebrec). 05.10.2026
--
-- Hintergrund: Die Faehigkeit "garantiertes Ei einer festen Art"
-- (reward.species_eggs) wurde in event_claim_tiers() erst NACH dem ersten
-- Einspielen von 20261004-06/-07 ergaenzt (Commit "Update Event Drachen",
-- 04.10.2026). Lief die Datenbank noch mit der alten Funktion, wurde Stufe 10
-- als abgeholt markiert, ohne dass ein Ei angelegt wurde - und die Stufe
-- kann danach nicht erneut abgeholt werden.
--
-- Jede Abfrage einzeln markieren und mit Run ausfuehren (oder alles auf
-- einmal - es werden nur die Ergebnisse angezeigt).
-- ============================================================

-- 1) Kennt die LIVE-Funktion die garantierten Arten-Eier?
--    false  => alte Funktion laeuft live: 20261004-06-special-events.sql erneut ausfuehren
select position('species_eggs' in pg_get_functiondef('public.event_claim_tiers(text)'::regprocedure)) > 0
       as funktion_kennt_species_eggs;

-- 2) Steht in der LIVE-Konfiguration auf Stufe 10 / 20 wirklich das Ei?
--    Erwartet: Stufe 10 -> {"species_eggs": ["dayman"], ...}, Stufe 20 -> ["surebrec"]
select (t->>'tier')::integer as stufe, t->'reward' as belohnung
  from public.special_events se, jsonb_array_elements(se.config->'tiers') t
 where se.id = 'zwielicht' and (t->>'tier')::integer in (10, 20)
 order by 1;

-- 3) Gibt es die beiden Arten live?  (fehlt eine => 'reward_species_missing' beim Abholen)
select id, name, rarity, egg_source, unique_per_account, event_origin
  from public.dragon_species where id in ('dayman', 'surebrec') order by id;

-- 4) Betroffene Spieler: Stufe abgeholt, aber weder ein Ei der Art im Lager/Nest
--    noch ein seit Eventstart geschluepfter Drache der Art.
select se.id as event, t.tier as stufe, t.species_id as art, p.name_key as spieler,
       p.points, p.tier_claimed
  from public.player_event_progress p
  join public.special_events se on se.id = p.event_id
 cross join lateral jsonb_array_elements(coalesce(se.config->'tiers', '[]'::jsonb)) tj
 cross join lateral (select (tj->>'tier')::integer as tier, sp.value as species_id
                       from jsonb_array_elements_text(coalesce(tj->'reward'->'species_eggs', '[]'::jsonb)) sp) t
 where t.tier = any(p.tier_claimed)
   and not exists (select 1 from public.player_dragon_eggs e
                    where e.auth_user_id = p.auth_user_id and e.species_id = t.species_id)
   and not exists (select 1 from public.player_dragons d
                    where d.auth_user_id = p.auth_user_id and d.species_id = t.species_id
                      and d.hatched_at >= coalesce(se.starts_at, '-infinity'::timestamptz))
 order by t.tier, p.name_key;

-- 5) Zum Vergleich: wie viele Spieler haben Stufe 10 / 20 abgeholt?
select count(*) filter (where 10 = any(tier_claimed)) as stufe_10_abgeholt,
       count(*) filter (where 20 = any(tier_claimed)) as stufe_20_abgeholt
  from public.player_event_progress where event_id = 'zwielicht';
