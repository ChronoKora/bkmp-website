-- Bkmp - Idle Drachen Dorf: Runen-Ausbau (Summoners-War-inspiriert)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Baut auf supabase-idle-runes.sql auf (idle_player_runes muss schon
-- existieren). Ergaenzt zwei Spalten fuer das neue Aufwertungssystem:
--   upgrade_level - 0 bis 15 ("+0" bis "+15"), erhoeht den Hauptwert der Rune
--   substats      - jsonb-Array von bis zu 4 Nebenwerten, z.B.
--                    [{"stat":"defense_pct","value":1.4}, ...]
-- Beides idempotent per "add column if not exists", kann also gefahrlos
-- mehrfach ausgefuehrt werden bzw. auch dann, wenn die Basistabelle bereits
-- laenger existiert.

alter table public.idle_player_runes
  add column if not exists upgrade_level smallint not null default 0;

alter table public.idle_player_runes
  add column if not exists substats jsonb not null default '[]'::jsonb;

alter table public.idle_player_runes
  drop constraint if exists idle_player_runes_upgrade_level_check;
alter table public.idle_player_runes
  add constraint idle_player_runes_upgrade_level_check
  check (upgrade_level >= 0 and upgrade_level <= 15) not valid;

-- ============================================================
-- Neuer Skilltree-Knoten (Zweig "magie"): erhoeht die Chance, dass ein
-- besiegter Drache ueberhaupt eine Rune fallen laesst (rune_luck_pct wird
-- von idledorf.js genau wie eine ausgeruestete Gluecksrune generisch in
-- bkmpIdleRecomputeEffectiveStats aufsummiert - effect_type ist bereits
-- 1:1 der Stat-Schluessel, keine weitere Verdrahtung noetig).
-- ============================================================
insert into public.idle_skill_nodes (id, branch, name, description, icon, sort_order, max_rank, cost_per_rank, requires_node_id, requires_rank, effect_type, effect_value_per_rank) values
  ('magie_runenglueck', 'magie', 'Runenglück', 'Ein magisches Gespür für verborgene Runen - erhöht die Chance auf bessere Seltenheitsstufen beim Runenfund, genau wie eine ausgerüstete Glücksrune.', '🔮', 8, 5, 4, 'magie_meister', 2, 'rune_luck_pct', 4)
on conflict (id) do nothing;
