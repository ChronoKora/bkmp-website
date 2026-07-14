/* ============================================================
   Bkmp - MapArt Marketplace ("Kartenauftraege")
   Wird von index.html (Kunden-Ansicht: Auftrag erstellen, Board,
   eigene Auftraege, Firmenprofile) UND admin.html (Firmen-Dashboard,
   Admin-Verwaltung) geladen.

   Ladereihenfolge: supabase.js -> app.js -> mapart.js -> Inline-Script.
   escapeHtml()/bkmpCompressImageFile()/bkmpFormatCurrency() aus app.js
   und alle load/save-Funktionen aus supabase.js sind hier bereits
   verfuegbar.
   ============================================================ */

const BKMP_MAP_CATEGORIES = [
  { id: '2d_teppich', label: '2D Teppich' },
  { id: '2d_allblock', label: '2D All Block' },
  { id: '3d_wolle', label: '3D Wolle' },
  { id: '3d_allblock', label: '3D All Block' }
];
const BKMP_MAP_PRIORITIES = [
  { id: 'normal', label: 'Normal' },
  { id: 'schnell', label: 'Schnell' },
  { id: 'egal', label: 'Egal' }
];
const BKMP_MAP_BUDGET_STEPS = [250000, 300000, 350000, 400000, 450000, 500000];
const BKMP_MAP_BUDGET_MIN = 250000;
const BKMP_MAP_BUDGET_MAX = 500000;

const BKMP_MAP_STATUS_LABELS = {
  neu: 'Neu', offen: 'Offen', angenommen: 'Angenommen', in_bearbeitung: 'In Bearbeitung',
  rueckfrage: 'Rückfrage', wartet_auf_kunde: 'Wartet auf Kunde', fertig: 'Fertig',
  abgeschlossen: 'Abgeschlossen', abgebrochen: 'Abgebrochen'
};

/* Kartenauftraege-Preise/Budgets sind durchgehend In-Game-Gold (siehe
   BKMP_MAP_BUDGET_STEPS: 250.000-500.000, exakt im selben Groessenbereich
   wie die Dorf-Skin-Preise) - NICHT echtes Geld. bkmpFormatCurrency() aus
   app.js haengt aber ein Euro-Zeichen an (fuer das echte Finanz-Dashboard
   gedacht), was hier faelschlich "350.000 €" statt Gold anzeigte. Reine
   Zahl ohne Waehrungssymbol - das 💰-Symbol setzen die Aufrufstellen
   selbst davor, damit es nicht doppelt auftaucht wo es schon manuell
   steht (siehe z.B. bkmpMapRenderCompanyApplicationsList). */
function bkmpMapFormatMoney(n) {
  return new Intl.NumberFormat('de-DE').format(Math.round(Number(n) || 0));
}

/* Kappt an der letzten Wortgrenze VOR maxLen statt mitten im Wort (ein
   simples .slice(0, maxLen) zerschnitt zuvor Woerter wie "bestimmst" zu
   "besti..."). */
function bkmpMapTruncateWords(text, maxLen) {
  const s = text || '';
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…';
}

/* ---------------- Auftrag-erstellen: Formular-Status ---------------- */

let bkmpMapOrderState = {
  category: null,
  sizeKnown: true,
  budgetPerPart: BKMP_MAP_BUDGET_STEPS[0],
  budgetCustom: false,
  priority: 'normal',
  stagedFiles: []
};

function bkmpMapInitCategoryFilter() {
  const el = document.getElementById('mapOrderCategoryFilter');
  if (!el) return;
  el.innerHTML = BKMP_MAP_CATEGORIES.map(c => `<button type="button" data-category="${c.id}">${c.label}</button>`).join('');
  el.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    bkmpMapOrderState.category = btn.dataset.category;
    el.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
  }));
}

function bkmpMapInitPriorityFilter() {
  const el = document.getElementById('mapOrderPriorityFilter');
  if (!el) return;
  el.innerHTML = BKMP_MAP_PRIORITIES.map(p => `<button type="button" class="${p.id === 'normal' ? 'active' : ''}" data-priority="${p.id}">${p.label}</button>`).join('');
  el.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    bkmpMapOrderState.priority = btn.dataset.priority;
    el.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
  }));
}

function bkmpMapInitBudgetFilter() {
  const el = document.getElementById('mapOrderBudgetFilter');
  if (!el) return;
  el.innerHTML = BKMP_MAP_BUDGET_STEPS.map((v, i) => `<button type="button" class="${i === 0 ? 'active' : ''}" data-budget="${v}">💰 ${bkmpMapFormatMoney(v)}</button>`).join('');
  el.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    bkmpMapOrderState.budgetPerPart = Number(btn.dataset.budget);
    el.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    bkmpMapUpdateTotalPreview();
  }));
  const customToggle = document.getElementById('mapOrderBudgetCustomToggle');
  const customInput = document.getElementById('mapOrderBudgetCustomInput');
  if (customToggle && customInput) {
    customToggle.addEventListener('change', () => {
      bkmpMapOrderState.budgetCustom = customToggle.checked;
      customInput.style.display = customToggle.checked ? '' : 'none';
      el.style.opacity = customToggle.checked ? '0.4' : '1';
      el.style.pointerEvents = customToggle.checked ? 'none' : '';
      if (customToggle.checked) {
        customInput.value = bkmpMapOrderState.budgetPerPart;
        bkmpMapOrderState.budgetPerPart = Number(customInput.value);
      }
      bkmpMapUpdateTotalPreview();
    });
    customInput.addEventListener('input', () => {
      let v = Number(customInput.value) || BKMP_MAP_BUDGET_MIN;
      v = Math.min(BKMP_MAP_BUDGET_MAX, Math.max(BKMP_MAP_BUDGET_MIN, v));
      bkmpMapOrderState.budgetPerPart = v;
      bkmpMapUpdateTotalPreview();
    });
  }
}

function bkmpMapInitSizeToggle() {
  const knownBtn = document.getElementById('mapOrderSizeKnownBtn');
  const unsureBtn = document.getElementById('mapOrderSizeUnsureBtn');
  const knownFields = document.getElementById('mapOrderSizeKnownFields');
  const unsureFields = document.getElementById('mapOrderSizeUnsureFields');
  if (!knownBtn || !unsureBtn) return;
  function apply() {
    knownBtn.classList.toggle('active', bkmpMapOrderState.sizeKnown);
    unsureBtn.classList.toggle('active', !bkmpMapOrderState.sizeKnown);
    if (knownFields) knownFields.style.display = bkmpMapOrderState.sizeKnown ? '' : 'none';
    if (unsureFields) unsureFields.style.display = bkmpMapOrderState.sizeKnown ? 'none' : '';
    bkmpMapUpdateTotalPreview();
  }
  knownBtn.addEventListener('click', () => { bkmpMapOrderState.sizeKnown = true; apply(); });
  unsureBtn.addEventListener('click', () => { bkmpMapOrderState.sizeKnown = false; apply(); });
  apply();
}

function bkmpMapUpdateTotalPreview() {
  const preview = document.getElementById('mapOrderTotalPreview');
  if (!preview) return;
  const partsInput = document.getElementById('mapOrderParts');
  const parts = partsInput ? Number(partsInput.value) : 0;
  if (bkmpMapOrderState.sizeKnown && parts > 0 && bkmpMapOrderState.budgetPerPart) {
    preview.textContent = `Geschätzter Gesamtpreis: 💰 ${bkmpMapFormatMoney(bkmpMapOrderState.budgetPerPart * parts)}`;
  } else {
    preview.textContent = 'Gesamtpreis wird nach Beratung berechnet.';
  }
}

function bkmpMapInitReferenceImages() {
  const input = document.getElementById('mapOrderReferenceImages');
  const preview = document.getElementById('mapOrderReferencePreview');
  if (!input || !preview) return;
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    bkmpMapOrderState.stagedFiles = bkmpMapOrderState.stagedFiles.concat(files);
    input.value = '';
    bkmpMapRenderReferencePreview();
  });
  function bkmpMapRenderReferencePreview() {
    preview.innerHTML = bkmpMapOrderState.stagedFiles.map((f, i) => `
      <span class="map-ref-chip">${escapeHtml(f.name)} <button type="button" class="map-ref-remove" data-idx="${i}">&times;</button></span>`).join('');
    preview.querySelectorAll('.map-ref-remove').forEach(btn => btn.addEventListener('click', () => {
      bkmpMapOrderState.stagedFiles.splice(Number(btn.dataset.idx), 1);
      bkmpMapRenderReferencePreview();
    }));
  }
}

function bkmpMapResetOrderForm() {
  bkmpMapOrderState = { category: null, sizeKnown: true, budgetPerPart: BKMP_MAP_BUDGET_STEPS[0], budgetCustom: false, priority: 'normal', stagedFiles: [] };
  const form = document.getElementById('mapOrderForm');
  if (form) form.reset();
  bkmpMapInitCategoryFilter();
  bkmpMapInitPriorityFilter();
  bkmpMapInitBudgetFilter();
  bkmpMapInitSizeToggle();
  const preview = document.getElementById('mapOrderReferencePreview');
  if (preview) preview.innerHTML = '';
  const nameInput = document.getElementById('mapOrderMcName');
  if (nameInput && typeof bkmpGetMcName === 'function') nameInput.value = bkmpGetMcName();
  bkmpMapUpdateTotalPreview();
}

