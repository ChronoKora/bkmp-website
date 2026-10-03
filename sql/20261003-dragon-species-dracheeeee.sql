/* ============================================================
   Bkmp - 4 neue Zucht-Spezies "dracheeeee" (Spieler-Vorgabe 03.10.2026:
   Ordner mit 4 Drachen, je Ei/Baby/Jugendlich/Erwachsen, "so nochmal 4
   Drachen. selber wieder entscheiden").

   Einordnung nach dem Gesamteindruck der erwachsenen Form:
   - LEGENDAER (2): Ccatched (goldene Technik-Ruestung mit Leuchtkern),
     Sunnyyvi (holografischer Regenbogen mit Gold).
   - EPISCH (2): Byalex (Minecraft-Pixel-Look, blau/schwarz), Danw (blau/
     schwarz mit pinken Akzenten).
   Falls eine Art in die andere Stufe soll: nur 'rarity' + die Werte-Spalten
   der betreffenden Zeile tauschen. Die Schreibweise der Namen stammt aus den
   Dateinamen (alles klein geschrieben) - falls ein Name anders geschrieben
   werden soll (z.B. "ByAlex"), nur die Spalte 'name' dieser Zeile aendern.

   Werte 1:1 von den bisherigen Batches (episch: fynnow..gravoryx; legendaer:
   lohendrache/darknisdrache/phil). egg_source='event' (kein Kampf-Drop),
   Verfuegbarkeit ausschliesslich ueber den rarity-gewichteten Ei-Dungeon-
   Wurf (bkmpDungeonRollEgg(), keine Extra-Verdrahtung noetig).

   Bilder: assets/dragons/breeding/{egg,baby,teen,adult}/<id>.png (+ -web.png/
   -web.webp, 480px, via scripts/optimize-images.mjs). Alle 16 Bilder lagen
   freigestellt (Alpha-Kanal, transparente Raender) vor - keine Nachbearbeitung
   noetig. Originale auf 768px (Palette) verkleinert.

   sort_order: 42-45. Setzt hinter 20261003-dragon-species-neue-drachen2.sql
   (26-41) fort, damit beide Dateien in beliebiger Reihenfolge ausgefuehrt
   werden koennen, ohne dass sich die Reihenfolge ueberschneidet.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (on conflict do update).
   ============================================================ */

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('byalex', 'Byalex', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/byalex.png', 'assets/dragons/breeding/baby/byalex.png', 'assets/dragons/breeding/teen/byalex.png', 'assets/dragons/breeding/adult/byalex.png', 42),
  ('ccatched', 'Ccatched', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/ccatched.png', 'assets/dragons/breeding/baby/ccatched.png', 'assets/dragons/breeding/teen/ccatched.png', 'assets/dragons/breeding/adult/ccatched.png', 43),
  ('danw', 'Danw', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/danw.png', 'assets/dragons/breeding/baby/danw.png', 'assets/dragons/breeding/teen/danw.png', 'assets/dragons/breeding/adult/danw.png', 44),
  ('sunnyyvi', 'Sunnyyvi', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/sunnyyvi.png', 'assets/dragons/breeding/baby/sunnyyvi.png', 'assets/dragons/breeding/teen/sunnyyvi.png', 'assets/dragons/breeding/adult/sunnyyvi.png', 45)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  source_dragon_id = excluded.source_dragon_id, egg_drop_chance = excluded.egg_drop_chance,
  brood_seconds = excluded.brood_seconds, sacrifice_gold = excluded.sacrifice_gold,
  sacrifice_crystals = excluded.sacrifice_crystals, growth_points_required = excluded.growth_points_required,
  battle_xp_required = excluded.battle_xp_required, is_multi_stat = excluded.is_multi_stat,
  sub_stat_count_min = excluded.sub_stat_count_min, sub_stat_count_max = excluded.sub_stat_count_max,
  egg_image = excluded.egg_image, baby_image = excluded.baby_image, teen_image = excluded.teen_image,
  adult_image = excluded.adult_image, sort_order = excluded.sort_order;
