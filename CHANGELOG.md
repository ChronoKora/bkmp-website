# BKMP Changelog

Automatisch von Claude Code gepflegt: **nach jeder Code-/SQL-Änderung kommt hier sofort ein neuer Eintrag dazu** (unabhängig davon, ob committed/gepusht wird oder nicht) — neueste zuerst. Ausführliche Root-Cause-/Verifikationsdetails zu größeren Themen stehen weiterhin zusätzlich in `CLAUDE.md`; hier nur die kurze, auf einen Blick überfliegbare Übersicht.

**Format je Eintrag:** `[Kategorie] Kurzbeschreibung — betroffene Dateien — Status`
**Kategorien:** Fix · Änderung · Neu · SQL
**Status-Zeichen:**
- 🟡 lokal — liegt nur auf diesem Rechner, nicht committed
- 🔵 gepusht — committed + auf GitHub (`origin/main`), Vercel-Deploy-Stand von hier aus NICHT prüfbar
- 🟢 live — bestätigt aktiv (SQL live ausgeführt, oder Deploy explizit gegengeprüft)

---

## 2026-07-26

- **[Neu]** Öffentliches Changelog auf der Website (📜-Knopf neben "Status") — eigenständig, getrennt vom bestehenden Feedback-/Status-Board. Zeigt kurze, chronologische Einträge (Datum + Kategorie Fix/Neu/Änderung/Balance + Titel + Beschreibung) mit Filter-Chips. Neues Admin-Formular unter admin.html → "Changelog" zum Hinzufügen/Bearbeiten/Löschen. Genau diese Datei hier (`CHANGELOG.md`) ist die interne, technische Fassung für Entwicklung/Nachvollziehbarkeit — das neue Panel auf der Website ist die kurze, öffentliche Fassung für Spieler, beide unabhängig voneinander gepflegt. — `sql/20260726-changelog.sql` (neu, **noch nicht ausgeführt**), `supabase.js`, `js/ui/bkmp-changelog.js` (neu), `index.html`, `admin.html`, `style.css` — 🟡 lokal
- **[Fix]** Runen verschwanden nach normalem Neustart bei sehr großem Runen-Lager (bestätigt: 7.500–15.600 Zeilen bei zwei Spielern) — die Ladeanfrage war unbegrenzt und scheiterte bei jedem Netzwerkfehler, wobei sie das komplette sichtbare Inventar still auf leer zurücksetzte. Kein Datenverlust, keine SQL nötig. Fix: Laden in "ausgerüstet" (immer verlässlich) + "Lager, auf 300 wertvollste gekappt" aufgeteilt, kein stilles Leeren mehr (sichtbarer Hinweis + Retry-Knopf), neuer slot-übergreifender "Alle [Seltenheit] verkaufen"-Sammelverkauf als Präventionswerkzeug. — `supabase.js`, `idledorf.js`, `js/systems/bkmp-runes.js`, `js/core/bkmp-idle-state.js`, `style.css` — 🟡 lokal
- **[Änderung]** Minimieren-Button am Raidboss-Hinweisbanner entfernt (kaum Nutzen, wirkte optisch störend) — Timer/Anmeldestatus bleiben unverändert sichtbar. — `js/systems/bkmp-raid.js`, `style.css` — 🟡 lokal
- **[Fix]** Cache-Busting für `js/core/bkmp-idle-state.js` war bei einem früheren Fix nicht mitgezogen worden — Browser mit noch altem Cache-Stand warfen `ReferenceError: bkmpIdleFlushInFlight is not defined`. Version nachgezogen. — 🟡 lokal
- **[SQL]** `rename_player_account()` aktualisierte `idle_player_runes`/`idle_prestige_state`/`idle_player_village_skins` bisher nicht bei einer Namensänderung — nach einem Umbenennen wurden Runen/Prestige/Dorf-Skins unsichtbar (Daten blieben unter dem alten Namen unangetastet erhalten, kein echter Verlust). Migration + einmaliger Backfill für bereits betroffene Spieler. — `sql/20260725-fix-rename-name-key-propagation.sql` — 🟢 live (per Nachprüfung bestätigt)
- **[Fix]** 4 gemeldete Spieler-Bugs behoben: Runen-Aufstieg ohne Sofort-Speichern-Schutz, Edelstein-Dungeon-Belohnung rundete bei niedrigem Angriff auf 0, Erfolgs-Titel-Bonus wurde nirgends angezeigt, "Effekte An/Aus"-Schalter verschwand ~1s nach dem Öffnen (DOM-Knoten wurde beim zweiten HUD-Render zerstört). — `idledorf.js`, `js/core/bkmp-site.js`, `js/systems/bkmp-dungeon.js`, `js/systems/bkmp-runes.js`, `js/ui/bkmp-hud.js`, `style.css` — 🔵 gepusht

---

*Ältere Änderungen (vor dem 26.07.2026) sind nicht rückwirkend in dieses Format übertragen worden — die vollständige, ausführliche Phasen-/Bugfix-Historie ab dem 17.07.2026 steht weiterhin in `CLAUDE.md`.*
