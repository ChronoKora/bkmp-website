// Bkmp - Gilden-Technologie v3 (31.07.2026): Baum-System mit Mitglieder-
// Beitraegen. Ersetzt das fruehere "Anfuehrer/Stellvertreter kauft Raenge
// aus der Gildenkasse"-System VOLLSTAENDIG (siehe js/systems/bkmp-guild.js,
// Kommentar oben bei BKMP_GUILD_TECH_CACHE_KEY, und der Plan
// zazzy-crunching-plum.md). Katalog (guild_tech_nodes) und Fortschritt
// (guild_tech_progress) leben in der Datenbank, nicht mehr im Client-Code -
// siehe sql/20260731-guild-tech-tree-v2-foundation.sql fuer die volle
// Begruendung ("Katalog in der DB statt einer dritten hardcodierten Kopie").
//
// Jedes Gildenmitglied (KEINE Rollenpruefung, das ist der ganze Sinn des
// neuen Systems) kann eigenes Gold in einen freigeschalteten, noch nicht
// vollen Knoten stecken (guild_tech_contribute()-RPC). Ein gemeinsamer,
// taeglich regenerierender Beitragsversuch-Pool (dungeon_regen_calc()
// wiederverwendet, siehe SQL) begrenzt, wie oft pro Tag beigetragen werden
// kann. bkmpGuildTechBonus(key) (js/systems/bkmp-guild.js) bleibt fuer ALLE
// 7+ bestehenden Konsumenten (idledorf.js/bkmp-arena.js/bkmp-runes.js/
// bkmp-events.js/bkmp-prestige.js/bkmp-breeding.js/supabase.js) unveraendert
// die einzige Schnittstelle - dieser Datei obliegt nur, den dahinterliegenden
// localStorage-Cache (BKMP_GUILD_TECH_CACHE_KEY) mit den neuen Tabellen zu
// befuellen.

let bkmpGuildTechNodes = [];
let bkmpGuildTechNodesLoaded = false;
let bkmpGuildTechProgress = {}; // { [nodeId]: { tier, progressGold } }
let bkmpGuildTechProgressLoadedForGuildId = null;
let bkmpGuildTechAttemptStatus = null; // { attempts, maxAttempts, secondsToNext }
let bkmpGuildTechActiveCategory = 'wachstum';
let bkmpGuildTechBusy = false;
let bkmpGuildTechCountdownInterval = null;
let bkmpGuildTechModalNodeId = null;

const BKMP_GUILD_TECH_CATEGORY_LABEL = { wachstum: '🌱 Wachstum', schlacht: '⚔️ Schlacht' };

/* "Willkommenspaket" (guild_willkommenspaket, effect_type 'newMemberBonusUnlock')
   ist ein TOGGLE-Knoten - sein effect_per_tier (1) ist nur ein Freischalt-
   Flag, nicht der tatsaechliche Bonus. Fester Bonus/Fenster bewusst hier als
   Konstante hinterlegt (identisches Prinzip zum abgeloesten
   BKMP_GUILD_NEW_MEMBER_WINDOW_MS/_BONUS_PCT), da die DB-Spalte
   effect_per_tier fuer ALLE Knoten "Betrag pro Stufe" bedeutet und ein
   TOGGLE mit "Betrag bei Freischaltung" semantisch etwas anderes ist. */
const BKMP_GUILD_TECH_NEW_MEMBER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const BKMP_GUILD_TECH_NEW_MEMBER_BONUS_PCT = 10;
/* "Turm-Vorreiter" (guild_turm_vorreiter, effect_type 'towerChampionPctPer10')
   ist ein Sonderfall: der Bonus haengt zusaetzlich von der hoechsten je von
   EINEM Mitglied erreichten Turmstufe ab (loadGuildTowerChampionWave()),
   nicht nur von der eigenen Knoten-Stufe - Gesamtdeckel identisch zum
   abgeloesten System. */
const BKMP_GUILD_TECH_TOWER_CHAMPION_CAP_PCT = 50;

