-- ============================================================
-- Bkmp - Drachenzucht- und Begleitdrachen-System (Spieler-Vorgabe 15./16.07.)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent.
--
-- Architektur-Entscheidungen (siehe Kommentare in idledorf.js fuer Details):
--   - Vertrauensmodell 1:1 wie beim Rest des Idle-Spiels (Runen, Gold, XP):
--     rein clientseitige Simulation, keine Anti-Cheat-Serverpruefung fuer
--     Fuetterung/Wachstum/Kampf-EP. Nur die zwei Stellen mit echtem
--     Mehrspieler-/Wiederholungsrisiko sind serverseitig abgesichert:
--     legendaere Ei-Wuerfe (raid_finish, gleicher Mechanismus wie der
--     Zerathor-Dorf-Skin-Drop) und das Ausbrueten selbst (Client-Insert +
--     optimistic-concurrency-Guard, siehe Kommentar bei player_dragon_nests).
--   - Ein Ei = eine Zeile (wie idle_player_runes/user_plushies), kein JSON-Blob.
--   - Ein Drache = eine Zeile, Haupt-/Nebenwerte werden EINMAL beim Erreichen
--     der Erwachsenenform gewuerfelt und dauerhaft gespeichert (exaktes
--     Vorbild: idle_player_runes.rolled_value/substats).
--   - Rarity-Palette identisch zur bestehenden Runen-Palette wiederverwendet
--     (grau/gruen/blau/lila/gold -> hier standard/selten/episch/legendaer),
--     damit Farbcodierung sitewide konsistent bleibt.
-- ============================================================

