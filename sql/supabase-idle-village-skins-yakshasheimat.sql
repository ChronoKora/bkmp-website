-- Bkmp - Idle Drachen Dorf: achter Dorf-Skin "Yakshas Heimat" (Video-Skin,
-- gleiches Schema wie Pinguindorf/Geisterdorf/Pilzdorf) - dritter Skin mit
-- unlock_type='achievement': freigeschaltet durch 50.000 Siege gegen genau
-- den Boss "Yaksha der Drachenboss" (id 'yaksha-boss', siehe
-- supabase-idle-dorf-rework.sql) - NICHT irgendeinen Boss, siehe idledorf.js
-- bkmpIdleHandleDragonDefeated (prueft dragon.id === 'yaksha-boss').
--
-- Neue Spalte yaksha_boss_kills auf idle_player_state zaehlt ausschliesslich
-- Siege gegen diesen einen Boss (getrennt vom generischen boss_kills-Feld,
-- das JEDEN Boss zaehlt). Gleicher Freischalt-Mechanismus wie bei
-- Zerstoertes Dorf (siehe supabase-idle-village-skins-zerstoertesdorf.sql):
-- direkter Client-Insert in idle_player_village_skins, kein serverseitiger
-- Trigger noetig.
--
-- frame_aspect_w/h zweckentfremdet als natives Video-Seitenverhaeltnis
-- (2344 x 886, echte Video-Massse) - siehe Kommentar in
-- supabase-idle-village-skins-pinguindorf.sql fuer die volle Begruendung.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.idle_player_state add column if not exists yaksha_boss_kills bigint not null default 0;
alter table public.idle_village_skins add column if not exists video_file text;

insert into public.idle_village_skins (id, name, description, icon, image_file, video_file, unlock_type, price_gold, price_crystals, frame_count, frame_aspect_w, frame_aspect_h, unlock_hint, sort_order)
values ('yakshasheimat', 'Yakshas Heimat', 'Das Reich des Drachenboss Yaksha.', '👑', '', 'assets/village/yakshasheimat.mp4', 'achievement', 0, 0, 1, 2344, 886, '50.000x den Boss Yaksha besiegen.', 8)
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
  unlock_hint = excluded.unlock_hint,
  sort_order = excluded.sort_order;
