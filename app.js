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
  'Karten', 'Bücher', 'Tränke', 'Elytra', 'Raketen', 'Werkzeug', 'Schmiede Vorlagen', 'Netherite', 'Custom'
];


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
  wishes: []
};

function bkmpLoadData() {
  try {
    const raw = localStorage.getItem(BKMP_DATA_KEY);
    if (!raw) return structuredClone(BKMP_DEFAULT_DATA);
    const parsed = JSON.parse(raw);
    return {
      income: bkmpNormalizeEntryList(parsed.income),
      expenses: bkmpNormalizeEntryList(parsed.expenses),
      investors: parsed.investors || [],
      news: parsed.news || [],
      wishes: parsed.wishes || []
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
    console.error('Fehler beim Speichern der Daten:', e);
    return false;
  }
}

function bkmpUid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
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
    root.setAttribute('data-theme', next);
    localStorage.setItem(BKMP_THEME_KEY, next);
    updateLabel();
  }

  toggleBtn.addEventListener('click', function () {
    const current = root.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (next === 'light' && overlay) overlay.classList.add('visible');
  });

  if (jokeYes) jokeYes.addEventListener('click', () => overlay.classList.remove('visible'));
  if (jokeNo) jokeNo.addEventListener('click', () => {
    setTheme('dark');
    overlay.classList.remove('visible');
  });

  updateLabel();
}
