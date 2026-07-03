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
    if (!options.force && localIncomeCount > 0 && incomes.length < localIncomeCount) {
      console.warn('Supabase enthaelt weniger Einnahmen als localStorage. Lokale Daten bleiben erhalten, bis der Import abgeschlossen ist.');
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
    note: investor.minecraftName || investor.note || null
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
    if (!options.force && localInvestorCount > 0 && investors.length < localInvestorCount) {
      console.warn('Supabase enthaelt weniger Investoren als localStorage. Lokale Daten bleiben erhalten, bis der Import abgeschlossen ist.');
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
    if (!options.force && localCount > 0 && expenses.length < localCount) {
      console.warn('Supabase enthaelt weniger Ausgaben als localStorage. Lokale Daten bleiben erhalten, bis der Import abgeschlossen ist.');
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

async function loadUpdates() {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('updates')
    .select('id, title, content, image_urls, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapUpdateFromSupabase);
}

async function saveUpdate(update) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const payload = bkmpMapUpdateToSupabase(update);
  if (update.id && !String(update.id).startsWith('news-')) {
    const { data, error } = await client
      .from('updates')
      .update(payload)
      .eq('id', update.id)
      .select('id, title, content, image_urls, created_at')
      .maybeSingle();

    if (error) throw error;
    if (data) return bkmpMapUpdateFromSupabase(data);

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
        .single();
      if (matchedError) throw matchedError;
      return bkmpMapUpdateFromSupabase(matchedData);
    }
  }

  const { data, error } = await client
    .from('updates')
    .insert(payload)
    .select('id, title, content, image_urls, created_at')
    .single();

  if (error) throw error;
  return bkmpMapUpdateFromSupabase(data);
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
    if (!options.force && localCount > 0 && updates.length < localCount) {
      console.warn('Supabase enthaelt weniger Updates als localStorage. Lokale Daten bleiben erhalten, bis der Import abgeschlossen ist.');
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

function bkmpMapWishFromSupabase(row) {
  return {
    id: row.id,
    name: row.name,
    image: row.image_url || '',
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
  const { data, error } = await client
    .from('wishes')
    .select('id, name, image_url, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(bkmpMapWishFromSupabase);
}

async function saveWish(wish) {
  const client = bkmpGetSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('wishes')
    .insert(bkmpMapWishToSupabase(wish))
    .select('id, name, image_url, created_at')
    .single();
  if (error) throw error;
  return bkmpMapWishFromSupabase(data);
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
    const localCount = Array.isArray(targetData.wishes) ? targetData.wishes.length : 0;
    if (!options.force && localCount > 0 && wishes.length < localCount) {
      console.warn('Supabase enthaelt weniger Kartenideen als localStorage. Lokale Daten bleiben erhalten, bis der Import abgeschlossen ist.');
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
    const { error } = await client.from('wishes').insert(rows);
    if (error) throw error;
  }
  const refreshed = await loadWishes() || [];
  localData.wishes = refreshed;
  bkmpSaveData(localData);
  return { imported: rows.length, skipped, total: refreshed.length };
}

async function importAllLocalDataToSupabase() {
  return {
    incomes: await importLocalIncomesToSupabase(),
    expenses: await importLocalExpensesToSupabase(),
    investors: await importLocalInvestorsToSupabase(),
    updates: await importLocalUpdatesToSupabase(),
    wishes: await importLocalWishesToSupabase()
  };
}

window.importLocalExpensesToSupabase = importLocalExpensesToSupabase;
window.importLocalUpdatesToSupabase = importLocalUpdatesToSupabase;
window.importLocalWishesToSupabase = importLocalWishesToSupabase;
window.importAllLocalDataToSupabase = importAllLocalDataToSupabase;

window.importLocalIncomesToSupabase = importLocalIncomesToSupabase;
