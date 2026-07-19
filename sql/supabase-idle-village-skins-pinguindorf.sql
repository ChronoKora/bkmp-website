-- Bkmp - Idle Drachen Dorf: zweiter Dorf-Skin "Pinguindorf" + Schema-
-- Erweiterung fuer VIDEO-basierte Skins (statt Bild-Sprite-Streifen).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- idle_village_skins existiert schon (siehe supabase-idle-village-skins.sql,
-- supabase-idle-village-skins-pilzdorf.sql). Pinguindorf ist der erste Skin,
-- der als echtes Video statt eines Frame-Sprite-Streifens vorliegt
-- (assets/village/pinguindorf.mp4) - image_file bleibt trotzdem befuellt
-- (leerer String), damit die bestehende NOT NULL-Spalte unangetastet bleibt;
-- idledorf.js (bkmpApplyVillageSkin) prueft video_file zuerst und faellt nur
-- ohne Video auf image_file zurueck.
--
-- frame_aspect_w/h werden hier zweckentfremdet als natives Video-
-- Seitenverhaeltnis (1612 x 720, echte Video-Massse der ueberarbeiteten
-- Fassung vom 16.07.) genutzt, damit der Sprite-Container per aspect-ratio
-- exakt (kein Zuschneiden/Verzerren) auf die Video-Groesse passt - gleiches
-- Feld, gleiche Bedeutung wie bei den Bild-Skins, nur mit den Massen des
-- Videos statt eines Bild-Frames.
--
-- video_file traegt bewusst eine ?v=-Kennung wie die uebrigen CSS/JS-
-- Assets: idledorf.js setzt den DB-Wert 1:1 als <video src>, ohne eigene
-- Cache-Busting-Logik - ohne Versions-Query wuerden Browser/CDN bei einem
-- Video-Austausch unter demselben Dateinamen weiter die alte Fassung aus
-- dem Cache zeigen.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.idle_village_skins add column if not exists video_file text;

insert into public.idle_village_skins (id, name, description, icon, image_file, video_file, unlock_type, price_gold, price_crystals, frame_count, frame_aspect_w, frame_aspect_h, sort_order)
values ('pinguindorf', 'Pinguindorf', 'Ein verschneites Pinguindorf am eisigen Kuestensaum.', '🐧', '', 'assets/village/pinguindorf.mp4?v=20260716-2', 'purchase', 2500000, 0, 1, 1612, 720, 2)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  image_file = excluded.image_file,
  video_file = excluded.video_file,
  unlock_type = excluded.unlock_type,
  price_gold = excluded.price_gold,
  price_crystals = excluded.price_crystals,
  frame_count = excluded.frame_count,
  frame_aspect_w = excluded.frame_aspect_w,
  frame_aspect_h = excluded.frame_aspect_h,
  sort_order = excluded.sort_order;
