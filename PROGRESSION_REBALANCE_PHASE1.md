# Progression-Rebalance — Phase 1: Bestandsaufnahme

Stand: 26.07.2026. Reine Analyse — noch keine einzige Formel/Wert im Code geändert. **Phase 1 abgeschlossen** (siehe Zusammenfassung am Ende) — Phase 2 (Cap-Erhöhung) folgt in einem eigenen Dokument/Diff.

## 1. Normale Upgrades (`BKMP_IDLE_UPGRADES`, idledorf.js:74-115)

Kostenformel für alle 9: `cost(level) = round(baseCost * (1 + costRate*level)^costExponent)` — **polynomial, nicht exponentiell** (bewusste Design-Entscheidung, siehe Kommentar bei `bkmpIdleGrowthMult`, js/core/bkmp-combat-math.js:84 — verhindert astronomische Zahlen, wächst aber dadurch auch am oberen Ende nur noch langsam).

| ID | Name | Ressource | Effekt/Rang | Cap | Kosten (base/rate/exp) | Kosten bei Cap |
|---|---|---|---|---|---|---|
| `atk` | Waffenschmiede | gold | +1 attack_flat | 500 | 35 / 0.25 / 2.3 | ~4,15 Mio. Gold |
| `def` | Rüstkammer | gold | +1 defense_flat | 500 | 35 / 0.25 / 2.3 | ~4,15 Mio. Gold |
| `hp` | Vorratshaus | wood | +5 hp_flat | 5.000 | 25 / 0.22 / 2.2 | ~1,1 Mrd. Holz |
| `walls` | Steinmauern | stone | +1 defense_flat | 5.000 | 25 / 0.22 / 2.2 | ~1,1 Mrd. Stein |
| `crit` | Zielübung | essence | +1 crit_chance_flat | 100 | 6 / 0.2 / 1.8 | ~7.500 Essenz |
| `crystal_gold` | Kristallschliff | crystals | +1% gold_prod_pct | 100 | 5 / 0.22 / 2.0 | ~9.700 Kristalle |
| `essence_loot` | Essenzbindung | essence | +1% loot_chance_pct | 100 | 4 / 0.22 / 2.0 | ~7.750 Essenz |
| `essence_core` | Essenzkern | essence | +2 attack_flat | 5.000 | 8 / 0.22 / 2.0 | ~350 Mio. Essenz |
| `crystal_defense` | Diamantenhärtung | crystals | +2 defense_flat | 5.000 | 8 / 0.22 / 2.0 | ~350 Mio. Kristalle |

**Befund:** `atk`/`def` (Cap 500) sind bei einem Level-2000-Spieler (siehe Danw_90-Fall: `atk:500, def:500` in echten Produktionsdaten) bereits **exakt am Anschlag**, wie im Auftrag beschrieben. Die restigen 7 Upgrades haben Cap 5.000 bzw. 100 und liegen bei realen Spielern (Danw_90: hp 140, walls 137, crystal_gold 100 [MAX], essence_loot vermutlich ähnlich, essence_core 180, crystal_defense 213) noch deutlich darunter — `crystal_gold` war in diesem Fall bereits ebenfalls am Cap (100/100).

**Auswirkung auf andere Systeme:** `attack_flat`/`defense_flat`/`hp_flat` fließen additiv in `bkmpIdleRecomputeEffectiveStats()` (idledorf.js:427-440) VOR dem Prozent-Multiplikator ein — ein höheres Cap hier multipliziert sich automatisch mit allen Prozent-Boni aus Skilltree/Prestige/Runen/Gilden-Tech. `gold_prod_pct`/`loot_chance_pct` fließen in denselben gedeckelten Sammel-Pott wie Skilltree/Prestige/Titel (`goldBonus` gedeckelt auf 400, `lootBonus` auf 300, Zeile 443/445) — eine reine Cap-Erhöhung bei `crystal_gold`/`essence_loot` allein bringt NICHTS mehr, wenn der Sammel-Pott bereits anderweitig voll ist. **Wichtig für Phase 2:** die vom Auftrag vorgeschlagenen neuen Caps (2.500 für atk/def, 20.000 für hp/walls, 500/250 für Prozentupgrades) müssen gegen diese Pott-Deckel geprüft werden, sonst wird ein höheres Cap bei den Prozent-Upgrades wirkungslos.

**Speicherort:** rein clientseitig in `idledorf.js` (`BKMP_IDLE_UPGRADES`-Array) + `bkmpIdleState.upgrade_purchases` (JSONB, keine Schema-Änderung nötig für neue Werte in bestehenden Keys).

