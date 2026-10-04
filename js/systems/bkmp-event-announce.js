/* ============================================================
   Event-Ankuendigungs-Popup (04.10.2026) - Website, nicht Idle-Dorf

   Das transparente Artwork mit dem goldenen Rahmen IST das Fenster (keine
   Box drumherum). Darueber liegen nur echte Interaktionsflaechen (X und
   "Event ansehen") + sehr leichte, rein dekorative Effekte.

   Alles kommt aus der Event-Konfiguration (special_events.config.
   announcementPopup, siehe sql/20261004-07 + -11) - Bild, Klickflaechen,
   Effekt-Positionen, Aktion. Kein Event ist hier fest verdrahtet; ein
   weiteres Event bekommt ein Popup allein ueber seine Konfiguration.

   Regeln:
     * nur auf der normalen Website (nicht im App-Modus), nur solange der
       Event-Status COMING_SOON oder LIVE ist (Status kommt aus
       js/systems/bkmp-special-events.js - HIDDEN/ENDED/ARCHIVED = nie)
     * hoechstens 1x pro Berliner Kalendertag (daily) bzw. 1x je Event;
       Schluessel "bkmp-event-popup-<eventId>-<YYYY-MM-DD>". Als gesehen
       gilt es, sobald es WIRKLICH angezeigt wird (Reload/neuer Tab/interne
       Navigation zeigen es nicht erneut), zusaetzlich bei X, "Event ansehen"
       und Escape. Laesst sich der Merker nicht speichern, erscheint das
       Popup gar nicht (lieber nie nerven als jedes Mal).
     * 700-1200 ms nach dem vollstaendigen Laden, erst wenn das Bild
       geladen+dekodiert ist (nie ein halbes Bild); Bild wird nur geladen,
       wenn das Popup heute auch wirklich dran ist.
     * "Event ansehen" ruft die ganz normale bkmpIdleOpenModal() auf und
       oeffnet danach das Event-Fenster (Vorschau bei COMING_SOON, Pass bei
       LIVE). Das Popup selbst gibt nie Punkte, loest nie etwas aus und
       schreibt nichts in die Datenbank.
     * Effekte: nur transform/opacity. Effektmodus "Hoch" = alles,
       "Reduziert" = Oeffnen/Schliessen + dezentes Funkeln, "Aus" und
       prefers-reduced-motion = keine Dauer-Animation.
   ============================================================ */

const BKMP_ANN_DELAY_MIN_MS = 700;
const BKMP_ANN_DELAY_MAX_MS = 1200;
const BKMP_ANN_PRELOAD_TIMEOUT_MS = 8000;
const BKMP_ANN_BLOCKED_POLL_MS = 1200;
const BKMP_ANN_BLOCKED_MAX_MS = 15 * 60 * 1000;
const BKMP_ANN_ENTER_MS = 560;
const BKMP_ANN_LEAVE_MS = 260;
const BKMP_ANN_LAUNCH_MS = 340;
const BKMP_ANN_HOLE_SCALE = 0.955; // muss kleiner sein als die Druck-Skalierung (0.97) im CSS
const BKMP_ANN_IMAGE_RE = /^assets\/[A-Za-z0-9_/.-]+\.(?:webp|png|jpe?g)(?:\?[A-Za-z0-9_=.-]*)?$/;

let bkmpAnnStarted = false;
let bkmpAnnOpen = false;
let bkmpAnnLaunching = false;
let bkmpAnnPrevFocus = null;
let bkmpAnnCurrent = null;
const bkmpAnnMemorySeen = {};

function bkmpAnnSleep(ms) { return new Promise(res => window.setTimeout(res, ms)); }
function bkmpAnnNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function bkmpAnnEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Konfiguration ---------------- */
/* Prueft und bereinigt config.announcementPopup eines Events (Pixel der
   Grafik -> Prozent erst beim Bauen). null = kein gueltiges Popup. */
