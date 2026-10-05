-- ============================================================
-- Event-Analyse im Admin-Panel (05.10.2026): Reiter "📊 Events"
--
-- Ein generisches, NUR LESENDES Statistik-System fuer ALLE Events aus dem
-- bestehenden special_events-Framework (nicht auf "zwielicht" festgelegt:
-- Stufenzahl, Belohnungen, Quests, Auswahl-Belohnung, Zeiten kommen aus
-- special_events + special_events.config).
--
-- Was diese Datei anlegt:
--   * Sechs admin-only Funktionen (Rechtepruefung wie alle anderen Admin-RPCs:
--     public.is_active_admin() - laesst nur die Rollen admin/editor durch, also
--     NICHT das Mitarbeiter- oder Schaf-Konto; ausgeloggte Nutzer und normale
--     Spieler bekommen 'not_admin'):
--       admin_event_list()                  Event-Auswahl + Vergleich
--       admin_event_overview(event)         Kopf, KPIs, Stufenverteilung,
--                                           Belohnungsanalyse, Auswahl-Belohnung
--       admin_event_quests(event)           Tages-/Wochenquest-Analyse
--       admin_event_timeline(event)         Entwicklung pro Berliner Kalendertag
--       admin_event_players(event, ...)     Spielertabelle (Suche/Sortierung/Seiten)
--       admin_event_player_detail(event,u)  Detailansicht eines Spielers
--     Alle Funktionen sind security definer mit festem search_path und
--     verwenden KEINE Schreibzugriffe auf Spielerdaten. Aggregiert wird auf dem
--     Server (COUNT/AVG/GROUP BY) - der Browser bekommt nur fertige Zahlen.
--   * Zwei kleine ADDITIVE Datenquellen fuer echte Verlaufsdaten (siehe unten):
--       player_event_progress.joined_day   Berliner Tag der ersten Teilnahme
--       event_player_day_log               Tagesprotokoll (Quests/Punkte je Spieler+Tag)
--     Beides aendert KEIN Event-Verhalten, keine Punkte, keine Belohnungen.
--
-- WARUM das Tagesprotokoll noetig ist (Nutzerwunsch: "nicht historische Daten
-- erfinden"): player_event_progress ueberschreibt die Tagesquests
-- (day_quests/day_closure_done) bei jedem neuen Berliner Tag und speichert nur
-- den aktuellen Punktestand. Ohne Protokoll waeren Tages-Abschlussraten und der
-- Verlauf pro Tag nach dem ersten Tageswechsel unwiederbringlich weg. Ein
-- AFTER-UPDATE-Trigger sichert deshalb genau im Moment des Tageswechsels den
-- alten Tag (eine Zeile je Spieler+Tag, keine heissen Zeilen, kein Locking).
-- Der Trigger ist in einen Fehler-Fangblock gepackt: ein Protokollfehler darf
-- NIE einen Event-Tick (= Spielstand) blockieren (Lehre vom 11.08.2026).
-- WICHTIG: moeglichst VOR dem ersten Tageswechsel ausfuehren - fuer Tage, an
-- denen ein Spieler vor der Installation schon weitergezogen war, existieren
-- keine Daten (die Oberflaeche zeigt "ab <Datum> vollstaendig").
--
-- Rein additiv, idempotent (mehrfaches Ausfuehren ist unschaedlich).
-- Voraussetzung: 20261004-06-special-events.sql (+ 02 fuer village_berlin_today).
-- ============================================================

-- ---------- 1) Berliner Tag der ersten Teilnahme ----------
alter table public.player_event_progress add column if not exists joined_day date;
alter table public.player_event_progress alter column joined_day set default public.village_berlin_today();

-- Nachtrag NUR dort, wo es sicher ist: ein Spieler, dessen aktueller Tag (day_key)
-- noch der erste Eventtag ist, hat sich zwingend an diesem Tag angemeldet (der
-- Tag laeuft nie rueckwaerts). Alle anderen bestehenden Zeilen bleiben leer
-- ("Tag unbekannt") - nichts wird geraten.
update public.player_event_progress p
   set joined_day = p.day_key
  from public.special_events se
 where p.event_id = se.id
   and p.joined_day is null
   and p.day_key is not null
   and se.starts_at is not null
   and p.day_key = (se.starts_at at time zone 'Europe/Berlin')::date;

