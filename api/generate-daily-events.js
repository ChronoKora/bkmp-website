/* ============================================================
   Bkmp - Erzeugt taeglich 20 Daily-Code-Events zu zufaelligen Zeiten
   (davon 1x Golden Hour), verteilt ueber den ganzen Tag.

   Wird per Vercel Cron einmal taeglich aufgerufen (siehe vercel.json,
   "5 0 * * *" = 00:05 Uhr UTC). Ist absichtlich idempotent: wenn fuer
   das heutige Datum schon Events existieren, passiert nichts - so
   schadet ein doppelter Aufruf (z. B. beim manuellen Testen) nicht.

   Die Uhrzeiten selbst werden NIE vorab an Clients ausgeliefert (siehe
   api/active-daily-event.js) - Ueberraschung bleibt also erhalten, auch
   wenn die Generierung "im Voraus" passiert.

   Braucht SUPABASE_SERVICE_ROLE_KEY in Vercel.
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const EVENTS_PER_DAY = 20;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function randomCode(prefix) {
  const seg = len => Array.from({ length: len }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
  return `${prefix}-${seg(5)}-${seg(4)}`;
}

module.exports = async function handler(req, res) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return send(res, 500, { error: 'server_not_configured', detail: 'SUPABASE_SERVICE_ROLE_KEY fehlt in den Vercel-Umgebungsvariablen.' });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    const existingRes = await sbFetch(serviceKey, `daily_code_events?event_date=eq.${today}&select=id&limit=1`);
    if (!existingRes.ok) {
      const detail = await existingRes.text().catch(() => '');
      return send(res, 502, { error: 'check_failed', detail: detail.slice(0, 300) });
    }
    const existing = await existingRes.json();
    if (Array.isArray(existing) && existing.length > 0) {
      return send(res, 200, { ok: true, skipped: true, reason: 'already_generated_today' });
    }

    const plushiesRes = await sbFetch(serviceKey, 'plushies?select=id');
    if (!plushiesRes.ok) {
      const detail = await plushiesRes.text().catch(() => '');
      return send(res, 502, { error: 'plushies_load_failed', detail: detail.slice(0, 300) });
    }
    /* 'kora' hat ein eigenes, dediziertes Easter Egg (versteckter Code im
       Platzhalter-Text) und soll NUR darueber erhaeltlich sein.
       'zerathor_zorn_der_verdammnis' soll NUR ueber die 5%-Raidboss-
       Belohnung (siehe raid_finish() in supabase-idle-event-dragons.sql)
       erhaeltlich sein. Beide muessen deshalb aus diesem taeglichen
       Zufallspool ausgeschlossen bleiben, sonst koennte der taegliche
       Cron-Job versehentlich einen zweiten, "normalen" Code fuer
       dieselben Pluschies erzeugen. */
    const EXCLUDED_FROM_DAILY_POOL = new Set(['kora', 'zerathor_zorn_der_verdammnis']);
    const plushiesAll = await plushiesRes.json();
    const plushies = (Array.isArray(plushiesAll) ? plushiesAll : []).filter(p => !EXCLUDED_FROM_DAILY_POOL.has(p.id));
    if (!Array.isArray(plushies) || plushies.length === 0) {
      return send(res, 200, { ok: true, skipped: true, reason: 'no_plushies_defined' });
    }

    const dayStart = new Date(`${today}T00:00:00.000Z`);
    const slotMinutes = 1440 / EVENTS_PER_DAY; // 72 Minuten pro Slot
    const goldenHourIndex = randomInt(EVENTS_PER_DAY);

    const rows = Array.from({ length: EVENTS_PER_DAY }, (_, i) => {
      const slotStart = i * slotMinutes;
      const jitterMinutes = 3 + Math.random() * (slotMinutes - 6); // Puffer an beiden Slot-Raendern
      const scheduledAt = new Date(dayStart.getTime() + (slotStart + jitterMinutes) * 60000);
      const plushie = plushies[randomInt(plushies.length)];
      const isGolden = i === goldenHourIndex;
      return {
        event_date: today,
        scheduled_at: scheduledAt.toISOString(),
        plushie_id: plushie.id,
        code: randomCode(isGolden ? 'GOLDEN' : 'BKMP'),
        is_golden_hour: isGolden
      };
    });

    const insertRes = await sbFetch(serviceKey, 'daily_code_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(rows)
    });
    if (!insertRes.ok) {
      const detail = await insertRes.text().catch(() => '');
      return send(res, 502, { error: 'insert_failed', detail: detail.slice(0, 300) });
    }

    return send(res, 200, { ok: true, created: rows.length, goldenHourAt: rows[goldenHourIndex].scheduled_at });
  } catch (error) {
    return send(res, 502, { error: 'unexpected', detail: String(error && error.message || error).slice(0, 300) });
  }
};
