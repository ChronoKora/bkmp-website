-- Bkmp - Oeffentliches Feedback-/Bug-/Entwicklungsboard (Stufe 2)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- NOCH NICHT AUSGEFUEHRT - liegt hier nur zur Durchsicht/Freigabe (siehe
-- Chat, Stufe-1-Abschlussbericht 20.07.2026). Braucht public.is_active_admin()
-- aus supabase-security-hardening.sql (bereits live).
--
-- Bewusst ZWEI NEUE, GETRENNTE Tabellen statt zusaetzlicher public_*-Spalten
-- auf der bestehenden public.feedback-Tabelle: RLS in Postgres filtert nur
-- ZEILEN, nicht Spalten. Eine gemeinsame Tabelle mit "using(is_public=true)"
-- wuerde bei einer Freigabe automatisch auch name/message/image_url der
-- betroffenen Zeile fuer JEDEN oeffentlich lesbar machen. Diese Tabellen
-- hier enthalten stattdessen AUSSCHLIESSLICH admin-verfasste, absichtlich
-- oeffentliche Felder - ein versehentliches Datenschutz-Leck ist dadurch
-- strukturell ausgeschlossen statt nur durch RLS-Policy-Disziplin verhindert.
--
-- public.feedback bleibt davon komplett unberuehrt (keine ALTER TABLE hier).

