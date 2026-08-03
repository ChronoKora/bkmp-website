// Bkmp - Redesign Phase 2a (17.07.): mechanisch aus idledorf.js extrahiert (mit einem AST-Parser exakt abgegrenzt, keine Logik veraendert). js/systems/bkmp-prestige.js

let bkmpPrestigeState = null;
let bkmpPrestigeLoadFailed = false;
let bkmpPrestigeSaving = false;

/* ============================================================
   Prestige: dauerhafter Aufstieg, sobald die per bkmpPrestigeRequiredStage()
   berechnete Ziel-Stufe erreicht ist (steigt mit jeder Prestige-Stufe:
   100/150/200/... - siehe dort). Setzt den laufenden Durchgang zurueck (Level/Gold/Rohstoffe/
   Skilltree/Upgrades/Drachen-Fortschritt), vergibt dafuer Prestige-Punkte
   fuer einen KLEINEN, DAUERHAFTEN Bonusbaum (idle_prestige_state, siehe
   supabase-idle-prestige.sql) sowie einen sofortigen, festen Bonus pro
   Prestige-Stufe (siehe bkmpIdleRecomputeEffectiveStats). Lebenszeit-Werte
   (Spielzeit, Gesamt-Gold-verdient, Erfolge/Titel/Kosmetiken) bleiben
   unangetastet - nur der aktuelle "Lauf" wird zurueckgesetzt. */

/* Die noetige Stufe steigt mit jedem Aufstieg um 50 (Stufe 100/"10-0" fuer
   den ersten Aufstieg, 150/"15-0" fuer den zweiten, 200/"20-0" fuer den
   dritten, ...) - vorher war die Schwelle immer fix bei 100, wodurch jeder
   weitere Aufstieg dank der bereits erspielten dauerhaften Boni (Prestige-
   Baum + feste +5%/Stufe) spuerbar SCHNELLER wurde statt wie in den
   meisten Idle-Games mit jeder Stufe ein eigener, groesserer Meilenstein
   zu bleiben. prestigeLevel = bereits abgeschlossene Aufstiege (0 vor dem
   ersten). */
function bkmpPrestigeRequiredStage(prestigeLevel) {
  return 100 + Math.max(0, Math.floor(Number(prestigeLevel) || 0)) * 50;
}

/* ============================================================
   Progression-Rebalance Phase 5+6+7+8 (26.07.2026, siehe PROGRESSION_
   REBALANCE_PHASE1.md): der kleine 6-Knoten-Baum (linearer Kosten-
   Preisverfall, Gesamtkosten nur 1.015 Punkte - siehe Phase-1-Analyse:
   ein fortgeschrittener Spieler leert das nach 3-4 Aufstiegen komplett)
   wird durch 5 Zweige a 10 Knoten ersetzt/erweitert. WICHTIG fuer
   bestehende Spieler: alle 6 alten Knoten-IDs (ewiges_feuer/drachenblut/
   goldene_ranken/zeitraffer/kristallkern/portal_meisterschaft) bleiben
   UNVERAENDERT bestehen - `prestige_allocations` ist ein flaches JSONB-
   Objekt {node_id: rang}, ein bereits investierter Rang bleibt exakt
   erhalten und behaelt seinen vollen Bonus (additiv pro Rang, keine
   rueckwirkende Aenderung). Nur 'kristallkern' bekommt eine neue
   Anzeige-Bezeichnung (passt zur neuen Baumidentitaet), die ID selbst
   bleibt 'kristallkern' - sonst wuerde die Zuordnung zum bestehenden
   Spielerfortschritt brechen. 'zeitraffer'/'portal_meisterschaft' passen
   thematisch in keinen der 5 im Auftrag genannten Zweige (kein Zweig
   nennt einen generischen XP- oder Prestige-Punkte-Bonus) - bleiben
   bewusst als "Vermaechtnis"-Zweig erhalten statt sie in ein falsches
   Branch-Etikett zu zwingen.

   Kosten (Phase 6): ersetzt die alte lineare Formel cost(rang)=rang durch
   `cost(rang) = round(baseCost * growthFactor^rang)` (identisches Prinzip
   wie die bereits bestehende, gut funktionierende Gilden-Technologie,
   siehe js/systems/bkmp-guild.js). growthFactor/baseCost/maxRank sind nach
   "Staerke" gestaffelt (Phase 6 Richtwerte: schwach->50, mittel->30,
   stark->20, Sonderfaelle mit Kauf-Cap 1->einmalige Freischaltung):
     WEAK   (maxRank 50, kleine QoL-Prozentwerte)
     MEDIUM (maxRank 30, spuerbare aber nicht dominante Boni)
     STRONG (maxRank 20, starke Kernboni - Angriff/Leben/Gold/Krit-Schaden)
     SPECIAL(maxRank 20, wie STRONG, aber Chance-basiert - siehe Paragon-
             Ausschluss unten, "keine Chance-Werte unkontrolliert treiben")
     TOGGLE (maxRank 1, einmalige Komfort-/Automations-Freischaltung)
   Reale Gesamtkosten pro Tier bis Maximalrang (siehe Simulationsbeweis in
   PROGRESSION_REBALANCE_PHASE1.md): WEAK~1.777, SPECIAL~2.459,
   MEDIUM~2.836, STRONG~3.179 Punkte - bewusst SO gestaffelt, dass ein
   Knoten mit mehr Raengen (WEAK) nicht automatisch teurer wird als einer
   mit wenigen, aber starken Raengen (STRONG). */
const BKMP_PRESTIGE_TIER = {
  WEAK: { maxRank: 50, costGrowth: 1.09, baseCost: 2 },
  MEDIUM: { maxRank: 30, costGrowth: 1.20, baseCost: 2 },
  STRONG: { maxRank: 20, costGrowth: 1.32, baseCost: 3 },
  SPECIAL: { maxRank: 20, costGrowth: 1.30, baseCost: 3, paragonEligible: false },
  TOGGLE: { maxRank: 1, costGrowth: 1, baseCost: 50 }
};
/* Portal-Meisterschaft ist bewusst KEIN normaler STRONG-Knoten - er
   verstaerkt sich selbst (mehr Punkte -> schneller noch mehr Punkte bei
   jedem kuenftigen Aufstieg), ein zu niedriger Kostenwiderstand liesse ihn
   sonst explosionsartig dominant werden (unveraendert seit der Ur-Fassung
   dieses Knotens, nur der Kosten-MECHANISMUS ist jetzt exponentiell statt
   linear). */
const BKMP_PRESTIGE_TIER_SELF_REINFORCING = { maxRank: 10, costGrowth: 1.5, baseCost: 3, paragonEligible: false };

function bkmpPrestigeTierDef(tier, overrides) {
  return Object.assign({}, BKMP_PRESTIGE_TIER[tier], overrides || {});
}

