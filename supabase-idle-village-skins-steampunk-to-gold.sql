-- Bkmp - "Steampunk Dorf" wird vom Echtgeld-Artikel (1,99 EUR via Stripe)
-- auf einen normalen Gold-Kauf umgestellt (100.000.000 Gold), Spieler-
-- Wunsch 17.07. Die Stripe-Infrastruktur (real_money_purchases,
-- api/create-checkout-session.js) bleibt fuer eventuelle kuenftige
-- Echtgeld-Artikel unangetastet - hier wird nur DIESER eine Skin auf den
-- unlock_type 'purchase' (Gold) umgeschaltet, exakt wie bei Midas Stadt/
-- Kartendorf/etc.
--
-- price_eur_cents bleibt in der Zeile stehen (schadet nicht, wird bei
-- unlock_type='purchase' vom Client ohnehin nicht mehr angezeigt) - so
-- liesse sich der Artikel bei Bedarf jederzeit wieder zurueckdrehen.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Idempotent.

update public.idle_village_skins
set unlock_type = 'purchase', price_gold = 100000000, price_crystals = 0
where id = 'steampunkdorf';
