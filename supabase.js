/* ============================================================
   Bkmp - Supabase Konfiguration

   Wichtig: Hier wird ausschliesslich der Publishable Key genutzt.
   Der Secret Key gehoert niemals in diese Datei oder in den Browser.
   Wenn Supabase nicht erreichbar ist, nutzt die Website automatisch
   localStorage als Fallback.
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RuiDW15_3cI0cQZ8WlzoWg_DhGU9r6f';

let bkmpSupabaseClient = null;

function bkmpIsSupabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    SUPABASE_URL.startsWith('https://') &&
    !SUPABASE_URL.includes('/rest/v1')
  );
}

function bkmpGetSupabaseClient() {
  if (!bkmpIsSupabaseConfigured()) return null;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.warn('Supabase Client wurde nicht geladen. localStorage-Fallback wird verwendet.');
    return null;
  }
  if (!bkmpSupabaseClient) {
    bkmpSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return bkmpSupabaseClient;
}

async function bkmpStoreImageIfNeeded(value, folder) {
  if (!value || typeof value !== 'string' || !value.startsWith('data:image/')) return value || '';
  const client = bkmpGetSupabaseClient();
  if (!client) return value;
  const response = await fetch(value);
  const blob = await response.blob();
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'jpg' : 'webp';
  const safeFolder = String(folder || 'content').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const fileName = `${safeFolder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await client.storage
    .from('update-images')
    .upload(fileName, blob, {
      contentType: blob.type || 'image/webp',
      upsert: false
    });
  if (error) throw error;
  const { data } = client.storage.from('update-images').getPublicUrl(fileName);
  return data && data.publicUrl ? data.publicUrl : value;
}

/* ============================================================
   Nachtraegliche Komprimierung bereits hochgeladener Bilder
   Betrifft nur Bilder, die VOR der Kompressions-Funktion
   hochgeladen wurden (about_blocks, partner_shops, wishes).
   Bilder unter 150 KB werden uebersprungen, da sich eine erneute
   Komprimierung dort kaum noch lohnt.
   ============================================================ */
async function bkmpCompressRemoteImageUrl(url, folder) {
  if (!url || typeof url !== 'string') return null;
  const isFetchable = /^https?:\/\//i.test(url) || url.startsWith('data:image/');
  if (!isFetchable) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type || !blob.type.startsWith('image/')) return null;
    if (blob.size < 150000) return null;
    const file = new File([blob], 'image', { type: blob.type });
    const compressedDataUrl = await bkmpCompressImageFile(file, { maxWidth: 1000, quality: 0.74 });
    if (typeof compressedDataUrl !== 'string' || !compressedDataUrl.startsWith('data:image/')) return null;
    const uploadedUrl = await bkmpStoreImageIfNeeded(compressedDataUrl, folder);
    if (!uploadedUrl || uploadedUrl === compressedDataUrl) return null;
    return { newUrl: uploadedUrl, beforeBytes: blob.size };
  } catch (e) {
    console.warn('Bild konnte nicht nachkomprimiert werden:', url.slice(0, 60), e);
    return null;
  }
}

async function compressAboutBlockImages(onProgress) {
  const client = bkmpGetSupabaseClient();
  if (!client) return { processed: 0, compressed: 0 };
  const { data: rows, error } = await client.from('about_blocks').select('id, image_url, image_urls');
  if (error) throw error;
  let processed = 0;
  let compressed = 0;
  for (const row of rows || []) {
    const urls = Array.isArray(row.image_urls) && row.image_urls.length ? row.image_urls : (row.image_url ? [row.image_url] : []);
    if (!urls.length) continue;
    const nextUrls = [];
    let changed = false;
    for (const url of urls) {
      processed++;
      if (typeof onProgress === 'function') onProgress({ table: 'about_blocks', processed, compressed });
      const result = await bkmpCompressRemoteImageUrl(url, 'about');
      if (result) {
        nextUrls.push(result.newUrl);
        changed = true;
        compressed++;
      } else {
        nextUrls.push(url);
      }
    }
    if (changed) {
      const { error: updateError } = await client
        .from('about_blocks')
        .update({ image_url: nextUrls[0] || '', image_urls: nextUrls })
        .eq('id', row.id);
      if (updateError) console.warn('about_blocks Update fehlgeschlagen:', row.id, updateError);
    }
  }
  return { processed, compressed };
}

async function compressPartnerShopImages(onProgress) {
  const client = bkmpGetSupabaseClient();
  if (!client) return { processed: 0, compressed: 0 };
  const { data: rows, error } = await client.from('partner_shops').select('id, image_url');
  if (error) throw error;
  let processed = 0;
  let compressed = 0;
  for (const row of rows || []) {
    if (!row.image_url) continue;
    processed++;
    if (typeof onProgress === 'function') onProgress({ table: 'partner_shops', processed, compressed });
    const result = await bkmpCompressRemoteImageUrl(row.image_url, 'partner-shops');
    if (result) {
      const { error: updateError } = await client.from('partner_shops').update({ image_url: result.newUrl }).eq('id', row.id);
      if (updateError) console.warn('partner_shops Update fehlgeschlagen:', row.id, updateError);
      else compressed++;
    }
  }
  return { processed, compressed };
}

async function compressWishImages(onProgress) {
  const client = bkmpGetSupabaseClient();
  if (!client) return { processed: 0, compressed: 0 };
  const { data: rows, error } = await client.from('wishes').select('id, image_url');
  if (error) throw error;
  let processed = 0;
  let compressed = 0;
  for (const row of rows || []) {
    if (!row.image_url) continue;
    processed++;
    if (typeof onProgress === 'function') onProgress({ table: 'wishes', processed, compressed });
    const result = await bkmpCompressRemoteImageUrl(row.image_url, 'wishes');
    if (result) {
      const { error: updateError } = await client.from('wishes').update({ image_url: result.newUrl }).eq('id', row.id);
      if (updateError) console.warn('wishes Update fehlgeschlagen:', row.id, updateError);
      else compressed++;
    }
  }
  return { processed, compressed };
}

