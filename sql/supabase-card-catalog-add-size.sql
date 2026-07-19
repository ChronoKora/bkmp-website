-- Bkmp - Kartendatenbank: neue Spalte "Groesse" (z. B. "15er"/"12er"/"9er")
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Freitext wie bei den anderen Feldern (category/shop_name/cb), keine feste
-- Auswahlliste - "15er/12er/9er" sind nur Beispielwerte im Formular.

alter table public.card_catalog add column if not exists size text;