function bkmpAnnNormalizeConfig(ev) {
  const raw = ev && ev.config && ev.config.announcementPopup;
  if (!raw || raw.enabled !== true) return null;
  const image = String(raw.image || '');
  if (!BKMP_ANN_IMAGE_RE.test(image) || image.indexOf('..') !== -1) return null;
  /* Groessen muessen echt im erlaubten Bereich liegen (kein stilles Anpassen). */
  const inRange = (v, min, max) => Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;
  if (!inRange(raw.width, 100, 8000) || !inRange(raw.height, 100, 8000)) return null;
  const W = Number(raw.width);
  const H = Number(raw.height);
  const pt = p => (Array.isArray(p) && p.length >= 2)
    ? [bkmpAnnNum(p[0], 0, W, 0), bkmpAnnNum(p[1], 0, H, 0)] : null;
  const c = raw.close || {};
  const cta = raw.cta || {};
  const face = (Array.isArray(cta.face) ? cta.face : []).map(pt).filter(Boolean);
  const cfg = {
    eventId: String(ev.id || ''),
    daily: raw.daily !== false,
    action: raw.action === 'open_idle' ? 'open_idle' : 'open_event',
    image, W, H,
    alt: String(raw.alt || ev.name || 'Event-Ankündigung'),
    ctaLabel: String(raw.ctaLabel || ((ev.name || 'Event') + ' ansehen')),
    closeLabel: String(raw.closeLabel || 'Event-Ankündigung schließen'),
    close: { x: bkmpAnnNum(c.x, 0, W, W - 80), y: bkmpAnnNum(c.y, 0, H, 80), r: bkmpAnnNum(c.r, 8, 400, 46) },
    cta: {
      x: bkmpAnnNum(cta.x, 0, W, 0), y: bkmpAnnNum(cta.y, 0, H, 0),
      w: bkmpAnnNum(cta.w, 10, W, 0), h: bkmpAnnNum(cta.h, 10, H, 0),
      face: face.length >= 3 ? face : null
    },
    glows: (Array.isArray(raw.glows) ? raw.glows : []).slice(0, 4).map(g => ({
      tone: g && g.tone === 'dark' ? 'dark' : 'light',
      x: bkmpAnnNum(g && g.x, 0, W, W / 2), y: bkmpAnnNum(g && g.y, 0, H, H / 2), r: bkmpAnnNum(g && g.r, 10, W, 120)
    })),
    sparks: (Array.isArray(raw.sparks) ? raw.sparks : []).slice(0, 4).map(s => ({
      tone: s && s.tone === 'dark' ? 'dark' : 'light',
      x: bkmpAnnNum(s && s.x, 0, W, 0), y: bkmpAnnNum(s && s.y, 0, H, 0),
      w: bkmpAnnNum(s && s.w, 1, W, 100), h: bkmpAnnNum(s && s.h, 1, H, 100),
      count: Math.round(bkmpAnnNum(s && s.count, 0, 12, 6))
    })),
    twinkles: (Array.isArray(raw.twinkles) ? raw.twinkles : []).slice(0, 10).map(pt).filter(Boolean)
  };
  if (!inRange(cta.w, 10, W) || !inRange(cta.h, 10, H)) return null;
  return cfg;
}

/* Welches Event ist heute dran? COMING_SOON/LIVE, gueltige Konfiguration,
   heute noch nicht gezeigt. Laufendes vor angekuendigtem Event. */