async function compressAllExistingImages(onProgress) {
  const about = await compressAboutBlockImages(onProgress);
  const shops = await compressPartnerShopImages(onProgress);
  const wishes = await compressWishImages(onProgress);
  return {
    processed: about.processed + shops.processed + wishes.processed,
    compressed: about.compressed + shops.compressed + wishes.compressed,
    about,
    shops,
    wishes
  };
}

window.compressAllExistingImages = compressAllExistingImages;

function bkmpIsPersistentImageUrl(value) {
  if (!value || typeof value !== 'string') return false;
  if (value.startsWith('data:image/')) return false;
  return /^(https?:\/\/|assets\/|\/)/i.test(value);
}

function bkmpUseLocalImageIfPersistent(target, local) {
  if (!target || !local || target.image || !bkmpIsPersistentImageUrl(local.image)) return;
  target.image = local.image;
  if (Array.isArray(local.images)) {
    target.images = local.images.filter(bkmpIsPersistentImageUrl);
  }
}

function bkmpAdminEmailFromName(name) {
  const clean = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  return clean ? clean + '@bkmp-admin.local' : '';
}

async function bkmpLoginAdmin(name, password) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const email = bkmpAdminEmailFromName(name);
  if (!email || !password) throw new Error('Name und Passwort fehlen.');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const userId = data && data.user ? data.user.id : '';
  const { data: profiles, error: profileError } = await client
    .from('admin_profiles')
    .select('id, login_name, active')
    .order('created_at', { ascending: true });
  if (profileError) throw profileError;
  if (!profiles || profiles.length === 0) {
    const { error: insertError } = await client.from('admin_profiles').insert({
      auth_user_id: userId,
      display_name: String(name || '').trim(),
      login_name: email,
      role: 'admin',
      active: true
    });
    if (insertError) throw insertError;
    return data;
  }
  const ownProfile = profiles.find(profile => profile.login_name === email);
  if (!ownProfile || !ownProfile.active) {
    await client.auth.signOut();
    throw new Error('Dieser Admin-Zugang ist nicht aktiv.');
  }
  return data;
}

async function bkmpLogoutAdmin() {
  const client = bkmpGetSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
}

async function bkmpGetAdminSession() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data && data.session ? data.session : null;
}

async function bkmpGetValidAdminSession() {
  const session = await bkmpGetAdminSession();
  if (!session || !session.user || !session.user.email) return null;
  const client = bkmpGetSupabaseClient();
  try {
    const { data, error } = await client
      .from('admin_profiles')
      .select('active')
      .eq('login_name', session.user.email)
      .limit(1);
    if (error) throw error;
    const profile = Array.isArray(data) ? data[0] : null;
    if (profile && profile.active) return session;
  } catch (e) {
    console.warn('Admin-Session konnte nicht geprueft werden.', e);
  }
  await client.auth.signOut();
  return null;
}

function bkmpGetAuthCreateClient() {
  if (!bkmpIsSupabaseConfigured() || !window.supabase) return null;
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'bkmp-admin-create-temp'
    }
  });
}

async function loadAdminProfiles() {
  const client = bkmpGetSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('admin_profiles')
    .select('id, auth_user_id, display_name, login_name, role, active, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function createAdminAccess(name, password, role) {
  const currentClient = bkmpGetSupabaseClient();
  const createClient = bkmpGetAuthCreateClient();
  if (!currentClient || !createClient) throw new Error('Supabase ist nicht verbunden.');
  const displayName = String(name || '').trim();
  const email = bkmpAdminEmailFromName(displayName);
  if (!email) throw new Error('Bitte einen gueltigen Namen eintragen.');
  if (!password || password.length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen.');

  const { data: signUpData, error: signUpError } = await createClient.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName, role: role || 'admin' } }
  });
  if (signUpError) throw signUpError;

  const authUserId = signUpData && signUpData.user ? signUpData.user.id : null;
  const { data, error } = await currentClient
    .from('admin_profiles')
    .upsert({
      auth_user_id: authUserId,
      display_name: displayName,
      login_name: email,
      role: role || 'admin',
      active: true
    }, { onConflict: 'login_name' })
    .select('id, auth_user_id, display_name, login_name, role, active, created_at')
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] : null;
}

async function setAdminAccessActive(id, active) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('admin_profiles').update({ active: Boolean(active) }).eq('id', id);
  if (error) throw error;
  return true;
}

function bkmpMapIncomeFromSupabase(row) {
  return {
    id: row.id,
    name: typeof bkmpNormalizeCategoryName === 'function' ? bkmpNormalizeCategoryName(row.category) : row.category,
    category: typeof bkmpNormalizeCategoryName === 'function' ? bkmpNormalizeCategoryName(row.category) : row.category,
    amount: Number(row.amount || 0),
    date: row.date,
    note: row.note || '',
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpNormalizeIncomeDate(income) {
  if (income.date && /^\d{4}-\d{2}-\d{2}$/.test(income.date)) return income.date;
  if (income.date) {
    const parsedDate = new Date(income.date);
    if (!Number.isNaN(parsedDate.getTime())) return parsedDate.toISOString().slice(0, 10);
  }
  if (income.createdAt) {
    const createdDate = new Date(income.createdAt);
    if (!Number.isNaN(createdDate.getTime())) return createdDate.toISOString().slice(0, 10);
  }
  return null;
}

function bkmpMapIncomeToSupabase(income, options = {}) {
  const payload = {
    category: income.category || income.name,
    amount: Number(income.amount || 0),
    date: bkmpNormalizeIncomeDate(income),
    note: income.note || null
  };

  if (options.keepCreatedAt && income.createdAt) {
    const createdDate = new Date(income.createdAt);
    if (!Number.isNaN(createdDate.getTime())) {
      payload.created_at = createdDate.toISOString();
    }
  }

  return payload;
}

function bkmpIncomeSignature(income) {
  return [
    income.category || income.name || '',
    Number(income.amount || 0).toFixed(2),
    income.date || '',
    income.note || '',
    income.createdAt ? new Date(income.createdAt).toISOString() : ''
  ].join('|');
}

async function loadIncomes() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('incomes')
    .select('id, category, amount, date, note, created_at')
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(bkmpMapIncomeFromSupabase);
}

async function saveIncome(income) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('incomes')
    .insert(bkmpMapIncomeToSupabase(income))
    .select('id, category, amount, date, note, created_at')
    .single();

  if (error) throw error;
  return bkmpMapIncomeFromSupabase(data);
}

