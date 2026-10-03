/* ============================================================
   Drachen-Expeditionen (Drachendorf-Ausbau Phase 3, 04.10.2026)

   Abschnitt "⚓ Drachenhafen – Expeditionen" im Drachenzucht-Reiter plus
   Planungsfenster (Region -> Mission -> Team -> Vorschau -> Start) und
   Ergebnisfenster beim Abholen.

   Server ist massgeblich (sql/20261004-03-expeditions.sql): er prueft das
   Team, wuerfelt Qualitaet/Ereignisse und schreibt beim Abholen einmalig
   gut. Der Client zeigt nur eine Vorschau mit denselben Regeln
   (js/systems/bkmp-expedition-rules.js) und spiegelt Gutschriften lokal.
   Runen/Eier werden - wie bei Dungeon-Funden - nach dem bestaetigten
   Abholen clientseitig ausgewuerfelt.
   ============================================================ */

let bkmpExpCatalog = null;       // { regions, missions, events }
let bkmpExpStatus = null;        // { harbor_level, slots, expeditions, offsetMs }
let bkmpExpDbMissing = false;
let bkmpExpLoading = null;
let bkmpExpStatusLoadedAt = 0;
let bkmpExpBusy = false;
let bkmpExpPlanner = { regionId: null, missionId: null, dragonIds: [] };
let bkmpExpTickTimer = null;
let bkmpExpBadgeTimer = null;
let bkmpExpLastReadyCount = -1;
let bkmpExpLastFailAt = 0;      // verhindert Dauer-Neuversuche bei Netzwerkfehlern

/* Eigenschaften (Phase 4) - Anzeigenamen; die Liste selbst kommt dort dazu. */
const BKMP_EXP_TRAIT_LABELS_FALLBACK = {};

function bkmpExpTraitLabels() {
  return (typeof BKMP_DRAGON_TRAIT_LABELS !== 'undefined' && BKMP_DRAGON_TRAIT_LABELS) || BKMP_EXP_TRAIT_LABELS_FALLBACK;
}
function bkmpExpEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }
function bkmpExpFmt(n) { return typeof bkmpIdleFormatNumber === 'function' ? bkmpIdleFormatNumber(n) : String(Math.round(Number(n) || 0)); }
function bkmpExpToast(text, kind) {
  if (typeof bkmpUiShowToast === 'function') bkmpUiShowToast({ text, kind: kind || 'info', ms: 3600 });
  else if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(text, 3600);
}
function bkmpExpNow() { return Date.now() + ((bkmpExpStatus && bkmpExpStatus.offsetMs) || 0); }
function bkmpExpGoldUnit() {
  const stage = Number((bkmpIdleState || {}).highest_dragon_index || 0);
  return Math.max(6, Math.round(6 * Math.pow(1 + 0.05 * Math.max(0, stage), 1.2)));
}

/* ---------- Abfragen fuer andere Systeme ---------- */
function bkmpExpRunning() { return (bkmpExpStatus && bkmpExpStatus.expeditions) || []; }
function bkmpExpIsDragonOnExpedition(dragonId) {
  return bkmpExpRunning().some(e => (e.dragon_ids || []).includes(dragonId));
}
function bkmpExpIsFinished(exp) { return Date.parse(exp.ends_at) <= bkmpExpNow(); }
function bkmpExpReadyCount() { return bkmpExpRunning().filter(bkmpExpIsFinished).length; }
function bkmpExpRegion(id) { return ((bkmpExpCatalog && bkmpExpCatalog.regions) || []).find(r => r.id === id) || null; }
function bkmpExpMission(id) { return ((bkmpExpCatalog && bkmpExpCatalog.missions) || []).find(m => m.id === id) || null; }

/* ---------- Laden ---------- */
async function bkmpExpEnsureLoaded(force) {
  if (bkmpExpLoading) return bkmpExpLoading;
  if (!force && bkmpExpStatus && Date.now() - bkmpExpStatusLoadedAt < 60000) return;
  if (typeof loadExpeditionCatalog !== 'function' || typeof bkmpExpeditionStatusRpc !== 'function') return;
  bkmpExpLoading = (async () => {
    try {
      if (!bkmpExpCatalog) {
        const cat = await loadExpeditionCatalog();
        if (cat.missing) { bkmpExpDbMissing = true; return; }
        bkmpExpCatalog = cat;
      }
      const st = await bkmpExpeditionStatusRpc();
      if (st.missing) { bkmpExpDbMissing = true; return; }
      const serverNow = Date.parse(st.server_now || '') || Date.now();
      bkmpExpStatus = {
        harbor_level: Number(st.harbor_level) || 0,
        slots: Number(st.slots) || 0,
        expeditions: st.expeditions || [],
        offsetMs: serverNow - Date.now()
      };
      bkmpExpStatusLoadedAt = Date.now();
    } catch (e) {
      /* Ruhig bleiben - der Abschnitt zeigt einfach den letzten bekannten Stand. */
      bkmpExpLastFailAt = Date.now();
    } finally {
      bkmpExpLoading = null;
    }
  })();
  return bkmpExpLoading;
}

