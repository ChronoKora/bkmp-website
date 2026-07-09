-- Bkmp - Wiederverwendbare Plüshie-Codes (fuer Easter Eggs)
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Bisher war JEDER Code nur 1x insgesamt einloesbar (is_redeemed), egal von
-- wem - passend fuer klassische Admin-Geschenkcodes ("wer zuerst kommt..."),
-- aber falsch fuer den Kora-Easter-Egg-Code: der steckt direkt sichtbar im
-- Beispiel-Platzhalter des Code-Feldes, jeder kann ihn finden - nach der
-- ersten Einloesung durch irgendwen zeigte er allen anderen faelschlich
-- "Dieser Code wurde bereits eingeloest." an.
--
-- Neue Spalte is_reusable: bei true ueberspringt api/redeem-plushie-code.js
-- die is_redeemed-Sperre komplett - jeder Account kann den Code einloesen
-- (die bestehende "already_owned"-Pruefung sorgt weiterhin dafuer, dass ein
-- einzelner Account den Pluschie nicht mehrfach bekommt). Normale
-- Admin-Codes bleiben unveraendert einmalig (Standardwert false).

alter table public.plushie_codes
  add column if not exists is_reusable boolean not null default false;

update public.plushie_codes
set is_reusable = true, is_redeemed = false, redeemed_by_name_key = null, redeemed_by_display_name = null, redeemed_at = null
where code = 'KORA-7F3X-9QLM';
