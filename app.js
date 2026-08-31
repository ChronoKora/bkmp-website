/* ============================================================
   Bkmp – gemeinsame Daten-Logik
   Speichert alles im localStorage unter dem Key 'bkmp-data'.
   WICHTIG: Das ist eine reine Frontend-Lösung ohne Backend.
   Für den echten Betrieb (mehrere Nutzer, echte Sicherheit)
   sollte das später an eine Datenbank + Server-Login angebunden
   werden. Bis dahin ist es ein voll funktionsfähiger Prototyp,
   bei dem die Daten lokal im Browser gespeichert werden.
   ============================================================ */

const BKMP_DATA_KEY = 'bkmp-data';
const BKMP_THEME_KEY = 'bkmp-theme';

const BKMP_INCOME_CATEGORIES = [
  'Karten', 'Bücher', 'Tränke', 'Elytra', 'Raketen', 'Werkzeug', 'Schmiede Vorlagen', 'Netherite', 'Selbst Verdient', 'Custom'
];

const BKMP_CARD_SALE_PRICE = 150000;
const BKMP_CARD_SALE_SELLER_SHARE = 135000;
const BKMP_CARD_SALE_COMMISSION = 15000;

const BKMP_INVESTOR_REQUEST_MIN = 50000000;
const BKMP_INVESTOR_REQUEST_MAX = 150000000;
const BKMP_INVESTOR_REQUEST_MIN_SHARE = 5;
const BKMP_INVESTOR_REQUEST_MAX_SHARE = 15;

const BKMP_SUBMIT_COOLDOWN_MS = 15000;

/* Pluschie-Definitionen: gemeinsam fuer index.html (Anzeige/Auswahl) und
   admin.html (Code-Generator-Dropdown). Startwert hier ist nur ein
   Fallback, falls die Datenbank (Tabelle "plushies") noch nicht erreichbar
   ist - sobald sie laedt, wird BKMP_PLUSHIES ueberschrieben (siehe
   bkmpRefreshPlushieDefinitions in index.html). Neue Bilder im Ordner
   assets/plushies/ landen ueber den "Ordner scannen"-Button im Admin-Panel
   automatisch in der Datenbank, ohne dass hier Code geaendert werden muss. */
let BKMP_PLUSHIES = [
  { id: 'yaksha', name: 'Yaksha Plüshie', image: 'assets/plushies/yaksha.png', desc: 'Kleiner Kristalldrache mit rotem Blick.', rarity: 'Legendär' },
  { id: 'darkorius', name: 'Darkorius Plüshie', image: 'assets/plushies/darkorius.png', desc: 'Dunkel, mysteriös, unglaublich knuffig.', rarity: 'Episch' },
  { id: 'lukas', name: 'Lukas Plüshie', image: 'assets/plushies/lukas.png', desc: 'Für echte Fans von XxLukaas_.', rarity: 'Episch' },
  { id: 'obsi', name: 'Obsi Plüshie', image: 'assets/plushies/obsi.png', desc: 'Hart wie Obsidian, süß wie ein Plüschtier.', rarity: 'Episch' },
  { id: 'roggberd', name: 'Roggberd Plüshie', image: 'assets/plushies/roggberd.png', desc: 'Ein Roggberd zum Knuddeln.', rarity: 'Episch' }
];
/* Sobald die echte Liste aus der Datenbank geladen wurde (siehe
   bkmpRefreshPlushieDefinitions in index.html), wird sie hier zusaetzlich
   gecacht. Bei jedem weiteren Seitenaufruf startet BKMP_PLUSHIES dann sofort
   mit dem zuletzt bekannten echten Stand statt mit der kleinen Fallback-
   Liste oben - sonst zeigte die Erfolge-Anzahl (die pro Pluschie einen
   eigenen Erfolg zaehlt) kurz nach jedem Laden einen falschen, zu kleinen
   Gesamtwert, bis die Datenbank-Antwort da war. */
try {
  var __bkmpCachedPlushies = JSON.parse(localStorage.getItem('bkmp-plushies-cache') || 'null');
  if (Array.isArray(__bkmpCachedPlushies) && __bkmpCachedPlushies.length > 0) BKMP_PLUSHIES = __bkmpCachedPlushies;
} catch (e) {}

