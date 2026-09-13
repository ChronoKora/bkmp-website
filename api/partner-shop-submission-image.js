/* ============================================================
   Bkmp - Bild-Upload fuer Minecraft-Mod-PartnerShop-Einreichungen (Logo)

   OPBK 1.1 PartnerShops-Update (13.09.2026). 1:1 dasselbe Architektur-
   prinzip wie api/card-submission-image.js (siehe dortige ausfuehrliche
   Begruendung) - ein eigener, schlanker Endpunkt statt den Karten-Upload
   wiederzuverwenden, weil das Zielverzeichnis (und damit die in
   create_partner_shop_submission()/submit_partner_shop_revision() per
   LIKE-Pruefung erzwungene URL-Praefix-Allowlist) ein eigenes ist.

   POST /api/partner-shop-submission-image
   Body (JSON): { token: "<roher Mod-Token>", image: "data:image/png;base64,..." }

   SICHERHEIT: identisch zu api/card-submission-image.js - Token wird
   server-seitig gehasht und gegen mod_tokens nachgeschlagen, Rate-Limit
   ueber dieselbe check_and_record_rate_limit()-RPC, MIME-Type wird nie
   vom Client vertraut (sharp dekodiert die echten Bytes), fester
   Speicherpfad ausschliesslich server-seitig gebaut, IMMER Re-Encode auf
   PNG (verwirft Metadaten/EXIF/ICC).
   ============================================================ */

const sharp = require('sharp');

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const STORAGE_BUCKET = 'update-images';
const STORAGE_FOLDER = 'partner-shop-submissions';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_DIMENSION = 1024; // ein Shoplogo braucht keine MapArt-Wand-Aufloesung
const MIN_DIMENSION = 8;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function resolveModToken(serviceKey, rawToken) {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 32) return null;
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
  const params = new URLSearchParams();
  params.set('select', 'auth_user_id');
  params.set('token_hash', 'eq.' + hash);
  params.set('revoked_at', 'is.null');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/mod_tokens?${params.toString()}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  return row && row.auth_user_id ? row.auth_user_id : null;
}

async function checkRateLimit(serviceKey, subject, action, max, windowSeconds) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_and_record_rate_limit`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_subject: subject, p_action: action, p_max: max, p_window_seconds: windowSeconds })
  });
  if (!response.ok) return false; // fail closed
  const allowed = await response.json().catch(() => false);
  return allowed === true;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return send(res, 500, { error: 'server_not_configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'invalid_json' }); }
  }
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'invalid_json' });

  const rawToken = typeof body.token === 'string' ? body.token : '';
  const dataUrl = typeof body.image === 'string' ? body.image : '';

  const authUserId = await resolveModToken(serviceKey, rawToken);
  if (!authUserId) {
    return send(res, 401, { error: 'invalid_token' });
  }

  // Großzügig, aber begrenzt - ein Shoplogo wird realistisch deutlich
  // seltener getauscht als eine Karteneinreichung erstellt.
  const rateOk = await checkRateLimit(serviceKey, 'partnershop_submission_image:' + authUserId, 'partnershop_submission_image', 40, 86400);
  if (!rateOk) {
    return send(res, 429, { error: 'rate_limited' });
  }

  const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return send(res, 400, { error: 'invalid_image_format' });
  }

  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch (e) {
    return send(res, 400, { error: 'invalid_base64' });
  }
  if (buffer.length === 0 || buffer.length > MAX_INPUT_BYTES) {
    return send(res, 400, { error: 'image_too_large' });
  }

  let outBuffer;
  try {
    const image = sharp(buffer, { failOn: 'error' });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
      return send(res, 400, { error: 'image_too_small' });
    }
    if (metadata.width > MAX_OUTPUT_DIMENSION || metadata.height > MAX_OUTPUT_DIMENSION) {
      return send(res, 400, { error: 'image_too_large_dimensions' });
    }
    outBuffer = await image.png({ compressionLevel: 8 }).toBuffer();
  } catch (error) {
    return send(res, 400, { error: 'invalid_image' });
  }

  const fileName = `${STORAGE_FOLDER}/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${fileName}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'image/png',
      'x-upsert': 'false'
    },
    body: outBuffer
  });
  if (!uploadRes.ok) {
    return send(res, 502, { error: 'upload_failed' });
  }

  const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${fileName}`;
  return send(res, 200, { ok: true, imageUrl });
};