function bkmpExpRefreshDragonsPanel() {
  if (typeof bkmpIdleActiveTab !== 'undefined' && bkmpIdleActiveTab === 'drachen' && typeof bkmpIdleRenderDragonsPanel === 'function') {
    bkmpIdleRenderDragonsPanel();
  }
}

/* Beim Oeffnen des Idle-Dorfs (idledorf.js): Status leise nachladen, damit
   das "fertig"-Signal am Drachenzucht-Reiter auch ohne Besuch stimmt. */
function bkmpExpOnIdleOpen() {
  bkmpExpEnsureLoaded(false).then(() => { bkmpExpUpdateBadge(); bkmpExpStartBadgeTimer(); }).catch(() => {});
}

/* ---------- "Fertig"-Signal am Reiter ---------- */
function bkmpExpUpdateBadge() {
  const ready = bkmpExpReadyCount();
  if (ready === bkmpExpLastReadyCount) return;
  bkmpExpLastReadyCount = ready;
  document.querySelectorAll('#idleTabBtnDrachen, [data-proto-real-btn="idleTabBtnDrachen"]').forEach(el => {
    el.classList.toggle('dd-has-ready', ready > 0);
    if (ready > 0) el.setAttribute('data-ready-count', String(ready)); else el.removeAttribute('data-ready-count');
  });
}
function bkmpExpStartBadgeTimer() {
  if (bkmpExpBadgeTimer || !bkmpExpRunning().length) return;
  bkmpExpBadgeTimer = window.setInterval(() => {
    if (!bkmpExpRunning().length) { window.clearInterval(bkmpExpBadgeTimer); bkmpExpBadgeTimer = null; return; }
    const before = bkmpExpLastReadyCount;
    bkmpExpUpdateBadge();
    if (bkmpExpLastReadyCount !== before) bkmpExpRefreshDragonsPanel();
  }, 15000);
}

