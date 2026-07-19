-- Bkmp - Idle Drachen Dorf: neunter Dorf-Skin "Kartendorf" (Video-Skin,
-- gleiches Schema wie Pinguindorf/Geisterdorf/Pilzdorf), kaufbar fuer
-- 50.000.000 Gold.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- video_file-Spalte existiert bereits (siehe
-- supabase-idle-village-skins-pinguindorf.sql), das "alter table ... add
-- column if not exists" hier ist nur zur Sicherheit falls diese Migration
-- vor den anderen ausgefuehrt wird.
--
-- frame_aspect_w/h zweckentfremdet als natives Video-Seitenverhaeltnis
-- (2336 x 888, echte Video-Massse) - siehe Kommentar in
-- supabase-idle-village-skins-pinguindorf.sql fuer die volle Begruendung.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.idle_village_skins add column if not exists video_file text;

insert into public.idle_village_skins (id, name, description, icon, image_file, video_file, unlock_type, price_gold, price_crystals, frame_count, frame_aspect_w, frame_aspect_h, sort_order)
values ('kartendorf', 'Kartendorf', 'Ein Dorf ganz im Zeichen der Kartenkunst.', '🗺️', '', 'assets/village/kartendorf.mp4', 'purchase', 50000000, 0, 1, 2336, 888, 9)
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