function bkmpAnnSeenKey(ev, cfg) {
  const day = cfg.daily ? bkmpEventBerlinDayKey(bkmpEventNow()) : 'once';
  return 'bkmp-event-popup-' + String(ev.id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + day;
}
function bkmpAnnPick() {
  if (typeof bkmpSpecialEvents === 'undefined' || !Array.isArray(bkmpSpecialEvents)) return null;
  const order = { LIVE: 0, COMING_SOON: 1 };
  const candidates = bkmpSpecialEvents
    .map(ev => ({ ev, status: bkmpEventStatusOf(ev) }))
    /* Archivierte Events nie (der Server meldet das im Feld "status"; die
       Zeitberechnung allein kennt "archiviert" nicht). */
    .filter(x => order[x.status] != null && x.ev.status !== 'ARCHIVED')
    .map(x => ({ ...x, cfg: bkmpAnnNormalizeConfig(x.ev) }))
    .filter(x => x.cfg)
    .sort((a, b) => order[a.status] - order[b.status] || (Date.parse(a.ev.starts_at || '') || 0) - (Date.parse(b.ev.starts_at || '') || 0));
  for (const c of candidates) {
    c.key = bkmpAnnSeenKey(c.ev, c.cfg);
    if (!bkmpAnnIsSeen(c.key)) return c;
  }
  return null;
}

/* ---------------- "Heute schon gesehen" ---------------- */
function bkmpAnnIsSeen(key) {
  if (bkmpAnnMemorySeen[key]) return true;
  try { return localStorage.getItem(key) === '1'; } catch (e) { return false; }
}
/* true nur, wenn der Merker wirklich gespeichert (und lesbar) ist. */
function bkmpAnnMarkSeen(key) {
  bkmpAnnMemorySeen[key] = true;
  try {
    localStorage.setItem(key, '1');
    return localStorage.getItem(key) === '1';
  } catch (e) { return false; }
}
/* Alte Tages-Merker (Datum vor heute) aufraeumen - "nur 1x je Event"-Merker
   ohne Datum bleiben bestehen. */
function bkmpAnnPruneOldKeys() {
  try {
    const today = bkmpEventBerlinDayKey(bkmpEventNow());
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && /^bkmp-event-popup-.+-(\d{4}-\d{2}-\d{2})$/.exec(k);
      if (m && m[1] < today) stale.push(k);
    }
    stale.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* egal */ }
}

/* ---------------- Hilfen ---------------- */
function bkmpAnnMotion() {
  try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off'; } catch (e) { /* egal */ }
  const fx = document.documentElement.getAttribute('data-fx');
  return fx === 'aus' ? 'off' : fx === 'reduziert' ? 'reduced' : 'full';
}
/* Ist das Idle-Dorf schon offen? Dann ist man im Spiel (dort steht die Event-
   Karte ohnehin) - das Popup verzichtet fuer diesen Besuch. */
function bkmpAnnDorfOpen() {
  const dorf = document.getElementById('idleDorfOverlay');
  return !!dorf && dorf.classList.contains('visible');
}
/* Hat gerade ein anderes Fenster Vorrang (Login "Wer bist du?", Dialoge ...)? */
function bkmpAnnBlockedByOtherUi() {
  return !!document.querySelector('.joke-overlay.visible, .bkmp-ui-modal-overlay.visible, .modal-overlay.visible');
}
/* Bild EINMAL laden (normale HTTP-Cache-Regeln des Browsers) und dekodieren.
   Ergebnis ist eine blob:-Adresse im Arbeitsspeicher, die danach fuer das
   Artwork UND die lebendige Plakette gemeinsam genutzt wird - also genau ein
   Download und nie ein halb geladenes Bild. null = nicht ladbar. */
async function bkmpAnnPreload(src) {
  let objectUrl = '';
  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = window.setTimeout(() => { if (ctrl) ctrl.abort(); }, BKMP_ANN_PRELOAD_TIMEOUT_MS);
    let blob;
    try {
      const res = await fetch(src, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) return null;
      blob = await res.blob();
    } finally { window.clearTimeout(timer); }
    if (!blob || !blob.size || !/^image\//.test(blob.type)) return null;
    objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.src = objectUrl;
    if (img.decode) await img.decode();
    else await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    return objectUrl;
  } catch (e) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return null;
  }
}