async function bkmpMapSubmitOrder() {
  const msg = document.getElementById('mapOrderSubmitMsg');
  const submitBtn = document.getElementById('mapOrderSubmitBtn');
  const setMsg = (text, isError) => { if (msg) { msg.textContent = text; msg.classList.toggle('error', Boolean(isError)); } };

  const mcName = (document.getElementById('mapOrderMcName') || {}).value || '';
  const discord = (document.getElementById('mapOrderDiscord') || {}).value || '';
  const title = (document.getElementById('mapOrderTitle') || {}).value || '';
  const description = (document.getElementById('mapOrderDescription') || {}).value || '';
  const width = Number((document.getElementById('mapOrderWidth') || {}).value) || null;
  const height = Number((document.getElementById('mapOrderHeight') || {}).value) || null;
  const parts = Number((document.getElementById('mapOrderParts') || {}).value) || null;
  const sizeNotes = (document.getElementById('mapOrderSizeNotes') || {}).value || '';
  const notes = (document.getElementById('mapOrderNotes') || {}).value || '';
  const consent = (document.getElementById('mapOrderConsent') || {}).checked;

  if (!mcName.trim()) { setMsg('Bitte deinen Minecraft-Namen eintragen.', true); return; }
  if (!title.trim()) { setMsg('Bitte einen Titel eintragen.', true); return; }
  if (!description.trim()) { setMsg('Bitte eine Beschreibung eintragen.', true); return; }
  if (!bkmpMapOrderState.category) { setMsg('Bitte eine Kategorie wählen.', true); return; }
  if (!consent) { setMsg('Bitte bestätige die Checkbox.', true); return; }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Wird veröffentlicht...';
  try {
    let session = typeof bkmpGetCustomerSession === 'function' ? await bkmpGetCustomerSession() : null;
    let newCode = null;
    if (!session) {
      const result = await bkmpCustomerSignUp(mcName, discord);
      newCode = result.code;
      session = await bkmpGetCustomerSession();
    }

    const total = bkmpMapOrderState.sizeKnown && parts ? bkmpMapOrderState.budgetPerPart * parts : null;
    const order = await createMapOrder({
      customer_auth_id: session.user.id,
      customer_display_name: mcName.trim(),
      customer_discord: discord.trim() || null,
      title: title.trim(),
      description: description.trim(),
      category: bkmpMapOrderState.category,
      size_known: bkmpMapOrderState.sizeKnown,
      size_width: bkmpMapOrderState.sizeKnown ? width : null,
      size_height: bkmpMapOrderState.sizeKnown ? height : null,
      size_parts: bkmpMapOrderState.sizeKnown ? parts : null,
      size_notes: bkmpMapOrderState.sizeKnown ? null : (sizeNotes.trim() || null),
      budget_per_part: bkmpMapOrderState.budgetPerPart,
      budget_is_custom: bkmpMapOrderState.budgetCustom,
      budget_total: total,
      priority: bkmpMapOrderState.priority,
      additional_notes: notes.trim() || null,
      status: 'offen'
    });

    const uploadedUrls = [];
    for (const file of bkmpMapOrderState.stagedFiles) {
      try {
        const compressed = await bkmpCompressImageFile(file);
        const blob = await (await fetch(compressed)).blob();
        const namedFile = new File([blob], file.name, { type: blob.type });
        const saved = await uploadOrderFile(order.id, namedFile, 'customer', mcName.trim());
        uploadedUrls.push(saved.storage_path);
      } catch (e) { console.warn('Referenzbild konnte nicht hochgeladen werden.', e); }
    }
    if (uploadedUrls.length) {
      await bkmpMapUpdateOrderReferenceImages(order.id, uploadedUrls);
    }

    await logOrderEvent({ order_id: order.id, event_type: 'created', actor_type: 'customer', actor_auth_id: session.user.id, actor_display_name: mcName.trim(), to_status: 'offen' });

    bkmpMapResetOrderForm();
    setMsg('Auftrag veröffentlicht!', false);
    if (newCode) bkmpMapShowRecoveryCode(newCode);
    bkmpMapRenderOpenOrders();
    bkmpMapRenderMyOrders();
  } catch (e) {
    console.error('Auftrag konnte nicht veröffentlicht werden.', e);
    setMsg('Auftrag konnte nicht veröffentlicht werden: ' + (e.message || 'Unbekannter Fehler'), true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Auftrag veröffentlichen';
  }
}

async function bkmpMapUpdateOrderReferenceImages(orderId, paths) {
  const client = bkmpGetSupabaseClient();
  if (!client) return;
  const { error } = await client.from('map_orders').update({ reference_image_urls: paths }).eq('id', orderId);
  if (error) console.warn('Referenzbilder konnten nicht gespeichert werden.', error);
}

function bkmpMapShowRecoveryCode(code) {
  const overlay = document.getElementById('mapCodeOverlay');
  const codeEl = document.getElementById('mapCodeValue');
  if (!overlay || !codeEl) return;
  codeEl.textContent = code;
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');
}

/* ---------------- Suche & Filter (gemeinsam genutzt) ---------------- */

function bkmpMapFilterOrders(orders, filters) {
  const f = filters || {};
  const q = (f.query || '').trim().toLowerCase();
  return (orders || []).filter(o => {
    if (f.status && o.status !== f.status) return false;
    if (f.category && o.category !== f.category) return false;
    if (f.priority && o.priority !== f.priority) return false;
    if (q) {
      const companyName = (bkmpMapAdminCompanies.find(c => c.id === o.assigned_company_id) || {}).name || '';
      const haystack = [o.title, o.order_number, o.customer_display_name, companyName].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function bkmpMapInitCategoryPillFilter(containerId, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<button type="button" class="active" data-category="">Alle</button>' + BKMP_MAP_CATEGORIES.map(c => `<button type="button" data-category="${c.id}">${c.label}</button>`).join('');
  el.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    el.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    onChange(btn.dataset.category);
  }));
}

/* ---------------- Offene Aufträge ---------------- */

let bkmpMapOpenOrdersCache = [];
let bkmpMapOpenOrdersFilters = { query: '', category: '' };

async function bkmpMapRenderOpenOrders() {
  const el = document.getElementById('mapOpenOrdersList');
  if (!el) return;
  el.innerHTML = '<p class="empty-hint">Lädt...</p>';
  try { bkmpMapOpenOrdersCache = (typeof loadOpenMapOrders === 'function' ? await loadOpenMapOrders() : []) || []; } catch (e) { console.warn(e); bkmpMapOpenOrdersCache = []; }
  bkmpMapRenderOpenOrdersFiltered();
}

function bkmpMapRenderOpenOrdersFiltered() {
  const el = document.getElementById('mapOpenOrdersList');
  if (!el) return;
  if (!bkmpMapOpenOrdersCache.length) { el.innerHTML = '<p class="empty-hint">Aktuell keine offenen Aufträge.</p>'; return; }
  const filtered = bkmpMapFilterOrders(bkmpMapOpenOrdersCache, bkmpMapOpenOrdersFilters);
  el.innerHTML = filtered.length ? filtered.map(o => bkmpMapRenderOrderCard(o, false)).join('') : '<p class="empty-hint">Keine Aufträge gefunden.</p>';
}

function bkmpMapInitOpenOrdersFilters() {
  const searchInput = document.getElementById('mapOpenOrdersSearch');
  if (searchInput) searchInput.addEventListener('input', () => { bkmpMapOpenOrdersFilters.query = searchInput.value; bkmpMapRenderOpenOrdersFiltered(); });
  bkmpMapInitCategoryPillFilter('mapOpenOrdersCategoryFilter', category => { bkmpMapOpenOrdersFilters.category = category; bkmpMapRenderOpenOrdersFiltered(); });
}

function bkmpMapCategoryLabel(id) {
  const c = BKMP_MAP_CATEGORIES.find(x => x.id === id);
  return c ? c.label : id;
}
function bkmpMapPriorityLabel(id) {
  const p = BKMP_MAP_PRIORITIES.find(x => x.id === id);
  return p ? p.label : id;
}

function bkmpMapRenderOrderCard(o, showStatus, actionsHtml) {
  const budgetText = o.budget_total ? `💰 ${bkmpMapFormatMoney(o.budget_total)} gesamt` : `💰 ${bkmpMapFormatMoney(o.budget_per_part)} / Kartenteil`;
  const sizeText = o.size_known ? `${o.size_width || '?'}x${o.size_height || '?'}, ${o.size_parts || '?'} Teile` : 'Größe unsicher – Beratung gewünscht';
  return `
    <div class="map-order-card" data-order-id="${escapeHtml(o.id)}">
      <div class="map-order-card-head">
        <span class="map-order-badge map-cat-${escapeHtml(o.category)}">${escapeHtml(bkmpMapCategoryLabel(o.category))}</span>
        <span class="map-order-badge map-prio-${escapeHtml(o.priority)}">${escapeHtml(bkmpMapPriorityLabel(o.priority))}</span>
        ${showStatus ? `<span class="map-order-status status-${escapeHtml(o.status)}">${escapeHtml(BKMP_MAP_STATUS_LABELS[o.status] || o.status)}</span>` : ''}
      </div>
      <h3 class="map-order-title">${escapeHtml(o.title)}</h3>
      <p class="map-order-desc">${escapeHtml((o.description || '').slice(0, 160))}${(o.description || '').length > 160 ? '…' : ''}</p>
      <div class="map-order-meta">
        <span>${escapeHtml(sizeText)}</span>
        <span>${budgetText}</span>
        <span>${escapeHtml(o.order_number || '')}</span>
      </div>
      ${actionsHtml || ''}
    </div>`;
}

/* ---------------- Meine Aufträge ---------------- */

let bkmpMapMyOrdersCache = [];
let bkmpMapMyOrdersQuery = '';

async function bkmpMapRenderMyOrders() {
  const listEl = document.getElementById('mapMyOrdersList');
  const emptyEl = document.getElementById('mapMyOrdersEmpty');
  if (!listEl) return;
  const session = typeof bkmpGetCustomerSession === 'function' ? await bkmpGetCustomerSession() : null;
  if (!session) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  listEl.innerHTML = '<p class="empty-hint">Lädt...</p>';
  try { bkmpMapMyOrdersCache = (await loadMyMapOrders()) || []; } catch (e) { console.warn(e); bkmpMapMyOrdersCache = []; }
  bkmpMapRenderMyOrdersFiltered();
}

function bkmpMapRenderMyOrdersFiltered() {
  const listEl = document.getElementById('mapMyOrdersList');
  if (!listEl) return;
  if (!bkmpMapMyOrdersCache.length) { listEl.innerHTML = '<p class="empty-hint">Noch keine eigenen Aufträge.</p>'; return; }
  const filtered = bkmpMapFilterOrders(bkmpMapMyOrdersCache, { query: bkmpMapMyOrdersQuery });
  listEl.innerHTML = filtered.length ? filtered.map(o => bkmpMapRenderOrderCard(o, true)).join('') : '<p class="empty-hint">Keine Aufträge gefunden.</p>';
  bkmpMapWireOrderCardClicks(listEl);
}

function bkmpMapInitMyOrdersFilters() {
  const searchInput = document.getElementById('mapMyOrdersSearch');
  if (searchInput) searchInput.addEventListener('input', () => { bkmpMapMyOrdersQuery = searchInput.value; bkmpMapRenderMyOrdersFiltered(); });
}

function bkmpMapWireOrderCardClicks(container) {
  if (!container) return;
  container.querySelectorAll('.map-order-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      bkmpMapOpenWorkspace(card.dataset.orderId);
    });
  });
}

