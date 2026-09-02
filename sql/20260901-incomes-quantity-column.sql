/* ============================================================
   Bkmp - Einnahmen: echte Stueckzahl statt reiner Betrag-Schaetzung

   Nutzerwunsch (01.09.2026): Buch-Grossbestellungen laufen aktuell oft mit
   Mengenrabatt (z.B. 2000 Buecher fuer 4 Mio. statt reguleaer 5 Mio.) - die
   bisherige Anzeige-Logik hat die Stueckzahl IMMER aus amount/2500
   RUECKGERECHNET (die incomes-Tabelle kannte bislang gar keine echte
   Stueckzahl, siehe Kommentar in app.js/admin.html) - bei einem Rabatt
   ergibt das automatisch eine falsche Buecheranzahl (4 Mio. / 2500 = nur
   1600 statt tatsaechlich 2000 verkauften Buechern).

   Additiv, nichts Bestehendes wird zurueckgesetzt: reine neue, nullable
   Spalte. Bestehende Zeilen bleiben unveraendert (quantity = null -> die
   Anzeige faellt fuer sie weiterhin auf die alte amount/Stueckpreis-
   Schaetzung zurueck, siehe bkmpCalculateBookStats() in app.js). Keine
   RLS-Aenderung noetig (Policies auf public.incomes sind rein zeilen-,
   nicht spaltenbasiert - "using (true)"/"with check (true)", siehe
   sql/supabase-schema.sql).
   ============================================================ */

alter table public.incomes add column if not exists quantity numeric;