-- ---------- 2) Tagesprotokoll ----------
create table if not exists public.event_player_day_log (
  event_id text not null references public.special_events(id) on delete cascade,
  auth_user_id uuid not null,
  day_key date not null,
  quests jsonb not null default '[]'::jsonb,        -- die Tagesquests dieses Tages inkl. done-Flags
  closure_done boolean not null default false,       -- Tagesabschluss geschafft
  points_end integer not null default 0,             -- Punktestand am Ende dieses Tages
  logged_at timestamptz not null default now(),
  primary key (event_id, auth_user_id, day_key)
);
create index if not exists event_player_day_log_event_day_idx on public.event_player_day_log (event_id, day_key);
alter table public.event_player_day_log enable row level security;
revoke all on public.event_player_day_log from anon, authenticated;   -- nur ueber die Admin-RPCs lesbar

-- Eine Zeile mit dem Startzeitpunkt der Statistik ("ab wann sind die Tagesdaten vollstaendig").
create table if not exists public.event_admin_meta (
  key text primary key,
  value text not null default '',
  set_at timestamptz not null default now()
);
alter table public.event_admin_meta enable row level security;
revoke all on public.event_admin_meta from anon, authenticated;
insert into public.event_admin_meta (key, value) values ('stats_since', 'day_log') on conflict (key) do nothing;

create or replace function public.event_log_day_rollover()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.event_player_day_log (event_id, auth_user_id, day_key, quests, closure_done, points_end)
    values (old.event_id, old.auth_user_id, old.day_key,
            case when jsonb_typeof(old.day_quests) = 'array' then old.day_quests else '[]'::jsonb end,
            coalesce(old.day_closure_done, false), coalesce(old.points, 0))
    on conflict (event_id, auth_user_id, day_key) do nothing;
  exception when others then
    null;  -- reine Statistik: ein Fehler hier darf den Event-Tick nie blockieren
  end;
  return new;
end;
$$;
revoke all on function public.event_log_day_rollover() from public, anon, authenticated;

drop trigger if exists event_log_day_rollover on public.player_event_progress;
create trigger event_log_day_rollover
  after update of day_key on public.player_event_progress
  for each row
  when (old.day_key is not null and new.day_key is distinct from old.day_key)
  execute function public.event_log_day_rollover();

