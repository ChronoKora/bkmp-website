/* Bkmp - Oeffentliches Feedback-, Bug- und Entwicklungsboard (Stufe 1,
   20.07.2026): reiner UI-Prototyp mit LOKALEN Testdaten, siehe Auftrag.
   Ersetzt NICHT das bestehende private Feedback-System (#feedbackOverlay,
   Tabelle public.feedback) - das bleibt unveraendert der einzige Weg, wie
   Spieler etwas EINREICHEN. Dieses Board zeigt nur, was ein Admin manuell
   als "oeffentlich" markiert haette - bis Stufe 2/3 (Datenbank-Freigabe
   abwarten) sind BKMP_FEEDBACK_BOARD_TEST_DATA unten reine Platzhalter, es
   findet KEIN Netzwerk-/Datenbankzugriff statt. Keine echten Spielernamen -
   die zwei Beispiele mit sichtbarem Namen unten sind erfundene Platzhalter
   ("Bärli" o.ae. NICHT verwendet), nicht echte Spieler-Handles.

   Namenskonvention: bkmpFeedbackBoard* (neues, eigenstaendiges Subsystem,
   kollidiert bewusst nicht mit den bestehenden bkmpFeedback*-Funktionen in
   js/core/bkmp-site.js, die das private Formular bedienen). */

/* ---------------- Testdaten (Stufe 1 - ersetzt in Stufe 4 durch echte
   veroeffentlichte Zeilen aus der neuen public.feedback_public-Tabelle,
   siehe Abschlussbericht) ---------------- */
