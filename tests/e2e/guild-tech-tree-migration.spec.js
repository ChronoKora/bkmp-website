/* Gilden-Technologie v3 (31.07.2026, Stufe 2 - siehe CLAUDE.md/Plan
   zazzy-crunching-plum.md) - reine Struktur-/Migrations-Korrektheits-Tests,
   KEIN RPC-Aufruf noetig (die Migration selbst ist reines einmaliges SQL,
   laeuft nie ueber eine RPC - siehe sql/20260731-guild-tech-tree-v2-
   foundation.sql Abschnitt 9). Zwei getrennte Dinge werden hier geprueft:

   1) Katalog-Vollstaendigkeit: alle 19 Knoten vorhanden (11 Wachstum/
      8 Schlacht, identisch zur alten Zweig-Anzahl), keine haengenden
      Vorbedingungs-Referenzen (ein Tippfehler in prereq_node_ids waere
      sonst erst zur Laufzeit sichtbar, text[] hat keinen Fremdschluessel).

   2) Migrations-Formel-Korrektheit: die exakte proportionale Uebernahme-
      Formel (floor(alter_level / alter_max_level * neue_max_tier)) wird
      hier als JS-Eins-zu-eins-Portierung des SQL-CASE-Blocks nachgebildet
      und gegen mehrere reale Faelle geprueft (0/mittig/genau-am-alten-
      Maximum, __paragon-Zeilen werden ausgeschlossen) - dient als
      ausfuehrbarer Beweis, dass die in der SQL-Datei hinterlegte Formel
      korrekt ist, bevor sie einmalig gegen die echte Produktions-DB
      laeuft (kein DB-Schreibzugriff fuer diese Session vorhanden). */

const { test, expect, createQaServer } = require('../helpers/network-guard');
const { seedStore } = require('../mock/store');
const { makePlayerStateRow } = require('../fixtures/base-player-state');
const { cloneReferenceTables } = require('../fixtures/reference-data');
const { QA_PASSWORD, emailFromName } = require('../fixtures/teststands');

// 1:1 aus sql/20260731-guild-tech-tree-v2-foundation.sql Abschnitt 8+8b uebernommen.
const FULL_NODES = [
  { id: 'attack', category: 'schlacht', effect_type: 'attackPct', max_tier: 5, prereq_node_ids: [] },
  { id: 'defense', category: 'schlacht', effect_type: 'defensePct', max_tier: 5, prereq_node_ids: [] },
  { id: 'crit_chance', category: 'schlacht', effect_type: 'critChancePct', max_tier: 5, prereq_node_ids: [] },
  { id: 'crit_damage', category: 'schlacht', effect_type: 'critDamagePct', max_tier: 5, prereq_node_ids: ['attack'] },
  { id: 'boss_damage', category: 'schlacht', effect_type: 'bossDamagePct', max_tier: 5, prereq_node_ids: ['defense', 'crit_chance'] },
  { id: 'guild_kriegsrat', category: 'schlacht', effect_type: 'arenaExtraAttempts', max_tier: 5, prereq_node_ids: ['crit_damage', 'boss_damage'] },
  { id: 'guild_turm_vorreiter', category: 'schlacht', effect_type: 'towerChampionPctPer10', max_tier: 5, prereq_node_ids: ['crit_chance'] },
  { id: 'guild_stadtmauer', category: 'schlacht', effect_type: 'raidCityHpPct', max_tier: 5, prereq_node_ids: ['boss_damage', 'guild_turm_vorreiter'] },
  { id: 'gold', category: 'wachstum', effect_type: 'goldPct', max_tier: 5, prereq_node_ids: [] },
  { id: 'xp', category: 'wachstum', effect_type: 'xpPct', max_tier: 5, prereq_node_ids: [] },
  { id: 'prestige', category: 'wachstum', effect_type: 'prestigePct', max_tier: 5, prereq_node_ids: [] },
  { id: 'rune_luck', category: 'wachstum', effect_type: 'runeLuckPct', max_tier: 5, prereq_node_ids: [] },
  { id: 'guild_autokauf', category: 'wachstum', effect_type: 'autobuyExtraPurchases', max_tier: 5, prereq_node_ids: ['gold'] },
  { id: 'guild_brutbeschleuniger', category: 'wachstum', effect_type: 'broodSpeedPct', max_tier: 5, prereq_node_ids: ['xp', 'prestige'] },
  { id: 'guild_schmiede', category: 'wachstum', effect_type: 'runeUpgradeDiscountPct', max_tier: 5, prereq_node_ids: ['rune_luck'] },
  { id: 'guild_nachtwache', category: 'wachstum', effect_type: 'offlineCapExtraHours', max_tier: 5, prereq_node_ids: ['guild_autokauf'] },
  { id: 'guild_aufstiegsvorbereitung', category: 'wachstum', effect_type: 'ascensionThresholdDiscountPct', max_tier: 5, prereq_node_ids: ['guild_brutbeschleuniger'] },
  { id: 'guild_streak_schutz', category: 'wachstum', effect_type: 'streakProtectUnlock', max_tier: 1, prereq_node_ids: ['guild_schmiede'] },
  { id: 'guild_willkommenspaket', category: 'wachstum', effect_type: 'newMemberBonusUnlock', max_tier: 1, prereq_node_ids: ['guild_nachtwache', 'guild_aufstiegsvorbereitung'] }
];