/* ---------------- Aufbau ---------------- */
function bkmpAnnPct(v, total, digits) { return +(v / total * 100).toFixed(digits == null ? 3 : digits); }
function bkmpAnnBounds(points) {
  const xs = points.map(p => p[0]); const ys = points.map(p => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
/* Reihenfolge ohne Zufall (gleichmaessig verteilt, reproduzierbar). */
function bkmpAnnSparkHtml(zone, idx, tone) {
  const fx = (i, k) => ((i + 1) * k) % 1;
  const left = zone.x + fx(idx + 3, 0.6180339887) * zone.w;
  const top = zone.y + (0.18 + fx(idx + 1, 0.3819660113) * 0.78) * zone.h;
  const dur = (4.6 + fx(idx + 2, 0.7548776662) * 2.8).toFixed(2);
  const delay = (-fx(idx + 5, 0.5698402910) * dur).toFixed(2);
  const size = (4 + fx(idx + 7, 0.6710436067) * 4).toFixed(1);
  const dx = Math.round((fx(idx + 4, 0.4142135624) - 0.5) * 24);
  return { left, top, dur, delay, size, dx, tone };
}
function bkmpAnnBuildHtml(ev, cfg, artUrl) {
  const { W, H } = cfg;
  const closeSize = bkmpAnnPct(cfg.close.r * 2, W, 3);
  const cta = cfg.cta;
  const fb = cta.face ? bkmpAnnBounds(cta.face) : null;
  const src = bkmpAnnEsc(artUrl);

  let faceHtml = '';
  let holeSvg = '';
  if (fb) {
    const bw = fb.x1 - fb.x0; const bh = fb.y1 - fb.y0;
    const rel = cta.face.map(p => `${bkmpAnnPct(p[0] - fb.x0, bw, 2)}% ${bkmpAnnPct(p[1] - fb.y0, bh, 2)}%`).join(', ');
    const sizeX = bkmpAnnPct(W, bw, 2); const sizeY = bkmpAnnPct(H, bh, 2);
    const posX = bw >= W ? 0 : bkmpAnnPct(fb.x0, W - bw, 2); const posY = bh >= H ? 0 : bkmpAnnPct(fb.y0, H - bh, 2);
    faceHtml = `<span class="bkmp-ann-face" aria-hidden="true" style="left:${bkmpAnnPct(fb.x0, W)}%;top:${bkmpAnnPct(fb.y0, H)}%;width:${bkmpAnnPct(bw, W)}%;height:${bkmpAnnPct(bh, H)}%">
        <span class="bkmp-ann-face-in" style="clip-path:polygon(${rel});background-image:url('${src}');background-size:${sizeX}% ${sizeY}%;background-position:${posX}% ${posY}%"><span class="bkmp-ann-face-shine"></span></span>
      </span>`;
    /* Loch im Grundbild: nur die Plakette (leicht verkleinert) wird von der
       lebendigen Kopie gezeichnet, damit Text/Flaeche nicht doppelt liegen. */
    const cx = (fb.x0 + fb.x1) / 2; const cy = (fb.y0 + fb.y1) / 2;
    const hole = cta.face.map(p => [cx + (p[0] - cx) * BKMP_ANN_HOLE_SCALE, cy + (p[1] - cy) * BKMP_ANN_HOLE_SCALE]);
    const d = 'M0 0H1V1H0Z M' + hole.map(p => `${(p[0] / W).toFixed(5)} ${(p[1] / H).toFixed(5)}`).join(' L') + 'Z';
    holeSvg = `<svg class="bkmp-ann-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs><clipPath id="bkmpAnnHole" clipPathUnits="objectBoundingBox"><path clip-rule="evenodd" d="${d}"/></clipPath></defs></svg>`;
  }

  const glows = cfg.glows.map(g =>
    `<span class="bkmp-ann-glow bkmp-ann-glow-${g.tone}" style="left:${bkmpAnnPct(g.x, W)}%;top:${bkmpAnnPct(g.y, H)}%;width:${bkmpAnnPct(g.r * 2, W)}%;height:${bkmpAnnPct(g.r * 2, H)}%"></span>`).join('');
  const sparks = cfg.sparks.map(z => {
    let out = '';
    for (let i = 0; i < z.count; i++) {
      const s = bkmpAnnSparkHtml(z, i, z.tone);
      out += `<span class="bkmp-ann-spark bkmp-ann-spark-${s.tone}${i < 3 ? ' is-minor' : ''}" style="left:${bkmpAnnPct(s.left, W)}%;top:${bkmpAnnPct(s.top, H)}%;--d:${s.dur}s;--dl:${s.delay}s;--sz:${s.size}px;--dx:${s.dx}px"></span>`;
    }
    return out;
  }).join('');
  const twinkles = cfg.twinkles.map((p, i) =>
    `<span class="bkmp-ann-twinkle" style="left:${bkmpAnnPct(p[0], W)}%;top:${bkmpAnnPct(p[1], H)}%;--dl:${(-(i * 0.83 % 3.4)).toFixed(2)}s"></span>`).join('');

  return `${holeSvg}
    <div class="bkmp-ann-window" style="--ann-ratio:${(W / H).toFixed(5)};aspect-ratio:${W} / ${H}">
      <img class="bkmp-ann-art" src="${src}" data-src="${bkmpAnnEsc(cfg.image)}" alt="${bkmpAnnEsc(cfg.alt)}" width="${W}" height="${H}" decoding="async" draggable="false">
      <div class="bkmp-ann-fx" aria-hidden="true">${glows}${sparks}${twinkles}</div>
      <button type="button" class="bkmp-ann-cta" data-ann-action="launch" data-testid="event-announce-cta" aria-label="${bkmpAnnEsc(cfg.ctaLabel)}" style="left:${bkmpAnnPct(cta.x, W)}%;top:${bkmpAnnPct(cta.y, H)}%;width:${bkmpAnnPct(cta.w, W)}%;height:${bkmpAnnPct(cta.h, H)}%"></button>
      ${faceHtml}
      <button type="button" class="bkmp-ann-close" data-ann-action="close" data-testid="event-announce-close" aria-label="${bkmpAnnEsc(cfg.closeLabel)}" style="left:${bkmpAnnPct(cfg.close.x, W)}%;top:${bkmpAnnPct(cfg.close.y, H)}%;width:max(${closeSize}%, 44px)"></button>
    </div>`;
}

/* ---------------- Anzeigen / Schliessen ---------------- */
function bkmpAnnShow(pick, artUrl) {
  const { ev, cfg, key } = pick;
  bkmpAnnOpen = true;
  bkmpAnnLaunching = false;
  bkmpAnnCurrent = { ev, cfg, key, artUrl };
  bkmpAnnPrevFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.id = 'bkmpEventAnnounceOverlay';
  overlay.className = 'bkmp-ann-overlay zone-game';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', String(ev.name || 'Event-Ankündigung'));
  overlay.setAttribute('data-testid', 'event-announce-popup'); // data-testid="event-announce-popup"
  overlay.setAttribute('data-event-id', String(ev.id));
  overlay.tabIndex = -1;
  if (cfg.cta.face) overlay.classList.add('has-face');
  overlay.innerHTML = bkmpAnnBuildHtml(ev, cfg, artUrl);
  /* Kein Scrollen der Seite dahinter (ohne Layout-Sprung durch fehlende Scrollleiste). */
  overlay.addEventListener('wheel', e => e.preventDefault(), { passive: false });
  overlay.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  overlay.addEventListener('touchstart', () => {}, { passive: true }); // :active auf iOS
  overlay.addEventListener('click', e => {
    const el = e.target.closest('[data-ann-action]');
    if (!el) return; // Klick ausserhalb schliesst bewusst NICHT
    if (el.dataset.annAction === 'close') bkmpAnnClose('close');
    else if (el.dataset.annAction === 'launch') bkmpAnnLaunch();
  });
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const items = Array.from(overlay.querySelectorAll('button'));
    if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === overlay)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  document.body.appendChild(overlay);
  document.addEventListener('keydown', bkmpAnnOnKeydown, true);
  document.addEventListener('visibilitychange', bkmpAnnOnVisibility);
  bkmpAnnOnVisibility();
  void overlay.offsetWidth; // Startzustand festschreiben
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    try { overlay.focus({ preventScroll: true }); } catch (e) { /* egal */ }
  }));
  window.setTimeout(() => overlay.classList.add('is-settled'), BKMP_ANN_ENTER_MS);
}
function bkmpAnnOnKeydown(e) {
  if (!bkmpAnnOpen) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); bkmpAnnClose('escape'); }
}
function bkmpAnnOnVisibility() {
  const overlay = document.getElementById('bkmpEventAnnounceOverlay');
  if (overlay) overlay.classList.toggle('is-paused', document.hidden);
}
function bkmpAnnClose(reason, opts) {
  const overlay = document.getElementById('bkmpEventAnnounceOverlay');
  const keepFocus = !!(opts && opts.keepFocus);
  bkmpAnnOpen = false;
  document.removeEventListener('keydown', bkmpAnnOnKeydown, true);
  document.removeEventListener('visibilitychange', bkmpAnnOnVisibility);
  if (!overlay) return;
  if (bkmpAnnCurrent) bkmpAnnMarkSeen(bkmpAnnCurrent.key); // X / Event ansehen / Escape: fuer heute erledigt
  overlay.classList.add('is-closing');
  overlay.classList.remove('is-open');
  const prev = bkmpAnnPrevFocus;
  const ms = bkmpAnnMotion() === 'off' && reason !== 'launch' ? 140 : BKMP_ANN_LEAVE_MS;
  const artUrl = bkmpAnnCurrent && bkmpAnnCurrent.artUrl;
  window.setTimeout(() => {
    overlay.remove();
    if (artUrl) URL.revokeObjectURL(artUrl);
    if (!keepFocus && prev && typeof prev.focus === 'function' && document.contains(prev)) {
      try { prev.focus({ preventScroll: true }); } catch (e) { /* egal */ }
    }
  }, ms);
}