const BKMP_PRESTIGE_UPGRADES = [
  /* ---------------- Zweig A: Kampf (10 Knoten, 3 davon bereits bestehende IDs) ---------------- */
  { id: 'ewiges_feuer', branch: 'kampf', name: 'Ewiges Feuer', desc: '+8% Angriff pro Rang - dauerhaft, übersteht jeden Aufstieg.', icon: '🔥', effectType: 'attack_pct', effectPerRank: 8, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'drachenblut', branch: 'kampf', name: 'Drachenblut', desc: '+8% Leben pro Rang - dauerhaft.', icon: '🩸', effectType: 'hp_pct', effectPerRank: 8, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'obsidianpanzer', branch: 'kampf', name: 'Obsidianpanzer', desc: '+8% Verteidigung pro Rang - dauerhaft.', icon: '🛡️', effectType: 'defense_pct', effectPerRank: 8, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'praeziser_schlag', branch: 'kampf', name: 'Präziser Schlag', desc: '+1% Krit-Chance pro Rang - dauerhaft.', icon: '🎯', effectType: 'crit_chance_pct', effectPerRank: 1, ...bkmpPrestigeTierDef('MEDIUM') },
  /* Vormals "Kristallkern" - ID bewusst unveraendert (siehe Kommentar oben),
     nur Name/Beschreibung an die neue Baumidentitaet angepasst. maxRank von
     15 auf 20 angehoben (rein additiv - ein bereits maximierter Spieler
     bekommt einfach 5 weitere kaufbare Raenge, verliert nichts). */
  { id: 'kristallkern', branch: 'kampf', name: 'Zerstörerischer Schlag', desc: '+10% Kritischer Schaden pro Rang - dauerhaft. (Vormals "Kristallkern")', icon: '💠', effectType: 'crit_damage_pct', effectPerRank: 10, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'bossjaeger', branch: 'kampf', name: 'Bossjäger', desc: '+2% Bossschaden pro Rang - dauerhaft (Weltboss/Gildenboss).', icon: '👑', effectType: 'boss_dmg_pct', effectPerRank: 2, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'drachenmacht', branch: 'kampf', name: 'Drachenmacht', desc: '+2% Schaden deines aktiven Begleitdrachens pro Rang.', icon: '🐉', effectType: 'companion_dmg_pct', effectPerRank: 2, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'ruestungsbrecher', branch: 'kampf', name: 'Rüstungsbrecher', desc: '+1,5% ignorierte gegnerische Verteidigung pro Rang.', icon: '⛏️', effectType: 'defense_ignore_pct', effectPerRank: 1.5, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'ueberwaeltigung', branch: 'kampf', name: 'Überwältigung', desc: '+3% Schaden gegen Dungeon-/Turm-Gegner pro Rang.', icon: '💥', effectType: 'elite_dmg_pct', effectPerRank: 3, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'doppelschlag', branch: 'kampf', name: 'Doppelschlag', desc: '+1% Chance auf einen zweiten Treffer pro Rang.', icon: '⚔️', effectType: 'double_hit_chance_pct', effectPerRank: 1, ...bkmpPrestigeTierDef('SPECIAL') },

  /* ---------------- Zweig B: Wirtschaft (10 Knoten, 1 bestehende ID) ---------------- */
  { id: 'goldene_ranken', branch: 'wirtschaft', name: 'Goldene Ranken', desc: '+8% Gold-Ausbeute pro Rang - dauerhaft.', icon: '🌿', effectType: 'gold_prod_pct', effectPerRank: 8, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'reiche_ernte', branch: 'wirtschaft', name: 'Reiche Ernte', desc: '+4% Holz- und Steinproduktion pro Rang.', icon: '🌾', effectType: 'wood_stone_prod_pct', effectPerRank: 4, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'kristalladern', branch: 'wirtschaft', name: 'Kristalladern', desc: '+3% Kristallausbeute pro Rang (Kämpfe + Gebäude).', icon: '💎', effectType: 'crystal_find_pct', effectPerRank: 3, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'essenzstrom', branch: 'wirtschaft', name: 'Essenzstrom', desc: '+3% Essenzausbeute pro Rang (Kämpfe + Gebäude).', icon: '🧪', effectType: 'essence_find_pct', effectPerRank: 3, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'haendlergeschick', branch: 'wirtschaft', name: 'Händlergeschick', desc: '-1% Kosten für normale Upgrades pro Rang (max. 20%).', icon: '🤝', effectType: 'upgrade_cost_reduction_pct', effectPerRank: 1, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'effiziente_baukunst', branch: 'wirtschaft', name: 'Effiziente Baukunst', desc: '-1% Kosten für Produktionsgebäude pro Rang (max. 20%).', icon: '🏗️', effectType: 'building_cost_reduction_pct', effectPerRank: 1, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'schatzsucher', branch: 'wirtschaft', name: 'Schatzsucher', desc: '+1% Chance auf doppelte Kampfbeute pro Rang.', icon: '🗝️', effectType: 'double_loot_chance_pct', effectPerRank: 1, ...bkmpPrestigeTierDef('SPECIAL') },
  { id: 'offline_imperium', branch: 'wirtschaft', name: 'Offline-Imperium', desc: '+3% Offline-Produktion pro Rang.', icon: '🏛️', effectType: 'offline_income_pct', effectPerRank: 3, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'zeitdehnung', branch: 'wirtschaft', name: 'Zeitdehnung', desc: '+2 Std. Obergrenze für die Produktionsgebäude-Aufholung pro Rang.', icon: '⏱️', effectType: 'offline_building_cap_hours_bonus', effectPerRank: 2, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'massenkauf', branch: 'wirtschaft', name: 'Massenkauf', desc: '+5 zusätzliche Auto-Kauf-Käufe pro Tick pro Rang.', icon: '🛒', effectType: 'autobuy_extra_purchases', effectPerRank: 5, ...bkmpPrestigeTierDef('WEAK') },

  /* ---------------- Zweig C: Drachen (10 Knoten, alle neu) ---------------- */
  { id: 'drachenwissen', branch: 'drachen', name: 'Drachenwissen', desc: '+4% Kampf-EP für deinen Begleitdrachen pro Rang.', icon: '📖', effectType: 'dragon_xp_pct', effectPerRank: 4, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'schnelle_reifung', branch: 'drachen', name: 'Schnelle Reifung', desc: '-2% Brutzeit pro Rang (max. 40%, gemeinsam mit Skilltree gedeckelt).', icon: '⏳', effectType: 'brood_time_pct', effectPerRank: 2, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'groesseres_lager', branch: 'drachen', name: 'Größeres Drachenlager', desc: '+1 Lagerplatz pro Rang.', icon: '🏠', effectType: 'dragon_storage_flat', effectPerRank: 1, ...bkmpPrestigeTierDef('WEAK') },
  { id: 'seltene_brut', branch: 'drachen', name: 'Seltene Brut', desc: '+2% Chance auf höhere Ei-Rarität pro Rang.', icon: '🥚', effectType: 'egg_rarity_bonus_pct', effectPerRank: 2, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'maechtige_abstammung', branch: 'drachen', name: 'Mächtige Abstammung', desc: '+2% Hauptwerte (Angriff/Verteidigung/Leben) deines Begleitdrachens pro Rang.', icon: '🧬', effectType: 'companion_stat_pct', effectPerRank: 2, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'futtermeister', branch: 'drachen', name: 'Futtermeister', desc: '+4% Früchte-/Fleischproduktion pro Rang.', icon: '🍖', effectType: 'fruit_meat_prod_pct', effectPerRank: 4, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'sparsame_fuetterung', branch: 'drachen', name: 'Sparsame Fütterung', desc: '+1% Chance auf kostenloses Füttern pro Rang.', icon: '🍎', effectType: 'feed_save_chance_pct', effectPerRank: 1, ...bkmpPrestigeTierDef('SPECIAL') },
  { id: 'aktiver_begleiter', branch: 'drachen', name: 'Aktiver Begleiter', desc: '+2% Wirkung aller Nebenwerte deines aktiven Begleitdrachens pro Rang.', icon: '🐲', effectType: 'companion_all_stat_pct', effectPerRank: 2, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'passive_bindung', branch: 'drachen', name: 'Passive Bindung', desc: '+2% Dorf-Regeneration pro Rang, solange ein Begleitdrache aktiv ist.', icon: '💞', effectType: 'companion_passive_regen_pct', effectPerRank: 2, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'zuchtsegen', branch: 'drachen', name: 'Zuchtsegen', desc: '-2% Nestkosten pro Rang (max. 40%, gemeinsam mit Skilltree gedeckelt).', icon: '✨', effectType: 'nest_cost_pct', effectPerRank: 2, ...bkmpPrestigeTierDef('STRONG') },

  /* ---------------- Zweig D: Runen und Dungeons (10 Knoten, alle neu) ---------------- */
  { id: 'runenglueck', branch: 'runen_dungeon', name: 'Runenglück', desc: '+2% Chance auf höhere Runen-Seltenheit pro Rang.', icon: '🍀', effectType: 'rune_rarity_bonus_pct', effectPerRank: 2, ...bkmpPrestigeTierDef('MEDIUM') },
  /* maxRank bewusst auf 15 begrenzt (nicht die WEAK-Standardgrenze 50) -
     der Effekt ist auf den normalen Runen-Aufwertungs-Maximalwert
     (BKMP_RUNE_MAX_LEVEL=15, siehe bkmp-runes.js) gedeckelt, weitere Raenge
     waeren wirkungslose verschwendete Punkte. */
  { id: 'runenmeister', branch: 'runen_dungeon', name: 'Runenmeister', desc: '+1 Start-Stufe für neu gefundene Runen pro Rang (max. Stufe 15 - der normale Aufwertungs-Höchstwert).', icon: '📿', effectType: 'rune_start_level_bonus', effectPerRank: 1, ...bkmpPrestigeTierDef('WEAK', { maxRank: 15 }) },
  { id: 'effiziente_aufwertung', branch: 'runen_dungeon', name: 'Effiziente Aufwertung', desc: '-1% Runen-Aufwertungskosten pro Rang (max. 20%).', icon: '🔧', effectType: 'rune_upgrade_cost_reduction_pct', effectPerRank: 1, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'schmelzmeister', branch: 'runen_dungeon', name: 'Schmelzmeister', desc: '+3% Runen-Schmelzbelohnung pro Rang.', icon: '🔥', effectType: 'rune_fuse_reward_bonus_pct', effectPerRank: 3, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'dungeonjaeger', branch: 'runen_dungeon', name: 'Dungeonjäger', desc: '+3% Dungeon-Belohnungen pro Rang.', icon: '🗡️', effectType: 'dungeon_reward_pct', effectPerRank: 3, ...bkmpPrestigeTierDef('MEDIUM') },
  /* Schluesselbund: die Schluessel-Regeneration laeuft vollstaendig
     serverseitig (dungeon_regen_calc(), dungeon_get_all_status()/
     dungeon_consume_key() lesen prestige_allocations.schluesselbund direkt
     und rechnen Rang+Paragon-Rang in einen hoeheren Deckel um - siehe
     sql/20260727-fix-dungeon-regen-fixed-slots-and-wire-prestige.sql).
     Schluesselbund aendert NUR den Deckel (wie viele Schluessel maximal
     gehortet werden koennen), NICHT das Zeitraster selbst - das feste
     gemeinsame 0/4/8/12/16/20-Uhr-Raster (Europe/Berlin) gilt seit
     sql/20260803-remove-schluesselmeister-fixed-slots-only.sql wieder
     unbedingt fuer JEDEN Spieler, ohne Ausnahme.

     Der frueher hier stehende Knoten "Schluesselmeister" (+3% schnellere
     Regeneration/Rang, individuelles Zeitraster) wurde am 03.08.2026 auf
     Nutzerwunsch komplett entfernt ("wir haben Feste Schluessel Zeiten. da
     bringt so ein skill nichts") - ein personalisiertes, vom gemeinsamen
     Raster abweichendes Tempo widerspricht direkt dem urspruenglichen
     16.07.-Wunsch nach EINEM gemeinsamen Raster fuer alle Spieler, den die
     Server-Verdrahtung vom 27.07. ungewollt wieder ausgehebelt hatte.
     Bereits investierte Punkte (Basis-Raenge UND Paragon-Raenge) werden
     beim naechsten Laden automatisch zurueckerstattet - siehe
     bkmpPrestigeMigrateSchluesselmeisterRemoval() weiter unten, exakt
     dasselbe Rueckerstattungs-Prinzip wie bei der Schluesselbund-
     Downgrade-Migration direkt darunter. */
  /* Nutzerwunsch 31.07.2026 ("maximal 3 lvl"): reiner Grind-Fix, nur
     maxRank gesenkt (50->3), effectPerRank/Kosten-Basis unveraendert -
     identisches Override-Muster wie bereits bei 'runenmeister' unten
     (maxRank:15). NACHTRAG (gleicher Tag, Fairness-Nachbesserung auf
     Nutzerwunsch): "Paragon dort entfernen" + "fuer alle die dort bereits
     investiert haben zuruckgeben" - anders als der urspruengliche Plan
     (bereits hoehere Bestandsraenge bleiben grandfathered) wollte der
     Nutzer NACH dem ersten Deploy eine echte Gleichbehandlung: jeder
     Spieler (auch wer vorher schon Rang 10-50 hatte) landet einheitlich
     bei maximal Rang 3, ueberschuessige Punkte werden zurueckerstattet.
     paragonEligible:false verhindert zusaetzlich, dass ueber den (durch
     den neuen niedrigen maxRank ploetzlich erreichbaren) Paragon-Pfad
     weiterinvestiert werden kann - siehe bkmpPrestigeMigrateSchluessel-
     bundDowngrade() fuer die eigentliche Rueckerstattungs-Logik. */
  { id: 'schluesselbund', branch: 'runen_dungeon', name: 'Schlüsselbund', desc: '+1 maximale Dungeon-Schlüssel pro Rang.', icon: '🎒', effectType: 'dungeon_key_cap_bonus', effectPerRank: 1, ...bkmpPrestigeTierDef('WEAK', { maxRank: 3, paragonEligible: false }) },
  { id: 'sparsamer_eintritt', branch: 'runen_dungeon', name: 'Sparsamer Eintritt', desc: '+1% Chance, dass ein Dungeon-Lauf keinen Schlüssel verbraucht, pro Rang.', icon: '🚪', effectType: 'dungeon_key_save_chance_pct', effectPerRank: 1, ...bkmpPrestigeTierDef('SPECIAL') },
  { id: 'bosskammer', branch: 'runen_dungeon', name: 'Bosskammer', desc: '+2% zusätzlicher Bonus auf den bestehenden "vollständiger Erfolg"-Multiplikator pro Rang.', icon: '👹', effectType: 'dungeon_success_bonus_pct', effectPerRank: 2, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'seltene_funde', branch: 'runen_dungeon', name: 'Seltene Funde', desc: '+1% zusätzliche Chance auf ein episches/legendäres Ei oder eine seltene Rune im Dungeon pro Rang.', icon: '✨', effectType: 'dungeon_rare_find_bonus_pct', effectPerRank: 1, ...bkmpPrestigeTierDef('MEDIUM') },

  /* ---------------- Zweig E: Automation und Komfort (10 Knoten, alle neu) ----------------
     Nur tatsaechlich sicher integrierbare Funktionen (Auftrag: "keine
     Automation, die das Spiel vollstaendig ohne Entscheidungen spielt").
     'erweiterter_autokauf'/'autokauf_mehrstufig' wirken in dieser
     Architektur auf denselben Hebel (die bestehende Greedy-Kauf-Schleife
     kennt keinen sinnvollen Unterschied zwischen "mehr Kaeufe pro Tick" und
     "mehrere Stufen pro Tick") - ehrlich dokumentiert statt eine zweite,
     nur kuenstlich unterschiedliche Mechanik zu erfinden. */
  { id: 'erweiterter_autokauf', branch: 'automation', name: 'Erweiterter Auto-Kauf', desc: '+5 zusätzliche Auto-Kauf-Käufe pro Tick pro Rang.', icon: '⚙️', effectType: 'autobuy_extra_purchases', effectPerRank: 5, ...bkmpPrestigeTierDef('WEAK') },
  { id: 'autokauf_mehrstufig', branch: 'automation', name: 'Auto-Kauf mehrerer Stufen', desc: '+5 zusätzliche Auto-Kauf-Käufe pro Tick pro Rang (wirkt auf denselben Hebel wie "Erweiterter Auto-Kauf").', icon: '📦', effectType: 'autobuy_extra_purchases', effectPerRank: 5, ...bkmpPrestigeTierDef('WEAK') },
  { id: 'automatische_runenaufwertung', branch: 'automation', name: 'Automatische Runenaufwertung', desc: 'Rüstet automatisch die günstigste bezahlbare Runen-Aufwertung, sobald genug Gold vorhanden ist.', icon: '🔄', effectType: 'auto_rune_upgrade_unlock', effectPerRank: 1, ...bkmpPrestigeTierDef('TOGGLE') },
  { id: 'automatische_eiausbruetung', branch: 'automation', name: 'Automatische Ei-Ausbrütung', desc: 'Legt fertige Eier automatisch in ein freies Nest, sobald eines frei wird.', icon: '🥚', effectType: 'auto_egg_nest_unlock', effectPerRank: 1, ...bkmpPrestigeTierDef('TOGGLE') },
  { id: 'automatische_dungeon_wiederholung', branch: 'automation', name: 'Automatische Dungeon-Wiederholung', desc: 'Der normale "Starten"-Knopf beginnt direkt einen unbegrenzten Auto-Lauf (läuft weiter, bis die Schlüssel ausgehen) - kein Extra-Klick mehr nötig.', icon: '🔁', effectType: 'auto_dungeon_unlimited_unlock', effectPerRank: 1, ...bkmpPrestigeTierDef('TOGGLE') },
  { id: 'automatischer_bosskampf', branch: 'automation', name: 'Automatischer Bosskampf', desc: 'Tritt einem laufenden Weltboss-Raid automatisch bei, sobald er startet.', icon: '🤖', effectType: 'auto_raid_join_unlock', effectPerRank: 1, ...bkmpPrestigeTierDef('TOGGLE') },
  { id: 'gespeicherte_ausruestungssets', branch: 'automation', name: 'Gespeicherte Ausrüstungssets', desc: 'Schaltet einen Schnellspeicher-Slot für deine aktuelle Runen-Ausrüstung frei.', icon: '💾', effectType: 'rune_loadout_unlock', effectPerRank: 1, ...bkmpPrestigeTierDef('TOGGLE') },
  { id: 'hoehere_kampfgeschwindigkeit', branch: 'automation', name: 'Höhere Kampfgeschwindigkeit', desc: '+3% Angriffsgeschwindigkeit pro Rang (wirkt auf denselben Wert wie der Skilltree).', icon: '⚡', effectType: 'attack_speed_pct', effectPerRank: 3, ...bkmpPrestigeTierDef('MEDIUM') },
  { id: 'automatische_prestige_vorschau', branch: 'automation', name: 'Automatische Prestige-Vorschau', desc: 'Zeigt einen Hinweis-Banner, sobald ein Aufstieg möglich ist.', icon: '🔔', effectType: 'auto_prestige_notice_unlock', effectPerRank: 1, ...bkmpPrestigeTierDef('TOGGLE') },
  { id: 'automatische_verteilung', branch: 'automation', name: 'Automatische Verteilung', desc: 'Schaltet einen "Empfohlene Verteilung"-Knopf frei, der verfügbare Prestige-Punkte automatisch nach Kosten sinnvoll verteilt.', icon: '🧭', effectType: 'auto_prestige_allocate_unlock', effectPerRank: 1, ...bkmpPrestigeTierDef('TOGGLE') },

  /* ---------------- Vermächtnis (2 bestehende Knoten, passen thematisch in keinen der 5 Zweige) ---------------- */
  { id: 'zeitraffer', branch: 'legacy', name: 'Zeitraffer', desc: '+8% XP pro Rang - dauerhaft.', icon: '⏳', effectType: 'xp_pct', effectPerRank: 8, ...bkmpPrestigeTierDef('STRONG') },
  { id: 'portal_meisterschaft', branch: 'legacy', name: 'Portal-Meisterschaft', desc: '+8% mehr Prestige-Punkte bei jedem künftigen Aufstieg pro Rang.', icon: '🌌', effectType: 'prestige_point_bonus_pct', effectPerRank: 8, ...BKMP_PRESTIGE_TIER_SELF_REINFORCING }
];

const BKMP_PRESTIGE_BRANCHES = [
  { id: 'kampf', name: 'Kampf', icon: '⚔️' },
  { id: 'wirtschaft', name: 'Wirtschaft', icon: '💰' },
  { id: 'drachen', name: 'Drachen', icon: '🐉' },
  { id: 'runen_dungeon', name: 'Runen & Dungeons', icon: '💠' },
  { id: 'automation', name: 'Automation', icon: '⚙️' },
  { id: 'legacy', name: 'Vermächtnis', icon: '🌌' }
];

function bkmpPrestigeNodeById(id) {
  return BKMP_PRESTIGE_UPGRADES.find(d => d.id === id) || null;
}

function bkmpPrestigeUpgradeCost(def, rankBeingBought) {
  return Math.max(1, Math.round(def.baseCost * Math.pow(def.costGrowth, rankBeingBought)));
}

/* ---------------- Paragon (Phase 8) ----------------
   Nach Erreichen des normalen Maximalrangs eines Knotens kann bei
   PARAGON-faehigen Knoten (kein Chance-/Toggle-Typ, siehe
   BKMP_PRESTIGE_TIER.*.paragonEligible) weiter investiert werden - deutlich
   schwaecherer Bonus/Rang (4% des normalen effectPerRank), theoretisch
   sehr hohes aber endliches Cap (1.000 statt "unbegrenzt", verhindert
   echte Zahlenexplosion), steil wachsende Kosten (Kosten-Kurve setzt NAHT-
   LOS an der Stelle fort, an der der normale Baum aufgehoert hat - kein
   ploetzlicher Preissprung an der Uebergangsstelle -, waechst DANACH aber
   mit einem um 0.15 hoeheren Wachstumsfaktor weiter). Gespeichert im
   SELBEN prestige_allocations-JSONB unter einem eigenen Schluessel
   (`${id}__paragon`) - KEINE neue SQL-Spalte/-Tabelle noetig, identisches
   Prinzip wie bei den normalen Knoten. */
const BKMP_PRESTIGE_PARAGON_MAX_RANK = 1000;
const BKMP_PRESTIGE_PARAGON_EFFECT_RATIO = 0.04;
const BKMP_PRESTIGE_PARAGON_GROWTH_BONUS = 0.15;

