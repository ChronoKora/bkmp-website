/* Folgeupdate 04.10.2026: Skilltree-Builds + Auto-Skilltree.
   Spieler-Feedback: nach jedem Prestige muss der normale Skilltree von Hand
   wieder aufgebaut werden (viele Knoten mit 20-40 Raengen = hunderte
   gleiche Klicks). Ziel: Entscheidungen behalten, Wiederholungsklicks
   entfernen - der Skilltree selbst bleibt unveraendert.

   Staffelung (passt zum vorhandenen System):
   - MAX-Knopf pro Knoten: sofort fuer alle (bkmp-skilltree.js).
   - Builds (3 Plaetze, speichern/anwenden/umbenennen/loeschen): ab dem
     ersten moeglichen Aufstieg (Stufe 100) bzw. nach dem ersten Prestige -
     erst dann wird ein zurueckgesetzter Skilltree ueberhaupt zum Thema.
   - Auto-Skilltree (neue Punkte automatisch nach dem aktiven Build): Prestige-
     Knoten "Meister der Pfade" im vorhandenen Automation-Zweig.

   Ein Build ist NUR eine Vorlage { Knoten-ID: Wunschrang }. Angewendet wird
   er ausschliesslich ueber bkmpIdleAllocateSkillRanksQuiet() - dieselbe
   Pruefung wie der "+1"-Knopf (verfuegbare Punkte, Max-Rang, Voraussetzung,
   Zweig-Sperre). Ein Build erzeugt nie Punkte und kauft nie kostenlos.

   Kaufreihenfolge: wird bei JEDEM Anwenden frisch aus den aktuellen
   Knotendaten berechnet (nicht beim Speichern festgeschrieben - aendert sich
   der Katalog, bleibt der Build gueltig): Voraussetzungen zuerst, dann die
   guenstigsten Raenge, gleich teure gleichmaessig verteilt. So bringen die
   ersten 80 von 500 Punkten moeglichst viele Raenge in den Grundwerten,
   teure tiefe Knoten folgen, sobald genug Punkte da sind.

   Speicherort: Chronik-Zustand (idle_player_meta, eine JSONB-Zeile pro
   Konto, siehe bkmp-chronicle.js) - geraeteuebergreifend, ohne neue SQL,
   faellt ohne Server auf localStorage zurueck. */

const BKMP_SKILL_BUILD_SLOTS = 3;
const BKMP_SKILL_BUILD_DEFAULT_NAMES = ['Standard', 'Farm', 'Boss'];
const BKMP_SKILL_BUILD_NAME_MAX = 24;
let bkmpSkillBuildSelectedSlot = null;
let bkmpSkillBuildAutoBusy = false;

/* ---------------- Zustand (Teil der Chronik) ---------------- */
function bkmpSkillBuildsEmpty() {
  return { slots: [null, null, null], slotAt: [0, 0, 0], active: -1, activeAt: 0, auto: false, autoAt: 0, dismissedRun: -1, dismissedAt: 0 };
}
function bkmpSkillBuildsNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
/* Name ohne Steuerzeichen, gekuerzt. */
function bkmpSkillBuildCleanName(v) {
  return Array.from(String(v == null ? '' : v)).filter(ch => ch.charCodeAt(0) >= 32).join('').trim().slice(0, BKMP_SKILL_BUILD_NAME_MAX);
}
function bkmpSkillBuildNormalizeSlot(raw) {
  if (!raw || typeof raw !== 'object' || raw.deleted) return null;
  const ranks = {};
  if (raw.ranks && typeof raw.ranks === 'object') {
    Object.keys(raw.ranks).slice(0, 120).forEach(k => {
      const r = Math.min(1000, Math.floor(bkmpSkillBuildsNum(raw.ranks[k])));
      if (/^[a-z0-9_-]{1,40}$/i.test(k) && r > 0) ranks[k] = r;
    });
  }
  if (!Object.keys(ranks).length) return null;
  const name = bkmpSkillBuildCleanName(raw.name);
  return { name: name || 'Build', ranks, savedAt: bkmpSkillBuildsNum(raw.savedAt) };
}
function bkmpSkillBuildsNormalize(raw) {
  const b = bkmpSkillBuildsEmpty();
  if (!raw || typeof raw !== 'object') return b;
  for (let i = 0; i < BKMP_SKILL_BUILD_SLOTS; i++) {
    b.slots[i] = bkmpSkillBuildNormalizeSlot(Array.isArray(raw.slots) ? raw.slots[i] : null);
    b.slotAt[i] = bkmpSkillBuildsNum(Array.isArray(raw.slotAt) ? raw.slotAt[i] : 0);
  }
  const active = Math.floor(Number(raw.active));
  b.active = Number.isFinite(active) && active >= 0 && active < BKMP_SKILL_BUILD_SLOTS ? active : -1;
  b.activeAt = bkmpSkillBuildsNum(raw.activeAt);
  b.auto = raw.auto === true;
  b.autoAt = bkmpSkillBuildsNum(raw.autoAt);
  const dismissed = Math.floor(Number(raw.dismissedRun));
  b.dismissedRun = Number.isFinite(dismissed) && dismissed >= 0 ? dismissed : -1;
  b.dismissedAt = bkmpSkillBuildsNum(raw.dismissedAt);
  return b;
}
/* Zwei Geraete: pro Platz gewinnt die neuere Aenderung (auch ein Loeschen),
   Schalter (aktiver Build, Auto, ausgeblendeter Hinweis) ebenso. */
