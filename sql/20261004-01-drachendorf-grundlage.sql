-- ============================================================
-- Drachendorf-Ausbau - Grundlage (04.10.2026)
--   1) dragon_species: datengetriebene Zusatzfelder (Affinitaeten,
--      optionale fuenfte Form, Event-Herkunft, Einzelstueck-Regel,
--      Spezial-Passive) + Affinitaeten fuer alle bekannten Arten
--   2) player_dragons: neue Felder fuer Eigenschaft (Trait), Bindung,
--      echte Nutzung, Expeditionen, Goettliche Erweckung, Event-Herkunft
--   3) Schutz: diese neuen Felder (und die Stufe "divine") koennen NUR von
--      serverseitigen Funktionen geschrieben werden, nie direkt vom Spiel
--      aus dem Browser.
--
-- NOCH NICHT AUSGEFUEHRT. Reihenfolge der Drachendorf-Dateien:
--   (falls noch offen) 20261003-dragon-species-neue-drachen2.sql,
--   20261003-dragon-species-dracheeeee.sql, dann
--   20261004-01 -> 20261004-02 -> 20261004-03 -> ...
-- Idempotent und rein additiv. Bestehende Werte werden nicht veraendert
-- (ausser die neuen Affinitaets-Spalten werden befuellt).
--
-- Hinweis fuer manuelle Korrekturen im SQL-Editor: die geschuetzten Felder
-- lassen sich nur nach "select set_config('bkmp.trusted', 'on', true);" im
-- selben Ausfuehrungsblock aendern (gilt nur fuer diese Transaktion).
-- ============================================================

-- ---------- 1) dragon_species ----------
alter table public.dragon_species add column if not exists affinities text[] not null default '{}'::text[];
alter table public.dragon_species add column if not exists stage_count integer not null default 4;
alter table public.dragon_species add column if not exists final_stage_key text;
alter table public.dragon_species add column if not exists final_stage_label text;
alter table public.dragon_species add column if not exists divine_image text;
alter table public.dragon_species add column if not exists event_origin text;
alter table public.dragon_species add column if not exists unique_per_account boolean not null default false;
alter table public.dragon_species add column if not exists reward_group text;
alter table public.dragon_species add column if not exists special_passive jsonb;
alter table public.dragon_species add column if not exists divine_config jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dragon_species_affinities_valid') then
    alter table public.dragon_species add constraint dragon_species_affinities_valid
      check (affinities <@ array['feuer','wasser','erde','wind','blitz','licht','dunkel','arkan','neutral']::text[]
             and coalesce(array_length(affinities, 1), 0) <= 2);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dragon_species_stage_count_valid') then
    alter table public.dragon_species add constraint dragon_species_stage_count_valid check (stage_count in (4, 5));
  end if;
end $$;

-- Affinitaeten (1-2 pro Art), nach dem Erscheinungsbild der erwachsenen Form.
-- Zeilen, die (noch) nicht existieren, werden einfach uebersprungen.
update public.dragon_species ds set affinities = v.aff
from (values
  ('feuerdrache',    array['feuer']),
  ('wasserdrache',   array['wasser']),
  ('winddrache',     array['wind']),
  ('blitzdrache',    array['blitz']),
  ('aureliadrache',  array['feuer']),
  ('schattendrache', array['dunkel','feuer']),
  ('wuffdrache',     array['erde']),
  ('koradrache',     array['arkan','licht']),
  ('hakudrache',     array['arkan','wind']),
  ('zerathor',       array['dunkel','arkan']),
  ('yakshadrache',   array['feuer','dunkel']),
  ('obsidrache',     array['licht','arkan']),
  ('kowalski',       array['wasser','wind']),
  ('byte',           array['blitz']),
  ('enderdrachen',   array['dunkel','arkan']),
  ('kaledoss',       array['wasser','arkan']),
  ('nytherion',      array['dunkel','arkan']),
  ('phil',           array['erde','licht']),
  ('fynnow',         array['dunkel','wind']),
  ('vulkarion',      array['feuer','erde']),
  ('bloodterion',    array['dunkel','feuer']),
  ('gravoryx',       array['erde','dunkel']),
  ('lohendrache',    array['feuer','arkan']),
  ('darknisdrache',  array['dunkel','arkan']),
  ('bagon',          array['wasser']),
  ('bagondrache',    array['wasser']),
  ('almerio',        array['erde','wind']),
  ('alphorius',      array['licht','wasser']),
  ('dayman',         array['feuer']),
  ('grumpyjedi',     array['erde']),
  ('jodeljochen',    array['feuer','dunkel']),
  ('lukas',          array['wasser','wind']),
  ('maxender',       array['licht','erde']),
  ('miatao',         array['licht','arkan']),
  ('randomauto',     array['dunkel','blitz']),
  ('ronjawolf',      array['licht','wind']),
  ('scusy',          array['dunkel']),
  ('starmanius',     array['blitz','dunkel']),
  ('surebrec',       array['erde','licht']),
  ('troasa',         array['blitz','dunkel']),
  ('tsheyn',         array['feuer','wasser']),
  ('vaelith',        array['arkan','dunkel']),
  ('byalex',         array['blitz','wasser']),
  ('ccatched',       array['licht','blitz']),
  ('danw',           array['wasser','dunkel']),
  ('sunnyyvi',       array['licht','arkan'])
) as v(id, aff)
where ds.id = v.id and ds.affinities = '{}'::text[];

