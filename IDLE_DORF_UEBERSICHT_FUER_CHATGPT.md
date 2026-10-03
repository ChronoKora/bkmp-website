# BKInvestment – Idle-Drachendorf: Stand & Änderungen (Oktober 2026)

## 1. Worum es geht
- **bkinvestment.de** ist die Website einer deutschsprachigen Minecraft-Community (OPSUCHT-Server): Investoren-, Marktplatz- und Shop-Seiten.
- Eingebaut ist das Browser-Idle-Game **„Idle-Drachendorf“**. Das eigene Dorf kämpft automatisch Stufe für Stufe gegen Drachen; man kann zusätzlich klicken.
- Spielerkonten laufen über den Minecraft-Namen. Das Spiel läuft auch als installierbare App und als OBS-Stream-Overlay für Streamer.
- **Technik:** statische Website ohne Build-Schritt (HTML, CSS, klassisches JavaScript), Supabase als Backend (Postgres, Auth, Row Level Security), Hosting auf Vercel. Der Betreiber ist nicht technisch; der Code wird mit einem KI-Assistenten gebaut.

## 2. Was das Spiel schon vorher hatte

| Bereich | Bestand |
|---|---|
| Kampf | Auto-Kampf (Takt mindestens 400 ms), Klick-Angriff mit Autoklicker-Schutz, Boss jede 25. Stufe, Miniboss jede 10., seltene Drachen (8 %), Event-Drachen, Feuer-, Blitz- und Regenerations-Effekte |
| Fortschritt | Level/EP, 9 Upgrades mit Softcaps und Meilensteinen, Skilltree (5 Zweige), Prestige-Baum (52 Knoten + Paragon), zweite Prestige-Ebene „Aufstieg“ (Drachenseelen) |
| Wirtschaft | Gold, Holz, Stein, Kristalle, Essenz, Frucht, Fleisch; 8 Produktionsgebäude; Gebäude-Überladung; Booster (Goldrausch, Wissensschub) |
| Drachen | Zucht (Ei → Baby → Jugendlich → Erwachsen), 30+ Arten, Seltenheiten, Zusatzwerte, bis zu 3 Kampfbegleiter + 1 Trainingsplatz, Drachen-Aufstieg, Drachen-Dex |
| Herausforderungen | 7 Dungeons × 4 Schwierigkeiten (Schlüssel-System), Endloser Turm, Arena (ELO), stündlicher Weltboss-Raid, Gilden (Technologie-Baum mit Mitgliederbeiträgen, Gildenboss, Quests, Chat, Gilden-Arena) |
| Sammlung | 250+ Erfolge (seitenweit), Titel mit Dauerboni, Kosmetik, Dorf-Skins (teils als Video), Plüschtiere |
| Rückkehr | Offline-Fortschritt (serverseitige Simulation, bis 12 h), tägliche Login-Serie |

## 3. Gefundene Lücken (Analyse vor dieser Runde)
- **Keine persönlichen Tages- oder Wochenziele.** Es gab nur Gilden-Quests, Spieler ohne Gilde hatten kein „Was mache ich heute?“.
- **Keine interaktiven Zufallsereignisse** im Kampf, nur seltene Drachen.
- **Die Login-Belohnung war fest bei maximal 10.000 Gold**, für Langzeitspieler bedeutungslos. Die Serie lag nur im Browser; ein Gerätewechsel hat sie gelöscht.
- **Besiegte Drachenarten wurden nirgends gesammelt**, nur als Gesamtzahl gezählt.
- **Viele Langzeitziele waren unsichtbar** (nächster Meilenstein, nächster Titel, Prestige-Bereitschaft), bei 16 Tabs ohne „Was als Nächstes?“.
- Die Haupttabelle `idle_player_state` hat 70+ Spalten. Jede neue Spalte ist riskant: fehlt sie live, scheitern alle Speichervorgänge.

## 4. Neu: „Chronik des Drachendorfs“
**Zugang:** Karte „Tagesaufträge“ rechts im Kampf-Tab, mit Kurzlinks 📅 Kalender · 📖 Bestiarium · 🎯 Ziele. Auf dem Handy über den 📜-Knopf. Das Fenster hat 4 Reiter, ein Zähler zeigt abholbare Belohnungen.

### 4.1 Tagesaufträge (3 pro Tag) und Wochenziele (3 pro Woche)
- **12 Auftragsarten:**

  | Auftrag | pro Tag | pro Woche |
  |---|---|---|
  | Drachen besiegen | 400 | 6.000 |
  | Bosse/Minibosse besiegen | 12 | 150 |
  | Gold verdienen | skaliert mit der eigenen Stufe | skaliert mit der eigenen Stufe |
  | Kampfzeit | 15 Min. | 3 Std. |
  | Upgrade-Stufen kaufen | 30 | 300 |
  | Runen-Aufwertungen | 8 | 50 |
  | Klick-Angriffe | 150 | 1.500 |
  | Dungeon-Läufe | 2 | 14 |
  | Turmstufen | 15 | 100 |
  | Weltereignisse | 2 | 15 |
  | Babydrachen füttern | 3 | – |
  | Arena-Kämpfe | 2 | 12 |