function bkmpPrestigeParagonKey(id) {
  return `${id}__paragon`;
}
function bkmpPrestigeParagonEligible(def) {
  return def.paragonEligible !== false && def.maxRank > 1;
}
function bkmpPrestigeParagonCost(def, paragonRankBeingBought) {
  // Kosten des normalen Baums bis maxRank + fortgesetzte, steilere Kurve fuer Paragon-Raenge danach.
  const baseAtCap = def.baseCost * Math.pow(def.costGrowth, def.maxRank);
  const paragonGrowth = def.costGrowth + BKMP_PRESTIGE_PARAGON_GROWTH_BONUS;
  const raw = baseAtCap * Math.pow(paragonGrowth, paragonRankBeingBought);
  /* Progression-Rebalance Phase 12 (Zahlensicherheit, 26.07.2026): bei sehr
     hohen Paragon-Raengen (nahe BKMP_PRESTIGE_PARAGON_MAX_RANK=1000) kann
     die Kurve auf einen zwar noch endlichen, aber ausserhalb der sicheren
     Ganzzahl-Praezision (Number.MAX_SAFE_INTEGER) liegenden Wert wachsen -
     Math.round() waere dort nicht mehr exakt. Gedeckelt: ab dieser Grenze
     bleibt der Preis einfach konstant auf MAX_SAFE_INTEGER stehen (der
     Knoten wird dadurch faktisch nie mehr bezahlbar, was fuer so extreme
     Raenge ohnehin die Erwartung ist - kein Crash, kein NaN/Infinity). */
  if (!Number.isFinite(raw) || raw > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.round(raw));
}
function bkmpPrestigeParagonEffectPerRank(def) {
  return def.effectPerRank * BKMP_PRESTIGE_PARAGON_EFFECT_RATIO;
}

/* Generischer Einzelwert-Zugriff auf einen Prestige-Effekt-Typ - identisches
   Muster wie bkmpDragonSkillBonus()/bkmpDragonPrestigeBonus() (bkmp-
   breeding.js), hier aber dateiuebergreifend nutzbar (Dungeon/Runen/
   Kern-Kampf-Formel brauchen dieselbe Abfrage, ohne von bkmp-breeding.js
   abzuhaengen). */
function bkmpPrestigeBonus(key) {
  if (!bkmpPrestigeState) return 0;
  return bkmpPrestigeEffectTotals(bkmpPrestigeState.prestige_allocations)[key] || 0;
}

function bkmpPrestigeEffectTotals(allocations) {
  const totals = {};
  const alloc = allocations || {};
  BKMP_PRESTIGE_UPGRADES.forEach(def => {
    const rank = Number(alloc[def.id] || 0);
    if (rank > 0) totals[def.effectType] = (totals[def.effectType] || 0) + rank * def.effectPerRank;
    if (bkmpPrestigeParagonEligible(def)) {
      const paragonRank = Number(alloc[bkmpPrestigeParagonKey(def.id)] || 0);
      if (paragonRank > 0) totals[def.effectType] = (totals[def.effectType] || 0) + paragonRank * bkmpPrestigeParagonEffectPerRank(def);
    }
  });
  return totals;
}

/* Spieler-Idee Kaledoss (28.07.2026, Feedback-Board): "Den Skill Tree in
   Prioritäten/Reihenfolgen Sortieren für einen 'Auto Kauf', da nun mit den
   neuen Abläufen es möglicherweise zu repetitiv werden könnte" - bezieht
   sich auf den seit der Progression-Rebalance auf 52 Knoten gewachsenen
   Baum (5 Zweige + Vermächtnis, vorher 6 Knoten). Statt einer Priorität
   pro einzelnem Knoten (52 Eintraege waeren unhandlich) laesst sich die
   REIHENFOLGE DER ZWEIGE festlegen - "Automatische Verteilung" leert dann
   den hoechst-priorisierten Zweig zuerst (nach Kosten sortiert innerhalb
   des Zweigs) und geht erst danach zum naechsten Zweig ueber, statt Punkte
   nach reinem Preis quer ueber alle 6 Zweige zu verstreuen. Rein lokal
   (localStorage) - Standardreihenfolge = die bereits bestehende, deklarierte
   BKMP_PRESTIGE_BRANCHES-Reihenfolge (identisches Verhalten wie vorher, bis
   der Spieler aktiv umsortiert). */
const BKMP_PRESTIGE_AUTOALLOCATE_PRIORITY_KEY = 'bkmp-idle-prestige-autoallocate-priority';
function bkmpPrestigeGetAutoAllocatePriority() {
  const allIds = BKMP_PRESTIGE_BRANCHES.map(b => b.id);
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(BKMP_PRESTIGE_AUTOALLOCATE_PRIORITY_KEY) || '[]'); } catch (e) { saved = []; }
  if (!Array.isArray(saved)) saved = [];
  // Nur bekannte Zweig-IDs uebernehmen (schuetzt gegen veraltete/erfundene
  // Werte), fehlende (z.B. ein spaeter neu hinzugekommener Zweig) hinten anhaengen.
  const known = saved.filter(id => allIds.includes(id));
  const missing = allIds.filter(id => !known.includes(id));
  return [...known, ...missing];
}
function bkmpPrestigeSetAutoAllocatePriority(order) {
  try { localStorage.setItem(BKMP_PRESTIGE_AUTOALLOCATE_PRIORITY_KEY, JSON.stringify(order)); } catch (e) {}
}
function bkmpPrestigeMoveBranchPriority(branchId, direction) {
  const order = bkmpPrestigeGetAutoAllocatePriority();
  const idx = order.indexOf(branchId);
  const target = idx + direction;
  if (idx < 0 || target < 0 || target >= order.length) return;
  [order[idx], order[target]] = [order[target], order[idx]];
  bkmpPrestigeSetAutoAllocatePriority(order);
}
function bkmpPrestigeRenderAutoAllocatePriorityHtml() {
  const order = bkmpPrestigeGetAutoAllocatePriority();
  return `<div class="idle-prestige-priority-list">
    <div class="idle-prestige-priority-label">🧭 Auto-Kauf-Priorität (oben = zuerst leergekauft):</div>
    ${order.map((branchId, i) => {
      const b = BKMP_PRESTIGE_BRANCHES.find(x => x.id === branchId);
      if (!b) return '';
      return `<div class="idle-prestige-priority-row">
        <span class="idle-prestige-priority-rank">${i + 1}.</span>
        <span class="idle-prestige-priority-name">${b.icon} ${escapeHtml(b.name)}</span>
        <button type="button" class="idle-prestige-priority-btn idle-prestige-priority-up" data-branch="${branchId}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="${escapeHtml(b.name)} nach oben">▲</button>
        <button type="button" class="idle-prestige-priority-btn idle-prestige-priority-down" data-branch="${branchId}" data-dir="1" ${i === order.length - 1 ? 'disabled' : ''} aria-label="${escapeHtml(b.name)} nach unten">▼</button>
      </div>`;
    }).join('')}
  </div>`;
}

/* Prestige-Knoten "Automatische Verteilung" (Zweig Automation, 26.07.2026):
   verteilt alle GERADE VERFUEGBAREN Punkte automatisch nach der oben
   konfigurierbaren Zweig-Prioritaet, INNERHALB eines Zweigs weiterhin nach
   Kosten (immer die guenstigste noch kaufbare Option zuerst) - einfache,
   aber echte Automation (kein Vorab-gespeichertes Node-Template noetig).
   Nutzt exakt dieselbe bkmpPrestigeBuyUpgrade()-Funktion wie ein manueller
   Klick - kein zweiter Kaufpfad. */
function bkmpPrestigeAutoAllocate() {
  if (!bkmpPrestigeState) return;
  const priorityOrder = bkmpPrestigeGetAutoAllocatePriority();
  let guard = 0;
  while (guard < 500) {
    guard++;
    const alloc = bkmpPrestigeState.prestige_allocations || {};
    const available = Number(bkmpPrestigeState.prestige_points || 0) - Number(bkmpPrestigeState.prestige_points_spent || 0);
    const options = BKMP_PRESTIGE_UPGRADES
      .filter(def => bkmpPrestigeBranchUnlocked(def.branch))
      .map(def => ({ def, rank: Number(alloc[def.id] || 0) }))
      .filter(({ def, rank }) => rank < def.maxRank)
      .map(({ def, rank }) => ({ def, cost: bkmpPrestigeUpgradeCost(def, rank + 1) }))
      .filter(({ cost }) => available >= cost)
      .sort((a, b) => {
        const branchDiff = priorityOrder.indexOf(a.def.branch) - priorityOrder.indexOf(b.def.branch);
        if (branchDiff !== 0) return branchDiff;
        return a.cost - b.cost;
      });
    if (options.length === 0) break;
    bkmpPrestigeBuyUpgrade(options[0].def.id);
  }
}

function bkmpPrestigeBuyParagon(id) {
  const def = bkmpPrestigeNodeById(id);
  if (!def || !bkmpPrestigeState || !bkmpPrestigeParagonEligible(def)) return;
  const alloc = bkmpPrestigeState.prestige_allocations || (bkmpPrestigeState.prestige_allocations = {});
  const normalRank = Number(alloc[id] || 0);
  if (normalRank < def.maxRank) return; // Paragon erst nach vollem normalen Maximalrang
  const paragonKey = bkmpPrestigeParagonKey(id);
  const paragonRank = Number(alloc[paragonKey] || 0);
  if (paragonRank >= BKMP_PRESTIGE_PARAGON_MAX_RANK) return;
  const cost = bkmpPrestigeParagonCost(def, paragonRank + 1);
  const available = Number(bkmpPrestigeState.prestige_points || 0) - Number(bkmpPrestigeState.prestige_points_spent || 0);
  if (available < cost) return;
  alloc[paragonKey] = paragonRank + 1;
  bkmpPrestigeState.prestige_points_spent = Number(bkmpPrestigeState.prestige_points_spent || 0) + cost;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderPrestigePanel();
  bkmpIdleRenderHud();
  bkmpPrestigeQueueSave();
}

/* ---------------- Prestige-Meilensteine (Phase 7) ----------------
   Deterministisch aus `prestige_points_spent` (bereits vorhandenes,
   monoton wachsendes Feld - siehe bkmpPrestigeBuyUpgrade/-BuyParagon, wird
   NIE verringert) - kein eigener Claim-Zustand, kein Doppel-Trigger
   moeglich, ueberlebt Reload automatisch, identisches Prinzip wie die
   Upgrade-Meilensteine (Phase 4, idledorf.js). */
const BKMP_PRESTIGE_MILESTONES = [
  { points: 25, name: 'Erste Meisterschaft', desc: '+2% Angriff dauerhaft.', effectType: 'attack_pct', effectValue: 2 },
  { points: 50, name: 'Schlüsselbewahrer', desc: '+1 maximale Dungeon-Schlüssel (alle Typen).', effectType: 'dungeon_key_cap_bonus', effectValue: 1 },
  { points: 100, name: 'Erweiterter Baum', desc: 'Schaltet die Zweige "Runen & Dungeons" und "Automation" frei.', effectType: null, effectValue: 0, unlocksBranches: ['runen_dungeon', 'automation'] },
  { points: 200, name: 'Drachenbund', desc: '+3% Schaden deines aktiven Begleitdrachens dauerhaft.', effectType: 'companion_dmg_pct', effectValue: 3 },
  { points: 350, name: 'Jenseits der Grenze', desc: 'Schaltet das Paragon-System frei: voll ausgebaute Skills lassen sich damit weiter aufwerten - mit denselben Prestige-Punkten, nur schwächer pro Rang (4%) und ohne Maximum.', effectType: null, effectValue: 0, unlocksParagon: true },
  { points: 500, name: 'Aufstieg', desc: 'Schaltet die zweite Prestige-Ebene ("Aufstieg", neue Währung Drachenseelen) frei, sofern die Voraussetzungen erfüllt sind.', effectType: null, effectValue: 0, unlocksAscension: true },
  { points: 750, name: 'Wirtschaftswunder', desc: '+5% Gold- und XP-Ausbeute dauerhaft.', effectType: null, effectValue: 0, custom: 'wirtschaftswunder' },
  { points: 1000, name: 'Punkte-Legende', desc: '+5% Bossschaden dauerhaft.', effectType: 'boss_dmg_pct', effectValue: 5 }
];
function bkmpPrestigeMilestonesReached(pointsSpent) {
  return BKMP_PRESTIGE_MILESTONES.filter(m => pointsSpent >= m.points);
}
function bkmpPrestigeNextMilestone(pointsSpent) {
  return BKMP_PRESTIGE_MILESTONES.find(m => pointsSpent < m.points) || null;
}
function bkmpPrestigeMilestoneEffectTotals(pointsSpent) {
  const totals = {};
  bkmpPrestigeMilestonesReached(pointsSpent).forEach(m => {
    if (m.effectType) totals[m.effectType] = (totals[m.effectType] || 0) + m.effectValue;
    if (m.custom === 'wirtschaftswunder') {
      totals.gold_prod_pct = (totals.gold_prod_pct || 0) + 5;
      totals.xp_pct = (totals.xp_pct || 0) + 5;
    }
  });
  return totals;
}
/* Prestige-Knoten "Automatische Prestige-Vorschau" (Zweig Automation,
   26.07.2026): zeigt ein kleines "!"-Abzeichen direkt am Prestige-Tab-
   Button, sobald ein Aufstieg moeglich ist - sichtbar auch von ANDEREN
   Tabs aus, nicht nur beim bereits offenen Prestige-Panel selbst (das
   zeigt die Eligibility ohnehin schon ueber den "Jetzt aufsteigen"-Knopf). */
function bkmpPrestigeUpdateTabBadge() {
  const btn = document.getElementById('idleTabBtnPrestige');
  if (!btn) return;
  const unlocked = typeof bkmpPrestigeBonus === 'function' && bkmpPrestigeBonus('auto_prestige_notice_unlock') > 0;
  const eligible = unlocked && typeof bkmpPrestigeEligible === 'function' && bkmpPrestigeEligible();
  let badge = btn.querySelector('.idle-prestige-tab-badge');
  if (eligible) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'idle-prestige-tab-badge';
      badge.textContent = '!';
      btn.appendChild(badge);
    }
  } else if (badge) {
    badge.remove();
  }
}

function bkmpPrestigeBranchUnlocked(branchId) {
  if (branchId !== 'runen_dungeon' && branchId !== 'automation') return true; // alle anderen Zweige immer sichtbar
  const spent = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points_spent || 0) : 0;
  return bkmpPrestigeMilestonesReached(spent).some(m => Array.isArray(m.unlocksBranches) && m.unlocksBranches.includes(branchId));
}
function bkmpPrestigeParagonSystemUnlocked() {
  const spent = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points_spent || 0) : 0;
  return bkmpPrestigeMilestonesReached(spent).some(m => m.unlocksParagon === true);
}
/* Spieler-Verwirrung (28.07.2026, mehrere Nachfragen): "Paragon" tauchte
   bisher kommentarlos an einem Skill auf, sobald der Meilenstein "Jenseits
   der Grenze" (350 investierte Punkte) im Hintergrund erreicht wurde -
   niemand hat je erklaert bekommen, WAS das ist oder WOHER die Raenge
   kommen (dieselben Prestige-Punkte wie der normale Baum, keine eigene
   Waehrung). Einmaliger Toast beim tatsaechlichen Ueberschreiten der
   Schwelle statt eines stillen Erscheinens - bkmpUiShowToast() (Phase 3,
   bisher ungenutzt) ist genau fuer solche bedeutungsvollen Momente gebaut.
   localStorage-Flag verhindert Wiederholung bei jedem Panel-Render. */
