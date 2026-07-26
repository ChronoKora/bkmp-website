/* Bkmp - Progression-Rebalance Phase 15: Balance-Simulation NACH den
   Softcap-Aenderungen (Phase 2+3). Erweitert phase1-time-to-cap.js um die
   Softcap-bewusste Kostenformel (bkmpIdleUpgradeCost mit costMultiplier
   AfterSoftCap1/2) und zeigt, wie stark die Softcaps die in Phase 1
   bewiesene "5 Minuten bis zum neuen Cap"-Situation tatsaechlich entschaerfen.

   Ausfuehren: node scripts/balance-sim/phase15-softcap-validation.js */

function growthMult(rate, exp, level) { return Math.pow(1 + rate * level, exp); }

const ATK_UPGRADE = { baseCost: 35, costRate: 0.25, costExponent: 2.3, maxLevel: 2500 };
const SOFTCAP_CFG = { softCap1: 625, softCap2: 1250, costMultiplierAfterSoftCap1: 1.08, costMultiplierAfterSoftCap2: 1.18 };

function upgradeCostSoftcapAware(def, level) {
  let exp = def.costExponent;
  if (level >= SOFTCAP_CFG.softCap2) exp = def.costExponent * SOFTCAP_CFG.costMultiplierAfterSoftCap2;
  else if (level >= SOFTCAP_CFG.softCap1) exp = def.costExponent * SOFTCAP_CFG.costMultiplierAfterSoftCap1;
  return Math.round(def.baseCost * growthMult(def.costRate, exp, level));
}
function upgradeCostNaive(def, level) {
  return Math.round(def.baseCost * growthMult(def.costRate, def.costExponent, level));
}

// Reale Feuerdrache-Basiswerte + Wachstumsformeln (identisch zu phase1-time-to-cap.js, siehe dort fuer Herkunft).
const DRAGON_BASE = { hp: 60, attack: 7, defense: 1, gold: 6 };
const DRAGON_SCALING = { hpGrowthPerKill: 0.05, hpGrowthExponent: 1.15, atkGrowthPerKill: 0.045, atkGrowthExponent: 1.1 };
const REWARD_SCALING = { goldGrowthPerKill: 0.05, goldGrowthExponent: 1.2 };
const BOSS_SCALING = { minibossHpMult: 1.8, minibossAtkMult: 1.3, minibossRewardMult: 2, bossHpMult: 3.2, bossAtkMult: 1.7, bossRewardMult: 4 };
const TICK_MS = 900;
function dragonAtStage(killIndex) {
  const stage = killIndex + 1;
  const isBoss = stage % 25 === 0;
  const isMiniboss = !isBoss && stage % 10 === 0;
  const hpMult = isBoss ? BOSS_SCALING.bossHpMult : (isMiniboss ? BOSS_SCALING.minibossHpMult : 1);
  const atkMult = isBoss ? BOSS_SCALING.bossAtkMult : (isMiniboss ? BOSS_SCALING.minibossAtkMult : 1);
  const rewardMult = isBoss ? BOSS_SCALING.bossRewardMult : (isMiniboss ? BOSS_SCALING.minibossRewardMult : 1);
  const hp = DRAGON_BASE.hp * growthMult(DRAGON_SCALING.hpGrowthPerKill, DRAGON_SCALING.hpGrowthExponent, killIndex) * hpMult;
  const defense = DRAGON_BASE.defense * growthMult(DRAGON_SCALING.atkGrowthPerKill, DRAGON_SCALING.atkGrowthExponent, killIndex);
  const goldReward = DRAGON_BASE.gold * growthMult(REWARD_SCALING.goldGrowthPerKill, REWARD_SCALING.goldGrowthExponent, killIndex) * rewardMult;
  return { hp, defense, goldReward };
}
function damageAvg(attack, critChancePct, critDamagePct, defense) {
  const c = Math.min(1, Math.max(0, (critChancePct || 0) / 100));
  const normal = Math.max(0, attack), crit = Math.max(0, attack) * Math.max(1, (critDamagePct || 150) / 100);
  return Math.max(1, (normal * (1 - c) + crit * c) - Math.max(0, defense || 0) * 0.5);
}
function goldPerHourAt(attack, critChance, critDamage, goldBonusPct, killIndex) {
  let realSeconds = 0, totalGold = 0;
  for (let k = killIndex; k < killIndex + 50; k++) {
    const d = dragonAtStage(k);
    const ticks = Math.max(1, Math.ceil(d.hp / damageAvg(attack, critChance, critDamage, d.defense)));
    realSeconds += ticks * (TICK_MS / 1000);
    totalGold += d.goldReward * (1 + Math.min(2000, goldBonusPct) / 100);
  }
  return (totalGold / realSeconds) * 3600;
}
function fmt(n) { if (n >= 1e9) return (n / 1e9).toFixed(2) + ' Mrd.'; if (n >= 1e6) return (n / 1e6).toFixed(2) + ' Mio.'; if (n >= 1e3) return (n / 1e3).toFixed(1) + ' Tsd.'; return Math.round(n).toString(); }
function fmtTime(hours) { if (hours < 1 / 60) return Math.round(hours * 3600) + 's'; if (hours < 1) return Math.round(hours * 60) + ' Min.'; if (hours < 24) return hours.toFixed(1) + ' Std.'; return (hours / 24).toFixed(1) + ' Tage'; }

