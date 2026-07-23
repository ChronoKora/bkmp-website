-- Bkmp - Dorf-Skins per Plüshie-Code-System einlösbar (Nutzerwunsch 23.07.:
-- "baue das einfach im aktuellen Plüshsystem Code mit ein")
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Bisher war plushie_codes strukturell fest auf GENAU EINEN Belohnungstyp
-- verdrahtet (plushie_id text not null, kein Discriminator). Diese Migration
-- macht plushie_codes wiederverwendbar fuer eine zweite Belohnungsart
-- (Dorf-Skins), statt ein komplett paralleles Code-System zu bauen:
-- - reward_kind unterscheidet, WAS ein Code auslöst ('plushie' bleibt der
--   Standard, damit alle bestehenden Codes unveraendert weiterlaufen).
-- - skin_id zeigt (nur bei reward_kind='village_skin') auf idle_village_skins.
-- - plushie_id wird nullable (nur bei reward_kind='plushie' gesetzt).
-- - Ein Check stellt sicher, dass IMMER genau eines von beiden zum
--   gewaehlten reward_kind passend gesetzt ist - keine halb befuellten Zeilen.
--
-- Ausserdem: idle_village_skins.unlock_type bekommt den neuen Wert 'code'
-- (gleiches Muster wie 'real_money' in supabase-real-money-purchases.sql) -
-- ein Skin mit unlock_type='code' zeigt clientseitig automatisch einen
-- Schloss-Hinweis statt eines Kauf-Buttons (bkmpIdleRenderSkinsPanel in
-- js/systems/bkmp-cosmetics.js faengt jeden nicht "purchase"/"real_money"-
-- Fall bereits generisch ab, keine JS-Aenderung noetig - unlock_hint liefert
-- den angezeigten Text).
--
-- api/redeem-plushie-code.js verzweigt jetzt auf reward_kind: bei 'plushie'
-- exakt das bisherige Verhalten (user_plushies), bei 'village_skin' ein
-- Insert in idle_player_village_skins (auth_user_id + name_key + skin_id,
-- gleiche Tabelle/gleicher Ownership-Vertrag wie ein normaler Gold-Kauf).
--
-- Idempotent: mehrfaches Ausfuehren ist unschaedlich.

alter table public.plushie_codes
  add column if not exists reward_kind text not null default 'plushie';

alter table public.plushie_codes
  add column if not exists skin_id text references public.idle_village_skins(id);

alter table public.plushie_codes
  alter column plushie_id drop not null;

alter table public.plushie_codes drop constraint if exists plushie_codes_reward_kind_check;
alter table public.plushie_codes add constraint plushie_codes_reward_kind_check
  check (reward_kind in ('plushie', 'village_skin'));

alter table public.plushie_codes drop constraint if exists plushie_codes_reward_target_check;
alter table public.plushie_codes add constraint plushie_codes_reward_target_check
  check (
    (reward_kind = 'plushie' and plushie_id is not null and skin_id is null) or
    (reward_kind = 'village_skin' and skin_id is not null and plushie_id is null)
  );

create index if not exists plushie_codes_skin_idx on public.plushie_codes (skin_id);

alter table public.idle_village_skins drop constraint if exists idle_village_skins_unlock_type_check;
alter table public.idle_village_skins add constraint idle_village_skins_unlock_type_check
  check (unlock_type in ('free', 'purchase', 'achievement', 'boss_drop', 'real_money', 'code'));

-- Erster code-exklusiver Dorf-Skin: "KalleJunior Dorf" (Nutzer-Video,
-- 1912x1084, siehe assets/village/kallejuniordorf.mp4). image_file bleibt
-- leer, gleiches Muster wie die meisten anderen reinen Video-Skins
-- (z. B. cyberstadt/eisdorf/enderdorf) - video_file hat ohnehin Vorrang.
insert into public.idle_village_skins (id, name, description, icon, image_file, video_file, unlock_type, price_gold, price_crystals, frame_count, frame_aspect_w, frame_aspect_h, unlock_hint, sort_order)
values ('kallejuniordorf', 'KalleJunior Dorf', 'Ein Dorf ganz im Zeichen von KalleJunior.', '🏡', '', 'assets/village/kallejuniordorf.mp4', 'code', 0, 0, 1, 1912, 1084, 'Nur per Einlöse-Code erhältlich.', 16)
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
