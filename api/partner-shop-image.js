/* ============================================================
   Bkmp - Minecraft-kompatibler Bild-Proxy fuer PartnerShops

   13.09.2026 (OPBK 1.1 "PARTNERSHOPS UPDATE", Live-Fund im echten Mod: "Bild
   nicht erreichbar" fuer mehrere der 27 bestehenden Legacy-Shops). Exakter
   Mirror von api/card-image.js (siehe dessen ausfuehrlichen Kommentar fuer
   die volle Herleitung "warum Server-Proxy statt Upload-Pipeline-Umbau oder
   WebP-Decoder im Mod-Jar") - Minecrafts eigener Decoder (NativeImage/
   stb_image) kann NUR PNG lesen. Live per curl bestaetigt (nicht nur
   vermutet): mixmarkt/Treumall CB4's echte Bild-URLs sind beide real
   erreichbar (HTTP 200) UND beide .webp - exakt dieselbe Bug-Klasse wie
   beim urspruenglichen Kartenbild-Fund vom 01.09.2026, hier nur fuer
   PartnerShops erstmals aufgetreten, weil deren Bilder teils schon VOR
   dieser Mod-Integration ueber die Website manuell hochgeladen wurden (die
   Mod-Einreichungs-Pipeline selbst, siehe partner-shop-submission-image.js,
   erzeugt bereits ausschliesslich PNG - NEUE, ueber die Mod eingereichte
   Shops sind von diesem Bug nie betroffen).

   GET /api/partner-shop-image?id=<partner_shops.id>&size=thumb|full

   Bewusst OHNE status='approved'-Einschraenkung (anders als api/card-
   image.js) - "Meine Shops" (list_my_partner_shops(), direkter RPC-Aufruf
   ohne diese Vercel-Ebene, siehe PartnerShopSubmissionApiClient.java im
   Mod-Repo) muss auch das Bild eines noch PENDING/needs_changes-Shops
   zeigen koennen, dessen Besitzer es gerade selbst betrachtet. Das ist kein
   Sicherheits-Nachlass: dieser Endpunkt liefert AUSSCHLIESSLICH die
   Bildbytes selbst zurueck, nie Name/Beschreibung/Status/Besitzer - eine
   zufaellige UUID zu erraten deckt hoechstens ein einzelnes, ohnehin nicht
   geheimes Bild auf, kein weiteres Datenfeld.

   SSRF-Schutz identisch zu api/card-image.js: der Client schickt niemals
   eine URL, nur eine partner_shops-ID; die tatsaechliche Bild-URL wird
   ausschliesslich server-seitig nachgeschlagen und gegen eine enge
   Praefix-Allowlist geprueft (kein Redirect-Follow, Groessen-/Timeout-
   Deckel).
   ============================================================ */

const sharp = require('sharp');

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RuiDW15_3cI0cQZ8WlzoWg_DhGU9r6f';

// Zwei Praefixe - identisches Muster/identische Begruendung wie api/card-
// image.js's ALLOWED_IMAGE_URL_PREFIXES (dort per Live-Fund auf 2 erweitert,
// hier von Anfang an mit beiden angelegt): "partner-shops/" fuer Legacy-/
// manuelle Website-Uploads (admin.html), "partner-shop-submissions/" fuer
// ueber die Mod eingereichte Shops (siehe STORAGE_FOLDER in
// partner-shop-submission-image.js) - create_partner_shop_submission()
// (sql/20260913-partnershops-update-v1.sql) kopiert die Datei nie in einen
// anderen Ordner, image_url zeigt also dauerhaft auf genau diesen Pfad.
const ALLOWED_IMAGE_URL_PREFIXES = [
  'https://zgknyrwzpohvfdweomxf.supabase.co/storage/v1/object/public/update-images/partner-shops/',
  'https://zgknyrwzpohvfdweomxf.supabase.co/storage/v1/object/public/update-images/partner-shop-submissions/'
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIZES = {
  thumb: 384,
  full: 1024
};

const FETCH_TIMEOUT_MS = 10000;
const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;

function isAllowedImageUrl(url) {
  return typeof url === 'string' && !url.includes('..') && ALLOWED_IMAGE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function sendError(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(message);
}

async function lookupImageUrl(id) {
  const params = new URLSearchParams();
  params.set('select', 'image_url');
  params.set('id', 'eq.' + id);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/partner_shops?${params.toString()}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  if (!response.ok) return null;
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  return row && row.image_url ? row.image_url : null;
}

async function fetchOriginalImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal
    });
    if (response.status < 200 || response.status >= 300) {
      const err = new Error('upstream_status_' + response.status);
      err.code = 'upstream_failed';
      throw err;
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_ORIGINAL_BYTES) {
      const err = new Error('original_too_large');
      err.code = 'too_large';
      throw err;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ORIGINAL_BYTES) {
      const err = new Error('original_too_large');
      err.code = 'too_large';
      throw err;
    }
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

async function convertForMinecraft(buffer, boxSize) {
  // Siehe api/card-image.js's ausfuehrlicher Kommentar - IMMER PNG, nie
  // JPEG (Minecrafts NativeImage lehnt JPEG ebenso ab wie WebP).
  const out = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: boxSize, height: boxSize, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 8 })
    .toBuffer();
  return { buffer: out, contentType: 'image/png' };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed');

  try {
    const query = req.query || {};
    const id = typeof query.id === 'string' ? query.id.trim() : '';
    if (!UUID_RE.test(id)) return sendError(res, 400, 'invalid_id');

    const sizeKey = SIZES[query.size] ? query.size : 'thumb';
    const boxSize = SIZES[sizeKey];

    const originalUrl = await lookupImageUrl(id);
    if (!originalUrl) return sendError(res, 404, 'partner_shop_not_found');
    if (!isAllowedImageUrl(originalUrl)) return sendError(res, 502, 'image_url_not_allowed');

    let originalBuffer;
    try {
      originalBuffer = await fetchOriginalImage(originalUrl);
    } catch (error) {
      if (error.name === 'AbortError') return sendError(res, 504, 'upstream_timeout');
      if (error.code === 'too_large') return sendError(res, 502, 'original_too_large');
      return sendError(res, 502, 'upstream_unavailable');
    }

    let converted;
    try {
      converted = await convertForMinecraft(originalBuffer, boxSize);
    } catch (error) {
      return sendError(res, 502, 'conversion_failed');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', converted.contentType);
    // Anders als bei Karten (nie ein Bild-Edit-Feature) kann ein PartnerShop-
    // Bild sich durch eine angenommene Revision AENDERN (siehe
    // review_partner_shop_revision() in sql/20260913-partnershops-update-v1.sql,
    // image_url wird dabei ueberschrieben) - deutlich kuerzeres Caching als
    // beim Kartenbild-Proxy, kein "immutable".
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
    res.end(converted.buffer);
  } catch (error) {
    return sendError(res, 500, 'unexpected');
  }
};

module.exports._internal = { isAllowedImageUrl, UUID_RE, SIZES, ALLOWED_IMAGE_URL_PREFIXES };
