-- Bkmp - Idle Drachen Dorf: erster echter Dorf-Skin "Pilzdorf" + noetige
-- Schema-Erweiterung fuer animierte Skins.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- idle_village_skins existiert schon (siehe supabase-idle-village-skins.sql),
-- braucht aber noch Spalten fuer animierte Mehr-Frame-Skins: Pilzdorf hat
-- 6 leicht unterschiedliche Frames (ambiente Partikel-Variation) als
-- Sprite-Streifen in assets/village/pilzdorf.png, animiert per
-- background-position-x + steps() - die Frame-Anzahl UND das native
-- Seitenverhaeltnis eines einzelnen Frames muessen dafuer bekannt sein
-- (unterschiedliche Skins koennen unterschiedlich geschnittene Frames
-- haben, siehe idledorf.js bkmpApplyVillageSkin).
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.idle_village_skins add column if not exists frame_count int not null default 1;
alter table public.idle_village_skins add column if not exists frame_aspect_w numeric not null default 1164;
alter table public.idle_village_skins add column if not exists frame_aspect_h numeric not null default 199;

update public.idle_village_skins
set frame_count = 1, frame_aspect_w = 1164, frame_aspect_h = 199
where id = 'standard';

insert into public.idle_village_skins (id, name, description, icon, image_file, unlock_type, price_gold, price_crystals, frame_count, frame_aspect_w, frame_aspect_h, sort_order)
values ('pilzdorf', 'Pilzdorf', 'Ein leuchtendes Pilzdorf unter violettem Himmel - mit sanft schimmernden Ambiente-Details.', '🍄', 'assets/village/pilzdorf.png', 'purchase', 2500000, 0, 6, 749, 321, 1)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  image_file = excluded.image_file,
  unlock_type = excluded.unlock_type,
  price_gold = excluded.price_gold,
  price_crystals = excluded.price_crystals,
  frame_count = excluded.frame_count,
  frame_aspect_w = excluded.frame_aspect_w,
  frame_aspect_h = excluded.frame_aspect_h,
  sort_order = excluded.sort_order;
