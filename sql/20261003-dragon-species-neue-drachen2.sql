/* ============================================================
   Bkmp - 16 neue Zucht-Spezies "neue drachen2" (Spieler-Vorgabe
   03.10.2026: Ordner mit 16 Drachen, je Ei/Baby/Jugendlich/Erwachsen,
   "Entscheide bitte selbst ob episch legendaer").

   Einordnung nach dem Gesamteindruck der erwachsenen Form (Aufwand der
   Gestaltung, Magie-/Kristall-/Elementeffekte, Gold-Verzierungen):
   - LEGENDAER (6): Almerio (Smaragd/Gold-Dorn-Drache), Alphorius (Navy/Gold
     mit grossem Kristall), MaxEnder (weiss/gold, Blumen-Zopf), Ronjawolf
     (weisser Gold-Kristall-Wolf), Tsheyn (Feuer + Eis), Vaelith (Galaxie).
   - EPISCH (10): Dayman, GrumpyJedi, Jodeljochen, Lukas, MiaTao, Randomauto,
     Scusy, StarManius, Troasa, Surebrec.
   Das ergibt zusammen mit dem Bestand 21 epische und 11 legendaere Arten
   (vorher 11/5); der Ei-Wurf waehlt erst die Seltenheit und dann
   gleichverteilt eine Art darin. Falls eine Art in die andere Stufe soll:
   nur 'rarity' + die Werte-Spalten der betreffenden Zeile tauschen.

   Werte 1:1 von den bisherigen Batches uebernommen (episch: siehe
   20260802-dragon-species-neue-neue-drachen.sql / fynnow..gravoryx;
   legendaer: lohendrache/darknisdrache/phil). egg_source='event' (kein
   Kampf-Drop). Verfuegbarkeit laeuft ausschliesslich ueber den rarity-
   gewichteten Ei-Dungeon-Wurf (bkmpDungeonRollEgg() nimmt jede aktive Art
   passender Seltenheit automatisch auf, keine Extra-Verdrahtung noetig).

   Bilder: assets/dragons/breeding/{egg,baby,teen,adult}/<id>.png (+ -web.png/
   -web.webp, 480px, via scripts/optimize-images.mjs). Alle 64 Bilder lagen
   freigestellt (Alpha) vor - AUSNAHME Scusy: alle 4 Stufen kamen mit grauem
   Verlaufs-Hintergrund + Bodenschatten ohne Alpha-Kanal und wurden per
   Flood-Fill vom Rand freigestellt (eingeschlossene Hintergrundflaechen
   zwischen Fluegel/Schwanz/Koerper gezielt mit entfernt, Fluegelmembranen
   bleiben). Originale auf 768px (Palette) verkleinert, die Detailansicht
   zeigt sie mit max. 160 CSS-Pixeln. Die Datei "MaiTao erwachsen.png" des
   Nutzers (Tippfehler) wurde als miatao zugeordnet.

   sort_order: live ist 25 (bagon) die hoechste - diese 16 setzen bei 26 fort.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (on conflict do update).
   ============================================================ */

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('almerio', 'Almerio', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/almerio.png', 'assets/dragons/breeding/baby/almerio.png', 'assets/dragons/breeding/teen/almerio.png', 'assets/dragons/breeding/adult/almerio.png', 26),
  ('alphorius', 'Alphorius', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/alphorius.png', 'assets/dragons/breeding/baby/alphorius.png', 'assets/dragons/breeding/teen/alphorius.png', 'assets/dragons/breeding/adult/alphorius.png', 27),
  ('dayman', 'Dayman', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/dayman.png', 'assets/dragons/breeding/baby/dayman.png', 'assets/dragons/breeding/teen/dayman.png', 'assets/dragons/breeding/adult/dayman.png', 28),
  ('grumpyjedi', 'GrumpyJedi', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/grumpyjedi.png', 'assets/dragons/breeding/baby/grumpyjedi.png', 'assets/dragons/breeding/teen/grumpyjedi.png', 'assets/dragons/breeding/adult/grumpyjedi.png', 29),
  ('jodeljochen', 'Jodeljochen', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/jodeljochen.png', 'assets/dragons/breeding/baby/jodeljochen.png', 'assets/dragons/breeding/teen/jodeljochen.png', 'assets/dragons/breeding/adult/jodeljochen.png', 30),
  ('lukas', 'Lukas', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/lukas.png', 'assets/dragons/breeding/baby/lukas.png', 'assets/dragons/breeding/teen/lukas.png', 'assets/dragons/breeding/adult/lukas.png', 31),
  ('maxender', 'MaxEnder', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/maxender.png', 'assets/dragons/breeding/baby/maxender.png', 'assets/dragons/breeding/teen/maxender.png', 'assets/dragons/breeding/adult/maxender.png', 32),
  ('miatao', 'MiaTao', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/miatao.png', 'assets/dragons/breeding/baby/miatao.png', 'assets/dragons/breeding/teen/miatao.png', 'assets/dragons/breeding/adult/miatao.png', 33),
  ('randomauto', 'Randomauto', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/randomauto.png', 'assets/dragons/breeding/baby/randomauto.png', 'assets/dragons/breeding/teen/randomauto.png', 'assets/dragons/breeding/adult/randomauto.png', 34),
  ('ronjawolf', 'Ronjawolf', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/ronjawolf.png', 'assets/dragons/breeding/baby/ronjawolf.png', 'assets/dragons/breeding/teen/ronjawolf.png', 'assets/dragons/breeding/adult/ronjawolf.png', 35),
  ('scusy', 'Scusy', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/scusy.png', 'assets/dragons/breeding/baby/scusy.png', 'assets/dragons/breeding/teen/scusy.png', 'assets/dragons/breeding/adult/scusy.png', 36),
  ('starmanius', 'StarManius', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/starmanius.png', 'assets/dragons/breeding/baby/starmanius.png', 'assets/dragons/breeding/teen/starmanius.png', 'assets/dragons/breeding/adult/starmanius.png', 37),
  ('troasa', 'Troasa', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/troasa.png', 'assets/dragons/breeding/baby/troasa.png', 'assets/dragons/breeding/teen/troasa.png', 'assets/dragons/breeding/adult/troasa.png', 38),
  ('tsheyn', 'Tsheyn', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/tsheyn.png', 'assets/dragons/breeding/baby/tsheyn.png', 'assets/dragons/breeding/teen/tsheyn.png', 'assets/dragons/breeding/adult/tsheyn.png', 39),
  ('vaelith', 'Vaelith', 'legendaer', 'event', null, 0, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/vaelith.png', 'assets/dragons/breeding/baby/vaelith.png', 'assets/dragons/breeding/teen/vaelith.png', 'assets/dragons/breeding/adult/vaelith.png', 40),
  ('surebrec', 'Surebrec', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/surebrec.png', 'assets/dragons/breeding/baby/surebrec.png', 'assets/dragons/breeding/teen/surebrec.png', 'assets/dragons/breeding/adult/surebrec.png', 41)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  source_dragon_id = excluded.source_dragon_id, egg_drop_chance = excluded.egg_drop_chance,
  brood_seconds = excluded.brood_seconds, sacrifice_gold = excluded.sacrifice_gold,
  sacrifice_crystals = excluded.sacrifice_crystals, growth_points_required = excluded.growth_points_required,
  battle_xp_required = excluded.battle_xp_required, is_multi_stat = excluded.is_multi_stat,
  sub_stat_count_min = excluded.sub_stat_count_min, sub_stat_count_max = excluded.sub_stat_count_max,
  egg_image = excluded.egg_image, baby_image = excluded.baby_image, teen_image = excluded.teen_image,
  adult_image = excluded.adult_image, sort_order = excluded.sort_order;
