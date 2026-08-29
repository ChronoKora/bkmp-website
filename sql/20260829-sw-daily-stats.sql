-- ============================================================
-- Bkmp - SW-Besucher-Statistik fuer /sw bk (29.08.2026)
-- ============================================================
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Sicher mehrfach ausfuehrbar (create table if not exists / drop policy
-- if exists + create policy / create or replace function).
--
-- Braucht public.is_active_admin() (sql/supabase-security-hardening.sql +
-- sql/supabase-mapart-marketplace-schema.sql) UND public.is_expenses_editor()
-- (sql/20260814-expenses-editor-role.sql) - beide muessen vorher bereits
-- ausgefuehrt sein (sind es laut CLAUDE.md).
--
-- WICHTIG (Auftrag Abschnitt 3, Top-5-Rang): /sw bk kann auf dem Server nur
-- innerhalb der sichtbaren Top 5 einer SW-Rangliste eingesehen werden - jede
-- cbN_rank-Spalte ist deshalb NICHT numerisch, sondern text mit einer
-- CHECK-Bedingung, die AUSSCHLIESSLICH '1'..'5' oder 'not_in_top5' erlaubt.
-- Rang #6/#7/... kann dadurch strukturell nie gespeichert werden. NULL
-- bedeutet "fuer diesen CB an diesem Tag kein Rang eingetragen" (Auftrag
-- Abschnitt 3: Rang ist optional) - das ist ein DRITTER, von 'not_in_top5'
-- bewusst unterschiedener Zustand (siehe Auftrag Abschnitt 18/23) und muss
-- bei Durchschnitts-/Top5-Quoten-Berechnungen ausdruecklich ausgeschlossen
-- werden, nicht als "nicht in Top 5" mitgezaehlt werden.
--
-- WICHTIG (Auftrag Abschnitt 6, doppelte Eintraege verhindern): stat_date
-- ist "unique" - ein zweiter Insert-Versuch fuer denselben Tag scheitert an
-- der Datenbank-Constraint selbst, nicht nur an Frontend-Disziplin. Die
-- Admin-Oberflaeche nutzt fuers Speichern ein "upsert" (on conflict stat_date
-- do update), dadurch entsteht bei erneutem Speichern desselben Datums immer
-- eine Aktualisierung, nie ein Duplikat.
--
-- WICHTIG (Auftrag Abschnitt 23, Datenqualitaet): ein Tag OHNE gespeicherte
-- Zeile bedeutet "keine Daten vorhanden", NICHT "0 Besucher". cbN_visitors
-- selbst ist "not null default 0", weil eine tatsaechlich eingetragene Zeile
-- fuer jeden der 6 CBs immer eine echte Zahl enthaelt (auch wenn die Zahl 0
-- ist) - die Unterscheidung "kein Datensatz" vs. "Datensatz mit 0" passiert
-- ausschliesslich auf Zeilenebene (existiert eine Zeile fuer dieses Datum
-- ueberhaupt), nicht auf Spaltenebene.
-- ============================================================