async function deleteIncome(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;

  const { error } = await client
    .from('incomes')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

async function syncIncomesFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadIncomes !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const incomes = await loadIncomes();
    if (!incomes) return false;

    const localIncomeCount = Array.isArray(targetData.income) ? targetData.income.length : 0;
    if (localIncomeCount > 0 && incomes.length === 0) {
      console.warn('Supabase enthaelt keine Einnahmen. Lokale Daten bleiben erhalten.');
      return false;
    }

    targetData.income = incomes;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Einnahmen nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

async function importLocalIncomesToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) {
    console.warn('Supabase ist nicht verbunden. Import wurde abgebrochen.');
    return { imported: 0, skipped: 0, skippedInvalid: 0, total: 0 };
  }

  const localData = bkmpLoadData();
  const localIncomes = Array.isArray(localData.income) ? localData.income : [];
  if (localIncomes.length === 0) {
    return { imported: 0, skipped: 0, skippedInvalid: 0, total: 0 };
  }

  const remoteIncomes = await loadIncomes() || [];
  const existing = new Set(remoteIncomes.map(bkmpIncomeSignature));
  const rowsToInsert = [];
  let skipped = 0;
  let skippedInvalid = 0;

  localIncomes.forEach(income => {
    const payload = bkmpMapIncomeToSupabase(income, { keepCreatedAt: true });
    if (!payload.category || !payload.date || Number.isNaN(payload.amount)) {
      skippedInvalid += 1;
      console.warn('Einnahme ohne gueltige Kategorie, Betrag oder Datum wurde beim Import uebersprungen:', income);
      return;
    }

    const signature = bkmpIncomeSignature({
      name: payload.category,
      category: payload.category,
      amount: payload.amount,
      date: payload.date,
      note: payload.note || '',
      createdAt: payload.created_at ? Date.parse(payload.created_at) : 0
    });

    if (existing.has(signature)) {
      skipped += 1;
      return;
    }
    existing.add(signature);
    rowsToInsert.push(payload);
  });

  if (rowsToInsert.length > 0) {
    const { error } = await client.from('incomes').insert(rowsToInsert);
    if (error) throw error;
  }

  const refreshed = await loadIncomes() || [];
  localData.income = refreshed;
  bkmpSaveData(localData);

  return {
    imported: rowsToInsert.length,
    skipped,
    skippedInvalid,
    total: refreshed.length
  };
}

function bkmpMapInvestorFromSupabase(row) {
  return {
    id: row.id,
    name: row.name,
    minecraftName: row.note || '',
    invested: Number(row.investment || 0),
    sharePercent: Number(row.profit_percent || 0),
    startDate: row.start_date || '',
    endDate: row.end_date || '',
    anonymous: Boolean(row.anonymous),
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapInvestorToSupabase(investor) {
  return {
    name: investor.name,
    investment: Number(investor.invested || investor.investment || 0),
    profit_percent: Number(investor.sharePercent || investor.profit_percent || 0),
    start_date: investor.startDate || investor.start_date || null,
    end_date: investor.endDate || investor.end_date || null,
    note: investor.minecraftName || investor.note || null,
    anonymous: Boolean(investor.anonymous)
  };
}

async function loadInvestors() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('investors')
    .select('id, name, investment, profit_percent, start_date, end_date, note, created_at')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(bkmpMapInvestorFromSupabase);
}

async function saveInvestor(investor) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;

  const payload = bkmpMapInvestorToSupabase(investor);
  let query;
  if (investor.id && !String(investor.id).startsWith('inv-')) {
    query = client
      .from('investors')
      .update(payload)
      .eq('id', investor.id)
      .select('id, name, investment, profit_percent, start_date, end_date, note, created_at')
      .single();
  } else {
    query = client
      .from('investors')
      .insert(payload)
      .select('id, name, investment, profit_percent, start_date, end_date, note, created_at')
      .single();
  }

  const { data, error } = await query;
  if (error) throw error;
  return bkmpMapInvestorFromSupabase(data);
}

async function deleteInvestor(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;

  const { error } = await client
    .from('investors')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return true;
}

async function syncInvestorsFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadInvestors !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const investors = await loadInvestors();
    if (!investors) return false;

    const localInvestorCount = Array.isArray(targetData.investors) ? targetData.investors.length : 0;
    if (localInvestorCount > 0 && investors.length === 0) {
      console.warn('Supabase enthaelt keine Investoren. Lokale Daten bleiben erhalten.');
      return false;
    }

    targetData.investors = investors;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Investoren nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

async function importLocalInvestorsToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) {
    console.warn('Supabase ist nicht verbunden. Import wurde abgebrochen.');
    return { imported: 0, skipped: 0, total: 0 };
  }

  const localData = bkmpLoadData();
  const localInvestors = Array.isArray(localData.investors) ? localData.investors : [];
  const remoteInvestors = await loadInvestors() || [];
  const existing = new Set(remoteInvestors.map(item => [item.name, item.invested, item.sharePercent, item.startDate, item.endDate, item.minecraftName].join('|')));
  const rowsToInsert = [];
  let skipped = 0;

  localInvestors.forEach(investor => {
    const mapped = bkmpMapInvestorFromSupabase({
      id: investor.id,
      name: investor.name,
      investment: investor.invested,
      profit_percent: investor.sharePercent,
      start_date: investor.startDate || null,
      end_date: investor.endDate || null,
      note: investor.minecraftName || null,
      created_at: investor.createdAt ? new Date(investor.createdAt).toISOString() : null
    });
    const sig = [mapped.name, mapped.invested, mapped.sharePercent, mapped.startDate, mapped.endDate, mapped.minecraftName].join('|');
    if (existing.has(sig)) {
      skipped += 1;
      return;
    }
    existing.add(sig);
    rowsToInsert.push(bkmpMapInvestorToSupabase(mapped));
  });

  if (rowsToInsert.length > 0) {
    const { error } = await client.from('investors').insert(rowsToInsert);
    if (error) throw error;
  }

  const refreshed = await loadInvestors() || [];
  localData.investors = refreshed;
  bkmpSaveData(localData);
  return { imported: rowsToInsert.length, skipped, total: refreshed.length };
}

