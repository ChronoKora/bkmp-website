/* ============================================================
   Bkmp - Minecraft-kompatibler Bild-Proxy fuer die Kartendatenbank

   Liefert fuer eine gegebene card_catalog-Karte immer ein Bild, das
   Minecrafts eigener Decoder (NativeImage/stb_image) lesen kann - auch
   wenn das Original als WebP gespeichert wurde (stb_image kann WebP
   grundsaetzlich nie decodieren, das ist keine Versions-/Konfigurations-
   frage). Siehe CLAUDE.md-Analyse vom 01.09.2026 fuer die volle
   Herleitung, warum Option B (Server-Proxy) hier gewaehlt wurde statt
   A (Upload-Pipeline umbauen) oder C (WebP-Decoder im Mod-Jar).

   GET /api/card-image?id=<card_catalog.id>&size=thumb|full

   WICHTIG - SSRF-Schutz per Architektur, nicht nur per Filter:
   Der Client schickt NIEMALS eine URL, nur eine Karten-ID. Die
   tatsaechliche Bild-URL wird ausschliesslich server-seitig aus
   card_catalog nachgeschlagen (identischer RLS-Pfad wie api/cards.js -
   nur status='approved', nur der Anon-Key). Ein Angreifer kann also
   strukturell NIE eine fremde URL in den fetch() hineinschieben, selbst
   bei einem Bug in der Validierung waere das Ziel bestenfalls "eine
   andere image_url, die bereits in unserer eigenen DB steht". Die
   isAllowedImageUrl()-Pruefung unten ist trotzdem vorhanden (defense in
   depth, prueft Hostname+Bucket+Pfad-Praefix in einem Schritt) und wird
   in tests/mock/card-image-proxy-test.js direkt mit echten SSRF-
   Nutzlasten (localhost/127.0.0.1/private IP/fremde Domain) geprueft.

   Folgt keinen Redirects (redirect:'manual') - ein 3xx von Supabase
   waere ohnehin unerwartet und wird bewusst wie ein Fehler behandelt,
   nicht wie eine gueltige Antwort.
   ============================================================ */

const sharp = require('sharp');

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RuiDW15_3cI0cQZ8WlzoWg_DhGU9r6f';

// Einziger erlaubter Praefix fuer Kartenbilder - deckt Hostname UND
// Bucket UND Pfad in einem einzigen, sehr enge gefassten String-Vergleich
// ab (siehe Modul-Kommentar oben zur Architektur-Begruendung).
const ALLOWED_IMAGE_URL_PREFIX = 'https://zgknyrwzpohvfdweomxf.supabase.co/storage/v1/object/public/update-images/card-catalog/';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIZES = {
  thumb: 384,
  full: 1024
};

const FETCH_TIMEOUT_MS = 10000;
const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024; // grosszuegig ueber der realen Kartengroesse (~50-300 KB), reine Missbrauchsbremse

function isAllowedImageUrl(url) {
  return typeof url === 'string' && url.startsWith(ALLOWED_IMAGE_URL_PREFIX) && !url.includes('..');
}

function sendError(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(message);
}

async function lookupApprovedImageUrl(id) {
  const params = new URLSearchParams();
  params.set('select', 'image_url');
  params.set('id', 'eq.' + id);
  params.set('status', 'eq.approved');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/card_catalog?${params.toString()}`, {
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
      redirect: 'manual', // niemals einem 3xx folgen - siehe Modul-Kommentar
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
  // IMMER PNG, nie JPEG - Minecrafts eigener Decoder (com.mojang.blaze3d.
  // platform.NativeImage) kann laut Ground-Truth-Test (echter Client-
  // seitiger Stacktrace, 01.09.2026, siehe CLAUDE.md) NUR PNG lesen; ein
  // JPEG-Ergebnis schlaegt dort IMMER mit "IOException: Bad PNG
  // Signature" fehl, unabhaengig davon wie gueltig das JPEG selbst ist.
  // Das war der eigentliche Grund, warum die meisten (nicht-transparenten)
  // Karten trotz funktionierendem Proxy nie im Mod ankamen - nur die
  // seltenen Karten mit Alpha-Kanal wurden zufaellig schon als PNG
  // ausgeliefert und haben deshalb funktioniert.
  const out = await sharp(buffer, { failOn: 'none' })
    .rotate() // EXIF-Ausrichtung respektieren, bevor auf die Box skaliert wird
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

    const originalUrl = await lookupApprovedImageUrl(id);
    if (!originalUrl) return sendError(res, 404, 'card_not_found');
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
    // Ein card_catalog-Eintrag bekommt nach dem Anlegen nie ein neues
    // Bild (kein Bild-Edit-Feature vorhanden) - die transkodierte Ausgabe
    // fuer eine gegebene id+size ist damit faktisch unveraenderlich.
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400, immutable');
    res.end(converted.buffer);
  } catch (error) {
    return sendError(res, 500, 'unexpected');
  }
};

module.exports._internal = { isAllowedImageUrl, UUID_RE, SIZES, ALLOWED_IMAGE_URL_PREFIX };
