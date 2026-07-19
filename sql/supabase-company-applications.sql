-- Bkmp - Firmenbewerbungen fuer Kartenaufträge ("Bist du eine
-- Kartenbaufirma? Bewirb dich hier").
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Gleiches Muster wie supabase-investor-requests-schema.sql: oeffentlich
-- darf JEDER eine Bewerbung einreichen (Insert, nur mit status='pending'),
-- aber nur aktive Admins duerfen die Liste sehen/bestaetigen/ablehnen.
-- Felder spiegeln 1:1 die Spalten von public.companies (siehe
-- supabase-mapart-marketplace-schema.sql), damit eine bestaetigte
-- Bewerbung 1:1 in eine echte companies-Zeile uebernommen werden kann
-- (admin.html/mapart.js: confirmCompanyApplication).
--
-- specialties liegt hier bewusst als einfacher Komma-Text (nicht text[])
-- vor - die Einreichung laeuft ueber api/submit-entry.js (Service-Role,
-- generischer String-Feld-Mechanismus ohne Array-Unterstuetzung). Beim
-- Bestaetigen wird der Text in ein echtes text[] fuer companies.specialties
-- aufgeteilt.

create table if not exists public.company_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text not null,
  discord_url text,
  website_url text,
  description text,
  specialties text,
  price_range_min numeric,
  price_range_max numeric,
  logo_url text,
  banner_url text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.company_applications
  drop constraint if exists company_applications_status_check;
alter table public.company_applications
  add constraint company_applications_status_check check (status in ('pending', 'confirmed', 'rejected'));

create index if not exists company_applications_created_at_idx on public.company_applications (created_at desc);
create index if not exists company_applications_status_idx on public.company_applications (status);

alter table public.company_applications enable row level security;

grant usage on schema public to anon, authenticated;
grant insert on public.company_applications to anon, authenticated;
grant select, update, delete on public.company_applications to authenticated;

-- Oeffentlich: nur Einreichen erlaubt (Status muss "pending" sein, damit
-- niemand sich per direktem API-Aufruf selbst als "confirmed" eintraegt).
-- In der Praxis laeuft die Einreichung ueber api/submit-entry.js (Service-
-- Role, umgeht RLS ohnehin) - diese Policy ist trotzdem als Absicherung
-- fuer den direkten Client-Pfad da, konsistent mit dem Investoren-Muster.
drop policy if exists "Public insert company applications" on public.company_applications;
create policy "Public insert company applications"
on public.company_applications for insert
to anon, authenticated
with check (status = 'pending');

drop policy if exists "Admins read company applications" on public.company_applications;
create policy "Admins read company applications"
on public.company_applications for select
to authenticated
using (public.is_active_admin());

drop policy if exists "Admins update company applications" on public.company_applications;
create policy "Admins update company applications"
on public.company_applications for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

drop policy if exists "Admins delete company applications" on public.company_applications;
create policy "Admins delete company applications"
on public.company_applications for delete
to authenticated
using (public.is_active_admin());