function bkmpSkillBuildsMerge(a, b) {
  const x = a ? bkmpSkillBuildsNormalize(a) : null;
  const y = b ? bkmpSkillBuildsNormalize(b) : null;
  if (!x) return y || bkmpSkillBuildsEmpty();
  if (!y) return x;
  const m = bkmpSkillBuildsEmpty();
  for (let i = 0; i < BKMP_SKILL_BUILD_SLOTS; i++) {
    const src = y.slotAt[i] > x.slotAt[i] ? y : x;
    m.slots[i] = src.slots[i];
    m.slotAt[i] = Math.max(x.slotAt[i], y.slotAt[i]);
  }
  const act = y.activeAt > x.activeAt ? y : x;
  m.active = act.active; m.activeAt = Math.max(x.activeAt, y.activeAt);
  const au = y.autoAt > x.autoAt ? y : x;
  m.auto = au.auto; m.autoAt = Math.max(x.autoAt, y.autoAt);
  const di = y.dismissedAt > x.dismissedAt ? y : x;
  m.dismissedRun = di.dismissedRun; m.dismissedAt = Math.max(x.dismissedAt, y.dismissedAt);
  if (m.active >= 0 && !m.slots[m.active]) m.active = -1;
  return m;
}
function bkmpSkillBuildsState() {
  if (typeof bkmpChronicleReady !== 'function' || !bkmpChronicleReady()) return null;
  if (!bkmpChronicle.skillBuilds) bkmpChronicle.skillBuilds = bkmpSkillBuildsEmpty();
  return bkmpChronicle.skillBuilds;
}
function bkmpSkillBuildsChanged() {
  if (typeof bkmpChronicleMarkDirty === 'function') bkmpChronicleMarkDirty();
}
function bkmpSkillBuildsHasAny(state) {
  return !!state && state.slots.some(Boolean);
}

/* ---------------- Freischaltungen ---------------- */
function bkmpSkillBuildsPrestigeLevel() {
  return typeof bkmpPrestigeState !== 'undefined' && bkmpPrestigeState ? Number(bkmpPrestigeState.prestige_level || 0) : 0;
}
function bkmpSkillBuildsUnlockStage() {
  return typeof bkmpPrestigeRequiredStage === 'function' ? bkmpPrestigeRequiredStage(0) : 100;
}
function bkmpSkillBuildsUnlocked() {
  if (!bkmpIdleState) return false;
  if (bkmpSkillBuildsPrestigeLevel() >= 1) return true;
  return Number(bkmpIdleState.highest_dragon_index || 0) >= bkmpSkillBuildsUnlockStage();
}
function bkmpSkillBuildsAutoUnlocked() {
  return typeof bkmpPrestigeBonus === 'function' && bkmpPrestigeBonus('auto_skilltree_unlock') > 0;
}
function bkmpSkillBuildsAutoActiveName() {
  const st = bkmpSkillBuildsState();
  if (!st || !st.auto || !bkmpSkillBuildsAutoUnlocked() || st.active < 0 || !st.slots[st.active]) return '';
  return st.slots[st.active].name;
}

