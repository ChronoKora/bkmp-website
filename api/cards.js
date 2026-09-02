/* ============================================================
   Bkmp - Read-Only-API fuer die BK-Kartendatenbank (Minecraft-Mod)

   Liefert AUSSCHLIESSLICH bereits freigegebene (status='approved')
   Eintraege aus public.card_catalog. Keine Schreiboperationen, keine
   Moderationsdaten (status/is_read werden nie ausgeliefert), keine
   pending/rejected-Karten.

   Braucht bewusst KEINEN SUPABASE_SERVICE_ROLE_KEY - der Anon-/
   Publishable-Key ist bereits oeffentlich (siehe supabase.js/
   submit-entry.js) und die bestehende RLS-Policy "Public read approved
   card catalog" erlaubt anon-SELECT auf genau diese Zeilen ohnehin
   schon. Diese Route fasst also keine neuen Rechte an, sie buendelt nur
   Suche/Filter/Pagination fuer einen schlanken Mod-Client.

   Nur echte, in card_catalog vorhandene Spalten werden ausgeliefert -
   KEINE erfundenen Felder wie price/tags/creator/seller/available
   (siehe CLAUDE.md-Analyse vom 01.09.2026: diese Konzepte existieren in
   der Datenbank schlicht nicht, card_catalog ist eine von Spielern
   gepflegte Kartenfundstellen-Sammlung, kein Preis-/Verkaufssystem -
   das ist die unabhaengige card_sales-Tabelle mit komplett anderem
   Zweck).

   "thumbnail" ist aktuell bewusst ein Alias auf "image" (es gibt keine
   separate, kleinere Bildvariante) - der Mod-Client kann trotzdem
   schon jetzt konsequent thumbnail=fuer die Galerie / image=fuer die
   Detailansicht verwenden; sollte spaeter eine echte Thumbnail-Pipeline
   dazukommen, aendert sich nur der Wert, nie der Vertrag.

   ?facets=1 liefert zusaetzlich echte, LIVE aus der Datenbank abgeleitete
   Kategorie-Haeufigkeiten statt einer im Mod-Client hartcodierten
   Kategorieliste - "category" ist in card_catalog reines Freitextfeld
   (aktuell >30 verschiedene Werte, siehe CLAUDE.md-Analyse), eine feste
   Liste wuerde mit der Zeit veralten. Holt dafuer nur die eine Spalte
   "category" (kein Preis/Bild/Beschreibung etc., minimale Nutzlast) und
   zaehlt sie hier im Node-Handler selbst zusammen - keine SQL-Aenderung,
   kein neues DB-Objekt, PostgREST kann kein GROUP BY ueber die REST-API.
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
// Anon/Publishable Key - identisch zum bereits im Frontend (supabase.js)
// und in api/submit-entry.js verwendeten Wert. Kein Geheimnis, siehe
// Kommentar oben.
const SUPABASE_ANON_KEY = 'sb_publishable_RuiDW15_3cI0cQZ8WlzoWg_DhGU9r6f';

const TABLE = 'card_catalog';
const SELECT_COLUMNS = 'id,name,category,shop_name,cb,size,submitted_by,description,image_url,created_at,series,price,seller,creator,width_maps,height_maps,total_maps';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 5000; // grosszuegiger, aber endlicher Deckel gegen absurde Offset-Werte
const MAX_TEXT_PARAM_LENGTH = 100;

const SORT_OPTIONS = {
  newest: 'created_at.desc',
  oldest: 'created_at.asc',
  name_asc: 'name.asc',
  name_desc: 'name.desc'
};

// Felder, ueber die "search" gleichzeitig sucht (per PostgREST or=(...)).
const SEARCHABLE_COLUMNS = ['name', 'category', 'description', 'submitted_by', 'shop_name'];

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  res.end(JSON.stringify(payload));
}

function clampInt(value, fallback, min, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Entfernt Zeichen, die in PostgREST's Mini-Query-Sprache Sonderbedeutung
// haben (Komma/Klammern trennen bzw. gruppieren or()-Bedingungen, "*" ist
// der ilike-Wildcard-Platzhalter) - verhindert, dass ein Suchbegriff die
// zusammengesetzte or()-Filterstruktur sprengt oder ungewollte Wildcards
// einschleust. Betrifft nur den Filterausdruck, nicht die angezeigten Daten.
function sanitizeFilterValue(raw) {
  return String(raw || '')
    .slice(0, MAX_TEXT_PARAM_LENGTH)
    .replace(/[,()*]/g, '')
    .trim();
}

// Absolute Basis, nicht relativ - der Mod-Client (java.net.http.HttpClient)
// braucht zwingend eine vollstaendige absolute URI (URI.create('/api/...')
// waere zwar gueltiges URI-Syntax, aber HttpRequest.newBuilder() lehnt eine
// relative URI mit "URI is not absolute" ab). Gleiche hartcodierte
// Produktions-Domain wie BkmpCardBrowserConfig's Default apiBaseUrl im Mod.
const SITE_ORIGIN = 'https://bkinvestment.de';

function mapRow(row) {
  // "image" bleibt unveraendert die rohe Original-URL (z.B. .webp) - falls
  // je ein zweiter Konsument dieser API dazukommt, der das Original braucht,
  // aendert sich hier nichts. "thumbnail"/"minecraftImage" zeigen seit dem
  // WebP-Proxy (api/card-image.js, 2026-09-01) auf eine garantiert
  // Minecraft-lesbare (PNG/JPEG) Variante - klein fuer die Galerie, groesser
  // fuer die Detailansicht. Fehlt row.id (sollte nie passieren, id ist
  // primary key), fallen beide defensiv auf die rohe Original-URL zurueck,
  // statt eine kaputte Proxy-URL ohne id auszuliefern.
  const proxyBase = row.id ? `${SITE_ORIGIN}/api/card-image?id=${encodeURIComponent(row.id)}` : '';
  return {
    id: row.id,
    name: row.name || '',
    category: row.category || '',
    shop: row.shop_name || '',
    cb: row.cb || '',
    size: row.size || '',
    submittedBy: row.submitted_by || '',
    description: row.description || '',
    image: row.image_url || '',
    thumbnail: proxyBase ? `${proxyBase}&size=thumb` : (row.image_url || ''),
    minecraftImage: proxyBase ? `${proxyBase}&size=full` : (row.image_url || ''),
    // Additiv seit 02.09.2026 (Mod-Karteneinreichung-Feature, siehe
    // sql/20260902-mod-account-linking-and-submissions.sql) - bei
    // aelteren Karten meist null, Konsumenten muessen jedes Feld
    // einzeln auf Vorhandensein pruefen statt "null"/"undefined"
    // anzuzeigen (gleiche Konvention wie alle anderen optionalen Felder
    // hier).
    series: row.series || '',
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    seller: row.seller || '',
    creator: row.creator || '',
    widthMaps: row.width_maps === null || row.width_maps === undefined ? null : Number(row.width_maps),
    heightMaps: row.height_maps === null || row.height_maps === undefined ? null : Number(row.height_maps),
    totalMaps: row.total_maps === null || row.total_maps === undefined ? null : Number(row.total_maps),
    createdAt: row.created_at || null
  };
}

const FACETS_ROW_CAP = 2000; // grosszuegig ueber dem aktuellen Bestand (559), reine Sicherheitsgrenze

async function handleFacets(req, res) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=category&status=eq.approved`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Range: `0-${FACETS_ROW_CAP - 1}`,
        'Range-Unit': 'items'
      }
    });
    if (!response.ok && response.status !== 416) {
      const detail = await response.text().catch(() => '');
      return send(res, 200, { ok: false, error: 'facets_unavailable', status: response.status, detail: detail.slice(0, 200), categories: [] });
    }
    const rows = response.status === 416 ? [] : await response.json();
    const counts = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const name = (row && row.category ? String(row.category).trim() : '') || 'Sonstige';
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    const categories = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return send(res, 200, { ok: true, categories });
  } catch (error) {
    return send(res, 200, { ok: false, error: 'unexpected', detail: String((error && error.message) || error).slice(0, 200), categories: [] });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method_not_allowed' });

  try {
    const query = req.query || {};

    if (query.facets === '1' || query.facets === 'true') {
      return await handleFacets(req, res);
    }
    const page = clampInt(query.page, 1, 1, MAX_PAGE);
    const pageSize = clampInt(query.limit ?? query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const sortKey = typeof query.sort === 'string' && SORT_OPTIONS[query.sort] ? query.sort : 'newest';

    const params = new URLSearchParams();
    params.set('select', SELECT_COLUMNS);
    params.set('status', 'eq.approved');
    params.set('order', SORT_OPTIONS[sortKey]);

    const category = sanitizeFilterValue(query.category);
    if (category) params.set('category', 'ilike.' + category);

    const cb = sanitizeFilterValue(query.cb ?? query.server);
    if (cb) params.set('cb', 'ilike.' + cb);

    const shop = sanitizeFilterValue(query.shop);
    if (shop) params.set('shop_name', 'ilike.' + shop);

    const search = sanitizeFilterValue(query.search ?? query.q);
    if (search) {
      const orExpr = SEARCHABLE_COLUMNS.map(col => `${col}.ilike.*${search}*`).join(',');
      params.set('or', `(${orExpr})`);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?${params.toString()}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'count=exact',
        Range: `${from}-${to}`,
        'Range-Unit': 'items'
      }
    });

    if (!response.ok) {
      // PostgREST antwortet mit 416 (Range Not Satisfiable / PGRST103),
      // wenn die angefragte Seite hinter dem letzten vorhandenen Datensatz
      // liegt (z.B. page=999 bei nur 559 Zeilen) - das ist kein echter
      // Fehler, sondern schlicht "keine weiteren Ergebnisse". Ein
      // Mod-Client soll dafuer nicht extra Fehlerbehandlung brauchen.
      if (response.status === 416) {
        const contentRange = response.headers.get('content-range') || '';
        const total = Number(contentRange.split('/')[1]) || 0;
        return send(res, 200, { ok: true, page, pageSize, total, totalPages: pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1, cards: [] });
      }
      const detail = await response.text().catch(() => '');
      return send(res, 200, { ok: false, error: 'cards_unavailable', status: response.status, detail: detail.slice(0, 200), page, pageSize, total: 0, totalPages: 0, cards: [] });
    }

    const rows = await response.json();
    const contentRange = response.headers.get('content-range') || '';
    const total = Number(contentRange.split('/')[1]) || 0;
    const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

    return send(res, 200, {
      ok: true,
      page,
      pageSize,
      total,
      totalPages,
      cards: (Array.isArray(rows) ? rows : []).map(mapRow)
    });
  } catch (error) {
    return send(res, 200, {
      ok: false,
      error: 'unexpected',
      detail: String((error && error.message) || error).slice(0, 200),
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 0,
      cards: []
    });
  }
};
