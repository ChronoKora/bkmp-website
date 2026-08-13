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

/* Kampfwerte (09.08. Nachtrag, ERSETZT 11.08. durch absolute Obergrenzen -
   sql/20260811-anticheat-guard-absolute-ceiling.sql) - Spieler "OPShadowWolf"
   schickte 3 Videos, die einen LIVE-Account mit attack=420.45M (HUD) zeigen,
   der jeden Boss instant one-shottet. attack/defense/hp/crit_chance/
   crit_damage/gold_bonus/xp_bonus/loot_bonus sind Teil desselben
   BKMP_IDLE_PLAYER_STATE_COLUMNS-Upserts wie dragon_kills/level/skill_points,
   hatten aber KEINE eigene Pruefung.

   NACHTRAG 11.08.2026 (Nutzer-Meldung: "einige nicht mehr in der
   Leaderboards angezeigt"): die urspruengliche 09.08.-Fassung (relative
   50x-pro-Speicherung-Grenze) war viel zu eng - Kampfwerte werden bei JEDER
   relevanten Aenderung (Prestige-Reset, Gilden-Technologie-Sprung, Runen-
   Aufwertung/-Verschmelzung/-Aufstieg, mehrstufiger Auto-Kauf) komplett NEU
   berechnet, ein einzelner legitimer Investitions-Burst kann dadurch voellig
   normal mehr als das 50-fache in EINER Speicherung ausmachen. Live-
   Auswertung (curl gegen die echte Produktions-DB): 33 von 217 Accounts
   wurden dadurch faelschlich von der oeffentlichen Bestenliste ausgeblendet,
   praktisch nur lange dokumentierte, echte Spieler (u.a. der eigene Account
   des Betreibers). Fix: absolute, vom vorherigen Wert komplett UNABHAENGIGE
   Obergrenzen statt eines Verhaeltnisses - kalibriert an den tatsaechlich
   staerksten aktuell existierenden Accounts im Spiel (Level 5900-9200:
   attack ~13.500-15.000, defense ~6.300-9.400, hp ~12.800-14.800,
   crit_damage ~500-556, gold_bonus ~918-966, xp_bonus ~478-744,
   loot_bonus ~324-527) - die neuen Grenzen liegen beim 70-140-fachen davon,
   riesiger Sicherheitsabstand fuer jahrelanges weiteres Powercreep, aber
   immer noch um Groessenordnungen unter dem gemeldeten echten Exploit-Wert
   (420.450.000). Ein legitimer Burst, egal wie gross, wird dadurch nie mehr
   faelschlich als Forgery gewertet - nur das Ergebnis muss plausibel bleiben. */
const COMBAT_STAT_CEILINGS = {
  attack: 1000000, defense: 1000000, hp: 2000000,
  crit_chance: 100, crit_damage: 5000,
  gold_bonus: 10000, xp_bonus: 10000, loot_bonus: 10000
};

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

  /* Kampfwerte (11.08.): absolute Obergrenze, UNABHAENGIG von OLD.* und von
     ratio oben - laeuft auch, wenn kills/level/skillpoints komplett
     unveraendert sind (genau der gemeldete Fall: nur attack/etc. gefaelscht).
     Direkt hart gekappt, nicht proportional wie die anderen Felder. */
  const patched = { ...incomingBody };
  const combatStatDetails = {};
  let combatStatTriggered = false;
  Object.keys(COMBAT_STAT_CEILINGS).forEach(field => {
    if (incomingBody[field] == null) return;
    const oldVal = Number(oldRow[field] || 0);
    const claimedVal = Number(incomingBody[field]);
    const ceiling = COMBAT_STAT_CEILINGS[field];
    if (claimedVal > ceiling) {
      combatStatDetails[field] = { old: oldVal, claimed: claimedVal, capped_to: ceiling };
      patched[field] = ceiling;
      combatStatTriggered = true;
    }
  });

  if (ratio >= 1 && !combatStatTriggered) {
    return { body: incomingBody, flagged: false };
  }

  const triggeredBy = [];
  if (ratioKills < 1) triggeredBy.push('dragon_kills');
  if (ratioLevel < 1) triggeredBy.push('level');
  if (ratioSkillpoints < 1) triggeredBy.push('skill_points');
  if (combatStatTriggered) triggeredBy.push('combat_stats');

  if (ratio < 1) {
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
  }

  return {
    body: patched, flagged: true, ratio, elapsedSeconds,
    claimedKillsDelta, maxKillsDelta, claimedLevelDelta, maxLevelDelta, claimedSkillpointsDelta, maxSkillpointsDelta,
    ratioKills, ratioLevel, ratioSkillpoints, triggeredBy: triggeredBy.join(','),
    combatStatTriggered, combatStatDetails: combatStatTriggered ? combatStatDetails : null
  };
}

module.exports = { applyIdlePlayerStateAntiCheatGuard, MAX_KILLS_PER_SECOND, MIN_ELAPSED_SECONDS, BURST_BUFFER, GUARDED_FIELDS };