function bkmpSubmitCooldownSecondsLeft(key) {
  let last = 0;
  try { last = Number(localStorage.getItem('bkmp-cooldown-' + key) || 0); } catch (e) {}
  const remaining = BKMP_SUBMIT_COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function bkmpStartSubmitCooldown(key) {
  try { localStorage.setItem('bkmp-cooldown-' + key, String(Date.now())); } catch (e) {}
}

function bkmpCalcInvestorSharePercent(amount) {
  const clamped = Math.min(BKMP_INVESTOR_REQUEST_MAX, Math.max(BKMP_INVESTOR_REQUEST_MIN, Number(amount) || 0));
  const ratio = (clamped - BKMP_INVESTOR_REQUEST_MIN) / (BKMP_INVESTOR_REQUEST_MAX - BKMP_INVESTOR_REQUEST_MIN);
  const share = BKMP_INVESTOR_REQUEST_MIN_SHARE + ratio * (BKMP_INVESTOR_REQUEST_MAX_SHARE - BKMP_INVESTOR_REQUEST_MIN_SHARE);
  return Math.round(share * 100) / 100;
}

function bkmpAddMonths(isoDate, months) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setMonth(d.getMonth() + Number(months || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function bkmpNormalizeCategoryName(name) {
  if (name === 'B?cher' || name === 'B\uFFFDcher') return 'B\u00fccher';
  if (name === 'Tr?nke' || name === 'Tr\uFFFDnke') return 'Tr\u00e4nke';
  return name;
}

function bkmpNormalizeEntryList(list) {
  return (list || []).map(item => {
    const normalized = { ...item };
    if (normalized.name) normalized.name = bkmpNormalizeCategoryName(normalized.name);
    if (normalized.category) normalized.category = bkmpNormalizeCategoryName(normalized.category);
    return normalized;
  });
}

function bkmpMergeUniqueImages() {
  const values = Array.from(arguments).flat().filter(Boolean);
  return [...new Set(values)];
}

function bkmpDedupeUpdates(list) {
  const map = new Map();
  (list || []).forEach(item => {
    const key = [item.title || '', item.text || item.content || ''].join('|').toLowerCase();
    const current = map.get(key);
    const itemImages = bkmpMergeUniqueImages(item.images || [], item.image || '');
    if (!current) {
      map.set(key, { ...item, image: itemImages[0] || '', images: itemImages });
      return;
    }
    const currentTime = current.createdAt || Date.parse(current.date || '') || 0;
    const itemTime = item.createdAt || Date.parse(item.date || '') || 0;
    const keep = itemTime > currentTime ? item : current;
    const mergedImages = bkmpMergeUniqueImages(current.images || [], current.image || '', itemImages);
    map.set(key, { ...keep, image: mergedImages[0] || '', images: mergedImages });
  });
  return Array.from(map.values());
}

const BKMP_DEFAULT_DATA = {
  income: [
    { id: 'inc-1', name: 'Karten', amount: 4200, date: '2026-06-10' },
    { id: 'inc-2', name: 'Tränke', amount: 1800, date: '2026-06-18' },
    { id: 'inc-3', name: 'Elytra', amount: 400, date: '2026-06-25' }
  ],
  expenses: [
    { id: 'exp-1', name: 'Wareneinkauf', amount: 1600, date: '2026-06-05' },
    { id: 'exp-2', name: 'Marketing', amount: 500, date: '2026-06-14' },
    { id: 'exp-3', name: 'Software & Tools', amount: 220, date: '2026-06-20' }
  ],
  investors: [
    { id: 'inv-1', name: 'Beispiel-Investor', minecraftName: 'Steve', invested: 10000, sharePercent: 15, startDate: '', endDate: '' }
  ],
  news: [
    {
      id: 'news-1',
      title: 'Willkommen im neuen Investoren-Bereich',
      text: 'Ab sofort findet ihr hier alle Zahlen und Updates rund um Bkmp transparent aufbereitet. Diese Beispiel-Meldung kannst du im Admin-Panel löschen.',
      image: '',
      date: new Date().toISOString().slice(0, 10)
    }
  ],
  wishes: [],
  streamers: [],
  aboutBlocks: [],
  partnerShops: [],
  cardSales: [],
  investorRequests: [],
  cardCatalog: [],
  cardSaleRequests: []
};

/* Vor der Server-API (api/submit-entry.js) speicherte das Formular bei
   fehlender Supabase-Verbindung Einreichungen nur lokal im Browser ab
   (id-Prefix "cardcat-"/"wish-"). Diese Eintraege haben es nie in die
   Datenbank geschafft und tauchten trotzdem in der eigenen Karten-/
   Wunschliste auf ("Geister-Eintraege"), weil ein Sync-Fehlschlag die
   alten lokalen Daten nicht ueberschrieben hat. Da neue Einreichungen
   jetzt nie mehr lokal-only gespeichert werden, ist jeder Eintrag mit
   diesem Prefix garantiert so ein Ueberbleibsel und wird beim Laden
   entfernt. */
function bkmpPurgeOrphanedLocalEntries(list, prefix) {
  if (!Array.isArray(list)) return [];
  return list.filter(item => !(item && typeof item.id === 'string' && item.id.startsWith(prefix)));
}

function bkmpLoadData() {
  try {
    const raw = localStorage.getItem(BKMP_DATA_KEY);
    if (!raw) return structuredClone(BKMP_DEFAULT_DATA);
    const parsed = JSON.parse(raw);
    return {
      income: bkmpNormalizeEntryList(parsed.income),
      expenses: bkmpNormalizeEntryList(parsed.expenses),
      investors: parsed.investors || [],
      news: bkmpDedupeUpdates(parsed.news || []),
      wishes: bkmpPurgeOrphanedLocalEntries(parsed.wishes, 'wish-'),
      streamers: parsed.streamers || [],
      aboutBlocks: parsed.aboutBlocks || [],
      partnerShops: parsed.partnerShops || [],
      cardSales: parsed.cardSales || [],
      investorRequests: parsed.investorRequests || [],
      cardCatalog: bkmpPurgeOrphanedLocalEntries(parsed.cardCatalog, 'cardcat-'),
      cardSaleRequests: parsed.cardSaleRequests || []
    };
  } catch (e) {
    console.error('Fehler beim Laden der Daten:', e);
    return { ...structuredClone(BKMP_DEFAULT_DATA), income: bkmpNormalizeEntryList(BKMP_DEFAULT_DATA.income), expenses: bkmpNormalizeEntryList(BKMP_DEFAULT_DATA.expenses) };
  }
}

function bkmpSaveData(data) {
  try {
    localStorage.setItem(BKMP_DATA_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || String(e.message || '').includes('quota'))) {
      try {
        const lightData = bkmpCreateStorageSafeData(data);
        localStorage.setItem(BKMP_DATA_KEY, JSON.stringify(lightData));
        console.warn('Lokaler Speicher war voll. Grosse Bilddaten wurden nur online behalten.');
        return true;
      } catch (fallbackError) {
        console.error('Fehler beim Speichern der reduzierten Daten:', fallbackError);
        return false;
      }
    }
    console.error('Fehler beim Speichern der Daten:', e);
    return false;
  }
}

function bkmpStripHeavyDataUrl(value) {
  if (typeof value === 'string' && value.startsWith('data:image/')) return '';
  return value;
}

function bkmpCreateStorageSafeData(data) {
  const clone = structuredClone(data);
  clone.news = (clone.news || []).map(item => ({
    ...item,
    image: bkmpStripHeavyDataUrl(item.image),
    images: (item.images || []).map(bkmpStripHeavyDataUrl).filter(Boolean)
  }));
  clone.wishes = (clone.wishes || []).map(item => ({
    ...item,
    image: bkmpStripHeavyDataUrl(item.image)
  }));
  clone.aboutBlocks = (clone.aboutBlocks || []).map(item => ({
    ...item,
    image: bkmpStripHeavyDataUrl(item.image),
    images: (item.images || []).map(bkmpStripHeavyDataUrl).filter(Boolean)
  }));
  clone.partnerShops = (clone.partnerShops || []).map(item => ({
    ...item,
    image: bkmpStripHeavyDataUrl(item.image)
  }));
  clone.cardSales = (clone.cardSales || []).map(item => ({
    ...item,
    image: bkmpStripHeavyDataUrl(item.image)
  }));
  return clone;
}

function bkmpUid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

function bkmpImageExtension(src) {
  const dataMatch = /^data:image\/(\w+)/.exec(src || '');
  if (dataMatch) return dataMatch[1] === 'jpeg' ? 'jpg' : dataMatch[1];
  const urlMatch = /\.(\w+)(?:\?.*)?$/.exec(src || '');
  return urlMatch ? urlMatch[1] : 'png';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function supabaseErrorText(e) {
  return e && (e.message || e.details || e.code)
    ? [e.message, e.details, e.code].filter(Boolean).join(' | ')
    : 'Unbekannter Fehler';
}

/* Oeffentliche Einreichungen (Kartendatenbank, Kartenideen, PartnerShops)
   laufen ueber diese Server-Funktion statt direkt ueber den anon-Key im
   Browser, weil Einreichungen mit dem anon-Key bei manchen Besuchern
   zufaellig an einer RLS-Policy-Pruefung scheiterten (vermutlich ein
   Supabase-seitiges Cache-Problem). Die Server-Funktion nutzt den
   Service-Role-Key und umgeht das Problem vollstaendig. */
// extraBody (optional): zusaetzliche Top-Level-Felder fuers Request-Body,
// aktuell nur fuer { playerAccessToken } bei card_sale_requests genutzt
// (01.09.2026) - bewusst additiv, aendert nichts am Verhalten fuer alle
// anderen bestehenden Aufrufer dieser Funktion.
async function bkmpSubmitViaApi(type, fields, imageDataUrl, extraBody) {
  let response;
  try {
    response = await fetch('/api/submit-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ type, fields, imageDataUrl: imageDataUrl || null }, extraBody || {}))
    });
  } catch (e) {
    throw new Error('Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung.');
  }
  let body = null;
  try { body = await response.json(); } catch (e) {}
  if (!response.ok) {
    const message = body && (body.detail || body.error) ? (body.detail || body.error) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body && body.row ? body.row : null;
}

/* ============================================================
   Bild-Komprimierung fuer Uploads
   Verkleinert grosse Bilder client-seitig auf eine sinnvolle
   Breite und wandelt sie in WebP um, bevor sie hochgeladen
   werden. Das ist der Grund, warum Bilder sonst sehr lange
   laden koennen: ohne das hier wird die Originaldatei 1:1
   hochgeladen und bei jedem Seitenaufruf erneut geladen.
   ============================================================ */
function bkmpCompressImageFile(file, options = {}) {
  const maxWidth = options.maxWidth || 1000;
  const quality = options.quality || 0.74;

  function readAsDataUrl() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Datei konnte nicht gelesen werden.'));
      reader.readAsDataURL(file);
    });
  }

  if (!file || !file.type || !file.type.startsWith('image/')) {
    return readAsDataUrl();
  }

  return readAsDataUrl().then(original => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      if (scale >= 1) {
        resolve(original);
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/webp', quality);
        resolve(compressed && compressed.startsWith('data:image/') ? compressed : original);
      } catch (e) {
        resolve(original);
      }
    };
    img.onerror = () => resolve(original);
    img.src = original;
  }));
}