-- ---------- 3) Event-Liste (Auswahl + Vergleich) ----------
-- Auch noch nicht sichtbare Events (HIDDEN) - der Betreiber sieht alles.
create or replace function public.admin_event_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_admin() then raise exception 'not_admin'; end if;
  return coalesce((
    select jsonb_agg(x.obj order by x.starts_at desc nulls last, x.name)
      from (
        select se.starts_at, se.name,
               jsonb_build_object(
                 'id', se.id, 'name', se.name, 'subtitle', se.subtitle,
                 'status', public.special_event_status_of(se.enabled, se.archived, se.announce_at, se.starts_at, se.ends_at),
                 'enabled', se.enabled, 'archived', se.archived,
                 'announce_at', se.announce_at, 'starts_at', se.starts_at, 'ends_at', se.ends_at,
                 'tier_count', se.tier_count, 'points_per_tier', se.points_per_tier,
                 'started', coalesce(a.started, 0), 'active', coalesce(a.active, 0),
                 'avg_tier', round(a.avg_tier, 2), 'completed', coalesce(a.completed, 0)
               ) as obj
          from public.special_events se
          left join lateral (
            select count(*) as started,
                   count(*) filter (where p.points > 0) as active,
                   avg(least(se.tier_count, floor(p.points::numeric / se.points_per_tier))) filter (where p.points > 0) as avg_tier,
                   count(*) filter (where floor(p.points::numeric / se.points_per_tier) >= se.tier_count) as completed
              from public.player_event_progress p
             where p.event_id = se.id
          ) a on true
      ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------- 4) Uebersicht: Kopf, KPIs, Stufenverteilung, Belohnungen, Auswahl ----------
create or replace function public.admin_event_overview(p_event_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_event public.special_events%rowtype;
  v_status text;
  v_today date := public.village_berlin_today();
  v_tc integer;
  v_ppt integer;
  v_cfg jsonb;
  v_kpi jsonb;
  v_hist jsonb;
  v_tiers jsonb;
  v_choice jsonb;
  v_days integer;
  v_normal_n integer;
  v_hard_n integer;
  v_daily_pts numeric := 0;
  v_weekly_pts numeric := 0;
  v_max numeric;
begin
  if not public.is_active_admin() then raise exception 'not_admin'; end if;
  select * into v_event from public.special_events se where se.id = p_event_id;
  if not found then raise exception 'invalid_event'; end if;
  v_status := public.special_event_status_of(v_event.enabled, v_event.archived, v_event.announce_at, v_event.starts_at, v_event.ends_at);
  v_tc := v_event.tier_count;
  v_ppt := v_event.points_per_tier;
  v_cfg := coalesce(v_event.config, '{}'::jsonb);

  -- KPIs. Teilnehmer: "gestartet" = es gibt eine Fortschrittszeile (erste Event-
  -- Aktualisierung im LIVE-Zeitraum), "aktiv" = tatsaechlich Punkte > 0.
  -- Durchschnitt/Median/Abschlussrate beziehen sich auf die aktiven Teilnehmer.
  select jsonb_build_object(
           'started', count(*),
           'active', count(*) filter (where t.points > 0),
           'avg_tier', round(avg(t.tier) filter (where t.points > 0), 2),
           'median_tier', percentile_cont(0.5) within group (order by t.tier) filter (where t.points > 0),
           'completed', count(*) filter (where t.tier >= v_tc),
           'max_tier', coalesce(max(t.tier), 0),
           'total_points', coalesce(sum(t.points), 0),
           'active_today', case when v_status = 'LIVE' then count(*) filter (where t.day_key = v_today) else null end
         )
    into v_kpi
    from (
      select p.points, p.day_key,
             least(v_tc, floor(p.points::numeric / v_ppt))::integer as tier
        from public.player_event_progress p
       where p.event_id = p_event_id
    ) t;

  -- Stufenverteilung (aktive Teilnehmer), Stufe 0 .. tier_count, Luecken mit 0 gefuellt.
  select coalesce(jsonb_agg(jsonb_build_object('tier', g.t, 'count', coalesce(h.c, 0)) order by g.t), '[]'::jsonb)
    into v_hist
    from generate_series(0, v_tc) g(t)
    left join (
      select least(v_tc, floor(p.points::numeric / v_ppt))::integer as tier, count(*) as c
        from public.player_event_progress p
       where p.event_id = p_event_id and p.points > 0
       group by 1
    ) h on h.tier = g.t;

  -- Belohnungsanalyse je Stufe: erreicht (Stufe >= t) und tatsaechlich abgeholt (t in tier_claimed).
  select coalesce(jsonb_agg(jsonb_build_object(
           'tier', g.t,
           'reached', (select coalesce(sum(h.c), 0) from (
                         select least(v_tc, floor(p.points::numeric / v_ppt))::integer as tier, count(*) as c
                           from public.player_event_progress p
                          where p.event_id = p_event_id and p.points > 0
                          group by 1) h
                        where h.tier >= g.t),
           'claimed', coalesce(cl.c, 0)) order by g.t), '[]'::jsonb)
    into v_tiers
    from generate_series(1, v_tc) g(t)
    left join (
      select u.t as t, count(*) as c
        from public.player_event_progress p
       cross join lateral unnest(p.tier_claimed) as u(t)
       where p.event_id = p_event_id
       group by u.t
    ) cl on cl.t = g.t;

  -- Auswahl-Belohnung (z.B. Lightnix/Darknix): nur wenn das Event eine hat.
  if v_event.choice_mode = 'player_choice' and coalesce(array_length(v_event.reward_species, 1), 0) > 0 then
    select jsonb_build_object(
             'enabled', true,
             'species', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', s.sp,
                                'name', (select ds.name from public.dragon_species ds where ds.id = s.sp),
                                'count', (select count(*) from public.player_event_progress p
                                           where p.event_id = p_event_id and p.choice_species = s.sp)
                              ) order by s.ord), '[]'::jsonb)
                           from unnest(v_event.reward_species) with ordinality as s(sp, ord)),
             'earned', (select count(*) from public.player_event_progress p where p.event_id = p_event_id and p.earned),
             'open', (select count(*) from public.player_event_progress p
                       where p.event_id = p_event_id and p.earned and p.choice_species is null))
      into v_choice;
  else
    v_choice := jsonb_build_object('enabled', false);
  end if;

  -- Theoretisches Punkte-Maximum (nur eine Schaetzung aus der Konfiguration):
  -- Tage x (normale + schwere Quest + Tagesabschluss) + alle Wochenquest-Stufen.
  if v_event.starts_at is not null and v_event.ends_at is not null then
    v_days := greatest(1, (v_event.ends_at at time zone 'Europe/Berlin')::date - (v_event.starts_at at time zone 'Europe/Berlin')::date + 1);
    if jsonb_typeof(v_cfg->'daily') = 'object' then
      v_normal_n := least(coalesce((v_cfg->'daily'->>'normal_count')::integer, 4),
                          coalesce(jsonb_array_length(v_cfg->'daily'->'normal'), 0));
      v_hard_n := case when coalesce(jsonb_array_length(v_cfg->'daily'->'hard'), 0) > 0 then 1 else 0 end;
      v_daily_pts := v_normal_n * coalesce((v_cfg->'daily'->>'normal_points')::integer, 40)
                   + v_hard_n * coalesce((v_cfg->'daily'->>'hard_points')::integer, 90)
                   + case when v_normal_n + v_hard_n >= coalesce((v_cfg->'daily'->'closure'->>'need')::integer, 4)
                          then coalesce((v_cfg->'daily'->'closure'->>'points')::integer, 100) else 0 end;
    end if;
    if jsonb_typeof(v_cfg->'weekly') = 'array' then
      select coalesce(sum((s->>1)::numeric), 0) into v_weekly_pts
        from jsonb_array_elements(v_cfg->'weekly') q
       cross join lateral jsonb_array_elements(coalesce(q->'stages', '[]'::jsonb)) s;
    end if;
    v_max := v_days * v_daily_pts + v_weekly_pts;
  end if;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id, 'name', v_event.name, 'subtitle', v_event.subtitle, 'status', v_status,
      'enabled', v_event.enabled, 'archived', v_event.archived,
      'announce_at', v_event.announce_at, 'starts_at', v_event.starts_at, 'ends_at', v_event.ends_at,
      'timezone', v_event.timezone, 'tier_count', v_tc, 'points_per_tier', v_ppt,
      'points_to_finish', v_tc * v_ppt, 'theoretical_max_points', v_max,
      'remaining_seconds', case when v_status = 'LIVE' then floor(extract(epoch from (v_event.ends_at - now()))) else null end,
      'choice_mode', v_event.choice_mode, 'reward_species', to_jsonb(v_event.reward_species),
      'tier_rewards', coalesce(v_cfg->'tiers', '[]'::jsonb),
      'choices', coalesce(v_cfg->'choices', '{}'::jsonb)),
    'kpis', v_kpi,
    'histogram', v_hist,
    'tiers', v_tiers,
    'choice', v_choice,
    'berlin_today', v_today,
    'server_now', now());
