-- Bkmp - JakeCrayson-Pluschie fuer Jakes Feldfahrt (Minispiel)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- WICHTIG: erst NACHDEM die plushies-Katalogzeile fuer "jakecrayson" existiert
-- (per admin.html "Ordner scannen" ueber assets/plushies/JakeCrayson.png
-- angelegt - das ergibt automatisch die id "jakecrayson", siehe
-- api/scan-plushie-folder.js). Diese Datei legt nur den dazugehoerigen,
-- wiederverwendbaren, versteckten plushie_codes-Eintrag an (is_reusable =
-- true, exakt dasselbe Muster wie beim Schaf-/AD-Free-Easter-Egg, siehe
-- sql/supabase-adfree-easter-egg.sql). Der Code wird NIE im UI angezeigt,
-- sondern automatisch im Hintergrund eingeloest, sobald ein eingeloggter
-- Spieler in einer Runde von Jakes Feldfahrt 500 oder mehr Punkte erreicht
-- (siehe bkmpJakeCraysonMaybeGrant() in js/easter-eggs/jakes-feldfahrt.js).
-- is_reusable sorgt dafuer, dass JEDER Account das Pluschie genau einmal
-- bekommen kann, nicht nur der erste Spieler, der die Schwelle erreicht.

insert into public.plushie_codes (code, plushie_id, note, is_reusable)
values ('JAKESFELDFAHRT-500-HARVEST', 'jakecrayson', 'Jakes Feldfahrt Minispiel - automatisch eingeloest ab 500 Punkten in einer Runde, nie im UI angezeigt', true)
on conflict (code) do nothing;
