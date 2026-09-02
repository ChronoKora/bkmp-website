/* ============================================================
   Bkmp - Bild-Upload fuer Minecraft-Mod-Karteneinreichungen

   Der EINZIGE neue serverlose Endpunkt dieses Features (siehe
   sql/20260902-mod-account-linking-and-submissions.sql fuer die volle
   Architektur-Begruendung) - jede andere Mod-Aktion (Pairing tauschen,
   Einreichung anlegen, eigene Einreichungen auflisten, Account-Status
   pruefen) laeuft als direkter Postgres-RPC-Aufruf mit dem oeffentlichen
   anon-Key, genau wie supabase.js es fuer die Website selbst tut. Nur
   ECHTE Bildvalidierung (Signatur pruefen, dekodieren, Groesse pruefen)
   braucht eine Node-Laufzeit (sharp) statt reinem SQL.

   POST /api/card-submission-image
   Body (JSON): { token: "<roher Mod-Token>", image: "data:image/png;base64,..." }
   - identisches data:-URL-Format wie api/submit-entry.js's uploadImage()
     (bereits bewaehrtes Muster in diesem Projekt) statt eines rohen
     multipart/binary-Bodys, dessen Parsing-Verhalten in dieser exakten
     serverlosen Umgebung nicht ohne Weiteres verifizierbar war.

   SICHERHEIT:
   - Token wird server-seitig gehasht (SHA-256) und gegen mod_tokens
     nachgeschlagen (Service-Role-Key, RLS bewusst umgangen - identisches
     Prinzip wie jede andere api/*.js-Datei dieses Projekts) - die
     auth_user_id kommt IMMER aus dieser Ableitung, nie aus einem vom
     Client behaupteten Feld.
   - Rate-Limit ueber dieselbe check_and_record_rate_limit()-Funktion
     wie die anderen Mod-Endpunkte (RPC-Aufruf mit dem Service-Role-Key).
   - MIME-Type wird NICHT vom Client-Header/Dateinamen vertraut - sharp
     dekodiert die echten Bytes und wirft bei ungueltigen/fremden
     Formaten (Signatur-Pruefung passiert implizit beim Decodieren).
   - Feste Ober- bzw. Untergrenzen fuer Dateigroesse und Pixelzahl.
   - Kein vom Client waehlbarer Speicherpfad - der Dateiname wird
     ausschliesslich server-seitig aus Zeitstempel+Zufallswert gebaut,
     landet immer im festen Ordner "card-submissions/" (siehe
     create_card_submission()'s image_url-Praefix-Pruefung in der
     SQL-Datei - eine dort nicht passende URL wird beim Einreichen
     ohnehin abgelehnt, auch wenn dieser Endpunkt je einen anderen Pfad
     liefern wuerde).
   - Normalisiert IMMER auf PNG (verwirft alle Metadaten/EXIF/ICC-Profile
     durch den Re-Encode via sharp - kein Passthrough der Originalbytes).
   ============================================================ */

const sharp = require('sharp');

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const STORAGE_BUCKET = 'update-images';
const STORAGE_FOLDER = 'card-submissions';

const MAX_INPUT_BYTES = 12 * 1024 * 1024; // grosszuegig ueber einer 10x6-MapArt-Komposition (1280x768 unkomprimiert waere ~3.9MB)
const MAX_OUTPUT_DIMENSION = 2048; // deckt die groesste sinnvolle MapArt-Wand (z.B. 16x16 Karten = 2048x2048) grosszuegig ab
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
  if (!response.ok) return false; // fail closed - ein defekter Rate-Limit-Check darf nie stillschweigend "erlaubt" bedeuten
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
    // Absichtlich keine Unterscheidung "kein Token"/"falscher Token"/
    // "widerrufener Token" in der Antwort - vermeidet, einem Angreifer
    // per Fehlermeldung zu verraten, ob ein bestimmter Token je gueltig war.
    return send(res, 401, { error: 'invalid_token' });
  }

  const rateOk = await checkRateLimit(serviceKey, 'submission_image:' + authUserId, 'submission_image', 15, 3600);
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
    const image = sharp(buffer, { failOn: 'error' }); // striktes Parsen - kein "haben wir schon mal gesehen" Nachsicht-Modus wie beim Kartenbild-Proxy, hier soll ein wirklich kaputtes Bild klar scheitern
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
      return send(res, 400, { error: 'image_too_small' });
    }
    if (metadata.width > MAX_OUTPUT_DIMENSION || metadata.height > MAX_OUTPUT_DIMENSION) {
      return send(res, 400, { error: 'image_too_large_dimensions' });
    }
    // Re-Encode statt reinem Passthrough - verwirft jede Metadaten-/
    // ICC-/EXIF-Nutzlast des Originals, normalisiert einheitlich auf PNG
    // (Minecrafts NativeImage kann ohnehin nur PNG lesen - siehe
    // api/card-image.js's identische Begruendung vom 01.09.2026).
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
