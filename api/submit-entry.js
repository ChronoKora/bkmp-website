/* ============================================================
   Bkmp - Server-seitiges Einreichen (umgeht anonyme RLS-Probleme)

   Grund: Einreichungen ueber den Browser mit dem oeffentlichen
   anon-Key sind bei manchen Besuchern zufaellig mit
   "row-level security policy" (42501) fehlgeschlagen, obwohl die
   Policy korrekt war - vermutlich ein Cache-/Infrastruktur-Problem
   auf Supabase-Seite speziell fuer die anonyme Rolle. Diese Funktion
   umgeht das komplett: sie laeuft auf dem Server, benutzt den
   SUPABASE_SERVICE_ROLE_KEY (voller Zugriff, umgeht RLS) und ist
   selbst dafuer verantwortlich, dass neue Eintraege immer als
   "pending" gespeichert werden - unabhaengig davon, was der Client
   schickt.

   Braucht die Umgebungsvariable SUPABASE_SERVICE_ROLE_KEY in Vercel
   (Project Settings > Environment Variables). Diesen Key NIEMALS im
   Frontend-Code verwenden - er hat vollen Datenbankzugriff.
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const STORAGE_BUCKET = 'update-images';
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_FIELD_LENGTH = 2000;

const TABLE_CONFIG = {
  card_catalog: {
    table: 'card_catalog',
    folder: 'card-catalog',
    imageField: 'image_url',
    requiredFields: ['name'],
    allowedFields: ['name', 'category', 'shop_name', 'cb', 'size', 'submitted_by', 'description'],
    requireImage: true
  },
  wishes: {
    table: 'wishes',
    folder: 'wishes',
    imageField: 'image_url',
    requiredFields: ['name'],
    allowedFields: ['name'],
    requireImage: true
  },
  partner_shops: {
    table: 'partner_shops',
    folder: 'partner-shops',
    imageField: 'image_url',
    requiredFields: ['name'],
    allowedFields: ['name', 'location', 'category', 'description', 'link', 'contact'],
    requireImage: false,
    fieldMap: { name: 'shop_name' }
  },
  card_sale_requests: {
    table: 'card_sale_requests',
    folder: 'card-sale-requests',
    imageField: 'image_url',
    requiredFields: ['minecraft_name'],
    allowedFields: ['minecraft_name', 'discord'],
    requireImage: true
  },
  feedback: {
    table: 'feedback',
    folder: 'feedback',
    imageField: 'image_url',
    requiredFields: ['message'],
    allowedFields: ['name', 'category', 'message'],
    requireImage: false,
    hasStatus: false,
    allowedValues: { category: ['lob', 'idee', 'kritik', 'sonstiges'] }
  }
};

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function uploadImage(serviceKey, folder, dataUrl) {
  const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) {
    const err = new Error('Ungueltiges Bildformat.');
    err.code = 'invalid_image';
    throw err;
  }
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) {
    const err = new Error('Bild ist zu gross.');
    err.code = 'image_too_large';
    throw err;
  }
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${fileName}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': contentType,
      'x-upsert': 'false'
    },
    body: buffer
  });
  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => '');
    const err = new Error('Bild-Upload fehlgeschlagen: ' + detail.slice(0, 200));
    err.code = 'image_upload_failed';
    throw err;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${fileName}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return send(res, 500, { error: 'server_not_configured', detail: 'SUPABASE_SERVICE_ROLE_KEY fehlt in den Vercel-Umgebungsvariablen.' });
  }

  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body || '{}');
  } catch (e) {
    return send(res, 400, { error: 'invalid_json' });
  }
  body = body || {};

  const config = TABLE_CONFIG[body.type];
  if (!config) return send(res, 400, { error: 'invalid_type' });

  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
  for (const required of config.requiredFields) {
    if (!String(fields[required] || '').trim()) {
      return send(res, 400, { error: 'missing_field', field: required });
    }
  }
  if (config.requireImage && !body.imageDataUrl) {
    return send(res, 400, { error: 'missing_image' });
  }

  try {
    let imageUrl = '';
    if (body.imageDataUrl) {
      imageUrl = await uploadImage(serviceKey, config.folder, body.imageDataUrl);
    }

    const payload = {};
    config.allowedFields.forEach(field => {
      let value = fields[field];
      if (value === undefined || value === null || String(value).trim() === '') return;
      value = String(value).slice(0, MAX_FIELD_LENGTH);
      const allowed = config.allowedValues && config.allowedValues[field];
      if (allowed && !allowed.includes(value)) return;
      const column = (config.fieldMap && config.fieldMap[field]) || field;
      payload[column] = value;
    });
    if (config.imageField) payload[config.imageField] = imageUrl;
    if (config.hasStatus !== false) payload.status = 'pending';

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/${config.table}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(payload)
    });

    if (!insertRes.ok) {
      const detail = await insertRes.text().catch(() => '');
      return send(res, 502, { error: 'insert_failed', detail: detail.slice(0, 300) });
    }
    const rows = await insertRes.json();
    return send(res, 201, { ok: true, row: Array.isArray(rows) ? rows[0] : rows });
  } catch (error) {
    return send(res, error.code === 'invalid_image' || error.code === 'image_too_large' ? 400 : 502, {
      error: error.code || 'unexpected',
      detail: String(error && error.message || error).slice(0, 300)
    });
  }
};
