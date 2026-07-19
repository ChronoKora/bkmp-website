-- Bkmp - Seltene Event-Easter-Egg-Drachen (Shenloss / Ganz Liber Drache)
-- + Zerator-Pluschie als 5%-Raidboss-Belohnung.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Braucht: supabase-idle-dorf-schema.sql, supabase-idle-dorf-rework.sql
-- (idle_dragons.spawn_rule-Spalte + Check-Constraint), supabase-player-
-- accounts.sql (idle_player_state.auth_user_id), supabase-raid-boss-
-- schema.sql (raid_finish wird hier per "create or replace" um den
-- Zerator-Wurf erweitert, die komplette bisherige Logik bleibt 1:1
-- erhalten), supabase-plushies-schema.sql (plushie_codes/user_plushies).

-- ============================================================
-- 0) idle_dragons: neue spawn_rule 'event_easter' erlauben + die beiden
--    Event-Drachen eintragen. base_hp/base_attack werden fuer diese
--    spawn_rule vom Client ignoriert (siehe bkmpIdleEventDragonScaledStats
--    in idledorf.js - eigene, spielerstaerke-abhaengige Formel statt der
--    normalen Stufen-Wachstumskurve), die Belohnungsbasis (gold/xp/...)
--    gilt aber normal weiter.
-- ============================================================
alter table public.idle_dragons drop constraint if exists idle_dragons_spawn_rule_check;
alter table public.idle_dragons add constraint idle_dragons_spawn_rule_check
  check (spawn_rule in ('standard', 'miniboss_10', 'boss_25', 'rare', 'event_easter'));

insert into public.idle_dragons
  (id, name, emoji, sprite_key, spawn_rule, color_theme, tier_order, base_hp, base_attack, base_defense,
   gold_reward_base, xp_reward_base, wood_reward_base, stone_reward_base, crystal_reward_base, essence_reward_base, is_boss) values
  ('shenloss', 'Shenloss', '🐲', 'shenloss', 'event_easter', '#22c55e', 8, 1, 1, 2, 250, 250, 10, 10, 20, 15, false),
  ('liber',    'Ganz Liber Drache', '🐉', 'liber', 'event_easter', '#e5e7eb', 9, 1, 1, 2, 250, 250, 10, 10, 20, 15, false)
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji, sprite_key = excluded.sprite_key, spawn_rule = excluded.spawn_rule,
  color_theme = excluded.color_theme, tier_order = excluded.tier_order, base_hp = excluded.base_hp,
  base_attack = excluded.base_attack, base_defense = excluded.base_defense, gold_reward_base = excluded.gold_reward_base,
  xp_reward_base = excluded.xp_reward_base, wood_reward_base = excluded.wood_reward_base, stone_reward_base = excluded.stone_reward_base,
  crystal_reward_base = excluded.crystal_reward_base, essence_reward_base = excluded.essence_reward_base, is_boss = excluded.is_boss;

