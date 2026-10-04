-- ============================================================
-- Drachendorf-Ausbau Phase 9 (04.10.2026): Lightnix + Darknix
--
-- Zwei getrennte Arten (keine Variante derselben Art), beide mit fuenf
-- Entwicklungsstufen: Ei -> Baby -> Jugendlich -> Erwachsen -> Goettlich.
-- Alles datengetrieben ueber die Zusatzspalten aus 20261004-01:
--   stage_count = 5, final_stage_key 'divine', final_stage_label 'Göttlich',
--   divine_image, event_origin 'zwielicht', unique_per_account = true,
--   reward_group 'zwielicht', special_passive (goettliche Aura),
--   divine_config (Voraussetzungen der Goettlichen Erweckung, Phase 10).
-- Seltenheit: 'legendaer' (vorhandenes System, "Goettlich" ist eine Stufe,
-- keine Seltenheit). Kein normaler Ei-Wurf: egg_source 'event' +
-- event_origin/unique_per_account schliessen sie im Spiel aus
-- (bkmpDragonEggPoolEligible), zusaetzlich die Schutz-Trigger unten.
--
-- Schutz:
--   * Eier dieser Arten lassen sich nur serverseitig anlegen
--     (event_choose_reward setzt bkmp.trusted) - nie aus dem Browser.
--   * Ein Drache dieser Arten entsteht nur durch Schluepfen eines echten
--     Eies derselben Art, und hoechstens einer pro Konto.
--
-- Bilder: assets/dragons/breeding/{egg,baby,teen,adult,divine}/{lightnix,darknix}.png
-- (+ -web.png/-web.webp). Alle 10 lagen freigestellt vor.
--
-- Voraussetzung: 20261004-01. NOCH NICHT AUSGEFUEHRT. Idempotent.
-- ============================================================

insert into public.dragon_species (id, name, rarity, egg_source, source_dragon_id, egg_drop_chance, brood_seconds,
  sacrifice_gold, sacrifice_crystals, growth_points_required, battle_xp_required, is_multi_stat,
  sub_stat_count_min, sub_stat_count_max, egg_image, baby_image, teen_image, adult_image, sort_order)
values
  ('lightnix', 'Lightnix', 'legendaer', 'event', null, 0, 27000, 0, 0, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/lightnix.png', 'assets/dragons/breeding/baby/lightnix.png',
    'assets/dragons/breeding/teen/lightnix.png', 'assets/dragons/breeding/adult/lightnix.png', 90),
  ('darknix', 'Darknix', 'legendaer', 'event', null, 0, 27000, 0, 0, 6000, 50000, true, 4, 5,
    'assets/dragons/breeding/egg/darknix.png', 'assets/dragons/breeding/baby/darknix.png',
    'assets/dragons/breeding/teen/darknix.png', 'assets/dragons/breeding/adult/darknix.png', 91)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, egg_source = excluded.egg_source,
  egg_drop_chance = excluded.egg_drop_chance, brood_seconds = excluded.brood_seconds,
  sacrifice_gold = excluded.sacrifice_gold, sacrifice_crystals = excluded.sacrifice_crystals,
  growth_points_required = excluded.growth_points_required, battle_xp_required = excluded.battle_xp_required,
  is_multi_stat = excluded.is_multi_stat, sub_stat_count_min = excluded.sub_stat_count_min,
  sub_stat_count_max = excluded.sub_stat_count_max, egg_image = excluded.egg_image, baby_image = excluded.baby_image,
  teen_image = excluded.teen_image, adult_image = excluded.adult_image, sort_order = excluded.sort_order;

