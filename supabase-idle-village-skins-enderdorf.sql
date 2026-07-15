-- Bkmp - Idle Drachen Dorf: dreizehnter Dorf-Skin "Ender Dorf" (Video-Skin,
-- gleiches Schema wie Midas Stadt/Kartendorf/etc.), kaufbar fuer 500.000 Gold.
--
-- Video-Massse (2202 x 942) per MP4-tkhd-Atom vermessen, gleiches Vorgehen
-- wie bei allen anderen Video-Skins.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent.

insert into public.idle_village_skins (id, name, description, icon, image_file, video_file, unlock_type, price_gold, price_crystals, frame_count, frame_aspect_w, frame_aspect_h, sort_order)
values ('enderdorf', 'Ender Dorf', 'Ein Dorf am Rand der Leere, umgeben von schwebenden Ender-Inseln.', '🟣', '', 'assets/village/enderdorf.mp4', 'purchase', 500000, 0, 1, 2202, 942, 12)
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
  sort_order = excluded.sort_order,
  active = true;
