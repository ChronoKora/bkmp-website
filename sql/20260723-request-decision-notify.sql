-- Bkmp - 1x-Popup-Benachrichtigung bei Anfrage-Entscheidung
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Ergaenzt:
-- 1) investor_requests.reject_reason - Admin-geschriebene Begruendung,
--    die dem Absender beim Ablehnen im Popup angezeigt wird.
-- 2) Zwei enge RPC-Funktionen (SECURITY DEFINER), die es einem anonymen
--    Absender erlauben, den Status EINER bestimmten, ihm lokal bekannten
--    Anfrage-ID abzufragen - ohne investor_requests/card_sale_requests
--    selbst per RLS oeffentlich lesbar zu machen (sonst koennte jeder
--    Besucher alle Anfragen aller Spieler auflisten). Gleiches
--    Sicherheitsprinzip wie beim Feedback-Board: so wenig wie moeglich
--    oeffentlich exponieren, strukturell statt nur per Policy-Disziplin -
--    die Funktionen geben ausschliesslich Status (+ Ablehnungsgrund) fuer
--    GENAU EINE per ID angefragte Zeile zurueck, kein Listing, keine
--    anderen Spalten (kein Name/Discord/Bild/Betrag).
--
-- Sicher mehrfach ausfuehrbar.

alter table public.investor_requests add column if not exists reject_reason text;

create or replace function public.get_card_sale_request_status(p_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select status from public.card_sale_requests where id = p_id;
$$;

grant execute on function public.get_card_sale_request_status(uuid) to anon, authenticated;

create or replace function public.get_investor_request_status(p_id uuid)
returns table (status text, reject_reason text)
language sql
security definer
set search_path = public
stable
as $$
  select status, reject_reason from public.investor_requests where id = p_id;
$$;

grant execute on function public.get_investor_request_status(uuid) to anon, authenticated;
