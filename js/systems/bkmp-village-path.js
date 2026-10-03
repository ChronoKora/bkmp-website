/* ============================================================
   📖 Pfad des Drachendorfs (Drachendorf-Ausbau Phase 5, 04.10.2026)

   Permanente, einmalige Langzeitziele in sechs Kapiteln - Teil der Chronik
   (eigener Reiter "📖 Pfad" + "🎯 Deine nächsten Ziele" ganz oben bei den
   Aufträgen). Keine weitere Daily-Liste.

   - Rueckwirkend: jedes Ziel wird aus dem AKTUELLEN Spielstand berechnet
     (hoechste Stufe, Upgrades, Gebaeude, Dex-Rekorde, ...). Wer schon weit
     ist, hat entsprechende Ziele sofort erfuellt.
   - Abgeholt wird einmal pro Ziel (gespeichert in der Chronik, Merge = ODER,
     vor dem Abholen wird der Serverstand nachgeladen -> kein Doppel-Abholen
     ueber zwei Geraete). "Alle Belohnungen abholen" statt 30 Popups.
   - Belohnungen ueber bkmpChronicleGrant (gleicher Weg wie Chronik-Truhen),
     skaliert mit der Belohnungseinheit (waechst mit dem Spieler).
   ============================================================ */

const BKMP_PATH_CHAPTERS = [
  { id: 1, roman: 'I', title: 'Die ersten Mauern', icon: '🧱' },
  { id: 2, roman: 'II', title: 'Die Drachenzüchter', icon: '🥚' },
  { id: 3, roman: 'III', title: 'Die Chronisten', icon: '📜' },
  { id: 4, roman: 'IV', title: 'Meister des Dorfes', icon: '🏰' },
  { id: 5, roman: 'V', title: 'Jenseits des Horizonts', icon: '⚓' },
  { id: 6, roman: 'VI', title: 'Legenden', icon: '👑' }
];