window.importLocalInvestorsToSupabase = importLocalInvestorsToSupabase;

function bkmpMapExpenseFromSupabase(row) {
  return {
    id: row.id,
    name: typeof bkmpNormalizeCategoryName === 'function' ? bkmpNormalizeCategoryName(row.category) : row.category,
    category: typeof bkmpNormalizeCategoryName === 'function' ? bkmpNormalizeCategoryName(row.category) : row.category,
    amount: Number(row.amount || 0),
    date: row.date,
    note: row.note || '',
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapExpenseToSupabase(expense) {
  return {
    category: expense.category || expense.name,
    amount: Number(expense.amount || 0),
    date: expense.date,
    note: expense.note || null
  };
}

async function loadExpenses() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('expenses')
    .select('id, category, amount, date, note, created_at')
    .order('date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(bkmpMapExpenseFromSupabase);
}

async function saveExpense(expense) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('expenses')
    .insert(bkmpMapExpenseToSupabase(expense))
    .select('id, category, amount, date, note, created_at')
    .single();
  if (error) throw error;
  return bkmpMapExpenseFromSupabase(data);
}

async function deleteExpense(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('expenses').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncExpensesFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadExpenses !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const expenses = await loadExpenses();
    if (!expenses) return false;
    const localCount = Array.isArray(targetData.expenses) ? targetData.expenses.length : 0;
    if (localCount > 0 && expenses.length === 0) {
      console.warn('Supabase enthaelt keine Ausgaben. Lokale Daten bleiben erhalten.');
      return false;
    }
    targetData.expenses = expenses;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Ausgaben nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

function bkmpMapUpdateFromSupabase(row) {
  const images = Array.isArray(row.image_urls) ? row.image_urls : [];
  const createdAt = row.created_at ? Date.parse(row.created_at) : 0;
  return {
    id: row.id,
    title: row.title,
    text: row.content || '',
    image: images[0] || '',
    images,
    date: row.created_at ? row.created_at.slice(0, 10) : '',
    createdAt,
    source: 'supabase'
  };
}

function bkmpMapUpdateToSupabase(update) {
  const images = update.images && update.images.length ? update.images : (update.image ? [update.image] : []);
  const payload = {
    title: update.title,
    content: update.text || update.content || '',
    image_urls: images
  };
  if (update.date) payload.created_at = update.date + 'T12:00:00.000Z';
  return payload;
}

function bkmpDedupeSupabaseUpdates(list) {
  if (typeof bkmpDedupeUpdates === 'function') return bkmpDedupeUpdates(list);
  return list || [];
}

async function loadUpdates() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('updates')
    .select('id, title, content, image_urls, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return bkmpDedupeSupabaseUpdates((data || []).map(bkmpMapUpdateFromSupabase));
}

async function saveUpdate(update) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapUpdateToSupabase(update);
  if (update.id && !String(update.id).startsWith('news-')) {
    if (!payload.image_urls.length) {
      const { data: existingRows, error: existingError } = await client
        .from('updates')
        .select('image_urls')
        .eq('id', update.id)
        .limit(1);
      if (existingError) throw existingError;
      const existingImages = Array.isArray(existingRows) && existingRows[0] && Array.isArray(existingRows[0].image_urls)
        ? existingRows[0].image_urls
        : [];
      if (existingImages.length) payload.image_urls = existingImages;
    }

    const { data, error } = await client
      .from('updates')
      .update(payload)
      .eq('id', update.id)
      .select('id, title, content, image_urls, created_at')
      .limit(1);

    if (error) throw error;
    const updated = Array.isArray(data) ? data[0] : null;
    if (updated) return bkmpMapUpdateFromSupabase(updated);

    const matchDate = update.date || (update.createdAt ? new Date(update.createdAt).toISOString().slice(0, 10) : '');
    let finder = client
      .from('updates')
      .select('id')
      .eq('title', update.title)
      .limit(1);

    if (matchDate) {
      finder = finder
        .gte('created_at', matchDate + 'T00:00:00.000Z')
        .lt('created_at', matchDate + 'T23:59:59.999Z');
    }

    let { data: matches, error: findError } = await finder;
    if (findError) throw findError;
    let match = Array.isArray(matches) ? matches[0] : null;

    if (!match && matchDate) {
      const { data: titleMatches, error: titleFindError } = await client
        .from('updates')
        .select('id')
        .eq('title', update.title)
        .limit(1);
      if (titleFindError) throw titleFindError;
      match = Array.isArray(titleMatches) ? titleMatches[0] : null;
    }

    if (match && match.id) {
      const { data: matchedData, error: matchedError } = await client
        .from('updates')
        .update(payload)
        .eq('id', match.id)
        .select('id, title, content, image_urls, created_at')
        .limit(1);
      if (matchedError) throw matchedError;
      const matchedUpdate = Array.isArray(matchedData) ? matchedData[0] : null;
      if (matchedUpdate) return bkmpMapUpdateFromSupabase(matchedUpdate);
    }
  }

  let existingQuery = client
    .from('updates')
    .select('id, title, content, image_urls, created_at')
    .eq('title', update.title)
    .eq('content', payload.content)
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: existingMatches, error: existingMatchError } = await existingQuery;
  if (existingMatchError) throw existingMatchError;
  const existingMatch = Array.isArray(existingMatches) ? existingMatches[0] : null;
  if (existingMatch && existingMatch.id) {
    if (!payload.image_urls.length && Array.isArray(existingMatch.image_urls)) payload.image_urls = existingMatch.image_urls;
    const { data: updatedData, error: updatedError } = await client
      .from('updates')
      .update(payload)
      .eq('id', existingMatch.id)
      .select('id, title, content, image_urls, created_at')
      .limit(1);
    if (updatedError) throw updatedError;
    const updatedMatch = Array.isArray(updatedData) ? updatedData[0] : null;
    if (updatedMatch) return bkmpMapUpdateFromSupabase(updatedMatch);
  }

  const { data, error } = await client
    .from('updates')
    .insert(payload)
    .select('id, title, content, image_urls, created_at')
    .limit(1);

  if (error) throw error;
  const inserted = Array.isArray(data) ? data[0] : null;
  if (!inserted) throw new Error('Supabase hat keinen gespeicherten Update-Eintrag zurueckgegeben.');
  return bkmpMapUpdateFromSupabase(inserted);
}