/* "Event ansehen": kurzer Lichtimpuls, dann Idle-Dorf (+ Event-Fenster). */
async function bkmpAnnLaunch() {
  if (bkmpAnnLaunching || !bkmpAnnOpen || !bkmpAnnCurrent) return;
  bkmpAnnLaunching = true;
  const { ev, cfg } = bkmpAnnCurrent;
  const overlay = document.getElementById('bkmpEventAnnounceOverlay');
  const motion = bkmpAnnMotion();
  if (overlay) overlay.classList.add('is-launching');
  const wait = motion === 'full' ? BKMP_ANN_LAUNCH_MS : motion === 'reduced' ? 140 : 0;
  if (wait) await bkmpAnnSleep(wait);
  bkmpAnnClose('launch', { keepFocus: true });
  try { await bkmpAnnOpenTarget(cfg, ev); } catch (e) { /* Popup darf nie etwas kaputt machen */ }
}
/* Offizielle Oeffnen-Funktion des Idle-Dorfs (dieselbe wie der Dorf-Knopf),
   danach das Event-Fenster. Ohne Login/bei Wartung oeffnet das Dorf nicht -
   dann wird auch nichts erzwungen (Login-Fenster bzw. Wartungshinweis). */
async function bkmpAnnOpenTarget(cfg, ev) {
  if (typeof bkmpIdleOpenModal !== 'function') return;
  const opening = bkmpIdleOpenModal();
  if (cfg.action !== 'open_event') { await opening; return; }
  let settled = false;
  Promise.resolve(opening).then(() => { settled = true; }).catch(() => { settled = true; });
  const visible = () => { const o = document.getElementById('idleDorfOverlay'); return !!o && o.classList.contains('visible'); };
  const t0 = Date.now();
  while (!visible() && !settled && Date.now() - t0 < 6000) await bkmpAnnSleep(50);
  if (!visible()) return;
  if (typeof bkmpEventOpenModal === 'function') await bkmpEventOpenModal('today');
}

