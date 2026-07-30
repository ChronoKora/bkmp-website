/* JS-Nachbau des Postgres-Triggers idle_player_state_anticheat_guard()
   (sql/20260730-idle-player-state-anticheat-guard.sql) - Anlass: Spieler-
   Meldung 30.07.2026 (Feedback-Board-Screenshot + 2 Beweisvideos), Browser-
   Erweiterungen wie "HTML5 Universal Speed Hack" bzw. Cheat Engine
   beschleunigen den lokalen Tick-Timer und lassen so ein Vielfaches der
   eigentlich moeglichen Kill-/Level-/Ressourcen-Rate melden - der Server
   hat das bisher nie geprueft (reines RLS-gestuetztes Upsert des
   kompletten Client-Zustands, siehe upsertIdlePlayerState() in supabase.js).

   MAX_KILLS_PER_SECOND=3 ist bewusst NUR knapp (20%) ueber der tatsaechlich
   harten, im Client fest verdrahteten Tick-Untergrenze (400ms, siehe
   idledorf.js "tickIntervalMs: Math.max(400, ...)") gewaehlt - ein einzelner
   Kill kann rechnerisch nie schneller als alle 400ms erfolgen (bkmpIdleTick()
   erhoeht dragon_kills hoechstens 1x pro eigenem Aufruf, kein Verketten
   mehrerer Kills in einem Tick), das ist also eine echte, nicht ueber-
   schreitbare Obergrenze fuer JEDEN legitimen Spieler, unabhaengig von
   Build/Ausruestung. Bewusst NICHT ueber playtime_seconds geprueft (siehe
   ausfuehrliche Diagnose-Notiz vom 30.07. in CLAUDE.md) - dieses Feld
   waechst nur um den NOMINELLEN Tick-Intervall PRO TICK (idledorf.js:937),
   waere also von genau demselben Timer-Speedhack gleich mit betroffen und
   damit als Vergleichsmasstab wertlos. Stattdessen echte, vom Client nicht
   beeinflussbare Server-Wanduhrzeit (now() - updated_at der VORHERIGEN
   Zeile) als einziger Zeitmassstab.

   Bei einer Verletzung wird NICHT abgelehnt (kein Fehler fuer den Client,
   kein kaputter Speicherversuch), sondern der GESAMTE Fortschritts-Zuwachs
   dieses einen Speicherversuchs anteilig auf das noch plausible Mass
   herunterskaliert (ratio = erlaubtes Kills-Delta / gemeldetes Kills-
   Delta) - bewusste Vereinfachung: keine Neuberechnung der echten Belohnungs-
   formel (haengt von Dutzenden Boni/aktueller Drachen-Stufe ab), sondern ein
   einheitlicher Faktor auf alle Fortschritts-Felder gemeinsam. Echte
   Ausgaben/Resets (fallende Werte) werden nie angetastet - nur ansteigende
   Deltas werden gekappt. */

const MAX_KILLS_PER_SECOND = 3;
const MIN_ELAPSED_SECONDS = 4;

const GUARDED_FIELDS = [
  'dragon_kills', 'boss_kills', 'gold', 'total_gold_earned',
  'wood', 'stone', 'crystals', 'essence', 'xp', 'level', 'skill_points_available'
];

function applyIdlePlayerStateAntiCheatGuard(oldRow, incomingBody, nowMs) {
  if (!oldRow) return { body: incomingBody, flagged: false };

  const oldUpdatedAtMs = oldRow.updated_at ? Date.parse(oldRow.updated_at) : NaN;
  const elapsedSecondsRaw = Number.isNaN(oldUpdatedAtMs) ? MIN_ELAPSED_SECONDS : (nowMs - oldUpdatedAtMs) / 1000;
  const elapsedSeconds = Math.max(MIN_ELAPSED_SECONDS, elapsedSecondsRaw);
  const maxKillsDelta = elapsedSeconds * MAX_KILLS_PER_SECOND;

  const oldKills = Number(oldRow.dragon_kills || 0);
  const claimedKills = incomingBody.dragon_kills != null ? Number(incomingBody.dragon_kills) : oldKills;
  const claimedKillsDelta = claimedKills - oldKills;

  if (claimedKillsDelta <= maxKillsDelta) {
    return { body: incomingBody, flagged: false };
  }

  const ratio = maxKillsDelta / claimedKillsDelta;
  const patched = { ...incomingBody };
  GUARDED_FIELDS.forEach(field => {
    if (incomingBody[field] == null) return;
    const oldVal = Number(oldRow[field] || 0);
    const newVal = Number(incomingBody[field]);
    const delta = newVal - oldVal;
    if (delta <= 0) return; // Verringerungen (Ausgeben, Prestige-Reset) bleiben unangetastet
    patched[field] = oldVal + Math.floor(delta * ratio);
  });

  return { body: patched, flagged: true, ratio, elapsedSeconds, claimedKillsDelta, maxKillsDelta };
}

module.exports = { applyIdlePlayerStateAntiCheatGuard, MAX_KILLS_PER_SECOND, MIN_ELAPSED_SECONDS, GUARDED_FIELDS };
