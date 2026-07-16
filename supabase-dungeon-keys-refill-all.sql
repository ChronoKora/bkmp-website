/* ============================================================
   Einmaliger Admin-Refill: alle Dungeon-Schluessel (alle 7 Typen,
   siehe supabase-dungeon-system-v2.sql) fuer ALLE Spieler wieder auf
   das Maximum (5) setzen (Spieler-Wunsch 18.07.: "So gerne einmal das
   fuer alle Spieler die Dungeon schluessel nochmal voll gemacht
   werden!").

   Reine Datenkorrektur, KEINE Logik-/Schema-Aenderung - betrifft nur
   bereits existierende Zeilen (Spieler, die die Dungeon-Ansicht schon
   mindestens einmal geoeffnet hatten und dadurch per
   dungeon_get_all_status() eine Zeile pro Typ bekommen haben). Spieler
   ohne Zeile brauchen keinen Refill: das Spalten-Default (keys=5) sorgt
   ohnehin dafuer, dass ihre erste Zeile bei Erstanlage bereits voll ist.

   last_key_at wird mit auf now() gesetzt, damit der Regen-Timer sauber
   ab jetzt neu zaehlt (kosmetisch - bei keys=5 regeneriert
   dungeon_regen_calc() ohnehin nicht weiter, verhindert aber, dass die
   Anzeige "naechster Schluessel in ..." einen laengst vergangenen alten
   Zeitstempel zeigt).

   Einmalig auszufuehren, nicht Teil des normalen Migrations-Ablaufs -
   danach regenerieren die Schluessel wieder ganz normal wie gewohnt (5
   max, +1 alle 4h pro Typ). Erneutes Ausfuehren ist unschaedlich, setzt
   dann aber wieder alle auf voll.
   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   ============================================================ */

update public.dungeon_keys
set keys = 5, last_key_at = now();
