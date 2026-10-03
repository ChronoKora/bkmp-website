# Idle-Drachendorf – Analyse & Weiterentwicklung (03.10.2026)

Auftrag: das bestehende Drachen-Idle-Game vollständig analysieren und auf Basis des vorhandenen Systems weiterentwickeln (mehr Langzeitmotivation, Tiefe, Leben) – ohne Neubau, ohne bestehende BKInvestment-Funktionen zu beschädigen.

---

## 1. Ausgangslage (Analyse von Code und Datenbank)

Das Spiel ist bereits sehr umfangreich. Vorhandene Systeme (Auszug):

| Bereich | Bestand |
|---|---|
| Kampf | Auto-Tick (≥400 ms), Klick-Angriff mit Autoklicker-Schutz, Bosse (jede 25.), Minibosse (jede 10.), seltene Drachen (8 %), Event-Drachen, Feuer/Blitz/Regeneration |
| Fortschritt | Level/EP, 9 Upgrades mit Softcaps + Meilensteinen, Skilltree (5 Zweige + Meister), Prestige-Baum (52 Knoten + Paragon), Aufstieg/Drachenseelen |
| Wirtschaft | Gold/Holz/Stein/Kristalle/Essenz/Frucht/Fleisch, 8 Produktionsgebäude, Gebäude-Überladung, Booster (Goldrausch/Wissensschub) |
| Drachen | Zucht (Ei → Baby → Jugendlich → Erwachsen), 30+ Arten, Seltenheiten, Substats, bis 3 Begleiter, Aufstieg, Drachen-Dex |
| Herausforderungen | 7 Dungeons × 4 Schwierigkeiten (Schlüssel-System), Endloser Turm, Arena (ELO), Weltboss-Raid (stündlich), Gilde (Technologie-Baum, Boss, Quests, Chat, Gilden-Arena) |
| Sammlung | 250+ Erfolge (seitenweit), Titel mit Dauerboni, Kosmetiken, Dorf-Skins, Plüshies |
| Rückkehr | Offline-Fortschritt (serverseitige Simulation, bis 12 h), Login-Serie |

**Stärken:** sehr viele Langzeit-Systeme, saubere serverseitige Absicherung kritischer Werte (Anti-Cheat-Guard, RLS), umfangreiche Testsuite (Playwright + lokaler Mock-Backend).

## 2. Gefundene Lücken (bezogen auf die Auftragspunkte)

| Auftragspunkt | Befund |
|---|---|
| Tägliche/langfristige Ziele | **Keine persönlichen Tages-/Wochenaufträge** – nur Gilden-Quests (setzen eine Gilde voraus). Spieler ohne Gilde haben kein „Was mache ich heute?“. |
| Zufällige Ereignisse | Nur 8 % seltene Drachen, 0,1 % Event-Drachen und ein seltener „Fundschatz“ (Toast). **Kein interaktives Ereignis** im Kampf, das man aktiv „erwischen“ kann. |
| Rückkehr-Belohnungen | Login-Serie zahlt **fest max. 10.000 Gold** – für einen Stufe-5000-Spieler bedeutungslos. Serie lebt nur im Browser (Gerätewechsel = Serie weg). |
| Sammel-Systeme | Drachen-Dex deckt die **Zucht**-Arten ab, aber die im Kampf besiegten Drachen werden **nirgends gesammelt** (nur eine Gesamtzahl). |
| UI/UX | Viele Langzeit-Ziele existieren, sind aber **unsichtbar** (z. B. Upgrade-Meilensteine, nächster Titel, Prestige-Bereitschaft) – 16 Tabs, kein „Was als Nächstes?“. |
| Animationen/Interaktionen | Kampf-Feinschliff (03.08.) vorhanden, aber kaum „Momente“ außerhalb von Kills/Bossen. |
| Datenbank | `idle_player_state` hat 70+ Spalten; jede neue Spalte ist riskant (fehlt sie live, scheitern alle Autosaves). Kein Ort für nicht-kritische Zusatzdaten. |

## 3. Umgesetzt: „Chronik des Drachendorfs“ (Stufe 1)

Neues Modul `js/systems/bkmp-chronicle.js` + `css/bkmp-chronicle.css`. Erreichbar über die Karte „Tagesaufträge“ in der rechten Kampfspalte (Desktop) bzw. den 📜-Knopf im kompakten HUD (Handy/App), Badge zeigt abholbare Belohnungen.

