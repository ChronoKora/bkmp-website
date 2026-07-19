-- ============================================================
-- Bkmp - Skilltree-Zweig "Zucht" (Drachenzucht-System, siehe
-- supabase-dragon-breeding.sql). Verkuerzte Fassung der urspruenglich
-- vorgeschlagenen 8 Unter-Pfade: 8 verbundene Knoten statt 8 volle
-- Pfade a 4-8 Knoten, deckt aber jeden genannten Hebel ab (Fruechte-/
-- Fleisch-Produktion, Brutzeit, Drachen-EP, Ei-Fund-Chance, Lagerplaetze,
-- Nestkosten, Opfergaben-Rabatt).
--
-- WICHTIG: die urspruengliche idle_skill_nodes.branch-Check-Constraint
-- kannte nur 5 Zweige (dorf/burg/wirtschaft/forschung/magie) - als der
-- 6. Zweig "meister" ergaenzt wurde, wurde dieser Constraint nie
-- nachgezogen (siehe Kommentar in idledorf.js/BKMP_IDLE_BRANCH_ORDER).
-- Hier einmalig komplett neu gesetzt mit ALLEN 7 aktuellen Zweigen, damit
-- kuenftige Erweiterungen nicht denselben Fehler wiederholen.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent.
-- ============================================================

alter table public.idle_skill_nodes drop constraint if exists idle_skill_nodes_branch_check;
alter table public.idle_skill_nodes add constraint idle_skill_nodes_branch_check
  check (branch in ('dorf', 'burg', 'wirtschaft', 'forschung', 'magie', 'meister', 'zucht'));

insert into public.idle_skill_nodes (id, branch, name, description, icon, sort_order, max_rank, cost_per_rank, requires_node_id, requires_rank, effect_type, effect_value_per_rank) values
  ('zucht_obstgarten', 'zucht', 'Obstgarten-Pflege', '+2% Früchteproduktion pro Rang.', '🌳', 0, 20, 8, null, 0, 'fruit_prod_pct', 2),
  ('zucht_jagdhuette', 'zucht', 'Jagdhütten-Ausbildung', '+2% Fleischproduktion pro Rang.', '🥩', 1, 20, 8, null, 0, 'meat_prod_pct', 2),
  ('zucht_erfahrung', 'zucht', 'Drachentrainer', '+3% Kampferfahrung für Begleitdrachen pro Rang.', '⚔️', 2, 20, 8, null, 0, 'dragon_xp_pct', 3),
  ('zucht_brutzeit', 'zucht', 'Wärmelampen', '-1% Brutzeit pro Rang (max. 40% Reduktion).', '🔥', 3, 15, 12, 'zucht_obstgarten', 5, 'brood_time_pct', 1),
  ('zucht_eifund', 'zucht', 'Spürnase', '+2% relative Ei-Fund-Chance pro Rang.', '🔍', 4, 20, 10, 'zucht_erfahrung', 5, 'egg_chance_pct', 2),
  ('zucht_lagerplaetze', 'zucht', 'Drachenzwinger', '+1 Drachenlagerplatz pro Rang.', '🏠', 5, 15, 15, 'zucht_jagdhuette', 5, 'dragon_storage_flat', 1),
  ('zucht_nestkosten', 'zucht', 'Nestbaumeister', '-2% Kosten für neue Drachennester pro Rang (max. 40%).', '🔨', 6, 15, 14, 'zucht_brutzeit', 5, 'nest_cost_pct', 2),
  ('zucht_opfergabe', 'zucht', 'Ritualkenntnis', '-4% Opfergaben für legendäre Eier pro Rang (max. 50%).', '🐲', 7, 10, 20, 'zucht_eifund', 10, 'sacrifice_cost_pct', 4)
on conflict (id) do update set
  branch = excluded.branch, name = excluded.name, description = excluded.description, icon = excluded.icon,
  sort_order = excluded.sort_order, max_rank = excluded.max_rank, cost_per_rank = excluded.cost_per_rank,
  requires_node_id = excluded.requires_node_id, requires_rank = excluded.requires_rank,
  effect_type = excluded.effect_type, effect_value_per_rank = excluded.effect_value_per_rank;
