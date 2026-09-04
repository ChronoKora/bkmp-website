/* ============================================================
   Bkmp - Teleport-Tracking: Statistik EINER einzelnen Karte

   Liefert die immer-aktuellen 24h/7d/30d/All-Time-Shop-Besuchszahlen
   einer Karte (Auftrag "Teleport-Tracking + Trending-/Highlight-System"
   Abschnitt 19/32/33) - GENAU EINE Karte, im Unterschied zu GET
   /api/cards?sort=trending_* (siehe dortiger Kommentar), das eine
   Rangliste MEHRERER Karten fuer einen einzigen Zeitraum liefert. Beide
   Website (Kartendetail-Statistik) UND Minecraft-Mod
   (AlbumDetailScreen, ueber TeleportApiClient#getCardTeleportStats)
   rufen diesen selben Endpunkt auf - identisches "eine Aggregations-API,
   Clients rechnen nie selbst aus Rohdaten"-Prinzip wie GET /api/cards
   (Auftrag Abschnitt 75).

   Ruft public.get_card_teleport_stats(uuid) auf (siehe
   sql/20260905-card-teleport-tracking.sql) - eine reine Aggregat-RPC,
   card_teleport_events selbst bleibt fuer anon/authenticated komplett
   unerreichbar (RLS ohne Policies). Braucht bewusst KEINEN
   SUPABASE_SERVICE_ROLE_KEY, identisches Prinzip wie api/cards.js.
   ============================================================ */

const SUPABASE_URL = 'https://zgknyrwzpohvfdweomxf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RuiDW15_3cI0cQZ8WlzoWg_DhGU9r6f';

// Reine Formvalidierung (kein DB-Zugriff noetig, um offensichtlichen
// Unsinn abzulehnen) - card_catalog.id ist ein echter uuid-Primaerschluessel
// (siehe sql/supabase-card-catalog-schema.sql), get_card_teleport_stats()
// selbst wuerde bei jeder anderen Zeichenkette ohnehin nur mit 0/0/0/0
// antworten (kein FEHLER, einfach keine passenden Events) - dieser
// zusaetzliche Check spart nur den unnoetigen Netzwerk-Roundtrip fuer
// einen offensichtlich fehlerhaften Aufruf.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Auftrag Abschnitt 42: 30-60s reichen, "es muss nicht sekuendlich exakt sein" - gleicher Wert wie api/cards.js.
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method_not_allowed' });

  const cardId = typeof (req.query || {}).cardId === 'string' ? req.query.cardId.trim() : '';
  if (!UUID_PATTERN.test(cardId)) {
    return send(res, 200, { ok: false, error: 'invalid_card_id', teleports24h: 0, teleports7d: 0, teleports30d: 0, teleportsAllTime: 0 });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_card_teleport_stats`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_card_id: cardId })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return send(res, 200, { ok: false, error: 'stats_unavailable', status: response.status, detail: detail.slice(0, 200), teleports24h: 0, teleports7d: 0, teleports30d: 0, teleportsAllTime: 0 });
    }
    const rows = await response.json();
    const row = (Array.isArray(rows) ? rows[0] : rows) || {};
    return send(res, 200, {
      ok: true,
      teleports24h: Number(row.teleports_24h) || 0,
      teleports7d: Number(row.teleports_7d) || 0,
      teleports30d: Number(row.teleports_30d) || 0,
      teleportsAllTime: Number(row.teleports_all_time) || 0
    });
  } catch (error) {
    return send(res, 200, {
      ok: false,
      error: 'unexpected',
      detail: String((error && error.message) || error).slice(0, 200),
      teleports24h: 0,
      teleports7d: 0,
      teleports30d: 0,
      teleportsAllTime: 0
    });
  }
};