const BKMP_FEEDBACK_BOARD_TEST_DATA = [
  {
    id: 'demo-1',
    kind: 'bug',
    category: 'kampf',
    status: 'veroeffentlicht',
    title: 'Manuelle Klicks wurden teilweise nicht gezählt',
    description: 'Auf einigen Mobilgeräten wurden schnelle manuelle Klicks nicht zuverlässig als Treffer erkannt - besonders beim schnellen Antippen des Drachen.',
    response: 'Wir konnten das Problem reproduzieren. Ursache war eine Überschneidung zwischen der Touch-Erkennung und dem Autoklicker-Schutz, der echte schnelle Klicks fälschlich mit-blockiert hat.',
    impact: null, affectedArea: null, workaround: null,
    plannedRelease: null,
    lastUpdate: '2026-07-20',
    history: [
      { date: '2026-07-18', text: 'Meldung erhalten' },
      { date: '2026-07-18', text: 'Fehler bestätigt' },
      { date: '2026-07-19', text: 'Touch-Erkennung angepasst' },
      { date: '2026-07-20', text: 'Auf Mobilgeräten getestet' },
      { date: '2026-07-20', text: 'Fix veröffentlicht' }
    ]
  },
  {
    id: 'demo-2',
    kind: 'bug',
    category: 'dungeons',
    status: 'behoben',
    title: 'Ei-Dungeon-Versuche regenerierten nicht',
    description: 'Die Versuchsanzahl für den Ei-Dungeon blieb dauerhaft bei 0/5 stehen, obwohl vier Stunden vergangen waren.',
    response: 'Der Regenerations-Zeitstempel wurde bei einem bestimmten Ablauf nicht korrekt fortgeschrieben. Behoben - Versuche füllen sich jetzt wieder zuverlässig alle vier Stunden auf.',
    impact: null, affectedArea: null, workaround: null,
    plannedRelease: null,
    lastUpdate: '2026-07-19',
    history: [
      { date: '2026-07-18', text: 'Meldung erhalten' },
      { date: '2026-07-19', text: 'Ursache gefunden' },
      { date: '2026-07-19', text: 'Fix veröffentlicht' }
    ]
  },
  {
    id: 'demo-3',
    kind: 'bug',
    category: 'mobile',
    status: 'in_arbeit',
    title: 'Kampffeld auf schmalen Mobilgeräten zu klein',
    description: 'Auf einigen Telefonen wirkt das Kampffeld gequetscht, HP-Leisten und Schadenszahlen sind schwer lesbar.',
    response: 'Wir bauen den Kampfbereich für Mobilgeräte gerade komplett neu (eigenes, größeres Layout, bessere Lesbarkeit). Erste Stufe ist intern fertig und wird gerade geprüft.',
    impact: 'Betrifft vor allem schmale Bildschirme (unter ca. 400px Breite).',
    affectedArea: 'Kampfbereich, mobile Ansicht',
    workaround: 'Querformat oder ein etwas breiteres Gerät verbessert die Lesbarkeit vorübergehend.',
    plannedRelease: 'Phase 7',
    lastUpdate: '2026-07-20',
    history: [
      { date: '2026-07-19', text: 'Mehrfach gemeldet' },
      { date: '2026-07-20', text: 'Neues Mobil-Layout in Arbeit' }
    ]
  },
  {
    id: 'demo-4',
    kind: 'bug',
    category: 'runen',
    status: 'bestaetigt',
    title: 'Ausgerüstete Runen setzen sich gelegentlich zurück',
    description: 'Nach kurzem Verlassen und Zurückkehren zum Spiel waren einzelne ausgerüstete Runen wieder als nicht ausgerüstet markiert.',
    response: 'Bestätigt - wir haben die wahrscheinliche Ursache gefunden (eine Speicheranfrage, die beim Verlassen der Seite abgebrochen werden konnte) und arbeiten an einer Absicherung.',
    impact: 'Betrifft Runen, die kurz vor dem Schließen/Wechseln der Seite ausgerüstet wurden.',
    affectedArea: 'Runen-Lager',
    workaround: 'Nach dem Ausrüsten kurz im Spiel bleiben, bevor die Seite gewechselt wird.',
    plannedRelease: null,
    lastUpdate: '2026-07-20',
    history: [
      { date: '2026-07-20', text: 'Meldung erhalten' },
      { date: '2026-07-20', text: 'Ursache gefunden, Absicherung in Arbeit' }
    ]
  },
  {
    id: 'demo-5',
    kind: 'bug',
    category: 'drachen',
    status: 'wartet_auf_asset',
    title: 'Platzhalter-Grafik beim Cyberdrachen',
    description: 'Der Cyberdrache nutzt aktuell noch eine vorläufige Grafik.',
    response: 'Das finale Artwork ist in Arbeit, wir warten auf die letzte Lieferung, bevor wir es einbauen.',
    impact: 'Rein optisch, keine Auswirkung auf Werte oder Kämpfe.',
    affectedArea: 'Drachen-Lexikon, Kampfbereich',
    workaround: null,
    plannedRelease: null,
    lastUpdate: '2026-07-17',
    history: [
      { date: '2026-07-17', text: 'Neue Drachenart hinzugefügt (Platzhalter-Grafik)' }
    ]
  },
  {
    id: 'demo-6',
    kind: 'idea',
    category: 'account',
    status: 'zurueckgestellt',
    title: 'Zweite Meldung zu Kampf-Klicks (Duplikat)',
    description: 'Ähnliche Meldung wie "Manuelle Klicks wurden teilweise nicht gezählt".',
    response: 'Danke für die Meldung - das ist derselbe Fehler wie ein bereits bekannter Bug. Siehe den verlinkten Eintrag für den aktuellen Stand.',
    impact: null, affectedArea: null, workaround: null,
    plannedRelease: null,
    duplicateOfTitle: 'Manuelle Klicks wurden teilweise nicht gezählt',
    status_override_label: 'Duplikat',
    lastUpdate: '2026-07-19',
    history: [
      { date: '2026-07-19', text: 'Als Duplikat markiert' }
    ]
  },
  {
    id: 'demo-7',
    kind: 'idea',
    category: 'gilde',
    status: 'in_entwicklung',
    title: 'Globaler Chat',
    description: 'Ein serverweiter Chat, nicht nur der Gilden-Chat.',
    response: 'Gute Idee, steht schon auf unserer Liste. Wir schauen uns gerade an, wie sich das sauber neben dem bestehenden Gilden-Chat einfügen lässt.',
    impact: null, affectedArea: null, workaround: null,
    plannedRelease: 'Nach Phase 7',
    lastUpdate: '2026-07-18',
    history: [
      { date: '2026-07-16', text: 'Idee eingereicht' },
      { date: '2026-07-18', text: 'Wird geprüft' }
    ]
  },
  {
    id: 'demo-8',
    kind: 'idea',
    category: 'drachen',
    status: 'geplant',
    title: 'Weitere Drachenarten',
    description: 'Mehr Vielfalt bei den normalen Drachen, nicht nur bei Events.',
    response: 'Geplant - weitere Arten sind in Arbeit und werden Stück für Stück ergänzt.',
    impact: null, affectedArea: null, workaround: null,
    plannedRelease: null,
    lastUpdate: '2026-07-18',
    history: [
      { date: '2026-07-16', text: 'Idee eingereicht' },
      { date: '2026-07-18', text: 'Als geplant markiert' }
    ]
  },
  {
    id: 'demo-9',
    kind: 'idea',
    category: 'ui',
    status: 'nicht_geplant',
    title: 'Komplett eigenes Farbschema pro Spieler',
    description: 'Wunsch nach frei wählbaren Farben für die gesamte Oberfläche.',
    response: 'Das ist aktuell nicht geplant - der Aufwand für ein vollständig freies Farbsystem steht im Moment nicht im Verhältnis zum Nutzen. Einzelne Akzentfarben bleiben aber wählbar.',
    impact: null, affectedArea: null, workaround: null,
    plannedRelease: null,
    lastUpdate: '2026-07-15',
    history: [
      { date: '2026-07-14', text: 'Idee eingereicht' },
      { date: '2026-07-15', text: 'Geprüft und zurückgestellt' }
    ]
  }
];

