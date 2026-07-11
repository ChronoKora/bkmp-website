-- Bkmp - Umfragesystem (Ja/Nein-Abstimmungen im Banner oben auf der Seite)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- WICHTIG: braucht public.is_active_admin() (aus supabase-security-hardening.sql)
-- und den Player-Account-Auth-Client (supabase-player-accounts.sql) - Stimmen
-- sind an einen echten eingeloggten Account (auth_user_id) gebunden, nicht
-- nur an einen lokal eingetragenen Namen.
--
-- Architektur folgt 1:1 dem bereits bewaehrten Muster von wish_votes
-- (supabase-wish-votes-schema.sql): eine eigene Stimmen-Tabelle mit
-- Unique-Constraint (poll_id, auth_user_id) - ein zweiter Insert-Versuch
-- schlaegt hart am Constraint fehl, unabhaengig davon, was der Client
-- schickt. Genau DAS ist die serverseitige Mehrfachabstimm-Sperre, nicht
-- nur eine Frontend-Pruefung. yes_votes/no_votes auf polls werden nur per
-- Trigger aus poll_votes nachgefuehrt (kein direktes Client-Update moeglich)
-- - das erfuellt "Ergebnisse duerfen im Admin-Panel nur angesehen und nicht
-- manuell veraendert werden".

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'ended', 'archived')),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  deactivated_at timestamptz,
  yes_votes integer not null default 0,
  no_votes integer not null default 0
);

-- Nur eine Umfrage darf gleichzeitig 'active' sein - erzwungen als echter
-- DB-Constraint (partieller Unique-Index ueber alle Zeilen mit status =
-- 'active'), nicht nur per Anwendungslogik.
create unique index if not exists polls_single_active_idx on public.polls ((status)) where status = 'active';

alter table public.polls enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.polls to anon, authenticated;
grant insert, update on public.polls to authenticated;

-- Oeffentlich lesbar (auch fuer nicht eingeloggte Besucher, damit die
-- aktive Umfrage im Banner ueberhaupt angezeigt werden kann - abstimmen
-- geht trotzdem nur eingeloggt, siehe poll_votes unten).
drop policy if exists "Public read polls" on public.polls;
create policy "Public read polls"
on public.polls for select
to anon, authenticated
using (true);

drop policy if exists "Admins insert polls" on public.polls;
create policy "Admins insert polls"
on public.polls for insert
to authenticated
with check (public.is_active_admin());

drop policy if exists "Admins update polls" on public.polls;
create policy "Admins update polls"
on public.polls for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

-- yes_votes/no_votes duerfen NIEMALS direkt per Client-Update geschrieben
-- werden (auch nicht von Admins) - nur der Trigger unten (laeuft als
-- Tabellenbesitzer, umgeht Grants/RLS) darf sie aendern.
revoke update (yes_votes, no_votes) on public.polls from authenticated;

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  auth_user_id uuid not null,
  answer text not null check (answer in ('yes', 'no')),
  created_at timestamptz not null default now(),
  unique (poll_id, auth_user_id)
);

create index if not exists poll_votes_poll_id_idx on public.poll_votes (poll_id);
create index if not exists poll_votes_auth_user_id_idx on public.poll_votes (auth_user_id);

alter table public.poll_votes enable row level security;

grant usage on schema public to authenticated;
grant select, insert on public.poll_votes to authenticated;

-- Nur die eigene(n) Stimme(n) lesen/abgeben - so kann der Client pruefen,
-- ob der eingeloggte Account schon abgestimmt hat, ohne fremde Stimmen zu
-- sehen. Kein Update/Delete fuer normale Nutzer: eine Stimme ist final.
drop policy if exists "Own poll vote select" on public.poll_votes;
create policy "Own poll vote select"
on public.poll_votes for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists "Own poll vote insert" on public.poll_votes;
create policy "Own poll vote insert"
on public.poll_votes for insert
to authenticated
with check (auth_user_id = auth.uid());

-- Admins duerfen zur Kontrolle alle Einzelstimmen sehen, aber laut
-- Anforderung ausdruecklich NICHT veraendern - deshalb bewusst keine
-- Update/Delete-Policy fuer Admins hier.
drop policy if exists "Admins read poll votes" on public.poll_votes;
create policy "Admins read poll votes"
on public.poll_votes for select
to authenticated
using (public.is_active_admin());

-- yes_votes/no_votes auf polls automatisch aus poll_votes nachfuehren.
create or replace function public.bkmp_recompute_poll_votes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poll_id uuid := coalesce(new.poll_id, old.poll_id);
begin
  update public.polls set
    yes_votes = (select count(*) from public.poll_votes where poll_id = v_poll_id and answer = 'yes'),
    no_votes = (select count(*) from public.poll_votes where poll_id = v_poll_id and answer = 'no')
  where id = v_poll_id;
  return null;
end;
$$;

drop trigger if exists trg_poll_votes_recompute on public.poll_votes;
create trigger trg_poll_votes_recompute
after insert on public.poll_votes
for each row execute function public.bkmp_recompute_poll_votes();

-- Atomarer Wechsel der aktiven Umfrage: deaktiviert eine evtl. schon
-- laufende Umfrage UND aktiviert die neue in einem Schritt, damit nie kurz
-- 0 oder 2 Umfragen gleichzeitig aktiv sind (und der partielle Unique-Index
-- oben nicht dazwischenfunkt). Security definer + eigene Admin-Pruefung,
-- damit ein einzelner RPC-Aufruf aus dem Admin-Panel reicht.
create or replace function public.activate_poll(p_poll_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_admin() then
    raise exception 'not_admin';
  end if;

  update public.polls
  set status = 'ended', deactivated_at = now()
  where status = 'active' and id <> p_poll_id;

  update public.polls
  set status = 'active', activated_at = now(), deactivated_at = null
  where id = p_poll_id;
end;
$$;

grant execute on function public.activate_poll(uuid) to authenticated;
