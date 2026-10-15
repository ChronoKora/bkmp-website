/* Tageszaehler-Import (15.10.2026) - reine Regeln, ohne DOM und ohne Netzwerk.
   Dual-Mode: im Browser als window.BKMP_TZ_IMPORT, in Tests per require().

   Aufgaben:
     * Importdatei des OPSUCHT-Tageszaehlers pruefen (Format, Summen in Cent, Felder)
     * Zuordnung Zaehler-Kategorie -> Website-Kategorie vorschlagen
     * aus Datei + Website-Stand (tageszaehler_import_preview) einen Plan bauen:
       je Tag und Kategorie anlegen / aktualisieren / unveraendert / entfernen,
       von Hand erfasste Zeilen derselben Kategorie als Entscheidung vorlegen
     * daraus den Auftrag fuer tageszaehler_import_apply bilden

   Betraege werden in ganzen Cent gerechnet (keine Gleitkomma-Summen). Der Betrag
   kommt immer unveraendert aus dem Zaehler - kein Stueckpreis, keine Umrechnung. */
(function (root) {
  'use strict';

  const FORMAT = 'bkmp-tageszaehler-import';
  const VERSION = 1;

  /* Vorschlag fuer die erste Zuordnung. Alles andere -> "Custom". Der Nutzer
     bestaetigt die Zuordnung in der Vorschau; spaetere Importe uebernehmen die
     zuletzt verwendete Zuordnung derselben Zaehler-Kategorie. */
  const DEFAULT_MAPPING = {
    buecher: 'Bücher',
    schmiedevorlagen: 'Schmiede Vorlagen',
    traenke: 'Tränke',
    raketen: 'Raketen',
    werkzeuge: 'Werkzeug',
    barren: 'Netherite',
    elytra: 'Elytra',
    karten: 'Karten'
  };

  /* Hinweise bei der Zuordnung (sichtbar, aendern nichts am Betrag). */
  const MAPPING_NOTES = {
    karten: 'Achtung: Website-„Karten“ sind mit 150.000 je Stück hinterlegt, Zähler-Karten mit 99 je Stück. Der Betrag wird trotzdem unverändert übernommen.',
    barren: 'Zähler „Netheritbarren“ = Website „Netherite“.'
  };

  /* Gilt fuer die Mitarbeiter-Abrechnung (admin.html, BKMP_EMPLOYEE_WAGE_CATEGORIES, ab 15.08.2026). */
  const WAGE_CATEGORIES = ['Bücher', 'Werkzeug', 'Netherite', 'Schmiede Vorlagen', 'Tränke', 'Raketen', 'Elytra'];
  const WAGE_START = '2026-08-15';

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const AMOUNT_RE = /^\d{1,12}(\.\d{1,2})?$/;
  const CAT_RE = /^[a-z0-9_]{1,40}$/;
  const KONTO_RE = /^[a-z0-9-]{1,40}$/;
  const FP_RE = /^[0-9a-f]{64}$/;

  function fail(text) { const e = new Error(text); e.isImportError = true; throw e; }

  /* "1234.5" -> 123450 (ganze Cent, exakt aus dem Text). */
  function amountTextToCents(text) {
    if (typeof text !== 'string' || !AMOUNT_RE.test(text)) return null;
    const [whole, frac = ''] = text.split('.');
    return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  }
  function centsToAmountText(cents) {
    const c = Math.round(Number(cents));
    const whole = Math.floor(c / 100);
    const frac = String(c % 100).padStart(2, '0');
    return whole + '.' + frac;
  }
  /* Zahl aus der Datenbank (numeric -> JSON-Zahl) -> Cent. */
  function numberToCents(n) { return n == null ? null : Math.round(Number(n) * 100); }

  function formatCents(cents) {
    const neg = cents < 0;
    const c = Math.abs(Math.round(cents));
    const whole = Math.floor(c / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '−' : '') + whole + ',' + String(c % 100).padStart(2, '0');
  }
  function formatDateDe(iso) {
    if (!DATE_RE.test(String(iso || ''))) return String(iso || '');
    const [y, m, d] = iso.split('-');
    return d + '.' + m + '.' + y;
  }

  /* ---------- Datei pruefen ---------- */
  function parseImportFile(text) {
    let raw;
    try { raw = JSON.parse(String(text || '').replace(/^\uFEFF/, '')); } catch (e) { fail('Die Datei ist kein gültiges JSON.'); }
    if (!raw || raw.format !== FORMAT) fail('Das ist keine Importdatei des Tageszählers (format fehlt oder ist falsch).');
    if (raw.version !== VERSION) fail('Diese Importdatei hat Version ' + raw.version + '; unterstützt wird Version ' + VERSION + '.');
    const quelle = raw.quelle || {};
    if (!KONTO_RE.test(String(quelle.konto || ''))) fail('Konto-Kennung in der Datei fehlt oder ist ungültig.');
    if (!Array.isArray(raw.tage) || raw.tage.length === 0) fail('Die Datei enthält keine Tage.');
    if (raw.tage.length > 62) fail('Höchstens 62 Tage auf einmal.');

    const seenDates = new Set();
    let fileCents = 0;
    const days = raw.tage.map(function (t, i) {
      const label = 'Tag ' + (i + 1);
      if (!DATE_RE.test(String(t.datum || ''))) fail(label + ': Datum fehlt oder ist ungültig.');
      if (seenDates.has(t.datum)) fail('Der Tag ' + formatDateDe(t.datum) + ' kommt doppelt vor.');
      seenDates.add(t.datum);
      if (!t.revisionId || String(t.revisionId).length > 80) fail(formatDateDe(t.datum) + ': Revision fehlt.');
      if (!t.revisionErstellt || Number.isNaN(Date.parse(t.revisionErstellt))) fail(formatDateDe(t.datum) + ': Revisionszeitpunkt fehlt.');
      if (!FP_RE.test(String(t.fingerabdruck || ''))) fail(formatDateDe(t.datum) + ': Fingerabdruck fehlt oder ist ungültig.');
      if (!Array.isArray(t.positionen)) fail(formatDateDe(t.datum) + ': Positionen fehlen.');
      const seenCats = new Set();
      let dayCents = 0;
      const positions = t.positionen.map(function (p) {
        if (!CAT_RE.test(String(p.kategorieId || ''))) fail(formatDateDe(t.datum) + ': ungültige Kategorie-Kennung „' + p.kategorieId + '“.');
        if (seenCats.has(p.kategorieId)) fail(formatDateDe(t.datum) + ': Kategorie „' + p.kategorieId + '“ doppelt.');
        seenCats.add(p.kategorieId);
        const name = String(p.kategorieName || '').trim();
        if (!name || name.length > 60) fail(formatDateDe(t.datum) + ': Kategoriename fehlt.');
        const cents = amountTextToCents(p.netto);
        if (cents == null) fail(formatDateDe(t.datum) + ', ' + name + ': Nettobetrag „' + p.netto + '“ ist ungültig.');
        if (p.nettoCent !== cents) fail(formatDateDe(t.datum) + ', ' + name + ': Betrag und Cent-Angabe passen nicht zusammen.');
        const status = p.mengeStatus;
        if (!['vollstaendig', 'teilweise', 'offen'].includes(status)) fail(formatDateDe(t.datum) + ', ' + name + ': Mengenstatus fehlt.');
        let menge = p.menge == null ? null : p.menge;
        if (menge != null && (!Number.isInteger(menge) || menge < 0)) fail(formatDateDe(t.datum) + ', ' + name + ': Menge ist keine ganze Zahl.');
        if (status !== 'vollstaendig') menge = null;   // offene/teilweise Menge nie uebertragen
        dayCents += cents;
        return {
          categoryId: p.kategorieId, categoryName: name, cents, amountText: centsToAmountText(cents),
          quantity: menge, quantityStatus: status, quantityNote: p.mengeHinweis ? String(p.mengeHinweis) : ''
        };
      });
      if (t.summeCent !== dayCents) fail(formatDateDe(t.datum) + ': Tagessumme passt nicht zu den Positionen.');
      fileCents += dayCents;
      return {
        date: t.datum, revisionId: String(t.revisionId), revisionCreatedAt: String(t.revisionErstellt),
        fingerprint: String(t.fingerabdruck), erfassung: String(t.erfassung || ''), cents: dayCents,
        transactions: Number.isInteger(t.verkaufszeilen) ? t.verkaufszeilen : null, positions
      };
    });
    if (raw.summeCent !== fileCents) fail('Gesamtsumme der Datei passt nicht zu den Tagen.');
    days.sort((a, b) => a.date.localeCompare(b.date));
    return {
      konto: quelle.konto, kontoName: String(quelle.kontoName || quelle.konto), programm: String(quelle.programm || ''),
      programmVersion: String(quelle.version || ''), createdAt: String(raw.erstelltAm || ''),
      freigabe: raw.freigabe ? String(raw.freigabe.text || '') : '', days, cents: fileCents
    };
  }

  /* ---------- Zuordnung ---------- */
  function suggestMapping(file, preview, remembered) {
    const mapping = {};
    const fromImports = {};
    ((preview && preview.imports) || []).slice().sort((a, b) => String(a.imported_at || '').localeCompare(String(b.imported_at || '')))
      .forEach(imp => { fromImports[imp.counter_category_id] = imp.website_category; });
    file.days.forEach(d => d.positions.forEach(p => {
      if (mapping[p.categoryId]) return;
      mapping[p.categoryId] = fromImports[p.categoryId] || (remembered && remembered[p.categoryId]) || DEFAULT_MAPPING[p.categoryId] || 'Custom';
    }));
    return mapping;
  }

  /* ---------- Plan ----------
     choices[key] fuer Entscheidungen:
       Konflikt mit von Hand erfassten Zeilen: 'replace' | 'keep' | 'skip'
       frueher importiert, auf der Website geloescht: 'recreate' | 'skip'           */
  function lineKey(konto, date, categoryId) { return 'tz1:' + konto + ':' + date + ':' + categoryId; }

  function buildPlan(file, preview, mapping, choices) {
    choices = choices || {};
    const imports = (preview && preview.imports) || [];
    const incomes = (preview && preview.incomes) || [];
    const days = file.days.map(day => {
      const dayImports = imports.filter(i => i.date === day.date);
      const dayIncomes = incomes.filter(i => i.date === day.date);
      const manual = dayIncomes.filter(i => !i.from_import);
      const usedManual = new Set();
      const lines = [];

      day.positions.forEach(p => {
        const key = lineKey(file.konto, day.date, p.categoryId);
        const web = mapping[p.categoryId] || 'Custom';
        const prev = dayImports.find(i => i.counter_category_id === p.categoryId) || null;
        const line = {
          key, date: day.date, categoryId: p.categoryId, categoryName: p.categoryName, website: web,
          cents: p.cents, amountText: p.amountText, quantity: p.quantity, quantityStatus: p.quantityStatus,
          quantityNote: p.quantityNote, previous: prev, conflicts: [], kind: null, action: null,
          needsChoice: false, choice: choices[key] || null, blocked: null, diffCents: 0,
          wage: WAGE_CATEGORIES.includes(web) && day.date >= WAGE_START
        };
        const prevActive = prev && prev.status === 'aktiv';
        if (prevActive && Date.parse(prev.revision_created_at) > Date.parse(day.revisionCreatedAt)) {
          line.kind = 'older';
          line.blocked = 'Auf der Website steht bereits eine neuere Revision dieses Tages.';
          line.action = 'skip';
        } else if (prevActive && prev.income) {
          const same = prev.revision_id === day.revisionId && prev.fingerprint === day.fingerprint
            && prev.website_category === web && numberToCents(prev.income.amount) === p.cents
            && (prev.income.quantity == null ? null : Number(prev.income.quantity)) === p.quantity
            && prev.income.category === web;
          line.kind = same ? 'unchanged' : 'update';
          line.action = 'update';
          line.diffCents = p.cents - numberToCents(prev.income.amount);
        } else if (prevActive && !prev.income) {
          line.kind = 'deleted';
          line.needsChoice = true;
          line.action = line.choice === 'recreate' ? 'create' : 'skip';
          line.diffCents = line.action === 'create' ? p.cents : 0;
        } else {
          line.kind = 'new';
          line.action = 'create';
          line.diffCents = p.cents;
        }
        // Von Hand erfasste Zeilen derselben Website-Kategorie an diesem Tag.
        if (line.kind === 'new' || line.kind === 'deleted' || line.kind === 'update') {
          line.conflicts = manual.filter(m => m.category === web && !usedManual.has(m.id));
          if (line.conflicts.length) {
            line.conflicts.forEach(m => usedManual.add(m.id));
            line.needsChoice = true;
            if (line.kind !== 'deleted') {
              if (line.choice === 'skip') { line.action = 'skip'; line.diffCents = 0; }
              else if (line.choice === 'replace') {
                line.diffCents -= line.conflicts.reduce((s, m) => s + numberToCents(m.amount), 0);
              }
            } else if (line.choice === 'replace') {
              line.action = 'create';
              line.diffCents = p.cents - line.conflicts.reduce((s, m) => s + numberToCents(m.amount), 0);
            }
          }
        }
        if (line.needsChoice && !line.choice) line.missingChoice = true;
        if (line.needsChoice && line.choice && line.kind === 'deleted' && !['recreate', 'skip', 'replace'].includes(line.choice)) line.missingChoice = true;
        lines.push(line);
      });

      // Frueher importiert, in dieser Revision nicht mehr enthalten -> entfernen.
      dayImports.filter(i => i.status === 'aktiv' && !day.positions.some(p => p.categoryId === i.counter_category_id)).forEach(i => {
        const older = Date.parse(i.revision_created_at) > Date.parse(day.revisionCreatedAt);
        lines.push({
          key: i.import_key, date: day.date, categoryId: i.counter_category_id, categoryName: i.counter_category_name,
          website: i.website_category, cents: 0, amountText: '0.00', quantity: null, quantityStatus: 'offen', quantityNote: '',
          previous: i, conflicts: [], kind: older ? 'older' : 'remove', action: older ? 'skip' : 'remove',
          blocked: older ? 'Auf der Website steht bereits eine neuere Revision dieses Tages.' : null,
          needsChoice: false, choice: null, diffCents: older || !i.income ? 0 : -numberToCents(i.income.amount),
          wage: WAGE_CATEGORIES.includes(i.website_category) && day.date >= WAGE_START
        });
      });

      const beforeCents = dayIncomes.reduce((s, i) => s + numberToCents(i.amount), 0);
      const afterCents = beforeCents + lines.reduce((s, l) => s + l.diffCents, 0);
      const untouched = manual.filter(m => !usedManual.has(m.id));
      return {
        date: day.date, revisionId: day.revisionId, revisionCreatedAt: day.revisionCreatedAt, fingerprint: day.fingerprint,
        erfassung: day.erfassung, transactions: day.transactions, cents: day.cents, lines, beforeCents, afterCents, untouched
      };
    });
    const allLines = days.flatMap(d => d.lines);
    const missing = allLines.filter(l => l.missingChoice).length;
    const writes = allLines.filter(l => l.action !== 'skip' && l.kind !== 'unchanged').length;
    return {
      konto: file.konto, days, missingChoices: missing,
      hasChanges: writes > 0,
      canConfirm: missing === 0 && writes > 0,
      importCents: allLines.filter(l => l.action === 'create' || l.action === 'update').reduce((s, l) => s + l.cents, 0),
      diffCents: days.reduce((s, d) => s + (d.afterCents - d.beforeCents), 0)
    };
  }

  /* ---------- Auftrag fuer tageszaehler_import_apply ---------- */
  function buildRequest(plan) {
    const lines = [];
    plan.days.forEach(day => day.lines.forEach(l => {
      if (l.missingChoice) fail('Für ' + formatDateDe(l.date) + ', ' + l.categoryName + ' fehlt noch eine Entscheidung.');
      const out = {
        date: l.date, counter_category_id: l.categoryId, counter_category_name: l.categoryName, website_category: l.website,
        amount: l.amountText, quantity: l.quantity, quantity_status: l.quantity == null && l.quantityStatus === 'vollstaendig' ? 'vollstaendig' : l.quantityStatus,
        revision_id: day.revisionId, revision_created_at: day.revisionCreatedAt, fingerprint: day.fingerprint, action: l.action
      };
      if ((l.action === 'create' || l.action === 'update') && l.choice === 'replace' && l.conflicts.length) {
        out.replace_income_ids = l.conflicts.map(m => m.id);
      }
      lines.push(out);
    }));
    return { konto: plan.konto, lines };
  }

  /* Verstaendlicher Text fuer Fehlercodes der Datenbank. */
  const ERROR_TEXTS = {
    not_admin: 'Keine Berechtigung: Nur aktive Admin- oder Redakteurs-Konten dürfen importieren.',
    stale_preview: 'Seit der Vorschau hat sich an diesen Tagen etwas geändert (Einnahmen oder frühere Importe). Es wurde nichts gespeichert – bitte die Vorschau neu laden und erneut prüfen.',
    older_revision: 'Auf der Website steht bereits eine neuere Revision. Eine ältere Fassung überschreibt nichts.',
    batch_conflict: 'Diese Übertragung wurde mit anderem Inhalt schon einmal gesendet. Bitte die Vorschau neu laden.',
    already_imported: 'Diese Position ist bereits importiert. Bitte die Vorschau neu laden.',
    not_imported: 'Eine zu aktualisierende Position ist auf der Website nicht (mehr) vorhanden. Bitte die Vorschau neu laden.',
    invalid_replace: 'Eine zum Ersetzen ausgewählte Einnahme passt nicht (anderer Tag, andere Kategorie oder selbst aus einem Import).',
    invalid_website_category: 'Unbekannte Website-Kategorie.',
    mixed_revisions: 'Für einen Tag wurden zwei verschiedene Revisionen übergeben.'
  };
  function errorText(err) {
    const raw = String((err && (err.message || err.code)) || err || '');
    const code = Object.keys(ERROR_TEXTS).find(k => raw.includes(k));
    if (code) return { code, text: ERROR_TEXTS[code] };
    if (/invalid_/.test(raw)) return { code: 'invalid', text: 'Die Datenbank hat den Auftrag als ungültig abgelehnt (' + raw + '). Es wurde nichts gespeichert.' };
    if (/Could not find the function|PGRST202|404/.test(raw)) return { code: 'missing_sql', text: 'Die Import-Funktionen sind in der Datenbank noch nicht eingerichtet (sql/20261015-tageszaehler-import.sql ausführen).' };
    return { code: 'unknown', text: raw || 'Unbekannter Fehler.' };
  }

  const api = {
    FORMAT, VERSION, DEFAULT_MAPPING, MAPPING_NOTES, WAGE_CATEGORIES, WAGE_START,
    amountTextToCents, centsToAmountText, numberToCents, formatCents, formatDateDe,
    parseImportFile, suggestMapping, buildPlan, buildRequest, lineKey, errorText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BKMP_TZ_IMPORT = api;
})(typeof window !== 'undefined' ? window : null);
