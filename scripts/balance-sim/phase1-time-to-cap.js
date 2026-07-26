/* Bkmp - Progression-Rebalance Phase 1: Zeit-bis-Cap-Simulation.
   Reines Analyse-Werkzeug (kein Teil der ausgelieferten Seite) - nutzt
   AUSSCHLIESSLICH bereits im echten Code verifizierte Formeln:
   - bkmpIdleGrowthMult (js/core/bkmp-combat-math.js): (1+rate*killIndex)^exp
   - bkmpIdleDamageRoll (js/core/bkmp-combat-math.js): max(1, round(attack*critMult - defense*0.5))
   - bkmpIdleUpgradeCost/BKMP_IDLE_UPGRADES (idledorf.js): cost=round(base*(1+rate*level)^exp)
   Basis-Drachenwerte (base_hp/base_attack/gold_reward_base/xp_reward_base)
   stammen aus einer echten Live-Abfrage gegen idle_dragons (tier_order=0,
   "Feuerdrache") - siehe PROGRESSION_REBALANCE_PHASE1.md.

   Ausfuehren: node scripts/balance-sim/phase1-time-to-cap.js */

// ---- Reale, aus dem Code kopierte Formeln (keine Neuerfindung) ----
function growthMult(rate, exp, killIndex) { return Math.pow(1 + rate * killIndex, exp); }
function upgradeCost(baseCost, costRate, costExponent, level) { return Math.round(baseCost * Math.pow(1 + costRate * level, costExponent)); }
function damageAvg(attack, critChancePct, critDamagePct, defense) {
  // Erwartungswert statt Einzelwurf (Simulation, kein echter Zufall noetig):
  const critChance = Math.min(1, Math.max(0, (critChancePct || 0) / 100));
  const normalDmg = Math.max(0, attack);
  const critDmg = Math.max(0, attack) * Math.max(1, (critDamagePct || 150) / 100);
  const raw = normalDmg * (1 - critChance) + critDmg * critChance;
  return Math.max(1, raw - Math.max(0, defense || 0) * 0.5);
}

// Live aus idle_dragons (tier_order=0, "Feuerdrache") gelesen, 26.07.2026:
const DRAGON_BASE = { hp: 60, attack: 7, defense: 1, gold: 6, xp: 6 };
const DRAGON_SCALING = { hpGrowthPerKill: 0.05, hpGrowthExponent: 1.15, atkGrowthPerKill: 0.045, atkGrowthExponent: 1.1 };
const REWARD_SCALING = { goldGrowthPerKill: 0.05, goldGrowthExponent: 1.2, xpGrowthPerKill: 0.05, xpGrowthExponent: 1.2 };
const BOSS_SCALING = { minibossHpMult: 1.8, minibossAtkMult: 1.3, minibossRewardMult: 2, bossHpMult: 3.2, bossAtkMult: 1.7, bossRewardMult: 4 };
const TICK_MS = 900; // Basiswert ohne attack_speed_pct-Bonus

function dragonAtStage(killIndex) {
  const stage = killIndex + 1; // 1-indiziert wie im echten Code
  const isBoss = stage % 25 === 0;
  const isMiniboss = !isBoss && stage % 10 === 0;
  const hpMult = isBoss ? BOSS_SCALING.bossHpMult : (isMiniboss ? BOSS_SCALING.minibossHpMult : 1);
  const atkMult = isBoss ? BOSS_SCALING.bossAtkMult : (isMiniboss ? BOSS_SCALING.minibossAtkMult : 1);
  const rewardMult = isBoss ? BOSS_SCALING.bossRewardMult : (isMiniboss ? BOSS_SCALING.minibossRewardMult : 1);
  const hp = DRAGON_BASE.hp * growthMult(DRAGON_SCALING.hpGrowthPerKill, DRAGON_SCALING.hpGrowthExponent, killIndex) * hpMult;
  const attack = DRAGON_BASE.attack * growthMult(DRAGON_SCALING.atkGrowthPerKill, DRAGON_SCALING.atkGrowthExponent, killIndex) * atkMult;
  // Grobe Annaeherung: Drachen-Verteidigung skaliert wie Drachen-Angriff (im
  // echten Code nicht separat konfiguriert einsehbar) - explizit als
  // Vereinfachung markiert, betrifft nur den Schadensabzug (0.5x), also
  // ohnehin einen kleinen Anteil des Gesamtschadens.
  const defense = DRAGON_BASE.defense * growthMult(DRAGON_SCALING.atkGrowthPerKill, DRAGON_SCALING.atkGrowthExponent, killIndex);
  const goldReward = DRAGON_BASE.gold * growthMult(REWARD_SCALING.goldGrowthPerKill, REWARD_SCALING.goldGrowthExponent, killIndex) * rewardMult;
  return { hp, attack, defense, goldReward, isBoss, isMiniboss };
}

