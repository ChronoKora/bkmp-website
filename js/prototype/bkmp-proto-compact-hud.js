// PROTOTYP 2 (18.07., ISOLIERT & VOLLSTAENDIG ENTFERNBAR) - kompaktes
// HUD/Nav/Stufenleiste-Layout. Entfernen = diese Datei loeschen + ihr
// <script>-Tag in index.html + den HTML-Block dort + den CSS-Abschnitt
// in style.css (klar markiert). Erzeugt/veraendert KEINE Spielwerte -
// liest nur bestehende Zustaende (bkmpIdleState/bkmpIdleEffectiveStats)
// und loest Aktionen ausschliesslich durch Proxy-Klick auf die
// bestehenden, unveraenderten Buttons bzw. direkten Aufruf derselben
// bereits vorhandenen globalen Funktionen aus - keine neue Tab-/Stufen-/
// Effektmodus-Logik.

const BKMP_PROTO_COMPACT_HUD_ENABLED = true;

// Einfache, einheitliche Strich-Icons (kein Emoji, siehe Nutzer-Vorgabe) -
// bewusst schlicht gehalten (Prototyp-Qualitaet), spaeter durch
// endgueltige Icons ersetzbar, ohne die Struktur hier anzufassen.
const BKMP_PROTO_NAV_ICONS = {
  kampf: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l12 12M16 4L4 16"/><circle cx="4" cy="4" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="4" r="1.3" fill="currentColor" stroke="none"/></svg>',
  upgrades: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16V4M4 10l6-6 6 6"/></svg>',
  skilltree: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14v-4M10 10L5 6M10 10l5-4"/><circle cx="10" cy="16" r="1.8"/><circle cx="5" cy="5" r="1.8"/><circle cx="15" cy="5" r="1.8"/></svg>',
  prestige: '<svg viewBox="0 0 20 20" fill="currentColor" stroke="none"><path d="M10 2l1.8 6.2L18 10l-6.2 1.8L10 18l-1.8-6.2L2 10l6.2-1.8z"/></svg>',
  runen: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><polygon points="10,2 17,6 17,14 10,18 3,14 3,6"/><circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="none"/></svg>'
};

const BKMP_PROTO_NAV_PRIMARY = [
  { id: 'kampf', btn: 'idleTabBtnKampf', label: 'Kampf' },
  { id: 'upgrades', btn: 'idleTabBtnUpgrades', label: 'Upgrades' },
  { id: 'skilltree', btn: 'idleTabBtnSkilltree', label: 'Skilltree' },
  { id: 'prestige', btn: 'idleTabBtnPrestige', label: 'Prestige' },
  { id: 'runen', btn: 'idleTabBtnRunen', label: 'Runen' }
];
const BKMP_PROTO_NAV_SECONDARY = [
  { id: 'erfolge', btn: 'idleTabBtnErfolge', label: 'Erfolge' },
  { id: 'skins', btn: 'idleTabBtnSkins', label: 'Dorf-Skins' },
  { id: 'bestenliste', btn: 'idleTabBtnBestenliste', label: 'Bestenliste' },
  { id: 'drachen', btn: 'idleTabBtnDrachen', label: 'Drachenzucht' },
  { id: 'dungeon', btn: 'idleTabBtnDungeon', label: 'Dungeon' },
  { id: 'turm', btn: 'idleTabBtnTurm', label: 'Turm' },
  { id: 'arena', btn: 'idleTabBtnArena', label: 'Arena' },
  { id: 'gilde', btn: 'idleTabBtnGilde', label: 'Gilde' },
  { id: 'gildetech', btn: 'idleTabBtnGildeTech', label: 'Gilden-Tech' },
  { id: 'gildeboss', btn: 'idleTabBtnGildeBoss', label: 'Gildenboss' }
];

let bkmpProtoChudActivePollStarted = false;

