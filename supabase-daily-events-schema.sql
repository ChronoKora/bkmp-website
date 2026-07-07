-- Bkmp - Daily Code Events + Golden Hour
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Einmal pro Tag werden per Vercel Cron (api/generate-daily-events.js) 20
-- Eintraege mit zufaelligen Uhrzeiten fuer den Tag angelegt (Zeiten liegen
-- also schon vorher fest, werden aber nie an Clients ausgeliefert, bevor
-- ein Event wirklich "live" ist - siehe api/active-daily-event.js). Genau
-- EINES der 20 wird zufaellig als Golden Hour markiert.
--
-- WICHTIG: "Nur der Erste gewinnt" wird ausschliesslich serverseitig per
-- atomarem UPDATE ... WHERE winner_name_key is null geprueft
-- (api/redeem-daily-event.js) - das verhindert zuverlaessig zwei Gewinner
-- bei gleichzeitigen Einloese-Versuchen.

create table if not exists public.daily_code_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null default current_date,
  scheduled_at timestamptz not null,
  plushie_id text not null,
  code text not null unique,
  is_golden_hour boolean not null default false,
  winner_name_key text,
  winner_display_name text,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists daily_code_events_date_idx on public.daily_code_events (event_date);
create index if not exists daily_code_events_scheduled_idx on public.daily_code_events (scheduled_at);

alter table public.daily_code_events enable row level security;

-- Keine oeffentliche Lese-Policy: Codes/Uhrzeiten duerfen NIE direkt per
-- REST-Abfrage einsehbar sein, sonst koennte man Events vorab erkennen
-- oder Codes lesen, ohne dass sie "live" sind. Der Browser bekommt
-- Event-Infos ausschliesslich ueber api/active-daily-event.js (prueft
-- serverseitig, ob gerade ein Event laeuft) und meldet Gewinne nur ueber
-- api/redeem-daily-event.js (atomarer Claim). Beide nutzen den
-- Service-Role-Key und umgehen RLS bewusst.
drop policy if exists "Admins read daily events" on public.daily_code_events;
create policy "Admins read daily events"
on public.daily_code_events for select
to authenticated
using (public.is_active_admin());

drop policy if exists "Admins update daily events" on public.daily_code_events;
create policy "Admins update daily events"
on public.daily_code_events for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());