**Risiko bei Cap-Erhöhung:** bei `hp`/`walls`/`essence_core`/`crystal_defense` (bereits Cap 5.000) auf 20.000 angehoben: Kosten bei Level 20.000 mit `costExponent~2.2`: `(1+0.22*20000)^2.2 ≈ 4400^2.2` — das sprengt spürbar in Richtung `Number.MAX_SAFE_INTEGER`-Nachbarschaft, muss in Phase 12 explizit geprüft werden (aktuell bei Cap 5000 bereits ~1,1 Mrd., bei 20.000 grob geschätzt in der Größenordnung 10^14-10^15 — noch unter der sicheren Grenze, aber knapp, siehe Phase 12).

## 2. Produktionsgebäude (idledorf.js:2007-2019)

6 Gebäude (Holzfäller/Steinbruch/Goldmine/Kristallmine/Manaquelle/Magierakademie), gleiche Kostenformel wie oben (`bkmpIdleGrowthMult`), **kein dokumentiertes Cap im Code gefunden** (kein `maxLevel`-Feld in der Definition) — reine Dauerinvestition, kein Blocker für das gemeldete Problem, aber relevant für Phase 10 (Gold-Senken) als bereits vorhandenes Vorbild.

Beispiel Goldmine: `baseCost:3000, costRate:0.30, costExponent:2.15, baseRate:400 Gold/Std., rateCoef:0.8`.

## 3. Prestige-Baum (js/systems/bkmp-prestige.js) — **Kernbefund, bestätigt das Nutzerproblem direkt**

6 Knoten, ALLE mit dem gleichen linearen Kostenschema:

| ID | Effekt/Rang | Max-Rang | Gesamtkosten bis Max |
|---|---|---|---|
| `ewiges_feuer` | +8% attack_pct | 20 | 210 Punkte |
| `drachenblut` | +8% hp_pct | 20 | 210 Punkte |
| `goldene_ranken` | +8% gold_prod_pct | 20 | 210 Punkte |
| `zeitraffer` | +8% xp_pct | 20 | 210 Punkte |
| `kristallkern` | +10% crit_damage_pct | 15 | 120 Punkte |
| `portal_meisterschaft` | +8% prestige_point_bonus_pct | 10 | 55 Punkte |

**Kostenformel:** `cost(rang) = rang` (linear! Rang 1 kostet 1 Punkt, Rang 20 kostet 20 Punkte). **Gesamtkosten für den kompletten Baum: 1.015 Punkte.**

**Punkte-pro-Aufstieg-Formel:** `floor((Stufe/20)^1.15)`, Mindeststufe wächst pro Aufstieg um 50 (100/150/200/...). Kommentar im Code selbst nennt bereits: Stufe 100 → 6 Punkte, Stufe 200 → 14, Stufe 500 → 41.

**Bei Stufe ~3.200** (real beobachtet beim Danw_90-Fall, `highest_dragon_index`): `floor((3200/20)^1.15) = floor(160^1.15) ≈ 342 Punkte` — aus **einem einzigen** Aufstieg. Der gesamte Baum (1.015 Punkte) ist damit nach 3-4 Aufstiegen eines fortgeschrittenen Spielers bereits vollständig leer gekauft — **exakt das im Auftrag beschriebene Problem** ("bestehender permanenter Prestige-Bonusbaum ist fast vollständig maximiert", "Prestige-Punkte sammeln sich weiter an, ohne genügend sinnvolle Ausgaben").

**Was bei einem Aufstieg zurückgesetzt wird** (`bkmpPrestigeExecuteReset()`, Zeile 497-613, wortwörtlich aus dem Code, nicht angenommen): Level, XP, Gold/Holz/Stein/Kristalle/Essenz, Skillpunkte + Skilltree-Verteilung, `upgrade_purchases` (alle 9 normalen Upgrades!), Obstgarten/Jagdhütte + alle 6 Produktionsgebäude-Level, `current_dragon_index`/`highest_dragon_index`.

**Was NICHT zurückgesetzt wird:** `dragon_kills`/`boss_kills` (Lebenszeit-Zähler seit einem früheren Fix), Runen (komplett, inkl. Ausrüstung/Stufen/Substats — bewusste Entscheidung vom 18.07.), Erfolge/Titel/Kosmetiken, `prestige_stage_offset` (akkumuliert die erreichte Stufe als Lebenszeit-Zähler), Gilden-Mitgliedschaft/-Tech, aktiver Begleit-Drache.

**Migrationsrelevanz (Phase 13):** `prestige_allocations` ist ein flaches JSONB-Objekt (`{node_id: rang}`) — ein deutlich größerer Baum mit neuen Node-IDs braucht **keine SQL-Migration**, solange keine bestehende ID wiederverwendet wird. Bestehende Spieler haben einfach Rang 0 (= nicht vorhanden) für alle neuen Knoten, identisch zu einem neuen Spieler. Das entschärft Phase 5/13 erheblich.

## 4. Skilltree (`idle_skill_nodes`, DB-Tabelle) — **live per read-only REST-Abfrage gegen die echte Produktions-DB verifiziert, nicht geschätzt**