function bkmpGuildTechFormatCountdown(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

async function bkmpGuildTechEnsureNodesLoaded() {
  if (bkmpGuildTechNodesLoaded) return;
  try {
    bkmpGuildTechNodes = await bkmpGuildTechGetNodes();
    bkmpGuildTechNodesLoaded = true;
  } catch (e) { console.warn('Gilden-Technologie-Katalog konnte nicht geladen werden.', e); }
}

async function bkmpGuildTechEnsureProgressLoaded(guildId, force) {
  if (!guildId) { bkmpGuildTechProgress = {}; bkmpGuildTechProgressLoadedForGuildId = null; return; }
  if (!force && bkmpGuildTechProgressLoadedForGuildId === guildId) return;
  try {
    bkmpGuildTechProgress = await bkmpGuildTechGetProgress(guildId);
    bkmpGuildTechProgressLoadedForGuildId = guildId;
  } catch (e) { console.warn('Gilden-Technologie-Fortschritt konnte nicht geladen werden.', e); }
}

/* Aufgerufen von bkmpGuildRefreshTreasuryBonusCache() (js/systems/bkmp-guild.js)
   mit dem bereits geladenen bkmpGuildGetMine()-Ergebnis (kein zweiter
   Netzwerk-Request fuer die Gildenmitgliedschaft selbst noetig). Schreibt
   den kompletten Bonus-Cache (BKMP_GUILD_TECH_CACHE_KEY) neu - jeder
   bestehende gt('key')-Aufrufer in idledorf.js/anderen Dateien liest
   unveraendert genau diese Werte. */
async function bkmpGuildTechRecomputeBonusCache(mine) {
  if (!mine) { try { localStorage.setItem(BKMP_GUILD_TECH_CACHE_KEY, '{}'); } catch (e) {} return; }
  try {
    await bkmpGuildTechEnsureNodesLoaded();
    const progress = await bkmpGuildTechGetProgress(mine.guild.id);
    bkmpGuildTechProgress = progress;
    bkmpGuildTechProgressLoadedForGuildId = mine.guild.id;

    const bonus = {};
    let towerNode = null;
    let welcomeNode = null;
    bkmpGuildTechNodes.forEach(node => {
      if (node.effect_type === 'towerChampionPctPer10') { towerNode = node; return; }
      if (node.effect_type === 'newMemberBonusUnlock') { welcomeNode = node; return; }
      const tier = (progress[node.id] || {}).tier || 0;
      if (tier <= 0) return;
      bonus[node.effect_type] = (bonus[node.effect_type] || 0) + tier * Number(node.effect_per_tier);
    });

    if (towerNode) {
      const tier = (progress[towerNode.id] || {}).tier || 0;
      let championWave = 0;
      if (tier > 0 && typeof loadGuildTowerChampionWave === 'function') {
        const memberIds = (mine.members || []).map(m => m.authUserId);
        try { championWave = await loadGuildTowerChampionWave(memberIds); } catch (e) { championWave = 0; }
      }
      const raw = tier * Number(towerNode.effect_per_tier) * Math.floor(championWave / 10);
      bonus.towerChampionPct = Math.min(BKMP_GUILD_TECH_TOWER_CHAMPION_CAP_PCT, raw);
    }

    if (welcomeNode) {
      const tier = (progress[welcomeNode.id] || {}).tier || 0;
      const joinedAtMs = mine.myJoinedAt ? new Date(mine.myJoinedAt).getTime() : 0;
      const withinWindow = joinedAtMs > 0 && (Date.now() - joinedAtMs) < BKMP_GUILD_TECH_NEW_MEMBER_WINDOW_MS;
      bonus.newMemberBonusPct = (tier >= welcomeNode.max_tier && withinWindow) ? BKMP_GUILD_TECH_NEW_MEMBER_BONUS_PCT : 0;
    }

    localStorage.setItem(BKMP_GUILD_TECH_CACHE_KEY, JSON.stringify(bonus));
  } catch (e) { /* offline/kein Login - alter Cache-Stand bleibt bestehen, gleiches Prinzip wie im aeusseren try/catch von bkmpGuildRefreshTreasuryBonusCache() */ }
}

/* ---------------- Rendering: Gilden-Technologie-Tab ---------------- */
async function bkmpIdleRenderGildeTechPanel() {
  const panel = document.getElementById('idlePanelGildeTech');
  if (!panel) return;

  if (!bkmpGuildLoaded && !bkmpGuildLoading) await bkmpGuildLoadAll();

  if (!bkmpGuildMyAuthUserId) {
    panel.innerHTML = `<div class="idle-dungeon-intro"><h4>🌳 Gilden-Technologie</h4><p>Melde dich mit deinem Spieler-Konto an, um an der Gilden-Technologie teilzunehmen.</p></div>`;
    return;
  }
  if (!bkmpGuildState) {
    panel.innerHTML = `<div class="idle-dungeon-intro"><h4>🌳 Gilden-Technologie</h4><p>Du musst Mitglied einer Gilde sein, um an der Gilden-Technologie teilzunehmen. Tritt im Gilde-Tab einer Gilde bei oder gründe eine.</p></div>`;
    return;
  }

  await bkmpGuildTechEnsureNodesLoaded();
  await bkmpGuildTechEnsureProgressLoaded(bkmpGuildState.guild.id);
  let attemptsFetchFailed = false;
  if (!bkmpGuildTechAttemptStatus) {
    try { bkmpGuildTechAttemptStatus = await bkmpGuildTechGetAttemptStatus(); } catch (e) { bkmpGuildTechAttemptStatus = null; }
    attemptsFetchFailed = !bkmpGuildTechAttemptStatus;
  }

  /* Bug gefunden 01.08.2026 (Live-Report: "0/5 - Naechster in 00:00:00"
     blieb auf einer frischen Panel-Ansicht dauerhaft haengen, nicht nur
     kurz nach einem Beitrag - der bereits gefixte Fall unten). Ursache:
     schlaegt DIESER allererste bkmpGuildTechGetAttemptStatus()-Aufruf fehl
     (z.B. kurzer Netzwerk-Haenger), bleibt bkmpGuildTechAttemptStatus NULL
     - der Fallback-Platzhalter unten wird dann zwar einmalig angezeigt,
     aber bkmpGuildTechStartCountdownTicker() bricht bei einem NULL-Status
     sofort wieder ab (siehe deren eigener Kommentar), OHNE je einen erneuten
     Versuch zu starten - die irrefuehrende "0/5, 00:00:00"-Anzeige blieb
     dadurch fuer immer stehen, bis der Spieler den Tab verlaesst und neu
     oeffnet. Fix: bei einem fehlgeschlagenen ALLERERSTEN Ladeversuch zeigt
     die Zeile jetzt ehrlich "wird geladen..." statt einer erfundenen 0/5-
     Zahl, UND ein einmaliger automatischer Nachlade-Versuch nach 3s wird
     geplant (identisches Wiederholungs-Prinzip wie der bereits bestehende
     Ticker-Selbstheilungs-Mechanismus, nur fuer den Fall, dass dieser gar
     nicht erst starten konnte). */
  if (attemptsFetchFailed) {
    setTimeout(() => { if (bkmpIdleActiveTab === 'gildetech') bkmpIdleRenderGildeTechPanel(); }, 3000);
  }

  const attempts = bkmpGuildTechAttemptStatus || { attempts: 0, maxAttempts: 5, secondsToNext: 0 };
  const leaderboard = (bkmpGuildState.members || [])
    .filter(m => Number(m.techContributedGold || 0) > 0)
    .sort((a, b) => Number(b.techContributedGold || 0) - Number(a.techContributedGold || 0));

  panel.innerHTML = `
    <div class="idle-dungeon-intro">
      <h4>🌳 Gilden-Technologie</h4>
      <p>Trage mit eigenem Gold zum gemeinsamen Fortschritt deiner Gilde bei - jede Stufe schaltet dauerhafte Boni für ALLE Mitglieder frei. Jedes Mitglied darf beitragen, unabhängig von der Rolle.</p>
      <p class="idle-guild-tech-attempts">${attemptsFetchFailed ? '🎲 Beitragsversuche heute: <em>wird geladen…</em>' : `🎲 Beitragsversuche heute: <strong>${attempts.attempts}/${attempts.maxAttempts}</strong>${attempts.attempts < attempts.maxAttempts ? ` &middot; Nächster in <span id="idleGuildTechCountdown">${bkmpGuildTechFormatCountdown(attempts.secondsToNext)}</span>` : ''}`}</p>
    </div>
    <div class="idle-guild-tech-category-tabs">
      <button type="button" class="idle-guild-tech-category-tab ${bkmpGuildTechActiveCategory === 'wachstum' ? 'active' : ''}" data-category="wachstum">${BKMP_GUILD_TECH_CATEGORY_LABEL.wachstum}</button>
      <button type="button" class="idle-guild-tech-category-tab ${bkmpGuildTechActiveCategory === 'schlacht' ? 'active' : ''}" data-category="schlacht">${BKMP_GUILD_TECH_CATEGORY_LABEL.schlacht}</button>
    </div>
    <div class="idle-guild-tech-tree-wrap" id="idleGuildTechTreeWrap">
      ${bkmpUiGuildTechTreeHtml(bkmpGuildTechNodes, bkmpGuildTechProgress, bkmpGuildTechActiveCategory)}
    </div>
    <div class="idle-arena-history">
      <h4 style="margin-top:1rem;">🏆 Technologie-Rangliste</h4>
      ${leaderboard.length === 0 ? '<p class="empty-hint">Noch keine Beiträge.</p>' : leaderboard.map((m, i) => `
        <div class="idle-arena-opponent-card">
          <span class="idle-arena-opponent-name">${BKMP_GUILD_MEDALS[i] || `${i + 1}.`} ${escapeHtml(m.displayName)}</span>
          <span class="idle-arena-opponent-rating">${bkmpIdleFormatNumber(m.techContributedGold)} 💰</span>
        </div>
      `).join('')}
    </div>
  `;

  panel.querySelectorAll('.idle-guild-tech-category-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      bkmpGuildTechActiveCategory = btn.dataset.category;
      bkmpIdleRenderGildeTechPanel();
    });
  });
  panel.querySelectorAll('.bkmp-guild-tech-node').forEach(btn => {
    btn.addEventListener('click', () => bkmpGuildTechOpenContributeModal(btn.dataset.nodeId));
  });

  bkmpGuildTechStartCountdownTicker();
}

