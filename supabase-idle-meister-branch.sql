-- Bkmp - Idle Drachen Dorf: 6. Skilltree-Zweig "Meister" (Zwerg Grimbold)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Schaltet sich frei, sobald alle 5 Basis-Zweige (Dorf/Burg/Wirtschaft/
-- Forschung/Magie) komplett gemaxed sind (siehe bkmpIdleCountMaxedBranches
-- in idledorf.js - KEINE neue Spalte noetig, rein aus den bereits
-- vorhandenen skill_allocations abgeleitet). Bewusst kein neuer
-- "unlocked"-Flag in idle_player_state - nach dem Vorfall mit
-- dwarf_unlocked (SELECT auf nicht-existente Spalte, site-weiter
-- Ladefehler) haengt hier NICHTS am Laden/Speichern des Kern-Spielstands.
-- Ob die Grimbold-Dialogszene schon gesehen wurde, merkt sich der Browser
-- selbst per localStorage (wie der "Neu"-Badge-Mechanismus) - rein
-- kosmetisch, kein Sync-Risiko.
--
-- idempotent per "on conflict do nothing".

insert into public.idle_skill_nodes (id, branch, name, description, icon, sort_order, max_rank, cost_per_rank, requires_node_id, requires_rank, effect_type, effect_value_per_rank) values
  ('meister_amboss', 'meister', 'Der Amboss', '+1.2% Leben pro Rang - das Fundament jeder Zwergenschmiede.', '🔨', 0, 25, 6, null, 0, 'hp_pct', 1.2),
  ('meister_haemmern', 'meister', 'Kunstvolles Hämmern', '+1.2% Angriff pro Rang - jeder Schlag sitzt.', '⚒️', 1, 25, 7, 'meister_amboss', 5, 'attack_pct', 1.2),
  ('meister_legierung', 'meister', 'Zwergenlegierung', '+1.2% Verteidigung pro Rang - unter dem Berg gehärteter Stahl.', '🛡️', 2, 25, 6, 'meister_amboss', 5, 'defense_pct', 1.2),
  ('meister_goldader', 'meister', 'Goldader', '+1.2% Gold-Ausbeute pro Rang - Grimbold kennt jede Ader im Fels.', '💰', 3, 25, 7, 'meister_amboss', 5, 'gold_prod_pct', 1.2),
  ('meister_feuerklinge', 'meister', 'Feuerklingen', '+1.5% Kritischer Schaden pro Rang - im Höllenfeuer geschmiedet.', '🔥', 4, 20, 9, 'meister_haemmern', 10, 'crit_damage_pct', 1.5),
  ('meister_rubinschliff', 'meister', 'Rubinschliff', '+0.4% Krit-Chance pro Rang - ein Rubin im Knauf für den perfekten Treffer.', '💎', 5, 20, 9, 'meister_haemmern', 10, 'crit_chance_pct', 0.4),
  ('meister_runenschmiede', 'meister', 'Runenschmiede', '+1% Runenglück pro Rang - Zwergenrunen ziehen bessere Runen an.', '🔮', 6, 20, 10, 'meister_legierung', 10, 'rune_luck_pct', 1),
  ('meister_erbe', 'meister', 'Erbe der Berge', '+2% Angriff pro Rang - Grimbolds letztes und größtes Werk.', '👑', 7, 15, 15, 'meister_feuerklinge', 15, 'attack_pct', 2)
on conflict (id) do nothing;
