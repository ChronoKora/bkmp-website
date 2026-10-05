/* ============================================================
   Bkmp - neue Zucht-Spezies "DerJannikHase" (Spieler-Vorgabe 05.10.2026:
   Ordner Desktop\Drache4 mit 1 Drachen, Ei/Baby/Jugendlich/Erwachsen,
   "Hier ist nochmal 1 Neuer Drache").

   Einordnung: EPISCH (schwarz-goldener Ritterdrache mit Ruestung, Schild und
   roter Fahne, ohne Effekt-Aura - passt zu Flinkerboy/CodeWizard). Der Spieler
   hat keine Seltenheit genannt. Falls der Drache LEGENDAER sein soll: nur
   'rarity' und die Werte-Spalten dieser einen Zeile tauschen (legendaer:
   'legendaer', 27000, 500000, 200, 6000, 50000, true, 4, 5).
   Die Schreibweise "DerJannikHase" stammt aus den Dateinamen - falls der Name
   anders geschrieben werden soll, nur die Spalte 'name' aendern.

   Werte 1:1 von den bisherigen epischen Arten (3 h Brutzeit, 2.000 Futter-EP,
   15.000 Kampf-EP, 3-4 Substats). egg_source='event' (kein Kampf-Drop),
   Verfuegbarkeit ausschliesslich ueber den rarity-gewichteten Ei-Dungeon-
   Wurf (bkmpDungeonRollEgg(), keine Extra-Verdrahtung noetig).

   Bilder: assets/dragons/breeding/{egg,baby,teen,adult}/derjannikhase.png
   (+ -web.png/-web.webp, 480px, via scripts/optimize-images.mjs). Alle 4
   Bilder lagen freigestellt vor (Alpha-Kanal, transparente Ecken) - keine
   Nachbearbeitung noetig. Originale auf 768px (Palette) verkleinert.

   sort_order 51: setzt hinter 20261005-dragon-species-drachen3.sql (47-50) fort.

   Folge fuer den Ei-Wurf: episch +1 Art (die bisherigen epischen Arten werden
   etwas seltener).

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (on conflict do update).
   ============================================================ */

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('derjannikhase', 'DerJannikHase', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/derjannikhase.png', 'assets/dragons/breeding/baby/derjannikhase.png', 'assets/dragons/breeding/teen/derjannikhase.png', 'assets/dragons/breeding/adult/derjannikhase.png', 51)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  source_dragon_id = excluded.source_dragon_id, egg_drop_chance = excluded.egg_drop_chance,
  brood_seconds = excluded.brood_seconds, sacrifice_gold = excluded.sacrifice_gold,
  sacrifice_crystals = excluded.sacrifice_crystals, growth_points_required = excluded.growth_points_required,
  battle_xp_required = excluded.battle_xp_required, is_multi_stat = excluded.is_multi_stat,
  sub_stat_count_min = excluded.sub_stat_count_min, sub_stat_count_max = excluded.sub_stat_count_max,
  egg_image = excluded.egg_image, baby_image = excluded.baby_image, teen_image = excluded.teen_image,
  adult_image = excluded.adult_image, sort_order = excluded.sort_order;
