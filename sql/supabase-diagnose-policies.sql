-- Bkmp - DIAGNOSE: zeigt alle aktuell aktiven Policies fuer card_catalog,
-- wishes und partner_shops. Bitte im Supabase SQL Editor ausfuehren und mir
-- das Ergebnis (die Tabelle, die unten erscheint) schicken - Screenshot
-- reicht auch.

select
  tablename,
  policyname,
  cmd as befehl,
  permissive,
  roles,
  qual as using_bedingung,
  with_check as check_bedingung
from pg_policies
where tablename in ('card_catalog', 'wishes', 'partner_shops')
order by tablename, cmd, policyname;
