-- Bkmp - "AD-Free" Easter Egg im Idle-Dorf: RandomAuto-Pluschie
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Das Bild liegt schon unter assets/plushies/RandomAuto.png - hier wird
-- nur die dazugehoerige plushies-Zeile UND ein wiederverwendbarer,
-- versteckter plushie_codes-Eintrag angelegt (is_reusable = true, wie bei
-- Koras Easter-Egg-Code). Der Code selbst wird NIE im UI angezeigt,
-- sondern vom Client automatisch im Hintergrund eingeloest, sobald der
-- Spieler den kompletten "AD-Free"-Dialog im Idle-Dorf durchklickt (siehe
-- index.html, BKMP_ADFREE_CODE). is_reusable sorgt dafuer, dass JEDER
-- Account das Pluschie einmal bekommen kann, nicht nur der Erste.

insert into public.plushies (id, name, image_url, description, rarity)
values ('randomauto', 'RandomAuto Plüshie', 'assets/plushies/RandomAuto.png', '', 'Episch')
on conflict (id) do nothing;

insert into public.plushie_codes (code, plushie_id, note, is_reusable)
values ('ADFREE-RANDOMAUTO-EGG', 'randomauto', 'AD-Free Easter Egg im Idle-Dorf (Popup-Dialog) - automatisch eingeloest, nie im UI angezeigt', true)
on conflict (code) do nothing;