const BKMP_PRESTIGE_PARAGON_ANNOUNCED_KEY = 'bkmp-idle-paragon-announced';
function bkmpPrestigeMaybeAnnounceParagonUnlock() {
  if (!bkmpPrestigeParagonSystemUnlocked()) return;
  try {
    if (localStorage.getItem(BKMP_PRESTIGE_PARAGON_ANNOUNCED_KEY) === '1') return;
    localStorage.setItem(BKMP_PRESTIGE_PARAGON_ANNOUNCED_KEY, '1');
  } catch (e) { return; }
  if (typeof bkmpUiShowToast === 'function') {
    bkmpUiShowToast({ text: '🌠 Paragon freigeschaltet! Voll ausgebaute Skills lassen sich jetzt mit denselben Prestige-Punkten weiter aufwerten (schwächer pro Rang, aber ohne Maximum).', kind: 'success', ms: 6000 });
  }
}
function bkmpAscensionMilestoneUnlocked() {
  const spent = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points_spent || 0) : 0;
  return bkmpPrestigeMilestonesReached(spent).some(m => m.unlocksAscension === true);
}

function bkmpPrestigeEligible() {
  if (!bkmpIdleState) return false;
  /* Bei fehlgeschlagenem Laden NICHT wie "prestige_level 0" behandeln -
     das wuerde die Mindeststufe zu niedrig ansetzen und den Button
     freischalten, obwohl der echte (aber gerade nicht geladene) Stand
     schon viel weiter ist. */
  if (bkmpPrestigeLoadFailed) return false;
  const level = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : 0;
  return Number(bkmpIdleState.highest_dragon_index || 0) >= bkmpPrestigeRequiredStage(level);
}

/* Faustformel: (Stufe/20)^1.15, abgerundet - Stufe 100 -> 6 Punkte,
   Stufe 200 -> 14, Stufe 500 -> 41. Bewusst kein reines Geschenk: ein
   Aufstieg lohnt sich erst, wenn man deutlich ueber die Mindeststufe
   hinausgekommen ist. */
function bkmpPrestigePointsForStage(stage) {
  return Math.max(0, Math.floor(Math.pow(Math.max(0, stage) / 20, 1.15)));
}

function bkmpPrestigeBuyUpgrade(id) {
  const def = BKMP_PRESTIGE_UPGRADES.find(u => u.id === id);
  if (!def || !bkmpPrestigeState) return;
  const alloc = bkmpPrestigeState.prestige_allocations || (bkmpPrestigeState.prestige_allocations = {});
  const rank = Number(alloc[id] || 0);
  if (rank >= def.maxRank) return;
  const cost = bkmpPrestigeUpgradeCost(def, rank + 1);
  const available = Number(bkmpPrestigeState.prestige_points || 0) - Number(bkmpPrestigeState.prestige_points_spent || 0);
  if (available < cost) return;
  alloc[id] = rank + 1;
  bkmpPrestigeState.prestige_points_spent = Number(bkmpPrestigeState.prestige_points_spent || 0) + cost;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderPrestigePanel();
  bkmpIdleRenderHud();
  bkmpPrestigeQueueSave();
}

/* Gleiche Twitch-Sync-Absicherung wie bkmpIdleMergeBaseline/
   -RemoteSpendableFields oben, nur fuer die separate idle_prestige_state-
   Tabelle (Prestige-Punkte fuer den permanenten Bonusbaum). */
let bkmpPrestigeMergeBaseline = null;
let bkmpPrestigeSkipNextMerge = false;

function bkmpPrestigeSnapshotMergeBaseline() {
  bkmpPrestigeMergeBaseline = bkmpPrestigeState ? { prestige_points_spent: Number(bkmpPrestigeState.prestige_points_spent || 0) } : null;
}

/* Nutzerwunsch 31.07.2026 (Fairness-Nachbesserung, siehe Kommentar am
   'schluesselbund'-Knoten oben): jeder Spieler landet einheitlich bei
   maximal Rang 3 - wer vorher schon mehr investiert hatte (normale Raenge
   ueber 3 ODER die zwischenzeitlich durch den frueheren maxRank-Fix kurz
   erreichbaren Paragon-Raenge), bekommt die dafuer ausgegebenen Prestige-
   Punkte zurueck, statt sie grandfathered zu behalten. bkmpPrestigeUpgrade-
   Cost() haengt NICHT von maxRank ab (nur baseCost/costGrowth, die
   unveraendert blieben) - die Rueckerstattung fuer bereits vor der
   Aenderung gekaufte hoehere Raenge ist dadurch exakt, kein Schaetzwert.
   Idempotent: ein Spieler, der schon bei Rang<=3 ohne Paragon steht (der
   allergroesste Teil), verlaesst die Funktion sofort ohne jede Mutation -
   sicher bei jedem Laden erneut aufrufbar. */
function bkmpPrestigeMigrateSchluesselbundDowngrade() {
  if (!bkmpPrestigeState) return;
  const def = bkmpPrestigeNodeById('schluesselbund');
  if (!def) return;
  const alloc = bkmpPrestigeState.prestige_allocations || (bkmpPrestigeState.prestige_allocations = {});
  const rank = Number(alloc.schluesselbund || 0);
  const paragonRank = Number(alloc.schluesselbund__paragon || 0);
  if (rank <= def.maxRank && paragonRank <= 0) return; // haeufigster Fall: nichts zu tun

  let refund = 0;
  for (let r = def.maxRank + 1; r <= rank; r++) refund += bkmpPrestigeUpgradeCost(def, r);
  for (let p = 1; p <= paragonRank; p++) refund += bkmpPrestigeParagonCost(def, p);

  alloc.schluesselbund = Math.min(rank, def.maxRank);
  if (paragonRank > 0) delete alloc.schluesselbund__paragon;
  bkmpPrestigeState.prestige_points_spent = Math.max(0, Number(bkmpPrestigeState.prestige_points_spent || 0) - refund);
  bkmpPrestigeSnapshotMergeBaseline(); // Baseline auf den bereits korrigierten Stand ziehen, sonst wuerde der naechste Remote-Merge die Rueckerstattung wieder verwerfen
  bkmpPrestigeQueueSave();
}

/* Nutzerwunsch 03.08.2026 ("wir haben Feste Schluessel Zeiten. da bringt
   so ein skill nichts"): der Knoten "Schluesselmeister" wurde komplett aus
   BKMP_PRESTIGE_UPGRADES entfernt (siehe Kommentar an der ehemaligen
   Katalogstelle oben) - diese Funktion erstattet jedem Spieler, der schon
   Punkte hineininvestiert hatte (Basis-Raenge UND Paragon-Raenge), diese
   vollstaendig zurueck. Anders als bkmpPrestigeMigrateSchluesselbundDowngrade
   (Rang wird nur GEKAPPT, der Knoten existiert weiter) verschwindet hier
   die komplette Zuteilung - der Knoten ist ja nicht mehr im Katalog, ein
   Rang>0 waere sonst dauerhaft "totes", nie mehr nutzbares Guthaben.
   bkmpPrestigeTierDef('MEDIUM') liefert dieselbe Kostenformel (baseCost/
   costGrowth), die der Knoten hatte, solange er noch im Katalog stand -
   die Formel haengt nur vom Tier-Namen ab, nicht davon, ob der Knoten noch
   existiert, die Rueckerstattung bleibt dadurch exakt, kein Schaetzwert.
   Idempotent: ein Spieler ohne jede Schluesselmeister-Investition (der
   ganz ueberwiegende Teil) verlaesst die Funktion sofort ohne Mutation. */
function bkmpPrestigeMigrateSchluesselmeisterRemoval() {
  if (!bkmpPrestigeState) return;
  const alloc = bkmpPrestigeState.prestige_allocations || (bkmpPrestigeState.prestige_allocations = {});
  const rank = Number(alloc.schluesselmeister || 0);
  const paragonRank = Number(alloc.schluesselmeister__paragon || 0);
  if (rank <= 0 && paragonRank <= 0) return; // haeufigster Fall: nichts zu tun

  const legacyDef = bkmpPrestigeTierDef('MEDIUM'); // exakt die Tier-Werte, die der Knoten hatte, solange er noch im Katalog stand
  let refund = 0;
  for (let r = 1; r <= rank; r++) refund += bkmpPrestigeUpgradeCost(legacyDef, r);
  for (let p = 1; p <= paragonRank; p++) refund += bkmpPrestigeParagonCost(legacyDef, p);

  delete alloc.schluesselmeister;
  delete alloc.schluesselmeister__paragon;
  bkmpPrestigeState.prestige_points_spent = Math.max(0, Number(bkmpPrestigeState.prestige_points_spent || 0) - refund);
  bkmpPrestigeSnapshotMergeBaseline(); // Baseline auf den bereits korrigierten Stand ziehen, sonst wuerde der naechste Remote-Merge die Rueckerstattung wieder verwerfen
  bkmpPrestigeQueueSave();
}

/* Gleicher Race-Fix wie bkmpIdleMergeInFlight bei
   bkmpIdleMergeRemoteSpendableFields - siehe dort fuer die volle
   Erklaerung (ueberlappende Herzschlag-/Autosave-Aufrufe konnten sich
   sonst mit unterschiedlich "frischen" remote/baseline-Staenden
   ueberschneiden). */
let bkmpPrestigeMergeInFlight = false;
async function bkmpPrestigeMergeRemoteSpendable() {
  if (!bkmpPrestigeState || typeof loadIdlePrestigeState !== 'function') return;
  if (bkmpPrestigeMergeInFlight) return;
  bkmpPrestigeMergeInFlight = true;
  try {
  const remote = await loadIdlePrestigeState(bkmpPrestigeState.name_key);
  if (!remote) return;
  bkmpPrestigeState.prestige_allocations = bkmpIdleMergeCountMaps(bkmpPrestigeState.prestige_allocations, remote.prestige_allocations);
  const baseline = bkmpPrestigeMergeBaseline || bkmpPrestigeState;
  const spentDelta = Number(bkmpPrestigeState.prestige_points_spent || 0) - Number(baseline.prestige_points_spent || 0);
  bkmpPrestigeState.prestige_points_spent = Math.max(0, Number(remote.prestige_points_spent || 0) + Math.max(0, spentDelta));
  bkmpPrestigeState.prestige_points = Math.max(Number(bkmpPrestigeState.prestige_points || 0), Number(remote.prestige_points || 0));
  bkmpPrestigeSnapshotMergeBaseline();
  } finally {
    bkmpPrestigeMergeInFlight = false;
  }
}

let bkmpPrestigeSaveTimer = null;
function bkmpPrestigeQueueSave() {
  if (bkmpPrestigeSaveTimer) return;
  bkmpPrestigeSaveTimer = window.setTimeout(() => { bkmpPrestigeSaveTimer = null; bkmpPrestigeFlushSave(); }, 1500);
}

async function bkmpPrestigeFlushSave() {
  if (!bkmpPrestigeState) return;
  if (window.BKMP_IDLE_IS_STREAM_PAGE && !bkmpPrestigeSkipNextMerge) {
    try { await bkmpPrestigeMergeRemoteSpendable(); } catch (e) { /* naechster Speichervorgang versucht es erneut */ }
  }
  bkmpPrestigeSkipNextMerge = false;
  try {
    if (typeof saveIdlePrestigeState === 'function') await saveIdlePrestigeState(bkmpPrestigeState);
    bkmpPrestigeSnapshotMergeBaseline();
  } catch (e) { console.warn('Prestige: Speichern fehlgeschlagen (Migration ausgefuehrt?).', e); }
}

/* Erzwingt ein sofortiges Speichern des Prestige-Standes, ohne auf den
   1,5s-Debounce zu warten - gebraucht vom Single-Session-Rauswurf
   (bkmpClaimAndWatchSession in index.html), damit die letzten paar Sekunden
   Fortschritt nicht verloren gehen, wenn ein Geraet durch ein Login
   anderswo zwangsweise beendet wird. */
async function bkmpPrestigeFlushSyncNow() {
  if (bkmpPrestigeSaveTimer) { window.clearTimeout(bkmpPrestigeSaveTimer); bkmpPrestigeSaveTimer = null; }
  if (!bkmpPrestigeState) return;
  try { if (typeof saveIdlePrestigeState === 'function') await saveIdlePrestigeState(bkmpPrestigeState); }
  catch (e) { console.warn('Prestige: Speichern fehlgeschlagen.', e); }
}

// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). (2b-Ergaenzung)

/* ============================================================
   Section C (18.07.): Prestige-Zeremonie-Redesign. Ersetzt NUR die
   Praesentationsschicht (Panel-Layout, Bestaetigungsablauf, Erfolgs-
   Zeremonie) - die Rechenlogik/Reset-Reihenfolge/Speicherlogik unterhalb
   (bkmpPrestigeExecuteReset) ist wortwoertlich unveraendert aus der
   vorherigen bkmpIdlePerformPrestige uebernommen, nur in eine eigene
   Funktion ausgelagert, die jetzt vom neuen zweistufigen Bestaetigungs-
   Dialog statt einem einzelnen bkmpConfirmDialog() aufgerufen wird.

   bkmpPrestigeGetPreview() ist die EINZIGE Quelle der Wahrheit fuer alle
   angezeigten Zahlen (Panel UND Dialog UND Zeremonie) - liest nur,
   veraendert nichts, damit Anzeige und tatsaechliches Ergebnis nie
   auseinanderlaufen koennen. */
function bkmpPrestigeGetPreview() {
  if (!bkmpIdleState) return null;
  const stage = Number(bkmpIdleState.highest_dragon_index || 0);
  const level = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : 0;
  const requiredStage = bkmpPrestigeRequiredStage(level);
  const bonusPct = bkmpPrestigeState ? (bkmpPrestigeEffectTotals(bkmpPrestigeState.prestige_allocations).prestige_point_bonus_pct || 0) : 0;
  const pointsGained = Math.max(1, Math.round(bkmpPrestigePointsForStage(stage) * (1 + bonusPct / 100)));
  const totalPointsBefore = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points || 0) : 0;
  return {
    stage, level, requiredStage,
    eligible: bkmpPrestigeEligible(),
    pointsGained,
    totalPointsBefore,
    totalPointsAfter: totalPointsBefore + pointsGained,
    runeCount: bkmpIdlePlayerRunes.length,
    currentBonusPct: level * 5,
    nextLevel: level + 1,
    nextBonusPct: (level + 1) * 5,
    nextRequiredStage: bkmpPrestigeRequiredStage(level + 1),
    dragonKills: Number(bkmpIdleState.dragon_kills || 0),
    bossKills: Number(bkmpIdleState.boss_kills || 0),
    lifetimeStage: typeof bkmpIdleLifetimeStageCount === 'function' ? bkmpIdleLifetimeStageCount() : (Number(bkmpIdleState.prestige_stage_offset || 0) + stage),
    playtimeMinutes: Math.round(Number(bkmpIdleState.playtime_seconds || 0) / 60)
  };
}

