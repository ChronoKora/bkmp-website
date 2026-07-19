// Bkmp - Redesign Phase 2a (17.07.): mechanisch aus idledorf.js extrahiert (mit einem AST-Parser exakt abgegrenzt, keine Logik veraendert). js/systems/bkmp-runes.js


/* ---------------- Runen ----------------
   Echtes Drop-/Ausruestungs-/Verschmelzungs-System (loest die vorherige
   reine Design-Vorschau ab, siehe supabase-idle-runes.sql). Jede Rune ist
   eine einzelne, individuell gewuerfelte Zeile in idle_player_runes -
   Spieler sammeln beliebig viele, ruesten pro Slot (=Rune-Typ) maximal
   eine aus und koennen 3 unausgeruestete gleicher Slot+Seltenheit zu einer
   der naechsten Seltenheitsstufe verschmelzen.

   Die 6 Slots und 5 Seltenheitsstufen (inkl. Farben/Bild-Dateinamen unter
   assets/runes/) waren schon vor diesem Umbau als reine Optik-Vorschau
   angelegt - hier nur mit echter Bedeutung (Kampfwert-Typ) versehen und
   ans echte Drop-/Ausruestungs-System angeschlossen, damit alle bereits
   vorbereiteten Bilder unveraendert weiterverwendet werden. */
/* Cache-Bust fuer die Runen-Bilder selbst (bisher OHNE ?v= verlinkt) -
   noetig, weil alle 30 Bilder am 14.07. nachtraeglich von "loechrigem"
   Alpha-Kanal (kaputt wirkende Transparenz-Speckles im Metallrahmen,
   Spieler-Meldung) bereinigt wurden; ohne Versionsnummer haetten Browser
   mit bereits geladenem Cache weiter die alten, fehlerhaften Bilder
   gezeigt. */
const BKMP_RUNE_IMG_V = '20260714-alphafix1';
window.BKMP_RUNE_SLOTS = [
  { id: 'slot1', name: 'Kraftrune', icon: '⚔️', stat: 'attack_pct', desc: 'Angriff' },
  { id: 'slot2', name: 'Schildrune', icon: '🛡️', stat: 'defense_pct', desc: 'Verteidigung' },
  { id: 'slot3', name: 'Herzrune', icon: '❤️', stat: 'hp_pct', desc: 'Leben' },
  { id: 'slot4', name: 'Zielrune', icon: '🎯', stat: 'crit_chance_pct', desc: 'Krit.-Chance' },
  { id: 'slot5', name: 'Wuchtrune', icon: '💥', stat: 'crit_damage_pct', desc: 'Krit.-Schaden' },
  { id: 'slot6', name: 'Glücksrune', icon: '🍀', stat: 'rune_luck_pct', desc: 'Runen-Fund-Chance' }
];
window.BKMP_RUNE_RARITIES = [
  { id: 'gray', name: 'Gewöhnlich', color: '#9ca3af', mult: 1, sellGold: 15 },
  { id: 'green', name: 'Ungewöhnlich', color: '#4ade80', mult: 1.6, sellGold: 24 },
  { id: 'blue', name: 'Selten', color: '#38bdf8', mult: 2.4, sellGold: 36 },
  { id: 'purple', name: 'Episch', color: '#a78bfa', mult: 3.4, sellGold: 51 },
  { id: 'gold', name: 'Legendär', color: '#facc15', mult: 5, sellGold: 75 }
];

/* Prozent-Positionen der 6 Hex-Rahmen auf circle-empty.png/circle-full.png
   (1254x1254), im Uhrzeigersinn ab oben - rein optisch. */
const BKMP_RUNE_SLOT_POSITIONS = {
  slot1: { top: '15.85%', left: '50%', width: '18.6%', height: '22.1%' },
  slot2: { top: '33.25%', left: '80.05%', width: '16.5%', height: '22.1%' },
  slot3: { top: '64.95%', left: '80.05%', width: '16.5%', height: '20.9%' },
  slot4: { top: '81.75%', left: '49.95%', width: '17.5%', height: '20.3%' },
  slot5: { top: '64.9%', left: '19.85%', width: '16.7%', height: '21%' },
  slot6: { top: '33.35%', left: '19.85%', width: '17.3%', height: '20.6%' }
};

/* Wert-Spannen je Stat-Schluessel + Seltenheit, zentriert um den frueheren
   "Beispielwert" (2 * rarity.mult) aus der Design-Vorschau, damit die vorher
   schon gezeigten Zahlen ungefaehr stimmen bleiben. Krit-Chance nutzt
   deutlich kleinere Zahlen (Prozentpunkte auf einer 0-75-Skala, kein
   Multiplikator wie bei den anderen 5 Stats). Nach Stat-Schluessel statt nur
   Slot-Id, weil ab jetzt auch Sub-Stats (bkmpIdleRollSubstatValue) aus
   diesem Topf gewuerfelt werden - ein Sub-Stat kann jeden der 6 Werte
   tragen, nicht nur den "eigenen" des jeweiligen Slots. */
const BKMP_RUNE_STAT_BASE = {
  attack_pct: 2, defense_pct: 2, hp_pct: 2, crit_chance_pct: 0.5, crit_damage_pct: 2, rune_luck_pct: 2,
  attack_flat: 5.714, defense_flat: 5.714, hp_flat: 14.286, attack_speed_pct: 2
};
/* Abweichende Variance-Spanne je Stat statt der generischen 0,8-1,2x fuer
   alle - auf Nutzerwunsch (15.07., "Ruhig Legendär Angriff/Verteidigung
   zwischen 7-10 und Leben zwischen 15-35") extra breit fuer hp_flat, damit
   der Sub-Stat-Wert bei Legendaer wirklich zwischen 15 und 35 landen kann
   statt nur 7-10 wie vorher. Nicht gelistete Stats nutzen weiterhin die
   Standard-Spanne (siehe bkmpIdleRuneStatRange). */
const BKMP_RUNE_STAT_VARIANCE = {
  attack_flat: [0.7, 1.0], defense_flat: [0.7, 1.0], hp_flat: [0.6, 1.4]
};
/* Fest-Wert-Varianten (attack_flat/defense_flat/hp_flat) sind dieselben
   Schluessel, die Skilltree/Upgrades/Titel schon nutzen (siehe z.B.
   "Ballisten"-Skillknoten) - koennen jetzt auch als Rune-Sub-Stat kommen.
   Auf Nutzerwunsch bewusst NIEDRIGER gewichtet als die %-Varianten (siehe
   BKMP_RUNE_SUBSTAT_WEIGHTS) und ohne Ausnahme fuer hohe Seltenheiten - "es
   muss auch mit Pech scheiss Runen rauskommen", auch bei Legendaer.
   attack_speed_pct (Angriffstempo) ist ebenfalls ein bereits bestehender,
   generisch verdrahteter Skilltree-Schluessel (verkuerzt tickIntervalMs in
   bkmpIdleRecomputeEffectiveStats) - auf Nutzerwunsch ab sofort auch als
   Rune-Sub-Stat moeglich. */
const BKMP_RUNE_SUBSTAT_WEIGHTS = {
  attack_pct: 16, defense_pct: 16, hp_pct: 16, crit_chance_pct: 12, crit_damage_pct: 12, rune_luck_pct: 10,
  attack_speed_pct: 12, attack_flat: 6, defense_flat: 6, hp_flat: 6
};
const BKMP_RUNE_EXTRA_STAT_META = {
  attack_flat: { icon: '⚔️', desc: 'Angriff (fest)' },
  defense_flat: { icon: '🛡️', desc: 'Verteidigung (fest)' },
  hp_flat: { icon: '❤️', desc: 'Leben (fest)' },
  attack_speed_pct: { icon: '⚡', desc: 'Angriffstempo' }
};
/* Liefert Icon/Beschreibung fuer JEDEN moeglichen Sub-Stat-Schluessel - bei
   den 6 "Haupt"-Stats identisch zum jeweiligen Slot (Kraftrune usw.), sonst
   aus der eigenen kleinen Tabelle, weil die zu keinem Slot als Hauptwert
   gehoeren. */
function bkmpRuneStatMeta(statKey) {
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.stat === statKey);
  if (slot) return { icon: slot.icon, desc: slot.desc };
  return BKMP_RUNE_EXTRA_STAT_META[statKey] || { icon: '✦', desc: statKey };
}
function bkmpRunePickWeightedStat(candidates) {
  const total = candidates.reduce((sum, st) => sum + (BKMP_RUNE_SUBSTAT_WEIGHTS[st] || 1), 0);
  let roll = Math.random() * total;
  for (const st of candidates) {
    roll -= (BKMP_RUNE_SUBSTAT_WEIGHTS[st] || 1);
    if (roll <= 0) return st;
  }
  return candidates[candidates.length - 1];
}

/* Drop-Gewichtung je Quelle (normaler Kill / Boss-Kill alle 25 Kaempfe) -
   je hoeher die Stufe/der Gegner, desto besser die Chance auf Seltenes.
   Glueck (ausgeruestete Glücksrune) verschiebt das Gewicht zusaetzlich
   weg von "Gewöhnlich" hin zu den selteneren Stufen.

   WICHTIG (Nachbesserung): die Gewichte allein reichten NICHT, um seltene
   Runen wirklich selten zu MACHEN - selbst mit nur 0,2% Gewicht war ein
   Legendaer-Drop bereits in den ersten paar Kaempfen theoretisch moeglich
   (unabhaengig gewuerfelt bei JEDEM Kill, "das Los kennt keine Vorgeschichte"),
   was sich in der Praxis genau so gezeigt hat (Legendaer-Rune bei Stufe
   0-9). Deshalb zusaetzlich eine harte Mindeststufe pro Raritaet: unterhalb
   davon ist diese Raritaet komplett ausgeschlossen (Gewicht 0), nicht nur
   unwahrscheinlich. Verschmelzen (bkmpRuneFuse) ist davon bewusst NICHT
   betroffen - wer sich 3 Epische erspielt/ertauscht hat, darf sie jederzeit
   zu Legendaer verschmelzen, das ist ja schon die Muehe wert gewesen. */
/* NACHBESSERUNG (15.07.): Boss-Drops waren bisher garantiert (100%) - auf
   Nutzerwunsch bewusst zurueckgenommen, Runen sollen insgesamt selten
   bleiben. Weitere Absenkung (15.07., zweite Nachbesserung): 10%/12% waren
   dem Nutzer noch zu hoch - jetzt 5% normal / 10% Boss, Bosse droppen also
   doppelt so oft wie normale Kaempfe statt nur +2 Prozentpunkte. */
const BKMP_RUNE_DROP_CHANCE = { normal: 0.05, boss: 0.10 };
const BKMP_RUNE_DROP_WEIGHTS = {
  normal: [65, 25, 8, 1.8, 0.2],
  boss: [30, 35, 25, 8, 2]
};
const BKMP_RUNE_RARITY_MIN_STAGE = { gray: 0, green: 5, blue: 15, purple: 35, gold: 75 };

function bkmpRuneNewLocalId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('local-' + Date.now() + '-' + Math.random().toString(36).slice(2));
}

/* ---------------- Aufwertung (+0 bis +15) + Sub-Stats ----------------
   Nach dem Vorbild von Summoners War: Sky Arena (auf Nutzerwunsch recher-
   chiert), an unsere kleinere Wirtschaft angepasst:
   - Jede Stufe erhoeht den Hauptwert der Rune um einen festen Anteil.
   - Bei +3/+6/+9/+12 kommt (falls unter dem Sub-Stat-Limit BKMP_RUNE_SUBSTAT_
     CAP) ein neuer, zufaellig gewuerfelter Sub-Stat hinzu (anderer Wert als
     der Hauptstat) - sonst wird stattdessen ein zufaelliger bereits
     vorhandener Sub-Stat weiter verstaerkt, genau wie in Summoners War jede
     Aufwertung IMMER etwas bewirkt, nicht nur an den Meilenstein-Stufen.
   - NACHBESSERUNG (15.07., Nutzerwunsch): Runen droppen/verschmelzen ab
     sofort schon MIT Sub-Stats, nicht mehr leer - die Anzahl haengt von der
     Seltenheit ab (BKMP_RUNE_MAX_SUBSTATS, unveraendert: gray 0/green 1/
     blue 2/purple 3/gold 4). Das universelle Maximum bleibt bei 4
     (BKMP_RUNE_SUBSTAT_CAP) fuer ALLE Seltenheiten - der Unterschied ist nur,
     wie viele davon schon beim Drop da sind und wie viele Meilensteine also
     noch NEUE Sub-Stats bringen statt vorhandene zu verstaerken. Beispiel:
     Gewoehnlich (0 beim Drop) -> alle 4 Meilensteine bringen einen neuen
     Sub-Stat, keiner wird je verstaerkt. Legendaer (4 beim Drop, schon am
     Limit) -> alle 4 Meilensteine verstaerken nur noch vorhandene.
   - NACHBESSERUNG (15.07., Nutzerwunsch): das anfangs bewusst weggelassene
     Fehlschlag-Risiko kommt jetzt doch dazu - Aufwerten kann fehlschlagen
     (Gold ist weg, Stufe bleibt gleich), Verschmelzen kann die 3 Runen
     komplett zerstoeren statt eine neue zu liefern (siehe
     BKMP_RUNE_FUSE_FAIL_CHANCE/bkmpIdleRuneUpgradeFailChance unten). */
/* Gemeinsamer Wrapper fuer alle Rune-Loesch-Aufrufe (Verkaufen/Verschmelzen/
   Aufstiegs-Fodder/Prestige-Reset): lokal wird die Rune IMMER sofort aus
   bkmpIdlePlayerRunes entfernt (optimistisches UI), der DB-Delete laeuft
   parallel fire-and-forget. Frueher wurde ein Fehlschlag dabei ueberall
   still verschluckt (.catch(() => {})) - GENAU das gleiche Muster wie der
   Runen-Aufstieg-Bug (siehe bkmpRuneAscend-Kommentar): die Rune verschwindet
   lokal, bleibt aber in der DB stehen und taucht nach einem Reload wieder
   auf (bei Verkauf/Verschmelzen sogar dupliziert, da das Gold/die neue Rune
   ja schon vergeben wurde). Mindestens sichtbar machen statt komplett
   verschlucken. */
function bkmpRuneDeleteRemote(ids, context) {
  if (!Array.isArray(ids) || !ids.length || typeof deletePlayerRunes !== 'function') return;
  deletePlayerRunes(ids).catch(err => {
    console.error(`Runen-Loeschung fehlgeschlagen (${context}) - betroffene Runen koennten nach einem Reload dupliziert wieder auftauchen.`, err, ids);
  });
}

const BKMP_RUNE_MAX_LEVEL = 15;
/* Runen-Aufstieg (Community-Wunsch 17.07., Discord-Zitat "wir brauchen
   Mythische Runen, hab zu viele legendäre" + eigener Vorschlag "+15 Legi +
   15 Legi verbinden -> +16, dann +16+16=+17..."): Legendaer (gold) war
   bisher eine Sackgasse - weder weiter verschmelzbar (siehe BKMP_RUNE_
   FUSE_FAIL_CHANCE-Kommentar oben, kein Eintrag fuer 'gold') noch ueber
   +15 aufwertbar, Dubletten blieben nur zum Verkauf fuer ein paar Gold
   uebrig. Statt einer komplett neuen 6. Seltenheitsstufe (neue Sprites,
   neue Drop-Tabellen-Balance) loest der Aufstieg das direkt mit dem
   bereits vorhandenen System: eine ZWEITE Legendaere Rune DERSELBEN Stufe
   (gleicher Slot) wird komplett verbraucht, die erste steigt um 1 Stufe -
   bis zum neuen absoluten Maximum +30. Bewusst OHNE Fehlschlagchance (der
   Preis ist bereits eine ganze zusaetzliche maximal aufgewertete
   Legendaere plus Gold) - anders als Verschmelzen/normales Aufwerten. */
const BKMP_RUNE_ASCEND_MAX_LEVEL = 30;
const BKMP_RUNE_SUBSTAT_MILESTONES = [3, 6, 9, 12];
/* Anzahl Sub-Stats, mit denen eine Rune dieser Seltenheit droppt/verschmilzt
   (siehe bkmpIdleRollInitialSubstats). Das absolute Maximum ist immer 4
   (BKMP_RUNE_SUBSTAT_CAP), unabhaengig von der Seltenheit. */
