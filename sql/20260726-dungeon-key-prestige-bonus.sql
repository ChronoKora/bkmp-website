-- Progression-Rebalance Phase 5 (26.07.2026): Prestige-Knoten "Schluesselmeister"
-- (schnellere Schluessel-Regeneration) / "Schluesselbund" (hoeheres Schluessel-
-- Limit), Zweig "Runen & Dungeons". NICHT AUSGEFUEHRT - siehe Hinweis unten.
--
-- Hintergrund: die Schluessel-Regeneration laeuft vollstaendig serverseitig
-- (dungeon_regen_calc(), sql/supabase-dungeon-system-v2.sql) - fest 4h pro
-- Schluessel, hartes Maximum 5. Um die beiden oben genannten Prestige-Knoten
-- wirken zu lassen, braucht die Funktion zwei zusaetzliche, RUECKWAERTS-
-- KOMPATIBLE Parameter mit denselben Default-Werten wie bisher (14400s/5) -
-- kein bestehender Aufrufer muss geaendert werden, um weiterhin exakt das
-- alte Verhalten zu bekommen.
--
-- WICHTIG (bewusst NICHT in dieser Datei geloest): die eigentliche
-- Umrechnung "Rang X bei schluesselmeister/schluesselbund -> wie viele
-- Prozent schneller/wie viele Schluessel mehr" lebt aktuell NUR im Client
-- (js/systems/bkmp-prestige.js, BKMP_PRESTIGE_UPGRADES). Diese Werte hier
-- versehentlich per Hand zu duplizieren waere ein Konsistenzrisiko (aendert
-- sich der Client-Wert kuenftig, ohne diese SQL-Datei mitzuziehen, laufen
-- Anzeige und echte Wirkung auseinander). Der naechste Schritt (separat zu
-- beauftragen) waere eine kleine RPC (z.B. get_player_dungeon_key_bonus_pct)
-- ODER das Mitschicken der bereits client-seitig berechneten Werte als
-- Parameter bei jedem echten Aufruf - beides erfordert, die tatsaechlichen
-- Aufrufer-Funktionen (dungeon_get_all_status u.ae.) zu kennen/anzupassen,
-- was diese bereits sehr umfangreiche Phase nicht mehr serioes mit htte
-- abdecken koennen. Bis dahin sind beide Knoten im Client bereits kaufbar
-- und sichtbar (ehrlich als "SQL-Migration erforderlich" markiert), zeigen
-- aber noch keine reale Wirkung.

begin;

create or replace function public.dungeon_regen_calc(
  p_keys smallint,
  p_last_key_at timestamptz,
  p_interval_seconds int default 14400,
  p_max_keys smallint default 5,
  out new_keys smallint,
  out new_last_key_at timestamptz
)
language plpgsql
as $$
declare
  v_intervals int;
begin
  v_intervals := floor(extract(epoch from (now() - p_last_key_at)) / greatest(1, p_interval_seconds))::int;
  if v_intervals <= 0 then
    new_keys := p_keys;
    new_last_key_at := p_last_key_at;
    return;
  end if;
  if p_keys + v_intervals >= p_max_keys then
    new_keys := p_max_keys;
    new_last_key_at := now();
  else
    new_keys := (p_keys + v_intervals)::smallint;
    new_last_key_at := p_last_key_at + make_interval(secs => v_intervals * p_interval_seconds);
  end if;
end;
$$;
grant execute on function public.dungeon_regen_calc(smallint, timestamptz, int, smallint) to authenticated;

commit;

-- POSTCHECK (manuell, nach dem Ausfuehren):
-- select public.dungeon_regen_calc(0::smallint, now() - interval '5 hours');
--   -> erwartet: new_keys=1, new_last_key_at ~ vor 1 Stunde (identisch zum alten Verhalten, da Default-Parameter genutzt werden)
-- select public.dungeon_regen_calc(0::smallint, now() - interval '5 hours', 7200, 8);
--   -> erwartet: new_keys=2 (2h-Intervall statt 4h), Maximum jetzt 8 statt 5
