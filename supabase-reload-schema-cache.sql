-- Bkmp - PostgREST Schema-Cache manuell neu laden
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Nach den letzten Aenderungen (Spalten/Policies) kann es sein, dass
-- PostgREST auf manchen Verbindungen noch den alten Tabellen-Stand im
-- Cache hat - das erklaert, warum Einreichen mal klappt und mal nicht
-- (zufaellig, je nachdem welche Verbindung die Anfrage bekommt).
-- Dieser Befehl zwingt PostgREST, den Schema-Cache sofort neu zu laden.

notify pgrst, 'reload schema';