async function deleteUpdate(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('updates').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncUpdatesFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadUpdates !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const updates = await loadUpdates();
    if (!updates) return false;
    const localCount = Array.isArray(targetData.news) ? targetData.news.length : 0;
    if (localCount > 0 && updates.length === 0) {
      console.warn('Supabase enthaelt keine Updates. Lokale Updates bleiben erhalten.');
      return false;
    }
    targetData.news = updates;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Updates nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

async function cleanupDuplicateUpdatesInSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { cleaned: 0, kept: 0 };
  const { data, error } = await client
    .from('updates')
    .select('id, title, content, image_urls, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const groups = new Map();
  (data || []).forEach(row => {
    const key = [row.title || '', row.content || ''].join('|').toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  let cleaned = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const keeper = rows[0];
    const duplicates = rows.slice(1);
    const mergedImages = [...new Set(rows.flatMap(row => Array.isArray(row.image_urls) ? row.image_urls : []).filter(Boolean))];
    if (mergedImages.length) {
      const { error: updateError } = await client
        .from('updates')
        .update({ image_urls: mergedImages })
        .eq('id', keeper.id);
      if (updateError) throw updateError;
    }
    const { error: deleteError } = await client
      .from('updates')
      .delete()
      .in('id', duplicates.map(row => row.id));
    if (deleteError) throw deleteError;
    cleaned += duplicates.length;
  }

  return { cleaned, kept: groups.size };
}

window.cleanupDuplicateUpdatesInSupabase = cleanupDuplicateUpdatesInSupabase;

function bkmpMapWishFromSupabase(row) {
  return {
    id: row.id,
    name: row.name,
    image: row.image_url || '',
    likes: Number(row.likes || 0),
    dislikes: Number(row.dislikes || 0),
    date: row.created_at ? row.created_at.slice(0, 10) : '',
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapWishToSupabase(wish) {
  return {
    name: wish.name,
    image_url: wish.image || wish.image_url || ''
  };
}

async function loadWishes() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  let { data, error } = await client
    .from('wishes')
    .select('id, name, image_url, likes, dislikes, created_at')
    .order('created_at', { ascending: false });

  if (error && (String(error.message || '').includes('likes') || String(error.message || '').includes('dislikes'))) {
    const fallback = await client
      .from('wishes')
      .select('id, name, image_url, created_at')
      .order('created_at', { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return (data || []).map(bkmpMapWishFromSupabase);
}

async function saveWish(wish) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapWishToSupabase(wish);
  payload.image_url = await bkmpStoreImageIfNeeded(payload.image_url, 'wishes');
  let { data, error } = await client
    .from('wishes')
    .insert(payload)
    .select('id, name, image_url, likes, dislikes, created_at')
    .single();

  if (error && (String(error.message || '').includes('likes') || String(error.message || '').includes('dislikes'))) {
    const fallback = await client
      .from('wishes')
      .insert(payload)
      .select('id, name, image_url, created_at')
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return bkmpMapWishFromSupabase(data);
}

async function voteWish(id, type, currentValue) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;

  const column = type === 'dislike' ? 'dislikes' : 'likes';
  const nextValue = Number(currentValue || 0) + 1;
  const { data, error } = await client
    .from('wishes')
    .update({ [column]: nextValue })
    .eq('id', id)
    .select('id, name, image_url, likes, dislikes, created_at')
    .limit(1);

  if (error) throw error;
  const updated = Array.isArray(data) ? data[0] : null;
  return updated ? bkmpMapWishFromSupabase(updated) : null;
}

async function deleteWish(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('wishes').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncWishesFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadWishes !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const wishes = await loadWishes();
    if (!wishes) return false;
    const localWishes = Array.isArray(targetData.wishes) ? targetData.wishes : [];
    wishes.forEach(wish => {
      if (wish.image) return;
      const local = localWishes.find(item =>
        String(item.id || '') === String(wish.id || '') ||
        (item.name && item.name === wish.name)
      );
      bkmpUseLocalImageIfPersistent(wish, local);
    });
    const localCount = Array.isArray(targetData.wishes) ? targetData.wishes.length : 0;
    if (localCount > 0 && wishes.length === 0) {
      console.warn('Supabase enthaelt keine Kartenideen. Lokale Kartenideen bleiben erhalten.');
      return false;
    }
    targetData.wishes = wishes;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Kartenideen nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

function bkmpMapStreamerFromSupabase(row) {
  return {
    id: row.id,
    name: row.display_name || row.name || '',
    url: row.url || '',
    color: row.color || 'purple',
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapStreamerToSupabase(streamer) {
  return {
    display_name: streamer.name || streamer.display_name || '',
    url: streamer.url || '',
    color: streamer.color || 'purple'
  };
}

async function loadStreamers() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('streamer_links')
    .select('id, display_name, url, color, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(bkmpMapStreamerFromSupabase);
}

async function saveStreamer(streamer) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapStreamerToSupabase(streamer);
  let query;
  if (streamer.id && !String(streamer.id).startsWith('str-')) {
    query = client
      .from('streamer_links')
      .update(payload)
      .eq('id', streamer.id)
      .select('id, display_name, url, color, created_at')
      .limit(1);
  } else {
    query = client
      .from('streamer_links')
      .insert(payload)
      .select('id, display_name, url, color, created_at')
      .limit(1);
  }
  const { data, error } = await query;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapStreamerFromSupabase(row) : null;
}

async function deleteStreamer(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('streamer_links').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncStreamersFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadStreamers !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const streamers = await loadStreamers();
    if (!streamers) return false;
    const localCount = Array.isArray(targetData.streamers) ? targetData.streamers.length : 0;
    if (localCount > 0 && streamers.length === 0) {
      console.warn('Supabase enthaelt keine Twitch-Accounts. Lokale Twitch-Accounts bleiben erhalten.');
      return false;
    }
    targetData.streamers = streamers;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Twitch-Accounts nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

function bkmpMapAboutBlockFromSupabase(row) {
  return {
    id: row.id,
    type: row.block_type || 'text',
    title: row.title || '',
    content: row.content || '',
    image: row.image_url || '',
    images: Array.isArray(row.image_urls) ? row.image_urls : [],
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapAboutBlockToSupabase(block) {
  const images = block.images && block.images.length ? block.images : (block.image ? [block.image] : []);
  return {
    block_type: block.type || 'text',
    title: block.title || '',
    content: block.content || '',
    image_url: images[0] || block.image || '',
    image_urls: images,
    sort_order: Number(block.sortOrder || block.sort_order || 0)
  };
}

async function loadAboutBlocks() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('about_blocks')
    .select('id, block_type, title, content, image_url, image_urls, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(bkmpMapAboutBlockFromSupabase);
}

async function saveAboutBlock(block) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapAboutBlockToSupabase(block);
  payload.image_url = await bkmpStoreImageIfNeeded(payload.image_url, 'about');
  if (Array.isArray(payload.image_urls)) {
    payload.image_urls = (await Promise.all(
      payload.image_urls.map(src => bkmpStoreImageIfNeeded(src, 'about'))
    )).filter(Boolean);
  }
  if (!payload.image_url && payload.image_urls && payload.image_urls.length) {
    payload.image_url = payload.image_urls[0];
  }
  let query;
  if (block.id && !String(block.id).startsWith('about-')) {
    query = client
      .from('about_blocks')
      .update(payload)
      .eq('id', block.id)
      .select('id, block_type, title, content, image_url, image_urls, sort_order, created_at')
      .limit(1);
  } else {
    query = client
      .from('about_blocks')
      .insert(payload)
      .select('id, block_type, title, content, image_url, image_urls, sort_order, created_at')
      .limit(1);
  }
  const { data, error } = await query;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapAboutBlockFromSupabase(row) : null;
}

async function deleteAboutBlock(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('about_blocks').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncAboutBlocksFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadAboutBlocks !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const blocks = await loadAboutBlocks();
    if (!blocks) return false;
    const localBlocks = Array.isArray(targetData.aboutBlocks) ? targetData.aboutBlocks : [];
    blocks.forEach(block => {
      const local = localBlocks.find(item =>
        String(item.id || '') === String(block.id || '') ||
        (item.title && item.title === block.title && item.content === block.content)
      );
      if (!local) return;
      bkmpUseLocalImageIfPersistent(block, local);
      if ((!Array.isArray(block.images) || block.images.length === 0) && Array.isArray(local.images)) {
        block.images = local.images.filter(bkmpIsPersistentImageUrl);
      }
    });
    const localCount = Array.isArray(targetData.aboutBlocks) ? targetData.aboutBlocks.length : 0;
    if (localCount > 0 && blocks.length === 0) {
      console.warn('Supabase enthaelt keine About-Bloecke. Lokale About-Bloecke bleiben erhalten.');
      return false;
    }
    targetData.aboutBlocks = blocks;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte About-Bloecke nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

function bkmpMapPartnerShopFromSupabase(row) {
  return {
    id: row.id,
    name: row.shop_name || '',
    image: row.image_url || '',
    location: row.location || '',
    category: row.category || '',
    description: row.description || '',
    link: row.link || '',
    contact: row.contact || '',
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapPartnerShopToSupabase(shop) {
  return {
    shop_name: shop.name || shop.shop_name || '',
    image_url: shop.image || shop.image_url || '',
    location: shop.location || '',
    category: shop.category || '',
    description: shop.description || '',
    link: shop.link || '',
    contact: shop.contact || ''
  };
}

async function loadPartnerShops() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('partner_shops')
    .select('id, shop_name, image_url, location, category, description, link, contact, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapPartnerShopFromSupabase);
}

async function savePartnerShop(shop) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapPartnerShopToSupabase(shop);
  payload.image_url = await bkmpStoreImageIfNeeded(payload.image_url, 'partner-shops');
  let query;
  if (shop.id && !String(shop.id).startsWith('shop-')) {
    query = client
      .from('partner_shops')
      .update(payload)
      .eq('id', shop.id)
      .select('id, shop_name, image_url, location, category, description, link, contact, created_at')
      .limit(1);
  } else {
    query = client
      .from('partner_shops')
      .insert(payload)
      .select('id, shop_name, image_url, location, category, description, link, contact, created_at')
      .limit(1);
  }
  const { data, error } = await query;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapPartnerShopFromSupabase(row) : null;
}

async function deletePartnerShop(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  if (!id || String(id).trim() === '') throw new Error('PartnerShop-ID fehlt. Loeschen wurde abgebrochen.');
  const { error } = await client.from('partner_shops').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncPartnerShopsFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadPartnerShops !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const shops = await loadPartnerShops();
    if (!shops) return false;
    const localShops = Array.isArray(targetData.partnerShops) ? targetData.partnerShops : [];
    shops.forEach(shop => {
      if (shop.image) return;
      const local = localShops.find(item =>
        String(item.id || '') === String(shop.id || '') ||
        (item.name && item.name === shop.name && item.location === shop.location)
      );
      bkmpUseLocalImageIfPersistent(shop, local);
    });
    const localCount = Array.isArray(targetData.partnerShops) ? targetData.partnerShops.length : 0;
    if (localCount > 0 && shops.length === 0) {
      console.warn('Supabase enthaelt keine PartnerShops. Lokale PartnerShops bleiben erhalten.');
      return false;
    }
    targetData.partnerShops = shops;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte PartnerShops nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

async function importLocalExpensesToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.expenses) ? localData.expenses : [];
  const remoteItems = await loadExpenses() || [];
  const existing = new Set(remoteItems.map(item => [item.name, item.amount, item.date, item.note || ''].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const mapped = { ...item, category: item.category || item.name };
    const sig = [mapped.category || mapped.name, Number(mapped.amount || 0), mapped.date || '', mapped.note || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!mapped.category && !mapped.name) { skipped += 1; return; }
    if (!mapped.date) mapped.date = new Date().toISOString().slice(0, 10);
    existing.add(sig);
    rows.push(bkmpMapExpenseToSupabase(mapped));
  });
  if (rows.length) {
    const { error } = await client.from('expenses').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadExpenses() || [];
  localData.expenses = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importLocalUpdatesToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.news) ? localData.news : [];
  const remoteItems = await loadUpdates() || [];
  const existing = new Set(remoteItems.map(item => [item.title, item.text, item.date].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.title, item.text || item.content || '', item.date || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.title || !(item.text || item.content)) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapUpdateToSupabase(item));
  });
  if (rows.length) {
    const { error } = await client.from('updates').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadUpdates() || [];
  localData.news = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importLocalWishesToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.wishes) ? localData.wishes : [];
  const remoteItems = await loadWishes() || [];
  const existing = new Set(remoteItems.map(item => [item.name, item.image].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.name, item.image || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.name || !item.image) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapWishToSupabase(item));
  });
  if (rows.length) {
    for (const row of rows) {
      row.image_url = await bkmpStoreImageIfNeeded(row.image_url, 'wishes');
    }
    const { error } = await client.from('wishes').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadWishes() || [];
  localData.wishes = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importLocalStreamersToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.streamers) ? localData.streamers : [];
  const remoteItems = await loadStreamers() || [];
  const existing = new Set(remoteItems.map(item => [item.name, item.url].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.name || '', item.url || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.name || !item.url) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapStreamerToSupabase(item));
  });
  if (rows.length) {
    const { error } = await client.from('streamer_links').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadStreamers() || [];
  localData.streamers = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importLocalAboutBlocksToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.aboutBlocks) ? localData.aboutBlocks : [];
  const remoteItems = await loadAboutBlocks() || [];
  const existing = new Set(remoteItems.map(item => [item.type, item.title, item.content].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.type || '', item.title || '', item.content || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.title && !item.content && !item.image && !(item.images && item.images.length)) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapAboutBlockToSupabase(item));
  });
  if (rows.length) {
    for (const row of rows) {
      row.image_url = await bkmpStoreImageIfNeeded(row.image_url, 'about');
      if (Array.isArray(row.image_urls)) {
        row.image_urls = await Promise.all(row.image_urls.map(src => bkmpStoreImageIfNeeded(src, 'about')));
      }
    }
    const { error } = await client.from('about_blocks').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadAboutBlocks() || [];
  localData.aboutBlocks = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importLocalPartnerShopsToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.partnerShops) ? localData.partnerShops : [];
  const remoteItems = await loadPartnerShops() || [];
  const existing = new Set(remoteItems.map(item => [item.name, item.location, item.category].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.name || '', item.location || '', item.category || ''].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.name) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapPartnerShopToSupabase(item));
  });
  if (rows.length) {
    for (const row of rows) {
      row.image_url = await bkmpStoreImageIfNeeded(row.image_url, 'partner-shops');
    }
    const { error } = await client.from('partner_shops').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadPartnerShops() || [];
  localData.partnerShops = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

function bkmpMapCardSaleFromSupabase(row) {
  return {
    id: row.id,
    playerName: row.player_name || '',
    image: row.image_url || '',
    soldCount: Number(row.sold_count || 0),
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    source: 'supabase'
  };
}

function bkmpMapCardSaleToSupabase(item) {
  return {
    player_name: item.playerName || item.player_name || '',
    image_url: item.image || item.image_url || '',
    sold_count: Number(item.soldCount || item.sold_count || 0)
  };
}

async function loadCardSales() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('card_sales')
    .select('id, player_name, image_url, sold_count, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapCardSaleFromSupabase);
}

async function saveCardSale(item) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapCardSaleToSupabase(item);
  payload.image_url = await bkmpStoreImageIfNeeded(payload.image_url, 'card-sales');
  let query;
  if (item.id && !String(item.id).startsWith('cardsale-')) {
    query = client
      .from('card_sales')
      .update(payload)
      .eq('id', item.id)
      .select('id, player_name, image_url, sold_count, created_at')
      .limit(1);
  } else {
    query = client
      .from('card_sales')
      .insert(payload)
      .select('id, player_name, image_url, sold_count, created_at')
      .limit(1);
  }
  const { data, error } = await query;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapCardSaleFromSupabase(row) : null;
}

