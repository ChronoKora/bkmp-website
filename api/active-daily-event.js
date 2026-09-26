/* ============================================================
   Bkmp - Liefert das gerade aktive Daily-Code-Event (falls es eins gibt)

   Wird von allen Besuchern alle paar Sekunden abgefragt (Polling). Gibt
   absichtlich NUR ein Event zurueck, das GERADE laeuft (scheduled_at in
   der Vergangenheit, Ablaufzeit in der Zukunft) - zukuenftige Events
   werden nie ausgeliefert, damit niemand die Uhrzeiten im Voraus kennt
   oder Codes vor dem eigentlichen Start abgreifen kann.

   Braucht SUPABASE_SERVICE_ROLE_KEY (liest ueber RLS hinweg, da die
   Tabelle bewusst keine anonyme Lese-Policy hat).

   Vercel-Traffic-Audit 26.09.2026: dieser Endpunkt war (Cache-Control:
   no-store) der mit Abstand groesste Treiber der Vercel-Function-
   Invocations - jeder offene Tab pollt einzeln alle 10s
   (js/core/bkmp-site.js, bkmpDailyEventPollTimer), OHNE dass sich
   mehrere gleichzeitig offene Tabs eine Antwort teilen (anders als
   z.B. api/twitch-live.js/api/opsucht/*.js, die laengst s-maxage
   nutzen). Live-Logs zeigten an einem Abend-Peak ~85 gleichzeitig
   offene Tabs -> ~8,5 echte Funktionsausfuehrungen/Sekunde, ~91-99%
   aller tatsaechlich abgerechneten Invocations in diesem Projekt.
   Fix: kurzer geteilter Edge-Cache (s-maxage=2) statt no-store - alle
   gleichzeitig pollenden Tabs bekommen fuer bis zu 2s dieselbe,
   gemeinsam gecachte Antwort statt je eine eigene Server-Ausfuehrung
   auszuloesen (rechnerisch ca. Faktor 15-20 weniger Invocations bei
   der beobachteten Tab-Zahl). Die Geheimhaltung/Fairness bleibt dabei
   VOLLSTAENDIG erhalten: es werden weiterhin nie zukuenftige Events
   ausgeliefert, und alle Clients sehen wegen der geteilten Cache-
   Antwort exakt denselben Stand zur exakt selben Zeit - kein Client
   bekommt dadurch einen zeitlichen Vorteil. Absichtlich SEHR kurz
   gehalten (2s, nicht z.B. 45s wie bei twitch-live/opsucht) - das
   Event dauert nur 3 Minuten, eine laengere Cache-Zeit wuerde den
   tatsaechlichen Start/das Ende spuerbar verzoegert sichtbar machen. */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const EVENT_DURATION_MS = 3 * 60 * 1000;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate=3');
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
