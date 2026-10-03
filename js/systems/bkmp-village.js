/* ============================================================
   Idle-Dorf: Dorfentwicklung (Drachendorf-Ausbau, ab 04.10.2026)
   Reiter "🏗️ Dorfentwicklung" in der Kategorie "Entwicklung".

   Dorfprojekte (Drachenhafen I-III, Handelsposten I-II) und die taeglich
   wechselnden Angebote des Handelspostens. Alle Zahlen (Kosten,
   Voraussetzungen, Wirkungen) kommen aus der Datenbank
   (village_building_levels / village_trade_templates, siehe
   sql/20261004-02-village-projects.sql) - der Client rechnet keine eigenen
   Kosten. Bauen/Handeln: Server prueft und zieht ab, danach spiegelt der
   Client denselben Betrag lokal (gleiches Muster wie Gilden-Technologie).
   ============================================================ */

let bkmpVillageCatalog = [];          // Zeilen aus village_building_levels
let bkmpVillageLevels = {};           // { building_id: level }
let bkmpVillageDbMissing = false;     // Migration noch nicht ausgefuehrt
let bkmpVillageLoadedAt = 0;
let bkmpVillageLoading = null;        // laufendes Promise (kein Doppel-Laden)
let bkmpVillageLoadError = '';
let bkmpVillageOffers = null;         // { day, level, offers: [...] }
let bkmpVillageOffersLoading = null;
let bkmpVillageBusy = false;          // Doppelklick-Schutz fuer Bauen/Handeln

/* Anzeigenamen der Expeditionsregionen fuer die Wirkungsliste. Phase 3
   ersetzt das durch den Regionen-Katalog aus der Datenbank; bis dahin
   reicht diese kleine Zuordnung (unbekannte IDs werden roh angezeigt). */
const BKMP_VILLAGE_REGION_LABELS = {
  fluesterwald: '🌲 Flüsterwald',
  glutberge: '🌋 Glutberge',
  frostklamm: '❄️ Frostklamm',
  endriss: '🌌 Endriss',
  verbotenes_tal: '🐲 Verbotenes Drachental'
};

const BKMP_VILLAGE_RESOURCE_ORDER = ['gold', 'wood', 'stone', 'crystals', 'essence'];
const BKMP_VILLAGE_KIND_META = {
  gold: { icon: '💰', label: 'Gold' },
  wood: { icon: '🌳', label: 'Holz' },
  stone: { icon: '🗿', label: 'Stein' },
  crystals: { icon: '💎', label: 'Kristalle' },
  essence: { icon: '🧪', label: 'Essenz' },
  fruit: { icon: '🍎', label: 'Früchte' },
  meat: { icon: '🥩', label: 'Fleisch' },
  rune: { icon: '🔮', label: 'Rune' },
  egg: { icon: '🥚', label: 'Drachenei' }
};

function bkmpVillageFmt(n) {
  return typeof bkmpIdleFormatNumber === 'function' ? bkmpIdleFormatNumber(n) : String(Math.round(Number(n) || 0));
}
function bkmpVillageEsc(s) {
  return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s);
}
function bkmpVillageToast(text, kind) {
  if (typeof bkmpUiShowToast === 'function') bkmpUiShowToast({ text, kind: kind || 'info', ms: 3400 });
  else if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(text, 3400);
}

/* ---------- Abfragen fuer andere Systeme (Expeditionen, Dorfpfad) ---------- */
function bkmpVillageLevel(buildingId) {
  return Number(bkmpVillageLevels[buildingId] || 0);
}
function bkmpVillageLevelsFor(buildingId) {
  return bkmpVillageCatalog.filter(r => r.building_id === buildingId).sort((a, b) => a.level - b.level);
}
/* Summierte Wirkung des Drachenhafens: Expeditionsplaetze (Wert der
   hoechsten gebauten Stufe) und freigeschaltete Regionen (alle Stufen bis
   zur aktuellen zusammen). */
function bkmpVillageHarborEffects() {
  const lvl = bkmpVillageLevel('drachenhafen');
  const out = { level: lvl, slots: 0, regions: [] };
  bkmpVillageLevelsFor('drachenhafen').forEach(row => {
    if (row.level > lvl) return;
    const eff = row.effects || {};
    if (eff.expedition_slots != null) out.slots = Number(eff.expedition_slots) || out.slots;
    (eff.regions || []).forEach(r => { if (!out.regions.includes(r)) out.regions.push(r); });
  });
  return out;
}

