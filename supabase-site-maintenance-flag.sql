-- Bkmp - Wartungsmodus-Schalter fuer das Idle Drachen Dorf (inkl. Raids).
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Vorher war der Wartungsmodus eine feste Konstante in idledorf.js
-- (BKMP_IDLE_MAINTENANCE_MODE) - Ein-/Ausschalten brauchte einen
-- Code-Deploy UND bereits offene Tabs bekamen es nie live mit. Diese eine
-- Zeile hier ist der einzige Schalter, per Admin-Panel jederzeit ohne
-- Deploy umschaltbar; idledorf.js pollt sie regelmaessig und stoesst bei
-- aktivem Wartungsmodus in bereits offenen Tabs automatisch ein Reload an.

create table if not exists public.site_flags (
  id boolean primary key default true,
  idle_maintenance boolean not null default false,
  idle_maintenance_message text not null default 'Das Idle Drachen Dorf ist gerade kurz für Wartungsarbeiten pausiert. Es geht bald weiter, bitte versuch es später nochmal.',
  updated_at timestamptz not null default now(),
  constraint site_flags_singleton check (id = true)
);

insert into public.site_flags (id) values (true)
  on conflict (id) do nothing;

alter table public.site_flags enable row level security;

drop policy if exists "site_flags_select_all" on public.site_flags;
create policy "site_flags_select_all" on public.site_flags
  for select using (true);

drop policy if exists "site_flags_update_admin" on public.site_flags;
create policy "site_flags_update_admin" on public.site_flags
  for update using (is_active_admin()) with check (is_active_admin());
