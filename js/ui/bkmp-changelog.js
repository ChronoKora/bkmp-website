/* Bkmp - Oeffentliches Changelog (26.07.2026, Nutzer-Wunsch: "ich will das
   wir so eine Art Changelog haben, was bei jedem Fix/Update wenn wir dann
   commiten dort steht als Eintrag"). Eigenstaendig, getrennt vom
   bestehenden Feedback-/Status-Board (js/ui/bkmp-feedback-board.js,
   public.feedback_public) - das Board beantwortet "wie ist der Stand einer
   Spieler-Meldung" (Status-Workflow, Fortschrittsverlauf), dieses
   Changelog beantwortet die andere Frage "was wurde zuletzt tatsaechlich
   geaendert" - reine, kurze, bereits abgeschlossene Eintraege,
   chronologisch, ohne Status-Workflow.

   Recherche (Nutzerwunsch "durchsuche ruhig das Internet") zu SaaS-
   Changelog-Mustern (Linear/Figma/Framer u.ae., siehe Chat fuer Quellen):
   vertikale, chronologische Liste, Kategorie-Badges statt aufwendiger
   Bilder, haeufige kleine Eintraege statt seltener grosser Sammel-Updates,
   Typografie-first. Genau dieses Muster wird hier umgesetzt.

   Datenquelle: public.changelog_entries (sql/20260726-changelog.sql, noch
   nicht ausgefuehrt) ueber loadChangelogEntries()/upsertChangelogEntry()/
   deleteChangelogEntry() in supabase.js. Bricht das Laden ab (Migration
   noch nicht gelaufen), zeigt das Panel einen ehrlichen Hinweis statt
   stillschweigend leer zu wirken - gleiches Prinzip wie beim Feedback-
   Board (bkmpFeedbackBoardEnsureDataLoaded). */

const BKMP_CHANGELOG_CATEGORY_META = {
  fix: { label: 'Fix', icon: '🔧', tone: 'green' },
  feature: { label: 'Neu', icon: '✨', tone: 'gold' },
  change: { label: 'Änderung', icon: '🔄', tone: 'blue' },
  balance: { label: 'Balance', icon: '⚖️', tone: 'violet' }
};

const BKMP_CHANGELOG_FILTERS = [
  { id: 'alle', label: 'Alle' },
  { id: 'fix', label: '🔧 Fix' },
  { id: 'feature', label: '✨ Neu' },
  { id: 'change', label: '🔄 Änderung' },
  { id: 'balance', label: '⚖️ Balance' }
];

let bkmpChangelogActiveFilter = 'alle';
let bkmpChangelogActiveData = null;
let bkmpChangelogLoadError = false;
let bkmpChangelogLoading = false;
let bkmpChangelogLastTrigger = null;

function bkmpChangelogEscapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bkmpChangelogFormatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* Wiederverwendet die bereits vorhandenen .fbb-status/.fbb-tone-*-Klassen
   (Feedback-Board, style.css) fuer den farbigen Kategorie-Chip - gleiches
   visuelles Muster, keine doppelte CSS-Definition noetig. */
function bkmpChangelogCategoryBadgeHtml(categoryKey) {
  const meta = BKMP_CHANGELOG_CATEGORY_META[categoryKey] || BKMP_CHANGELOG_CATEGORY_META.fix;
  return `<span class="fbb-status fbb-tone-${meta.tone}"><span aria-hidden="true">${meta.icon}</span>${bkmpChangelogEscapeHtml(meta.label)}</span>`;
}

function bkmpChangelogEntryHtml(entry) {
  return `
    <article class="chl-entry">
      <div class="chl-entry-date">${bkmpChangelogFormatDate(entry.entryDate)}</div>
      <div class="chl-entry-body">
        <div class="chl-entry-head">
          ${bkmpChangelogCategoryBadgeHtml(entry.category)}
          <h4 class="chl-entry-title">${bkmpChangelogEscapeHtml(entry.title)}</h4>
        </div>
        ${entry.description ? `<p class="chl-entry-desc">${bkmpChangelogEscapeHtml(entry.description)}</p>` : ''}
      </div>
    </article>`;
}