const ARCHETYPES = [
  { name: 'Neuer Spieler', attack: 10, critChance: 5, critDamage: 150, goldBonusPct: 0, stage: 0 },
  { name: 'Mittlerer Spieler (~Stufe 100)', attack: 85, critChance: 12, critDamage: 180, goldBonusPct: 40, stage: 99 },
  { name: 'Level 1000', attack: 1200, critChance: 30, critDamage: 250, goldBonusPct: 150, stage: 900 },
  { name: 'Level 2000 (echte Danw_90-Daten)', attack: 5864.4, critChance: 75, critDamage: 450, goldBonusPct: 400, stage: 3199 },
  { name: 'Sehr fortgeschritten (Endgame)', attack: 20000, critChance: 75, critDamage: 450, goldBonusPct: 400, stage: 8000 }
];

console.log('='.repeat(112));
console.log('PHASE 15 - VALIDIERUNG: Zeit bis zum NEUEN Cap (2.500) MIT Softcap-System vs. OHNE (naiv)');
console.log('='.repeat(112));
ARCHETYPES.forEach(a => {
  const gph = goldPerHourAt(a.attack, a.critChance, a.critDamage, a.goldBonusPct, a.stage);
  const costNaiveAtCap = upgradeCostNaive(ATK_UPGRADE, ATK_UPGRADE.maxLevel - 1);
  const costSoftcapAtCap = upgradeCostSoftcapAware(ATK_UPGRADE, ATK_UPGRADE.maxLevel - 1);
  console.log(`\n--- ${a.name} (Gold/Std.: ${fmt(gph)}) ---`);
  console.log(`  Kosten letzter Rang (2.500) OHNE Softcap (naiv):  ${fmt(costNaiveAtCap)} -> ${fmtTime(costNaiveAtCap / gph)}`);
  console.log(`  Kosten letzter Rang (2.500) MIT Softcap (real):   ${fmt(costSoftcapAtCap)} -> ${fmtTime(costSoftcapAtCap / gph)}`);
  console.log(`  Faktor teurer durch Softcap: ${(costSoftcapAtCap / costNaiveAtCap).toFixed(1)}x`);
});
console.log('\n' + '='.repeat(112));
console.log('ERGEBNIS: Softcaps erhoehen die Kosten am oberen Ende um das ~' + (upgradeCostSoftcapAware(ATK_UPGRADE, 2499) / upgradeCostNaive(ATK_UPGRADE, 2499)).toFixed(0) + 'fache');
console.log('gegenueber einer rein linear/polynomiell fortgesetzten Kurve - genau der in Phase 3 geforderte');
console.log('"kein harter Stopp, aber spuerbar reduzierter Grenznutzen"-Effekt. Ein Level-2000-Spieler (echte Danw_90-');
console.log('Daten) erreicht das NEUE Cap dadurch nicht mehr in 1,8 Stunden (siehe Phase-1-Bericht), sondern deutlich');
console.log('spaeter - siehe Zahlen oben. Fuer neue/mittlere Spieler (noch weit unter softCap1=625) bleibt die Kurve');
console.log('unveraendert identisch zur alten Formel - kein Nachteil fuer den fruehen Fortschritt.');
