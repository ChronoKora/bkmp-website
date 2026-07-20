// Bkmp - Redesign Phase 2a (17.07.): mechanisch aus idledorf.js extrahiert (mit einem AST-Parser exakt abgegrenzt, keine Logik veraendert). js/core/bkmp-idle-state.js

/* ============================================================
   Bkmp - Idle Drachen Dorf
   Idle-Kampfspiel-Erweiterung des bestehenden Gamification-Systems.
   Wird von index.html UND admin.html geladen (Admin braucht dieselbe
   Kampf-Mathematik fuer den Testkampf-Simulator).

   Ladereihenfolge (siehe <script>-Tags): supabase-js -> supabase.js ->
   app.js -> idledorf.js -> grosses Inline-Script. D.h. Funktionen wie
   escapeHtml(), bkmpGetSupabaseClient() sind hier bereits verfuegbar,
   aber bkmpGetMcName()/BKMP_ACHIEVEMENTS/renderAchievementBadge() erst
   NACH diesem Skript - deshalb werden sie hier nie am Top-Level,
   sondern nur innerhalb von Funktionen referenziert, die erst durch
   spaetere Nutzerinteraktion (Klick) oder per setTimeout(0) aufgerufen
   werden.
   ============================================================ */

/* ---------------- Wartungsmodus ----------------
   Notschalter bei akuten Problemen: Schalter liegt in Supabase
   (site_flags.idle_maintenance, siehe supabase-site-maintenance-flag.sql)
   und ist im Admin-Panel jederzeit ohne Deploy umschaltbar. bkmpIdleState
   des Wartungsmodus wird per Polling (alle 20s) aktuell gehalten; ist ein
   Tab GERADE OFFEN und der Schalter springt von aus auf an, wird der Tab
   automatisch neu geladen, damit auch schon aktive Spieler sofort die
   Wartungsmeldung sehen (nicht erst beim naechsten eigenen Klick). Fail
   closed: bis die erste DB-Antwort da ist bzw. falls die Abfrage fehlschlaegt,
   gilt das Idle-Dorf als gesperrt - ein Netzwerkfehler soll nie versehentlich
   ein kaputtes Spiel freigeben. */
const BKMP_IDLE_MAINTENANCE_FALLBACK_MESSAGE = 'Das Idle Drachen Dorf ist gerade kurz für Wartungsarbeiten pausiert. Es geht bald weiter, bitte versuch es später nochmal.';
let bkmpIdleMaintenanceKnown = false;
let bkmpIdleMaintenanceActive = true;
let bkmpIdleMaintenanceMessage = BKMP_IDLE_MAINTENANCE_FALLBACK_MESSAGE;

/* bkmpIdleMaintenanceBaseline haelt den Stand fest, den DIESER Tab beim
   allerersten Check dieser Seite gesehen hat (egal ob an oder aus - ein
   frisch geladener Tab zeigt den aktuellen Stand ja bereits korrekt an,
   braucht also KEIN Reload). Reload wird nur ausgeloest, wenn ein SPAETERER
   Poll eine echte Aenderung gegenueber der Baseline erkennt (aus -> an) -
   sonst wuerde jeder frische Seitenaufruf waehrend eines laufenden
   Wartungsmodus sich selbst sofort neu laden, was nur unnoetig flackert. */
let bkmpIdleMaintenanceBaseline = null;

/* ---------------- State ---------------- */