/* Nur tatsaechlich zurueckgesetzte Werte (1:1 gegen bkmpPrestigeExecuteReset
   unten geprueft) - keine erfundenen Eintraege. */
function bkmpPrestigeResetItems(preview) {
  const p = preview || bkmpPrestigeGetPreview();
  if (!p) return [];
  return [
    { icon: '📉', text: 'Level (zurück auf 1) und alle Erfahrungspunkte' },
    { icon: '💰', text: 'Alle Rohstoffe: Gold, Holz, Stein, Kristalle, Essenz' },
    { icon: '🌳', text: 'Skilltree – alle Skillpunkte und ihre Verteilung' },
    { icon: '⬆️', text: 'Gekaufte Dorf-Upgrades' },
    { icon: '🏭', text: 'Alle Produktionsgebäude (Obstgarten, Jagdhütte, Holzfällerlager, Steinbruch, Goldmine, Kristallmine, Manaquelle, Magierakademie)' },
    { icon: '🐉', text: `Deine aktuelle Drachen-Stufe (${bkmpIdleFormatStage(p.stage)}) – du startest wieder bei Stufe 0-0` }
  ];
}

/* Nur tatsaechlich permanente Inhalte - Erfolge/Titel/Kosmetiken werden
   bewusst mit aufgefuehrt (existierende Systeme, aber vom Reset-Block in
   bkmpPrestigeExecuteReset nachweislich nie angefasst), keine fremden
   Systeme neu erfunden. */
function bkmpPrestigeKeepItems(preview) {
  const p = preview || bkmpPrestigeGetPreview();
  if (!p) return [];
  return [
    { icon: '🌌', text: `Prestige-Stufe ${p.nextLevel} und dein permanenter Bonusbaum (${bkmpIdleFormatNumber(p.totalPointsAfter)} Punkte gesamt)` },
    { icon: '✨', text: `Dauerhafter Bonus: +${p.nextBonusPct}% Angriff/Leben/Gold/XP` },
    { icon: '💠', text: p.runeCount > 0 ? `Deine komplette Runen-Sammlung (${bkmpIdleFormatNumber(p.runeCount)} Runen inkl. Ausrüstung, Stufen &amp; Sub-Stats)` : 'Deine Runen-Sammlung (aktuell leer)' },
    { icon: '🏆', text: 'Erfolge, Titel &amp; Kosmetiken' },
    { icon: '⚔️', text: `Gesamt besiegte Drachen (${bkmpIdleFormatNumber(p.dragonKills)}) &amp; Bosse (${bkmpIdleFormatNumber(p.bossKills)})` },
    { icon: '📈', text: `Insgesamt erreichte Drachen-Stufen (${bkmpIdleFormatNumber(p.lifetimeStage)})` },
    { icon: '⏱️', text: `Deine gesamte Spielzeit (${bkmpIdleFormatNumber(p.playtimeMinutes)} Min.)` }
  ];
}

function bkmpPrestigeRenderInfoList(items) {
  return `<ul class="idle-prestige-list">${items.map(i => `<li><span class="idle-prestige-list-icon" aria-hidden="true">${i.icon}</span><span>${i.text}</span></li>`).join('')}</ul>`;
}

/* ---------------- Zweistufiger Bestaetigungsdialog ---------------- */
let bkmpPrestigeConfirmPreview = null;
let bkmpPrestigeConfirmSubmitting = false;
let bkmpPrestigeConfirmErrored = false;

function bkmpPrestigeOpenConfirmFlow() {
  const overlay = document.getElementById('idlePrestigeConfirmOverlay');
  const preview = bkmpPrestigeGetPreview();
  if (!overlay || !preview || !preview.eligible) return;
  bkmpPrestigeConfirmPreview = preview;
  bkmpPrestigeConfirmSubmitting = false;
  bkmpPrestigeRenderConfirmStep('preview');
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');
  const nextBtn = document.getElementById('idlePrestigeConfirmNextBtn');
  if (nextBtn) nextBtn.focus();
}

function bkmpPrestigeRenderConfirmStep(step) {
  const overlay = document.getElementById('idlePrestigeConfirmOverlay');
  if (!overlay || !bkmpPrestigeConfirmPreview) return;
  const p = bkmpPrestigeConfirmPreview;
  overlay.dataset.step = step;
  const gainEl = document.getElementById('idlePrestigeConfirmGain');
  if (gainEl) gainEl.innerHTML = `+${bkmpIdleFormatNumber(p.pointsGained)} Prestige-Punkte &middot; neuer dauerhafter Bonus +${p.nextBonusPct}%`;
  const resetEl = document.getElementById('idlePrestigeConfirmResetList');
  if (resetEl) resetEl.innerHTML = bkmpPrestigeRenderInfoList(bkmpPrestigeResetItems(p));
  const keepEl = document.getElementById('idlePrestigeConfirmKeepList');
  if (keepEl) keepEl.innerHTML = bkmpPrestigeRenderInfoList(bkmpPrestigeKeepItems(p));
  const finalGainEl = document.getElementById('idlePrestigeConfirmFinalGain');
  if (finalGainEl) finalGainEl.innerHTML = `+${bkmpIdleFormatNumber(p.pointsGained)} Prestige-Punkte<br>Dauerhafter Bonus: +${p.nextBonusPct}% Angriff/Leben/Gold/XP`;
  const finalBtn = document.getElementById('idlePrestigeConfirmFinalBtn');
  /* Setzt auch style.display zurueck, das der (seltene, defensive)
     Fehlerpfad in bkmpPrestigeConfirmFinalize() setzt (finalBtn versteckt) -
     sonst wuerde ein einmal aufgetretener Fehler diesen Button dauerhaft
     fuer JEDEN spaeteren Aufstiegsversuch in diesem Tab kaputt lassen. */
  if (finalBtn) { finalBtn.disabled = false; finalBtn.textContent = '🌌 Jetzt endgültig aufsteigen'; finalBtn.style.display = ''; }
  const backBtn = document.getElementById('idlePrestigeConfirmBackBtn');
  if (backBtn) { backBtn.disabled = false; backBtn.textContent = 'Zurück'; }
  const errEl = document.getElementById('idlePrestigeConfirmError');
  if (errEl) { errEl.textContent = ''; errEl.classList.remove('visible'); }
  bkmpPrestigeConfirmErrored = false;
}

function bkmpPrestigeConfirmGoToFinal() {
  if (!bkmpPrestigeConfirmPreview) return;
  bkmpPrestigeRenderConfirmStep('final');
  const btn = document.getElementById('idlePrestigeConfirmFinalBtn');
  if (btn) btn.focus();
}

/* Der "Zurueck"-Button ist IMMER derselbe, einmal in bkmpPrestigeInit()
   verdrahtete Button (kein onclick-Reassignment, um nicht mit dem dort
   bereits registrierten addEventListener zu kollidieren) - im (seltenen)
   Fehlerfall wird er nur umbeschriftet ("Schliessen") und dieser Handler
   prueft bkmpPrestigeConfirmErrored, um dann komplett zu schliessen statt
   zur Vorschau zurueckzuspringen. Zurueck zur Vorschau wuerde den bereits
   deaktivierten "Jetzt aufsteigen"-Button wieder aktivieren und so einen
   zweiten bkmpPrestigeExecuteReset()-Aufruf ermoeglichen - genau die
   doppelte Ausfuehrung, die verhindert werden soll. */
function bkmpPrestigeConfirmGoToPreview() {
  if (!bkmpPrestigeConfirmPreview || bkmpPrestigeConfirmSubmitting) return;
  if (bkmpPrestigeConfirmErrored) { bkmpPrestigeConfirmCancel(); return; }
  bkmpPrestigeRenderConfirmStep('preview');
  const btn = document.getElementById('idlePrestigeConfirmNextBtn');
  if (btn) btn.focus();
}

function bkmpPrestigeConfirmCancel() {
  if (bkmpPrestigeConfirmSubmitting) return;
  const overlay = document.getElementById('idlePrestigeConfirmOverlay');
  if (overlay) overlay.classList.remove('visible');
  document.body.classList.remove('modal-open');
  bkmpPrestigeConfirmPreview = null;
  bkmpPrestigeConfirmErrored = false;
}

/* Finaler Bestaetigungs-Klick. bkmpPrestigeSaving wird synchron VOR dem
   ersten await geprueft/gesetzt (siehe bkmpPrestigeExecuteReset) - das ist
   dieselbe Doppelklick-Sperre wie vorher, hier zusaetzlich noch am Button
   selbst gespiegelt (disabled+Text), damit auch optisch sofort sichtbar
   ist, dass ein Klick bereits verarbeitet wird. */
async function bkmpPrestigeConfirmFinalize() {
  if (bkmpPrestigeSaving || bkmpPrestigeConfirmSubmitting || !bkmpPrestigeConfirmPreview) return;
  /* Erneute Pruefung (gleiche Funktion wie beim Oeffnen des Dialogs) - der
     Dialog kann beliebig lange offen stehen, waehrend der Kampf im
     Hintergrund weiterlaeuft (siehe bkmpIdleCloseModal-Kommentar: Fenster
     zu != Spiel pausiert). Ein Event-Drache koennte also erst WAEHREND der
     offenen Vorschau erscheinen - dieselbe Sperre wie beim urspruenglichen
     Aufruf, nur robuster gegen das laengere Zeitfenster des neuen
     zweistufigen Dialogs. */
  if (bkmpIdleEventPauseActive) {
    bkmpPrestigeConfirmCancel();
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Erst den Event-Drachen bestätigen/bekämpfen, dann kannst du aufsteigen.', 4000);
    return;
  }
  const preview = bkmpPrestigeConfirmPreview;
  const pointsBefore = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points || 0) : 0;
  bkmpPrestigeConfirmSubmitting = true;
  const finalBtn = document.getElementById('idlePrestigeConfirmFinalBtn');
  const backBtn = document.getElementById('idlePrestigeConfirmBackBtn');
  const errEl = document.getElementById('idlePrestigeConfirmError');
  if (finalBtn) { finalBtn.disabled = true; finalBtn.textContent = 'Wird gespeichert…'; }
  if (backBtn) backBtn.disabled = true;
  if (errEl) { errEl.textContent = ''; errEl.classList.remove('visible'); }
  try {
    await bkmpPrestigeExecuteReset();
    const pointsAfter = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points || 0) : 0;
    const actualLevel = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : preview.nextLevel;
    const result = {
      pointsGained: Math.max(0, pointsAfter - pointsBefore),
      nextLevel: actualLevel,
      nextBonusPct: actualLevel * 5
    };
    const overlay = document.getElementById('idlePrestigeConfirmOverlay');
    if (overlay) overlay.classList.remove('visible');
    document.body.classList.remove('modal-open');
    bkmpPrestigeConfirmPreview = null;
    bkmpPrestigeConfirmSubmitting = false;
    bkmpPrestigeShowCeremony(result);
  } catch (e) {
    /* In der Praxis faengt bkmpPrestigeExecuteReset() (genau wie vorher)
       beide Speichervorgaenge bereits INTERN ab (siehe Kommentare dort) -
       dieser Zweig ist also ein defensives Sicherheitsnetz fuer den
       unwahrscheinlichen Fall eines echten Laufzeitfehlers, kein normaler
       Pfad. WICHTIG: bewusst KEIN Button, der bkmpPrestigeExecuteReset()
       erneut aufruft - der Reset (inkl. Punktevergabe) hat zu diesem
       Zeitpunkt bereits lokal stattgefunden (nicht rueckgaengig gemacht),
       ein zweiter Aufruf wuerde Prestige-Stufe/-Punkte ein zweites Mal
       vergeben. Stattdessen nur "Schliessen" - der bereits veraenderte
       Spielstand wird vom regulaeren Autosave (laeuft unabhaengig davon
       weiter) beim naechsten Zyklus ganz normal nachgezogen. */
    console.warn('Prestige: unerwarteter Fehler beim Aufstieg.', e);
    bkmpPrestigeConfirmSubmitting = false;
    if (errEl) {
      errEl.innerHTML = '⚠️ Es gab ein unerwartetes Problem. Dein Aufstieg wurde bereits lokal durchgeführt und wird im Hintergrund automatisch weiter gespeichert – bitte schließe dieses Fenster und lass die Seite offen, bis der nächste automatische Speichervorgang durchgelaufen ist.';
      errEl.classList.add('visible');
    }
    if (finalBtn) { finalBtn.disabled = true; finalBtn.style.display = 'none'; }
    /* bkmpPrestigeConfirmErrored steuert den bereits registrierten
       "Zurueck"-Klick-Handler (bkmpPrestigeConfirmGoToPreview) um, statt
       ein zweites onclick auf denselben Button zu haengen - siehe
       Kommentar dort. */
    bkmpPrestigeConfirmErrored = true;
    if (backBtn) { backBtn.disabled = false; backBtn.textContent = 'Schließen'; }
  }
}

/* ---------------- Zeremonie ---------------- */
let bkmpPrestigeCeremonyDismissTimer = null;