const BKMP_FEEDBACK_STATUS_META = {
  eingegangen: { label: 'Eingegangen', icon: '📥', tone: 'muted' },
  wird_geprueft: { label: 'Wird geprüft', icon: '🔍', tone: 'blue' },
  bestaetigt: { label: 'Bestätigt', icon: '🎯', tone: 'orange' },
  geplant: { label: 'Geplant', icon: '🗓️', tone: 'violet' },
  in_arbeit: { label: 'In Arbeit', icon: '🛠️', tone: 'gold' },
  wartet_auf_asset: { label: 'Wartet auf Asset', icon: '⏳', tone: 'cyan' },
  wartet_auf_rueckmeldung: { label: 'Wartet auf Rückmeldung', icon: '💬', tone: 'cyan' },
  behoben: { label: 'Behoben', icon: '✅', tone: 'green' },
  veroeffentlicht: { label: 'Veröffentlicht', icon: '🚀', tone: 'green' },
  nicht_reproduzierbar: { label: 'Nicht reproduzierbar', icon: '🤷', tone: 'muted' },
  abgelehnt: { label: 'Abgelehnt', icon: '✖️', tone: 'red' },
  duplikat: { label: 'Duplikat', icon: '🔗', tone: 'dim' },
  in_entwicklung: { label: 'In Entwicklung', icon: '🛠️', tone: 'gold' },
  zurueckgestellt: { label: 'Zurückgestellt', icon: '🔗', tone: 'dim' },
  nicht_geplant: { label: 'Nicht geplant', icon: '🚫', tone: 'muted-warm' }
};

const BKMP_FEEDBACK_CATEGORY_META = {
  bug: { label: 'Bug', icon: '🐛' },
  kritik: { label: 'Kritik', icon: '⚠️' },
  verbesserung: { label: 'Verbesserung', icon: '⬆️' },
  idee: { label: 'Idee', icon: '💡' },
  mobile: { label: 'Mobile', icon: '📱' },
  performance: { label: 'Performance', icon: '⚡' },
  ui: { label: 'Benutzeroberfläche', icon: '🎨' },
  kampf: { label: 'Kampf', icon: '⚔️' },
  runen: { label: 'Runen', icon: '🔮' },
  dungeons: { label: 'Dungeons', icon: '🏰' },
  drachen: { label: 'Drachen', icon: '🐉' },
  gilde: { label: 'Gilde', icon: '🛡️' },
  account: { label: 'Account', icon: '👤' },
  sonstiges: { label: 'Sonstiges', icon: '📌' }
};

const BKMP_FEEDBACK_FILTERS = [
  { id: 'alle', label: 'Alle' },
  { id: 'bekannte_bugs', label: 'Bekannte Bugs' },
  { id: 'in_arbeit', label: 'In Arbeit' },
  { id: 'geplant', label: 'Geplant' },
  { id: 'behoben', label: 'Behoben' },
  { id: 'ideen', label: 'Ideen' },
  { id: 'kritik', label: 'Kritik' }
];