/* ---------- Kennzahlen (rueckwirkend aus dem aktuellen Stand) ---------- */
function bkmpPathState() { return typeof bkmpIdleState !== 'undefined' ? bkmpIdleState : null; }
function bkmpPathSumObj(o) {
  if (!o || typeof o !== 'object') return 0;
  return Object.keys(o).reduce((s, k) => s + (Number(o[k]) || 0), 0);
}
function bkmpPathDexMaxForm() {
  const recs = typeof bkmpChronicleDexRecords === 'function' ? bkmpChronicleDexRecords() : {};
  let best = -1;
  Object.keys(recs).forEach(k => { best = Math.max(best, recs[k][0]); });
  const s = bkmpPathState();
  if (best < 0 && s && Object.keys(s.dragon_species_discovered_at || {}).length) best = 0;
  return best;
}
function bkmpPathDexExpeditions() {
  const recs = typeof bkmpChronicleDexRecords === 'function' ? bkmpChronicleDexRecords() : {};
  return Object.keys(recs).reduce((s, k) => s + (recs[k][3] || 0), 0);
}
function bkmpPathDragons() { return typeof bkmpPlayerDragons !== 'undefined' ? bkmpPlayerDragons : []; }
function bkmpPathStats() { return typeof bkmpDexStats === 'function' ? bkmpDexStats() : {}; }
const BKMP_PATH_METRICS = {
  bossKills: () => Number((bkmpPathState() || {}).boss_kills || 0),
  highest: () => Number((bkmpPathState() || {}).highest_dragon_index || 0),
  kills: () => Number((bkmpPathState() || {}).dragon_kills || 0),
  upgradeRanks: () => bkmpPathSumObj((bkmpPathState() || {}).upgrade_purchases),
  buildingLevels: () => {
    const s = bkmpPathState() || {};
    return ['holzfaeller_level', 'steinbruch_level', 'goldmine_level', 'kristallmine_level', 'manaquelle_level', 'magierakademie_level']
      .reduce((sum, k) => sum + (Number(s[k]) || 0), 0);
  },
  skillRanks: () => bkmpPathSumObj((bkmpPathState() || {}).skill_allocations),
  speciesDiscovered: () => Object.keys((bkmpPathState() || {}).dragon_species_discovered_at || {}).length,
  maxForm: () => bkmpPathDexMaxForm(),
  adultCompanion: () => bkmpPathDragons().some(d => d.is_companion && (d.stage === 'adult' || d.stage === 'divine')) ? 1 : 0,
  combatCompanions: () => bkmpPathDragons().filter(d => d.is_companion && (d.stage === 'adult' || d.stage === 'divine')).length,
  bestiaryTiers: () => (typeof bkmpChronicleBestiaryTotalTiers === 'function' ? bkmpChronicleBestiaryTotalTiers() : 0),
  runesOwned: () => (typeof bkmpIdlePlayerRunes !== 'undefined' && Array.isArray(bkmpIdlePlayerRunes) ? bkmpIdlePlayerRunes.length : 0),
  runesEquipped: () => (typeof bkmpIdlePlayerRunes !== 'undefined' && Array.isArray(bkmpIdlePlayerRunes) ? bkmpIdlePlayerRunes.filter(r => r.equipped).length : 0),
  towerWave: () => Number((bkmpPathState() || {}).turm_highest_wave || 0),
  prestige: () => (typeof bkmpPrestigeState !== 'undefined' && bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : 0),
  inGuild: () => (typeof bkmpGuildState !== 'undefined' && bkmpGuildState && bkmpGuildState.guild ? 1 : 0),
  epicAdult: () => bkmpPathStats().epicAdult || 0,
  legendaryAdult: () => bkmpPathStats().legendaryAdult || 0,
  adultSpecies: () => bkmpPathStats().adultSpecies || 0,
  dexPct: () => bkmpPathStats().pct || 0,
  harbor: () => (typeof bkmpVillageLevel === 'function' ? bkmpVillageLevel('drachenhafen') : 0),
  tradingPost: () => (typeof bkmpVillageLevel === 'function' ? bkmpVillageLevel('handelsposten') : 0),
  expeditions: () => bkmpPathDexExpeditions(),
  distinctTraits: () => new Set(bkmpPathDragons().map(d => d.trait).filter(Boolean)).size,
  maxBond: () => bkmpPathDragons().reduce((m, d) => Math.max(m, typeof bkmpDragonBondLevel === 'function' ? bkmpDragonBondLevel(d.bond_xp) : 1), 0),
  soulbound: () => bkmpPathStats().soulbound || 0,
  divineSpecies: () => bkmpPathStats().divineSpecies || 0
};