const BKMP_RUNE_MAX_SUBSTATS = { gray: 0, green: 1, blue: 2, purple: 3, gold: 4 };
const BKMP_RUNE_SUBSTAT_CAP = 4;
function bkmpRuneUpgrade(cid) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || !bkmpIdleState) return;
  /* Bug-Fix (Spieler-Reports 19.07., BagonTr01/Baerli: "+17/+18 Rune
     einfach weg, auch nicht im Lager"): eine frisch gedroppte Rune hat bis
     zu BKMP_RUNE_DROP_SYNC_DEBOUNCE_MS lang noch keine echte DB-id (siehe
     bkmpIdleQueueRuneSync) - bisher wartete ein Upgrade in dieser Zeit
     einfach weiter auf den naechsten Timer/Sichtbarkeitswechsel, bevor der
     naechste Speicherversuch ueberhaupt lief. Schliesst der Spieler den Tab
     GENAU in diesem Fenster (kein sanfter Tab-Wechsel, sondern ein echtes
     Schliessen - da kann selbst der beforeunload-Handler den Fetch nicht
     mehr zuverlaessig zu Ende bringen), war die Rune trotz aller
     Aufwertungen serverseitig nie angekommen. Ein Upgrade auf eine noch
     ungesicherte Rune stoesst deshalb jetzt zusaetzlich sofort einen
     Speicherversuch an, statt nur auf den naechsten Timer zu warten -
     verkleinert das Zeitfenster auf die Dauer dieses einen Fetches. */
  if (!rune.id && typeof bkmpIdleFlushRuneSyncNow === 'function') bkmpIdleFlushRuneSyncNow().catch(() => {});
  const level = Number(rune.upgrade_level || 0);
  if (level >= BKMP_RUNE_MAX_LEVEL) return;
  const cost = bkmpIdleRuneUpgradeCost(rune);
  if (bkmpIdleState.gold < cost) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('💰 Nicht genug Gold zum Aufwerten.', 2400);
    return;
  }
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === rune.rune_type);
  bkmpIdleState.gold -= cost;
  /* NACHBESSERUNG (Nutzerwunsch, 15.07.: "beim Upgraden chance des es nicht
     sich nicht upgraded und fehlschlägt"): das Gold ist bei einem
     Fehlschlag trotzdem weg (das IST das Risiko), nur die Stufe steigt
     nicht und Sub-Stats bleiben unangetastet - die Rune selbst geht dabei
     NICHT kaputt (anders als beim Verschmelzen), sie bleibt einfach auf
     der aktuellen Stufe stehen. */
  const failChance = bkmpIdleRuneUpgradeFailChance(rune);
  if (Math.random() < failChance) {
    bkmpIdleLog(`💥 ${slot.name} +${level}: Aufwertung fehlgeschlagen! Gold verloren, Stufe bleibt gleich.`);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`💥 Aufwertung fehlgeschlagen - ${cost} Gold futsch, Stufe bleibt +${level}.`, 3200);
    bkmpIdleState.rune_upgrade_failures = Number(bkmpIdleState.rune_upgrade_failures || 0) + 1;
    bkmpRuneCurrentlyViewing = cid;
    bkmpIdleRecomputeEffectiveStats();
    bkmpIdleRenderRunenPanel();
    bkmpIdleRenderHud();
    bkmpIdleQueueSync();
    return;
  }
  rune.upgrade_level = level + 1;
  rune.substats = Array.isArray(rune.substats) ? rune.substats : [];
  /* WICHTIG (Nachbesserung, Spieler-Meldung "bei jedem +1 Upgrade hoehere
     Substats?"): Sub-Stats duerfen sich NUR an den 4 Meilenstein-Stufen
     +3/+6/+9/+12 aendern (neu ODER verstaerkt) - an allen anderen 11 Stufen
     passiert mit den Sub-Stats gar nichts, nur der Hauptwert steigt (siehe
     bkmpIdleRuneEffectivePrimaryValue). Der Bug vorher: die "verstaerke
     einen vorhandenen Sub-Stat"-Zeile lief als reines else OHNE eigene
     Meilenstein-Abfrage, also bei JEDER Nicht-Meilenstein-Stufe auch -
     dadurch wuchsen Sub-Stats bei praktisch jedem Klick, nicht nur alle 3
     Stufen wie eigentlich gewollt. */
  if (BKMP_RUNE_SUBSTAT_MILESTONES.includes(rune.upgrade_level)) {
    if (rune.substats.length < BKMP_RUNE_SUBSTAT_CAP) {
      const usedStats = new Set([slot.stat, ...rune.substats.map(s => s.stat)]);
      const pool = Object.keys(BKMP_RUNE_SUBSTAT_WEIGHTS).filter(st => !usedStats.has(st));
      if (pool.length) {
        const newStat = bkmpRunePickWeightedStat(pool);
        rune.substats.push({ stat: newStat, value: bkmpIdleRollSubstatValue(newStat, rune.rarity), boostCount: 0 });
        const meta = bkmpRuneStatMeta(newStat);
        bkmpIdleLog(`✨ ${slot.name} +${rune.upgrade_level}: neuer Sub-Stat ${meta.icon} ${meta.desc}!`);
      }
    } else if (rune.substats.length) {
      const pick = rune.substats[Math.floor(Math.random() * rune.substats.length)];
      const bump = bkmpIdleRollSubstatValue(pick.stat, rune.rarity) * 0.5;
      pick.value = pick.stat.endsWith('_flat') ? pick.value + Math.max(1, Math.round(bump)) : Math.round((pick.value + bump) * 100) / 100;
      pick.boostCount = (pick.boostCount || 0) + 1;
    }
  }
  /* Ohne echte DB-id (frisch gedroppt/verschmolzen, Insert noch nicht
     zurueck) kann hier noch nicht persistiert werden - die Aufwertung
     wird trotzdem sofort lokal angewendet (spielt sich sonst wie ein
     Blocker an), und sobald die id eintrifft (siehe bkmpIdleQueueRuneSync/
     bkmpRuneFuse), wird der dann aktuelle Stand automatisch nachgetragen. */
  if (rune.id) updatePlayerRuneUpgrade(rune.id, rune.upgrade_level, rune.substats).catch(() => {});
  bkmpIdleState.rune_upgrade_successes = Number(bkmpIdleState.rune_upgrade_successes || 0) + 1;
  /* Phase 5.5 (19.07.): der haeufige Erfolgsfall (kein Meilenstein) hatte
     bisher UEBERHAUPT keine sichtbare Rueckmeldung, nur der Fehlschlag
     zeigte einen Toast - jetzt ein kompakter, seltenheitsgefaerbter Toast
     fuer jede erfolgreiche Aufwertung (Auftrag: "kleine Runenverbesserung"
     ist explizit als Stufe-1-Toast-Beispiel genannt). */
  if (typeof bkmpRewardPresent === 'function') {
    bkmpRewardPresent({
      tier: 'toast', rarity: rune.rarity,
      title: `${slot.name} auf +${rune.upgrade_level} verbessert`,
      dedupeKey: `rune-upgrade-${cid}-${rune.upgrade_level}`
    });
  }
  bkmpRuneCurrentlyViewing = cid;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderRunenPanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

/* Nutzerwunsch 19.07.: "Runen Instant auf +15 upgraden" - fasst wiederholte
   Einzelklicks auf bkmpRuneUpgrade() zu einem Schritt zusammen. Ruft
   bewusst dieselben Formeln auf (bkmpIdleRuneUpgradeCost/-FailChance,
   BKMP_RUNE_SUBSTAT_MILESTONES-Logik identisch zu bkmpRuneUpgrade oben) -
   keine Balance-Aenderung, nur weniger Klicks. Stoppt automatisch bei
   Stufe +15 ODER sobald das Gold fuer den naechsten Versuch nicht mehr
   reicht; bereits verbrauchtes Gold bei Fehlschlaegen bleibt real weg,
   exakt wie beim manuellen Aufwerten. Rendert/persistiert erst NACH der
   kompletten Schleife statt bei jedem Einzelschritt, damit z.B. 15 rasche
   Stufen nicht 15 Netzwerk-Aufrufe + 15 Toasts ausloesen. */
function bkmpRuneInstantUpgrade(cid) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || !bkmpIdleState) return;
  if (!rune.id && typeof bkmpIdleFlushRuneSyncNow === 'function') bkmpIdleFlushRuneSyncNow().catch(() => {});
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === rune.rune_type);
  rune.substats = Array.isArray(rune.substats) ? rune.substats : [];
  const startLevel = Number(rune.upgrade_level || 0);
  let goldSpent = 0, successes = 0, failures = 0;
  while (rune.upgrade_level < BKMP_RUNE_MAX_LEVEL) {
    const cost = bkmpIdleRuneUpgradeCost(rune);
    if (bkmpIdleState.gold < cost) break;
    bkmpIdleState.gold -= cost;
    goldSpent += cost;
    if (Math.random() < bkmpIdleRuneUpgradeFailChance(rune)) {
      failures++;
      bkmpIdleState.rune_upgrade_failures = Number(bkmpIdleState.rune_upgrade_failures || 0) + 1;
      continue;
    }
    successes++;
    rune.upgrade_level += 1;
    bkmpIdleState.rune_upgrade_successes = Number(bkmpIdleState.rune_upgrade_successes || 0) + 1;
    if (BKMP_RUNE_SUBSTAT_MILESTONES.includes(rune.upgrade_level)) {
      if (rune.substats.length < BKMP_RUNE_SUBSTAT_CAP) {
        const usedStats = new Set([slot.stat, ...rune.substats.map(s => s.stat)]);
        const pool = Object.keys(BKMP_RUNE_SUBSTAT_WEIGHTS).filter(st => !usedStats.has(st));
        if (pool.length) {
          const newStat = bkmpRunePickWeightedStat(pool);
          rune.substats.push({ stat: newStat, value: bkmpIdleRollSubstatValue(newStat, rune.rarity), boostCount: 0 });
        }
      } else if (rune.substats.length) {
        const pick = rune.substats[Math.floor(Math.random() * rune.substats.length)];
        const bump = bkmpIdleRollSubstatValue(pick.stat, rune.rarity) * 0.5;
        pick.value = pick.stat.endsWith('_flat') ? pick.value + Math.max(1, Math.round(bump)) : Math.round((pick.value + bump) * 100) / 100;
        pick.boostCount = (pick.boostCount || 0) + 1;
      }
    }
  }
  if (goldSpent === 0) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('💰 Nicht genug Gold für auch nur eine Aufwertung.', 2400);
    return;
  }
  bkmpIdleLog(`⚡ ${slot.name}: Instant-Aufwertung +${startLevel} → +${rune.upgrade_level} (${successes} Erfolge, ${failures} Fehlschläge, ${bkmpIdleFormatNumber(goldSpent)} Gold).`, true);
  if (rune.id) updatePlayerRuneUpgrade(rune.id, rune.upgrade_level, rune.substats).catch(() => {});
  if (typeof bkmpRewardPresent === 'function') {
    bkmpRewardPresent({
      tier: 'toast', rarity: rune.rarity,
      title: rune.upgrade_level > startLevel ? `${slot.name} instant auf +${rune.upgrade_level}` : `${slot.name}: alle Versuche fehlgeschlagen`,
      dedupeKey: `rune-instant-${cid}-${rune.upgrade_level}-${Date.now()}`
    });
  }
  bkmpRuneCurrentlyViewing = cid;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderRunenPanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

/* Substat-Reroll (Lategame-Content, Spieler-Vorgabe 16.07.): bisher gab es
   KEINERLEI Moeglichkeit, einen bereits vorhandenen Sub-Stat neu zu wuerfeln
   - einmal (bei Drop/Verschmelzung/Meilenstein) gewuerfelt, fuer immer so.
   Klassischer "perfekte Rune jagen"-Sog fuer genau die Spieler, die
   Skilltree/Prestige/Dungeons schon ausgereizt haben, UND eine neue
   Kristall-Senke. Wuerfelt bewusst nur den WERT neu (dieselbe Range wie
   beim urspruenglichen Wurf, siehe bkmpIdleRollSubstatValue), nicht den
   Stat-Typ selbst - das waere ein anderes, viel staerkeres Feature
   ("Stat tauschen") und wuerde die Substat-Gewichtung aus
   BKMP_RUNE_SUBSTAT_WEIGHTS aushebeln. */
function bkmpRuneRerollSubstatCost(rune) {
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rune.rarity);
  const mult = rarity ? rarity.mult : 1;
  return Math.max(1, Math.round(5 * mult * (1 + Number(rune.upgrade_level || 0) * 0.15)));
}
function bkmpRuneRerollSubstat(cid, statIndex) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || !bkmpIdleState) return;
  const substats = Array.isArray(rune.substats) ? rune.substats : [];
  const entry = substats[statIndex];
  if (!entry) return;
  const cost = bkmpRuneRerollSubstatCost(rune);
  if (Number(bkmpIdleState.crystals || 0) < cost) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('💎 Nicht genug Kristalle zum Neuwürfeln.', 2400);
    return;
  }
  bkmpIdleState.crystals -= cost;
  const oldValue = entry.value;
  /* Alt-Runen ohne gespeichertes boostCount (vor diesem Update aufgewertet)
     bekommen es hier aus dem bisherigen Wert geschaetzt und PERSISTENT
     gesetzt (siehe bkmpRuneSubstatEffectiveBoostCount) - ab jetzt zaehlt
     fuer diesen Sub-Stat nur noch die echte, mitgezaehlte Zahl. */
  entry.boostCount = bkmpRuneSubstatEffectiveBoostCount(entry, rune.rarity);
  entry.value = bkmpIdleRollBoostedSubstatValue(entry.stat, rune.rarity, entry.boostCount);
  const meta = bkmpRuneStatMeta(entry.stat);
  const subUnit = entry.stat.endsWith('_flat') ? '' : '%';
  const better = entry.value > oldValue;
  bkmpIdleLog(`🎲 Sub-Stat neu gewürfelt: ${meta.icon} ${meta.desc} +${oldValue}${subUnit} → +${entry.value}${subUnit}${better ? ' (besser!)' : ''}`);
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🎲 ${meta.icon} ${meta.desc}: +${entry.value}${subUnit}${better ? ' 📈' : ''}`, 2800);
  if (rune.id) updatePlayerRuneUpgrade(rune.id, rune.upgrade_level, rune.substats).catch(() => {});
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderRunenPanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

function bkmpRuneCanAscend(rune) {
  const level = Number(rune.upgrade_level || 0);
  return rune.rarity === 'gold' && level >= BKMP_RUNE_MAX_LEVEL && level < BKMP_RUNE_ASCEND_MAX_LEVEL;
}
/* Findet eine zweite, unausgeruestete Legendaere desselben Slots UND
   derselben Stufe - genau die "+15 Legi + +15 Legi"-Bedingung aus dem
   Spieler-Vorschlag. Absichtlich exakt gleiche Stufe (nicht nur "auch
   maximal"), damit sich hoehere Aufstiegsstufen nicht mit beliebigen
   +15-Dubletten billig weiterschummeln lassen. */
function bkmpRuneFindAscendFodder(rune) {
  const level = Number(rune.upgrade_level || 0);
  return bkmpIdlePlayerRunes.find(r => r._cid !== rune._cid && r.rune_type === rune.rune_type && r.rarity === 'gold' && Number(r.upgrade_level || 0) === level && !r.equipped);
}
function bkmpRuneAscend(cid) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || !bkmpIdleState || !bkmpRuneCanAscend(rune)) return;
  const fodder = bkmpRuneFindAscendFodder(rune);
  if (!fodder) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🌟 Brauchst eine zweite +${Number(rune.upgrade_level || 0)} Legendäre desselben Slots zum Verbrauchen.`, 3200);
    return;
  }
  const cost = bkmpIdleRuneUpgradeCost(rune);
  if (bkmpIdleState.gold < cost) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('💰 Nicht genug Gold zum Aufsteigen.', 2400);
    return;
  }
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === rune.rune_type);
  bkmpIdleState.gold -= cost;
  bkmpIdlePlayerRunes = bkmpIdlePlayerRunes.filter(r => r._cid !== fodder._cid);
  if (fodder.id) bkmpRuneDeleteRemote([fodder.id], 'Aufstiegs-Fodder');
  rune.upgrade_level = Number(rune.upgrade_level || 0) + 1;
  if (rune.id) updatePlayerRuneUpgrade(rune.id, rune.upgrade_level, rune.substats).catch(err => {
    console.error('bkmpRuneAscend: Speichern fehlgeschlagen, Aufstieg wird beim naechsten Laden zurueckgesetzt', err);
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('⚠️ Aufstieg konnte nicht gespeichert werden - bitte Seite neu laden und erneut versuchen.', 4000);
  });
  bkmpIdleState.rune_upgrade_successes = Number(bkmpIdleState.rune_upgrade_successes || 0) + 1;
  bkmpIdleLog(`🌟 ${slot ? slot.name : 'Rune'} auf +${rune.upgrade_level} aufgestiegen! Eine zweite Legendäre wurde dafür verbraucht.`);
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`🌟 Aufstieg geglückt: +${rune.upgrade_level}!`, 3200);
  bkmpRuneCurrentlyViewing = cid;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderRunenPanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

