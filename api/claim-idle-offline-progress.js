/* ============================================================
   Bkmp - Idle Drachen Dorf: Offline-/AFK-Fortschritt serverseitig
   berechnen und atomar gutschreiben.

   idle_player_state hatte lange offene RLS fuer den laufenden Kampf
   (siehe supabase-security-audit-rls-fix.sql, 15.07., stellt Owner-
   only-Schreibzugriff wieder her) - diese Funktion war deshalb bisher
   kein hartes Sicherheitsnetz gegen manipulierte Werte, sondern
   verhinderte nur, dass "wie lange war ich weg" vom Client selbst
   behauptet werden kann. Genau wie in api/active-daily-event.js wird
   die Zeitspanne serverseitig aus last_seen_at berechnet, nie aus
   einem vom Client gesendeten Wert.

   Atomarer Claim per PATCH ... WHERE last_seen_at = eq.<gelesener
   Wert>: klappt nur fuer die Anfrage, die den zuletzt gelesenen
   Stand noch unveraendert vorfindet (gleiches Prinzip wie
   winner_name_key is.null in api/redeem-daily-event.js). Bei
   gleichzeitigem Oeffnen in zwei Tabs bekommt nur eine Anfrage
   die Gutschrift, die andere erhaelt den bereits aktualisierten
   Stand zurueck statt doppelt gutzuschreiben.

   ============================================================
   UMBAU 21.08.2026 - fester Wert statt Kampf-Simulation
   ============================================================
   Bis zu diesem Datum simulierte diese Funktion einen echten Zug-fuer-
   Zug-Kampf (Kampfwerte, Gegenschlaege, Rueckzug bei Niederlage, Magie-
   Skilltree-Effekte, seltene Drachen-Chance - siehe Git-Historie fuer
   die volle, inzwischen entfernte Logik). Diese Simulation hatte eine
   strukturelle Schwaeche: war schon der ALLERERSTE Kampf an der
   aktuellen Stufe nicht innerhalb der Abwesenheitszeit gewinnbar, blieb
   die GESAMTE Belohnung bei 0 - unabhaengig von der Dauer der
   Abwesenheit. Dieses Muster wurde ueber mehrere Monate hinweg
   wiederholt fuer je eine andere Unterursache gepatcht (fehlende
   Drachen-Daten, fehlende Magie-Skilltree-Effekte, fehlende seltene
   Drachen, zu langsamer Rueckzug, fehlender Begleitdrachen-Kontext),
   ohne die eigentliche "Alles-oder-nichts"-Struktur zu aendern. Ein
   erster Fix (garantierter Mindestlohn ALS ZUSATZ zur Simulation,
   max() pro Ressource) loeste das Problem bereits strukturell.

   Direkter Nutzerauftrag danach, nach Betrachtung des Live-Ergebnisses:
   "Ich will das wir nur noch einen 'Festwert' haben. Anhand der
   hoechsten Stufe. 75% Der Belohnung der hoechsten Stufe." - die
   Simulation wurde daraufhin VOLLSTAENDIG entfernt (nicht nur ergaenzt).
   Die Offline-/AFK-Belohnung ist jetzt eine einzige, deterministische
   Formel: sie liest NUR die Basis-Belohnungswerte des Drachen an
   state.highest_dragon_index (die hoechste je erreichte Stufe, nicht
   die aktuelle - bleibt auch bestehen, wenn der Spieler zwischenzeitlich
   zurueckgefallen ist), nimmt eine feste, konfigurierbare Kill-Rate pro
   Stunde an und zahlt davon einen festen Prozentsatz (Standard 75%,
   siehe idle_game_config-Schluessel 'offline_afk_reward'). Komplett
   unabhaengig von Kampfstats/Skilltree-Kampfzustand (Wirtschafts-
   Skilltree-Knoten "wirt_offline" bleibt als bewusste Ausnahme wirksam,
   siehe unten) - kann dadurch strukturell NIE mehr komplett leer
   ausgehen und liefert bei gleicher Abwesenheitsdauer/gleicher Stufe
   IMMER denselben Betrag (kein Zufall, keine Simulation, kein "hat es
   geklappt oder nicht"). current_dragon_index/highest_dragon_index
   selbst werden von einer Abwesenheit nicht mehr veraendert - echter
   Stufen-Fortschritt passiert weiterhin nur durch aktives Spielen.

   SICHERHEITS-NACHTRAG (Perf-/Sicherheits-Audit 15.07.): der
   mitgeschickte "playerName" wurde bisher ungeprueft als Lookup-
   Schluessel verwendet - jeder haette per wiederholtem Aufruf mit dem
   Namen eines ANDEREN Spielers dessen last_seen_at immer wieder auf
   "jetzt" zuruecksetzen und ihm so echten Offline-Fortschritt klauen
   koennen. Jetzt wird das Access-Token gegen /auth/v1/user geprueft
   (wie in api/claim-map-order.js) und der Datensatz kommt ueber die
   verifizierte auth_user_id statt ueber den Client-String.

   Braucht SUPABASE_SERVICE_ROLE_KEY in Vercel.
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RuiDW15_3cI0cQZ8WlzoWg_DhGU9r6f';

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

/* Eigenstaendige, vereinfachte Kopie von bkmpIdleSelectDragonKindId aus
   idledorf.js - entscheidet nur, WELCHER Drachen-Archetyp an einer
   gegebenen Stufe steht (fuer die Belohnungs-Basiswerte + Boss-Erkennung),
   keine Kampfwerte mehr noetig seit dem Umbau 21.08.2026 (siehe Datei-
   Kopf-Kommentar). */
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

