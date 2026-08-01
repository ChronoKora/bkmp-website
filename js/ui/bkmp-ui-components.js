// Bkmp - Redesign Phase 3 (17.07.): erste geteilte UI-Komponenten-
// Bibliothek. Bewusst als einfache JS-Factory-Funktionen (HTML-String rein,
// HTML-String raus), passend zum bestehenden Muster der ganzen Codebasis
// (Template-Literal + innerHTML + addEventListener danach) - siehe
// Architektur-Entscheidung im Redesign-Plan: keine Web Components (Shadow
// DOM wuerde design-tokens.css/style.css stillschweigend nicht mehr
// greifen lassen).
//
// Zwei der sechs Funktionen sind in Phase 3 bereits an echter Stelle
// verdrahtet (bkmpUiRarityBadge in renderCosmeticsPanel, bkmpUiLeaderboardRow
// in der Idle-Dorf-Bestenliste) - der Rest (Card/Tooltip/Modal/Toast) ist
// fertig und einsatzbereit, wird aber bewusst noch nirgends erzwungen
// eingesetzt (das passiert planmaessig in Phase 4-6, wenn echte Seiten neu
// gebaut werden - hier nur das Fundament, ohne bestehendes Verhalten
// anzufassen).

/* ---------------- Rarity-Badge ----------------
   Normalisiert die drei im Projekt parallel gewachsenen Rarity-Vokabulare
   (Kosmetik: deutsche Woerter / Runen: Farb-IDs / generisch: englische
   Worte) auf die eine --rarity-*-Skala aus design-tokens.css. */
const BKMP_UI_RARITY_MAP = {
  // Drachenzucht (BKMP_DRAGON_RARITY_META, siehe bkmp-breeding.js) - 'standard'
  // fehlte bisher hier, dadurch bekam ein gewoehnlicher Drache gar keine
  // erkannte Stufe statt der korrekten "Gewoehnlich"-Farbe (Phase 5.5, 19.07.).
  standard: { token: '--rarity-common', label: 'Gewöhnlich' },
  // Kosmetik (window.BKMP_IDLE_COSMETICS, siehe idledorf.js)
  selten: { token: '--rarity-rare', label: 'Selten' },
  episch: { token: '--rarity-epic', label: 'Episch' },
  legendär: { token: '--rarity-legendary', label: 'Legendär' },
  legendaer: { token: '--rarity-legendary', label: 'Legendär' },
  mythisch: { token: '--rarity-mythic', label: 'Mythisch' },
  // Runen (BKMP_RUNE_RARITIES Farb-IDs, siehe bkmp-runes.js)
  gray: { token: '--rarity-common', label: 'Gewöhnlich' },
  grau: { token: '--rarity-common', label: 'Gewöhnlich' },
  green: { token: '--rarity-uncommon', label: 'Ungewöhnlich' },
  blue: { token: '--rarity-rare', label: 'Selten' },
  purple: { token: '--rarity-epic', label: 'Episch' },
  gold: { token: '--rarity-legendary', label: 'Legendär' },
  // generische englische Namen, falls kuenftige Systeme diese nutzen
  common: { token: '--rarity-common', label: 'Common' },
  uncommon: { token: '--rarity-uncommon', label: 'Uncommon' },
  rare: { token: '--rarity-rare', label: 'Rare' },
  epic: { token: '--rarity-epic', label: 'Epic' },
  legendary: { token: '--rarity-legendary', label: 'Legendary' },
  mythic: { token: '--rarity-mythic', label: 'Mythic' },
};

/* Gibt {token, label} zurueck oder null, wenn die Rarity nicht (mehr)
   erkannt wird - Aufrufer sollen in dem Fall einfach nichts rendern statt
   einen kaputten Badge zu zeigen (z.B. Kosmetik ohne rarity-Feld, siehe
   BKMP_COSMETICS in bkmp-site.js - die aeltesten Eintraege haben keins). */
function bkmpUiRarityMeta(rarity) {
  if (!rarity) return null;
  const key = String(rarity).trim().toLowerCase();
  return BKMP_UI_RARITY_MAP[key] || null;
}

