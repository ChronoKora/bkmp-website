-- Bkmp - FIX: Anonyme Einreichungen wurden mit "new row violates row-level
-- security policy" (Fehlercode 42501) abgelehnt.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Diagnose: Lesen funktioniert fuer anonyme Besucher einwandfrei, aber
-- Einreichen (Insert) wird bei card_catalog, wishes UND partner_shops
-- gleichermassen abgelehnt - und zwar unabhaengig vom gesendeten Status.
-- Das deutet darauf hin, dass der neue Supabase "Publishable Key"
-- (sb_publishable_...) nicht sauber auf die Postgres-Rolle "anon" gemappt
-- wird. Dieser Fix zielt deshalb auf "public" (= wirklich jede Rolle) statt
-- explizit auf "anon", was unabhaengig von der genauen Rollenzuordnung
-- funktioniert. Das ist keine Sicherheitsverschlechterung - "anon" sollte
-- ohnehin uneingeschraenkt einreichen duerfen, "public" deckt das nur
-- zuverlaessiger ab.

-- Kartendatenbank
grant insert on public.card_catalog to public;
drop policy if exists "Public insert card catalog" on public.card_catalog;
create policy "Public insert card catalog"
on public.card_catalog for insert
to public
with check (status = 'pending');

-- Kartenideen
grant insert on public.wishes to public;
drop policy if exists "Public insert wishes" on public.wishes;
create policy "Public insert wishes"
on public.wishes for insert
to public
with check (status = 'pending');

-- PartnerShops
grant insert on public.partner_shops to public;
drop policy if exists "Public insert partner shops" on public.partner_shops;
create policy "Public insert partner shops"
on public.partner_shops for insert
to public
with check (status = 'pending');