function bkmpGuildTechStartCountdownTicker() {
  if (bkmpGuildTechCountdownInterval) { clearInterval(bkmpGuildTechCountdownInterval); bkmpGuildTechCountdownInterval = null; }
  bkmpGuildTechCountdownInterval = setInterval(() => {
    if (bkmpIdleActiveTab !== 'gildetech' || !bkmpGuildTechAttemptStatus) {
      clearInterval(bkmpGuildTechCountdownInterval);
      bkmpGuildTechCountdownInterval = null;
      return;
    }
    if (bkmpGuildTechAttemptStatus.attempts >= bkmpGuildTechAttemptStatus.maxAttempts) {
      clearInterval(bkmpGuildTechCountdownInterval);
      bkmpGuildTechCountdownInterval = null;
      return;
    }
    bkmpGuildTechAttemptStatus.secondsToNext = Math.max(0, Number(bkmpGuildTechAttemptStatus.secondsToNext || 0) - 1);
    if (bkmpGuildTechAttemptStatus.secondsToNext <= 0) {
      clearInterval(bkmpGuildTechCountdownInterval);
      bkmpGuildTechCountdownInterval = null;
      bkmpGuildTechGetAttemptStatus().then(status => {
        if (status) bkmpGuildTechAttemptStatus = status;
        bkmpIdleRenderGildeTechPanel();
      }).catch(() => {});
      return;
    }
    const el = document.getElementById('idleGuildTechCountdown');
    if (el) el.textContent = bkmpGuildTechFormatCountdown(bkmpGuildTechAttemptStatus.secondsToNext);
  }, 1000);
}