/* ---------------- Planung (reine Funktionen) ---------------- */
/* Wunschraenge auf die aktuellen Knoten abbilden: unbekannte IDs fallen weg,
   ueber dem Max-Rang wird gekappt, und jede Voraussetzung eines gewuenschten
   Knotens wird mindestens bis zum noetigen Rang mit eingeplant. */
function bkmpSkillBuildEffectiveTargets(ranks, defs) {
  const byId = new Map((defs || []).map(n => [n.id, n]));
  const t = {};
  Object.keys(ranks || {}).forEach(id => {
    const n = byId.get(id);
    if (!n) return;
    const r = Math.min(Math.floor(Number(ranks[id]) || 0), Number(n.max_rank) || 0);
    if (r > 0) t[id] = Math.max(t[id] || 0, r);
  });
  for (let pass = 0; pass < 60; pass++) {
    let changed = false;
    Object.keys(t).forEach(id => {
      const n = byId.get(id);
      if (!n || !n.requires_node_id || !byId.has(n.requires_node_id)) return;
      const parent = byId.get(n.requires_node_id);
      const need = Math.min(Math.max(0, Number(n.requires_rank) || 0), Number(parent.max_rank) || 0);
      if (need > 0 && (t[parent.id] || 0) < need) { t[parent.id] = need; changed = true; }
    });
    if (!changed) break;
  }
  return t;
}
function bkmpSkillBuildDepth(node, byId) {
  let d = 0;
  let cur = node;
  const seen = new Set();
  while (cur && cur.requires_node_id && !seen.has(cur.id) && byId.has(cur.requires_node_id)) {
    seen.add(cur.id);
    cur = byId.get(cur.requires_node_id);
    d += 1;
  }
  return d;
}
/* Reihenfolge der einzelnen Rang-Kaeufe fuer "points" verfuegbare Punkte:
   nur Knoten des Builds, nur wenn die Voraussetzung JETZT erfuellt ist,
   guenstigste zuerst, gleich teure nach Fuellstand (gleichmaessig). */
function bkmpSkillBuildPlan(ranks, alloc, defs, points, lockedBranches) {
  const byId = new Map((defs || []).map(n => [n.id, n]));
  const targets = bkmpSkillBuildEffectiveTargets(ranks, defs);
  const cur = {};
  Object.keys(alloc || {}).forEach(k => { cur[k] = Math.max(0, Math.floor(Number(alloc[k]) || 0)); });
  const locked = lockedBranches instanceof Set ? lockedBranches : new Set(lockedBranches || []);
  const branchOrder = typeof BKMP_IDLE_BRANCH_ORDER !== 'undefined' ? BKMP_IDLE_BRANCH_ORDER : [];
  const meta = Object.keys(targets).map(id => {
    const n = byId.get(id);
    return { id, n, cost: Math.max(1, Number(n.cost_per_rank) || 1), depth: bkmpSkillBuildDepth(n, byId), branch: Math.max(0, branchOrder.indexOf(n.branch)), sort: Number(n.sort_order || 0) };
  }).filter(m => !locked.has(m.n.branch));
  let pts = Math.max(0, Math.floor(Number(points) || 0));
  const steps = [];
  for (let guard = 0; guard < 100000; guard++) {
    let best = null;
    for (const m of meta) {
      const have = cur[m.id] || 0;
      const want = targets[m.id];
      if (have >= want || m.cost > pts) continue;
      if (have >= Number(m.n.max_rank)) continue;
      if (m.n.requires_node_id && (cur[m.n.requires_node_id] || 0) < Number(m.n.requires_rank || 0)) continue;
      const fill = have / want;
      if (!best
        || m.cost < best.cost
        || (m.cost === best.cost && (fill < best.fill
          || (fill === best.fill && (m.depth < best.depth
            || (m.depth === best.depth && (m.branch < best.branch
              || (m.branch === best.branch && (m.sort < best.sort || (m.sort === best.sort && m.id < best.id)))))))))) {
        best = { ...m, fill };
      }
    }
    if (!best) break;
    steps.push(best.id);
    cur[best.id] = (cur[best.id] || 0) + 1;
    pts -= best.cost;
  }
  return { steps, targets };
}
/* Fortschritt eines Builds in Skillpunkten: "80 / 500 wiederhergestellt". */
function bkmpSkillBuildProgress(ranks, alloc, defs) {
  const byId = new Map((defs || []).map(n => [n.id, n]));
  const targets = bkmpSkillBuildEffectiveTargets(ranks, defs);
  let total = 0;
  let done = 0;
  Object.keys(targets).forEach(id => {
    const cost = Math.max(1, Number(byId.get(id).cost_per_rank) || 1);
    total += targets[id] * cost;
    done += Math.min(targets[id], Math.max(0, Math.floor(Number((alloc || {})[id]) || 0))) * cost;
  });
  return { done, total, complete: total > 0 && done >= total };
}

