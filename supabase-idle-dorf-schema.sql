-- Bkmp - "Idle Drachen Dorf": Idle-Kampfspiel-Erweiterung des Gamification-Systems.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Vier neue Tabellen:
--   idle_dragons      - Drachen-Archetypen (Config, admin-editierbar, oeffentlich lesbar)
--   idle_skill_nodes  - Skilltree-Knoten (Config, admin-editierbar, oeffentlich lesbar)
--   idle_game_config  - Balance-Werte als Key/Value-JSON (Config, admin-editierbar, oeffentlich lesbar)
--   idle_player_state - Spielerfortschritt (offene RLS, gleiche Vertrauensstufe wie
--                        player_stats.bonk_count - kein Echtgeld-/Shop-Bezug, daher
--                        vertretbar; Offline-Fortschritt wird trotzdem serverseitig
--                        per api/claim-idle-offline-progress.js berechnet)
--
-- Folgt exakt dem bestehenden Muster aus supabase-plushies-schema.sql (Config-Tabellen)
-- und supabase-player-stats-schema.sql (offene Spielerfortschritts-Tabelle).

/* ---------------- idle_dragons ---------------- */
create table if not exists public.idle_dragons (
  id text primary key,
  name text not null,
  emoji text not null default '🐉',
  color_theme text not null default '#f59e0b',
  tier_order integer not null default 0,
  base_hp numeric not null default 100,
  base_attack numeric not null default 10,
  base_defense numeric not null default 0,
  gold_reward_base numeric not null default 5,
  xp_reward_base numeric not null default 5,
  wood_reward_base numeric not null default 2,
  stone_reward_base numeric not null default 2,
  crystal_reward_base numeric not null default 0,
  essence_reward_base numeric not null default 0,
  is_boss boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idle_dragons_tier_idx on public.idle_dragons (tier_order asc);

alter table public.idle_dragons enable row level security;
grant usage on schema public to anon, authenticated;
grant select on public.idle_dragons to anon, authenticated;
grant insert, update, delete on public.idle_dragons to authenticated;

drop policy if exists "Public read idle dragons" on public.idle_dragons;
create policy "Public read idle dragons" on public.idle_dragons for select to anon, authenticated using (true);

drop policy if exists "Admin write idle dragons" on public.idle_dragons;
create policy "Admin write idle dragons" on public.idle_dragons for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

/* ---------------- idle_skill_nodes ---------------- */
create table if not exists public.idle_skill_nodes (
  id text primary key,
  branch text not null check (branch in ('dorf', 'burg', 'wirtschaft', 'forschung', 'magie')),
  name text not null,
  description text not null default '',
  icon text not null default '',
  sort_order integer not null default 0,
  max_rank integer not null default 5,
  cost_per_rank integer not null default 1,
  requires_node_id text references public.idle_skill_nodes(id),
  requires_rank integer not null default 1,
  effect_type text not null,
  effect_value_per_rank numeric not null default 0,
  active boolean not null default true
);
create index if not exists idle_skill_nodes_branch_idx on public.idle_skill_nodes (branch, sort_order asc);

alter table public.idle_skill_nodes enable row level security;
grant select on public.idle_skill_nodes to anon, authenticated;
grant insert, update, delete on public.idle_skill_nodes to authenticated;

drop policy if exists "Public read idle skill nodes" on public.idle_skill_nodes;
create policy "Public read idle skill nodes" on public.idle_skill_nodes for select to anon, authenticated using (true);

drop policy if exists "Admin write idle skill nodes" on public.idle_skill_nodes;
create policy "Admin write idle skill nodes" on public.idle_skill_nodes for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

/* ---------------- idle_game_config ---------------- */
create table if not exists public.idle_game_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.idle_game_config enable row level security;
grant select on public.idle_game_config to anon, authenticated;
grant insert, update, delete on public.idle_game_config to authenticated;

drop policy if exists "Public read idle game config" on public.idle_game_config;
create policy "Public read idle game config" on public.idle_game_config for select to anon, authenticated using (true);

drop policy if exists "Admin write idle game config" on public.idle_game_config;
create policy "Admin write idle game config" on public.idle_game_config for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

/* ---------------- idle_player_state ---------------- */
create table if not exists public.idle_player_state (
  name_key text primary key,
  display_name text not null,
  level integer not null default 1,
  xp bigint not null default 0,
  gold bigint not null default 0,
  wood bigint not null default 0,
  stone bigint not null default 0,
  crystals bigint not null default 0,
  essence bigint not null default 0,
  total_gold_earned bigint not null default 0,
  attack numeric not null default 10,
  defense numeric not null default 2,
  hp numeric not null default 100,
  crit_chance numeric not null default 5,
  crit_damage numeric not null default 150,
  gold_bonus numeric not null default 0,
  xp_bonus numeric not null default 0,
  loot_bonus numeric not null default 0,
  skill_points_available integer not null default 0,
  skill_points_spent integer not null default 0,
  skill_allocations jsonb not null default '{}'::jsonb,
  upgrade_purchases jsonb not null default '{}'::jsonb,
  dragon_kills bigint not null default 0,
  boss_kills bigint not null default 0,
  current_dragon_index bigint not null default 0,
  playtime_seconds bigint not null default 0,
  last_seen_at timestamptz not null default now(),
  last_offline_claim jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.idle_player_state add column if not exists upgrade_purchases jsonb not null default '{}'::jsonb;
alter table public.idle_player_state add column if not exists total_gold_earned bigint not null default 0;
alter table public.idle_player_state add column if not exists boss_kills bigint not null default 0;

create index if not exists idle_player_state_level_idx on public.idle_player_state (level desc);
create index if not exists idle_player_state_gold_idx on public.idle_player_state (total_gold_earned desc);
create index if not exists idle_player_state_kills_idx on public.idle_player_state (dragon_kills desc);
create index if not exists idle_player_state_playtime_idx on public.idle_player_state (playtime_seconds desc);

alter table public.idle_player_state drop constraint if exists idle_player_state_level_check;
alter table public.idle_player_state add constraint idle_player_state_level_check check (level >= 1 and level <= 2000);
alter table public.idle_player_state drop constraint if exists idle_player_state_kills_check;
alter table public.idle_player_state add constraint idle_player_state_kills_check check (dragon_kills >= 0 and dragon_kills <= 5000000);

alter table public.idle_player_state enable row level security;
grant select, insert, update on public.idle_player_state to anon, authenticated;
grant delete on public.idle_player_state to authenticated;

drop policy if exists "Public read idle player state" on public.idle_player_state;
create policy "Public read idle player state" on public.idle_player_state for select to anon, authenticated using (true);

drop policy if exists "Public insert idle player state" on public.idle_player_state;
create policy "Public insert idle player state" on public.idle_player_state for insert to anon, authenticated with check (true);

drop policy if exists "Public update idle player state" on public.idle_player_state;
create policy "Public update idle player state" on public.idle_player_state for update to anon, authenticated using (true) with check (true);

drop policy if exists "Admin delete idle player state" on public.idle_player_state;
create policy "Admin delete idle player state" on public.idle_player_state for delete to authenticated using (public.is_active_admin());

/* ---------------- Seed-Daten: Config ---------------- */
insert into public.idle_game_config (key, value) values
  ('xp_curve', '{"base":40,"growth":1.42}'::jsonb),
  ('dragon_scaling', '{"hpGrowthPerKill":0.045,"atkGrowthPerKill":0.035,"bossEvery":10,"bossMultiplier":3}'::jsonb),
  ('reward_scaling', '{"goldGrowthPerKill":0.03,"xpGrowthPerKill":0.03}'::jsonb),
  ('offline_progress', '{"maxHours":12,"efficiencyPct":50}'::jsonb),
  ('base_stats', '{"attack":10,"defense":2,"hp":100,"critChance":5,"critDamage":150,"goldBonus":0,"xpBonus":0,"lootBonus":0}'::jsonb)
on conflict (key) do nothing;

/* ---------------- Seed-Daten: Drachen (10 Archetypen, zyklisch, unendlich per Skalierung) ---------------- */
insert into public.idle_dragons (id, name, emoji, color_theme, tier_order, base_hp, base_attack, base_defense, gold_reward_base, xp_reward_base, wood_reward_base, stone_reward_base, crystal_reward_base, essence_reward_base, is_boss) values
  ('wyrm_forest',   'Waldwyrm',          '🐉', '#4ade80', 0, 80,  8,  1, 5,  5,  3, 1, 0, 0, false),
  ('wyrm_stone',    'Steinwyrm',         '🐲', '#a8a29e', 1, 130, 12, 3, 7,  7,  2, 4, 0, 0, false),
  ('drake_flame',   'Flammendrache',     '🔥', '#f97316', 2, 200, 18, 2, 10, 10, 1, 1, 1, 0, false),
  ('drake_frost',   'Frostdrache',       '❄️', '#38bdf8', 3, 300, 24, 5, 14, 14, 1, 1, 1, 0, false),
  ('drake_storm',   'Sturmdrache',       '⚡', '#818cf8', 4, 420, 32, 4, 18, 18, 1, 1, 2, 0, false),
  ('boss_ancient',  'Uralter Wächter',   '🐲', '#facc15', 5, 900, 45, 10, 40, 40, 2, 2, 5, 1, true),
  ('drake_shadow',  'Schattendrache',    '🌑', '#6b21a8', 6, 560, 40, 6, 24, 24, 1, 1, 3, 1, false),
  ('drake_crystal', 'Kristalldrache',    '💎', '#67e8f9', 7, 700, 48, 8, 30, 30, 1, 1, 4, 1, false),
  ('drake_void',    'Leeredrache',       '🌌', '#4c1d95', 8, 860, 56, 10, 36, 36, 1, 1, 4, 2, false),
  ('boss_ruler',    'Herrscher der Lüfte','👑', '#ef4444', 9, 2000, 90, 18, 80, 80, 3, 3, 8, 3, true)
on conflict (id) do nothing;

/* ---------------- Seed-Daten: Skilltree (5 Zweige x 6 Knoten) ---------------- */
insert into public.idle_skill_nodes (id, branch, name, description, icon, sort_order, max_rank, cost_per_rank, requires_node_id, requires_rank, effect_type, effect_value_per_rank) values
  -- 🏹 Dorf
  ('dorf_pfeilschaden',    'dorf', 'Pfeilschaden',        'Erhöht den Schaden deiner Bogenschützen.', '🏹', 0, 10, 1, null, 1, 'attack_pct', 3),
  ('dorf_angriffstempo',   'dorf', 'Angriffsgeschwindigkeit', 'Deine Bogenschützen greifen schneller an.', '⏱️', 1, 5, 1, 'dorf_pfeilschaden', 3, 'attack_speed_pct', 4),
  ('dorf_krit',            'dorf', 'Kritische Treffer',   'Erhöht deine Chance auf kritische Treffer.', '🎯', 2, 8, 1, null, 1, 'crit_chance_pct', 1.5),
  ('dorf_brandpfeile',     'dorf', 'Brandpfeile',         'Deine Pfeile fügen zusätzlichen Schaden über Zeit zu.', '🔥', 3, 5, 2, 'dorf_krit', 4, 'crit_damage_pct', 6),
  ('dorf_bogenschuetzen',  'dorf', 'Mehr Bogenschützen',  'Rekrutiere zusätzliche Bogenschützen fürs Dorf.', '🧑‍🤝‍🧑', 4, 6, 2, 'dorf_angriffstempo', 3, 'extra_archer', 1),
  ('dorf_ballisten',       'dorf', 'Ballisten',           'Baue Ballisten für massiven Flächenschaden.', '🎡', 5, 3, 3, 'dorf_bogenschuetzen', 4, 'ballista_unlock', 1),
  -- 🏰 Burg
  ('burg_leben',           'burg', 'Mehr Leben',          'Erhöht die maximale Lebenspunkte des Dorfes.', '❤️', 0, 10, 1, null, 1, 'hp_pct', 5),
  ('burg_verteidigung',    'burg', 'Verteidigung',        'Erhöht die Verteidigung des Dorfes.', '🛡️', 1, 10, 1, null, 1, 'defense_pct', 4),
  ('burg_schild',          'burg', 'Schildgenerator',     'Regeneriert kontinuierlich einen Teil der Lebenspunkte.', '🔵', 2, 5, 2, 'burg_verteidigung', 4, 'shield_regen', 1.5),
  ('burg_reparatur',       'burg', 'Reparaturtempo',      'Beschädigte Gebäude werden schneller repariert.', '🔧', 3, 5, 2, 'burg_leben', 4, 'repair_speed_pct', 5),
  ('burg_mauern',          'burg', 'Verstärkte Mauern',   'Weitere Erhöhung der maximalen Lebenspunkte.', '🧱', 4, 6, 2, 'burg_schild', 3, 'hp_pct', 4),
  ('burg_wachen',          'burg', 'Torwachen',           'Zusätzliche Verteidigung durch aufmerksame Wachen.', '💂', 5, 6, 2, 'burg_reparatur', 3, 'defense_pct', 4),
  -- ⚒ Wirtschaft
  ('wirt_gold',            'wirtschaft', 'Goldproduktion', 'Erhöht das Gold, das du pro Drache erhältst.', '💰', 0, 10, 1, null, 1, 'gold_prod_pct', 4),
  ('wirt_holz',            'wirtschaft', 'Holzproduktion', 'Erhöht die Holz-Ausbeute.', '🪵', 1, 8, 1, null, 1, 'wood_prod_pct', 4),
  ('wirt_stein',           'wirtschaft', 'Steinproduktion', 'Erhöht die Stein-Ausbeute.', '🪨', 2, 8, 1, null, 1, 'stone_prod_pct', 4),
  ('wirt_offline',         'wirtschaft', 'Offline-Einnahmen', 'Erhöht die Effizienz deines Fortschritts während du weg bist.', '🌙', 3, 6, 2, 'wirt_gold', 4, 'offline_income_pct', 5),
  ('wirt_handel',          'wirtschaft', 'Handelsrouten',   'Weitere Steigerung der Goldproduktion.', '🚚', 4, 6, 2, 'wirt_holz', 3, 'gold_prod_pct', 3),
  ('wirt_lager',           'wirtschaft', 'Vorratslager',    'Weitere Steigerung der Rohstoffproduktion.', '📦', 5, 6, 2, 'wirt_stein', 3, 'wood_prod_pct', 3),
  -- 🐉 Forschung
  ('forsch_xp',            'forschung', 'Mehr XP',         'Erhöht die XP, die du pro Drache erhältst.', '📘', 0, 10, 1, null, 1, 'xp_pct', 4),
  ('forsch_gold',          'forschung', 'Mehr Gold',       'Weitere Steigerung der Gold-Belohnung.', '📗', 1, 8, 1, null, 1, 'gold_find_pct', 3),
  ('forsch_loot',          'forschung', 'Bessere Lootchance', 'Erhöht die Chance auf seltene Beute.', '🎁', 2, 8, 2, 'forsch_xp', 4, 'loot_chance_pct', 3),
  ('forsch_drachenkunde',  'forschung', 'Drachenkunde',    'Du verstehst Drachen besser und triffst gezielter.', '📖', 3, 6, 2, 'forsch_gold', 3, 'attack_pct', 2.5),
  ('forsch_alchemie',      'forschung', 'Alchemie',        'Wandelt Wissen in weitere Lootchance um.', '⚗️', 4, 6, 2, 'forsch_loot', 3, 'loot_chance_pct', 2.5),
  ('forsch_kartografie',   'forschung', 'Kartografie',     'Findet effizientere Wege zu neuen Drachen.', '🗺️', 5, 5, 3, 'forsch_drachenkunde', 3, 'xp_pct', 3),
  -- ✨ Magie
  ('magie_blitz',          'magie', 'Blitzschlag',        'Ruft gelegentlich einen Blitzschlag auf den Drachen.', '⚡', 0, 6, 2, null, 1, 'elem_lightning', 2),
  ('magie_eis',            'magie', 'Eis',                'Verlangsamt und schwächt den Drachen.', '❄️', 1, 6, 2, null, 1, 'elem_ice', 2),
  ('magie_feuer',          'magie', 'Feuer',              'Zusätzlicher Feuerschaden bei jedem Treffer.', '🔥', 2, 6, 2, null, 1, 'elem_fire', 2),
  ('magie_heilung',        'magie', 'Heilung',            'Heilt das Dorf regelmäßig ein wenig.', '💚', 3, 6, 2, 'magie_eis', 3, 'heal_pct', 2.5),
  ('magie_resistenz',      'magie', 'Magieresistenz',     'Reduziert erlittenen Schaden durch Drachenmagie.', '🔮', 4, 6, 2, 'magie_feuer', 3, 'magic_resist_pct', 3),
  ('magie_meister',        'magie', 'Magiemeister',       'Meisterschaft über alle Elemente.', '🌟', 5, 4, 3, 'magie_resistenz', 3, 'elem_fire', 3)
on conflict (id) do nothing;
