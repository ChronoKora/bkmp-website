/* ============================================================
   Bkmp - Idle Drachen Dorf: Offline-Fortschritt serverseitig
   berechnen und atomar gutschreiben.

   idle_player_state hat (wie player_stats) offene RLS fuer den
   laufenden Kampf - diese Funktion ist deshalb kein hartes
   Sicherheitsnetz gegen manipulierte Werte, sondern verhindert
   nur, dass "wie lange war ich weg" vom Client selbst behauptet
   werden kann. Genau wie in api/active-daily-event.js wird die
   Zeitspanne serverseitig aus last_seen_at berechnet, nie aus
   einem vom Client gesendeten Wert.

   Atomarer Claim per PATCH ... WHERE last_seen_at = eq.<gelesener
   Wert>: klappt nur fuer die Anfrage, die den zuletzt gelesenen
   Stand noch unveraendert vorfindet (gleiches Prinzip wie
   winner_name_key is.null in api/redeem-daily-event.js). Bei
   gleichzeitigem Oeffnen in zwei Tabs bekommt nur eine Anfrage
   die Gutschrift, die andere erhaelt den bereits aktualisierten
   Stand zurueck statt doppelt gutzuschreiben.

   Hinweis fuer zukuenftige Aenderungen: die Kill-Rate-Schaetzung
   unten ist eine vereinfachte, eigenstaendige Kopie der Logik aus
   idledorf.js (bkmpIdleDragonStatsAt/bkmpIdleDamageRoll). Aendert
   sich dort die Kampf-Formel grundlegend, sollte sie hier
   nachgezogen werden, damit Offline- und Live-Fortschritt nicht
   zu weit auseinanderlaufen.

   Braucht SUPABASE_SERVICE_ROLE_KEY in Vercel.
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function sbFetch(serviceKey, path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

/* Eigenstaendige, vereinfachte Kopie von bkmpIdleSelectDragonKindId +
   bkmpIdleDragonStatsAt aus idledorf.js - siehe Hinweis oben im Datei-Kopf.
   Rare-Chance wird hier bewusst deterministisch auf "nie" gesetzt statt
   zufaellig gewuerfelt: Offline-Fortschritt ist ein Erwartungswert-Modell
   (kein echter Tick-fuer-Tick-Kampf), da waere ein Zufalls-Rare-Spawn nur
   Rauschen ohne echten Mehrwert fuer die Schaetzung. */
function selectDragonKindId(killIndex, dragons) {
  const stage = killIndex + 1;
  const active = (dragons || []).filter(d => d.active !== false);
  const byRule = rule => active.filter(d => d.spawn_rule === rule);
  if (stage % 25 === 0) {
    const pool = byRule('boss_25');
    if (pool.length) return pool[stage % pool.length].id;
  }
  if (stage % 10 === 0) {
    const pool = byRule('miniboss_10');
    if (pool.length) return pool[stage % pool.length].id;
  }
  const standard = byRule('standard');
  const pool = standard.length ? standard : active;
  return pool.length ? pool[stage % pool.length].id : ((active[0] || {}).id || null);
}

/* Muss deckungsgleich mit bkmpIdleGrowthMult() in idledorf.js bleiben:
   (1+rate*kill)^exponent statt reiner Exponential-Compoundierung, die bei
   jeder Rate > 0 irgendwann astronomisch wird (siehe Kommentar dort). */
function growthMult(ratePerKill, exponent, killIndex) {
  return Math.pow(1 + (ratePerKill || 0) * killIndex, exponent || 1);
}

