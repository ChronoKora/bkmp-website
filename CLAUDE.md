# BKMP — Projekt-Leitfaden für Claude Code

Statische Website (kein Build-Schritt, kein package.json) + Supabase-Backend + Vercel-Deploy. Öffentliche Investoren-/Marktplatz-Seite UND das Idle-Dorf-Spiel leben in derselben Codebasis. Der Besitzer ist nicht-technisch und lässt Claude-Code-Sessions den gesamten Code schreiben — Commits/Deploys übernimmt er selbst.

## ⚠️ Laufendes Redesign — Phasen-Status

Am 17.07.2026 wurde ein **vollständiges professionelles Redesign** freigegeben (Plan: `C:\Users\David\.claude\plans\delightful-floating-frog.md`). Rollout ist **phasenweise mit Zwischen-Deployments** — jede Phase wird fertig, geprüft, getaggt (`git tag phase-N-complete`), bevor die nächste beginnt.

**Aktueller Stand:** Phase 1, 2 (2a+2b+2c), 3, 4 (Marketing-Redesign) und 5.0 (App-Modus-Promotion) sind komplett fertig und ausführlich verifiziert. Phase 5.1+ (Prestige/Kosmetik/Gilde/weitere Subsysteme, epische Stimmung im Detail) offen. Bereit für Phase 5.1, sobald der Nutzer committet/deployed. Kein Kollisions-Hinweis aktiv.

⚠️ **Phase 5.0 hat einen kritischen, nie deployten Bug gefunden+gefixt** (siehe Abschnitt "App-Modus-Promotion" unten) — `html.bkmp-app-mode` wurde global, aber mehrere Regeln waren noch mit der Annahme "nur /app" geschrieben und haben dadurch Header/Footer/Nav/alle 10 Marketing-Sektionen sowie einen Vollbild-Splash dauerhaft über die normale Website gelegt. Vor jeder weiteren Arbeit an `html.bkmp-app-mode`-Selektoren in style.css: prüfen, ob der Selektor eine Klasse trifft, die AUCH auf der normalen Website vorkommt (z.B. `.joke-card`, `header`, `footer`, bare Tag-Namen) - falls ja, gehört er entweder auf `.zone-game` (Stimmungs-Chrome) oder `html.bkmp-app-mode.zone-game` (echtes /app-Vollbild-Verhalten wie Splash/Header-Ausblenden/Basis-Schriftgröße), nicht auf `html.bkmp-app-mode` allein.

| Phase | Inhalt | Status |
|---|---|---|
| 1 | Inline-Scripts extrahiert, `defer`, Lazy-Loading, Cache-Header, Bild-Pipeline, Tokens (inert), `/sql/`-Ordner | ✅ fertig (noch nicht committet) |
| 2 | idledorf.js in `/js/systems/*.js` zerlegen (siehe Modul-Karte unten) | ✅ fertig (2a+2b+2c) |
| 3 | design-tokens.css tatsächlich verdrahten, geteilte UI-Komponenten (`js/ui/bkmp-ui-components.js`) | ✅ fertig |
| 4 | Marketing-/Investoren-/Marktplatz-Redesign (professionelle Stimmung) | ✅ fertig |
| 5.0 | App-Modus-Ideen einzeln übernehmen/verwerfen (Touch-Targets, Bottom-Nav, Kampf-Juice, Popup-Chrome, HUD-Portrait) | ✅ fertig |
| 5.1+ | Idle-Game-Redesign pro Subsystem (Prestige, Kosmetik, Gilde, Zucht, Dungeon, Arena, ...) | offen |
| 6 | Admin & idle-stream-mini.html | offen |
| 7 | Barrierefreiheit, totes CSS löschen, restliche Assets auf WebP | offen |

**⚠️ Parallele Sessions:** Dieses Repo hat keine Worktree-Isolation — mehrere Claude-Code-Sessions können gleichzeitig hier arbeiten. **Vor jeder größeren Änderung an `idledorf.js`, `style.css` oder den Dateien unter `/js/` diesen Abschnitt auf einen Hinweis wie „⚠️ Phase 2 läuft, nicht parallel an idledorf.js arbeiten" prüfen** (wird hier eingetragen, sobald eine Phase mit hohem Kollisionsrisiko startet, und nach Abschluss wieder entfernt).

