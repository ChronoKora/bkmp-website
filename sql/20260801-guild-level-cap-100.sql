-- ============================================================
-- Bkmp - Gilden-Level-Ausbau: Deckel von 30 auf 100 angehoben, deutlich
-- steilere Kurve fuer die neuen Stufen 31-100 (Nutzerwunsch, 01.08.2026:
-- "es gibt schon paar Gilden die lvl 30 max haben und sich langweilen..
-- also ruhig auf lvl 100 direkt und wie gesagt die Gold kurve muss
-- steigen").
--
-- Architektur (bereits vollstaendig daten-getrieben, siehe
-- sql/supabase-guild-extension-foundation.sql Kommentar bei Zeile 38-43 -
-- "explizit so gebaut, um spaeter mit neuen Werten erneut ausgefuehrt zu
-- werden"): weder guild_level_for_xp() (SQL) noch bkmpGuildLevelInfo()/
-- die Fortschrittsbalken-UI (JS, js/systems/bkmp-guild.js) hardcoden
-- irgendwo eine Levelanzahl - sie lesen einfach so viele Zeilen wie in
-- guild_level_thresholds existieren. Diese Migration braucht deshalb
-- KEINE Code-Aenderung an der Kern-Levellogik, nur neue Tabellenzeilen.
--
-- Kurven-Design (Levels 1-30 UNVERAENDERT, siehe unten - keine
-- Migration/kein Rueckwirkungs-Risiko fuer bereits erreichte Level):
-- das bisherige Delta-Wachstumsverhaeltnis (aufeinanderfolgende
-- Stufen-Differenzen) fiel bis Level 30 kontinuierlich von anfangs ~2,3x
-- auf zuletzt ~1,14x (29->30) - eine bewusst ABFLACHENDE Kurve, die beim
-- urspruenglichen Deckel von 30 Sinn ergab. Fuer die neuen Stufen 31-100
-- steigt das Verhaeltnis stattdessen LINEAR von 1,16x (knuepft nahtlos an
-- den zuletzt beobachteten Wert an, kein Sprung bei Level 30->31) auf
-- 1,25x bei Level 100 - die Kurve wird also tatsaechlich STEILER statt
-- weiter abzuflachen, wie ausdruecklich gewuenscht. Level 100 landet bei
-- ~4,9 Billiarden XP (vs. 14,3 Milliarden bei Level 30) - ein bewusst
-- gewaltiger, langfristiger Gildensenke fuer bereits ausgereizte Gilden.
-- Exakte Werte per eigenstaendigem Node-Skript berechnet (deterministische
-- Formel, nicht von Hand geschaetzt), auf sinnvolle Rundungsstufen
-- gerundet (Millionen bis Level 40, dann zunehmend groebere Rundung).
--
-- Die Abkuerzungs-Anzeige (bkmpIdleFormatNumber(), js/core/bkmp-combat-
-- math.js) kannte bisher nur bis 'M' (Millionen) - ein Wert wie Level 30s
-- 14.300.000.000 waere faelschlich als "14300M" statt "14,3B" erschienen
-- (bereits ein bestehender, nie aufgefallener Fehler, siehe separater
-- Code-Commit). Fuer die neuen, weit groesseren Level 31-100-Werte war
-- das zwingend mit-zu-fixen - ohne den Fix waeren die neuen Zahlen
-- praktisch unlesbar gewesen (z.B. "4906000000000000M").
-- ============================================================

insert into public.guild_level_thresholds (level, xp_required) values
  (31, 16736000000), (32, 19565000000), (33, 22854000000), (34, 26682000000), (35, 31143000000),
  (36, 36346000000), (37, 42423000000), (38, 49527000000), (39, 57842000000), (40, 67585000000),
  (41, 79014000000), (42, 92436000000), (43, 108200000000), (44, 126800000000), (45, 148700000000),
  (46, 174500000000), (47, 205000000000), (48, 241000000000), (49, 283600000000), (50, 334100000000),
  (51, 394000000000), (52, 465200000000), (53, 549800000000), (54, 650500000000), (55, 770400000000),
  (56, 913400000000), (57, 1084100000000), (58, 1288200000000), (59, 1532400000000), (60, 1824900000000),
  (61, 2175600000000), (62, 2596600000000), (63, 3102500000000), (64, 3711200000000), (65, 4444200000000),
  (66, 5328000000000), (67, 6394700000000), (68, 7683500000000), (69, 9242400000000), (70, 11130000000000),
  (71, 13420000000000), (72, 16200000000000), (73, 19570000000000), (74, 23670000000000), (75, 28660000000000),
  (76, 34750000000000), (77, 42170000000000), (78, 51240000000000), (79, 62330000000000), (80, 75900000000000),
  (81, 92520000000000), (82, 112910000000000), (83, 137950000000000), (84, 168720000000000), (85, 206580000000000),
  (86, 253220000000000), (87, 310730000000000), (88, 381710000000000), (89, 469420000000000), (90, 577910000000000),
  (91, 712250000000000), (92, 878780000000000), (93, 1085000000000000), (94, 1342000000000000), (95, 1661000000000000),
  (96, 2058000000000000), (97, 2553000000000000), (98, 3171000000000000), (99, 3942000000000000), (100, 4906000000000000)
on conflict (level) do update set xp_required = excluded.xp_required;

-- ============================================================
-- Neue Erfolgs-/Titel-Meilensteine fuer den erweiterten Bereich (bisher
-- endete die Reihe bei Level 20, siehe BKMP_GUILD_ACHIEVEMENTS_EXTRA in
-- js/systems/bkmp-guild.js + BKMP_IDLE_TITLES in idledorf.js - beide rein
-- clientseitig, hier nur als Kommentar dokumentiert, keine SQL noetig).
-- guild_level_40/60/80/100 + zugehoerige idletitle_guild_levelXX-Boni
-- wurden im selben Commit ergaenzt (Namens-Konvention bereits bestehend,
-- siehe die vorhandenen guild_level_5/10/20-Eintraege).
-- ============================================================
