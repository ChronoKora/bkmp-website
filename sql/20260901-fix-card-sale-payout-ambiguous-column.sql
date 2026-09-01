/* ============================================================
   Bkmp - "Karten Verkaufen": Fix "column reference X is ambiguous"
   in request_card_sale_payout()/process_card_sale_payout()

   LIVE-VORFALL (01.09.2026): erster echter Auszahlungs-Antrag eines
   Spielers scheiterte sofort mit
     "Die Auszahlung konnte nicht angefragt werden:
      column reference "amount" is ambiguous"
   (Screenshot-Beweis: Verkaeufer-Dashboard zeigte korrekt 135.000 EUR
   verfuegbar, der Klick auf "Auszahlung anfordern" scheiterte serverseitig.)

   ROOT CAUSE (per Code-Lektuere zweifelsfrei bestaetigt, nicht geraten):
   Beide betroffenen Funktionen deklarieren "returns table (... amount ...)"
   bzw. "returns table (id uuid, status text, ...)" - PL/pgSQL legt dafuer
   INTERN automatisch gleichnamige Variablen an (amount/id/status). Jede
   NICHT mit einem Tabellen-Alias qualifizierte Spaltenreferenz in einer
   Abfrage derselben Funktion ist dadurch zwischen dieser Variable und der
   echten Tabellenspalte mehrdeutig - Postgres lehnt das mit genau der
   gemeldeten Fehlermeldung ab. Betroffen:
     - request_card_sale_payout(): "sum(amount) ... where status = ..."
       gegen card_sale_payout_requests (Funktionsausgabe hat selbst ein
       Feld "amount").
     - process_card_sale_payout(): drei "where id = p_request_id"-Stellen
       gegen card_sale_payout_requests (Funktionsausgabe hat selbst ein
       Feld "id") - noch nie erfolgreich getestet, da der erste Live-Klick
       bereits am ersten Bug (Auszahlung ANFORDERN) gescheitert ist, bevor
       ueberhaupt eine Anfrage zum admin-seitigen Bearbeiten (Auszahlung
       ALS AUSGEZAHLT MARKIEREN/ABLEHNEN) existieren konnte - waere aber
       beim ersten Admin-Klick auf genau dieselbe Weise gescheitert.

   Fix: alle betroffenen Tabellenzugriffe bekommen einen expliziten Alias
   (cspr) und referenzieren amount/status/id ueber diesen Alias - macht
   die Absicht in jeder Zeile eindeutig, unabhaengig von der Funktions-
   Ausgabe-Signatur. Sonst BYTE-FUER-BYTE identisch zur bereits live
   ausgefuehrten sql/20260901-card-sale-ownership-and-payouts.sql (keine
   Logik-/Sicherheits-/Berechnungsaenderung, siehe dortige RLS/GRANT/Lock-
   Kommentare - die gelten unveraendert weiter).

   CREATE OR REPLACE - kann gefahrlos direkt gegen die Live-DB ausgefuehrt
   werden, ersetzt nur die Funktionskoerper, keine Daten betroffen.
   ============================================================ */

