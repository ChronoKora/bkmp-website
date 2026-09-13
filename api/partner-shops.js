/* ============================================================
   Bkmp - Read-Only-API fuer PartnerShops (Minecraft-Mod)

   OPBK 1.1 PartnerShops-Update (13.09.2026). Identisches Architektur-
   prinzip wie api/cards.js (siehe dortige ausfuehrliche Begruendung) -
   braucht bewusst KEINEN SUPABASE_SERVICE_ROLE_KEY, der Anon-Key reicht,
   weil die bestehende RLS-Policy "Public read approved partner shops"
   (+ die neue "Public read active partner shop locations", siehe
   sql/20260913-partnershops-update-v1.sql) anon-SELECT auf genau diese
   Zeilen ohnehin schon erlaubt. Diese Route buendelt nur Suche/Filter/
   Pagination/Standort-Einbettung fuer einen schlanken Mod-Client.

   GET /api/partner-shops            - Liste (search/category/cb/verified/
                                        page/limit/sort/spotlight=1)
   GET /api/partner-shops?id=<uuid>  - ein einzelner Shop (inkl. locations[])

   Liefert NIE sensible Auth-IDs (owner_auth_user_id/review_message/source
   werden bewusst NICHT in die Antwort gemappt, Abschnitt 28).
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RuiDW15_3cI0cQZ8WlzoWg_DhGU9r6f';

const TABLE = 'partner_shops';
const BASE_COLUMNS = 'id,shop_name,image_url,description,category,location,verified,created_at,updated_at';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 2000;
const MAX_TEXT_PARAM_LENGTH = 100;

const SORT_OPTIONS = {
  newest: 'created_at.desc',
  oldest: 'created_at.asc',
  name_asc: 'shop_name.asc',
  name_desc: 'shop_name.desc'
};

const SEARCHABLE_COLUMNS = ['shop_name', 'description', 'category', 'location'];
const VALID_CITYBUILDS = ['CB1', 'CB2', 'CB3', 'CB4', 'CB5', 'CB6'];

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

// Siehe identische Begruendung in api/cards.js - verhindert, dass ein
// Suchbegriff die PostgREST-Mini-Query-Sprache sprengt.
function sanitizeFilterValue(raw) {
  return String(raw || '')
    .slice(0, MAX_TEXT_PARAM_LENGTH)
    .replace(/[,()*]/g, '')
    .trim();
}

function mapRow(row) {
  const locations = Array.isArray(row.partner_shop_locations)
    ? row.partner_shop_locations.map(loc => ({ id: loc.id, citybuild: loc.citybuild, shopWarp: loc.shop_warp }))
    : [];
  return {
    id: row.id,
    name: row.shop_name || '',
    imageUrl: row.image_url || '',
    description: row.description || '',
    category: row.category || '',
    verified: Boolean(row.verified),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || row.created_at || null,
    // Legacy-Freitext-Standort (Abschnitt 20/28) - bleibt sichtbar, auch
    // wenn die Karte bereits strukturierte locations[] hat, damit ein
    // Mod-Client bei Bedarf den urspruenglichen Text weiter anzeigen kann.
    legacyLocation: row.location || '',
    locations
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method_not_allowed' });

  try {
    const query = req.query || {};

    // ---------------- Einzelner Shop (Detailansicht) ----------------
    if (query.id) {
      const id = sanitizeFilterValue(query.id);
      const params = new URLSearchParams();
      params.set('select', `${BASE_COLUMNS},partner_shop_locations(id,citybuild,shop_warp)`);
      params.set('id', 'eq.' + id);
      params.set('status', 'eq.approved');
      params.set('active', 'eq.true');
      params.set('limit', '1');

      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?${params.toString()}`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return send(res, 200, { ok: false, error: 'partner_shop_unavailable', detail: detail.slice(0, 200), shop: null });
      }
      const rows = await response.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      return send(res, 200, { ok: true, shop: row ? mapRow(row) : null });
    }

    // ---------------- Liste ----------------
    const page = clampInt(query.page, 1, 1, MAX_PAGE);
    const pageSize = clampInt(query.limit ?? query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const sortKey = typeof query.sort === 'string' && SORT_OPTIONS[query.sort] ? query.sort : 'newest';

    const cb = sanitizeFilterValue(query.cb).toUpperCase();
    const cbValid = VALID_CITYBUILDS.includes(cb);

    const params = new URLSearchParams();
    // "!inner" zwingt PostgREST zu einem Inner-Join, sobald nach einer
    // bestimmten citybuild gefiltert wird (nur Shops MIT einem passenden
    // Standort kommen dann zurueck) - ohne cb-Filter bleibt es ein
    // normaler Left-Join (auch Shops ohne strukturierte Standorte bleiben
    // sichtbar, siehe Abschnitt 20 "Legacy-Shop bleibt oeffentlich
    // sichtbar").
    params.set('select', `${BASE_COLUMNS},partner_shop_locations${cbValid ? '!inner' : ''}(id,citybuild,shop_warp)`);
    params.set('status', 'eq.approved');
    params.set('active', 'eq.true');
    params.set('order', SORT_OPTIONS[sortKey]);

    if (cbValid) params.set('partner_shop_locations.citybuild', 'eq.' + cb);

    if (query.spotlight === '1' || query.spotlight === 'true') {
      params.set('spotlight_enabled', 'eq.true');
    }
    if (query.verified === '1' || query.verified === 'true') {
      params.set('verified', 'eq.true');
    }

    const category = sanitizeFilterValue(query.category);
    if (category) params.set('category', 'ilike.' + category);

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
      if (response.status === 416) {
        const contentRange = response.headers.get('content-range') || '';
        const total = Number(contentRange.split('/')[1]) || 0;
        return send(res, 200, { ok: true, page, pageSize, total, totalPages: pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1, shops: [] });
      }
      const detail = await response.text().catch(() => '');
      return send(res, 200, { ok: false, error: 'partner_shops_unavailable', status: response.status, detail: detail.slice(0, 200), page, pageSize, total: 0, totalPages: 0, shops: [] });
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
      shops: (Array.isArray(rows) ? rows : []).map(mapRow)
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
      shops: []
    });
  }
};