/* ---------------- Firmenprofile ---------------- */

async function bkmpMapRenderCompanies() {
  const el = document.getElementById('mapCompaniesList');
  if (!el) return;
  el.innerHTML = '<p class="empty-hint">Lädt...</p>';
  let companies = [];
  try { companies = (typeof loadCompanies === 'function' ? await loadCompanies() : []) || []; } catch (e) { console.warn(e); }
  bkmpMapCompaniesCache = companies;
  if (!companies.length) { el.innerHTML = '<p class="empty-hint">Noch keine Kartenbaufirmen gelistet.</p>'; return; }
  el.innerHTML = companies.map(c => `
    <div class="map-company-card" data-company-id="${escapeHtml(c.id)}">
      ${c.logo_url ? `<img src="${escapeHtml(c.logo_url)}" alt="" class="map-company-logo">` : '<div class="map-company-logo map-company-logo-empty">🏗️</div>'}
      <h3>${escapeHtml(c.name)}</h3>
      <p class="map-company-desc">${escapeHtml(bkmpMapTruncateWords(c.description || '', 140))}</p>
      ${c.price_range_min ? `<p class="map-company-price">💰 ${bkmpMapFormatMoney(c.price_range_min)} – ${bkmpMapFormatMoney(c.price_range_max)}</p>` : ''}
    </div>`).join('');
  el.querySelectorAll('.map-company-card').forEach(card => card.addEventListener('click', () => bkmpMapOpenCompanyDetail(card.dataset.companyId)));
}

let bkmpMapCompaniesCache = [];

function bkmpMapOpenCompanyDetail(companyId) {
  const overlay = document.getElementById('mapCompanyDetailOverlay');
  const content = document.getElementById('mapCompanyDetailContent');
  const c = bkmpMapCompaniesCache.find(x => x.id === companyId);
  if (!overlay || !content || !c) return;
  const specialties = Array.isArray(c.specialties) ? c.specialties.map(bkmpMapCategoryLabel).join(', ') : '';
  content.innerHTML = `
    ${c.banner_url ? `<img src="${escapeHtml(c.banner_url)}" alt="" class="map-company-banner">` : ''}
    <div class="map-company-detail-head">
      ${c.logo_url ? `<img src="${escapeHtml(c.logo_url)}" alt="" class="map-company-logo">` : '<div class="map-company-logo map-company-logo-empty">🏗️</div>'}
      <h3>${escapeHtml(c.name)}</h3>
    </div>
    <p>${escapeHtml(c.description || '')}</p>
    ${specialties ? `<p><strong>Spezialisiert auf:</strong> ${escapeHtml(specialties)}</p>` : ''}
    ${c.price_range_min ? `<p><strong>Preisspanne:</strong> 💰 ${bkmpMapFormatMoney(c.price_range_min)} – ${bkmpMapFormatMoney(c.price_range_max)}</p>` : ''}
    ${c.contact_person ? `<p><strong>Ansprechpartner:</strong> ${escapeHtml(c.contact_person)}</p>` : ''}
    <div class="map-company-links">
      ${c.discord_url ? `<a href="${escapeHtml(c.discord_url)}" target="_blank" rel="noopener">Discord</a>` : ''}
      ${c.website_url ? `<a href="${escapeHtml(c.website_url)}" target="_blank" rel="noopener">Website</a>` : ''}
    </div>
    ${Array.isArray(c.showcase_image_urls) && c.showcase_image_urls.length ? `
      <div class="map-company-showcase">
        ${c.showcase_image_urls.map(url => `<img src="${escapeHtml(url)}" alt="">`).join('')}
      </div>` : ''}
  `;
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');
}

function bkmpMapCloseCompanyDetail() {
  const overlay = document.getElementById('mapCompanyDetailOverlay');
  if (overlay) overlay.classList.remove('visible');
  document.body.classList.remove('modal-open');
}

/* ---------------- Firmen-Dashboard (admin.html, role='company') ---------------- */

