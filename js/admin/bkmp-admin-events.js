/* Event-Analyse im Admin-Panel ("📊 Events"), 05.10.2026.

   NUR ANSICHT - nichts in dieser Datei veraendert ein Event, einen Spieler, Punkte
   oder Belohnungen. Alle Zahlen kommen aus sechs Admin-Funktionen der Datenbank
   (sql/20261005-event-admin-stats.sql: admin_event_list/-overview/-quests/-timeline/
   -players/-player_detail). Diese pruefen selbst, ob der Aufrufer ein aktiver Admin
   ist - die Seite verbirgt also nicht nur Knoepfe, ein Nicht-Admin bekommt keine Daten.

   Generisch: Stufenzahl, Punkte je Stufe, Belohnungen, Quests und Auswahl-Belohnung
   stammen immer aus der Konfiguration des gewaehlten Events - nichts ist auf Zwielicht
   oder 30 Stufen festgelegt.

   Zeit: Berliner Kalendertage (Europe/Berlin), wie im Spiel. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const PAGE_ID = 'page-events';
  const PAGE_SIZE = 25;
  const AUTO_MS = 60000;
  const TZ = 'Europe/Berlin';

  const state = {
    events: [],
    eventId: null,
    overview: null,
    quests: null,
    timeline: null,
    players: null,
    loaded: false,
    loading: false,
    error: null,
    seq: 0,
    playersSeq: 0,
    lastUpdated: null,
    search: '',
    sort: 'points',
    dir: 'desc',
    page: 0,
    questSort: { key: 'rate', dir: 'asc' },
    onlyMilestones: false,
    searchTimer: null
  };

  /* ---------- kleine Helfer ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function isNum(n) { return n != null && n !== '' && Number.isFinite(Number(n)); }
  function num(n) { return isNum(n) ? Number(n).toLocaleString('de-DE', { maximumFractionDigits: 0 }) : '–'; }
  function dec(n, d) {
    if (!isNum(n)) return '–';
    const digits = d == null ? 1 : d;
    return Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function ratio(part, total) { return total > 0 ? part / total : null; }
  function pct(part, total, d) {
    const r = ratio(Number(part) || 0, Number(total) || 0);
    return r == null ? '–' : dec(r * 100, d == null ? 1 : d) + ' %';
  }
  const fmtDateTime = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtShort = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fmtTime = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtDay = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' });
  const fmtDayLong = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
  function dateTime(iso) { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? fmtDateTime.format(t) + ' Uhr' : '–'; }
  function shortTime(iso) { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? fmtShort.format(t) : '–'; }
  /* "2026-10-07" -> "Mi., 07.10." (Mittag UTC, damit keine Zeitzonen-Verschiebung moeglich ist) */
  function dayLabel(day) { const t = day ? Date.parse(day + 'T12:00:00Z') : NaN; return Number.isFinite(t) ? fmtDay.format(t) : '–'; }
  function dayLong(day) { const t = day ? Date.parse(day + 'T12:00:00Z') : NaN; return Number.isFinite(t) ? fmtDayLong.format(t) : '–'; }
  function duration(sec) {
    sec = Math.max(0, Math.floor(sec));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d > 0) return d + ' T ' + h + ' Std';
    if (h > 0) return h + ' Std ' + m + ' Min';
    return Math.max(1, m) + ' Min';
  }

  const STATUS = {
    LIVE: { label: 'Läuft', cls: 'live' },
    COMING_SOON: { label: 'Kommt bald', cls: 'soon' },
    ENDED: { label: 'Beendet', cls: 'ended' },
    ARCHIVED: { label: 'Archiviert', cls: 'archived' },
    HIDDEN: { label: 'Versteckt', cls: 'hidden' }
  };
  function statusBadge(status) {
    const s = STATUS[status] || { label: status || '?', cls: 'hidden' };
    return '<span class="aev-badge aev-badge-' + s.cls + '" data-testid="aev-status">' + esc(s.label) + '</span>';
  }
  const PLAYER_STATUS = {
    completed: { label: 'Abgeschlossen', cls: 'done' },
    active_today: { label: 'Heute aktiv', cls: 'live' },
    inactive: { label: 'Nicht heute', cls: 'ended' },
    started: { label: 'Gestartet (0 Punkte)', cls: 'hidden' }
  };

  function info(text) {
    return '<span class="aev-info" tabindex="0" role="button" aria-label="Erklärung" data-tip="' + esc(text) + '">i</span>';
  }

  /* ---------- Datenzugriff (nur die sechs Admin-Funktionen) ---------- */
  async function rpc(fn, args) {
    if (typeof bkmpGetSupabaseClient !== 'function') throw new Error('Supabase-Client nicht verfügbar');
    const client = bkmpGetSupabaseClient();
    if (!client) throw new Error('Supabase ist nicht eingerichtet');
    const res = await client.rpc(fn, args || {});
    if (res.error) throw res.error;
    return res.data;
  }
  function describeError(err) {
    const text = String((err && (err.message || err.details || err.hint)) || err || '');
    if (/not_admin/i.test(text)) return { kind: 'forbidden', text: 'Kein Zugriff: Die Event-Auswertung ist nur für Admin-Konten freigeschaltet.' };
    if (/invalid_event/i.test(text)) return { kind: 'event', text: 'Dieses Event gibt es nicht (mehr).' };
    if (/PGRST202|could not find the function|schema cache|does not exist/i.test(text)) {
      return { kind: 'missing', text: 'Die Event-Auswertung ist in der Datenbank noch nicht eingerichtet. Bitte sql/20261005-event-admin-stats.sql im Supabase-SQL-Editor ausführen.' };
    }
    return { kind: 'error', text: 'Laden fehlgeschlagen: ' + (text || 'unbekannter Fehler') };
  }

  /* ---------- Auswahl des Standard-Events ---------- */
  function pickDefaultEvent(list) {
    if (!list.length) return null;
    const live = list.find(e => e.status === 'LIVE');
    if (live) return live.id;
    const withPeople = list.filter(e => e.started > 0 && (e.status === 'ENDED' || e.status === 'ARCHIVED'));
    if (withPeople.length) return withPeople[0].id;      // Liste ist nach Startzeit absteigend sortiert -> zuletzt aktives zuerst
    const soon = list.find(e => e.status === 'COMING_SOON');
    return (soon || list[0]).id;
  }

  /* ---------- Laden ---------- */
  function root() { return document.getElementById(PAGE_ID); }
  function body() { return document.getElementById('aevBody'); }
  function pageActive() { const r = root(); return Boolean(r && r.classList.contains('active')); }

  async function load(options) {
    const opts = options || {};
    const seq = ++state.seq;
    state.loading = true;
    updateToolbar();
    try {
      if (!state.loaded || opts.reloadList !== false) {
        state.events = (await rpc('admin_event_list')) || [];
      }
      if (!state.eventId || !state.events.some(e => e.id === state.eventId)) state.eventId = pickDefaultEvent(state.events);
      if (seq !== state.seq) return;
      if (!state.eventId) {
        state.overview = state.quests = state.timeline = state.players = null;
        state.error = null; state.loaded = true; state.lastUpdated = Date.now();
        return;
      }
      const id = state.eventId;
      const [overview, quests, timeline, players] = await Promise.all([
        rpc('admin_event_overview', { p_event_id: id }),
        rpc('admin_event_quests', { p_event_id: id }),
        rpc('admin_event_timeline', { p_event_id: id }),
        fetchPlayers(id)
      ]);
      if (seq !== state.seq) return;      // zwischenzeitlich anderes Event gewaehlt / neu geladen
      state.overview = overview; state.quests = quests; state.timeline = timeline; state.players = players;
      state.error = null; state.loaded = true; state.lastUpdated = Date.now();
    } catch (err) {
      if (seq !== state.seq) return;
      state.error = describeError(err);
      state.loaded = true;
    } finally {
      if (seq === state.seq) { state.loading = false; updateToolbar(); render(); }
    }
  }

  function fetchPlayers(eventId) {
    return rpc('admin_event_players', {
      p_event_id: eventId, p_search: state.search, p_sort: state.sort, p_dir: state.dir,
      p_limit: PAGE_SIZE, p_offset: state.page * PAGE_SIZE
    });
  }
  /* nur die Spielertabelle neu laden (Suche/Sortierung/Seite) - der Rest der Seite bleibt stehen */
  async function loadPlayersOnly() {
    if (!state.eventId) return;
    const seq = ++state.playersSeq;
    const eventId = state.eventId;
    try {
      const res = await fetchPlayers(eventId);
      if (seq !== state.playersSeq || eventId !== state.eventId) return;
      const maxPage = Math.max(0, Math.ceil((res.total || 0) / PAGE_SIZE) - 1);
      if (state.page > maxPage) { state.page = maxPage; return loadPlayersOnly(); }
      state.players = res;
    } catch (err) {
      if (seq !== state.playersSeq) return;
      state.players = { error: describeError(err).text, total: 0, rows: [] };
    }
    renderPlayersTable();
  }

  /* ---------- Werkzeugleiste ---------- */
  function updateToolbar() {
    const sel = document.getElementById('aevEventSelect');
    const upd = document.getElementById('aevUpdated');
    const btn = document.getElementById('aevRefresh');
    if (sel) {
      const wanted = state.events.map(e => e.id + '|' + e.name + '|' + e.status).join(';');
      if (sel.dataset.sig !== wanted) {
        sel.dataset.sig = wanted;
        sel.innerHTML = state.events.length
          ? state.events.map(e => '<option value="' + esc(e.id) + '">' + esc(e.name) + ' · ' + esc((STATUS[e.status] || {}).label || e.status) + '</option>').join('')
          : '<option value="">Keine Events vorhanden</option>';
      }
      if (state.eventId) sel.value = state.eventId;
      sel.disabled = !state.events.length;
    }
    if (btn) { btn.disabled = state.loading; btn.textContent = state.loading ? 'Lädt …' : '↻ Aktualisieren'; }
    if (upd) {
      upd.textContent = state.lastUpdated
        ? 'Zuletzt aktualisiert: ' + fmtTime.format(state.lastUpdated)
        : (state.loading ? 'Wird geladen …' : 'Noch nicht geladen');
    }
  }

  let autoTimer = null;
  function setAuto(on) {
    if (autoTimer) { window.clearInterval(autoTimer); autoTimer = null; }
    if (!on) return;
    autoTimer = window.setInterval(() => {
      if (document.hidden || !pageActive() || state.loading) return;
      load({});
    }, AUTO_MS);
  }

  /* ---------- Rendering ---------- */
  function render() {
    const el = body();
    if (!el) return;
    if (state.error) {
      el.innerHTML = '<div class="aev-card aev-error" data-testid="aev-error"><strong>' + esc(state.error.text) + '</strong>'
        + (state.error.kind === 'forbidden' ? '' : '<p><button class="btn" id="aevRetry" type="button">Erneut versuchen</button></p>') + '</div>';
      return;
    }
    if (!state.loaded) { el.innerHTML = '<div class="aev-card aev-muted">Wird geladen …</div>'; return; }
    if (!state.events.length) {
      el.innerHTML = '<div class="aev-card aev-muted" data-testid="aev-empty">Es gibt noch kein Event in der Datenbank.</div>';
      return;
    }
    if (!state.overview) { el.innerHTML = '<div class="aev-card aev-muted">Wird geladen …</div>'; return; }
    const ov = state.overview;
    el.innerHTML = [
      renderHeader(ov),
      renderKpis(ov),
      renderHistogram(ov),
      renderMilestones(ov),
      renderChoice(ov),
      renderTimeline(),
      renderQuests(),
      renderRewards(ov),
      renderPlayersShell(),
      renderCompare(),
      renderLimits()
    ].join('');
    renderPlayersTable();
  }

  /* --- Kopf --- */
  function renderHeader(ov) {
    const e = ov.event;
    const now = Date.now();
    let timeLine = '';
    if (e.status === 'LIVE' && e.ends_at) timeLine = 'noch ' + duration((Date.parse(e.ends_at) - now) / 1000);
    else if (e.status === 'COMING_SOON' && e.starts_at) timeLine = 'startet in ' + duration((Date.parse(e.starts_at) - now) / 1000);
    else if ((e.status === 'ENDED' || e.status === 'ARCHIVED') && e.ends_at && Date.parse(e.ends_at) < now) timeLine = 'beendet vor ' + duration((now - Date.parse(e.ends_at)) / 1000);
    const facts = [
      ['Start', dateTime(e.starts_at)],
      ['Ende', dateTime(e.ends_at)],
      ['Stufen', num(e.tier_count)],
      ['Punkte je Stufe', num(e.points_per_tier)],
      ['Punkte bis zum Ziel', num(e.points_to_finish)],
      ['Maximal erreichbar (geschätzt)', isNum(e.theoretical_max_points) ? num(e.theoretical_max_points) : '–',
        'Geschätzt aus der Event-Konfiguration: Tage × (Tagesquests + schwere Quest + Tagesabschluss) + alle Wochenquest-Stufen. Nur eine Orientierung, keine garantierte Grenze.']
    ];
    return '<section class="aev-card aev-head" data-testid="aev-header">'
      + '<div class="aev-head-top"><div><h2 class="aev-title" data-testid="aev-title">' + esc(e.name) + '</h2>'
      + (e.subtitle ? '<div class="aev-sub">' + esc(e.subtitle) + '</div>' : '') + '</div>'
      + '<div class="aev-head-status">' + statusBadge(e.status) + (timeLine ? '<span class="aev-time" data-testid="aev-timeline-text">' + esc(timeLine) + '</span>' : '') + '</div></div>'
      + '<dl class="aev-facts">' + facts.map(f => '<div><dt>' + esc(f[0]) + (f[2] ? info(f[2]) : '') + '</dt><dd>' + esc(f[1]) + '</dd></div>').join('') + '</dl>'
      + '<div class="aev-id">Event-ID: ' + esc(e.id) + ' · Zeitzone: ' + esc(e.timezone || TZ) + '</div>'
      + '</section>';
  }

  /* --- KPI-Karten --- */
  function renderKpis(ov) {
    const k = ov.kpis, e = ov.event;
    const cards = [
      ['started', 'Teilnehmer gestartet', num(k.started), 'Spieler, die das Event geöffnet haben und deshalb einen Event-Eintrag besitzen (auch mit 0 Punkten).'],
      ['active', 'Aktiv teilnehmend', num(k.active), 'Spieler mit mindestens 1 Event-Punkt. Alle Durchschnitte und Anteile unten beziehen sich auf diese Gruppe.',
        k.started > 0 ? pct(k.active, k.started) + ' der Gestarteten' : ''],
      ['avg', 'Ø Stufe (aktive)', dec(k.avg_tier, 1), 'Durchschnitt der erreichten Stufe (Punkte ÷ Punkte je Stufe, höchstens die letzte Stufe) über alle aktiven Teilnehmer.',
        isNum(k.avg_tier) ? 'von ' + num(e.tier_count) + ' Stufen' : ''],
      ['median', 'Median-Stufe', dec(k.median_tier, 1), 'Die mittlere Stufe: Die Hälfte der aktiven Teilnehmer liegt darüber, die Hälfte darunter. Weniger anfällig für Ausreißer als der Durchschnitt.'],
      ['completed', 'Abgeschlossen', num(k.completed), 'Spieler, die die letzte Stufe erreicht haben. Die Quote bezieht sich auf die aktiven Teilnehmer.',
        k.active > 0 ? pct(k.completed, k.active) + ' der Aktiven' : ''],
      ['max', 'Höchste Stufe', num(k.max_tier), 'Die höchste Stufe, die ein einzelner Spieler erreicht hat.'],
      ['today', 'Heute aktiv', k.active_today == null ? '–' : num(k.active_today),
        'Spieler, die heute (Berliner Kalendertag) das Event aktualisiert haben. Nur bei einem laufenden Event verfügbar - sonst bewusst leer, nichts wird geschätzt.',
        k.active_today == null ? 'nur bei laufendem Event' : ''],
      ['points', 'Gesamtpunkte', num(k.total_points), 'Summe aller Event-Punkte aller Teilnehmer.']
    ];
    return '<section class="aev-card"><h3 class="aev-h3">Kennzahlen</h3><div class="aev-kpis">'
      + cards.map(c => '<div class="aev-kpi" data-testid="aev-kpi-' + c[0] + '"><div class="aev-kpi-label">' + esc(c[1]) + info(c[3]) + '</div>'
        + '<div class="aev-kpi-value">' + esc(c[2]) + '</div>' + (c[4] ? '<div class="aev-kpi-sub">' + esc(c[4]) + '</div>' : '') + '</div>').join('')
      + '</div></section>';
  }

  /* --- Stufenverteilung --- */
  function milestoneSet(ov) {
    const set = new Set();
    (ov.event.tier_rewards || []).forEach(t => {
      const r = t && t.reward;
      if (r && (r.species_eggs || r.choice || r.unlock)) set.add(Number(t.tier));
    });
    return set;
  }
  function renderHistogram(ov) {
    const hist = ov.histogram || [];
    const active = hist.reduce((s, x) => s + x.count, 0);
    const max = Math.max(1, ...hist.map(x => x.count));
    const ms = milestoneSet(ov);
    const step = hist.length > 60 ? 10 : hist.length > 25 ? 5 : 1;
    const bars = hist.map(x => {
      const h = x.count > 0 ? Math.max(4, Math.round(x.count / max * 100)) : 0;
      const label = 'Stufe ' + x.tier + ': ' + x.count + (x.count === 1 ? ' Spieler' : ' Spieler') + (active > 0 ? ' (' + pct(x.count, active) + ' der Aktiven)' : '');
      return '<button type="button" class="aev-bar' + (ms.has(x.tier) ? ' ms' : '') + (x.count ? '' : ' zero') + '" data-testid="aev-bar-' + x.tier + '" data-tier="' + x.tier + '" data-count="' + x.count
        + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"><span class="aev-bar-fill" style="height:' + h + '%"></span></button>';
    }).join('');
    const axis = hist.map(x => '<span class="aev-axis-tick">' + (x.tier % step === 0 || x.tier === hist.length - 1 ? x.tier : '') + '</span>').join('');
    return '<section class="aev-card"><h3 class="aev-h3">Stufenverteilung' + info('Wie viele aktive Teilnehmer aktuell auf welcher Stufe stehen (Stufe 0 = Punkte vorhanden, aber unter der ersten Stufe). Mit der Maus darüberfahren oder antippen für die genaue Zahl. Goldene Markierung = Meilensteinstufe.') + '</h3>'
      + '<div class="aev-hist" data-testid="aev-histogram" style="--aev-n:' + hist.length + '">' + bars + '</div>'
      + '<div class="aev-axis" style="--aev-n:' + hist.length + '">' + axis + '</div>'
      + '<div class="aev-readout" id="aevHistReadout" data-testid="aev-hist-readout" aria-live="polite">'
      + (active > 0 ? 'Stufe antippen oder mit der Maus darüberfahren · ' + num(active) + ' aktive Teilnehmer' : 'Noch keine aktiven Teilnehmer.') + '</div></section>';
  }

  /* --- Belohnungstexte --- */
  function describeReward(r) {
    if (!r || typeof r !== 'object') return '–';
    if (r.label) return String(r.label);
    const parts = [];
    if (r.gold_units) parts.push(num(r.gold_units) + ' Gold-Einheiten');
    if (r.wood) parts.push(num(r.wood) + ' Holz');
    if (r.stone) parts.push(num(r.stone) + ' Stein');
    if (r.crystals) parts.push(num(r.crystals) + ' Kristalle');
    if (r.essence) parts.push(num(r.essence) + ' Essenz');
    if (r.fruit) parts.push(num(r.fruit) + ' Früchte');
    if (r.meat) parts.push(num(r.meat) + ' Fleisch');
    if (r.eggs) parts.push(num(r.eggs) + '× Drachenei');
    if (Array.isArray(r.runes)) r.runes.forEach(x => parts.push((x.count || 1) + '× Rune' + (x.tier != null ? ' (Stufe ' + x.tier + ')' : '')));
    if (Array.isArray(r.species_eggs) && r.species_eggs.length) parts.push('Ei: ' + r.species_eggs.join(', '));
    if (Array.isArray(r.boosts)) r.boosts.forEach(b => parts.push(b === 'gold' ? '30 Min. Goldrausch' : b === 'exp' ? '30 Min. Wissensschub' : 'Boost: ' + b));
    if (r.unlock) parts.push('Freischaltung: ' + r.unlock);
    if (r.choice) parts.push('Auswahl-Belohnung');
    // Unbekannte Belohnungsarten eines kuenftigen Events werden NIE als "–" verschluckt, sondern roh angezeigt.
    const KNOWN = { label: 1, tier: 1, gold_units: 1, wood: 1, stone: 1, crystals: 1, essence: 1, fruit: 1, meat: 1, eggs: 1, runes: 1, species_eggs: 1, boosts: 1, unlock: 1, choice: 1 };
    Object.keys(r).forEach(k => {
      if (KNOWN[k]) return;
      const v = r[k];
      if (v == null || v === false || v === 0 || v === '') return;
      parts.push(k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
    });
    return parts.length ? parts.join(' · ') : '–';
  }

  /* --- Meilensteine --- */
  function renderMilestones(ov) {
    const e = ov.event;
    const rows = (e.tier_rewards || []).filter(t => t && t.reward && (t.reward.species_eggs || t.reward.choice || t.reward.unlock));
    if (!rows.length) return '';
    const active = ov.kpis.active;
    const chosen = ov.choice && ov.choice.enabled ? (ov.choice.species || []).reduce((s, x) => s + x.count, 0) : 0;
    const cards = rows.map(t => {
      const stat = (ov.tiers || []).find(x => x.tier === Number(t.tier)) || { reached: 0, claimed: 0 };
      const isChoice = Boolean(t.reward.choice);
      const claimRate = stat.reached > 0 ? Math.min(1, stat.claimed / stat.reached) : null;
      return '<div class="aev-ms" data-testid="aev-milestone-' + t.tier + '">'
        + '<div class="aev-ms-tier">Stufe ' + num(t.tier) + '</div>'
        + '<div class="aev-ms-reward">' + esc(describeReward(t.reward)) + '</div>'
        + '<div class="aev-ms-row"><span>Erreicht</span><strong>' + num(stat.reached) + '</strong><em>' + pct(stat.reached, active) + ' der Aktiven</em></div>'
        + '<div class="aev-ms-row"><span>Abgeholt</span><strong>' + num(stat.claimed) + '</strong><em>' + (claimRate == null ? '–' : dec(claimRate * 100, 1) + ' % der Erreichten') + '</em></div>'
        + (isChoice ? '<div class="aev-ms-row"><span>Auswahl getroffen</span><strong>' + num(chosen) + '</strong><em>' + (stat.reached > 0 ? pct(chosen, stat.reached) + ' der Erreichten' : '–') + '</em></div>' : '')
        + '<div class="aev-meter" aria-hidden="true"><span style="width:' + (claimRate == null ? 0 : Math.round(claimRate * 100)) + '%"></span></div>'
        + '</div>';
    }).join('');
    return '<section class="aev-card"><h3 class="aev-h3">Meilensteine' + info('Automatisch aus der Event-Konfiguration erkannt: alle Stufen mit Drachen-Ei, Freischaltung oder Auswahl-Belohnung. "Erreicht" heißt, die Stufe ist durch Punkte erreicht. "Abgeholt" heißt, der Spieler hat die Belohnung tatsächlich eingesammelt - beides ist nicht dasselbe.') + '</h3>'
      + '<div class="aev-ms-grid">' + cards + '</div></section>';
  }

  /* --- Auswahl-Belohnung --- */
  function renderChoice(ov) {
    const c = ov.choice;
    if (!c || !c.enabled) return '';
    const cfg = ov.event.choices || {};
    const species = c.species || [];
    const total = species.reduce((s, x) => s + x.count, 0);
    const max = Math.max(1, ...species.map(x => x.count));
    const rows = species.map(s => {
      const def = cfg[s.id] || {};
      const name = def.name || s.name || s.id;
      return '<div class="aev-choice-row" data-testid="aev-choice-' + esc(s.id) + '">'
        + '<div class="aev-choice-name">' + (def.icon ? '<span class="aev-choice-icon">' + esc(def.icon) + '</span>' : '') + esc(name) + '</div>'
        + '<div class="aev-choice-bar"><span style="width:' + Math.round(s.count / max * 100) + '%"></span></div>'
        + '<div class="aev-choice-val"><strong>' + num(s.count) + '</strong><em>' + (total > 0 ? pct(s.count, total) : '–') + '</em></div></div>';
    }).join('');
    return '<section class="aev-card"><h3 class="aev-h3">Auswahl-Belohnung' + info('Welche Drachenart die Spieler gewählt haben, die den Auswahl-Meilenstein erreicht haben. Die Prozent beziehen sich auf alle, die bereits gewählt haben. "Entscheidung offen" = Stufe erreicht, noch nichts gewählt.') + '</h3>'
      + rows
      + '<div class="aev-choice-sum" data-testid="aev-choice-summary"><span>Stufe erreicht: <strong>' + num(c.earned) + '</strong></span>'
      + '<span>Gewählt: <strong>' + num(total) + '</strong></span>'
      + '<span class="aev-open">Entscheidung offen: <strong data-testid="aev-choice-open">' + num(c.open) + '</strong></span></div></section>';
  }

  /* --- Tagesentwicklung --- */
  function renderTimeline() {
    const t = state.timeline;
    if (!t) return '';
    const days = t.days || [];
    if (!days.length) {
      return '<section class="aev-card"><h3 class="aev-h3">Entwicklung pro Tag</h3><div class="aev-muted">Für dieses Event gibt es (noch) keine Tage zum Anzeigen.</div></section>';
    }
    const today = t.berlin_today;
    const notes = [];
    if (t.stats_since_day) {
      notes.push('Das Tagesprotokoll läuft seit <strong>' + esc(dayLong(t.stats_since_day)) + '</strong>. Für frühere Tage sind nur neue Teilnehmer, Abschlüsse und Auswahlen bekannt; "Aktive", Punkte und Ø Stufe lassen sich dort nicht rückwirkend ermitteln (<em>–</em>).');
    }
    if (t.unknown_join_count > 0) {
      notes.push(num(t.unknown_join_count) + (t.unknown_join_count === 1 ? ' Spieler hat' : ' Spieler haben') + ' einen unbekannten Beitrittstag (vor dem Statistikstart beigetreten) und '
        + (t.unknown_join_count === 1 ? 'fehlt' : 'fehlen') + ' bei "Neue Teilnehmer".');
    }
    const series = [
      { key: 'new_participants', label: 'Neue Teilnehmer', cls: 's1' },
      { key: 'active', label: 'Aktive Spieler', cls: 's2', onlyTracked: true },
      { key: 'completed', label: 'Abgeschlossen', cls: 's3' }
    ];
    const W = 640, H = 220, padL = 34, padR = 12, padT = 12, padB = 34;
    const maxV = Math.max(1, ...days.map(d => Math.max(d.new_participants || 0, d.tracked ? d.active || 0 : 0, d.completed || 0)));
    const n = days.length;
    const x = i => n === 1 ? (padL + (W - padL - padR) / 2) : padL + (W - padL - padR) * i / (n - 1);
    const y = v => padT + (H - padT - padB) * (1 - v / maxV);
    const grid = [0, 0.5, 1].map(f => { const v = Math.round(maxV * f); return '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="aev-grid"/><text x="' + (padL - 6) + '" y="' + (y(v) + 4) + '" class="aev-ylab" text-anchor="end">' + v + '</text>'; }).join('');
    const lines = series.map(s => {
      const pts = days.map((d, i) => (s.onlyTracked && !d.tracked) ? null : [x(i), y(d[s.key] || 0), i]);
      const segs = []; let cur = [];
      pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
      if (cur.length) segs.push(cur);
      return segs.map(seg => '<polyline class="aev-line ' + s.cls + '" points="' + seg.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/>').join('')
        + pts.filter(Boolean).map(p => '<circle class="aev-dot ' + s.cls + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5"/>').join('');
    }).join('');
    const labStep = n > 14 ? Math.ceil(n / 10) : 1;
    const xlabs = days.map((d, i) => (i % labStep === 0 || i === n - 1) ? '<text x="' + x(i).toFixed(1) + '" y="' + (H - 12) + '" class="aev-xlab" text-anchor="middle">' + esc(dayLabel(d.day)) + '</text>' : '').join('');
    const hits = days.map((d, i) => '<rect class="aev-hit" data-i="' + i + '" x="' + (x(i) - (W - padL - padR) / Math.max(1, n - 1) / 2).toFixed(1) + '" y="' + padT + '" width="' + ((W - padL - padR) / Math.max(1, n - 1)).toFixed(1) + '" height="' + (H - padT - padB) + '"/>').join('');
    const legend = series.map(s => '<span class="aev-legend-item"><i class="aev-legend-dot ' + s.cls + '"></i>' + esc(s.label) + '</span>').join('');
    const na = '<span class="aev-na" title="Vor dem Statistikstart nicht rückwirkend ermittelbar">–</span>';
    const rows = days.map(d => '<tr' + (d.day === today ? ' class="aev-today"' : '') + ' data-testid="aev-day-' + esc(d.day) + '">'
      + '<td>' + esc(dayLabel(d.day)) + (d.day === today ? ' <em>(läuft)</em>' : '') + '</td>'
      + '<td class="r">' + num(d.new_participants) + '</td>'
      + '<td class="r">' + (d.tracked ? num(d.active) : na) + '</td>'
      + '<td class="r">' + num(d.completed) + '</td>'
      + '<td class="r">' + num(d.choices) + '</td>'
      + '<td class="r">' + (d.tracked ? num(d.total_points) : na) + '</td>'
      + '<td class="r">' + (d.tracked ? dec(d.avg_tier, 1) : na) + '</td></tr>').join('');
    return '<section class="aev-card"><h3 class="aev-h3">Entwicklung pro Tag' + info('Berliner Kalendertage. Neue Teilnehmer, Abschlüsse und Auswahlen sind exakt aus den Zeitstempeln ableitbar. Aktive Spieler, Punkte und Ø Stufe stammen aus dem Tagesprotokoll (Stand am Tagesende) und sind erst ab dem Statistikstart vollständig.') + '</h3>'
      + (notes.length ? '<div class="aev-note" data-testid="aev-timeline-note">' + notes.map(x => '<p>' + x + '</p>').join('') + '</div>' : '')
      + '<div class="aev-legend">' + legend + '</div>'
      + '<div class="aev-chart-wrap"><svg class="aev-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Entwicklung pro Tag" data-testid="aev-timeline-chart">' + grid + lines + xlabs + hits + '</svg></div>'
      + '<div class="aev-readout" id="aevTlReadout" data-testid="aev-tl-readout" aria-live="polite">Tag antippen oder mit der Maus darüberfahren für die genauen Zahlen.</div>'
      + '<div class="aev-table-wrap"><table class="aev-table" data-testid="aev-day-table"><thead><tr><th>Tag</th><th class="r">Neue Teilnehmer</th><th class="r">Aktive</th><th class="r">Abgeschlossen</th><th class="r">Auswahl</th><th class="r">Punkte gesamt</th><th class="r">Ø Stufe</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  /* --- Quests --- */
  function questName(id, defs) {
    const all = [].concat(defs.daily_normal || [], defs.daily_hard || [], defs.weekly || [], defs.weekly_alts || []);
    const d = all.find(q => q && q.id === id);
    return d && d.name ? d.name : id;
  }
  function questTarget(id, defs) {
    const all = [].concat(defs.daily_normal || [], defs.daily_hard || [], defs.weekly || [], defs.weekly_alts || []);
    const d = all.find(q => q && q.id === id);
    return d && d.target ? 'Ziel: ' + num(d.target) : '';
  }
  function sortRows(rows, sort) {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = r => sort.key === 'name' ? r._name.toLowerCase() : sort.key === 'assigned' ? r.assigned : sort.key === 'completed' ? r.completed
      : sort.key === 'today' ? (r.today_assigned > 0 ? r.today_completed / r.today_assigned : -1) : (r.assigned > 0 ? r.completed / r.assigned : -1);
    return rows.slice().sort((a, b) => { const x = val(a), y = val(b); return x < y ? -dir : x > y ? dir : a._name.localeCompare(b._name); });
  }
  function questTable(title, rows, defs, testid) {
    if (!rows.length) return '<div class="aev-sub-title">' + esc(title) + '</div><div class="aev-muted">Noch keine Daten.</div>';
    rows = sortRows(rows.map(r => Object.assign({ _name: questName(r.id, defs) }, r)), state.questSort);
    const th = (key, label, cls) => '<th class="' + (cls || '') + '"><button type="button" class="aev-sort' + (state.questSort.key === key ? ' on ' + state.questSort.dir : '') + '" data-qsort="' + key + '">' + label + '</button></th>';
    return '<div class="aev-sub-title">' + esc(title) + '</div><div class="aev-table-wrap"><table class="aev-table" data-testid="' + testid + '"><thead><tr>'
      + th('name', 'Aufgabe') + th('assigned', 'Vergeben', 'r') + th('completed', 'Abgeschlossen', 'r') + th('rate', 'Abschlussquote', 'r') + th('today', 'Heute', 'r') + '</tr></thead><tbody>'
      + rows.map(r => {
        const rate = ratio(r.completed, r.assigned);
        return '<tr data-testid="aev-quest-' + esc(r.id) + '"><td>' + esc(r._name) + '<small>' + esc(questTarget(r.id, defs)) + '</small></td>'
          + '<td class="r">' + num(r.assigned) + '</td><td class="r">' + num(r.completed) + '</td>'
          + '<td class="r"><span class="aev-rate">' + (rate == null ? '–' : dec(rate * 100, 1) + ' %') + '</span><span class="aev-meter sm" aria-hidden="true"><span style="width:' + Math.round((rate || 0) * 100) + '%"></span></span></td>'
          + '<td class="r">' + (r.today_assigned > 0 ? num(r.today_completed) + ' / ' + num(r.today_assigned) + ' (' + pct(r.today_completed, r.today_assigned, 0) + ')' : '–') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function renderQuests() {
    const q = state.quests;
    if (!q) return '';
    const defs = q.defs || {};
    const normal = (q.daily || []).filter(r => r.kind !== 'hard');
    const hard = (q.daily || []).filter(r => r.kind === 'hard');
    const clo = q.closure || { assigned: 0, completed: 0 };
    const cdef = defs.closure || {};
    const closureHtml = '<div class="aev-sub-title">' + esc(cdef.name || 'Tagesabschluss') + (cdef.need ? ' <small>(' + num(cdef.need) + ' Aufgaben erledigen)</small>' : '') + '</div>'
      + '<div class="aev-closure" data-testid="aev-closure"><span>Vergeben: <strong>' + num(clo.assigned) + '</strong></span><span>Abgeschlossen: <strong>' + num(clo.completed) + '</strong></span><span>Quote: <strong>' + pct(clo.completed, clo.assigned) + '</strong></span></div>';
    const weekly = q.weekly || [];
    const stageMax = Math.max(0, ...weekly.map(w => w.stage_count || 0));
    const weeklyHtml = weekly.length
      ? '<div class="aev-sub-title">Wochenquests</div><div class="aev-table-wrap"><table class="aev-table" data-testid="aev-weekly-table"><thead><tr><th>Aufgabe</th><th class="r">Spieler</th>'
        + Array.from({ length: stageMax }, (_, i) => '<th class="r">Stufe ' + (i + 1) + '</th>').join('') + '<th class="r">Alle Stufen</th></tr></thead><tbody>'
        + weekly.map(w => '<tr data-testid="aev-weekly-' + esc(w.id) + '"><td>' + esc(questName(w.id, defs)) + '</td><td class="r">' + num(w.players) + '</td>'
          + Array.from({ length: stageMax }, (_, i) => '<td class="r">' + (i < (w.stage_count || 0) ? num((w.stages || [])[i] || 0) + ' <small>' + pct((w.stages || [])[i] || 0, w.players, 0) + '</small>' : '–') + '</td>').join('')
          + '<td class="r">' + num(w.completed) + ' <small>' + pct(w.completed, w.players, 0) + '</small></td></tr>').join('') + '</tbody></table></div>'
      : '<div class="aev-sub-title">Wochenquests</div><div class="aev-muted">Noch keine Daten.</div>';
    return '<section class="aev-card"><h3 class="aev-h3">Quests' + info('"Vergeben" zählt eine Aufgabe bei einem Spieler an einem Tag, an dem er das Event geöffnet hat. Die Abschlussquote ist abgeschlossen ÷ vergeben. Standardmäßig steht die Aufgabe mit der niedrigsten Quote oben - dort stimmt vermutlich das Ziel oder die Verteilung nicht.') + '</h3>'
      + questTable('Tagesquests', normal, defs, 'aev-daily-table')
      + questTable('Schwere Tagesquest', hard, defs, 'aev-hard-table')
      + closureHtml + weeklyHtml + '</section>';
  }

  /* --- Belohnungsanalyse --- */
  function renderRewards(ov) {
    const e = ov.event;
    const ms = milestoneSet(ov);
    const rewardOf = new Map((e.tier_rewards || []).map(t => [Number(t.tier), t.reward]));
    const rows = (ov.tiers || []).filter(t => !state.onlyMilestones || ms.has(t.tier));
    const active = ov.kpis.active;
    return '<section class="aev-card"><h3 class="aev-h3">Belohnungsanalyse' + info('Pro Stufe: wie viele sie erreicht haben und wie viele die Belohnung wirklich abgeholt haben. Die Abholquote = abgeholt ÷ erreicht.') + '</h3>'
      + '<label class="aev-check"><input type="checkbox" id="aevOnlyMs"' + (state.onlyMilestones ? ' checked' : '') + '> nur Meilensteine zeigen</label>'
      + '<div class="aev-table-wrap aev-tall"><table class="aev-table" data-testid="aev-reward-table"><thead><tr><th>Stufe</th><th>Belohnung</th><th class="r">Erreicht</th><th class="r">Abgeholt</th><th class="r">Abholquote</th></tr></thead><tbody>'
      + (rows.length ? rows.map(t => {
        const rate = t.reached > 0 ? Math.min(1, t.claimed / t.reached) : null;
        return '<tr class="' + (ms.has(t.tier) ? 'aev-ms-row-hl' : '') + '" data-testid="aev-reward-' + t.tier + '"><td>' + num(t.tier) + '</td><td>' + esc(describeReward(rewardOf.get(t.tier))) + '</td>'
          + '<td class="r">' + num(t.reached) + ' <small>' + pct(t.reached, active, 0) + '</small></td><td class="r">' + num(t.claimed) + '</td>'
          + '<td class="r">' + (rate == null ? '–' : dec(rate * 100, 1) + ' %') + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="aev-muted">Keine Stufen.</td></tr>')
      + '</tbody></table></div></section>';
  }

  /* --- Spielertabelle --- */
  function renderPlayersShell() {
    return '<section class="aev-card"><h3 class="aev-h3">Spieler' + info('Nur Ansicht. Suche nach Name; Klick auf eine Spaltenüberschrift sortiert; Klick auf eine Zeile öffnet die Einzelansicht. Pro Seite werden 25 Spieler geladen.') + '</h3>'
      + '<div class="aev-players-tools"><input type="search" id="aevSearch" data-testid="aev-search" placeholder="Spieler suchen …" value="' + esc(state.search) + '" autocomplete="off" aria-label="Spieler suchen"></div>'
      + '<div id="aevPlayersTable" data-testid="aev-players"></div></section>';
  }
  const PLAYER_COLS = [
    ['name', 'Spieler'], ['tier', 'Stufe', 'r'], ['points', 'Punkte', 'r'], [null, 'Heute', 'r'], ['last', 'Letzte Aktivität'],
    ['daily', 'Daily', 'r'], ['weekly', 'Weekly', 'r'], ['claimed', 'Höchste abgeholt', 'r'], [null, 'Auswahl'], [null, 'Status']
  ];
  function renderPlayersTable() {
    const box = document.getElementById('aevPlayersTable');
    if (!box) return;
    const res = state.players;
    const ov = state.overview;
    if (!res) { box.innerHTML = '<div class="aev-muted">Wird geladen …</div>'; return; }
    if (res.error) { box.innerHTML = '<div class="aev-error"><strong>' + esc(res.error) + '</strong></div>'; return; }
    const choice = ov && ov.choice && ov.choice.enabled;
    const cfg = (ov && ov.event.choices) || {};
    const nameOf = id => (cfg[id] && cfg[id].name) || ((ov && ov.choice.species.find(s => s.id === id)) || {}).name || id;
    const total = res.total || 0;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const head = '<tr>' + PLAYER_COLS.map(c => c[0]
      ? '<th class="' + (c[2] || '') + '"><button type="button" class="aev-sort' + (state.sort === c[0] ? ' on ' + state.dir : '') + '" data-psort="' + c[0] + '">' + c[1] + '</button></th>'
      : '<th class="' + (c[2] || '') + '">' + c[1] + '</th>').join('') + '</tr>';
    const rows = (res.rows || []).map(r => {
      const st = PLAYER_STATUS[r.status] || { label: r.status, cls: 'hidden' };
      const sel = r.choice_species ? esc(nameOf(r.choice_species)) : (choice && r.status === 'completed' ? '<em class="aev-open">offen</em>' : '–');
      return '<tr class="aev-player-row" tabindex="0" data-testid="aev-player-row" data-uid="' + esc(r.auth_user_id) + '">'
        + '<td>' + esc(r.name) + '</td><td class="r">' + num(r.tier) + '</td><td class="r">' + num(r.points) + '</td>'
        + '<td class="r">' + (r.today_total != null ? num(r.today_done) + ' / ' + num(r.today_total) : '–') + '</td>'
        + '<td title="' + esc(dateTime(r.last_tick_at)) + '">' + esc(r.last_tick_at ? shortTime(r.last_tick_at) : '–') + '</td>'
        + '<td class="r">' + num(r.daily_done) + '</td><td class="r">' + (r.weekly_total ? num(r.weekly_done) + ' / ' + num(r.weekly_total) : '–') + '</td>'
        + '<td class="r">' + (r.max_claimed != null ? num(r.max_claimed) : '–') + '</td><td>' + sel + '</td>'
        + '<td><span class="aev-badge aev-badge-' + st.cls + '">' + esc(st.label) + '</span></td></tr>';
    }).join('');
    const from = total ? state.page * PAGE_SIZE + 1 : 0, to = Math.min(total, (state.page + 1) * PAGE_SIZE);
    box.innerHTML = '<div class="aev-table-wrap"><table class="aev-table aev-players-table"><thead>' + head + '</thead><tbody>'
      + (rows || '<tr><td colspan="10" class="aev-muted">' + (state.search ? 'Kein Spieler gefunden.' : 'Noch keine Teilnehmer.') + '</td></tr>') + '</tbody></table></div>'
      + '<div class="aev-pager" data-testid="aev-pager"><span data-testid="aev-pager-info">' + (total ? num(from) + '–' + num(to) + ' von ' + num(total) : '0 Spieler') + '</span>'
      + '<span class="aev-pager-btns"><button class="btn" type="button" data-page-step="-1"' + (state.page <= 0 ? ' disabled' : '') + '>‹ Zurück</button>'
      + '<span data-testid="aev-page-label">Seite ' + (state.page + 1) + ' / ' + pages + '</span>'
      + '<button class="btn" type="button" data-page-step="1"' + (state.page + 1 >= pages ? ' disabled' : '') + '>Weiter ›</button></span></div>';
  }

  /* --- Einzelansicht (nur lesen) --- */
  async function openPlayer(uid) {
    if (!state.eventId) return;
    closePlayer();
    const overlay = document.createElement('div');
    overlay.className = 'aev-modal-overlay';
    overlay.id = 'aevModal';
    overlay.innerHTML = '<div class="aev-modal" role="dialog" aria-modal="true" aria-label="Spieler-Einzelansicht" data-testid="aev-detail"><button type="button" class="aev-modal-close" data-aev-close aria-label="Schließen">✕</button><div class="aev-modal-body"><div class="aev-muted">Wird geladen …</div></div></div>';
    document.body.appendChild(overlay);
    if (typeof bkmpUiTrapFocus === 'function') bkmpUiTrapFocus(overlay);
    const closeBtn = overlay.querySelector('[data-aev-close]');
    if (closeBtn) closeBtn.focus();
    const target = overlay.querySelector('.aev-modal-body');
    try {
      const d = await rpc('admin_event_player_detail', { p_event_id: state.eventId, p_auth_user_id: uid });
      if (!document.getElementById('aevModal')) return;
      target.innerHTML = renderDetail(d);
    } catch (err) {
      target.innerHTML = '<div class="aev-error"><strong>' + esc(describeError(err).text) + '</strong></div>';
    }
  }
  function closePlayer() { const m = document.getElementById('aevModal'); if (m) m.remove(); }

  function renderDetail(d) {
    if (!d || d.found === false) return '<div class="aev-muted">Dieser Spieler hat im Event keinen Eintrag.</div>';
    const ov = state.overview, defs = (state.quests && state.quests.defs) || {};
    const claimed = new Set((d.tier_claimed || []).map(Number));
    const reachedNotClaimed = [];
    for (let t = 1; t <= d.tier; t++) if (!claimed.has(t)) reachedNotClaimed.push(t);
    const cfg = (ov && ov.event.choices) || {};
    const choiceName = d.choice_species ? ((cfg[d.choice_species] && cfg[d.choice_species].name) || d.choice_species) : null;
    const quests = (d.day_quests || []).map(q => '<li class="' + (q.done ? 'done' : '') + '"><span>' + (q.done ? '✓' : '○') + '</span> ' + esc(questName(q.id, defs))
      + ' <small>' + esc(q.kind === 'hard' ? 'schwer' : 'normal') + (q.target ? ' · Ziel ' + num(q.target) : '') + (q.points ? ' · ' + num(q.points) + ' Pkt.' : '') + '</small></li>').join('');
    const weekly = (d.weekly_quests || []).map(q => {
      const done = Math.min((d.weekly_done || {})[q.id] || 0, (q.stages || []).length);
      return '<li><strong>' + esc(questName(q.id, defs)) + '</strong> <small>Stufe ' + done + ' / ' + (q.stages || []).length + '</small></li>';
    }).join('');
    const history = (d.history || []).map(h => '<tr><td>' + esc(dayLabel(h.day)) + '</td><td class="r">' + num(h.done) + ' / ' + num(h.total) + '</td><td class="r">' + (h.closure_done ? '✓' : '–') + '</td><td class="r">' + num(h.points_end) + '</td></tr>').join('');
    const cum = Object.keys(d.cumulative || {}).sort().map(k => '<tr><td>' + esc(k) + '</td><td class="r">' + num(d.cumulative[k]) + '</td></tr>').join('');
    const facts = [
      ['Punkte', num(d.points)], ['Stufe', num(d.tier) + ' / ' + num(d.tier_count)],
      ['Höchste abgeholte Stufe', claimed.size ? num(Math.max(...claimed)) : '–'],
      ['Beigetreten', d.joined_day ? dayLong(d.joined_day) : 'unbekannt'],
      ['Letzte Aktivität', dateTime(d.last_tick_at)],
      ['Letzter Event-Tag', d.day_key ? dayLong(d.day_key) + (d.is_today ? ' (heute)' : '') : '–'],
      ['Stufenziel erreicht', d.earned ? 'ja' + (d.earned_at ? ' · ' + dateTime(d.earned_at) : '') : 'nein'],
      ['Auswahl', choiceName ? esc(choiceName) + (d.chosen_at ? ' · ' + dateTime(d.chosen_at) : '') : (d.earned ? 'offen' : '–')]
    ];
    return '<h3 class="aev-modal-title">' + esc(d.name) + '</h3><div class="aev-sub">Nur Ansicht - hier kann nichts verändert werden.</div>'
      + '<div class="aev-meter lg" aria-hidden="true"><span style="width:' + Math.round(Math.min(1, d.tier / Math.max(1, d.tier_count)) * 100) + '%"></span></div>'
      + '<dl class="aev-facts">' + facts.map(f => '<div><dt>' + esc(f[0]) + '</dt><dd>' + (f[0] === 'Auswahl' ? f[1] : esc(f[1])) + '</dd></div>').join('') + '</dl>'
      + (reachedNotClaimed.length ? '<div class="aev-note"><p>Erreicht, aber noch nicht abgeholt: Stufe ' + esc(reachedNotClaimed.join(', ')) + '</p></div>' : '')
      + '<div class="aev-sub-title">Heutige Aufgaben' + (d.is_today ? '' : ' <small>(zuletzt: ' + esc(d.day_key ? dayLabel(d.day_key) : '–') + ')</small>') + (d.day_closure_done ? ' <small>· Tagesabschluss ✓</small>' : '') + '</div>'
      + (quests ? '<ul class="aev-qlist">' + quests + '</ul>' : '<div class="aev-muted">Keine Aufgaben gespeichert.</div>')
      + '<div class="aev-sub-title">Wochenaufgaben</div>' + (weekly ? '<ul class="aev-qlist">' + weekly + '</ul>' : '<div class="aev-muted">Keine Wochenaufgaben gespeichert.</div>')
      + '<div class="aev-sub-title">Frühere Tage</div>' + (history ? '<div class="aev-table-wrap"><table class="aev-table"><thead><tr><th>Tag</th><th class="r">Aufgaben</th><th class="r">Abschluss</th><th class="r">Punkte am Tagesende</th></tr></thead><tbody>' + history + '</tbody></table></div>' : '<div class="aev-muted">Noch kein Tagesprotokoll für diesen Spieler.</div>')
      + (cum ? '<details class="aev-details"><summary>Gesammelte Zähler im Event</summary><table class="aev-table"><tbody>' + cum + '</tbody></table></details>' : '');
  }

  /* --- Vergleich (nur bei mindestens zwei Events mit Teilnehmern) --- */
  function renderCompare() {
    const list = state.events.filter(e => e.started > 0);
    if (list.length < 2) return '';
    return '<section class="aev-card"><h3 class="aev-h3">Event-Vergleich' + info('Nur Events mit Teilnehmern. Weil die Stufenzahl verschieden sein kann, steht neben der Ø Stufe der Anteil an der Gesamtstufenzahl.') + '</h3>'
      + '<div class="aev-table-wrap"><table class="aev-table" data-testid="aev-compare-table"><thead><tr><th>Event</th><th>Status</th><th class="r">Stufen</th><th class="r">Gestartet</th><th class="r">Aktiv</th><th class="r">Ø Stufe</th><th class="r">Abgeschlossen</th></tr></thead><tbody>'
      + list.map(e => '<tr' + (e.id === state.eventId ? ' class="aev-today"' : '') + ' data-testid="aev-compare-' + esc(e.id) + '"><td>' + esc(e.name) + '</td><td>' + esc((STATUS[e.status] || {}).label || e.status) + '</td>'
        + '<td class="r">' + num(e.tier_count) + '</td><td class="r">' + num(e.started) + '</td><td class="r">' + num(e.active) + '</td>'
        + '<td class="r">' + dec(e.avg_tier, 1) + (isNum(e.avg_tier) && e.tier_count ? ' <small>(' + pct(e.avg_tier, e.tier_count, 0) + ')</small>' : '') + '</td>'
        + '<td class="r">' + num(e.completed) + ' <small>' + pct(e.completed, e.active, 0) + '</small></td></tr>').join('')
      + '</tbody></table></div></section>';
  }

  function renderLimits() {
    return '<details class="aev-card aev-limits" data-testid="aev-limits"><summary>Was lässt sich (noch) nicht messen?</summary><ul>'
      + '<li><strong>Durchschnittliche Abschlusszeit pro Aufgabe</strong> - der Zeitpunkt, an dem eine Aufgabe erledigt wurde, wird im Spiel nicht gespeichert.</li>'
      + '<li><strong>Neu-Würfeln von Aufgaben</strong> - gibt es im Event-System nicht, deshalb gibt es dazu keine Zahl.</li>'
      + '<li><strong>Tagesverlauf vor dem Statistikstart</strong> - aktive Spieler, Punkte und Ø Stufe pro Tag sind erst ab dem Tag vollständig, an dem das Tagesprotokoll installiert wurde. Das lässt sich nicht nachträglich rekonstruieren.</li>'
      + '<li><strong>Beitrittstag älterer Teilnehmer</strong> - wurde vorher nicht gespeichert; diese Spieler fehlen bei "Neue Teilnehmer".</li>'
      + '</ul></details>';
  }

  /* ---------- Info-Sprechblase (gemeinsam, klemmt am Fensterrand) ---------- */
  let tipEl = null, tipFor = null, tipShownAt = 0;
  function showTip(target) {
    if (!target || !target.dataset.tip) return;
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'aev-tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    tipFor = target;
    tipShownAt = Date.now();
    tipEl.textContent = target.dataset.tip;
    tipEl.classList.add('on');
    const r = target.getBoundingClientRect();
    const w = Math.min(280, window.innerWidth - 16);
    tipEl.style.width = w + 'px';
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    tipEl.style.left = left + 'px';
    const h = tipEl.offsetHeight;
    const below = r.bottom + 8 + h <= window.innerHeight;
    tipEl.style.top = (below ? r.bottom + 8 : Math.max(8, r.top - 8 - h)) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('on'); tipFor = null; }

  /* ---------- Ereignisse ---------- */
  function readoutHist(btn) {
    const out = document.getElementById('aevHistReadout');
    if (out && btn) out.textContent = btn.getAttribute('aria-label') || '';
  }
  function readoutDay(i) {
    const out = document.getElementById('aevTlReadout');
    const d = state.timeline && state.timeline.days && state.timeline.days[Number(i)];
    if (!out || !d) return;
    out.textContent = dayLabel(d.day) + ': ' + num(d.new_participants) + ' neue Teilnehmer, '
      + (d.tracked ? num(d.active) + ' aktive Spieler, ' : 'Aktive nicht verfügbar, ') + num(d.completed) + ' abgeschlossen, ' + num(d.choices) + ' Auswahlen'
      + (d.tracked ? ', ' + num(d.total_points) + ' Punkte gesamt, Ø Stufe ' + dec(d.avg_tier, 1) : '');
  }

  function wire() {
    const r = root();
    if (!r || r.dataset.aevWired) return;
    r.dataset.aevWired = '1';

    r.addEventListener('click', e => {
      const t = e.target;
      const infoEl = t.closest && t.closest('.aev-info');
      if (infoEl) { e.preventDefault(); showTip(infoEl); return; }
      hideTip();
      if (t.closest('#aevRefresh')) { load({}); return; }
      if (t.closest('#aevRetry')) { load({}); return; }
      const bar = t.closest('.aev-bar'); if (bar) { readoutHist(bar); return; }
      const hit = t.closest('.aev-hit'); if (hit) { readoutDay(hit.dataset.i); return; }
      const qs = t.closest('[data-qsort]');
      if (qs) {
        const key = qs.dataset.qsort;
        state.questSort = { key, dir: state.questSort.key === key && state.questSort.dir === 'asc' ? 'desc' : 'asc' };
        const el = body(); const top = el ? el.scrollTop : 0; render(); if (el) el.scrollTop = top;
        return;
      }
      const ps = t.closest('[data-psort]');
      if (ps) {
        const key = ps.dataset.psort;
        state.dir = state.sort === key ? (state.dir === 'asc' ? 'desc' : 'asc') : (key === 'name' ? 'asc' : 'desc');
        state.sort = key; state.page = 0; loadPlayersOnly();
        return;
      }
      const step = t.closest('[data-page-step]');
      if (step && !step.disabled) { state.page = Math.max(0, state.page + Number(step.dataset.pageStep)); loadPlayersOnly(); return; }
      const row = t.closest('.aev-player-row');
      if (row) { openPlayer(row.dataset.uid); return; }
    });
    r.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'aevEventSelect') {
        state.eventId = t.value || null; state.page = 0; state.search = ''; state.sort = 'points'; state.dir = 'desc';
        state.overview = state.quests = state.timeline = state.players = null;
        render(); load({ reloadList: false });
      } else if (t.id === 'aevAuto') setAuto(t.checked);
      else if (t.id === 'aevOnlyMs') { state.onlyMilestones = t.checked; render(); }
    });
    r.addEventListener('input', e => {
      if (e.target.id === 'aevSearch') {
        window.clearTimeout(state.searchTimer);
        const value = e.target.value;
        state.searchTimer = window.setTimeout(() => { state.search = value.trim(); state.page = 0; loadPlayersOnly(); }, 300);
      }
    });
    r.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList) {
        if (e.target.classList.contains('aev-player-row')) { e.preventDefault(); openPlayer(e.target.dataset.uid); }
        else if (e.target.classList.contains('aev-info')) { e.preventDefault(); showTip(e.target); }
      }
      if (e.key === 'Escape') hideTip();
    });
    r.addEventListener('mouseover', e => {
      const infoEl = e.target.closest && e.target.closest('.aev-info'); if (infoEl) { showTip(infoEl); return; }
      const bar = e.target.closest && e.target.closest('.aev-bar'); if (bar) { readoutHist(bar); return; }
      const hit = e.target.closest && e.target.closest('.aev-hit'); if (hit) readoutDay(hit.dataset.i);
    });
    r.addEventListener('mouseout', e => { const infoEl = e.target.closest && e.target.closest('.aev-info'); if (infoEl && !infoEl.contains(e.relatedTarget)) hideTip(); });
    r.addEventListener('focusin', e => { const infoEl = e.target.closest && e.target.closest('.aev-info'); if (infoEl) showTip(infoEl); });
    r.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('.aev-info')) hideTip(); });
    window.addEventListener('scroll', () => { if (Date.now() - tipShownAt > 300) hideTip(); }, true);   // Scroll-Ereignisse kurz nach dem Anzeigen (Auto-Scroll zum Symbol) ignorieren
    window.addEventListener('resize', hideTip);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePlayer(); });
    document.addEventListener('click', e => {
      const m = document.getElementById('aevModal');
      if (!m) return;
      if (e.target === m || (e.target.closest && e.target.closest('[data-aev-close]'))) closePlayer();
    });
  }

  /* wird vom Admin-Navigationsklick aufgerufen */
  function onOpen() {
    wire();
    updateToolbar();
    render();
    load({});
  }

  window.bkmpAdminEventsOnOpen = onOpen;
  window.bkmpAdminEvents = { state, load, render, openPlayer, describeReward, pickDefaultEvent, isAutoRefreshOn: () => autoTimer !== null };
  wire();
})();
