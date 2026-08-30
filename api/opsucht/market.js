/* ============================================================
   Bkmp - Kompakter Proxy fuer OPSUCHT-Marktpreise
   (https://api.opsucht.net/market/prices), fuer den Marktwert-
   Vergleich im Shardhaendler-Rechner (globaler /sw-bk-Bannerkopf).

   Live-Recherche (31.08.2026, siehe CLAUDE.md fuer die volle
   Herleitung + den Beweis anhand des OPSUCHT-Utilities-Quellcodes):
   der rohe Response ist nach Kategorie gruppiert (z.B. "Bergbau"),
   jeder Item-Eintrag ist ein Array aus GENAU 2 Eintraegen
   [{orderSide:"BUY",...}, {orderSide:"SELL",...}] - in dieser
   Reihenfolge (live verifiziert). Das bekannte Referenz-Addon
   (DefaultMarketManager.java) liest das identisch aus:
   prices[0] -> buyPrice, prices[1] -> sellPrice - und benutzt
   sellPrice fuer den Wert des EIGENEN Inventars beim Verkaufen
   (InventoryValueData.sellValue = Summe der sellPrice-Werte,
   MarketStack.getStackSellPrice()) - also GENAU der hier benoetigte
   "was bekomme ich beim Verkauf an den Markt"-Wert (Auftrag
   Abschnitt 8). Bewusst NICHT einfach `prices[0]`/`prices[1]`
   positionsbasiert uebernommen - `orderSide` wird zusaetzlich
   verifiziert, bevor ein Wert zugeordnet wird (defensiv gegen eine
   kuenftige Reihenfolgeaenderung der API - "nicht Buy/Sell
   vertauschen").

   Nimmt ?ids=DIAMOND_BLOCK,NETHERITE_INGOT (kommasepariert, wie von
   /api/opsucht/merchant als `marketId` geliefert) statt immer alle
   ~450 Marktitems zu uebertragen, die fuer den Shardhaendler gar
   nicht gebraucht werden.
   ============================================================ */

const ENDPOINT = 'https://api.opsucht.net/market/prices';
const MAX_IDS = 20;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=120');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  const wantedIds = String((req.query && req.query.ids) || '')
    .split(',')
    .map(id => id.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  if (!wantedIds.length) return send(res, 200, { ok: true, prices: {} });

  try {
    const response = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return send(res, 200, { ok: false, error: 'market_unavailable', status: response.status, prices: {} });
    }
    const raw = await response.json();
    if (!raw || typeof raw !== 'object') {
      return send(res, 200, { ok: false, error: 'unexpected_shape', prices: {} });
    }

    const prices = {};
    for (const category of Object.values(raw)) {
      if (!category || typeof category !== 'object') continue;
      for (const id of wantedIds) {
        if (prices[id] || !(id in category)) continue;
        const entries = category[id];
        if (!Array.isArray(entries) || entries.length !== 2) continue;
        const buyEntry = entries.find(e => e && e.orderSide === 'BUY');
        const sellEntry = entries.find(e => e && e.orderSide === 'SELL');
        if (!buyEntry || !sellEntry) continue;
        prices[id] = {
          buyPrice: typeof buyEntry.price === 'number' ? buyEntry.price : null,
          sellPrice: typeof sellEntry.price === 'number' ? sellEntry.price : null
        };
      }
    }

    return send(res, 200, { ok: true, updatedAt: new Date().toISOString(), prices });
  } catch (error) {
    return send(res, 200, {
      ok: false,
      error: 'unexpected',
      detail: String((error && error.message) || error).slice(0, 200),
      prices: {}
    });
  }
};
