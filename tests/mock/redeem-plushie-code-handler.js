/* Invokes the REAL, unmodified api/redeem-plushie-code.js handler in-process
   against the mock backend - same technique as offline-progress-handler.js
   (see that file's header comment for the full rationale). Covers BOTH
   reward_kind branches (plushie/village_skin), since the handler itself is
   never forked/copied - only its outbound fetch()/Date are swapped for the
   duration of a single call. */

const path = require('path');
const { invokeVercelHandler } = require('./invoke-vercel-handler');

const HANDLER_PATH = path.join('..', '..', 'api', 'redeem-plushie-code.js');

async function invokeRedeemPlushieCodeHandler(store, { headers, body }) {
  return invokeVercelHandler(HANDLER_PATH, store, { method: 'POST', headers, body });
}

module.exports = { invokeRedeemPlushieCodeHandler };