/* ---------------- Beitrags-Modal (bkmpUiModalHtml/bkmpUiTrapFocus,
   js/ui/bkmp-ui-components.js, Phase 3 - erster echter Einsatz auf dem
   Idle-Dorf selbst) ---------------- */
function bkmpGuildTechEnsureModalInDom() {
  if (document.getElementById('bkmpGuildTechContributeOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', bkmpUiModalHtml({
    id: 'bkmpGuildTechContribute',
    titleHtml: '<span id="bkmpGuildTechModalTitle"></span>',
    bodyHtml: `
      <p id="bkmpGuildTechModalDesc"></p>
      <p id="bkmpGuildTechModalProgress" class="idle-guild-tech-modal-progress"></p>
      <div class="idle-guild-quest-bar"><div class="idle-guild-quest-fill" id="bkmpGuildTechModalBarFill" style="width:0%"></div></div>
      <p id="bkmpGuildTechModalMeta" class="idle-guild-tech-modal-meta"></p>
    `,
    buttonsHtml: `
      <button type="button" class="btn-ja" id="bkmpGuildTechModalContributeBtn">Beitragen</button>
      <button type="button" class="btn-nein" id="bkmpGuildTechModalCloseBtn">Schließen</button>
    `
  }));
  const overlay = document.getElementById('bkmpGuildTechContributeOverlay');
  bkmpUiTrapFocus(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('visible'); });
  document.getElementById('bkmpGuildTechModalCloseBtn').addEventListener('click', () => overlay.classList.remove('visible'));
  document.getElementById('bkmpGuildTechModalContributeBtn').addEventListener('click', bkmpGuildTechHandleContributeClick);
}