function bkmpProtoChudBuildNav() {
  const primaryEl = document.getElementById('bkmpProtoNavPrimary');
  const moreMenuEl = document.getElementById('bkmpProtoNavMoreMenu');
  if (!primaryEl || !moreMenuEl) return;

  primaryEl.innerHTML = BKMP_PROTO_NAV_PRIMARY.map(t =>
    `<button type="button" class="bkmp-proto-nav-btn" data-proto-tab="${t.id}" data-proto-real-btn="${t.btn}">${BKMP_PROTO_NAV_ICONS[t.id] || ''}<span class="bkmp-proto-nav-label">${t.label}</span></button>`
  ).join('');
  moreMenuEl.innerHTML = BKMP_PROTO_NAV_SECONDARY.map(t =>
    `<button type="button" class="bkmp-proto-nav-more-item" data-proto-tab="${t.id}" data-proto-real-btn="${t.btn}">${t.label}</button>`
  ).join('');

  primaryEl.querySelectorAll('[data-proto-real-btn]').forEach(btn => {
    btn.addEventListener('click', () => bkmpProtoChudActivateTab(btn.dataset.protoRealBtn));
  });
  moreMenuEl.querySelectorAll('[data-proto-real-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      bkmpProtoChudActivateTab(btn.dataset.protoRealBtn);
      bkmpProtoChudCloseMoreMenu();
    });
  });

  const moreBtn = document.getElementById('bkmpProtoNavMoreBtn');
  if (moreBtn) moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = moreMenuEl.style.display !== 'none';
    if (open) bkmpProtoChudCloseMoreMenu(); else bkmpProtoChudOpenMoreMenu();
  });
  document.addEventListener('click', (e) => {
    if (moreMenuEl.style.display === 'none') return;
    /* Das Menue haengt seit dem Portal-Fix (siehe bkmpProtoChudEscapeToOverlay)
       beim Oeffnen nicht mehr unter .bkmp-proto-nav-more-wrap, sondern
       direkt unter #idleDorfOverlay - beide Container muessen hier daher
       als "nicht aussen" gelten, sonst schliesst schon ein Klick auf
       einen Menuepunkt selbst (z. B. Scrollen in der Liste) das Menue
       sofort wieder. */
    if (e.target.closest('.bkmp-proto-nav-more-wrap') || e.target.closest('.bkmp-proto-nav-more-menu')) return;
    bkmpProtoChudCloseMoreMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && moreMenuEl.style.display !== 'none') bkmpProtoChudCloseMoreMenu();
  });
}

// FIX (18.07.): position:fixed allein reichte NICHT, um dem Stacking-
// Context der Karte zu entkommen - fixed aendert nur die visuelle
// Positionsberechnung (Containing Block), nicht die Stacking-Context-
// Zugehoerigkeit, die weiterhin der DOM-Verschachtelung folgt. Das Menue
// haengt urspruenglich unter #bkmpProtoCompactNav (position:relative,
// z-index:1 - erzeugt selbst einen eigenen Stacking-Context) unter
// .idle-dorf-card (z-index:auto) - und weil .idle-dorf-card als GANZES
// nur z-index:auto gegenueber ihrem Geschwister .idle-runen-drawer
// (explizites z-index:56) hat, malt die komplette Karten-Unterbaumstruktur
// IMMER hinter dem Lager-Balken, unabhaengig vom z-index irgendeines
// Nachfahren darin. Einzig wirksamer Fix: das Menue beim Oeffnen per JS
// tatsaechlich im DOM zu #idleDorfOverlay umhaengen (echtes "Portal"-
// Pattern) - dort ist es ein echtes Geschwister von .idle-runen-drawer
// und sein eigener z-index (62) zaehlt endlich wieder normal. Rein
// kosmetisch unveraendert (Position wird ohnehin per JS gesetzt, nicht
// von einem CSS-Vorfahren abgeleitet) - nur die Stacking-Reihenfolge
// aendert sich.
function bkmpProtoChudEscapeToOverlay(menuEl) {
  const overlay = document.getElementById('idleDorfOverlay');
  if (menuEl && overlay && menuEl.parentElement !== overlay) overlay.appendChild(menuEl);
}

// Rechts- und unten-buendig zum Ausloeser-Button, mit 8px Sicherheitsabstand
// zu allen Bildschirmraendern (deckt sowohl sehr schmale Fenster als auch
// sehr breite Dropdown-Inhalte ab, unabhaengig von der Breite des
// jeweiligen urspruenglichen Eltern-Wrappers).
function bkmpProtoChudPositionFixedMenu(menuEl, anchorEl) {
  if (!menuEl || !anchorEl) return;
  const margin = 8;
  const anchorRect = anchorEl.getBoundingClientRect();
  const menuRect = menuEl.getBoundingClientRect();
  let left = anchorRect.right - menuRect.width;
  left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));
  let top = anchorRect.bottom + 6;
  if (top + menuRect.height > window.innerHeight - margin) top = Math.max(margin, anchorRect.top - menuRect.height - 6);
  menuEl.style.left = left + 'px';
  menuEl.style.top = top + 'px';
}