/* ---------------- Ablauf ---------------- */
/* Eine Pruefrunde: 'shown' | 'blocked' (anderes Fenster hat Vorrang, spaeter
   erneut) | 'none' (heute/hier kein Popup). Laedt die Events nicht neu. */
async function bkmpAnnTryShow() {
  if (bkmpAnnOpen) return 'none';
  const pick = bkmpAnnPick();
  if (!pick || bkmpAnnDorfOpen()) return 'none';
  if (bkmpAnnBlockedByOtherUi()) return 'blocked';
  const artUrl = await bkmpAnnPreload(pick.cfg.image);
  if (!artUrl) return 'none'; // Bild kommt nicht an: heute still verzichten, ungemerkt
  /* Zustand nach dem (evtl. langsamen) Laden erneut pruefen. */
  const again = bkmpAnnPick();
  const ok = again && again.key === pick.key && !bkmpAnnOpen && !bkmpAnnDorfOpen();
  if (!ok) { URL.revokeObjectURL(artUrl); return 'none'; }
  if (bkmpAnnBlockedByOtherUi()) { URL.revokeObjectURL(artUrl); return 'blocked'; }
  if (!bkmpAnnMarkSeen(again.key)) { URL.revokeObjectURL(artUrl); return 'none'; } // nicht speicherbar -> lieber gar nicht zeigen
  bkmpAnnPruneOldKeys();
  bkmpAnnShow(again, artUrl);
  return 'shown';
}
async function bkmpAnnRun() {
  try {
    await bkmpAnnSleep(BKMP_ANN_DELAY_MIN_MS + Math.floor(Math.random() * (BKMP_ANN_DELAY_MAX_MS - BKMP_ANN_DELAY_MIN_MS)));
    /* Im Hintergrund-Tab (z.B. per Link geoeffnet) nicht verbrauchen. */
    if (document.hidden) {
      await new Promise(res => {
        const f = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', f); res(); } };
        document.addEventListener('visibilitychange', f);
      });
      await bkmpAnnSleep(BKMP_ANN_DELAY_MIN_MS);
    }
    if (typeof bkmpEventsEnsureLoaded !== 'function' || typeof bkmpEventStatusOf !== 'function') return;
    await bkmpEventsEnsureLoaded(false);
    if (typeof bkmpSpecialEventsMissing !== 'undefined' && bkmpSpecialEventsMissing) return;
    /* Das Login-Fenster ("Wer bist du?") oeffnet sich bei neuen Besuchern
       von selbst - das Popup wartet, bis es zu ist (nie beides uebereinander). */
    const t0 = Date.now();
    for (;;) {
      const r = await bkmpAnnTryShow();
      if (r !== 'blocked' || Date.now() - t0 > BKMP_ANN_BLOCKED_MAX_MS) return;
      await bkmpAnnSleep(BKMP_ANN_BLOCKED_POLL_MS);
    }
  } catch (e) { /* nie stoeren */ }
}
function bkmpAnnInit() {
  if (bkmpAnnStarted) return;
  if (window.BKMP_APP_MODE) return; // App-Modus: man ist ohnehin im Spiel
  bkmpAnnStarted = true;
  if (document.readyState === 'complete') bkmpAnnRun();
  else window.addEventListener('load', () => bkmpAnnRun(), { once: true });
}

(function bkmpAnnWire() {
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bkmpAnnInit);
  else bkmpAnnInit();
})();