async function bkmpMapClaimOrder(orderId, btn) {
  const client = bkmpGetSupabaseClient();
  if (!client) return;
  const { data } = await client.auth.getSession();
  const token = data && data.session ? data.session.access_token : null;
  if (!token) { showAdminToast('Keine gültige Sitzung.', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Wird übernommen...'; }
  try {
    const res = await fetch('/api/claim-map-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ orderId })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      const errorMap = { already_claimed: 'Dieser Auftrag wurde gerade von einer anderen Firma übernommen.', not_company_staff: 'Dein Zugang ist keiner Firma zugeordnet.' };
      showAdminToast(errorMap[body.error] || ('Auftrag konnte nicht übernommen werden: ' + (body.error || 'Unbekannter Fehler')), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Auftrag übernehmen'; }
      return;
    }
    showAdminToast('Auftrag übernommen!', 'success');
    if (window.bkmpCurrentCompanyProfile) bkmpMapRenderCompanyDashboard(window.bkmpCurrentCompanyProfile);
  } catch (e) {
    console.error('Auftrag konnte nicht übernommen werden.', e);
    showAdminToast('Verbindungsfehler beim Übernehmen.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Auftrag übernehmen'; }
  }
}

let bkmpMapCompanyOpenOrdersCache = [];
let bkmpMapCompanyOwnOrdersCache = [];
let bkmpMapCompanyOrdersQuery = '';

async function bkmpMapRenderCompanyDashboard(profile) {
  window.bkmpCurrentCompanyProfile = profile;
  const nameEl = document.getElementById('companyDashboardName');
  if (nameEl) nameEl.textContent = profile && profile.display_name ? `Eingeloggt als ${profile.display_name}` : '';
  if (!profile || !profile.company_id) return;

  const newEl = document.getElementById('companyNewOrdersList');
  if (newEl) newEl.innerHTML = '<p class="empty-hint">Lädt...</p>';

  try {
    [bkmpMapCompanyOpenOrdersCache, bkmpMapCompanyOwnOrdersCache] = await Promise.all([
      typeof loadOpenMapOrders === 'function' ? loadOpenMapOrders() : [],
      typeof loadCompanyOrders === 'function' ? loadCompanyOrders(profile.company_id) : []
    ]);
  } catch (e) { console.warn('Aufträge konnten nicht geladen werden.', e); }

  bkmpMapRenderCompanyDashboardFiltered();
}

function bkmpMapRenderCompanyDashboardFiltered() {
  const newEl = document.getElementById('companyNewOrdersList');
  const runningEl = document.getElementById('companyRunningOrdersList');
  const doneEl = document.getElementById('companyDoneOrdersList');
  const newCountEl = document.getElementById('companyNewOrdersCount');
  const runningCountEl = document.getElementById('companyRunningOrdersCount');
  const doneCountEl = document.getElementById('companyDoneOrdersCount');

  const openOrders = bkmpMapFilterOrders(bkmpMapCompanyOpenOrdersCache, { query: bkmpMapCompanyOrdersQuery });
  const ownFiltered = bkmpMapFilterOrders(bkmpMapCompanyOwnOrdersCache, { query: bkmpMapCompanyOrdersQuery });
  const running = ownFiltered.filter(o => !['fertig', 'abgeschlossen', 'abgebrochen'].includes(o.status));
  const done = ownFiltered.filter(o => ['fertig', 'abgeschlossen', 'abgebrochen'].includes(o.status));

  if (newCountEl) newCountEl.textContent = `(${openOrders.length})`;
  if (runningCountEl) runningCountEl.textContent = `(${running.length})`;
  if (doneCountEl) doneCountEl.textContent = `(${done.length})`;

  if (newEl) {
    newEl.innerHTML = openOrders.length
      ? openOrders.map(o => bkmpMapRenderOrderCard(o, false, `<button type="button" class="btn-ja map-order-claim-btn" data-order-id="${o.id}">Auftrag übernehmen</button>`)).join('')
      : '<p class="empty-hint">Aktuell keine offenen Aufträge.</p>';
    newEl.querySelectorAll('.map-order-claim-btn').forEach(btn => btn.addEventListener('click', () => bkmpMapClaimOrder(btn.dataset.orderId, btn)));
  }
  if (runningEl) { runningEl.innerHTML = running.length ? running.map(o => bkmpMapRenderOrderCard(o, true)).join('') : '<p class="empty-hint">Keine laufenden Aufträge.</p>'; bkmpMapWireOrderCardClicks(runningEl); }
  if (doneEl) { doneEl.innerHTML = done.length ? done.map(o => bkmpMapRenderOrderCard(o, true)).join('') : '<p class="empty-hint">Noch keine abgeschlossenen Aufträge.</p>'; bkmpMapWireOrderCardClicks(doneEl); }
}

function bkmpMapInitCompanyOrdersFilters() {
  const searchInput = document.getElementById('companyOrdersSearch');
  if (searchInput) searchInput.addEventListener('input', () => { bkmpMapCompanyOrdersQuery = searchInput.value; bkmpMapRenderCompanyDashboardFiltered(); });
}

/* ---------------- Privater Auftragsbereich (Chat/Dateien/Verlauf) ---------------- */

let bkmpMapCurrentWorkspaceOrder = null;
let bkmpMapCurrentActor = null;
let bkmpMapChatChannel = null;
let bkmpMapChatFilesCache = [];

const BKMP_MAP_EVENT_LABELS = {
  created: 'Auftrag erstellt', claimed: 'Firma hat übernommen', status_changed: 'Status geändert',
  message_sent: 'Nachricht gesendet', file_uploaded: 'Datei hochgeladen', completed: 'Auftrag abgeschlossen',
  reset_to_open: 'Zurück auf Offen gesetzt', company_reassigned: 'Firma neu zugewiesen', withdrawn: 'Auftrag zurückgezogen'
};
const BKMP_MAP_ROLE_LABELS = { customer: 'Kunde', company: 'Firma', admin: 'Admin' };

function bkmpMapNotify(message, type) {
  /* showAdminToast existiert nur in admin.html - auf index.html gibt es
     (noch) kein Toast-System, deshalb hier ein einfacher Fallback. */
  if (typeof showAdminToast === 'function') { showAdminToast(message, type); return; }
  if (type === 'error') { console.error(message); alert(message); } else { console.log(message); }
}

async function bkmpMapResolveActor() {
  const session = typeof bkmpGetCustomerSession === 'function' ? await bkmpGetCustomerSession() : null;
  if (!session) return null;
  if (window.bkmpCurrentCompanyProfile) {
    return { type: 'company', authId: session.user.id, displayName: window.bkmpCurrentCompanyProfile.display_name || 'Firma' };
  }
  const displayName = typeof bkmpGetMcName === 'function' ? bkmpGetMcName() : 'Kunde';
  return { type: 'customer', authId: session.user.id, displayName };
}

function bkmpMapFormatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function bkmpMapOpenWorkspace(orderId) {
  const overlay = document.getElementById('mapWorkspaceOverlay');
  if (!overlay || !orderId) return;
  bkmpMapCurrentActor = await bkmpMapResolveActor();
  if (!bkmpMapCurrentActor) { bkmpMapNotify('Keine gültige Sitzung.', 'error'); return; }
  let order = null;
  try { order = await loadMapOrderById(orderId); } catch (e) { console.warn('Auftrag konnte nicht geladen werden.', e); }
  if (!order) return;
  bkmpMapCurrentWorkspaceOrder = order;
  const titleEl = document.getElementById('mapWorkspaceTitle');
  if (titleEl) titleEl.textContent = order.title;
  bkmpMapRenderWorkspaceInfo(order);
  bkmpMapRenderWorkspaceStatusRow(order, bkmpMapCurrentActor);
  overlay.classList.add('visible');
  document.body.classList.add('modal-open');

  await bkmpMapRenderWorkspaceFiles(orderId);
  await bkmpMapLoadChat(orderId);
  await bkmpMapRenderWorkspaceHistory(orderId);
  bkmpMapSubscribeChat(orderId);
  if (typeof markOrderRead === 'function') markOrderRead(orderId);
}

function bkmpMapCloseWorkspace() {
  const overlay = document.getElementById('mapWorkspaceOverlay');
  if (overlay) overlay.classList.remove('visible');
  document.body.classList.remove('modal-open');
  bkmpMapUnsubscribeChat();
  bkmpMapCurrentWorkspaceOrder = null;
}

function bkmpMapRenderWorkspaceInfo(o) {
  const el = document.getElementById('mapWorkspaceInfo');
  if (!el) return;
  const budgetText = o.budget_total ? '💰 ' + bkmpMapFormatMoney(o.budget_total) + ' gesamt' : '💰 ' + bkmpMapFormatMoney(o.budget_per_part) + ' / Kartenteil';
  const sizeText = o.size_known ? `${o.size_width || '?'}x${o.size_height || '?'}, ${o.size_parts || '?'} Teile` : (o.size_notes || 'Unsicher – Beratung gewünscht');
  el.innerHTML = `
    <div><span class="label">Status</span><span class="map-order-status status-${escapeHtml(o.status)}">${escapeHtml(BKMP_MAP_STATUS_LABELS[o.status] || o.status)}</span></div>
    <div><span class="label">Kategorie</span><span class="value">${escapeHtml(bkmpMapCategoryLabel(o.category))}</span></div>
    <div><span class="label">Priorität</span><span class="value">${escapeHtml(bkmpMapPriorityLabel(o.priority))}</span></div>
    <div><span class="label">Größe</span><span class="value">${escapeHtml(sizeText)}</span></div>
    <div><span class="label">Budget</span><span class="value">${budgetText}</span></div>
    <div><span class="label">Kunde</span><span class="value">${escapeHtml(o.customer_display_name)}${o.customer_discord ? ' (' + escapeHtml(o.customer_discord) + ')' : ''}</span></div>
    <div><span class="label">Auftragsnr.</span><span class="value">${escapeHtml(o.order_number || '')}</span></div>
    <div style="grid-column:1/-1;"><span class="label">Beschreibung</span><span class="value" style="font-weight:400; display:block;">${escapeHtml(o.description || '')}</span></div>
    ${o.additional_notes ? `<div style="grid-column:1/-1;"><span class="label">Hinweise</span><span class="value" style="font-weight:400; display:block;">${escapeHtml(o.additional_notes)}</span></div>` : ''}
  `;
}

const BKMP_MAP_STATUS_ORDER = ['neu', 'offen', 'angenommen', 'in_bearbeitung', 'rueckfrage', 'wartet_auf_kunde', 'fertig', 'abgeschlossen', 'abgebrochen'];

function bkmpMapRenderWorkspaceStatusRow(o, actor) {
  const el = document.getElementById('mapWorkspaceStatusRow');
  if (!el) return;
  const canManage = actor && (actor.type === 'admin' || (actor.type === 'company' && o.assigned_company_id));
  const canWithdraw = actor && actor.type === 'customer' && o.status === 'offen' && !o.assigned_company_id;

  if (canManage) {
    el.style.display = '';
    el.innerHTML = `
      <select id="mapWorkspaceStatusSelect">
        ${BKMP_MAP_STATUS_ORDER.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${escapeHtml(BKMP_MAP_STATUS_LABELS[s])}</option>`).join('')}
      </select>
      <button type="button" class="btn-ja" id="mapWorkspaceStatusApply">Status ändern</button>`;
    const applyBtn = document.getElementById('mapWorkspaceStatusApply');
    if (applyBtn) applyBtn.addEventListener('click', () => {
      const select = document.getElementById('mapWorkspaceStatusSelect');
      if (select) bkmpMapChangeOrderStatus(select.value);
    });
  } else if (canWithdraw) {
    el.style.display = '';
    el.innerHTML = `<button type="button" class="btn-nein" id="mapWorkspaceWithdrawBtn">Auftrag zurückziehen</button>`;
    const withdrawBtn = document.getElementById('mapWorkspaceWithdrawBtn');
    if (withdrawBtn) withdrawBtn.addEventListener('click', bkmpMapWithdrawOrder);
  } else {
    el.style.display = 'none';
    el.innerHTML = '';
  }
}

async function bkmpMapChangeOrderStatus(newStatus) {
  if (!bkmpMapCurrentWorkspaceOrder || !bkmpMapCurrentActor) return;
  const order = bkmpMapCurrentWorkspaceOrder;
  const oldStatus = order.status;
  if (newStatus === oldStatus) return;
  const applyBtn = document.getElementById('mapWorkspaceStatusApply');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Wird geändert...'; }
  try {
    const completedAt = ['fertig', 'abgeschlossen'].includes(newStatus) ? new Date().toISOString() : null;
    await updateMapOrderStatus(order.id, newStatus, completedAt);
    order.status = newStatus;
    order.completed_at = completedAt;
    await logOrderEvent({
      order_id: order.id, event_type: newStatus === 'abgeschlossen' ? 'completed' : 'status_changed',
      actor_type: bkmpMapCurrentActor.type, actor_auth_id: bkmpMapCurrentActor.authId, actor_display_name: bkmpMapCurrentActor.displayName,
      from_status: oldStatus, to_status: newStatus
    });
    bkmpMapRenderWorkspaceInfo(order);
    bkmpMapRenderWorkspaceStatusRow(order, bkmpMapCurrentActor);
    bkmpMapRenderWorkspaceHistory(order.id);
    bkmpMapNotify('Status geändert.', 'success');
    if (window.bkmpCurrentCompanyProfile) bkmpMapRenderCompanyDashboard(window.bkmpCurrentCompanyProfile);
  } catch (e) {
    console.error('Status konnte nicht geändert werden.', e);
    bkmpMapNotify('Status konnte nicht geändert werden.', 'error');
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Status ändern'; }
  }
}

async function bkmpMapWithdrawOrder() {
  if (!bkmpMapCurrentWorkspaceOrder || !bkmpMapCurrentActor) return;
  const order = bkmpMapCurrentWorkspaceOrder;
  if (!confirm('Auftrag wirklich zurückziehen?')) return;
  try {
    await withdrawMapOrder(order.id);
    order.status = 'abgebrochen';
    await logOrderEvent({
      order_id: order.id, event_type: 'withdrawn', actor_type: bkmpMapCurrentActor.type,
      actor_auth_id: bkmpMapCurrentActor.authId, actor_display_name: bkmpMapCurrentActor.displayName,
      from_status: 'offen', to_status: 'abgebrochen'
    });
    bkmpMapRenderWorkspaceInfo(order);
    bkmpMapRenderWorkspaceStatusRow(order, bkmpMapCurrentActor);
    bkmpMapRenderWorkspaceHistory(order.id);
    bkmpMapNotify('Auftrag zurückgezogen.', 'success');
    bkmpMapRenderMyOrders();
  } catch (e) {
    console.error('Auftrag konnte nicht zurückgezogen werden.', e);
    bkmpMapNotify('Auftrag konnte nicht zurückgezogen werden.', 'error');
  }
}

async function bkmpMapLoadChat(orderId) {
  const container = document.getElementById('mapChatMessages');
  if (!container) return;
  container.innerHTML = '<p class="empty-hint">Lädt...</p>';
  let messages = [];
  try { messages = await loadOrderMessages(orderId); } catch (e) { console.warn('Nachrichten konnten nicht geladen werden.', e); }
  container.innerHTML = '';
  if (!messages.length) container.innerHTML = '<p class="empty-hint">Noch keine Nachrichten. Schreib die erste!</p>';
  messages.forEach(m => bkmpMapAppendChatMessage(m));
  container.scrollTop = container.scrollHeight;
}

function bkmpMapAppendChatMessage(m) {
  const container = document.getElementById('mapChatMessages');
  if (!container) return;
  const emptyHint = container.querySelector('.empty-hint');
  if (emptyHint) emptyHint.remove();
  const isMe = bkmpMapCurrentActor && m.sender_auth_id === bkmpMapCurrentActor.authId;
  const roleLabel = BKMP_MAP_ROLE_LABELS[m.sender_type] || m.sender_type;

  const div = document.createElement('div');
  div.className = 'map-chat-msg' + (isMe ? ' is-me' : '');
  div.innerHTML = `
    <div class="map-chat-msg-head">
      <span class="map-chat-msg-sender">${escapeHtml(m.sender_display_name)} <span class="map-chat-msg-role">${escapeHtml(roleLabel)}</span></span>
      <span>${escapeHtml(bkmpMapFormatDateTime(m.created_at))}</span>
    </div>
    ${m.body ? `<div class="map-chat-msg-body">${escapeHtml(m.body)}</div>` : ''}
  `;
  container.appendChild(div);

  if (m.attachment_file_id) {
    const file = bkmpMapChatFilesCache.find(f => f.id === m.attachment_file_id);
    const attachDiv = document.createElement('div');
    attachDiv.className = 'map-chat-msg-attachment';
    div.appendChild(attachDiv);
    if (file) bkmpMapFillAttachment(attachDiv, file);
  }
  container.scrollTop = container.scrollHeight;
}

async function bkmpMapFillAttachment(el, file) {
  const url = typeof getOrderFileSignedUrl === 'function' ? await getOrderFileSignedUrl(file.storage_path) : null;
  if (!url) { el.textContent = file.file_name; return; }
  if ((file.file_type || '').startsWith('image/')) {
    el.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(file.file_name)}">`;
  } else {
    el.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(file.file_name)}</a>`;
  }
}

async function bkmpMapHandleRealtimeMessage(m) {
  if (m.attachment_file_id && !bkmpMapChatFilesCache.find(f => f.id === m.attachment_file_id) && bkmpMapCurrentWorkspaceOrder) {
    try { bkmpMapChatFilesCache = await loadOrderFiles(bkmpMapCurrentWorkspaceOrder.id); } catch (e) {}
  }
  bkmpMapAppendChatMessage(m);
}

function bkmpMapSubscribeChat(orderId) {
  bkmpMapUnsubscribeChat();
  const client = bkmpGetSupabaseClient();
  if (!client || typeof client.channel !== 'function') return;
  bkmpMapChatChannel = client.channel('order-' + orderId + '-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` }, payload => {
      if (bkmpMapCurrentActor && payload.new.sender_auth_id === bkmpMapCurrentActor.authId) return;
      bkmpMapHandleRealtimeMessage(payload.new);
    })
    .subscribe();
}