function bkmpGuildTechRenderModalContent() {
  const node = bkmpGuildTechNodes.find(n => n.id === bkmpGuildTechModalNodeId);
  if (!node) return;
  const progress = bkmpGuildTechProgress[node.id] || { tier: 0, progressGold: 0 };
  const maxed = progress.tier >= node.max_tier;
  const attempts = bkmpGuildTechAttemptStatus || { attempts: 0, maxAttempts: 5 };

  document.getElementById('bkmpGuildTechModalTitle').textContent = `${node.icon || '🌳'} ${node.label}`;
  document.getElementById('bkmpGuildTechModalDesc').textContent = node.description;

  const tierCost = maxed ? 0 : bkmpUiGuildTechNodeCost(node, progress.tier);
  document.getElementById('bkmpGuildTechModalProgress').textContent = maxed
    ? `Maximalstufe erreicht (${node.max_tier}/${node.max_tier}).`
    : `Stufe ${progress.tier}/${node.max_tier} - Fortschritt: ${bkmpIdleFormatNumber(progress.progressGold)} / ${bkmpIdleFormatNumber(tierCost)} Gold`;

  const barPct = maxed ? 100 : (tierCost > 0 ? Math.min(100, Math.round((progress.progressGold / tierCost) * 100)) : 0);
  document.getElementById('bkmpGuildTechModalBarFill').style.width = barPct + '%';

  const contributionStep = maxed ? 0 : Math.round(tierCost / Math.max(1, node.attempts_per_tier));
  document.getElementById('bkmpGuildTechModalMeta').textContent = maxed
    ? ''
    : `Ein Beitrag kostet ~${bkmpIdleFormatNumber(contributionStep)} Gold. Beitragsversuche heute: ${attempts.attempts}/${attempts.maxAttempts}.`;

  const btn = document.getElementById('bkmpGuildTechModalContributeBtn');
  btn.disabled = maxed || attempts.attempts <= 0 || bkmpGuildTechBusy;
  btn.textContent = bkmpGuildTechBusy ? '⏳ ...' : (maxed ? 'Maximalstufe erreicht' : (attempts.attempts <= 0 ? 'Keine Versuche übrig' : 'Beitragen'));
}

function bkmpGuildTechOpenContributeModal(nodeId) {
  const node = bkmpGuildTechNodes.find(n => n.id === nodeId);
  if (!node) return;
  const nodesById = {};
  bkmpGuildTechNodes.forEach(n => { nodesById[n.id] = n; });
  if (!bkmpUiGuildTechPrereqsMet(node, nodesById, bkmpGuildTechProgress)) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast('🔒 Die Vorbedingungen für diese Technologie sind noch nicht erfüllt.', 3000);
    return;
  }
  bkmpGuildTechEnsureModalInDom();
  bkmpGuildTechModalNodeId = nodeId;
  bkmpGuildTechRenderModalContent();
  document.getElementById('bkmpGuildTechContributeOverlay').classList.add('visible');
}