function bkmpUiRarityBadge(rarity) {
  const meta = bkmpUiRarityMeta(rarity);
  if (!meta) return '';
  return `<span class="bkmp-ui-rarity-badge" style="--badge-color:var(${meta.token})">${escapeHtml(meta.label)}</span>`;
}

/* ---------------- Leaderboard-Zeile (erweitert bkmpLeaderboardRenderSimpleRow
   aus Phase 2c/bkmp-leaderboard.js um optionale Rarity-Faerbung des Namens -
   z.B. fuer eine kuenftige "Top-Sammler"-Bestenliste, die auch die Seltenheit
   des besten Fundes zeigen will). Ruft bewusst die Phase-2c-Funktion intern
   auf statt sie zu duplizieren - eine Quelle der Wahrheit fuer das
   Zeilen-Markup, dieser Wrapper ergaenzt nur optional das Rarity-Badge. */
function bkmpUiLeaderboardRow(rank, displayName, valueText, isMe, rarity) {
  const badge = rarity ? bkmpUiRarityBadge(rarity) : '';
  if (!badge) return bkmpLeaderboardRenderSimpleRow(rank, displayName, valueText, isMe);
  return `<div class="leaderboard-row ${isMe ? 'is-me' : ''}"><span class="leaderboard-rank">${bkmpUiMedal(rank)}</span><span class="leaderboard-name"><span class="leaderboard-name-text">${escapeHtml(displayName)}</span>${badge}</span><span class="leaderboard-value">${valueText}</span></div>`;
}

/* ---------------- Card ----------------
   Verallgemeinert das ".idle-skin-card"-Muster (Icon/Bild oben, Name,
   Beschreibung, optionale Aktion unten) - bisher an 5+ Stellen in
   idledorf.js/js/systems/*.js einzeln als Template-Literal nachgebaut
   (siehe Audit). Noch nicht adoptiert, siehe Datei-Kommentar oben. */
function bkmpUiCard({ mediaHtml = '', title = '', desc = '', footerHtml = '', rarity = null, extraClass = '', dataAttrs = '' } = {}) {
  const rarityMeta = bkmpUiRarityMeta(rarity);
  const styleAttr = rarityMeta ? ` style="--badge-color:var(${rarityMeta.token})"` : '';
  const rarityClass = rarityMeta ? ' has-rarity' : '';
  return `<div class="bkmp-ui-card idle-skin-card${rarityClass} ${extraClass}"${styleAttr}${dataAttrs ? ' ' + dataAttrs : ''}>
    ${mediaHtml}
    ${title ? `<div class="idle-skin-name">${escapeHtml(title)}</div>` : ''}
    ${desc ? `<div class="idle-skin-desc">${escapeHtml(desc)}</div>` : ''}
    ${footerHtml}
  </div>`;
}

/* ---------------- Tooltip ----------------
   Audit-Fund: die einzige bestehende Tooltip-Komponente (.legend-item) ist
   hover-only und auf Touch unerreichbar, der Rest der Seite nutzt natives
   title="..." (auf den meisten Mobilgeraeten praktisch unsichtbar). Dieser
   Baustein ist tap-fähig (data-bkmp-tooltip-trigger + Klick-Toggle statt nur
   Hover) - noch nicht an bestehende title=-Stellen angeschlossen. */
function bkmpUiTooltipHtml(text, id) {
  return `<span class="bkmp-ui-tooltip" id="${escapeHtml(id)}" role="tooltip">${escapeHtml(text)}</span>`;
}
function bkmpUiWireTooltipTrigger(triggerEl, tooltipEl) {
  if (!triggerEl || !tooltipEl) return;
  triggerEl.setAttribute('aria-describedby', tooltipEl.id);
  const toggle = (show) => tooltipEl.classList.toggle('visible', show ?? !tooltipEl.classList.contains('visible'));
  triggerEl.addEventListener('mouseenter', () => toggle(true));
  triggerEl.addEventListener('mouseleave', () => toggle(false));
  triggerEl.addEventListener('focus', () => toggle(true));
  triggerEl.addEventListener('blur', () => toggle(false));
  /* touchstart statt click: click feuert auf vielen Mobilgeraeten erst nach
     einer 300ms-Verzoegerung/zweitem Tap - touchstart reagiert sofort und
     macht den Tooltip auf Touch tatsaechlich nutzbar (Audit-Kernbeschwerde). */
  triggerEl.addEventListener('touchstart', (e) => { e.preventDefault(); toggle(); }, { passive: false });
}