/* ---------- Laden ---------- */
async function bkmpVillageEnsureLoaded(force) {
  if (bkmpVillageLoading) return bkmpVillageLoading;
  if (!force && bkmpVillageLoadedAt && Date.now() - bkmpVillageLoadedAt < 60000) return;
  if (typeof loadVillageBuildingLevels !== 'function') return;
  bkmpVillageLoading = (async () => {
    try {
      const cat = await loadVillageBuildingLevels();
      bkmpVillageCatalog = cat.rows || [];
      bkmpVillageDbMissing = !!cat.missing;
      if (!bkmpVillageDbMissing) {
        const mine = await loadMyVillageBuildings();
        if (mine.missing) bkmpVillageDbMissing = true;
        else bkmpVillageLevels = mine.levels || {};
      }
      bkmpVillageLoadError = '';
      bkmpVillageLoadedAt = Date.now();
    } catch (e) {
      bkmpVillageLoadError = 'Dorfprojekte konnten nicht geladen werden.';
    } finally {
      bkmpVillageLoading = null;
    }
  })();
  return bkmpVillageLoading;
}

function bkmpVillageBerlinToday() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (e) { return new Date().toISOString().slice(0, 10); }
}

async function bkmpVillageEnsureOffers(force) {
  if (bkmpVillageLevel('handelsposten') < 1) { bkmpVillageOffers = null; return; }
  if (bkmpVillageOffersLoading) return bkmpVillageOffersLoading;
  if (!force && bkmpVillageOffers && bkmpVillageOffers.day === bkmpVillageBerlinToday()) return;
  if (typeof bkmpVillageTradeOffersRpc !== 'function') return;
  bkmpVillageOffersLoading = (async () => {
    try {
      const res = await bkmpVillageTradeOffersRpc();
      bkmpVillageOffers = res.missing ? null : res;
    } catch (e) {
      bkmpVillageOffers = { day: null, level: 0, offers: [], error: e.message };
    } finally {
      bkmpVillageOffersLoading = null;
    }
  })();
  return bkmpVillageOffersLoading;
}

/* ---------- Rendering ---------- */
function bkmpVillageHave(kind) {
  return Math.floor(Number((bkmpIdleState || {})[kind] || 0));
}

function bkmpVillageCostChipsHtml(def) {
  return BKMP_VILLAGE_RESOURCE_ORDER.map(kind => {
    const need = Number(def['cost_' + kind] || 0);
    if (!need) return '';
    const have = bkmpVillageHave(kind);
    const meta = BKMP_VILLAGE_KIND_META[kind];
    return `<span class="dd-cost-chip${have < need ? ' is-short' : ''}" title="${meta.label}: ${bkmpVillageFmt(have)} / ${bkmpVillageFmt(need)}">${meta.icon} ${bkmpVillageFmt(need)}</span>`;
  }).join('');
}

function bkmpVillageAffordable(def) {
  return BKMP_VILLAGE_RESOURCE_ORDER.every(kind => bkmpVillageHave(kind) >= Number(def['cost_' + kind] || 0));
}

function bkmpVillageEffectLinesHtml(def) {
  const eff = (def && def.effects) || {};
  const lines = [];
  if (eff.expedition_slots != null) {
    const n = Number(eff.expedition_slots);
    lines.push(`⚓ ${n} ${n === 1 ? 'Expedition' : 'Expeditionen'} gleichzeitig`);
  }
  if (Array.isArray(eff.regions) && eff.regions.length) {
    lines.push('🗺️ Neue Regionen: ' + eff.regions.map(r => BKMP_VILLAGE_REGION_LABELS[r] || r).join(', '));
  }
  if (eff.offers_per_day != null) lines.push(`🏪 ${Number(eff.offers_per_day)} Angebote pro Tag`);
  return lines.length ? `<ul class="dd-project-effects">${lines.map(l => `<li>${bkmpVillageEsc(l)}</li>`).join('')}</ul>` : '';
}