-- Goettliche Auren: nur aktiv, solange der Drache GOETTLICH und als
-- Kampfbegleiter ausgeruestet ist. Gleichwertig, nur andere Spielweise:
--   Licht = Schutz/Stabilitaet/Team, Dunkelheit = Offensive/seltene Funde.
-- "effects" nutzen dieselben Schluessel wie Drachen-Zusatzwerte (bestehende
-- Deckel greifen), "expedition" wirkt in expedition_start (20261004-03).
update public.dragon_species set
  affinities = array['licht'],
  stage_count = 5, final_stage_key = 'divine', final_stage_label = 'Göttlich',
  divine_image = 'assets/dragons/breeding/divine/lightnix.png',
  event_origin = 'zwielicht', unique_per_account = true, reward_group = 'zwielicht',
  special_passive = '{"divine_aura": {"name": "Göttliche Aura des Lichts", "icon": "☀️",
    "text": "Schützt dein Dorf: +6 % Verteidigung, +6 % Leben, +4 % Schildstärke. Auf Expeditionen: +6 Teampunkte für eine stabilere Qualität.",
    "effects": {"defense_pct": 6, "hp_pct": 6, "shield_regen": 4},
    "expedition": {"score_bonus": 6}}}'::jsonb,
  divine_config = '{"bond_level": 5, "companion_hours": 10, "companion_boss_kills": 50, "expeditions": 10,
    "offering_gold_units": 600000, "crystals": 2000, "essence": 1000,
    "stat_multiplier": 1.25, "substat_multiplier": 1.125}'::jsonb
where id = 'lightnix';

update public.dragon_species set
  affinities = array['dunkel'],
  stage_count = 5, final_stage_key = 'divine', final_stage_label = 'Göttlich',
  divine_image = 'assets/dragons/breeding/divine/darknix.png',
  event_origin = 'zwielicht', unique_per_account = true, reward_group = 'zwielicht',
  special_passive = '{"divine_aura": {"name": "Göttliche Aura der Finsternis", "icon": "🌑",
    "text": "Stärkt deine Angriffe: +6 % Angriff, +8 % Krit-Schaden, +4 % Gold. Auf Expeditionen: +10 % Kristalle und Essenz und öfter besondere Ereignisse.",
    "effects": {"attack_pct": 6, "crit_damage_pct": 8, "gold_find_pct": 4},
    "expedition": {"reward_pct": 10, "event_bonus": 0.05}}}'::jsonb,
  divine_config = '{"bond_level": 5, "companion_hours": 10, "companion_boss_kills": 50, "expeditions": 10,
    "offering_gold_units": 600000, "crystals": 2000, "essence": 1000,
    "stat_multiplier": 1.25, "substat_multiplier": 1.125}'::jsonb
where id = 'darknix';

-- ---------- Schutz 1: Eier von Event-/Einzelstueck-Arten nur serverseitig ----------
create or replace function public.player_dragon_eggs_event_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('bkmp.trusted', true), '') = 'on' then return NEW; end if;
  if exists (select 1 from public.dragon_species ds
              where ds.id = NEW.species_id and (ds.unique_per_account or ds.event_origin is not null)) then
    raise exception 'event_species_egg_not_allowed';
  end if;
  return NEW;
end;
$$;
drop trigger if exists player_dragon_eggs_event_guard_trg on public.player_dragon_eggs;
create trigger player_dragon_eggs_event_guard_trg
  before insert on public.player_dragon_eggs
  for each row execute function public.player_dragon_eggs_event_guard();

-- ---------- Schutz 2: Einzelstueck-Drachen nur aus eigenem Ei, max. 1 ----------
-- Laeuft nach player_dragons_protect_trusted_trg (Trigger-Reihenfolge =
-- alphabetisch) und setzt dort die Event-Herkunft wieder.
create or replace function public.player_dragons_unique_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_sp public.dragon_species%rowtype;
begin
  select * into v_sp from public.dragon_species ds where ds.id = NEW.species_id;
  if not found or not coalesce(v_sp.unique_per_account, false) then return NEW; end if;
  if exists (select 1 from public.player_dragons pd
              where pd.auth_user_id = NEW.auth_user_id and pd.species_id = NEW.species_id) then
    raise exception 'unique_species_already_owned';
  end if;
  if coalesce(current_setting('bkmp.trusted', true), '') <> 'on'
     and not exists (select 1 from public.player_dragon_eggs e
                      where e.auth_user_id = NEW.auth_user_id and e.species_id = NEW.species_id) then
    raise exception 'unique_species_needs_egg';
  end if;
  NEW.origin_event := v_sp.event_origin;
  return NEW;
end;
$$;
drop trigger if exists player_dragons_unique_guard_trg on public.player_dragons;
create trigger player_dragons_unique_guard_trg
  before insert on public.player_dragons
  for each row execute function public.player_dragons_unique_guard();

notify pgrst, 'reload schema';
