// Bkmp - Redesign Phase 5.5 (19.07.): gemeinsames Reward-Presentation-System.
// Berechnet NICHTS - erhaelt ausschliesslich bereits fertig berechnete Werte
// (Betraege, Seltenheiten, Namen) und stellt sie nur dar. Kein Aufrufer darf
// hier Drops/Werte neu wuerfeln oder speichern.
//
// Verallgemeinert zwei bereits bestehende, bewaehrte Bausteine statt sie zu
// ersetzen:
//   1) bkmpShowJannikToast (bkmp-site.js) - der bisherige Alles-Toast, bleibt
//      fuer einfache Text-Hinweise (Fehler, "nicht genug Gold" etc.) exakt
//      wie er ist. Dieses System bekommt einen EIGENEN Toast-Stil fuer
//      Belohnungen (stapelbar, mit Zusammenfassung).
//   2) bkmpAchievementPopupQueue/bkmpShowAchievementPopup (bkmp-site.js) -
//      das bisher einzige Warteschlangen-Muster im Projekt (Karte +
//      Konfetti + "niemals zwei gleichzeitig"). Die Queue hier ist exakt
//      dasselbe Prinzip, nur fuer alle Belohnungsarten statt nur Erfolge.
// Nutzt bkmpUiRarityMeta/bkmpUiCard/bkmpUiModalHtml/bkmpUiTrapFocus aus
// js/ui/bkmp-ui-components.js (Phase 3, bisher ungenutzt vorbereitet) fuer
// die Seltenheits-Farbsprache und die Zeremonie-Dialogstruktur.
//
// Ladereihenfolge: MUSS nach bkmp-ui-components.js UND bkmp-site.js laden
// (siehe <script>-Reihenfolge in index.html) - beide werden hier referenziert.

const BKMP_REWARD_TIER = { TOAST: 'toast', CARD: 'card', CEREMONY: 'ceremony' };

/* Seltenheit -> Standard-Stufe, falls der Aufrufer keine explizite tier
   angibt. Haeufige/kleine Ereignisse (siehe Abschnitt 1 im Auftrag) rufen
   ueblicherweise ohnehin ohne rarity auf und landen damit automatisch bei
   TOAST. */
const BKMP_REWARD_RARITY_DEFAULT_TIER = {
  common: BKMP_REWARD_TIER.TOAST, uncommon: BKMP_REWARD_TIER.TOAST,
  rare: BKMP_REWARD_TIER.CARD, epic: BKMP_REWARD_TIER.CARD,
  legendary: BKMP_REWARD_TIER.CEREMONY, mythic: BKMP_REWARD_TIER.CEREMONY
};

/* ---------------- Dedupe ----------------
   Verhindert, dass exakt dasselbe Ereignis (z.B. durch einen doppelten
   Aufruf aus zwei Codepfaden, oder eine erneute Offline-/Cache-Berechnung)
   zweimal als Belohnung erscheint. Rein zeitbasiert, kurzes Fenster - kein
   Ersatz fuer echte serverseitige Dedupe (die bleibt, wo sie schon existiert,
   z.B. bkmpGetNotifiedAchievements). */
const BKMP_REWARD_DEDUPE_WINDOW_MS = 4000;
let bkmpRewardDedupeSeen = new Map();
function bkmpRewardIsDuplicate(dedupeKey) {
  if (!dedupeKey) return false;
  const now = Date.now();
  for (const [k, t] of bkmpRewardDedupeSeen) { if (now - t > BKMP_REWARD_DEDUPE_WINDOW_MS) bkmpRewardDedupeSeen.delete(k); }
  if (bkmpRewardDedupeSeen.has(dedupeKey)) return true;
  bkmpRewardDedupeSeen.set(dedupeKey, now);
  return false;
}

/* ---------------- Sound-Hooks (Abschnitt 18) ----------------
   Es existiert bereits ein echtes Audiosystem im Projekt (new Audio(...) +
   .play().catch(()=>{}), siehe bkmpPlayBonkSound/bkmpPlayJannikHopSound/
   bkmpPlayHissSound in bkmp-site.js) - aber KEINE generischen "Erfolgs"-
   Sounds (nur 3 sehr spezifische Easter-Egg-Dateien existieren, siehe
   assets/*.mp3). Auf ausdruecklichen Wunsch werden hier keine neuen Audio-
   dateien heruntergeladen oder erzeugt - diese Map bleibt bewusst leer und
   bkmpRewardSound() tut dann einfach nichts (sicher aufrufbar, kein Fehler).
   Sobald passende Dateien existieren, reicht ein Eintrag hier - kein Aufruf
   an anderer Stelle muss geaendert werden. */