function bkmpVillageProjectCardHtml(buildingId) {
  const rows = bkmpVillageLevelsFor(buildingId);
  if (!rows.length) return '';
  const current = bkmpVillageLevel(buildingId);
  const maxLevel = rows[rows.length - 1].level;
  const next = rows.find(r => r.level === current + 1) || null;
  const currentDef = rows.find(r => r.level === current) || null;
  const shown = next || currentDef || rows[0];
  const stage = Number((bkmpIdleState || {}).highest_dragon_index || 0);
  const stageOk = !next || stage >= Number(next.min_stage || 0);
  const affordable = !!next && bkmpVillageAffordable(next);
  const canBuild = !!next && stageOk && affordable && !bkmpVillageBusy;
  const fmtStage = typeof bkmpIdleFormatStage === 'function' ? bkmpIdleFormatStage : (i => String(i));
  const stateLabel = current > 0 ? `${bkmpVillageEsc(currentDef ? currentDef.level_label : '')} · Stufe ${current} / ${maxLevel}` : `Noch nicht gebaut · ${maxLevel} Stufen`;
  let footer = '';
  if (!next) {
    footer = `<div class="dd-project-done">✅ Voll ausgebaut</div>`;
  } else {
    footer = `
      <div class="dd-project-next-label">${current > 0 ? 'Ausbau auf' : 'Bau von'} <strong>${bkmpVillageEsc(next.level_label)}</strong></div>
      <div class="dd-cost-list">${bkmpVillageCostChipsHtml(next)}</div>
      ${!stageOk ? `<div class="dd-project-req">🔒 Benötigt Kampf-Stufe ${fmtStage(next.min_stage)} (deine beste: ${fmtStage(stage)})</div>` : ''}
      <button type="button" class="btn-ja dd-build-btn" data-village-build="${bkmpVillageEsc(buildingId)}" data-testid="village-build-${bkmpVillageEsc(buildingId)}" ${canBuild ? '' : 'disabled'}>
        ${current > 0 ? '⬆️ Ausbauen' : '🔨 Bauen'}
      </button>`;
  }
  return `
    <div class="dd-project-card${!next ? ' is-maxed' : ''}" data-testid="village-card-${bkmpVillageEsc(buildingId)}">
      <div class="dd-project-head">
        <span class="dd-project-icon" aria-hidden="true">${bkmpVillageEsc(shown.icon)}</span>
        <div class="dd-project-title">
          <span class="dd-project-name">${bkmpVillageEsc(shown.building_name)}</span>
          <span class="dd-project-level">${stateLabel}</span>
        </div>
      </div>
      <p class="dd-project-desc">${bkmpVillageEsc(shown.description)}</p>
      ${bkmpVillageEffectLinesHtml(shown)}
      ${footer}
    </div>`;
}

function bkmpVillageOfferSideHtml(kind, amount) {
  const meta = BKMP_VILLAGE_KIND_META[kind] || { icon: '❔', label: kind };
  if (kind === 'rune' || kind === 'egg') return `${meta.icon} ${amount > 1 ? amount + '× ' : ''}${meta.label}`;
  return `${meta.icon} ${bkmpVillageFmt(amount)} ${meta.label}`;
}

function bkmpVillageMsToBerlinMidnight() {
  const now = new Date();
  try {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(now).forEach(p => { if (p.type !== 'literal') parts[p.type] = Number(p.value); });
    const h = parts.hour === 24 ? 0 : parts.hour;
    return ((24 - h) * 3600 - parts.minute * 60 - parts.second) * 1000;
  } catch (e) { return 0; }
}

function bkmpVillageTradeHtml() {
  const level = bkmpVillageLevel('handelsposten');
  if (level < 1) return '';
  let body;
  if (!bkmpVillageOffers) {
    body = `<p class="dd-muted">⏳ Angebote werden geladen…</p>`;
  } else if (bkmpVillageOffers.error) {
    body = `<p class="dd-muted">${bkmpVillageEsc(bkmpVillageOffers.error)}</p>`;
  } else if (!bkmpVillageOffers.offers.length) {
    body = `<p class="dd-muted">Heute keine Angebote.</p>`;
  } else {
    body = `<div class="dd-trade-grid">${bkmpVillageOffers.offers.map(o => {
      const costOk = bkmpVillageHave(o.cost_kind) >= Number(o.cost_amount || 0)
        && (!o.cost2_kind || bkmpVillageHave(o.cost2_kind) >= Number(o.cost2_amount || 0));
      const costHtml = bkmpVillageOfferSideHtml(o.cost_kind, o.cost_amount) + (o.cost2_kind ? ' + ' + bkmpVillageOfferSideHtml(o.cost2_kind, o.cost2_amount) : '');
      return `
        <div class="dd-trade-card${o.bought ? ' is-bought' : ''}" data-testid="village-offer-${Number(o.index)}">
          <div class="dd-trade-label">${bkmpVillageEsc(o.label)}</div>
          <div class="dd-trade-swap"><span class="dd-trade-give">${costHtml}</span><span class="dd-trade-arrow" aria-hidden="true">→</span><span class="dd-trade-get">${bkmpVillageOfferSideHtml(o.reward_kind, o.reward_amount)}</span></div>
          ${o.bought
            ? `<div class="dd-trade-done">✅ Heute angenommen</div>`
            : `<button type="button" class="btn-ja dd-trade-btn" data-village-trade="${Number(o.index)}" ${costOk && !bkmpVillageBusy ? '' : 'disabled'}>Tauschen</button>`}
        </div>`;
    }).join('')}</div>`;
  }
  const ms = bkmpVillageMsToBerlinMidnight();
  const hrs = Math.floor(ms / 3600000), mins = Math.floor((ms % 3600000) / 60000);
  return `
    <div class="dd-trade" data-testid="village-trade">
      <div class="dd-section-head">
        <h4>🏪 Handelsposten – Angebote des Tages</h4>
        <span class="dd-muted">Neue Angebote in ${hrs} Std. ${mins} Min. (00:00 Uhr)</span>
      </div>
      ${body}
    </div>`;
}