function bkmpMapUnsubscribeChat() {
  if (bkmpMapChatChannel) { bkmpMapChatChannel.unsubscribe(); bkmpMapChatChannel = null; }
}

async function bkmpMapSendChatMessage() {
  const input = document.getElementById('mapChatInput');
  const fileInput = document.getElementById('mapChatFileInput');
  const sendBtn = document.getElementById('mapChatSendBtn');
  if (!input || !bkmpMapCurrentWorkspaceOrder || !bkmpMapCurrentActor) return;
  const body = input.value.trim();
  const file = fileInput && fileInput.files && fileInput.files[0];
  if (!body && !file) return;
  if (sendBtn) sendBtn.disabled = true;
  try {
    let attachmentFileId = null;
    if (file) {
      const saved = await uploadOrderFile(bkmpMapCurrentWorkspaceOrder.id, file, bkmpMapCurrentActor.type, bkmpMapCurrentActor.displayName);
      attachmentFileId = saved.id;
      bkmpMapChatFilesCache.push(saved);
      await logOrderEvent({ order_id: bkmpMapCurrentWorkspaceOrder.id, event_type: 'file_uploaded', actor_type: bkmpMapCurrentActor.type, actor_auth_id: bkmpMapCurrentActor.authId, actor_display_name: bkmpMapCurrentActor.displayName, detail: file.name });
    }
    const message = await sendOrderMessage({
      order_id: bkmpMapCurrentWorkspaceOrder.id,
      sender_type: bkmpMapCurrentActor.type,
      sender_auth_id: bkmpMapCurrentActor.authId,
      sender_display_name: bkmpMapCurrentActor.displayName,
      body: body || null,
      attachment_file_id: attachmentFileId
    });
    bkmpMapAppendChatMessage(message);
    await logOrderEvent({ order_id: bkmpMapCurrentWorkspaceOrder.id, event_type: 'message_sent', actor_type: bkmpMapCurrentActor.type, actor_auth_id: bkmpMapCurrentActor.authId, actor_display_name: bkmpMapCurrentActor.displayName });
    input.value = '';
    if (fileInput) fileInput.value = '';
    const fileNameEl = document.getElementById('mapChatFileName');
    if (fileNameEl) fileNameEl.textContent = '';
    bkmpMapRenderWorkspaceFiles(bkmpMapCurrentWorkspaceOrder.id);
    bkmpMapRenderWorkspaceHistory(bkmpMapCurrentWorkspaceOrder.id);
  } catch (e) {
    console.error('Nachricht konnte nicht gesendet werden.', e);
    bkmpMapNotify('Nachricht konnte nicht gesendet werden.', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function bkmpMapRenderWorkspaceFiles(orderId) {
  const el = document.getElementById('mapWorkspaceFilesList');
  let files = [];
  try { files = (await loadOrderFiles(orderId)) || []; } catch (e) { console.warn('Dateien konnten nicht geladen werden.', e); }
  bkmpMapChatFilesCache = files;
  if (!el) return;
  if (!files.length) { el.innerHTML = '<p class="empty-hint">Noch keine Dateien.</p>'; return; }
  el.innerHTML = files.map(f => `
    <div class="map-workspace-file-row">
      <span>${escapeHtml(f.file_name)} &middot; ${escapeHtml(f.uploaded_by_display_name)} &middot; ${escapeHtml(bkmpMapFormatDateTime(f.created_at))}</span>
      <a href="#" data-storage-path="${escapeHtml(f.storage_path)}">Öffnen</a>
    </div>`).join('');
  el.querySelectorAll('a[data-storage-path]').forEach(a => a.addEventListener('click', async e => {
    e.preventDefault();
    const url = await getOrderFileSignedUrl(a.dataset.storagePath);
    if (url) window.open(url, '_blank');
  }));
}

async function bkmpMapRenderWorkspaceHistory(orderId) {
  const el = document.getElementById('mapWorkspaceHistoryList');
  if (!el) return;
  let events = [];
  try { events = (await loadOrderEvents(orderId)) || []; } catch (e) { console.warn('Verlauf konnte nicht geladen werden.', e); }
  if (!events.length) { el.innerHTML = '<p class="empty-hint">Noch keine Einträge.</p>'; return; }
  el.innerHTML = events.map(e => `
    <div class="map-workspace-history-row">${escapeHtml(bkmpMapFormatDateTime(e.created_at))} &middot; ${escapeHtml(BKMP_MAP_EVENT_LABELS[e.event_type] || e.event_type)}${e.actor_display_name ? ' &middot; ' + escapeHtml(e.actor_display_name) : ''}</div>`).join('');
}

function bkmpMapInitWorkspace() {
  const closeBtn = document.getElementById('mapWorkspaceClose');
  if (closeBtn) closeBtn.addEventListener('click', bkmpMapCloseWorkspace);
  const sendBtn = document.getElementById('mapChatSendBtn');
  if (sendBtn) sendBtn.addEventListener('click', bkmpMapSendChatMessage);
  const fileInput = document.getElementById('mapChatFileInput');
  if (fileInput) fileInput.addEventListener('change', () => {
    const nameEl = document.getElementById('mapChatFileName');
    if (nameEl) nameEl.textContent = fileInput.files && fileInput.files[0] ? fileInput.files[0].name : '';
  });
  const chatInput = document.getElementById('mapChatInput');
  if (chatInput) chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); bkmpMapSendChatMessage(); }
  });
}

/* ---------------- Zugangscode eingeben ---------------- */

