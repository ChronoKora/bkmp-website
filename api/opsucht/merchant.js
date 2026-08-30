/* ============================================================
   Bkmp - Kompakter Proxy fuer den OPSUCHT-Shardhaendler
   (https://api.opsucht.net/merchant/rates), Datenquelle fuer den
   "Shardhaendler - Heute"-Bereich im globalen /sw-bk-Bannerkopf.

   Live-Recherche (31.08.2026, siehe CLAUDE.md fuer die volle
   Herleitung): der rohe JSON-Response enthaelt zusaetzlich zum
   bekannten oeffentlichen Java-Datenmodell (source/target/
   exchangeRate, siehe record MerchantRate in
   https://github.com/RappyLabyAddons/OPSUCHT-Utilities,
   api/.../merchant/MerchantRate.java) bereits ein eigenes `base`-
   Feld - der reguläre 0%-Referenzkurs. Das bekannte Addon liest
   dieses Feld selbst NICHT aus (record MerchantRate(source, target,
   exchangeRate) - kein base-Feld im Modell), es ist aber echt im
   rohen Response vorhanden und wird hier direkt fuer die
   Prozentanzeige verwendet - KEINE erfundenen/geschaetzten
   Standardkurse noetig.

   Nur `target==="opshards"` (die Shard-Wirtschaft) wird
   ausgeliefert - der rohe Endpunkt liefert zusaetzlich eine
   komplett unabhaengige "redcoins"-Wirtschaft (bone_block, book,
   glistering_melon_slice, ghast_tear, pumpkin_pie), die fuer den
   Shardhaendler-Bereich nicht gebraucht wird.

   `source` ist fuer die zwei "einfachen" Ressourcen eine simple
   Minecraft-Item-ID (diamond_block/netherite_ingot), fuer die drei
   Shardhaendler-exklusiven Sonderitems aber ein rohes NBT-Snippet
   (`minecraft:paper[custom_name={...text: "Name"...}]`) - der
   Anzeigename wird per Regex direkt aus dem eingebetteten `text`-
   Feld extrahiert (identisches Muster wie MerchantComponentAdapter.
   java im Referenz-Addon), NICHT erfunden. Da dieser rohe String als
   HTML-`id`/CSS-Selektor ungeeignet ist (Leerzeichen/Klammern/
   Anfuehrungszeichen), wird zusaetzlich ein sicherer, aus dem
   extrahierten Anzeigenamen abgeleiteter Slug als `id` verwendet.
   ============================================================ */

const ENDPOINT = 'https://api.opsucht.net/merchant/rates';

/* Anzeigenamen fuer die "einfachen" Minecraft-IDs (das Referenz-
   Addon uebersetzt diese nur ins Englische - MarketItem.formatName()
   liefert "Diamond Block"/"Netherite Ingot" - die deutschen Begriffe
   hier sind eine bewusste, aber offensichtliche Uebersetzung
   bekannter Minecraft-Begriffe, keine erfundenen Werte). marketId
   verbindet den Eintrag mit /api/opsucht/market. */
const KNOWN_SIMPLE_ITEMS = {
  diamond_block: { id: 'diamond_block', name: 'Diamantblock', marketId: 'DIAMOND_BLOCK' },
  netherite_ingot: { id: 'netherite_ingot', name: 'Netherite', marketId: 'NETHERITE_INGOT' }
};

const TEXT_PATTERN = /text:\s*"([^"]*)"/;

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
}

function resolveResource(source) {
  const known = KNOWN_SIMPLE_ITEMS[source];
  if (known) return known;

  const match = TEXT_PATTERN.exec(source || '');
  if (match && match[1]) {
    const name = match[1];
    return { id: slugify(name), name, marketId: null };
  }

  // Fallback fuer eine kuenftige, hier unbekannte einfache ID - reine
  // Formatierung (snake_case -> Title Case), keine erfundene Uebersetzung.
  const name = String(source || '')
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Unbekannt';
  return { id: slugify(source || name), name, marketId: null };
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=120');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  try {
    const response = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return send(res, 200, { ok: false, error: 'merchant_unavailable', status: response.status, resources: [] });
    }
    const raw = await response.json();
    if (!Array.isArray(raw)) {
      return send(res, 200, { ok: false, error: 'unexpected_shape', resources: [] });
    }

    const seenIds = new Set();
    const resources = [];
    for (const entry of raw) {
      if (!entry || entry.target !== 'opshards' || typeof entry.exchangeRate !== 'number') continue;
      const resolved = resolveResource(entry.source);
      if (seenIds.has(resolved.id)) continue; // defensiv gegen einen theoretischen Slug-Zusammenstoss
      seenIds.add(resolved.id);

      const base = typeof entry.base === 'number' && entry.base > 0 ? entry.base : null;
      const changePct = base ? ((entry.exchangeRate - base) / base) * 100 : null;

      resources.push({
        id: resolved.id,
        name: resolved.name,
        marketId: resolved.marketId,
        exchangeRate: entry.exchangeRate,
        base,
        changePct
      });
    }

    return send(res, 200, { ok: true, updatedAt: new Date().toISOString(), resources });
  } catch (error) {
    return send(res, 200, {
      ok: false,
      error: 'unexpected',
      detail: String((error && error.message) || error).slice(0, 200),
      resources: []
    });
  }
};