-- ============================================================
-- 1) idle_event_dragon_state - dauerhafter Sieg-Status pro Spieler.
--    Bewusst NICHT ueber die normale idle_player_state-Tabelle (die hat
--    eine voll offene anon/authenticated-Update-Policy fuer den
--    Spielstand) - dieser einmalige Sieg + der daraus folgende Titel
--    sollen nicht per einfachem Client-UPDATE faelschbar sein. Es gibt
--    daher absichtlich KEINE Insert/Update/Delete-Policy fuer
--    anon/authenticated - schreiben geht ausschliesslich ueber die
--    SECURITY DEFINER-Funktion unten.
-- ============================================================
create table if not exists public.idle_event_dragon_state (
  name_key text primary key,
  display_name text not null default '',
  auth_user_id uuid,
  shenloss_defeated boolean not null default false,
  shenloss_defeated_at timestamptz,
  liber_defeated boolean not null default false,
  liber_defeated_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.idle_event_dragon_state enable row level security;
grant select on public.idle_event_dragon_state to anon, authenticated;

drop policy if exists "Public read event dragon state" on public.idle_event_dragon_state;
create policy "Public read event dragon state" on public.idle_event_dragon_state
  for select to anon, authenticated using (true);

-- 2) idle_claim_event_dragon_victory - einziger Weg, einen Sieg
--    einzutragen. Idempotent (zweiter Aufruf fuer denselben Drachen
--    aendert nichts mehr und meldet newly_defeated=false), damit weder
--    Doppel-Klicks auf den Ergebnis-Button noch ein erneuter Aufruf nach
--    Reload den Titel doppelt "vergeben" (Titel selbst sind ohnehin rein
--    ueber unlockCustom berechnet, aber der Zeitstempel/die Erfolgs-
--    Meldung soll trotzdem nur einmal echt neu ausgeloest werden).
--    Falls die Zeile schon einem anderen eingeloggten Account gehoert
--    (auth_user_id gesetzt und != auth.uid()), wird abgelehnt - verhindert,
--    dass jemand ueber einen fremden Namen den Sieg eines anderen Accounts
--    "mitbenutzt". Gast-Zeilen (auth_user_id ist null) bleiben ueber den
--    Namen ansprechbar, genau wie der Rest des Idle-Dorf-Spielstands fuer
--    Gaeste auch.
create or replace function public.idle_claim_event_dragon_victory(
  p_name_key text,
  p_display_name text,
  p_dragon_key text
)
returns table (already_defeated boolean, newly_defeated boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.idle_event_dragon_state;
begin
  if p_dragon_key not in ('shenloss', 'liber') then
    raise exception 'invalid_dragon';
  end if;
  if p_name_key is null or length(trim(p_name_key)) = 0 then
    raise exception 'missing_name';
  end if;

  insert into public.idle_event_dragon_state (name_key, display_name, auth_user_id)
  values (lower(trim(p_name_key)), coalesce(p_display_name, p_name_key), v_uid)
  on conflict (name_key) do nothing;

  select * into v_row from public.idle_event_dragon_state where name_key = lower(trim(p_name_key)) for update;

  if v_row.auth_user_id is not null and v_uid is not null and v_row.auth_user_id <> v_uid then
    raise exception 'name_owned_by_other_account';
  end if;
  -- Zeile gehoerte bisher einem Gast (kein auth_user_id) und wird jetzt von
  -- einem eingeloggten Account beansprucht - ab hier daran binden.
  if v_row.auth_user_id is null and v_uid is not null then
    update public.idle_event_dragon_state set auth_user_id = v_uid where name_key = v_row.name_key;
  end if;

  if p_dragon_key = 'shenloss' then
    if v_row.shenloss_defeated then
      return query select true, false;
      return;
    end if;
    update public.idle_event_dragon_state
    set shenloss_defeated = true, shenloss_defeated_at = now(), display_name = coalesce(p_display_name, display_name), updated_at = now()
    where name_key = v_row.name_key;
    return query select false, true;
  else
    if v_row.liber_defeated then
      return query select true, false;
      return;
    end if;
    update public.idle_event_dragon_state
    set liber_defeated = true, liber_defeated_at = now(), display_name = coalesce(p_display_name, display_name), updated_at = now()
    where name_key = v_row.name_key;
    return query select false, true;
  end if;
end;
$$;
grant execute on function public.idle_claim_event_dragon_victory(text, text, text) to anon, authenticated;

-- ============================================================
-- 3) raid_reward_codes - personalisierte Zuordnung "welcher Spieler hat
--    bei welchem Raid welchen Belohnungscode bekommen" (der Code selbst
--    liegt zusaetzlich in der schon vorhandenen plushie_codes-Tabelle,
--    damit das bestehende, bereits getestete Einloese-Verfahren
--    (api/redeem-plushie-code.js) unveraendert weiterfunktioniert - hier
--    geht es nur darum, dass der gewinnende Client seinen eigenen Code
--    nach Raid-Ende wiederfinden kann, ohne dass er clientseitig erzeugt
--    oder erraten werden muss).
-- ============================================================
create table if not exists public.raid_reward_codes (
  id uuid primary key default gen_random_uuid(),
  raid_id text not null references public.raid_instances(id) on delete cascade,
  name_key text not null,
  display_name text not null,
  plushie_id text not null,
  code text not null,
  created_at timestamptz not null default now(),
  unique (raid_id, name_key)
);

create index if not exists raid_reward_codes_raid_idx on public.raid_reward_codes (raid_id);
create index if not exists raid_reward_codes_name_idx on public.raid_reward_codes (name_key);

alter table public.raid_reward_codes enable row level security;
grant select on public.raid_reward_codes to anon, authenticated;

drop policy if exists "Public read raid reward codes" on public.raid_reward_codes;
create policy "Public read raid reward codes" on public.raid_reward_codes
  for select to anon, authenticated using (true);
-- Auch hier bewusst keine Schreib-Policy - nur raid_finish() (security
-- definer, siehe unten) legt Zeilen an.

-- ============================================================
-- 4) raid_finish neu definieren: 1:1 dieselbe bisherige Logik (Gold/
--    Kristalle/XP, MVP, Flawless), zusaetzlich am Ende JE GEWINNENDEM
--    TEILNEHMER einmalig 5% Chance auf einen Zerator-Pluschie-Code -
--    nur wenn der Raid wirklich gewonnen wurde (p_result = 'won', wie
--    beim Rest der Belohnungen) und der Spieler das Pluschie noch nicht
--    besitzt. Die aeussere "nur einmal pro Raid ausfuehren"-Sperre
--    (update ... where status = 'fighting', "if not found then return")
--    bleibt unveraendert die einzige Instanz dieser Funktion, die je
--    fuer einen gegebenen Raid laeuft - der Zerator-Wurf erbt diese
--    Einmaligkeit automatisch mit, ganz ohne eigene Zusatz-Sperre.
-- ============================================================
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

      -- Zerator-Pluschie: 5% Chance, nur wenn noch nicht im Besitz.
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
    end loop;
  end if;
end;
$$;
grant execute on function public.raid_finish(text, text) to authenticated;