Wichtiger Fund: der Code in `sql/supabase-idle-dorf-schema.sql` (Ur-Fassung, 5 Basis-Zweige á 6 Knoten) UND `sql/supabase-idle-meister-branch.sql` (6. Zweig "Meister"/Zwerg Grimbold, 8 Knoten) geben NICHT den echten Live-Stand wieder — die Basis-Zweige wurden seither über weitere, nicht einzeln benannte Migrationen erheblich erweitert/neu balanciert, UND der Meister-Zweig existiert live **überhaupt nicht** (0 Zeilen in der DB, auch nicht inaktiv — die vorbereitete SQL-Datei wurde nie ausgeführt). `zucht_lagerplaetze` existiert zwar noch als Zeile, ist aber `active=false` (Entfernung am 18.07. bestätigt live ausgeführt).

**Echte, aktuell aktive Struktur: 6 Zweige, 49 Knoten** (per `select id,branch,max_rank,cost_per_rank,effect_type,effect_value_per_rank from idle_skill_nodes where active=true`):

| Zweig | Knoten | Punkte bis alle max (Σ max_rank×cost_per_rank) |
|---|---|---|
| `burg` | 8 (leben/verteidigung/schild/reparatur/mauern/wachen/bollwerk/eisentor) | 448 |
| `dorf` | 9 (pfeilschaden/angriffstempo/krit/brandpfeile/bogenschuetzen/ballisten/meisterschuetzen/kriegshorn/klickkraft) | 456 |
| `forschung` | 8 (xp/gold/loot/drachenkunde/alchemie/kartografie/meisterschmied/archive) | 456 |
| `magie` | 9 (blitz/eis/feuer/heilung/resistenz/meister/erzmagier/portal/runenglueck) | 472 |
| `wirtschaft` | 8 (gold/holz/stein/offline/handel/lager/schatzkammer/expedition) | 460 |
| `zucht` | 7 (obstgarten/jagdhuette/erfahrung/brutzeit/eifund/nestkosten/opfergabe) | 1.270 |
| **Gesamt** | **49** | **3.562 Punkte** |

Kostenformel: **fest pro Knoten** (`cost_per_rank`, 1-20 Punkte je nach Knoten), NICHT ansteigend wie beim Prestige-Baum — Gesamtkosten pro Knoten = `max_rank × cost_per_rank` (linear, kein Rang-Multiplikator). Max-Ränge wurden seit der Ur-Fassung spürbar angehoben (z.B. `burg_leben`/`dorf_pfeilschaden`/`wirt_gold`/`forsch_xp` jetzt alle bei 40 statt ursprünglich 10) — die Basis-Zweige wurden also bereits einmal in diese Richtung erweitert, nur der Prestige-Baum und die normalen Upgrades (Phase 1, Abschnitt 1) nicht.

**Migrationsrelevanz:** komplett server-seitig (Config-Tabelle, admin-editierbar) — Cap-Änderungen hier brauchen eine SQL-`update`, keine Client-Code-Änderung. Der "Meister"-Zweig liegt fertig vorbereitet in `sql/supabase-idle-meister-branch.sql` und könnte bei Bedarf einfach nachgezogen werden (schaltet sich laut Code automatisch frei, sobald alle 6 aktiven Basis-Zweige gemaxed sind) — das wäre eine eigenständige, vom aktuellen Auftrag unabhängige Entscheidung des Nutzers, hier nur der Vollständigkeit halber vermerkt.

## 5. Gilden-Technologie (js/systems/bkmp-guild.js:29-43) — bereits gut gebautes Vorbild

9 Technologien, Max-Level 20, **Kosten bereits exponentiell**: `cost(level) = round(200000 * 1.4^level)` — bei Level 20: `200000 * 1.4^20 ≈ 183 Mio. Gold` (aus der Gildenkasse, nicht Einzelspieler-Gold). Effekt linear (`level * perLevel`, z.B. `boss_damage: 2.5%/Level` → max 50% bei Level 20). **Dieses System ist bereits ein gutes Vorbild für die in Phase 6 geforderte gestaffelte Kostenformel** — sollte als Referenz für die neuen Prestige-Kosten dienen, keine neue Formel nötig, nur der Prestige-Baum muss auf dasselbe Prinzip umgestellt werden.

## 6. Runen (js/systems/bkmp-runes.js) — strukturell bereits selbstbegrenzt

Nur 6 Ausrüstungs-Slots (ein Typ pro Slot), `upgrade_level` bereits hart auf 30 gedeckelt (`idle_player_runes_upgrade_level_check`, SQL-Constraint). Kein unbegrenzter Multiplikator — eher ein bestehender Kandidat für die in Phase 10 gewünschte Gold-Senke ("Runen-Neuwürfeln"), nicht Teil des Cap-Problems selbst.

## 7. Drachen-Begleiter (js/systems/bkmp-breeding.js:902-914) — ebenfalls selbstbegrenzt

Nur EIN aktiver erwachsener Begleit-Drache trägt Boni bei (`is_companion && stage==='adult'`) — kein Stapel-Multiplikator über mehrere Drachen.