async function deleteCardSale(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('card_sales').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncCardSalesFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadCardSales !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const items = await loadCardSales();
    if (!items) return false;
    const localCount = Array.isArray(targetData.cardSales) ? targetData.cardSales.length : 0;
    if (localCount > 0 && items.length === 0) {
      console.warn('Supabase enthaelt keine Karten-Verkaeufe. Lokale Daten bleiben erhalten.');
      return false;
    }
    targetData.cardSales = items;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Karten-Verkaeufe nicht laden. localStorage-Fallback wird verwendet.', e);
    return false;
  }
}

async function importLocalCardSalesToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.cardSales) ? localData.cardSales : [];
  const remoteItems = await loadCardSales() || [];
  const existing = new Set(remoteItems.map(item => [item.playerName, item.soldCount].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.playerName || '', item.soldCount || 0].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.playerName) { skipped += 1; return; }
    existing.add(sig);
    rows.push(bkmpMapCardSaleToSupabase(item));
  });
  if (rows.length) {
    for (const row of rows) {
      row.image_url = await bkmpStoreImageIfNeeded(row.image_url, 'card-sales');
    }
    const { error } = await client.from('card_sales').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadCardSales() || [];
  localData.cardSales = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

function bkmpMapInvestorRequestFromSupabase(row) {
  return {
    id: row.id,
    name: row.name || '',
    minecraftName: row.minecraft_name || '',
    anonymous: Boolean(row.anonymous),
    amount: Number(row.amount || 0),
    sharePercent: Number(row.share_percent || 0),
    periodMonths: Number(row.period_months || 0),
    status: row.status || 'pending',
    createdAt: row.created_at ? Date.parse(row.created_at) : 0,
    createdAtIso: row.created_at || '',
    source: 'supabase'
  };
}

function bkmpMapInvestorRequestToSupabase(item) {
  return {
    name: item.name || '',
    minecraft_name: item.minecraftName || '',
    anonymous: Boolean(item.anonymous),
    amount: Number(item.amount || 0),
    share_percent: Number(item.sharePercent || 0),
    period_months: Number(item.periodMonths || 0)
  };
}

async function saveInvestorRequest(item) {
  const client = bkmpGetSupabaseClient();
  if (!client) throw new Error('Supabase ist nicht verbunden.');
  const payload = { ...bkmpMapInvestorRequestToSupabase(item), status: 'pending' };
  const { error } = await client.from('investor_requests').insert(payload);
  if (error) throw error;
  return true;
}

async function loadInvestorRequests() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('investor_requests')
    .select('id, name, minecraft_name, anonymous, amount, share_percent, period_months, status, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapInvestorRequestFromSupabase);
}

async function updateInvestorRequestStatus(id, status) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('investor_requests')
    .update({ status })
    .eq('id', id)
    .select('id, name, minecraft_name, anonymous, amount, share_percent, period_months, status, created_at')
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? bkmpMapInvestorRequestFromSupabase(row) : null;
}