/* ---------------- Anwenden ---------------- */
function bkmpSkillBuildLockedBranches() {
  const set = new Set();
  if (typeof bkmpIdleSkillBranchLocked === 'function' && bkmpIdleSkillBranchLocked('meister')) set.add('meister');
  return set;
}
/* Gibt NUR verfuegbare Punkte aus - jeder Rang einzeln ueber die normale
   Kauf-Pruefung. Kein Neuzeichnen hier (macht der Aufrufer). */
function bkmpSkillBuildSpend(build) {
  if (!build || !bkmpIdleState || typeof bkmpIdleAllocateSkillRanksQuiet !== 'function') return { spent: 0, ranks: 0 };
  const defs = typeof bkmpIdleSkillDefs !== 'undefined' ? bkmpIdleSkillDefs : [];
  const plan = bkmpSkillBuildPlan(build.ranks, bkmpIdleState.skill_allocations || {}, defs, bkmpIdleState.skill_points_available, bkmpSkillBuildLockedBranches());
  const before = Number(bkmpIdleState.skill_points_available || 0);
  let ranks = 0;
  for (const id of plan.steps) {
    const bought = bkmpIdleAllocateSkillRanksQuiet(id, 1);
    if (!bought) break;
    ranks += bought;
  }
  return { spent: before - Number(bkmpIdleState.skill_points_available || 0), ranks };
}
function bkmpSkillBuildProgressOf(build) {
  const defs = typeof bkmpIdleSkillDefs !== 'undefined' ? bkmpIdleSkillDefs : [];
  return bkmpSkillBuildProgress(build ? build.ranks : {}, bkmpIdleState ? bkmpIdleState.skill_allocations || {} : {}, defs);
}
function bkmpSkillBuildsToast(text, kind) {
  if (typeof bkmpUiShowToast === 'function') bkmpUiShowToast({ text, kind: kind || 'info', ms: 4200 });
  else if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(text, 4200);
}
function bkmpSkillBuildApply(slot) {
  const st = bkmpSkillBuildsState();
  if (!st || !bkmpSkillBuildsUnlocked()) return null;
  const build = st.slots[slot];
  if (!build) return null;
  st.active = slot; st.activeAt = Date.now();
  bkmpSkillBuildSelectedSlot = slot;
  bkmpSkillBuildsChanged();
  const res = bkmpSkillBuildSpend(build);
  if (res.spent > 0) bkmpIdleAfterSkillAllocation(true);
  else if (typeof bkmpIdleRenderSkilltreePanel === 'function') bkmpIdleRenderSkilltreePanel();
  const p = bkmpSkillBuildProgressOf(build);
  const fmt = typeof bkmpIdleFormatNumber === 'function' ? bkmpIdleFormatNumber : String;
  if (p.complete) bkmpSkillBuildsToast(`🌳 Build „${build.name}“ vollständig wiederhergestellt.`, 'success');
  else bkmpSkillBuildsToast(`🌳 Build „${build.name}“: ${fmt(p.done)} / ${fmt(p.total)} Skillpunkte wiederhergestellt. Der Build bleibt aktiv.`, 'success');
  return { ...res, progress: p };
}
/* Auto-Skilltree: nur wenn freigeschaltet + eingeschaltet + aktiver Build +
   verfuegbare Punkte. Ausloeser: Level-Aufstieg, Offline-Nachtrag, Laden,
   Prestige, Einschalten, Skilltree-Reset - nie pro Frame. */