function bkmpVillageRenderFromCache() {
  const panel = document.getElementById('idlePanelDorf');
  if (!panel) return;
  if (panel.style.display === 'none' && (typeof bkmpIdleActiveTab === 'undefined' || bkmpIdleActiveTab !== 'dorf')) return;
  let content;
  if (bkmpVillageDbMissing) {
    content = `<p class="idle-dd-pending">🛠️ Die Dorfprojekte werden gerade vorbereitet und sind bald verfügbar.</p>`;
  } else if (bkmpVillageLoadError && !bkmpVillageCatalog.length) {
    content = `<p class="idle-dd-pending">${bkmpVillageEsc(bkmpVillageLoadError)} <button type="button" class="btn-nein dd-retry-btn" data-village-retry="1">Erneut laden</button></p>`;
  } else if (!bkmpVillageCatalog.length) {
    content = `<p class="dd-muted">⏳ Dorfprojekte werden geladen…</p>`;
  } else {
    const ids = [];
    bkmpVillageCatalog.forEach(r => { if (!ids.includes(r.building_id)) ids.push(r.building_id); });
    content = `<div class="dd-project-grid">${ids.map(bkmpVillageProjectCardHtml).join('')}</div>${bkmpVillageTradeHtml()}`;
  }
  const html = `
    <div class="dd-village">
      <div class="dd-village-intro">
        <h3>🏗️ Dorfentwicklung</h3>
        <p class="dd-muted">Große Bauprojekte für dein Drachendorf. Gebaut wird mit Gold, Holz, Stein, Kristallen und Essenz – einmal gebaut, bleibt alles auch nach einem Prestige erhalten.</p>
      </div>
      ${content}
    </div>`;
  if (panel.__bkmpVillageHtml === html) return;
  panel.__bkmpVillageHtml = html;
  panel.innerHTML = html;
}

function bkmpIdleRenderDorfPanel() {
  bkmpVillageRenderFromCache();
  bkmpVillageEnsureLoaded(false).then(() => {
    bkmpVillageRenderFromCache();
    return bkmpVillageEnsureOffers(false);
  }).then(() => bkmpVillageRenderFromCache()).catch(() => bkmpVillageRenderFromCache());
}

/* ---------- Aktionen ---------- */
async function bkmpVillagePrepareServerAction() {
  /* Server prueft gegen den gespeicherten Stand - vorher alles Lokale
     speichern, sonst wuerden gerade erst verdiente Ressourcen fehlen. */
  if (typeof bkmpIdleFlushSyncNow === 'function') {
    try { await bkmpIdleFlushSyncNow(); } catch (e) { /* weiter, Server prueft ohnehin */ }
  }
}

function bkmpVillageApplyLocalDelta(spent, gained) {
  if (!bkmpIdleState) return;
  Object.keys(spent || {}).forEach(kind => {
    const n = Number(spent[kind] || 0);
    if (n) bkmpIdleState[kind] = Math.max(0, Number(bkmpIdleState[kind] || 0) - n);
  });
  Object.keys(gained || {}).forEach(kind => {
    const n = Number(gained[kind] || 0);
    if (n) bkmpIdleState[kind] = Number(bkmpIdleState[kind] || 0) + n;
  });
  if (typeof bkmpIdleRenderHud === 'function') bkmpIdleRenderHud();
  if (typeof bkmpIdleQueueSync === 'function') bkmpIdleQueueSync();
}

