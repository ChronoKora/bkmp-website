-- Bkmp - Config-Zeile fuer die feste AFK-Belohnungsformel (21.08.2026,
-- ersetzt eine kurzlebige, nie ausgefuehrte Zwischenversion "offline_floor"
-- vollstaendig - siehe grosser Kommentar am Kopf von
-- api/claim-idle-offline-progress.js fuer die volle Herleitung). Rein
-- additiv - `on conflict (key) do nothing`, sicher auch bei mehrfachem
-- Ausfuehren.
--
-- Werte koennen jederzeit spaeter ohne Deploy per einfachem `update` an
-- dieser einen Zeile angepasst werden (gleiches Prinzip wie
-- offline_progress/dragon_scaling/reward_scaling, die dieselbe Tabelle
-- nutzen). WICHTIG: die Formel selbst funktioniert bereits jetzt ohne
-- diese Zeile (der Code faellt ohne sie auf dieselben Standardwerte
-- zurueck, sie ist nur fuer spaetere Admin-Anpassung ohne Deploy noetig).
--
--   efficiencyPct              - fester Prozentsatz der Basis-Belohnung
--                                pro angenommenem Kill (Nutzervorgabe: 75).
--   assumedSecondsPerKill      - Sekunden, die die Formel pro
--                                "kalkuliertem" Kill an einer normalen
--                                (nicht Boss-/Miniboss-)Stufe annimmt.
--   assumedSecondsPerBossKill  - dasselbe fuer Boss-/Miniboss-Stufen.
--   companionXpPerHour         - kleine garantierte Kampf-EP-Trickle-Menge
--                                fuer einen jugendlichen Begleitdrachen,
--                                unabhaengig von der Hauptformel.

insert into public.idle_game_config (key, value) values
  ('offline_afk_reward', '{"efficiencyPct":75,"assumedSecondsPerKill":45,"assumedSecondsPerBossKill":180,"companionXpPerHour":8}'::jsonb)
on conflict (key) do nothing;