function bkmpPrestigeShowCeremony(result) {
  const overlay = document.getElementById('idlePrestigeCeremonyOverlay');
  if (!overlay) { bkmpIdleRenderActiveTabContent(); return; }
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fxMode = typeof bkmpFxGetMode === 'function' ? bkmpFxGetMode() : 'hoch';
  const instant = reducedMotion || fxMode === 'aus';
  const simplified = fxMode === 'reduziert';

  const levelEl = document.getElementById('idlePrestigeCeremonyLevel');
  if (levelEl) levelEl.textContent = `Aufstieg #${result.nextLevel}`;
  const bonusEl = document.getElementById('idlePrestigeCeremonyBonus');
  if (bonusEl) bonusEl.innerHTML = `+${bkmpIdleFormatNumber(result.pointsGained)} Prestige-Punkte<br><span class="idle-prestige-ceremony-bonus-pct">Dauerhafter Bonus: +${result.nextBonusPct}% Angriff/Leben/Gold/XP</span>`;

  overlay.classList.remove('phase-gather', 'phase-dissolve', 'phase-result', 'is-instant', 'is-simplified');
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');

  if (instant) {
    overlay.classList.add('is-instant', 'phase-result');
    bkmpPrestigeCeremonyDismissTimer = window.setTimeout(bkmpPrestigeCloseCeremony, 1600);
    return;
  }
  if (simplified) overlay.classList.add('is-simplified');
  const gatherMs = simplified ? 500 : 1100;
  const dissolveMs = simplified ? 500 : 900;
  const resultLingerMs = simplified ? 1200 : 1400;
  overlay.classList.add('phase-gather');
  /* Funken nur in "Hoch" (sparsame, EINMALIGE Partikel - "Fortschritt
     loest sich auf", Schritt 4 der Zeremonie) - in "Reduziert" bewusst
     keine, siehe Auftrag Abschnitt 6. Wiederverwendet dieselbe Zufalls-
     Streutechnik wie bkmpFireAchievementConfetti (bkmp-site.js), nur mit
     Amethyst/Gold-Paletten und einwaerts->auswaerts Richtung statt
     Aufwaerts-Burst. */
  if (!simplified) {
    const sparksEl = overlay.querySelector('.idle-prestige-ceremony-sparks');
    if (sparksEl) {
      const colors = ['#a78bfa', '#c9a56a', '#7c3aed', '#e9d5a1'];
      sparksEl.innerHTML = Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
        const dist = 70 + Math.random() * 50;
        const sx = Math.round(Math.cos(angle) * dist);
        const sy = Math.round(Math.sin(angle) * dist);
        const delay = (gatherMs / 1000 + Math.random() * 0.15).toFixed(2);
        return `<span style="background:${colors[i % colors.length]}; --sx:${sx}px; --sy:${sy}px; animation-delay:${delay}s;"></span>`;
      }).join('');
    }
  }
  window.setTimeout(() => { overlay.classList.remove('phase-gather'); overlay.classList.add('phase-dissolve'); }, gatherMs);
  window.setTimeout(() => { overlay.classList.remove('phase-dissolve'); overlay.classList.add('phase-result'); }, gatherMs + dissolveMs);
  bkmpPrestigeCeremonyDismissTimer = window.setTimeout(bkmpPrestigeCloseCeremony, gatherMs + dissolveMs + resultLingerMs);
}

function bkmpPrestigeCloseCeremony() {
  if (bkmpPrestigeCeremonyDismissTimer) { window.clearTimeout(bkmpPrestigeCeremonyDismissTimer); bkmpPrestigeCeremonyDismissTimer = null; }
  const overlay = document.getElementById('idlePrestigeCeremonyOverlay');
  if (overlay) {
    overlay.classList.remove('visible', 'phase-gather', 'phase-dissolve', 'phase-result', 'is-instant', 'is-simplified');
    const sparksEl = overlay.querySelector('.idle-prestige-ceremony-sparks');
    if (sparksEl) sparksEl.innerHTML = '';
  }
  document.body.classList.remove('modal-open');
}

/* Einmalige Verdrahtung, aufgerufen aus bkmpIdleInit() (gleiches Muster wie
   bkmpFxInit()/bkmpRaidInit()). bkmpUiTrapFocus() ist die in Phase 3 bereits
   fertiggestellte, bis jetzt aber an keiner echten Stelle verdrahtete
   Fokus-Falle (siehe js/ui/bkmp-ui-components.js) - hier zum ersten Mal
   tatsaechlich genutzt. */
function bkmpPrestigeInit() {
  const cancelBtn = document.getElementById('idlePrestigeConfirmCancelBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', bkmpPrestigeConfirmCancel);
  const nextBtn = document.getElementById('idlePrestigeConfirmNextBtn');
  if (nextBtn) nextBtn.addEventListener('click', bkmpPrestigeConfirmGoToFinal);
  const backBtn = document.getElementById('idlePrestigeConfirmBackBtn');
  if (backBtn) backBtn.addEventListener('click', bkmpPrestigeConfirmGoToPreview);
  const finalBtn = document.getElementById('idlePrestigeConfirmFinalBtn');
  if (finalBtn) finalBtn.addEventListener('click', bkmpPrestigeConfirmFinalize);
  const continueBtn = document.getElementById('idlePrestigeCeremonyContinueBtn');
  if (continueBtn) continueBtn.addEventListener('click', bkmpPrestigeCloseCeremony);
  if (typeof bkmpUiTrapFocus === 'function') {
    bkmpUiTrapFocus(document.getElementById('idlePrestigeConfirmOverlay'));
    bkmpUiTrapFocus(document.getElementById('idlePrestigeCeremonyOverlay'));
  }
}

async function bkmpIdlePerformPrestige() {
  /* Fehlte bisher: waehrend ein Event-Drache (Shenloss/Liber) auf
     Bestaetigung wartet, war der Aufsteigen-Button trotzdem ganz normal
     klickbar - ein Aufstieg setzt current_dragon_index/highest_dragon_index
     sofort auf 0 zurueck und spawnt einen neuen Drachen, wodurch der noch
     nicht bekaempfte Event-Drache faktisch spurlos verschwand, OHNE dass er
     je gegen ihn gekaempft hat (siehe idle_event_dragon_state: kein Eintrag
     = nie als besiegt gezaehlt). Genau die gleiche Sperre wie bei
     Stufensprung/-Auswahl (bkmpIdleJumpToStage) noetig. */
  if (bkmpIdleEventPauseActive) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('Erst den Event-Drachen bestätigen/bekämpfen, dann kannst du aufsteigen.', 4000);
    return;
  }
  if (!bkmpPrestigeEligible() || bkmpPrestigeSaving) return;
  bkmpPrestigeOpenConfirmFlow();
}

/* Unveraenderte Reset-/Speicherlogik (siehe Dateikopf-Kommentar oben) -
   wortwoertlich aus der vorherigen bkmpIdlePerformPrestige uebernommen,
   berechnet Stufe/Bonus/Punkte bewusst selbststaendig neu (haengt NICHT
   vom evtl. inzwischen leicht veralteten Vorschau-Snapshot im Dialog ab). */
async function bkmpPrestigeExecuteReset() {
  const stage = Number(bkmpIdleState.highest_dragon_index || 0);
  const bonusPct = bkmpPrestigeState ? (bkmpPrestigeEffectTotals(bkmpPrestigeState.prestige_allocations).prestige_point_bonus_pct || 0) : 0;
  const pointsGained = Math.max(1, Math.round(bkmpPrestigePointsForStage(stage) * (1 + bonusPct / 100)));

  bkmpPrestigeSaving = true;
  /* Bug gefunden 25.07.2026 (Playwright-Diagnose unter Last, siehe
     tests/e2e/prestige.spec.js-Kommentar): ein noch offener 4s-Debounce-
     Speicher-Timer (bkmpIdleQueueSync, ausgeloest von einem Kampf-Tick VOR
     dem Reset) ist von bkmpIdleStopLoop() (stoppt nur den Kampf-Tick-
     Intervall, siehe idledorf.js) komplett unberuehrt und kann daher genau
     ueber diesem Reset hinweg weiterlaufen. Feuert er WAEHREND oder kurz
     NACH dem eigentlich autoritativen bkmpIdleFlushSyncNow() weiter unten,
     tragen beide Schreibvorgaenge denselben (noch veralteten, vor dem Reset
     erfassten) bkmpIdleState-Schnappschuss - kein Zustands-Bug in
     bkmpIdleState selbst (per Setter-Falle bestaetigt: gold wird lokal nur
     genau einmal auf 0 gesetzt), sondern ein Wettlauf zweier HTTP-
     Schreibvorgaenge, bei dem der spaeter GESENDETE, aber inhaltlich
     AELTERE Stand den frischen Reset-Stand ueberschreiben kann, falls er
     am Mock-/echten Server spaeter ankommt als er losgeschickt wurde.
     Exakt dieselbe Bugklasse wie der bereits dokumentierte "1 Min. Offline-
     Fortschritt"-Fix (bkmpIdleCancelPendingSyncTimer(), siehe Kommentar
     dort) - hier zum ersten Mal beim Prestige-Reset gefunden. Fix: jeden
     noch offenen Timer VOR dem eigenen, autoritativen Flush verwerfen -
     bkmpIdleSyncPending bleibt bewusst unangetastet (identisches Prinzip),
     der naechste echte Zustandswechsel nach dem Reset plant ganz normal
     wieder einen neuen Timer. */
  bkmpIdleCancelPendingSyncTimer();
  try {
    bkmpIdleState.level = 1;
    bkmpIdleState.xp = 0;
    bkmpIdleState.gold = 0;
    bkmpIdleState.wood = 0;
    bkmpIdleState.stone = 0;
    bkmpIdleState.crystals = 0;
    bkmpIdleState.essence = 0;
    bkmpIdleState.skill_points_available = 0;
    bkmpIdleState.skill_points_spent = 0;
    bkmpIdleState.skill_allocations = {};
    bkmpIdleState.upgrade_purchases = {};
    /* Spieler-Vorgabe 18.07. (im Zuge der Drachenzwinger-Entfernung, siehe
       supabase-remove-zucht-lagerplaetze.sql): Obstgarten/Jagdhuette
       sollten bisher bewusst NICHT zurueckgesetzt werden - jetzt auf
       ausdruecklichen Wunsch doch, damit die komplette Zucht-Wirtschaft
       (Skilltree UND Gebaeude) beim Aufstieg einheitlich zurueckgesetzt
       wird, genau wie Gold/Holz/Stein/Kristalle/Essenz. Level 0 produziert
       weiterhin die Grundrate (kein Totalstillstand), nur der Ausbau-
       Fortschritt geht verloren. */
    bkmpIdleState.obstgarten_level = 0;
    bkmpIdleState.jagdhuette_level = 0;
    bkmpIdleState.fruit = 0;
    bkmpIdleState.meat = 0;
    /* Spieler-Vorgabe 18.07. (Folgeanfrage direkt danach): die 6 Produktions-
       gebaeude (siehe BKMP_IDLE_PRODUCTION_BUILDINGS) sollen beim Prestige
       ebenfalls zurueckgesetzt werden, analog zu Obstgarten/Jagdhuette oben.
       Nur die Level muessen hier genullt werden - die zugehoerigen
       Ressourcen (gold/wood/stone/crystals/essence) sind bereits oben in
       diesem Block generell auf 0 gesetzt; *_collected_at bleibt bewusst
       unangetastet (gleiches Muster wie bei fruit/meat: die naechste
       Ansammlung rechnet einfach ab jetzt mit Level 0 weiter). */
    BKMP_IDLE_PRODUCTION_BUILDINGS.forEach(def => { bkmpIdleState[def.levelKey] = 0; });
    /* dragon_kills/boss_kills bleiben ab sofort ueber Prestige-Auffstiege
       hinweg erhalten (nicht mehr zurueckgesetzt) - vorher liess das die
       Bestenliste (loadIdleLeaderboardStats liest dragon_kills direkt)
       nach jedem Aufstieg faelschlich wieder bei 0 anfangen, obwohl der
       Spieler laengst viel mehr Drachen insgesamt besiegt hatte. */
    /* Die aktuelle Lauf-Stufe VOR dem Reset in den dauerhaften Lebenszeit-
       Zaehler einrechnen, damit "insgesamt erreichte Stufen" (siehe
       bkmpIdleRenderStageBar) ueber Auffstiege hinweg weiterzaehlt statt
       auch auf 0 zurueckzufallen. */
    bkmpIdleState.prestige_stage_offset = Number(bkmpIdleState.prestige_stage_offset || 0) + Number(bkmpIdleState.highest_dragon_index || 0);
    bkmpIdleState.current_dragon_index = 0;
    bkmpIdleState.highest_dragon_index = 0;
    bkmpIdleState.auto_advance = true;
    /* NACHBESSERUNG (Spieler-Feedback 18.07.): kehrt die 17.07.-Entscheidung
       ("Runen gehen beim Prestige verloren") wieder um, zurueck zur
       urspruenglichen 14.07.-Entscheidung - eine hochgelevelte Rune (z.B.
       +30) kostet zu viel Zeit/Aufwand, um sie bei jedem Aufstieg komplett
       zu verlieren, das fuehlte sich unfair an. Runen (ausgeruestet UND
       Inventar, alle Seltenheiten/Stufen/Sub-Stats/Slot-Zuordnung) bleiben
       ab sofort vollstaendig erhalten - weder lokal noch in der DB wird
       hier noch geloescht. bkmpRuneNormalizeDuplicateEquips() (siehe
       js/systems/bkmp-runes.js) heilt dabei automatisch jeden ungueltigen
       Mehrfach-Ausruestungs-Zustand, falls einer bestehen sollte - der
       Prestige-Reset selbst muss sich darum nicht mehr kuemmern. */

    if (!bkmpPrestigeState) bkmpPrestigeState = { name_key: bkmpIdleState.name_key, display_name: bkmpIdleState.display_name, prestige_level: 0, prestige_points: 0, prestige_points_spent: 0, prestige_allocations: {} };
    bkmpPrestigeState.prestige_level = Number(bkmpPrestigeState.prestige_level || 0) + 1;
    bkmpPrestigeState.prestige_points = Number(bkmpPrestigeState.prestige_points || 0) + pointsGained;
    bkmpGuildQuestAddDelta('prestige_ups', 1);

    bkmpIdleRecomputeEffectiveStats();
    bkmpIdleVillageHp = bkmpIdleEffectiveStats.hp;
    bkmpIdleSpawnDragon();
    bkmpIdleRenderStageBar();
    bkmpIdleUpdateVillageHpBar();
    bkmpIdleRenderHud();
    bkmpIdleLog(`🌌 Aufstieg #${bkmpPrestigeState.prestige_level}! +${pointsGained} Prestige-Punkte, dauerhafter +5%-Bonus.`);

    /* Ein Aufstieg IST der Reset - hier soll der frisch genullte Stand die
       DB unbedingt ueberschreiben, nicht mit einem evtl. noch aelteren
       Remote-Stand verschmolzen werden (der Twitch-Sync-Merge-Check oben in
       bkmpIdleFlushSync ist fuer NORMALE Kaeufe gedacht, nicht fuer einen
       kompletten Lauf-Reset) - genau EINEN Speichervorgang lang ueberspringen,
       alle Speichervorgaenge DANACH referenzieren wieder korrekt den neuen
       (genullten) Basiswert. */
    bkmpIdleSkipNextMerge = true;
    bkmpPrestigeSkipNextMerge = true;
    await bkmpIdleFlushSyncNow();
    try { if (typeof saveIdlePrestigeState === 'function') await saveIdlePrestigeState(bkmpPrestigeState); bkmpPrestigeSnapshotMergeBaseline(); }
    catch (e) { console.warn('Prestige: Speichern fehlgeschlagen (Migration ausgefuehrt?).', e); }

    bkmpIdleRenderActiveTabContent();
  } finally {
    bkmpPrestigeSaving = false;
  }
}

