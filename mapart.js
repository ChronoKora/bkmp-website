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
  { id: 'pixelart', label: 'PixelArt' },
  { id: 'teppich', label: 'Teppich' },
  { id: 'wolle', label: 'Wolle' },
  { id: 'allblock', label: 'Allblock' },
  { id: '3d', label: '3D' },
  { id: 'sonstiges', label: 'Sonstiges' }
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

function bkmpMapFormatMoney(n) {
  return typeof bkmpFormatCurrency === 'function' ? bkmpFormatCurrency(Number(n) || 0) : new Intl.NumberFormat('de-DE').format(Math.round(Number(n) || 0));
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
  el.innerHTML = BKMP_MAP_BUDGET_STEPS.map((v, i) => `<button type="button" class="${i === 0 ? 'active' : ''}" data-budget="${v}">${bkmpMapFormatMoney(v)}</button>`).join('');
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
    preview.textContent = `Geschätzter Gesamtpreis: ${bkmpMapFormatMoney(bkmpMapOrderState.budgetPerPart * parts)}`;
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
  const date = (document.getElementById('mapOrderDate') || {}).value || null;
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
      desired_completion_date: date || null,
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

/* ---------------- Offene Aufträge ---------------- */

async function bkmpMapRenderOpenOrders() {
  const el = document.getElementById('mapOpenOrdersList');
  if (!el) return;
  el.innerHTML = '<p class="empty-hint">Lädt...</p>';
  let orders = [];
  try { orders = (typeof loadOpenMapOrders === 'function' ? await loadOpenMapOrders() : []) || []; } catch (e) { console.warn(e); }
  if (!orders.length) { el.innerHTML = '<p class="empty-hint">Aktuell keine offenen Aufträge.</p>'; return; }
  el.innerHTML = orders.map(o => bkmpMapRenderOrderCard(o, false)).join('');
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
  const budgetText = o.budget_total ? `${bkmpMapFormatMoney(o.budget_total)} gesamt` : `${bkmpMapFormatMoney(o.budget_per_part)} / Kartenteil`;
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
  let orders = [];
  try { orders = (await loadMyMapOrders()) || []; } catch (e) { console.warn(e); }
  if (!orders.length) { listEl.innerHTML = '<p class="empty-hint">Noch keine eigenen Aufträge.</p>'; return; }
  listEl.innerHTML = orders.map(o => bkmpMapRenderOrderCard(o, true)).join('');
}

/* ---------------- Firmenprofile ---------------- */

async function bkmpMapRenderCompanies() {
  const el = document.getElementById('mapCompaniesList');
  if (!el) return;
  el.innerHTML = '<p class="empty-hint">Lädt...</p>';
  let companies = [];
  try { companies = (typeof loadCompanies === 'function' ? await loadCompanies() : []) || []; } catch (e) { console.warn(e); }
  if (!companies.length) { el.innerHTML = '<p class="empty-hint">Noch keine Kartenbaufirmen gelistet.</p>'; return; }
  el.innerHTML = companies.map(c => `
    <div class="map-company-card">
      ${c.logo_url ? `<img src="${escapeHtml(c.logo_url)}" alt="" class="map-company-logo">` : ''}
      <h3>${escapeHtml(c.name)}</h3>
      <p class="map-company-desc">${escapeHtml((c.description || '').slice(0, 140))}${(c.description || '').length > 140 ? '…' : ''}</p>
      ${c.price_range_min ? `<p class="map-company-price">${bkmpMapFormatMoney(c.price_range_min)} – ${bkmpMapFormatMoney(c.price_range_max)}</p>` : ''}
    </div>`).join('');
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

async function bkmpMapRenderCompanyDashboard(profile) {
  window.bkmpCurrentCompanyProfile = profile;
  const nameEl = document.getElementById('companyDashboardName');
  if (nameEl) nameEl.textContent = profile && profile.display_name ? `Eingeloggt als ${profile.display_name}` : '';
  if (!profile || !profile.company_id) return;

  const newEl = document.getElementById('companyNewOrdersList');
  const runningEl = document.getElementById('companyRunningOrdersList');
  const doneEl = document.getElementById('companyDoneOrdersList');
  const newCountEl = document.getElementById('companyNewOrdersCount');
  const runningCountEl = document.getElementById('companyRunningOrdersCount');
  const doneCountEl = document.getElementById('companyDoneOrdersCount');
  if (newEl) newEl.innerHTML = '<p class="empty-hint">Lädt...</p>';

  let openOrders = [];
  let companyOrders = [];
  try {
    [openOrders, companyOrders] = await Promise.all([
      typeof loadOpenMapOrders === 'function' ? loadOpenMapOrders() : [],
      typeof loadCompanyOrders === 'function' ? loadCompanyOrders(profile.company_id) : []
    ]);
  } catch (e) { console.warn('Aufträge konnten nicht geladen werden.', e); }

  const running = (companyOrders || []).filter(o => !['fertig', 'abgeschlossen', 'abgebrochen'].includes(o.status));
  const done = (companyOrders || []).filter(o => ['fertig', 'abgeschlossen', 'abgebrochen'].includes(o.status));

  if (newCountEl) newCountEl.textContent = `(${(openOrders || []).length})`;
  if (runningCountEl) runningCountEl.textContent = `(${running.length})`;
  if (doneCountEl) doneCountEl.textContent = `(${done.length})`;

  if (newEl) {
    newEl.innerHTML = (openOrders || []).length
      ? openOrders.map(o => bkmpMapRenderOrderCard(o, false, `<button type="button" class="btn-ja map-order-claim-btn" data-order-id="${o.id}">Auftrag übernehmen</button>`)).join('')
      : '<p class="empty-hint">Aktuell keine offenen Aufträge.</p>';
    newEl.querySelectorAll('.map-order-claim-btn').forEach(btn => btn.addEventListener('click', () => bkmpMapClaimOrder(btn.dataset.orderId, btn)));
  }
  if (runningEl) runningEl.innerHTML = running.length ? running.map(o => bkmpMapRenderOrderCard(o, true)).join('') : '<p class="empty-hint">Keine laufenden Aufträge.</p>';
  if (doneEl) doneEl.innerHTML = done.length ? done.map(o => bkmpMapRenderOrderCard(o, true)).join('') : '<p class="empty-hint">Noch keine abgeschlossenen Aufträge.</p>';
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

function bkmpMapInit() {
  bkmpMapInitSubtabs();
  bkmpMapInitCategoryFilter();
  bkmpMapInitPriorityFilter();
  bkmpMapInitBudgetFilter();
  bkmpMapInitSizeToggle();
  bkmpMapInitReferenceImages();
  bkmpMapInitAccessCodeFlow();
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
