/* ============================================================
   Bkmp - MapArt Marketplace: Auftrag atomar uebernehmen.

   Anders als die bisherigen "atomarer Claim"-Funktionen (z. B.
   redeem-daily-event.js) muss hier zusaetzlich echt geprueft werden, WER
   die Anfrage stellt (nur aktive Kartenbaufirma-Mitarbeiter duerfen
   uebernehmen). Ablauf:
     1) Der Browser schickt sein Supabase-Access-Token mit (der Nutzer ist
        bereits ueber admin.html eingeloggt).
     2) Dieses Token wird gegen den oeffentlichen Supabase-Auth-Endpunkt
        /auth/v1/user geprueft (Standard-Weg, um ein JWT serverseitig zu
        verifizieren, ohne das Signatur-Geheimnis selbst zu verwalten).
     3) Mit der so bestaetigten E-Mail wird per Service-Role in
        admin_profiles nachgeschaut, ob diese Person eine aktive
        Kartenbaufirma-Mitarbeiterin ist und zu welcher Firma sie gehoert.
     4) Erst dann der atomare Claim: PATCH ... WHERE assigned_company_id
        is null AND status = 'offen' - klappt garantiert nur fuer die
        Anfrage, die zuerst ankommt (Postgres serialisiert das).

   Braucht SUPABASE_SERVICE_ROLE_KEY in Vercel.
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RuiDW15_3cI0cQZ8WlzoWg_DhGU9r6f';

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return send(res, 500, { error: 'server_not_configured' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!accessToken) return send(res, 401, { error: 'missing_token' });

  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body || '{}');
  } catch (e) {
    return send(res, 400, { error: 'invalid_json' });
  }
  body = body || {};
  const orderId = String(body.orderId || '').trim();
  if (!orderId) return send(res, 400, { error: 'missing_order' });

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) return send(res, 401, { error: 'invalid_session' });
    const user = await userRes.json();
    const callerEmail = user && user.email;
    if (!callerEmail) return send(res, 401, { error: 'invalid_session' });

    const profileRes = await sbFetch(serviceKey,
      `admin_profiles?login_name=eq.${encodeURIComponent(callerEmail)}&select=id,display_name,company_id,role,active&limit=1`);
    if (!profileRes.ok) return send(res, 502, { error: 'profile_lookup_failed' });
    const profiles = await profileRes.json();
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile || !profile.active || profile.role !== 'company' || !profile.company_id) {
      return send(res, 403, { error: 'not_company_staff' });
    }

    const claimRes = await sbFetch(serviceKey,
      `map_orders?id=eq.${encodeURIComponent(orderId)}&assigned_company_id=is.null&status=eq.offen`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        assigned_company_id: profile.company_id,
        assigned_at: new Date().toISOString(),
        status: 'angenommen'
      })
    });
    if (!claimRes.ok) {
      const detail = await claimRes.text().catch(() => '');
      return send(res, 502, { error: 'claim_failed', detail: detail.slice(0, 300) });
    }
    const claimed = await claimRes.json();
    if (!Array.isArray(claimed) || claimed.length === 0) {
      return send(res, 409, { error: 'already_claimed' });
    }

    await sbFetch(serviceKey, 'order_events', {
      method: 'POST',
      body: JSON.stringify({
        order_id: orderId,
        event_type: 'claimed',
        actor_type: 'company',
        actor_auth_id: user.id,
        actor_display_name: profile.display_name || '',
        to_status: 'angenommen'
      })
    });

    return send(res, 200, { ok: true, order: claimed[0] });
  } catch (error) {
    return send(res, 502, { error: 'unexpected', detail: String(error && error.message || error).slice(0, 300) });
  }
};
