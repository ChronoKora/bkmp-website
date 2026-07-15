-- Bkmp - Kartenaufträge komplett entfernt (Spieler-/Betreiber-Vorgabe 15.07.):
-- "Kartenaufträge" wird zu "Kartenfirmen" - nur noch eine reine
-- Firmenpräsentation (öffentliche Bewerbung -> Admin-Freigabe -> Verzeichnis),
-- exakt nach dem Vorbild von PartnerShops. Kein Auftragssystem, kein Chat,
-- kein Kunden-Konto, kein Firmen-Login mehr.
--
-- BEHALTEN (unveraendert): public.companies, public.company_applications
-- (siehe supabase-company-applications.sql) - beide werden weiterhin
-- gebraucht und sind von dieser Datei nicht betroffen.
--
-- ENTFERNT: das komplette Auftrags-/Chat-/Kunden-Konto-System. Zum
-- Zeitpunkt dieser Datei existiert genau EIN echter Auftrag (Status
-- "offen", angelegt 14.07.) und keine Kunden-Konten - beides geht mit
-- dieser Datei unwiderruflich verloren. Falls dieser eine Auftrag noch
-- gebraucht wird, vorher per Supabase Dashboard > Table Editor sichern.
--
-- FIX (erster Lauf schlug fehl): "cannot drop function
-- is_order_participant(uuid) because other objects depend on it" - die
-- Reihenfolge war falsch. is_order_participant() wird nicht nur von den 2
-- Storage-Policies benutzt, sondern auch von RLS-Policies AUF order_files/
-- order_messages/order_events/order_read_state selbst - die durften nicht
-- vor den Tabellen geloescht werden. Jetzt zuerst die Tabellen (CASCADE
-- entfernt dabei automatisch deren eigene Policies und damit die
-- Abhaengigkeit), erst danach die Funktionen. Diese Datei ist komplett
-- idempotent (ueberall "if exists") - einfach nochmal in einem Rutsch
-- ausfuehren, unabhaengig davon, was beim ersten (fehlgeschlagenen) Versuch
-- schon durchgelaufen war.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.

-- 1) Storage-Policies fuer den 'order-files'-Bucket entfernen (haengen an
--    is_order_participant()). Der Bucket selbst bleibt bestehen (enthaelt
--    hoechstens ein paar Referenzbilder vom einen Testauftrag) - kann bei
--    Bedarf manuell im Dashboard unter Storage geloescht werden, ist aber
--    unschaedlich, wenn er einfach ungenutzt liegen bleibt.
drop policy if exists "Participants read order-files objects" on storage.objects;
drop policy if exists "Participants upload order-files objects" on storage.objects;

-- 2) Tabellen entfernen (CASCADE raeumt automatisch die daran haengenden
--    Policies mit auf - DAS ist der Schritt, der die uebrigen
--    Abhaengigkeiten von is_order_participant()/is_company_staff_of()
--    aufloest, deshalb VOR dem Funktions-Drop).
drop table if exists public.order_read_state cascade;
drop table if exists public.order_events cascade;
drop table if exists public.order_messages cascade;
drop table if exists public.order_files cascade;
drop table if exists public.map_orders cascade;
drop sequence if exists public.map_order_number_seq;
drop table if exists public.customer_profiles cascade;

-- 3) Funktionen entfernen (jetzt unbenutzt, da die referenzierenden
--    Tabellen/Policies bereits weg sind)
drop function if exists public.admin_reassign_order(uuid, uuid);
drop function if exists public.is_order_participant(uuid);
drop function if exists public.is_company_staff_of(uuid);

-- 4) admin_profiles: die zwei nur fuers Firmen-Login gebrauchten Spalten
--    wieder entfernen. Falls noch ein aktiver Zugang mit role='company'
--    existiert (Firmen-Mitarbeiter-Login) - unwahrscheinlich, das Feature
--    lief erst eine Woche, aber sicherheitshalber pruefen: Supabase
--    Dashboard > Table Editor > admin_profiles nach role='company' filtern
--    und den Zugang manuell ueber die "Zugaenge"-Seite im Admin-Panel
--    deaktivieren. Ein solcher Zugang koennte sich nach diesem Update zwar
--    weiterhin einloggen und saehe faelschlich das volle Admin-Menue
--    (isCompany-Weiche wurde clientseitig entfernt), waere aber durch
--    is_active_admin() (schliesst role='company' bereits aus) bei jeder
--    echten Aktion weiterhin serverseitig blockiert - kein Sicherheitsloch,
--    nur unschoen.
alter table public.admin_profiles drop column if exists company_id;
alter table public.admin_profiles drop column if exists can_edit_profile;

notify pgrst, 'reload schema';