/* ---------------- dragon_species (Katalog, admin-editierbar) ---------------- */
create table if not exists public.dragon_species (
  id text primary key,
  name text not null,
  rarity text not null check (rarity in ('standard', 'selten', 'episch', 'legendaer')),
  egg_source text not null check (egg_source in ('combat', 'raid', 'event')),
  source_dragon_id text,                          -- combat: welcher idle_dragons.id droppt dieses Ei
  egg_drop_chance numeric not null default 0,      -- Chance pro qualifizierendem Kill (0..1)
  brood_seconds integer not null,                  -- Bruzeit in Sekunden
  sacrifice_gold integer not null default 0,        -- nur legendaer: Opfergabe vor Brutbeginn
  sacrifice_crystals integer not null default 0,    -- nur legendaer
  growth_points_required integer not null default 100,  -- Baby -> Jugendlich (Fuetterungspunkte)
  battle_xp_required integer not null default 500,       -- Jugendlich -> Erwachsen (Kampf-EP)
  is_multi_stat boolean not null default false,     -- legendaer: alle 3 Hauptwerte statt 1
  sub_stat_count_min smallint not null default 2,
  sub_stat_count_max smallint not null default 3,
  egg_image text not null,
  baby_image text not null,
  teen_image text not null,
  adult_image text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

alter table public.dragon_species enable row level security;
grant select on public.dragon_species to anon, authenticated;
grant insert, update, delete on public.dragon_species to authenticated;

drop policy if exists "Public read dragon species" on public.dragon_species;
create policy "Public read dragon species" on public.dragon_species for select to anon, authenticated using (true);

drop policy if exists "Admin write dragon species" on public.dragon_species;
create policy "Admin write dragon species" on public.dragon_species for all to authenticated
  using (public.is_active_admin()) with check (public.is_active_admin());

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds, sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat, sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('feuerdrache', 'Feuerdrache', 'standard', 'combat', 'feuerdrache', 0.001, 2700, 0, 0, 500, 2500, false, 2, 3,
    'assets/dragons/breeding/egg/feuerdrache.png', 'assets/dragons/breeding/baby/feuerdrache.png', 'assets/dragons/breeding/teen/feuerdrache.png', 'assets/dragons/breeding/adult/feuerdrache.png', 0),
  ('wasserdrache', 'Wasserdrache', 'standard', 'combat', 'wasserdrache', 0.001, 2700, 0, 0, 500, 2500, false, 2, 3,
    'assets/dragons/breeding/egg/wasserdrache.png', 'assets/dragons/breeding/baby/wasserdrache.png', 'assets/dragons/breeding/teen/wasserdrache.png', 'assets/dragons/breeding/adult/wasserdrache.png', 1),
  ('winddrache', 'Winddrache', 'standard', 'combat', 'winddrache', 0.001, 2700, 0, 0, 500, 2500, false, 2, 3,
    'assets/dragons/breeding/egg/winddrache.png', 'assets/dragons/breeding/baby/winddrache.png', 'assets/dragons/breeding/teen/winddrache.png', 'assets/dragons/breeding/adult/winddrache.png', 2),
  ('blitzdrache', 'Blitzdrache', 'standard', 'combat', 'blitzdrache', 0.001, 2700, 0, 0, 500, 2500, false, 2, 3,
    'assets/dragons/breeding/egg/blitzdrache.png', 'assets/dragons/breeding/baby/blitzdrache.png', 'assets/dragons/breeding/teen/blitzdrache.png', 'assets/dragons/breeding/adult/blitzdrache.png', 3),
  ('aureliadrache', 'Aureliadrache', 'selten', 'combat', 'yakshas-drache', 0.001, 5400, 0, 0, 1000, 6000, false, 3, 4,
    'assets/dragons/breeding/egg/aureliadrache.png', 'assets/dragons/breeding/baby/aureliadrache.png', 'assets/dragons/breeding/teen/aureliadrache.png', 'assets/dragons/breeding/adult/aureliadrache.png', 4),
  ('schattendrache', 'Schattendrache', 'selten', 'combat', 'schattendrache', 0.001, 5400, 0, 0, 1000, 6000, false, 3, 4,
    'assets/dragons/breeding/egg/schattendrache.png', 'assets/dragons/breeding/baby/schattendrache.png', 'assets/dragons/breeding/teen/schattendrache.png', 'assets/dragons/breeding/adult/schattendrache.png', 5),
  ('wuffdrache', 'Wuffdrache', 'selten', 'combat', 'wuffdrache', 0.001, 5400, 0, 0, 1000, 6000, false, 3, 4,
    'assets/dragons/breeding/egg/wuffdrache.png', 'assets/dragons/breeding/baby/wuffdrache.png', 'assets/dragons/breeding/teen/wuffdrache.png', 'assets/dragons/breeding/adult/wuffdrache.png', 6),
  ('koradrache', 'Koradrache', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/koradrache.png', 'assets/dragons/breeding/baby/koradrache.png', 'assets/dragons/breeding/teen/koradrache.png', 'assets/dragons/breeding/adult/koradrache.png', 7),
  ('hakudrache', 'Hakudrache', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/hakudrache.png', 'assets/dragons/breeding/baby/hakudrache.png', 'assets/dragons/breeding/teen/hakudrache.png', 'assets/dragons/breeding/adult/hakudrache.png', 8),
  ('zerathor', 'Zerathor', 'legendaer', 'raid', null, 0.01, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/zerathor.png', 'assets/dragons/breeding/baby/zerathor.png', 'assets/dragons/breeding/teen/zerathor.png', 'assets/dragons/breeding/adult/zerathor.png', 9),
  ('yakshadrache', 'Yakshadrache', 'legendaer', 'raid', null, 0.01, 27000, 500000, 200, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/yakshadrache.png', 'assets/dragons/breeding/baby/yakshadrache.png', 'assets/dragons/breeding/teen/yakshadrache.png', 'assets/dragons/breeding/adult/yakshadrache.png', 10),
  ('obsidrache', 'Obsidrache', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/obsidrache.png', 'assets/dragons/breeding/baby/obsidrache.png', 'assets/dragons/breeding/teen/obsidrache.png', 'assets/dragons/breeding/adult/obsidrache.png', 11),
  ('kowalski', 'Kowalski', 'episch', 'event', null, 0, 10800, 0, 0, 2000, 15000, false, 3, 4,
    'assets/dragons/breeding/egg/kowalski.png', 'assets/dragons/breeding/baby/kowalski.png', 'assets/dragons/breeding/teen/kowalski.png', 'assets/dragons/breeding/adult/kowalski.png', 12)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  source_dragon_id = excluded.source_dragon_id, egg_drop_chance = excluded.egg_drop_chance,
  brood_seconds = excluded.brood_seconds, sacrifice_gold = excluded.sacrifice_gold,
  sacrifice_crystals = excluded.sacrifice_crystals, growth_points_required = excluded.growth_points_required,
  battle_xp_required = excluded.battle_xp_required, is_multi_stat = excluded.is_multi_stat,
  sub_stat_count_min = excluded.sub_stat_count_min, sub_stat_count_max = excluded.sub_stat_count_max,
  egg_image = excluded.egg_image, baby_image = excluded.baby_image, teen_image = excluded.teen_image,
  adult_image = excluded.adult_image, sort_order = excluded.sort_order;

/* ---------------- idle_dragons: 2 neue Roster-Eintraege ----------------
   Winddrache + Aureliadrache muessen im normalen Kampf-Roster existieren,
   damit ihr Ei ueberhaupt eine Kill-Quelle hat (siehe egg_source='combat'
   oben). Werte/Balance analog zu den bestehenden Nachbarn ihrer Stufe. */
insert into public.idle_dragons (id, name, emoji, color_theme, tier_order, base_hp, base_attack, base_defense, gold_reward_base, xp_reward_base, wood_reward_base, stone_reward_base, crystal_reward_base, essence_reward_base, is_boss, active)
values
  ('winddrache', 'Winddrache', '🌪️', '#5eead4', 4, 130, 13, 3, 6, 6, 2, 2, 0, 0, false, true),
  ('aureliadrache', 'Aureliadrache', '💫', '#fbbf24', 9, 260, 24, 8, 11, 11, 3, 3, 1, 0, false, true)
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji, color_theme = excluded.color_theme,
  tier_order = excluded.tier_order, base_hp = excluded.base_hp, base_attack = excluded.base_attack,
  base_defense = excluded.base_defense, gold_reward_base = excluded.gold_reward_base,
  xp_reward_base = excluded.xp_reward_base, wood_reward_base = excluded.wood_reward_base,
  stone_reward_base = excluded.stone_reward_base, crystal_reward_base = excluded.crystal_reward_base,
  essence_reward_base = excluded.essence_reward_base, active = excluded.active;
-- Hinweis: tier_order 4/9 reihen sich zwischen die bestehenden Eintraege ein
-- (siehe idledorf.js BKMP_IDLE_FALLBACK_DRAGONS fuer die vollstaendige
-- Reihenfolge) - bei Bedarf im Admin-Panel per tier_order nachjustierbar,
-- ohne dass diese Migration erneut angepasst werden muss.

/* ---------------- player_dragon_eggs (Eierlager) ---------------- */
create table if not exists public.player_dragon_eggs (
  id uuid primary key default gen_random_uuid(),
  name_key text not null,
  auth_user_id uuid not null,
  species_id text not null references public.dragon_species(id),
  created_at timestamptz not null default now()
);
create index if not exists player_dragon_eggs_owner_idx on public.player_dragon_eggs (auth_user_id);

alter table public.player_dragon_eggs enable row level security;

drop policy if exists "Public read player dragon eggs" on public.player_dragon_eggs;
create policy "Public read player dragon eggs" on public.player_dragon_eggs for select to anon, authenticated using (true);

drop policy if exists "Owner insert player dragon eggs" on public.player_dragon_eggs;
create policy "Owner insert player dragon eggs" on public.player_dragon_eggs for insert to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "Owner delete player dragon eggs" on public.player_dragon_eggs;
create policy "Owner delete player dragon eggs" on public.player_dragon_eggs for delete to authenticated
using (auth_user_id = auth.uid());

/* ---------------- player_dragon_nests (Brutplaetze) ----------------
   Ein Nest-Slot = eine Zeile; EXISTENZ der Zeile = freigeschaltet (Slot 1
   wird beim ersten Laden lazy angelegt, genau wie idle_event_dragon_state
   "on conflict do nothing" - kein Cron/Trigger noetig). Weitere Slots
   entstehen erst beim Kauf. egg_id/started_at = null bedeutet leeres Nest.

   Konkurrenz-Schutz beim Ausbrueten: der Client raeumt egg_id/started_at
   per UPDATE ... WHERE id = eggId (optimistic, wie der last_seen_at-Guard
   in api/claim-idle-offline-progress.js) - zwei gleichzeitige Klicks auf
   "Abholen" treffen beim zweiten Versuch auf ein bereits geleertes Nest
   und laufen ins Leere, statt den Drachen doppelt anzulegen. */
create table if not exists public.player_dragon_nests (
  id uuid primary key default gen_random_uuid(),
  name_key text not null,
  auth_user_id uuid not null,
  slot_index smallint not null,
  egg_id uuid references public.player_dragon_eggs(id) on delete set null,
  started_at timestamptz,
  unique (auth_user_id, slot_index)
);
create index if not exists player_dragon_nests_owner_idx on public.player_dragon_nests (auth_user_id);

alter table public.player_dragon_nests enable row level security;

drop policy if exists "Public read player dragon nests" on public.player_dragon_nests;
create policy "Public read player dragon nests" on public.player_dragon_nests for select to anon, authenticated using (true);

drop policy if exists "Owner insert player dragon nests" on public.player_dragon_nests;
create policy "Owner insert player dragon nests" on public.player_dragon_nests for insert to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "Owner update player dragon nests" on public.player_dragon_nests;
create policy "Owner update player dragon nests" on public.player_dragon_nests for update to authenticated
using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

/* ---------------- player_dragons (geschluepfte/aufwachsende/erwachsene Drachen) ----------------
   Haupt-/Nebenwerte exakt nach dem Runen-Vorbild: einmal gewuerfelt beim
   Erreichen von 'adult', danach nie wieder veraendert. Bei Nicht-legendaeren
   Arten ist genau EINE der drei stat_*-Spalten befuellt (main_stat_key
   dokumentiert welche), bei legendaeren alle drei gleichzeitig. */
create table if not exists public.player_dragons (
  id uuid primary key default gen_random_uuid(),
  name_key text not null,
  auth_user_id uuid not null,
  species_id text not null references public.dragon_species(id),
  nickname text,
  stage text not null default 'baby' check (stage in ('baby', 'teen', 'adult')),
  food_preference text not null check (food_preference in ('fruit', 'meat')),
  growth_points integer not null default 0,
  battle_xp integer not null default 0,
  is_companion boolean not null default false,
  is_favorite boolean not null default false,
  main_stat_key text check (main_stat_key in ('attack', 'defense', 'hp', 'multi')),
  stat_attack numeric not null default 0,
  stat_defense numeric not null default 0,
  stat_hp numeric not null default 0,
  substats jsonb not null default '[]'::jsonb,
  hatched_at timestamptz not null default now(),
  adult_at timestamptz
);
create index if not exists player_dragons_owner_idx on public.player_dragons (auth_user_id);
-- Nur EIN aktiver Begleitdrache gleichzeitig pro Spieler (Spieler-Vorgabe:
-- "Der Spieler kann einen jugendlichen Drachen als aktiven Begleitdrachen
-- auswaehlen" - Einzahl). Partial unique index statt Trigger: einfacher,
-- gleiche Technik wie andernorts im Projekt fuer "genau ein aktiver X".
create unique index if not exists player_dragons_one_companion_idx
  on public.player_dragons (auth_user_id) where (is_companion = true);

alter table public.player_dragons enable row level security;

drop policy if exists "Public read player dragons" on public.player_dragons;
create policy "Public read player dragons" on public.player_dragons for select to anon, authenticated using (true);

drop policy if exists "Owner insert player dragons" on public.player_dragons;
create policy "Owner insert player dragons" on public.player_dragons for insert to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "Owner update player dragons" on public.player_dragons;
create policy "Owner update player dragons" on public.player_dragons for update to authenticated
using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

drop policy if exists "Owner delete player dragons" on public.player_dragons;
create policy "Owner delete player dragons" on public.player_dragons for delete to authenticated
using (auth_user_id = auth.uid());

/* ---------------- idle_player_state: neue Ressourcen + Gebaeude ----------------
   fruit/meat wie gold/wood/stone precedent (bigint, default 0).
   obstgarten_level/jagdhuette_level: 0 = noch nicht gebaut, 1 = Grundstufe.
   *_collected_at: Zeitstempel fuer die zeitbasierte Produktion (gleiches
   Prinzip wie last_seen_at fuer den Offline-Fortschritt), rein clientseitig
   ausgewertet - siehe idledorf.js bkmpIdleCollectBuildingResource(). */
alter table public.idle_player_state add column if not exists fruit bigint not null default 0;
alter table public.idle_player_state add column if not exists meat bigint not null default 0;
alter table public.idle_player_state add column if not exists obstgarten_level integer not null default 0;
alter table public.idle_player_state add column if not exists jagdhuette_level integer not null default 0;
alter table public.idle_player_state add column if not exists fruit_collected_at timestamptz not null default now();
alter table public.idle_player_state add column if not exists meat_collected_at timestamptz not null default now();

/* ---------------- raid_finish: 2 zusaetzliche unabhaengige Ei-Wuerfe ----------------
   Gleicher Mechanismus wie der 1%-Zerathor-Dorf-Skin-Wurf
   (supabase-idle-village-skins-zerathordorf.sql) - ABER bewusst OHNE
   "schon besessen?"-Sperre: legendaere Eier duerfen sich laut Vorgabe
   duplizieren ("lohnt sich, mehrere Eier desselben legendaeren Drachen
   auszubrueten"), jeder Sieg ist ein unabhaengiger Wurf. */
create or replace function public.raid_finish(p_raid_id text, p_result text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boss_reward record;
  v_city_hp bigint;
  v_city_max_hp bigint;
  v_mvp_uid uuid;
  v_flawless boolean;
  rec record;
  v_owns_zerator boolean;
  v_code text;
  v_attempt int;
  v_owns_zerathordorf boolean;
begin
  update public.raid_instances
  set status = p_result, ended_at = now()
  where id = p_raid_id and status = 'fighting';
  if not found then return; end if;

  select ri.city_hp, ri.city_max_hp into v_city_hp, v_city_max_hp
  from public.raid_instances ri where ri.id = p_raid_id;
  v_flawless := (v_city_max_hp > 0 and v_city_hp >= v_city_max_hp);

  select auth_user_id into v_mvp_uid
  from public.raid_participants where raid_id = p_raid_id order by damage_dealt desc limit 1;

  if p_result = 'won' then
    select rb.gold_reward, rb.gem_reward, rb.xp_reward into v_boss_reward
    from public.raid_instances ri join public.raid_bosses rb on rb.id = ri.boss_id
    where ri.id = p_raid_id;

    for rec in select * from public.raid_participants where raid_id = p_raid_id loop
      update public.idle_player_state
      set gold = gold + v_boss_reward.gold_reward,
          total_gold_earned = total_gold_earned + v_boss_reward.gold_reward,
          crystals = crystals + v_boss_reward.gem_reward,
          xp = xp + v_boss_reward.xp_reward
      where auth_user_id = rec.auth_user_id;

      update public.raid_player_stats
      set total_bosses_defeated = total_bosses_defeated + 1,
          total_mvp_count = total_mvp_count + (case when rec.auth_user_id = v_mvp_uid then 1 else 0 end),
          total_flawless_wins = total_flawless_wins + (case when v_flawless then 1 else 0 end),
          updated_at = now()
      where auth_user_id = rec.auth_user_id;

      select exists(
        select 1 from public.user_plushies
        where name_key = lower(trim(rec.display_name)) and plushie_id = 'zerathor_zorn_der_verdammnis'
      ) into v_owns_zerator;

      if not v_owns_zerator and random() < 0.05 then
        v_code := null;
        for v_attempt in 1..5 loop
          begin
            v_code := 'ZERATOR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
            insert into public.plushie_codes (code, plushie_id, note, created_by_admin)
            values (v_code, 'zerathor_zorn_der_verdammnis', 'Automatische 5%-Raidboss-Belohnung fuer ' || rec.display_name || ' (Raid ' || p_raid_id || ').', 'system');
            exit;
          exception when unique_violation then
            v_code := null;
          end;
        end loop;

        if v_code is not null then
          insert into public.raid_reward_codes (raid_id, name_key, display_name, plushie_id, code)
          values (p_raid_id, lower(trim(rec.display_name)), rec.display_name, 'zerathor_zorn_der_verdammnis', v_code)
          on conflict (raid_id, name_key) do nothing;
        end if;
      end if;

      select exists(
        select 1 from public.idle_player_village_skins
        where auth_user_id = rec.auth_user_id and skin_id = 'zerathordorf'
      ) into v_owns_zerathordorf;

      if not v_owns_zerathordorf and random() < 0.01 then
        insert into public.idle_player_village_skins (name_key, auth_user_id, skin_id)
        values (lower(trim(rec.display_name)), rec.auth_user_id, 'zerathordorf')
        on conflict (auth_user_id, skin_id) do nothing;
      end if;

      -- Legendaere Dracheneier: unabhaengige Wuerfe, KEINE Besitz-Sperre
      -- (Duplikate sind gewollt, siehe Funktionskommentar oben).
      if random() < 0.01 then
        insert into public.player_dragon_eggs (name_key, auth_user_id, species_id)
        values (lower(trim(rec.display_name)), rec.auth_user_id, 'zerathor');
      end if;
      if random() < 0.01 then
        insert into public.player_dragon_eggs (name_key, auth_user_id, species_id)
        values (lower(trim(rec.display_name)), rec.auth_user_id, 'yakshadrache');
      end if;
    end loop;
  end if;
end;
$$;
grant execute on function public.raid_finish(text, text) to authenticated;

/* ---------------- claim_epic_dragon_egg: einmalige Belohnung fuer 2 Meilensteine ----------------
   Idempotenz-Muster 1:1 wie idle_claim_event_dragon_victory
   (supabase-idle-event-dragons.sql): security definer, Row-Lock, boolesches
   Rueckgabe-Paar (already_claimed, newly_claimed) statt eines rohen
   Fehlers, damit der Client "schon geholt" sauber von "gerade erhalten"
   unterscheiden kann. p_milestone ist bewusst ein text-Parameter (nicht pro
   Meilenstein eine eigene Funktion), damit spaetere weitere epische
   Ei-Quellen ohne neue Migration ergaenzt werden koennen. */
create table if not exists public.player_epic_egg_claims (
  name_key text not null,
  auth_user_id uuid not null,
  milestone text not null,
  claimed_at timestamptz not null default now(),
  primary key (auth_user_id, milestone)
);
alter table public.player_epic_egg_claims enable row level security;
drop policy if exists "Public read epic egg claims" on public.player_epic_egg_claims;
create policy "Public read epic egg claims" on public.player_epic_egg_claims for select to anon, authenticated using (true);

create or replace function public.claim_epic_dragon_egg(p_name_key text, p_display_name text, p_milestone text, p_species_id text)
returns table (already_claimed boolean, newly_claimed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_existing record;
begin
  select auth_user_id into v_uid from public.idle_player_state where name_key = lower(trim(p_name_key)) limit 1;
  if v_uid is null then
    return query select false, false;
    return;
  end if;

  select * into v_existing from public.player_epic_egg_claims
  where auth_user_id = v_uid and milestone = p_milestone for update;

  if found then
    return query select true, false;
    return;
  end if;

  insert into public.player_epic_egg_claims (name_key, auth_user_id, milestone)
  values (lower(trim(p_name_key)), v_uid, p_milestone);

  insert into public.player_dragon_eggs (name_key, auth_user_id, species_id)
  values (lower(trim(p_name_key)), v_uid, p_species_id);

  return query select false, true;
end;
$$;
grant execute on function public.claim_epic_dragon_egg(text, text, text, text) to authenticated;