/* Auto-Aufstieg (Community-Wunsch DerJannikHase 15.07.: "wie das
   Autoschmelzen nur fuer Legendäre Runen ... alle die schon auf lvl15 sind
   nicht alle einzeln upgraden", von David 17.07. bestaetigt - nur Legendaer,
   nur Runen ab +15). Findet alle aktuell moeglichen Aufstiegs-Paare (zwei
   unausgeruestete ODER eine ausgeruestete + eine unausgeruestete Legendaere
   derselben Stufe UND desselben Slots) und verarbeitet sie in einem Rutsch,
   analog zu bkmpRuneAutoFuseAll. Bewusst EIN Durchgang ohne automatisches
   Weiterverketten ueber mehrere Stufen im selben Klick - erzeugt dieser
   Durchgang neue Paare auf der naechsthoeheren Stufe, reicht ein zweiter
   Klick (macht die Vorschau/Bestaetigung deutlich einfacher, bei
   vorhandenem Gold praktisch kein Mehraufwand). Innerhalb einer Gruppe wird
   die Rune mit den meisten/staerksten Sub-Stats als Ueberlebende bevorzugt,
   die "schwaechere" Kopie wird verbraucht. */
function bkmpRuneAutoAscendPairs(candidateRunes) {
  const eligible = (candidateRunes || []).filter(r => bkmpRuneCanAscend(r));
  const byKey = {};
  eligible.forEach(r => {
    const key = r.rune_type + '|' + Number(r.upgrade_level || 0);
    (byKey[key] = byKey[key] || []).push(r);
  });
  const pairs = [];
  Object.values(byKey).forEach(list => {
    const equipped = list.find(r => r.equipped) || null;
    const unequipped = list.filter(r => !r.equipped).sort((a, b) => {
      const subDiff = (b.substats || []).length - (a.substats || []).length;
      if (subDiff !== 0) return subDiff;
      return Number(b.rolled_value || 0) - Number(a.rolled_value || 0);
    });
    const pool = unequipped.slice();
    /* Die ausgeruestete Rune bleibt IMMER Ueberlebende (nie Fodder, sonst
       wird der Ausruestungs-Slot ungefragt leer) - verbraucht dafuer aber
       bewusst die SCHWAECHSTE Dublette (pool.pop() statt shift()), damit die
       staerkeren Dubletten fuer die reine Unter-sich-Paarung unten (wo immer
       die bessere von zweien ueberlebt) erhalten bleiben. */
    if (equipped && pool.length) pairs.push({ survivor: equipped, fodder: pool.pop() });
    while (pool.length >= 2) {
      const survivor = pool.shift();
      const fodder = pool.shift();
      pairs.push({ survivor, fodder });
    }
  });
  return pairs;
}
async function bkmpRuneAutoAscendAll() {
  const activeSlot = window.BKMP_RUNE_SLOTS.find(s => s.id === bkmpRuneActiveSlotTab);
  if (!activeSlot || !bkmpIdleState) return;
  const candidates = bkmpIdlePlayerRunes.filter(r => r.rune_type === activeSlot.id);
  const pairs = bkmpRuneAutoAscendPairs(candidates);
  if (!pairs.length) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`Keine passenden Legendäre-Paare (gleiche Stufe) bei ${activeSlot.name} zum Aufsteigen.`, 2800);
    return;
  }
  const totalCost = pairs.reduce((sum, p) => sum + bkmpIdleRuneUpgradeCost(p.survivor), 0);
  const confirmed = await bkmpConfirmDialog(
    `🌟 Auto-Aufstieg: ${pairs.length}× Legendäre?`,
    `Lässt bei ${activeSlot.name} alle ${pairs.length} aktuell passenden Legendäre-Paare (gleiche Stufe) automatisch aufsteigen, für insgesamt ${bkmpIdleFormatNumber(totalCost)} Gold. Jeweils eine zweite Legendäre wird dafür verbraucht.\n\n⚠️ Reicht das Gold nicht für alle Paare, werden nur so viele wie möglich verarbeitet.\n\nTrotzdem fortfahren?`,
    'Ja, alle aufsteigen',
    'Abbrechen'
  );
  if (!confirmed) return;
  let succeeded = 0;
  let skippedForGold = 0;
  pairs.forEach(({ survivor, fodder }) => {
    if (!bkmpIdleState || survivor.upgrade_level !== fodder.upgrade_level) return; // gleiche Rune kann nicht doppelt in zwei Paaren stecken
    if (!bkmpIdlePlayerRunes.includes(survivor) || !bkmpIdlePlayerRunes.includes(fodder)) return;
    const cost = bkmpIdleRuneUpgradeCost(survivor);
    if (bkmpIdleState.gold < cost) { skippedForGold += 1; return; }
    const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === survivor.rune_type);
    bkmpIdleState.gold -= cost;
    bkmpIdlePlayerRunes = bkmpIdlePlayerRunes.filter(r => r._cid !== fodder._cid);
    if (fodder.id) bkmpRuneDeleteRemote([fodder.id], 'Auto-Aufstieg-Fodder');
    survivor.upgrade_level = Number(survivor.upgrade_level || 0) + 1;
    if (survivor.id) updatePlayerRuneUpgrade(survivor.id, survivor.upgrade_level, survivor.substats).catch(err => {
      console.error('bkmpRuneAutoAscendAll: Speichern fehlgeschlagen', err);
    });
    bkmpIdleState.rune_upgrade_successes = Number(bkmpIdleState.rune_upgrade_successes || 0) + 1;
    succeeded += 1;
  });
  const summary = skippedForGold
    ? `🌟 ${succeeded}× Legendäre aufgestiegen, ${skippedForGold}× mangels Gold übersprungen.`
    : `🌟 Alle ${succeeded} Legendäre-Paare aufgestiegen!`;
  bkmpIdleLog(summary);
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(summary, 3800);
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderRunenPanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

/* ---------------- Runen-UI: eigenes Inventarfenster je Slot ---------------- */

let bkmpRuneActiveSlotTab = 'slot1';
let bkmpRuneCurrentlyViewing = null;
/* Aktiver Verschmelzen-Auswahlmodus: { rarityId, cids: [...] } oder null.
   Auf Nutzerwunsch (15.07., "Warnung einbauen. Und der Spieler soll gezielt
   einstellen welche verschmolzen") - vorher nahm bkmpRuneFuse() einfach die
   ersten 3 gefundenen Runen, auch eine +15 landete so ungefragt mit im
   Ofen. Jetzt waehlt der Spieler die 3 Instanzen selbst aus dem Lager aus,
   siehe bkmpRuneToggleFuseCandidate/bkmpRuneConfirmFuseSelection. */
let bkmpRuneFuseSelection = null;

function bkmpRuneSelectSlotTab(slotId) {
  if (!window.BKMP_RUNE_SLOTS.some(s => s.id === slotId)) return;
  bkmpRuneActiveSlotTab = slotId;
  bkmpRuneCurrentlyViewing = null;
  bkmpRuneFuseSelection = null;
  bkmpIdleRenderRunenPanel();
}

function bkmpRuneStartFuseSelection(rarityId) {
  bkmpRuneFuseSelection = { rarityId, cids: [] };
  bkmpIdleRenderRunenPanel();
}
function bkmpRuneCancelFuseSelection() {
  bkmpRuneFuseSelection = null;
  bkmpIdleRenderRunenPanel();
}
/* Maximale Auswahlgroesse - Vielfache von 3, damit jede Gruppe eine
   eigenstaendige Verschmelzung ergibt (Nutzerwunsch, 15.07.: "beim
   verschmelzen das man auch direkt 3/6/9 runen auswählen kann" - bisher
   war bei 3 hart Schluss, groessere Sammlungen mussten die Auswahl jedes
   Mal einzeln neu aufbauen). */
const BKMP_RUNE_FUSE_MAX_SELECT = 9;

function bkmpRuneToggleFuseCandidate(cid) {
  if (!bkmpRuneFuseSelection) return;
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || rune.rarity !== bkmpRuneFuseSelection.rarityId || rune.equipped) return;
  const idx = bkmpRuneFuseSelection.cids.indexOf(cid);
  if (idx >= 0) {
    bkmpRuneFuseSelection.cids.splice(idx, 1);
  } else {
    if (bkmpRuneFuseSelection.cids.length >= BKMP_RUNE_FUSE_MAX_SELECT) return;
    bkmpRuneFuseSelection.cids.push(cid);
  }
  bkmpIdleRenderRunenPanel();
}
/* Direktauswahl-Knoepfe "3/6/9" (siehe bkmpRuneFuseSelectionHTML) - fuellt
   die Auswahl automatisch mit den ersten N passenden, unausgeruesteten
   Instanzen statt jede einzeln anklicken zu muessen. Sortiert bewusst nach
   AUFSTEIGENDER Stufe zuerst (unaufgewertete +0-Runen zuerst gewaehlt),
   damit eine automatische Auswahl nicht unnoetig eine muehsam aufgewertete
   Rune "verbrennt", solange genug frische +0-Kopien vorhanden sind. */
function bkmpRuneQuickSelectFuse(count) {
  if (!bkmpRuneFuseSelection) return;
  const candidates = bkmpIdlePlayerRunes
    .filter(r => r.rune_type === bkmpRuneActiveSlotTab && r.rarity === bkmpRuneFuseSelection.rarityId && !r.equipped)
    .sort((a, b) => Number(a.upgrade_level || 0) - Number(b.upgrade_level || 0));
  bkmpRuneFuseSelection.cids = candidates.slice(0, Math.min(count, BKMP_RUNE_FUSE_MAX_SELECT)).map(r => r._cid);
  bkmpIdleRenderRunenPanel();
}
/* Feedback-Vorschlag (SpielKein MC HoleNurErfolge, 13.7.: "das Runen
   verschmelzen automatisieren? weil das etwas krampf mit den einfachen
   wenn man da 50 hat"), Nutzerentscheidung: "1 Button zusaetzlich einbauen
   mit alle verschmelzen" - bewusst OHNE das BKMP_RUNE_FUSE_MAX_SELECT-Limit
   (9) des "3 auswaehlen"-Buttons, damit man nicht mehrfach klicken/
   bestaetigen muss, wenn 50 einfache Runen vorliegen. bkmpRuneConfirmFuseSelection()
   verarbeitet beliebig viele Dreiergruppen ohnehin schon in einem Rutsch
   (eine Sammel-Zusammenfassung), das war nie das eigentliche Limit - nur
   die Auswahl-Buttons waren es. NACHBESSERUNG (17.07., "6 und 9 weg"): die
   6er/9er-Zwischenstufen wieder entfernt (nur noch 3 + Alle je Seltenheit),
   siehe bkmpRuneAutoFuseAll weiter unten fuer den neuen, seltenheits-
   uebergreifenden Ein-Klick-Weg. */
function bkmpRuneQuickSelectFuseAll() {
  if (!bkmpRuneFuseSelection) return;
  /* Spieler-Feedback (14.07.): "Es werden auch Runen verschmolzen die +1 +2
     +3 haben das soll so nicht" - nur noch unangetastete +0-Runen kommen
     automatisch in die Auswahl, keine Faellt-zurueck-auf-aufgewertet mehr. */
  const candidates = bkmpIdlePlayerRunes
    .filter(r => r.rune_type === bkmpRuneActiveSlotTab && r.rarity === bkmpRuneFuseSelection.rarityId && !r.equipped && Number(r.upgrade_level || 0) === 0);
  const usableCount = Math.floor(candidates.length / 3) * 3;
  bkmpRuneFuseSelection.cids = candidates.slice(0, usableCount).map(r => r._cid);
  bkmpIdleRenderRunenPanel();
}
/* Auto-Schmelzen ueber ALLE Seltenheiten (Spieler-Wunsch 17.07.: "6 und 9
   weg, dann autoschmelzen aller ... Runen mit einem Klick aller Farben") -
   ersetzt das rarity-weise Durchklicken (Seltenheit waehlen -> "Alle" ->
   bestaetigen, einmal PRO Seltenheit) durch einen einzigen Klick, der
   gray/green/blue/purple des aktuell offenen Slots in einem Rutsch
   durchgeht (Legendaer/gold faellt raus, siehe BKMP_RUNE_FUSE_FAIL_CHANCE-
   Kommentar - kann nicht weiter verschmolzen werden). Nutzt pro Seltenheit
   dieselbe strikte +0-Auswahl wie bkmpRuneQuickSelectFuseAll. NACHBESSERUNG
   (14.07., "Es werden auch Runen verschmolzen die +1 +2 +3 haben das soll
   so nicht"): der fruehere Rueckfall auf aufgewertete Runen (falls nicht
   genug +0-Kopien vorhanden waren) ist entfernt - eine Seltenheit wird nur
   noch aus komplett unangetasteten +0-Runen gruppiert, sonst ganz
   uebersprungen. */
async function bkmpRuneAutoFuseAll() {
  const activeSlot = window.BKMP_RUNE_SLOTS.find(s => s.id === bkmpRuneActiveSlotTab);
  if (!activeSlot || !bkmpIdleState) return;
  const fusableRarities = window.BKMP_RUNE_RARITIES.filter(r => r.id !== 'gold');
  const groups = [];
  fusableRarities.forEach(rarity => {
    const candidates = bkmpIdlePlayerRunes
      .filter(r => r.rune_type === activeSlot.id && r.rarity === rarity.id && !r.equipped && Number(r.upgrade_level || 0) === 0);
    const usableCount = Math.floor(candidates.length / 3) * 3;
    for (let i = 0; i < usableCount; i += 3) groups.push({ rarityId: rarity.id, cids: candidates.slice(i, i + 3).map(r => r._cid) });
  });
  if (!groups.length) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`Keine vollständigen +0-Dreiergruppen zum Verschmelzen bei ${activeSlot.name}.`, 2800);
    return;
  }
  const byRarityCount = {};
  groups.forEach(g => { byRarityCount[g.rarityId] = (byRarityCount[g.rarityId] || 0) + 1; });
  const summaryLine = fusableRarities.filter(r => byRarityCount[r.id]).map(r => `${byRarityCount[r.id]}× ${r.name}`).join(', ');
  const confirmed = await bkmpConfirmDialog(
    `🔥 Auto-Schmelzen: ${groups.length} Gruppen?`,
    `Verschmilzt bei ${activeSlot.name} alle vollständigen +0-Dreiergruppen über alle Seltenheiten hinweg: ${summaryLine} (insgesamt ${groups.length * 3} Runen).\n\n⚠️ Jede Gruppe hat je nach Seltenheit eine eigene Chance, komplett zerstört zu werden statt zu gelingen.\n\nTrotzdem fortfahren?`,
    'Ja, alle verschmelzen',
    'Abbrechen'
  );
  if (!confirmed) return;
  bkmpRuneFuseSelection = null;
  let succeeded = 0;
  let destroyed = 0;
  groups.forEach(g => {
    const result = bkmpRuneFuse(activeSlot.id, g.rarityId, g.cids);
    if (result && result.success) succeeded += 1;
    else destroyed += 1;
  });
  const summary = destroyed
    ? `🔥 ${succeeded}/${groups.length} Verschmelzungen erfolgreich, 💥 ${destroyed} zerstört.`
    : `🔥 Alle ${groups.length} Verschmelzungen erfolgreich!`;
  bkmpIdleLog(summary);
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(summary, 3800);
  bkmpIdleRenderRunenPanel();
}
/* Section C, Punkt 2 (Spieler-Wunsch 18.07.: "nicht mehr fragen"-Option
   fuer die Verschmelzen-Warnung): rein lokal in localStorage, jederzeit
   ueber die Checkbox im Verschmelzen-Panel zuruecksetzbar. Betrifft
   AUSSCHLIESSLICH die Bestaetigungs-NACHFRAGE (bkmpConfirmDialog) - alle
   bestehenden Sicherheitsregeln bleiben unveraendert: ausgeruestete Runen
   sind schon vorher gar nicht erst auswaehlbar (siehe availableCount-Filter
   in bkmpRuneFuseSelectionHTML, "!r.equipped"), die Fehlschlagchance selbst
   aendert sich nicht, und der Spieler muss die zu verschmelzenden Runen
   weiterhin jedes Mal selbst manuell auswaehlen - diese Einstellung
   ueberspringt nur den zusaetzlichen Bestaetigungsklick danach. */