async function bkmpChangelogEnsureDataLoaded() {
  if (bkmpChangelogActiveData !== null || bkmpChangelogLoading) return;
  if (typeof loadChangelogEntries !== 'function') { bkmpChangelogLoadError = true; bkmpChangelogActiveData = []; return; }
  bkmpChangelogLoading = true;
  try {
    const list = await loadChangelogEntries();
    bkmpChangelogActiveData = Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn('Changelog: konnte nicht geladen werden (Migration evtl. noch nicht ausgeführt - siehe sql/20260726-changelog.sql).', err);
    bkmpChangelogLoadError = true;
    bkmpChangelogActiveData = [];
  } finally {
    bkmpChangelogLoading = false;
  }
}

function bkmpChangelogRenderFilters() {
  const el = document.getElementById('changelogFilters');
  if (!el) return;
  // Wiederverwendet .fbb-filter-chip (Feedback-Board, style.css) - identisches Aussehen/Verhalten.
  el.innerHTML = BKMP_CHANGELOG_FILTERS.map(f => `<button type="button" class="fbb-filter-chip ${f.id === bkmpChangelogActiveFilter ? 'active' : ''}" data-chl-filter="${f.id}" role="tab" aria-selected="${f.id === bkmpChangelogActiveFilter}">${bkmpChangelogEscapeHtml(f.label)}</button>`).join('');
  el.querySelectorAll('.fbb-filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      bkmpChangelogActiveFilter = btn.dataset.chlFilter;
      bkmpChangelogRenderFilters();
      bkmpChangelogRenderList();
    });
  });
}

/* Gruppiert nach Datum (Ueberschrift je Tag) - vertikale Zeitleiste, siehe
   Recherche im Datei-Kopfkommentar. */
function bkmpChangelogRenderList() {
  const el = document.getElementById('changelogBody');
  if (!el) return;
  if (bkmpChangelogLoading) { el.innerHTML = '<p class="chl-empty">Lädt…</p>'; return; }
  if (bkmpChangelogLoadError && !(bkmpChangelogActiveData || []).length) {
    el.innerHTML = '<p class="chl-empty">Konnte gerade nicht geladen werden. Bitte später nochmal versuchen.</p>';
    return;
  }
  const items = (bkmpChangelogActiveData || []).filter(e => bkmpChangelogActiveFilter === 'alle' || e.category === bkmpChangelogActiveFilter);
  if (!items.length) {
    el.innerHTML = '<p class="chl-empty">Noch keine Einträge in dieser Ansicht.</p>';
    return;
  }
  el.innerHTML = `<div class="chl-timeline">${items.map(bkmpChangelogEntryHtml).join('')}</div>`;
}

async function bkmpChangelogOpen(triggerEl) {
  const overlay = document.getElementById('changelogOverlay');
  if (!overlay) return;
  bkmpChangelogLastTrigger = triggerEl || document.activeElement;
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');
  const closeButton = document.getElementById('changelogClose');
  if (closeButton) closeButton.focus();
  bkmpChangelogRenderFilters();
  bkmpChangelogRenderList();
  await bkmpChangelogEnsureDataLoaded();
  if (overlay.classList.contains('visible')) bkmpChangelogRenderList();
}
function bkmpChangelogClose() {
  const overlay = document.getElementById('changelogOverlay');
  if (overlay) overlay.classList.remove('visible');
  document.body.classList.remove('modal-open');
  if (bkmpChangelogLastTrigger && typeof bkmpChangelogLastTrigger.focus === 'function') bkmpChangelogLastTrigger.focus();
  bkmpChangelogLastTrigger = null;
}

(function bkmpChangelogInit() {
  const openButton = document.getElementById('changelogButton');
  const closeButton = document.getElementById('changelogClose');
  const overlay = document.getElementById('changelogOverlay');
  if (!openButton && !overlay) return; // Seite bindet dieses Panel gar nicht ein (z.B. idle-stream-mini.html)

  if (openButton) openButton.addEventListener('click', () => bkmpChangelogOpen(openButton));
  if (closeButton) closeButton.addEventListener('click', bkmpChangelogClose);
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) bkmpChangelogClose(); });
  if (overlay && typeof bkmpUiTrapFocus === 'function') bkmpUiTrapFocus(overlay);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay && overlay.classList.contains('visible')) bkmpChangelogClose();
  });
})();