// Simuliert reine Auto-Tick-Kaempfe (kein manuelles Klicken - konservative,
// "echte Idle"-Baseline) von startStage bis startStage+numKills, gibt
// {realSeconds, totalGold} zurueck.
function simulateKillRange(playerAttack, playerCritChance, playerCritDamage, playerGoldBonusPct, startKillIndex, numKills) {
  let realSeconds = 0;
  let totalGold = 0;
  for (let k = startKillIndex; k < startKillIndex + numKills; k++) {
    const d = dragonAtStage(k);
    const dmgPerTick = damageAvg(playerAttack, playerCritChance, playerCritDamage, d.defense);
    const ticksToKill = Math.max(1, Math.ceil(d.hp / dmgPerTick));
    realSeconds += ticksToKill * (TICK_MS / 1000);
    totalGold += d.goldReward * (1 + Math.min(400, playerGoldBonusPct) / 100);
  }
  return { realSeconds, totalGold };
}

function goldPerHourAt(playerAttack, playerCritChance, playerCritDamage, playerGoldBonusPct, killIndex) {
  const { realSeconds, totalGold } = simulateKillRange(playerAttack, playerCritChance, playerCritDamage, playerGoldBonusPct, killIndex, 50);
  return (totalGold / realSeconds) * 3600;
}

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' Mrd.';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' Mio.';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' Tsd.';
  return Math.round(n).toString();
}
function fmtTime(hours) {
  if (hours < 1 / 60) return Math.round(hours * 3600) + 's';
  if (hours < 1) return Math.round(hours * 60) + ' Min.';
  if (hours < 24) return hours.toFixed(1) + ' Std.';
  return (hours / 24).toFixed(1) + ' Tage';
}

// ---- Die 5 im Auftrag genannten Spielertypen ----
// attack/critChance/critDamage/goldBonusPct sind PLAUSIBLE, aus den echten
// Effektiv-Werte-Formeln (bkmpIdleRecomputeEffectiveStats) plausible
// Naeherungen fuer den jeweiligen Fortschritt - beim Level-2000-Spieler
// direkt aus den ECHTEN Danw_90-Produktionsdaten uebernommen (nicht
// erfunden), bei den anderen 4 aus der Bandbreite abgeleitet, die dieselben
// Formeln bei entsprechend weniger investierten Skill-/Prestige-/Upgrade-
// Punkten plausibel ergeben wuerden.
const ARCHETYPES = [
  { name: 'Neuer Spieler (Stufe 1, Basiswerte)', attack: 10, critChance: 5, critDamage: 150, goldBonusPct: 0, stage: 0 },
  { name: 'Mittlerer Spieler (~Stufe 100, etwas Skilltree)', attack: 85, critChance: 12, critDamage: 180, goldBonusPct: 40, stage: 99 },
  { name: 'Level 1000 (viel Skilltree+Upgrades, 1x prestiged)', attack: 1200, critChance: 30, critDamage: 250, goldBonusPct: 150, stage: 900 },
  { name: 'Level 2000 (ECHTE Danw_90-Produktionsdaten)', attack: 5864.4, critChance: 75, critDamage: 450, goldBonusPct: 400, stage: 3199 },
  { name: 'Sehr fortgeschritten (Endgame, alles gedeckelt)', attack: 20000, critChance: 75, critDamage: 450, goldBonusPct: 400, stage: 8000 }
];

const ATK_UPGRADE = { baseCost: 35, costRate: 0.25, costExponent: 2.3 };
const CAP_SCENARIOS = [
  { label: 'aktuelles Cap 500', level: 500 },
  { label: 'Auftrags-Vorschlag Cap 2.500', level: 2500 }
];

console.log('='.repeat(100));
console.log('PHASE 1 - ZEIT-BIS-CAP-SIMULATION (reale Formeln, reale Basis-Drachenwerte, 26.07.2026)');
console.log('='.repeat(100));

ARCHETYPES.forEach(a => {
  const gph = goldPerHourAt(a.attack, a.critChance, a.critDamage, a.goldBonusPct, a.stage);
  console.log(`\n--- ${a.name} ---`);
  console.log(`  Angriff=${a.attack}, Kritchance=${a.critChance}%, Kritschaden=${a.critDamage}%, Goldbonus=${a.goldBonusPct}%, Stufe=${a.stage + 1}`);
  console.log(`  Gold/Std. (simuliert, 50 Kaempfe ab dieser Stufe): ${fmt(gph)}`);
  CAP_SCENARIOS.forEach(c => {
    const cost = upgradeCost(ATK_UPGRADE.baseCost, ATK_UPGRADE.costRate, ATK_UPGRADE.costExponent, c.level);
    const hoursToAfford = cost / gph;
    console.log(`  Zeit bis "Waffenschmiede" bei ${c.label} (Kosten ${fmt(cost)} Gold): ${fmtTime(hoursToAfford)}`);
  });
});

console.log('\n' + '='.repeat(100));
console.log('HINWEIS: reine Auto-Tick-Simulation (kein manuelles Klicken, keine Boss-Verluste/Rueckzuege,');
console.log('Dragon-Verteidigung als Naeherung ueber dieselbe Wachstumsformel wie Drachen-Angriff),');
console.log('Gold-Ausgabe auf EIN Upgrade konzentriert (theoretisches Minimum, kein realer Spieler kauft nur das eine).');
console.log('Ziel: Groessenordnungs-Vergleich zwischen Spielertypen, keine exakte Spielstand-Vorhersage.');
