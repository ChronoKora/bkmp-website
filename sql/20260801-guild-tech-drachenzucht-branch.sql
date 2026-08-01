-- Gilden-Technologie v3: neuer Zweig "Drachenzucht" (01.08.2026)
-- Nutzerwunsch: "Eher ein kompletten Zweig für die Drachenzucht? Drachen
-- Angriff % Verteidung % Leben % etc?" - drei unabhaengige Wurzelknoten
-- (Angriff/Verteidigung/Leben des Begleitdrachens) + eine Zusammenfuehrung
-- ("Zuchtmeisterschaft", wirkt auf alle drei gleichzeitig).
--
-- Kein neues Datenmodell noetig - guild_tech_nodes/guild_tech_progress
-- (siehe sql/20260731-guild-tech-tree-v2-foundation.sql) sind bereits
-- generisch fuer beliebig viele Knoten gebaut. Reine Katalog-Erweiterung,
-- identisches Muster wie die Stufe-1/Stufe-2-Inserts dort (on conflict do
-- UPDATE ist hier bewusst korrekt, nicht "do nothing" - das gilt nur fuer
-- den einmaligen ALT-DATEN-Migrationsblock in der Foundation-Datei, nicht
-- fuer normale Katalog-Pflege).
--
-- Neue effect_type-Werte (kein Wiederverwenden aus dem alten System moeglich,
-- da diese drei Konzepte dort nicht existierten) - Konsument:
-- bkmpIdleDragonCompanionEffectTotals() in js/systems/bkmp-breeding.js.
-- Wirkt NUR, solange ein erwachsener Begleitdrache aktiv ist (identisches
-- Verhalten wie die bereits bestehenden Prestige-Gegenstuecke
-- companion_stat_pct/companion_dmg_pct/companion_all_stat_pct).

insert into public.guild_tech_nodes (id, category, label, description, icon, effect_type, effect_per_tier, max_tier, base_gold_cost, cost_growth, attempts_per_tier, prereq_node_ids, pos_x, pos_y)
values
  ('guild_zucht_kraft', 'schlacht', 'Zuchtkraft', '+8% Angriff deines Begleitdrachens pro Stufe (solange ein erwachsener Begleitdrache aktiv ist).', '🔥', 'guildCompanionAttackPct', 8, 5, 2000000, 1.5, 25, '{}', 800, 50),
  ('guild_zucht_panzer', 'schlacht', 'Zuchtpanzer', '+8% Verteidigung deines Begleitdrachens pro Stufe (solange ein erwachsener Begleitdrache aktiv ist).', '🛡️', 'guildCompanionDefensePct', 8, 5, 2000000, 1.5, 25, '{}', 1000, 50),
  ('guild_zucht_vitalitaet', 'schlacht', 'Zuchtvitalität', '+8% Leben deines Begleitdrachens pro Stufe (solange ein erwachsener Begleitdrache aktiv ist).', '❤️', 'guildCompanionHpPct', 8, 5, 2000000, 1.5, 25, '{}', 1200, 50),
  ('guild_zucht_meisterschaft', 'schlacht', 'Zuchtmeisterschaft', '+5% auf ALLE drei Begleitdrachen-Hauptwerte (Angriff/Verteidigung/Leben) gleichzeitig pro Stufe.', '🐲', 'guildCompanionAllStatPct', 5, 5, 3000000, 1.6, 25, array['guild_zucht_kraft','guild_zucht_panzer','guild_zucht_vitalitaet'], 1000, 200)
on conflict (id) do update set
  category = excluded.category, label = excluded.label, description = excluded.description, icon = excluded.icon,
  effect_type = excluded.effect_type, effect_per_tier = excluded.effect_per_tier, max_tier = excluded.max_tier,
  base_gold_cost = excluded.base_gold_cost, cost_growth = excluded.cost_growth, attempts_per_tier = excluded.attempts_per_tier,
  prereq_node_ids = excluded.prereq_node_ids, pos_x = excluded.pos_x, pos_y = excluded.pos_y;