async function bkmpVillageBuild(buildingId) {
  if (bkmpVillageBusy || typeof bkmpVillageBuildRpc !== 'function') return;
  bkmpVillageBusy = true;
  bkmpVillageRenderFromCache();
  try {
    await bkmpVillagePrepareServerAction();
    const res = await bkmpVillageBuildRpc(buildingId);
    if (res) {
      bkmpVillageLevels[buildingId] = Number(res.level) || bkmpVillageLevel(buildingId) + 1;
      bkmpVillageApplyLocalDelta(res.spent || {}, {});
      const def = bkmpVillageLevelsFor(buildingId).find(r => r.level === bkmpVillageLevels[buildingId]);
      bkmpVillageToast(`🎉 ${def ? def.level_label : buildingId} fertiggestellt!`, 'success');
      if (buildingId === 'handelsposten') await bkmpVillageEnsureOffers(true);
      if (typeof window.bkmpVillageOnChange === 'function') window.bkmpVillageOnChange(buildingId);
    }
  } catch (e) {
    bkmpVillageToast(e.message || String(e), 'danger');
  }
  bkmpVillageBusy = false;
  bkmpVillageRenderFromCache();
}

async function bkmpVillageTrade(offerIndex) {
  if (bkmpVillageBusy || typeof bkmpVillageTradeExecuteRpc !== 'function') return;
  bkmpVillageBusy = true;
  bkmpVillageRenderFromCache();
  try {
    await bkmpVillagePrepareServerAction();
    const res = await bkmpVillageTradeExecuteRpc(offerIndex);
    if (res) {
      const spent = {};
      spent[res.cost_kind] = Number(res.cost_amount || 0);
      if (res.cost2_kind) spent[res.cost2_kind] = (spent[res.cost2_kind] || 0) + Number(res.cost2_amount || 0);
      const gained = {};
      if (!['rune', 'egg'].includes(res.reward_kind)) gained[res.reward_kind] = Number(res.reward_amount || 0);
      bkmpVillageApplyLocalDelta(spent, gained);
      if (res.reward_kind === 'rune' && typeof bkmpDungeonRollRune === 'function' && typeof bkmpDungeonPersistRunes === 'function') {
        const rune = bkmpDungeonRollRune(2);
        if (rune) bkmpDungeonPersistRunes([rune]);
      } else if (res.reward_kind === 'egg' && typeof bkmpDungeonRollEgg === 'function' && typeof bkmpDungeonPersistEgg === 'function') {
        const egg = bkmpDungeonRollEgg(2);
        if (egg) bkmpDungeonPersistEgg(egg);
      }
      const offer = bkmpVillageOffers && bkmpVillageOffers.offers.find(o => Number(o.index) === Number(offerIndex));
      if (offer) offer.bought = true;
      bkmpVillageToast(`🤝 Tausch erfolgreich: ${bkmpVillageOfferSideHtml(res.reward_kind, res.reward_amount)}`, 'success');
    }
  } catch (e) {
    bkmpVillageToast(e.message || String(e), 'danger');
    if (/heute schon|nicht mehr/.test(String(e.message || ''))) await bkmpVillageEnsureOffers(true);
  }
  bkmpVillageBusy = false;
  bkmpVillageRenderFromCache();
}

/* Delegierter Klick-Listener (einmal, das Panel wird per innerHTML neu
   befuellt - Listener an den Knoepfen selbst wuerden verloren gehen). */
(function bkmpVillageWireClicks() {
  const panel = typeof document !== 'undefined' ? document.getElementById('idlePanelDorf') : null;
  if (!panel) return;
  panel.addEventListener('click', e => {
    const buildBtn = e.target.closest('[data-village-build]');
    if (buildBtn && !buildBtn.disabled) { bkmpVillageBuild(buildBtn.getAttribute('data-village-build')); return; }
    const tradeBtn = e.target.closest('[data-village-trade]');
    if (tradeBtn && !tradeBtn.disabled) { bkmpVillageTrade(Number(tradeBtn.getAttribute('data-village-trade'))); return; }
    const retryBtn = e.target.closest('[data-village-retry]');
    if (retryBtn) { bkmpVillageEnsureLoaded(true).then(bkmpIdleRenderDorfPanel).catch(() => bkmpVillageRenderFromCache()); }
  });
})();
