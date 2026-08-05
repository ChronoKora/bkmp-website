/* ============================================================
   Bkmp - neue Zucht-Spezies "Bagondrache" (Spieler-Vorgabe 05.08.2026:
   4-stufiges Referenzbild Ei/Baby/Jugendlich/Erwachsen geliefert +
   "Das wäre ein Neuer Drache Episch. Kannst du das selber ausschnippeln?").

   Episch, Werte 1:1 von der rebalancten Episch-Stufe uebernommen (siehe
   supabase-dragon-breeding-rebalance.sql, gleiches Muster wie
   supabase-dragon-species-neue-modelle.sql/-kowalski.sql/-obsidrache.sql/
   20260802-dragon-species-neue-neue-drachen.sql).

   egg_source='event' (kein Kampf-Drop, kein bestimmter Raidboss dahinter) -
   gleiches Muster wie alle bisherigen Batch-Ergaenzungen seit Kora-/
   Hakudrache. Verfuegbarkeit laeuft ausschliesslich ueber den rarity-
   gewichteten Ei-Dungeon-Wurf (bkmpDungeonRollEgg() waehlt jede aktive
   Spezies passender Seltenheit automatisch, keine Extra-Verdrahtung noetig).

   Bilder: assets/dragons/breeding/{egg,baby,teen,adult}/bagondrache.png -
   vom Nutzer als EIN zusammengesetztes 4-Stufen-Referenzbild geliefert
   (1774x887px, grauer Flaechenhintergrund, Beschriftung je Stufe darunter) -
   per Node/sharp automatisiert in die 4 Einzelbilder zerlegt (Saettigungs-/
   Leuchtdichte-basierte Inhalts-Erkennung fuer die Spalten-/Zeilengrenzen,
   da der Hintergrund einen leichten Verlauf hat und keine feste Farbe zum
   direkten Colorkey war), Hintergrund + Beschriftungstext dabei entfernt
   (weicher Alpha-Verlauf an den Kanten statt hartem Ausschnitt), auf
   Bounding-Box zugeschnitten. Per Vorschau-Kontaktabzug visuell bestaetigt
   (saubere Freistellung, keine Grau-Reste, Schlagschatten/Steinsockel beim
   Ei blieb erhalten). Per scripts/optimize-images.mjs auf max. 480px
   verkleinert + WebP-Variante erzeugt (gleiches Verfahren wie alle anderen
   Zucht-Sprites, <picture>-Fallback via bkmpDragonThumbHtml()).

   sort_order setzt direkt hinter der letzten NeueNeueDrachen-Charge (23) fort: 24.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (on conflict do update).
   ============================================================ */

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('bagondrache', 'Bagondrache', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/bagondrache.png', 'assets/dragons/breeding/baby/bagondrache.png', 'assets/dragons/breeding/teen/bagondrache.png', 'assets/dragons/breeding/adult/bagondrache.png', 24)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  source_dragon_id = excluded.source_dragon_id, egg_drop_chance = excluded.egg_drop_chance,
  brood_seconds = excluded.brood_seconds, sacrifice_gold = excluded.sacrifice_gold,
  sacrifice_crystals = excluded.sacrifice_crystals, growth_points_required = excluded.growth_points_required,
  battle_xp_required = excluded.battle_xp_required, is_multi_stat = excluded.is_multi_stat,
  sub_stat_count_min = excluded.sub_stat_count_min, sub_stat_count_max = excluded.sub_stat_count_max,
  egg_image = excluded.egg_image, baby_image = excluded.baby_image, teen_image = excluded.teen_image,
  adult_image = excluded.adult_image, sort_order = excluded.sort_order;