-- ---------- Fix 1: request_card_sale_payout() ----------
create or replace function public.request_card_sale_payout()
returns table (payout_id uuid, amount numeric, new_pending_total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_seller public.card_sellers%rowtype;
  v_total_earned numeric;
  v_total_paid numeric;
  v_total_pending numeric;
  v_available numeric;
  v_name_key text;
  v_display_name text;
  v_payout_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.card_sellers (auth_user_id) values (v_uid)
  on conflict (auth_user_id) do nothing;
  select * into v_seller from public.card_sellers where auth_user_id = v_uid for update;

  -- Sperrt alle Karten dieses Verkaeufers (verhindert eine Race mit einer
  -- gleichzeitigen Admin-Korrektur ueber admin_add/remove_card_sale_event()).
  perform 1 from public.card_sales where auth_user_id = v_uid for update;
  select coalesce(sum(cse.amount), 0) into v_total_earned
    from public.card_sale_events cse
    join public.card_sales cs on cs.id = cse.card_sale_id
    where cs.auth_user_id = v_uid;

  -- Sperrt alle bestehenden Auszahlungs-Anfragen dieses Verkaeufers
  -- (verhindert zwei gleichzeitige Anfragen desselben Nutzers UND eine
  -- Race mit einer gleichzeitigen Admin-Entscheidung ueber
  -- process_card_sale_payout()).
  -- FIX (01.09.2026): "cspr"-Alias + qualifizierte amount/status-Referenzen
  -- - vorher mehrdeutig gegen die eigene "amount"-Ausgabespalte dieser
  -- Funktion (returns table (..., amount numeric, ...)), siehe Dateikopf.
  perform 1 from public.card_sale_payout_requests cspr where cspr.auth_user_id = v_uid for update;
  select
    coalesce(sum(cspr.amount) filter (where cspr.status = 'paid'), 0),
    coalesce(sum(cspr.amount) filter (where cspr.status = 'pending'), 0)
    into v_total_paid, v_total_pending
    from public.card_sale_payout_requests cspr where cspr.auth_user_id = v_uid;

  v_total_paid := v_seller.historical_starting_paid_out + v_total_paid;
  v_available := v_total_earned - v_total_paid - v_total_pending;

  if v_available <= 0 then
    raise exception 'nothing_available';
  end if;

  select name_key, display_name into v_name_key, v_display_name
    from public.player_stats where auth_user_id = v_uid limit 1;

  insert into public.card_sale_payout_requests (auth_user_id, name_key, display_name, amount, status)
  values (v_uid, v_name_key, v_display_name, v_available, 'pending')
  returning id into v_payout_id;

  return query select v_payout_id, v_available, v_total_pending + v_available;
end;
$$;

grant execute on function public.request_card_sale_payout() to authenticated;

-- ---------- Fix 2: process_card_sale_payout() ----------
create or replace function public.process_card_sale_payout(p_request_id uuid, p_action text, p_reason text default null)
returns table (id uuid, status text, processed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_uid uuid := auth.uid();
  v_row public.card_sale_payout_requests%rowtype;
begin
  if v_admin_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_active_admin() then
    raise exception 'not_admin';
  end if;
  if p_action not in ('paid', 'rejected') then
    raise exception 'invalid_action';
  end if;

  -- FIX (01.09.2026): "cspr"-Alias + qualifizierte id-Referenz - vorher
  -- mehrdeutig gegen die eigene "id"-Ausgabespalte dieser Funktion
  -- (returns table (id uuid, ...)), siehe Dateikopf. Betrifft alle drei
  -- Stellen unten (select/beide update-Zweige).
  select * into v_row from public.card_sale_payout_requests cspr where cspr.id = p_request_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'not_pending';
  end if;

  -- is_read wird hier bewusst mitgesetzt (kein eigener "Gelesen"-Knopf im
  -- Admin-Panel fuer diese Liste, anders als bei Investoren-/Kartenverkaufs-
  -- Anfragen) - sobald ein Admin eine Anfrage bearbeitet hat, ist sie per
  -- Definition nicht mehr "ungelesen". Die SET-Zielspalten (status/
  -- processed_at/processed_by/is_read) bleiben bewusst UNqualifiziert -
  -- Postgres verlangt fuer UPDATE...SET immer einen bloßen Spaltennamen,
  -- ein Alias-Praefix dort waere ein Syntaxfehler.
  if p_action = 'paid' then
    update public.card_sale_payout_requests cspr
    set status = 'paid', processed_at = now(), processed_by = v_admin_uid, is_read = true
    where cspr.id = p_request_id;
  else
    update public.card_sale_payout_requests cspr
    set status = 'rejected', reject_reason = p_reason, processed_at = now(), processed_by = v_admin_uid, is_read = true
    where cspr.id = p_request_id;
  end if;

  return query select cspr.id, cspr.status, cspr.processed_at
    from public.card_sale_payout_requests cspr where cspr.id = p_request_id;
end;
$$;

grant execute on function public.process_card_sale_payout(uuid, text, text) to authenticated;
