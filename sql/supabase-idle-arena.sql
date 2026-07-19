/* ============================================================
   PvP-Arena (Spieler-Wunsch 14.07.: "PvP Arena einbauen") - asynchroner
   Kampf gegen die zuletzt synchronisierten Kampfwerte (attack/defense/hp)
   eines anderen echten Spielers aus idle_player_state. Kein Echtzeit-Duell
   (der Gegner muss nicht online sein) - stattdessen ein einzelner,
   serverseitig gewuerfelter Vergleich (Bradley-Terry-Modell: Gewinnchance =
   eigene Staerke / (eigene + gegnerische Staerke)), damit Unterlegene nicht
   IMMER verlieren, aber der Staerkere im Schnitt haeufiger gewinnt.

   WICHTIG: Anders als der Rest des Idle-Dorfs (das dem Client fuer
   Spielstand-Schreibzugriffe durchgehend vertraut, siehe Kommentar in
   supabase-idle-dorf-schema.sql) laeuft die eigentliche Kampfabwicklung hier
   AUSSCHLIESSLICH ueber eine security-definer-RPC. Grund: ein Kampf
   veraendert ZWEI Spielerzeilen gleichzeitig (Angreifer + Verteidiger) -
   direkte Client-Upserts wuerden es trivial machen, sich selbst beliebige
   Ratings/Gold gutzuschreiben (siehe die Bonk-Missbrauchsfaelle vom 14.07.).
   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   idempotent: mehrfaches Ausfuehren ist unschaedlich.
   ============================================================ */

