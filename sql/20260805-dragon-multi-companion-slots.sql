/* ============================================================
   Bkmp - Mehrere gleichzeitige Begleitdrachen (05.08.2026, Spieler-Idee
   MCSoGGe ueber das oeffentliche Feedback-Board: "wenn man ein gewisses
   Level an Prestiges hat dass man dann 2 oder mehr Drachen ausruesten
   kann", vom Nutzer konkretisiert: 2./3. Begleiter mit abnehmendem Wert
   (50%/25%), freigeschaltet ueber einen neuen 2-stufigen Prestige-Knoten
   im "Vermaechtnis"-Zweig (Rang 1: 1.500 Punkte -> 2. Platz, Rang 2:
   3.000 Punkte -> 3. Platz), siehe js/systems/bkmp-prestige.js
   (weitere_gefaehrten) + js/systems/bkmp-breeding.js.

   HARTE VORAUSSETZUNG: bisher erzwang eine partielle Unique-Index
   (siehe sql/supabase-dragon-breeding.sql, player_dragons_one_companion_idx)
   auf Datenbank-Ebene, dass PRO SPIELER maximal EIN player_dragons-Datensatz
   gleichzeitig is_companion=true haben darf - ein zweiter Ausruesten-Versuch
   wuerde bis zu dieser Migration serverseitig mit einer Constraint-
   Verletzung abgelehnt, auch wenn der neue Client-Code laengst mehrere
   Begleiter gleichzeitig anzeigen/erlauben will. OHNE dieses SQL bleibt das
   Feature dadurch faktisch wirkungslos (weiterhin nur 1 Begleiter moeglich,
   ein zweiter Ausruesten-Klick schlaegt mit einem Server-Fehler fehl).

   Kein Ersatz-Constraint fuer "maximal N gleichzeitig" noetig - dieselbe
   Vertrauens-Ebene wie ueberall sonst im Idle-Dorf (Gebaeude-Stufen/
   ausgeruestete Runen/Titel/etc. sind ebenfalls rein clientseitig gegen
   Manipulation abgesichert, kein serverseitiger Zaehl-Trigger). Der Client
   (bkmpDragonMaxCompanionSlots(), bkmpDragonSetCompanion()) blockt bereits
   vor dem Server-Aufruf, sobald das aktuelle Prestige-Limit erreicht ist.

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent (DROP INDEX IF EXISTS).
   ============================================================ */

drop index if exists public.player_dragons_one_companion_idx;
