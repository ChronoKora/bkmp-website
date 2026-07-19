// Bkmp - Redesign Phase 2c (17.07.): Start der Achievement-Engine-
// Konsolidierung (Ziel-Datei laut CLAUDE.md-Modulkarte). Die vollstaendige
// Zusammenfuehrung (Toast/Konfetti-Warteschlange, Kategorien-Rendering -
// aktuell noch in idledorf.js/bkmp-site.js) ist bewusst Phase 5-Arbeit, die
// mit einer echten Design-Entscheidung einhergeht (siehe Redesign-Plan).
//
// Was hier schon sicher zusammengefuehrt wird: die vier
// bkmpXxxGetAchievementContextFields()-Funktionen (idle/arena/guild/raid)
// TEILEN sich nur ein Muster - "aus localStorage-Cache lesen, bei Fehler/
// leer auf einen Default zurueckfallen" -, nicht die eigentlichen Felder
// oder Datenquellen (die sind pro System bewusst unterschiedlich: Gilde
// liest aus bkmpGuildGetMine(), Raid direkt aus raid_player_stats, Arena aus
// arena_ratings, Idle direkt aus dem geladenen bkmpIdleState). Ein
// generischer Merge dieser vier Funktionen wuerde die Typklarheit verlieren,
// ohne echten Code einzusparen - das genau wortgleiche Stueck (Cache lesen +
// try/catch + Fallback) ist dagegen ein sicherer, kleiner DRY-Gewinn.
function bkmpAchievementReadCache(cacheKey, defaults) {
  try {
    return JSON.parse(localStorage.getItem(cacheKey) || 'null') || { ...defaults };
  } catch (e) {
    return { ...defaults };
  }
}