/* reward: Vielfache der Belohnungseinheit (gold/xp = Kills, crystals/essence = Bosse) + Extras */
const BKMP_PATH_GOALS = [
  { id: 'p1_boss', ch: 1, icon: '👑', title: 'Der erste Boss', desc: 'Besiege einen Boss.', metric: 'bossKills', target: 1, goTab: 'kampf' },
  { id: 'p1_upgrades', ch: 1, icon: '⬆️', title: 'Stärkere Mauern', desc: 'Kaufe insgesamt 25 Upgrade-Stufen.', metric: 'upgradeRanks', target: 25, goTab: 'upgrades' },
  { id: 'p1_buildings', ch: 1, icon: '🏭', title: 'Erste Werkstätten', desc: 'Baue Produktionsgebäude auf insgesamt Stufe 5.', metric: 'buildingLevels', target: 5, goTab: 'upgrades' },
  { id: 'p1_skills', ch: 1, icon: '🌳', title: 'Erstes Wissen', desc: 'Verteile 5 Skillpunkte.', metric: 'skillRanks', target: 5, goTab: 'skilltree' },
  { id: 'p1_stage100', ch: 1, icon: '🗺️', title: 'Über die Hügel', desc: 'Erreiche Stufe 10-0.', metric: 'highest', target: 100, goTab: 'kampf' },

  { id: 'p2_egg', ch: 2, icon: '🥚', title: 'Das erste Ei', desc: 'Finde ein Drachenei.', metric: 'speciesDiscovered', target: 1, goTab: 'dungeon' },
  { id: 'p2_baby', ch: 2, icon: '🐣', title: 'Geschlüpft', desc: 'Brüte einen Drachen aus.', metric: 'maxForm', target: 1, goTab: 'drachen' },
  { id: 'p2_teen', ch: 2, icon: '🐲', title: 'Großgezogen', desc: 'Füttere einen Drachen, bis er jugendlich ist.', metric: 'maxForm', target: 2, goTab: 'drachen' },
  { id: 'p2_adult', ch: 2, icon: '🐉', title: 'Erwachsen', desc: 'Ziehe einen Drachen bis zur erwachsenen Form groß.', metric: 'maxForm', target: 3, goTab: 'drachen', extra: { egg: true } },
  { id: 'p2_companion', ch: 2, icon: '🤝', title: 'Seite an Seite', desc: 'Setze einen erwachsenen Drachen als Kampf-Begleiter ein.', metric: 'adultCompanion', target: 1, goTab: 'drachen' },

  { id: 'p3_bestiary', ch: 3, icon: '📖', title: 'Chronist der Drachen', desc: 'Erreiche 5 Bestiarium-Stufen.', metric: 'bestiaryTiers', target: 5, chronTab: 'bestiary' },
  { id: 'p3_runes', ch: 3, icon: '🔮', title: 'Runensammler', desc: 'Besitze 10 Runen.', metric: 'runesOwned', target: 10, goTab: 'runen' },
  { id: 'p3_runes_equip', ch: 3, icon: '💠', title: 'Volle Rüstung', desc: 'Rüste in allen 6 Plätzen eine Rune aus.', metric: 'runesEquipped', target: 6, goTab: 'runen', extra: { rune: true } },
  { id: 'p3_tower', ch: 3, icon: '🗼', title: 'Turmstürmer', desc: 'Erreiche Turmstufe 25.', metric: 'towerWave', target: 25, goTab: 'turm' },
  { id: 'p3_stage500', ch: 3, icon: '🏔️', title: 'Hinter den Bergen', desc: 'Erreiche Stufe 50-0.', metric: 'highest', target: 500, goTab: 'kampf' },

  { id: 'p4_prestige', ch: 4, icon: '🌌', title: 'Neuer Anfang', desc: 'Steige zum ersten Mal auf (Prestige).', metric: 'prestige', target: 1, goTab: 'prestige' },
  { id: 'p4_companions', ch: 4, icon: '🐉', title: 'Ein starkes Rudel', desc: 'Habe zwei erwachsene Kampf-Begleiter gleichzeitig.', metric: 'combatCompanions', target: 2, goTab: 'drachen' },
  { id: 'p4_guild', ch: 4, icon: '🛡️', title: 'Gemeinsam stark', desc: 'Tritt einer Gilde bei.', metric: 'inGuild', target: 1, goTab: 'gilde' },
  { id: 'p4_epic', ch: 4, icon: '🟣', title: 'Epischer Züchter', desc: 'Ziehe einen epischen Drachen groß.', metric: 'epicAdult', target: 1, goTab: 'drachen' },
  { id: 'p4_legendary', ch: 4, icon: '🟡', title: 'Legendärer Züchter', desc: 'Ziehe einen legendären Drachen groß.', metric: 'legendaryAdult', target: 1, goTab: 'drachen', extra: { egg: true } },

  { id: 'p5_harbor', ch: 5, icon: '⚓', title: 'Der Hafen', desc: 'Baue den Drachenhafen.', metric: 'harbor', target: 1, goTab: 'dorf' },
  { id: 'p5_expeditions', ch: 5, icon: '🧭', title: 'Weit gereist', desc: 'Schließe 5 Expeditionen ab (Drachen-Einsätze).', metric: 'expeditions', target: 5, goTab: 'drachen' },
  { id: 'p5_traits', ch: 5, icon: '✨', title: 'Viele Talente', desc: 'Besitze Drachen mit 5 verschiedenen Eigenschaften.', metric: 'distinctTraits', target: 5, goTab: 'drachen' },
  { id: 'p5_bond', ch: 5, icon: '💞', title: 'Treue Gefährten', desc: 'Erreiche Bindung 5 mit einem Drachen.', metric: 'maxBond', target: 5, goTab: 'drachen' },
  { id: 'p5_tradingpost', ch: 5, icon: '🏪', title: 'Händlerdorf', desc: 'Baue den Handelsposten.', metric: 'tradingPost', target: 1, goTab: 'dorf' },
  { id: 'p5_harbor3', ch: 5, icon: '🚢', title: 'Der große Hafen', desc: 'Baue den Drachenhafen auf Stufe III aus.', metric: 'harbor', target: 3, goTab: 'dorf', extra: { rune: true } },

  { id: 'p6_stage5000', ch: 6, icon: '🌋', title: 'Ans Ende der Welt', desc: 'Erreiche Stufe 500-0.', metric: 'highest', target: 5000, goTab: 'kampf' },
  { id: 'p6_kills', ch: 6, icon: '⚔️', title: 'Eine Million Drachen', desc: 'Besiege 1.000.000 Drachen.', metric: 'kills', target: 1000000, goTab: 'kampf' },
  { id: 'p6_prestige10', ch: 6, icon: '🌠', title: 'Zehnfach aufgestiegen', desc: 'Erreiche Prestige 10.', metric: 'prestige', target: 10, goTab: 'prestige' },
  { id: 'p6_species', ch: 6, icon: '📚', title: 'Meisterzüchter', desc: 'Ziehe 30 verschiedene Arten groß.', metric: 'adultSpecies', target: 30, goTab: 'drachen', extra: { egg: true } },
  { id: 'p6_dex', ch: 6, icon: '🗂️', title: 'Vollständiges Wissen', desc: 'Entdecke 75 % aller Drachenarten.', metric: 'dexPct', target: 75, goTab: 'drachen' },
  { id: 'p6_soulbound', ch: 6, icon: '❤️', title: 'Seelengebunden', desc: 'Erreiche Bindung 10 mit einem Drachen.', metric: 'soulbound', target: 1, goTab: 'drachen' },
  { id: 'p6_divine', ch: 6, icon: '☀️', title: 'Göttliche Erweckung', desc: 'Erwecke einen Drachen zu seiner göttlichen Form.', metric: 'divineSpecies', target: 1, goTab: 'drachen' }
];