async function deleteInvestorRequest(id) {
  const client = bkmpGetSupabaseClient();
  if (!client) return false;
  const { error } = await client.from('investor_requests').delete().eq('id', id);
  if (error) throw error;
  return true;
}

async function syncInvestorRequestsFromSupabase(targetData, onSynced, options = {}) {
  if (typeof loadInvestorRequests !== 'function' || !bkmpGetSupabaseClient()) return false;
  try {
    const items = await loadInvestorRequests();
    if (!items) return false;
    const localCount = Array.isArray(targetData.investorRequests) ? targetData.investorRequests.length : 0;
    if (localCount > 0 && items.length === 0) {
      console.warn('Supabase enthaelt keine Investoren-Anfragen. Lokale Daten bleiben erhalten.');
      return false;
    }
    targetData.investorRequests = items;
    bkmpSaveData(targetData);
    if (typeof onSynced === 'function') onSynced(targetData);
    return true;
  } catch (e) {
    console.warn('Supabase konnte Investoren-Anfragen nicht laden.', e);
    return false;
  }
}

async function importLocalInvestorRequestsToSupabase() {
  const client = bkmpGetSupabaseClient();
  if (!client) return { imported: 0, skipped: 0, total: 0 };
  const localData = bkmpLoadData();
  const localItems = Array.isArray(localData.investorRequests) ? localData.investorRequests : [];
  const remoteItems = await loadInvestorRequests() || [];
  const existing = new Set(remoteItems.map(item => [item.name, item.amount, item.periodMonths].join('|')));
  const rows = [];
  let skipped = 0;
  localItems.forEach(item => {
    const sig = [item.name || '', item.amount || 0, item.periodMonths || 0].join('|');
    if (existing.has(sig)) { skipped += 1; return; }
    if (!item.name) { skipped += 1; return; }
    existing.add(sig);
    rows.push({ ...bkmpMapInvestorRequestToSupabase(item), status: item.status || 'pending' });
  });
  if (rows.length) {
    const { error } = await client.from('investor_requests').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadInvestorRequests() || [];
  localData.investorRequests = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importAllLocalDataToSupabase() {
  return {
    incomes: await importLocalIncomesToSupabase(),
    expenses: await importLocalExpensesToSupabase(),
    investors: await importLocalInvestorsToSupabase(),
    updates: await importLocalUpdatesToSupabase(),
    wishes: await importLocalWishesToSupabase(),
    streamers: await importLocalStreamersToSupabase(),
    aboutBlocks: await importLocalAboutBlocksToSupabase(),
    partnerShops: await importLocalPartnerShopsToSupabase(),
    cardSales: await importLocalCardSalesToSupabase(),
    investorRequests: await importLocalInvestorRequestsToSupabase()
  };
}

window.importLocalExpensesToSupabase = importLocalExpensesToSupabase;
window.importLocalUpdatesToSupabase = importLocalUpdatesToSupabase;
window.importLocalWishesToSupabase = importLocalWishesToSupabase;
window.importLocalStreamersToSupabase = importLocalStreamersToSupabase;
window.importLocalAboutBlocksToSupabase = importLocalAboutBlocksToSupabase;
window.importLocalPartnerShopsToSupabase = importLocalPartnerShopsToSupabase;
window.importLocalCardSalesToSupabase = importLocalCardSalesToSupabase;
window.importLocalInvestorRequestsToSupabase = importLocalInvestorRequestsToSupabase;
window.importAllLocalDataToSupabase = importAllLocalDataToSupabase;

window.importLocalIncomesToSupabase = importLocalIncomesToSupabase;