const BKMP_RUNE_FUSE_AUTOCONFIRM_KEY = 'bkmp-rune-fuse-autoconfirm';
function bkmpRuneFuseAutoConfirmGet() {
  try { return localStorage.getItem(BKMP_RUNE_FUSE_AUTOCONFIRM_KEY) === '1'; } catch (e) { return false; }
}
function bkmpRuneFuseAutoConfirmSet(value) {
  try { localStorage.setItem(BKMP_RUNE_FUSE_AUTOCONFIRM_KEY, value ? '1' : '0'); } catch (e) {}
}

/* Bestaetigt die aktuelle Auswahl (3, 6 oder 9 Runen = 1, 2 oder 3
   unabhaengige Verschmelzungen) - warnt VORHER ueber beides: die
   Fehlschlagchance (Nutzerwunsch: "Chance einbauen das Runen beim
   Schmelzen kaputt gehen können") UND, falls zutreffend, ueber bereits
   aufgewertete Runen in der Auswahl (die bei Erfolg ihre Stufe verlieren,
   bei Fehlschlag komplett weg sind). Jede 3er-Gruppe wird einzeln per
   bkmpRuneFuse() gewuerfelt, damit Erfolg/Misserfolg nicht an der ganzen
   Auswahl haengt, sondern pro Dreiergruppe entschieden wird. */
async function bkmpRuneConfirmFuseSelection() {
  if (!bkmpRuneFuseSelection || bkmpRuneFuseSelection.cids.length === 0 || bkmpRuneFuseSelection.cids.length % 3 !== 0) return;
  const slotId = bkmpRuneActiveSlotTab;
  const rarityId = bkmpRuneFuseSelection.rarityId;
  const cids = bkmpRuneFuseSelection.cids.slice();
  const runes = cids.map(cid => bkmpIdlePlayerRunes.find(r => r._cid === cid)).filter(Boolean);
  if (runes.length !== cids.length) { bkmpRuneFuseSelection = null; bkmpIdleRenderRunenPanel(); return; }
  const groupCount = cids.length / 3;
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === slotId);
  const rarityDef = window.BKMP_RUNE_RARITIES.find(r => r.id === rarityId);
  const failPct = Math.round((BKMP_RUNE_FUSE_FAIL_CHANCE[rarityId] || 0) * 100);
  /* Spieler-Feedback (15.07.): "Das muss geändert werden.. Entfernen
     einfach? weil das die sub stats haben wissen sie selber" - bei "Alle
     verschmelzen" (siehe bkmpRuneQuickSelectFuseAll) kann diese Liste
     Dutzende/Hunderte Runen einzeln aufzaehlen ("+0 mit 1 Sub-Stat" x50) -
     eine unlesbare Textwand statt einer hilfreichen Warnung. Nur noch die
     Anzahl nennen, keine Einzelaufzaehlung mehr - der Spieler kennt seine
     eigenen Runen ohnehin. */
  const withProgress = runes.filter(r => Number(r.upgrade_level || 0) > 0 || (r.substats && r.substats.length));
  const progressLine = withProgress.length
    ? `\n\n⚠️ ${withProgress.length} der ausgewählten ${slot ? slot.name : 'Runen'} ${withProgress.length === 1 ? 'ist' : 'sind'} bereits aufgewertet - bei Erfolg startet das Ergebnis trotzdem wieder bei +0.`
    : '';
  /* Section C, Punkt 2: bei aktivierter "nicht mehr fragen"-Option wird
     nur die NACHFRAGE uebersprungen, siehe Kommentar bei
     BKMP_RUNE_FUSE_AUTOCONFIRM_KEY - die Auswahl selbst hat der Spieler
     bereits manuell getroffen. */
  const confirmed = bkmpRuneFuseAutoConfirmGet() || await bkmpConfirmDialog(
    `✨ ${groupCount}× verschmelzen?`,
    `Du verschmilzt ${cids.length} ${rarityDef ? rarityDef.name : ''} ${slot ? slot.name : ''} in ${groupCount} unabhängigen Gruppen zu je 3.\n\n⚠️ Jede Gruppe hat eine ${failPct}%-Chance, dass die 3 eingesetzten Runen dabei komplett zerstört werden (keine neue Rune, alle 3 sind weg) statt zu gelingen.${progressLine}\n\nTrotzdem fortfahren?`,
    'Ja, verschmelzen',
    'Abbrechen'
  );
  if (!confirmed) return;

  bkmpRuneFuseSelection = null;
  let succeeded = 0;
  let destroyed = 0;
  for (let i = 0; i < cids.length; i += 3) {
    const group = cids.slice(i, i + 3);
    const result = bkmpRuneFuse(slotId, rarityId, group);
    if (result && result.success) succeeded += 1;
    else destroyed += 1;
  }
  const newRarityDef = window.BKMP_RUNE_RARITIES[window.BKMP_RUNE_RARITIES.findIndex(r => r.id === rarityId) + 1];
  /* Phase 5.5 (19.07.), Abschnitt 5 "Rune erhalten und verbessern" (Fusion):
     bisher gab es fuer eine erfolgreiche Verschmelzung UEBERHAUPT keine
     eigene Rueckmeldung ausser dem Kampf-Log - jetzt eine Karte statt nur
     Toast (analog zum Runenfund, siehe bkmpIdleMaybeDropRune), aber weiterhin
     GENAU EIN Aufruf pro Bestaetigung, egal wie viele 3er-Gruppen dabei
     verschmolzen wurden (die Schleife oben sammelt succeeded/destroyed
     bereits fertig - keine Karte pro Einzelgruppe, das waere bei "Alle
     verschmelzen" mit vielen Gruppen genau das im Auftrag verbotene
     "zehn Dialoge"-Spam). */
  if (groupCount > 1) {
    const summary = destroyed
      ? `✨ ${succeeded}/${groupCount} Verschmelzungen erfolgreich, 💥 ${destroyed} zerstört.`
      : `✨ Alle ${groupCount} Verschmelzungen erfolgreich!`;
    bkmpIdleLog(summary);
    if (typeof bkmpRewardPresent === 'function' && succeeded > 0) {
      bkmpRewardPresent({
        tier: 'card',
        rarity: newRarityDef.id,
        icon: '✨',
        title: `${succeeded}× zu ${newRarityDef.name} verschmolzen`,
        description: destroyed ? `${destroyed} Gruppe${destroyed === 1 ? '' : 'n'} dabei zerstört.` : `${slot ? slot.name : ''} - alle Verschmelzungen erfolgreich.`,
        source: 'Runenschmiede',
        dedupeKey: `rune-fuse-batch-${Date.now()}`
      });
    } else if (typeof bkmpShowJannikToast === 'function') {
      bkmpShowJannikToast(summary, 3600);
    }
  } else if (succeeded) {
    if (typeof bkmpRewardPresent === 'function') {
      bkmpRewardPresent({
        tier: 'card',
        rarity: newRarityDef.id,
        icon: '✨',
        title: `${newRarityDef.name} ${slot ? slot.name : ''} erhalten`,
        description: 'Durch Verschmelzung von 3 Runen entstanden.',
        source: 'Runenschmiede',
        dedupeKey: `rune-fuse-single-${Date.now()}`
      });
    } else if (typeof bkmpShowJannikToast === 'function') {
      bkmpShowJannikToast(`✨ Verschmolzen: ${newRarityDef.name} ${slot ? slot.name : ''}!`, 3200);
    }
  }
}

function bkmpRuneStatBoxHTML(slot, rune) {
  if (!rune) return `<p class="idle-runen-stat-placeholder">Du besitzt noch keine ${escapeHtml(slot.name)} - beim Kämpfen und bei Bossen droppen zufällig neue.</p>`;
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rune.rarity);
  const level = Number(rune.upgrade_level || 0);
  const unit = '%';
  const effectiveValue = bkmpIdleRuneEffectivePrimaryValue(rune);
  const isMaxLevel = level >= BKMP_RUNE_MAX_LEVEL;
  const cost = bkmpIdleRuneUpgradeCost(rune);
  const canAffordUpgrade = bkmpIdleState && bkmpIdleState.gold >= cost;
  const sameGroup = bkmpIdlePlayerRunes.filter(r => r.rune_type === rune.rune_type && r.rarity === rune.rarity && !r.equipped);
  const canFuse = sameGroup.length >= 3 && rune.rarity !== 'gold';
  const upgradeFailPct = Math.round(bkmpIdleRuneUpgradeFailChance(rune) * 100);
  /* Aufstieg (siehe BKMP_RUNE_ASCEND_MAX_LEVEL oben) - nur relevant, sobald
     eine Legendaere den normalen Cap von +15 erreicht hat. */
  const showAscend = rune.rarity === 'gold' && level >= BKMP_RUNE_MAX_LEVEL;
  const canAscend = bkmpRuneCanAscend(rune);
  const ascendFodder = canAscend ? bkmpRuneFindAscendFodder(rune) : null;
  const ascendCost = canAscend ? bkmpIdleRuneUpgradeCost(rune) : 0;
  const canAffordAscend = canAscend && bkmpIdleState && bkmpIdleState.gold >= ascendCost;
  const isFullyAscended = rune.rarity === 'gold' && level >= BKMP_RUNE_ASCEND_MAX_LEVEL;
  return `
    <div class="idle-runen-stat-head" style="--rune-color:${rarity.color}">
      <img src="assets/runes/${slot.id}-${rune.rarity}.png?v=${BKMP_RUNE_IMG_V}" alt="" loading="lazy" decoding="async">
      <div>
        <div class="idle-runen-stat-name">${slot.icon} ${escapeHtml(slot.name)} <span class="idle-runen-stat-level">+${level}</span></div>
        <div class="idle-runen-stat-rarity">${escapeHtml(rarity.name)}</div>
      </div>
      <button type="button" class="${rune.equipped ? 'btn-nein' : 'btn-ja'} idle-runen-equip-btn" id="idleRuneEquipBtn" data-cid="${rune._cid}">
        ${rune.equipped ? 'Entfernen' : 'Einsetzen'}
      </button>
    </div>
    <p class="idle-runen-stat-line idle-runen-stat-primary">+${effectiveValue}${unit} ${escapeHtml(slot.desc)}</p>
    ${rune.substats && rune.substats.length ? `<ul class="idle-runen-substat-list">
      ${rune.substats.map((s, i) => {
        const meta = bkmpRuneStatMeta(s.stat);
        const subUnit = s.stat.endsWith('_flat') ? '' : '%';
        const rerollCost = bkmpRuneRerollSubstatCost(rune);
        const canAffordReroll = bkmpIdleState && Number(bkmpIdleState.crystals || 0) >= rerollCost;
        /* Nutzerwunsch 19.07.: "dazu schreiben in was für einer Spanne man
           rerollt" - zeigt die tatsaechliche Ziel-Spanne (inkl. bereits
           erhaltener Meilenstein-Boosts). Nachbesserung (Spieler-Meldung
           "wie kann das sein, 2,8% bis 4,2%, wenn 7.64 bereits drauf
           sind"): fuer Alt-Runen ohne gespeichertes boostCount (vor diesem
           Update aufgewertet) ueber bkmpRuneSubstatEffectiveBoostCount aus
           dem sichtbaren Wert geschaetzt, statt faelschlich boostCount=0
           anzunehmen - sonst widersprach die Spanne dem eigenen aktuellen
           Wert. Zweite Nachbesserung: steht jetzt direkt sichtbar daneben
           (zusaetzlich weiterhin im title-Tooltip), nicht mehr nur beim
           Hovern sichtbar. */
        const effectiveBoost = bkmpRuneSubstatEffectiveBoostCount(s, rune.rarity);
        const [rerollMin, rerollMax] = bkmpIdleSubstatValueRange(s.stat, rune.rarity, effectiveBoost);
        return `<li>${meta.icon} +${s.value}${subUnit} ${escapeHtml(meta.desc)}
          <button type="button" class="idle-runen-reroll-btn" data-cid="${rune._cid}" data-index="${i}" ${canAffordReroll ? '' : 'disabled'} title="Diesen Sub-Stat neu würfeln (Spanne +${rerollMin}${subUnit} bis +${rerollMax}${subUnit})">🎲 ${rerollCost} 💎</button>
          <span class="idle-runen-reroll-range">Spanne +${rerollMin}${subUnit} bis +${rerollMax}${subUnit}</span></li>`;
      }).join('')}
    </ul>` : '<p class="idle-runen-stat-note">Noch keine Sub-Stats - bei +3/+6/+9/+12 kommt bis zu insgesamt 4 jeweils einer dazu.</p>'}
    <div class="idle-runen-stat-actions">
      <button type="button" class="btn-ja idle-runen-upgrade-btn" id="idleRuneUpgradeBtn" data-cid="${rune._cid}" ${isMaxLevel || !canAffordUpgrade ? 'disabled' : ''} title="${isMaxLevel ? '' : `${upgradeFailPct}% Chance, dass die Aufwertung fehlschlägt (Gold ist dann trotzdem weg)`}">
        ${isMaxLevel ? `⭐ Maximal aufgewertet (+${BKMP_RUNE_MAX_LEVEL})` : `⬆️ Aufwerten (${cost} Gold${upgradeFailPct ? `, ${upgradeFailPct}% Risiko` : ''})`}
      </button>
      ${!isMaxLevel ? `<button type="button" class="btn-nein idle-runen-instant-btn" id="idleRuneInstantBtn" data-cid="${rune._cid}" ${canAffordUpgrade ? '' : 'disabled'} title="Wiederholt automatisch aufwerten, bis +${BKMP_RUNE_MAX_LEVEL} erreicht ist oder das Gold nicht mehr reicht - gleiches Risiko/gleiche Kosten pro Stufe wie ein einzelner Klick auf Aufwerten.">⚡ Instant bis +${BKMP_RUNE_MAX_LEVEL}</button>` : ''}
    </div>
    ${showAscend ? `
    <div class="idle-runen-stat-actions">
      <button type="button" class="btn-ja idle-runen-ascend-btn" id="idleRuneAscendBtn" data-cid="${rune._cid}" ${!canAscend || !ascendFodder || !canAffordAscend ? 'disabled' : ''} title="Verbraucht eine zweite unausgerüstete Legendäre desselben Slots UND derselben Stufe, um +1 Stufe zu erreichen (bis +${BKMP_RUNE_ASCEND_MAX_LEVEL}).">
        ${isFullyAscended ? `🌟 Vollständig aufgestiegen (+${BKMP_RUNE_ASCEND_MAX_LEVEL})` : `🌟 Aufsteigen auf +${level + 1} (${ascendCost} Gold${ascendFodder ? '' : `, 2. +${level} Legendäre nötig`})`}
      </button>
    </div>` : ''}
    <div class="idle-runen-stat-actions">
      <button type="button" class="btn-nein idle-runen-fuse-btn" id="idleRuneFuseBtn" data-rarity="${rune.rarity}" ${canFuse ? '' : 'disabled'}>
        ✨ Verschmelzen (auswählen)${canFuse ? '' : ` (${sameGroup.length}/3)`}
      </button>
      <button type="button" class="btn-nein idle-runen-sell-btn" id="idleRuneSellBtn" data-cid="${rune._cid}" ${rune.equipped ? 'disabled' : ''}>
        💰 verkaufen (+${bkmpRuneSellValue(rune)})
      </button>
    </div>
  `;
}

