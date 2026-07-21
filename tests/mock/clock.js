/* Virtual test clock - shared by the in-memory store, the RPC/REST mock
   engine, and the in-process invocation of the real offline-progress
   handler. NEVER touches the real system clock (that stays untouched for
   the whole Node process); only this module's own counter moves. Playwright
   page.clock (browser-side Date/Timers) is advanced separately by
   tests/helpers/time.js and must be kept in sync with this value by the
   caller. */

function createClock(startMs) {
  let virtualNowMs = typeof startMs === 'number' ? startMs : Date.now();
  return {
    nowMs() { return virtualNowMs; },
    nowIso() { return new Date(virtualNowMs).toISOString(); },
    setNow(ms) { virtualNowMs = ms; return virtualNowMs; },
    advance(ms) { virtualNowMs += ms; return virtualNowMs; }
  };
}

module.exports = { createClock };