let bkmpIdleState = null;
let bkmpIdleLoadFailed = false;
let bkmpIdleDragonDefs = [];
let bkmpIdleSkillDefs = [];
let bkmpIdleConfig = {};
let bkmpIdleCurrentDragon = null;
let bkmpIdleLastCounterAttackAt = 0;
let bkmpIdleVillageHp = null;
let bkmpIdleEffectiveStats = null;
let bkmpIdleLoopTimer = null;
let bkmpIdleLoopTimerMs = 900;
let bkmpIdleModalOpen = false;
let bkmpIdleSyncPending = false;
let bkmpIdleSyncTimer = null;
let bkmpIdleLastSaveFailToastAt = 0;
let bkmpIdleConfigLoaded = false;
/* Sieg-Status der seltenen Event-Drachen (siehe supabase-idle-event-
   dragons.sql), unabhaengig von bkmpIdleState geladen (eigene Tabelle,
   eigenes try/catch - gleiches Vorsichtsprinzip wie beim Prestige-Stand).
   bkmpIdleEventPauseActive haelt den KOMPLETTEN Kampf an, solange das
   Vorbereitungs-Popup noch nicht bestaetigt wurde (siehe
   bkmpIdleMaybeShowEventDragonPopup). */
let bkmpIdleEventDragonState = null;
let bkmpIdleEventPauseActive = false;

/* Welche Zweige gerade aufgeklappt sind - persistiert ueber wiederholte
   Render-Aufrufe hinweg (nach jedem +1-Klick und nach Reset wird die ganze
   Panel-HTML neu gebaut), damit ein einmal manuell geoeffneter/geschlossener
   Zweig nicht bei der naechsten Punktevergabe wieder zuklappt. null = noch
   nie initialisiert -> alle Zweige starten zugeklappt (siehe Kommentar
   weiter unten - Spieler-Wunsch 13.07., vorher klappte "Dorf" immer
   automatisch auf). */
let bkmpIdleSkillBranchOpenState = null;
let bkmpIdleActiveLeaderboardTab = 'level';
let bkmpIdleLeaderboardStats = [];

/* Schnappschuss der "ausgebbaren" Felder - Referenzpunkt fuer den
   Differenz-Merge in bkmpIdleMergeRemoteSpendableFields (siehe dort). Wird
   nach jedem frischen Laden UND nach jedem erfolgreichen Merge neu gesetzt. */
let bkmpIdleMergeBaseline = null;

/* Kernstueck der Twitch-Sync-Nachbesserung (Nutzerwunsch 15.07.): laeuft
   NUR auf der Twitch-Seite (window.BKMP_IDLE_IS_STREAM_PAGE) - VOR jedem
   eigenen Autosave (siehe bkmpIdleFlushSync) UND zusaetzlich alle ~20s im
   Herzschlag-Takt (siehe bkmpIdleStreamStartHeartbeat), damit ein Kauf auf
   der Hauptseite auch dann sichtbar wird, wenn gerade kein Drache stirbt
   und deshalb kein eigener Autosave anstuende. Holt den aktuellen DB-Stand
   und gleicht die "ausgebbaren" Felder ab, BEVOR der eigene (evtl. veraltete) Stand
   ueberschrieben wird:
   - Ressourcen (Gold/Holz/Stein/Kristalle/Essenz): Differenz-Merge - die
     Twitch-Seite verdient laufend durch Kaempfe dazu, die Hauptseite gibt
     evtl. etwas aus. remote-Wert (frischer DB-Stand) + eigener Zuwachs
     seit dem letzten Abgleich (bkmpIdleMergeBaseline) = korrektes Ergebnis
     in beide Richtungen, ohne dass eine Seite die andere blind ueberschreibt.
   - Upgrade-Stufen/Skillpunkt-Verteilung: Maximal-Merge pro Schluessel
     (siehe bkmpIdleMergeCountMaps) - beide Seiten koennen nur kaufen/
     verteilen, nie verringern (ausser bei einem Prestige-Aufstieg, der
     ueber bkmpIdleFlushSyncNow sofort speichert und den Basiswert direkt
     danach neu setzt - kein Konflikt mit diesem Abgleich).
   - skill_points_spent: gleiche Differenz-Logik wie Ressourcen, danach
     wird skill_points_available so nachgerechnet, dass die Gesamtsumme
     (verfuegbar+ausgegeben) nie kleiner wird als auf beiden Seiten bekannt. */