-- ---------- 2) player_dragons ----------
alter table public.player_dragons add column if not exists trait text;
alter table public.player_dragons add column if not exists bond_xp integer not null default 0;
alter table public.player_dragons add column if not exists companion_seconds bigint not null default 0;
alter table public.player_dragons add column if not exists companion_kills bigint not null default 0;
alter table public.player_dragons add column if not exists companion_boss_kills bigint not null default 0;
alter table public.player_dragons add column if not exists expeditions_completed integer not null default 0;
alter table public.player_dragons add column if not exists divine_offering_gold bigint not null default 0;
alter table public.player_dragons add column if not exists divine_multiplier numeric not null default 1;
alter table public.player_dragons add column if not exists awakened_at timestamptz;
alter table public.player_dragons add column if not exists origin_event text;

-- Stufe "divine" (fuenfte Form) erlauben - der bisherige Check kannte nur
-- baby/teen/adult. Name per Katalog suchen statt zu raten.
do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.player_dragons'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%stage%' and pg_get_constraintdef(c.oid) not ilike '%divine%'
  loop
    execute format('alter table public.player_dragons drop constraint %I', v_name);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'player_dragons_stage_valid') then
    alter table public.player_dragons add constraint player_dragons_stage_valid
      check (stage in ('baby', 'teen', 'adult', 'divine'));
  end if;
end $$;

-- ---------- 3) Schutz der serverseitigen Felder ----------
create or replace function public.player_dragons_protect_trusted()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('bkmp.trusted', true), '') = 'on' then
    return NEW;
  end if;
  if TG_OP = 'INSERT' then
    NEW.trait := null;
    NEW.bond_xp := 0;
    NEW.companion_seconds := 0;
    NEW.companion_kills := 0;
    NEW.companion_boss_kills := 0;
    NEW.expeditions_completed := 0;
    NEW.divine_offering_gold := 0;
    NEW.divine_multiplier := 1;
    NEW.awakened_at := null;
    NEW.origin_event := null;
    if NEW.stage = 'divine' then NEW.stage := 'adult'; end if;
    return NEW;
  end if;
  NEW.trait := OLD.trait;
  NEW.bond_xp := OLD.bond_xp;
  NEW.companion_seconds := OLD.companion_seconds;
  NEW.companion_kills := OLD.companion_kills;
  NEW.companion_boss_kills := OLD.companion_boss_kills;
  NEW.expeditions_completed := OLD.expeditions_completed;
  NEW.divine_offering_gold := OLD.divine_offering_gold;
  NEW.divine_multiplier := OLD.divine_multiplier;
  NEW.awakened_at := OLD.awakened_at;
  NEW.origin_event := OLD.origin_event;
  NEW.species_id := OLD.species_id;
  if OLD.stage = 'divine' then
    NEW.stage := 'divine';
  elsif NEW.stage = 'divine' then
    NEW.stage := OLD.stage;
  end if;
  return NEW;
end;
$$;

drop trigger if exists player_dragons_protect_trusted_trg on public.player_dragons;
create trigger player_dragons_protect_trusted_trg
  before insert or update on public.player_dragons
  for each row execute function public.player_dragons_protect_trusted();

notify pgrst, 'reload schema';