function bkmpMapInitAccessCodeFlow() {
  const openBtn = document.getElementById('mapAccessCodeOpenBtn');
  const overlay = document.getElementById('mapAccessCodeOverlay');
  const input = document.getElementById('mapAccessCodeInput');
  const confirmBtn = document.getElementById('mapAccessCodeConfirm');
  const cancelBtn = document.getElementById('mapAccessCodeCancel');
  const msg = document.getElementById('mapAccessCodeMsg');
  if (openBtn && overlay) openBtn.addEventListener('click', () => { overlay.classList.add('visible'); document.body.classList.add('modal-open'); if (input) input.focus(); });
  if (cancelBtn && overlay) cancelBtn.addEventListener('click', () => { overlay.classList.remove('visible'); document.body.classList.remove('modal-open'); });
  if (confirmBtn) confirmBtn.addEventListener('click', async () => {
    const code = input ? input.value.trim() : '';
    if (!code) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Wird geprüft...';
    try {
      await bkmpCustomerRestoreByCode(code);
      overlay.classList.remove('visible');
      document.body.classList.remove('modal-open');
      if (input) input.value = '';
      if (msg) msg.textContent = '';
      bkmpMapRenderMyOrders();
    } catch (e) {
      if (msg) { msg.textContent = 'Code ungültig oder abgelaufen.'; msg.classList.add('error'); }
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Bestätigen';
    }
  });
  const codeCloseBtn = document.getElementById('mapCodeOverlayClose');
  const codeOverlay = document.getElementById('mapCodeOverlay');
  if (codeCloseBtn && codeOverlay) codeCloseBtn.addEventListener('click', () => { codeOverlay.classList.remove('visible'); document.body.classList.remove('modal-open'); });
}

/* ---------------- Subtabs ---------------- */

const bkmpMapSubtabs = [
  { btn: 'ordersSubtabCreate', panel: 'ordersSubtabCreatePanel', render: null },
  { btn: 'ordersSubtabOpen', panel: 'ordersSubtabOpenPanel', render: bkmpMapRenderOpenOrders },
  { btn: 'ordersSubtabMine', panel: 'ordersSubtabMinePanel', render: bkmpMapRenderMyOrders },
  { btn: 'ordersSubtabCompanies', panel: 'ordersSubtabCompaniesPanel', render: bkmpMapRenderCompanies }
];

function bkmpMapInitSubtabs() {
  bkmpMapSubtabs.forEach(t => {
    const btn = document.getElementById(t.btn);
    if (!btn) return;
    btn.addEventListener('click', () => {
      bkmpMapSubtabs.forEach(other => {
        const b = document.getElementById(other.btn);
        const p = document.getElementById(other.panel);
        if (b) b.classList.toggle('active', other.btn === t.btn);
        if (p) p.style.display = other.btn === t.btn ? '' : 'none';
      });
      if (typeof t.render === 'function') t.render();
    });
  });
}

/* ---------------- Admin: Kartenfirmen CRUD ---------------- */

let bkmpMapAdminCompanies = [];
let bkmpMapEditingCompanyId = null;
let bkmpMapCompanyApplications = [];

function bkmpMapInitCompanySpecialtiesFilter() {
  const el = document.getElementById('mapartCompanySpecialtiesFilter');
  if (!el) return;
  el.innerHTML = BKMP_MAP_CATEGORIES.map(c => `<button type="button" data-specialty="${c.id}">${c.label}</button>`).join('');
  el.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => btn.classList.toggle('active')));
}
function bkmpMapGetSelectedSpecialties() {
  return [...document.querySelectorAll('#mapartCompanySpecialtiesFilter button.active')].map(b => b.dataset.specialty);
}
function bkmpMapSetSelectedSpecialties(list) {
  document.querySelectorAll('#mapartCompanySpecialtiesFilter button').forEach(b => b.classList.toggle('active', (list || []).includes(b.dataset.specialty)));
}

async function refreshMapartCompaniesAdmin() {
  const el = document.getElementById('mapartCompaniesList');
  if (el) el.innerHTML = '<p style="color:var(--muted); font-size:0.85rem;">Firmen werden geladen...</p>';
  try {
    bkmpMapAdminCompanies = (typeof loadCompaniesAdmin === 'function' ? await loadCompaniesAdmin() : []) || [];
  } catch (e) {
    console.warn('Firmen konnten nicht geladen werden.', e);
    bkmpMapAdminCompanies = [];
    if (el) el.innerHTML = '<p style="color:var(--neg); font-size:0.85rem;">Firmen konnten nicht geladen werden. Bitte SQL ausführen.</p>';
    return;
  }
  bkmpMapInitCompanySpecialtiesFilter();
  bkmpMapRenderCompaniesAdminList();
  refreshCompanyApplicationsAdmin();
}

/* ---------------- Admin: Firmenbewerbungen ("Bist du eine
   Kartenbaufirma? Bewirb dich hier") ---------------- */

async function refreshCompanyApplicationsAdmin() {
  const el = document.getElementById('mapartCompanyApplicationsList');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--muted); font-size:0.85rem;">Bewerbungen werden geladen...</p>';
  try {
    bkmpMapCompanyApplications = (typeof loadCompanyApplications === 'function' ? await loadCompanyApplications() : []) || [];
  } catch (e) {
    console.warn('Firmenbewerbungen konnten nicht geladen werden.', e);
    bkmpMapCompanyApplications = [];
    el.innerHTML = '<p style="color:var(--neg); font-size:0.85rem;">Bewerbungen konnten nicht geladen werden. Bitte SQL ausführen (supabase-company-applications.sql).</p>';
    return;
  }
  bkmpMapRenderCompanyApplicationsList();
}

function bkmpMapRenderCompanyApplicationsList() {
  const el = document.getElementById('mapartCompanyApplicationsList');
  const badge = document.getElementById('mapartCompanyApplicationsBadge');
  if (!el) return;
  const pending = bkmpMapCompanyApplications.filter(a => a.status === 'pending');
  if (badge) {
    badge.textContent = pending.length;
    badge.style.display = pending.length ? '' : 'none';
  }
  if (!bkmpMapCompanyApplications.length) {
    el.innerHTML = '<p style="color:var(--muted); font-size:0.85rem;">Noch keine Bewerbungen eingegangen.</p>';
    return;
  }
  const sorted = [...bkmpMapCompanyApplications].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  el.innerHTML = sorted.map(a => {
    const price = (a.price_range_min || a.price_range_max)
      ? `${a.price_range_min ? bkmpMapFormatMoney(a.price_range_min) : '?'} – ${a.price_range_max ? bkmpMapFormatMoney(a.price_range_max) : '?'}`
      : '';
    const statusLabel = a.status === 'confirmed' ? '✅ Bestätigt' : a.status === 'rejected' ? '❌ Abgelehnt' : '🕓 Offen';
    return `
      <div class="company-application-card" data-id="${a.id}">
        <div class="company-application-head">
          ${a.logo_url ? `<img class="company-application-logo" src="${escapeHtml(a.logo_url)}" alt="">` : '<div class="company-application-logo company-application-logo-empty">🏗️</div>'}
          <div>
            <div class="company-application-name">${escapeHtml(a.name)}</div>
            <div class="company-application-meta">${escapeHtml(a.contact_person || '')} · <span class="company-application-status">${statusLabel}</span></div>
          </div>
        </div>
        ${a.description ? `<p class="company-application-desc">${escapeHtml(a.description)}</p>` : ''}
        <div class="company-application-links">
          ${a.discord_url ? `<span>💬 ${escapeHtml(a.discord_url)}</span>` : ''}
          ${a.website_url ? `<span>🌐 ${escapeHtml(a.website_url)}</span>` : ''}
          ${a.specialties ? `<span>🏷️ ${escapeHtml(a.specialties)}</span>` : ''}
          ${price ? `<span>💰 ${price}</span>` : ''}
        </div>
        ${a.banner_url ? `<img class="company-application-banner" src="${escapeHtml(a.banner_url)}" alt="">` : ''}
        ${a.status === 'pending' ? `
          <div class="entry-actions">
            <button class="edit-btn company-application-confirm" type="button">Bestätigen (Firma anlegen)</button>
            <button class="edit-btn company-application-reject" type="button">Ablehnen</button>
          </div>` : `
          <div class="entry-actions">
            <button class="edit-btn company-application-delete" type="button">Löschen</button>
          </div>`}
      </div>`;
  }).join('');
  el.querySelectorAll('.company-application-confirm').forEach(btn => btn.addEventListener('click', () => confirmCompanyApplication(btn.closest('.company-application-card').dataset.id)));
  el.querySelectorAll('.company-application-reject').forEach(btn => btn.addEventListener('click', () => rejectCompanyApplication(btn.closest('.company-application-card').dataset.id)));
  el.querySelectorAll('.company-application-delete').forEach(btn => btn.addEventListener('click', () => deleteCompanyApplicationEntry(btn.closest('.company-application-card').dataset.id)));
}

