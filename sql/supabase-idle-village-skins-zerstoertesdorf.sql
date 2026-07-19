-- Bkmp - Idle Drachen Dorf: sechster Dorf-Skin "Zerstoertes Dorf" (Video-
-- Skin, gleiches Schema wie Pinguindorf/Geisterdorf/Pilzdorf) - zweiter
-- Skin mit unlock_type='achievement' statt 'purchase': NICHT kaufbar,
-- sondern freigeschaltet durch 15.000 Niederlagen gegen Drachen
-- (Nutzervorgabe 16.07.: "Bekommen: Durch 15000x gegen Drachen Verloren").
--
-- Neue Spalte village_defeats auf idle_player_state zaehlt jede Niederlage
-- (siehe idledorf.js bkmpIdleHandleDefeat) - der Client prueft nach jeder
-- Niederlage, ob der Schwellenwert erreicht ist, und schreibt den Besitz
-- dann direkt in idle_player_village_skins (gleicher Vertrauens-Rahmen wie
-- der normale Kauf-Weg ueber bkmpIdleBuyVillageSkin - kein serverseitiger
-- Trigger noetig, da village_defeats selbst schon serverseitig gespeichert
-- wird und nicht rein clientseitig manipulierbar mehr Sinn ergeben wuerde
-- als jeder andere Client-Zaehler in diesem Spiel).
--
-- frame_aspect_w/h zweckentfremdet als natives Video-Seitenverhaeltnis
-- (2618 x 792, echte Video-Massse) - siehe Kommentar in
-- supabase-idle-village-skins-pinguindorf.sql fuer die volle Begruendung.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.idle_player_state add column if not exists village_defeats bigint not null default 0;
alter table public.idle_village_skins add column if not exists video_file text;

insert into public.idle_village_skins (id, name, description, icon, image_file, video_file, unlock_type, price_gold, price_crystals, frame_count, frame_aspect_w, frame_aspect_h, unlock_hint, sort_order)
values ('zerstoertesdorf', 'Zerstörtes Dorf', 'Die rauchenden Ruinen unzaehliger verlorener Schlachten gegen die Drachen.', '🏚️', '', 'assets/village/zerstoertesdorf.mp4', 'achievement', 0, 0, 1, 2618, 792, '15.000x gegen Drachen verloren.', 6)
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
