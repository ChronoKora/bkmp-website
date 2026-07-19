/* ============================================================
   Bkmp - 5 neue Zucht-Spezies aus "Neue Modells" (Spieler-Vorgabe
   18.07.: "Hier sind neue Drachen.. Alle Episch, Phil ist Legendär").

   Byte, Enderdrachen, Kaledoss, Nytherion: Episch, Werte 1:1 von der
   rebalancten Episch-Stufe uebernommen (siehe
   supabase-dragon-breeding-rebalance.sql, gleiches Muster wie
   supabase-dragon-species-kowalski.sql/-obsidrache.sql).
   Phil: Legendaer, Werte 1:1 von zerathor/yakshadrache uebernommen
   (siehe supabase-dragon-breeding.sql).

   egg_source='event' fuer alle 5 (kein Kampf-Drop, kein bestimmter
   Raidboss dahinter) - gleiches Muster wie Kora-/Haku-/Obsi-/Kowalski-
   Drache. Wichtig: der "Dungeon-Wochenende"-Eventpool
   (BKMP_DUNGEON_EVENT_EGG_SPECIES), auf den die kowalski.sql-Datei noch
   verwies, existiert seit Dungeon-System 2.0 nicht mehr - egg_source
   ist hier nur noch informativ. Die eigentliche Verfuegbarkeit laeuft
   ausschliesslich ueber den rarity-gewichteten Ei-Dungeon-Wurf
   (bkmpDungeonRollEgg() waehlt jede aktive Spezies passender Seltenheit
   automatisch, keine Extra-Verdrahtung noetig).

   Bilder: assets/dragons/breeding/{egg,baby,teen,adult}/<id>.png -
   bereits mit transparentem Hintergrund geliefert (3D-Modell-Render,
   kein Flood-Fill noetig, per Pillow-Stichprobe geprueft: ~42%
   transparente Pixel bei den Rand-/Hintergrundbereichen).

   sort_order setzt direkt hinter kowalski (12) fort: 13-17.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt
   ausfuehren. Idempotent (on conflict do update).
   ============================================================ */

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('byte', 'Byte', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/byte.png', 'assets/dragons/breeding/baby/byte.png', 'assets/dragons/breeding/teen/byte.png', 'assets/dragons/breeding/adult/byte.png', 13),
  ('enderdrachen', 'Enderdrachen', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/enderdrachen.png', 'assets/dragons/breeding/baby/enderdrachen.png', 'assets/dragons/breeding/teen/enderdrachen.png', 'assets/dragons/breeding/adult/enderdrachen.png', 14),
  ('kaledoss', 'Kaledoss', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/kaledoss.png', 'assets/dragons/breeding/baby/kaledoss.png', 'assets/dragons/breeding/teen/kaledoss.png', 'assets/dragons/breeding/adult/kaledoss.png', 15),
  ('nytherion', 'Nytherion', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/nytherion.png', 'assets/dragons/breeding/baby/nytherion.png', 'assets/dragons/breeding/teen/nytherion.png', 'assets/dragons/breeding/adult/nytherion.png', 16),
  ('phil', 'Phil', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/phil.png', 'assets/dragons/breeding/baby/phil.png', 'assets/dragons/breeding/teen/phil.png', 'assets/dragons/breeding/adult/phil.png', 17)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  source_dragon_id = excluded.source_dragon_id, egg_drop_chance = excluded.egg_drop_chance,
  brood_seconds = excluded.brood_seconds, sacrifice_gold = excluded.sacrifice_gold,
  sacrifice_crystals = excluded.sacrifice_crystals, growth_points_required = excluded.growth_points_required,
  battle_xp_required = excluded.battle_xp_required, is_multi_stat = excluded.is_multi_stat,
  sub_stat_count_min = excluded.sub_stat_count_min, sub_stat_count_max = excluded.sub_stat_count_max,
  egg_image = excluded.egg_image, baby_image = excluded.baby_image, teen_image = excluded.teen_image,
  adult_image = excluded.adult_image, sort_order = excluded.sort_order;