const BKMP_REWARD_SOUND_FILES = {
  // 'legendary': 'assets/rewards/legendary.mp3',
  // 'level-up': 'assets/rewards/level-up.mp3',
  // 'dragon-hatch': 'assets/rewards/dragon-hatch.mp3',
};
function bkmpRewardSound(name) {
  const src = BKMP_REWARD_SOUND_FILES[name];
  if (!src) return;
  if (typeof bkmpFxGetMode === 'function' && bkmpFxGetMode() === 'aus') return;
  try { const audio = new Audio(src); audio.volume = 0.55; audio.play().catch(() => {}); } catch (e) {}
}

/* ---------------- Seltenheits-Hilfen ---------------- */
function bkmpRewardRarityToken(rarity) {
  const meta = typeof bkmpUiRarityMeta === 'function' ? bkmpUiRarityMeta(rarity) : null;
  return meta ? meta.token : null;
}
function bkmpRewardRarityLabel(rarity) {
  const meta = typeof bkmpUiRarityMeta === 'function' ? bkmpUiRarityMeta(rarity) : null;
  return meta ? meta.label : '';
}
function bkmpRewardRarityKey(rarity) {
  // bkmpUiRarityMeta normalisiert Woerter/Farb-IDs, liefert aber kein
  // kanonisches common/rare/... zurueck - fuer die Stufen-Vorauswahl oben
  // brauchen wir genau das, daher hier zusaetzlich ueber den Token-Namen.
  const token = bkmpRewardRarityToken(rarity);
  if (!token) return null;
  return token.replace('--rarity-', '');
}

/* ---------------- Effektmodus ---------------- */
function bkmpRewardFxMode() {
  return typeof bkmpFxGetMode === 'function' ? bkmpFxGetMode() : 'hoch';
}
function bkmpRewardReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ---------------- STUFE 1: Reward-Toast (stapelbar, zusammenfassend) ----------------
   Eigener, von bkmpShowJannikToast getrennter Stil (derselbe bewaehrte
   Look, aber als Stapel statt Einzel-Element) - normale Text-Hinweise
   bleiben unveraendert bkmpShowJannikToast. Fasst gleiche dedupeKeys
   innerhalb kurzer Zeit zusammen (z.B. viele schnelle Gold-Klicks), statt
   zehn Toasts uebereinander zu stapeln. */
let bkmpRewardToastEntries = []; // { key, el, count, baseText, timer }
function bkmpRewardToastContainer() {
  let el = document.getElementById('bkmpRewardToastStack');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bkmpRewardToastStack';
    el.className = 'bkmp-reward-toast-stack';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}