/* ================================================================
   Admin-Formular (26.07.2026, admin.html) - schreibt echt in
   public.changelog_entries (upsertChangelogEntry/deleteChangelogEntry,
   supabase.js). Laeuft nur, wenn #changelogAdminForm existiert (admin.html) -
   auf index.html sind alle bkmpChangelogAdmin*-Funktionen bewusst No-ops
   (Element fehlt). Bewusst einfacher als das Feedback-Board-Admin-Formular
   (kein Status-Workflow, kein Fortschrittsverlauf, keine Duplikat-
   Verknuepfung noetig - ein Changelog-Eintrag ist per Definition schon
   abgeschlossen, sobald er gespeichert wird). */
let bkmpChangelogAdminCache = [];
let bkmpChangelogAdminEditingId = null;

function bkmpChangelogAdminToast(text, kind) {
  if (typeof showAdminToast === 'function') { showAdminToast(text, kind || 'success'); return; }
  console.log('[Changelog]', text);
}
function bkmpChangelogAdminErrorText(e) {
  if (typeof supabaseErrorText === 'function') return supabaseErrorText(e);
  return String(e && e.message || e);
}

function bkmpChangelogAdminRenderForm() {
  const root = document.getElementById('changelogAdminForm');
  if (!root) return;
  const editing = bkmpChangelogAdminEditingId ? bkmpChangelogAdminCache.find(x => x.id === bkmpChangelogAdminEditingId) : null;
  const today = new Date().toISOString().slice(0, 10);
  const categoryOptions = Object.keys(BKMP_CHANGELOG_CATEGORY_META).map(k =>
    `<option value="${k}" ${editing && editing.category === k ? 'selected' : ''}>${BKMP_CHANGELOG_CATEGORY_META[k].icon} ${bkmpChangelogEscapeHtml(BKMP_CHANGELOG_CATEGORY_META[k].label)}</option>`
  ).join('');
  root.innerHTML = `
    <div class="fbb-admin-form">
      ${editing ? `<p class="admin-help-text">✏️ Eintrag wird bearbeitet.</p>` : ''}
      <label for="changelogAdminDate">Datum</label>
      <input type="date" id="changelogAdminDate" value="${editing ? bkmpChangelogEscapeHtml(editing.entryDate) : today}">
      <label for="changelogAdminCategory">Kategorie</label>
      <select id="changelogAdminCategory">${categoryOptions}</select>
      <label for="changelogAdminTitle">Titel</label>
      <input type="text" id="changelogAdminTitle" placeholder="Kurzer, klarer Titel" value="${editing ? bkmpChangelogEscapeHtml(editing.title) : ''}">
      <label for="changelogAdminDesc">Beschreibung (optional)</label>
      <textarea id="changelogAdminDesc" rows="3" placeholder="Kurz, in ein bis zwei Sätzen">${editing ? bkmpChangelogEscapeHtml(editing.description || '') : ''}</textarea>
      <div class="fbb-admin-form-actions">
        <button type="button" class="btn btn-primary" id="changelogAdminSaveBtn">💾 ${editing ? 'Speichern' : 'Hinzufügen'}</button>
        ${editing ? '<button type="button" class="edit-btn" id="changelogAdminCancelBtn">Abbrechen</button>' : ''}
      </div>
    </div>`;

  const saveBtn = document.getElementById('changelogAdminSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const title = document.getElementById('changelogAdminTitle').value.trim();
    if (!title) { bkmpChangelogAdminToast('Bitte einen Titel eintragen.', 'error'); return; }
    const payload = {
      id: bkmpChangelogAdminEditingId,
      entryDate: document.getElementById('changelogAdminDate').value || today,
      category: document.getElementById('changelogAdminCategory').value,
      title,
      description: document.getElementById('changelogAdminDesc').value.trim()
    };
    saveBtn.disabled = true; saveBtn.textContent = 'Speichert…';
    try {
      const saved = await upsertChangelogEntry(payload);
      if (saved) {
        const idx = bkmpChangelogAdminCache.findIndex(x => x.id === saved.id);
        if (idx >= 0) bkmpChangelogAdminCache[idx] = saved; else bkmpChangelogAdminCache.unshift(saved);
        bkmpChangelogAdminEditingId = null;
        bkmpChangelogAdminRenderForm();
        bkmpChangelogAdminRenderList();
        bkmpChangelogAdminToast('Gespeichert.', 'success');
      }
    } catch (err) {
      bkmpChangelogAdminToast('Konnte nicht gespeichert werden: ' + bkmpChangelogAdminErrorText(err), 'error');
      saveBtn.disabled = false; saveBtn.textContent = editing ? '💾 Speichern' : '💾 Hinzufügen';
    }
  });
  const cancelBtn = document.getElementById('changelogAdminCancelBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { bkmpChangelogAdminEditingId = null; bkmpChangelogAdminRenderForm(); });
}