/* ---------------- Modal ----------------
   Baut auf dem bestehenden .joke-card/.joke-overlay-Muster UND der
   vorhandenen Escape-Close-Registry (BKMP_OVERLAY_CLOSERS, siehe
   bkmp-site.js) auf statt sie zu ersetzen - ergaenzt nur die im Audit
   fehlenden Teile: role="dialog"/aria-modal und einen simplen Tab-Fokus-
   Trap. Noch nicht an bestehende .joke-overlay-Stellen angeschlossen. */
function bkmpUiModalHtml({ id, titleHtml = '', bodyHtml = '', buttonsHtml = '', extraClass = '' } = {}) {
  return `<div class="joke-overlay bkmp-ui-modal-overlay" id="${escapeHtml(id)}Overlay">
    <div class="joke-card ${extraClass}" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(id)}Title">
      ${titleHtml ? `<h3 id="${escapeHtml(id)}Title">${titleHtml}</h3>` : ''}
      ${bodyHtml}
      ${buttonsHtml ? `<div class="joke-buttons">${buttonsHtml}</div>` : ''}
    </div>
  </div>`;
}
function bkmpUiTrapFocus(overlayEl) {
  if (!overlayEl) return;
  overlayEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = overlayEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/* ---------------- Toast ----------------
   Befoerdert das bewaehrte Achievement-Toast-Muster (Konfetti/Warteschlange,
   siehe bkmpShowAchievementPopup in bkmp-site.js) zu einer wiederverwendbaren
   Funktion mit Bedeutungs-Farbe (info/success/warning/danger) - bewusst
   GETRENNT von den Rarity-Farben oben (Audit-Prinzip: Rarity-Farbe !=
   Bedeutungs-Farbe). Noch nicht an bkmpShowJannikToast-Aufrufstellen
   angeschlossen (das bleibt die generische Werkzeug-Funktion fuer einfache
   Text-Hinweise; dieser Baustein ist fuer Momente mit echter Bedeutung). */
const BKMP_UI_TOAST_KIND_TOKEN = { info: '--color-accent-2', success: '--color-positive', warning: '--color-warning', danger: '--color-danger' };
function bkmpUiShowToast({ text, kind = 'info', ms = 3200 } = {}) {
  const token = BKMP_UI_TOAST_KIND_TOKEN[kind] || BKMP_UI_TOAST_KIND_TOKEN.info;
  const toast = document.createElement('div');
  toast.className = 'bkmp-ui-toast';
  toast.style.setProperty('--toast-color', `var(${token})`);
  toast.textContent = text;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, ms);
}

/* ---------------- Gilden-Technologie-Baum (31.07.2026) ----------------
   SVG-Verbindungslinien (eine <line> pro Vorbedingungs-Paar) + darueber-
   liegende, absolut positionierte klickbare Knoten - bewusst KEIN
   <foreignObject> (browseruebergreifende Eigenheiten bei Text/Interaktion
   darin), stattdessen ein einfacher DOM-Overlay auf einem reinen Deko-SVG,
   Positionen kommen 1:1 aus guild_tech_nodes.pos_x/pos_y (Datenbank ist die
   einzige Quelle fuer das Baum-Layout, kein zweiter Positionierungscode).
   nodes = kompletter Katalog (alle 19, ungefiltert - fuer die Vorbedingungs-
   Aufloesung ueber Kategorie-Grenzen hinweg unnoetig, aber unschaedlich),
   progressByNodeId = { [nodeId]: {tier, progressGold} } aus
   bkmpGuildTechGetProgress(), category = 'wachstum'|'schlacht' filtert die
   ANGEZEIGTEN Knoten. */
