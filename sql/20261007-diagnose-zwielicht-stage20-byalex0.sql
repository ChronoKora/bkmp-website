-- ============================================================
-- DIAGNOSE (rein lesend, aendert NICHTS): Zwielicht-Pass Stufe 20 (Surebrec-Ei)
-- Meldung 07.10.2026: "byalex0 hat auf Stufe 20 KEIN Ei bekommen."
--
-- Oeffentlich sichtbar (geprueft per API): byalex0 besitzt weder ein Surebrec-Ei
-- noch einen Surebrec-Drachen; ein Dayman-Drache (Stufe-10-Ei) ist am 07.10.
-- 19:43 geschluepft. Ob Stufe 20 bei ihm als abgeholt gilt, steht in
-- player_event_progress.tier_claimed und ist von aussen NICHT lesbar - das
-- zeigt Abfrage 2.
--
-- Jede Abfrage einzeln markieren und mit Run ausfuehren.
-- Spielername unten ('byalex0') bei Bedarf ersetzen.
-- ============================================================

-- 1) Laufen LIVE die richtigen Funktionen/Schutz-Trigger?  Erwartet: true / true / true / true
select position('species_eggs' in pg_get_functiondef('public.event_claim_tiers(text)'::regprocedure)) > 0
         as abholen_kennt_species_eggs,
       position('bkmp.trusted' in pg_get_functiondef('public.event_choose_reward(text,text)'::regprocedure)) > 0
         as wahl_setzt_vertrauensflag,
       exists (select 1 from pg_trigger where tgname = 'player_dragon_eggs_event_guard_trg' and not tgisinternal)
         as ei_schutz_trigger_vorhanden,
       exists (select 1 from pg_trigger where tgname = 'player_dragons_unique_guard_trg' and not tgisinternal)
         as einzelstueck_trigger_vorhanden;

-- 2) Der Spieler: Punkte, erreichte Stufe, was ist abgeholt?
--    s20_abgeholt = true  UND  kein Surebrec-Ei  => Stufe 20 wurde als abgeholt markiert, ohne Ei
--                                                    (alte Funktion VOR dem Hotfix oder uebersprungen vom Nachhol-Lauf)
--    s20_abgeholt = false UND stufe_erreicht >= 20 => noch NICHT abgeholt: im Spiel "Abholen" druecken
--                                                    (Fehlermeldung dabei bitte notieren)
select p.name_key, p.points,
       floor(p.points / se.points_per_tier)::integer as stufe_erreicht,
       (10 = any(p.tier_claimed)) as s10_abgeholt,
       (20 = any(p.tier_claimed)) as s20_abgeholt,
       (30 = any(p.tier_claimed)) as s30_abgeholt,
       p.earned as stufe_30_erreicht, p.choice_species as gewaehlt, p.unlocks,
       p.tier_claimed, p.updated_at
  from public.player_event_progress p
  join public.special_events se on se.id = p.event_id
 where p.event_id = 'zwielicht' and p.name_key = 'byalex0';

-- 3) Hat der Nachhol-Lauf (20261005-zwielicht-pass-egg-catchup.sql) fuer ihn etwas angelegt?
select c.tier, c.species_id, c.egg_id, c.granted_at
  from public.event_tier_egg_catchup c
  join public.player_stats ps on ps.auth_user_id = c.auth_user_id
 where ps.name_key = 'byalex0'
 order by c.tier;

-- 4) Eier und Drachen der beiden Pass-Arten (jetziger Stand)
select 'ei' as art, e.species_id, e.created_at as zeitpunkt
  from public.player_dragon_eggs e
  join public.player_stats ps on ps.auth_user_id = e.auth_user_id
 where ps.name_key = 'byalex0' and e.species_id in ('dayman', 'surebrec')
union all
select 'drache (' || d.stage || ')', d.species_id, d.hatched_at
  from public.player_dragons d
  join public.player_stats ps on ps.auth_user_id = d.auth_user_id
 where ps.name_key = 'byalex0' and d.species_id in ('dayman', 'surebrec')
 order by 3;

-- 5) ALLE Spieler im selben Zustand: Stufe 10 bzw. 20 steht als abgeholt, aber
--    - nachgeholt  = false : der Nachhol-Lauf hat nichts fuer sie angelegt
--    - ei_jetzt    = false : sie besitzen aktuell kein Ei der Art
--    - drachen_seit_start  : Drachen der Art, die seit Eventstart geschluepft sind
--                            (Dayman/Surebrec fallen AUCH normal aus dem Ei-Dungeon -
--                             deshalb ueberspringt der allgemeine Nachhol-Lauf diese Spieler)
--    Eindeutig betroffen:  nachgeholt = false, ei_jetzt = false, drachen_seit_start = 0
--    Unklar (selbst entscheiden): nachgeholt = false, ei_jetzt = false, drachen_seit_start > 0
select p.name_key as spieler, t.tier as stufe, t.species_id as art,
       exists (select 1 from public.event_tier_egg_catchup c
                where c.event_id = p.event_id and c.auth_user_id = p.auth_user_id
                  and c.tier = t.tier and c.species_id = t.species_id) as nachgeholt,
       exists (select 1 from public.player_dragon_eggs e
                where e.auth_user_id = p.auth_user_id and e.species_id = t.species_id) as ei_jetzt,
       (select count(*) from public.player_dragons d
         where d.auth_user_id = p.auth_user_id and d.species_id = t.species_id
           and d.hatched_at >= coalesce(se.starts_at, '-infinity'::timestamptz)) as drachen_seit_start,
       p.points
  from public.player_event_progress p
  join public.special_events se on se.id = p.event_id
 cross join (values (10, 'dayman'), (20, 'surebrec')) as t(tier, species_id)
 where p.event_id = 'zwielicht' and t.tier = any(p.tier_claimed)
 order by t.tier, p.name_key;

-- 6) Zum Vergleich: wie viele Spieler sind auf welcher Stufe angekommen / haben abgeholt?
select count(*) filter (where floor(p.points / se.points_per_tier) >= 10) as stufe_10_erreicht,
       count(*) filter (where 10 = any(p.tier_claimed)) as stufe_10_abgeholt,
       count(*) filter (where floor(p.points / se.points_per_tier) >= 20) as stufe_20_erreicht,
       count(*) filter (where 20 = any(p.tier_claimed)) as stufe_20_abgeholt,
       count(*) filter (where p.earned) as stufe_30_erreicht,
       count(*) filter (where p.choice_species is not null) as stufe_30_gewaehlt
  from public.player_event_progress p
  join public.special_events se on se.id = p.event_id
 where p.event_id = 'zwielicht';