async function confirmCompanyApplication(id) {
  const application = bkmpMapCompanyApplications.find(a => String(a.id) === String(id));
  if (!application) return;
  const company = {
    name: application.name,
    contact_person: application.contact_person || null,
    logo_url: application.logo_url || null,
    banner_url: application.banner_url || null,
    discord_url: application.discord_url || null,
    website_url: application.website_url || null,
    description: application.description || null,
    price_range_min: application.price_range_min || null,
    price_range_max: application.price_range_max || null,
    specialties: (application.specialties || '').split(',').map(s => s.trim()).filter(Boolean),
    showcase_image_urls: [],
    active: true
  };
  try {
    const saved = await saveCompany(company);
    if (saved) bkmpMapAdminCompanies.unshift(saved);
    bkmpMapRenderCompaniesAdminList();
  } catch (e) {
    bkmpMapNotify('Firma konnte nicht angelegt werden — Bewerbung bleibt offen: ' + (e.message || ''), 'error');
    return;
  }
  try {
    const updated = await updateCompanyApplicationStatus(id, 'confirmed');
    bkmpMapCompanyApplications = bkmpMapCompanyApplications.map(a => String(a.id) === String(id) ? (updated || { ...a, status: 'confirmed' }) : a);
    bkmpMapRenderCompanyApplicationsList();
    bkmpMapNotify('Bewerbung bestätigt — Firma wurde angelegt.', 'success');
  } catch (e) {
    bkmpMapNotify('Firma wurde erstellt, Status der Bewerbung konnte aber nicht aktualisiert werden: ' + (e.message || ''), 'error');
  }
}

async function rejectCompanyApplication(id) {
  try {
    const updated = await updateCompanyApplicationStatus(id, 'rejected');
    bkmpMapCompanyApplications = bkmpMapCompanyApplications.map(a => String(a.id) === String(id) ? (updated || { ...a, status: 'rejected' }) : a);
    bkmpMapRenderCompanyApplicationsList();
    bkmpMapNotify('Bewerbung abgelehnt.', 'success');
  } catch (e) {
    bkmpMapNotify('Konnte nicht abgelehnt werden: ' + (e.message || ''), 'error');
  }
}

async function deleteCompanyApplicationEntry(id) {
  if (!confirm('Diese Bewerbung wirklich endgültig löschen?')) return;
  try {
    await deleteCompanyApplication(id);
    bkmpMapCompanyApplications = bkmpMapCompanyApplications.filter(a => String(a.id) !== String(id));
    bkmpMapRenderCompanyApplicationsList();
    bkmpMapNotify('Bewerbung gelöscht.', 'success');
  } catch (e) {
    bkmpMapNotify('Konnte nicht gelöscht werden: ' + (e.message || ''), 'error');
  }
}

function bkmpMapRenderCompaniesAdminList() {
  const el = document.getElementById('mapartCompaniesList');
  if (!el) return;
  if (!bkmpMapAdminCompanies.length) { el.innerHTML = '<p style="color:var(--muted); font-size:0.85rem;">Noch keine Firmen angelegt.</p>'; return; }
  el.innerHTML = '';
  bkmpMapAdminCompanies.forEach(c => {
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.innerHTML = `
      <div class="desc">
        <span class="name">${escapeHtml(c.name)}${c.active === false ? ' <span class="investor-anonymous-badge">Inaktiv</span>' : ''}</span>
        <span class="meta">${escapeHtml((c.description || '').slice(0, 90))}</span>
      </div>
      <div class="entry-actions">
        <button class="edit-btn" type="button">Bearbeiten</button>
        <button class="del-btn" type="button" aria-label="Firma löschen"><svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg></button>
      </div>`;
    row.querySelector('.edit-btn').addEventListener('click', () => bkmpMapStartEditCompany(c.id));
    row.querySelector('.del-btn').addEventListener('click', async () => {
      if (!confirm(`Firma "${c.name}" wirklich löschen?`)) return;
      try {
        await deleteCompany(c.id);
        bkmpMapAdminCompanies = bkmpMapAdminCompanies.filter(x => x.id !== c.id);
        bkmpMapRenderCompaniesAdminList();
        bkmpMapNotify('Firma gelöscht.', 'success');
      } catch (e) { bkmpMapNotify('Konnte nicht gelöscht werden: ' + (e.message || ''), 'error'); }
    });
    el.appendChild(row);
  });
}

function bkmpMapClearCompanyForm() {
  bkmpMapEditingCompanyId = null;
  const titleEl = document.getElementById('mapartCompanyEditTitle');
  if (titleEl) titleEl.textContent = 'Neue Firma';
  ['mapartCompanyName', 'mapartCompanyContact', 'mapartCompanyLogo', 'mapartCompanyBanner', 'mapartCompanyDiscord',
    'mapartCompanyWebsite', 'mapartCompanyPriceMin', 'mapartCompanyPriceMax', 'mapartCompanyDescription', 'mapartCompanyShowcase']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const activeEl = document.getElementById('mapartCompanyActive');
  if (activeEl) activeEl.checked = true;
  bkmpMapSetSelectedSpecialties([]);
}

function bkmpMapStartEditCompany(id) {
  const c = bkmpMapAdminCompanies.find(x => x.id === id);
  if (!c) return;
  bkmpMapEditingCompanyId = id;
  document.getElementById('mapartCompanyEditTitle').textContent = 'Firma bearbeiten: ' + c.name;
  document.getElementById('mapartCompanyName').value = c.name || '';
  document.getElementById('mapartCompanyContact').value = c.contact_person || '';
  document.getElementById('mapartCompanyLogo').value = c.logo_url || '';
  document.getElementById('mapartCompanyBanner').value = c.banner_url || '';
  document.getElementById('mapartCompanyDiscord').value = c.discord_url || '';
  document.getElementById('mapartCompanyWebsite').value = c.website_url || '';
  document.getElementById('mapartCompanyPriceMin').value = c.price_range_min || '';
  document.getElementById('mapartCompanyPriceMax').value = c.price_range_max || '';
  document.getElementById('mapartCompanyDescription').value = c.description || '';
  document.getElementById('mapartCompanyShowcase').value = Array.isArray(c.showcase_image_urls) ? c.showcase_image_urls.join('\n') : '';
  document.getElementById('mapartCompanyActive').checked = c.active !== false;
  bkmpMapSetSelectedSpecialties(c.specialties);
  document.getElementById('mapartCompanyEditForm').style.display = '';
}

async function bkmpMapSaveCompanyForm() {
  const name = document.getElementById('mapartCompanyName').value.trim();
  if (!name) { bkmpMapNotify('Bitte einen Namen eingeben.', 'error'); return; }
  const company = {
    name,
    contact_person: document.getElementById('mapartCompanyContact').value.trim() || null,
    logo_url: document.getElementById('mapartCompanyLogo').value.trim() || null,
    banner_url: document.getElementById('mapartCompanyBanner').value.trim() || null,
    discord_url: document.getElementById('mapartCompanyDiscord').value.trim() || null,
    website_url: document.getElementById('mapartCompanyWebsite').value.trim() || null,
    price_range_min: Number(document.getElementById('mapartCompanyPriceMin').value) || null,
    price_range_max: Number(document.getElementById('mapartCompanyPriceMax').value) || null,
    description: document.getElementById('mapartCompanyDescription').value.trim() || null,
    showcase_image_urls: document.getElementById('mapartCompanyShowcase').value.split('\n').map(s => s.trim()).filter(Boolean),
    specialties: bkmpMapGetSelectedSpecialties(),
    active: document.getElementById('mapartCompanyActive').checked
  };
  if (bkmpMapEditingCompanyId) company.id = bkmpMapEditingCompanyId;
  try {
    const saved = await saveCompany(company);
    if (bkmpMapEditingCompanyId) {
      const idx = bkmpMapAdminCompanies.findIndex(x => x.id === bkmpMapEditingCompanyId);
      if (idx >= 0) bkmpMapAdminCompanies[idx] = saved || company;
    } else if (saved) {
      bkmpMapAdminCompanies.push(saved);
    }
    bkmpMapRenderCompaniesAdminList();
    document.getElementById('mapartCompanyEditForm').style.display = 'none';
    bkmpMapNotify('Firma gespeichert.', 'success');
  } catch (e) {
    console.error('Firma konnte nicht gespeichert werden.', e);
    bkmpMapNotify('Konnte nicht gespeichert werden: ' + (e.message || ''), 'error');
  }
}

/* ---------------- Admin: Kartenaufträge Übersicht ---------------- */

