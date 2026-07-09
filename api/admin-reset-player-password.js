/* ============================================================
   Bkmp - Admin setzt das Passwort eines Spieler-Kontos neu.

   Grund: Spieler-Konten haengen an einer Fake-E-Mail (kein echtes
   Postfach dahinter, siehe supabase.js:bkmpPlayerEmailFromName) - ein
   normaler "Passwort vergessen"-Mail-Link kann deshalb nicht funktionieren.
   Diese Funktion ist der Ersatz dafuer: nur aktive Admins/Editoren duerfen
   sie aufrufen (Firmen-Accounts nicht), sie setzt das Passwort direkt ueber
   die Supabase Admin-API per Nutzer-ID - unabhaengig davon, welchen Namen
   (aktuellen oder frueheren, siehe player_name_history) der Admin eintippt.

   Ablauf (gleiches Verifizierungsmuster wie claim-map-order.js):
     1) Browser schickt sein eigenes Admin-Access-Token mit.
     2) Token wird gegen /auth/v1/user geprueft, E-Mail des Aufrufers geholt.
     3) Per Service-Role in admin_profiles nachgeschaut: aktiv + Rolle
        admin/editor (Firmen-Accounts sind bewusst ausgeschlossen).
     4) Ziel-Account finden: erst in player_stats (aktueller Name), sonst
        in player_name_history (jeder je benutzte Name).
     5) Neues Passwort per Supabase Admin-API setzen.

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
  const playerName = String(body.playerName || '').trim();
  const newPassword = String(body.newPassword || '');
  if (!playerName) return send(res, 400, { error: 'missing_player_name' });
  if (!newPassword || newPassword.length < 6) return send(res, 400, { error: 'invalid_password' });

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) return send(res, 401, { error: 'invalid_session' });
    const caller = await userRes.json();
    const callerEmail = caller && caller.email;
    if (!callerEmail) return send(res, 401, { error: 'invalid_session' });

    const profileRes = await sbFetch(serviceKey,
      `admin_profiles?login_name=eq.${encodeURIComponent(callerEmail)}&select=role,active&limit=1`);
    if (!profileRes.ok) return send(res, 502, { error: 'profile_lookup_failed' });
    const profiles = await profileRes.json();
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile || !profile.active || (profile.role !== 'admin' && profile.role !== 'editor')) {
      return send(res, 403, { error: 'not_admin' });
    }

    const nameKey = playerName.toLowerCase();
    let targetAuthId = null;

    const statsRes = await sbFetch(serviceKey,
      `player_stats?name_key=eq.${encodeURIComponent(nameKey)}&select=auth_user_id&limit=1`);
    if (statsRes.ok) {
      const rows = await statsRes.json();
      if (Array.isArray(rows) && rows[0] && rows[0].auth_user_id) targetAuthId = rows[0].auth_user_id;
    }

    if (!targetAuthId) {
      const historyRes = await sbFetch(serviceKey,
        `player_name_history?or=(old_name.ilike.${encodeURIComponent(playerName)},new_name.ilike.${encodeURIComponent(playerName)})&select=auth_user_id&order=changed_at.desc&limit=1`);
      if (historyRes.ok) {
        const rows = await historyRes.json();
        if (Array.isArray(rows) && rows[0] && rows[0].auth_user_id) targetAuthId = rows[0].auth_user_id;
      }
    }

    if (!targetAuthId) return send(res, 404, { error: 'player_not_found' });

    const resetRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${targetAuthId}`, {
      method: 'PUT',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: newPassword })
    });
    if (!resetRes.ok) {
      const detail = await resetRes.text().catch(() => '');
      return send(res, 502, { error: 'reset_failed', detail: detail.slice(0, 300) });
    }

    return send(res, 200, { ok: true });
  } catch (error) {
    return send(res, 502, { error: 'unexpected', detail: String(error && error.message || error).slice(0, 300) });
  }
};
