/* Bkmp - BKInvestment Auszahlungs-Buerokratie (02.10.2026)
   =====================================================================
   Erweiterung des bestehenden Investoren-Auszahlungs-Pranks ("Auszahlung
   beantragen" -> Fake-Sicherheitspruefung -> Rickroll, siehe
   openInvestorPayoutPrank()/startInvestorSecurityCheck() in
   js/core/bkmp-site.js). Wird NICHT neu gebaut, sondern umschlossen:

   - Die 6 bestehenden Stufen (Bild drehen, Gedrueckt halten, Dayman/Lukas,
     Vertrauens-Slider, Checkboxen, Fingerabdruck) laufen unveraendert als
     "legacy"-Module der Vorpruefung (bkmp-site.js reicht sie ueber
     context.runLegacy() herein - ihre eigene Logik bleibt 1:1 bestehen).
   - Die Yaksha-Frage ist die neue Entscheidung mit +30 Captchas (JA UND
     NEIN - JA bekommt sie rueckwirkend, "weil er Kora warten liess").
   - Danach: Captcha-Zaehler, der jederzeit wachsen/schrumpfen kann,
     zufaellige + Pflicht-Ereignisse, Fake-Angebote, Fake-Finals, die
     letzten Drei, und erst GANZ am Ende context.finish() -> die bereits
     bestehende triggerPrankReveal() (einziger Rickroll-Pfad, unveraendert).

   Modul-Registrierung: siehe register() - jedes Modul beschreibt ID, Titel,
   Typ, Schwierigkeit, Strafe, Mindestfortschritt, Maximalhaeufigkeit,
   Zufall/Pflicht/Einmaligkeit und Mobile-Tauglichkeit. Neue Captchas/
   Ereignisse koennen jederzeit ueber window.BkmpPayoutBureaucracy.register()
   ergaenzt werden.

   Anti-Frust (Auftrag Abschnitt 52): alles bleibt loesbar, Hilfestellung
   nach mehreren Fehlversuchen, harte Obergrenze MAX_TOTAL fuer die
   Gesamtzahl aller Captchas, Zustand in localStorage (Reload setzt nicht
   zurueck, laesst sich aber auch nicht zum Abkuerzen missbrauchen), echte
   Pause-Moeglichkeit nach wiederholtem Fake-Abbruch. Kein echtes Geld,
   keine echten Kaeufe, keine externen Aktionen. */