- **Auswahl:** pro Spieler und Tag fest ausgewürfelt (ein Reload würfelt nicht neu), 1× täglich kostenlos neu würfelbar. Aufträge, deren System man noch nicht nutzt, werden ausgelassen.
- **Offline-Fortschritt zählt mit**, weil der Fortschritt aus bestehenden Zählern abgeleitet wird.
- **Truhen nach allen drei Aufträgen:**
  - Tagestruhe: Rune, Kristalle, Essenz, Booster.
  - Wochentruhe: zusätzlich ein Drachenei und 2 Runen.

### 4.2 Login-Kalender (ersetzt die alte feste Login-Belohnung)
- **7-Tage-Zyklus:** Goldbeutel → Gold+EP → Kristalle+Essenz → Goldrausch-Booster → Kristallschatz → Wissensschub-Booster → Wochentruhe mit Rune.
- **Beträge wachsen mit der höchsten erreichten Stufe**, plus Treuebonus von +10 % pro voller Woche (maximal +50 %).
- **Die alte Formel gilt als Untergrenze**, niemand bekommt weniger als vorher.
- Die Serie wird zusätzlich auf dem Server gespeichert, ein Gerätewechsel verliert sie nicht mehr.

### 4.3 Drachen-Bestiarium
- **Siege werden pro Drachenart gezählt**, in 5 Stufen (Bronze bis Diamant):

  | Drachentyp | Schwellen |
  |---|---|
  | normal | 100 / 1.000 / 10.000 / 50.000 / 250.000 |
  | selten und Miniboss | 10 / 100 / 1.000 / 5.000 / 25.000 |
  | Boss | 5 / 50 / 500 / 2.500 / 10.000 |

- **Jede Stufe gibt einen kleinen Dauerbonus**, abhängig von der Art. Beispiele:
  - Feuerdrache: +2 % Angriff
  - Blitzdrache: +4 % Krit-Schaden
  - Erddrache: +2 % Verteidigung
  - Schattendrache: +3 % Beute
  - Yaksha-Boss: +3 % Bossschaden
- Die Boni fließen in den bestehenden, gedeckelten Bonus-Topf und bleiben über Prestige erhalten.
- Offline-Siege werden nach den echten Spawn-Regeln auf die Arten verteilt.

### 4.4 Weltereignisse
- **Nur während man dem Kampf zuschaut**, etwa alle 5 Minuten (erste Prüfung nach 60 s, dann alle 10 s mit 6 % Chance, 150 s Abklingzeit). Nie in Dungeon, Turm oder Raid.
- **Zum Anklicken:**
  - Schatztruhe
  - Sternschnuppe
  - Wandernder Händler: tauscht überschüssiges Holz und Stein gegen Kristalle und Essenz.
- **Buffs:**
  - Goldregen: 2× Gold für 90 s
  - Weisheitswind: 2× EP für 90 s
  - Kampfrausch: +50 % Schaden für 60 s
- Kein Buff erhöht die Kill-Rate, weil der Server sie begrenzt (siehe Abschnitt 8).

### 4.5 „Ziele“-Übersicht
Zeigt nächsten Boss, Prestige-Bereitschaft, nächsten Upgrade-Meilenstein, nächste Titel, Turm-Rekord, Drachen-Dex und Bestiarium. Jeder Eintrag hat einen „Los →“-Sprung zum passenden Tab.

### 4.6 Neue Erfolge und Titel
- **9 Erfolge:**
  - Auftragnehmer, Zuverlässiger Held, Chronist (1/25/100 Aufträge)
  - Wochenwerk, Unermüdlicher Planer (1/10 Wochentruhen)
  - Glückspilz, Ereignisjäger (10/100 Weltereignisse)
  - Drachenkundler, Meister des Bestiariums (10/30 Bestiarium-Stufen)
- **4 Titel mit Dauerbonus:**
  - Chronist: +5 % EP
  - Unermüdlicher Planer: +5 % Gold
  - Ereignisjäger: +5 % Beute
  - Meister des Bestiariums: +5 % Angriff

### 4.7 Wichtige Designregeln der Chronik
- **Alle Belohnungen nutzen eine Einheit:** so viel, wie ein Drache auf der persönlich höchsten Stufe gibt. Belohnungen fühlen sich dadurch für Anfänger und Endgame-Spieler gleich wertvoll an, ohne feste Zahlen.
- **Keine neue Drop-Formel:** Runen, Eier und Booster laufen über die bestehenden Wege.
- **Speicherung** in einer neuen Tabelle `idle_player_meta` (eine JSON-Zeile pro Konto). Vor jeder Auszahlung wird der Serverstand abgeglichen, damit auf zwei Geräten nichts doppelt abgeholt werden kann.

## 5. Performance-Umbauten (Spieler meldeten verzögerte Maus-Hover)
1. **Teil 1:**
   - Ursache: Das ganze Dorf-Fenster und das Runen-Lager hatten einen dauerhaft wandernden Rahmen-Schimmer. Der Browser musste die komplette Karte in jedem Bild neu malen, etwa 6 Sekunden Grafikarbeit pro 3 Sekunden.
   - Fix: Der Schimmer ist eingefroren (sieht gleich aus). „Effekte: Aus“ stoppt jetzt wirklich alle Deko-Animationen. Website-Animationen unter dem offenen Spiel pausieren.