create table if not exists public.feedback_public (
  id uuid primary key default gen_random_uuid(),
  -- Rein interne Zuordnung/Nachvollziehbarkeit fuer den Admin (welche private
  -- Einreichung war der Ausloeser) - wird in keiner oeffentlichen Abfrage
  -- unten SELECTed, ist aber kein Geheimnis (nur eine UUID ohne Bedeutung
  -- ausserhalb der eigenen DB).
  source_feedback_id uuid references public.feedback(id) on delete set null,
  -- 'bug' | 'idea' - eigenes Feld statt aus category/status abgeleitet, da
  -- beides je Auftrag Abschnitt 9/11 zwei getrennte Abschnitte im Board mit
  -- teils eigenen Statuswerten sind (siehe status-Check weiter unten).
  kind text not null default 'bug',
  title text not null,
  category text not null default 'sonstiges',
  status text not null default 'eingegangen',
  description text,
  response text,
  -- 'anonymous' (Standard) | 'short_name' | 'full_name' - siehe Auftrag
  -- Abschnitt 6, Standard bleibt IMMER 'anonymous'.
  author_mode text not null default 'anonymous',
  -- Nur befuellt, wenn author_mode != 'anonymous' - vom Admin manuell
  -- eingetragen (NIE automatisch aus dem privaten Namen uebernommen).
  author_display text,
  duplicate_of uuid references public.feedback_public(id) on delete set null,
  planned_release text,
  is_published boolean not null default false,
  published_at timestamptz,
  resolved_at timestamptz,
  last_public_update timestamptz not null default now(),
  -- Inert vorbereitet fuer Auftrag Abschnitt 13 ("Betrifft mich auch") -
  -- die eigentliche Stimmen-Zaehlung MIT Mehrfachstimmen-Schutz braucht eine
  -- eigene Verknuepfungstabelle (auth_user_id + feedback_public_id, unique
  -- constraint) und wird separat zur Freigabe vorgelegt, siehe Chat/Auftrag.
  affects_count integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Nachtrag (21.07., noch am selben Tag): "kind" wurde erst NACH der ersten
-- Freigabe/Ausfuehrung dieser Datei ergaenzt (siehe Chat) - fuer bereits
-- angelegte Tabellen ohne diese Spalte holt dieser ALTER es sicher/idempotent
-- nach; bei einer komplett neuen Installation ist er ein wirkungsloser
-- No-op (die Spalte existiert dann schon aus dem CREATE TABLE oben).
alter table public.feedback_public add column if not exists kind text not null default 'bug';

alter table public.feedback_public
  drop constraint if exists feedback_public_kind_check;
alter table public.feedback_public
  add constraint feedback_public_kind_check check (kind in ('bug', 'idea'));

alter table public.feedback_public
  drop constraint if exists feedback_public_category_check;
alter table public.feedback_public
  add constraint feedback_public_category_check check (category in (
    'bug', 'kritik', 'verbesserung', 'idee', 'mobile', 'performance',
    'ui', 'kampf', 'runen', 'dungeons', 'drachen', 'gilde', 'account', 'sonstiges'
  ));

alter table public.feedback_public
  drop constraint if exists feedback_public_status_check;
alter table public.feedback_public
  add constraint feedback_public_status_check check (status in (
    'eingegangen', 'wird_geprueft', 'bestaetigt', 'geplant', 'in_arbeit',
    'wartet_auf_asset', 'wartet_auf_rueckmeldung', 'behoben', 'veroeffentlicht',
    'nicht_reproduzierbar', 'abgelehnt', 'duplikat', 'in_entwicklung',
    'zurueckgestellt', 'nicht_geplant'
  ));

alter table public.feedback_public
  drop constraint if exists feedback_public_author_mode_check;
alter table public.feedback_public
  add constraint feedback_public_author_mode_check check (author_mode in ('anonymous', 'short_name', 'full_name'));

create index if not exists feedback_public_is_published_idx on public.feedback_public (is_published);
create index if not exists feedback_public_status_idx on public.feedback_public (status);
create index if not exists feedback_public_category_idx on public.feedback_public (category);
create index if not exists feedback_public_last_update_idx on public.feedback_public (last_public_update desc);

alter table public.feedback_public enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.feedback_public to anon, authenticated;
grant insert, update, delete on public.feedback_public to authenticated;

-- Oeffentlich: NUR veroeffentlichte Zeilen lesbar. Jede Spalte in dieser
-- Tabelle ist absichtlich oeffentlich verfasst (siehe Kommentar oben), daher
-- reicht eine normale Zeilen-Policy ohne Spalten-Einschraenkung.
drop policy if exists "Public read published feedback_public" on public.feedback_public;
create policy "Public read published feedback_public"
on public.feedback_public for select
to anon, authenticated
using (is_published = true);

-- Admins duerfen ausserdem auch unveroeffentlichte/eigene Entwuerfe sehen
-- (fuer die Vorschau-Spalte im Admin-Panel, siehe Stufe 3).
drop policy if exists "Admins read all feedback_public" on public.feedback_public;
create policy "Admins read all feedback_public"
on public.feedback_public for select
to authenticated
using (public.is_active_admin());

drop policy if exists "Admins write feedback_public" on public.feedback_public;
create policy "Admins write feedback_public"
on public.feedback_public for insert
to authenticated
with check (public.is_active_admin());

drop policy if exists "Admins update feedback_public" on public.feedback_public;
create policy "Admins update feedback_public"
on public.feedback_public for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

drop policy if exists "Admins delete feedback_public" on public.feedback_public;
create policy "Admins delete feedback_public"
on public.feedback_public for delete
to authenticated
using (public.is_active_admin());

-- ---------------- Fortschrittsverlauf ----------------

create table if not exists public.feedback_public_progress (
  id uuid primary key default gen_random_uuid(),
  feedback_public_id uuid not null references public.feedback_public(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  sort_order integer not null default 0
);

create index if not exists feedback_public_progress_parent_idx on public.feedback_public_progress (feedback_public_id, sort_order);

alter table public.feedback_public_progress enable row level security;

grant select on public.feedback_public_progress to anon, authenticated;
grant insert, update, delete on public.feedback_public_progress to authenticated;

-- Oeffentlich lesbar nur, wenn der zugehoerige Eintrag selbst veroeffentlicht ist.
drop policy if exists "Public read progress of published entries" on public.feedback_public_progress;
create policy "Public read progress of published entries"
on public.feedback_public_progress for select
to anon, authenticated
using (
  exists (
    select 1 from public.feedback_public fp
    where fp.id = feedback_public_id and fp.is_published = true
  )
);

drop policy if exists "Admins read all progress" on public.feedback_public_progress;
create policy "Admins read all progress"
on public.feedback_public_progress for select
to authenticated
using (public.is_active_admin());

drop policy if exists "Admins write progress" on public.feedback_public_progress;
create policy "Admins write progress"
on public.feedback_public_progress for insert
to authenticated
with check (public.is_active_admin());

drop policy if exists "Admins update progress" on public.feedback_public_progress;
create policy "Admins update progress"
on public.feedback_public_progress for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

drop policy if exists "Admins delete progress" on public.feedback_public_progress;
create policy "Admins delete progress"
on public.feedback_public_progress for delete
to authenticated
using (public.is_active_admin());