function bkmpChangelogAdminRenderList() {
  const listEl = document.getElementById('changelogAdminList');
  if (!listEl) return;
  if (!bkmpChangelogAdminCache.length) {
    listEl.innerHTML = '<p class="empty-hint">Noch keine Changelog-Einträge.</p>';
    return;
  }
  listEl.innerHTML = bkmpChangelogAdminCache.map(e => `
    <div class="feedback-card" data-chl-id="${bkmpChangelogEscapeHtml(e.id)}">
      <div class="feedback-card-head">
        ${bkmpChangelogCategoryBadgeHtml(e.category)}
        <span class="feedback-card-name">${bkmpChangelogFormatDate(e.entryDate)}</span>
      </div>
      <p class="feedback-card-message">${bkmpChangelogEscapeHtml(e.title)}</p>
      <div class="feedback-card-actions">
        <button class="edit-btn chl-admin-edit-btn" type="button">Bearbeiten</button>
        <button class="del-btn" type="button" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg></button>
      </div>
    </div>
  `).join('');
  listEl.querySelectorAll('[data-chl-id]').forEach(card => {
    const id = card.dataset.chlId;
    card.querySelector('.chl-admin-edit-btn').addEventListener('click', () => {
      bkmpChangelogAdminEditingId = id;
      bkmpChangelogAdminRenderForm();
      document.getElementById('changelogAdminForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    card.querySelector('.del-btn').addEventListener('click', async () => {
      if (!confirm('Diesen Changelog-Eintrag wirklich endgültig löschen?')) return;
      try {
        await deleteChangelogEntry(id);
        bkmpChangelogAdminCache = bkmpChangelogAdminCache.filter(x => x.id !== id);
        if (bkmpChangelogAdminEditingId === id) { bkmpChangelogAdminEditingId = null; bkmpChangelogAdminRenderForm(); }
        bkmpChangelogAdminRenderList();
        bkmpChangelogAdminToast('Eintrag gelöscht.', 'success');
      } catch (err) {
        bkmpChangelogAdminToast('Konnte nicht gelöscht werden: ' + bkmpChangelogAdminErrorText(err), 'error');
      }
    });
  });
}

async function bkmpChangelogAdminRefresh() {
  const listEl = document.getElementById('changelogAdminList');
  if (!listEl) return;
  listEl.innerHTML = '<p class="admin-help-text">Lädt…</p>';
  try {
    const items = await loadChangelogEntries();
    if (items === null) { listEl.innerHTML = '<p class="admin-help-text">Nicht eingeloggt oder Supabase nicht verfügbar.</p>'; return; }
    bkmpChangelogAdminCache = items;
    bkmpChangelogAdminRenderList();
  } catch (e) {
    listEl.innerHTML = `<p class="admin-help-text">Konnte nicht geladen werden (vermutlich läuft die Migration <code>sql/20260726-changelog.sql</code> noch nicht): ${bkmpChangelogEscapeHtml(bkmpChangelogAdminErrorText(e))}</p>`;
  }
}

(function bkmpChangelogAdminInit() {
  const formEl = document.getElementById('changelogAdminForm');
  if (!formEl) return;
  const refreshBtn = document.getElementById('changelogAdminRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', bkmpChangelogAdminRefresh);
  bkmpChangelogAdminRenderForm();
  bkmpChangelogAdminRefresh();
})();
