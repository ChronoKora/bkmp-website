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

function dragonStatsAt(killIndex, dragons, cfg) {
  const pool = (dragons || []).filter(d => d.active !== false).sort((a, b) => (a.tier_order || 0) - (b.tier_order || 0));
  if (!pool.length) return null;
  const archetype = pool[killIndex % pool.length];
  const hpGrowth = Math.pow(1 + (cfg.hpGrowthPerKill || 0), killIndex);
  const bossEvery = cfg.bossEvery || 10;
  const isBoss = Boolean(archetype.is_boss) || ((killIndex + 1) % bossEvery === 0);
  const bossMult = isBoss ? (cfg.bossMultiplier || 3) : 1;
  return {
    archetype,
    isBoss,
    maxHp: Math.max(1, Math.round((archetype.base_hp || 50) * hpGrowth * bossMult))
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

    const configRes = await sbFetch(serviceKey, `idle_game_config?key=in.(offline_progress,dragon_scaling,reward_scaling)&select=key,value`);
    const configRows = configRes.ok ? await configRes.json() : [];
    const config = {};
    (Array.isArray(configRows) ? configRows : []).forEach(row => { config[row.key] = row.value; });
    const offlineCfg = config.offline_progress || { maxHours: 12, efficiencyPct: 50 };
    const dragonCfg = config.dragon_scaling || { hpGrowthPerKill: 0.045, atkGrowthPerKill: 0.035, bossEvery: 10, bossMultiplier: 3 };
    const rewardCfg = config.reward_scaling || { goldGrowthPerKill: 0.03, xpGrowthPerKill: 0.03 };

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

    // Vereinfachung: die Live-Version kann eine Stufe verlieren, wenn das
    // Dorf auf 0 HP faellt. Offline wird das bewusst NICHT simuliert (kein
    // Verlust-Risiko, nur der optimistische Sieges-Pfad) - sonst muesste
    // hier ein komplettes Tick-fuer-Tick-HP-Modell nachgebaut werden, und
    // Offline-Fortschritt ist ohnehin schon durch efficiencyPct gedeckelt.
    const efficiency = Math.max(0, Math.min(100, offlineCfg.efficiencyPct || 50)) / 100;
    const attack = Number(state.attack || 10);
    const critChance = Number(state.crit_chance || 5);
    const critDamage = Number(state.crit_damage || 150);
    const expectedCritMult = 1 + (critChance / 100) * (Math.max(1, critDamage / 100) - 1);
    const secondsPerTick = 0.9;

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
      simulatedSeconds += timeToKill;

      const goldGrowth = Math.pow(1 + (rewardCfg.goldGrowthPerKill || 0), killIndex);
      const xpGrowth = Math.pow(1 + (rewardCfg.xpGrowthPerKill || 0), killIndex);
      const bossMult = dragon.isBoss ? 2 : 1;
      goldGain += Math.round((dragon.archetype.gold_reward_base || 0) * goldGrowth * bossMult * (1 + goldBonus / 100));
      xpGain += Math.round((dragon.archetype.xp_reward_base || 0) * xpGrowth * bossMult * (1 + xpBonus / 100));
      woodGain += Math.round((dragon.archetype.wood_reward_base || 0) * (1 + lootBonus / 100));
      stoneGain += Math.round((dragon.archetype.stone_reward_base || 0) * (1 + lootBonus / 100));
      crystalGain += Math.round((dragon.archetype.crystal_reward_base || 0) * (1 + lootBonus / 100));
      essenceGain += Math.round((dragon.archetype.essence_reward_base || 0) * (1 + lootBonus / 100));
      kills += 1;
      if (dragon.isBoss) bossKills += 1;
      killIndex += 1;
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
