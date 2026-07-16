-- ============================================================
-- Bkmp - Neue Kampf-Drachenart "Cyberdrache" (Spieler-Wunsch 18.07.:
-- "soll wie die anderen Drachen normal auftauchen").
--
-- spawn_rule 'standard' reiht sie in denselben Zufallspool wie Feuer-/
-- Blitz-/Erd-/Wasser-/Winddrache ein (siehe bkmpIdleSelectDragonKindId
-- in idledorf.js - tier_order beeinflusst dort nichts, nur die
-- Sortierung in Admin/Uebersichten). Werte an den Mittelwert der
-- bestehenden Standarddrachen angelehnt (base_hp 55-70, base_attack
-- 6-8, base_defense 1-3), keine neue Balance-Idee.
--
-- Bild: assets/dragons/cyberdrache.mp4 (echtes Video statt PNG-
-- Spritesheet, siehe BKMP_IDLE_VIDEO_DRAGON_SPRITES in idledorf.js -
-- rein clientseitig, braucht keine eigene Spalte in dieser Tabelle).
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent (on conflict do update).
-- ============================================================

insert into public.idle_dragons
  (id, name, emoji, sprite_key, spawn_rule, color_theme, tier_order, base_hp, base_attack, base_defense,
   gold_reward_base, xp_reward_base, wood_reward_base, stone_reward_base, crystal_reward_base, essence_reward_base, is_boss, active)
values
  ('cyberdrache', 'Cyberdrache', '🔷', 'cyberdrache', 'standard', '#22d3ee', 11, 62, 7, 2, 6, 6, 2, 1, 0, 0, false, true)
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji, sprite_key = excluded.sprite_key, spawn_rule = excluded.spawn_rule,
  color_theme = excluded.color_theme, tier_order = excluded.tier_order, base_hp = excluded.base_hp,
  base_attack = excluded.base_attack, base_defense = excluded.base_defense, gold_reward_base = excluded.gold_reward_base,
  xp_reward_base = excluded.xp_reward_base, wood_reward_base = excluded.wood_reward_base, stone_reward_base = excluded.stone_reward_base,
  crystal_reward_base = excluded.crystal_reward_base, essence_reward_base = excluded.essence_reward_base,
  is_boss = excluded.is_boss, active = excluded.active;