function bkmpFormatCurrency(value) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

function bkmpSum(list) {
  return list.reduce((acc, item) => acc + Number(item.amount || 0), 0);
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ============================================================
   Umsatzseite: reine Statistik-Helfer (29.08.2026)
   Erweiterung der bestehenden Hauptseite/Investoren-Finanzansicht um mehr
   Kennzahlen - siehe renderFinancialSections() in js/core/bkmp-site.js für
   die eigentliche Anzeige. Bewusst hier in app.js (gemeinsame Daten-Logik,
   wird schon von index.html geladen) statt direkt im Render-Code verteilt -
   reine, von der Darstellung getrennte Berechnungsfunktionen, alle arbeiten
   ausschließlich mit bereits geladenen data.income/data.expenses (kein
   zusätzlicher Supabase-Aufruf pro Kennzahl).
   ============================================================ */

/* Identischer Wert wie admin.html's "incomeUnitPrices" (dort: reiner
   Eintrags-Rechenhelfer "Anzahl x Stückpreis -> Betrag", wird NIE mit
   gespeichert - die incomes-Tabelle kennt nur amount, keine Stückzahl).
   Bewusst NICHT dieselbe Objekt-Referenz/Datei geteilt, um admin.html's
   bereits funktionierenden Eintrags-Rechner nicht anzufassen - beide
   Konstanten müssen bei einer künftigen Preisänderung manuell synchron
   gehalten werden (siehe Kommentar dort). Nur zum RÜCKRECHNEN einer
   ungefähren Bücher-Stückzahl aus historischen amount-Werten verwendet -
   NIE um neue Daten zu erzeugen. */
const BKMP_INCOME_UNIT_PRICES = {
  'Bücher': 2500,
  'Raketen': 1000,
  'Karten': 150000,
  'Schmiede Vorlagen': 1500,
  'Netherite': 11000,
  'Tränke': 1500,
  'Werkzeug': 75000
};

function bkmpToIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function bkmpAddDaysIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return bkmpToIsoDate(d);
}

