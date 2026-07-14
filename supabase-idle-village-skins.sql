-- Bkmp - Idle Drachen Dorf: "Dorf-Skins" (austauschbare Sprites fuers
-- persoenliche Dorf im Kampf-Tab, NICHT die geteilte Raid-Stadt).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Freischaltung laut Spieler-Vorgabe (13.07.): hauptsaechlich KAUFEN mit
-- Gold/Kristallen, aber einzelne Skins sollen auch ueber Aktionen
-- (Achievement) oder Boss-Drops freischaltbar sein - "das wuerde ich an
-- jeden Skin separat mitteilen". Deshalb ein generisches unlock_type-Feld
-- pro Skin statt fest einem einzigen Freischalt-Weg.
--
-- Architektur bewusst 1:1 wie idle_player_runes (siehe
-- supabase-idle-runes.sql): Katalog oeffentlich lesbar, Besitz-Zeilen wie
-- bei Runen client-seitig vom Spieler selbst eingefuegt (gleicher
-- Vertrauens-Rahmen wie der Rest des Idle-Spiels - keine serverseitige
-- Kauf-RPC noetig, Gold-Abzug laeuft lokal + normaler Autosave wie beim
-- bestehenden Upgrade-Kauf in bkmpIdleBuyUpgrade).
--
-- WICHTIG (Lehre aus dem dwarf_unlocked-Vorfall, siehe idledorf.js): die
-- aktive/ausgeruestete Skin-Auswahl wird bewusst NICHT hier oder in
-- idle_player_state gespeichert (rein kosmetisch, nur fuer den Spieler
-- selbst sichtbar) - die liegt nur in localStorage
-- (bkmp-active-village-skin), damit dieses Feature niemals eine
-- SELECT-Spalte in idle_player_state braucht und so nicht wie beim
-- Dorf-Zweig-Vorfall die komplette Spielstand-Ladefunktion fuer ALLE
-- Spieler zerschiessen kann, falls diese Migration verspaetet laeuft.
--
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

create table if not exists public.idle_village_skins (
  id text primary key,
  name text not null,
  description text not null default '',
  icon text not null default '🏘️',
  image_file text not null,
  unlock_type text not null default 'purchase' check (unlock_type in ('free', 'purchase', 'achievement', 'boss_drop')),
  price_gold bigint not null default 0,
  price_crystals bigint not null default 0,
  unlock_hint text not null default '',
  sort_order int not null default 0,
  active boolean not null default true
);

-- Nachtraeglich hinzugekommene Spalten (urspruenglich in
-- supabase-idle-village-skins-pilzdorf.sql/-pinguindorf.sql) hier
-- ebenfalls absichern, damit diese Datei auch bei einer komplett neuen
-- Installation eigenstaendig lauffaehig bleibt, unabhaengig von der
-- Reihenfolge, in der die einzelnen Skin-Migrationen ausgefuehrt werden.
alter table public.idle_village_skins add column if not exists frame_count int not null default 1;
alter table public.idle_village_skins add column if not exists frame_aspect_w numeric not null default 1164;
alter table public.idle_village_skins add column if not exists frame_aspect_h numeric not null default 199;
alter table public.idle_village_skins add column if not exists video_file text;

alter table public.idle_village_skins enable row level security;
drop policy if exists "Public read village skins" on public.idle_village_skins;
create policy "Public read village skins"
on public.idle_village_skins for select to anon, authenticated using (true);

create table if not exists public.idle_player_village_skins (
  id uuid primary key default gen_random_uuid(),
  name_key text not null,
  auth_user_id uuid not null,
  skin_id text not null references public.idle_village_skins(id),
  unlocked_at timestamptz not null default now(),
  unique (auth_user_id, skin_id)
);

create index if not exists idle_player_village_skins_name_idx on public.idle_player_village_skins (name_key);
create index if not exists idle_player_village_skins_owner_idx on public.idle_player_village_skins (auth_user_id);

alter table public.idle_player_village_skins enable row level security;

drop policy if exists "Public read player village skins" on public.idle_player_village_skins;
create policy "Public read player village skins"
on public.idle_player_village_skins for select to anon, authenticated using (true);

drop policy if exists "Owner insert player village skins" on public.idle_player_village_skins;
create policy "Owner insert player village skins"
on public.idle_player_village_skins for insert to authenticated
with check (auth_user_id = auth.uid());

-- Das "Standard"-Dorf (das heutige, immer schon vorhandene Sprite) braucht
-- KEINE eigene Besitz-Zeile - idledorf.js behandelt unlock_type='free'
-- Skins immer als besessen. Trotzdem als Katalog-Eintrag angelegt, damit
-- er in der Auswahl-Liste normal neben den kaufbaren Skins auftaucht.
--
-- Update (16.07.): auf ein echtes Video umgestellt (gleiches Schema wie
-- Pinguindorf/Geisterdorf, siehe die dortigen SQL-Dateien) - video_file hat
-- Vorrang vor image_file (idledorf.js bkmpApplyVillageSkin). Deshalb jetzt
-- "do update set" statt "do nothing", damit ein erneutes Ausfuehren dieser
-- Datei den Eintrag auch wirklich aktualisiert.
insert into public.idle_village_skins (id, name, description, icon, image_file, video_file, unlock_type, frame_count, frame_aspect_w, frame_aspect_h, sort_order)
values ('standard', 'Standarddorf', 'Das gute alte Dorf, wie es schon immer aussah.', '🏘️', 'assets/dragons/dorf.png', 'assets/village/startdorf.mp4', 'free', 1, 2124, 976, 0)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  image_file = excluded.image_file,
  video_file = excluded.video_file,
  unlock_type = excluded.unlock_type,
  frame_count = excluded.frame_count,
  frame_aspect_w = excluded.frame_aspect_w,
  frame_aspect_h = excluded.frame_aspect_h,
  sort_order = excluded.sort_order;
