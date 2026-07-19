-- Bkmp - Phase 5.6, Nutzer-Auftrag 19.07.: normale Kampf-Rotation vorübergehend
-- auf die 3 Arten mit neuem transparentem Rendering beschränken (Feuer/Wasser/
-- Wind), bis weitere Grünschirm-Assets nachgeliefert sind (Erd-/Cyber-/
-- Schattendrache). Wirkt NUR auf idle_dragons.active - dieselbe Spalte
-- steuert sowohl die Live-Gegnerauswahl (bkmpIdleSelectDragonKindId) als
-- auch die serverseitige Offline-Fortschritts-Simulation
-- (api/claim-idle-offline-progress.js, "idle_dragons?active=eq.true").
-- NICHT ausgeführt - liegt hier nur bereit, falls gewünscht.
--
-- Betrifft NUR standard-Drachen (normale Kill-Rotation). blitzdrache/
-- erddrache/cyberdrache haben (noch) kein neues Rendering, fallen bei
-- Deaktivierung einfach aus der Rotation, nicht geloescht, jederzeit mit
-- demselben Befehl (active=true) reaktivierbar.
--
-- Rueckfrage im Chat beantwortet (19.07.): Miniboss (yakshas-drache, alle
-- 10 Kills) wird ebenfalls deaktiviert - hat noch kein neues Rendering und
-- keine Yaksha-Boss-Alternative fuer diesen Slot. Faellt dadurch einfach auf
-- die normale Rotation zurueck (siehe selectDragonKindId-Fallback: leerer
-- miniboss_10-Pool -> normaler Drache), alle 10 Kills also kuenftig kein
-- eigener Miniboss-Encounter mehr, bis yakshas-drache selbst ein Asset hat.
-- yaksha-boss (echter Boss, alle 25 Kills) ist bereits die einzige
-- boss_25-Art und braucht daher keine Aenderung.
--
-- Nachtrag (19.07., Chat-Rueckfrage "Liber und Shenloss auch entfernt?"
-- -> "Die muessen erstmal mit weg ja."): shenloss/liber (spawn_rule
-- 'event_easter') ebenfalls deaktiviert. Technisch unproblematisch, weil
-- bkmpIdleSelectDragonKindId() (js/core/bkmp-combat-math.js) den active-
-- Filter VOR jeder Pool-Auswahl anwendet - der Event-Drachen-Wurf
-- (eventPool, 0.1%-Chance/Kill) findet dann einfach keine Kandidaten mehr
-- und faellt sauber durch auf Rare/Standard, exakt wie bei den 4 Drachen
-- oben. Kein Sonderfall in der Spawn-Logik noetig. Betrifft NUR zukuenftige
-- Spawns - Spieler, die Shenloss/Liber schon gefunden/besiegt haben,
-- behalten diesen Fortschritt (excludedEventIds/Achievements sind eigener
-- Zustand, wird von active nicht beruehrt); Spieler, die sie noch nicht
-- gefunden haben, koennen sie bis zur Reaktivierung nicht mehr finden.

update public.idle_dragons
set active = false
where id in ('blitzdrache', 'erddrache', 'cyberdrache', 'yakshas-drache', 'shenloss', 'liber');

-- Rueckgaengig machen:
-- update public.idle_dragons set active = true where id in ('blitzdrache', 'erddrache', 'cyberdrache', 'yakshas-drache', 'shenloss', 'liber');