function bkmpPathValue(goal) {
  const fn = BKMP_PATH_METRICS[goal.metric];
  try { return fn ? Math.max(0, Number(fn()) || 0) : 0; } catch (e) { return 0; }
}
function bkmpPathClaimed(goalId) {
  return !!(typeof bkmpChronicle !== 'undefined' && bkmpChronicle && bkmpChronicle.path && bkmpChronicle.path[goalId]);
}
function bkmpPathGoalState(goal) {
  const value = bkmpPathValue(goal);
  const done = value >= goal.target;
  return { goal, value, done, claimed: bkmpPathClaimed(goal.id), pct: Math.max(0, Math.min(100, Math.floor((value / goal.target) * 100))) };
}
function bkmpPathAll() { return BKMP_PATH_GOALS.map(bkmpPathGoalState); }
function bkmpPathClaimable() { return bkmpPathAll().filter(g => g.done && !g.claimed); }
function bkmpPathClaimableCount() {
  if (typeof bkmpChronicleReady === 'function' && !bkmpChronicleReady()) return 0;
  return bkmpPathClaimable().length;
}
/* Die naechsten 3 offenen Ziele: zuerst niedrigeres Kapitel, dann der
   Fortschritt (am naechsten dran zuerst). */
function bkmpPathNextGoals(n) {
  return bkmpPathAll()
    .filter(g => !g.done)
    .sort((a, b) => (a.goal.ch - b.goal.ch) || (b.pct - a.pct))
    .slice(0, n || 3);
}

