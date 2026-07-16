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
  { id: 'pekka14', name: 'Pekka14 Plüshie', image: 'assets/plushies/pekka14.png', desc: 'Der Pekka14-Plüschie fürs Regal.', rarity: 'Episch' },
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
async function bkmpSubmitViaApi(type, fields, imageDataUrl) {
  let response;
  try {
    response = await fetch('/api/submit-entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, fields, imageDataUrl: imageDataUrl || null })
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
    return;
  }
  const base = root.getAttribute('data-theme') === 'light' ? BKMP_PAPER_DEFAULT.light : BKMP_PAPER_DEFAULT.dark;
  root.style.setProperty('--gold', saved);
  root.style.setProperty('--paper', `color-mix(in srgb, ${saved} 14%, ${base.p})`);
  root.style.setProperty('--paper-2', `color-mix(in srgb, ${saved} 18%, ${base.p2})`);
  root.style.setProperty('--paper-3', `color-mix(in srgb, ${saved} 22%, ${base.p3})`);
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