function bkmpSkillBuildsAutoRun(reason, opts) {
  if (bkmpSkillBuildAutoBusy || !bkmpIdleState) return 0;
  if (Number(bkmpIdleState.skill_points_available || 0) <= 0) return 0;
  if (!bkmpSkillBuildsAutoActiveName() || !bkmpSkillBuildsUnlocked()) return 0;
  const st = bkmpSkillBuildsState();
  bkmpSkillBuildAutoBusy = true;
  let res = { spent: 0 };
  try {
    res = bkmpSkillBuildSpend(st.slots[st.active]);
  } finally {
    bkmpSkillBuildAutoBusy = false;
  }
  if (res.spent > 0) {
    if (opts && opts.quiet) { if (typeof bkmpIdleQueueSync === 'function') bkmpIdleQueueSync(); }
    else if (reason === 'reset') bkmpIdleRecomputeEffectiveStats(); // Reset zeichnet/speichert selbst
    else bkmpIdleAfterSkillAllocation(false);
  }
  return res.spent;
}

/* ---------------- Hooks ---------------- */
async function bkmpSkillBuildsOnIdleOpen() {
  if (typeof bkmpChronicleEnsureLoaded === 'function' && bkmpIdleState) {
    try { await bkmpChronicleEnsureLoaded(bkmpIdleState.name_key); } catch (e) { return; }
  }
  const spent = bkmpSkillBuildsAutoRun('load');
  /* Skilltree war evtl. schon offen, bevor die Chronik geladen war ("Builds werden geladen…"). */
  if (!spent && typeof bkmpIdleActiveTab !== 'undefined' && bkmpIdleActiveTab === 'skilltree' && typeof bkmpIdleRenderSkilltreePanel === 'function') bkmpIdleRenderSkilltreePanel();
}
function bkmpSkillBuildsOnPrestige() {
  const st = bkmpSkillBuildsState();
  if (!st || !bkmpSkillBuildsHasAny(st)) return;
  const name = bkmpSkillBuildsAutoActiveName();
  if (name) bkmpSkillBuildsToast(`🌳 Build „${name}“ aktiviert – neue Skillpunkte werden automatisch verteilt.`, 'success');
  else bkmpSkillBuildsToast('🌳 Skilltree zurückgesetzt – dein gespeicherter Build wartet im Skilltree.', 'info');
}

