-- Bkmp - Anti-Cheat STUFE 1: Wirtschafts-Plausibilitaet (Gold, Holz, Stein, Kristalle,
-- Essenz, Erfahrung) - 07.10.2026.
--
-- ANLASS: Ein Spieler hat in der Browser-Konsole ("Command Panel") direkt Werte
-- gesetzt (z. B. +95 Mio. Gold, 1e15). Das Spiel rechnet im Browser; der Browser
-- schickt den KOMPLETTEN Stand bei jedem Speichern an die Datenbank, und die
-- Datenbank hat bisher nur Kills, Level, Skillpunkte und die Kampfwerte geprueft -
-- Gold, Holz, Stein, Kristalle, Essenz und Erfahrung waren frei beschreibbar.
--
-- WAS DIESE DATEI TUT (Stufe 1 von 3):
--  * Neuer Trigger idle_player_state_economy_guard (laeuft NACH dem bestehenden
--    idle_player_state_anticheat_guard, der unveraendert bleibt).
--  * Er fuehrt pro Spieler ein "Wirtschafts-Konto" je Ressource: ein Guthaben, das
--    mit der Zeit nachlaeuft (Rate = hoechste plausible Einnahme pro Sekunde fuer
--    DIESEN Spieler: Drachenstufe, Boni, Angriff, Gebaeude) und bis zu einer
--    Obergrenze anwachsen darf. Jeder Zuwachs einer Ressource beim Speichern wird
--    davon abgezogen. Ist der Zuwachs groesser als das Guthaben -> Verstoss.
--  * STANDARD = NUR MELDEN. In idle_anticheat_settings steht enforce=false: es wird
--    protokolliert (idle_anticheat_flags, triggered_by='economy'), aber NICHTS
--    veraendert und niemand ausgeblendet. Erst nach Auswertung der Messwerte
--    (idle_economy_guard_state.peak_*) wird enforce=true gesetzt - Grund: am
--    11.08.2026 hat eine zu enge Grenze 33 echte Spieler faelschlich betroffen.
--  * Nur DIREKTE Schreibzugriffe des Browsers werden geprueft (Rolle authenticated/
--    anon). Serverfunktionen (Raid, Arena, Event, Expedition ...), der Offline-
--    Nachtrag (service_role) und Admins sind ausgenommen.
--
-- HERKUNFT: ein winziger zweiter Trigger (idle_player_state_0_origin_probe, laeuft
-- als Erster) merkt sich in der Transaktionsvariable bkmp.eco_origin, ob die
-- Aenderung direkt vom Browser kommt (current_user = authenticated/anon) oder aus
-- einer Serverfunktion (current_user = Funktionsbesitzer). Das ist reines Postgres-
-- Verhalten und braucht keine PostgREST-Einstellung.
--
-- FEHLERSICHER: der gesamte Pruef-Block steckt in einem BEGIN/EXCEPTION - ein Fehler
-- in der Pruefung blockiert NIE das Speichern (Lehre 11.08.2026).
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

-- ---------------------------------------------------------------- Einstellungen
create table if not exists public.idle_anticheat_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.idle_anticheat_settings enable row level security;
grant select, insert, update on public.idle_anticheat_settings to authenticated;
drop policy if exists "Admin manage anticheat settings" on public.idle_anticheat_settings;
create policy "Admin manage anticheat settings" on public.idle_anticheat_settings
  for all to authenticated using (public.is_active_admin()) with check (public.is_active_admin());

-- Standard: eingeschaltet, aber nur melden. Weitere Schluessel (alle optional):
--   safety (1), window_s (600), kps (3), bonus_cap_pct (2000), prod_mult (4 = Boost 1,25 x
--   Ueberladung 3), prod_hours_base (72), prod_hours_bonus (300, nur mit Prestige),
--   flag_throttle_s (600), f_gold/f_xp/f_wood/f_stone/f_crystals/
--   f_essence (40/40/30/30/20/15), floor_gold/floor_xp/floor_wood/floor_stone/
--   floor_crystals/floor_essence (300000/150000/20000/20000/2000/1500).
insert into public.idle_anticheat_settings (key, value)
values ('economy', jsonb_build_object('enabled', true, 'enforce', false))
on conflict (key) do nothing;

