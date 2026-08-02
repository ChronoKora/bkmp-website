/* ============================================================
   Bkmp - 6 neue Zucht-Spezies "NeueNeueDrachen" (Spieler-Vorgabe
   02.08.2026: "so kommen neue Drachen hinzu. Epische Drachen -> Fynnow
   Drache, Vulkarion Drache, Bloodterion Drache, Gravoryx Drache" +
   "Legendäre Drachen -> Lohendrache, Darknisdrache").

   Fynnow, Vulkarion, Bloodterion, Gravoryx: Episch, Werte 1:1 von der
   rebalancten Episch-Stufe uebernommen (siehe
   supabase-dragon-breeding-rebalance.sql, gleiches Muster wie
   supabase-dragon-species-neue-modelle.sql/-kowalski.sql/-obsidrache.sql).
   Lohendrache, Darknisdrache: Legendaer, Werte 1:1 von phil/zerathor/
   yakshadrache uebernommen (siehe supabase-dragon-species-neue-modelle.sql).

   egg_source='event' fuer alle 6 (kein Kampf-Drop, kein bestimmter
   Raidboss dahinter) - gleiches Muster wie alle bisherigen Batch-
   Ergaenzungen seit Kora-/Hakudrache. Verfuegbarkeit laeuft
   ausschliesslich ueber den rarity-gewichteten Ei-Dungeon-Wurf
   (bkmpDungeonRollEgg() waehlt jede aktive Spezies passender Seltenheit
   automatisch, keine Extra-Verdrahtung noetig).

   Bilder: assets/dragons/breeding/{egg,baby,teen,adult}/<id>.png -
   vom Nutzer als NeueNeueDrachen.zip geliefert (Ei-Dateien direkt im
   Wurzelordner, Baby/Jugentlich/erwachsen als Unterordner - anhand der
   Dateinamen 1:1 den 6 Namen zugeordnet, keine Ratearbeit noetig).
   Per scripts/optimize-images.mjs auf max. 480px verkleinert + WebP-
   Variante erzeugt (gleiches Verfahren wie bei allen anderen Zucht-
   Sprites, <picture>-Fallback via bkmpDragonThumbHtml()).

   sort_order setzt direkt hinter phil (17) fort: 18-23.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt
   ausfuehren. Idempotent (on conflict do update).
   ============================================================ */

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('fynnow', 'Fynnow', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/fynnow.png', 'assets/dragons/breeding/baby/fynnow.png', 'assets/dragons/breeding/teen/fynnow.png', 'assets/dragons/breeding/adult/fynnow.png', 18),
  ('vulkarion', 'Vulkarion', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/vulkarion.png', 'assets/dragons/breeding/baby/vulkarion.png', 'assets/dragons/breeding/teen/vulkarion.png', 'assets/dragons/breeding/adult/vulkarion.png', 19),
  ('bloodterion', 'Bloodterion', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/bloodterion.png', 'assets/dragons/breeding/baby/bloodterion.png', 'assets/dragons/breeding/teen/bloodterion.png', 'assets/dragons/breeding/adult/bloodterion.png', 20),
  ('gravoryx', 'Gravoryx', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/gravoryx.png', 'assets/dragons/breeding/baby/gravoryx.png', 'assets/dragons/breeding/teen/gravoryx.png', 'assets/dragons/breeding/adult/gravoryx.png', 21),
  ('lohendrache', 'Lohendrache', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/lohendrache.png', 'assets/dragons/breeding/baby/lohendrache.png', 'assets/dragons/breeding/teen/lohendrache.png', 'assets/dragons/breeding/adult/lohendrache.png', 22),
  ('darknisdrache', 'Darknisdrache', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/darknisdrache.png', 'assets/dragons/breeding/baby/darknisdrache.png', 'assets/dragons/breeding/teen/darknisdrache.png', 'assets/dragons/breeding/adult/darknisdrache.png', 23)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  source_dragon_id = excluded.source_dragon_id, egg_drop_chance = excluded.egg_drop_chance,
  brood_seconds = excluded.brood_seconds, sacrifice_gold = excluded.sacrifice_gold,
  sacrifice_crystals = excluded.sacrifice_crystals, growth_points_required = excluded.growth_points_required,
  battle_xp_required = excluded.battle_xp_required, is_multi_stat = excluded.is_multi_stat,
  sub_stat_count_min = excluded.sub_stat_count_min, sub_stat_count_max = excluded.sub_stat_count_max,
  egg_image = excluded.egg_image, baby_image = excluded.baby_image, teen_image = excluded.teen_image,
  adult_image = excluded.adult_image, sort_order = excluded.sort_order;