/* ---------- Abschnitt im Drachenzucht-Reiter ---------- */
function bkmpExpFormatRemaining(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h} Std. ${String(m).padStart(2, '0')} Min.` : `${m}:${String(sec).padStart(2, '0')} Min.`;
}

function bkmpExpDragonBadgeHtml(dragonId) {
  if (!bkmpExpIsDragonOnExpedition(dragonId)) return '';
  return '<div class="dd-exp-away-badge">⚓ Auf Expedition</div>';
}

function bkmpExpDragonThumb(d) {
  const sp = typeof bkmpDragonSpeciesById === 'function' ? bkmpDragonSpeciesById(d.species_id) : null;
  if (!sp || typeof bkmpDragonThumbHtml !== 'function') return '🐉';
  return bkmpDragonThumbHtml(bkmpDragonStageImage(sp, d.stage), bkmpExpEsc(sp.name), 'dd-exp-thumb');
}

function bkmpExpSectionHtml() {
  if (bkmpExpDbMissing) return '';
  if (!bkmpExpStatus) {
    if (Date.now() - bkmpExpLastFailAt > 30000) bkmpExpEnsureLoaded(false).then(() => { if (bkmpExpStatus || bkmpExpDbMissing) bkmpExpRefreshDragonsPanel(); }).catch(() => {});
    return `<div class="idle-dragon-section dd-exp-section"><h4>⚓ Drachenhafen – Expeditionen</h4><p class="dd-muted">⏳ Wird geladen…</p></div>`;
  }
  if (bkmpExpStatus.harbor_level < 1) {
    return `
      <div class="idle-dragon-section dd-exp-section" data-testid="exp-section">
        <h4>⚓ Drachenhafen – Expeditionen</h4>
        <p class="dd-muted">Schicke deine erwachsenen Drachen auf Expeditionen in ferne Regionen – sie bringen Ressourcen, Runen und manchmal sogar Eier mit. Dafür brauchst du zuerst den Drachenhafen.</p>
        <button type="button" class="btn-ja dd-exp-goto-dorf" data-exp-goto-dorf="1">🏗️ Zur Dorfentwicklung</button>
      </div>`;
  }
  const running = bkmpExpRunning();
  const dragonsById = {};
  (typeof bkmpPlayerDragons !== 'undefined' ? bkmpPlayerDragons : []).forEach(d => { dragonsById[d.id] = d; });
  const cards = running.map(exp => {
    const mission = bkmpExpMission(exp.mission_id);
    const region = bkmpExpRegion(exp.region_id);
    const done = bkmpExpIsFinished(exp);
    const thumbs = (exp.dragon_ids || []).map(id => dragonsById[id] ? bkmpExpDragonThumb(dragonsById[id]) : '🐉').join('');
    return `
      <div class="dd-exp-card${done ? ' is-ready' : ''}" data-testid="exp-running-${bkmpExpEsc(exp.id)}">
        <div class="dd-exp-card-head"><span class="dd-exp-card-region">${bkmpExpEsc(region ? region.icon + ' ' + region.name : exp.region_id)}</span></div>
        <div class="dd-exp-card-mission">${bkmpExpEsc(mission ? mission.name : exp.mission_id)}</div>
        <div class="dd-exp-team">${thumbs}</div>
        ${done
          ? `<button type="button" class="btn-ja dd-exp-claim-btn" data-exp-claim="${bkmpExpEsc(exp.id)}" ${bkmpExpBusy ? 'disabled' : ''}>🎁 Abholen</button>`
          : `<div class="dd-exp-countdown">⏳ <span data-exp-countdown="${bkmpExpEsc(exp.id)}">${bkmpExpFormatRemaining(Date.parse(exp.ends_at) - bkmpExpNow())}</span></div>`}
      </div>`;
  });
  if (running.length) bkmpExpEnsureTicker();
  const free = Math.max(0, bkmpExpStatus.slots - running.length);
  for (let i = 0; i < free; i++) {
    cards.push(`<button type="button" class="dd-exp-card dd-exp-card-free" data-exp-plan="1" data-testid="exp-plan-btn">＋ Neue Expedition</button>`);
  }
  return `
    <div class="idle-dragon-section dd-exp-section" data-testid="exp-section">
      <h4>⚓ Drachenhafen – Expeditionen (${running.length}/${bkmpExpStatus.slots})</h4>
      <div class="dd-exp-grid">${cards.join('')}</div>
    </div>`;
}

/* ---------- Planungsfenster ---------- */
function bkmpExpAvailableDragons() {
  const list = typeof bkmpPlayerDragons !== 'undefined' ? bkmpPlayerDragons : [];
  const grown = d => (typeof bkmpDragonIsGrown === 'function' ? bkmpDragonIsGrown(d) : d.stage === 'adult');
  return list.filter(d => grown(d) && !d.is_companion && !bkmpExpIsDragonOnExpedition(d.id));
}
function bkmpExpTeamMember(d) {
  const sp = typeof bkmpDragonSpeciesById === 'function' ? bkmpDragonSpeciesById(d.species_id) : null;
  return {
    species_id: d.species_id,
    rarity: sp ? sp.rarity : 'standard',
    affinities: (sp && Array.isArray(sp.affinities)) ? sp.affinities : [],
    trait: d.trait || null,
    bond_level: typeof bkmpDragonBondLevel === 'function' ? bkmpDragonBondLevel(d.bond_xp) : 1
  };
}
function bkmpExpAffinityIcons(affs) {
  if (typeof BKMP_AFFINITY_META === 'undefined') return '';
  return (affs || []).map(a => BKMP_AFFINITY_META[a] ? `<span class="dd-aff" title="${BKMP_AFFINITY_META[a].label}">${BKMP_AFFINITY_META[a].icon}</span>` : '').join('');
}

/* "Team vorschlagen": beste Kombination nach Missions-Passung (nicht nach
   Kampfkraft) - Pflichtbedingungen zuerst, dann Punktzahl. */
function bkmpExpSuggestTeam(mission) {
  if (!mission || typeof bkmpExpeditionTeamEval !== 'function') return [];
  const pool = bkmpExpAvailableDragons().slice(0, 60);
  const size = Number(mission.team_size);
  if (pool.length < size) return [];
  let best = null;
  const pick = (start, chosen) => {
    if (chosen.length === size) {
      const ev = bkmpExpeditionTeamEval(mission, chosen.map(bkmpExpTeamMember));
      const key = (ev.unmet.length ? -1000 * ev.unmet.length : 0) + ev.score;
      if (!best || key > best.key) best = { key, ids: chosen.map(d => d.id) };
      return;
    }
    for (let i = start; i < pool.length; i++) pick(i + 1, chosen.concat([pool[i]]));
  };
  pick(0, []);
  return best ? best.ids : [];
}

function bkmpExpRewardPreviewHtml(mission) {
  const rw = (mission && mission.rewards) || {};
  const unit = bkmpExpGoldUnit();
  const parts = [];
  if (rw.gold_units) parts.push(`💰 ${bkmpExpFmt(rw.gold_units * unit)}`);
  if (rw.wood) parts.push(`🌳 ${bkmpExpFmt(rw.wood)}`);
  if (rw.stone) parts.push(`🗿 ${bkmpExpFmt(rw.stone)}`);
  if (rw.crystals) parts.push(`💎 ${bkmpExpFmt(rw.crystals)}`);
  if (rw.essence) parts.push(`🧪 ${bkmpExpFmt(rw.essence)}`);
  if (rw.fruit) parts.push(`🍎 ${bkmpExpFmt(rw.fruit)}`);
  if (rw.meat) parts.push(`🥩 ${bkmpExpFmt(rw.meat)}`);
  if (rw.rune_chance) parts.push(rw.rune_chance >= 1 ? `🔮 ${Math.floor(rw.rune_chance)}× Rune${rw.rune_chance % 1 ? ' + Chance' : ''}` : `🔮 ${Math.round(rw.rune_chance * 100)} % Rune`);
  if (rw.egg_chance) parts.push(`🥚 ${Math.round(rw.egg_chance * 100)} % Ei`);
  return parts.join(' · ');
}

function bkmpExpPlannerBodyHtml() {
  const harbor = bkmpExpStatus ? bkmpExpStatus.harbor_level : 0;
  const regions = (bkmpExpCatalog && bkmpExpCatalog.regions) || [];
  if (!bkmpExpPlanner.regionId) {
    const firstOpen = regions.find(r => harbor >= Number(r.min_harbor_level));
    bkmpExpPlanner.regionId = firstOpen ? firstOpen.id : null;
  }
  const regionChips = regions.map(r => {
    const locked = harbor < Number(r.min_harbor_level);
    return `<button type="button" class="dd-exp-region-chip${r.id === bkmpExpPlanner.regionId ? ' active' : ''}${locked ? ' is-locked' : ''}" data-exp-region="${bkmpExpEsc(r.id)}" ${locked ? `title="Benötigt Drachenhafen ${'I'.repeat(Number(r.min_harbor_level))}"` : ''}>${bkmpExpEsc(r.icon)} ${bkmpExpEsc(r.name)}${locked ? ' 🔒' : ''}</button>`;
  }).join('');
  const region = bkmpExpRegion(bkmpExpPlanner.regionId);
  const regionLocked = !region || harbor < Number(region.min_harbor_level);
  const missions = ((bkmpExpCatalog && bkmpExpCatalog.missions) || []).filter(m => region && m.region_id === region.id);
  let missionHtml = '';
  if (regionLocked) {
    missionHtml = `<p class="dd-muted">🔒 Diese Region erreichst du mit einem größeren Drachenhafen (🏗️ Dorfentwicklung).</p>`;
  } else {
    missionHtml = `<p class="dd-muted dd-exp-region-desc">${bkmpExpEsc(region.description)}</p><div class="dd-exp-mission-list">${missions.map(m => `
      <button type="button" class="dd-exp-mission${m.id === bkmpExpPlanner.missionId ? ' active' : ''}" data-exp-mission="${bkmpExpEsc(m.id)}" data-testid="exp-mission-${bkmpExpEsc(m.id)}">
        <span class="dd-exp-mission-name">${bkmpExpEsc(m.name)}</span>
        <span class="dd-exp-mission-meta">⏱️ ${m.duration_hours} Std. · 🐉 ${m.team_size} ${m.team_size === 1 ? 'Drache' : 'Drachen'}</span>
        <span class="dd-exp-mission-rewards">${bkmpExpRewardPreviewHtml(m)}</span>
      </button>`).join('')}</div>`;
  }
  const mission = bkmpExpMission(bkmpExpPlanner.missionId);
  let teamHtml = '';
  if (mission && !regionLocked && mission.region_id === region.id) {
    const available = bkmpExpAvailableDragons();
    const selected = bkmpExpPlanner.dragonIds.map(id => available.find(d => d.id === id)).filter(Boolean);
    bkmpExpPlanner.dragonIds = selected.map(d => d.id);
    const team = selected.map(bkmpExpTeamMember);
    const ev = typeof bkmpExpeditionTeamEval === 'function' ? bkmpExpeditionTeamEval(mission, team) : { unmet: [], met: [], score: 0 };
    const reqLines = typeof bkmpExpeditionRequirementLines === 'function' ? bkmpExpeditionRequirementLines(mission) : [];
    const recs = mission.recommendations || [];
    const fullTeam = selected.length === Number(mission.team_size);
    const qLow = typeof bkmpExpeditionQuality === 'function' ? bkmpExpeditionQuality(ev.score) : 1;
    const qHigh = typeof bkmpExpeditionQuality === 'function' ? bkmpExpeditionQuality(ev.score + 20) : 1;
    const qMeta = q => (typeof BKMP_EXPEDITION_QUALITY !== 'undefined' && BKMP_EXPEDITION_QUALITY[q]) || { stars: '⭐', label: '' };
    const canStart = fullTeam && !ev.unmet.length && !bkmpExpBusy;
    const dragonRows = available.length ? available.map(d => {
      const sp = typeof bkmpDragonSpeciesById === 'function' ? bkmpDragonSpeciesById(d.species_id) : null;
      if (!sp) return '';
      const rarity = typeof bkmpDragonRarityMeta === 'function' ? bkmpDragonRarityMeta(sp.rarity) : { name: sp.rarity, color: '#999' };
      const isSel = bkmpExpPlanner.dragonIds.includes(d.id);
      const bond = typeof bkmpDragonBondLevel === 'function' ? bkmpDragonBondLevel(d.bond_xp) : 1;
      const traitLabel = d.trait ? (bkmpExpTraitLabels()[d.trait] || d.trait) : '';
      return `
        <button type="button" class="dd-exp-dragon${isSel ? ' is-selected' : ''}" style="--dragon-rarity-color:${rarity.color}" data-exp-dragon="${bkmpExpEsc(d.id)}">
          ${bkmpExpDragonThumb(d)}
          <span class="dd-exp-dragon-name">${bkmpExpEsc(d.nickname || sp.name)}</span>
          <span class="dd-exp-dragon-meta">${bkmpExpEsc(rarity.name)} ${bkmpExpAffinityIcons(sp.affinities)}</span>
          <span class="dd-exp-dragon-meta">💞 ${bond}${traitLabel ? ' · ' + bkmpExpEsc(traitLabel) : ''}</span>
        </button>`;
    }).join('') : `<p class="dd-muted">Keine freien erwachsenen Drachen. Drachen im Kampf oder auf Expedition können nicht mit.</p>`;
    teamHtml = `
      <div class="dd-exp-planner-team">
        <div class="dd-section-head"><h4>Team (${selected.length}/${mission.team_size})</h4><button type="button" class="btn-nein dd-exp-suggest-btn" data-exp-suggest="1">✨ Team vorschlagen</button></div>
        <ul class="dd-exp-checklist">
          ${reqLines.length ? reqLines.map(l => `<li class="${ev.unmet.includes(l.key) ? 'is-missing' : 'is-ok'}">${ev.unmet.includes(l.key) ? '❌' : '✅'} ${bkmpExpEsc(l.text)} <small>(Pflicht)</small></li>`).join('') : '<li class="is-ok">✅ Keine Pflichtbedingungen</li>'}
          ${recs.map((r, i) => `<li class="${ev.met.includes(i) ? 'is-ok' : 'is-optional'}">${ev.met.includes(i) ? '✅' : '○'} ${bkmpExpEsc(typeof bkmpExpeditionRecommendationText === 'function' ? bkmpExpeditionRecommendationText(r, bkmpExpTraitLabels()) : r.type)} <small>(Empfehlung)</small></li>`).join('')}
        </ul>
        <div class="dd-exp-quality" data-testid="exp-quality">Erwartete Qualität: <strong>${fullTeam ? (qLow === qHigh ? `${qMeta(qLow).stars} ${qMeta(qLow).label}` : `${qMeta(qLow).stars} bis ${qMeta(qHigh).stars}`) : '–'}</strong></div>
        <div class="dd-exp-dragon-grid">${dragonRows}</div>
      </div>
      <button type="button" class="btn-ja dd-exp-start-btn" data-exp-start="1" data-testid="exp-start-btn" ${canStart ? '' : 'disabled'}>⚓ Expedition starten (${mission.duration_hours} Std.)</button>`;
  } else if (!regionLocked) {
    teamHtml = `<p class="dd-muted">Wähle eine Mission.</p>`;
  }
  return `
    <div class="dd-exp-planner">
      <div class="dd-exp-region-chips">${regionChips}</div>
      ${missionHtml}
      ${teamHtml}
    </div>`;
}

function bkmpExpEnsurePlannerInDom() {
  if (document.getElementById('idleExpPlannerOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', bkmpUiModalHtml({
    id: 'idleExpPlanner',
    titleHtml: '⚓ Neue Expedition',
    bodyHtml: '<div id="idleExpPlannerBody" class="dd-exp-planner-body"></div>',
    buttonsHtml: '<button type="button" class="btn-nein" data-exp-close="1">Schließen</button>',
    extraClass: 'dd-exp-modal-card'
  }));
  const overlay = document.getElementById('idleExpPlannerOverlay');
  overlay.classList.add('zone-game');
  if (typeof bkmpUiTrapFocus === 'function') bkmpUiTrapFocus(overlay);
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-exp-close]')) { overlay.classList.remove('visible'); return; }
    const regionBtn = e.target.closest('[data-exp-region]');
    if (regionBtn) { bkmpExpPlanner.regionId = regionBtn.getAttribute('data-exp-region'); bkmpExpPlanner.missionId = null; bkmpExpPlanner.dragonIds = []; bkmpExpRenderPlanner(); return; }
    const missionBtn = e.target.closest('[data-exp-mission]');
    if (missionBtn) { bkmpExpPlanner.missionId = missionBtn.getAttribute('data-exp-mission'); bkmpExpPlanner.dragonIds = []; bkmpExpRenderPlanner(); return; }
    const dragonBtn = e.target.closest('[data-exp-dragon]');
    if (dragonBtn) { bkmpExpToggleDragon(dragonBtn.getAttribute('data-exp-dragon')); return; }
    if (e.target.closest('[data-exp-suggest]')) {
      const ids = bkmpExpSuggestTeam(bkmpExpMission(bkmpExpPlanner.missionId));
      if (!ids.length) bkmpExpToast('Nicht genug freie erwachsene Drachen für diese Mission.', 'warning');
      bkmpExpPlanner.dragonIds = ids;
      bkmpExpRenderPlanner();
      return;
    }
    const startBtn = e.target.closest('[data-exp-start]');
    if (startBtn && !startBtn.disabled) bkmpExpStart();
  });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.classList.remove('visible'); });
}
function bkmpExpRenderPlanner() {
  const body = document.getElementById('idleExpPlannerBody');
  if (body) body.innerHTML = bkmpExpPlannerBodyHtml();
}
function bkmpExpToggleDragon(id) {
  const mission = bkmpExpMission(bkmpExpPlanner.missionId);
  if (!mission) return;
  const idx = bkmpExpPlanner.dragonIds.indexOf(id);
  if (idx >= 0) bkmpExpPlanner.dragonIds.splice(idx, 1);
  else if (bkmpExpPlanner.dragonIds.length >= Number(mission.team_size)) {
    if (Number(mission.team_size) === 1) bkmpExpPlanner.dragonIds = [id];
    else { bkmpExpToast(`Das Team ist voll (${mission.team_size} Drachen).`, 'warning'); return; }
  } else bkmpExpPlanner.dragonIds.push(id);
  bkmpExpRenderPlanner();
}
async function bkmpExpOpenPlanner() {
  await bkmpExpEnsureLoaded(false);
  if (!bkmpExpCatalog || !bkmpExpStatus) { bkmpExpToast('Expeditionen sind gerade nicht verfügbar.', 'warning'); return; }
  bkmpExpEnsurePlannerInDom();
  bkmpExpRenderPlanner();
  document.getElementById('idleExpPlannerOverlay').classList.add('visible');
}

/* ---------- Starten / Abholen ---------- */
async function bkmpExpStart() {
  const mission = bkmpExpMission(bkmpExpPlanner.missionId);
  if (bkmpExpBusy || !mission) return;
  bkmpExpBusy = true;
  bkmpExpRenderPlanner();
  try {
    const res = await bkmpExpeditionStartRpc(mission.id, bkmpExpPlanner.dragonIds.slice());
    if (res && bkmpExpStatus) {
      bkmpExpStatus.expeditions = bkmpExpRunning().concat([{
        id: res.id, mission_id: res.mission_id, region_id: res.region_id,
        dragon_ids: res.dragon_ids || bkmpExpPlanner.dragonIds.slice(), started_at: res.started_at, ends_at: res.ends_at, status: 'running'
      }]);
      const overlay = document.getElementById('idleExpPlannerOverlay');
      if (overlay) overlay.classList.remove('visible');
      bkmpExpPlanner.dragonIds = [];
      bkmpExpToast(`⚓ ${mission.name}: Das Team ist aufgebrochen!`, 'success');
      bkmpExpStartBadgeTimer();
    }
  } catch (e) {
    bkmpExpToast(e.message || String(e), 'danger');
    bkmpExpEnsureLoaded(true).catch(() => {});
  }
  bkmpExpBusy = false;
  bkmpExpRenderPlanner();
  bkmpExpRefreshDragonsPanel();
}

function bkmpExpApplyClaimLocally(res, exp) {
  const rw = res.rewards || {};
  if (bkmpIdleState) {
    ['gold', 'wood', 'stone', 'crystals', 'essence', 'fruit', 'meat'].forEach(k => {
      const n = Number(rw[k] || 0);
      if (n) bkmpIdleState[k] = Number(bkmpIdleState[k] || 0) + n;
    });
    if (rw.gold) bkmpIdleState.total_gold_earned = Number(bkmpIdleState.total_gold_earned || 0) + Number(rw.gold);
    if (typeof bkmpIdleRenderHud === 'function') bkmpIdleRenderHud();
    if (typeof bkmpIdleQueueSync === 'function') bkmpIdleQueueSync();
  }
  const runes = Number(rw.runes || 0);
  if (runes > 0 && typeof bkmpDungeonRollRune === 'function' && typeof bkmpDungeonPersistRunes === 'function') {
    const list = [];
    for (let i = 0; i < runes; i++) { const r = bkmpDungeonRollRune(Number(rw.rune_tier || 0)); if (r) list.push(r); }
    if (list.length) bkmpDungeonPersistRunes(list);
  }
  const eggs = Number(rw.eggs || 0);
  if (eggs > 0 && typeof bkmpDungeonRollEgg === 'function' && typeof bkmpDungeonPersistEgg === 'function') {
    for (let i = 0; i < eggs; i++) { const egg = bkmpDungeonRollEgg(Number(rw.egg_tier || 0)); if (egg) bkmpDungeonPersistEgg(egg); }
  }
  if (typeof bkmpPlayerDragons !== 'undefined' && exp) {
    bkmpPlayerDragons.forEach(d => {
      if (!(exp.dragon_ids || []).includes(d.id)) return;
      d.expeditions_completed = Number(d.expeditions_completed || 0) + 1;
      d.bond_xp = Number(d.bond_xp || 0) + Number(rw.bond_xp || 0);
    });
  }
}

function bkmpExpShowResult(res, exp) {
  const rw = res.rewards || {};
  const q = (typeof BKMP_EXPEDITION_QUALITY !== 'undefined' && BKMP_EXPEDITION_QUALITY[res.quality]) || { stars: '⭐', label: 'Erfolgreich' };
  const mission = exp ? bkmpExpMission(exp.mission_id) : null;
  const lines = [];
  if (rw.gold) lines.push(`💰 ${bkmpExpFmt(rw.gold)} Gold`);
  if (rw.wood) lines.push(`🌳 ${bkmpExpFmt(rw.wood)} Holz`);
  if (rw.stone) lines.push(`🗿 ${bkmpExpFmt(rw.stone)} Stein`);
  if (rw.crystals) lines.push(`💎 ${bkmpExpFmt(rw.crystals)} Kristalle`);
  if (rw.essence) lines.push(`🧪 ${bkmpExpFmt(rw.essence)} Essenz`);
  if (rw.fruit) lines.push(`🍎 ${bkmpExpFmt(rw.fruit)} Früchte`);
  if (rw.meat) lines.push(`🥩 ${bkmpExpFmt(rw.meat)} Fleisch`);
  if (rw.runes) lines.push(`🔮 ${rw.runes}× Rune`);
  if (rw.eggs) lines.push(`🥚 ${rw.eggs}× Drachenei`);
  if (rw.bond_xp) lines.push(`💞 +${rw.bond_xp} Bindung für das Team`);
  const events = (res.events || []).map(ev => `<li><strong>${bkmpExpEsc(ev.icon)} ${bkmpExpEsc(ev.name)}</strong><br><span class="dd-muted">${bkmpExpEsc(ev.description)}</span></li>`).join('');
  const old = document.getElementById('idleExpResultOverlay');
  if (old) old.remove();
  document.body.insertAdjacentHTML('beforeend', bkmpUiModalHtml({
    id: 'idleExpResult',
    titleHtml: `${q.stars} ${bkmpExpEsc(q.label)}`,
    bodyHtml: `
      <p class="dd-muted">${bkmpExpEsc(mission ? mission.name : 'Expedition')} ist zurück!</p>
      ${events ? `<ul class="dd-exp-events">${events}</ul>` : ''}
      <ul class="dd-exp-reward-list" data-testid="exp-result-rewards">${lines.map(l => `<li>${l}</li>`).join('')}</ul>`,
    buttonsHtml: '<button type="button" class="btn-ja" data-exp-result-close="1">Super!</button>',
    extraClass: 'dd-exp-modal-card'
  }));
  const overlay = document.getElementById('idleExpResultOverlay');
  overlay.classList.add('zone-game');
  overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('[data-exp-result-close]')) overlay.remove(); });
  overlay.classList.add('visible');
}

async function bkmpExpClaim(expeditionId) {
  if (bkmpExpBusy) return;
  const exp = bkmpExpRunning().find(e => e.id === expeditionId);
  bkmpExpBusy = true;
  bkmpExpRefreshDragonsPanel();
  try {
    /* Server schreibt gut - vorher lokal Gespeichertes sichern (wie beim Dorfbau). */
    if (typeof bkmpIdleFlushSyncNow === 'function') { try { await bkmpIdleFlushSyncNow(); } catch (e) { /* weiter */ } }
    const res = await bkmpExpeditionClaimRpc(expeditionId);
    if (bkmpExpStatus) bkmpExpStatus.expeditions = bkmpExpRunning().filter(e => e.id !== expeditionId);
    if (res && res.newly_claimed) {
      bkmpExpApplyClaimLocally(res, exp);
      bkmpExpShowResult(res, exp);
    } else {
      bkmpExpToast('Diese Expedition wurde bereits abgeholt.', 'info');
    }
  } catch (e) {
    bkmpExpToast(e.message || String(e), 'danger');
    bkmpExpEnsureLoaded(true).catch(() => {});
  }
  bkmpExpBusy = false;
  bkmpExpLastReadyCount = -1;
  bkmpExpUpdateBadge();
  bkmpExpRefreshDragonsPanel();
}

/* ---------- Sekunden-Countdown (nur Textknoten, kein Neuaufbau) ---------- */
function bkmpExpTick() {
  const nodes = document.querySelectorAll('[data-exp-countdown]');
  if (!nodes.length) return;
  let finishedNow = false;
  nodes.forEach(node => {
    const exp = bkmpExpRunning().find(e => e.id === node.getAttribute('data-exp-countdown'));
    if (!exp) return;
    const left = Date.parse(exp.ends_at) - bkmpExpNow();
    if (left <= 0) finishedNow = true;
    else node.textContent = bkmpExpFormatRemaining(left);
  });
  if (finishedNow) { bkmpExpLastReadyCount = -1; bkmpExpUpdateBadge(); bkmpExpRefreshDragonsPanel(); }
}
function bkmpExpEnsureTicker() {
  if (bkmpExpTickTimer) return;
  bkmpExpTickTimer = window.setInterval(() => {
    const panelVisible = typeof bkmpIdleActiveTab !== 'undefined' && bkmpIdleActiveTab === 'drachen'
      && document.getElementById('idleDorfOverlay') && document.getElementById('idleDorfOverlay').classList.contains('visible');
    /* Nur laufen, solange der Reiter sichtbar ist und etwas unterwegs ist -
       sonst sofort beenden (startet beim naechsten Aufbau des Abschnitts neu). */
    if (!panelVisible || !bkmpExpRunning().length) {
      window.clearInterval(bkmpExpTickTimer);
      bkmpExpTickTimer = null;
      return;
    }
    if (!document.hidden) bkmpExpTick();
  }, 1000);
}

/* ---------- Klicks im Drachenzucht-Reiter (delegiert, einmalig) ---------- */
(function bkmpExpWireClicks() {
  const panel = typeof document !== 'undefined' ? document.getElementById('idlePanelDrachen') : null;
  if (!panel) return;
  panel.addEventListener('click', e => {
    if (e.target.closest('[data-exp-plan]')) { bkmpExpOpenPlanner(); return; }
    const claimBtn = e.target.closest('[data-exp-claim]');
    if (claimBtn && !claimBtn.disabled) { bkmpExpClaim(claimBtn.getAttribute('data-exp-claim')); return; }
    if (e.target.closest('[data-exp-goto-dorf]')) {
      const btn = document.getElementById('idleTabBtnDorf');
      if (btn) btn.click();
    }
  });
})();
