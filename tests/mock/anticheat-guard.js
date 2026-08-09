/* JS-Nachbau des Postgres-Triggers idle_player_state_anticheat_guard()
   (sql/20260730-idle-player-state-anticheat-guard.sql, erweitert durch
   sql/20260809-anticheat-guard-independent-fields.sql) - Anlass 30.07.2026:
   Spieler-Meldung (Feedback-Board-Screenshot + 2 Beweisvideos), Browser-
   Erweiterungen wie "HTML5 Universal Speed Hack" bzw. Cheat Engine
   beschleunigen den lokalen Tick-Timer und lassen so ein Vielfaches der
   eigentlich moeglichen Kill-/Level-/Ressourcen-Rate melden - der Server
   hat das bisher nie geprueft (reines RLS-gestuetztes Upsert des
   kompletten Client-Zustands, siehe upsertIdlePlayerState() in supabase.js).

   NACHTRAG 09.08.2026 (Spieler-Meldung: Account mit "9999999 Skillpunkte",
   oeffentliche Bestenliste mit "Level 846473"): der urspruengliche Trigger
   (30.07.) daempfte Level/Skillpunkte/Gold/Ressourcen NUR als Nebeneffekt,
   wenn ZUERST der dragon_kills-Zuwachs implausibel war - ein gezieltes
   Update, das NUR skill_points_available/level setzt und dragon_kills
   unveraendert laesst, loeste die gesamte Daempfung nie aus. Jetzt gibt es
   ZWEI WEITERE, unabhaengige Signale (Level-Zuwachs, Skillpunkte-GESAMT-
   Zuwachs) mit derselben Budget-Logik - v_ratio ist das strengste der drei
   ausgeloesten Verhaeltnisse.

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

   BURST_BUFFER=500 (Level/Skillpunkte-Budget = Zeit-Rate + fester Puffer):
   Dungeon-/Turm-Laeufe vergeben XP (und damit Level-Aufstiege) in einem
   einzigen Sammel-Update, unabhaengig von dragon_kills (siehe
   bkmpDungeonGrantReward()/bkmp-tower.js) - eine reine Zeit-Rate ohne Puffer
   wuerde legitime grosse Belohnungs-Bursts faelschlich kappen. Der Puffer ist
   bewusst grosszuegig statt praezise hergeleitet (siehe SQL-Datei-Kopf-
   Kommentar), liegt aber immer noch um den Faktor >1000 unter den
   gemeldeten Missbrauchswerten.

   Skillpunkte-Sonderfall: das Skilltree-"Zuruecksetzen" verschiebt bereits
   ausgegebene Punkte zurueck in skill_points_available (siehe js/systems/
   bkmp-skilltree.js) - kann einen grossen EINZELNEN Zuwachs von
   skill_points_available erzeugen, OHNE dass echte neue Punkte entstehen
   (reine Umbuchung). Deshalb wird nur die SUMME (available+spent) geprueft -
   eine Umverteilung aendert die Summe nicht und loest daher nie aus.

   Bei einer Verletzung wird NICHT abgelehnt (kein Fehler fuer den Client,
   kein kaputter Speicherversuch), sondern der GESAMTE Fortschritts-Zuwachs
   dieses einen Speicherversuchs anteilig auf das noch plausible Mass
   herunterskaliert - bewusste Vereinfachung: keine Neuberechnung der echten
   Belohnungsformel (haengt von Dutzenden Boni/aktueller Drachen-Stufe ab),
   sondern ein einheitlicher Faktor auf alle Fortschritts-Felder gemeinsam
   (Ausnahme: skill_points_available, siehe oben). Echte Ausgaben/Resets
   (fallende Werte) werden nie angetastet - nur ansteigende Deltas werden
   gekappt. */

const MAX_KILLS_PER_SECOND = 3;
const MIN_ELAPSED_SECONDS = 4;
const BURST_BUFFER = 500;

const PROPORTIONAL_GUARDED_FIELDS = [
  'dragon_kills', 'boss_kills', 'gold', 'total_gold_earned',
  'wood', 'stone', 'crystals', 'essence', 'xp', 'level'
];
const GUARDED_FIELDS = [...PROPORTIONAL_GUARDED_FIELDS, 'skill_points_available'];

