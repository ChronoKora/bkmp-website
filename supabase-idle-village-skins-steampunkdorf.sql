-- Bkmp - Idle Drachen Dorf: "Steampunk Dorf" ersetzt die verworfene
-- Drachenrahmen-Idee als erster echter Echtgeld-Artikel (1,99 EUR via
-- Stripe, gleiche Infrastruktur wie zuvor - siehe
-- supabase-real-money-purchases.sql, api/create-checkout-session.js,
-- api/stripe-webhook.js). Diesmal ein normaler Dorf-Skin (apply_scope
-- 'village', Standardwert), kein Fenster-Rahmen mehr - deshalb einfach
-- ueber den bestehenden Dorf-Skin-Katalog, ohne Sonderlogik.
--
-- Video-Massse (2200 x 942) per MP4-tkhd-Atom vermessen, gleiches Vorgehen
-- wie bei den anderen Video-Skins (siehe frame_aspect_w/h-Kommentar in
-- supabase-idle-village-skins-midasstadt.sql).
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent.

-- Alter, verworfener Fenster-Rahmen-Artikel: deaktivieren statt loeschen
-- (FK-sicher, real_money_purchases.skin_id verweist evtl. noch darauf -
-- war aber nie kaeuflich freigeschaltet, siehe BKMP_REAL_MONEY_PURCHASES_ENABLED).
update public.idle_village_skins set active = false where id = 'drachenrahmen';

insert into public.idle_village_skins (id, name, description, icon, image_file, video_file, unlock_type, price_eur_cents, frame_count, frame_aspect_w, frame_aspect_h, sort_order)
values (
  'steampunkdorf',
  'Steampunk Dorf',
  'Ein Dorf voller Zahnraeder, Dampfmaschinen und messingglaenzender Technik.',
  '⚙️',
  '',
  'assets/village/steampunkdorf.mp4',
  'real_money',
  199,
  1,
  2200,
  942,
  11
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  image_file = excluded.image_file,
  video_file = excluded.video_file,
  unlock_type = excluded.unlock_type,
  price_eur_cents = excluded.price_eur_cents,
  frame_count = excluded.frame_count,
  frame_aspect_w = excluded.frame_aspect_w,
  frame_aspect_h = excluded.frame_aspect_h,
  sort_order = excluded.sort_order,
  active = true;