function bkmpUiGuildTechNodeCost(node, tier) {
  return Math.round(Number(node.base_gold_cost) * Math.pow(Number(node.cost_growth), tier));
}
function bkmpUiGuildTechPrereqsMet(node, nodesById, progressByNodeId) {
  return (node.prereq_node_ids || []).every(prereqId => {
    const prereqNode = nodesById[prereqId];
    const haveTier = (progressByNodeId[prereqId] || {}).tier || 0;
    return prereqNode && haveTier >= prereqNode.max_tier;
  });
}
function bkmpUiGuildTechTreeHtml(nodes, progressByNodeId, category) {
  const nodesById = {};
  nodes.forEach(n => { nodesById[n.id] = n; });
  const visible = nodes.filter(n => n.category === category);
  if (!visible.length) return '<p class="empty-hint">Noch keine Technologien in dieser Kategorie.</p>';

  const xs = visible.map(n => Number(n.pos_x));
  const ys = visible.map(n => Number(n.pos_y));
  const pad = 90;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const width = maxX - minX, height = maxY - minY;

  const lines = [];
  visible.forEach(n => {
    (n.prereq_node_ids || []).forEach(prereqId => {
      const from = nodesById[prereqId];
      if (!from) return; // sollte durch die Katalog-Vollstaendigkeits-Tests nie vorkommen
      const met = bkmpUiGuildTechPrereqsMet(n, nodesById, progressByNodeId);
      lines.push(`<line x1="${Number(from.pos_x) - minX}" y1="${Number(from.pos_y) - minY}" x2="${Number(n.pos_x) - minX}" y2="${Number(n.pos_y) - minY}" class="bkmp-guild-tech-line${met ? ' met' : ''}" />`);
    });
  });

  const nodesHtml = visible.map(n => {
    const progress = progressByNodeId[n.id] || { tier: 0, progressGold: 0 };
    const maxed = progress.tier >= n.max_tier;
    const prereqsMet = bkmpUiGuildTechPrereqsMet(n, nodesById, progressByNodeId);
    const state = maxed ? 'maxed' : (prereqsMet ? 'available' : 'locked');
    const tierCost = maxed ? 0 : bkmpUiGuildTechNodeCost(n, progress.tier);
    const barPct = maxed || !tierCost ? (maxed ? 100 : 0) : Math.min(100, Math.round((progress.progressGold / tierCost) * 100));
    /* Bewusst KEIN disabled-Attribut auf gesperrten Knoten (echte HTML-
       disabled-Buttons feuern keine Klick-Events, ein Spieler koennte dann
       nie erfahren, WELCHE Vorbedingung noch fehlt) - der Klick-Handler
       (bkmpGuildTechOpenContributeModal, js/systems/bkmp-guild-tech.js)
       prueft die Vorbedingung selbst und zeigt stattdessen einen Hinweis-
       Toast. .state-locked traegt die visuelle Sperr-Optik (opacity/cursor)
       rein per CSS. */
    return `<button type="button" class="bkmp-guild-tech-node state-${state}" data-node-id="${escapeHtml(n.id)}" style="left:${Number(n.pos_x) - minX}px; top:${Number(n.pos_y) - minY}px" title="${escapeHtml(n.label)}">
      <span class="bkmp-guild-tech-node-icon">${n.icon || '🌳'}</span>
      <span class="bkmp-guild-tech-node-label">${escapeHtml(n.label)}</span>
      <span class="bkmp-guild-tech-node-tier">${state === 'locked' ? '🔒' : `${progress.tier}/${n.max_tier}`}</span>
      ${!maxed && state !== 'locked' ? `<span class="bkmp-guild-tech-node-bar"><span class="bkmp-guild-tech-node-bar-fill" style="width:${barPct}%"></span></span>` : ''}
    </button>`;
  }).join('');

  return `<div class="bkmp-guild-tech-tree" style="width:${width}px; height:${height}px;">
    <svg class="bkmp-guild-tech-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${lines.join('')}</svg>
    ${nodesHtml}
  </div>`;
}