/* Ruestet eine konkrete Rune-Instanz aus/ab (per _cid, nicht mehr nur
   Slot+Seltenheit, da Instanzen jetzt durch Stufe/Sub-Stats unterschiedlich
   stark sein koennen).
   FIX 18.07. (Spieler-Bug-Report: 2x Wuchtrune + 2x Gluecksrune gleichzeitig
   ausgeruestet): frueher wurde eine bereits ausgeruestete Rune derselben
   Art beim Ausruesten einer anderen automatisch stillschweigend ersetzt.
   Auf ausdruecklichen Wunsch wird das Ausruesten jetzt stattdessen
   BLOCKIERT und verstaendlich begruendet, wenn diese Runenart schon an
   anderer Stelle ausgeruestet ist - der Spieler muss die alte Rune erst
   bewusst selbst entfernen (verhindert versehentliches Ersetzen einer
   hochgelevelten Rune per Fehlklick). .filter() statt .find(), damit auch
   ein bereits bestehender, ungueltiger 2x-Zustand hier zuverlaessig erkannt
   und nicht nur zur Haelfte aufgeloest wird. Siehe auch
   bkmpRuneNormalizeDuplicateEquips() fuer die Bereinigung beim Laden. */
function bkmpRuneToggleEquip(cid) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune) return;
  // Bug-Fix (19.07.), gleicher Grund wie in bkmpRuneUpgrade oben.
  if (!rune.id && typeof bkmpIdleFlushRuneSyncNow === 'function') bkmpIdleFlushRuneSyncNow().catch(() => {});
  if (rune.equipped) {
    rune.equipped = false;
    if (rune.id) updatePlayerRuneEquipped(rune.id, false).catch(() => {});
  } else {
    const conflicting = bkmpIdlePlayerRunes.filter(r => r.rune_type === rune.rune_type && r.equipped && r._cid !== cid);
    if (conflicting.length > 0) {
      const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === rune.rune_type);
      const slotName = slot ? slot.name : rune.rune_type;
      if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`⚠️ ${slotName} ist bereits ausgerüstet - erst die andere entfernen, bevor du diese ausrüstest.`, 3600);
      bkmpRuneCurrentlyViewing = cid;
      bkmpIdleRenderRunenPanel();
      return;
    }
    rune.equipped = true;
    if (rune.id) updatePlayerRuneEquipped(rune.id, true).catch(() => {});
  }
  bkmpRuneCurrentlyViewing = cid;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderRunenPanel();
  bkmpIdleRenderHud();
}

/* Sicherheitsnetz gegen doppelt ausgeruestete Runenarten (Spieler-Bug-
   Report 18.07.: 2x Wuchtrune + 2x Gluecksrune gleichzeitig ausgeruestet -
   vermutlich durch geraeteuebergreifendes/paralleles Ausruesten entstanden,
   da der obige Check in bkmpRuneToggleEquip nur den aktuellen Client sieht
   und updatePlayerRuneEquipped() serverseitig ein einfaches Einzelzeilen-
   Update ohne typuebergreifende Exklusivitaet ist). Laeuft automatisch bei
   jedem Laden des Runenbestands (siehe idledorf.js, Aufruf direkt nach
   loadPlayerRunes) - heilt dadurch auch bereits bestehende ungueltige
   Spielstaende, OHNE dass irgendeine Rune geloescht wird: pro Runenart
   bleibt nur die staerkste (bkmpIdleRuneEffectivePrimaryValue - beruecksichtigt
   sowohl den gewuerfelten Hauptwert als auch die Aufwertungsstufe) weiter
   ausgeruestet, alle weiteren wandern zurueck ins Inventar (equipped:false)
   und werden mit der DB synchronisiert. Behebt nebenbei automatisch die
   doppelte Wertanrechnung in bkmpIdleRuneEffectTotals(), die bislang ALLE
   equipped===true-Runen ohne Typ-Deduplizierung aufsummiert hat. */
function bkmpRuneNormalizeDuplicateEquips() {
  const byType = new Map();
  bkmpIdlePlayerRunes.forEach(r => {
    if (!r.equipped) return;
    if (!byType.has(r.rune_type)) byType.set(r.rune_type, []);
    byType.get(r.rune_type).push(r);
  });
  let fixedCount = 0;
  byType.forEach(group => {
    if (group.length <= 1) return;
    group.sort((a, b) => bkmpIdleRuneEffectivePrimaryValue(b) - bkmpIdleRuneEffectivePrimaryValue(a));
    group.slice(1).forEach(r => {
      r.equipped = false;
      fixedCount++;
      if (r.id) updatePlayerRuneEquipped(r.id, false).catch(() => {});
    });
  });
  if (fixedCount > 0) {
    console.warn(`[bkmp-runes] ${fixedCount} ungültig doppelt ausgerüstete Rune(n) automatisch normalisiert (stärkste blieb ausgerüstet, Rest zurück ins Inventar).`);
  }
  return fixedCount;
}

/* Fehlschlagchance beim Verschmelzen (Nutzerwunsch, 15.07.: "Chance
   einbauen das Runen beim Schmelzen kaputt gehen können.. so höher die
   Rarity desto eher") - je hoeher die Seltenheit der 3 EINGESETZTEN Runen,
   desto riskanter. Bei Fehlschlag sind alle 3 unwiderruflich weg (keine
   neue Rune) - keine der 5 Seltenheiten kann selbst verschmolzen werden
   (Legendaer ist die Obergrenze), daher kein Eintrag fuer "gold" noetig. */
const BKMP_RUNE_FUSE_FAIL_CHANCE = { gray: 0.03, green: 0.06, blue: 0.12, purple: 0.20 };

/* 3 unausgeruestete Runen gleichen Slots + gleicher Seltenheit -> 1 neue
   Rune der naechsten Seltenheitsstufe (frisch gewuerfelter Hauptwert +
   frisch gewuerfelte Sub-Stats passend zur neuen Seltenheit, siehe
   bkmpIdleRollInitialSubstats - startet aber bewusst wieder bei +0, sonst
   wuerde Verschmelzen zum umstaendlichen Umweg, um eine hoehere Stufe
   "billiger" aufzuwerten, statt einer eigenstaendigen Belohnung fuer viele
   gesammelte Runen). Legendär ist die Obergrenze, kann nicht weiter
   verschmolzen werden.
   cids (optional): genau 3 vom Spieler ausgewaehlte Instanzen (siehe
   bkmpRuneConfirmFuseSelection) - werden diese uebergeben, gelten NUR sie,
   nicht mehr einfach "die ersten 3 gefundenen" (Spieler-Wunsch: gezielt
   auswaehlen koennen, damit z.B. eine +15 nicht ungefragt mitverschmilzt).
   Gibt { success, newRune? } zurueck, damit bkmpRuneConfirmFuseSelection
   bei mehreren Gruppen (3/6/9, siehe dort) die Ergebnisse zusammenzaehlen
   kann. */
function bkmpRuneFuse(slotId, rarityId, cids) {
  const rarityIndex = window.BKMP_RUNE_RARITIES.findIndex(r => r.id === rarityId);
  if (rarityIndex < 0 || rarityIndex >= window.BKMP_RUNE_RARITIES.length - 1) return { success: false };
  let consumed;
  if (Array.isArray(cids) && cids.length === 3) {
    consumed = cids
      .map(cid => bkmpIdlePlayerRunes.find(r => r._cid === cid && r.rune_type === slotId && r.rarity === rarityId && !r.equipped))
      .filter(Boolean);
    if (consumed.length !== 3) return { success: false };
  } else {
    const candidates = bkmpIdlePlayerRunes.filter(r => r.rune_type === slotId && r.rarity === rarityId && !r.equipped);
    if (candidates.length < 3) return { success: false };
    consumed = candidates.slice(0, 3);
  }
  const consumedIds = consumed.map(r => r.id).filter(Boolean);
  bkmpIdlePlayerRunes = bkmpIdlePlayerRunes.filter(r => !consumed.includes(r));
  bkmpRuneDeleteRemote(consumedIds, 'Verschmelzen');
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === slotId);
  const rarityDef = window.BKMP_RUNE_RARITIES[rarityIndex];

  const failChance = BKMP_RUNE_FUSE_FAIL_CHANCE[rarityId] || 0;
  if (Math.random() < failChance) {
    bkmpIdleLog(`💥 3× ${slot.name} (${rarityDef.name}) beim Verschmelzen zerstört - kein Ergebnis!`);
    if (bkmpIdleState) {
      bkmpIdleState.rune_fuse_failures = Number(bkmpIdleState.rune_fuse_failures || 0) + 1;
      bkmpIdleQueueSync();
    }
    bkmpIdleRenderRunenPanel();
    return { success: false, destroyed: true };
  }

  const newRarity = window.BKMP_RUNE_RARITIES[rarityIndex + 1];
  const newValue = bkmpIdleRollRuneValue(slotId, newRarity.id);
  const primarySlotObj = window.BKMP_RUNE_SLOTS.find(s => s.id === slotId);
  const newSubstats = bkmpIdleRollInitialSubstats(primarySlotObj ? primarySlotObj.stat : null, newRarity.id);
  const newRune = { id: null, _cid: bkmpRuneNewLocalId(), rune_type: slotId, rarity: newRarity.id, rolled_value: newValue, equipped: false, upgrade_level: 0, substats: newSubstats, created_at: new Date().toISOString() };
  bkmpIdlePlayerRunes.push(newRune);
  if (bkmpIdleState && typeof insertPlayerRunes === 'function') {
    insertPlayerRunes(bkmpIdleState.name_key, [{ rune_type: slotId, rarity: newRarity.id, rolled_value: newValue, equipped: false, upgrade_level: 0, substats: newSubstats }])
      .then(rows => {
        if (!rows || !rows[0]) return;
        newRune.id = rows[0].id;
        /* Siehe bkmpIdleQueueRuneSync - falls die frisch verschmolzene Rune
           schon ausgeruestet/aufgewertet wurde, bevor die id zurueckkam. */
        if (newRune.equipped && typeof updatePlayerRuneEquipped === 'function') updatePlayerRuneEquipped(newRune.id, true).catch(() => {});
        if ((newRune.upgrade_level || (newRune.substats && newRune.substats.length)) && typeof updatePlayerRuneUpgrade === 'function') {
          updatePlayerRuneUpgrade(newRune.id, newRune.upgrade_level, newRune.substats).catch(() => {});
        }
      })
      .catch(() => {});
  }
  bkmpIdleLog(`✨ 3× ${slot.name} (${rarityDef.name}) zu ${newRarity.name} verschmolzen!`);
  if (bkmpIdleState) {
    bkmpIdleState.rune_fuse_successes = Number(bkmpIdleState.rune_fuse_successes || 0) + 1;
    bkmpIdleQueueSync();
  }
  bkmpRuneCurrentlyViewing = newRune._cid;
  bkmpIdleRenderRunenPanel();
  return { success: true, newRune };
}

/* Balance-Nachbesserung 17.07. ("Verkaufen ist witzlos ... eine +12
   Legendaere mit 3 Sub-Stats verkauft sich genauso billig wie eine
   frische +0"): der Verkaufswert war bisher NUR von der Seltenheit
   abhaengig (fixe rarity.sellGold), Stufe/Sub-Stats floss nie mit ein.
   Jetzt: +15% des Basiswerts pro Aufwertungs-Stufe, +25% pro Sub-Stat -
   eine ausgereizte Legendaere (+15, 4 Sub-Stats) verkauft sich dadurch
   fuer etwa das 6,5-fache einer frischen. */
function bkmpRuneSellValue(rune) {
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rune.rarity);
  const base = rarity ? rarity.sellGold : 10;
  const level = Number(rune.upgrade_level || 0);
  const substatCount = (rune.substats || []).length;
  return Math.round(base * (1 + level * 0.15) * (1 + substatCount * 0.25));
}
function bkmpRuneSell(cid) {
  const rune = bkmpIdlePlayerRunes.find(r => r._cid === cid);
  if (!rune || rune.equipped || !bkmpIdleState) return;
  const value = bkmpRuneSellValue(rune);
  bkmpIdlePlayerRunes = bkmpIdlePlayerRunes.filter(r => r !== rune);
  bkmpIdleState.gold += value;
  if (rune.id) bkmpRuneDeleteRemote([rune.id], 'Einzelverkauf');
  if (bkmpRuneCurrentlyViewing === cid) bkmpRuneCurrentlyViewing = null;
  bkmpIdleRenderHud();
  bkmpIdleRenderRunenPanel();
  bkmpIdleQueueSync();
}
/* Sammel-Verkauf (Community-Wunsch 17.07., Pendant zu "Alle
   verschmelzen"): verkauft ALLE unausgeruesteten Runen des aktuell
   offenen Slot-Tabs auf einmal - bewusst NUR den aktiven Slot, nicht
   alle 6 gleichzeitig, damit man nicht versehentlich Verschmelzen-/
   Aufstiegs-Fodder in einem anderen Slot mitverkauft. Mit Bestaetigung
   vorher (Gesamtwert + Anzahl), da nicht rueckgaengig machbar. */
async function bkmpRuneSellAllDuplicates() {
  const activeSlot = window.BKMP_RUNE_SLOTS.find(s => s.id === bkmpRuneActiveSlotTab);
  if (!activeSlot || !bkmpIdleState) return;
  const candidates = bkmpIdlePlayerRunes.filter(r => r.rune_type === activeSlot.id && !r.equipped);
  if (!candidates.length) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`Keine unausgerüsteten ${activeSlot.name} zum Verkaufen.`, 2600);
    return;
  }
  const totalValue = candidates.reduce((sum, r) => sum + bkmpRuneSellValue(r), 0);
  const confirmed = await bkmpConfirmDialog(
    `💰 ${candidates.length}× ${activeSlot.name} verkaufen?`,
    `Verkauft alle ${candidates.length} unausgerüsteten ${activeSlot.name} für insgesamt ${bkmpIdleFormatNumber(totalValue)} Gold.\n\n⚠️ Das gilt auch für bereits aufgewertete Runen, die du evtl. noch als 2. Rune fürs Verschmelzen oder den Aufstieg brauchst - nicht rückgängig machbar.`,
    'Ja, verkaufen',
    'Abbrechen'
  );
  if (!confirmed) return;
  const ids = candidates.map(r => r.id).filter(Boolean);
  bkmpIdlePlayerRunes = bkmpIdlePlayerRunes.filter(r => !candidates.includes(r));
  bkmpRuneDeleteRemote(ids, 'Sammelverkauf');
  bkmpIdleState.gold += totalValue;
  if (candidates.some(r => r._cid === bkmpRuneCurrentlyViewing)) bkmpRuneCurrentlyViewing = null;
  bkmpIdleLog(`💰 ${candidates.length}× ${activeSlot.name} verkauft für ${bkmpIdleFormatNumber(totalValue)} Gold.`);
  if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(`💰 ${candidates.length}× verkauft: +${bkmpIdleFormatNumber(totalValue)} Gold`, 3200);
  bkmpIdleRenderHud();
  bkmpIdleRenderRunenPanel();
  bkmpIdleQueueSync();
}

function bkmpRuneFuseSelectionHTML(slot) {
  const sel = bkmpRuneFuseSelection;
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === sel.rarityId);
  const count = sel.cids.length;
  const selectedRunes = sel.cids.map(cid => bkmpIdlePlayerRunes.find(r => r._cid === cid)).filter(Boolean);
  const hasProgress = selectedRunes.some(r => Number(r.upgrade_level || 0) > 0 || (r.substats && r.substats.length));
  const availableCount = bkmpIdlePlayerRunes.filter(r => r.rune_type === slot.id && r.rarity === sel.rarityId && !r.equipped).length;
  const failPct = Math.round((BKMP_RUNE_FUSE_FAIL_CHANCE[sel.rarityId] || 0) * 100);
  const isValidCount = count > 0 && count % 3 === 0;
  return `
    <div class="idle-runen-fuse-panel" style="--rune-color:${rarity.color}">
      <div class="idle-runen-fuse-title">✨ ${escapeHtml(rarity.name)} ${escapeHtml(slot.name)} verschmelzen</div>
      <p class="idle-runen-fuse-hint">Wähle unten im Lager ${escapeHtml(rarity.name)}-Kopien in einer Dreiergruppe aus - ${failPct}% Chance, dass die 3 Runen dabei zerstört werden statt zu gelingen.</p>
      <div class="idle-runen-fuse-quick-select">
        <button type="button" class="btn-nein idle-runen-fuse-quick-btn" data-count="3" ${availableCount < 3 ? 'disabled' : ''}>3 auswählen</button>
        <button type="button" class="btn-nein idle-runen-fuse-quick-btn idle-runen-fuse-all-btn" id="idleRuneFuseAllBtn" ${availableCount < 3 ? 'disabled' : ''}>Alle verschmelzen</button>
      </div>
      <div class="idle-runen-fuse-progress">${count} ausgewählt${!isValidCount && count ? ' <span class="idle-runen-fuse-warn">⚠️ muss Vielfaches von 3 sein</span>' : ''}${hasProgress ? ' <span class="idle-runen-fuse-warn">⚠️ enthält Aufwertung</span>' : ''}</div>
      <label class="idle-runen-fuse-autoconfirm">
        <input type="checkbox" id="idleRuneFuseAutoConfirmToggle" ${bkmpRuneFuseAutoConfirmGet() ? 'checked' : ''}>
        Nicht mehr nach Bestätigung fragen (jederzeit hier wieder anschaltbar)
      </label>
      <div class="idle-runen-stat-actions">
        <button type="button" class="btn-ja idle-runen-fuse-confirm-btn" id="idleRuneFuseConfirmBtn" ${isValidCount ? '' : 'disabled'}>✨ Verschmelzen${isValidCount ? ` (${count / 3}×)` : ''}</button>
        <button type="button" class="btn-nein idle-runen-fuse-cancel-btn" id="idleRuneFuseCancelBtn">Abbrechen</button>
      </div>
    </div>
  `;
}

