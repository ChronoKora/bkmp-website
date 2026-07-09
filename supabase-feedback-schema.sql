-- Bkmp - Feedback-System Schema
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Braucht public.is_active_admin() aus supabase-security-hardening.sql.
--
-- Gleiches Muster wie card_sale_requests: jeder darf Feedback einreichen
-- (Insert, laeuft in der Praxis ueber /api/submit-entry.js mit dem
-- Service-Role-Key), aber nur aktive Admins duerfen die Liste sehen/als
-- gelesen markieren/archivieren/loeschen - Feedback ist keine oeffentliche
-- Wall, sondern eine private Nachricht an die Adminschaft.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  name text,
  category text not null default 'sonstiges',
  message text not null,
  image_url text,
  is_read boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.feedback
  drop constraint if exists feedback_category_check;
alter table public.feedback
  add constraint feedback_category_check check (category in ('lob', 'idee', 'kritik', 'sonstiges'));

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_is_read_idx on public.feedback (is_read);
create index if not exists feedback_is_archived_idx on public.feedback (is_archived);

alter table public.feedback enable row level security;

grant usage on schema public to anon, authenticated;
grant insert on public.feedback to anon, authenticated;
grant select, update, delete on public.feedback to authenticated;

-- Oeffentlich: nur Einreichen erlaubt, immer ungelesen/nicht archiviert.
drop policy if exists "Public insert feedback" on public.feedback;
create policy "Public insert feedback"
on public.feedback for insert
to anon, authenticated
with check (is_read = false and is_archived = false);

-- Lesen/Bearbeiten/Loeschen nur fuer aktive Admins.
drop policy if exists "Admins read feedback" on public.feedback;
create policy "Admins read feedback"
on public.feedback for select
to authenticated
using (public.is_active_admin());

drop policy if exists "Admins update feedback" on public.feedback;
create policy "Admins update feedback"
on public.feedback for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

drop policy if exists "Admins delete feedback" on public.feedback;
create policy "Admins delete feedback"
on public.feedback for delete
to authenticated
using (public.is_active_admin());