/* FEHLER-FIX (Streamer-Report DerLiber, 13.07.: "manchmal bricht er den
   Kampf ab, springt zurueck" - Stufe sprang z.B. von 25-4 auf 24-8 zurueck,
   Auto-Aufstieg schaltete sich von selbst aus): der Herzschlag (alle 20s,
   siehe bkmpIdleStreamStartHeartbeat) und der kill-ausgeloeste Autosave
   (siehe bkmpIdleFlushSync) konnten diese Funktion GLEICHZEITIG aufrufen.
   `baseline` wird HIER UNTEN erst NACH dem "await loadIdlePlayerState(...)"
   gelesen - lief waehrenddessen ein ZWEITER, schneller abgeschlossener
   Aufruf komplett durch (eigener Merge + bkmpIdleSnapshotMergeBaseline()),
   sah der ERSTE (langsamere) Aufruf beim Aufwachen eine BEREITS
   AKTUALISIERTE globale Baseline, obwohl sein eigenes `remote` noch der
   ALTE, vor dem zweiten Aufruf geladene DB-Stand war - localStage schien
   dadurch faelschlich "seit der Baseline unveraendert", obwohl in
   Wirklichkeit laengst mehrere Stufen weiter gekaempft wurde, und der
   veraltete `remote`-Stand wurde faelschlich als neuer lokaler Stand
   uebernommen (echter Rueckschritt). Fix: nur EIN Abgleich gleichzeitig -
   ueberlappende Aufrufe werden einfach uebersprungen, der naechste
   turnusmaessige Aufruf (spaetestens 4s/20s spaeter) holt konsistent nach. */
let bkmpIdleMergeInFlight = false;

/* FEHLER-FIX (Spieler-Report 15.07.: "Die Upgrades reseten sich jedesmal
   wenn ich was upgrade") - der Merge-Abgleich lief bisher nur alle 15s
   (throttled). Die Twitch-Seite speichert aber bei aktivem Kampf viel
   oefter (alle ~4s, nach JEDEM Drachen-Kill via bkmpIdleQueueSync) - in den
   Luecken DAZWISCHEN schrieb sie weiterhin blind ihren eigenen (noch nicht
   abgeglichenen) Stand in die DB und hat damit einen frisch auf der
   Hauptseite gekauften Upgrade praktisch sofort wieder ueberschrieben.
   Der Merge muss deshalb bei JEDEM einzelnen Speichervorgang der Twitch-
   Seite laufen, nicht nur gelegentlich - bkmpIdleSkipNextMerge ist die
   einzige bewusste Ausnahme (siehe bkmpIdlePerformPrestige: ein Aufstieg
   IST der Reset, der soll die DB unbedingt ueberschreiben statt mit einem
   moeglicherweise noch alten Remote-Stand verschmolzen zu werden). */
let bkmpIdleSkipNextMerge = false;

/* Bug-Fix 20.07. (Spieler-Report ChronoKora: "wieder 90 Min./15 Min. keine
   AFK-Belohnung bekommen") - siehe ausfuehrlichen Kommentar bei
   bkmpIdleFlushSync() in idledorf.js fuer die volle Erklaerung des
   verbleibenden Wettlaufs, den der reine Timer-Abbruch
   (bkmpIdleCancelPendingSyncTimer) NICHT zuverlaessig gewinnen konnte.
   Zeitstempel statt reinem Bool, damit die Sperre IMMER von selbst nach
   spaetestens 15s ausläuft, selbst wenn keiner der Aufrufer sie je aktiv
   zuruecksetzt (kein "fuer immer blockiert"-Risiko). */
let bkmpIdleLastSeenSyncBlockedUntil = 0;

let bkmpIdlePlayerRunes = [];
let bkmpIdlePendingRuneDrops = [];
let bkmpIdleRuneSyncTimer = null;
/* Bug-Fix 20.07. (Spieler-Report "Bärli": Runen nach kurzem Raus-/
   Reintappen wieder unausgeruestet) - siehe bkmpRunePersistEquip() in
   js/systems/bkmp-runes.js fuer die volle Erklaerung. Map von rune.id auf
   den zuletzt gewuenschten equipped-Wert, solange die Schreibanfrage noch
   nicht bestaetigt zurueck ist. */
