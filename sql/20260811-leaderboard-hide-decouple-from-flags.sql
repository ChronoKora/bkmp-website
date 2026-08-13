-- Bkmp - DRINGENDER FIX: Bestenliste blendete faelschlich 33 von 217 Accounts
-- aus (Nutzer-Meldung 11.08.2026: "habe berichte das einige nicht mehr in der
-- Leaderboards angezeigt werden").
--
-- ROOT CAUSE (per direktem curl gegen die echte Produktions-DB bestaetigt,
-- nicht nur vermutet): die View aus sql/20260809-leaderboard-hide-mechanism.sql
-- blendet bisher JEDEN Account mit IRGENDEINEM nicht abgehakten Anti-Cheat-
-- Alarm automatisch aus - komplett OHNE menschliche Pruefung. Der combat-stat-
-- Trigger aus sql/20260809-anticheat-guard-combat-stats.sql (50x-Multiplikator
-- pro Speicherung) feuert aber auf ganz normale, legitime Spielmechaniken
-- dieses Spiels viel zu leicht: Prestige-Reset+Neu-Investition, ein Gilden-
-- Technologie-Sprung, Runen-Aufwertung/-Verschmelzung/-Aufstieg oder ein
-- automatischer Mehrfach-Kauf koennen Kampfwerte in EINER Speicherung
-- voellig legitim um mehr als das 50-fache steigen lassen, besonders bei noch
-- niedrigem Ausgangswert. Ergebnis: 33 von 217 Accounts wurden ausgeblendet,
-- praktisch alle davon nachweislich lange dokumentierte, echte Spieler
-- (inkl. ChronoKora - der eigene Account des Betreibers - und OPShadowWolf,
-- der die Videos geschickt hat, die den urspruenglichen Bug ueberhaupt erst
-- aufgedeckt haben). Per Vergleich mit den TOP-Accounts, die NICHT ausge-
-- blendet wurden (z.B. skill_knight, Level 9223, attack~14.500), zeigt sich:
-- selbst die aktuell staerksten legitimen Accounts im ganzen Spiel liegen
-- bei attack/defense/hp im niedrigen 5-stelligen Bereich - der gemeldete
-- echte Exploit lag bei 420.450.000 (attack), also grob das 28.000-fache
-- des staerksten echten Spielers. Ein winziger Bruchteil dieser Sicherheits-
-- marge reicht als Grenze voellig aus (siehe Datei 2 unten) - die bisherige
-- relative 50x-pro-Speicherung-Grenze war dagegen viel zu eng fuer normale
-- Bursts.
--
-- WICHTIG, damit der Schaden eingeordnet werden kann: KEIN echter Spieler
-- hat dadurch tatsaechlich an Kampfkraft verloren. bkmpIdleRecomputeEffective-
-- Stats() (idledorf.js) berechnet attack/defense/hp/crit_*/gold_bonus/xp_bonus/
-- loot_bonus bei JEDEM Oeffnen des Fensters (und an vielen weiteren Stellen)
-- komplett neu und UNABHAENGIG vom zuletzt gespeicherten DB-Wert (kein
-- Lesen-und-fortschreiben, reine Neuberechnung aus Skilltree+Prestige+Runen+
-- Titel+Gilden-Tech+Auf­stieg) - ein durch den Trigger faelschlich gekappter
-- DB-Wert wird dadurch beim naechsten Spielen automatisch wieder auf den
-- korrekten Stand ueberschrieben. Der einzige tatsaechliche Schaden war die
-- Ausblendung von der oeffentlichen Bestenliste.
--
-- FIX (dieser Datei): die Bestenlisten-Sicht blendet ab sofort NUR NOCH
-- manuell (per Admin-Panel-Klick, idle_leaderboard_hidden_accounts) aus-
-- geblendete Accounts aus - kein automatisches Ausblenden mehr durch einen
-- rohen Trigger-Alarm. idle_anticheat_flags bleibt vollstaendig bestehen und
-- wird weiter befuellt (reines Admin-Panel-Telemetrie/Review-Werkzeug, siehe
-- "🚨 Anti-Cheat-Alarme" im Admin-Panel) - der Admin kann jeden Alarm ansehen
-- und dann bewusst per "🙈 Ausblenden"-Knopf ausblenden, statt dass ein
-- rohes Zahlenverhaeltnis das automatisch fuer alle entscheidet. Das
-- entspricht exakt dem urspruenglichen Nutzerwunsch vom 09.08. ("ich moechte
-- diese Werte NUR im AdminPanel sehen koennen, NICHT direkt in der
-- Bestenliste") - der bisherige Auto-Hide-Automatismus war ein Konstruktions-
-- fehler, keine bewusste Entscheidung.
--
-- Baut auf sql/20260809-leaderboard-hide-mechanism.sql auf (ersetzt nur die
-- View, aendert nichts an den beiden Tabellen/Policies).
--
-- Supabase Dashboard > SQL Editor > New query > diesen Inhalt ausfuehren.
-- idempotent: mehrfaches Ausfuehren ist unschaedlich. Wirkt SOFORT nach dem
-- Ausfuehren - stellt alle faelschlich ausgeblendeten Accounts augenblicklich
-- wieder sichtbar her, ohne dass irgendwelche Spielstaende angefasst werden.

create or replace view public.idle_player_state_leaderboard
as
select s.name_key, s.display_name, s.level, s.total_gold_earned, s.dragon_kills,
       s.playtime_seconds, s.highest_dragon_index, s.prestige_stage_offset, s.turm_highest_wave
from public.idle_player_state s
where not exists (
  select 1 from public.idle_leaderboard_hidden_accounts h where h.name_key = s.name_key
);

grant select on public.idle_player_state_leaderboard to anon, authenticated;