/* ============================================================
   Progression-Rebalance Phase 9 (26.07.2026): zweite Prestige-Ebene
   "Aufstieg" (Drachenseelen). NUR umgesetzt, weil eine sichere Speicherung
   OHNE jede SQL-Migration moeglich war: Drachenseelen/Aufstiegsstufe leben
   als zwei reservierte Schluessel (__dragon_souls/__ascension_level,
   Doppel-Unterstrich-Praefix kollidiert mit keiner echten Knoten-ID) im
   SELBEN, bereits bestehenden prestige_allocations-JSONB-Feld - identisches
   Prinzip wie die Paragon-Raenge weiter oben. supabase.js (loadIdle-
   PrestigeState/saveIdlePrestigeState) bleibt dadurch komplett unangetastet
   (Projektregel: bleibt eingefroren) - keine neue Spalte, keine neue
   Tabelle, kein Migrationsrisiko fuer dieses Feature.

   Freischaltung (Auftrags-Vorschlag uebernommen): mind. 10 abgeschlossene
   Prestiges, mind. 500 insgesamt investierte Prestige-Punkte (identischer
   Schwellwert wie der bereits bestehende "Aufstieg"-Meilenstein), hoher
   Lebenszeit-Fortschritt (mind. 5.000 insgesamt erreichte Drachen-Stufen). */
const BKMP_ASCENSION_MIN_PRESTIGE_LEVEL = 10;
const BKMP_ASCENSION_MIN_POINTS_SPENT = 500;
const BKMP_ASCENSION_MIN_LIFETIME_STAGE = 5000;
/* Pro Drachenseele: kleine, universelle Dauerboni (bewusst gering, siehe
   Auftrags-Vorgabe fuer Paragon-aehnliche Sonderwaehrungen "kleine, aber
   permanente Vorteile") - fliessen wie jede andere Quelle in denselben
   Sammel-Pott (bkmpAscensionEffectTotals, unten in bkmpIdleRecomputeEffectiveStats
   verdrahtet). */
const BKMP_ASCENSION_BONUS_PER_SOUL = { attack_pct: 0.5, hp_pct: 0.5, gold_prod_pct: 0.5, xp_pct: 0.5 };
const BKMP_ASCENSION_START_GOLD_PER_LEVEL = 50000;

function bkmpAscensionDragonSouls() {
  if (!bkmpPrestigeState || !bkmpPrestigeState.prestige_allocations) return 0;
  return Number(bkmpPrestigeState.prestige_allocations.__dragon_souls || 0);
}
function bkmpAscensionLevel() {
  if (!bkmpPrestigeState || !bkmpPrestigeState.prestige_allocations) return 0;
  return Number(bkmpPrestigeState.prestige_allocations.__ascension_level || 0);
}
function bkmpAscensionEffectTotals() {
  const souls = bkmpAscensionDragonSouls();
  const totals = {};
  if (souls <= 0) return totals;
  Object.entries(BKMP_ASCENSION_BONUS_PER_SOUL).forEach(([key, perSoul]) => { totals[key] = souls * perSoul; });
  return totals;
}
/* Gilden-Technologie v2 (26.07.), "Aufstiegsvorbereitung": senkt alle
   drei Mindestanforderungen um denselben Prozentsatz (max. 10% bei
   Stufe 5), gerundet auf ganze Zahlen. Eigene Funktion statt der
   Rabatt direkt in bkmpAscensionEligible() versteckt, damit die
   Hinweis-Anzeige (bkmpAscensionRenderSectionHtml) dieselben,
   TATSAECHLICH geltenden Zahlen zeigen kann statt der undiscountierten
   Basiswerte - sonst waere das exakt derselbe Anzeige/Realitaet-
   Mismatch-Bug wie der beim Arena-Tageslimit gefundene. */
function bkmpAscensionEffectiveThresholds() {
  // Gilden-Technologie v2 (26.07., Rebalance): Deckel von 10% auf 35%
  // angehoben, nachdem die Maximalstufe von 5 auf 15 (x2%) gestiegen ist -
  // bewusst deutlich unter 100%, damit die Aufstiegs-Voraussetzung eine
  // echte Huerde bleibt (kein triviales Freischalten), etwas Spielraum
  // ueber die reinen 30% der Maximalstufe hinaus fuer Paragon-Raenge.
  const discountPct = Math.min(35, typeof bkmpGuildTechBonus === 'function' ? bkmpGuildTechBonus('ascensionThresholdDiscountPct') : 0);
  const mult = 1 - discountPct / 100;
  return {
    minPrestigeLevel: Math.max(1, Math.round(BKMP_ASCENSION_MIN_PRESTIGE_LEVEL * mult)),
    minPointsSpent: Math.max(1, Math.round(BKMP_ASCENSION_MIN_POINTS_SPENT * mult)),
    minLifetimeStage: Math.max(1, Math.round(BKMP_ASCENSION_MIN_LIFETIME_STAGE * mult))
  };
}
function bkmpAscensionEligible() {
  if (!bkmpIdleState || !bkmpPrestigeState || bkmpPrestigeLoadFailed) return false;
  const level = Number(bkmpPrestigeState.prestige_level || 0);
  const spent = Number(bkmpPrestigeState.prestige_points_spent || 0);
  const lifetimeStage = typeof bkmpIdleLifetimeStageCount === 'function' ? bkmpIdleLifetimeStageCount() : 0;
  const thresholds = bkmpAscensionEffectiveThresholds();
  return level >= thresholds.minPrestigeLevel && spent >= thresholds.minPointsSpent && lifetimeStage >= thresholds.minLifetimeStage;
}
/* Seelen-Ertrag: bewusst DEUTLICH seltener/kleiner als normale Prestige-
   Punkte - Aufstieg ist eine seltene, sehr grosse Entscheidung, keine
   Routine-Aktion (Auftrags-Vorgabe: "nur implementieren, wenn die
   Reset-Regeln vollstaendig sicher sind" - ein kleiner, seltener Ertrag
   haelt das Risiko einer versehentlichen Fehlentscheidung gering). */
function bkmpAscensionSoulsForLifetimeStage(lifetimeStage) {
  return Math.max(1, Math.floor(Math.pow(Math.max(0, lifetimeStage) / 5000, 0.9)));
}
function bkmpAscensionGetPreview() {
  if (!bkmpIdleState || !bkmpPrestigeState) return null;
  const lifetimeStage = typeof bkmpIdleLifetimeStageCount === 'function' ? bkmpIdleLifetimeStageCount() : 0;
  const soulsGained = bkmpAscensionSoulsForLifetimeStage(lifetimeStage);
  const currentSouls = bkmpAscensionDragonSouls();
  return {
    eligible: bkmpAscensionEligible(),
    currentLevel: bkmpAscensionLevel(),
    nextLevel: bkmpAscensionLevel() + 1,
    currentSouls, soulsGained, soulsAfter: currentSouls + soulsGained,
    lifetimeStage,
    prestigeLevel: Number(bkmpPrestigeState.prestige_level || 0),
    pointsSpent: Number(bkmpPrestigeState.prestige_points_spent || 0),
    thresholds: bkmpAscensionEffectiveThresholds()
  };
}
/* Fuehrt zuerst EXAKT denselben, bereits ausfuehrlich getesteten normalen
   Prestige-Reset aus (bkmpPrestigeExecuteReset - identische Reset-Liste,
   kein zweiter, abweichender Reset-Code-Pfad), setzt danach ZUSAETZLICH
   den GESAMTEN Prestige-Baum selbst zurueck (Stufe/Punkte/Zuteilungen -
   das ist der definierende Mehrpreis eines Aufstiegs gegenueber einem
   normalen Prestige) und vergibt die neuen Drachenseelen + eine kleine
   Startkapital-Spritze. */
async function bkmpAscensionExecute() {
  if (!bkmpAscensionEligible() || bkmpPrestigeSaving) return false;
  const lifetimeStageBefore = typeof bkmpIdleLifetimeStageCount === 'function' ? bkmpIdleLifetimeStageCount() : 0;
  const soulsGained = bkmpAscensionSoulsForLifetimeStage(lifetimeStageBefore);
  const prevSouls = bkmpAscensionDragonSouls();
  const prevAscensionLevel = bkmpAscensionLevel();
  await bkmpPrestigeExecuteReset(); // setzt Level/Ressourcen/Skilltree/Upgrades/Drachen-Fortschritt zurueck, vergibt regulaere Prestige-Punkte
  bkmpPrestigeState.prestige_level = 0;
  bkmpPrestigeState.prestige_points = 0;
  bkmpPrestigeState.prestige_points_spent = 0;
  bkmpPrestigeState.prestige_allocations = {
    __dragon_souls: prevSouls + soulsGained,
    __ascension_level: prevAscensionLevel + 1
  };
  bkmpIdleState.gold = Number(bkmpIdleState.gold || 0) + (prevAscensionLevel + 1) * BKMP_ASCENSION_START_GOLD_PER_LEVEL;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderHud();
  bkmpIdleLog(`✨ Aufstieg #${prevAscensionLevel + 1}! Dein Prestige-Baum wurde vollständig zurückgesetzt, du erhältst +${soulsGained} Drachenseelen (${prevSouls + soulsGained} insgesamt).`);
  bkmpIdleSkipNextMerge = true;
  bkmpPrestigeSkipNextMerge = true;
  await bkmpIdleFlushSyncNow();
  try { if (typeof saveIdlePrestigeState === 'function') await saveIdlePrestigeState(bkmpPrestigeState); bkmpPrestigeSnapshotMergeBaseline(); }
  catch (e) { console.warn('Aufstieg: Speichern fehlgeschlagen.', e); }
  bkmpIdleRenderActiveTabContent();
  return true;
}
function bkmpAscensionRenderSectionHtml() {
  const preview = bkmpAscensionGetPreview();
  if (!preview) return '';
  return `
    <div class="idle-prestige-section idle-prestige-section-ascension">
      <div class="idle-upgrade-section-title">✨ Aufstieg (Drachenseelen)</div>
      <p class="idle-prestige-hint">Aktuell: Aufstiegsstufe ${bkmpIdleFormatNumber(preview.currentLevel)} &middot; ${bkmpIdleFormatNumber(preview.currentSouls)} Drachenseelen (je +${BKMP_ASCENSION_BONUS_PER_SOUL.attack_pct}% Angriff/Leben/Gold/XP dauerhaft).</p>
      ${preview.eligible
        ? `<button type="button" class="btn-ja idle-ascension-btn" id="idleAscensionBtn">✨ Aufsteigen (+${bkmpIdleFormatNumber(preview.soulsGained)} Drachenseelen, setzt den GESAMTEN Prestige-Baum zurück)</button>`
        : `<p class="idle-prestige-hint">Voraussetzungen: Prestige-Stufe ${preview.thresholds.minPrestigeLevel}+ (aktuell ${preview.prestigeLevel}), ${bkmpIdleFormatNumber(preview.thresholds.minPointsSpent)}+ investierte Punkte (aktuell ${bkmpIdleFormatNumber(preview.pointsSpent)}), ${bkmpIdleFormatNumber(preview.thresholds.minLifetimeStage)}+ insgesamt erreichte Drachen-Stufen (aktuell ${bkmpIdleFormatNumber(preview.lifetimeStage)}).</p>`}
    </div>`;
}

async function bkmpAscensionConfirmAndExecute() {
  const preview = bkmpAscensionGetPreview();
  if (!preview || !preview.eligible) return;
  const body = `Ein Aufstieg setzt ALLES zurueck, was auch ein normaler Prestige-Aufstieg zuruecksetzt (Level/Ressourcen/Skilltree/Upgrades/Drachen-Fortschritt) - ZUSAETZLICH wird dein GESAMTER Prestige-Baum (aktuell Stufe ${preview.prestigeLevel}, ${bkmpIdleFormatNumber(preview.pointsSpent)} investierte Punkte) VOLLSTAENDIG geloescht.\n\nDu erhaeltst dafuer +${bkmpIdleFormatNumber(preview.soulsGained)} Drachenseelen (${bkmpIdleFormatNumber(preview.soulsAfter)} insgesamt) - jede Seele gibt einen kleinen, permanenten Bonus auf Angriff/Leben/Gold/XP, der JEDEN kuenftigen Aufstieg UND jedes kuenftige Prestige ueberlebt. Runen, Erfolge, Titel und deine Lebenszeit-Statistiken bleiben unangetastet.\n\nDiese Aktion kann NICHT rueckgaengig gemacht werden. Fortfahren?`;
  const confirmed = typeof bkmpConfirmDialog === 'function'
    ? await bkmpConfirmDialog('✨ Aufstieg - Drachenseelen', body, 'Endgültig aufsteigen', 'Abbrechen')
    : window.confirm(body);
  if (!confirmed) return;
  await bkmpAscensionExecute();
}

/* Spieler-Beschwerde (30.07.2026, Screenshot): der eigentliche Baum zum
   Punkte-Ausgeben stand bisher ganz am Ende des Panels, hinter acht reinen
   Info-Bloecken ("Du erhaeltst"/Reset-Keep-Spalten/Naechster Durchlauf/
   Meilensteine/ggf. Aufstieg/ggf. Auto-Kauf-Prioritaet) - "30 Meter scrollen
   fuer die Punktevergabe". Fix: der Baum steht jetzt direkt unter dem
   Fortschrittsbalken, die vier reinen Erklaer-Bloecke wandern in ein
   einziges, standardmaessig EINGEKLAPPTES Akkordeon darunter (Zustand pro
   Browser gemerkt). Kein Sicherheitsverlust vor dem eigentlichen Aufstieg -
   der bereits bestehende zweistufige Bestaetigungsdialog
   (bkmpPrestigeOpenConfirmFlow) zeigt dieselbe Reset/Bleibt-erhalten-Liste
   ohnehin ein zweites Mal, bevor der Aufstieg tatsaechlich ausgefuehrt wird. */