(function () {
  'use strict';

  const STORAGE_KEY = 'bkmp-payout-bureaucracy-v1';
  const STATE_VERSION = 1;
  const DEFAULT_MAX_TOTAL = 70;         // gesamt je vergebene Haupt-Captchas (geloest + offen), Anti-Frust-Deckel
  const DEFAULT_YAKSHA_PENALTY = 30;    // Grundstrafe der Yaksha-Entscheidung
  /* Testmodus (Nutzerwunsch 02.10.2026, "will es selber mehrmals testen"):
     ?pranktest=1    -> nichts wird gespeichert/geladen, jeder Start ist frisch
     ?pranktest=kurz -> zusaetzlich stark verkuerzt (Grundstrafe 8, Deckel 24)
     Wird bei jedem start() neu aus der URL gelesen. Normale Besucher (ohne
     Parameter) behalten das Speichern - Reload darf dort nichts umgehen. */
  let MAX_TOTAL = DEFAULT_MAX_TOTAL;
  let YAKSHA_PENALTY = DEFAULT_YAKSHA_PENALTY;
  let persist = true;
  function readTestMode() {
    let mode = null;
    try { mode = new URLSearchParams(window.location.search).get('pranktest'); } catch (e) { mode = null; }
    persist = !mode;
    MAX_TOTAL = mode === 'kurz' ? 24 : DEFAULT_MAX_TOTAL;
    YAKSHA_PENALTY = mode === 'kurz' ? 8 : DEFAULT_YAKSHA_PENALTY;
    return mode;
  }
  const MIN_REMAINING_AFTER_BONUS = 5;  // Positiv-Ereignisse duerfen die Restmenge nie unter diesen Wert druecken
  const ACHIEVEMENTS = [
    [10, 'Nicht aufgegeben'],
    [25, 'Warum machst du das noch?'],
    [50, 'Verwaltungsfachkraft'],
    [70, 'Ich will doch nur mein Geld'],
    [100, 'Teil des Systems']
  ];
  const PRE_SEQUENCE = ['intro', 'legacyRotate', 'legacyHold', 'legacyDaymanLukas', 'legacyTrust', 'legacyLegal', 'legacyFingerprint', 'yakshaDecision'];

  const isTouch = (() => {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
  })();

  /* ------------------------------------------------------------------
     Modul-Registry
     ------------------------------------------------------------------ */
  const MODULES = new Map();
  const CAPTCHA_TYPES = ['captcha', 'miniGame'];

  function register(def) {
    if (!def || !def.id || typeof def.run !== 'function') return;
    const mod = Object.assign({
      title: '',
      description: '',
      type: 'captcha',        // captcha | event | fakeOffer | bureaucracy | decision | miniGame | fakeFinal | final | legacy | system
      difficulty: 1,          // 0 = trivial ... 3 = fummelig
      penalty: 0,             // typische Strafe in Captchas (Dokumentation/Planung)
      extraCaptchas: 0,       // moegliche Zusatz-Captchas (positiv) bzw. Bonus (negativ)
      minSolved: 0,           // Mindestfortschritt (geloeste Captchas)
      maxCount: 1,            // Maximalhaeufigkeit pro Durchlauf
      random: true,           // darf vom Zufallsplaner gezogen werden
      once: false,            // einmalig (setzt maxCount = 1)
      mandatory: false,       // Pflicht - laeuft spaetestens vor den letzten Drei
      mobile: true,           // auf Touch-Geraeten sinnvoll bedienbar
      weight: 1,
      easy: false,            // darf in den "letzten Drei" vorkommen
      positive: false,        // senkt die Restmenge
      after: null,            // erst nach diesem Modul (Kette, z.B. Unterschrift nach Formular)
      cond: null              // optionale Zusatzbedingung (state) => bool
    }, def);
    if (def.countsAsCaptcha === undefined) mod.countsAsCaptcha = CAPTCHA_TYPES.includes(mod.type);
    if (mod.once) mod.maxCount = 1;
    MODULES.set(mod.id, mod);
  }

  /* ------------------------------------------------------------------
     Helfer
     ------------------------------------------------------------------ */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function weightedPick(list) {
    const total = list.reduce((s, m) => s + (m.weight || 1), 0);
    let r = Math.random() * total;
    for (const m of list) {
      r -= (m.weight || 1);
      if (r <= 0) return m;
    }
    return list[list.length - 1];
  }
  function fmtNum(n) { return Number(n).toLocaleString('de-DE'); }
  function captchaWord(n) { return Math.abs(n) === 1 ? 'Captcha' : 'Captchas'; }

  /* ------------------------------------------------------------------
     Zustand (pro Investor in localStorage)
     ------------------------------------------------------------------ */
  let ctx = null;
  let state = null;
  let runToken = 0;
  let cleanups = [];
  let activeLayer = null;

  function loadAll() {
    if (!persist) return {};
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveAll(all) {
    if (!persist) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (e) { /* privater Modus o.ae. - laeuft trotzdem, nur ohne Fortsetzen */ }
  }
  function stateKey(name) {
    return String(name || '').trim().toLowerCase() || 'unbekannt';
  }
  function save() {
    if (!state) return;
    const all = loadAll();
    all[stateKey(state.investor)] = state;
    saveAll(all);
  }
  function clearSaved(name) {
    const all = loadAll();
    delete all[stateKey(name)];
    saveAll(all);
  }
  function newState(name) {
    return {
      v: STATE_VERSION,
      investor: String(name || ''),
      caseId: 'BK-AUSZ-14B/' + (10000 + Math.floor(Math.random() * 89999)),
      startedAt: Date.now(),
      phase: 'pre',            // pre | main | last3 | final
      preIndex: 0,
      remaining: 0,
      solved: 0,
      sinceEvent: 0,
      counts: {},
      recent: [],
      current: null,
      flags: { ach: [], fails: 0, fakeFinals: 0, exitAttempts: 0, supportUses: 0, premium: false, yaksha: null, last3Intro: false }
    };
  }
  function normalizeState(s) {
    s.counts = s.counts || {};
    s.recent = Array.isArray(s.recent) ? s.recent : [];
    s.flags = Object.assign({ ach: [], fails: 0, fakeFinals: 0, exitAttempts: 0, supportUses: 0, premium: false, yaksha: null, last3Intro: false }, s.flags || {});
    if (!Array.isArray(s.flags.ach)) s.flags.ach = [];
    s.remaining = Math.max(0, Number(s.remaining) || 0);
    s.solved = Math.max(0, Number(s.solved) || 0);
    return s;
  }

  /* Haupt-Captcha-Zaehler aendern. Positive Werte werden auf MAX_TOTAL
     gedeckelt und sind in den letzten Drei/im Finale gesperrt, negative
     druecken die Restmenge nie unter MIN_REMAINING_AFTER_BONUS. Gibt den
     TATSAECHLICH angewendeten Wert zurueck. */
  function addCaptchas(n) {
    if (!state || !n) return 0;
    if (state.phase === 'last3' || state.phase === 'final') return 0;
    if (n > 0) {
      const room = Math.max(0, MAX_TOTAL - (state.solved + state.remaining));
      n = Math.min(n, room);
    } else {
      const maxDrop = Math.max(0, state.remaining - MIN_REMAINING_AFTER_BONUS);
      n = -Math.min(-n, maxDrop);
    }
    if (!n) return 0;
    state.remaining += n;
    save();
    updateHeader(n);
    return n;
  }

  function progressPct() {
    if (!state) return 0;
    const total = state.solved + state.remaining;
    return total > 0 ? Math.round((state.solved / total) * 100) : 0;
  }

  /* ------------------------------------------------------------------
     Kopfbereich (Zaehler, Fortschritt, Werkzeugleiste)
     ------------------------------------------------------------------ */
  function updateHeader(delta) {
    if (!ctx || !state) return;
    const label = ctx.stepLabelEl;
    const fill = ctx.progressFillEl;
    let html = '';
    let pct = 0;
    if (state.phase === 'pre') {
      const idx = state.preIndex;
      html = idx === 0 ? 'Antrag wird angelegt' : `Vorprüfung ${idx} von ${PRE_SEQUENCE.length - 1}`;
      pct = Math.round((idx / PRE_SEQUENCE.length) * 100);
    } else if (state.phase === 'main') {
      html = `Offene Prüfungen: <strong class="bkb-count">${fmtNum(state.remaining)}</strong> · Gelöst: ${fmtNum(state.solved)}`;
      pct = progressPct();
    } else if (state.phase === 'last3') {
      html = `<strong class="bkb-count">FAST GESCHAFFT</strong> · Noch ${fmtNum(state.remaining)}`;
      pct = Math.max(90, progressPct());
    } else {
      html = 'Alle Prüfungen bestanden';
      pct = 100;
    }
    if (label) {
      label.innerHTML = html;
      if (delta) {
        const chip = document.createElement('span');
        chip.className = 'bkb-delta ' + (delta > 0 ? 'is-up' : 'is-down');
        chip.textContent = (delta > 0 ? '+' : '−') + Math.abs(delta);
        label.appendChild(chip);
        label.classList.remove('bkb-bump');
        void label.offsetWidth;
        label.classList.add('bkb-bump');
      }
    }
    if (fill) fill.style.width = pct + '%';
  }

  function installChrome() {
    uninstallChrome();
    if (!ctx || !ctx.headerEl) return;
    if (ctx.eyebrowEl) {
      ctx.eyebrowOriginalText = ctx.eyebrowEl.textContent;
      ctx.eyebrowEl.textContent = `BKInvestment · Auszahlungsakte ${state ? state.caseId : ''}`;
    }
    if (ctx.cardEl) ctx.cardEl.classList.add('bkb-active');
    const toolbar = document.createElement('div');
    toolbar.className = 'bkb-toolbar';
    toolbar.innerHTML = `
      <button type="button" class="bkb-tool" data-bkb-tool="support">💬 Support</button>
      <button type="button" class="bkb-tool" data-bkb-tool="phone">📞 Hotline</button>
      <button type="button" class="bkb-tool bkb-tool-exit" data-bkb-tool="exit">⏏ Captcha-System verlassen</button>`;
    toolbar.addEventListener('click', e => {
      const btn = e.target.closest('[data-bkb-tool]');
      if (!btn) return;
      const tool = btn.dataset.bkbTool;
      if (tool === 'support') openSupport();
      else if (tool === 'phone') openPhone();
      else if (tool === 'exit') openExit();
    });
    ctx.headerEl.insertBefore(toolbar, ctx.headerEl.firstChild);
    ctx.toolbarEl = toolbar;
  }

  function uninstallChrome() {
    if (!ctx) return;
    closeLayer();
    if (ctx.toolbarEl) { ctx.toolbarEl.remove(); ctx.toolbarEl = null; }
    if (ctx.eyebrowEl && ctx.eyebrowOriginalText != null) ctx.eyebrowEl.textContent = ctx.eyebrowOriginalText;
    if (ctx.cardEl) ctx.cardEl.classList.remove('bkb-active');
    if (ctx.overlayEl) ctx.overlayEl.querySelectorAll('.bkb-toast, .bkb-confetti').forEach(el => el.remove());
  }

  function toast(title, sub) {
    if (!ctx || !ctx.overlayEl) return;
    const el = document.createElement('div');
    el.className = 'bkb-toast';
    el.innerHTML = `<strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    ctx.overlayEl.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 400); }, 3800);
  }

  function confetti() {
    if (!ctx || !ctx.overlayEl) return;
    const colors = ['#c9a56a', '#a78bfa', '#4ade80', '#f87171', '#60a5fa', '#facc15'];
    const box = document.createElement('div');
    box.className = 'bkb-confetti';
    box.innerHTML = Array.from({ length: 34 }, (_, i) => {
      const left = Math.round(Math.random() * 100);
      const dur = (1.1 + Math.random() * 0.9).toFixed(2);
      const delay = (Math.random() * 0.25).toFixed(2);
      const rot = Math.round(Math.random() * 540 - 270);
      return `<span style="left:${left}%;background:${colors[i % colors.length]};animation-duration:${dur}s;animation-delay:${delay}s;--rot:${rot}deg"></span>`;
    }).join('');
    ctx.overlayEl.appendChild(box);
    setTimeout(() => box.remove(), 2400);
  }

  function checkAchievements() {
    for (const [n, title] of ACHIEVEMENTS) {
      if (state.solved === n && !state.flags.ach.includes(n)) {
        state.flags.ach.push(n);
        toast(`🏆 Erfolg: „${title}“`, `${n} Captchas gelöst`);
      }
    }
  }

  /* ------------------------------------------------------------------
     Ebenen (Support/Hotline/Abbruch) - liegen UEBER der Karte, das
     laufende Modul darunter bleibt unangetastet.
     ------------------------------------------------------------------ */
  function openLayer(html, setup) {
    closeLayer();
    if (!ctx || !ctx.overlayEl) return null;
    const el = document.createElement('div');
    el.className = 'bkb-layer';
    el.innerHTML = `<div class="joke-card bkb-layer-card" role="dialog" aria-modal="true">${html}</div>`;
    ctx.overlayEl.appendChild(el);
    const layer = { el, timers: [] };
    layer.after = (ms, fn) => { const t = setTimeout(() => { if (activeLayer === layer) fn(); }, ms); layer.timers.push(t); return t; };
    layer.close = () => closeLayer();
    activeLayer = layer;
    requestAnimationFrame(() => el.classList.add('visible'));
    if (typeof setup === 'function') setup(layer);
    return layer;
  }
  function closeLayer() {
    if (!activeLayer) return;
    activeLayer.timers.forEach(t => clearTimeout(t));
    activeLayer.el.remove();
    activeLayer = null;
  }

  function openSupport() {
    openLayer(`
      <div class="bkb-chat-head"><span class="bkb-dot"></span> BK Support · Sachbearbeiter Micha</div>
      <div class="bkb-chat" data-chat></div>
      <div class="bkb-chat-options" data-options></div>`, layer => {
      const chat = layer.el.querySelector('[data-chat]');
      const options = layer.el.querySelector('[data-options]');
      const say = (text, who) => {
        const b = document.createElement('div');
        b.className = 'bkb-bubble ' + (who === 'me' ? 'is-me' : (who === 'sys' ? 'is-sys' : 'is-bot'));
        b.textContent = text;
        chat.appendChild(b);
        chat.scrollTop = chat.scrollHeight;
      };
      const offer = (list, cb) => {
        options.innerHTML = '';
        list.forEach(label => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-nein';
          btn.textContent = label;
          btn.addEventListener('click', () => { options.innerHTML = ''; say(label, 'me'); cb(label); });
          options.appendChild(btn);
        });
      };
      layer.after(350, () => say('Hallo.'));
      layer.after(1250, () => say('Wie können wir helfen?'));
      layer.after(1700, () => offer(['Auszahlung funktioniert nicht', 'Captchas hören nicht auf', 'Ich möchte kündigen', 'Hilfe'], () => {
        layer.after(900, () => say('Das klingt ärgerlich.'));
        layer.after(2000, () => say('Hast du versucht, die Seite neu zu laden?'));
        layer.after(2500, () => offer(['JA'], () => {
          layer.after(1000, () => say('Dann wissen wir leider auch nicht weiter.'));
          layer.after(2000, () => say(`Ticket #${Math.floor(100000 + Math.random() * 899999)} wurde geschlossen.`, 'sys'));
          layer.after(2900, () => {
            if (state) state.flags.supportUses++;
            const applied = addCaptchas(1);
            say(applied > 0 ? 'Support-Nutzung: +1 Captcha.' : 'Support-Nutzung: ausnahmsweise kostenlos (Kulanz).', 'sys');
            options.innerHTML = '<button type="button" class="btn-ja" data-close>Chat schließen</button>';
            options.querySelector('[data-close]').addEventListener('click', () => layer.close());
          });
        }));
      }));
    });
  }

  function openPhone() {
    openLayer(`
      <div class="bkb-layer-kicker">Telefonischer Support verfügbar</div>
      <h3>BK Hotline</h3>
      <p class="bkb-line is-official">Aktuelle Wartezeit: <strong>0 Minuten</strong></p>
      <div class="bkb-phone" data-phone></div>
      <div class="joke-buttons bkb-actions" data-actions>
        <button type="button" class="btn-ja" data-call>Anrufen</button>
        <button type="button" class="btn-nein" data-close>Abbrechen</button>
      </div>`, layer => {
      const phone = layer.el.querySelector('[data-phone]');
      const actions = layer.el.querySelector('[data-actions]');
      layer.el.querySelector('[data-close]').addEventListener('click', () => layer.close());
      layer.el.querySelector('[data-call]').addEventListener('click', () => {
        actions.innerHTML = '';
        phone.innerHTML = '<p class="bkb-line is-muted">Verbindung wird hergestellt <span class="bkb-dots"><i></i><i></i><i></i></span></p>';
        layer.after(1800, () => {
          phone.innerHTML = `
            <p class="bkb-line is-err">Alle Mitarbeiter befinden sich derzeit im Gespräch.</p>
            <p class="bkb-line is-official">Geschätzte Wartezeit: <strong>11 Stunden 47 Minuten</strong></p>
            <p class="bkb-line is-muted">Ronja aus der Telefonzentrale lässt ausrichten: Bitte bleib in der Leitung.</p>
            <p class="bkb-line is-muted">♪ Warteschleifenmusik (Version 1 von 1) ♪</p>`;
          actions.innerHTML = '<button type="button" class="btn-nein" data-hang>Auflegen</button>';
          actions.querySelector('[data-hang]').addEventListener('click', () => layer.close());
        });
      });
    });
  }

  function openExit() {
    openLayer(`
      <div class="bkb-layer-kicker">Captcha-System verlassen</div>
      <div data-exit></div>
      <div class="joke-buttons bkb-actions" data-actions></div>`, layer => {
      const box = layer.el.querySelector('[data-exit]');
      const actions = layer.el.querySelector('[data-actions]');
      const buttons = list => {
        actions.innerHTML = '';
        list.forEach(([label, cls, fn]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = cls;
          b.textContent = label;
          b.addEventListener('click', fn);
          actions.appendChild(b);
        });
      };
      const step1 = () => {
        box.innerHTML = '<h3>Möchtest du wirklich abbrechen?</h3>';
        buttons([['JA', 'btn-ja', step2], ['Nein', 'btn-nein', () => layer.close()]]);
      };
      const step2 = () => {
        box.innerHTML = '<p class="bkb-line is-official">Abbruch muss bestätigt werden.</p><h3>Abbruch wirklich bestätigen?</h3>';
        buttons([['JA', 'btn-ja', step3], ['Nein', 'btn-nein', () => layer.close()]]);
      };
      const step3 = () => {
        if (state) { state.flags.exitAttempts++; save(); }
        box.innerHTML = '<p class="bkb-line is-err">Abbruch nicht möglich, solange Auszahlung aktiv ist.</p>';
        const list = [['Zurück', 'btn-ja', () => layer.close()]];
        // Anti-Frust: ab dem zweiten vollstaendigen Abbruchversuch gibt es
        // eine ECHTE Pause - der Stand bleibt gespeichert und wird beim
        // naechsten "Auszahlung beantragen" fortgesetzt.
        if (state && state.flags.exitAttempts >= 2) list.push(['Vorgang pausieren (Stand bleibt gespeichert)', 'btn-nein', pause]);
        buttons(list);
      };
      step1();
    });
  }

  /* ------------------------------------------------------------------
     Planer
     ------------------------------------------------------------------ */
  function eligibleBase(m) {
    return (state.counts[m.id] || 0) < m.maxCount
      && m.minSolved <= state.solved
      && (!m.after || (state.counts[m.after] || 0) > 0)
      && (!m.cond || m.cond(state))
      && (!isTouch || m.mobile !== false);
  }

  function pendingMandatory() {
    return [...MODULES.values()]
      .filter(m => m.mandatory && (state.counts[m.id] || 0) === 0 && (!m.cond || m.cond(state)) && (!m.after || (state.counts[m.after] || 0) > 0))
      .sort((a, b) => a.minSolved - b.minSolved);
  }

  function pickCaptcha(easyOnly) {
    const recent = new Set(state.recent.slice(0, 8));
    const cands = [...MODULES.values()].filter(m => m.countsAsCaptcha && m.random && !m.mandatory
      && !['system', 'legacy', 'final'].includes(m.type)
      && (!easyOnly || m.easy)
      && eligibleBase(m));
    let pool = cands.filter(m => !recent.has(m.id));
    if (!pool.length) pool = cands;
    if (!pool.length) return 'continueFallback';
    return weightedPick(pool).id;
  }

  function pickEvent() {
    const recent = new Set(state.recent.slice(0, 6));
    const pool = [...MODULES.values()].filter(m => !m.countsAsCaptcha && m.random && !m.mandatory
      && !['system', 'legacy', 'final'].includes(m.type)
      && !recent.has(m.id)
      && eligibleBase(m)
      && (!m.positive || state.remaining - Math.abs(m.extraCaptchas || 0) >= MIN_REMAINING_AFTER_BONUS + 3));
    if (!pool.length) return null;
    return weightedPick(pool).id;
  }

  function pickNext() {
    if (state.phase === 'pre') return PRE_SEQUENCE[Math.min(state.preIndex, PRE_SEQUENCE.length - 1)];
    if (state.phase === 'final') return 'finalPayout';
    if (state.phase === 'last3') {
      if (!state.flags.last3Intro) return 'last3Intro';
      if (state.remaining <= 1) return 'areYouDone';
      const endMods = [...MODULES.values()].filter(m => m.endOnly && (state.counts[m.id] || 0) === 0);
      if (endMods.length) return pick(endMods).id;
      const easy = pickCaptcha(true);
      return easy;
    }
    const pending = pendingMandatory();
    if (state.remaining <= 3) {
      if (pending.length) {
        // Pflicht-Captchas wuerden sonst die "letzten Drei" aufbrauchen -
        // vorher "neue Vorschriften" nachlegen (gedeckelt, max. 3x).
        const captchasPending = pending.filter(m => m.countsAsCaptcha).length;
        if (captchasPending > 0 && (state.counts.regulatoryBump || 0) < 3 && state.solved + state.remaining < MAX_TOTAL) return 'regulatoryBump';
        return pending[0].id;
      }
      state.phase = 'last3';
      state.remaining = Math.max(1, state.remaining);
      state.flags.last3Intro = false;
      return 'last3Intro';
    }
    const due = pending.filter(m => m.minSolved <= state.solved);
    if (due.length && state.sinceEvent >= 1) return due[0].id;
    if (state.sinceEvent >= 2 && Math.random() < 0.4) {
      const ev = pickEvent();
      if (ev) return ev;
    }
    return pickCaptcha(false);
  }

  /* ------------------------------------------------------------------
     Ablauf
     ------------------------------------------------------------------ */
  function cleanupModule() {
    runToken++;
    cleanups.forEach(fn => { try { fn(); } catch (e) { /* bereits entfernt */ } });
    cleanups = [];
    if (ctx) ctx.clearTimers();
  }

  function next() {
    if (!state || !ctx) return;
    cleanupModule();
    const id = pickNext();
    save();
    runModule(id);
  }

  function runModule(id) {
    const mod = MODULES.get(id) || MODULES.get('continueFallback');
    cleanupModule();
    if (mod.type !== 'system') { state.current = mod.id; save(); }
    if (ctx.cardEl) ctx.cardEl.scrollTop = 0;
    updateHeader();
    const api = makeApi(mod, runToken);
    try {
      mod.run(api);
    } catch (e) {
      console.error('Auszahlungsbürokratie: Modul fehlgeschlagen', mod.id, e);
      api.done();
    }
  }

  function finishModule(mod, opts) {
    state.counts[mod.id] = (state.counts[mod.id] || 0) + 1;
    state.recent = [mod.id, ...state.recent].slice(0, 12);
    if (state.phase === 'pre') {
      state.preIndex++;
      if (state.preIndex >= PRE_SEQUENCE.length) state.phase = 'main';
    } else {
      const counts = opts && opts.count !== undefined ? opts.count : mod.countsAsCaptcha;
      if (counts) {
        state.solved++;
        state.remaining = Math.max(0, state.remaining - 1);
        state.sinceEvent++;
        checkAchievements();
      } else {
        state.sinceEvent = 0;
      }
      if (state.phase === 'last3' && state.remaining <= 0) state.phase = 'final';
    }
    state.current = null;
    save();
    updateHeader();
    next();
  }

  /* Neue Meldungen erscheinen unten in der (scrollbaren) Karte - auf
     kleinen Bildschirmen laegen sie sonst unsichtbar unterhalb. */
  function scrollCardToEnd() {
    const card = ctx && ctx.cardEl;
    if (!card || card.scrollHeight <= card.clientHeight + 4) return;
    try { card.scrollTo({ top: card.scrollHeight, behavior: 'smooth' }); } catch (e) { card.scrollTop = card.scrollHeight; }
  }

  function makeApi(mod, token) {
    let localFails = 0;
    let hintShown = false;
    const alive = () => token === runToken && !!ctx && !!state;
    const api = {
      mod,
      get state() { return state; },
      get flags() { return state.flags; },
      ctx,
      isTouch,
      alive,
      investor: (state && state.investor) || 'Investor',
      q: sel => ctx.stageEl.querySelector(sel),
      qa: sel => Array.from(ctx.stageEl.querySelectorAll(sel)),
      after(ms, fn) {
        const t = setTimeout(() => { if (alive()) fn(); }, ms);
        ctx.addTimer(t);
        return t;
      },
      every(ms, fn) {
        const t = setInterval(() => { if (alive()) fn(); else clearInterval(t); }, ms);
        ctx.addTimer(t);
        return t;
      },
      on(target, evt, fn, opts) {
        target.addEventListener(evt, fn, opts);
        cleanups.push(() => target.removeEventListener(evt, fn, opts));
      },
      render(html, setup) {
        ctx.render(html, () => { if (alive() && typeof setup === 'function') setup(); });
      },
      screen(o) {
        const kicker = state.phase === 'last3' ? `Noch ${state.remaining}.` : (o.kicker || '');
        return `
          <div class="bkb-screen ${o.cls || ''}">
            ${kicker ? `<div class="bkb-kicker">${esc(kicker)}</div>` : ''}
            ${o.title ? `<h3>${esc(o.title)}</h3>` : ''}
            ${o.lead ? `<p class="investor-security-lead">${o.leadHtml ? o.lead : esc(o.lead)}</p>` : ''}
            ${o.body || ''}
            <p class="investor-security-feedback bkb-feedback" hidden></p>
            <div class="bkb-seq"></div>
            <div class="joke-buttons bkb-actions"></div>
          </div>`;
      },
      line(text, kind, opts) {
        const box = (opts && opts.into) || api.q('.bkb-seq');
        if (!box) return null;
        const el = document.createElement(opts && opts.tag || 'p');
        el.className = 'bkb-line' + (kind ? ' is-' + kind : '');
        if (opts && opts.html) el.innerHTML = text; else el.textContent = text;
        box.appendChild(el);
        scrollCardToEnd();
        return el;
      },
      feedback(text, kind) {
        const el = api.q('.bkb-feedback');
        if (!el) return;
        el.hidden = !text;
        el.className = 'investor-security-feedback bkb-feedback ' + (kind === 'ok' ? 'is-success' : (kind === 'err' ? 'is-error' : 'is-muted'));
        el.textContent = text || '';
      },
      seq(steps, onEnd) {
        let i = 0;
        const run = () => {
          if (!alive()) return;
          if (i >= steps.length) { if (onEnd) onEnd(); return; }
          const s = typeof steps[i] === 'string' ? { t: steps[i] } : steps[i];
          const wait = s.w != null ? s.w : (i === 0 ? 250 : 1050);
          i++;
          api.after(wait, () => {
            if (s.fn) s.fn();
            if (s.p) api.penalty(s.p, { big: s.big, label: s.label });
            else if (s.stamp) api.stamp(s.stamp, s.kind);
            else if (s.t || s.html) api.line(s.html || s.t, s.k, { html: !!s.html });
            run();
          });
        };
        run();
      },
      penalty(n, opts) {
        const applied = addCaptchas(n);
        const box = api.q('.bkb-seq');
        if (!box) return applied;
        if (n > 0 && applied === 0) {
          api.line('Kulanzregelung: Zusatzprüfung entfällt (Obergrenze erreicht).', 'muted');
        } else if (n < 0 && applied === 0) {
          api.line('Bonus bereits ausgeschöpft. Restmenge bleibt unverändert.', 'muted');
        } else if (opts && opts.big) {
          const el = document.createElement('div');
          el.className = 'bkb-penalty-big' + (applied < 0 ? ' is-bonus' : '');
          el.innerHTML = `${applied > 0 ? '+' : '−'}${Math.abs(applied)} <span>${applied > 0 ? 'CAPTCHAS' : 'CAPTCHAS'}</span>`;
          box.appendChild(el);
        } else {
          api.line(`${applied > 0 ? '+' : '−'}${Math.abs(applied)} ${(opts && opts.label) || captchaWord(applied)}`, applied > 0 ? 'penalty' : 'bonus');
        }
        if (n > 0 && applied > 0 && applied < n) api.line('(gedeckelt durch Kulanzregelung)', 'muted');
        scrollCardToEnd();
        return applied;
      },
      stamp(text, kind) {
        const box = api.q('.bkb-seq');
        if (!box) return;
        const el = document.createElement('div');
        el.className = 'bkb-stamp' + (kind ? ' is-' + kind : '');
        el.textContent = text;
        box.appendChild(el);
      },
      actions(list) {
        const box = api.q('.bkb-actions');
        if (!box) return null;
        box.innerHTML = '';
        list.forEach(a => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = a.cls || 'btn-ja';
          b.textContent = a.label;
          b.addEventListener('click', () => { if (alive()) a.onClick(b); });
          box.appendChild(b);
        });
        if (list.length) scrollCardToEnd();
        return box;
      },
      continueBtn(label) {
        api.actions([{ label: label || 'Weiter', onClick: () => api.done() }]);
      },
      fail(hint) {
        localFails++;
        state.flags.fails++;
        if (hint && localFails >= 3 && !hintShown) {
          hintShown = true;
          const box = api.q('.bkb-seq');
          if (box) {
            const h = document.createElement('p');
            h.className = 'bkb-hint';
            h.textContent = 'Hinweis der Finanzabteilung: ' + hint;
            box.appendChild(h);
          }
        }
        return localFails;
      },
      get localFails() { return localFails; },
      toast,
      confetti,
      done(opts) {
        if (!alive()) return;
        runToken++;
        finishModule(mod, opts || {});
      }
    };
    return api;
  }

  /* Wiederverwendbare Bausteine fuer Module, die "nur" aus einer Folge von
     Meldungen bestehen (der Grossteil der Buerokratie-Ereignisse). */
  function messageModule(api, o) {
    api.render(api.screen({ title: o.title, lead: o.lead, kicker: o.kicker, body: o.body || '', cls: o.cls }), () => {
      if (o.setup) o.setup();
      api.seq(o.steps || [], () => {
        if (o.onEnd) { o.onEnd(); return; }
        if (o.auto) api.after(o.autoDelay || 1100, () => api.done());
        else api.continueBtn(o.button || 'Weiter');
      });
    });
  }

  /* Einfache Auswahl-Captchas: eine Frage, mehrere Antworten, jede Antwort
     hat ihre eigene Reaktion (Text/Strafe). */
  function choiceModule(api, o) {
    api.render(api.screen({ title: o.title, lead: o.lead, kicker: o.kicker, body: `
      ${o.pre || ''}
      ${o.question ? `<p class="investor-security-question">${esc(o.question)}</p>` : ''}
      <div class="bkb-choices ${o.grid ? 'is-grid' : ''}">
        ${o.options.map((opt, i) => `<button type="button" class="bkb-choice" data-i="${i}">${esc(opt.label)}</button>`).join('')}
      </div>` }), () => {
      const btns = api.qa('.bkb-choice');
      btns.forEach(b => b.addEventListener('click', () => {
        const opt = o.options[Number(b.dataset.i)];
        if (opt.retry) {
          b.disabled = true;
          api.feedback(opt.retry, 'err');
          api.fail(o.hint);
          return;
        }
        btns.forEach(x => { x.disabled = true; });
        b.classList.add('is-picked');
        api.feedback('', null);
        api.seq(opt.steps || [{ t: opt.reply || 'Antwort gespeichert.', k: 'official' }], () => api.continueBtn(o.button || 'Weiter'));
      }));
    });
  }

  /* ------------------------------------------------------------------
     SYSTEM-MODULE
     ------------------------------------------------------------------ */
  register({
    id: 'resume', type: 'system', random: false, title: 'Vorgang fortsetzen',
    run(api) {
      api.render(api.screen({ title: 'Vorgang wird fortgesetzt', kicker: state.caseId }), () => {
        const steps = [
          { t: 'Bearbeitungsstand wiederhergestellt.', k: 'ok' },
          state.phase === 'pre'
            ? { t: `Vorprüfung ${Math.max(1, state.preIndex)} von ${PRE_SEQUENCE.length - 1} wird fortgesetzt.`, k: 'official' }
            : { t: `Offene Prüfungen: ${state.remaining}.`, k: 'official' },
          { t: 'Hinweis: Ein Neuladen der Seite beschleunigt die Bearbeitung nicht.', k: 'muted' }
        ];
        api.seq(steps, () => api.actions([{
          label: 'Fortfahren',
          onClick: () => {
            const target = state.current && MODULES.has(state.current) ? state.current : null;
            if (target) runModule(target); else next();
          }
        }]));
      });
    }
  });

  /* Ausweich-Captcha, falls der Zufallspool wirklich einmal leer ist.
     Nutzer-Meldung 03.10.2026 ("das komplette Ende waren 6-8 das gleiche
     Captcha mit klicke zum fortfahren"): statt einer einzigen Seite jetzt
     viele kleine, unterschiedliche Formalitaeten - jede hoechstens einmal
     (state.flags.fallbackUsed), erst wenn ALLE verbraucht sind, beginnt
     die Liste von vorn. */
  const FALLBACK_VARIANTS = [
    { title: 'Verfahrensfortgang', lead: 'Bitte bestätige den Fortgang des Verfahrens.', btn: 'Fortgang bestätigen', reply: 'Fortgang bestätigt.' },
    { title: 'Anwesenheitsprüfung', lead: 'Bitte bestätige, dass du noch da bist.', btn: 'Ich bin noch da', reply: 'Anwesenheit vermerkt.' },
    { title: 'Zwischenspeicherung', lead: 'Dein Fortschritt muss zwischengespeichert werden.', btn: 'Zwischenspeichern', reply: 'Zwischengespeichert. Wo genau, wissen wir nicht.' },
    { title: 'Atemprüfung', lead: 'Bitte atme einmal tief durch.', btn: 'Erledigt', reply: 'Atmung im normalen Bereich.' },
    { title: 'Richtigkeitserklärung', lead: 'Bitte bestätige die Richtigkeit aller bisherigen Angaben.', btn: 'Alles korrekt', reply: 'Danke. Wir haben sie nicht geprüft.' },
    { title: 'Nickprüfung', lead: 'Bitte nicke einmal zustimmend.', btn: 'Genickt', reply: 'Nicken erkannt.' },
    { title: 'Aktenfoto', lead: 'Bitte lächle für die Akte.', btn: 'Gelächelt', reply: 'Lächeln abgelegt unter: Sonstiges.' },
    { title: 'Vollständigkeitsprüfung', lead: 'Bitte bestätige, dass du kein Formular vergessen hast.', btn: 'Keins vergessen', reply: 'Das sagen alle.' },
    { title: 'Klopfprüfung', lead: 'Bitte klopfe zweimal an.', btn: 'Klopf', reply: 'Herein.', clicks: 2 },
    { title: 'Empfangsbestätigung', lead: 'Bitte bestätige den Empfang dieser Bestätigungsanfrage.', btn: 'Empfang bestätigen', reply: 'Empfang des Empfangs bestätigt.' },
    { title: 'Konzentrationsprüfung', lead: 'Bitte denke 3 Sekunden lang an nichts.', btn: 'An nichts gedacht', reply: 'Du hast an die Auszahlung gedacht. Akzeptiert.' },
    { title: 'Geduldsquittung', lead: 'Bitte quittiere deine bisherige Geduld.', btn: 'Quittieren', reply: 'Geduld quittiert. Restgeduld wird später abgerechnet.' },
    { title: 'Sitzhaltung', lead: 'Bitte setze dich gerade hin.', btn: 'Sitze gerade', reply: 'Haltung dokumentiert.' },
    { title: 'Ablagevermerk', lead: 'Bitte lege diesen Vorgang gedanklich ab.', btn: 'Abgelegt', reply: 'Vorgang gedanklich abgelegt. Physisch nicht.' }
  ];
  register({
    id: 'continueFallback', type: 'captcha', random: false, maxCount: 999, title: 'Formalität',
    run(api) {
      if (!Array.isArray(state.flags.fallbackUsed)) state.flags.fallbackUsed = [];
      let free = FALLBACK_VARIANTS.map((_, i) => i).filter(i => !state.flags.fallbackUsed.includes(i));
      if (!free.length) { state.flags.fallbackUsed = []; free = FALLBACK_VARIANTS.map((_, i) => i); }
      const idx = pick(free);
      state.flags.fallbackUsed.push(idx);
      save();
      const v = FALLBACK_VARIANTS[idx];
      let clicks = 0;
      api.render(api.screen({ title: v.title, lead: v.lead }), () => {
        api.actions([{ label: v.btn, onClick: b => {
          clicks++;
          if (v.clicks && clicks < v.clicks) { api.feedback('Einmal noch.', null); return; }
          b.disabled = true;
          api.feedback(v.reply, 'ok');
          api.after(800, () => api.done());
        } }]);
      });
    }
  });

  /* Reserviert fuer die "letzten Drei" (vor "Bist du fertig?") - werden
     nie vorher vom Zufall gezogen, damit das Ende nie aus Resten besteht. */
  register({
    id: 'endSignHere', type: 'captcha', random: false, endOnly: true, title: 'Letzte Formalität',
    run(api) {
      api.render(api.screen({
        title: 'Letzte Formalität',
        lead: 'Bitte setze hier deinen letzten Haken.',
        body: '<label class="investor-security-check-row bkb-center-row"><input type="checkbox" class="investor-security-checkbox" data-box><span>Ich bin bereit für meine Auszahlung.</span></label>'
      }), () => {
        const box = api.q('[data-box]');
        box.addEventListener('change', () => {
          if (!box.checked) return;
          box.disabled = true;
          api.seq([{ t: 'Bereitschaft dokumentiert.', k: 'ok' }], () => api.continueBtn());
        });
      });
    }
  });
  register({
    id: 'endAlmost', type: 'captcha', random: false, endOnly: true, title: 'Fast fertig',
    run(api) {
      choiceModule(api, {
        title: 'Zwischenstand',
        question: 'Bitte bestätige, dass du gleich fertig bist.',
        options: [
          { label: 'Gleich fertig', reply: 'Wir auch.' },
          { label: 'Hoffentlich', reply: 'Hoffnung wurde zur Akte genommen.' }
        ]
      });
    }
  });
  register({
    id: 'endLastStamp', type: 'captcha', random: false, endOnly: true, title: 'Schlussvermerk',
    run(api) {
      api.render(api.screen({ title: 'Schlussvermerk', lead: 'Die Finanzabteilung setzt den Schlussvermerk.' }), () => {
        api.seq([{ stamp: 'GEPRÜFT', kind: 'ok', w: 500 }, { t: 'Schlussvermerk gesetzt.', k: 'official' }], () => api.continueBtn());
      });
    }
  });

  register({
    id: 'regulatoryBump', type: 'bureaucracy', random: false, maxCount: 3, extraCaptchas: 4, title: 'Neue Vorschriften',
    run(api) {
      const pendingCaptchas = pendingMandatory().filter(m => m.countsAsCaptcha).length;
      messageModule(api, {
        title: 'Bearbeitungsstatus aktualisiert',
        steps: [
          { t: 'Neue regulatorische Anforderungen erkannt.', k: 'err' },
          { t: 'Die bisherige Restmenge entspricht nicht mehr den aktuellen Vorschriften.', k: 'official' },
          { p: pendingCaptchas + 2 },
          { t: 'Wir bitten um Verständnis.', k: 'muted' }
        ]
      });
    }
  });

  register({
    id: 'last3Intro', type: 'system', random: false, title: 'Fast geschafft',
    run(api) {
      api.render(api.screen({ title: '' }), () => {
        state.flags.last3Intro = true;
        save();
        api.seq([
          { html: '<span class="bkb-big-text">FAST GESCHAFFT.</span>', w: 200 },
          { t: `Noch ${state.remaining}.`, k: 'official', w: 900 }
        ], () => api.after(1000, () => next()));
      });
    }
  });

  register({
    id: 'areYouDone', type: 'captcha', random: false, maxCount: 99, title: 'Letzte Prüfung',
    run(api) {
      api.render(api.screen({ title: 'Letzte Prüfung', body: '<p class="investor-security-question">Bist du fertig?</p>' }), () => {
        api.actions([{ label: 'JA', onClick: btn => { btn.disabled = true; api.feedback('Antwort akzeptiert.', 'ok'); api.after(700, () => api.done()); } }]);
      });
    }
  });

  register({
    id: 'finalPayout', type: 'final', random: false, maxCount: 99, title: 'Finale Auszahlung',
    run(api) {
      const msgs = Array.isArray(ctx.processingMessages) && ctx.processingMessages.length ? ctx.processingMessages : ['Auszahlungspaket wird freigegeben…'];
      const steps = [3, 14, 38, 61, 84, 97, 99, 100];
      api.render(api.screen({
        title: '',
        body: `
          <div class="bkb-final-head">ALLE PRÜFUNGEN BESTANDEN</div>
          <p class="investor-security-stage7-headline">Auszahlung wird vorbereitet.</p>
          <div class="bkb-final-pct" data-pct>0%</div>
          <div class="investor-security-stage7-track"><div class="investor-security-stage7-fill" data-fill></div></div>
          <ul class="investor-security-stage7-log" data-log></ul>`
      }), () => {
        const pctEl = api.q('[data-pct]');
        const fill = api.q('[data-fill]');
        const log = api.q('[data-log]');
        let msgIndex = 0;
        const perStep = Math.max(1, Math.ceil(msgs.length / steps.length));
        const addLog = () => {
          for (let k = 0; k < perStep && msgIndex < msgs.length; k++) {
            const prev = log.querySelector('.is-current');
            if (prev) { prev.classList.remove('is-current'); prev.classList.add('is-done'); }
            const li = document.createElement('li');
            li.className = 'is-current';
            li.textContent = msgs[msgIndex++];
            log.appendChild(li);
          }
          log.scrollTop = log.scrollHeight;
        };
        let i = 0;
        const tick = () => {
          if (i >= steps.length) {
            const prev = log.querySelector('.is-current');
            if (prev) { prev.classList.remove('is-current'); prev.classList.add('is-done'); }
            api.line('Auszahlung erfolgreich vorbereitet.', 'ok');
            const box = api.actions([{ label: 'AUSZAHLUNG ANZEIGEN', cls: 'btn-ja bkb-final-btn', onClick: btn => { btn.disabled = true; finish(); } }]);
            if (box) box.classList.add('bkb-final-actions');
            return;
          }
          const v = steps[i];
          pctEl.textContent = v + '%';
          fill.style.width = v + '%';
          addLog();
          i++;
          api.after(v === 99 ? 1700 : 650 + Math.random() * 250, tick);
        };
        api.after(400, tick);
      });
    }
  });

  /* ------------------------------------------------------------------
     VORPRUEFUNG (bestehende Stufen + Yaksha)
     ------------------------------------------------------------------ */
  register({
    id: 'intro', type: 'bureaucracy', random: false, title: 'Antrag angelegt',
    run(api) {
      messageModule(api, {
        title: 'Auszahlungsantrag eingegangen',
        steps: [
          { t: `Vorgang ${state.caseId} wurde angelegt.`, k: 'official' },
          { t: 'Zuständig: Finanzabteilung BKInvestment.', k: 'muted' },
          { t: 'Vor der Auszahlung sind einige kurze Sicherheitsprüfungen erforderlich.' },
          { t: 'Geschätzte Dauer: 2 Minuten.', k: 'muted' }
        ],
        button: 'Prüfung starten'
      });
    }
  });

  [
    ['legacyRotate', 'rotate', 'Identitätsprüfung'],
    ['legacyHold', 'hold', 'Sicherheitsprüfung'],
    ['legacyDaymanLukas', 'daymanLukas', 'Wissensprüfung'],
    ['legacyTrust', 'trust', 'Vertrauensabgleich'],
    ['legacyLegal', 'legal', 'Rechtliche Bestätigung'],
    ['legacyFingerprint', 'fingerprint', 'Biometrische Prüfung']
  ].forEach(([id, key, title]) => register({
    id, type: 'legacy', random: false, title,
    run(api) {
      if (typeof ctx.runLegacy !== 'function') { api.done(); return; }
      ctx.runLegacy(key, () => api.done());
    }
  }));

  register({
    id: 'yakshaDecision', type: 'decision', random: false, penalty: YAKSHA_PENALTY, title: 'Texturenwunsch-Entscheidung',
    description: 'Darf Yaksha ihr Texturenwunsch haben? - JA und NEIN kosten beide +30 (JA rueckwirkend, Kora wurde warten gelassen).',
    run(api) {
      const images = Array.isArray(ctx.yakshaImages) ? ctx.yakshaImages : [];
      api.render(api.screen({
        title: 'Zustimmungsprüfung',
        lead: 'Bitte beantworte die folgende Frage.',
        body: `
          <p class="investor-security-question">Darf Yaksha ihr Texturenwunsch haben?</p>
          <div class="joke-buttons investor-security-answer-row" data-answers>
            <button type="button" class="btn-ja investor-security-answer-btn" data-yes>JA</button>
            <button type="button" class="btn-nein investor-security-answer-btn" data-no>NEIN</button>
          </div>
          ${images.length ? `
          <details class="investor-security-spoiler" data-spoiler hidden>
            <summary>🔍 Spoiler: Yakshas Arbeit bereits ansehen</summary>
            <div class="investor-security-spoiler-gallery">
              ${images.map(src => `<img class="investor-security-spoiler-img" src="${esc(src)}" alt="Yakshas Texturwunsch-Drache (Work in Progress)">`).join('')}
            </div>
          </details>` : ''}`
      }), () => {
        const yes = api.q('[data-yes]');
        const no = api.q('[data-no]');
        const spoiler = api.q('[data-spoiler]');
        const lock = () => { yes.disabled = true; no.disabled = true; };
        yes.addEventListener('click', () => {
          lock();
          state.flags.yaksha = 'ja';
          save();
          api.seq([
            { t: 'Ausnahmeregelung genehmigt.', k: 'ok' },
            { t: 'Sag aber niemandem was.', k: 'muted', w: 1500 },
            { stamp: 'GENEHMIGT', kind: 'ok', w: 700, fn: () => { if (spoiler) spoiler.hidden = false; } },
            { t: 'Nachtrag der Finanzabteilung:', k: 'official', w: 2600 },
            { t: 'Laut Akte hast du Kora warten lassen.', k: 'err', w: 1300 },
            { t: 'Wartezeit-Ausgleich wird rückwirkend erhoben.', k: 'official', w: 1300 },
            { p: YAKSHA_PENALTY, big: true, w: 1100 },
            { t: 'BKInvestment bedankt sich für deine Kooperation.', k: 'muted', w: 1200 }
          ], () => api.continueBtn('Weiter'));
        });
        no.addEventListener('click', () => {
          lock();
          state.flags.yaksha = 'nein';
          save();
          api.seq([
            { t: 'Entscheidung gespeichert.', k: 'official' },
            { t: 'Diese Entscheidung hat administrative Konsequenzen.', k: 'err', w: 1500 },
            { p: YAKSHA_PENALTY, big: true, w: 1300 },
            { t: 'BKInvestment bedankt sich für deine Kooperation.', k: 'muted', w: 1200 },
            { t: 'Yaksha wurde informiert.', k: 'muted', w: 1000 }
          ], () => api.continueBtn('Weiter'));
        });
      });
    }
  });

  /* ------------------------------------------------------------------
     CAPTCHAS - absurd, einfach, Buerokratie
     ------------------------------------------------------------------ */
  register({
    id: 'shape', type: 'captcha', difficulty: 0, maxCount: 1, penalty: 1, title: 'Formerkennung',
    run(api) {
      const shapes = [['square', 'Quadrat'], ['circle', 'Kreis'], ['triangle', 'Dreieck']];
      const target = pick(shapes);
      api.render(api.screen({
        title: 'Formerkennung',
        lead: `Klicke auf das ${target[1]}.`,
        body: `<div class="bkb-shapes">${shuffle(shapes).map(([k, n]) => `<button type="button" class="bkb-shape is-${k}" data-shape="${k}" aria-label="${n}"></button>`).join('')}</div>`
      }), () => {
        api.qa('[data-shape]').forEach(b => b.addEventListener('click', () => {
          if (b.dataset.shape !== target[0]) { api.feedback(`Das ist kein ${target[1]}.`, 'err'); api.fail(`Das ${target[1]} ist das andere.`); return; }
          api.qa('[data-shape]').forEach(x => { x.disabled = true; });
          b.classList.add('is-picked');
          const quick = api.localFails === 0;
          api.seq(quick
            ? [{ t: 'Korrekt.', k: 'ok' }, { t: 'Verdächtig schnell.', k: 'err' }, { p: 1, label: 'Sicherheitsprüfung' }]
            : [{ t: 'Korrekt. Beim zweiten Versuch.', k: 'ok' }, { t: 'Lernkurve dokumentiert.', k: 'muted' }],
          () => api.continueBtn());
        }));
      });
    }
  });

  register({
    id: 'human', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Menschlichkeitsnachweis',
    run(api) {
      choiceModule(api, {
        title: 'Menschlichkeitsnachweis',
        question: 'Beweise, dass du ein Mensch bist.',
        options: [
          { label: 'Ich bin ein Mensch', reply: 'Genau das würde ein Bot auch sagen. Trotzdem akzeptiert.' },
          { label: 'Vielleicht', reply: 'Ehrliche Antwort. Menschlichkeit wahrscheinlich.' },
          { label: 'Kommt auf den Wochentag an', reply: `Heute ist ${new Date().toLocaleDateString('de-DE', { weekday: 'long' })}. Akzeptiert.` },
          { label: 'Ich verweigere die Aussage', reply: 'Aussageverweigerung zur Kenntnis genommen. Sehr menschlich.' }
        ]
      });
    }
  });

  register({
    id: 'moneyInterest', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Selbsteinschätzung',
    run(api) {
      const steps = [{ t: 'Finanzielles Interesse erkannt.', k: 'err' }, { t: 'Vermerk in deiner Akte gesetzt.', k: 'muted' }];
      choiceModule(api, {
        title: 'Selbsteinschätzung',
        question: 'Welche dieser Aussagen beschreibt dich am besten?',
        options: [
          { label: 'Ich möchte mein Geld', steps },
          { label: 'Ich möchte wirklich mein Geld', steps },
          { label: 'Ich bin nur wegen des Geldes hier', steps },
          { label: 'Was für Geld?', steps }
        ]
      });
    }
  });

  register({
    id: 'weiter4', type: 'captcha', difficulty: 1, maxCount: 1, title: 'Fortfahren',
    run(api) {
      const working = Math.floor(Math.random() * 4);
      api.render(api.screen({
        title: 'Fortfahren',
        lead: 'Klicke auf WEITER.',
        body: `<div class="bkb-choices is-grid">${[0, 1, 2, 3].map(i => `<button type="button" class="bkb-choice bkb-weiter" data-i="${i}">WEITER</button>`).join('')}</div>`
      }), () => {
        api.qa('[data-i]').forEach(b => b.addEventListener('click', () => {
          if (Number(b.dataset.i) !== working) {
            b.disabled = true;
            api.feedback(pick(['Dieser WEITER-Button ist nur zur Dekoration.', 'Dieser WEITER-Button ist im Urlaub.', 'Dieser WEITER-Button ist nicht für dich zuständig.']), 'err');
            api.fail();
            return;
          }
          api.qa('[data-i]').forEach(x => { x.disabled = true; });
          b.classList.add('is-picked');
          api.feedback('Weiter.', 'ok');
          api.after(700, () => api.done());
        }));
      });
    }
  });

  register({
    id: 'trustworthy', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Vertrauensprüfung',
    run(api) {
      choiceModule(api, {
        title: 'Vertrauensprüfung',
        question: 'Welcher Button sieht vertrauenswürdig aus?',
        options: [0, 1, 2].map(() => ({ label: 'Vertrauenswürdig', reply: 'Gute Wahl. Die anderen waren identisch, aber trotzdem gute Wahl.' }))
      });
    }
  });

  register({
    id: 'confirmConfirm', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Bestätigung',
    run(api) {
      choiceModule(api, {
        title: 'Bestätigung',
        question: 'Bitte bestätige, dass du diese Bestätigung bestätigen möchtest.',
        options: [
          { label: 'JA', reply: 'Bestätigung bestätigt. Formal ausreichend.' },
          { label: 'JA, ABER OFFIZIELL', reply: 'Offizielle Bestätigung bestätigt. Danke für die Mühe.' }
        ]
      });
    }
  });

  register({
    id: 'doubleNegative', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Fortsetzungswunsch',
    run(api) {
      choiceModule(api, {
        title: 'Fortsetzungswunsch',
        question: 'Möchtest du nicht nicht fortfahren?',
        options: [
          { label: 'Ja', reply: 'Antwort erfasst. Bedeutung unklar.' },
          { label: 'Nein', reply: 'Antwort erfasst. Bedeutung ebenfalls unklar.' }
        ]
      });
    }
  });

  register({
    id: 'trolley', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Moralische Prüfung',
    run(api) {
      api.render(api.screen({
        title: 'Moralische Prüfung',
        body: '<p class="investor-security-question">Ein Zug fährt auf fünf Menschen zu.</p><p class="bkb-line is-muted">Hat nichts mit deiner Auszahlung zu tun.</p>'
      }), () => api.continueBtn('WEITER'));
    }
  });

  register({
    id: 'leastSuspicious', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Verdachtsanalyse',
    run(api) {
      const items = ['Löffel', 'Drucker', 'Banane', 'Steuerberater', 'Lampe'];
      choiceModule(api, {
        title: 'Verdachtsanalyse',
        question: 'Welcher dieser Gegenstände ist am wenigsten verdächtig?',
        grid: true,
        options: items.map(label => ({
          label,
          steps: label === 'Steuerberater'
            ? [{ t: 'Interessante Entscheidung.', k: 'official' }, { t: 'Der Steuerberater wurde informiert.', k: 'muted' }]
            : [{ t: 'Interessante Entscheidung.', k: 'official' }]
        }))
      });
    }
  });

  register({
    id: 'bureauCheckboxes', type: 'bureaucracy', countsAsCaptcha: true, difficulty: 1, maxCount: 1, title: 'Bestätigungen',
    run(api) {
      const items = [
        'Ich bestätige, dass ich bestätige.',
        'Ich bestätige die vorherige Bestätigung.',
        'Ich bestätige, dass ich weiß, was ich bestätigt habe.',
        'Ich bestätige, dass BKInvestment möglicherweise nicht weiß, was ich bestätigt habe.'
      ];
      api.render(api.screen({
        title: 'Bürokratische Bestätigungen',
        body: `<div class="investor-security-checklist">${items.map((l, i) => `
          <label class="investor-security-check-row"><input type="checkbox" class="investor-security-checkbox" data-i="${i}"><span>${esc(l)}</span></label>`).join('')}</div>`
      }), () => {
        const boxes = api.qa('input[type=checkbox]');
        const box = api.actions([{ label: 'BESTÄTIGUNGEN BESTÄTIGEN', onClick: btn => {
          if (!boxes.every(b => b.checked)) { api.feedback('Es fehlen noch Bestätigungen.', 'err'); return; }
          btn.disabled = true;
          api.feedback('Alle Bestätigungen bestätigt.', 'ok');
          api.after(800, () => api.done());
        } }]);
        if (box) box.querySelector('button').disabled = false;
      });
    }
  });

  register({
    id: 'reaction', type: 'miniGame', difficulty: 1, maxCount: 1, title: 'Reaktionstest',
    run(api) {
      api.render(api.screen({
        title: 'Reaktionstest',
        lead: 'Klicke, sobald das Feld grün wird.',
        body: '<button type="button" class="bkb-reaction is-idle" data-pad>Bereit? Hier klicken zum Starten.</button>'
      }), () => {
        const pad = api.q('[data-pad]');
        let phase = 'idle';
        let greenAt = 0;
        let slowOnce = false;
        let reds = 0;
        let gen = 0; // verhindert, dass nach einem Neustart eine alte Rot-Kette weiterlaeuft
        const goRed = () => {
          phase = 'red';
          reds = 0;
          const my = ++gen;
          pad.className = 'bkb-reaction is-red';
          pad.textContent = 'Rot.';
          const step = () => {
            if (phase !== 'red' || my !== gen) return;
            reds++;
            if (reds < 3) { pad.textContent = 'Rot.'; api.after(650 + Math.random() * 550, step); return; }
            phase = 'green';
            greenAt = performance.now();
            pad.className = 'bkb-reaction is-green';
            pad.textContent = 'GRÜN!';
          };
          api.after(700 + Math.random() * 500, step);
        };
        pad.addEventListener('click', () => {
          if (phase === 'idle') { goRed(); return; }
          if (phase === 'red') {
            api.feedback('Das war rot. Bitte warte auf Grün.', 'err');
            api.fail('Erst klicken, wenn es grün ist.');
            goRed();
            return;
          }
          if (phase !== 'green') return;
          phase = 'done';
          const ms = Math.round(performance.now() - greenAt);
          pad.className = 'bkb-reaction is-done';
          pad.textContent = `${ms} ms`;
          if (ms < 260) {
            api.feedback('Zu schnell. Wird trotzdem gewertet.', 'err');
            api.after(1000, () => api.continueBtn());
          } else if (ms > 700 && !slowOnce) {
            slowOnce = true;
            api.feedback('Zu langsam. Bitte erneut.', 'err');
            api.after(1100, () => { phase = 'idle'; pad.className = 'bkb-reaction is-idle'; pad.textContent = 'Erneut starten'; api.feedback('', null); });
          } else {
            api.feedback(ms > 700 ? 'Zu langsam. Aus Kulanz akzeptiert.' : 'Akzeptabel.', 'ok');
            api.after(900, () => api.continueBtn());
          }
        });
      });
    }
  });

  register({
    id: 'stillMouse', type: 'miniGame', difficulty: 1, maxCount: 1, title: 'Stillhalteprüfung',
    run(api) {
      api.render(api.screen({
        title: 'Stillhalteprüfung',
        lead: isTouch ? 'Berühre den Bildschirm 5 Sekunden lang NICHT.' : 'Bewege deine Maus 5 Sekunden lang NICHT.',
        body: '<div class="bkb-countdown" data-count>5</div>'
      }), () => {
        const countEl = api.q('[data-count]');
        let left = 5;
        let finished = false;
        const reset = () => {
          if (finished) return;
          if (left < 5) {
            api.feedback('Bewegung erkannt. Countdown neu gestartet.', 'err');
            api.fail('Hände kurz in den Schoß legen.');
          }
          left = 5;
          countEl.textContent = '5';
        };
        ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(evt => api.on(document, evt, reset, { passive: true }));
        api.every(1000, () => {
          if (finished) return;
          left--;
          countEl.textContent = String(Math.max(0, left));
          if (left <= 0) {
            finished = true;
            api.feedback('Verdächtig ruhig.', 'ok');
            api.after(900, () => api.continueBtn());
          }
        });
      });
    }
  });

  register({
    id: 'holdButton', type: 'miniGame', difficulty: 1, maxCount: 1, title: 'Haltetest',
    run(api) {
      api.render(api.screen({
        title: 'Haltetest',
        lead: 'Halte diesen Button 5 Sekunden gedrückt.',
        body: `<div class="investor-security-progress2-track"><div class="investor-security-progress2-fill" data-fill></div></div>
               <button type="button" class="btn-ja investor-security-hold-btn" data-hold>Gedrückt halten</button>`
      }), () => {
        const fill = api.q('[data-fill]');
        const btn = api.q('[data-hold]');
        let held = 0;
        let down = false;
        let complete = false;
        api.every(100, () => {
          if (complete) return;
          if (down) held += 100; else if (held > 0) held = Math.max(0, held - 250);
          fill.style.width = Math.min(100, (held / 5000) * 100) + '%';
          btn.textContent = held >= 4800 && held < 5000 ? 'Fast.' : (down ? 'Halten…' : 'Gedrückt halten');
          if (held >= 5000) {
            complete = true;
            btn.textContent = 'Geschafft';
            btn.disabled = true;
            api.feedback('Haltedauer bestätigt.', 'ok');
            api.after(800, () => api.continueBtn());
          }
        });
        btn.addEventListener('pointerdown', e => { e.preventDefault(); down = true; try { btn.setPointerCapture(e.pointerId); } catch (err) { /* unkritisch */ } });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt => btn.addEventListener(evt, () => { down = false; }));
      });
    }
  });

  register({
    id: 'slider50', type: 'miniGame', difficulty: 2, maxCount: 1, title: 'Präzisionsprüfung',
    run(api) {
      api.render(api.screen({
        title: 'Präzisionsprüfung',
        lead: 'Stelle den Regler auf exakt 50 %.',
        body: `<p class="investor-security-trust-value" data-val>17 %</p>
               <input type="range" min="0" max="100" step="1" value="17" class="investor-security-slider" data-slider>`
      }), () => {
        const slider = api.q('[data-slider]');
        const val = api.q('[data-val]');
        let firstHit = false;
        slider.addEventListener('input', () => { val.textContent = slider.value + ' %'; });
        api.actions([{ label: 'Bestätigen', onClick: btn => {
          const v = Number(slider.value);
          const tolerance = api.localFails >= 3 ? 3 : 0;
          if (Math.abs(v - 50) > tolerance) {
            api.feedback(`Gemessener Wert: ${v} %. Erforderlich: exakt 50 %.`, 'err');
            api.fail('Die Finanzabteilung akzeptiert jetzt ±3 %.');
            return;
          }
          if (!firstHit) {
            firstHit = true;
            api.feedback('Gemessener Wert: 49,9998 %. Bitte erneut einstellen.', 'err');
            slider.value = String(pick([12, 31, 77, 88]));
            val.textContent = slider.value + ' %';
            return;
          }
          btn.disabled = true;
          api.feedback('Exakt 50 %. Präzise.', 'ok');
          api.after(800, () => api.done());
        } }]);
      });
    }
  });

  register({
    id: 'math', type: 'captcha', difficulty: 1, maxCount: 1, title: 'Rechenprüfung',
    run(api) {
      api.render(api.screen({
        title: 'Rechenprüfung',
        body: `<p class="investor-security-question">2 + 2 = ?</p>
               <input type="text" inputmode="numeric" class="bkb-input" data-answer placeholder="Ergebnis" autocomplete="off">`
      }), () => {
        const input = api.q('[data-answer]');
        api.actions([{ label: 'Prüfen', onClick: () => {
          if (input.value.trim() !== '4') { api.feedback('Nicht korrekt.', 'err'); api.fail('Es ist 4.'); return; }
          input.disabled = true;
          api.feedback('Korrekt.', 'ok');
          api.after(700, () => {
            api.line('Zusatzfrage:', 'official');
            api.line('Wenn eine Auszahlung 30 Captchas benötigt und du 5 weitere bekommst, warum bist du noch hier?', 'question');
            const ta = document.createElement('textarea');
            ta.className = 'bkb-input bkb-textarea';
            ta.rows = 2;
            ta.placeholder = 'Deine Antwort';
            api.q('.bkb-seq').appendChild(ta);
            api.actions([{ label: 'Absenden', onClick: b => { b.disabled = true; ta.disabled = true; api.feedback('Antwort wurde zur Kenntnis genommen.', 'ok'); api.after(900, () => api.done()); } }]);
          });
        } }]);
      });
    }
  });

  register({
    id: 'estimate', type: 'captcha', difficulty: 0, maxCount: 1, title: 'Schätzfrage',
    run(api) {
      api.render(api.screen({
        title: 'Schätzfrage',
        lead: 'Wie viele Captchas glaubst du noch lösen zu müssen?',
        body: `<p class="investor-security-trust-value" data-val>10</p>
               <input type="range" min="0" max="100" value="10" class="investor-security-slider" data-slider>`
      }), () => {
        const slider = api.q('[data-slider]');
        const val = api.q('[data-val]');
        slider.addEventListener('input', () => { val.textContent = slider.value; });
        api.actions([{ label: 'Schätzung abgeben', onClick: btn => {
          btn.disabled = true;
          slider.disabled = true;
          const v = Number(slider.value);
          api.feedback(v < state.remaining ? 'Optimistisch.' : 'Realistisch. Verdächtig realistisch.', 'ok');
          api.after(1000, () => api.done());
        } }]);
      });
    }
  });

  register({
    id: 'hugeContinue', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Fortfahren',
    run(api) {
      api.render(api.screen({ title: '', body: '<button type="button" class="bkb-huge" data-go>WEITER</button>' }), () => {
        api.q('[data-go]').addEventListener('click', e => {
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = 'Danke.';
          api.after(700, () => api.done());
        });
      });
    }
  });

  register({
    id: 'tinyButton', type: 'captcha', difficulty: 2, maxCount: 1, title: 'Fortfahren',
    run(api) {
      api.render(api.screen({
        title: 'Fortfahren',
        lead: 'Bitte fortfahren.',
        body: '<div class="bkb-tiny-area"><button type="button" class="bkb-tiny" data-tiny>weiter</button></div>'
      }), () => {
        const tiny = api.q('[data-tiny]');
        tiny.addEventListener('click', () => { tiny.disabled = true; api.feedback('Danke.', 'ok'); api.after(600, () => api.done()); });
        api.after(9000, () => { tiny.classList.add('is-grown'); api.line('Buttongröße aus Kulanz angepasst.', 'muted'); });
      });
    }
  });

  register({
    id: 'waitButton', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Geduldsprüfung',
    run(api) {
      api.render(api.screen({ title: 'Geduldsprüfung', lead: 'Dieser Button wird gleich verfügbar.' }), () => {
        let left = 5;
        const box = api.actions([{ label: `Verfügbar in ${left}`, onClick: () => { api.feedback('Danke für deine Geduld.', 'ok'); api.after(700, () => api.done()); } }]);
        const btn = box && box.querySelector('button');
        if (!btn) return;
        btn.disabled = true;
        api.every(1000, () => {
          left--;
          if (left > 0) { btn.textContent = `Verfügbar in ${left}`; return; }
          if (btn.disabled) { btn.disabled = false; btn.textContent = 'Jetzt'; }
        });
      });
    }
  });

  register({
    id: 'captchaText', type: 'captcha', difficulty: 1, maxCount: 1, title: 'Klassisches Captcha',
    run(api) {
      const word = pick(['AUSZAHLUNG', 'GEDULD', 'FORMULAR', 'BEARBEITUNG']);
      const letters = word.split('').map(ch => {
        const rot = Math.round(Math.random() * 30 - 15);
        const y = Math.round(Math.random() * 8 - 4);
        return `<span style="transform:rotate(${rot}deg) translateY(${y}px)">${ch}</span>`;
      }).join('');
      api.render(api.screen({
        title: 'Klassisches Captcha',
        lead: 'Gib den angezeigten Text ein.',
        body: `<div class="bkb-captcha-text" aria-label="${word}">${letters}</div>
               <input type="text" class="bkb-input" data-answer placeholder="Text eingeben" autocomplete="off" autocapitalize="characters">`
      }), () => {
        const input = api.q('[data-answer]');
        api.actions([{ label: 'Prüfen', onClick: b => {
          if (input.value.trim().toUpperCase() !== word) { api.feedback('Text stimmt nicht überein.', 'err'); api.fail(`Der Text lautet ${word}.`); return; }
          b.disabled = true;
          input.disabled = true;
          api.feedback('Korrekt. Leider.', 'ok');
          api.after(800, () => api.done());
        } }]);
      });
    }
  });

  register({
    id: 'caseNumber', type: 'captcha', difficulty: 0, maxCount: 1, title: 'Vorgangsnummer',
    run(api) {
      const digits = state.caseId.slice(-4);
      api.render(api.screen({
        title: 'Vorgangsnummer',
        lead: `Bitte gib die letzten 4 Ziffern deiner Vorgangsnummer ein (${state.caseId}).`,
        body: '<input type="text" inputmode="numeric" maxlength="4" class="bkb-input" data-answer placeholder="____" autocomplete="off">'
      }), () => {
        const input = api.q('[data-answer]');
        api.actions([{ label: 'Bestätigen', onClick: b => {
          if (input.value.trim() !== digits) { api.feedback('Vorgangsnummer stimmt nicht.', 'err'); api.fail(`Die Ziffern lauten ${digits}.`); return; }
          b.disabled = true;
          api.seq([{ t: 'Vorgangsnummer korrekt.', k: 'ok' }, { t: 'Wir hatten sie dir ja gesagt.', k: 'muted' }], () => api.continueBtn());
        } }]);
      });
    }
  });

  register({
    id: 'uncheck', type: 'captcha', difficulty: 0, maxCount: 1, title: 'Haken entfernen',
    run(api) {
      api.render(api.screen({
        title: 'Haken entfernen',
        lead: 'Bitte entferne den Haken.',
        body: '<label class="investor-security-check-row bkb-center-row"><input type="checkbox" class="investor-security-checkbox" data-box checked><span>Ich möchte keine Auszahlung.</span></label>'
      }), () => {
        const box = api.q('[data-box]');
        box.addEventListener('change', () => {
          if (box.checked) return;
          box.disabled = true;
          api.seq([{ t: 'Danke.', k: 'ok' }, { t: 'Wir haben deine ursprüngliche Auswahl trotzdem notiert.', k: 'muted' }], () => api.continueBtn());
        });
      });
    }
  });

  register({
    id: 'personality', type: 'captcha', difficulty: 0, maxCount: 1, penalty: 2, title: 'Persönlichkeitseinschätzung',
    run(api) {
      api.render(api.screen({
        title: 'Persönlichkeitseinschätzung',
        lead: 'Vor der Auszahlung benötigen wir eine kurze Einschätzung.',
        body: `<p class="investor-security-question" data-q>Was würdest du mit 1 Million Euro machen?</p>
               <div class="bkb-choices is-grid" data-opts>
                 ${['sparen', 'ausgeben', 'investieren', 'niemandem erzählen'].map(o => `<button type="button" class="bkb-choice">${esc(o)}</button>`).join('')}
               </div>`
      }), () => {
        const q = api.q('[data-q]');
        const opts = api.q('[data-opts]');
        opts.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
          opts.querySelectorAll('button').forEach(x => { x.disabled = true; });
          api.feedback('Interessant.', 'ok');
          api.after(1100, () => {
            api.feedback('', null);
            q.textContent = 'Würdest du BKInvestment weiterempfehlen?';
            opts.innerHTML = '<button type="button" class="bkb-choice" data-a="ja">JA</button><button type="button" class="bkb-choice" data-a="nein">NEIN</button>';
            opts.querySelectorAll('button').forEach(x => x.addEventListener('click', () => {
              opts.querySelectorAll('button').forEach(y => { y.disabled = true; });
              if (x.dataset.a === 'ja') api.seq([{ t: 'Antwort wirkt erzwungen.', k: 'err' }, { t: 'Trotzdem gespeichert.', k: 'muted' }], () => api.continueBtn());
              else api.seq([{ t: 'Kundenbindung gefährdet.', k: 'err' }, { p: 2, label: 'Prüfungen' }], () => api.continueBtn());
            }));
          });
        }));
      });
    }
  });

  register({
    id: 'passportPhoto', type: 'captcha', difficulty: 1, maxCount: 1, title: 'Passbild',
    run(api) {
      // Alle vier Varianten zeigen dasselbe echte Foto (assets/prank/passbild.png,
      // Nutzerwunsch 03.10.2026) - nur unterschiedlich "aufbereitet".
      const photo = 'assets/prank/passbild.png?v=20261003-1';
      const avatars = [
        ['is-normal', 'Variante A', ''],
        ['is-upside', 'Variante B', ''],
        ['is-hat', 'Variante C', '<i class="bkb-photo-hat">🎩</i>'],
        ['is-vintage', 'Variante D (1987)', '']
      ];
      api.render(api.screen({
        title: 'Passbild',
        lead: 'Bitte wähle dein offizielles Auszahlungsfoto.',
        body: `<div class="bkb-avatars">${avatars.map(([cls, n, extra], i) => `
          <button type="button" class="bkb-avatar" data-i="${i}" aria-label="${n}">
            <span class="bkb-photo ${cls}"><img src="${photo}" alt="" draggable="false">${extra}</span>
            <small>${n}</small>
          </button>`).join('')}</div>`
      }), () => {
        let tries = 0;
        api.qa('[data-i]').forEach(b => b.addEventListener('click', () => {
          tries++;
          b.disabled = true;
          if (tries === 1) {
            api.feedback('Foto entspricht nicht den Anforderungen.', 'err');
            api.line('Anforderungen: neutraler Gesichtsausdruck · keine Kopfbedeckung · nicht zu menschlich', 'muted');
            return;
          }
          api.qa('[data-i]').forEach(x => { x.disabled = true; });
          b.classList.add('is-picked');
          api.seq([{ t: 'Foto akzeptiert.', k: 'ok' }, { t: 'Ähnlichkeit mit dir: 12 %.', k: 'muted' }], () => api.continueBtn());
        }));
      });
    }
  });

  register({
    id: 'agb', type: 'bureaucracy', countsAsCaptcha: true, difficulty: 1, maxCount: 1, title: 'Neue Auszahlungs-AGB',
    run(api) {
      const paras = [
        '§ 1 Auszahlungen erfolgen grundsätzlich. Ausnahmen bilden alle Fälle.',
        '§ 2 Captchas sind Bestandteil der Auszahlung und nicht verhandelbar.',
        '§ 3 Die Finanzabteilung ist berechtigt, die Finanzabteilung jederzeit umzubenennen.',
        '§ 4 Mit dem Lesen dieses Paragraphen stimmst du dem Lesen dieses Paragraphen zu.',
        '§ 5 Wartezeiten gelten als Serviceleistung.',
        '§ 6 Sollte eine Bestimmung unwirksam sein, wird eine neue Bestimmung erfunden.',
        '§ 7 Yaksha hat das letzte Wort. Kora hat das allerletzte Wort.',
        '§ 8 Diese AGB gelten auch rückwirkend für Dinge, die noch nicht passiert sind.'
      ];
      api.render(api.screen({
        title: 'Neue Auszahlungs-AGB',
        body: `<div class="bkb-agb">${paras.map(p => `<p>${esc(p)}</p>`).join('')}</div>
               <label class="investor-security-check-row bkb-small-row"><input type="checkbox" class="investor-security-checkbox" data-read><span>Ich habe alles gelesen.</span></label>
               <label class="investor-security-check-row bkb-small-row" data-really-row hidden><input type="checkbox" class="investor-security-checkbox" data-really><span>Ich habe wirklich alles gelesen.</span></label>`
      }), () => {
        const read = api.q('[data-read]');
        const reallyRow = api.q('[data-really-row]');
        const really = api.q('[data-really]');
        read.addEventListener('change', () => {
          if (!read.checked) return;
          read.disabled = true;
          api.feedback('Das ging schnell. Bitte bestätige, dass du wirklich alles gelesen hast.', 'err');
          reallyRow.hidden = false;
        });
        api.actions([{ label: 'AKZEPTIEREN', onClick: b => {
          if (!read.checked || !really.checked) { api.feedback('Bitte bestätige zuerst, dass du alles gelesen hast.', 'err'); return; }
          b.disabled = true;
          api.feedback('AGB akzeptiert. Version 14B ist ab sofort gültig.', 'ok');
          api.after(900, () => api.done());
        } }]);
      });
    }
  });

  register({
    id: 'datenschutz', type: 'bureaucracy', countsAsCaptcha: true, difficulty: 1, maxCount: 1, penalty: 1, title: 'Datenschutz',
    run(api) {
      api.render(api.screen({
        title: 'Datenschutzeinstellungen aktualisiert',
        lead: 'Bitte triff eine Auswahl.',
        body: '<div class="bkb-toggles" data-toggles hidden></div>'
      }), () => {
        const toggles = api.q('[data-toggles]');
        const names = [
          'Captcha-Cookies', 'Bürokratie-Tracking', 'Formular-Personalisierung', 'Wartezeit-Analyse', 'Drucker-Telemetrie',
          'Faxgeräte-Kompatibilität', 'Stempel-Optimierung', 'Sachbearbeiter-Präferenzen', 'Kaffeepausen-Synchronisation',
          'Warteschlangen-Statistik', 'Premium-Erinnerungen', 'Kevin-Benachrichtigungen', 'Unterschrift-Archivierung',
          'Risikoscore-Verlauf', 'Mondzeit-Berechnung', 'Captcha-Inflationsschutz', 'Treuepunkte (ohne Funktion)',
          'Ladebalken-Ästhetik', 'Bestätigungs-Bestätigung', 'Formularfeld-Gedächtnis', 'Papierstau-Prävention',
          'Tonerstand-Freigabe', 'Auszahlungs-Vorfreude', 'Interne Gerüchte', 'Yakshas Texturwünsche',
          'Scusys Creator+-Status', 'Phil-Erkennung', 'Liber-Ortung', 'Obsi-Faxempfang', 'Bagons Terminkalender',
          'Kowalskis Urlaubsplanung', 'Lukas’ Kaffeekonsum', 'Michas Ticketsystem', 'Ronjas Warteschleife',
          'Koras Akteneinsicht', 'Notwendige Unnötigkeiten', 'Diese Einstellung'
        ];
        api.actions([
          { label: 'ALLE AKZEPTIEREN', onClick: () => decide('all') },
          { label: 'NUR NOTWENDIGE', cls: 'btn-nein', onClick: () => decide('min') },
          { label: 'EINSTELLUNGEN', cls: 'btn-nein', onClick: () => decide('settings') }
        ]);
        function decide(kind) {
          api.actions([]);
          if (kind === 'all') api.seq([{ t: 'Zu vertrauensselig.', k: 'err' }, { p: 1 }], () => api.continueBtn());
          else if (kind === 'min') api.seq([{ t: 'Misstrauisches Verhalten erkannt.', k: 'err' }, { p: 1 }], () => api.continueBtn());
          else {
            toggles.hidden = false;
            toggles.innerHTML = names.map((n, i) => `<label class="bkb-toggle"><input type="checkbox" ${i % 3 === 0 ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('');
            api.feedback(`${names.length} Einstellungen verfügbar.`, null);
            api.actions([{ label: 'Auswahl speichern', onClick: b => {
              b.disabled = true;
              api.seq([{ t: 'Einstellungen gespeichert.', k: 'ok' }, { t: 'Keine dieser Einstellungen hat eine Funktion.', k: 'muted' }], () => api.continueBtn());
            } }]);
          }
        }
      });
    }
  });

  register({
    id: 'colorPick', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Farbprüfung',
    run(api) {
      api.render(api.screen({
        title: 'Farbprüfung',
        lead: 'Wähle die Farbe, die am meisten nach Geld aussieht.',
        body: `<div class="bkb-colors">${['#22c55e', '#eab308', '#3b82f6', '#9ca3af'].map(c => `<button type="button" class="bkb-color" style="background:${c}" data-c="${c}" aria-label="Farbe"></button>`).join('')}</div>`
      }), () => {
        api.qa('[data-c]').forEach(b => b.addEventListener('click', () => {
          api.qa('[data-c]').forEach(x => { x.disabled = true; });
          b.classList.add('is-picked');
          api.seq([{ t: b.dataset.c === '#eab308' ? 'Goldgier erkannt.' : 'Ungewöhnliche Geldvorstellung erkannt.', k: 'official' }, { t: 'Vermerkt.', k: 'muted' }], () => api.continueBtn());
        }));
      });
    }
  });

  /* ------------------------------------------------------------------
     NEUE CAPTCHAS (03.10.2026) - Nutzer-Meldung "viele Captchas waren
     doppelt, sogar dreifach": jedes Modul laeuft hoechstens einmal pro
     Durchlauf, dafuer deutlich mehr verschiedene Aufgaben.
     ------------------------------------------------------------------ */
  register({
    id: 'oddOneOut', type: 'captcha', difficulty: 0, easy: true, title: 'Logikprüfung',
    run(api) {
      choiceModule(api, {
        title: 'Logikprüfung',
        question: 'Welches Wort gehört nicht dazu?',
        grid: true,
        options: [0, 1, 2, 3].map(() => ({ label: 'Auszahlung', steps: [{ t: 'Korrekt.', k: 'ok' }, { t: 'Keines davon gehört dazu.', k: 'muted' }] }))
      });
    }
  });

  register({
    id: 'sortDocs', type: 'captcha', difficulty: 1, title: 'Aktensortierung',
    run(api) {
      const order = ['14A', '14B', '14B-2', '14C'];
      api.render(api.screen({
        title: 'Aktensortierung',
        lead: 'Sortiere die Formulare aufsteigend (klicke sie der Reihe nach an).',
        body: `<div class="bkb-choices is-grid">${shuffle(order).map(f => `<button type="button" class="bkb-choice" data-f="${f}">Formular ${f}</button>`).join('')}</div>`
      }), () => {
        let next = 0;
        const btns = api.qa('[data-f]');
        btns.forEach(b => b.addEventListener('click', () => {
          if (b.dataset.f !== order[next]) {
            next = 0;
            btns.forEach(x => { x.disabled = false; x.classList.remove('is-picked'); });
            api.feedback('Falsche Reihenfolge. Sortierung zurückgesetzt.', 'err');
            api.fail('Reihenfolge: 14A → 14B → 14B-2 → 14C.');
            return;
          }
          b.disabled = true;
          b.classList.add('is-picked');
          next++;
          if (next < order.length) { api.feedback(`${next} von ${order.length} einsortiert.`, null); return; }
          api.feedback('', null);
          api.seq([{ t: 'Sortierung korrekt.', k: 'ok' }, { t: 'Die Formulare wurden anschließend zufällig neu gemischt.', k: 'muted' }], () => api.continueBtn());
        }));
      });
    }
  });

  register({
    id: 'countBananas', type: 'captcha', difficulty: 0, title: 'Zählprüfung',
    run(api) {
      choiceModule(api, {
        title: 'Zählprüfung',
        lead: 'Wie viele Bananen siehst du?',
        pre: '<p class="bkb-emoji-row">🍌 🍌 🍌</p>',
        grid: true,
        hint: 'Es sind drei.',
        options: [
          { label: '2', retry: 'Nochmal zählen.' },
          { label: '3', steps: [{ t: 'Korrekt.', k: 'ok' }, { t: 'Eine davon war ein Steuerberater.', k: 'muted' }] },
          { label: '4', retry: 'Nochmal zählen.' },
          { label: 'Ich sehe keine Bananen', reply: 'Ehrliche Antwort. Augenprüfung wird empfohlen. Akzeptiert.' }
        ]
      });
    }
  });

  register({
    id: 'mirrorText', type: 'captcha', difficulty: 1, title: 'Spiegelschrift',
    run(api) {
      const word = pick(['GELD', 'AKTE', 'STEMPEL', 'KAFFEE']);
      api.render(api.screen({
        title: 'Spiegelschrift',
        lead: 'Lies den gespiegelten Text und tippe ihn ab.',
        body: `<div class="bkb-mirror" aria-label="${word}">${word}</div>
               <input type="text" class="bkb-input" data-answer placeholder="Text eingeben" autocomplete="off" autocapitalize="characters">`
      }), () => {
        const input = api.q('[data-answer]');
        api.actions([{ label: 'Prüfen', onClick: b => {
          if (input.value.trim().toUpperCase() !== word) { api.feedback('Text stimmt nicht überein.', 'err'); api.fail(`Der Text lautet ${word}.`); return; }
          b.disabled = true;
          input.disabled = true;
          api.feedback('Korrekt. Du kannst rückwärts denken. Vermerkt.', 'ok');
          api.after(900, () => api.done());
        } }]);
      });
    }
  });

  register({
    id: 'dontClick', type: 'captcha', difficulty: 0, title: 'Zurückhaltungsprüfung',
    run(api) {
      api.render(api.screen({ title: 'Zurückhaltungsprüfung', lead: 'Klicke NICHT auf den folgenden Button.' }), () => {
        let resolved = false;
        const finish = (clicked) => {
          if (resolved) return;
          resolved = true;
          api.actions([]);
          api.seq(clicked
            ? [{ t: 'Du hast geklickt.', k: 'err' }, { t: 'Das war zu erwarten. Vermerkt.', k: 'muted' }]
            : [{ t: 'Danke für deine Zurückhaltung.', k: 'ok' }],
          () => api.continueBtn());
        };
        api.actions([{ label: 'Nicht klicken', cls: 'btn-nein', onClick: () => finish(true) }]);
        api.after(4500, () => finish(false));
      });
    }
  });

  register({
    id: 'coinFlip', type: 'captcha', difficulty: 0, easy: true, title: 'Münzwurf',
    run(api) {
      const steps = [{ t: 'Münze wird geworfen…', k: 'muted' }, { t: 'Ergebnis: Kante.', k: 'official', w: 1300 }, { t: 'Unentschieden zugunsten von BKInvestment.', k: 'muted' }];
      choiceModule(api, {
        title: 'Münzwurf',
        question: 'Wähle Kopf oder Zahl.',
        options: [{ label: 'Kopf', steps }, { label: 'Zahl', steps }]
      });
    }
  });

  register({
    id: 'emotionScale', type: 'captcha', difficulty: 0, easy: true, title: 'Stimmungserfassung',
    run(api) {
      const steps = [{ t: 'Stimmung erfasst.', k: 'ok' }, { t: 'Sie wird bei der Bearbeitung nicht berücksichtigt.', k: 'muted' }];
      choiceModule(api, {
        title: 'Stimmungserfassung',
        question: 'Wie fühlst du dich gerade?',
        grid: true,
        options: ['😀 Super', '🙂 Gut', '😐 Geht so', '🙁 Müde', '😡 Captcha-müde'].map(label => ({ label, steps }))
      });
    }
  });

  register({
    id: 'pickNumber', type: 'captcha', difficulty: 0, title: 'Zahlenwahl',
    run(api) {
      api.render(api.screen({
        title: 'Zahlenwahl',
        lead: 'Wähle eine Zahl zwischen 1 und 10.',
        body: `<div class="bkb-number-grid">${Array.from({ length: 10 }, (_, i) => `<button type="button" class="bkb-choice" data-n="${i + 1}">${i + 1}</button>`).join('')}</div>`
      }), () => {
        api.qa('[data-n]').forEach(b => b.addEventListener('click', () => {
          const n = Number(b.dataset.n);
          api.qa('[data-n]').forEach(x => { x.disabled = true; });
          b.classList.add('is-picked');
          api.seq([{ t: `Falsch. Die richtige Zahl war ${n === 10 ? 1 : n + 1}.`, k: 'err' }, { t: 'Trotzdem akzeptiert.', k: 'muted' }], () => api.continueBtn());
        }));
      });
    }
  });

  register({
    id: 'unlockSlider', type: 'miniGame', difficulty: 0, title: 'Entsperren',
    run(api) {
      api.render(api.screen({
        title: 'Entsperren',
        lead: 'Zum Entsperren ganz nach rechts schieben.',
        body: '<input type="range" min="0" max="100" value="0" class="investor-security-slider bkb-unlock" data-slider aria-label="Zum Entsperren schieben">'
      }), () => {
        const slider = api.q('[data-slider]');
        let unlocked = false;
        slider.addEventListener('input', () => {
          if (unlocked || Number(slider.value) < 100) return;
          unlocked = true;
          slider.disabled = true;
          api.seq([{ t: 'Entsperrt.', k: 'ok' }, { t: 'Es gab nichts zu entsperren.', k: 'muted' }], () => api.continueBtn());
        });
        slider.addEventListener('change', () => { if (!unlocked) { slider.value = '0'; api.feedback('Bitte ganz nach rechts schieben.', null); } });
      });
    }
  });

  register({
    id: 'typingSentence', type: 'captcha', difficulty: 1, title: 'Höflichkeitsprüfung',
    run(api) {
      const sentence = 'Ich möchte meine Auszahlung höflich.';
      const norm = s => s.toLowerCase().replace(/[.!]+$/, '').replace(/\s+/g, ' ').trim();
      api.render(api.screen({
        title: 'Höflichkeitsprüfung',
        lead: 'Bitte tippe den folgenden Satz exakt ab.',
        body: `<p class="investor-security-question">„${esc(sentence)}“</p>
               <input type="text" class="bkb-input" data-answer placeholder="Satz eingeben" autocomplete="off">`
      }), () => {
        const input = api.q('[data-answer]');
        api.actions([{ label: 'Absenden', onClick: b => {
          if (norm(input.value) !== norm(sentence)) { api.feedback('Nicht höflich genug.', 'err'); api.fail(`Exakt so: ${sentence}`); return; }
          b.disabled = true;
          input.disabled = true;
          api.seq([{ t: 'Höflichkeit bestätigt.', k: 'ok' }, { t: 'Höflichkeit beschleunigt die Bearbeitung nicht.', k: 'muted' }], () => api.continueBtn());
        } }]);
      });
    }
  });

  register({
    id: 'clickCounter', type: 'miniGame', difficulty: 1, title: 'Klickprüfung',
    run(api) {
      api.render(api.screen({ title: 'Klickprüfung', lead: 'Klicke genau 7 Mal auf den Button.' }), () => {
        let count = 0;
        let timer = null;
        let finished = false;
        const box = api.actions([{ label: 'Klick (0)', onClick: b => {
          if (finished) return;
          count++;
          b.textContent = `Klick (${count})`;
          clearTimeout(timer);
          timer = api.after(1200, () => {
            if (count === 7) {
              finished = true;
              b.disabled = true;
              api.seq([{ t: 'Sieben Klicks registriert.', k: 'ok' }, { t: 'Wir hatten acht erwartet. Akzeptiert.', k: 'muted' }], () => api.continueBtn());
            } else if (count > 7) {
              count = 0;
              b.textContent = 'Klick (0)';
              api.feedback('Zu viele Klicks. Zähler zurückgesetzt.', 'err');
              api.fail('Genau sieben, dann kurz warten.');
            }
          });
        } }]);
        if (box) box.querySelector('button').classList.add('bkb-wide-btn');
      });
    }
  });

  register({
    id: 'stroop', type: 'captcha', difficulty: 1, title: 'Farbprüfung',
    run(api) {
      const colors = [['Rot', '#ef4444'], ['Blau', '#3b82f6'], ['Grün', '#22c55e'], ['Gelb', '#eab308']];
      const word = pick(colors);
      const ink = pick(colors.filter(c => c !== word));
      choiceModule(api, {
        title: 'Farbprüfung',
        lead: 'Klicke auf die Farbe, in der das Wort GESCHRIEBEN ist.',
        pre: `<p class="bkb-stroop" style="color:${ink[1]}">${word[0].toUpperCase()}</p>`,
        grid: true,
        hint: 'Gemeint ist die Schriftfarbe, nicht das Wort.',
        options: colors.map(([name]) => name === ink[0]
          ? { label: name, steps: [{ t: 'Korrekt.', k: 'ok' }, { t: 'Farbsehen bestätigt. Geldsehen wird separat geprüft.', k: 'muted' }] }
          : { label: name, retry: 'Das ist nicht die Schriftfarbe.' })
      });
    }
  });

  register({
    id: 'todayDate', type: 'captcha', difficulty: 0, title: 'Datumsprüfung',
    run(api) {
      const fmt = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const now = new Date();
      const day = 24 * 60 * 60 * 1000;
      const today = fmt(now);
      choiceModule(api, {
        title: 'Datumsprüfung',
        question: 'Welches Datum haben wir heute?',
        grid: true,
        options: shuffle([
          { label: today, steps: [{ t: 'Korrekt.', k: 'ok' }, { t: 'Zeitreisende werden gesondert geprüft.', k: 'muted' }] },
          { label: fmt(new Date(now.getTime() - day)), reply: 'Das war gestern. Die Finanzabteilung lebt auch noch in gestern. Akzeptiert.' },
          { label: fmt(new Date(now.getTime() + day)), reply: 'Das ist morgen. Optimistisch. Akzeptiert.' },
          { label: '29.02.2032', reply: 'Das ist dein Termin bei Bagon. Antwort trotzdem gewertet.' }
        ])
      });
    }
  });

  register({
    id: 'teaOrCoffee', type: 'captcha', difficulty: 0, easy: true, title: 'Getränkewahl',
    run(api) {
      choiceModule(api, {
        title: 'Getränkewahl',
        question: 'Was darf die Finanzabteilung dir anbieten?',
        options: [
          { label: 'Kaffee', reply: 'Lukas bedankt sich. Er trinkt deinen.' },
          { label: 'Tee', reply: 'Tee ist in der Finanzabteilung nicht vorgesehen. Akzeptiert.' },
          { label: 'Wasser', reply: 'Wasser wurde wegen Papierstau-Gefahr abgelehnt. Akzeptiert.' }
        ]
      });
    }
  });

  register({
    id: 'pen', type: 'captcha', difficulty: 0, easy: true, title: 'Schreibgeräteprüfung',
    run(api) {
      choiceModule(api, {
        title: 'Schreibgeräteprüfung',
        question: 'Mit welchem Stift möchtest du die Auszahlung unterschreiben?',
        grid: true,
        options: [
          { label: 'Kugelschreiber', reply: 'Klassisch. Akzeptiert.' },
          { label: 'Füller', reply: 'Elegant. Bitte nicht klecksen.' },
          { label: 'Bleistift', reply: 'Nicht dokumentenecht. Ausnahmsweise akzeptiert.' },
          { label: 'Wachsmalstift', reply: 'Mutig. Akzeptiert.' }
        ]
      });
    }
  });

  register({
    id: 'weather', type: 'captcha', difficulty: 0, easy: true, title: 'Wetterabgleich',
    run(api) {
      const steps = [{ t: 'Wetter stimmt nicht mit unseren Daten überein.', k: 'err' }, { t: 'Laut Finanzabteilung ist es bei dir gerade Mittwoch. Akzeptiert.', k: 'muted' }];
      choiceModule(api, {
        title: 'Wetterabgleich',
        question: 'Welches Wetter herrscht gerade bei dir?',
        grid: true,
        options: ['☀️ Sonne', '🌧️ Regen', '❄️ Schnee', '🌩️ Gewitter'].map(label => ({ label, steps }))
      });
    }
  });

  register({
    id: 'reverseHuman', type: 'captcha', difficulty: 0, easy: true, title: 'Gegenprüfung',
    run(api) {
      const steps = [{ t: 'Überzeugend.', k: 'official' }, { t: 'Zu überzeugend. Menschlichkeit trotzdem bestätigt.', k: 'muted' }];
      choiceModule(api, {
        title: 'Gegenprüfung',
        question: 'Beweise, dass du KEIN Mensch bist.',
        grid: true,
        options: ['Beep boop', '01001010', 'Ich bin ein Toaster', 'Ich kann das nicht'].map(label => ({ label, steps }))
      });
    }
  });

  register({
    id: 'compliment', type: 'captcha', difficulty: 0, title: 'Kundenzufriedenheit',
    run(api) {
      api.render(api.screen({
        title: 'Kundenzufriedenheit',
        lead: 'Bitte mache der Finanzabteilung ein Kompliment.',
        body: '<textarea class="bkb-input bkb-textarea" rows="2" data-text placeholder="Dein Kompliment"></textarea>'
      }), () => {
        const ta = api.q('[data-text]');
        api.actions([{ label: 'Kompliment absenden', onClick: b => {
          if (!ta.value.trim()) { api.feedback('Kein Kompliment erkannt. Die Finanzabteilung ist traurig.', 'err'); return; }
          b.disabled = true;
          ta.disabled = true;
          api.seq([{ t: 'Kompliment erhalten.', k: 'ok' }, { t: 'Die Finanzabteilung ist gerührt. Es ändert nichts.', k: 'muted' }], () => api.continueBtn());
        } }]);
      });
    }
  });

  register({
    id: 'initials', type: 'captcha', difficulty: 0, title: 'Initialen',
    run(api) {
      api.render(api.screen({
        title: 'Initialen',
        lead: 'Bitte gib deine Initialen ein.',
        body: '<input type="text" maxlength="4" class="bkb-input bkb-short-input" data-answer placeholder="z. B. AB" autocomplete="off" autocapitalize="characters">'
      }), () => {
        const input = api.q('[data-answer]');
        let tries = 0;
        api.actions([{ label: 'Bestätigen', onClick: b => {
          if (!input.value.trim()) { api.feedback('Bitte Initialen eingeben.', 'err'); return; }
          tries++;
          if (tries === 1) { api.feedback(`Initialen passen nicht zu „${api.investor}“. Bitte erneut eingeben.`, 'err'); input.value = ''; return; }
          b.disabled = true;
          input.disabled = true;
          api.seq([{ t: 'Initialen akzeptiert.', k: 'ok' }, { t: 'Sie passen immer noch nicht.', k: 'muted' }], () => api.continueBtn());
        } }]);
      });
    }
  });

  register({
    id: 'country', type: 'captcha', difficulty: 0, title: 'Herkunft',
    run(api) {
      api.render(api.screen({
        title: 'Herkunft',
        lead: 'Bitte wähle dein Herkunftsland.',
        body: `<select class="bkb-input" data-c>
          <option value="">Bitte wählen</option>
          ${['Deutschland', 'Österreich', 'Schweiz', 'Oberwelt', 'Nether', 'Das Ende', 'Sonstiges'].map(c => `<option>${c}</option>`).join('')}
        </select>`
      }), () => {
        const sel = api.q('[data-c]');
        api.actions([{ label: 'Speichern', onClick: b => {
          if (!sel.value) { api.feedback('Bitte wähle ein Land.', 'err'); return; }
          b.disabled = true;
          sel.disabled = true;
          const reply = sel.value === 'Nether' ? 'Erhöhte Temperatur erkannt. Akzeptiert.'
            : sel.value === 'Das Ende' ? 'Drachengefahr erkannt. Akzeptiert.'
            : sel.value === 'Oberwelt' ? 'Sehr allgemein. Akzeptiert.'
            : 'Herkunft gespeichert. Auszahlungen erfolgen ausschließlich in die Oberwelt.';
          api.seq([{ t: reply, k: 'official' }], () => api.continueBtn());
        } }]);
      });
    }
  });

  register({
    id: 'memory', type: 'captcha', difficulty: 1, title: 'Gedächtnisprüfung',
    run(api) {
      const num = String(1000 + Math.floor(Math.random() * 9000));
      api.render(api.screen({
        title: 'Gedächtnisprüfung',
        lead: 'Merke dir diese Zahl.',
        body: `<div class="bkb-risk" data-num>${num}</div>
               <input type="text" inputmode="numeric" maxlength="4" class="bkb-input bkb-short-input" data-answer placeholder="____" autocomplete="off" hidden>`
      }), () => {
        const numEl = api.q('[data-num]');
        const input = api.q('[data-answer]');
        const hide = () => { numEl.textContent = '••••'; input.hidden = false; input.focus(); };
        api.after(2600, () => {
          hide();
          api.actions([
            { label: 'Prüfen', onClick: b => {
              if (input.value.trim() !== num) { api.feedback('Nicht korrekt.', 'err'); api.fail(); return; }
              b.disabled = true;
              input.disabled = true;
              api.seq([{ t: 'Korrekt.', k: 'ok' }, { t: 'Wir haben sie inzwischen vergessen.', k: 'muted' }], () => api.continueBtn());
            } },
            { label: 'Nochmal anzeigen', cls: 'btn-nein', onClick: () => { numEl.textContent = num; api.after(2000, hide); } }
          ]);
        });
      });
    }
  });

  register({
    id: 'ticket', type: 'captcha', difficulty: 0, title: 'Wartenummer',
    run(api) {
      api.render(api.screen({ title: 'Wartenummer', lead: 'Bitte ziehe eine Wartenummer.', body: '<div class="bkb-queue" data-t hidden><small>Deine Nummer</small><strong>000</strong></div>' }), () => {
        api.actions([{ label: 'Wartenummer ziehen', onClick: () => {
          api.actions([]);
          api.q('[data-t]').hidden = false;
          api.seq([
            { t: 'Aktuell aufgerufen: 001.', k: 'official', w: 900 },
            { t: 'Deine Nummer wird aufgerufen, sobald sie aufgerufen wird.', k: 'muted' },
            { t: 'Wartenummer 000 akzeptiert.', k: 'ok' }
          ], () => api.continueBtn());
        } }]);
      });
    }
  });

  register({
    id: 'hiddenWeiter', type: 'captcha', difficulty: 1, title: 'Lesepflicht',
    run(api) {
      api.render(api.screen({
        title: 'Lesepflicht',
        lead: 'Bitte lies den folgenden Absatz aufmerksam.',
        body: `<p class="bkb-legal-text">Gemäß Abschnitt 14B der Auszahlungsordnung ist jede antragstellende Person verpflichtet,
          den Vorgang eigenständig <button type="button" class="bkb-inline-link" data-go>weiter</button>zuführen, sofern keine
          Einwände der Finanzabteilung, der Abteilung für Zuständigkeiten oder des Faxgeräts vorliegen.</p>`
      }), () => {
        api.q('[data-go]').addEventListener('click', e => {
          e.currentTarget.disabled = true;
          api.seq([{ t: 'Gefunden. Aufmerksam gelesen.', k: 'ok' }], () => api.after(500, () => api.done()));
        });
        api.after(9000, () => { if (!api.q('[data-go]').disabled) api.line('Tipp: Ein Wort im Text ist anklickbar.', 'muted'); });
      });
    }
  });

  register({
    id: 'loadingBar', type: 'captcha', difficulty: 0, title: 'Ladebalken-Qualität',
    run(api) {
      api.render(api.screen({
        title: 'Ladebalken-Qualitätsprüfung',
        lead: 'Bitte beobachte den Ladebalken.',
        body: '<div class="investor-security-stage7-track"><div class="investor-security-stage7-fill" data-fill></div></div>'
      }), () => {
        const fill = api.q('[data-fill]');
        [12, 31, 47, 48, 49, 83, 100].forEach((v, i) => api.after(250 + i * 520, () => { fill.style.width = v + '%'; }));
        api.after(4000, () => {
          api.line('War der Ladebalken flüssig?', 'question');
          api.actions([
            { label: 'Ja', onClick: () => { api.actions([]); api.seq([{ t: 'Danke. Wir geben das an den Ladebalken weiter.', k: 'ok' }], () => api.continueBtn()); } },
            { label: 'Nein', cls: 'btn-nein', onClick: () => { api.actions([]); api.seq([{ t: 'Beschwerde an den Ladebalken weitergeleitet.', k: 'official' }], () => api.continueBtn()); } }
          ]);
        });
      });
    }
  });

  register({
    id: 'cookieRating', type: 'captcha', difficulty: 0, title: 'Cookie-Bewertung',
    run(api) {
      api.render(api.screen({
        title: 'Cookie-Bewertung',
        lead: 'Wie bewertest du unsere Cookies?',
        body: `<div class="bkb-stars">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-star="${i}" aria-label="${i} Sterne">★</button>`).join('')}</div>`
      }), () => {
        api.qa('[data-star]').forEach(b => b.addEventListener('click', () => {
          const n = Number(b.dataset.star);
          api.qa('[data-star]').forEach(x => { x.disabled = true; x.classList.toggle('is-on', Number(x.dataset.star) <= n); });
          api.seq([{ t: 'Bewertung gespeichert.', k: 'ok' }, { t: 'Cookies wurden unabhängig davon gesetzt.', k: 'muted' }], () => api.continueBtn());
        }));
      });
    }
  });

  register({
    id: 'koraQuiz', type: 'captcha', difficulty: 0, easy: true, title: 'Organisationsprüfung',
    run(api) {
      const steps = [{ t: 'Antwort an Kora weitergeleitet.', k: 'official' }, { t: 'Kora antwortet: „Später.“', k: 'muted', w: 1400 }];
      choiceModule(api, {
        title: 'Organisationsprüfung',
        question: 'Wer ist Kora?',
        grid: true,
        options: ['Der Chef', 'Die Finanzabteilung', 'Ein Gerücht', 'Alles davon'].map(label => ({ label, steps }))
      });
    }
  });

  register({
    id: 'department', type: 'captcha', difficulty: 0, easy: true, title: 'Zuständigkeit',
    run(api) {
      const steps = [{ t: 'Falsch.', k: 'err' }, { t: 'Zuständig ist die Abteilung für Zuständigkeiten.', k: 'official' }, { t: 'Diese ist derzeit nicht besetzt.', k: 'muted' }];
      choiceModule(api, {
        title: 'Zuständigkeit',
        question: 'Welche Abteilung ist für deine Auszahlung zuständig?',
        options: ['Finanzabteilung', 'Support (Micha)', 'Telefonzentrale (Ronja)', 'Faxabteilung (Obsi)'].map(label => ({ label, steps }))
      });
    }
  });

  register({
    id: 'bagonTermin', type: 'captcha', difficulty: 0, easy: true, title: 'Terminabfrage',
    run(api) {
      choiceModule(api, {
        title: 'Terminabfrage',
        question: 'Bagon fragt: Hast du bereits einen Termin?',
        options: [
          { label: 'Ja', reply: 'Bagon findet ihn nicht. Akzeptiert.' },
          { label: 'Nein', reply: 'Bagon hat leider auch keinen. Akzeptiert.' }
        ]
      });
    }
  });

  register({
    id: 'sheepColor', type: 'captcha', difficulty: 0, easy: true, title: 'Ortskenntnis',
    run(api) {
      choiceModule(api, {
        title: 'Ortskenntnis',
        question: 'Welche Farbe hat das Schaf auf dieser Website?',
        grid: true,
        options: [
          { label: 'Weiß', reply: 'Das Schaf lässt grüßen. Antwort gewertet.' },
          { label: 'Pink', reply: 'Interessant. Das Schaf ist geschmeichelt.' },
          { label: 'Gold', reply: 'Goldschafe werden gesondert besteuert. Akzeptiert.' },
          { label: 'Welches Schaf?', reply: 'Es versteckt sich im Banner. Antwort trotzdem gewertet.' }
        ]
      });
    }
  });

  register({
    id: 'craftDiamond', type: 'captcha', difficulty: 0, title: 'Werkbankprüfung', minecraft: true,
    run(api) {
      choiceModule(api, {
        title: 'Werkbankprüfung',
        question: 'Was ergeben 9 Diamanten in der Werkbank?',
        grid: true,
        hint: 'Es ist ein Block.',
        options: [
          { label: 'Diamantblock', steps: [{ t: 'Korrekt.', k: 'ok' }, { t: 'Der Diamantblock wurde als Bearbeitungsgebühr einbehalten.', k: 'muted' }] },
          { label: 'Diamantschwert', retry: 'Dafür reichen zwei.' },
          { label: 'Eine Auszahlung', reply: 'Leider nein. Netter Versuch. Akzeptiert.' },
          { label: 'Nichts', retry: 'Doch, da kommt etwas raus.' }
        ]
      });
    }
  });

  register({
    id: 'creeperSound', type: 'captcha', difficulty: 0, title: 'Geräuschprüfung', minecraft: true,
    run(api) {
      choiceModule(api, {
        title: 'Geräuschprüfung',
        question: 'Welches Geräusch macht ein Creeper kurz vor der Explosion?',
        grid: true,
        hint: 'Es zischt.',
        options: [
          { label: 'Ssssss…', steps: [{ t: 'Korrekt.', k: 'ok' }, { t: 'Bitte jetzt nicht bewegen.', k: 'muted' }] },
          { label: 'Muh', retry: 'Das ist eine Kuh.' },
          { label: 'Määh', retry: 'Das ist das Schaf.' },
          { label: 'KABOOM', reply: 'Das ist danach. Akzeptiert.' }
        ]
      });
    }
  });

  register({
    id: 'obsidian', type: 'captcha', difficulty: 0, title: 'Materialprüfung', minecraft: true,
    run(api) {
      choiceModule(api, {
        title: 'Materialprüfung',
        question: 'Welcher Block ist am widerstandsfähigsten?',
        grid: true,
        hint: 'Er ist schwarz-lila.',
        options: [
          { label: 'Obsidian', steps: [{ t: 'Korrekt.', k: 'ok' }, { t: 'Obsi wurde informiert.', k: 'muted' }] },
          { label: 'Holz', retry: 'Holz brennt.' },
          { label: 'Wolle', retry: 'Wolle ist weich.' },
          { label: 'Formular BK-AUSZ-14B', reply: 'Fast. Formulare sind nahezu unzerstörbar. Akzeptiert.' }
        ]
      });
    }
  });

  register({
    id: 'netherPortal', type: 'captcha', difficulty: 1, title: 'Bauprüfung', minecraft: true,
    run(api) {
      choiceModule(api, {
        title: 'Bauprüfung',
        question: 'Wie viele Obsidianblöcke braucht ein Netherportal mindestens?',
        grid: true,
        hint: 'Ohne die Ecken.',
        options: [
          { label: '10', steps: [{ t: 'Korrekt.', k: 'ok' }, { t: 'Ein Portal zur Auszahlung wird trotzdem nicht geöffnet.', k: 'muted' }] },
          { label: '14', reply: 'Mit Ecken. Großzügig. Gewertet.' },
          { label: '12', retry: 'Nicht ganz.' },
          { label: '1 Formular', retry: 'Formulare öffnen keine Portale. Leider.' }
        ]
      });
    }
  });

  register({
    id: 'dayLength', type: 'captcha', difficulty: 0, title: 'Zeitprüfung', minecraft: true,
    run(api) {
      choiceModule(api, {
        title: 'Zeitprüfung',
        question: 'Wie lange dauert ein Minecraft-Tag (Tag und Nacht)?',
        grid: true,
        hint: 'Kürzer als eine Mittagspause.',
        options: [
          { label: '20 Minuten', steps: [{ t: 'Korrekt.', k: 'ok' }, { t: 'Deine Bearbeitung dauert voraussichtlich 3 Minecraft-Tage.', k: 'muted' }] },
          { label: '24 Stunden', retry: 'Das ist ein echter Tag.' },
          { label: '10 Minuten', retry: 'Das ist nur der helle Teil.' },
          { label: 'Bis zur Auszahlung', reply: 'Gefühlt korrekt. Akzeptiert.' }
        ]
      });
    }
  });

  /* ------------------------------------------------------------------
     CAPTCHAS - Community (Creator)
     ------------------------------------------------------------------ */
  register({
    id: 'scusy', type: 'captcha', difficulty: 0, mandatory: true, minSolved: 8, penalty: 1, title: 'Creator-Abteilung',
    description: 'Wann bekommt Scusy endlich sein Creator+?',
    run(api) {
      const queueSteps = [
        { t: 'Antwort an die Creator-Abteilung weitergeleitet.', k: 'official' },
        { t: 'Scusys Antrag wurde in die Warteschlange gesetzt. Position: #1', k: 'ok' },
        { t: 'Premium-Kunden wurden vorgelassen.', k: 'err', w: 1400 },
        { t: 'Neue Position: #48', k: 'official' }
      ];
      choiceModule(api, {
        title: 'Sonderprüfung: Creator-Abteilung',
        lead: 'Bitte beantworte die folgende Frage im Namen der Creator-Abteilung.',
        question: 'Wann bekommt Scusy endlich sein Creator+?',
        grid: true,
        options: [
          { label: 'Heute noch', steps: [...queueSteps, { t: '„Heute noch“ wurde als Wunschtermin vermerkt.', k: 'muted' }] },
          { label: 'Nächste Woche', steps: [...queueSteps, { t: 'Nächste Woche ist bereits ausgebucht.', k: 'muted' }] },
          { label: 'Wenn Kora Zeit hat', steps: [{ t: 'Kora hat aktuell keine Zeit.', k: 'err' }, { t: 'Grund: bearbeitet deine Auszahlung.', k: 'muted' }, ...queueSteps.slice(1)] },
          { label: 'Nie', steps: [{ t: 'Scusy wurde über deine Einschätzung informiert.', k: 'err' }, { p: 1, label: 'Captcha (Gewissensabgabe)' }] }
        ]
      });
    }
  });

  register({
    id: 'liberQuiz', type: 'captcha', difficulty: 0, maxCount: 1, title: 'Personalprüfung',
    run(api) {
      choiceModule(api, {
        title: 'Personalprüfung',
        question: 'Wer versteckt sich gerade irgendwo auf dieser Website?',
        grid: true,
        options: [
          { label: 'Liber', steps: [{ t: 'Korrekt.', k: 'ok' }, { t: 'Liber wurde trotzdem nicht gefunden.', k: 'muted' }] },
          { label: 'Obsi', reply: 'Obsi ist im Faxraum. Antwort trotzdem gewertet.' },
          { label: 'Micha', reply: 'Micha sitzt im Support. Antwort trotzdem gewertet.' },
          { label: 'Ronja', reply: 'Ronja ist in der Telefonzentrale. Antwort trotzdem gewertet.' }
        ]
      });
    }
  });

  /* ------------------------------------------------------------------
     CAPTCHAS - Minecraft (als Gewuerz, ca. ein Viertel)
     ------------------------------------------------------------------ */
  const PLUSHIE_PEOPLE = [
    ['Opphil', 'Phil'], ['Kora', 'Kora'], ['Scusy', 'Scusy'], ['obsi', 'Obsi'], ['lukas', 'Lukas'], ['RonjaWolf', 'Ronja']
  ];
  register({
    id: 'phil', type: 'captcha', difficulty: 1, maxCount: 1, title: 'Bilderkennung', minecraft: true,
    run(api) {
      const tiles = shuffle(PLUSHIE_PEOPLE);
      api.render(api.screen({
        title: 'Bilderkennung',
        lead: 'Wähle das Bild mit Phil.',
        body: `<div class="bkb-image-grid">${tiles.map(([file, name]) => `
          <button type="button" class="bkb-image-tile" data-name="${esc(name)}">
            <img src="assets/plushies/${file}-web.webp" data-full-src="assets/plushies/${file}.png" alt="" loading="lazy" decoding="async">
          </button>`).join('')}</div>`
      }), () => {
        api.qa('[data-name]').forEach(b => b.addEventListener('click', () => {
          const name = b.dataset.name;
          if (name !== 'Phil') {
            b.disabled = true;
            api.feedback(`Das ist nicht Phil. Das ist ${name}.`, 'err');
            if (api.fail() >= 2) { const phil = api.q('[data-name="Phil"]'); if (phil) phil.classList.add('is-hinted'); }
            return;
          }
          api.qa('[data-name]').forEach(x => { x.disabled = true; });
          b.classList.add('is-picked');
          api.seq([{ t: 'Phil erkannt.', k: 'ok' }, { t: 'Phil hat dich ebenfalls erkannt.', k: 'muted' }], () => api.continueBtn());
        }));
      });
    }
  });

  register({
    id: 'creeper', type: 'captcha', difficulty: 0, maxCount: 1, title: 'Bilderkennung', minecraft: true,
    run(api) {
      // 3-4 echte Creeper-Gesichter (assets/prank/creeper-face.png) zwischen
      // einfarbig gruenen Feldern - aehnlich genug, um kurz zu zoegern.
      const creeperCount = 3 + Math.floor(Math.random() * 2);
      const creeperSet = new Set(shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, creeperCount));
      api.render(api.screen({
        title: 'Bilderkennung',
        lead: 'Wähle alle Felder mit einem Creeper.',
        body: `<div class="bkb-creeper-grid">${Array.from({ length: 9 }, (_, i) => `
          <button type="button" class="bkb-creeper-tile${creeperSet.has(i) ? ' has-creeper' : ''}" data-i="${i}" aria-label="Feld ${i + 1}">
            ${creeperSet.has(i) ? '<img src="assets/prank/creeper-face.png?v=20261003-1" alt="" draggable="false">' : ''}
          </button>`).join('')}</div>`
      }), () => {
        api.qa('[data-i]').forEach(b => b.addEventListener('click', () => b.classList.toggle('is-picked')));
        api.actions([{ label: 'Bestätigen', onClick: btn => {
          const picked = api.qa('.bkb-creeper-tile.is-picked').map(x => Number(x.dataset.i));
          if (!picked.length) { api.feedback('Bitte wähle mindestens ein Feld aus.', 'err'); return; }
          btn.disabled = true;
          api.qa('[data-i]').forEach(x => { x.disabled = true; });
          const correct = picked.length === creeperSet.size && picked.every(i => creeperSet.has(i));
          api.seq(correct
            ? [{ t: 'Auswahl wird geprüft…', k: 'muted' }, { t: 'Korrekt.', k: 'ok' }, { t: 'Verdächtig korrekt. Creeper-Kontakt wird vermerkt.', k: 'official' }]
            : [{ t: 'Auswahl wird geprüft…', k: 'muted' }, { t: 'Nicht ganz.', k: 'err' }, { t: 'Creeper sind schwer zu erkennen, bevor es zu spät ist. Akzeptiert.', k: 'muted' }],
          () => api.continueBtn());
        } }]);
      });
    }
  });

  register({
    id: 'tnt', type: 'captcha', difficulty: 1, maxCount: 1, title: 'Gefahrguterkennung', minecraft: true,
    run(api) {
      const fakes = ['TMT', 'TNI', 'INT', 'TTN', 'NTN', 'TN7', 'THT', 'TWT', 'T N T', 'TNTT', 'TЛT'];
      const labels = shuffle(['TNT', ...shuffle(fakes).slice(0, 8)]);
      api.render(api.screen({
        title: 'Gefahrguterkennung',
        lead: 'Finde das echte TNT.',
        body: `<div class="bkb-tnt-grid">${labels.map(l => `<button type="button" class="bkb-tnt" data-l="${esc(l)}">${esc(l)}</button>`).join('')}</div>`
      }), () => {
        api.qa('[data-l]').forEach(b => b.addEventListener('click', () => {
          if (b.dataset.l !== 'TNT') {
            b.disabled = true;
            api.feedback(`Das ist kein TNT. Das ist ${b.dataset.l}.`, 'err');
            if (api.fail() >= 3) { const real = api.q('[data-l="TNT"]'); if (real) real.classList.add('is-hinted'); }
            return;
          }
          api.qa('[data-l]').forEach(x => { x.disabled = true; });
          b.classList.add('is-picked');
          api.seq([{ t: 'TNT gefunden.', k: 'ok' }, { t: 'Bitte nicht anzünden.', k: 'muted' }], () => api.continueBtn());
        }));
      });
    }
  });

  register({
    id: 'chest', type: 'captcha', difficulty: 0, maxCount: 1, title: 'Truhenprüfung', minecraft: true,
    run(api) {
      api.render(api.screen({
        title: 'Truhenprüfung',
        lead: 'Welche Truhe enthält deine Auszahlung?',
        body: `<div class="bkb-chests">${[0, 1, 2].map(i => `<button type="button" class="bkb-chest" data-i="${i}"><span>🧰</span><small>Truhe ${i + 1}</small></button>`).join('')}</div>`
      }), () => {
        let opened = 0;
        api.qa('[data-i]').forEach(b => b.addEventListener('click', () => {
          opened++;
          b.disabled = true;
          b.classList.add('is-open');
          if (opened === 1) { api.feedback('Leer. Deine Auszahlung befindet sich in einer anderen Truhe.', 'err'); return; }
          api.qa('[data-i]').forEach(x => { x.disabled = true; });
          api.seq([{ t: 'Inhalt: 1× Formular BK-AUSZ-14B (Kopie).', k: 'official' }, { t: 'Immerhin.', k: 'muted' }], () => api.continueBtn());
        }));
      });
    }
  });

  register({
    id: 'item', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Itemprüfung', minecraft: true,
    run(api) {
      choiceModule(api, {
        title: 'Itemprüfung',
        question: 'Welches dieser Items ist eine gültige Auszahlungsform?',
        grid: true,
        options: ['💎 Diamant', '🟩 Smaragd', '🟫 Erdblock', '📄 Formular'].map(label => ({
          label,
          steps: [{ t: 'Item wurde zur Prüfung eingezogen.', k: 'official' }, { t: 'Rückgabe nach Abschluss der Prüfung (voraussichtlich nie).', k: 'muted' }]
        }))
      });
    }
  });

  register({
    id: 'dragonCompare', type: 'captcha', difficulty: 0, maxCount: 1, easy: true, title: 'Drachenvergleich', minecraft: true,
    run(api) {
      choiceModule(api, {
        title: 'Drachenvergleich',
        question: 'Welcher Drache sieht vertrauenswürdiger aus?',
        options: [
          { label: 'Zerathor', reply: 'Zerathor wurde informiert. Er ist geschmeichelt.' },
          { label: 'Yakshas Drache', reply: 'Yaksha liest mit. Gute Wahl.' },
          { label: 'Phil', reply: 'Phil ist kein Drache. Antwort trotzdem gewertet.' }
        ]
      });
    }
  });

  /* ------------------------------------------------------------------
     PFLICHT-BUEROKRATIE (Captchas)
     ------------------------------------------------------------------ */
  register({
    id: 'form', type: 'bureaucracy', countsAsCaptcha: true, mandatory: true, minSolved: 15, penalty: 1, difficulty: 1, title: 'Formular BK-AUSZ-14B',
    run(api) {
      api.render(api.screen({
        title: 'Formular BK-AUSZ-14B',
        lead: 'Bitte fülle das Formular vollständig aus.',
        body: `
          <div class="bkb-form">
            <label>Vorname<input class="bkb-input" value="${esc(api.investor)}" readonly></label>
            <label>Nachname<input class="bkb-input" value="(wird von BKInvestment festgelegt)" readonly></label>
            <label>Grund für Auszahlung
              <select class="bkb-input" data-reason>
                <option value="">Bitte wählen</option>
                <option>Ich möchte mein Geld</option>
                <option>Private Gründe</option>
                <option>Geld</option>
                <option>Sonstiges</option>
                <option>Ich wurde dazu gezwungen</option>
              </select>
            </label>
            <label>Warum möchtest du dein Geld?<textarea class="bkb-input bkb-textarea" rows="2" data-why placeholder="Begründung"></textarea></label>
          </div>`
      }), () => {
        const reason = api.q('[data-reason]');
        const why = api.q('[data-why]');
        api.actions([{ label: 'Formular einreichen', onClick: b => {
          if (!reason.value) { api.feedback('Bitte wähle einen Grund aus.', 'err'); return; }
          if (!why.value.trim()) { api.feedback('Bitte gib eine Begründung an.', 'err'); return; }
          b.disabled = true;
          reason.disabled = true;
          why.disabled = true;
          api.seq([{ t: 'Formular wird geprüft…', k: 'muted' }, { t: 'Begründung zu nachvollziehbar.', k: 'err' }, { p: 1, label: 'Prüfung' }], () => api.continueBtn());
        } }]);
      });
    }
  });

  register({
    id: 'signature', type: 'bureaucracy', countsAsCaptcha: true, mandatory: true, minSolved: 15, after: 'form', difficulty: 1, title: 'Unterschrift',
    run(api) {
      api.render(api.screen({
        title: 'Unterschrift',
        lead: isTouch ? 'Bitte unterschreibe mit dem Finger.' : 'Bitte unterschreibe mit der Maus.',
        body: '<canvas class="bkb-signature" data-canvas width="400" height="140"></canvas>'
      }), () => {
        const canvas = api.q('[data-canvas]');
        const g = canvas.getContext('2d');
        let drawing = false;
        let points = 0;
        let attempt = 0;
        let locked = false;
        const pos = e => {
          const r = canvas.getBoundingClientRect();
          return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
        };
        const clear = () => { g.clearRect(0, 0, canvas.width, canvas.height); points = 0; };
        g.lineWidth = 2.6;
        g.lineCap = 'round';
        g.strokeStyle = '#a78bfa';
        canvas.addEventListener('pointerdown', e => {
          if (locked) return;
          e.preventDefault();
          drawing = true;
          try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* unkritisch */ }
          const [x, y] = pos(e);
          g.beginPath();
          g.moveTo(x, y);
        });
        canvas.addEventListener('pointermove', e => {
          if (!drawing || locked) return;
          const [x, y] = pos(e);
          g.lineTo(x, y);
          g.stroke();
          points++;
        });
        ['pointerup', 'pointercancel'].forEach(evt => canvas.addEventListener(evt, () => { drawing = false; }));
        const submit = () => {
          if (points < 15) { api.feedback('Bitte unterschreibe vollständig.', 'err'); return; }
          locked = true;
          attempt++;
          api.actions([]);
          api.feedback('', null);
          if (attempt === 1) {
            api.seq([
              { t: 'Unterschrift wird geprüft…', k: 'muted' },
              { t: 'Unterschrift sieht anders aus als unsere Vergleichsunterschrift.', k: 'err', w: 1600 },
              { html: 'Vergleichsunterschrift: <span class="bkb-empty-sig">nicht vorhanden</span>', k: 'muted' }
            ], () => api.actions([{ label: 'Erneut unterschreiben', onClick: () => { clear(); locked = false; api.q('.bkb-seq').innerHTML = ''; api.actions([{ label: 'Unterschrift prüfen', onClick: submit }]); } }]));
          } else {
            api.seq([
              { t: 'Unterschrift wird geprüft…', k: 'muted' },
              { t: 'Jetzt sieht sie ZU ähnlich aus.', k: 'err', w: 1600 },
              { t: 'Unterschrift wird aus Kulanz akzeptiert.', k: 'ok' }
            ], () => api.continueBtn());
          }
        };
        api.actions([{ label: 'Unterschrift prüfen', onClick: submit }]);
      });
    }
  });

  register({
    id: 'printer', type: 'miniGame', mandatory: true, minSolved: 26, difficulty: 1, title: 'Drucker',
    run(api) {
      api.render(api.screen({
        title: 'Dokumentendruck',
        lead: 'Auszahlungsdokument wird gedruckt.',
        body: `<div class="bkb-printer"><div class="bkb-printer-body"><span class="bkb-printer-light" data-light></span></div><div class="bkb-paper" data-paper>BK-AUSZ-14B</div></div>`
      }), () => {
        const paper = api.q('[data-paper]');
        const light = api.q('[data-light]');
        paper.classList.add('is-printing');
        api.after(1700, () => {
          paper.classList.remove('is-printing');
          paper.classList.add('is-jammed');
          light.classList.add('is-error');
          api.feedback('Papierstau.', 'err');
          api.actions([{ label: 'Papierstau beheben', onClick: () => {
            api.actions([]);
            api.feedback('Ziehe das Papier heraus (mehrmals antippen).', null);
            let pulls = 0;
            paper.classList.add('is-pullable');
            paper.addEventListener('click', () => {
              if (pulls >= 5) return;
              pulls++;
              paper.style.setProperty('--pull', pulls);
              if (pulls < 5) return;
              paper.classList.add('is-removed');
              light.classList.remove('is-error');
              api.feedback('Papier entfernt.', 'ok');
              api.after(1000, () => {
                api.feedback('Toner leer.', 'err');
                light.classList.add('is-error');
                api.actions([{ label: 'Toner wechseln', onClick: () => {
                  api.actions([]);
                  api.seq([
                    { t: 'Toner wird gewechselt…', k: 'muted' },
                    { t: 'Drucker offline.', k: 'err', w: 1400 },
                    { t: 'Dokument wird digital fortgesetzt.', k: 'official', w: 1200 }
                  ], () => api.continueBtn());
                } }]);
              });
            });
          } }]);
        });
      });
    }
  });

  register({
    id: 'stamp', type: 'miniGame', mandatory: true, minSolved: 30, difficulty: 2, title: 'Amtlicher Stempel',
    run(api) {
      api.render(api.screen({
        title: 'Amtlicher Stempel',
        lead: isTouch ? 'Dokument benötigt einen BK-Stempel. Ziehe den Stempel auf das Stempelfeld (oder antippen, dann Feld antippen).' : 'Dokument benötigt einen BK-Stempel. Ziehe den Stempel auf das Stempelfeld.',
        body: `<div class="bkb-stamp-area">
                 <div class="bkb-doc"><div class="bkb-doc-lines"><span></span><span></span><span></span><span class="is-short"></span></div><div class="bkb-doc-field" data-field>Stempelfeld</div></div>
                 <button type="button" class="bkb-stamp-tool" data-stamp aria-label="BK-Stempel">BK</button>
               </div>`
      }), () => {
        const field = api.q('[data-field]');
        const stamp = api.q('[data-stamp]');
        let attempts = 0;
        let dragging = false;
        let moved = false;
        let armed = false;
        let locked = false;
        let sx = 0;
        let sy = 0;
        const resetPos = () => { stamp.style.transform = ''; };
        const mark = offset => {
          const m = document.createElement('div');
          m.className = 'bkb-doc-mark';
          m.textContent = 'BK GENEHMIGT';
          if (offset) m.style.marginLeft = '-6px';
          field.appendChild(m);
          return m;
        };
        const drop = (x, y) => {
          const r = field.getBoundingClientRect();
          const inside = x >= r.left - 30 && x <= r.right + 30 && y >= r.top - 30 && y <= r.bottom + 30;
          resetPos();
          if (!inside) { api.feedback('Der Stempel muss auf das Stempelfeld.', 'err'); api.fail('Den BK-Stempel einfach auf das gestrichelte Feld ziehen.'); return; }
          attempts++;
          if (attempts === 1) {
            const m = mark(true);
            api.feedback('Stempel sitzt 3 Pixel zu weit links. Bitte erneut stempeln.', 'err');
            api.after(1400, () => m.remove());
            return;
          }
          locked = true;
          mark(false);
          stamp.hidden = true;
          api.feedback('Genehmigt.', 'ok');
          api.after(900, () => api.continueBtn());
        };
        stamp.addEventListener('pointerdown', e => {
          if (locked) return;
          e.preventDefault();
          dragging = true;
          moved = false;
          sx = e.clientX;
          sy = e.clientY;
          try { stamp.setPointerCapture(e.pointerId); } catch (err) { /* unkritisch */ }
        });
        stamp.addEventListener('pointermove', e => {
          if (!dragging) return;
          const dx = e.clientX - sx;
          const dy = e.clientY - sy;
          if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
          stamp.style.transform = `translate(${dx}px, ${dy}px)`;
        });
        stamp.addEventListener('pointerup', e => {
          if (!dragging) return;
          dragging = false;
          if (!moved) {
            armed = true;
            stamp.classList.add('is-armed');
            resetPos();
            api.feedback('Stempel aufgenommen. Jetzt auf das Stempelfeld tippen.', null);
            return;
          }
          drop(e.clientX, e.clientY);
        });
        stamp.addEventListener('pointercancel', () => { dragging = false; resetPos(); });
        field.addEventListener('click', () => {
          if (!armed || locked) return;
          armed = false;
          stamp.classList.remove('is-armed');
          const r = field.getBoundingClientRect();
          drop(r.left + r.width / 2, r.top + r.height / 2);
        });
      });
    }
  });

  /* ------------------------------------------------------------------
     PFLICHT-EREIGNISSE
     ------------------------------------------------------------------ */
  register({
    id: 'unusual', type: 'event', mandatory: true, minSolved: 3, penalty: 2, title: 'Ungewöhnliches Verhalten',
    run(api) {
      const minutes = Math.max(1, Math.round((Date.now() - state.startedAt) / 60000));
      messageModule(api, {
        title: 'Sicherheitshinweis',
        steps: [
          { t: 'Ungewöhnliches Auszahlungsverhalten erkannt.', k: 'err' },
          { t: `Du versuchst bereits seit ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}, deine Auszahlung zu bekommen.`, k: 'official' },
          { t: 'Das ist verdächtig.', k: 'err' },
          { p: 2 }
        ]
      });
    }
  });

  register({
    id: 'risk', type: 'event', mandatory: true, minSolved: 5, penalty: 1, title: 'Risikoscore',
    run(api) {
      messageModule(api, {
        title: 'Risikobewertung',
        lead: 'BKInvestment berechnet deinen Auszahlungs-Risikoscore.',
        body: '<div class="bkb-risk" data-risk>0</div>',
        setup() {
          const el = api.q('[data-risk]');
          [18, 42, 81, 99].forEach((v, i) => api.after(500 + i * 450, () => { el.textContent = String(v); }));
          api.after(2500, () => { el.innerHTML = '97<small>/100</small>'; el.classList.add('is-high'); });
        },
        steps: [
          { t: 'RISIKOSCORE: 97/100', k: 'official', w: 2900 },
          { t: 'Begründung: Möchte Geld ausgezahlt bekommen.', k: 'muted' },
          { t: 'Manuelle Prüfung erforderlich.', k: 'err' },
          { p: 1, label: 'Prüfung' }
        ]
      });
    }
  });

  register({
    id: 'boost', type: 'fakeOffer', mandatory: true, minSolved: 10, penalty: 5, title: 'BK CAPTCHA BOOST™',
    run(api) {
      api.render(api.screen({
        title: '',
        body: `
          <div class="bkb-offer">
            <div class="bkb-offer-badge">BK CAPTCHA BOOST™</div>
            <p class="bkb-offer-title">Keine Lust mehr?</p>
            <p class="bkb-line is-muted">Bearbeite Sicherheitsprüfungen bis zu 2× schneller.</p>
            <div class="bkb-prices">
              <span class="bkb-price">4,99 €</span><span class="bkb-or">oder</span>
              <span class="bkb-price">999.999 $</span><span class="bkb-or">oder</span>
              <span class="bkb-price">1 Verwaltungsmarke</span>
            </div>
            <p class="bkb-fineprint">* Simulierter Vorgang. Es wird kein echtes Geld berechnet. Leider wird auch keins ausgezahlt.</p>
          </div>`
      }), () => {
        api.actions([
          { label: 'BOOST KAUFEN', onClick: () => {
            api.actions([]);
            api.seq([
              { t: 'Zahlung wird verarbeitet…', k: 'muted' },
              { t: 'Zahlung wird geprüft…', k: 'muted', w: 900 },
              { t: 'Bank wird kontaktiert…', k: 'muted', w: 900 },
              { t: 'Finanzabteilung schläft.', k: 'official', w: 1100 },
              { t: 'Zahlung fehlgeschlagen.', k: 'err', w: 1300 },
              { p: 5, label: 'Captchas Bearbeitungsgebühr' },
              { t: 'Vielen Dank für deinen Einkauf.', k: 'ok' }
            ], () => api.continueBtn());
          } },
          { label: 'Ohne Boost fortfahren', cls: 'btn-nein', onClick: () => {
            api.actions([]);
            api.seq([{ t: 'Angebot abgelehnt.', k: 'official' }, { t: 'Das Angebot war ohnehin nur heute gültig. Und gestern.', k: 'muted' }], () => api.continueBtn());
          } }
        ]);
      });
    }
  });

  register({
    id: 'yakshaFollowup', type: 'event', mandatory: true, minSolved: 12, title: 'Rückfrage Yaksha',
    cond: s => !!s.flags.yaksha,
    run(api) {
      if (state.flags.yaksha === 'nein') {
        messageModule(api, {
          title: 'Einspruch eingegangen',
          steps: [
            { t: 'Yaksha hat Einspruch gegen deine Entscheidung eingelegt.', k: 'err' },
            { t: 'Einspruch wird bearbeitet…', k: 'muted' },
            { t: 'Einspruch stattgegeben.', k: 'official', w: 1600 },
            { p: 3 },
            { t: 'Deine Entscheidung kann nicht mehr geändert werden.', k: 'muted' }
          ]
        });
      } else {
        messageModule(api, {
          title: 'Dankesschreiben',
          steps: [
            { t: 'Yaksha bedankt sich für deine Zustimmung.', k: 'ok' },
            { t: 'Dankesschreiben wird zugestellt…', k: 'muted' },
            { t: 'Zustellgebühr:', k: 'official', w: 1300 },
            { p: 1 }
          ]
        });
      }
    }
  });

  register({
    id: 'queue', type: 'event', mandatory: true, minSolved: 13, title: 'Warteschlange',
    run(api) {
      api.render(api.screen({
        title: 'Auszahlungs-Warteschlange',
        lead: 'Du befindest dich jetzt in der Auszahlungs-Warteschlange.',
        body: '<div class="bkb-queue"><small>Position</small><strong data-pos>#1847</strong></div>'
      }), () => {
        const pos = api.q('[data-pos]');
        const countDown = (list, done) => {
          list.forEach((v, i) => api.after(450 + i * 420, () => { pos.textContent = '#' + v; }));
          api.after(450 + list.length * 420, done);
        };
        countDown([1847, 944, 212, 56, 12, 3, 2, 1], () => {
          api.line('Du bist als Nächstes dran.', 'ok');
          api.after(1600, () => {
            api.line('Sitzung abgelaufen.', 'err');
            api.actions([{ label: 'Warteschlange erneut betreten', onClick: () => {
              api.actions([]);
              api.q('.bkb-seq').innerHTML = '';
              pos.textContent = '#2';
              api.after(1300, () => {
                api.line('Premium-Kunden wurden vorgelassen.', 'err');
                pos.textContent = '#47';
                api.after(1200, () => countDown([31, 12, 4, 1], () => {
                  api.line('Du bist dran.', 'ok');
                  api.after(700, () => api.continueBtn());
                }));
              });
            } }]);
          });
        });
      });
    }
  });

  register({
    id: 'fakeFinal1', type: 'fakeFinal', mandatory: true, minSolved: 18, penalty: 1, title: 'Geschafft!',
    run(api) { fakeFinal(api, 1); }
  });
  register({
    id: 'fakeFinal2', type: 'fakeFinal', mandatory: true, minSolved: 40, penalty: 3, title: 'Geschafft! Diesmal wirklich.',
    run(api) { fakeFinal(api, 2); }
  });
  function fakeFinal(api, n) {
    state.flags.fakeFinals++;
    save();
    api.render(api.screen({
      title: '',
      body: `<div class="bkb-final-head">GESCHAFFT!</div>
             ${n === 2 ? '<p class="bkb-line is-official">Diesmal wirklich.</p>' : ''}
             <p class="bkb-line is-ok">Deine Auszahlung ist bereit.</p>`
    }), () => {
      api.confetti();
      api.actions([{ label: 'AUSZAHLUNG ANZEIGEN', cls: 'btn-ja bkb-final-btn', onClick: () => {
        api.actions([]);
        api.seq(n === 1
          ? [{ t: 'Einen Moment…', k: 'muted' }, { t: 'Eine letzte Sicherheitsprüfung.', k: 'official', w: 1200 }, { p: 1, label: 'Sicherheitsprüfung' }]
          : [{ t: 'Einen Moment…', k: 'muted' }, { t: 'Neue regulatorische Anforderungen erkannt.', k: 'err', w: 1300 }, { p: 3 }, { t: 'Wir bitten um Verständnis.', k: 'muted' }],
        () => api.continueBtn());
      } }]);
    });
  }

  register({
    id: 'premium', type: 'fakeOffer', mandatory: true, minSolved: 21, title: 'BK CAPTCHA PREMIUM',
    run(api) {
      api.render(api.screen({
        title: '',
        body: `
          <div class="bkb-offer is-premium">
            <div class="bkb-offer-badge">BK CAPTCHA PREMIUM</div>
            <ul class="bkb-features">
              <li>✓ Weniger Captchas</li><li>✓ Schnellere Auszahlung</li><li>✓ Premium-Warteschlange</li>
              <li>✓ Persönlicher Sachbearbeiter</li><li>✓ Luxuriöser Ladebalken</li>
            </ul>
            <p class="bkb-fineprint">* Simulierter Vorgang. Es entstehen keine Kosten.</p>
          </div>`
      }), () => {
        api.actions([
          { label: '30 Tage kostenlos testen', onClick: () => {
            api.actions([]);
            state.flags.premium = true;
            save();
            api.seq([
              { t: 'Premium aktiviert.', k: 'ok', fn: () => { if (ctx.cardEl) ctx.cardEl.classList.add('bkb-premium'); } },
              { t: 'Testphase beendet.', k: 'err', w: 2000, fn: () => { if (ctx.cardEl) ctx.cardEl.classList.remove('bkb-premium'); } },
              { t: 'Dein persönlicher Sachbearbeiter wurde zugeteilt.', k: 'official', w: 1300 },
              { html: '<span class="bkb-clerk"><strong>Liber</strong> · Status: <em class="is-away">ABWESEND</em></span>', w: 900 },
              { t: 'Liber ist momentan nicht erreichbar.', k: 'muted' },
              { t: 'Letzter bekannter Aufenthaltsort: irgendwo auf dieser Website.', k: 'muted' }
            ], () => api.continueBtn());
          } },
          { label: 'Nein danke', cls: 'btn-nein', onClick: () => {
            api.actions([]);
            api.seq([{ t: 'Premium abgelehnt.', k: 'official' }, { t: 'Standard-Bearbeitung bleibt aktiv. Sie ist identisch.', k: 'muted' }], () => api.continueBtn());
          } }
        ]);
      });
    }
  });

  register({
    id: 'clerk', type: 'bureaucracy', mandatory: true, minSolved: 24, title: 'Sachbearbeitung',
    run(api) {
      api.render(api.screen({
        title: 'Sachbearbeitung',
        lead: 'Sachbearbeiter prüft deine Auszahlung.',
        body: '<div class="bkb-clerk-card"><span class="bkb-clerk-avatar">🧑‍💼</span><div><strong data-name>Lukas</strong><small>Status: <em data-status>Kaffeepause</em></small></div></div>'
      }), () => {
        const name = api.q('[data-name]');
        const status = api.q('[data-status]');
        api.after(2000, () => { status.textContent = 'Zurück'; status.className = 'is-ok'; });
        api.seq([
          { t: 'Lukas hat deine Akte an Frau Kowalski weitergegeben.', k: 'official', w: 3200, fn: () => { name.textContent = 'Frau Kowalski'; status.textContent = 'Urlaub'; status.className = 'is-away'; } },
          { t: 'Automatische Bearbeitung wird fortgesetzt.', k: 'muted', w: 1500 }
        ], () => {
          api.after(700, () => {
            api.line('Wie zufrieden bist du mit deinem Sachbearbeiter?', 'question');
            const stars = document.createElement('div');
            stars.className = 'bkb-stars';
            stars.innerHTML = [1, 2, 3, 4, 5].map(i => `<button type="button" data-star="${i}" aria-label="${i} Sterne">★</button>`).join('');
            api.q('.bkb-seq').appendChild(stars);
            stars.querySelectorAll('[data-star]').forEach(b => b.addEventListener('click', () => {
              const n = Number(b.dataset.star);
              stars.querySelectorAll('[data-star]').forEach(x => { x.disabled = true; x.classList.toggle('is-on', Number(x.dataset.star) <= n); });
              api.seq([{ t: 'Feedback kann aktuell nicht verarbeitet werden.', k: 'err' }], () => api.continueBtn());
            }));
          });
        });
      });
    }
  });

  register({
    id: 'fax', type: 'bureaucracy', mandatory: true, minSolved: 28, title: 'Fax',
    run(api) {
      messageModule(api, {
        title: 'Faxversand',
        lead: 'BKInvestment verwendet aus Sicherheitsgründen Fax.',
        body: '<div class="bkb-fax">📠 <span class="bkb-dots"><i></i><i></i><i></i></span></div>',
        steps: [
          { t: 'Fax wird gesendet an: Obsi (Faxabteilung)…', k: 'muted' },
          { t: 'Empfänger nicht erreichbar.', k: 'err', w: 1500 },
          { t: 'Erneuter Versuch…', k: 'muted' },
          { t: 'Fax erfolgreich.', k: 'ok', w: 1500 },
          { t: 'Antwort wird erwartet…', k: 'muted' },
          { t: 'Antwort per Post versendet.', k: 'official', w: 3000 }
        ]
      });
    }
  });

  register({
    id: 'appointment', type: 'bureaucracy', mandatory: true, minSolved: 32, title: 'Termin',
    run(api) {
      const days = ['Mo 03.', 'Di 04.', 'Mi 05.', 'Do 06.', 'Fr 07.', 'Mo 10.', 'Di 11.', 'Mi 12.', 'Do 13.', 'Fr 14.', 'Mo 17.'];
      api.render(api.screen({
        title: 'Terminvergabe',
        lead: 'Für deine Auszahlung ist ein persönlicher Termin bei Bagon erforderlich.',
        body: `<div class="bkb-calendar">
          ${days.map(d => `<div class="bkb-day is-full"><span>${d}</span><small>AUSGEBUCHT</small></div>`).join('')}
          <button type="button" class="bkb-day is-free" data-free><span>29.02.2032</span><small>frei</small></button>
        </div>`
      }), () => {
        api.q('[data-free]').addEventListener('click', e => {
          const b = e.currentTarget;
          b.disabled = true;
          b.classList.add('is-picked');
          api.actions([{ label: 'Termin buchen', onClick: () => {
            api.actions([]);
            b.classList.remove('is-free');
            b.classList.add('is-full');
            b.querySelector('small').textContent = 'AUSGEBUCHT';
            api.seq([
              { t: 'Termin nicht mehr verfügbar.', k: 'err' },
              { t: 'Bagon hat den Termin soeben selbst gebucht.', k: 'muted' },
              { t: 'Deine Auszahlung wird ohne Termin fortgesetzt.', k: 'official' }
            ], () => api.continueBtn());
          } }]);
        });
      });
    }
  });

  register({
    id: 'tax', type: 'bureaucracy', mandatory: true, minSolved: 34, title: 'Captcha-Abgabe',
    run(api) {
      const n = Math.max(1, Math.floor(state.solved / 10));
      messageModule(api, {
        title: 'Neue gesetzliche Captcha-Abgabe',
        steps: [
          { t: 'Pro 10 gelöste Captchas wird 1 zusätzliches Captcha erhoben.', k: 'official' },
          { t: `Gelöste Captchas: ${state.solved}. Abgabe: ${n}.`, k: 'muted' },
          { p: n },
          { t: 'BKInvestment hat darauf leider keinen Einfluss.', k: 'muted' }
        ]
      });
    }
  });

  register({
    id: 'inflation', type: 'event', mandatory: true, minSolved: 36, title: 'Captcha-Inflation',
    run(api) {
      const before = state.remaining;
      const want = Math.min(5, Math.max(2, Math.round(before * 0.25)));
      api.render(api.screen({ title: 'Captcha-Inflation', lead: 'Aufgrund der aktuellen Captcha-Inflation wurde deine Restmenge angepasst.' }), () => {
        const applied = addCaptchas(want);
        api.line(`<span class="bkb-before">Vorher: ${before}</span> → <strong class="bkb-after">Nachher: ${before + applied}</strong>`, 'official', { html: true });
        api.seq([{ t: applied > 0 ? 'Wir bitten um Verständnis.' : 'Kulanzregelung: Anpassung entfällt.', k: 'muted', w: 1200 }], () => api.continueBtn());
      });
    }
  });

  /* ------------------------------------------------------------------
     ZUFALLS-EREIGNISSE (manche kosten, manche nicht, manche helfen)
     ------------------------------------------------------------------ */
  register({
    id: 'mouse', type: 'event', minSolved: 4, penalty: 1, weight: 1, title: 'Eingabeanalyse',
    run(api) {
      const human = Math.random() < 0.5;
      const word = isTouch ? 'Touch-Eingaben' : 'Mausbewegungen';
      messageModule(api, {
        title: 'Eingabeanalyse',
        steps: [
          { t: `Deine ${word} wirken ${human ? 'menschlich' : 'unmenschlich'}.`, k: 'official' },
          { t: 'Zusätzliche Prüfung erforderlich.', k: 'err' },
          { p: 1, label: 'Prüfung' }
        ]
      });
    }
  });

  register({
    id: 'allCorrect', type: 'event', minSolved: 6, penalty: 1, title: 'Statistik',
    run(api) {
      const perfect = state.flags.fails === 0;
      messageModule(api, {
        title: 'Statistische Auswertung',
        steps: perfect
          ? [{ t: 'Du hast alle bisherigen Captchas korrekt gelöst.', k: 'official' }, { t: 'Statistisch unwahrscheinlich.', k: 'err' }, { p: 1, label: 'Prüfung' }]
          : [{ t: `Fehlversuche bisher: ${state.flags.fails}.`, k: 'official' }, { t: 'Lernfortschritt wird überwacht.', k: 'muted' }]
      });
    }
  });

  register({
    id: 'browser', type: 'event', minSolved: 2, title: 'Browser-Check',
    run(api) {
      const ua = navigator.userAgent || '';
      let mine = 'Chrome';
      if (/Edg\//.test(ua)) mine = 'Edge';
      else if (/OPR\/|Opera/.test(ua)) mine = 'Opera';
      else if (/Firefox\//.test(ua)) mine = 'Firefox';
      else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) mine = 'Safari';
      const verdicts = { Chrome: 'Zu gewöhnlich.', Firefox: 'Zu unabhängig.', Opera: 'Interessant.', Edge: 'Mutig.', Safari: 'Zu elegant.' };
      messageModule(api, {
        title: 'Browser-Kompatibilität wird geprüft',
        steps: [
          ...['Chrome', 'Firefox', 'Opera', 'Edge'].map(b => ({ t: `${b}: ${verdicts[b]}`, k: b === mine ? 'official' : 'muted', w: 600 })),
          { t: `Dein Browser: ${mine}. ${verdicts[mine]}`, k: 'err', w: 900 },
          { t: 'Kompatibilität: ausreichend.', k: 'ok' }
        ]
      });
    }
  });

  register({
    id: 'timezone', type: 'event', minSolved: 3, title: 'Zeitzonenprüfung',
    run(api) {
      messageModule(api, {
        title: 'Zeitzonenprüfung',
        lead: 'Deine Auszahlung wurde in einer anderen Zeitzone beantragt.',
        body: '<div class="bkb-risk" data-tz>UTC</div>',
        setup() {
          const el = api.q('[data-tz]');
          ['UTC+1', 'UTC+2', 'Mondzeit'].forEach((v, i) => api.after(700 + i * 650, () => { el.textContent = v; }));
        },
        steps: [{ t: 'Umrechnung läuft…', k: 'muted' }, { t: 'Zeitzone bestätigt.', k: 'ok', w: 2400 }]
      });
    }
  });

  register({
    id: 'update', type: 'event', minSolved: 8, title: 'Systemupdate',
    run(api) {
      api.render(api.screen({
        title: 'Systemupdate',
        lead: 'BKInvestment Auszahlungssystem wird aktualisiert.',
        body: '<div class="bkb-final-pct" data-pct>0%</div><div class="investor-security-stage7-track"><div class="investor-security-stage7-fill" data-fill></div></div>'
      }), () => {
        const pct = api.q('[data-pct]');
        const fill = api.q('[data-fill]');
        const set = v => { pct.textContent = v + '%'; fill.style.width = v + '%'; };
        [1, 4, 18, 53, 99].forEach((v, i) => api.after(300 + i * 500, () => set(v)));
        api.after(4200, () => {
          api.line('Update fehlgeschlagen.', 'err');
          api.after(1100, () => {
            api.line('Vorherige Version wird wiederhergestellt…', 'muted');
            set(0);
            [37, 100].forEach((v, i) => api.after(500 + i * 600, () => set(v)));
            api.after(1900, () => { api.line('Erfolgreich.', 'ok'); api.after(700, () => api.continueBtn()); });
          });
        });
      });
    }
  });

  register({
    id: 'error404', type: 'event', minSolved: 9, title: 'Systemfehler',
    run(api) {
      messageModule(api, {
        title: '',
        body: '<div class="bkb-error-box"><strong>ERROR BK-404</strong><span>Auszahlung nicht gefunden.</span></div>',
        steps: [{ t: 'Spaß.', k: 'official', w: 1800 }, { t: 'Auszahlung gefunden.', k: 'ok' }]
      });
    }
  });

  register({
    id: 'bluescreen', type: 'event', minSolved: 14, title: 'Systemstörung',
    run(api) {
      api.render(api.screen({
        title: '',
        body: '<div class="bkb-bluescreen" data-bsod><span class="bkb-bsod-face">:(</span><p>BKInvestment ist auf ein Problem gestoßen.</p><small data-p>Fortschritt: 0 %</small><small class="bkb-bsod-brand">BKInvestment-Auszahlungssystem · keine Störung deines Geräts</small></div>'
      }), () => {
        api.after(2000, () => {
          const box = api.q('[data-bsod]');
          if (box) box.classList.add('is-gone');
          api.line('War nur ein Test.', 'official');
          api.after(900, () => api.continueBtn('Zurück'));
        });
      });
    }
  });

  register({
    id: 'vip', type: 'event', minSolved: 16, title: 'VIP-Warteschlange',
    run(api) {
      messageModule(api, {
        title: 'Statusänderung',
        steps: [
          { t: 'Du wurdest automatisch in die VIP-Warteschlange verschoben.', k: 'ok' },
          { t: 'VIP steht für: Very Inconvenient Processing.', k: 'official', w: 1500 }
        ]
      });
    }
  });

  register({
    id: 'eta', type: 'event', minSolved: 7, title: 'Bearbeitungszeit',
    run(api) {
      api.render(api.screen({ title: 'Geschätzte Bearbeitungszeit', body: '<div class="bkb-countdown" data-c>3 Sekunden</div>' }), () => {
        const c = api.q('[data-c]');
        api.after(1000, () => { c.textContent = '2'; });
        api.after(2000, () => { c.textContent = '1'; });
        api.after(3000, () => { c.textContent = '4 Werktage'; api.line('Neue Schätzung.', 'err'); });
        api.after(4400, () => { api.line('Beschleunigte Bearbeitung aktiviert.', 'ok'); c.textContent = '2 Sekunden'; });
        api.after(6600, () => api.done());
      });
    }
  });

  register({
    id: 'daily', type: 'event', minSolved: 11, penalty: 1, title: 'Captcha des Tages',
    run(api) {
      messageModule(api, {
        title: 'Herzlichen Glückwunsch!',
        steps: [
          { t: 'Du bist der 1000. Captcha-Nutzer heute.', k: 'ok' },
          { t: 'Bonus:', k: 'official' },
          { p: 1 }
        ],
        setup() { api.confetti(); }
      });
    }
  });

  register({
    id: 'loyalty', type: 'event', minSolved: 25, penalty: 1, title: 'BK Loyalty',
    run(api) {
      messageModule(api, {
        title: 'BK Loyalty freigeschaltet',
        steps: [
          { t: `Du hast bereits ${state.solved} Captchas gelöst.`, k: 'official' },
          { t: 'Belohnung: 1 kostenloses Captcha.', k: 'ok' },
          { p: 1, label: 'Captcha (kostenlos)' },
          { t: 'Viel Spaß damit.', k: 'muted' }
        ]
      });
    }
  });

  register({
    id: 'insurance', type: 'decision', minSolved: 12, title: 'Auszahlungsversicherung',
    run(api) {
      api.render(api.screen({ title: 'Auszahlungsversicherung', body: '<p class="investor-security-question">Möchtest du deine Auszahlung versichern?</p>' }), () => {
        api.actions([
          { label: 'JA', onClick: () => { api.actions([]); api.seq([{ t: 'Versicherung abgeschlossen.', k: 'ok' }, { t: 'Versicherungsprüfung erforderlich.', k: 'err' }, { p: 2 }], () => api.continueBtn()); } },
          { label: 'NEIN', cls: 'btn-nein', onClick: () => { api.actions([]); api.seq([{ t: 'Unversicherte Auszahlung erkannt.', k: 'err' }, { p: 1 }], () => api.continueBtn()); } }
        ]);
      });
    }
  });

  register({
    id: 'exchange', type: 'event', minSolved: 14, penalty: 2, title: 'Captcha-Börse',
    run(api) {
      messageModule(api, {
        title: '',
        body: '<div class="bkb-ticker"><span>CAPTCHA INDEX</span><strong>▲ +14,7 %</strong><small>heute</small></div>',
        steps: [{ t: 'Captchas sind heute leider teurer.', k: 'official' }, { p: 2 }]
      });
    }
  });

  register({
    id: 'lottery', type: 'event', minSolved: 9, title: 'Captcha-Lotterie',
    run(api) {
      api.render(api.screen({
        title: 'Captcha-Lotterie',
        lead: 'Ziehe eine Sicherheitsprüfung.',
        body: `<div class="bkb-cards">${[0, 1, 2].map(i => `<button type="button" class="bkb-card" data-i="${i}"><span>?</span></button>`).join('')}</div>`
      }), () => {
        const r = Math.random();
        const result = r < 0.58 ? 0 : (r < 0.9 ? 1 : 5);
        const others = shuffle([0, 1, 5].filter(v => v !== result));
        api.qa('[data-i]').forEach(b => b.addEventListener('click', () => {
          const cards = api.qa('[data-i]');
          cards.forEach(x => { x.disabled = true; });
          let o = 0;
          cards.forEach(x => {
            const v = x === b ? result : others[o++];
            x.classList.add('is-flipped');
            if (x === b) x.classList.add('is-picked');
            x.querySelector('span').textContent = `+${v}`;
          });
          api.after(900, () => {
            if (result === 0) api.seq([{ t: 'Keine zusätzlichen Captchas.', k: 'ok' }, { t: 'Glück gehabt. Vermerkt.', k: 'muted' }], () => api.continueBtn());
            else api.seq([{ p: result }], () => api.continueBtn());
          });
        }));
      });
    }
  });

  register({
    id: 'wheel', type: 'event', minSolved: 17, title: 'BK-Auszahlungsrad',
    run(api) {
      const fields = [
        ['nichts', 0, 30], ['+1 Captcha', 1, 25], ['+2 Captchas', 2, 10],
        ['Bearbeitung beschleunigt', -1, 15], ['kostenlose Sicherheitsprüfung', 1, 10], ['nochmal drehen', 'again', 10]
      ];
      api.render(api.screen({
        title: 'BK-Auszahlungsrad',
        lead: 'Drehe das Rad. (Kein Einsatz, kein Gewinn – nur Verwaltung.)',
        body: `<div class="bkb-wheel-wrap"><div class="bkb-wheel-pointer">▼</div><div class="bkb-wheel" data-wheel>${fields.map((f, i) => `<span style="--i:${i}">${esc(f[0])}</span>`).join('')}</div></div>`
      }), () => {
        const wheel = api.q('[data-wheel]');
        let spins = 0;
        let rotation = 0;
        const spin = () => {
          spins++;
          let pool = fields;
          if (spins > 1) pool = fields.filter(f => f[1] !== 'again');
          const total = pool.reduce((s, f) => s + f[2], 0);
          let r = Math.random() * total;
          let chosen = pool[0];
          for (const f of pool) { r -= f[2]; if (r <= 0) { chosen = f; break; } }
          const idx = fields.indexOf(chosen);
          const seg = 360 / fields.length;
          rotation += 1440 + (360 - (idx * seg + seg / 2)) - (rotation % 360);
          wheel.style.transform = `rotate(${rotation}deg)`;
          api.after(2700, () => {
            api.line(`Ergebnis: ${chosen[0]}`, 'official');
            if (chosen[1] === 'again') { api.actions([{ label: 'Nochmal drehen', onClick: () => { api.actions([]); spin(); } }]); return; }
            if (typeof chosen[1] === 'number' && chosen[1] !== 0) api.penalty(chosen[1]);
            api.after(800, () => api.continueBtn());
          });
        };
        api.actions([{ label: 'Rad drehen', onClick: () => { api.actions([]); spin(); } }]);
      });
    }
  });

  register({
    id: 'skip', type: 'event', minSolved: 8, positive: true, extraCaptchas: -1, title: 'Prüfung übersprungen',
    run(api) {
      messageModule(api, { title: 'Bearbeitungsstatus aktualisiert', steps: [{ t: 'Sicherheitsprüfung übersprungen.', k: 'ok' }, { p: -1 }] });
    }
  });
  register({
    id: 'goodCustomer', type: 'event', minSolved: 15, positive: true, extraCaptchas: -2, title: 'Guter Kunde',
    run(api) {
      messageModule(api, { title: 'Kundenstatus', steps: [{ t: 'Guter Kunde erkannt.', k: 'ok' }, { p: -2 }, { t: 'Wir schätzen dein Vertrauen.', k: 'muted' }] });
    }
  });
  register({
    id: 'kulanz', type: 'event', minSolved: 30, positive: true, extraCaptchas: -3, title: 'Kulanzaktion',
    run(api) {
      messageModule(api, { title: 'Kulanzaktion der Finanzabteilung', steps: [{ t: 'Aufgrund deiner Ausdauer gewährt die Finanzabteilung eine Kulanz.', k: 'ok' }, { p: -3 }, { t: 'Gilt nur heute. Und nur für dich. Sag es nicht weiter.', k: 'muted' }] });
    }
  });

  register({
    id: 'progressRecalc', type: 'event', minSolved: 20, maxCount: 2, title: 'Fortschritt neu berechnet',
    cond: () => progressPct() >= 55,
    run(api) {
      const before = progressPct();
      const target = Math.max(20, before - 18) / 100;
      const neededRemaining = Math.round(state.solved / target) - state.solved;
      const want = Math.max(2, Math.min(6, neededRemaining - state.remaining));
      messageModule(api, {
        title: 'Fortschrittsprüfung',
        steps: [
          { t: `Aktueller Fortschritt: ${before} %`, k: 'ok' },
          { t: 'Neue Vorschriften erkannt.', k: 'err', w: 1300 },
          { p: want },
          { fn: () => api.line(`Fortschritt neu berechnet: ${progressPct()} %`, 'official') }
        ]
      });
    }
  });

  register({
    id: 'kora', type: 'event', minSolved: 10, title: 'Akteneinsicht',
    run(api) {
      messageModule(api, {
        title: 'Akteneinsicht',
        steps: [
          { t: 'Kora hat deine Akte geöffnet.', k: 'official' },
          { t: '…', k: 'muted', w: 1400 },
          { t: 'Kora hat deine Akte wieder geschlossen.', k: 'official', w: 1400 },
          { t: 'Kommentar: „Später.“', k: 'muted' }
        ]
      });
    }
  });

  register({
    id: 'scusyStatus', type: 'event', minSolved: 22, title: 'Creator-Abteilung',
    cond: s => (s.counts.scusy || 0) > 0,
    run(api) {
      messageModule(api, {
        title: 'Statusmeldung der Creator-Abteilung',
        steps: [
          { t: 'Antrag „Creator+ (Scusy)“: weiterhin in Prüfung.', k: 'official' },
          { t: 'Aktuelle Position: #49.', k: 'muted' },
          { t: 'Nächste Prüfung voraussichtlich nach deiner Auszahlung.', k: 'muted' }
        ]
      });
    }
  });

  /* ------------------------------------------------------------------
     Start / Pause / Ende
     ------------------------------------------------------------------ */
  function start(context) {
    if (ctx) stopInternal();
    readTestMode();
    ctx = context;
    const all = loadAll();
    const saved = all[stateKey(context.investorName)];
    if (saved && saved.v === STATE_VERSION && saved.phase) {
      state = normalizeState(saved);
      installChrome();
      updateHeader();
      runModule('resume');
    } else {
      state = newState(context.investorName);
      save();
      installChrome();
      next();
    }
  }

  function stopInternal() {
    cleanupModule();
    uninstallChrome();
  }

  /* Echte Pause (Anti-Frust): Stand bleibt gespeichert, das aktuelle Modul
     wird beim naechsten Start wiederholt. */
  function pause() {
    if (!ctx) return;
    save();
    const c = ctx;
    stopInternal();
    ctx = null;
    state = null;
    if (typeof c.pause === 'function') c.pause();
  }

  /* Einziger Weg zum Rickroll: context.finish() -> bkmp-site.js
     finishInvestorSecurityCheck() -> triggerPrankReveal(). */
  function finish() {
    if (!ctx || !state) return;
    clearSaved(state.investor);
    const c = ctx;
    stopInternal();
    ctx = null;
    state = null;
    if (typeof c.finish === 'function') c.finish();
  }

  window.BkmpPayoutBureaucracy = {
    start,
    register,
    pause,
    modules: MODULES,
    /* Nur fuer Tests/Admin: gespeicherten Stand eines Investors entfernen. */
    resetSaved: name => clearSaved(name),
    _debug: {
      get state() { return state; },
      addCaptchas,
      runModule: id => runModule(id),
      get MAX_TOTAL() { return MAX_TOTAL; },
      get persist() { return persist; }
    }
  };
})();
