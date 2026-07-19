// Bkmp - Redesign Phase 2b (17.07.): semantisch aus idledorf.js einsortiert (Name-basiert, manuell verifiziert - siehe Chat-Log fuer Grenzfaelle). js/systems/bkmp-skilltree.js


/* ---------------- Skilltree ---------------- */

const BKMP_IDLE_BRANCH_LABELS = { dorf: '🏹 Dorf', burg: '🏰 Burg', wirtschaft: '⚒ Wirtschaft', forschung: '🐉 Forschung', magie: '✨ Magie', meister: '🔨 Meister', zucht: '🐲 Zucht' };
/* "meister" (Zwerg Grimbold) ist bewusst MIT in dieser Liste, obwohl er
   erst nach allen 5 Basis-Zweigen freischaltet - solange die zugehoerigen
   Skill-Knoten in der DB noch nicht existieren (Migration nicht
   ausgefuehrt), filtert bkmpIdleRenderSkilltreePanel ihn automatisch weg
   (leere nodes-Liste), kein Sonderfall noetig. bkmpIdleCountMaxedBranches()
   zaehlt ihn erst mit, sobald er selbst gemaxed ist (vorher 0 Ranege
   allokiert = nicht "maxed") - beeinflusst die bestehende "alle 5 Basis-
   Zweige"-Schwelle also nicht rueckwirkend. */
const BKMP_IDLE_BRANCH_ORDER = ['dorf', 'burg', 'wirtschaft', 'forschung', 'magie', 'meister', 'zucht'];

function bkmpIdleCanAllocateSkill(node) {
  if (!bkmpIdleState) return false;
  const alloc = bkmpIdleState.skill_allocations || {};
  const currentRank = Number(alloc[node.id] || 0);
  if (currentRank >= node.max_rank) return false;
  if (bkmpIdleState.skill_points_available < node.cost_per_rank) return false;
  if (node.requires_node_id) {
    const reqRank = Number(alloc[node.requires_node_id] || 0);
    if (reqRank < node.requires_rank) return false;
  }
  return true;
}