const BKMP_PRESTIGE_INFO_EXPANDED_KEY = 'bkmp-idle-prestige-info-expanded';
function bkmpPrestigeInfoExpanded() {
  try { return localStorage.getItem(BKMP_PRESTIGE_INFO_EXPANDED_KEY) === '1'; } catch (e) { return false; }
}
function bkmpPrestigeSetInfoExpanded(expanded) {
  try { localStorage.setItem(BKMP_PRESTIGE_INFO_EXPANDED_KEY, expanded ? '1' : '0'); } catch (e) {}
}
function bkmpPrestigeRenderInfoAccordionHtml(preview, spentPoints) {
  const expanded = bkmpPrestigeInfoExpanded();
  return `
    <div class="idle-prestige-section idle-prestige-info-accordion">
      <button type="button" class="idle-prestige-info-toggle" id="idlePrestigeInfoToggleBtn" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="idlePrestigeInfoBody">
        <span>ℹ️ Was passiert beim Aufstieg?</span>
        <span class="idle-prestige-info-toggle-chevron" aria-hidden="true">${expanded ? '▲' : '▼'}</span>
      </button>
      <div class="idle-prestige-info-body" id="idlePrestigeInfoBody"${expanded ? '' : ' hidden'}>
        <div class="idle-prestige-section idle-prestige-section-gain">
          <div class="idle-upgrade-section-title">Du erhältst</div>
          <div class="idle-prestige-gain-highlight">+${bkmpIdleFormatNumber(preview.pointsGained)} Prestige-Punkte <span class="idle-prestige-gain-arrow">&rarr; neuer dauerhafter Bonus +${preview.nextBonusPct}%</span></div>
          ${!preview.eligible ? `<p class="idle-prestige-hint">Verfügbar, sobald du Drachen-Stufe ${bkmpIdleFormatStage(preview.requiredStage)} erreichst.</p>` : ''}
        </div>
        <div class="idle-prestige-columns">
          <div class="idle-prestige-section idle-prestige-section-reset">
            <div class="idle-upgrade-section-title idle-upgrade-section-title-reset">Wird zurückgesetzt</div>
            ${bkmpPrestigeRenderInfoList(bkmpPrestigeResetItems(preview))}
          </div>
          <div class="idle-prestige-section idle-prestige-section-keep">
            <div class="idle-upgrade-section-title idle-upgrade-section-title-keep">Bleibt erhalten</div>
            ${bkmpPrestigeRenderInfoList(bkmpPrestigeKeepItems(preview))}
          </div>
        </div>
        <div class="idle-prestige-section idle-prestige-section-next">
          <div class="idle-upgrade-section-title">Nächster Durchlauf</div>
          <p class="idle-prestige-next-note">Der übernächste Aufstieg benötigt Drachen-Stufe ${bkmpIdleFormatStage(preview.nextRequiredStage)} (+50 gegenüber jetzt) - dein dann bereits höherer dauerhafter Bonus macht diesen kommenden Lauf spürbar schneller als den aktuellen.</p>
        </div>
        ${bkmpPrestigeRenderMilestonesSectionHtml(spentPoints)}
      </div>
    </div>`;
}

function bkmpIdleRenderPrestigePanel() {
  const panel = document.getElementById('idlePanelPrestige');
  if (!panel || !bkmpIdleState) return;
  if (bkmpPrestigeLoadFailed) {
    panel.innerHTML = `<p class="idle-prestige-hint">⚠️ Dein Prestige-Fortschritt konnte gerade nicht geladen werden (Verbindungsproblem). Aufsteigen ist deshalb momentan gesperrt, damit nichts überschrieben wird - versuch es gleich nochmal (z.B. Fenster schließen &amp; neu öffnen).</p>`;
    return;
  }
  const stage = Number(bkmpIdleState.highest_dragon_index || 0);
  const level = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : 0;
  const requiredStage = bkmpPrestigeRequiredStage(level);
  const eligible = bkmpPrestigeEligible();
  const progressPct = Math.max(0, Math.min(100, (stage / requiredStage) * 100));
  const totalPoints = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points || 0) : 0;
  const spentPoints = bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_points_spent || 0) : 0;
  const available = Math.max(0, totalPoints - spentPoints);
  const previewGain = bkmpPrestigePointsForStage(stage);
  const alloc = bkmpPrestigeState ? bkmpPrestigeState.prestige_allocations || {} : {};
  const preview = bkmpPrestigeGetPreview();
  bkmpPrestigeMaybeAnnounceParagonUnlock();

  panel.innerHTML = `
    <div class="idle-prestige-summary">
      <div class="idle-prestige-level">🌌 Prestige-Stufe ${level}</div>
      <div class="idle-prestige-points">${bkmpIdleFormatNumber(available)} / ${bkmpIdleFormatNumber(totalPoints)} Punkte verfügbar</div>
      ${level > 0 ? `<div class="idle-prestige-bonus-note">Dauerhafter Bonus: +${level * 5}% Angriff/Leben/Gold/XP</div>` : ''}
    </div>
    <div class="idle-prestige-progress-card">
      <div class="idle-prestige-progress-label">Drachen-Stufe ${bkmpIdleFormatStage(stage)} / ${bkmpIdleFormatStage(requiredStage)} zum Aufsteigen <span class="idle-prestige-progress-hint">(nicht dein Level – die höchste erreichte Drachen-Stufe)</span></div>
      <div class="idle-hp-bar"><div class="idle-hp-fill idle-hp-fill-village" style="width:${progressPct}%"></div></div>
      ${eligible
        ? `<button type="button" class="btn-ja idle-prestige-btn" id="idlePrestigeBtn" ${bkmpIdleEventPauseActive ? 'disabled title="Erst nach Bestätigung des Event-Drachen möglich"' : ''}>🌌 Jetzt aufsteigen (+${bkmpIdleFormatNumber(previewGain)} Punkte)</button>`
        : `<p class="idle-prestige-hint">Erreiche Drachen-Stufe ${bkmpIdleFormatStage(requiredStage)}, um dauerhaft aufsteigen zu können.</p>`}
    </div>

    <div class="idle-upgrade-section-title">Permanenter Bonusbaum</div>
    <div class="idle-prestige-branch-tabs">${BKMP_PRESTIGE_BRANCHES.map(b => {
      const unlocked = bkmpPrestigeBranchUnlocked(b.id);
      const active = bkmpPrestigeActiveBranch() === b.id;
      return `<button type="button" class="idle-prestige-branch-tab${active ? ' active' : ''}${unlocked ? '' : ' is-locked'}" data-prestige-branch="${b.id}" ${unlocked ? '' : 'title="Noch gesperrt - siehe Meilensteine unten bei \\"Was passiert beim Aufstieg?\\""'}>${b.icon} ${escapeHtml(b.name)}${unlocked ? '' : ' 🔒'}</button>`;
    }).join('')}</div>
    ${bkmpPrestigeRenderBranchGridHtml(alloc, available)}

    ${bkmpPrestigeRenderInfoAccordionHtml(preview, spentPoints)}
    ${bkmpAscensionMilestoneUnlocked() ? bkmpAscensionRenderSectionHtml() : ''}
    ${typeof bkmpPrestigeBonus === 'function' && bkmpPrestigeBonus('auto_prestige_allocate_unlock') > 0
      ? `${bkmpPrestigeRenderAutoAllocatePriorityHtml()}<button type="button" class="btn-nein idle-prestige-allocate-btn" id="idlePrestigeAutoAllocateBtn">🧭 Empfohlene Verteilung (verfügbare Punkte automatisch ausgeben)</button>`
      : ''}
  `;
  const prestigeBtn = document.getElementById('idlePrestigeBtn');
  if (prestigeBtn) prestigeBtn.addEventListener('click', bkmpIdlePerformPrestige);
  panel.querySelectorAll('.idle-prestige-buy').forEach(btn => btn.addEventListener('click', () => bkmpPrestigeBuyUpgrade(btn.dataset.prestigeId)));
  panel.querySelectorAll('.idle-prestige-buy-paragon').forEach(btn => btn.addEventListener('click', () => bkmpPrestigeBuyParagon(btn.dataset.prestigeId)));
  if (typeof bkmpUiWireTooltipTrigger === 'function') {
    panel.querySelectorAll('.idle-prestige-paragon-info').forEach(btn => {
      const tip = document.getElementById(btn.dataset.tooltipId);
      bkmpUiWireTooltipTrigger(btn, tip);
    });
  }
  const infoToggleBtn = document.getElementById('idlePrestigeInfoToggleBtn');
  if (infoToggleBtn) infoToggleBtn.addEventListener('click', () => {
    bkmpPrestigeSetInfoExpanded(!bkmpPrestigeInfoExpanded());
    bkmpIdleRenderPrestigePanel();
  });
  const autoAllocateBtn = document.getElementById('idlePrestigeAutoAllocateBtn');
  if (autoAllocateBtn) autoAllocateBtn.addEventListener('click', bkmpPrestigeAutoAllocate);
  panel.querySelectorAll('.idle-prestige-priority-btn').forEach(btn => btn.addEventListener('click', () => {
    bkmpPrestigeMoveBranchPriority(btn.dataset.branch, Number(btn.dataset.dir));
    bkmpIdleRenderPrestigePanel();
  }));
  const ascensionBtn = document.getElementById('idleAscensionBtn');
  if (ascensionBtn) ascensionBtn.addEventListener('click', bkmpAscensionConfirmAndExecute);
  panel.querySelectorAll('.idle-prestige-branch-tab').forEach(btn => btn.addEventListener('click', () => {
    if (btn.classList.contains('is-locked')) { if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🔒 Dieser Zweig ist noch gesperrt - siehe Meilenstein "Erweiterter Baum" (100 investierte Punkte).', 3600); return; }
    bkmpPrestigeSetActiveBranch(btn.dataset.prestigeBranch);
    bkmpIdleRenderPrestigePanel();
  }));
}

/* ---------------- Zweig-Tabs (Phase 14 UI) ---------------- */
const BKMP_PRESTIGE_ACTIVE_BRANCH_KEY = 'bkmp-idle-prestige-active-branch';
function bkmpPrestigeActiveBranch() {
  let saved = null;
  try { saved = localStorage.getItem(BKMP_PRESTIGE_ACTIVE_BRANCH_KEY); } catch (e) {}
  if (saved && BKMP_PRESTIGE_BRANCHES.some(b => b.id === saved)) return saved;
  return 'kampf';
}
function bkmpPrestigeSetActiveBranch(branchId) {
  try { localStorage.setItem(BKMP_PRESTIGE_ACTIVE_BRANCH_KEY, branchId); } catch (e) {}
}

function bkmpPrestigeRenderMilestonesSectionHtml(spentPoints) {
  const next = bkmpPrestigeNextMilestone(spentPoints);
  const reached = bkmpPrestigeMilestonesReached(spentPoints);
  return `
    <div class="idle-prestige-section idle-prestige-section-milestones">
      <div class="idle-upgrade-section-title">Prestige-Meilensteine (insgesamt investierte Punkte)</div>
      <div class="idle-prestige-milestone-summary">${bkmpIdleFormatNumber(spentPoints)} Punkte investiert &middot; ${reached.length}/${BKMP_PRESTIGE_MILESTONES.length} Meilensteine erreicht</div>
      ${next ? `<p class="idle-prestige-hint">Nächster Meilenstein bei ${bkmpIdleFormatNumber(next.points)} Punkten: <strong>${escapeHtml(next.name)}</strong> - ${escapeHtml(next.desc)}</p>` : `<p class="idle-prestige-hint">Alle Meilensteine erreicht!</p>`}
    </div>`;
}

function bkmpPrestigeRenderBranchGridHtml(alloc, available) {
  const branchId = bkmpPrestigeActiveBranch();
  if (!bkmpPrestigeBranchUnlocked(branchId)) {
    return `<p class="idle-prestige-hint">🔒 Dieser Zweig ist noch gesperrt - erreiche den Meilenstein "Erweiterter Baum" (100 investierte Punkte gesamt), um ihn freizuschalten.</p>`;
  }
  const nodes = BKMP_PRESTIGE_UPGRADES.filter(d => d.branch === branchId);
  const paragonUnlocked = bkmpPrestigeParagonSystemUnlocked();
  return `<div class="idle-upgrade-grid">${nodes.map(def => {
    const rank = Number(alloc[def.id] || 0);
    const maxed = rank >= def.maxRank;
    const cost = maxed ? 0 : bkmpPrestigeUpgradeCost(def, rank + 1);
    const affordable = !maxed && available >= cost;
    const paragonEligible = bkmpPrestigeParagonEligible(def);
    const paragonRank = paragonEligible ? Number(alloc[bkmpPrestigeParagonKey(def.id)] || 0) : 0;
    const showParagon = maxed && paragonEligible && paragonUnlocked;
    const paragonMaxed = showParagon && paragonRank >= BKMP_PRESTIGE_PARAGON_MAX_RANK;
    const paragonCost = showParagon && !paragonMaxed ? bkmpPrestigeParagonCost(def, paragonRank + 1) : 0;
    const paragonAffordable = showParagon && !paragonMaxed && available >= paragonCost;
    /* Spieler-Verwirrung (28.07.2026): "Paragon" tauchte bisher ohne jede
       Erklaerung auf - kleiner "?"-Hinweis direkt an der Zeile erklaert
       Kosten (dieselben Prestige-Punkte) und Effekt (4% Rang, kein Max),
       siehe bkmpPrestigeMaybeAnnounceParagonUnlock() fuer den einmaligen
       Freischalt-Toast. bkmpUiTooltipHtml/-WireTooltipTrigger (Phase 3,
       bisher ungenutzt) sind exakt fuer diesen Fall gebaut. */
    const paragonTipId = 'prestigeParagonTip-' + def.id;
    const paragonTipHtml = showParagon && typeof bkmpUiTooltipHtml === 'function'
      ? bkmpUiTooltipHtml('Kostet dieselben Prestige-Punkte wie der Baum oben - keine eigene Währung. Jeder Paragon-Rang gibt nur 4% des normalen Bonus, dafür ohne Maximum (bis Rang 1.000).', paragonTipId)
      : '';
    return `
      <div class="idle-upgrade-card${def.serverSyncRequired ? ' idle-prestige-needs-sql' : ''}">
        <div class="idle-upgrade-icon">${def.icon}</div>
        <div class="idle-upgrade-name">${escapeHtml(def.name)} <span class="idle-upgrade-level">Rang ${rank}${maxed ? ' (Max)' : '/' + def.maxRank}</span></div>
        <div class="idle-upgrade-desc">${escapeHtml(def.desc)}</div>
        ${showParagon ? `<div class="idle-prestige-paragon-row"><span class="idle-prestige-paragon-label">🌠 Paragon-Rang ${bkmpIdleFormatNumber(paragonRank)}${paragonMaxed ? ' (Max)' : '/' + bkmpIdleFormatNumber(BKMP_PRESTIGE_PARAGON_MAX_RANK)}</span><button type="button" class="idle-prestige-paragon-info" data-tooltip-id="${paragonTipId}" aria-label="Was ist Paragon?">?</button>${paragonTipHtml}</div>` : ''}
        <button type="button" class="btn-ja idle-prestige-buy" data-prestige-id="${def.id}" ${maxed || !affordable ? 'disabled' : ''}>
          ${maxed ? 'Maximal' : `🌌 ${bkmpIdleFormatNumber(cost)}`}
        </button>
        ${showParagon ? `<button type="button" class="btn-nein idle-prestige-buy-paragon" data-prestige-id="${def.id}" ${paragonMaxed || !paragonAffordable ? 'disabled' : ''}>${paragonMaxed ? 'Paragon Max' : `🌠 ${bkmpIdleFormatNumber(paragonCost)}`}</button>` : ''}
      </div>`;
  }).join('')}</div>`;
}
