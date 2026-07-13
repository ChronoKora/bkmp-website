-- Bkmp - Idle Drachen Dorf: Skilltree-Deckel anheben (Nutzerwunsch, 13.07.:
-- "Wir haben Leute auf lvl 700, Skilltree ist max und das im Early Game")
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Diagnose (per echter DB-Abfrage bestaetigt): der komplette Skilltree
-- (alle 5 Zweige, 42 Knoten) kostete bisher exakt 573 Skillpunkte insgesamt
-- (max_rank * cost_per_rank pro Knoten aufsummiert). Da jedes Level-Up
-- weiterhin genau +1 Skillpunkt gibt (siehe bkmpIdleAddXp in idledorf.js),
-- war der Baum bei den aktivsten Spielern schon um Level ~570-600 komplett
-- durch - jedes weitere Level (bei manchen inzwischen 680+) verpuffte
-- seitdem wirkungslos.
--
-- Fix: max_rank pro Knoten x4 (573 -> 2292 Skillpunkte insgesamt, deutlich
-- laengere Progression - durch die polynomielle XP-Kurve entspricht das in
-- echter Spielzeit sogar MEHR als nur 4x so lange), effect_value_per_rank
-- gleichzeitig durch 4 geteilt, damit die MAXIMAL erreichbare Staerke pro
-- Knoten UNVERAENDERT bleibt (kein zusaetzlicher Powercreep obendrauf,
-- reiner Weg dorthin wird laenger). Bereits gebankte, bisher wirkungslose
-- Skillpunkte werden dadurch automatisch wieder nutzbar - kein Datenverlust,
-- reine Neu-Skalierung der Knoten-Definitionen.
--
-- idempotent: mehrfaches Ausfuehren setzt lediglich dieselben Werte erneut.

update public.idle_skill_nodes set max_rank = 40, effect_value_per_rank = 1.25 where id = 'burg_leben';
update public.idle_skill_nodes set max_rank = 40, effect_value_per_rank = 1 where id = 'burg_verteidigung';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 0.38 where id = 'burg_schild';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 1.25 where id = 'burg_reparatur';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 1 where id = 'burg_mauern';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 1 where id = 'burg_wachen';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 1.5 where id = 'burg_bollwerk';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 1.25 where id = 'burg_eisentor';

update public.idle_skill_nodes set max_rank = 40, effect_value_per_rank = 0.75 where id = 'dorf_pfeilschaden';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 1 where id = 'dorf_angriffstempo';
update public.idle_skill_nodes set max_rank = 32, effect_value_per_rank = 0.38 where id = 'dorf_krit';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 1.5 where id = 'dorf_brandpfeile';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 0.25 where id = 'dorf_bogenschuetzen';
update public.idle_skill_nodes set max_rank = 12, effect_value_per_rank = 0.25 where id = 'dorf_ballisten';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 1 where id = 'dorf_meisterschuetzen';
update public.idle_skill_nodes set max_rank = 16, effect_value_per_rank = 1.25 where id = 'dorf_kriegshorn';
update public.idle_skill_nodes set max_rank = 32, effect_value_per_rank = 1 where id = 'dorf_klickkraft';

update public.idle_skill_nodes set max_rank = 40, effect_value_per_rank = 1 where id = 'forsch_xp';
update public.idle_skill_nodes set max_rank = 32, effect_value_per_rank = 0.75 where id = 'forsch_gold';
update public.idle_skill_nodes set max_rank = 32, effect_value_per_rank = 0.75 where id = 'forsch_loot';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 0.63 where id = 'forsch_drachenkunde';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 0.63 where id = 'forsch_alchemie';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 0.75 where id = 'forsch_kartografie';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 1 where id = 'forsch_meisterschmied';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 1.25 where id = 'forsch_archive';

update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 0.5 where id = 'magie_blitz';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 0.5 where id = 'magie_eis';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 0.5 where id = 'magie_feuer';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 0.63 where id = 'magie_heilung';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 0.75 where id = 'magie_resistenz';
update public.idle_skill_nodes set max_rank = 16, effect_value_per_rank = 0.75 where id = 'magie_meister';
update public.idle_skill_nodes set max_rank = 16, effect_value_per_rank = 0.75 where id = 'magie_erzmagier';
update public.idle_skill_nodes set max_rank = 12, effect_value_per_rank = 2 where id = 'magie_portal';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 1 where id = 'magie_runenglueck';

update public.idle_skill_nodes set max_rank = 40, effect_value_per_rank = 1 where id = 'wirt_gold';
update public.idle_skill_nodes set max_rank = 32, effect_value_per_rank = 1 where id = 'wirt_holz';
update public.idle_skill_nodes set max_rank = 32, effect_value_per_rank = 1 where id = 'wirt_stein';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 1.25 where id = 'wirt_offline';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 0.75 where id = 'wirt_handel';
update public.idle_skill_nodes set max_rank = 24, effect_value_per_rank = 0.75 where id = 'wirt_lager';
update public.idle_skill_nodes set max_rank = 20, effect_value_per_rank = 1.25 where id = 'wirt_schatzkammer';
update public.idle_skill_nodes set max_rank = 16, effect_value_per_rank = 1.25 where id = 'wirt_expedition';
