/* Invokes the REAL, unmodified api/claim-idle-offline-progress.js handler
   in-process against the mock backend, instead of hand-writing a second
   copy of its reward math. This is the highest-fidelity piece of the whole
   mock: the actual production offline-progress logic runs, only its two
   external dependencies (Date/fetch) are swapped for the virtual clock and
   the local router for the scope of a single call - see
   invoke-vercel-handler.js for the shared mechanism.

   Route interception, not modification: api/claim-idle-offline-progress.js
   itself is never edited (CLAUDE.md keeps it frozen during the redesign,
   and this technique doesn't need to touch it anyway). */

const path = require('path');
const { invokeVercelHandler } = require('./invoke-vercel-handler');

const HANDLER_PATH = path.join('..', '..', 'api', 'claim-idle-offline-progress.js');

async function invokeOfflineProgressHandler(store, { headers, body }) {
  return invokeVercelHandler(HANDLER_PATH, store, { method: 'POST', headers, body });
}

module.exports = { invokeOfflineProgressHandler };