function bkmpProtoChudOpenMoreMenu() {
  const menu = document.getElementById('bkmpProtoNavMoreMenu');
  const btn = document.getElementById('bkmpProtoNavMoreBtn');
  bkmpProtoChudEscapeToOverlay(menu);
  if (menu) menu.style.display = 'grid';
  if (btn) btn.setAttribute('aria-expanded', 'true');
  bkmpProtoChudPositionFixedMenu(menu, btn);
}
function bkmpProtoChudCloseMoreMenu() {
  const menu = document.getElementById('bkmpProtoNavMoreMenu');
  const btn = document.getElementById('bkmpProtoNavMoreBtn');
  if (menu) menu.style.display = 'none';
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

// Proxy-Klick: loest exakt denselben, bereits bestehenden Klick-Handler
// aus (siehe bkmpIdleInitTabs in idledorf.js) - Sperr-Pruefung (Dorf-
// Skins), Panel-Umschaltung, render()-Aufruf, Runen-Lager-Sync laufen
// dadurch unveraendert wie bisher, keine Duplikation.
function bkmpProtoChudActivateTab(realBtnId) {
  const btn = document.getElementById(realBtnId);
  if (btn) btn.click();
  bkmpProtoChudSyncActiveNav();
}

function bkmpProtoChudSyncActiveNav() {
  const active = typeof bkmpIdleActiveTab !== 'undefined' ? bkmpIdleActiveTab : null;
  document.querySelectorAll('#bkmpProtoNavPrimary .bkmp-proto-nav-btn, #bkmpProtoNavMoreMenu .bkmp-proto-nav-more-item').forEach(el => {
    el.classList.toggle('active', el.dataset.protoTab === active);
  });
}

// ---------------- Kompaktes HUD (Level/XP/Ressourcen) ----------------
// Wird per additivem Hook aus bkmpIdleRenderHud() aufgerufen (siehe
// js/ui/bkmp-hud.js) - liest dieselben, dort schon berechneten Werte,
// keine eigene Zustandsberechnung.
function bkmpProtoChudRenderHud() {
  if (!BKMP_PROTO_COMPACT_HUD_ENABLED || !bkmpIdleState) return;
  const levelEl = document.getElementById('bkmpProtoChudLevel');
  const xpFill = document.getElementById('bkmpProtoChudXpFill');
  const xpLabel = document.getElementById('bkmpProtoChudXpLabel');
  const resEl = document.getElementById('bkmpProtoChudResources');
  const detailsEl = document.getElementById('bkmpProtoChudDetails');
  if (!levelEl || !xpFill) return;

  const xpCfg = bkmpIdleConfig.xp_curve || BKMP_IDLE_FALLBACK_CONFIG.xp_curve;
  const xpNeeded = bkmpIdleXpForLevel(bkmpIdleState.level, xpCfg);
  const xpPct = Math.max(0, Math.min(100, (bkmpIdleState.xp / xpNeeded) * 100));
  const s = bkmpIdleEffectiveStats;

  levelEl.textContent = bkmpIdleState.level;
  xpFill.style.width = xpPct + '%';
  if (xpLabel) xpLabel.textContent = `${Math.floor(bkmpIdleState.xp)} / ${xpNeeded} XP${bkmpIdleState.skill_points_available > 0 ? ` · 🔹${bkmpIdleState.skill_points_available}` : ''}`;

  if (resEl) resEl.innerHTML = `
    <span class="bkmp-proto-chud-res"><i class="bkmp-proto-chud-res-icon">💰</i>${bkmpIdleFormatNumber(bkmpIdleState.gold)}</span>
    <span class="bkmp-proto-chud-res"><i class="bkmp-proto-chud-res-icon">🌳</i>${bkmpIdleFormatNumber(bkmpIdleState.wood)}</span>
    <span class="bkmp-proto-chud-res"><i class="bkmp-proto-chud-res-icon">🗿</i>${bkmpIdleFormatNumber(bkmpIdleState.stone)}</span>
    <span class="bkmp-proto-chud-res"><i class="bkmp-proto-chud-res-icon">💎</i>${bkmpIdleFormatNumber(bkmpIdleState.crystals)}</span>
    <span class="bkmp-proto-chud-res"><i class="bkmp-proto-chud-res-icon">🧪</i>${bkmpIdleFormatNumber(bkmpIdleState.essence)}</span>
  `;
  if (detailsEl && s) detailsEl.innerHTML = `
    <span title="Angriff">⚔️ ${bkmpIdleFormatNumber(Math.round(s.attack))}</span>
    <span title="Verteidigung">🛡️ ${bkmpIdleFormatNumber(Math.round(s.defense))}</span>
    <span title="Maximale Leben">❤️ ${bkmpIdleFormatNumber(Math.round(s.hp))}</span>
    <span title="Kritische-Treffer-Chance">🎯 ${s.critChance.toFixed(1)}%</span>
    <span title="Kritischer Schaden">💥 ${Math.round(s.critDamage)}%</span>
    <span title="Angriffstempo">⚡ ${(1000 / (s.tickIntervalMs || 900)).toFixed(2)}/s</span>
    <span title="Glücksfaktor">🍀 +${(s.lootBonus || 0).toFixed(1)}%</span>
    <span title="Insgesamt besiegte Drachen">🐉 ${bkmpIdleFormatNumber(bkmpIdleState.dragon_kills)}</span>
  `;
}

// ---------------- Kompakte Stufenleiste ----------------
// Wird per additivem Hook aus bkmpIdleRenderStageBar() aufgerufen (siehe
// idledorf.js) - ruft fuer Aktionen dieselben bestehenden Funktionen
// direkt auf (bkmpIdleToggleAutoAdvance/-JumpToHighestStage/
// -OpenStagePicker), keine neue Stufen-Logik.
function bkmpProtoChudRenderStageBar() {
  if (!BKMP_PROTO_COMPACT_HUD_ENABLED || !bkmpIdleState) return;
  const el = document.getElementById('bkmpProtoCompactStageBar');
  if (!el) return;
  const current = Number(bkmpIdleState.current_dragon_index || 0);
  const highest = Number(bkmpIdleState.highest_dragon_index || 0);
  const autoAdvance = bkmpIdleState.auto_advance !== false;
  const jumpDisabled = typeof bkmpIdleEventPauseActive !== 'undefined' && bkmpIdleEventPauseActive;

  el.innerHTML = `
    <span>Stufe <strong>${bkmpIdleFormatStage(current)}</strong> · Gesamt <strong>${bkmpIdleFormatNumber(bkmpIdleLifetimeStageCount())}</strong></span>
    <button type="button" class="bkmp-proto-stagebar-icon-btn${autoAdvance ? ' is-on' : ''}" id="bkmpProtoStageAutoBtn" title="${autoAdvance ? 'Steigt automatisch auf (klicken zum Ausschalten)' : 'Bleibt auf dieser Stufe (klicken zum Einschalten)'}">${autoAdvance ? '⬆' : '📍'}</button>
    <button type="button" class="bkmp-proto-stagebar-icon-btn" id="bkmpProtoStagePickerBtn" title="Zu bestimmter Stufe wechseln" ${jumpDisabled ? 'disabled' : ''}>🗺</button>
    ${highest > current ? `<button type="button" class="bkmp-proto-stagebar-btn" id="bkmpProtoStageJumpBtn" ${jumpDisabled ? 'disabled' : ''}>Zur besten Stufe springen</button>` : ''}
  `;
  const autoBtn = document.getElementById('bkmpProtoStageAutoBtn');
  if (autoBtn) autoBtn.addEventListener('click', bkmpIdleToggleAutoAdvance);
  const pickerBtn = document.getElementById('bkmpProtoStagePickerBtn');
  if (pickerBtn) pickerBtn.addEventListener('click', bkmpIdleOpenStagePicker);
  const jumpBtn = document.getElementById('bkmpProtoStageJumpBtn');
  if (jumpBtn) jumpBtn.addEventListener('click', bkmpIdleJumpToHighestStage);
}

// ---------------- Effektmodus-Icon (wiederverwendet Section B) ----------------
/* Nutzerwunsch 19.07.: "Oben rechts ein Menue mit 'Welche Effekte willst du
   deaktivieren?' oeffnen... ich meine wirklich alle Effekte selbst
   auswaehlbar. (Ruhig die 3 Buttons drinlassen...)" - die 3 Presets bleiben
   als Schnellauswahl oben im Menue, darunter jetzt zusaetzlich eine
   Checkbox pro Einzeleffekt (BKMP_FX_TOGGLE_DEFS, idledorf.js). Ein Preset-
   Klick setzt alle Checkboxen passend mit (siehe bkmpFxSetMode ->
   bkmpFxApplyPresetToToggles) - das Menue bleibt danach bewusst offen
   (anders als vorher), damit sichtbar bleibt, was der Preset bewirkt hat,
   und einzelne Haken sich direkt danach noch anpassen lassen. */
function bkmpProtoChudRenderFxMenu() {
  const menu = document.getElementById('bkmpProtoChudFxMenu');
  if (!menu) return;
  const options = [
    { mode: 'hoch', label: '✨ Hoch' },
    { mode: 'reduziert', label: '🔅 Mittel' },
    { mode: 'aus', label: '🚫 Alle aus' }
  ];
  const toggleDefs = typeof BKMP_FX_TOGGLE_DEFS !== 'undefined' ? BKMP_FX_TOGGLE_DEFS : [];
  menu.innerHTML = `
    <div class="bkmp-proto-chud-fx-presets">
      ${options.map(o => `<button type="button" class="bkmp-proto-chud-fx-option" data-proto-fx="${o.mode}">${o.label}</button>`).join('')}
    </div>
    <div class="bkmp-proto-chud-fx-divider"></div>
    <div class="bkmp-proto-chud-fx-title">Welche Effekte willst du deaktivieren?</div>
    <div class="bkmp-proto-chud-fx-toggles">
      ${toggleDefs.map(def => `<label class="bkmp-proto-chud-fx-toggle"><input type="checkbox" data-proto-fx-toggle="${def.id}"><span>${def.label}</span></label>`).join('')}
    </div>
  `;
  /* Bug-Fix (beim eigenen Testen gefunden): ein Klick-Handler, der SEIN
     EIGENES Menue per innerHTML komplett neu aufbaut, loeste beim
     naechsten Bubbling-Schritt versehentlich den globalen "Aussen-Klick
     schliesst das Menue"-Listener (bkmpProtoChudInit) aus - der geklickte
     Button existiert zu dem Zeitpunkt (nach dem innerHTML-Ersatz) nicht
     mehr im DOM, e.target.closest('.bkmp-proto-chud-fx-menu') lieferte
     dadurch null statt das Menue korrekt als "innen" zu erkennen, das
     Menue schloss sich sofort wieder nach jedem Preset-Klick. Deshalb hier
     Markup EINMALIG aufbauen (nur bei bkmpProtoChudOpenFxMenu), Klicks/
     Haken aktualisieren danach nur noch bestehende Knoten in-place statt
     das Menue erneut zu ersetzen. */
  menu.querySelectorAll('[data-proto-fx]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof bkmpFxSetMode === 'function') bkmpFxSetMode(btn.dataset.protoFx);
      bkmpProtoChudUpdateFxIcon();
      bkmpProtoChudSyncFxMenuState();
    });
  });
  menu.querySelectorAll('[data-proto-fx-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      if (typeof bkmpFxToggleSet === 'function') bkmpFxToggleSet(input.dataset.protoFxToggle, input.checked);
    });
  });
  bkmpProtoChudSyncFxMenuState();
}
function bkmpProtoChudSyncFxMenuState() {
  const menu = document.getElementById('bkmpProtoChudFxMenu');
  if (!menu) return;
  const current = typeof bkmpFxGetMode === 'function' ? bkmpFxGetMode() : 'hoch';
  menu.querySelectorAll('[data-proto-fx]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.protoFx === current);
  });
  menu.querySelectorAll('[data-proto-fx-toggle]').forEach(input => {
    input.checked = typeof bkmpFxToggleGet !== 'function' || bkmpFxToggleGet(input.dataset.protoFxToggle);
  });
}
function bkmpProtoChudUpdateFxIcon() {
  const btn = document.getElementById('bkmpProtoChudFxBtn');
  if (!btn) return;
  const mode = typeof bkmpFxGetMode === 'function' ? bkmpFxGetMode() : 'hoch';
  const icons = { hoch: '✨', reduziert: '🔅', aus: '🚫' };
  btn.textContent = icons[mode] || '✨';
  btn.title = 'Effektmodus: ' + mode.charAt(0).toUpperCase() + mode.slice(1);
}
function bkmpProtoChudOpenFxMenu() {
  const menu = document.getElementById('bkmpProtoChudFxMenu');
  const btn = document.getElementById('bkmpProtoChudFxBtn');
  bkmpProtoChudEscapeToOverlay(menu);
  bkmpProtoChudRenderFxMenu();
  if (menu) menu.style.display = 'block';
  if (btn) btn.setAttribute('aria-expanded', 'true');
  bkmpProtoChudPositionFixedMenu(menu, btn);
}
function bkmpProtoChudCloseFxMenu() {
  const menu = document.getElementById('bkmpProtoChudFxMenu');
  const btn = document.getElementById('bkmpProtoChudFxBtn');
  if (menu) menu.style.display = 'none';
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function bkmpProtoChudInit() {
  if (!BKMP_PROTO_COMPACT_HUD_ENABLED) return;
  // Alte Anzeige verstecken (nicht loeschen - bleibt vollstaendiger
  // Fallback, falls der Prototyp spaeter deaktiviert wird), neue zeigen.
  const oldHud = document.getElementById('idleDorfHud');
  const oldTabs = document.getElementById('idleDorfTabs');
  const oldStageBar = document.getElementById('idleStageBar');
  const oldFxBtn = document.getElementById('idleFxModeBtn');
  if (oldHud) oldHud.style.display = 'none';
  if (oldTabs) oldTabs.style.display = 'none';
  if (oldStageBar) oldStageBar.style.display = 'none';
  if (oldFxBtn) oldFxBtn.style.display = 'none';

  const newHud = document.getElementById('bkmpProtoCompactHud');
  const newNav = document.getElementById('bkmpProtoCompactNav');
  const newStageBar = document.getElementById('bkmpProtoCompactStageBar');
  if (newHud) newHud.style.display = '';
  if (newNav) newNav.style.display = '';
  if (newStageBar) newStageBar.style.display = '';

  bkmpProtoChudBuildNav();

  const detailsBtn = document.getElementById('bkmpProtoChudDetailsBtn');
  const detailsPanel = document.getElementById('bkmpProtoChudDetails');
  if (detailsBtn && detailsPanel) detailsBtn.addEventListener('click', () => {
    const open = detailsPanel.style.display !== 'none';
    detailsPanel.style.display = open ? 'none' : 'flex';
    detailsBtn.setAttribute('aria-expanded', String(!open));
  });

  const fxBtn = document.getElementById('bkmpProtoChudFxBtn');
  if (fxBtn) fxBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('bkmpProtoChudFxMenu');
    const open = menu && menu.style.display !== 'none';
    if (open) bkmpProtoChudCloseFxMenu(); else bkmpProtoChudOpenFxMenu();
  });
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('bkmpProtoChudFxMenu');
    if (!menu || menu.style.display === 'none') return;
    if (e.target.closest('.bkmp-proto-chud-icon-btn') || e.target.closest('.bkmp-proto-chud-fx-menu')) return;
    bkmpProtoChudCloseFxMenu();
  });
  bkmpProtoChudUpdateFxIcon();

  // Aktiven Tab periodisch spiegeln - deckt auch programmatische
  // Tab-Wechsel ab, die nicht ueber einen Proxy-Klick liefen (z.B.
  // Deep-Links aus Achievements). Leichtgewichtig, gleiches Muster wie
  // der Sichtbarkeits-Poll der Kampfszene (Section B/Prototyp 1).
  // Bug-Fix 18.07. (Section E, Performance-Untersuchung): lief bisher
  // unconditional fuer immer weiter, auch bei geschlossenem Idle-Dorf-
  // Fenster oder verstecktem Browser-Tab - fuer sich allein sehr billig
  // (nur ein querySelectorAll+classList-Toggle auf wenigen Nav-Buttons),
  // aber unnoetig, siehe dieselbe Sichtbarkeits-Ueberlegung wie bei
  // bkmpIdleCombatVisualsActive(). Gleiches Muster: Intervall bleibt
  // bestehen (kein Neuanlegen noetig), die Arbeit selbst wird uebersprungen.
  if (!bkmpProtoChudActivePollStarted) {
    bkmpProtoChudActivePollStarted = true;
    window.setInterval(() => {
      if (typeof bkmpIdleModalOpen !== 'undefined' && !bkmpIdleModalOpen) return;
      if (document.visibilityState !== 'visible') return;
      bkmpProtoChudSyncActiveNav();
    }, 800);
  }
  bkmpProtoChudSyncActiveNav();
  bkmpProtoChudRenderHud();
  bkmpProtoChudRenderStageBar();
}

bkmpProtoChudInit();
