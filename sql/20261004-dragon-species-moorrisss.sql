/* ============================================================
   Bkmp - neue Zucht-Spezies "Moorrisss" (Spieler-Vorgabe 04.10.2026:
   Ordner "moorrisss" mit Ei/Baby/Jugendlich/Erwachsen, "das ist ein neuer
   Drache, bitte mit einbauen, episch").

   EPISCH, schwarz-weiss gemustert (Minecraft-Pixel-Look, passend zum
   bestehenden Moorrisss-Pluschie). Werte 1:1 von den bisherigen epischen
   Arten (byalex, danw, fynnow ...): Brutzeit 3 h, keine Opfergabe,
   2.000 Futter-EP, 15.000 Kampf-EP, 3-4 Substats, kein Multi-Stat.
   egg_source='event' (kein Kampf-Drop) - Verfuegbarkeit ausschliesslich ueber
   den rarity-gewichteten Ei-Dungeon-Wurf (bkmpDungeonRollEgg(), keine
   Extra-Verdrahtung noetig).

   Schreibweise: Name "Moorrisss" wie beim vorhandenen Plueschie und dem
   Ordnernamen (der Spieler heisst so). Falls er anders heissen soll, nur die
   Spalte 'name' dieser Zeile aendern (id/Bildpfade bleiben).

   Bilder: assets/dragons/breeding/{egg,baby,teen,adult}/moorrisss.png
   (+ -web.png/-web.webp, 480px, via scripts/optimize-images.mjs). Alle 4
   Bilder lagen freigestellt (Alpha-Kanal) vor; Originale auf 768px (Palette).

   sort_order 46: setzt hinter 20261003-dragon-species-dracheeeee.sql (42-45)
   fort (Lightnix/Darknix liegen bei 90/91).

   Reihenfolge: unabhaengig von den anderen Dateien ausfuehrbar.
   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (on conflict do update).
   ============================================================ */

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('moorrisss', 'Moorrisss', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/moorrisss.png', 'assets/dragons/breeding/baby/moorrisss.png', 'assets/dragons/breeding/teen/moorrisss.png', 'assets/dragons/breeding/adult/moorrisss.png', 46)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  source_dragon_id = excluded.source_dragon_id, egg_drop_chance = excluded.egg_drop_chance,
  brood_seconds = excluded.brood_seconds, sacrifice_gold = excluded.sacrifice_gold,
  sacrifice_crystals = excluded.sacrifice_crystals, growth_points_required = excluded.growth_points_required,
  battle_xp_required = excluded.battle_xp_required, is_multi_stat = excluded.is_multi_stat,
  sub_stat_count_min = excluded.sub_stat_count_min, sub_stat_count_max = excluded.sub_stat_count_max,
  egg_image = excluded.egg_image, baby_image = excluded.baby_image, teen_image = excluded.teen_image,
  adult_image = excluded.adult_image, sort_order = excluded.sort_order;