let bkmpRunePendingEquipWrites = new Map();
let bkmpPlayerDragonEggs = [];
let bkmpPlayerDragonNests = [];
let bkmpPlayerDragons = [];

/* ---------------- Dorf-Skins ----------------
   Reskin nur fuers PERSOENLICHE Dorf-Sprite im Kampf-Tab
   (.idle-village-sprite) - die geteilte Raid-Stadt (.raid-city-sprite)
   ist ein eigenes, gemeinsames Bild fuer den ganzen Server-Raid und wird
   hier bewusst NICHT mit angefasst.

   Freischaltung (Nutzervorgabe 13.07.): hauptsaechlich Kauf mit Gold/
   Kristallen, aber einzelne Skins koennen laut unlock_type auch per
   Achievement oder Boss-Drop freigeschaltet werden - diese zwei Wege
   bekommen noch keine automatische Trigger-Logik, bis der Spieler pro
   Skin mitteilt, welche Bedingung genau gelten soll (siehe SQL-Kommentar
   in supabase-idle-village-skins.sql). Das Grundgeruest (Katalog laden,
   Besitz pruefen, kaufen, ausruesten, Sprite live tauschen) steht schon,
   damit neue PNGs direkt als weitere Katalog-Zeilen eingehaengt werden
   koennen, sobald sie fertig sind. */
let bkmpVillageSkinsCatalog = [];
let bkmpPlayerVillageSkins = [];
let bkmpIdleActiveTab = 'kampf';

/* Haelt Tabs, deren Inhalt (Kauf-Buttons/Runen-Lager) von automatischen
   Kaempfen im Hintergrund abhaengt, waehrend des Zusehens live aktuell -
   vorher aenderte sich z.B. ein "zu teuer"-Button erst nach manuellem
   Tab-Wechsel zu "kaufbar", und neu gedroppte Runen tauchten im offenen
   Runen-Fenster erst nach dem Wechsel weg-und-zurueck auf (Spieler-Meldung:
   "Aktualisieren sich nicht im Runen fenster automatisch.. erst nach tab
   switch" / "Kann man in dem Runenfenster bleiben und beobachten wenn sie
   gedropt werden?"). Bewusst NICHT alle Tabs bei jedem Kill neu rendern
   (z.B. Skilltree zeichnet zusaetzlich SVG-Linien per getBoundingClientRect,
   das waere bei hoher Angriffsgeschwindigkeit unnoetig teuer) - nur die drei
   Tabs, deren Anzeige tatsaechlich direkt von Gold/Ressourcen/Runen-Lager
   abhaengt, die sich durch einen Kill aendern koennen. */
/* Throttle (Perf-Audit 15.07.): bei hoher Angriffsgeschwindigkeit kann
   diese Funktion deutlich unter 900ms pro Kill erneut aufgerufen werden -
   ohne Bremse baute der aktive Tab (v.a. Runen/Drachen mit grossem
   Lager/Roster) dann mehrfach pro Sekunde komplett neu, spuerbares
   Ruckeln waehrend aktivem Kampf. Sofort-Rendern beim ersten Aufruf
   (kein gefuehltes Lag), danach max. alle 300ms; verpasste Zwischen-
   staende werden am Ende des Fensters einmal nachgeholt. */
let bkmpIdleRefreshLiveTabsTimer = null;
let bkmpIdleRefreshLiveTabsPending = false;
let bkmpIdleLastClickAt = 0;
let bkmpIdleClickBurst = [];
function bkmpAutoclickLoadNumber(key) {
  try { return Number(localStorage.getItem(key) || 0) || 0; } catch (e) { return 0; }
}
function bkmpAutoclickSaveNumber(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) {}
}
function bkmpAutoclickLoadTimestamps(key) {
  try { const arr = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(arr) ? arr : []; } catch (e) { return []; }
}
function bkmpAutoclickSaveTimestamps(key, arr) {
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
}

// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). (2b-Ergaenzung)


/* Erstellt/verdrahtet eine schliessbare Ergebnis-Karte (Spieler-Vorgabe
   16.07.: "feste Popups mit den Belohnungen, die man wegklicken kann...
   dass man auch mal weiss was man bekommen hat wenn man nicht
   hingeguckt hat") - bewusst OHNE Auto-Timeout mehr (die alte Version
   verschwand nach 4.8-5.4s von selbst, was bei AFK/nicht-hinschauen genau
   das gemeldete Problem war). Schliesst per X-Button ODER Klick auf den
   abgedunkelten Hintergrund (nicht auf die Karte selbst). Gemeinsam von
   Dungeon- und Turm-Ergebnis genutzt. */
function bkmpIdleShowDismissibleResultCard(id, innerHtml) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'bkmp-easter bkmp-easter-dismissible';
  overlay.id = id;
  overlay.innerHTML = `
    <div class="bkmp-easter-card idle-dungeon-result-card">
      <button type="button" class="idle-result-close-btn" aria-label="Schließen">✕</button>
      ${innerHtml}
    </div>
  `;
  const close = () => {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 450);
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.idle-result-close-btn').addEventListener('click', close);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));
}
/* Fester Mitternachts-Reset (Spieler-Vorgabe 16.07.: "soll bitte immer um
   0 Uhr reseten... alles auf 0 Uhr skaliert") statt des vorherigen
   rollierenden 24h-Cooldowns - ein Versuch um 23:50 Uhr und einer um
   00:10 Uhr am naechsten Tag waren vorher fast 24h auseinander, jetzt ist
   um Mitternacht (Europe/Berlin) IMMER wieder ein Versuch faellig, egal
   wann genau der letzte war. bkmpBerlinDateKey liefert dafuer denselben
   DST-sicheren Tages-Schluessel (YYYYMMDD in Europe/Berlin) wie an anderer
   Stelle im Spiel bereits fuer den Gildenboss verwendet (siehe
   bkmpGuildBossGetPhaseInfo) - zwei Zeitpunkte sind "derselbe Tag" genau
   dann, wenn ihre Schluessel uebereinstimmen. */
function bkmpBerlinDateKey(date) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date || new Date()).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  return `${parts.year}${parts.month}${parts.day}`;
}
function bkmpBerlinNextMidnight(date) {
  const d = date || new Date();
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  return bkmpGuildBossBerlinDateAt(Number(parts.year), Number(parts.month), Number(parts.day) + 1, 0, 0);
}

/* ---------------- Autoklicker-Erkennung: Muster statt reiner Frequenz ----------------
   Vorher: feste Grenze "mehr als 10 Klicks/Sekunde = Autoklicker" - hat
   schnelle, aber echte Spieler faelschlich blockiert (Menschen KOENNEN
   kurzzeitig >10 Klicks/s erreichen). Jetzt: bewertet stattdessen, wie
   GLEICHMAESSIG die Abstaende zwischen den letzten Klicks sind
   (Variationskoeffizient = Standardabweichung / Mittelwert der Intervalle).
   Ein Mensch klickt auch beim schnellen, konzentrierten Klicken nie ueber
   laengere Zeit in nahezu identischen Millisekunden-Abstaenden - ein
   Autoklicker/Makro dagegen schon (meist Abweichungen im niedrigen
   Prozentbereich statt der natuerlichen ~20-40%+ eines Menschen).
   Reagiert erst, wenn (a) genug Datenpunkte gesammelt wurden UND das
   gleichmaessige Muster durchgehend mindestens BKMP_AUTOCLICK_MIN_SPAN_MS
   (30 Sekunden) angehalten hat (kein Fehlalarm durch einen kurzen
   zufaelligen gleichmaessigen Abschnitt), UND (b) die Klicks auch schnell
   genug sind (langsames, zufaellig gleichmaessiges Klicken ist weder
   verdaechtig noch spielerisch ausnutzbar) - erst wenn ALLE Indikatoren
   gemeinsam zutreffen, gilt es als Autoklicker-Muster.
   Reaktion bleibt wie zuvor: kurzzeitige Sperre + Hinweis-Toast, danach
   automatisch wieder frei - keine dauerhafte Sperre. Gemeinsam genutzt von
   Idle-Dorf-Klicks (bkmpIdleHandleDragonClick) UND Raid-Klicks
   (bkmpRaidHandleBossClick), damit beide Stellen exakt dasselbe,
   einmal getestete Muster nutzen. */
