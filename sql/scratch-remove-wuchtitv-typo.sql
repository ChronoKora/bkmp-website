-- Einmaliger Korrektur-Befehl: "wuchtitv" war ein Vertipper beim Anlegen
-- der WuchiTV-Pluschie (richtige Version ist "wuchitv", 4 Minuten spaeter
-- angelegt). Niemand besitzt den Vertipper-Eintrag, niemand hat ihn aktiv
-- gesetzt, keine plushie_codes-Zeile referenziert ihn - gefahrlos loeschbar.

delete from public.plushies where id = 'wuchtitv';
