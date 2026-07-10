-- Bkmp - Nur ein aktives Geraet gleichzeitig pro Account.
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
--
-- Funktionsweise: bei jedem Login/Session-Wiederherstellen (siehe
-- bkmpClaimAndWatchSession in index.html) schreibt der Client eine neue,
-- zufaellige Kennung (UUID) in active_session_token. Jedes aktive Geraet
-- pollt alle 20s seine EIGENE zuletzt gesetzte Kennung gegen den aktuellen
-- Datenbank-Wert - stimmen sie nicht mehr ueberein, wurde inzwischen auf
-- einem ANDEREN Geraet eingeloggt, und dieses Geraet loggt sich selbst aus.
-- "Neuestes Login gewinnt" (kein Blockieren des neuen Geraets).
--
-- Bestehende update-Policy "Owner update player stats" (auth_user_id =
-- auth.uid()) deckt die neuen Spalten automatisch mit ab, keine neue
-- Policy noetig. Die bestehende select-Policy ist bereits oeffentlich
-- lesbar (wie eggs_found/achievement_unlocks) - der Token ist kein
-- Geheimnis, nur ein Vergleichswert.

alter table public.player_stats
  add column if not exists active_session_token uuid,
  add column if not exists active_session_started_at timestamptz;
