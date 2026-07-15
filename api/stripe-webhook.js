/* ============================================================
   Bkmp - Stripe-Webhook: einzige Stelle, an der ein Echtgeld-Kauf
   tatsaechlich freigeschaltet wird.

   WARUM ein Webhook und nicht einfach die success_url? Die success_url
   (auf die Stripe nach Zahlung im Browser zurueckleitet) ist eine reine
   Browser-Weiterleitung - jeder koennte diese URL auch OHNE zu bezahlen
   einfach direkt aufrufen und so einen Gratis-Kauf vortaeuschen. Der
   Webhook dagegen ist ein Server-zu-Server-Aufruf direkt von Stripe,
   kryptografisch signiert (Stripe-Signature-Header) - nur DER gilt hier
   als Zahlungsnachweis.

   Node-Crypto statt stripe-npm-Paket (dieses Projekt hat bewusst keine
   Abhaengigkeiten): die Signaturpruefung ist Stripes dokumentierter,
   simpler HMAC-SHA256-Algorithmus, siehe verifyStripeSignature() unten.

   Braucht in Vercel (Project Settings > Environment Variables):
     SUPABASE_SERVICE_ROLE_KEY (bereits vorhanden)
     STRIPE_WEBHOOK_SECRET (aus dem Stripe-Dashboard, NACHDEM der Webhook
       dort auf https://<deine-domain>/api/stripe-webhook eingerichtet
       wurde, zu abonnieren: "checkout.session.completed")
   ============================================================ */

const crypto = require('crypto');

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const WEBHOOK_TOLERANCE_SECONDS = 300;

// Body-Parsing abschalten - wir brauchen den RAW Bytestrom fuer die
// Signaturpruefung (ein bereits JSON-geparster/re-serialisierter Body
// wuerde nicht mehr byteidentisch mit dem sein, was Stripe signiert hat).
module.exports.config = { api: { bodyParser: false } };

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/* Stripes dokumentierter Signatur-Algorithmus:
   Header "Stripe-Signature: t=<timestamp>,v1=<hex>[,v1=<hex>...]"
   erwartete Signatur = HMAC-SHA256(webhookSecret, "<timestamp>.<rawBody>")
   Zeitstempel-Toleranz schuetzt vor Replay-Angriffen mit einer alten,
   einmal abgefangenen gueltigen Signatur. */
function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const parts = String(signatureHeader).split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    if (k === 't') acc.timestamp = v;
    else if (k === 'v1') acc.signatures.push(v);
    return acc;
  }, { timestamp: null, signatures: [] });
  if (!parts.timestamp || !parts.signatures.length) return false;

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > WEBHOOK_TOLERANCE_SECONDS) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${parts.timestamp}.${rawBody}`, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  return parts.signatures.some(sig => {
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch (e) {
      return false;
    }
  });
}

async function sbFetch(serviceKey, path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!serviceKey || !webhookSecret) return send(res, 500, { error: 'server_not_configured' });

  const rawBody = await readRawBody(req);
  const signature = req.headers['stripe-signature'];
  if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
    return send(res, 400, { error: 'invalid_signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return send(res, 400, { error: 'invalid_json' });
  }

  if (event.type !== 'checkout.session.completed') {
    // Andere Event-Typen bestaetigen wir einfach, ohne etwas zu tun -
    // Stripe erwartet fuer JEDES abonnierte Event eine 2xx-Antwort,
    // sonst wird es (mit exponentiellem Backoff) wiederholt zugestellt.
    return send(res, 200, { received: true });
  }

  const session = event.data && event.data.object;
  const metadata = (session && session.metadata) || {};
  const purchaseId = metadata.purchase_id;
  const authUserId = metadata.auth_user_id;
  const skinId = metadata.skin_id;
  if (!purchaseId || !authUserId || !skinId) return send(res, 200, { received: true, note: 'missing_metadata' });

  try {
    // Idempotenz: Stripe kann dasselbe Event mehrfach zustellen (z.B. bei
    // einem Timeout auf unserer Seite trotz erfolgreicher Verarbeitung) -
    // ist der Kauf schon 'paid', nichts nochmal tun.
    const existingRes = await sbFetch(serviceKey, `real_money_purchases?id=eq.${encodeURIComponent(purchaseId)}&select=status&limit=1`);
    const existingRows = existingRes.ok ? await existingRes.json() : [];
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;
    if (existing && existing.status === 'paid') return send(res, 200, { received: true, note: 'already_processed' });

    await sbFetch(serviceKey, 'idle_player_village_skins', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ name_key: metadata.name_key || '', auth_user_id: authUserId, skin_id: skinId })
    });

    // Spieler-Wunsch: "wechselt automatisch das Banner gegen diesen Rahmen
    // aus" - direkt nach erfolgreichem Kauf ausruesten.
    await sbFetch(serviceKey, `idle_player_state?auth_user_id=eq.${encodeURIComponent(authUserId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ active_window_frame: skinId })
    });

    await sbFetch(serviceKey, `real_money_purchases?id=eq.${encodeURIComponent(purchaseId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString() })
    });

    return send(res, 200, { received: true });
  } catch (error) {
    // 500 zurueckgeben, DAMIT Stripe es erneut versucht (Netzwerk-/DB-
    // Ausfall auf unserer Seite soll nicht bedeuten, dass eine bezahlte
    // Bestellung nie freigeschaltet wird).
    return send(res, 500, { error: 'processing_failed', detail: String(error && error.message || error).slice(0, 300) });
  }
};
