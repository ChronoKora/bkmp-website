-- Bkmp - Server-seitige Tempo-Grenze gegen Timer-Speedhacks/direkte
-- Zustands-Manipulation (Spieler-Meldung 30.07.2026, Feedback-Board-
-- Screenshot + 2 Beweisvideos: "HTML5 Universal Speed Hack"-Browser-
-- erweiterung + Cheat Engine, "über nacht 300 Level... andere 800-900
-- Level gemacht"). Ausfuehrliche Root-Cause-Doku in CLAUDE.md.
--
-- Root Cause: upsertIdlePlayerState() (supabase.js) schreibt den KOMPLETTEN
-- Client-Zustand als reines, nur per RLS auf Kontobesitz geprueftes Update -
-- der Server hat bisher NIE geprueft, ob Level/Kills/Ressourcen/Skillpunkte
-- ueberhaupt zur seit dem letzten Speichern vergangenen ECHTEN Zeit passen.
--
-- Bewusst NICHT ueber idle_player_state.playtime_seconds geprueft - dieses
-- Feld waechst bei JEDEM Tick nur um den NOMINELLEN Tick-Intervall
-- (idledorf.js: "playtime_seconds += tickIntervalMs/1000"), unabhaengig
-- davon, wie schnell der Tick in echter Wanduhrzeit tatsaechlich feuert -
-- ein Timer-Speedhack verzerrt also dragon_kills UND playtime_seconds exakt
-- gleich und waere damit als Vergleichsmasstab wirkungslos. Stattdessen wird
-- die echte, vom Client nicht beeinflussbare POSTGRES-Wanduhrzeit (now())
-- gegen den zuletzt gespeicherten Zeitstempel (OLD.updated_at) verglichen -
-- bewusst now() statt NEW.updated_at, damit ein Client nicht einfach einen
-- gefaelschten Zeitstempel mitschicken kann.
--
-- MAX_KILLS_PER_SECOND = 3 ist bewusst NUR knapp (20%) ueber der tatsaechlich
-- im Client hart verdrahteten Tick-Untergrenze (400ms, "tickIntervalMs:
-- Math.max(400, Math.round(900/(1+attack_speed_pct/100)))", siehe idledorf.js)
-- gewaehlt - ein einzelner Kill kann RECHNERISCH nie schneller als alle
-- 400ms erfolgen (bkmpIdleTick() erhoeht dragon_kills hoechstens 1x pro
-- eigenem Aufruf, kein Verketten mehrerer Kills in einem Tick, siehe
-- bkmpIdleHandleDragonDefeated()) - das ist eine echte, von KEINEM legitimen
-- Spieler ueberschreitbare Obergrenze, unabhaengig von Build/Ausruestung/
-- Praestige-Investition. Grosse legitime Spruenge (z.B. nach einem langen
-- Offline-Claim, api/claim-idle-offline-progress.js) werden davon NIE
-- ausgeloest, weil die dabei vergangene ECHTE Wanduhrzeit automatisch mit-
-- waechst (17h Offline-Deckel bei ~0,89 Kills/Sekunde liegt weit unter
-- diesem Limit, siehe CLAUDE.md-Analyse).
--
-- Bei einer Verletzung wird NICHT abgelehnt (kein Fehler fuer den Client,
-- kein kaputter Speicherversuch) - der GESAMTE Fortschritts-Zuwachs dieses
-- EINEN Speicherversuchs wird anteilig auf das noch plausible Mass
-- herunterskaliert (ratio = erlaubtes Kills-Delta / gemeldetes Kills-Delta).
-- Bewusste Vereinfachung: keine Neuberechnung der echten, von Dutzenden
-- Boni/der aktuellen Drachen-Stufe abhaengigen Belohnungsformel - ein
-- einheitlicher Faktor auf alle Fortschritts-Felder gemeinsam. Echte
-- Ausgaben/Resets (fallende Werte, z.B. Prestige) werden NIE angetastet -
-- nur ansteigende Deltas werden gekappt. Jeder ausgeloeste Fall wird zur
-- spaeteren Untersuchung in einer neuen, admin-only lesbaren Tabelle
-- protokolliert.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich.

create table if not exists public.idle_anticheat_flags (
  id uuid primary key default gen_random_uuid(),
  name_key text not null,
  claimed_dragon_kills_delta numeric not null,
  allowed_dragon_kills_delta numeric not null,
  elapsed_seconds numeric not null,
  ratio_applied numeric not null,
  old_dragon_kills bigint,
  new_dragon_kills_claimed bigint,
  old_level integer,
  new_level_claimed integer,
  flagged_at timestamptz not null default now()
);
create index if not exists idle_anticheat_flags_name_key_idx on public.idle_anticheat_flags (name_key, flagged_at desc);

alter table public.idle_anticheat_flags enable row level security;
grant select on public.idle_anticheat_flags to authenticated;
-- Kein insert/update/delete-Grant fuer Clients - nur der Trigger (SECURITY DEFINER, laeuft als Tabelleneigentuemer) schreibt hinein.

drop policy if exists "Admin read anticheat flags" on public.idle_anticheat_flags;
create policy "Admin read anticheat flags" on public.idle_anticheat_flags for select to authenticated using (public.is_active_admin());

create or replace function public.idle_player_state_anticheat_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elapsed_seconds numeric;
  v_max_kills_per_second constant numeric := 3;
  v_min_elapsed_seconds constant numeric := 4;
  v_max_kills_delta numeric;
  v_claimed_kills_delta numeric;
  v_ratio numeric;
begin
  if TG_OP <> 'UPDATE' then
    return NEW;
  end if;

  v_elapsed_seconds := greatest(v_min_elapsed_seconds, extract(epoch from (now() - coalesce(OLD.updated_at, now()))));
  v_max_kills_delta := v_elapsed_seconds * v_max_kills_per_second;
  v_claimed_kills_delta := coalesce(NEW.dragon_kills, OLD.dragon_kills) - coalesce(OLD.dragon_kills, 0);

  if v_claimed_kills_delta > v_max_kills_delta then
    v_ratio := v_max_kills_delta / v_claimed_kills_delta;

    insert into public.idle_anticheat_flags (
      name_key, claimed_dragon_kills_delta, allowed_dragon_kills_delta, elapsed_seconds, ratio_applied,
      old_dragon_kills, new_dragon_kills_claimed, old_level, new_level_claimed
    ) values (
      NEW.name_key, v_claimed_kills_delta, v_max_kills_delta, v_elapsed_seconds, v_ratio,
      OLD.dragon_kills, NEW.dragon_kills, OLD.level, NEW.level
    );

    -- Nur ansteigende Deltas kappen, fallende (Ausgeben/Prestige) unangetastet lassen.
    if NEW.dragon_kills > OLD.dragon_kills then NEW.dragon_kills := OLD.dragon_kills + floor((NEW.dragon_kills - OLD.dragon_kills) * v_ratio); end if;
    if NEW.boss_kills > OLD.boss_kills then NEW.boss_kills := OLD.boss_kills + floor((NEW.boss_kills - OLD.boss_kills) * v_ratio); end if;
    if NEW.gold > OLD.gold then NEW.gold := OLD.gold + floor((NEW.gold - OLD.gold) * v_ratio); end if;
    if NEW.total_gold_earned > OLD.total_gold_earned then NEW.total_gold_earned := OLD.total_gold_earned + floor((NEW.total_gold_earned - OLD.total_gold_earned) * v_ratio); end if;
    if NEW.wood > OLD.wood then NEW.wood := OLD.wood + floor((NEW.wood - OLD.wood) * v_ratio); end if;
    if NEW.stone > OLD.stone then NEW.stone := OLD.stone + floor((NEW.stone - OLD.stone) * v_ratio); end if;
    if NEW.crystals > OLD.crystals then NEW.crystals := OLD.crystals + floor((NEW.crystals - OLD.crystals) * v_ratio); end if;
    if NEW.essence > OLD.essence then NEW.essence := OLD.essence + floor((NEW.essence - OLD.essence) * v_ratio); end if;
    if NEW.xp > OLD.xp then NEW.xp := OLD.xp + floor((NEW.xp - OLD.xp) * v_ratio); end if;
    if NEW.level > OLD.level then NEW.level := OLD.level + floor((NEW.level - OLD.level) * v_ratio); end if;
    if NEW.skill_points_available > OLD.skill_points_available then NEW.skill_points_available := OLD.skill_points_available + floor((NEW.skill_points_available - OLD.skill_points_available) * v_ratio); end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists idle_player_state_anticheat_guard_trigger on public.idle_player_state;
create trigger idle_player_state_anticheat_guard_trigger
before update on public.idle_player_state
for each row execute function public.idle_player_state_anticheat_guard();
