-- Feste Schluessel-Zeiten (Spieler-Vorgabe 16.07.: "Alles auf 0 Uhr
-- skaliert - 1 Schluessel dann um 0 Uhr 4 Uhr 8 Uhr 12 Uhr 16 Uhr 20 Uhr
-- 0 Uhr"): dungeon_regen_calc() gab bisher +1 Schluessel alle 4h GEROLLT
-- ab dem individuellen last_key_at jedes Spielers (wer um 03:17 Uhr zum
-- ersten Mal einen Schluessel verbraucht hat, bekam seinen naechsten immer
-- um :17 nach jeder vierten Stunde). Jetzt stattdessen an feste,
-- fuer ALLE Spieler gleiche Uhrzeiten gebunden (00/04/08/12/16/20 Uhr
-- Europe/Berlin) - "wie viele feste 4h-Slots liegen zwischen dem letzten
-- und dem aktuellen Slot" statt "wie viele volle 4h seit dem letzten
-- Zeitstempel". Ersetzt NUR diese eine Funktion (create or replace,
-- gleiche Signatur) - dungeon_get_all_status()/dungeon_consume_key()
-- rufen sie unveraendert auf und muessen nicht angefasst werden, die
-- "Sekunden bis zum naechsten Schluessel"-Anzeige in dungeon_get_all_status
-- bleibt korrekt, weil new_last_key_at jetzt IMMER exakt auf einem festen
-- Slot liegt (Naechster Slot = new_last_key_at + 4h ist dadurch automatisch
-- auch wieder ein fester Slot).
create or replace function public.dungeon_regen_calc(p_keys smallint, p_last_key_at timestamptz, out new_keys smallint, out new_last_key_at timestamptz)
language plpgsql
as $$
declare
  v_now_local timestamp := now() at time zone 'Europe/Berlin';
  v_last_local timestamp := p_last_key_at at time zone 'Europe/Berlin';
  v_now_slot_ts timestamp := v_now_local::date + make_interval(hours => (extract(hour from v_now_local)::int / 4) * 4);
  v_last_slot_ts timestamp := v_last_local::date + make_interval(hours => (extract(hour from v_last_local)::int / 4) * 4);
  v_intervals int;
begin
  v_intervals := round(extract(epoch from (v_now_slot_ts - v_last_slot_ts)) / 14400)::int;
  if v_intervals <= 0 then
    new_keys := p_keys;
    new_last_key_at := p_last_key_at;
    return;
  end if;
  if p_keys + v_intervals >= 5 then
    new_keys := 5;
  else
    new_keys := (p_keys + v_intervals)::smallint;
  end if;
  /* Anker wird IMMER auf den aktuellen festen Slot gesetzt (nicht nur bei
     Erreichen des Maximums wie in der alten Rolling-Version) - bei festen
     Uhrzeiten gibt es kein "Rest-Fortschritt bewahren" mehr, der naechste
     Slot ist ohnehin durch die Uhrzeit vorgegeben, nicht durch einen
     akkumulierten Versatz. */
  new_last_key_at := v_now_slot_ts at time zone 'Europe/Berlin';
end;
$$;
