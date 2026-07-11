-- Bkmp - "Gelesen"-Status fuer alle Anfragen-Sektionen im Admin-Panel
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Ergaenzt is_read (wie es feedback schon hat, siehe supabase-feedback-schema.sql)
-- fuer die uebrigen 5 "Anfragen"-Tabellen. So kann eine Anfrage als "schon
-- angeschaut" markiert werden, ohne sie sofort bestaetigen/ablehnen zu
-- muessen - sie bleibt bis dahin ganz normal "offen" (status = 'pending'),
-- taucht aber nicht mehr als "neu" im Login-Popup auf.
--
-- Keine neuen RLS-Policies noetig: die bestehenden "Admins update ..."-
-- Policies auf allen 5 Tabellen pruefen nur is_active_admin() und decken
-- damit automatisch auch die neue Spalte ab.

alter table public.investor_requests add column if not exists is_read boolean not null default false;
alter table public.card_sale_requests add column if not exists is_read boolean not null default false;
alter table public.wishes add column if not exists is_read boolean not null default false;
alter table public.partner_shops add column if not exists is_read boolean not null default false;
alter table public.card_catalog add column if not exists is_read boolean not null default false;

create index if not exists investor_requests_is_read_idx on public.investor_requests (is_read);
create index if not exists card_sale_requests_is_read_idx on public.card_sale_requests (is_read);
create index if not exists wishes_is_read_idx on public.wishes (is_read);
create index if not exists partner_shops_is_read_idx on public.partner_shops (is_read);
create index if not exists card_catalog_is_read_idx on public.card_catalog (is_read);
