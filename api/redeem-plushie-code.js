/* ============================================================
   Bkmp - Pluschie-Code einloesen (serverseitig, faelschungssicher)

   Laeuft bewusst NICHT ueber den Browser-Supabase-Client: wuerde ein
   normaler Besucher (anon-Rolle) direkt in plushie_codes/user_plushies
   schreiben duerfen, koennte er sich per DevTools/direktem API-Aufruf
   jeden Pluschie faelschen oder denselben Code beliebig oft "einloesen".
   Diese Funktion nutzt den SUPABASE_SERVICE_ROLE_KEY (voller Zugriff,
   umgeht RLS) und prueft alles server-seitig:
   - Code existiert?
   - Code schon eingeloest?
   - Pluschie schon im Besitz? (Code wird dann NICHT verbraucht)
   - Atomares "Beanspruchen" des Codes (UPDATE ... WHERE is_redeemed = false),
     damit zwei gleichzeitige Versuche mit demselben Code nicht beide
     durchgehen.

   SICHERHEITS-NACHTRAG (Perf-/Sicherheits-Audit 15.07.): "faelschungssicher"
   oben bezog sich nur auf den Code selbst - der mitgeschickte "playerName"
   wurde bisher ungeprueft uebernommen, jeder haette also einen echten Code
   unter dem Namen eines ANDEREN Spielers einloesen koennen. Jetzt wird das
   Access-Token des Aufrufers gegen /auth/v1/user geprueft (wie in
   api/claim-map-order.js) und der name_key kommt serverseitig aus
   player_stats.

   Braucht die Umgebungsvariable SUPABASE_SERVICE_ROLE_KEY in Vercel.
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return res;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return send(res, 500, { error: 'server_not_configured', detail: 'SUPABASE_SERVICE_ROLE_KEY fehlt in den Vercel-Umgebungsvariablen.' });
  }

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

  const rawCode = String(body.code || '').trim().toUpperCase();
  if (!rawCode) return send(res, 400, { error: 'missing_code' });

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) return send(res, 401, { error: 'invalid_session' });
    const user = await userRes.json();
    if (!user || !user.id) return send(res, 401, { error: 'invalid_session' });

    const profileRes = await sbFetch(serviceKey, `player_stats?auth_user_id=eq.${encodeURIComponent(user.id)}&select=name_key,display_name&limit=1`);
    if (!profileRes.ok) return send(res, 502, { error: 'profile_lookup_failed' });
    const profileRows = await profileRes.json();
    const profile = Array.isArray(profileRows) ? profileRows[0] : null;
    if (!profile) return send(res, 400, { error: 'not_registered' });
    const nameKey = profile.name_key;
    const playerName = profile.display_name || profile.name_key;

    // 1) Code nachschlagen
    const lookupRes = await sbFetch(serviceKey, `plushie_codes?code=eq.${encodeURIComponent(rawCode)}&select=id,plushie_id,is_redeemed,is_reusable&limit=1`);
    if (!lookupRes.ok) {
      const detail = await lookupRes.text().catch(() => '');
      return send(res, 502, { error: 'lookup_failed', detail: detail.slice(0, 300) });
    }
    const rows = await lookupRes.json();
    const codeRow = Array.isArray(rows) ? rows[0] : null;
    if (!codeRow) return send(res, 404, { error: 'invalid_code' });
    const isReusable = Boolean(codeRow.is_reusable);
    if (!isReusable && codeRow.is_redeemed) return send(res, 409, { error: 'already_redeemed' });

    const plushieId = codeRow.plushie_id;

    // 2) Schon im Besitz? Dann Code NICHT verbrauchen, nur freundlich melden.
    const ownedRes = await sbFetch(serviceKey, `user_plushies?name_key=eq.${encodeURIComponent(nameKey)}&plushie_id=eq.${encodeURIComponent(plushieId)}&select=id&limit=1`);
    if (ownedRes.ok) {
      const ownedRows = await ownedRes.json();
      if (Array.isArray(ownedRows) && ownedRows.length > 0) {
        return send(res, 409, { error: 'already_owned', plushieId });
      }
    }

    /* Wiederverwendbare Codes (z. B. Easter Eggs, die im UI sichtbar
       stecken und von vielen Leuten gefunden werden koennen) ueberspringen
       die Einmal-Sperre komplett - jeder Account darf einloesen, die
       already_owned-Pruefung oben verhindert Mehrfach-Freischaltung pro
       Account. Nur klassische Einmal-Codes durchlaufen noch das atomare
       "Beanspruchen" (verhindert, dass zwei gleichzeitige Versuche mit
       demselben Code beide durchgehen). */
    if (!isReusable) {
      const claimRes = await sbFetch(serviceKey, `plushie_codes?id=eq.${encodeURIComponent(codeRow.id)}&is_redeemed=eq.false`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          is_redeemed: true,
          redeemed_by_name_key: nameKey,
          redeemed_by_display_name: playerName,
          redeemed_at: new Date().toISOString()
        })
      });
      if (!claimRes.ok) {
        const detail = await claimRes.text().catch(() => '');
        return send(res, 502, { error: 'claim_failed', detail: detail.slice(0, 300) });
      }
      const claimedRows = await claimRes.json();
      if (!Array.isArray(claimedRows) || claimedRows.length === 0) {
        return send(res, 409, { error: 'already_redeemed' });
      }
    }

    // 4) Freischaltung eintragen (on-conflict ignorieren fuer den seltenen
    //    Fall gleichzeitiger Anfragen mit unterschiedlichen Codes fuer
    //    denselben Pluschie).
    const insertRes = await sbFetch(serviceKey, 'user_plushies', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ name_key: nameKey, display_name: playerName, plushie_id: plushieId })
    });
    if (!insertRes.ok) {
      const detail = await insertRes.text().catch(() => '');
      return send(res, 502, { error: 'unlock_failed', detail: detail.slice(0, 300) });
    }

    return send(res, 200, { ok: true, plushieId });
  } catch (error) {
    return send(res, 502, { error: 'unexpected', detail: String(error && error.message || error).slice(0, 300) });
  }
};