-- ---------------------------------------------------------------- Konto je Spieler
create table if not exists public.idle_economy_guard_state (
  owner_key text primary key,              -- auth_user_id (Text), sonst name_key
  name_key text,
  last_at timestamptz not null default now(),
  credit_gold numeric, credit_wood numeric, credit_stone numeric,
  credit_crystals numeric, credit_essence numeric, credit_xp numeric,
  -- Spitzenauslastung (Zuwachs / verfuegbares Guthaben, nie > 999): fuer die
  -- Auswertung vor dem Scharfschalten. >= 1 heisst: Grenze erreicht.
  peak_gold numeric not null default 0, peak_wood numeric not null default 0,
  peak_stone numeric not null default 0, peak_crystals numeric not null default 0,
  peak_essence numeric not null default 0, peak_xp numeric not null default 0,
  violations integer not null default 0,
  last_flag_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.idle_economy_guard_state enable row level security;
grant select on public.idle_economy_guard_state to authenticated;
drop policy if exists "Admin read economy guard state" on public.idle_economy_guard_state;
create policy "Admin read economy guard state" on public.idle_economy_guard_state
  for select to authenticated using (public.is_active_admin());
-- Kein insert/update/delete-Grant: nur der Trigger (SECURITY DEFINER) schreibt hinein.

alter table public.idle_anticheat_flags add column if not exists economy_details jsonb;

-- ---------------------------------------------------------------- Herkunft erkennen
create or replace function public.idle_player_state_origin_probe()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform set_config('bkmp.eco_origin',
    case when current_user in ('authenticated', 'anon') then 'direct' else 'internal' end, true);
  return NEW;
end;
$$;

drop trigger if exists idle_player_state_0_origin_probe on public.idle_player_state;
create trigger idle_player_state_0_origin_probe
before update on public.idle_player_state
for each row execute function public.idle_player_state_origin_probe();

-- ---------------------------------------------------------------- Pruefung
create or replace function public.idle_player_state_economy_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_names constant text[] := array['gold', 'wood', 'stone', 'crystals', 'essence', 'xp'];
  v_econ jsonb;
  v_cfg jsonb;
  v_rs jsonb;
  v_xpc jsonb;
  v_enforce boolean;
  v_safety numeric;
  v_window numeric;
  v_kps numeric;
  v_bonus_cap numeric;
  v_prod_mult numeric;
  v_prod_hours_base numeric;
  v_prod_hours_bonus numeric;
  v_prod_factor numeric;
  v_prod_hours numeric;
  v_prestige numeric := 0;
  v_flag_throttle numeric;
  v_f numeric[];
  v_floor numeric[];
  v_owner text;
  v_st public.idle_economy_guard_state%rowtype;
  v_has_state boolean := false;
  v_dt numeric := 0;
  v_elapsed numeric;
  v_s0 numeric;
  v_kills_claim numeric;
  v_s_ref numeric;
  v_g_gold numeric;
  v_g_xp numeric;
  v_b_gold numeric;
  v_b_xp numeric;
  v_b_loot numeric;
  v_att numeric;
  v_xp_base numeric;
  v_xp_growth numeric;
  v_prod_h numeric[] := array[0, 0, 0, 0, 0, 0]::numeric[];
  v_rate_u numeric[] := array[0, 0, 0, 0, 0, 0]::numeric[];
  v_ext_u numeric[] := array[0, 0, 0, 0, 0, 0]::numeric[];
  v_gain numeric[] := array[0, 0, 0, 0, 0, 0]::numeric[];
  v_rate numeric[] := array[0, 0, 0, 0, 0, 0]::numeric[];
  v_cap numeric[] := array[0, 0, 0, 0, 0, 0]::numeric[];
  v_cred numeric[];
  v_avail numeric[] := array[0, 0, 0, 0, 0, 0]::numeric[];
  v_newcred numeric[] := array[0, 0, 0, 0, 0, 0]::numeric[];
  v_peak numeric[] := array[0, 0, 0, 0, 0, 0]::numeric[];
  v_viol boolean[] := array[false, false, false, false, false, false];
  v_any boolean := false;
  v_details jsonb := '{}'::jsonb;
  v_min_ratio numeric := 1;
  v_ratio numeric;
  v_flagged_at timestamptz;
  v_levels_back numeric;
  i int;
begin
  if TG_OP <> 'UPDATE' then
    return NEW;
  end if;
  -- Nur direkte Schreibzugriffe des Browsers pruefen (siehe Datei-Kopf).
  if coalesce(nullif(current_setting('bkmp.eco_origin', true), ''), 'internal') <> 'direct' then
    return NEW;
  end if;
  -- Guenstiger Fruehausstieg: nichts ist gestiegen.
  if not (NEW.gold > OLD.gold or NEW.total_gold_earned > OLD.total_gold_earned
          or NEW.wood > OLD.wood or NEW.stone > OLD.stone or NEW.crystals > OLD.crystals
          or NEW.essence > OLD.essence or NEW.level > OLD.level or NEW.xp > OLD.xp) then
    return NEW;
  end if;

  begin
    select value into v_econ from public.idle_anticheat_settings where key = 'economy';
    v_econ := coalesce(v_econ, '{}'::jsonb);
    if coalesce((v_econ ->> 'enabled')::boolean, true) is false then
      return NEW;
    end if;
    if public.is_active_admin() then
      return NEW;
    end if;

    v_enforce := coalesce((v_econ ->> 'enforce')::boolean, false);
    v_safety := greatest(0.1, coalesce((v_econ ->> 'safety')::numeric, 1));
    v_window := greatest(10, coalesce((v_econ ->> 'window_s')::numeric, 600));
    v_kps := coalesce((v_econ ->> 'kps')::numeric, 3);
    v_bonus_cap := coalesce((v_econ ->> 'bonus_cap_pct')::numeric, 2000);
    v_prod_mult := coalesce((v_econ ->> 'prod_mult')::numeric, 4);
    v_prod_hours_base := coalesce((v_econ ->> 'prod_hours_base')::numeric, 72);
    v_prod_hours_bonus := coalesce((v_econ ->> 'prod_hours_bonus')::numeric, 300);
    v_flag_throttle := coalesce((v_econ ->> 'flag_throttle_s')::numeric, 600);
    v_f := array[
      coalesce((v_econ ->> 'f_gold')::numeric, 40), coalesce((v_econ ->> 'f_wood')::numeric, 30),
      coalesce((v_econ ->> 'f_stone')::numeric, 30), coalesce((v_econ ->> 'f_crystals')::numeric, 20),
      coalesce((v_econ ->> 'f_essence')::numeric, 15), coalesce((v_econ ->> 'f_xp')::numeric, 40)];
    v_floor := array[
      coalesce((v_econ ->> 'floor_gold')::numeric, 300000), coalesce((v_econ ->> 'floor_wood')::numeric, 20000),
      coalesce((v_econ ->> 'floor_stone')::numeric, 20000), coalesce((v_econ ->> 'floor_crystals')::numeric, 2000),
      coalesce((v_econ ->> 'floor_essence')::numeric, 1500), coalesce((v_econ ->> 'floor_xp')::numeric, 150000)];

    -- Spielwerte aus derselben Tabelle wie der Browser (idle_game_config), mit festen Rueckfallwerten.
    select jsonb_object_agg(key, value) into v_cfg
      from public.idle_game_config where key in ('reward_scaling', 'xp_curve');
    v_rs := coalesce(v_cfg -> 'reward_scaling', '{}'::jsonb);
    v_xpc := coalesce(v_cfg -> 'xp_curve', '{}'::jsonb);
    v_xp_base := coalesce((v_xpc ->> 'base')::numeric, 40);
    v_xp_growth := coalesce((v_xpc ->> 'growth')::numeric, 1.42);

    -- Prestige-Stufe: bestimmt, wie viel Gebaeude-Ertrag (je Stufe +5 %) und wie viele Offline-Stunden
    -- (nur mit Prestige-Knoten "Zeitdehnung" mehr als 72 h) ueberhaupt moeglich sind. Fehlt die Tabelle
    -- oder schlaegt die Abfrage fehl: grosszuegig rechnen (fail-open).
    begin
      select coalesce(p.prestige_level, 0) into v_prestige
        from public.idle_prestige_state p where p.name_key = NEW.name_key;
      if not found then
        v_prestige := 0;
      end if;
    exception when others then
      v_prestige := 100;
    end;
    v_prod_factor := (1 + 0.05 * least(v_prestige, 400)) * v_prod_mult;
    v_prod_hours := v_prod_hours_base + case when v_prestige >= 1 then v_prod_hours_bonus else 0 end;

    -- Konto laden (fehlt es: Guthaben = voll).
    v_owner := coalesce(NEW.auth_user_id::text, NEW.name_key);
    select * into v_st from public.idle_economy_guard_state where owner_key = v_owner;
    v_has_state := found;
    v_cred := array[v_st.credit_gold, v_st.credit_wood, v_st.credit_stone,
                    v_st.credit_crystals, v_st.credit_essence, v_st.credit_xp];
    if v_has_state then
      v_dt := least(259200, greatest(0, extract(epoch from (now() - v_st.last_at))));
    end if;
    v_elapsed := greatest(0, extract(epoch from (now() - coalesce(OLD.updated_at, now()))));

    -- ---- Bezugswerte (immer vom zuletzt AKZEPTIERTEN Stand, nie vom behaupteten) ----
    v_s0 := greatest(coalesce(OLD.highest_dragon_index, 0), coalesce(OLD.current_dragon_index, 0), 0);
    v_kills_claim := greatest(0, coalesce(NEW.dragon_kills, 0) - coalesce(OLD.dragon_kills, 0));
    v_s_ref := v_s0 + least(v_kills_claim, v_window * v_kps);
    v_g_gold := power(1 + coalesce((v_rs ->> 'goldGrowthPerKill')::numeric, 0.05) * v_s_ref,
                      coalesce((v_rs ->> 'goldGrowthExponent')::numeric, 1.2));
    v_g_xp := power(1 + coalesce((v_rs ->> 'xpGrowthPerKill')::numeric, 0.05) * v_s_ref,
                    coalesce((v_rs ->> 'xpGrowthExponent')::numeric, 1.2));
    v_b_gold := least(greatest(coalesce(OLD.gold_bonus, 0), coalesce(NEW.gold_bonus, 0), 0), v_bonus_cap);
    v_b_xp := least(greatest(coalesce(OLD.xp_bonus, 0), coalesce(NEW.xp_bonus, 0), 0), v_bonus_cap);
    v_b_loot := least(greatest(coalesce(OLD.loot_bonus, 0), coalesce(NEW.loot_bonus, 0), 0), v_bonus_cap);
    v_att := greatest(coalesce(OLD.attack, 10),
                      least(coalesce(NEW.attack, 10), coalesce(OLD.attack, 10) * 2 + 100));

    -- Gebaeude (Stufe des alten Standes + 3, hoechstens 160): Ertrag je Stunde.
    v_prod_h[1] := 400 * (1 + least(coalesce(OLD.goldmine_level, 0) + 3, 160) * 0.8);
    v_prod_h[2] := 60 * (1 + least(coalesce(OLD.holzfaeller_level, 0) + 3, 160) * 0.5);
    v_prod_h[3] := 60 * (1 + least(coalesce(OLD.steinbruch_level, 0) + 3, 160) * 0.5);
    v_prod_h[4] := 3 * (1 + least(coalesce(OLD.kristallmine_level, 0) + 3, 160) * 0.4);
    v_prod_h[5] := 4 * (1 + least(coalesce(OLD.manaquelle_level, 0) + 3, 160) * 0.4);
    v_prod_h[6] := 50 * (1 + least(coalesce(OLD.magierakademie_level, 0) + 3, 160) * 0.5);

    -- ---- Rate je Sekunde (ohne Sicherheitsfaktor) ----
    -- Kaempfe: kps x Faktor x Stufen-Wachstum x Bonus. Gold/EXP zusaetzlich Dungeon+Turm (Angriff).
    v_rate_u[1] := v_kps * v_f[1] * v_g_gold * (1 + v_b_gold / 100) + 3.5 * v_att;
    v_rate_u[2] := v_kps * v_f[2] * (1 + v_b_loot / 100);
    v_rate_u[3] := v_kps * v_f[3] * (1 + v_b_loot / 100);
    v_rate_u[4] := v_kps * v_f[4] * (1 + v_b_loot / 100);
    v_rate_u[5] := v_kps * v_f[5] * (1 + v_b_loot / 100);
    v_rate_u[6] := v_kps * v_f[6] * v_g_xp * (1 + v_b_xp / 100) + 2 * v_att;
    -- Einmalige Zuschlaege (Obergrenze des Guthabens): fester Boden, Dungeon-Laeufe (Angriff), Gebaeude-Nachtrag.
    for i in 1..6 loop
      v_rate_u[i] := v_rate_u[i] + v_prod_h[i] * v_prod_factor / 3600;
      v_ext_u[i] := v_floor[i] + v_prod_h[i] * v_prod_factor * v_prod_hours;
    end loop;
    v_ext_u[1] := v_ext_u[1] + 15000 * v_att;   -- 5 Gold-Dungeon-Laeufe
    v_ext_u[6] := v_ext_u[6] + 9000 * v_att;    -- 5 EXP-Dungeon-Laeufe
    v_ext_u[4] := v_ext_u[4] + 8 * v_att;       -- Edelstein-Dungeon
    for i in 1..6 loop
      v_rate[i] := v_safety * v_rate_u[i];
      v_cap[i] := v_rate[i] * v_window + v_safety * v_ext_u[i];
    end loop;

    -- ---- Zuwaechse (nur Anstiege; Ausgeben/Prestige = fallende Werte zaehlen nicht) ----
    -- Gold: das staerkere von Gold und Gesamt-Gold (total_gold_earned steigt nie durch Ausgeben).
    v_gain[1] := greatest(0, NEW.gold - OLD.gold, NEW.total_gold_earned - OLD.total_gold_earned);
    v_gain[2] := greatest(0, NEW.wood - OLD.wood);
    v_gain[3] := greatest(0, NEW.stone - OLD.stone);
    v_gain[4] := greatest(0, NEW.crystals - OLD.crystals);
    v_gain[5] := greatest(0, NEW.essence - OLD.essence);
    -- EXP: Erfahrungs-"Masse" aus Level und Rest-EXP (Integral der Kurve base*l^growth; ueberschaetzt
    -- minimal = fail-open).
    v_gain[6] := greatest(0,
      v_xp_base * (power(NEW.level::numeric, v_xp_growth + 1) - power(OLD.level::numeric, v_xp_growth + 1))
        / (v_xp_growth + 1) + (NEW.xp - OLD.xp));

    -- ---- Konto abrechnen ----
    for i in 1..6 loop
      v_avail[i] := least(v_cap[i], coalesce(v_cred[i], v_cap[i]) + v_dt * v_rate[i]);
      v_ratio := case when v_gain[i] <= 0 then 0
                      when v_avail[i] > 0 then least(999, v_gain[i] / v_avail[i])
                      else 999 end;
      v_peak[i] := v_ratio;
      if v_gain[i] > v_avail[i] then
        v_viol[i] := true;
        v_any := true;
        v_newcred[i] := 0;
        v_details := v_details || jsonb_build_object(v_names[i], jsonb_build_object(
          'gain', round(v_gain[i]), 'allowed', round(v_avail[i]), 'ratio', round(v_ratio, 3)));
        v_min_ratio := least(v_min_ratio, case when v_gain[i] > 0 then v_avail[i] / v_gain[i] else 1 end);
      else
        v_newcred[i] := v_avail[i] - v_gain[i];
      end if;
    end loop;

    -- ---- Alarm (hoechstens einmal je flag_throttle_s) und Konto speichern ----
    if v_any and (v_st.last_flag_at is null
                  or extract(epoch from (now() - v_st.last_flag_at)) >= v_flag_throttle) then
      begin
        insert into public.idle_anticheat_flags (
          name_key, claimed_dragon_kills_delta, allowed_dragon_kills_delta, elapsed_seconds, ratio_applied,
          old_dragon_kills, new_dragon_kills_claimed, old_level, new_level_claimed, triggered_by, economy_details
        ) values (
          NEW.name_key, v_kills_claim, v_window * v_kps, v_elapsed,
          case when v_enforce then v_min_ratio else 1 end,
          OLD.dragon_kills, NEW.dragon_kills, OLD.level, NEW.level, 'economy',
          jsonb_build_object('enforced', v_enforce, 'stage_ref', round(v_s_ref), 'details', v_details)
        );
        v_flagged_at := now();
      exception when others then
        null;
      end;
    end if;

    insert into public.idle_economy_guard_state as s (
      owner_key, name_key, last_at,
      credit_gold, credit_wood, credit_stone, credit_crystals, credit_essence, credit_xp,
      peak_gold, peak_wood, peak_stone, peak_crystals, peak_essence, peak_xp,
      violations, last_flag_at, updated_at
    ) values (
      v_owner, NEW.name_key, now(),
      v_newcred[1], v_newcred[2], v_newcred[3], v_newcred[4], v_newcred[5], v_newcred[6],
      v_peak[1], v_peak[2], v_peak[3], v_peak[4], v_peak[5], v_peak[6],
      case when v_any then 1 else 0 end, v_flagged_at, now()
    )
    on conflict (owner_key) do update set
      name_key = excluded.name_key,
      last_at = excluded.last_at,
      credit_gold = excluded.credit_gold, credit_wood = excluded.credit_wood, credit_stone = excluded.credit_stone,
      credit_crystals = excluded.credit_crystals, credit_essence = excluded.credit_essence, credit_xp = excluded.credit_xp,
      peak_gold = greatest(s.peak_gold, excluded.peak_gold), peak_wood = greatest(s.peak_wood, excluded.peak_wood),
      peak_stone = greatest(s.peak_stone, excluded.peak_stone), peak_crystals = greatest(s.peak_crystals, excluded.peak_crystals),
      peak_essence = greatest(s.peak_essence, excluded.peak_essence), peak_xp = greatest(s.peak_xp, excluded.peak_xp),
      violations = s.violations + excluded.violations,
      last_flag_at = coalesce(excluded.last_flag_at, s.last_flag_at),
      updated_at = now();

    -- ---- Scharf: zu hohe Zuwaechse kappen (nur wenn enforce=true) ----
    if v_enforce and v_any then
      if v_viol[1] then
        NEW.gold := least(NEW.gold, OLD.gold + floor(v_avail[1]));
        NEW.total_gold_earned := least(NEW.total_gold_earned, OLD.total_gold_earned + floor(v_avail[1]));
      end if;
      if v_viol[2] then NEW.wood := least(NEW.wood, OLD.wood + floor(v_avail[2])); end if;
      if v_viol[3] then NEW.stone := least(NEW.stone, OLD.stone + floor(v_avail[3])); end if;
      if v_viol[4] then NEW.crystals := least(NEW.crystals, OLD.crystals + floor(v_avail[4])); end if;
      if v_viol[5] then NEW.essence := least(NEW.essence, OLD.essence + floor(v_avail[5])); end if;
      if v_viol[6] then
        -- Erfahrung: der ganze Zuwachs (Level + EXP) wird verworfen; die mit den Leveln
        -- gekommenen Skillpunkte ebenfalls.
        v_levels_back := greatest(0, NEW.level - OLD.level);
        NEW.level := least(NEW.level, OLD.level);
        NEW.xp := least(NEW.xp, OLD.xp);
        if v_levels_back > 0 then
          NEW.skill_points_available := greatest(0, NEW.skill_points_available - v_levels_back::integer);
        end if;
      end if;
    end if;
  exception when others then
    -- Die Pruefung darf das Speichern NIE blockieren.
    return NEW;
  end;

  return NEW;
end;
$$;

drop trigger if exists idle_player_state_economy_guard_trigger on public.idle_player_state;
create trigger idle_player_state_economy_guard_trigger
before update on public.idle_player_state
for each row
when (NEW.gold > OLD.gold or NEW.total_gold_earned > OLD.total_gold_earned
      or NEW.wood > OLD.wood or NEW.stone > OLD.stone or NEW.crystals > OLD.crystals
      or NEW.essence > OLD.essence or NEW.level > OLD.level or NEW.xp > OLD.xp)
execute function public.idle_player_state_economy_guard();

-- ---------------------------------------------------------------- Sicherheitsnetz Bestenliste
-- Die Bestenliste darf NIE automatisch wegen eines Alarms ausblenden (Vorfall 11.08.2026, siehe
-- sql/20260811-leaderboard-hide-decouple-from-flags.sql). Falls diese Datei dort noch nicht
-- ausgefuehrt wurde, wuerde jeder neue Wirtschafts-Alarm einen echten Spieler verstecken. Deshalb
-- hier dieselbe View noch einmal (identischer Inhalt, idempotent). Faellt weg, wenn die
-- Ausblend-Tabelle fehlt - dann bleibt alles wie es war.
do $$
begin
  if to_regclass('public.idle_leaderboard_hidden_accounts') is not null then
    execute $v$
      create or replace view public.idle_player_state_leaderboard
      as
      select s.name_key, s.display_name, s.level, s.total_gold_earned, s.dragon_kills,
             s.playtime_seconds, s.highest_dragon_index, s.prestige_stage_offset, s.turm_highest_wave
      from public.idle_player_state s
      where not exists (
        select 1 from public.idle_leaderboard_hidden_accounts h where h.name_key = s.name_key
      )
    $v$;
    execute 'grant select on public.idle_player_state_leaderboard to anon, authenticated';
  end if;
end $$;
