-- TestKora: alle "unbedenklichen" Erfolge/Titel/Kosmetiken freischalten.
-- Umfasst: Idle-Dorf (Level/Drachen/Bosse/Gold/Skillpunkte, alle 5
-- Skilltree-Zweige maximiert), Prestige 1-10, beide Event-Drachen
-- (Shenloss + Ganz Liber Drache), alle Pluschies, alle Easter Eggs,
-- Bonk-Zaehler, Zeit-/Tage-/Panel-Erfolge.
-- BEWUSST AUSGESCHLOSSEN: Karten/Kartenideen/Investoren-Eintraege
-- (waeren auf der echten Seite oeffentlich sichtbar), Feedback-Erfolge,
-- Streamer-Klicks und Daily-Event-Gewinne (rein lokal im Browser, nicht
-- serverseitig setzbar).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

-- 1) Idle-Dorf-Fortschritt + kompletter Skilltree (alle 5 Zweige maximiert,
--    skill_points_spent passend zur echten Kostensumme aller Knoten).
update public.idle_player_state
set
  dragon_kills = 5000,
  boss_kills = 50,
  level = 300,
  total_gold_earned = 1000000000,
  skill_points_spent = 553,
  skill_allocations = '{
    "burg_leben": 10, "burg_verteidigung": 10, "burg_schild": 5, "burg_reparatur": 5,
    "burg_mauern": 6, "burg_wachen": 6, "burg_bollwerk": 5, "burg_eisentor": 5,
    "dorf_pfeilschaden": 10, "dorf_angriffstempo": 5, "dorf_krit": 8, "dorf_brandpfeile": 5,
    "dorf_bogenschuetzen": 6, "dorf_ballisten": 3, "dorf_meisterschuetzen": 5, "dorf_kriegshorn": 4, "dorf_klickkraft": 8,
    "forsch_xp": 10, "forsch_gold": 8, "forsch_loot": 8, "forsch_drachenkunde": 6,
    "forsch_alchemie": 6, "forsch_kartografie": 5, "forsch_meisterschmied": 5, "forsch_archive": 5,
    "magie_blitz": 6, "magie_eis": 6, "magie_feuer": 6, "magie_heilung": 6,
    "magie_resistenz": 6, "magie_meister": 4, "magie_erzmagier": 4, "magie_portal": 3,
    "wirt_gold": 10, "wirt_holz": 8, "wirt_stein": 8, "wirt_offline": 6,
    "wirt_handel": 6, "wirt_lager": 6, "wirt_schatzkammer": 5, "wirt_expedition": 4
  }'::jsonb
where name_key = 'testkora';

-- 2) Prestige-Stufe 10 (alle 10 Prestige-Erfolge + Titel bis "Was ist Prestige?").
insert into public.idle_prestige_state (name_key, display_name, prestige_level, prestige_points, prestige_points_spent, prestige_allocations)
values ('testkora', 'TestKora', 10, 0, 0, '{}'::jsonb)
on conflict (name_key) do update set prestige_level = 10;

-- 3) Beide Event-Drachen als besiegt markieren (Sammlung-Titel).
insert into public.idle_event_dragon_state (name_key, display_name, shenloss_defeated, shenloss_defeated_at, liber_defeated, liber_defeated_at)
values ('testkora', 'TestKora', true, now(), true, now())
on conflict (name_key) do update set shenloss_defeated = true, shenloss_defeated_at = now(), liber_defeated = true, liber_defeated_at = now();

-- 4) Alle Pluschies freischalten (auch die beiden nur per Easter Egg/Raid
--    erreichbaren - fuer einen Test-Account ist das ausdruecklich gewollt).
insert into public.user_plushies (name_key, display_name, plushie_id)
select 'testkora', 'TestKora', id from public.plushies
on conflict (name_key, plushie_id) do nothing;

-- 5) Restliche Spieler-Statistiken: alle 12 Easter Eggs, Bonk-Zaehler,
--    Zeit/Tage/Panel-Oeffnen-Erfolge.
update public.player_stats
set
  eggs_found = '["bkmp","konami","drache","phil","creeper","diamond","matrix","idle","rainbow","derliber","jannik","adfree"]'::jsonb,
  bonk_count = 1000000,
  minutes_spent = 3000,
  panel_opens = 10,
  flags = flags || '{"nightOwl": true, "earlyBird": true, "visitedSaturday": true, "visitedSunday": true}'::jsonb,
  days_visited = (
    select jsonb_agg(to_char((current_date - (n || ' days')::interval)::date, 'YYYY-MM-DD'))
    from generate_series(0, 364) as n
  )
where name_key = 'testkora';
