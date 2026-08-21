-- Bkmp - Garantierter Mindestlohn fuer den Offline-/AFK-Kampf-Fortschritt
-- (21.08.2026). Spieler-Meldung BagonTr01: "ganzen Abend weg... nichts
-- bekommen fuers AFK" - Root Cause + volles Design siehe grosser Kommentar
-- in api/claim-idle-offline-progress.js. Rein additiv, keine bestehende
-- Zeile/Tabelle wird veraendert - `on conflict (key) do nothing`, sicher
-- auch bei mehrfachem Ausfuehren.
--
-- Werte koennen jederzeit spaeter ohne Deploy per einfachem `update` an
-- dieser einen Zeile angepasst werden (gleiches Prinzip wie offline_progress/
-- dragon_scaling/reward_scaling/rare_spawn, die dieselbe Tabelle nutzen).
--
--   enabled              - Kill-Schalter, false schaltet den Mindestlohn
--                          komplett ab (Verhalten dann exakt wie vor diesem
--                          Fix, kein Code-Pfad-Unterschied).
--   assumedSecondsPerKill      - Sekunden, die der Mindestlohn pro
--                                "kalkuliertem" Kill an einer normalen Stufe
--                                annimmt (bewusst deutlich langsamer als
--                                echter Live-Kampf, siehe Kommentar).
--   assumedSecondsPerBossKill  - dasselbe fuer Boss-/Miniboss-Stufen.
--   efficiencyPct              - Prozentsatz der normalen Belohnung, den der
--                                Mindestlohn zahlt (bewusst deutlich unter
--                                100%, damit "auf einer unschaffbaren Stufe
--                                stehen bleiben" nie die bessere Strategie
--                                wird).
--   companionXpPerHour         - kleine garantierte Kampf-EP-Trickle-Menge
--                                fuer einen jugendlichen Begleitdrachen,
--                                falls die Simulation komplett leer ausgeht.

insert into public.idle_game_config (key, value) values
  ('offline_floor', '{"enabled":true,"assumedSecondsPerKill":45,"assumedSecondsPerBossKill":180,"efficiencyPct":35,"companionXpPerHour":8}'::jsonb)
on conflict (key) do nothing;
