-- Sicherheitsfix: admin_profiles (Admin-Anzeigenamen + Login-Kennung) durfte
-- bisher von JEDEM eingeloggten Account gelesen werden ("to authenticated
-- using (true)"), nicht nur von aktiven Admins - und da sich jeder Besucher
-- kostenlos einen normalen Spieler-/Kunden-Account anlegen kann, war das
-- faktisch oeffentlich einsehbar. Ersetzt die Policy durch zwei praezise:
-- 1) man darf die EIGENE Zeile lesen (fuer den Selbstcheck direkt nach dem
--    Login), 2) aktive Admins duerfen ALLE Zeilen lesen (fuer die
--    "Zugaenge"-Verwaltungsseite).
--
-- WICHTIG: bkmpLoginAdmin() (supabase.js) hat bisher ALLE admin_profiles
-- ungefiltert gelesen, um zu pruefen "Tabelle leer? -> ich bin der allererste
-- Admin, automatisch aktivieren". Unter der neuen, engeren Policy wuerde das
-- fuer JEDEN neuen Nutzer leer aussehen (er sieht ja nur seine eigene, noch
-- nicht existierende Zeile) - er koennte sich also faelschlich selbst als
-- aktiven Admin freischalten, selbst wenn laengst andere Admins existieren.
-- Deshalb hier zusaetzlich eine SECURITY DEFINER-Funktion, die (RLS-
-- unabhaengig) die echte Gesamtzahl liefert, nur fuer diese eine
-- Bootstrap-Entscheidung - supabase.js wird passend angepasst.

drop policy if exists "Allow authenticated read admin profiles" on public.admin_profiles;

create policy "Read own admin profile" on public.admin_profiles
for select to authenticated
using (auth_user_id = auth.uid());

create policy "Admins read all admin profiles" on public.admin_profiles
for select to authenticated
using (public.is_active_admin());

create or replace function public.admin_profiles_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from public.admin_profiles;
$$;
grant execute on function public.admin_profiles_count() to anon, authenticated;