/* ---------------- Anzeige im Skilltree-Reiter ---------------- */
function bkmpSkillBuildsEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }
function bkmpSkillBuildsPanelHtml() {
  if (!bkmpIdleState) return '';
  if (!bkmpSkillBuildsUnlocked()) {
    return `<p class="idle-skillbuilds-locked" data-testid="skillbuilds-locked">🌳 <strong>Skilltree-Builds</strong> werden freigeschaltet, sobald du zum ersten Mal aufsteigen kannst (Stufe ${bkmpSkillBuildsUnlockStage()}). Bis dahin hilft dir der <strong>MAX</strong>-Knopf.</p>`;
  }
  const st = bkmpSkillBuildsState();
  if (!st) return '<p class="idle-skillbuilds-locked" data-testid="skillbuilds-loading">🌳 Skilltree-Builds werden geladen…</p>';
  if (bkmpSkillBuildSelectedSlot === null || bkmpSkillBuildSelectedSlot < 0 || bkmpSkillBuildSelectedSlot >= BKMP_SKILL_BUILD_SLOTS) {
    bkmpSkillBuildSelectedSlot = st.active >= 0 ? st.active : Math.max(0, st.slots.findIndex(Boolean));
  }
  const sel = bkmpSkillBuildSelectedSlot;
  const selBuild = st.slots[sel];
  const fmt = typeof bkmpIdleFormatNumber === 'function' ? bkmpIdleFormatNumber : String;
  const autoUnlocked = bkmpSkillBuildsAutoUnlocked();
  const activeBuild = st.active >= 0 ? st.slots[st.active] : null;
  const spentNow = Number(bkmpIdleState.skill_points_spent || 0);
  const run = bkmpSkillBuildsPrestigeLevel();

  /* Nach einem Prestige (Skilltree leer): Build anwenden ODER selbst verteilen. */
  let banner = '';
  const suggest = activeBuild ? st.active : st.slots.findIndex(Boolean);
  if (spentNow === 0 && suggest >= 0 && st.dismissedRun !== run && !(autoUnlocked && st.auto && activeBuild)) {
    banner = `<div class="idle-skillbuilds-banner" data-testid="skillbuilds-banner">
      <div class="idle-skillbuilds-banner-title">🌳 Skilltree zurückgesetzt</div>
      <div class="idle-skillbuilds-banner-text">Gespeicherter Build: <strong>„${bkmpSkillBuildsEsc(st.slots[suggest].name)}“</strong></div>
      <div class="idle-skillbuilds-actions">
        <button type="button" class="btn-ja" data-skillbuild-action="apply" data-skillbuild-slot="${suggest}" data-testid="skillbuilds-banner-apply">📂 Build anwenden</button>
        <button type="button" class="btn-nein" data-skillbuild-action="dismiss" data-testid="skillbuilds-banner-manual">✋ Manuell verteilen</button>
      </div>
    </div>`;
  }

  const slotsHtml = st.slots.map((b, i) => {
    const p = b ? bkmpSkillBuildProgressOf(b) : null;
    return `<button type="button" class="idle-skillbuild-slot${i === sel ? ' is-selected' : ''}${i === st.active ? ' is-active' : ''}${b ? '' : ' is-empty'}" data-skillbuild-action="select" data-skillbuild-slot="${i}" data-testid="skillbuild-slot-${i}" aria-pressed="${i === sel}">
      <span class="idle-skillbuild-slot-name">${b ? bkmpSkillBuildsEsc(b.name) : `Platz ${i + 1} – leer`}</span>
      <span class="idle-skillbuild-slot-sub">${b ? `${i === st.active ? '● aktiv · ' : ''}${fmt(p.done)} / ${fmt(p.total)} 🔹` : 'noch kein Build'}</span>
    </button>`;
  }).join('');

  let progressLine = '';
  if (activeBuild) {
    const p = bkmpSkillBuildProgressOf(activeBuild);
    progressLine = `<div class="idle-skillbuilds-progress" data-testid="skillbuilds-progress">
      <span class="idle-skillbuilds-progress-text">🌳 Build „${bkmpSkillBuildsEsc(activeBuild.name)}“: <strong>${fmt(p.done)} / ${fmt(p.total)}</strong> Skillpunkte wiederhergestellt${p.complete ? ' ✅' : ''}</span>
      <div class="idle-xp-bar"><div class="idle-xp-fill" style="width:${p.total ? Math.min(100, Math.floor(p.done / p.total * 100)) : 0}%"></div></div>
    </div>`;
    if (!p.complete && Number(bkmpIdleState.skill_points_available || 0) > 0 && !(autoUnlocked && st.auto)) {
      progressLine += `<button type="button" class="btn-ja idle-skillbuilds-continue" data-skillbuild-action="apply" data-skillbuild-slot="${st.active}" data-testid="skillbuilds-continue">📂 Build „${bkmpSkillBuildsEsc(activeBuild.name)}“ weiterbauen</button>`;
    }
  }

  const autoHtml = autoUnlocked
    ? `<label class="idle-skillbuilds-auto" data-testid="skillbuilds-auto">
        <input type="checkbox" data-skillbuild-action="auto" ${st.auto ? 'checked' : ''}>
        <span>🧠 <strong>Auto-Skilltree:</strong> neue Skillpunkte automatisch nach dem aktiven Build verteilen${st.auto && !activeBuild ? ' – <em>wähle zuerst einen Build („Anwenden“)</em>' : ''}</span>
      </label>`
    : '<p class="idle-skillbuilds-auto-locked" data-testid="skillbuilds-auto-locked">🔒 Auto-Skilltree: Prestige-Knoten <strong>🧠 Meister der Pfade</strong> (Zweig ⚙️ Automation).</p>';

  return `<div class="idle-skillbuilds" data-testid="skillbuilds">
    ${banner}
    <div class="idle-skillbuilds-head">
      <span class="idle-skillbuilds-title">🌳 Skilltree-Builds</span>
      <span class="idle-skillbuilds-hint">Vorlage speichern und nach einem Aufstieg mit einem Klick wieder aufbauen – es werden nur deine verfügbaren Punkte ausgegeben.</span>
    </div>
    <div class="idle-skillbuild-slots">${slotsHtml}</div>
    <div class="idle-skillbuilds-actions">
      <button type="button" class="btn-nein" data-skillbuild-action="save" data-testid="skillbuild-save">💾 Build speichern</button>
      <button type="button" class="btn-ja" data-skillbuild-action="apply" data-skillbuild-slot="${sel}" data-testid="skillbuild-apply" ${selBuild ? '' : 'disabled'}>📂 Build anwenden</button>
      <button type="button" class="btn-nein" data-skillbuild-action="rename" data-testid="skillbuild-rename" ${selBuild ? '' : 'disabled'}>✏️ Umbenennen</button>
      <button type="button" class="btn-nein" data-skillbuild-action="delete" data-testid="skillbuild-delete" ${selBuild ? '' : 'disabled'}>🗑️ Löschen</button>
    </div>
    ${progressLine}
    ${autoHtml}
  </div>`;
}