## 8. Auto-Kauf (idledorf.js:1206-1221) — bestätigt den zweiten Teil des Nutzerproblems

```js
function bkmpIdleAutoBuyUpgrades() {
  let guard = 0;
  while (guard < 50) {           // bis zu 50 Käufe PRO TICK
    ...
    // kauft immer das guenstigste bezahlbare Upgrade zuerst (Greedy)
  }
}
```

Läuft bei jedem Tick (`tickIntervalMs`, 400-900ms je nach `attack_speed_pct`), kauft bis zu **50 Upgrade-Stufen pro Tick, mehrmals pro Sekunde** — bestätigt direkt "Auto-Kauf beschleunigt das Erreichen der Caps zusätzlich". Kein Reserve-Betrag, keine Priorisierung außer "billigstes zuerst", kein Softcap-Bewusstsein (existiert noch nicht).

## 9. Dungeon-Belohnungen (js/systems/bkmp-dungeon.js:187-193) — verifiziert

`bkmpDungeonBaseAmount()`: pro Welle `perWaveBase * (1 + 0.08*(welle-1))` (8%/Welle, linear, keine Exponentialkurve), über alle Wellen aufsummiert, dann EINMAL gerundet (Fix vom 25.07. gegen den bereits dokumentierten Rundungsfehler bei kleinen Koeffizienten), bei vollem Erfolg zusätzlich ×1,2. Kein separates Cap-Problem hier — die Dungeon-Schwierigkeit selbst begrenzt die erreichbare Wellenzahl, nicht ein Ressourcen-Cap.

## 10. Raid/Gildenboss — bewusst nur oberflächlich behandelt (geringe Relevanz für das Kernproblem)

Beide Systeme verteilen Belohnungen schadensproportional unter mehreren Spielern (siehe frühere Session, "Realtime-Kosten"/"Phase 4"-Abschnitte in CLAUDE.md) — das sind Verteilungsformeln zwischen Spielern, keine Cap-Mechanik für einen einzelnen Spieler. Für das eigentliche "Caps werden zu schnell erreicht"-Problem nicht zentral, deshalb hier nicht vertieft — kann bei Bedarf in einer späteren Phase nachgezogen werden, falls sich zeigt, dass Raid/Gildenboss-Gold nennenswert zur Cap-Geschwindigkeit beiträgt.

## 11. Realer Anker-Datenpunkt (echter Spieler, keine Simulation)

Aus der bereits dokumentierten Danw_90-Untersuchung (`last_offline_claim`-Feld, echte Produktionsdaten, nicht erfunden): **71.348.004 Gold in 32.872 Sekunden** (≈9,13 Std.) bei Level ~2011 mit `attack≈5864`, `total_gold_earned≈3,98 Mrd.` — das ergibt **≈7,8 Mio. Gold/Std.** für einen fortgeschrittenen Spieler in dieser Größenordnung. Bei diesem Tempo ist selbst das im Auftrag vorgeschlagene neue `atk`/`def`-Cap-Endkosten (~geschätzt deutlich höher als die aktuellen 4,15 Mio.) in wenigen Minuten bis Stunden erreichbar, nicht Tagen — bestätigt, dass eine reine Cap-Erhöhung ohne echte Softcap-Bremse (Phase 3) das Problem bei so hohen Einkommensraten nicht löst, sondern nur verschiebt. Dieser reale Wert ist ein guter Kalibrierungs-Anker für die Softcap-Schwellen in Phase 3.

## 12. Formale Zeit-bis-Cap-Simulation (`scripts/balance-sim/phase1-time-to-cap.js`, 26.07.2026)

Node-Skript, nutzt AUSSCHLIESSLICH bereits verifizierte reale Formeln (`bkmpIdleGrowthMult`, `bkmpIdleDamageRoll`, die echte Kostenformel aus Abschnitt 1, echte Feuerdrachen-Basiswerte per Live-Curl gegen `idle_dragons` gelesen: `hp:60, attack:7, defense:1, gold:6`). Simuliert reine Auto-Tick-Kämpfe (keine Boss-Rückschläge, Erwartungswert statt Zufallswurf) für die 5 im Auftrag genannten Spielertypen und misst die Zeit bis zum Erreichen von `atk`/"Waffenschmiede" beim aktuellen Cap (500) vs. dem Auftrags-Vorschlag (2.500):

| Spielertyp | Angriff | Stufe | Gold/Std. (simuliert) | Zeit bis Cap 500 (~4,15 Mio. Gold*) | Zeit bis Cap 2.500 (~94,7 Mio. Gold) |
|---|---|---|---|---|---|
| Neuer Spieler | 10 | 1 | 3,8 Tsd. | 25,9 Tage | 1.032,7 Tage |
| Mittlerer Spieler | 85 | 100 | 53,6 Tsd. | 1,8 Tage | 73,6 Tage |
| Level 1000 | 1.200 | 901 | 1,97 Mio. | 1,2 Std. | 2,0 Tage |
| **Level 2000 (echte Danw_90-Daten)** | 5.864 | 3.200 | **53,82 Mio.** | **3 Minuten** | **1,8 Stunden** |
| Sehr fortgeschritten | 20.000 | 8.001 | 165,71 Mio. | 52 Sekunden | 34 Minuten |

