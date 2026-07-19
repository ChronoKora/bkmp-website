-- Bkmp - Pekka14 komplett als Pluschie/Erfolg/Titel entfernen (Nutzer-Auftrag 19.07.)
-- Achievement ('plushie_pekka14') und Titel ('plushie_fanboy_pekka14') werden
-- NICHT separat gespeichert, sondern zur Laufzeit aus BKMP_PLUSHIES abgeleitet
-- (siehe bkmpBuildAchievementsList/bkmpBuildTitlesList in bkmp-site.js) -
-- das Entfernen der Definitions-Zeile hier reicht, um beide verschwinden zu
-- lassen. Der clientseitige Fallback in app.js wurde im selben Commit-Schritt
-- separat entfernt (kein DB-Zugriff noetig fuer diesen Teil).
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

-- Nutzer-Nachtrag (19.07., "Komplett entfernen"): auch bereits besessene
-- Exemplare werden mit entfernt - bewusste Ausnahme vom sonst geltenden
-- "einmal geschafft bleibt geschafft"-Prinzip, auf ausdruecklichen Wunsch.

-- 1) Noch nicht eingeloeste Codes fuer Pekka14 entfernen - koennen sonst
--    weiterhin fuer einen nicht mehr existierenden Pluschie eingeloest werden.
delete from public.plushie_codes
where plushie_id = 'pekka14' and is_redeemed = false;

-- 2) Aktive Auswahl zuruecksetzen, BEVOR die Besitz-Zeile geloescht wird -
--    sonst zeigt player_stats.active_plushie danach auf ein nicht mehr
--    existierendes Bild (kein Crash dank bestehendem `if (!p) return;`-Guard
--    im Client, aber unnoetig verwaist).
update public.player_stats set active_plushie = '' where active_plushie = 'pekka14';

-- 3) Besitz-Eintraege bereits besitzender Spieler entfernen.
delete from public.user_plushies where plushie_id = 'pekka14';

-- 4) Die Pluschie-Definition selbst entfernen - verschwindet dadurch aus der
--    Sammlung-Anzeige UND aus den automatisch abgeleiteten Erfolgen/Titeln
--    (plushie_pekka14 / plushie_fanboy_pekka14, siehe bkmpBuildAchievementsList/
--    bkmpBuildTitlesList in bkmp-site.js - keine separate Zeile dort noetig).
delete from public.plushies where id = 'pekka14';
