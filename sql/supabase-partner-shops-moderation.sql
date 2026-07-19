-- Bkmp - PartnerShops Moderation (Selbst-Einreichung durch Shop-Betreiber)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Bisher konnten PartnerShops nur vom Admin direkt angelegt werden. Jetzt
-- koennen Shop-Betreiber ihren eigenen Shop einreichen (kostenlos), der
-- Admin muss ihn aber erst freigeben, bevor er oeffentlich sichtbar wird -
-- gleiches Prinzip wie bei der Kartendatenbank und den Kartenideen.
--
-- WICHTIG: Dieses Skript braucht die Funktion public.is_active_admin(),
-- die von supabase-security-hardening.sql angelegt wird.

alter table public.partner_shops add column if not exists status text not null default 'approved';
update public.partner_shops set status = 'approved' where status is null;
alter table public.partner_shops alter column status set default 'pending';

alter table public.partner_shops drop constraint if exists partner_shops_status_check;
alter table public.partner_shops add constraint partner_shops_status_check check (status in ('pending', 'approved', 'rejected'));

create index if not exists partner_shops_status_idx on public.partner_shops (status);

-- Lesen: Oeffentlich sieht nur freigegebene Shops. Admins sehen alles.
drop policy if exists "Allow anon read partner shops" on public.partner_shops;
drop policy if exists "Public read approved partner shops" on public.partner_shops;
create policy "Public read approved partner shops"
on public.partner_shops for select
to anon, authenticated
using (status = 'approved');

drop policy if exists "Admins read all partner shops" on public.partner_shops;
create policy "Admins read all partner shops"
on public.partner_shops for select
to authenticated
using (public.is_active_admin());

-- Einreichen: jetzt auch oeffentlich moeglich, aber Status muss "pending" sein -
-- niemand kann sich per direktem API-Aufruf selbst freigeben.
drop policy if exists "Public insert partner shops" on public.partner_shops;
create policy "Public insert partner shops"
on public.partner_shops for insert
to anon, authenticated
with check (status = 'pending');

grant insert on public.partner_shops to anon;

-- Admins duerfen weiterhin direkt (sofort freigegebene) Shops anlegen -
-- die App setzt dafuer status='approved' explizit im Admin-Panel.
drop policy if exists "Admins insert partner shops" on public.partner_shops;
create policy "Admins insert partner shops"
on public.partner_shops for insert
to authenticated
with check (public.is_active_admin());

-- Update/Delete-Policies aus supabase-security-hardening.sql bleiben
-- unveraendert und decken das Freigeben/Ablehnen (status -> approved/rejected) ab.
