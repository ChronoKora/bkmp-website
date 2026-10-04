/* ============================================================
   Bkmp - 4 neue Zucht-Spezies "Drachen3" (Spieler-Vorgabe 05.10.2026:
   Ordner Desktop\Drachen3 mit 4 Drachen, je Ei/Baby/Jugendlich/Erwachsen,
   "Wuchi Muecke Legendaer und Flinkerboy CodeWizard Episch").

   Einordnung vom Spieler vorgegeben:
   - LEGENDAER (2): Wuchi (Eishockey-Eisdrache, blau/rot/gold),
     Muecke (silber/schwarze Libellen-Fluegel).
   - EPISCH (2): Flinkerboy (braun/creme, goldene Kanten),
     CodeWizard (rot/gold, Magier-Robe mit Feuerkugel).
   Die Schreibweise der Namen stammt aus den Dateinamen - falls ein Name anders
   geschrieben werden soll (z.B. "Mücke" statt "Muecke"), nur die Spalte 'name'
   der betreffenden Zeile aendern.

   Werte 1:1 von den bisherigen Batches (episch: fynnow..danw, moorrisss;
   legendaer: lohendrache/darknisdrache/ccatched/sunnyyvi). egg_source='event'
   (kein Kampf-Drop), Verfuegbarkeit ausschliesslich ueber den rarity-
   gewichteten Ei-Dungeon-Wurf (bkmpDungeonRollEgg(), keine Extra-Verdrahtung
   noetig).

   Bilder: assets/dragons/breeding/{egg,baby,teen,adult}/<id>.png (+ -web.png/
   -web.webp, 480px, via scripts/optimize-images.mjs). Alle 16 Bilder lagen
   freigestellt vor (Alpha-Kanal, transparente Ecken) - keine Nachbearbeitung
   noetig. Originale auf 768px (Palette) verkleinert.

   sort_order: 47-50. Setzt hinter 20261004-dragon-species-moorrisss.sql (46)
   fort.

   Folge fuer den Ei-Wurf: die Seltenheit wird zuerst gewuerfelt, dann
   gleichverteilt eine Art darin - die bisherigen Arten werden dadurch jeweils
   etwas seltener (episch +2 Arten, legendaer +2 Arten).

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (on conflict do update).
   ============================================================ */

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('wuchi', 'Wuchi', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/wuchi.png', 'assets/dragons/breeding/baby/wuchi.png', 'assets/dragons/breeding/teen/wuchi.png', 'assets/dragons/breeding/adult/wuchi.png', 47),
  ('muecke', 'Muecke', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/muecke.png', 'assets/dragons/breeding/baby/muecke.png', 'assets/dragons/breeding/teen/muecke.png', 'assets/dragons/breeding/adult/muecke.png', 48),
  ('flinkerboy', 'Flinkerboy', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/flinkerboy.png', 'assets/dragons/breeding/baby/flinkerboy.png', 'assets/dragons/breeding/teen/flinkerboy.png', 'assets/dragons/breeding/adult/flinkerboy.png', 49),
  ('codewizard', 'CodeWizard', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/codewizard.png', 'assets/dragons/breeding/baby/codewizard.png', 'assets/dragons/breeding/teen/codewizard.png', 'assets/dragons/breeding/adult/codewizard.png', 50)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  source_dragon_id = excluded.source_dragon_id, egg_drop_chance = excluded.egg_drop_chance,
  brood_seconds = excluded.brood_seconds, sacrifice_gold = excluded.sacrifice_gold,
  sacrifice_crystals = excluded.sacrifice_crystals, growth_points_required = excluded.growth_points_required,
  battle_xp_required = excluded.battle_xp_required, is_multi_stat = excluded.is_multi_stat,
  sub_stat_count_min = excluded.sub_stat_count_min, sub_stat_count_max = excluded.sub_stat_count_max,
  egg_image = excluded.egg_image, baby_image = excluded.baby_image, teen_image = excluded.teen_image,
  adult_image = excluded.adult_image, sort_order = excluded.sort_order;
