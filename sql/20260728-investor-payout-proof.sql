/* ============================================================
   Investor-Auszahlung dokumentieren (28.07.2026, Nutzerwunsch): "brauche
   irgendwas wie ich sage mal das auf der Website absichere? Will dann ein
   Bild einfuegen koennen was als kleines viereckt rechts nebendem namen
   auftauchen tut was man vergroessern kann wo man die auszahlung sieht.
   Und vllt irgendwas im Admin Panel mit Investor erledigt.. ausgezahlt?"

   Zwei neue, unabhaengige Spalten auf der bereits bestehenden investors-
   Tabelle (kein neues Konzept, nur zwei zusaetzliche Felder):
   - paid_out: reiner Status-Haken fuers Admin-Panel ("erledigt"), auch
     ohne Bild nutzbar.
   - payout_proof_url: oeffentlich sichtbares Auszahlungs-Beweisfoto
     (Supabase Storage, gleicher "update-images"-Bucket wie News/Wuensche/
     PartnerShops - kein neuer Bucket noetig, siehe bkmpStoreImageIfNeeded
     in supabase.js).

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (add column if not exists).
   ============================================================ */

alter table public.investors add column if not exists paid_out boolean not null default false;
alter table public.investors add column if not exists payout_proof_url text;