/* Liefert nur noch Archetyp + Boss-/Miniboss-Einstufung - maxHp/attack
   wurden mit der Kampf-Simulation entfernt (siehe Umbau-Kommentar oben),
   die Belohnungsformel braucht ausschliesslich die *_reward_base-Felder
   des Archetyps selbst. */
function dragonKindAt(killIndex, dragons) {
  const kindId = selectDragonKindId(killIndex, dragons);
  const archetype = (dragons || []).find(d => d.id === kindId);
  if (!archetype) return null;
  let bossTier = null;
  if (archetype.spawn_rule === 'boss_25') bossTier = 'boss';
  else if (archetype.spawn_rule === 'miniboss_10') bossTier = 'miniboss';
  return { archetype, isBoss: Boolean(bossTier), bossTier };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return send(res, 500, { error: 'server_not_configured' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!accessToken) return send(res, 401, { error: 'missing_token' });

  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body || '{}');
  } catch (e) {
    return send(res, 400, { error: 'invalid_json' });
  }
  body = body || {};

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) return send(res, 401, { error: 'invalid_session' });
    const user = await userRes.json();
    if (!user || !user.id) return send(res, 401, { error: 'invalid_session' });

    const stateRes = await sbFetch(serviceKey, `idle_player_state?auth_user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
    if (!stateRes.ok) return send(res, 502, { error: 'lookup_failed' });
    const stateRows = await stateRes.json();
    const state = Array.isArray(stateRows) ? stateRows[0] : null;
    if (!state) return send(res, 200, { ok: true, elapsedSeconds: 0, rewards: null, newTotals: null });

    const configRes = await sbFetch(serviceKey, `idle_game_config?key=in.(offline_progress,reward_scaling,boss_scaling,offline_afk_reward)&select=key,value`);
    const configRows = configRes.ok ? await configRes.json() : [];
    const config = {};
    (Array.isArray(configRows) ? configRows : []).forEach(row => { config[row.key] = row.value; });
    const offlineCfg = config.offline_progress || { maxHours: 12 };
    const bossCfg = config.boss_scaling || { minibossRewardMult: 2, bossRewardMult: 4 };
    const rewardCfg = { ...(config.reward_scaling || { goldGrowthPerKill: 0.05, goldGrowthExponent: 1.2, xpGrowthPerKill: 0.05, xpGrowthExponent: 1.2 }), ...bossCfg };
    const afkCfg = config.offline_afk_reward || {};

    /* Gilden-Technologie v3 (31.07.2026), "Nachtwache" (guild_nachtwache):
       erhoeht den Offline-Deckel um effect_per_tier Std./Stufe fuer
       Mitglieder einer Gilde mit diesem Knoten. Tier UND effect_per_tier
       werden bewusst dynamisch aus guild_tech_progress/guild_tech_nodes
       gelesen (keine zweite hartcodierte Kopie des Stufenwerts, gleiches
       Prinzip wie bei arena_attack()/raid_join()). Rein additive Abfrage,
       liefert 0, wenn der Spieler in keiner Gilde ist oder der Knoten
       noch nicht freigeschaltet wurde. Unveraendert durch den Umbau
       21.08.2026 - der Deckel selbst betrifft weiterhin nur, wie viel
       Abwesenheitszeit ueberhaupt zaehlt, unabhaengig von der Formel. */
    let guildOfflineBonusHours = 0;
    try {
      const memberRes = await sbFetch(serviceKey, `guild_members?auth_user_id=eq.${encodeURIComponent(user.id)}&select=guild_id&limit=1`);
      const memberRows = memberRes.ok ? await memberRes.json() : [];
      const guildId = Array.isArray(memberRows) && memberRows[0] ? memberRows[0].guild_id : null;
      if (guildId) {
        const [progressRes, nodeRes] = await Promise.all([
          sbFetch(serviceKey, `guild_tech_progress?guild_id=eq.${encodeURIComponent(guildId)}&node_id=eq.guild_nachtwache&select=tier&limit=1`),
          sbFetch(serviceKey, `guild_tech_nodes?id=eq.guild_nachtwache&select=effect_per_tier&limit=1`)
        ]);
        const progressRows = progressRes.ok ? await progressRes.json() : [];
        const nodeRows = nodeRes.ok ? await nodeRes.json() : [];
        const tier = Array.isArray(progressRows) && progressRows[0] ? Number(progressRows[0].tier || 0) : 0;
        const perTier = Array.isArray(nodeRows) && nodeRows[0] ? Number(nodeRows[0].effect_per_tier || 0) : 0;
        guildOfflineBonusHours = Math.max(0, tier) * perTier;
      }
    } catch (e) { /* Gilden-Lookup fehlgeschlagen - Deckel bleibt beim Standardwert */ }

    const lastSeenIso = state.last_seen_at;
    const lastSeenMs = Date.parse(lastSeenIso);
    const nowMs = Date.now();
    const maxSeconds = ((offlineCfg.maxHours || 12) + guildOfflineBonusHours) * 3600;
    const elapsedSeconds = Math.max(0, Math.min(maxSeconds, Math.round((nowMs - lastSeenMs) / 1000)));

    if (elapsedSeconds < 60) {
      return send(res, 200, { ok: true, elapsedSeconds, rewards: null, newTotals: null });
    }

    const dragonsRes = await sbFetch(serviceKey, `idle_dragons?active=eq.true&select=*&order=tier_order.asc`);
    const dragons = dragonsRes.ok ? await dragonsRes.json() : [];
    /* Bug-Fix (Spieler-Report 19.07., Blazehunter07: "550 Min. weg, 0
       Belohnung"): schlaegt dieser Fetch fehl oder kommt leer zurueck (z.B.
       kurzer Supabase-Ausreisser), wird gar nichts gespeichert (last_seen_at
       bleibt unveraendert) und ein echter Fehler zurueckgegeben, damit der
       Client es spaeter erneut versuchen kann, statt die Zeit still-
       schweigend zu verbrennen. */
    if (!dragonsRes.ok || !Array.isArray(dragons) || dragons.length === 0) {
      return send(res, 502, { error: 'dragons_unavailable' });
    }

    /* Bug-Fix (Spieler-Meldung 05.08.2026: "über nacht offline timer
       passiert auch nichts an Fortschritt" - gemeint war der Begleitdrache,
       der von Jugendlich zu Erwachsen heranwaechst). Unveraendert durch den
       Umbau 21.08.2026 - der Begleitdrache bekommt weiterhin eine eigene,
       von der Haupt-Formel unabhaengige Kampf-EP-Trickle-Menge pro Stunde
       (siehe companionXpPerHour weiter unten), deckelt am Ende auf
       battle_xp_required und schreibt das Ergebnis separat in
       player_dragons. */
    let companion = null;
    let companionBattleXpRequired = 0;
    try {
      const companionRes = await sbFetch(serviceKey, `player_dragons?auth_user_id=eq.${encodeURIComponent(user.id)}&is_companion=eq.true&stage=eq.teen&select=id,species_id,battle_xp&limit=1`);
      const companionRows = companionRes.ok ? await companionRes.json() : [];
      const companionRow = Array.isArray(companionRows) && companionRows[0] ? companionRows[0] : null;
      if (companionRow) {
        const speciesRes = await sbFetch(serviceKey, `dragon_species?id=eq.${encodeURIComponent(companionRow.species_id)}&select=battle_xp_required&limit=1`);
        const speciesRows = speciesRes.ok ? await speciesRes.json() : [];
        const speciesRow = Array.isArray(speciesRows) && speciesRows[0] ? speciesRows[0] : null;
        if (speciesRow) {
          companion = companionRow;
          companionBattleXpRequired = Number(speciesRow.battle_xp_required || 0);
        }
      }
    } catch (e) { /* Begleitdrache-Lookup fehlgeschlagen - Kampf-EP-Gutschrift bleibt einfach aus, Rest der Belohnung unangetastet */ }

    /* ============================================================
       Feste AFK-Belohnungsformel (21.08.2026, siehe Datei-Kopf-Kommentar
       fuer die volle Herleitung). Referenzstufe ist ausdruecklich
       highest_dragon_index (die hoechste je erreichte Stufe), NICHT
       current_dragon_index - eine Abwesenheit soll den bereits bewiesenen
       Fortschritt beloehnen, nicht davon abhaengen, wo der Spieler gerade
       zufaellig steht (auto_advance=false/ein Rueckzug wuerde sie sonst
       kuenstlich druecken). Keine Kampfsimulation mehr - die einzigen
       Eingaben sind: wie lange war der Spieler weg, welche Basis-
       Belohnung zahlt der Drache an seiner besten Stufe, und ein fester,
       admin-anpassbarer Prozentsatz (Standard 75%, idle_game_config-
       Schluessel 'offline_afk_reward'). */
    const highestKillIndex = Number(state.highest_dragon_index || 0);
    let refDragon = null;
    try {
      refDragon = dragonKindAt(highestKillIndex, dragons) || dragonKindAt(0, dragons);
    } catch (e) { refDragon = null; }
    if (!refDragon) return send(res, 502, { error: 'dragons_unavailable' });

    /* Wirtschafts-Skilltree-Knoten "wirt_offline" bleibt als bewusste
       Ausnahme wirksam (bereits investierte Spielerpunkte sollen nicht
       durch den Umbau entwertet werden) - erhoeht den festen Prozentsatz
       additiv, bei 6 Raengen a 5% max. +30%. effect_value_per_rank=5,
       max_rank=6 (siehe supabase-idle-dorf-schema.sql). Rang direkt aus
       skill_allocations gelesen (bereits Teil der oben per "*" geladenen
       Zeile), keine weitere Migration noetig. */
    const wirtOfflineRank = Number((state.skill_allocations && state.skill_allocations.wirt_offline) || 0);
    const wirtOfflineBonusPct = Math.max(0, Math.min(6, wirtOfflineRank)) * 5;
    const baseEfficiencyPct = afkCfg.efficiencyPct != null ? Number(afkCfg.efficiencyPct) : 75;
    const efficiency = Math.max(0, Math.min(100, baseEfficiencyPct + wirtOfflineBonusPct)) / 100;
    const assumedSecondsPerKill = Math.max(1, Number(afkCfg.assumedSecondsPerKill || 45));
    const assumedSecondsPerEliteKill = Math.max(1, Number(afkCfg.assumedSecondsPerBossKill || 180));
    const companionXpPerHour = Math.max(0, Number(afkCfg.companionXpPerHour || 8));

    const goldBonus = Number(state.gold_bonus || 0);
    const xpBonus = Number(state.xp_bonus || 0);
    const lootBonus = Number(state.loot_bonus || 0);

    const isEliteRef = Boolean(refDragon.bossTier);
    const kills = Math.max(0, Math.floor(elapsedSeconds / (isEliteRef ? assumedSecondsPerEliteKill : assumedSecondsPerKill)));
    const bossKills = isEliteRef ? kills : 0;

    let goldGain = 0, xpGain = 0, woodGain = 0, stoneGain = 0, crystalGain = 0, essenceGain = 0;
    if (kills > 0) {
      const goldGrowth = growthMult(rewardCfg.goldGrowthPerKill, rewardCfg.goldGrowthExponent, highestKillIndex);
      const xpGrowth = growthMult(rewardCfg.xpGrowthPerKill, rewardCfg.xpGrowthExponent, highestKillIndex);
      const rewardMult = refDragon.bossTier === 'boss' ? (rewardCfg.bossRewardMult || 4) : refDragon.bossTier === 'miniboss' ? (rewardCfg.minibossRewardMult || 2) : 1;
      goldGain = Math.round(kills * (refDragon.archetype.gold_reward_base || 0) * goldGrowth * rewardMult * (1 + goldBonus / 100) * efficiency);
      xpGain = Math.round(kills * (refDragon.archetype.xp_reward_base || 0) * xpGrowth * rewardMult * (1 + xpBonus / 100) * efficiency);
      woodGain = Math.round(kills * (refDragon.archetype.wood_reward_base || 0) * (1 + lootBonus / 100) * efficiency);
      stoneGain = Math.round(kills * (refDragon.archetype.stone_reward_base || 0) * (1 + lootBonus / 100) * efficiency);
      crystalGain = Math.round(kills * (refDragon.archetype.crystal_reward_base || 0) * (1 + lootBonus / 100) * efficiency);
      essenceGain = Math.round(kills * (refDragon.archetype.essence_reward_base || 0) * (1 + lootBonus / 100) * efficiency);
    }
    const companionXpGain = companion ? Math.floor((elapsedSeconds / 3600) * companionXpPerHour) : 0;

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
      // Bugfix 21.08.2026 - keine Kampfsimulation mehr, current_dragon_index/
      // highest_dragon_index werden von einer Abwesenheit nicht mehr
      // veraendert (echter Stufen-Fortschritt passiert nur noch aktiv).
      last_seen_at: new Date().toISOString(),
      last_offline_claim: { elapsedSeconds, goldGain, xpGain, woodGain, stoneGain, crystalGain, essenceGain, dragonKills: kills, levelsGained, claimedAt: new Date().toISOString() }
    };

    const claimRes = await sbFetch(serviceKey, `idle_player_state?auth_user_id=eq.${encodeURIComponent(user.id)}&last_seen_at=eq.${encodeURIComponent(lastSeenIso)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(newTotals)
    });
    if (!claimRes.ok) {
      const detail = await claimRes.text().catch(() => '');
      return send(res, 502, { error: 'claim_failed', detail: detail.slice(0, 300) });
    }

    // Begleitdrache-Kampf-EP separat schreiben (eigene Tabelle, siehe
    // Kommentar beim companion-Lookup oben) - bewusst NACH dem bereits
    // erfolgreich bestaetigten Haupt-Claim und in einem eigenen try/catch,
    // damit ein Fehlschlag hier nie den bereits gewaehrten Rest der
    // Offline-Belohnung gefaehrdet.
    let dragonXpGain = 0;
    if (companion && companionXpGain > 0 && companionBattleXpRequired > 0) {
      try {
        const newBattleXp = Math.min(companionBattleXpRequired, Number(companion.battle_xp || 0) + companionXpGain);
        dragonXpGain = newBattleXp - Number(companion.battle_xp || 0);
        if (dragonXpGain > 0) {
          await sbFetch(serviceKey, `player_dragons?id=eq.${encodeURIComponent(companion.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ battle_xp: newBattleXp })
          });
        }
      } catch (e) { /* Begleitdrache-EP-Schreibvorgang fehlgeschlagen - der Rest der Offline-Belohnung bleibt trotzdem gueltig */ }
    }

    const claimed = await claimRes.json();
    if (!Array.isArray(claimed) || claimed.length === 0) {
      // Zwischenzeitlich hat eine andere Anfrage (z. B. ein zweiter Tab) den
      // Stand schon fortgeschrieben - dessen zuletzt gewaehrten Claim zurueckgeben,
      // statt doppelt gutzuschreiben.
      const recheck = await sbFetch(serviceKey, `idle_player_state?auth_user_id=eq.${encodeURIComponent(user.id)}&select=last_offline_claim&limit=1`);
      const recheckRows = recheck.ok ? await recheck.json() : [];
      const lastClaim = Array.isArray(recheckRows) && recheckRows[0] ? recheckRows[0].last_offline_claim : null;
      return send(res, 200, { ok: true, elapsedSeconds: 0, rewards: null, newTotals: null, note: 'already_claimed', previousClaim: lastClaim || null });
    }

    return send(res, 200, {
      ok: true,
      elapsedSeconds,
      rewards: { gold: goldGain, xp: xpGain, wood: woodGain, stone: stoneGain, crystals: crystalGain, essence: essenceGain, dragonKills: kills, levelsGained, dragonXpGain },
      newTotals
    });
  } catch (error) {
    return send(res, 502, { error: 'unexpected', detail: String(error && error.message || error).slice(0, 300) });
  }
};
