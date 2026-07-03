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
    name: row.category,
    category: row.category,
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

window.importLocalIncomesToSupabase = importLocalIncomesToSupabase;
