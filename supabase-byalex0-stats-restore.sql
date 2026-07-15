-- ============================================================
-- Wiederherstellung der Bestenlisten-Werte fuer ByAlex0 nach dem
-- versehentlichen Reset seines Idle-Dorf-Spielstands (17.07.,
-- verursacht durch einen Account-Wechsel auf dem Handy - Ursache
-- inzwischen behoben, siehe mcAuthSubmitHandler in index.html).
--
-- Prestige-Stufe (8), Runen (4069) und alle Erfolge lagen bereits in
-- eigenen Tabellen und waren nie betroffen - dieses Skript setzt nur
-- die vom Nutzer genannten Bestenlisten-Werte in idle_player_state
-- zurueck. Exakte alte Werte fuer Gold-Kontostand, Skillpunkte,
-- Upgrades, Runen-Ausruestung usw. lassen sich NICHT rekonstruieren
-- (kein Aenderungsverlauf fuer diese Tabelle) - dieses Skript
-- beschraenkt sich bewusst auf die 5 explizit genannten Werte.
--
-- "Insgesamt erreichte Stufen" (siehe bkmpIdleLifetimeStageCount in
-- idledorf.js) = prestige_stage_offset + highest_dragon_index. Da
-- prestige_stage_offset hier 0 ist, wird highest_dragon_index direkt
-- auf 3900 gesetzt. current_dragon_index wird auf denselben Wert
-- gesetzt, damit der Spieler beim naechsten Login an seiner
-- weitesten erreichten Stufe weiterspielt (auto_advance war bereits
-- true).
--
-- "Daily Streak" wird NICHT gesetzt - dieser Wert liegt rein
-- clientseitig in localStorage (siehe BKMP_IDLE_STREAK_KEY in
-- idledorf.js), es gibt dafuer keine Datenbank-Spalte.
--
-- NACHTRAG (Nutzer-Wunsch): seine Upgrades standen ebenfalls auf 0
-- (upgrade_purchases war {}) - die einzelnen Kaeufe lassen sich nicht
-- rekonstruieren, aber er soll dafuer tatsaechlich ausgebbares Gold
-- bekommen (nicht nur den Bestenlisten-Wert total_gold_earned von
-- oben) sowie die zu Level 200 gehoerenden Skillpunkte: jedes Level
-- gibt genau 1 Skillpunkt (siehe bkmpIdleAddXp in idledorf.js,
-- "bkmpIdleState.skill_points_available += 1"), skill_allocations war
-- {} (nichts ausgegeben) - macht bei Level 200 also 200 verfuegbare
-- Punkte.
-- ============================================================

update public.idle_player_state
set
  level = 200,
  total_gold_earned = 250000000,
  gold = 250000000,
  skill_points_available = 200,
  dragon_kills = 280000,
  playtime_seconds = 360000,
  highest_dragon_index = 3900,
  current_dragon_index = 3900
where name_key = 'byalex0';
