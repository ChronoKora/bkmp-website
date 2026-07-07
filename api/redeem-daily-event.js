/* ============================================================
   Bkmp - Daily-Code-Event einloesen ("nur der Erste gewinnt")

   Atomarer Claim per UPDATE ... WHERE winner_name_key is null: nur die
   EINE Anfrage, die diese Bedingung als erste erfolgreich trifft,
   bekommt eine Zeile zurueck (Postgres serialisiert konkurrierende
   UPDATEs auf dieselbe Zeile automatisch) - alle anderen, auch bei
   exakt gleichzeitigem Absenden, laufen ins Leere. So kann es nie zwei
   Gewinner geben.

   Braucht SUPABASE_SERVICE_ROLE_KEY in Vercel.
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const EVENT_DURATION_MS = 3 * 60 * 1000;

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

  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body || '{}');
  } catch (e) {
    return send(res, 400, { error: 'invalid_json' });
  }
  body = body || {};

  const eventId = String(body.eventId || '').trim();
  const playerName = String(body.playerName || '').trim();
  if (!eventId) return send(res, 400, { error: 'missing_event' });
  if (!playerName) return send(res, 400, { error: 'missing_name' });
  const nameKey = playerName.toLowerCase();

  try {
    const lookupRes = await sbFetch(serviceKey, `daily_code_events?id=eq.${encodeURIComponent(eventId)}&select=id,scheduled_at,plushie_id,is_golden_hour,winner_display_name&limit=1`);
    if (!lookupRes.ok) return send(res, 502, { error: 'lookup_failed' });
    const rows = await lookupRes.json();
    const event = Array.isArray(rows) ? rows[0] : null;
    if (!event) return send(res, 404, { error: 'invalid_event' });

    const scheduledAt = new Date(event.scheduled_at).getTime();
    const now = Date.now();
    if (now < scheduledAt || now > scheduledAt + EVENT_DURATION_MS) {
      return send(res, 410, { error: 'expired' });
    }
    if (event.winner_display_name) {
      return send(res, 409, { error: 'already_won', winnerDisplayName: event.winner_display_name });
    }

    // Atomarer Claim: klappt nur, wenn noch niemand gewonnen hat.
    const claimRes = await sbFetch(serviceKey, `daily_code_events?id=eq.${encodeURIComponent(eventId)}&winner_name_key=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        winner_name_key: nameKey,
        winner_display_name: playerName,
        redeemed_at: new Date().toISOString()
      })
    });
    if (!claimRes.ok) {
      const detail = await claimRes.text().catch(() => '');
      return send(res, 502, { error: 'claim_failed', detail: detail.slice(0, 300) });
    }
    const claimed = await claimRes.json();
    if (!Array.isArray(claimed) || claimed.length === 0) {
      // Jemand anderes war schneller zwischen Lookup und Claim.
      const recheck = await sbFetch(serviceKey, `daily_code_events?id=eq.${encodeURIComponent(eventId)}&select=winner_display_name&limit=1`);
      const recheckRows = recheck.ok ? await recheck.json() : [];
      const winnerName = Array.isArray(recheckRows) && recheckRows[0] ? recheckRows[0].winner_display_name : null;
      return send(res, 409, { error: 'already_won', winnerDisplayName: winnerName });
    }

    await sbFetch(serviceKey, 'user_plushies', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ name_key: nameKey, display_name: playerName, plushie_id: event.plushie_id })
    });

    return send(res, 200, { ok: true, plushieId: event.plushie_id, isGoldenHour: event.is_golden_hour });
  } catch (error) {
    return send(res, 502, { error: 'unexpected', detail: String(error && error.message || error).slice(0, 300) });
  }
};
