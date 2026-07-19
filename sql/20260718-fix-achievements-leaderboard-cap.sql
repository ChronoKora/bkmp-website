/* ============================================================
   BUG-FIX (18.07.): oeffentliche Bestenliste zeigte mehrere Spieler
   (bestaetigt: ByAlex0, RandomAuto) faelschlich mit exakt "250 Erfolge"
   an, obwohl beide nachweislich (im eigenen, live berechneten Profil)
   bereits mehr freigeschaltet hatten.

   ROOT CAUSE: sql/supabase-player-stats-schema.sql legte am 14.07. einen
   harten CHECK-Constraint an:
     check (achievements_unlocked >= 0 and achievements_unlocked <= 250)
   Das Spiel selbst hat KEINE feste Erfolge-Anzahl - BKMP_ACHIEVEMENTS
   wird dynamisch aus vielen einzelnen Tier-Listen zusammengesetzt
   (Karten/Wuensche/Zeit/Bonk/Idle-Dorf/Runen/Raid/Arena/Gilde/...) und
   waechst mit jedem neuen Inhalt automatisch. Zum Zeitpunkt dieses Fixes
   ergibt BKMP_ACHIEVEMENTS.length bereits 435 (per Live-Browser-Check
   verifiziert) - der Constraint war seit Langem nicht mehr aktuell.

   Sobald ein Spieler mehr als 250 Erfolge freischaltete, LEHNTE POSTGRES
   SELBST jeden weiteren Schreibversuch ab (Constraint-Verletzung bei
   jedem UPDATE via upsertPlayerStats() in supabase.js) - der Fehler wird
   dort bereits abgefangen und nur als console.warn geloggt (kein Crash,
   aber fuer den Spieler unsichtbar), das Feld blieb dauerhaft auf dem
   letzten noch erlaubten Wert (<= 250) haengen. Live per REST-API
   bestaetigt: beide betroffenen Spieler stehen exakt bei 250.

   Das Profil/Idle-Dorf-Widget selbst hat NIE diesen Deckel - es
   berechnet unlockedCount() live aus dem aktuellen BKMP_ACHIEVEMENTS-
   Array (siehe renderAchievementBadge() in js/core/bkmp-site.js), zeigt
   also schon immer den echten Wert. Nur die OEFFENTLICHE Bestenliste
   liest den (durch diesen Constraint fehlerhaft eingefrorenen)
   gespeicherten Wert aus player_stats.

   FIX: Obergrenze vollstaendig entfernen statt durch eine neue feste
   Zahl zu ersetzen (ausdruecklicher Nutzer-Wunsch - jede fixe Zahl waere
   in ein paar Monaten, sobald weitere Erfolge hinzukommen, exakt
   derselbe Bug erneut). Die urspruengliche Absicht des Constraints
   (siehe Datei-Kopfkommentar dort: "verhindert nur offensichtlich
   unsinnige Werte") bleibt durch die weiterhin bestehende "achievements
   >= 0"-Pruefung erhalten - nur die (falsche) Annahme einer festen
   Erfolge-Obergrenze faellt weg.

   KEINE Erfolge werden rueckwirkend vergeben oder entfernt: sobald der
   Constraint faellt, korrigiert sich der gespeicherte Wert fuer beide
   betroffenen Spieler von GANZ ALLEIN beim naechsten normalen Website-
   Besuch (bkmpSyncPlayerStats() synct automatisch den live berechneten,
   echten Stand - kein manuelles Setzen eines geschaetzten Werts hier).

   Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
   Idempotent: mehrfaches Ausfuehren ist unschaedlich.
   ============================================================ */

alter table public.player_stats drop constraint if exists player_stats_achievements_check;
alter table public.player_stats add constraint player_stats_achievements_check check (achievements_unlocked >= 0);
