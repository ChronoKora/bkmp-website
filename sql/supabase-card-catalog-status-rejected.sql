-- Bkmp - Kartendatenbank: Status "rejected" ergaenzen
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Baut auf supabase-card-catalog-moderation.sql auf (muss vorher gelaufen sein).
-- Erlaubt Admins, eingereichte Karten explizit abzulehnen (statt sie nur zu
-- loeschen), damit im Admin-Panel eine eigene "Abgelehnt"-Tabelle moeglich ist.

alter table public.card_catalog drop constraint if exists card_catalog_status_check;
alter table public.card_catalog add constraint card_catalog_status_check check (status in ('pending', 'approved', 'rejected'));

-- Lese-/Update-/Delete-Policies aus supabase-card-catalog-moderation.sql bleiben
-- unveraendert: Oeffentlich sieht weiterhin nur "approved", Admins sehen und
-- bearbeiten alles (inklusive "rejected").