end;
$$;

-- ---------- 5) Quest-Analyse (Tages-, schwere Tages- und Wochenquests) ----------
-- Tagesquests: Protokoll (abgeschlossene Tage) + die noch laufenden aktuellen
-- Tage der Spieler (jede Zeile genau einmal, siehe Trigger). Abschlussrate =
-- abgeschlossen / vergeben (eine "Vergabe" = eine Quest bei einem Spieler an
-- einem Tag, an dem er das Event geoeffnet hat).
-- NICHT messbar (nicht gespeichert): durchschnittliche Abschlusszeit,
-- Neu-Wuerfeln (gibt es im Framework nicht).
create or replace function public.admin_event_quests(p_event_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_event public.special_events%rowtype;
  v_today date := public.village_berlin_today();
  v_cfg jsonb;
  v_daily jsonb;
  v_closure jsonb;
  v_weekly jsonb;
begin
  if not public.is_active_admin() then raise exception 'not_admin'; end if;
  select * into v_event from public.special_events se where se.id = p_event_id;
  if not found then raise exception 'invalid_event'; end if;
  v_cfg := coalesce(v_event.config, '{}'::jsonb);

  with day_rows as (
    select l.auth_user_id, l.day_key, l.quests, l.closure_done
      from public.event_player_day_log l where l.event_id = p_event_id
    union all
    select p.auth_user_id, p.day_key, p.day_quests, p.day_closure_done
      from public.player_event_progress p where p.event_id = p_event_id and p.day_key is not null
  ), q as (
    select d.day_key, e->>'id' as quest_id, coalesce(e->>'kind', 'normal') as kind,
           coalesce((e->>'done')::boolean, false) as done
      from day_rows d
     cross join lateral jsonb_array_elements(case when jsonb_typeof(d.quests) = 'array' then d.quests else '[]'::jsonb end) e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.quest_id, 'kind', s.kind, 'assigned', s.assigned, 'completed', s.completed,
           'today_assigned', s.today_assigned, 'today_completed', s.today_completed)
           order by s.kind, s.quest_id), '[]'::jsonb)
    into v_daily
    from (
      select q.quest_id, q.kind,
             count(*) as assigned,
             count(*) filter (where q.done) as completed,
             count(*) filter (where q.day_key = v_today) as today_assigned,
             count(*) filter (where q.day_key = v_today and q.done) as today_completed
        from q group by q.quest_id, q.kind
    ) s;

  -- Tagesabschluss (Bonus fuer 4 erledigte Aufgaben): je Spieler und Tag.
  with day_rows as (
    select l.closure_done from public.event_player_day_log l where l.event_id = p_event_id
    union all
    select p.day_closure_done from public.player_event_progress p where p.event_id = p_event_id and p.day_key is not null
  )
  select jsonb_build_object('assigned', count(*), 'completed', count(*) filter (where d.closure_done))
    into v_closure from day_rows d;

  -- Wochenquests: mehrstufig. players = Spieler mit dieser Quest, stages[i] = Stufe i+1 geschafft.
  with w as (
    select p.auth_user_id, q->>'id' as quest_id,
           coalesce(jsonb_array_length(q->'stages'), 0) as stage_count,
           coalesce((p.weekly_done->>(q->>'id'))::integer, 0) as done
      from public.player_event_progress p
     cross join lateral jsonb_array_elements(case when jsonb_typeof(p.weekly_quests) = 'array' then p.weekly_quests else '[]'::jsonb end) q
     where p.event_id = p_event_id
  ), st as (
    select w.quest_id, g.s as stage, count(*) filter (where w.done >= g.s) as reached
      from w cross join lateral generate_series(1, w.stage_count) g(s)
     group by w.quest_id, g.s
  ), pl as (
    select w.quest_id, count(*) as players, max(w.stage_count) as stage_count,
           count(*) filter (where w.stage_count > 0 and w.done >= w.stage_count) as completed
      from w group by w.quest_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pl.quest_id, 'players', pl.players, 'stage_count', pl.stage_count, 'completed', pl.completed,
           'stages', coalesce((select jsonb_agg(st.reached order by st.stage) from st where st.quest_id = pl.quest_id), '[]'::jsonb))
           order by pl.quest_id), '[]'::jsonb)
    into v_weekly from pl;

  return jsonb_build_object(
    'daily', v_daily, 'closure', v_closure, 'weekly', v_weekly,
    'defs', jsonb_build_object(
      'daily_normal', coalesce(v_cfg->'daily'->'normal', '[]'::jsonb),
      'daily_hard', coalesce(v_cfg->'daily'->'hard', '[]'::jsonb),
      'closure', coalesce(v_cfg->'daily'->'closure', '{}'::jsonb),
      'weekly', coalesce(v_cfg->'weekly', '[]'::jsonb),
      'weekly_alts', coalesce(v_cfg->'weekly_alts', '[]'::jsonb)),
    'berlin_today', v_today);
