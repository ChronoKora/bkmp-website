-- Bkmp - Idle Drachen Dorf: Ueberarbeitung (echte Sprite-Grafiken, neuer
-- Drachen-Roster, gentleres Balancing).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt komplett ausfuehren.
-- Baut auf supabase-idle-dorf-schema.sql auf (muss vorher gelaufen sein).

-- ============================================================
-- 1) idle_dragons: neue Spalten fuer Sprite + Spawn-Regel
-- ============================================================
alter table public.idle_dragons
  add column if not exists sprite_key text,
  add column if not exists spawn_rule text not null default 'standard'
    check (spawn_rule in ('standard', 'miniboss_10', 'boss_25', 'rare'));

-- ============================================================
-- 2) Alten Drachen-Roster ersetzen (kein Zyklus mehr ueber
--    tier_order, sondern echte Arten mit fester Rolle).
-- ============================================================
delete from public.idle_dragons;

insert into public.idle_dragons
  (id, name, emoji, sprite_key, spawn_rule, color_theme, tier_order, base_hp, base_attack, base_defense,
   gold_reward_base, xp_reward_base, wood_reward_base, stone_reward_base, crystal_reward_base, essence_reward_base, is_boss) values
  -- Standarddrachen (zufaellig auf normalen Ebenen)
  ('feuerdrache',    'Feuerdrache',    '🔥', 'feuerdrache',    'standard',     '#f97316', 0, 60, 7,  1, 6,  6,  2, 1, 0, 0, false),
  ('blitzdrache',    'Blitzdrache',    '⚡', 'blitzdrache',    'standard',     '#facc15', 1, 55, 8,  1, 6,  6,  1, 2, 0, 0, false),
  ('erddrache',      'Erddrache',      '🪨', 'erddrache',      'standard',     '#84cc16', 2, 70, 6,  3, 6,  6,  1, 3, 0, 0, false),
  ('wasserdrache',   'Wasserdrache',   '💧', 'wasserdrache',   'standard',     '#38bdf8', 3, 65, 6,  2, 6,  6,  2, 2, 0, 0, false),
  -- Miniboss: alle 10 Stufen
  ('yakshas-drache',  'Yakshas Drache', '🐲', 'yakshas-drache', 'miniboss_10', '#a78bfa', 4, 115, 10, 4, 14, 14, 3, 3, 2, 1, true),
  -- Boss: alle 25 Stufen, deutlich staerker
  ('yaksha-boss',      'Yaksha der Drachenboss', '👑', 'yaksha-boss', 'boss_25', '#ef4444', 5, 220, 16, 8, 28, 28, 5, 5, 5, 3, true),
  -- Seltene Zufallsbegegnungen (nie auf Boss-/Miniboss-Stufen)
  ('schattendrache',  'Schattendrache', '🌑', 'schattendrache', 'rare',        '#6b21a8', 6, 90, 10, 3, 12, 10, 2, 2, 1, 1, false),
  ('wuffdrache',       'Wuffdrache',     '🐾', 'wuffdrache',     'rare',        '#fbbf24', 7, 50, 5,  1, 10, 8,  1, 1, 1, 1, false)
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji, sprite_key = excluded.sprite_key, spawn_rule = excluded.spawn_rule,
  color_theme = excluded.color_theme, tier_order = excluded.tier_order, base_hp = excluded.base_hp,
  base_attack = excluded.base_attack, base_defense = excluded.base_defense, gold_reward_base = excluded.gold_reward_base,
  xp_reward_base = excluded.xp_reward_base, wood_reward_base = excluded.wood_reward_base, stone_reward_base = excluded.stone_reward_base,
  crystal_reward_base = excluded.crystal_reward_base, essence_reward_base = excluded.essence_reward_base, is_boss = excluded.is_boss;

-- ============================================================
-- 3) Balance-Werte: HP/Schaden wachsen deutlich langsamer,
--    dafuer eigene Boss-/Miniboss-Multiplikatoren + Rare-Chance.
-- ============================================================
insert into public.idle_game_config (key, value) values
  ('dragon_scaling', '{"hpGrowthPerKill":0.02,"atkGrowthPerKill":0.016}'::jsonb),
  ('reward_scaling', '{"goldGrowthPerKill":0.022,"xpGrowthPerKill":0.022}'::jsonb),
  ('boss_scaling', '{"minibossHpMult":1.8,"minibossAtkMult":1.3,"minibossRewardMult":2,"bossHpMult":3.2,"bossAtkMult":1.7,"bossRewardMult":4}'::jsonb),
  ('rare_spawn', '{"chancePct":8}'::jsonb)
on conflict (key) do update set value = excluded.value;

-- ============================================================
-- 4) Skilltree: Endstufen-Knoten (Kapazitaets-Skills) etwas teurer,
--    damit "frueh guenstig -> spaet teuer" noch deutlicher wird.
-- ============================================================
update public.idle_skill_nodes set cost_per_rank = 4 where id in ('dorf_ballisten', 'forsch_kartografie', 'magie_meister');
