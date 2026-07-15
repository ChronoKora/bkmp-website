-- ============================================================
-- Test-Account "test123": vollen Zugriff auf ALLES zum Testen und
-- Ausprobieren. test123 ist bereits ueber BKMP_HIDDEN_TEST_ACCOUNTS
-- (supabase.js) aus jeder Rangliste ausgeblendet - dieses Skript aendert
-- nur die Fortschrittsdaten, nicht die Sichtbarkeits-Logik.
--
-- Umfasst: Idle-Dorf (Max-Level, Ressourcen, kompletter Skilltree ueber
-- ALLE aktiven Knoten dynamisch aus idle_skill_nodes, alle Upgrades),
-- Prestige (Stufe 50, alle 6 Knoten maximal), Runen (eine goldene +15-Rune
-- pro Slot, ausgeruestet), alle Dorf-Skins, alle Pluschies, beide
-- Event-Drachen (Shenloss + Ganz Liber Drache), Dungeon (alle 4
-- Schwierigkeiten voll geklaert), Arena-Rating, Weltboss-Raid-Statistik,
-- sowie alle 17 Easter Eggs + Bonk/Zeit/Tage/Panel/Wochenend-Erfolge.
--
-- BEWUSST NICHT gesetzt: Gilden-Mitgliedschaft (der Account bekommt
-- stattdessen genug Gold, um sich in Sekunden selbst eine Gilde zu
-- gruenden/maximieren - das automatisch zu erzwingen waere riskant, falls
-- der Account schon einer echten Gilde zum Testen beigetreten ist).
--
-- NICHT per SQL setzbar (leben ausschliesslich im Browser-localStorage,
-- keine DB-Spalte vorhanden, wirken sich auf keine Erfolge aus, nur auf
-- UI-Zustand): taegliche Login-Streak, Autobuy-Toggle, Feedback-Zaehler,
-- Streamer-Klicks, Daily-Event-Gewinne.
--
-- Voraussetzung: test123 muss bereits als echter Spieler-Account
-- registriert sein (mindestens einmal eingeloggt/gespielt) - siehe
-- Fehlermeldung unten, falls das noch nicht der Fall ist.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent, kann gefahrlos mehrfach ausgefuehrt werden.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from public.idle_player_state
    where name_key = 'test123' and auth_user_id is not null
  ) then
    raise exception 'test123 wurde nicht gefunden oder hat noch keinen verknuepften Login-Account. Zuerst auf der Seite registrieren und mindestens einmal im Kampf-Tab spielen, dann dieses Skript erneut ausfuehren.';
  end if;
end $$;

-- ----------------------------------------------------------
-- 1) Idle-Dorf: Max-Level, riesige Ressourcen (spendierbar, nicht nur
--    Lifetime-Zaehler), kompletter Skilltree ueber ALLE aktuell aktiven
--    Knoten (dynamisch aus idle_skill_nodes - bleibt auch dann korrekt,
--    wenn spaeter neue Knoten dazukommen), alle Upgrades auf Max-Stufe,
--    alle Zaehler fuer Achievement-Schwellen (Drachen/Bosse/Zerstoertes
--    Dorf/Yakshas Heimat/Runen-Erfolge).
-- ----------------------------------------------------------
update public.idle_player_state set
  level = 2000,
  xp = 999999999999,
  gold = 999999999999,
  wood = 999999999999,
  stone = 999999999999,
  crystals = 999999999999,
  essence = 999999999999,
  total_gold_earned = 999999999999,
  skill_points_available = 0,
  skill_points_spent = (select coalesce(sum(max_rank), 0) from public.idle_skill_nodes where active),
  skill_allocations = (select jsonb_object_agg(id, max_rank) from public.idle_skill_nodes where active),
  upgrade_purchases = jsonb_build_object('atk', 500, 'def', 500, 'hp', 500, 'walls', 500, 'crit', 100, 'crystal_gold', 100, 'essence_loot', 100),
  dragon_kills = 5000000,
  boss_kills = 500000,
  village_defeats = 20000,
  yaksha_boss_kills = 60000,
  rune_fuse_successes = 999999,
  rune_fuse_failures = 999999,
  rune_upgrade_successes = 999999,
  rune_upgrade_failures = 999999,
  active_village_skin = 'midasstadt',
  auto_advance = true
where name_key = 'test123';

-- ----------------------------------------------------------
-- 2) Prestige: hohe Stufe, alle 6 Prestige-Knoten auf Maximalrang
--    (Kosten 1+2+...+rank je Knoten, exakt berechnet).
-- ----------------------------------------------------------
insert into public.idle_prestige_state (name_key, display_name, prestige_level, prestige_points, prestige_points_spent, prestige_allocations)
values (
  'test123', 'test123', 50, 999999999, 1015,
  jsonb_build_object('ewiges_feuer', 20, 'drachenblut', 20, 'goldene_ranken', 20, 'zeitraffer', 20, 'kristallkern', 15, 'portal_meisterschaft', 10)
)
on conflict (name_key) do update set
  prestige_level = excluded.prestige_level,
  prestige_points = excluded.prestige_points,
  prestige_points_spent = excluded.prestige_points_spent,
  prestige_allocations = excluded.prestige_allocations;

