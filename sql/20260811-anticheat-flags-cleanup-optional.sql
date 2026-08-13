-- Bkmp - OPTIONAL: bestehenden Anti-Cheat-Alarm-Rueckstau abhaken.
--
-- Reine Aufraeum-Massnahme, KEINE Sicherheits-/Sichtbarkeits-Aenderung: nach
-- sql/20260811-leaderboard-hide-decouple-from-flags.sql wirkt sich ein
-- undismissed Alarm nicht mehr auf die oeffentliche Bestenliste aus - dieser
-- Schritt raeumt nur das Admin-Panel ("🚨 Anti-Cheat-Alarme") auf, das sonst
-- weiterhin ca. 33 alte Alarme zeigt, die laut der Live-Analyse vom
-- 11.08.2026 praktisch ausnahmslos Falsch-Alarme des zu strengen alten
-- 50x-Kampfwerte-Triggers waren (siehe sql/20260811-anticheat-guard-absolute-
-- ceiling.sql fuer die volle Begruendung).
--
-- BEWUSST NICHT AUTOMATISCH AUSGEFUEHRT (keine Session-Ausfuehrung von SQL) -
-- du entscheidest, ob du den Rueckstau als "vermutlich alle Falsch-Alarme"
-- pauschal abhaken willst, oder lieber jeden Alarm einzeln im Admin-Panel
-- durchgehst (Knopf "Verwerfen" pro Karte - macht inhaltlich dasselbe, nur
-- einzeln statt in einem Rutsch). Nichts wird geloescht - jede Zeile bleibt
-- als historischer Log-Eintrag bestehen, nur "dismissed" wird gesetzt.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren
-- (nur falls gewuenscht). idempotent: ein zweiter Lauf aendert nichts mehr,
-- da bereits abgehakte Zeilen die WHERE-Bedingung nicht mehr treffen.

update public.idle_anticheat_flags
set dismissed = true,
    dismissed_by = 'system-cleanup-2026-08-11-absolute-ceiling-fix',
    dismissed_at = now()
where dismissed = false;