let bkmpFeedbackBoardActiveFilter = 'alle';
let bkmpFeedbackBoardSearchTerm = '';
let bkmpFeedbackBoardOpenIds = new Set();
let bkmpFeedbackBoardSearchDebounce = null;

function bkmpFeedbackBoardEscapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bkmpFeedbackBoardFormatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function bkmpFeedbackBoardStatusBadgeHtml(statusKey, overrideLabel) {
  const meta = BKMP_FEEDBACK_STATUS_META[statusKey] || BKMP_FEEDBACK_STATUS_META.eingegangen;
  const label = overrideLabel || meta.label;
  return `<span class="fbb-status fbb-tone-${meta.tone}"><span aria-hidden="true">${meta.icon}</span>${bkmpFeedbackBoardEscapeHtml(label)}</span>`;
}

function bkmpFeedbackBoardCategoryChipHtml(categoryKey) {
  const meta = BKMP_FEEDBACK_CATEGORY_META[categoryKey] || BKMP_FEEDBACK_CATEGORY_META.sonstiges;
  return `<span class="fbb-category"><span aria-hidden="true">${meta.icon}</span>${bkmpFeedbackBoardEscapeHtml(meta.label)}</span>`;
}

/* Ist ein Bug noch "bekannt/offen" im Sinne von Abschnitt 9 des Auftrags -
   bestaetigt, aber noch nicht geloest. */
function bkmpFeedbackBoardIsOpenKnownBug(entry) {
  return entry.kind === 'bug' && ['bestaetigt', 'in_arbeit', 'geplant', 'wartet_auf_asset', 'wartet_auf_rueckmeldung'].includes(entry.status);
}
function bkmpFeedbackBoardIsResolved(entry) {
  return ['behoben', 'veroeffentlicht'].includes(entry.status) && entry.status !== 'duplikat';
}