end;
$$;

-- ---------- 6) Entwicklung pro Berliner Kalendertag ----------
-- Direkt ableitbar (exakt): neue Teilnehmer (joined_day), Abschluesse
-- (earned_at), Auswahlen (chosen_at). Aus dem Tagesprotokoll: Spieler mit
-- Event-Aktivitaet je Tag, Punkte/Durchschnittsstufe am Tagesende (letzter
-- bekannter Stand je Spieler). 'tracked' = ab dem Installationstag vollstaendig.
create or replace function public.admin_event_timeline(p_event_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_event public.special_events%rowtype;
  v_today date := public.village_berlin_today();
  v_start date;
  v_end date;
  v_since date;
  v_tc integer;
  v_ppt integer;
  v_unknown integer;
  v_days jsonb := '[]'::jsonb;
begin
  if not public.is_active_admin() then raise exception 'not_admin'; end if;
  select * into v_event from public.special_events se where se.id = p_event_id;
  if not found then raise exception 'invalid_event'; end if;
  v_tc := v_event.tier_count;
  v_ppt := v_event.points_per_tier;
  select (m.set_at at time zone 'Europe/Berlin')::date into v_since from public.event_admin_meta m where m.key = 'stats_since';
  select count(*) into v_unknown from public.player_event_progress p where p.event_id = p_event_id and p.joined_day is null;
  if v_event.starts_at is not null and v_event.ends_at is not null then
    v_start := (v_event.starts_at at time zone 'Europe/Berlin')::date;
    v_end := least((v_event.ends_at at time zone 'Europe/Berlin')::date, v_today);
  end if;

  if v_start is not null and v_end >= v_start then
    with days as (
      select gs::date as day from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs
    ), ppd as (
      select l.auth_user_id, l.day_key, l.points_end
        from public.event_player_day_log l where l.event_id = p_event_id
      union all
      select p.auth_user_id, p.day_key, p.points
        from public.player_event_progress p where p.event_id = p_event_id and p.day_key is not null
    ), asof as (
      select d.day, x.points_end
        from days d
       cross join lateral (
         select distinct on (q.auth_user_id) q.auth_user_id, q.points_end
           from ppd q where q.day_key <= d.day
          order by q.auth_user_id, q.day_key desc
       ) x
    ), agg as (
      select a.day,
             count(*) filter (where a.points_end > 0) as with_points,
             sum(a.points_end) as total_points,
             avg(least(v_tc, floor(a.points_end::numeric / v_ppt))) filter (where a.points_end > 0) as avg_tier
        from asof a group by a.day
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'day', d.day,
             'tracked', (v_since is not null and d.day >= v_since),
             'active', (select count(distinct q.auth_user_id) from ppd q where q.day_key = d.day),
             'new_participants', (select count(*) from public.player_event_progress p
                                   where p.event_id = p_event_id and p.joined_day = d.day),
             'completed', (select count(*) from public.player_event_progress p
                            where p.event_id = p_event_id and p.earned_at is not null
                              and (p.earned_at at time zone 'Europe/Berlin')::date = d.day),
             'choices', (select count(*) from public.player_event_progress p
                          where p.event_id = p_event_id and p.chosen_at is not null
                            and (p.chosen_at at time zone 'Europe/Berlin')::date = d.day),
             'with_points', coalesce(g.with_points, 0),
             'total_points', coalesce(g.total_points, 0),
             'avg_tier', round(g.avg_tier, 2)) order by d.day), '[]'::jsonb)
      into v_days
      from days d left join agg g on g.day = d.day;
  end if;

  return jsonb_build_object(
    'days', v_days,
    'stats_since_day', v_since,
    'unknown_join_count', v_unknown,
    'berlin_today', v_today);
