# BKInvestment & Idle-Drachendorf – Master-Dokumentation

**Stand:** 03.10.2026 · **Code-Stand:** Branch `main`, letzter Commit `5eb419e` · **Erstellt für:** andere KI-Assistenten und Mitentwickler, die das Projekt vollständig verstehen sollen.

## Wie diese Dokumentation entstanden ist

- **Code:** Grundlage ist der komplette Code des Repositorys, also alle HTML-, CSS- und JavaScript-Dateien, die 17 Server-Funktionen unter `api/`, die rund 260 SQL-Dateien unter `sql/` sowie Konfiguration und Tests.
- **Live-Datenbank, nur lesend:** Stammdaten wurden mit dem öffentlichen Lese-Schlüssel abgefragt. Dazu gehören Konfiguration, Kampf-Drachen, Skilltree, Zucht-Arten, Skins, Plüschtiere, Bosse, Gilden-Technologie, Gildenlevel und die Changelog-Einträge.
- **Laufzeit-Export:** Alle Erfolge, Titel und Kosmetiken wurden zur Laufzeit aus dem tatsächlich ausgeführten Code exportiert. So fehlt nichts, was erst beim Laden dynamisch erzeugt wird.
- **Keine Vorschläge:** Die Dokumentation beschreibt nur den Ist-Zustand. Ideen und Verbesserungen sind bewusst nicht enthalten.

**Kennzeichnungen in diesem Dokument:**

| Kennzeichnung | Bedeutung |
|---|---|
| **[live]** | Wert stammt aus der Live-Datenbank, Stand 03.10.2026. |
| **[Code]** | Wert steht im Code (Konstante oder Formel). |
| **[unklar]** | Im Code vorhanden, genaue Verwendung oder Live-Status unklar. |
| **[nicht gefunden]** | Keine Implementierung gefunden. |

> **Wichtiger Grundsatz des Projekts:** Viele Werte stehen doppelt: in einer SQL-Datei (Absicht) **und** in der Live-Datenbank (Realität). Die SQL-Dateien sind nicht automatisch alle ausgeführt. Wo es darauf ankommt, nennt dieses Dokument den Live-Wert.

---

## Zahlen auf einen Blick

| Bereich | Anzahl |
|---|---|
| Website-Hauptbereiche (Tabs) | 10 |
| Idle-Dorf-Tabs | 17 (neu: Dorfentwicklung, Abschnitt 21) |
| Admin-Panel-Seiten | 26 |
| Feste Overlays/Fenster in `index.html` | 41, dazu dynamisch erzeugte Fenster |
| Erfolge | 431, dazu 1 Streamer-Erfolg pro eingetragenem Creator |
| Website-Titel | 112 |
| Idle-Dorf-Titel | 175, davon 150 mit Dauerbonus |
| Website-Namensrahmen | 55 |
| Idle-Kosmetiken (Namensfarben) | 28 |
| Kampf-Drachen | 12 [live] |
| Zucht-Drachenarten | 25 [live], dazu 20 normale + 2 Event-Arten vorbereitet (Abschnitt 21.1) |
| Dorf-Skins | 18 [live], davon 1 inaktiv |
| Plüschtiere | 26 [live] |
| Skilltree-Knoten | 50 [live], davon 1 inaktiv |
| Prestige-Knoten | 52 [Code] |
| Gilden-Technologie-Knoten | 23 [live] |
| Upgrades | 9 normale Upgrades, 8 Produktionsgebäude |
| Datenbank-Tabellen | ca. 99, dazu 2 Views |
| SQL-Funktionen / RPCs | 102 |
| SQL-Dateien | ca. 260 |
| Spiellogik-Funktionen | 796 in `idledorf.js` + `js/systems` + `js/ui` + Kern |
| Website-Funktionen | 304 in `bkmp-site.js` |
| Datenbank-Wrapper | 356 in `supabase.js` |
| Playwright-Testdateien | 74, mit 628 `test(...)`-Aufrufen |
| Letzter voller Testlauf | 04.10.2026 (nach dem Drachendorf-Ausbau): 1.477 bestanden, 494 übersprungen, 0 Fehler – ausgeführte Testfälle über 3 Geräteprofile |

---

## Inhaltsverzeichnis

- **1.** Grundaufbau des Projekts
- **2.** Komplettes Idle-Drachendorf – alle gefundenen Systeme
- **3.** Spielsysteme im Detail
- **4.** Alle Ressourcen und Währungen
- **5.** Alle Drachen-Systeme
- **6.** Upgrades, Skills und Fortschrittsbäume
- **7.** Gilden
- **8.** Herausforderungen
- **9.** Erfolge und Titel
- **10.** Chronik des Drachendorfs (03.10.2026)
- **11.** Offline-System
- **12.** Anti-Cheat und Server-Sicherheit
- **13.** Datenbank
- **14.** Speicherung
- **15.** UI und Navigation
- **16.** Performance
- **17.** OBS / Streaming / App
- **18.** Tests
- **19.** Unbenutzter, alter oder unfertiger Code
- **20.** Implementiert vs. nur geplant
- **21.** Drachendorf-Ausbau (04.10.2026): Navigation, Dorfentwicklung, Expeditionen, Eigenschaften/Bindung, Dorfpfad, Gildenprojekte, Event-Framework, Zwielicht-Pass, Lightnix/Darknix, Göttliche Erweckung, kleine Wochenereignisse
- **A.** Systemübersicht (System → Unterfunktionen → wichtigste Abhängigkeiten)
- **B.** Vollständige Feature-Liste (Checkliste)
- **C.** Vergessene oder versteckte Systeme
- **D.** Technische Risiken
- **E.** Projektgröße (geschätzt anhand des Codes)
- **Anhänge**
  - Anhang A1 – Alle Erfolge (431, zur Laufzeit exportiert)
  - Anhang A2 – Website-Titel (112 eigene; die Website-Titelliste enthält zusätzlich alle 175 Idle-Dorf-Titel aus Anhang A3)
  - Anhang A3 – Idle-Dorf-Titel (175, davon 150 mit Dauerbonus)
  - Anhang A4 – Website-Namensrahmen / Kosmetik (55)
  - Anhang A5 – Idle-Dorf-Kosmetik (Namensfarben, 28)
  - Anhang A6 – Skilltree-Knoten (Live-Datenbank, 50)
  - Anhang A7 – Kampf-Drachen (Live-Tabelle `idle_dragons`)
  - Anhang A8 – Zucht-Drachenarten (Live-Tabelle `dragon_species`, 25)
  - Anhang A9 – Dorf-Skins (Live-Tabelle `idle_village_skins`)
  - Anhang A10 – Plüschtiere (Live-Tabelle `plushies`, 26)
  - Anhang A11 – Gilden-Technologie-Knoten (Live-Tabelle `guild_tech_nodes`)
  - Anhang A12 – Gildenlevel-Schwellen (Live-Tabelle `guild_level_thresholds`)

---

# 1. Grundaufbau des Projekts

## 1.1 Was BKInvestment ist

BKInvestment („BKMP“, Domain **bkinvestment.de**) ist die Website eines Minecraft-Projekts auf dem Server **OPSUCHT**. Sie hat zwei Gesichter:

1. **Öffentliche Projekt-/Investoren-/Marktplatz-Seite:**
   - Einnahmen und Ausgaben, Investoren, News, Kartenideen, Kartendatenbank, Kartenverkauf, PartnerShops, Kartenfirmen, Bestenliste
   - Spielerkonten mit Erfolgen, Titeln, Kosmetik und Plüschtieren
   - Feedback und öffentliches Status-Board
   - viele Easter Eggs
2. **Das Browser-Idle-Spiel „Idle Drachen Dorf“:** läuft als großes Fenster (Overlay) über der Website, als eigene App-Adresse `/app` und als OBS-Stream-Overlay `idle-stream-mini.html`.

Der Betreiber ist nicht technisch. Der Code wird mit KI-Assistenten geschrieben, Commits und Deploys macht der Betreiber selbst.

## 1.2 Bereiche der Website (10 Tabs in `index.html`)

| # | Tab | Inhalt |
|---|---|---|
| 0 | **Hauptseite** | Umsatz-Dashboard: Einnahmen, Ausgaben, Netto, Sparklines, KPI-Zeile, Kategorien-Donut, Umsatz-Chart, Verkaufsstatistik, Monatsprognose, SW-Besucherstatistik (`/sw bk`, 6 CityBuilds), alle Einträge |
| 1 | **Investoren** | KPI-Zeile, Spotlight-Investor, aktive/abgeschlossene Investoren mit Laufzeitbalken, ROI, Auszahlungsbeweis-Foto, Timeline, Investor-Anfrage-Formular, „Auszahlung beantragen“-Prank (Bürokratie-Easter-Egg mit über 70 Captchas) |
| 2 | **Was gibt's Neues?** | News (`updates`) mit Ungelesen-Punkt am Tab |
| 3 | **Kartenideen** | Wünsche/Ideen einreichen und abstimmen (`wishes`, `wish_votes`) |
| 4 | **Wer sind wir?** | Textblöcke (`about_blocks`) und Creator-Liste mit Twitch-Live-Status |
| 5 | **PartnerShops** | Shop-Verzeichnis mit Hero, Suche, Kategorien, Shop-Einreichung, Revisionen, Standorte, Meldungen, Besuchs-Tracking und Trending; globaler „Shop im Spotlight“ im Banner |
| 6 | **Karten Verkaufen** | Kartenverkauf mit Besitzerkonto, KPI, 30-Tage-Chart, „Deine Verkäufe“-Dashboard und Auszahlungsanfrage (135.000 $ an den Verkäufer pro Karte) |
| 7 | **Kartendatenbank** | Katalog aller Karten mit Detailansicht, Suche, „Beliebteste Karten“ (Teleport-Tracking) und Einreichung |
| 8 | **Bestenliste** | Website-Bestenliste (Erfolge, Karten, Kartenideen, Zeit, Bonks) mit Spielerprofil |
| 9 | **Kartenfirmen** | Verzeichnis von Mapart-Firmen (`companies`), Bewerbung → Admin-Freigabe (`mapart.js`) |

**Globale Elemente auf jeder Seite:**
- Header-Banner mit „Shop im Spotlight“ (rotierender PartnerShop) und **„Shardhändler · Heute“**: OPSUCHT-Kurse über `/api/opsucht/merchant` und `/api/opsucht/market` mit Shard-Rechner als schwebendem Popover.
- Login-Knopf mit Spielerprofil (Minecraft-Name)
- Knöpfe für Erfolge, Feedback, Status-Board und Changelog (mit Ungelesen-Punkt)
- Umfrage-Banner (`polls`)
- Schaf-Sprechblase (täglich ab 12 Uhr ein Zitat, Text aus `site_flags.sheep_speech_text`)
- „Idle Dorf“-Knopf
- Knopf „OPBK-Kartendatenbank-Mod verbinden“

**Admin-Panel `admin.html` (26 Seiten):**

| Gruppe | Seiten |
|---|---|
| Übersicht und Inhalte | Übersicht, Besucher, News, Investoren, Investor-Anfragen, Kartenideen, Creator, „Wer sind wir?“, PartnerShops, Kartenverkäufe, Karten-Einreichungen, Kartendatenbank, Plüschtiere (mit Code-Generator auch für Dorf-Skins), Umfragen, Kartenfirmen, Feedback (inkl. öffentliches Board), Changelog |
| Finanzen und Personal | Einnahmen, Ausgaben, SW-Besucher, Mitarbeiter-Lohn (mit Auszahlungen) |
| Idle-Dorf | Wartungsmodus, Kampf-Drachen bearbeiten, Skilltree-Knoten bearbeiten, Passwort zurücksetzen |
| Spieler und Zugänge | Spieler-Verwaltung (inkl. Anti-Cheat-Alarme und manuelles Ausblenden aus der Bestenliste), Admin-Zugänge, Backup (Export/Import/Bilder optimieren) |
| Sonderrollen | „Schaf-Editor“ (Rolle `sheep_editor`), Mitarbeiter-Rolle `expenses_editor` (nur Ausgaben, SW-Besucher und Mitarbeiter-Lohn) |

## 1.3 Wie das Idle-Drachendorf eingebunden ist

- **Overlay:** Das Spiel ist kein eigenes Programm, sondern ein großes Overlay `#idleDorfOverlay` **innerhalb** von `index.html`. Es wird über den „Idle Dorf“-Knopf geöffnet; dafür muss ein Spieler angemeldet sein.
- **Eine Codebasis:** Website und Spiel teilen dieselbe Seite, dieselbe Datenbank und dasselbe Spielerkonto.
- **App-Adresse:** `/app` → `app.html` leitet per `location.replace('/?app=idledorf')` auf dieselbe Seite um und schaltet den **App-Modus** ein (Vollbild, kompakte Navigation).
- **PWA und Android:** Installation über `idledorf.webmanifest` (`start_url: /app`) und `sw.js` (reiner Durchleitungs-Service-Worker ohne Cache). `.well-known/assetlinks.json` enthält das Android-Paket **`de.bkinvestment.idledorf`** (Trusted Web Activity, also eine Play-Store-Verpackung); ob die Android-App veröffentlicht ist, ist **[unklar]**.
- **OBS-Overlay:** `idle-stream-mini.html` ist eine eigenständige Seite. Sie zeigt den Kampf des eigenen Kontos live für Streamer an (siehe Kap. 17).
- **Im Spiel genutzte Website-Funktionen:** Erfolge, Titel und Kosmetik sind **seitenweit**: Erfolge aus dem Spiel erscheinen im Website-Erfolgsfenster, Titel und Namensfarben auch auf der Website.

## 1.4 Verwendete Technologien

| Bereich | Technik |
|---|---|
| Frontend | Statisches HTML/CSS/JavaScript, **kein Build-Schritt, kein Bundler, keine ES-Module**. Klassische `<script>`-Dateien mit globalen Funktionen (Präfix `bkmp…`), feste Ladereihenfolge. |
| Design | `style.css` (~16.500 Zeilen) + `design-tokens.css` (Farb-/Abstands-Tokens, Stimmungen `.zone-site`/`.zone-game`) + `css/bkmp-chronicle.css` + `css/jakes-feldfahrt.css` |
| Datenbank-Client | `assets/vendor/supabase-js.min.js` (Supabase JS SDK, lokal mitgeliefert) |
| Backend | **Supabase**: Postgres, Auth, Row Level Security, RPC-Funktionen (`security definer`), Storage-Bucket für Bilder, Realtime |
| Server-Funktionen | **Vercel Serverless Functions** in `api/*.js` (Node, rohe `fetch`-Aufrufe gegen Supabase-REST, teils mit Service-Role-Key) |
| Hosting | **Vercel**, `vercel.json`: Cache-Header (HTML no-store; JS/CSS 1 Jahr immutable → Cache-Busting über `?v=`) |
| Zahlungen | **Stripe** (`api/create-checkout-session.js`, `api/stripe-webhook.js`), im Spiel aber per Schalter **deaktiviert** (`BKMP_REAL_MONEY_PURCHASES_ENABLED = false`) |
| Externe APIs | Twitch-Live-Status (`api/twitch-live.js`), OPSUCHT-Händler/Marktpreise (`api/opsucht/*`), Minecraft-Avatare (`minotar.net`) |
| Tests | Playwright (`@playwright/test`) mit eigenem lokalen **Mock-Backend** (`tests/mock/*`), ESLint, eigene statische Prüfungen (`scripts/static-checks.js`) |
| Werkzeuge | `scripts/optimize-images.*` (WebP mit `sharp`), `scripts/balance-sim/*` (Balance-Simulationen), `tools/asset-generator` (Python, Bildgenerierung per OpenAI-API, nur lokal) |

## 1.5 Hosting, Datenbank, Authentifizierung, Speicherung

- **Hosting:** Vercel. Seiten und JS-Dateien werden statisch ausgeliefert. Jede Änderung an JS/CSS braucht einen neuen `?v=`-Parameter an allen Einbindungsstellen.
- **Datenbank:** ein einziges Supabase-Projekt für Live und lokal; es gibt kein Staging.
- **Authentifizierung:** zwei getrennte Kontenarten im selben Supabase-Auth:
  - **Spielerkonten:** Anmeldung mit Minecraft-Name + Passwort. Intern wird daraus eine Fake-E-Mail `<name>@bkmp-player-accounts.com`; es gibt kein echtes Postfach. Ein vergessenes Passwort kann deshalb nur ein Admin neu setzen (`api/admin-reset-player-password.js`).
  - **Admin-Konten:** `<name>@bkmp-admin-accounts.com`, Prüfung über `admin_profiles` und `is_active_admin()`.
  - Zusätzliche Rollen: `expenses_editor` (Mitarbeiter), `sheep_editor`.
  - **Eine Sitzung pro Konto:** Ein neuer Login schreibt ein frisches `active_session_token` in die Zeile `player_stats` (`claimActiveSession`). Andere Geräte prüfen das regelmäßig und werden mit „Sitzung anderswo übernommen“ abgemeldet. Die RPC `claim_player_row` ist etwas anderes: Sie ordnet alte, namensbasierte Zeilen aus der Zeit vor dem Kontensystem dem eingeloggten Konto zu.
  - Namensänderung über RPC `rename_player_account`, Namens-Sperrliste über `blocked_display_names`, Konto selbst löschen über `delete_own_player_account` mit Countdown.
- **Speicherung:** Spielstand in Supabase-Tabellen (Details Kap. 13/14). `localStorage` dient für Komfort-Einstellungen, Caches, Fallbacks und einige rein lokale Zähler (Details Kap. 14).

## 1.6 Wichtige Dateien und Ordner

| Datei/Ordner | Rolle |
|---|---|
| `index.html` | Öffentliche Seite **und** komplettes Idle-Dorf-Markup, alle Overlays |
| `admin.html` | Admin-Panel (~7.000 Zeilen inkl. Inline-Skript) |
| `idle-stream-mini.html` | OBS-Overlay |
| `app.html` | Weiterleitung `/app` → App-Modus |
| `datenschutz.html`, `impressum.html` | Rechtstexte |
| `asset-preview.html`, `asset-manifest.json` | Vorschau für generierte Bilder (Entwicklungswerkzeug) |
| `app.js` | Gemeinsame Helfer (`escapeHtml`, Formatierung), Datenmodell `data`, Plüschtier-Liste, Akzentfarbe, Berechnungs-Helfer der Umsatzseite |
| `supabase.js` | **Alle** Datenbank-Aufrufe (356 Funktionen) |
| `idledorf.js` | Spiel-Kern: Kampf-Tick, Laden/Speichern, Upgrades, Gebäude, Effektmodus, Tabs, Offline-Karte, Titel-/Erfolgsdefinitionen |
| `js/core/bkmp-idle-state.js` | Alle gemeinsamen Spielvariablen; wird **immer zuerst** geladen |
| `js/core/bkmp-combat-math.js` | Reine Formeln: EP-Kurve, Gegner-Auswahl, Schaden, Belohnung, Upgrade-Kosten |
| `js/core/bkmp-idle-bootstrap.js` | Nur der Aufruf `bkmpIdleInit();`, wird **zuletzt** geladen |
| `js/core/bkmp-site.js` | Die komplette öffentliche Website (8.400 Zeilen) |
| `js/core/bkmp-app-mode-bootstrap.js` | App-Modus und mobile Tab-Überlauf-Logik |
| `js/core/bkmp-game-clock.js` | Spielzeit-Abstraktion; im QA-Modus vorspulbar |
| `js/systems/*.js` | Ein Modul pro Spielsystem: `arena`, `breeding`, `chronicle`, `cosmetics`, `dungeon`, `events`, `guild`, `guild-tech`, `leaderboard`, `meister`, `prestige`, `raid`, `runes`, `skilltree`, `tower`, `achievements` |
| `js/ui/*.js` | HUD/Kampfdarstellung, wiederverwendbare UI-Bausteine, Belohnungs-Präsentation, Feedback-Board, Changelog |
| `js/prototype/bkmp-proto-compact-hud.js` | Kompakte Mobil-Navigation („Prototyp 2“, produktiv aktiv) |
| `js/dev/*.js` | QA-Kontrollfenster und Performance-Messung; nur im lokalen QA-Modus aktiv |
| `js/easter-eggs/*.js` | Minispiel „Jake's Feldfahrt“ und „Auszahlungs-Bürokratie“-Prank |
| `mapart.js` | Kartenfirmen |
| `api/*.js` | 17 Server-Funktionen (siehe 1.7) |
| `sql/*.sql` | Alle Datenbank-Migrationen. Ab Juli 2026 sind neue Dateien mit Datum benannt (`YYYYMMDD-…`), ältere heißen `supabase-…`. Daneben `scratch-…`-Einmalskripte. |
| `tests/` | Playwright-Tests, Mock-Backend, Testdaten (Teststände A–G), `FEATURE_MATRIX.md` |
| `scripts/` | QA-Server, statische Prüfungen, Bildoptimierung, Balance-Simulationen, PowerShell-Hilfen zum Zuschneiden von Sprites |
| `CLAUDE.md`, `CHANGELOG.md`, `IDLE_DORF_WEITERENTWICKLUNG.md`, `PROGRESSION_REBALANCE_PHASE1.md` | Projekt-Dokumentation |
| `backups-local/` | Lokale Sicherungskopien früherer Experimente; per `.gitignore` ausgeschlossen, nicht deployt |

## 1.7 Server-Funktionen (`api/`)

| Endpunkt | Zweck |
|---|---|
| `claim-idle-offline-progress` | **Offline-/AFK-Belohnung**, komplett serverseitig berechnet (Kap. 11) |
| `submit-entry` | Server-seitiges Einreichen von Formularen (Feedback, Wünsche, Kartenverkauf-Anfragen …) mit Service-Role-Key; setzt bei Kartenverkauf das Konto aus dem geprüften Spieler-Token |
| `redeem-plushie-code` | Einlösen von Plüschtier- **und** Dorf-Skin-Codes (fälschungssicher, serverseitig) |
| `scan-plushie-folder` | Liest den Ordner `assets/plushies/` für den Admin |
| `create-checkout-session` / `stripe-webhook` | Stripe-Echtgeldkauf (Dorf-Skin „Steampunk Dorf“, 1,99 €), Freischaltung nur über den Webhook |
| `admin-reset-player-password` | Admin setzt Spielerpasswort neu |
| `twitch-live` | Live-Status der Creator (Edge-Cache 45 s) |
| `opsucht/merchant`, `opsucht/market` | Proxy zu `api.opsucht.net` für Shardhändler-Kurse und Marktpreise |
| `cards`, `card-image`, `card-teleport-stats` | Read-only-API der Kartendatenbank für die **BK-Mod** (Minecraft), Bild-Proxy im Minecraft-tauglichen Format, Teleport-Statistik |
| `card-submission-image` | Bild-Upload für Karteneinreichungen aus der Mod |
| `partner-shops`, `partner-shop-image`, `partner-shop-submission-image` | Dasselbe für PartnerShops (Mod-Update „OPBK 1.1“) |

## 1.8 Wie Frontend und Backend kommunizieren

1. **Direkt aus dem Browser:** Die meisten Lese- und Schreibzugriffe laufen mit dem Supabase-JS-Client und dem öffentlichen Anon-Key (bzw. dem Spieler-Token nach Login) direkt gegen die REST-API. Die Datenbank schützt sich über **Row Level Security** (z. B. „nur eigene Zeile schreiben“).
2. **RPC-Funktionen:** Alles mit Wettbewerbs-, Mehrspieler- oder Missbrauchsrisiko läuft über Postgres-Funktionen mit `security definer`. Sie lesen die Identität selbst über `auth.uid()` und führen Prüfungen und Sperren intern durch. Beispiele: Arena, Gilden, Raids, Dungeon-Schlüssel, Kartenverkauf.
3. **Vercel-Funktionen:** wenn ein Geheimnis gebraucht wird (Service-Role-Key, Stripe, Twitch, OPSUCHT) oder Bilder umgewandelt werden müssen.
4. **Realtime (Supabase):**
   - Die Website abonniert Datenänderungen, damit Zahlen live aktualisiert werden (`initSupabaseRealtime`).
   - Der Kampf wird zum OBS-Overlay gesendet, und zwar **nur, wenn ein Overlay-Zuschauer verbunden ist** (Presence-gesteuert, Kostenschutz).
5. **Polling:** Raid-Boss (1,5 s), Raid-Teilnehmer (3 s), Gilden-Präsenz-Heartbeat (25 s), Wartungsmodus-Flag, Twitch-Status, Shardhändler-Kurse (60 s).

## 1.9 Welche Systeme serverseitig abgesichert sind

| Vollständig serverseitig berechnet | Vom Client berechnet, aber serverseitig begrenzt oder geprüft |
|---|---|
| Offline-/AFK-Belohnung | Kampf, Gold/EP/Ressourcen, Level, Skillpunkte. Ein Postgres-Trigger kappt unplausible Sprünge pro Speichervorgang (Kap. 12). |
| Arena-Kampf, Rating und Gold | Upgrades, Runen, Drachenzucht-Würfe, Prestige-Baum. Hier gilt nur RLS „eigene Zeile“, keine Plausibilitätsprüfung. |
| Gilden: Gründung, Beitritt, Rollen, Kasse, Technologie-Beiträge, Plätze, Quests, Chat, Gilden-Arena |  |
| Weltboss: Beitritt, Schaden, Gegenangriff, Ende und Belohnung |  |
| Gildenboss: Beitritt, Schaden, Ende und Belohnung |  |
| Dungeon-Schlüssel, Freischaltungen, Tagesbonus |  |
| Plüschtier-/Skin-Codes, Echtgeldkäufe |  |
| Event-Drachen-Sieg (einmalig) |  |
| Kartenverkauf: Verkäufe, Auszahlungen |  |
| Mod-Verknüpfung (Token-Hash) |  |

---

# 2. Komplettes Idle-Drachendorf – alle gefundenen Systeme

Liste aller Spielsysteme und Mechaniken, die im Code aktiv sind. Die mit ★ markierten Einträge standen **nicht** in der Aufzählung des Auftrags und wurden beim Durchsuchen zusätzlich gefunden.

**Kampf und Gegner**

| System | Gefundene Teile |
|---|---|
| Kampf | Auto-Kampf (Tick), Gegenangriff des Drachen, Niederlage/Rückstufung, ★ Doppelschlag, ★ Brand (Feuer), ★ Blitzschlag, ★ Eis (setzt den Gegenangriff aus), ★ Magieresistenz, ★ Dorf-Regeneration, ★ Rüstungsbrecher |
| Klick-Kampf | Klick-Schaden, Autoklicker-Schutz (Muster-Erkennung + Sofortsperre + Ratenbegrenzung) |
| Gegner/Stufen | 12 Kampf-Drachen, Standard/Selten/Miniboss/Boss/Event, Stufenleiste mit „Automatisch/Bleibt hier“, ★ „Beste Stufe“-Sprung, ★ Stufenwahl-Fenster nach Akten, ★ Boss-/Status-Banner |
| Event-Gegner | Shenloss, Ganz Liber Drache (einmalig je Spieler, 0,1 %) |
| ★ Fundschatz | Seltener Gold-/Kristall-Fund bei Kampf-Drachen (früherer Ei-Drop) |

**Fortschritt**

| System | Gefundene Teile |
|---|---|
| Spielerlevel | EP-Kurve, Skillpunkte, ★ Level-Meilenstein-Bonus alle 10 Level |
| Upgrades | 9 Upgrades, Softcaps, ★ Upgrade-Meilensteine, Auto-Kauf, ★ Auto-Kauf-Ressourcenfilter |
| Skilltree | 6 aktive Zweige (Dorf, Burg, Wirtschaft, Forschung, Magie, Zucht), ★ Zweig „Meister“ (Zwerg Grimbold, nur im Code, siehe Kap. 19), Reset mit 24-h-Abklingzeit |
| Prestige | Prestige-Stufen, Prestige-Baum mit 52 Knoten in 6 Zweigen, ★ Prestige-Meilensteine, Paragon, Aufstieg/Drachenseelen, ★ Automatisierungs-Knoten, ★ automatische Punkteverteilung mit Zweig-Priorität, ★ Prestige-Zeremonie |

**Wirtschaft**

| System | Gefundene Teile |
|---|---|
| Ressourcen | Gold, Holz, Stein, Kristalle, Essenz, Frucht, Fleisch, EP; Spalte `mana` vorhanden, aber ungenutzt |
| Produktionsgebäude | 6 Gebäude + Obstgarten/Jagdhütte, Offline-Aufholung, ★ Gebäude-Überladung |
| Booster | Goldrausch, Wissensschub (je +25 %) |

**Sammlung und Kosmetik**

| System | Gefundene Teile |
|---|---|
| Runen | 6 Slots, 5 Seltenheiten, Aufwerten, ★ Sofort-Aufwerten, Zusatzwerte (Substats), ★ Substat neu würfeln, Verschmelzen, Aufstieg +16…+30, Verkaufen, ★ Runenlager-Seitenleiste, ★ Ausrüstungsset-Speicher, ★ 3 Hintergrund-Automatiken, ★ „Auf +15 maximieren“ |
| Drachenzucht | 25 Arten, 5 Nester, Brut, Opfergabe, Füttern, Jugendlich/Kampf-EP, Erwachsen-Würfe, bis 3 Begleiter + Trainingsplatz, Drachen-Aufstieg, Lager, Favoriten, ★ Umbenennen, Freilassen, Drachen-Dex, ★ Lexikon |
| Dorf-Skins und Kosmetik | Dorf-Skins (Kauf/Erfolg/Boss-Drop/Code/Echtgeld), Vorschau, Titel mit Boni, Namensfarben, Website-Namensrahmen, Plüschtiere |
| Erfolge/Titel | 431 Erfolge (seitenweit), 112 Website- + 175 Idle-Titel |

**Herausforderungen und Mehrspieler**

| System | Gefundene Teile |
|---|---|
| Dungeons | 7 Typen × 4 Schwierigkeiten, Schlüssel (feste Uhrzeiten), Tagesbonus, ★ Wochen-Dungeon (+50 %), Auto-Läufe, ★ persönliche Bestzeiten, ★ Dungeon-Bestenliste |
| Turm | Endloser Turm, 1 Versuch pro Tag, Meilenstein-Belohnungen, Rekord |
| Arena | Spieler gegen Spieler, ELO, Tageslimit, Abklingzeit pro Ziel, ★ angezeigte Gewinnchance, ★ Kampfanimation |
| Weltboss (Raid) | Stündlich, Vorbereitungsphase, Auto-Kampf + Klick, Gegenangriffe auf die Stadt, Belohnung, Plüschtier-Codes, ★ Auto-Beitritt, ★ Raid-Statistiken |
| Gilden | Gründen, Beitreten, Einladungscode, Beitrittsanfragen, Rollen, Kasse, ★ Kassenstand-Bonus, Gildenlevel 1–100, Technologie-Baum (Mitgliederbeiträge), Plätze kaufen, Gildenboss, Tagesquests, Chat, ★ Banner, ★ Gildenziel, ★ Aktivitätslog, ★ Online-Anzeige, Gilden-Arena, Gilden-Bestenliste |

**Chronik, Rückkehr und Statistik**

| System | Gefundene Teile |
|---|---|
| Chronik | Tagesaufträge, Wochenziele, Truhen, Neuwürfeln, Login-Kalender, Bestiarium, Weltereignisse, Ziele-Übersicht |
| Offline | Server-Formel bis 12 h (+ Nachtwache), Offline-Karte, Begleiter-EP offline, ★ OBS-Hintergrund-Nachholen |
| Ranglisten | 12 Idle-Ranglisten, Raid-/Dungeon-/Turm-Listen, Gilden-Bestenliste, Website-Bestenliste |
| ★ Statistik | Kampfstatistik der Sitzung (Schaden, Treffer, Krits, DPS) in der rechten Kampfspalte; Belohnungsvorschau |

**Technik und Bedienung**

| System | Gefundene Teile |
|---|---|
| ★ Wartungsmodus | Admin-Schalter sperrt das Spiel mit Nachricht |
| ★ Effektmodus | Hoch/Reduziert/Aus + 7 Einzelschalter |
| ★ Kampf-Log | Log-Fenster, Filter „nur legendäre Runenfunde“, mobiles Log-Fenster |
| ★ Belohnungs-Präsentation | Toast, Karte, Zeremonie, Warteschlange und Dubletten-Schutz |
| ★ Test-Konto-Sperrmechanismus | Mechanismus für gesperrte Tabs (Testkonto `test123`); aktuell **kein** Tab gesperrt |
| ★ QA-Modus | Lokales Testsystem mit Kontrollfenster, Teststände A–G und Spielzeit-Vorspulen |

---

# 3. Spielsysteme im Detail

Kapitel 3 beschreibt Kampf, Gegner, Level, Gebäude, Runen, Kosmetik, Ranglisten und Hilfssysteme. Eigene Kapitel haben: Drachen (5), Upgrades/Skills/Prestige (6), Gilden (7), Dungeon/Turm/Arena/Weltboss (8), Erfolge (9), Chronik (10), Offline (11).

## 3.1 Kampfwerte – wie die Stärke des Dorfs entsteht

**Basiswerte** [live, `idle_game_config.base_stats`]:

| Wert | Basis |
|---|---|
| Angriff | 10 |
| Verteidigung | 2 |
| Leben | 100 |
| Krit-Chance | 5 % |
| Krit-Schaden | 150 % |
| Gold-/EP-/Beute-Bonus | 0 |

**Bonus-Quellen:** Alle Boni landen in **einem gemeinsamen Effekt-Topf**, der in `bkmpIdleRecomputeEffectiveStats()` (idledorf.js) aus diesen Quellen summiert wird:
- Skilltree, normale Upgrades, Upgrade-Meilensteine
- Idle-Titel (alle freigeschalteten addieren sich)
- Prestige-Baum, Prestige-Meilensteine, Aufstieg/Drachenseelen
- ausgerüstete Runen (Hauptwert + Substats)
- Begleitdrachen (gewichtet 100/50/25 %)
- Bestiarium
- Gilden-Technologie + Kassenstand-Bonus (+ Turm-Vorreiter, Willkommenspaket)
- **pro Prestige-Stufe +5 %** auf Angriff, Leben, Gold, EP (und Produktionsgebäude)

**Endwerte und Deckel** [Code]:

| Wert | Formel / Deckel |
|---|---|
| Angriff | `(10 + feste Boni + Ballisten×8) × (1 + Prozent/100)`; Prozent-Topf **max. 2000 %** (enthält „Mehr Bogenschützen“ ×6, Prestige-Stufe, Gilde) |
| Verteidigung | `(2 + feste Boni) × (1 + Prozent/100)`, Prozent **max. 2000 %** |
| Leben | `(100 + feste Boni) × (1 + Prozent/100)`, Prozent ohne eigenen Deckel |
| Krit-Chance | **max. 75 %** |
| Krit-Schaden | 150 % + Boni, Boni **max. +900 %** |
| Gold-Bonus | **max. 2000 %** |
| EP-Bonus | **max. 2000 %** |
| Beute-Bonus | **max. 1500 %** |
| Magieresistenz | max. 75 % |
| Feuer-/Eis-/Blitz-Chance | je max. 60 % |
| Kampftakt | `max(400 ms, 900 ms / (1 + Angriffstempo/100))`. **400 ms ist der harte Boden**, darauf baut der Anti-Cheat auf. |
| Dorf-Regeneration/Tick | `Schildgenerator×0,4 + Reparaturtempo×0,3 + Heilung×0,3 (+ Passive Bindung)` in % der Max-Leben |
| Bossschaden | Gilden-Tech + `boss_dmg_pct`; wirkt **nur** gegen Weltboss und Gildenboss |
| Runenglück | Runen + Skill „Runenglück“ + Gilden-Tech |

Die berechneten Werte werden zusätzlich in `idle_player_state` gespiegelt (Spalten `attack`, `defense`, `hp`, `crit_*`, `gold_bonus`, `xp_bonus`, `loot_bonus`). Das nutzen die Arena, die Raids, die Offline-Formel und die Gegner-Anzeige anderer Spieler.

## 3.2 Kampf (Auto-Kampf) – `bkmpIdleTick()` [Code]

**Was pro Tick (alle 400–900 ms) passiert:**
1. Spielzeit `playtime_seconds` wird um die Taktlänge erhöht.
2. Auto-Kauf, Automatisierungen (alle 10 s), Chronik-Zähler (alle 4 s) und Weltereignis-Prüfung laufen.
3. Dorf-Regeneration.
4. **Schuss des Dorfs:**
   - Schaden = Angriff × (Krit ? Krit-Schaden/100 : 1) − Drachen-Verteidigung × 0,5, mindestens 1.
   - Verteidigung des Drachen reduziert durch „Rüstungsbrecher“, max. 90 %.
   - Im Dungeon und Turm zusätzlich „Überwältigung“ (+3 % pro Rang).
   - Während „Kampfrausch“ (Weltereignis) +50 % Schaden.
5. **Doppelschlag** (Prestige): Chance (max. 75 %) auf einen zweiten vollen Treffer.
6. **Brand:** Chance → 4 Ticks je 18 % Angriff.
7. **Blitzschlag:** Chance → einmalig 60 % Angriff.
8. Drache tot → Sieg-Ablauf (3.4). Sonst **Gegenangriff** (3.3).
9. Kampfzustand an das OBS-Overlay senden (max. alle 3 s, nur wenn ein Zuschauer verbunden ist).

**Wann es läuft:** Der Kampf läuft auch bei geschlossenem Fenster weiter, solange die Seite offen ist. Die **Optik** (Projektile, Zahlen, Blitzeffekte) wird nur erzeugt, wenn das Fenster offen, der Kampf-Tab aktiv und der Browser-Tab sichtbar ist (`bkmpIdleCombatVisualsActive`). Bei verstecktem Browser-Tab bremst der Browser die Zeitgeber; das Nachholen erfolgt beim Zurückkehren über die Offline-Formel.

## 3.3 Gegenangriff und Niederlage [Code]

- **Takt:** Der Drache schlägt höchstens einmal pro Kampftakt zurück, auch nach Klicks.
- **Eis-Chance:** setzt den Gegenangriff komplett aus.
- **Schaden:** Drachen-Angriff (5 % Krit, 150 %) − Dorf-Verteidigung × 0,5, danach × (1 − Magieresistenz).
- **Dorf-Leben 0 → Niederlage:**
  - Stufe −1, Zähler `village_defeats` +1, Dorf voll geheilt, Banner „💀 Niederlage“.
  - Ab **15.000 Niederlagen** wird der Dorf-Skin „Zerstörtes Dorf“ freigeschaltet.
- **Nach jedem Sieg** wird das Dorf voll geheilt.

## 3.4 Sieg über einen Drachen [Code]

1. **Belohnung:** `bkmpIdleRewardsAt()` (siehe 3.7). Dazu kommen:
   - Booster (×1,25) und Weltereignis (×2)
   - Prestige-„Kristalladern“/„Essenzstrom“ (+3 %/Rang)
   - **„Schatzsucher“:** Chance (max. 75 %) auf komplett doppelte Beute
2. **Zähler:** `dragon_kills` +1, bei Boss oder Miniboss `boss_kills` +1, bei Yaksha-Boss `yaksha_boss_kills` +1. Ab 50.000 Yaksha-Siegen wird der Skin „Yakshas Heimat“ freigeschaltet.
3. **Würfe und Fortschritt:**
   - Runen-Wurf (Kap. 3.10) und Fundschatz-Wurf
   - Bestiarium-Eintrag
   - Begleiter-Kampf-EP (+4, Boss +25)
   - Gildenquest-Delta (Drachen, Gold)
4. **Stufe:** Bei „Automatisch“ +1 Stufe. Die Höchststufe `highest_dragon_index` wird aktualisiert.
5. **Danach:** EP gutschreiben (Level-Ups), Dorf voll heilen, Status-Banner („👑 Boss besiegt!“ bzw. „⬆️ Nächste Stufe“ beim Akt-Wechsel), Belohnungs-Zahlen fliegen hoch, nächster Drache, Autosave in 4 s.

## 3.5 Klick-Kampf und Autoklicker-Schutz [Code]

**Klick-Schaden:** `Angriff × (0,12 + Klickkraft%/100)`, mindestens 1. Klicks ziehen ebenfalls einen Gegenangriff nach sich (Abklingzeit beachtet) und zählen für den Chronik-Auftrag „Klicks“.

| Schutz | Regel |
|---|---|
| Ratenbegrenzung | Klicks schneller als **60 ms** werden verworfen (kein Schaden, keine Anzeige) |
| Sofortsperre | **20 Klick-Versuche in 1 s** → 10 Minuten Klicksperre |
| Muster-Erkennung | Mindestens 15 Klicks über **mindestens 60 s**, Durchschnittsabstand ≤ 260 ms und Variationskoeffizient < 0,12 (zu gleichmäßig) → **10 Minuten Sperre**. Kurzes „Hass-Klicken“ unter 60 s löst nie aus. |
| Speicherort | Sperrzeit und Klickverlauf liegen in `localStorage`. Das ist **rein clientseitig** und lässt sich umgehen. Der Server kappt Kills zusätzlich über den Anti-Cheat-Trigger (Kap. 12). |

Beim Weltboss gibt es denselben Schutz mit eigenen Speicher-Schlüsseln. Dort kann zusätzlich mit der **Leertaste** angegriffen werden.

## 3.6 Gegner, Stufen und Drachenauswahl [Code + live]

- **Stufennummer:** Stufe = `killIndex + 1`. Anzeige als „Akt-Stufe“ `X-Y` (`index/10`, `index%10`).
- **Auswahl pro Stufe** (`bkmpIdleSelectDragonKindId`), in dieser Reihenfolge:
  1. Jede **25. Stufe:** Boss (Regel `boss_25`; live: *Yaksha der Drachenboss*)
  2. Jede **10. Stufe** (sonst): Miniboss (Regel `miniboss_10`; live: *Aurelia Drache*)
  3. **Event-Drachen** (`event_easter`): pro Stufe und Drache **0,1 %**, deterministisch aus „Spielername | Stufe | Drache“ (ein Reload würfelt nicht neu); jeder Event-Drache nur, bis er einmal besiegt wurde.
  4. **Seltene Drachen** (`rare`): **8 %** [live `rare_spawn.chancePct`]; live: Schattendrache, Wuffdrache.
  5. Sonst zufällig einer der **Standard**-Drachen; live: Feuer-, Blitz-, Wasser-, Erd-, Wind-, Cyberdrache.
- **Stärke-Wachstum** (polynomiell statt exponentiell, damit hohe Stufen spielbar bleiben):

  | Größe | Formel | Live-Werte |
  |---|---|---|
  | Leben | `base_hp × (1 + 0,05·k)^1,15 × Mult.` | Boss-Mult. ×3,2, Miniboss ×1,8 |
  | Angriff | `base_attack × (1 + 0,045·k)^1,1 × Mult.` | Boss ×1,7, Miniboss ×1,3 |
  | Verteidigung | konstant `base_defense` | – |

- **Event-Drachen-Stärke:** Leben wird aus den **eigenen** aktuellen Werten berechnet (Ziel: ca. 45 s aktives Klicken, passiv mindestens 4× länger, mindestens 500), Angriff wie ein Boss.
- **Steuerung:**
  - Schalter „Automatisch/Bleibt hier“ (`auto_advance`)
  - „Beste Stufe“ springt auf die Höchststufe
  - **Stufenwahl-Fenster** nach Akten gruppiert, mit Direkteingabe; nur bis zur Höchststufe
- **Lebenszeit-Stufen:** `prestige_stage_offset + highest_dragon_index`. Sie sinken nie und sind für Runen-Seltenheiten, Aufstieg, Bestenliste und Chronik-Truhen relevant.

## 3.7 Belohnungen pro Sieg [Code + live]

- **Formel `bkmpIdleRewardsAt()`:**
  - Gold = `gold_reward_base × (1 + 0,05·k)^1,2 × Boss-Mult. × (1 + Gold-Bonus/100)`
  - EP analog mit EP-Bonus
  - **Boss-Belohnungs-Mult. ×4, Miniboss ×2** [live]
  - Holz/Stein/Kristalle/Essenz = Basiswert × (1 + Beute-Bonus/100). Holz/Stein zusätzlich × Holz-/Steinproduktion-Bonus. **Diese vier wachsen nicht mit der Stufe.**
- **Live-Basiswerte:** Standard-Drachen geben **keine** Kristalle und keine Essenz. Kristalle/Essenz kommen aus Selten (1/1), Miniboss (5/5), Boss (8/5) und Event (20/15). Komplette Tabelle in Anhang A7.
- **Level-Meilenstein:** Alle 10 Level gibt es `200 × (Level/10)` Gold + 2 Kristalle.

## 3.8 Spielerlevel und Erfahrung [live]

- **EP pro Level:** `round(40 × Level^1,42)`.
- **Skillpunkte:** jedes Level +1.
- **Kein Levelcap im Code.** Die frühere Datenbank-Grenze (`level <= 2000`) wurde per Migration auf 1.000.000 angehoben.
- **Weitere EP-Quellen:** Dungeon (EP-Dungeon), Turm, Magierakademie, Weltboss, Chronik, Login-Kalender, Offline.

## 3.9 Produktionsgebäude, Überladung, Booster [Code]

Alle Gebäude kosten Gold und produzieren zeitbasiert; dadurch funktioniert Offline-Produktion „automatisch“.

**Gemeinsame Formeln:**
- **Rate pro Stunde:** `baseRate × (1 + Level × rateCoef) × (1 + Prestige-Stufe × 5 %) × Überladung`
- **Kosten:** `baseCost × (1 + costRate·Level)^costExponent`, Rabatt „Effiziente Baukunst“ max. 40 %
- **Max. Level 150**
- **Aufhol-Obergrenze 72 h**, plus Prestige „Zeitdehnung“ +2 h pro Rang (max. +300 h)

| Gebäude | Ressource | Basiskosten | costRate/Exp. | Basisrate/Std. | rateCoef |
|---|---|---|---|---|---|
| Holzfällerlager | Holz | 800 | 0,25/2,0 | 60 | 0,5 |
| Steinbruch | Stein | 800 | 0,25/2,0 | 60 | 0,5 |
| Goldmine | Gold | 3.000 | 0,30/2,15 | 400 | 0,8 |
| Kristallmine | Kristalle | 6.000 | 0,32/2,2 | 3 | 0,4 |
| Manaquelle | **Essenz** (nicht Mana) | 10.000 | 0,34/2,25 | 4 | 0,4 |
| Magierakademie | EP | 5.000 | 0,30/2,15 | 50 | 0,5 |

**Obstgarten (Frucht) und Jagdhütte (Fleisch)** (Zucht-Wirtschaft):
- Rate: `60/Std. × (1 + 0,5·Level) × (1 + Boni)`
- Lagerdeckel: `2.000 + 500·Level`
- Max. Level 30
- Kosten: `2.000 × (1 + 0,28·Level)^2,1`

**Gebäude-Überladung** (Gold-Senke, nur `localStorage`, gilt für alle 6 Gebäude):

| Dauer | Basiskosten | Multiplikator |
|---|---|---|
| 1 h | 20.000 | ×2 |
| 4 h | 60.000 | ×2 |
| 12 h | 150.000 | ×2,5 |
| 24 h | 250.000 | ×3 |

Die Kosten verdoppeln sich pro Nutzung innerhalb der letzten 24 h.

**Booster „Goldrausch“/„Wissensschub“:**
- Wirkung: **+25 %** Gold bzw. EP, solange `boost_gold_until`/`boost_exp_until` in der Zukunft liegt (Zeitstempel in `idle_player_state`).
- Quellen: Dungeon-Booster-Chance, Login-Kalender (Tag 4/6), Chronik-Truhen; früher auch Weltboss (siehe Kap. 8.4).

**Prestige setzt alle Gebäude-Level auf 0** (Level 0 produziert weiter die Grundrate).

## 3.10 Runen [Code]

**Slots** (je einer pro Art):

| Slot | Rune | Hauptwert |
|---|---|---|
| 1 | Kraftrune ⚔️ | Angriff % |
| 2 | Schildrune 🛡️ | Verteidigung % |
| 3 | Herzrune ❤️ | Leben % |
| 4 | Zielrune 🎯 | Krit-Chance |
| 5 | Wuchtrune 💥 | Krit-Schaden % |
| 6 | Glücksrune 🍀 | Runenglück % |

**Seltenheiten:**

| Seltenheit | Multiplikator | Verkaufsgold |
|---|---|---|
| Gewöhnlich (grau) | 1 | 15 |
| Ungewöhnlich (grün) | 1,6 | 24 |
| Selten (blau) | 2,4 | 36 |
| Episch (lila) | 3,4 | 51 |
| Legendär (gold) | 5 | 75 |

**Drop im Kampf:**
- Chance: **5 %** pro normalem Sieg, **10 %** pro Boss.
- Seltenheits-Gewichte normal 65/25/8/1,8/0,2, Boss 30/35/25/8/2.
- Runenglück erhöht alle Gewichte außer „Gewöhnlich“.
- **Harte Mindest-Lebenszeitstufe pro Seltenheit:** grün 5, blau 15, episch 35, legendär 75.
- Slot zufällig.

**Werte:**
- Hauptwert: `Basis × Seltenheit × Zufall 0,8–1,2`. Basis 2 % (Krit-Chance 0,5).
- Feste Substats (`attack_flat`/`defense_flat`/`hp_flat`) haben eigene Schwankungsbreiten.
- Substats: Startanzahl bis grau 0 / grün 1 / blau 2 / episch 3 / legendär 4, **max. 4**. Wert = 35 % eines Hauptwurfs.
- Mögliche Substats: alle 6 Hauptwerte + feste Werte + Angriffstempo, gewichtet.

**Aufwerten (+0 → +15):**
- Kosten: `16 × Mult. × 1,42^Stufe` Gold, minus „Gildenschmiede“ (max. 40 %).
- Fehlschlag: `min(30 %, Stufe × 2 %)`. Das Gold ist dann weg, die Stufe bleibt.
- Pro Stufe +8 % Hauptwert.
- Bei +3/+6/+9/+12: neuer Substat oder Verstärkung eines bestehenden.
- **Sofort-Aufwerten** wiederholt das, solange Gold reicht.

**Weitere Aktionen:**

| Aktion | Regel |
|---|---|
| Substat neu würfeln | Kosten `5 × Mult. × (1 + Stufe × 0,15)` **Kristalle**; Verstärkungen bleiben erhalten |
| Verschmelzen | 3 Runen gleicher Seltenheit und gleichen Slots → 1 Rune der nächsten Seltenheit (startet bei +0). Zerstör-Chance grau 3 %, grün 6 %, blau 12 %, episch 20 %. Legendär kann nicht verschmolzen werden. Bis 9 auf einmal, Auto-Schmelzen nur mit +0-Runen. |
| Aufstieg legendär +16…+30 | Eine zweite legendäre Rune **gleichen Slots und gleicher Stufe** wird verbraucht, plus Gold (Aufwertungskosten). Keine Fehlschlagchance. |
| Verkaufen | `Verkaufsgold × (1 + Stufe × 0,15) × (1 + Substats × 0,25)` |
| „Auf +15 maximieren“ | Alle unausgerüsteten legendären Runen des Slots auf einmal |
| Ausrüstungsset speichern | Prestige-Freischaltung; 1 Speicherplatz in `localStorage` |
| Hintergrund-Automatiken | Prestige „Automatische Runenaufwertung“ + eigener Schalter: Auto-Legi-Aufwertung, Auto-Aufstieg, Auto-Verschmelzung (Bestätigung beim Einschalten) |

**Erhalt:** Runen überleben Prestige und Aufstieg vollständig.

**Speicherung:**
- Tabelle `idle_player_runes`, Felder `rune_type`, `rarity`, `rolled_value`, `upgrade_level`, `substats` (JSON) und `equipped`.
- Ausgerüstete Runen und das Lager werden getrennt geladen; ein Ladefehler zeigt einen Hinweis mit „Erneut laden“.
- Doppelt ausgerüstete Runen werden beim Laden automatisch bereinigt.
- **Kein Lagerlimit.**

## 3.11 Dorf-Skins, Titel, Kosmetik, Plüschtiere

**Dorf-Skins** [live, 18; Anhang A9]:
- Fast alle sind Videos.
- Freischaltarten: `free`, `purchase` (Gold 150.000 bis 500.000.000), `achievement` (Zerstörtes Dorf: 15.000 Niederlagen; Yakshas Heimat: 50.000 Yaksha-Siege), `boss_drop` (Zerathor Dorf, siehe Kap. 8.4), `code` (KalleJunior Dorf, Einlöse-Code), `real_money` (Drachenrahmen, **inaktiv**).
- Steampunk Dorf hat zusätzlich einen Euro-Preis (1,99 €), Echtgeld ist aber deaktiviert.
- Vorschau-Kachel + großes Vorschaufenster.
- Besitz in `idle_player_village_skins`, aktiver Skin in `idle_player_state.active_village_skin`.

**Titel und Kosmetik:**
- **Idle-Titel** (175, davon 150 mit Dauerbonus): Alle freigeschalteten Boni wirken **gleichzeitig** (Sammlungs-Prinzip). Ein Titel wird als Anzeige ausgewählt.
- **Idle-Kosmetik** (28 Namensfarben).
- **Website-Titel** (112) und **Website-Namensrahmen** (55), freigeschaltet über Erfolgsanzahl, bestimmte Erfolge oder Easter Eggs.

**Plüschtiere** [live, 26; Anhang A10]:
- Nur per **Code** einlösbar (`plushie_codes`, über `api/redeem-plushie-code`), Besitz in `user_plushies`, ein aktives Plüschtier wird am Namen angezeigt.
- Quellen: Admin-Codes, Weltboss/Gildenboss 5 % (Kap. 8.4/7.9).
- Ein Easter Egg: Der Platzhaltertext im Code-Feld ist selbst ein gültiger Code (Kora).
- Das frühere tägliche Code-Event wurde am 27.09.2026 entfernt.

## 3.12 Event-Drachen [Code + SQL]

- **Gegner:** Shenloss und Ganz Liber Drache.
- **Ablauf:**
  1. Erscheinen pausiert den Kampf und öffnet ein Fenster.
  2. Der Spieler bestätigt.
  3. Kampf mit hohem, auf die eigenen Werte zugeschnittenem Leben.
  4. Der Sieg wird serverseitig **einmalig** gespeichert (`idle_event_dragon_state`, RPC `idle_claim_event_dragon_victory`) und schaltet einen Titel frei.
- **Danach:** Der Drache erscheint für diesen Spieler nie wieder.

## 3.13 Ranglisten und Statistik

**Idle-Bestenliste** (12 Reiter):

| Gruppe | Reiter |
|---|---|
| Spielstand | Top Level, Top Gold (Gesamt), Top Drachen, Top Spielzeit, Top Insgesamte Stufen, Top Prestige |
| Weltboss | Raid-Schaden, Raid-Bosse, Raid-Teilnahmen, Bester Raid |
| Herausforderungen | Dungeon (Bestzeiten), Turm (Höchststufe) |

- Quelle: View `idle_player_state_leaderboard`. Sie blendet **manuell** ausgeblendete Konten aus; dazu kommt der Test-Account-Filter im Code.

**Weitere Ranglisten:**
- **Gilden-Bestenliste** (Gilden-XP) im Tab Gilden-Arena.
- **Website-Bestenliste** mit 5 Metriken.
- **Arena-Rating-Liste / Gildenboss-Bestenliste:** Datenbankfunktionen vorhanden (`bkmpArenaGetLeaderboard`, `loadGuildBossLeaderboard`), aber **von keinem UI aufgerufen** (Kap. 19).

**Kampfstatistik** (rechte Spalte im Kampf-Tab, Desktop):
- Boss-Karte, Belohnungsvorschau (mit derselben Formel wie der echte Sieg) und Sitzungsstatistik (Gesamtschaden, Treffer, Krits, Projektile).
- Bonus-Leiste mit 6 Kacheln (Angriff/Verteidigung/… inkl. Boni).

## 3.14 Hilfssysteme

**Wartungsmodus:**
- Admin-Schalter `site_flags.idle_maintenance` + Nachricht. Bei aktivem Modus ist das Spiel gesperrt; der Status wird regelmäßig abgefragt.
- **Wenn der Status nicht ladbar ist:** Das Spiel verhält sich wie „keine Wartung“.

**Effektmodus „Hoch / Reduziert / Aus“:**
- Gespeichert in `localStorage`.
- 7 Einzelschalter: Schadenszahlen, Wackler & Aufblitzen, Angriffsanimation, Belohnungs-Popups, Drachen-Video, Dorf-Skin-Animation, Legendären-Puls.
- „Aus“ hält Drachen- und Dorf-Videos an und stoppt alle Deko-Animationen.
- Startwert „Hoch“, außer das Betriebssystem meldet „reduzierte Bewegung“.

**Automatisierungen** (alle 10 s, Prestige-Freischaltungen):

| Automatik | Regel |
|---|---|
| Runen-Aufwertung | Günstigste ausgerüstete Rune |
| Ei-Ausbrütung | Bestes freie Ei → freies Nest; Schutz gegen doppelte Zuweisung |
| Weltboss-Beitritt | Eigener Ein/Aus-Schalter, Standard an |
| Dungeon-Wiederholung | „Starten“ = unbegrenzte Auto-Läufe |
| Prestige-Hinweis | Hinweis, sobald ein Aufstieg möglich ist |
| Empfohlene Verteilung | Mit Zweig-Priorität |

**Auto-Kauf:**
- Ein/Aus-Schalter mit Ressourcen-Ausschluss (`localStorage`).
- Kauft pro Tick bis zu **50** Upgrade-Stufen, plus Prestige (+5/Rang, 2 Knoten) und Gilden-Tech „Gilden-Autokauf“ (+10/Stufe).
- Bevorzugt die günstigste Stufe **außerhalb** der Softcap-Zone.

**Kampf-Log und Meldungen:**
- **Kampf-Log** mit Filter „nur legendäre Runenfunde“; auf dem Handy als eigenes Fenster.
- **Belohnungs-Präsentation** (`bkmpRewardPresent`): Toast → Karte → Zeremonie, mit Warteschlange und Dubletten-Schutz.
- **Status-Banner im Kampf** (Priorität Niederlage > Bosskampf > Sieg > Nächste Stufe). Der Bosskampf-Banner erscheint pro Bossstufe nur einmal.

---

# 4. Alle Ressourcen und Währungen

| Ressource | Herkunft | Verwendung | Maximum | Skalierung | Speicherort | Status |
|---|---|---|---|---|---|---|
| **Gold** 💰 | Kampf, Goldmine, Dungeons (alle Typen), Turm, Arena-Sieg, Weltboss, Gildenboss, Chronik/Kalender, Fundschatz, Level-Meilensteine, Offline | Upgrades (Waffenschmiede, Rüstkammer), alle Gebäude, Nester, Lager, Drachen-Aufstieg, Opfergaben, Runen-Aufwertung/-Aufstieg, Skins, Überladung, Gildengründung (500.000), Kassen-Spende, Gilden-Tech-Beiträge, Gildenplätze | keins | Kampfgold wächst mit der Stufe | `idle_player_state.gold`, zusätzlich `total_gold_earned` (Lebenszeit) | aktiv |
| **Holz** 🌳 | Kampf (fester Basiswert), Holzfällerlager, Offline | Upgrade „Vorratshaus“ (+5 Leben), Wandernder Händler (20 % Holz) | keins | wächst nicht mit der Stufe | `wood` | aktiv |
| **Stein** 🗿 | Kampf, Steinbruch, Offline | Upgrade „Steinmauern“ (+1 Verteidigung), Händler | keins | wie Holz | `stone` | aktiv |
| **Kristalle** 💎 | Selten/Miniboss/Boss/Event-Drachen, Kristallmine, Edelstein-Dungeon, Turm-Meilensteine, Weltboss, Gildenboss, Gildenquests, Chronik, Kalender, Level-Meilensteine, Fundschatz, Händler | Upgrades „Kristallschliff“ (+1 % Gold), „Diamantenhärtung“ (+2 Verteidigung), Substat neu würfeln, Opfergabe legendärer Eier (200) | keins | Kampf: fester Basiswert × Beute-Bonus | `crystals` | aktiv |
| **Essenz** 🧪 | Selten/Miniboss/Boss/Event-Drachen, Manaquelle, Chronik, Händler, Offline | Upgrades „Zielübung“ (+1 Krit-Chance), „Essenzbindung“ (+1 % Beute), „Essenzkern“ (+2 Angriff) | keins | wie Kristalle | `essence` | aktiv |
| **Frucht** 🍎 | Obstgarten, Früchte-Dungeon | Babydrachen füttern (1 Frucht = 1 Wachstumspunkt; je nach Vorliebe des Drachen) | `2.000 + 500 × Obstgarten-Level` | Rate mit Level und Boni | `fruit`, `fruit_collected_at` | aktiv |
| **Fleisch** 🥩 | Jagdhütte, Fleisch-Dungeon | wie Frucht | `2.000 + 500 × Jagdhütte-Level` | – | `meat`, `meat_collected_at` | aktiv |
| **Erfahrung (EP)** | Kampf, EP-Dungeon, Magierakademie, Turm, Weltboss, Chronik, Offline | Spielerlevel → Skillpunkte | – | `40 × Level^1,42` pro Level | `xp`, `level` | aktiv |
| **Skillpunkte** 🔹 | 1 pro Level | Skilltree (1–20 Punkte pro Rang) | – | – | `skill_points_available`, `skill_points_spent` | aktiv |
| **Prestige-Punkte** 🌌 | Prestige-Aufstieg: `floor((Stufe/20)^1,15)` (mind. 1) × Portal-Meisterschaft; Gildenquest Stufe 3 (+10) | Prestige-Baum, Paragon | – | – | `idle_prestige_state.prestige_points`, `…_spent` | aktiv |
| **Drachenseelen** ✨ | Aufstieg: `max(1, floor((Lebenszeit-Stufen/5000)^0,9))` | Kein Ausgeben; jede Seele gibt dauerhaft +0,5 % Angriff/Leben/Gold/EP | – | – | `idle_prestige_state.prestige_allocations.__dragon_souls` (JSON-Schlüssel) | aktiv |
| **Dungeon-Schlüssel** 🗝️ | +1 zu festen Uhrzeiten 0/4/8/12/16/20 Uhr (Berlin), pro Dungeon-Typ | 1 Schlüssel pro Dungeon-Lauf („Sparsamer Eintritt“: Chance auf 0 Verbrauch) | **5** + Prestige-Meilenstein (+1) + „Schlüsselbund“ (+1/Rang, max. 3) | – | `dungeon_keys` (pro Spieler × Typ), serverseitig | aktiv |
| **Runen** | Kampf, Runen-Dungeon, Turm (25./50. Stufe), Chronik-Truhen, Gildenquests (Stufe 2: blaue/lila Rune, Stufe 3: legendäre Rune) | Ausrüsten, Verschmelzen, Aufstieg, Verkaufen | kein Lagerlimit | – | `idle_player_runes` | aktiv |
| **Dracheneier** 🥚 | Ei-Dungeon (Hauptquelle), Turm (50. Stufe), Chronik-Wochentruhe | Nest → Brut | – | Seltenheit nach Schwierigkeit | `player_dragon_eggs` | aktiv |
| **Gildenkasse** (Gold) | Spenden der Mitglieder, Gilden-Arena-Siege | Gildenplätze; Kassenstand gibt Bonus | – | Bonus-Stufen ab 1.000 / 5.000 / 20.000 / 50.000 / 150.000 → +2/5/8/12/18 % | `guilds.treasury_gold` | aktiv |
| **Gilden-XP** | Spenden in die Gildenkasse | Gildenlevel 1–100 | Level 100 | Schwellen Anhang A12 | `guilds.guild_xp` | aktiv |
| **Gilden-Tech-Beitragsversuche** | 5 pro Spieler, +1 zu festen Zeiten (gleiche Logik wie Dungeon-Schlüssel) | 1 Versuch pro Beitrag | 5 | – | `guild_tech_contributor_attempts` | aktiv |
| **Arena-Rating** | Arena-Kämpfe | Rangliste | – | ELO, Start 1000 | `arena_ratings` | aktiv |
| **Gilden-Rating** | Gilden-Arena | Rangliste | – | ELO | `guild_ratings` | aktiv |
| **Booster-Zeit** | siehe 3.9 | +25 % Gold/EP | – | – | `boost_gold_until`, `boost_exp_until` | aktiv |
| **Mana** | **keine Quelle mehr** | **keine** | – | – | Spalte `idle_player_state.mana` (Standard 0) | **⚠ im Code vorhanden, aber ungenutzt.** Die „Manaquelle“ produziert seit dem Umbau Essenz. Nur das QA-Testfenster setzt `mana` noch. |
| **Echtgeld (€)** | – | Dorf-Skins mit `price_eur_cents` (Steampunk Dorf 1,99 €; „Drachenrahmen“ 1,99 €, inaktiv) | – | – | `real_money_purchases` | **⚠ vorhanden, aber deaktiviert** (`BKMP_REAL_MONEY_PURCHASES_ENABLED = false`) |
| Plüschtier-/Skin-Codes | Admin, Weltboss/Gildenboss (5 %) | Einlösen | – | – | `plushie_codes`, `raid_reward_codes`, `guild_boss_reward_codes` | aktiv |

**Auf der Website (nicht im Spiel)** gibt es weitere Zähler, aber keine Währungen: Bonk-Zähler, Besuchstage, Minuten auf der Seite, gefundene Easter Eggs, Schaf-Serie, Highscore in „Jake's Feldfahrt“. Diese werden über `player_stats` synchronisiert (siehe Kap. 14).

---

# 5. Alle Drachen-Systeme

Es gibt **zwei getrennte Drachen-Welten**, die nur an wenigen Stellen verbunden sind:

| | Kampf-Drachen | Zucht-Drachen |
|---|---|---|
| Rolle | Die Gegner im Kampf | Eigene Drachen des Spielers |
| Tabelle | `idle_dragons` | `dragon_species` (Arten) + `player_dragons` (Exemplare) |
| Verbindung | Bestiarium zählt Siege pro Kampf-Drache; Fundschatz hängt an Zucht-Arten mit Quelle `combat` | Begleiter geben dem Dorf Werte |

## 5.1 Kampf-Drachen (Gegner) [live]

12 aktive Einträge; die vollständige Werte-Tabelle steht in Anhang A7.

| Typ | Drachen |
|---|---|
| Standard (6) | Feuerdrache, Blitzdrache, Wasserdrache, Erddrache, Winddrache, Cyberdrache |
| Selten (2) | Schattendrache, Wuffdrache |
| Miniboss (1) | Aurelia Drache (ID `yakshas-drache`) |
| Boss (1) | Yaksha der Drachenboss (`yaksha-boss`) |
| Event (2) | Shenloss, Ganz Liber Drache |

**Besondere Fähigkeiten:** Kampf-Drachen haben keine eigenen Fähigkeiten. Sie unterscheiden sich nur in Leben/Angriff/Verteidigung und Belohnung; Bosse und Minibosse bekommen Multiplikatoren (Kap. 3.6). Die Spawnregeln stehen in Kap. 3.6.

**Darstellung:**
- 10 Drachen sind **Videos** (`BKMP_IDLE_VIDEO_DRAGON_SPRITES` in `js/ui/bkmp-hud.js`). Jedes Video wird pro Sitzung nur einmal geladen und als Blob wiederverwendet (Traffic-Schutz).
- Der Rest nutzt Bild-Spritesheets (`.idle-sprite-<key>`).
- Im Effektmodus „Aus“ steht das Video als Standbild.

**Weitere Hinweise:**
- **Admin:** Kampf-Drachen sind im Admin-Panel bearbeitbar (Werte, aktiv/inaktiv).
- **Code-Fallback** `BKMP_IDLE_FALLBACK_DRAGONS` in `idledorf.js` greift, wenn die Datenbank nicht antwortet.
- **Alte Seed-Daten:** Die ursprüngliche Schema-Datei enthält 10 ganz andere Archetypen (Waldwyrm, Steinwyrm …). Diese sind live **nicht** vorhanden. Die aktuelle Liste stammt aus späteren Migrationen.

## 5.2 Zucht-Drachen: Arten [live, Anhang A8]

25 aktive Arten:

| Seltenheit | Arten | Brutzeit | Opfergabe | Wachstumspunkte | Kampf-EP bis erwachsen | Zusatzwerte |
|---|---|---|---|---|---|---|
| Standard (4) | Feuer-, Wasser-, Wind-, Blitzdrache | 45 Min. | – | 500 | 2.500 | 2–3 |
| Selten (3) | Aureliadrache, Schattendrache, Wuffdrache | 90 Min. | – | 1.000 | 6.000 | 3–4 |
| Episch (13) | Koradrache, Hakudrache, Obsidrache, Kowalski, Byte, Enderdrachen, Kaledoss, Nytherion, Fynnow, Vulkarion, Bloodterion, Gravoryx, Bagon | 3 Std. | – | 2.000 | 15.000 | 3–4 |
| Legendär (5) | Zerathor, Yakshadrache, Phil, Lohendrache, Darknisdrache | 7,5 Std. | 500.000 Gold + 200 Kristalle | 6.000 | 50.000 | 4–5, **alle 3 Hauptwerte** |

**Felder:** `egg_source` (`combat`/`raid`/`event`), `source_dragon_id` (bei `combat`), `egg_drop_chance` (Standard/Selten 0,001; Zerathor/Yakshadrache 0,01; Event 0).

**Eier-Quellen:**

| Quelle | Regel |
|---|---|
| **Ei-Dungeon** (Hauptquelle) | Würfelt die Seltenheit nach Schwierigkeit (5.4) und nimmt dann **zufällig eine aktive Art dieser Seltenheit**, unabhängig von `egg_source`. Darüber sind auch die „Event“-Arten und die legendären Arten erhältlich. |
| Turm | Jede 50. Stufe ein Ei |
| Chronik-Wochentruhe | 1 Ei |
| Gildenquest Stufe 3 | **Kein Ei.** Die Oberfläche kündigt „🥚 Legendäres Ei“ an, die Server-Funktion vergibt aber eine legendäre **Rune** (siehe Kap. 7.8 und 19). |
| Fundschatz | Die frühere Ei-Chance beim Kampf (`egg_drop_chance` der `combat`-Arten) gibt heute stattdessen **Gold + Kristalle** (Kap. 3.4). |
| `claim_epic_dragon_egg` | Einmalige Meilenstein-Belohnung „episches Ei“. **⚠ Server-Funktion + Client-Wrapper existieren, werden aber nirgends aufgerufen** (Kap. 19). |

## 5.3 Lebenszyklus: Ei → Baby → Jugendlich → Erwachsen [Code]

1. **Nest:**
   - Nest 1 gratis, Nest 2–5 kosten 150.000 / 600.000 / 2.000.000 / 6.000.000 Gold.
   - Rabatt max. 40 % aus Skill „Nestbaumeister“ + Prestige „Zuchtsegen“.
   - Gold wird im Browser abgezogen. Das Nest wird als Zeile in `player_dragon_nests` angelegt (max. 5 im Code); einen doppelten Kauf desselben Platzes lehnt die Datenbank ab.
2. **Ei einlegen:**
   - Legendäre Eier verlangen vorher eine **Opfergabe** (500.000 Gold + 200 Kristalle). Rabatt max. 50 % aus Skill „Ritualkenntnis“ + Gilden-Tech „Brutbeschleuniger“.
   - Schutz gegen doppeltes Einlegen desselben Eis (Fehler vom 27.07., inzwischen behoben).
3. **Brut:**
   - Dauer = `brood_seconds × (1 − Verkürzung)`.
   - Verkürzung max. **40 %** aus Skill „Wärmelampen“ + Prestige „Schnelle Reifung“ + Gilden-Tech „Brutbeschleuniger“.
   - Countdown live im Nest.
4. **Schlüpfen → Baby:**
   - Der Drache bekommt eine **Futtervorliebe** (Frucht oder Fleisch).
   - **Füttern:** 1 Futter = 1 Wachstumspunkt bis zur Grenze der Art. Prestige „Sparsame Fütterung“ gibt eine Chance auf kostenloses Füttern (max. 75 %).
5. **Baby → Jugendlich:** sobald die Wachstumspunkte voll sind (manuell bestätigen).
6. **Jugendlich → Erwachsen:**
   - Der Drache sammelt **Kampf-EP**, aber nur als aktiver **Trainings-Begleiter**: +4 pro normalem Sieg, +25 pro Boss, +6 pro Dungeon-Welle.
   - Bonus aus Substat „Drachen-EP“, Skill „Drachentrainer“ (+3 %/Rang) und Prestige „Drachenwissen“ (+4 %/Rang).
   - **Offline:** fest **8 Kampf-EP pro Stunde** [live `offline_afk_reward.companionXpPerHour`], gedeckelt auf die Grenze der Art.
7. **Erwachsen werden:** Die Werte werden **einmalig gewürfelt und gespeichert** (`bkmpIdleRollAdultDragonStats`).
   - **Hauptwert:** Basis Angriff 6 / Verteidigung 6 / Leben 60 × Seltenheit (Standard 1, Selten 1,7, Episch 2,8, Legendär 6) × Zufall 0,75–1,45.
   - Normale Arten bekommen **einen** zufälligen Hauptwert, „Mehrwert“-Arten (alle legendären) **alle drei**.
   - **Zusatzwerte:** Anzahl je Art; Wert = Zufall im Bereich × Seltenheits-Multiplikator.

**Zusatzwert-Pool (12):**

| Zusatzwert | Bereich |
|---|---|
| Angriff %, Verteidigung %, Leben %, Goldbonus % | je 0,8–2,4 |
| Krit-Chance % | 0,3–1,0 |
| Krit-Schaden % | 1,2–3,5 |
| Angriffsgeschwindigkeit %, Schildstärke % | je 0,8–2,2 |
| Diamantenbonus % | 0,5–1,5 |
| Früchte-, Fleischproduktion %, Drachen-EP % | je 2–6 |

**Speicherung:** `player_dragon_eggs`, `player_dragon_nests`, `player_dragons`. Felder: `stage`, `growth_points`, `battle_xp`, `food_preference`, `stat_attack`/`stat_defense`/`stat_hp`, `main_stat_key`, `substats` (JSON), `is_companion`, Favorit, Name, `ascension_level`.

**Weitere Lager-Aktionen:**
- **Freilassen** von Eiern, Babys und Drachen (Bestätigung, bei episch/legendär doppelt)
- **Umbenennen**, **Favoriten**
- **Filter:** Legendäre/Epische/Seltene/Favoriten
- **Lexikon** (Arten-Übersicht)

## 5.4 Eier-Seltenheit im Ei-Dungeon [Code]

| Schwierigkeit | Standard | Selten | Episch | Legendär |
|---|---|---|---|---|
| Leicht | 80 | 19 | 1 | 0 |
| Mittel | 55 | 35 | 9,5 | 0,5 |
| Schwer | 30 | 40 | 27 | 3 |
| Albtraum | 10 | 35 | 50 | 5 |

- Ein erfolgreicher Lauf gibt 1 Ei, mit Tagesbonus 2.
- Prestige „Seltene Brut“ (+2 %/Rang, max. 150 %) hebt alle Gewichte außer Standard an.
- Prestige „Seltene Funde“ gibt eine Chance auf ein Zusatz-Ei (max. 60 %).

## 5.5 Begleiter und Trainingsplatz [Code]

**Kampf-Begleiter (erwachsene Drachen):**
- **1 Platz**, Prestige „Weitere Gefährten“ schaltet Platz 2 (1.500 Punkte) und Platz 3 (3.000 Punkte) frei.
- **Automatische Sortierung nach Stärke.** Die Gewichtung ist **100 % / 50 % / 25 %**; der stärkste Drache bekommt immer Rang 1.
- **Wirkung:** Der Begleiter speist seine Hauptwerte (als fester Angriff/Verteidigung/Leben) und seine Zusatzwerte in den Effekt-Topf (Kap. 3.1).
- **Verstärkungen:**
  - Prestige „Drachenmacht“ (+2 % Schaden/Rang), „Mächtige Abstammung“ (+2 % Hauptwerte/Rang), „Aktiver Begleiter“ (+2 % Zusatzwerte/Rang)
  - Meilenstein „Drachenbund“ (+3 % Schaden)
  - Gilden-Tech „Zuchtkraft/-panzer/-vitalität“ (+8 %/Stufe) und „Zuchtmeisterschaft“ (+5 % auf alle drei)
  - Deckel je 200 %
- „Passive Bindung“ gibt Dorf-Regeneration, solange ein Begleiter aktiv ist.

**Trainingsplatz:** Genau **ein** jugendlicher Begleiter sammelt Kampf-EP (Kap. 5.3). Er zählt nicht gegen die Kampf-Plätze.

**Oberfläche:** Begleiter-Leiste mit 3 Kampf-Plätzen + 1 Trainingsplatz und Auswahlfenster; Block „Gesamtbonus“ mit dem tatsächlich wirksamen Bonus.

**Speicherung:** `player_dragons.is_companion`. Die frühere Datenbank-Regel „nur 1 Begleiter“ wurde per Migration entfernt.

## 5.6 Drachen-Aufstieg [Code]

- **Kosten:** eine zweite erwachsene Kopie **derselben Art** wird verbraucht, plus **150.000 Gold**.
- **Wirkung:** +10 % auf die Hauptwerte pro Stufe, max. **5 Stufen**.
- **Für alle Seltenheiten** (seit 02.08.2026).

## 5.7 Drachenlager [Code]

- **Plätze:** Basis 20, plus Erweiterungen (+5 für 50.000; +5 für 150.000; +10 für 400.000; +10 für 1.000.000; +15 für 2.500.000).
- **Weitere Plätze:** Skill „Drachenzwinger“ ist inaktiv, Prestige „Größeres Drachenlager“ gibt +1/Rang.
- **Speicherung:** gekaufte Erweiterungen in `idle_player_state.dragon_storage_expansions_bought` (früher `localStorage`; Altwerte werden automatisch übernommen).

## 5.8 Drachen-Dex [Code]

- **Inhalt:** Sammelbuch der Zucht-Arten mit 4 Stufen je Art (Ei/Baby/Jugendlich/Erwachsen), Detailansicht und Seitenblättern.
- **Speicherung:** entdeckte Arten in `idle_player_state.dragon_species_discovered_at` (JSON, Zeitstempel). Fehlende Einträge werden beim Laden aus dem Besitz nachgetragen.

## 5.9 Bestiarium (Chronik) [Code]

Zählt Siege **pro Kampf-Drachenart** (nur normaler Kampf, keine Event-Drachen). Offline-Siege werden nach den Spawnregeln auf die Arten verteilt.

**Stufen (Bronze/Silber/Gold/Platin/Diamant):**

| Drachentyp | Schwellen |
|---|---|
| Standard | 100 / 1.000 / 10.000 / 50.000 / 250.000 |
| Selten und Miniboss | 10 / 100 / 1.000 / 5.000 / 25.000 |
| Boss | 5 / 50 / 500 / 2.500 / 10.000 |

**Bonus pro Stufe (dauerhaft, im Effekt-Topf):**

| Drache | Bonus pro Stufe |
|---|---|
| Feuer | +2 % Angriff |
| Blitz | +4 % Krit-Schaden |
| Erd | +2 % Verteidigung |
| Wasser | +2 % Leben |
| Wind | +2 % EP |
| Cyber | +2 % Gold |
| Schatten | +3 % Beute |
| Wuff | +3 % Gold |
| Aurelia (Miniboss) | +2 % Angriff |
| Yaksha-Boss | +3 % Bossschaden |
| Unbekannte Arten | nach Regel: Standard +1 % Angriff, Selten +2 % Beute, Miniboss +2 % Angriff, Boss +3 % Bossschaden |

**Speicherung:** Das Bestiarium bleibt über Prestige erhalten und liegt in `idle_player_meta` (Kap. 10).

---

# 6. Upgrades, Skills und Fortschrittsbäume

## 6.1 Normale Upgrades (Tab „Upgrades“) [Code]

**Formeln:**
- **Kosten:** `baseCost × (1 + costRate × Level)^costExponent`.
  - Ab Softcap 1 wird der **Exponent** mit `costMult1` multipliziert, ab Softcap 2 mit `costMult2`.
  - Prestige-Rabatt „Händlergeschick“: max. 20 % laut Knoten, technisch auf 40 % gedeckelt.
- **Effekt:** bis Softcap 1 volle Wirkung; zwischen Softcap 1 und 2 zählt jeder **neue** Rang 50 %, danach 25 %. Bereits gekaufte Ränge behalten ihren Wert.

| ID | Name | Ressource | Effekt/Stufe | Basiskosten | costRate | Exp. | Max. | Softcap 1/2 | Kosten-Mult. 1/2 |
|---|---|---|---|---|---|---|---|---|---|
| `atk` | Waffenschmiede ⚔️ | Gold | +1 Angriff (fest) | 35 | 0,25 | 2,3 | 2.500 | 625/1.250 | 1,08/1,18 |
| `def` | Rüstkammer 🛡️ | Gold | +1 Verteidigung (fest) | 35 | 0,25 | 2,3 | 2.500 | 625/1.250 | 1,08/1,18 |
| `hp` | Vorratshaus ❤️ | Holz | +5 Leben (fest) | 25 | 0,22 | 2,2 | 20.000 | 5.000/10.000 | 1,08/1,18 |
| `walls` | Steinmauern 🧱 | Stein | +1 Verteidigung (fest) | 25 | 0,22 | 2,2 | 20.000 | 5.000/10.000 | 1,08/1,18 |
| `crit` | Zielübung 🎯 | Essenz | +1 Krit-Chance | 6 | 0,2 | 1,8 | 150 | 75/120 | 1,06/1,14 |
| `crystal_gold` | Kristallschliff 💎 | Kristalle | +1 % Gold | 5 | 0,22 | 2 | 500 | 250/400 | 1,06/1,14 |
| `essence_loot` | Essenzbindung 🧪 | Essenz | +1 % Beute | 4 | 0,22 | 2 | 500 | 250/400 | 1,06/1,14 |
| `essence_core` | Essenzkern 🔮 | Essenz | +2 Angriff (fest) | 8 | 0,22 | 2 | 20.000 | 5.000/10.000 | 1,08/1,18 |
| `crystal_defense` | Diamantenhärtung 💠 | Kristalle | +2 Verteidigung (fest) | 8 | 0,22 | 2 | 20.000 | 5.000/10.000 | 1,08/1,18 |

**Upgrade-Meilensteine** (ohne eigene Speicherung, berechnet aus dem Rang):
- Ränge **25 / 50 / 100 / 500 / 1.000**, jeweils nur bis zum Max-Level des Upgrades.
- Jeder Meilenstein gibt einen **ergänzenden** Bonus:

| Upgrade | Bonus pro Meilenstein |
|---|---|
| Waffenschmiede | +1 % Bossschaden |
| Rüstkammer | +1 % Verteidigung |
| Vorratshaus | +1 % Leben |
| Steinmauern | +1 % Verteidigung |
| Zielübung | +2 % Krit-Schaden |
| Kristallschliff | +2 % Gold |
| Essenzbindung | +2 % Beute |
| Essenzkern | +1 % Angriff |
| Diamantenhärtung | +1 % Verteidigung |

**Ebenfalls im Tab Upgrades:** Produktionsgebäude, Obstgarten/Jagdhütte, Gebäude-Überladung (Kap. 3.9), Auto-Kauf (Kap. 3.14).

**Speicherung:** `idle_player_state.upgrade_purchases` (JSON `{id: Level}`). Prestige setzt den Wert zurück.

## 6.2 Skilltree (Tab „Skilltree“) [live, vollständig in Anhang A6]

- **Kosten:** 1 Skillpunkt pro Level. Ränge kosten je nach Knoten 1–20 Punkte. Voraussetzungen haben die Form „Knoten X mindestens Rang N“.
- **Zurücksetzen:** gratis, alle Punkte zurück, **24 Stunden Abklingzeit** (`last_skilltree_reset_at`).

**Zweige (live aktiv):**

| Zweig | Knoten | Schwerpunkt |
|---|---|---|
| 🏹 Dorf | 9 | Angriff %, Angriffstempo, Krit-Chance, Krit-Schaden, Bogenschützen (+1,5 % Angriff/Rang), Ballisten (+2 fester Angriff/Rang), Klickkraft |
| 🏰 Burg | 8 | Leben %, Verteidigung %, Schildgenerator/Reparaturtempo (Regeneration) |
| ⚒ Wirtschaft | 8 | Gold, Holz, Stein, Offline-Einnahmen |
| 🐉 Forschung | 8 | EP, Gold, Beute, Angriff |
| ✨ Magie | 9 | Blitzschlag, Eis, Feuer, Heilung, Magieresistenz, Dimensionsportal (Krit-Schaden), Runenglück |
| 🐲 Zucht | 8 | Früchte-/Fleischproduktion, Drachen-Kampf-EP, Brutzeit (max. −40 %), Ei-Chance, Nestkosten (max. −40 %), Opfergaben (max. −50 %). „Drachenzwinger“ (+1 Lagerplatz) ist **inaktiv**. |
| 🔨 **Meister** (Zwerg Grimbold) | **0 live** | Code und Dialogszene vorhanden, Freischaltung „alle 5 Basis-Zweige voll“. Die 8 Knoten aus `sql/supabase-idle-meister-branch.sql` sind **nicht in der Live-Datenbank** → der Zweig wird nicht angezeigt (Kap. 19). |

**Speicherung:** `idle_player_state.skill_allocations` (JSON), `skill_points_available`, `skill_points_spent`. Die Knotendefinitionen stehen in `idle_skill_nodes` und sind im Admin-Panel bearbeitbar.

## 6.3 Prestige [Code]

**Aufstieg:**
- **Voraussetzung:** Höchststufe ≥ `100 + 50 × aktuelle Prestige-Stufe` (also 100, 150, 200 …).
- **Belohnung:**
  - Prestige-Punkte = `max(1, round(floor((Höchststufe/20)^1,15) × (1 + Portal-Meisterschaft%)))`, z. B. Stufe 200 → 14 Punkte, Stufe 500 → 41 Punkte.
  - Prestige-Stufe +1 → dauerhaft **+5 % Angriff/Leben/Gold/EP und +5 % Gebäudeproduktion pro Stufe**.

**Was zurückgesetzt wird und was bleibt:**

| Wird zurückgesetzt | Bleibt erhalten |
|---|---|
| Level, EP | Prestige-Baum, Prestige-Punkte, Prestige-Stufe |
| Gold, Holz, Stein, Kristalle, Essenz, Frucht, Fleisch | **Alle Runen** inkl. Ausrüstung |
| Skilltree, Skillpunkte | Erfolge, Titel, Kosmetik, Skins |
| Upgrades | Gesamte Drachen-Siege (`dragon_kills`, `boss_kills`) |
| alle 8 Gebäude-Level | Lebenszeit-Stufen (`prestige_stage_offset += Höchststufe`), Spielzeit |
| aktuelle und höchste Stufe (zurück auf 0-0) | Drachen, Eier, Nester, Bestiarium, Chronik, Gilde |

**Ablauf und Speicherung:**
- **Bestätigung:** zweistufiger Bestätigungsdialog, danach eine Zeremonie-Animation.
- **Speicherung:** `idle_prestige_state` mit `prestige_level`, `prestige_points`, `prestige_points_spent` und `prestige_allocations` (JSON). Das JSON enthält zusätzlich `__dragon_souls`, `__ascension_level` sowie `<knoten>__paragon`.

### Prestige-Baum: 52 Knoten in 6 Zweigen

**Kostenstufen:** Kosten eines Rangs = `round(baseCost × costGrowth^Rang)`.

| Stufe | Max. Rang | Wachstum | Basis | Paragon |
|---|---|---|---|---|
| WEAK | 50 | 1,09 | 2 | ja |
| MEDIUM | 30 | 1,20 | 2 | ja |
| STRONG | 20 | 1,32 | 3 | ja |
| SPECIAL (Chance-Werte) | 20 | 1,30 | 3 | **nein** |
| TOGGLE | 1 | – | 50 | nein |
| Portal-Meisterschaft (eigene Kurve) | 10 | 1,5 | 3 | nein |

| Zweig | Knoten (Effekt pro Rang, Stufe) |
|---|---|
| ⚔️ **Kampf** | Ewiges Feuer +8 % Angriff (STRONG) · Drachenblut +8 % Leben (STRONG) · Obsidianpanzer +8 % Verteidigung (STRONG) · Präziser Schlag +1 % Krit-Chance (MEDIUM) · Zerstörerischer Schlag (ID `kristallkern`) +10 % Krit-Schaden (STRONG) · Bossjäger +2 % Bossschaden (MEDIUM) · Drachenmacht +2 % Begleiter-Schaden (MEDIUM) · Rüstungsbrecher +1,5 % ignorierte Verteidigung (STRONG, max. 90 %) · Überwältigung +3 % Schaden in Dungeon/Turm (STRONG) · Doppelschlag +1 % Chance (SPECIAL, max. 75 %) |
| 💰 **Wirtschaft** | Goldene Ranken +8 % Gold (STRONG) · Reiche Ernte +4 % Holz+Stein (MEDIUM) · Kristalladern +3 % Kristalle (MEDIUM) · Essenzstrom +3 % Essenz (MEDIUM) · Händlergeschick −1 % Upgradekosten (STRONG) · Effiziente Baukunst −1 % Gebäudekosten (STRONG) · Schatzsucher +1 % doppelte Beute (SPECIAL) · Offline-Imperium +3 % Offline-Produktion (MEDIUM) · Zeitdehnung +2 h Gebäude-Aufholung (MEDIUM) · Massenkauf +5 Auto-Käufe/Tick (WEAK) |
| 🐉 **Drachen** | Drachenwissen +4 % Begleiter-Kampf-EP (MEDIUM) · Schnelle Reifung −2 % Brutzeit (STRONG) · Größeres Drachenlager +1 Platz (WEAK) · Seltene Brut +2 % Ei-Seltenheit (MEDIUM) · Mächtige Abstammung +2 % Begleiter-Hauptwerte (MEDIUM) · Futtermeister +4 % Frucht/Fleisch (MEDIUM) · Sparsame Fütterung +1 % gratis Füttern (SPECIAL) · Aktiver Begleiter +2 % Begleiter-Zusatzwerte (MEDIUM) · Passive Bindung +2 % Regeneration (MEDIUM) · Zuchtsegen −2 % Nestkosten (STRONG) |
| 💠 **Runen & Dungeons** (ab 100 investierten Punkten) | Runenglück +2 % Runen-Seltenheit im Dungeon (MEDIUM) · Runenmeister +1 Startstufe für Dungeon-Runen (WEAK, max. 15) · Effiziente Aufwertung −1 % Runenkosten (STRONG) · Schmelzmeister +3 % Schmelzbelohnung (MEDIUM) · Dungeonjäger +3 % Dungeon-Belohnung (MEDIUM) · Schlüsselbund +1 max. Schlüssel (WEAK, **max. 3, kein Paragon**) · Sparsamer Eintritt +1 % kein Schlüsselverbrauch (SPECIAL) · Bosskammer +2 % Erfolgsbonus (MEDIUM) · Seltene Funde +1 % Zusatz-Ei/-Rune (MEDIUM, max. 60 %) |
| ⚙️ **Automation** (ab 100 investierten Punkten) | Erweiterter Auto-Kauf +5 (WEAK) · Auto-Kauf mehrerer Stufen +5 (WEAK, derselbe Hebel) · Automatische Runenaufwertung · Automatische Ei-Ausbrütung · Automatische Dungeon-Wiederholung · Automatischer Bosskampf · Gespeicherte Ausrüstungssets (alle TOGGLE) · Höhere Kampfgeschwindigkeit +3 % Angriffstempo (MEDIUM) · Automatische Prestige-Vorschau · Automatische Verteilung (TOGGLE) |
| 🌌 **Vermächtnis** | Zeitraffer +8 % EP (STRONG) · Portal-Meisterschaft +8 % Prestige-Punkte (eigene Kurve) · **Weitere Gefährten** (2 Ränge: 1.500 / 3.000 Punkte → 2. und 3. Begleiter-Platz, kein Paragon) |

**Entfernte und geänderte Knoten:**
- **„Schlüsselmeister“** (schnellere Schlüssel) wurde am 03.08.2026 entfernt. Investierte Punkte werden beim Laden automatisch erstattet.
- **„Schlüsselbund“** wurde auf max. Rang 3 gesenkt; Punkte für höhere Ränge und Paragon werden erstattet.

**Prestige-Meilensteine** (nach insgesamt investierten Punkten):

| Punkte | Name | Wirkung |
|---|---|---|
| 25 | Erste Meisterschaft | +2 % Angriff |
| 50 | Schlüsselbewahrer | +1 max. Dungeon-Schlüssel |
| 100 | Erweiterter Baum | Zweige „Runen & Dungeons“ + „Automation“ |
| 200 | Drachenbund | +3 % Begleiter-Schaden |
| 350 | Jenseits der Grenze | **Paragon** freigeschaltet |
| 500 | Aufstieg | 2. Prestige-Ebene sichtbar |
| 750 | Wirtschaftswunder | +5 % Gold und EP |
| 1.000 | Punkte-Legende | +5 % Bossschaden |

**Paragon:**
- **Voraussetzung:** Ab dem Meilenstein bei 350 Punkten können voll ausgebaute Knoten (nur paragonfähige Stufen) weiter mit denselben Prestige-Punkten gekauft werden.
- **Wirkung:** **4 %** der normalen Rang-Wirkung pro Paragon-Rang, max. **1.000** Paragon-Ränge.
- **Kosten:** setzen am Ende der normalen Kurve an, Wachstum +0,15. Ab `Number.MAX_SAFE_INTEGER` ist der Knoten faktisch nicht mehr bezahlbar.
- Gespeichert als `<id>__paragon`.

**Automatische Verteilung:** Knopf „Empfohlene Verteilung“ (Prestige-Knoten). Verteilt nach einer einstellbaren **Zweig-Priorität** (Reihenfolge per ▲▼ in `localStorage`), bei Gleichstand der günstigste Knoten zuerst.

### Aufstieg und Drachenseelen (2. Prestige-Ebene)

- **Voraussetzungen:** Prestige-Stufe ≥ **10**, ≥ **500** investierte Punkte, ≥ **5.000** Lebenszeit-Stufen. Gilden-Tech „Aufstiegsvorbereitung“ senkt alle drei Werte um max. 35 %.
- **Effekt:**
  - normaler Prestige-Reset (s. o.)
  - **zusätzlich** wird der **komplette Prestige-Baum** zurückgesetzt: Stufe, Punkte, Verteilung
  - neue **Drachenseelen** = `max(1, floor((Lebenszeit-Stufen/5000)^0,9))`
  - Aufstiegsstufe +1
  - Startgold = Aufstiegsstufe × 50.000
- **Dauerbonus:** jede Seele +0,5 % Angriff, Leben, Gold und EP.

---

# 7. Gilden

## 7.1 Gründen, Beitreten, Mitglieder [SQL-RPCs]

- **Gründen:** `create_guild` kostet **500.000 Gold** (eigenes Gold, serverseitig abgezogen); Name muss eindeutig sein. Die Gilde bekommt Name, Kürzel (Tag) und Beschreibung.
- **Beitreten** (eine Gilde pro Spieler):

  | Art der Gilde | Weg |
  |---|---|
  | Öffentlich | Direkt beitreten (`join_guild`) |
  | Privat | Einladungscode (`join_guild_by_code`; Code anzeigen/neu erzeugen nur für Führung) **oder** Beitrittsanfrage (`request_guild_join`), die von Anführer/Stellvertreter angenommen oder abgelehnt wird |

  Codes und Anfragen haben **kein Ablaufdatum**. Ein Wechsel zurück auf „öffentlich“ löscht den Code in der Datenbank nicht.
- **Mitgliederlimit:** 20 + gekaufte Plätze.
  - Bis **10** Zusatzplätze, Kosten `400.000 × 1,5^bereits gekauft` aus der **Gildenkasse**.
  - Kaufen dürfen nur Anführer und Stellvertreter (`buy_guild_slot`).
- **Verlassen:** `leave_guild`. Verlässt der Anführer die Gilde, übernimmt das am längsten dienende Mitglied; eine leere Gilde wird gelöscht.

## 7.2 Rollen und Rechte

Rollen: **Anführer 👑**, **Stellvertreter ⭐**, **Veteran 🛡**, **Mitglied 👤**.

| Aktion | Berechtigt |
|---|---|
| Rollen vergeben (`set_guild_member_role`), Mitglieder entfernen | Anführer und Stellvertreter. Der Anführer kann nie entfernt werden; ein Stellvertreter kann normale Mitglieder entfernen. |
| Einstellungen ändern (öffentlich/privat), Code neu erzeugen, Plätze kaufen, Anfragen annehmen/ablehnen, Gilden-Arena-Angriff | Anführer + Stellvertreter |
| Chat-Nachrichten löschen | Anführer, Stellvertreter, Veteran |
| Spenden, Technologie-Beiträge, Gildenboss, Quests | alle Mitglieder |

## 7.3 Kasse, Gildenlevel, Kassenstand-Bonus

- **Spenden:** `contribute_gold` zieht eigenes Gold ab. Die Gildenkasse (`treasury_gold`) **und** die Gilden-XP (`guild_xp`) steigen um denselben Betrag.
- **Gildenlevel 1–100:** Schwellen in `guild_level_thresholds` [live, Anhang A12], z. B. Level 10 = 90 Mio., Level 30 = 14,3 Mrd., Level 100 = 4,9 Billiarden.
- **Kassenstand-Bonus:** ab 1.000 / 5.000 / 20.000 / 50.000 / 150.000 Gold in der Kasse gibt es +2 / 5 / 8 / 12 / 18 % auf Angriff, Verteidigung und Gold aller Mitglieder (Cache im Browser).
- **Spendenrangliste** in der Gilde.

## 7.4 Gilden-Technologie (Tab „Gilden-Tech“, v3 seit 31.07.2026) [live, Anhang A11]

- **Prinzip:** Ein **Baum** mit 23 Knoten in 3 Kategorien: **Wachstum** (11), **Schlacht** (8), **Drachenzucht** (4). **Jedes Mitglied** zahlt mit **eigenem Gold** in einen gemeinsamen Fortschrittsbalken ein.
- **Beitragsversuche:** Jeder Spieler hat **5 Beitragsversuche**, +1 zu festen Zeitpunkten (gleiche Logik wie Dungeon-Schlüssel).
- **Kosten:**
  - Kosten einer Stufe = `base_gold_cost × cost_growth^Stufe`.
  - Ein Beitrag zahlt `Stufenkosten / attempts_per_tier` (meist 25 Beiträge pro Stufe).
  - Reicht das Gold nicht, ist der Versuch trotzdem verbraucht.
- **Voraussetzungen:** Ein Knoten verlangt, dass alle Vorgänger-Knoten voll ausgebaut sind (`prereq_not_met`).
- **Max. Stufe:** 5 (Schalter-Knoten 1). **Kein Paragon** in v3.
- **Wirkungen (live):**

  | Kategorie | Knoten und Wirkung pro Stufe |
  |---|---|
  | Wachstum | Gold +10,5 %; EP +7 %; Prestigebonus +3,5 % (wirkt wie zusätzliche Prestige-Stufen); Runenglück +10,5 %; Gilden-Autokauf +10 Käufe; Brutbeschleuniger +7 % (Brutzeit und Opfergabe); Gildenschmiede −7 % Runenkosten (max. 40 %); Nachtwache +2,5 h Offline-Deckel; Aufstiegsvorbereitung −6 % Aufstiegsschwellen (max. 35 %); Streak-Schutz (eine ausgelassene Login-Serie senkt nur um 1 statt zurückzusetzen); Willkommenspaket (Neumitglieder 3 Tage +10 % Angriff/Verteidigung/Gold) |
  | Schlacht | Angriff +7 %; Verteidigung +7 %; Krit-Chance +2,1; Krit-Schaden +14 %; Bossschaden +17,5 %; Turm-Vorreiter (+0,25 % pro 10 Turmstufen des besten Mitglieds, max. 50 %); Kriegsrat +3 Arena-Angriffe/Tag; Stadtmauer +5 % eigener Raid-Stadt-HP-Beitrag |
  | Drachenzucht | Zuchtkraft/-panzer/-vitalität je +8 % Begleiter-Angriff/-Verteidigung/-Leben; Zuchtmeisterschaft +5 % auf alle drei |

- **Rangliste:** Technologie-Spender (`guild_members.tech_contributed_gold`).
- **Speicherung:** `guild_tech_nodes` (Katalog), `guild_tech_progress` (Gilde × Knoten: Stufe + Fortschritt), `guild_tech_contributor_attempts`.
- **Altes System:** Die Tabelle `guild_tech_levels` des alten Systems „Führung kauft aus der Kasse“ existiert weiter, wird vom Client aber nicht mehr genutzt.

## 7.5 Gildenboss (Tab „Gildenboss“) [SQL]

- **Zeitplan:** täglich **19:55–20:00 Vorbereitung, 20:00–21:00 Kampf** (Europe/Berlin), einmal pro Tag und Gilde. In dieser Stunde pausiert der Weltboss.
- **Boss:** live „Malthyros, der Weltenverschlinger“.
  - Leben = `max(2.000.000, Gesamt-Angriff der ganzen Gilde × 150)`.
  - Kein Gegenangriff; reiner Schadens-Wettlauf.
- **Schaden:** Auto-Kampf alle 2,5 s + Klicks. Der Browser sendet die Schadenswerte, der Server prüft nur 1–200.000 pro Aufruf.
- **Belohnung bei Sieg:**
  - **5.000.000 Gold + 20.000 Kristalle**, **anteilig nach Schaden** an alle Teilnehmer mit Schaden > 0.
  - Dazu **5 % Chance** pro Teilnehmer auf ein zufälliges, noch nicht besessenes Plüschtier (Code „GILDE-…“).
- **Speicherung:** `guild_boss_instances`, `guild_boss_participants`, `guild_boss_player_stats`, `guild_boss_reward_codes`.

## 7.6 Gildenquests [SQL]

- **Tägliche Quests:** jeden Tag **3 Quests pro Gilde** (Stufe 1–3), zufällig aus 4 Arten:

  | Art | Ziel |
  |---|---|
  | Drachen besiegen | 300–799 |
  | Gold sammeln | 1–5 Mio. |
  | Arena-Siege | 50–149 |
  | Prestige-Aufstiege | 5–19 |

- **Fortschritt:** Die Mitglieder schieben ihren Fortschritt über den Autosave nach (`guild_quest_contribute`).
- **Belohnung für jedes Mitglied** bei Abschluss:

  | Stufe | Belohnung |
  |---|---|
  | 1 | 2.000 Gold + 20 Kristalle |
  | 2 | 6.000 Gold + 50 Kristalle + 1 blaue/lila Rune |
  | 3 | 15.000 Gold + 100 Kristalle + 1 **legendäre Rune** (Wert 10) + 10 Prestige-Punkte |

- **⚠ Abweichung:** Die Oberfläche kündigt für Stufe 3 „🥚 Legendäres Ei“ an, die Datenbank vergibt eine legendäre **Rune** (siehe Kap. 19).

## 7.7 Gildenchat, Banner, Ziel, Log, Online-Anzeige

- **Chat:** Nachrichten über RPC senden; löschen dürfen Veteran und höher. XSS-sicher, weil Inhalte nur als Text eingefügt werden.
- **Banner:** Farben und 16 Symbole (`update_guild_banner`).
- **Gildenziel:** Text (`update_guild_goal`).
- **Aktivitätslog:** `guild_activity_log`, z. B. Quest abgeschlossen, Beiträge.
- **Online-Anzeige:** Heartbeat alle **25 s** an `player_presence`; ein Spieler gilt bis 45 s danach als online. Der Heartbeat stoppt beim Logout.

## 7.8 Gilden-Arena (Tab „Gilden-Arena“) [SQL]

- **Gilden-Bestenliste** nach Gilden-XP.
- **Kampf Gilde gegen Gilde** (`guild_arena_attack`):

  | Regel | Wert |
  |---|---|
  | Wer darf angreifen | Anführer oder Stellvertreter |
  | Limit | **3 Angriffe/Tag** pro Gilde, **30 Min.** Abklingzeit pro Zielgilde |
  | Gildenmacht | Summe über alle Mitglieder: `max(1, Angriff×2 + Verteidigung + Leben×0,3)` |
  | Gewinnchance | Eigene Macht / (eigene + gegnerische) |
  | Wertung | ELO (K = 32) |
  | Sieg | `max(50, gegnerische Macht × 8)` Gold in die **eigene Gildenkasse** |
  | Niederlage | kein Kassenverlust |

- **Darstellung:** Kampfanimation mit Gilden-Abzeichen.
- **Speicherung:** `guild_ratings`, `guild_battle_log`.

---

# 8. Herausforderungen

## 8.1 Dungeons (Tab „Dungeon“) [Code + SQL]

**7 Typen:**

| Typ | Belohnung |
|---|---|
| 💰 Gold | Gold, mit Säckchen/Truhe; EP = Gold/4 |
| ⭐ EXP | EP; Gold = EP/3 |
| 🥚 Ei | Hauptquelle für Eier |
| 🍖 Fleisch | Fleisch (bis Lagerdeckel) |
| 🍎 Früchte | Früchte (bis Lagerdeckel) |
| 💎 Edelstein | Kristalle |
| 🔮 Runen | blaue bis legendäre Runen |

**4 Schwierigkeiten** (jede nächste erst nach Abschluss der vorherigen; serverseitig in `dungeon_progress`):

| Schwierigkeit | Wellen | Wellen-Wachstum | Belohnungs-Mult. |
|---|---|---|---|
| 🟢 Leicht | 10 | 1,24 | 1,0 |
| 🟡 Mittel | 15 | 1,30 | 1,3 |
| 🟠 Schwer | 20 | 1,36 | 1,7 |
| 🔴 Albtraum | 25 | 1,42 | 2,2 |

**Gegner pro Welle:**
- Standard-Drachen der Reihe nach.
- Kampf-Multiplikator = `min(3, Wellen-Wachstum^(Welle−1) ^ 0,55)`.
- **Leben:** `eigener Angriff × 4 × Mult.`
- **Angriff:** `eigene Max-Leben × 0,06 × Mult.`
- **Verteidigung:** `eigene Verteidigung × 0,3`
- Halbe Strecke: Wellen-Elite ×1,15; letzte Welle: Dungeon-Champion ×1,3.
- Nach jeder Welle **+30 %** Leben fürs Dorf. Eine Niederlage beendet den Lauf (anteilige Belohnung).

**Belohnung** (kontinuierliche Arten):
- Grundformel: `Summe über Wellen (Basis × (1 + 0,08 × (Welle−1))) × Belohnungs-Mult.`, bei vollem Erfolg ×1,2.
- **Basis pro Welle** (abhängig vom eigenen Angriff):

  | Typ | Basis |
  |---|---|
  | Gold | Angriff × 5 |
  | EP | Angriff × 3 |
  | Fleisch/Frucht | Angriff × 0,5 (+ Gold mit Angriff × 0,6) |
  | Edelstein | Angriff × 0,005 (+ Gold mit Angriff × 1,2) |
  | Ei/Rune | Gold mit Angriff × 1,2 |

- **Zuschläge:**

  | Zuschlag | Regel |
  |---|---|
  | Tagesbonus | Erster Lauf pro Tag und Typ ×1,5, beim Ei-Dungeon +1 Ei, beim Runen-Dungeon +1 Rune; serverseitig vergeben (`dungeon_claim_daily_bonus`) |
  | Wochen-Dungeon | Ein Typ pro 7-Tage-Block (rotierend): **×1,5** |
  | Säckchen | Gold-Dungeon: 15/25/35/45 % Chance auf ×1,15 |
  | Truhe | Gold-Dungeon: 2/5/9/14 % Chance auf ×1,4 |
  | Booster | 0/3/6/10 % Chance auf Goldrausch bzw. Wissensschub |
  | Prestige | „Dungeonjäger“, „Bosskammer“, „Seltene Funde“ |

- **Runen-Dungeon:**
  - 1/1/2/2 Runen je nach Schwierigkeit.
  - Seltenheit blau/lila/gold: Leicht 80/19/1, Mittel 55/40/5, Schwer 40/50/10, Albtraum 15/55/30.
  - Albtraum garantiert mindestens 1 epische Rune.

**Schlüssel:**
- **5 pro Typ**, +1 zu festen Uhrzeiten **0/4/8/12/16/20 Uhr (Berlin)**, für alle Spieler gleich.
- Max. 5 + Meilenstein (+1) + Schlüsselbund (+1 bis +3).
- Verwaltung komplett serverseitig (`dungeon_get_all_status`, `dungeon_consume_key`, `dungeon_regen_calc`, Tabelle `dungeon_keys`). Die Uhr des Browsers spielt keine Rolle.

**Weitere Funktionen:**
- **Auto-Läufe:** X Läufe nacheinander; stoppt bei der ersten Niederlage. Mit Prestige-Knoten unbegrenzt bis die Schlüssel leer sind.
- **Persönliche Bestzeiten** in `localStorage`.
- **Dungeon-Bestenliste** in `idle_dungeon_results`.
- Der Erfolg „Dungeon-Meister“ verlangt Albtraum.

## 8.2 Endloser Turm (Tab „Turm“) [Code]

- **Versuche:** **1 Versuch pro Tag** (Kalendertag Berlin; nur clientseitig geprüft über `turm_last_attempt_at`).
- **Gegner:** wie im Dungeon, aber Wellen-Wachstum 1,05, Dämpfung 0,55, Gegner-Angriff 0,06 × Leben. Jede 5. Stufe Turmwächter ×1,2. Nach jeder Stufe +30 % Leben.
- **Belohnung:**

  | Wann | Belohnung |
  |---|---|
  | Pro Stufe | Gold = Angriff × 0,8, EP = Angriff × 0,4 |
  | Jede 5. Stufe | `ceil(Stufe/5) × 2` Kristalle |
  | Jede 25. Stufe | 1 Rune |
  | Jede 50. Stufe | 1 Rune + 1 Ei (Qualität nach Stufe: ab 25/50/100 bessere Tabelle) |

- **Ende:** Der Lauf endet mit der Niederlage oder per „Aufgeben“.
- **Rekord:** `turm_highest_wave` (Bestenliste, Gilden-Tech „Turm-Vorreiter“, Erfolge).
- **Gesperrt** während Dungeon, Raid und Event-Drachen.

## 8.3 Arena (Tab „Arena“) [SQL `arena_attack`]

- **Gegnerauswahl:** bis zu 200 Spieler mit Fortschritt, angereichert um Rating und Sieg/Niederlage. Jede Karte zeigt die **Gewinnchance** (gleiche Formel wie der Server).
- **Kampfmacht und Ausgang:**
  - Macht = `Angriff×2 + Verteidigung + Leben×0,3` (aus `idle_player_state`).
  - Gewinnchance = eigene / (eigene + gegnerische) Macht; danach ein **echter Zufallswurf**.
  - Wertung ELO **K = 32**, Start 1000.
- **Belohnung:** Sieg = `max(5, gegnerische Macht × 0,8)` Gold (serverseitig gutgeschrieben); Niederlage ohne Verlust.
- **Limits:**
  - **10 Angriffe pro Tag** (+ Gilden-Tech Kriegsrat bis +15), Tageswechsel Berlin.
  - **3 Minuten** Abklingzeit pro Ziel.
  - Selbstangriff und Ziele ohne Fortschritt sind nicht möglich.
- **Darstellung:** Kampfanimation Dorf gegen Dorf (mit Skins); Kampf-Log.
- **Speicherung:** `arena_ratings`, `arena_battle_log`.

## 8.4 Weltboss / Raid [SQL + Code]

**Zeitplan:**
- **Jede volle Stunde** ein Raid: **5 Min. Vorbereitung** (beitreten), dann **55 Min. Kampf**.
- **Pause um 20 Uhr** (Berlin) wegen Gildenboss.
- Die Raid-ID ergibt sich aus der Uhrzeit. Ein Admin kann einen Test-Raid starten (`admin_start_test_raid`).

**Boss:** live **Zerathor, Zorn der Verdammnis**.
- **Leben** = `max(10.000, Gesamt-Angriff aller Teilnehmer × 150)`.
- **Stadt-Leben** = Summe der Leben aller Teilnehmer (+ Gilden-Tech „Stadtmauer“).

**Kampf:**
- Eigener Auto-Schaden alle 2,5 s + Klicks (+ Leertaste). Der Browser sendet die Schadenszahl, der Server prüft nur 1–200.000 pro Aufruf und die Teilnahme.
- **Gegenangriffe auf die Stadt:**
  - Bei jedem 5-%-Fortschritt des Boss-Lebens **und** zeitgesteuert.
  - Intervall `max(1,5 s, 6 s × Boss-Leben%)`.
  - Je **1,4 %** des Stadt-Lebens.
  - Stadt bei 0 → verloren.
- **Abfragen:** Boss-Stand alle 1,5 s, Teilnehmer alle 3 s.
- **Ansicht:** Während des Raids ersetzt die Raid-Ansicht das normale Kampffeld. Leiste: „Auto-Kampf aktiv“ + Klickzähler.

**Belohnung bei Sieg** (`raid_finish`):

> **⚠ Wichtig – zwei Fassungen:** Die zuletzt ausgeführte SQL-Datei `sql/20260927-remove-daily-event-add-boss-plushie-drops.sql` (live bestätigt über die Existenz der Tabelle `guild_boss_reward_codes`) zahlt **jedem Teilnehmer pauschal die volle Belohnung**: 1.500.000 Gold, 1.000 Kristalle, 150.000 EP. Dazu kommt die MVP- und „Ohne Schaden“-Statistik.
>
> Die ältere Fassung `supabase-raid-boss-reward-share.sql` verteilte **anteilig nach Schaden** und gab zusätzlich 50.000 Holz, 50.000 Stein, 2.000 Essenz, 30 Min. Booster sowie **1 % Chance auf den Dorf-Skin „Zerathor Dorf“**. Diese Teile fehlen in der neuen Fassung.
>
> Der Gildenboss verteilt weiterhin anteilig. Ob das gewollt ist, ist **[unklar]** (siehe Kap. D).

**Weitere Drops:**
- 5 % Chance auf das Plüschtier „Zerathor, Zorn der Verdammnis“, falls noch nicht im Besitz.
- **Zusätzlich** 5 % Chance auf ein zufälliges anderes Plüschtier aus dem Pool (ohne kora, zerathor, randomauto, jakecrayson).
- Codes erscheinen im Ergebnisfenster.

**Statistik und Automatik:**
- Raid-Statistik (`raid_player_stats`): Schaden gesamt, Bosse besiegt, Teilnahmen, bester Raid, MVP-Anzahl, Siege ohne Schaden, Klicks.
- Automatischer Beitritt über den Prestige-Knoten + Schalter.

---

# 9. Erfolge und Titel

Die vollständigen Listen stehen in den Anhängen A1–A5.

## 9.1 Erfolge (seitenweit, 431 + Streamer-Erfolge)

**Ein gemeinsames System:** Website und Idle-Dorf teilen sich **eine** Erfolgsliste. Sie wird beim Laden in `bkmpBuildAchievementsList()` (js/core/bkmp-site.js) zusammengesetzt aus festen Einträgen, Stufen-Reihen (`bkmpTieredAchievements`) und Erweiterungslisten der Spielmodule (`BKMP_IDLE_ACHIEVEMENTS_EXTRA`, Raid, Arena, Gilde, Jake's Feldfahrt).

**Kategorien (Anzahl):**

| Kategorie | Anzahl | Kategorie | Anzahl |
|---|---|---|---|
| Idle Dorf | 102 | Bonk | 30 |
| Drachenzucht | 12 | Karten | 24 |
| Runen | 58 | Kartenideen | 24 |
| Weltboss | 7 | Feedback | 20 |
| Arena | 5 | Easter Eggs | 22 |
| Gilde | 13 | Meilensteine (Anzahl anderer Erfolge) | 14 |
| Jake's Feldfahrt | 10 | Plüschtiere | 10 (+1 pro Plüschtier, s. u.) |
| Zeit & Treue | 57 | Vielfalt | 8 |
| BK-Mod & Shops | 7 | Sonstiges | 8 (+1 pro Creator) |

**Dynamische Einträge:**
- Pro Plüschtier entsteht ein Erfolg „???? Plüshie“, dazu „Besitze sie alle“.
- Pro Creator in `streamer_links` (sofern `countsForAchievement`) ein „<Name>-Fan“ + „Streaming-Marathon“.

**Freischaltung:** Die Prüfung läuft **im Browser** gegen einen Kontext aus vielen Zählern (Website-Zähler + Idle-Caches + Gilden-/Raid-/Arena-Caches).
- Freigeschaltete Erfolge bleiben dauerhaft („sticky“).
- Freischaltzeitpunkte und schon gemeldete Erfolge stehen in `localStorage`; die Zähler werden über `player_stats` synchronisiert.
- Popups mit Konfetti in einer Warteschlange.
- **Versteckte Erfolge** zeigen „???“ und einen Hinweis, bis sie gefunden sind.

**Belohnung:**
- Erfolge selbst geben **keine** Ressourcen.
- Sie zählen für Website-Titel und Namensrahmen (`unlockAt` = Anzahl Erfolge).
- Einige Erfolge sind über **gleichnamige Idle-Titel** mit einem Dauerbonus verknüpft; die Erfolgskarte zeigt diesen Bonus an (`bkmpAchievementLinkedTitleBonus`).

**Nicht mehr erreichbar:** `daily_event_1/5/15` und `golden_hour_win` (das tägliche Code-Event wurde am 27.09.2026 entfernt). Wer sie schon hat, behält sie.

## 9.2 Titel

| Art | Anzahl | Bonus | Freischaltung |
|---|---|---|---|
| **Website-Titel** | 112 | reine Anzeige | über Erfolgsanzahl, bestimmte Erfolge, Easter Eggs |
| **Idle-Titel** | 175 | 150 mit **Dauerbonus** | Spielzähler (Drachen-Siege, Level, Gold, Prestige, Runen, Turm, Arena, Raid, Gilde, Chronik …) |

- **Idle-Titel-Boni:** **alle** freigeschalteten Boni wirken gleichzeitig.
- **Bonus-Arten der Idle-Titel:**

  | Bonus-Art | Anzahl Titel |
  |---|---|
  | Angriff % | 40 |
  | Beute % | 27 |
  | Gold % | 22 |
  | EP % | 16 |
  | Leben % | 10 |
  | Krit-Chance | 10 |
  | fester Angriff | 9 |
  | Krit-Schaden % | 8 |
  | feste Verteidigung | 3 |
  | festes Leben | 3 |
  | Bossschaden % | 2 |

- **Anzeige:** Ein Titel wird als aktiver Anzeigetitel ausgewählt (`localStorage`).
- **Freischaltzeit:** Freischaltzeitpunkte der Idle-Titel stehen in `idle_player_state.titles_unlocked_at` (JSON), die der Idle-Kosmetik in `cosmetics_unlocked_at`.

## 9.3 Kosmetik

- **Website-Namensrahmen (55):** z. B. Schatten, Gold-Glanz, Eis-Blau, Aurora, Bonk-Stufen, Feuer-Rahmen (Easter Egg), Regenbogen. Freischaltung über Erfolgsanzahl, Easter Eggs oder Erfolge. Aktiv per `localStorage`.
- **Idle-Kosmetik (28 Namensfarben):** z. B. „Rot → Grün“ ab 20 Drachen-Siegen.

---

# 10. Chronik des Drachendorfs (03.10.2026)

**Datei:** `js/systems/bkmp-chronicle.js`, Stil in `css/bkmp-chronicle.css`.

**Zugang:**
- **Desktop:** Karte „Tagesaufträge“ in der rechten Kampfspalte, mit Knopf „Chronik öffnen“ + Kurzlinks 📅 Kalender · 📖 Bestiarium · 🎯 Ziele.
- **Handy/App:** 📜-Knopf im kompakten HUD mit Zähler für abholbare Belohnungen.
- **Fenster:** 4 Reiter (Aufträge, Kalender, Bestiarium, Ziele). Es baut sich nur bei echter Änderung neu auf und nicht, während die Maus darin ist.

## 10.1 Belohnungseinheit

**Eine** Einheit für alle Chronik-Belohnungen:
- Gold/EP = Belohnung eines Standard-Drachen auf der **persönlichen Höchststufe**.
- Kristalle/Essenz = Belohnung eines **Bosses** auf dieser Stufe.
- Untergrenze 5/5/2/1.
- Truhen-Qualität nach Lebenszeit-Stufen: ab 250 / 1.000 / 3.000 bessere Tabelle.

## 10.2 Tagesaufträge (3) und Wochenziele (3)

**Auftragsarten:**

| Auftrag | Tag | Woche | Gewicht |
|---|---|---|---|
| Drachen besiegen | 400 | 6.000 | 10 |
| Bosse/Minibosse besiegen | 12 | 150 | 8 |
| Gold verdienen | 500 Einheiten | 8.000 Einheiten | 9 |
| Kampfzeit | 15 Min. | 3 Std. | 7 |
| Upgrade-Stufen kaufen | 30 | 300 | 7 |
| Runen-Aufwertungen versuchen | 8 | 50 | 6 (nur mit Runen) |
| Klick-Angriffe | 150 | 1.500 | 6 |
| Dungeon-Läufe | 2 | 14 | 7 |
| Turmstufen | 15 | 100 | 6 |
| Weltereignisse | 2 | 15 | 7 |
| Babydrachen füttern | 3 | – | 5 (nur mit Baby) |
| Arena-Kämpfe | 2 | 12 | 4 |

**Auswahl:**
- **Deterministisch** pro Spieler + Tag bzw. Woche (gleiches Zufallsverfahren wie Event-Drachen); ein Reload würfelt nicht neu.
- Nicht verfügbare Arten werden übersprungen.
- **Neuwürfeln:** 1× pro Tag kostenlos (ein nicht erledigter Tagesauftrag).

**Fortschritt:**
- Die 6 Zähler-Arten nutzen ein **Delta-Verfahren** auf bereits gespeicherten Zählern (alle 4 s). Dadurch **zählt Offline-Fortschritt mit**; sinkende Zähler (Prestige) setzen nur die Basis neu.
- Die anderen Arten melden sich direkt aus ihren Systemen.

**Belohnungen:**

| Was | Belohnung |
|---|---|
| Tagesauftrag | Gold ×250, EP ×200, Kristalle ×2 |
| Wochenziel | Gold ×1.500, EP ×1.200, Kristalle ×8, Essenz ×5 |
| **Tagestruhe** (alle 3 erledigt) | Kristalle ×4, Essenz ×3, 1 Rune, zufälliger Booster |
| **Wochentruhe** | Kristalle ×15, Essenz ×10, 2 Runen (eine Qualitätsstufe besser), 1 Drachenei, beide Booster |

## 10.3 Login-Kalender

- **Ersetzt** die alte feste Login-Belohnung (`min(10.000, 500 × Tag)` Gold + 10 Kristalle jeden 5. Tag). Die alte Formel bleibt als **Untergrenze**.
- **7-Tage-Zyklus** (Faktoren × Einheit):

  | Tag | Belohnung |
  |---|---|
  | 1 | Gold ×80 |
  | 2 | Gold ×110 + EP ×100 |
  | 3 | Kristalle ×2 + Essenz ×2 |
  | 4 | Gold ×140 + Goldrausch 30 Min. |
  | 5 | Gold ×80 + Kristalle ×4 |
  | 6 | EP ×200 + Wissensschub 30 Min. |
  | 7 | Gold ×220 + Kristalle ×5 + Essenz ×4 + 1 Rune |

- **Treuebonus:** +10 % pro vollendeter Woche, max. +50 %.
- **Serie:** Die Login-Serie liegt weiter im alten Schlüssel `localStorage` `bkmp-idle-login-streak`, weil Erfolge sie lesen. Zusätzlich wird sie in `idle_player_meta` gespiegelt; beim Laden wird der neuere Server-Stand übernommen.
- **Verpasster Tag:** Die Serie beginnt bei 1. Mit Gilden-Tech „Streak-Schutz“ sinkt sie nur um 1.

## 10.4 Bestiarium

Beschrieben in Kap. 5.9.

## 10.5 Weltereignisse

**Wann sie erscheinen:**
- Nur während man dem Kampf **zuschaut**, nicht in Dungeon, Turm, Raid oder während eines Event-Drachen.
- Erste Prüfung nach 60 s, dann alle 10 s **6 %** Chance, **150 s** Abklingzeit (im Schnitt etwa alle 5 Min.).

**Arten:**

| Ereignis | Gewicht | Wirkung |
|---|---|---|
| 📦 Schatztruhe | 30 | Klicken (12 s): Gold ×60 + Kristalle |
| 🌠 Sternschnuppe | 20 | Klicken (7 s): EP ×80 + Essenz |
| 🧙 Wandernder Händler | 10 | Nur ab 200 Holz und 200 Stein: tauscht 20 % Holz+Stein gegen Kristalle (Einheit ×4, mind. 8) + Essenz (Einheit ×3, mind. 4); Bestätigungsdialog |
| 💰 Goldregen | 15 | 90 s doppeltes Gold |
| 📚 Weisheitswind | 15 | 90 s doppelte EP |
| 🔥 Kampfrausch | 10 | 60 s +50 % Schaden (nie mehr Treffer) |

Buffs gelten nur für die laufende Sitzung und werden nicht gespeichert.

## 10.6 Ziele-Übersicht

Zeigt: nächsten Boss, Prestige-Bereitschaft, nächsten Upgrade-Meilenstein, nächste Titel, Turm-Rekord, Drachen-Dex und Bestiarium. Jeder Eintrag hat einen „Los →“-Sprung zum passenden Tab.

## 10.7 Erfolge und Titel der Chronik

- **9 Erfolge:**
  - Auftragnehmer (1), Zuverlässiger Held (25), Chronist (100 Aufträge)
  - Wochenwerk (1), Unermüdlicher Planer (10 Wochentruhen)
  - Glückspilz (10), Ereignisjäger (100 Weltereignisse)
  - Drachenkundler (10), Meister des Bestiariums (30 Bestiarium-Stufen)
- **4 Titel:**

  | Titel | Bonus |
  |---|---|
  | Chronist | +5 % EP |
  | Unermüdlicher Planer | +5 % Gold |
  | Ereignisjäger | +5 % Beute |
  | Meister des Bestiariums | +5 % Angriff |

## 10.8 Speicherlogik und Schutz gegen doppelte Auszahlung

**Speicherorte:**
- Tabelle **`idle_player_meta`**: eine JSON-Zeile pro Konto, Schlüssel `auth_user_id` (umbenennungssicher), RLS nur eigene Zeile, Größe max. 64 KB [live vorhanden].
- **Fallback:** `localStorage` `bkmp-idle-chronicle-v1:<name>`. Fehlt die Tabelle, läuft alles lokal.

**Zusammenführen** (`bkmpChronicleMerge`): Fortschritt = Maximum, „abgeholt“ = ODER, Zeitraum mit dem neueren Schlüssel gewinnt, Bestiarium = Maximum pro Art.

**Speicherzeitpunkte:** lokal nach 1,5 s, Server nach 20 s.

**Doppel-Abhol-Schutz:** **Vor jedem Abholen** wird der Server-Stand neu geladen und eingemischt. Was auf einem anderen Gerät schon abgeholt wurde, zahlt nicht noch einmal.

**Vertrauen:** Die Auszahlung selbst passiert im Browser über die bestehenden Wege (Gold/EP/Runen/Eier/Booster). Es gibt **keine** serverseitige Auszahlungs-Prüfung. Die Server-Grenze kommt nur indirekt über den Anti-Cheat-Trigger (Kap. 12).

---

# 11. Offline-System

## 11.1 Kampf-Offline-Belohnung (serverseitig, `api/claim-idle-offline-progress.js`)

**Ablauf:**
1. Die Funktion wird beim Öffnen des Spiels und beim Zurückkehren in den Tab aufgerufen (POST mit Spieler-Token).
2. Der Server prüft das Token (`/auth/v1/user`) und lädt den Spielstand **über die geprüfte Konto-ID**, nicht über einen Namen vom Client.
3. **Abwesenheit:** `jetzt − last_seen_at`, nur aus der Datenbank, nie vom Client. Unter **60 s** gibt es keine Belohnung.
4. **Höchstdauer:** **12 h** [live `offline_progress.maxHours`] + Gilden-Tech „Nachtwache“ (+2,5 h/Stufe, max. +12,5 h).
5. Formel siehe 11.2.
6. **Atomarer Abschluss:** `PATCH … WHERE last_seen_at = <gelesener Wert>`. Parallele Aufrufe (zwei Tabs) bekommen die Belohnung nur einmal.

## 11.2 Formel

Seit 23.08.2026 gibt es **keine Simulation mehr**, sondern eine feste Formel.

| Größe | Regel |
|---|---|
| Gegner | Drache an der **Höchststufe** `highest_dragon_index` |
| Angenommenes Tempo | **1 Sieg pro 45 s** [live `offline_afk_reward.assumedSecondsPerKill`] |
| Sieg-Mischung | 88 % normal (davon 8 % selten), 8 % Miniboss, 4 % Boss; Boss ×4, Miniboss ×2 |
| Gold/EP | wachsen mit der Stufe, × eigener Gold-/EP-Bonus |
| Holz/Stein/Kristalle/Essenz | Durchschnitt der Basiswerte × Beute-Bonus |
| Effizienz | **75 %** [live] + Skill „Offline-Einnahmen“ (`wirt_offline`): **+5 % pro Rang, nur die ersten 6 Ränge zählen**, max. 100 %. Die Beschreibung des Skills sagt „+1,25 %/Rang“ (Abweichung, Kap. 19). |
| Level | Level-Ups durch die EP werden auf dem Server berechnet (+ Skillpunkte) |
| Zähler | `dragon_kills` und `boss_kills` werden erhöht |
| Protokoll | `last_offline_claim` speichert die Details |
| Begleiter-EP | Jugendlicher Trainings-Begleiter: **8 Kampf-EP pro Stunde** [live], gedeckelt |

## 11.3 Was offline **nicht** simuliert wird

| Nicht offline | Grund / Ersatz |
|---|---|
| Stufen-Fortschritt | Aktuelle und Höchststufe bleiben gleich |
| Runen-Drops, Fundschätze, Event-Drachen, Weltereignisse | – |
| Bosse/Minibosse als echte Kämpfe | nur als Anteil in der Formel |
| Prestige-/Skill-Kampfboni außer Gold-/EP-/Beute-Bonus | – |
| Erwachsene Begleiter | – |
| Dungeon/Turm/Arena | Dungeon-Schlüssel regenerieren aber serverseitig weiter |
| Gildenquests, Gilden-Tech | – |
| Offline-Effizienz aus `offline_income_pct` | ohne Wirkung (Kap. 19) |
| Konfigurationswert `offline_floor` | wird nicht gelesen (Kap. 19) |

## 11.4 Offline-Teile im Browser

- **Produktionsgebäude, Obstgarten, Jagdhütte:** Rate × vergangene Zeit, max. **72 h** (+ Prestige „Zeitdehnung“), berechnet aus den `*_collected_at`-Zeitstempeln beim Laden.
- **Chronik:** Aufträge zählen über das Delta-Verfahren mit. Das **Bestiarium** verteilt die Offline-Siege nach den Spawnregeln.
- **Server-Ergebnis übernehmen:** `bkmpIdleApplyOfflineResult` übernimmt die **Summen** des Servers per `Object.assign`. Danach zeigt die **Offline-Karte** „Während deiner Abwesenheit…“ (Zeit, Gold, EP, Ressourcen, Siege, Level, Begleiter-EP).
- **Zeitsperre gegen den Wettlauf beim Aufwachen:** Beim Verstecken des Tabs wird das Schreiben von `last_seen_at` bis zu 15 s gesperrt. Ein eingefrorener Speicher-Timer, der beim Aufwachen feuert, kann die Abwesenheit so nicht auf „jetzt“ zurücksetzen.
- **OBS-Hintergrund-Nachholen:** Ist der Tab versteckt **und** ein OBS-Zuschauer verbunden, ruft der Browser alle 20 s die Offline-Formel auf. So sieht das Overlay laufenden Fortschritt.

---

# 12. Anti-Cheat und Server-Sicherheit

## 12.1 Fortschritts-Trigger auf `idle_player_state` (Postgres, `BEFORE UPDATE`)

Letzte Fassung: `sql/20260811-anticheat-guard-flag-insert-safety-net.sql`. Ob die Sicherheitsnetz-Version live ist, ist **[unklar]**, weil die Funktionsdefinition anonym nicht lesbar ist.

**Zeitbudget** = echte Server-Zeit seit der letzten Speicherung (`now() − updated_at`), mindestens 4 s.

| Prüfung | Grenze |
|---|---|
| Drachen-Siege | max. **3 pro Sekunde** (das Spiel kann höchstens 2,5/s) |
| Level-Zuwachs | max. 3/s + 500 Puffer |
| Skillpunkte-**Summe** (verfügbar + ausgegeben, damit ein Skill-Reset nicht zählt) | max. 3/s + 500 Puffer |

- **Bei Überschreitung:** Der **gesamte Zuwachs** dieser einen Speicherung wird anteilig gekürzt: Siege, Bosse, Gold, Gesamtgold, Holz, Stein, Kristalle, Essenz, EP, Level, Skillpunkte. Es wird nicht abgelehnt. Sinkende Werte (Ausgeben, Prestige) werden nie angefasst.
- **Absolute Obergrenzen für Kampfwerte** (unabhängig vom Vorwert):

  | Wert | Obergrenze |
  |---|---|
  | Angriff, Verteidigung | 1.000.000 |
  | Leben | 2.000.000 |
  | Krit-Chance | 100 |
  | Krit-Schaden | 5.000 |
  | Gold-, EP-, Beute-Bonus | je 10.000 |

- **Protokoll:** Jeder Treffer wird in `idle_anticheat_flags` vermerkt (nur Admin lesbar). Ein Fehler beim Protokollieren blockiert die Speicherung nicht (eigener Ausnahme-Block).
- **Bestenliste:** Die View `idle_player_state_leaderboard` blendet **nur manuell** ausgeblendete Konten aus (`idle_leaderboard_hidden_accounts`, Admin-Knopf). Alarme blenden **nicht** automatisch aus; das Auto-Ausblenden wurde am 11.08. nach 33 falschen Treffern entfernt.

## 12.2 Was der Server dem Browser NICHT glaubt

- **Identität:** Alle RPCs lesen `auth.uid()` selbst; RLS erzwingt „eigene Zeile“ bei Spielständen, Runen, Drachen, Meta.
- **Offline-Zeit** und Offline-Belohnung.
- **Arena:** Kampfmacht wird aus der Datenbank gelesen, Zufallswurf und Gold auf dem Server, Limits auf dem Server.
- **Gilden:** Rechte, Kasse, Kosten (Gründung, Plätze, Technologie-Beiträge inkl. Goldabzug), Mitgliederlimit, Quest-Belohnungen.
- **Raid/Gildenboss:** Teilnahme, Zeitfenster, Boss-/Stadt-Leben, Gegenangriffe, Ende, Belohnungsverteilung, Codes. Der **Schaden pro Aufruf** kommt aber vom Client (Grenze 200.000).
- **Dungeon:** Schlüssel (Zeit nach Server-Uhr), Freischaltung der Schwierigkeiten, Tagesbonus.
- **Codes/Echtgeld:** Plüschtier- und Skin-Codes, Stripe nur über den Webhook.
- **Event-Drachen:** einmaliger Sieg.
- **Kartenverkauf und Auszahlungen:** Sperren gegen Wettläufe, keine negative Verfügbarkeit.
- **BK-Mod:** Token nur als SHA-256-Hash gespeichert, Ratenbegrenzung (`mod_rate_limit_events`, `check_and_record_rate_limit`).
- **Namen:** Sperrliste, Umbenennen nur über RPC.

## 12.3 Was im Browser berechnet und nur indirekt geschützt ist

| Bereich | Schutz |
|---|---|
| Kampf, Belohnungen, Level, Ressourcen-Zuwachs | nur Zeitbudget-Trigger (12.1) |
| Upgrades, Gebäude, Überladung, Skilltree, Prestige-Baum und -Reset | keine Plausibilitätsprüfung; RLS nur eigene Zeile. Prestige-Zeile ist frei beschreibbar (`prestige_points` u. a.). |
| Runen (Würfe, Werte, Aufwertung, Verschmelzung) | nur RLS |
| Drachenzucht (Brutzeit, Wachstum, Werte-Würfe, Füttern, Aufstieg) | nur RLS |
| Chronik-Auszahlungen, Login-Kalender | Doppel-Abhol-Schutz nur über das Meta-Zusammenführen |
| Turm (1 Versuch/Tag) | nur clientseitig |
| Autoklicker-Schutz | nur clientseitig (`localStorage`) |
| Erfolge und Titel (Freischaltung) | Prüfung im Browser |

---

# 13. Datenbank

**Alle unten genannten Tabellen existieren live** (am 03.10.2026 lesend geprüft: 99 Tabellen + 2 Views).

**Allgemeines RLS-Muster:**
- **Öffentliche Inhalte:** alle dürfen lesen, schreiben nur Admins (`is_active_admin()`).
- **Spielerdaten:** meist öffentlich lesbar (für Bestenliste und Arena), Schreiben nur eigene Zeile (`auth_user_id = auth.uid()`), Löschen nur Admin.
- **Wettbewerbs-/Geldsysteme:** keine direkten Schreibrechte, nur `security definer`-RPCs.
- **Einreichungen:** anonymes Einfügen bzw. über `api/submit-entry`.

## 13.1 Idle-Dorf-Kern

| Tabelle | Zweck | Wichtigste Felder / JSON | RLS / Zugriff |
|---|---|---|---|
| **`idle_player_state`** | Kompletter Spielstand, eine Zeile pro Spieler (70+ Spalten) | `auth_user_id`, `name_key`, `display_name`, `level`, `xp`, Ressourcen (`gold`, `wood`, `stone`, `crystals`, `essence`, `fruit`, `meat`, `mana`), `total_gold_earned`, gespiegelte Kampfwerte, `skill_points_*`, **JSON:** `skill_allocations`, `upgrade_purchases`, `last_offline_claim`, `titles_unlocked_at`, `cosmetics_unlocked_at`, `dragon_species_discovered_at`; Zähler (`dragon_kills`, `boss_kills`, `village_defeats`, `yaksha_boss_kills`, `rune_*_successes/failures`, `playtime_seconds`), Stufen (`current/highest_dragon_index`, `prestige_stage_offset`, `auto_advance`), Gebäude (`*_level`, `*_collected_at`), `boost_*_until`, `turm_highest_wave`, `turm_last_attempt_at`, `last_seen_at`, `last_skilltree_reset_at`, `active_village_skin`, `dragon_storage_expansions_bought`, `updated_at` | Lesen öffentlich; Einfügen/Ändern nur eigene Zeile; **Anti-Cheat-Trigger**; Bestenlisten-View darauf |
| **`idle_player_meta`** | Nicht spielkritische Zusatzdaten als JSON; aktuell die **Chronik** | `auth_user_id` (PK), `name_key`, `data` (JSONB: Tag/Woche, Aufträge, Truhen, Kalender, Login-Serie, Bestiarium, Zähler), `updated_at` (Trigger `idle_player_meta_touch`) | nur eigene Zeile (anonym gesperrt), Größe max. 64 KB |
| `idle_prestige_state` | Prestige | `prestige_level`, `prestige_points`, `prestige_points_spent`, `prestige_allocations` (JSON inkl. `__dragon_souls`, `__ascension_level`, `*__paragon`) | Lesen öffentlich, Schreiben eigene Zeile |
| `idle_player_runes` | Runen | `rune_type`, `rarity`, `rolled_value`, `upgrade_level`, `substats` (JSON), `equipped`; Eindeutigkeit „1 ausgerüstet pro Art“ | eigene Zeilen |
| `idle_village_skins` / `idle_player_village_skins` | Skin-Katalog / Besitz | `unlock_type`, `price_gold`, `price_eur_cents`, `video_file`, `apply_scope` / `skin_id` | Katalog öffentlich / Besitz eigene |
| `idle_dragons`, `idle_skill_nodes`, `idle_game_config` | Stammdaten: Kampf-Drachen, Skilltree, Konfiguration (JSON-Werte) | – | Lesen öffentlich, Schreiben Admin |
| `idle_event_dragon_state` | Besiegte Event-Drachen | `shenloss_defeated(_at)`, `liber_defeated(_at)` | RPC `idle_claim_event_dragon_victory` |
| `dungeon_keys`, `dungeon_progress`, `dungeon_daily_bonus` | Schlüssel pro Typ, freigeschaltete Schwierigkeit/Läufe, Tagesbonus | `keys` (0–100), `last_key_at` | eigene lesen; Schreiben nur über RPCs |
| `idle_dungeon_results` | Dungeon-Bestenliste | Zeit, Wellen, Typ, Schwierigkeit | – |
| `idle_anticheat_flags` | Anti-Cheat-Alarme | `triggered_by`, Details (JSON), `dismissed` | nur Admin |
| `idle_leaderboard_hidden_accounts` | Manuell ausgeblendete Konten | – | nur Admin; View `idle_player_state_leaderboard` |
| `idle_stream_presence` | **[unklar]** – vorhanden, aber von keinem aktuellen Code genutzt (die OBS-Erkennung läuft über Realtime-Presence) | | |

## 13.2 Drachen

| Tabelle | Zweck |
|---|---|
| `dragon_species` | Zucht-Arten (Anhang A8) |
| `player_dragon_eggs` | Eier im Besitz |
| `player_dragon_nests` | Nester (Platz 1–5, `egg_id`, `started_at`) |
| `player_dragons` | Drachen (Stufe, Werte, Zusatzwerte JSON, Begleiter, Aufstieg, Name, Favorit) |
| `player_epic_egg_claims` | Einmal-Meilenstein „episches Ei“ (Funktion vorhanden, **ungenutzt**) |

## 13.3 Weltboss, Arena, Gilden

| Bereich | Tabellen |
|---|---|
| Weltboss | `raid_bosses` (Katalog), `raid_instances` (pro Stunde: Boss-/Stadt-Leben, Status `prep`/`fighting`/`won`/`lost`, Zeitpunkte, Gesamtschaden), `raid_participants` (Schaden, Klicks), `raid_player_stats` (Lebenszeit), `raid_reward_codes` |
| Arena | `arena_ratings`, `arena_battle_log` |
| Gilden | `guilds` (Name, Tag, Beschreibung, öffentlich/privat, `invite_code`, `treasury_gold`, `guild_xp`, `bonus_member_slots`, Banner, Ziel), `guild_members` (Rolle, Beitritt, `contributed_gold`, `tech_contributed_gold`), `guild_join_requests`, `guild_chat_messages`, `guild_activity_log`, `guild_daily_quests`, `guild_level_thresholds`, `guild_tech_nodes`, `guild_tech_progress`, `guild_tech_contributor_attempts`, `guild_tech_levels` (**alt**), `guild_bosses`, `guild_boss_instances`, `guild_boss_participants`, `guild_boss_player_stats`, `guild_boss_reward_codes`, `guild_ratings`, `guild_battle_log` |

## 13.4 Spieler, Website, Karten, Shops, Mod

| Bereich | Tabellen |
|---|---|
| Spieler | `player_stats` (Website-Zähler, Erfolgs-Kontext, `active_session_token`, Konto-Bindung), `player_name_history`, `blocked_display_names`, `player_presence` |
| Admin | `admin_profiles` (Rollen) |
| Plüschtiere | `plushies`, `plushie_codes` (auch Skin-Codes: `reward_kind`, `skin_id`), `user_plushies`, `daily_code_events` (**Altlast**, Event entfernt) |
| Echtgeld | `real_money_purchases` |
| Finanzen | `incomes`, `expenses`, `investors` (inkl. `paid_out`, `payout_proof_url`), `investor_requests`, `sw_daily_stats` |
| Inhalte | `updates` (News), `about_blocks`, `wishes`, `wish_votes`, `polls`, `poll_votes`, `streamer_links`, `site_flags` (Wartung, Schaf-Text) |
| Feedback | `feedback`, `feedback_public`, `feedback_public_progress`, `changelog_entries` |
| Karten | `card_catalog`, `card_submissions`, `card_teleport_events` |
| Kartenverkauf | `card_sales`, `card_sale_requests`, `card_sale_events`, `card_sellers`, `card_sale_payout_requests` |
| PartnerShops | `partner_shops`, `partner_shop_locations`, `partner_shop_revisions`, `partner_shop_revision_locations`, `partner_shop_reports`, `partner_shop_visit_events` |
| Kartenfirmen | `companies`, `company_applications` |
| **Altlast** altes Kartenauftrags-System | `map_orders`, `order_events`, `order_files`, `order_messages`, `order_read_state`, `customer_profiles`. Die Rückbau-Datei `supabase-mapart-orders-teardown.sql` würde sie löschen, **sie existieren aber live noch**. Kein Code nutzt sie. |
| BK-Mod | `mod_pairing_codes`, `mod_tokens` (Hash), `mod_rate_limit_events`; View `my_mod_connections` |

## 13.5 RPC-Funktionen (102)

| Bereich | Funktionen |
|---|---|
| Spiel | `arena_attack`, `idle_claim_event_dragon_victory`, `claim_epic_dragon_egg` (ungenutzt), `dungeon_regen_calc`, `dungeon_get_all_status`, `dungeon_consume_key`, `dungeon_mark_progress`, `dungeon_claim_daily_bonus`, `dungeon_daily_bonus_available`, `player_heartbeat` |
| Weltboss | `raid_join`, `raid_deal_damage`, `raid_boss_attack_tick`, `raid_finish`, `admin_start_test_raid` |
| Gildenboss | `guild_boss_join`, `guild_boss_deal_damage`, `guild_boss_finish` |
| Gilden | `create_guild`, `join_guild`, `join_guild_by_code`, `request_guild_join`, `cancel_guild_join_request`, `respond_guild_join_request`, `leave_guild`, `kick_guild_member`, `set_guild_member_role`, `contribute_gold`, `buy_guild_slot`, `get_my_guild_invite_code`, `regenerate_guild_invite_code`, `update_guild_settings`, `update_guild_banner`, `update_guild_goal`, `send_guild_chat_message`, `delete_guild_chat_message`, `guild_quest_ensure_today`, `guild_quest_contribute`, `guild_tech_contribute`, `guild_tech_attempt_status`, `guild_tech_upgrade` (alt), `guild_arena_attack`, `guild_level_for_xp` |
| Konten | `rename_player_account`, `resolve_login_name`, `delete_own_player_account`, `admin_delete_player_account`, `admin_list_recent_players`, `claim_player_row`, `is_name_blocked`, `block_forbidden_*` |
| Karten und Shops | `create_card_submission`, `approve_card_submission`, `record_card_teleport`, `get_trending_cards`, `get_card_teleport_stats`, Kartenverkauf (`request_card_sale_payout`, `process_card_sale_payout`, `get_my_card_sale_status`, `get_card_sale_public_stats`, `get_card_sale_daily_earnings`, `admin_add/remove_…_card_sale_event`), PartnerShops (`create_partner_shop_submission`, `submit/review_partner_shop_revision`, `report_partner_shop`, `record_partner_shop_visit`, `get_partner_shop_visit_stats`, `get_trending_partner_shops`, `list_my_partner_shop_*`) |
| Mod | `create_mod_pairing_code`, `exchange_mod_pairing_code`, `get_my_mod_account`, `list_my_mod_submissions`, `revoke_my_mod_token(_by_raw)`, `check_and_record_rate_limit` |
| Website | Umfragen und Wünsche (`activate_poll`, `bkmp_recompute_*`), Anfragen-Status (`get_*_request_status`) |
| Rechte und Trigger | `is_active_admin`, `is_expenses_editor`, `is_company_staff_of`, `is_order_participant`, `is_leaderboard_hidden`, `idle_player_state_anticheat_guard`, `idle_player_meta_touch`, `card_sales_sync_sold_count`, `sanitize_new_player_stats`, diverse `*_set_updated_at` |

**Edge-/Server-Funktionen:** Es gibt **keine** Supabase Edge Functions. Alle Server-Funktionen sind Vercel-Funktionen (Kap. 1.7).

---

# 14. Speicherung

## 14.1 Wann gespeichert wird

| Zeitpunkt | Was gespeichert wird |
|---|---|
| **Autosave nach jeder Zustandsänderung** | Debounce **4 s** (`bkmpIdleQueueSync` → `bkmpIdleFlushSync` → `upsertIdlePlayerState`). Schreibt den ganzen Spielstand (Spaltenliste `BKMP_IDLE_PLAYER_STATE_COLUMNS`) + `last_seen_at`. |
| **Sofort** | bei Prestige, Aufstieg, einigen Kauf-/Belohnungsaktionen (`bkmpIdleFlushSyncNow`) |
| **Tab wird versteckt / Seite verlassen** | `visibilitychange` (hidden), `beforeunload`: offene Speicherungen sofort, Runen-Speicherungen, Gildenquest-Deltas, Prestige |
| **Runen** | eigene Warteschlange (1,5 s); frische Drops ohne Datenbank-ID werden bei Aktionen sofort gespeichert; offene „Ausrüsten“-Schreibvorgänge werden beim Verstecken erneut gesendet (Map `bkmpRunePendingEquipWrites`) |
| **Drachen, Nester, Eier** | direkt pro Aktion über `supabase.js` |
| **Prestige** | `idle_prestige_state`, gebündelt (`bkmpPrestigeQueueSave`) |
| **Chronik** | `idle_player_meta` nach 20 s, lokal nach 1,5 s |
| **Website-Zähler** | `player_stats` (Erfolgs-Kontext, Zeit auf der Seite, Bonk-Zähler …), gebündelt |

**Gleichzeitige Speichervorgänge** werden hintereinander ausgeführt (`bkmpIdleFlushInFlight`). Ein Fehler zeigt höchstens alle 60 s einen Hinweis „Speichern fehlgeschlagen“.

## 14.2 `localStorage` (nur dieses Gerät)

| Art | Schlüssel/Inhalt |
|---|---|
| Komfort | Effektmodus + Einzelschalter, Theme/Akzentfarbe, aktiver Titel/Rahmen/Plüschtier, aktive Tabs/Reiter, Prestige-Infobereich auf/zu, Zweig-Priorität, Auto-Kauf + Ressourcen-Ausschluss, Runen-Automatik-Schalter, Auto-Schmelzen-Bestätigung, Auto-Weltboss-Beitritt, Log-Filter |
| Spielrelevant, nur lokal | Gebäude-Überladung, Runen-Ausrüstungsset, Login-Serie (gespiegelt in Meta), Autoklicker-Sperre/-Verlauf, Dungeon-Bestzeiten, Meister-Dialog gesehen, Paragon-Hinweis gesehen |
| Caches | Erfolgs-Kontext-Caches (Idle/Raid/Arena/Gilde), Gilden-Kassen-/Tech-Bonus-Cache, Chronik-Fallback, Website-Daten-Fallback (`app.js`) |
| Website | gefundene Easter Eggs, Besuchstage, Zeitzähler, Flags, Bonk-Zähler, Sitzungstoken, gemerkte Anfragen-IDs (für das Entscheidungs-Popup), gesehene News |

## 14.3 Mehrere Geräte und Konflikte

- **Eine aktive Sitzung pro Konto:** Ein neuer Login übernimmt die Sitzung, andere Geräte werden abgemeldet.
- **Grundsatz „letzter Schreiber gewinnt“:** Der normale Autosave überschreibt die ganze Zeile.
  - **Bekannter, offener Wettlauf:** Ein im Hintergrund vorgeladener zweiter Tab kann beim Neuladen einen neueren Stand mit seinem älteren überschreiben. Ein Test ist bewusst als „bekannter Fehler“ markiert.
- **OBS-Seite:** Nur `idle-stream-mini.html` mischt vor dem Speichern den Server-Stand ein (`bkmpIdleMergeRemoteSpendableFields`). Ein Prestige auf einem anderen Gerät wird dabei nur anhand eines **erhöhten** `prestige_level` erkannt.
- **Chronik:** echtes Zusammenführen + Server-Abgleich vor jedem Abholen.
- **Ladefehler:** Bei Netzwerkfehlern wird **nicht** mit einem leeren Spielstand weitergespielt (Schutz vor Überschreiben). Runen laden in zwei unabhängigen Teilen, mit Hinweis + Neu laden.

## 14.4 Serverseitige Prüfung beim Speichern

Siehe Kap. 12.1. Das ist die einzige Plausibilitätsprüfung für den Spielstand.

---

# 15. UI und Navigation

## 15.1 Idle-Dorf-Tabs: tatsächlich 16

| Gruppe (Desktop-Beschriftung) | Tabs |
|---|---|
| Basis | ⚔️ Kampf · ⬆️ Upgrades · 🌳 Skilltree · 🌌 Prestige |
| Sammlung | 🏆 Erfolge · 🔮 Runen · 🖼️ Dorf-Skins · 📊 Bestenliste · 🐉 Drachenzucht |
| Herausforderungen | 🏛️ Dungeon · 🗼 Turm · ⚔️ Arena |
| Gilde | 🛡️ Gilde · 🌳 Gilden-Tech · 🐲 Gildenboss · 🏆 Gilden-Arena |

Der **Weltboss** hat **keinen eigenen Tab**: Während eines Raids ersetzt die Raid-Ansicht das Kampffeld im Tab „Kampf“, und ein Beitritts-Banner erscheint oben. Ein Mechanismus, Tabs für Nicht-Tester zu sperren, existiert; aktuell ist **kein** Tab gesperrt.

**Unterreiter innerhalb der Tabs:**

| Tab | Unterreiter |
|---|---|
| Bestenliste | 12 Reiter |
| Prestige | 6 Zweig-Reiter |
| Runen | 6 Slot-Reiter + Runenlager-Seitenleiste |
| Gilden-Tech | 3 Kategorie-Reiter |
| Chronik-Fenster | 4 Reiter |
| Erfolge | Kategorien, Titel/Kosmetik |
| Drachenzucht | Abschnitte Begleiter, Nester, Eier, Babys, Lager, Vorräte, Dex/Lexikon |

## 15.2 Desktop-Navigation

- Ab 1.000 px Breite eine **flache Tab-Leiste** mit allen 16 Tabs in bis zu 2 Zeilen. Die 4 Gruppen sind im Markup vorhanden, per CSS aber aufgelöst.
- Darüber das **HUD**: Level, EP-Balken, Kampfwerte + Ressourcen in einem Fluss, Effektmodus-Knopf, Schließen-X.
- Darunter die **Stufenleiste** („Gesamt“, „Boss“, Automatisch / Beste Stufe / Stufe wählen).
- Kampf-Tab: links Dorf, rechts Drache, rechte Info-Spalte (Boss-Karte, Belohnungen, Kampfstatistik, Chronik-Karte), Bonus-Leiste.

## 15.3 Mobile Navigation / App-Modus

**Wann kompakt:** unter 1.000 px Breite, im Querformat bis 500 px Höhe und **immer im App-Modus** (`/app`).

**Aufbau:**
- **Kompaktes HUD** + **Unterleiste** mit 4 Haupt-Tabs (**Kampf, Upgrades, Drachen, Prestige**) + **„Mehr“**.
- Das „Mehr“-Fenster ist ein Bottom-Sheet `#idleAppMoreSheet` mit Gruppen:
  - 📈 Fortschritt: Skilltree, Runen, Erfolge
  - ⚔️ Kampf & Rang: Dungeon, Arena, Bestenliste, Turm
  - 🛡️ Gilde: Gilde, Gilden-Tech, Gildenboss, Gilden-Arena
  - 🏆 Sammlung: Dorf-Skins
- Das Kampf-Log ist ein eigenes Bottom-Sheet, die Chronik über den 📜-Knopf erreichbar.
- Die Umschaltung Desktop ↔ kompakt passiert jederzeit ohne Neuladen. Sie wird beim Laden, bei Größenänderung, beim Öffnen des Fensters und bei Tab-Rückkehr neu abgeglichen.

## 15.4 Fenster

**41 feste Overlays in `index.html`:**

| Bereich | Fenster |
|---|---|
| Idle-Dorf | Hauptfenster, Wartung, Stufenwahl, Event-Drache, Prestige-Bestätigung, Prestige-Zeremonie, Drachen-Detail, Drachen-Dex, Skin-Vorschau, Rahmen-Kauf, Meister-Dialog, Runen-Hilfe, Skill-Hilfe, Stream-Hilfe, Arena-Kampf, Gilden-Arena-Kampf, Runenlager, „Mehr“-Sheet, Kampf-Log-Sheet |
| Website | Erfolge, Feedback, Status-Board, Changelog, Login/Name, Umbenennen, Passwort ändern, Konto löschen, Spielerprofil, Kartenidee, Wunsch-Detail, Kartendatenbank, Karten-Detail, Kartenverkauf-Anfrage, PartnerShop-Einreichung, Investor-Anfrage, Investor-Sicherheitscheck (Prank), Auszahlungs-Prank, Auszahlungsbeweis-Ansicht, Bestätigungsdialog, allgemeines Witz-/Hinweisfenster, Admin-Hinweis |

**Dynamisch erzeugt:**
- Chronik-Fenster, Gilden-Tech-Beitragsfenster, Begleiter-Auswahl
- Belohnungs-Präsentation (Toast/Karte/Zeremonie)
- Offline-Karte, Raid-/Dungeon-Ergebnisse
- Popup „Anfrage-Entscheidung“, Shardhändler-Rechner
- Weltereignis-Objekte im Kampffeld

## 15.5 Schnellzugriffe, Hinweise, Belohnungsanzeigen

| Art | Elemente |
|---|---|
| Schnellzugriffe | Chronik-Kurzlinks; „Los →“ in der Ziele-Übersicht; „Zu den Runen“ in der Zeremonie bei legendären Runen; Stufenwahl; „Beste Stufe“ |
| Hinweis-Abzeichen | Prestige-„!“ am Tab (Prestige-Knoten); Chronik-Zähler; roter Punkt am Changelog-Knopf; News-Punkt; Achievement-Zähler |
| Meldungen | Toasts (`bkmpShowJannikToast`, `bkmpUiShowToast`), Erfolgs-Popups mit Konfetti, Raid-Beitritts-Banner (mit Countdown, minimierbar), Status-Banner im Kampf, aufsteigende Belohnungs-Zahlen (Gold/EP-Chips, max. 3 gleichzeitig), Schadenszahlen (max. 5 pro Ziel) |

---

# 16. Performance

## 16.1 Vorhandene Optimierungen

| Bereich | Optimierung |
|---|---|
| Laden | Skripte mit `defer`, Lazy-Loading von Bildern, aufgeschobenes Laden versteckter Panels, Cache-Header (`vercel.json`), WebP-Bilder mit PNG-Fallback, Drachen-Videos einmal pro Sitzung als Blob |
| Kampf | Optik nur bei sichtbarem Kampf-Tab; Animations-Neustart über doppeltes `requestAnimationFrame` statt erzwungenem Reflow; Schadenszahlen- und Belohnungs-Deckel; Tick-Untergrenze 400 ms |
| Neuaufbau | Live-Aktualisierung von Tabs max. alle 300 ms, **nicht**, während die Maus über dem Panel ist; Chronik/Kampf-Zeitwerte nur bei echter Änderung |
| Effektmodus | Hoch/Reduziert/Aus + 7 Einzelschalter; „Aus“ stoppt Videos und alle Deko-Animationen; `prefers-reduced-motion` wird respektiert |
| Hover-Fix Teil 1 (03.10.) | Rahmen-Schimmer des Dorf-Fensters (`background-position`-Animation) eingefroren; Website-Animationen unter dem offenen Fenster pausiert; Spotlight-/Händler-Ecke (Weichzeichner) unter dem Fenster ausgeblendet |
| Hover-Fix Teil 2 (03.10.) | Schatten an Videos (Drache, Dorf, Welt-/Gildenboss) als `box-shadow` statt `filter: drop-shadow` (vorher in jedem Bild neu berechnet: 16 → 47 Bilder/s); Angriffs-Puls ohne Weichzeichner |
| Netzwerk/Kosten | Kampf-Übertragung zum OBS-Overlay max. alle 3 s und **nur mit Zuschauer**; tägliches Code-Event-Polling entfernt (Vercel-Kosten); Edge-Cache für Twitch/OPSUCHT; Hintergrund-Nachholen nur mit OBS-Zuschauer |
| Navigation | Tab-Navigation umschaltbar ohne Neuladen |

**Schutztests:** `render-perf-guard.spec.js` und `hover-performance.spec.js`.

## 16.2 Bekannte, noch bestehende Performance-Punkte

| Punkt | Detail |
|---|---|
| Effektmodus „Hoch“ im Kampf-Tab | Spürbar teurer als andere Tabs: Videos laufen, der Treffer-Blitz nutzt `filter: brightness/saturate` auf dem ganzen Drachen-/Dorf-Container, der Angriffs-Puls `brightness`. Gemessen im Test-Browser ohne Grafikkarte: ~29 Bilder/s gegenüber 41 im Upgrades-Tab. Diese Werte stammen aus Tests, nicht von echten Geräten. |
| HUD | Wird bei **jedem** Tick per `innerHTML` neu aufgebaut |
| Erfolgs-Cache | `bkmpIdleGetAchievementContextFields()` schreibt bei **jedem Sieg** den kompletten Cache per `JSON.stringify` in `localStorage` |
| Dateigrößen | `style.css` ~16.500 Zeilen (inkl. alter, überschriebener Regeln), `bkmp-site.js` ~8.400 Zeilen, `supabase.js` ~6.500 Zeilen, alles ohne Bündelung |
| Arena | Lädt bis zu 200 Gegner auf einmal |
| Polling | Raid-Boss alle 1,5 s und Teilnehmer alle 3 s, während ein Raid läuft |

---

# 17. OBS / Streaming / App

## 17.1 OBS-Overlay `idle-stream-mini.html`

- **Zweck:** Rein **visuelles**, **transparentes** Overlay für Streamer. Es zeigt den laufenden Kampf (Dorf, Drache, Lebensbalken, Raid-Ansicht) des eigenen Kontos. Adresse `bkinvestment.de/idle-stream-mini`, Einbindung als OBS-„Browser-Quelle“ (z. B. 900×350). Eine Anleitung steht im Fenster „Twitch-Einbindung für Streamer“ der Hauptseite.
- **Eigener Login:** schlanke Fassung des Website-Logins.
- **Datenweg:**
  - Supabase-Realtime-Kanal. Der Overlay meldet sich per **Presence** an, und das Hauptspiel sendet nur dann (max. alle 3 s).
  - Ist der Spiel-Tab versteckt, holt der Browser alle 20 s Fortschritt über die Offline-Formel nach, damit das Overlay sich bewegt.
- **Besonderheiten:**
  - Setzt `window.BKMP_IDLE_IS_STREAM_PAGE = true`.
  - Mischt vor dem Speichern den Server-Stand ein (Mehr-Tab-Schutz).
  - Kein QA-Modus.
  - Lädt nicht alle Module, z. B. keine Chronik und kein Kompakt-HUD.
- **Gespeichert:** nichts Overlay-spezifisches. Spielstand wie im Hauptspiel, Effektmodus wie gewohnt in `localStorage`.

## 17.2 Streamer-Funktionen auf der Website

- **Creator-Liste** (`streamer_links`) mit Twitch-Live-Erkennung (`api/twitch-live`), Live-Toast und Laufband.
- Erfolge „<Name>-Fan“ für das Ansehen von Streams.

## 17.3 App / PWA / Android

- **`/app`** → App-Modus von `index.html`:
  - Vollbild-Spiel, kompakte Navigation, `html.zone-game`
  - eigene Startanimation
  - `?app=idledorf` erzwingt den Kompakt-Modus unabhängig von der Breite
- **Installation:** „Als App installieren“ (PWA, `idledorf.webmanifest`, Hochformat, `sw.js` ohne Cache).
- **Android:** `assetlinks.json` für das Android-Paket `de.bkinvestment.idledorf` (Play-Store-Verpackung). Der Veröffentlichungsstatus ist **[unklar]**.
- **Unterschiede zur Website:** gleiche Logik und gleicher Spielstand. Optik: `html.bkmp-app-mode` ist heute auf allen Seiten gesetzt, `window.BKMP_APP_MODE` (Verhalten) nur unter `/app`.

---

# 18. Tests

## 18.1 Aufbau

| Teil | Inhalt |
|---|---|
| Framework | **Playwright** (`playwright.config.js`) |
| Projekte | `chromium-desktop` (1366×768), `firefox-desktop`, `webkit-desktop`, `mobile-small` (Pixel 7, 360×800), `mobile-large` (iPhone 14 Pro Max). Üblich ist der Lauf über chromium-desktop + mobile-small + mobile-large; `firefox-desktop` startet in der aktuellen Umgebung nicht (`spawn UNKNOWN`). |
| Mock-Backend (`tests/mock/`) | Eigener lokaler Ersatz für Supabase: Datenspeicher, Auth (JWT-Form), REST-Engine (Filter, Einbettungen, View-Nachbildung), **RPC-Engine** (nachgebaute SQL-Funktionen für Dungeon, Arena, Gilden komplett, Raid, Gildenboss, Gilden-Tech v3), Anti-Cheat-Trigger-Nachbau, virtuelle Uhr. Die echten Vercel-Handler (Offline, Plüschtier-Codes) laufen unverändert im Prozess. |
| Netzwerksperre | `tests/helpers/network-guard.js` blockiert jeden Kontakt zur echten Produktions-Datenbank; ein Test schlägt fehl, wenn das versucht wird |
| Teststände | **A–G** (A neuer Spieler … C fortgeschritten mit 6 Runen, D beschädigte Daten, E 300 Runen, F kurz vor Prestige, G ohne Dungeon-Schlüssel) |
| QA-Modus | `npm run qa:server` + `?qa=1` auf localhost: Kontrollfenster (Teststand laden, Ressourcen setzen, Spielzeit vorspulen, Mobil-Fenster) |
| Statische Prüfung | `scripts/static-checks.js` (doppelte globale Namen, Produktions-URLs, `eval`, Intervalle ohne Stopp, ungeschütztes `innerHTML`, `.then` ohne `.catch`, fehlende Skripte, verwaiste `data-testid`), ESLint, `npm audit --omit=dev` |
| Befehle | `qa:full`, `qa:smoke`, `qa:features`, `qa:time`, `qa:persistence`, `qa:visual`, `qa:soak` (`soak:long`), `qa:static` |

## 18.2 Umfang

- **74 Testdateien** mit **628** `test(...)`-Aufrufen. Einige erzeugen mehrere Tests per Schleife, z. B. Navigation für alle Tabs.
- **Letzter vollständiger Lauf** über 3 Projekte: **1.324 bestanden, 456 übersprungen** (Desktop-Tests auf Mobil und umgekehrt).
- **Bekannter, absichtlich markierter Fehler:** Speicher-Wettlauf zwischen zwei Tabs (`test.fail()`).

| Bereich | Testdateien (Anzahl Tests) |
|---|---|
| Kampf | combat (8), combat-visual-polish (16), hover-performance (6), render-perf-guard (5), panel-render-hover-guard (3), stage-bar-run-visibility (4) |
| Navigation/UI | navigation (5+Schleife), nav-persistence (8), mobile-smoke (7), buttons-inventory (3), visual (8), qa-mode-smoke/-security (je 1), fx-toggle-persistence (5) |
| Speichern | save-load (6), rename-persistence (4), rename-dragon-persistence (2), rune-persistence-hardening (9), heartbeat (8), soak (2) |
| Zeit/Offline | login-streak (6), offline-afk (7), offline-afk-fixed-reward (9), offline-companion-xp (5), obs-background-catchup (4), dungeon-time (8) |
| **Anti-Cheat** | anticheat-progress-rate-guard (16), leaderboard-hide-mechanism (7), network-guard (4) |
| Runen | runes (7), rune-autofuse-datasource (7), rune-background-automation (7), rune-inventory-scale (4), rune-maximize-legendary (5) |
| Prestige | prestige (6), prestige-tree-v2 (16), prestige-automation-toggles (6), prestige-automation-remaining-skills (20), ascension-and-sinks (10), upgrade-softcap-milestones (6) |
| Drachen | dragon-multi-companion (15), dragon-lifecycle-release (7), dragon-breeding-automation (3), dragon-lager-rarity-filter (4) |
| Dungeon/Turm | gem-dungeon-reward (8), dungeon-key-prestige-bonus (7), tower (16) |
| Arena/Raid | arena (10), raid (18), raid-tap-counter-appmode (3), guildboss (17) |
| Gilden | guild (14), guild-invites (29), guild-chat (16), guild-quests (15), guild-slots (10), guild-permissions (9), guild-clan-arena (16), guild-level-cap-and-number-format (5), guild-tech (16, alt, übersprungen), guild-tech-ext (11, überwiegend übersprungen), guild-tech-ext-readside (8), guild-tech-tree (10), guild-tech-tree-ui (8), guild-tech-tree-migration (9), guild-tech-drachenzucht (3) |
| Erfolge/Kosmetik | achievements (15), achievement-benefit-display (4), cosmetics (30) |
| **Chronik** | chronicle (21) |

**Testlücken laut `tests/FEATURE_MATRIX.md`:** Admin-UI, die meisten Website-Bereiche (Investoren, Karten, PartnerShops …), visuelle Referenzbilder (nie erzeugt), Fuzz-/Speicherleck-Tests.

---

# 19. Unbenutzter, alter oder unfertiger Code

Alles hier ist im Code oder in der Datenbank **vorhanden**, aber ungenutzt, wirkungslos, widersprüchlich oder nur halb fertig.

## 19.1 Spielsysteme und Boni ohne Wirkung

| # | Fund | Beleg |
|---|---|---|
| 1 | **Prestige „Effiziente Aufwertung“** (−1 % Runen-Aufwertungskosten/Rang) **wirkt nicht** | Effekt `rune_upgrade_cost_reduction_pct` wird nirgends gelesen; die Runen-Kosten nutzen nur den Gilden-Rabatt |
| 2 | **Prestige „Schmelzmeister“** (+3 % Schmelzbelohnung/Rang) **wirkt nicht** | `rune_fuse_reward_bonus_pct` wird nirgends gelesen |
| 3 | **Drachen-Zusatzwert „Diamantenbonus“** (0,5–1,5 %) **wirkt nicht** | `crystal_bonus_pct` landet im Effekt-Topf, wird aber nie ausgewertet |
| 4 | **Skill „Expeditionscorps“** und **Prestige „Offline-Imperium“** (Offline-Effizienz) **wirken nicht** | `offline_income_pct` wird als `offlineBonus` berechnet, aber nie benutzt; der Server liest nur den Rang von „Offline-Einnahmen“ |
| 5 | **Skill „Offline-Einnahmen“**: Beschreibung „+1,25 %/Rang (max. 24)“, tatsächlich **+5 % pro Rang für nur die ersten 6 Ränge** | `api/claim-idle-offline-progress.js` |
| 6 | **Gildenquest Stufe 3**: Oberfläche verspricht „🥚 Legendäres Ei“, vergeben wird eine legendäre **Rune** (Wert 10) + 10 Prestige-Punkte | `BKMP_GUILD_QUEST_TIER_REWARD_LABEL` vs. `guild_quest_contribute` |
| 7 | **Dorf-Skin „Zerathor Dorf“**: Hinweis „1 % Chance als Beute nach einem gewonnenen Weltboss-Raid“; die **aktuell ausgeführte** `raid_finish`-Fassung enthält diesen Drop **nicht mehr**, ebenso Holz/Stein/Essenz, Booster und Schadensanteil | Kap. 8.4 |
| 8 | **Skilltree-Zweig „Meister“** (Zwerg Grimbold): Code, Freischaltregel, Dialogszene und Bilder vorhanden; die 8 Knoten aus `sql/supabase-idle-meister-branch.sql` sind **nicht in der Live-Datenbank** → unsichtbar | Live-Abfrage |
| 9 | **Skill „Drachenzwinger“** (+1 Lagerplatz) live **inaktiv** | `supabase-remove-zucht-lagerplaetze.sql` |
| 10 | **Ressource Mana**: Spalte vorhanden, keine Quelle, keine Verwendung | „Manaquelle“ produziert Essenz |
| 11 | **Episches Meilenstein-Ei** (`claim_epic_dragon_egg`, Tabelle `player_epic_egg_claims`, Wrapper `claimEpicDragonEgg`): fertig, **nie aufgerufen** | `supabase.js` |
| 12 | **Echtgeld-Käufe** (Stripe, Steampunk Dorf 1,99 €, „Drachenrahmen“ als Fensterrahmen): fertig gebaut, **per Schalter aus** (`BKMP_REAL_MONEY_PURCHASES_ENABLED = false`); „Drachenrahmen“ zusätzlich inaktiv; Kauf-Fenster `idleBuyFrameOverlay` vorhanden | idledorf.js, `idle_village_skins` |
| 13 | **Erfolge `daily_event_1/5/15`, `golden_hour_win`**: seit Entfernung des täglichen Code-Events nicht mehr erreichbar | bkmp-site.js |
| 14 | **Tab-Sperre für Nicht-Tester** (`BKMP_IDLE_TESTER_NAMES = ['test123']`): Mechanismus aktiv, aber kein Tab gesperrt | idledorf.js |
| 15 | **Arena-Bestenliste** (`bkmpArenaGetLeaderboard`) und **Gildenboss-Bestenliste** (`loadGuildBossLeaderboard`): Datenbank-Abfrage fertig, **keine Anzeige** | supabase.js |

## 19.2 Unbenutzte Funktionen

| Ort | Funktionen |
|---|---|
| `supabase.js` (5) | `bkmpGetValidAdminSession`, `updatePartnerShopFlags`, `claimEpicDragonEgg`, `bkmpArenaGetLeaderboard`, `loadGuildBossLeaderboard` |
| Spiel-Code (1 von 796) | `bkmpIdleUpgradeMarginalEffectPerLevel` |

## 19.3 Datenbank-Altlasten

| Altlast | Status |
|---|---|
| `daily_code_events` | Tägliches Code-Event entfernt (27.09.); Tabelle bleibt als Historie |
| `guild_tech_levels` + RPC `guild_tech_upgrade` | Altes Gilden-Tech-System, vom Client nicht mehr genutzt |
| `map_orders`, `order_events`, `order_files`, `order_messages`, `order_read_state`, `customer_profiles`, RPC `admin_reassign_order` / `is_order_participant` | Altes Kartenauftrags-System. Rückbau-SQL vorhanden (`supabase-mapart-orders-teardown.sql`), **Tabellen existieren aber noch** |
| `idle_stream_presence` | Kein Code nutzt sie |
| Konfiguration `offline_floor` | Wird nie gelesen (Überbleibsel des „Mindestlohns“ vom 21.08.) |
| Konfiguration `offline_progress.efficiencyPct` (50) | Wird nicht mehr verwendet; nur `maxHours` zählt |
| Ursprüngliche Seed-Drachen (Waldwyrm, Steinwyrm …) und 5×6-Skilltree aus `supabase-idle-dorf-schema.sql` | Live nicht vorhanden, durch spätere Daten ersetzt |
| `scratch-*.sql` | Einmal-Skripte (Duplikate entfernen o. ä.) |

## 19.4 Alte oder experimentelle Dateien

| Datei/Ordner | Status |
|---|---|
| `assets/prototype-battle/` | Greenscreen-WebMs des am 19.07. zurückgebauten „modularen Kampfrenderers“ (Phase 5.6); nicht mehr referenziert |
| `backups-local/` (gitignored) | Experimente „battle-arena“, „mobile-idle-redesign“, „idle-performance-audit“ u. a. vom 05.–07.08. |
| `js/prototype/bkmp-proto-compact-hud.js` | Trägt „Prototyp“ im Namen, ist aber die **produktive** mobile Navigation |
| `js/dev/bkmp-perf-instrument.js`, `js/dev/bkmp-qa-panel.js` | Nur im lokalen QA-Modus aktiv, werden aber auf der Live-Seite mitgeladen (dort wirkungslos) |
| `tools/asset-generator/` + `asset-preview.html` + `asset-manifest.json` | Lokales Bildgenerierungs-Werkzeug (OpenAI-API), nicht Teil des Spiels |
| `scripts/*.ps1` | Einmalwerkzeuge für Sprites (Pinguin, Pilzdorf, Zwerg, Kaledoss-Hintergrund) |
| Code-Fallbacks (`BKMP_IDLE_FALLBACK_CONFIG/DRAGONS`) | Nur aktiv, wenn die Datenbank nicht antwortet |
| Alte Gilden-Tech-Tests (`guild-tech.spec.js`, Großteil von `guild-tech-ext.spec.js`) | Komplett als übersprungen markiert |

## 19.5 Bewusst entfernte Systeme (Historie)

- Tägliches Code-Event (Plüschtier-Codes) am 27.09.2026 → Weltboss/Gildenboss-Drops
- „Akt X erreicht!“-Popup (20.07.)
- Prestige „Schlüsselmeister“ (03.08., Punkte erstattet)
- „Lager aufräumen“-Verkaufsleiste und 300er-Runen-Lagergrenze (04.08.)
- Roter Angriff-Knopf beim Weltboss (04.08.)
- Gilden-Tech v2 („Führung kauft aus der Kasse“) → v3 (31.07.)
- Modularer Kampfrenderer (Phase 5.6, 19.07.)
- Offline-Kampfsimulation → feste Formel (23.08.)
- Kartenauftrags-System → reines Firmenverzeichnis (15.07.)

---

# 20. Implementiert vs. nur geplant

## 20.1 Bereits implementiert (Auswahl der letzten Ausbaustufen)

- **Drachendorf-Ausbau** (Abschnitt 21, Branch `feature/drachendorf-ausbau`, Datenbank-Dateien noch nicht ausgeführt)
- **Chronik** (Aufträge, Kalender, Bestiarium, Weltereignisse, Ziele)
- **Leistung:** Hover-/Performance-Fixes Teil 1 + 2
- **Spieler:** mehrere Begleiter, Gilden-Tech v3, Gilden-Arena, Anti-Cheat-Trigger, Prestige-Baum v2 mit Paragon und Aufstieg, Kartenverkauf-Auszahlungen, BK-Mod-Anbindung inkl. PartnerShops, Shardhändler, SW-Besucherstatistik, Umsatz-Dashboard

## 20.2 Nur geplant oder notiert, nicht umgesetzt

**Aus `IDLE_DORF_WEITERENTWICKLUNG.md` (Roadmap 03.10.):** *(Expeditionen, Element-Affinität, Charakterzüge, Event-Pass und kleine Wochenereignisse sind seit dem Drachendorf-Ausbau umgesetzt, siehe Abschnitt 21)*
- Saison-Pass „Drachensaison“ (größere allgemeine Saison – bewusst erst später)
- Gilden-Chronik
- Mana wiederbeleben oder entfernen
- Chronik/Bestiarium im Website-Profil
- Plüschtier-Chance in der Wochentruhe
- Chronik-Fortschritt in der BK-Mod
- hierarchische Navigation
- Hinweis-Punkt am „Idle Dorf“-Knopf
- Technische Punkte:
  - Erfolgs-Cache drosseln
  - HUD gezielt aktualisieren
  - ~~Offline-Ergebnis als Zuwachs statt Summe übernehmen~~ – behoben (Abschnitt 21.2)
  - `idledorf.js` weiter aufteilen
  - Zusatzdaten in `idle_player_meta`

**Aus der Progression-Rebalance (26.07.), bewusst nicht umgesetzt:**
- Dungeon-Schlüssel kaufen
- Stadtprojekte
- Kosmetik-Endgame-Shop

**Aus der Gilden-Tech-Sammlung (26.07.), zurückgestellte Ideen:**
- Gildenboss-Zeitfenster
- Gilden-Dungeon-Schlüssel
- Mitgliederplätze per Technologie
- passives Kassen-Einkommen
- zweiter Gildenboss-Versuch
- Gilden-Kosmetik
- zusätzlicher Quest-Platz
- Paragon für Gilden-Tech v3

**Aus der Redesign-Planung (`CLAUDE.md`, Phasenstatus):**
- **Phase 5.4** (einheitliche UI für Erfolge, Dorf-Skins, Dungeon, Turm, Arena, Gilde, Gilden-Tech, Gildenboss, Bestenliste, Drachenzucht, Kampf-Feinschliff): teilweise offen
- **Phase 6 (Admin):** Admin-Panel und OBS-Overlay ans neue System anpassen
- **Phase 7:** Barrierefreiheit, totes CSS löschen (u. a. doppelte `.idle-dorf-tab`-Basisregel), restliche Bilder auf WebP
- Lebensbalken als Overlay auf dem Motiv
- echte Vergrößerung der Dorf-/Drachen-Sprites
- Tests (Abschnitte 21–36 des Testauftrags): Erfolge-Tiefenprüfung, Belohnungs-Stresstests, Kosmetik-/Einstellungs-Suiten, volles Geräteraster, visuelle Referenzbilder, Netzwerkfehler-Simulation, Speicherleck-/Fuzz-Tests
- ~~Speicher-Wettlauf zwischen zwei Tabs beheben~~ – behoben im Drachendorf-Ausbau, Phase 0 (Abschnitt 21.2)
- QA-Modus für Admin-Panel und OBS-Overlay

**Offene Betreiber-Schritte, die in Dateien notiert sind:**
- Meister-Zweig-SQL ausführen oder verwerfen
- Android-App (TWA) veröffentlichen **[unklar]**
- Stripe aktivieren, sobald Live-Webhook getestet ist

---

# 21. Drachendorf-Ausbau (04.10.2026)

Großer Ausbau in elf Phasen auf dem Branch `feature/drachendorf-ausbau` (nicht `main`). Jede Phase wurde einzeln getestet und committed. **Alle Datenbank-Änderungen liegen als Dateien in `sql/` und sind noch nicht ausgeführt** (Reihenfolge siehe 21.13). Ohne die Datenbank-Dateien bleiben die neuen Bereiche ruhig ausgeblendet – das Spiel läuft wie bisher.

## 21.1 Drachenbestand

| | Anzahl |
|---|---|
| Zucht-Arten live (vor diesem Ausbau) | 25 |
| neue normale Arten (vorbereitet, `20261003-…-neue-drachen2.sql` + `…-dracheeeee.sql`) | 20: 8 legendär (Almerio, Alphorius, MaxEnder, Ronjawolf, Tsheyn, Vaelith, Ccatched, Sunnyyvi), 12 episch (Dayman, GrumpyJedi, Jodeljochen, Lukas, MiaTao, Randomauto, Scusy, StarManius, Troasa, Surebrec, Byalex, Danw) |
| Event-Arten | 2: **Lightnix** ☀️ und **Darknix** 🌑 (legendär, je 5 Stufen, nur über das Zwielicht-Event) |
| Gesamt nach allen Dateien | 47 |

Normale Arten haben weiterhin **vier** Stufen (Ei → Baby → Jugendlich → Erwachsen). Eine optionale **fünfte Stufe** ist datengetrieben (`dragon_species.stage_count = 5`, `final_stage_key/-label`, `divine_image`, `divine_config`, `special_passive`, `event_origin`, `unique_per_account`, `reward_group`) – nichts ist fest auf Lightnix/Darknix programmiert. „Göttlich“ ist eine **Stufe**, keine Seltenheit.

## 21.2 Technische Gesundheit (Phase 0)
- Zwei-Tab-Überschreiben behoben (Hintergrund-Tab speichert beim Verlassen nur noch, wenn das Dorf dort offen war oder echte Änderungen anstehen).
- Offline-Belohnung überschreibt keine ungespeicherten lokalen Ressourcen mehr.
- Event-/Einzelstück-Arten kommen nie im normalen Ei-Wurf vor (`bkmpDragonEggPoolEligible`).
- Neue Funktionen erkennen fehlende Datenbank-Objekte (`bkmpIsMissingDbObjectError`) und bleiben dann still.

## 21.3 Navigation (Phase 1)
Vier Bereiche aus **einer** Liste (`BKMP_IDLE_NAV_CATEGORIES`): ⚔️ Abenteuer (Kampf, Dungeon, Turm, Arena) · 🏡 Entwicklung (Upgrades, Dorfentwicklung, Skilltree, Prestige, Runen) · 🐉 Drachen & Sammlung (Drachenzucht, Dorf-Skins, Erfolge, Bestenliste) · 🛡️ Gemeinschaft (Gilde, Gilden-Tech, Gildenboss, Gilden-Arena). Desktop: einklappbare Kopfzeilen; Handy/App: „Mehr“-Menü in denselben Gruppen. Der zuletzt geöffnete Bereich wird gemerkt. Idle-Dorf-Tabs jetzt **17** (neu: Dorfentwicklung).

## 21.4 Dorfentwicklung, Drachenhafen, Handelsposten (Phase 2)
Kosten/Voraussetzungen/Wirkungen stehen in `village_building_levels`. Bauen und Handeln laufen nur serverseitig (`village_build`, `village_trade_offers`, `village_trade_execute`).

| Gebäude | Mindest-Stufe | Kosten (Gold/Holz/Stein/Kristalle/Essenz) | Wirkung |
|---|---|---|---|
| Drachenhafen I | 50 | 120.000 / 4.000 / 4.000 / 250 / 100 | 1 Expeditionsplatz; Flüsterwald, Glutberge |
| Drachenhafen II | 400 | 5 Mio. / 40.000 / 40.000 / 3.000 / 1.500 | 2 Plätze; Frostklamm, Endriss |
| Drachenhafen III | 1.500 | 60 Mio. / 150.000 / 150.000 / 20.000 / 10.000 | 3 Plätze; Verbotenes Drachental |
| Handelsposten I | 100 | 400.000 / 10.000 / 10.000 / 500 / 250 | 3 Tagesangebote |
| Handelsposten II | 800 | 15 Mio. / 60.000 / 60.000 / 5.000 / 2.500 | 4 Tagesangebote |

Handelsangebote: deterministisch pro Konto und Berliner Tag (Reload ändert nichts), jedes genau einmal.

## 21.5 Expeditionen (Phase 3)
5 Regionen, 15 Missionen (1/4/8 Std., 1–3 Drachen), 9 Ereignisse – alles in der Datenbank. Nur eigene, erwachsene/göttliche, freie Drachen (nicht Kampfbegleiter, nicht schon unterwegs). Pflichtbedingungen (Element, verschiedene Arten, Seltenheitsgrenzen) und Empfehlungen. Qualität ⭐–⭐⭐⭐⭐ aus Passung + Vielfalt + Bindung + Eigenschaften + Zufall; **nie Totalausfall**. Ergebnis wird beim Start serverseitig festgelegt, beim Abholen atomar genau einmal gutgeschrieben. Server-Trigger sperren Freilassen/Begleiter-Setzen während einer Expedition. Gemeinsames Regelmodul `js/systems/bkmp-expedition-rules.js` (exakter Spiegel der SQL).

## 21.6 Affinitäten, Eigenschaften, Bindung, Dex (Phase 4)
- **Affinitäten**: 1–2 Elemente je Art (feuer, wasser, erde, wind, blitz, licht, dunkel, arkan, neutral), für alle Arten gesetzt.
- **Eigenschaften (Traits)**: genau eine positive Eigenschaft pro erwachsenem Drachen, serverseitig und deterministisch (md5 der Drachen-ID), nie neu würfelbar. 11 Stück: Gierig, Entdecker, Sammler, Mutig, Schatzsucher, Gesellig, Einzelgänger, Forscher, Beschützer, Glückskind, Heiler. Wirkung nur auf Expeditionen.
- **Bindung 1–10** (Schwellen 0/100/250/500/900/1.500/2.400/3.600/5.200/7.500 Bindungs-EP): wächst nur aus echten, gespeicherten Siegen als Begleiter (`dragon_activity_tick`, höchstens alle 20 s, auf echte Zeit gedeckelt) und aus Expeditionen. Meilensteine: 2 Herz, 4 Expeditionsbonus fürs Team, 6 Rahmen, 8 stärkere Eigenschaft, 10 seelengebunden.
- **Drachen-Dex**: Element, Herkunft, Anzahl Formen (5 bei Event-Arten), persönliche Rekorde bleiben auch nach dem Freilassen (Chronik-Speicher).

## 21.7 Dorfpfad (Phase 5)
Reiter „🛤️ Pfad“ in der Chronik: 6 Kapitel (Die ersten Mauern · Die Drachenzüchter · Die Chronisten · Meister des Dorfes · Jenseits des Horizonts · Legenden), 33 Ziele aus vorhandenen Zählern, **rückwirkend**, „Alle abholen“, nächste Ziele mit „Los →“.

## 21.8 Gildenprojekte (Phase 6)
5 Wochenprojekte (Großer Wachturm, Gemeinsamer Drachenstall, Kristallschmiede, Festhalle, Sternwarte), jeden Montag deterministisch eines pro Gilde, je 3 erlaubte Ressourcen. 1 Punkt = 20 Goldeinheiten bzw. 100 Holz/Stein bzw. 5 Kristalle/Essenz. Ziel = 400 + 250 × aktive Mitglieder (7 Tage) + 40 × Gildenstufe, 600–8.000. Fertig → jede Person mit ≥10 Punkten holt **einmal** 150 Kristalle + 100 Essenz + 1 Rune ab; Gilden-Abzeichen 🏅.

## 21.9 Special-Event-Framework (Phase 7)
Tabelle `special_events` (Name, Untertitel, Beschreibung, Lore, Ankündigung/Start/Ende, Zeitzone, Pass-Stufen, Punkte je Stufe, Quests + Belohnungen + Texte als `config`, Drachenbelohnung `reward_species`, `lifetime_claim_limit`, `choice_mode`, Assets, Archiv-Schalter). Status wird berechnet: HIDDEN → COMING_SOON → LIVE → ENDED, `archived` → ARCHIVED. Spieler-Fortschritt: `player_event_progress`; lebenslange Belohnungen: `player_event_reward_claims` (Gruppe „zwielicht“). Ein Event ist erst sichtbar, wenn der Betreiber es einplant:

```sql
select public.special_event_schedule('zwielicht', '2026-10-19', 3);
```
→ Ankündigung Freitag 00:00, Start Montag 00:00, Ende Sonntag 23:59 (Europe/Berlin).

## 21.10 Zwielicht-Pass (Phase 8)
☀️🌑 **Das Erwachen des Zwielichts** – kostenloser Pass, 30 Stufen × 100 Zwielichtpunkte = 3.000 nötig, keine Währung, kein Echtgeld.

**Punkte pro Tag (max. 350):** 4 normale Prüfungen à 40 + 1 schwere à 90 + Tagesabschluss 100 („Erledige 4 von 5“). Tagesreset 00:00 Berlin; Aufgaben werden pro Spieler und Tag einmal deterministisch erzeugt und gespeichert.
- Normale Prüfungen (Auswahl 4 aus den freigeschalteten): Drachenjäger (1.500 Drachen, skaliert), Bossbrecher (15 Bosse), Veteran (45 Min. Kampfzeit), Dungeonläufer (3 Dungeons), Turmstürmer (15 Turmstufen), Runenschmied (15 Aufwertungen, nur mit Runen), Drachenhüter (8× füttern, nur mit Babydrachen), Entdecker (1 Expedition, nur mit Drachenhafen), Gildenhelfer (10 Projektpunkte, nur mit Gilde und offenem Projekt), Zeuge des Zwielichts (2 Weltereignisse).
- Schwere Prüfung (1 aus 4): 4.200 Drachen (skaliert), 90 Min. Kampfzeit, 45 Bosse, 7 Dungeons.

**Wochenquests (3 Stufen, zusammen 1.140):** Der große Drachenkrieg (6.000/15.000/30.000 Drachen, skaliert), Bezwinger des Zwielichts (60/180/400 Bosse), Veteran des Zwielichts (3/6/11 Std.), Dungeonmeister (10/25/50), Gipfelstürmer (60/180/350 Turmstufen), Runenmeister (50/150/300; sonst „Zeichen am Himmel“ 6/18/40 Weltereignisse), Drachenzüchter (20/60/120 Fütterungen; sonst „Jäger der Dämmerung“ 40/120/260 Bosse), Weltenwanderer (3/8/14 Expeditionen; sonst „Pfad der Prüfungen“ 6/18/36 Dungeons).

**Skalierung:** Kill-Ziele × (eigene Lebenszeit-Kills pro Kampfstunde ÷ 3.000), begrenzt auf 0,6–1,6.

**Maximum:** 7 × 350 + 1.140 = **3.590** Punkte (Spielraum ~590 über den nötigen 3.000).

**Fortschritt ohne Server-Anfrage pro Kill:** `event_tick()` etwa einmal pro Minute, solange das Dorf-Fenster offen ist. Gezählt werden gespeicherte Zähler (Kills, Bosse, Kampfzeit, Runen-Aufwertungen, Dungeon-Läufe aus `dungeon_progress`, abgeschlossene Expeditionen, Gildenprojekt-Punkte); Kills und Bosse nur aus echter Kampfzeit (Offline-Siege zählen nicht), alles auf echte Zeit gedeckelt. Nur Turmstufen, Fütterungen und Weltereignisse meldet das Spiel selbst (je Minute und Tag gedeckelt: 130/80/30).

**Belohnungen (Server schreibt Ressourcen gut, Runen/Eier/Booster wie Dungeon-Funde):** über alle Stufen Gold, Holz, Stein, Kristalle (1.330), Essenz (1.100), Futter, 6 Runen, 2 Dracheneier, 6 Booster. Meilensteine: 5 Kleine Zwielicht-Truhe · 10 Titel „Zwielicht-Wanderer“ (+3 % EP) · 15 Zwielicht-Abzeichen · 20 Namensfarbe „Zwielicht“ + Ei · 25 Große Zwielicht-Truhe · 28 Schatz des Zwielichts · 29 „Das Zwielicht ruft …“ · 30 Wahl Lightnix/Darknix (halb Licht, halb Dunkel dargestellt).

**Anzeige:** Pass-Karte im Kampf-Reiter (Desktop), ☀️🌑-Knopf im kompakten HUD (Handy/App), Fenster mit Heute/Woche/Belohnungen/FAQ, Teaser mit Countdown, Ankündigung im Website-Bereich „Was gibt’s Neues?“ (ohne Login), Archiv „Vergangene Events“ im Chronik-Reiter „Ziele“. Nach der Wahl nur noch „☀️ Lightnix erhalten ✅“.

**Simulation** (`sim-pass.js`, gleiche Regeln wie Server): Gelegenheitsspieler (0,6 h an 5 Tagen) ≈ Stufe 7; täglich 0,6 h ≈ Stufe 10; engagiert (1,6 h täglich) erreicht Stufe 30 am **Sonntag**; mit einem Pausentag Stufe 29; Hardcore (4 h) und Extrem (10 h) frühestens **Samstag** (Freitagabend max. 2.890 Punkte).

## 21.11 Lightnix, Darknix und die Wahl (Phase 9)
- Stufe 30 setzt serverseitig **EARNED**. Wahl über `event_choose_reward` mit deutlicher Warnung („⚠️ Diese Wahl ist dauerhaft …“), legt das Ei serverseitig an.
- Höchstens **ein** Eventdrache pro Konto **für immer** (auch bei Wiederholungen des Events).
- Nach Sonntag 23:59 keine neuen Punkte; wer vorher Stufe 30 erreicht hat, darf **auch danach** noch wählen. Ohne Stufe 30 kein Ei, die übrigen Stufenbelohnungen bleiben.
- Schutz: Eier von Event-/Einzelstück-Arten nur serverseitig (Trigger), ein Einzelstück-Drache entsteht nur aus dem eigenen Ei und höchstens einmal. Einzelstücke lassen sich nicht freilassen und brauchen keine zweite Kopie (kein normaler Aufstieg – ihr Weg ist die Göttliche Erweckung).
- Bilder: `assets/dragons/breeding/{egg,baby,teen,adult,divine}/{lightnix,darknix}.png`.

## 21.12 Göttliche Erweckung (Phase 10)
„✨ Weg zur Göttlichkeit“ in der Drachen-Detailansicht (für jede Art mit fünfter Form):

| Säule | Voraussetzung (Lightnix/Darknix) |
|---|---|
| ❤️ Bindung | Stufe 5 |
| ⚔️ Gemeinsame Nutzung | 10 Std. als Kampfbegleiter, 50 gemeinsame Bosse, 10 Expeditionen |
| 💰 Opfergabe | 600.000 **Goldeinheiten** in beliebig vielen Einzahlungen (Wert pro Einzahlung zum aktuellen Stand fixiert – das Ziel wächst nicht mit) |
| 💎🧪 bei der Erweckung | 2.000 Kristalle, 1.000 Essenz |

100 % Erfolg, kein Zufall, atomar (`divine_offer`, `divine_awaken`). Name, Besitzer, Favorit, Eigenschaft, Bindung und Historie bleiben. Stärke: Hauptwerte ×1,25, Zusatzwerte ×1,125 (Multiplikator einmal gespeichert in `divine_multiplier`, wird nie erneut angewendet) – zusammen ≈ **+23 %** Drachenleistung, dazu die Aura (nur als göttlicher Begleiter):
- ☀️ **Göttliche Aura des Lichts**: +6 % Verteidigung, +6 % Leben, +4 % Schildstärke; Expeditionen +6 Teampunkte.
- 🌑 **Göttliche Aura der Finsternis**: +6 % Angriff, +8 % Krit-Schaden, +4 % Gold; Expeditionen +10 % Kristalle/Essenz und +5 % Ereignischance.
Beide gleichwertig (Test vergleicht die Auren in „Zusatzwert-Maximalwürfen“, Abweichung < 10 %).

**Opfergabe-Dauer** (`sim-divine.js`, halbe Einnahmen fließen in die Opfergabe): Midgame ≈ 14 Tage, Late ≈ 5 Tage, Endgame ≈ 1,5 Tage, Spitze < 1 Tag (dort bestimmen Bindung und Nutzung die Dauer). Andere legendäre Drachen mit Aufstieg 5 (×1,50) bleiben in reinen Werten stärker.

## 21.13 Kleine Wochenereignisse (Phase 11)
Sechs Vorlagen, alle aus, einplanbar wie das Zwielicht: Brutwoche (Brutzeit −25 %, +25 % Wachstum), Runenmond (Runen-Fehlschläge −50 %), Bossjagd (+50 % Gold/EP von Bossen), Erntefest (+50 % Früchte/Fleisch), Expeditionsfieber (+25 % Expeditionsbeute, serverseitig), Gildenwoche (+50 % Gildenprojekt-Punkte, serverseitig). Boni höchstens 100 %, laufende Events erscheinen als kleine Hinweise auf der Pass-Karte.

## 21.14 Datenbank-Dateien (in dieser Reihenfolge ausführen)
1. `20261003-dragon-species-neue-drachen2.sql`, `20261003-dragon-species-dracheeeee.sql` (falls noch offen)
2. `20261004-01-drachendorf-grundlage.sql` – Zusatzspalten, Affinitäten, Schutz-Trigger, `bkmp_event_modifier`
3. `20261004-02-village-projects.sql` – Dorfentwicklung, Handelsposten
4. `20261004-03-expeditions.sql` – Expeditionen (inkl. Eigenschaften, Auren, Expeditionsfieber)
5. `20261004-04-dragon-traits-bond.sql` – Eigenschaften, Bindung
6. `20261004-05-guild-projects.sql` – Gildenprojekte (inkl. Gildenwoche)
7. `20261004-06-special-events.sql` – Event-Framework
8. `20261004-07-zwielicht-event.sql` – Zwielicht-Daten (aus)
9. `20261004-08-lightnix-darknix.sql` – Arten + Schutz
10. `20261004-09-divine-awakening.sql` – Göttliche Erweckung
11. `20261004-10-small-weekly-events.sql` – kleine Events (aus)
12. danach: `20261004-changelog-drachendorf-ausbau.sql`; `20261004-changelog-zwielicht.sql` erst am Ankündigungstag.

**Neue Tabellen:** `village_building_levels`, `village_buildings`, `village_trade_templates`, `village_trade_log`, `expedition_regions`, `expedition_missions`, `expedition_events`, `player_expeditions`, `dragon_traits`, `player_activity_state`, `guild_project_defs`, `guild_projects`, `guild_project_contributions`, `guild_project_claims`, `special_events`, `player_event_progress`, `player_event_reward_claims`.
**Neue RPCs:** `village_build`, `village_trade_offers`, `village_trade_execute`, `expedition_start`, `expedition_claim`, `expedition_status`, `dragon_ensure_traits`, `dragon_activity_tick`, `guild_project_status`, `guild_project_contribute`, `guild_project_claim`, `special_events_visible`, `event_tick`, `event_claim_tiers`, `event_choose_reward`, `special_event_schedule` (nur Betreiber), `divine_status`, `divine_offer`, `divine_awaken`, `bkmp_event_modifier`.

## 21.15 Tests
Neue Testdateien: `nav-categories`, `village`, `expeditions`, `dragon-traits-bond`, `village-path`, `guild-projects`, `special-event` (14 Tests: Konfiguration aus SQL, SQL↔Regel-Gleichheit, Status/Zeitzone inkl. Zeitumstellung, Tagesaufgaben/Reset, Deckel, Punkte, Hardcore-Woche, Stufenbelohnungen, Wahl/Claim-Limit/Wiederholung, Ei-Schutz, kleine Events, 3 Browser-Abläufe) und `divine-awakening` (4 Tests: Artdaten/Auren, Opfergabe in Teilen, Erweckung + Bonus nicht doppelt bei Reload/2 Tabs, Einzelstück-Regeln + Expeditions-Aura). Alle neuen Tests laufen auf Desktop, Handy klein und Handy groß. Voller Lauf aller Testdateien danach (3 Geräteprofile): 1.477 bestanden, 494 übersprungen, 0 Fehler (ein einziger Ausreißer – 1 Kristall Produktion während eines Klicks – war ein Test-Timing-Detail und ist im Test berücksichtigt).

---

# A. Systemübersicht (System → Unterfunktionen → wichtigste Abhängigkeiten)

| System | Unterfunktionen | Wichtigste Abhängigkeiten |
|---|---|---|
| Kampf | Tick, Klick, Gegenangriff, Elemente, Niederlage, Sieg, Banner | Effekt-Topf (alle Bonusquellen), `idle_dragons`, `idle_game_config`, Anti-Cheat-Trigger, OBS-Übertragung |
| Gegner/Stufen | Auswahl, Skalierung, Event-Drachen, Stufenwahl | `idle_dragons`, Spielername (Zufalls-Seed), `idle_event_dragon_state` |
| Level/EP | EP-Kurve, Skillpunkte, Meilensteine | Kampf, Dungeon, Gebäude, Offline-API |
| Upgrades | 9 Upgrades, Softcaps, Meilensteine, Auto-Kauf | Ressourcen, Prestige-Rabatt, Gilden-Autokauf |
| Gebäude | 6 + 2 Gebäude, Überladung, Aufholung | Prestige-Stufe, Zeitstempel, `localStorage` (Überladung) |
| Skilltree | 6 Zweige, 49 aktive Knoten, Reset | `idle_skill_nodes`, Skillpunkte |
| Prestige | Reset, Baum, Meilensteine, Paragon, Aufstieg, Automatisierungen | `idle_prestige_state`, Höchststufe, Gilden-Tech (Aufstiegsschwellen) |
| Runen | Drops, Aufwerten, Verschmelzen, Aufstieg, Lager, Automatik | `idle_player_runes`, Lebenszeit-Stufen, Gold, Kristalle, Prestige-Knoten |
| Drachenzucht | Nester, Brut, Füttern, Wachstum, Begleiter, Aufstieg, Lager, Dex | `dragon_species`, `player_*`, Frucht/Fleisch, Skill/Prestige/Gilden-Tech |
| Dungeon | 7 Typen, Schwierigkeiten, Schlüssel, Tages-/Wochenbonus, Auto | Dungeon-RPCs (Server-Zeit), Prestige-Knoten, Runen/Eier-Würfe |
| Turm | Endlos-Stufen, Meilensteine, Rekord | Kampf-Engine, Runen/Eier-Würfe, Gilden-Tech (Turm-Vorreiter) |
| Arena | Gegnerliste, Kampf, ELO, Limits | `arena_attack`, gespiegelte Kampfwerte, Gilden-Tech (Kriegsrat) |
| Weltboss | Beitritt, Schaden, Gegenangriffe, Belohnung, Codes, Auto-Beitritt | Raid-RPCs, Polling, Bossschaden-Bonus, Gilden-Tech (Stadtmauer), Gildenboss-Stunde |
| Gilden | Mitglieder, Rollen, Kasse, Level, Tech, Boss, Quests, Chat, Arena, Präsenz | ~25 RPCs, Autosave (Quest-Deltas), Effekt-Topf |
| Chronik | Aufträge, Truhen, Kalender, Bestiarium, Weltereignisse, Ziele | `idle_player_meta`, alle Systeme (Fortschrittsmeldungen), Belohnungseinheit (`bkmpIdleRewardsAt`) |
| Offline | Server-Formel, Gebäude-Aufholung, Begleiter-EP, OBS-Nachholen | `api/claim-idle-offline-progress.js`, `last_seen_at`, Konfiguration |
| Erfolge/Titel/Kosmetik | 431 Erfolge, 287 Titel, 83 Kosmetiken, Plüschtiere, Skins | Website-Zähler (`player_stats`), Spiel-Caches, Codes-API |
| Speicherung | Autosave, Sofort-Speichern, Sitzungsübernahme, OBS-Zusammenführen | `supabase.js`, RLS, Anti-Cheat-Trigger |
| UI | 16 Tabs, kompakte Mobil-Nav, Fenster, Effektmodus, Meldungen | `bkmp-app-mode-bootstrap.js`, `bkmp-proto-compact-hud.js`, `style.css` |

# B. Vollständige Feature-Liste (Checkliste)

**Kampf und Gegner**
- [x] Auto-Kampf
- [x] Klick-Kampf mit Autoklicker-Schutz
- [x] Gegenangriff
- [x] Doppelschlag, Brand, Blitz, Eis, Magieresistenz, Regeneration, Rüstungsbrecher
- [x] Stufen mit Automatisch/Bleibt hier, Beste Stufe, Stufenwahl
- [x] Bosse, Minibosse, seltene Drachen
- [x] Event-Drachen (2)
- [x] Fundschatz

**Fortschritt**
- [x] Level/EP, Level-Meilensteine
- [x] 9 Upgrades mit Softcaps und Meilensteinen
- [x] Auto-Kauf mit Ressourcenfilter
- [x] 6 Produktionsgebäude + Obstgarten/Jagdhütte
- [x] Gebäude-Überladung, Booster (Gold/EP)
- [x] Skilltree (6 aktive Zweige) + Reset
- [ ] Meister-Zweig (nur Code)
- [x] Prestige, Prestige-Baum (52 Knoten), Prestige-Meilensteine
- [x] Paragon, Aufstieg/Drachenseelen
- [x] 9 Automatisierungs-Knoten, empfohlene Verteilung mit Priorität

**Runen und Drachen**
- [x] Runen: Drops, Aufwerten, Sofort, Substats, Neuwürfeln, Verschmelzen, Aufstieg +30, Verkaufen, Maximieren, Set-Speicher, 3 Hintergrund-Automatiken
- [x] Drachenzucht: 25 Arten, 5 Nester, Opfergabe, Brut, Füttern, Jugendlich-Training, Erwachsen-Werte
- [x] 3 Begleiter + Trainingsplatz, Drachen-Aufstieg, Lager-Erweiterungen
- [x] Favoriten, Umbenennen, Freilassen, Filter, Drachen-Dex, Lexikon

**Herausforderungen und Gilden**
- [x] Dungeons (7×4), Schlüssel, Tagesbonus, Wochen-Dungeon, Auto-Läufe, Bestzeiten, Bestenliste
- [x] Endloser Turm
- [x] Arena mit ELO
- [x] Weltboss mit Codes und Auto-Beitritt
- [x] Gilden: Gründen, Code, Anfragen, Rollen, Kasse, Kassenbonus, Level 1–100, Plätze
- [x] Gilden-Tech v3 (23 Knoten), Gildenboss, Gildenquests, Chat, Banner, Ziel, Log, Präsenz, Gilden-Arena, Gilden-Bestenliste

**Chronik und Rückkehr**
- [x] Tagesaufträge/Wochenziele mit Truhen und Neuwürfeln
- [x] Login-Kalender (Streak-Schutz über Gilde)
- [x] Bestiarium, Weltereignisse (6), Ziele-Übersicht
- [x] Offline-Belohnung (Server) mit Offline-Karte
- [x] OBS-Hintergrund-Nachholen

**Sammlung und Bedienung**
- [x] 431 Erfolge, 112 Website- + 175 Idle-Titel, 55 Rahmen, 28 Namensfarben
- [x] 18 Dorf-Skins (Kauf/Erfolg/Code/Drop) mit Vorschau
- [x] 26 Plüschtiere, Code-Einlösung
- [ ] Echtgeld-Käufe (deaktiviert)
- [x] 12 Ranglisten-Reiter, Kampfstatistik
- [x] Effektmodus + 7 Schalter, Wartungsmodus
- [x] App-Modus/PWA, OBS-Overlay
- [x] QA-Modus

**Website**
- [x] Umsatz-Dashboard, SW-Statistik
- [x] Investoren inkl. Prank
- [x] News, Kartenideen, Umfragen
- [x] Kartendatenbank inkl. Trending
- [x] Kartenverkauf inkl. Auszahlungen
- [x] PartnerShops inkl. Spotlight, Shardhändler, Kartenfirmen
- [x] Bestenliste, Feedback + Status-Board, Changelog
- [x] BK-Mod-Anbindung
- [x] Spielerkonten (Login, Umbenennen, Löschen, eine Sitzung)
- [x] Easter Eggs (über 20, inkl. Minispiel „Jake's Feldfahrt“)

# C. Vergessene oder versteckte Systeme

Diese Punkte haben in der bisherigen Projektübersicht wahrscheinlich gefehlt:

| # | Fund | Siehe |
|---|---|---|
| 1 | Skilltree-Zweig „Meister“ mit Zwerg Grimbold (Dialog, Bilder, 8 Knoten als SQL) – nie live geschaltet | 19.1 |
| 2 | Vier Boni ohne Wirkung: Effiziente Aufwertung, Schmelzmeister, Diamantenbonus, Offline-Effizienz (Expeditionscorps/Offline-Imperium) | 19.1 |
| 3 | Gildenquest-Stufe-3 verspricht ein Ei, gibt aber eine Rune | 19.1 |
| 4 | Weltboss-Belohnung ist seit dem 27.09. sehr wahrscheinlich pauschal statt anteilig; Zerathor-Dorf-Skin, Holz/Stein/Essenz und Booster sind dadurch nicht mehr erhältlich | 8.4 |
| 5 | Episches Meilenstein-Ei – fertig, nie verdrahtet | 19.1 |
| 6 | Arena- und Gildenboss-Bestenliste – Abfragen fertig, keine Anzeige | 19.1 |
| 7 | Echtgeld-Shop (Stripe) und „Drachenrahmen“ – fertig, ausgeschaltet | 19.1 |
| 8 | Tab-Sperre für Tester – Mechanismus ohne Verwendung | 19.1 |
| 9 | Mana – Spalte ohne Funktion | 4 |
| 10 | Altes Kartenauftrags-System – Tabellen noch live | 19.3 |
| 11 | Android-Paket `de.bkinvestment.idledorf` (TWA) | 17.3 |
| 12 | Raid-Erfolgs-Statistiken (MVP, „ohne Schaden“) | 8.4 |
| 13 | Wochen-Dungeon mit +50 % (Typ rotiert alle 7 Tage) | 8.1 |
| 14 | Gebäude-Überladung, Fundschatz, Level-Meilenstein-Bonus, Upgrade-Meilensteine | Kap. 3 und 6 |
| 15 | Alte Gilden-Tech-Tabelle und -RPC | 19.3 |

# D. Technische Risiken

| Bereich | Risiko |
|---|---|
| **Weltboss-Belohnung** | Zwei widersprüchliche `raid_finish`-Fassungen. Die zuletzt ausgeführte vergibt pauschal die volle Belohnung an jeden Teilnehmer (1,5 Mio. Gold, 1.000 Kristalle, 150.000 EP pro Stunde) und hat Drops entfernt. Das kann die Wirtschaft stark verschieben, falls es ungewollt war. |
| **Server vertraut Schadenswerten** | Weltboss/Gildenboss akzeptieren bis zu 200.000 Schaden pro Aufruf ohne Taktbegrenzung. Arena/Raid nutzen die vom Client gespiegelten Kampfwerte, die nur absolut gedeckelt sind. |
| **Client-Vertrauen allgemein** | Upgrades, Runen, Drachen, Prestige-Baum, Chronik-Auszahlungen, Turm-Tageslimit und Autoklicker-Schutz laufen im Browser. Die einzige Plausibilitätsprüfung ist der Zeitbudget-Trigger auf Siege/Level/Skillpunkte. |
| **Datenbankstruktur** | `idle_player_state` mit 70+ Spalten. Der Autosave schreibt die ganze Zeile; fehlt eine Spalte live, scheitern **alle** Speicherungen. CHECK-Grenzen auf Spalten haben schon einmal das Speichern blockiert (Level 2000). |
| **SQL-Drift** | Rund 260 SQL-Dateien, mehrfach überschriebene Funktionen (`create or replace`), keine Versionsverwaltung der live ausgeführten Fassung. Live-Stand und Dateien können auseinanderlaufen (bereits passiert: `dungeon_regen_calc`-Mehrdeutigkeit, Raid-Belohnung). |
| **Synchronisierung** | „Letzter Schreiber gewinnt“; bekannter Zwei-Tab-Wettlauf. Die Offline-Übernahme ersetzt Summen (`Object.assign`) und kann ungespeicherte lokale Gewinne überschreiben. Mehrere Speicherziele (Spielstand, Prestige, Runen, Drachen, Meta, `player_stats`) werden unabhängig gespeichert, ohne gemeinsame Transaktion. |
| **Alte Architektur** | Globale Funktionen und Variablen ohne Module, feste Ladereihenfolge. Teile sind auf `typeof`-Prüfungen angewiesen, weil Admin- und Overlay-Seite nicht alle Module laden. |
| **Riesige Dateien und doppeltes CSS** | `style.css` mit vielen konkurrierenden Regeln gleicher Spezifität; mehrfach dokumentierte Spezifitätsfallen. In CSS-Kommentaren schließt die Zeichenfolge Stern + Schrägstrich den Kommentar vorzeitig – das hat zweimal echte Fehler verursacht. |
| **Performance** | Effektmodus „Hoch“ im Kampf-Tab, HUD-Neuaufbau pro Tick, Erfolgs-Cache pro Sieg (Kap. 16.2). |
| **Kosten** | Supabase-Realtime und Vercel-Aufrufe pro Spieler kosten Geld; es gab bereits Überschreitungen (Realtime 07/2026, Vercel 09/2026). |
| **Kein Staging** | Eine Datenbank für Live und Entwicklung. Tests laufen deshalb nur gegen das nachgebaute Mock-Backend; das kann vom echten SQL abweichen. |
| **`localStorage`-Abhängigkeit** | Login-Serie, Überladung, Ausrüstungsset, Dungeon-Bestzeiten und Autoklicker-Sperre gehen bei Gerätewechsel verloren bzw. sind manipulierbar. |

# E. Projektgröße (geschätzt anhand des Codes)

| Messgröße | Wert |
|---|---|
| Wichtige JS-Dateien | ~40 (Kern 6, Systeme 16, UI 5, Prototyp 1, Dev 2, Easter Eggs 2, `idledorf.js`, `supabase.js`, `app.js`, `mapart.js`, `sw.js`) + 17 API-Funktionen |
| JS-Funktionen | ~1.460 (796 Spiel + 304 Website + 356 Datenbank-Wrapper), dazu Admin-Inline-Skript und `mapart.js` |
| Codezeilen (ohne Assets/Tests) | ~103.500, davon `style.css` 16.500, `bkmp-site.js` 8.400, `admin.html` 7.000, `supabase.js` 6.500, `idledorf.js` 4.000 |
| SQL-Dateien | ~260 |
| Tabellen / Views | 99 / 2, alle live vorhanden |
| SQL-Funktionen/RPCs | 102 |
| Spielsysteme | ~22 Hauptsysteme, über 60 Untersysteme |
| Idle-Tabs / Website-Tabs / Admin-Seiten | 16 / 10 / 26 |
| Overlays | 41 fest + ~10 dynamisch |
| Tests | 74 Dateien, 628 `test()`-Aufrufe, ~1.780 Testfälle über 3 Projekte (1.324 + 456 übersprungen) |
| Inhalte | 431 Erfolge, 287 Titel, 83 Kosmetiken, 52 Prestige-Knoten, 50 Skill-Knoten, 23 Gilden-Tech-Knoten, 37 Drachen (12 Kampf + 25 Zucht), 18 Skins, 26 Plüschtiere |

---

*Die folgenden Anhänge wurden automatisch aus dem laufenden Code bzw. der Live-Datenbank erzeugt (Stand 03.10.2026).*

## Anhang A1 – Alle Erfolge (431, zur Laufzeit exportiert)

Hinweis: Streamer-Erfolge („<Name>-Fan“, einer pro Creator in `streamer_links`) werden dynamisch aus der Creator-Liste erzeugt und sind hier nicht enthalten, weil der Export ohne Live-Creator-Liste lief. Erfolge mit Titel „???“ sind versteckt; in Klammern steht der Name, der nach dem Freischalten erscheint.

**Sonstiges** (8)

| ID | Titel | Bedingung |
|---|---|---|
| `name_set` | Angekommen | Trag deinen Minecraft-Namen ein. |
| `combo_card_wish` | Vielseitig | Reiche mindestens 1 Karte und 1 Kartenidee ein. |
| `night_owl` | Nachteule | Besuche die Seite zwischen 0 und 5 Uhr nachts. |
| `early_bird` | Frühaufsteher | Besuche die Seite zwischen 5 und 7 Uhr morgens. |
| `weekend_warrior` | Wochenend-Grinder | Besuche die Seite an einem Samstag und einem Sonntag. |
| `investor_match` | Investor | Dein Name taucht als echter Investor auf der Seite auf. |
| `panel_opener` | Erfolgs-Jäger | Öffne dieses Erfolge-Fenster 10 Mal. |
| `streamer_watch_all` | Streaming-Marathon | Schau dir alle Creator-Streams mindestens einmal an. |

**Karten** (24)

| ID | Titel | Bedingung |
|---|---|---|
| `card_1` | Erste Karte | Reiche 1 Karte in der Kartendatenbank ein. |
| `card_2` | Zweite Karte | Reiche 2 Karten in der Kartendatenbank ein. |
| `card_3` | Dreifach | Reiche 3 Karten in der Kartendatenbank ein. |
| `card_5` | Kartenfan | Reiche 5 Karten in der Kartendatenbank ein. |
| `card_10` | Kartensammler | Reiche 10 Karten in der Kartendatenbank ein. |
| `card_15` | Kartenkenner | Reiche 15 Karten in der Kartendatenbank ein. |
| `card_20` | Kartenprofi | Reiche 20 Karten in der Kartendatenbank ein. |
| `card_25` | Viertelhundert | Reiche 25 Karten in der Kartendatenbank ein. |
| `card_30` | Kartenmeister | Reiche 30 Karten in der Kartendatenbank ein. |
| `card_40` | Fleißarbeit | Reiche 40 Karten in der Kartendatenbank ein. |
| `card_50` | Halbes Hundert | Reiche 50 Karten in der Kartendatenbank ein. |
| `card_60` | Unaufhaltsam | Reiche 60 Karten in der Kartendatenbank ein. |
| `card_75` | Dreiviertelhundert | Reiche 75 Karten in der Kartendatenbank ein. |
| `card_100` | Kartenlegende | Reiche 100 Karten in der Kartendatenbank ein. |
| `card_125` | Kartenwahnsinn | Reiche 125 Karten in der Kartendatenbank ein. |
| `card_150` | Anderthalbhundert | Reiche 150 Karten in der Kartendatenbank ein. |
| `card_175` | Fast am Ziel | Reiche 175 Karten in der Kartendatenbank ein. |
| `card_200` | Zweihundert | Reiche 200 Karten in der Kartendatenbank ein. |
| `card_250` | Viertel-Tausend | Reiche 250 Karten in der Kartendatenbank ein. |
| `card_300` | Dreihundert | Reiche 300 Karten in der Kartendatenbank ein. |
| `card_350` | 350er-Klub | Reiche 350 Karten in der Kartendatenbank ein. |
| `card_400` | Vierhundert | Reiche 400 Karten in der Kartendatenbank ein. |
| `card_450` | Fast 500 | Reiche 450 Karten in der Kartendatenbank ein. |
| `card_500` | Kartengott | Reiche 500 Karten in der Kartendatenbank ein. |

**Kartenideen** (24)

| ID | Titel | Bedingung |
|---|---|---|
| `wish_1` | Erster Wunsch | Reiche 1 Kartenidee ein. |
| `wish_2` | Zweiter Wunsch | Reiche 2 Kartenideen ein. |
| `wish_3` | Dreifachwunsch | Reiche 3 Kartenideen ein. |
| `wish_5` | Wunschfan | Reiche 5 Kartenideen ein. |
| `wish_10` | Wunschsammler | Reiche 10 Kartenideen ein. |
| `wish_15` | Wunschkenner | Reiche 15 Kartenideen ein. |
| `wish_20` | Wunschprofi | Reiche 20 Kartenideen ein. |
| `wish_25` | Viertelhundert Wünsche | Reiche 25 Kartenideen ein. |
| `wish_30` | Wunschmeister | Reiche 30 Kartenideen ein. |
| `wish_40` | Fleißiger Wünscher | Reiche 40 Kartenideen ein. |
| `wish_50` | Halbes Hundert Wünsche | Reiche 50 Kartenideen ein. |
| `wish_60` | Unaufhaltsam | Reiche 60 Kartenideen ein. |
| `wish_75` | Dreiviertelhundert Wünsche | Reiche 75 Kartenideen ein. |
| `wish_100` | Wunschlegende | Reiche 100 Kartenideen ein. |
| `wish_125` | Wunschwahnsinn | Reiche 125 Kartenideen ein. |
| `wish_150` | Anderthalbhundert Wünsche | Reiche 150 Kartenideen ein. |
| `wish_175` | Fast am Ziel | Reiche 175 Kartenideen ein. |
| `wish_200` | Zweihundert Wünsche | Reiche 200 Kartenideen ein. |
| `wish_250` | Viertel-Tausend Wünsche | Reiche 250 Kartenideen ein. |
| `wish_300` | Dreihundert Wünsche | Reiche 300 Kartenideen ein. |
| `wish_350` | 350er-Klub | Reiche 350 Kartenideen ein. |
| `wish_400` | Vierhundert Wünsche | Reiche 400 Kartenideen ein. |
| `wish_450` | Fast 500 Wünsche | Reiche 450 Kartenideen ein. |
| `wish_500` | Wunschgott | Reiche 500 Kartenideen ein. |

**Zeit & Treue** (57)

| ID | Titel | Bedingung |
|---|---|---|
| `time_1` | Erster Besuch | Verbringe insgesamt 1 Minute auf der Seite. |
| `time_2` | Zwei Minuten | Verbringe insgesamt 2 Minuten auf der Seite. |
| `time_5` | Kurz reingeschaut | Verbringe insgesamt 5 Minuten auf der Seite. |
| `time_10` | Stammgast | Verbringe insgesamt 10 Minuten auf der Seite. |
| `time_15` | Viertelstunde | Verbringe insgesamt 15 Minuten auf der Seite. |
| `time_20` | Zwanzig Minuten | Verbringe insgesamt 20 Minuten auf der Seite. |
| `time_30` | Halbe Stunde | Verbringe insgesamt 30 Minuten auf der Seite. |
| `time_45` | Fast eine Stunde | Verbringe insgesamt 45 Minuten auf der Seite. |
| `time_60` | Wohnt hier jetzt | Verbringe insgesamt 60 Minuten auf der Seite. |
| `time_90` | Anderthalb Stunden | Verbringe insgesamt 90 Minuten auf der Seite. |
| `time_120` | Zwei Stunden | Verbringe insgesamt 120 Minuten auf der Seite. |
| `time_150` | Zweieinhalb Stunden | Verbringe insgesamt 150 Minuten auf der Seite. |
| `time_180` | Drei Stunden | Verbringe insgesamt 180 Minuten auf der Seite. |
| `time_240` | Vier Stunden | Verbringe insgesamt 240 Minuten auf der Seite. |
| `time_300` | Fünf Stunden | Verbringe insgesamt 300 Minuten auf der Seite. |
| `time_360` | Sechs Stunden | Verbringe insgesamt 360 Minuten auf der Seite. |
| `time_480` | Ein Arbeitstag | Verbringe insgesamt 480 Minuten auf der Seite. |
| `time_600` | Zehn Stunden | Verbringe insgesamt 600 Minuten auf der Seite. |
| `time_720` | Zwölf Stunden | Verbringe insgesamt 720 Minuten auf der Seite. |
| `time_900` | Fünfzehn Stunden | Verbringe insgesamt 900 Minuten auf der Seite. |
| `time_1200` | Zwanzig Stunden | Verbringe insgesamt 1200 Minuten auf der Seite. |
| `time_1440` | Ein voller Tag | Verbringe insgesamt 1440 Minuten auf der Seite. |
| `time_1800` | Dreißig Stunden | Verbringe insgesamt 1800 Minuten auf der Seite. |
| `time_2400` | Vierzig Stunden | Verbringe insgesamt 2400 Minuten auf der Seite. |
| `time_3000` | Fünfzig Stunden | Verbringe insgesamt 3000 Minuten auf der Seite. |
| `days_1` | Erster Tag | Besuche die Seite an 1 verschiedenen Tagen. |
| `days_2` | Zweiter Tag | Besuche die Seite an 2 verschiedenen Tagen. |
| `days_3` | Drei Tage | Besuche die Seite an 3 verschiedenen Tagen. |
| `days_5` | Fünf Tage | Besuche die Seite an 5 verschiedenen Tagen. |
| `days_7` | Eine Woche | Besuche die Seite an 7 verschiedenen Tagen. |
| `days_10` | Zehn Tage | Besuche die Seite an 10 verschiedenen Tagen. |
| `days_14` | Zwei Wochen | Besuche die Seite an 14 verschiedenen Tagen. |
| `days_21` | Drei Wochen | Besuche die Seite an 21 verschiedenen Tagen. |
| `days_30` | Ein Monat | Besuche die Seite an 30 verschiedenen Tagen. |
| `days_45` | Sechs Wochen | Besuche die Seite an 45 verschiedenen Tagen. |
| `days_60` | Zwei Monate | Besuche die Seite an 60 verschiedenen Tagen. |
| `days_90` | Ein Quartal | Besuche die Seite an 90 verschiedenen Tagen. |
| `days_120` | Vier Monate | Besuche die Seite an 120 verschiedenen Tagen. |
| `days_180` | Ein halbes Jahr | Besuche die Seite an 180 verschiedenen Tagen. |
| `days_270` | Neun Monate | Besuche die Seite an 270 verschiedenen Tagen. |
| `days_365` | Ein ganzes Jahr | Besuche die Seite an 365 verschiedenen Tagen. |
| `sheepstreak_1` | Erstes Määh | Klicke 1 Tag in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_2` | Zwei Määhs | Klicke 2 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_3` | Woll-Neuling | Klicke 3 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_4` | Schaf-Stammgast | Klicke 4 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_5` | Fünf-Tage-Fellfreund | Klicke 5 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_6` | Halbdutzend-Määher | Klicke 6 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_7` | Wochen-Schäfchen | Klicke 7 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_8` | Wolliger Wiederholungstäter | Klicke 8 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_9` | Fast-Zehn-Zottel | Klicke 9 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_10` | Zehn-Tage-Treue | Klicke 10 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_15` | Anderthalb Wochen wollig | Klicke 15 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_30` | Monats-Määhster | Klicke 30 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_60` | Zwei-Monats-Zottel | Klicke 60 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_120` | Vier-Monats-Fellnase | Klicke 120 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_240` | Achtmonatiger Wollversteher | Klicke 240 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |
| `sheepstreak_365` | Schafsweisheit des Jahres | Klicke 365 Tage in Folge ab 12 Uhr auf unser Schaf für das Zitat des Tages. |

**Vielfalt** (8)

| ID | Titel | Bedingung |
|---|---|---|
| `diversity_1` | Erste Kategorie | Reiche Karten in 1 verschiedenen Kategorien ein. |
| `diversity_2` | Zwei Kategorien | Reiche Karten in 2 verschiedenen Kategorien ein. |
| `diversity_3` | Drei Kategorien | Reiche Karten in 3 verschiedenen Kategorien ein. |
| `diversity_4` | Vier Kategorien | Reiche Karten in 4 verschiedenen Kategorien ein. |
| `diversity_5` | Fünf Kategorien | Reiche Karten in 5 verschiedenen Kategorien ein. |
| `diversity_6` | Sechs Kategorien | Reiche Karten in 6 verschiedenen Kategorien ein. |
| `diversity_7` | Sieben Kategorien | Reiche Karten in 7 verschiedenen Kategorien ein. |
| `diversity_8` | Alleskönner | Reiche Karten in 8 verschiedenen Kategorien ein. |

**Meilensteine** (14)

| ID | Titel | Bedingung |
|---|---|---|
| `meta_5` | Erste Schritte | Schalte 5 andere Erfolge frei. |
| `meta_10` | Zehn Erfolge | Schalte 10 andere Erfolge frei. |
| `meta_20` | Zwanzig Erfolge | Schalte 20 andere Erfolge frei. |
| `meta_30` | Dreißig Erfolge | Schalte 30 andere Erfolge frei. |
| `meta_40` | Vierzig Erfolge | Schalte 40 andere Erfolge frei. |
| `meta_50` | Fünfzig Erfolge | Schalte 50 andere Erfolge frei. |
| `meta_60` | Sechzig Erfolge | Schalte 60 andere Erfolge frei. |
| `meta_70` | Siebzig Erfolge | Schalte 70 andere Erfolge frei. |
| `meta_80` | Achtzig Erfolge | Schalte 80 andere Erfolge frei. |
| `meta_90` | Neunzig Erfolge | Schalte 90 andere Erfolge frei. |
| `meta_100` | Hundert Erfolge | Schalte 100 andere Erfolge frei. |
| `meta_110` | Hundertzehn Erfolge | Schalte 110 andere Erfolge frei. |
| `meta_120` | Hundertzwanzig Erfolge | Schalte 120 andere Erfolge frei. |
| `meta_125` | Fast alles | Schalte 125 andere Erfolge frei. |

**Bonk** (30)

| ID | Titel | Bedingung |
|---|---|---|
| `bonk_1` | Erster Bonk | Klicke 1x auf den Bonk-Button. |
| `bonk_2` | Zweiter Bonk | Klicke 2x auf den Bonk-Button. |
| `bonk_5` | Bonk-Fan | Klicke 5x auf den Bonk-Button. |
| `bonk_10` | Bonk-Sammler | Klicke 10x auf den Bonk-Button. |
| `bonk_25` | Bonk-Profi | Klicke 25x auf den Bonk-Button. |
| `bonk_50` | Bonk-Meister | Klicke 50x auf den Bonk-Button. |
| `bonk_100` | Bonk-Legende | Klicke 100x auf den Bonk-Button. |
| `bonk_250` | Viertel-Tausend Bonks | Klicke 250x auf den Bonk-Button. |
| `bonk_500` | Bonk-Gott | Klicke 500x auf den Bonk-Button. |
| `bonk_1000` | Tausend Bonks | Klicke 1000x auf den Bonk-Button. |
| `bonk_2500` | Zweieinhalbtausend Bonks | Klicke 2500x auf den Bonk-Button. |
| `bonk_5000` | Fünftausend Bonks | Klicke 5000x auf den Bonk-Button. |
| `bonk_10000` | Zehntausend Bonks | Klicke 10000x auf den Bonk-Button. |
| `bonk_25000` | Fünfundzwanzigtausend Bonks | Klicke 25000x auf den Bonk-Button. |
| `bonk_50000` | Fünfzigtausend Bonks | Klicke 50000x auf den Bonk-Button. |
| `bonk_75000` | Fünfundsiebzigtausend Bonks | Klicke 75000x auf den Bonk-Button. |
| `bonk_100000` | Hunderttausend Bonks | Klicke 100000x auf den Bonk-Button. |
| `bonk_150000` | Anderthalbhunderttausend Bonks | Klicke 150000x auf den Bonk-Button. |
| `bonk_200000` | Zweihunderttausend Bonks | Klicke 200000x auf den Bonk-Button. |
| `bonk_250000` | Viertelmillion Bonks | Klicke 250000x auf den Bonk-Button. |
| `bonk_300000` | Dreihunderttausend Bonks | Klicke 300000x auf den Bonk-Button. |
| `bonk_400000` | Vierhunderttausend Bonks | Klicke 400000x auf den Bonk-Button. |
| `bonk_500000` | Halbe Million Bonks | Klicke 500000x auf den Bonk-Button. |
| `bonk_600000` | Sechshunderttausend Bonks | Klicke 600000x auf den Bonk-Button. |
| `bonk_700000` | Siebenhunderttausend Bonks | Klicke 700000x auf den Bonk-Button. |
| `bonk_800000` | Achthunderttausend Bonks | Klicke 800000x auf den Bonk-Button. |
| `bonk_900000` | Neunhunderttausend Bonks | Klicke 900000x auf den Bonk-Button. |
| `bonk_950000` | Fast geschafft | Klicke 950000x auf den Bonk-Button. |
| `bonk_990000` | Ganz knapp | Klicke 990000x auf den Bonk-Button. |
| `bonk_1000000` | Der ewige Bonker | Klicke 1000000x auf den Bonk-Button. |

**Feedback** (20)

| ID | Titel | Bedingung |
|---|---|---|
| `feedback_lob_1` | Erstes Lob | Sende 1 Feedback der Kategorie "Lob". |
| `feedback_lob_3` | Lob-Fan | Sende 3 Feedbacks der Kategorie "Lob". |
| `feedback_lob_5` | Lobredner | Sende 5 Feedbacks der Kategorie "Lob". |
| `feedback_lob_10` | Lob-Champion | Sende 10 Feedbacks der Kategorie "Lob". |
| `feedback_lob_20` | Legende des Lobes | Sende 20 Feedbacks der Kategorie "Lob". |
| `feedback_kritik_1` | Erste Kritik | Sende 1 Feedback der Kategorie "Kritik". |
| `feedback_kritik_3` | Kritik-Fan | Sende 3 Feedbacks der Kategorie "Kritik". |
| `feedback_kritik_5` | Kritiker | Sende 5 Feedbacks der Kategorie "Kritik". |
| `feedback_kritik_10` | Kritik-Profi | Sende 10 Feedbacks der Kategorie "Kritik". |
| `feedback_kritik_20` | Meister der Kritik | Sende 20 Feedbacks der Kategorie "Kritik". |
| `feedback_idee_1` | Erste Idee | Sende 1 Feedback der Kategorie "Idee". |
| `feedback_idee_3` | Ideenreich | Sende 3 Feedbacks der Kategorie "Idee". |
| `feedback_idee_5` | Ideengeber | Sende 5 Feedbacks der Kategorie "Idee". |
| `feedback_idee_10` | Ideenmaschine | Sende 10 Feedbacks der Kategorie "Idee". |
| `feedback_idee_20` | Erfinder-Legende | Sende 20 Feedbacks der Kategorie "Idee". |
| `feedback_sonstiges_1` | Erste Nachricht | Sende 1 Feedback der Kategorie "Sonstiges". |
| `feedback_sonstiges_3` | Vielschreiber | Sende 3 Feedbacks der Kategorie "Sonstiges". |
| `feedback_sonstiges_5` | Kommunikativ | Sende 5 Feedbacks der Kategorie "Sonstiges". |
| `feedback_sonstiges_10` | Vielredner | Sende 10 Feedbacks der Kategorie "Sonstiges". |
| `feedback_sonstiges_20` | Feedback-Legende | Sende 20 Feedbacks der Kategorie "Sonstiges". |

**Easter Eggs** (22)

| ID | Titel | Bedingung |
|---|---|---|
| `egg_bkmp` | ??? (BKMP-Flüsterer) | Finde ein verstecktes Easter Egg. — Hinweis: Manche Namen tippt man öfter, als man denkt. |
| `egg_konami` | ??? (Konami-Veteran) | Finde ein verstecktes Easter Egg. — Hinweis: Hoch, hoch, runter, runter... eine uralte Cheat-Tradition. |
| `egg_fire` | ??? (Drachenbändiger) | Finde ein verstecktes Easter Egg. — Hinweis: Was fürchten Dörfer und Ritter gleichermaßen? Tipp es einfach. |
| `egg_phil` | ??? (Phil-Fan) | Finde ein verstecktes Easter Egg. — Hinweis: Es gibt da diesen einen Bodybuilder in der Kartendatenbank... |
| `egg_creeper` | ??? (Creeper-Entschärfer) | Finde ein verstecktes Easter Egg. — Hinweis: Sssss... ein sehr grünes, sehr explosives Minecraft-Wesen. |
| `egg_diamond` | ??? (Diamantenregen-Macher) | Finde ein verstecktes Easter Egg. — Hinweis: Klick oft und schnell auf das Banner ganz oben auf der Seite. |
| `egg_matrix` | ??? (Der Auserwählte) | Finde ein verstecktes Easter Egg. — Hinweis: Rot oder blau? Tipp den Namen eines berühmten Filmuniversums. |
| `egg_idle` | ??? (Schlummer-Entdecker) | Finde ein verstecktes Easter Egg. — Hinweis: Lass die Seite einfach mal ein paar Minuten in Ruhe. |
| `egg_rainbow` | ??? (Regenbogen-Dreher) | Finde ein verstecktes Easter Egg. — Hinweis: Du wirst suchen müssen... oder drücken? Irgendwas Rundes auf der Seite dreht sich vielleicht gerne. |
| `egg_derliber` | ??? (Liber-Jäger) | Finde ein verstecktes Easter Egg. — Hinweis: Suche 10 kleine Liber-Strichmännchen, versteckt auf der ganzen Website. |
| `egg_jannik` | ??? (Jannik der Hase) | Finde ein verstecktes Easter Egg. — Hinweis: Es heißt, irgendwo hoppelt ein kleiner Jannik Hase herum... Aber niemand weiß genau, wo. |
| `egg_adfree` | ??? (Hab kein Geld) | Finde ein verstecktes Easter Egg. — Hinweis: Werbung nervt echt manchmal, oder? |
| `egg_sheep` | ??? (Schaf Zitate Flüsterer) | Finde ein verstecktes Easter Egg. — Hinweis: Jeden Tag werden wir bereichert damit! |
| `egg_penguin` | ??? (Pinguin-Fischer) | Finde ein verstecktes Easter Egg. — Hinweis: Nur bei Tageslicht versteckt sich im Schnee ein kleiner Freund mit Fisch-Appetit. |
| `egg_zerathor` | ??? (Boss-Wecker) | Finde ein verstecktes Easter Egg. — Hinweis: Tipp den Namen des Drachen, vor dem sich ganze Dörfer fürchten. |
| `egg_mouseshake` | ??? (Maus-Schüttler) | Finde ein verstecktes Easter Egg. — Hinweis: Manchmal verliert man seinen Mauszeiger auf dem Bildschirm aus den Augen... wackle mal ganz wild hin und her. |
| `egg_rightclick` | ??? (Rechtsklick-Entdecker) | Finde ein verstecktes Easter Egg. — Hinweis: Was passiert wohl, wenn man dreimal schnell hintereinander die rechte Maustaste drückt? |
| `egg_jakesfeldfahrt` | ??? (Feldfahrt-Entdecker) | Finde ein verstecktes Easter Egg. — Hinweis: Ein kleiner Traktor irgendwo auf der Seite freut sich über mehrere schnelle Klicks. |
| `egg_positivmodus` | ??? (Realitätsverweigerer) | Finde ein verstecktes Easter Egg. — Hinweis: Manche Zahlen auf der Investoren-Seite sind einfach zu rot. Klick fünfmal schnell drauf. |
| `egg_swbk` | ??? (Warp-Reisender) | Finde ein verstecktes Easter Egg. — Hinweis: Wie kommt man ingame eigentlich zu uns? Probier den Befehl doch mal hier auf der Seite. |
| `egg_all` | Osterhase | Finde alle 20 versteckten Easter Eggs. |
| `kora_finder` | Du kannst mich austricksen.. | Wo man überall Plüshi-Codes findet, verrückt oder? |

**BK-Mod & Shops** (7)

| ID | Titel | Bedingung |
|---|---|---|
| `mod_linked` | Verbunden | Verbinde die BK-Mod mit deinem Website-Konto (Knopf „OPBK-Kartendatenbank-Mod verbinden“ oben auf der Seite). |
| `modcard_1` | Mod-Pionier | Reiche 1 Karte direkt im Spiel über die BK-Mod ein, die vom Team angenommen wird. |
| `modcard_3` | Kartenscout | Reiche 3 Karten direkt im Spiel über die BK-Mod ein, die vom Team angenommen werden. |
| `modcard_10` | Kartograf | Reiche 10 Karten direkt im Spiel über die BK-Mod ein, die vom Team angenommen werden. |
| `modcard_25` | Mod-Archivar | Reiche 25 Karten direkt im Spiel über die BK-Mod ein, die vom Team angenommen werden. |
| `modcard_50` | Weltvermesser | Reiche 50 Karten direkt im Spiel über die BK-Mod ein, die vom Team angenommen werden. |
| `partnershop_own` | Ladenbesitzer | Reiche deinen eigenen Shop als PartnerShop ein (eingeloggt auf der Website oder über die Mod) – sobald er angenommen ist, gehört der Erfolg dir. |

**Plüshies** (10)

| ID | Titel | Bedingung |
|---|---|---|
| `plushie_yaksha` | ???? Plüshie (Yaksha Plüshie) | Schalte diesen Plüshie per Code frei. |
| `plushie_darkorius` | ???? Plüshie (Darkorius Plüshie) | Schalte diesen Plüshie per Code frei. |
| `plushie_lukas` | ???? Plüshie (Lukas Plüshie) | Schalte diesen Plüshie per Code frei. |
| `plushie_obsi` | ???? Plüshie (Obsi Plüshie) | Schalte diesen Plüshie per Code frei. |
| `plushie_roggberd` | ???? Plüshie (Roggberd Plüshie) | Schalte diesen Plüshie per Code frei. |
| `plushie_all` | Besitze sie alle | Schalte alle Plüshies frei. |
| `daily_event_1` | ??? (Glücklicher Gewinner) | Gewinne ein Daily-Code-Event. |
| `daily_event_5` | ??? (Serien-Gewinner) | Gewinne 5 Daily-Code-Events. |
| `daily_event_15` | ??? (Event-Champion) | Gewinne 15 Daily-Code-Events. |
| `golden_hour_win` | ??? (Der Auserwählte) | Gewinne den Code der Golden Hour als Erster. |

**Idle Dorf** (102)

| ID | Titel | Bedingung |
|---|---|---|
| `idle_started` | Dorfgründung | Öffne das Idle Drachen Dorf zum ersten Mal. |
| `idle_first_boss` | Bosskämpfer | Besiege deinen ersten Boss-Drachen im Idle Dorf. |
| `idle_boss_10` | Bossjäger | Besiege 10 Boss-Drachen. |
| `idle_boss_50` | Boss-Vernichter | Besiege 50 Boss-Drachen. |
| `idle_skillpoints_1` | Erster Skillpunkt | Investiere deinen ersten Skillpunkt. |
| `idle_branch_one` | Spezialist | Maximiere einen kompletten Skilltree-Zweig. |
| `idle_branch_three` | Vielseitiger Anführer | Maximiere drei komplette Skilltree-Zweige. |
| `idle_branch_all` | Skilltree-Meister | Maximiere alle 5 Skilltree-Zweige. |
| `streak_3` | Dranbleiber | Logge dich 3 Tage in Folge ein. |
| `streak_7` | Wochentreue | Logge dich 7 Tage in Folge ein. |
| `streak_30` | Ein Monat treu | Logge dich 30 Tage in Folge ein. |
| `steampunk_owner` | Zahnrad-Sammler | Besitze den Dorf-Skin "Steampunk Dorf". |
| `chronicle_quest_1` | Auftragnehmer | Erfülle deinen ersten Auftrag aus der Chronik. |
| `chronicle_quest_25` | Zuverlässiger Held | Erfülle 25 Aufträge aus der Chronik. |
| `chronicle_quest_100` | Chronist | Erfülle 100 Aufträge aus der Chronik. |
| `chronicle_weekly_1` | Wochenwerk | Öffne deine erste Wochentruhe. |
| `chronicle_weekly_10` | Unermüdlicher Planer | Öffne 10 Wochentruhen. |
| `world_event_10` | Glückspilz | Erlebe 10 Weltereignisse im Kampf. |
| `world_event_100` | Ereignisjäger | Erlebe 100 Weltereignisse im Kampf. |
| `bestiary_10` | Drachenkundler | Erreiche insgesamt 10 Stufen im Drachen-Bestiarium. |
| `bestiary_30` | Meister des Bestiariums | Erreiche insgesamt 30 Stufen im Drachen-Bestiarium. |
| `idledragon_1` | Erster Drache | Besiege 1 Drache im Idle Dorf. |
| `idledragon_5` | Drachentöter | Besiege 5 Drachen im Idle Dorf. |
| `idledragon_10` | Drachenschreck | Besiege 10 Drachen im Idle Dorf. |
| `idledragon_25` | Drachenjäger | Besiege 25 Drachen im Idle Dorf. |
| `idledragon_50` | Drachenbezwinger | Besiege 50 Drachen im Idle Dorf. |
| `idledragon_100` | Hundert Drachen | Besiege 100 Drachen im Idle Dorf. |
| `idledragon_200` | Zweihundert Drachen | Besiege 200 Drachen im Idle Dorf. |
| `idledragon_350` | Drachenschlächter | Besiege 350 Drachen im Idle Dorf. |
| `idledragon_500` | Fünfhundert Drachen | Besiege 500 Drachen im Idle Dorf. |
| `idledragon_750` | Dreiviertel-Tausend | Besiege 750 Drachen im Idle Dorf. |
| `idledragon_1000` | Drachenlegende | Besiege 1000 Drachen im Idle Dorf. |
| `idledragon_2000` | Zweitausend Drachen | Besiege 2000 Drachen im Idle Dorf. |
| `idledragon_5000` | Der Drachenkönig | Besiege 5000 Drachen im Idle Dorf. |
| `idlelevel_5` | Dorfgründer | Erreiche Dorf-Level 5 im Idle Dorf. |
| `idlelevel_10` | Aufstrebendes Dorf | Erreiche Dorf-Level 10 im Idle Dorf. |
| `idlelevel_20` | Wachsendes Reich | Erreiche Dorf-Level 20 im Idle Dorf. |
| `idlelevel_30` | Starkes Dorf | Erreiche Dorf-Level 30 im Idle Dorf. |
| `idlelevel_40` | Blühendes Reich | Erreiche Dorf-Level 40 im Idle Dorf. |
| `idlelevel_50` | Mächtiges Dorf | Erreiche Dorf-Level 50 im Idle Dorf. |
| `idlelevel_60` | Festung | Erreiche Dorf-Level 60 im Idle Dorf. |
| `idlelevel_75` | Bollwerk | Erreiche Dorf-Level 75 im Idle Dorf. |
| `idlelevel_100` | Legendäres Dorf | Erreiche Dorf-Level 100 im Idle Dorf. |
| `idlelevel_150` | Unbezwingbares Reich | Erreiche Dorf-Level 150 im Idle Dorf. |
| `idlelevel_200` | Ewiges Dorf | Erreiche Dorf-Level 200 im Idle Dorf. |
| `idlelevel_300` | Mythisches Reich | Erreiche Dorf-Level 300 im Idle Dorf. |
| `idlegold_1000` | Erste Reserven | Sammle insgesamt 1000 Gold im Idle Dorf. |
| `idlegold_10000` | Ordentliche Kasse | Sammle insgesamt 10000 Gold im Idle Dorf. |
| `idlegold_50000` | Wohlhabend | Sammle insgesamt 50000 Gold im Idle Dorf. |
| `idlegold_100000` | Reicher Händler | Sammle insgesamt 100000 Gold im Idle Dorf. |
| `idlegold_500000` | Kleines Vermögen | Sammle insgesamt 500000 Gold im Idle Dorf. |
| `idlegold_1000000` | Millionär | Sammle insgesamt 1000000 Gold im Idle Dorf. |
| `idlegold_5000000` | Großes Vermögen | Sammle insgesamt 5000000 Gold im Idle Dorf. |
| `idlegold_10000000` | Zehnfacher Millionär | Sammle insgesamt 10000000 Gold im Idle Dorf. |
| `idlegold_50000000` | Schatzmeister | Sammle insgesamt 50000000 Gold im Idle Dorf. |
| `idlegold_100000000` | Goldberg | Sammle insgesamt 100000000 Gold im Idle Dorf. |
| `idlegold_500000000` | Unermesslicher Reichtum | Sammle insgesamt 500000000 Gold im Idle Dorf. |
| `idlegold_1000000000` | Drachenschatz-Herrscher | Sammle insgesamt 1000000000 Gold im Idle Dorf. |
| `idleskill_5` | Erste Talente | Investiere 5 Skillpunkte im Idle Dorf. |
| `idleskill_15` | Talentiert | Investiere 15 Skillpunkte im Idle Dorf. |
| `idleskill_30` | Vielseitig geschult | Investiere 30 Skillpunkte im Idle Dorf. |
| `idleskill_50` | Meister der Künste | Investiere 50 Skillpunkte im Idle Dorf. |
| `idleskill_75` | Großmeister | Investiere 75 Skillpunkte im Idle Dorf. |
| `idleskill_100` | Skilltree-Experte | Investiere 100 Skillpunkte im Idle Dorf. |
| `idleskill_150` | Vollendete Kunst | Investiere 150 Skillpunkte im Idle Dorf. |
| `idleskill_200` | Meister aller Zweige | Investiere 200 Skillpunkte im Idle Dorf. |
| `idleprestige_1` | Prestige 1 | Steige 1x im Idle Dorf auf (Prestige). |
| `idleprestige_2` | Prestige 2 | Steige 2x im Idle Dorf auf (Prestige). |
| `idleprestige_3` | Prestige 3 | Steige 3x im Idle Dorf auf (Prestige). |
| `idleprestige_4` | Prestige 4 | Steige 4x im Idle Dorf auf (Prestige). |
| `idleprestige_5` | Prestige 5 | Steige 5x im Idle Dorf auf (Prestige). |
| `idleprestige_6` | Prestige 6 | Steige 6x im Idle Dorf auf (Prestige). |
| `idleprestige_7` | Prestige 7 | Steige 7x im Idle Dorf auf (Prestige). |
| `idleprestige_8` | Prestige 8 | Steige 8x im Idle Dorf auf (Prestige). |
| `idleprestige_9` | Prestige 9 | Steige 9x im Idle Dorf auf (Prestige). |
| `idleprestige_10` | Prestige 10 | Steige 10x im Idle Dorf auf (Prestige). |
| `idleprestige_12` | Prestige 12 | Steige 12x im Idle Dorf auf (Prestige). |
| `idleprestige_14` | Prestige 14 | Steige 14x im Idle Dorf auf (Prestige). |
| `idleprestige_16` | Prestige 16 | Steige 16x im Idle Dorf auf (Prestige). |
| `idleprestige_18` | Prestige 18 | Steige 18x im Idle Dorf auf (Prestige). |
| `idleprestige_20` | Prestige 20 | Steige 20x im Idle Dorf auf (Prestige). |
| `idleprestige_23` | Prestige 23 | Steige 23x im Idle Dorf auf (Prestige). |
| `idleprestige_26` | Prestige 26 | Steige 26x im Idle Dorf auf (Prestige). |
| `idleprestige_30` | Prestige 30 | Steige 30x im Idle Dorf auf (Prestige). |
| `idleprestige_35` | Prestige 35 | Steige 35x im Idle Dorf auf (Prestige). |
| `idleprestige_40` | Prestige 40 | Steige 40x im Idle Dorf auf (Prestige). |
| `idleprestige_45` | Prestige 45 | Steige 45x im Idle Dorf auf (Prestige). |
| `idleprestige_50` | Prestige 50 | Steige 50x im Idle Dorf auf (Prestige). |
| `idleprestige_60` | Prestige 60 | Steige 60x im Idle Dorf auf (Prestige). |
| `idleprestige_75` | Prestige 75 | Steige 75x im Idle Dorf auf (Prestige). |
| `idleprestige_100` | Prestige 100 | Steige 100x im Idle Dorf auf (Prestige). |
| `idletower_10` | Turmkletterer | Erreiche Stufe 10 im Endlosen Turm. |
| `idletower_20` | Turmläufer | Erreiche Stufe 20 im Endlosen Turm. |
| `idletower_35` | Turmbezwinger | Erreiche Stufe 35 im Endlosen Turm. |
| `idletower_50` | Turmveteran | Erreiche Stufe 50 im Endlosen Turm. |
| `idletower_75` | Turmmeister | Erreiche Stufe 75 im Endlosen Turm. |
| `idletower_100` | Turmchampion | Erreiche Stufe 100 im Endlosen Turm. |
| `idletower_150` | Turmlegende | Erreiche Stufe 150 im Endlosen Turm. |
| `idletower_200` | Turmtitan | Erreiche Stufe 200 im Endlosen Turm. |
| `idletower_300` | Turmgott | Erreiche Stufe 300 im Endlosen Turm. |
| `idletower_500` | Der Unaufhaltsame | Erreiche Stufe 500 im Endlosen Turm. |
| `idle_dungeon_cleared` | ??? (Dungeon-Meister) | Meistere die Dungeon-Herausforderung auf der Schwierigkeit "Albtraum". |

**Runen** (58)

| ID | Titel | Bedingung |
|---|---|---|
| `rune_equip_rarity_gray` | Purist | Ruste alle 6 Runen-Plätze gleichzeitig mit Gewöhnlich-Runen aus. |
| `rune_equip_rarity_green` | Grüner Daumen | Ruste alle 6 Runen-Plätze gleichzeitig mit Ungewöhnlich-Runen aus. |
| `rune_equip_rarity_blue` | Blaues Blut | Ruste alle 6 Runen-Plätze gleichzeitig mit Selten-Runen aus. |
| `rune_equip_rarity_purple` | Violette Vorherrschaft | Ruste alle 6 Runen-Plätze gleichzeitig mit Episch-Runen aus. |
| `rune_equip_rarity_gold` | Runengott | Ruste alle 6 Runen-Plätze gleichzeitig mit Legendär-Runen aus. |
| `rune_equip_level_3` | Frisch geschliffen | Bringe alle 6 ausgerüsteten Runen gleichzeitig auf mindestens +3. |
| `rune_equip_level_6` | Feingeschliffen | Bringe alle 6 ausgerüsteten Runen gleichzeitig auf mindestens +6. |
| `rune_equip_level_9` | Meisterlich veredelt | Bringe alle 6 ausgerüsteten Runen gleichzeitig auf mindestens +9. |
| `rune_equip_level_12` | Nahezu perfekt | Bringe alle 6 ausgerüsteten Runen gleichzeitig auf mindestens +12. |
| `rune_equip_level_15` | Runen-Perfektion | Bringe alle 6 ausgerüsteten Runen gleichzeitig auf mindestens +15. |
| `runefuse_1` | Erste Verschmelzung | Verschmelze 1 Rune erfolgreich. |
| `runefuse_5` | Runenschmelzer | Verschmelze 5 Runen erfolgreich. |
| `runefuse_15` | Fusionsmeister | Verschmelze 15 Runen erfolgreich. |
| `runefuse_30` | Runenalchemist | Verschmelze 30 Runen erfolgreich. |
| `runefuse_60` | Schmelztiegel-Meister | Verschmelze 60 Runen erfolgreich. |
| `runefuse_100` | Runenveredler | Verschmelze 100 Runen erfolgreich. |
| `runefuse_200` | Großmeister der Fusion | Verschmelze 200 Runen erfolgreich. |
| `runefuse_350` | Legende der Verschmelzung | Verschmelze 350 Runen erfolgreich. |
| `runefuse_500` | Fusionsdämon | Verschmelze 500 Runen erfolgreich. |
| `runefuse_750` | Runenschmiede-Titan | Verschmelze 750 Runen erfolgreich. |
| `runefuse_1000` | Tausendfache Verschmelzung | Verschmelze 1000 Runen erfolgreich. |
| `runefuse_2500` | Schmelztiegel-Gottheit | Verschmelze 2500 Runen erfolgreich. |
| `runefuse_5000` | Ewiger Verschmelzer | Verschmelze 5000 Runen erfolgreich. |
| `runefuse_10000` | Der Runen-Ursprung | Verschmelze 10000 Runen erfolgreich. |
| `runefusefail_1` | Erster Rückschlag | Erlebe 1 fehlgeschlagene Runen-Verschmelzung. |
| `runefusefail_5` | Pechvogel | Erlebe 5 fehlgeschlagene Runen-Verschmelzungen. |
| `runefusefail_15` | Explosionsgefahr | Erlebe 15 fehlgeschlagene Runen-Verschmelzungen. |
| `runefusefail_30` | Unverwüstlicher Optimist | Erlebe 30 fehlgeschlagene Runen-Verschmelzungen. |
| `runefusefail_50` | Schmelztiegel des Grauens | Erlebe 50 fehlgeschlagene Runen-Verschmelzungen. |
| `runefusefail_100` | Fluch des Schmelztiegels | Erlebe 100 fehlgeschlagene Runen-Verschmelzungen. |
| `runefusefail_250` | Wandelnde Katastrophe | Erlebe 250 fehlgeschlagene Runen-Verschmelzungen. |
| `runefusefail_500` | Meister des Missgeschicks | Erlebe 500 fehlgeschlagene Runen-Verschmelzungen. |
| `runefusefail_1000` | Der Verschmelzungs-Fluch | Erlebe 1000 fehlgeschlagene Runen-Verschmelzungen. |
| `runefusefail_2500` | Von den Runen verflucht | Erlebe 2500 fehlgeschlagene Runen-Verschmelzungen. |
| `runefusefail_5000` | Sisyphos des Schmelztiegels | Erlebe 5000 fehlgeschlagene Runen-Verschmelzungen. |
| `runeupgrade_1` | Erste Aufwertung | Werte Runen 1x erfolgreich auf. |
| `runeupgrade_10` | Runenschleifer | Werte Runen 10x erfolgreich auf. |
| `runeupgrade_25` | Veredelungskünstler | Werte Runen 25x erfolgreich auf. |
| `runeupgrade_50` | Runenoptimierer | Werte Runen 50x erfolgreich auf. |
| `runeupgrade_100` | Aufwertungsmeister | Werte Runen 100x erfolgreich auf. |
| `runeupgrade_200` | Runenperfektionist | Werte Runen 200x erfolgreich auf. |
| `runeupgrade_400` | Großmeister der Veredelung | Werte Runen 400x erfolgreich auf. |
| `runeupgrade_750` | Legende der Veredelung | Werte Runen 750x erfolgreich auf. |
| `runeupgrade_1500` | Veredelungstitan | Werte Runen 1500x erfolgreich auf. |
| `runeupgrade_3000` | Runenschleif-Gottheit | Werte Runen 3000x erfolgreich auf. |
| `runeupgrade_5000` | Ewiger Veredler | Werte Runen 5000x erfolgreich auf. |
| `runeupgrade_10000` | Der Aufwertungs-Ursprung | Werte Runen 10000x erfolgreich auf. |
| `runeupgradefail_1` | Gold verbrannt | Erlebe 1 fehlgeschlagene Runen-Aufwertung. |
| `runeupgradefail_5` | Teurer Fehlschlag | Erlebe 5 fehlgeschlagene Runen-Aufwertungen. |
| `runeupgradefail_15` | Risikofreudig | Erlebe 15 fehlgeschlagene Runen-Aufwertungen. |
| `runeupgradefail_30` | Nerven aus Stahl | Erlebe 30 fehlgeschlagene Runen-Aufwertungen. |
| `runeupgradefail_50` | Va-Banque-Spieler | Erlebe 50 fehlgeschlagene Runen-Aufwertungen. |
| `runeupgradefail_100` | Gold-Verbrenner | Erlebe 100 fehlgeschlagene Runen-Aufwertungen. |
| `runeupgradefail_250` | Bankrotteur | Erlebe 250 fehlgeschlagene Runen-Aufwertungen. |
| `runeupgradefail_500` | Meister des Ruins | Erlebe 500 fehlgeschlagene Runen-Aufwertungen. |
| `runeupgradefail_1000` | Der Aufwertungs-Fluch | Erlebe 1000 fehlgeschlagene Runen-Aufwertungen. |
| `runeupgradefail_2500` | Von Pech verfolgt | Erlebe 2500 fehlgeschlagene Runen-Aufwertungen. |
| `runeupgradefail_5000` | Sisyphos der Aufwertung | Erlebe 5000 fehlgeschlagene Runen-Aufwertungen. |

**Drachenzucht** (12)

| ID | Titel | Bedingung |
|---|---|---|
| `dragon_first_egg` | Das erste Ei | Finde dein erstes Drachenei. |
| `dragon_first_hatch` | Geschlüpft! | Brüte deinen ersten Drachen aus. |
| `dragon_hatch_5` | Drachenzüchter | Brüte 5 Drachen aus. |
| `dragon_hatch_20` | Drachenhort | Brüte 20 Drachen aus. |
| `dragon_first_adult` | Erwachsen geworden | Ziehe deinen ersten Drachen bis zur Erwachsenenform auf. |
| `dragon_adult_10` | Drachenmeister | Ziehe 10 erwachsene Drachen auf. |
| `dragon_species_5` | Vielfältige Zucht | Besitze Drachen von 5 unterschiedlichen Arten. |
| `dragon_species_all` | Herr über alle Arten | Besitze Drachen aller 17 Arten. |
| `dragon_legendary_first` | Legendäre Zucht | Besitze deinen ersten legendären Drachen. |
| `dragon_legendary_both` | Meister beider Legenden | Besitze sowohl einen Zerathor- als auch einen Yakshadrachen. |
| `dragon_companion_first` | Treuer Begleiter | Ruste deinen ersten Begleitdrachen aus. |
| `dragon_zucht_branch_maxed` | Zuchtmeister | Maximiere den kompletten Zucht-Skilltree-Zweig. |

**Weltboss** (7)

| ID | Titel | Bedingung |
|---|---|---|
| `raid_first_join` | Erster Raid | Nimm an deinem ersten Weltboss-Raid teil. |
| `raid_first_boss` | Erster Boss besiegt | Besiege deinen ersten Weltboss. |
| `raid_boss_10` | Bossbezwinger | Besiege 10 Weltbosse. |
| `raid_boss_100` | Legendärer Drachenjäger | Besiege 100 Weltbosse. |
| `raid_damage_1m` | Ein Millionen Schaden | Verursache insgesamt 1.000.000 Schaden in Weltboss-Raids. |
| `raid_mvp` | MVP | Sei der Spieler mit dem meisten Schaden in einem Raid. |
| `raid_flawless` | Ohne Niederlage gewonnen | Gewinne einen Raid, ohne dass die Stadt Schaden nimmt. |

**Arena** (5)

| ID | Titel | Bedingung |
|---|---|---|
| `arena_first_win` | Erster Arena-Sieg | Gewinne deinen ersten Arena-Kampf. |
| `arena_win_10` | Arena-Kämpfer | Gewinne 10 Arena-Kämpfe. |
| `arena_win_50` | Arena-Veteran | Gewinne 50 Arena-Kämpfe. |
| `arena_win_200` | Arena-Champion | Gewinne 200 Arena-Kämpfe. |
| `arena_rating_1500` | Aufstrebender Kämpfer | Erreiche ein Arena-Rating von 1500. |

**Gilde** (13)

| ID | Titel | Bedingung |
|---|---|---|
| `guild_member` | Gildenmitglied | Trete einer Gilde bei. |
| `guild_leader` | Anführer | Werde Anführer einer Gilde. |
| `guild_level_5` | Aufstrebende Gilde | Erreiche Gildenlevel 5. |
| `guild_level_10` | Etablierte Gilde | Erreiche Gildenlevel 10. |
| `guild_level_20` | Mächtige Gilde | Erreiche Gildenlevel 20. |
| `guild_level_40` | Legendäre Gilde | Erreiche Gildenlevel 40. |
| `guild_level_60` | Imperiale Gilde | Erreiche Gildenlevel 60. |
| `guild_level_80` | Unaufhaltsame Gilde | Erreiche Gildenlevel 80. |
| `guild_level_100` | Gilde der Ewigkeit | Erreiche Gildenlevel 100 (Maximalstufe). |
| `guild_xp_1m` | Großzügige Gilde | Deine Gilde hat insgesamt 1.000.000 Gold in die Kasse eingezahlt. |
| `guild_boss_first` | Erster Gildenboss | Besiege deinen ersten Gildenboss. |
| `guild_boss_10` | Gildenboss-Bezwinger | Besiege 10 Gildenbosse. |
| `guild_full_roster` | Volles Haus | Sei Mitglied einer Gilde mit 20 Mitgliedern. |

**Jake's Feldfahrt** (10)

| ID | Titel | Bedingung |
|---|---|---|
| `jakefeld_100` | Feld-Neuling | Erreiche 100 Punkte in einer Runde von Jake's Feldfahrt. |
| `jakefeld_200` | Ernte-Helfer | Erreiche 200 Punkte in einer Runde von Jake's Feldfahrt. |
| `jakefeld_300` | Traktorfahrer | Erreiche 300 Punkte in einer Runde von Jake's Feldfahrt. |
| `jakefeld_500` | Ernte-Profi | Erreiche 500 Punkte in einer Runde von Jake's Feldfahrt. |
| `jakefeld_750` | Feld-Meister | Erreiche 750 Punkte in einer Runde von Jake's Feldfahrt. |
| `jakefeld_1000` | Scheunen-Champion | Erreiche 1.000 Punkte in einer Runde von Jake's Feldfahrt. |
| `jakefeld_1500` | Ernte-Baron | Erreiche 1.500 Punkte in einer Runde von Jake's Feldfahrt. |
| `jakefeld_2000` | Traktor-Legende | Erreiche 2.000 Punkte in einer Runde von Jake's Feldfahrt. |
| `jakefeld_3000` | Feld-Gott | Erreiche 3.000 Punkte in einer Runde von Jake's Feldfahrt. |
| `jakefeld_5000` | Jakes Rekordhalter | Erreiche 5.000 Punkte in einer Runde von Jake's Feldfahrt. |

## Anhang A2 – Website-Titel (112 eigene; die Website-Titelliste enthält zusätzlich alle 175 Idle-Dorf-Titel aus Anhang A3)

Freischaltung: `unlockAt` = Anzahl freigeschalteter Erfolge, `unlockAchievement` = bestimmter Erfolg. Website-Titel sind reine Anzeige neben dem Namen, sofern nicht unten ein Bonus steht.
| ID | Name | Freischaltung | Bonus |
|---|---|---|---|
| `none` | Kein Titel | immer | – |
| `neuling` | Neuling | 5 Erfolge | – |
| `kartensammler` | Kartensammler | Erfolg `card_50` | – |
| `wunschdenker` | Wunschdenker | Erfolg `wish_50` | – |
| `nachtschwaermer` | Nachtschwärmer | Erfolg `night_owl` | – |
| `ostereier` | Der EasterEggHunter | Erfolg `egg_all` | – |
| `habkeingeld` | Hab kein Geld | Erfolg `egg_adfree` | – |
| `liberjaeger` | Liber-Jäger | Erfolg `egg_derliber` | – |
| `realitaetsverweigerer` | Realitätsverweigerer | Erfolg `egg_positivmodus` | – |
| `legende` | BKMP-Legende | 60 Erfolge | – |
| `unaufhaltsam` | Unaufhaltsam | 100 Erfolge | – |
| `allmaechtig` | Der/Die Allmächtige | 120 Erfolge | – |
| `bonker` | Der Bonker | Erfolg `bonk_50` | – |
| `boxchamp` | Boxchampion | Erfolg `bonk_2500` | – |
| `faustkoenig` | Faustkönig | Erfolg `bonk_50000` | – |
| `bonkgott` | Bonk-Gott | Erfolg `bonk_500000` | – |
| `ewigerbonker` | Der ewige Bonker | Erfolg `bonk_1000000` | – |
| `stammgast` | Stammgast | Erfolg `time_10` | – |
| `veteran` | Veteran | Erfolg `days_30` | – |
| `bkmp_veteran` | BKMP Veteran | Erfolg `days_90` | – |
| `chrono_legende` | Chrono-Legende | 90 Erfolge | – |
| `titeljaeger` | Titeljäger | Erfolg `meta_40` | – |
| `achievement_hunter` | Achievement Hunter | Erfolg `meta_60` | – |
| `achievement_meister` | Achievement Meister | Erfolg `meta_100` | – |
| `sammler` | Sammler | Erfolg `card_25` | – |
| `supersammler` | Supersammler | Erfolg `card_100` | – |
| `plushie_sammler` | Plüshie Sammler | ? | – |
| `plushie_koenig` | Plüshie König | ? | – |
| `plushie_gott` | Plüshie Gott | Erfolg `plushie_all` | – |
| `schlauer_finder` | SchlauerFinder | Erfolg `kora_finder` | – |
| `fanboy` | Fanboy | ? | – |
| `superfan` | Superfan | ? | – |
| `maximaler_fanboy` | Maximaler Fanboy | ? | – |
| `creator_supporter` | Creator Supporter | ? | – |
| `creator_freund` | Creator Freund | ? | – |
| `codejaeger` | Codejäger | ? | – |
| `code_ninja` | Code Ninja | ? | – |
| `code_meister` | Code Meister | ? | – |
| `code_suechtig` | Code Süchtig | ? | – |
| `lucky_one` | Lucky One | ? | – |
| `gluecksritter` | Glücksritter | ? | – |
| `der_erste` | Der Erste | ? | – |
| `der_schnellste` | Der Schnellste | ? | – |
| `pixelmeister` | Pixelmeister | Erfolg `card_10` | – |
| `pixelmagier` | Pixelmagier | Erfolg `card_60` | – |
| `kartenfreund` | Kartenfreund | Erfolg `card_3` | – |
| `kartenjaeger` | Kartenjäger | Erfolg `card_40` | – |
| `mapart_genie` | MapArt Genie | Erfolg `wish_25` | – |
| `plot_koenig` | Plot König | Erfolg `wish_100` | – |
| `glow_traeger` | Glow Träger | 25 Erfolge | – |
| `leuchtende_legende` | Leuchtende Legende | 60 Erfolge | – |
| `der_geduldige` | Der Geduldige | Erfolg `egg_idle` | – |
| `der_verlorene` | Der Verlorene | Erfolg `egg_jannik` | – |
| `der_zufaellige` | Der Zufällige | Erfolg `egg_rainbow` | – |
| `schnee_fluesterer` | Schnee-Flüsterer | Erfolg `egg_penguin` | – |
| `boss_wecker` | Boss-Wecker | Erfolg `egg_zerathor` | – |
| `maus_schuettler` | Maus-Schüttler | Erfolg `egg_mouseshake` | – |
| `rechtsklick_entdecker` | Rechtsklick-Entdecker | Erfolg `egg_rightclick` | – |
| `dungeon_meister` | Dungeon-Meister | Erfolg `idle_dungeon_cleared` | – |
| `wahnsinniger_sammler` | Der Wahnsinnige Sammler | 100 Erfolge | – |
| `collector_plus` | Collector++ | Erfolg `card_200` | – |
| `collector_ultra` | Collector Ultra | Erfolg `card_300` | – |
| `collector_supreme` | Collector Supreme | Erfolg `card_500` | – |
| `bkmp_ultra` | BKMP Ultra | 110 Erfolge | – |
| `bkmp_elite` | BKMP Elite | 125 Erfolge | – |
| `geheimcode_finder` | Geheimcode Finder | ? | – |
| `kuschelkoenig` | Kuschelkönig | Erfolg `plushie_all` | – |
| `kuschelmeister` | Kuschelmeister | ? | – |
| `goldjaeger` | Goldjäger | ? | – |
| `lobender` | Der Lobende | Erfolg `feedback_lob_1` | – |
| `anerkennend` | Anerkennend | Erfolg `feedback_lob_3` | – |
| `wertschaetzer` | Wertschätzer | Erfolg `feedback_lob_5` | – |
| `lob_ikone` | Lob-Ikone | Erfolg `feedback_lob_10` | – |
| `legende_lob` | Legende des Lobes | Erfolg `feedback_lob_20` | – |
| `kritischer` | Der Kritische | Erfolg `feedback_kritik_1` | – |
| `scharfzuengig` | Scharfzüngig | Erfolg `feedback_kritik_3` | – |
| `qualitaetspruefer` | Qualitätsprüfer | Erfolg `feedback_kritik_5` | – |
| `kritik_experte` | Kritik-Experte | Erfolg `feedback_kritik_10` | – |
| `meister_kritik` | Meister der Kritik | Erfolg `feedback_kritik_20` | – |
| `ideenreicher` | Der Ideenreiche | Erfolg `feedback_idee_1` | – |
| `vordenker` | Vordenker | Erfolg `feedback_idee_3` | – |
| `konzeptkuenstler` | Konzeptkünstler | Erfolg `feedback_idee_5` | – |
| `ideenschmied` | Ideenschmied | Erfolg `feedback_idee_10` | – |
| `visionaer` | Visionär | Erfolg `feedback_idee_20` | – |
| `mitteilsamer` | Der Mitteilsame | Erfolg `feedback_sonstiges_1` | – |
| `vielschreiber` | Vielschreiber | Erfolg `feedback_sonstiges_3` | – |
| `stammkommentator` | Stammkommentator | Erfolg `feedback_sonstiges_5` | – |
| `wortgewaltig` | Wortgewaltig | Erfolg `feedback_sonstiges_10` | – |
| `feedback_legende` | Feedback-Legende | Erfolg `feedback_sonstiges_20` | – |
| `verbunden` | Verbunden | Erfolg `mod_linked` | – |
| `mod_pionier` | Mod-Pionier | Erfolg `modcard_1` | – |
| `kartenscout` | Kartenscout | Erfolg `modcard_3` | – |
| `kartograf` | Kartograf | Erfolg `modcard_10` | – |
| `mod_archivar` | Mod-Archivar | Erfolg `modcard_25` | – |
| `weltvermesser` | Weltvermesser | Erfolg `modcard_50` | – |
| `ladenbesitzer` | Ladenbesitzer | Erfolg `partnershop_own` | – |
| `warp_reisender` | Warp-Reisender | Erfolg `egg_swbk` | – |
| `plushie_fanboy_yaksha` | Maximaler Yaksha Fan | Erfolg `plushie_yaksha` | – |
| `plushie_fanboy_darkorius` | Maximaler Darkorius Fan | Erfolg `plushie_darkorius` | – |
| `plushie_fanboy_lukas` | Maximaler Lukas Fan | Erfolg `plushie_lukas` | – |
| `plushie_fanboy_obsi` | Maximaler Obsi Fan | Erfolg `plushie_obsi` | – |
| `plushie_fanboy_roggberd` | Maximaler Roggberd Fan | Erfolg `plushie_roggberd` | – |
| `jaketitle_100` | Feld-Neuling | Erfolg `jakefeld_100` | – |
| `jaketitle_200` | Ernte-Helfer | Erfolg `jakefeld_200` | – |
| `jaketitle_300` | Traktorfahrer | Erfolg `jakefeld_300` | – |
| `jaketitle_500` | Ernte-Profi | Erfolg `jakefeld_500` | – |
| `jaketitle_750` | Feld-Meister | Erfolg `jakefeld_750` | – |
| `jaketitle_1000` | Scheunen-Champion | Erfolg `jakefeld_1000` | – |
| `jaketitle_1500` | Ernte-Baron | Erfolg `jakefeld_1500` | – |
| `jaketitle_2000` | Traktor-Legende | Erfolg `jakefeld_2000` | – |
| `jaketitle_3000` | Feld-Gott | Erfolg `jakefeld_3000` | – |
| `jaketitle_5000` | Jakes Rekordhalter | Erfolg `jakefeld_5000` | – |

## Anhang A3 – Idle-Dorf-Titel (175, davon 150 mit Dauerbonus)

Alle freigeschalteten Titel-Boni addieren sich (Sammlungs-Prinzip), sie fließen in die gedeckelten Bonus-Töpfe aus Kapitel 3.1.
| ID | Name | Bedingung | Dauerbonus |
|---|---|---|---|
| `idletitle_dragon_1` | Erster Drache | Für 1 besiegte Drachen im Idle Dorf. | +1% Gold |
| `idletitle_dragon_5` | Drachentöter | Für 5 besiegte Drachen im Idle Dorf. | +2% Gold |
| `idletitle_dragon_10` | Drachenschreck | Für 10 besiegte Drachen im Idle Dorf. | +3% Gold |
| `idletitle_dragon_25` | Drachenjäger | Für 25 besiegte Drachen im Idle Dorf. | +4% Gold |
| `idletitle_dragon_50` | Drachenbezwinger | Für 50 besiegte Drachen im Idle Dorf. | +5% Gold |
| `idletitle_dragon_100` | Hundert Drachen | Für 100 besiegte Drachen im Idle Dorf. | +6% Gold |
| `idletitle_dragon_200` | Zweihundert Drachen | Für 200 besiegte Drachen im Idle Dorf. | +7% Gold |
| `idletitle_dragon_350` | Drachenschlächter | Für 350 besiegte Drachen im Idle Dorf. | +8% Gold |
| `idletitle_dragon_500` | Fünfhundert Drachen | Für 500 besiegte Drachen im Idle Dorf. | +9% Gold |
| `idletitle_dragon_750` | Dreiviertel-Tausend | Für 750 besiegte Drachen im Idle Dorf. | +10% Gold |
| `idletitle_dragon_1000` | Drachenlegende | Für 1000 besiegte Drachen im Idle Dorf. | +11% Gold |
| `idletitle_dragon_2000` | Zweitausend Drachen | Für 2000 besiegte Drachen im Idle Dorf. | +12% Gold |
| `idletitle_dragon_5000` | Der Drachenkönig | Für 5000 besiegte Drachen im Idle Dorf. | +13% Gold |
| `idletitle_level_5` | Dorfgründer | Erreiche Dorf-Level 5. | +1% EP |
| `idletitle_level_10` | Aufstrebendes Dorf | Erreiche Dorf-Level 10. | +2% EP |
| `idletitle_level_20` | Wachsendes Reich | Erreiche Dorf-Level 20. | +3% EP |
| `idletitle_level_30` | Starkes Dorf | Erreiche Dorf-Level 30. | +4% EP |
| `idletitle_level_40` | Blühendes Reich | Erreiche Dorf-Level 40. | +5% EP |
| `idletitle_level_50` | Mächtiges Dorf | Erreiche Dorf-Level 50. | +6% EP |
| `idletitle_level_60` | Festung | Erreiche Dorf-Level 60. | +7% EP |
| `idletitle_level_75` | Bollwerk | Erreiche Dorf-Level 75. | +8% EP |
| `idletitle_level_100` | Legendäres Dorf | Erreiche Dorf-Level 100. | +9% EP |
| `idletitle_level_150` | Unbezwingbares Reich | Erreiche Dorf-Level 150. | +10% EP |
| `idletitle_level_200` | Ewiges Dorf | Erreiche Dorf-Level 200. | +11% EP |
| `idletitle_level_300` | Mythisches Reich | Erreiche Dorf-Level 300. | +12% EP |
| `idletitle_gold_1000` | Erste Reserven | Sammle 1000 Gold im Idle Dorf. | +1% Beute |
| `idletitle_gold_10000` | Ordentliche Kasse | Sammle 10000 Gold im Idle Dorf. | +2% Beute |
| `idletitle_gold_50000` | Wohlhabend | Sammle 50000 Gold im Idle Dorf. | +3% Beute |
| `idletitle_gold_100000` | Reicher Händler | Sammle 100000 Gold im Idle Dorf. | +4% Beute |
| `idletitle_gold_500000` | Kleines Vermögen | Sammle 500000 Gold im Idle Dorf. | +5% Beute |
| `idletitle_gold_1000000` | Millionär | Sammle 1000000 Gold im Idle Dorf. | +6% Beute |
| `idletitle_gold_5000000` | Großes Vermögen | Sammle 5000000 Gold im Idle Dorf. | +7% Beute |
| `idletitle_gold_10000000` | Zehnfacher Millionär | Sammle 10000000 Gold im Idle Dorf. | +8% Beute |
| `idletitle_gold_50000000` | Schatzmeister | Sammle 50000000 Gold im Idle Dorf. | +9% Beute |
| `idletitle_gold_100000000` | Goldberg | Sammle 100000000 Gold im Idle Dorf. | +10% Beute |
| `idletitle_gold_500000000` | Unermesslicher Reichtum | Sammle 500000000 Gold im Idle Dorf. | +11% Beute |
| `idletitle_gold_1000000000` | Drachenschatz-Herrscher | Sammle 1000000000 Gold im Idle Dorf. | +12% Beute |
| `idletitle_skill_5` | Erste Talente | Investiere 5 Skillpunkte. | +1 Angriff (fest) |
| `idletitle_skill_15` | Talentiert | Investiere 15 Skillpunkte. | +2 Angriff (fest) |
| `idletitle_skill_30` | Vielseitig geschult | Investiere 30 Skillpunkte. | +3 Angriff (fest) |
| `idletitle_skill_50` | Meister der Künste | Investiere 50 Skillpunkte. | +4 Angriff (fest) |
| `idletitle_skill_75` | Großmeister | Investiere 75 Skillpunkte. | +5 Angriff (fest) |
| `idletitle_skill_100` | Skilltree-Experte | Investiere 100 Skillpunkte. | +6 Angriff (fest) |
| `idletitle_skill_150` | Vollendete Kunst | Investiere 150 Skillpunkte. | +7 Angriff (fest) |
| `idletitle_skill_200` | Meister aller Zweige | Investiere 200 Skillpunkte. | +8 Angriff (fest) |
| `idletitle_prestige_1` | Prestige Jäger | Erreiche Prestige-Stufe 1 im Idle Dorf. | +1% Angriff |
| `idletitle_prestige_2` | Prestige Krieger | Erreiche Prestige-Stufe 2 im Idle Dorf. | +2% Angriff |
| `idletitle_prestige_3` | Prestige Veteran | Erreiche Prestige-Stufe 3 im Idle Dorf. | +3% Angriff |
| `idletitle_prestige_4` | Prestige Meister | Erreiche Prestige-Stufe 4 im Idle Dorf. | +4% Angriff |
| `idletitle_prestige_5` | Prestige Champion | Erreiche Prestige-Stufe 5 im Idle Dorf. | +5% Angriff |
| `idletitle_prestige_6` | Prestige Legende | Erreiche Prestige-Stufe 6 im Idle Dorf. | +6% Angriff |
| `idletitle_prestige_7` | Prestige Titan | Erreiche Prestige-Stufe 7 im Idle Dorf. | +7% Angriff |
| `idletitle_prestige_8` | Prestige Halbgott | Erreiche Prestige-Stufe 8 im Idle Dorf. | +8% Angriff |
| `idletitle_prestige_9` | Prestige Gott | Erreiche Prestige-Stufe 9 im Idle Dorf. | +9% Angriff |
| `idletitle_prestige_10` | Was ist Prestige? | Erreiche Prestige-Stufe 10 im Idle Dorf. | +10% Angriff |
| `idletitle_prestige_12` | Portal-Wächter | Erreiche Prestige-Stufe 12 im Idle Dorf. | +11% Angriff |
| `idletitle_prestige_14` | Portal-Herrscher | Erreiche Prestige-Stufe 14 im Idle Dorf. | +12% Angriff |
| `idletitle_prestige_16` | Zyklus-Wanderer | Erreiche Prestige-Stufe 16 im Idle Dorf. | +13% Angriff |
| `idletitle_prestige_18` | Ewiger Wanderer | Erreiche Prestige-Stufe 18 im Idle Dorf. | +14% Angriff |
| `idletitle_prestige_20` | Dimensionsreisender | Erreiche Prestige-Stufe 20 im Idle Dorf. | +15% Angriff |
| `idletitle_prestige_23` | Zeitloser | Erreiche Prestige-Stufe 23 im Idle Dorf. | +16% Angriff |
| `idletitle_prestige_26` | Unsterblicher | Erreiche Prestige-Stufe 26 im Idle Dorf. | +17% Angriff |
| `idletitle_prestige_30` | Kosmischer Wanderer | Erreiche Prestige-Stufe 30 im Idle Dorf. | +18% Angriff |
| `idletitle_prestige_35` | Universums-Architekt | Erreiche Prestige-Stufe 35 im Idle Dorf. | +19% Angriff |
| `idletitle_prestige_40` | Multiversum-Meister | Erreiche Prestige-Stufe 40 im Idle Dorf. | +20% Angriff |
| `idletitle_prestige_45` | Jenseits der Sterne | Erreiche Prestige-Stufe 45 im Idle Dorf. | +21% Angriff |
| `idletitle_prestige_50` | Schöpfer neuer Welten | Erreiche Prestige-Stufe 50 im Idle Dorf. | +22% Angriff |
| `idletitle_prestige_60` | Der Ewige Kreislauf | Erreiche Prestige-Stufe 60 im Idle Dorf. | +23% Angriff |
| `idletitle_prestige_75` | Wächter der Unendlichkeit | Erreiche Prestige-Stufe 75 im Idle Dorf. | +24% Angriff |
| `idletitle_prestige_100` | Der Unendliche | Erreiche Prestige-Stufe 100 im Idle Dorf. | +25% Angriff |
| `idletitle_turm_10` | Turmkletterer | Erreiche Stufe 10 im Endlosen Turm. | +1% Leben |
| `idletitle_turm_20` | Turmläufer | Erreiche Stufe 20 im Endlosen Turm. | +2% Leben |
| `idletitle_turm_35` | Turmbezwinger | Erreiche Stufe 35 im Endlosen Turm. | +3% Leben |
| `idletitle_turm_50` | Turmveteran | Erreiche Stufe 50 im Endlosen Turm. | +4% Leben |
| `idletitle_turm_75` | Turmmeister | Erreiche Stufe 75 im Endlosen Turm. | +5% Leben |
| `idletitle_turm_100` | Turmchampion | Erreiche Stufe 100 im Endlosen Turm. | +6% Leben |
| `idletitle_turm_150` | Turmlegende | Erreiche Stufe 150 im Endlosen Turm. | +7% Leben |
| `idletitle_turm_200` | Turmtitan | Erreiche Stufe 200 im Endlosen Turm. | +8% Leben |
| `idletitle_turm_300` | Turmgott | Erreiche Stufe 300 im Endlosen Turm. | +9% Leben |
| `idletitle_turm_500` | Der Unaufhaltsame | Erreiche Stufe 500 im Endlosen Turm. | +10% Leben |
| `runetitle_fuse_1` | Erste Verschmelzung | Verschmelze 1 Runen erfolgreich. | +1% Beute |
| `runetitle_fuse_5` | Runenschmelzer | Verschmelze 5 Runen erfolgreich. | +2% Beute |
| `runetitle_fuse_15` | Fusionsmeister | Verschmelze 15 Runen erfolgreich. | +3% Beute |
| `runetitle_fuse_30` | Runenalchemist | Verschmelze 30 Runen erfolgreich. | +4% Beute |
| `runetitle_fuse_60` | Schmelztiegel-Meister | Verschmelze 60 Runen erfolgreich. | +5% Beute |
| `runetitle_fuse_100` | Runenveredler | Verschmelze 100 Runen erfolgreich. | +6% Beute |
| `runetitle_fuse_200` | Großmeister der Fusion | Verschmelze 200 Runen erfolgreich. | +7% Beute |
| `runetitle_fuse_350` | Legende der Verschmelzung | Verschmelze 350 Runen erfolgreich. | +8% Beute |
| `runetitle_fuse_500` | Fusionsdämon | Verschmelze 500 Runen erfolgreich. | +9% Beute |
| `runetitle_fuse_750` | Runenschmiede-Titan | Verschmelze 750 Runen erfolgreich. | +10% Beute |
| `runetitle_fuse_1000` | Tausendfache Verschmelzung | Verschmelze 1000 Runen erfolgreich. | +11% Beute |
| `runetitle_fuse_2500` | Schmelztiegel-Gottheit | Verschmelze 2500 Runen erfolgreich. | +12% Beute |
| `runetitle_fuse_5000` | Ewiger Verschmelzer | Verschmelze 5000 Runen erfolgreich. | +13% Beute |
| `runetitle_fuse_10000` | Der Runen-Ursprung | Verschmelze 10000 Runen erfolgreich. | +14% Beute |
| `runetitle_fusefail_1` | Erster Rückschlag | Erlebe 1 fehlgeschlagene Runen-Verschmelzungen. | – |
| `runetitle_fusefail_5` | Pechvogel | Erlebe 5 fehlgeschlagene Runen-Verschmelzungen. | – |
| `runetitle_fusefail_15` | Explosionsgefahr | Erlebe 15 fehlgeschlagene Runen-Verschmelzungen. | – |
| `runetitle_fusefail_30` | Unverwüstlicher Optimist | Erlebe 30 fehlgeschlagene Runen-Verschmelzungen. | – |
| `runetitle_fusefail_50` | Schmelztiegel des Grauens | Erlebe 50 fehlgeschlagene Runen-Verschmelzungen. | – |
| `runetitle_fusefail_100` | Fluch des Schmelztiegels | Erlebe 100 fehlgeschlagene Runen-Verschmelzungen. | – |
| `runetitle_fusefail_250` | Wandelnde Katastrophe | Erlebe 250 fehlgeschlagene Runen-Verschmelzungen. | – |
| `runetitle_fusefail_500` | Meister des Missgeschicks | Erlebe 500 fehlgeschlagene Runen-Verschmelzungen. | – |
| `runetitle_fusefail_1000` | Der Verschmelzungs-Fluch | Erlebe 1000 fehlgeschlagene Runen-Verschmelzungen. | – |
| `runetitle_fusefail_2500` | Von den Runen verflucht | Erlebe 2500 fehlgeschlagene Runen-Verschmelzungen. | – |
| `runetitle_fusefail_5000` | Sisyphos des Schmelztiegels | Erlebe 5000 fehlgeschlagene Runen-Verschmelzungen. | – |
| `runetitle_upgrade_1` | Erste Aufwertung | Werte Runen 1-mal erfolgreich auf. | +1% Angriff |
| `runetitle_upgrade_10` | Runenschleifer | Werte Runen 10-mal erfolgreich auf. | +2% Angriff |
| `runetitle_upgrade_25` | Veredelungskünstler | Werte Runen 25-mal erfolgreich auf. | +3% Angriff |
| `runetitle_upgrade_50` | Runenoptimierer | Werte Runen 50-mal erfolgreich auf. | +4% Angriff |
| `runetitle_upgrade_100` | Aufwertungsmeister | Werte Runen 100-mal erfolgreich auf. | +5% Angriff |
| `runetitle_upgrade_200` | Runenperfektionist | Werte Runen 200-mal erfolgreich auf. | +6% Angriff |
| `runetitle_upgrade_400` | Großmeister der Veredelung | Werte Runen 400-mal erfolgreich auf. | +7% Angriff |
| `runetitle_upgrade_750` | Legende der Veredelung | Werte Runen 750-mal erfolgreich auf. | +8% Angriff |
| `runetitle_upgrade_1500` | Veredelungstitan | Werte Runen 1500-mal erfolgreich auf. | +9% Angriff |
| `runetitle_upgrade_3000` | Runenschleif-Gottheit | Werte Runen 3000-mal erfolgreich auf. | +10% Angriff |
| `runetitle_upgrade_5000` | Ewiger Veredler | Werte Runen 5000-mal erfolgreich auf. | +11% Angriff |
| `runetitle_upgrade_10000` | Der Aufwertungs-Ursprung | Werte Runen 10000-mal erfolgreich auf. | +12% Angriff |
| `runetitle_upgradefail_1` | Gold verbrannt | Erlebe 1 fehlgeschlagene Runen-Aufwertungen. | – |
| `runetitle_upgradefail_5` | Teurer Fehlschlag | Erlebe 5 fehlgeschlagene Runen-Aufwertungen. | – |
| `runetitle_upgradefail_15` | Risikofreudig | Erlebe 15 fehlgeschlagene Runen-Aufwertungen. | – |
| `runetitle_upgradefail_30` | Nerven aus Stahl | Erlebe 30 fehlgeschlagene Runen-Aufwertungen. | – |
| `runetitle_upgradefail_50` | Va-Banque-Spieler | Erlebe 50 fehlgeschlagene Runen-Aufwertungen. | – |
| `runetitle_upgradefail_100` | Gold-Verbrenner | Erlebe 100 fehlgeschlagene Runen-Aufwertungen. | – |
| `runetitle_upgradefail_250` | Bankrotteur | Erlebe 250 fehlgeschlagene Runen-Aufwertungen. | – |
| `runetitle_upgradefail_500` | Meister des Ruins | Erlebe 500 fehlgeschlagene Runen-Aufwertungen. | – |
| `runetitle_upgradefail_1000` | Der Aufwertungs-Fluch | Erlebe 1000 fehlgeschlagene Runen-Aufwertungen. | – |
| `runetitle_upgradefail_2500` | Von Pech verfolgt | Erlebe 2500 fehlgeschlagene Runen-Aufwertungen. | – |
| `runetitle_upgradefail_5000` | Sisyphos der Aufwertung | Erlebe 5000 fehlgeschlagene Runen-Aufwertungen. | – |
| `runetitle_equiprarity_gray` | Purist | Alle 6 Runen-Plätze mit Gewöhnlich-Runen ausgerüstet. | +1 Krit-Chance (Punkte) |
| `runetitle_equiprarity_green` | Grüner Daumen | Alle 6 Runen-Plätze mit Ungewöhnlich-Runen ausgerüstet. | +2 Krit-Chance (Punkte) |
| `runetitle_equiprarity_blue` | Blaues Blut | Alle 6 Runen-Plätze mit Selten-Runen ausgerüstet. | +3 Krit-Chance (Punkte) |
| `runetitle_equiprarity_purple` | Violette Vorherrschaft | Alle 6 Runen-Plätze mit Episch-Runen ausgerüstet. | +4 Krit-Chance (Punkte) |
| `runetitle_equiprarity_gold` | Runengott | Alle 6 Runen-Plätze mit Legendär-Runen ausgerüstet. | +5 Krit-Chance (Punkte) |
| `runetitle_equiplevel_3` | Frisch geschliffen | Alle 6 ausgerüsteten Runen auf mindestens +3. | +1% Krit-Schaden |
| `runetitle_equiplevel_6` | Feingeschliffen | Alle 6 ausgerüsteten Runen auf mindestens +6. | +2% Krit-Schaden |
| `runetitle_equiplevel_9` | Meisterlich veredelt | Alle 6 ausgerüsteten Runen auf mindestens +9. | +3% Krit-Schaden |
| `runetitle_equiplevel_12` | Nahezu perfekt | Alle 6 ausgerüsteten Runen auf mindestens +12. | +4% Krit-Schaden |
| `runetitle_equiplevel_15` | Runen-Perfektion | Alle 6 ausgerüsteten Runen auf mindestens +15. | +5% Krit-Schaden |
| `idletitle_founder` | Dorfgründer | Das Idle Dorf gegründet. | – |
| `idletitle_boss1` | Bosskämpfer | Besiegt den ersten Boss. | +1 Krit-Chance (Punkte) |
| `idletitle_boss10` | Bossjäger | Besiegt 10 Bosse. | +2 Krit-Chance (Punkte) |
| `idletitle_boss50` | Boss-Vernichter | Besiegt 50 Bosse. | +3 Krit-Chance (Punkte) |
| `idletitle_branch1` | Spezialist | Ein Skilltree-Zweig maximiert. | +2 Verteidigung (fest) |
| `idletitle_branch3` | Vielseitiger Anführer | Drei Skilltree-Zweige maximiert. | +5 Verteidigung (fest) |
| `idletitle_branchall` | Skilltree-Meister | Alle Skilltree-Zweige maximiert. | +20 Leben (fest) |
| `idletitle_shenloss` | DragonBall Herrscher | Shenloss im Kampf besiegt. | – |
| `idletitle_liber` | Du hast ihn besiegt. | Den Ganz Liber Drache im Kampf besiegt. | – |
| `idletitle_guild_member` | Gildenmitglied | Einer Gilde beigetreten. | +2 Verteidigung (fest) |
| `idletitle_guild_leader` | Gildenanführer | Anführer einer Gilde. | +3% Angriff |
| `idletitle_guild_level10` | Etablierte Gilde | Gildenlevel 10 erreicht. | +3% Gold |
| `idletitle_guild_level20` | Gildenlegende | Gildenlevel 20 erreicht. | +6% Gold |
| `idletitle_guild_level40` | Legendäre Gilde | Gildenlevel 40 erreicht. | +9% Gold |
| `idletitle_guild_level60` | Imperiale Gilde | Gildenlevel 60 erreicht. | +12% Gold |
| `idletitle_guild_level80` | Unaufhaltsame Gilde | Gildenlevel 80 erreicht. | +15% Gold |
| `idletitle_guild_level100` | Gilde der Ewigkeit | Gildenlevel 100 (Maximalstufe) erreicht. | +20% Gold |
| `idletitle_guild_boss10` | Gildenboss-Bezwinger | 10 Gildenbosse besiegt. | +4% Bossschaden |
| `idletitle_arena_win10` | Arena-Kämpfer | 10 Arena-Kämpfe gewonnen. | +1 Krit-Chance (Punkte) |
| `idletitle_arena_win50` | Arena-Veteran | 50 Arena-Kämpfe gewonnen. | +2 Krit-Chance (Punkte) |
| `idletitle_arena_win200` | Arena-Champion | 200 Arena-Kämpfe gewonnen. | +8% Krit-Schaden |
| `idletitle_arena_rating1500` | Aufstrebender Kämpfer | Arena-Rating 1500 erreicht. | +3 Angriff (fest) |
| `idletitle_raid_boss10` | Bossbezwinger | 10 Weltbosse besiegt. | +15 Leben (fest) |
| `idletitle_raid_boss100` | Legendärer Drachenjäger | 100 Weltbosse besiegt. | +8% Bossschaden |
| `idletitle_raid_mvp` | Raid-MVP | Bester Schadensausteiler in einem Weltboss-Raid. | +4% Krit-Schaden |
| `idletitle_dragon_hatch1` | Drachenzüchter | Deinen ersten Drachen ausgebrütet. | +5 Leben (fest) |
| `idletitle_dragon_adult1` | Drachenreiter | Deinen ersten Drachen zur Erwachsenenform aufgezogen. | +4% Angriff |
| `idletitle_dragon_species5` | Vielfältiger Züchter | Drachen von 5 verschiedenen Arten besessen. | +4% Gold |
| `idletitle_dragon_speciesall` | Herr aller Drachenarten | Drachen aller 17 Arten besessen. | +10% EP |
| `idletitle_dragon_legendary` | Legendärer Züchter | Einen legendären Drachen besessen. | +10% Krit-Schaden |
| `idletitle_streak7` | Wochentreue | 7 Tage in Folge eingeloggt. | +3% EP |
| `idletitle_streak30` | Der Unermüdliche | 30 Tage in Folge eingeloggt. | +8% EP |
| `idletitle_chronist` | Chronist | 100 Aufträge aus der Chronik erfüllt. | +5% EP |
| `idletitle_wochenwerk` | Unermüdlicher Planer | 10 Wochentruhen geöffnet. | +5% Gold |
| `idletitle_ereignisjaeger` | Ereignisjäger | 100 Weltereignisse erlebt. | +5% Beute |
| `idletitle_bestiarium` | Meister des Bestiariums | 30 Stufen im Drachen-Bestiarium erreicht. | +5% Angriff |
| `idletitle_zuchtmeister` | Zuchtmeister | Den kompletten Zucht-Skilltree-Zweig maximiert. | +10% Gold |

## Anhang A4 – Website-Namensrahmen / Kosmetik (55)

| ID | Name | Freischaltung | Seltenheit |
|---|---|---|---|
| `default` | Automatisch | 0 Erfolge | – |
| `shadow` | Schatten | 5 Erfolge | – |
| `gold` | Gold-Glanz | 8 Erfolge | – |
| `ice` | Eis-Blau | 15 Erfolge | – |
| `glow` | Gold-Glühen | 25 Erfolge | – |
| `matrix` | Matrix-Grün | 40 Erfolge | – |
| `fire` | Feuer-Rahmen | Easter Egg `drache` | – |
| `dollar_prefix` | Geld-Rahmen | Easter Egg `adfree` | – |
| `aurora` | Aurora | 60 Erfolge | – |
| `royal` | Königlich | 100 Erfolge | – |
| `rainbow` | Regenbogen | Easter Egg `rainbow` | – |
| `bonk_bronze` | Bonk-Bronze | Erfolg `bonk_25` | – |
| `bonk_silver` | Bonk-Silber | Erfolg `bonk_500` | – |
| `bonk_gold` | Bonk-Gold | Erfolg `bonk_10000` | – |
| `bonk_inferno` | Bonk-Inferno | Erfolg `bonk_100000` | – |
| `bonk_legend` | Bonk-Legende | Erfolg `bonk_1000000` | – |
| `herzschlag` | Herzschlag | 12 Erfolge | – |
| `gruenrot` | Grün-Rot-Verlauf | 20 Erfolge | – |
| `toxic` | Toxic-Grün | 35 Erfolge | – |
| `sonnenuntergang` | Sonnenuntergang | 50 Erfolge | – |
| `neonpink` | Neon-Pink | 70 Erfolge | – |
| `galaxy` | Galaxy | 80 Erfolge | – |
| `mitternacht` | Mitternacht | 90 Erfolge | – |
| `redstone` | Redstone-Signal | Erfolg `mod_linked` | – |
| `kartograf` | Kartografen-Tinte | Erfolg `modcard_1` | – |
| `smaragd_haendler` | Smaragd-Händler | Erfolg `partnershop_own` | – |
| `netherportal` | Nether-Portal | Easter Egg `swbk` | – |
| `rotgruen` | Rot → Grün | ? | Selten |
| `goldweiss` | Gold → Weiß | ? | Selten |
| `lilapink` | Lila → Pink | ? | Episch |
| `tuerkisblau` | Türkis → Blau | ? | Episch |
| `orangerot` | Orange → Rot | ? | Episch |
| `regenbogen_idle` | Regenbogen (Dorf) | ? | Legendär |
| `amethyst` | Amethyst | ? | Episch |
| `smaragd` | Smaragd | ? | Episch |
| `kosmos` | Kosmos | ? | Legendär |
| `aurora_himmel` | Aurora-Himmel | ? | Legendär |
| `blutmond` | Blutmond | ? | Episch |
| `sonnenlicht` | Sonnenlicht | ? | Selten |
| `galaxie_tiefe` | Galaxie-Tiefe | ? | Legendär |
| `mythisch` | Mythisch | ? | Mythisch |
| `leuchtendgold` | Leuchtend Gold | ? | Legendär |
| `drachenfeuer` | Drachenfeuer | ? | Legendär |
| `schatten_dunkel` | Schatten-Dunkel | ? | Episch |
| `sternenstaub` | Sternenstaub | ? | Mythisch |
| `guild_heraldik` | Gilden-Wappen | ? | Episch |
| `arena_blutrausch` | Blutrausch | ? | Legendär |
| `weltenbezwinger` | Weltenbezwinger | ? | Legendär |
| `drachenschuppen` | Drachenschuppen | ? | Episch |
| `legendaerer_hort` | Legendärer Hort | ? | Mythisch |
| `gluetnfeuer` | Glutfeuer | ? | Episch |
| `zahnradglanz` | Zahnradglanz | ? | Selten |
| `portal_wirbel` | Portal-Wirbel | ? | Legendär |
| `ewiger_kreislauf` | Ewiger Kreislauf | ? | Mythisch |
| `jenseits_der_sterne` | Jenseits der Sterne | ? | Mythisch |

## Anhang A5 – Idle-Dorf-Kosmetik (Namensfarben, 28)

| ID | Name | Beschreibung | Seltenheit | Bedingung (Code) |
|---|---|---|---|---|
| `rotgruen` | Rot → Grün | Wandelt sich von Rot zu Grün. | Selten | `ctx.idleDragonKills >= 20` |
| `goldweiss` | Gold → Weiß | Strahlendes Gold trifft auf reines Weiß. | Selten | `ctx.idleLevel >= 15` |
| `lilapink` | Lila → Pink | Verspielter Verlauf von Lila zu Pink. | Episch | `ctx.idleDragonKills >= 50` |
| `tuerkisblau` | Türkis → Blau | Kühler Verlauf wie tiefes Meerwasser. | Episch | `ctx.idleLevel >= 25` |
| `orangerot` | Orange → Rot | Wie glühende Kohle. | Episch | `ctx.idleDragonKills >= 100` |
| `regenbogen_idle` | Regenbogen (Dorf) | Alle Farben des Regenbogens im Wechsel. | Legendär | `ctx.idleLevel >= 40` |
| `amethyst` | Amethyst | Violetter Kristallglanz. | Episch | `ctx.idleDragonKills >= 150` |
| `smaragd` | Smaragd | Sattes, edles Grün. | Episch | `ctx.idleLevel >= 50` |
| `kosmos` | Kosmos | Tiefes Weltraum-Violett mit Sternenglanz. | Legendär | `ctx.idleDragonKills >= 250` |
| `aurora_himmel` | Aurora-Himmel | Ein zweites, noch intensiveres Polarlicht. | Legendär | `ctx.idleLevel >= 60` |
| `blutmond` | Blutmond | Dunkles, blutrotes Glühen. | Episch | `ctx.idleBossKills >= 5` |
| `sonnenlicht` | Sonnenlicht | Warmes, strahlendes Gelb. | Selten | `ctx.idleDragonKills >= 300` |
| `galaxie_tiefe` | Galaxie-Tiefe | Wirbelnde Sterne in der Tiefe des Alls. | Legendär | `ctx.idleLevel >= 75` |
| `mythisch` | Mythisch | Ein Verlauf, den nur wahre Legenden tragen. | Mythisch | `ctx.idleBranchesMaxed >= 3` |
| `leuchtendgold` | Leuchtend Gold | Gold, das pulsierend leuchtet. | Legendär | `ctx.idleGoldEarned >= 1000000` |
| `drachenfeuer` | Drachenfeuer | Für echte Drachenbezwinger. | Legendär | `ctx.idleDragonKills >= 500` |
| `schatten_dunkel` | Schatten-Dunkel | Noch tiefere Schatten als zuvor. | Episch | `ctx.idleBossKills >= 15` |
| `sternenstaub` | Sternenstaub | Glitzernder Staub aus fernen Galaxien. | Mythisch | `ctx.idleBranchesMaxed >= 5` |
| `guild_heraldik` | Gilden-Wappen | Prunkvolles Gold-Burgunder-Wappen für Gildenanführer. | Episch | `ctx.guildRole === 'leader'` |
| `arena_blutrausch` | Blutrausch | Feurig pulsierendes Rot für Arena-Champions. | Legendär | `ctx.arenaWins >= 50` |
| `weltenbezwinger` | Weltenbezwinger | Dunkler Purpur-Glanz für Weltboss-Veteranen. | Legendär | `ctx.raidBossesDefeated >= 25` |
| `drachenschuppen` | Drachenschuppen | Schillernde Schuppenfarben für vielfältige Drachenzüchter. | Episch | `ctx.idleDragonSpeciesOwned >= 5` |
| `legendaerer_hort` | Legendärer Hort | Opulentes Gold-Schwarz für Besitzer legendärer Drachen. | Mythisch | `ctx.idleLegendaryDragonsOwned >= 1` |
| `gluetnfeuer` | Glutfeuer | Warmes Glühen für treue Dranbleiber. | Episch | `ctx.idleLoginStreak >= 30` |
| `zahnradglanz` | Zahnradglanz | Bronze-Kupfer-Schimmer für Steampunk-Liebhaber. | Selten | `ctx.idleHasSteampunkSkin` |
| `portal_wirbel` | Portal-Wirbel | Verzerrtes Violett-Türkis wie ein sich schließendes Portal. | Legendär | `ctx.idlePrestigeLevel >= 10` |
| `ewiger_kreislauf` | Ewiger Kreislauf | Ein Verlauf, der nie endet, für die, die nie aufhören. | Mythisch | `ctx.idlePrestigeLevel >= 20` |
| `jenseits_der_sterne` | Jenseits der Sterne | Nur für die wenigen, die den Turm der Aufstiege bis hierher bezwungen haben. | Mythisch | `ctx.idlePrestigeLevel >= 30` |

## Anhang A6 – Skilltree-Knoten (Live-Datenbank, 50)

| Zweig | ID | Name | Max. Rang | Kosten/Rang | Voraussetzung | Effekt/Rang | aktiv |
|---|---|---|---|---|---|---|---|
| burg | `burg_leben` | Mehr Leben | 40 | 1 | – | `hp_pct` 1.25 — +1,25% Leben pro Rang. | ja |
| burg | `burg_verteidigung` | Verteidigung | 40 | 1 | – | `defense_pct` 1 — +1% Verteidigung pro Rang. | ja |
| burg | `burg_schild` | Schildgenerator | 20 | 2 | `burg_verteidigung` Rang 4 | `shield_regen` 0.38 — Passive Leben-Regeneration pro Kampf-Tick (Anteil, zusammen mit Reparaturtempo & Heilung). | ja |
| burg | `burg_reparatur` | Reparaturtempo | 20 | 2 | `burg_leben` Rang 4 | `repair_speed_pct` 1.25 — Passive Leben-Regeneration pro Kampf-Tick (Anteil, zusammen mit Schildgenerator & Heilung). | ja |
| burg | `burg_mauern` | Verstärkte Mauern | 24 | 3 | `burg_schild` Rang 3 | `hp_pct` 1 — +1% Leben pro Rang (stapelt mit Mehr Leben). | ja |
| burg | `burg_wachen` | Torwachen | 24 | 4 | `burg_reparatur` Rang 3 | `defense_pct` 1 — +1% Verteidigung pro Rang (stapelt mit Verteidigung). | ja |
| burg | `burg_bollwerk` | Bollwerk | 20 | 3 | `burg_wachen` Rang 3 | `hp_pct` 1.5 — +1,5% Leben pro Rang. | ja |
| burg | `burg_eisentor` | Eisentor | 20 | 3 | `burg_wachen` Rang 3 | `defense_pct` 1.25 — +1,25% Verteidigung pro Rang. | ja |
| dorf | `dorf_pfeilschaden` | Pfeilschaden | 40 | 1 | – | `attack_pct` 0.75 — +0,75% Angriff pro Rang. | ja |
| dorf | `dorf_angriffstempo` | Angriffsgeschwindigkeit | 20 | 1 | `dorf_pfeilschaden` Rang 3 | `attack_speed_pct` 1 — +1% Angriffstempo pro Rang (kürzerer Auto-Angriff-Takt). | ja |
| dorf | `dorf_krit` | Kritische Treffer | 32 | 2 | – | `crit_chance_pct` 0.38 — +0,38% Kritische-Treffer-Chance pro Rang. | ja |
| dorf | `dorf_brandpfeile` | Brandpfeile | 20 | 2 | `dorf_krit` Rang 4 | `crit_damage_pct` 1.5 — +1,5% Kritischer Schaden pro Rang. | ja |
| dorf | `dorf_bogenschuetzen` | Mehr Bogenschützen | 24 | 3 | `dorf_angriffstempo` Rang 3 | `extra_archer` 0.25 — +1,5% Angriff pro Rang (zusätzliche Bogenschützen). | ja |
| dorf | `dorf_ballisten` | Ballisten | 12 | 4 | `dorf_bogenschuetzen` Rang 4 | `ballista_unlock` 0.25 — +2 Angriff (fest) pro Rang, vor allen Prozent-Boni. | ja |
| dorf | `dorf_meisterschuetzen` | Meisterschützen | 20 | 3 | `dorf_ballisten` Rang 2 | `attack_pct` 1 — +1% Angriff pro Rang. | ja |
| dorf | `dorf_kriegshorn` | Kriegshorn | 16 | 3 | `dorf_ballisten` Rang 2 | `attack_speed_pct` 1.25 — +1,25% Angriffstempo pro Rang. | ja |
| dorf | `dorf_klickkraft` | Klickkraft | 32 | 2 | `dorf_pfeilschaden` Rang 2 | `click_damage_pct` 1 — +1% Klick-Schaden pro Rang (oben auf die Basis von 12% Angriff pro Klick). | ja |
| forschung | `forsch_xp` | Mehr XP | 40 | 1 | – | `xp_pct` 1 — +1% XP pro Rang. | ja |
| forschung | `forsch_gold` | Mehr Gold | 32 | 1 | – | `gold_find_pct` 0.75 — +0,75% Gold pro Rang (eigener Bonus-Topf). | ja |
| forschung | `forsch_loot` | Bessere Lootchance | 32 | 2 | `forsch_xp` Rang 4 | `loot_chance_pct` 0.75 — +0,75% Lootchance pro Rang. | ja |
| forschung | `forsch_drachenkunde` | Drachenkunde | 24 | 2 | `forsch_gold` Rang 3 | `attack_pct` 0.63 — +0,63% Angriff pro Rang. | ja |
| forschung | `forsch_alchemie` | Alchemie | 24 | 3 | `forsch_loot` Rang 3 | `loot_chance_pct` 0.63 — +0,63% Lootchance pro Rang (stapelt). | ja |
| forschung | `forsch_kartografie` | Kartografie | 20 | 4 | `forsch_drachenkunde` Rang 3 | `xp_pct` 0.75 — +0,75% XP pro Rang (stapelt). | ja |
| forschung | `forsch_meisterschmied` | Meisterschmied | 20 | 3 | `forsch_kartografie` Rang 2 | `attack_pct` 1 — +1% Angriff pro Rang (stapelt). | ja |
| forschung | `forsch_archive` | Große Archive | 20 | 3 | `forsch_kartografie` Rang 2 | `xp_pct` 1.25 — +1,25% XP pro Rang (stapelt). | ja |
| magie | `magie_blitz` | Blitzschlag | 24 | 1 | – | `elem_lightning` 0.5 — +0,5% Chance pro Rang auf einen Bonus-Blitzschlag (60% Angriff Extra-Schaden). | ja |
| magie | `magie_eis` | Eis | 24 | 1 | – | `elem_ice` 0.5 — +0,5% Chance pro Rang, den Gegenangriff des Drachen komplett auszusetzen. | ja |
| magie | `magie_feuer` | Feuer | 24 | 2 | – | `elem_fire` 0.5 — +0,5% Chance pro Rang auf einen Brand (4 Ticks lang je 18% Angriff Extra-Schaden). | ja |
| magie | `magie_heilung` | Heilung | 24 | 2 | `magie_eis` Rang 3 | `heal_pct` 0.63 — Passive Leben-Regeneration pro Kampf-Tick (Anteil, zusammen mit Schildgenerator & Reparaturtempo). | ja |
| magie | `magie_resistenz` | Magieresistenz | 24 | 3 | `magie_feuer` Rang 3 | `magic_resist_pct` 0.75 — +0,75% Schadensreduktion pro Rang gegen den Gegenangriff des Drachen. | ja |
| magie | `magie_meister` | Magiemeister | 16 | 4 | `magie_resistenz` Rang 3 | `elem_fire` 0.75 — +0,75% zusätzliche Feuer-Chance pro Rang (stapelt mit Feuer). | ja |
| magie | `magie_erzmagier` | Erzmagier | 16 | 4 | `magie_meister` Rang 2 | `elem_lightning` 0.75 — +0,75% zusätzliche Blitz-Chance pro Rang (stapelt mit Blitzschlag). | ja |
| magie | `magie_portal` | Dimensionsportal | 12 | 4 | `magie_meister` Rang 2 | `crit_damage_pct` 2 — +2% Kritischer Schaden pro Rang (stapelt mit Brandpfeile). | ja |
| magie | `magie_runenglueck` | Runenglück | 20 | 4 | `magie_meister` Rang 2 | `rune_luck_pct` 1 — Ein magisches Gespür für verborgene Runen - erhöht die Chance auf bessere Seltenheitsstufen beim Runenfund, genau wie eine ausgerüstete Glücksrune. | ja |
| wirtschaft | `wirt_gold` | Goldproduktion | 40 | 1 | – | `gold_prod_pct` 1 — +1% Gold pro Rang. | ja |
| wirtschaft | `wirt_holz` | Holzproduktion | 32 | 1 | – | `wood_prod_pct` 1 — +1% Holz pro Rang. | ja |
| wirtschaft | `wirt_stein` | Steinproduktion | 32 | 2 | – | `stone_prod_pct` 1 — +1% Stein pro Rang. | ja |
| wirtschaft | `wirt_offline` | Offline-Einnahmen | 24 | 2 | `wirt_gold` Rang 4 | `offline_income_pct` 1.25 — +1,25% Offline-Effizienz pro Rang. | ja |
| wirtschaft | `wirt_handel` | Handelsrouten | 24 | 3 | `wirt_holz` Rang 3 | `gold_prod_pct` 0.75 — +0,75% Gold pro Rang (stapelt mit Goldproduktion). | ja |
| wirtschaft | `wirt_lager` | Vorratslager | 24 | 4 | `wirt_stein` Rang 3 | `wood_prod_pct` 0.75 — +0,75% Holz pro Rang (stapelt mit Holzproduktion). | ja |
| wirtschaft | `wirt_schatzkammer` | Schatzkammer | 20 | 3 | `wirt_lager` Rang 3 | `gold_prod_pct` 1.25 — +1,25% Gold pro Rang (stapelt). | ja |
| wirtschaft | `wirt_expedition` | Expeditionscorps | 16 | 3 | `wirt_lager` Rang 3 | `offline_income_pct` 1.25 — +1,25% Offline-Effizienz pro Rang (stapelt). | ja |
| zucht | `zucht_obstgarten` | Obstgarten-Pflege | 20 | 8 | – | `fruit_prod_pct` 2 — +2% Früchteproduktion pro Rang. | ja |
| zucht | `zucht_jagdhuette` | Jagdhütten-Ausbildung | 20 | 8 | – | `meat_prod_pct` 2 — +2% Fleischproduktion pro Rang. | ja |
| zucht | `zucht_erfahrung` | Drachentrainer | 20 | 8 | – | `dragon_xp_pct` 3 — +3% Kampferfahrung für Begleitdrachen pro Rang. | ja |
| zucht | `zucht_brutzeit` | Wärmelampen | 15 | 12 | `zucht_obstgarten` Rang 5 | `brood_time_pct` 1 — -1% Brutzeit pro Rang (max. 40% Reduktion). | ja |
| zucht | `zucht_eifund` | Spürnase | 20 | 10 | `zucht_erfahrung` Rang 5 | `egg_chance_pct` 2 — +2% relative Ei-Fund-Chance pro Rang. | ja |
| zucht | `zucht_lagerplaetze` | Drachenzwinger | 15 | 15 | `zucht_jagdhuette` Rang 5 | `dragon_storage_flat` 1 — +1 Drachenlagerplatz pro Rang. | nein |
| zucht | `zucht_nestkosten` | Nestbaumeister | 15 | 14 | `zucht_brutzeit` Rang 5 | `nest_cost_pct` 2 — -2% Kosten für neue Drachennester pro Rang (max. 40%). | ja |
| zucht | `zucht_opfergabe` | Ritualkenntnis | 10 | 20 | `zucht_eifund` Rang 10 | `sacrifice_cost_pct` 4 — -4% Opfergaben für legendäre Eier pro Rang (max. 50%). | ja |

## Anhang A7 – Kampf-Drachen (Live-Tabelle `idle_dragons`)

| ID | Name | Spawn-Regel | HP | Angriff | Vert. | Gold | EP | Holz | Stein | Kristalle | Essenz | Sprite |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `feuerdrache` | Feuerdrache | standard | 60 | 7 | 1 | 6 | 6 | 2 | 1 | 0 | 0 | feuerdrache |
| `blitzdrache` | Blitzdrache | standard | 55 | 8 | 1 | 6 | 6 | 1 | 2 | 0 | 0 | blitzdrache |
| `wasserdrache` | Wasserdrache | standard | 65 | 6 | 2 | 6 | 6 | 2 | 2 | 0 | 0 | wasserdrache |
| `schattendrache` | Schattendrache | rare | 90 | 10 | 3 | 12 | 10 | 2 | 2 | 1 | 1 | schattendrache |
| `wuffdrache` | Wuffdrache | rare | 50 | 5 | 1 | 10 | 8 | 1 | 1 | 1 | 1 | wuffdrache |
| `shenloss` | Shenloss | event_easter | 1 | 1 | 2 | 250 | 250 | 10 | 10 | 20 | 15 | shenloss |
| `liber` | Ganz Liber Drache | event_easter | 1 | 1 | 2 | 250 | 250 | 10 | 10 | 20 | 15 | liber |
| `erddrache` | Erddrache | standard | 70 | 6 | 3 | 6 | 6 | 1 | 3 | 0 | 0 | erddrache |
| `winddrache` | Winddrache | standard | 130 | 13 | 3 | 6 | 6 | 2 | 2 | 0 | 0 | (id) |
| `yakshas-drache` | Aurelia Drache | miniboss_10 | 115 | 10 | 4 | 8 | 8 | 8 | 8 | 5 | 5 | yakshas-drache |
| `yaksha-boss` | Yaksha der Drachenboss | boss_25 | 125 | 12 | 7 | 12 | 12 | 8 | 8 | 8 | 5 | yaksha-boss |
| `cyberdrache` | Cyberdrache | standard | 62 | 7 | 2 | 6 | 6 | 2 | 1 | 0 | 0 | cyberdrache |

## Anhang A8 – Zucht-Drachenarten (Live-Tabelle `dragon_species`, 25)

| Sort. | ID | Name | Seltenheit | Ei-Quelle | Kampf-Drache | Ei-Chance | Brutzeit | Opfergabe | Wachstum (Fütter-EP) | Kampf-EP bis erwachsen | Mehrwert-Drache | Zusatzwerte |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `feuerdrache` | Feuerdrache | standard | combat | feuerdrache | 0.001 | 45 Min. | 0 Gold + 0 Kristalle | 500 | 2.500 | nein | 2–3 |
| 1 | `wasserdrache` | Wasserdrache | standard | combat | wasserdrache | 0.001 | 45 Min. | 0 Gold + 0 Kristalle | 500 | 2.500 | nein | 2–3 |
| 2 | `winddrache` | Winddrache | standard | combat | winddrache | 0.001 | 45 Min. | 0 Gold + 0 Kristalle | 500 | 2.500 | nein | 2–3 |
| 3 | `blitzdrache` | Blitzdrache | standard | combat | blitzdrache | 0.001 | 45 Min. | 0 Gold + 0 Kristalle | 500 | 2.500 | nein | 2–3 |
| 4 | `aureliadrache` | Aureliadrache | selten | combat | yakshas-drache | 0.001 | 90 Min. | 0 Gold + 0 Kristalle | 1.000 | 6.000 | nein | 3–4 |
| 5 | `schattendrache` | Schattendrache | selten | combat | schattendrache | 0.001 | 90 Min. | 0 Gold + 0 Kristalle | 1.000 | 6.000 | nein | 3–4 |
| 6 | `wuffdrache` | Wuffdrache | selten | combat | wuffdrache | 0.001 | 90 Min. | 0 Gold + 0 Kristalle | 1.000 | 6.000 | nein | 3–4 |
| 7 | `koradrache` | Koradrache | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 8 | `hakudrache` | Hakudrache | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 9 | `zerathor` | Zerathor | legendaer | raid | – | 0.01 | 450 Min. | 500.000 Gold + 200 Kristalle | 6.000 | 50.000 | ja | 4–5 |
| 10 | `yakshadrache` | Yakshadrache | legendaer | raid | – | 0.01 | 450 Min. | 500.000 Gold + 200 Kristalle | 6.000 | 50.000 | ja | 4–5 |
| 11 | `obsidrache` | Obsidrache | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 12 | `kowalski` | Kowalski | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 13 | `byte` | Byte | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 14 | `enderdrachen` | Enderdrachen | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 15 | `kaledoss` | Kaledoss | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 16 | `nytherion` | Nytherion | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 17 | `phil` | Phil | legendaer | event | – | 0 | 450 Min. | 500.000 Gold + 200 Kristalle | 6.000 | 50.000 | ja | 4–5 |
| 18 | `fynnow` | Fynnow | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 19 | `vulkarion` | Vulkarion | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 20 | `bloodterion` | Bloodterion | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 21 | `gravoryx` | Gravoryx | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |
| 22 | `lohendrache` | Lohendrache | legendaer | event | – | 0 | 450 Min. | 500.000 Gold + 200 Kristalle | 6.000 | 50.000 | ja | 4–5 |
| 23 | `darknisdrache` | Darknisdrache | legendaer | event | – | 0 | 450 Min. | 500.000 Gold + 200 Kristalle | 6.000 | 50.000 | ja | 4–5 |
| 25 | `bagon` | Bagon | episch | event | – | 0 | 180 Min. | 0 Gold + 0 Kristalle | 2.000 | 15.000 | nein | 3–4 |

## Anhang A9 – Dorf-Skins (Live-Tabelle `idle_village_skins`)

| Sort. | ID | Name | Freischaltung | Preis | Hinweis | Video | aktiv |
|---|---|---|---|---|---|---|---|
| 0 | `standard` | Standarddorf | free |  |  | ja | ja |
| 1 | `pilzdorf` | Pilzdorf | purchase | 2.500.000 Gold |  | ja | ja |
| 2 | `pinguindorf` | Pinguindorf | purchase | 2.500.000 Gold |  | ja | ja |
| 3 | `geisterdorf` | Geisterdorf | purchase | 5.000.000 Gold |  | ja | ja |
| 4 | `zerathordorf` | Zerathor Dorf | boss_drop |  | 1% Chance als Beute nach einem gewonnenen Weltboss-Raid. | ja | ja |
| 5 | `libersheimat` | Libers Heimat | purchase | 50.000.000 Gold |  | ja | ja |
| 6 | `zerstoertesdorf` | Zerstörtes Dorf | achievement |  | 15.000x gegen Drachen verloren. | ja | ja |
| 7 | `midasstadt` | Midas Stadt | purchase | 500.000.000 Gold |  | ja | ja |
| 8 | `yakshasheimat` | Yakshas Heimat | achievement |  | 50.000x den Boss Yaksha besiegen. | ja | ja |
| 9 | `kartendorf` | Kartendorf | purchase | 50.000.000 Gold |  | ja | ja |
| 10 | `eisdorf` | Eis Dorf | purchase | 150.000 Gold |  | ja | ja |
| 11 | `steampunkdorf` | Steampunk Dorf | purchase | 100.000.000 Gold / 1.99 € |  | ja | ja |
| 12 | `enderdorf` | Ender Dorf | purchase | 500.000 Gold |  | ja | ja |
| 13 | `nexodorf` | Nexo Dorf | purchase | 500.000 Gold |  | ja | ja |
| 14 | `cyberstadt` | Cyber Stadt | purchase | 750.000 Gold |  | ja | ja |
| 15 | `kaledossheimat` | Kaledoss Heimat | purchase | 44.000.000 Gold |  | ja | ja |
| 16 | `kallejuniordorf` | KalleJunior Dorf | code |  | Nur per Einlöse-Code erhältlich. | ja | ja |
| 999 | `drachenrahmen` | Drachenrahmen | real_money |  / 1.99 € |  | nein | nein |

## Anhang A10 – Plüschtiere (Live-Tabelle `plushies`, 26)

| ID | Name | Seltenheit |
|---|---|---|
| `codewizard` | Codewizard Plüshie | Episch |
| `derliber` | Derliber Plüshie | Episch |
| `fynnow` | Fynnow Plüshie | Episch |
| `kaledoss` | Kaledoss Plüshie | Episch |
| `kora` | Kora Plüshie | Episch |
| `darkorius` | Darkorius Plüshie | Episch |
| `lukas` | Lukas Plüshie | Episch |
| `obsi` | Obsi Plüshie | Episch |
| `roggberd` | Roggberd Plüshie | Episch |
| `yaksha` | Yaksha Plüshie | Episch |
| `bagontr01` | Bagontr01 Plüshie | Episch |
| `flammengott` | Flammengott Plüshie | Episch |
| `zerathor_zorn_der_verdammnis` | Zerathor, Zorn Der Verdammnis Plüshie | Episch |
| `moorrisss` | Moorrisss Plüshie | Episch |
| `ronjawolf` | Ronjawolf Plüshie | Episch |
| `misskowalski` | Misskowalski Plüshie | Episch |
| `muecke0702` | Muecke0702 Plüshie | Episch |
| `scusy` | Scusy Plüshie | Episch |
| `wuchitv` | Wuchitv Plüshie | Episch |
| `sheepmasterlp` | SheepMasterLP Plüshie | Legendär |
| `randomauto` | RandomAuto Plüshie | Episch |
| `flink040` | Flink040 Plüshie | Episch |
| `micha7168` | Micha7168 Plüshie | Episch |
| `opphil` | Opphil Plüshie | Episch |
| `jakecrayson` | Jakecrayson Plüshie | Episch |
| `crocodilandy` | Crocodilandy Plüshie | Episch |

## Anhang A11 – Gilden-Technologie-Knoten (Live-Tabelle `guild_tech_nodes`)

| Kategorie | ID | Name | Effekt-Typ | Effekt/Stufe | Max. Stufe | Basiskosten | Kostenwachstum | Beiträge/Stufe | Voraussetzungen |
|---|---|---|---|---|---|---|---|---|---|
| drachenzucht | `guild_zucht_kraft` | Zuchtkraft | `guildCompanionAttackPct` | 8 | 5 | 2.000.000 | 1.5 | 25 | – |
| drachenzucht | `guild_zucht_panzer` | Zuchtpanzer | `guildCompanionDefensePct` | 8 | 5 | 2.000.000 | 1.5 | 25 | – |
| drachenzucht | `guild_zucht_vitalitaet` | Zuchtvitalität | `guildCompanionHpPct` | 8 | 5 | 2.000.000 | 1.5 | 25 | – |
| drachenzucht | `guild_zucht_meisterschaft` | Zuchtmeisterschaft | `guildCompanionAllStatPct` | 5 | 5 | 3.000.000 | 1.6 | 25 | `guild_zucht_kraft`, `guild_zucht_panzer`, `guild_zucht_vitalitaet` |
| schlacht | `attack` | Angriff | `attackPct` | 7 | 5 | 2.000.000 | 1.5 | 25 | – |
| schlacht | `defense` | Verteidigung | `defensePct` | 7 | 5 | 2.000.000 | 1.5 | 25 | – |
| schlacht | `crit_chance` | Kritchance | `critChancePct` | 2.1 | 5 | 2.000.000 | 1.5 | 25 | – |
| schlacht | `crit_damage` | Kritischer Schaden | `critDamagePct` | 14 | 5 | 2.500.000 | 1.55 | 25 | `attack` |
| schlacht | `boss_damage` | Bossschaden | `bossDamagePct` | 17.5 | 5 | 2.500.000 | 1.55 | 25 | `defense`, `crit_chance` |
| schlacht | `guild_turm_vorreiter` | Turm-Vorreiter | `towerChampionPctPer10` | 0.25 | 5 | 2.500.000 | 1.55 | 25 | `crit_chance` |
| schlacht | `guild_kriegsrat` | Kriegsrat | `arenaExtraAttempts` | 3 | 5 | 3.000.000 | 1.6 | 25 | `crit_damage`, `boss_damage` |
| schlacht | `guild_stadtmauer` | Stadtmauer | `raidCityHpPct` | 5 | 5 | 3.000.000 | 1.6 | 25 | `boss_damage`, `guild_turm_vorreiter` |
| wachstum | `gold` | Gold | `goldPct` | 10.5 | 5 | 2.000.000 | 1.5 | 25 | – |
| wachstum | `xp` | Erfahrungsbonus | `xpPct` | 7 | 5 | 2.000.000 | 1.5 | 25 | – |
| wachstum | `prestige` | Prestigebonus | `prestigePct` | 3.5 | 5 | 2.000.000 | 1.5 | 25 | – |
| wachstum | `rune_luck` | Runenglück | `runeLuckPct` | 10.5 | 5 | 2.000.000 | 1.5 | 25 | – |
| wachstum | `guild_autokauf` | Gilden-Autokauf | `autobuyExtraPurchases` | 10 | 5 | 2.500.000 | 1.55 | 25 | `gold` |
| wachstum | `guild_brutbeschleuniger` | Brutbeschleuniger | `broodSpeedPct` | 7 | 5 | 2.500.000 | 1.55 | 25 | `xp`, `prestige` |
| wachstum | `guild_schmiede` | Gildenschmiede | `runeUpgradeDiscountPct` | 7 | 5 | 2.500.000 | 1.55 | 25 | `rune_luck` |
| wachstum | `guild_nachtwache` | Nachtwache | `offlineCapExtraHours` | 2.5 | 5 | 3.000.000 | 1.6 | 25 | `guild_autokauf` |
| wachstum | `guild_aufstiegsvorbereitung` | Aufstiegsvorbereitung | `ascensionThresholdDiscountPct` | 6 | 5 | 3.000.000 | 1.6 | 25 | `guild_brutbeschleuniger` |
| wachstum | `guild_streak_schutz` | Streak-Schutz | `streakProtectUnlock` | 1 | 1 | 8.000.000 | 1 | 40 | `guild_schmiede` |
| wachstum | `guild_willkommenspaket` | Willkommenspaket | `newMemberBonusUnlock` | 1 | 1 | 8.000.000 | 1 | 40 | `guild_nachtwache`, `guild_aufstiegsvorbereitung` |

## Anhang A12 – Gildenlevel-Schwellen (Live-Tabelle `guild_level_thresholds`)

L1: 0 · L2: 150.000 · L3: 500.000 · L4: 1.500.000 · L5: 4.000.000 · L6: 9.000.000 · L7: 18.000.000 · L8: 32.000.000 · L9: 55.000.000 · L10: 90.000.000 · L11: 140.000.000 · L12: 210.000.000 · L13: 300.000.000 · L14: 420.000.000 · L15: 580.000.000 · L16: 780.000.000 · L17: 1.030.000.000 · L18: 1.340.000.000 · L19: 1.720.000.000 · L20: 2.180.000.000 · L21: 2.730.000.000 · L22: 3.380.000.000 · L23: 4.150.000.000 · L24: 5.050.000.000 · L25: 6.100.000.000 · L26: 7.320.000.000 · L27: 8.730.000.000 · L28: 10.350.000.000 · L29: 12.200.000.000 · L30: 14.300.000.000 · L31: 16.736.000.000 · L32: 19.565.000.000 · L33: 22.854.000.000 · L34: 26.682.000.000 · L35: 31.143.000.000 · L36: 36.346.000.000 · L37: 42.423.000.000 · L38: 49.527.000.000 · L39: 57.842.000.000 · L40: 67.585.000.000 · L41: 79.014.000.000 · L42: 92.436.000.000 · L43: 108.200.000.000 · L44: 126.800.000.000 · L45: 148.700.000.000 · L46: 174.500.000.000 · L47: 205.000.000.000 · L48: 241.000.000.000 · L49: 283.600.000.000 · L50: 334.100.000.000 · L51: 394.000.000.000 · L52: 465.200.000.000 · L53: 549.800.000.000 · L54: 650.500.000.000 · L55: 770.400.000.000 · L56: 913.400.000.000 · L57: 1.084.100.000.000 · L58: 1.288.200.000.000 · L59: 1.532.400.000.000 · L60: 1.824.900.000.000 · L61: 2.175.600.000.000 · L62: 2.596.600.000.000 · L63: 3.102.500.000.000 · L64: 3.711.200.000.000 · L65: 4.444.200.000.000 · L66: 5.328.000.000.000 · L67: 6.394.700.000.000 · L68: 7.683.500.000.000 · L69: 9.242.400.000.000 · L70: 11.130.000.000.000 · L71: 13.420.000.000.000 · L72: 16.200.000.000.000 · L73: 19.570.000.000.000 · L74: 23.670.000.000.000 · L75: 28.660.000.000.000 · L76: 34.750.000.000.000 · L77: 42.170.000.000.000 · L78: 51.240.000.000.000 · L79: 62.330.000.000.000 · L80: 75.900.000.000.000 · L81: 92.520.000.000.000 · L82: 112.910.000.000.000 · L83: 137.950.000.000.000 · L84: 168.720.000.000.000 · L85: 206.580.000.000.000 · L86: 253.220.000.000.000 · L87: 310.730.000.000.000 · L88: 381.710.000.000.000 · L89: 469.420.000.000.000 · L90: 577.910.000.000.000 · L91: 712.250.000.000.000 · L92: 878.780.000.000.000 · L93: 1.085.000.000.000.000 · L94: 1.342.000.000.000.000 · L95: 1.661.000.000.000.000 · L96: 2.058.000.000.000.000 · L97: 2.553.000.000.000.000 · L98: 3.171.000.000.000.000 · L99: 3.942.000.000.000.000 · L100: 4.906.000.000.000.000