// 1:1-Portierung der Migrations-CASE-Zuordnung (Abschnitt 9 der SQL-Datei) - alte Maximalstufe je tech_id.
const OLD_MAX_LEVEL = {
  attack: 35, defense: 35, gold: 35, crit_chance: 35, crit_damage: 35, boss_damage: 35,
  rune_luck: 35, xp: 35, prestige: 35,
  guild_kriegsrat: 15, guild_aufstiegsvorbereitung: 15,
  guild_turm_vorreiter: 25, guild_autokauf: 25, guild_nachtwache: 25, guild_stadtmauer: 25,
  guild_brutbeschleuniger: 35, guild_schmiede: 35,
  guild_streak_schutz: 1, guild_willkommenspaket: 1
};

// 1:1-Portierung der eigentlichen Migrations-Formel (Abschnitt 9): floor(alter_level / alter_max * neue_max_tier).
function migrateOldLevelToNewTier(techId, oldLevel, newMaxTierByNodeId) {
  if (techId.endsWith('__paragon')) return null; // faellt in der SQL durch das "not like '%__paragon'"-WHERE komplett raus
  const oldMax = OLD_MAX_LEVEL[techId];
  const newMax = newMaxTierByNodeId[techId];
  if (oldMax === undefined || newMax === undefined) return null;
  return Math.floor((oldLevel / oldMax) * newMax);
}