end;
$$;

-- ---------- 7) Spielertabelle (Suche, Sortierung, Seiten) ----------
create or replace function public.admin_event_players(
  p_event_id text,
  p_search text default '',
  p_sort text default 'points',
  p_dir text default 'desc',
  p_limit integer default 25,
  p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_event public.special_events%rowtype;
  v_tc integer;
  v_ppt integer;
  v_today date := public.village_berlin_today();
  v_q text := trim(coalesce(p_search, ''));
  v_pat text;
  v_dir text := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;
  v_sort text := case when lower(coalesce(p_sort, '')) in ('name', 'tier', 'points', 'last', 'daily', 'weekly', 'claimed')
                      then lower(p_sort) else 'points' end;
  v_limit integer := greatest(1, least(100, coalesce(p_limit, 25)));
  v_off integer := greatest(0, coalesce(p_offset, 0));
  v_res jsonb;
begin
  if not public.is_active_admin() then raise exception 'not_admin'; end if;
  select * into v_event from public.special_events se where se.id = p_event_id;
  if not found then raise exception 'invalid_event'; end if;
  v_tc := v_event.tier_count;
  v_ppt := v_event.points_per_tier;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with day_rows as (
    select l.auth_user_id, l.quests from public.event_player_day_log l where l.event_id = p_event_id
    union all
    select p.auth_user_id, p.day_quests from public.player_event_progress p where p.event_id = p_event_id and p.day_key is not null
  ), dsum as (
    select d.auth_user_id,
           sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(d.quests) = 'array' then d.quests else '[]'::jsonb end) e
                 where coalesce((e->>'done')::boolean, false)))::integer as done_total
      from day_rows d group by d.auth_user_id
  ), base as (
    select p.auth_user_id,
           coalesce(nullif(ps.display_name, ''), nullif(p.name_key, ''), 'Unbekannt') as name,
           p.points,
           least(v_tc, floor(p.points::numeric / v_ppt))::integer as tier,
           p.last_tick_at, p.day_key, p.earned, p.choice_species, p.joined_day,
           (select max(c) from unnest(p.tier_claimed) c) as max_claimed,
           coalesce(ds.done_total, 0) as daily_done,
           case when p.day_key = v_today then
             (select count(*) from jsonb_array_elements(case when jsonb_typeof(p.day_quests) = 'array' then p.day_quests else '[]'::jsonb end) e
               where coalesce((e->>'done')::boolean, false)) end as today_done,
           case when p.day_key = v_today then
             jsonb_array_length(case when jsonb_typeof(p.day_quests) = 'array' then p.day_quests else '[]'::jsonb end) end as today_total,
           (select coalesce(sum(least(coalesce((p.weekly_done->>(q->>'id'))::integer, 0), coalesce(jsonb_array_length(q->'stages'), 0))), 0)
              from jsonb_array_elements(case when jsonb_typeof(p.weekly_quests) = 'array' then p.weekly_quests else '[]'::jsonb end) q) as weekly_done,
           (select coalesce(sum(coalesce(jsonb_array_length(q->'stages'), 0)), 0)
              from jsonb_array_elements(case when jsonb_typeof(p.weekly_quests) = 'array' then p.weekly_quests else '[]'::jsonb end) q) as weekly_total
      from public.player_event_progress p
      left join public.player_stats ps on ps.auth_user_id = p.auth_user_id
      left join dsum ds on ds.auth_user_id = p.auth_user_id
     where p.event_id = p_event_id
       and (v_q = '' or ps.display_name ilike v_pat or p.name_key ilike v_pat)
  ), ranked as (
    select b.*,
           row_number() over (order by
             case when v_sort = 'name'    and v_dir = 'asc'  then lower(b.name) end asc,
             case when v_sort = 'name'    and v_dir = 'desc' then lower(b.name) end desc,
             case when v_sort = 'tier'    and v_dir = 'asc'  then b.tier end asc,
             case when v_sort = 'tier'    and v_dir = 'desc' then b.tier end desc,
             case when v_sort = 'points'  and v_dir = 'asc'  then b.points end asc,
             case when v_sort = 'points'  and v_dir = 'desc' then b.points end desc,
             case when v_sort = 'last'    and v_dir = 'asc'  then b.last_tick_at end asc nulls last,
             case when v_sort = 'last'    and v_dir = 'desc' then b.last_tick_at end desc nulls last,
             case when v_sort = 'daily'   and v_dir = 'asc'  then b.daily_done end asc,
             case when v_sort = 'daily'   and v_dir = 'desc' then b.daily_done end desc,
             case when v_sort = 'weekly'  and v_dir = 'asc'  then b.weekly_done end asc,
             case when v_sort = 'weekly'  and v_dir = 'desc' then b.weekly_done end desc,
             case when v_sort = 'claimed' and v_dir = 'asc'  then b.max_claimed end asc nulls first,
             case when v_sort = 'claimed' and v_dir = 'desc' then b.max_claimed end desc nulls last,
             lower(b.name), b.auth_user_id) as rn,
           count(*) over () as total_rows
      from base b
  )
  select jsonb_build_object(
           'total', coalesce(max(r.total_rows), 0),
           'rows', coalesce(jsonb_agg(jsonb_build_object(
                     'auth_user_id', r.auth_user_id, 'name', r.name, 'points', r.points, 'tier', r.tier,
                     'last_tick_at', r.last_tick_at, 'day_key', r.day_key, 'joined_day', r.joined_day,
                     'today_done', r.today_done, 'today_total', r.today_total,
                     'daily_done', r.daily_done, 'weekly_done', r.weekly_done, 'weekly_total', r.weekly_total,
                     'max_claimed', r.max_claimed, 'choice_species', r.choice_species,
                     'status', case when r.tier >= v_tc then 'completed'
                                    when r.points <= 0 then 'started'
                                    when r.day_key = v_today then 'active_today'
                                    else 'inactive' end)
                   order by r.rn) filter (where r.rn > v_off and r.rn <= v_off + v_limit), '[]'::jsonb))
    into v_res
    from ranked r;

  return v_res;
