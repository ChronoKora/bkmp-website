/* Tageszaehler-Import im Admin-Panel ("Tageszähler-Import"), 15.10.2026.

   Ablauf: Importdatei des OPSUCHT-Tageszaehlers waehlen -> Pruefung der Datei ->
   Vorschau gegen den aktuellen Website-Stand (tageszaehler_import_preview) ->
   Zuordnung und Entscheidungen -> ausdrueckliche Bestaetigung ->
   tageszaehler_import_apply (atomar, wiederholbar ohne Doppelbuchung) ->
   Nachweis der gespeicherten Summen.

   19.10.2026: Importdatei Version 2 - Verkaeufe als Einnahmen, Ankaeufe als Ausgaben
   ("Einnahmen sind Einnahmen und alles, was wir ankaufen, sind Ausgaben").

   Nichts wird ohne Bestaetigung geschrieben. Regeln und Rechenweg:
   js/admin/bkmp-tageszaehler-import-core.js. Datenbankseite und Schutzregeln:
   sql/20261015-tageszaehler-import.sql + sql/20261019-tageszaehler-ausgaben.sql. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const PAGE_ID = 'page-tzimport';
  const MAP_STORAGE = 'bkmp_tzimport_mapping_v1';
  const core = () => window.BKMP_TZ_IMPORT;

  const state = {
    file: null, fileName: '', preview: null, mapping: {}, choices: {}, plan: null,
    batchId: null, request: null, busy: false, result: null, error: null, pendingRetry: false, confirmed: false
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function money(cents) { return core().formatCents(cents) + ' €'; }
  function websiteCategories() {
    return typeof BKMP_INCOME_CATEGORIES !== 'undefined' ? BKMP_INCOME_CATEGORIES.slice()
      : ['Karten', 'Bücher', 'Tränke', 'Elytra', 'Raketen', 'Werkzeug', 'Schmiede Vorlagen', 'Netherite', 'Selbst Verdient', 'Custom'];
  }
  function client() { return typeof bkmpGetSupabaseClient === 'function' ? bkmpGetSupabaseClient() : null; }
  function newBatchId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const b = new Uint8Array(16); window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function rememberedMapping() {
    try { return JSON.parse(window.localStorage.getItem(MAP_STORAGE) || '{}') || {}; } catch (e) { return {}; }
  }
  function rememberMapping(mapping) {
    try { window.localStorage.setItem(MAP_STORAGE, JSON.stringify(Object.assign(rememberedMapping(), mapping))); } catch (e) { /* nur Komfort */ }
  }
  function container() { return document.querySelector('#' + PAGE_ID + ' [data-tzi-root]'); }

  /* ---------- Daten ---------- */
  async function loadPreview() {
    const c = client();
    if (!c) throw new Error('Keine Verbindung zur Datenbank.');
    const { data, error } = await c.rpc('tageszaehler_import_preview', { p_konto: state.file.konto, p_dates: state.file.days.map(d => d.date) });
    if (error) throw error;
    return data;
  }

  function rebuildPlan() {
    state.plan = core().buildPlan(state.file, state.preview, state.mapping, state.choices);
    state.request = null;
    state.batchId = null;          // jede geaenderte Vorschau = neuer Auftrag
    state.pendingRetry = false;
    state.confirmed = false;
  }

  async function onFile(fileObj) {
    state.result = null; state.error = null; state.preview = null; state.plan = null; state.file = null;
    state.choices = {}; state.fileName = fileObj ? fileObj.name : '';
    if (!fileObj) { render(); return; }
    try {
      const text = await fileObj.text();
      state.file = core().parseImportFile(text);
    } catch (e) {
      state.error = e.isImportError ? e.message : 'Datei konnte nicht gelesen werden: ' + (e.message || e);
      render();
      return;
    }
    await refreshPreview();
  }

  async function refreshPreview() {
    if (!state.file) return;
    state.busy = true; state.error = null; render();
    try {
      state.preview = await loadPreview();
      const suggestion = core().suggestMapping(state.file, state.preview, rememberedMapping());
      // bereits gewaehlte Zuordnung behalten
      state.mapping = Object.assign(suggestion, Object.fromEntries(Object.entries(state.mapping).filter(([k]) => k in suggestion)));
      rebuildPlan();
    } catch (e) {
      state.error = core().errorText(e).text;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function confirmImport() {
    if (!state.plan || !state.plan.canConfirm || state.busy) return;
    if (!state.request) {
      try { state.request = core().buildRequest(state.plan); } catch (e) { state.error = e.message; render(); return; }
      state.batchId = newBatchId();
    }
    state.busy = true; state.error = null; render();
    try {
      const c = client();
      const { data, error } = await c.rpc('tageszaehler_import_apply', {
        p_batch_id: state.batchId, p_snapshot: state.preview.snapshot, p_request: state.request
      });
      if (error) throw error;
      state.result = data;
      state.pendingRetry = false;
      rememberMapping(state.mapping);
      window.dispatchEvent(new CustomEvent('bkmp:incomes-changed', { detail: { source: 'tageszaehler-import' } }));
      if (state.plan && state.plan.hasExpenses) {
        window.dispatchEvent(new CustomEvent('bkmp:expenses-changed', { detail: { source: 'tageszaehler-import' } }));
      }
    } catch (e) {
      const info = core().errorText(e);
      const netz = !e || (!e.code && /fetch|network|Failed|timeout/i.test(String(e.message || e)));
      if (netz || info.code === 'unknown') {
        // Antwort nicht erhalten: derselbe Auftrag (gleiche Kennung) darf erneut gesendet werden.
        state.pendingRetry = true;
        state.error = 'Keine eindeutige Antwort vom Server (' + info.text + '). Der Auftrag kann gefahrlos erneut gesendet werden – eine bereits gespeicherte Übertragung wird erkannt und nicht doppelt gebucht.';
      } else {
        state.pendingRetry = false;
        state.error = info.text;
      }
    } finally {
      state.busy = false;
      render();
    }
  }

  /* ---------- Darstellung ---------- */
  function kindText(l) {
    switch (l.kind) {
      case 'new': return 'neu';
      case 'update': return 'Änderung';
      case 'unchanged': return 'unverändert';
      case 'remove': return 'entfällt (neue Revision)';
      case 'deleted': return 'auf der Website gelöscht';
      case 'older': return 'nicht übernommen';
      default: return '';
    }
  }
  function qtyText(l) {
    if (l.quantity != null) return l.quantity.toLocaleString('de-DE');
    if (l.quantityStatus === 'teilweise') return 'teilweise bekannt – leer';
    if (l.kind === 'remove') return '–';
    return 'offen – leer';
  }
  function choiceHtml(l) {
    if (!l.needsChoice) return '';
    const name = 'tzi-choice-' + l.key;
    const opt = (value, label) => `<label class="tzi-choice"><input type="radio" name="${esc(name)}" value="${value}" data-tzi-choice="${esc(l.key)}"${l.choice === value ? ' checked' : ''}> ${label}</label>`;
    if (l.expense) {
      return `<div class="tzi-decision" data-testid="tzi-decision">
        <p>Diese Ausgabe wurde früher importiert und danach auf der Website gelöscht.</p>
        ${opt('recreate', 'erneut anlegen')}${opt('skip', 'nicht anlegen')}
      </div>`;
    }
    if (l.kind === 'deleted') {
      return `<div class="tzi-decision" data-testid="tzi-decision">
        <p>Diese Position wurde früher importiert und danach auf der Website gelöscht.</p>
        ${opt('recreate', 'erneut anlegen')}${l.conflicts.length ? opt('replace', 'erneut anlegen und die von Hand erfasste Zeile ersetzen') : ''}${opt('skip', 'nicht anlegen')}
      </div>`;
    }
    const rows = l.conflicts.map(m => `${esc(core().formatDateDe(m.date))} · ${esc(m.category)} · ${money(core().numberToCents(m.amount))}${m.quantity != null ? ' · Anzahl ' + esc(m.quantity) : ''}${m.note ? ' · „' + esc(m.note) + '“' : ''}`).join('<br>');
    return `<div class="tzi-decision" data-testid="tzi-decision">
      <p>Für diesen Tag gibt es in „${esc(l.website)}“ bereits von Hand erfasste Einnahmen:<br>${rows}<br>
      <strong>Ohne Ersetzen würden beide zählen.</strong></p>
      ${opt('replace', 'von Hand erfasste Zeile(n) durch den Nettoimport ersetzen')}
      ${opt('keep', 'beide behalten (der Import ist eine zusätzliche Einnahme)')}
      ${opt('skip', 'diese Position nicht importieren')}
    </div>`;
  }

  function mappingHtml() {
    const cats = websiteCategories();
    const seen = new Map();
    state.file.days.forEach(d => d.positions.forEach(p => { if (!seen.has(p.categoryId)) seen.set(p.categoryId, p.categoryName); }));
    const rows = [...seen.entries()].map(([id, name]) => {
      const note = core().MAPPING_NOTES[id];
      const current = state.mapping[id] || 'Custom';
      return `<tr>
        <td>${esc(name)} <span class="tzi-muted">(${esc(id)})</span></td>
        <td><select data-tzi-map="${esc(id)}" aria-label="Website-Kategorie für ${esc(name)}">
          ${cats.map(c => `<option value="${esc(c)}"${c === current ? ' selected' : ''}>${esc(c)}</option>`).join('')}
        </select></td>
        <td class="tzi-muted">${note ? esc(note) : ''}${core().WAGE_CATEGORIES.includes(current) ? (note ? '<br>' : '') + 'Zählt für die Mitarbeiter-Abrechnung.' : ''}</td>
      </tr>`;
    }).join('');
    return `<section class="tzi-card" data-testid="tzi-mapping">
      <h3>Kategorien zuordnen</h3>
      <p class="tzi-muted">Einmal festlegen – spätere Importe übernehmen die zuletzt verwendete Zuordnung. Der Betrag wird nie umgerechnet.</p>
      <div class="tzi-scroll"><table class="tzi-table"><thead><tr><th>Tageszähler</th><th>Website</th><th>Hinweis</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
  }

  function dayHtml(day) {
    const lines = day.lines.map(l => `<tr class="tzi-kind-${esc(l.kind)}" data-testid="tzi-line" data-key="${esc(l.key)}">
        <td>${esc(l.categoryName)}</td>
        <td>${esc(l.website)}${l.wage ? ' <span class="tzi-badge" title="Zählt für die Mitarbeiter-Abrechnung">Lohn</span>' : ''}</td>
        <td class="tzi-num">${l.kind === 'remove' ? '–' : money(l.cents)}</td>
        <td>${esc(qtyText(l))}${l.quantityNote ? `<div class="tzi-muted">${esc(l.quantityNote)}</div>` : ''}</td>
        <td><span class="tzi-kind" data-testid="tzi-kind">${esc(kindText(l))}</span>${l.previous && l.previous.income && (l.kind === 'update' || l.kind === 'remove') ? `<div class="tzi-muted">bisher ${money(core().numberToCents(l.previous.income.amount))}</div>` : ''}${l.blocked ? `<div class="tzi-warn">${esc(l.blocked)}</div>` : ''}</td>
      </tr>`).join('');
    const decisions = day.lines.concat(day.expenseLines).filter(l => l.needsChoice).map(l => `<div class="tzi-decision-wrap">
        <h4>${l.expense ? esc(l.label) + ' → Ausgaben' : esc(l.categoryName) + ' → ' + esc(l.website)}</h4>${choiceHtml(l)}</div>`).join('');
    const untouched = day.untouched.length
      ? `<p class="tzi-muted">Weitere Einnahmen dieses Tages bleiben unverändert: ${day.untouched.map(m => esc(m.category) + ' ' + money(core().numberToCents(m.amount))).join(', ')}</p>` : '';
    const v2 = state.file.version >= 2;
    const hasExp = day.expenseLines.length > 0;
    return `<section class="tzi-card tzi-day" data-testid="tzi-day" data-date="${esc(day.date)}">
      <header class="tzi-day-head">
        <h3>${esc(core().formatDateDe(day.date))}</h3>
        <div class="tzi-muted">Revision ${esc(day.revisionId)} · Erfassung ${esc(day.erfassung || '–')}${day.transactions != null ? ' · ' + esc(day.transactions) + ' Verkaufszeilen' : ''}${hasExp ? ' · Gewinn laut Tageszähler <span data-testid="tzi-day-gewinn">' + money(day.cents - day.expenseCents) + '</span>' : ''}</div>
      </header>
      <div class="tzi-sums">
        <div><span class="tzi-muted">${v2 ? 'Einnahmen' : 'Netto'} laut Tageszähler</span><strong data-testid="tzi-day-netto">${money(day.cents)}</strong></div>
        <div><span class="tzi-muted">${v2 ? 'Einnahmen' : 'Website'} vorher</span><strong>${money(day.beforeCents)}</strong></div>
        <div><span class="tzi-muted">${v2 ? 'Einnahmen' : 'Website'} nachher</span><strong data-testid="tzi-day-after">${money(day.afterCents)}</strong></div>
      </div>
      <div class="tzi-scroll"><table class="tzi-table"><thead><tr><th>Kategorie</th><th>Website</th><th>${v2 ? 'Betrag' : 'Netto'}</th><th>Anzahl</th><th>Änderung</th></tr></thead><tbody>${lines}</tbody></table></div>
      ${hasExp ? expensesHtml(day) : ''}
      ${decisions ? `<div class="tzi-decisions"><h4 class="tzi-decisions-title">Entscheidungen</h4>${decisions}</div>` : ''}
      ${untouched}
    </section>`;
  }

  /* Ausgaben (Ankaeufe) eines Tages - Version 2. */
  function expensesHtml(day) {
    const rows = day.expenseLines.map(l => `<tr class="tzi-kind-${esc(l.kind)}" data-testid="tzi-expense-line" data-key="${esc(l.key)}">
        <td>${esc(l.label)}</td>
        <td class="tzi-num">${l.kind === 'remove' ? '–' : money(l.cents)}</td>
        <td>${l.note ? esc(l.note) : ''}${l.purchases != null ? `<div class="tzi-muted">${esc(l.purchases)} Ankäufe</div>` : ''}</td>
        <td><span class="tzi-kind" data-testid="tzi-kind">${esc(kindText(l))}</span>${l.previous && l.previous.expense && (l.kind === 'update' || l.kind === 'remove') ? `<div class="tzi-muted">bisher ${money(core().numberToCents(l.previous.expense.amount))}</div>` : ''}${l.blocked ? `<div class="tzi-warn">${esc(l.blocked)}</div>` : ''}</td>
      </tr>`).join('');
    const manual = day.manualExpenses.length
      ? `<p class="tzi-muted" data-testid="tzi-manual-expenses">Von Hand erfasste Ausgaben dieses Tages bleiben unverändert: ${day.manualExpenses.map(m => esc(m.category) + ' ' + money(core().numberToCents(m.amount))).join(', ')}.
         <strong>Steht darin schon ein Ankauf aus dem Tageszähler, bitte dort löschen – sonst zählt er doppelt.</strong></p>` : '';
    return `<div class="tzi-expenses" data-testid="tzi-expenses">
      <h4 class="tzi-decisions-title">Ausgaben (Ankäufe)</h4>
      <div class="tzi-sums">
        <div><span class="tzi-muted">Ausgaben laut Tageszähler</span><strong data-testid="tzi-day-ausgaben">${money(day.expenseCents)}</strong></div>
        <div><span class="tzi-muted">Ausgaben vorher</span><strong>${money(day.expBeforeCents)}</strong></div>
        <div><span class="tzi-muted">Ausgaben nachher</span><strong data-testid="tzi-day-ausgaben-after">${money(day.expAfterCents)}</strong></div>
      </div>
      <div class="tzi-scroll"><table class="tzi-table"><thead><tr><th>Ausgabe</th><th>Betrag</th><th>Hinweis</th><th>Änderung</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${manual}
    </div>`;
  }

  function confirmHtml() {
    const p = state.plan;
    const daysText = state.file.days.map(d => core().formatDateDe(d.date) + ' mit '
      + (d.expenses.length ? 'Einnahmen ' + money(d.cents) + ' und Ausgaben ' + money(d.expenseCents) : money(d.cents) + ' netto')).join(', ');
    if (p.needsExpenseSql) {
      // Ausgaben in der Datei, aber die Datenbank kennt sie noch nicht -> nichts uebernehmen.
      return `<section class="tzi-card tzi-confirm" data-testid="tzi-confirm">
        <p class="tzi-warn" data-testid="tzi-needs-sql">Diese Datei enthält Ausgaben (Ankäufe), die Datenbank kennt Ausgaben aber noch nicht. Bitte zuerst <strong>sql/20261019-tageszaehler-ausgaben.sql</strong> im Supabase-SQL-Editor ausführen und dann „Vorschau neu laden“. Bis dahin wird nichts übernommen.</p>
      </section>`;
    }
    if (!p.hasChanges) {
      return `<section class="tzi-card" data-testid="tzi-nothing"><p><strong>Alles ist bereits auf dem Stand dieser Datei.</strong> Es gibt nichts zu übertragen.</p></section>`;
    }
    return `<section class="tzi-card tzi-confirm" data-testid="tzi-confirm">
      <h3>Übernahme bestätigen</h3>
      <p data-testid="tzi-confirm-text">${esc(daysText)} an BK Investment übertragen.</p>
      <p class="tzi-muted">Änderung der Einnahmen insgesamt: <strong data-testid="tzi-diff">${money(p.diffCents)}</strong>${p.hasExpenses ? `, der Ausgaben: <strong data-testid="tzi-diff-ausgaben">${money(p.expenseDiffCents)}</strong>` : ''}. Beträge werden 1:1 aus dem Tageszähler übernommen (Spielwährung; der Zähler zeigt $, die Website €).</p>
      ${p.missingChoices ? `<p class="tzi-warn" data-testid="tzi-missing">Noch ${p.missingChoices} Entscheidung(en) offen.</p>` : ''}
      <label class="tzi-choice"><input type="checkbox" data-tzi-confirmed${state.confirmed ? ' checked' : ''}${p.missingChoices ? ' disabled' : ''}> Ich habe die Vorschau geprüft.</label>
      <button class="btn btn-primary" data-tzi-apply data-testid="tzi-apply"${(!p.canConfirm || !state.confirmed || state.busy) ? ' disabled' : ''}>${state.pendingRetry ? 'Erneut senden (gleicher Auftrag)' : 'Jetzt übernehmen'}</button>
    </section>`;
  }

  function resultHtml() {
    const r = state.result;
    const tage = (r.tage || []).map(t => `<li>${esc(core().formatDateDe(t.date))}: Import ${money(core().numberToCents(t.import_summe))} · alle Einnahmen des Tages ${money(core().numberToCents(t.einnahmen_summe))} (${esc(t.einnahmen_zeilen)} Zeilen)${t.ausgaben_summe != null && (Number(t.ausgaben_import_summe) || Number(t.ausgaben_zeilen))
      ? ` · Ausgaben: Import ${money(core().numberToCents(t.ausgaben_import_summe))}, alle Ausgaben des Tages ${money(core().numberToCents(t.ausgaben_summe))} (${esc(t.ausgaben_zeilen)} Zeilen)` : ''}</li>`).join('');
    return `<section class="tzi-card tzi-done" data-testid="tzi-result">
      <h3>${r.wiederholt ? 'Bereits übertragen' : 'Übertragen'}</h3>
      <p>${esc(r.angelegt)} angelegt · ${esc(r.aktualisiert)} aktualisiert · ${esc(r.unveraendert)} unverändert · ${esc(r.entfernt)} entfernt · ${esc(r.uebersprungen)} übersprungen · ${esc(r.ersetzt_manuell)} von Hand erfasste Zeile(n) ersetzt</p>
      <p class="tzi-muted">Von der Website zurückgelesen:</p><ul>${tage}</ul>
      ${r.wiederholt ? '<p class="tzi-muted">Dieser Auftrag war schon gespeichert – es wurde nichts doppelt gebucht.</p>' : ''}
    </section>`;
  }

  function render() {
    const root = container();
    if (!root) return;
    const head = `<div class="tzi-intro">
      <p>Übernimmt aus einer freigegebenen Importdatei des OPSUCHT-Tageszählers die <strong>Verkäufe als Einnahmen</strong> und die <strong>Ankäufe als Ausgaben</strong>.
      Vor dem Speichern siehst du je Tag und Kategorie, was neu ist, was sich ändert und welche von Hand erfassten Einnahmen betroffen sind.
      Ohne Bestätigung wird nichts gespeichert; eine Datei zweimal zu übernehmen erzeugt keine doppelten Einnahmen oder Ausgaben.</p>
      <label class="tzi-file">Importdatei (.json) <input type="file" accept=".json,application/json" data-tzi-file data-testid="tzi-file"></label>
      ${state.fileName ? `<span class="tzi-muted">${esc(state.fileName)}</span>` : ''}
    </div>`;
    let body = '';
    if (state.error) body += `<p class="tzi-error" role="alert" data-testid="tzi-error">${esc(state.error)}</p>`;
    if (state.busy) body += '<p class="tzi-muted" data-testid="tzi-busy">Bitte warten …</p>';
    if (state.result) {
      body += resultHtml();
    } else if (state.file && state.plan) {
      body += `<section class="tzi-card" data-testid="tzi-summary">
        <h3>Datei</h3>
        <p>${esc(state.file.programm)} ${esc(state.file.programmVersion)} · Konto ${esc(state.file.kontoName)} · erstellt ${esc(state.file.createdAt.replace('T', ' ').slice(0, 16))}</p>
        <p>${state.file.days.length} Tag(e), zusammen <strong data-testid="tzi-file-total">${money(state.file.cents)}</strong> ${state.file.version >= 2 ? 'Einnahmen' : 'netto'}${state.file.version >= 2 ? ` und <strong data-testid="tzi-file-ausgaben">${money(state.file.expenseCents)}</strong> Ausgaben` : ''}</p>
        ${state.file.freigabe ? `<p class="tzi-muted">Freigabe im Tageszähler: „${esc(state.file.freigabe)}“</p>` : ''}
        <button class="btn" data-tzi-refresh>Vorschau neu laden</button>
      </section>`;
      body += mappingHtml();
      body += state.plan.days.map(dayHtml).join('');
      body += confirmHtml();
    }
    root.innerHTML = head + body;
    bind(root);
  }

  function bind(root) {
    const fileInput = root.querySelector('[data-tzi-file]');
    if (fileInput) fileInput.addEventListener('change', () => onFile(fileInput.files && fileInput.files[0]));
    root.querySelectorAll('[data-tzi-map]').forEach(sel => sel.addEventListener('change', () => {
      state.mapping[sel.dataset.tziMap] = sel.value;
      rebuildPlan(); render();
      refocus('[data-tzi-map="' + cssEsc(sel.dataset.tziMap) + '"]');
    }));
    root.querySelectorAll('[data-tzi-choice]').forEach(r => r.addEventListener('change', () => {
      if (!r.checked) return;
      state.choices[r.dataset.tziChoice] = r.value;
      rebuildPlan(); render();
      refocus('[data-tzi-choice="' + cssEsc(r.dataset.tziChoice) + '"][value="' + cssEsc(r.value) + '"]');
    }));
    const cb = root.querySelector('[data-tzi-confirmed]');
    if (cb) cb.addEventListener('change', () => {
      // Nur den Knopf umschalten - kein Neuzeichnen (Fokus und Bildschirmposition bleiben).
      state.confirmed = cb.checked;
      const btn = root.querySelector('[data-tzi-apply]');
      if (btn) btn.disabled = !(state.plan && state.plan.canConfirm && state.confirmed && !state.busy);
    });
    const apply = root.querySelector('[data-tzi-apply]');
    if (apply) apply.addEventListener('click', confirmImport);
    const refresh = root.querySelector('[data-tzi-refresh]');
    if (refresh) refresh.addEventListener('click', () => { state.result = null; refreshPreview(); });
  }

  function cssEsc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'); }
  function refocus(selector) {
    const root = container();
    const el = root && root.querySelector(selector);
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }

  /* Vom Navigations-Handler in admin.html aufgerufen. */
  window.bkmpTzImportOnOpen = function () {
    if (!container()) return;
    render();
  };
})();
