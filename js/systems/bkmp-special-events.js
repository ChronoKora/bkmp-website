/* ============================================================
   ☀️🌑 Special Events + Zwielicht-Pass (Drachendorf-Ausbau Phase 7-9, 04.10.2026)

   Alles kommt aus der Datenbank (special_events, siehe
   sql/20261004-06-special-events.sql + -07-zwielicht-event.sql):
   Namen, Termine, Aufgaben, Belohnungen, Texte. Dieses Modul zeigt nur an
   und meldet Fortschritt:
     * Teaser mit Countdown (COMING_SOON), Ankuendigung auf der Website
       ("Was gibt's Neues?") - auch ohne Login sichtbar.
     * Pass-Karte im Kampf-Reiter (Desktop) + ☀️🌑-Knopf im kompakten HUD.
     * Pass-Fenster: Heute / Woche / Belohnungen / FAQ, Stufe 30 halb Licht
       halb Dunkel, Wahl zwischen Lightnix und Darknix mit deutlicher
       Bestaetigung, danach nur noch ein kompakter Status (keine Werbung).
     * Fortschritt: event_tick() hoechstens ~1x pro Minute, solange das
       Dorf-Fenster offen ist (NIE pro Kill). Turmstufen/Fuetterungen/
       Weltereignisse sammelt das Spiel und meldet sie gebuendelt mit.
     * Event-Archiv in der Chronik (bleibt auch nach Eventende).
   Rechenregeln: js/systems/bkmp-event-rules.js (identisch zur SQL).
   ============================================================ */

let bkmpSpecialEvents = [];
let bkmpSpecialEventsMissing = false;
let bkmpSpecialEventsLoadedAt = 0;
let bkmpSpecialEventsLoading = null;
let bkmpEventServerOffsetMs = 0;
let bkmpEventProgress = null;
let bkmpEventProgressFor = '';
let bkmpEventTickTimer = null;
let bkmpEventTickBusy = false;
let bkmpEventLastTickAt = 0;
let bkmpEventBusy = false;
let bkmpEventModalTab = 'today';
let bkmpEventCountdownTimer = null;
let bkmpEventPending = { tower: 0, feedings: 0, world_events: 0 };

const BKMP_EVENT_TICK_MS = 60000;
const BKMP_EVENT_PROGRESS_MAP = { tower_waves: 'tower', dragon_feeds: 'feedings', world_events: 'world_events' };

function bkmpEventEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s); }
function bkmpEventNum(n) { return typeof bkmpIdleFormatNumber === 'function' ? bkmpIdleFormatNumber(n) : bkmpEventFmt(n); }
function bkmpEventNow() { return Date.now() + bkmpEventServerOffsetMs; }
function bkmpEventToast(text, kind) {
  if (typeof bkmpUiShowToast === 'function') bkmpUiShowToast({ text, kind: kind || 'info', ms: 4000 });
  else if (typeof bkmpShowJannikToast === 'function') bkmpShowJannikToast(text, 4000);
}

/* ---------------- Laden + Auswahl ---------------- */
async function bkmpEventsEnsureLoaded(force) {
  if (bkmpSpecialEventsMissing || typeof bkmpSpecialEventsVisible !== 'function') return;
  if (bkmpSpecialEventsLoading) return bkmpSpecialEventsLoading;
  if (!force && Date.now() - bkmpSpecialEventsLoadedAt < 60000) return;
  bkmpSpecialEventsLoading = (async () => {
    try {
      const res = await bkmpSpecialEventsVisible();
      if (res.missing) { bkmpSpecialEventsMissing = true; bkmpSpecialEvents = []; return; }
      bkmpSpecialEvents = res.events.map(e => ({ ...e, enabled: true }));
      const srv = res.events[0] && Date.parse(res.events[0].server_now || '');
      if (Number.isFinite(srv)) bkmpEventServerOffsetMs = srv - Date.now();
      bkmpSpecialEventsLoadedAt = Date.now();
    } catch (e) { /* letzter Stand bleibt */ }
    finally { bkmpSpecialEventsLoading = null; }
  })();
  return bkmpSpecialEventsLoading;
}
function bkmpEventStatusOf(ev) {
  return ev ? bkmpEventStatus(ev, bkmpEventNow()) : 'HIDDEN';
}
/* Das gerade relevante Pass-Event (hat Stufenbelohnungen): laufend vor
   angekuendigt vor beendet vor archiviert. */
function bkmpEventPassEvent() {
  const pass = bkmpSpecialEvents.filter(e => e.config && Array.isArray(e.config.tiers) && e.config.tiers.length);
  const order = { LIVE: 0, COMING_SOON: 1, ENDED: 2, ARCHIVED: 3 };
  return pass
    .filter(e => order[bkmpEventStatusOf(e)] != null)
    .sort((a, b) => order[bkmpEventStatusOf(a)] - order[bkmpEventStatusOf(b)])[0] || null;
}
/* Kleine Wochenereignisse (Phase 11): Bonus in % aller laufenden Events. */
function bkmpEventModifierPct(key) {
  let sum = 0;
  bkmpSpecialEvents.forEach(e => {
    if (bkmpEventStatusOf(e) !== 'LIVE') return;
    const v = Number(e.config && e.config.modifiers && e.config.modifiers[key]);
    if (Number.isFinite(v) && v > 0) sum += v;
  });
  return Math.max(0, Math.min(100, sum));
}
function bkmpEventLiveModifierEvents() {
  return bkmpSpecialEvents.filter(e => bkmpEventStatusOf(e) === 'LIVE' && e.config && e.config.modifiers);
}

/* ---------------- Fortschritt ---------------- */
function bkmpEventPendingKey() {
  return 'bkmp-event-pending:' + ((typeof bkmpIdleState !== 'undefined' && bkmpIdleState && bkmpIdleState.name_key) || '');
}
function bkmpEventLoadPending() {
  try {
    const raw = JSON.parse(localStorage.getItem(bkmpEventPendingKey()) || 'null');
    if (raw && typeof raw === 'object') {
      Object.keys(bkmpEventPending).forEach(k => { bkmpEventPending[k] = Math.max(0, Math.min(500, Math.floor(Number(raw[k]) || 0))); });
    }
  } catch (e) { /* egal */ }
}
function bkmpEventSavePending() {
  try { localStorage.setItem(bkmpEventPendingKey(), JSON.stringify(bkmpEventPending)); } catch (e) { /* egal */ }
}
/* Von bkmpChronicleAddProgress aufgerufen (Turm/Fuettern/Weltereignis). */
function bkmpEventNoteProgress(type, n) {
  const key = BKMP_EVENT_PROGRESS_MAP[type];
  if (!key) return;
  const ev = bkmpEventPassEvent();
  if (!ev || bkmpEventStatusOf(ev) !== 'LIVE') return;
  bkmpEventPending[key] = Math.min(500, (bkmpEventPending[key] || 0) + Math.max(0, Math.floor(Number(n) || 0)));
  bkmpEventSavePending();
}

