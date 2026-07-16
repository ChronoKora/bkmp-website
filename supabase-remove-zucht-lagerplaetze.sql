/* ============================================================
   "Drachenzwinger" (zucht_lagerplaetze) entfernt (Spieler-Frage
   Kaledoss 18.07.: "Wie äußert sich das beim Prestige?"): der Zucht-
   Skilltree-Zweig liegt technisch im selben skill_allocations-Topf wie
   der normale Kampf-Skilltree und wird deshalb beim Prestige-Aufstieg
   mit zurückgesetzt (siehe bkmpIdlePerformPrestige, "skill_allocations =
   {}") - anders als die Drachenzucht-GEBÄUDE (Obstgarten-/Jagdhütten-
   Stufen), die bewusst NICHT zurückgesetzt werden. Ein Reset hätte hier
   dazu geführt, dass ein Spieler mit vollem Drachenzwinger (+15
   Lagerplätze) nach dem Aufsteigen ploetzlich MEHR Drachen im Lager hat,
   als seine (dann kleinere) Kapazität erlaubt - kein Datenverlust (die
   Drachen bleiben einfach erhalten, siehe bkmpDragonHatch-Kommentar),
   aber verwirrend/inkonsistent. Statt die Kapazitaets-Ueberschreitung
   nachtraeglich abzufangen, wird der Knoten hier komplett entfernt.

   1) Knoten deaktivieren (soft-delete wie bei dragon_species/idle_dragons -
      loadIdleSkillNodes() filtert schon auf active=true, kein Client-
      Code-Aenderung noetig).
   2) Bereits investierte Punkte fair zurueckerstatten, statt sie
      kommentarlos verschwinden zu lassen - betrifft nur Spieler, die
      diesen einen Knoten schon alloziert hatten.

   Idempotent: nach dem ersten Lauf matcht die WHERE-Bedingung in Schritt 2
   keine Zeile mehr, ein erneutes Ausfuehren ist unschaedlich.
   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   ============================================================ */

update public.idle_skill_nodes
set active = false
where id = 'zucht_lagerplaetze';

update public.idle_player_state
set
  skill_points_available = skill_points_available + (coalesce((skill_allocations->>'zucht_lagerplaetze')::int, 0) * 15),
  skill_points_spent = greatest(0, skill_points_spent - (coalesce((skill_allocations->>'zucht_lagerplaetze')::int, 0) * 15)),
  skill_allocations = skill_allocations - 'zucht_lagerplaetze'
where skill_allocations ? 'zucht_lagerplaetze';

notify pgrst, 'reload schema';