## Architektur-Entscheidungen (siehe Plan-Datei für vollständige Begründung)

- **Kein Bundler, keine ES-Module.** idledorf.js wird in mehrere klassische globale `<script>`-Dateien mit fester Ladereihenfolge zerlegt (`/js/systems/*.js`), nicht in ES-Module — 418 globale Funktionen + 156 geteilte veränderliche Variablen + Live-Geld-Fluss (Stripe) ohne Tests machen einen Bundler/ESM-Umbau zu riskant. Neue globale Funktionen folgen der bestehenden `bkmpXxx`-Namenskonvention.
- **CSS-Tokens:** `design-tokens.css` (neu, Phase 1 inert) wird ab Phase 3 schrittweise in bestehende Selektoren hinein referenziert — kein Parallel-System. Stimmung (Website vs. Spiel) läuft über `.zone-site`/`.zone-game`-Wrapper-Klassen, die dieselben `--mood-*`-Variablennamen umdefinieren.
- **Komponenten:** einfache JS-Factory-Funktionen (`bkmpUiXxx()` → HTML-String), keine Web Components — verlängert das bestehende Template-Literal+innerHTML-Muster.
- **Assets:** `scripts/optimize-images.ps1` (+`optimize-images.mjs`) für WebP-Konvertierung, manuell einmalig pro Content-Batch ausgeführt. Braucht lokal installiertes Node.js + `sharp` (nicht Teil des Deploys, siehe Kommentare in den Skripten). Erzeugt `name-web.webp`/`name-web.png` neben dem Original; `bkmpDragonThumbHtml()` in idledorf.js leitet daraus automatisch `<picture>`-Markup ab — **funktioniert ohne Datenbank-Änderung**, fällt auf das Original-PNG zurück, falls eine `-web`-Variante fehlt.

## Modul-Karte

```
/js/core/bkmp-site.js              - Tab-Nav, Theme/Akzent-Init, Site-Glue [Phase 1 ✅]
/js/core/bkmp-app-mode-bootstrap.js - App-Modus-Bootstrap [Phase 1 ✅]
/js/core/bkmp-idle-state.js        - ALLE geteilten veraenderlichen Variablen (bkmpIdleState,
                                      bkmpPlayerDragons, ...) + bkmpAutoclick*-Helfer. Laedt
                                      IMMER ZUERST, vor allen anderen /js/-Dateien. [Phase 2a ✅]
/js/systems/bkmp-dungeon.js        - bkmpDungeon* [Phase 2a ✅]
/js/systems/bkmp-breeding.js       - bkmpDragon* [Phase 2a ✅]
/js/systems/bkmp-guild.js          - bkmpGuild* [Phase 2a ✅]
/js/systems/bkmp-runes.js          - bkmpRune* [Phase 2a ✅]
/js/systems/bkmp-raid.js           - bkmpRaid* [Phase 2a ✅]
/js/systems/bkmp-tower.js          - bkmpTower* [Phase 2a ✅]
/js/systems/bkmp-prestige.js       - bkmpPrestige* [Phase 2a ✅]
/js/systems/bkmp-arena.js          - bkmpArena* [Phase 2a ✅]
/js/systems/bkmp-meister.js        - bkmpMeister* [Phase 2a ✅]
/js/core/bkmp-idle-bootstrap.js    - NUR der Aufruf `bkmpIdleInit();`. Laedt IMMER ZULETZT
                                      (nach idledorf.js, vor bkmp-site.js). [Phase 2a ✅]
/js/core/bkmp-combat-math.js       - reine Berechnungsfunktionen (Schaden, Stats, Rewards, XP-Kurve) [Phase 2b ✅]
/js/systems/bkmp-skilltree.js      - [Phase 2b ✅]
/js/systems/bkmp-cosmetics.js      - Titel/Kosmetik/Dorf-Skins/Stripe-Rueckkehr [Phase 2b ✅]
/js/systems/bkmp-events.js         - Event-Drachen/Streak [Phase 2b ✅]
/js/ui/bkmp-hud.js                 - Sprite-Rendering, HP-Balken, Projektile, Klick-Schaden [Phase 2b ✅]
idledorf.js                        - Kern-Orchestrator: Game-Loop (Tick/Init/Save-Sync), State-
                                      Laden, Wartungsmodus, Stufen-Leiste, Offline-Progress,
                                      Upgrades, Tab-Registry (bkmpIdleTabs), Achievement-Adapter
                                      (bkmpIdleGetAchievementContextFields), Bestenliste,
                                      Produktionsgebaeude. ~2.200 Zeilen. [Ziel Phase 2c fuer
                                      Achievements/Bestenliste, Rest bleibt bewusst hier]
/js/systems/bkmp-leaderboard.js    - bkmpUiMedal() + bkmpLeaderboardRenderSimpleRow(), von der
                                      Idle-Dorf-/Dungeon-/Raid-Bestenliste gemeinsam genutzt
                                      [Phase 2c ✅]. Die Marketing-Seiten-Bestenliste (bkmp-site.js,
                                      andere Metriken + reichere Zeile mit Podium-Glow/Profil-Klick)
                                      bleibt bewusst separat, nutzt aber auch bkmpUiMedal().
/js/systems/bkmp-achievements.js   - bkmpAchievementReadCache() (geteiltes Cache-Lese-Muster
                                      fuer die 4 GetAchievementContextFields-Adapter) [Phase 2c ✅].
                                      Die volle Achievement-Engine (Toast/Konfetti-Warteschlange,
                                      Kategorien-Rendering, noch in idledorf.js/bkmp-site.js) ist
                                      bewusst Phase 5-Arbeit, siehe Kommentar in der Datei.
/js/ui/bkmp-ui-components.js       - geteilte Factories [Phase 3 ✅]: bkmpUiRarityBadge() (verdrahtet
                                      in renderCosmeticsPanel, macht cosmetic.rarity erstmals sichtbar),
                                      bkmpUiLeaderboardRow() (verdrahtet in bkmpIdleRenderLeaderboardList),
                                      bkmpUiCard()/bkmpUiTooltipHtml()+bkmpUiWireTooltipTrigger()/
                                      bkmpUiModalHtml()+bkmpUiTrapFocus()/bkmpUiShowToast() sind fertig
                                      und einsatzbereit, aber bewusst noch NICHT an bestehende Stellen
                                      angeschlossen (das ist Phase 4-6-Arbeit, wenn echte Seiten neu
                                      gebaut werden).
```

