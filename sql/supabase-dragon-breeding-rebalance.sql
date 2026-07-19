/* ============================================================
   Drachenzucht-Rebalance (Spieler-Feedback 15.07.: "Das ist ein
   Grind-Spiel" - Futter/Kampf-EP waren viel zu niedrig angesetzt,
   ein Drache war in unter 10 Minuten maximal entwickelt).

   Rechnung dahinter (grobe, aber begruendete Annahme - reale
   Kill-Rate schwankt stark je nach Spielerstaerke):
   - Kampf-EP: ~4 EP pro normalem Kill (bkmpDragonGrantCompanionBattleXp).
     Bei angenommenen ~300 Kills/Stunde aktivem Spielen = ~1.200 EP/Std.
     Zielwerte unten sind auf "X Stunden AKTIVES Kaempfen" ausgelegt:
     Standard ~2h, Selten ~5h, Episch ~12h, Legendaer ~40h.
   - Futter: Obstgarten/Jagdhuette produzieren 60/Std (Stufe 0) bis
     960/Std (Stufe 30, siehe BKMP_DRAGON_BASE_RESOURCE_PER_HOUR in
     idledorf.js). Zielwerte unten brauchen bei mittlerer Gebaeudestufe
     (~Stufe 10, 360/Std) grob dieselbe Groessenordnung an Zeit wie die
     EP-Ziele - laeuft aber PARALLEL zum Kaempfen, blockiert also nicht
     zusaetzlich.
   - Brutzeit: Spieler-Fokus lag explizit auf Futter/EP, nicht Brutzeit -
     hier nur ein moderater 1.5x-Aufschlag statt eines grossen Sprungs
     (reine Wartezeit ohne Spieler-Interaktion, soll nicht dominieren).
   - Opfergabe (nur Legendaer): 2x, damit auch das seltenste Ei nicht
     trivial ist fuer bereits wohlhabende Spieler.

   ACHTUNG: bereits laufende Baby-/Jugendlich-Drachen behalten ihren
   aktuellen Fortschritt (growth_points/battle_xp) - nur die Zielwerte
   steigen, sie brauchen ab jetzt also mehr Futter/EP bis zur naechsten
   Stufe. Das ist beabsichtigt (Balance-Patch), kein Datenverlust.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (setzt feste Werte, kein Zufall/Inkrement).
   ============================================================ */

-- Standard (Feuer-/Wasser-/Wind-/Blitzdrache): 30min -> 45min, 100 -> 500 Futter, 500 -> 2.500 EP
update public.dragon_species set brood_seconds = 2700, growth_points_required = 500, battle_xp_required = 2500
  where rarity = 'standard';

-- Selten (Aurelia-/Schatten-/Wuffdrache): 1h -> 1.5h, 150 -> 1.000 Futter, 800 -> 6.000 EP
update public.dragon_species set brood_seconds = 5400, growth_points_required = 1000, battle_xp_required = 6000
  where rarity = 'selten';

-- Episch (Kora-/Hakudrache): 2h -> 3h, 220 -> 2.000 Futter, 1.300 -> 15.000 EP
update public.dragon_species set brood_seconds = 10800, growth_points_required = 2000, battle_xp_required = 15000
  where rarity = 'episch';

-- Legendaer (Zerathor/Yakshadrache): 5h -> 7.5h, 320 -> 6.000 Futter, 2.200 -> 50.000 EP,
-- Opfergabe 250k/100 -> 500k/200
update public.dragon_species set brood_seconds = 27000, growth_points_required = 6000, battle_xp_required = 50000,
  sacrifice_gold = 500000, sacrifice_crystals = 200
  where rarity = 'legendaer';