1. **Tagesaufträge (3/Tag) + Wochenziele (3/Woche)** aus 12 Auftragsarten, die bewusst *alle* bestehenden Systeme ansprechen (Kampf, Upgrades, Runen, Dungeon, Turm, Arena, Zucht, Weltereignisse). Deterministisch pro Spieler + Tag, 1× täglich neu auswürfelbar. Offline-Fortschritt zählt mit. Truhen nach allen drei Aufträgen (Rune, Kristalle, Essenz, Booster; Wochentruhe zusätzlich Drachenei).
2. **Login-Kalender** (7-Tage-Zyklus, Belohnungen wachsen mit der höchsten Stufe, Treuebonus bis +50 %). Alte Formel bleibt Untergrenze. Serie wird zusätzlich serverseitig gespiegelt.
3. **Drachen-Bestiarium**: Siege pro Drachenart, 5 Stufen je Art mit kleinen Dauerboni (fließen in den bestehenden, gedeckelten Sammel-Pott).
4. **Weltereignisse** während aktiven Zuschauens: Schatztruhe, Sternschnuppe, Wandernder Händler (erster echter Abfluss für überschüssiges Holz/Stein), Goldregen, Weisheitswind, Kampfrausch.
5. **„Ziele“-Übersicht**: nächster Boss, Prestige, Upgrade-Meilenstein, Titel, Turm, Drachen-Dex, Bestiarium – jeweils mit Sprung zum passenden Tab.
6. **9 Erfolge + 4 Titel** mit Dauerbonus, sauber in das bestehende seitenweite Erfolgssystem eingebunden.

**Wichtige Designentscheidungen**
- *Eine* Belohnungseinheit für alles: genau das, was ein Drache auf der persönlich höchsten Stufe gibt (`bkmpIdleRewardsAt()`). Belohnungen fühlen sich für Anfänger und Endgame-Spieler gleich wertvoll an – ohne feste Zahlen, die die Wirtschaft sprengen oder bedeutungslos werden.
- Keine neue Drop-/Belohnungsformel: Runen, Eier, Booster laufen über die bestehenden Funktionen und Speicherwege.
- Kein Buff erhöht die Kill-*Rate* → kompatibel mit dem serverseitigen Anti-Cheat-Guard.
- Weltereignisse nur bei aktivem Zuschauen, nie im Dungeon/Turm/Raid; AFK-Spieler werden nicht bestraft (voller Offline-Fortschritt bleibt).
- Alle Einhängepunkte in bestehenden Dateien sind einzelne, per `typeof` geschützte Zeilen → admin.html / OBS-Overlay (binden das Modul nicht ein) laufen unverändert.

**Datenbank:** neue Tabelle `idle_player_meta` (eine JSONB-Zeile pro Konto, Schlüssel `auth_user_id` → umbenennungssicher, RLS nur eigene Zeile, Größenbremse). Datei `sql/20261003-idle-player-meta.sql` – **noch nicht ausgeführt**. Ohne Tabelle läuft alles lokal weiter; mit Tabelle zusätzlich geräteübergreifend und mit Doppel-Abhol-Schutz (vor jeder Auszahlung wird der Serverstand dazugemischt).

**Tests:** `tests/e2e/chronicle.spec.js` (19 Tests: Generierung, Determinismus, Delta-Zählung, Abholen + Serverspeicherung, kein Gold-Rückkopplungseffekt, Truhe, geräteübergreifender Schutz, Neuwürfeln, Bestiarium-Bonus, Offline-Verteilung, echte Kills, Weltereignisse, Kalender inkl. Tag 7, Einstiegspunkte Desktop/Handy, alle Reiter).

## 4. Weitere Vorschläge (Roadmap, nicht umgesetzt)

Sortiert nach Nutzen/Aufwand. Alles baut auf vorhandenen Systemen auf.

### Drachen & Entwicklung
- **Drachen-Expeditionen** (hoher Nutzen, mittlerer Aufwand): erwachsene Drachen, die *kein* Begleiter sind, auf zeitbasierte Expeditionen schicken (1/4/8 h) → Ressourcen, Eier-Chance, Runen. Gibt den vielen Lagerdrachen einen Zweck und passt perfekt zum Idle-Prinzip. Speicherbar in `player_dragons` (eine Zeitstempel-Spalte) oder `idle_player_meta`.
- **Element-Affinität**: Begleiter mit passendem Element gegen bestimmte Gegnerarten (Feuer > Wind > Erde > Wasser > Feuer) → kleine Schadensboni, macht die Begleiterwahl taktischer.
- **Drachen-Charakterzüge** beim Erwachsenwerden (1 von ~10 Eigenschaften, z. B. „Gierig: +5 % Gold“, „Wachsam: +3 % Verteidigung“) – zusätzlich zu den Substats, rein flavourvoll benannt.

