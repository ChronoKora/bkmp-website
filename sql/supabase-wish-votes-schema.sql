-- Bkmp - Kartenideen: Like/Dislike auf 1x pro Account begrenzen
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Bisher konnte likes/dislikes beliebig oft hochgezaehlt werden: die alte
-- "Public vote wishes"-Policy (supabase-security-hardening.sql) erlaubte der
-- anon-Rolle ein direktes UPDATE auf likes/dislikes OHNE jede Nutzeridentitaet
-- - ein Limit war so grundsaetzlich nicht moeglich, egal was der Client tut.
--
-- Jetzt: eine eigene Stimmen-Tabelle mit einem Unique-Constraint pro
-- (wish_id, auth_user_id). Ein Account kann pro Kartenidee hoechstens EINE
-- Stimme abgeben (Like ODER Dislike) - ein zweiter Insert-Versuch schlaegt
-- hart am Constraint fehl, unabhaengig davon, was der Client schickt. Die
-- Stimme ist bewusst final (kein Umstimmen/Un-Voten), passend zu "kann nur
-- 1x gedrueckt werden".
--
-- wishes.likes/dislikes werden per Trigger automatisch aus wish_votes
-- nachgefuehrt, damit die bestehende Anzeige (w.likes/w.dislikes) unveraendert
-- weiterlaeuft. Direktes Client-Update dieser beiden Spalten wird gesperrt,
-- damit das 1x-Limit nicht per einfachem UPDATE umgangen werden kann.

create table if not exists public.wish_votes (
  id uuid primary key default gen_random_uuid(),
  wish_id uuid not null references public.wishes(id) on delete cascade,
  auth_user_id uuid not null,
  vote_type text not null check (vote_type in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  unique (wish_id, auth_user_id)
);

create index if not exists wish_votes_wish_id_idx on public.wish_votes (wish_id);
create index if not exists wish_votes_auth_user_id_idx on public.wish_votes (auth_user_id);

alter table public.wish_votes enable row level security;

grant usage on schema public to authenticated;
grant select, insert on public.wish_votes to authenticated;

-- Nur die eigene(n) Stimme(n) lesen/abgeben.
drop policy if exists "Own vote select" on public.wish_votes;
create policy "Own vote select"
on public.wish_votes for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists "Own vote insert" on public.wish_votes;
create policy "Own vote insert"
on public.wish_votes for insert
to authenticated
with check (auth_user_id = auth.uid());

-- Admins duerfen zur Moderation alle Stimmen sehen/loeschen (z. B. falls
-- eine Kartenidee komplett zurueckgesetzt werden muss).
drop policy if exists "Admins read wish votes" on public.wish_votes;
create policy "Admins read wish votes"
on public.wish_votes for select
to authenticated
using (public.is_active_admin());

drop policy if exists "Admins delete wish votes" on public.wish_votes;
create policy "Admins delete wish votes"
on public.wish_votes for delete
to authenticated
using (public.is_active_admin());
grant delete on public.wish_votes to authenticated;

-- likes/dislikes auf wishes automatisch aus wish_votes nachfuehren. Laeuft
-- als SECURITY DEFINER (umgeht RLS auf wishes), damit es unabhaengig von
-- der Rolle des abstimmenden Nutzers funktioniert.
create or replace function public.bkmp_recompute_wish_votes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wish_id uuid := coalesce(new.wish_id, old.wish_id);
begin
  update public.wishes set
    likes = (select count(*) from public.wish_votes where wish_id = v_wish_id and vote_type = 'like'),
    dislikes = (select count(*) from public.wish_votes where wish_id = v_wish_id and vote_type = 'dislike')
  where id = v_wish_id;
  return null;
end;
$$;

drop trigger if exists trg_wish_votes_recompute on public.wish_votes;
create trigger trg_wish_votes_recompute
after insert or delete on public.wish_votes
for each row execute function public.bkmp_recompute_wish_votes();

-- Alte, ungeschuetzte Abstimm-Policy entfernen und direkten Spaltenzugriff
-- fuer anon sperren - ab jetzt darf likes/dislikes NUR noch der obige
-- Trigger aendern (laeuft als Tabellenbesitzer, umgeht RLS/Grants).
drop policy if exists "Public vote wishes" on public.wishes;
revoke update (likes, dislikes) on public.wishes from anon;