/* [startIso, endIso] - beide Grenzen eingeschlossen (Datumsvergleich als
   String funktioniert bei 'YYYY-MM-DD' korrekt lexikografisch). */
function bkmpEntriesInRange(list, startIso, endIso) {
  return (list || []).filter(item => item.date && item.date >= startIso && item.date <= endIso);
}

function bkmpSumInRange(list, startIso, endIso) {
  return bkmpSum(bkmpEntriesInRange(list, startIso, endIso));
}

/* Veränderung aktueller vs. vorheriger Wert. Division durch 0 sauber
   abgefangen (Auftrag Abschnitt 15) - "Neu" wenn vorher 0 war und jetzt
   etwas da ist, "Kein Vergleich" wenn beide 0 sind. */
function bkmpCalculatePeriodChange(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  const diffAbs = cur - prev;
  if (prev === 0) {
    if (cur === 0) return { pct: null, diffAbs: 0, direction: 'flat', label: 'Kein Vergleich' };
    return { pct: null, diffAbs: cur, direction: 'up', label: 'Neu' };
  }
  const pct = (diffAbs / Math.abs(prev)) * 100;
  const direction = pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat';
  return { pct, diffAbs, direction, label: bkmpFormatPercent(pct) };
}

function bkmpFormatPercent(pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '–';
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '±';
  return `${sign}${Math.abs(pct).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function bkmpCalculateAverageDailyRevenue(list, days) {
  if (!days) return 0;
  return bkmpSum(list) / days;
}

/* Gruppiert nach Kalendertag, liefert den Tag mit der höchsten Summe (oder
   null, falls die Liste leer ist). */
function bkmpCalculateBestDay(list) {
  const byDay = {};
  (list || []).forEach(item => {
    if (!item.date) return;
    byDay[item.date] = (byDay[item.date] || 0) + (Number(item.amount) || 0);
  });
  let best = null;
  Object.keys(byDay).forEach(date => {
    if (!best || byDay[date] > best.amount) best = { date, amount: byDay[date] };
  });
  return best;
}

function bkmpCalculateAverageTransaction(list) {
  const items = list || [];
  if (items.length === 0) return null;
  return bkmpSum(items) / items.length;
}

function bkmpCalculateProfitMargin(netProfit, totalIncome) {
  if (!totalIncome) return null;
  return (netProfit / totalIncome) * 100;
}

function bkmpCalculateExpenseRatio(totalExpenses, totalIncome) {
  if (!totalIncome) return null;
  return (totalExpenses / totalIncome) * 100;
}

/* Bücher-Kennzahlen (Auftrag Abschnitt 6-8) - Stückzahl wird ausschließlich
   RÜCKGERECHNET aus amount/BKMP_INCOME_UNIT_PRICES['Bücher'], da die
   incomes-Tabelle selbst keine Stückzahl kennt. Explizit als Schätzung
   markiert (kein garantiert historisch konstanter Preis). */
function bkmpCalculateBookStats(incomeList, todayIso) {
  const unitPrice = BKMP_INCOME_UNIT_PRICES['Bücher'];
  const bookEntries = (incomeList || []).filter(item => item.name === 'Bücher' || item.category === 'Bücher');
  const qty = amount => unitPrice ? amount / unitPrice : 0;

  const weekStart = bkmpAddDaysIso(todayIso, -6);
  const prevWeekEnd = bkmpAddDaysIso(todayIso, -7);
  const prevWeekStart = bkmpAddDaysIso(todayIso, -13);
  const monthStart = todayIso.slice(0, 7) + '-01';

  const todayRevenue = bkmpSumInRange(bookEntries, todayIso, todayIso);
  const weekRevenue = bkmpSumInRange(bookEntries, weekStart, todayIso);
  const prevWeekRevenue = bkmpSumInRange(bookEntries, prevWeekStart, prevWeekEnd);
  const monthRevenue = bkmpSumInRange(bookEntries, monthStart, todayIso);

  const weekEntries = bkmpEntriesInRange(bookEntries, weekStart, todayIso);
  const bestDayByAmount = bkmpCalculateBestDay(bookEntries);

  const totalBookRevenueAllTime = bkmpSum(bookEntries);

  return {
    hasAnyBooks: bookEntries.length > 0,
    unitPrice,
    todayQty: Math.round(qty(todayRevenue)),
    todayRevenue,
    weekQty: Math.round(qty(weekRevenue)),
    weekRevenue,
    prevWeekQty: Math.round(qty(prevWeekRevenue)),
    weekChange: bkmpCalculatePeriodChange(weekRevenue, prevWeekRevenue),
    avgPerDayQty: weekEntries.length ? qty(weekRevenue) / 7 : 0,
    bestDay: bestDayByAmount ? { date: bestDayByAmount.date, qty: Math.round(qty(bestDayByAmount.amount)) } : null,
    monthQty: Math.round(qty(monthRevenue)),
    monthRevenue,
    totalRevenueAllTime: totalBookRevenueAllTime
  };
}

/* Top-Kategorie + größter Aufsteiger (Auftrag Abschnitt 11) - "aktuell" =
   letzte 7 Tage (dieselbe Fensterlogik wie die drei Hauptkarten), verglichen
   mit den 7 Tagen davor. */
function bkmpCalculateTopCategory(incomeList, todayIso) {
  const weekStart = bkmpAddDaysIso(todayIso, -6);
  const prevWeekEnd = bkmpAddDaysIso(todayIso, -7);
  const prevWeekStart = bkmpAddDaysIso(todayIso, -13);

  const currentEntries = bkmpEntriesInRange(incomeList, weekStart, todayIso);
  const previousEntries = bkmpEntriesInRange(incomeList, prevWeekStart, prevWeekEnd);

  const sumByCategory = list => {
    const out = {};
    list.forEach(item => {
      const cat = item.name || item.category || 'Sonstiges';
      out[cat] = (out[cat] || 0) + (Number(item.amount) || 0);
    });
    return out;
  };

  const currentByCategory = sumByCategory(currentEntries);
  const previousByCategory = sumByCategory(previousEntries);
  const currentTotal = bkmpSum(currentEntries);

  const categories = Object.keys(currentByCategory);
  if (categories.length === 0) return { top: null, riser: null };

  let top = null;
  categories.forEach(cat => {
    const amount = currentByCategory[cat];
    if (!top || amount > top.amount) top = { category: cat, amount };
  });
  const topShare = currentTotal ? (top.amount / currentTotal) * 100 : null;
  const topChange = bkmpCalculatePeriodChange(top.amount, previousByCategory[top.category] || 0);

  let riser = null;
  categories.forEach(cat => {
    const change = bkmpCalculatePeriodChange(currentByCategory[cat], previousByCategory[cat] || 0);
    if (change.pct === null) return; // "Neu"-Kategorien nicht als "größter Aufsteiger" werten
    if (!riser || change.pct > riser.change.pct) riser = { category: cat, change };
  });

  return {
    top: { category: top.category, share: topShare, change: topChange },
    riser
  };
}

/* Monats-Prognose (Auftrag Abschnitt 13) - hochgerechnet aus dem bisherigen
   Tagesdurchschnitt des laufenden Monats. Ausdrücklich als Prognose markiert
   (siehe UI), keine reale Zahl. */
function bkmpCalculateMonthlyProjection(incomeList, todayDate) {
  const todayIso = bkmpToIsoDate(todayDate);
  const monthStart = todayIso.slice(0, 7) + '-01';
  const daysElapsed = todayDate.getDate(); // 1-basiert, inkl. heute
  const daysInMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).getDate();
  const monthSoFar = bkmpSumInRange(incomeList, monthStart, todayIso);
  if (daysElapsed <= 0) return { monthSoFar, projected: monthSoFar, daysElapsed, daysInMonth };
  const projected = (monthSoFar / daysElapsed) * daysInMonth;
  return { monthSoFar, projected, daysElapsed, daysInMonth };
}

/* ============================================================
   SW-Besucher-Statistik fuer /sw bk (29.08.2026) - reine Berechnungs-Helfer,
   getrennt von der Darstellung (renderFinancialSections() in js/core/
   bkmp-site.js). Arbeiten ausschliesslich mit dem bereits geladenen
   data.swStats (eine Zeile pro Tag, siehe supabase.js/loadSwDailyStats()) -
   kein zusaetzlicher Supabase-Aufruf pro Kennzahl. Betrifft AUSSCHLIESSLICH
   den eigenen Shop /sw bk - keine Konkurrenzdaten existieren in diesem
   Datenmodell ueberhaupt (Auftrag Abschnitt 28).
   ============================================================ */

const BKMP_SW_CB_KEYS = ['cb1', 'cb2', 'cb3', 'cb4', 'cb5', 'cb6'];
const BKMP_SW_CB_LABELS = { cb1: 'CB1', cb2: 'CB2', cb3: 'CB3', cb4: 'CB4', cb5: 'CB5', cb6: 'CB6' };
const BKMP_SW_RANK_LABELS = { '1': '#1', '2': '#2', '3': '#3', '4': '#4', '5': '#5', not_in_top5: 'Nicht in Top 5' };

function bkmpSwFindRow(list, dateIso) {
  return (list || []).find(row => row.stat_date === dateIso) || null;
}

/* Summe aller 6 CBs EINER Zeile. Bewusst KEIN Fallback auf 0, wenn "row"
   selbst null ist (Aufrufer muss die Zeilen-Existenz - "kein Datensatz" vs.
   "Datensatz mit 0" - selbst unterscheiden, siehe Auftrag Abschnitt 23). */
function bkmpSwRowTotal(row) {
  if (!row) return 0;
  return BKMP_SW_CB_KEYS.reduce((sum, key) => sum + (Number(row[key + '_visitors']) || 0), 0);
}

function bkmpSwRowsInRange(list, startIso, endIso) {
  return (list || []).filter(row => row.stat_date && row.stat_date >= startIso && row.stat_date <= endIso);
}

/* Summe ueber einen Zeitraum - nur tatsaechlich vorhandene Zeilen zaehlen,
   fehlende Tage werden NICHT als 0 mitgerechnet (sie tragen ohnehin nichts
   zur Summe bei, das ist hier unkritisch - relevant wird der Unterschied
   erst beim Durchschnitt, siehe bkmpSwAverage unten). */
function bkmpSwSumInRange(list, startIso, endIso) {
  return bkmpSwRowsInRange(list, startIso, endIso).reduce((sum, row) => sum + bkmpSwRowTotal(row), 0);
}

/* Auftrag Abschnitt 11: "Nicht automatisch fehlende Tage als echte 0
   Besucher interpretieren" - der Nenner ist die ANZAHL tatsaechlich
   vorhandener Zeilen im Zeitraum, nicht die Anzahl Kalendertage. */
function bkmpSwAverage(list, startIso, endIso) {
  const rows = bkmpSwRowsInRange(list, startIso, endIso);
  if (rows.length === 0) return null;
  return rows.reduce((sum, row) => sum + bkmpSwRowTotal(row), 0) / rows.length;
}

function bkmpSwBestDay(list) {
  let best = null;
  (list || []).forEach(row => {
    const total = bkmpSwRowTotal(row);
    if (!best || total > best.total) best = { date: row.stat_date, total };
  });
  return best;
}

/* Staerkster CB EINER Zeile (z.B. "heute") + sein Anteil an der Tagessumme. */
function bkmpSwStrongestCb(row) {
  if (!row) return null;
  const total = bkmpSwRowTotal(row);
  let best = null;
  BKMP_SW_CB_KEYS.forEach(key => {
    const visitors = Number(row[key + '_visitors']) || 0;
    if (!best || visitors > best.visitors) best = { cb: key, visitors };
  });
  if (!best) return null;
  return { cb: best.cb, visitors: best.visitors, sharePct: total ? (best.visitors / total) * 100 : null };
}

/* CB-Verteilung EINER Zeile - fuer die "Heutige Verteilung"-Balkenliste
   (Auftrag Abschnitt 14). Absteigend nach Besucherzahl sortiert. */
function bkmpSwDistribution(row) {
  if (!row) return [];
  const total = bkmpSwRowTotal(row);
  return BKMP_SW_CB_KEYS.map(key => {
    const visitors = Number(row[key + '_visitors']) || 0;
    return { cb: key, visitors, sharePct: total ? (visitors / total) * 100 : null };
  }).sort((a, b) => b.visitors - a.visitors);
}

/* Rang-Status EINER Zeile - fuer die "Ranglistenstatus"-Liste (Auftrag
   Abschnitt 17) + Zaehlung "wie viele CBs sind heute in den Top 5". Ein
   Rang von null ("nichts eingetragen") wird EXPLIZIT von 'not_in_top5'
   unterschieden (dritter Zustand, siehe Auftrag Abschnitt 18/23). */
function bkmpSwRankStatus(row) {
  const cbs = BKMP_SW_CB_KEYS.map(key => {
    const rank = row ? row[key + '_rank'] : null;
    return { cb: key, rank, label: rank ? BKMP_SW_RANK_LABELS[rank] : 'Nicht eingetragen', inTop5: rank !== null && rank !== 'not_in_top5' && rank !== undefined };
  });
  const top5Count = cbs.filter(c => c.inTop5).length;
  return { cbs, top5Count };
}

/* Auftrag Abschnitt 18: "wie haeufig war /sw bk auf einem CB in den Top 5",
   Ø sichtbare Position, beste jemals erreichte Position + Datum. Zaehlt
   AUSSCHLIESSLICH Tage, an denen fuer diesen CB tatsaechlich ein Rang
   eingetragen wurde (weder null/fehlend NOCH als #6 geschaetzt). */
function bkmpSwCbRankHistory(list, cbKey) {
  const rankField = cbKey + '_rank';
  const recorded = (list || []).filter(row => row[rankField] !== null && row[rankField] !== undefined);
  if (recorded.length === 0) return { daysRecorded: 0, daysInTop5: 0, top5Pct: null, avgRank: null, bestRank: null, bestRankDate: null };
  const inTop5 = recorded.filter(row => row[rankField] !== 'not_in_top5');
  let best = null;
  inTop5.forEach(row => {
    const rankNum = Number(row[rankField]);
    if (best === null || rankNum < best.rankNum) best = { rankNum, date: row.stat_date };
  });
  const avgRank = inTop5.length ? inTop5.reduce((sum, row) => sum + Number(row[rankField]), 0) / inTop5.length : null;
  return {
    daysRecorded: recorded.length,
    daysInTop5: inTop5.length,
    top5Pct: (inTop5.length / recorded.length) * 100,
    avgRank,
    bestRank: best ? best.rankNum : null,
    bestRankDate: best ? best.date : null
  };
}

/* Monats-Kennzahlen (Auftrag Abschnitt 22) - identisches Zeitraum-Prinzip
   wie bkmpCalculateMonthlyProjection() fuer den Umsatz. */
function bkmpSwMonthStats(list, todayDate) {
  const todayIso = bkmpToIsoDate(todayDate);
  const monthStart = todayIso.slice(0, 7) + '-01';
  const prevMonthDate = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1);
  const prevMonthStart = bkmpToIsoDate(prevMonthDate);
  const prevMonthEnd = bkmpAddDaysIso(monthStart, -1);

  const rowsThisMonth = bkmpSwRowsInRange(list, monthStart, todayIso);
  const total = rowsThisMonth.reduce((sum, row) => sum + bkmpSwRowTotal(row), 0);
  const avgPerDay = rowsThisMonth.length ? total / rowsThisMonth.length : null;
  const bestDay = bkmpSwBestDay(rowsThisMonth);

  let strongestCb = null;
  BKMP_SW_CB_KEYS.forEach(key => {
    const cbTotal = rowsThisMonth.reduce((sum, row) => sum + (Number(row[key + '_visitors']) || 0), 0);
    if (!strongestCb || cbTotal > strongestCb.total) strongestCb = { cb: key, total: cbTotal };
  });

  const prevMonthTotal = bkmpSwSumInRange(list, prevMonthStart, prevMonthEnd);

  return {
    hasData: rowsThisMonth.length > 0,
    total,
    avgPerDay,
    bestDay,
    strongestCb,
    change: bkmpCalculatePeriodChange(total, prevMonthTotal)
  };
}

/* ============================================================
   Theme-Toggle + Hell-Modus-Popup
   Wird auf jeder Seite aufgerufen, die die entsprechenden
   Elemente (#themeToggle, #jokeOverlay, ...) im HTML hat.
   ============================================================ */
function bkmpInitTheme() {
  const root = document.documentElement;
  const toggleBtn = document.getElementById('themeToggle');
  const label = document.getElementById('themeLabel');
  const overlay = document.getElementById('jokeOverlay');
  const jokeYes = document.getElementById('jokeYes');
  const jokeNo = document.getElementById('jokeNo');

  if (!toggleBtn) return;

  function updateLabel() {
    const current = root.getAttribute('data-theme');
    if (label) label.textContent = current === 'dark' ? 'Hell' : 'Dunkel';
  }

  function setTheme(next) {
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', next);
    localStorage.setItem(BKMP_THEME_KEY, next);
    updateLabel();
    /* Akzentfarben-Hintergrundmischung (--paper/-2/-3) neu berechnen, falls
       eine eigene Farbe gespeichert ist - setTheme() ist die EINZIGE
       Stelle, durch die jeder Theme-Wechsel laeuft (Toggle-Button UND der
       "Verdrückt"-Button im Spass-Popup, siehe jokeNo unten). Vorher hing
       das nur am Toggle-Klick, wodurch "Verdrückt" zwar data-theme korrekt
       zurueckstellte, der Hintergrund aber auf der Mischung des VORHERIGEN
       Themes haengen blieb - sah aus wie "wechselt nicht zurueck". */
    if (typeof bkmpRefreshAccentForTheme === 'function') bkmpRefreshAccentForTheme();
    window.clearTimeout(window.__bkmpThemeSwitchTimer);
    window.__bkmpThemeSwitchTimer = window.setTimeout(() => {
      root.classList.remove('theme-switching');
    }, 180);
  }

  function openJokeOverlay() {
    if (!overlay) return;
    overlay.classList.add('visible');
    document.body.classList.add('modal-open');
  }

  function closeJokeOverlay() {
    if (overlay) overlay.classList.remove('visible');
    document.body.classList.remove('modal-open');
  }

  toggleBtn.addEventListener('click', function () {
    const current = root.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (next === 'light') openJokeOverlay();
  });

  if (jokeYes) jokeYes.addEventListener('click', closeJokeOverlay);
  if (jokeNo) jokeNo.addEventListener('click', () => {
    setTheme('dark');
    closeJokeOverlay();
  });

  updateLabel();
}

/* ============================================================
   Eigene Akzentfarbe (Spieler-Idee: statt nur Hell/Dunkel die
   Akzentfarbe der Seite selbst waehlen). Ueberschreibt die CSS-Variable
   --gold als Inline-Style auf <html> - praktisch der gesamte
   Akzent-Farbton der Seite (Buttons, Raender, Highlights) laeuft schon
   darueber, faerbt sich dadurch automatisch um. Ein paar Stellen mit fest
   einprogrammierter Gold-Farbe (Leucht-Schatten) ziehen bewusst NICHT mit -
   das war die abgesprochene erste, einfachere Ausbaustufe.
   ============================================================ */
const BKMP_ACCENT_COLOR_KEY = 'bkmp-accent-color';
const BKMP_ACCENT_DEFAULT = { dark: '#C9A56A', light: '#B08D57' };
const BKMP_PAPER_DEFAULT = {
  dark: { p: '#08070A', p2: '#121016', p3: '#1A1720' },
  light: { p: '#F6F3EC', p2: '#EFEADD', p3: '#E5DFCE' }
};
/* Nutzer-Screenshots 30.08.2026 ("Farbregler-Wörter nicht lesbar"): Knöpfe/
   Badges wie .btn-primary/.btn-ja/.leaderboard-tab.active setzen background/
   border auf var(--gold) und zeichnen ihren Text in --accent-ink - fest auf
   ein dunkles #0A0A0F verdrahtet, in der Annahme, --gold sei immer hell/warm.
   Waehlt der Nutzer eine dunkle/schwarze Akzentfarbe, wird die Flaeche
   dunkel UND der Text bleibt dunkel -> praktisch unlesbar. Fix: --accent-ink
   wird jetzt nach der wahrgenommenen Helligkeit der gewaehlten Farbe (YIQ-
   Naeherung, das uebliche einfache Mass fuer "soll der Text hell oder dunkel
   sein") dynamisch berechnet - bei einer hellen/warmen Wahl (der ueberwiegend
   uebliche Fall) bleibt exakt das bisherige dunkle Ink erhalten (keine
   sichtbare Aenderung), erst bei einer dunklen Wahl schaltet es auf ein
   helles Ink um. */
function bkmpPerceivedBrightness(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 255;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000;
}
/* Faerbt nicht nur --gold um, sondern mischt dieselbe Farbe auch leicht in
   den Seitenhintergrund (--paper/-2/-3) - Spieler-Wunsch: "die komplette
   Hintergrundfarbe soll mit dem Regler anpassbar sein", nicht nur Buttons/
   Rahmen. Bleibt ueberwiegend dunkel/hell fuer Lesbarkeit. Nutzt IMMER das
   gerade aktive data-theme als Basis, nicht ein zwischengespeichertes -
   muss deshalb bei jedem Theme-Wechsel neu aufgerufen werden. */
function bkmpApplyAccentForCurrentTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem(BKMP_ACCENT_COLOR_KEY);
  if (!saved) {
    root.style.removeProperty('--gold');
    root.style.removeProperty('--paper');
    root.style.removeProperty('--paper-2');
    root.style.removeProperty('--paper-3');
    root.style.removeProperty('--accent-ink');
    return;
  }
  const base = root.getAttribute('data-theme') === 'light' ? BKMP_PAPER_DEFAULT.light : BKMP_PAPER_DEFAULT.dark;
  root.style.setProperty('--gold', saved);
  root.style.setProperty('--paper', `color-mix(in srgb, ${saved} 14%, ${base.p})`);
  root.style.setProperty('--paper-2', `color-mix(in srgb, ${saved} 18%, ${base.p2})`);
  root.style.setProperty('--paper-3', `color-mix(in srgb, ${saved} 22%, ${base.p3})`);
  root.style.setProperty('--accent-ink', bkmpPerceivedBrightness(saved) < 128 ? '#F5F3ED' : '#0A0A0F');
}
/* Von setTheme() bei JEDEM Theme-Wechsel aufgerufen (Toggle-Button UND der
   "Verdrückt"-Button im Spass-Popup, der setTheme() direkt aufruft, siehe
   bkmpInitTheme) - haelt sowohl die Hintergrundmischung als auch den
   Picker-Vorschauwert (falls keine eigene Farbe gespeichert ist) mit dem
   jeweils aktiven Theme synchron. */
function bkmpRefreshAccentForTheme() {
  bkmpApplyAccentForCurrentTheme();
  const picker = document.getElementById('accentColorPicker');
  if (picker && !localStorage.getItem(BKMP_ACCENT_COLOR_KEY)) {
    picker.value = document.documentElement.getAttribute('data-theme') === 'light' ? BKMP_ACCENT_DEFAULT.light : BKMP_ACCENT_DEFAULT.dark;
  }
}
function bkmpInitAccentColor() {
  const root = document.documentElement;
  const picker = document.getElementById('accentColorPicker');
  const resetBtn = document.getElementById('accentColorReset');
  if (!picker) return;

  function syncPickerValue() {
    const saved = localStorage.getItem(BKMP_ACCENT_COLOR_KEY);
    picker.value = saved || (root.getAttribute('data-theme') === 'light' ? BKMP_ACCENT_DEFAULT.light : BKMP_ACCENT_DEFAULT.dark);
  }
  syncPickerValue();

  picker.addEventListener('input', () => {
    localStorage.setItem(BKMP_ACCENT_COLOR_KEY, picker.value);
    bkmpApplyAccentForCurrentTheme();
  });

  if (resetBtn) resetBtn.addEventListener('click', () => {
    localStorage.removeItem(BKMP_ACCENT_COLOR_KEY);
    bkmpApplyAccentForCurrentTheme();
    syncPickerValue();
  });
}

/* ============================================================
   Robuste Bild-Ladehilfe
   Kurze Netzwerk- oder Storage-Haenger sollen Bilder nicht
   dauerhaft durch Platzhalter ersetzen.
   ============================================================ */
function bkmpEnhanceImages(root) {
  const scope = root && root.querySelectorAll ? root : document;
  const images = scope.querySelectorAll('img[data-bkmp-img]');

  images.forEach(img => {
    if (img.dataset.bkmpImageBound === '1') {
      if (img.complete && img.naturalWidth > 0) {
        markBkmpImageLoaded(img);
      } else if (img.classList.contains('bkmp-image-missing')) {
        // Panel war beim ersten Ladeversuch nicht sichtbar (content-visibility),
        // dadurch ist der Ladeversuch damals fehlgeschlagen. Jetzt, wo der Tab
        // aktiv ist, lohnt sich ein frischer Versuch.
        img.dataset.bkmpRetries = '0';
        retryBkmpImage(img);
      }
      return;
    }

    img.dataset.bkmpImageBound = '1';
    img.dataset.originalSrc = img.getAttribute('src') || '';
    img.classList.add('bkmp-image-loading');

    img.addEventListener('load', () => markBkmpImageLoaded(img));
    img.addEventListener('error', () => retryBkmpImage(img));

    if (img.complete && img.naturalWidth > 0) {
      markBkmpImageLoaded(img);
    }
  });
}

function markBkmpImageLoaded(img) {
  img.classList.remove('bkmp-image-loading', 'bkmp-image-missing');
  img.classList.add('bkmp-image-loaded');
  const holder = img.closest('[data-bkmp-image-wrap]');
  if (holder) holder.classList.remove('bkmp-image-missing');
}

function retryBkmpImage(img) {
  const retries = Number(img.dataset.bkmpRetries || 0);
  const originalSrc = img.dataset.originalSrc || img.getAttribute('src') || '';

  if (originalSrc && retries < 3) {
    img.dataset.bkmpRetries = String(retries + 1);
    window.setTimeout(() => {
      const separator = originalSrc.includes('?') ? '&' : '?';
      img.src = originalSrc + separator + 'bkmp_retry=' + Date.now();
    }, 450 + retries * 700);
    return;
  }

  img.classList.remove('bkmp-image-loading');
  img.classList.add('bkmp-image-missing');
  const holder = img.closest('[data-bkmp-image-wrap]');
  if (holder) holder.classList.add('bkmp-image-missing');
}

document.addEventListener('DOMContentLoaded', () => {
  bkmpEnhanceImages(document);
});
