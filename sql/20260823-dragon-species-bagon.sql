/* ============================================================
   Bkmp - neue Zucht-Spezies "Bagon" (Nutzer-Vorgabe 23.08.2026: 4-stufiges
   ChatGPT-generiertes Referenzbild Ei/Baby/Jugendlich/Erwachsen geliefert +
   "Wäre ein Neuer Drache... Schnippel mal das aus und zeige mir wie es
   aussieht" -> nach Freigabe des Ergebnisses: "Ja Mega! 'Bagon' ist der
   Name. Episch").

   Episch, Werte 1:1 von der aktuellen Episch-Stufe uebernommen (live gegen
   die echte DB geprueft: gravoryx/bloodterion/vulkarion, identisches
   Muster) - brood_seconds=10800, sacrifice_gold/crystals=0,
   growth_points_required=2000, battle_xp_required=15000, is_multi_stat=
   false, sub_stat_count 3-4. egg_source='event' (kein Kampf-Drop, gleiches
   Muster wie alle bisherigen Batch-Ergaenzungen).

   ⚠️ Namens-Hinweis (nicht blind uebersprungen, extra geprueft): es gibt
   bereits eine VORBEREITETE, NIE AUSGEFUEHRTE SQL-Datei fuer eine andere
   Spezies "Bagondrache" (sql/20260805-dragon-species-bagondrache.sql,
   id='bagondrache', komplett ANDERE Bilder - vom Nutzer per Foto-Collage
   geliefert statt dieses neuen ChatGPT-Bilds). Live-Check gegen die echte
   DB bestaetigt: weder 'bagondrache' noch 'bagon' existieren aktuell -
   kein technischer Konflikt. Bewusst id='bagon' (nicht 'bagondrache')
   gewaehlt, um die bereits auf der Platte liegenden bagondrache-Assets
   nicht zu ueberschreiben, falls die alte Datei irgendwann doch noch
   ausgefuehrt wird. sort_order=25 (nicht 24) aus demselben Grund - 24
   bleibt fuer die alte Datei reserviert.

   Bild-Herkunft: das Referenzbild (1774x887px, grauer Verlaufs-Hintergrund
   mit leichtem Farbverlauf oben->unten, Beschriftung je Stufe darunter) kam
   diesmal direkt aus dem Chat als Anhang (Dateiname "ChatGPT Image Aug 23,
   2026, 04_14_07 AM.png", automatisch in Downloads gesichert). Zerlegung
   in die 4 Panels per Spalten-/Zeilen-Abweichungsprofil (praezise auf x=368/
   674/1108 sowie y=721 fuer die Kunst/Beschriftungs-Grenze bestimmt, per
   Node/sharp). Freistellung per Flood-Fill von den Panel-Raendern - ERSTER
   Versuch (fester globaler Referenz-Vergleich gegen einen einzelnen Eckpixel)
   blieb beim Jugendlichen Drachen auf halbem Weg haengen (der Hintergrund
   hat einen echten, ca. 9-10 Werte pro Kanal starken Verlauf von oben nach
   unten - per Alpha-Kanal-Rendering DIREKT bewiesen, nicht nur vermutet:
   nur das obere Fuenftel wurde transparent, der Rest blieb faelschlich
   deckend). Fix: Nachbar-relativer Vergleich (jeder Kandidat-Pixel wird
   gegen den bereits bestaetigten Hintergrund-Pixel verglichen, der ihn in
   die Warteschlange zieht, nicht gegen einen einzelnen globalen Referenzwert)
   - laeuft dem Verlauf sauber hinterher. Per Kontaktabzug (Schachbrett-
   Transparenz-Hintergrund) UND per direktem Alpha-Kanal-Rendering
   (sauberes Drachen-Silhouetten-Ergebnis statt der vorherigen grossen
   deckenden Restflaeche) verifiziert - keine Grau-Reste, Horn/Schatten
   korrekt erhalten, keine durchloecherten Details.

   Bilder: assets/dragons/breeding/{egg,baby,teen,adult}/bagon.png (Original)
   + bagon-web.png/bagon-web.webp (480px, WebP-Qualitaet 82, per
   scripts/optimize-images.mjs, <picture>-Fallback via bkmpDragonThumbHtml()).
   Alle 12 Dateien per direktem HTTP-Abruf gegen den lokalen QA-Server
   verifiziert (200 OK, plausible Dateigroessen 15-81KB je -web-Variante).

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (on conflict do update).
   ============================================================ */

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('bagon', 'Bagon', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/bagon.png', 'assets/dragons/breeding/baby/bagon.png', 'assets/dragons/breeding/teen/bagon.png', 'assets/dragons/breeding/adult/bagon.png', 25)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  source_dragon_id = excluded.source_dragon_id, egg_drop_chance = excluded.egg_drop_chance,
  brood_seconds = excluded.brood_seconds, sacrifice_gold = excluded.sacrifice_gold,
  sacrifice_crystals = excluded.sacrifice_crystals, growth_points_required = excluded.growth_points_required,
  battle_xp_required = excluded.battle_xp_required, is_multi_stat = excluded.is_multi_stat,
  sub_stat_count_min = excluded.sub_stat_count_min, sub_stat_count_max = excluded.sub_stat_count_max,
  egg_image = excluded.egg_image, baby_image = excluded.baby_image, teen_image = excluded.teen_image,
  adult_image = excluded.adult_image, sort_order = excluded.sort_order;