async function bkmpEventTick(force) {
  const ev = bkmpEventPassEvent();
  if (!ev || bkmpEventTickBusy || typeof bkmpEventTickRpc !== 'function') return;
  if (typeof bkmpIdleState === 'undefined' || !bkmpIdleState || !bkmpIdleState.name_key) return;
  const status = bkmpEventStatusOf(ev);
  if (status === 'COMING_SOON') { bkmpEventRefreshUi(); return; }
  if (!force && Date.now() - bkmpEventLastTickAt < BKMP_EVENT_TICK_MS - 2000) return;
  if (status !== 'LIVE' && bkmpEventProgress && bkmpEventProgressFor === ev.id && !force) return;
  bkmpEventTickBusy = true;
  bkmpEventLastTickAt = Date.now();
  const sent = status === 'LIVE' ? { ...bkmpEventPending } : {};
  try {
    const res = await bkmpEventTickRpc(ev.id, sent);
    if (res && res.missing) { bkmpSpecialEventsMissing = true; return; }
    if (res) {
      const srv = Date.parse(res.server_now || '');
      if (Number.isFinite(srv)) bkmpEventServerOffsetMs = srv - Date.now();
      const acc = res.client_accepted || {};
      Object.keys(bkmpEventPending).forEach(k => { bkmpEventPending[k] = Math.max(0, (bkmpEventPending[k] || 0) - (Number(acc[k]) || 0)); });
      bkmpEventSavePending();
      const prevTier = bkmpEventProgress && bkmpEventProgressFor === ev.id ? Number(bkmpEventProgress.tier || 0) : null;
      const wasEarned = bkmpEventProgress && bkmpEventProgressFor === ev.id ? !!bkmpEventProgress.earned : null;
      bkmpEventProgress = res;
      bkmpEventProgressFor = ev.id;
      if (res.joined && typeof bkmpChronicleRecordEvent === 'function') {
        bkmpChronicleRecordEvent(ev.id, { joined: true, tier: Number(res.tier || 0), earned: !!res.earned, choice: res.choice_species || '', unlocks: res.unlocks || [] });
      }
      if (prevTier != null && Number(res.tier || 0) > prevTier) {
        bkmpEventToast(`☀️🌑 Zwielicht-Pass: Stufe ${res.tier} erreicht!`, 'success');
      }
      if (wasEarned === false && res.earned) bkmpEventPresentEarned(ev);
    }
  } catch (e) {
    /* Netzwerkfehler: offene Zaehler bleiben erhalten, naechster Versuch spaeter */
  } finally {
    bkmpEventTickBusy = false;
    bkmpEventRefreshUi();
  }
}
function bkmpEventStartTicker() {
  if (bkmpEventTickTimer) return;
  bkmpEventTickTimer = window.setInterval(() => {
    const overlay = document.getElementById('idleDorfOverlay');
    const ev = bkmpEventPassEvent();
    if (!overlay || !overlay.classList.contains('visible') || !ev || bkmpEventStatusOf(ev) !== 'LIVE') {
      window.clearInterval(bkmpEventTickTimer);
      bkmpEventTickTimer = null;
      return;
    }
    if (document.hidden) return;
    bkmpEventTick(false);
  }, 15000);
}
/* Hook aus bkmpIdleOpenModal (idledorf.js). */
async function bkmpEventOnIdleOpen() {
  bkmpEventLoadPending();
  await bkmpEventsEnsureLoaded(false);
  const ev = bkmpEventPassEvent();
  if (!ev) { bkmpEventRefreshUi(); return; }
  await bkmpEventTick(true);
  if (bkmpEventStatusOf(ev) === 'LIVE') bkmpEventStartTicker();
}