function dragonStatsAt(killIndex, dragons, cfg) {
  const kindId = selectDragonKindId(killIndex, dragons);
  const archetype = (dragons || []).find(d => d.id === kindId);
  if (!archetype) return null;
  const hpGrowth = growthMult(cfg.hpGrowthPerKill, cfg.hpGrowthExponent, killIndex);
  const atkGrowth = growthMult(cfg.atkGrowthPerKill, cfg.atkGrowthExponent, killIndex);
  let bossTier = null;
  let hpMult = 1;
  let atkMult = 1;
  if (archetype.spawn_rule === 'boss_25') { bossTier = 'boss'; hpMult = cfg.bossHpMult || 3.2; atkMult = cfg.bossAtkMult || 1.7; }
  else if (archetype.spawn_rule === 'miniboss_10') { bossTier = 'miniboss'; hpMult = cfg.minibossHpMult || 1.8; atkMult = cfg.minibossAtkMult || 1.3; }
  return {
    archetype,
    isBoss: Boolean(bossTier),
    bossTier,
    maxHp: Math.max(1, Math.round((archetype.base_hp || 50) * hpGrowth * hpMult)),
    attack: Math.max(1, (archetype.base_attack || 5) * atkGrowth * atkMult)
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return send(res, 500, { error: 'server_not_configured' });

  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body || '{}');
  } catch (e) {
    return send(res, 400, { error: 'invalid_json' });
  }
  body = body || {};

  const playerName = String(body.playerName || '').trim();
  if (!playerName) return send(res, 400, { error: 'missing_name' });
  const nameKey = playerName.toLowerCase();

  try {
    const stateRes = await sbFetch(serviceKey, `idle_player_state?name_key=eq.${encodeURIComponent(nameKey)}&limit=1`);
    if (!stateRes.ok) return send(res, 502, { error: 'lookup_failed' });
    const stateRows = await stateRes.json();
    const state = Array.isArray(stateRows) ? stateRows[0] : null;
    if (!state) return send(res, 200, { ok: true, elapsedSeconds: 0, rewards: null, newTotals: null });

    const configRes = await sbFetch(serviceKey, `idle_game_config?key=in.(offline_progress,dragon_scaling,reward_scaling,boss_scaling)&select=key,value`);
    const configRows = configRes.ok ? await configRes.json() : [];
    const config = {};
    (Array.isArray(configRows) ? configRows : []).forEach(row => { config[row.key] = row.value; });
    const offlineCfg = config.offline_progress || { maxHours: 12, efficiencyPct: 50 };
    const bossCfg = config.boss_scaling || { minibossHpMult: 1.8, minibossAtkMult: 1.3, minibossRewardMult: 2, bossHpMult: 3.2, bossAtkMult: 1.7, bossRewardMult: 4 };
    const dragonCfg = { ...(config.dragon_scaling || { hpGrowthPerKill: 0.05, hpGrowthExponent: 1.15, atkGrowthPerKill: 0.045, atkGrowthExponent: 1.1 }), ...bossCfg };
    const rewardCfg = { ...(config.reward_scaling || { goldGrowthPerKill: 0.05, goldGrowthExponent: 1.2, xpGrowthPerKill: 0.05, xpGrowthExponent: 1.2 }), ...bossCfg };

    const lastSeenIso = state.last_seen_at;
    const lastSeenMs = Date.parse(lastSeenIso);
    const nowMs = Date.now();
    const maxSeconds = (offlineCfg.maxHours || 12) * 3600;
    const elapsedSeconds = Math.max(0, Math.min(maxSeconds, Math.round((nowMs - lastSeenMs) / 1000)));

    if (elapsedSeconds < 60) {
      return send(res, 200, { ok: true, elapsedSeconds, rewards: null, newTotals: null });
    }

    const dragonsRes = await sbFetch(serviceKey, `idle_dragons?active=eq.true&select=*&order=tier_order.asc`);
    const dragons = dragonsRes.ok ? await dragonsRes.json() : [];

    // Zwei-seitige Erwartungswert-Simulation: der Drache schlaegt bei jedem
    // Treffer bis auf den letzten (der ihn toetet) zurueck, genau wie im
    // Live-Tick (bkmpIdleTick: erst Spieler-Treffer, dann - falls der
    // Drache noch lebt - Gegenschlag). Sobald ein Kampf das Dorf auf 0 HP
    // bringen wuerde, wird NICHT mehr weiter aufgestiegen, exakt wie live
    // (bkmpIdleHandleDefeat) - vorher wurde offline nur der optimistische
    // Sieges-Pfad ohne jeden Schaden am Dorf simuliert, wodurch AFK-Spieler
    // beliebig weit ueber ihre tatsaechliche Staerke hinaus aufsteigen
    // konnten und nach der Rueckkehr sofort an zu starken Drachen scheiterten.
    /* Offline-Einnahmen (Wirtschaft-Skilltree, Knoten "wirt_offline"): erhoeht
       die Effizienz zusaetzlich zum Basiswert. Rang direkt aus
       skill_allocations gelesen (ist Teil des ohnehin schon per "*"
       geladenen Zeilen-Objekts) statt einer eigenen DB-Spalte - vermeidet
       eine weitere Migration mit Deploy-Reihenfolge-Risiko wie zuletzt bei
       last_skilltree_reset_at. effect_value_per_rank=5, max_rank=6 (siehe
       supabase-idle-dorf-schema.sql). */
    const wirtOfflineRank = Number((state.skill_allocations && state.skill_allocations.wirt_offline) || 0);
    const offlineBonusPct = Math.max(0, Math.min(6, wirtOfflineRank)) * 5;
    const efficiency = Math.max(0, Math.min(95, (offlineCfg.efficiencyPct || 50) + offlineBonusPct)) / 100;
    const attack = Number(state.attack || 10);
    const defense = Number(state.defense || 2);
    const critChance = Number(state.crit_chance || 5);
    const critDamage = Number(state.crit_damage || 150);
    const expectedCritMult = 1 + (critChance / 100) * (Math.max(1, critDamage / 100) - 1);
    // Der Drache greift live mit fixen 5% Krit / 150% Kritschaden an (siehe
    // bkmpIdleTick: bkmpIdleDamageRoll(dragon.attack, 5, 150, defense)).
    const dragonExpectedCritMult = 1 + 0.05 * (1.5 - 1);
    const secondsPerTick = 0.9;
    // Village-HP startet bei jedem Oeffnen des Modals immer voll (siehe
    // bkmpIdleOpenModal/bkmpIdleRecomputeEffectiveStats) - dieselbe Annahme
    // gilt hier fuer den Start der Offline-Periode.
    let villageHp = Number(state.hp || 100);
    const villageMaxHp = villageHp;

    /* Bug-Report 17.07. (ChronoKora): "Bleibt auf dieser Stufe" wird nach
       einem Reload ignoriert, Spieler landet automatisch wieder auf der
       hoechsten Stufe. Ursache: diese Offline-Simulation kannte
       state.auto_advance gar nicht und hat killIndex bei jedem simulierten
       Sieg/jeder Niederlage immer weitergeschoben - exakt wie der Live-Tick
       es bei auto_advance=true tut (siehe bkmpIdleHandleDragonDefeated in
       idledorf.js), aber eben auch dann, wenn der Spieler sich bewusst auf
       einer Stufe festgesetzt hatte. Jetzt: bei auto_advance=false bleibt
       killIndex fix, es wird einfach derselbe Drache wiederholt simuliert -
       genau das Live-Verhalten von "Bleibt auf dieser Stufe". */
    const autoAdvance = state.auto_advance !== false;
    let killIndex = Number(state.current_dragon_index || 0);
    let simulatedSeconds = 0;
    let kills = 0;
    let bossKills = 0;
    let goldGain = 0, xpGain = 0, woodGain = 0, stoneGain = 0, crystalGain = 0, essenceGain = 0;
    const goldBonus = Number(state.gold_bonus || 0);
    const xpBonus = Number(state.xp_bonus || 0);
    const lootBonus = Number(state.loot_bonus || 0);
    const budgetSeconds = elapsedSeconds * efficiency;

    let guard = 0;
    while (simulatedSeconds < budgetSeconds && guard < 200000) {
      guard += 1;
      const dragon = dragonStatsAt(killIndex, dragons, dragonCfg);
      if (!dragon) break;
      const dmgPerHit = Math.max(1, attack * expectedCritMult - (dragon.archetype.base_defense || 0) * 0.5);
      const hitsNeeded = Math.max(1, Math.ceil(dragon.maxHp / dmgPerHit));
      const timeToKill = hitsNeeded * secondsPerTick;
      if (simulatedSeconds + timeToKill > budgetSeconds) break;

      // Gegenschlaege: auf allen Treffern AUSSER dem letzten (der toetet),
      // wie im Live-Tick.
      const dragonDmgPerHit = Math.max(1, dragon.attack * dragonExpectedCritMult - defense * 0.5);
      const villageHpLoss = Math.max(0, hitsNeeded - 1) * dragonDmgPerHit;
      if (villageHpLoss >= villageHp) {
        // Dieser Kampf wuerde das Dorf toeten - genau wie live
        // (bkmpIdleHandleDefeat): NICHT komplett aufgeben, sondern eine
        // Stufe zurueckfallen, Dorf-HP zuruecksetzen und dort weitergrinden.
        // Vorher wurde hier hart abgebrochen, was bei einer einzigen zu
        // starken Stufe die GESAMTE Offline-Zeit auf 0 Belohnung setzte,
        // obwohl man im Livespiel einfach eine Stufe tiefer weiterfarmt.
        const ticksUntilDefeat = Math.max(1, Math.ceil(villageHp / dragonDmgPerHit));
        const timeLost = ticksUntilDefeat * secondsPerTick;
        if (simulatedSeconds + timeLost > budgetSeconds) break;
        simulatedSeconds += timeLost;
        if (autoAdvance) killIndex = Math.max(0, killIndex - 1);
        villageHp = villageMaxHp;
        continue;
      }

      simulatedSeconds += timeToKill;
      villageHp -= villageHpLoss;
      villageHp = Math.min(villageMaxHp, villageHp);

      const goldGrowth = growthMult(rewardCfg.goldGrowthPerKill, rewardCfg.goldGrowthExponent, killIndex);
      const xpGrowth = growthMult(rewardCfg.xpGrowthPerKill, rewardCfg.xpGrowthExponent, killIndex);
      const rewardMult = dragon.bossTier === 'boss' ? (rewardCfg.bossRewardMult || 4) : dragon.bossTier === 'miniboss' ? (rewardCfg.minibossRewardMult || 2) : 1;
      goldGain += Math.round((dragon.archetype.gold_reward_base || 0) * goldGrowth * rewardMult * (1 + goldBonus / 100));
      xpGain += Math.round((dragon.archetype.xp_reward_base || 0) * xpGrowth * rewardMult * (1 + xpBonus / 100));
      woodGain += Math.round((dragon.archetype.wood_reward_base || 0) * (1 + lootBonus / 100));
      stoneGain += Math.round((dragon.archetype.stone_reward_base || 0) * (1 + lootBonus / 100));
      crystalGain += Math.round((dragon.archetype.crystal_reward_base || 0) * (1 + lootBonus / 100));
      essenceGain += Math.round((dragon.archetype.essence_reward_base || 0) * (1 + lootBonus / 100));
      kills += 1;
      if (dragon.isBoss) bossKills += 1;
      if (autoAdvance) killIndex += 1;
    }

    let level = Number(state.level || 1);
    let xp = Number(state.xp || 0) + xpGain;
    let skillPointsAvailable = Number(state.skill_points_available || 0);
    let levelsGained = 0;
    const xpCfg = { base: 40, growth: 1.42 };
    function xpForLevel(l) { return Math.max(1, Math.round(xpCfg.base * Math.pow(l, xpCfg.growth))); }
    let guard2 = 0;
    while (xp >= xpForLevel(level) && guard2 < 5000) {
      xp -= xpForLevel(level);
      level += 1;
      skillPointsAvailable += 1;
      levelsGained += 1;
      guard2 += 1;
    }

    const newTotals = {
      gold: Number(state.gold || 0) + goldGain,
      total_gold_earned: Number(state.total_gold_earned || 0) + goldGain,
      wood: Number(state.wood || 0) + woodGain,
      stone: Number(state.stone || 0) + stoneGain,
      crystals: Number(state.crystals || 0) + crystalGain,
      essence: Number(state.essence || 0) + essenceGain,
      xp,
      level,
      skill_points_available: skillPointsAvailable,
      dragon_kills: Number(state.dragon_kills || 0) + kills,
      boss_kills: Number(state.boss_kills || 0) + bossKills,
      current_dragon_index: killIndex,
      highest_dragon_index: Math.max(Number(state.highest_dragon_index || 0), killIndex),
      last_seen_at: new Date().toISOString(),
      last_offline_claim: { elapsedSeconds, goldGain, xpGain, woodGain, stoneGain, crystalGain, essenceGain, dragonKills: kills, levelsGained, claimedAt: new Date().toISOString() }
    };

    const claimRes = await sbFetch(serviceKey, `idle_player_state?name_key=eq.${encodeURIComponent(nameKey)}&last_seen_at=eq.${encodeURIComponent(lastSeenIso)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(newTotals)
    });
    if (!claimRes.ok) {
      const detail = await claimRes.text().catch(() => '');
      return send(res, 502, { error: 'claim_failed', detail: detail.slice(0, 300) });
    }
    const claimed = await claimRes.json();
    if (!Array.isArray(claimed) || claimed.length === 0) {
      // Zwischenzeitlich hat eine andere Anfrage (z. B. ein zweiter Tab) den
      // Stand schon fortgeschrieben - dessen zuletzt gewaehrten Claim zurueckgeben,
      // statt doppelt gutzuschreiben.
      const recheck = await sbFetch(serviceKey, `idle_player_state?name_key=eq.${encodeURIComponent(nameKey)}&select=last_offline_claim&limit=1`);
      const recheckRows = recheck.ok ? await recheck.json() : [];
      const lastClaim = Array.isArray(recheckRows) && recheckRows[0] ? recheckRows[0].last_offline_claim : null;
      return send(res, 200, { ok: true, elapsedSeconds: 0, rewards: null, newTotals: null, note: 'already_claimed', previousClaim: lastClaim || null });
    }

    return send(res, 200, {
      ok: true,
      elapsedSeconds,
      rewards: { gold: goldGain, xp: xpGain, wood: woodGain, stone: stoneGain, crystals: crystalGain, essence: essenceGain, dragonKills: kills, levelsGained },
      newTotals
    });
  } catch (error) {
    return send(res, 502, { error: 'unexpected', detail: String(error && error.message || error).slice(0, 300) });
  }
};