function bkmpMapRenderAdminOrderActions(o) {
  const companyOptions = bkmpMapAdminCompanies.map(c => `<option value="${c.id}" ${c.id === o.assigned_company_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  return `
    <div class="map-order-admin-actions" onclick="event.stopPropagation()">
      <select><option value="">Firma wählen...</option>${companyOptions}</select>
      <button type="button" class="btn-ja map-order-admin-assign" data-order-id="${o.id}">Zuweisen</button>
      ${o.assigned_company_id ? `<button type="button" class="btn-nein map-order-admin-reset" data-order-id="${o.id}">Zurücksetzen</button>` : ''}
      <button type="button" class="btn-nein map-order-admin-delete" data-order-id="${o.id}">Löschen</button>
    </div>`;
}

let bkmpMapAdminOrdersCache = [];
let bkmpMapAdminOrdersFilters = { query: '', status: '', category: '' };

async function refreshMapartOrdersOverview() {
  const el = document.getElementById('mapartOrdersOverviewList');
  if (!el) return;
  el.innerHTML = '<p class="empty-hint">Lädt...</p>';
  if (!bkmpMapAdminCompanies.length) {
    try { bkmpMapAdminCompanies = (await loadCompaniesAdmin()) || []; } catch (e) { console.warn(e); }
  }
  try { bkmpMapAdminOrdersCache = (await loadAllMapOrdersAdmin()) || []; } catch (e) { console.warn('Aufträge konnten nicht geladen werden.', e); bkmpMapAdminOrdersCache = []; }
  bkmpMapRenderAdminOrdersFiltered();
}

function bkmpMapRenderAdminOrdersFiltered() {
  const el = document.getElementById('mapartOrdersOverviewList');
  if (!el) return;
  if (!bkmpMapAdminOrdersCache.length) { el.innerHTML = '<p class="empty-hint">Noch keine Aufträge.</p>'; return; }
  const filtered = bkmpMapFilterOrders(bkmpMapAdminOrdersCache, bkmpMapAdminOrdersFilters);
  el.innerHTML = filtered.length ? filtered.map(o => bkmpMapRenderOrderCard(o, true, bkmpMapRenderAdminOrderActions(o))).join('') : '<p class="empty-hint">Keine Aufträge gefunden.</p>';
  bkmpMapWireOrderCardClicks(el);

  el.querySelectorAll('.map-order-admin-reset').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Auftrag wirklich auf "Offen" zurücksetzen?')) return;
    try { await adminReassignOrder(btn.dataset.orderId, null); bkmpMapNotify('Zurückgesetzt.', 'success'); refreshMapartOrdersOverview(); }
    catch (err) { bkmpMapNotify('Fehler: ' + (err.message || ''), 'error'); }
  }));
  el.querySelectorAll('.map-order-admin-delete').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Auftrag wirklich löschen? Nicht rückgängig zu machen.')) return;
    try {
      const client = bkmpGetSupabaseClient();
      const { error } = await client.from('map_orders').delete().eq('id', btn.dataset.orderId);
      if (error) throw error;
      bkmpMapNotify('Gelöscht.', 'success');
      refreshMapartOrdersOverview();
    } catch (err) { bkmpMapNotify('Fehler: ' + (err.message || ''), 'error'); }
  }));
  el.querySelectorAll('.map-order-admin-assign').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const select = btn.closest('.map-order-admin-actions').querySelector('select');
    if (!select || !select.value) return;
    try { await adminReassignOrder(btn.dataset.orderId, select.value); bkmpMapNotify('Zugewiesen.', 'success'); refreshMapartOrdersOverview(); }
    catch (err) { bkmpMapNotify('Fehler: ' + (err.message || ''), 'error'); }
  }));
}

function bkmpMapInitAdminOrdersFilters() {
  const searchInput = document.getElementById('mapartOrdersSearch');
  if (searchInput) searchInput.addEventListener('input', () => { bkmpMapAdminOrdersFilters.query = searchInput.value; bkmpMapRenderAdminOrdersFiltered(); });
  const statusSelect = document.getElementById('mapartOrdersStatusFilter');
  if (statusSelect) {
    statusSelect.innerHTML = '<option value="">Alle Status</option>' + BKMP_MAP_STATUS_ORDER.map(s => `<option value="${s}">${escapeHtml(BKMP_MAP_STATUS_LABELS[s])}</option>`).join('');
    statusSelect.addEventListener('change', () => { bkmpMapAdminOrdersFilters.status = statusSelect.value; bkmpMapRenderAdminOrdersFiltered(); });
  }
  bkmpMapInitCategoryPillFilter('mapartOrdersCategoryFilter', category => { bkmpMapAdminOrdersFilters.category = category; bkmpMapRenderAdminOrdersFiltered(); });
}

/* ---------------- Öffentliche Firmenbewerbung ("Bist du eine
   Kartenbaufirma? Bewirb dich hier") ---------------- */

function bkmpMapInitCompanyApplyForm() {
  const toggleBtn = document.getElementById('companyApplyToggleBtn');
  const form = document.getElementById('companyApplyForm');
  if (toggleBtn && form) {
    toggleBtn.addEventListener('click', () => {
      const show = form.style.display === 'none';
      form.style.display = show ? '' : 'none';
      toggleBtn.textContent = show ? 'Formular ausblenden' : 'Jetzt bewerben';
      if (show) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const specialtiesEl = document.getElementById('companyApplySpecialtiesFilter');
  if (specialtiesEl) {
    specialtiesEl.innerHTML = BKMP_MAP_CATEGORIES.map(c => `<button type="button" data-specialty="${c.id}">${c.label}</button>`).join('');
    specialtiesEl.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => btn.classList.toggle('active')));
  }

  const logoInput = document.getElementById('companyApplyLogo');
  const logoPreview = document.getElementById('companyApplyLogoPreview');
  const logoPreviewImg = document.getElementById('companyApplyLogoPreviewImg');
  if (logoInput && logoPreview && logoPreviewImg) {
    logoInput.addEventListener('change', () => {
      const file = logoInput.files && logoInput.files[0];
      if (!file) { logoPreview.style.display = 'none'; return; }
      const reader = new FileReader();
      reader.onload = () => { logoPreviewImg.src = reader.result; logoPreview.style.display = ''; };
      reader.readAsDataURL(file);
    });
  }

  const submitBtn = document.getElementById('companyApplySubmitBtn');
  if (submitBtn) submitBtn.addEventListener('click', bkmpMapSubmitCompanyApplication);
}

function bkmpMapSubmitCompanyApplication() {
  const msgEl = document.getElementById('companyApplySubmitMsg');
  const setMsg = (text, isError) => { if (msgEl) { msgEl.textContent = text; msgEl.style.color = isError ? 'var(--neg)' : 'var(--gold)'; } };

  const name = document.getElementById('companyApplyName').value.trim();
  const contact = document.getElementById('companyApplyContact').value.trim();
  if (!name || !contact) { setMsg('Bitte Firmenname und Ansprechpartner ausfüllen.', true); return; }
  if (!document.getElementById('companyApplyConsent').checked) { setMsg('Bitte bestätige, dass du berechtigt bist und die Angaben korrekt sind.', true); return; }

  const cooldown = bkmpSubmitCooldownSecondsLeft('companyapply');
  if (cooldown > 0) { setMsg(`Bitte warte noch ${cooldown} Sekunde(n), bevor du erneut einreichst.`, true); return; }

  const discord_url = document.getElementById('companyApplyDiscord').value.trim();
  const website_url = document.getElementById('companyApplyWebsite').value.trim();
  const description = document.getElementById('companyApplyDescription').value.trim();
  const price_range_min = document.getElementById('companyApplyPriceMin').value.trim();
  const price_range_max = document.getElementById('companyApplyPriceMax').value.trim();
  const banner_url = document.getElementById('companyApplyBanner').value.trim();
  const specialties = [...document.querySelectorAll('#companyApplySpecialtiesFilter button.active')].map(b => b.dataset.specialty).join(',');
  const logoInput = document.getElementById('companyApplyLogo');
  const logoFile = logoInput && logoInput.files && logoInput.files[0];
  if (!logoFile) { setMsg('Bitte ein Firmenlogo hochladen.', true); return; }

  const submitBtn = document.getElementById('companyApplySubmitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Wird gesendet...';
  function resetBtn() { submitBtn.disabled = false; submitBtn.textContent = 'Bewerbung einreichen'; }

  bkmpCompressImageFile(logoFile, { maxWidth: 500 }).then(logoDataUrl => {
    return bkmpSubmitViaApi('company_application', {
      name, contact_person: contact, discord_url, website_url, description,
      specialties, price_range_min, price_range_max, banner_url
    }, logoDataUrl);
  }).then(() => {
    bkmpStartSubmitCooldown('companyapply');
    resetBtn();
    setMsg('✅ Bewerbung eingereicht! Wir melden uns, sobald sie geprüft wurde.', false);
    document.getElementById('companyApplyForm').reset();
    document.getElementById('companyApplyLogoPreview').style.display = 'none';
    document.querySelectorAll('#companyApplySpecialtiesFilter button.active').forEach(b => b.classList.remove('active'));
  }).catch(e => {
    console.error('Firmenbewerbung konnte nicht gesendet werden.', e);
    resetBtn();
    setMsg('Fehler beim Senden: ' + (e && e.message || e), true);
  });
}

function bkmpMapInit() {
  bkmpMapInitSubtabs();
  bkmpMapInitCategoryFilter();
  bkmpMapInitPriorityFilter();
  bkmpMapInitBudgetFilter();
  bkmpMapInitSizeToggle();
  bkmpMapInitWorkspace();
  bkmpMapInitReferenceImages();
  bkmpMapInitAccessCodeFlow();
  bkmpMapInitOpenOrdersFilters();
  bkmpMapInitMyOrdersFilters();
  bkmpMapInitAdminOrdersFilters();
  bkmpMapInitCompanyOrdersFilters();
  bkmpMapInitCompanyApplyForm();
  const companyDetailCloseBtn = document.getElementById('mapCompanyDetailClose');
  if (companyDetailCloseBtn) companyDetailCloseBtn.addEventListener('click', bkmpMapCloseCompanyDetail);
  const companyAddNewBtn = document.getElementById('mapartCompanyAddNew');
  if (companyAddNewBtn) companyAddNewBtn.addEventListener('click', () => { bkmpMapClearCompanyForm(); document.getElementById('mapartCompanyEditForm').style.display = ''; });
  const companyCancelBtn = document.getElementById('mapartCompanyCancel');
  if (companyCancelBtn) companyCancelBtn.addEventListener('click', () => { document.getElementById('mapartCompanyEditForm').style.display = 'none'; });
  const companySaveBtn = document.getElementById('mapartCompanySave');
  if (companySaveBtn) companySaveBtn.addEventListener('click', bkmpMapSaveCompanyForm);
  bkmpMapUpdateTotalPreview();

  const partsInput = document.getElementById('mapOrderParts');
  if (partsInput) partsInput.addEventListener('input', bkmpMapUpdateTotalPreview);

  const submitBtn = document.getElementById('mapOrderSubmitBtn');
  if (submitBtn) submitBtn.addEventListener('click', bkmpMapSubmitOrder);

  const emptyCreateBtn = document.getElementById('mapMyOrdersEmptyCreateBtn');
  if (emptyCreateBtn) emptyCreateBtn.addEventListener('click', () => { const btn = document.getElementById('ordersSubtabCreate'); if (btn) btn.click(); });

  window.setTimeout(() => {
    const nameInput = document.getElementById('mapOrderMcName');
    if (nameInput && typeof bkmpGetMcName === 'function') nameInput.value = bkmpGetMcName();
  }, 0);
}
bkmpMapInit();