/* Ob der ausklappbare Runen-Lager-Balken (idleRuneDrawer, siehe index.html)
   gerade offen ist - persistiert NICHT ueber Sitzungen hinweg, startet
   bewusst offen (deckt sich mit dem fruehren, immer sichtbaren Lager). */
let bkmpRuneDrawerOpen = true;

/* Zeigt/versteckt den Lager-Balken je nachdem, ob das Idle-Dorf-Fenster
   ueberhaupt offen ist UND der Runen-Tab gerade aktiv ist (Nutzerwunsch,
   15.07.: "Extra Balken daneben... mit einem Pfeil in der Mitte
   ausklappbar" - der Balken haengt fest am rechten Bildschirmrand statt im
   normalen Fensterinhalt, siehe .idle-runen-drawer in style.css). */
function bkmpRuneSyncDrawerVisibility() {
  const drawer = document.getElementById('idleRuneDrawer');
  if (!drawer) return;
  const shouldShow = !!bkmpIdleModalOpen && bkmpIdleActiveTab === 'runen';
  drawer.classList.toggle('visible', shouldShow);
  drawer.classList.toggle('open', shouldShow && bkmpRuneDrawerOpen);
  if (shouldShow) bkmpRuneSyncDrawerPosition();
}

/* Haengt den Lager-Balken direkt an die rechte Kante der Idle-Dorf-Karte an
   (Nutzer-Wunsch, 15.07.: "lieber an unser Fenster mit ran" - vorher klebte
   der Balken fest am Bildschirmrand, was bei breiten Fenstern eine
   sichtbare Luecke zur Karte liess, siehe Screenshot). Die Karte ist per
   Flexbox in der Fenstermitte zentriert, ihre tatsaechliche rechte
   Bildschirm-Position haengt also von der aktuellen Fensterbreite ab -
   deshalb per JS live gemessen statt fix in CSS, und bei jedem
   Fenster-Resize neu synchronisiert (siehe Listener in
   bkmpIdleInitTabs). */
/* FEHLER-FIX (Spieler-Screenshot 15.07., "Volle Optimierung für kleinere
   Auflösungen"): auf schmaleren Fenstern (z.B. 1366px - ein sehr
   gaengiges Laptop-Format) fuellt die Karte fast die ganze Breite aus,
   sodass rechts davon kein Platz mehr fuer den 360px breiten Balken
   bleibt - er wurde bisher trotzdem stur an "Kartenkante" positioniert und
   ragte dadurch weit ueber den rechten Bildschirmrand hinaus (nur ein
   schmaler Streifen war noch sichtbar/bedienbar). Jetzt wird zusaetzlich
   die tatsaechlich verfuegbare Fensterbreite beruecksichtigt: reicht der
   Platz nicht, dockt der Balken stattdessen an die rechte BILDSCHIRM-Kante
   (ueberlappt dann leicht die Karte) statt teilweise unsichtbar zu sein -
   auf breiten Fenstern (genug Platz) bleibt das bisherige "flush an die
   Karte"-Verhalten unveraendert. */
function bkmpRuneSyncDrawerPosition() {
  const drawer = document.getElementById('idleRuneDrawer');
  const card = document.querySelector('.idle-dorf-overlay .idle-dorf-card');
  if (!drawer || !card || !drawer.classList.contains('visible')) return;
  const rect = card.getBoundingClientRect();
  const drawerWidth = drawer.offsetWidth || 360;
  const maxLeft = window.innerWidth - drawerWidth - 8;
  drawer.style.left = Math.max(0, Math.min(Math.round(rect.right), maxLeft)) + 'px';
}

function bkmpRuneToggleDrawer() {
  bkmpRuneDrawerOpen = !bkmpRuneDrawerOpen;
  bkmpRuneSyncDrawerVisibility();
}

/* Runen-Erfolge (Kategorie "Runen"). Vier Tier-Reihen fuer Verschmelzen/
   Aufwerten, je Erfolg UND Misserfolg - die Misserfolgs-Reihen sind
   bewusst genauso ausgebaut wie die Erfolgs-Reihen (nicht nur 1-2
   Alibi-Stufen), da Pech beim Verschmelzen/Aufwerten ein echter,
   wiederkehrender Teil des Runen-Systems ist. */
window.BKMP_RUNE_FUSE_SUCCESS_TIERS = [
  [1, 'Erste Verschmelzung'], [5, 'Runenschmelzer'], [15, 'Fusionsmeister'], [30, 'Runenalchemist'],
  [60, 'Schmelztiegel-Meister'], [100, 'Runenveredler'], [200, 'Großmeister der Fusion'], [350, 'Legende der Verschmelzung'],
  [500, 'Fusionsdämon'], [750, 'Runenschmiede-Titan'], [1000, 'Tausendfache Verschmelzung'], [2500, 'Schmelztiegel-Gottheit'],
  [5000, 'Ewiger Verschmelzer'], [10000, 'Der Runen-Ursprung']
];
window.BKMP_RUNE_FUSE_FAIL_TIERS = [
  [1, 'Erster Rückschlag'], [5, 'Pechvogel'], [15, 'Explosionsgefahr'], [30, 'Unverwüstlicher Optimist'], [50, 'Schmelztiegel des Grauens'],
  [100, 'Fluch des Schmelztiegels'], [250, 'Wandelnde Katastrophe'], [500, 'Meister des Missgeschicks'], [1000, 'Der Verschmelzungs-Fluch'],
  [2500, 'Von den Runen verflucht'], [5000, 'Sisyphos des Schmelztiegels']
];
window.BKMP_RUNE_UPGRADE_SUCCESS_TIERS = [
  [1, 'Erste Aufwertung'], [10, 'Runenschleifer'], [25, 'Veredelungskünstler'], [50, 'Runenoptimierer'],
  [100, 'Aufwertungsmeister'], [200, 'Runenperfektionist'], [400, 'Großmeister der Veredelung'], [750, 'Legende der Veredelung'],
  [1500, 'Veredelungstitan'], [3000, 'Runenschleif-Gottheit'], [5000, 'Ewiger Veredler'], [10000, 'Der Aufwertungs-Ursprung']
];
window.BKMP_RUNE_UPGRADE_FAIL_TIERS = [
  [1, 'Gold verbrannt'], [5, 'Teurer Fehlschlag'], [15, 'Risikofreudig'], [30, 'Nerven aus Stahl'], [50, 'Va-Banque-Spieler'],
  [100, 'Gold-Verbrenner'], [250, 'Bankrotteur'], [500, 'Meister des Ruins'], [1000, 'Der Aufwertungs-Fluch'],
  [2500, 'Von Pech verfolgt'], [5000, 'Sisyphos der Aufwertung']
];
/* Fuenf Erfolge fuer "alle 6 Slots mit derselben Seltenheit ausgeruestet" -
   Reihenfolge exakt wie BKMP_RUNE_RARITIES (gray/green/blue/purple/gold). */
window.BKMP_RUNE_EQUIP_RARITY_TIERS = [
  ['gray', 'Purist'], ['green', 'Grüner Daumen'], ['blue', 'Blaues Blut'], ['purple', 'Violette Vorherrschaft'], ['gold', 'Runengott']
];
/* Fuenf Erfolge fuer "alle 6 Slots mindestens auf Stufe N" - deckt sich
   exakt mit BKMP_RUNE_MAX_LEVEL = 15 (absolutes Maximum fuer alle
   Seltenheiten AUSSER Legendaer, die per Aufstieg noch bis
   BKMP_RUNE_ASCEND_MAX_LEVEL weiterkommt - siehe bkmpRuneAscend). */
window.BKMP_RUNE_EQUIP_LEVEL_TIERS = [
  [3, 'Frisch geschliffen'], [6, 'Feingeschliffen'], [9, 'Meisterlich veredelt'], [12, 'Nahezu perfekt'], [15, 'Runen-Perfektion']
];

// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). (2b-Ergaenzung)

function bkmpIdleRuneStatRange(statKey, rarityId) {
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rarityId);
  if (!rarity) return [0, 0];
  const base = BKMP_RUNE_STAT_BASE[statKey] ?? 2;
  const center = base * rarity.mult;
  const [vLo, vHi] = BKMP_RUNE_STAT_VARIANCE[statKey] || [0.8, 1.2];
  return [Math.round(center * vLo * 100) / 100, Math.round(center * vHi * 100) / 100];
}
function bkmpIdleRuneValueRange(slotId, rarityId) {
  const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === slotId);
  return bkmpIdleRuneStatRange(slot ? slot.stat : null, rarityId);
}
/* NACHBESSERUNG (14.07., "Aber Stufe 75 ist nichts?"): die Gating-Stufe kam
   bisher aus highest_dragon_index - das wird bei JEDEM Prestige-Aufstieg
   auf 0 zurueckgesetzt (siehe bkmpIdlePerformPrestige), waehrend
   prestige_stage_offset die vor dem Aufstieg erreichte Hoechststufe dauerhaft
   aufsummiert. Ergebnis: jeder Spieler, der schon einmal aufgestiegen ist,
   galt fuer's Runen-Gating faelschlich wieder als "Stufe 0", egal wie weit
   er vorher gekommen war - deshalb wirkte "Stufe 75" wie eine Wand, die nie
   erreichbar war. Fix: bkmpIdleLifetimeStageCount() (== prestige_stage_offset
   + highest_dragon_index) ist die tatsaechliche Lebenszeit-Bestleistung und
   sinkt nie, auch nicht durch Prestige. */
function bkmpIdleRollRuneRarity(source, luckPct) {
  const weights = BKMP_RUNE_DROP_WEIGHTS[source] || BKMP_RUNE_DROP_WEIGHTS.normal;
  const stage = bkmpIdleLifetimeStageCount();
  const luckFactor = 1 + Math.max(0, Number(luckPct) || 0) / 100;
  const adjusted = window.BKMP_RUNE_RARITIES.map((rarity, i) => {
    if (stage < (BKMP_RUNE_RARITY_MIN_STAGE[rarity.id] || 0)) return 0;
    const w = weights[i];
    return i === 0 ? w : w * luckFactor;
  });
  const total = adjusted.reduce((a, b) => a + b, 0);
  if (total <= 0) return window.BKMP_RUNE_RARITIES[0].id;
  let roll = Math.random() * total;
  for (let i = 0; i < adjusted.length; i++) {
    roll -= adjusted[i];
    if (roll <= 0) return window.BKMP_RUNE_RARITIES[i].id;
  }
  return window.BKMP_RUNE_RARITIES[0].id;
}
function bkmpIdleRollRuneValue(slotId, rarityId) {
  const [lo, hi] = bkmpIdleRuneValueRange(slotId, rarityId);
  return Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
}
/* Sub-Stats sind bewusst schwaecher als der Hauptwert derselben Seltenheit
   (35% davon) - genau wie in Summoners War: Sky Arena ein Sub-Stat nie so
   stark ist wie ein frischer Hauptwert gleicher Stufe, sondern ihn nur
   ergaenzt. */
function bkmpIdleRollSubstatValue(statKey, rarityId) {
  const [lo, hi] = bkmpIdleRuneStatRange(statKey, rarityId);
  const raw = (lo + Math.random() * (hi - lo)) * 0.35;
  /* Fest-Werte als ganze Zahl (mind. 1) statt Nachkommastellen - "+1,4
     Angriff (fest)" waere fuer einen Fest-Wert unueblich/unschoen. */
  return statKey.endsWith('_flat') ? Math.max(1, Math.round(raw)) : Math.round(raw * 100) / 100;
}
/* Bug-Fix 19.07. (Discord-Meldung argus_02 an ChronoKora: "wenn man die
   Stats upgraded und dann rerollt, gehen die nur auf die Skala als waeren
   sie nicht upgradet"): bkmpIdleRollSubstatValue() kennt nur die
   Basis-Spanne einer Seltenheit, nicht die zusaetzlichen Meilenstein-Boosts
   (+3/+6/+9/+12, siehe bkmpRuneUpgrade/bkmpRuneInstantUpgrade), die ein
   Sub-Stat im Laufe der Aufwertung obendrauf bekommen haben kann. Ein
   Reroll setzte den Wert dadurch faktisch auf Stufe-0-Niveau zurueck, auch
   wenn die Rune laengst +15 war - ein reiner Wert-VERLUST statt eines
   echten Neuwuerfelns auf gleichem Niveau. Jeder Sub-Stat traegt jetzt sein
   eigenes boostCount (wie oft er bei einem Meilenstein tatsaechlich
   verstaerkt wurde) - Reroll wuerfelt denselben Basiswert PLUS genauso
   viele frische Boost-Wuerfe neu, statt sie wegzuwerfen. */
function bkmpIdleRollBoostedSubstatValue(statKey, rarityId, boostCount) {
  let value = bkmpIdleRollSubstatValue(statKey, rarityId);
  for (let i = 0; i < (boostCount || 0); i++) {
    const bump = bkmpIdleRollSubstatValue(statKey, rarityId) * 0.5;
    value = statKey.endsWith('_flat') ? value + Math.max(1, Math.round(bump)) : Math.round((value + bump) * 100) / 100;
  }
  return value;
}
/* Anzeige-Spanne (min/max) fuer den Reroll-Tooltip (Nutzerwunsch 19.07.:
   "dazu schreiben in was fuer einer Spanne man rerollt") - dieselbe Formel
   wie bkmpIdleRollBoostedSubstatValue, aber als geschlossenes Intervall
   statt eines einzelnen Zufallswurfs. */
function bkmpIdleSubstatValueRange(statKey, rarityId, boostCount) {
  const [lo, hi] = bkmpIdleRuneStatRange(statKey, rarityId);
  let min = lo * 0.35, max = hi * 0.35;
  for (let i = 0; i < (boostCount || 0); i++) {
    min += lo * 0.35 * 0.5;
    max += hi * 0.35 * 0.5;
  }
  const round = statKey.endsWith('_flat') ? v => Math.max(1, Math.round(v)) : v => Math.round(v * 100) / 100;
  return [round(min), round(max)];
}
/* Bug-Fix 19.07. (Spieler-Meldung: "Wie kann das sein? Zwischen 2,8% und
   4,2%? wenn 7.64 bereits drauf sind"): boostCount existiert erst seit
   diesem Update - Runen, die VOR dem Update schon Meilenstein-Boosts
   erhalten hatten, haben kein gespeichertes boostCount (undefined -> bisher
   als 0 behandelt) und zeigten dadurch weiterhin die alte, zu niedrige
   Basis-Spanne, obwohl ihr tatsaechlicher Wert laengst hoeher lag. Fuer
   genau diesen Fall wird boostCount rueckwirkend aus dem VORHANDENEN Wert
   geschaetzt (Erwartungswert-Umkehrung derselben Formel wie beim Wuerfeln:
   value = baseErwartungswert * (1 + 0.5 * boostCount)) - keine exakte
   Rekonstruktion der echten Historie moeglich (die war zufaellig), aber
   eine Spanne, die zum sichtbaren Wert passt statt ihn zu widersprechen.
   Alt-Runen ohne gespeichertes boostCount erhalten es beim naechsten
   Reroll dann tatsaechlich gespeichert (siehe bkmpRuneRerollSubstat). */