end;
$$;

-- ---------- 8) Spieler-Detail (nur Ansicht - nichts davon ist veraenderbar) ----------
create or replace function public.admin_event_player_detail(p_event_id text, p_auth_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_event public.special_events%rowtype;
  v_row public.player_event_progress%rowtype;
  v_tc integer;
  v_ppt integer;
  v_today date := public.village_berlin_today();
  v_name text;
  v_history jsonb;
begin
  if not public.is_active_admin() then raise exception 'not_admin'; end if;
  select * into v_event from public.special_events se where se.id = p_event_id;
  if not found then raise exception 'invalid_event'; end if;
  select * into v_row from public.player_event_progress p where p.event_id = p_event_id and p.auth_user_id = p_auth_user_id;
  if not found then return jsonb_build_object('found', false); end if;
  v_tc := v_event.tier_count;
  v_ppt := v_event.points_per_tier;
  select coalesce(nullif(ps.display_name, ''), nullif(v_row.name_key, ''), 'Unbekannt') into v_name
    from (select 1) one left join public.player_stats ps on ps.auth_user_id = p_auth_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'day', l.day_key, 'points_end', l.points_end, 'closure_done', l.closure_done,
           'total', case when jsonb_typeof(l.quests) = 'array' then jsonb_array_length(l.quests) else 0 end,
           'done', (select count(*) from jsonb_array_elements(case when jsonb_typeof(l.quests) = 'array' then l.quests else '[]'::jsonb end) e
                     where coalesce((e->>'done')::boolean, false))) order by l.day_key), '[]'::jsonb)
    into v_history
    from public.event_player_day_log l
   where l.event_id = p_event_id and l.auth_user_id = p_auth_user_id;

  return jsonb_build_object(
    'found', true,
    'name', v_name,
    'points', v_row.points,
    'tier', least(v_tc, floor(v_row.points::numeric / v_ppt))::integer,
    'tier_count', v_tc, 'points_per_tier', v_ppt,
    'tier_claimed', to_jsonb(v_row.tier_claimed),
    'earned', v_row.earned, 'earned_at', v_row.earned_at,
    'choice_species', v_row.choice_species, 'chosen_at', v_row.chosen_at,
    'joined_day', v_row.joined_day, 'last_tick_at', v_row.last_tick_at,
    'day_key', v_row.day_key, 'is_today', (v_row.day_key = v_today),
    'day_closure_done', v_row.day_closure_done,
    'cumulative', coalesce(v_row.cumulative, '{}'::jsonb),
    'day_base', coalesce(v_row.day_base, '{}'::jsonb),
    'day_quests', case when jsonb_typeof(v_row.day_quests) = 'array' then v_row.day_quests else '[]'::jsonb end,
    'weekly_quests', case when jsonb_typeof(v_row.weekly_quests) = 'array' then v_row.weekly_quests else '[]'::jsonb end,
    'weekly_done', coalesce(v_row.weekly_done, '{}'::jsonb),
    'history', v_history);
end;
$$;

-- ---------- Rechte ----------
-- Supabase vergibt Ausfuehrungsrechte standardmaessig auch an anon: explizit
-- entziehen, dann nur "authenticated" erlauben - die eigentliche Absicherung ist
-- die Admin-Pruefung IN jeder Funktion (kein Spieler kommt daran vorbei).
revoke all on function public.admin_event_list() from public, anon, authenticated;
revoke all on function public.admin_event_overview(text) from public, anon, authenticated;
revoke all on function public.admin_event_quests(text) from public, anon, authenticated;
revoke all on function public.admin_event_timeline(text) from public, anon, authenticated;
revoke all on function public.admin_event_players(text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_event_player_detail(text, uuid) from public, anon, authenticated;
grant execute on function public.admin_event_list() to authenticated;
grant execute on function public.admin_event_overview(text) to authenticated;
grant execute on function public.admin_event_quests(text) to authenticated;
grant execute on function public.admin_event_timeline(text) to authenticated;
grant execute on function public.admin_event_players(text, text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_event_player_detail(text, uuid) to authenticated;

notify pgrst, 'reload schema';