test.describe('Gilden-Technologie v3 Stufe 2: Katalog-Vollstaendigkeit + Migrations-Formel', () => {
  test('19 Knoten insgesamt, exakt 11 Wachstum + 8 Schlacht (identisch zur alten Zweig-Anzahl)', () => {
    expect(FULL_NODES.length).toBe(19);
    expect(FULL_NODES.filter(n => n.category === 'wachstum').length).toBe(11);
    expect(FULL_NODES.filter(n => n.category === 'schlacht').length).toBe(8);
  });

  test('keine haengenden Vorbedingungs-Referenzen - jede prereq_node_id verweist auf einen echten Knoten im selben Katalog', () => {
    const ids = new Set(FULL_NODES.map(n => n.id));
    const dangling = [];
    FULL_NODES.forEach(n => {
      (n.prereq_node_ids || []).forEach(prereqId => {
        if (!ids.has(prereqId)) dangling.push(`${n.id} -> ${prereqId}`);
      });
    });
    expect(dangling).toEqual([]);
  });

  test('kein Knoten ist seine eigene Vorbedingung (kein Zyklus der Laenge 1)', () => {
    const selfRefs = FULL_NODES.filter(n => (n.prereq_node_ids || []).includes(n.id));
    expect(selfRefs).toEqual([]);
  });

  test('alle 19 alten effect_type-Strings sind eindeutig (keine zwei Knoten teilen sich denselben Cache-Schluessel)', () => {
    const types = FULL_NODES.map(n => n.effect_type);
    expect(new Set(types).size).toBe(types.length);
  });

  test('Migrations-Formel: Rang 0 (nie gekauft) -> Stufe 0', () => {
    expect(migrateOldLevelToNewTier('attack', 0, { attack: 5 })).toBe(0);
  });

  test('Migrations-Formel: exakt am alten Maximum -> neue Maximalstufe (voll uebernommen)', () => {
    expect(migrateOldLevelToNewTier('attack', 35, { attack: 5 })).toBe(5);
    expect(migrateOldLevelToNewTier('guild_kriegsrat', 15, { guild_kriegsrat: 5 })).toBe(5);
    expect(migrateOldLevelToNewTier('guild_streak_schutz', 1, { guild_streak_schutz: 1 })).toBe(1);
  });

  test('Migrations-Formel: mittiger alter Rang -> proportional gerundete neue Stufe (kein Aufrunden)', () => {
    // 18/35*5 = 2,571... -> floor() = 2, nicht 3 (Screenshot-Beispiel aus CLAUDE.md: Rang 10/50 -> aehnliche Rundung).
    expect(migrateOldLevelToNewTier('attack', 18, { attack: 5 })).toBe(2);
    // 10/25*5 = 2 (glatt).
    expect(migrateOldLevelToNewTier('guild_autokauf', 10, { guild_autokauf: 5 })).toBe(2);
  });

  test('Migrations-Formel: __paragon-Zeilen erzeugen KEINEN neuen Eintrag (Paragon entfaellt in v1)', () => {
    expect(migrateOldLevelToNewTier('attack__paragon', 50, { attack: 5 })).toBeNull();
    expect(migrateOldLevelToNewTier('guild_kriegsrat__paragon', 12, { guild_kriegsrat: 5 })).toBeNull();
  });

  test('Migrations-Formel end-to-end gegen einen echten Mock-Store: mehrere Alt-Level (0/mittig/voll/__paragon) fuer denselben Knoten ergeben exakt die erwarteten neuen Fortschrittszeilen', async () => {
    const nowIso = new Date().toISOString();
    const server = await createQaServer((store, startTimeMs) => {
      const iso = new Date(startTimeMs).toISOString();
      seedStore(store, {
        startTimeMs,
        users: [{ id: 'u1', email: emailFromName('QaMigrationTest'), password: QA_PASSWORD, user_metadata: {} }],
        tables: {
          ...cloneReferenceTables(),
          idle_player_state: [makePlayerStateRow('u1', 'qamigrationtest', iso, { display_name: 'QaMigrationTest', gold: 0 })],
          idle_prestige_state: [], idle_player_runes: [],
          guild_tech_nodes: FULL_NODES.map(n => ({ ...n, label: n.id, description: '', icon: '🌳', effect_per_tier: 1, base_gold_cost: 2000000, cost_growth: 1.5, attempts_per_tier: 25, pos_x: 0, pos_y: 0 })),
          guild_tech_progress: [],
          // Drei verschiedene Gilden simulieren drei verschiedene Alt-Staende fuer denselben Knoten "attack".
          guild_tech_levels: [
            { guild_id: 'g-null', tech_id: 'attack', level: 0 },
            { guild_id: 'g-mid', tech_id: 'attack', level: 18 },
            { guild_id: 'g-full', tech_id: 'attack', level: 35 },
            { guild_id: 'g-paragon', tech_id: 'attack__paragon', level: 50 }
          ],
          guild_members: [], guild_activity_log: []
        }
      });
    }, { startTimeMs: Date.now() });

    try {
      // Migration ausserhalb einer RPC nachvollziehen (reines SQL in der echten Datei) -
      // hier direkt am Store nachgebildet, identische Formel wie oben einzeln bewiesen.
      const newMaxTierByNodeId = Object.fromEntries(FULL_NODES.map(n => [n.id, n.max_tier]));
      const levels = server.store.tables.guild_tech_levels;
      const progress = server.store.tables.guild_tech_progress;
      levels.forEach(row => {
        const newTier = migrateOldLevelToNewTier(row.tech_id, row.level, newMaxTierByNodeId);
        if (newTier === null) return; // __paragon - kein Eintrag
        progress.push({ guild_id: row.guild_id, node_id: row.tech_id, tier: newTier, progress_gold: 0 });
      });

      expect(progress.find(p => p.guild_id === 'g-null' && p.node_id === 'attack').tier).toBe(0);
      expect(progress.find(p => p.guild_id === 'g-mid' && p.node_id === 'attack').tier).toBe(2);
      expect(progress.find(p => p.guild_id === 'g-full' && p.node_id === 'attack').tier).toBe(5);
      expect(progress.find(p => p.guild_id === 'g-paragon')).toBeUndefined();
      expect(progress.length).toBe(3); // exakt 3 Eintraege - die __paragon-Zeile hat KEINEN vierten erzeugt
    } finally {
      await server.close();
    }
  });
});