### Langzeitziele & Ereignisse
- **Saison-Pass „Drachensaison“** (kostenlos, 4 Wochen): Saisonpunkte aus Chronik-Aufträgen, 30 Belohnungsstufen inkl. exklusivem Dorf-Skin/Titel pro Saison. Nutzt die Chronik-Infrastruktur direkt weiter.
- **Wochenend-Ereignisse**: am Wochenende erhöhte Weltereignis-Rate oder doppelte Bestiarium-Zählung – kostet nichts, bringt Spieler regelmäßig zurück.
- **Gilden-Chronik**: ein gemeinsames Wochenziel der Gilde, gespeist aus den persönlichen Aufträgen der Mitglieder.

### Wirtschaft
- **Mana** (Spalte `mana` existiert, wird aber nicht mehr verwendet – siehe Kommentar in `idledorf.js`) entweder wiederbeleben (z. B. als Währung für Zauber-Buffs) oder offiziell entfernen.
- **Händler-Ausbau**: wechselnde Tagesangebote im Chronik-Fenster (Tausch überschüssiger Ressourcen), begrenzt auf 3/Tag.

### Verbindung mit BKInvestment
- **Profil auf der Website**: Bestiarium-Stufen, erledigte Aufträge und Kalender-Serie im öffentlichen Spielerprofil anzeigen (Daten liegen bereits im Erfolgs-Cache).
- **Plüshie-Chance in der Wochentruhe** (z. B. 2 %) – analog zum Raid/Gildenboss-Drop vom 27.09., serverseitig per RPC (Codes werden bereits so vergeben).
- **BK-Mod**: Chronik-Fortschritt in der Minecraft-Mod anzeigen („Heute 2/3 Aufträge erledigt“).

### UI/UX
- **Hierarchische Navigation** (bereits mehrfach angedacht): 16 Tabs → 4 Hauptbereiche mit Unterpunkten.
- **Ereignis-Hinweis bei geschlossenem Fenster**: kleiner pulsierender Punkt am „Idle Dorf“-Knopf der Website, wenn Belohnungen abholbar sind (Badge-Logik existiert bereits).

### Performance & Codequalität (konkrete Befunde)
- `bkmpIdleGetAchievementContextFields()` schreibt bei **jedem Kill** den kompletten Erfolgs-Cache per `JSON.stringify` in `localStorage` (Aufruf in `bkmpIdleHandleDragonDefeated`). Drosseln auf z. B. alle 5 s wäre eine einfache, risikoarme Entlastung.
- `bkmpIdleRenderHud()` baut das HUD bei jedem Tick per `innerHTML` neu auf – gezielte Textupdates wären deutlich günstiger.
- `bkmpIdleApplyOfflineResult()` übernimmt die **Server-Summen** per `Object.assign` – noch nicht gespeicherte lokale Gewinne können dabei überschrieben werden (im normalen Ablauf unkritisch, weil vorher gespeichert wird; beim OBS-Hintergrund-Nachholen theoretisch möglich). Empfehlung: Deltas statt Summen übernehmen. Beim heutigen Testen sichtbar geworden, bewusst nicht im selben Schritt geändert (zentraler Speicherpfad).
- `idledorf.js` (~4.000 Zeilen) weiter zerlegen: Upgrades, Produktionsgebäude und Offline-Logik sind gute Kandidaten für eigene `/js/systems/`-Dateien.
- Datenbank: künftige, nicht spielkritische Zusatzdaten (z. B. Login-Serie, „Grimbold-Dialog gesehen“, Effekt-Einstellungen) in `idle_player_meta` statt `localStorage` bzw. neuer Spalten.

## 5. Offene Schritte für den Betreiber
1. `sql/20261003-idle-player-meta.sql` im Supabase-Dashboard ausführen (optional, aber empfohlen: geräteübergreifender Fortschritt + Doppel-Abhol-Schutz).
2. `sql/20261003-changelog-chronik.sql` ausführen (öffentliche Changelog-Einträge).
3. Nach dem Deploy einmal selbst die Chronik öffnen und einen Auftrag abholen.
