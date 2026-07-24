/* GameClock - zentrale Zeit-Abstraktion (QA-Grundlage Phase 1, 24.07.2026).

   Im normalen Spiel (window.BKMP_QA_MODE nicht gesetzt) liefert
   bkmpGetGameNow() exakt Date.now() - kein Verhaltensunterschied zu vorher.
   Nur wenn der lokale QA-Modus aktiv ist (siehe index.html: nur auf
   localhost/127.0.0.1 UND ?qa=1 erreichbar, siehe supabase.js/CLAUDE.md),
   kann bkmpGameClockAdvance() einen In-Memory-Offset aufaddieren, den
   bkmpGetGameNow() danach mit einrechnet.

   ABSICHTLICH NICHT migriert (siehe CLAUDE.md-Eintrag "Phase QA-Grundlage"):
   der Kampf-Tick/Offline-Claim/Sync-Sperren in idledorf.js nutzen weiterhin
   direkt Date.now()/new Date() - eine blinde Vollmigration aller Zeitstellen
   war fuer diese erste Stufe explizit nicht verlangt (Nutzer-Auftrag Schritt
   3: "Aendere nicht blind jede Zeitstelle... migriere nur Stellen, die fuer
   eine sichere erste Umsetzung notwendig sind"). Migriert wurde bisher nur
   der rein clientseitige (kein Server-Schreibzugriff) Login-Streak-Check in
   js/systems/bkmp-events.js, siehe Kommentar dort.

   Der Offset lebt bewusst nur im Arbeitsspeicher (kein localStorage) - ein
   Reload waehrend eines Tests setzt die simulierte Zeit zurueck auf "jetzt";
   das ist fuer Phase 1 ausreichend und vermeidet das Risiko, dass ein alter,
   vergessener Offset-Wert in einem echten (Nicht-QA-)Browserprofil
   ueberlebt. */

(function () {
  let offsetMs = 0;

  function isQaModeActive() {
    return typeof window !== 'undefined' && window.BKMP_QA_MODE === true;
  }

  function bkmpGetGameNow() {
    if (!isQaModeActive() || offsetMs === 0) return Date.now();
    return Date.now() + offsetMs;
  }

  function bkmpGameClockAdvance(ms) {
    if (!isQaModeActive()) return bkmpGetGameNow();
    offsetMs += Number(ms) || 0;
    return bkmpGetGameNow();
  }

  function bkmpGameClockReset() {
    offsetMs = 0;
    return bkmpGetGameNow();
  }

  function bkmpGameClockIsSimulated() {
    return isQaModeActive() && offsetMs !== 0;
  }

  function bkmpGameClockOffsetMs() {
    return offsetMs;
  }

  window.bkmpGetGameNow = bkmpGetGameNow;
  window.bkmpGameClockAdvance = bkmpGameClockAdvance;
  window.bkmpGameClockReset = bkmpGameClockReset;
  window.bkmpGameClockIsSimulated = bkmpGameClockIsSimulated;
  window.bkmpGameClockOffsetMs = bkmpGameClockOffsetMs;
})();