2. **Teil 2 (nur Kampf-Tab):**
   - Ursache: Drache und Dorf sind Videos mit weichen Schatten-Filtern. Bei Videos werden solche Filter in jedem Bild neu berechnet, auch bei pausiertem Video.
   - Fix: Die Schatten werden jetzt nur einmal gezeichnet (sehen gleich aus). Ergebnis: 16 → 47 Bilder pro Sekunde im Kampf-Tab. Welt- und Gildenboss sind mitbehoben.
3. **Schutztests** verhindern, dass diese beiden Fehlerarten zurückkommen.

## 6. Qualität und Status
- Automatische Playwright-Testsuite mit lokalem Test-Backend:
  - neu: 19 Chronik-Tests und 5 Performance-Schutztests
  - mehrere bestehende Tests wurden robuster gemacht
- Alles ist committed und live, die Datenbank-Migrationen sind ausgeführt.

## 7. Bereits notierte, noch NICHT umgesetzte Ideen
- **Drachen-Expeditionen:** erwachsene Drachen, die kein Begleiter sind, für 1/4/8 Stunden losschicken; Ertrag: Ressourcen, Eier-Chance, Runen.
- **Element-Affinität:** Feuer > Wind > Erde > Wasser > Feuer, gibt kleine Schadensboni.
- **Drachen-Charakterzüge** beim Erwachsenwerden, z. B. „Gierig: +5 % Gold“.
- **Kostenloser Saison-Pass „Drachensaison“** (4 Wochen, 30 Stufen, exklusiver Skin oder Titel), Punkte aus Chronik-Aufträgen.
- **Wochenend-Events:** mehr Weltereignisse oder doppelte Bestiarium-Zählung.
- **Gilden-Chronik:** gemeinsames Wochenziel aus den persönlichen Aufträgen der Mitglieder.
- **Ungenutzte Ressource „Mana“:** wiederbeleben (z. B. für Zauber-Buffs) oder entfernen.
- **Händler-Ausbau:** wechselnde Tagesangebote.
- **Website-Profil:** Bestiarium und Auftrags-Statistik im öffentlichen Spielerprofil zeigen.
- **Kleine Plüschtier-Chance in der Wochentruhe.**
- **Chronik-Fortschritt in der eigenen Minecraft-Mod** anzeigen.
- **Navigation:** 16 Tabs zu 4 Hauptbereichen mit Unterpunkten zusammenfassen.
- **Hinweis-Punkt am „Idle Dorf“-Knopf** der Website, wenn Belohnungen abholbar sind.

## 8. Rahmenbedingungen, die neue Ideen erfüllen müssen
- **Anti-Cheat auf dem Server:**
  - Der Kampf läuft im Browser.
  - Der Server begrenzt pro Speichervorgang die Kills pro Sekunde (max. 3), Level- und Skillpunkt-Zuwachs nach Zeit und absolute Kampfwerte.
  - Ideen dürfen deshalb nicht die Kill-Rate erhöhen und keine riesigen Sprünge ohne eigenen Serverweg erzeugen.
- **Kosten:**
  - Supabase-Realtime-Nachrichten und Vercel-Funktionsaufrufe pro Spieler kosten Geld; Dauer-Abfragen oder Dauer-Broadcasts pro Spieler sind zu vermeiden.
  - Einmalige Serveraktionen (z. B. beim Boss-Sieg) sind unproblematisch.
- **Neue Spielerdaten** gehören in die JSON-Tabelle `idle_player_meta`, nicht als neue Spalten in die große Spielstand-Tabelle.
- **Performance:**
  - keine Dauer-Animationen von Hintergrund-Position, Schatten oder Breite auf großen Flächen
  - keine Unschärfe-Filter auf Videos
  - nur `transform`/`opacity` animieren
- **Effektmodi „Hoch / Reduziert / Aus“** müssen respektiert werden. Spieler mit schwächeren Geräten dürfen keinen spielerischen Nachteil haben.
- **Es gibt schon 16 Tabs:** Neues sollte sich möglichst in bestehende Bereiche einfügen.
- **Zielgruppe:** deutschsprachige Minecraft-Spieler; Mischung aus Aktiv-Spielern, AFK-/Idle-Spielern und Streamern (OBS-Overlay).

## 9. Frage
Schlage auf Basis dieses Stands weitere Ideen vor, die die Langzeitmotivation erhöhen, das Spiel lebendiger machen und gut zu den vorhandenen Systemen passen. Bitte jeweils mit:
- kurzer Beschreibung
- warum es Spaß macht und welche Spielergruppe es anspricht
- wie es an bestehende Systeme andockt
- grober Aufwand (klein/mittel/groß)
- möglichen Risiken (Balance, Kosten, Anti-Cheat, Performance)

Sortiere nach Nutzen im Verhältnis zum Aufwand.