function applyIdlePlayerStateAntiCheatGuard(oldRow, incomingBody, nowMs) {
  if (!oldRow) return { body: incomingBody, flagged: false };

  const oldUpdatedAtMs = oldRow.updated_at ? Date.parse(oldRow.updated_at) : NaN;
  const elapsedSecondsRaw = Number.isNaN(oldUpdatedAtMs) ? MIN_ELAPSED_SECONDS : (nowMs - oldUpdatedAtMs) / 1000;
  const elapsedSeconds = Math.max(MIN_ELAPSED_SECONDS, elapsedSecondsRaw);
  const maxKillsDelta = elapsedSeconds * MAX_KILLS_PER_SECOND;
  const maxLevelDelta = elapsedSeconds * MAX_KILLS_PER_SECOND + BURST_BUFFER;
  const maxSkillpointsDelta = maxLevelDelta;

  const oldKills = Number(oldRow.dragon_kills || 0);
  const claimedKills = incomingBody.dragon_kills != null ? Number(incomingBody.dragon_kills) : oldKills;
  const claimedKillsDelta = claimedKills - oldKills;
  let ratioKills = 1;
  if (claimedKillsDelta > maxKillsDelta) ratioKills = maxKillsDelta / claimedKillsDelta;

  const oldLevel = Number(oldRow.level || 0);
  const claimedLevel = incomingBody.level != null ? Number(incomingBody.level) : oldLevel;
  const claimedLevelDelta = claimedLevel - oldLevel;
  let ratioLevel = 1;
  if (claimedLevelDelta > maxLevelDelta) ratioLevel = maxLevelDelta / claimedLevelDelta;

  const oldSkillTotal = Number(oldRow.skill_points_available || 0) + Number(oldRow.skill_points_spent || 0);
  const claimedAvailable = incomingBody.skill_points_available != null ? Number(incomingBody.skill_points_available) : Number(oldRow.skill_points_available || 0);
  const claimedSpent = incomingBody.skill_points_spent != null ? Number(incomingBody.skill_points_spent) : Number(oldRow.skill_points_spent || 0);
  const claimedSkillTotal = claimedAvailable + claimedSpent;
  const claimedSkillpointsDelta = claimedSkillTotal - oldSkillTotal;
  let ratioSkillpoints = 1;
  if (claimedSkillpointsDelta > maxSkillpointsDelta) ratioSkillpoints = maxSkillpointsDelta / claimedSkillpointsDelta;

  const ratio = Math.min(ratioKills, ratioLevel, ratioSkillpoints);
  if (ratio >= 1) {
    return { body: incomingBody, flagged: false };
  }

  const triggeredBy = [];
  if (ratioKills < 1) triggeredBy.push('dragon_kills');
  if (ratioLevel < 1) triggeredBy.push('level');
  if (ratioSkillpoints < 1) triggeredBy.push('skill_points');

  const patched = { ...incomingBody };
  PROPORTIONAL_GUARDED_FIELDS.forEach(field => {
    if (incomingBody[field] == null) return;
    const oldVal = Number(oldRow[field] || 0);
    const newVal = Number(incomingBody[field]);
    const delta = newVal - oldVal;
    if (delta <= 0) return; // Verringerungen (Ausgeben, Prestige-Reset) bleiben unangetastet
    patched[field] = oldVal + Math.floor(delta * ratio);
  });
  // Skillpunkte: die GESAMTE Ratio gilt auch hier (nicht nur, wenn
  // ausgerechnet das Skillpunkte-Signal selbst der Ausloeser war - sonst
  // wuerde z.B. ein durch dragon_kills ausgeloester Kuerzungsfaktor
  // faelschlich NICHT auf mitgemeldete Skillpunkte angewendet). Skaliert
  // wird aber NUR der NETTO-NEUE Anteil (claimedSkillpointsDelta, > 0 heisst
  // "es wurden per Saldo neue Punkte behauptet") - eine reine Umbuchung
  // zwischen available/spent (Delta <= 0 oder = 0) bleibt immer unangetastet,
  // unabhaengig davon, wie gross der Betrag ist (siehe Datei-Kopf-Kommentar,
  // Skilltree-Zuruecksetzen-Fall).
  const netNewSkillpoints = Math.max(0, claimedSkillpointsDelta);
  if (netNewSkillpoints > 0 && incomingBody.skill_points_available != null) {
    const allowedNewSkillpoints = Math.floor(netNewSkillpoints * ratio);
    patched.skill_points_available = Math.max(0, claimedAvailable - Math.ceil(netNewSkillpoints - allowedNewSkillpoints));
  }

  return {
    body: patched, flagged: true, ratio, elapsedSeconds,
    claimedKillsDelta, maxKillsDelta, claimedLevelDelta, maxLevelDelta, claimedSkillpointsDelta, maxSkillpointsDelta,
    ratioKills, ratioLevel, ratioSkillpoints, triggeredBy: triggeredBy.join(',')
  };
}

module.exports = { applyIdlePlayerStateAntiCheatGuard, MAX_KILLS_PER_SECOND, MIN_ELAPSED_SECONDS, BURST_BUFFER, GUARDED_FIELDS };