async function bkmpSkillBuildSave(slot) {
  const st = bkmpSkillBuildsState();
  if (!st || !bkmpIdleState) return;
  const defs = typeof bkmpIdleSkillDefs !== 'undefined' ? bkmpIdleSkillDefs : [];
  const known = new Set(defs.map(n => n.id));
  const ranks = {};
  Object.entries(bkmpIdleState.skill_allocations || {}).forEach(([id, r]) => {
    const n = Math.floor(Number(r) || 0);
    if (n > 0 && known.has(id)) ranks[id] = n;
  });
  if (!Object.keys(ranks).length) { bkmpSkillBuildsToast('Noch keine Skillpunkte verteilt – es gibt nichts zu speichern.', 'warning'); return; }
  const existing = st.slots[slot];
  if (existing && typeof bkmpConfirmDialog === 'function') {
    const ok = await bkmpConfirmDialog('💾 Build überschreiben?', `Platz ${slot + 1} enthält bereits „${existing.name}“. Mit deiner aktuellen Verteilung überschreiben?`, 'Überschreiben', 'Abbrechen');
    if (!ok) return;
  }
  const name = existing ? existing.name : BKMP_SKILL_BUILD_DEFAULT_NAMES[slot] || `Build ${slot + 1}`;
  const now = Date.now();
  st.slots[slot] = { name, ranks, savedAt: now };
  st.slotAt[slot] = now;
  st.active = slot; st.activeAt = now;
  bkmpSkillBuildSelectedSlot = slot;
  bkmpSkillBuildsChanged();
  const p = bkmpSkillBuildProgressOf(st.slots[slot]);
  const fmt = typeof bkmpIdleFormatNumber === 'function' ? bkmpIdleFormatNumber : String;
  bkmpSkillBuildsToast(`💾 Build „${name}“ gespeichert (${Object.keys(ranks).length} Knoten, ${fmt(p.total)} Skillpunkte).`, 'success');
  if (typeof bkmpIdleRenderSkilltreePanel === 'function') bkmpIdleRenderSkilltreePanel();
}
async function bkmpSkillBuildDelete(slot) {
  const st = bkmpSkillBuildsState();
  if (!st || !st.slots[slot]) return;
  const name = st.slots[slot].name;
  const ok = typeof bkmpConfirmDialog === 'function'
    ? await bkmpConfirmDialog('🗑️ Build löschen?', `„${name}“ wird gelöscht. Deine aktuell verteilten Skillpunkte bleiben unverändert.`, 'Löschen', 'Abbrechen')
    : window.confirm(`Build „${name}“ löschen?`);
  if (!ok) return;
  const now = Date.now();
  st.slots[slot] = null;
  st.slotAt[slot] = now;
  if (st.active === slot) { st.active = -1; st.activeAt = now; }
  bkmpSkillBuildsChanged();
  bkmpSkillBuildsToast(`🗑️ Build „${name}“ gelöscht.`, 'info');
  if (typeof bkmpIdleRenderSkilltreePanel === 'function') bkmpIdleRenderSkilltreePanel();
}
function bkmpSkillBuildRename(slot) {
  const st = bkmpSkillBuildsState();
  if (!st || !st.slots[slot] || typeof bkmpUiModalHtml !== 'function') return;
  const old = document.getElementById('bkmpSkillBuildRenameOverlay');
  if (old) old.remove();
  document.body.insertAdjacentHTML('beforeend', bkmpUiModalHtml({
    id: 'bkmpSkillBuildRename',
    titleHtml: '✏️ Build umbenennen',
    extraClass: 'idle-skillbuild-rename-card',
    bodyHtml: `<label class="idle-skillbuild-rename-label" for="bkmpSkillBuildRenameInput">Name für Platz ${slot + 1}</label>
      <input type="text" id="bkmpSkillBuildRenameInput" class="idle-skillbuild-rename-input" maxlength="${BKMP_SKILL_BUILD_NAME_MAX}" value="${bkmpSkillBuildsEsc(st.slots[slot].name)}" autocomplete="off">`,
    buttonsHtml: '<button type="button" class="btn-ja" id="bkmpSkillBuildRenameOk">Speichern</button><button type="button" class="btn-nein" id="bkmpSkillBuildRenameCancel">Abbrechen</button>'
  }));
  const overlay = document.getElementById('bkmpSkillBuildRenameOverlay');
  overlay.classList.add('zone-game');
  const input = document.getElementById('bkmpSkillBuildRenameInput');
  const close = () => overlay.remove();
  const submit = () => {
    const name = bkmpSkillBuildCleanName(input.value);
    if (!name) { input.focus(); return; }
    const cur = bkmpSkillBuildsState();
    if (cur && cur.slots[slot]) {
      cur.slots[slot] = { ...cur.slots[slot], name };
      cur.slotAt[slot] = Date.now();
      bkmpSkillBuildsChanged();
    }
    close();
    if (typeof bkmpIdleRenderSkilltreePanel === 'function') bkmpIdleRenderSkilltreePanel();
  };
  document.getElementById('bkmpSkillBuildRenameOk').addEventListener('click', submit);
  document.getElementById('bkmpSkillBuildRenameCancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  if (typeof bkmpUiTrapFocus === 'function') bkmpUiTrapFocus(overlay);
  overlay.classList.add('visible');
  input.focus();
  input.select();
}
function bkmpSkillBuildSetAuto(on) {
  const st = bkmpSkillBuildsState();
  if (!st || !bkmpSkillBuildsAutoUnlocked()) return;
  st.auto = !!on; st.autoAt = Date.now();
  bkmpSkillBuildsChanged();
  if (st.auto) {
    const spent = bkmpSkillBuildsAutoRun('toggle', { quiet: true });
    if (spent > 0) {
      bkmpIdleRecomputeEffectiveStats();
      if (typeof bkmpIdleRenderHud === 'function') bkmpIdleRenderHud();
    }
    const name = bkmpSkillBuildsAutoActiveName();
    bkmpSkillBuildsToast(name ? `🧠 Auto-Skilltree an – neue Skillpunkte fließen in „${name}“.` : '🧠 Auto-Skilltree an – wähle noch einen Build („Anwenden“).', 'success');
  } else {
    bkmpSkillBuildsToast('Auto-Skilltree aus – du verteilst wieder selbst.', 'info');
  }
  if (typeof bkmpIdleRenderSkilltreePanel === 'function') bkmpIdleRenderSkilltreePanel();
}
function bkmpSkillBuildsWire(panel) {
  if (!panel) return;
  panel.querySelectorAll('[data-skillbuild-action]').forEach(el => {
    const action = el.dataset.skillbuildAction;
    const evt = action === 'auto' ? 'change' : 'click';
    el.addEventListener(evt, () => {
      const slotAttr = el.dataset.skillbuildSlot;
      const slot = slotAttr !== undefined ? Number(slotAttr) : bkmpSkillBuildSelectedSlot;
      if (action === 'select') { bkmpSkillBuildSelectedSlot = slot; bkmpIdleRenderSkilltreePanel(); }
      else if (action === 'save') bkmpSkillBuildSave(bkmpSkillBuildSelectedSlot || 0);
      else if (action === 'apply') bkmpSkillBuildApply(slot);
      else if (action === 'rename') bkmpSkillBuildRename(bkmpSkillBuildSelectedSlot || 0);
      else if (action === 'delete') bkmpSkillBuildDelete(bkmpSkillBuildSelectedSlot || 0);
      else if (action === 'dismiss') {
        const st = bkmpSkillBuildsState();
        if (st) { st.dismissedRun = bkmpSkillBuildsPrestigeLevel(); st.dismissedAt = Date.now(); bkmpSkillBuildsChanged(); }
        bkmpIdleRenderSkilltreePanel();
      } else if (action === 'auto') bkmpSkillBuildSetAuto(el.checked);
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    bkmpSkillBuildsEmpty, bkmpSkillBuildsNormalize, bkmpSkillBuildsMerge,
    bkmpSkillBuildEffectiveTargets, bkmpSkillBuildPlan, bkmpSkillBuildProgress
  };
}