function bkmpIdleEstimateSubstatBoostCount(statKey, rarityId, currentValue) {
  const [lo, hi] = bkmpIdleRuneStatRange(statKey, rarityId);
  const baseExpected = (lo + hi) / 2 * 0.35;
  if (!baseExpected || !currentValue || currentValue <= baseExpected) return 0;
  return Math.max(0, Math.round((currentValue / baseExpected - 1) / 0.5));
}
function bkmpRuneSubstatEffectiveBoostCount(entry, rarityId) {
  return typeof entry.boostCount === 'number' ? entry.boostCount : bkmpIdleEstimateSubstatBoostCount(entry.stat, rarityId, entry.value);
}

/* Rollt die Sub-Stats, mit denen eine Rune SOFORT droppt/verschmilzt -
   Anzahl nach Seltenheit (BKMP_RUNE_MAX_SUBSTATS), Typen gewichtet-zufaellig
   aus BKMP_RUNE_SUBSTAT_WEIGHTS, nie doppelt und nie identisch zum
   Hauptstat der Rune. Wird von bkmpIdleMaybeDropRune UND bkmpRuneFuse
   genutzt (Verschmelzen liefert seit der Nachbesserung ebenfalls direkt
   Sub-Stats passend zur neuen Seltenheit, nicht mehr leer). */
function bkmpIdleRollInitialSubstats(primaryStat, rarityId) {
  const count = BKMP_RUNE_MAX_SUBSTATS[rarityId] || 0;
  const substats = [];
  const used = new Set([primaryStat]);
  for (let i = 0; i < count; i++) {
    const pool = Object.keys(BKMP_RUNE_SUBSTAT_WEIGHTS).filter(st => !used.has(st));
    if (!pool.length) break;
    const stat = bkmpRunePickWeightedStat(pool);
    used.add(stat);
    substats.push({ stat, value: bkmpIdleRollSubstatValue(stat, rarityId), boostCount: 0 });
  }
  return substats;
}

/* Neue Drops werden gesammelt statt sofort einzeln gespeichert - bei
   mehreren Kaempfen kurz hintereinander (autoklickender Spieler, schnelle
   Stufen) landet so bei Bedarf mehr als ein Drop in EINEM Insert-Aufruf
   statt einer Schreib-Anfrage pro Kampf (gleiche Ueberlegung wie beim
   Egress-Vorfall vom 12.07. - siehe Projektnotizen). */
async function bkmpIdleFlushRuneSync() {
  bkmpIdleRuneSyncTimer = null;
  const pending = bkmpIdlePendingRuneDrops;
  bkmpIdlePendingRuneDrops = [];
  if (!pending.length || !bkmpIdleState || typeof insertPlayerRunes !== 'function') return;
  try {
    const inserted = await insertPlayerRunes(bkmpIdleState.name_key, pending.map(r => ({
      rune_type: r.rune_type, rarity: r.rarity, rolled_value: r.rolled_value, equipped: r.equipped, upgrade_level: r.upgrade_level, substats: r.substats
    })));
    inserted.forEach((row, i) => {
      const item = pending[i];
      if (!item || !row) return;
      item.id = row.id;
      /* Falls zwischen dem Droppen und dem Eintreffen der echten DB-id
         (bis zu 4s Debounce + Netzwerk-Laufzeit) schon ausgeruestet oder
         aufgewertet wurde, tragen bkmpRuneToggleEquip/bkmpRuneUpgrade das
         mangels id noch nicht nach - hier einmalig mit dem aktuellen Stand
         nachholen, statt es fuer immer zu verlieren. */
      if (item.equipped && typeof updatePlayerRuneEquipped === 'function') updatePlayerRuneEquipped(item.id, true).catch(() => {});
      if ((item.upgrade_level || (item.substats && item.substats.length)) && typeof updatePlayerRuneUpgrade === 'function') {
        updatePlayerRuneUpgrade(item.id, item.upgrade_level, item.substats).catch(() => {});
      }
    });
  } catch (e) {
    console.warn('Idle Dorf: Runen-Drop konnte nicht gespeichert werden.', e);
  }
}

/* Neue Drops werden gesammelt statt sofort einzeln gespeichert - bei
   mehreren Kaempfen kurz hintereinander (autoklickender Spieler, schnelle
   Stufen) landet so bei Bedarf mehr als ein Drop in EINEM Insert-Aufruf
   statt einer Schreib-Anfrage pro Kampf (gleiche Ueberlegung wie beim
   Egress-Vorfall vom 12.07. - siehe Projektnotizen).
   Bug-Fix (Spieler-Reports 19.07., siehe bkmpRuneUpgrade-Kommentar): von
   4000ms auf 1500ms verkuerzt - immer noch genug, um mehrere Drops aus
   demselben Kampf-Burst zusammenzufassen, aber ein deutlich kleineres
   Zeitfenster, in dem eine frisch gedroppte Rune bei einem harten
   Tab-Schliessen noch nie in der DB angekommen sein koennte. */
const BKMP_RUNE_DROP_SYNC_DEBOUNCE_MS = 1500;
function bkmpIdleQueueRuneSync() {
  if (bkmpIdleRuneSyncTimer) return;
  bkmpIdleRuneSyncTimer = window.setTimeout(bkmpIdleFlushRuneSync, BKMP_RUNE_DROP_SYNC_DEBOUNCE_MS);
}

/* Erzwingt ein sofortiges Speichern der noch nicht gesicherten Runen-Drops,
   ohne auf den 4s-Debounce zu warten. Bug-Report 17.07.: Skillpunkte/Gold
   waren bereits gegen Reload-Datenverlust abgesichert (siehe
   bkmpIdleFlushSyncNow/beforeunload), frisch gedroppte Runen aber NICHT -
   dieser Timer wurde beim Schliessen/Reload bisher gar nicht erzwungen,
   die Rune war also bei einem Reload innerhalb der 4s schlicht nie in der
   DB angekommen (nicht nur "zurueckgesetzt" wie bei Gold, sondern komplett
   verloren). */
async function bkmpIdleFlushRuneSyncNow() {
  if (bkmpIdleRuneSyncTimer) { window.clearTimeout(bkmpIdleRuneSyncTimer); bkmpIdleRuneSyncTimer = null; }
  await bkmpIdleFlushRuneSync();
}

/* Wird aus bkmpIdleHandleDragonDefeated() aufgerufen. source: 'normal'
   oder 'boss'. */
function bkmpIdleMaybeDropRune(source) {
  if (!bkmpIdleState) return null;
  const chance = BKMP_RUNE_DROP_CHANCE[source] ?? BKMP_RUNE_DROP_CHANCE.normal;
  if (Math.random() > chance) return null;
  const luck = bkmpIdleEffectiveStats ? Number(bkmpIdleEffectiveStats.runeLuckPct || 0) : 0;
  const slot = window.BKMP_RUNE_SLOTS[Math.floor(Math.random() * window.BKMP_RUNE_SLOTS.length)];
  const rarityId = bkmpIdleRollRuneRarity(source, luck);
  const rolledValue = bkmpIdleRollRuneValue(slot.id, rarityId);
  const rune = { id: null, _cid: bkmpRuneNewLocalId(), rune_type: slot.id, rarity: rarityId, rolled_value: rolledValue, equipped: false, upgrade_level: 0, substats: bkmpIdleRollInitialSubstats(slot.stat, rarityId), created_at: new Date().toISOString() };
  bkmpIdlePlayerRunes.push(rune);
  bkmpIdlePendingRuneDrops.push(rune);
  bkmpIdleQueueRuneSync();
  const rarityDef = window.BKMP_RUNE_RARITIES.find(r => r.id === rarityId);
  /* Nutzerwunsch (19.07., Screenshot "oben die Benachrichtigung weg... unten
     links reicht"): bkmpIdleLog loeste bisher IMMER zusaetzlich seinen
     eigenen automatischen Toast oben mittig aus (bkmpShowJannikToast) - fuer
     Runenfunde doppelt gemoppelt, weil bkmpRewardPresent direkt darunter
     bereits eine eigene Anzeige zeigt. skipToast=true unterdrueckt nur
     diesen redundanten automatischen Toast, die Logzeile selbst bleibt
     (Drop-Chat-Historie unveraendert).
     Zusaetzlich (Nutzerwunsch, gleiche Rueckmeldung): "Nur legendaere
     Runenfunde im Log" - Filter-Checkbox unter dem Log (siehe
     bkmpIdleLogLegendaryOnlyInit, idledorf.js), wirkt NUR auf diese
     Logzeile, nicht auf die Belohnungs-Karte/-Zeremonie oben. */
  const legendaryOnly = typeof bkmpIdleLogLegendaryOnly === 'function' && bkmpIdleLogLegendaryOnly();
  if (!legendaryOnly || rarityId === 'gold') {
    bkmpIdleLog(`🔮 ${rarityDef.name} ${slot.name} gefunden! (+${rolledValue}% ${slot.desc})`, true);
  }
  /* Phase 5.5 (19.07.), 2. NACHBESSERUNG (19.07., Nutzer-Rueckmeldung nach
     dem 1. Fix): "Nur der Legi-Drop sollte auch unten links nicht mehr
     kommen" [gemeint: nur legendaere Funde sollen ueberhaupt noch eine
     Anzeige bekommen] - erst wurde nur der Toast (oben) durch die Karte
     (unten links) ersetzt, jetzt zeigt ausschliesslich Gold(legendaer)
     noch etwas (die grosse Zeremonie) - gray/green/blue/purple bekommen
     ab sofort GAR keine Anzeige mehr, landen nur noch in der Logzeile
     oben (bkmpIdleLog). */
  if (rarityId === 'gold' && typeof bkmpRewardPresent === 'function') {
    const alreadyEquipped = bkmpIdlePlayerRunes.some(r => r.rune_type === slot.id && r.equipped && r._cid !== rune._cid);
    bkmpRewardPresent({
      rarity: rarityId,
      tier: 'ceremony',
      icon: '🔮',
      title: `${rarityDef.name} ${slot.name} gefunden`,
      description: `+${rolledValue}% ${slot.desc}${alreadyEquipped ? ' · Diese Runenart ist bereits ausgerüstet.' : ''}`,
      source: source === 'boss' ? 'Boss-Kampf' : 'Kampf',
      primaryAction: { label: 'Zu den Runen', onClick: () => { const btn = document.getElementById('idleTabBtnRunen'); if (btn) btn.click(); } },
      dedupeKey: `rune-drop-${rune._cid}`
    });
  }
  return rune;
}
/* Fehlschlagchance beim Aufwerten - steigt mit der aktuellen Stufe (0% bei
   +0->+1, waechst dann 2 Prozentpunkte pro Stufe bis max. 30%), unabhaengig
   von der Seltenheit. Bei Fehlschlag ist das Gold trotzdem weg, die Stufe
   bleibt aber gleich - fruehe Aufwertungen bleiben also sicher, erst nahe
   +15 wird es wirklich riskant. */
function bkmpIdleRuneUpgradeFailChance(rune) {
  return Math.min(0.30, Number(rune.upgrade_level || 0) * 0.02);
}
function bkmpIdleRuneUpgradeCost(rune) {
  const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === rune.rarity);
  const mult = rarity ? rarity.mult : 1;
  return Math.round(16 * mult * Math.pow(1.42, Number(rune.upgrade_level || 0)));
}
/* +8% des Grundwerts pro Stufe -> bei +15 rund das 2,2-fache des rohen
   rolled_value (2 * 5 fuer Legendaer waere z.B. 2 -> 4,4). */
function bkmpIdleRuneEffectivePrimaryValue(rune) {
  return Math.round(Number(rune.rolled_value || 0) * (1 + Number(rune.upgrade_level || 0) * 0.08) * 100) / 100;
}

/* Aggregiert alle AUSGERUESTETEN Runen (Hauptwert UND Sub-Stats) zu denselben
   Effekt-Schluesseln, die Skilltree/Upgrades/Titel/Prestige schon nutzen
   (attack_pct usw.) - flieszt dadurch ganz ohne Sonderbehandlung in
   bkmpIdleRecomputeEffectiveStats ein. rune_luck_pct ist der einzige
   Schluessel, der NUR von Runen (oder dem magie_runenglueck-Skillknoten)
   kommt (siehe dort). */
function bkmpIdleRuneEffectTotals() {
  const totals = {};
  bkmpIdlePlayerRunes.forEach(r => {
    if (!r.equipped) return;
    const slot = window.BKMP_RUNE_SLOTS.find(s => s.id === r.rune_type);
    if (!slot) return;
    totals[slot.stat] = (totals[slot.stat] || 0) + bkmpIdleRuneEffectivePrimaryValue(r);
    (r.substats || []).forEach(s => { totals[s.stat] = (totals[s.stat] || 0) + Number(s.value || 0); });
  });
  return totals;
}

/* Fuer die "alle 6 Slots gleiche Seltenheit"-Erfolge - gibt die geteilte
   Seltenheits-id zurueck, nur wenn WIRKLICH alle 6 Slots belegt UND
   gleich sind, sonst null (unvollstaendige Ausruestung zaehlt nicht). */
function bkmpIdleAllEquippedRarity() {
  const equipped = bkmpIdlePlayerRunes.filter(r => r.equipped);
  if (equipped.length !== window.BKMP_RUNE_SLOTS.length) return null;
  const rarity = equipped[0].rarity;
  return equipped.every(r => r.rarity === rarity) ? rarity : null;
}

/* Fuer die "alle 6 Slots mindestens +N"-Erfolge - Minimum ueber alle
   ausgeruesteten Runen, -1 solange nicht alle 6 Slots belegt sind. */
function bkmpIdleAllEquippedMinLevel() {
  const equipped = bkmpIdlePlayerRunes.filter(r => r.equipped);
  if (equipped.length !== window.BKMP_RUNE_SLOTS.length) return -1;
  return equipped.reduce((min, r) => Math.min(min, Number(r.upgrade_level || 0)), Infinity);
}

/* ❓-Hilfe-Overlay statt eines Dauer-Hinweistexts im Panel selbst (auf
   Nutzerwunsch - der Fliesstext oben im Runen-Tab wirkte zu textlastig).
   Gleiches Muster wie bkmpIdleOpenSkillHelp/#idleSkillHelpOverlay, nur mit
   Runen-eigenem Inhalt statt der Skill-Knoten-Liste. */
function bkmpIdleOpenRunenHelp() {
  bkmpIdleRenderRunenHelp();
  const overlay = document.getElementById('idleRunenHelpOverlay');
  if (overlay) { overlay.classList.add('visible'); document.body.classList.add('modal-open'); }
}

function bkmpIdleRenderRunenHelp() {
  const list = document.getElementById('idleRunenHelpList');
  if (!list) return;
  const slotsHtml = window.BKMP_RUNE_SLOTS.map(slot => `
    <div class="skillhelp-row">
      <span class="skillhelp-icon">${slot.icon}</span>
      <div class="skillhelp-body">
        <div class="skillhelp-name">${escapeHtml(slot.name)}</div>
        <div class="skillhelp-desc">Haupt-Stat: ${escapeHtml(slot.desc)}</div>
      </div>
    </div>`).join('');
  const raritiesHtml = window.BKMP_RUNE_RARITIES.map(rarity => `
    <div class="skillhelp-row">
      <span class="skillhelp-icon" style="color:${rarity.color}">●</span>
      <div class="skillhelp-body">
        <div class="skillhelp-name" style="color:${rarity.color}">${escapeHtml(rarity.name)}</div>
      </div>
      <div class="skillhelp-meta">
        <span class="skillhelp-cost">Verkauf: ${rarity.sellGold} Gold</span>
      </div>
    </div>`).join('');
  list.innerHTML = `
    <div class="skillhelp-branch">
      <div class="skillhelp-branch-title">🔮 Wie bekomme ich Runen?</div>
      <p class="skillhelp-note" style="margin:0 0 0.6rem;">Kleine Chance nach jedem besiegten Drachen, bei Bossen (alle 25 Kämpfe) etwas höher. Eine ausgerüstete Glücksrune oder der Skilltree-Knoten „Runenglück" (Zweig Magie) erhöhen zusätzlich die Chance auf bessere Seltenheitsstufen.</p>
    </div>
    <div class="skillhelp-branch">
      <div class="skillhelp-branch-title">Die 6 Rune-Typen</div>
      ${slotsHtml}
    </div>
    <div class="skillhelp-branch">
      <div class="skillhelp-branch-title">Seltenheitsstufen</div>
      ${raritiesHtml}
    </div>
    <div class="skillhelp-note">
      <strong>⬆️ Aufwerten:</strong> Mit Gold von +0 bis +15 - jede Stufe erhöht den Hauptwert der Rune, Kosten steigen mit Stufe und Seltenheit. Ab höheren Stufen kann eine Aufwertung fehlschlagen (steigt bis max. 30% bei +14→+15) - das Gold ist dann trotzdem weg, die Rune bleibt aber unversehrt auf ihrer Stufe stehen.<br>
      <strong>✦ Sub-Stats:</strong> Runen droppen schon MIT Sub-Stats - Anzahl je nach Seltenheit (Gewöhnlich 0, Ungewöhnlich 1, Selten 2, Episch 3, Legendär 4). Bei +3/+6/+9/+12 kommt jeweils ein neuer dazu, bis maximal 4 erreicht sind - danach verstärkt jede dieser Stufen stattdessen einen vorhandenen Sub-Stat weiter. Meist ein zweiter %-Wert, seltener ein fester Bonus (z. B. „+2 Angriff fest" statt „+3% Angriff") oder Angriffstempo - das kann bei jeder Seltenheit passieren, auch bei Legendär.<br>
      <strong>✨ Verschmelzen:</strong> Je 3 unausgerüstete Runen gleichen Slots und gleicher Seltenheit (die du selbst auswählst, auch gleich 6 oder 9 auf einmal in Dreiergruppen) ergeben 1 neue der nächsthöheren Seltenheit mit frisch gewürfelten Sub-Stats - startet aber wieder bei +0. Jede Dreiergruppe hat außerdem eine Fehlschlagchance, die mit der Seltenheit steigt (Gewöhnlich 3%, Ungewöhnlich 6%, Selten 12%, Episch 20%) - bei Fehlschlag sind alle 3 eingesetzten Runen komplett verloren, ohne Ergebnis. Vor jeder Verschmelzung kommt eine Warnung mit der genauen Chance.<br>
      <strong>💰 Verkaufen:</strong> Unausgerüstete Runen lassen sich jederzeit für Gold verkaufen.<br>
      <strong>🌌 Prestige:</strong> Deine komplette Runen-Sammlung (ausgerüstet UND Inventar, inkl. Stufen &amp; Sub-Stats) bleibt bei einem Aufstieg vollständig erhalten.
    </div>
  `;
}