/* ---------------- Hilfen fuer die Anzeige ---------------- */
function bkmpEventQuestDef(config, id) {
  const all = []
    .concat((config.daily && config.daily.normal) || [])
    .concat((config.daily && config.daily.hard) || [])
    .concat(config.weekly || [])
    .concat(config.weekly_alts || []);
  return all.find(q => q.id === id) || null;
}
function bkmpEventQuestText(metric, target) {
  const meta = BKMP_EVENT_METRIC_META[metric];
  return meta ? meta.unit(target) : `${metric}: ${bkmpEventFmt(target)}`;
}
function bkmpEventCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d} T. ${h} Std. ${m} Min.`;
  if (h > 0) return `${h} Std. ${m} Min.`;
  return `${m} Min. ${String(sec).padStart(2, '0')} Sek.`;
}
function bkmpEventDateText(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(t)) + ' Uhr';
}
function bkmpEventRewardText(rw) {
  if (!rw) return '';
  if (rw.choice) return '☀️ Lightnix oder 🌑 Darknix';
  const parts = [];
  if (rw.gold_units) parts.push(`💰 ${bkmpEventNum(Math.round(Number(rw.gold_units) * bkmpEventGoldUnit()))}`);
  if (rw.wood) parts.push(`🌳 ${bkmpEventNum(rw.wood)}`);
  if (rw.stone) parts.push(`🗿 ${bkmpEventNum(rw.stone)}`);
  if (rw.crystals) parts.push(`💎 ${bkmpEventNum(rw.crystals)}`);
  if (rw.essence) parts.push(`🧪 ${bkmpEventNum(rw.essence)}`);
  if (rw.fruit) parts.push(`🍎 ${bkmpEventNum(rw.fruit)}`);
  if (rw.meat) parts.push(`🥩 ${bkmpEventNum(rw.meat)}`);
  (rw.runes || []).forEach(r => parts.push(`🔮 ${r.count}× Rune`));
  (rw.species_eggs || []).forEach(id => parts.push(`🥚 Garantiertes ${bkmpEventEggSpeciesName(id)}-Ei`));
  if (rw.eggs) parts.push(`🥚 ${rw.eggs}× Drachenei`);
  (rw.boosts || []).forEach(b => parts.push(b === 'gold' ? '⏱️ 30 Min. Goldrausch' : '⏱️ 30 Min. Wissensschub'));
  if (rw.unlock === 'title_zwielicht') parts.push('🏷️ Titel');
  if (rw.unlock === 'badge_zwielicht') parts.push('🏅 Abzeichen');
  if (rw.unlock === 'cosmetic_zwielicht') parts.push('🎨 Namensfarbe');
  return parts.join(' · ');
}
/* Gold-Belohnungen: Einheit wie der Server (village_gold_unit). */
function bkmpEventGoldUnit() {
  const stage = Math.max(0, Number((typeof bkmpIdleState !== 'undefined' && bkmpIdleState && bkmpIdleState.highest_dragon_index) || 0));
  return Math.max(6, Math.round(6 * Math.pow(1 + 0.05 * stage, 1.2)));
}
function bkmpEventClaimableTiers(ev, prog) {
  if (!ev || !prog || !prog.joined) return [];
  const claimed = new Set((prog.tier_claimed || []).map(Number));
  const out = [];
  for (let t = 1; t <= Number(prog.tier || 0); t++) if (!claimed.has(t)) out.push(t);
  return out;
}
function bkmpEventChoiceOpen(prog) {
  return !!(prog && prog.joined && prog.earned && !prog.choice_species && !prog.already_claimed_group);
}
function bkmpEventSpeciesName(ev, id) {
  const c = ev && ev.config && ev.config.choices && ev.config.choices[id];
  return c ? `${c.icon} ${c.name}` : id;
}

/* ---------------- Pass-Karte (Desktop) + HUD-Knopf ---------------- */
/* Garantierte Pass-Eier (reward.species_eggs): Name/Bild aus dem echten
   Artenkatalog; ohne geladenen Katalog (z.B. Website ohne Login) reicht
   der Name aus der Art-ID. */
function bkmpEventEggSpecies(id) {
  return typeof bkmpDragonSpeciesById === 'function' ? bkmpDragonSpeciesById(id) : null;
}
function bkmpEventEggSpeciesName(id) {
  const sp = bkmpEventEggSpecies(id);
  if (sp && sp.name) return sp.name;
  const s = String(id || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function bkmpEventEggThumbHtml(id) {
  const sp = bkmpEventEggSpecies(id);
  if (!sp || !sp.egg_image || typeof bkmpDragonThumbHtml !== 'function') return '';
  return bkmpDragonThumbHtml(sp.egg_image, bkmpEventEsc(bkmpEventEggSpeciesName(id) + '-Ei'), 'bkmp-event-egg-thumb');
}
/* Die grossen Meilensteine (feste Eier + Hauptbelohnung), damit man schon
   beim Start sieht, worauf man hinarbeitet - rein aus der Konfiguration. */
function bkmpEventHighlights(ev) {
  const out = [];
  ((ev && ev.config && ev.config.tiers) || []).forEach(t => {
    const rw = t.reward || {};
    (rw.species_eggs || []).forEach(id => out.push({ tier: t.tier, kind: 'egg', id, text: `🥚 Garantiertes ${bkmpEventEggSpeciesName(id)}-Ei` }));
    if (rw.choice) out.push({ tier: t.tier, kind: 'choice', text: '☀️ Lightnix oder 🌑 Darknix' });
  });
  return out;
}
function bkmpEventHighlightsHtml(ev, prog) {
  const list = bkmpEventHighlights(ev);
  if (!list.length) return '';
  const tier = prog && prog.joined ? Number(prog.tier || 0) : 0;
  return `<div class="bkmp-event-highlights" data-testid="event-highlights">${list.map(h => `
    <div class="bkmp-event-highlight${h.tier <= tier ? ' is-reached' : ''}${h.kind === 'choice' ? ' is-choice' : ''}" data-testid="event-highlight-${h.tier}">
      ${h.kind === 'egg' ? bkmpEventEggThumbHtml(h.id) : '<span class="bkmp-event-highlight-icon">☀️🌑</span>'}
      <span class="bkmp-event-highlight-tier">Stufe ${h.tier}</span>
      <span class="bkmp-event-highlight-text">${bkmpEventEsc(h.text)}</span>
    </div>`).join('')}</div>`;
}
function bkmpEventNextHighlight(ev, prog) {
  const tier = prog && prog.joined ? Number(prog.tier || 0) : 0;
  return bkmpEventHighlights(ev).find(h => h.tier > tier) || null;
}
function bkmpEventEnsureEntryPoints() {
  if (!document.getElementById('idleEventPassCard')) {
    const chron = document.getElementById('idleChronicleCard');
    if (chron && chron.parentNode) {
      const card = document.createElement('div');
      card.className = 'idle-event-pass-card';
      card.id = 'idleEventPassCard';
      card.hidden = true;
      card.setAttribute('data-testid', 'event-pass-card');
      chron.parentNode.insertBefore(card, chron);
    }
  }
  if (!document.getElementById('bkmpProtoChudEventBtn')) {
    const chronBtn = document.getElementById('bkmpProtoChudChronicleBtn');
    if (chronBtn && chronBtn.parentNode) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bkmp-proto-chud-icon-btn bkmp-event-hud-btn';
      btn.id = 'bkmpProtoChudEventBtn';
      btn.hidden = true;
      btn.setAttribute('data-event-open', 'today');
      btn.setAttribute('data-testid', 'event-hud-btn');
      btn.setAttribute('aria-label', 'Zwielicht-Pass öffnen');
      btn.title = 'Zwielicht-Pass';
      btn.innerHTML = '☀️🌑<span class="bkmp-chronicle-badge" data-event-badge hidden></span>';
      chronBtn.parentNode.insertBefore(btn, chronBtn.nextSibling);
    }
  }
}
function bkmpEventCardHtml(ev, prog) {
  const status = bkmpEventStatusOf(ev);
  const texts = (ev.config && ev.config.texts) || {};
  if (status === 'COMING_SOON') {
    return `
      <div class="idle-event-card-head"><span class="idle-event-card-title">${bkmpEventEsc(texts.teaser_title || ev.name)}</span></div>
      <div class="idle-event-card-teaser">${bkmpEventEsc((texts.teaser_lines || [])[0] || ev.subtitle || '')}</div>
      <div class="idle-event-card-countdown">Start in <strong data-event-countdown="${bkmpEventEsc(ev.starts_at)}">${bkmpEventCountdown(Date.parse(ev.starts_at) - bkmpEventNow())}</strong></div>
      <button type="button" class="idle-chron-open-btn" data-event-open="info">Mehr erfahren</button>`;
  }
  if (!prog || !prog.joined) {
    if (status !== 'LIVE') return '';
    return `
      <div class="idle-event-card-head"><span class="idle-event-card-title">${bkmpEventEsc(texts.pass_name || ev.name)}</span></div>
      <div class="idle-event-card-teaser">⏳ Wird geladen…</div>`;
  }
  if (prog.choice_species) {
    return `<div class="idle-event-card-head"><span class="idle-event-card-title">${bkmpEventEsc(bkmpEventSpeciesName(ev, prog.choice_species))} erhalten ✅</span></div>
      <button type="button" class="idle-chron-quicklink" data-event-open="rewards">Zwielicht-Pass</button>`;
  }
  const tp = bkmpEventTierProgress(prog.points, ev.points_per_tier, ev.tier_count);
  const claimable = bkmpEventClaimableTiers(ev, prog).length;
  const choice = bkmpEventChoiceOpen(prog);
  const dailyDone = (prog.day_quests || []).filter(q => q.done).length;
  const nextHl = bkmpEventNextHighlight(ev, prog);
  return `
    <div class="idle-event-card-head">
      <span class="idle-event-card-title">${bkmpEventEsc(texts.pass_name || ev.name)}</span>
      <span class="idle-event-card-tier" data-testid="event-card-tier">Stufe ${tp.tier} / ${ev.tier_count}</span>
    </div>
    <div class="idle-xp-bar idle-event-bar"><div class="idle-xp-fill" style="width:${tp.maxed ? 100 : Math.round(tp.into / tp.need * 100)}%"></div></div>
    <div class="idle-event-card-sub">${tp.maxed ? '✨ Stufe 30 erreicht' : `${tp.into} / ${tp.need} ${bkmpEventEsc(texts.points_name || 'Punkte')}`} · Heute ${dailyDone}/${(prog.day_quests || []).length}</div>
    ${nextHl ? `<div class="idle-event-card-next" data-testid="event-card-next">Als Nächstes: <strong>Stufe ${nextHl.tier}</strong> · ${bkmpEventEsc(nextHl.text)}</div>` : ''}
    ${status === 'LIVE' ? `<div class="idle-event-card-countdown">Endet in <strong data-event-countdown="${bkmpEventEsc(ev.ends_at)}">${bkmpEventCountdown(Date.parse(ev.ends_at) - bkmpEventNow())}</strong></div>` : ''}
    <button type="button" class="idle-chron-open-btn" data-event-open="${choice ? 'choice' : 'today'}">${choice ? '✨ Deine Wahl wartet' : claimable ? `🎁 ${claimable} Belohnung${claimable === 1 ? '' : 'en'} abholen` : 'Pass öffnen'}</button>`;
}
function bkmpEventRefreshUi() {
  bkmpEventEnsureEntryPoints();
  const ev = bkmpEventPassEvent();
  const prog = ev && bkmpEventProgressFor === ev.id ? bkmpEventProgress : null;
  const card = document.getElementById('idleEventPassCard');
  const hudBtn = document.getElementById('bkmpProtoChudEventBtn');
  const status = ev ? bkmpEventStatusOf(ev) : 'HIDDEN';
  /* Nach Eventende nur noch zeigen, solange es etwas zu tun gibt (Wahl/
     Belohnungen) - danach keine Event-Werbung mehr (Auftrag 95). */
  const ended = status === 'ENDED' || status === 'ARCHIVED';
  const pendingWork = prog && (bkmpEventChoiceOpen(prog) || bkmpEventClaimableTiers(ev, prog).length > 0);
  const show = !!ev && (status === 'LIVE' || status === 'COMING_SOON' || (ended && pendingWork));
  const modsHtml = bkmpEventModifierChipsHtml();
  if (card) {
    if ((show || modsHtml) && !(card.matches(':hover') && card.childElementCount)) {
      const html = (show ? bkmpEventCardHtml(ev, prog) : '') + modsHtml;
      if (card.innerHTML !== html) card.innerHTML = html;
    }
    card.hidden = (!show && !modsHtml) || !card.innerHTML;
  }
  if (hudBtn) {
    hudBtn.hidden = !show && !modsHtml;
    hudBtn.setAttribute('data-event-open', prog && bkmpEventChoiceOpen(prog) ? 'choice' : 'today');
    const badge = hudBtn.querySelector('[data-event-badge]');
    const n = prog ? bkmpEventClaimableTiers(ev, prog).length + (bkmpEventChoiceOpen(prog) ? 1 : 0) : 0;
    if (badge) { badge.hidden = n <= 0; badge.textContent = n > 9 ? '9+' : String(n); }
  }
  const overlay = document.getElementById('bkmpEventPassOverlay');
  if (overlay && overlay.classList.contains('visible')) bkmpEventRenderModalBody();
  bkmpEventStartCountdowns();
}
/* Kleine Wochenereignisse (Phase 11): laufende Boni als kurze Hinweise. */
function bkmpEventModifierChipsHtml() {
  const live = bkmpEventLiveModifierEvents().filter(e => !(e.config && Array.isArray(e.config.tiers) && e.config.tiers.length));
  if (!live.length) return '';
  return `<div class="idle-event-mods" data-testid="event-modifiers">${live.map(e => `
    <div class="idle-event-mod" title="${bkmpEventEsc(e.description || '')}">
      <strong>${bkmpEventEsc((e.config && e.config.icon) || '✨')} ${bkmpEventEsc(e.name)}</strong>
      <span>${bkmpEventEsc((e.config && e.config.short) || e.subtitle || '')} · noch <span data-event-countdown="${bkmpEventEsc(e.ends_at)}">${bkmpEventCountdown(Date.parse(e.ends_at) - bkmpEventNow())}</span></span>
    </div>`).join('')}</div>`;
}
/* Countdowns: nur Textknoten, nur solange sichtbar - stoppt sich selbst. */
function bkmpEventStartCountdowns() {
  if (bkmpEventCountdownTimer) return;
  bkmpEventCountdownTimer = window.setInterval(() => {
    const nodes = Array.from(document.querySelectorAll('[data-event-countdown]')).filter(n => n.offsetParent !== null);
    if (!nodes.length) { window.clearInterval(bkmpEventCountdownTimer); bkmpEventCountdownTimer = null; return; }
    let ended = false;
    nodes.forEach(n => {
      const left = Date.parse(n.getAttribute('data-event-countdown')) - bkmpEventNow();
      if (left <= 0) ended = true;
      const text = bkmpEventCountdown(left);
      if (n.textContent !== text) n.textContent = text;
    });
    if (ended) {
      window.clearInterval(bkmpEventCountdownTimer);
      bkmpEventCountdownTimer = null;
      bkmpEventsEnsureLoaded(true).then(() => bkmpEventTick(true)).then(bkmpEventRefreshUi).catch(() => {});
    }
  }, 1000);
}

/* ---------------- Pass-Fenster ---------------- */
const BKMP_EVENT_MODAL_TABS = [
  { id: 'today', label: '📅 Heute' },
  { id: 'week', label: '🗓️ Woche' },
  { id: 'rewards', label: '🎁 Belohnungen' },
  { id: 'faq', label: '❓ FAQ' }
];
function bkmpEventEnsureModal() {
  if (document.getElementById('bkmpEventPassOverlay') || typeof bkmpUiModalHtml !== 'function') return;
  document.body.insertAdjacentHTML('beforeend', bkmpUiModalHtml({
    id: 'bkmpEventPass',
    titleHtml: '<span id="bkmpEventPassTitleText">☀️🌑 Zwielicht-Pass</span>',
    bodyHtml: `
      <div class="bkmp-event-head" id="bkmpEventPassHead"></div>
      <div class="bkmp-chron-tabs" role="tablist" id="bkmpEventPassTabs">
        ${BKMP_EVENT_MODAL_TABS.map(t => `<button type="button" class="bkmp-chron-tab" role="tab" data-event-action="tab" data-tab-id="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="bkmp-chron-body bkmp-event-body" id="bkmpEventPassBody" role="tabpanel"></div>`,
    buttonsHtml: '<button type="button" class="btn-nein" id="bkmpEventPassCloseBtn">Schließen</button>',
    extraClass: 'bkmp-chron-card bkmp-event-card'
  }));
  const overlay = document.getElementById('bkmpEventPassOverlay');
  overlay.classList.add('zone-game', 'bkmp-chron-overlay', 'bkmp-event-overlay');
  overlay.setAttribute('data-testid', 'event-pass-modal');
  if (typeof bkmpUiTrapFocus === 'function') bkmpUiTrapFocus(overlay);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) { bkmpEventCloseModal(); return; }
    const el = e.target.closest('[data-event-action]');
    if (!el || el.disabled) return;
    const a = el.dataset.eventAction;
    if (a === 'tab') { bkmpEventModalTab = el.dataset.tabId; bkmpEventRenderModalBody(); }
    else if (a === 'claim') bkmpEventClaimTiers();
    else if (a === 'choose') bkmpEventChoose(el.dataset.species);
  });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') bkmpEventCloseModal(); });
  document.getElementById('bkmpEventPassCloseBtn').addEventListener('click', bkmpEventCloseModal);
}
async function bkmpEventOpenModal(tab) {
  bkmpEventEnsureModal();
  const overlay = document.getElementById('bkmpEventPassOverlay');
  if (!overlay) return;
  bkmpEventModalTab = tab && tab !== 'info' && tab !== 'choice' ? tab : (tab === 'choice' ? 'rewards' : 'today');
  overlay.classList.add('visible');
  bkmpEventRenderModalBody();
  const first = overlay.querySelector('.bkmp-chron-tab');
  if (first) first.focus();
  if (!bkmpEventProgress) bkmpEventTick(true);
}
function bkmpEventCloseModal() {
  const overlay = document.getElementById('bkmpEventPassOverlay');
  if (overlay) overlay.classList.remove('visible');
}
function bkmpEventHeadHtml(ev, prog) {
  const status = bkmpEventStatusOf(ev);
  const texts = ev.config.texts || {};
  if (status === 'COMING_SOON') {
    return `<div class="bkmp-event-teaser" data-testid="event-teaser">
      <div class="bkmp-event-teaser-title">${bkmpEventEsc(texts.teaser_title || ev.name)}</div>
      ${(texts.teaser_lines || []).map(l => `<p>${bkmpEventEsc(l)}</p>`).join('')}
      <div class="bkmp-event-teaser-when">Start: ${bkmpEventEsc(bkmpEventDateText(ev.starts_at))} · noch <strong data-event-countdown="${bkmpEventEsc(ev.starts_at)}">${bkmpEventCountdown(Date.parse(ev.starts_at) - bkmpEventNow())}</strong></div>
    </div>`;
  }
  if (!prog || !prog.joined) {
    return status === 'LIVE'
      ? '<p class="bkmp-chron-empty">⏳ Dein Pass wird geladen…</p>'
      : `<p class="bkmp-event-end">${bkmpEventEsc(texts.end_not_earned || 'Das Event ist vorüber.')}</p>`;
  }
  const tp = bkmpEventTierProgress(prog.points, ev.points_per_tier, ev.tier_count);
  const claimable = bkmpEventClaimableTiers(ev, prog);
  let endText = '';
  if (status === 'ENDED' || status === 'ARCHIVED') {
    endText = prog.choice_species
      ? String(texts.end_chosen || 'Dein {species} begleitet dich weiterhin.').replace('{species}', bkmpEventSpeciesName(ev, prog.choice_species))
      : prog.earned ? (texts.end_earned_open || 'Du hast die Prüfung bestanden. Deine Wahl wartet.') : (texts.end_not_earned || 'Das Zwielicht ist vorüber.');
  }
  return `
    <div class="bkmp-event-tierline">
      <span class="bkmp-event-tier" data-testid="event-tier">Stufe ${tp.tier} / ${ev.tier_count}</span>
      <span class="bkmp-event-points">${tp.maxed ? '✨ Stufe 30 erreicht' : `${tp.into} / ${tp.need} ${bkmpEventEsc(texts.points_name || 'Punkte')}`}</span>
    </div>
    <div class="idle-xp-bar idle-event-bar"><div class="idle-xp-fill" style="width:${tp.maxed ? 100 : Math.round(tp.into / tp.need * 100)}%"></div></div>
    ${status === 'LIVE'
      ? `<div class="bkmp-event-ends">Event endet ${bkmpEventEsc(bkmpEventDateText(ev.ends_at))} · noch <strong data-event-countdown="${bkmpEventEsc(ev.ends_at)}">${bkmpEventCountdown(Date.parse(ev.ends_at) - bkmpEventNow())}</strong></div>`
      : `<div class="bkmp-event-end" data-testid="event-end-text">${bkmpEventEsc(endText)}</div>`}
    ${claimable.length ? `<button type="button" class="btn-ja bkmp-event-claim-btn" data-event-action="claim" data-testid="event-claim-btn" ${bkmpEventBusy ? 'disabled' : ''}>🎁 ${claimable.length} Stufenbelohnung${claimable.length === 1 ? '' : 'en'} abholen</button>` : ''}`;
}
function bkmpEventTodayHtml(ev, prog) {
  if (!prog || !prog.joined) return '';
  const cfg = ev.config;
  const base = prog.day_base || {};
  const cum = prog.cumulative || {};
  const rows = (prog.day_quests || []).map(q => {
    const def = bkmpEventQuestDef(cfg, q.id) || {};
    const have = Math.max(0, Number(cum[q.metric] || 0) - Number(base[q.metric] || 0));
    const pct = Math.min(100, Math.floor(have / Math.max(1, q.target) * 100));
    const meta = BKMP_EVENT_METRIC_META[q.metric] || { icon: '•' };
    const val = q.metric === 'active' ? `${bkmpEventDuration(Math.min(have, q.target))} / ${bkmpEventDuration(q.target)}` : `${bkmpEventNum(Math.min(have, q.target))} / ${bkmpEventNum(q.target)}`;
    return `<div class="bkmp-chron-quest bkmp-event-quest${q.done ? ' is-claimed' : ''}${q.kind === 'hard' ? ' is-hard' : ''}" data-testid="event-daily-quest">
      <div class="bkmp-chron-quest-main">
        <div class="bkmp-chron-quest-text">${meta.icon} <strong>${bkmpEventEsc(def.name || q.id)}</strong>${q.kind === 'hard' ? ' <span class="bkmp-event-hard">schwer</span>' : ''} – ${bkmpEventEsc(bkmpEventQuestText(q.metric, q.target))}</div>
        <div class="idle-xp-bar"><div class="idle-xp-fill" style="width:${q.done ? 100 : pct}%"></div></div>
        <div class="bkmp-chron-quest-progress">${q.done ? '✅ erledigt' : val}</div>
      </div>
      <span class="bkmp-event-quest-pts">+${q.points}</span>
    </div>`;
  }).join('');
  const done = (prog.day_quests || []).filter(q => q.done).length;
  const closure = (cfg.daily && cfg.daily.closure) || { need: 4, points: 100, name: 'Tagesabschluss', icon: '🌗' };
  const next = bkmpEventNextBerlinMidnight(bkmpEventNow());
  return `
    <p class="bkmp-event-hint">Neue Prüfungen jeden Tag um 00:00 Uhr – noch <strong data-event-countdown="${new Date(next).toISOString()}">${bkmpEventCountdown(next - bkmpEventNow())}</strong>. Fortschritt wird etwa einmal pro Minute aktualisiert.</p>
    ${rows || '<p class="bkmp-chron-empty">Die heutigen Prüfungen erscheinen gleich…</p>'}
    <div class="bkmp-chron-quest bkmp-event-quest bkmp-event-closure${prog.day_closure_done ? ' is-claimed' : ''}" data-testid="event-daily-closure">
      <div class="bkmp-chron-quest-main">
        <div class="bkmp-chron-quest-text">${bkmpEventEsc(closure.icon || '🌗')} <strong>${bkmpEventEsc(closure.name || 'Tagesabschluss')}</strong> – Erledige ${closure.need} von ${(prog.day_quests || []).length} heutigen Prüfungen</div>
        <div class="bkmp-chron-quest-progress">${prog.day_closure_done ? '✅ erledigt' : `${Math.min(done, closure.need)} / ${closure.need}`}</div>
      </div>
      <span class="bkmp-event-quest-pts">+${closure.points}</span>
    </div>`;
}
function bkmpEventWeekHtml(ev, prog) {
  if (!prog || !prog.joined) return '';
  const cum = prog.cumulative || {};
  return (prog.weekly_quests || []).map(q => {
    const def = bkmpEventQuestDef(ev.config, q.id) || {};
    const done = Number((prog.weekly_done || {})[q.id] || 0);
    const meta = BKMP_EVENT_METRIC_META[q.metric] || { icon: '•' };
    const have = Number(cum[q.metric] || 0);
    const stageIdx = Math.min(done, q.stages.length - 1);
    const target = q.stages[stageIdx][0];
    const pct = done >= q.stages.length ? 100 : Math.min(100, Math.floor(have / Math.max(1, target) * 100));
    const fmt = v => q.metric === 'active' ? bkmpEventDuration(v) : bkmpEventNum(v);
    return `<div class="bkmp-chron-quest bkmp-event-quest${done >= q.stages.length ? ' is-claimed' : ''}" data-testid="event-weekly-quest">
      <div class="bkmp-chron-quest-main">
        <div class="bkmp-chron-quest-text">${meta.icon} <strong>${bkmpEventEsc(def.name || q.id)}</strong> ${q.stages.map((s, i) => `<span class="bkmp-event-pip${i < done ? ' is-done' : ''}" title="Stufe ${i + 1}: ${bkmpEventEsc(bkmpEventQuestText(q.metric, s[0]))} (+${s[1]})">${['I', 'II', 'III', 'IV'][i] || i + 1}</span>`).join('')}</div>
        <div class="bkmp-chron-quest-sub">${done >= q.stages.length ? '✅ alle Stufen geschafft' : bkmpEventEsc(bkmpEventQuestText(q.metric, target)) + ` (+${q.stages[stageIdx][1]})`}</div>
        <div class="idle-xp-bar"><div class="idle-xp-fill" style="width:${pct}%"></div></div>
        <div class="bkmp-chron-quest-progress">${fmt(Math.min(have, target))} / ${fmt(target)}</div>
      </div>
    </div>`;
  }).join('') || '<p class="bkmp-chron-empty">Keine Wochenquests.</p>';
}
function bkmpEventChoiceHtml(ev, prog) {
  const texts = ev.config.texts || {};
  const choices = ev.config.choices || {};
  if (prog && prog.choice_species) {
    return `<div class="bkmp-event-chosen" data-testid="event-chosen">${bkmpEventEsc(bkmpEventSpeciesName(ev, prog.choice_species))} erhalten ✅ <span class="dd-muted">– dein Ei liegt im Drachenlager.</span></div>`;
  }
  if (prog && prog.already_claimed_group) {
    return '<div class="bkmp-event-chosen">Du hast bereits einen Drachen aus dieser Prüfung erhalten ✅</div>';
  }
  if (!bkmpEventChoiceOpen(prog)) return '';
  const card = id => {
    const c = choices[id] || { name: id, icon: '', text: '' };
    const img = (ev.assets && ev.assets[id]) || `assets/dragons/breeding/adult/${id}.png`;
    return `<div class="bkmp-event-choice bkmp-event-choice-${bkmpEventEsc(id)}">
      ${typeof bkmpDragonThumbHtml === 'function' ? bkmpDragonThumbHtml(img, c.name) : ''}
      <div class="bkmp-event-choice-name">${bkmpEventEsc(c.icon)} ${bkmpEventEsc(String(c.name).toUpperCase())}</div>
      <div class="bkmp-event-choice-text">${bkmpEventEsc(c.text)}</div>
      <button type="button" class="btn-ja" data-event-action="choose" data-species="${bkmpEventEsc(id)}" data-testid="event-choose-${bkmpEventEsc(id)}" ${bkmpEventBusy ? 'disabled' : ''}>${bkmpEventEsc(c.icon)} ${bkmpEventEsc(c.name)} wählen</button>
    </div>`;
  };
  return `<div class="bkmp-event-choice-wrap" data-testid="event-choice">
    <div class="bkmp-event-choice-title">${bkmpEventEsc(texts.earned_title || '✨ DAS ZWIELICHT ANTWORTET')}</div>
    <div class="bkmp-event-choice-grid">${(ev.reward_species || []).map(card).join('')}</div>
  </div>`;
}
function bkmpEventRewardsHtml(ev, prog) {
  const tiers = ev.config.tiers || [];
  const tier = prog && prog.joined ? Number(prog.tier || 0) : 0;
  const claimed = new Set(((prog && prog.tier_claimed) || []).map(Number));
  const texts = ev.config.texts || {};
  return bkmpEventChoiceHtml(ev, prog) + bkmpEventHighlightsHtml(ev, prog) + `<div class="bkmp-event-track">${tiers.map(t => {
    const reached = t.tier <= tier;
    const isLast = t.tier === ev.tier_count;
    const milestone = !!t.reward.label;
    const state = claimed.has(t.tier) ? 'is-claimed' : reached ? 'is-ready' : '';
    if (isLast) {
      return `<div class="bkmp-event-tier-row bkmp-event-tier-final ${state}" data-testid="event-tier-30">
        <div class="bkmp-event-final-title">${bkmpEventEsc(reached ? (texts.earned_title || '✨ DAS ZWIELICHT ANTWORTET') : (texts.tier30_title || '✨ DAS ZWIELICHT WARTET'))}</div>
        <div class="bkmp-event-final-text">${bkmpEventEsc(reached ? (prog && prog.choice_species ? bkmpEventSpeciesName(ev, prog.choice_species) + ' erhalten ✅' : 'Triff deine Wahl!') : (texts.tier30_text || 'Erreiche Stufe 30 und entscheide deinen Weg.'))}</div>
      </div>`;
    }
    const eggIds = t.reward.species_eggs || [];
    return `<div class="bkmp-event-tier-row ${state}${milestone ? ' is-milestone' : ''}${eggIds.length ? ' has-egg' : ''}" data-testid="event-tier-row-${t.tier}">
      <span class="bkmp-event-tier-num">${t.tier}</span>${eggIds.map(bkmpEventEggThumbHtml).join('')}
      <span class="bkmp-event-tier-reward">${milestone ? `<strong>${bkmpEventEsc(t.reward.label)}</strong><br>` : ''}${bkmpEventEsc(bkmpEventRewardText(t.reward))}</span>
      <span class="bkmp-event-tier-state">${claimed.has(t.tier) ? '✅' : reached ? '🎁' : '🔒'}</span>
    </div>`;
  }).join('')}</div>`;
}
function bkmpEventFaqHtml(ev) {
  const t = ev.config.texts || {};
  return `<div class="bkmp-event-faq">${(t.faq || []).map(([q, a]) => `<details><summary>${bkmpEventEsc(q)}</summary><p>${bkmpEventEsc(a)}</p></details>`).join('')}</div>`;
}
function bkmpEventRenderModalBody() {
  const overlay = document.getElementById('bkmpEventPassOverlay');
  const head = document.getElementById('bkmpEventPassHead');
  const body = document.getElementById('bkmpEventPassBody');
  if (!overlay || !head || !body) return;
  const ev = bkmpEventPassEvent();
  if (!ev) {
    head.innerHTML = bkmpEventModifierChipsHtml() || '<p class="bkmp-chron-empty">Gerade läuft kein Event.</p>';
    body.innerHTML = '';
    const tabs = document.getElementById('bkmpEventPassTabs');
    if (tabs) tabs.hidden = true;
    bkmpEventStartCountdowns();
    return;
  }
  if (overlay.querySelector('.bkmp-event-body') && overlay.matches(':hover') && overlay.querySelector('details[open]')) {
    /* Aufgeklappte FAQ nicht unter dem Cursor neu bauen. */
    return;
  }
  const titleEl = document.getElementById('bkmpEventPassTitleText');
  if (titleEl) titleEl.textContent = (ev.config.texts && ev.config.texts.pass_name) || ev.name;
  const prog = bkmpEventProgressFor === ev.id ? bkmpEventProgress : null;
  const status = bkmpEventStatusOf(ev);
  const headHtml = bkmpEventHeadHtml(ev, prog);
  if (head.innerHTML !== headHtml) head.innerHTML = headHtml;
  const tabs = document.getElementById('bkmpEventPassTabs');
  if (tabs) tabs.hidden = status === 'COMING_SOON';
  overlay.querySelectorAll('.bkmp-chron-tab').forEach(b => {
    const active = b.dataset.tabId === bkmpEventModalTab;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  let html;
  if (status === 'COMING_SOON') html = bkmpEventHighlightsHtml(ev, prog) + `<div class="bkmp-event-info">${(ev.config.texts.website_points || []).map(p => `<div>• ${bkmpEventEsc(p)}</div>`).join('')}</div>` + bkmpEventFaqHtml(ev);
  else if (bkmpEventModalTab === 'week') html = bkmpEventWeekHtml(ev, prog);
  else if (bkmpEventModalTab === 'rewards') html = bkmpEventRewardsHtml(ev, prog);
  else if (bkmpEventModalTab === 'faq') html = bkmpEventFaqHtml(ev);
  else html = (prog && prog.joined ? bkmpEventChoiceHtml(ev, prog) : '') + (status === 'LIVE' ? bkmpEventTodayHtml(ev, prog) : bkmpEventArchiveRowHtml(ev, prog));
  if (body.innerHTML !== html) body.innerHTML = html;
  bkmpEventStartCountdowns();
}

/* ---------------- Aktionen ---------------- */
async function bkmpEventClaimTiers() {
  const ev = bkmpEventPassEvent();
  if (!ev || bkmpEventBusy) return;
  bkmpEventBusy = true;
  bkmpEventRenderModalBody();
  try {
    if (typeof bkmpIdleFlushSyncNow === 'function') { try { await bkmpIdleFlushSyncNow(); } catch (e) { /* weiter */ } }
    const res = await bkmpEventClaimTiersRpc(ev.id);
    let serverEggs = [];
    if (res && typeof bkmpIdleState !== 'undefined' && bkmpIdleState) {
      const c = res.credited || {};
      ['wood', 'stone', 'crystals', 'essence', 'fruit', 'meat'].forEach(k => { bkmpIdleState[k] = Number(bkmpIdleState[k] || 0) + Number(c[k] || 0); });
      bkmpIdleState.gold = Number(bkmpIdleState.gold || 0) + Number(c.gold || 0);
      bkmpIdleState.total_gold_earned = Number(bkmpIdleState.total_gold_earned || 0) + Number(c.gold || 0);
      const runes = [];
      let eggs = 0;
      (res.items || []).forEach(it => {
        const rw = it.reward || {};
        (rw.runes || []).forEach(r => {
          for (let i = 0; i < Number(r.count || 0); i++) {
            const rune = typeof bkmpDungeonRollRune === 'function' ? bkmpDungeonRollRune(Number(r.tier || 0)) : null;
            if (rune) runes.push(rune);
          }
        });
        eggs += Number(rw.eggs || 0);
        (rw.boosts || []).forEach(b => { if (typeof bkmpDungeonGrantBoost === 'function') bkmpDungeonGrantBoost(b === 'gold' ? 'gold' : 'exp'); });
      });
      if (runes.length && typeof bkmpDungeonPersistRunes === 'function') bkmpDungeonPersistRunes(runes);
      for (let i = 0; i < eggs; i++) {
        const egg = typeof bkmpDungeonRollEgg === 'function' ? bkmpDungeonRollEgg(2) : null;
        if (egg && typeof bkmpDungeonPersistEgg === 'function') bkmpDungeonPersistEgg(egg);
      }
      /* Garantierte Eier (species_eggs) hat der Server bereits angelegt -
         hier nur lokal uebernehmen (nie selbst einfuegen, sonst doppelt). */
      serverEggs = Array.isArray(res.eggs) ? res.eggs : [];
      if (serverEggs.length && typeof bkmpPlayerDragonEggs !== 'undefined' && Array.isArray(bkmpPlayerDragonEggs)) {
        serverEggs.forEach(e => {
          if (e && e.id && !bkmpPlayerDragonEggs.some(x => x.id === e.id)) {
            bkmpPlayerDragonEggs.push({ id: e.id, species_id: e.species_id, name_key: bkmpIdleState ? bkmpIdleState.name_key : '', created_at: new Date().toISOString() });
          }
        });
        if (typeof bkmpDexReconcile === 'function') { try { bkmpDexReconcile(); } catch (err) { /* nur Anzeige */ } }
        if (typeof bkmpIdleRenderDragonsPanel === 'function' && typeof bkmpIdleActiveTab !== 'undefined' && bkmpIdleActiveTab === 'drachen') bkmpIdleRenderDragonsPanel();
      }
      if (bkmpEventProgress && bkmpEventProgressFor === ev.id) {
        bkmpEventProgress.tier_claimed = Array.from(new Set([...(bkmpEventProgress.tier_claimed || []), ...(res.items || []).map(i => i.tier)]));
        bkmpEventProgress.unlocks = res.unlocks || bkmpEventProgress.unlocks;
        const tp = bkmpEventTierProgress(bkmpEventProgress.points, ev.points_per_tier, ev.tier_count);
        for (let t = 1; t <= tp.tier; t++) if (!bkmpEventProgress.tier_claimed.includes(t)) bkmpEventProgress.tier_claimed.push(t);
      }
      if (typeof bkmpChronicleRecordEvent === 'function') bkmpChronicleRecordEvent(ev.id, { joined: true, unlocks: res.unlocks || [] });
      if (typeof bkmpIdleRecomputeEffectiveStats === 'function') bkmpIdleRecomputeEffectiveStats();
      if (typeof bkmpIdleRenderHud === 'function') bkmpIdleRenderHud();
      if (typeof bkmpIdleQueueSync === 'function') bkmpIdleQueueSync();
      const n = (res.items || []).length;
      bkmpEventToast(`🎁 ${n} Stufenbelohnung${n === 1 ? '' : 'en'} abgeholt!`, 'success');
      serverEggs.forEach(e => {
        const sp = bkmpEventEggSpecies(e.species_id);
        if (typeof bkmpRewardPresent === 'function') {
          bkmpRewardPresent({ tier: 'card', rarity: (sp && sp.rarity) || 'episch', title: `🥚 ${bkmpEventEggSpeciesName(e.species_id)}-Ei erhalten!`, description: `Garantierte Belohnung von Stufe ${e.tier}. Das Ei liegt im Drachenlager und kann wie gewohnt ausgebrütet werden.`, dedupeKey: 'event-egg-' + e.id });
        }
      });
    }
  } catch (e) {
    bkmpEventToast(e.message || String(e), 'danger');
  }
  bkmpEventBusy = false;
  bkmpEventRefreshUi();
}
async function bkmpEventChoose(speciesId) {
  const ev = bkmpEventPassEvent();
  if (!ev || bkmpEventBusy || !bkmpEventChoiceOpen(bkmpEventProgress)) return;
  const name = ((ev.config.choices || {})[speciesId] || {}).name || speciesId;
  const body = `Du kannst während dieses Events nur einen der beiden Drachen erhalten.\n\nMöchtest du wirklich ${name} wählen?`;
  const ok = typeof bkmpConfirmDialog === 'function'
    ? await bkmpConfirmDialog('⚠️ Diese Wahl ist dauerhaft.', body, `Ja, ${name} wählen`, 'Abbrechen')
    : window.confirm('⚠️ Diese Wahl ist dauerhaft.\n\n' + body);
  if (!ok) return;
  bkmpEventBusy = true;
  bkmpEventRenderModalBody();
  try {
    const res = await bkmpEventChooseRewardRpc(ev.id, speciesId);
    if (res && res.egg_id && typeof bkmpPlayerDragonEggs !== 'undefined' && Array.isArray(bkmpPlayerDragonEggs)) {
      if (!bkmpPlayerDragonEggs.some(e => e.id === res.egg_id)) {
        bkmpPlayerDragonEggs.push({ id: res.egg_id, species_id: speciesId, name_key: bkmpIdleState ? bkmpIdleState.name_key : '', created_at: new Date().toISOString() });
      }
    }
    if (bkmpEventProgress) { bkmpEventProgress.choice_species = speciesId; bkmpEventProgress.already_claimed_group = true; }
    if (typeof bkmpChronicleRecordEvent === 'function') bkmpChronicleRecordEvent(ev.id, { joined: true, earned: true, choice: speciesId });
    if (typeof bkmpIdleRenderDragonsPanel === 'function' && typeof bkmpIdleActiveTab !== 'undefined' && bkmpIdleActiveTab === 'drachen') bkmpIdleRenderDragonsPanel();
    if (typeof bkmpRewardPresent === 'function') {
      bkmpRewardPresent({ tier: 'card', rarity: 'legendaer', title: `${bkmpEventSpeciesName(ev, speciesId)} gehört jetzt zu dir!`, description: 'Dein Ei liegt im Drachenlager. Du kannst es jederzeit ausbrüten – es gibt keinen Zeitdruck.', dedupeKey: 'event-choice-' + ev.id });
    } else {
      bkmpEventToast(`✨ ${name} gehört jetzt zu dir! Das Ei liegt im Drachenlager.`, 'success');
    }
  } catch (e) {
    bkmpEventToast(e.message || String(e), 'danger');
    bkmpEventTick(true);
  }
  bkmpEventBusy = false;
  bkmpEventRefreshUi();
}
function bkmpEventPresentEarned(ev) {
  if (typeof bkmpRewardPresent === 'function') {
    bkmpRewardPresent({ tier: 'card', rarity: 'legendaer', title: ((ev.config.texts || {}).earned_title) || '✨ DAS ZWIELICHT ANTWORTET', description: '☀️ Lightnix oder 🌑 Darknix – öffne den Zwielicht-Pass und triff deine Wahl.', dedupeKey: 'event-earned-' + ev.id });
  } else {
    bkmpEventToast('✨ Stufe 30! Öffne den Zwielicht-Pass und triff deine Wahl.', 'success');
  }
}

/* ---------------- Archiv (Chronik) ---------------- */
function bkmpEventArchiveRowHtml(ev, prog) {
  const recs = typeof bkmpChronicleEventRecords === 'function' ? bkmpChronicleEventRecords() : {};
  const rec = recs[ev.id] || {};
  const tier = Math.max(Number(rec.tier || 0), prog && prog.joined ? Number(prog.tier || 0) : 0);
  const joined = rec.joined || (prog && prog.joined);
  const choice = rec.choice || (prog && prog.choice_species) || '';
  let form = '', bond = '';
  if (choice && typeof bkmpPlayerDragons !== 'undefined') {
    const d = bkmpPlayerDragons.find(x => x.species_id === choice);
    const sp = d && typeof bkmpDragonSpeciesById === 'function' ? bkmpDragonSpeciesById(d.species_id) : null;
    if (d) form = typeof bkmpDragonDexStageLabel === 'function' ? bkmpDragonDexStageLabel(sp, d.stage) : d.stage;
    else if ((typeof bkmpPlayerDragonEggs !== 'undefined' ? bkmpPlayerDragonEggs : []).some(e => e.species_id === choice)) form = 'Ei';
    if (d && typeof bkmpDragonBondLevel === 'function') bond = String(bkmpDragonBondLevel(d.bond_xp));
  }
  return `<div class="bkmp-event-archive" data-testid="event-archive">
    <div class="bkmp-event-archive-title">${bkmpEventEsc(ev.name)}</div>
    ${joined ? `
      <div>Teilnahme: ✅</div>
      <div>Pass: ${tier}/${ev.tier_count}</div>
      ${choice ? `<div>Gewählt: ${bkmpEventEsc(bkmpEventSpeciesName(ev, choice))}</div>` : ''}
      ${form ? `<div>Aktuelle Form: ${bkmpEventEsc(form)}</div>` : ''}
      ${bond ? `<div>Bindung: ${bkmpEventEsc(bond)}</div>` : ''}
      ${!rec.earned && !(prog && prog.earned) ? '<div class="dd-muted">Event nicht abgeschlossen</div>' : ''}`
      : '<div class="dd-muted">Event nicht abgeschlossen</div>'}
  </div>`;
}
/* Fuer den Chronik-Reiter "Ziele": alle beendeten Events, an denen man
   teilgenommen hat (aus dem dauerhaften Chronik-Speicher). */
function bkmpEventArchiveHtml() {
  const recs = typeof bkmpChronicleEventRecords === 'function' ? bkmpChronicleEventRecords() : {};
  const ended = bkmpSpecialEvents.filter(e => ['ENDED', 'ARCHIVED'].includes(bkmpEventStatusOf(e)) && e.config && e.config.tiers);
  const ids = new Set([...Object.keys(recs), ...ended.map(e => e.id)]);
  if (!ids.size) return '';
  const rows = Array.from(ids).map(id => {
    const ev = bkmpSpecialEvents.find(e => e.id === id);
    if (ev && !['ENDED', 'ARCHIVED'].includes(bkmpEventStatusOf(ev))) return '';
    const fake = ev || { id, name: id === 'zwielicht' ? '☀️🌑 Das Erwachen des Zwielichts' : id, tier_count: 30, config: {} };
    return bkmpEventArchiveRowHtml(fake, bkmpEventProgressFor === id ? bkmpEventProgress : null);
  }).join('');
  return rows ? `<h4 class="bkmp-chron-section-title">🏛️ Vergangene Events</h4>${rows}` : '';
}
/* Erfolge/Titel/Kosmetik (siehe idledorf.js): Freischaltungen aus dem
   dauerhaften Chronik-Speicher, sonst aus dem letzten Zwischenspeicher. */
function bkmpEventAchievementFields(cacheFn) {
  const recs = typeof bkmpChronicleEventRecords === 'function' ? bkmpChronicleEventRecords() : null;
  if (!recs || !Object.keys(recs).length) {
    const c = typeof cacheFn === 'function' ? (cacheFn() || {}) : {};
    return { idleEventUnlocks: Array.isArray(c.idleEventUnlocks) ? c.idleEventUnlocks : [], idleEventEarned: Number(c.idleEventEarned || 0) };
  }
  const unlocks = new Set();
  let earned = 0;
  Object.values(recs).forEach(r => { (r.unlocks || []).forEach(u => unlocks.add(u)); if (r.earned) earned++; });
  return { idleEventUnlocks: Array.from(unlocks), idleEventEarned: earned };
}

/* ---------------- Website: "Was gibt's Neues?" (ohne Login) ---------------- */
function bkmpEventRenderWebsiteAnnouncement() {
  const feed = document.getElementById('newsFeed');
  if (!feed || !feed.parentNode) return;
  let box = document.getElementById('specialEventAnnouncement');
  const ev = bkmpEventPassEvent();
  const status = ev ? bkmpEventStatusOf(ev) : 'HIDDEN';
  if (!ev || (status !== 'COMING_SOON' && status !== 'LIVE')) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.id = 'specialEventAnnouncement';
    box.className = 'special-event-announce';
    box.setAttribute('data-testid', 'event-announcement');
    feed.parentNode.insertBefore(box, feed);
  }
  const t = ev.config.texts || {};
  const html = `
    <div class="special-event-announce-kicker">${status === 'LIVE' ? 'Jetzt live im Idle-Drachendorf' : 'Bald im Idle-Drachendorf'}</div>
    <h3 class="special-event-announce-title">${bkmpEventEsc(ev.name)}</h3>
    <p class="special-event-announce-sub">${bkmpEventEsc(ev.subtitle || '')}</p>
    <div class="special-event-announce-when">
      <span>Start: <strong>${bkmpEventEsc(bkmpEventDateText(ev.starts_at))}</strong></span>
      <span>Ende: <strong>${bkmpEventEsc(bkmpEventDateText(ev.ends_at))}</strong></span>
      <span>${status === 'LIVE' ? 'Endet in' : 'Beginnt in'} <strong data-event-countdown="${bkmpEventEsc(status === 'LIVE' ? ev.ends_at : ev.starts_at)}">${bkmpEventCountdown(Date.parse(status === 'LIVE' ? ev.ends_at : ev.starts_at) - bkmpEventNow())}</strong></span>
    </div>
    <ul class="special-event-announce-points">${(t.website_points || []).map(p => `<li>${bkmpEventEsc(p)}</li>`).join('')}</ul>
    <p class="special-event-announce-lore">${bkmpEventEsc(ev.lore || '')}</p>`;
  if (box.innerHTML !== html) box.innerHTML = html;
  bkmpEventStartCountdowns();
}
async function bkmpEventInitWebsite() {
  await bkmpEventsEnsureLoaded(false);
  bkmpEventRenderWebsiteAnnouncement();
}

(function bkmpEventWireDom() {
  if (typeof document === 'undefined') return;
  document.addEventListener('click', e => {
    const opener = e.target.closest('[data-event-open]');
    if (!opener) return;
    e.preventDefault();
    bkmpEventOpenModal(opener.getAttribute('data-event-open'));
  });
  const start = () => { bkmpEventEnsureEntryPoints(); bkmpEventInitWebsite().catch(() => {}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
