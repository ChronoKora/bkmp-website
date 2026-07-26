-- Bkmp - Dringender Fix: Spieler koennen ueber Level 2000 nicht hinaus
-- speichern (Meldungen Danw_90 + Kaledoss, 26.07.2026).
--
-- Root Cause (per echtem Response-Body aus der Browser-Konsole bewiesen,
-- nicht geraten): idle_player_state hat seit der urspruenglichen
-- Schema-Datei (sql/supabase-idle-dorf-schema.sql, Zeile 142-143) eine
-- CHECK-Bedingung "level >= 1 and level <= 2000" - vermutlich als
-- grosszuegig gemeinter Anfangs-Schutzwert gedacht, zu einer Zeit, als
-- niemand annaehernd dort ankam. Erreicht ein Spieler jetzt Level 2001+,
-- lehnt Postgres JEDEN weiteren Speicherversuch mit Fehlercode 23514
-- (check_violation) ab - das Level selbst waechst clientseitig aber
-- ungebremst weiter (idledorf.js: "bkmpIdleState.level += 1", kein Deckel),
-- wodurch der Spieler in eine Dauerschleife aus fehlgeschlagenen
-- Autosaves laeuft ("Idle Dorf: Speichern fehlgeschlagen", alle ~4s neu).
-- Kein Datenverlust - der zuletzt erfolgreich gespeicherte Stand (Level
-- <=2000) bleibt in der DB unangetastet stehen, bis dieser Fix greift.
-- Ein Prestige-Aufstieg "loest" das Symptom nur deshalb, weil er das Level
-- wieder unter 2000 zuruecksetzt (Kaledoss hat genau das gemacht, weil der
-- Fehler nervte - kein Hinweis auf die eigentliche Ursache, nur Zufall,
-- dass Prestige das Level ohnehin mit zuruecksetzt).
--
-- Gezielt geprueft, ob "2000" irgendwo im Code als bedeutsame Levelgrenze
-- vorausgesetzt wird (Reward-Tabelle fester Groesse o.ae.) - einziger Fund
-- ist ein voellig unabhaengiger Erfolgstitel "Zweitausend Drachen" bei
-- 2000 KILLS (nicht Level), betrifft diesen Fix nicht.
--
-- Zusaetzlich direkt daneben in derselben Schema-Datei: "dragon_kills <=
-- 5000000" - identisches Muster (frueher Sicherheitswert, kein echter
-- Design-Deckel). Noch nicht ausgeloest (aktuell hoechster bekannter Stand
-- 305541), aber voraussehbar dasselbe Problem fuer kuenftige
-- Langzeitspieler - wird hier vorsorglich mit angehoben, da exakt derselbe
-- Fix an derselben Stelle.
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- Reine Constraint-Anpassung, keine Daten werden veraendert/geloescht.

alter table public.idle_player_state drop constraint if exists idle_player_state_level_check;
alter table public.idle_player_state add constraint idle_player_state_level_check check (level >= 1 and level <= 1000000);

alter table public.idle_player_state drop constraint if exists idle_player_state_kills_check;
alter table public.idle_player_state add constraint idle_player_state_kills_check check (dragon_kills >= 0 and dragon_kills <= 100000000);
