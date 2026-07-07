/* ============================================================
   Bkmp - Liefert das gerade aktive Daily-Code-Event (falls es eins gibt)

   Wird von allen Besuchern alle paar Sekunden abgefragt (Polling). Gibt
   absichtlich NUR ein Event zurueck, das GERADE laeuft (scheduled_at in
   der Vergangenheit, Ablaufzeit in der Zukunft) - zukuenftige Events
   werden nie ausgeliefert, damit niemand die Uhrzeiten im Voraus kennt
   oder Codes vor dem eigentlichen Start abgreifen kann.

   Braucht SUPABASE_SERVICE_ROLE_KEY (liest ueber RLS hinweg, da die
   Tabelle bewusst keine anonyme Lese-Policy hat).
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const EVENT_DURATION_MS = 3 * 60 * 1000;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return send(res, 500, { error: 'server_not_configured' });
  }

  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - EVENT_DURATION_MS).toISOString();
    const nowIso = now.toISOString();

    const url = `${SUPABASE_URL}/rest/v1/daily_code_events?scheduled_at=lte.${encodeURIComponent(nowIso)}&scheduled_at=gt.${encodeURIComponent(windowStart)}&select=id,scheduled_at,plushie_id,code,is_golden_hour,winner_display_name&order=scheduled_at.desc&limit=1`;
    const eventRes = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    if (!eventRes.ok) {
      const detail = await eventRes.text().catch(() => '');
      return send(res, 502, { error: 'lookup_failed', detail: detail.slice(0, 300) });
    }
    const rows = await eventRes.json();
    const event = Array.isArray(rows) ? rows[0] : null;
    if (!event) return send(res, 200, { active: false });

    const expiresAt = new Date(new Date(event.scheduled_at).getTime() + EVENT_DURATION_MS).toISOString();
    return send(res, 200, {
      active: true,
      event: {
        id: event.id,
        code: event.code,
        plushieId: event.plushie_id,
        isGoldenHour: event.is_golden_hour,
        expiresAt,
        won: Boolean(event.winner_display_name),
        winnerDisplayName: event.winner_display_name || null
      }
    });
  } catch (error) {
    return send(res, 502, { error: 'unexpected', detail: String(error && error.message || error).slice(0, 300) });
  }
};
