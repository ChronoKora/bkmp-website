-- Bkmp - Easter Egg "Schaf-Zitate-Flüsterer": SheepMasterLP-Plüshie
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Gleiches Muster wie supabase-adfree-easter-egg.sql: ein wiederverwendbarer,
-- NIE im UI angezeigter plushie_codes-Eintrag (is_reusable = true), der vom
-- Client automatisch im Hintergrund eingeloest wird, sobald ein Spieler zum
-- allerersten Mal auf das Schaf auf der Hauptseite klickt (siehe index.html,
-- BKMP_SHEEP_EGG_CODE). is_reusable sorgt dafuer, dass JEDER Account das
-- Pluschie einmal bekommen kann, nicht nur der Erste.
--
-- WICHTIG: image_url zeigt auf assets/plushies/SheepMasterLP.png - diese
-- Bild-Datei liegt noch NICHT im Projekt (kommt vom Nutzer nachgereicht).
-- Bis die Datei da ist, zeigt das Pluschie im UI ein kaputtes Bild-Icon,
-- alles andere (Freischaltung/Zuordnung/Erfolg) funktioniert aber schon.

insert into public.plushies (id, name, image_url, description, rarity)
values ('sheepmasterlp', 'SheepMasterLP Plüshie', 'assets/plushies/SheepMasterLP.png', 'Jeden Tag werden wir bereichert damit!', 'Legendär')
on conflict (id) do nothing;

insert into public.plushie_codes (code, plushie_id, note, is_reusable)
values ('SHEEP-QUOTE-WHISPERER-EGG', 'sheepmasterlp', 'Easter Egg: 1x auf das Schaf auf der Hauptseite klicken - automatisch eingeloest, nie im UI angezeigt', true)
on conflict (code) do nothing;