**Design-Tokens (Phase 3):** style.css' alte `:root`/`html[data-theme="light"]`-Tokens (`--gold`, `--paper`, `--line`, ...) zeigen jetzt per `var()` auf design-tokens.css (`--color-accent`, `--color-bg`, `--color-line`, ...) statt eigene Hex-Werte zu tragen - dadurch erben alle ~700 bestehenden `var(--gold)`-artigen Stellen in style.css automatisch das neue Token-System, ohne dass jede einzeln angefasst werden musste. `--color-danger`/`--color-danger-ink` sind verdrahtet, aber noch an keinem echten Button angeschlossen (kein `.btn-danger`-Fill existiert bisher, das ist Phase 5/6) und `--color-accent-ink` (ersetzt 11 hartkodierte `#0A0A0F`-Stellen für Text auf goldenem Untergrund).

**Zonen-Stimmung (Phase 4):** `html` bekommt bereits im fruehen Kopf-Script `zone-site` (Standard) oder `zone-game` (App-Modus) - siehe index.html `<head>`, gleiche Stelle wie der bestehende `bkmp-app-mode`-Flag. `#idleDorfOverlay` traegt zusaetzlich fest `zone-game` im Markup, damit das Idle-Dorf-Fenster IMMER die epische Stimmung bekommt, auch auf der normalen Website. admin.html/datenschutz.html/impressum.html: `zone-site`. idle-stream-mini.html: `zone-game`. Die `--mood-*`-Tokens (siehe design-tokens.css) werden jetzt tatsaechlich konsumiert (`--mood-radius-panel` in Card-Radien, `--mood-glow-strength` in CTA-Schatten) - verifiziert per Browser, dass verschachtelte Elemente korrekt die jeweils naeher liegende Zonen-Klasse erben.

