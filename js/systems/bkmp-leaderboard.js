// Bkmp - Redesign Phase 2c (17.07.): konsolidiert das, was in allen 4
// Bestenlisten-Implementierungen wortgleich dupliziert war (Audit-Fund).
//
// Bewusster Scope-Schnitt: die Marketing-Seiten-Bestenliste (renderLeaderboard
// in bkmp-site.js - Erfolge/Zeit/Bonks/Karten/Kartenideen) bleibt dort, wo sie
// ist. Sie ist keine vierte Kopie derselben Sache, sondern verfolgt andere
// Metriken (Community-/Marketing-Statistiken statt Idle-Dorf-Spielfortschritt)
// UND hat bereits eine reichhaltigere Zeile (Podium-Glow, klickbares Profil,
// Plueschie-Icon, Kosmetik, Titel) - das absichtlich zu vereinheitlichen ist
// Phase 3/5-Arbeit (dann mit echter Design-Entscheidung, ob/wie alle Listen
// dieselbe reiche Optik bekommen), nicht Teil dieser reinen Architektur-
// Aufraeumung. Was hier zusammengefuehrt wird, ist die tatsaechlich wortgleich
// vierfach kopierte Medaillen-Logik (jetzt einmal, bkmpUiMedal) und die
// untereinander bereits identische einfache Zeilen-Vorlage der drei echten
// Idle-Dorf-Spiel-Bestenlisten (Haupt-/Dungeon-/Raid-Bestenliste).

function bkmpUiMedal(index) {
  return index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
}

/* Gemeinsame einfache Zeile fuer die drei Idle-Dorf-Spiel-Bestenlisten
   (Haupt-Tab, Dungeon, Raid) - deren Markup war zeichengleich dreifach
   kopiert, nur die Werte-Berechnung/Datenquelle unterscheidet sich
   legitim je Tab. */
function bkmpLeaderboardRenderSimpleRow(rank, displayName, valueText, isMe) {
  return `<div class="leaderboard-row ${isMe ? 'is-me' : ''}"><span class="leaderboard-rank">${bkmpUiMedal(rank)}</span><span class="leaderboard-name"><span class="leaderboard-name-text">${escapeHtml(displayName)}</span></span><span class="leaderboard-value">${valueText}</span></div>`;
}