function bkmpPathReward(goal) {
  const u = typeof bkmpChronicleRewardUnits === 'function' ? bkmpChronicleRewardUnits() : { gold: 5, xp: 5, crystals: 2, essence: 1 };
  const c = goal.ch;
  const r = {
    gold: u.gold * 100 * c,
    xp: u.xp * 100 * c,
    crystals: u.crystals * 3 * c,
    essence: u.essence * 3 * c
  };
  const tier = typeof bkmpChronicleLootTierIdx === 'function' ? bkmpChronicleLootTierIdx() : 0;
  if (goal.extra && goal.extra.rune) { r.runes = 1; r.runeIdx = Math.min(3, tier + 1); }
  if (goal.extra && goal.extra.egg) { r.egg = true; r.eggIdx = Math.min(3, tier + 1); }
  return r;
}
function bkmpPathRewardText(goal) {
  const r = bkmpPathReward(goal);
  const f = typeof bkmpChronicleFmt === 'function' ? bkmpChronicleFmt : (n => String(n));
  const parts = [`💰 ${f(r.gold)}`, `${f(r.xp)} EP`, `💎 ${f(r.crystals)}`, `🧪 ${f(r.essence)}`];
  if (r.runes) parts.push('🔮 Rune');
  if (r.egg) parts.push('🥚 Ei');
  return parts.join(' · ');
}

let bkmpPathBusy = false;
async function bkmpPathClaim(goalIds) {
  if (bkmpPathBusy || typeof bkmpChronicle === 'undefined' || !bkmpChronicle) return;
  bkmpPathBusy = true;
  try {
    if (typeof bkmpChronicleRefreshFromServer === 'function') await bkmpChronicleRefreshFromServer();
    if (!bkmpChronicle.path) bkmpChronicle.path = {};
    const goals = (goalIds || []).map(id => BKMP_PATH_GOALS.find(g => g.id === id)).filter(Boolean)
      .map(bkmpPathGoalState).filter(g => g.done && !g.claimed);
    if (!goals.length) return;
    /* Erst als abgeholt markieren und speichern, dann gutschreiben. */
    goals.forEach(g => { bkmpChronicle.path[g.goal.id] = 1; });
    if (typeof bkmpChronicleMarkDirty === 'function') bkmpChronicleMarkDirty();
    if (typeof bkmpChronicleSaveNow === 'function') { try { await bkmpChronicleSaveNow(); } catch (e) { /* lokal gesichert */ } }
    const total = { gold: 0, xp: 0, crystals: 0, essence: 0, runes: 0, runeIdx: 0, egg: false, eggIdx: 0 };
    const extraEggs = [];
    goals.forEach(g => {
      const r = bkmpPathReward(g.goal);
      total.gold += r.gold; total.xp += r.xp; total.crystals += r.crystals; total.essence += r.essence;
      if (r.runes) { total.runes += r.runes; total.runeIdx = Math.max(total.runeIdx, r.runeIdx); }
      if (r.egg) extraEggs.push(r.eggIdx);
    });
    const parts = typeof bkmpChronicleGrant === 'function' ? bkmpChronicleGrant(total) : [];
    extraEggs.forEach(idx => {
      const p = typeof bkmpChronicleGrant === 'function' ? bkmpChronicleGrant({ egg: true, eggIdx: idx }) : [];
      parts.push(...p);
    });
    const head = goals.length === 1 ? `📖 ${goals[0].goal.title}` : `📖 ${goals.length} Pfad-Ziele abgeholt`;
    const text = `${head}: ${parts.join(' ')}`;
    if (typeof bkmpUiShowToast === 'function') bkmpUiShowToast({ text, kind: 'success', ms: 5200 });
    else if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(text, 5200);
  } finally {
    bkmpPathBusy = false;
    if (typeof bkmpChronicleRefreshUi === 'function') bkmpChronicleRefreshUi(true);
    if (typeof bkmpChronicleRenderModalBody === 'function') bkmpChronicleRenderModalBody();
  }
}