function bkmpIdleRenderRunenPanel() {
  const panel = document.getElementById('idlePanelRunen');
  const drawerContent = document.getElementById('idleRuneDrawerContent');
  if (!panel || !drawerContent) return;
  const equippedBySlot = {};
  bkmpIdlePlayerRunes.forEach(r => { if (r.equipped) equippedBySlot[r.rune_type] = r; });
  const allSixEquipped = Object.keys(equippedBySlot).length >= 6;
  const totalOwned = bkmpIdlePlayerRunes.length;

  if (!window.BKMP_RUNE_SLOTS.some(s => s.id === bkmpRuneActiveSlotTab)) bkmpRuneActiveSlotTab = 'slot1';
  const activeSlot = window.BKMP_RUNE_SLOTS.find(s => s.id === bkmpRuneActiveSlotTab);
  const slotOwned = bkmpIdlePlayerRunes.filter(r => r.rune_type === activeSlot.id).slice().sort((a, b) => {
    const ra = window.BKMP_RUNE_RARITIES.findIndex(x => x.id === a.rarity);
    const rb = window.BKMP_RUNE_RARITIES.findIndex(x => x.id === b.rarity);
    if (rb !== ra) return rb - ra;
    if (!!b.equipped !== !!a.equipped) return b.equipped ? 1 : -1;
    return Number(b.upgrade_level || 0) - Number(a.upgrade_level || 0);
  });

  if (!bkmpRuneCurrentlyViewing || !slotOwned.some(r => r._cid === bkmpRuneCurrentlyViewing)) {
    const preferred = slotOwned.find(r => r.equipped) || slotOwned[0] || null;
    bkmpRuneCurrentlyViewing = preferred ? preferred._cid : null;
  }
  const viewingRune = slotOwned.find(r => r._cid === bkmpRuneCurrentlyViewing) || null;

  panel.innerHTML = `
    <div class="idle-runen-header-row">
      <button type="button" class="btn-nein idle-runen-help-btn" id="idleRunenHelpBtn">❓ Hilfe</button>
    </div>
    <div class="idle-runen-slot-tabs" id="idleRunenSlotTabs">
      ${window.BKMP_RUNE_SLOTS.map(slot => {
        const count = bkmpIdlePlayerRunes.filter(r => r.rune_type === slot.id).length;
        return `<button type="button" class="idle-runen-slot-tab ${slot.id === activeSlot.id ? 'active' : ''}" data-slot="${slot.id}">
          <span class="idle-runen-slot-tab-icon">${slot.icon}</span>
          <span class="idle-runen-slot-tab-name">${escapeHtml(slot.name)}</span>
          ${count ? `<span class="idle-runen-slot-tab-count">${count}</span>` : ''}
        </button>`;
      }).join('')}
    </div>
    <div class="idle-runen-main-row">
      <div class="idle-runen-circle-wrap">
        <div class="idle-runen-circle-inner">
          <img src="assets/runes/${allSixEquipped ? 'circle-full' : 'circle-empty'}.png?v=${BKMP_RUNE_IMG_V}" alt="Runen-Kreis" class="idle-runen-circle-img" decoding="async">
          ${window.BKMP_RUNE_SLOTS.map(slot => {
            const eq = equippedBySlot[slot.id];
            if (!eq) return '';
            const rarity = window.BKMP_RUNE_RARITIES.find(r => r.id === eq.rarity);
            const pos = BKMP_RUNE_SLOT_POSITIONS[slot.id];
            if (!rarity || !pos) return '';
            return `<button type="button" class="idle-runen-equip-slot" style="top:${pos.top}; left:${pos.left}; width:${pos.width}; height:${pos.height}; --rune-color:${rarity.color}" data-cid="${eq._cid}" data-slot="${slot.id}" title="${escapeHtml(slot.name)} ansehen &amp; aufwerten">
              <img src="assets/runes/${slot.id}-${eq.rarity}.png?v=${BKMP_RUNE_IMG_V}" alt="${escapeHtml(slot.name)} (${escapeHtml(rarity.name)})" loading="lazy" decoding="async">
              ${eq.upgrade_level ? `<span class="idle-runen-slot-level">+${eq.upgrade_level}</span>` : ''}
            </button>`;
          }).join('')}
        </div>
      </div>
      <div class="idle-runen-stat-box" id="idleRunenStatBox">${bkmpRuneFuseSelection ? bkmpRuneFuseSelectionHTML(activeSlot) : bkmpRuneStatBoxHTML(activeSlot, viewingRune)}</div>
    </div>
  `;

  /* FEHLER-FIX (Spieler-Meldung 15.07.: "Wenn man runterscrollt.. scrollt
     er automatisch direkt wieder hoch") - dieser Neuaufbau laeuft ueber
     bkmpIdleRefreshLiveTabs() bei JEDEM Drachen-Kill (also im Kampf
     ungefaehr einmal pro Sekunde), damit Menge/Sortierung live aktuell
     bleiben. drawerContent.innerHTML = ... ersetzt dabei den kompletten
     Lager-Bereich inkl. des scrollbaren Containers durch ein frisches,
     neues Element - das hat IMMER scrollTop 0, die eigene Scroll-Position
     im Lager ging dadurch bei jedem Kill sofort wieder verloren. Vorher
     merken, hinterher auf dem neuen Element wiederherstellen. */
  const oldInventoryScroll = drawerContent.querySelector('.idle-runen-inventory-scroll');
  const savedInventoryScrollTop = oldInventoryScroll ? oldInventoryScroll.scrollTop : 0;

  const unequippedSlotCount = slotOwned.filter(r => !r.equipped).length;
  const autoFuseGroupCount = window.BKMP_RUNE_RARITIES.filter(r => r.id !== 'gold').reduce((sum, rarity) => {
    const c = slotOwned.filter(r => r.rarity === rarity.id && !r.equipped).length;
    return sum + Math.floor(c / 3);
  }, 0);
  const autoAscendPairCount = bkmpRuneAutoAscendPairs(slotOwned).length;
  drawerContent.innerHTML = `
    <div class="idle-runen-inventory-header">
      <h4 class="idle-sammlung-subheading">🎒 ${escapeHtml(activeSlot.name)}-Lager <span class="idle-sammlung-count">${slotOwned.length} von ${totalOwned} gesamt</span></h4>
      <div class="idle-runen-inventory-header-actions">
        <button type="button" class="btn-nein idle-runen-autofuse-btn" id="idleRuneAutoFuseBtn" ${autoFuseGroupCount ? '' : 'disabled'}>
          🔥 Auto-Schmelzen${autoFuseGroupCount ? ` (${autoFuseGroupCount})` : ''}
        </button>
        <button type="button" class="btn-nein idle-runen-autoascend-btn" id="idleRuneAutoAscendBtn" ${autoAscendPairCount ? '' : 'disabled'} title="Aufstieg für alle passenden Legendäre-Paare gleicher Stufe (ab +${BKMP_RUNE_MAX_LEVEL}) auf einmal.">
          🌟 Auto-Aufstieg${autoAscendPairCount ? ` (${autoAscendPairCount})` : ''}
        </button>
        <button type="button" class="btn-nein idle-runen-sell-all-btn" id="idleRuneSellAllBtn" ${unequippedSlotCount ? '' : 'disabled'}>
          💰 Alle verkaufen${unequippedSlotCount ? ` (${unequippedSlotCount})` : ''}
        </button>
      </div>
    </div>
    <div class="idle-runen-inventory-scroll">
      <div class="idle-runen-inventory" id="idleRunenInventory">
      ${slotOwned.length ? slotOwned.map(r => {
        const rarity = window.BKMP_RUNE_RARITIES.find(x => x.id === r.rarity);
        const isViewing = r._cid === bkmpRuneCurrentlyViewing;
        const inFuseMode = !!bkmpRuneFuseSelection;
        const isFuseEligible = inFuseMode && r.rarity === bkmpRuneFuseSelection.rarityId && !r.equipped;
        const isFuseSelected = inFuseMode && bkmpRuneFuseSelection.cids.includes(r._cid);
        const fuseClasses = inFuseMode ? `${isFuseSelected ? 'is-fuse-selected' : ''} ${isFuseEligible ? 'is-fuse-eligible' : 'is-fuse-ineligible'}` : '';
        return `
        <button type="button" class="idle-runen-item ${r.equipped ? 'is-equipped' : ''} ${isViewing && !inFuseMode ? 'is-viewing' : ''} ${fuseClasses}" data-cid="${r._cid}" style="--rune-color:${rarity.color}" title="${escapeHtml(rarity.name)}${r.upgrade_level ? ' +' + r.upgrade_level : ''}${r.equipped ? ' (eingesetzt)' : ''}">
          <img src="assets/runes/${activeSlot.id}-${r.rarity}.png?v=${BKMP_RUNE_IMG_V}" alt="${escapeHtml(rarity.name)}" loading="lazy" decoding="async">
          ${r.equipped ? '<span class="idle-runen-equipped-badge">✓</span>' : ''}
          ${isFuseSelected ? '<span class="idle-runen-equipped-badge idle-runen-fuse-check">✓</span>' : ''}
          ${r.upgrade_level ? `<span class="idle-runen-count-badge idle-runen-level-badge">+${r.upgrade_level}</span>` : ''}
        </button>`;
      }).join('') : `<p class="idle-runen-stat-placeholder">Noch keine ${escapeHtml(activeSlot.name)} gefunden - beim Kämpfen und bei Bossen droppen zufällig neue.</p>`}
      </div>
    </div>
  `;
  const newInventoryScroll = drawerContent.querySelector('.idle-runen-inventory-scroll');
  if (newInventoryScroll && savedInventoryScrollTop) newInventoryScroll.scrollTop = savedInventoryScrollTop;

  bkmpRuneSyncDrawerVisibility();

  panel.querySelectorAll('.idle-runen-slot-tab').forEach(btn => btn.addEventListener('click', () => bkmpRuneSelectSlotTab(btn.dataset.slot)));
  drawerContent.querySelectorAll('.idle-runen-item').forEach(btn => btn.addEventListener('click', () => {
    if (bkmpRuneFuseSelection) { bkmpRuneToggleFuseCandidate(btn.dataset.cid); return; }
    bkmpRuneCurrentlyViewing = btn.dataset.cid;
    bkmpIdleRenderRunenPanel();
  }));
  /* NACHBESSERUNG (Nutzerwunsch): ein Klick auf die eingesetzte Rune im
     Kreis hat sie bisher SOFORT entfernt (bkmpRuneToggleEquip direkt) - das
     wirkte wie ein Versehen-Trigger, da man dort eigentlich nur die Rune
     ansehen/aufwerten wollte. Jetzt wechselt der Klick stattdessen nur auf
     den passenden Reiter und waehlt genau diese (eingesetzte) Rune zur
     Ansicht aus - "Entfernen" bleibt weiterhin ein expliziter Button in der
     Detailbox (idleRuneEquipBtn), nicht mehr am Kreis selbst. */
  panel.querySelectorAll('.idle-runen-equip-slot').forEach(btn => btn.addEventListener('click', () => bkmpRuneSelectSlotTab(btn.dataset.slot)));
  const equipBtn = document.getElementById('idleRuneEquipBtn');
  if (equipBtn) equipBtn.addEventListener('click', () => bkmpRuneToggleEquip(equipBtn.dataset.cid));
  const upgradeBtn = document.getElementById('idleRuneUpgradeBtn');
  if (upgradeBtn) upgradeBtn.addEventListener('click', () => bkmpRuneUpgrade(upgradeBtn.dataset.cid));
  const instantBtn = document.getElementById('idleRuneInstantBtn');
  if (instantBtn) instantBtn.addEventListener('click', () => bkmpRuneInstantUpgrade(instantBtn.dataset.cid));
  const ascendBtn = document.getElementById('idleRuneAscendBtn');
  if (ascendBtn) ascendBtn.addEventListener('click', () => bkmpRuneAscend(ascendBtn.dataset.cid));
  panel.querySelectorAll('.idle-runen-reroll-btn').forEach(btn => btn.addEventListener('click', () => bkmpRuneRerollSubstat(btn.dataset.cid, Number(btn.dataset.index))));
  const fuseBtn = document.getElementById('idleRuneFuseBtn');
  if (fuseBtn) fuseBtn.addEventListener('click', () => bkmpRuneStartFuseSelection(fuseBtn.dataset.rarity));
  const sellBtn = document.getElementById('idleRuneSellBtn');
  if (sellBtn) sellBtn.addEventListener('click', () => bkmpRuneSell(sellBtn.dataset.cid));
  const fuseConfirmBtn = document.getElementById('idleRuneFuseConfirmBtn');
  if (fuseConfirmBtn) fuseConfirmBtn.addEventListener('click', bkmpRuneConfirmFuseSelection);
  const fuseCancelBtn = document.getElementById('idleRuneFuseCancelBtn');
  if (fuseCancelBtn) fuseCancelBtn.addEventListener('click', bkmpRuneCancelFuseSelection);
  const fuseAutoConfirmToggle = document.getElementById('idleRuneFuseAutoConfirmToggle');
  if (fuseAutoConfirmToggle) fuseAutoConfirmToggle.addEventListener('change', () => bkmpRuneFuseAutoConfirmSet(fuseAutoConfirmToggle.checked));
  panel.querySelectorAll('.idle-runen-fuse-quick-btn[data-count]').forEach(btn => btn.addEventListener('click', () => bkmpRuneQuickSelectFuse(Number(btn.dataset.count))));
  const fuseAllBtn = document.getElementById('idleRuneFuseAllBtn');
  if (fuseAllBtn) fuseAllBtn.addEventListener('click', bkmpRuneQuickSelectFuseAll);
  const sellAllBtn = document.getElementById('idleRuneSellAllBtn');
  if (sellAllBtn) sellAllBtn.addEventListener('click', bkmpRuneSellAllDuplicates);
  const autoFuseBtn = document.getElementById('idleRuneAutoFuseBtn');
  if (autoFuseBtn) autoFuseBtn.addEventListener('click', bkmpRuneAutoFuseAll);
  const autoAscendBtn = document.getElementById('idleRuneAutoAscendBtn');
  if (autoAscendBtn) autoAscendBtn.addEventListener('click', bkmpRuneAutoAscendAll);
  const runenHelpBtn = document.getElementById('idleRunenHelpBtn');
  if (runenHelpBtn) runenHelpBtn.addEventListener('click', bkmpIdleOpenRunenHelp);
}