async function bkmpGuildTechHandleContributeClick() {
  if (bkmpGuildTechBusy || !bkmpGuildTechModalNodeId) return;
  bkmpGuildTechBusy = true;
  bkmpGuildTechRenderModalContent();
  const nodeId = bkmpGuildTechModalNodeId;
  const node = bkmpGuildTechNodes.find(n => n.id === nodeId);
  const wasTier = (bkmpGuildTechProgress[nodeId] || {}).tier || 0;
  try {
    const result = await bkmpGuildTechContribute(nodeId);
    if (result) {
      bkmpGuildTechProgress[nodeId] = { tier: result.newTier, progressGold: result.newProgressGold };
      /* Bug gefunden 01.08.2026 (Nutzer-Screenshot: "0/5 - Naechster in
         00:00:00", per Diagnose-Test reproduziert): guild_tech_contribute()
         liefert seconds_to_next_attempt IMMER als 0 zurueck (echte Berechnung
         braucht den vollen guild_tech_attempt_status()-Aufruf, siehe Kommentar
         in der SQL-Funktion) - das reine Patchen von .attempts liess
         .secondsToNext dadurch auf dem alten Stand (0, "voll") stehen, obwohl
         gerade der letzte Versuch verbraucht wurde. Zeigte kurzzeitig einen
         falschen "00:00:00"-Countdown an, bis der Ticker eine Sekunde spaeter
         selbst nachlud (siehe bkmpGuildTechStartCountdownTicker unten) - fuer
         den Spieler wirkte das wie ein haengender Countdown. Fix: sofort nach
         jedem Beitrag den echten Stand nachladen statt nur zu patchen, damit
         gar kein falscher Zwischenzustand mehr sichtbar wird. */
      try {
        const freshStatus = await bkmpGuildTechGetAttemptStatus();
        if (freshStatus) bkmpGuildTechAttemptStatus = freshStatus;
        else if (bkmpGuildTechAttemptStatus) bkmpGuildTechAttemptStatus.attempts = result.attemptsLeft;
      } catch (e) {
        if (bkmpGuildTechAttemptStatus) bkmpGuildTechAttemptStatus.attempts = result.attemptsLeft;
      }
      /* Server hat das Gold bereits abgezogen (siehe guild_tech_contribute())
         - gleiches Muster wie bkmpGuildContribute()/Upgrade-Kaeufe: lokalen
         Stand sofort nachziehen, sonst ueberschreibt der naechste Autosave
         den serverseitig schon reduzierten Wert. */
      bkmpIdleState.gold -= result.goldSpent;
      if (typeof bkmpIdleRenderHud === 'function') bkmpIdleRenderHud();
      if (typeof bkmpIdleQueueSync === 'function') bkmpIdleQueueSync();

      if (bkmpGuildState) {
        bkmpGuildState.myTechContributedGold = Number(bkmpGuildState.myTechContributedGold || 0) + result.goldSpent;
        const me = (bkmpGuildState.members || []).find(m => m.authUserId === bkmpGuildMyAuthUserId);
        if (me) me.techContributedGold = Number(me.techContributedGold || 0) + result.goldSpent;
      }

      if (result.newTier > wasTier && node) {
        if (typeof bkmpUiShowToast === 'function') bkmpUiShowToast({ text: `🎉 ${node.label} auf Stufe ${result.newTier}!`, kind: 'success', ms: 3600 });
        /* Ein Stufenaufstieg kann Bonus-Werte veraendern (z.B. eigenes
           Kriegsrat-Tageslimit, Nachtwache-Offline-Deckel) - Cache sofort
           nachziehen statt auf den naechsten bkmpGuildRefreshTreasuryBonusCache()-
           Aufruf zu warten. */
        if (typeof bkmpGuildRefreshTreasuryBonusCache === 'function') bkmpGuildRefreshTreasuryBonusCache();
      } else if (typeof bkmpShowJannikToast === 'function') {
        bkmpShowJannikToast(`💰 ${bkmpIdleFormatNumber(result.goldSpent)} Gold beigetragen.`, 2400);
      }
    }
  } catch (e) {
    if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(e.message, 3400);
  }
  bkmpGuildTechBusy = false;
  bkmpGuildTechRenderModalContent();
  /* Baum + Rangliste im Hintergrund aktualisieren - das Modal haengt als
     Geschwister von #idlePanelGildeTech direkt in document.body (siehe
     bkmpGuildTechEnsureModalInDom), ein voller Panel-Re-Render loescht das
     Modal also nicht, gleiches Prinzip wie bei jedem anderen Klick-Handler
     in js/systems/bkmp-guild.js (z.B. bkmpIdleRenderGildePanel() nach
     bkmpGuildContribute()). */
  bkmpIdleRenderGildeTechPanel();
}