function bkmpIdleAllocateSkill(nodeId) {
  const node = bkmpIdleSkillDefs.find(n => n.id === nodeId);
  if (!node || !bkmpIdleCanAllocateSkill(node)) return;
  const alloc = bkmpIdleState.skill_allocations || (bkmpIdleState.skill_allocations = {});
  alloc[nodeId] = Number(alloc[nodeId] || 0) + 1;
  bkmpIdleState.skill_points_available -= node.cost_per_rank;
  bkmpIdleState.skill_points_spent += node.cost_per_rank;
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleRenderSkilltreePanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

const BKMP_SKILLTREE_RESET_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function bkmpIdleSkilltreeResetCooldownMsLeft() {
  if (!bkmpIdleState || !bkmpIdleState.last_skilltree_reset_at) return 0;
  const last = Date.parse(bkmpIdleState.last_skilltree_reset_at);
  if (isNaN(last)) return 0;
  return Math.max(0, BKMP_SKILLTREE_RESET_COOLDOWN_MS - (Date.now() - last));
}

/* Erstattet alle investierten Skillpunkte (skill_allocations komplett
   geleert, skill_points_available bekommt skill_points_spent zurueck) -
   kein permanenter Verlust, nur eine Umverteilungs-Moeglichkeit. Deshalb
   reicht 1x/Tag als Limit, nicht als harte Strafe gedacht, sondern damit
   nicht bei jedem Kampf hin- und hergeschaltet wird. */
async function bkmpIdleResetSkilltree() {
  if (!bkmpIdleState || bkmpIdleSkilltreeResetCooldownMsLeft() > 0) return;
  const confirmed = await bkmpConfirmDialog(
    '🔄 Skilltree zurücksetzen?',
    'Alle investierten Skillpunkte werden erstattet und können neu verteilt werden.',
    'Zurücksetzen',
    'Abbrechen'
  );
  if (!confirmed) return;
  bkmpIdleState.skill_points_available = Number(bkmpIdleState.skill_points_available || 0) + Number(bkmpIdleState.skill_points_spent || 0);
  bkmpIdleState.skill_points_spent = 0;
  bkmpIdleState.skill_allocations = {};
  bkmpIdleState.last_skilltree_reset_at = new Date().toISOString();
  bkmpIdleRecomputeEffectiveStats();
  bkmpIdleSkillBranchOpenState = null; // nach Reset frisch entscheiden, welcher Zweig aufklappt
  bkmpIdleRenderSkilltreePanel();
  bkmpIdleRenderHud();
  bkmpIdleQueueSync();
}

function bkmpIdleCountMaxedBranches() {
  if (!bkmpIdleState || !bkmpIdleSkillDefs.length) return 0;
  const alloc = bkmpIdleState.skill_allocations || {};
  return BKMP_IDLE_BRANCH_ORDER.filter(branch => {
    const nodes = bkmpIdleSkillDefs.filter(n => n.branch === branch);
    return nodes.length > 0 && nodes.every(n => Number(alloc[n.id] || 0) >= n.max_rank);
  }).length;
}

/* ---------------- Rendering: Skilltree-Tab ---------------- */

/* Tiefe eines Knotens = Anzahl Voraussetzungs-Schritte bis zur Wurzel
   (Knoten ohne requires_node_id). Bestimmt, in welcher Baum-Reihe der
   Knoten gezeichnet wird - Wurzeln oben (Tiefe 0), tiefere Voraussetzungs-
   Ketten darunter. Schutz gegen Ringverweise per seen-Set, falls
   Admin-Daten versehentlich einen Zyklus enthalten. */
function bkmpIdleSkillNodeDepth(node, allNodes) {
  let depth = 0;
  let current = node;
  const seen = new Set();
  while (current && current.requires_node_id && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = allNodes.find(n => n.id === current.requires_node_id);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

/* Zeichnet Verbindungslinien zwischen Eltern-/Kind-Knoten als SVG-Overlay
   ueber dem Baum - nachtraeglich per getBoundingClientRect(), weil die
   Knoten-Positionen erst nach dem eigentlichen HTML-Rendering feststehen
   (Zeilenumbrueche/Breite haengen vom tatsaechlichen Layout ab, nicht
   vorher berechenbar). Linien werden "aktiv" (Gold) gezeichnet, sobald das
   Kind mindestens 1 Rang hat - vorher dezent/grau. */
function bkmpIdleDrawSkillTreeLines(treeEl) {
  const svg = treeEl.querySelector('.idle-skilltree-lines');
  if (!svg) return;
  const containerRect = treeEl.getBoundingClientRect();
  svg.setAttribute('width', containerRect.width);
  svg.setAttribute('height', containerRect.height);
  svg.innerHTML = '';
  treeEl.querySelectorAll('[data-node-id]').forEach(nodeEl => {
    const parentId = nodeEl.dataset.requiresNodeId;
    if (!parentId) return;
    const parentEl = treeEl.querySelector(`[data-node-id="${parentId}"]`);
    if (!parentEl) return;
    const childRect = nodeEl.getBoundingClientRect();
    const parentRect = parentEl.getBoundingClientRect();
    const x1 = parentRect.left - containerRect.left + parentRect.width / 2;
    const y1 = parentRect.top - containerRect.top + parentRect.height;
    const x2 = childRect.left - containerRect.left + childRect.width / 2;
    const y2 = childRect.top - containerRect.top;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', 'idle-skilltree-line' + (nodeEl.classList.contains('ranked') ? ' unlocked' : ''));
    svg.appendChild(line);
  });
}

function bkmpIdleRenderSkilltreePanel() {
  const panel = document.getElementById('idlePanelSkilltree');
  if (!panel || !bkmpIdleState) return;
  if (!bkmpIdleSkillDefs.length) { panel.innerHTML = '<p class="empty-hint">Skilltree wird bald verfügbar sein.</p>'; return; }
  const alloc = bkmpIdleState.skill_allocations || {};

  /* Freischalt-Bedingung fuer den "meister"-Zweig: alle 5 Basis-Zweige
     komplett gemaxed (siehe Kommentar bei BKMP_IDLE_BRANCH_ORDER oben) UND
     die Grimbold-Dialogszene wurde bereits gesehen (sonst bleibt der Zweig
     auch nach Erreichen der Schwelle noch kurz gesperrt angezeigt, bis der
     weiter unten ausgeloeste Dialog abgeschlossen ist - siehe
     bkmpMeisterMaybeShowDialog). */
  const meisterBranchesMaxed = bkmpIdleCountMaxedBranches() >= 5;
  const meisterUnlocked = meisterBranchesMaxed && bkmpMeisterDialogSeen();
  const branches = BKMP_IDLE_BRANCH_ORDER.map(branch => {
    const nodes = bkmpIdleSkillDefs.filter(n => n.branch === branch).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    if (!nodes.length) return null;
    const isLocked = branch === 'meister' && !meisterUnlocked;
    const withDepth = nodes.map(node => ({ node, depth: bkmpIdleSkillNodeDepth(node, nodes) }));
    const maxDepth = Math.max(0, ...withDepth.map(n => n.depth));
    const rows = [];
    for (let d = 0; d <= maxDepth; d++) rows.push(withDepth.filter(n => n.depth === d).map(n => n.node));
    const investedRanks = nodes.reduce((sum, n) => sum + Number(alloc[n.id] || 0), 0);
    const maxRanks = nodes.reduce((sum, n) => sum + Number(n.max_rank || 0), 0);
    const hasAllocatable = !isLocked && nodes.some(n => bkmpIdleCanAllocateSkill(n));
    return { branch, nodes, rows, investedRanks, maxRanks, hasAllocatable, isLocked };
  }).filter(Boolean);

  /* NACHBESSERUNG (Spieler-Wunsch 13.07.: "Dorf ist immer geoeffnet, bitte
     wie die anderen geschlossen anzeigen") - vorher wurde beim ersten
     Rendern automatisch der erste Zweig mit einem gerade kaufbaren Knoten
     aufgeklappt, was durch die Reihenfolge in BKMP_IDLE_BRANCH_ORDER
     praktisch immer "Dorf" traf. Jetzt starten alle Zweige einheitlich
     zugeklappt, der Spieler waehlt selbst. */
  if (!bkmpIdleSkillBranchOpenState) {
    bkmpIdleSkillBranchOpenState = {};
  }

  panel.innerHTML = `
    <div class="idle-skillpoints-row">
      <p class="idle-skillpoints-hint">Verfügbare Skillpunkte: <strong>${bkmpIdleState.skill_points_available}</strong></p>
      <button type="button" class="btn-nein idle-skilltree-help-btn" id="idleSkilltreeHelpBtn">❓ Hilfe</button>
      ${(() => {
        const cooldownMs = bkmpIdleSkilltreeResetCooldownMsLeft();
        if (cooldownMs > 0) {
          const totalMinutes = Math.ceil(cooldownMs / 60000);
          const h = Math.floor(totalMinutes / 60);
          const m = totalMinutes % 60;
          return `<button type="button" class="btn-nein idle-skilltree-reset-btn" disabled>🔄 Reset in ${h}h ${m}min</button>`;
        }
        return `<button type="button" class="btn-nein idle-skilltree-reset-btn" id="idleSkilltreeResetBtn">🔄 Zurücksetzen</button>`;
      })()}
    </div>
    ${branches.map(({ branch, nodes, rows, investedRanks, maxRanks, hasAllocatable, isLocked }) => {
      const isOpen = !!bkmpIdleSkillBranchOpenState[branch];
      if (isLocked) {
        return `<div class="idle-skill-branch idle-skill-branch-locked">
          <button type="button" class="idle-skill-branch-header" data-branch-toggle="${branch}" aria-expanded="${isOpen}">
            <span class="idle-skill-branch-name">${BKMP_IDLE_BRANCH_LABELS[branch] || branch}</span>
            <span class="idle-skill-branch-lock" title="Erst freigeschaltet, wenn alle 5 Basis-Zweige komplett gemaxed sind">🔒</span>
            <span class="idle-skill-branch-chevron">▾</span>
          </button>
          <div class="idle-skill-branch-collapse">
            <div class="idle-skill-branch-collapse-inner">
              <p class="idle-panel-hint idle-skill-branch-locked-hint">🔒 Ein Fremder wartet vor den Toren deines Dorfes - aber er zeigt sich erst, wenn alle 5 Basis-Zweige (Dorf/Burg/Wirtschaft/Forschung/Magie) komplett gemaxed sind.</p>
            </div>
          </div>
        </div>`;
      }
      return `<div class="idle-skill-branch ${isOpen ? 'expanded' : ''} ${hasAllocatable ? 'has-available' : ''}">
        <button type="button" class="idle-skill-branch-header" data-branch-toggle="${branch}" aria-expanded="${isOpen}">
          <span class="idle-skill-branch-name">${BKMP_IDLE_BRANCH_LABELS[branch] || branch}</span>
          <span class="idle-skill-branch-progress">${investedRanks}/${maxRanks} Ränge</span>
          ${hasAllocatable ? '<span class="idle-skill-branch-pulse" title="Hier kannst du gerade einen Punkt ausgeben!"></span>' : ''}
          <span class="idle-skill-branch-chevron">▾</span>
        </button>
        <div class="idle-skill-branch-collapse">
          <div class="idle-skill-branch-collapse-inner">
            <div class="idle-skilltree-tree">
              <svg class="idle-skilltree-lines"></svg>
              ${rows.map(rowNodes => `
                <div class="idle-skilltree-row">
                  ${rowNodes.map(node => {
                    const rank = Number(alloc[node.id] || 0);
                    const canAllocate = bkmpIdleCanAllocateSkill(node);
                    const maxed = rank >= node.max_rank;
                    const parentNode = node.requires_node_id ? nodes.find(n => n.id === node.requires_node_id) : null;
                    return `
                      <div class="idle-skill-node ${rank > 0 ? 'ranked' : ''} ${maxed ? 'maxed' : ''} ${canAllocate && rank === 0 ? 'can-allocate' : ''} ${!node.requires_node_id ? 'is-root' : ''}" data-node-id="${node.id}" ${node.requires_node_id ? `data-requires-node-id="${node.requires_node_id}"` : ''}>
                        <div class="idle-skill-node-icon">${node.icon || '✨'}</div>
                        <div class="idle-skill-node-name">${escapeHtml(node.name)}</div>
                        <div class="idle-skill-node-desc">${escapeHtml(node.description || '')}</div>
                        ${parentNode ? `<div class="idle-skill-node-requires">Braucht ${escapeHtml(parentNode.name)} Rang ${node.requires_rank}</div>` : ''}
                        <div class="idle-skill-node-rank">Rang ${rank}/${node.max_rank}</div>
                        <button type="button" class="btn-ja idle-skill-node-btn" data-node-id="${node.id}" ${!canAllocate ? 'disabled' : ''}>
                          ${maxed ? 'Max' : `+1 (${node.cost_per_rank} 🔹)`}
                        </button>
                      </div>`;
                  }).join('')}
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
    }).join('')}`;
  panel.querySelectorAll('.idle-skill-node-btn').forEach(btn => btn.addEventListener('click', () => bkmpIdleAllocateSkill(btn.dataset.nodeId)));
  /* Verbindungslinien nur fuer bereits aufgeklappte Zweige zeichnen - bei
     collapsed (grid-template-rows:0fr) liefert getBoundingClientRect()
     ueberall (0,0), das Nachzeichnen passiert stattdessen im Toggle-Handler
     unten, sobald ein Zweig tatsaechlich geoeffnet wird. */
  panel.querySelectorAll('.idle-skill-branch.expanded .idle-skilltree-tree').forEach(treeEl => bkmpIdleDrawSkillTreeLines(treeEl));
  panel.querySelectorAll('.idle-skill-branch-header').forEach(header => header.addEventListener('click', () => {
    const branch = header.dataset.branchToggle;
    const branchEl = header.closest('.idle-skill-branch');
    const nowOpen = !branchEl.classList.contains('expanded');
    bkmpIdleSkillBranchOpenState[branch] = nowOpen;
    branchEl.classList.toggle('expanded', nowOpen);
    header.setAttribute('aria-expanded', String(nowOpen));
    if (nowOpen) {
      const treeEl = branchEl.querySelector('.idle-skilltree-tree');
      /* Erst nach der CSS-Aufklapp-Transition zeichnen, sonst hat der
         Baum beim Messen noch die Hoehe 0 (Grid-Zeile startet bei 0fr).
         Bei einem gesperrten Zweig (siehe idle-skill-branch-locked) gibt
         es gar keinen Baum, nur einen Hinweistext - treeEl waere dann
         null. */
      if (treeEl) setTimeout(() => bkmpIdleDrawSkillTreeLines(treeEl), 360);
    }
  }));
  const resetBtn = document.getElementById('idleSkilltreeResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', bkmpIdleResetSkilltree);
  const helpBtn = document.getElementById('idleSkilltreeHelpBtn');
  if (helpBtn) helpBtn.addEventListener('click', bkmpIdleOpenSkillHelp);
  if (meisterBranchesMaxed && !bkmpMeisterDialogSeen()) bkmpMeisterMaybeShowDialog();
}

/* ---------------- Skilltree-Hilfe-Fenster ---------------- */

/* Wandelt effect_type + Gesamtwert (effect_value_per_rank * max_rank, bei
   extra_archer/ballista_unlock zusaetzlich mit dem echten Multiplikator aus
   bkmpIdleRecomputeEffectiveStats) in eine lesbare "bei Max-Rang"-Zeile um.
   Bewusst dieselbe Umrechnung wie dort - wenn sich die Kampfformel je
   aendert, muss nur diese eine Stelle mitgepflegt werden. */
function bkmpIdleSkillEffectAtMaxLabel(node) {
  const total = Number(node.effect_value_per_rank || 0) * Number(node.max_rank || 0);
  const fmt = v => (Math.round(v * 10) / 10).toString().replace('.', ',');
  switch (node.effect_type) {
    case 'attack_pct': case 'attack_speed_pct': case 'crit_chance_pct': case 'crit_chance_flat':
    case 'crit_damage_pct': case 'crit_damage_flat': case 'hp_pct': case 'defense_pct':
    case 'gold_prod_pct': case 'gold_find_pct': case 'xp_pct': case 'loot_chance_pct':
    case 'wood_prod_pct': case 'stone_prod_pct': case 'offline_income_pct': case 'click_damage_pct':
    case 'rune_luck_pct': {
      const labels = {
        attack_pct: 'Angriff', attack_speed_pct: 'Tempo', crit_chance_pct: 'Krit-Chance', crit_chance_flat: 'Krit-Chance',
        crit_damage_pct: 'Krit-Schaden', crit_damage_flat: 'Krit-Schaden', hp_pct: 'Leben', defense_pct: 'Verteidigung',
        gold_prod_pct: 'Gold', gold_find_pct: 'Gold', xp_pct: 'XP', loot_chance_pct: 'Lootchance',
        wood_prod_pct: 'Holz', stone_prod_pct: 'Stein', offline_income_pct: 'Offline-Effizienz', click_damage_pct: 'Klick-Schaden',
        rune_luck_pct: 'Runenglück'
      };
      return `bei Max: +${fmt(total)}% ${labels[node.effect_type]}`;
    }
    case 'attack_flat': return `bei Max: +${fmt(total)} Angriff (fest)`;
    case 'hp_flat': return `bei Max: +${fmt(total)} Leben (fest)`;
    case 'defense_flat': return `bei Max: +${fmt(total)} Verteidigung (fest)`;
    case 'extra_archer': return `bei Max: +${fmt(total * 6)}% Angriff`;
    case 'ballista_unlock': return `bei Max: +${fmt(total * 8)} Angriff (fest)`;
    case 'elem_fire': return `bei Max: ${fmt(Math.min(60, total))}% Feuer-Chance`;
    case 'elem_ice': return `bei Max: ${fmt(Math.min(60, total))}% Einfrier-Chance`;
    case 'elem_lightning': return `bei Max: ${fmt(Math.min(60, total))}% Blitz-Chance`;
    case 'magic_resist_pct': return `bei Max: +${fmt(Math.min(75, total))}% Schadensreduktion`;
    case 'shield_regen': case 'repair_speed_pct': case 'heal_pct':
      return 'Teil der Dorf-Regeneration (siehe Hinweis unten)';
    default: return '';
  }
}

function bkmpIdleOpenSkillHelp() {
  bkmpIdleRenderSkillHelp();
  const overlay = document.getElementById('idleSkillHelpOverlay');
  if (overlay) { overlay.classList.add('visible'); document.body.classList.add('modal-open'); }
}

function bkmpIdleRenderSkillHelp() {
  const list = document.getElementById('idleSkillHelpList');
  if (!list) return;
  if (!bkmpIdleSkillDefs.length) { list.innerHTML = '<p class="empty-hint">Skilltree wird bald verfügbar sein.</p>'; return; }
  list.innerHTML = BKMP_IDLE_BRANCH_ORDER.map(branch => {
    const nodes = bkmpIdleSkillDefs.filter(n => n.branch === branch).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    if (!nodes.length) return '';
    const rows = nodes.map(node => `
      <div class="skillhelp-row">
        <span class="skillhelp-icon">${node.icon || '✨'}</span>
        <div class="skillhelp-body">
          <div class="skillhelp-name">${escapeHtml(node.name)}</div>
          <div class="skillhelp-desc">${escapeHtml(node.description || '')}</div>
        </div>
        <div class="skillhelp-meta">
          <span class="skillhelp-badge">${bkmpIdleSkillEffectAtMaxLabel(node)}</span>
          <span class="skillhelp-cost">Max ${node.max_rank} · ${node.cost_per_rank}🔹/Rang</span>
        </div>
      </div>`).join('');
    return `
      <div class="skillhelp-branch">
        <div class="skillhelp-branch-title">${BKMP_IDLE_BRANCH_LABELS[branch] || branch}</div>
        ${rows}
      </div>`;
  }).join('') + `
    <div class="skillhelp-note">
      <strong>Dorf-Regeneration:</strong> Schildgenerator (Burg), Reparaturtempo (Burg) und Heilung (Magie) speisen gemeinsam die passive Leben-Regeneration pro Kampf-Tick - alle drei maximiert ergeben zusammen ca. 15% Leben-Regeneration pro Tick.<br>
      <strong>Krit-Schaden-Stapel:</strong> Brandpfeile (Dorf) und Dimensionsportal (Magie) addieren sich beide auf denselben Wert.
    </div>`;
}