function bkmpRewardShowToast({ text, rarity, dedupeKey, ms = 3200 } = {}) {
  const container = bkmpRewardToastContainer();
  const key = dedupeKey || text;
  const existing = bkmpRewardToastEntries.find(e => e.key === key);
  if (existing) {
    existing.count += 1;
    existing.el.querySelector('.bkmp-reward-toast-text').textContent = `${existing.baseText} ×${existing.count}`;
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => bkmpRewardRemoveToast(existing), ms);
    return;
  }
  const el = document.createElement('div');
  el.className = 'bkmp-reward-toast';
  const token = bkmpRewardRarityToken(rarity);
  if (token) el.style.setProperty('--reward-color', `var(${token})`);
  el.innerHTML = `<span class="bkmp-reward-toast-text">${escapeHtml(text)}</span>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  const entry = { key, el, count: 1, baseText: text, timer: null };
  entry.timer = setTimeout(() => bkmpRewardRemoveToast(entry), ms);
  bkmpRewardToastEntries.push(entry);
  /* Nur wenige gleichzeitig sichtbar (Auftrag: "maximal wenige gleichzeitig") -
     die aeltesten Toasts vorzeitig ausblenden, wenn der Stapel zu hoch wird,
     statt die Bottom-Navigation/HUD zu ueberdecken. */
  while (bkmpRewardToastEntries.length > 4) bkmpRewardRemoveToast(bkmpRewardToastEntries[0]);
}
function bkmpRewardRemoveToast(entry) {
  clearTimeout(entry.timer);
  bkmpRewardToastEntries = bkmpRewardToastEntries.filter(e => e !== entry);
  entry.el.classList.remove('visible');
  setTimeout(() => entry.el.remove(), 320);
}

/* ---------------- STUFE 2 + 3 Warteschlange ----------------
   Verallgemeinerung von bkmpAchievementPopupQueue (bkmp-site.js): genau
   dasselbe "niemals zwei gleichzeitig, danach die naechste"-Prinzip, nur
   fuer beide blockenden/halb-blockenden Stufen gemeinsam. Zeremonien haben
   Vorrang vor Karten (siehe bkmpRewardQueueSorted). */
let bkmpRewardQueue = [];
let bkmpRewardShowing = false;
const BKMP_REWARD_TIER_PRIORITY = { [BKMP_REWARD_TIER.CEREMONY]: 0, [BKMP_REWARD_TIER.CARD]: 1 };

function bkmpRewardEnqueue(opts) {
  bkmpRewardQueue.push(opts);
  bkmpRewardQueue.sort((a, b) => (BKMP_REWARD_TIER_PRIORITY[a.tier] ?? 1) - (BKMP_REWARD_TIER_PRIORITY[b.tier] ?? 1));
  bkmpRewardProcessQueue();
}

/* Bug-Fix (beim eigenen Testen dieser Datei gefunden): body.modal-open ist
   NICHT nur bei "echten" blockierenden Sub-Dialogen gesetzt, sondern auch
   schon vom Idle-Dorf-Fenster selbst (siehe bkmpIdleOpenModal in
   idledorf.js) - ein reiner modal-open-Check haette JEDE Zeremonie fuer
   immer warten lassen, solange der Spieler ueberhaupt im Dorf ist (also
   praktisch immer). Stattdessen gezielt nach einem TATSAECHLICH offenen
   .joke-overlay.visible suchen, das weder das Dorf-Fenster selbst noch die
   eigene Zeremonie ist - genau die echten Sub-Dialoge (Prestige-Bestaetigung,
   Skill-/Runen-Hilfe, Stufenwahl, Ei-Opfer-Bestaetigung, ...). */
function bkmpRewardOtherBlockingDialogOpen() {
  const overlays = document.querySelectorAll('.joke-overlay.visible');
  for (const el of overlays) {
    if (el.id === 'idleDorfOverlay') continue;
    if (el.classList.contains('bkmp-reward-ceremony-overlay')) continue;
    return true;
  }
  return false;
}

function bkmpRewardProcessQueue() {
  if (bkmpRewardShowing || bkmpRewardQueue.length === 0) return;
  /* Auftrag: "Waehrend eines Prestige-, Login- oder anderen blockierenden
     Dialogs keine zweite blockierende Zeremonie oeffnen." - fuer CEREMONY
     warten wir einen echten Sub-Dialog ab, statt die Belohnung zu
     verlieren. CARD blockiert per Definition nicht vollstaendig und darf
     parallel zu einem offenen Dialog erscheinen. */
  const next = bkmpRewardQueue[0];
  if (next.tier === BKMP_REWARD_TIER.CEREMONY && bkmpRewardOtherBlockingDialogOpen()) {
    setTimeout(bkmpRewardProcessQueue, 500);
    return;
  }
  /* Bug-Fix (Phase 5.5, beim eigenen Testen gefunden): .bkmp-reward-card
     und das bestehende, unveraenderte .bkmp-achievement-popup (bkmp-site.js)
     nutzen exakt dieselbe Ecke (left:1.2rem; bottom:1.2rem; z-index:98) -
     ohne diesen Check wuerden beide gleichzeitig sichtbar direkt
     uebereinander gerendert. Der Achievement-Popup-Queue selbst bleibt
     bewusst unangetastet (Dedupe/Mass-Backfill-Logik ist bereits korrekt,
     siehe bkmpCheckForNewAchievementUnlocks) - nur die Anzeige-Reihenfolge
     wird hier gegenseitig koordiniert (siehe Gegenstueck in
     bkmpProcessAchievementPopupQueue, bkmp-site.js). Zeremonie ist ein
     zentrales Vollbild-Overlay, kollidiert also nicht positionsmaessig -
     nur CARD muss warten. */
  if (next.tier !== BKMP_REWARD_TIER.CEREMONY && typeof bkmpAchievementPopupShowing !== 'undefined' && bkmpAchievementPopupShowing) {
    setTimeout(bkmpRewardProcessQueue, 300);
    return;
  }
  bkmpRewardQueue.shift();
  bkmpRewardShowing = true;
  if (next.tier === BKMP_REWARD_TIER.CEREMONY) bkmpRewardRunCeremony(next);
  else bkmpRewardRunCard(next);
}

function bkmpRewardQueueDone() {
  bkmpRewardShowing = false;
  bkmpRewardProcessQueue();
}

/* ---------------- STUFE 2: Reward-Karte ----------------
   Verallgemeinerte Form von .bkmp-achievement-popup - gleiche Position/
   Optik, jetzt aber mit Seltenheits-Rahmenfarbe und optionalen Aktionen
   statt fest verdrahtetem Erfolgs-Text. */
function bkmpRewardRunCard(opts) {
  const card = document.createElement('div');
  card.className = 'bkmp-reward-card';
  const token = bkmpRewardRarityToken(opts.rarity);
  if (token) card.style.setProperty('--reward-color', `var(${token})`);
  const rarityLabel = bkmpRewardRarityLabel(opts.rarity);
  card.innerHTML = `
    ${opts.icon ? `<div class="bkmp-reward-card-icon">${opts.icon}</div>` : ''}
    <div class="bkmp-reward-card-body">
      ${rarityLabel ? `<div class="bkmp-reward-card-rarity">${escapeHtml(rarityLabel)}</div>` : ''}
      <div class="bkmp-reward-card-title">${escapeHtml(opts.title || '')}</div>
      ${opts.description ? `<p class="bkmp-reward-card-desc">${escapeHtml(opts.description)}</p>` : ''}
      ${opts.source ? `<div class="bkmp-reward-card-source">${escapeHtml(opts.source)}</div>` : ''}
    </div>
    <div class="bkmp-reward-card-actions">
      ${opts.primaryAction ? `<button type="button" class="btn-ja bkmp-reward-card-primary">${escapeHtml(opts.primaryAction.label)}</button>` : ''}
      <button type="button" class="btn-nein bkmp-reward-card-secondary">${escapeHtml(opts.secondaryAction ? opts.secondaryAction.label : 'Später')}</button>
    </div>`;
  document.body.appendChild(card);
  bkmpRewardSound(opts.soundName || null);
  requestAnimationFrame(() => card.classList.add('visible'));

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    card.classList.remove('visible');
    setTimeout(() => { card.remove(); bkmpRewardQueueDone(); }, 400);
  };
  const primaryBtn = card.querySelector('.bkmp-reward-card-primary');
  if (primaryBtn && opts.primaryAction) primaryBtn.addEventListener('click', () => { close(); if (typeof opts.primaryAction.onClick === 'function') opts.primaryAction.onClick(); });
  const secondaryBtn = card.querySelector('.bkmp-reward-card-secondary');
  secondaryBtn.addEventListener('click', () => { close(); if (opts.secondaryAction && typeof opts.secondaryAction.onClick === 'function') opts.secondaryAction.onClick(); });

  const autoMs = opts.autoCloseMs || 6000;
  const timer = setTimeout(close, autoMs);
  card.addEventListener('mouseenter', () => clearTimeout(timer));
}

/* ---------------- STUFE 3: Grosse Zeremonie ----------------
   Nutzt bkmpUiModalHtml/bkmpUiTrapFocus (Phase 3) als Dialog-Grundgeruest,
   ergaenzt Seltenheits-Glow + einen kurzen Partikel-Impuls (verallgemeinert
   bkmpFireAchievementConfetti). Blockiert bewusst (role=dialog, Fokusfalle,
   ESC schliesst), aber mit kontrollierter, kurzer Dauer statt einer langen
   Zwangs-Pause - siehe Auftrag "keine unnoetig lange Blockierung". */
function bkmpRewardFireBurst(rarity) {
  const mode = bkmpRewardFxMode();
  if (mode === 'aus' || bkmpRewardReducedMotion()) return;
  const count = mode === 'reduziert' ? 6 : 16;
  const token = bkmpRewardRarityToken(rarity) || '--rarity-legendary';
  const burst = document.createElement('div');
  burst.className = 'bkmp-reward-burst';
  burst.innerHTML = Array.from({ length: count }, (_, i) => {
    const left = Math.round(Math.random() * 90);
    const duration = (0.8 + Math.random() * 0.5).toFixed(2);
    const delay = (Math.random() * 0.15).toFixed(2);
    const rot = Math.round(Math.random() * 320 - 160);
    return `<span style="left:${left}%; background:var(${token}); animation-duration:${duration}s; animation-delay:${delay}s; --rot:${rot}deg;"></span>`;
  }).join('');
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 1700);
}

function bkmpRewardRunCeremony(opts) {
  const overlay = document.createElement('div');
  overlay.className = 'joke-overlay bkmp-reward-ceremony-overlay';
  const token = bkmpRewardRarityToken(opts.rarity);
  const rarityLabel = bkmpRewardRarityLabel(opts.rarity);
  overlay.innerHTML = `
    <div class="joke-card bkmp-reward-ceremony-card" role="dialog" aria-modal="true" aria-labelledby="bkmpRewardCeremonyTitle" style="${token ? `--reward-color:var(${token})` : ''}">
      ${opts.icon ? `<div class="bkmp-reward-ceremony-icon">${opts.icon}</div>` : ''}
      ${rarityLabel ? `<div class="bkmp-reward-ceremony-rarity">${escapeHtml(rarityLabel)}</div>` : ''}
      <h3 id="bkmpRewardCeremonyTitle">${escapeHtml(opts.title || '')}</h3>
      ${opts.description ? `<p class="bkmp-reward-ceremony-desc">${escapeHtml(opts.description)}</p>` : ''}
      ${opts.source ? `<p class="bkmp-reward-ceremony-source">${escapeHtml(opts.source)}</p>` : ''}
      <div class="joke-buttons">
        ${opts.primaryAction ? `<button type="button" class="btn-ja bkmp-reward-ceremony-primary">${escapeHtml(opts.primaryAction.label)}</button>` : ''}
        <button type="button" class="btn-nein bkmp-reward-ceremony-secondary">${escapeHtml(opts.secondaryAction ? opts.secondaryAction.label : 'Weiter')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  if (typeof bkmpUiTrapFocus === 'function') bkmpUiTrapFocus(overlay);
  bkmpRewardSound(opts.soundName || null);
  requestAnimationFrame(() => { overlay.classList.add('visible'); bkmpRewardFireBurst(opts.rarity); });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.remove('visible');
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onEsc);
    setTimeout(() => { overlay.remove(); bkmpRewardQueueDone(); }, 400);
  };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onEsc);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const primaryBtn = overlay.querySelector('.bkmp-reward-ceremony-primary');
  if (primaryBtn && opts.primaryAction) primaryBtn.addEventListener('click', () => { close(); if (typeof opts.primaryAction.onClick === 'function') opts.primaryAction.onClick(); });
  overlay.querySelector('.bkmp-reward-ceremony-secondary').addEventListener('click', () => { close(); if (opts.secondaryAction && typeof opts.secondaryAction.onClick === 'function') opts.secondaryAction.onClick(); });

  const autoMs = bkmpRewardReducedMotion() || bkmpRewardFxMode() === 'aus' ? Math.min(opts.autoCloseMs || 5200, 3200) : (opts.autoCloseMs || 5200);
  setTimeout(close, autoMs);
  const firstFocusable = overlay.querySelector('button');
  if (firstFocusable) firstFocusable.focus();
}