**Marketing-Redesign-Strategie (Phase 4):** JEDE der 10 Marketing-Sektionen (`<section class="panel">`) startet mit derselben `.panel-title`-Komponente - eine Verbesserung dort (Typo-Skala, Akzent-Unterstrich) wirkt automatisch auf alle 10. Ebenso teilen sich mehrere Sektionen dieselben Karten-Komponenten (`.partner-card` wird sowohl von PartnerShops als auch von Kartenfirmen genutzt, siehe mapart.js). Token-Politur (Radius/Schatten/Transition-Tokens, Hover-Zustaende) wurde auf dieser Handvoll geteilter Klassen angewendet: `.panel-title`, `.stat-card`, `.investor-card`, `.news-card`, `.wish-cta`/`.wish-card`, `.partner-card`/`.partner-filter`, `.cardsale-card`/`.cardsale-banner`, `.cardcatalog-card`/`-search`, `.about-block`, `.leaderboard-tab`, `.ledger-list`. **Noch NICHT gemacht** (bewusst zurueckgestellt, kein Blocker): die 3 fast-identischen Karten-Definitionen `.wish-card`/`.cardsale-card`/`.cardcatalog-card` koennten zu einer gemeinsamen Klasse zusammengefuehrt werden (Duplicate-CSS, siehe Audit) - das ist Phase 7-Aufraeumarbeit, keine Phase-4-Notwendigkeit.

**Feste Ladereihenfolge (siehe Kommentar in index.html vor den `<script>`-Tags):**
`vendor → supabase.js → app.js → bkmp-idle-state.js → [9 Subsystem-Dateien, beliebige Reihenfolge untereinander] → idledorf.js (Rest) → mapart.js → bkmp-idle-bootstrap.js → bkmp-site.js → bkmp-app-mode-bootstrap.js`.
Grund: `bkmp-idle-state.js` deklariert alle geteilten `let`-Variablen zuerst (TDZ-sicher), `bkmp-idle-bootstrap.js`s einzige Aufgabe (`bkmpIdleInit();`) muss nach ALLEN Subsystemen laufen. Admin.html/idle-stream-mini.html spiegeln dieselbe Reihenfolge (ohne bkmp-site.js/app-mode-bootstrap.js, die sind index.html-spezifisch).

Bis Phase 2b/2c abgeschlossen sind, bleibt der `bkmpIdle*`-Rest in `idledorf.js` (~6k Zeilen) — neue Funktionen dort weiter mit `bkmpXxx`-Präfix nach Sub-System einsortieren, damit die spätere Zerlegung mechanisch bleibt. Bei neuen geteilten (subsystem-übergreifenden) `let`-Variablen: in `js/core/bkmp-idle-state.js` deklarieren, nicht in einem Subsystem-File, sonst drohen TDZ-Fehler.

## Feste Sicherheitsregel für JEDE Phase

`supabase.js` (Auth, Stripe-Checkout `bkmpCreateStripeCheckoutSession`, Admin-Funktionen) und alle `/api/*.js`-Dateien bleiben während des gesamten Redesigns **logisch eingefroren** — Redesign-Commits ändern dort nie eine Funktion, nur ggf. das aufrufende Markup/CSS in einem separaten Commit. Ein Commit, der eine `.sql`-Datei oder eine `supabase.js`-Funktion ändert, wird nie mit einem CSS-/Markup-Commit für dasselbe Subsystem gebündelt.

## Bestehende Konventionen (weiter gültig)

- **Cache-Busting:** jede Änderung an `style.css`/`app.js`/`supabase.js`/`idledorf.js`/`js/**/*.js` braucht einen neuen `?v=...`-Query-String an allen Einbindungsstellen (5 HTML-Dateien: index.html, admin.html, idle-stream-mini.html, datenschutz.html, impressum.html — style.css/design-tokens.css laufen überall; die JS-Dateien nur wo tatsächlich eingebunden).
- **Diagnose:** bei Verdacht auf einen Live-Bug die echte Supabase-REST-API prüfen (`curl`), nicht nur aus der Sandbox raten — SQL-Migrationen in `/sql/` sind nicht automatisch alle live ausgeführt.
- **SQL-Migrationen:** liegen jetzt unter `/sql/` (bis 17.07. lose im Repo-Root). Neue Migrationen ab jetzt mit Datum benennen (`YYYYMMDD-beschreibung.sql`).
- **Commits/Deploys:** übernimmt der Projektbesitzer selbst — nicht proaktiv "soll ich committen?" fragen.
- **node_modules/package-lock.json** dürfen nie committet werden (siehe `.gitignore`) — die Seite hat keinen Build-Schritt.