/* BKMP_AUTOCLICK_WINDOW ist bewusst ein reiner NOTBREMSE-Deckel gegen
   unbegrenztes Array-Wachstum, NICHT Teil der eigentlichen Erkennungslogik -
   das war vorher ein echter Bug: bei 300 Eintraegen gedeckelt UND
   gleichzeitig muss die Zeitspanne mindestens MIN_SPAN_MS betragen. Bei
   jedem Klick-Tempo schneller als MIN_SPAN_MS/WINDOW wurde das Array schon
   durch das Mengenlimit gestutzt, BEVOR die Zeitspanne ueberhaupt erreicht
   werden konnte - die Pruefung war dadurch bei schnellen Autoklickern
   NIEMALS erfuellbar, egal wie lange gewartet wurde (live durch einen
   Community-Test bestaetigt: 80ms-Autoklicker 60s laufen lassen -> nie
   ausgeloest, spaeter sogar bei 1ms/Klick 30s am Stueck reproduziert). Hoch
   genug angesetzt (65000 Eintraege = volle HISTORY_MS-Spanne noch bei
   1ms/Klick, extremer als jeder reale Autoklicker), damit der Zeit-Filter
   (HISTORY_MS) allein die Begrenzung uebernimmt und nie vorzeitig eingreift.

   Absichtliche Design-Entscheidung (nach Spieler-Feedback): kurze, intensive
   Klick-Ausbrueche (z.B. 30-60s "Hass-Klicken" beim Raidboss oder
   Event-Drachen) sollen NIEMALS ausgeloest werden, egal wie schnell/
   gleichmaessig - nur wer wirklich DAUERHAFT/AFK mit einem Autoklicker
   spielt, soll erwischt werden. Deshalb MIN_SPAN_MS auf 60s angehoben (unter
   60s Dauerklicken triggert nie) UND die Sperre bei echtem Auftreten von
   frueher nur 4s auf 10 Minuten verlaengert - eine 4s-Sperre war praktisch
   kostenlos umgehbar (alle 30s kurz pausieren, sofort weiterklicken), 10
   Minuten machen dauerhaftes Autoklicken tatsaechlich unattraktiv. */
const BKMP_AUTOCLICK_WINDOW = 65000;
const BKMP_AUTOCLICK_MIN_SAMPLES = 15;
const BKMP_AUTOCLICK_MIN_SPAN_MS = 60000;
const BKMP_AUTOCLICK_MAX_AVG_INTERVAL_MS = 260;
const BKMP_AUTOCLICK_CV_THRESHOLD = 0.12;
const BKMP_AUTOCLICK_LOCK_MS = 10 * 60 * 1000;
const BKMP_AUTOCLICK_HISTORY_MS = 62000; // etwas mehr als MIN_SPAN_MS, sonst wuerden aeltere, fuer die 60s-Pruefung noetige Zeitstempel schon vorher weggefiltert
const BKMP_AUTOCLICK_TOAST = 'Deine Klicks wirken verdächtig gleichmäßig – kurze Pause fürs Handgelenk 😉';