/* ---------- Darstellung (in der Chronik) ---------- */
function bkmpPathEsc(s) { return typeof bkmpChronicleEsc === 'function' ? bkmpChronicleEsc(s) : String(s == null ? '' : s); }
function bkmpPathGoalRowHtml(g, compact) {
  const f = typeof bkmpChronicleFmt === 'function' ? bkmpChronicleFmt : (n => String(n));
  let action;
  if (g.claimed) action = '<span class="bkmp-path-done">✅</span>';
  else if (g.done) action = `<button type="button" class="btn-ja bkmp-path-claim-btn" data-chron-action="pathclaim" data-goal-id="${g.goal.id}">Abholen</button>`;
  else if (g.goal.chronTab) action = `<button type="button" class="bkmp-chron-go-btn" data-chron-action="chrontab" data-tab-id="${g.goal.chronTab}">Ansehen</button>`;
  else action = `<button type="button" class="bkmp-chron-go-btn" data-chron-action="goto" data-tab="${g.goal.goTab}">Los →</button>`;
  const progress = g.goal.target > 1 ? `${f(Math.min(g.value, g.goal.target))} / ${f(g.goal.target)}` : (g.done ? 'erfüllt' : 'offen');
  return `
    <div class="bkmp-chron-goal bkmp-path-goal${g.done ? ' is-ready' : ''}${g.claimed ? ' is-claimed' : ''}" data-path-goal="${g.goal.id}">
      <div class="bkmp-chron-goal-icon" aria-hidden="true">${g.goal.icon}</div>
      <div class="bkmp-chron-goal-main">
        <div class="bkmp-chron-goal-title">${bkmpPathEsc(g.goal.title)}${compact ? ` <small class="bkmp-path-ch">Kapitel ${BKMP_PATH_CHAPTERS[g.goal.ch - 1].roman}</small>` : ''}</div>
        <div class="bkmp-chron-goal-detail">${bkmpPathEsc(g.goal.desc)} · ${progress}</div>
        ${!g.claimed ? `<div class="idle-chron-bar"><span class="idle-chron-bar-fill" style="width:${g.done ? 100 : g.pct}%"></span></div>` : ''}
        ${!compact && !g.claimed ? `<div class="bkmp-path-reward">${bkmpPathEsc(bkmpPathRewardText(g.goal))}</div>` : ''}
      </div>
      ${action}
    </div>`;
}
/* Prominenter Block ganz oben im Auftrags-Reiter. */
function bkmpPathNextGoalsHtml() {
  const claimable = bkmpPathClaimable().length;
  const next = bkmpPathNextGoals(3);
  if (!next.length && !claimable) return '';
  return `
    <div class="bkmp-path-next" data-testid="path-next">
      <div class="bkmp-path-next-head">
        <strong>🎯 Deine nächsten Ziele</strong>
        ${claimable ? `<button type="button" class="btn-ja bkmp-path-claimall" data-chron-action="pathclaimall">🎁 ${claimable} ${claimable === 1 ? 'Belohnung' : 'Belohnungen'} abholen</button>` : ''}
      </div>
      ${next.map(g => bkmpPathGoalRowHtml(g, true)).join('')}
      <button type="button" class="bkmp-chron-go-btn bkmp-path-more" data-chron-action="chrontab" data-tab-id="path">📖 Ganzen Pfad ansehen</button>
    </div>`;
}
function bkmpPathHtml() {
  const all = bkmpPathAll();
  const claimable = all.filter(g => g.done && !g.claimed).length;
  const doneCount = all.filter(g => g.done).length;
  return `
    <div class="bkmp-path" data-testid="path-tab">
      <div class="bkmp-path-summary">
        <span>📖 Pfad des Drachendorfs: <strong>${doneCount}/${all.length}</strong> Ziele erreicht</span>
        ${claimable ? `<button type="button" class="btn-ja bkmp-path-claimall" data-chron-action="pathclaimall" data-testid="path-claimall">🎁 Alle Belohnungen abholen (${claimable})</button>` : ''}
      </div>
      ${BKMP_PATH_CHAPTERS.map(ch => {
        const goals = all.filter(g => g.goal.ch === ch.id);
        const chDone = goals.filter(g => g.done).length;
        return `
          <section class="bkmp-path-chapter">
            <h4>${ch.icon} Kapitel ${ch.roman} – ${bkmpPathEsc(ch.title)} <small>(${chDone}/${goals.length})</small></h4>
            ${goals.map(g => bkmpPathGoalRowHtml(g, false)).join('')}
          </section>`;
      }).join('')}
    </div>`;
}
