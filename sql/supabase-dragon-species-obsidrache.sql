/* ============================================================
   Bkmp - Neue Zucht-Spezies "Obsidrache" (Episch, nur per Event
   erhaeltlich - exakt gleiches Muster wie Koradrache/Hakudrache:
   egg_source='event', kein Kampf-Drop, source_dragon_id NULL. Die
   eigentliche Event-Verteilung (welches Event genau das Ei vergibt)
   wird laut Spieler-Ansage separat nachgereicht - bis dahin steht die
   Spezies bereit wie Kora-/Hakudrache es auch schon sind (per
   claim_epic_dragon_egg-RPC generisch abrufbar, sobald ein Event das
   aufruft).

   Werte uebernehmen 1:1 die bereits rebalancte Episch-Stufe (siehe
   supabase-dragon-breeding-rebalance.sql, 15.07.).

   Bilder: assets/dragons/breeding/{egg,baby,teen,adult}/obsidrache.png
   (Hintergrund per Flood-Fill transparent gemacht, gleiches Verfahren
   wie bei allen anderen Zucht-Sprites).

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (on conflict do update).
   ============================================================ */

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('obsidrache', 'Obsidrache', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/obsidrache.png', 'assets/dragons/breeding/baby/obsidrache.png', 'assets/dragons/breeding/teen/obsidrache.png', 'assets/dragons/breeding/adult/obsidrache.png', 11)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  source_dragon_id = excluded.source_dragon_id, egg_drop_chance = excluded.egg_drop_chance,
  brood_seconds = excluded.brood_seconds, sacrifice_gold = excluded.sacrifice_gold,
  sacrifice_crystals = excluded.sacrifice_crystals, growth_points_required = excluded.growth_points_required,
  battle_xp_required = excluded.battle_xp_required, is_multi_stat = excluded.is_multi_stat,
  sub_stat_count_min = excluded.sub_stat_count_min, sub_stat_count_max = excluded.sub_stat_count_max,
  egg_image = excluded.egg_image, baby_image = excluded.baby_image, teen_image = excluded.teen_image,
  adult_image = excluded.adult_image, sort_order = excluded.sort_order;