/* Zusaetzliche harte Obergrenze (unabhaengig von der Muster-Erkennung
   oben): die CV-Pruefung erkennt nur SEHR gleichmaessige Abstaende - ein
   Skript, das absichtlich mit leichtem Zufalls-Jitter klickt, koennte die
   Muster-Erkennung umgehen und trotzdem z.B. 50x/Sekunde klicken. Klicks
   schneller als dieser Wert werden komplett verworfen (kein Schaden, KEIN
   visuelles Feedback - bewusst so, sonst wuerden Trefferanzeige und
   tatsaechlicher Schaden auseinanderlaufen).
   Bug-Fix 18.07. (Spieler-Meldung: "manuelle Klicks werden manchmal nicht
   als Angriff gewertet"): stand bisher auf 100ms (=10 Klicks/Sekunde) -
   der Kommentar hier ging davon aus, das sei "fuer echtes Hass-Klicken
   locker erreichbar", tatsaechlich ist ein STRIKT gleichmaessiger 100ms-
   Deckel schon fuer kurze, natuerliche Klick-BUERSTE (z.B. schneller
   Doppel-/Dreifachklick, beidhaendiges Wechselklicken, manche Maeuse mit
   bekanntem Doppelklick-Hardwarefehler) leicht unterschreitbar, JEDES Mal
   deterministisch, ohne jede Rueckmeldung - fuehlt sich fuer den Spieler
   wie ein zufaellig ignorierter Klick an. Auf 60ms (~16,7 Klicks/Sekunde)
   angehoben - bleibt weiterhin klar unter der 20-Klicks/Sekunde-Sofort-
   sperre (BKMP_BURST_CLICK_THRESHOLD) und schliesst die Luecke gegen einen
   50x/Sekunde-Jitter-Bot weiterhin zuverlaessig; die eigentliche Verteidigung
   gegen dauerhaftes Autoklicken bleibt unveraendert die 60s-Muster-Erkennung
   oben, die von dieser Aenderung nicht beruehrt wird. */
const BKMP_CLICK_RATE_CAP_MS = 60;

/* Sofort-Sperre bei eindeutigem Extrem-Ausbruch: 20+ Klick-VERSUCHE
   innerhalb einer Sekunde (auch die vom 100ms-Ratenlimit ohnehin
   verworfenen zaehlen mit, deshalb ein eigener Zaehler VOR dem Ratenlimit-
   Check) sind fuer einen Menschen unmoeglich und eindeutig ein Bot/Skript -
   loest dieselbe 10-Minuten-Sperre wie die 60s-Mustererkennung aus, aber
   sofort statt erst nach einer vollen Minute Beobachtung. */
const BKMP_BURST_CLICK_THRESHOLD = 20;
const BKMP_BURST_WINDOW_MS = 1000;

function bkmpIdleDetectAutoclickPattern(timestamps) {
  if (!timestamps || timestamps.length < BKMP_AUTOCLICK_MIN_SAMPLES) return false;
  /* Absichtlich KEIN erneutes .slice() hier - das hatte denselben Bug nur
     eine Ebene tiefer reproduziert. timestamps kommt bereits zeitlich
     korrekt begrenzt vom Aufrufer (HISTORY_MS-Filter). */
  const recent = timestamps;
  /* Muss ueber mindestens 30 Sekunden hinweg angehalten haben - ein kurzer,
     zufaellig gleichmaessiger Klick-Ausbruch (z.B. 1-2s) reicht bewusst
     nicht aus, egal wie niedrig dessen Variationskoeffizient ausfaellt. */
  if (recent[recent.length - 1] - recent[0] < BKMP_AUTOCLICK_MIN_SPAN_MS) return false;
  const intervals = [];
  for (let i = 1; i < recent.length; i++) intervals.push(recent[i] - recent[i - 1]);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (!(mean > 0) || mean > BKMP_AUTOCLICK_MAX_AVG_INTERVAL_MS) return false;
  const variance = intervals.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / intervals.length;
  const coefficientOfVariation = Math.sqrt(variance) / mean;
  return coefficientOfVariation < BKMP_AUTOCLICK_CV_THRESHOLD;
}