/* ---------------- Zentraler Einstiegspunkt ----------------
   opts: { type, rarity, title, description, icon, amount, source,
           primaryAction:{label,onClick}, secondaryAction:{label,onClick},
           tier, dedupeKey, autoCloseMs, soundName }
   Berechnet keine Werte - amount/title/etc. muessen vom Aufrufer bereits
   fertig aufbereitet mitgegeben werden. */
function bkmpRewardPresent(opts) {
  if (!opts) return;
  const rarityKey = bkmpRewardRarityKey(opts.rarity);
  const tier = opts.tier || BKMP_REWARD_RARITY_DEFAULT_TIER[rarityKey] || BKMP_REWARD_TIER.TOAST;

  if (tier === BKMP_REWARD_TIER.TOAST) {
    /* Bewusst KEIN bkmpRewardIsDuplicate() hier: bei Toasts ist ein
       zweiter Aufruf mit demselben dedupeKey der ERWARTETE Normalfall
       (z.B. mehrere Gold-Ticks kurz hintereinander) - bkmpRewardShowToast
       fasst das selbst ueber denselben Key zu einem "×N"-Zaehler zusammen,
       statt es wie bei Karte/Zeremonie stillschweigend zu verwerfen. */
    bkmpRewardShowToast({ text: opts.title || opts.description || '', rarity: opts.rarity, dedupeKey: opts.dedupeKey, ms: opts.autoCloseMs || 3200 });
    return;
  }
  /* Karte/Zeremonie: hier bedeutet derselbe dedupeKey wirklich "dasselbe
     Ereignis nochmal gemeldet" (z.B. ein doppelter Funktionsaufruf oder
     eine erneute Offline-Berechnung) - hier greift die echte Dedupe. */
  if (bkmpRewardIsDuplicate(opts.dedupeKey)) return;
  bkmpRewardEnqueue({ ...opts, tier });
}