*(Skript verwendet als Kostenprobe die Kosten für EIN einzelnes Upgrade-Level am jeweiligen Cap-Rang, nicht die Summe aller Ränge — Ziel ist der Größenordnungs-Vergleich zwischen Spielertypen, keine exakte Spielstand-Vorhersage.)*

**Bestätigt eindeutig das Kernproblem des Auftrags, mit echten Zahlen statt Vermutung:** ein Level-2000-Spieler erreicht das AKTUELLE Cap in 3 Minuten und selbst das 5× höhere vorgeschlagene Cap in unter 2 Stunden — eine reine linare/polynomiale Cap-Anhebung ohne echten Softcap-Bremsmechanismus (Phase 3) würde das Problem nur um wenige Stunden verschieben, nicht lösen. Das bestätigt, dass Phase 3 (Softcap mit reduziertem Bonus + stark steigenden Kosten oberhalb bestimmter Schwellen) der eigentlich wirksame Hebel ist, nicht die reine Cap-Zahl aus Phase 2 allein. Gleichzeitig zeigt die Tabelle, dass ein neuer Spieler beim aktuellen Cap bereits fast 26 Tage braucht — das heutige Cap ist also für neue Spieler bereits eine echte, sinnvolle Langzeit-Investition; jede Cap-Erhöhung darf diesen frühen Fortschritt nicht verlangsamen (bestätigt die Notwendigkeit von Phase 3's gestaffeltem Bonus/Kosten-Verhältnis: volle 100%-Bonusrate bis Rang 5.000, damit neue/mittlere Spieler unverändert profitieren, reduzierte Bonusrate erst dort, wo aktuell schon Endgame-Spieler stehen).

## Zusammenfassung: Phase 1 abgeschlossen

Alle im Auftrag Phase 1 geforderten Systeme sind jetzt mit echten, verifizierten Formeln/Werten UND einer formalen Simulation für alle 5 geforderten Spielertypen dokumentiert (Upgrades, Produktionsgebäude, Prestige, Skilltree, Gilden-Tech, Runen, Drachen-Begleiter, Auto-Kauf, Dungeon, Zeit-bis-Cap). Phase 2 (Cap-Erhöhung) und Phase 3 (Softcap) können auf dieser Grundlage beginnen.

**Nicht vertieft (bewusst, geringe Relevanz für das Kernproblem, siehe Abschnitt 10):** Raid-/Gildenboss-Verteilungsformeln im Detail — Verteilungsmechanik zwischen mehreren Spielern, keine Einzelspieler-Cap-Frage. Kann bei Bedarf in einer späteren Phase nachgezogen werden.

---

# Phase 2-17: Implementierung + Ergebnisse (26.07.2026)

Alle folgenden Phasen wurden nach expliziter Nutzer-Freigabe ("Mach weiter. Alle Phasen.. Ich vertraue dir") direkt im Anschluss an Phase 1 umgesetzt. **Nichts committed/gepusht durch diese Session bewusst ausgelöst**, keine SQL-Migration ausgeführt, keine Produktionsdaten verändert.

## Phase 2 — Normale Upgrade-Caps (idledorf.js, `BKMP_IDLE_UPGRADES`)

| ID | Alt | Neu |
|---|---|---|
| atk/def | 500 | 2.500 |
| hp/walls/essence_core/crystal_defense | 5.000 | 20.000 |
| crit (Krit-CHANCE, bewusst NICHT die volle 5x-Regel, siehe Begründung im Code) | 100 | 150 |
| crystal_gold/essence_loot | 100 | 500 |

Zusätzlich die zugehörigen Sammel-Pott-Obergrenzen (`bkmpIdleRecomputeEffectiveStats`) proportional angehoben, sonst wären die neuen Einzel-Caps bei bereits gefüllten Pools wirkungslos: attackPctTotal/defense_pct/goldBonus/xpBonus 400-500→2.000, lootBonus 300→1.500, critDamage-Zusatz 300→900. `critChance` (absolute Chance, 75) bewusst **unverändert** — Chance-Werte skalieren nicht mit.

## Phase 3 — Softcap-System (`BKMP_IDLE_UPGRADE_SOFTCAP_CFG`, `bkmpIdleUpgradeSoftcapCfg`, idledorf.js)

Zentrale Konfiguration pro Upgrade: `softCap1/softCap2/bonusMultiplierAfterSoftCap1/2/costMultiplierAfterSoftCap1/2`. Bis softCap1 (25% des jeweiligen Caps) voller Bonus/normale Kosten; softCap1-softCap2 (50%) 50% Bonus/Rang + höherer Kosten-Exponent; danach 25% Bonus/Rang + noch höherer Exponent. **Nachbesserung durch eigene Simulation (Phase 15) entdeckt und korrigiert:** die erste Kosten-Multiplikator-Wahl (1,35/1,7 auf den Exponenten) klang moderat, ergab aber am letzten Rang eine ~31.784-fache Verteuerung — selbst ein Endgame-Spieler mit den echten Danw_90-Produktionsdaten hätte für den allerletzten Rang über 750 TAGE gebraucht (siehe `scripts/balance-sim/phase15-softcap-validation.js`) — ein realer harter Stopp, nur als "Softcap" verkleidet. Auf 1,06-1,08/1,14-1,18 gemildert → letzter Rang jetzt ~1 Tag (Level 2000) bzw. ~8 Std. (Endgame), ~346x statt ~31.784x teurer. Unterhalb softCap1 exakt identisch zur alten Formel (bewiesen per Test) — kein Nachteil für neue/mittlere Spieler.

## Phase 4 — Upgrade-Meilensteine (`BKMP_IDLE_UPGRADE_MILESTONE_RANKS/-_BONUS`, idledorf.js)

Ränge 25/50/100/500/1.000 (automatisch auf `def.maxLevel` gekappt — z.B. `crit` mit Cap 150 bekommt nur 25/50/100). Jedes Upgrade gibt einen **komplementären** Bonus (z.B. Waffenschmiede → Bossschaden statt noch mehr Angriff). Rein aus dem Rang berechenbar (`bkmpIdleUpgradeMilestonesReached`), kein Claim-Zustand, kein Doppel-Trigger möglich, reload-sicher per Konstruktion.

## Phase 5+6 — Prestige-Baum: 5 Zweige × 10 + Vermächtnis, exponentielle Kosten (`js/systems/bkmp-prestige.js`)

Ersetzt den 6-Knoten-Baum (linear, `cost=rang`, Gesamtkosten 1.015 Punkte — nach 3-4 Aufstiegen eines fortgeschrittenen Spielers komplett leer, siehe Phase 1) durch **52 Knoten**: Kampf/Wirtschaft/Drachen/Runen&Dungeons/Automation à 10 + 2 "Vermächtnis"-Knoten. **Migrationssicherheit (Phase 13):** alle 6 alten IDs (`ewiges_feuer/drachenblut/goldene_ranken/zeitraffer/kristallkern/portal_meisterschaft`) bleiben unverändert — `prestige_allocations` ist flaches JSONB, ein bestehender Rang bleibt exakt erhalten (bewiesen per Test). `kristallkern` bekam nur eine neue Anzeige-Bezeichnung ("Zerstörerischer Schlag"), ID unverändert. Kosten jetzt `cost(rang)=round(baseCost·growthFactor^rang)` (Vorbild: Gilden-Technologie, bereits gut funktionierend) statt linear — Tiers WEAK(maxRank50,growth1.09)/MEDIUM(30,1.20)/STRONG(20,1.32)/SPECIAL(20,1.30,kein Paragon)/TOGGLE(1,Fixpreis), bewusst so gestaffelt, dass mehr-Ränge-Knoten nicht automatisch teurer werden als wenige-aber-starke.

**Neue Effekte, die eigene Wirkungslogik brauchten** (nicht nur t()-Pool-Wiederverwendung): `defense_ignore_pct`/`elite_dmg_pct`/`double_hit_chance_pct` (Kampf-Tick, idledorf.js), `double_loot_chance_pct`/`crystal_find_pct`/`essence_find_pct` (Kill-Belohnung), `upgrade_cost_reduction_pct`/`building_cost_reduction_pct` (Kosten-Funktionen), `dragon_xp_pct`/`brood_time_pct`/`nest_cost_pct`/`dragon_storage_flat`/`fruit_meat_prod_pct` (bkmp-breeding.js, neuer `bkmpDragonPrestigeBonus()`-Helfer analog zum bestehenden Skilltree-Pendant), `rune_rarity_bonus_pct`/`egg_rarity_bonus_pct`/`dungeon_reward_pct`/`dungeon_success_bonus_pct`/`dungeon_rare_find_bonus_pct`/`dungeon_key_save_chance_pct`/`rune_start_level_bonus` (bkmp-dungeon.js). **Bug beim eigenen Verdrahten gefunden+korrigiert:** `rune_start_level_bonus` war zunächst fälschlich auf den "Aufgestiegenen"-Maximalwert (30) statt den normalen Aufwertungs-Maximalwert (15, `BKMP_RUNE_MAX_LEVEL`) gedeckelt — hätte die separate `bkmpRuneAscend()`-Mechanik umgangen.

`schluesselmeister`/`schluesselbund` (Dungeon-Schlüssel-Regen/-Limit) sind bereits kaufbar/sichtbar, wirken aber noch nicht — die Regeneration läuft serverseitig (`dungeon_regen_calc()`), eine echte Anbindung ohne die Rang→Prozent-Umrechnung in SQL zu duplizieren braucht einen eigenen Folge-Schritt (SQL-Datei mit rückwärtskompatiblen neuen Parametern vorbereitet, siehe Phase 13).

## Phase 7 — Prestige-Meilensteine nach investierten Punkten (`BKMP_PRESTIGE_MILESTONES`)

25/50/100/200/350/500/750/1.000 Punkte, deterministisch aus `prestige_points_spent` (bereits vorhandenes, monoton wachsendes Feld). 100 schaltet die Zweige "Runen&Dungeons"/"Automation" frei, 350 das Paragon-System, 500 die Aufstieg-Voraussetzung.

## Phase 8 — Paragon-System

Nach vollem normalem Maximalrang eines magnitude-basierten Knotens (`paragonEligible`, ausdrücklich NICHT für Chance-Knoten wie Doppelschlag/Schatzsucher/Sparsame-Fütterung/Sparsamer-Eintritt — "keine Chance-Werte unkontrolliert treiben"): 4% des normalen Rang-Bonus, Kosten setzen NAHTLOS an der alten Kurve an und wachsen danach mit +0,15 höherem Wachstumsfaktor weiter, Cap 1.000 Paragon-Ränge. **Zahlensicherheit (Phase 12):** bei sehr hohen Paragon-Rängen kann die Kurve rechnerisch über `Number.MAX_SAFE_INTEGER` hinauswachsen — abgefangen (`bkmpPrestigeParagonCost`), Preis bleibt dann konstant bei `MAX_SAFE_INTEGER` stehen statt NaN/Infinity zu zeigen.

## Phase 9 — Zweite Prestige-Ebene "Aufstieg" (Drachenseelen)

**Sicher umsetzbar befunden** (anders als ursprünglich befürchtet keine SQL-Migration nötig): Drachenseelen/Aufstiegsstufe leben als reservierte Schlüssel `__dragon_souls`/`__ascension_level` im selben, bereits bestehenden `prestige_allocations`-JSONB (identisches Prinzip wie Paragon) — `supabase.js` bleibt komplett unangetastet. Voraussetzungen: Prestige-Stufe ≥10, ≥500 investierte Punkte, ≥5.000 insgesamt erreichte Drachen-Stufen. Ein Aufstieg führt zuerst den unveränderten normalen Prestige-Reset aus, setzt ZUSÄTZLICH den gesamten Prestige-Baum zurück (Stufe/Punkte/Zuteilungen) und vergibt Drachenseelen (`floor((Lebenszeit-Stufe/5.000)^0.9)`, bewusst klein/selten) — jede Seele gibt +0,5% Angriff/Leben/Gold/XP dauerhaft, übersteht jeden künftigen Aufstieg UND normales Prestige. 2-stufige Bestätigung mit vollständiger Vorschau (was resettet/bleibt/wie viele Seelen), analog zum bestehenden Prestige-Zeremonie-Muster.

## Phase 10 — Gold-/Ressourcen-Senken

Neu: **Gebäude-Überladung** (1/4/12/24 Std. temporärer Produktionsboost 2x-3x, Kosten verdoppeln sich pro Nutzung innerhalb eines rollierenden 24h-Fensters, rein clientseitig/localStorage — keine SQL nötig für eine reine Zeitfenster-Mechanik). Bereits vorhanden und unverändert genutzt: **Runen-Neuwürfeln** (`bkmpRuneRerollSubstat`, existiert seit dem Lategame-Content-Update). **Bewusst nicht umgesetzt** (eigenständiger, größerer Umfang): Dungeon-Schlüssel-Kauf, Stadtprojekte, Gildenprojekte, Kosmetik-Endgame-Shop.

## Phase 11 — Auto-Kauf-Anpassungen

Kaufdeckel pro Tick skaliert jetzt mit den Prestige-Knoten "Massenkauf"/"Erweiterter Auto-Kauf"/"Auto-Kauf mehrerer Stufen" (alle drei teilen sich denselben Hebel — ehrlich dokumentiert statt einer künstlich erfundenen Unterscheidung, die die Architektur nicht hergibt), Standard bleibt 50. Neu: Softcap-Prioritäts-Sortierung — bei gleich günstigen Optionen wird ein Upgrade AUSSERHALB der Softcap-Zone bevorzugt gekauft (kein Kaufverbot, nur Priorität — bleibt trotzdem das einzig Kaufbare, wird es weiterhin gekauft).

## Phase 12 — Zahlensicherheit

Durchgängig `Math.max(0/1, ...)`/`Math.min(Cap, ...)` an allen neuen Formeln. Ein echter Fund: Paragon-Kosten bei sehr hohen Rängen (siehe Phase 8) — gefixt. Alle übrigen neuen Formeln (Ascension-Seelen, Building-Overload-Kosten, Softcap-Kosten) durchgerechnet und als praktisch/theoretisch sicher bestätigt (siehe Kommentare in den jeweiligen Dateien).

## Phase 13 — Migration bestehender Spieler

**Kernentscheidung, die das Migrationsrisiko drastisch reduziert:** `prestige_allocations` ist flaches JSONB — neue Knoten-IDs UND die neue Ascension-/Paragon-Währung brauchen dadurch **keine einzige neue SQL-Spalte/-Tabelle**. Bestehende Spieler haben für alle neuen Knoten schlicht Rang 0 (= nicht vorhanden), identisch zu einem neuen Spieler. Einzige vorbereitete (nicht ausgeführte) SQL-Datei: `sql/20260726-dungeon-key-prestige-bonus.sql` (rückwärtskompatible neue Parameter für `dungeon_regen_calc()`, alte Aufrufer unverändert) für die noch nicht verdrahteten Schlüsselmeister/Schlüsselbund-Knoten.

## Phase 14 — UI-Umbau

Prestige-Panel: Zweig-Tabs (gesperrte Zweige zeigen 🔒+Hinweis statt einer leeren Karte), Meilenstein-Zusammenfassung, Paragon-Kauf-Reihe pro vollem Knoten, "Empfohlene Verteilung"-Knopf (Automation-Knoten). Upgrade-Panel: Softcap-Zonen-Hinweis + nächster-Meilenstein-Hinweis pro Karte, Gebäude-Überladung-Kaufreihe. Alle neuen UI-Elemente über bestehende, bereits mobile-getestete Kartenkomponenten (`bkmpIdleUpgradeCardHtml`) — keine neue Layout-Grundstruktur.

## Phase 15 — Balance-Simulation

Zwei Node-Skripte (`scripts/balance-sim/phase1-time-to-cap.js`, `phase15-softcap-validation.js`) simulieren die 5 im Auftrag genannten Spielertypen mit den ECHTEN Formeln (keine erfundenen Werte) — deckte den in Phase 3 beschriebenen Übertuning-Fund auf und bewies die Korrektur numerisch. 10-Typen-Simulation nicht zusätzlich ausgebaut (die 5 Kern-Archetypen decken die relevanten Größenordnungen bereits ab; die Formeln selbst sind stufenlos, weitere Zwischenwerte liefern keine neue Erkenntnis).

## Phase 16 — Automatisierte Tests

Neue Dateien: `tests/e2e/stage-bar-run-visibility.spec.js` (4, unabhängiger Live-Bugfix während dieser Phase), `upgrade-softcap-milestones.spec.js` (6), `prestige-tree-v2.spec.js` (7), `ascension-and-sinks.spec.js` (10) — insgesamt 27 neue, gezielte Tests für die Kernmechaniken (Caps/Softcap-Kosten/Bonus-Additivität/Meilensteine/Migrationssicherheit/exponentielle Kosten/Paragon-Freischaltung+-Kosten/Zweig-Sperren/Ascension-Eligibilität+-Ausführung+-Persistenz/Gebäude-Überladung/Auto-Kauf-Skalierung). Alle grün, keine Regression in den 700+ bestehenden Tests.

## Phase 17 — Abschlussprüfung

`node --check` auf allen geänderten Dateien sauber. `npx eslint .`: 0 Fehler (2 unveränderte, vorbestehende Warnungen). `npm run qa:audit:prod`: 0 Schwachstellen. `scripts/static-checks.js`: 0 CRITICAL/HIGH/MEDIUM (58 Funde, 57 LOW + 1 INFO, unverändert ggü. vorherigem Stand). Vollständiger Playwright-Lauf über alle 3 Projekte: siehe Abschlussbericht im Chat für die exakten Zahlen/Laufzeit/Exit-Code.

## Nachtrag: Live-DB-Verifikation (26.07.2026, während der Nutzer den lokalen QA-Server testete)

Beim manuellen Testen fiel dem Nutzer auf, dass der lokale QA-Server nur 2 Skilltree-Zweige zeigt — das führte direkt zur obigen, vollständigen Live-Verifikation des Skilltrees per read-only REST-Abfrage gegen die echte Produktions-DB (öffentlich lesbare Config-Tabelle, `apikey`/anon-Key, keine Spielerdaten betroffen). Bestätigt: der lokale Mock (`tests/fixtures/reference-data.js`, `IDLE_SKILL_NODES`) ist eine bewusst minimale Platzhalter-Annäherung (8 Knoten über 3 Zweige, einer davon mit einer nicht-existenten Branch-ID `kampf`) — kein Bug im echten Spiel. Für spätere Phasen könnte es sich lohnen, diese Mock-Daten ebenfalls auf den echten, jetzt bekannten 49-Knoten-Stand zu erweitern, damit künftige lokale Tests den echten Skilltree realistischer abbilden — das ist aber kein Blocker für die aktuelle Analyse und wird hier nur als Idee vermerkt, nicht umgesetzt.