function bkmpFeedbackBoardMatchesFilter(entry, filterId) {
  switch (filterId) {
    case 'bekannte_bugs': return bkmpFeedbackBoardIsOpenKnownBug(entry);
    case 'in_arbeit': return ['in_arbeit', 'in_entwicklung'].includes(entry.status);
    case 'geplant': return entry.status === 'geplant';
    case 'behoben': return bkmpFeedbackBoardIsResolved(entry);
    case 'ideen': return entry.kind === 'idea';
    case 'kritik': return entry.category === 'kritik';
    default: return true;
  }
}
function bkmpFeedbackBoardMatchesSearch(entry, term) {
  if (!term) return true;
  const haystack = `${entry.title} ${entry.description || ''}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function bkmpFeedbackBoardEntryCardHtml(entry) {
  const isOpen = bkmpFeedbackBoardOpenIds.has(entry.id);
  const statusOverride = entry.status_override_label || null;
  return `
    <article class="fbb-card ${isOpen ? 'is-open' : ''}" data-fbb-id="${bkmpFeedbackBoardEscapeHtml(entry.id)}">
      <button type="button" class="fbb-card-head" aria-expanded="${isOpen}" aria-controls="fbbBody-${bkmpFeedbackBoardEscapeHtml(entry.id)}">
        <span class="fbb-card-head-top">
          ${bkmpFeedbackBoardStatusBadgeHtml(entry.status, statusOverride)}
          ${bkmpFeedbackBoardCategoryChipHtml(entry.category)}
        </span>
        <span class="fbb-card-title">${bkmpFeedbackBoardEscapeHtml(entry.title)}</span>
        <span class="fbb-card-meta">
          <span>Aktualisiert: ${bkmpFeedbackBoardFormatDate(entry.lastUpdate)}</span>
          <svg class="fbb-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </button>
      <div class="fbb-card-body" id="fbbBody-${bkmpFeedbackBoardEscapeHtml(entry.id)}" ${isOpen ? '' : 'hidden'}>
        ${entry.duplicateOfTitle ? `<p class="fbb-duplicate-note">🔗 Gleicher Fehler wie: <strong>${bkmpFeedbackBoardEscapeHtml(entry.duplicateOfTitle)}</strong></p>` : ''}
        ${entry.description ? `<p class="fbb-desc">${bkmpFeedbackBoardEscapeHtml(entry.description)}</p>` : ''}
        ${(entry.impact || entry.affectedArea || entry.workaround) ? `
        <div class="fbb-impact-grid">
          ${entry.affectedArea ? `<div><span class="fbb-impact-label">Betroffen</span><span>${bkmpFeedbackBoardEscapeHtml(entry.affectedArea)}</span></div>` : ''}
          ${entry.impact ? `<div><span class="fbb-impact-label">Auswirkung</span><span>${bkmpFeedbackBoardEscapeHtml(entry.impact)}</span></div>` : ''}
          ${entry.workaround ? `<div><span class="fbb-impact-label">Übergangslösung</span><span>${bkmpFeedbackBoardEscapeHtml(entry.workaround)}</span></div>` : ''}
        </div>` : ''}
        ${entry.response ? `<div class="fbb-response"><span class="fbb-response-label">Antwort des Teams</span><p>${bkmpFeedbackBoardEscapeHtml(entry.response)}</p></div>` : ''}
        ${entry.plannedRelease ? `<p class="fbb-planned">🗓️ Geplant für: ${bkmpFeedbackBoardEscapeHtml(entry.plannedRelease)}</p>` : ''}
        ${Array.isArray(entry.history) && entry.history.length ? `
        <div class="fbb-history">
          <span class="fbb-response-label">Fortschritt</span>
          <ul>
            ${entry.history.map(h => `<li><span class="fbb-history-date">${bkmpFeedbackBoardFormatDate(h.date)}</span><span>${bkmpFeedbackBoardEscapeHtml(h.text)}</span></li>`).join('')}
          </ul>
        </div>` : ''}
      </div>
    </article>`;
}

function bkmpFeedbackBoardToggleEntry(id) {
  if (bkmpFeedbackBoardOpenIds.has(id)) bkmpFeedbackBoardOpenIds.delete(id);
  else bkmpFeedbackBoardOpenIds.add(id);
  bkmpFeedbackBoardRenderList();
}

function bkmpFeedbackBoardWireCardClicks(container) {
  container.querySelectorAll('.fbb-card-head').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.fbb-card');
      if (card) bkmpFeedbackBoardToggleEntry(card.dataset.fbbId);
    });
  });
}

function bkmpFeedbackBoardRenderSummary() {
  const el = document.getElementById('feedbackStatusSummary');
  if (!el) return;
  const knownBugs = BKMP_FEEDBACK_BOARD_TEST_DATA.filter(bkmpFeedbackBoardIsOpenKnownBug).length;
  const inProgress = BKMP_FEEDBACK_BOARD_TEST_DATA.filter(e => ['in_arbeit', 'in_entwicklung'].includes(e.status)).length;
  const resolved = BKMP_FEEDBACK_BOARD_TEST_DATA.filter(bkmpFeedbackBoardIsResolved).length;
  el.innerHTML = `
    <div class="fbb-summary-item"><strong>${knownBugs}</strong><span>bekannte Bug${knownBugs === 1 ? '' : 's'}</span></div>
    <div class="fbb-summary-item"><strong>${inProgress}</strong><span>in Arbeit</span></div>
    <div class="fbb-summary-item"><strong>${resolved}</strong><span>kürzlich behoben</span></div>`;
}

function bkmpFeedbackBoardRenderFilters() {
  const el = document.getElementById('feedbackStatusFilters');
  if (!el) return;
  el.innerHTML = BKMP_FEEDBACK_FILTERS.map(f => `<button type="button" class="fbb-filter-chip ${f.id === bkmpFeedbackBoardActiveFilter ? 'active' : ''}" data-fbb-filter="${f.id}" role="tab" aria-selected="${f.id === bkmpFeedbackBoardActiveFilter}">${bkmpFeedbackBoardEscapeHtml(f.label)}</button>`).join('');
  el.querySelectorAll('.fbb-filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      bkmpFeedbackBoardActiveFilter = btn.dataset.fbbFilter;
      bkmpFeedbackBoardRenderFilters();
      bkmpFeedbackBoardRenderList();
    });
  });
}

function bkmpFeedbackBoardRenderList() {
  const el = document.getElementById('feedbackStatusBody');
  if (!el) return;
  const term = bkmpFeedbackBoardSearchTerm.trim();
  const searched = BKMP_FEEDBACK_BOARD_TEST_DATA.filter(e => bkmpFeedbackBoardMatchesSearch(e, term));

  if (bkmpFeedbackBoardActiveFilter !== 'alle') {
    const items = searched.filter(e => bkmpFeedbackBoardMatchesFilter(e, bkmpFeedbackBoardActiveFilter));
    el.innerHTML = items.length
      ? `<div class="fbb-flat-list">${items.map(bkmpFeedbackBoardEntryCardHtml).join('')}</div>`
      : `<p class="fbb-empty">Keine Einträge in dieser Ansicht.</p>`;
    bkmpFeedbackBoardWireCardClicks(el);
    return;
  }

  const knownBugs = searched.filter(bkmpFeedbackBoardIsOpenKnownBug).sort((a, b) => b.lastUpdate.localeCompare(a.lastUpdate));
  const ideas = searched.filter(e => e.kind === 'idea' && !bkmpFeedbackBoardIsResolved(e)).sort((a, b) => b.lastUpdate.localeCompare(a.lastUpdate));
  const resolved = searched.filter(bkmpFeedbackBoardIsResolved).sort((a, b) => b.lastUpdate.localeCompare(a.lastUpdate));

  let html = '';
  html += `<section class="fbb-section"><h4 class="fbb-section-title">🐛 Bekannte Bugs</h4>${knownBugs.length ? `<div class="fbb-flat-list">${knownBugs.map(bkmpFeedbackBoardEntryCardHtml).join('')}</div>` : '<p class="fbb-empty">Aktuell keine offenen bestätigten Bugs.</p>'}</section>`;
  html += `<section class="fbb-section"><h4 class="fbb-section-title">💡 Ideen &amp; Community-Wünsche</h4>${ideas.length ? `<div class="fbb-flat-list">${ideas.map(bkmpFeedbackBoardEntryCardHtml).join('')}</div>` : '<p class="fbb-empty">Aktuell keine Ideen in Prüfung.</p>'}</section>`;
  html += `<section class="fbb-section fbb-section-resolved"><h4 class="fbb-section-title">✅ Kürzlich behoben</h4>${resolved.length ? `<div class="fbb-flat-list">${resolved.map(bkmpFeedbackBoardEntryCardHtml).join('')}</div>` : '<p class="fbb-empty">Noch nichts veröffentlicht.</p>'}</section>`;

  el.innerHTML = html;
  bkmpFeedbackBoardWireCardClicks(el);
}

/* Merkt sich, welches Element den Dialog geoeffnet hat, damit der Fokus
   beim Schliessen dorthin zurueckkehrt (Barrierefreiheit Abschnitt 17,
   "Dialogfokus korrekt"). */
let bkmpFeedbackBoardLastTrigger = null;

function bkmpFeedbackBoardOpen(triggerEl) {
  const overlay = document.getElementById('feedbackStatusOverlay');
  if (!overlay) return;
  bkmpFeedbackBoardLastTrigger = triggerEl || document.activeElement;
  bkmpFeedbackBoardRenderSummary();
  bkmpFeedbackBoardRenderFilters();
  bkmpFeedbackBoardRenderList();
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');
  const closeButton = document.getElementById('feedbackStatusClose');
  if (closeButton) closeButton.focus();
}
function bkmpFeedbackBoardClose() {
  const overlay = document.getElementById('feedbackStatusOverlay');
  if (overlay) overlay.classList.remove('visible');
  document.body.classList.remove('modal-open');
  if (bkmpFeedbackBoardLastTrigger && typeof bkmpFeedbackBoardLastTrigger.focus === 'function') {
    bkmpFeedbackBoardLastTrigger.focus();
  }
  bkmpFeedbackBoardLastTrigger = null;
}

(function bkmpFeedbackBoardInit() {
  const openButton = document.getElementById('feedbackStatusButton');
  const openFromHint = document.getElementById('feedbackViewKnownBugsBtn');
  const closeButton = document.getElementById('feedbackStatusClose');
  const overlay = document.getElementById('feedbackStatusOverlay');
  const searchInput = document.getElementById('feedbackStatusSearch');

  if (openButton) openButton.addEventListener('click', () => bkmpFeedbackBoardOpen(openButton));
  if (openFromHint) openFromHint.addEventListener('click', () => bkmpFeedbackBoardOpen(openFromHint));
  if (closeButton) closeButton.addEventListener('click', bkmpFeedbackBoardClose);
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) bkmpFeedbackBoardClose(); });
  /* Wiederverwendet die bereits fertige, bisher ungenutzte Fokus-Falle aus
     Phase 3 (js/ui/bkmp-ui-components.js) statt eine eigene zu bauen. */
  if (overlay && typeof bkmpUiTrapFocus === 'function') bkmpUiTrapFocus(overlay);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay && overlay.classList.contains('visible')) bkmpFeedbackBoardClose();
  });
  /* Verzoegert ausgewertet (Performance-Vorgabe Abschnitt 16) - kein
     Re-Render bei jedem einzelnen Tastenanschlag. */
  if (searchInput) searchInput.addEventListener('input', () => {
    window.clearTimeout(bkmpFeedbackBoardSearchDebounce);
    bkmpFeedbackBoardSearchDebounce = window.setTimeout(() => {
      bkmpFeedbackBoardSearchTerm = searchInput.value;
      bkmpFeedbackBoardRenderList();
    }, 200);
  });
})();

/* ================================================================
   Admin-Workflow-Vorschau (Stufe 1, Auftrag Abschnitt 5) - nur ein
   Bedien-PROTOTYP mit lokalem Arbeitsspeicher-Zustand, KEINE Datenbank-
   Anbindung. Laeuft nur, wenn #fbbAdminMock existiert (admin.html) - auf
   index.html ist bkmpFeedbackAdminMockInit() ein reines No-op, da das
   Element dort nicht existiert. Bearbeitet eine Kopie EINES Testeintrags
   (demo-3) direkt im Speicher; ein Neuladen der Seite verwirft jede
   Aenderung wieder, absichtlich - es gibt noch keine Stelle, an der etwas
   dauerhaft gespeichert werden koennte, bevor Stufe 2 (Datenbank) freigegeben
   ist. Die rechte Vorschau-Spalte nutzt bewusst dieselbe
   bkmpFeedbackBoardEntryCardHtml()-Funktion wie das echte oeffentliche
   Board oben, damit die Vorschau nie vom tatsaechlichen Aussehen abweicht. */
let bkmpFeedbackAdminMockEntry = null;

function bkmpFeedbackAdminMockRefreshPreview() {
  const card = document.getElementById('fbbAdminPreviewCard');
  if (!card || !bkmpFeedbackAdminMockEntry) return;
  bkmpFeedbackBoardOpenIds.add(bkmpFeedbackAdminMockEntry.id);
  card.innerHTML = bkmpFeedbackBoardEntryCardHtml(bkmpFeedbackAdminMockEntry);
}

function bkmpFeedbackAdminMockRender() {
  const root = document.getElementById('fbbAdminMock');
  if (!root || !bkmpFeedbackAdminMockEntry) return;
  const e = bkmpFeedbackAdminMockEntry;
  const statusOptions = Object.keys(BKMP_FEEDBACK_STATUS_META).map(k =>
    `<option value="${k}" ${k === e.status ? 'selected' : ''}>${BKMP_FEEDBACK_STATUS_META[k].icon} ${bkmpFeedbackBoardEscapeHtml(BKMP_FEEDBACK_STATUS_META[k].label)}</option>`
  ).join('');
  const categoryOptions = Object.keys(BKMP_FEEDBACK_CATEGORY_META).map(k =>
    `<option value="${k}" ${k === e.category ? 'selected' : ''}>${BKMP_FEEDBACK_CATEGORY_META[k].icon} ${bkmpFeedbackBoardEscapeHtml(BKMP_FEEDBACK_CATEGORY_META[k].label)}</option>`
  ).join('');

  root.innerHTML = `
    <div class="fbb-admin-banner">🧪 <strong>Vorschau (Prototyp, Stufe 1)</strong> — reine Bedienoberfläche mit Testdaten, noch NICHT mit der Datenbank verbunden. Änderungen hier werden nicht gespeichert und gehen bei einem Neuladen verloren.</div>
    <div class="fbb-admin-grid">
      <div class="fbb-admin-form">
        <label class="fbb-admin-publish-toggle">
          <input type="checkbox" id="fbbAdminPublish" checked>
          <span>Veröffentlicht (auf dem öffentlichen Board sichtbar)</span>
        </label>
        <label for="fbbAdminTitle">Öffentlicher Titel</label>
        <input type="text" id="fbbAdminTitle" value="${bkmpFeedbackBoardEscapeHtml(e.title)}">
        <div class="fbb-admin-form-row">
          <div>
            <label for="fbbAdminCategory">Kategorie</label>
            <select id="fbbAdminCategory">${categoryOptions}</select>
          </div>
          <div>
            <label for="fbbAdminStatus">Status</label>
            <select id="fbbAdminStatus">${statusOptions}</select>
          </div>
        </div>
        <label for="fbbAdminDesc">Öffentliche Beschreibung</label>
        <textarea id="fbbAdminDesc" rows="3">${bkmpFeedbackBoardEscapeHtml(e.description || '')}</textarea>
        <label for="fbbAdminResponse">Öffentliche Antwort</label>
        <textarea id="fbbAdminResponse" rows="3">${bkmpFeedbackBoardEscapeHtml(e.response || '')}</textarea>
        <label for="fbbAdminPlanned">Geplante Phase / Version (optional)</label>
        <input type="text" id="fbbAdminPlanned" value="${bkmpFeedbackBoardEscapeHtml(e.plannedRelease || '')}">
        <label>Fortschritt</label>
        <div class="fbb-admin-history-list" id="fbbAdminHistoryList">
          ${e.history.map(h => `<div class="fbb-admin-history-row"><span>${bkmpFeedbackBoardFormatDate(h.date)}</span><span>${bkmpFeedbackBoardEscapeHtml(h.text)}</span></div>`).join('')}
        </div>
        <button type="button" class="edit-btn" id="fbbAdminAddHistory">+ Fortschritt hinzufügen</button>
        <label style="margin-top:0.8rem;">Anzeigename</label>
        <div class="fbb-admin-author-modes">
          <label><input type="radio" name="fbbAdminAuthorMode" value="anonymous" checked> Anonym veröffentlicht</label>
          <label><input type="radio" name="fbbAdminAuthorMode" value="short_name"> Gekürzter Name</label>
          <label><input type="radio" name="fbbAdminAuthorMode" value="full_name"> Vollständiger Name (nur mit ausdrücklicher Zustimmung)</label>
        </div>
      </div>
      <div class="fbb-admin-preview-pane">
        <span class="fbb-admin-preview-label">👁️ So sieht es öffentlich aus</span>
        <div id="fbbAdminPreviewCard"></div>
      </div>
    </div>`;

  const title = document.getElementById('fbbAdminTitle');
  const category = document.getElementById('fbbAdminCategory');
  const status = document.getElementById('fbbAdminStatus');
  const desc = document.getElementById('fbbAdminDesc');
  const response = document.getElementById('fbbAdminResponse');
  const planned = document.getElementById('fbbAdminPlanned');
  const addHistoryBtn = document.getElementById('fbbAdminAddHistory');

  function bindLive(el, prop, evt) {
    if (!el) return;
    el.addEventListener(evt || 'input', () => {
      bkmpFeedbackAdminMockEntry[prop] = el.value;
      bkmpFeedbackAdminMockRefreshPreview();
    });
  }
  bindLive(title, 'title');
  bindLive(category, 'category', 'change');
  bindLive(status, 'status', 'change');
  bindLive(desc, 'description');
  bindLive(response, 'response');
  bindLive(planned, 'plannedRelease');
  if (addHistoryBtn) addHistoryBtn.addEventListener('click', () => {
    const today = new Date().toISOString().slice(0, 10);
    bkmpFeedbackAdminMockEntry.history.push({ date: today, text: 'Neuer Fortschrittseintrag...' });
    bkmpFeedbackAdminMockRender();
  });

  bkmpFeedbackAdminMockRefreshPreview();
}

function bkmpFeedbackAdminMockInit() {
  const root = document.getElementById('fbbAdminMock');
  if (!root) return;
  bkmpFeedbackAdminMockEntry = JSON.parse(JSON.stringify(BKMP_FEEDBACK_BOARD_TEST_DATA.find(x => x.id === 'demo-3')));
  bkmpFeedbackAdminMockRender();
}
bkmpFeedbackAdminMockInit();
