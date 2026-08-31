/* ============================================================
   Bkmp - "Karten Verkaufen": Backfill fuer bestehende Verkaeufer/Verkaeufe
   (siehe Plan in C:\Users\David\.claude\plans\wild-juggling-garden.md)

   Voraussetzung: sql/20260901-card-sale-ownership-and-payouts.sql muss
   VORHER ausgefuehrt worden sein (legt card_sales.auth_user_id,
   card_sale_events, card_sellers an).

   WICHTIG: laeuft NUR bei eindeutigem Namensabgleich automatisch - bei
   keinem oder mehreren Treffern bleibt auth_user_id bewusst leer (siehe
   Auftrag: "NIEMALS bei unsicheren Matches automatisch zuordnen"). Diese
   Faelle muessen anschliessend im Admin-Panel ("Besitzer zuordnen")
   manuell geprueft werden.

   Historische Auszahlungen: nach ausdruecklicher Nutzer-Bestaetigung
   wurde vom bisherigen Kartenverkaufs-Verdienst noch NICHTS ausgezahlt -
   historical_starting_paid_out startet deshalb bei 0 fuer jeden
   automatisch zugeordneten Verkaeufer (der komplette bisherige Verdienst
   ist damit sofort als verfuegbar sichtbar, sobald der Besitzer erkannt
   ist).

   Die synthetischen card_sale_events (ein Schritt weiter unten) tragen
   bewusst KEIN echtes Verkaufsdatum (das gibt es fuer die Vor-Migrations-
   Zeit nicht) - sie werden auf den created_at-Zeitstempel der jeweiligen
   card_sales-Zeile datiert. Der 30-Tage-Chart/"diese Woche"-KPI werden
   dadurch erst ab dem tatsaechlichen Migrationszeitpunkt wirklich
   aussagekraeftig - eine bewusst dokumentierte Einschraenkung, keine
   fehlerhafte Berechnung.

   NICHT automatisch ausgefuehrt. Idempotent (kann gefahrlos mehrfach
   laufen - bereits zugeordnete Karten/bereits vorhandene Events werden
   nicht doppelt angelegt).
   ============================================================ */

-- ---------- 1. Eindeutigen Namensabgleich anwenden ----------
with candidates as (
  select
    cs.id as card_sale_id,
    cs.player_name,
    (
      select array_agg(distinct ps.auth_user_id)
      from public.player_stats ps
      where ps.auth_user_id is not null
        and lower(trim(ps.name_key)) = lower(trim(cs.player_name))
    ) as matched_ids
  from public.card_sales cs
  where cs.auth_user_id is null
)
update public.card_sales cs
set auth_user_id = c.matched_ids[1]
from candidates c
where cs.id = c.card_sale_id
  and c.matched_ids is not null
  and array_length(c.matched_ids, 1) = 1;

-- ---------- 2. card_sellers fuer jeden neu zugeordneten Besitzer anlegen ----------
-- historical_starting_paid_out = 0 fuer ALLE (Nutzer-Bestaetigung: bislang
-- wurde nichts ausgezahlt). Idempotent per ON CONFLICT DO NOTHING - ein
-- bereits vorhandener (z.B. vom Admin manuell mit einem anderen Wert
-- gepflegter) Datensatz wird nie ueberschrieben.
insert into public.card_sellers (auth_user_id, historical_starting_paid_out, historical_note)
select distinct cs.auth_user_id, 0,
  'Migration 2026-09-01: keine Auszahlung vor Systemeinfuehrung erfolgt'
from public.card_sales cs
where cs.auth_user_id is not null
on conflict (auth_user_id) do nothing;

-- ---------- 3. Bestehende Verkaufszahlen als echtes Event-Log nachtragen ----------
-- Nur fuer Karten, die noch KEIN einziges Event haben (idempotent - bei
-- einem zweiten Lauf nach bereits erfolgter Migration passiert hier
-- nichts mehr). sold_count selbst wird NICHT angetastet/zurueckgesetzt -
-- der Trigger aus der Haupt-Migration gleicht ihn nach diesem Insert
-- automatisch wieder auf genau den (unveraenderten) Wert ab.
insert into public.card_sale_events (card_sale_id, amount, sold_at, created_by)
select cs.id, 135000, cs.created_at, null
from public.card_sales cs
cross join lateral generate_series(1, cs.sold_count) as g(n)
where cs.sold_count > 0
  and not exists (select 1 from public.card_sale_events cse where cse.card_sale_id = cs.id);

-- ---------- 4. Bericht: was wurde automatisch zugeordnet, was braucht manuelle Pruefung ----------
select
  cs.id,
  cs.player_name,
  cs.sold_count,
  cs.auth_user_id,
  case when cs.auth_user_id is not null then 'automatisch zugeordnet' else 'BRAUCHT MANUELLE ZUORDNUNG' end as status
from public.card_sales cs
order by (cs.auth_user_id is null) desc, cs.player_name;
