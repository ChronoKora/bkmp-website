-- Bkmp - Idle Drachen Dorf: erster echter Dorf-Skin "Pilzdorf" + noetige
-- Schema-Erweiterung fuer animierte Skins.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- idle_village_skins existiert schon (siehe supabase-idle-village-skins.sql),
-- braucht aber noch Spalten fuer animierte Mehr-Frame-Skins: Pilzdorf hatte
-- urspruenglich 6 leicht unterschiedliche Frames (ambiente Partikel-
-- Variation) als Sprite-Streifen, animiert per background-position-x +
-- steps() - die Frame-Anzahl UND das native Seitenverhaeltnis eines
-- einzelnen Frames muessen dafuer bekannt sein (unterschiedliche Skins
-- koennen unterschiedlich geschnittene Frames haben, siehe idledorf.js
-- bkmpApplyVillageSkin).
--
-- Update (16.07.): Pilzdorf wurde auf ein echtes Video umgestellt (gleiches
-- Schema wie Pinguindorf/Geisterdorf, siehe die dortigen SQL-Dateien) -
-- image_file/frame_count bleiben aus Kompatibilitaetsgruenden befuellt,
-- video_file hat aber Vorrang (idledorf.js bkmpApplyVillageSkin prueft
-- video_file zuerst). frame_aspect_w/h tragen jetzt die echten Video-Massse
-- (2208 x 940) statt der alten Einzel-Frame-Massse.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.idle_village_skins add column if not exists frame_count int not null default 1;
alter table public.idle_village_skins add column if not exists frame_aspect_w numeric not null default 1164;
alter table public.idle_village_skins add column if not exists frame_aspect_h numeric not null default 199;
alter table public.idle_village_skins add column if not exists video_file text;

update public.idle_village_skins
set frame_count = 1, frame_aspect_w = 1164, frame_aspect_h = 199
where id = 'standard';

insert into public.idle_village_skins (id, name, description, icon, image_file, video_file, unlock_type, price_gold, price_crystals, frame_count, frame_aspect_w, frame_aspect_h, sort_order)
values ('pilzdorf', 'Pilzdorf', 'Ein leuchtendes Pilzdorf unter violettem Himmel - mit sanft schimmernden Ambiente-Details.', '🍄', 'assets/village/pilzdorf.png', 'assets/village/pilzdorf.mp4', 'purchase', 2500000, 0, 1, 2208, 940, 1)
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