create table if not exists public.arena_ratings (
  auth_user_id uuid primary key,
  name_key text not null,
  display_name text not null,
  rating integer not null default 1000,
  wins integer not null default 0,
  losses integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists arena_ratings_rating_idx on public.arena_ratings (rating desc);
create index if not exists arena_ratings_name_key_idx on public.arena_ratings (name_key);

alter table public.arena_ratings enable row level security;
grant select on public.arena_ratings to anon, authenticated;
drop policy if exists "Public read arena ratings" on public.arena_ratings;
create policy "Public read arena ratings" on public.arena_ratings for select to anon, authenticated using (true);
-- Bewusst KEINE insert/update-Policy fuer Clients - nur die RPC unten
-- (security definer, laeuft mit Tabellenbesitzer-Rechten) darf schreiben.

create table if not exists public.arena_battle_log (
  id uuid primary key default gen_random_uuid(),
  attacker_auth_user_id uuid not null,
  attacker_name text not null,
  defender_auth_user_id uuid not null,
  defender_name text not null,
  attacker_won boolean not null,
  rating_change integer not null,
  gold_reward bigint not null default 0,
  occurred_at timestamptz not null default now()
);
create index if not exists arena_battle_log_attacker_idx on public.arena_battle_log (attacker_auth_user_id, occurred_at desc);
create index if not exists arena_battle_log_defender_idx on public.arena_battle_log (defender_auth_user_id, occurred_at desc);

alter table public.arena_battle_log enable row level security;
grant select on public.arena_battle_log to anon, authenticated;
drop policy if exists "Public read arena battle log" on public.arena_battle_log;
create policy "Public read arena battle log" on public.arena_battle_log for select to anon, authenticated using (true);

-- ============================================================
-- arena_attack(): kompletter, atomarer Kampfablauf. Cooldown von 3 Minuten
-- pro Angreifer+Ziel-Paar (verhindert, dass ein staerkerer Spieler einen
-- einzelnen schwaecheren Gegner am Stueck leerfarmt).
-- ============================================================
create or replace function public.arena_attack(p_target_auth_user_id uuid)
returns table (
  attacker_won boolean,
  rating_change integer,
  new_rating integer,
  gold_reward bigint,
  defender_display_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_atk public.idle_player_state%rowtype;
  v_def public.idle_player_state%rowtype;
  v_atk_rating integer;
  v_def_rating integer;
  v_atk_power numeric;
  v_def_power numeric;
  v_win_chance numeric;
  v_won boolean;
  v_expected numeric;
  v_k integer := 32;
  v_change integer;
  v_gold bigint := 0;
  v_last_attack timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_target_auth_user_id is null or p_target_auth_user_id = v_uid then
    raise exception 'invalid_target';
  end if;

  select * into v_atk from public.idle_player_state where auth_user_id = v_uid limit 1;
  if not found then
    raise exception 'no_attacker_state';
  end if;

  select * into v_def from public.idle_player_state where auth_user_id = p_target_auth_user_id limit 1;
  if not found then
    raise exception 'no_defender_state';
  end if;

  select occurred_at into v_last_attack
  from public.arena_battle_log
  where attacker_auth_user_id = v_uid and defender_auth_user_id = p_target_auth_user_id
  order by occurred_at desc limit 1;
  if v_last_attack is not null and v_last_attack > now() - interval '3 minutes' then
    raise exception 'cooldown_active';
  end if;

  insert into public.arena_ratings (auth_user_id, name_key, display_name, rating)
  values (v_uid, v_atk.name_key, v_atk.display_name, 1000)
  on conflict (auth_user_id) do update set name_key = excluded.name_key, display_name = excluded.display_name
  returning rating into v_atk_rating;

  insert into public.arena_ratings (auth_user_id, name_key, display_name, rating)
  values (p_target_auth_user_id, v_def.name_key, v_def.display_name, 1000)
  on conflict (auth_user_id) do update set name_key = excluded.name_key, display_name = excluded.display_name
  returning rating into v_def_rating;

  -- Kampfstaerke: Angriff zaehlt am meisten, HP und Verteidigung etwas
  -- weniger - dieselbe Gewichtung wie das Verhaeltnis, in dem diese Werte
  -- im normalen Kampf gegen Drachen wirken (siehe bkmpIdleTick in
  -- idledorf.js: Angriff bestimmt Schadenstempo direkt, Verteidigung/HP
  -- bestimmen nur die Ueberlebensfaehigkeit).
  v_atk_power := greatest(1, v_atk.attack * 2 + v_atk.defense + v_atk.hp * 0.3);
  v_def_power := greatest(1, v_def.attack * 2 + v_def.defense + v_def.hp * 0.3);
  v_win_chance := v_atk_power / (v_atk_power + v_def_power);
  v_won := random() < v_win_chance;

  v_expected := 1.0 / (1.0 + power(10, (v_def_rating - v_atk_rating) / 400.0));
  if v_won then
    v_change := round(v_k * (1 - v_expected));
    v_gold := round(greatest(5, v_def_power * 0.8));
  else
    v_change := -round(v_k * v_expected);
  end if;

  update public.arena_ratings set rating = rating + v_change,
    wins = wins + (case when v_won then 1 else 0 end),
    losses = losses + (case when v_won then 0 else 1 end),
    updated_at = now()
  where auth_user_id = v_uid
  returning rating into v_atk_rating;

  update public.arena_ratings set rating = rating - v_change,
    wins = wins + (case when v_won then 0 else 1 end),
    losses = losses + (case when v_won then 1 else 0 end),
    updated_at = now()
  where auth_user_id = p_target_auth_user_id;

  if v_won and v_gold > 0 then
    update public.idle_player_state set gold = gold + v_gold, total_gold_earned = total_gold_earned + v_gold
    where auth_user_id = v_uid;
  end if;

  insert into public.arena_battle_log (attacker_auth_user_id, attacker_name, defender_auth_user_id, defender_name, attacker_won, rating_change, gold_reward)
  values (v_uid, v_atk.display_name, p_target_auth_user_id, v_def.display_name, v_won, v_change, v_gold);

  return query select v_won, v_change, v_atk_rating, v_gold, v_def.display_name;
end;
$$;
grant execute on function public.arena_attack(uuid) to authenticated;
