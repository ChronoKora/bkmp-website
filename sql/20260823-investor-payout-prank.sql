/* ============================================================
   Bkmp - Investoren-Auszahlungs-Prank (23.08.2026, Nutzeridee): Ophils
   Investment laeuft Donnerstag aus, er bekommt dann seine echte Auszahlung.
   Nutzerwunsch: kurz vorher im Admin-Panel EINEN Button bei Ophils
   Investor-Karte auf der Website scharf schalten koennen ("Auszahlung
   beantragen") - Klick -> "Moechtest du die komplette Summe auszahlen
   lassen?" Ja/Nein -> bei "Ja" ein zweites Popup mit Rickroll (Video+Musik).

   Eine einzige, additive, admin-togglebare Spalte auf der bereits
   bestehenden investors-Tabelle (gleiches Muster wie paid_out/
   payout_proof_url vom 28.07.2026) - steuert nur, ob der Prank-Button auf
   der oeffentlichen Investoren-Karte dieses einen Investors erscheint.
   Wiederverwendbar fuer kuenftige Investoren, nicht hart an Ophil gebunden.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (add column if not exists).
   ============================================================ */

alter table public.investors add column if not exists payout_button_prank boolean not null default false;
