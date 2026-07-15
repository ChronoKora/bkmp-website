/* ============================================================
   Bkmp - Startet eine Stripe-Checkout-Sitzung fuer einen echten
   Geld-Kauf (aktuell: Dorf-Skin "Steampunk Dorf", 1,99 EUR).

   WICHTIG - Sicherheitsprinzip: der Preis und die Berechtigung ("besitzt
   der Spieler das schon?") werden HIER, serverseitig, aus der Datenbank
   gelesen - niemals dem Client vertraut. Die eigentliche Freischaltung
   passiert NICHT hier (eine Checkout-Session zu erzeugen heisst noch
   nicht, dass bezahlt wurde), sondern ausschliesslich im
   api/stripe-webhook.js, nachdem Stripe die Zahlung bestaetigt hat.

   Braucht in Vercel (Project Settings > Environment Variables):
     SUPABASE_SERVICE_ROLE_KEY (bereits vorhanden, siehe andere api/*.js)
     STRIPE_SECRET_KEY (aus dem Stripe-Dashboard, "sk_live_..." bzw.
       "sk_test_..." zum Testen)

   Kein npm-Paket noetig (dieses Projekt hat bewusst keine
   Abhaengigkeiten, siehe fehlende package.json) - Stripes REST-API wird
   direkt per fetch() angesprochen, genau wie die Supabase-REST-Aufrufe
   in den anderen api/*.js-Dateien.
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
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

/* Stripes REST-API erwartet klassisches application/x-www-form-urlencoded
   mit PHP-artiger Klammer-Schreibweise fuer verschachtelte Werte/Arrays
   (z.B. "line_items[0][price_data][currency]=eur") - dieser Helfer
   flacht ein normales JS-Objekt dafuer ab. */
function toStripeForm(obj, prefix, out) {
  out = out || [];
  Object.keys(obj).forEach(key => {
    const value = obj[key];
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === 'object') toStripeForm(item, `${fullKey}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(item)}`);
      });
    } else if (typeof value === 'object') {
      toStripeForm(value, fullKey, out);
    } else {
      out.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(value)}`);
    }
  });
  return out;
}

async function stripeFetch(secretKey, path, params) {
  const body = toStripeForm(params).join('&');
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((json && json.error && json.error.message) || 'Stripe-Anfrage fehlgeschlagen.');
    err.stripeError = json && json.error;
    throw err;
  }
  return json;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!serviceKey || !stripeKey) return send(res, 500, { error: 'server_not_configured' });

  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body || '{}');
  } catch (e) {
    return send(res, 400, { error: 'invalid_json' });
  }
  body = body || {};

  const nameKey = String(body.nameKey || '').trim().toLowerCase();
  const skinId = String(body.skinId || '').trim();
  if (!nameKey || !skinId) return send(res, 400, { error: 'missing_fields' });

  try {
    // 1) Spieler nachschlagen - braucht einen ECHTEN Login-Account
    //    (auth_user_id gesetzt), da ein Kauf dauerhaft und eindeutig einer
    //    Identitaet zugeordnet werden muss, nicht nur einem frei aenderbaren
    //    Anzeigenamen.
    const stateRes = await sbFetch(serviceKey, `idle_player_state?name_key=eq.${encodeURIComponent(nameKey)}&select=auth_user_id,display_name&limit=1`);
    if (!stateRes.ok) return send(res, 502, { error: 'lookup_failed' });
    const stateRows = await stateRes.json();
    const state = Array.isArray(stateRows) ? stateRows[0] : null;
    if (!state || !state.auth_user_id) return send(res, 400, { error: 'not_registered' });
    const authUserId = state.auth_user_id;

    // 2) Artikel nachschlagen - Preis kommt AUSSCHLIESSLICH von hier, nie
    //    vom Client.
    const skinRes = await sbFetch(serviceKey, `idle_village_skins?id=eq.${encodeURIComponent(skinId)}&select=id,name,price_eur_cents,unlock_type,active&limit=1`);
    if (!skinRes.ok) return send(res, 502, { error: 'lookup_failed' });
    const skinRows = await skinRes.json();
    const skin = Array.isArray(skinRows) ? skinRows[0] : null;
    if (!skin || !skin.active || skin.unlock_type !== 'real_money' || !(skin.price_eur_cents > 0)) {
      return send(res, 400, { error: 'unknown_skin' });
    }

    // 3) Schon im Besitz? Kein zweiter Kauf noetig.
    const ownedRes = await sbFetch(serviceKey, `idle_player_village_skins?auth_user_id=eq.${encodeURIComponent(authUserId)}&skin_id=eq.${encodeURIComponent(skinId)}&select=skin_id&limit=1`);
    const ownedRows = ownedRes.ok ? await ownedRes.json() : [];
    if (Array.isArray(ownedRows) && ownedRows.length) return send(res, 400, { error: 'already_owned' });

    // 4) Kauf-Zeile anlegen (Idempotenz-Anker fuer den Webhook).
    const purchaseRes = await sbFetch(serviceKey, 'real_money_purchases', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        name_key: nameKey,
        auth_user_id: authUserId,
        skin_id: skinId,
        amount_eur_cents: skin.price_eur_cents,
        status: 'pending'
      })
    });
    if (!purchaseRes.ok) {
      const detail = await purchaseRes.text().catch(() => '');
      return send(res, 502, { error: 'purchase_create_failed', detail: detail.slice(0, 300) });
    }
    const purchaseRows = await purchaseRes.json();
    const purchase = Array.isArray(purchaseRows) ? purchaseRows[0] : null;
    if (!purchase) return send(res, 502, { error: 'purchase_create_failed' });

    // 5) Stripe-Checkout-Sitzung erzeugen.
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripeFetch(stripeKey, 'checkout/sessions', {
      mode: 'payment',
      success_url: `${origin}/?purchase=success`,
      cancel_url: `${origin}/?purchase=cancelled`,
      client_reference_id: purchase.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: skin.price_eur_cents,
            product_data: {
              name: `BKMP - ${skin.name}`,
              description: 'Digitaler Kosmetik-Artikel fuer das Idle Drachen Dorf (BKMP-Website). Sofortige Freischaltung, kein physischer Versand.'
            }
          }
        }
      ],
      metadata: {
        purchase_id: purchase.id,
        auth_user_id: authUserId,
        name_key: nameKey,
        skin_id: skinId
      }
    });

    // Stripe-Session-ID direkt an der Kauf-Zeile vermerken, damit der
    // Webhook sie eindeutig wiederfindet.
    await sbFetch(serviceKey, `real_money_purchases?id=eq.${encodeURIComponent(purchase.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ stripe_session_id: session.id })
    });

    return send(res, 200, { url: session.url });
  } catch (error) {
    return send(res, 502, { error: 'unexpected', detail: String(error && error.message || error).slice(0, 300) });
  }
};