create table if not exists public.sw_daily_stats (
  id uuid primary key default gen_random_uuid(),
  stat_date date not null unique,

  cb1_visitors integer not null default 0,
  cb1_rank text,
  cb2_visitors integer not null default 0,
  cb2_rank text,
  cb3_visitors integer not null default 0,
  cb3_rank text,
  cb4_visitors integer not null default 0,
  cb4_rank text,
  cb5_visitors integer not null default 0,
  cb5_rank text,
  cb6_visitors integer not null default 0,
  cb6_rank text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb1_visitors_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb1_visitors_check check (cb1_visitors >= 0);
alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb2_visitors_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb2_visitors_check check (cb2_visitors >= 0);
alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb3_visitors_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb3_visitors_check check (cb3_visitors >= 0);
alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb4_visitors_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb4_visitors_check check (cb4_visitors >= 0);
alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb5_visitors_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb5_visitors_check check (cb5_visitors >= 0);
alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb6_visitors_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb6_visitors_check check (cb6_visitors >= 0);

-- Je EINE Rang-Check-Bedingung pro CB - erlaubt ausschliesslich NULL (kein
-- Rang eingetragen), '1'..'5' oder 'not_in_top5'. Niemals '6'/'7'/... oder
-- irgendein anderer Text.
alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb1_rank_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb1_rank_check check (cb1_rank is null or cb1_rank in ('1','2','3','4','5','not_in_top5'));
alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb2_rank_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb2_rank_check check (cb2_rank is null or cb2_rank in ('1','2','3','4','5','not_in_top5'));
alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb3_rank_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb3_rank_check check (cb3_rank is null or cb3_rank in ('1','2','3','4','5','not_in_top5'));
alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb4_rank_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb4_rank_check check (cb4_rank is null or cb4_rank in ('1','2','3','4','5','not_in_top5'));
alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb5_rank_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb5_rank_check check (cb5_rank is null or cb5_rank in ('1','2','3','4','5','not_in_top5'));
alter table public.sw_daily_stats drop constraint if exists sw_daily_stats_cb6_rank_check;
alter table public.sw_daily_stats add constraint sw_daily_stats_cb6_rank_check check (cb6_rank is null or cb6_rank in ('1','2','3','4','5','not_in_top5'));

-- Kein zusaetzlicher Index auf stat_date noetig - die "unique"-Spalten-
-- bedingung oben legt bereits automatisch einen eindeutigen Index an
-- (identische Lektion wie beim Buechershop-Sicherheitsaudit vom 28.08.2026,
-- siehe CLAUDE.md "doppelte Indizes").

alter table public.sw_daily_stats enable row level security;

revoke all on public.sw_daily_stats from anon;
grant select on public.sw_daily_stats to anon, authenticated;
grant insert, update, delete on public.sw_daily_stats to authenticated;

-- Oeffentlich lesbar (gleiches Prinzip wie incomes/expenses) - die neue
-- "SW-BESUCHER"-Sektion auf der Umsatzseite braucht keinen Login.
drop policy if exists "Public read sw daily stats" on public.sw_daily_stats;
create policy "Public read sw daily stats" on public.sw_daily_stats
  for select to anon, authenticated
  using (true);

-- Volle Admins: kompletter CRUD (Insert/Update/Loeschen falscher Eintraege).
drop policy if exists "Admins write sw daily stats" on public.sw_daily_stats;
create policy "Admins write sw daily stats" on public.sw_daily_stats
  for all to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

-- Mitarbeiter-Zugang (Rolle "expenses_editor", siehe sql/20260814-expenses-
-- editor-role.sql) - bewusst NUR Einfuegen+Bearbeiten, KEIN Loeschen (gleiche
-- Zurueckhaltung wie beim bestehenden Ausgaben-Zugang dieser Rolle).
drop policy if exists "Expenses editor insert sw daily stats" on public.sw_daily_stats;
create policy "Expenses editor insert sw daily stats" on public.sw_daily_stats
  for insert to authenticated
  with check (public.is_expenses_editor());

drop policy if exists "Expenses editor update sw daily stats" on public.sw_daily_stats;
create policy "Expenses editor update sw daily stats" on public.sw_daily_stats
  for update to authenticated
  using (public.is_expenses_editor())
  with check (public.is_expenses_editor());

-- Automatisch "updated_at" pflegen (rein informativ, keine Businesslogik).
create or replace function public.sw_daily_stats_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sw_daily_stats_set_updated_at_trg on public.sw_daily_stats;
create trigger sw_daily_stats_set_updated_at_trg
  before update on public.sw_daily_stats
  for each row
  execute function public.sw_daily_stats_set_updated_at();

-- Realtime (optional, gleiches Muster wie bei anderen Live-Tabellen dieses
-- Projekts) - macht die neue "SW-BESUCHER"-Sektion auf der oeffentlichen
-- Umsatzseite live-aktuell, sobald ein Admin/Mitarbeiter einen Tag eintraegt,
-- ohne dass Besucher die Seite neu laden muessen.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sw_daily_stats'
  ) then
    alter publication supabase_realtime add table public.sw_daily_stats;
  end if;
exception when undefined_object then
  null;
end $$;