-- ----------------------------------------------------------
-- 3) Runen: eine goldene, voll aufgewertete Rune (+15) in jedem der
--    6 Slots, alle ausgeruestet.
-- ----------------------------------------------------------
delete from public.idle_player_runes where name_key = 'test123';
insert into public.idle_player_runes (name_key, auth_user_id, rune_type, rarity, rolled_value, equipped, upgrade_level, substats)
select
  'test123',
  (select auth_user_id from public.idle_player_state where name_key = 'test123'),
  slot_id, 'gold', 25, true, 15, '[]'::jsonb
from unnest(array['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6']) as slot_id;

-- ----------------------------------------------------------
-- 4) Dorf-Skins: alle Skins aus dem Katalog freischalten.
-- ----------------------------------------------------------
insert into public.idle_player_village_skins (name_key, auth_user_id, skin_id)
select
  'test123',
  (select auth_user_id from public.idle_player_state where name_key = 'test123'),
  id
from public.idle_village_skins
where active
on conflict (auth_user_id, skin_id) do nothing;

-- ----------------------------------------------------------
-- 5) Alle Pluschies freischalten (auch die nur per Easter Egg/Raid
--    erreichbaren - fuer einen Test-Account ausdruecklich gewollt).
-- ----------------------------------------------------------
insert into public.user_plushies (name_key, display_name, plushie_id)
select 'test123', 'test123', id from public.plushies
on conflict (name_key, plushie_id) do nothing;

-- ----------------------------------------------------------
-- 6) Beide Event-Drachen als besiegt markieren (Sammlung-Titel).
-- ----------------------------------------------------------
insert into public.idle_event_dragon_state (name_key, display_name, shenloss_defeated, shenloss_defeated_at, liber_defeated, liber_defeated_at)
values ('test123', 'test123', true, now(), true, now())
on conflict (name_key) do update set
  shenloss_defeated = true, shenloss_defeated_at = now(),
  liber_defeated = true, liber_defeated_at = now();

-- ----------------------------------------------------------
-- 7) Dungeon: alle 4 Schwierigkeiten voll durchgespielt.
-- ----------------------------------------------------------
insert into public.idle_dungeon_results (name_key, display_name, difficulty_id, waves_cleared, time_ms)
select 'test123', 'test123', d, 100, 60000
from unnest(array['leicht', 'mittel', 'schwer', 'albtraum']) as d
on conflict (name_key, difficulty_id) do update set
  waves_cleared = excluded.waves_cleared,
  time_ms = excluded.time_ms;

-- ----------------------------------------------------------
-- 8) Arena: hohes Rating.
-- ----------------------------------------------------------
insert into public.arena_ratings (auth_user_id, name_key, display_name, rating, wins, losses)
select
  (select auth_user_id from public.idle_player_state where name_key = 'test123'),
  'test123', 'test123', 3000, 500, 0
on conflict (auth_user_id) do update set
  rating = excluded.rating, wins = excluded.wins, losses = excluded.losses;

-- ----------------------------------------------------------
-- 9) Weltboss-Raid: Teilnahme-/Schadensstatistik.
-- ----------------------------------------------------------
insert into public.raid_player_stats (auth_user_id, display_name, total_raids_joined, total_bosses_defeated, total_damage_dealt, total_mvp_count, total_flawless_wins, best_single_raid_damage)
select
  (select auth_user_id from public.idle_player_state where name_key = 'test123'),
  'test123', 200, 100, 999999999, 50, 20, 500000
on conflict (auth_user_id) do update set
  total_raids_joined = excluded.total_raids_joined,
  total_bosses_defeated = excluded.total_bosses_defeated,
  total_damage_dealt = excluded.total_damage_dealt,
  total_mvp_count = excluded.total_mvp_count,
  total_flawless_wins = excluded.total_flawless_wins,
  best_single_raid_damage = excluded.best_single_raid_damage;

-- ----------------------------------------------------------
-- 10) Meta-Fortschritt: alle 17 Easter Eggs, Bonk-Zaehler, Spielzeit,
--     Panel-Oeffnungen, Nacht-/Fruh-/Wochenend-Flags, ein volles Jahr an
--     Besuchstagen (fuer alle Tage-Besucht-Erfolgsstufen).
-- ----------------------------------------------------------
insert into public.player_stats (name_key, display_name, minutes_spent, achievements_unlocked, eggs_found, days_visited, flags, panel_opens, bonk_count)
values (
  'test123', 'test123', 200000, 250,
  '["bkmp","konami","drache","phil","creeper","diamond","matrix","idle","rainbow","derliber","jannik","adfree","sheep","penguin","zerathor","mouseshake","rightclick"]'::jsonb,
  (select jsonb_agg(to_char((current_date - (n || ' days')::interval)::date, 'YYYY-MM-DD')) from generate_series(0, 364) as n),
  '{"nightOwl": true, "earlyBird": true, "visitedSaturday": true, "visitedSunday": true}'::jsonb,
  999, 1000000
)
on conflict (name_key) do update set
  minutes_spent = excluded.minutes_spent,
  achievements_unlocked = excluded.achievements_unlocked,
  eggs_found = excluded.eggs_found,
  days_visited = excluded.days_visited,
  flags = player_stats.flags || excluded.flags,
  panel_opens = excluded.panel_opens,
  bonk_count = excluded.bonk_count;
