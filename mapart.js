/* ============================================================
   Bkmp - Kartenfirmen

   Frueher "Kartenaufträge" - ein komplettes Auftrags-/Chat-/Kunden-Konto-
   System. Auf Betreiber-Wunsch (15.07.) komplett ueber den Haufen geworfen
   und durch eine reine Firmenpraesentation ersetzt, exakt nach dem Vorbild
   von PartnerShops: oeffentliche Bewerbung -> Admin-Freigabe -> Verzeichnis.
   Kein Auftragssystem, kein Chat, kein Kunden-Login mehr (siehe
   supabase-mapart-orders-teardown.sql fuer die Historie/den Rueckbau).

   Wird von index.html (oeffentliches Verzeichnis + Bewerbungsformular) UND
   admin.html (Bewerbungs-Pruefung + Firmen-Verwaltung) geladen.

   Ladereihenfolge: supabase.js -> app.js -> mapart.js -> Inline-Script.
   escapeHtml()/bkmpCompressImageFile() aus app.js und alle load/save-
   Funktionen aus supabase.js sind hier bereits verfuegbar.
   ============================================================ */

const BKMP_MAP_CATEGORIES = [
  { id: '2d_teppich', label: '2D Teppich' },
  { id: '2d_allblock', label: '2D All Block' },
  { id: '3d_wolle', label: '3D Wolle' },
  { id: '3d_allblock', label: '3D All Block' }
];

function bkmpMapFormatMoney(n) {
  return new Intl.NumberFormat('de-DE').format(Math.round(Number(n) || 0));
}

/* Kappt an der letzten Wortgrenze VOR maxLen statt mitten im Wort. */
function bkmpMapTruncateWords(text, maxLen) {
  const s = text || '';
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…';
}

function bkmpMapCategoryLabel(id) {
  const c = BKMP_MAP_CATEGORIES.find(x => x.id === id);
  return c ? c.label : id;
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

function bkmpMapNotify(message, type) {
  /* showAdminToast existiert nur in admin.html - hier trotzdem als
     Fallback, falls diese Funktion je von index.html aus gebraucht wird. */
  if (typeof showAdminToast === 'function') { showAdminToast(message, type); return; }
  if (type === 'error') { console.error(message); alert(message); } else { console.log(message); }
}

/* ---------------- Oeffentliches Firmenverzeichnis (index.html) ----------------
   Gleiches Prinzip wie renderPartnerShops() in index.html: Kachel-Grid mit
   Kategorie-Filter-Pillen, reine Anzeige, kein Klick-Detail-Overlay noetig -
   alle relevanten Infos passen direkt auf die Karte. */

let bkmpMapCompaniesCache = [];
let bkmpMapCompaniesFilterSpecialty = '';

async function bkmpMapRenderCompanies() {
  const el = document.getElementById('mapCompaniesList');
  if (!el) return;
  el.innerHTML = '<p class="empty-hint">Lädt...</p>';
  try { bkmpMapCompaniesCache = (typeof loadCompanies === 'function' ? await loadCompanies() : []) || []; } catch (e) { console.warn('Kartenfirmen konnten nicht geladen werden.', e); bkmpMapCompaniesCache = []; }
  bkmpMapRenderCompaniesFiltered();
}

function bkmpMapRenderCompaniesFiltered() {
  const el = document.getElementById('mapCompaniesList');
  if (!el) return;
  if (!bkmpMapCompaniesCache.length) { el.innerHTML = '<p class="empty-hint">Noch keine Kartenbaufirmen gelistet.</p>'; return; }
  const visible = bkmpMapCompaniesFilterSpecialty
    ? bkmpMapCompaniesCache.filter(c => Array.isArray(c.specialties) && c.specialties.includes(bkmpMapCompaniesFilterSpecialty))
    : bkmpMapCompaniesCache;
  el.innerHTML = visible.length ? visible.map(c => {
    const specialtiesLabel = Array.isArray(c.specialties) && c.specialties.length ? c.specialties.map(bkmpMapCategoryLabel).join(', ') : 'Kartenfirma';
    const priceText = c.price_range_min
      ? `💰 ${bkmpMapFormatMoney(c.price_range_min)}${c.price_range_max && Number(c.price_range_max) !== Number(c.price_range_min) ? ' – ' + bkmpMapFormatMoney(c.price_range_max) : ''}`
      : '';
    return `
      <article class="partner-card">
        <div class="partner-image-frame" data-bkmp-image-wrap data-empty-label="Kein Logo">
          ${c.logo_url ? `<img data-bkmp-img src="${escapeHtml(c.logo_url)}" alt="${escapeHtml(c.name)}" loading="eager" fetchpriority="low" decoding="async">` : '<div class="partner-image-empty">Kein Logo</div>'}
        </div>
        <div class="partner-body">
          <span class="partner-category">${escapeHtml(specialtiesLabel)}</span>
          <h3>${escapeHtml(c.name)}</h3>
          ${priceText ? `<div class="partner-location">${priceText}</div>` : ''}
          ${c.description ? `<p>${escapeHtml(bkmpMapTruncateWords(c.description, 160))}</p>` : ''}
          <div class="partner-actions">
            ${c.discord_url ? `<a href="${escapeHtml(c.discord_url)}" target="_blank" rel="noopener">Discord</a>` : ''}
            ${c.website_url ? `<a href="${escapeHtml(c.website_url)}" target="_blank" rel="noopener">Website</a>` : ''}
            ${c.contact_person ? `<span>${escapeHtml(c.contact_person)}</span>` : ''}
          </div>
        </div>
      </article>`;
  }).join('') : '<p class="empty-hint">Keine Firmen in dieser Kategorie.</p>';
  if (window.bkmpEnhanceImages) window.bkmpEnhanceImages(el);
  window.requestAnimationFrame(() => {
    el.querySelectorAll('img[data-bkmp-img]').forEach(img => {
      if (!img.complete && img.dataset.originalSrc) img.src = img.dataset.originalSrc;
    });
  });
}

function bkmpMapInitCompaniesFilter() {
  bkmpMapInitCategoryPillFilter('mapCompaniesFilter', specialty => { bkmpMapCompaniesFilterSpecialty = specialty; bkmpMapRenderCompaniesFiltered(); });
  bkmpMapRenderCompanies();
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
  bkmpMapInitCompaniesFilter();
  bkmpMapInitCompanyApplyForm();
  const companyAddNewBtn = document.getElementById('mapartCompanyAddNew');
  if (companyAddNewBtn) companyAddNewBtn.addEventListener('click', () => { bkmpMapClearCompanyForm(); document.getElementById('mapartCompanyEditForm').style.display = ''; });
  const companyCancelBtn = document.getElementById('mapartCompanyCancel');
  if (companyCancelBtn) companyCancelBtn.addEventListener('click', () => { document.getElementById('mapartCompanyEditForm').style.display = 'none'; });
  const companySaveBtn = document.getElementById('mapartCompanySave');
  if (companySaveBtn) companySaveBtn.addEventListener('click', bkmpMapSaveCompanyForm);
}
bkmpMapInit();
